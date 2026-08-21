'use strict';
/**
 * The `blocked_by` dependency-edge verb (#251) — makes `colab` the owner of the one triage write
 * that was still hand-rolled `gh api`, and the one with two independent SILENT-failure modes,
 * both measured live on this repo:
 *
 *   1. WRONG ID ATTACHES A STRANGER'S ISSUE. The REST endpoint's payload is a global DATABASE id,
 *      not the issue number a human types. An empty variable, a failed subshell, or the issue
 *      *number* pasted where the id goes is still a valid integer — the POST returns 200 and
 *      attaches whichever issue holds that id anywhere on GitHub (measured: `issue_id=34`
 *      attached a blocker from an unrelated repo — CONVENTIONS.md, dependency graph section). At
 *      the moment of the write, a wrong id is indistinguishable from success.
 *   2. THE READ-BEFORE-WRITE GUARD IS EASY TO WRITE WRONG. `blockedBy` is a connection object
 *      (`{nodes, totalCount}`), not an array — `| length` returns 2 for an issue with ZERO
 *      blockers, so a guard written that way concludes "already present" forever and never writes
 *      the edge (#250, measured live 2026-08-21).
 *
 * This module owns the JUDGEMENT (arg validity, edge-shape normalisation, presence, the resolved
 * blocker's usability, the read-back verdict, the `--clear` guard). `tools/colab`'s cmdBlocked /
 * cmdBlockedClear own the gh I/O and printing only — the same split `decision-record.js` /
 * `readiness.js` keep from their own `tools/colab` callers.
 *
 * PURE BY CONSTRUCTION: signals in, verdict out. No git, no network, no `gh`, no `fs`. That is
 * what lets `#250`'s exact trap be pinned by a three-line unit test instead of a subprocess
 * fixture, and what lets a vendored reader reach the same verdicts from facts it collected its
 * own way (same posture as readiness.js / decision-record.js / migration-grant.js).
 *
 * WHY NUMBERS ONLY, NEVER IDS, AT THIS MODULE'S BOUNDARY. Failure mode 1 exists because a
 * database id looks exactly like any other integer. Every public function here takes issue
 * NUMBERS (and normalised edge records already carrying a verified id) — never a bare id a
 * caller could have gotten from anywhere. The one place a database id enters this module's view
 * is inside a record `resolvedBlockerProblem` has already validated against the number that was
 * asked for.
 *
 * WHY CROSS-REPO IS OUT OF SCOPE HERE, STRUCTURALLY, NOT BY A CHECK. The blocker is always
 * resolved through `gh api repos/{owner}/{repo}/issues/<M>` — `{owner}/{repo}` is `gh`'s own
 * placeholder for the CURRENT repo, so a foreign blocker can never enter through that call. This
 * module still tracks each edge's repo (`foreignEdges`) so a caller can WARN about a foreign edge
 * it finds already present — one it did not write and must not report as its own failure.
 */

/** repository_url -> "owner/name", or null. Both call sites this module reads from (a single
 *  resolved issue, and each entry of a blocked_by list) carry this field — both are REST issue
 *  payloads, measured live against this repo's own tracker. */
function repoSlugFromUrl(url) {
  const m = /^https:\/\/api\.github\.com\/repos\/(.+)$/.exec(String(url || ''));
  return m ? m[1] : null;
}

function edgeKey(e) { return `${e && e.repo}#${e && e.number}`; }

/**
 * Turn a raw read into a flat `{ok, edges}` list, or `{ok:false, edges:null}` on anything that is
 * not confidently a list of edges — NEVER `{ok:true, edges:[]}` on an unreadable input. A caller
 * that cannot tell "confirmed empty" from "could not read" is the exact ambiguity `ghIssueView`'s
 * own null-means-unreadable contract exists to prevent, reproduced one layer up.
 *
 * Accepts TWO shapes, on purpose:
 *   - the REST list this module's own callers actually use (`gh api .../dependencies/blocked_by`
 *     — an array of full issue objects, each carrying `id`, `number`, `state`, `repository_url`);
 *   - `{blockedBy:{nodes,totalCount}}` (a `gh issue view --json blockedBy` / GraphQL read), for a
 *     caller that already has one lying around. `.blockedBy` is read ONLY via `.nodes` — never
 *     `.blockedBy.length` or `blockedBy`'s own key count, which is exactly the #250 trap: a
 *     connection object has 2 keys regardless of how many edges it holds.
 */
function normaliseEdges(raw) {
  let list;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object' && raw.blockedBy && typeof raw.blockedBy === 'object') {
    if (!Array.isArray(raw.blockedBy.nodes)) return { ok: false, edges: null };
    list = raw.blockedBy.nodes;
  } else {
    return { ok: false, edges: null };
  }

  const edges = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') return { ok: false, edges: null };
    const number = item.number;
    if (!Number.isInteger(number)) return { ok: false, edges: null };
    const repo = item.repository_url
      ? repoSlugFromUrl(item.repository_url)
      : (item.repository && item.repository.nameWithOwner) || null;
    if (!repo) return { ok: false, edges: null };
    const id = Number.isInteger(item.id) ? item.id : null;
    const state = item.state != null ? String(item.state).toLowerCase() : null;
    edges.push({ id, number, repo, state });
  }
  return { ok: true, edges };
}

/** Is `target` ({number, repo}) already among `edges`? Matches on number+repo — the id is not
 *  always available from every read shape (`normaliseEdges` above), so identity here is what
 *  every shape can supply. */
function edgePresent(edges, target) {
  if (!Array.isArray(edges) || !target) return false;
  return edges.some((e) => e.number === target.number && e.repo === target.repo);
}

/** Edges whose repo is NOT `thisRepo` — pre-existing foreign edges this command did not write
 *  and must only ever WARN about, never treat as its own failure (this module never produces
 *  one: the blocker is always resolved same-repo — see the file header). */
function foreignEdges(edges, thisRepo) {
  if (!Array.isArray(edges)) return [];
  return edges.filter((e) => e.repo && e.repo !== thisRepo);
}

/**
 * Argument-level problems, checkable with NO gh call — the guard that keeps a malformed
 * invocation from spending a single network round-trip before refusing.
 */
function argProblem({ blocked, blocker, clear, reason, force } = {}) {
  if (blocker == null) return '--by <blocker> is required';
  if (blocked === blocker) return `#${blocked} cannot block itself`;
  if (!clear && force) return '--force only applies together with --clear';
  if (!clear && reason) return '--reason only applies together with --clear';
  if (clear && (!reason || !String(reason).trim())) {
    return '--clear requires --reason "<why>" — colab cannot verify intent, so it records yours '
      + 'instead of guessing it (code-triage §4: delete only when the edge itself is false, '
      + 'never merely because the blocker landed)';
  }
  return null;
}

/**
 * Is the RESOLVED blocker usable as a write target? This is failure mode 1's guard: a missing or
 * non-integer database id, or a resolved issue whose OWN number does not match what was asked
 * for (an empty/garbled response, or a resolution that silently landed on the wrong issue),
 * refuses before any POST is attempted.
 */
function resolvedBlockerProblem(json, requestedNumber) {
  if (!json || typeof json !== 'object') {
    return `could not read blocker #${requestedNumber} from the tracker — refusing to resolve its database id blind`;
  }
  if (!Number.isInteger(json.id) || json.id <= 0) {
    return `blocker #${requestedNumber} resolved with no usable database id (got ${JSON.stringify(json.id)}) — refusing a write built on an unverified id`;
  }
  if (json.number !== requestedNumber) {
    return `resolved issue is #${json.number}, not the requested #${requestedNumber} — refusing a write that could attach a stranger's issue (the exact hazard this verb exists to close)`;
  }
  return null;
}

/** The four ADD-path verdicts, in the order a caller should check for them. */
const ADD_CONFIRMED = 'confirmed';     // read-back shows exactly the intended edge added
const ADD_WRONG = 'wrong';             // read-back shows a DIFFERENT edge added — WRONG BLOCKER
const ADD_MISSING = 'missing';         // POST reported success, but nothing new reads back
const ADD_UNCONFIRMED = 'unconfirmed'; // the read-back itself could not be completed

/**
 * The read-back verdict for an ADD: `before`/`after` are normalised edge lists (from the SAME
 * blocked issue, read before and after the POST), `target` is `{number, repo}` for the blocker
 * that was just written. `after === null` means the read-back call itself failed — that is
 * `unconfirmed`, and is a DIFFERENT thing from "read fine, edge absent" (`missing`).
 *
 * The comparison is `added = after \ before`, never `after` alone — an issue may already carry
 * unrelated blockers, and none of those are this write's business to judge.
 */
function confirmVerdict(before, after, target) {
  if (after === null || after === undefined) {
    return { verdict: ADD_UNCONFIRMED, why: 'the read-back could not be completed', intruders: [] };
  }
  const beforeKeys = new Set((Array.isArray(before) ? before : []).map(edgeKey));
  const added = after.filter((e) => !beforeKeys.has(edgeKey(e)));
  const targetKey = edgeKey(target);
  const intruders = added.filter((e) => edgeKey(e) !== targetKey);
  const gotTarget = added.some((e) => edgeKey(e) === targetKey);

  if (intruders.length) {
    return {
      verdict: ADD_WRONG,
      why: `the read-back shows #${target && target.number} newly blocked by `
        + `${intruders.map((e) => `${e.repo}#${e.number}`).join(', ')}, not the requested ${targetKey}`,
      intruders,
    };
  }
  if (gotTarget) {
    return { verdict: ADD_CONFIRMED, why: `#${target && target.number} is now confirmed blocked by ${targetKey}`, intruders: [] };
  }
  return { verdict: ADD_MISSING, why: 'the POST reported success but the edge is not present on read-back', intruders: [] };
}

/**
 * The `--clear` guard (code-triage §4): "remove an edge only when the edge is false — not
 * because the blocker moved." `colab` cannot read intent, so it encodes only the one detectable
 * SIGNATURE of the exact mistake §4 names — deleting an edge because the blocker CLOSED — and
 * refuses on it by default. `--force` releases only this guard; it never touches the read-back.
 *
 * A closed blocker is neither necessary nor sufficient for the edge being false; it is the
 * correlate of the wrong reason, and that is enough to be worth a speed bump before a
 * destructive write.
 */
function clearProblem({ closed, force } = {}) {
  if (closed && !force) {
    return 'the blocker is CLOSED — a closed blocker is not proof the edge is false (its code may '
      + 'simply have landed; the dependency and the edge both survive that — code-triage §4). '
      + 'Refusing --clear without --force.';
  }
  return null;
}

/** Stable wire format for the `--clear` receipt comment — mirrors CLAIM_MARK / DECISION_MARK's
 *  shape in tools/colab / decision-record.js. Posted ONCE per actual deletion (never on an
 *  already-absent edge), because the write records itself in `blockedBy` and the timeline
 *  forever, while a delete leaves only a `blocked_by_removed` event with no WHY attached — this
 *  comment is that why. */
const REMOVAL_MARK = '🗑 Dependency edge cleared';
const REMOVAL_RE = /^🗑 Dependency edge cleared — blocked-by `(\d+)` · host `([^`]*)` · (\S+)/;

function removalReceiptBody(blockerNumber, host, iso, reason) {
  const head = `${REMOVAL_MARK} — blocked-by \`${blockerNumber}\` · host \`${host}\` · ${iso}`;
  return `${head}\n\n${reason}`;
}

module.exports = {
  normaliseEdges, edgePresent, foreignEdges,
  argProblem, resolvedBlockerProblem, clearProblem,
  confirmVerdict, ADD_CONFIRMED, ADD_WRONG, ADD_MISSING, ADD_UNCONFIRMED,
  removalReceiptBody, REMOVAL_MARK, REMOVAL_RE,
  // exported for tests / a caller building its own target key consistently
  edgeKey, repoSlugFromUrl,
};
