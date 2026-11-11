'use strict';
/**
 * #691: on a GitHub remote, `colab ship` refuses a branch whose head's run FINISHED red — the
 * GitHub half of #682's `branch CI green at its head` row (ship-forgejo-branch-ci.test.js is the
 * forge half).
 *
 * Measured before the fix: `colab ship --dry --json` read READY on every row for a head whose
 * required secret-scan job had failed before scanning — `headCi` was null on GitHub, and the
 * stale-base row only asks whether the run saw the base. Only the coordinator's own `gh run list`
 * (code-ship B1a) showed the red.
 *
 * What stays as it was on GitHub, and is pinned here: no run, a run in flight and a green head add
 * no row; a red run the verifying-runs policy sets aside (#503) never refuses; a cancelled or
 * skipped run is not "finished red" (#606's docs-only rule); and with trunk red, a green head adds
 * no row, so the cure / ci-grant doors (which already demand a green head) read exactly as before.
 *
 * Real CLI, real repo, real bare `origin`; `gh` is a node stub whose run answers come from a state
 * file each test writes — keyed by `--branch <ref>` and by `--commit <sha>` (the
 * ship-docs-only-ci.test.js stub, copied rather than shared, as the other ship tests do).
 *
 * Run: `node --test tools/lib/ship-github-branch-ci.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const SESSION = 'https://claude.ai/code/session_github_branch_ci_S';
const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const HEAD_ROW = 'branch CI green at its head (#682)';
const STALE_ROW = 'branch run contains current base (#395)';

const TMP = [];
process.on('exit', () => { for (const dir of TMP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } });

const GH_STUB = (state, log, origin) => `#!/usr/bin/env node
const fs = require('fs');
const { execFileSync } = require('child_process');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(' ') + '\\n');
const st = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const out = (x) => { process.stdout.write(typeof x === 'string' ? x + '\\n' : JSON.stringify(x) + '\\n'); process.exit(0); };
if (a[0] === '--version') out('gh version 0.0.0 (fixture)');
if (a[0] === 'auth') process.exit(0);
if (a[0] === 'api' && a[1] === 'user') out('me');
if (a[0] === 'run' && a[1] === 'list') {
  const br = val('--branch');
  const commit = val('--commit');
  let sha = commit;
  if (!sha) { try { sha = execFileSync('git', ['rev-parse', 'refs/heads/' + br], { cwd: ${JSON.stringify(origin)}, encoding: 'utf8' }).trim(); } catch (_) { out('[]'); } }
  const s = commit ? (st.commits || {})[commit] ?? st.commitDefault : (st.branches || {})[br];
  const r = s === undefined ? { status: 'completed', conclusion: 'success' } : s;
  if (r === 'none') out('[]');
  const row = (x, i) => ({ headSha: sha, status: x.status, conclusion: x.conclusion, databaseId: 7 + i, workflowName: x.workflowName || 'CI', event: x.event || 'push',
    createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:01:00Z', attempt: 1 });
  out((Array.isArray(r) ? r : [r]).map(row));
}
if (a[0] === 'issue' && a[1] === 'view') out({ state: 'OPEN', labels: [], comments: [{ body: 'fixture' }], body: '' });
if (a[0] === 'issue' || a[0] === 'label') process.exit(0);
process.stderr.write('fixture gh: refusing ' + a.join(' ') + '\\n');
process.exit(1);
`;

function fixture(yml = YML) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-gh-branch-ci-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  const state = path.join(root, 'gh-state.json');
  fs.mkdirSync(home);
  fs.writeFileSync(state, '{}');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'github branch-ci test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\njobs: {}\n');
  fs.writeFileSync(path.join(work, 'f.js'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), GH_STUB(state, ghLog, origin), { mode: 0o755 });
  const setState = (s) => fs.writeFileSync(state, JSON.stringify(s));
  return { root, work, origin, home, bin, ghLog, g, setState };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** A CODE branch off main (so the docs-only door stays shut), claimed as `num`, pushed; main checked out. */
function branch(fx, name, num) {
  fx.g(fx.work, 'branch', name);
  assert.strictEqual(colab(fx, ['claim', String(num), '--branch', name, '--repo', fx.work]).code, 0);
  fx.g(fx.work, 'checkout', '-q', name);
  fs.writeFileSync(path.join(fx.work, 'g.js'), `module.exports = ${num};\n`);
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `fix: change (#${num})`);
  fx.g(fx.work, 'push', '-q', 'origin', name);
  fx.g(fx.work, 'checkout', '-q', 'main');
}

function dry(fx, name) {
  const r = colab(fx, ['ship', '--branch', name, '--repo', fx.work, '--dry', '--json']);
  let j;
  try { j = JSON.parse(r.out); } catch (_) { assert.fail(`not JSON (exit ${r.code}): ${r.out}\n${r.err}`); }
  return { j, row: (n) => j.checks.find((c) => c.name === n), names: j.checks.map((c) => c.name) };
}

const RED = { status: 'completed', conclusion: 'failure' };

test('#691 ship --dry: a head whose run finished red refuses, human-gated and named — it read READY before', () => {
  const fx = fixture();
  branch(fx, 'fix/red-71', 71);
  fx.setState({ branches: { 'fix/red-71': [{ ...RED, workflowName: 'Secret scan' }, { status: 'completed', conclusion: 'success', workflowName: 'CI' }] } });
  const d = dry(fx, 'fix/red-71');
  assert.strictEqual(d.row('trunk CI green').ok, true, JSON.stringify(d.row('trunk CI green')));
  assert.strictEqual(d.row(STALE_ROW).ok, true, 'the head contains trunk — the stale-base row alone passes, which was the bug');
  const head = d.row(HEAD_ROW);
  assert.ok(head, `no branch-head row: ${JSON.stringify(d.names)}`);
  assert.deepStrictEqual([head.ok, head.class, head.verdict], [false, 'human-gated', 'red'], JSON.stringify(head));
  assert.match(head.detail, /^fix\/red-71@[0-9a-f]{7} \(GitHub Actions\) finished red — failing: Secret scan \(failure\)\./);
  assert.strictEqual(d.j.ok, false, 'the dry run is not READY');
});

test('#691 real ship: the same red head refuses and lands nothing, the row printed in the prose table', () => {
  const fx = fixture();
  branch(fx, 'fix/red-72', 72);
  fx.setState({ branches: { 'fix/red-72': RED } });
  const r = colab(fx, ['ship', '--branch', 'fix/red-72', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out + r.err, /✗ +branch CI green at its head \(#682\)/);
  assert.doesNotMatch(fx.g(fx.work, 'log', '--format=%s', 'main'), /#72/);
});

test('#691 ship --dry: a green head, a run in flight and no run at all add no row — GitHub reads as before', () => {
  const fx = fixture();
  branch(fx, 'fix/states-73', 73);
  for (const s of [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }, 'none']) {
    fx.setState({ branches: { 'fix/states-73': s } });
    const d = dry(fx, 'fix/states-73');
    assert.strictEqual(d.row(HEAD_ROW), undefined, `${JSON.stringify(s)}: ${JSON.stringify(d.names)}`);
    assert.strictEqual(d.row(STALE_ROW).ok, true, JSON.stringify(s));
    if (s !== 'none' && s.status === 'completed') assert.strictEqual(d.j.ok, true, JSON.stringify(d.j.checks.filter((c) => !c.ok)));
  }
});

test('#691 ship --dry: one workflow red while another still runs is already finished red', () => {
  const fx = fixture();
  branch(fx, 'fix/mixed-74', 74);
  fx.setState({ branches: { 'fix/mixed-74': [{ status: 'in_progress', conclusion: null, workflowName: 'CI' }, { ...RED, workflowName: 'Lint' }] } });
  const head = dry(fx, 'fix/mixed-74').row(HEAD_ROW);
  assert.deepStrictEqual([head && head.ok, head && head.verdict], [false, 'red'], JSON.stringify(head));
  assert.match(head.detail, /failing: Lint \(failure\)/);
});

test('#691 ship --dry: cancelled or skipped is not finished red (#606 docs-only rule) — no row', () => {
  const fx = fixture();
  branch(fx, 'fix/neutral-75', 75);
  for (const conclusion of ['cancelled', 'skipped']) {
    fx.setState({ branches: { 'fix/neutral-75': { status: 'completed', conclusion } } });
    assert.strictEqual(dry(fx, 'fix/neutral-75').row(HEAD_ROW), undefined, conclusion);
  }
});

test('#691 ship --dry: a skipped workflow beside a failing one still names the failure', () => {
  const fx = fixture();
  branch(fx, 'fix/skip-red-76', 76);
  fx.setState({ branches: { 'fix/skip-red-76': [{ status: 'completed', conclusion: 'skipped', workflowName: 'Preview' }, { ...RED, workflowName: 'CI' }] } });
  const head = dry(fx, 'fix/skip-red-76').row(HEAD_ROW);
  assert.ok(head, 'a red run beside a skipped one is still red');
  assert.match(head.detail, /failing: CI \(failure\)\./);
  assert.doesNotMatch(head.detail, /Preview/);
});

test('#691 ship --dry: a red run the verifying-runs policy sets aside (ship-ignore-workflows) never refuses', () => {
  const fx = fixture(`${YML}ship-ignore-workflows: [Deploy]\n`);
  branch(fx, 'fix/ignored-77', 77);
  fx.setState({ branches: { 'fix/ignored-77': [{ ...RED, workflowName: 'Deploy' }, { status: 'completed', conclusion: 'success', workflowName: 'CI' }] } });
  const d = dry(fx, 'fix/ignored-77');
  assert.strictEqual(d.row(HEAD_ROW), undefined, JSON.stringify(d.row(HEAD_ROW)));
});

test('#691 ship --dry: with trunk red, a GREEN head adds no row — the cure / ci-grant doors read exactly as before', () => {
  const fx = fixture();
  branch(fx, 'fix/cure-78', 78);
  fx.setState({ branches: { main: RED, 'fix/cure-78': { status: 'completed', conclusion: 'success' } }, commitDefault: RED });
  const d = dry(fx, 'fix/cure-78');
  assert.strictEqual(d.row('trunk CI green').ok, false, 'trunk is red — the trunk row (and its doors) decide');
  assert.strictEqual(d.row(HEAD_ROW), undefined, 'a green head never adds this row');
  // The cure door is consulted and reads the branch head green by its own read — this row neither
  // replaces nor pre-empts it. (It still declines here: the stub has no job-level evidence, #297.)
  assert.ok(d.j.ciCure, 'the cure door was consulted');
  assert.match(d.j.ciCure.reason, /^branch's run is green, but/, JSON.stringify(d.j.ciCure));
});

test('#723 ship --dry: only an unrelated workflow ran at the head and CI (fired by its definition) never did — not READY, the row names CI', () => {
  const fx = fixture();
  branch(fx, 'fix/no-ci-run-79', 79);
  fx.setState({ branches: { 'fix/no-ci-run-79': [{ status: 'completed', conclusion: 'success', workflowName: 'instruction-files' }] } });
  const d = dry(fx, 'fix/no-ci-run-79');
  assert.strictEqual(d.row(STALE_ROW).ok, true, 'the stale-base row is satisfied by the instruction-files run — which was the bug');
  const head = d.row(HEAD_ROW);
  assert.ok(head, `no branch-head row: ${JSON.stringify(d.names)}`);
  assert.deepStrictEqual([head.ok, head.class, head.verdict], [false, 'self-clearing', 'pending'], JSON.stringify(head));
  assert.match(head.detail, /has no run of CI, though its definition fires on a push to this branch/);
  assert.match(head.detail, /colab ci-wait --sha [0-9a-f]{40} --branch fix\/no-ci-run-79/);
  assert.strictEqual(d.j.ok, false, 'the dry run is not READY');
  // Once CI has its run there, the row is gone and the head reads as before.
  fx.setState({ branches: { 'fix/no-ci-run-79': [{ status: 'completed', conclusion: 'success', workflowName: 'instruction-files' }, { status: 'completed', conclusion: 'success', workflowName: 'CI' }] } });
  const d2 = dry(fx, 'fix/no-ci-run-79');
  assert.strictEqual(d2.row(HEAD_ROW), undefined, JSON.stringify(d2.row(HEAD_ROW)));
  assert.strictEqual(d2.j.ok, true, JSON.stringify(d2.j.checks.filter((c) => !c.ok)));
});
