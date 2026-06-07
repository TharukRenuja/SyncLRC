const UA = 'SyncLRC/v1.0 (https://github.com/TharukRenuja/SyncLRC)';

import { sanitizeLyrics } from './sanitize.js';

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

async function fetchFromLrcLib(track, artist, albumName, duration) {
  let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
  if (albumName) url += `&album_name=${encodeURIComponent(albumName)}`;
  if (duration) url += `&duration=${encodeURIComponent(duration)}`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (resp.status !== 200) return null;
    return await resp.json();
  } catch {
    return null;
  }
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

async function resolveTrack(track, artist, env) {
  const term = `${track} ${artist}`;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=1`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    const data = await resp.json();
    const item = data.results?.[0];

    if (!item) return { valid: false };

    return {
      valid: true,
      canonicalTrack: item.trackName,
      canonicalArtist: item.artistName,
      album: item.collectionName || null,
      duration: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : null
    };
  } catch {
    return { valid: true, canonicalTrack: track, canonicalArtist: artist, album: null, duration: null };
  }
}

async function fetchFromUpstream(track, artist, env) {
  const params = new URLSearchParams({ track, artist, type: 'karaoke' });
  const url = `${env.UPSTREAM_URL}/lyrics?${params}`;
  const resp = await fetch(url, {
    headers: { 'X-SyncLRC-Secret': env.UPSTREAM_SECRET }
  });
  if (resp.status !== 200) return null;
  return await resp.json();
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
  const error = status === 429 ? 'RATE_LIMIT_EXCEEDED'
    : status === 404 ? 'NOT_FOUND'
    : 'BAD_REQUEST';
  return jsonResponse({
    success: false,
    error,
    message: msg,
    cooldown_seconds: status === 429 ? 3600 : 0
  }, status, status >= 400 ? 'public, max-age=300' : 'no-cache');
}

function pickType(combined) {
  return combined.karaoke ? 'karaoke' : combined.synced ? 'synced' : 'plain';
}

function buildResponse(combined, reqType, id, track, artist, meta) {
  const base = { album: meta?.album || null, duration: meta?.duration || null, instrumental: meta?.instrumental || false };

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

// ---- D1 helpers (metadata) ----

async function lookupTrackByHash(hash, env) {
  const row = await env.D1_DB.prepare(
    'SELECT id, name, artist, album, duration, instrumental FROM tracks WHERE id = ?'
  ).bind(hash).first();
  return row || null;
}

async function upsertTrack(id, name, artist, album, duration, instrumental, env) {
  await env.D1_DB.prepare(
    `INSERT OR IGNORE INTO tracks (id, name, artist, album, duration, instrumental)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, name, artist, album, duration, instrumental ? 1 : 0).run();
}

async function storeInCache(hash, combined, env) {
  await env.KV_CACHE.put(`lyrics:${hash}`, JSON.stringify(combined), { expirationTtl: 86400 });
}

async function readFromCache(hash, env) {
  return await env.KV_CACHE.get(`lyrics:${hash}`, 'json');
}

function buildCombined(lrclibData, upstreamData) {
  const combined = { karaoke: null, synced: null, plain: null };

  if (lrclibData) {
    combined.synced = lrclibData.syncedLyrics || null;
    combined.plain = lrclibData.plainLyrics || null;
  }

  if (upstreamData) {
    combined.karaoke = upstreamData.karaoke || null;
    combined.synced = combined.synced || upstreamData.synced || null;
    combined.plain = combined.plain || upstreamData.plain || null;
  }

  if (combined.karaoke) combined.karaoke = sanitizeLyrics(combined.karaoke);
  if (combined.synced) combined.synced = sanitizeLyrics(combined.synced);
  if (combined.plain) combined.plain = sanitizeLyrics(combined.plain);

  return combined;
}

// ---- Main handlers ----

async function fetchTrackLyrics(track, artist, album, duration, env) {
  let lrclibData = null;
  let upstreamData = null;

  // fetch from LRCLib (synced + plain)
  try {
    lrclibData = await fetchFromLrcLib(track, artist, album, duration);
  } catch {}

  // fetch from upstream for karaoke
  try {
    upstreamData = await fetchFromUpstream(track, artist, env);
  } catch {}

  if (lrclibData?.instrumental) {
    return { combined: { karaoke: null, synced: null, plain: null }, instrumental: true, meta: { album: lrclibData.albumName || null, duration: lrclibData.duration || null } };
  }

  const combined = buildCombined(lrclibData, upstreamData);

  if (!combined.karaoke && !combined.synced && !combined.plain) return null;

  const meta = {
    album: lrclibData?.albumName || upstreamData?.album || album || null,
    duration: lrclibData?.duration || upstreamData?.duration || duration ? Number(duration) : null,
    instrumental: false
  };

  return { combined, instrumental: false, meta };
}

async function handleGetLyrics(id, url, env) {
  const track = url.searchParams.get('track')?.trim() || '';
  const artist = url.searchParams.get('artist')?.trim() || '';
  const reqType = url.searchParams.get('type')?.trim() || null;

  if (id) {
    const row = await lookupTrackByHash(id, env);
    if (!row) return errorResponse('Lyrics with provided ID not found', 404);

    const cached = await readFromCache(id, env);
    if (cached) {
      const meta = { album: row.album, duration: row.duration, instrumental: !!row.instrumental };
      return buildResponse(cached, reqType, id, row.name, row.artist, meta);
    }

    const result = await fetchTrackLyrics(row.name, row.artist, row.album, row.duration, env);
    if (!result) return errorResponse('Lyrics not found', 404);

    await storeInCache(id, result.combined, env);
    const meta = { album: result.meta.album || row.album, duration: result.meta.duration || row.duration, instrumental: result.instrumental || !!row.instrumental };
    return buildResponse(result.combined, reqType, id, row.name, row.artist, meta);
  }

  if (!track || !artist) {
    return errorResponse("Missing 'track' and 'artist' parameters (or 'id')");
  }

  const album = url.searchParams.get('album')?.trim() || null;
  const duration = url.searchParams.get('duration')?.trim() || null;
  const normalized = normalizeKey(track, artist);

  // raw_map -> check D1 + KV cache
  const rawMap = await env.KV_CACHE.get(`raw_map:${normalized}`);
  if (rawMap) {
    const row = await lookupTrackByHash(rawMap, env);
    if (row) {
      const cached = await readFromCache(rawMap, env);
      if (cached) {
        const meta = { album: row.album, duration: row.duration, instrumental: !!row.instrumental };
        return buildResponse(cached, reqType, rawMap, row.name, row.artist, meta);
      }
    }
  }

  // neg cache
  if (await env.KV_CACHE.get(`neg:${normalized}`)) {
    return errorResponse('No matching song found for this track/artist.', 404);
  }

  const lrclibData = await fetchFromLrcLib(track, artist, album, duration);
  if (lrclibData) {
    const canonTrack = lrclibData.trackName || track;
    const canonArtist = lrclibData.artistName || artist;
    const canonNormalized = normalizeKey(canonTrack, canonArtist);

    if (lrclibData.instrumental) {
      const lyricsId = await generateHash(canonTrack, canonArtist);
      const empty = { karaoke: null, synced: null, plain: null };
      const meta = { album: lrclibData.albumName || null, duration: lrclibData.duration || null };

      await upsertTrack(lyricsId, canonTrack, canonArtist, meta.album, meta.duration, true, env);
      await env.KV_CACHE.put(`raw_map:${normalized}`, lyricsId, { expirationTtl: 604800 });
      if (canonNormalized !== normalized) {
        await env.KV_CACHE.put(`raw_map:${canonNormalized}`, lyricsId, { expirationTtl: 604800 });
      }
      await storeInCache(lyricsId, empty, env);
      return buildResponse(empty, reqType, lyricsId, canonTrack, canonArtist, { ...meta, instrumental: true });
    }

    const rawLrc = lrclibData.syncedLyrics || lrclibData.plainLyrics;
    if (rawLrc) {
      const lyricsId = await generateHash(canonTrack, canonArtist);

      let upstreamData;
      try { upstreamData = await fetchFromUpstream(canonTrack, canonArtist, env); } catch {}
      const combined = buildCombined(lrclibData, upstreamData);
      const meta = {
        album: lrclibData.albumName || upstreamData?.album || null,
        duration: lrclibData.duration || upstreamData?.duration || null,
        instrumental: false
      };

      await upsertTrack(lyricsId, canonTrack, canonArtist, meta.album, meta.duration, false, env);
      await env.KV_CACHE.put(`raw_map:${normalized}`, lyricsId, { expirationTtl: 604800 });
      if (canonNormalized !== normalized) {
        await env.KV_CACHE.put(`raw_map:${canonNormalized}`, lyricsId, { expirationTtl: 604800 });
      }
      await storeInCache(lyricsId, combined, env);
      return buildResponse(combined, reqType, lyricsId, canonTrack, canonArtist, meta);
    }
  }

  // --- LRCLib miss -> check iTunes ---
  const resolved = await resolveTrack(track, artist, env);
  if (!resolved.valid) {
    await env.KV_CACHE.put(`neg:${normalized}`, '1', { expirationTtl: 300 });
    return errorResponse('No matching song found for this track/artist.', 404);
  }

  const { canonicalTrack, canonicalArtist, album: itunesAlbum, duration: itunesDuration } = resolved;
  const canonNormalized = normalizeKey(canonicalTrack, canonicalArtist);
  const canonHash = await generateHash(canonicalTrack, canonicalArtist);

  // Check if this track cached already
  const cached = await readFromCache(canonHash, env);
  if (cached) {
    await env.KV_CACHE.put(`raw_map:${normalized}`, canonHash, { expirationTtl: 604800 });
    if (canonNormalized !== normalized) {
      await env.KV_CACHE.put(`raw_map:${canonNormalized}`, canonHash, { expirationTtl: 604800 });
    }
    const meta = { album: itunesAlbum, duration: itunesDuration, instrumental: false };
    return buildResponse(cached, reqType, canonHash, canonicalTrack, canonicalArtist, meta);
  }

  let upstreamData;
  try { upstreamData = await fetchFromUpstream(canonicalTrack, canonicalArtist, env); } catch {}
  if (!upstreamData) {
    await env.KV_CACHE.put(`neg:${normalized}`, '1', { expirationTtl: 300 });
    return errorResponse('Lyrics not found', 404);
  }

  const combined = buildCombined(null, upstreamData);
  if (!combined.karaoke && !combined.synced && !combined.plain) {
    await env.KV_CACHE.put(`neg:${normalized}`, '1', { expirationTtl: 300 });
    return errorResponse('Lyrics not found', 404);
  }

  const meta = { album: itunesAlbum, duration: itunesDuration, instrumental: false };

  await upsertTrack(canonHash, canonicalTrack, canonicalArtist, itunesAlbum, itunesDuration, false, env);
  await env.KV_CACHE.put(`raw_map:${normalized}`, canonHash, { expirationTtl: 604800 });
  if (canonNormalized !== normalized) {
    await env.KV_CACHE.put(`raw_map:${canonNormalized}`, canonHash, { expirationTtl: 604800 });
  }
  await storeInCache(canonHash, combined, env);
  return buildResponse(combined, reqType, canonHash, canonicalTrack, canonicalArtist, meta);
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

    const lyricsId = await generateHash(trackName, artistName);

    finalResults.push({
      id: lyricsId,
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
  });
}

async function handleScheduled(event, env) {}

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
        version: '1.0.0',
        author: 'Tharuk Renuja',
        github: 'https://github.com/TharukRenuja/SyncLRC',
        endpoints: {
          search: { path: '/search', method: 'GET', params: { q: 'string (required)', limit: 'int', offset: 'int' } },
          lyrics: { path: '/lyrics', method: 'GET', params: { track: 'string (required)', artist: 'string (required)', type: 'karaoke|synced|plain', album: 'string', duration: 'int' } },
          lyricsById: { path: '/lyrics/{id}', method: 'GET', path_param: { id: '32-char hex hash' }, params: { type: 'karaoke|synced|plain' } }
        }
      });
    }

    if (path.startsWith('/lyrics/') && method === 'GET') {
      const id = path.slice('/lyrics/'.length);
      if (!id) return errorResponse('Missing lyrics ID', 400);
      return handleGetLyrics(id, url, env);
    }

    if (path === '/lyrics' && method === 'GET') {
      return handleGetLyrics(null, url, env);
    }

    if (path === '/search' && method === 'GET') {
      return handleSearch(request, url, env);
    }

    return errorResponse('Not found', 404);
  },
  async scheduled(event, env, ctx) {
    await handleScheduled(event, env);
  }
};
