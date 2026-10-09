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
  // … and the survivor still goes through the batch path, as a batch of one (#562)
  const r4 = batch(fx, ['fix/b-12', 'fix/c-13']);
  assert.strictEqual(r4.code, 3, r4.out + r4.err);
  assert.match(r4.out, /fix\/b-12\s+red at its own head/);
  assert.match(r4.out, /BATCH-PENDING ship-batch\/[0-9a-f]{7}@[0-9a-f]{7} — .*\(fix\/c-13\)|pushed ship-batch\/[0-9a-f]{7} = [0-9a-f]{7} \+ 1 commit\(s\) @ [0-9a-f]{7} \(fix\/c-13\)/);
});

test('#391: a declined batch at the base does not block a --batch of the survivors', () => {
  const fx = fixture();
  for (const b of MEMBERS) member(fx, b);
  const T = fx.originSha('main');
  const ref = `ship-batch/${T.slice(0, 7)}`;
  assert.strictEqual(batch(fx).code, 3);
  const declinedSha = fx.originSha(ref);

  fx.setStatus(ref, 'completed failure 1');
  const r2 = batch(fx);
  assert.strictEqual(r2.code, 4, r2.out + r2.err);
  assert.deepStrictEqual(fx.batchRefs(), [ref], 'declined on its first attempt — the ref is kept for the one re-run');

  // the two clean members, as a new batch at the SAME base: not "in flight", a fresh build
  const r3 = batch(fx, ['fix/b-12', 'fix/c-13']);
  assert.strictEqual(r3.code, 3, r3.out + r3.err);
  assert.doesNotMatch(r3.out, /in flight/);
  assert.match(r3.out, /was declined/);
  assert.match(r3.out, /BATCH-PENDING/);
  assert.deepStrictEqual(fx.batchRefs(), [ref]);
  assert.notStrictEqual(fx.originSha(ref), declinedSha, 'the ref now holds the rebuilt batch');
  const carried = fx.g(fx.origin, 'log', '--format=%s', `${T}..${ref}`);
  assert.match(carried, /b-12/);
  assert.match(carried, /c-13/);
  assert.doesNotMatch(carried, /a-11/);
  assert.strictEqual(fx.originSha('main'), T, 'nothing landed');
});

test('#391: a pending or green batch with other members still refuses as in flight', () => {
  for (const status of ['in_progress none 1', 'completed success 1']) {
    const fx = fixture();
    for (const b of MEMBERS) member(fx, b);
    const T = fx.originSha('main');
    const ref = `ship-batch/${T.slice(0, 7)}`;
    assert.strictEqual(batch(fx).code, 3);
    const sha = fx.originSha(ref);
    fx.setStatus(ref, status);
    const r = batch(fx, ['fix/b-12', 'fix/c-13']);
    assert.strictEqual(r.code, 3, r.out + r.err);
    assert.match(r.out, /another batch is in flight at this base/);
    assert.strictEqual(fx.originSha(ref), sha, `${status}: the in-flight batch is left alone`);
  }
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
  // #554: the drop is recorded on the batch head — once, on the head only, with its class
  const headMsg = fx.g(fx.origin, 'log', '-1', '--format=%B', head);
  const sha = fx.originSha('fix/c-13');
  assert.match(headMsg, new RegExp(`^Ship-Batch-Dropped: ship-batch/${T.slice(0, 7)} fix/c-13@${sha.slice(0, 12)} conflict$`, 'm'));
  assert.match(headMsg, /^Ship-Batch: ship-batch\/\w+ fix\/b-12@/m, 'the member trailer is kept, in the same block');
  assert.doesNotMatch(fx.g(fx.origin, 'log', '-1', '--format=%B', `${head}~1`), /Ship-Batch-Dropped/);
});

/** #387: a pre-ship hook that regenerates `allow.txt` on whatever head it is handed, and stages it. */
function preShipHook(fx) {
  const dir = path.join(fx.work, '.colab', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pre-ship'), '#!/bin/sh\nset -e\ncd "$1"\nls fix_*.txt 2>/dev/null | sort > allow.txt || true\necho regenerated >> allow.txt\ngit add allow.txt\n', { mode: 0o755 });
  // committed on trunk, as a repo carries it — `member()` stages everything, so an untracked hook
  // would ride away on the first member's branch
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: pre-ship hook');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
}

test('#387: an overlap confined to a declared generated: file is regenerated, not a reason to drop', () => {
  const fx = fixture({ yml: YML('ship-batch: 3\ngenerated: [allow.txt]\n') });
  preShipHook(fx);
  member(fx, 'fix/a-11', { file: 'allow.txt', content: 'a\n' });
  member(fx, 'fix/b-12');
  member(fx, 'fix/c-13', { file: 'allow.txt', content: 'c\n' });
  const r = batch(fx);
  assert.strictEqual(r.code, 3, r.out + r.err);
  assert.doesNotMatch(r.out, /✗ fix\/c-13/);
  assert.match(r.out, /↻ fix\/c-13: combined despite a generated-file overlap — allow\.txt regenerated by \.colab\/hooks\/pre-ship/);
  const T = fx.originSha('main');
  const head = fx.originSha(`ship-batch/${T.slice(0, 7)}`);
  assert.strictEqual(fx.g(fx.origin, 'rev-list', '--count', `${T}..${head}`), '3', 'all three members are in the batch');
  const allow = fx.g(fx.origin, 'show', `${head}:allow.txt`);
  assert.doesNotMatch(allow, /[<>=]{7}/, 'no conflict markers reach the combined head');
  assert.match(allow, /regenerated/);
});

test('#387: a generated-only overlap with no pre-ship hook still drops — nothing can regenerate it', () => {
  const fx = fixture({ yml: YML('ship-batch: 3\ngenerated: [allow.txt]\n') });
  member(fx, 'fix/a-11', { file: 'allow.txt', content: 'a\n' });
  member(fx, 'fix/b-12');
  member(fx, 'fix/c-13', { file: 'allow.txt', content: 'c\n' });
  const r = batch(fx, MEMBERS, ['--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /✗ fix\/c-13: conflicts with the members already in only in generated file\(s\) \(allow\.txt\), but there is no \.colab\/hooks\/pre-ship/);
  assert.match(r.out, /READY: would push .* 2 squash commit\(s\): fix\/a-11, fix\/b-12/);
});

test('#387: a hook present does not rescue an overlap outside generated:', () => {
  const fx = fixture({ yml: YML('ship-batch: 3\ngenerated: [allow.txt]\n') });
  preShipHook(fx);
  member(fx, 'fix/a-11', { file: 'shared.txt', content: 'a\n' });
  member(fx, 'fix/b-12');
  member(fx, 'fix/c-13', { file: 'shared.txt', content: 'c\n' });
  const r = batch(fx, MEMBERS, ['--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /✗ fix\/c-13: conflicts with the members already in \(shared\.txt\) — next batch/);
  assert.doesNotMatch(r.out, /running hook pre-ship/);
});

test('#562 oracle: a lone ready member lands through a ship-batch run — one member, a green combined run, trunk fast-forwards', () => {
  const fx = fixture();
  member(fx, 'fix/a-11');
  const T = fx.originSha('main');
  const ref = `ship-batch/${T.slice(0, 7)}`;
  fx.setStatus(ref, 'in_progress null 1');

  const r1 = batch(fx, ['fix/a-11']);
  assert.strictEqual(r1.code, 3, r1.out + r1.err);
  assert.doesNotMatch(r1.out, /SERIAL/, 'one member is a batch, never a decline');
  assert.match(r1.out, /pushed ship-batch\/[0-9a-f]{7} = [0-9a-f]{7} \+ 1 commit\(s\)/);
  assert.deepStrictEqual(fx.batchRefs(), [ref]);
  assert.strictEqual(fx.originSha('main'), T, 'nothing lands before the combined run is green');
  const head = fx.originSha(ref);
  assert.strictEqual(fx.g(fx.origin, 'rev-list', '--count', `${T}..${head}`), '1');

  fx.setStatus(ref, 'completed success 1');
  const r2 = batch(fx, ['fix/a-11']);
  assert.strictEqual(r2.code, 0, r2.out + r2.err);
  assert.strictEqual(fx.originSha('main'), head, 'trunk fast-forwards to the tested batch head');
  assert.deepStrictEqual(fx.batchRefs(), []);
  const body = fx.g(fx.origin, 'log', '-1', '--format=%B', head);
  assert.deepStrictEqual(body.match(/Closes #\d+/g), ['Closes #11'], body);
  assert.match(body, new RegExp(`^Ship-Batch: ${ref} fix/a-11@`, 'm'));
  assert.match(ghLog(fx), new RegExp(`issue comment 11 --body 🚢 Shipped to main by colab ship — [0-9a-f]{7} · landed in a batch of 1 — combined run 9001 at ${ref}`));
});

test('#562: of two named, only one qualifies → it lands alone through the batch path; the other is named', () => {
  const fx = fixture();
  member(fx, 'fix/a-11');
  member(fx, 'fix/b-12');
  fx.setStatus('fix/b-12', 'in_progress null 1');
  const r = batch(fx, ['fix/a-11', 'fix/b-12']);
  assert.strictEqual(r.code, 3, r.out + r.err);
  assert.match(r.out, /fix\/b-12\s+its own head CI has not finished/);
  assert.match(r.out, /\+ 1 commit\(s\) @ [0-9a-f]{7} \(fix\/a-11\)/);
  assert.strictEqual(fx.batchRefs().length, 1);
});

test('#562: no member qualifies → still declined to serial, nothing pushed', () => {
  const fx = fixture();
  member(fx, 'fix/a-11');
  fx.setStatus('fix/a-11', 'in_progress null 1');
  const r = batch(fx, ['fix/a-11']);
  assert.strictEqual(r.code, 4, r.out + r.err);
  assert.match(r.out, /no member can join/);
  assert.deepStrictEqual(fx.batchRefs(), []);
});

test('#562: past its ship-batch-wait window a lone member builds as a batch of one, not serial', () => {
  const fx = fixture({ yml: YML('ship-batch: 3\nship-batch-wait: 1m\n') });
  // ready an hour ago: no run row carries updatedAt here, so readiness reads the head commit's date
  process.env.GIT_COMMITTER_DATE = new Date(Date.now() - 3600_000).toISOString();
  try { member(fx, 'fix/a-11'); } finally { delete process.env.GIT_COMMITTER_DATE; }
  const r = batch(fx, ['fix/a-11']);
  assert.strictEqual(r.code, 3, r.out + r.err);
  assert.doesNotMatch(r.out, /PARTNER-WAIT|SERIAL/, r.out);
  assert.match(r.out, /building a batch of one/);
  assert.strictEqual(fx.batchRefs().length, 1);
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

/** Everything a land would touch, read off disk: trunk on origin + in the checkout, batch refs, colab state. */
function snapshot(fx) {
  const st = path.join(fx.home, 'state.json');
  return {
    originMain: fx.originSha('main'), workMain: fx.g(fx.work, 'rev-parse', 'main'), refs: fx.batchRefs(),
    state: fs.existsSync(st) ? fs.readFileSync(st, 'utf8') : '',
    worktrees: fx.g(fx.work, 'worktree', 'list', '--porcelain'),
  };
}
const writesIn = (log) => log.split('\n').filter((l) => /^issue (comment|edit|close)|^label /.test(l));

test('#415: --dry on a staged batch whose combined run is green lands nothing and writes nothing', () => {
  const fx = fixture();
  for (const b of MEMBERS) member(fx, b);
  const T = fx.originSha('main');
  const ref = `ship-batch/${T.slice(0, 7)}`;
  assert.strictEqual(batch(fx).code, 3);
  fx.setStatus(ref, 'completed success 1');
  const before = snapshot(fx);
  const logBefore = writesIn(ghLog(fx)).length;

  const r = batch(fx, MEMBERS, ['--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /\[DRY RUN\]/);
  assert.match(r.out, new RegExp(`→ READY: would fast-forward main ${T.slice(0, 7)} → ${fx.originSha(ref).slice(0, 7)} — ${ref.replace('/', '\\/')}, combined run 9001`));
  assert.match(r.out, /would land 3 member\(s\), one squash each: fix\/a-11, fix\/b-12, fix\/c-13/);
  assert.doesNotMatch(r.out, /Shipped batch|pushed\./);
  assert.deepStrictEqual(snapshot(fx), before, 'trunk, batch ref, claims and worktrees are untouched');
  assert.strictEqual(writesIn(ghLog(fx)).length, logBefore, 'no issue comment, edit or label write');

  // the same command without --dry still lands it — the dry run changed nothing it depends on
  const staged = fx.originSha(ref);
  const real = batch(fx);
  assert.strictEqual(real.code, 0, real.out + real.err);
  assert.strictEqual(fx.originSha('main'), staged, 'trunk is the staged batch head');
});

test('#415: --dry never deletes a batch ref — trunk-moved and red-after-rerun paths only say they would', () => {
  const fx = fixture();
  for (const b of MEMBERS) member(fx, b);
  const T = fx.originSha('main');
  const ref = `ship-batch/${T.slice(0, 7)}`;
  assert.strictEqual(batch(fx).code, 3);

  fx.setStatus(ref, 'completed failure 2');
  const red = batch(fx, MEMBERS, ['--dry']);
  assert.strictEqual(red.code, 4, red.out + red.err);
  assert.match(red.out, /\[dry\] would delete origin\/ship-batch\//);
  assert.match(red.out, /would be deleted \[DRY RUN\]/);
  assert.deepStrictEqual(fx.batchRefs(), [ref]);

  fs.writeFileSync(path.join(fx.work, 'moved.txt'), 'M\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: trunk moved');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  const moved = batch(fx, MEMBERS, ['--dry']);
  assert.strictEqual(moved.code, 0, moved.out + moved.err);
  assert.match(moved.out, /trunk moved since/);
  assert.match(moved.out, /\[dry\] would delete origin\/ship-batch\//);
  assert.match(moved.out, /→ READY: would push/);
  assert.deepStrictEqual(fx.batchRefs(), [ref], 'the stale ref is still there — dry deleted nothing');
});

test('#415: a member list that differs from the staged batch is named, never silently replaced', () => {
  const fx = fixture();
  for (const b of MEMBERS.slice(0, 2)) member(fx, b);
  const T = fx.originSha('main');
  const ref = `ship-batch/${T.slice(0, 7)}`;
  assert.strictEqual(batch(fx, MEMBERS.slice(0, 2)).code, 3);
  fx.setStatus(ref, 'completed success 1');
  member(fx, 'fix/c-13');

  const dry = batch(fx, MEMBERS, ['--dry']);
  assert.strictEqual(dry.code, 0, dry.out + dry.err);
  assert.match(dry.out, new RegExp(`${ref.replace('/', '\\/')} was staged with fix\\/a-11, fix\\/b-12; this command named fix\\/a-11, fix\\/b-12, fix\\/c-13`));
  assert.match(dry.out, /NOT in the staged batch, so it does not land with it: fix\/c-13/);
  assert.strictEqual(fx.originSha('main'), T);

  const r = batch(fx, MEMBERS);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /NOT in the staged batch, so it does not land with it: fix\/c-13/);
  assert.match(r.out, /✓ Shipped batch → main .*: fix\/a-11, fix\/b-12$/m);
  assert.doesNotMatch(fx.g(fx.origin, 'log', '--format=%B', `${T}..main`), /c-13/, 'the unstaged member did not land');
});

/** #436: a pre-ship hook that exits 0 after `git add`ing allow.txt WITHOUT resolving it. */
function lyingPreShipHook(fx) {
  const dir = path.join(fx.work, '.colab', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pre-ship'), '#!/bin/sh\nset -e\ncd "$1"\ngit add allow.txt\n', { mode: 0o755 });
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: pre-ship hook');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
}

test('#436: batch — a pre-ship hook that exits 0 but leaves conflict markers staged drops the member', () => {
  const fx = fixture({ yml: YML('ship-batch: 3\ngenerated: [allow.txt]\n') });
  lyingPreShipHook(fx);
  member(fx, 'fix/a-11', { file: 'allow.txt', content: 'a\n' });
  member(fx, 'fix/b-12');
  member(fx, 'fix/c-13', { file: 'allow.txt', content: 'c\n' });
  const r = batch(fx, MEMBERS, ['--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /✗ fix\/c-13: \.colab\/hooks\/pre-ship exited 0 but left conflict markers staged in allow\.txt:1,\d+ on the combined head — treated as a failing hook, next batch/);
  assert.doesNotMatch(r.out, /↻ fix\/c-13/);
  assert.match(r.out, /READY: would push .* 2 squash commit\(s\): fix\/a-11, fix\/b-12/);
});

test('#436: serial B0 — a pre-ship hook that exits 0 but leaves conflict markers is a failing hook; nothing pushed', () => {
  const fx = fixture({ yml: YML('generated: [allow.txt]\n') });
  lyingPreShipHook(fx);
  member(fx, 'fix/a-11', { file: 'allow.txt', content: 'a\n' });
  fs.writeFileSync(path.join(fx.work, 'allow.txt'), 'trunk\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: trunk regenerates allow.txt');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  const T = fx.originSha('main');
  const B = fx.originSha('fix/a-11');
  // no branch run → #395's stale-base row passes (Branch CI `none`), the only way B0 meets a conflict
  fx.setStatus('fix/a-11', 'none');

  const r = colab(fx, ['ship', '--branch', 'fix/a-11', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out + r.err, /✗ B0: pre-ship hook exited 0 but left conflict markers staged in allow\.txt:1,\d+ — treated as a failing hook\. Nothing pushed\./);
  assert.strictEqual(fx.originSha('main'), T, 'trunk untouched');
  assert.strictEqual(fx.originSha('fix/a-11'), B, 'the branch was not pushed with the markers');
});

// ---- #509: a failed land push is classified before it is reported --------------------------------

/** Stage a green batch at trunk T; returns { T, ref, head }. */
function stagedGreen(fx) {
  for (const b of MEMBERS) member(fx, b);
  const T = fx.originSha('main');
  const ref = `ship-batch/${T.slice(0, 7)}`;
  assert.strictEqual(batch(fx).code, 3);
  fx.setStatus(ref, 'completed success 1');
  return { T, ref, head: fx.originSha(ref) };
}
/** A pre-push hook in the fixture's hooksPath (installed AFTER staging, so only the land push sees it). */
function prePush(fx, body) {
  const dir = path.join(fx.root, '.nohooks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pre-push'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

test('#509: a pre-push hook refusal with an unchanged remote is reported as a refusal, with the hook output — not "trunk moved"', () => {
  const fx = fixture();
  const { T, ref } = stagedGreen(fx);
  prePush(fx, 'echo "ERR_MODULE_NOT_FOUND: cannot find package left-pad" >&2\necho "boot check: run the installer first" >&2\nexit 1');

  const r = batch(fx);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.doesNotMatch(r.out + r.err, /trunk moved/);
  assert.doesNotMatch(r.out, /Run this command again: it sees the moved trunk/);
  assert.match(r.out, /refused before it reached the remote \(a local pre-push hook\?\) — origin\/main did NOT move/);
  assert.match(r.out, /│ ERR_MODULE_NOT_FOUND: cannot find package left-pad/);
  assert.match(r.out, /│ boot check: run the installer first/);
  assert.strictEqual(fx.originSha('main'), T, 'nothing landed');
  assert.strictEqual(fx.g(fx.work, 'rev-parse', 'main'), T, 'the trunk checkout is rolled back');
  assert.deepStrictEqual(fx.batchRefs(), [ref], 'the staged batch is kept for the retry after the fix');
});

test('#509: the remote trunk really advanced during the land push → the "trunk moved, rebuild" path, unchanged', () => {
  const fx = fixture();
  const { T } = stagedGreen(fx);
  // a racer commit on top of T, parked on origin under another name; the hook moves origin/main to it
  fx.g(fx.work, 'checkout', '-q', '-b', 'racer', T);
  fs.writeFileSync(path.join(fx.work, 'racer.txt'), 'R\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: racer');
  fx.g(fx.work, 'checkout', '-q', 'main');
  fx.g(fx.work, 'push', '-q', 'origin', 'racer');
  const R = fx.originSha('racer');
  prePush(fx, `git --git-dir="${fx.origin}" update-ref refs/heads/main ${R}\nexit 0`);

  const r = batch(fx);
  assert.strictEqual(r.code, 3, r.out + r.err);
  assert.match(r.out, /⏸ ship-batch: trunk moved during land \(origin\/main [0-9a-f]{7} → [0-9a-f]{7}\)/);
  assert.match(r.out, /Run this command again: it sees the moved trunk and rebuilds the batch on it/);
  assert.strictEqual(fx.originSha('main'), R, 'the racer, not the batch');
  assert.notStrictEqual(R, T);
});
