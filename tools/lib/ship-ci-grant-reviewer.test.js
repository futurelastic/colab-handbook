'use strict';
/**
 * Subprocess/CLI tests for the reviewer role of `colab ci-grant` (#504): minted WITHOUT
 * COLAB_HUMAN=1, and only where trunk opts in with `ci-grant: reviewer`. Real CLI, real repo, real
 * bare `origin` on disk — the fixture is copied from tools/lib/ship-ci-grant.test.js on purpose
 * (same reasoning as that file's banner). As there, the fixture's `gh` fails every real subcommand,
 * so these tests prove the LOCAL guards and that the first tracker read is reached with no human
 * bar in the way; the verdict logic itself is covered purely in tools/lib/ci-grant-reviewer.test.js.
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

const BASE_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const OPT_IN_YML = `${BASE_YML}ci-grant: reviewer\n`;

function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-review-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab ci-review test');
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
  return { root, origin, work, home, bin, g };
}

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-ci-review-test',
      COLAB_SESSION_NAME: '', COLAB_HUMAN: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** A branch with one commit; pushed unless `push: false`. Optionally rewrites project.yml on it. */
function branch(fx, name, { push = true, yml } = {}) {
  fx.g(fx.work, 'checkout', '-q', '-b', name);
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'fix\n');
  if (yml) fs.writeFileSync(path.join(fx.work, '.github', 'project.yml'), yml);
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: cure the red');
  if (push) fx.g(fx.work, 'push', '-q', 'origin', name);
  fx.g(fx.work, 'checkout', '-q', 'main');
  return fx.g(fx.work, 'rev-parse', name).trim();
}

const REVIEW = ['--role', 'ci-reviewer', '--reviewer', 'lucy', '--verdict', 'pass', '--cures', 'CI / test'];

test('reviewer role without the opt-in refuses, and says the grant is human-only there', () => {
  const fx = fixture(BASE_YML);
  branch(fx, 'fix/trunk-red-7');
  const r = colab(fx, ['ci-grant', '7', '--branch', 'fix/trunk-red-7', ...REVIEW, '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /minted only where trunk declares ci-grant: reviewer/);
  assert.match(r.err, /human-only/);
});

test('a branch cannot opt itself in — the policy is read from trunk as committed', () => {
  const fx = fixture(BASE_YML);
  branch(fx, 'fix/trunk-red-7', { yml: OPT_IN_YML });
  const r = colab(fx, ['ci-grant', '7', '--branch', 'fix/trunk-red-7', ...REVIEW, '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /minted only where trunk declares ci-grant: reviewer/);
});

test('under the opt-in, with no COLAB_HUMAN, every local guard passes and the first tracker read is reached', () => {
  const fx = fixture(OPT_IN_YML);
  branch(fx, 'fix/trunk-red-7');
  const r = colab(fx, ['ci-grant', '7', '--branch', 'fix/trunk-red-7', ...REVIEW, '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.doesNotMatch(r.err, /requires a human/);
  assert.match(r.err, /could not read #7 from the tracker — refusing to write a grant blind/);
  assert.doesNotMatch(r.out, /Recorded/);
});

const LOCAL_REFUSALS = [
  ['the branch does not carry #N', { name: 'fix/trunk-red-8' }, [], /does not carry #7 in its trailing number group/],
  ['the branch is not pushed', { name: 'fix/trunk-red-7', push: false }, [], /is not on origin/],
  ['--head is not the pushed tip', { name: 'fix/trunk-red-7' }, ['--head', '0123456789abcdef0123456789abcdef01234567'], /is not origin's tip/],
  ['a fail verdict', { name: 'fix/trunk-red-7' }, ['--verdict', 'fail'], /failing review is a contradiction/],
  ['no cures', { name: 'fix/trunk-red-7' }, ['--cures', ' ; '], /missing "cures"/],
  ['no reviewer', { name: 'fix/trunk-red-7' }, ['--reviewer', ''], /missing "reviewer"/],
];
for (const [name, b, extra, re] of LOCAL_REFUSALS) {
  test(`reviewer role refuses before any network call: ${name}`, () => {
    const fx = fixture(OPT_IN_YML);
    branch(fx, b.name, { push: b.push !== false });
    const args = [...REVIEW];
    for (let i = 0; i < extra.length; i += 2) {
      const at = args.indexOf(extra[i]);
      if (at === -1) args.push(extra[i], extra[i + 1]); else args[at + 1] = extra[i + 1];
    }
    const r = colab(fx, ['ci-grant', '7', '--branch', b.name, ...args, '--repo', fx.work]);
    assert.notStrictEqual(r.code, 0);
    assert.match(r.err, re);
    assert.doesNotMatch(r.err, /from the tracker/);
  });
}

test('record flags without --role ci-reviewer refuse — a human grant carries no record', () => {
  const fx = fixture(OPT_IN_YML);
  const r = colab(fx, ['ci-grant', '7', '--branch', 'fix/trunk-red-7', '--reviewer', 'lucy', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /need --role ci-reviewer/);
});

test('an unknown role refuses', () => {
  const fx = fixture(OPT_IN_YML);
  const r = colab(fx, ['ci-grant', '7', '--branch', 'x', '--role', 'agent', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--role is "agent"/);
});

test('revoke stays human-only, even under the opt-in, and takes no --role', () => {
  const fx = fixture(OPT_IN_YML);
  const a = colab(fx, ['ci-grant', '7', '--revoke', '--repo', fx.work]);
  assert.notStrictEqual(a.code, 0);
  assert.match(a.err, /requires a human/);
  const b = colab(fx, ['ci-grant', '7', '--revoke', '--role', 'ci-reviewer', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(b.code, 0);
  assert.match(b.err, /--revoke takes no --role/);
});

test('the human form is unchanged under the opt-in: no role still needs COLAB_HUMAN=1', () => {
  const fx = fixture(OPT_IN_YML);
  const r = colab(fx, ['ci-grant', '7', '--branch', 'fix/trunk-red-7', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /requires a human/);
});
