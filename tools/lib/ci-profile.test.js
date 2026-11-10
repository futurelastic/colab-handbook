'use strict';
// #559 — CI wait bounds derive from the repo's measured CI duration.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const cp = require('./ci-profile');
const ciWait = require('./ci-wait');
const ciVerdict = require('./ci-verdict');

const T0 = Date.parse('2026-10-01T00:00:00Z');
let id = 0;
function run(over = {}) {
  id++;
  return {
    id, sha: `s${id}`, branch: 'feat/x-1', event: 'push', workflowName: 'CI', status: 'completed', conclusion: 'success',
    attempt: 1, createdMs: T0, updatedMs: T0 + 60_000, headCommitMs: null, ...over,
  };
}
/** n clean shas of one kind, the i-th lasting base+i seconds. */
function series(n, { branch = 'feat/x-1', base = 100, lag = null } = {}) {
  return Array.from({ length: n }, (_, i) => run({
    sha: `${branch}-${i}`, branch, createdMs: T0 + i * 1000, updatedMs: T0 + i * 1000 + (base + i) * 1000,
    headCommitMs: lag === null ? null : T0 + i * 1000 - lag * 1000,
  }));
}

test('bootstrap is today, exactly — built from the constants that hold today', () => {
  const th = cp.thresholds(null);
  assert.strictEqual(th.branchWaitSec, 900);
  assert.strictEqual(th.trunkWaitSec, 900);
  assert.deepStrictEqual(th.ciWaitDefaultSec, { branch: 900, trunk: 900, any: 900 });
  assert.strictEqual(th.wedgeAgeSec, ciVerdict.WEDGE_AGE_HOURS * 3600);
  assert.strictEqual(th.wedgeAgeSec, 21600);
  assert.strictEqual(th.emptyReadGraceSec, 600);
  assert.strictEqual(th.zeroJobsFloorSec, 120);
  assert.deepStrictEqual(th.scheduleSec.branch, [30, 60, 120]);
  assert.strictEqual(ciWait.DEFAULT_DEADLINE_SEC, 900, 'one source: ci-wait default = the 15m every skill passed');
  assert.deepStrictEqual(cp.thresholds(cp.profile([])), th);
});

test('wall time per sha is first create → last update across every verifying run at it', () => {
  const rows = [
    run({ sha: 'a', createdMs: T0, updatedMs: T0 + 100_000, workflowName: 'CI' }),
    run({ sha: 'a', createdMs: T0 + 5_000, updatedMs: T0 + 250_000, workflowName: 'Lint' }),
  ];
  const d = cp.shaDurations(rows, { trunk: 'main' });
  assert.deepStrictEqual(d.map((x) => [x.sha, x.kind, x.sec]), [['a', 'branch', 250]]);
});

test('non-verifying, dynamic, re-run, red and unfinished shas are not samples', () => {
  const rows = [
    run({ sha: 'rel', event: 'workflow_run', updatedMs: T0 + 9_999_000 }),
    run({ sha: 'dyn', event: 'dynamic' }),
    run({ sha: 'rerun', attempt: 2 }),
    run({ sha: 'red', conclusion: 'failure' }),
    run({ sha: 'mixed' }), run({ sha: 'mixed', workflowName: 'B', conclusion: 'cancelled' }),
    run({ sha: 'wip', status: 'in_progress', conclusion: null }),
    run({ sha: 'skip', conclusion: 'skipped' }),
    run({ sha: 'ok' }), run({ sha: 'ok', workflowName: 'Release (auto)', event: 'workflow_run', updatedMs: T0 + 9_999_000 }),
  ];
  const d = cp.shaDurations(rows, { trunk: 'main' });
  assert.deepStrictEqual(d.map((x) => x.sha), ['ok']);
  assert.strictEqual(d[0].sec, 60, 'the release lane does not stretch the sample');
});

test('a declared ship-gate-workflows decides which runs count', () => {
  const rows = [run({ sha: 'g', workflowName: 'CI' }), run({ sha: 'g', workflowName: 'Slow', updatedMs: T0 + 600_000 })];
  const policy = { gate: ['CI'], ignore: [] };
  assert.strictEqual(cp.shaDurations(rows, { trunk: 'main', policy })[0].sec, 60);
  assert.strictEqual(cp.shaDurations(rows, { trunk: 'main' })[0].sec, 600);
});

test('trunk vs branch; a branch group at a trunk sha is dropped; lag on trunk only', () => {
  const rows = [
    run({ sha: 't', branch: 'main', createdMs: T0 + 4_000, headCommitMs: T0 }),
    run({ sha: 't', branch: 'feat/new-2', updatedMs: T0 + 10_000 }),
    run({ sha: 'b', branch: 'feat/x-1', headCommitMs: T0 - 1000 }),
    run({ sha: 'neg', branch: 'main', createdMs: T0, headCommitMs: T0 + 5_000 }),
  ];
  const d = cp.shaDurations(rows, { trunk: 'main' });
  const by = Object.fromEntries(d.map((x) => [`${x.kind}:${x.sha}`, x]));
  assert.deepStrictEqual(Object.keys(by).sort(), ['branch:b', 'trunk:neg', 'trunk:t']);
  assert.strictEqual(by['trunk:t'].lagSec, 4);
  assert.strictEqual(by['branch:b'].lagSec, null);
  assert.strictEqual(by['trunk:neg'].lagSec, null, 'a commit time after the run is not a lag');
});

test('under MIN_SAMPLES a kind stays bootstrap; partial source; the window cuts', () => {
  const d = cp.shaDurations([...series(12), ...series(3, { branch: 'main' })], { trunk: 'main' });
  const p = cp.profile(d);
  assert.strictEqual(p.branch.source, 'measured');
  assert.strictEqual(p.trunk.source, 'bootstrap');
  assert.strictEqual(p.source, 'partial');
  const th = cp.thresholds(p);
  assert.strictEqual(th.basis.branchWait, 'measured');
  assert.strictEqual(th.trunkWaitSec, 900);
  assert.strictEqual(cp.profile(d, { sinceMs: T0 + 10 * 86_400_000 }).source, 'bootstrap');
});

test('measured bounds: 2m + factor × p95, rounded up to the minute; the factor scales them', () => {
  // branch p95 of 100..119s (20 samples, nearest rank) = 118s → 120 + 2×118 = 356 → 360s
  const d = cp.shaDurations([...series(20), ...series(20, { branch: 'main', base: 200, lag: 30 })], { trunk: 'main' });
  const p = cp.profile(d);
  assert.strictEqual(p.branch.p95Sec, 118);
  const th = cp.thresholds(p, 2);
  assert.strictEqual(th.branchWaitSec, 360);
  assert.strictEqual(th.trunkWaitSec, Math.ceil((120 + 2 * 218) / 60) * 60);
  assert.deepStrictEqual(th.ciWaitDefaultSec, { branch: 360, trunk: 600, any: 600 });
  assert.strictEqual(th.wedgeAgeSec, 1200, 'factor × the longer wait');
  assert.strictEqual(th.emptyReadGraceSec, 120, 'factor × a 30s lag is under the 2m floor');
  assert.strictEqual(th.zeroJobsFloorSec, 120);
  assert.strictEqual(cp.thresholds(p, 3).branchWaitSec, Math.ceil((120 + 3 * 118) / 60) * 60);
});

test('a slow repo: the wedge age is capped at 6h, the grace is free above 2m, backoff only stretches', () => {
  const d = cp.shaDurations([
    ...series(12, { base: 27 * 60 }),
    ...series(12, { branch: 'main', base: 3 * 3600, lag: 300 }),
  ], { trunk: 'main' });
  const th = cp.thresholds(cp.profile(d), 2);
  assert.strictEqual(th.wedgeAgeSec, 6 * 3600);
  assert.strictEqual(th.emptyReadGraceSec, 600);
  const k = th.branchWaitSec / 900;
  assert.deepStrictEqual(th.scheduleSec.branch, [30, 60, 120].map((s) => Math.round(s * k)));
  assert.ok(th.scheduleSec.branch[0] > 30);
  assert.deepStrictEqual(cp.scheduleFor(60), [30, 60, 120], 'a fast repo never polls faster than 30/60/120');
});

test('parseFactor: absent/valid/invalid — invalid falls back to the documented default', () => {
  assert.deepStrictEqual([cp.parseFactor({}).value, cp.parseFactor({}).declared], [2, false]);
  for (const v of [1, 2, 2.5, '3', '1.5']) {
    const f = cp.parseFactor({ 'ci-wait-factor': v });
    assert.strictEqual(f.valid, true, String(v));
    assert.strictEqual(f.value, Number(v));
  }
  for (const v of [0, 0.5, -1, '2x', [], 'abc', true]) {
    const f = cp.parseFactor({ 'ci-wait-factor': v });
    assert.strictEqual(f.valid, false, JSON.stringify(v));
    assert.strictEqual(f.value, 2);
    assert.match(f.reason, /ci-wait-factor must be a number ≥ 1/);
  }
});

test('kindFor: trunk / branch / any', () => {
  assert.strictEqual(cp.kindFor({ branch: 'main', trunk: 'main' }), 'trunk');
  assert.strictEqual(cp.kindFor({ branch: 'feat/a-1', trunk: 'main' }), 'branch');
  assert.strictEqual(cp.kindFor({ trunk: 'main', onTrunk: true }), 'trunk');
  assert.strictEqual(cp.kindFor({ trunk: 'main', onTrunk: false }), 'branch');
  assert.strictEqual(cp.kindFor({ trunk: 'main' }), 'any');
});

test('ci-verdict honours derived bounds, and keeps today\'s defaults without them', () => {
  const now = Date.parse('2026-10-01T01:00:00Z');
  const createdAt = '2026-10-01T00:30:00Z'; // 30 min old, has jobs
  assert.strictEqual(ciVerdict.wedgedVerdict({ status: 'queued', createdAt, jobCount: 3 }, { nowMs: now }).wedged, false);
  const w = ciVerdict.wedgedVerdict({ status: 'queued', createdAt, jobCount: 3 }, { nowMs: now, wedgeAgeSec: 1200 });
  assert.strictEqual(w.wedged, true);
  assert.match(w.reason, />= 20m backstop/);
  assert.match(ciVerdict.wedgedVerdict({ status: 'queued', createdAt: '2026-09-30T18:00:00Z', jobCount: 3 }, { nowMs: now }).reason, />= 6h backstop/);
  const committed = now - 5 * 60_000;
  assert.strictEqual(ciVerdict.emptyReadVerdict(committed, { nowMs: now }).fresh, true);
  const g = ciVerdict.emptyReadVerdict(committed, { nowMs: now, graceSec: 120 });
  assert.strictEqual(g.fresh, false);
  assert.strictEqual(g.graceMinutes, 2);
});

// ---------------------------------------------------------------- #706: guard skips leave the trunk sample

const SKIP = { total: 3, success: 1, skipped: 2 };
const FULL = { total: 3, success: 3, skipped: 0 };

test('isGuardSkip: one job green, the rest (≥ 1) skipped — nothing else, and an unread run is not a skip', () => {
  assert.strictEqual(cp.isGuardSkip({ jobs: SKIP }), true);
  assert.strictEqual(cp.isGuardSkip({ jobs: FULL }), false);
  assert.strictEqual(cp.isGuardSkip({ jobs: { total: 1, success: 1, skipped: 0 } }), false, 'a one-job workflow that ran is not a skip');
  assert.strictEqual(cp.isGuardSkip({ jobs: { total: 4, success: 1, skipped: 2 } }), false, 'a job that was neither green nor skipped');
  assert.strictEqual(cp.isGuardSkip({ jobs: { total: 3, success: 2, skipped: 1 } }), false, 'a trunk-only job ran beside the guard');
  assert.strictEqual(cp.isGuardSkip({ jobs: null }), false);
  assert.strictEqual(cp.isGuardSkip({}), false);
});

test('jobReadShas: the shas of trunk candidates (green, first attempt, not dynamic), newest first, distinct, capped', () => {
  const rows = [
    run({ id: 1, sha: 'a', branch: 'main', createdMs: T0 + 1 }),
    run({ id: 2, sha: 'c', branch: 'main', createdMs: T0 + 3 }),
    run({ id: 3, sha: 'b', branch: 'main', createdMs: T0 + 2 }),
    run({ id: 9, sha: 'c', branch: 'main', workflowName: 'Lint', createdMs: T0 + 3 }),
    run({ id: 4, sha: 'x', branch: 'feat/x-1', createdMs: T0 + 9 }),
    run({ id: 5, sha: 'x', branch: 'main', createdMs: T0 + 9, conclusion: 'failure' }),
    run({ id: 6, sha: 'x', branch: 'main', createdMs: T0 + 9, attempt: 2 }),
    run({ id: 7, sha: 'x', branch: 'main', createdMs: T0 + 9, event: 'dynamic' }),
    run({ id: 8, sha: 'x', branch: 'main', createdMs: T0 + 9, status: 'in_progress' }),
  ];
  assert.deepStrictEqual(cp.jobReadShas(rows, { trunk: 'main' }), ['c', 'b', 'a']);
  assert.deepStrictEqual(cp.jobReadShas(rows, { trunk: 'main', max: 2 }), ['c', 'b']);
  assert.strictEqual(cp.MAX_SHA_READS, 50);
});

test('jobsFromSuites: the run\'s own suite, counted; a missing suite or a partial page is unread, never a guess', () => {
  const suites = [
    { id: 11, total: 5, conclusions: ['SUCCESS', 'SKIPPED', 'SKIPPED', 'SKIPPED', 'SKIPPED'] },
    { id: 12, total: 3, conclusions: ['SUCCESS', 'SUCCESS', 'SUCCESS'] },
    { id: 13, total: 150, conclusions: ['SUCCESS'] },
  ];
  assert.deepStrictEqual(cp.jobsFromSuites(suites, 11), { total: 5, success: 1, skipped: 4 });
  assert.strictEqual(cp.isGuardSkip({ jobs: cp.jobsFromSuites(suites, 11) }), true);
  assert.deepStrictEqual(cp.jobsFromSuites(suites, '12'), { total: 3, success: 3, skipped: 0 });
  assert.strictEqual(cp.jobsFromSuites(suites, 13), null);
  assert.strictEqual(cp.jobsFromSuites(suites, 99), null);
  assert.strictEqual(cp.jobsFromSuites(suites, null), null);
  assert.strictEqual(cp.jobsFromSuites(undefined, 11), null);
});

test('the sample filter: a guard-skip trunk sha leaves the trunk sample, its lag stays; unprobed is not counted, an unread one is kept', () => {
  const rows = [
    run({ sha: 'skip', branch: 'main', createdMs: T0 + 7_000, updatedMs: T0 + 40_000, headCommitMs: T0, jobs: SKIP }),
    run({ sha: 'full', branch: 'main', createdMs: T0 + 3_000, updatedMs: T0 + 1_000_000, headCommitMs: T0, jobs: FULL }),
    run({ sha: 'unread', branch: 'main', updatedMs: T0 + 500_000, jobs: null }),
    run({ sha: 'old', branch: 'main', updatedMs: T0 + 30_000 }), // past the cap: no `jobs` key
    // two workflows at one sha: one skipped by its guard, one ran — the sha ran the suite
    run({ sha: 'mixed', branch: 'main', updatedMs: T0 + 600_000, jobs: FULL }),
    run({ sha: 'mixed', branch: 'main', workflowName: 'Lint', updatedMs: T0 + 20_000, jobs: SKIP }),
    run({ sha: 'b', branch: 'feat/x-1', updatedMs: T0 + 900_000 }),
  ];
  const d = cp.shaDurations(rows, { trunk: 'main', probed: true });
  const by = Object.fromEntries(d.map((x) => [x.sha, x]));
  assert.strictEqual(by.skip.drop, 'guard-skip');
  assert.strictEqual(by.full.drop, undefined);
  assert.strictEqual(by.mixed.drop, undefined);
  assert.strictEqual(by.unread.drop, undefined);
  assert.strictEqual(by.unread.jobsUnread, true);
  assert.strictEqual(by.old.drop, 'unprobed');
  assert.strictEqual(by.b.drop, undefined, 'branch rows are never probed, never dropped');
  const p = cp.profile(d);
  assert.strictEqual(p.trunk.samples, 3, 'full + unread + mixed');
  assert.strictEqual(p.trunk.maxSec, 997);
  assert.deepStrictEqual(p.trunk.dropped, { guardSkip: 1, guardSkipShas: ['skip'], guardSkipMaxSec: 33, unprobed: 1, jobsUnread: 1 });
  assert.strictEqual(p.lag.samples, 2, 'the skip sha\'s push→run lag is real and still counts');
  // Unprobed (pre-#706 callers, and the branch side): nothing is dropped.
  const legacy = cp.profile(cp.shaDurations(rows, { trunk: 'main' }));
  assert.strictEqual(legacy.trunk.samples, 5);
  assert.strictEqual(legacy.trunk.dropped.guardSkip, 0);
});

test('the measured case of #706: a squash-merge trunk of guard skips gets a trunk wait that outlasts a full-suite run', () => {
  // 79 branch shas, 15m..27m; 50 trunk shas: 48 guard skips of 33s, 2 full-suite runs of 15–16m (the issue's trunk p95 was 50s).
  const branch = Array.from({ length: 79 }, (_, i) => run({ sha: `b${i}`, branch: 'feat/x-1', updatedMs: T0 + (15 * 60 + i * 9) * 1000 }));
  const trunk = Array.from({ length: 50 }, (_, i) => run({
    sha: `t${i}`, branch: 'main', createdMs: T0 + i, updatedMs: T0 + i + (i < 2 ? (15 + i) * 60_000 : 33_000), jobs: i < 2 ? FULL : SKIP,
  }));
  const before = cp.thresholds(cp.profile(cp.shaDurations([...branch, ...trunk.map(({ jobs, ...r }) => r)], { trunk: 'main' })));
  const p = cp.profile(cp.shaDurations([...branch, ...trunk], { trunk: 'main', probed: true }));
  const th = cp.thresholds(p);
  assert.ok(before.trunkWaitOwnSec < 15 * 60, `pre-#706 the trunk wait came from the skips (${before.trunkWaitOwnSec}s)`);
  assert.strictEqual(p.trunk.dropped.guardSkip, 48);
  assert.strictEqual(p.trunk.source, 'bootstrap', 'two full-suite shas are too few to measure');
  assert.ok(th.trunkWaitSec >= p.branch.p95Sec + ciProfile_PLATFORM(), 'covers the branch p95 plus the platform margin');
  assert.ok(th.trunkWaitSec > 20 * 60, 'outlasts a 20-minute full-suite trunk run');
  assert.strictEqual(th.trunkWaitSec, th.branchWaitSec);
  assert.strictEqual(th.basis.trunkWait, 'branch');
  assert.strictEqual(th.trunkWaitOwnSec, 900);
  assert.strictEqual(th.ciWaitDefaultSec.trunk, th.branchWaitSec);
});

test('the branch floor only raises: a slower trunk keeps its own bound, an unmeasured branch floors nothing', () => {
  const slowTrunk = cp.thresholds(cp.profile(cp.shaDurations([...series(12), ...series(12, { branch: 'main', base: 600 })], { trunk: 'main' })));
  assert.strictEqual(slowTrunk.basis.trunkWait, 'measured');
  assert.ok(slowTrunk.trunkWaitSec > slowTrunk.branchWaitSec);
  const thinBranch = cp.thresholds(cp.profile(cp.shaDurations([...series(3, { base: 3000 }), ...series(12, { branch: 'main', base: 30 })], { trunk: 'main' })));
  assert.strictEqual(thinBranch.basis.branchWait, 'bootstrap');
  assert.strictEqual(thinBranch.basis.trunkWait, 'measured', 'a bootstrap branch bound is not a measurement to floor on');
  assert.strictEqual(cp.thresholds(null).basis.trunkWait, 'bootstrap');
});

const ciProfile_PLATFORM = () => cp.PLATFORM_FLOOR_SEC;

// ---------------------------------------------------------------- CLI, against a fake gh

const COLAB = path.resolve(__dirname, '..', 'colab');

function fixture(pages, jobs = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-profile-'));
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/example/example.git'], { cwd: work });
  fs.mkdirSync(path.join(work, '.github'));
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), 'trunk: main\nexposure: none\nci-wait-factor: 2\n');
  const log = path.join(root, 'calls.log');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // Any `api …actions/runs…` call prints the page given for its page number (trunk page → 'trunk').
  pages.forEach((lines, i) => fs.writeFileSync(path.join(root, `p${i}`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n'));
  // A `graphql` read prints the given jq-result lines ([alias, [[suite, total, [conclusions]]]]); none → empty (unread).
  fs.writeFileSync(path.join(root, 'gql'), jobs.map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ]; then exit 0; fi',
    `echo "$*" >> "${log}"`,
    'case "$*" in',
    `  *graphql*) f="${root}/gql" ;;`,
    `  *event=push*) f="${root}/p${pages.length - 1}" ;;`,
    `  *page=1*) f="${root}/p0" ;;`,
    `  *) f=/dev/null ;;`,
    'esac',
    'cat "$f"',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, log, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: path.join(root, 'home'), COLAB_CI_PROFILE_TTL: '3600' } };
}

const iso = (ms) => new Date(ms).toISOString();
function restLine(i, branch, durSec) {
  const c = Date.now() - 86_400_000 + i * 10_000;
  return [1000 + i + (branch === 'main' ? 500 : 0), branch, `${branch === 'main' ? 't' : 'b'}${i}`, 'push', 'CI', 'completed', 'success', 1, iso(c), iso(c + durSec * 1000), iso(c - 5000)];
}

test('CLI: ci-profile --json measures, writes the cache, and a second call reads it with no gh call', () => {
  const branchRows = Array.from({ length: 12 }, (_, i) => restLine(i, 'feat/a-1', 100));
  const trunkRows = Array.from({ length: 12 }, (_, i) => restLine(i, 'main', 200));
  const fx = fixture([branchRows, trunkRows]);
  const r = spawnSync('node', [COLAB, 'ci-profile', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(r.status, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.strictEqual(body.source, 'measured');
  assert.strictEqual(body.trunk, 'main');
  assert.strictEqual(body.measured.branch.p95Sec, 100);
  assert.strictEqual(body.measured.trunk.p95Sec, 200);
  assert.strictEqual(body.measured.lag.p95Sec, 5);
  assert.strictEqual(body.thresholds.branchWaitSec, 360); // 120 + 2×100 = 320 → 360
  assert.strictEqual(body.thresholds.trunkWaitSec, 540); // 120 + 2×200 = 520 → 540
  assert.strictEqual(body.cache.state, 'fetched');
  const calls = fs.readFileSync(fx.log, 'utf8').trim().split('\n').length;
  assert.ok(calls >= 2, 'the paged list and the trunk page');
  const again = spawnSync('node', [COLAB, 'ci-profile', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(JSON.parse(again.stdout).cache.state, 'fresh');
  assert.strictEqual(fs.readFileSync(fx.log, 'utf8').trim().split('\n').length, calls, 'a fresh cache costs no gh call');
  const refresh = spawnSync('node', [COLAB, 'ci-profile', '--repo', fx.work, '--refresh', '--json'], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(JSON.parse(refresh.stdout).cache.state, 'fetched');
  // A changed factor applies from the cache, with no refetch.
  fs.writeFileSync(path.join(fx.work, '.github', 'project.yml'), 'trunk: main\nexposure: none\nci-wait-factor: 3\n');
  const f3 = JSON.parse(spawnSync('node', [COLAB, 'ci-profile', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env }).stdout);
  assert.strictEqual(f3.thresholds.branchWaitSec, 420); // 120 + 3×100
  assert.strictEqual(f3.cache.state, 'fresh');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('CLI: no history → BOOTSTRAP, today\'s bounds, exit 0', () => {
  const fx = fixture([[], []]);
  const r = spawnSync('node', [COLAB, 'ci-profile', '--repo', fx.work], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /BOOTSTRAP/);
  assert.match(r.stdout, /every bound is the bootstrap/);
  assert.match(r.stdout, /branch wait 15m00s\s+bootstrap/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('CLI: ci-wait with no --timeout takes its deadline from the cached profile', () => {
  const branchRows = Array.from({ length: 12 }, (_, i) => restLine(i, 'feat/a-1', 100));
  const fx = fixture([branchRows, []]);
  assert.strictEqual(spawnSync('node', [COLAB, 'ci-profile', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env }).status, 0);
  fs.writeFileSync(fx.log, '');
  // Now the fake gh answers the wait's poll. Only the deadline is asserted here — the body is not a
  // runs list, so the wait ends at once (UNKNOWN) instead of sitting out the deadline.
  fs.writeFileSync(path.join(fx.root, 'bin', 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    `echo "$*" >> "${fx.log}"`,
    `printf 'HTTP/2.0 200 OK\\r\\nEtag: "e"\\r\\n\\r\\n{"status":"completed","conclusion":"success"}'`,
  ].join('\n') + '\n', { mode: 0o755 });
  const sha = 'c'.repeat(40);
  const r = spawnSync('node', [COLAB, 'ci-wait', '--sha', sha, '--branch', 'feat/a-1', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env });
  const body = JSON.parse(r.stdout);
  assert.strictEqual(body.deadlineSec, 360);
  assert.strictEqual(body.deadlineBasis, 'branch bound, measured');
  const trunkWait = JSON.parse(spawnSync('node', [COLAB, 'ci-wait', '--sha', sha, '--branch', 'main', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env }).stdout);
  assert.strictEqual(trunkWait.deadlineSec, 900, 'trunk unmeasured → its bootstrap');
  assert.strictEqual(trunkWait.deadlineBasis, 'trunk bound, bootstrap');
  const explicit = JSON.parse(spawnSync('node', [COLAB, 'ci-wait', '--sha', sha, '--branch', 'main', '--timeout', '90s', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env }).stdout);
  assert.strictEqual(explicit.deadlineSec, 90);
  assert.strictEqual(explicit.deadlineBasis, '--timeout');
  assert.ok(!/status=completed&created/.test(fs.readFileSync(fx.log, 'utf8')), 'a fresh cache: the waits never re-read history');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('CLI: ci-profile reads trunk jobs, drops the guard skips, names them, and floors the trunk wait (#706)', () => {
  const branchRows = Array.from({ length: 12 }, (_, i) => restLine(i, 'feat/a-1', 1200));
  // 14 trunk shas (hex, with a check suite each): 12 guard skips of 30s, 2 full-suite runs of 20m
  const hex = (i) => `${String(i).padStart(2, '0')}${'a'.repeat(38)}`;
  const trunkRows = Array.from({ length: 14 }, (_, i) => {
    const l = restLine(i, 'main', i < 2 ? 1200 : 30);
    l[2] = hex(i);
    l[11] = 9000 + i;
    return l;
  });
  // Read newest first, so alias c0 is trunk sha 13 … c13 is sha 0. A second suite at each sha (another
  // workflow, all green) is not this run's and must not count against the skip.
  const gql = Array.from({ length: 14 }, (_, k) => {
    const i = 13 - k;
    return [`c${k}`, [[9000 + i, 5, i < 2 ? Array(5).fill('SUCCESS') : ['SUCCESS', 'SKIPPED', 'SKIPPED', 'SKIPPED', 'SKIPPED']], [7000 + i, 3, Array(3).fill('SUCCESS')]]];
  });
  const fx = fixture([branchRows, trunkRows], gql);
  const r = spawnSync('node', [COLAB, 'ci-profile', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(r.status, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.strictEqual(body.measured.trunk.dropped.guardSkip, 12);
  assert.strictEqual(body.measured.trunk.dropped.guardSkipShas.length, 12);
  assert.deepStrictEqual(body.measured.trunk.dropped.guardSkipShas, Array.from({ length: 12 }, (_, k) => hex(13 - k)));
  assert.strictEqual(body.measured.trunk.samples, 2);
  assert.strictEqual(body.measured.lag.samples, 14, 'every trunk sha\'s lag still counts');
  assert.strictEqual(body.cache.jobsRead, 14);
  assert.strictEqual(body.cache.jobsFailed, 0);
  assert.strictEqual(body.thresholds.branchWaitSec, 2520); // 120 + 2×1200
  assert.strictEqual(body.thresholds.trunkWaitSec, 2520, 'floored at the branch wait, past a 20m full-suite trunk run');
  assert.strictEqual(body.thresholds.basis.trunkWait, 'branch');
  const calls = fs.readFileSync(fx.log, 'utf8');
  assert.strictEqual((calls.match(/graphql/g) || []).length, 1, 'one batched read for 14 trunk shas');
  assert.ok(!/oid:"b\d/.test(calls), 'branch shas are never read');
  const txt = spawnSync('node', [COLAB, 'ci-profile', '--repo', fx.work], { encoding: 'utf8', env: fx.env });
  assert.match(txt.stdout, /dropped 12 guard-skip sha\(s\)/);
  assert.match(txt.stdout, new RegExp(`: ${hex(13).slice(0, 7)} ${hex(12).slice(0, 7)} .* ${hex(2).slice(0, 7)}\n`));
  assert.match(txt.stdout, /trunk wait\s+42m00s\s+the branch wait — trunk's own bound \(15m00s\) is shorter/);
  // ci-wait on trunk with no --timeout outlasts the full-suite run.
  fs.writeFileSync(path.join(fx.root, 'bin', 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    `printf 'HTTP/2.0 200 OK\\r\\nEtag: "e"\\r\\n\\r\\n{"status":"completed","conclusion":"success"}'`,
  ].join('\n') + '\n', { mode: 0o755 });
  const w = JSON.parse(spawnSync('node', [COLAB, 'ci-wait', '--sha', 'c'.repeat(40), '--branch', 'main', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env }).stdout);
  assert.strictEqual(w.deadlineSec, 2520);
  assert.match(w.deadlineBasis, /^trunk bound, measured branch bound/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('CLI: a cache written before #706 (v1) is refetched, never trusted', () => {
  const fx = fixture([Array.from({ length: 12 }, (_, i) => restLine(i, 'feat/a-1', 100)), []]);
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: fx.work, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(common, 'colab-ci-profile.json'), JSON.stringify({ v: 1, trunk: 'main', fetchedAt: Date.now(), profile: cp.profile([]) }));
  const body = JSON.parse(spawnSync('node', [COLAB, 'ci-profile', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.env }).stdout);
  assert.strictEqual(body.cache.state, 'fetched');
  fs.rmSync(fx.root, { recursive: true, force: true });
});
