'use strict';
/**
 * Tests for #304 — `colab ship` step (e2): the `.colab/hooks/post-ship` hook, and the
 * lockfile-drift warning that stands in for it when a repo has none.
 *
 * The failure being prevented: `colab ship` commits the squash IN THE SHARED TRUNK CHECKOUT when
 * the target is trunk, and merging a branch installs nothing — so a merge that adds a Composer/npm
 * package leaves a trunk whose `vendor/`/`node_modules/` disagrees with its lockfile. Anything
 * regenerating committed output from that tree then DELETES those files, and the resulting dirty
 * trunk blocks every other session's ship. See docs/gotchas.d/304-*.md.
 *
 * These are end-to-end on purpose. `tools/lib/lockfile-drift.test.js` covers the detector as pure
 * data; what cannot be proved there is the part that actually bites — that the hook runs against
 * the TRUNK checkout with the right env, and above all that NOTHING here can fail a ship whose
 * merge is already pushed. Real CLI, real repo, real bare `origin`, `gh` faked generously (same
 * shape as ship-plan-journal.test.js) because every precondition has to pass before e2 is reached.
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

const PROJECT_YML_AUTO_TRUNK = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

/**
 * A clone with a real bare `origin`, a `main` trunk, private COLAB_HOME, and a `gh` stub generous
 * enough to let a REAL `colab ship` complete end to end. Ported from ship-plan-journal.test.js —
 * including `core.hooksPath` pointed at a nonexistent dir (#108: a fixture that inherits the
 * machine's global hooks is the exact copy-paste gap fixture-hooks-lint.test.js exists to catch).
 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-post-ship-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'post-ship test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML_AUTO_TRUNK);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  fs.writeFileSync(path.join(work, 'composer.lock'), '{"packages":[]}\n');
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
    // HOME override: the plan-journal step writes to `~/.colab/` off os.homedir(), not COLAB_HOME.
    // A stable non-blank COLAB_SESSION (#237): claim and ship run against the same trunk checkout,
    // and two blank sessions do not count as the same place-claim holder.
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: 'sess-post-ship-test', COLAB_SESSION_NAME: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** Put a hook on disk. `body` is shell; `mode` lets a test make it non-executable on purpose. */
function writeHook(fx, name, body, mode = 0o755) {
  const dir = path.join(fx.work, '.colab', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, body, { mode });
  fs.chmodSync(p, mode);
  return p;
}

/**
 * A branch that changes `composer.lock` — the measured shape. Committed on a side branch and left
 * unmerged, exactly as a session's worktree branch would be when ship is invoked.
 */
function branchTouchingLockfile(fx, branch, { lockfile = 'composer.lock' } = {}) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  const p = path.join(fx.work, lockfile);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '{"packages":[{"name":"acme/routes-provider"}]}\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: add a package whose provider registers routes');
  fx.g(fx.work, 'checkout', '-q', 'main');
}

/** A branch that changes nothing dependency-related. */
function branchTouchingNothingRelated(fx, branch) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, 'f.txt'), 'changed\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'docs: unrelated');
  fx.g(fx.work, 'checkout', '-q', 'main');
}

// --- (a) the hook runs, against the TRUNK checkout, with the drift in its env -------------------

test('#304 (a): a lockfile-changing merge runs .colab/hooks/post-ship with COLAB_LOCKFILES set', () => {
  const fx = fixture();
  const receipt = path.join(fx.root, 'receipt.txt');
  writeHook(fx, 'post-ship',
    '#!/bin/sh\n' +
    `{ echo "cwd=$PWD"; echo "wt=$COLAB_WORKTREE_PATH"; echo "locks=$COLAB_LOCKFILES"; ` +
    `echo "target=$COLAB_TARGET"; echo "sha=$COLAB_SHA"; echo "repo=$COLAB_REPO"; } > "${receipt}"\n` +
    'exit 0\n');
  branchTouchingLockfile(fx, 'feat/add-package-60');
  colab(fx, ['claim', '60', '--branch', 'feat/add-package-60', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'feat/add-package-60', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);

  assert.ok(fs.existsSync(receipt), 'post-ship hook did not run:\n' + r.out + r.err);
  const got = fs.readFileSync(receipt, 'utf8');
  assert.match(got, /locks=composer\.lock/, 'COLAB_LOCKFILES must name what changed:\n' + got);
  assert.match(got, /target=main/);
  assert.match(got, /sha=[0-9a-f]{4,}/);
  // The hook's working path is the TRUNK CHECKOUT, not a worktree — this is the whole distinction
  // from pre-ship, and a hook that ran anywhere else would install into the wrong tree. realpath
  // on both sides: macOS resolves /var/folders/... to /private/var/folders/..., so comparing the
  // raw mkdtemp path against what the subprocess reports is a false failure, not a real one.
  const real = (q) => fs.realpathSync(q);
  assert.strictEqual(real(got.match(/^wt=(.*)$/m)[1]), real(fx.work),
    'COLAB_WORKTREE_PATH must be the trunk checkout:\n' + got);
  // …and the hook RUNS there too. A hook doing a bare `composer install` with no `cd` would
  // otherwise install into whatever directory the operator invoked `colab ship` from.
  assert.strictEqual(real(got.match(/^cwd=(.*)$/m)[1]), real(fx.work),
    'the hook must run WITH the trunk checkout as its cwd:\n' + got);
  // A repo that handled its own drift is not also lectured about it.
  assert.doesNotMatch(r.out + r.err, /was NOT re-installed/);
});

test('#304 (a2): the hook runs even when NO lockfile changed — it is the trunk-side automation point', () => {
  const fx = fixture();
  const receipt = path.join(fx.root, 'receipt.txt');
  writeHook(fx, 'post-ship', `#!/bin/sh\necho "locks=[$COLAB_LOCKFILES]" > "${receipt}"\nexit 0\n`);
  branchTouchingNothingRelated(fx, 'docs/unrelated-61');
  colab(fx, ['claim', '61', '--branch', 'docs/unrelated-61', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'docs/unrelated-61', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.ok(fs.existsSync(receipt), 'post-ship must fire on every successful trunk ship');
  assert.match(fs.readFileSync(receipt, 'utf8'), /locks=\[\]/, 'no drift → an empty COLAB_LOCKFILES, not a missing run');
});

// --- (b) no hook + drift → the warning, and still exit 0 ---------------------------------------

test('#304 (b): with NO hook, a lockfile-changing merge warns naming the file and the install command — and still exits 0', () => {
  const fx = fixture();
  branchTouchingLockfile(fx, 'feat/add-package-62');
  colab(fx, ['claim', '62', '--branch', 'feat/add-package-62', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'feat/add-package-62', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const all = r.out + r.err;
  assert.match(all, /composer\.lock/);
  assert.match(all, /composer install/);
  assert.match(all, /#304/);
  // #114: it lands in the deferred block, AFTER the success line — the failure this warning exists
  // to prevent was itself missed by scrolling past.
  const shipped = all.indexOf('✓ Shipped');
  const warned = all.indexOf('composer install');
  assert.ok(shipped !== -1 && warned > shipped,
    'the drift warning must print after the ✓ Shipped line, not scroll off above it');
  // And the merge really landed — a warning is not a refusal.
  const trunkHead = fx.g(fx.work, 'log', '-1', '--format=%s', 'main').trim();
  assert.match(trunkHead, /add a package whose provider registers routes/);
});

test('#304 (b2): a nested (monorepo) lockfile is reported too — the skew is per installed tree', () => {
  const fx = fixture();
  branchTouchingLockfile(fx, 'feat/nested-63', { lockfile: 'packages/api/composer.lock' });
  colab(fx, ['claim', '63', '--branch', 'feat/nested-63', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'feat/nested-63', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out + r.err, /packages\/api\/composer\.lock/);
});

// --- (c) a FAILING hook must not fail the ship -------------------------------------------------

test('#304 (c): a post-ship hook exiting non-zero warns but the ship still exits 0 with the merge pushed', () => {
  const fx = fixture();
  writeHook(fx, 'post-ship', '#!/bin/sh\necho "hook: composer install blew up" >&2\nexit 3\n');
  branchTouchingLockfile(fx, 'feat/add-package-64');
  colab(fx, ['claim', '64', '--branch', 'feat/add-package-64', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'feat/add-package-64', '--repo', fx.work]);
  // THE invariant of this whole feature: the push already landed, so a non-zero exit here would
  // read as "ship failed" and invite a re-merge of work that is already on trunk.
  assert.strictEqual(r.code, 0, 'a failing post-ship hook must NEVER fail the ship:\n' + r.out + r.err);
  const all = r.out + r.err;
  assert.match(all, /post-ship hook failed \(exit 3\)/);
  assert.match(all, /do NOT re-run ship/i);

  // The merge is genuinely on the local trunk AND pushed to origin.
  const localHead = fx.g(fx.work, 'rev-parse', 'main').trim();
  const originHead = execFileSync('git', ['rev-parse', 'main'], { cwd: fx.origin, encoding: 'utf8' }).trim();
  assert.strictEqual(localHead, originHead, 'the push must have landed despite the hook failure');
});

// --- (d) silence when there is nothing to say --------------------------------------------------

test('#304 (d): a merge touching no lockfile, with no hook, prints no drift warning at all', () => {
  const fx = fixture();
  branchTouchingNothingRelated(fx, 'docs/unrelated-65');
  colab(fx, ['claim', '65', '--branch', 'docs/unrelated-65', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'docs/unrelated-65', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const all = r.out + r.err;
  assert.doesNotMatch(all, /dependency lockfile/);
  assert.doesNotMatch(all, /composer install/);
  assert.doesNotMatch(all, /post-ship hook failed/);
});

test('#304 (d2): a non-executable post-ship hook is skipped, and the drift warning still fires', () => {
  const fx = fixture();
  const receipt = path.join(fx.root, 'receipt.txt');
  writeHook(fx, 'post-ship', `#!/bin/sh\ntouch "${receipt}"\n`, 0o644);
  branchTouchingLockfile(fx, 'feat/add-package-66');
  colab(fx, ['claim', '66', '--branch', 'feat/add-package-66', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'feat/add-package-66', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(fs.existsSync(receipt), false, 'a non-executable hook must not run');
  // It did not run, so the drift is still unhandled and the human still needs telling.
  assert.match(r.out + r.err, /composer install/);
});
