'use strict';
/**
 * Tests for #322 — `colab ship`'s "target in sync with origin" precondition
 * (`tools/lib/ship-target-sync.js`) and the B2 push-failure rollback.
 *
 * THE FAILURE BEING PREVENTED. `ship` squash-merges into the target checkout at B1 and pushes it at
 * B2. Nothing in between asked whether the LOCAL target ref agreed with the remote — "trunk
 * checkout ready" asks only whether the checkout is on trunk and clean. So a trunk that was fetched
 * but never fast-forwarded, or one carrying a hand-made commit, sailed through the table, B1
 * completed a merge, and B2's push was rejected. The session was then holding a landed local merge
 * that `colab ship` has no path for (it merges a BRANCH), and the refusal it hit next —
 * `pre-push-guard`'s — named the environment variable that opens the guard. Two independent
 * sessions took that exit on the same day.
 *
 * So there are two halves here, and they are tested as two halves:
 *   (a) the disagreement is caught BEFORE the merge, classified (behind / ahead / diverged), with a
 *       remedy made of git commands and no environment variable anywhere in it;
 *   (b) if the push fails anyway (the remote can always move between the check and B2), the merge is
 *       ROLLED BACK, so the cornered state that produced the bypass does not exist to be cornered in.
 *
 * The classifier is pure and tested as data; the two ship paths are end-to-end, real CLI, real repo,
 * real bare `origin` on disk (no network), `gh` faked generously so every OTHER precondition passes
 * — otherwise a test could pass because CI was red rather than because this row fired. Fixture
 * shape ported from tools/lib/ship-post-ship-hook.test.js, including `core.hooksPath` pointed at a
 * nonexistent dir (#108).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const sync = require('./ship-target-sync');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// --- (a) the classifier, as pure data ----------------------------------------------------------

test('classifier: equal counts are in sync, and that is the only ok verdict', () => {
  const v = sync.classifyTargetSync({ target: 'main', fetched: true, ahead: 0, behind: 0 });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.cls, 'synced');
  assert.deepStrictEqual(v.remedy, []);
});

test('classifier: behind-only is mechanical — the remedy is one fast-forward, and it decides nothing', () => {
  const v = sync.classifyTargetSync({ target: 'main', fetched: true, ahead: 0, behind: 3, repoLabel: '/r' });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.cls, 'behind');
  assert.match(v.detail, /3 commits behind origin\/main/);
  assert.ok(v.remedy.some((l) => l.includes('git -C /r merge --ff-only origin/main')), v.remedy.join('\n'));
});

test('classifier: ahead means unpublished work on a push-guarded branch — the remedy moves it to a branch, never publishes it', () => {
  const v = sync.classifyTargetSync({ target: 'main', fetched: true, ahead: 1, behind: 0, repoLabel: '/r' });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.cls, 'ahead');
  const text = v.remedy.join('\n');
  assert.ok(text.includes('git -C /r branch <type>/<slug>-<issue> main'), text);
  assert.ok(text.includes('git -C /r reset --hard origin/main'), text);
  assert.ok(/push-guarded/.test(text), text);
});

test('classifier: diverged carries BOTH remedies — the stray commits and the fast-forward', () => {
  const v = sync.classifyTargetSync({ target: 'dev', fetched: true, ahead: 2, behind: 5, repoLabel: '/r' });
  assert.strictEqual(v.cls, 'diverged');
  const text = v.remedy.join('\n');
  assert.ok(text.includes('git -C /r branch'), text);
  assert.ok(text.includes('merge --ff-only origin/dev'), text);
});

test('classifier: an unmeasurable comparison is NOT a pass — it refuses and says why', () => {
  const v = sync.classifyTargetSync({ target: 'main', fetched: false, why: 'git fetch origin main failed: boom' });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.cls, 'unknown');
  assert.match(v.detail, /boom/);
});

test('classifier: NO verdict names an environment variable — that is the whole point of #322', () => {
  const cases = [
    { target: 'main', fetched: true, ahead: 0, behind: 0 },
    { target: 'main', fetched: true, ahead: 0, behind: 2 },
    { target: 'main', fetched: true, ahead: 2, behind: 0 },
    { target: 'main', fetched: true, ahead: 2, behind: 2 },
    { target: 'main', fetched: false, why: 'no remote' },
  ];
  for (const c of cases) {
    const v = sync.classifyTargetSync(c);
    const all = [v.detail, ...v.remedy].join('\n');
    assert.ok(!/COLAB_SHIP|COLAB_HUMAN|COLAB_PROMOTE/.test(all),
      `verdict for ${JSON.stringify(c)} names a bypass variable: ${all}`);
  }
});

// --- fixture: a repo a real `colab ship` can complete end to end --------------------------------

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-target-sync-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'target-sync test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    `  SHA=$(cd "${work}" && git rev-parse "refs/heads/$BR" 2>/dev/null)`,
    `  if [ -z "$SHA" ]; then SHA=$(cd "${work}" && git rev-parse HEAD); fi`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\"}]"',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then ' +
      'echo \'{"state":"OPEN","labels":[],"comments":[{"body":"fixture: delivered by hand"}]}\'; exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "comment" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "close" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: 'sess-target-sync-test', COLAB_SESSION_NAME: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/**
 * A ready-to-ship session branch, left unmerged with the checkout back on main — AND claimed.
 * The claim is not decoration: #153 refuses any ship whose branch resolves to zero claimed issues,
 * well before the precondition table this file is about is ever printed.
 */
function sessionBranch(fx, branch) {
  const issue = branch.match(/(\d+)$/)[1];
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'branch work\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: the work this session is shipping');
  fx.g(fx.work, 'checkout', '-q', 'main');
  colab(fx, ['claim', issue, '--branch', branch, '--repo', fx.work]);
}

/** Advance origin/main by one commit that the local main does not have. */
function pushThenRewind(fx) {
  fs.writeFileSync(path.join(fx.work, 'f.txt'), 'moved by somebody else\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: somebody else shipped first');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  fx.g(fx.work, 'reset', '-q', '--hard', 'HEAD~1');   // local main is now 1 behind, and clean
}

/** A hand-made commit sitting on the trunk checkout, never published — the #322 specimen. */
function strayTrunkCommit(fx) {
  fs.writeFileSync(path.join(fx.work, 'docs-note.md'), 'a gotcha distilled straight onto trunk\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'docs: distilled onto the trunk checkout by hand');
}

// --- (b) the precondition, end to end ----------------------------------------------------------

test('ship REFUSES before merging when local trunk is BEHIND origin — and nothing landed', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-10');
  pushThenRewind(fx);
  const mainBefore = fx.g(fx.work, 'rev-parse', 'main').trim();

  const r = colab(fx, ['ship', '--branch', 'feat/work-10', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /✗ +target in sync with origin/);
  assert.match(r.out, /behind origin\/main/);
  assert.match(r.out, /merge --ff-only origin\/main/);
  // The merge must not have happened: this is a PRE-merge refusal, not a cleanup after one.
  assert.strictEqual(fx.g(fx.work, 'rev-parse', 'main').trim(), mainBefore);
  assert.strictEqual(fx.g(fx.work, 'status', '--porcelain').trim(), '');
});

test('ship REFUSES when the trunk checkout carries an unpushed commit, and the remedy moves it to a BRANCH', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-11');
  strayTrunkCommit(fx);
  const mainBefore = fx.g(fx.work, 'rev-parse', 'main').trim();

  const r = colab(fx, ['ship', '--branch', 'feat/work-11', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /✗ +target in sync with origin/);
  assert.match(r.out, /1 unpushed commit origin\/main does not/);
  assert.match(r.out, /branch <type>\/<slug>-<issue> main/);
  assert.match(r.out, /reset --hard origin\/main/);
  assert.strictEqual(fx.g(fx.work, 'rev-parse', 'main').trim(), mainBefore);
});

test('ship REFUSES on a diverged trunk', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-12');
  pushThenRewind(fx);
  strayTrunkCommit(fx);

  const r = colab(fx, ['ship', '--branch', 'feat/work-12', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /✗ +target in sync with origin/);
  assert.match(r.out, /diverged/);
});

test('the refusal NEVER names a bypass variable — an error message is where the last one was learned', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-13');
  strayTrunkCommit(fx);
  const r = colab(fx, ['ship', '--branch', 'feat/work-13', '--repo', fx.work]);
  assert.strictEqual(r.code, 1);
  assert.ok(!/COLAB_SHIP/.test(r.out + r.err), 'ship\'s own refusal named COLAB_SHIP');
});

test('an in-sync trunk passes the row, and the ship completes as before', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-14');
  const r = colab(fx, ['ship', '--branch', 'feat/work-14', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /✓ +target in sync with origin/);
  // origin actually moved — the whole point of not having refused.
  assert.strictEqual(
    fx.g(fx.work, 'rev-parse', 'main').trim(),
    fx.g(fx.work, 'rev-parse', 'origin/main').trim());
});

test('--dry --json carries the row, its class, and a machine-readable remedy', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-15');
  pushThenRewind(fx);
  const r = colab(fx, ['ship', '--branch', 'feat/work-15', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const row = body.checks.find((c) => c.name === 'target in sync with origin');
  assert.ok(row, JSON.stringify(body.checks.map((c) => c.name)));
  assert.strictEqual(row.ok, false);
  // A fast-forward decides nothing, so this one is self-clearing — not a human gate.
  assert.strictEqual(row.class, 'self-clearing');
  assert.ok(Array.isArray(row.remedy) && row.remedy.length > 0, JSON.stringify(row));
  assert.strictEqual(body.ok, false);
});

test('--dry --json: an unpushed trunk commit is HUMAN-gated, not self-clearing — somebody must decide what that commit is', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-16');
  strayTrunkCommit(fx);
  const r = colab(fx, ['ship', '--branch', 'feat/work-16', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const row = body.checks.find((c) => c.name === 'target in sync with origin');
  assert.strictEqual(row.ok, false);
  assert.strictEqual(row.class, 'human-gated');
});

// --- (c) B2's rollback: the corner itself ------------------------------------------------------

/** Make `origin` reject every push, deterministically, without touching the network. */
function makeOriginRejectPushes(fx) {
  const hooks = path.join(fx.origin, 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  const p = path.join(hooks, 'pre-receive');
  fs.writeFileSync(p, '#!/bin/sh\necho "fixture origin: push refused" >&2\nexit 1\n', { mode: 0o755 });
  fs.chmodSync(p, 0o755);
}

test('B2 push failure ROLLS THE MERGE BACK — the trunk checkout is returned to where it started', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-20');
  const mainBefore = fx.g(fx.work, 'rev-parse', 'main').trim();
  makeOriginRejectPushes(fx);

  const r = colab(fx, ['ship', '--branch', 'feat/work-20', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /B2: push failed/);
  assert.match(r.err, /rolled back/);
  // The state that cornered two sessions in #322 — a landed local merge nothing can publish — is
  // exactly what must NOT be left behind.
  assert.strictEqual(fx.g(fx.work, 'rev-parse', 'main').trim(), mainBefore,
    'the squash was left sitting on the trunk checkout after a failed push');
  assert.strictEqual(fx.g(fx.work, 'status', '--porcelain').trim(), '');
});

test('B2 push failure does NOT hand back an environment variable as the way forward', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-21');
  makeOriginRejectPushes(fx);
  const r = colab(fx, ['ship', '--branch', 'feat/work-21', '--repo', fx.work]);
  assert.strictEqual(r.code, 1);
  assert.ok(!/COLAB_HUMAN|COLAB_SHIP/.test(r.err),
    `B2's failure message named a bypass variable:\n${r.err}`);
  assert.match(r.err, /colab ship/);   // it names the remedy instead
});

test('after a rolled-back B2 the branch still carries the work, so a re-run is a real option', () => {
  const fx = fixture();
  sessionBranch(fx, 'feat/work-22');
  makeOriginRejectPushes(fx);
  colab(fx, ['ship', '--branch', 'feat/work-22', '--repo', fx.work]);
  assert.ok(fx.g(fx.work, 'branch', '--list', 'feat/work-22').trim(), 'the session branch was destroyed');
  const files = fx.g(fx.work, 'ls-tree', '--name-only', 'feat/work-22').split('\n');
  assert.ok(files.includes('g.txt'), files.join(','));
});
