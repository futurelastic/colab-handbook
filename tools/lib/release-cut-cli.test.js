'use strict';
/**
 * Tests for `colab release cut` (#338) — the measuring half, end to end.
 *
 * Real CLI, real repo with a real bare `origin` on disk (no network), private COLAB_HOME, and a `gh`
 * stub that answers `run list` / `issue list` from JSON files the test rewrites per step — the
 * ship-ci-run-count.test.js shape. The pure decision has its own unit tests (release-cut.test.js);
 * this file proves each refusal is reached through the real measurement, that a refusal creates
 * nothing on origin, and that the green path produces -rc.1 then -rc.2 on the same version.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
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

const RELEASED_YML = 'trunk: main\nexposure: released\nproduction: null\ndeploy: none\nstack: node\n';

/**
 * A `released` repo on `main` with final tag v1.2.0 on its first commit, then one `fix:` commit
 * pushed — so the computed candidate is v1.2.1-rc.1. `files` land in the first commit.
 */
function fixture({ projectYml = RELEASED_YML, files = {}, lastFinal = 'v1.2.0' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-release-cut-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'release cut test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(work, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(work, f), body);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  if (lastFinal) g('tag', '-a', lastFinal, '-m', lastFinal);
  g('push', '-q', 'origin', 'main', '--tags');

  const runsFile = path.join(root, 'runs.json');
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, '[]');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "${runsFile}"; exit 0; fi`,
    `if [ "$1" = "issue" ] && [ "$2" = "list" ]; then cat "${issuesFile}"; exit 0; fi`,
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const fx = { root, origin, work, home, bin, g, runsFile, issuesFile };
  commit(fx, 'fix.txt', 'fix: a bug');
  return fx;
}

/** Commit `file`, push main, and mark the new head green (one successful `ci` run) unless told otherwise. */
function commit(fx, file, subject, content = `${subject}\n`, runs = [{}]) {
  fs.mkdirSync(path.join(fx.work, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(fx.work, file), content);
  fx.g('add', '-A');
  fx.g('commit', '-q', '-m', subject);
  fx.g('push', '-q', 'origin', 'main');
  setRuns(fx, runs);
}

function setRuns(fx, runs) {
  const sha = fx.g('rev-parse', 'HEAD');
  const rows = runs.map((r, i) => ({
    headSha: sha, status: 'completed', conclusion: 'success', workflowName: 'ci',
    createdAt: new Date().toISOString(), databaseId: 100 + i, ...r,
  }));
  fs.writeFileSync(fx.runsFile, JSON.stringify(rows));
}

function cut(fx, args = []) {
  const r = spawnSync('node', [COLAB, 'release', 'cut', '--repo', fx.work, '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-release-cut-test' },
  });
  let body = null;
  try { body = JSON.parse(r.stdout); } catch (_) { /* a UserError prints no JSON */ }
  return { code: r.status, body, out: r.stdout || '', err: r.stderr || '' };
}

function originTags(fx) {
  const out = execFileSync('git', ['ls-remote', '--tags', fx.origin], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((l) => l.split('\t')[1].replace(/^refs\/tags\//, '')).filter((t) => !t.endsWith('^{}')).sort();
}

/** Assert a refusal on `condition`, and that nothing reached origin. */
function assertRefused(fx, r, condition, pattern) {
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.ok(r.body, `no JSON: ${r.out}${r.err}`);
  assert.strictEqual(r.body.ok, false);
  assert.strictEqual(r.body.created, false);
  const check = r.body.checks.find((c) => c.condition === condition);
  assert.ok(check, `no ${condition} check in ${JSON.stringify(r.body.checks)}`);
  assert.strictEqual(check.ok, false, JSON.stringify(r.body.checks, null, 2));
  if (pattern) assert.match(check.detail, pattern);
  assert.deepStrictEqual(originTags(fx).filter((t) => t.includes('-rc.')), []);
}

// ---- green path -------------------------------------------------------------------------------

test('green path: -rc.1, then a new fix on main gives -rc.2 of the same version; the tag records its conditions', () => {
  const fx = fixture();

  const dry = cut(fx, ['--dry']);
  assert.strictEqual(dry.code, 0, dry.out + dry.err);
  assert.strictEqual(dry.body.tag, 'v1.2.1-rc.1');
  assert.strictEqual(dry.body.created, false);
  assert.deepStrictEqual(originTags(fx), ['v1.2.0'], '--dry creates nothing');

  const first = cut(fx);
  assert.strictEqual(first.code, 0, first.out + first.err);
  assert.strictEqual(first.body.tag, 'v1.2.1-rc.1');
  assert.strictEqual(first.body.created, true);
  assert.deepStrictEqual(originTags(fx), ['v1.2.0', 'v1.2.1-rc.1']);
  const rc1Sha = fx.g('rev-list', '-n', '1', 'v1.2.1-rc.1');
  assert.strictEqual(rc1Sha, fx.g('rev-parse', 'origin/main'));
  const message = fx.g('for-each-ref', '--format=%(contents)', 'refs/tags/v1.2.1-rc.1');
  assert.match(message, /Bump: patch/);
  assert.match(message, /- ci-green: /);
  assert.match(message, /- switch-dependencies: /);

  // Same commit again: nothing new to test.
  const again = cut(fx);
  assert.strictEqual(again.code, 1);
  assert.strictEqual(again.body.checks.find((c) => c.condition === 'already-candidate').ok, false);

  commit(fx, 'fix2.txt', 'fix: another bug');
  const second = cut(fx);
  assert.strictEqual(second.code, 0, second.out + second.err);
  assert.strictEqual(second.body.tag, 'v1.2.1-rc.2');
  assert.deepStrictEqual(originTags(fx), ['v1.2.0', 'v1.2.1-rc.1', 'v1.2.1-rc.2']);
  assert.ok(!originTags(fx).includes('v1.2.1'), 'never a final tag');
});

test('an override is honoured only with a reason, and the reason is recorded on the tag', () => {
  const fx = fixture();
  const noReason = spawnSync('node', [COLAB, 'release', 'cut', '--repo', fx.work, '--bump', 'minor'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home },
  });
  assert.strictEqual(noReason.status, 1);
  const r = cut(fx, ['--bump', 'minor', '--reason', 'the fix changes documented behaviour']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.tag, 'v1.3.0-rc.1');
  assert.deepStrictEqual(r.body.overridden, { from: 'patch', to: 'minor', reason: 'the fix changes documented behaviour' });
  assert.match(fx.g('for-each-ref', '--format=%(contents)', 'refs/tags/v1.3.0-rc.1'), /reason: the fix changes documented behaviour/);
});

test('pre-1.0: a breaking change is cut as a minor', () => {
  const fx = fixture({ lastFinal: 'v0.4.2' });
  commit(fx, 'api.txt', 'feat!: reshape the api');
  const r = cut(fx);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.tag, 'v0.5.0-rc.1');
});

// ---- refusals ---------------------------------------------------------------------------------

test('refuses: release: candidates: off', () => {
  const fx = fixture({ projectYml: `${RELEASED_YML}release:\n  candidates: off\n` });
  assertRefused(fx, cut(fx), 'release-policy', /candidates: off/);
});

test('refuses: a rung row with no automatic candidates (exposure: self)', () => {
  const fx = fixture({ projectYml: 'trunk: main\nexposure: self\nproduction: null\ndeploy: none\nstack: node\n' });
  assertRefused(fx, cut(fx), 'release-policy', /no tags are cut/);
});

test('refuses: a deploy workflow whose tag trigger matches a pre-release tag', () => {
  const fx = fixture({
    files: { '.github/workflows/deploy-site.yml': 'name: deploy\non:\n  push:\n    tags: ["v*.*.*"]\njobs: {}\n' },
  });
  assertRefused(fx, cut(fx), 'prerelease-trigger', /deploy-site\.yml.*v1\.2\.0-rc\.1/);
});

test('refuses: a breaking change on a >=1.0 repo', () => {
  const fx = fixture();
  commit(fx, 'api.txt', 'feat!: drop the v1 api');
  assertRefused(fx, cut(fx), 'version', /2\.0\.0 is a human decision/);
});

test('refuses: --bump major', () => {
  const fx = fixture();
  assertRefused(fx, cut(fx, ['--bump', 'major', '--reason', 'time for 2.0']), 'version', /human decision/);
});

test('refuses: nothing user-facing since the last final tag', () => {
  const fx = fixture();
  // Re-point the final at the fix, so only a docs commit follows it.
  fx.g('tag', '-d', 'v1.2.0');
  fx.g('push', '-q', 'origin', ':refs/tags/v1.2.0');
  fx.g('tag', '-a', 'v1.2.0', '-m', 'v1.2.0');
  fx.g('push', '-q', 'origin', 'v1.2.0');
  commit(fx, 'README.md', 'docs: typo');
  assertRefused(fx, cut(fx), 'version', /nothing to cut/);
});

test('refuses: CI red on the commit', () => {
  const fx = fixture();
  setRuns(fx, [{ conclusion: 'failure' }]);
  assertRefused(fx, cut(fx), 'ci-green', /conclusion=failure/);
});

test('refuses: CI green on an older commit only — the candidate\'s own commit has no run', () => {
  const fx = fixture();
  const green = fs.readFileSync(fx.runsFile, 'utf8');
  commit(fx, 'fix2.txt', 'fix: later');
  fs.writeFileSync(fx.runsFile, green); // runs still name the previous head
  assertRefused(fx, cut(fx), 'ci-green', /no run for/);
});

test('refuses: the full suite — a workflow whose only run was cancelled', () => {
  const fx = fixture();
  setRuns(fx, [{ workflowName: 'lint' }, { workflowName: 'test-suite', conclusion: 'cancelled' }]);
  const r = cut(fx);
  assertRefused(fx, r, 'full-suite', /test-suite \(cancelled\)/);
  assert.strictEqual(r.body.checks.find((c) => c.condition === 'ci-green').ok, true, 'ship\'s check alone reads this green — that is the gap');
});

test('refuses: a destructive schema change since the last final tag', () => {
  const fx = fixture();
  commit(fx, 'database/migrations/2026_09_14_drop_legacy.php', 'feat: retire the legacy column',
    "<?php\nreturn new class extends Migration {\n  public function up(): void { Schema::table('users', fn ($t) => $t->dropColumn('legacy')); }\n};\n");
  assertRefused(fx, cut(fx), 'schema-additive', /dropColumn/);
});

test('refuses: a finished switch whose dependency is still switched', () => {
  const fx = fixture();
  fs.writeFileSync(fx.issuesFile, JSON.stringify([
    { number: 1, state: 'OPEN', stateReason: null, body: '<!-- colab:switch name=bulk-import -->' },
    { number: 2, state: 'OPEN', stateReason: null, body: '<!-- colab:switch name=bulk-export needs=bulk-import -->' },
    { number: 3, state: 'CLOSED', stateReason: 'COMPLETED', body: '<!-- colab:switch name=bulk-import role=add -->' },
    { number: 4, state: 'CLOSED', stateReason: 'COMPLETED', body: '<!-- colab:switch name=bulk-export role=add -->' },
    { number: 5, state: 'CLOSED', stateReason: 'COMPLETED', body: '<!-- colab:switch name=bulk-export role=remove -->' },
  ]));
  assertRefused(fx, cut(fx), 'switch-dependencies', /bulk-export.*needs "bulk-import"/);
});

test('refuses: no final tag yet — the first version is a human decision', () => {
  const fx = fixture({ lastFinal: null });
  assertRefused(fx, cut(fx), 'version', /first version/);
});
