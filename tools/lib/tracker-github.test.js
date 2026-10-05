'use strict';
/**
 * Tests for tools/lib/tracker.js (the contract) and tools/lib/tracker-github.js (its one
 * implementation) — #500.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The refactor is behaviour-preserving by claim, so the claim is pinned here: the argv table below
 * repeats, literally, the `gh` argv each replaced call site in tools/colab spawned before #500. A
 * method that drifts from it fails here before any CLI test notices a changed reply.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tracker = require('./tracker');
const gh = require('./tracker-github');
const git = require('./git');

const REPO = '/repo/under/test';

/** Record every spawn; answer each with `reply(args)` (default: ok, empty stdout). */
function recorder(reply = () => ({})) {
  const calls = [];
  const fn = (args, opts) => {
    calls.push({ args, opts });
    return { ok: true, code: 0, stdout: '', stderr: '', error: null, timedOut: false, ...reply(args) };
  };
  return { calls, fn };
}

test('the github adapter implements every method of the contract', () => {
  const impl = gh.create(REPO);
  assert.strictEqual(tracker.assertImplements(impl, 'github'), impl);
  for (const m of tracker.METHODS) {
    assert.strictEqual(typeof impl[m.name], 'function', m.name);
    assert.ok(m.kind === 'read' || m.kind === 'write', `${m.name}: kind ${m.kind}`);
  }
  assert.strictEqual(tracker.forRepo(REPO).repo, REPO);
});

test('assertImplements names every missing method; forRepo refuses an unknown kind', () => {
  assert.throws(() => tracker.assertImplements({ state() {} }, 'fake'), /fake does not implement .*missing currentLogin, issueView/);
  assert.throws(() => tracker.assertImplements(null), /missing state/);
  assert.throws(() => tracker.forRepo(REPO, { kind: 'jira' }), /unknown tracker kind "jira"/);
});

// [call, the argv tools/colab spawned before #500, extra spawn options it passed beyond cwd]
const ARGV = [
  [(t) => t.issueListAll({ limit: 5000, fields: ['number', 'state', 'stateReason', 'body', 'title', 'labels', 'createdAt', 'closedAt', 'url'], maxBuffer: 512 * 1024 * 1024 }),
    ['issue', 'list', '--state', 'all', '--limit', '5000', '--json', 'number,state,stateReason,body,title,labels,createdAt,closedAt,url'],
    { maxBuffer: 512 * 1024 * 1024 }],
  [(t) => t.issueClose(12), ['issue', 'close', '12']],
  [(t) => t.issueClose(12, { reason: 'not planned' }), ['issue', 'close', '12', '--reason', 'not planned']],
  [(t) => t.issueClose(12, { reason: 'completed' }), ['issue', 'close', '12', '--reason', 'completed']],
  [(t) => t.issueCreate({ title: 'T', body: 'B' }), ['issue', 'create', '--title', 'T', '--body', 'B']],
  [(t) => t.releaseView('v1.2.0'), ['release', 'view', 'v1.2.0', '--json', 'tagName']],
  [(t) => t.releaseCreate('v1.2.1-rc.1', { notesFile: '/n.md' }),
    ['release', 'create', 'v1.2.1-rc.1', '--verify-tag', '--title', 'v1.2.1-rc.1', '--notes-file', '/n.md', '--prerelease', '--latest=false']],
  [(t) => t.releaseCreate('v1.2.1', { notesFile: '/n.md', final: true }),
    ['release', 'create', 'v1.2.1', '--verify-tag', '--title', 'v1.2.1', '--notes-file', '/n.md', '--latest']],
  [(t) => t.runList({ branch: 'main', limit: 100, fields: ['conclusion', 'status', 'createdAt'] }),
    ['run', 'list', '--branch', 'main', '-L', '100', '--json', 'conclusion,status,createdAt']],
  [(t) => t.runList({ branch: 'main', commit: 'abc123', limit: 50, fields: ['status', 'conclusion', 'event', 'createdAt', 'updatedAt', 'workflowName'] }),
    ['run', 'list', '--branch', 'main', '--commit', 'abc123', '-L', '50', '--json', 'status,conclusion,event,createdAt,updatedAt,workflowName']],
  [(t) => t.prList({ base: 'owner-main', head: 'main', state: 'all', limit: 50, fields: ['number', 'url', 'state', 'mergedAt', 'headRefOid', 'title'] }),
    ['pr', 'list', '--base', 'owner-main', '--head', 'main', '--state', 'all', '--limit', '50', '--json', 'number,url,state,mergedAt,headRefOid,title']],
  [(t) => t.prEdit(7, { title: 'T', body: 'B' }), ['pr', 'edit', '7', '--title', 'T', '--body', 'B']],
];

test('every new method spawns exactly the argv and options the call site it replaced did', () => {
  for (const [call, argv, extra = {}] of ARGV) {
    const rec = recorder();
    gh.withRunner(rec.fn, () => call(gh.create(REPO)));
    assert.strictEqual(rec.calls.length, 1, argv.join(' '));
    assert.deepStrictEqual(rec.calls[0].args, argv);
    assert.deepStrictEqual(rec.calls[0].opts, { cwd: REPO, ...extra }, argv.join(' '));
  }
});

test('git.js gh* helpers reach gh only through the adapter', () => {
  const viaHelper = recorder(() => ({ stdout: 'bug\nin-progress' }));
  const a = gh.withRunner(viaHelper.fn, () => git.ghListLabels(REPO));
  const viaContract = recorder(() => ({ stdout: 'bug\nin-progress' }));
  const b = gh.withRunner(viaContract.fn, () => gh.create(REPO).labelList());
  assert.deepStrictEqual(a, ['bug', 'in-progress']);
  assert.deepStrictEqual(b, a);
  assert.deepStrictEqual(viaHelper.calls, viaContract.calls);
  assert.deepStrictEqual(viaHelper.calls[0].args, ['label', 'list', '--limit', '500', '--json', 'name', '-q', '.[].name']);
});

test('withRunner restores the previous runner, even when the body throws', () => {
  const outer = recorder();
  const inner = recorder();
  gh.withRunner(outer.fn, () => {
    assert.throws(() => gh.withRunner(inner.fn, () => { gh.exec(['x']); throw new Error('boom'); }), /boom/);
    gh.exec(['y']);
  });
  assert.deepStrictEqual(inner.calls.map((c) => c.args), [['x']]);
  assert.deepStrictEqual(outer.calls.map((c) => c.args), [['y']]);
});

test('issueCreate parses the number and URL; a failed or URL-less create yields null', () => {
  const t = gh.create(REPO);
  const ok = gh.withRunner(recorder(() => ({ stdout: 'https://github.com/o/r/issues/42' })).fn, () => t.issueCreate({ title: 'T', body: 'B' }));
  assert.strictEqual(ok.number, 42);
  assert.strictEqual(ok.url, 'https://github.com/o/r/issues/42');
  const failed = gh.withRunner(recorder(() => ({ ok: false, code: 1, stdout: 'https://github.com/o/r/issues/42', stderr: 'HTTP 403' })).fn, () => t.issueCreate({ title: 'T', body: 'B' }));
  assert.strictEqual(failed.number, null);
  assert.strictEqual(failed.stderr, 'HTTP 403');
  const blank = gh.withRunner(recorder(() => ({ stdout: '' })).fn, () => t.issueCreate({ title: 'T', body: 'B' }));
  assert.strictEqual(blank.number, null);
  assert.strictEqual(blank.url, null);
});

test('list reads carry data: parsed JSON, or null for failure, empty and unparseable output', () => {
  const t = gh.create(REPO);
  const read = (reply) => gh.withRunner(recorder(() => reply).fn, () => t.runList({ branch: 'main', limit: 1, fields: ['status'] }));
  assert.deepStrictEqual(read({ stdout: '[{"status":"completed"}]' }).data, [{ status: 'completed' }]);
  assert.strictEqual(read({ ok: false, code: 1, stdout: '[]' }).data, null);
  assert.strictEqual(read({ stdout: '' }).data, null); // empty is "could not read", never "none"
  assert.strictEqual(read({ stdout: 'not json' }).data, null);
  assert.strictEqual(read({ stdout: '[]' }).ok, true); // the git.run result shape rides along
});

test('the default runner spawns the gh found on PATH at call time', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-tracker-'));
  try {
    const log = path.join(dir, 'argv.log');
    fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`, { mode: 0o755 });
    const prev = process.env.PATH;
    process.env.PATH = `${dir}:${prev}`;
    let r;
    try { r = gh.create(dir).issueClose(7, { reason: 'completed' }); } finally { process.env.PATH = prev; }
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['issue', 'close', '7', '--reason', 'completed']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no gh spawn is left outside the adapter, and git.js never loads it at its top level', () => {
  const SPAWN = /\b(spawnSync|spawn|execFileSync|execSync|run)\(\s*['"`]gh['"`]/;
  for (const f of [path.join(__dirname, '..', 'colab'), path.join(__dirname, 'git.js')]) {
    const hits = fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => SPAWN.test(l));
    assert.deepStrictEqual(hits, [], `${path.basename(f)} spawns gh directly`);
  }
  const gitSrc = fs.readFileSync(path.join(__dirname, 'git.js'), 'utf8');
  assert.ok(!/^(const|let|var)\s.*require\(['"]\.\/tracker-github['"]\)/m.test(gitSrc), 'git.js must require tracker-github lazily (load-time cycle)');
  assert.ok(!/require\(['"]\.\/tracker['"]\)/.test(fs.readFileSync(path.join(__dirname, 'tracker-github.js'), 'utf8')), 'tracker-github must not require tracker');
});
