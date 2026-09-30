'use strict';
/**
 * End-to-end tests for `colab deliver` — #394 (ruled D). A repo the fleet builds in but does not
 * own declares `owner: { branch: master }`; trunk is the fleet's integration branch. Deliver opens
 * or refreshes ONE PR trunk → master and never merges it, and no colab command moves master.
 *
 * Real CLI, real repo, real bare `origin`; `gh` is a logging stub that answers `pr list` from a
 * file the test writes (the ship-core-review.test.js shape).
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
const TRUNK = 'fleet/integration';
const YML_OWNED = `trunk: ${TRUNK}\nproduction: null\ndeploy: none\nstack: node\nexposure: self\nowner:\n  branch: master\n`;

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture({ yml = YML_OWNED, ownerBranch = 'master', trunk = TRUNK } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-deliver-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  const prFile = path.join(root, 'prs.json');
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', ownerBranch, origin]);
  execFileSync('git', ['init', '-q', '-b', ownerBranch, work]);
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'deliver test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(work, 'app.js'), 'owner\n');
  g('add', '-A'); g('commit', '-q', '-m', 'owner: initial');
  g('push', '-q', 'origin', ownerBranch);
  g('checkout', '-q', '-b', trunk);
  const commit = (file, msg) => { fs.writeFileSync(path.join(work, file), msg + '\n'); g('add', file); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  const c1 = commit('a.js', 'feat: service layer (#12)\n\nCloses #12');
  const c2 = commit('b.js', 'fix: retry (#13)\n\nCloses #13');
  g('push', '-q', 'origin', trunk);
  // local-only adoption: the descriptor lives in the working tree, excluded, never committed
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.appendFileSync(path.join(work, '.git', 'info', 'exclude'), '.github/project.yml\n');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$*" >> "${ghLog}"`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ]; then exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    `if [ "$1" = "pr" ] && [ "$2" = "list" ]; then if [ -f "${prFile}" ]; then cat "${prFile}"; else echo "[]"; fi; exit 0; fi`,
    'if [ "$1" = "pr" ] && [ "$2" = "create" ]; then echo "https://forge.invalid/o/r/pull/21"; exit 0; fi',
    'if [ "$1" = "pr" ] && [ "$2" = "edit" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then echo \'{"state":"OPEN","labels":[],"comments":[]}\'; exit 0; fi',
    'if [ "$1" = "issue" ] || [ "$1" = "label" ]; then exit 0; fi',
    'if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo PRIVATE; exit 0; fi',
    'echo "unexpected gh call: $*" >&2; exit 1',
    '',
  ].join('\n'));
  fs.chmodSync(path.join(bin, 'gh'), 0o755);

  const run = (args, env = {}) => spawnSync('node', [COLAB, ...args, '--repo', work], {
    cwd: work, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: home, COLAB_HUMAN: '', ...env },
  });
  const originSha = (b) => execFileSync('git', ['rev-parse', b], { cwd: origin, encoding: 'utf8' }).trim();
  const ghCalls = () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8') : '');
  const setPrs = (list) => fs.writeFileSync(prFile, JSON.stringify(list));
  return { work, origin, g, commit, run, originSha, ghCalls, setPrs, c1, c2 };
}

const json = (r) => JSON.parse(r.stdout);

test('no owner: key → refuses, touches nothing (absent key = today\'s behaviour)', () => {
  const f = fixture({ yml: `trunk: ${TRUNK}\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n` });
  const r = f.run(['deliver', '--dry']);
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /declares no owner:/);
  assert.doesNotMatch(f.ghCalls(), /pr create|pr edit/);
});

test('first delivery: --dry reports ready; a write needs a human; with one, ONE PR trunk → master, never merged', () => {
  const f = fixture();
  const masterBefore = f.originSha('master');

  const dry = f.run(['deliver', '--dry', '--json']);
  assert.strictEqual(dry.status, 0, dry.stderr);
  const d = json(dry);
  assert.strictEqual(d.state, 'ready');
  assert.strictEqual(d.pending.length, 2);
  assert.deepStrictEqual(d.issues, [12, 13]);
  assert.doesNotMatch(f.ghCalls(), /pr create/);

  const unattended = f.run(['deliver']);
  assert.strictEqual(unattended.status, 1);
  assert.match(unattended.stderr, /COLAB_HUMAN=1/);
  assert.doesNotMatch(f.ghCalls(), /pr create/);

  const r = f.run(['deliver'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /opened https:\/\/forge\.invalid\/o\/r\/pull\/21/);
  const calls = f.ghCalls();
  assert.match(calls, /pr create --base master --head fleet\/integration/);
  assert.match(calls, /Issues carried/);
  assert.doesNotMatch(calls, /pr merge/);
  assert.strictEqual(f.originSha('master'), masterBefore, 'the owner\'s branch never moved');
});

test('an open delivery PR is refreshed (edit), never duplicated', () => {
  const f = fixture();
  f.setPrs([{ number: 21, url: 'https://forge.invalid/o/r/pull/21', state: 'OPEN', headRefOid: f.c2 }]);
  const dry = json(f.run(['deliver', '--dry', '--json']));
  assert.strictEqual(dry.state, 'waiting-on-owner');
  assert.strictEqual(dry.pr.number, 21);
  const r = f.run(['deliver'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(f.ghCalls(), /pr edit 21/);
  assert.doesNotMatch(f.ghCalls(), /pr create/);
});

test('owner SQUASH-merged the last PR: delivered by PR state, and only work since its head is pending', () => {
  const f = fixture();
  // The owner squashed c1+c2 onto master: master gains one NEW commit, no trunk commit is an ancestor.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-deliver-owner-')); TMP.push(tmp);
  execFileSync('git', ['clone', '-q', '-b', 'master', f.origin, tmp]);
  const og = (...a) => execFileSync('git', a, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  og('config', 'user.email', 'owner@example.invalid'); og('config', 'user.name', 'owner');
  fs.writeFileSync(path.join(tmp, 'a.js'), 'squashed\n'); fs.writeFileSync(path.join(tmp, 'b.js'), 'squashed\n');
  og('add', '-A'); og('commit', '-q', '-m', 'Deliver (#21)'); og('push', '-q', 'origin', 'master');
  f.setPrs([{ number: 21, url: 'u21', state: 'MERGED', mergedAt: '2026-01-01T00:00:00Z', headRefOid: f.c2 }]);

  // nothing new yet
  const quiet = json(f.run(['deliver', '--dry', '--json']));
  assert.strictEqual(quiet.state, 'nothing-to-deliver', JSON.stringify(quiet));
  assert.strictEqual(quiet.lastMerged.number, 21);

  // new work lands on trunk → exactly that is pending, and a FRESH PR is opened
  f.commit('c.js', 'feat: next (#14)\n\nCloses #14');
  f.g('push', '-q', 'origin', TRUNK);
  const next = json(f.run(['deliver', '--dry', '--json']));
  assert.strictEqual(next.state, 'ready');
  assert.deepStrictEqual(next.pending.map((c) => c.subject), ['feat: next (#14)']);
  assert.deepStrictEqual(next.issues, [14]);
  assert.match(next.since, /PR #21/);
});

test('owner CLOSED the newest PR unmerged → rejected, exit 3, nothing opened unless --reopen', () => {
  const f = fixture();
  f.setPrs([{ number: 22, url: 'u22', state: 'CLOSED', headRefOid: f.c2 }]);
  const r = f.run(['deliver'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /rejected/);
  assert.doesNotMatch(f.ghCalls(), /pr create/);
  const again = f.run(['deliver', '--reopen'], { COLAB_HUMAN: '1' });
  assert.strictEqual(again.status, 0, again.stderr);
  assert.match(f.ghCalls(), /pr create/);
});

test('promote refuses to move the owner\'s branch — even with COLAB_HUMAN=1', () => {
  const yml = 'tier: A\ntrunk: dev\nproduction: null\ndeploy: tag\nstack: node\nowner:\n  branch: main\n';
  const f = fixture({ yml, ownerBranch: 'main', trunk: 'dev' });
  const mainBefore = f.originSha('main');
  const r = f.run(['promote'], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /owner's branch/);
  assert.strictEqual(f.originSha('main'), mainBefore);
});

test('ship refuses a target that is the owner\'s branch (a descriptor naming trunk as owner.branch fails closed)', () => {
  const yml = `trunk: ${TRUNK}\nproduction: null\ndeploy: none\nstack: node\nexposure: self\nautonomy: auto-trunk\nowner:\n  branch: ${TRUNK}\n`;
  const f = fixture({ yml });
  const trunkBefore = f.originSha(TRUNK);
  f.g('checkout', '-q', '-b', 'feat/x-31');
  f.commit('x.js', 'feat: x (#31)');
  f.g('checkout', '-q', TRUNK);
  const env = { COLAB_SESSION: 'https://claude.ai/code/session_deliver_T' };
  assert.strictEqual(f.run(['claim', '31', '--branch', 'feat/x-31'], env).status, 0);
  const r = f.run(['ship', '--branch', 'feat/x-31'], env);
  assert.notStrictEqual(r.status, 0, r.stdout);
  assert.match(r.stderr, /owner's branch/);
  assert.strictEqual(f.originSha(TRUNK), trunkBefore, 'nothing pushed');
});
