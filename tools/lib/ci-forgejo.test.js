'use strict';
/**
 * #678 — the engine map (tools/lib/tracker.js engineFor/engineFromConfig) and the Forgejo CI engine
 * (tools/lib/ci-forgejo.js). The contract scenarios live in tracker-contract.test.js; this file pins
 * what they do not: the map's defaults, the status→row mapping, paging, every failed read reading
 * null, and the token travelling in a header of the child's request — never on an argument list.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const tracker = require('./tracker');
const forgejo = require('./ci-forgejo');

const SHA = 'e'.repeat(40);
const ENG = { engine: 'forgejo', host: 'forge.example', owner: 'acme', repo: 'app', api: 'https://forge.example/api/v1', tokenEnv: 'FORGEJO_TOKEN' };
const st = (id, context, status, t = '2026-11-01T10:00:00Z') => ({ id, context, status, created_at: t, updated_at: t });

test('engineFromConfig: an unnamed host, a bad URL, and no config all read github', () => {
  assert.strictEqual(tracker.engineFromConfig('git@github.com:acme/app.git', {}).engine, 'github');
  assert.strictEqual(tracker.engineFromConfig('https://forge.example/acme/app.git', {}).engine, 'github');
  assert.strictEqual(tracker.engineFromConfig('https://forge.example/acme/app.git', null).engine, 'github');
  assert.strictEqual(tracker.engineFromConfig('/local/path/repo.git', { forges: { 'forge.example': 'forgejo' } }).engine, 'github');
  assert.strictEqual(tracker.engineFromConfig(null, { forges: { 'forge.example': 'forgejo' } }).engine, 'github');
});

test('engineFromConfig: a mapped host gets forgejo, with api and token env defaults', () => {
  for (const url of ['https://forge.example/acme/app.git', 'ssh://git@forge.example:2222/acme/app.git', 'git@forge.example:acme/app.git', 'https://Forge.Example/acme/app']) {
    const e = tracker.engineFromConfig(url, { forges: { 'forge.example': { engine: 'forgejo' } } });
    assert.deepStrictEqual([e.engine, e.host, e.owner, e.repo, e.api, e.tokenEnv, e.source],
      ['forgejo', 'forge.example', 'acme', 'app', 'https://forge.example/api/v1', 'FORGEJO_TOKEN', 'map'], url);
  }
  const short = tracker.engineFromConfig('https://forge.example/acme/app.git', { forges: { 'forge.example': 'forgejo' } });
  assert.strictEqual(short.engine, 'forgejo');
  const o = tracker.engineFromConfig('https://forge.example/acme/app.git',
    { forges: { 'forge.example': { engine: 'forgejo', api: 'https://forge.example/git/api/v1/', tokenEnv: 'MY_FORGE_TOKEN' } } });
  assert.deepStrictEqual([o.api, o.tokenEnv], ['https://forge.example/git/api/v1', 'MY_FORGE_TOKEN']);
  // A token env that is not a variable name is never used as one.
  const bad = tracker.engineFromConfig('https://forge.example/acme/app.git', { forges: { 'forge.example': { engine: 'forgejo', tokenEnv: 'abc; rm -rf' } } });
  assert.strictEqual(bad.tokenEnv, 'FORGEJO_TOKEN');
});

test('engineFromConfig: an engine the CLI does not know is invalid and reads github, saying why', () => {
  const e = tracker.engineFromConfig('https://forge.example/acme/app.git', { forges: { 'forge.example': { engine: 'gitlab' } } });
  assert.strictEqual(e.engine, 'github');
  assert.strictEqual(e.source, 'invalid');
  assert.match(e.why, /gitlab/);
});

test('engineFor reads the CONFIGURED remote url, not the insteadOf-expanded one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-forgejo-'));
  try {
    const run = (...a) => cp.execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    run('init', '-q');
    run('remote', 'add', 'origin', 'https://forge.example/acme/app.git');
    run('config', 'url./somewhere/local.insteadOf', 'https://forge.example/');
    const cfg = path.join(dir, 'config.json');
    fs.writeFileSync(cfg, JSON.stringify({ forges: { 'forge.example': 'forgejo' } }));
    const e = tracker.engineFor(dir, { configFile: cfg });
    assert.deepStrictEqual([e.engine, e.owner, e.repo], ['forgejo', 'acme', 'app']);
    assert.strictEqual(tracker.engineFor(dir, { configFile: path.join(dir, 'missing.json') }).engine, 'github');
    assert.strictEqual(tracker.ciFor(dir, { configFile: cfg }).kind, 'forgejo');
    assert.strictEqual(tracker.ciFor(dir, { configFile: path.join(dir, 'missing.json') }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('statusRow: pending is unfinished; only success is green; every other state is a finished non-success', () => {
  assert.deepStrictEqual(pickRow(forgejo.statusRow(SHA, st(1, 'CI / test (push)', 'pending'))), ['in_progress', '', 'CI / test (push)', null]);
  assert.deepStrictEqual(pickRow(forgejo.statusRow(SHA, st(1, 'c', 'success'))), ['completed', 'success', 'c', null]);
  for (const s of ['failure', 'error', 'warning']) assert.deepStrictEqual(pickRow(forgejo.statusRow(SHA, st(1, 'c', s))), ['completed', s, 'c', null]);
});
function pickRow(r) { return [r.status, r.conclusion, r.workflowName, r.databaseId]; }

/** A fetcher over a fixed status list, paged as Forgejo pages it. */
function pagedFetcher(statuses, calls = []) {
  return (url) => {
    calls.push(url);
    const m = /page=(\d+)&limit=(\d+)/.exec(url);
    const page = Number(m[1]); const limit = Number(m[2]);
    const slice = statuses.slice((page - 1) * limit, page * limit);
    return { status: 200, body: JSON.stringify({ state: 'x', sha: SHA, total_count: statuses.length, statuses: slice }) };
  };
}

test('ciVerdict: green needs every context green; a warning or error is red', () => {
  const at = (sts) => forgejo.withFetcher(pagedFetcher(sts), () => forgejo.create('/r', ENG).ciVerdict(SHA));
  const g = at([st(1, 'a', 'success'), st(2, 'b', 'success')]);
  assert.deepStrictEqual([g.status, g.conclusion, g.runCount, g.sha], ['completed', 'success', 2, SHA]);
  assert.strictEqual(at([st(1, 'a', 'success'), st(2, 'b', 'warning')]).conclusion, 'warning');
  assert.strictEqual(at([st(1, 'a', 'error')]).conclusion, 'error');
  assert.strictEqual(at([st(1, 'a', 'success'), st(2, 'b', 'pending')]).status, 'in_progress');
  const none = at([]);
  assert.deepStrictEqual([none.status, none.runCount], ['none', 0]);
});

test('#682 ciVerdict names the contexts that keep the sha from green, and only those', () => {
  const at = (sts) => forgejo.withFetcher(pagedFetcher(sts), () => forgejo.create('/r', ENG).ciVerdict(SHA));
  const red = at([st(1, 'CI / lint (push)', 'success'), st(2, 'CI / smoke (push)', 'failure'), st(3, 'CI / e2e (push)', 'pending')]);
  assert.deepStrictEqual(red.notGreen, [
    { name: 'CI / smoke (push)', status: 'completed', conclusion: 'failure' },
    { name: 'CI / e2e (push)', status: 'in_progress', conclusion: null },
  ]);
  assert.strictEqual('notGreen' in at([st(1, 'a', 'success')]), false, 'a green sha carries no notGreen field');
  assert.strictEqual('notGreen' in at([]), false, 'no statuses: nothing to name');
});

test('ciVerdict: reads every page, and a red context on page 2 is not missed', () => {
  const sts = Array.from({ length: 60 }, (_, i) => st(i + 1, `ctx-${i}`, i === 55 ? 'failure' : 'success'));
  const calls = [];
  const v = forgejo.withFetcher(pagedFetcher(sts, calls), () => forgejo.create('/r', ENG).ciVerdict(SHA));
  assert.strictEqual(calls.length, 2);
  assert.match(calls[0], /^https:\/\/forge\.example\/api\/v1\/repos\/acme\/app\/commits\/e{40}\/status\?page=1&limit=50$/);
  assert.strictEqual(v.conclusion, 'failure');
  assert.strictEqual(v.runCount, 60);
});

test('ciVerdict: more statuses than the page cap is null, never a partial verdict', () => {
  const sts = Array.from({ length: forgejo.PAGE_LIMIT * 11 }, (_, i) => st(i + 1, `c${i}`, 'success'));
  assert.strictEqual(forgejo.withFetcher(pagedFetcher(sts), () => forgejo.create('/r', ENG).ciVerdict(SHA)), null);
});

test('ciVerdict: every failed read is null — HTTP error, no response, bad JSON, no statuses array, bad sha', () => {
  const v = (reply, sha = SHA) => forgejo.withFetcher(() => reply, () => forgejo.create('/r', ENG).ciVerdict(sha));
  assert.strictEqual(v({ status: 404, body: '{"message":"not found"}' }), null);
  assert.strictEqual(v({ status: 401, body: '' }), null);
  assert.strictEqual(v({ status: 0, body: '' }), null);
  assert.strictEqual(v({ status: 200, body: 'not json' }), null);
  assert.strictEqual(v({ status: 200, body: '{"state":"success"}' }), null);
  assert.strictEqual(v({ status: 200, body: '{}' }, 'not-a-sha'), null);
});

test('the real read: token in the request header, never on the argument list (child fetch, local server)', async () => {
  const token = 'tok-' + Math.random().toString(36).slice(2);
  const server = cp.spawn(process.execPath, ['-e', `
    const http = require('http');
    const s = http.createServer((req, res) => {
      const ok = req.headers.authorization === 'token ' + process.env.WANT;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      res.end(ok ? JSON.stringify({ state: 'success', sha: '${SHA}', total_count: 1, statuses: [{ id: 1, context: 'CI / t (push)', status: 'success', created_at: 'x', updated_at: 'x' }] }) : '{}');
    });
    s.listen(0, '127.0.0.1', () => console.log(s.address().port));
  `], { env: { ...process.env, WANT: token }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await new Promise((resolve, reject) => {
      server.stdout.once('data', (d) => resolve(Number(String(d).trim())));
      server.once('exit', () => reject(new Error('server exited')));
    });
    // Observe every spawn the module makes: a fresh copy binds spawnSync at load, so load it wrapped.
    const real = cp.spawnSync;
    const argvs = [];
    cp.spawnSync = (cmd, args, opts) => { argvs.push([cmd, ...args].join(' ')); return real(cmd, args, opts); };
    delete require.cache[require.resolve('./ci-forgejo')];
    let fresh;
    try { fresh = require('./ci-forgejo'); } finally { cp.spawnSync = real; }
    const eng = { ...ENG, api: `http://127.0.0.1:${port}/api/v1`, tokenEnv: 'COLAB_TEST_FORGE_TOKEN' };
    process.env.COLAB_TEST_FORGE_TOKEN = token;
    let v;
    try { v = fresh.create('/r', eng).ciVerdict(SHA); } finally { delete process.env.COLAB_TEST_FORGE_TOKEN; }
    assert.ok(v, 'the read succeeded with the token from the environment');
    assert.deepStrictEqual([v.status, v.conclusion], ['completed', 'success']);
    assert.ok(argvs.length >= 1, 'the module spawned its child');
    for (const a of argvs) assert.ok(!a.includes(token), 'the token never appears on an argument list');
    // Without the token the private read fails, and that is null — never a verdict.
    assert.strictEqual(fresh.create('/r', eng).ciVerdict(SHA), null);
  } finally {
    server.kill();
    delete require.cache[require.resolve('./ci-forgejo')];
  }
});
