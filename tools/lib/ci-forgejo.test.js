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

test('#688 ciVerdict: a skipped context beside a verifying success reads green and is not named as holding it', () => {
  const at = (sts) => forgejo.withFetcher(pagedFetcher(sts), () => forgejo.create('/r', ENG).ciVerdict(SHA));
  const g = at([st(1, 'Gated / install (push)', 'skipped'), st(2, 'CI / test (push)', 'success')]);
  assert.strictEqual(g.conclusion, 'success');
  assert.deepStrictEqual(g.skippedOnly.map((x) => x.workflowName), ['Gated / install (push)']);
  assert.strictEqual('notGreen' in g, false);
  const only = at([st(1, 'Gated / install (push)', 'skipped')]);
  assert.strictEqual(only.conclusion, 'skipped');
  assert.deepStrictEqual(only.notGreen.map((x) => x.name), ['Gated / install (push)']);
  const red = at([st(1, 'Gated / install (push)', 'skipped'), st(2, 'CI / test (push)', 'failure')]);
  assert.strictEqual(red.conclusion, 'failure');
  assert.deepStrictEqual(red.notGreen.map((x) => x.name), ['CI / test (push)']);
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

// ---- #681: the release half of the forge engine ----------------------------------------------------

test('#681 statusRow reads the event from a Forgejo Actions context; a context without one carries none', () => {
  assert.strictEqual(forgejo.statusRow(SHA, st(1, 'CI / test (push)', 'success')).event, 'push');
  assert.strictEqual(forgejo.statusRow(SHA, st(2, 'release-auto / cut (workflow_dispatch)', 'pending')).event, 'workflow_dispatch');
  assert.strictEqual('event' in forgejo.statusRow(SHA, st(3, 'ci/woodpecker', 'success')), false);
  assert.strictEqual(forgejo.statusRow(SHA, st(4, 'CI / test (push)', 'success', '2026-11-01T10:05:00Z')).updatedAt, '2026-11-01T10:05:00Z');
});

test('#681 withoutOwnWorkflow on a Forgejo runner drops the running workflow\'s contexts by file path or base name — not on GitHub', () => {
  const { withoutOwnWorkflow } = require('./release-cut');
  const rows = [{ workflowName: 'CI / test (push)' }, { workflowName: 'release-auto / cut (workflow_dispatch)' }, { workflowName: 'release-autopsy / x (push)' }];
  const fj = { GITHUB_ACTIONS: 'true', FORGEJO_ACTIONS: 'true', GITHUB_WORKFLOW: '.forgejo/workflows/release-auto.yml' };
  assert.deepStrictEqual(withoutOwnWorkflow(rows, fj).map((r) => r.workflowName), ['CI / test (push)', 'release-autopsy / x (push)']);
  assert.deepStrictEqual(withoutOwnWorkflow(rows, { ...fj, GITHUB_WORKFLOW: 'release-auto' }).length, 2);
  assert.deepStrictEqual(withoutOwnWorkflow(rows, { ...fj, FORGEJO_ACTIONS: undefined, GITEA_ACTIONS: 'true' }).length, 2);
  // GitHub: the exact-name rule only — a context-shaped name is never matched by prefix there.
  assert.deepStrictEqual(withoutOwnWorkflow(rows, { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'release-auto' }).length, 3);
  assert.deepStrictEqual(withoutOwnWorkflow(rows, {}).length, 3);
});

test('#681 issueListAll pages, drops pull requests, maps to the GitHub shape newest first, and reads data:null on any failed page', () => {
  const page1 = Array.from({ length: forgejo.PAGE_LIMIT }, (_, i) => ({ number: i + 1, title: `t${i + 1}`, body: '', state: 'open', labels: [], created_at: 'x', pull_request: i === 0 ? { merged: false } : null }));
  const page2 = [{ number: 60, title: 'closed', body: 'b', state: 'closed', labels: [{ name: 'release-hold' }], created_at: 'c', closed_at: 'd', html_url: 'u' }];
  const urls = [];
  const r = forgejo.withFetcher((url) => {
    urls.push(url);
    return { status: 200, body: JSON.stringify(/page=1&/.test(url) ? page1 : page2) };
  }, () => forgejo.create('/r', ENG).issueListAll({ limit: 5000, fields: ['number', 'state', 'labels', 'closedAt', 'url'] }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(urls.length, 2);
  assert.match(urls[0], /\/repos\/acme\/app\/issues\?state=all&type=issues&page=1&limit=50$/);
  assert.strictEqual(r.data.length, forgejo.PAGE_LIMIT, 'the pull request (number 1) is not an issue');
  assert.deepStrictEqual(r.data[0], { number: 60, state: 'CLOSED', labels: [{ name: 'release-hold' }], closedAt: 'd', url: 'u' });
  assert.ok(!r.data.some((i) => i.number === 1));
  const bad = forgejo.withFetcher((url) => (/page=2&/.test(url) ? { status: 502, body: '' } : { status: 200, body: JSON.stringify(page1) }),
    () => forgejo.create('/r', ENG).issueListAll({ limit: 5000 }));
  assert.deepStrictEqual([bad.ok, bad.data], [false, null]);
});

test('#681 releaseCreate: the token\'s env var is named when the forge refuses the write; 409 is "already exists"', () => {
  const mk = (status) => forgejo.withFetcher((url, o) => ({ status, body: o.method === 'POST' ? '{}' : '' }),
    () => forgejo.create('/r', ENG).releaseCreate('v1.0.0', { final: true }));
  assert.match(mk(403).stderr, /FORGEJO_TOKEN cannot write releases/);
  assert.match(mk(409).stderr, /already exists/);
  const ok = mk(201);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.stdout, 'https://forge.example/acme/app/releases/tag/v1.0.0');
});

test('#681 blockedBy reads an issue\'s dependencies; a failed read is null, never "no edges"', () => {
  const edges = forgejo.withFetcher((url) => {
    assert.match(url, /\/issues\/7\/dependencies\?limit=50$/);
    return { status: 200, body: JSON.stringify([{ number: 9, state: 'closed', closed_at: '2026-11-02T00:00:00Z' }]) };
  }, () => forgejo.create('/r', ENG).blockedBy(7));
  assert.deepStrictEqual(edges, [{ number: 9, state: 'closed', closedAt: '2026-11-02T00:00:00Z' }]);
  assert.strictEqual(forgejo.withFetcher(() => ({ status: 404, body: '' }), () => forgejo.create('/r', ENG).blockedBy(7)), null);
});

test('#681 ciVerdict takes a rowsFilter — the rows it drops are not part of the verdict', () => {
  const body = JSON.stringify({ total_count: 2, statuses: [st(1, 'CI / test (push)', 'success'), st(2, 'release-auto / cut (workflow_dispatch)', 'pending')] });
  const v = forgejo.withFetcher(() => ({ status: 200, body }), () => forgejo.create('/r', ENG).ciVerdict(SHA, { rowsFilter: (rows) => rows.filter((r) => !/^release-auto \//.test(r.workflowName)) }));
  assert.deepStrictEqual([v.status, v.conclusion, v.runCount], ['completed', 'success', 1]);
});

test('#740 commentView reads one comment by id; every failed read is null', () => {
  const body = { id: 555, html_url: 'https://forge.example/acme/app/issues/90#issuecomment-555', user: { login: 'exec' }, body: 'wrapped', created_at: '2026-10-08T12:00:00Z' };
  const c = forgejo.withFetcher((url) => {
    assert.strictEqual(url, 'https://forge.example/api/v1/repos/acme/app/issues/comments/555');
    return { status: 200, body: JSON.stringify(body) };
  }, () => forgejo.create('/r', ENG).commentView('555'));
  assert.deepStrictEqual(c, { body: 'wrapped', login: 'exec', createdAt: '2026-10-08T12:00:00Z', htmlUrl: body.html_url });
  for (const reply of [{ status: 404, body: '' }, { status: 0, error: 'x' }, { status: 200, body: 'nope' }, { status: 200, body: '[]' }]) {
    assert.strictEqual(forgejo.withFetcher(() => reply, () => forgejo.create('/r', ENG).commentView('555')), null, JSON.stringify(reply));
  }
  let called = false;
  assert.strictEqual(forgejo.withFetcher(() => { called = true; return { status: 200, body: '{}' }; }, () => forgejo.create('/r', ENG).commentView('5/../x')), null);
  assert.strictEqual(called, false, 'a non-numeric id is never requested');
});

test('#740 issueView: the GitHub shape; comments only when asked, every page read, a failed or capped page is null', () => {
  const issue = { number: 90, title: 'feat', body: '', state: 'closed', closed_at: '2026-10-09T00:00:00Z', labels: [], assignees: [], created_at: '2026-10-01T00:00:00Z', html_url: 'https://forge.example/acme/app/issues/90' };
  const cm = (i) => ({ id: i, user: { login: 'exec' }, body: `c${i}`, created_at: '2026-10-08T12:00:00Z', html_url: `https://forge.example/acme/app/issues/90#issuecomment-${i}` });
  const calls = [];
  const fetcher = (pages) => (url) => {
    calls.push(url);
    if (/\/issues\/90$/.test(url)) return { status: 200, body: JSON.stringify(issue) };
    const m = /\/issues\/90\/comments\?page=(\d+)&limit=50$/.exec(url);
    if (!m) return { status: 404, body: '' };
    const p = pages[Number(m[1]) - 1];
    return p === undefined ? { status: 200, body: '[]' } : p;
  };
  // no comments asked → one request
  const bare = forgejo.withFetcher(fetcher([]), () => forgejo.create('/r', ENG).issueView(90, ['state', 'closedAt']));
  assert.deepStrictEqual(bare, { state: 'CLOSED', closedAt: '2026-10-09T00:00:00Z' });
  assert.strictEqual(calls.length, 1);
  // two pages of comments → all of them, in order, GitHub's comment shape
  const full = Array.from({ length: 50 }, (_, i) => cm(i + 1));
  const v = forgejo.withFetcher(fetcher([{ status: 200, body: JSON.stringify(full) }, { status: 200, body: JSON.stringify([cm(51)]) }]),
    () => forgejo.create('/r', ENG).issueView(90, ['state', 'comments']));
  assert.strictEqual(v.comments.length, 51);
  assert.deepStrictEqual(v.comments[50], { author: { login: 'exec' }, body: 'c51', createdAt: '2026-10-08T12:00:00Z', url: 'https://forge.example/acme/app/issues/90#issuecomment-51' });
  // a failed comment page is null — never a short list a claim read would trust
  assert.strictEqual(forgejo.withFetcher(fetcher([{ status: 200, body: JSON.stringify(full) }, { status: 502, body: '' }]),
    () => forgejo.create('/r', ENG).issueView(90, ['comments'])), null);
  // more comment pages than the cap is null too
  assert.strictEqual(forgejo.withFetcher(fetcher(Array.from({ length: 11 }, () => ({ status: 200, body: JSON.stringify(full) }))),
    () => forgejo.create('/r', ENG).issueView(90, ['comments'])), null);
  // an issue the forge does not have is null
  assert.strictEqual(forgejo.withFetcher(() => ({ status: 404, body: '' }), () => forgejo.create('/r', ENG).issueView(91, ['state'])), null);
});


// #765 — the run/job model the red-trunk doors read on a forge, and the two grant reads.

test('#765 jobFromRow: an Actions context splits into workflow, job and event; an external one is its own job', () => {
  const row = (ctx, s = 'success') => forgejo.statusRow(SHA, st(1, ctx, s));
  assert.deepStrictEqual(
    (({ name, workflowName, event, status, conclusion, headSha, steps, startedAt }) => ({ name, workflowName, event, status, conclusion, headSha, steps, startedAt }))(forgejo.jobFromRow(row('CI / Build (push)', 'failure'))),
    { name: 'Build', workflowName: 'CI', event: 'push', status: 'completed', conclusion: 'failure', headSha: SHA, steps: null, startedAt: null });
  // the FIRST ` / ` splits, so a job name holding a slash survives
  const nested = forgejo.jobFromRow(row('CI / test / unit (pull_request)'));
  assert.deepStrictEqual([nested.workflowName, nested.name, nested.event], ['CI', 'test / unit', 'pull_request']);
  // a status from an external CI (no ` / `) is its own workflow and job, with no event
  const ext = forgejo.jobFromRow(row('ci/woodpecker/push/build'));
  assert.deepStrictEqual([ext.workflowName, ext.name, ext.event], ['ci/woodpecker/push/build', 'ci/woodpecker/push/build', null]);
  // pending stays not completed — a job in flight is never evidence
  assert.strictEqual(forgejo.jobFromRow(row('CI / Build (push)', 'pending')).status, 'in_progress');
});

test('#765 runsFromRows: one run per workflow, jobs inline, green only when all of it is', () => {
  const rows = [
    st(1, 'CI / Build (push)', 'failure'), st(2, 'CI / Lint (push)', 'success'),
    st(3, 'Docs / check (push)', 'success'), st(4, 'Nightly / x (push)', 'skipped'),
    st(5, 'Slow / y (push)', 'pending'),
  ].map((s) => forgejo.statusRow(SHA, s));
  const runs = forgejo.runsFromRows(rows);
  const by = Object.fromEntries(runs.map((r) => [r.workflowName, r]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['CI', 'Docs', 'Nightly', 'Slow']);
  assert.deepStrictEqual([by.CI.status, by.CI.conclusion, by.CI.jobs.map((j) => j.name)], ['completed', 'failure', ['Build', 'Lint']]);
  assert.deepStrictEqual([by.Docs.status, by.Docs.conclusion], ['completed', 'success']);
  assert.deepStrictEqual([by.Nightly.status, by.Nightly.conclusion], ['completed', 'skipped']);
  assert.deepStrictEqual([by.Slow.status, by.Slow.conclusion], ['in_progress', '']);
  // the run id is a synthetic key, never a number gh could be handed
  assert.strictEqual(by.CI.databaseId, 'status:CI');
  assert.strictEqual(by.CI.event, 'push');
  // push + pull_request contexts of one workflow are ONE run; the jobs keep their own event
  const both = forgejo.runsFromRows([st(1, 'CI / Build (push)', 'success'), st(2, 'CI / Build (pull_request)', 'success')].map((s) => forgejo.statusRow(SHA, s)));
  assert.strictEqual(both.length, 1);
  assert.strictEqual(both[0].event, null);
  assert.deepStrictEqual(both[0].jobs.map((j) => j.event), ['push', 'pull_request']);
  // a skipped job beside a passing one concludes success, as GitHub concludes such a run
  const mixed = forgejo.runsFromRows([st(1, 'CI / a (push)', 'success'), st(2, 'CI / b (push)', 'skipped')].map((s) => forgejo.statusRow(SHA, s)));
  assert.strictEqual(mixed[0].conclusion, 'success');
  // no rows is no runs; an unread read stays unread
  assert.deepStrictEqual(forgejo.runsFromRows([]), []);
  assert.strictEqual(forgejo.runsFromRows(null), null);
});

test('#765 associationFrom: owner and write are trusted classes; read, none and unread are not', () => {
  assert.strictEqual(forgejo.associationFrom('Acme', 'acme', 'read'), 'OWNER');
  assert.strictEqual(forgejo.associationFrom('ada', 'acme', 'owner'), 'OWNER');
  assert.strictEqual(forgejo.associationFrom('ada', 'acme', 'admin'), 'COLLABORATOR');
  assert.strictEqual(forgejo.associationFrom('ada', 'acme', 'write'), 'COLLABORATOR');
  assert.strictEqual(forgejo.associationFrom('ada', 'acme', 'read'), 'NONE');
  assert.strictEqual(forgejo.associationFrom('ada', 'acme', 'none'), 'NONE');
  assert.strictEqual(forgejo.associationFrom('ada', 'acme', undefined), '');
});

test('#765 authorAssociation: the permission read, a 404 is NONE, a failed read is untrusted', () => {
  const f = (status, body) => () => ({ status, body: JSON.stringify(body) });
  const read = (fetch, login) => forgejo.withFetcher(fetch, () => forgejo.create('/r', ENG).authorAssociation(login));
  let asked = null;
  assert.strictEqual(forgejo.withFetcher((u) => { asked = u; return { status: 200, body: '{"permission":"write"}' }; },
    () => forgejo.create('/r', ENG).authorAssociation('ada')), 'COLLABORATOR');
  assert.strictEqual(asked, 'https://forge.example/api/v1/repos/acme/app/collaborators/ada/permission');
  assert.strictEqual(read(f(404, {}), 'drive-by'), 'NONE');
  assert.strictEqual(read(f(500, {}), 'ada'), '');
  assert.strictEqual(read(() => { throw new Error('never asked'); }, 'acme'), 'OWNER'); // the repo owner needs no read
});

test('#765 labelActors: who ADDED the label, from the timeline; removals and other labels do not count; a failed page is null', () => {
  const ev = (type, label, login, body) => ({ type, label: label && { name: label }, user: { login }, body });
  const tl = [ev('label', 'ci-grant', 'ada', '1'), ev('label', 'ci-grant', 'bob', ''), ev('label', 'bug', 'eve', '1'), ev('comment', null, 'eve', 'hi')];
  assert.deepStrictEqual(forgejo.labelAddersFrom(tl, 'ci-grant'), ['ada']);
  assert.strictEqual(forgejo.labelAddersFrom(null, 'ci-grant'), null);
  let asked = null;
  const got = forgejo.withFetcher((u) => { asked = u; return { status: 200, body: JSON.stringify(tl) }; },
    () => forgejo.create('/r', ENG).labelActors(7, 'ci-grant'));
  assert.deepStrictEqual(got, ['ada']);
  assert.match(asked, /\/repos\/acme\/app\/issues\/7\/timeline\?page=1&limit=50$/);
  assert.strictEqual(forgejo.withFetcher(() => ({ status: 502, body: '' }), () => forgejo.create('/r', ENG).labelActors(7, 'ci-grant')), null);
});
