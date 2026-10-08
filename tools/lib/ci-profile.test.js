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

// ---------------------------------------------------------------- CLI, against a fake gh

const COLAB = path.resolve(__dirname, '..', 'colab');

function fixture(pages) {
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
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ]; then exit 0; fi',
    `echo "$*" >> "${log}"`,
    'case "$*" in',
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
