import { UA, UPSTREAM_TIMEOUT_MS } from '../config.js';
import { isRelevant } from '../lyrics/match.js';
import { normalizeIsrc } from '../lyrics/normalize.js';

export async function fetchDeezerMeta(track, artists, albumName, duration) {
  const durationSeconds = duration ? Number(duration) : null;

  for (const artist of artists) {
    const query = `artist:"${artist}" track:"${track}"`;
    const url = `https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=5`;
    let data;
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
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
          const resp = await fetch(`https://api.deezer.com/track/${item.id}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
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

// Upstream: 200 found, 404 confirmed miss, 504 timeout; (older deployments use `karaoke`).
