import { UA, UPSTREAM_TIMEOUT_MS } from '../config.js';
import { isRelevant } from '../lyrics/match.js';

export async function fetchFromLrcLib(track, artists, albumName, duration) {
  let failed = false;
  for (const artist of artists) {
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
    if (albumName) url += `&album_name=${encodeURIComponent(albumName)}`;
    if (duration) url += `&duration=${encodeURIComponent(duration)}`;
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (resp.status !== 200) { if (resp.status !== 404) failed = true; continue; }
      const data = await resp.json();
      if (isRelevant(track, artists, data.trackName, data.artistName)) return data;
    } catch { failed = true; }
  }
  return failed ? { sourceFailed: true } : null;
}

export async function searchLrcLib(query) {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (resp.status !== 200) return [];
    return await resp.json();
  } catch {
    return [];
  }
}
