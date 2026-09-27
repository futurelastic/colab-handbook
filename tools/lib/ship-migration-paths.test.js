'use strict';
/**
 * Subprocess/CLI tests for #383: `colab ship`'s no-new-migrations gate reads project.yml
 * `migrations:`, and the audit validates that key and reports an uncovered `*\/migrations/` dir.
 *
 * The close criterion, verbatim: on a repo that declares `migrations: [backend/migrations/]`,
 * `colab ship --dry` on a branch adding `backend/migrations/013-x.mjs` reports new migrations and
 * refuses without a grant; a repo that declares nothing behaves exactly as today.
 *
 * Real CLI, real repo, real bare `origin` on disk — the fixture/colab() shape of
 * tools/lib/ship-migration-grant.test.js, copied rather than extracted (that file's own precedent),
 * including its fixed fake `gh` so the grant read fails deterministically on every machine.
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const BASE_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const DECLARED_YML = `${BASE_YML}migrations: [backend/migrations/]\n`;

function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-migration-paths-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab migration-paths test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, home, bin, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-migration-paths-test', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** Branch fx.work onto <branch>, write `files` ({ rel: content }), commit, return to main. */
function branchWith(fx, branch, files) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(fx.work, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(fx.work, rel), content);
  }
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: a change');
  fx.g(fx.work, 'checkout', '-q', 'main');
}

function migRow(fx, branch) {
  const r = colab(fx, ['ship', '--branch', branch, '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  return { code: r.code, body, mig: body.checks.find((c) => c.name === 'no new migrations') };
}

// ---- the close criterion ---------------------------------------------------------------------

test('#383 close criterion: declared backend/migrations/ → ship --dry reports the new migration and refuses without a grant', () => {
  const fx = fixture(DECLARED_YML);
  branchWith(fx, 'feat/backfill-1', { 'backend/migrations/013-x.mjs': 'export default async () => {}\n' });
  const { code, body, mig } = migRow(fx, 'feat/backfill-1');
  assert.strictEqual(code, 1);
  assert.strictEqual(mig.ok, false);
  assert.strictEqual(mig.class, 'human-gated');
  assert.match(mig.detail, /backend\/migrations\/013-x\.mjs/);
  assert.deepStrictEqual(body.migrationGrant.files, ['backend/migrations/013-x.mjs']);
  assert.strictEqual(body.migrationGrant.granted.length, 0);
});

test('#383 close criterion: nothing declared → the same branch reads "none", exactly as before', () => {
  const fx = fixture(BASE_YML);
  branchWith(fx, 'feat/backfill-2', { 'backend/migrations/013-x.mjs': 'x\n' });
  const { mig, body } = migRow(fx, 'feat/backfill-2');
  assert.strictEqual(mig.ok, true);
  assert.match(mig.detail, /^none vs /);
  assert.strictEqual(body.migrationGrant, null);
});

test('#383: the defaults still gate when a repo declares its own path — declaring never replaces them', () => {
  const fx = fixture(DECLARED_YML);
  branchWith(fx, 'feat/laravel-3', { 'database/migrations/2026_01_01_x.php': 'x\n' });
  const { mig } = migRow(fx, 'feat/laravel-3');
  assert.strictEqual(mig.ok, false);
});

test('#383: a branch that declares its OWN migration path is gated by that declaration', () => {
  const fx = fixture(BASE_YML);
  branchWith(fx, 'feat/declare-4', {
    '.github/project.yml': DECLARED_YML,
    'backend/migrations/013-x.mjs': 'x\n',
  });
  const { mig } = migRow(fx, 'feat/declare-4');
  assert.strictEqual(mig.ok, false, 'the branch\'s own declaration counts');
});

test('#383: a branch that DELETES trunk\'s declaration is still gated by trunk\'s', () => {
  const fx = fixture(DECLARED_YML);
  branchWith(fx, 'feat/undeclare-5', {
    '.github/project.yml': BASE_YML,
    'backend/migrations/013-x.mjs': 'x\n',
  });
  const { mig } = migRow(fx, 'feat/undeclare-5');
  assert.strictEqual(mig.ok, false, 'a branch can never opt itself out of the gate');
});

test('#383: the prose ship table shows the ✗ row too', () => {
  const fx = fixture(DECLARED_YML);
  branchWith(fx, 'feat/backfill-6', { 'backend/migrations/013-x.mjs': 'x\n' });
  colab(fx, ['claim', '6', '--branch', 'feat/backfill-6', '--repo', fx.work]);
  const r = colab(fx, ['ship', '--branch', 'feat/backfill-6', '--repo', fx.work, '--dry']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /✗\s+no new migrations\s+.*backend\/migrations\/013-x\.mjs/);
});

// ---- the audit --------------------------------------------------------------------------------

function auditFixture(projectYml, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-migration-paths-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function audit(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) { stdout = err.stdout || ''; }
  const r = JSON.parse(stdout).results[0];
  const pick = (lvl) => r.findings.filter((f) => f.level === lvl).map((f) => f.text).filter((t) => /migration/.test(t));
  return { fails: pick('fail'), warns: pick('warn') };
}

test('audit #383: an undeclared backend/migrations/ dir warns, naming the declaration to add', () => {
  const a = audit(auditFixture(BASE_YML, { 'backend/migrations/001.mjs': 'x\n' }));
  assert.deepStrictEqual(a.fails, []);
  assert.strictEqual(a.warns.length, 1, a.warns.join('\n'));
  assert.match(a.warns[0], /outside every declared path: backend\/migrations\//);
  assert.match(a.warns[0], /migrations: \[backend\/migrations\/\]/);
});

test('audit #383: declaring it clears the warning; the defaults never warn', () => {
  const a = audit(auditFixture(DECLARED_YML, { 'backend/migrations/001.mjs': 'x\n', 'database/migrations/x.php': 'x\n' }));
  assert.deepStrictEqual(a.fails, []);
  assert.deepStrictEqual(a.warns, []);
});

test('audit #383: a block-sequence declaration reads the same as a flow list', () => {
  const a = audit(auditFixture(`${BASE_YML}migrations:\n  - backend/migrations/\n`, { 'backend/migrations/001.mjs': 'x\n' }));
  assert.deepStrictEqual(a.fails, []);
  assert.deepStrictEqual(a.warns, []);
});

test('audit #383: an invalid entry fails; a bare string fails its shape', () => {
  assert.strictEqual(audit(auditFixture(`${BASE_YML}migrations: [/abs/migrations/]\n`, {})).fails.length, 1);
  assert.match(audit(auditFixture(`${BASE_YML}migrations: backend/migrations/\n`, {})).fails.join('\n'), /bare string/);
});

test('audit #383: redundancy only warns', () => {
  const a = audit(auditFixture(`${BASE_YML}migrations: [database/migrations/]\n`, {}));
  assert.deepStrictEqual(a.fails, []);
  assert.match(a.warns.join('\n'), /already a default/);
});
