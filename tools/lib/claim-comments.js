'use strict';
/**
 * The claim-comment WIRE FORMAT and the two readers built on it: `liveClaimComments` (which
 * `🔒 Claimed` comments still stand) and `tieBreakVerdict` (who wins a simultaneous claim race).
 * Moved out of tools/colab by #369/#375 so both rules are unit-testable as pure functions — the
 * same split every other tools/lib module keeps from its caller. tools/colab keeps the writers
 * (`claimCommentBody`, `postClaimComment`, `postReleaseComment`, `yieldIssue`) because they need
 * the clock, the machine id and the tracker.
 *
 * These strings are a STABLE WIRE FORMAT: the refusal path, the tie-break, and dashboards grep
 * them. Do not reword casually — an older colab on another machine parses what this one writes.
 */

const claimIdentity = require('./claim-identity');
const machine = require('./machine');

const CLAIM_MARK = '🔒 Claimed';
const RELEASE_MARK = '✅ Released';
// Parses a claim comment body back into {worktree, branch, host, date}. The `· <host>` field is
// what lets the tie-break tell two machines of the SAME GitHub user apart. On a public destination
// it carries an opaque `h:` token instead of the raw name (#369, machine.js `hostToken`) — same
// field, same position, so this regex and every older parser read both shapes. The optional
// trailing `· session <value>` (added 2026-07) is captured separately by SESSION_RE so this regex
// stays byte-stable for session-less comments.
const CLAIM_RE = /🔒 Claimed — worktree `([^`]*)` · branch `([^`]*)` · host `([^`]*)` · (\S+)/;
// The `· session <field>` tail, captured as the rest of the line. parseSessionField() then decodes
// the THREE shapes it can take — `[name](url)`, a bare URL, or a bare name — plus the legacy
// plain-URL form written before sessionName existed.
const SESSION_RE = /· session (.+)$/;
// #327: the claimant's machine, as the public `m:` digest (tools/lib/machine.js `machineToken`),
// written AFTER the timestamp and BEFORE the session suffix — so CLAIM_RE's four groups and
// SESSION_RE's end anchor both parse a new comment exactly as they parse a legacy one, and a legacy
// comment (no such field) simply has no machine and is compared by host.
const MACHINE_RE = /· machine `(m:[0-9a-f]{12})`/;
// A yield: the loser of a race releases, naming the winner by its identity string
// (`claimIdentity.identityString` — `login@host`, or `login@host#session` under the fine setting).
const YIELD_RE = /^✅ Released \(yielded — earlier claim by (.+?) wins\)/;

/**
 * Decode the `· session <field>` tail of a claim comment into { sessionName, session }. Accepts:
 *   `[name](url)`  → both;  bare `https://…`/`session_…` → url only;  any other bare token → name.
 * The bare-URL branch is exactly the LEGACY format written before sessionName existed, so old
 * comments keep parsing. Returns empty strings when there is no session tail.
 */
function parseSessionField(body) {
  const m = String(body).match(SESSION_RE);
  if (!m) return { sessionName: '', session: '' };
  const v = m[1].trim();
  const link = v.match(/^\[([^\]]*)\]\((.*)\)$/);
  if (link) return { sessionName: link[1], session: link[2] };
  // #306: the shape test lives in claimIdentity.looksLikeSessionId — one copy of the rule.
  if (claimIdentity.looksLikeSessionId(v)) return { sessionName: '', session: v };
  return { sessionName: v, session: '' };
}

/** `login@host[#session]` → its parts. Logins cannot contain `@`, hosts cannot contain `#`. */
function parseIdentity(s) {
  const str = String(s || '').trim();
  const at = str.indexOf('@');
  if (at <= 0) return null;
  const rest = str.slice(at + 1);
  const hash = rest.indexOf('#');
  return {
    login: str.slice(0, at),
    host: hash === -1 ? rest : rest.slice(0, hash),
    session: hash === -1 ? '' : rest.slice(hash + 1),
  };
}

/**
 * Is claim `c` the one a yield NAMED as its winner? Login exact, host by `sameHostName` (so a
 * yield naming the `h:` token matches a claim that carried the raw name, and the reverse), session
 * only when both sides carry one — the named identity was built under the yielder's granularity,
 * which need not be the reader's.
 */
function isNamedWinner(c, named) {
  if (!named || c.login !== named.login) return false;
  if (!machine.sameHostName(c.host, named.host)) return false;
  if (named.session && c.session && named.session !== c.session) return false;
  return true;
}

/**
 * Every `✅ Released` on the issue, classified. `yield` carries the named winner; `release` is a
 * plain release (`colab release`, `worktree rm`, a hand-typed one).
 */
function releaseComments(sorted) {
  const out = [];
  for (const c of sorted) {
    const body = String(c.body || '').trim();
    if (!body.startsWith(RELEASE_MARK)) continue;
    const login = (c.author && c.author.login) || '';
    const y = body.match(YIELD_RE);
    if (y) out.push({ kind: 'yield', login, at: c.createdAt, winner: parseIdentity(y[1]) });
    else out.push({ kind: 'release', login, at: c.createdAt });
  }
  return out;
}

/**
 * Live claim comments on an issue. Returns [{login, host, machine, session, sessionName, at,
 * identity}], `at` = the comment's real GitHub createdAt (authoritative, sub-second). `identity`
 * is built from `comps` (claim-identity.js `components()`, #267); the raw fields are returned too
 * for callers that need `sameClaimant`'s degrade-on-missing comparison.
 *
 * A claim is CANCELLED by a later release, under two rules (#375):
 *
 *   1. A PLAIN `✅ Released` cancels every claim posted before it, WHOEVER posted either. A plain
 *      release is `colab release` / `worktree rm` / a human's own, and since #363 colab's release
 *      removes `in-progress` and unassigns whichever account applied it — the claim is over at the
 *      label layer no matter whose it was, so the comment layer must agree. Keying this on the
 *      release's AUTHOR (the pre-#375 rule) left a claim released under a second account live in
 *      the comments forever; 24 days later it "won" a race against a fresh claim on free work.
 *      The cost the issue named — a stray release cancelling a genuinely live claim — is the cost
 *      the label layer already pays for that same release, not a new one.
 *   2. A YIELD (`✅ Released (yielded — earlier claim by <id> wins)`) cancels only its own AUTHOR's
 *      earlier claims, and never the claim it named as the winner. A yield is one racer standing
 *      down; it is not a release of the issue. Under the author-keyed rule a same-account yield
 *      (machine Y yielding to machine X of one login) also cancelled X's WINNING claim, so the
 *      layer that the cross-machine refusal (#325) reads went blank the moment X won.
 *
 * Pure function of the comment list: every reader of the same comments computes the same live
 * set, which is what `tieBreakVerdict`'s convergence rests on. Alternatives weighed:
 * docs/adr/375-release-cancels-any-earlier-claim.md.
 */
function liveClaimComments(comments, comps) {
  comps = comps || claimIdentity.DEFAULT_COMPONENTS;
  const sorted = [...(comments || [])].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const releases = releaseComments(sorted);
  const live = [];
  for (const c of sorted) {
    const body = String(c.body || '').trim();
    const m = body.match(CLAIM_RE);
    if (!m) continue;
    const login = (c.author && c.author.login) || '';
    const host = m[3];
    const { session, sessionName } = parseSessionField(body); // handles [name](url) / url / name / legacy
    const mm = body.match(MACHINE_RE); // #327 — absent on a legacy comment: compared by host
    const machineTok = mm ? mm[1] : '';
    const at = c.createdAt;
    const entry = { login, host, machine: machineTok, session, sessionName, at };
    const cancelled = releases.some((r) => r.at > at && (r.kind === 'release'
      || (r.login === login && !isNamedWinner(entry, r.winner))));
    if (!cancelled) live.push({ ...entry, identity: claimIdentity.identityString({ login, host, session }, comps) });
  }
  return live;
}

/**
 * Deterministic verdict on the simultaneous-claim race. Given the issue's comments and our own
 * identity (`myLogin`/`myHost`/`mySession`/`myMachine`): if a live claim that is NOT us under
 * `comps` (`sameClaimant`, #267) is EARLIER than our own earliest live claim → we lost (returns the
 * winner). Exact-timestamp ties break on identity string (lexicographically smaller identity wins),
 * so both racers, reading the same comments, reach the same verdict independently.
 *
 * `myHost` is the RAW hostname; our own comment may carry its `h:` token (#369, public
 * destination) — `sameClaimant` → `sameHost` → `sameHostName` matches the two.
 *
 * Anchors on our EARLIEST live claim, not the latest (#264/#267 together): a re-claim that corrects
 * a record posts a SECOND comment from us, and anchoring on the latest of those would let that
 * correction restart our own priority — costing us a race we had already won.
 */
function tieBreakVerdict(comments, myLogin, myHost, mySession, comps, myMachine = null) {
  comps = comps || claimIdentity.DEFAULT_COMPONENTS;
  const live = liveClaimComments(comments, comps);
  const me = { login: myLogin, host: myHost, session: mySession || '', machine: myMachine || '' };
  const mine = live
    .filter((c) => claimIdentity.sameClaimant(c, me, comps))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))[0]; // our EARLIEST live claim
  if (!mine) return { lost: false }; // our own comment not visible yet → don't yield to a phantom
  let winner = null;
  for (const c of live) {
    if (claimIdentity.sameClaimant(c, me, comps)) continue; // never yield to ourselves
    const earlier = c.at < mine.at || (c.at === mine.at && c.identity < mine.identity);
    if (!earlier) continue;
    if (!winner || c.at < winner.at || (c.at === winner.at && c.identity < winner.identity)) winner = c;
  }
  return winner ? { lost: true, winner } : { lost: false };
}

/**
 * The yield comment body. `redact` (#369: the destination may not name a host) swaps the winner's
 * host for its `h:` token — the winner's own comment may predate redaction and carry the raw name,
 * and a yield must not republish it. `isNamedWinner` matches either spelling back.
 */
function yieldReleaseBody(winner, { redact = false } = {}) {
  let id = winner.identity;
  if (redact) {
    const head = `${winner.login}@${winner.host}`;
    const tail = id.startsWith(head) ? id.slice(head.length) : '';
    id = `${winner.login}@${machine.hostToken(winner.host)}${tail}`;
  }
  return `${RELEASE_MARK} (yielded — earlier claim by ${id} wins)`;
}

module.exports = {
  CLAIM_MARK, RELEASE_MARK, CLAIM_RE, SESSION_RE, MACHINE_RE, YIELD_RE,
  parseSessionField, parseIdentity, isNamedWinner, liveClaimComments, tieBreakVerdict, yieldReleaseBody,
};
