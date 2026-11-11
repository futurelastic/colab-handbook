'use strict';
/**
 * Tests for tools/lib/stale-base.js (#395) — pure, facts handed in exactly as tools/colab's
 * `shipStaleBaseCheck` measures them. Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const { staleBaseVerdict, branchHeadCiVerdict } = require('./stale-base.js');

const GREEN = { status: 'completed', conclusion: 'success' };
const base = { headSha: 'aaaaaaa1', baseTip: 'bbbbbbb2', base: 'main', ghUsable: true, run: GREEN, behind: 0 };

test('a green run whose head contains the base tip is fresh', () => {
  const r = staleBaseVerdict({ ...base, contains: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'fresh');
});

test('the measured incident: green run, base moved, head lacks it — stale-base, self-clearing', () => {
  const r = staleBaseVerdict({ ...base, contains: false, behind: 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'stale-base');
  assert.strictEqual(r.selfClearing, true);
  assert.match(r.detail, /^stale-base: .*1 commit\(s\).*Sync main into the branch \(B0\)/);
});

test('staleness does not depend on the run being green — an in-flight run on a stale head is stale too', () => {
  const r = staleBaseVerdict({ ...base, run: { status: 'in_progress', conclusion: null }, contains: false, behind: 3 });
  assert.strictEqual(r.verdict, 'stale-base');
});

test('no branch run at the head (workflows that cannot fire for a branch ref) passes — nothing to be stale', () => {
  const r = staleBaseVerdict({ ...base, run: { status: 'none', conclusion: null }, contains: false });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'no-run');
});

test('branch not pushed — passes as no-run', () => {
  const r = staleBaseVerdict({ ...base, headSha: null, run: null, contains: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'no-run');
});

test('a failed run read is never fresh', () => {
  const r = staleBaseVerdict({ ...base, run: null, contains: true });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'unread');
  assert.strictEqual(r.selfClearing, true);
});

test('unmeasurable containment (head sha not local, no base tip) refuses, self-clearing', () => {
  assert.strictEqual(staleBaseVerdict({ ...base, contains: null }).ok, false);
  assert.strictEqual(staleBaseVerdict({ ...base, baseTip: null, contains: true }).ok, false);
});

test('no CI read on this host refuses — an unread verdict never passes (#678)', () => {
  // Was a pass ("the CI row above already refuses"); a forge CI row no longer refuses without gh.
  for (const k of ['ghUsable', 'ciReadable']) {
    const r = staleBaseVerdict({ ...base, ghUsable: undefined, [k]: false, run: null, contains: false, behind: 3 });
    assert.strictEqual(r.ok, false, k);
    assert.strictEqual(r.verdict, 'unread', k);
    assert.strictEqual(r.selfClearing, false, k);
  }
});

test('no CI read, but the head lands nothing — passes as no-change (#90, #678)', () => {
  const r = staleBaseVerdict({ ...base, ghUsable: false, run: null, contains: 'no-change' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'no-change');
});

test('ciReadable true with a forge summary behind the base refuses as stale-base, not unread (#678)', () => {
  const run = { status: 'completed', conclusion: 'success', sha: 'aaaaaaa1', runCount: 1, databaseId: null };
  const r = staleBaseVerdict({ ...base, ghUsable: undefined, ciReadable: true, run, contains: false, behind: 2 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'stale-base');
});

test('a forge head with no commit status at all passes as no-run, as on GitHub (#678, Vera r2 note)', () => {
  const run = { status: 'none', conclusion: null, sha: 'aaaaaaa1', runCount: 0, databaseId: null };
  const r = staleBaseVerdict({ ...base, ghUsable: undefined, ciReadable: true, run, contains: false, behind: 2 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'no-run');
});

test('a head that lands no change against the base passes — evidence-close grades nothing', () => {
  const r = staleBaseVerdict({ ...base, contains: 'no-change' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'no-change');
});

// --- #682: the branch head's own CI on a forge ------------------------------------------------

const HEAD = 'c0ffee1234567890c0ffee1234567890c0ffee12';
const hc = (run) => branchHeadCiVerdict({ headSha: HEAD, run, branch: 'feat/x-1', engine: 'forgejo' });

test('#682 a green head passes, naming how many contexts agreed', () => {
  const r = hc({ status: 'completed', conclusion: 'success', runCount: 2 });
  assert.deepStrictEqual([r.ok, r.verdict], [true, 'green']);
  assert.match(r.detail, /2 contexts at feat\/x-1@c0ffee1 \(forgejo commit status\): all success/);
});

test('#682 the measured incident: a failing context refuses, human-gated, naming it (and what still runs)', () => {
  const r = hc({ status: 'completed', conclusion: 'failure', notGreen: [
    { name: 'CI / smoke (push)', status: 'completed', conclusion: 'failure' },
    { name: 'CI / e2e (push)', status: 'in_progress', conclusion: null }] });
  assert.deepStrictEqual([r.ok, r.verdict, r.selfClearing], [false, 'red', false]);
  assert.match(r.detail, /failing: CI \/ smoke \(push\) \(failure\); still running: CI \/ e2e \(push\) \(in_progress\)/);
  assert.match(r.detail, /C7\.contract\.03/);
});

test('#682 a red summary without context names still refuses, on its conclusion', () => {
  const r = hc({ status: 'completed', conclusion: 'error' });
  assert.deepStrictEqual([r.ok, r.verdict], [false, 'red']);
  assert.match(r.detail, /failing: conclusion=error/);
});

test('#682 a running head is not ready — self-clearing, and the detail names the ci-wait to run', () => {
  const r = hc({ status: 'in_progress', conclusion: '', notGreen: [{ name: 'CI / smoke (push)', status: 'in_progress', conclusion: null }] });
  assert.deepStrictEqual([r.ok, r.verdict, r.selfClearing], [false, 'pending', true]);
  assert.ok(r.detail.includes(`colab ci-wait --sha ${HEAD} --branch feat/x-1`), r.detail);
});

test('#682 nothing to judge is null: no head, an unread run, or no status at all', () => {
  assert.strictEqual(branchHeadCiVerdict({ headSha: null, run: { status: 'completed', conclusion: 'failure' }, branch: 'b' }), null);
  assert.strictEqual(hc(null), null);
  assert.strictEqual(hc({ status: 'none', conclusion: null, runCount: 0 }), null);
});

// #691: the GitHub half of #682's row — a head whose run FINISHED red refuses; everything else adds no row.
const { githubBranchHeadRedVerdict } = require('./stale-base.js');
const ghHead = { headSha: 'cccccccc3', branch: 'fix/x-1' };

test('#691: a completed failure at the head is red, human-gated, named', () => {
  const r = githubBranchHeadRedVerdict({ ...ghHead, run: { status: 'completed', conclusion: 'failure', finishedRed: [{ workflowName: 'Secret scan', conclusion: 'failure' }] } });
  assert.deepStrictEqual([r.ok, r.verdict, r.selfClearing], [false, 'red', false]);
  assert.match(r.detail, /^fix\/x-1@ccccccc \(GitHub Actions\) finished red — failing: Secret scan \(failure\)\./);
});

test('#691: green, in flight, none, unread and an unpushed head add no row', () => {
  for (const run of [GREEN, { status: 'in_progress', conclusion: null }, { status: 'none', conclusion: null }, null]) {
    assert.strictEqual(githubBranchHeadRedVerdict({ ...ghHead, run }), null, JSON.stringify(run));
  }
  assert.strictEqual(githubBranchHeadRedVerdict({ ...ghHead, headSha: null, run: { status: 'completed', conclusion: 'failure' } }), null);
});

test('#691: cancelled and skipped are not finished red (#606 docs-only rule)', () => {
  for (const conclusion of ['cancelled', 'skipped']) {
    assert.strictEqual(githubBranchHeadRedVerdict({ ...ghHead, run: { status: 'completed', conclusion } }), null, conclusion);
  }
});

test('#691: finishedRed decides when the summary names a skipped row first, or a run is still in flight', () => {
  const r = githubBranchHeadRedVerdict({ ...ghHead, run: { status: 'completed', conclusion: 'skipped', finishedRed: [{ workflowName: 'CI', conclusion: 'failure' }] } });
  assert.strictEqual(r && r.verdict, 'red');
  assert.match(r.detail, /failing: CI \(failure\)/);
  const s = githubBranchHeadRedVerdict({ ...ghHead, run: { status: 'in_progress', conclusion: null, finishedRed: [{ workflowName: 'Lint', conclusion: 'timed_out' }] } });
  assert.match(s && s.detail, /failing: Lint \(timed_out\)/);
});

test('#691: without finishedRed (a hand-built summary) the summary conclusion decides', () => {
  const r = githubBranchHeadRedVerdict({ ...ghHead, run: { status: 'completed', conclusion: 'timed_out' } });
  assert.match(r.detail, /failing: conclusion=timed_out\./);
});

test('#723 githubBranchHeadRedVerdict: green from the runs that exist, an expected workflow with no run — pending, self-clearing, named, never null', () => {
  const missing = [{ name: 'CI', path: '.github/workflows/ci.yml', dispatch: false }];
  const r = githubBranchHeadRedVerdict({ ...ghHead, run: { status: 'completed', conclusion: 'success', runCount: 1, missing } });
  assert.deepStrictEqual([r.ok, r.verdict, r.selfClearing], [false, 'pending', true]);
  assert.match(r.detail, /has no run of CI, though its definition fires on a push to this branch/);
  assert.match(r.detail, /colab ci-wait --sha [0-9a-f]+ --branch /);
  assert.match(r.detail, /draft PR/);
  // A red still wins over a missing run: it is the finding, not a wait.
  const red = githubBranchHeadRedVerdict({ ...ghHead, run: { status: 'completed', conclusion: 'failure', missing } });
  assert.strictEqual(red.verdict, 'red');
  // workflow_dispatch → `gh workflow run` is offered instead.
  const d = githubBranchHeadRedVerdict({ ...ghHead, run: { status: 'completed', conclusion: 'success', missing: [{ ...missing[0], dispatch: true }] } });
  assert.match(d.detail, /`gh workflow run ci\.yml --ref /);
});
