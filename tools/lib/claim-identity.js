'use strict';
/**
 * Claim-record IDENTITY shape — the single decision #264 and #267 both need, so the writer
 * (`cmdClaim`, tools/colab) and the two readers (`tieBreakVerdict` in claim-comments.js,
 * `ghClaimConflicts` in tools/colab) apply ONE rule instead of two independently-evolving ones. Full design in
 * `.claude/plans/issue-264.md` (issues #264, #267); this module holds only the decidable, pure
 * parts — the same split every other tools/lib/*.js module keeps from its tools/colab caller
 * (records.js, place.js, solo.js, blocked-by.js, …).
 *
 * TWO FIELD CLASSES on a claim record:
 *   - IDENTITY — login, host, session: who holds it. Compared by the readers. A re-claim may
 *     REPLACE these (a real new holder truthfully overwrites), but a blank incoming value never
 *     BLANKS a known one recorded by the SAME holder.
 *   - PAYLOAD  — branch, sessionName: cached convenience, never compared. `branch` is additionally
 *     MONOTONIC — a blank incoming value never overwrites a known one from the same holder either,
 *     because "no branch recorded" and "branch known but omitted this call" must not collapse to
 *     the same `-` on the wire (#264).
 *   - `worktree` is in NEITHER class — it is never inherited across a merge. Its absence is the
 *     meaningful trunk-checkout shape (#133/#136/#237); silently carrying a previous worktree name
 *     forward would misrepresent an intentional trunk-checkout claim as still attached to one.
 *
 * IDENTITY GRANULARITY (#267): `liveClaimComments`/`tieBreakVerdict` used to build identity from
 * only `login@host`, hardcoded — so two sessions of one account on one host are indistinguishable,
 * and the tie-break's own "never yield to ourselves" clause then treats a co-tenant's live claim as
 * our own. `components()` reads a configurable, whitelisted set instead: `login,host` (default,
 * unchanged behaviour) or `login,host,session` (opt-in, distinguishes co-tenants). Kept a KNOB
 * rather than made default, because a session id that is not stable across a restart/resume turns
 * that session's OWN earlier claim comment into a "different" claimant, which then yields to
 * itself — a property of session-management deployment, not of this tool.
 *
 * DEGRADE-ON-MISSING is what makes the fine setting safe to turn on at all: `sameClaimant` compares
 * `session` only when BOTH sides carry a non-empty one. Without this, turning the knob on would
 * make every legacy/session-less claim comment from our own login@host read as a stranger, and any
 * such comment still live (never released) would instantly win every future race.
 */

const machine = require('./machine');
const { machineLabel } = require('./branch-name');

const DEFAULT_COMPONENTS = Object.freeze(['login', 'host']);
const FINE_COMPONENTS = Object.freeze(['login', 'host', 'session']);

const IDENTITY_SETS = {
  'login,host': DEFAULT_COMPONENTS,
  'login,host,session': FINE_COMPONENTS,
};

/**
 * Validation for `colab config set claimIdentity <value>` — refuse a typo before it is ever
 * written, rather than silently degrading later at read time. `""` is valid (unsets → default,
 * same "absent, not falsy" discipline as `notifyUrl`/`journal`).
 */
function claimIdentityProblem(value) {
  if (value === '' || value === undefined || value === null) return null;
  if (Object.prototype.hasOwnProperty.call(IDENTITY_SETS, value)) return null;
  return `claimIdentity must be "login,host" or "login,host,session" (or "" to unset), got ${JSON.stringify(value)}`;
}

/**
 * The active identity components for THIS invocation. Absent config, or any value that somehow
 * reached disk invalid (a hand-edited config.json, an older/newer colab's different valid set)
 * both degrade quietly to the coarse default — a bad config file must never brick `claim`. A
 * caller that wants to WARN about an invalid-on-disk value runs `claimIdentityProblem` itself on
 * the raw `cfg.claimIdentity`; this function never throws and never logs, matching every other
 * pure function in tools/lib.
 */
function components(cfg) {
  const raw = cfg && typeof cfg.claimIdentity === 'string' ? cfg.claimIdentity.trim() : '';
  if (!raw) return DEFAULT_COMPONENTS;
  return IDENTITY_SETS[raw] || DEFAULT_COMPONENTS;
}

/**
 * Human-legible identity string for messages and the `identity` field `tieBreakVerdict` sorts
 * exact-timestamp ties on. Coarse: `login@host`. Fine WITH a session on this entry:
 * `login@host#session`. Fine but this entry itself carries no session (a legacy comment): same as
 * coarse — there is nothing finer to show, and inventing a trailing `#` would misrepresent a
 * comment that never had one.
 */
function identityString(entry, comps) {
  const login = (entry && entry.login) || '';
  const host = (entry && entry.host) || '';
  const session = (entry && entry.session) || '';
  const base = `${login}@${host}`;
  if (comps && comps.includes('session') && session) return `${base}#${session}`;
  return base;
}

/**
 * Is `s` a PLANNER INTENT id rather than a session (#326)? A planner running on every machine
 * claims an issue BEFORE it spawns the session that will do the work, with `--session
 * intent:<id>`; the spawned session's own claim later replaces that value with its real one. An
 * intent id therefore never identifies a session, and must never be compared as one.
 */
function isIntentSession(s) {
  return /^intent:\S/.test(String(s == null ? '' : s).trim());
}

/**
 * Should a blank session be DERIVED for a person at a plain terminal (#528)? Only when nothing was
 * said at all: `COLAB_SESSION` is UNSET (an explicit `COLAB_SESSION=''` is a deliberate "present no
 * identity" and is honoured as one), and the shell is not an agent's (`CLAUDECODE=1` / `AI_AGENT`,
 * the same signal `place.resolveAnchor` reads). An agent keeps #242's refusal: two concurrent agent
 * sessions on one machine would derive the SAME person id, and `place.conflict`'s same-holder
 * exemption would then read one session's hold as the other's — the collision #242 exists to stop.
 * A person running several units at once from separate shells has the same problem, which is why
 * the README tells them to give each shell its own `COLAB_SESSION`.
 */
function shouldDerivePersonSession(env) {
  const e = env || {};
  if (Object.prototype.hasOwnProperty.call(e, 'COLAB_SESSION')) return false;
  if (e.CLAUDECODE === '1' || e.AI_AGENT) return false;
  return true;
}

/**
 * The derived identity for a person (#528): `person:<who>/<hostToken>`, where `<who>` is git's
 * `user.email`, else the OS user. The host is the opaque `h:` token (`machine.hostToken`), never
 * the raw name: this value is written verbatim into claim comments, and a public tracker must not
 * learn a machine's name from it (#369). Stable across invocations — the same person on the same
 * machine always derives the same value, which is what a re-acquire needs. '' when no `<who>` or
 * no host is available: then nothing is derived and the blank-session paths apply unchanged.
 */
function derivePersonSession({ email, user, hostToken } = {}) {
  const who = String(email || '').trim() || String(user || '').trim();
  const host = String(hostToken || '').trim();
  if (!who || !host || /\s/.test(who)) return '';
  return `person:${who}/${host}`;
}

/** Is `s` a derived person identity (#528)? */
function isPersonSession(s) {
  return /^person:\S+$/.test(String(s == null ? '' : s).trim());
}

/**
 * Are `a` and `b` on the SAME machine (#327)? Both carry a `machine` → compare those (a raw id or
 * the `m:` digest a claim comment carries — `machineToken` makes the two comparable); raw ids of
 * DIFFERENT schemes (one machine resolving `iokit:` in one process and the MAC fallback in another)
 * cannot be compared, so they fall through, exactly as `machine.js` `sameMachineWith` does.
 * Otherwise → `canonHost`, so `devbox.local`, `Devbox.` and `devbox.lan` read as one machine: raw
 * `os.hostname()` spells one machine two ways, and a string compare used to split it into two
 * claimants. Blank on both sides compares equal, matching the pre-#327 `'' === ''`.
 */
function sameHost(a, b) {
  const am = String((a && a.machine) || '').trim();
  const bm = String((b && b.machine) || '').trim();
  if (am && bm) {
    const digested = /^m:/.test(am) || /^m:/.test(bm);
    if (digested) return machine.machineToken(am) === machine.machineToken(bm);
    if (machineScheme(am) === machineScheme(bm)) return am === bm;
  }
  // #369: a host field may be an `h:` token (a comment on a public destination) — sameHostName
  // compares tokens then, and canonHost exactly as before otherwise.
  return machine.sameHostName(a && a.host, b && b.host);
}

function machineScheme(id) {
  const i = id.indexOf(':');
  return i === -1 ? '' : id.slice(0, i);
}

/**
 * Could `a` and `b` be the SAME factory (#743)? Two teams may work one repository under one forge
 * login (`.github/factories.yml`, #739), so a login match alone no longer names a holder: a claim
 * that names factory `x` and one that names `y` are two holders, whatever login posted them. Like
 * the session (DEGRADE-ON-MISSING above), the factory decides only when BOTH sides carry one — a
 * comment written before #743, or on a repository with no factories file, names none, and must not
 * turn our own earlier claim into a stranger's. Not behind the claimIdentity knob: the factories
 * file is itself the adopter's declaration that factories are distinct holders.
 */
function sameFactory(a, b) {
  const af = String((a && a.factory) || '').trim();
  const bf = String((b && b.factory) || '').trim();
  return !af || !bf || af === bf;
}

/**
 * Are `a` and `b` the SAME claimant under `comps`? `login` and the machine (`sameHost`, #327) are
 * always required to match — they are the baseline every component set includes — and so is the
 * factory where both name one (`sameFactory`, #743). `session`
 * sharpens the match ONLY when `comps` includes it AND both sides carry a non-empty value that is a
 * real session; either side blank, or either side a planner intent id (#326 — replaced by the real
 * session at spawn, so it is not a different claimant), degrades that pair back to the coarse
 * comparison (see the module doc's DEGRADE-ON-MISSING note).
 */
function sameClaimant(a, b, comps) {
  if (!a || !b) return false;
  if ((a.login || '') !== (b.login || '')) return false;
  if (!sameFactory(a, b)) return false;
  if (!sameHost(a, b)) return false;
  if (comps && comps.includes('session') && a.session && b.session
    && !isIntentSession(a.session) && !isIntentSession(b.session)) {
    return a.session === b.session;
  }
  return true;
}

/**
 * The #264 merge rule for writing a claim record. `existing` is the record already on disk (or
 * null on a first claim); `incoming` is what THIS invocation computed (may carry a blank
 * branch/session/sessionName when the caller simply does not have them in hand — e.g. `colab claim
 * N --worktree w` run before a branch is cut). `sameHolder` is true when `incoming` is a
 * reclaim/correction from the SAME holder as `existing` (a same-worktree re-claim, or the
 * worktree-inherits-session path at `colab worktree new`) — false on a `--force` takeover from a
 * DIFFERENT holder.
 *
 * Rule: a blank incoming `branch`/`session`/`sessionName` keeps the existing value, but ONLY when
 * `sameHolder` — a real new holder (a takeover) must never silently inherit a displaced holder's
 * session, which would be identity forgery under the fine `#267` setting; a takeover is announced
 * (`printTakeover`) and its record should honestly reflect what the new holder actually supplied.
 * `worktree` is always copied from `incoming` verbatim — it is never inherited (see module doc).
 */
function mergeClaimRecord(existing, incoming, { sameHolder } = {}) {
  const merged = { ...incoming };
  if (existing && sameHolder) {
    // #741: `lock` — the remote claim lock this claim holds — survives a same-holder re-claim, or the
    // release would no longer know which lock is its own.
    for (const field of ['branch', 'session', 'sessionName', 'lock']) {
      if (!merged[field] && existing[field]) merged[field] = existing[field];
    }
  }
  return merged;
}

/**
 * Does `v` look like a session ID a consumer could actually JOIN on — a URL, or a `session_…`
 * token embedded in one (#306)? The repo's ONE answer to that question — defined in codec/claim.js
 * since #497 and re-exported here: `parseSessionField` (codec/claim.js) decodes a claim comment's
 * `· session <field>` tail with exactly this test, and
 * `warnWeakIdentity` warns with it. Two copies of a shape rule drift, and this one decides
 * whether a hold can ever be released by its own owner, so there is one.
 *
 * ⚠ This is a SHAPE heuristic and deliberately not a gate. `requirePlaceIdentity`'s own refusal
 * text promises `--session <url-or-any-stable-id>`, and the fleet has real callers (and six of
 * this repo's own test fixtures) using bare stable ids like `sess-agent`. A false here means
 * "warn the caller they may have passed a session NAME by mistake" — never "refuse the write".
 * Rejecting a non-URL would break that documented contract and every such adopter.
 *
 * False for '' / null: absence is `warnWeakIdentity`'s and `requirePlaceIdentity`'s subject
 * (#11/#242), never this predicate's — callers test blankness first.
 */
/**
 * #746 — may a claim record that carries NO `lock` field release the claim lock found on the remote
 * for its issue? Pure. `trailers` is `git.parseClaimLockMessage` of the lock commit, `rec` the claim
 * record being released, `here` = `{ num, hostLabel, machineTok }` (this machine's `machineLabel` and
 * public machine token). `{ ok: true }` or `{ ok: false, why }` — a refusal leaves the lock in place
 * and the caller prints the delete command, so this errs toward "not provably ours".
 *
 * A record is lock-less when the lock was written by something other than the colab that wrote the
 * record: an orchestrator takes the lock at spawn and the session's claim is then recorded by a colab
 * that predates #741 (measured on #746 itself — the served CLI lagged trunk), or `doctor --sync`
 * re-creates the record from the tracker. So the rule mirrors adoption in `remoteClaimConflicts`:
 *   - the lock must name this issue in its subject (`claim: #N …`);
 *   - a lock colab wrote (`Claimed-By: colab`) is this claim's only when its `Session:` equals the
 *     record's (both non-empty) AND it names this machine — two colab homes on one host share the
 *     hardware, so the machine alone never proves it;
 *   - a lock another tool wrote is this claim's when it names this machine — the same test that let
 *     the session adopt it — unless a `Session:`/`Branch:` it does carry contradicts the record.
 */
function lockReleasableBy(trailers, rec, { num, hostLabel = '', machineTok = '' } = {}) {
  const tr = trailers || {};
  const r = rec || {};
  const issues = Array.isArray(tr.issues) ? tr.issues : [];
  if (!issues.includes(Number(num))) {
    return { ok: false, why: issues.length ? `the lock commit names ${issues.map((n) => `#${n}`).join(' ')}, not #${num}` : `the lock commit names no issue` };
  }
  const trMachine = tr.machine ? machineLabel(tr.machine) : '';
  const onThisMachine = (tr.machineId && machineTok) ? tr.machineId === machineTok : (!!trMachine && trMachine === machineLabel(hostLabel));
  if (tr.colab) {
    if (!r.session || !tr.session || r.session !== tr.session) {
      return { ok: false, why: `colab wrote it for session ${tr.session || '(none)'}, this claim is session ${r.session || '(none)'}` };
    }
    if (!onThisMachine) return { ok: false, why: `colab wrote it on machine ${tr.machine || tr.machineId || '(none)'}` };
    return { ok: true };
  }
  const writer = tr.author || 'another tool';
  if (!onThisMachine) return { ok: false, why: `${writer} wrote it for machine ${tr.machine || '(none)'}, not this one` };
  if (tr.session && r.session && tr.session !== r.session) return { ok: false, why: `${writer} wrote it for session ${tr.session}, this claim is session ${r.session}` };
  if (tr.branch && r.branch && tr.branch !== r.branch) return { ok: false, why: `${writer} wrote it for branch ${tr.branch}, this claim is on ${r.branch}` };
  return { ok: true };
}

const { looksLikeSessionId } = require('./codec/claim'); // one copy of the rule, in the codec (#497)

module.exports = {
  DEFAULT_COMPONENTS, FINE_COMPONENTS,
  claimIdentityProblem, components, identityString, sameClaimant, mergeClaimRecord,
  looksLikeSessionId, isIntentSession, sameHost, sameFactory,
  shouldDerivePersonSession, derivePersonSession, isPersonSession, lockReleasableBy,
};
