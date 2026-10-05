import { unique } from '../lyrics/normalize.js';

export const LYRIC_COLUMNS = 'id, isrc, name, artist, album, duration, instrumental, karaoke, synced, plain';

export function legacyFallbacksEnabled(env) {
  return env?.LEGACY_FALLBACKS === '1' || env?.LEGACY_FALLBACKS === 'true';
}

export async function lookupById(id, env) {
  return await env.D1_DB.prepare(
    `SELECT ${LYRIC_COLUMNS} FROM lyrics WHERE id = ?`
  ).bind(id).first().catch(() => null) || null;
}

export async function lookupByKeys(keys, env) {
  if (!keys.length) return null;
  const placeholders = keys.map(() => '?').join(',');
  const row = await env.D1_DB.prepare(
    `SELECT ${LYRIC_COLUMNS}
     FROM keys JOIN lyrics ON lyrics.id = keys.lyric_id
     WHERE keys.key IN (${placeholders})
     LIMIT 1`
  ).bind(...keys).first().catch(() => null);
  if (row || !legacyFallbacksEnabled(env)) return row || null;
  return await env.D1_DB.prepare(
    `SELECT tracks.* FROM track_keys JOIN tracks ON tracks.id = track_keys.track_id
     WHERE track_keys.key IN (${placeholders}) LIMIT 1`
  ).bind(...keys).first().catch(() => null) || null;
}

export async function lookupRequestMetadata(keys, name, artist, env) {
  if (legacyFallbacksEnabled(env)) {
    return await lookupByKeys(keys, env) || await lookupByName(name, artist, env);
  }
  const placeholders = keys.map(() => '?').join(',');
  return await env.D1_DB.prepare(
    `SELECT ${LYRIC_COLUMNS} FROM lyrics WHERE id IN (
       SELECT lyric_id FROM keys WHERE key IN (${placeholders})
     )
     UNION ALL
     SELECT ${LYRIC_COLUMNS} FROM lyrics WHERE name = ? AND artist = ?
     LIMIT 1`
  ).bind(...keys, name, artist).first();
}

export async function lookupIdentityByKeys(keys, env) {
  return await lookupByKeys(keys, env);
}

export async function lookupIdentityByIsrc(isrc, env) {
  if (!isrc) return null;
  const row = await env.D1_DB.prepare(
    `SELECT ${LYRIC_COLUMNS} FROM lyrics WHERE isrc = ?`
  ).bind(isrc).first().catch(() => null);
  if (row || !legacyFallbacksEnabled(env)) return row || null;
  return await env.D1_DB.prepare(
    'SELECT id, name, artist, duration, isrc FROM track_ids WHERE isrc = ?'
  ).bind(isrc).first().catch(() => null) || null;
}

export async function lookupIdentityById(id, env) {
  return await env.D1_DB.prepare(
    `SELECT ${LYRIC_COLUMNS} FROM lyrics WHERE id = ?`
  ).bind(id).first().catch(() => null) || null;
}

export async function lookupByName(name, artist, env) {
  const row = await env.D1_DB.prepare(
    `SELECT ${LYRIC_COLUMNS} FROM lyrics WHERE name = ? AND artist = ?`
  ).bind(name, artist).first().catch(() => null);
  if (row || !legacyFallbacksEnabled(env)) return row || null;
  return await env.D1_DB.prepare(
    'SELECT * FROM tracks WHERE name = ? AND artist = ?'
  ).bind(name, artist).first().catch(() => null) || null;
}

export async function lookupLegacyById(id, env) {
  if (!legacyFallbacksEnabled(env)) return null;
  return await env.D1_DB.prepare('SELECT * FROM tracks WHERE id = ?')
    .bind(id).first().catch(() => null) || null;
}

export async function rememberKeys(id, keys, env, { replace = false } = {}) {
  const clean = unique(keys);
  if (!clean.length) return;
  const verb = replace ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  await env.D1_DB.batch(clean.map(key =>
    env.D1_DB.prepare(`${verb} INTO keys (key, lyric_id) VALUES (?, ?)`).bind(key, id)
  ));
}

export async function persistSearchMetadata(hits, env) {
  if (!hits.length) return;
  const statements = [];
  for (const hit of hits) {
    statements.push(env.D1_DB.prepare(
      `INSERT INTO lyrics (id, isrc, name, artist, album, duration, instrumental, karaoke, synced, plain)
       VALUES (?, NULL, ?, ?, ?, ?, 0, 0, 0, 0)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         artist = excluded.artist,
         album = COALESCE(excluded.album, lyrics.album),
         duration = COALESCE(excluded.duration, lyrics.duration)`
    ).bind(hit.id, hit.track, hit.artist, hit.album || null, hit.duration ?? null));
    for (const key of hit.keys) {
      statements.push(env.D1_DB.prepare(
        'INSERT OR IGNORE INTO keys (key, lyric_id) VALUES (?, ?)'
      ).bind(key, hit.id));
    }
  }
  await env.D1_DB.batch(statements);
}

// Purge transient lyrics.
