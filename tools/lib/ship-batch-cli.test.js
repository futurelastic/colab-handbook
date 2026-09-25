'use strict';
/**
 * End-to-end tests for `colab ship --batch` (#373) — the issue's five oracles, plus the edges.
 *
 * Real CLI, real repo, real bare `origin` — the fixture shape of ship-container-close.test.js. The
 * `gh` stub answers `run list --branch <b>` at origin's CURRENT sha for that branch: success, unless
 * `<root>/status/<b with / → _>` holds `<status> <conclusion> <attempt>`. A ship-batch ref's last
 * seen sha is remembered, so its runs still answer after the ref is deleted (as GitHub's do). Issues
 * read CLOSED once origin's `main` carries `Closes #N`, the way GitHub's auto-close behaves.
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

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const SESSION = 'https://claude.ai/code/session_ship_batch_S';
const YML = (extra = 'ship-batch: 3\n') => `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n${extra}`;
const CI_WIRED = "name: CI\non:\n  push:\n    branches: [main, 'ship-batch/**']\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n";
const CI_UNWIRED = 'name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n';
const MEMBERS = ['fix/a-11', 'fix/b-12', 'fix/c-13'];

function fixture({ yml = YML(), ci = CI_WIRED } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ship-batch-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  const statusDir = path.join(root, 'status');
  const seenDir = path.join(root, 'seen');
  for (const d of [home, statusDir, seenDir]) fs.mkdirSync(d);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'ship batch test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), ci);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
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
    'if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo PRIVATE; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "view" ]; then echo 1; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "rerun" ]; then exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    '  KEY=$(echo "$BR" | tr / _)',
    `  SHA=$(git -C "${origin}" rev-parse --verify -q "refs/heads/$BR")`,
    `  if [ -n "$SHA" ]; then echo "$SHA" > "${seenDir}/$KEY"; elif [ -f "${seenDir}/$KEY" ]; then SHA=$(cat "${seenDir}/$KEY"); fi`,
    '  if [ -z "$SHA" ]; then echo "[]"; exit 0; fi',
    '  ST=completed; CO=success; AT=1',
    `  if [ -f "${statusDir}/$KEY" ]; then read ST CO AT < "${statusDir}/$KEY"; fi`,
    '  if [ "$ST" = "none" ]; then echo "[]"; exit 0; fi',
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"$ST\\",\\"conclusion\\":\\"$CO\\",\\"attempt\\":$AT,\\"databaseId\\":9001,\\"workflowName\\":\\"CI\\",\\"createdAt\\":\\"2099-01-01T00:00:00Z\\"}]"',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    '  N="$3"',
    `  if git -C "${origin}" log main --format=%B 2>/dev/null | grep -q "Closes #$N\\b"; then`,
    '    echo \'{"state":"CLOSED","labels":[],"comments":[],"body":""}\'; exit 0',
    '  fi',
    '  echo \'{"state":"OPEN","labels":[],"comments":[],"body":""}\'; exit 0',
    'fi',
    'if [ "$1" = "issue" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const fx = { root, origin, work, home, bin, ghLog, statusDir, g };
  fx.originSha = (ref) => { try { return g(origin, 'rev-parse', '--verify', '-q', `refs/heads/${ref}`); } catch (_) { return ''; } };
  fx.batchRefs = () => g(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/ship-batch/').split('\n').filter(Boolean);
  fx.setStatus = (branch, line) => fs.writeFileSync(path.join(statusDir, branch.replace(/\//g, '_')), `${line}\n`);
  return fx;
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
const ghLog = (fx) => (fs.existsSync(fx.ghLog) ? fs.readFileSync(fx.ghLog, 'utf8') : '');

/** A member: one commit on its own file, claimed on this machine, then pushed. */
function member(fx, branch, { file, content } = {}) {
  const num = branch.match(/-(\d+)$/)[1];
  fx.g(fx.work, 'checkout', '-q', '-b', branch, 'main');
  fs.writeFileSync(path.join(fx.work, file || `${branch.replace(/\W/g, '_')}.txt`), content || `${branch}\n`);
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `fix: ${branch}`);
  fx.g(fx.work, 'checkout', '-q', 'main');
  // claim BEFORE the push: a branch already on origin that this machine never claimed is refused (#325)
  const c = colab(fx, ['claim', num, '--branch', branch, '--repo', fx.work]);
  assert.strictEqual(c.code, 0, c.out + c.err);
  fx.g(fx.work, 'push', '-q', 'origin', branch);
}
const batch = (fx, list = MEMBERS, extra = []) => colab(fx, ['ship', '--batch', list.join(','), '--repo', fx.work, ...extra]);

test('#373 oracle 1: three green disjoint members → one combined run, one fast-forward, three squashes', () => {
  const fx = fixture();
  for (const b of MEMBERS) member(fx, b);
  const T = fx.originSha('main');
  const ref = `ship-batch/${T.slice(0, 7)}`;
  fx.setStatus(ref, 'in_progress null 1');

  const r1 = batch(fx);
  assert.strictEqual(r1.code, 3, r1.out + r1.err);
  assert.match(r1.out, /BATCH-PENDING ship-batch\//);
  assert.strictEqual(fx.originSha('main'), T, 'nothing lands before the combined run is green');
  assert.deepStrictEqual(fx.batchRefs(), [ref]);
  const head = fx.originSha(ref);
  assert.strictEqual(fx.g(fx.origin, 'rev-list', '--count', `${T}..${head}`), '3');

  // a re-run while the combined run is still going only waits
  const rWait = batch(fx);
  assert.strictEqual(rWait.code, 3, rWait.out + rWait.err);
  assert.strictEqual(fx.originSha('main'), T);

  fx.setStatus(ref, 'completed success 1');
  const r2 = batch(fx);
  assert.strictEqual(r2.code, 0, r2.out + r2.err);
  assert.strictEqual(fx.originSha('main'), head, 'trunk is the tested batch head — one fast-forward');
  assert.deepStrictEqual(fx.batchRefs(), [], 'the batch ref is deleted once it lands');
  assert.strictEqual(fx.g(fx.work, 'rev-parse', 'main'), head, 'the trunk checkout follows');
  const shas = fx.g(fx.origin, 'rev-list', '--reverse', `${T}..main`).split('\n');
  assert.strictEqual(shas.length, 3);
  shas.forEach((sha, i) => {
    const parents = fx.g(fx.origin, 'rev-list', '--parents', '-n', '1', sha).split(' ');
    assert.strictEqual(parents.length, 2, 'every batch commit is a single-parent squash');
    const body = fx.g(fx.origin, 'log', '-1', '--format=%B', sha);
    const n = [11, 12, 13][i];
    assert.deepStrictEqual(body.match(/Closes #\d+/g), [`Closes #${n}`], body);
    assert.match(body, new RegExp(`^Ship-Batch: ${ref} ${MEMBERS[i]}@`, 'm'));
  });
  const log = ghLog(fx);
  for (const n of [11, 12, 13]) {
    assert.match(log, new RegExp(`issue comment ${n} --body 🚢 Shipped to main by colab ship — [0-9a-f]{7} · landed in a batch of 3 — combined run 9001 at ${ref}`));
  }
  assert.match(r2.out, /✓ Shipped batch → main/);
});

test('#373 oracle 2: a red combined run lands nothing; one re-run, then serial; serial still lands', () => {
  const fx = fixture();
  for (const b of MEMBERS) member(fx, b);
  const T = fx.originSha('main');
  const ref = `ship-batch/${T.slice(0, 7)}`;
  assert.strictEqual(batch(fx).code, 3);

  fx.setStatus(ref, 'completed failure 1');
  const r2 = batch(fx);
  assert.strictEqual(r2.code, 4, r2.out + r2.err);
  assert.strictEqual(fx.originSha('main'), T);
  assert.match(r2.out, /gh run rerun 9001 --failed/);
  assert.match(r2.out, /→ SERIAL: colab ship --branch fix\/a-11 · colab ship --branch fix\/b-12 · colab ship --branch fix\/c-13/);
  assert.deepStrictEqual(fx.batchRefs(), [ref], 'the ref is kept so the one re-run is possible');

  fx.setStatus(ref, 'completed failure 2');
  const r3 = batch(fx);
  assert.strictEqual(r3.code, 4, r3.out + r3.err);
  assert.strictEqual(fx.originSha('main'), T);
  assert.deepStrictEqual(fx.batchRefs(), [], 'red after its one re-run → the ref goes');
  assert.match(r3.out, /→ SERIAL:/);

  // the serial path is today's path, untouched — with ship-batch: 3 declared, one branch, one squash
  const s = colab(fx, ['ship', '--branch', 'fix/a-11', '--repo', fx.work]);
  assert.strictEqual(s.code, 0, s.out + s.err);
  assert.strictEqual(fx.g(fx.origin, 'rev-list', '--count', `${T}..main`), '1');

  // the culprit, red at its OWN head, is named when a new batch is asked for
  fx.setStatus('fix/b-12', 'completed failure 1');
  const r4 = batch(fx, ['fix/b-12', 'fix/c-13']);
  assert.strictEqual(r4.code, 4, r4.out + r4.err);
  assert.match(r4.out, /fix\/b-12\s+red at its own head/);
});

test('#373 oracle 3: trunk moves during the combined run → no fast-forward; the batch is rebuilt', () => {
  const fx = fixture();
  for (const b of MEMBERS) member(fx, b);
  const T = fx.originSha('main');
  assert.strictEqual(batch(fx).code, 3);
  fx.setStatus(`ship-batch/${T.slice(0, 7)}`, 'completed success 1');

  fs.writeFileSync(path.join(fx.work, 'moved.txt'), 'M\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: trunk moved');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  const M = fx.originSha('main');

  const r = batch(fx);
  assert.strictEqual(r.code, 3, r.out + r.err);
  assert.match(r.out, /trunk moved.*rebuilding/);
  assert.strictEqual(fx.originSha('main'), M, 'no fast-forward onto a trunk that moved');
  assert.deepStrictEqual(fx.batchRefs(), [`ship-batch/${M.slice(0, 7)}`]);
});

test('#373 oracle 4: ship-batch absent → --batch declines and pushes nothing', () => {
  const fx = fixture({ yml: YML('') });
  for (const b of MEMBERS.slice(0, 2)) member(fx, b);
  const r = batch(fx, MEMBERS.slice(0, 2));
  assert.strictEqual(r.code, 4, r.out + r.err);
  assert.match(r.out, /not enabled in project\.yml \(ship-batch absent\)/);
  assert.match(r.out, /→ SERIAL: colab ship --branch fix\/a-11 · colab ship --branch fix\/b-12/);
  assert.deepStrictEqual(fx.batchRefs(), []);
});

test('#373 oracle 5: no workflow fires on ship-batch/** → an explicit refusal, then serial', () => {
  const fx = fixture({ ci: CI_UNWIRED });
  for (const b of MEMBERS.slice(0, 2)) member(fx, b);
  const r = batch(fx, MEMBERS.slice(0, 2));
  assert.strictEqual(r.code, 4, r.out + r.err);
  assert.match(r.out, /✗ ship-batch: no workflow in \.github\/workflows fires on a push to ship-batch\/\*\*[^\n]*\n→ SERIAL:/);
  assert.deepStrictEqual(fx.batchRefs(), []);
});

test('#373: a member that conflicts with the members already in drops to the next batch', () => {
  const fx = fixture();
  member(fx, 'fix/a-11', { file: 'shared.txt', content: 'a\n' });
  member(fx, 'fix/b-12');
  member(fx, 'fix/c-13', { file: 'shared.txt', content: 'c\n' });
  const r = batch(fx);
  assert.strictEqual(r.code, 3, r.out + r.err);
  assert.match(r.out, /✗ fix\/c-13: conflicts with the members already in \(shared\.txt\)/);
  const T = fx.originSha('main');
  const head = fx.originSha(`ship-batch/${T.slice(0, 7)}`);
  assert.strictEqual(fx.g(fx.origin, 'rev-list', '--count', `${T}..${head}`), '2');
});

test('#373: only one member qualifies → serial, nothing pushed', () => {
  const fx = fixture();
  member(fx, 'fix/a-11');
  member(fx, 'fix/b-12');
  fx.setStatus('fix/b-12', 'in_progress null 1');
  const r = batch(fx, ['fix/a-11', 'fix/b-12']);
  assert.strictEqual(r.code, 4, r.out + r.err);
  assert.match(r.out, /fix\/b-12\s+its own head CI has not finished/);
  assert.match(r.out, /1 member\(s\) can join — a batch needs at least two/);
  assert.deepStrictEqual(fx.batchRefs(), []);
});

test('#373: a red trunk declines the batch — the doors apply per member, never to a batch', () => {
  const fx = fixture();
  for (const b of MEMBERS.slice(0, 2)) member(fx, b);
  fx.setStatus('main', 'completed failure 1');
  const r = batch(fx, MEMBERS.slice(0, 2));
  assert.strictEqual(r.code, 4, r.out + r.err);
  assert.match(r.out, /a batch never passes the cure\/grant doors; each member meets them on its own/);
  assert.deepStrictEqual(fx.batchRefs(), []);
});

test('#373: --dry builds the plan locally and pushes nothing', () => {
  const fx = fixture();
  for (const b of MEMBERS) member(fx, b);
  const r = batch(fx, MEMBERS, ['--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /→ READY: would push ship-batch\/[0-9a-f]{7} = [0-9a-f]{7} \+ 3 squash commit/);
  assert.deepStrictEqual(fx.batchRefs(), []);
});

test('#373: a landed batch head counts as trunk-green while trunk\'s own run is still in flight', () => {
  const fx = fixture();
  for (const b of MEMBERS.slice(0, 2)) member(fx, b);
  const T = fx.originSha('main');
  assert.strictEqual(batch(fx, MEMBERS.slice(0, 2)).code, 3);
  assert.strictEqual(batch(fx, MEMBERS.slice(0, 2)).code, 0);
  member(fx, 'fix/d-14');
  fx.setStatus('main', 'in_progress null 1');
  const r = colab(fx, ['ship', '--dry', '--json', '--branch', 'fix/d-14', '--repo', fx.work]);
  const body = JSON.parse(r.out);
  const ci = body.checks.find((c) => c.name === 'trunk CI green');
  assert.strictEqual(ci.ok, true, JSON.stringify(ci));
  assert.match(ci.detail, new RegExp(`ship-batch/${T.slice(0, 7)}@[0-9a-f]{7}: all success — same workflows as a trunk push`));
});

test('#373: the batch-ref run stands in for trunk only when the same workflows fire on both', () => {
  const fx = fixture({ ci: CI_WIRED });
  // a second workflow that fires on main but NOT on ship-batch/** — the batch never ran it
  fs.writeFileSync(path.join(fx.work, '.github', 'workflows', 'deploy.yml'), CI_UNWIRED);
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'ci: second workflow');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  for (const b of MEMBERS.slice(0, 2)) member(fx, b);
  assert.strictEqual(batch(fx, MEMBERS.slice(0, 2)).code, 3);
  assert.strictEqual(batch(fx, MEMBERS.slice(0, 2)).code, 0);
  member(fx, 'fix/d-14');
  fx.setStatus('main', 'in_progress null 1');
  const body = JSON.parse(colab(fx, ['ship', '--dry', '--json', '--branch', 'fix/d-14', '--repo', fx.work]).out);
  const ci = body.checks.find((c) => c.name === 'trunk CI green');
  assert.strictEqual(ci.ok, false);
  assert.match(ci.detail, /still running/);
});

test('#373: --batch refuses flags that belong to one branch', () => {
  const fx = fixture();
  const r = colab(fx, ['ship', '--batch', 'a,b', '--branch', 'x', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--batch does not combine with --branch/);
});
