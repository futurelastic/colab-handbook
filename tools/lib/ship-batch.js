'use strict';
/**
 * tools/lib/ship-batch.js — batch landing (#373): test up to N green candidates as ONE combined
 * head, then fast-forward trunk.
 *
 * Landing is serial by construction without this: every merge moves trunk, so the next candidate
 * pays a whole CI cycle for its post-sync re-run, and a queue of green work drains at one change
 * per trunk run. Every mature system that lands several changes per cycle tests the COMBINED state
 * before it becomes trunk (merge trains, merge queues, rollups) — none lands first and tests after.
 * So: trunk head + one squash commit per member, pushed to `ship-batch/<trunk-sha7>`, one combined
 * run, then a fast-forward only if trunk has not moved. Trunk only ever receives a state that
 * passed CI as a whole.
 *
 * Pure: facts in, decisions out — no git, no gh, no clock. `tools/colab`'s `cmdShipBatch` does the
 * I/O and asks this module every question whose answer is a rule. Same posture as ci-verdict.js.
 *
 * File-disjointness is a PRE-FILTER here (it lowers eviction odds), never the correctness gate:
 * semantic conflicts need no shared file. The combined run is the gate.
 */

const MAX_BATCH = 3;
const REF_PREFIX = 'ship-batch/';
// A concrete ref a `branches:` filter is tested against. Any 7-hex tail works: GitHub's filters see
// the literal ref name, and the question is only whether `ship-batch/**` (or a wider glob) admits it.
const PROBE_REF = `${REF_PREFIX}0000000`;
const TRAILER_KEY = 'Ship-Batch';

/**
 * `ship-batch:` from project.yml. Absent → 1 (serial, today's behaviour). An integer 1..3 → that
 * (a single-digit string reads the same). Anything else — 0, 4, 2.5, true, a word — FAILS CLOSED to
 * serial, with the reason: a malformed opt-in must never widen what ship does. The audit fails the
 * same values.
 */
function parseShipBatch(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, 'ship-batch');
  if (!has || doc['ship-batch'] === null || doc['ship-batch'] === undefined) {
    return { n: 1, declared: false, valid: true, reason: 'ship-batch absent' };
  }
  const v = doc['ship-batch'];
  // A digit string is accepted too: the audit's flat reader keeps every scalar a string, and the two
  // readers must agree on what is valid — a value one accepts and the other refuses is drift.
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^[1-9]$/.test(v.trim()) ? Number(v.trim()) : NaN);
  if (Number.isInteger(n) && n >= 1 && n <= MAX_BATCH) {
    return { n, declared: true, valid: true, reason: `ship-batch: ${n}` };
  }
  return { n: 1, declared: true, valid: false, reason: `ship-batch is ${JSON.stringify(v)}, expected an integer 1–${MAX_BATCH} (omit for serial)` };
}

function batchRefName(baseSha) {
  return `${REF_PREFIX}${String(baseSha || '').slice(0, 7)}`;
}

/** `ship-batch/<hex7>` (with or without `refs/heads/`) → `{ ref, base7 }`, else null. */
function parseBatchRef(ref) {
  const m = /^(?:refs\/heads\/)?(ship-batch\/([0-9a-f]{7}))$/.exec(String(ref || ''));
  return m ? { ref: m[1], base7: m[2] } : null;
}

/**
 * The trailer each batch commit carries. It is what lets a LATER `colab ship --batch` call rebuild
 * the member list from the ref alone — no batch state is kept in ~/.colab. It names a branch (already
 * pushed, so already public) and a sha, never a host.
 */
function memberTrailer({ ref, branch, sha }) {
  return `${TRAILER_KEY}: ${ref} ${branch}@${sha}`;
}

/** Every `Ship-Batch:` trailer across commit messages, in order → [{ ref, branch, sha }]. */
function parseMemberTrailers(messages) {
  const out = [];
  for (const msg of messages || []) {
    for (const line of String(msg || '').split('\n')) {
      const m = new RegExp(`^${TRAILER_KEY}:\\s+(\\S+)\\s+(\\S+)@([0-9a-f]{7,40})\\s*$`).exec(line.trim());
      if (m) out.push({ ref: m[1], branch: m[2], sha: m[3] });
    }
  }
  return out;
}

/**
 * A member's OWN head CI, read as a joining class (§4 Branch CI):
 *   green               every run at its head finished, all success
 *   none-cannot-arrive  no run, and no workflow fires on a push to that branch — nothing to wait for;
 *                       the combined run is the first CI the change sees, and it gates
 *   none-pending        no run yet, but one could still arrive → not joinable yet
 *   pending             a run is still in flight → not joinable yet
 *   red                 a run finished not-green → never joins; it goes back to its implementer
 * `summary` is git.summarizeRunsForCommit's shape (null = the read failed → pending, never green).
 */
function branchCiClass(summary, canArrive) {
  if (!summary) return 'pending';
  if (summary.status === 'none') return canArrive ? 'none-pending' : 'none-cannot-arrive';
  if (summary.status !== 'completed') return 'pending';
  return summary.conclusion === 'success' ? 'green' : 'red';
}

/**
 * Can this member join a batch? `report` is its own `colab ship --dry --json` body (the SAME gates
 * every serial ship meets — not a copy of them). Anything that makes the member special goes
 * serial, where the special path already lives:
 *   - evidence-close / pr-pending (the #350 pause) — not a squash;
 *   - a target that is not trunk (an integration line);
 *   - the docs-only autonomy door (#345) — it is judged per branch, re-measured after B0's sync;
 *   - a migration, ci-grant or ci-cure — each is a per-member human door, never a batch one;
 *   - an adopted branch;
 *   - a member editing .github/workflows/** — it would change what grades the batch.
 */
function memberEligibility(report, ciClass, { trunk, touchesWorkflows = false } = {}) {
  const no = (why) => ({ ok: false, why });
  if (!report) return no('its own ship precondition read failed');
  if (!report.ok) {
    const failed = (report.checks || []).filter((c) => !c.ok).map((c) => c.name);
    return no(`its own ship preconditions fail (${failed.join(', ') || 'see colab ship --dry'})`);
  }
  if (report.mode !== 'squash') return no(`completion path is ${report.mode}, not a squash`);
  if (report.target !== trunk) return no(`its base is "${report.target}", not ${trunk}`);
  if (!report.autonomyGate || report.autonomyGate.via !== 'auto-trunk') {
    return no('it lands through the docs-only door (#345), which is judged per branch');
  }
  if (report.migrationGrant) return no('it carries migrations — a per-member human door');
  if (report.ciGrant || report.ciCure) return no('trunk CI passes for it only through a grant/cure door — per member, never a batch');
  if (report.coreReview && (report.coreReview.verdict === 'pending' || report.coreReview.verdict === 'approved')) {
    return no('it touches a core path under review (#350)');
  }
  if ((report.checks || []).some((c) => /Colab-Adopted|adopted explicitly/.test(String(c.detail || '')))) {
    return no('it is an adopted branch');
  }
  if (touchesWorkflows) return no('it edits .github/workflows/** — it would change what grades the batch');
  if (ciClass === 'green' || ciClass === 'none-cannot-arrive') return { ok: true, why: `own head CI: ${ciClass}` };
  if (ciClass === 'red') return no('red at its own head — it goes back to its implementer');
  return no(`its own head CI has not finished (${ciClass}) — not joinable yet`);
}

/**
 * Pick up to `n` from eligible candidates `[{ branch, files: [] }]`, in the order given. File-disjoint
 * candidates are taken first; the rest fill any remaining slot in order. Only a pre-sort: a member
 * sharing a file is still admitted when a slot is free — the build's merge and the combined run decide.
 */
function selectMembers(candidates, n) {
  const list = Array.isArray(candidates) ? candidates : [];
  const selected = [];
  const used = new Set();
  const seen = new Set();
  for (const c of list) {
    if (selected.length >= n) break;
    const files = c.files || [];
    if (files.some((f) => used.has(f))) continue;
    selected.push(c); seen.add(c.branch);
    for (const f of files) used.add(f);
  }
  for (const c of list) {
    if (selected.length >= n) break;
    if (seen.has(c.branch)) continue;
    selected.push(c); seen.add(c.branch);
  }
  const overflow = list.filter((c) => !seen.has(c.branch));
  return { selected, overflow };
}

/**
 * Is the combined run wired at all? `fires` = the workflow files that fire on a push to PROBE_REF
 * (workflow-triggers.js answers that). None → the combined run can never arrive, and ship must say
 * so and go serial — never wait forever.
 */
function wiring(fires) {
  const list = Array.isArray(fires) ? fires : [];
  return { wired: list.length > 0, fires: list };
}

/**
 * The combined run's verdict from every run row at the batch head (`{status, conclusion, attempt,
 * databaseId}`). Same all-runs rule as summarizeRunsForCommit: any finished not-green row (cancelled
 * aside) makes it red; any unfinished row keeps it pending; green needs every row finished and at
 * least one success. `attempt` is the highest run attempt seen — how many times it was re-run.
 */
function combinedVerdict(rows) {
  const list = Array.isArray(rows) ? rows : null;
  if (list === null) return { state: 'pending', attempt: 1, runIds: [], why: 'the run list could not be read' };
  const runIds = list.map((r) => r.databaseId).filter((x) => x !== null && x !== undefined);
  const attempt = list.reduce((m, r) => Math.max(m, Number(r.attempt) || 1), 1);
  if (list.length === 0) return { state: 'none', attempt, runIds, why: 'no run at the batch head yet' };
  const bad = list.find((r) => r.status === 'completed' && r.conclusion !== 'success' && r.conclusion !== 'cancelled');
  if (bad) return { state: 'red', attempt, runIds, why: `a run finished ${bad.conclusion}` };
  if (list.some((r) => r.status !== 'completed')) return { state: 'pending', attempt, runIds, why: 'a run is still in flight' };
  if (list.some((r) => r.conclusion === 'success')) return { state: 'green', attempt, runIds, why: `${list.length} run(s): all success` };
  return { state: 'red', attempt, runIds, why: 'every run was cancelled' };
}

/**
 * The one decision per `colab ship --batch` call. The command is RE-ENTRANT: it reads remote state,
 * takes one step, and exits — the caller waits (bounded, code-ship B1a) and calls again.
 *   serial(reason)       land nothing; hand the members back as a serial list (exit 4)
 *   wait-trunk           trunk's own run is still in flight (exit 3)
 *   rebuild              a batch ref exists on a base trunk has moved past, or its members/heads are
 *                        no longer the ones asked for → delete it, then build afresh
 *   build                build + push the batch ref (exit 3)
 *   wait-run             the combined run is pending or has not appeared (exit 3)
 *   red-rerun-or-serial  combined run red on its FIRST attempt — the caller classifies it (§4): a
 *                        red:infra is re-run once, a red:finding goes serial (exit 4, ref kept)
 *   red-serial           red again after the one re-run — land nothing, serial (exit 4, ref deleted)
 *   land                 green → fast-forward trunk if it has not moved
 */
function nextStep({ enabled, wired, trunkCi, eligibleCount = 0, existing = null, trunkNow = null, verdict = null }) {
  if (!enabled) return { step: 'serial', reason: 'not-enabled' };
  if (!wired) return { step: 'serial', reason: 'unwired' };
  if (trunkCi === 'red') return { step: 'serial', reason: 'trunk-red' };
  if (trunkCi === 'pending') return { step: 'wait-trunk' };
  if (existing) {
    if (!trunkNow || !String(trunkNow).startsWith(existing.base7)) return { step: 'rebuild', reason: 'trunk-moved' };
    if (!existing.matches) return { step: 'rebuild', reason: 'members-changed' };
    if (!verdict || verdict.state === 'pending' || verdict.state === 'none') return { step: 'wait-run' };
    if (verdict.state === 'red') return verdict.attempt >= 2 ? { step: 'red-serial' } : { step: 'red-rerun-or-serial' };
    return { step: 'land' };
  }
  if (eligibleCount < 2) return { step: 'serial', reason: 'too-few' };
  return { step: 'build' };
}

/**
 * Does a green run on the batch ref count as trunk-green for the SAME sha (trunk fast-forwarded to
 * the batch head, so the sha is identical)? Only when the same workflows ran there — a workflow that
 * fires on a trunk push but not on `ship-batch/**` never graded that sha, and its absence is not a
 * pass. So all of:
 *   - no trunk run at the sha has finished not-green (a real trunk red always wins);
 *   - the batch rows are green (combinedVerdict);
 *   - the workflow FILES firing on a trunk push and on a `ship-batch/**` push are the same set;
 *   - there are at least as many batch rows as trunk-firing workflows.
 * Anything else → false, and trunk waits for its own run exactly as today.
 */
function batchGreenCoversTrunk({ trunkRows, batchRows, trunkFires, batchFires }) {
  const t = Array.isArray(trunkRows) ? trunkRows : [];
  if (t.some((r) => r.status === 'completed' && r.conclusion !== 'success' && r.conclusion !== 'cancelled')) return false;
  if (combinedVerdict(batchRows).state !== 'green') return false;
  const a = [...new Set(trunkFires || [])].sort();
  const b = [...new Set(batchFires || [])].sort();
  if (!a.length || a.length !== b.length || a.some((x, i) => x !== b[i])) return false;
  return (batchRows || []).length >= a.length;
}

/** The clause each member's 🚢 evidence comment gains: which combined run graded it. */
function evidenceSuffix({ n, ref, headSha, runIds }) {
  const runs = (runIds || []).length ? (runIds || []).join(', ') : '(id unread)';
  return ` · landed in a batch of ${n} — combined run ${runs} at ${ref}@${String(headSha || '').slice(0, 7)} (#373)`;
}

/** The line every declined batch ends on — the members, handed back one at a time. */
function serialLine(branches) {
  const list = (branches || []).filter(Boolean);
  return `→ SERIAL: ${list.map((b) => `colab ship --branch ${b}`).join(' · ') || '(no members)'}`;
}

module.exports = {
  MAX_BATCH, REF_PREFIX, PROBE_REF, TRAILER_KEY,
  parseShipBatch, batchRefName, parseBatchRef, memberTrailer, parseMemberTrailers,
  branchCiClass, memberEligibility, selectMembers, wiring, combinedVerdict, nextStep,
  batchGreenCoversTrunk, evidenceSuffix, serialLine,
};
