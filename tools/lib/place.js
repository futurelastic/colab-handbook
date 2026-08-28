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
 * hold's recorded `pid` matches the caller's own. That is deliberate: `pid` is `process.ppid`,
 * the parent shell, not a unique per-command identity, so matching on it could exempt a genuine
 * conflict (two unrelated commands sharing a shell) — the one failure mode this primitive must
 * never have. `tools/colab`'s `cmdClaim`/`cmdSolo` instead make a non-blank `session` MANDATORY
 * at the two call sites that mint a shared-checkout hold, so the gap is closed by requiring
 * identity up front rather than by weakening what counts as a match here. See `conflict`'s own
 * doc comment for the full argument, including a falsifier run that measured agent tool calls
 * NOT sharing a stable pid across commands, which is what rules pid out as a fix.
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
 * omit it, and its absence makes the hold's liveness `unknown` — see `isLive` below. CALLERS
 * SHOULD PASS THE LONG-LIVED PROCESS's pid, not a short-lived CLI invocation's own — `tools/colab`
 * passes `process.ppid` for exactly this reason: the `colab` process that acquires a hold exits the
 * moment the command returns, so its own pid would already read dead by the time anything checks.
 *
 * `machine` (#289) is this machine's hardware-bound id (`tools/lib/machine.js` `localMachine().id`),
 * recorded alongside `host` so a reader can tell "genuinely a different machine" from "the same
 * machine under a drifted hostname" without re-deriving it — `host` stays what `holderLabel` and
 * every refusal message print, unchanged.
 */
function holdRecord({ pathAbs, repo, branch = null, host, session, sessionName, pid = null, since }) {
  return {
    path: placeKey(pathAbs),
    repo,
    branch,
    host: host || os.hostname(),
    machine: machine.localMachine().id,
    session: session || null,
    sessionName: sessionName || null,
    pid: pid || null,
    since: since || new Date().toISOString(),
  };
}

/**
 * The default liveness probe — a pure function of one record, injectable so tests never depend on
 * what happens to be running on the machine. Returns `true` (live, hold stands), `false` (dead,
 * not a hold), or `null` (cannot tell, FAILS CLOSED — the hold stands and the message says why).
 *
 * Order matters: a foreign machine is checked before pid liveness, because a record naming a pid on
 * another machine is not "unknown" in the ordinary sense — it is evidence of the sync hazard this
 * module exists to refuse, and that is worth a distinct message (`machine.isLocal`, #289, replaces a
 * raw `os.hostname()` string compare so a drifted-but-same-machine record is no longer misread as
 * foreign).
 */
function defaultProbe(rec) {
  if (!rec) return false;
  if (!machine.isLocal(rec)) return null; // foreign-machine — see isLive's message
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
 * PID IS NEVER AN EXEMPTION KEY (#242). Only a matching, non-blank `session` ever returns
 * `null` here — a pid match is surfaced in the message as a hint, never used to decide
 * held-vs-clear. Two reasons, both measured rather than assumed: (1) this fleet's own
 * agents are told to pass `--session` as a FLAG, never rely on an `export`, precisely
 * because shell state does not persist between an agent's separate tool calls — and if the
 * shell does not persist, its pid does not either, so pid-matching buys agents nothing; a
 * live falsifier run (two `colab place acquire` calls from two separate tool-call shells)
 * recorded two DIFFERENT pids and the second silently superseded the first because its
 * holder had already died — the self-collision this module has to worry about needs a
 * still-ALIVE prior holder, which the agent-tool-call model rarely produces. (2) `pid` is
 * `process.ppid` — the parent SHELL, not a unique invocation — so two unrelated commands run
 * in the same shell (or a recycled pid) would share one, and this primitive's whole value is
 * refusing when it cannot prove safety: a pid match could exempt a genuine conflict, which is
 * the one failure mode it must never have. The population that genuinely needs self-recognition
 * across commands (a persistent interactive shell) already has a free, correct fix: `export
 * COLAB_SESSION=<id>` once. `sessionName` is likewise never an exemption key — it is display
 * text a caller picks about the WORK, not a join key, and two concurrent sessions can
 * plausibly choose the same one (a consumer that tried name-matching measured exactly this
 * and reverted it).
 */
function conflict(st, pathAbs, self = {}, probe = defaultProbe) {
  const h = holderOf(st, pathAbs, probe);
  if (!h) return null;
  if (self && self.session && h.rec.session === self.session) return null; // re-acquire by the same holder
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

module.exports = {
  placeKey, holdRecord, defaultProbe, isLive, holderOf, holderLabel, holdAge, conflict, stalePlaces,
  syncedStateProblem,
};
