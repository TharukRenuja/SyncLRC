import { artistArray } from '../lyrics/document.js';
import { generateHash, lookupKeys, searchAltId, stripSearchArtistPrefix, unique } from '../lyrics/normalize.js';
import { prefetchSearchKaraoke } from '../refresh.js';
import { searchLrcLib } from '../sources/lrclib.js';
import { readCombined, storeSearchHits } from '../storage/bodies.js';
import { persistSearchMetadata } from '../storage/metadata.js';
import { errorResponse, jsonResponse } from './response.js';

export const searchBackgroundBudgetMs = 25000;

export async function handleSearch(request, url, env, ctx) {
  const query = url.searchParams.get('q')?.trim() || '';
  const limit = Number(url.searchParams.get('limit') ?? '10');
  const offset = Number(url.searchParams.get('offset') ?? '0');

  if (!query) return errorResponse("Missing 'q' parameter");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
      !Number.isInteger(offset) || offset < 0 || offset > 1000) {
    return errorResponse('limit must be an integer from 1 to 50; offset from 0 to 1000.', 400);
  }

  const results = await searchLrcLib(query);
  const picks = [];

  for (const item of results.slice(offset)) {
    if (picks.length >= limit) break;

    const trackName = item.trackName;
    const artistName = item.artistName;
    if (!trackName || !artistName) continue;
    if (item.instrumental) continue;
    const canonicalTrack = stripSearchArtistPrefix(trackName, artistName);

    picks.push({
      id: await generateHash(trackName, artistName),
      altId: await searchAltId(trackName, artistName),
      keys: unique([
        ...lookupKeys(trackName, [artistName]),
        ...lookupKeys(canonicalTrack, [artistName])
      ]),
      track: trackName,
      canonicalTrack,
      artist: artistName,
      album: item.albumName || null,
      duration: item.duration || null,
      plain: item.plainLyrics || null,
      synced: item.syncedLyrics || null
    });
  }

  // Resolve known identities from D1 and load any cached karaoke bodies from R2.
  const karaokeById = new Map();
  const artistsById = new Map();
  const karaokeAvailable = new Set();
  const knownByKey = new Map();
  if (picks.length) {
    const ids = [...new Set(picks.flatMap(p => (p.altId && p.altId !== p.id ? [p.id, p.altId] : [p.id])))];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const placeholders = chunk.map(() => '?').join(',');
      const { results: rows } = await env.D1_DB.prepare(
        `SELECT id FROM lyrics WHERE id IN (${placeholders}) AND karaoke = 1`
      ).bind(...chunk).all();
      for (const row of rows || []) karaokeAvailable.add(row.id);
    }

    const keys = unique(picks.flatMap(p => p.keys));
    for (let i = 0; i < keys.length; i += 50) {
      const chunk = keys.slice(i, i + 50);
      const placeholders = chunk.map(() => '?').join(',');
      const { results: rows } = await env.D1_DB.prepare(
        `SELECT keys.key, lyrics.id, lyrics.karaoke
         FROM keys JOIN lyrics ON lyrics.id = keys.lyric_id
         WHERE keys.key IN (${placeholders})`
      ).bind(...chunk).all();
      for (const row of rows || []) {
        knownByKey.set(row.key, row.id);
        if (row.karaoke) karaokeAvailable.add(row.id);
      }
    }

    const idsToRead = unique([...karaokeAvailable]);
    const bodies = await Promise.all(idsToRead.map(async id => [id, await readCombined(id, env)]));
    for (const [id, body] of bodies) {
      if (body?.karaoke) karaokeById.set(id, body.karaoke);
      if (body?.artists) artistsById.set(id, body.artists);
    }
  }

  const finalResults = picks.map(pick => {
    const keyId = pick.keys.map(key => knownByKey.get(key)).find(Boolean);
    const id = keyId || pick.id;
    return {
      id,
      track: pick.track,
      artist: artistArray(artistsById.get(id) || pick.artist),
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

  // Store permanent metadata in D1 and lyric bodies in R2 for fast follow-up fetches.
  const searchHits = picks.flatMap((pick, i) => {
    const result = finalResults[i];
    const keys = pick.keys;
    if (pick.keys.some(key => knownByKey.has(key))) return [];
    return [{ id: result.id, track: pick.canonicalTrack, artist: pick.artist,
      album: pick.album, duration: pick.duration, plain: pick.plain,
      synced: pick.synced, keys }];
  });
  if (finalResults.length) {
    const deadline = Date.now() + searchBackgroundBudgetMs;
    ctx.waitUntil((async () => {
      if (searchHits.length) {
        await persistSearchMetadata(searchHits, env);
        await storeSearchHits(searchHits, env);
      }
      await prefetchSearchKaraoke(finalResults, env, deadline);
    })());
  }

  return jsonResponse({
    results: finalResults,
    total: finalResults.length,
    limit
  }, 200, 'public, max-age=600');
}
