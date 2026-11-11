'use strict';
/**
 * Close a container with its last child (#371) — the pure half.
 *
 * THE DEFECT. A dependency review of one adopting repo's open backlog found five open
 * containers (epics) whose every child was closed, and one of them still carried a
 * `delivery:code` label. Nothing closed them: a child's squash-merge closes the CHILD (its
 * `Closes #N`), and `code-ship` B2c said "never close the epic" — a rule written for
 * hand-maintained checklists, where boxes running out does not prove work running out. On
 * NATIVE sub-issues that reasoning is weaker (GitHub maintains `subIssuesSummary`, so "every
 * child is closed" is a fact, not a hand-kept claim), and an open container nobody will ever
 * close is backlog noise every triage pass re-reads.
 *
 * THE RULE THIS MODULE DECIDES (CONVENTIONS.md §5, *Epics*): after a ship closes an issue, look
 * at its native parent. Close the parent, with evidence, in the same step, when ALL hold:
 *
 *   - it is a container — carries the `epic` label (the label is normative; a title prefix or a
 *     sub-issue count only corroborates, CONVENTIONS.md §5 *Epics*);
 *   - it has native sub-issues and every one of them is closed;
 *   - its body holds no unticked checklist line. An unticked `- [ ]` on an epic is an item
 *     somebody listed and nobody filed as a sub-issue yet — the "two phases whose issues are not
 *     written yet" B2c's rule was protecting. It is reported, never closed over;
 *   - its body states no `Done when` acceptance (#713). `file-issues` tells a filer to put an
 *     epic's end state in a `Done when:` line, never a body checklist — so on an epic written to
 *     that convention the unticked check above sees nothing, and a phase epic filed with only its
 *     design child (the code children to be filed once the design is approved) read as spent the
 *     moment that one child shipped. "Every filed child closed" says nothing about whether the
 *     stated end state holds; that reading is the coordinator's, so ship proposes and never closes;
 *   - it is not a release tracking record (`<!-- colab:release …` body) — `colab release
 *     finalize` owns that record's lifecycle, not a child's ship.
 *
 * A parent WITHOUT the `epic` label whose sub-issues are all closed is a FINDING, not a close:
 * it may be a real task that merely has children, and whether it is done is a human's reading.
 *
 * VERDICTS (every one but `close` leaves the parent exactly as it is):
 *
 *   close            all conditions above hold
 *   unknown          the parent could not be read — never "nothing to do", never closed
 *   already-closed   nothing to do
 *   release-record   a release tracking issue — owned by `colab release finalize`
 *   no-sub-issues    no native children (a hand checklist at most) — B2c's limits still apply
 *   children-open    at least one sub-issue is still open — the normal state of a live epic
 *   not-container    every child closed, but no `epic` label — report for a human
 *   unfiled-items    every child closed, but the body still lists unticked items — report
 *   done-when        every child closed, but the body states `Done when` acceptance — ship posts
 *                    a one-line proposal for the coordinator to check it and close (#713)
 *
 * Fail toward keeping open, the same asymmetry `group-labels.js` states for its own delete: a
 * container closed early buries unwritten work behind a closed issue nobody browses, while one
 * left open costs a line in the next triage report.
 */

const { DELIVERY_LABEL_PREFIX } = require('./labels.js');

const EPIC_LABEL = 'epic';

/** A release tracking issue's body opens with this marker (`colab release finalize`, #339). */
const RELEASE_RECORD_RE = /^\s*<!--\s*colab:release\b/;

/** An UNTICKED GitHub checklist line anywhere in the body — `- [ ] …` / `* [ ] …`. */
const UNTICKED_RE = /^\s*[-*]\s*\[ \]\s*(.+)$/;

/**
 * A `Done when` acceptance statement at the start of a line (#713): a heading (`## Done when`), a
 * label line (`Done when:`, `**Done when:**`, `- Done when: …`), any case, `Done-when` too. Only at
 * a line start, so prose that merely mentions the phrase mid-sentence does not count; a blockquote
 * (`> Done when`) is a quotation, not this epic's own acceptance.
 */
const DONE_WHEN_RE = /^\s*(?:#{1,6}\s+)?(?:[-*+]\s+)?(?:\*\*|__)?done[ -]when\b/i;

function labelNames(labels) {
  return (labels || []).map((l) => (l && typeof l === 'object' ? l.name : l)).map((n) => String(n));
}

/** The unticked checklist lines in a body, trimmed, in document order. Fenced code is skipped —
 *  a `- [ ]` inside a ``` block is an example someone quoted, not an item they listed. */
function untickedItems(body) {
  const out = [];
  let fenced = false;
  for (const line of String(body || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = UNTICKED_RE.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Does the body state `Done when` acceptance outside fenced code? (#713) */
function hasDoneWhen(body) {
  let fenced = false;
  for (const line of String(body || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (!fenced && DONE_WHEN_RE.test(line)) return true;
  }
  return false;
}

/**
 * Classify ONE parent issue after a child of it closed.
 *
 * @param {object|null} parent  `gh issue view <P> --json number,state,labels,body,subIssuesSummary`,
 *                              or null when that read failed (never "no parent" — the caller
 *                              only calls this once it knows a parent exists).
 * @returns {{verdict:string, number:number|null, total:number, completed:number, unticked:string[]}}
 */
function classifyContainer(parent) {
  const base = { number: null, total: 0, completed: 0, unticked: [] };
  if (!parent || typeof parent !== 'object') return { ...base, verdict: 'unknown' };
  const number = Number.isInteger(parent.number) ? parent.number : null;
  const s = parent.subIssuesSummary;
  const total = s && Number.isInteger(s.total) ? s.total : null;
  const completed = s && Number.isInteger(s.completed) ? s.completed : null;
  const out = { ...base, number, total: total || 0, completed: completed || 0 };

  if (String(parent.state || '').toUpperCase() === 'CLOSED') return { ...out, verdict: 'already-closed' };
  // Anything we cannot prove is open-and-well-formed is `unknown`: a missing state or summary is
  // a read we did not get, and the bias is toward leaving the container alone.
  if (String(parent.state || '').toUpperCase() !== 'OPEN' || total === null || completed === null || number === null) {
    return { ...out, verdict: 'unknown' };
  }
  if (RELEASE_RECORD_RE.test(String(parent.body || ''))) return { ...out, verdict: 'release-record' };
  if (total === 0) return { ...out, verdict: 'no-sub-issues' };
  if (completed < total) return { ...out, verdict: 'children-open' };
  if (!labelNames(parent.labels).includes(EPIC_LABEL)) return { ...out, verdict: 'not-container' };
  const unticked = untickedItems(parent.body);
  if (unticked.length) return { ...out, unticked, verdict: 'unfiled-items' };
  if (hasDoneWhen(parent.body)) return { ...out, verdict: 'done-when' };
  return { ...out, verdict: 'close' };
}

/**
 * `delivery:*` labels on a container — a finding (#371): a container has no deliverable of its
 * own, so a delivery label on one says a scheduler may treat the map as the territory. Returns the
 * offending label names ([] when the issue is not an epic, or carries none).
 */
function containerDeliveryLabels(labels) {
  const names = labelNames(labels);
  if (!names.includes(EPIC_LABEL)) return [];
  return names.filter((n) => n.startsWith(DELIVERY_LABEL_PREFIX));
}

/** The evidence comment posted on a container as it is closed. One line, issue-specific only. */
function containerCloseComment({ child, sha, total, target }) {
  const via = child ? `its last open sub-issue #${child} shipped` : 'its last open sub-issue closed';
  const at = sha ? ` to ${target || 'trunk'} at ${sha}` : '';
  return `📦 Closed by colab ship — ${via}${at}; all ${total} sub-issue(s) are closed and the body lists no unticked item (#371).`;
}

/**
 * The proposal comment posted on an epic whose verdict is `done-when` (#713) — the epic stays OPEN.
 * One line, issue-specific only: which child emptied it, and what the coordinator checks next.
 */
function containerProposalComment({ child, sha, total, target }) {
  const via = child ? `its last open sub-issue #${child} shipped` : 'its last open sub-issue closed';
  const at = sha ? ` to ${target || 'trunk'} at ${sha}` : '';
  return `📋 All ${total} sub-issue(s) closed — ${via}${at}. Left open: check \`Done when\` and close if met, or file the remaining work as sub-issues (#713).`;
}

/** One report line for a verdict that is NOT `close` but still worth a human's eye; null otherwise. */
function containerFinding(c) {
  const n = c.number !== null ? `#${c.number}` : 'parent';
  switch (c.verdict) {
    case 'not-container':
      return `${n}: all ${c.total} sub-issue(s) closed, but it is not labelled \`epic\` — close it by hand if it is a container`;
    case 'unfiled-items':
      return `${n}: all ${c.total} sub-issue(s) closed, but ${c.unticked.length} unticked item(s) remain in its body — file them as sub-issues or tick them, then close`;
    case 'done-when':
      return `${n}: all ${c.total} sub-issue(s) closed, but its body states \`Done when\` — left open for the coordinator to check it`;
    case 'unknown':
      return `${n}: could not read the parent — container close skipped`;
    default:
      return null;
  }
}

/**
 * `owner/repo` from an issue's web URL (`https://<host>/<owner>/<repo>/issues/<n>`), lowercased —
 * GitHub slugs are case-insensitive. null when the URL is absent or not that shape.
 */
function issueRepoSlug(url) {
  const m = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/issues\/\d+\/?$/.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

/**
 * Is a native parent in the CHILD's own repository (#502)? A sub-issue may have a parent in another
 * repository, and `gh issue view <number>` in the child's repo then reads either nothing or an
 * UNRELATED issue that happens to share the number — one that could be classified, and closed.
 * So a parent is looked up by number only when both URLs prove it lives where the child does.
 *
 * @param {object} childView  the child's view, carrying `url` and `parent` ({ number, url })
 * @returns {{relation:'same'|'other'|'unknown', slug:string|null, number:number|null}}
 *   `other` carries the parent's `owner/repo`; `unknown` means a URL was missing or unparseable —
 *   fail toward leaving the parent alone, the module's asymmetry.
 */
function parentRelation(childView) {
  const parent = childView && childView.parent;
  const number = parent && Number.isInteger(parent.number) ? parent.number : null;
  const childSlug = issueRepoSlug(childView && childView.url);
  const parentSlug = issueRepoSlug(parent && parent.url);
  if (!childSlug || !parentSlug) return { relation: 'unknown', slug: parentSlug, number };
  return { relation: childSlug === parentSlug ? 'same' : 'other', slug: parentSlug, number };
}

/** One report line for a parent that is not looked up in the child's repo (#502); null for `same`. */
function parentRelationFinding(rel) {
  const n = rel.number !== null ? `#${rel.number}` : 'parent';
  if (rel.relation === 'other') return `${rel.slug}${n} is in another repository — not evaluated`;
  if (rel.relation === 'unknown') return `${n}: could not tell which repository the parent is in (no issue URL) — not evaluated`;
  return null;
}

module.exports = {
  EPIC_LABEL, RELEASE_RECORD_RE, DONE_WHEN_RE,
  issueRepoSlug, parentRelation, parentRelationFinding,
  untickedItems, hasDoneWhen, classifyContainer, containerDeliveryLabels, containerCloseComment,
  containerProposalComment, containerFinding,
};
