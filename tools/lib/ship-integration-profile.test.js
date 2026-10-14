'use strict';
/**
 * #610 — `integration-profile: gated`: `colab ship` lands a code change only on a green heavy run at
 * the branch's remote head. Every other profile (and an absent key) leaves ship exactly as it was.
 *
 * Real CLI, real repo, real bare `origin` on disk, no network. The fake `gh` answers `run list` from
 * a JSON state file (light `CI` push runs at trunk and the branch head, plus whatever heavy rows the
 * test puts there), logs every call, and accepts `workflow run` (the dispatch).
 *
 * Run: `node --test tools/lib/ship-integration-profile.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const FAKE_GH = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.dirname(process.argv[1]);
const a = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'gh.log'), a.join(' ') + '\\n');
const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
if (a[0] === '--version') { console.log('gh version 0.0.0 (fixture)'); process.exit(0); }
if (a[0] === 'auth' && a[1] === 'status') { console.error('Logged in to github.com (fixture)'); process.exit(0); }
if (a[0] === 'run' && a[1] === 'list') {
  const i = a.indexOf('--commit');
  const rows = i >= 0 ? st.runs.filter((r) => r.headSha === a[i + 1]) : st.runs;
  console.log(JSON.stringify(rows)); process.exit(0);
}
if (a[0] === 'workflow' && a[1] === 'run') process.exit(0);
console.error('fixture gh: refusing ' + a.join(' ')); process.exit(1);
`;

const HEAVY_YML = 'name: CI (heavy)\non:\n  workflow_dispatch:\n    inputs:\n      ref:\n        required: false\njobs: {}\n';
const CI_YML = 'name: CI\non:\n  push:\n    branches: ["**"]\njobs: {}\n';
const BASE_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

/** Trunk with CI (and, unless `heavy: false`, the heavy lane), one pushed code branch claimed for #7. */
function fixture({ profile = 'gated', heavy = true, docs = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ship-profile-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(home); fs.mkdirSync(bin);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'ship profile test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), BASE_YML + (profile ? `integration-profile: ${profile}\n` : ''));
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), CI_YML);
  if (heavy) fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci-heavy.yml'), HEAVY_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g('add', '-A'); g('commit', '-q', '-m', 'chore: fixture'); g('push', '-q', 'origin', 'main');
  const trunkSha = g('rev-parse', 'HEAD');
  const branch = docs ? 'docs/readme-7' : 'feat/thing-7';
  g('checkout', '-q', '-b', branch);
  if (docs) fs.writeFileSync(path.join(work, 'README.md'), '# x\n');
  else fs.writeFileSync(path.join(work, 'g.js'), 'module.exports = 1;\n');
  g('add', '-A'); g('commit', '-q', '-m', docs ? 'docs: readme (#7)' : 'feat: thing (#7)');
  const head = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');
  const light = (sha, branchName, id) => ({ headSha: sha, headBranch: branchName, status: 'completed', conclusion: 'success', workflowName: 'CI', event: 'push', databaseId: id, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:05:00Z', attempt: 1 });
  const fx = { root, work, home, bin, g, trunkSha, head, branch, runs: [light(trunkSha, 'main', 1), light(head, branch, 2)] };
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  setHeavy(fx, []);
  const c = colab(fx, ['claim', '7', '--branch', branch, '--repo', work]);
  // Claim first, then push: a remote branch carrying #7 that this machine never claimed reads as
  // another machine's work, and the claim is refused.
  g('push', '-q', 'origin', branch);
  fx.claimOut = c.out + c.err;
  return fx;
}

function setHeavy(fx, heavyRows) {
  const rows = heavyRows.map((r, i) => ({ headSha: fx.head, headBranch: fx.branch, workflowName: 'CI (heavy)', event: 'workflow_dispatch', databaseId: 100 + i, createdAt: `2026-10-14T01:0${i}:00Z`, attempt: 1, ...r }));
  fs.writeFileSync(path.join(fx.bin, 'state.json'), JSON.stringify({ runs: [...fx.runs, ...rows] }));
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-ship-profile-test', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const ROW = /heavy lane green \(integration-profile: gated, #610\)/;
function dryJson(fx) {
  const r = colab(fx, ['ship', '--branch', fx.branch, '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  return { body, row: body.checks.find((c) => ROW.test(c.name)) };
}
const ghLog = (fx) => { try { return fs.readFileSync(path.join(fx.bin, 'gh.log'), 'utf8'); } catch (_) { return ''; } };

test('no profile declared: no heavy row, ship reads the light lane as before', () => {
  const fx = fixture({ profile: null });
  const { body, row } = dryJson(fx);
  assert.strictEqual(row, undefined);
  assert.strictEqual(body.ok, true, JSON.stringify(body.checks.filter((c) => !c.ok)));
});

test('release-heavy and qualify: no heavy row either — only gated gates a landing', () => {
  for (const profile of ['release-heavy', 'qualify']) {
    assert.strictEqual(dryJson(fixture({ profile })).row, undefined, profile);
  }
});

test('gated, heavy green at the branch head: the row passes and the ship is ready', () => {
  const fx = fixture();
  setHeavy(fx, [{ status: 'completed', conclusion: 'success' }]);
  const { body, row } = dryJson(fx);
  assert.strictEqual(row.ok, true, row.detail);
  assert.match(row.detail, /heavy lane green at feat\/thing-7@/);
  assert.strictEqual(body.ok, true, JSON.stringify(body.checks.filter((c) => !c.ok)));
});

test('gated, no heavy run yet: self-clearing in --dry --json; a real ship dispatches it and pauses (exit 3), nothing landed', () => {
  const fx = fixture();
  const { body, row } = dryJson(fx);
  assert.deepStrictEqual([row.ok, row.action, row.class], [false, 'dispatch', 'self-clearing']);
  assert.strictEqual(body.ok, false);
  assert.doesNotMatch(ghLog(fx), /workflow run/, '--dry never dispatches');
  const r = colab(fx, ['ship', '--branch', fx.branch, '--repo', fx.work]);
  assert.strictEqual(r.code, 3, r.out + r.err);
  assert.match(r.out, /⏸ HEAVY-PENDING feat\/thing-7/);
  assert.match(ghLog(fx), new RegExp(`workflow run ci-heavy\\.yml --ref feat/thing-7 -f ref=${fx.head}`));
  assert.strictEqual(fx.g('rev-parse', 'origin/main'), fx.trunkSha, 'trunk did not move');
});

test('gated, heavy still running: a pause, no second dispatch', () => {
  const fx = fixture();
  setHeavy(fx, [{ status: 'in_progress', conclusion: null }]);
  const r = colab(fx, ['ship', '--branch', fx.branch, '--repo', fx.work]);
  assert.strictEqual(r.code, 3, r.out + r.err);
  assert.doesNotMatch(ghLog(fx), /workflow run/);
});

test('gated, heavy red: the row fails (human-gated) and a real ship aborts with nothing pushed', () => {
  const fx = fixture();
  setHeavy(fx, [{ status: 'completed', conclusion: 'failure' }]);
  const { row } = dryJson(fx);
  assert.deepStrictEqual([row.ok, row.action, row.class], [false, 'refuse', 'human-gated']);
  const r = colab(fx, ['ship', '--branch', fx.branch, '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /Aborting: one or more preconditions failed/);
  assert.strictEqual(fx.g('rev-parse', 'origin/main'), fx.trunkSha);
});

test('gated with no heavy workflow in the tree: refused, naming the fix', () => {
  const { row } = dryJson(fixture({ heavy: false }));
  assert.deepStrictEqual([row.ok, row.action], [false, 'refuse']);
  assert.match(row.detail, /no \.github\/workflows\/ci-heavy\.yml at feat\/thing-7@[0-9a-f]+ .*templates\/ci-<stack>-heavy\.yml/);
});

test('gated, docs-only change: exempt — docs never wait on CI (#606)', () => {
  assert.strictEqual(dryJson(fixture({ docs: true })).row, undefined);
});

test('integration-profile: promote — colab promote needs the heavy lane green at the promoted trunk tip', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-promote-profile-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(bin); fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g('config', 'user.email', 'test@example.invalid'); g('config', 'user.name', 'promote profile test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks')); g('remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  // deploy: tag + promotion: main-loop — the one cell where a promotion verifies and deploys nothing.
  fs.writeFileSync(path.join(work, '.github', 'project.yml'),
    'exposure: released\ntrunk: dev\nproduction: https://example.invalid\ndeploy: tag\nstack: node\npromotion: main-loop\nintegration-profile: promote\n');
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci-heavy.yml'), HEAVY_YML);
  g('add', '-A'); g('commit', '-q', '-m', 'chore: fixture'); g('push', '-q', 'origin', 'main');
  g('checkout', '-q', '-b', 'dev'); fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  g('add', '-A'); g('commit', '-q', '-m', 'feat: a'); g('push', '-q', 'origin', 'dev');
  const tip = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  const ci = { headSha: tip, status: 'completed', conclusion: 'success', workflowName: 'CI', event: 'push', databaseId: 1, createdAt: '2026-10-14T00:00:00Z' };
  const fx = { bin, home };
  const run = () => colab(fx, ['promote', '--dry', '--repo', work]);

  fs.writeFileSync(path.join(bin, 'state.json'), JSON.stringify({ runs: [ci] }));
  const none = run();
  assert.match(none.out, new RegExp(`✗ +heavy lane green \\(integration-profile: promote, #610\\) +heavy lane none at dev@[0-9a-f]+ .*gh workflow run ci-heavy\\.yml --ref dev -f ref=${tip}`));
  assert.match(none.out, /NOT READY/);
  assert.doesNotMatch(fs.readFileSync(path.join(bin, 'gh.log'), 'utf8'), /workflow run/, 'promote never dispatches');

  fs.writeFileSync(path.join(bin, 'state.json'), JSON.stringify({ runs: [ci, { ...ci, workflowName: 'CI (heavy)', event: 'workflow_dispatch', databaseId: 2, createdAt: '2026-10-14T01:00:00Z' }] }));
  const green = run();
  assert.match(green.out, /✓ +heavy lane green \(integration-profile: promote, #610\) +heavy lane green at dev@/);
  assert.match(green.out, /→ READY/);
});
