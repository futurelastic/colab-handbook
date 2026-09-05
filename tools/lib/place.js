'use strict';
/**
 * Place-claims (CONVENTIONS.md, "Place-claims") — the writer-verifiable hold `writes: serial`
 * needs and `isolated` does not (#136).
 *
 * WHAT THIS IS NOT. Three partial mechanisms already exist in this fleet and none is a
 * place-claim: the claim registry (lib/state.js `claims`) holds an ISSUE, not a PLACE; a
 * worktree's existence implies nothing about who is writing to it right now (creating one is
 * taking it — there is no separate act); and a session dashboard's own spawn-time trunk-lock is
 * keyed to spawning a ship/sweep-kind session, which cannot answer "may I write here right now"
 * for work that never came through a spawn (an implementer agent fanned out by a coordinator,
 * for instance). This module is that missing, general primitive.
 *
 * RELEASE IS A LIVENESS LOOKUP AT READ TIME, NEVER A STATE TRANSITION WRITTEN AT KILL TIME.
 * "Dies with its session" is what a reader assumes and is not what a stored flag can promise —
 * nothing reliable runs at the moment a session dies. Measured on the one such lock already
 * running in this fleet (the dashboard's spawn-time trunk-lock): it releases only once a poller
 * NOTICES the holder died, roughly a minute later, so a caller that kills a session and
 * immediately retries gets a refusal indistinguishable from a genuine conflict. This module does
 * not write a `released` flag at all — `isLive`/`holderOf`/`conflict` re-derive liveness on every
 * call, so a dead holder's record disappears from a caller's point of view the instant it is next
 * read, with no lag and no poller.
 *
 * MACHINE-LOCAL ONLY, DELIBERATELY (#128 §10 Q3, out of scope). A place-claim lives in
 * ~/.colab/state.json, keyed by absolute checkout PATH — not by repo, so a repo running several
 * worktrees needs one hold per checkout in use. Two machines each holding their own local lock on
 * what happens to be the same logical repo is a distributed-systems question this module does not
 * answer; the existing backstop (separate working trees, git's own push rejection on a stale ref)
 * remains what prevents two machines from landing the same conflict undetected. A record that is not
 * this machine (`tools/lib/machine.js` `isLocal` — a hardware id compare when both sides have one,
 * else a canonicalized-hostname compare, #289) is proof `~/.colab` itself is being synced across
 * machines, which `syncedStateProblem` below treats as the same hazard as a synced lock file. Before
 * #289 this was a raw `rec.host !== os.hostname()` string compare, which false-refused the SAME
 * machine the instant its short hostname drifted from its FQDN (`devbox.local` vs `devbox`)
 * — `machine.isLocal` is strictly more permissive, never less, than that check.
 *
 * NEVER IN A FILE-SYNCED LOCATION. A Resilio/Syncthing/Dropbox/iCloud path has no atomicity and no
 * consistency guarantee inside its sync window: two sessions can each read "unlocked", each write
 * "held by me", and both proceed WITH CONFIDENCE — worse than having no lock. `syncedStateProblem`
 * refuses an acquire from such a path; it is a heuristic (a marker scan), and the foreign-host
 * check in `isLive` is the behavioural backstop that fires even when the marker scan misses.
 *
 * DEGRADED MODE: SERIAL FALLS BACK TO ISOLATED, NEVER TO UNLOCKED. If the lock cannot be reached —
 * state unreadable, the lock directory stuck — callers are told to use a worktree and branch
 * instead, which needs no lock. Speed degrades; safety never does. THIS MODULE DOES NOT IMPLEMENT
 * THAT ITSELF — `state.loadState()`/`state.mutate()` are what can throw on an unreadable file or a
 * stuck lock, and `place.js` never calls either (every function here takes an already-loaded state
 * object). The catch lives in `tools/colab`'s `placeState()`/`placeMutate()` helpers, used by every
 * caller that acquires or checks a place-claim (`cmdSolo`, `cmdClaim`'s trunk-checkout path,
 * `cmdPlace`) — see those for the actual degrade behaviour, exit code 2 on `cmdPlace`.
 *
 * BLANK-SESSION SELF-RECOGNITION IS A CALLER RESPONSIBILITY, NOT SOMETHING THIS MODULE GUESSES
 * (#242). `conflict`'s same-holder exemption matches ONLY a truthy, matching `session` — two
 * invocations that both carry a blank one are never recognized as the same holder, even when a
 * hold's recorded `pid` matches the caller's own. That is deliberate: `pid` was unconditionally
 * `process.ppid`, the parent shell, not a unique per-command identity, so matching on it could
 * exempt a genuine conflict (two unrelated commands sharing a shell) — the one failure mode this
 * primitive must never have. `tools/colab`'s `cmdClaim`/`cmdSolo` instead make a non-blank `session`
 * MANDATORY at the two call sites that mint a shared-checkout hold, so the gap is closed by requiring
 * identity up front rather than by weakening what counts as a match here. See `conflict`'s own
 * doc comment for the full argument, including a falsifier run that measured agent tool calls
 * NOT sharing a stable pid across commands, which is what rules a BARE pid out as a fix.
 * `resolveAnchor` (#288, below) governs a DIFFERENT question — whether a recorded pid may ever be
 * PROBED for liveness at all — and leaves this exemption rule untouched.
 *
 * IDENTITY GAINED A SECOND, INDEPENDENT PROOF IN #317 — AND THE PARAGRAPH ABOVE STILL HOLDS. A hold
 * whose recorded anchor process is PROVABLY this invocation's own (`ownsAnchor`: `pidKind: 'anchor'`
 * AND `anchorProof` `'verified'`/`'declared'` AND alive AND containing this pid right now) is the
 * caller's, whatever string either side carries. That is not the pid match rejected above: the
 * rejected one was `process.ppid`, a parent shell two unrelated commands share, and every record
 * carrying one — `anchorProof: 'default'`, plus every record written before #317 — is excluded by
 * construction and always will be. The population that gained self-recognition is the one #288
 * taught this module to identify properly in the first place: a long-lived agent session process,
 * verified as an ancestor at write time. It was measured being locked out by its own hold for 8.5
 * hours. `sessionName` remains never an ownership key, on any path. Full argument: `ownsAnchor`, and
 * docs/adr/317-anchor-pid-self-ownership.md.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const procs = require('./procs');
const machine = require('./machine');
const { humanAge } = require('./util');

/**
 * Resolve a checkout path to the canonical string every caller keys against — `realpath` so a
 * symlink or a `./`-suffixed path resolves to the SAME key as its canonical form. Falls back to
 * `path.resolve` when the path does not exist on disk (e.g. checking a place that may already have
 * been torn down) rather than throwing, because a missing directory is a legitimate thing to ask
 * "is anything holding this?" about.
 */
function placeKey(pathAbs) {
  const resolved = path.resolve(pathAbs);
  try {
    return fs.realpathSync(resolved);
  } catch (_) {
    return resolved;
  }
}

/**
 * Build a hold record. `branch` follows the SAME representation a claim's does — `null` for "the
 * trunk checkout" (never the literal word `trunk`, refused by `records.branchProblem` at write
 * time in lib/state.js's `mutate`), a real name for a worktree. `pid` is optional: a hold acquired
 * on behalf of a process this module cannot introspect (e.g. relayed from a session id alone) may
 * omit it, and its absence makes the hold's liveness `unknown` — see `isLive` below.
 *
 * `pidKind` (#288) says what KIND of process `pid` names, because "no pid recorded" and "a pid is
 * recorded but naming it would be a false signal" need to be told apart:
 *   - `'anchor'` (default, and every legacy record with no `pidKind` at all) — `pid` is the
 *     long-lived process whose death means the work is over; it MAY be probed for liveness. CALLERS
 *     SHOULD PASS THE LONG-LIVED PROCESS's pid, never a short-lived CLI invocation's own — `tools/colab`
 *     used to pass `process.ppid` unconditionally for exactly this reason: the `colab` process that
 *     acquires a hold exits the moment the command returns, so its own pid would already read dead
 *     by the time anything checks. `resolveAnchor` below is what now decides, per call, whether
 *     `process.ppid` is actually that long-lived process (#288's bug: an agent's `ppid` is a
 *     short-lived per-tool-call shell, not the session).
 *   - `'invocation'` — `pid` is kept ONLY as a human lead for `holderLabel` (#235); it is NEVER
 *     probed, so it can never produce a false "dead" verdict. See `defaultProbe`/`isLive` below.
 *
 * `anchorProof` (#317) is `resolveAnchor`'s `proof` for that same pid — `'declared'`/`'verified'`
 * (a pid somebody named or proved), `'default'` (a bare `ppid`, assumed), `'none'`, or `null` for a
 * record written before this field existed. It is stored ONLY so `ownsAnchor` can tell a session's
 * own process from whatever shell happened to run the command; nothing about liveness reads it.
 *
 * `machine` (#289) is this machine's hardware-bound id (`tools/lib/machine.js` `localMachine().id`),
 * recorded alongside `host` so a reader can tell "genuinely a different machine" from "the same
 * machine under a drifted hostname" without re-deriving it — `host` stays what `holderLabel` and
 * every refusal message print, unchanged.
 */
function holdRecord({ pathAbs, repo, branch = null, host, session, sessionName, pid = null, pidKind, anchorProof, since }) {
  return {
    path: placeKey(pathAbs),
    repo,
    branch,
    host: host || os.hostname(),
    machine: machine.localMachine().id,
    session: session || null,
    sessionName: sessionName || null,
    pid: pid || null,
    pidKind: pidKind || null,
    anchorProof: anchorProof || null,
    since: since || new Date().toISOString(),
  };
}

/**
 * Decide what pid a NEW hold should anchor on, and whether that pid may ever be probed (#288).
 * Pure — every real-world source (`alive`, `isAncestor`) is injected, so this is testable with no
 * real process tree. Returns `{ pid, pidKind, proof, why }`; `why` is a short human-readable trace of
 * which rule fired, for callers that want to say more than "trust me" when `--pid` was not given.
 *
 * `proof` (#317) says HOW the anchor was established, which `pidKind` alone cannot express: rules 1
 * and 2 below record a pid somebody either NAMED deliberately or PROVED contains this invocation,
 * while rule 4 records a bare `process.ppid` — the parent SHELL, which two unrelated commands share.
 * All three are `pidKind: 'anchor'` (all three may be probed for liveness), so a predicate that has
 * to tell "a session's own process" from "whatever shell happened to run me" needs this second term:
 *
 *   `'declared'`  rule 1, numeric — a caller named it and it was verified alive.
 *   `'verified'`  rule 2 — `CLAUDE_PID`, alive AND proven an ancestor of this invocation.
 *   `'default'`   rule 4 — `ppid`, assumed, never proven. NOT a self-ownership signal (#242).
 *   `'none'`      rules 1-`none` and 3 — fail-closed, `pidKind: 'invocation'`.
 *   absent        every record written before #317 — read exactly like `'default'`: never self-owned.
 *
 * `ownsAnchor` below is the only consumer; `defaultProbe`/`isLive` deliberately never read it, so
 * liveness, `stalePlaces` and every prune path behave identically to before this field existed.
 *
 * Precedence, first match wins:
 *   1. An explicit anchor — `pidOpt` (`--pid <n|none>` at the CLI, or `COLAB_PLACE_PID`). The literal
 *      string `'none'` means "I know there is nothing worth anchoring on", and resolves to the same
 *      fail-closed `'invocation'` shape as rule 3 — but as a caller's explicit statement, not a
 *      default. A numeric value must pass `alive()`; a caller naming a dead pid is a mistake worth
 *      surfacing (`UserError` at the CLI call site), never a silently-adopted dead anchor.
 *   2. `env.CLAUDE_PID`, numeric, alive, AND `isAncestor(n, process.pid)` — an agent session's
 *      long-lived `claude` process, verified to actually contain this invocation (not merely named by
 *      an env var that could be stale, forged, or left over from a different session). Adopted as
 *      `'anchor'`: this is the #288 fix that needs no recipe change from any caller.
 *   3. `env.CLAUDECODE === '1' || env.AI_AGENT` with no anchor proven by rule 2 — an agent shell with
 *      nothing safe to anchor on. Fails closed: `pid` is kept (as `ppid`) ONLY as a human lead, never
 *      probed (`pidKind: 'invocation'`). This is #288's own caller shape: a short-lived per-tool-call
 *      shell whose `ppid` is NOT the session, so probing it produces exactly the false-dead verdict
 *      #288 reports.
 *   4. Default — `{ pid: ppid, pidKind: 'anchor' }`, today's exact behaviour, unchanged for every
 *      interactive-terminal caller and every record already on disk (absence of `pidKind` takes this
 *      same branch on read, per `defaultProbe`/`isLive` above).
 */
function resolveAnchor({ pidOpt, env = {}, ppid, alive = procs.alive, isAncestor = procs.isAncestor } = {}) {
  if (pidOpt !== undefined && pidOpt !== null && pidOpt !== '') {
    if (String(pidOpt).trim().toLowerCase() === 'none') {
      return { pid: ppid, pidKind: 'invocation', proof: 'none', why: '--pid none: caller states no anchor exists' };
    }
    const n = Number(pidOpt);
    if (!Number.isFinite(n) || !alive(n)) {
      return { pid: null, pidKind: null, proof: null, why: `--pid ${pidOpt} is not a live process`, invalid: true };
    }
    return { pid: n, pidKind: 'anchor', proof: 'declared', why: `--pid ${n}: caller-supplied anchor` };
  }
  const claudePid = Number(env.CLAUDE_PID);
  if (env.CLAUDE_PID && Number.isFinite(claudePid) && alive(claudePid) && isAncestor(claudePid, process.pid)) {
    return { pid: claudePid, pidKind: 'anchor', proof: 'verified', why: `CLAUDE_PID ${claudePid}: alive and proven an ancestor` };
  }
  if (env.CLAUDECODE === '1' || env.AI_AGENT) {
    return { pid: ppid, pidKind: 'invocation', proof: 'none', why: 'agent shell (CLAUDECODE/AI_AGENT), no proven anchor — failing closed' };
  }
  return { pid: ppid, pidKind: 'anchor', proof: 'default', why: 'default: ppid is the long-lived invoking process' };
}

/**
 * The default liveness probe — a pure function of one record, injectable so tests never depend on
 * what happens to be running on the machine. Returns `true` (live, hold stands), `false` (dead,
 * not a hold), or `null` (cannot tell, FAILS CLOSED — the hold stands and the message says why).
 *
 * Order matters, in three steps: a foreign-machine record is checked before anything about pid,
 * because it is not "unknown" in the ordinary sense — it is evidence of the sync hazard this module
 * exists to refuse, and that is worth a distinct message (`machine.isLocal`, #289, replaces a raw
 * `os.hostname()` string compare so a drifted-but-same-machine record is no longer misread as
 * foreign). Then `pidKind: 'invocation'` (#288) — a pid recorded ONLY as a human lead, never a
 * liveness signal — is checked before ordinary pid probing, because probing it would produce a
 * false-dead verdict on a still-running holder (the #288 bug: an agent's short-lived per-tool-call
 * shell pid, mistaken for the long-lived session). Finally an `'anchor'` pid (the default, and
 * every legacy record with no `pidKind` at all) is probed as before.
 */
function defaultProbe(rec) {
  if (!rec) return false;
  if (!machine.isLocal(rec)) return null; // foreign-machine — see isLive's message
  if (rec.pidKind === 'invocation') return null; // never probed — see isLive's message
  if (rec.pid) return procs.alive(rec.pid);
  return null; // no pid recorded — cannot probe locally, fails closed
}

/**
 * Liveness of one hold record, as `{live, reason}`. `live` is `true`/`false`/`null` (unknown,
 * fails closed — treated as held everywhere in this module). Never trusts a stored flag; every
 * call re-runs `probe` against the record as it stands right now.
 */
function isLive(rec, probe = defaultProbe) {
  if (!rec) return { live: false, reason: 'no record' };
  if (!machine.isLocal(rec)) {
    const local = machine.localMachine();
    return {
      live: null,
      reason: `recorded on host "${rec.host}"${rec.machine ? ` (machine ${rec.machine})` : ''}, not this ` +
        `machine ("${local.host}"${local.id ? `, machine ${local.id}` : ''}) — either a genuinely ` +
        'different machine (place-claims are machine-local only, CONVENTIONS.md "Place-claims") or ' +
        '~/.colab is itself being synced, which is the same hazard this module refuses for the lock ' +
        'file itself',
    };
  }
  if (rec.pidKind === 'invocation') {
    return {
      live: null,
      reason: rec.pid
        ? `pid ${rec.pid} is an invocation shell, not the anchor process (#288) — never probed for ` +
          'liveness, failing closed (hold stands)'
        : 'no anchor pid recorded — cannot probe liveness locally, failing closed (hold stands)',
    };
  }
  const verdict = probe(rec);
  if (verdict === true) return { live: true, reason: `pid ${rec.pid} is alive` };
  if (verdict === false) return { live: false, reason: rec.pid ? `pid ${rec.pid} is gone` : 'no longer live' };
  return {
    live: null,
    reason: 'no pid recorded — cannot probe liveness locally, failing closed (hold stands)',
  };
}

/**
 * The hold on `pathAbs`, if any, with its liveness resolved right now. Returns `null` when there
 * is no record at all — genuinely free, not merely "nothing found yet".
 */
function holderOf(st, pathAbs, probe = defaultProbe) {
  const key = placeKey(pathAbs);
  const rec = (st && st.places && st.places[key]) || null;
  if (!rec) return null;
  const { live, reason } = isLive(rec, probe);
  return { rec, live, reason };
}

/**
 * A holder identity that always resolves to SOMETHING a human can act on — never the bare
 * "unknown" that leaves a live-hold refusal with no remedy but COLAB_HUMAN=1 and nobody to ask
 * (#235). Preference order: the human-supplied label, the session URL, then the (pid, host) every
 * real acquire site already records (`tools/colab` passes `process.ppid` at every write site) — a
 * human blocked by a hold with neither a name nor a URL can still `ps -p <pid>` on `<host>` and
 * find out what that process is, which is a real lead where "unknown" is none. Only a record with
 * NEITHER identity NOR a pid — not producible by any current write site, but not impossible in a
 * hand-edited state.json — falls all the way back to the literal 'unknown'.
 */
function holderLabel(rec) {
  if (!rec) return 'unknown';
  if (rec.sessionName) return rec.sessionName;
  if (rec.session) return rec.session;
  if (rec.pid) return `pid ${rec.pid} on ${rec.host || os.hostname()}`;
  return 'unknown';
}

/**
 * How long `rec` has been held, self-evident on sight ("3h ago", "4d ago") — never a raw
 * timestamp a reader has to subtract by hand (#238). The one thing that distinguishes a hold a
 * live session parked at a prompt for an hour from one somebody genuinely forgot days ago; both
 * render identically as "[live]" otherwise, which is precisely the gap #238 measured. `rec.since`
 * is missing only on a hand-edited state.json — every real write site sets it (`holdRecord`
 * above defaults it at construction) — so this still resolves to something rather than throwing.
 */
function holdAge(rec) {
  return rec && rec.since ? humanAge(rec.since) : 'age unknown';
}

/**
 * The sentence appended to a `held`/`unknown` message when neither side of the comparison
 * carries a session id (#242). Blank-blank is NOT recognized as a re-acquire by the SAME
 * holder — `conflict`'s exemption only fires on a truthy, matching `session` — so this is
 * where that silence would otherwise leave a caller with no explanation and no remedy.
 *
 * `likelySelf` names a real, useful hint (the hold's pid is this invocation's own parent
 * process) WITHOUT turning it into an exemption — see the `conflict` doc comment for why a
 * pid is never used to decide `null` vs refuse.
 */
function identityGap(rec, self, likelySelf) {
  let msg = ' — neither this hold nor this attempt carries a session id, so it cannot be ' +
    'told apart from your own (#242): supply --session <stable-id> on the acquiring command, ' +
    'or export COLAB_SESSION="<stable-id>" once for the shell, so a re-acquire is recognized ' +
    'as yours. If you know this holder is gone, COLAB_HUMAN=1 colab place release ' +
    `"${rec.path}".`;
  if (likelySelf) {
    msg += ` (This hold's recorded pid (${rec.pid}) is this invocation's own parent process, ` +
      'so it is very likely yours — but a pid is process lineage, not a session, and this ' +
      'module will not exempt on it.)';
  }
  return msg;
}

/**
 * Would acquiring `pathAbs` for `self` (an optional {session, pid} to exempt the caller's own
 * re-acquire/renew) conflict with an existing hold? Returns `null` for clear ground, or
 * `{holder, kind, message, unidentified, likelySelf}` — `kind` is `'held'` (a live other
 * holder, refuse), `'unknown'` (liveness could not be resolved, refuse and name the remedy),
 * or `'foreign-host'` (refuse, citing the sync hazard). `unidentified` is true when neither
 * side carries a session id (blank-blank); `likelySelf` is additionally true when, in that
 * same blank-blank case, the hold's recorded pid equals `self.pid`.
 *
 * A BARE PID IS NEVER AN EXEMPTION KEY (#242, boundary restated by #317). Two things return `null`
 * here: a matching, non-blank `session`, and — since #317 — a hold whose PROVEN anchor process
 * (`anchorProof` `'verified'`/`'declared'`, alive, and containing this invocation right now)
 * identifies the caller as the same writer. Everything the paragraph below rules out is still ruled
 * out: a `sessionName` match, a blank-against-blank match, and above all a match on a `'default'` or
 * legacy pid — `process.ppid`, the parent shell — which is the population the argument is about and
 * which `ownsAnchor`'s term 3 excludes permanently. The measured falsifier runs below are what that
 * exclusion exists to honour, so they are kept, not deleted. Two reasons, both measured rather than
 * assumed: (1) this fleet's own
 * agents are told to pass `--session` as a FLAG, never rely on an `export`, precisely
 * because shell state does not persist between an agent's separate tool calls — and if the
 * shell does not persist, its pid does not either, so pid-matching buys agents nothing; a
 * live falsifier run (two `colab place acquire` calls from two separate tool-call shells)
 * recorded two DIFFERENT pids and the second silently superseded the first because its
 * holder had already died — the self-collision this module has to worry about needs a
 * still-ALIVE prior holder, which the agent-tool-call model rarely produces. (2) `pid` WAS
 * `process.ppid` unconditionally — the parent SHELL, not a unique invocation — so two unrelated
 * commands run in the same shell (or a recycled pid) would share one, and this primitive's whole
 * value is refusing when it cannot prove safety: a pid match could exempt a genuine conflict, which
 * is the one failure mode it must never have. Reason (2) is exactly why #317 did NOT simply start
 * matching on `pid`: it matches only where #288's `resolveAnchor` already replaced that `ppid` with
 * a pid it PROVED contains the caller, and the shared-shell population keeps refusing. The population that genuinely needs self-recognition
 * across commands (a persistent interactive shell) already has a free, correct fix: `export
 * COLAB_SESSION=<id>` once. `sessionName` is likewise never an exemption key — it is display
 * text a caller picks about the WORK, not a join key, and two concurrent sessions can
 * plausibly choose the same one (a consumer that tried name-matching measured exactly this
 * and reverted it).
 */
function conflict(st, pathAbs, self = {}, probe = defaultProbe) {
  const h = holderOf(st, pathAbs, probe);
  if (!h) return null;
  // Re-acquire by the same holder — proved by the session string, or (#317) by the anchor process
  // that took the hold provably containing this invocation. `self.anchorOpts` is the injection seam
  // for `ownsAnchor`'s process sources; absent, it reads the real process tree.
  if (ownsPlace(h.rec, self && self.session, (self && self.anchorOpts) || {})) return null;
  const unidentified = !!(self && !self.session && !h.rec.session);
  const likelySelf = !!(unidentified && self.pid && h.rec.pid === self.pid);

  if (!machine.isLocal(h.rec)) {
    return {
      holder: h.rec,
      kind: 'foreign-host',
      unidentified,
      likelySelf,
      message: `place "${h.rec.path}" is recorded held from host "${h.rec.host}" ` +
        `(held ${holdAge(h.rec)}) — ${h.reason}`,
    };
  }
  if (h.live === false) return null; // dead holder — clear ground, nothing to refuse
  if (h.live === null) {
    return {
      holder: h.rec,
      kind: 'unknown',
      unidentified,
      likelySelf,
      message: `place "${h.rec.path}" is held by session "${holderLabel(h.rec)}" (held ${holdAge(h.rec)}) ` +
        `and its liveness cannot be confirmed locally (${h.reason}) — wait a moment and check again if it may ` +
        'have just died, or override with COLAB_HUMAN=1 once you know that session is gone' +
        (unidentified ? identityGap(h.rec, self, likelySelf) : ''),
    };
  }
  return {
    holder: h.rec,
    kind: 'held',
    unidentified,
    likelySelf,
    message: `place "${h.rec.path}" is held by session "${holderLabel(h.rec)}" (${h.reason}, held ${holdAge(h.rec)})` +
      (unidentified ? identityGap(h.rec, self, likelySelf) : ''),
  };
}

/**
 * Decide AND write, in one pass, over the state object the caller hands in (#285).
 *
 * WHY THIS EXISTS — the defect it closes. Every shared-checkout write site in `tools/colab` was a
 * check-then-act pair straddling the state lock: `placeState()` loaded state with NO lock,
 * `conflict()` judged that snapshot, and only then `placeMutate()` -> `state.mutate` -> `withLock`
 * re-read state and wrote `st.places[key]` UNCONDITIONALLY — never re-checking the fact the
 * decision rested on. Two processes could each read "free", each write "held by me", and both exit
 * 0, with the second silently superseding the first. That is precisely the "two sessions can each
 * read unlocked, each write held by me, and both proceed WITH CONFIDENCE" failure CONVENTIONS.md
 * ("Place-claims") names as worse than having no lock at all — it was simply being caused by the
 * check/write split rather than by a synced filesystem.
 *
 * So the decision moves INSIDE the critical section. Callers pass this as `state.mutate`'s
 * function: the `st` it receives is the one loaded under the lock, microseconds before the write,
 * and the same `conflict()` that judged the earlier snapshot judges THIS one. The outer, lock-free
 * pre-check stays where it is at every call site — it is a cheap refusal that avoids taking the
 * lock at all in the common case, and it owns the `--force`/`COLAB_HUMAN=1` policy — but it is no
 * longer the authority. This one is.
 *
 * PURE WITH RESPECT TO THE FILESYSTEM, deliberately, exactly like every other function in this
 * module (see the header): it mutates the object it is given and returns a verdict. It never loads
 * or saves state, never reads `process.env`, and never decides policy — `syncedStateProblem`,
 * `resolveAnchor`, `requirePlaceIdentity` and the `COLAB_HUMAN` bar all stay at the call site,
 * because those are questions about the CALLER, not about the record.
 *
 * `force` writes over a live holder. It is not an override this module grants — the caller has
 * already cleared the `COLAB_HUMAN=1` bar CONVENTIONS.md ("Place-claims": "override is a human
 * act") requires before it may pass it. Passing it here is the caller stating that bar was met.
 *
 * Returns `{ok: true, rec, superseded}` — `superseded` is the record this write replaced, if any
 * (a confirmed-dead holder, or a forced takeover), so a caller can SAY what it displaced rather
 * than silently overwriting it — or `{ok: false, conflict}`, where `conflict` is exactly what
 * `conflict()` returns, so a refusal message composed from it cannot drift from the pre-check's.
 */
function acquire(st, opts = {}, probe = defaultProbe) {
  const {
    pathAbs, repo, branch = null, host, session, sessionName, pid = null, pidKind, anchorProof,
    anchorOpts = {}, force = false,
  } = opts;
  const key = placeKey(pathAbs);
  const prior = (st && st.places && st.places[key]) || null;
  const conf = conflict(st, pathAbs, { session, pid, anchorOpts }, probe);
  if (conf && !force) return { ok: false, conflict: conf };
  const rec = holdRecord({ pathAbs, repo, branch, host, session, sessionName, pid, pidKind, anchorProof });
  st.places = st.places || {};
  st.places[key] = rec;
  // `prior` is reported as superseded only when it was somebody ELSE's — a re-acquire by the same
  // holder (`conflict` returned null on a matching session) is a renewal, not a takeover, and
  // calling it "superseded" would put a scary word in an ordinary message.
  // #317: "the same holder" is the same question `conflict` just answered, so it is asked with the
  // same predicate — a hold this caller's own proven anchor took is a RENEWAL, not a takeover, even
  // when the session string presented this time differs from the one recorded.
  const sameHolder = !!(prior && ownsPlace(prior, session, anchorOpts));
  return { ok: true, rec, superseded: prior && !sameHolder ? prior : null };
}

/**
 * Every place record whose holder is confirmed dead — `colab doctor`'s report, same shape as
 * `staleClaims`. Deliberately excludes `unknown` liveness: a record this module cannot disprove is
 * held stays out of a report that implies "safe to prune".
 */
function stalePlaces(st, probe = defaultProbe) {
  const out = [];
  for (const [key, rec] of Object.entries((st && st.places) || {})) {
    const { live, reason } = isLive(rec, probe);
    if (live === false) out.push({ path: key, rec, reason });
  }
  return out;
}

/**
 * Every place record whose liveness cannot be proven either way (`live === null`) — `colab doctor`'s
 * companion to `stalePlaces` (#288/#289). This is what makes an `'invocation'`-anchored hold, or a
 * genuinely unreachable foreign-machine one, VISIBLE instead of silently accumulating: neither is
 * "confirmed dead" (so `stalePlaces`/`--prune` correctly never touch it), but a human left with no
 * report at all has no way to notice one exists short of stumbling on it in `colab places`.
 * Deliberately excludes `live === false` (that is `stalePlaces`'s own report) and `live === true` —
 * this is only ever the middle, unprovable case.
 */
function unprovablePlaces(st, probe = defaultProbe) {
  const out = [];
  for (const [key, rec] of Object.entries((st && st.places) || {})) {
    const { live, reason } = isLive(rec, probe);
    if (live === null) out.push({ path: key, rec, reason });
  }
  return out;
}

/** Marker files/directories that mean "this ancestor is a file-sync root" — heuristic, not exhaustive. */
const SYNC_MARKERS = [
  '.sync', // Resilio Sync
  '.stfolder', // Syncthing
  '.dropbox', // Dropbox (legacy marker; newer clients vary)
];

function hasSyncMarker(dir) {
  for (const m of SYNC_MARKERS) {
    try {
      if (fs.existsSync(path.join(dir, m))) return m;
    } catch (_) { /* unreadable — not evidence either way */ }
  }
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (/^\.sync-conflict-/.test(entry) || /\.!sync$/.test(entry)) return entry;
    }
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * Is `colabDir` (normally ~/.colab) sitting under a file-synced location? Walks ancestors up to
 * `$HOME`, since a sync root is commonly declared a level or two above the folder itself (e.g.
 * `~/.colab` living inside a synced `~` on a misconfigured machine, or a sync client's marker
 * appearing beside the folder it manages rather than inside it). Returns a problem string, or
 * `null` for clean ground. iCloud's "Library/Mobile Documents" convention is checked by substring
 * on the path itself, since iCloud drops no marker file inside an arbitrary synced folder.
 */
function syncedStateProblem(colabDir) {
  const resolved = path.resolve(colabDir);
  const degradeInstruction = 'Degrading: fall back to a worktree + branch, which needs no lock ' +
    '(CONVENTIONS.md, Place-claims — "serial falls back to isolated, never to unlocked").';
  if (/Library\/Mobile Documents/.test(resolved)) {
    return `${colabDir} is under iCloud Drive ("Library/Mobile Documents") — a place-claim must never ` +
      'live in a file-synced location (CONVENTIONS.md "Place-claims"): no atomicity, no consistency ' +
      `guarantee inside the sync window, and two sessions could each read "unlocked" with confidence. ` +
      degradeInstruction;
  }
  const home = path.resolve(os.homedir());
  let dir = resolved;
  for (let i = 0; i < 8 && dir.length >= home.length; i++) {
    const marker = hasSyncMarker(dir);
    if (marker) {
      return `${colabDir} appears to be under a file-synced directory (found "${marker}" in ${dir}) — a ` +
        'place-claim must never live in a file-synced location (CONVENTIONS.md "Place-claims"): no ' +
        'atomicity, no consistency guarantee inside the sync window, and two sessions could each read ' +
        `"unlocked" with confidence. ${degradeInstruction}`;
    }
    if (dir === home) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Is `rec` a hold this `session` may act on as its own? (#306, naming what was already there.)
 *
 * This is EXACTLY `conflict`'s same-holder exemption above — a truthy, exactly-equal `session` —
 * given a name and a test file, because `cmdPlace release`'s `mine` test and that exemption are
 * required to be the same comparison. Two spellings of one rule is how a CLI ends up with two
 * different answers to "is this hold mine", and a hold that answers that inconsistently is worse
 * than one that refuses.
 *
 * ⚠ NEVER widen THIS function — to `sessionName`, or to `pid`. Both were considered and rejected on
 * measured evidence — see `conflict`'s doc comment above (a consumer that tried name-matching
 * reverted it after a worktree sat beside a live session with a near-identical name and was NOT it)
 * and CONVENTIONS.md, "Place-claims". #306 proposed exactly that widening as one of two candidate
 * fixes; it was rejected for these reasons and the fix went to write time instead. A blank session
 * never matches, including blank-against-blank (#242). Every word of that still holds, and this
 * function's body is unchanged.
 *
 * What #317 added is a SECOND, independent proof of the same fact beside it — `ownsAnchor` below —
 * not a loosening of this one. The boundary it draws is precise, and worth stating here because a
 * reader arriving at "never widen to pid" needs to know which pid: a `sessionName` is still never an
 * ownership key on any path; a bare, defaulted or legacy pid (`anchorProof` `'default'` or absent —
 * #242's `process.ppid`, shared by every command in one shell) is still never one either; only a pid
 * that was PROVED an ancestor at write time, or explicitly named by a caller, and that still
 * contains this very invocation, is. Consumers ask `ownsPlace`, which is this OR that.
 */
function ownsHold(rec, session) {
  return !!session && !!rec && rec.session === session;
}

/**
 * Is `rec` a hold whose ANCHOR PROCESS provably contains this invocation — i.e. is this the very
 * session that took the hold, reached through process lineage instead of through a typed string?
 * (#317.)
 *
 * WHY THIS EXISTS. A ship session recovered an issue with a no-worktree claim, which minted a
 * checkout hold under the identity string `coding-dashboard-1545`. It then shipped, and every later
 * squash-merge was refused by ITS OWN hold: the identity `colab ship` resolves comes from the
 * worktree record or a branch-keyed claim, and a no-worktree claim carries `branch: null`, so the
 * session presented a blank one. `ownsHold` is exact string equality and blank never matches, so a
 * session was locked out by a lock it had taken itself. One merge in 8.5 hours on that repo, cleared
 * only when a human ran `COLAB_HUMAN=1 colab place release` at 01:35. The string was never the
 * durable fact; the process was.
 *
 * FIVE TERMS, ALL REQUIRED — and term 3 is the one that keeps #242 closed:
 *   1. `machine.isLocal(rec)` — an ancestry walk across machines is meaningless (#289).
 *   2. `rec.pidKind === 'anchor'` — an `'invocation'` pid is a human lead, never a signal (#288).
 *   3. `rec.anchorProof` is `'verified'` or `'declared'` — the pid was PROVED an ancestor at write
 *      time, or NAMED by a caller. A `'default'` proof (rule 4: a bare `process.ppid`) and every
 *      legacy record with no `anchorProof` at all are excluded, permanently.
 *   4. `alive(rec.pid)` — a dead anchor is class `dead`, never class `own`.
 *   5. the anchor is this process, or an ancestor of it, RIGHT NOW (`isAncestor`) — not "an env var
 *      names it" (#288's own lesson), not "equals my ppid" (#242's rejected form).
 *
 * ⚠ WHY THIS IS NOT #242 REOPENED, and why term 3 is load-bearing rather than cautious. #242
 * rejected `rec.pid === self.pid` where `pid` was UNCONDITIONALLY `process.ppid` — the parent shell
 * — so two unrelated commands sharing one shell shared one pid, and a match could exempt a genuine
 * conflict. Term 3 excludes exactly that population: a `'default'`-proof record can never be
 * self-owned no matter how the ancestry walk comes out. This repo's own suite is the falsifier —
 * `ship-promote-place-claim.test.js` acquires a hold as a deliberately DIFFERENT session through
 * `colab place acquire`, whose recorded pid is the CLI's `ppid`, the node test runner; the `colab
 * ship` invocation in the same test is also a child of that runner, so terms 1/2/4/5 alone would
 * return true and ship would self-own a live foreign hold. Term 3 is what makes that record
 * ineligible, and that test going red is the sentinel if anybody removes it.
 *
 * The equivalence class this admits is ONE verified long-lived session process, which is never
 * coarser than the `session` string beside it: everything `ownsAnchor` exempts is something the same
 * session could already exempt by exporting `COLAB_SESSION` once (the remedy #242 named). It removes
 * the requirement to type that string identically on a later command — which is precisely #306's
 * complaint — without widening WHO counts as one writer. Falsifier for the whole rule: if two
 * concurrent writers of one checkout are ever measured sharing a `'verified'` anchor but NOT sharing
 * a session string, term 5 is insufficient and `docs/adr/317-…` must be superseded.
 *
 * ⚠ `sessionName` remains never an ownership key, on any path — display text is not a join key
 * (#306, and the consumer that measured a false name match and reverted it).
 *
 * Every real-world source is injected, so this is testable with no real process tree.
 */
function ownsAnchor(rec, { pid = process.pid, alive = procs.alive, isAncestor = procs.isAncestor } = {}) {
  if (!rec || !rec.pid) return false;
  if (!machine.isLocal(rec)) return false;                                   // 1
  if (rec.pidKind !== 'anchor') return false;                                // 2
  if (rec.anchorProof !== 'verified' && rec.anchorProof !== 'declared') return false; // 3
  if (!alive(rec.pid)) return false;                                         // 4
  if (Number(rec.pid) === Number(pid)) return true;                          // 5 — the anchor IS me
  return !!isAncestor(rec.pid, pid);                                         // 5 — …or contains me
}

/**
 * "Is this hold mine?", as every consumer should ask it (#317) — the session string OR the proven
 * anchor. Two independent proofs of one fact, and a caller that can supply either is the same
 * writer; neither widens who counts as one writer (see `ownsAnchor`'s doc for that argument).
 *
 * `ownsHold`'s own implementation is deliberately untouched: `cmdPlace release`'s `mine` test and
 * `conflict`'s exemption must stay ONE comparison, so the widening happens here, in a predicate both
 * call, rather than by two separate edits that could drift.
 */
function ownsPlace(rec, session, anchorOpts = {}) {
  return ownsHold(rec, session) || ownsAnchor(rec, anchorOpts);
}


/**
 * WHO holds `pathAbs`, relative to ME — one word, computed once, so no consumer re-derives it and
 * no two consumers disagree (#317). Returns `{cls, rec, live, reason, remedy, conflict}`.
 *
 * The live specimen this closes was not a wrong answer; it was an UNCLASSIFIED one. `colab ship`
 * printed `place "…" is held by session "coding-dashboard-1545"` and stopped — true, and useless:
 * the reader could not tell from it whether the holder was itself, a corpse, or a live sibling, and
 * those three need three different next moves. The refusal now names the class and the exact next
 * command, and two of the six classes are not refusals at all.
 *
 *   `free`            no record — proceed.
 *   `foreign-machine` recorded by another machine — refuse; the sync hazard (#289), unchanged.
 *   `own`             mine, by session string or proven anchor — proceed, and DO NOT release it at
 *                     cleanup: a hold this caller renewed is one somebody else's claim may still be
 *                     relying on (`cmdShip`/`cmdPromote` used to delete it on the way out).
 *   `dead`            holder confirmed gone — proceed; the record lapses at the next write here.
 *   `unknown`         liveness unprovable — REFUSE, fail closed. #288's invariant: a record this
 *                     module cannot disprove is held is never treated as absent and never pruned.
 *   `live-other`      a live holder that is not me — refuse; `COLAB_HUMAN=1` is the human bar.
 *
 * Precedence is `conflict`'s own order, deliberately: `foreign-machine` outranks everything because
 * it is evidence about the STATE FILE rather than about a process, and `own` outranks `dead`/
 * `unknown` because a caller's own hold needs no liveness argument at all.
 *
 * `conflict` is carried on the result, non-null exactly for the three refusing classes, so a caller
 * composing a message cannot drift from `conflict()`'s wording — the same guarantee #285 gave the
 * pre-check and the under-lock check.
 */
function classify(st, pathAbs, self = {}, probe = defaultProbe) {
  const h = holderOf(st, pathAbs, probe);
  if (!h) return { cls: 'free', rec: null, live: null, reason: 'no record', remedy: null, conflict: null };
  const anchorOpts = (self && self.anchorOpts) || {};
  const conf = conflict(st, pathAbs, self, probe);
  const base = { rec: h.rec, live: h.live, reason: h.reason };
  if (!machine.isLocal(h.rec)) {
    return { ...base, cls: 'foreign-machine', conflict: conf, remedy: `COLAB_HUMAN=1 colab place release "${h.rec.path}"` };
  }
  if (ownsPlace(h.rec, self && self.session, anchorOpts)) {
    return { ...base, cls: 'own', conflict: null, remedy: null };
  }
  if (h.live === false) return { ...base, cls: 'dead', conflict: null, remedy: null };
  if (h.live === null) {
    return { ...base, cls: 'unknown', conflict: conf, remedy: `COLAB_HUMAN=1 colab place release "${h.rec.path}"` };
  }
  return { ...base, cls: 'live-other', conflict: conf, remedy: `COLAB_HUMAN=1 colab place release "${h.rec.path}"` };
}

/**
 * Drop the record at `pathAbs` IF its holder is CONFIRMED dead — the read-time lapse (#317).
 *
 * Read-time liveness already meant a dead holder refuses nothing (`conflict` returns `null` on
 * `live === false`, and `acquire` supersedes the record). What it did NOT mean was that the record
 * went away: only `colab doctor --prune` ever removed one, and only when a human thought to run it.
 * So a dead-anchor hold sat in `colab places` looking like a hold — one on this very repo had sat
 * for five days — and `colab place release` demanded `COLAB_HUMAN=1` to clear a corpse. This makes
 * every command that already writes at that path clear it on the way past.
 *
 * ⚠ `live === null` is NEVER touched — not "unknown, probably fine", but the exact case #288/#289
 * fail closed on: an `'invocation'`-anchored hold, or an unreachable foreign-machine one. Pruning on
 * a signal that was never trustworthy is the failure `stalePlaces` was written to avoid, and this
 * function must never become a second, weaker copy of it.
 *
 * Returns the removed record, or `null` when there was nothing to lapse.
 */
function lapseDead(st, pathAbs, probe = defaultProbe) {
  const key = placeKey(pathAbs);
  const rec = (st && st.places && st.places[key]) || null;
  if (!rec) return null;
  if (isLive(rec, probe).live !== false) return null; // live, or unprovable — #288 fails closed
  delete st.places[key];
  return rec;
}

/**
 * Release the hold at `pathAbs` IF AND ONLY IF the caller provably owns it — the AUTOMATIC
 * counterpart to `cmdPlace release`'s deliberate, human-typed act (#305).
 *
 * Decide-and-write over the caller's `st`, mirroring `acquire`'s post-#285 shape so the decision
 * is made against the state the write actually sees, inside the caller's existing lock. It never
 * throws and never prompts: every non-release is a named `reason` the caller reports and carries
 * on from, because this runs as a rider on `colab release`, whose real job (dropping the claim)
 * has already succeeded by then.
 *
 * Stricter than `ownsHold` alone by one term — `machine.isLocal`. A human naming a path is
 * asserting intent about that path; a side effect of another command must never delete a record
 * another machine wrote, where "held" cannot even be evaluated (this module is machine-local by
 * design — see the module doc). That asymmetry is deliberate and lives HERE, not in `ownsHold`:
 * adding it to the shared predicate would change `cmdPlace release`'s behaviour, which is beyond
 * what #305/#306 decided.
 *
 * #317 changed two things here, both additive. Ownership is now `ownsPlace` — the session string OR
 * the proven anchor — so a claim minted with a mis-shaped `--session` (#306's population) still gives
 * its hold back. And a CONFIRMED-DEAD holder lapses before ownership is consulted at all, whatever
 * identity it names: that is what makes every caller of this function a dead-anchor sweeper, instead
 * of leaving a corpse for `colab doctor --prune` and a human who remembers to run it. An
 * unprovable (`live === null`) holder is still never touched — #288's invariant.
 *
 * Returns `{released: false, reason: 'no-record'|'foreign-machine'|'other-session', rec}` or
 * `{released: true, rec}` / `{released: true, reason: 'lapsed-dead', rec}` — `rec` is the record
 * inspected (or removed) so a caller can name the holder it left alone, or the corpse it cleared.
 */
function releaseOwnedBy(st, pathAbs, session, opts = {}) {
  const { anchorOpts = {}, probe = defaultProbe } = opts;
  const key = placeKey(pathAbs);
  const rec = (st && st.places && st.places[key]) || null;   // `places` may be absent entirely
  if (!rec) return { released: false, reason: 'no-record', rec: null };
  // #317: a confirmed-dead holder lapses here, before ownership is even asked — whoever it names.
  // This is what turns every claim-deletion site into a dead-anchor sweeper without any of them
  // growing its own liveness logic. `live === null` is untouched (see `lapseDead`).
  const lapsed = lapseDead(st, pathAbs, probe);
  if (lapsed) return { released: true, reason: 'lapsed-dead', rec: lapsed };
  if (!machine.isLocal(rec)) return { released: false, reason: 'foreign-machine', rec };
  if (!ownsPlace(rec, session, anchorOpts)) return { released: false, reason: 'other-session', rec };
  delete st.places[key];
  return { released: true, rec };
}

module.exports = {
  placeKey, holdRecord, resolveAnchor, defaultProbe, isLive, holderOf, holderLabel, holdAge, conflict, acquire,
  stalePlaces, unprovablePlaces, syncedStateProblem, ownsHold, ownsAnchor, ownsPlace, classify, lapseDead,
  releaseOwnedBy,
};
