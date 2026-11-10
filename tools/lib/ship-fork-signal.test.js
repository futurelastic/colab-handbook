'use strict';
/**
 * End-to-end tests for #702 — the core-path review's fork test (#483) reads this checkout's
 * `upstream` remote or the descriptor's `instruction-files: upstream` (#658). A fork whose clone
 * lacks the remote and whose descriptor declares nothing reads as active on that clone and inert on
 * one that has the remote. `ship --dry` must then name the missing signal and the declaration.
 *
 * Real CLI, real repo, real bare `origin`; `gh` is a stub answering only what a dry run asks.
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.join(__dirname, '..', 'colab');
const SESSION = 'https://claude.ai/code/session_fork_signal_S';
const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const INHERITED = '* @upstream-org/maintainers\n/.github/ @upstream-org/maintainers @upstream-org/ci\n';
const ORIGIN_URL = 'https://github.com/acme/app.git';

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture({ upstream = false, yml = YML } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-fork-signal-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'fork-signal test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', ORIGIN_URL);
  g('config', `url.${origin}.insteadOf`, ORIGIN_URL);
  if (upstream) g('remote', 'add', 'upstream', 'https://github.com/upstream-org/app.git');
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(work, '.github', 'CODEOWNERS'), INHERITED);
  fs.writeFileSync(path.join(work, 'f.js'), 'base\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  g('push', '-q', 'origin', 'main');
  g('checkout', '-q', '-b', 'feat/change-41');
  fs.writeFileSync(path.join(work, 'f.js'), 'changed\n');
  g('commit', '-qam', 'feat: change (#41)');
  g('checkout', '-q', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    'if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo "PRIVATE"; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    `  SHA=$(cd "${work}" && git rev-parse main)`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\"}]"; exit 0',
    'fi',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then echo \'{"state":"OPEN","labels":[],"comments":[]}\'; exit 0; fi',
    'if [ "$1" = "issue" ] || [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2; exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const colab = (args) => {
    const r = spawnSync('node', [COLAB, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home, COLAB_HOME: home,
        COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '' },
    });
    return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
  };
  assert.strictEqual(colab(['claim', '41', '--branch', 'feat/change-41', '--repo', work]).code, 0);
  return { work, colab };
}

const dryJson = (fx) => {
  const r = fx.colab(['ship', '--dry', '--json', '--branch', 'feat/change-41', '--repo', fx.work]);
  return { r, payload: JSON.parse(r.out) };
};

test('#702 a clone without `upstream` and no declaration: --dry names the missing fork signal', () => {
  const fx = fixture();
  const { r, payload } = dryJson(fx);
  const cr = payload.coreReview;
  assert.strictEqual(cr.active, true, r.out + r.err);
  assert.match(cr.forkSignal, /fork not detected/);
  assert.match(cr.forkSignal, /instruction-files: upstream/);
  const row = payload.checks.find((c) => /core-path review/.test(c.name));
  assert.match(row.detail, /fork not detected: no `upstream` remote, no `instruction-files: upstream` \(#702\)/);

  const prose = fx.colab(['ship', '--dry', '--branch', 'feat/change-41', '--repo', fx.work]);
  assert.match(prose.err, /! \.github\/CODEOWNERS: fork not detected: .*instruction-files: upstream/);
});

test('#702 the clone WITH `upstream`, and a clone with only the declaration, agree: inert, no note', () => {
  for (const fx of [fixture({ upstream: true }), fixture({ yml: YML + 'instruction-files: upstream\n' })]) {
    const { r, payload } = dryJson(fx);
    const cr = payload.coreReview;
    assert.strictEqual(cr.verdict, 'inert', r.out + r.err);
    assert.strictEqual(cr.forkSignal, null);
    assert.deepStrictEqual(cr.ignoredOwners.sort(), ['@upstream-org/ci', '@upstream-org/maintainers']);
  }
});
