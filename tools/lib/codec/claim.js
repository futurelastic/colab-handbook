'use strict';
/**
 * CODEC (#497, epic #496): the claim/release comment WIRE FORMAT as encode/decode pairs. Pure and
 * synchronous — no I/O, no clock, no requires — so it can be shared as code with any consumer that
 * reads or writes the same comments. The readers built on it (which claims still stand, who wins a
 * race) stay in tools/lib/claim-comments.js; the writers that need the clock, the machine id and the
 * tracker stay in tools/colab and call `encodeClaim` / `encodeRelease` here.
 *
 * These strings are a STABLE WIRE FORMAT: the refusal path, the tie-break, and dashboards grep
 * them, and an older colab on another machine parses what this one writes. `codec/samples.json`
 * holds real, scrubbed comments; the test requires every one to survive encode(decode(s)) byte for
 * byte. Change a byte here and that test is what tells you an older reader just broke.
 */

const CLAIM_MARK = '🔒 Claimed';
const RELEASE_MARK = '✅ Released';
// Parses a claim comment body back into {worktree, branch, host, at}. The `· <host>` field is
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
 * Does `v` look like a session URL / `session_…` id rather than a display name? A SHAPE heuristic
 * (#306), not a gate — claim-identity.js re-exports this one copy of it.
 */
function looksLikeSessionId(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  // #528: a derived person identity (`claim-identity.js` `derivePersonSession`) is a session id
  // too — a stable join key, not a display name — so it reads back as one from a claim comment.
  return /^https?:\/\//.test(s) || /session_[\w-]+/.test(s) || /^person:\S+$/.test(s);
}

/**
 * Encode the `· session <field>` tail of a claim comment. Both → a markdown link; url only → the
 * legacy bare form; name only → the bare name; neither → nothing.
 */
function encodeSessionField(session, sessionName) {
  if (sessionName && session) return ` · session [${sessionName}](${session})`;
  if (session) return ` · session ${session}`;
  if (sessionName) return ` · session ${sessionName}`;
  return '';
}

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
  if (looksLikeSessionId(v)) return { sessionName: '', session: v };
  return { sessionName: v, session: '' };
}

/** `{login, host, session}` → `login@host[#session]` — the identity string a yield names. */
function encodeIdentity({ login, host, session } = {}) {
  return `${login}@${host}${session ? `#${session}` : ''}`;
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
 * The exact claim-comment body. Every field is written as given: `worktree`/`branch` default to `-`
 * ("none" — it used to be the word `trunk`, which read as a branch that never existed, #53); `at`
 * is the caller's ISO timestamp (the codec holds no clock); `machine` is the `m:` digest or empty
 * (#327, the field is then omitted); `host` is the raw hostname or its `h:` token, whichever the
 * destination allows (#369 — deciding that is the caller's job, not the codec's).
 */
function encodeClaim({ worktree, branch, host, at, machine, session, sessionName } = {}) {
  const base = `${CLAIM_MARK} — worktree \`${worktree || '-'}\` · branch \`${branch || '-'}\` · host \`${host}\` · ${at}`;
  const mach = machine ? ` · machine \`${machine}\`` : '';
  return base + mach + encodeSessionField(session, sessionName);
}

/**
 * A claim comment body → { worktree, branch, host, at, machine, session, sessionName }, or null when
 * the body carries no claim. Lenient exactly where the readers always were (CLAIM_RE is unanchored,
 * a legacy comment simply lacks machine/session), and lossless on what `encodeClaim` writes:
 * `worktree`/`branch` keep a literal `-` rather than mapping it to empty, so the pair round-trips.
 */
function decodeClaim(body) {
  const str = String(body == null ? '' : body).trim();
  const m = str.match(CLAIM_RE);
  if (!m) return null;
  const mm = str.match(MACHINE_RE);
  const { session, sessionName } = parseSessionField(str);
  return { worktree: m[1], branch: m[2], host: m[3], at: m[4], machine: mm ? mm[1] : '', session, sessionName };
}

/**
 * A release comment body. `{}` → the plain marker (`colab release`, `worktree rm`); `{ winner }` →
 * a yield naming the winner's identity string. `rest` is any text after the marker (or after the
 * yield's closing parenthesis) — a hand-written release keeps its prose through a round trip.
 */
function encodeRelease({ winner, rest } = {}) {
  const tail = rest || '';
  if (winner) return `${RELEASE_MARK} (yielded — earlier claim by ${winner} wins)${tail}`;
  return RELEASE_MARK + tail;
}

/**
 * A release comment body → { kind: 'yield', winner, rest } | { kind: 'release', rest }, or null when
 * the body is not a release. `winner` is the raw identity string (`parseIdentity` splits it).
 */
function decodeRelease(body) {
  const str = String(body == null ? '' : body).trim();
  if (!str.startsWith(RELEASE_MARK)) return null;
  const y = str.match(YIELD_RE);
  if (y) return { kind: 'yield', winner: y[1], rest: str.slice(y[0].length) };
  return { kind: 'release', rest: str.slice(RELEASE_MARK.length) };
}

module.exports = {
  CLAIM_MARK, RELEASE_MARK, CLAIM_RE, SESSION_RE, MACHINE_RE, YIELD_RE,
  looksLikeSessionId,
  encodeSessionField, parseSessionField,
  encodeIdentity, parseIdentity,
  encodeClaim, decodeClaim,
  encodeRelease, decodeRelease,
};
