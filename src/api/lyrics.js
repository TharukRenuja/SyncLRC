import { artistArray, featureDue } from '../lyrics/document.js';
import { buildCombined, convertLyrics } from '../lyrics/format.js';
import { lookupKeys, stripSearchArtistPrefix, unique } from '../lyrics/normalize.js';
import { lyricOptions } from '../lyrics/options.js';
import { sanitizeLyrics } from '../lyrics/sanitize.js';
import { recheckTrack } from '../refresh.js';
import { fetchDeezerMeta } from '../sources/deezer.js';
import { fetchFromLrcLib } from '../sources/lrclib.js';
import { fetchFromUpstream } from '../sources/upstream.js';
import { combinedForRow, readCombined, recordFeatureAttempt, storeCombined } from '../storage/bodies.js';
import { missTtl, claimUpstream, clearFlag, failureState, getFlag, rememberFailure, setFlag } from '../storage/flags.js';
import { lookupById, lookupIdentityByIsrc, lookupRequestMetadata, rememberKeys } from '../storage/metadata.js';
import { buildResponse, errorResponse, sourceFailureResponse } from './response.js';

export const inlineBudget = 2000;

// Keep feature refreshes within the same inline budget as karaoke upgrades.
async function withinBudget(task, fallback) {
  let timer;
  try {
    return await Promise.race([task, new Promise(resolve => {
      timer = setTimeout(() => resolve(fallback), inlineBudget);
    })]);
  } finally { clearTimeout(timer); }
}

export async function handleLyricsRequest(id, url, env, ctx) {
  let options;
  try {
    options = lyricOptions(url);
  } catch (error) {
    return errorResponse(error.message, 400);
  }
  return handleGetLyrics(id, url, env, ctx, options);
}

export async function handleGetLyrics(id, url, env, ctx, options = null) {
  const respond = async (combined, type, id, track, artist, meta, state = {}) => {
    const keys = unique([...lookupKeys(track, combined.artists || [artist]),
      ...lookupKeys(url.searchParams.get('track') || track, url.searchParams.getAll('artist'))]);
    const active = !state.upstreamSettled && !combined.karaoke && !meta?.instrumental && (await Promise.all(keys.map(async key =>
      await getFlag(key, 'inflight', env) && !(await failureState(key, env)) &&
      !(await getFlag(key, 'karaoke-miss', env))))).some(Boolean);
    return buildResponse(combined, type, id, track, artist, meta,
      { ...state, karaokePending: active, options });
  };
  const refresh = async (row, combined, artists) => {
    if (row.instrumental || !(combined.karaoke || combined.synced || combined.plain) || !featureDue(combined)) return combined;
    const task = recheckTrack(row.name, artists, env, row.id).catch(() => {});
    if (options?.hasInclude && featureDue(combined, options.requested)) {
      ctx.waitUntil(task);
      if (await withinBudget(task.then(() => true), false)) return await readCombined(row.id, env) || combined;
      return combined;
    }
    ctx.waitUntil(task);
    return combined;
  };
  const track = url.searchParams.get('track')?.trim() || '';
  // Repeatable: artist=A&artist=B; first is primary, all are used for matching.
  const artists = url.searchParams.getAll('artist').map(a => a.trim()).filter(Boolean);
  const artist = artists[0] || '';
  const reqType = url.searchParams.get('type')?.trim() || null;

  if (id) {
    const row = await lookupById(id, env);
    const identity = row;
    if (!row && !identity) return errorResponse('Lyrics with provided ID not found', 404);

    if (row.instrumental) {
      return respond({ karaoke: null, synced: null, plain: null }, reqType, id,
        row.name, row.artist,
        { album: row.album, duration: row.duration, instrumental: true });
    }

    let combined = row ? await combinedForRow(row, env) : { karaoke: null, synced: null, plain: null };
    if (row) combined = await refresh(row, combined, combined.artists || [row.artist]);
    if (combined.karaoke || combined.synced || combined.plain) {
      const trackName = stripSearchArtistPrefix(row.name, row.artist);
      const meta = { album: row.album, duration: row.duration, instrumental: !!row.instrumental };
      const pending = !combined.karaoke;
      return respond(combined, reqType, id, trackName, row.artist, meta, { pending });
    }

    const sourceName = stripSearchArtistPrefix(row?.name || identity.name, row?.artist || identity.artist);
    const sourceArtist = row?.artist || identity.artist;
    const result = await buildFromSources(sourceName, [sourceArtist], row?.album || null, row?.duration || identity.duration, env, {
      id,
      isrc: identity?.isrc || null,
      keys: lookupKeys(sourceName, [sourceArtist]),
      ctx, options
    });
    if (result.failure) return sourceFailureResponse(result.failure, result.httpStatus, result.retryAfter);
    if (result.pendingUpstream) ctx.waitUntil(result.pendingUpstream);

    const meta = {
      album: result.meta.album || row?.album || null,
      duration: result.meta.duration || row?.duration || identity?.duration || null,
      instrumental: result.instrumental || !!row?.instrumental
    };
    return respond(result.combined, reqType, id, result.track, result.artist, meta,
      { pending: !!result.pendingUpstream, upstreamSettled: result.upstreamSettled });
  }

  if (!track || !artist) {
    return errorResponse("Missing 'track' and 'artist' parameters (or 'id')");
  }

  const album = url.searchParams.get('album')?.trim() || null;
  const duration = url.searchParams.get('duration')?.trim() || null;
  const requestKeys = lookupKeys(track, artists);
  const primaryKey = requestKeys[0];

  const row = await lookupRequestMetadata(requestKeys, track, artist, env);

  if (row) {
    if (row.instrumental) {
      return respond({ karaoke: null, synced: null, plain: null }, reqType, row.id,
        row.name, row.artist,
        { album: row.album, duration: row.duration, instrumental: true });
    }
    let combined = await combinedForRow(row, env);
    combined = await refresh(row, combined, combined.artists || [row.artist]);
    if (combined.karaoke || combined.synced || combined.plain) {
      const trackName = stripSearchArtistPrefix(row.name, row.artist);
      const meta = { album: row.album, duration: row.duration, instrumental: !!row.instrumental };
      const pending = !combined.karaoke;
      return respond(combined, reqType, row.id, trackName, row.artist, meta, { pending });
    }
  }

  const identity = row;
  if (identity) {
    const result = await buildFromSources(identity.name, [identity.artist, ...artists], album, duration || identity.duration, env, {
      id: identity.id,
      isrc: identity.isrc,
      keys: requestKeys,
      ctx, options
    });
    if (result?.pendingUpstream) ctx.waitUntil(result.pendingUpstream);
    if (result.failure) return sourceFailureResponse(result.failure, result.httpStatus, result.retryAfter);
    if (result) {
      const meta = {
        album: result.meta.album,
        duration: result.meta.duration,
        instrumental: result.instrumental
      };
      return respond(result.combined, reqType, result.id, result.track, result.artist, meta,
        { pending: !!result.pendingUpstream, upstreamSettled: result.upstreamSettled });
    }
    return errorResponse('Lyrics not found', 404);
  }

  if (await getFlag(primaryKey, 'miss', env)) {
    return errorResponse('No matching song found for this track/artist.', 404);
  }

  const result = await buildFromSources(track, artists, album, duration, env, { keys: requestKeys, ctx, options });
  if (result?.pendingUpstream) ctx.waitUntil(result.pendingUpstream);

  if (result.failure) return sourceFailureResponse(result.failure, result.httpStatus, result.retryAfter);

  const meta = {
    album: result.meta.album,
    duration: result.meta.duration,
    instrumental: result.instrumental
  };
  return respond(result.combined, reqType, result.id, result.track, result.artist, meta,
    { pending: !!result.pendingUpstream, upstreamSettled: result.upstreamSettled });
}

export async function buildFromSources(track, artists, album, duration, env, identity = {}) {
  const artist = artists[0];
  const requestKeys = unique([...(identity.keys || []), ...lookupKeys(track, artists)]);
  const primaryKey = requestKeys[0];
  const lrclibPromise = fetchFromLrcLib(track, artists, album, duration);
  const deezerPromise = fetchDeezerMeta(track, artists, album, duration);
  const lrclibData = await lrclibPromise;
  let upstreamPromise = null;
  let upstreamSettled = false;
  const cachedFailure = await failureState(primaryKey, env);
  if (!cachedFailure && !lrclibData?.instrumental && await claimUpstream(primaryKey, env)) {
    upstreamPromise = fetchFromUpstream(track, artists, env).then(result => {
      upstreamSettled = true;
      return result;
    });
  }
  const deezerMeta = await deezerPromise;
  const canonTrack = lrclibData?.trackName || deezerMeta?.track || track;
  const canonArtist = lrclibData?.artistName || deezerMeta?.artist || artist;
  const upstreamArtists = [...new Set([...artists, canonArtist])];
  const recordKeys = unique([...requestKeys, ...lookupKeys(canonTrack, upstreamArtists)]);
  const meta = {
    id: identity.id || null,
    isrc: deezerMeta?.isrc || identity.isrc || null,
    album: lrclibData?.albumName || deezerMeta?.album || album || null,
    duration: lrclibData?.duration || deezerMeta?.duration || (duration ? Number(duration) : null),
    artists: artistArray(lrclibData?.artistName || deezerMeta?.artist || artists, artists),
    instrumental: !!lrclibData?.instrumental
  };

  const isrcIdentity = await lookupIdentityByIsrc(meta.isrc, env);
  if (isrcIdentity) {
    meta.id = isrcIdentity.id;
    await rememberKeys(isrcIdentity.id, recordKeys, env, { replace: true });
    const existing = await lookupById(isrcIdentity.id, env);
    const existingCombined = existing && !existing.instrumental ? await combinedForRow(existing, env) :
      { karaoke: null, synced: null, plain: null };
    if (existing?.instrumental || existingCombined.karaoke || existingCombined.synced || existingCombined.plain) {
      let pendingUpstream = null;
      if (upstreamPromise) {
        const settle = (async () => {
          let status = 'retry';
      let failureHttpStatus = 503;
          try {
            const result = await upstreamPromise;
            status = result.status;
            if (status !== 'ok') await recordFeatureAttempt(existing, result, env);
            failureHttpStatus = result.httpStatus || 503;
            if (!existing?.instrumental && result.status === 'ok' && (!existingCombined.karaoke || featureDue(existingCombined))) {
              const combined = { ...buildCombined(null, result.lyrics), rich: result.rich };
              const stored = await storeCombined(isrcIdentity.name, isrcIdentity.artist, combined,
                { ...meta, id: isrcIdentity.id }, env, recordKeys);
              if (stored.rejected) {
                status = 'retry';
                await recordFeatureAttempt(existing, { status }, env);
              }
            }
          } finally {
            if (status === 'ok') {
              await clearFlag(primaryKey, 'inflight', env).catch(() => {});
            } else {
              await rememberFailure(primaryKey, { status, httpStatus: failureHttpStatus }, env);
          await clearFlag(primaryKey, 'inflight', env).catch(() => {});
            }
          }
        })();
        if (identity.options?.hasInclude && featureDue(existingCombined, identity.options.requested)) {
          identity.ctx.waitUntil(settle);
          if (await withinBudget(settle.then(() => true), false)) Object.assign(existingCombined, await readCombined(isrcIdentity.id, env));
          else if (!existing?.instrumental && !existingCombined.karaoke) pendingUpstream = settle;
        } else {
          identity.ctx.waitUntil(settle);
          if (!existing?.instrumental && !existingCombined.karaoke) pendingUpstream = settle;
        }
      }
      return {
        id: isrcIdentity.id,
        track: existing?.name || isrcIdentity.name,
        artist: existing?.artist || isrcIdentity.artist,
        instrumental: !!existing?.instrumental,
        combined: existingCombined,
        meta: {
          album: existing?.album || meta.album,
          duration: existing?.duration || isrcIdentity.duration || meta.duration
        },
        pendingUpstream, upstreamSettled
      };
    }
  }

  if (lrclibData?.instrumental) {
    const stored = await storeCombined(canonTrack, canonArtist, { karaoke: null, synced: null, plain: null },
      meta, env, recordKeys);
    await clearFlag(primaryKey, 'miss', env);
    return {
      id: stored.id,
      track: canonTrack, artist: canonArtist, instrumental: true,
      combined: { karaoke: null, synced: null, plain: null },
      meta,
      pendingUpstream: null
    };
  }

  // Answer from LRCLib while karaoke upgrades in the background.
  const haveLrc = !!(lrclibData && (lrclibData.syncedLyrics || lrclibData.plainLyrics));

  // Only the claim winner hits the upstream; others return pending.
  let timedOut = false;
  let upstream = cachedFailure || { status: 'skipped' };
  if (upstreamPromise) {
    if (haveLrc) {
      let timer;
      const budget = new Promise(resolve => {
        timer = setTimeout(() => { timedOut = true; resolve({ status: 'retry' }); }, inlineBudget);
      });
      try {
        upstream = await Promise.race([upstreamPromise, budget]);
      } finally {
        clearTimeout(timer);
      }
    } else {
      // Without LRCLib lyrics, wait for upstream instead of returning a false miss.
      upstream = await upstreamPromise;
    }
  }

  const karaokeLyrics = upstream.status === 'ok' ? upstream.lyrics : null;
  const combined = buildCombined(lrclibData, karaokeLyrics);
  if (combined.karaoke && upstream.rich) combined.rich = upstream.rich;

  if (!combined.karaoke && !combined.synced && !combined.plain) {
    // Only 404 is a cacheable miss; 504 may succeed later.
    const confirmedMiss = upstream.status === 'miss' && !lrclibData?.sourceFailed;
    if (confirmedMiss) await setFlag(primaryKey, 'miss', missTtl, env);
    // Back off on failure to avoid immediate retries.
    if (upstreamPromise && upstream.status !== 'ok') {
      await rememberFailure(primaryKey, upstream, env);
      await clearFlag(primaryKey, 'inflight', env);
    }
    return { failure: confirmedMiss ? 'miss' : 'retry', httpStatus: upstream.httpStatus || 503, retryAfter: upstream.retryAfter };
  }

  const { id, merged, rejected } = await storeCombined(canonTrack, canonArtist, combined, meta, env, recordKeys);
  if (rejected) {
    await rememberFailure(primaryKey, { status: 'retry', httpStatus: 503 }, env);
    await recordFeatureAttempt({ id }, { status: 'retry' }, env);
    Object.assign(merged, await readCombined(id, env));
  }
  Object.assign(combined, merged);
  if (upstreamPromise && karaokeLyrics && !rejected) await rememberFailure(primaryKey, upstream, env);
  await clearFlag(primaryKey, 'miss', env);
  if ((karaokeLyrics || rejected) && upstreamPromise) await clearFlag(primaryKey, 'inflight', env).catch(() => {});

  let pendingUpstream = null;
  if (!karaokeLyrics && upstreamPromise && !rejected) {
    const settle = timedOut ? upstreamPromise : Promise.resolve(upstream);
    pendingUpstream = (async () => {
      let status = 'retry';
      let failureHttpStatus = 503;
      try {
        const result = await settle;
        status = result?.status;
        if (status !== 'ok') await recordFeatureAttempt({ id }, result, env);
        failureHttpStatus = result?.httpStatus || 503;
        if (result?.status === 'ok') {
          const karaoke = sanitizeLyrics(result.lyrics);
          if (karaoke) {
            const [synced] = convertLyrics(karaoke, 'karaoke', 'synced');
            const [plain] = convertLyrics(karaoke, 'karaoke', 'plain');
            const stored = await storeCombined(canonTrack, canonArtist, {
              karaoke,
              synced: sanitizeLyrics(synced) || null,
              plain: sanitizeLyrics(plain) || null,
              rich: result.rich
            }, meta, env, recordKeys);
            if (stored.rejected) {
              status = 'retry';
              await recordFeatureAttempt({ id }, { status }, env);
            } else await clearFlag(primaryKey, 'miss', env);
          }
        }
      } catch {
      } finally {
        if (status === 'ok') {
          await clearFlag(primaryKey, 'inflight', env).catch(() => {});
        } else {
          await rememberFailure(primaryKey, { status, httpStatus: failureHttpStatus }, env);
          await clearFlag(primaryKey, 'inflight', env).catch(() => {});
        }
      }
    })();
  }


  return {
    id,
    track: canonTrack,
    artist: canonArtist,
    instrumental: false,
    combined,
    meta,
    pendingUpstream, upstreamSettled
  };
}
