'use strict';
/**
 * Subprocess/CLI tests for #762: `data: none` on the TARGET exempts `colab ship`'s
 * no-new-migrations gate while no sign of production is present; any falsifier restores it; a
 * branch cannot exempt itself; and a branch that ADDS the declaration lands only through the human
 * door.
 *
 * Real CLI, real repo, real bare `origin` on disk — the fixture/colab() shape of
 * tools/lib/ship-migration-paths.test.js, copied rather than extracted (that file's own precedent),
 * including its fixed fake `gh`, so any grant read fails deterministically: an exempt row that
 * still passes proves no grant was needed.
 * Run: `node --test tools/lib/ship-data-exemption.test.js`.
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

const BASE_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const NONE_YML = `${BASE_YML}data: none\n`;
const MIGRATION = { 'database/migrations/2026_01_01_000000_create_users.php': '<?php\n' };
const LOWER_ROW = 'data: none declared by a person (#762)';

function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-data-exemption-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab data-exemption test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'config', 'tag.gpgSign', 'false');
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

function colab(fx, args, extraEnv = {}) {
  const env = { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home,
    COLAB_SESSION: 'sess-data-exemption-test', COLAB_SESSION_NAME: '', ...extraEnv };
  if (!('COLAB_HUMAN' in extraEnv)) delete env.COLAB_HUMAN;
  const r = spawnSync('node', [COLAB, ...args], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** Branch fx.work onto <branch>, write `files` ({ rel: content }), commit, push, return to main. */
function branchWith(fx, branch, files) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.join(fx.work, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(fx.work, rel), content);
  }
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: a change');
  fx.g(fx.work, 'push', '-q', 'origin', branch);
  fx.g(fx.work, 'checkout', '-q', 'main');
}

function dry(fx, branch, extraArgs = [], extraEnv = {}) {
  const r = colab(fx, ['ship', '--branch', branch, '--repo', fx.work, '--dry', '--json', ...extraArgs], extraEnv);
  let body;
  try { body = JSON.parse(r.out); } catch (e) { throw new Error(`not JSON (exit ${r.code}): ${r.out}\n${r.err}`); }
  return { code: r.code, body, mig: body.checks.find((c) => c.name === 'no new migrations'), lower: body.checks.find((c) => c.name === LOWER_ROW) };
}

// ---- done-when 1: exempt, and the row says why ------------------------------------------------

test('#762: data: none, production null, deploy none, no tag → the migration lands with no grant, and the row says why', () => {
  const fx = fixture(NONE_YML);
  branchWith(fx, 'feat/scaffold-1', MIGRATION);
  const { mig, body, lower } = dry(fx, 'feat/scaffold-1');
  assert.strictEqual(mig.ok, true, mig.detail);
  assert.match(mig.detail, /^1 present, exempt — data: none \(no production, no deploy, no release\) — database\/migrations\//);
  assert.strictEqual(body.migrationGrant.exempt, true);
  assert.deepStrictEqual(body.migrationGrant.dataExemption, { declared: true, exempt: true, falsifiers: [], reason: 'exempt — data: none (no production, no deploy, no release)' });
  assert.deepStrictEqual(body.migrationGrant.granted, []);
  assert.strictEqual(lower, undefined, 'no lowering row when the branch does not add the declaration');
});

test('#762: a repo that declares nothing refuses exactly as before, with no dataExemption field', () => {
  const fx = fixture(BASE_YML);
  branchWith(fx, 'feat/plain-2', MIGRATION);
  const { mig, body } = dry(fx, 'feat/plain-2');
  assert.strictEqual(mig.ok, false);
  assert.ok(!('dataExemption' in body.migrationGrant));
  assert.doesNotMatch(mig.detail, /data: none/);
});

test('#762: data: real is today\'s behaviour', () => {
  const fx = fixture(`${BASE_YML}data: real\n`);
  branchWith(fx, 'feat/real-3', MIGRATION);
  assert.strictEqual(dry(fx, 'feat/real-3').mig.ok, false);
});

// ---- done-when 2: any one falsifier restores the gate and is named ----------------------------

for (const [label, yml, kind, re] of [
  ['production', NONE_YML.replace('production: null', 'production: https://app.example'), 'production', /production is https:\/\/app\.example/],
  ['deploy', NONE_YML.replace('deploy: none', 'deploy: manual'), 'deploy', /deploy is manual/],
  ['tier C', NONE_YML.replace('tier: B', 'tier: C'), 'axis', /tier C/],
  ['exposure live', NONE_YML.replace('tier: B\n', 'exposure: live\n'), 'axis', /exposure live/],
]) {
  test(`#762: falsifier ${label} → the gate refuses as today and names it`, () => {
    const fx = fixture(yml);
    branchWith(fx, `feat/falsified-${kind}`, MIGRATION);
    const { mig, body } = dry(fx, `feat/falsified-${kind}`);
    assert.strictEqual(mig.ok, false);
    assert.strictEqual(mig.class, 'human-gated');
    assert.match(mig.detail, /data: none does not apply: /);
    assert.match(mig.detail, re);
    assert.strictEqual(body.migrationGrant.dataExemption.exempt, false);
    assert.deepStrictEqual(body.migrationGrant.dataExemption.falsifiers.map((f) => f.kind), [kind]);
  });
}

test('#762: a version tag on trunk is a falsifier', () => {
  const fx = fixture(NONE_YML);
  fx.g(fx.work, 'tag', 'v0.1.0');
  fx.g(fx.work, 'push', '-q', 'origin', 'v0.1.0');
  branchWith(fx, 'feat/tagged-4', MIGRATION);
  const { mig, body } = dry(fx, 'feat/tagged-4');
  assert.strictEqual(mig.ok, false);
  assert.match(mig.detail, /version tag v0\.1\.0 on the target/);
  assert.deepStrictEqual(body.migrationGrant.dataExemption.falsifiers.map((f) => f.kind), ['tag']);
});

test('#762: a version tag that is not on trunk, and a non-version tag on trunk, are not falsifiers', () => {
  const fx = fixture(NONE_YML);
  fx.g(fx.work, 'tag', 'scaffold');
  fx.g(fx.work, 'push', '-q', 'origin', 'scaffold');
  fx.g(fx.work, 'checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(fx.work, 'side.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: side');
  fx.g(fx.work, 'tag', 'v9.9.9');
  fx.g(fx.work, 'push', '-q', 'origin', 'v9.9.9');
  fx.g(fx.work, 'checkout', '-q', 'main');
  branchWith(fx, 'feat/side-tag-5', MIGRATION);
  const { mig } = dry(fx, 'feat/side-tag-5');
  assert.strictEqual(mig.ok, true, mig.detail);
});

// ---- done-when 3: a branch cannot exempt itself; adding the declaration needs a person --------

test('#762: a branch that adds data: none does not exempt its own migrations, and its landing needs a person', () => {
  const fx = fixture(BASE_YML);
  branchWith(fx, 'feat/self-exempt-6', { ...MIGRATION, '.github/project.yml': NONE_YML });
  const { mig, lower, code } = dry(fx, 'feat/self-exempt-6');
  assert.strictEqual(code, 1);
  assert.strictEqual(mig.ok, false, 'the target\'s descriptor decides, never the branch\'s');
  assert.ok(!('dataExemption' in dry(fx, 'feat/self-exempt-6').body.migrationGrant));
  assert.ok(lower, 'the lowering row is present');
  assert.strictEqual(lower.ok, false);
  assert.strictEqual(lower.class, 'human-gated');
  assert.match(lower.detail, /this branch adds data: none \(the target has none declared\)/);
  assert.match(lower.detail, /COLAB_HUMAN=1 colab ship --branch feat\/self-exempt-6 --answered-by/);
});

test('#762: the lowering row opens through the human door (COLAB_HUMAN=1 + --answered-by)', () => {
  const fx = fixture(BASE_YML);
  branchWith(fx, 'feat/declare-7', { '.github/project.yml': NONE_YML });
  const closed = dry(fx, 'feat/declare-7');
  assert.strictEqual(closed.lower.ok, false);
  const half = dry(fx, 'feat/declare-7', [], { COLAB_HUMAN: '1' });
  assert.strictEqual(half.lower.ok, false, 'COLAB_HUMAN=1 alone is not the door');
  const open = dry(fx, 'feat/declare-7', ['--answered-by', 'Ada'], { COLAB_HUMAN: '1' });
  assert.strictEqual(open.lower.ok, true, open.lower.detail);
  assert.match(open.lower.detail, /answered by Ada/);
});

test('#762: removing data: none (raising protection) adds no row', () => {
  const fx = fixture(NONE_YML);
  branchWith(fx, 'feat/undeclare-8', { '.github/project.yml': BASE_YML });
  assert.strictEqual(dry(fx, 'feat/undeclare-8').lower, undefined);
});

test('#762: the prose ship --dry prints the exempt row', () => {
  const fx = fixture(NONE_YML);
  branchWith(fx, 'feat/prose-exempt', MIGRATION);
  const r = colab(fx, ['ship', '--branch', 'feat/prose-exempt', '--repo', fx.work, '--dry']);
  assert.match(r.out, /✓ +no new migrations +1 present, exempt — data: none/);
});
