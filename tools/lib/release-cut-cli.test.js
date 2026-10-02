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
  const releasesFile = path.join(root, 'releases.log');
  fs.writeFileSync(issuesFile, '[]');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "${runsFile}"; exit 0; fi`,
    `if [ "$1" = "issue" ] && [ "$2" = "list" ]; then cat "${issuesFile}"; exit 0; fi`,
    // #443: `release cut` publishes the candidate's pre-release itself. view answers from the log of
    // what create was called with; create records its argv and the notes file it was handed.
    `if [ "$1" = "release" ] && [ "$2" = "view" ]; then grep -q "^create $3 " "${releasesFile}" 2>/dev/null && exit 0; exit 1; fi`,
    `if [ "$1" = "release" ] && [ "$2" = "create" ]; then [ -f "${root}/release-create-fails" ] && { echo "HTTP 403" >&2; exit 1; }; shift; echo "$*" >> "${releasesFile}"; while [ $# -gt 0 ]; do if [ "$1" = "--notes-file" ]; then cat "$2" > "${root}/notes-last.md"; fi; shift; done; exit 0; fi`,
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const fx = { root, origin, work, home, bin, g, runsFile, issuesFile, releasesFile };
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

/** Where a release channel branch (#445) points on origin, or null when it does not exist. */
function originBranch(fx, name) {
  const out = execFileSync('git', ['ls-remote', '--heads', fx.origin, `refs/heads/${name}`], { encoding: 'utf8' }).trim();
  return out ? out.split('\t')[0] : null;
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
  assert.match(dry.body.channel.detail, /^\[--dry\] would be: next created/);
  assert.strictEqual(originBranch(fx, 'next'), null, '--dry moves no channel');

  const first = cut(fx);
  assert.strictEqual(first.code, 0, first.out + first.err);
  assert.strictEqual(first.body.tag, 'v1.2.1-rc.1');
  assert.strictEqual(first.body.created, true);
  assert.deepStrictEqual(originTags(fx), ['v1.2.0', 'v1.2.1-rc.1']);
  const rc1Sha = fx.g('rev-list', '-n', '1', 'v1.2.1-rc.1');
  assert.strictEqual(rc1Sha, fx.g('rev-parse', 'origin/main'));
  // #445: the cut moves the `next` channel to the candidate it pushed.
  assert.strictEqual(first.body.channel.action, 'create', JSON.stringify(first.body.channel));
  assert.strictEqual(originBranch(fx, 'next'), rc1Sha);
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
  assert.strictEqual(second.body.channel.action, 'move', 'next fast-forwards to the newest candidate');
  assert.strictEqual(originBranch(fx, 'next'), fx.g('rev-list', '-n', '1', 'v1.2.1-rc.2'));
  assert.strictEqual(originBranch(fx, 'stable'), null, 'a cut never moves stable');
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

// #346: `deploy: tag` + the handbook's own release-tag template (fires on `v*.*.*` on purpose, deploys
// nothing) must not block a candidate; the same text under a deploy name still does.
const TAG_DEPLOY_YML = 'trunk: main\nexposure: released\nproduction: https://example.invalid\ndeploy: tag\nstack: node\n';
const RELEASE_TAG_TEMPLATE = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'release-tag.yml'), 'utf8');
const SAFE_DEPLOY = 'name: deploy\non:\n  push:\n    tags: ["v*.*.*", "!v*.*.*-*"]\njobs: {}\n';

test('deploy: tag + a copied release-tag.yml on v*.*.* — the prerelease-trigger check passes (#346)', () => {
  const fx = fixture({
    projectYml: TAG_DEPLOY_YML,
    files: { '.github/workflows/release.yml': RELEASE_TAG_TEMPLATE, '.github/workflows/deploy-prod.yml': SAFE_DEPLOY },
  });
  const r = cut(fx, ['--dry']);
  assert.ok(r.body, `no JSON: ${r.out}${r.err}`);
  const check = r.body.checks.find((c) => c.condition === 'prerelease-trigger');
  assert.ok(check, `no prerelease-trigger check in ${JSON.stringify(r.body.checks)}`);
  assert.strictEqual(check.ok, true, JSON.stringify(r.body.checks, null, 2));
});

test('refuses: deploy: tag + the release-tag template text in deploy-prod.yml (guardrail, #346)', () => {
  const fx = fixture({ projectYml: TAG_DEPLOY_YML, files: { '.github/workflows/deploy-prod.yml': RELEASE_TAG_TEMPLATE } });
  assertRefused(fx, cut(fx), 'prerelease-trigger', /deploy-prod\.yml.*v1\.2\.0-rc\.1/);
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

// ---- --auto (#422) and the pre-tag checks (#424) ----------------------------------------------

test('--auto: a fix cuts a patch candidate and writes every signal into the tag', () => {
  const fx = fixture();
  const r = cut(fx, ['--auto']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.tag, 'v1.2.1-rc.1');
  assert.ok(r.body.signals.some((l) => /^exports: no export removed/.test(l)), JSON.stringify(r.body.signals));
  const message = fx.g('for-each-ref', '--format=%(contents)', 'refs/tags/v1.2.1-rc.1');
  assert.match(message, /Signals \(every input the bump read\):/);
  assert.match(message, /- guard: none declared/);
  assert.match(message, /- cadence: /);
  assert.match(message, /- manifest-version: /);
});

test('--auto: refuses --bump, and a docs-only change still owes a patch', () => {
  const fx = fixture();
  assert.strictEqual(cut(fx, ['--auto', '--bump', 'minor', '--reason', 'x']).code, 1);
  fx.g('tag', '-d', 'v1.2.0');
  fx.g('push', '-q', 'origin', ':refs/tags/v1.2.0');
  fx.g('tag', '-a', 'v1.2.0', '-m', 'v1.2.0');
  fx.g('push', '-q', 'origin', 'v1.2.0');
  commit(fx, 'README.md', 'docs: typo');
  const r = cut(fx, ['--auto', '--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.tag, 'v1.2.1-rc.1');
});

test('--auto: a breaking guard result on >=1.0 is a major only with MIGRATION.md\'s measured cost', () => {
  const guard = 'release:\n  guard-run: echo \'{"breaking": true, "findings": ["config key renamed"]}\'\n';
  const fx = fixture({ projectYml: RELEASED_YML + guard });
  const refused = cut(fx, ['--auto']);
  assertRefused(fx, refused, 'version', /v2\.0\.0 is a major .*refused: no MIGRATION\.md/);
  commit(fx, 'MIGRATION.md', 'docs: migration notes', '# Migrations\n\n## v2.0.0\n\nRename `a` to `b`.\n\nMeasured cost: 4 call sites across 2 adopters.\n');
  const ok = cut(fx, ['--auto']);
  assert.strictEqual(ok.code, 0, ok.out + ok.err);
  assert.strictEqual(ok.body.tag, 'v2.0.0-rc.1');
  const message = fx.g('for-each-ref', '--format=%(contents)', 'refs/tags/v2.0.0-rc.1');
  assert.match(message, /guard guard-run .*: BREAKING — config key renamed/);
  assert.match(message, /Measured cost: 4 call sites/);
});

test('--auto: a guard that fails to run refuses — an unread guard is not a clean one', () => {
  const fx = fixture({ projectYml: `${RELEASED_YML}release:\n  guard-run: exit 3\n` });
  assertRefused(fx, cut(fx, ['--auto']), 'version', /fail closed: guard guard-run \(exit 3\) exited 3/);
});

test('--auto: a removed package.json export is breaking', () => {
  const fx = fixture({ lastFinal: 'v0.3.0', files: { 'package.json': '{"name":"p","exports":{".":"./i.js","./old":"./o.js"}}' } });
  commit(fx, 'package.json', 'fix: tidy exports', '{"name":"p","exports":{".":"./i.js"}}');
  const r = cut(fx, ['--auto']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.tag, 'v0.4.0-rc.1', 'pre-1.0: breaking -> minor');
  assert.ok(r.body.signals.some((l) => /removed export\(s\): package\.json exports \.\/old/.test(l)));
});

test('#443 --auto: rapid-app has no cap — a second green head gets its own candidate', () => {
  const fx = fixture({ projectYml: `${RELEASED_YML}release:\n  route: rapid-app\n` });
  const first = cut(fx, ['--auto']);
  assert.strictEqual(first.code, 0, first.out + first.err);
  assert.strictEqual(first.body.tag, 'v1.2.1-rc.1');
  commit(fx, 'fix2.txt', 'fix: another');
  const second = cut(fx, ['--auto']);
  assert.strictEqual(second.code, 0, second.out + second.err);
  assert.strictEqual(second.body.tag, 'v1.2.1-rc.2');
  assert.match(second.body.checks.find((c) => c.condition === 'cadence').detail, /no candidates-per-day cap/);
  // a re-run on the same head (the daily schedule) is a no-op, not a refusal
  const again = cut(fx, ['--auto']);
  assert.strictEqual(again.code, 0, again.out + again.err);
  assert.strictEqual(again.body.noop, true);
  assert.deepStrictEqual(originTags(fx), ['v1.2.0', 'v1.2.1-rc.1', 'v1.2.1-rc.2']);
});

test('--auto: inside a declared candidates-per-day window the run is a no-op (exit 0, nothing cut)', () => {
  const fx = fixture({ projectYml: `${RELEASED_YML}release:\n  route: rapid-app\n  candidates-per-day: 1\n` });
  const first = cut(fx, ['--auto']);
  assert.strictEqual(first.code, 0, first.out + first.err);
  assert.strictEqual(first.body.tag, 'v1.2.1-rc.1');
  commit(fx, 'fix2.txt', 'fix: another');
  const second = cut(fx, ['--auto']);
  assert.strictEqual(second.code, 0, second.out + second.err);
  assert.strictEqual(second.body.noop, true);
  assert.strictEqual(second.body.created, false);
  assert.match(second.body.checks.find((c) => c.condition === 'cadence').detail, /caps at 1 a day; the first run from .* cuts main's head/);
  assert.deepStrictEqual(originTags(fx), ['v1.2.0', 'v1.2.1-rc.1']);
});

test('refuses (#424): a manifest version that disagrees with the tag', () => {
  const fx = fixture({ files: { 'package.json': '{"name":"p","version":"1.2.0"}' } });
  assertRefused(fx, cut(fx), 'manifest-version', /package\.json says 1\.2\.0/);
  commit(fx, 'package.json', 'chore: bump to 1.2.1', '{"name":"p","version":"1.2.1"}');
  const ok = cut(fx);
  assert.strictEqual(ok.code, 0, ok.out + ok.err);
});

test('#438: version-source: tag — a VERSION that differs is derivable, the candidate is cut and the tag names it; manifest refuses as before', () => {
  const fromTag = fixture({ projectYml: `${RELEASED_YML}release:\n  version-source: tag\n`, files: { VERSION: '0.0.0-dev\n' } });
  const r = cut(fromTag);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.tag, 'v1.2.1-rc.1');
  assert.match(r.body.checks.find((c) => c.condition === 'manifest-version').detail, /derivable \(release\.version-source: tag.*\): VERSION/);
  const message = fromTag.g('for-each-ref', '--format=%(contents)', 'refs/tags/v1.2.1-rc.1');
  assert.match(message, /Derivable manifests \(release\.version-source: tag, not checked against the tag\): VERSION/);

  const fromManifest = fixture({ projectYml: `${RELEASED_YML}release:\n  version-source: manifest\n`, files: { VERSION: '0.0.0-dev\n' } });
  assertRefused(fromManifest, cut(fromManifest), 'manifest-version', /VERSION says 0\.0\.0-dev.*version-source: tag/);
});

test('refuses (#424): a version that does not outrank the highest final', () => {
  const fx = fixture();
  // A higher final exists off main (a hotfix line); the computed v1.2.1 would move "latest" backwards.
  fx.g('checkout', '-q', '-b', 'hotfix', 'v1.2.0');
  fs.writeFileSync(path.join(fx.work, 'h.txt'), 'h\n');
  fx.g('add', '-A'); fx.g('commit', '-q', '-m', 'fix: hotfix');
  fx.g('tag', '-a', 'v1.5.0', '-m', 'v1.5.0');
  fx.g('push', '-q', 'origin', 'v1.5.0');
  fx.g('checkout', '-q', 'main');
  assertRefused(fx, cut(fx), 'outranks-final', /does not outrank the latest final v1\.5\.0/);
});

test('refuses (#424): a shallow checkout cannot answer on-trunk', () => {
  const fx = fixture();
  const shallow = path.join(fx.root, 'shallow');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${fx.origin}`, shallow]);
  const r = spawnSync('node', [COLAB, 'release', 'cut', '--repo', shallow, '--json', '--dry'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home },
  });
  const body = JSON.parse(r.stdout);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  const check = body.checks.find((c) => c.condition === 'on-trunk');
  assert.ok(check, JSON.stringify(body.checks));
  assert.match(check.detail, /shallow checkout cannot answer/);
});

// ---- trunk: dev + deploy: tag — cut on the promotion (#429) ------------------------------------

const DEV_TAG_YML = 'trunk: dev\nexposure: released\nproduction: https://example.invalid\ndeploy: tag\nstack: node\n';

/**
 * A `trunk: dev` + `deploy: tag` repo: fixture()'s main (v1.2.0 + a fix), then `dev` cut from it and
 * pushed. The working tree is left on dev; devCommit() lands work there, promote() merges it to main.
 */
function devFixture(opts = {}) {
  const fx = fixture({ projectYml: DEV_TAG_YML, ...opts });
  fx.g('checkout', '-q', '-b', 'dev');
  fx.g('push', '-q', 'origin', 'dev');
  return fx;
}

function devCommit(fx, file, message, content = `${message}\n`) {
  fs.mkdirSync(path.join(fx.work, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(fx.work, file), content);
  fx.g('add', '-A');
  fx.g('commit', '-q', '-m', message);
  fx.g('push', '-q', 'origin', 'dev');
}

/** The human promotion: `--no-ff` dev -> main, pushed; CI green on the merge (the run that triggers the workflow). */
function promote(fx, subject = 'release: dev → main — 2026-01-01 (promotion via colab promote)') {
  fx.g('checkout', '-q', 'main');
  fx.g('merge', '-q', '--no-ff', 'dev', '-m', subject);
  fx.g('push', '-q', 'origin', 'main');
  setRuns(fx, [{}]);
  fx.g('checkout', '-q', 'dev');
}

const check = (r, condition) => (r.body && r.body.checks || []).find((c) => c.condition === condition);

test('trunk: dev --auto (#429): the promotion is cut; the bump reads promoted dev commits, not the merge subject', () => {
  const fx = devFixture();
  devCommit(fx, 'a.txt', 'fix: on dev');
  promote(fx);
  devCommit(fx, 'b.txt', 'feat: still only on dev');
  const r = cut(fx, ['--auto']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.trunk, 'dev');
  assert.strictEqual(r.body.tag, 'v1.2.1-rc.1', 'the unpromoted feat is not read');
  assert.strictEqual(fx.g('rev-list', '-n', '1', 'v1.2.1-rc.1'), fx.g('rev-parse', 'origin/main'), 'cut on the promotion merge, not dev');
  assert.ok(r.body.signals.some((l) => /^commits: 2 since the last final \(2 fix\)/.test(l)), JSON.stringify(r.body.signals));
  assert.strictEqual(check(r, 'promotion').ok, true);
  assert.match(check(r, 'promotion').detail, /promotes dev@/);
});

test('trunk: dev --auto (#429): a promoted feat cuts a minor', () => {
  const fx = devFixture();
  devCommit(fx, 'a.txt', 'feat: a feature');
  promote(fx, "Merge branch 'dev'");
  const r = cut(fx, ['--auto', '--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.tag, 'v1.3.0-rc.1');
});

test('trunk: dev --auto (#429): a direct push to main is a no-op — and a human can still cut it by hand', () => {
  const fx = devFixture();
  devCommit(fx, 'a.txt', 'fix: on dev');
  promote(fx);
  fx.g('checkout', '-q', 'main');
  commit(fx, 'hot.txt', 'fix: hotfix straight on main');
  const r = cut(fx, ['--auto']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.noop, true);
  assert.strictEqual(r.body.created, false);
  assert.strictEqual(check(r, 'promotion').ok, false);
  assert.match(check(r, 'promotion').detail, /not a promotion of dev \(a direct commit\)/);
  assert.deepStrictEqual(originTags(fx).filter((t) => t.includes('-rc.')), []);
  const byHand = cut(fx);
  assert.strictEqual(byHand.code, 0, byHand.out + byHand.err);
  assert.strictEqual(byHand.body.created, true);
  assert.ok(!check(byHand, 'promotion'), 'no promotion check without --auto');
});

test('trunk: dev (#429): manifest-version reads main\'s promotion commit, not dev', () => {
  const fx = devFixture({ files: { VERSION: '1.2.0\n' } });
  devCommit(fx, 'VERSION', 'fix: ship 1.2.1', '1.2.1\n');
  promote(fx);
  devCommit(fx, 'VERSION', 'chore: start 1.9.9 on dev', '1.9.9\n');
  const r = cut(fx, ['--auto', '--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.tag, 'v1.2.1-rc.1');
  assert.strictEqual(check(r, 'manifest-version').ok, true, JSON.stringify(r.body.checks));
});

test('trunk: dev --auto (#429): a switch-removal child counts only once its Closes #N was promoted', () => {
  const fx = devFixture();
  fs.writeFileSync(fx.issuesFile, JSON.stringify([
    { number: 6, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-01-01T00:00:00Z', body: '<!-- colab:switch name=nav role=add -->' },
    { number: 7, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2099-01-01T00:00:00Z', body: '<!-- colab:switch name=nav role=remove -->' },
  ]));
  devCommit(fx, 'a.txt', 'fix: on dev');
  promote(fx);
  devCommit(fx, 'nav.txt', 'chore: drop the nav switch\n\nCloses #7');
  const before = cut(fx, ['--auto', '--dry']);
  assert.strictEqual(before.code, 0, before.out + before.err);
  assert.strictEqual(before.body.tag, 'v1.2.1-rc.1', 'closed on dev, not promoted — not a minor yet');
  promote(fx);
  const after = cut(fx, ['--auto', '--dry']);
  assert.strictEqual(after.code, 0, after.out + after.err);
  assert.strictEqual(after.body.tag, 'v1.3.0-rc.1');
});

test('trunk: main --auto (#429): no promotion check, no trunk key — the shape is unchanged', () => {
  const fx = fixture();
  const r = cut(fx, ['--auto', '--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.ok(!check(r, 'promotion'));
  assert.ok(!('trunk' in r.body));
});

// ---- #443: a manual cut publishes its pre-release ----------------------------------------------

test('#443: a manual release cut publishes a GitHub pre-release — notes are the summary plus the tag message', () => {
  const fx = fixture();
  const dry = cut(fx, ['--dry']);
  assert.strictEqual(dry.body.published, null, '--dry publishes nothing');
  assert.ok(!fs.existsSync(fx.releasesFile));

  const r = cut(fx);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.deepStrictEqual(r.body.published, { ok: true, detail: 'published the GitHub pre-release v1.2.1-rc.1' });
  const log = fs.readFileSync(fx.releasesFile, 'utf8');
  assert.match(log, /^create v1\.2\.1-rc\.1 --verify-tag --title v1\.2\.1-rc\.1 --notes-file \S+ --prerelease --latest=false$/m);
  const notes = fs.readFileSync(path.join(fx.root, 'notes-last.md'), 'utf8');
  assert.match(notes, /## Release summary/);
  assert.match(notes, /- fix: a bug/);
  assert.match(notes, /### Candidate record/);
  assert.match(notes, /v1\.2\.1-rc\.1 — release candidate \(colab release cut\)/);
});

test('#443: a failed publish is reported, never undoes the cut', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.root, 'release-create-fails'), '');
  const r = cut(fx);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.created, true);
  assert.strictEqual(r.body.published.ok, false);
  assert.match(r.body.published.detail, /pre-release NOT published: gh release create v1\.2\.1-rc\.1 failed \(HTTP 403\)/);
  assert.deepStrictEqual(originTags(fx), ['v1.2.0', 'v1.2.1-rc.1']);
});
