'use strict';
/**
 * Spent `group:<key>` label classification (#85) — the pure half.
 *
 * `colab ship`'s B4 teardown (#82) deletes a group label the moment the branch it shipped
 * closed the group's last member. That is the right trigger for anything shipped from now
 * on, and it is deliberately narrow: it can only ever consider labels carried by the issues
 * THAT branch closed. Two populations therefore escape it permanently —
 *
 *   1. groups whose members all closed BEFORE the teardown feature existed, and
 *   2. groups closed by any route other than `ship` (a hand merge, a bulk close, a transfer).
 *
 * Nothing revisits either, because the only trigger is a ship and these groups have no
 * unshipped members left to trigger one. This module is the back-fill's decision layer: it
 * takes a label and its membership and returns a verdict, with no I/O of its own so the
 * rules can be pinned by tests rather than exercised against a live tracker.
 *
 * FOUR VERDICTS, and the boundaries between them are the whole point:
 *
 *   spent       >=1 member, none open. The label bound a real group and that group is
 *               finished. Safe to delete — this is exactly B4's condition, reached late.
 *   empty       0 members. Semantically spent (it binds nothing, and a label binds issues
 *               only at grouping time) but NOT safe to delete — see the note below.
 *   mid-flight  >=1 open member. A group part-closed is the NORMAL state of a group being
 *               worked. Reporting it would be reporting rot that is not rot, and a doctor
 *               that cries wolf is a doctor people stop reading. Never reported.
 *   unknown     membership could not be read. Never deleted, never counted clean — a failed
 *               lookup must not read as "no members" (the same contract ghIssueListByLabel
 *               states for its own null return).
 *
 * WHY `empty` IS REPORTED BUT NEVER AUTO-PRUNED. Two different histories produce a label
 * with no members, and GitHub cannot tell them apart: (a) every member was deleted or
 * transferred away — genuinely spent, and (b) a triage session created the label seconds ago
 * and has not applied it to its members yet — genuinely LIVE. The GitHub labels API exposes
 * no creation timestamp, so there is no age by which to separate them; a `--prune` that
 * deleted case (b) would break a grouping while it was being formed, and the session doing
 * the forming would get no error — its later `--add-label` would simply recreate a label
 * stripped of the description that carried the group's rationale. Deleting is destructive and
 * unrecoverable-in-kind; leaving it costs one line of doctor output. So `empty` is surfaced
 * for a human and never acted on. This is the question #85 asked to have decided; this is the
 * answer, and the asymmetry of the two error costs is the reason for it.
 */

const { isGroupLabel, groupLabelNames } = require('./labels.js');

/**
 * Is this member record open? Tolerant of shape (`gh` returns 'OPEN'/'CLOSED', but a caller
 * may hand us a bare string) and DELIBERATELY conservative about anything it does not
 * recognise: an unrecognised state counts as OPEN, which keeps the label alive.
 *
 * The bias is not arbitrary. The two ways to be wrong here are not symmetric — a false
 * "open" leaves a spent label on the tracker until the next run (cosmetic, self-correcting),
 * while a false "closed" is what makes a live group label deletable, and a deleted label
 * cannot be restored with the members it bound. Fail toward keeping.
 */
function isOpenMember(m) {
  const raw = m && typeof m === 'object' ? m.state : m;
  if (raw === undefined || raw === null) return true; // no state field → cannot prove closed
  return String(raw).toUpperCase() !== 'CLOSED';
}

/**
 * Classify ONE group label from its membership.
 *
 * @param {string} name    the label, e.g. `group:import-fixes`
 * @param {Array|null} members  every issue carrying it, in ANY state, as returned by
 *                              ghIssueListByLabel(repo, name, 'all', ['number','state']).
 *                              null means the lookup FAILED — not that there are none.
 * @returns {{name:string, verdict:string, total:number, open:number, members:number[]}}
 */
function classifyGroupLabel(name, members) {
  if (!isGroupLabel(name)) {
    // The bare prefix ("group:" with no key) names no group; isGroupLabel already guards it.
    // Anything else handed here is a caller bug, and answering 'unknown' keeps it undeletable.
    return { name, verdict: 'unknown', total: 0, open: 0, members: [] };
  }
  if (members === null || members === undefined) {
    return { name, verdict: 'unknown', total: 0, open: 0, members: [] };
  }
  const list = Array.isArray(members) ? members : [];
  const open = list.filter(isOpenMember).length;
  const nums = list
    .map((m) => (m && typeof m === 'object' ? m.number : m))
    .filter((n) => n !== undefined && n !== null);
  if (list.length === 0) return { name, verdict: 'empty', total: 0, open: 0, members: [] };
  if (open === 0) return { name, verdict: 'spent', total: list.length, open: 0, members: nums };
  return { name, verdict: 'mid-flight', total: list.length, open, members: nums };
}

/**
 * Classify every group label on a repo.
 *
 * @param {Array|null} allLabels  every label name defined on the tracker (ghListLabels), or
 *                                null on failure — which yields [] rather than a guess.
 * @param {(name:string)=>Array|null} lookupMembers  membership for one label. Injected so
 *                                this stays pure and the tests need no network.
 * @returns {Array} one verdict per group label, in the order the tracker listed them.
 */
function classifyGroupLabels(allLabels, lookupMembers) {
  if (!allLabels) return [];
  return groupLabelNames(allLabels).map((name) => classifyGroupLabel(name, lookupMembers(name)));
}

/** The labels a `--prune` may delete: `spent` only. Never `empty`, never `unknown`. */
function deletableLabels(verdicts) {
  return (verdicts || []).filter((v) => v && v.verdict === 'spent');
}

/**
 * What a human should be shown: everything except `mid-flight`, which is a healthy state and
 * must not be reported as rot. Keeps the reporting rule in one place so the CLI cannot drift
 * from the tests.
 */
function reportableLabels(verdicts) {
  return (verdicts || []).filter((v) => v && v.verdict !== 'mid-flight');
}

/**
 * #448: the second read before a destructive delete. Measured in an adopting repo: ship's (i)
 * teardown deleted `group:<key>` while a fourth, deliberately-unshipped member still carried it
 * OPEN — the open-member listing had come back empty 29 s after the squash closed the other three.
 * That listing is `gh issue list --label`, which `gh` serves through GraphQL `search(...)`
 * (verified with GH_DEBUG=api), and the search index lags the issues table: a burst of closes and
 * label writes can leave it answering "0 open" for a label still on an open issue.
 *
 * `gh label delete` is repo-wide and cannot be undone per issue, so "0 open" from search alone is
 * not enough to act on. The confirming read is the REST issues list (`ghOpenIssueNumbersByLabel`),
 * which reads the issues table, not the index. The two failures are asymmetric exactly as
 * isOpenMember's note says — keeping a spent label costs one stale picker entry until the next
 * ship or `doctor --sync --prune`; deleting a live one strips a grouping from work in flight — so
 * every case but "both reads agree on zero" keeps the label.
 *
 * @param {Array|null} searchOpen   open members per the search-backed listing; null = could not read
 * @param {Array|null} confirmOpen  open member NUMBERS per the non-search read; null = could not read
 * @returns {{action:'delete'|'keep', reason:string, open:number[]}}
 *   reason ∈ unread · open · unconfirmed · disagree · spent
 */
function spentLabelDecision(searchOpen, confirmOpen) {
  if (searchOpen === null || searchOpen === undefined) return { action: 'keep', reason: 'unread', open: [] };
  if (Array.isArray(searchOpen) && searchOpen.length > 0) return { action: 'keep', reason: 'open', open: [] };
  if (confirmOpen === null || confirmOpen === undefined || !Array.isArray(confirmOpen)) {
    return { action: 'keep', reason: 'unconfirmed', open: [] };
  }
  if (confirmOpen.length > 0) {
    const nums = confirmOpen.map((m) => (m && typeof m === 'object' ? m.number : m))
      .filter((n) => n !== undefined && n !== null);
    return { action: 'keep', reason: 'disagree', open: nums };
  }
  return { action: 'delete', reason: 'spent', open: [] };
}

/**
 * The I/O shell around spentLabelDecision, with every call injected so the delete path is pinned by
 * a test with no network (#448). `searchOpen` may be passed pre-read (doctor already has the
 * membership from its classify pass) or as a function; `confirmOpen` and `deleteLabel` are always
 * functions and are only CALLED when needed — the confirm read only when search said zero, the
 * delete only when both reads agree.
 *
 * @returns {{action:'delete'|'keep', reason:string, open:number[], deleted:boolean, error:string|null}}
 */
function teardownSpentGroupLabel(name, { searchOpen, confirmOpen, deleteLabel }) {
  if (!isGroupLabel(name)) return { action: 'keep', reason: 'unread', open: [], deleted: false, error: null };
  const s = typeof searchOpen === 'function' ? searchOpen(name) : searchOpen;
  const needConfirm = Array.isArray(s) && s.length === 0;
  const c = needConfirm ? confirmOpen(name) : null;
  const d = spentLabelDecision(s, needConfirm ? c : null);
  if (d.action !== 'delete') return { ...d, deleted: false, error: null };
  const r = deleteLabel(name) || {};
  return { ...d, deleted: !!r.ok, error: r.ok ? null : (r.stderr || 'gh label delete failed') };
}

/** One human line for a kept label — the CLI and its test read the same words. */
function keptReason(name, d) {
  switch (d.reason) {
    case 'unread': return `could not check membership of ${name} — left in place`;
    case 'unconfirmed': return `${name} reads 0 open members by search but the confirming (non-search) read failed — left in place`;
    case 'disagree': return `${name} reads 0 open members by search, but #${d.open.join(', #')} still carr${d.open.length === 1 ? 'ies' : 'y'} it open (non-search read) — left in place; the search index is lagging (#448)`;
    default: return '';
  }
}

module.exports = {
  isOpenMember, classifyGroupLabel, classifyGroupLabels, deletableLabels, reportableLabels,
  spentLabelDecision, teardownSpentGroupLabel, keptReason,
};
