'use strict';
/**
 * Tests for the audit's cross-run GitHub read cache (tools/lib/audit-cache.js, #593).
 *
 * Run: `node --test tools/lib/audit-cache.test.js`.
 *
 * The issue's oracle, pinned: two audits within the TTL make zero non-304 calls for unchanged
 * repos, and `--offline` makes none at all. The unit half drives the module with an injected
 * fetcher (no network); the end-to-end half runs audit.mjs against a fake `gh` that logs.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const cacheLib = require('./audit-cache');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });
function tmpdir(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TMP.push(d); return d; }

/** A fake server: `pages[path]` = array of bodies (for paginated paths keyed by the base path). */
function server(routes) {
  const calls = [];
  const etagOf = (body) => `"${require('crypto').createHash('sha1').update(body).digest('hex')}"`;
  const fetch = (apiPath, { etag } = {}) => {
    calls.push({ apiPath, etag: etag || null });
    const m = /^(.*?)\?per_page=\d+&page=(\d+)$/.exec(apiPath);
    const base = m ? m[1] : apiPath;
    const route = routes[base];
    if (route === 'rate-limited') return { kind: 'rate-limited' };
    if (route === undefined) return { kind: 'error', status: 404 };
    const pages = Array.isArray(route) ? route : [route];
    const i = m ? Number(m[2]) - 1 : 0;
    const body = pages[i] === undefined ? '[]' : pages[i];
    const tag = etagOf(body);
    if (etag && etag === tag) return { kind: 'not-modified', etag: tag };
    return { kind: 'ok', etag: tag, next: i + 1 < pages.length, linkKnown: true, body };
  };
  return { fetch, calls, routes };
}

function clock(start = 1_000_000) { let t = start; const f = () => t; f.advance = (s) => { t += s * 1000; }; return f; }

const META = 'repos/o/r';
const LABELS = 'repos/o/r/labels';

test('within the TTL a second run makes no request at all, and says the data came from cache', () => {
  const dir = tmpdir('audit-cache-');
  const srv = server({ [META]: '{"visibility":"public"}', [LABELS]: ['[{"name":"a"}]'] });
  const now = clock();
  const run = () => {
    const c = cacheLib.create({ dir, partition: 'p', fetch: srv.fetch, now, ttlSeconds: 600 });
    c.begin();
    const m = c.get('o/r', META);
    const l = c.get('o/r', LABELS, { paginate: true });
    return { m, l, s: c.summary() };
  };
  const first = run();
  assert.deepStrictEqual(JSON.parse(first.m.text), { visibility: 'public' });
  assert.deepStrictEqual(first.l.items, [{ name: 'a' }]);
  assert.strictEqual(first.s.fetched, 2);
  const before = srv.calls.length;
  now.advance(120);
  const second = run();
  assert.strictEqual(srv.calls.length, before, 'no call within the TTL');
  assert.strictEqual(second.s.cache, 2);
  assert.strictEqual(second.s.oldestAgeSeconds, 120);
  assert.deepStrictEqual(second.l.items, [{ name: 'a' }]);
});

test('past the TTL every page is re-asked with If-None-Match, and 304s re-arm the TTL', () => {
  const dir = tmpdir('audit-cache-');
  const p1 = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ name: `l${i}` })));
  const srv = server({ [LABELS]: [p1, '[{"name":"last"}]'] });
  const now = clock();
  const mk = (extra = {}) => cacheLib.create({ dir, partition: 'p', fetch: srv.fetch, now, ttlSeconds: 600, ...extra });
  const a = mk(); a.begin();
  assert.strictEqual(a.get('o/r', LABELS, { paginate: true }).items.length, 101);
  assert.strictEqual(srv.calls.length, 2, 'two pages followed through Link');
  now.advance(601);
  const b = mk(); b.begin();
  assert.strictEqual(b.get('o/r', LABELS, { paginate: true }).items.length, 101);
  const re = srv.calls.slice(2);
  assert.strictEqual(re.length, 2);
  assert.ok(re.every((c) => c.etag), 'every page conditional');
  assert.strictEqual(b.summary().revalidated, 1);
  assert.strictEqual(b.summary().oldestAgeSeconds, 0);
  const c = mk(); c.begin(); c.get('o/r', LABELS, { paginate: true });
  assert.strictEqual(srv.calls.length, 4, 'the 304 re-armed the TTL');
});

test('a changed page is replaced, not merged', () => {
  const dir = tmpdir('audit-cache-');
  const srv = server({ [LABELS]: ['[{"name":"a"}]'] });
  const now = clock();
  const mk = () => cacheLib.create({ dir, partition: 'p', fetch: srv.fetch, now, ttlSeconds: 10 });
  mk().get('o/r', LABELS, { paginate: true });
  srv.routes[LABELS] = ['[{"name":"b"}]'];
  now.advance(11);
  const c = mk(); c.begin();
  assert.deepStrictEqual(c.get('o/r', LABELS, { paginate: true }).items, [{ name: 'b' }]);
  assert.strictEqual(c.summary().fetched, 1);
});

test('--fresh skips the TTL but still asks conditionally', () => {
  const dir = tmpdir('audit-cache-');
  const srv = server({ [META]: '{}' });
  const now = clock();
  cacheLib.create({ dir, partition: 'p', fetch: srv.fetch, now }).get('o/r', META);
  const c = cacheLib.create({ dir, partition: 'p', fetch: srv.fetch, now, fresh: true });
  c.begin(); c.get('o/r', META);
  assert.strictEqual(srv.calls.length, 2);
  assert.ok(srv.calls[1].etag);
  assert.strictEqual(c.summary().revalidated, 1);
  c.get('o/r', META);
  assert.strictEqual(srv.calls.length, 2, 'one read per key per run, even with --fresh');
});

test('a rate limit serves the cached copy marked stale; a 404 is never served stale', () => {
  const dir = tmpdir('audit-cache-');
  const srv = server({ [META]: '{"v":1}' });
  const now = clock();
  cacheLib.create({ dir, partition: 'p', fetch: srv.fetch, now, ttlSeconds: 1 }).get('o/r', META);
  now.advance(5);
  srv.routes[META] = 'rate-limited';
  const c = cacheLib.create({ dir, partition: 'p', fetch: srv.fetch, now, ttlSeconds: 1 });
  c.begin();
  const r = c.get('o/r', META);
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.stale, true);
  assert.strictEqual(c.summary().stale, 1);
  assert.strictEqual(c.summary().oldestAgeSeconds, 5);
  delete srv.routes[META]; // the repo is gone
  now.advance(5);
  const d = cacheLib.create({ dir, partition: 'p', fetch: srv.fetch, now, ttlSeconds: 1 });
  assert.strictEqual(d.get('o/r', META).status, 'error');
});

test('a 404 is cached for the TTL, so an absent file costs one call per TTL, not per run', () => {
  const dir = tmpdir('audit-cache-');
  const srv = server({});
  const now = clock();
  const mk = () => cacheLib.create({ dir, partition: 'p', fetch: srv.fetch, now, ttlSeconds: 600 });
  assert.strictEqual(mk().get('o/r', 'repos/o/r/contents/x').status, 'error');
  assert.strictEqual(mk().get('o/r', 'repos/o/r/contents/x').status, 'error');
  assert.strictEqual(srv.calls.length, 1);
});

test('offline makes no request and says so', () => {
  const srv = server({ [META]: '{}' });
  const c = cacheLib.create({ dir: tmpdir('audit-cache-'), partition: 'p', fetch: srv.fetch, offline: true });
  c.begin();
  assert.strictEqual(c.get('o/r', META).status, 'offline');
  assert.strictEqual(srv.calls.length, 0);
  assert.deepStrictEqual(c.summary(), { mode: 'offline' });
});

test('different partitions (gh binary / token) never share entries', () => {
  const dir = tmpdir('audit-cache-');
  const srv = server({ [META]: '{}' });
  cacheLib.create({ dir, partition: 'one', fetch: srv.fetch }).get('o/r', META);
  cacheLib.create({ dir, partition: 'two', fetch: srv.fetch }).get('o/r', META);
  assert.strictEqual(srv.calls.length, 2);
  const env = (extra) => ({ PATH: '', ...extra });
  assert.notStrictEqual(cacheLib.partitionKey(env({ GH_TOKEN: 'a' })), cacheLib.partitionKey(env({ GH_TOKEN: 'b' })));
});

test('the cache directory is never created under a colab home that does not exist', () => {
  const missing = path.join(tmpdir('audit-cache-'), 'no-home');
  assert.strictEqual(cacheLib.resolveDir({}, missing), null);
  assert.strictEqual(fs.existsSync(missing), false);
  const home = tmpdir('audit-cache-home-');
  assert.strictEqual(cacheLib.resolveDir({}, home), path.join(home, 'cache', 'audit'));
  assert.strictEqual(cacheLib.resolveDir({ COLAB_AUDIT_CACHE_DIR: '/x/y' }, home), '/x/y');
});

test('TTL: flag beats env beats default; anything but whole seconds is refused', () => {
  assert.strictEqual(cacheLib.resolveTtlSeconds(null, {}), 600);
  assert.strictEqual(cacheLib.resolveTtlSeconds(null, { COLAB_AUDIT_CACHE_TTL: '30' }), 30);
  assert.strictEqual(cacheLib.resolveTtlSeconds('0', { COLAB_AUDIT_CACHE_TTL: '30' }), 0);
  assert.strictEqual(cacheLib.resolveTtlSeconds('1.5', {}), null);
  assert.strictEqual(cacheLib.resolveTtlSeconds('-1', {}), null);
});

test('classify reads gh -i output: 200 with Link next, 304, rate limit, headerless answer', () => {
  const ok = cacheLib.classify('HTTP/2.0 200 OK\r\nEtag: W/"x"\r\nLink: <u>; rel="next"\r\n\r\n[1]', '', 0);
  assert.deepStrictEqual([ok.kind, ok.etag, ok.next, ok.body], ['ok', 'W/"x"', true, '[1]']);
  assert.strictEqual(cacheLib.classify('HTTP/2.0 304 Not Modified\r\nEtag: W/"x"\r\n\r\n', '', 1).kind, 'not-modified');
  assert.strictEqual(cacheLib.classify('HTTP/2.0 403 Forbidden\r\nX-Ratelimit-Remaining: 0\r\n\r\n{}', '', 1).kind, 'rate-limited');
  assert.strictEqual(cacheLib.classify('HTTP/2.0 404 Not Found\r\n\r\n{}', '', 1).status, 404);
  assert.strictEqual(cacheLib.classify('{"a":1}', '', 0).kind, 'ok');
  assert.strictEqual(cacheLib.classify('', 'error connecting', 1).kind, 'unreachable');
});

// --- end to end: audit.mjs through a logging fake `gh` --------------------------------------------

function fixture() {
  const dir = tmpdir('audit-cache-repo-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  g('add', '-A'); g('commit', '-q', '-m', 'chore: fixture');
  g('remote', 'add', 'origin', 'https://github.com/an-owner/a-repo.git');
  return dir;
}

/** A fake gh answering the label read with a real-looking `-i` response, logging every call. */
function fakeGh() {
  const dir = tmpdir('audit-cache-bin-');
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const log = path.join(dir, 'calls');
  const resp = path.join(dir, 'labels.http');
  fs.writeFileSync(resp, 'HTTP/2.0 200 OK\r\nEtag: W/"L1"\r\n\r\n[{"name":"in-progress","description":"x"}]');
  const nm = path.join(dir, 'nm.http');
  fs.writeFileSync(nm, 'HTTP/2.0 304 Not Modified\r\nEtag: W/"L1"\r\n\r\n');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$*" >> "${log}"`,
    'case "$2" in',
    '  repos/an-owner/a-repo/labels*)',
    `    case "$*" in *If-None-Match*) cat "${nm}"; exit 1;; esac`,
    `    cat "${resp}"; exit 0;;`,
    'esac',
    'exit 1',
  ].join('\n'), { mode: 0o755 });
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []) };
}

function audit(dir, gh, cacheDir, args = []) {
  const r = spawnSync('node', [AUDIT, '--json', '--local', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${gh.bin}:${process.env.PATH}`, HOME: os.tmpdir(),
      COLAB_HOME: path.join(os.tmpdir(), 'no-such-colab-home'), COLAB_AUDIT_CACHE_DIR: cacheDir, COLAB_AUDIT_CACHE_TTL: '' },
  });
  let json = null; try { json = JSON.parse(r.stdout); } catch (_) {}
  return { code: r.status, stderr: r.stderr, json };
}

test('audit: two runs within the TTL make one label request; --cache-ttl 0 revalidates with a 304', () => {
  const repo = fixture(); const gh = fakeGh(); const cacheDir = tmpdir('audit-cache-dir-');
  const a = audit(repo, gh, cacheDir);
  assert.ok(a.json, a.stderr);
  assert.strictEqual(a.json.results[0].remote.fetched, 1);
  assert.strictEqual(gh.calls().length, 1);
  const b = audit(repo, gh, cacheDir);
  assert.strictEqual(gh.calls().length, 1, 'no call within the TTL');
  assert.strictEqual(b.json.results[0].remote.cache, 1);
  assert.deepStrictEqual(b.json.results[0].findings, a.json.results[0].findings, 'cached facts judge the same');
  const c = audit(repo, gh, cacheDir, ['--cache-ttl', '0']);
  assert.strictEqual(gh.calls().length, 2);
  assert.match(gh.calls()[1], /If-None-Match: W\/"L1"/);
  assert.strictEqual(c.json.results[0].remote.revalidated, 1);
  assert.deepStrictEqual(c.json.results[0].findings, a.json.results[0].findings);
});

test('audit --offline: no gh call at all, slug entries skipped, network flags refused', () => {
  const repo = fixture(); const gh = fakeGh(); const cacheDir = tmpdir('audit-cache-dir-');
  const r = audit(repo, gh, cacheDir, ['--offline', 'some-owner/some-repo']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(gh.calls().length, 0);
  assert.deepStrictEqual(r.json.remote, { read: false, reason: '--offline' });
  assert.deepStrictEqual(r.json.results[0].remote, { mode: 'offline' });
  const slug = r.json.results.find((x) => x.repo === 'some-owner/some-repo');
  assert.strictEqual(slug.skipped, 'offline');
  for (const flag of ['--identity', '--batch-history', '--fresh']) {
    const bad = audit(repo, gh, cacheDir, ['--offline', flag]);
    assert.strictEqual(bad.code, 2, `${flag}: ${bad.stderr}`);
    assert.match(bad.stderr, /conflict/);
  }
  assert.strictEqual(gh.calls().length, 0);
});
