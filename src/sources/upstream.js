import { upstreamTimeoutMs } from '../config.js';
import { decodeDocument } from '../lyrics/document.js';

export async function fetchFromUpstream(track, artists, env, timeoutMs = upstreamTimeoutMs) {
  const params = new URLSearchParams({ track, format: 'ttml', include: 'agents,background' });
  for (const artist of artists) params.append('artist', artist);
  const url = `${env.UPSTREAM_URL}/lyrics?${params}`;

  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'X-SyncLRC-Secret': env.UPSTREAM_SECRET },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    return { status: 'retry', httpStatus: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 504 : 503 };
  }

  if (resp.status === 503 || resp.status === 504) return { status: 'retry', httpStatus: resp.status };
  if (resp.status === 400 || resp.status === 403) return { status: 'error' };
  if (resp.status === 404) return { status: 'miss' };
  if (resp.status !== 200) return { status: 'retry' };

  let data;
  try {
    data = await resp.json();
  } catch {
    return { status: 'retry' };
  }

  try { return { status: 'ok', ...decodeDocument(data) }; }
  catch { return { status: 'retry', httpStatus: 503 }; }
}
