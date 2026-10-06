import { upstreamTimeoutMs } from './config.js';
import { artistArray, featureDue } from './lyrics/document.js';
import { buildCombined } from './lyrics/format.js';
import { lookupKeys, stripSearchArtistPrefix } from './lyrics/normalize.js';
import { fetchFromUpstream } from './sources/upstream.js';
import { combinedForRow, purgeExpired, recordFeatureAttempt, storeCombined } from './storage/bodies.js';
import { missTtl, claimUpstream, clearFlag, failureState, getFlag, rememberFailure, setFlag } from './storage/flags.js';
import { lookupById, lookupByKeys, lookupByName } from './storage/metadata.js';

export async function recheckTrack(track, artists, env, targetId = null, deadline = Infinity) {
  artists = artistArray(artists);
  if (!artists.length) return;
  const keys = lookupKeys(track, artists);
  const primaryKey = keys[0];
  const row = (targetId && await lookupById(targetId, env)) || await lookupByKeys(keys, env) ||
    await lookupByName(track, artists[0], env);
  const combined = row && await combinedForRow(row, env);
  if (row?.instrumental || (combined?.karaoke && !featureDue(combined))) return;
  if (await failureState(primaryKey, env) || await getFlag(primaryKey, 'karaoke-miss', env)) return;
  const timeoutMs = Math.min(upstreamTimeoutMs, deadline - Date.now() - 2000);
  if (timeoutMs <= 0 || !(await claimUpstream(primaryKey, env))) return;
  try {
    const name = stripSearchArtistPrefix(row?.name || track, row?.artist || artists[0]);
    let result = await fetchFromUpstream(name, artists, env, timeoutMs);
    await rememberFailure(primaryKey, result, env);
    if (result.status === 'ok') {
      const stored = await storeCombined(name, row?.artist || artists[0], { ...buildCombined(null, result.lyrics), rich: result.rich },
        { ...row, id: row?.id, artists: combined?.artists || artists, instrumental: false }, env, keys);
      if (stored.rejected) {
        result = { status: 'retry', httpStatus: 503 };
        await rememberFailure(primaryKey, result, env);
        await recordFeatureAttempt(row, result, env);
      } else await clearFlag(primaryKey, 'miss', env);
    } else {
      if (result.status === 'miss') await setFlag(primaryKey, 'karaoke-miss', missTtl, env);
      await recordFeatureAttempt(row, result, env);
    }
  } finally { await clearFlag(primaryKey, 'inflight', env); }
}

export async function prefetchSearchKaraoke(results, env, deadline) {
  const seen = new Set();
  // Prefetch only the top two results, sequentially.
  for (const result of results.slice(0, 2)) {
    if (Date.now() >= deadline - 2000) break;
    if (result.instrumental || result.lyrics.karaoke || seen.has(result.id)) continue;
    seen.add(result.id);
    try {
      await recheckTrack(stripSearchArtistPrefix(result.track, result.artist[0]),
        result.artist, env, result.id, deadline);
    } catch {
      // A background upgrade failure must not prevent upgrading the next result.
    }
  }
}

export async function handleScheduled(event, env, ctx) {
    await purgeExpired(env);
    const { results } = await env.D1_DB.prepare(
      `SELECT id, name, artist FROM lyrics WHERE instrumental = 0 AND karaoke = 1 AND
       NOT EXISTS (SELECT 1 FROM flags WHERE flags.key = lyrics.id AND kind = 'features' AND expires_at > ?)
       LIMIT 50`
    ).bind(Date.now()).all();
    for (const row of results || []) await recheckTrack(row.name, [row.artist], env, row.id);
}
