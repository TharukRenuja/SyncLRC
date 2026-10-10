// Run: node --experimental-default-type=module scripts/check.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleGetLyrics, handleLyricsRequest } from '../src/api/lyrics.js';
import { startMetadata, enrichMetadata } from '../src/sources/deezer.js';
import { renderDocument } from '../src/lyrics/document.js';
import { lrcToTtml } from '../src/lyrics/options.js';
import { convertLyrics } from '../src/lyrics/format.js';
import { handleScheduled } from '../src/refresh.js';
import { storeSearchHits } from '../src/storage/bodies.js';

const dir = mkdtempSync(join(tmpdir(), 'synclrc-check-'));
const db = join(dir, 'db.sqlite');
const bridge = `import sqlite3,json,sys
p=json.loads(sys.stdin.read());c=sqlite3.connect(p['db']);c.row_factory=sqlite3.Row
if p.get('script'):c.executescript(p['sql']);r=[]
else:r=[dict(x) for x in c.execute(p['sql'],p.get('args',[])).fetchall()]
c.commit();print(json.dumps({'results':r,'meta':{'changes':c.total_changes}}))`;
function sql(query, args = [], script = false) {
  const result = spawnSync('python3', ['-c', bridge], { input: JSON.stringify({ db, sql: query, args, script }), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const bodies = new Map(); const tasks = []; let calls = 0; let release;
const gate = new Promise(resolve => { release = resolve; });
const fetchBefore = globalThis.fetch;
const env = { UPSTREAM_URL: 'https://upstream.test', D1_DB: {
  prepare(query) { return { args: [], bind(...args) { this.args = args; return this; },
    async first() { return sql(query, this.args).results[0] || null; },
    async all() { return sql(query, this.args); }, async run() { return sql(query, this.args); } }; },
  async batch(statements) { return Promise.all(statements.map(s => s.run())); }
}, R2_BUCKET: { async get(id) { return bodies.has(id) ? { async text() { return bodies.get(id); } } : null; },
  async put(id, value) { bodies.set(id, value); return { etag: value }; } } };
const result = { isrc: 'USUG11904206', track: 'Test Song', artist: 'Test Artist', album: 'Test Album', duration: 200 };
try {
  sql(readFileSync(new URL('../src/schema.sql', import.meta.url), 'utf8'), [], true);
  globalThis.fetch = async url => {
    const u = new URL(url);
    if (u.hostname === 'api.deezer.com') {
      calls++; await gate;
      if (u.pathname === '/search/track') {
        assert.equal(u.searchParams.get('q'), 'Test Artist Test Song');
        return Response.json({ data: [{ id: 1, title: result.track, title_short: result.track, artist: { name: result.artist }, album: { title: result.album }, duration: 200 }] });
      }
      return Response.json({ ...result, title: result.track, artist: { name: result.artist }, album: { title: result.album } });
    }
    if (u.hostname === 'lrclib.net') return Response.json({ trackName: result.track, artistName: result.artist,
      albumName: result.album, duration: 200, syncedLyrics: '[00:01.00]Hello there', plainLyrics: 'Hello there' });
    return new Response('', { status: 404 });
  };
  const url = new URL('https://test/lyrics?track=Test+Song&artist=Test+Artist');
  const response = await Promise.race([handleGetLyrics(null, url, env, { waitUntil(p) { tasks.push(p); } }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Deezer blocked response')), 5000); timer.unref(); })]);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.synced, '[00:01.00]Hello there');
  assert.equal(body.artist, 'Test Artist');
  assert.equal(sql('SELECT isrc FROM lyrics WHERE id=?', [body.id]).results[0].isrc, null);
  release(); await Promise.all(tasks);
  assert.deepEqual(sql('SELECT isrc,metadata FROM lyrics WHERE id=?', [body.id]).results[0], { isrc: result.isrc, metadata: -1 });
  const before = calls;
  const row = sql('SELECT * FROM lyrics WHERE id=?', [body.id]).results[0];
  assert.equal(await startMetadata(row, result.track, [result.artist], result.album, 200, env), undefined);
  assert.equal(calls, before);
  sql("INSERT INTO lyrics(id,name,artist,album,duration) VALUES('conflict','Test Song','Test Artist','Test Album',200)");
  await enrichMetadata('conflict', Promise.resolve(result), env);
  assert.equal(sql("SELECT isrc FROM lyrics WHERE id='conflict'").results[0].isrc, null);
  await enrichMetadata('conflict', Promise.resolve({ sourceFailed: true }), env);
  assert.equal(sql("SELECT metadata FROM lyrics WHERE id='conflict'").results[0].metadata, -1);
  sql("UPDATE lyrics SET metadata=0 WHERE id='conflict'");
  await enrichMetadata('conflict', Promise.resolve({ sourceFailed: true }), env);
  const retry = sql("SELECT * FROM lyrics WHERE id='conflict'").results[0];
  assert(retry.metadata > Date.now());
  assert.equal(await startMetadata(retry, result.track, [result.artist], result.album, 200, env), undefined);
  await enrichMetadata('conflict', Promise.resolve({ ...result, isrc: 'GBAHS1600463', track: 'Test Song (Remix)' }), env);
  assert.equal(sql("SELECT isrc FROM lyrics WHERE id='conflict'").results[0].isrc, null);
  sql("UPDATE lyrics SET metadata=0 WHERE id='conflict'");
  await enrichMetadata('conflict', Promise.resolve({ ...result, isrc: 'GBAHS1600463', duration: 250 }), env);
  assert.equal(sql("SELECT isrc FROM lyrics WHERE id='conflict'").results[0].isrc, null);
  sql("UPDATE lyrics SET metadata=? WHERE id='conflict'", [Date.now() - 1]);
  const expired = sql("SELECT * FROM lyrics WHERE id='conflict'").results[0];
  const retryCalls = calls;
  const retries = await Promise.all([startMetadata(expired, result.track, [result.artist], result.album, 200, env),
    startMetadata(expired, result.track, [result.artist], result.album, 200, env)]);
  assert.equal(retries.filter(Boolean).length, 1);
  assert.equal(calls - retryCalls, 2);
  bodies.clear();
  const refetchCalls = calls;
  const refetched = await handleGetLyrics(null, url, env, { waitUntil(p) { tasks.push(p); } });
  assert.equal(refetched.status, 200);
  await Promise.all(tasks);
  assert.equal(calls, refetchCalls, 'expired lyric body repeated completed metadata fetch');
  const { lookupRequestMetadata } = await import('../src/storage/metadata.js');
  sql("INSERT INTO lyrics(id,name,artist) VALUES('exact','Exact','Artist')");
  sql("INSERT INTO keys VALUES('priority',?)", [body.id]);
  const keyed = await lookupRequestMetadata(['priority'], 'Exact', 'Artist', env);
  assert.equal(keyed.id, body.id);
  assert.equal((await lookupRequestMetadata(['unknown'], 'Exact', 'Artist', env)).id, 'exact');
  assert.equal(await lookupRequestMetadata(['unknown'], 'Unknown', 'Artist', env), null);
  const native = { ttml: '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div><p begin="1s" end="5s" ttm:agent="v1"><span begin="1s" end="1.5s">Hello</span><span begin="2s" end="3s">world</span><span begin="3s" end="4s">again</span><span ttm:role="x-bg" begin="2s" end="2.5s"><span begin="2s" end="2.5s">Echo</span></span></p></div></body></tt>' };
  const lrc = renderDocument(native, 'lrc');
  assert.equal(lrc, '[00:01.00]<00:01.00>Hello<00:01.50> <00:02.00>world <00:03.00>again<00:04.00>');
  assert.equal(convertLyrics(lrc, 'karaoke', 'synced')[0], '[00:01.00]Hello world again');
  assert.equal(convertLyrics(lrc, 'karaoke', 'plain')[0], 'Hello world again');
  assert.match(lrcToTtml(lrc), /begin="00:00:01.000" end="00:00:04.000"/);
  assert.match(lrcToTtml(lrc), /begin="00:00:01.000" end="00:00:01.500">Hello/);
  const vocals = renderDocument(native, 'lrc', ['agents', 'background']);
  assert.match(vocals, /\{agent:v1\}/);
  assert.match(vocals, /\(<00:02.00>Echo<00:02.50>\)/);
  assert.match(renderDocument(native, 'ttml'), /end="1.5s"/);
  assert.equal(renderDocument({ ttml: native.ttml.replaceAll(/ end="[^"]+"/g, '') }, 'lrc'),
    '[00:01.00]<00:01.00>Hello <00:02.00>world <00:03.00>again');

  // OSS cron cleans storage; it must never fetch or refresh lyrics.
  sql("INSERT INTO lyrics(id,name,artist,metadata,karaoke,synced,plain) VALUES('old','Old','Artist',-1,1,1,1),('fresh','Fresh','Artist',-1,1,1,1)");
  sql("INSERT INTO keys VALUES('old-key','old'),('fresh-key','fresh')");
  sql("INSERT INTO flags VALUES('expired','inflight',0),('fresh','inflight',?)", [Date.now() + 3600000]);
  bodies.set('lyrics/old.json', JSON.stringify({ karaoke: 'old lyrics' }));
  bodies.set('lyrics/fresh.json', JSON.stringify({ karaoke: 'fresh lyrics' }));
  let sourceCalls = 0; let pages = 0; const deleted = [];
  globalThis.fetch = async () => { sourceCalls++; throw Error('cron must not fetch lyrics'); };
  env.R2_BUCKET.list = async ({ cursor }) => {
    pages++;
    return cursor ? { objects: [{ key: 'lyrics/fresh.json', uploaded: new Date() }], truncated: false } :
      { objects: [{ key: 'lyrics/old.json', uploaded: new Date(Date.now() - 2 * 86400000) }], truncated: true, cursor: 'next' };
  };
  env.R2_BUCKET.delete = async keys => { for (const key of keys) { deleted.push(key); bodies.delete(key); } };
  await handleScheduled({}, env);
  assert.equal(sourceCalls, 0);
  assert.equal(pages, 2);
  assert.deepEqual(deleted, ['lyrics/old.json']);
  assert(bodies.has('lyrics/fresh.json'));
  assert.deepEqual(sql("SELECT metadata,karaoke,synced,plain FROM lyrics WHERE id='old'").results[0],
    { metadata: -1, karaoke: 0, synced: 0, plain: 0 });
  assert.equal(sql("SELECT karaoke FROM lyrics WHERE id='fresh'").results[0].karaoke, 1);
  assert.equal(sql("SELECT lyric_id FROM keys WHERE key='old-key'").results[0].lyric_id, 'old');
  assert.equal(sql("SELECT * FROM flags WHERE key='expired'").results.length, 0);
  assert.equal(sql("SELECT * FROM flags WHERE key='fresh'").results.length, 1);
    // Search saves: duplicates, unchanged bodies, cross-request races, and isolated failures.
  {
    const get = env.R2_BUCKET.get; const put = env.R2_BUCKET.put; const warn = console.warn;
    const records = new Map(); const writes = []; const warnings = [];
    let rateLimit = false; let race = false;
    const hit = id => ({ id, track: 'Search Test', artist: 'Artist', meta: {}, keys: [id],
      type: 'synced', rawLrc: '[00:01.00]Words', synced: '[00:01.00]Words', plain: 'Words' });
    for (const id of ['search-save', 'search-race', 'search-rate', 'search-fail', 'search-after']) {
      sql('INSERT OR IGNORE INTO lyrics(id,name,artist) VALUES(?,?,?)', [id, 'Search Test', 'Artist']);
    }
    env.R2_BUCKET.get = async key => {
      const value = records.get(key);
      return value ? { etag: value, async text() { return value; } } : null;
    };
    env.R2_BUCKET.put = async (key, value, options) => {
      writes.push(key);
      assert(options.onlyIf, 'search write was unconditional');
      if (key.includes('search-fail')) throw new Error('Storage unavailable');
      if (rateLimit) { rateLimit = false; throw new Error('put: Reduce your concurrent request rate (10058)'); }
      if (race) {
        race = false;
        records.set(key, JSON.stringify({ karaoke: '<00:01.00>Words', plain: 'Original words', rich: { included: ['agents'] } }));
        return null;
      }
      const existing = records.get(key);
      if (options.onlyIf.etagMatches && options.onlyIf.etagMatches !== existing) return null;
      if (options.onlyIf.etagDoesNotMatch === '*' && existing) return null;
      records.set(key, value);
      return { etag: value };
    };
    console.warn = (...args) => warnings.push(args);
    try {
      await storeSearchHits([hit('search-save'), hit('search-save')], env);
      assert.equal(writes.length, 1, 'duplicate ID wrote twice');
      await storeSearchHits([hit('search-save')], env);
      assert.equal(writes.length, 1, 'unchanged body was rewritten');
      race = true;
      await storeSearchHits([hit('search-race')], env);
      const merged = JSON.parse(records.get('lyrics/search-race.json'));
      assert.equal(merged.plain, 'Original words');
      assert.equal(merged.karaoke, '<00:01.00>Words');
      assert.deepEqual(merged.rich.included, ['agents']);
      assert.equal(merged.synced, '[00:01.00]Words');
      rateLimit = true;
      await storeSearchHits([hit('search-rate')], env);
      assert(records.has('lyrics/search-rate.json'), 'rate-limited save never retried');
      await storeSearchHits([hit('search-fail'), hit('search-after')], env);
      assert(records.has('lyrics/search-after.json'), 'one failure stopped subsequent saves');
      assert.equal(sql('SELECT synced,plain FROM lyrics WHERE id=?', ['search-fail']).results[0].synced, 0);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0][1].id, 'search-fail');
      await Promise.all([storeSearchHits([hit('search-save')], env), storeSearchHits([hit('search-save')], env)]);
      assert.equal(writes.filter(key => key.includes('search-save')).length, 1);
      let active = 0; let peak = 0;
      env.R2_BUCKET.put = async (key, value) => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        records.set(key, value); active--;
        return { etag: value };
      };
      const many = Array.from({ length: 7 }, (_, i) => hit('parallel-' + i));
      await storeSearchHits(many, env);
      assert.equal(peak, 3, 'save concurrency must be capped at three');
      assert(many.every(item => records.has('lyrics/' + item.id + '.json')));
      await storeSearchHits([hit('deadline')], env, Date.now());
      assert(!records.has('lyrics/deadline.json'), 'expired deadline started a write');
      let attempts = 0;
      env.R2_BUCKET.put = async () => { attempts++; throw new Error('put: rate limited (10058)'); };
      await storeSearchHits([hit('exhausted')], env);
      assert.equal(attempts, 3, 'retry count is unbounded');
      assert.equal(warnings.at(-1)[1].id, 'exhausted');
      assert(!records.has('lyrics/exhausted.json'));

    } finally { env.R2_BUCKET.get = get; env.R2_BUCKET.put = put; console.warn = warn; }
  }
  // Invalid lyric options must fail before storage or source access, including cached IDs.
  {
    const untouched = { D1_DB: { prepare() { throw new Error('invalid request queried D1'); } } };
    const ctx = { waitUntil() { throw new Error('invalid request started background work'); } };
    for (const id of [null, body.id]) {
      const prefix = id ? 'https://test/lyrics/' + id + '?' : 'https://test/lyrics?track=Test+Song&artist=Test+Artist&';
      for (const params of ['type=invalid', 'type=', 'type=KARAOKE', 'duration=abc', 'duration=',
        'duration=0', 'duration=-1', 'duration=Infinity', 'duration=0x10', 'duration=1e3', 'duration=' + '9'.repeat(400)]) {
        const response = await handleLyricsRequest(id, new URL(prefix + params), untouched, ctx);
        assert.equal(response.status, 400, params);
        assert.equal((await response.json()).error, 'BAD_REQUEST');
      }
    }
  }
  // Both APIs expose the same error contract, including async route failures.
  {
    const { default: worker } = await import('../src/index.js');
    const { buildResponse, errorResponse, sourceFailureResponse } = await import('../src/api/response.js');
    for (const [status, code] of [[400, 'BAD_REQUEST'], [404, 'NOT_FOUND'], [500, 'INTERNAL_ERROR']]) {
      const response = errorResponse('Example', status);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { success: false, error: code, message: 'Example' });
      if (status >= 500) assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
    for (const status of [503, 504]) {
      const response = sourceFailureResponse('retry', status, 7);
      assert.equal(response.status, status);
      assert.equal(response.headers.get('Retry-After'), '7');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), { success: false,
        error: status === 504 ? 'UPSTREAM_TIMEOUT' : 'SOURCES_UNAVAILABLE',
        message: 'Lyrics sources are temporarily unavailable; retry shortly.' });
    }
    assert.equal((await sourceFailureResponse('miss').json()).message,
      'No matching song found for this track/artist.');
    const root = await (await worker.fetch(new Request('https://test/'), {}, {})).json();
    assert(root.endpoints.lyricsById.path_params);
    assert(!root.endpoints.lyricsById.path_param);
    const log = console.error; const fetch = globalThis.fetch; console.error = () => {};
    globalThis.fetch = async () => Response.json([{ trackName: 'Test', artistName: 'Artist', plainLyrics: 'Words' }]);
    try {
      for (const path of ['/lyrics/abc', '/lyrics?track=Test&artist=Artist', '/search?q=Test']) {
        const response = await worker.fetch(new Request('https://test' + path), {
          D1_DB: { prepare() { throw new Error('private storage detail'); } }
        }, { waitUntil() {} });
        assert.equal(response.status, 500);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await response.json(), { success: false, error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred; retry shortly.' });
      }
    } finally { console.error = log; globalThis.fetch = fetch; }
    const normalized = await buildResponse({ plain: 'Words' }, null, 'id', 'Song', 'Artist',
      { album: null, duration: 0, instrumental: 1 }).json();
    assert.equal(normalized.duration, 0);
    assert.equal(normalized.instrumental, true);
  }
  const migration = readFileSync(new URL('../migrations/migration.sql', import.meta.url), 'utf8');
  sql('ALTER TABLE stats RENAME COLUMN updated TO updated_at');
  sql("INSERT OR REPLACE INTO stats VALUES('health_stats','{}',123)");
  sql('ALTER TABLE lyrics DROP COLUMN metadata');
  sql('CREATE TABLE cache_flags(norm TEXT,kind TEXT,expires_at INTEGER)');
  if (migration.includes('DROP COLUMN norm')) {
    sql('ALTER TABLE lyrics ADD COLUMN norm TEXT');
    sql("UPDATE lyrics SET norm='legacy-key' WHERE id=?", [body.id]);
  } else {
    sql(`CREATE TABLE tracks(id TEXT,name TEXT,artist TEXT,album TEXT,duration INTEGER,instrumental INTEGER,norm TEXT);
      CREATE TABLE track_ids(id TEXT,isrc TEXT,name TEXT,artist TEXT,duration INTEGER);
      CREATE TABLE track_keys(key TEXT,track_id TEXT);`, [], true);
    sql('INSERT INTO track_keys VALUES(?,?)', ['legacy-key', body.id]);
  }
  sql(migration, [], true);
  assert.deepEqual(sql("SELECT value,updated FROM stats WHERE key='health_stats'").results[0], { value: '{}', updated: 123 });
  assert(sql('PRAGMA table_info(stats)').results.some(column => column.name === 'updated'));
  assert(!sql('PRAGMA table_info(stats)').results.some(column => column.name === 'updated_at'));
  assert.equal(sql("SELECT value FROM stats WHERE key='cursor'").results.length, 0);
  assert.equal(sql('SELECT id FROM lyrics WHERE id=?', [body.id]).results[0].id, body.id);
  assert.equal(sql("SELECT lyric_id FROM keys WHERE key='legacy-key'").results[0].lyric_id, body.id);
  assert.equal(sql('SELECT metadata FROM lyrics WHERE id=?', [body.id]).results[0].metadata, 0);
  assert.deepEqual(sql("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").results.map(x => x.name), ['flags', 'keys', 'lyrics', 'stats']);
  console.log('PASS: nonblocking enrichment; stable conflicts; validation; retry claim; no repeated enrichment; lookup priority; LRC ends/gaps/vocals; cleanup-only cron; expiry/flags/pagination; metadata/keys retained; migration');
} finally { globalThis.fetch = fetchBefore; rmSync(dir, { recursive: true, force: true }); }
