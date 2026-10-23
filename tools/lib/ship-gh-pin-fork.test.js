'use strict';
/**
 * End-to-end tests for #658 — on a fork checkout, colab reads the right repo whatever the local
 * gh and remote state:
 *   (a) every `gh` spawn is pinned to origin's repo (GH_REPO), so an `upstream` remote with no
 *       `gh repo set-default` no longer sends issue and CI reads to the upstream;
 *   (b) a fork declared in the descriptor (`instruction-files: upstream`, #602) with no `upstream`
 *       remote still drops the inherited foreign-org CODEOWNERS teams (#483).
 *
 * Real CLI, real repo, real bare origin reached through `url.<path>.insteadOf` so the configured
 * origin url still reads as a github.com repo. `gh` is a stub that answers like a gh with NO
 * default repo would: unpinned (GH_REPO unset) it reads the upstream — issues CLOSED, no CI run.
 *
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
const SESSION = 'https://claude.ai/code/session_gh_pin_fork_S';
const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const ORIGIN_URL = 'https://github.com/own-org/app.git';
const UPSTREAM_URL = 'https://github.com/up-org/app.git';

const TMP = [];
process.on('exit', () => { for (const dir of TMP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } });

function fixture({ yml = YML, codeowners = null, upstream = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-gh-pin-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'gh-pin test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'config', `url.${origin}.insteadOf`, ORIGIN_URL);
  g(work, 'remote', 'add', 'origin', ORIGIN_URL);
  if (upstream) {
    g(work, 'remote', 'add', 'upstream', UPSTREAM_URL);
    g(work, 'remote', 'set-url', '--push', 'upstream', 'DISABLED');
  }
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'on: push\n');
  if (codeowners !== null) fs.writeFileSync(path.join(work, '.github', 'CODEOWNERS'), codeowners);
  fs.writeFileSync(path.join(work, 'f.js'), 'base\n');
  g(work, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', 'chore: fixture'], {
    cwd: work, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' },
  });
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // Pinned to own-org/app → origin's truth (issue OPEN, CI green at the sha). Anything else → the
  // upstream's answer (issue CLOSED, no run), which is what an unpinned gh with no default reads.
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "GH_REPO=$GH_REPO $*" >> "${ghLog}"`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    'if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo "PRIVATE"; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  if [ "$GH_REPO" != "own-org/app" ]; then echo "[]"; exit 0; fi',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    `  SHA=$(cd "${work}" && git rev-parse "refs/heads/$BR" 2>/dev/null)`,
    `  if [ -z "$SHA" ]; then SHA=$(cd "${work}" && git rev-parse HEAD); fi`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\",\\"event\\":\\"push\\",\\"workflowName\\":\\"CI\\",\\"name\\":\\"CI\\"}]"',
    '  exit 0',
    'fi',
    'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    '  if [ "$GH_REPO" = "own-org/app" ]; then echo \'{"state":"OPEN","labels":[],"comments":[]}\'; else echo \'{"state":"CLOSED","labels":[],"comments":[]}\'; fi',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, origin, home, bin, ghLog, g };
}

function colab(fx, args) {
  const env = {
    ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
    COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '',
  };
  delete env.GH_REPO; // the case under test: no explicit repo anywhere
  delete env.GH_HOST;
  const r = spawnSync('node', [COLAB, ...args], { encoding: 'utf8', env });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function branch(fx, name, num, files) {
  fx.g(fx.work, 'checkout', '-q', '-b', name);
  for (const [p, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(fx.work, p)), { recursive: true });
    fs.writeFileSync(path.join(fx.work, p), body);
  }
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `feat: change (#${num})`);
  fx.g(fx.work, 'checkout', '-q', 'main');
  assert.strictEqual(colab(fx, ['claim', String(num), '--branch', name, '--repo', fx.work]).code, 0);
}

const log = (fx) => (fs.existsSync(fx.ghLog) ? fs.readFileSync(fx.ghLog, 'utf8') : '');

test('#658 (a): an upstream remote and no gh default — every gh call is pinned to origin, and ship --dry reads origin', () => {
  const fx = fixture({ upstream: true });
  branch(fx, 'fix/thing-41', 41, { 'f.js': 'changed\n' });
  const r = colab(fx, ['ship', '--branch', 'fix/thing-41', '--repo', fx.work, '--dry', '--json']);
  const lines = log(fx).split('\n').filter((l) => /^GH_REPO=\S* (issue|run|pr) /.test(l));
  assert.ok(lines.length > 0, `no issue/run/pr gh call recorded:\n${log(fx)}`);
  for (const l of lines) assert.match(l, /^GH_REPO=own-org\/app /, `unpinned gh call: ${l}`);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const ci = JSON.parse(r.out).checks.find((c) => c.name === 'trunk CI green');
  assert.ok(ci && ci.ok, `trunk CI read from the wrong repo: ${JSON.stringify(ci)}`);
});

test('#658 (a): an explicit GH_REPO in the environment is honoured, never overwritten', () => {
  const fx = fixture({ upstream: true });
  const r = spawnSync('node', [COLAB, 'ci-wait', '--sha', fx.g(fx.work, 'rev-parse', 'HEAD'), '--repo', fx.work, '--timeout', '1'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home, GH_REPO: 'chosen/elsewhere' },
  });
  const lines = log(fx).split('\n').filter((l) => / (run|api) /.test(l));
  assert.ok(lines.length > 0, `no CI read recorded (exit ${r.status}):\n${r.stdout}${r.stderr}${log(fx)}`);
  for (const l of lines) assert.match(l, /^GH_REPO=chosen\/elsewhere /);
});

const FOREIGN = '* @up-org/core\n';

test('#658 (b): a declared fork (instruction-files: upstream) with no upstream remote drops the inherited foreign-org team', () => {
  const fx = fixture({ yml: `${YML}instruction-files: upstream\n`, codeowners: FOREIGN });
  branch(fx, 'fix/thing-42', 42, { 'f.js': 'changed\n' });
  const r = colab(fx, ['ship', '--branch', 'fix/thing-42', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.coreReview.ignoredOwners, ['@up-org/core']);
  assert.notStrictEqual(j.mode, 'pr-pending');
});

test('#658 (b): the same checkout without the declaration is not a fork — the team still binds', () => {
  const fx = fixture({ codeowners: FOREIGN });
  branch(fx, 'fix/thing-43', 43, { 'f.js': 'changed\n' });
  const r = colab(fx, ['ship', '--branch', 'fix/thing-43', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.coreReview.ignoredOwners, []);
  assert.strictEqual(j.mode, 'pr-pending');
});
