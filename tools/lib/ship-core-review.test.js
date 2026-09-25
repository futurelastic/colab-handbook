'use strict';
/**
 * End-to-end tests for #350 — a branch touching a core path (one the TARGET's CODEOWNERS covers)
 * goes up as a PR and pauses; it lands only once an account other than the author approved its
 * current head. Every squash carries a `Machine:` trailer.
 *
 * Real CLI, real repo, real bare `origin`; `gh` is a logging stub (the ship-docs-only.test.js shape)
 * that also answers `pr list` from a file the test writes, `pr create` and `pr close`.
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
const SESSION = 'https://claude.ai/code/session_core_review_S';
const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const CORE_OWNED = '/.github/workflows/ @other\n/.github/CODEOWNERS @other\n';

const TMP = [];
process.on('exit', () => { for (const dir of TMP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } });

// #367: `visibility` is what the fixture `gh repo view` answers — null makes that read FAIL, the
// shape of a non-GitHub remote or an offline gh. `yml` overrides the descriptor (e.g. to add room:).
function fixture(codeownersText = CORE_OWNED, { visibility = 'PRIVATE', yml = YML } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-core-review-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  const prFile = path.join(root, 'pr.json');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'core-review test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'on: push\n');
  if (codeownersText !== null) fs.writeFileSync(path.join(work, '.github', 'CODEOWNERS'), codeownersText);
  fs.writeFileSync(path.join(work, 'f.js'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$*" >> "${ghLog}"`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    ...(visibility ? [`if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo "${visibility}"; exit 0; fi`] : []),
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    `  SHA=$(cd "${work}" && git rev-parse "refs/heads/$BR" 2>/dev/null)`,
    `  if [ -z "$SHA" ]; then SHA=$(cd "${work}" && git rev-parse HEAD); fi`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\"}]"',
    '  exit 0',
    'fi',
    `if [ "$1" = "pr" ] && [ "$2" = "list" ]; then if [ -f "${prFile}" ]; then cat "${prFile}"; else echo "[]"; fi; exit 0; fi`,
    'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://forge.invalid/o/r/pull/7"; exit 0; fi',
    'if [ "$1" = "pr" ] && [ "$2" = "close" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then echo \'{"state":"OPEN","labels":[],"comments":[]}\'; exit 0; fi',
    'if [ "$1" = "issue" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, origin, home, bin, ghLog, prFile, g };
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
  return fx.g(fx.work, 'rev-parse', name);
}

function openPr(fx, head, reviews) {
  fs.writeFileSync(fx.prFile, JSON.stringify([{
    number: 7, url: 'https://forge.invalid/o/r/pull/7', state: 'OPEN', author: { login: 'me' }, headRefOid: head, reviews,
  }]));
}
const review = (login, oid, state = 'APPROVED') => ({ author: { login }, state, commit: { oid }, submittedAt: '2026-01-01T00:00:00Z' });

const log = (fx) => (fs.existsSync(fx.ghLog) ? fs.readFileSync(fx.ghLog, 'utf8') : '');
const originMain = (fx) => execFileSync('git', ['--git-dir', fx.origin, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
const originMsg = (fx) => execFileSync('git', ['--git-dir', fx.origin, 'log', '-1', '--format=%B', 'main'], { encoding: 'utf8' });

test('#350 (a): a core-path branch opens a PR and pauses — exit 3, no squash, claim intact', () => {
  const fx = fixture();
  const before = originMain(fx);
  branch(fx, 'feat/gate-91', 91, { '.github/workflows/ci.yml': 'on: [push, pull_request]\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/gate-91', '--repo', fx.work]);
  assert.strictEqual(r.code, 3, r.out + r.err);
  assert.match(r.out, /PR-PENDING/);
  assert.match(r.out, /\.github\/workflows\/ci\.yml\s+\(@other\)/);
  assert.match(log(fx), /pr create --base main --head feat\/gate-91/);
  assert.strictEqual(originMain(fx), before, 'origin main must not move');
  // The branch was published for the PR.
  assert.ok(execFileSync('git', ['--git-dir', fx.origin, 'rev-parse', 'feat/gate-91'], { encoding: 'utf8' }).trim());
  assert.match(colab(fx, ['claims']).out, /91/);
});

test('#350 (b): a non-author approval at the head sha lands it, and the PR is closed', () => {
  const fx = fixture();
  const head = branch(fx, 'feat/gate-92', 92, { '.github/workflows/ci.yml': 'on: [push]\n' });
  openPr(fx, head, [review('other', head)]);
  const r = colab(fx, ['ship', '--branch', 'feat/gate-92', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /PR #7 approved by other/);
  assert.match(originMsg(fx), /Closes #92/);
  assert.match(log(fx), /pr close 7 --comment/);
  assert.doesNotMatch(log(fx), /pr create/);
});

test('#350 (c): a non-core branch lands unchanged, with no pr call at all', () => {
  const fx = fixture();
  branch(fx, 'feat/app-93', 93, { 'f.js': 'changed\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/app-93', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /no core path touched/);
  assert.doesNotMatch(log(fx), /^pr /m);
});

test('#350 (d): no CODEOWNERS, or one naming only the author, is inert — the core branch lands', () => {
  for (const text of [null, '* @me\n']) {
    const fx = fixture(text);
    branch(fx, 'feat/gate-94', 94, { '.github/workflows/ci.yml': 'on: [push]\n' });
    const r = colab(fx, ['ship', '--branch', 'feat/gate-94', '--repo', fx.work]);
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /core-path review \(#350\)\s+inert: /);
    assert.doesNotMatch(log(fx), /^pr /m);
  }
});

test('#350 (e): the squash carries a Machine: trailer — composed and --message paths', () => {
  const fx = fixture();
  branch(fx, 'feat/app-95', 95, { 'f.js': 'x\n' });
  assert.strictEqual(colab(fx, ['ship', '--branch', 'feat/app-95', '--repo', fx.work]).code, 0);
  assert.match(originMsg(fx), /^Machine: [a-z0-9-]+$/m);
  branch(fx, 'feat/app-96', 96, { 'f.js': 'y\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/app-96', '--repo', fx.work, '--message', 'feat: by hand']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(originMsg(fx), /^feat: by hand/);
  assert.match(originMsg(fx), /^Machine: [a-z0-9-]+$/m);
});

test('#350 (f): --dry --json reports mode pr-pending and the core paths, and creates nothing', () => {
  const fx = fixture();
  branch(fx, 'feat/gate-97', 97, { '.github/workflows/ci.yml': 'on: [push]\n', 'f.js': 'z\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/gate-97', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.mode, 'pr-pending');
  assert.strictEqual(j.coreReview.active, true);
  assert.deepStrictEqual(j.coreReview.corePaths, ['.github/workflows/ci.yml']);
  assert.match(j.machineTrailer, /^Machine: /);
  const prose = colab(fx, ['ship', '--branch', 'feat/gate-97', '--repo', fx.work, '--dry']);
  assert.strictEqual(prose.code, 0, prose.out + prose.err);
  assert.match(prose.out, /PAUSE \(⏸ exit 3, no squash\)/);
  assert.doesNotMatch(log(fx), /pr create/);
});

test('#350 (g): a self-approval, or an approval of an older head, stays pending', () => {
  const fx = fixture();
  const head = branch(fx, 'feat/gate-98', 98, { '.github/CODEOWNERS': '* @other\n' });
  const before = originMain(fx);
  openPr(fx, head, [review('me', head)]);
  const self = colab(fx, ['ship', '--branch', 'feat/gate-98', '--repo', fx.work]);
  assert.strictEqual(self.code, 3, self.out + self.err);
  assert.match(self.out, /only the author's own account has approved/);
  openPr(fx, head, [review('other', '0000000000000000000000000000000000000000')]);
  const stale = colab(fx, ['ship', '--branch', 'feat/gate-98', '--repo', fx.work]);
  assert.strictEqual(stale.code, 3, stale.out + stale.err);
  assert.match(stale.out, /stale/);
  assert.strictEqual(originMain(fx), before);
  assert.doesNotMatch(log(fx), /pr create/, 'an open PR is reused, never duplicated');
});

// =================================================================================================
// #367 — the Machine: trailer names a host; a public repo's squash must never carry it
// =================================================================================================

const machineLines = (msg) => msg.split('\n').filter((l) => /^Machine:/i.test(l));

test('#367 (a): a PUBLIC repo — composed and --message squashes carry no Machine: trailer', () => {
  const fx = fixture(CORE_OWNED, { visibility: 'PUBLIC' });
  branch(fx, 'feat/app-101', 101, { 'f.js': 'x\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/app-101', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.deepStrictEqual(machineLines(originMsg(fx)), []);
  assert.match(originMsg(fx), /Closes #101/);
  assert.match(r.out, /Machine trailer omitted — repository is public/);
  branch(fx, 'feat/app-102', 102, { 'f.js': 'y\n' });
  const m = colab(fx, ['ship', '--branch', 'feat/app-102', '--repo', fx.work, '--message', 'feat: by hand']);
  assert.strictEqual(m.code, 0, m.out + m.err);
  assert.match(originMsg(fx), /^feat: by hand/);
  assert.deepStrictEqual(machineLines(originMsg(fx)), []);
});

test('#367 (b): a PRIVATE repo is unchanged — the squash still carries Machine: <label>', () => {
  const fx = fixture(CORE_OWNED, { visibility: 'PRIVATE' });
  branch(fx, 'feat/app-103', 103, { 'f.js': 'x\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/app-103', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(machineLines(originMsg(fx)).length, 1);
  assert.match(originMsg(fx), /^Machine: [a-z0-9-]+$/m);
  assert.doesNotMatch(r.out + r.err, /Machine trailer omitted/);
});

test('#367 (c): room: public in project.yml omits it even where the forge reads private', () => {
  const fx = fixture(CORE_OWNED, { visibility: 'PRIVATE', yml: YML + 'room: public\n' });
  branch(fx, 'feat/app-104', 104, { 'f.js': 'x\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/app-104', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.deepStrictEqual(machineLines(originMsg(fx)), []);
  assert.match(r.out, /room: public/);
});

test('#367 (d): visibility unreadable — fails closed with a warning; a declared private room keeps it', () => {
  const closed = fixture(CORE_OWNED, { visibility: null });
  branch(closed, 'feat/app-105', 105, { 'f.js': 'x\n' });
  const r = colab(closed, ['ship', '--branch', 'feat/app-105', '--repo', closed.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.deepStrictEqual(machineLines(originMsg(closed)), []);
  assert.match(r.err, /Machine trailer omitted — visibility could not be read.*failing closed/);

  const team = fixture(CORE_OWNED, { visibility: null, yml: YML + 'room: team\n' });
  branch(team, 'feat/app-106', 106, { 'f.js': 'x\n' });
  const t = colab(team, ['ship', '--branch', 'feat/app-106', '--repo', team.work]);
  assert.strictEqual(t.code, 0, t.out + t.err);
  assert.match(originMsg(team), /^Machine: [a-z0-9-]+$/m);
});

test('#367 (e): --dry and --dry --json say which way it will go, and change nothing', () => {
  for (const [visibility, include] of [['PUBLIC', false], ['PRIVATE', true]]) {
    const fx = fixture(CORE_OWNED, { visibility });
    branch(fx, 'feat/app-107', 107, { 'f.js': 'x\n' });
    const before = originMain(fx);
    const j = JSON.parse(colab(fx, ['ship', '--branch', 'feat/app-107', '--repo', fx.work, '--dry', '--json']).out);
    assert.strictEqual(j.machineTrailerDecision.include, include);
    assert.strictEqual(j.machineTrailerDecision.visibility, visibility);
    if (include) assert.match(j.machineTrailer, /^Machine: /);
    else assert.strictEqual(j.machineTrailer, null);
    const prose = colab(fx, ['ship', '--branch', 'feat/app-107', '--repo', fx.work, '--dry']);
    assert.strictEqual(prose.code, 0, prose.out + prose.err);
    assert.match(prose.out, include ? /Machine trailer: Machine: [a-z0-9-]+ — repository is private/ : /Machine trailer: omitted — repository is public/);
    assert.strictEqual(originMain(fx), before, '--dry must not move origin');
  }
});
