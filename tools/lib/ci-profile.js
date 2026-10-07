'use strict';
/**
 * tools/lib/ci-profile.js — a repo's measured CI duration, and every CI wait bound derived from it (#559).
 *
 * Before this module every CI wait was a fleet-wide constant, and two of them disagreed: the skills
 * passed `--timeout 15m` to `colab ci-wait` everywhere while its own default was 45 minutes, so a
 * caller that omitted the flag silently waited three times as long. Repos' CI ranges from a few
 * minutes to nearly half an hour, so one number was too long for a fast repo and too short for a
 * slow one.
 *
 * The rule (epic #558): a threshold that depends on a repo's nature comes from THAT repo. Here the
 * duration is MEASURED from the repo's own CI history; the only DECLARED part is the multiple of it
 * a repo is willing to wait (`ci-wait-factor`, default 2). Where nothing has been measured yet, each
 * bound is today's value exactly — documented as the bootstrap, never a different behaviour.
 *
 * Pure: run rows in, a profile and thresholds out — no git, no gh, no clock. `tools/colab` fetches
 * (`fetchCiProfileRows`), caches (`ciProfileFor`) and prints (`cmdCiProfile`).
 *
 * What is measured, per sha: the wall time from the first run's creation to the last run's last
 * update, across every run that verifies the code at that sha (verify-runs.js, the same set
 * `ci-wait --sha` waits on). That is exactly the wait a session sits through: "every run at the sha
 * has finished". Only clean first-attempt green shas count — a re-run measures an incident, a red
 * run measures how fast it failed.
 */

const ciWait = require('./ci-wait');
const ciVerdict = require('./ci-verdict');
const verifyRuns = require('./verify-runs');
const { quantile } = require('./batch-stats');

const FACTOR_KEY = 'ci-wait-factor';
const DEFAULT_FACTOR = 2;
/** A kind with fewer clean green shas than this in the window stays on its bootstrap value. */
const MIN_SAMPLES = 10;
const WINDOW_DAYS = 30;

/**
 * The one platform constant: how long GitHub may take to start a run and materialize its job list
 * (ci-verdict's zero-jobs floor). It floors every derived bound — a 20-second CI must not produce a
 * wait shorter than the time a run can take to appear at all. Not repo-measurable at run-list cost:
 * `run_started_at` equals `created_at` on every row we read, so the list carries no queue signal.
 */
const PLATFORM_FLOOR_SEC = ciVerdict.ZERO_JOBS_AGE_FLOOR_MINUTES * 60;

/**
 * Today's values, exactly — what a repo with no history gets, built from the constants that hold
 * them rather than restated. The 6 h wedge age is also a CAP: it is the hosted-runner job limit, so
 * measurement may only lower it (a safety limit a repo may only tighten, epic #558). Likewise the
 * 30/60/120 s poll schedule is a REST-quota floor — measurement may only stretch it.
 */
const BOOTSTRAP = Object.freeze({
  branchWaitSec: 15 * 60,
  trunkWaitSec: 15 * 60,
  wedgeAgeSec: ciVerdict.WEDGE_AGE_HOURS * 3600,
  emptyReadGraceSec: ciVerdict.EMPTY_READ_GRACE_MINUTES * 60,
  zeroJobsFloorSec: PLATFORM_FLOOR_SEC,
  scheduleSec: ciWait.DEFAULT_SCHEDULE_SEC,
});

/**
 * `ci-wait-factor: <number ≥ 1>` — absent → 2. A malformed value falls back to the documented
 * default (never to a different behaviour) and is reported; the audit fails it.
 */
function parseFactor(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, FACTOR_KEY) && doc[FACTOR_KEY] !== null && doc[FACTOR_KEY] !== undefined;
  if (!has) return { value: DEFAULT_FACTOR, declared: false, valid: true, reason: `${FACTOR_KEY}: ${DEFAULT_FACTOR} (default)` };
  const raw = doc[FACTOR_KEY];
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : NaN);
  if (!Number.isFinite(n) || n < 1) {
    return { value: DEFAULT_FACTOR, declared: true, valid: false,
      reason: `${FACTOR_KEY} must be a number ≥ 1 (a multiple of the measured CI duration), got ${JSON.stringify(raw)} — using ${DEFAULT_FACTOR}` };
  }
  return { value: n, declared: true, valid: true, reason: `${FACTOR_KEY}: ${n}` };
}

/**
 * Rows → one wall time per clean green sha. A row: `{ sha, branch, event, workflowName, status,
 * conclusion, attempt, createdMs, updatedMs, headCommitMs }`.
 *
 * A branch group at a sha that is also a trunk sha is dropped: a branch cut moments ago re-runs
 * trunk's content, and those near-instant runs would drag the branch duration down.
 */
function shaDurations(rows, { trunk, policy = null } = {}) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!r || !r.sha || r.event === 'dynamic') continue;
    const key = `${r.branch || ''}\u0000${r.sha}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const trunkShas = new Set([...groups.values()].filter((g) => g[0].branch === trunk).map((g) => g[0].sha));
  const out = [];
  for (const g of groups.values()) {
    const split = verifyRuns.splitVerifying(g, policy);
    const counted = split ? split.counted : g;
    if (!counted.length) continue;
    if (!counted.every((r) => r.status === 'completed')) continue;
    if (!counted.every((r) => ['success', 'skipped', 'neutral'].includes(r.conclusion))) continue;
    if (!counted.some((r) => r.conclusion === 'success')) continue;
    if (counted.some((r) => Number(r.attempt) > 1)) continue;
    const created = Math.min(...counted.map((r) => r.createdMs));
    const ended = Math.max(...counted.map((r) => r.updatedMs));
    if (!Number.isFinite(created) || !Number.isFinite(ended) || ended < created) continue;
    const kind = g[0].branch === trunk ? 'trunk' : 'branch';
    if (kind === 'branch' && trunkShas.has(g[0].sha)) continue;
    let lagSec = null;
    if (kind === 'trunk') {
      const c = Math.min(...counted.map((r) => r.headCommitMs).filter(Number.isFinite));
      if (Number.isFinite(c) && created >= c) lagSec = Math.round((created - c) / 1000);
    }
    out.push({ sha: g[0].sha, kind, sec: Math.round((ended - created) / 1000), lagSec, endMs: ended });
  }
  return out;
}

function stats(values) {
  const v = values.filter(Number.isFinite);
  return {
    source: v.length >= MIN_SAMPLES ? 'measured' : 'bootstrap',
    samples: v.length,
    p50Sec: quantile(v, 0.5),
    p95Sec: quantile(v, 0.95),
    maxSec: v.length ? Math.max(...v) : null,
  };
}

/** Durations → `{ branch, trunk, lag, source }`; only samples ending at or after `sinceMs` count. */
function profile(durations, { sinceMs = null } = {}) {
  const d = (durations || []).filter((x) => sinceMs === null || x.endMs >= sinceMs);
  const branch = stats(d.filter((x) => x.kind === 'branch').map((x) => x.sec));
  const trunk = stats(d.filter((x) => x.kind === 'trunk').map((x) => x.sec));
  const lagV = d.filter((x) => x.kind === 'trunk' && x.lagSec !== null).map((x) => x.lagSec);
  const lag = { source: lagV.length >= MIN_SAMPLES ? 'measured' : 'bootstrap', samples: lagV.length, p95Sec: quantile(lagV, 0.95) };
  const n = [branch, trunk].filter((k) => k.source === 'measured').length;
  return { branch, trunk, lag, source: n === 2 ? 'measured' : n === 0 ? 'bootstrap' : 'partial' };
}

const ceilMinute = (sec) => Math.ceil(sec / 60) * 60;

/** A kind's wait bound: GitHub must start the run, then `factor` times what it takes at p95. */
function boundFor(k, factor, bootstrapSec) {
  if (!k || k.source !== 'measured' || !Number.isFinite(k.p95Sec)) return { sec: bootstrapSec, basis: 'bootstrap' };
  return { sec: ceilMinute(PLATFORM_FLOOR_SEC + factor * k.p95Sec), basis: 'measured' };
}

/** The schedule for a bound: 30/60/120 s stretched in proportion to a bound past 15 min, never shrunk. */
function scheduleFor(boundSec) {
  const k = Math.max(1, boundSec / BOOTSTRAP.branchWaitSec);
  return BOOTSTRAP.scheduleSec.map((s) => Math.round(s * k));
}

/**
 * Profile + factor → every threshold, each with the basis it came from. A null profile (nothing
 * read, no cache) is the bootstrap in full.
 */
function thresholds(prof, factor = DEFAULT_FACTOR) {
  const f = Number.isFinite(factor) && factor >= 1 ? factor : DEFAULT_FACTOR;
  const p = prof || {};
  const branch = boundFor(p.branch, f, BOOTSTRAP.branchWaitSec);
  const trunk = boundFor(p.trunk, f, BOOTSTRAP.trunkWaitSec);
  const anyMeasured = branch.basis === 'measured' || trunk.basis === 'measured';
  const wedgeAgeSec = anyMeasured ? Math.min(BOOTSTRAP.wedgeAgeSec, ceilMinute(f * Math.max(branch.sec, trunk.sec))) : BOOTSTRAP.wedgeAgeSec;
  const lagMeasured = p.lag && p.lag.source === 'measured' && Number.isFinite(p.lag.p95Sec);
  const emptyReadGraceSec = lagMeasured ? Math.max(PLATFORM_FLOOR_SEC, ceilMinute(f * p.lag.p95Sec)) : BOOTSTRAP.emptyReadGraceSec;
  return {
    factor: f,
    branchWaitSec: branch.sec,
    trunkWaitSec: trunk.sec,
    ciWaitDefaultSec: { branch: branch.sec, trunk: trunk.sec, any: Math.max(branch.sec, trunk.sec) },
    wedgeAgeSec,
    emptyReadGraceSec,
    zeroJobsFloorSec: BOOTSTRAP.zeroJobsFloorSec,
    scheduleSec: { branch: scheduleFor(branch.sec), trunk: scheduleFor(trunk.sec), any: scheduleFor(Math.max(branch.sec, trunk.sec)) },
    basis: {
      branchWait: branch.basis,
      trunkWait: trunk.basis,
      wedgeAge: anyMeasured ? 'measured' : 'bootstrap',
      emptyReadGrace: lagMeasured ? 'measured' : 'bootstrap',
      zeroJobsFloor: 'default',
    },
  };
}

/** Which bound a wait uses: trunk when the target is trunk, branch for any other branch, else `any`. */
function kindFor({ branch = null, trunk = null, onTrunk = null } = {}) {
  if (branch) return branch === trunk ? 'trunk' : 'branch';
  if (onTrunk === true) return 'trunk';
  if (onTrunk === false) return 'branch';
  return 'any';
}

module.exports = {
  FACTOR_KEY, DEFAULT_FACTOR, MIN_SAMPLES, WINDOW_DAYS, PLATFORM_FLOOR_SEC, BOOTSTRAP,
  parseFactor, shaDurations, profile, thresholds, scheduleFor, kindFor,
};
