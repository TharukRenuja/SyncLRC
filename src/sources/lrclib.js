import { UA, upstreamTimeoutMs } from '../config.js';
import { isRelevant, matchScore } from '../lyrics/match.js';

export async function fetchFromLrcLib(track, artists, albumName, duration) {
  let failed = false;
  for (const artist of artists) {
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
    if (albumName) url += `&album_name=${encodeURIComponent(albumName)}`;
    if (duration) url += `&duration=${encodeURIComponent(duration)}`;
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(upstreamTimeoutMs) });
      if (resp.status !== 200) { if (resp.status !== 404) failed = true; continue; }
      const data = await resp.json();
      if ((data.syncedLyrics || data.plainLyrics || data.instrumental) &&
          isRelevant(track, artists, data.trackName, data.artistName)) return data;
    } catch { failed = true; }
  }
  // Search only after exact lookups fail; validate every result before using it.
  const tokens = track.trim().split(/\s+/);
  const query = tokens.length > 1 ? tokens.slice(0, -1).join(' ') : track;
  const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(query)}`;
  // only repeated trailing vowels in longer words; no broad fuzzy-title matching.
  const title = value => value.replace(/\b([a-z]{3,})([aeiou])\2+\b/gi, '$1$2');
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(upstreamTimeoutMs) });
    if (resp.status !== 200) failed = true;
    else {
      const candidates = (await resp.json()).filter(data =>
        (data.syncedLyrics || data.plainLyrics || data.instrumental) &&
        isRelevant(title(track), artists, title(data.trackName || ''), data.artistName) &&
        (!duration || (Number.isFinite(Number(data.duration)) && Math.abs(Number(data.duration) - Number(duration)) <= 8)) &&
        (!albumName || data.albumName?.trim().toLowerCase() === albumName.trim().toLowerCase()));
      candidates.sort((a, b) =>
        matchScore(track, artists, b.trackName, b.artistName) - matchScore(track, artists, a.trackName, a.artistName) ||
        Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics));
      if (candidates.length) return candidates[0];
    }
  } catch { failed = true; }
  return failed ? { sourceFailed: true } : null;
}

export async function searchLrcLib(query) {
  const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(upstreamTimeoutMs) });
    if (resp.status !== 200) return [];
    return await resp.json();
  } catch {
    return [];
  }
}
