'use strict';
/**
 * CI gate drift (#721) — the pure half of two audit findings. No gh, no git, no I/O.
 *
 * The dedupe gate (CONVENTIONS.md §7, "One verdict per tree") used to live only in copies: each
 * adopter copied a light CI template and owned the copy, so the gate drifted copy by copy — measured
 * across adopters 2026-11-09 → 11-11, missing in six repositories and present but never skipping in
 * three — and a template fix (#717) reached a copy only through a manual sync. The gate now lives once,
 * in the handbook's reusable workflow (.github/workflows/ci-light.yml), and these two readings report
 * what is left as DRIFT, not customisation:
 *
 *   1. copiedGates — a workflow that carries its own copy of the gate (its coined step name, or the
 *      guard's GUARD_NAME env) instead of calling ci-light.yml. Content decides, never the filename.
 *   2. gateNeverSkips — of a guarded workflow's last N trunk push runs, at least one landed a tree a
 *      green push run on another ref had already passed, yet none of the N skipped: the gate is
 *      present and inert (a renamed guard, a trunk ref missing from its `if:`, a skip-chained run…).
 *      Read from run history, so it catches a gate that LOOKS right.
 */

/** The workflow a caller names; `./.github/…` (a local call) and `owner/repo/.github/…@ref` both count. */
const REUSABLE_PATH = '.github/workflows/ci-light.yml';
const CALLER_RE = /^\s*uses:\s*["']?(?:\.\/|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/)\.github\/workflows\/ci-light\.ya?ml(?:@[^\s"'#]+)?["']?\s*(?:#.*)?$/m;
/** The guard's coined step name (every light template since #418/#493), or its GUARD_NAME env (#511). */
const GATE_STEP_RE = /^\s*-\s*name:\s*["']?Look for a green run of this workflow at this sha(?: or tree)?["']?\s*$/m;
const GATE_ENV_RE = /^\s*GUARD_NAME:\s*\S/m;
/** How many trunk runs the inert-gate reading looks back over. */
const RECENT_TRUNK_RUNS = 10;
const GUARD_NAME = 'Already tested at this sha or tree?';

function isCiLightCaller(text) { return !!text && CALLER_RE.test(text); }
function hasCopiedGate(text) { return !!text && !isCiLightCaller(text) && (GATE_STEP_RE.test(text) || GATE_ENV_RE.test(text)); }

/**
 * { callers: [file], copies: [file] } over `.github/workflows/<file>`. A workflow both calling
 * ci-light.yml and carrying a gate step is a caller (the call is the gate; the step would be dead).
 */
function copiedGates({ readFile, workflows }) {
  const callers = [];
  const copies = [];
  for (const wf of workflows || []) {
    const text = readFile(`.github/workflows/${wf}`);
    if (isCiLightCaller(text)) callers.push(wf);
    else if (hasCopiedGate(text)) copies.push(wf);
  }
  return { callers, copies };
}

/**
 * Did one trunk run skip its suite through the gate? From its jobs (`[{name, conclusion}]`): the
 * guard (by name, or as a called "<caller> / <guard>") succeeded and some other job was skipped.
 * On trunk the guard always runs, and a job other than it skips there only when the gate said
 * tested — or for a reason of its own (an opt-in job switched off), which reads as a skip and so can
 * only HIDE drift, never invent it. null in → null out (an unreadable listing is not "no").
 */
function runSkipped(jobs) {
  if (!Array.isArray(jobs)) return null;
  const isGuard = (n) => n === GUARD_NAME || String(n).endsWith(` / ${GUARD_NAME}`);
  const guardOk = jobs.some((j) => j && isGuard(j.name) && j.conclusion === 'success');
  return guardOk && jobs.some((j) => j && !isGuard(j.name) && j.conclusion === 'skipped');
}

/**
 * The inert-gate reading. trunkRuns: newest first, [{id, tree, created, jobs}] — `jobs` as runSkipped
 * reads it; greenRuns: [{id, branch, tree, created}] green push runs of the same workflow on any ref.
 * Returns { verdict: 'drift' | 'ok' | 'unknown', considered, matched: [{trunk, cited}], reason }:
 *   - unknown: no trunk run to read, or a listing could not be read (`null` jobs) — say nothing;
 *   - ok: some run skipped, or no run in the window had a green tree to reuse (nothing to skip);
 *   - drift: at least one had one, and none of the window skipped.
 */
function gateNeverSkips({ trunkRuns, greenRuns, trunk, n = RECENT_TRUNK_RUNS }) {
  if (!Array.isArray(trunkRuns) || !Array.isArray(greenRuns)) return { verdict: 'unknown', considered: 0, matched: [], reason: 'run history unreadable' };
  const window = trunkRuns.slice(0, n);
  if (!window.length) return { verdict: 'unknown', considered: 0, matched: [], reason: 'no trunk push run yet' };
  const t = (x) => Date.parse(x) || 0;
  const matched = [];
  let skipped = 0;
  for (const r of window) {
    const s = runSkipped(r.jobs);
    if (s === null) return { verdict: 'unknown', considered: window.length, matched: [], reason: `the jobs of run ${r.id} could not be read` };
    if (s) { skipped++; continue; }
    if (!r.tree) continue;
    const cited = greenRuns.find((g) => g && g.tree === r.tree && g.id !== r.id && g.branch !== trunk && t(g.created) <= t(r.created));
    if (cited) matched.push({ trunk: r.id, cited: cited.id, branch: cited.branch });
  }
  if (skipped) return { verdict: 'ok', considered: window.length, matched, reason: `${skipped} of the last ${window.length} trunk runs skipped through the gate` };
  if (!matched.length) return { verdict: 'ok', considered: window.length, matched, reason: `no trunk run of the last ${window.length} landed a tree a branch had already passed` };
  return {
    verdict: 'drift', considered: window.length, matched,
    reason: `none of the last ${window.length} trunk runs skipped, yet ${matched.length} landed a tree another ref had already passed green`,
  };
}

/** The audit's two finding texts — one place, so the wording the docs quote cannot drift from the code. */
function copiedGateText(wf) {
  return `drift: .github/workflows/${wf} carries its own copy of the CI dedupe gate instead of calling the handbook's ` +
    `reusable workflow (${REUSABLE_PATH}) — a copy changes only by a manual sync, so a gate fix never reaches it ` +
    '(#717 did not). Switch to the caller: a pristine copy of ci-node, ci-python or ci-laravel moves with `colab update --apply`; ' +
    'an edited one, `colab template ci-<stack> --dest .github/workflows/<this file> --force` (or templates/ci-call.yml), ' +
    'then carry your edits into its `with:` block (#721, #724)';
}
function inertGateText(wf, r) {
  const ex = r.matched[0];
  return `drift: the dedupe gate in .github/workflows/${wf} never skipped — ${r.reason} ` +
    `(e.g. trunk run ${ex.trunk} could have cited run ${ex.cited} on ${ex.branch}). A gate that is present but inert ` +
    'runs every landing twice; check the guard\'s `if:` names this trunk and GUARD_NAME is its job\'s name, or call ' +
    `${REUSABLE_PATH} (templates/ci-call.yml) (#721)`;
}

module.exports = {
  REUSABLE_PATH, RECENT_TRUNK_RUNS, GUARD_NAME,
  isCiLightCaller, hasCopiedGate, copiedGates, runSkipped, gateNeverSkips, copiedGateText, inertGateText,
};
