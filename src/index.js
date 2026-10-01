const UA = 'SyncLRC/v1.1.2 (https://github.com/TharukRenuja/SyncLRC)';
const UPSTREAM_TIMEOUT_MS = 20000;
const UPSTREAM_INLINE_BUDGET_MS = 3000;
const NEG_TTL = 300;
const NEG_TTL_UPSTREAM = 3600;
// Dedup window for concurrent upstream calls on the same track.
const UPSTREAM_COOLDOWN_TTL = 60;
const RETENTION_DAYS = 1;

import { sanitizeLyrics } from './sanitize.js';
import { isRelevant } from './match.js';
import { normalizeKey, generateHash } from './normalize.js';

const TRACK_COLUMNS = `id, name, artist, album, duration, instrumental, karaoke, synced, plain,
                       karaoke_ok, synced_ok, plain_ok`;

function detectType(lyrics) {
  if (!lyrics) return 'plain';
  const wordPattern = /<\d+:\d{2}[.:]\d+>/;
  const linePattern = /\[\d+:\d{2}[.:]\d+\]/;
  if (wordPattern.test(lyrics)) return 'karaoke';
  if (linePattern.test(lyrics)) return 'synced';
  return 'plain';
}

function convertLyrics(lyrics, currentType, targetType) {
  if (!targetType || currentType === targetType) return [lyrics, currentType];
  if (targetType === 'karaoke') return [lyrics, currentType];

  if (targetType === 'synced') {
    if (currentType === 'karaoke') {
      const clean = lyrics.replace(/<\d+:\d{2}[.:]\d+>/g, '');
      const lines = clean.split('\n').map(l => l.replace(/ +/g, ' ').trim());
      return [lines.join('\n'), 'synced'];
    }
    return [lyrics, currentType];
  }

  if (targetType === 'plain') {
    let text = lyrics.replace(/\[\d+:\d{2}[.:]\d+\]/g, '');
    text = text.replace(/<\d+:\d{2}[.:]\d+>/g, '');
    const lines = text.split('\n')
      .map(l => l.replace(/ +/g, ' ').trim())
      .filter(l => l);
    return [lines.join('\n'), 'plain'];
  }

  return [lyrics, currentType];
}

// Tries each requested artist in turn; a collab may be indexed under any one of them.
async function fetchFromLrcLib(track, artists, albumName, duration) {
  for (const artist of artists) {
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
    if (albumName) url += `&album_name=${encodeURIComponent(albumName)}`;
    if (duration) url += `&duration=${encodeURIComponent(duration)}`;
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA } });
      if (resp.status !== 200) continue;
      const data = await resp.json();
      if (isRelevant(track, artists, data.trackName, data.artistName)) return data;
    } catch {}
  }
  return null;
}

async function searchLrcLib(query) {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (resp.status !== 200) return [];
    return await resp.json();
  } catch {
    return [];
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeIsrc(value) {
  const isrc = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(isrc) ? isrc : null;
}

function lookupKeys(track, artists) {
  const names = unique(artists.map(a => a.trim()).filter(Boolean));
  const keys = names.map(name => normalizeKey(track, name));
  if (names.length > 1) keys.push(normalizeKey(track, names.join(' ')));
  return unique(keys);
}

async function fetchDeezerMeta(track, artists, albumName, duration) {
  const durationSeconds = duration ? Number(duration) : null;

  for (const artist of artists) {
    const query = `artist:"${artist}" track:"${track}"`;
    const url = `https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=5`;
    let data;
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA } });
      if (resp.status !== 200) continue;
      data = await resp.json();
    } catch {
      continue;
    }

    for (const item of data?.data || []) {
      const itemTrack = item?.title_short || item?.title;
      const itemArtist = item?.artist?.name;
      if (!isRelevant(track, artists, itemTrack, itemArtist)) continue;
      if (durationSeconds && item?.duration && Math.abs(Number(item.duration) - durationSeconds) > 8) continue;

      let full = item;
      if (!full?.isrc && item?.id) {
        try {
          const resp = await fetch(`https://api.deezer.com/track/${item.id}`, { headers: { 'User-Agent': UA } });
          if (resp.status === 200) full = await resp.json();
        } catch {
        }
      }

      const isrc = normalizeIsrc(full?.isrc);
      if (!isrc) continue;
      return {
        isrc,
        track: full?.title_short || full?.title || itemTrack || track,
        artist: full?.artist?.name || itemArtist || artist,
        album: full?.album?.title || albumName || null,
        duration: full?.duration || item?.duration || durationSeconds || null
      };
    }
  }

  return null;
}

// Upstream: 200 found, 404 confirmed miss, 504 timeout; older deployments use `karaoke`.
async function fetchFromUpstream(track, artists, env) {
  const params = new URLSearchParams({ track });
  for (const artist of artists) params.append('artist', artist);
  const url = `${env.UPSTREAM_URL}/lyrics?${params}`;

  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'X-SyncLRC-Secret': env.UPSTREAM_SECRET },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch {
    return { status: 'retry' };
  }

  if (resp.status === 504) return { status: 'retry' };
  if (resp.status === 400 || resp.status === 403) return { status: 'error' };
  if (resp.status === 404) return { status: 'miss' };
  if (resp.status !== 200) return { status: 'retry' };

  let data;
  try {
    data = await resp.json();
  } catch {
    return { status: 'retry' };
  }

  const lyrics = data?.lyrics ?? data?.karaoke;
  if (!lyrics) return { status: 'miss' };

  return { status: 'ok', lyrics };
}

function jsonResponse(data, status = 200, cacheControl = 'no-cache', extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders
    }
  });
}

function errorResponse(msg, status = 400) {
  const error = status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST';
  return jsonResponse({
    success: false,
    error,
    message: msg
  }, status, status >= 400 ? 'public, max-age=300' : 'no-cache');
}

function pickType(combined) {
  return combined.karaoke ? 'karaoke' : combined.synced ? 'synced' : 'plain';
}

function buildResponse(combined, reqType, id, track, artist, meta, { pending = false } = {}) {
  const base = { album: meta?.album || null, duration: meta?.duration || null, instrumental: meta?.instrumental || false };
  // Pending responses use a short cache so clients can see the later karaoke upgrade.
  const cacheControl = pending ? 'public, max-age=60' : 'public, max-age=86400';
  const headers = pending ? { 'Synclrc-Pending': 'karaoke' } : {};

  if (combined.karaoke) {
    const [synced] = convertLyrics(combined.karaoke, 'karaoke', 'synced');
    combined.synced = sanitizeLyrics(synced) || null;
    const [plain] = convertLyrics(combined.karaoke, 'karaoke', 'plain');
    combined.plain = sanitizeLyrics(plain) || null;
  }

  if (reqType) {
    const lyrics = combined[reqType] || combined.synced || combined.plain;
    const type = pickType(combined);
    const [converted, convertedType] = convertLyrics(lyrics, type, reqType);
    return jsonResponse({ lyrics: converted, type: convertedType, id, track, artist, ...base }, 200, cacheControl, headers);
  }

  return jsonResponse({
    id, track, artist,
    ...base,
    karaoke: combined.karaoke || null,
    synced: combined.synced || null,
    plain: combined.plain || null
  }, 200, cacheControl, headers);
}


async function lookupById(id, env) {
  return await env.D1_DB.prepare(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE id = ?`
  ).bind(id).first() || null;
}

async function lookupByKeys(keys, env) {
  if (!keys.length) return null;
  const placeholders = keys.map(() => '?').join(',');
  return await env.D1_DB.prepare(
    `SELECT ${TRACK_COLUMNS}
     FROM track_keys JOIN tracks ON tracks.id = track_keys.track_id
     WHERE track_keys.key IN (${placeholders})
     LIMIT 1`
  ).bind(...keys).first() || null;
}

async function lookupIdentityByKeys(keys, env) {
  if (!keys.length) return null;
  const placeholders = keys.map(() => '?').join(',');
  return await env.D1_DB.prepare(
    `SELECT track_ids.id, track_ids.name, track_ids.artist, track_ids.duration, track_ids.isrc
     FROM track_keys JOIN track_ids ON track_ids.id = track_keys.track_id
     WHERE track_keys.key IN (${placeholders})
     LIMIT 1`
  ).bind(...keys).first() || null;
}

async function lookupIdentityByIsrc(isrc, env) {
  if (!isrc) return null;
  return await env.D1_DB.prepare(
    'SELECT id, name, artist, duration, isrc FROM track_ids WHERE isrc = ?'
  ).bind(isrc).first() || null;
}

async function lookupIdentityById(id, env) {
  return await env.D1_DB.prepare(
    'SELECT id, name, artist, duration, isrc FROM track_ids WHERE id = ?'
  ).bind(id).first() || null;
}

async function lookupByLegacyNorm(norm, env) {
  return await env.D1_DB.prepare(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE norm = ?`
  ).bind(norm).first().catch(() => null) || null;
}

async function lookupByName(name, artist, env) {
  return await env.D1_DB.prepare(
    `SELECT ${TRACK_COLUMNS} FROM tracks WHERE name = ? AND artist = ?`
  ).bind(name, artist).first() || null;
}

async function getFlag(key, kind, env) {
  const row = await env.D1_DB.prepare(
    'SELECT expires_at FROM flags WHERE key = ? AND kind = ?'
  ).bind(key, kind).first();
  if (!row) return false;
  if (row.expires_at <= Date.now()) {
    await env.D1_DB.prepare('DELETE FROM flags WHERE key = ? AND kind = ?').bind(key, kind).run();
    return false;
  }
  return true;
}

async function setFlag(key, kind, ttl, env) {
  await env.D1_DB.prepare(
    'INSERT OR REPLACE INTO flags (key, kind, expires_at) VALUES (?, ?, ?)'
  ).bind(key, kind, Date.now() + ttl * 1000).run();
}

// Claim the next upstream fetch so bursts do not fan out.
async function claimUpstream(key, env) {
  const fresh = Date.now() + UPSTREAM_COOLDOWN_TTL * 1000;
  const res = await env.D1_DB.prepare(
    'INSERT OR IGNORE INTO flags (key, kind, expires_at) VALUES (?, ?, ?)'
  ).bind(key, 'cooldown', fresh).run();
  if ((res?.meta?.changes ?? 0) > 0) return true;

  const row = await env.D1_DB.prepare(
    'SELECT expires_at FROM flags WHERE key = ? AND kind = ?'
  ).bind(key, 'cooldown').first();
  if (!row || row.expires_at <= Date.now()) {
    await env.D1_DB.prepare(
      'UPDATE flags SET expires_at = ? WHERE key = ? AND kind = ?'
    ).bind(fresh, key, 'cooldown').run();
    return true;
  }
  return false;
}

async function clearFlag(key, kind, env) {
  await env.D1_DB.prepare('DELETE FROM flags WHERE key = ? AND kind = ?').bind(key, kind).run();
}

async function rememberKeys(id, keys, env, { replace = false } = {}) {
  const clean = unique(keys);
  if (!clean.length) return;
  const verb = replace ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  await env.D1_DB.batch(clean.map(key =>
    env.D1_DB.prepare(`${verb} INTO track_keys (key, track_id) VALUES (?, ?)`).bind(key, id)
  ));
}

function combinedFromRow(row) {
  return { karaoke: row?.karaoke || null, synced: row?.synced || null, plain: row?.plain || null };
}

function isComplete(row) {
  return !!(row?.karaoke_ok && row?.synced_ok && row?.plain_ok);
}

async function storeCombined(track, artist, combined, meta, env, keys = []) {
  const isrc = normalizeIsrc(meta?.isrc);
  const identity = await lookupIdentityByIsrc(isrc, env);
  const id = identity?.id || meta?.id || await generateHash(track, artist);
  const allKeys = unique([...(keys.length ? keys : []), ...lookupKeys(track, [artist])]);
  const norm = allKeys[0] || normalizeKey(track, artist);

  const existing = await lookupById(id, env);
  const merged = {
    karaoke: combined.karaoke || existing?.karaoke || null,
    synced: combined.synced || existing?.synced || null,
    plain: combined.plain || existing?.plain || null
  };

  const instrumental = meta?.instrumental ? 1 : 0;
  const album = meta?.album ?? existing?.album ?? null;
  const duration = meta?.duration ?? existing?.duration ?? null;

  await env.D1_DB.prepare(
    `INSERT INTO tracks (id, name, artist, album, duration, instrumental, karaoke, synced, plain,
                         karaoke_ok, synced_ok, plain_ok, norm, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       artist = excluded.artist,
       album = COALESCE(excluded.album, tracks.album),
       duration = COALESCE(excluded.duration, tracks.duration),
       instrumental = excluded.instrumental,
       karaoke = excluded.karaoke,
       synced = excluded.synced,
       plain = excluded.plain,
       karaoke_ok = excluded.karaoke_ok,
       synced_ok = excluded.synced_ok,
       plain_ok = excluded.plain_ok,
       norm = COALESCE(tracks.norm, excluded.norm),
       fetched_at = excluded.fetched_at`
  ).bind(
    id, track, artist, album, duration, instrumental,
    merged.karaoke, merged.synced, merged.plain,
    merged.karaoke ? 1 : 0, merged.synced ? 1 : 0, merged.plain ? 1 : 0,
    norm, Date.now()
  ).run();

  await rememberIdentity(id, track, artist, duration, isrc, env);
  await rememberKeys(id, allKeys, env, { replace: !!identity });

  return { id, merged };
}

// Keep song identity after transient lyrics are purged.
async function rememberIdentity(id, track, artist, duration, isrc, env) {
  await env.D1_DB.prepare(
    `INSERT INTO track_ids (id, name, artist, duration, isrc, first_seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       duration = COALESCE(excluded.duration, track_ids.duration),
       isrc = COALESCE(track_ids.isrc, excluded.isrc)`
  ).bind(id, track, artist, duration ?? null, isrc, Date.now()).run();
}

// Purge transient lyrics only; identity rows stay for cheap repeat lookups.
async function purgeExpired(env) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const tracks = await env.D1_DB.prepare(
    'DELETE FROM tracks WHERE fetched_at IS NULL OR fetched_at < ?'
  ).bind(cutoff).run();

  await env.D1_DB.prepare(
    'DELETE FROM flags WHERE expires_at < ?'
  ).bind(Date.now()).run();

  return tracks?.meta?.changes ?? 0;
}

function buildCombined(lrclibData, karaokeLyrics) {
  const combined = { karaoke: null, synced: null, plain: null };

  if (karaokeLyrics) {
    combined.karaoke = sanitizeLyrics(karaokeLyrics);
  }

  if (combined.karaoke) {
    const [synced] = convertLyrics(combined.karaoke, 'karaoke', 'synced');
    combined.synced = sanitizeLyrics(synced) || null;
    const [plain] = convertLyrics(combined.karaoke, 'karaoke', 'plain');
    combined.plain = sanitizeLyrics(plain) || null;
  } else if (lrclibData) {
    combined.synced = lrclibData.syncedLyrics || null;
    combined.plain = lrclibData.plainLyrics || null;
    if (combined.synced) combined.synced = sanitizeLyrics(combined.synced);
    if (combined.plain) combined.plain = sanitizeLyrics(combined.plain);
  }

  return combined;
}


async function handleGetLyrics(id, url, env, ctx) {
  const track = url.searchParams.get('track')?.trim() || '';
  // Repeatable: artist=A&artist=B; first is primary, all are used for matching.
  const artists = url.searchParams.getAll('artist').map(a => a.trim()).filter(Boolean);
  const artist = artists[0] || '';
  const reqType = url.searchParams.get('type')?.trim() || null;

  if (id) {
    const row = await lookupById(id, env);
    const identity = row ? null : await lookupIdentityById(id, env);
    if (!row && !identity) return errorResponse('Lyrics with provided ID not found', 404);

    const combined = combinedFromRow(row);
    if (combined.karaoke || combined.synced || combined.plain) {
      const meta = { album: row.album, duration: row.duration, instrumental: !!row.instrumental };
      const pending = !combined.karaoke;
      if (pending) ctx.waitUntil(recheckTrack(row.name, [row.artist], env));
      return buildResponse(combined, reqType, id, row.name, row.artist, meta, { pending });
    }

    const sourceName = row?.name || identity.name;
    const sourceArtist = row?.artist || identity.artist;
    const result = await buildFromSources(sourceName, [sourceArtist], row?.album || null, row?.duration || identity.duration, env, {
      id,
      isrc: identity?.isrc || null,
      keys: lookupKeys(sourceName, [sourceArtist])
    });
    if (!result) return errorResponse('Lyrics not found', 404);
    if (result.pendingUpstream) ctx.waitUntil(result.pendingUpstream);

    const meta = {
      album: result.meta.album || row?.album || null,
      duration: result.meta.duration || row?.duration || identity?.duration || null,
      instrumental: result.instrumental || !!row?.instrumental
    };
    return buildResponse(result.combined, reqType, id, result.track, result.artist, meta);
  }

  if (!track || !artist) {
    return errorResponse("Missing 'track' and 'artist' parameters (or 'id')");
  }

  const album = url.searchParams.get('album')?.trim() || null;
  const duration = url.searchParams.get('duration')?.trim() || null;
  const requestKeys = lookupKeys(track, artists);
  const primaryKey = requestKeys[0];

  let row = await lookupByKeys(requestKeys, env);
  if (!row) row = await lookupByLegacyNorm(primaryKey, env);
  if (!row) row = await lookupByName(track, artist, env);

  if (row) {
    const combined = combinedFromRow(row);
    if (combined.karaoke || combined.synced || combined.plain) {
      await rememberKeys(row.id, requestKeys, env);
      const meta = { album: row.album, duration: row.duration, instrumental: !!row.instrumental };
      const pending = !combined.karaoke;
      if (pending) ctx.waitUntil(recheckTrack(row.name, [row.artist, ...artists], env));
      return buildResponse(combined, reqType, row.id, row.name, row.artist, meta, { pending });
    }
  }

  const identity = await lookupIdentityByKeys(requestKeys, env);
  if (identity) {
    const result = await buildFromSources(identity.name, [identity.artist, ...artists], album, duration || identity.duration, env, {
      id: identity.id,
      isrc: identity.isrc,
      keys: requestKeys
    });
    if (result?.pendingUpstream) ctx.waitUntil(result.pendingUpstream);
    if (result) {
      const meta = {
        album: result.meta.album,
        duration: result.meta.duration,
        instrumental: result.instrumental
      };
      return buildResponse(result.combined, reqType, result.id, result.track, result.artist, meta,
        { pending: !!result.pendingUpstream });
    }
  }

  if (await getFlag(primaryKey, 'neg', env)) {
    return errorResponse('No matching song found for this track/artist.', 404);
  }

  const result = await buildFromSources(track, artists, album, duration, env, { keys: requestKeys });
  if (result?.pendingUpstream) ctx.waitUntil(result.pendingUpstream);

  if (!result) {
    await setFlag(primaryKey, 'neg', NEG_TTL, env);
    return errorResponse('No matching song found for this track/artist.', 404);
  }

  const meta = {
    album: result.meta.album,
    duration: result.meta.duration,
    instrumental: result.instrumental
  };
  return buildResponse(result.combined, reqType, result.id, result.track, result.artist, meta,
    { pending: !!result.pendingUpstream });
}

async function buildFromSources(track, artists, album, duration, env, identity = {}) {
  const artist = artists[0];
  const requestKeys = unique([...(identity.keys || []), ...lookupKeys(track, artists)]);
  const primaryKey = requestKeys[0];
  const lrclibPromise = fetchFromLrcLib(track, artists, album, duration);
  const deezerPromise = fetchDeezerMeta(track, artists, album, duration);
  const [lrclibData, deezerMeta] = await Promise.all([lrclibPromise, deezerPromise]);
  const canonTrack = lrclibData?.trackName || deezerMeta?.track || track;
  const canonArtist = lrclibData?.artistName || deezerMeta?.artist || artist;
  const upstreamArtists = [...new Set([...artists, canonArtist])];
  const recordKeys = unique([...requestKeys, ...lookupKeys(canonTrack, upstreamArtists)]);
  const meta = {
    id: identity.id || null,
    isrc: deezerMeta?.isrc || identity.isrc || null,
    album: lrclibData?.albumName || deezerMeta?.album || album || null,
    duration: lrclibData?.duration || deezerMeta?.duration || (duration ? Number(duration) : null),
    instrumental: !!lrclibData?.instrumental
  };

  const isrcIdentity = await lookupIdentityByIsrc(meta.isrc, env);
  if (isrcIdentity) {
    meta.id = isrcIdentity.id;
    await rememberKeys(isrcIdentity.id, recordKeys, env, { replace: true });
    const existing = await lookupById(isrcIdentity.id, env);
    const existingCombined = combinedFromRow(existing);
    if (existingCombined.karaoke || existingCombined.synced || existingCombined.plain) {
      return {
        id: isrcIdentity.id,
        track: existing?.name || isrcIdentity.name,
        artist: existing?.artist || isrcIdentity.artist,
        instrumental: !!existing?.instrumental,
        combined: existingCombined,
        meta: {
          album: existing?.album || meta.album,
          duration: existing?.duration || isrcIdentity.duration || meta.duration
        },
        pendingUpstream: null
      };
    }
  }

  if (lrclibData?.instrumental) {
    const stored = await storeCombined(canonTrack, canonArtist, { karaoke: null, synced: null, plain: null },
      meta, env, recordKeys);
    await clearFlag(primaryKey, 'neg', env);
    return {
      id: stored.id,
      track: canonTrack, artist: canonArtist, instrumental: true,
      combined: { karaoke: null, synced: null, plain: null },
      meta,
      pendingUpstream: null
    };
  }

  // Answer from LRCLib while karaoke upgrades in the background.
  const haveLrc = !!(lrclibData && (lrclibData.syncedLyrics || lrclibData.plainLyrics));

  // Only the claim winner hits the upstream; others return pending.
  let timedOut = false;
  let upstreamPromise = null;
  if (await claimUpstream(primaryKey, env)) {
    upstreamPromise = fetchFromUpstream(track, artists, env);
  }

  let upstream = { status: 'skipped' };
  if (upstreamPromise) {
    if (haveLrc) {
      const budget = new Promise(resolve => {
        setTimeout(() => { timedOut = true; resolve({ status: 'retry' }); }, UPSTREAM_INLINE_BUDGET_MS);
      });
      upstream = await Promise.race([upstreamPromise, budget]);
    } else if (!haveLrc) {
      // Without LRCLib lyrics, wait for upstream instead of returning a false miss.
      upstream = await upstreamPromise;
    }
  }

  const karaokeLyrics = upstream.status === 'ok' ? upstream.lyrics : null;
  const combined = buildCombined(lrclibData, karaokeLyrics);

  if (!combined.karaoke && !combined.synced && !combined.plain) {
    // Only 404 is a cacheable miss; 504 may succeed later.
    if (upstream.status === 'miss') await setFlag(primaryKey, 'neg', NEG_TTL_UPSTREAM, env);
    if (upstream.status !== 'ok') await clearFlag(primaryKey, 'cooldown', env);
    return null;
  }

  const { id } = await storeCombined(canonTrack, canonArtist, combined, meta, env, recordKeys);
  await clearFlag(primaryKey, 'neg', env);

  let pendingUpstream = null;
  if (!karaokeLyrics) {
    const settle = timedOut ? upstreamPromise : Promise.resolve(upstream);
    pendingUpstream = (async () => {
      try {
        const result = await settle;
        if (result?.status === 'ok') {
          const karaoke = sanitizeLyrics(result.lyrics);
          if (karaoke) {
            const [synced] = convertLyrics(karaoke, 'karaoke', 'synced');
            const [plain] = convertLyrics(karaoke, 'karaoke', 'plain');
            await storeCombined(canonTrack, canonArtist, {
              karaoke,
              synced: sanitizeLyrics(synced) || null,
              plain: sanitizeLyrics(plain) || null
            }, meta, env, recordKeys);
            await clearFlag(primaryKey, 'neg', env);
          }
        }
      } catch {
      } finally {
        await clearFlag(primaryKey, 'cooldown', env).catch(() => {});
      }
    })();
  }

  return {
    id,
    track: canonTrack,
    artist: canonArtist,
    instrumental: false,
    combined,
    meta,
    pendingUpstream
  };
}

async function recheckTrack(track, artists, env) {
  const artist = artists[0];
  const keys = lookupKeys(track, artists);
  const primaryKey = keys[0];

  let row = await lookupByKeys(keys, env);
  if (!row) row = await lookupByLegacyNorm(primaryKey, env);
  if (!row) row = await lookupByName(track, artist, env);
  if (isComplete(row)) return;

  if (!(await claimUpstream(primaryKey, env))) return;

  try {
    await runRecheck(primaryKey, row, track, artists, env, keys);
  } catch {
  } finally {
    await clearFlag(primaryKey, 'cooldown', env).catch(() => {});
  }
}

async function runRecheck(primaryKey, row, track, artists, env, keys = []) {
  const recheckTrackName = row?.name || track;
  // Keep caller spellings for collabs and old single-artist rows.
  const recheckArtists = [...new Set([...artists, ...(row ? [row.artist] : [])])];
  const result = await fetchFromUpstream(recheckTrackName, recheckArtists, env);

  if (result.status !== 'ok') {
    if (result.status === 'miss' && !row?.karaoke_ok && !row?.synced_ok && !row?.plain_ok) {
      await setFlag(primaryKey, 'neg', NEG_TTL_UPSTREAM, env);
    }
    return;
  }

  const karaoke = sanitizeLyrics(result.lyrics);
  if (!karaoke) return;

  const [synced] = convertLyrics(karaoke, 'karaoke', 'synced');
  const [plain] = convertLyrics(karaoke, 'karaoke', 'plain');
  const merged = {
    karaoke,
    synced: sanitizeLyrics(synced) || null,
    plain: sanitizeLyrics(plain) || null
  };

  await storeCombined(recheckTrackName, recheckArtists[0], merged,
    { id: row?.id || null, instrumental: false }, env, unique([...keys, ...lookupKeys(recheckTrackName, recheckArtists)]));
  await clearFlag(primaryKey, 'neg', env);
}

// Strip LRCLib's occasional "Artist - Title" prefix before hashing.
async function searchAltId(trackName, artistName) {
  if (!artistName || !trackName) return null;
  const prefix = `${artistName} - `;
  if (trackName.toLowerCase().startsWith(prefix.toLowerCase())) {
    const stripped = trackName.slice(prefix.length).trim();
    if (stripped) return generateHash(stripped, artistName);
  }
  return null;
}

async function handleSearch(request, url, env) {
  const query = url.searchParams.get('q')?.trim() || '';
  const limit = parseInt(url.searchParams.get('limit') || '10');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  if (!query) return errorResponse("Missing 'q' parameter");

  const results = await searchLrcLib(query);
  const picks = [];

  for (const item of results.slice(offset)) {
    if (picks.length >= limit) break;

    const trackName = item.trackName;
    const artistName = item.artistName;
    if (!trackName || !artistName) continue;
    if (item.instrumental) continue;

    picks.push({
      id: await generateHash(trackName, artistName),
      altId: await searchAltId(trackName, artistName),
      keys: lookupKeys(trackName, [artistName]),
      track: trackName,
      artist: artistName,
      album: item.albumName || null,
      duration: item.duration || null,
      plain: item.plainLyrics || null,
      synced: item.syncedLyrics || null
    });
  }

  // Search stays read-only; one batched query marks known karaoke results.
  const karaokeById = new Map();
  const knownByKey = new Map();
  if (picks.length) {
    const ids = [...new Set(picks.flatMap(p => (p.altId && p.altId !== p.id ? [p.id, p.altId] : [p.id])))];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const placeholders = chunk.map(() => '?').join(',');
      const { results: rows } = await env.D1_DB.prepare(
        `SELECT id, karaoke FROM tracks WHERE id IN (${placeholders}) AND karaoke IS NOT NULL`
      ).bind(...chunk).all();
      for (const row of rows || []) {
        if (row.karaoke) karaokeById.set(row.id, row.karaoke);
      }
    }

    const keys = unique(picks.flatMap(p => p.keys));
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      const placeholders = chunk.map(() => '?').join(',');
      const { results: rows } = await env.D1_DB.prepare(
        `SELECT track_keys.key, tracks.id, tracks.karaoke
         FROM track_keys JOIN tracks ON tracks.id = track_keys.track_id
         WHERE track_keys.key IN (${placeholders})`
      ).bind(...chunk).all();
      for (const row of rows || []) {
        knownByKey.set(row.key, row.id);
        if (row.karaoke) karaokeById.set(row.id, row.karaoke);
      }
    }
  }

  const finalResults = picks.map(pick => {
    const keyId = pick.keys.map(key => knownByKey.get(key)).find(Boolean);
    const id = keyId || pick.id;
    return {
      id,
      track: pick.track,
      artist: pick.artist,
      album: pick.album,
      duration: pick.duration,
      instrumental: false,
      lyrics: {
        plain: pick.plain,
        synced: pick.synced,
        karaoke: karaokeById.get(id) || karaokeById.get(pick.altId) || null
      }
    };
  });

  return jsonResponse({
    results: finalResults,
    total: finalResults.length,
    limit
  }, 200, 'public, max-age=600');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');
    const method = request.method.toUpperCase();

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (path === '' && method === 'GET') {
      return jsonResponse({
        name: 'SyncLRC API',
        version: '1.1.2',
        author: 'Tharuk Renuja',
        github: 'https://github.com/TharukRenuja/SyncLRC',
        endpoints: {
          search: { path: '/search', method: 'GET', params: { q: 'string (required)', limit: 'int', offset: 'int' } },
          lyrics: { path: '/lyrics', method: 'GET', params: { track: 'string (required)', artist: 'string (required, repeatable for collabs)', type: 'karaoke|synced|plain', album: 'string', duration: 'int' } },
          lyricsById: { path: '/lyrics/{id}', method: 'GET', path_param: { id: '32-char hex hash' }, params: { type: 'karaoke|synced|plain' } }
        }
      }, 200, 'public, max-age=86400');
    }

    if (path.startsWith('/lyrics/') && method === 'GET') {
      const id = path.slice('/lyrics/'.length);
      if (!id) return errorResponse('Missing lyrics ID', 400);
      return handleGetLyrics(id, url, env, ctx);
    }

    if (path === '/lyrics' && method === 'GET') {
      return handleGetLyrics(null, url, env, ctx);
    }

    if (path === '/search' && method === 'GET') {
      return handleSearch(request, url, env);
    }

    return errorResponse('Not found', 404);
  },

  async scheduled(event, env, ctx) {
    await purgeExpired(env);
  }
};
