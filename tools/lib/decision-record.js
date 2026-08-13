'use strict';
/**
 * The decision-record marker (#121) — makes recording an answer to a blocking question a
 * POSITIVE, machine-readable act, never just the absence of `needs-decision`
 * (tools/lib/labels.js, NEEDS_DECISION_LABEL).
 *
 * WHY THIS MODULE EXISTS. #122 consolidated the design-approval gate into the wider
 * `needs-decision` (CONVENTIONS.md §5, *Decision gate*) — a human must answer a blocking
 * question before an issue can start. #121 answers a narrower but sharper question: what
 * does ANSWERING look like, mechanically? "Clear the label" was the obvious answer and the
 * wrong one — #127 measured it failing LIVE: a ruling was posted as ordinary prose in a
 * comment, the gate label was removed, and a later triage pass, reading the issue fresh, saw
 * no machine-readable record of a decision and RE-GATED it. The ruling had been sitting in a
 * comment the whole time. A cleared label is indistinguishable from a label never applied.
 *
 * So the fix makes the ANSWER the artifact a consumer reads, not the absence of a gate — the
 * same principle CONVENTIONS.md already applies to a design conclusion's three units ("prose
 * does not block, so prose is not the record"), extended from the QUESTION side to the
 * ANSWER side.
 *
 * TWO MARKERS, TWO DIFFERENT JOBS — read together, never one alone (identical shape to
 * tools/lib/migration-grant.js, which this module is modelled on):
 *   - a LABEL (`decision-recorded`, tools/lib/labels.js) — makes a recorded decision a cheap
 *     `gh issue list --label` query, and — the load-bearing half — applying a label on GitHub
 *     requires triage/write permission, so a drive-by comment on this public repo cannot
 *     manufacture a decision merely by posting well-formed text.
 *   - a COMMENT (this module's DECISION_MARK/REOPEN_MARK) — carries what a label cannot: WHO
 *     ruled (never the typist — mirrors `Filed-by:`, CONVENTIONS.md §5 *Provenance*), WHAT
 *     `<!-- decision:options -->` block (if any) it answers, and WHEN. The comment is the
 *     authority; the label is the gate.
 *
 * Both are required for a decision to read as live (evaluateIssue, below) — a label with no
 * live comment is exactly the state a rolled-back/failed write leaves, and must refuse, not
 * "recorded".
 *
 * PURE BY CONSTRUCTION, same posture as migration-grant.js / readiness.js / landed.js /
 * shipguard.js: signals in, verdict out. No git, no network, no `gh`.
 *
 * WHO IS ALLOWED TO WRITE THE COMMENT is a DIFFERENT question from who is allowed to APPLY
 * the label, and this module answers only the second by requiring TRUSTED_ASSOCIATIONS on
 * read — the same hole migration-grant.js closes, for the same public-repo reason. Unlike
 * `colab migration-grant` / `colab ci-grant` / `colab promote`, `colab decision --record` is
 * deliberately NOT gated on COLAB_HUMAN=1: those three AUTHORIZE a write to production or
 * trunk that did not exist before the command ran; this one TRANSCRIBES a call a human
 * already made elsewhere (the ordinary case is `Filed-by: boss` — an agent recording Boss's
 * ruling, not inventing one). The safety property is carried by requiring `ruledBy` (no
 * default) plus TRUSTED_ASSOCIATIONS on read, not by gating who may type the command. If that
 * is judged too weak in review, requiring COLAB_HUMAN=1 here too is the safe direction and
 * costs one line in tools/colab — flagged, not decided, by this module.
 */

/** The two comment markers. STABLE WIRE FORMAT — do not reword casually; `tools/colab` and any
 *  vendored reader parse these verbatim, the same posture as GRANT_MARK/REVOKE_MARK. */
const DECISION_MARK = '⚖ Decision recorded';
const REOPEN_MARK = '↩ Decision reopened';

// Deliberately DIFFERENT leading glyph (not just different trailing text) — mirrors
// migration-grant.js's GRANT_RE/REVOKE_RE split, and for the identical reason: a reopen mark
// that merely suffixed the decision mark would make every reopen parse as a fresh decision,
// silently reopening exactly the door it was posted to close.
const DECISION_RE = /^⚖ Decision recorded — ruled-by `([^`]*)` · answers `([^`]*)` · host `([^`]*)` · (\S+)/;
const REOPEN_RE = /^↩ Decision reopened — ruled-by `([^`]*)` · host `([^`]*)` · (\S+)/;

/**
 * The exact decision-comment body. Keep in lockstep with DECISION_RE.
 * `ruledBy` names the human whose call it is — never the typist (mirrors `Filed-by:`).
 * `answers` is the `<!-- decision:options -->` block reference this decision resolves
 * (a comment URL/id), or `-` when there was no options block to answer.
 * `body`, if given, is the ruling prose appended below the marker line — chosen option, why,
 * what was rejected (CONVENTIONS.md §5, design conclusions' Unit 1).
 */
function decisionCommentBody(ruledBy, answers, host, iso, body) {
  const head = `${DECISION_MARK} — ruled-by \`${ruledBy}\` · answers \`${answers || '-'}\` · host \`${host}\` · ${iso}`;
  return body ? `${head}\n\n${body}` : head;
}

/** The exact reopen-comment body. Keep in lockstep with REOPEN_RE. Reopening is NOT scoped to
 *  the same `ruledBy` — see liveDecisions doc below for why. */
function reopenCommentBody(ruledBy, host, iso, reason) {
  const head = `${REOPEN_MARK} — ruled-by \`${ruledBy}\` · host \`${host}\` · ${iso}`
    + ' — every decision on this issue up to this point is superseded.';
  return reason ? `${head}\n\n${reason}` : head;
}

/**
 * Every DECISION_MARK comment not cancelled by a LATER REOPEN_MARK — whoever posted the
 * reopen. Deliberately NOT author-scoped, same reasoning as migration-grant's liveGrants: a
 * decision is not a race between identities the way a claim is, it is a standing record a
 * human is meant to be able to reopen from any trusted account, on any machine.
 *
 * Sort is by `createdAt` (GitHub's own timestamp, authoritative — never comment array order).
 * A decision AFTER the latest reopen is live again: decide, reopen, decide is "currently
 * decided," not "permanently reopened."
 *
 * Returns [{ruledBy, answers, host, at, login, authorAssociation}], oldest-first — a caller
 * wanting the current verdict takes the LAST entry; the full list serves `colab decision
 * --list`, which shows history, not just the verdict.
 */
function liveDecisions(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  let lastReopenAt = null;
  for (const c of sorted) {
    const body = String(c.body || '').trim();
    if (REOPEN_RE.test(body)) {
      if (lastReopenAt === null || c.createdAt > lastReopenAt) lastReopenAt = c.createdAt;
    }
  }

  const live = [];
  for (const c of sorted) {
    const body = String(c.body || '').trim();
    const m = body.match(DECISION_RE);
    if (!m) continue;
    const at = c.createdAt;
    const cancelled = lastReopenAt !== null && lastReopenAt > at;
    if (cancelled) continue;
    live.push({
      ruledBy: m[1],
      answers: m[2],
      host: m[3],
      at,
      login: (c.author && c.author.login) || '',
      authorAssociation: c.authorAssociation || '',
    });
  }
  return live;
}

/** Association values GitHub reports (`authorAssociation`) trustworthy enough to write a
 *  record a scheduled driver will rely on. Same set, same reasoning, as
 *  migration-grant.js's TRUSTED_ASSOCIATIONS — re-exported from there rather than duplicated,
 *  so the two never drift about who counts as trusted. */
const { TRUSTED_ASSOCIATIONS } = require('./migration-grant.js');

/** True when `comments` carries at least one live (non-reopened) DECISION_MARK from a
 *  trusted association. Does not check labels — pure comment-side signal, for a caller that
 *  wants "was this actually answered" independent of whatever label state it finds. */
function hasRecordedDecision(comments) {
  return liveDecisions(comments).some((d) => TRUSTED_ASSOCIATIONS.has(d.authorAssociation));
}

/** The `<!-- decision:options -->` block references every live decision on this issue claims
 *  to answer, most-recent-last, `'-'` entries filtered out. Lets a caller cross-check a
 *  decision against the options block it names, when one exists (CONVENTIONS.md §5,
 *  *Decision options*, which #126 finally wrote — until then this comment cited
 *  code-triage/SKILL.md, which has never contained the convention: the format was
 *  implemented here and specified nowhere). */
function answeredOptionRefs(comments) {
  return liveDecisions(comments)
    .filter((d) => TRUSTED_ASSOCIATIONS.has(d.authorAssociation) && d.answers && d.answers !== '-')
    .map((d) => d.answers);
}

/**
 * One issue's readiness verdict — the function `code-triage` (or any reader deciding whether
 * to apply/keep `needs-decision`) calls. `labels` is the issue's label list (bare strings or
 * `{name}` objects, same tolerant shape as tools/lib/labels.js); `comments` is what
 * `gh issue view --json comments` returns, or `[]`/`null` when unavailable — never treat a
 * failed read as "no decision"; that is the caller's job to distinguish, this function only
 * reports what it was given.
 *
 * Returns `{ recorded, gated, contradiction, decisions }`:
 *   - `recorded`      — a live, trusted DECISION_MARK exists (comment-side truth).
 *   - `gated`         — `needs-decision` label is present.
 *   - `contradiction` — BOTH true at once: the exact #127 failure state, now nameable. A
 *                        caller finding this should resolve toward "decided" (the label is
 *                        stale) and say so, never silently pick one.
 *   - `decisions`     — the full liveDecisions() list, for a caller that wants to show detail.
 */
function evaluateIssue({ labels, comments } = {}) {
  const labelNames = new Set(
    (labels || []).map((l) => (l && typeof l === 'object' ? l.name : l)),
  );
  const decisions = liveDecisions(comments).filter((d) => TRUSTED_ASSOCIATIONS.has(d.authorAssociation));
  const recorded = decisions.length > 0;
  const gated = labelNames.has('needs-decision');
  return { recorded, gated, contradiction: recorded && gated, decisions };
}

module.exports = {
  DECISION_MARK, REOPEN_MARK, DECISION_RE, REOPEN_RE,
  decisionCommentBody, reopenCommentBody,
  liveDecisions, TRUSTED_ASSOCIATIONS,
  hasRecordedDecision, answeredOptionRefs,
  evaluateIssue,
};
