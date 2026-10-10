import { applyDocument, nextFeatureCheck } from '../lyrics/document.js';
import { lyricsAgree } from '../lyrics/match.js';
import { convertLyrics } from '../lyrics/format.js';
import { generateHash, lookupKeys, normalizeIsrc, unique } from '../lyrics/normalize.js';
import { sanitizeLyrics } from '../lyrics/sanitize.js';
import { setFlag } from './flags.js';
import { lookupById, lookupIdentityByIsrc } from './metadata.js';

export const retentionDays = 1;

export async function recordFeatureAttempt(row, result, env) {
  if (!row) return;
  const current = await readCombined(row.id, env);
  if (!current) return;
  const included = current.rich?.included || [];
  const missing = ['agents', 'background'].filter(feature => !included.includes(feature));
  const updated = { ...current, rich: { ...current.rich, checkedAt: Date.now(), included,
    unavailable: result.status === 'miss' ? missing : [],
    unknown: result.status === 'miss' ? [] : missing } };
  await env.R2_BUCKET.put(`lyrics/${row.id}.json`, JSON.stringify(updated), {
    httpMetadata: { contentType: 'application/json' }
  });
  await recordFeatures(row.id, updated, env);
}

export async function recordFeatures(id, combined, env) {
  if (combined.rich) await setFlag(id, 'features', Math.max(1, (nextFeatureCheck(combined.rich) - Date.now()) / 1000), env);
}

// Claim the next upstream fetch so bursts do not fan out.

export async function readCombined(id, env) {
  const obj = await env.R2_BUCKET.get(`lyrics/${id}.json`);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

export async function combinedForRow(row, env) {
  const fromR2 = await readCombined(row.id, env);
  if (fromR2) return fromR2;

  return { karaoke: null, synced: null, plain: null };
}

export async function storeCombined(track, artist, combined, meta, env, keys = []) {
  const isrc = normalizeIsrc(meta?.isrc);
  const identity = meta?.id ? { id: meta.id } : await lookupIdentityByIsrc(isrc, env);
  const id = identity?.id || meta?.id || await generateHash(track, artist);
  const allKeys = unique([...(keys.length ? keys : []), ...lookupKeys(track, [artist])]);
  const existing = await lookupById(id, env);
  const oldCombined = existing ? await combinedForRow(existing, env) : {};
  const reference = oldCombined.plain || combined.plain;
  const candidate = applyDocument({ ...combined }, combined.rich || meta?.rich);
  const rejected = !!candidate.karaoke && !lyricsAgree(reference, candidate.karaoke);
  if (rejected) combined = { plain: reference, synced: oldCombined.synced };
  let merged = {
    ...oldCombined,
    karaoke: combined.karaoke || oldCombined.karaoke || null,
    synced: combined.synced || oldCombined.synced || null,
    plain: oldCombined.plain || combined.plain || null
  };

  merged = applyDocument(merged, rejected ? null : combined.rich || meta?.rich);
  if (merged.karaoke) {
    const [synced] = convertLyrics(merged.karaoke, 'karaoke', 'synced');
    const [plain] = convertLyrics(merged.karaoke, 'karaoke', 'plain');
    merged.synced = sanitizeLyrics(synced) || null;
    merged.plain ||= sanitizeLyrics(plain) || null;
  }
  if (rejected) merged.rich = oldCombined.rich || null;
  const instrumental = meta?.instrumental ? 1 : 0;
  const album = meta?.album ?? existing?.album ?? null;
  const duration = meta?.duration ?? existing?.duration ?? null;

  if (!instrumental) {
    await env.R2_BUCKET.put(`lyrics/${id}.json`, JSON.stringify(merged), {
      httpMetadata: { contentType: 'application/json' }
    });
  }

  const metadataStatement = env.D1_DB.prepare(
    `INSERT INTO lyrics (id, isrc, name, artist, album, duration, instrumental, karaoke, synced, plain)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isrc = COALESCE(lyrics.isrc, excluded.isrc),
       name = excluded.name,
       artist = excluded.artist,
       album = COALESCE(excluded.album, lyrics.album),
       duration = COALESCE(excluded.duration, lyrics.duration),
       instrumental = excluded.instrumental,
       karaoke = excluded.karaoke,
       synced = excluded.synced,
       plain = excluded.plain`
   ).bind(
    id, isrc, track, artist, album, duration, instrumental,
    merged.karaoke ? 1 : 0, merged.synced ? 1 : 0, merged.plain ? 1 : 0
  );

  const verb = identity ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  await env.D1_DB.batch([metadataStatement, ...allKeys.map(key =>
    env.D1_DB.prepare(`${verb} INTO keys (key, lyric_id) VALUES (?, ?)`).bind(key, id)
  )]);

  await recordFeatures(id, merged, env);
  return { id, merged, rejected };
}

// Save search bodies after their metadata.

// Search updates only fill missing fields; conditional writes preserve concurrent upgrades.
async function saveSearchBody(id, additions, env, deadline) {
  const key = `lyrics/${id}.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() >= deadline - 2000) throw new Error('Search save deadline reached');
    const obj = await env.R2_BUCKET.get(key);
    const existing = obj ? JSON.parse(await obj.text()) : {};
    const combined = { ...existing };
    for (const [type, lyrics] of Object.entries(additions)) {
      if (lyrics) combined[type] ||= lyrics;
    }
    if (obj && JSON.stringify(combined) === JSON.stringify(existing)) return combined;
    try {
      const saved = await env.R2_BUCKET.put(key, JSON.stringify(combined), {
        onlyIf: obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' }
      });
      if (saved) return combined;
    } catch (error) {
      if (!String(error?.message || error).includes('10058')) throw error;
      if (attempt === 2) throw error;
    }
    if (attempt < 2) {
      const delay = 1100 * (attempt + 1) + Math.random() * 200;
      if (Date.now() + delay >= deadline - 2000) throw new Error('Search save deadline reached');
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Search body changed during every save attempt');
}

export async function storeSearchHits(hits, env, deadline = Date.now() + 20000) {
  const byId = new Map();
  for (const hit of hits) {
    const current = byId.get(hit.id) || { ...hit, keys: [] };
    current.keys = unique([...current.keys, ...hit.keys]);
    current.synced ||= hit.synced;
    current.plain ||= hit.plain;
    byId.set(hit.id, current);
  }

  const pending = byId.values();
  const save = async () => {
    for (const hit of pending) {
      if (Date.now() >= deadline - 2000) break;
      try {
        const combined = await saveSearchBody(hit.id, {
          synced: hit.synced ? sanitizeLyrics(hit.synced) : null,
          plain: hit.plain ? sanitizeLyrics(hit.plain) : null
        }, env, deadline);
        await env.D1_DB.prepare(
          'UPDATE lyrics SET karaoke = MAX(karaoke, ?), synced = MAX(synced, ?), plain = MAX(plain, ?) WHERE id = ?'
        ).bind(combined.karaoke ? 1 : 0, combined.synced ? 1 : 0,
          combined.plain ? 1 : 0, hit.id).run();
      } catch (error) {
        console.warn('Search save failed', { id: hit.id, error: String(error?.message || error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, byId.size) }, save));
}

export async function purgeExpired(env) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let cursor;
  let deletedObjects = 0;
  do {
    const page = await env.R2_BUCKET.list({ prefix: 'lyrics/', limit: 1000, cursor });
    const expired = (page.objects || []).filter(obj =>
      obj.uploaded && obj.uploaded.getTime() < cutoff);
    if (expired.length) {
      await env.R2_BUCKET.delete(expired.map(obj => obj.key));
      deletedObjects += expired.length;
      const ids = expired.map(obj => obj.key.match(/^lyrics\/([^/]+)\.json$/)?.[1]).filter(Boolean);
      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        const placeholders = chunk.map(() => '?').join(',');
        await env.D1_DB.prepare(
          `UPDATE lyrics SET karaoke = 0, synced = 0, plain = 0 WHERE id IN (${placeholders})`
        ).bind(...chunk).run();
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  await env.D1_DB.prepare(
    'DELETE FROM flags WHERE expires_at < ?'
  ).bind(Date.now()).run();

  return { objects: deletedObjects };
}
