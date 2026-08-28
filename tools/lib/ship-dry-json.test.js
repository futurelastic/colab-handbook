'use strict';
/**
 * Tests for `colab ship --dry --json` (#77) — the machine-readable precondition read a scheduled
 * driver needs to tell a self-clearing blocker (retry later, unattended) apart from a human-gated
 * one (park it, a person must act).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same posture as
 * colab-base.test.js, because the property under test is WIRING: the plain `--dry` prose path
 * must stay byte-identical, and `--dry --json` must report the WHOLE table even when one
 * precondition (autonomy) already fails, rather than stopping at the first refusal.
 *
 * `COLAB_HOME` is redirected per test, so the developer's real state.json is never read or written.
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

/** A clone with a real bare `origin` and a `main` trunk, private COLAB_HOME. */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ship-json-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab ship-json test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  return { root, origin, work, home, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    // #242: a non-blank, fixed COLAB_SESSION — fixtures here `claim` with no `--worktree`, which
    // mints the trunk-checkout place-claim and now REQUIRES a session id up front (blank never
    // counts as "the same holder" on a later re-acquire). Same fix as ship-plan-journal.test.js's
    // precedent comment for the identical #237 root cause.
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-dry-json-test', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const PROJECT_YML_NO_AUTONOMY = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const PROJECT_YML_AUTO_TRUNK = `${PROJECT_YML_NO_AUTONOMY}autonomy: auto-trunk\n`;

// --- usage guard ------------------------------------------------------------

test('--json without --dry is refused, not silently ignored', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/x-1');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/x-1', '--repo', fx.work, '--json']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--json currently only applies together with --dry/);
});

// --- the plain --dry prose path is untouched --------------------------------

test('plain --dry (no --json) keeps the ORIGINAL hard-refusal prose on a missing autonomy grant', () => {
  const fx = fixture(PROJECT_YML_NO_AUTONOMY); // no autonomy: auto-trunk
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/x-2');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/x-2', '--repo', fx.work, '--dry']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /does not grant auto-trunk/);
  assert.doesNotMatch(r.out, /^\{/); // never JSON on the plain path
});

// --- --dry --json: the whole table, not just the first refusal -------------

test('--dry --json reports EVERY precondition even when autonomy already fails (no short-circuit)', () => {
  const fx = fixture(PROJECT_YML_NO_AUTONOMY);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/x-3');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: x');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/x-3', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.ok, false);
  const names = body.checks.map((c) => c.name);
  // Every documented precondition is present, not just the one that failed first.
  for (const n of ['branch resolves', 'not an integration line', 'declared base', 'autonomy granted',
    'no new migrations', 'trunk checkout ready', 'no hand-merge conflict']) {
    assert.ok(names.includes(n), `missing check "${n}" in ${JSON.stringify(names)}`);
  }
  const autonomy = body.checks.find((c) => c.name === 'autonomy granted');
  assert.strictEqual(autonomy.ok, false);
  assert.strictEqual(autonomy.class, 'human-gated');
  // A clean merge into main with no conflicting content — this check must still pass.
  const conflict = body.checks.find((c) => c.name === 'no hand-merge conflict');
  assert.strictEqual(conflict.ok, true, JSON.stringify(conflict));
});

test('--dry --json: a real non-generated conflict is reported human-gated, and fails the merge check', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/conflict-4');
  fs.writeFileSync(path.join(fx.work, 'f.txt'), 'branch change\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: branch change');
  fx.g(fx.work, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(fx.work, 'f.txt'), 'trunk change\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: trunk moved on');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');

  const r = colab(fx, ['ship', '--branch', 'feat/conflict-4', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.ok, false);
  const conflict = body.checks.find((c) => c.name === 'no hand-merge conflict');
  assert.strictEqual(conflict.ok, false);
  assert.strictEqual(conflict.class, 'human-gated');
  assert.match(conflict.detail, /f\.txt/);
  // The preview must not leave a stray worktree or move the main checkout off trunk.
  assert.strictEqual(fx.g(fx.work, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
  assert.doesNotMatch(fx.g(fx.work, 'worktree', 'list'), /conflict-4/);
});

// --- #294: the dirty-trunk row still refuses the same way, now naming the path ----------------

test('--dry --json: a dirty trunk checkout still fails "trunk checkout ready" the same way, now naming the path', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/dirty-trunk-6');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'work\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: work');
  fx.g(fx.work, 'checkout', '-q', 'main');
  // A TRACKED, uncommitted edit on the main checkout — #294's shape (a stray relative-path write
  // that landed on trunk), not an untracked scratch file (`dirtyTracked` is tracked-only, #86).
  fs.writeFileSync(path.join(fx.work, 'f.txt'), 'stray edit\n');

  const r = colab(fx, ['ship', '--branch', 'feat/dirty-trunk-6', '--repo', fx.work, '--dry', '--json']);
  // Same refusal shape #294 must not change: ok:false, exit 1 — identical to every other
  // human-gated precondition failure in this file (e.g. the hand-merge-conflict test above).
  assert.strictEqual(r.code, 1, r.out + r.err);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.ok, false);
  const row = body.checks.find((c) => c.name === 'trunk checkout ready');
  assert.strictEqual(row.ok, false);
  assert.strictEqual(row.class, 'human-gated');
  // #294's whole point: the detail now NAMES the dirty path, not just "uncommitted".
  assert.match(row.detail, /f\.txt/);
  // No live worktree exists in this fixture, so attribution has nothing to attribute to — the
  // enrichment must degrade to "unattributed", never invent an owner out of nothing.
  assert.match(row.detail, /unattributed/);
  // Additive-only: `dirtyOwners` appears alongside the unchanged table, never replacing a field.
  assert.ok(body.dirtyOwners, 'dirtyOwners payload missing');
  assert.strictEqual(body.dirtyOwners.paths[0].path, 'f.txt');
  assert.strictEqual(body.dirtyOwners.paths[0].verdict, 'unattributed');
  // The main checkout is left exactly as this test found it — a dry run inspects, never cleans.
  assert.strictEqual(fx.g(fx.work, 'diff', '--name-only').trim(), 'f.txt');
});

test('--dry --json: a branch with no commits of its own to ship is a clean, all-green table', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/clean-5');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'new file\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: add g');
  fx.g(fx.work, 'checkout', '-q', 'main');
  // Claimed (#153: an unclaimed branch whose NAME ends in an issue number now refuses before
  // reaching this table — a different, earlier gate than the one this test means to exercise).
  colab(fx, ['claim', '5', '--branch', 'feat/clean-5', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'feat/clean-5', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  // CI can't be confirmed against a bare non-GitHub origin — that is the ONLY expected failure,
  // and it must read self-clearing (a caller may retry once gh/CI becomes reachable).
  const notOk = body.checks.filter((c) => !c.ok);
  assert.strictEqual(notOk.length, 1, JSON.stringify(notOk));
  assert.match(notOk[0].name, /CI green/);
  assert.strictEqual(notOk[0].class, 'self-clearing');
});

// --- #87 / #90: the two preconditions the machine-facing path was missing -----

/**
 * Writes claims straight into the test's private state.json. `colab claim` would need gh, which a
 * bare on-disk origin does not provide — and the property under test is what ship DOES with a
 * claim, not how the claim got written. Shape mirrors tools/colab's own writer exactly.
 */
function seedClaims(fx, repoAbs, entries) {
  const file = path.join(fx.home, 'state.json');
  const st = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, worktrees: {}, claims: {}, ports: {} };
  st.claims = st.claims || {};
  for (const e of entries) {
    st.claims[`${repoAbs}#${e.issue}`] = {
      issue: `#${e.issue}`, repo: repoAbs, worktree: e.worktree || null, branch: e.branch,
      host: 'test', created: new Date().toISOString(),
    };
  }
  fs.mkdirSync(fx.home, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(st, null, 2));
}

test('--dry --json: a claim git does not corroborate fails the table (#87, the co-tenant case)', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'fix/thing-71-76');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'work\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: the thing\n\nCloses #71');
  fx.g(fx.work, 'checkout', '-q', 'main');
  // #74 is claimed on this branch but named NOWHERE in git — the exact shape #87 measured.
  seedClaims(fx, fs.realpathSync(fx.work), [
    { issue: 71, branch: 'fix/thing-71-76' },
    { issue: 74, branch: 'fix/thing-71-76' },
    { issue: 76, branch: 'fix/thing-71-76' },
  ]);

  const r = colab(fx, ['ship', '--branch', 'fix/thing-71-76', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const check = body.checks.find((c) => c.name === 'claims corroborated by git');
  assert.ok(check, 'the corroboration check is missing from checks[]');
  assert.strictEqual(check.ok, false);
  assert.strictEqual(check.class, 'human-gated');
  assert.match(check.detail, /#74/);
  assert.doesNotMatch(check.detail, /#71|#76/); // both ARE corroborated — only 74 is the finding
  assert.strictEqual(body.ok, false);
});

test('--dry --json: a zero-commit landed branch reports mode evidence-close, not a false ok (#90)', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  // Branched off main and never committed: the design-consult / "no change needed" shape.
  fx.g(fx.work, 'branch', 'docs/decision-90');

  const r = colab(fx, ['ship', '--branch', 'docs/decision-90', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.mode, 'evidence-close');
  const check = body.checks.find((c) => c.name === 'branch has commits');
  assert.ok(check, 'the branch-has-commits precondition is missing from checks[]');
  assert.strictEqual(check.ok, true);
  assert.match(check.detail, /evidence-close/);
});

test('--dry --json: an ordinary branch with commits stays mode squash', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/ordinary-9');
  fs.writeFileSync(path.join(fx.work, 'h.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: ordinary');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const body = JSON.parse(colab(fx, ['ship', '--branch', 'feat/ordinary-9', '--repo', fx.work, '--dry', '--json']).out);
  assert.strictEqual(body.mode, 'squash');
  const check = body.checks.find((c) => c.name === 'branch has commits');
  assert.strictEqual(check.ok, true);
  assert.match(check.detail, /1 vs main/);
});

// --- #293: the additive `baseCi` advisory ------------------------------------------------------
//
// A `gh` stub is placed first on PATH so `isGhUsable`/`ghRunForSha`/`ghRunForCommit` see canned
// runs instead of hitting the network — same posture as tools/lib/git.test.js's own `ghRunForSha`
// fixture. `git ls-remote`/`git merge-base` run for real against the bare `origin` these fixtures
// already create.

function fakeGhBin(root, runsByBranch) {
  const bin = path.join(root, 'fake-gh-bin');
  fs.mkdirSync(bin, { recursive: true });
  // `gh run list --branch <b> ...` → the canned rows for that branch; anything else `gh` needs
  // (originUrl is read via `git`, not `gh`) never reaches this stub, so an unhandled subcommand
  // failing loudly is fine — nothing in this test path should call it.
  const body = Object.entries(runsByBranch)
    .map(([b, rows]) => `if [ "$branch" = "${b}" ]; then echo '${JSON.stringify(rows)}'; exit 0; fi`)
    .join('\n');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
if [ "$1" = "--version" ]; then echo "gh version 2.0.0"; exit 0; fi
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi
branch=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--branch" ]; then branch="$a"; fi
  prev="$a"
done
${body}
echo '[]'
`, { mode: 0o755 });
  return bin;
}

function colabWithGh(fx, bin, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
      COLAB_HOME: fx.home, COLAB_SESSION: 'sess-dry-json-test', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('#293: base red + own head green — baseCi reports suspect-green, and it never flips `ok`', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const baseSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/suspect-6');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: suspect');
  fx.g(fx.work, 'push', '-q', 'origin', 'feat/suspect-6');
  const ownSha = fx.g(fx.work, 'rev-parse', 'feat/suspect-6').trim();
  fx.g(fx.work, 'checkout', '-q', 'main');
  // trunk moves on AFTER the branch was cut, so the base sha is no longer main's current head —
  // exactly the shape #293 measured (base red at cut time, trunk has since moved).
  fs.writeFileSync(path.join(fx.work, 'trunk-moved.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'chore: trunk moved on');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  const trunkHeadSha = fx.g(fx.work, 'rev-parse', 'main').trim();

  const bin = fakeGhBin(fx.root, {
    // trunk's CURRENT head reads green (the ordinary trunk-CI-green check must pass cleanly), the
    // OLD sha the branch was cut from reads red — the exact shape #293 measured: trunk has since
    // recovered, but that says nothing about what the branch actually built against.
    main: [
      { headSha: trunkHeadSha, status: 'completed', conclusion: 'success' },
      { headSha: baseSha, status: 'completed', conclusion: 'failure' },
    ],
    'feat/suspect-6': [{ headSha: ownSha, status: 'completed', conclusion: 'success' }],
  });
  const r = colabWithGh(fx, bin, ['ship', '--branch', 'feat/suspect-6', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  assert.ok(body.baseCi, `expected a baseCi payload, got ${JSON.stringify(body.baseCi)}`);
  assert.strictEqual(body.baseCi.severity, 'suspect-green');
  assert.strictEqual(body.baseCi.baseSha, baseSha);
  const row = body.checks.find((c) => c.name === 'base CI verdict (advisory, #293)');
  assert.ok(row, 'advisory row missing from checks[]');
  assert.strictEqual(row.ok, true, 'the advisory row must never fail the table');
  // The ordinary trunk-CI-green precondition passes cleanly on its own terms (trunk's CURRENT head
  // is green) — baseCi is additive, never a replacement for that check, and the two can disagree.
  const ciCheck = body.checks.find((c) => /CI green/.test(c.name));
  assert.ok(ciCheck);
  assert.strictEqual(ciCheck.ok, true, JSON.stringify(ciCheck));
});

test('#293: base green — no baseCi payload, no advisory row at all', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  const baseSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/clean-base-7');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: clean base');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const bin = fakeGhBin(fx.root, {
    main: [{ headSha: baseSha, status: 'completed', conclusion: 'success' }],
  });
  const r = colabWithGh(fx, bin, ['ship', '--branch', 'feat/clean-base-7', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.baseCi, null);
  assert.strictEqual(body.checks.find((c) => c.name === 'base CI verdict (advisory, #293)'), undefined);
});
