'use strict';
/**
 * Claim-record IDENTITY shape — the single decision #264 and #267 both need, so the writer
 * (`cmdClaim`, tools/colab:542) and the two readers (`tieBreakVerdict` :403, `ghClaimConflicts`
 * :324) apply ONE rule instead of two independently-evolving ones. Full design in
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
 * Are `a` and `b` the SAME claimant under `comps`? `login`+`host` are always required to match —
 * they are the baseline every component set includes. `session` sharpens the match ONLY when
 * `comps` includes it AND both sides carry a non-empty value; either side blank degrades that pair
 * back to the coarse comparison (see the module doc's DEGRADE-ON-MISSING note).
 */
function sameClaimant(a, b, comps) {
  if (!a || !b) return false;
  if ((a.login || '') !== (b.login || '')) return false;
  if ((a.host || '') !== (b.host || '')) return false;
  if (comps && comps.includes('session') && a.session && b.session) {
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
    for (const field of ['branch', 'session', 'sessionName']) {
      if (!merged[field] && existing[field]) merged[field] = existing[field];
    }
  }
  return merged;
}

module.exports = {
  DEFAULT_COMPONENTS, FINE_COMPONENTS,
  claimIdentityProblem, components, identityString, sameClaimant, mergeClaimRecord,
};
