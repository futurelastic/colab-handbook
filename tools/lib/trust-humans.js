'use strict';
/**
 * `trust-humans:` (#407): an optional repo policy naming which logins count as HUMAN for a grant
 * (migration-grant, ci-grant) or a ruling (decision-record).
 *
 * WHY. Those readers judged an author by `authorAssociation` alone (OWNER/MEMBER/COLLABORATOR).
 * That class cannot tell a separate agent account from the human: once an adopter gives its agents
 * their own GitHub login with write access, the agent's comments report `MEMBER` exactly like the
 * operator's, and a well-formed grant comment the agent posted reads as a human grant. The account
 * difference exists on the platform; these readers threw it away. This module keeps it.
 *
 * THE RULE.
 *   - key absent → today's behaviour, byte-identical: a trusted association is human enough.
 *   - key present → an author counts as human only when their login is LISTED (case-insensitive —
 *     GitHub logins are) AND their association is still trusted. The association check stays on
 *     purpose: a listed person who has since lost repo access is not someone whose grant a
 *     scheduled driver should act on.
 *   - key present but malformed (not a list, empty, a non-login entry) → fail CLOSED: nobody counts
 *     as human, and the audit fails the descriptor. Falling back to the association class would
 *     silently reopen exactly the hole the adopter declared the key to close.
 *
 * WHAT IT DOES NOT DECIDE. Reviewer grants (#397/#401) are judged by policy + review record + HEAD
 * + round-trip, not by this list — the list says what a *human* grant is. And WHERE the list is read
 * from is the caller's job: always trunk's (or the merge target's) committed project.yml, never the
 * branch being shipped, so a branch cannot add its own author (tools/colab `trustAt`).
 *
 * PURE, like its callers: parsed doc in, verdict out. No git, no network.
 */

/** GitHub's login shape: alphanumerics and single hyphens, no leading hyphen, ≤ 39 chars. Bot
 *  logins carry a `[bot]` suffix; accepted so an adopter can list one deliberately. */
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;

/** Same set every grant reader has used since #98 — the association gate this module keeps. */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/** The project.yml key. A FLAT key holding a list — not `trust: { humans: [...] }` — for the same
 *  reason `migration-grant:` is flat (#398): the audit's descriptor reader refuses nesting on
 *  purpose (a named allow-list of one-level maps, never a list inside one), and this key is a list. */
const KEY = 'trust-humans';

/**
 * `trust-humans:` from a parsed project.yml → { declared, valid, humans, reason }.
 *   humans — a Set of lowercased logins when declared (EMPTY when invalid: fail closed), or null
 *            when the key is absent (the association class decides, as before).
 * Both list spellings parse identically: `trust-humans: [a, b]` and a `- a` block sequence.
 */
function parseTrustHumans(doc) {
  const has = !!doc && typeof doc === 'object' && Object.prototype.hasOwnProperty.call(doc, KEY);
  const list = has ? doc[KEY] : undefined;
  if (!has || list === null || list === undefined) {
    return { declared: false, valid: true, humans: null, reason: `${KEY} absent — a trusted association counts as human` };
  }
  const bad = (why) => ({ declared: true, valid: false, humans: new Set(),
    reason: `${KEY} ${why} — read as "nobody is human" until fixed (a malformed list never falls back to the association class)` });
  if (!Array.isArray(list)) return bad(`must be a list of logins, got ${JSON.stringify(list)}`);
  if (list.length === 0) return bad('is an empty list');
  const wrong = list.filter((l) => typeof l !== 'string' || !LOGIN_RE.test(l.trim()));
  if (wrong.length) return bad(`has entr${wrong.length > 1 ? 'ies' : 'y'} that ${wrong.length > 1 ? 'are' : 'is'} not a GitHub login: ${wrong.map((w) => JSON.stringify(w)).join(', ')}`);
  const humans = new Set(list.map((l) => l.trim().toLowerCase()));
  return { declared: true, valid: true, humans, reason: `${KEY}: ${[...humans].join(', ')}` };
}

/**
 * Whether one comment author counts as human. `author` = { login, authorAssociation } (the shape
 * every grant/decision reader already extracts). `trust` = parseTrustHumans(...)'s result, or
 * null/undefined for "not supplied" — identical to absent.
 * Returns { ok, reason } — `reason` is '' when ok, and otherwise names the login.
 */
function authorIsHuman(author, trust) {
  const login = String((author && author.login) || '');
  const assoc = String((author && author.authorAssociation) || '');
  const assocOk = TRUSTED_ASSOCIATIONS.has(assoc);
  const who = `${login || '(unknown)'} (${assoc || 'unknown association'})`;
  if (!trust || !trust.declared) {
    return assocOk ? { ok: true, reason: '' } : { ok: false, reason: `${who} — not a repo owner/member/collaborator` };
  }
  if (!login) return { ok: false, reason: `the author could not be read — trust-humans is set, and an unknown author is never human` };
  if (!trust.humans || !trust.humans.has(login.toLowerCase())) {
    return { ok: false, reason: `${who} is not listed in trust-humans${trust.valid ? '' : ' (the list is malformed, so nobody is)'}` };
  }
  if (!assocOk) return { ok: false, reason: `${who} is listed in trust-humans but is no longer a repo owner/member/collaborator` };
  return { ok: true, reason: '' };
}

/**
 * The label half (#407 Wanted 2): who applied the grant label. Only consulted when trust-humans is
 * DECLARED — absent key, no extra read, no change. `actors` = the logins of every `labeled` event
 * for the label, oldest-first (tools/lib/git.js ghIssueLabelActors), or null when that read failed.
 * The LATEST applier decides — a label re-added by an agent after a human's is the agent's label.
 * Returns { ok, reason }.
 */
function labelApplierIsHuman(actors, trust, labelName) {
  if (!trust || !trust.declared) return { ok: true, reason: '' };
  if (!Array.isArray(actors)) return { ok: false, reason: `who applied \`${labelName}\` could not be read — trust-humans is set, and an unread applier is never human` };
  if (actors.length === 0) return { ok: false, reason: `no \`labeled\` event for \`${labelName}\` could be found — trust-humans is set, and a label nobody can be shown to have applied is not a human's` };
  const last = String(actors[actors.length - 1] || '');
  if (!last || !trust.humans || !trust.humans.has(last.toLowerCase())) {
    return { ok: false, reason: `\`${labelName}\` was last applied by ${last || '(unknown)'}, who is not listed in trust-humans` };
  }
  return { ok: true, reason: '' };
}

module.exports = { KEY, LOGIN_RE, TRUSTED_ASSOCIATIONS, parseTrustHumans, authorIsHuman, labelApplierIsHuman };
