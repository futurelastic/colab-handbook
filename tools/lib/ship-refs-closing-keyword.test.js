'use strict';
/**
 * Subprocess/CLI tests for #149: `colab ship --refs <N>` refusing BEFORE the push when the
 * composed squash message carries a GitHub closing keyword against a `--refs`'d issue — the
 * live incident being a non-chosen commit's SUBJECT ("...close #58 half 1's deferred note")
 * becoming a squash-body bullet, a shape no existing self-contained-line check could see.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same fixture/colab() shape as
 * tools/lib/ship-dry-json.test.js and tools/lib/ship-ci-grant.test.js. `gh run list` always
 * fails against this fixture's local-bare origin (not a real GitHub repo, see those files'
 * banners for the full explanation), so the "trunk CI green" row is always SELF_CLEARING here —
 * `--dry` (both prose and --json) still computes and reports the WHOLE table on that failure
 * (it never short-circuits on a single red row the way the real, non-dry path does), which is
 * exactly the surface this file needs: the new check's WIRING is what is under test, not a full
 * push. A genuine end-to-end push-refusal needs a real green trunk CI this fixture cannot fake.
 *
 * `--refs` itself needs no working `gh`: resolveCloseRefsSplit seeds refsSet from the flag before
 * ever touching gh, and degrades the tracking-label/checklist-gate lookups to no-ops when gh is
 * unusable — see that function's own doc comment ("degrade, never gate").
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

/** A clone with a real bare `origin` and a `main` trunk, private COLAB_HOME — copied from
 *  ship-dry-json.test.js's fixture(), on purpose (see file banner). */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ship-refs-kw-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab ship-refs-kw test');
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
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const PROJECT_YML_AUTO_TRUNK = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

/** The live #149 shape: a `fix:` commit (wins the squash subject) followed by a `docs:` commit
 *  whose SUBJECT mentions "close #<num>" in ordinary prose — it becomes a bullet, not a trailer
 *  line, so REF_LINE_RE-based reconciliation could never have caught it. */
function addBranchWithInheritedCloseKeyword(fx, branch, num) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, 'feature.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: add the feature');
  fs.writeFileSync(path.join(fx.work, 'notes.txt'), 'y\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `docs: document the thing, close #${num} half 1's deferred note`);
  fx.g(fx.work, 'checkout', '-q', 'main');
}

function addCleanBranch(fx, branch) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, 'feature.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: add the feature, no mention of any issue');
  fx.g(fx.work, 'checkout', '-q', 'main');
}

// --- the prose --dry path ----------------------------------------------------

test('--dry: an inherited "close #N" bullet against a --refs\'d N is refused (NOT READY), naming the keyword', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addBranchWithInheritedCloseKeyword(fx, 'fix/refs-kw-1-58', 58);
  colab(fx, ['claim', '58', '--branch', 'fix/refs-kw-1-58', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'fix/refs-kw-1-58', '--repo', fx.work, '--refs', '58', '--dry']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /NOT READY/);
  assert.match(r.out, /"close #58" would close #58 on merge — kept open by --refs/);
  assert.match(r.out, /Refs \(kept open, NOT closed\): #58/);
});

test('--dry: a clean branch (no inherited closing keyword) with the same --refs\'d issue is not flagged by this check', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCleanBranch(fx, 'fix/refs-kw-2-59');
  colab(fx, ['claim', '59', '--branch', 'fix/refs-kw-2-59', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'fix/refs-kw-2-59', '--repo', fx.work, '--refs', '59', '--dry']);
  assert.doesNotMatch(r.out, /would close #59 on merge/);
  assert.match(r.out, /Refs \(kept open, NOT closed\): #59/);
  // Whatever the exit code is here is governed entirely by the OTHER preconditions (trunk CI is
  // always self-clearing in this fixture) — this test only pins that OUR check contributes no
  // false positive, not the overall exit code.
});

// --- the --dry --json path (mirrors #153's own precedent for this function) -------------------

test('--dry --json: the new check row is present, ok:false, and names the keyword + issue', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addBranchWithInheritedCloseKeyword(fx, 'fix/refs-kw-3-58', 58);
  colab(fx, ['claim', '58', '--branch', 'fix/refs-kw-3-58', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'fix/refs-kw-3-58', '--repo', fx.work, '--refs', '58', '--dry', '--json']);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.ok, false);
  const row = body.checks.find((c) => c.name === 'no inherited closing keyword against --refs');
  assert.ok(row, `missing check row in ${JSON.stringify(body.checks.map((c) => c.name))}`);
  assert.strictEqual(row.ok, false);
  assert.strictEqual(row.class, 'human-gated');
  assert.match(row.detail, /"close #58"/);
  assert.deepStrictEqual(body.refsIssues, [58]);
});

test('--dry --json: the row is ok:true and present when the composed text has no conflict', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCleanBranch(fx, 'fix/refs-kw-4-59');
  colab(fx, ['claim', '59', '--branch', 'fix/refs-kw-4-59', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'fix/refs-kw-4-59', '--repo', fx.work, '--refs', '59', '--dry', '--json']);
  const body = JSON.parse(r.out);
  const row = body.checks.find((c) => c.name === 'no inherited closing keyword against --refs');
  assert.ok(row);
  assert.strictEqual(row.ok, true);
  assert.strictEqual(row.class, null);
});

test('--dry --json: with no --refs at all, the row is absent entirely (never a false-positive gate on an ordinary ship)', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addCleanBranch(fx, 'fix/refs-kw-5-60');
  colab(fx, ['claim', '60', '--branch', 'fix/refs-kw-5-60', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'fix/refs-kw-5-60', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);
  const row = body.checks.find((c) => c.name === 'no inherited closing keyword against --refs');
  assert.strictEqual(row, undefined);
});

// --- #153 composes with this check, it does not collide with it -------------------------------
//
// #153 refuses a branch whose NAME ends in an issue number but whose LOCAL claim registry has
// nothing for it — structurally the earliest-firing gate in `cmdShip`, well before the squash
// message this file's check reads even exists. Because `refsIssues` is always a SUBSET of
// `sess.issues`, and #153's zero-claim path only ever fires when `sess.issues.length === 0`,
// the two checks cannot both be live for the same ship: whichever branch trips #153's refusal
// necessarily has an EMPTY refsIssues, so this file's check has nothing to scan. This test pins
// that composition — #153's refusal fires, alone, with no closing-keyword message layered on top.
test('#153 composes with #149, does not collide: a branch-names-issues zero-claim refusal fires alone, with no closing-keyword message layered on top', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  // Branch name ends in an issue number (#153's trigger shape) but is NEVER claimed locally, and
  // its own commit carries the exact #149 prose shape too — if the two checks collided or
  // double-fired, this is the fixture that would show it.
  addBranchWithInheritedCloseKeyword(fx, 'fix/unclaimed-close-kw-77', 77);

  const r = colab(fx, ['ship', '--branch', 'fix/unclaimed-close-kw-77', '--repo', fx.work, '--dry']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /branch name claims issue\(s\) #77.*registry has nothing for this branch \(#153\)/);
  // #149's message never fires here — there is no --refs issue to have a conflict about, because
  // #153's earlier gate means this ship never resolves any issue as ref'd in the first place, and
  // #153's OWN refusal already returned before the composed-message check this file adds is ever
  // reached (both live in cmdShip; #153's fires first and short-circuits with `return 1`).
  assert.doesNotMatch(r.out + r.err, /would close #77 on merge/);
});

// --- #172: the branch-names-issues refusal names the branch-rename remedy too -----------------
//
// The trailing number `zeroClaimVerdict` reads off the branch name cannot be told apart from a
// version/count suffix — `chore/bump-node-22` reads exactly like an issue-number branch. Before
// #172 the refusal only ever offered two remedies, both assuming the number really is an issue
// (ship from the machine that holds the claim, or claim it here) — an operator on a genuinely
// unclaimed non-issue branch was pointed at two dead ends. This pins the third remedy's presence.
test('#172: the branch-names-issues refusal also names "rename the branch" as a real cause, not just the two claim remedies', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  addBranchWithInheritedCloseKeyword(fx, 'chore/bump-node-22', 22);

  const r = colab(fx, ['ship', '--branch', 'chore/bump-node-22', '--repo', fx.work, '--dry']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /branch name claims issue\(s\) #22.*registry has nothing for this branch \(#153\)/);
  // The two pre-existing remedies are still there …
  assert.match(r.err, /ship from there/);
  assert.match(r.err, /colab claim <N> --branch chore\/bump-node-22/);
  // … and the third, real cause is now named too.
  assert.match(r.err, /NOT an issue number/);
  assert.match(r.err, /rename the branch/);
});
