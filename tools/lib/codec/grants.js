'use strict';
/**
 * CODEC (#498, epic #496): the GRANT comment wire formats as encode/decode pairs — the human
 * migration grant and its revoke, the reviewer migration grant with its fenced record, the
 * red-trunk CI grant and its revoke, and the reviewer red-trunk CI grant with its fenced record
 * (#504). Pure and synchronous: no I/O, no clock, no requires.
 *
 * What stays OUT of here is everything that JUDGES a grant: which grants are live, whose comment is
 * trusted, whether a record passes review, whether a grant still binds a HEAD. That lives in
 * tools/lib/migration-grant.js and tools/lib/ci-grant.js, which re-export the names below under the
 * names they always had.
 *
 * STABLE WIRE FORMAT. `tools/colab` and any vendored reader parse these verbatim, and an older CLI on
 * another machine reads what this one writes. Every mark has a DIFFERENT leading emoji from every
 * other (🛢 🚫 🔎 🚨 🧯 🩹), so no regex here can match another mark's body — a revoke that merely
 * suffixed its grant would parse as a fresh grant and reopen the door it was posted to close.
 *
 * Round-trip rule shared by every pair below: a decoded comment carries `tail`, the text after the
 * timestamp on the marker line. `tail: null` means "exactly the sentence this toolkit writes", so a
 * canonical comment decodes compactly; any other tail is kept literally, so a hand-edited comment
 * still re-encodes byte for byte.
 */

// ── human migration grant / revoke ───────────────────────────────────────────────────────────

const MIGRATION_GRANT_MARK = '🛢 Migration grant';
const MIGRATION_REVOKE_MARK = '🚫 Migration grant revoked';
const MIGRATION_GRANT_RE = /^🛢 Migration grant — branch `([^`]*)` · host `([^`]*)` · (\S+)/;
const MIGRATION_REVOKE_RE = /^🚫 Migration grant revoked — branch `([^`]*)` · host `([^`]*)` · (\S+)/;
const MIGRATION_GRANT_TAIL = ' — this exempts THIS BRANCH only, and expires when this issue closes.';
const REVOKE_TAIL = ' — every grant on this issue up to this point is cancelled.';

function str(body) { return String(body == null ? '' : body).trim(); }
function tailOf(s, m, canonical) { const t = s.slice(m[0].length); return t === canonical ? null : t; }
function withTail(head, tail, canonical) { return head + (tail == null ? canonical : tail); }

/** `{branch, host, at, tail?}` → the grant comment. `host` is the raw name or its `h:` token. */
function encodeMigrationGrant({ branch, host, at, tail } = {}) {
  return withTail(`${MIGRATION_GRANT_MARK} — branch \`${branch}\` · host \`${host}\` · ${at}`, tail, MIGRATION_GRANT_TAIL);
}
/** A grant comment → `{branch, host, at, tail}`, or null when the body is not one. */
function decodeMigrationGrant(body) {
  const s = str(body);
  const m = s.match(MIGRATION_GRANT_RE);
  return m ? { branch: m[1], host: m[2], at: m[3], tail: tailOf(s, m, MIGRATION_GRANT_TAIL) } : null;
}
/** `{branch, host, at, tail?}` → the revoke comment. The branch is for the audit trail only. */
function encodeMigrationRevoke({ branch, host, at, tail } = {}) {
  return withTail(`${MIGRATION_REVOKE_MARK} — branch \`${branch}\` · host \`${host}\` · ${at}`, tail, REVOKE_TAIL);
}
function decodeMigrationRevoke(body) {
  const s = str(body);
  const m = s.match(MIGRATION_REVOKE_RE);
  return m ? { branch: m[1], host: m[2], at: m[3], tail: tailOf(s, m, REVOKE_TAIL) } : null;
}

// ── reviewer migration grant (#457 era): a marker line plus a fenced `migration-review` record ──

const REVIEW_GRANT_MARK = '🔎 Migration review grant';
const REVIEWER_ROLE = 'migration-reviewer';
const REVIEW_GRANT_RE = /^🔎 Migration review grant — role `([^`]*)` · reviewer `([^`]*)` · branch `([^`]*)` · head `([^`]*)` · host `([^`]*)` · (\S+)/;
const REVIEW_GRANT_TAIL = ' — bound to this HEAD: any new commit voids it; expires when this issue closes.';
/** The fenced block's info string — the record is found by it, never by position. */
const REVIEW_RECORD_FENCE = 'migration-review';
const REVIEW_RECORD_VERSION = '1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const REVIEWER_ID_RE = /^[A-Za-z0-9._@-]+$/;
const CONDITION_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Every key a v1 record may carry, and what each accepts. `required: false` keys may be absent.
 *  Order here is the order `encodeReviewGrant` writes them in — part of the wire format. */
const REVIEW_RECORD_FIELDS = Object.freeze([
  { key: 'v', required: true, values: [REVIEW_RECORD_VERSION] },
  { key: 'role', required: true, values: [REVIEWER_ROLE] },
  { key: 'reviewer', required: true, re: REVIEWER_ID_RE, hint: 'letters, digits, . _ @ -' },
  { key: 'head', required: true, re: SHA40_RE, hint: 'a full 40-hex commit sha' },
  { key: 'verdict', required: true, values: ['approve', 'reject'] },
  { key: 'checklist', required: true, values: ['pass', 'fail'] },
  { key: 'checklist-items', required: false, re: /^\d+\/\d+$/, hint: 'N/M, e.g. 7/7' },
  { key: 'escalation', required: true, re: CONDITION_ID_RE, hint: 'a condition id, lowercase-hyphenated' },
  { key: 'escalation-result', required: true, values: ['clear', 'escalated'] },
  { key: 'ci-roundtrip', required: true, values: ['pass', 'fail', 'pending'] },
  { key: 'ci-run', required: false, re: /^\S+$/, hint: 'a run id or URL, no spaces' },
]);

/**
 * `{role, reviewer, branch, head, host, at, tail?, record}` → marker line, blank line, fenced
 * record. Record keys are written in REVIEW_RECORD_FIELDS order, then any other key in the object's
 * own order; an empty/absent value is omitted. Validating the record is the caller's job
 * (migration-grant.js `validateReviewRecord`) — the codec writes what it is given.
 */
function encodeReviewGrant({ role, reviewer, branch, head, host, at, tail, record } = {}) {
  const marker = withTail(`${REVIEW_GRANT_MARK} — role \`${role}\` · reviewer \`${reviewer}\` · branch \`${branch}\``
    + ` · head \`${head}\` · host \`${host}\` · ${at}`, tail, REVIEW_GRANT_TAIL);
  return `${marker}\n\n${fencedRecord(REVIEW_RECORD_FENCE, REVIEW_RECORD_FIELDS, record)}`;
}

/**
 * A reviewer-grant comment → `{role, reviewer, branch, head, host, at, tail, record, problems}`, or
 * null when the first line is not a reviewer-grant marker. The record is the FIRST fenced block whose
 * info string is exactly `migration-review`; text outside it is ignored. `problems` holds SYNTAX
 * findings only (no block, a line that is not `key: value`, a duplicate key) — whether the record's
 * values are acceptable is migration-grant.js's `validateReviewRecord`, never the codec's.
 */
function decodeReviewGrant(body) {
  const text = String(body == null ? '' : body).replace(/\r\n/g, '\n').trim();
  const m = text.match(REVIEW_GRANT_RE);
  if (!m) return null;
  const nl = text.indexOf('\n');
  const line = nl === -1 ? text : text.slice(0, nl);
  const t = line.slice(m[0].length);
  const out = { role: m[1], reviewer: m[2], branch: m[3], head: m[4], host: m[5], at: m[6],
    tail: t === REVIEW_GRANT_TAIL ? null : t, record: null, problems: [] };
  return readFencedRecord(text, REVIEW_RECORD_FENCE, out);
}

/** Find the FIRST fenced block whose info string is exactly `fence` and read its `key: value`
 *  lines into `out.record`; syntax findings go to `out.problems`. Shared by both reviewer grants. */
function readFencedRecord(text, fence, out) {
  const re = new RegExp('^```' + fence + '[ \\t]*\\n([\\s\\S]*?)^```[ \\t]*$', 'm');
  const fm = text.match(re);
  if (!fm) {
    out.problems.push(`no \`\`\`${fence} block — a reviewer grant without its review record is not a grant`);
    return out;
  }
  const record = {};
  for (const raw of fm[1].split('\n')) {
    const l = raw.trim();
    if (l === '') continue;
    const kv = l.match(/^([a-z][a-z-]*):\s*(.*)$/);
    if (!kv) { out.problems.push(`record line ${JSON.stringify(l)} is not "key: value"`); continue; }
    if (Object.prototype.hasOwnProperty.call(record, kv[1])) { out.problems.push(`"${kv[1]}" appears twice`); continue; }
    record[kv[1]] = kv[2].trim();
  }
  out.record = record;
  return out;
}

/** Record object → its fenced lines: `fields` order first, then any other key in the object's own
 *  order; an empty/absent value is omitted. Shared by both reviewer grants. */
function fencedRecord(fence, fields, rec) {
  const r = rec || {};
  const known = fields.map((f) => f.key);
  const keys = [...known.filter((k) => Object.prototype.hasOwnProperty.call(r, k)),
    ...Object.keys(r).filter((k) => !known.includes(k))];
  const lines = [];
  for (const k of keys) {
    const v = r[k];
    if (v === undefined || v === null || String(v) === '') continue;
    lines.push(`${k}: ${v}`);
  }
  return `\`\`\`${fence}\n${lines.join('\n')}\n\`\`\``;
}

// ── red-trunk CI grant / revoke ───────────────────────────────────────────────────────────────

const CI_GRANT_MARK = '🚨 Red-trunk CI grant';
const CI_REVOKE_MARK = '🧯 Red-trunk CI grant revoked';
const CI_GRANT_RE = /^🚨 Red-trunk CI grant — branch `([^`]*)` · red `([^`]*)`@`([^`]*)` · evidence `([^`]*)` · host `([^`]*)` · (\S+)/;
const CI_REVOKE_RE = /^🧯 Red-trunk CI grant revoked — branch `([^`]*)` · host `([^`]*)` · (\S+)/;

/** The CI grant's canonical tail names the trunk and the red sha it was reviewed against. */
function ciGrantTail(trunk, redSha) {
  return ` — this exempts THIS BRANCH from the trunk-CI-green precondition ONLY, only while \`${trunk}\``
    + ` is still at \`${redSha}\`, and expires when this issue closes.`;
}

/** `{branch, trunk, redSha, evidenceSha, host, at, tail?}` → the CI grant comment. */
function encodeCiGrant({ branch, trunk, redSha, evidenceSha, host, at, tail } = {}) {
  return withTail(`${CI_GRANT_MARK} — branch \`${branch}\` · red \`${trunk}\`@\`${redSha}\` · evidence \`${evidenceSha}\``
    + ` · host \`${host}\` · ${at}`, tail, ciGrantTail(trunk, redSha));
}
function decodeCiGrant(body) {
  const s = str(body);
  const m = s.match(CI_GRANT_RE);
  if (!m) return null;
  return { branch: m[1], trunk: m[2], redSha: m[3], evidenceSha: m[4], host: m[5], at: m[6],
    tail: tailOf(s, m, ciGrantTail(m[2], m[3])) };
}
function encodeCiRevoke({ branch, host, at, tail } = {}) {
  return withTail(`${CI_REVOKE_MARK} — branch \`${branch}\` · host \`${host}\` · ${at}`, tail, REVOKE_TAIL);
}
function decodeCiRevoke(body) {
  const s = str(body);
  const m = s.match(CI_REVOKE_RE);
  return m ? { branch: m[1], host: m[2], at: m[3], tail: tailOf(s, m, REVOKE_TAIL) } : null;
}

// ── reviewer red-trunk CI grant (#504): a marker line plus a fenced `ci-review` record ─────────
//
// The coordinator agent's door through a red trunk the cure rule refuses (maintainer ruling
// 2026-10-05). Same shape as the reviewer migration grant: a declared reviewer, a review record,
// bound to one HEAD. It additionally names the red trunk sha it reviewed against (a grant must never
// survive into a different red) and the red checks it claims to cure. Leading glyph 🩹, distinct from
// every other mark here.

const CI_REVIEW_GRANT_MARK = '🩹 Red-trunk CI review grant';
const CI_REVIEWER_ROLE = 'ci-reviewer';
const CI_REVIEW_GRANT_RE = /^🩹 Red-trunk CI review grant — role `([^`]*)` · reviewer `([^`]*)` · branch `([^`]*)` · head `([^`]*)` · red `([^`]*)`@`([^`]*)` · host `([^`]*)` · (\S+)/;
const CI_REVIEW_GRANT_TAIL = ' — bound to this HEAD and this red trunk sha: a new commit on either voids it; expires when this issue closes.';
const CI_REVIEW_RECORD_FENCE = 'ci-review';
const CI_REVIEW_RECORD_VERSION = '1';
/** `cures:` is a `; `-separated list of red check names (`workflow / job`, or a bare job name) —
 *  `;`, not `,`, because matrix job names carry commas (`test (ubuntu, 22)`). */
const CI_CURES_SEPARATOR = ';';

/** Every key a v1 `ci-review` record may carry. Order is the order the encoder writes them in. */
const CI_REVIEW_RECORD_FIELDS = Object.freeze([
  { key: 'v', required: true, values: [CI_REVIEW_RECORD_VERSION] },
  { key: 'role', required: true, values: [CI_REVIEWER_ROLE] },
  { key: 'reviewer', required: true, re: REVIEWER_ID_RE, hint: 'letters, digits, . _ @ -' },
  { key: 'head', required: true, re: SHA40_RE, hint: 'a full 40-hex commit sha' },
  { key: 'red', required: true, re: SHA40_RE, hint: 'the full 40-hex red trunk sha reviewed against' },
  { key: 'verdict', required: true, values: ['pass', 'fail'] },
  { key: 'cures', required: true, re: /^[^;\s][^;]*(;\s*[^;\s][^;]*)*$/, hint: 'red check names, "; "-separated' },
  { key: 'not-before', required: false, re: /^\d{4}-\d{2}-\d{2}T\S+$/, hint: 'an ISO-8601 instant' },
  { key: 'ci-run', required: false, re: /^\S+$/, hint: 'a run id or URL, no spaces' },
]);

/** `{role, reviewer, branch, head, trunk, redSha, host, at, tail?, record}` → marker line, blank
 *  line, fenced `ci-review` record. Validation is ci-grant.js's job; the codec writes what it gets. */
function encodeCiReviewGrant({ role, reviewer, branch, head, trunk, redSha, host, at, tail, record } = {}) {
  const marker = withTail(`${CI_REVIEW_GRANT_MARK} — role \`${role}\` · reviewer \`${reviewer}\` · branch \`${branch}\``
    + ` · head \`${head}\` · red \`${trunk}\`@\`${redSha}\` · host \`${host}\` · ${at}`, tail, CI_REVIEW_GRANT_TAIL);
  return `${marker}\n\n${fencedRecord(CI_REVIEW_RECORD_FENCE, CI_REVIEW_RECORD_FIELDS, record)}`;
}

/** A CI review-grant comment → `{role, reviewer, branch, head, trunk, redSha, host, at, tail, record,
 *  problems}`, or null when the first line is not one. `problems` holds SYNTAX findings only. */
function decodeCiReviewGrant(body) {
  const text = String(body == null ? '' : body).replace(/\r\n/g, '\n').trim();
  const m = text.match(CI_REVIEW_GRANT_RE);
  if (!m) return null;
  const nl = text.indexOf('\n');
  const line = nl === -1 ? text : text.slice(0, nl);
  const t = line.slice(m[0].length);
  const out = { role: m[1], reviewer: m[2], branch: m[3], head: m[4], trunk: m[5], redSha: m[6], host: m[7], at: m[8],
    tail: t === CI_REVIEW_GRANT_TAIL ? null : t, record: null, problems: [] };
  return readFencedRecord(text, CI_REVIEW_RECORD_FENCE, out);
}

module.exports = {
  MIGRATION_GRANT_MARK, MIGRATION_REVOKE_MARK, MIGRATION_GRANT_RE, MIGRATION_REVOKE_RE,
  encodeMigrationGrant, decodeMigrationGrant, encodeMigrationRevoke, decodeMigrationRevoke,
  REVIEW_GRANT_MARK, REVIEW_GRANT_RE, REVIEWER_ROLE, REVIEW_RECORD_FENCE, REVIEW_RECORD_VERSION, REVIEW_RECORD_FIELDS,
  encodeReviewGrant, decodeReviewGrant,
  CI_GRANT_MARK, CI_REVOKE_MARK, CI_GRANT_RE, CI_REVOKE_RE,
  encodeCiGrant, decodeCiGrant, encodeCiRevoke, decodeCiRevoke,
  CI_REVIEW_GRANT_MARK, CI_REVIEW_GRANT_RE, CI_REVIEWER_ROLE, CI_REVIEW_RECORD_FENCE, CI_REVIEW_RECORD_VERSION,
  CI_REVIEW_RECORD_FIELDS, CI_CURES_SEPARATOR, encodeCiReviewGrant, decodeCiReviewGrant,
};
