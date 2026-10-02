'use strict';
/**
 * `colab promote --auto` (#440) — the release workflow's unattended promotion, end to end.
 *
 * Real CLI, real repo with a real bare `origin` on disk (no network), private COLAB_HOME, and a `gh`
 * stub answering `run list` / `issue list` from JSON files the test rewrites — the
 * release-cut-cli.test.js shape. What is pinned:
 *
 *   - promotion happens in exactly one cell, deploy: tag + promotion: main-loop, with no human word;
 *   - every other cell (promotion human, deploy push-main / manual / none, trunk: main) is a no-op
 *     that moves nothing — and COLAB_HUMAN=1 does not change that;
 *   - nothing ahead → a no-op; trunk CI not green → a refusal VERDICT (JSON, exit 1), nothing moved;
 *   - the runner shape (a clone with main checked out and no local trunk branch) promotes;
 *   - the issue's oracle: a green dev produces a promotion, then a candidate, with no human step.
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

const yml = ({ trunk = 'dev', deploy = 'tag', promotion = 'main-loop' } = {}) =>
  `trunk: ${trunk}\nexposure: released\nproduction: https://example.invalid\ndeploy: ${deploy}\nstack: node\n` +
  (deploy === 'manual' ? 'runbook: docs/deploy.md\n' : '') +
  (promotion ? `promotion: ${promotion}\n` : '');

/**
 * main carries final v1.2.0 plus a fix; `dev` is cut from it and gets one more `fix:` commit, pushed
 * and marked green. The working tree `work` is left on dev — the developer's machine. `runner()`
 * clones origin the way the release workflow's checkout does: main checked out, no local dev.
 */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-promote-auto-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const ident = (cwd) => {
    git(cwd, 'config', 'user.email', 'test@example.invalid');
    git(cwd, 'config', 'user.name', 'promote auto test');
    git(cwd, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  };

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  ident(work);
  git(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'chore: fixture');
  git(work, 'tag', '-a', 'v1.2.0', '-m', 'v1.2.0');
  git(work, 'push', '-q', 'origin', 'main', '--tags');
  if (/^trunk: dev$/m.test(projectYml)) {
    git(work, 'checkout', '-q', '-b', 'dev');
    fs.writeFileSync(path.join(work, 'a.txt'), 'fix\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'fix: on dev');
    git(work, 'push', '-q', 'origin', 'dev');
  }

  const runsFile = path.join(root, 'runs.json');
  const issuesFile = path.join(root, 'issues.json');
  fs.writeFileSync(issuesFile, '[]');
  fs.writeFileSync(runsFile, '[]');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "${runsFile}"; exit 0; fi`,
    `if [ "$1" = "issue" ] && [ "$2" = "list" ]; then cat "${issuesFile}"; exit 0; fi`,
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const fx = { root, origin, work, home, bin, git, runsFile };
  fx.originSha = (ref) => git(origin, 'rev-parse', ref);
  /** CI runs at origin's `ref` head: one `ci` run with `conclusion`. */
  fx.ci = (ref, conclusion = 'success') => fs.writeFileSync(runsFile, JSON.stringify([{
    headSha: fx.originSha(ref), status: 'completed', conclusion, workflowName: 'ci',
    createdAt: new Date().toISOString(), databaseId: 100,
  }]));
  fx.runner = () => {
    const dir = path.join(root, `runner-${Math.random().toString(36).slice(2, 8)}`);
    execFileSync('git', ['clone', '-q', '--branch', 'main', origin, dir]);
    ident(dir);
    return dir;
  };
  if (/^trunk: dev$/m.test(projectYml)) fx.ci('dev');
  return fx;
}

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home,
      COLAB_HUMAN: '', COLAB_SESSION: '', COLAB_SESSION_NAME: '',
      CLAUDE_PID: '', CLAUDECODE: '', AI_AGENT: '',
      ...extraEnv,
    },
  });
  let body = null;
  try { body = JSON.parse(r.stdout); } catch (_) { /* no verdict */ }
  return { code: r.status, body, out: r.stdout || '', err: r.stderr || '' };
}

const promoteAuto = (fx, repo, env) => colab(fx, ['promote', '--auto', '--json', '--repo', repo], env);

test('deploy: tag + promotion: main-loop: a green dev is promoted unattended — no COLAB_HUMAN, --no-ff, dev is the second parent', () => {
  const fx = fixture(yml());
  const before = fx.originSha('main');
  const r = promoteAuto(fx, fx.runner());
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.promoted, true);
  assert.strictEqual(r.body.noop, false);
  assert.strictEqual(r.body.from, 'dev');
  const head = fx.originSha('main');
  assert.notStrictEqual(head, before);
  assert.strictEqual(r.body.sha, head);
  const parents = fx.git(fx.origin, 'rev-list', '--parents', '-n', '1', head).split(' ').slice(1);
  assert.deepStrictEqual(parents, [before, fx.originSha('dev')], 'a --no-ff merge whose later parent is dev');
  assert.match(fx.git(fx.origin, 'log', '-1', '--format=%s', head), /^release: dev → main — .*--auto, unattended/);
  assert.ok(r.body.checks.every((c) => c.ok), JSON.stringify(r.body.checks));
  assert.ok(r.body.checks.some((c) => c.condition === 'dev ahead of main'));
  // stdout is the verdict alone; the human table went to stderr.
  assert.match(r.err, /PRECONDITION/);
});

test('the issue\'s oracle: a green dev → a promotion → a candidate, with no human step', () => {
  const fx = fixture(yml());
  const runner = fx.runner();
  const p = promoteAuto(fx, runner);
  assert.strictEqual(p.body && p.body.promoted, true, p.out + p.err);
  fx.ci('main'); // the dispatched CI run on the promotion goes green
  const c = colab(fx, ['release', 'cut', '--auto', '--json', '--repo', runner], { COLAB_SESSION: 'sess-promote-auto' });
  assert.strictEqual(c.code, 0, c.out + c.err);
  assert.strictEqual(c.body.created, true, JSON.stringify(c.body.checks, null, 2));
  assert.strictEqual(c.body.tag, 'v1.2.1-rc.1');
  assert.strictEqual(fx.git(fx.origin, 'rev-list', '-n', '1', 'v1.2.1-rc.1'), fx.originSha('main'));
  // Never a final: that click stays human on deploy: tag.
  assert.doesNotMatch(fx.git(fx.origin, 'tag', '--list'), /^v1\.2\.1$/m);
});

for (const [label, shape] of [
  ['promotion: human', { promotion: 'human' }],
  ['promotion absent (human by default)', { promotion: null }],
  ['deploy: push-main', { deploy: 'push-main' }],
  ['deploy: manual', { deploy: 'manual' }],
  ['deploy: none', { deploy: 'none' }],
]) {
  test(`${label}: nothing promotes — a no-op, exit 0, even with COLAB_HUMAN=1`, () => {
    const fx = fixture(yml(shape));
    const before = fx.originSha('main');
    for (const env of [{}, { COLAB_HUMAN: '1' }]) {
      const r = promoteAuto(fx, fx.runner(), env);
      assert.strictEqual(r.code, 0, r.out + r.err);
      assert.strictEqual(r.body.ok, true);
      assert.strictEqual(r.body.promoted, false);
      assert.strictEqual(r.body.noop, true);
      assert.ok(r.body.reason, 'a no-op names why');
      assert.strictEqual(fx.originSha('main'), before);
    }
  });
}

test('trunk: main: no promotion exists — a no-op under --auto, still a refusal without it', () => {
  const fx = fixture(yml({ trunk: 'main' }));
  const r = promoteAuto(fx, fx.work);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.noop, true);
  const plain = colab(fx, ['promote', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.strictEqual(plain.code, 1);
  assert.match(plain.err, /no promotion exists/);
});

test('dev not ahead of main: a no-op, nothing pushed', () => {
  const fx = fixture(yml());
  assert.strictEqual(promoteAuto(fx, fx.runner()).body.promoted, true);
  const head = fx.originSha('main');
  fx.ci('dev');
  const again = promoteAuto(fx, fx.runner());
  assert.strictEqual(again.code, 0, again.out + again.err);
  assert.strictEqual(again.body.noop, true);
  assert.match(again.body.reason, /not ahead/);
  assert.strictEqual(fx.originSha('main'), head);
});

test('dev CI not green: a refusal verdict (exit 1, JSON), nothing pushed', () => {
  for (const conclusion of ['failure', 'skipped']) {
    const fx = fixture(yml());
    fx.ci('dev', conclusion);
    const before = fx.originSha('main');
    const r = promoteAuto(fx, fx.runner());
    assert.strictEqual(r.code, 1, r.out + r.err);
    assert.ok(r.body, 'a refusal is still a verdict');
    assert.strictEqual(r.body.ok, false);
    assert.strictEqual(r.body.promoted, false);
    const ci = r.body.checks.find((c) => c.condition === 'trunk CI green');
    assert.strictEqual(ci.ok, false);
    assert.strictEqual(fx.originSha('main'), before);
  }
});

test('--auto --dry: reports READY and moves nothing', () => {
  const fx = fixture(yml());
  const before = fx.originSha('main');
  const r = colab(fx, ['promote', '--auto', '--dry', '--json', '--repo', fx.runner()]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.dry, true);
  assert.strictEqual(r.body.promoted, false);
  assert.strictEqual(fx.originSha('main'), before);
});

test('without --auto the human gate is unchanged: promotion: human still needs COLAB_HUMAN=1', () => {
  const fx = fixture(yml({ promotion: 'human' }));
  const r = colab(fx, ['promote', '--repo', fx.runner()]);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /a human must promote dev→main/);
});
