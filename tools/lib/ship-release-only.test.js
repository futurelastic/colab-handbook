'use strict';
/**
 * #736: the release-only red-trunk door, end to end — real CLI, real repo, real bare `origin`, a node
 * `gh` stub (copied from ship-github-branch-ci.test.js, as the ship tests do) whose run answers come
 * from a state file keyed by `--branch <ref>` / `--commit <sha>`, and whose `run view --json jobs`
 * answers come from `jobs[<runId>]`.
 *
 * Pinned (the issue's Done-when):
 *   - trunk red only on a declared release-only check → a branch that does not touch its paths is READY,
 *     and the row, `releaseOnly`, and (real ship) the `CI-Release-Only:` trailer name the ignored red;
 *   - a branch that touches those paths is held;
 *   - a repo with no declaration refuses exactly as before;
 *   - `colab release cut` on that red commit still refuses (release-cut-cli.test.js #736).
 *
 * Run: `node --test tools/lib/ship-release-only.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const SESSION = 'https://claude.ai/code/session_release_only_S';
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
if (a[0] === 'run' && a[1] === 'view' && val('--json') === 'jobs') {
  const j = (st.jobs || {})[a[2]];
  if (!j) process.exit(1);
  out({ jobs: j });
}
if (a[0] === 'issue' && a[1] === 'view') out({ state: 'OPEN', labels: [], comments: [{ body: 'fixture' }], body: '' });
if (a[0] === 'issue' || a[0] === 'label') process.exit(0);
process.stderr.write('fixture gh: refusing ' + a.join(' ') + '\\n');
process.exit(1);
`;

function fixture(yml = YML) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-release-only-'));
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
  g(work, 'config', 'user.name', 'release-only test');
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
function branch(fx, name, num, file = 'g.js') {
  fx.g(fx.work, 'branch', name);
  assert.strictEqual(colab(fx, ['claim', String(num), '--branch', name, '--repo', fx.work]).code, 0);
  fx.g(fx.work, 'checkout', '-q', name);
  fs.mkdirSync(path.dirname(path.join(fx.work, file)), { recursive: true });
  fs.writeFileSync(path.join(fx.work, file), `module.exports = ${num};\n`);
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
const GREEN = { status: 'completed', conclusion: 'success' };
const DECL = 'release-only-checks:\n  Install smoke: [packaging/, scripts/install.sh]\n';
// Trunk: CI green, the release-only "Install smoke" red. The branch's own head: CI green.
const TRUNK_RO_RED = (br) => ({
  branches: { main: [{ ...GREEN, workflowName: 'CI' }, { ...RED, workflowName: 'Install smoke' }], [br]: { ...GREEN, workflowName: 'CI' } },
  commitDefault: [{ ...GREEN, workflowName: 'CI' }, { ...RED, workflowName: 'Install smoke' }],
});

test('#736 ship --dry: trunk red ONLY on a declared release-only check, branch outside its paths → READY, the ignored red named', () => {
  const fx = fixture(`${YML}${DECL}`);
  branch(fx, 'fix/ro-81', 81);
  fx.setState(TRUNK_RO_RED('fix/ro-81'));
  const d = dry(fx, 'fix/ro-81');
  const row = d.row('trunk CI green');
  assert.strictEqual(row.ok, true, JSON.stringify(row));
  assert.match(row.detail, /PRECONDITION OVERRIDDEN by the release-only door \(#736\)/);
  assert.match(row.detail, /IGNORED for this merge: Install smoke \(run 8\)/);
  assert.match(row.detail, /still blocks a release cut/);
  assert.ok(d.j.releaseOnly, 'the --dry --json payload carries the door');
  assert.strictEqual(d.j.releaseOnly.ok, true);
  assert.deepStrictEqual(d.j.releaseOnly.ignored.map((x) => [x.check, x.runId, x.conclusion]), [['Install smoke', 8, 'failure']]);
  assert.strictEqual(d.j.ciCure, null, 'the door admitted first — the cure rule is never consulted');
  assert.strictEqual(d.j.ok, true, JSON.stringify(d.j.checks.filter((c) => !c.ok)));
});

test('#736 ship --dry: a branch that touches a path the red check covers is held, the reason naming path and check', () => {
  const fx = fixture(`${YML}${DECL}`);
  branch(fx, 'fix/ro-touch-82', 82, 'packaging/build.js');
  fx.setState(TRUNK_RO_RED('fix/ro-touch-82'));
  const d = dry(fx, 'fix/ro-touch-82');
  const row = d.row('trunk CI green');
  assert.strictEqual(row.ok, false, JSON.stringify(row));
  assert.match(row.detail, /release-only door \(#736\): the branch touches what a red release-only check covers \(packaging\/build\.js — covered by "Install smoke"\)/);
  assert.strictEqual(d.j.releaseOnly.ok, false);
  assert.deepStrictEqual(d.j.releaseOnly.touched, [{ check: 'Install smoke', paths: ['packaging/build.js'] }]);
  assert.ok(d.j.ciCure, 'a refusal falls through to the cure rule, as before');
  assert.strictEqual(d.j.ok, false);
});

test('#736 ship --dry: no declaration → the same red refuses exactly as before, no releaseOnly payload', () => {
  const fx = fixture();
  branch(fx, 'fix/ro-none-83', 83);
  fx.setState(TRUNK_RO_RED('fix/ro-none-83'));
  const d = dry(fx, 'fix/ro-none-83');
  const row = d.row('trunk CI green');
  assert.strictEqual(row.ok, false, JSON.stringify(row));
  assert.doesNotMatch(row.detail, /release-only/);
  assert.strictEqual(d.j.releaseOnly, null);
  assert.strictEqual(d.j.ok, false);
});

test('#736 ship --dry: an invalid declaration exempts nothing (the audit reports it)', () => {
  const fx = fixture(`${YML}release-only-checks:\n  Install smoke: []\n`);
  branch(fx, 'fix/ro-bad-84', 84);
  fx.setState(TRUNK_RO_RED('fix/ro-bad-84'));
  const d = dry(fx, 'fix/ro-bad-84');
  assert.strictEqual(d.row('trunk CI green').ok, false);
  assert.strictEqual(d.j.releaseOnly, null);
});

test('#736 ship --dry: a red on an undeclared workflow beside the release-only one still refuses', () => {
  const fx = fixture(`${YML}${DECL}`);
  branch(fx, 'fix/ro-mixed-85', 85);
  const reds = [{ ...RED, workflowName: 'CI' }, { ...RED, workflowName: 'Install smoke' }, { ...GREEN, workflowName: 'Lint' }];
  fx.setState({ branches: { main: reds, 'fix/ro-mixed-85': { ...GREEN, workflowName: 'CI' } }, commitDefault: reds });
  const d = dry(fx, 'fix/ro-mixed-85');
  assert.strictEqual(d.row('trunk CI green').ok, false);
  assert.match(d.row('trunk CI green').detail, /release-only door \(#736\): trunk is also red on CI \(run 7\), which is not a release-only check/);
});

test('#736 ship --dry: job level — trunk CI red only on a declared job of it → READY', () => {
  const fx = fixture(`${YML}release-only-checks:\n  "CI / install (*)": [installer/]\n`);
  branch(fx, 'fix/ro-job-86', 86);
  const trunk = [{ ...RED, workflowName: 'CI' }];
  fx.setState({
    branches: { main: trunk, 'fix/ro-job-86': { ...GREEN, workflowName: 'CI' } }, commitDefault: trunk,
    jobs: { 7: [{ name: 'test', status: 'completed', conclusion: 'success' }, { name: 'install (macos-latest)', status: 'completed', conclusion: 'failure' }] },
  });
  const d = dry(fx, 'fix/ro-job-86');
  const row = d.row('trunk CI green');
  assert.strictEqual(row.ok, true, JSON.stringify(row));
  assert.match(row.detail, /IGNORED for this merge: CI \/ install \(macos-latest\) \(run 7\)/);
});

test('#736 real ship: lands over the release-only red, and the squash carries a CI-Release-Only: trailer', () => {
  const fx = fixture(`${YML}${DECL}`);
  branch(fx, 'fix/ro-land-87', 87);
  fx.setState(TRUNK_RO_RED('fix/ro-land-87'));
  const r = colab(fx, ['ship', '--branch', 'fix/ro-land-87', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out + r.err, /trunk CI green ONLY because the red is on release-only check\(s\), ignored for this merge: Install smoke \(run 8\)/);
  const msg = fx.g(fx.origin, 'log', '-1', '--format=%B', 'main');
  assert.match(msg, /Closes #87/);
  assert.match(msg, /^CI-Release-Only: branch fix\/ro-land-87 over-red main@[0-9a-f]{7} ignored Install smoke \(run 8\)$/m);
  assert.doesNotMatch(msg, /^CI-(Grant|Cure):/m, 'never a trailer the anti-stacking scan reads');
});
