const FORBIDDEN_KEYWORDS = [
  'instrumental', 'karaoke', 'version instrumental', 'bez slow', 'bez słów', 'orchestral'
];

const UA = 'SyncLRC/1.0 (https://github.com/TharukRenuja/SyncLRC)';
const MAX_RECHECK_PER_CRON = 50;

import { sanitizeLyrics } from './sanitize.js';

function isInstrumental(track) {
  return FORBIDDEN_KEYWORDS.some(kw => track.toLowerCase().includes(kw));
}

async function fetchTrackMetadata(track, artist) {
  const term = `${track} ${artist}`;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=1`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    const data = await resp.json();
    const item = data.results?.[0];
    if (item) {
      return {
        album: item.collectionName || null,
        duration: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : null,
        instrumental: isInstrumental(track)
      };
    }
  } catch {}
  return { album: null, duration: null, instrumental: false };
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

async function generateHash(track, artist) {
  const data = `${track.toLowerCase().trim()}|${artist.toLowerCase().trim()}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchFromLrcLib(track, artist, albumName) {
  let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
  if (albumName) url += `&album_name=${encodeURIComponent(albumName)}`;
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

async function fetchFromUpstream(track, artist, env, lyricsType, album, duration) {
  const params = new URLSearchParams({ track, artist });
  if (lyricsType) params.set('type', lyricsType);
  if (album) params.set('album', album);
  if (duration) params.set('duration', String(duration));

  const url = `${env.UPSTREAM_URL}/lyrics?${params}`;
  const resp = await fetch(url, {
    headers: { 'X-SyncLRC-Secret': env.UPSTREAM_SECRET }
  });
  if (resp.status !== 200) return null;

  const data = await resp.json();
  if (lyricsType) {
    return {
      lyrics: data.lyrics,
      type: lyricsType,
      plain: lyricsType === 'plain' ? data.lyrics : null,
      synced: lyricsType === 'synced' ? data.lyrics : null,
      karaoke: lyricsType === 'karaoke' ? data.lyrics : null
    };
  }
  return data;
}

async function getFromCache(track, artist, env) {
  const cacheKey = `lyrics:${track.toLowerCase()}:${artist.toLowerCase()}`;
  const cached = await env.KV_CACHE.get(cacheKey, 'json');
  return cached || null;
}

async function setCache(track, artist, payload, env, ttl = 86400) {
  const cacheKey = `lyrics:${track.toLowerCase()}:${artist.toLowerCase()}`;
  await env.KV_CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttl });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
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
  }, status);
}

function pickType(combined) {
  return combined.karaoke ? 'karaoke' : combined.synced ? 'synced' : 'plain';
}

async function findInD1(track, artist, env) {
  return await env.D1_DB.prepare(
    'SELECT id, name, artist, karaoke, synced, plain FROM lyrics WHERE name = ? AND artist = ?'
  ).bind(track, artist).first() || null;
}

function singleLyricsResponse(lyrics, type, id, track, artist, meta) {
  const body = { lyrics, type, id, track, artist };
  if (meta) Object.assign(body, meta);
  return jsonResponse(body);
}

function multiLyricsResponse(karaoke, synced, plain, id, track, artist, meta) {
  const body = { id, track, artist, karaoke: karaoke || null, synced: synced || null, plain: plain || null };
  if (meta) Object.assign(body, meta);
  return jsonResponse(body);
}

async function readCombined(id, env) {
  const obj = await env.R2_BUCKET.get(`lyrics/${id}.json`);
  if (!obj) return null;
  return JSON.parse(await obj.text());
}

async function storeLyrics(track, artist, lyrics, type, meta, env) {
  const lyricsId = await generateHash(track, artist);

  let combined = {};
  const existing = await env.R2_BUCKET.get(`lyrics/${lyricsId}.json`);
  if (existing) combined = JSON.parse(await existing.text());
  combined[type] = lyrics;

  await env.R2_BUCKET.put(`lyrics/${lyricsId}.json`, JSON.stringify(combined), {
    httpMetadata: { contentType: 'application/json' }
  });

  await env.D1_DB.prepare(
    'INSERT OR IGNORE INTO lyrics (id, name, artist, karaoke, synced, plain) VALUES (?, ?, ?, 0, 0, 0)'
  ).bind(lyricsId, track, artist).run();
  await env.D1_DB.prepare(
    `UPDATE lyrics SET ${type} = 1 WHERE id = ?`
  ).bind(lyricsId).run();

  const payload = { id: lyricsId, name: track, artist, ...combined, ...meta };
  await setCache(track, artist, payload, env);
  return lyricsId;
}

async function handleGetLyrics(id, url, env) {
  const track = url.searchParams.get('track')?.trim() || '';
  const artist = url.searchParams.get('artist')?.trim() || '';
  const album = url.searchParams.get('album')?.trim() || null;
  const duration = url.searchParams.get('duration')?.trim() || null;
  const reqType = url.searchParams.get('type')?.trim() || null;

  if (id) {
    const row = await env.D1_DB.prepare(
      'SELECT id, name, artist, karaoke, synced, plain FROM lyrics WHERE id = ?'
    ).bind(id).first();

    if (!row) return errorResponse('Lyrics with provided ID not found', 404);

    const combined = await readCombined(row.id, env);
    if (!combined) return errorResponse('Lyrics content not found in storage', 404);

    if (reqType) {
      const lyrics = combined[reqType] || combined.synced || combined.plain;
      const type = pickType(combined);
      const [converted, convertedType] = convertLyrics(lyrics, type, reqType);
      return singleLyricsResponse(converted, convertedType, row.id, row.name, row.artist);
    }
    return multiLyricsResponse(combined.karaoke, combined.synced, combined.plain, row.id, row.name, row.artist);
  }

  if (!track || !artist) {
    return errorResponse("Missing 'track' and 'artist' parameters (or 'id')");
  }

  const cached = await getFromCache(track, artist, env);
  if (cached) {
    const meta = cached.album ? { album: cached.album, duration: cached.duration, instrumental: cached.instrumental } : null;
    if (reqType) {
      const lyrics = cached[reqType] || cached.synced || cached.plain;
      const type = pickType(cached);
      const [converted, convertedType] = convertLyrics(lyrics, type, reqType);
      return singleLyricsResponse(converted, convertedType, cached.id, cached.name, cached.artist, meta);
    }
    return multiLyricsResponse(cached.karaoke, cached.synced, cached.plain, cached.id, cached.name, cached.artist, meta);
  }

  const row = await findInD1(track, artist, env);
  if (row) {
    const combined = await readCombined(row.id, env);
    if (combined) {
      const meta = await fetchTrackMetadata(track, artist);
      const payload = { id: row.id, name: row.name, artist: row.artist, ...combined, ...meta };
      await setCache(track, artist, payload, env);

      if (reqType) {
        const lyrics = combined[reqType] || combined.synced || combined.plain;
        const type = pickType(combined);
        const [converted, convertedType] = convertLyrics(lyrics, type, reqType);
        return singleLyricsResponse(converted, convertedType, row.id, row.name, row.artist, meta);
      }
      return multiLyricsResponse(combined.karaoke, combined.synced, combined.plain, row.id, row.name, row.artist, meta);
    }
  }

  const lrclibData = await fetchFromLrcLib(track, artist, album);
  if (lrclibData && (lrclibData.syncedLyrics || lrclibData.plainLyrics)) {
    const rawLrc = lrclibData.syncedLyrics || lrclibData.plainLyrics;
    const foundType = detectType(rawLrc);
    const meta = {
      album: lrclibData.albumName || null,
      duration: lrclibData.duration || null,
      instrumental: lrclibData.instrumental || false
    };
    const lyricsId = await storeLyrics(track, artist, rawLrc, foundType, meta, env);
    const combined = await readCombined(lyricsId, env);
    if (reqType) {
      const lyrics = combined[reqType] || combined.synced || combined.plain;
      const type = pickType(combined);
      const [converted, convertedType] = convertLyrics(lyrics, type, reqType);
      return singleLyricsResponse(converted, convertedType, lyricsId, track, artist, meta);
    }
    return multiLyricsResponse(combined.karaoke, combined.synced, combined.plain, lyricsId, track, artist, meta);
  }

  const data = await fetchFromUpstream(track, artist, env, reqType, album, duration);
  if (!data) return errorResponse('Lyrics not found', 404);

  if (data.karaoke) data.karaoke = sanitizeLyrics(data.karaoke);
  if (data.synced) data.synced = sanitizeLyrics(data.synced);
  if (data.plain) data.plain = sanitizeLyrics(data.plain);

  const meta = await fetchTrackMetadata(track, artist);

  if (reqType) {
    const lyricsId = await storeLyrics(track, artist, data.lyrics, reqType, meta, env);
    return singleLyricsResponse(data.lyrics, reqType, lyricsId, track, artist, meta);
  }

  const bestType = data.karaoke ? 'karaoke' : data.synced ? 'synced' : 'plain';
  const bestLyrics = data.karaoke || data.synced || data.plain;
  if (!bestLyrics) return errorResponse('Lyrics not found', 404);

  const lyricsId = await storeLyrics(track, artist, bestLyrics, bestType, meta, env);
  return multiLyricsResponse(data.karaoke, data.synced, data.plain, lyricsId, track, artist, meta);
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
    if (isInstrumental(trackName) || item.instrumental) continue;

    const meta = {
      album: item.albumName || null,
      duration: item.duration || null,
      instrumental: item.instrumental || false
    };

    const row = await findInD1(trackName, artistName, env);
    if (row) {
      const combined = await readCombined(row.id, env);
      if (combined) {
        const payload = { id: row.id, name: row.name, artist: row.artist, ...combined, ...meta };
        await setCache(trackName, artistName, payload, env);
        finalResults.push({
          id: row.id, track: row.name, artist: row.artist,
          ...meta,
          lyrics: { plain: combined.plain || null, synced: combined.synced || null, karaoke: combined.karaoke || null }
        });
        continue;
      }
    }

    const rawLrc = item.syncedLyrics || item.plainLyrics;
    if (!rawLrc) continue;

    const foundType = detectType(rawLrc);
    const lyricsId = await storeLyrics(trackName, artistName, rawLrc, foundType, meta, env);

    const combined = await readCombined(lyricsId, env);
    finalResults.push({
      id: lyricsId, track: trackName, artist: artistName,
      ...meta,
      lyrics: { plain: combined?.plain || null, synced: combined?.synced || null, karaoke: combined?.karaoke || null }
    });
  }

  return jsonResponse({
    results: finalResults,
    total: finalResults.length,
    limit
  });
}

async function recheckTrack(track, artist, env) {
  if (isInstrumental(track)) return;

  const cacheKey = `lyrics:${track.toLowerCase()}:${artist.toLowerCase()}`;
  const cached = await env.KV_CACHE.get(cacheKey, 'json');
  if (cached?.karaoke && cached?.synced && cached?.plain) return;
  if (cached?.karaokeCheckedAt && (Date.now() - cached.karaokeCheckedAt) < 86400000) return;

  const existing = await findInD1(track, artist, env);
  if (existing?.karaoke && existing?.synced && existing?.plain) return;

  if (cached) {
    cached.karaokeCheckedAt = Date.now();
    await env.KV_CACHE.put(cacheKey, JSON.stringify(cached), { expirationTtl: 86400 });
  }

  const data = await fetchFromUpstream(track, artist, env);
  if (!data) return;

  if (data.karaoke) data.karaoke = sanitizeLyrics(data.karaoke);
  if (data.synced) data.synced = sanitizeLyrics(data.synced);
  if (data.plain) data.plain = sanitizeLyrics(data.plain);

  const bestLyrics = data.karaoke || data.synced || data.plain;
  if (!bestLyrics) return;

  const lyricsId = await generateHash(track, artist);

  let combined = {};
  const existingR2 = await env.R2_BUCKET.get(`lyrics/${lyricsId}.json`);
  if (existingR2) combined = JSON.parse(await existingR2.text());
  if (data.karaoke) combined.karaoke = data.karaoke;
  if (data.synced) combined.synced = data.synced;
  if (data.plain) combined.plain = data.plain;

  await env.R2_BUCKET.put(`lyrics/${lyricsId}.json`, JSON.stringify(combined), {
    httpMetadata: { contentType: 'application/json' }
  });

  await env.D1_DB.prepare(
    'INSERT OR IGNORE INTO lyrics (id, name, artist, karaoke, synced, plain) VALUES (?, ?, ?, 0, 0, 0)'
  ).bind(lyricsId, track, artist).run();

  const colUpdates = [];
  if (data.karaoke) colUpdates.push('karaoke = 1');
  if (data.synced) colUpdates.push('synced = 1');
  if (data.plain) colUpdates.push('plain = 1');
  if (colUpdates.length) {
    await env.D1_DB.prepare(
      `UPDATE lyrics SET ${colUpdates.join(', ')} WHERE id = ?`
    ).bind(lyricsId).run();
  }

  await env.KV_CACHE.delete(cacheKey);
}

async function handleScheduled(event, env) {
  const { results } = await env.D1_DB.prepare(
    "SELECT DISTINCT name, artist FROM lyrics WHERE NOT (karaoke = 1 AND synced = 1 AND plain = 1)"
  ).all();

  let count = 0;
  for (const row of results) {
    if (count >= MAX_RECHECK_PER_CRON) break;
    if (isInstrumental(row.name)) continue;
    await recheckTrack(row.name, row.artist, env);
    await new Promise(r => setTimeout(r, 200));
    count++;
  }
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

    if (path.startsWith('/api/lyrics/') && method === 'GET') {
      const id = path.slice('/api/lyrics/'.length);
      if (!id) return errorResponse('Missing lyrics ID', 400);
      return handleGetLyrics(id, url, env);
    }

    if (path === '/api/lyrics' && method === 'GET') {
      const track = url.searchParams.get('track')?.trim() || '';
      const artist = url.searchParams.get('artist')?.trim() || '';
      if (track && artist) {
        ctx.waitUntil(recheckTrack(track, artist, env));
      }
      return handleGetLyrics(null, url, env);
    }

    if (path === '/api/search' && method === 'GET') {
      return handleSearch(request, url, env);
    }

    return errorResponse('Not found', 404);
  },
  async scheduled(event, env, ctx) {
    await handleScheduled(event, env);
  }
};
