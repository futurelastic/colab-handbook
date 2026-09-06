'use strict';
/**
 * tools/lib/disposition.js — "who may apply this disposition, unattended?", answered once.
 *
 * A disposition session (a 🩺 ops session, a producing lane) may not close its own issue —
 * looking something up is not doing it. It measures or acts, posts evidence, and proposes a
 * disposition; a later pass APPLIES it. Whether that pass may be an agent working unattended,
 * or must be a human, is a deterministic rule over measurable inputs — never a judgement an
 * agent makes about its own confidence (CONVENTIONS.md §5, *Disposition*).
 *
 * WHY THIS IS A MODULE AND NOT PROSE. Two consumers must reach the same verdict from the same
 * evidence: the dashboard's authority check and the skill that runs the pass. Two prose copies
 * of one table is the two-places-drift disease this handbook exists to kill — the same reason
 * axis-authority.js, landed.js and readiness.js exist. The acceptance is "same evidence ⇒ same
 * verdict", and it holds BY CONSTRUCTION only if both call one function (or copy-and-own this
 * file per §9), rather than both reading the table with their own eyes.
 *
 * PURE BY CONSTRUCTION: facts in, verdict out. No git, no network, no `gh`, no tracker write.
 * The caller gathers (the marker, the evidence fields, the descriptor, the graph) and this
 * decides. That is what lets a consumer outside this repo reach the same verdict from facts it
 * collected its own way.
 *
 * WHICH DIRECTION THIS FAILS IN. Towards `human`, always. An absent, malformed or unresolvable
 * fact never yields `agent` — the same posture readiness.js takes towards `ready`. Getting this
 * backwards spends a human's attention on something mechanical (cheap, visible); getting it
 * right-ways-round wrong closes an issue nobody checked (expensive, invisible).
 *
 * THREE PLACES THIS DEPARTS FROM ITS SOURCE, each deliberate, each because the source was
 * written for a repo that answers a question this one answers differently:
 *
 *  1. TIER → THE AXIS OF RECORD. The source table reads "tier A ⇒ human, tier B/C ⇒ agent".
 *     This handbook made `exposure` the axis of record and `tier` a legacy read of it (§2,
 *     #144): `A -> released`, `C -> live`, `B -> null`. Writing the letters in here would
 *     re-weld the axis this repo deliberately cut. So the rule is stated on `exposure`
 *     (`released` ⇒ human) and a legacy descriptor is read THROUGH axis-authority.js — which
 *     also means a bare `tier: B` resolves to `null`, i.e. no opinion, i.e. `human`. That is
 *     not a stricter reading smuggled in: `tier: B` genuinely carries no derivable opinion
 *     about what consumes the repo, and this fleet has `none`, `self` and `released` all
 *     measured under it.
 *  2. `not planned` → THE TOKEN `not-planned`. The KIND keeps GitHub's own close-reason
 *     spelling, because that is the string the close is made with. The MARKER TOKEN cannot
 *     carry a space: the token set is closed and read by EQUALITY (the rule `colab:grade`
 *     already sets), and whitespace inside a token makes the parse ambiguous rather than the
 *     comparison strict. Kind and token therefore differ for exactly this one member.
 *  3. THE TWO SHARED INPUTS GATE ONLY `done` AND `not planned`. The source states the axis
 *     input as "a human confirms anything that *closes*", and the skip-fence input as "any
 *     evidence naming one of these ⇒ human". Taken at maximum width that would drag `split`
 *     and `routed-out` in, since those close the issue too — but the source's own table says
 *     "never — filing is mechanical" for both, and its human list names exactly the
 *     `done`/`not planned` pair. Read together: the gate is on the kinds whose close ASSERTS
 *     AN OUTCOME, not on the kinds that merely re-home the work. Filing a sub-issue asserts
 *     nothing about a production surface; `done` asserts that a fenced action was performed
 *     and verified, which is the whole reason the fence exists.
 */

const { axisOfRecord } = require('./axis-authority');

// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------

const AGENT = 'agent';
const HUMAN = 'human';

/**
 * The seven dispositions, by KIND — the prose name, and for `not planned` the literal string
 * GitHub's close reason takes. Frozen and closed: a kind outside this list is not a disposition
 * with an unknown authority, it is not a disposition.
 */
const KINDS = Object.freeze(['done', 'split', 'routed-out', 'hold', 'needs-boss', 'not planned', 'leave']);

/**
 * The same seven by MARKER TOKEN. No token is a prefix or a decorated variant of another — the
 * property `colab:grade`'s token set has, and for the identical reason: a reader comparing by
 * equality can then never mistake a qualifier for a verdict, and a reader that (wrongly) compares
 * by prefix cannot be silently right for a while and wrong later.
 */
const TOKEN_BY_KIND = Object.freeze({
  done: 'done',
  split: 'split',
  'routed-out': 'routed-out',
  hold: 'hold',
  'needs-boss': 'needs-boss',
  'not planned': 'not-planned',
  leave: 'leave',
});
const KIND_BY_TOKEN = Object.freeze(
  Object.fromEntries(Object.entries(TOKEN_BY_KIND).map(([kind, token]) => [token, kind]))
);
const TOKENS = Object.freeze(Object.values(TOKEN_BY_KIND));

/**
 * The kinds whose close asserts an outcome, and which the axis and skip-fence inputs therefore
 * gate. See departure 3 in the header: `split` and `routed-out` also close, and are deliberately
 * NOT here.
 */
const ASSERTS_AN_OUTCOME = Object.freeze(['done', 'not planned']);

/**
 * The classes a disposition pass may never conclude on its own, whatever the exposure — the same
 * set the decisions lane already fences off as human-only. Callers name the classes their
 * evidence touches; this module does not sniff prose for them.
 */
const SKIP_FENCE_CLASSES = Object.freeze(['production', 'credentials', 'destructive', 'non-undoable', 'promotion']);

/**
 * The fixed evidence shape a disposition rides on. Free-form evidence is a FINDING, not a
 * disposition: a pass that cannot tell what was done from what remains cannot verify either.
 * `crossCheck` is deliberately not in this list — it is required by `done` specifically (a
 * second, independent command confirming the effect), not by the evidence shape in general.
 */
const EVIDENCE_FIELDS = Object.freeze(['what', 'command', 'result', 'remains']);

/**
 * PROPOSAL, not a measured threshold (CONVENTIONS.md §5 says so in the same words). A hold whose
 * wake condition has sat this long without movement wants a human to confirm it is still wanted.
 * Exported so a consumer can measure against a different number rather than fork the module, and
 * so the day someone measures it, one constant moves.
 */
const HOLD_STALE_DAYS = 30;

/**
 * One marker per line, `proposed=<token>`, the shape `colab:grade verdict=<token>` already uses.
 * Exported as a PATTERN STRING, not a compiled `/g` RegExp: a global RegExp carries `lastIndex`,
 * so a shared one makes `.test()` alternate true/false across calls for a consumer that reaches
 * for the export instead of the function. The lazy `(\S+?)` is what lets `routed-out` survive —
 * a character class excluding `-` silently truncated it to `routed`, which then read as an
 * unrecognised token, which fails safe to `human` and would have looked like policy.
 */
const MARKER_PATTERN = String.raw`<!--\s*colab:disposition\s+proposed=(\S+?)\s*-->`;

// ---------------------------------------------------------------------------------------------
// Reading and writing the marker
// ---------------------------------------------------------------------------------------------

/**
 * Find the proposed disposition in a comment body. Returns `null` when no marker is present at
 * all, else `{ token, kind, recognised }`.
 *
 * DEGRADE, NEVER GATE — and it cuts both ways here. A missing marker means "no proposal", never
 * "no evidence exists": a consumer may not treat its absence as a verdict. An UNRECOGNISED token,
 * or two markers proposing different things, reads as `recognised: false` with `kind: null` —
 * "not cleared", never a silent default to the safe-looking value. Read by equality on `token`,
 * never by prefix, never by heading text.
 */
function parseMarker(text) {
  if (typeof text !== 'string' || text === '') return null;
  const tokens = [...text.matchAll(new RegExp(MARKER_PATTERN, 'g'))].map((m) => m[1]);
  if (tokens.length === 0) return null;
  const distinct = [...new Set(tokens)];
  if (distinct.length > 1) {
    return { token: null, kind: null, recognised: false, why: `${distinct.length} markers proposing different dispositions` };
  }
  const token = distinct[0];
  const kind = Object.prototype.hasOwnProperty.call(KIND_BY_TOKEN, token) ? KIND_BY_TOKEN[token] : null;
  return kind
    ? { token, kind, recognised: true }
    : { token, kind: null, recognised: false, why: `unrecognised disposition token "${token}"` };
}

/**
 * The marker line for a kind. Throws on anything outside the closed set — a writer inventing a
 * token is a bug at the writer, not a token a reader should have to cope with.
 */
function formatMarker(kind) {
  if (!Object.prototype.hasOwnProperty.call(TOKEN_BY_KIND, kind)) {
    throw new Error(`not a disposition kind: ${JSON.stringify(kind)} (one of: ${KINDS.join(', ')})`);
  }
  return `<!-- colab:disposition proposed=${TOKEN_BY_KIND[kind]} -->`;
}

/**
 * Does this evidence have the fixed shape? `{ complete, missing }`. A field present but empty (or
 * whitespace) counts as missing — a heading with nothing under it is the commonest way free-form
 * evidence passes for structured.
 */
function evidenceShape(evidence) {
  const e = evidence && typeof evidence === 'object' ? evidence : {};
  const missing = EVIDENCE_FIELDS.filter((f) => typeof e[f] !== 'string' || e[f].trim() === '');
  return { complete: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------------------------
// The authority table
// ---------------------------------------------------------------------------------------------

/**
 * Does the repo's axis of record permit an agent to apply an outcome-asserting disposition
 * unattended? `{ ok, why }`. Accepts a resolved `exposure` (for a consumer that already has one)
 * or a parsed `.github/project.yml` under `project`; the descriptor is read through
 * axis-authority.js so the legacy `tier` read stays in one place. Anything unresolvable is `human`.
 */
function axisPermits({ exposure, project } = {}) {
  const resolved = exposure === undefined || exposure === null ? axisOfRecord(project).exposure : exposure;
  if (resolved === 'none' || resolved === 'self' || resolved === 'live') {
    return { ok: true, why: `exposure ${resolved} — the agent applies` };
  }
  if (resolved === 'released') {
    return { ok: false, why: 'exposure released — a human confirms anything that asserts an outcome' };
  }
  return {
    ok: false,
    why: 'no axis of record resolves (a bare tier: B carries no opinion) — unresolvable reads as human',
  };
}

function fencedClasses(skipFence) {
  if (skipFence === true) return ['unnamed'];
  if (!Array.isArray(skipFence)) return [];
  return skipFence.filter((c) => typeof c === 'string' && c.trim() !== '');
}

function verdict(kind, authority, applicable, why, blockers, extra) {
  return Object.assign({ kind, authority, applicable, why, blockers: blockers || [] }, extra || {});
}

/**
 * Who may apply the proposed disposition, and is it applicable at all?
 *
 * Returns `{ kind, authority, applicable, why, blockers[], converted? }`:
 *   - `authority` — the closed two-value answer this module exists for: `agent` | `human`.
 *   - `applicable` — whether the disposition's OWN precondition is met. `false` means applying it
 *     is wrong for anybody; the fix is to supply the missing fact (file the sub-issue, name the
 *     wake), not to escalate. The two fields are independent on purpose: "an agent may do this"
 *     and "this is a coherent thing to do yet" are different questions, and collapsing them is how
 *     a mechanical gap gets routed to a human as if it were a judgement call.
 *   - `converted` — set only for `leave`, which no agent ever applies: `hold` when a wake is
 *     nameable, else `finding`.
 *
 * A human may always apply any disposition on any issue — the agent's verdict is a proposal, never
 * a lock. `authority: 'agent'` therefore means "an agent MAY, unattended", never "a human may not".
 *
 * Facts (all optional; absent reads as unproven, never as satisfied):
 *   kind | token, exposure | project, skipFence[], evidence{what,command,result,remains},
 *   crossCheck, acceptance{ticked,remainderDeclared}, gateNode,
 *   wake{reviewBy,blockedBy,ageDays,movedSince}, subIssue{filed,delivery,wake,evidenceCopied},
 *   routedTo{ref,linksBack}, supersededBy{ref,state,referencesThis}
 */
function classify(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const kind = f.kind !== undefined && f.kind !== null
    ? f.kind
    : (f.token !== undefined && f.token !== null ? KIND_BY_TOKEN[f.token] : undefined);

  if (!KINDS.includes(kind)) {
    return verdict(null, HUMAN, false, 'not a recognised disposition — not cleared, never a default', []);
  }

  const fenced = fencedClasses(f.skipFence);
  const shape = evidenceShape(f.evidence);

  // The two shared inputs, evaluated only for the kinds whose close asserts an outcome.
  const sharedBlockers = [];
  if (ASSERTS_AN_OUTCOME.includes(kind)) {
    const axis = axisPermits(f);
    if (!axis.ok) sharedBlockers.push(axis.why);
    if (fenced.length) sharedBlockers.push(`skip-fence class named in the evidence: ${fenced.join(', ')}`);
  }

  switch (kind) {
    case 'done': {
      if (!shape.complete) {
        return verdict(kind, HUMAN, false,
          'evidence is not in the fixed shape — free-form evidence is a finding, not a disposition',
          [`evidence missing: ${shape.missing.join(', ')}`]);
      }
      const blockers = [...sharedBlockers];
      if (typeof f.crossCheck !== 'string' || f.crossCheck.trim() === '') {
        blockers.push('no re-runnable cross-check command recorded — measurement cannot cross-check itself');
      }
      const acc = f.acceptance && typeof f.acceptance === 'object' ? f.acceptance : {};
      if (acc.ticked !== true && acc.remainderDeclared !== true) {
        blockers.push('acceptance neither ticked nor a remainder declared');
      }
      if (f.gateNode === true) blockers.push('the issue is a gate node for something still open');
      return blockers.length
        ? verdict(kind, HUMAN, true, 'a human must confirm this close', blockers)
        : verdict(kind, AGENT, true, 'executed and cross-checked, nothing gated — the agent applies', []);
    }

    case 'split': {
      // "never — filing is mechanical". Unmet mechanics do not escalate; they name what to file.
      const s = f.subIssue && typeof f.subIssue === 'object' ? f.subIssue : {};
      const blockers = [];
      if (s.filed !== true) blockers.push('remainder not filed as a native sub-issue');
      if (s.delivery !== true) blockers.push('sub-issue does not carry the same delivery: label');
      if (s.wake !== true) blockers.push('sub-issue carries no wake condition');
      if (s.evidenceCopied !== true) blockers.push('evidence not copied across to the sub-issue');
      return blockers.length
        ? verdict(kind, AGENT, false, 'the split is not filed yet — file it, do not escalate it', blockers)
        : verdict(kind, AGENT, true, 'remainder filed and carried across — filing is mechanical', []);
    }

    case 'routed-out': {
      const r = f.routedTo && typeof f.routedTo === 'object' ? f.routedTo : {};
      const blockers = [];
      if (typeof r.ref !== 'string' || r.ref.trim() === '') blockers.push('no <other-repo>#N filed');
      if (r.linksBack !== true) blockers.push('the destination issue does not link back to this one');
      return blockers.length
        ? verdict(kind, AGENT, false, 'the route is not complete yet — finish the filing', blockers)
        : verdict(kind, AGENT, true, 'filed elsewhere and linked back — filing is mechanical', []);
    }

    case 'hold': {
      const w = f.wake && typeof f.wake === 'object' ? f.wake : {};
      const hasWake = (typeof w.reviewBy === 'string' && w.reviewBy.trim() !== '') || w.blockedBy === true;
      if (!hasWake) {
        return verdict(kind, AGENT, false,
          'a park with no wake condition is not a hold — it is a silent wontfix, and should be said plainly',
          ['no review-by:<date> and no blockedBy edge']);
      }
      const stale = Number.isFinite(w.ageDays) && w.ageDays > HOLD_STALE_DAYS && w.movedSince !== true;
      return stale
        ? verdict(kind, HUMAN, true,
          `the wake condition has stood ${w.ageDays} days without movement — a human confirms it is still wanted (${HOLD_STALE_DAYS} d is a PROPOSAL, unmeasured)`,
          [`wake older than ${HOLD_STALE_DAYS} days with no movement`])
        : verdict(kind, AGENT, true, 'the park names what it is waiting on — the agent applies', []);
    }

    case 'needs-boss':
      // Record-first: the pass writes the question down with the apply lever pre-filled and moves
      // on. It does not stop and wait, and it never applies this itself.
      return verdict(kind, HUMAN, true,
        'never applied by an agent — the agent records the question, Boss answers, the issue returns to intake', []);

    case 'not planned': {
      const sup = f.supersededBy && typeof f.supersededBy === 'object' ? f.supersededBy : {};
      const superseded = (typeof sup.ref === 'string' && sup.ref.trim() !== '')
        && (sup.state === 'merged' || sup.state === 'closed')
        && sup.referencesThis === true;
      if (!superseded) {
        return verdict(kind, HUMAN, true,
          'an abandoned direction is a human judgement, always — only a merged or closed replacement referencing this issue makes it mechanical',
          ['no merged/closed replacement referencing this issue']);
      }
      return sharedBlockers.length
        ? verdict(kind, HUMAN, true, 'superseded, but a human must confirm this close', sharedBlockers)
        : verdict(kind, AGENT, true, 'superseded by a merged or closed replacement that references this issue', []);
    }

    case 'leave': {
      // An agent never applies `leave`. It converts: a nameable wake is a `hold`; nothing to name
      // is a finding — an issue on its fourth session with no disposition is a brief problem, not
      // a measurement problem. (A human may still leave with a reason; that reason is the wake.)
      const w = f.wake && typeof f.wake === 'object' ? f.wake : {};
      const nameable = (typeof w.reviewBy === 'string' && w.reviewBy.trim() !== '') || w.blockedBy === true;
      if (!nameable) {
        return verdict(kind, HUMAN, false,
          'no wake condition can be named — this is a finding about the brief, not a disposition',
          ['leave proposed with nothing to wake on'], { converted: 'finding' });
      }
      const asHold = classify(Object.assign({}, f, { kind: 'hold', token: undefined }));
      return verdict(kind, asHold.authority, asHold.applicable,
        `leave converts to hold: ${asHold.why}`, asHold.blockers, { converted: 'hold' });
    }

    /* istanbul ignore next — unreachable: KINDS.includes(kind) guarded above */
    default:
      return verdict(null, HUMAN, false, 'not a recognised disposition — not cleared, never a default', []);
  }
}

module.exports = {
  AGENT, HUMAN,
  KINDS, TOKENS, TOKEN_BY_KIND, KIND_BY_TOKEN,
  ASSERTS_AN_OUTCOME, SKIP_FENCE_CLASSES, EVIDENCE_FIELDS, HOLD_STALE_DAYS, MARKER_PATTERN,
  parseMarker, formatMarker, evidenceShape, axisPermits, classify,
};
