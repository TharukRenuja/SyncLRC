const UA = 'SyncLRC/v1.1.2 (https://github.com/TharukRenuja/SyncLRC)';
const UPSTREAM_TIMEOUT_MS = 20000;
const UPSTREAM_INLINE_BUDGET_MS = 3000;
const NEG_TTL = 300;
const NEG_TTL_UPSTREAM = 3600;
// Dedup window for concurrent upstream calls on one track: long enough to outlast a slow
// upstream, short enough that a cut-off waitUntil release cannot starve a track of karaoke.
const UPSTREAM_COOLDOWN_TTL = 60;
const RETENTION_DAYS = 1;

import { sanitizeLyrics } from './sanitize.js';
import { isRelevant } from './match.js';

function normalizeKey(track, artist) {
  const t = track.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/g, '');
  const a = artist.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/g, '');
  return `${t}:${a}`;
}

async function generateHash(track, artist) {
  const data = `${track.toLowerCase().trim()}|${artist.toLowerCase().trim()}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
    } catch {
      // try the next artist
    }
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

// 200 karaoke found, 404 confirmed miss (cacheable), 400/403 our config error,
// 504 ran out of time (retry, never cache). Older deployments answer 200 for
// everything and use a `karaoke` field, so both shapes are read.
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
  // A pending response must not be cached for a day, or the edge keeps serving the
  // "karaoke still coming" copy long after the upgrade lands and the header never clears.
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

// ---- D1 storage ----
// Metadata, lyrics text, and the name->id index all live in one table.

async function lookupById(id, env) {
  return await env.D1_DB.prepare(
    `SELECT id, name, artist, album, duration, instrumental, karaoke, synced, plain,
            karaoke_ok, synced_ok, plain_ok
     FROM tracks WHERE id = ?`
  ).bind(id).first() || null;
}

async function lookupByNorm(norm, env) {
  return await env.D1_DB.prepare(
    `SELECT id, name, artist, album, duration, instrumental, karaoke, synced, plain,
            karaoke_ok, synced_ok, plain_ok
     FROM tracks WHERE norm = ?`
  ).bind(norm).first() || null;
}

async function lookupByName(name, artist, env) {
  return await env.D1_DB.prepare(
    `SELECT id, name, artist, album, duration, instrumental, karaoke, synced, plain,
            karaoke_ok, synced_ok, plain_ok
     FROM tracks WHERE name = ? AND artist = ?`
  ).bind(name, artist).first() || null;
}

async function getFlag(norm, kind, env) {
  const row = await env.D1_DB.prepare(
    'SELECT expires_at FROM cache_flags WHERE norm = ? AND kind = ?'
  ).bind(norm, kind).first();
  if (!row) return false;
  if (row.expires_at <= Date.now()) {
    await env.D1_DB.prepare('DELETE FROM cache_flags WHERE norm = ? AND kind = ?').bind(norm, kind).run();
    return false;
  }
  return true;
}

async function setFlag(norm, kind, ttl, env) {
  await env.D1_DB.prepare(
    'INSERT OR REPLACE INTO cache_flags (norm, kind, expires_at) VALUES (?, ?, ?)'
  ).bind(norm, kind, Date.now() + ttl * 1000).run();
}

// Atomic claim on the next upstream fetch, so a burst cannot fan out into one call per request.
async function claimUpstream(norm, env) {
  const fresh = Date.now() + UPSTREAM_COOLDOWN_TTL * 1000;
  const res = await env.D1_DB.prepare(
    'INSERT OR IGNORE INTO cache_flags (norm, kind, expires_at) VALUES (?, ?, ?)'
  ).bind(norm, 'cooldown', fresh).run();
  if ((res?.meta?.changes ?? 0) > 0) return true;

  const row = await env.D1_DB.prepare(
    'SELECT expires_at FROM cache_flags WHERE norm = ? AND kind = ?'
  ).bind(norm, 'cooldown').first();
  if (!row || row.expires_at <= Date.now()) {
    await env.D1_DB.prepare(
      'UPDATE cache_flags SET expires_at = ? WHERE norm = ? AND kind = ?'
    ).bind(fresh, norm, 'cooldown').run();
    return true;
  }
  return false;
}

async function clearFlag(norm, kind, env) {
  await env.D1_DB.prepare('DELETE FROM cache_flags WHERE norm = ? AND kind = ?').bind(norm, kind).run();
}

function combinedFromRow(row) {
  return { karaoke: row?.karaoke || null, synced: row?.synced || null, plain: row?.plain || null };
}

function isComplete(row) {
  return !!(row?.karaoke_ok && row?.synced_ok && row?.plain_ok);
}

// Merge a set of lyrics into the stored row, keeping whatever is already there.
async function storeCombined(track, artist, combined, meta, env) {
  const id = await generateHash(track, artist);
  const norm = normalizeKey(track, artist);

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

  return { id, merged };
}

// Drops rows untouched for the retention window; they are refetched on next request.
async function purgeExpired(env) {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const tracks = await env.D1_DB.prepare(
    'DELETE FROM tracks WHERE fetched_at IS NULL OR fetched_at < ?'
  ).bind(cutoff).run();

  await env.D1_DB.prepare(
    'DELETE FROM cache_flags WHERE expires_at < ?'
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

// ---- Main handlers ----

async function handleGetLyrics(id, url, env, ctx) {
  const track = url.searchParams.get('track')?.trim() || '';
  // Repeatable: artist=A&artist=B. The first is the primary used for identity and
  // storage; all of them are forwarded for matching.
  const artists = url.searchParams.getAll('artist').map(a => a.trim()).filter(Boolean);
  const artist = artists[0] || '';
  const reqType = url.searchParams.get('type')?.trim() || null;

  // By id
  if (id) {
    const row = await lookupById(id, env);
    if (!row) return errorResponse('Lyrics with provided ID not found', 404);

    const combined = combinedFromRow(row);
    if (combined.karaoke || combined.synced || combined.plain) {
      const meta = { album: row.album, duration: row.duration, instrumental: !!row.instrumental };
      const pending = !combined.karaoke;
      if (pending) ctx.waitUntil(recheckTrack(row.name, [row.artist], env));
      return buildResponse(combined, reqType, id, row.name, row.artist, meta, { pending });
    }

    const result = await buildFromSources(row.name, [row.artist], row.album, row.duration, env);
    if (!result) return errorResponse('Lyrics not found', 404);
    if (result.pendingUpstream) ctx.waitUntil(result.pendingUpstream);

    const meta = {
      album: result.meta.album || row.album,
      duration: result.meta.duration || row.duration,
      instrumental: result.instrumental || !!row.instrumental
    };
    return buildResponse(result.combined, reqType, id, row.name, row.artist, meta);
  }

  if (!track || !artist) {
    return errorResponse("Missing 'track' and 'artist' parameters (or 'id')");
  }

  const album = url.searchParams.get('album')?.trim() || null;
  const duration = url.searchParams.get('duration')?.trim() || null;
  const norm = normalizeKey(track, artist);

  // name -> id index, then an exact name match for rows stored before the index existed
  let row = await lookupByNorm(norm, env);
  if (!row) row = await lookupByName(track, artist, env);

  if (row) {
    const combined = combinedFromRow(row);
    if (combined.karaoke || combined.synced || combined.plain) {
      const meta = { album: row.album, duration: row.duration, instrumental: !!row.instrumental };
      const pending = !combined.karaoke;
      if (pending) ctx.waitUntil(recheckTrack(row.name, [row.artist, ...artists], env));
      return buildResponse(combined, reqType, row.id, row.name, row.artist, meta, { pending });
    }
  }

  if (await getFlag(norm, 'neg', env)) {
    return errorResponse('No matching song found for this track/artist.', 404);
  }

  const result = await buildFromSources(track, artists, album, duration, env);
  if (result?.pendingUpstream) ctx.waitUntil(result.pendingUpstream);

  if (!result) {
    await setFlag(norm, 'neg', NEG_TTL, env);
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

async function buildFromSources(track, artists, album, duration, env) {
  const artist = artists[0];
  const norm = normalizeKey(track, artist);
  const lrclibData = await fetchFromLrcLib(track, artists, album, duration);

  if (lrclibData?.instrumental) {
    await storeCombined(track, artist, { karaoke: null, synced: null, plain: null },
      { instrumental: true, album: lrclibData.albumName || null, duration: lrclibData.duration || null }, env);
    await clearFlag(norm, 'neg', env);
    return {
      id: await generateHash(track, artist),
      track, artist, instrumental: true,
      combined: { karaoke: null, synced: null, plain: null },
      meta: { album: lrclibData.albumName || null, duration: lrclibData.duration || null },
      pendingUpstream: null
    };
  }

  // Answer on LRCLib lyrics rather than waiting on the upstream, and upgrade in the background.
  const haveLrc = !!(lrclibData && (lrclibData.syncedLyrics || lrclibData.plainLyrics));

  // Only the caller that wins the claim hits the upstream; the rest answer from LRCLib as pending.
  let timedOut = false;
  let upstreamPromise = null;
  if (await claimUpstream(norm, env)) {
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
      // Nothing from LRCLib means nothing to answer with, so wait rather than report a
      // false miss.
      upstream = await upstreamPromise;
    }
  }

  const karaokeLyrics = upstream.status === 'ok' ? upstream.lyrics : null;
  const combined = buildCombined(lrclibData, karaokeLyrics);

  if (!combined.karaoke && !combined.synced && !combined.plain) {
    // Only a 404 is a real miss; a 504 is not and must not be cached.
    if (upstream.status === 'miss') await setFlag(norm, 'neg', NEG_TTL_UPSTREAM, env);
    if (upstream.status !== 'ok') await clearFlag(norm, 'cooldown', env);
    return null;
  }

  const canonTrack = lrclibData?.trackName || track;
  const canonArtist = lrclibData?.artistName || artist;
  const meta = {
    album: lrclibData?.albumName || album || null,
    duration: lrclibData?.duration || (duration ? Number(duration) : null),
    instrumental: false
  };

  const { id } = await storeCombined(canonTrack, canonArtist, combined, meta, env);
  await clearFlag(norm, 'neg', env);

  // Index the caller's spelling too so "Bad Guy" resolves to the canonical row.
  if (normalizeKey(canonTrack, canonArtist) !== norm) {
    await env.D1_DB.prepare('UPDATE tracks SET norm = ? WHERE id = ? AND norm IS NULL').bind(norm, id).run();
  }

  let pendingUpstream = null;
  if (!karaokeLyrics) {
    // Settle the in-flight request instead of fetching the same track twice.
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
            }, { instrumental: false }, env);
            await clearFlag(norm, 'neg', env);
          }
        }
      } catch {
      } finally {
        // Release the claim so a failed fetch cannot lock the track out of karaoke.
        await clearFlag(norm, 'cooldown', env).catch(() => {});
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
  const norm = normalizeKey(track, artist);

  let row = await lookupByNorm(norm, env);
  if (!row) row = await lookupByName(track, artist, env);
  if (isComplete(row)) return;

  if (!(await claimUpstream(norm, env))) return;

  try {
    await runRecheck(norm, row, track, artists, env);
  } catch {
  } finally {
    // Release the claim so a failed fetch cannot lock the track out of karaoke.
    await clearFlag(norm, 'cooldown', env).catch(() => {});
  }
}

async function runRecheck(norm, row, track, artists, env) {
  const recheckTrackName = row?.name || track;
  // A stored row only knows its primary artist; the caller's full list is preferred
  // so a collab still resolves when the row predates multi-artist support. The stored
  // spelling stays a candidate too, since the upstream matches on its own names.
  const recheckArtists = [...new Set([...artists, ...(row ? [row.artist] : [])])];
  const result = await fetchFromUpstream(recheckTrackName, recheckArtists, env);

  if (result.status !== 'ok') {
    if (result.status === 'miss' && !row?.karaoke_ok && !row?.synced_ok && !row?.plain_ok) {
      await setFlag(norm, 'neg', NEG_TTL_UPSTREAM, env);
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
    { instrumental: false }, env);
  await clearFlag(norm, 'neg', env);
}

// LRCLib search returns some rows as "Artist - Title" in trackName, which hashes
// differently from the "Title" / "Artist" pair that /api/get stores under. Strip the
// prefix so a stored track is still found.
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
      track: trackName,
      artist: artistName,
      album: item.albumName || null,
      duration: item.duration || null,
      plain: item.plainLyrics || null,
      synced: item.syncedLyrics || null
    });
  }

  // Read-only: storing here would make a read endpoint write on every request. One
  // batched query tells us which results already have karaoke, so a caller can tell
  // up front instead of fetching each track to find out.
  const karaokeById = new Map();
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
  }

  const finalResults = picks.map(pick => ({
    id: pick.id,
    track: pick.track,
    artist: pick.artist,
    album: pick.album,
    duration: pick.duration,
    instrumental: false,
    lyrics: {
      plain: pick.plain,
      synced: pick.synced,
      karaoke: karaokeById.get(pick.id) || karaokeById.get(pick.altId) || null
    }
  }));

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
