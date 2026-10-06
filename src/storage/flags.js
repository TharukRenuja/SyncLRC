export const upstreamFailureTtl = 120;

export const upstreamCooldownTtl = 60;

export const missTtl = 3600;

export async function getFlag(key, kind, env) {
  const row = await env.D1_DB.prepare(
    'SELECT expires_at FROM flags WHERE key = ? AND kind = ?'
  ).bind(key, kind).first();
  if (!row) return false;
  if (row.expires_at <= Date.now()) {
    await env.D1_DB.prepare('DELETE FROM flags WHERE key = ? AND kind = ?').bind(key, kind).run();
    return false;
  }
  return true;
}

export async function setFlag(key, kind, ttl, env) {
  await env.D1_DB.prepare(
    'INSERT OR REPLACE INTO flags (key, kind, expires_at) VALUES (?, ?, ?)'
  ).bind(key, kind, Date.now() + ttl * 1000).run();
}

export async function failureState(key, env) {
  for (const status of [504, 503]) {
    const row = await env.D1_DB.prepare('SELECT expires_at FROM flags WHERE key = ? AND kind = ?')
      .bind(key, `failure${status}`).first();
    if (row?.expires_at > Date.now()) return { status: 'retry', httpStatus: status,
      retryAfter: Math.max(1, Math.ceil((row.expires_at - Date.now()) / 1000)) };
  }
  return null;
}

export async function rememberFailure(key, result, env) {
  if (result.status === 'ok') {
    await clearFlag(key, 'failure503', env);
    await clearFlag(key, 'failure504', env);
  } else if (result.status !== 'miss' && result.status !== 'skipped') {
    await setFlag(key, `failure${result.httpStatus === 504 ? 504 : 503}`, upstreamFailureTtl, env);
  }
}

export async function claimUpstream(key, env) {
  const now = Date.now();
  const fresh = now + upstreamCooldownTtl * 1000;
  const res = await env.D1_DB.prepare(
    `INSERT INTO flags (key, kind, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(key, kind) DO UPDATE SET expires_at = excluded.expires_at
     WHERE flags.expires_at <= ?`
  ).bind(key, 'inflight', fresh, now).run();
  return (res?.meta?.changes ?? 0) > 0;
}

export async function clearFlag(key, kind, env) {
  await env.D1_DB.prepare('DELETE FROM flags WHERE key = ? AND kind = ?').bind(key, kind).run();
}
