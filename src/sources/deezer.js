import { UA, upstreamTimeoutMs } from '../config.js';
import { isRelevant } from '../lyrics/match.js';
import { normalizeIsrc, normalizeKey } from '../lyrics/normalize.js';

export async function fetchDeezerMeta(track, artists, albumName, duration) {
  const durationSeconds = duration ? Number(duration) : null;
  let failed = false;
  const signal = AbortSignal.timeout(upstreamTimeoutMs);

  for (const artist of artists) {
    if (signal.aborted) { failed = true; break; }
    const query = `${artist} ${track}`;
    const url = `https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=5`;
    let data;
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal });
      if (resp.status !== 200) { failed = true; continue; }
      data = await resp.json();
      if (data.error) { failed = true; continue; }
    } catch {
      failed = true;
      continue;
    }

    for (const item of data?.data || []) {
      const itemTrack = item?.title_short || item?.title;
      const itemArtist = item?.artist?.name;
      if (!recordingMatches(track, artists, item.title || itemTrack, itemArtist)) continue;
      if (albumName && item.album?.title?.trim().toLowerCase() !== albumName.trim().toLowerCase()) continue;
      if (durationSeconds && item?.duration && Math.abs(Number(item.duration) - durationSeconds) > 8) continue;

      let full = item;
      if (!full?.isrc && item?.id) {
        try {
          const resp = await fetch(`https://api.deezer.com/track/${item.id}`, { headers: { 'User-Agent': UA }, signal });
          if (resp.status === 200) full = await resp.json();
          else failed = true;
        } catch { failed = true; }
      }

      if (full?.error) { failed = true; continue; }
      const isrc = normalizeIsrc(full?.isrc);
      if (!isrc) continue;
      if (!recordingMatches(track, artists, full?.title || itemTrack, full?.artist?.name || itemArtist)) continue;
      if (durationSeconds && full?.duration && Math.abs(Number(full.duration) - durationSeconds) > 8) continue;
      return {
        isrc,
        track: full?.title || full?.title_short || item.title || itemTrack || track,
        artist: full?.artist?.name || itemArtist || artist,
        album: full?.album?.title || albumName || null,
        duration: full?.duration || item?.duration || durationSeconds || null
      };
    }
  }

  return failed ? { sourceFailed: true } : null;
}

// Distinguish recordings whose titles explicitly identify a different performance/edit.
function recordingMatches(track, artists, title, artist) {
  const versions = value => [...new Set(String(value || '').toLowerCase().match(/\b(?:remix|live|acoustic|instrumental|karaoke|demo|remaster(?:ed)?|sped|slowed)\b/g) || [])].sort().join(',');
  return isRelevant(track, artists, title, artist) && versions(track) === versions(title);
}

export function metadataMatches(row, result) {
  return !!result?.isrc && recordingMatches(row.name, [row.artist], result.track, result.artist) &&
    (!row.duration || Math.abs(Number(row.duration) - Number(result.duration)) <= 8) &&
    (!row.album || row.album.trim().toLowerCase() === result.album?.trim().toLowerCase());
}

export function startMetadata(row, track, artists, album, duration, env) {
  if (row?.isrc || row?.metadata === -1 || row?.metadata > Date.now()) return Promise.resolve(undefined);
  return (async () => {
    if (row) {
      const claim = await env.D1_DB.prepare(
        'UPDATE lyrics SET metadata = ? WHERE id = ? AND metadata >= 0 AND metadata <= ?'
      ).bind(Date.now() + 60000, row.id, Date.now()).run();
      if (!claim.meta?.changes) return undefined;
    }
    if (!row) {
      const now = Date.now();
      const claim = await env.D1_DB.prepare(`INSERT INTO flags (key, kind, expires_at) VALUES (?, 'metadata', ?)
        ON CONFLICT(key, kind) DO UPDATE SET expires_at = excluded.expires_at WHERE flags.expires_at <= ?`)
        .bind(normalizeKey(track, artists[0]), now + 60000, now).run();
      if (!claim.meta?.changes) return undefined;
    }
    return fetchDeezerMeta(track, artists, album, duration);
  })().catch(() => ({ sourceFailed: true }));
}

export async function enrichMetadata(id, promise, env) {
  try {
    const result = await promise;
    if (result === undefined) return;
    const row = await env.D1_DB.prepare('SELECT id, isrc, name, artist, album, duration FROM lyrics WHERE id = ?').bind(id).first();
    if (!row) return;
    if (result?.sourceFailed) {
      await env.D1_DB.prepare('UPDATE lyrics SET metadata = ? WHERE id = ? AND metadata <> -1')
        .bind(Date.now() + 300000, id).run();
      return;
    }
    const valid = metadataMatches(row, result);
    if (!valid) {
      await env.D1_DB.prepare('UPDATE lyrics SET metadata = -1 WHERE id = ?').bind(id).run();
      return;
    }
    // A conflicting ISRC leaves the returned identity and its lyrics untouched.
    await env.D1_DB.prepare(`UPDATE lyrics SET metadata = -1,
      isrc = CASE WHEN NOT EXISTS (SELECT 1 FROM lyrics AS other WHERE other.isrc = ? AND other.id <> ?)
        THEN COALESCE(isrc, ?) ELSE isrc END,
      album = COALESCE(album, ?), duration = COALESCE(duration, ?)
      WHERE id = ?`).bind(result.isrc, id, result.isrc, result.album, result.duration, id).run();
  } catch {
    // Enrichment failure must not fail an already served lyric response.
  }
}
