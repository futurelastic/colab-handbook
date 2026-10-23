'use strict';
/**
 * Shared "is this non-completed CI run merely slow, or structurally WEDGED?" verdict (#155).
 *
 * `shipCiCheck` (tools/colab) and `ci-grant`'s create path used to answer this independently and
 * disagreed on the exact state that motivated this module: a queued run, created during a GitHub
 * Actions incident, with ZERO jobs and no movement for ~7h. `shipCiCheck` called it SELF_CLEARING
 * ("still running, retry later" — advice that can never be taken for a run that will never move) and
 * therefore never consulted a grant. `ci-grant`'s inline `!(status==='completed' && conclusion===
 * 'success')` called the SAME run red, happily minted a grant, and `ship` then silently ignored it —
 * a grant that looks live in `--list` and is inert at the only place it is meant to be read. One
 * function, called from both places, closes the gap between them BY CONSTRUCTION rather than by
 * discipline.
 *
 * PURE BY CONSTRUCTION, same posture as ci-grant.js / migration-grant.js / shipguard.js: signals in,
 * verdict out. No git, no network, no `gh`, no clock read unless `nowMs` is omitted (and even then
 * only `Date.now()`, never a spawned process) — every branch is directly reachable from
 * `node --test`, unlike the shell-backed functions in tools/colab this module exists to unblock.
 *
 * Ruling (2026-08-08, option C — both signals, reclassify to HUMAN_GATED):
 *   - B (primary): the run's job list is EMPTY. No runner has ever picked it up — the measured shape
 *     of a billing lockout or a dead runner pool, and #155's actual incident. Checkable the instant
 *     the run is read; no waiting required.
 *   - A (backstop): the run is older than WEDGE_AGE_HOURS. Generous on purpose — never mistake an
 *     ordinary slow CI run for a wedge — and it exists ONLY to catch the case B cannot: a runner DID
 *     claim the run (jobs is non-empty) and then died mid-job, so the job list is real but frozen.
 *
 * Either signal alone is sufficient; both point to the same reclassification (HUMAN_GATED, not red,
 * not green — "a human must look", the same verdict `ci-grant`'s exemption exists to act on).
 *
 * Amendment (#171, 2026-08-13): signal B originally fired with no age floor at all, so a run read
 * inside the window between creation and GitHub actually materializing its job list — real, and the
 * realistic path into it is back-to-back ships — had `jobCount === 0` while perfectly healthy, and
 * classified HUMAN_GATED. Consequence was mild (routes to the ci-grant door, never merges anything it
 * shouldn't) but false. ZERO_JOBS_AGE_FLOOR_MINUTES below it, zero jobs is read as "not measured yet",
 * not "wedged" — chosen at the top of the issue's proposed 60–120s range for margin, since the true
 * materialization window was not re-measured empirically here. Costs nothing against the signal's
 * actual target: a billing lockout or dead runner pool leaves a run at zero jobs for far longer than
 * two minutes, so the floor never masks a real wedge, only the moment right after creation.
 *
 * Amendment (#650): a THIRD shape, told apart from both of #155's — every job reached `completed`,
 * yet the forge never concluded the run (run and check suite stay `in_progress`, `updated_at`
 * frozen). Measured during a forge incident that delayed Actions result processing: the skipped
 * jobs' check runs were written ~6 minutes after the job they `needs:`, and from then on the REST
 * API refused every exit at once — cancel/force-cancel 409 "not in progress", every rerun and the
 * check-suite rerequest 403 "already running". Nothing CI can still do will move it; only the forge
 * (or a human) can. Before this the shape had no signal of its own: the jobs are non-empty, so it
 * read "still running, retry later" until the 6h age backstop, then a WEDGED that named no exit.
 * Signal: the job list is non-empty, every job is `completed`, and the newest job timestamp is past
 * UNCONCLUDED_FLOOR_MINUTES. Every job needs a readable timestamp — a missing one never manufactures
 * a positive (same posture as the two signals above). Its verdict is still HUMAN_GATED, never green,
 * even when every job succeeded: the forge has not said the run passed (epic #652, fail closed).
 * `wedgeExit` below names the exits that work for each shape, so the verdict is actionable.
 */

// Generous on purpose (see doc comment above) — an ordinary run finishes in minutes to tens of
// minutes even on a slow repo; this threshold only exists to catch a runner that claimed a job and
// then silently died, which the empty-jobs signal cannot see.
const WEDGE_AGE_HOURS = 6;

// #171: below this age, zero jobs means "GitHub hasn't materialized the job list yet", not "wedged".
// Chosen at the top of the issue's proposed 60–120s range — cheap insurance, since the floor only
// ever delays signal B by up to two minutes and never blinds it (a real wedge stays at zero jobs for
// hours, not minutes).
const ZERO_JOBS_AGE_FLOOR_MINUTES = 2;

// #650: how long after its newest job finished a run may still be waiting for the forge to conclude
// it. Normally that takes seconds; the measured incident wrote check runs ~6 minutes late, so 15
// minutes is more than twice the worst lag seen before the read says "the forge, not CI".
const UNCONCLUDED_FLOOR_MINUTES = 15;

function hoursSince(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const now = nowMs != null ? nowMs : Date.now();
  return (now - t) / 3600000;
}

/**
 * #650: did every job of a non-completed run finish, long enough ago that the forge, not CI, is what
 * is holding it? `jobs` is tools/lib/git.js `ghRunJobs`'s shape (`[{name, status, conclusion,
 * startedAt, completedAt}]`), or null when unread. Returns `{ unconcluded, minutes, failed, counts }`:
 * `minutes` since the newest job timestamp (null when not measurable), `failed` the names of jobs
 * that concluded anything but success/skipped/neutral, `counts` conclusion → number of jobs.
 * Never a positive from a missing signal: null/empty jobs, any job not `completed`, or any job with
 * no readable timestamp all read `unconcluded: false`.
 */
function unconcludedJobs(jobs, opts = {}) {
  const no = { unconcluded: false, minutes: null, failed: [], counts: {} };
  if (!Array.isArray(jobs) || jobs.length === 0) return no;
  if (!jobs.every((j) => j && j.status === 'completed')) return no;
  let newest = -Infinity;
  for (const j of jobs) {
    // The measured incident wrote a skipped job's started_at AFTER its completed_at — so take the
    // later of the two, per job, and the latest over all jobs.
    const ts = [j.startedAt, j.completedAt].map((x) => (x ? Date.parse(x) : NaN)).filter((t) => !Number.isNaN(t));
    if (!ts.length) return no;
    newest = Math.max(newest, ...ts);
  }
  const now = opts.nowMs != null ? opts.nowMs : Date.now();
  const minutes = (now - newest) / 60000;
  const floorMin = Number.isFinite(opts.floorSec) ? opts.floorSec / 60 : UNCONCLUDED_FLOOR_MINUTES;
  const counts = {};
  const failed = [];
  for (const j of jobs) {
    const c = j.conclusion || 'none';
    counts[c] = (counts[c] || 0) + 1;
    if (!['success', 'skipped', 'neutral'].includes(c)) failed.push(`${j.name || 'unnamed'} (${c})`);
  }
  return { unconcluded: minutes >= floorMin, minutes, failed, counts, floorMin };
}

/**
 * `run` is the `{status, conclusion, sha, createdAt, jobCount, jobs}` shape — `createdAt`/`jobCount` may be
 * null when not measured (job count is fetched lazily by the caller, only for a run already known to
 * be non-completed; see tools/lib/git.js `ghRunJobCount`'s doc comment for why).
 *
 * Only meaningful for a run whose status is neither `'completed'` nor `'none'` — a completed run is
 * never wedged by definition (it finished, however it finished), and `'none'` means no run exists at
 * all, a different and already-handled case (HUMAN_GATED — "CI is not wired for this ref").
 *
 * `jobs` (#650) is optional — `ghRunJobs`'s list, read by the same lazy call; when present it is what
 * tells the forge-stuck shape (every job completed, run never concluded) from #155's two.
 *
 * Returns `{ wedged, reason, shape }`. `reason` and `shape` are null when `wedged` is false; `shape` is
 * `'zero-jobs'` | `'unconcluded'` | `'age'` (which signal fired). An `'unconcluded'` verdict also
 * carries `failed` — the jobs that concluded red, if any.
 */
function wedgedVerdict(run, opts = {}) {
  if (!run || run.status === 'completed' || run.status === 'none') return { wedged: false, reason: null, shape: null };
  const age = hoursSince(run.createdAt, opts.nowMs);
  // #559: both bounds may come from the repo's measured CI (tools/lib/ci-profile.js); absent → today's.
  const floorMin = Number.isFinite(opts.zeroJobsFloorSec) ? opts.zeroJobsFloorSec / 60 : ZERO_JOBS_AGE_FLOOR_MINUTES;
  const wedgeHours = Number.isFinite(opts.wedgeAgeSec) ? opts.wedgeAgeSec / 3600 : WEDGE_AGE_HOURS;
  if (run.jobCount === 0) {
    // #171: no createdAt (age unknown) never manufactures a positive here, same posture as the age
    // backstop below when createdAt is missing/unparseable — a missing signal must not wedge on its own.
    const floorHours = floorMin / 60;
    if (age !== null && age >= floorHours) {
      return {
        wedged: true,
        shape: 'zero-jobs',
        reason: `zero jobs — no runner has ever picked it up (unmoving for ${age.toFixed(2)}h, past the ${fmtMin(floorMin)} floor)`,
      };
    }
    return { wedged: false, reason: null, shape: null };
  }
  // #650: checked BEFORE the age backstop — a run in this shape is old by the time anyone looks, and
  // the backstop's reason ("status=in_progress for 7h") would hide the one fact that decides the exit.
  const u = unconcludedJobs(run.jobs, { nowMs: opts.nowMs, floorSec: opts.unconcludedFloorSec });
  if (u.unconcluded) {
    const tally = Object.keys(u.counts).sort().map((c) => `${u.counts[c]} ${c}`).join(', ');
    return {
      wedged: true,
      shape: 'unconcluded',
      failed: u.failed,
      reason: `every job completed (${tally}) ${u.minutes.toFixed(0)}m ago, but the forge never concluded the run — past the ${fmtMin(u.floorMin)} floor`,
    };
  }
  if (age !== null && age >= wedgeHours) {
    return { wedged: true, shape: 'age', reason: `status=${run.status} for ${age.toFixed(1)}h (>= ${fmtHours(wedgeHours)} backstop)` };
  }
  return { wedged: false, reason: null, shape: null };
}

/**
 * The exit a WEDGED verdict names (#650) — the tail of the detail line after the reason. #155's two
 * shapes keep their words: a human must look (billing, a runner pool, a dead runner). The forge-stuck
 * shape names what works and what was measured not to, so nobody retries an exit the forge refuses.
 * The ci-grant authority line does not move: no exit here lets an agent's own run stand in for
 * trunk's (epic #652).
 */
function wedgeExit(wedge) {
  if (!wedge || wedge.shape !== 'unconcluded') return 'a human must look, not retry';
  if (wedge.failed && wedge.failed.length) {
    return `red in substance — ${wedge.failed.join(', ')} did not succeed, whatever the run's status says; ` +
      "fix trunk (the fix's own push gets a new run), and only the branch that IS that fix may take a human ci-grant";
  }
  return 'nothing CI can do moves it, and nothing here makes it green. Works: wait for the forge to conclude the run ' +
    '(re-read with `colab trunk-ci --fresh`), or a human `colab ci-grant <issue> --branch <branch>` per candidate. ' +
    'Does not work: cancel / force-cancel (409 "not in progress"), rerun / rerun-failed-jobs / check-suite rerequest ' +
    '(403 "already running"), a workflow_dispatch at this sha (the lost-push rescue skips it while this push run exists, #567). ' +
    "Deleting the run cannot be undone — the owner's call";
}

const fmtMin = (m) => `${Number.isInteger(m) ? m : m.toFixed(1)}m`;
const fmtHours = (h) => (Number.isInteger(h) ? `${h}h` : `${Math.round(h * 60)}m`);

// #413: how long after a trunk commit "no run at this sha" is still the ordinary state. GitHub
// creates a push run seconds after the push, but a ship reading trunk right after another ship
// landed it can get there first. Ten minutes covers queueing on a busy account; past it, an empty
// read goes back to meaning what it always meant — CI is not wired, or never started.
const EMPTY_READ_GRACE_MINUTES = 10;

/**
 * Is an empty CI read of a sha still inside the window where a run may simply not exist YET (#413)?
 * `committedAtMs` is the sha's committer time (null when unknown). Unknown age never manufactures a
 * grace — same posture as wedgedVerdict's missing createdAt: a missing signal must not flip a class.
 *
 * Returns `{ fresh, minutes }` — `minutes` is the measured age, or null when unknown.
 */
function emptyReadVerdict(committedAtMs, opts = {}) {
  if (committedAtMs == null || !Number.isFinite(committedAtMs)) return { fresh: false, minutes: null };
  const now = opts.nowMs != null ? opts.nowMs : Date.now();
  const minutes = (now - committedAtMs) / 60000;
  // #559: the grace may be the repo's measured push→run lag (tools/lib/ci-profile.js); absent → 10 min.
  const graceMinutes = Number.isFinite(opts.graceSec) ? opts.graceSec / 60 : EMPTY_READ_GRACE_MINUTES;
  return { fresh: minutes >= 0 && minutes < graceMinutes, minutes, graceMinutes };
}

module.exports = { WEDGE_AGE_HOURS, ZERO_JOBS_AGE_FLOOR_MINUTES, UNCONCLUDED_FLOOR_MINUTES, EMPTY_READ_GRACE_MINUTES, wedgedVerdict, unconcludedJobs, wedgeExit, emptyReadVerdict };
