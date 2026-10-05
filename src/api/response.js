import { artistArray, featureDue } from '../lyrics/document.js';
import { convertLyrics, pickType } from '../lyrics/format.js';
import { renderOptions } from '../lyrics/options.js';
import { sanitizeLyrics } from '../lyrics/sanitize.js';

export function jsonResponse(data, status = 200, cacheControl = 'no-cache', extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders
    }
  });
}

export function errorResponse(msg, status = 400) {
  const error = status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST';
  return jsonResponse({
    success: false,
    error,
    message: msg
  }, status, status >= 400 ? 'public, max-age=300' : 'no-cache');
}

export function buildResponse(combined, reqType, id, track, artist, meta, { pending = false, options = null } = {}) {
  artist = artistArray(combined.artists || artist);
  const base = { album: meta?.album ?? null, duration: meta?.duration ?? null, instrumental: !!meta?.instrumental };
  // Pending responses use a short cache so clients can see the later karaoke upgrade.
  const cacheControl = options?.hasInclude && featureDue(combined, options.requested) ? 'no-store' :
    pending || (options?.hasInclude && combined.rich?.unknown?.length) ? 'public, max-age=60' : 'public, max-age=86400';
  const headers = pending ? { 'Synclrc-Pending': 'karaoke' } : {};

  if (combined.karaoke) {
    const [synced] = convertLyrics(combined.karaoke, 'karaoke', 'synced');
    combined.synced = sanitizeLyrics(synced) || null;
    const [plain] = convertLyrics(combined.karaoke, 'karaoke', 'plain');
    combined.plain = sanitizeLyrics(plain) || null;
  }

  if (options) {
    let body = { ...base, ...combined };
    if (reqType) {
      const currentType = pickType(combined);
      const [lyrics, type] = convertLyrics(combined[currentType], currentType, reqType);
      body = { ...base, lyrics, type };
    }
    return jsonResponse({ id, track, artist, ...base, ...renderOptions(combined, body, options) },
      200, cacheControl, headers);
  }

  if (reqType) {
    const lyrics = combined[reqType] || combined.synced || combined.plain;
    const type = pickType(combined);
    const [converted, convertedType] = convertLyrics(lyrics, type, reqType);
    return jsonResponse({ lyrics: converted, type: convertedType, id, track, artist, ...base }, 200, cacheControl, headers);
  }

  return jsonResponse({
    id, track, artist,
    ...base,
    karaoke: combined.karaoke || null,
    synced: combined.synced || null,
    plain: combined.plain || null
  }, 200, cacheControl, headers);
}


// Legacy reads are opt-in after migration.

export function sourceFailureResponse(status, httpStatus = 503, retryAfter = 5) {
  if (status === 'miss') return errorResponse('Lyrics not found', 404);
  return jsonResponse({ error: httpStatus === 504 ? 'Lyrics sources took too long to respond.' : status === 'skipped' ? 'Lyrics fetch in progress; retry shortly.' :
    'Lyrics sources temporarily unavailable; retry shortly.' }, httpStatus, 'no-store',
    { 'Retry-After': String(retryAfter || 5) });
}
