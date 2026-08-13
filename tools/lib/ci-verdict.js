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

function hoursSince(iso, nowMs) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const now = nowMs != null ? nowMs : Date.now();
  return (now - t) / 3600000;
}

/**
 * `run` is the `{status, conclusion, sha, createdAt, jobCount}` shape — `createdAt`/`jobCount` may be
 * null when not measured (job count is fetched lazily by the caller, only for a run already known to
 * be non-completed; see tools/lib/git.js `ghRunJobCount`'s doc comment for why).
 *
 * Only meaningful for a run whose status is neither `'completed'` nor `'none'` — a completed run is
 * never wedged by definition (it finished, however it finished), and `'none'` means no run exists at
 * all, a different and already-handled case (HUMAN_GATED — "CI is not wired for this ref").
 *
 * Returns `{ wedged, reason }`. `reason` is null when `wedged` is false.
 */
function wedgedVerdict(run, opts = {}) {
  if (!run || run.status === 'completed' || run.status === 'none') return { wedged: false, reason: null };
  const age = hoursSince(run.createdAt, opts.nowMs);
  if (run.jobCount === 0) {
    // #171: no createdAt (age unknown) never manufactures a positive here, same posture as the age
    // backstop below when createdAt is missing/unparseable — a missing signal must not wedge on its own.
    const floorHours = ZERO_JOBS_AGE_FLOOR_MINUTES / 60;
    if (age !== null && age >= floorHours) {
      return {
        wedged: true,
        reason: `zero jobs — no runner has ever picked it up (unmoving for ${age.toFixed(2)}h, past the ${ZERO_JOBS_AGE_FLOOR_MINUTES}m floor)`,
      };
    }
    return { wedged: false, reason: null };
  }
  if (age !== null && age >= WEDGE_AGE_HOURS) {
    return { wedged: true, reason: `status=${run.status} for ${age.toFixed(1)}h (>= ${WEDGE_AGE_HOURS}h backstop)` };
  }
  return { wedged: false, reason: null };
}

module.exports = { WEDGE_AGE_HOURS, ZERO_JOBS_AGE_FLOOR_MINUTES, wedgedVerdict };
