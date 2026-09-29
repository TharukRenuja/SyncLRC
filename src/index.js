const UA = 'SyncLRC/v1.1.2 (https://github.com/TharukRenuja/SyncLRC)';
const UPSTREAM_TIMEOUT_MS = 20000;
const UPSTREAM_INLINE_BUDGET_MS = 3000;
const NEG_TTL = 300;
const NEG_TTL_UPSTREAM = 3600;
const UPSTREAM_COOLDOWN_TTL = 3600;

// Constant, not config: the README's "we don't accumulate a corpus" claim has to
// describe the software. Fork under AGPL to change it.
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

function jsonResponse(data, status = 200, cacheControl = 'no-cache') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*'
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

function buildResponse(combined, reqType, id, track, artist, meta) {
  const base = { album: meta?.album || null, duration: meta?.duration || null, instrumental: meta?.instrumental || false };

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
    return jsonResponse({ lyrics: converted, type: convertedType, id, track, artist, ...base }, 200, 'public, max-age=86400');
  }

  return jsonResponse({
    id, track, artist,
    ...base,
    karaoke: combined.karaoke || null,
    synced: combined.synced || null,
    plain: combined.plain || null
  }, 200, 'public, max-age=86400');
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
      return buildResponse(combined, reqType, id, row.name, row.artist, meta);
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
      return buildResponse(combined, reqType, row.id, row.name, row.artist, meta);
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
  return buildResponse(result.combined, reqType, result.id, result.track, result.artist, meta);
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

  // With LRCLib lyrics in hand, answer on those rather than waiting on a scrape and
  // upgrade in the background. With nothing from LRCLib there is nothing to answer
  // with, so wait for the upstream properly rather than reporting a false miss.
  const haveLrc = !!(lrclibData && (lrclibData.syncedLyrics || lrclibData.plainLyrics));

  let timedOut = false;
  const upstreamPromise = fetchFromUpstream(track, artists, env);
  let upstream;
  if (haveLrc) {
    const budget = new Promise(resolve => {
      setTimeout(() => { timedOut = true; resolve({ status: 'retry' }); }, UPSTREAM_INLINE_BUDGET_MS);
    });
    upstream = await Promise.race([upstreamPromise, budget]);
  } else {
    upstream = await upstreamPromise;
  }

  const karaokeLyrics = upstream.status === 'ok' ? upstream.lyrics : null;
  const combined = buildCombined(lrclibData, karaokeLyrics);

  if (!combined.karaoke && !combined.synced && !combined.plain) {
    // Only a 404 is a real miss; a 504 is not and must not be cached.
    if (upstream.status === 'miss') await setFlag(norm, 'neg', NEG_TTL_UPSTREAM, env);
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
    // Settle the in-flight request rather than scraping the same track twice.
    const settle = timedOut ? upstreamPromise : Promise.resolve(upstream);
    pendingUpstream = (async () => {
      let result;
      try {
        result = await settle;
      } catch {
        return;
      }
      if (result?.status !== 'ok') {
        // Nothing to apply; a 504 is never cached so the next request retries.
        return;
      }
      const karaoke = sanitizeLyrics(result.lyrics);
      if (!karaoke) return;
      const [synced] = convertLyrics(karaoke, 'karaoke', 'synced');
      const [plain] = convertLyrics(karaoke, 'karaoke', 'plain');
      await storeCombined(canonTrack, canonArtist, {
        karaoke,
        synced: sanitizeLyrics(synced) || null,
        plain: sanitizeLyrics(plain) || null
      }, { instrumental: false }, env);
      await clearFlag(norm, 'neg', env);
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

  if (await getFlag(norm, 'cooldown', env)) return;
  await setFlag(norm, 'cooldown', UPSTREAM_COOLDOWN_TTL, env);

  const recheckTrackName = row?.name || track;
  // A stored row only knows its primary artist; the caller's full list is preferred
  // so a collab still resolves when the row predates multi-artist support.
  const recheckArtists = row ? [row.artist] : artists;
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

async function handleSearch(request, url, env) {
  const query = url.searchParams.get('q')?.trim() || '';
  const limit = parseInt(url.searchParams.get('limit') || '10');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  if (!query) return errorResponse("Missing 'q' parameter");

  const results = await searchLrcLib(query);
  const finalResults = [];

  for (const item of results.slice(offset)) {
    if (finalResults.length >= limit) break;

    const trackName = item.trackName;
    const artistName = item.artistName;
    if (!trackName || !artistName) continue;
    if (item.instrumental) continue;

    // Read-only: storing here would make a read endpoint write on every request.
    finalResults.push({
      id: await generateHash(trackName, artistName),
      track: trackName,
      artist: artistName,
      album: item.albumName || null,
      duration: item.duration || null,
      instrumental: false,
      lyrics: {
        plain: item.plainLyrics || null,
        synced: item.syncedLyrics || null,
        karaoke: null
      }
    });
  }

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
