'use strict';
/**
 * Machine-local state + config for colab.
 *
 *   ~/.colab/state.json   — the single source of truth for this machine (worktrees, claims, ports)
 *   ~/.colab/config.json  — configuration (repo roots to scan, extra reserved ports, TTL, port range)
 *   ~/.colab/state.lock   — mkdir-based lock (survives concurrent sessions; same technique as the
 *                           original shell scripts). Held only for the read-modify-write critical section.
 *
 * State is GLOBAL per machine: ports must be unique across ALL repos, not per-repo, so everything
 * lives in one file. Writes are atomic (temp file + rename).
 *
 * THIS SCHEMA HAS CONSUMERS OUTSIDE THIS REPO. At least one internal dashboard reads
 * ~/.colab/state.json directly to join worktrees and claims to the sessions that own them. So the
 * shape below is a published contract, not an implementation detail: adding a field is safe,
 * renaming or removing one is a breaking change for readers you cannot grep for. The authoritative
 * annotated version lives in tools/README.md ("~/.colab/state.json (version 1)") — keep the two in
 * step, and prefer to extend the prose there rather than here.
 *
 * State shape (version 1):
 * {
 *   version: 1,
 *   worktrees: {                         // the port-OWNING entity
 *     "<name>": { name, repo, branch, base, path, ports: [5230,...], host,
 *                 session, sessionName, status, created }
 *   },
 *   claims: {                            // many claims may reference one worktree (group of issues)
 *     "<repoAbs>#<n>": { issue:"#115", repo, worktree:<name>|null, branch, host,
 *                        session, sessionName, created }
 *   },
 *   ports: {                             // flat registry — one entry per allocated port
 *     "5230": { port:5230, owner:{type:"worktree"|"claim"|"manual", ref:"<name|key|label>"}, host, created }
 *   },
 *   solo: {                              // `ceremony: light` only — one lock per repo per machine
 *     "<repoAbs>": { host, session, sessionName, since }
 *   },
 *   places: {                            // #136 — path-scoped place-claims, machine-local only
 *     "<checkoutPathAbs>": { path, repo, branch, host, machine, session, sessionName, pid, pidKind,
 *                            since }
 *   }
 * }
 *
 * Field notes for the four that carry weight beyond storage:
 *   base     the branch the worktree was cut from AND the one `colab ship` merges back into —
 *            trunk normally, a declared `integration:` line by request. Not derived at ship time.
 *   session  the ONLY join key to a live session; `sessionName` is display text and joins nothing.
 *            A name with no URL is a half-identity — the row reads as owned and links nowhere.
 *   branch   a real branch name, or `null` for "no branch" (a claim held on the trunk checkout).
 *            NEVER the word `trunk`: that is a role, not a name, and a reader resolving it gets
 *            nothing. Enforced on write by lib/records.js; readers must tolerate null.
 *   status   `running` → `merged` (killed = entry removed), plus `pending`: a stub written by
 *            `colab claim --worktree <name>` for a worktree that does not exist yet. It is the one
 *            status allowed a null `path`, and `colab worktree new` replaces it with the real record.
 *
 * `session`, `sessionName`, `status` and `base` are backward-compatible: entries written before
 * they existed simply lack them, and readers must tolerate that — no migration is performed.
 *
 * `solo` is keyed by repo, not by issue or worktree: solo flow (CONVENTIONS.md, Solo flow) makes
 * no claim and creates no worktree, so it needs its own lock or two solo sessions on one machine
 * could commit to the same trunk checkout at once with nothing recording either. `colab solo`
 * is the only writer; `--done` is the only remover.
 *
 * `places` is keyed by absolute checkout PATH, not by repo or issue (CONVENTIONS.md, Place-claims;
 * lib/place.js) — a repo running several worktrees needs one hold per checkout in use, not one per
 * repo. `pid` is optional (a hold acquired by a process other than the one whose liveness matters
 * may omit it) but its absence makes the hold's liveness `unknown`, which FAILS CLOSED (the hold
 * stands) rather than reading as released. Nothing here is ever read as "released" from a stored
 * flag — every reader re-derives liveness at read time (lib/place.js `isLive`); a record surviving
 * past its holder's death is the expected, harmless shape, not a bug to migrate away. `places` and
 * `solo` deliberately coexist rather than merge: `solo` is the published contract noted above, and
 * converging the two is out of scope for #133/#136 (tracked for after #175).
 *
 * `machine` and `pidKind` (#288/#289) are backward-compatible the same way: a record written before
 * they existed simply lacks them, and readers must tolerate that — no migration. `machine` is this
 * machine's hardware-bound id (lib/machine.js `localMachine().id`), recorded alongside `host` so a
 * reader can tell a genuinely different machine from the same machine under a drifted hostname
 * without re-deriving it. `pidKind` (`'anchor'` or absent = today's exact behaviour; `'invocation'`
 * = kept only as a human lead, never probed) says whether `pid` may be used for liveness at all —
 * see lib/place.js `resolveAnchor`/`defaultProbe`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Optional local journal. Requires nothing back from this module (it resolves COLAB_DIR itself), so
// there is no require cycle; see the note on COLAB_DIR in lib/journal.js.
const journal = require('./journal');
// Write-time validation of the fields other commands resolve against git. Same reason the journal
// hooks into mutate() and nowhere else: one place every fact enters state, so no write site can
// forget. Neither module requires this one back.
const records = require('./records');
const { UserError } = require('./util');

const HOME = os.homedir();
const COLAB_DIR = process.env.COLAB_HOME || path.join(HOME, '.colab');
const STATE_FILE = path.join(COLAB_DIR, 'state.json');
const CONFIG_FILE = path.join(COLAB_DIR, 'config.json');
const LOCK_DIR = path.join(COLAB_DIR, 'state.lock');

const STATE_VERSION = 1;

const DEFAULT_CONFIG = {
  repos: [],              // absolute repo roots to scan for .github/project.yml `ports:`
  extraReserved: [],      // reserved ports for non-repo services (e.g. a preview server)
  reservedFiles: [],      // machine-local files of reserved ports (lenient: whitespace ints, # comments)
  claimTTLHours: 24,      // worktree-less claims older than this are flagged by `doctor`
  plannerClaimTTLMinutes: 30, // #326: a planner `--session intent:<id>` claim older than this never got its session
  portRange: '5200-5999', // default search window for `port alloc` / `worktree new`
  // Optional observer endpoint. Unset (the default) = colab makes no network call of its own, ever.
  // Set it and state-changing commands POST one best-effort event each; see lib/notify.js for why
  // it is deliberately undependable. Absent rather than '' so `config show` does not advertise it.
  //
  // Optional LOCAL journal (`journal: true`). Unset = colab writes no journal file, ever. Set it and
  // every state transition and every invocation is appended to ~/.colab/journal.jsonl; see
  // lib/journal.js. Absent rather than false, for the same reason as notifyUrl. Unrelated to
  // notifyUrl: one is a local append-only file, the other a push to somebody else's receiver.
  //
  // Optional claim tie-break identity granularity (`claimIdentity: "login,host,session"`). Unset =
  // "login,host" (unchanged behaviour): two sessions of one GitHub account on one host are
  // indistinguishable to the tie-break (#267). See tools/lib/claim-identity.js and `colab config
  // set claimIdentity` for the tradeoff (only safe where --session is stable across a resume).
  // Absent rather than the coarse string, for the same reason as journal/notifyUrl.
};

function ensureDir() {
  fs.mkdirSync(COLAB_DIR, { recursive: true });
}

function emptyState() {
  return { version: STATE_VERSION, worktrees: {}, claims: {}, ports: {}, solo: {}, places: {} };
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    if (e.code === 'ENOENT') return { ...DEFAULT_CONFIG };
    throw new Error(`config.json is not valid JSON (${CONFIG_FILE}): ${e.message}`);
  }
}

function saveConfig(cfg) {
  ensureDir();
  atomicWrite(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const st = JSON.parse(raw);
    return migrate(st);
  } catch (e) {
    if (e.code === 'ENOENT') return emptyState();
    throw new Error(`state.json is not valid JSON (${STATE_FILE}): ${e.message}`);
  }
}

function migrate(st) {
  if (!st || typeof st !== 'object') return emptyState();
  if (!st.version) st.version = STATE_VERSION;
  st.worktrees = st.worktrees || {};
  st.claims = st.claims || {};
  st.ports = st.ports || {};
  st.solo = st.solo || {};
  st.places = st.places || {};
  // Future migrations key off st.version here.
  return st;
}

function atomicWrite(file, content) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function saveState(st) {
  ensureDir();
  st.version = STATE_VERSION;
  atomicWrite(STATE_FILE, JSON.stringify(st, null, 2) + '\n');
}

function sleep(ms) {
  // Busy-wait sleep; keeps the lock helper synchronous (no async plumbing through the CLI).
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

/*
 * The state lock (#712). `mkdir LOCK_DIR` is still the acquire — atomic, and the same primitive an
 * older colab on this machine uses, so the two still exclude each other. What changed is that the
 * holder now writes LOCK_OWNER inside it, and a waiter uses that record to tell a dead lock from a
 * live one. Before, the directory recorded nothing: a holder that died inside the critical section
 * left it forever, every state write on the machine (claims, worktrees, ports, places, ship) failed
 * with "Lock stuck", and nobody could tell whether removing it by hand was safe.
 *
 * A waiter breaks the lock itself, logging one line, only when the holder is provably gone:
 *   - its pid is dead (same host), or
 *   - its pid is alive but started at a different time than the record says (pid reused), or
 *   - liveness cannot be proven at all — no readable owner (an older colab, or a holder that died
 *     between mkdir and writing the record), another host, or a start time `ps` cannot give — AND
 *     the lock is older than LOCK_STALE_MS, far above any real critical section (they are
 *     synchronous file edits: milliseconds).
 * A live, matching holder is never broken, however old: the waiter gives up with the holder named.
 *
 * Breaking is race-safe in two layers. Breakers serialize on LOCK_BREAK (a second mkdir lock, held
 * for microseconds), and inside it the breaker renames LOCK_DIR to a private name and re-reads the
 * owner from THAT copy: only the exact stale owner it judged (same token) is removed. Anything else
 * — a waiter that acquired a fresh lock in between — is renamed straight back.
 */
const LOCK_OWNER = 'owner.json';
const LOCK_BREAK = LOCK_DIR + '.break';
const LOCK_STALE_MS = 60 * 1000;
const PROC_START_MS = Date.now() - Math.round(process.uptime() * 1000);
const START_TOLERANCE_MS = 3000;   // `ps -o lstart` truncates to whole seconds; uptime starts after exec

function lockOwnerRecord() {
  return {
    pid: process.pid, host: os.hostname(), start: PROC_START_MS, at: Date.now(),
    token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

/** The owner record in `dir`, or null when absent/unreadable (an older colab, or mid-write). */
function readLockOwner(dir = LOCK_DIR) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dir, LOCK_OWNER), 'utf8'));
    return o && Number.isInteger(o.pid) && typeof o.token === 'string' ? o : null;
  } catch (_) { return null; }
}

/** true = alive, false = no such process, null = cannot tell. */
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) {
    if (e.code === 'ESRCH') return false;
    if (e.code === 'EPERM') return true;    // exists, owned by someone else
    return null;
  }
}

/** Start time (ms) of a live pid per `ps`, or null when ps cannot say. */
function pidStartMs(pid) {
  try {
    const out = require('child_process').execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
    const t = Date.parse(out);
    return Number.isFinite(t) ? t : null;
  } catch (_) { return null; }
}

/**
 * Judge the lock currently at LOCK_DIR. Returns { stale, owner, ageMs, reason } or null when there
 * is no lock to judge. `startCache` (token -> ps start) keeps `ps` to once per holder per wait.
 */
function judgeLock(startCache = new Map(), now = Date.now()) {
  let st;
  try { st = fs.statSync(LOCK_DIR); } catch (_) { return null; }
  const owner = readLockOwner();
  const ageMs = Math.max(0, now - (owner && Number.isFinite(owner.at) ? owner.at : st.mtimeMs));
  const old = ageMs > LOCK_STALE_MS;
  if (!owner) return { stale: old, owner, ageMs, reason: 'no owner record' };
  if (owner.host && owner.host !== os.hostname()) return { stale: old, owner, ageMs, reason: `held from host ${owner.host}` };
  const alive = pidAlive(owner.pid);
  if (alive === false) return { stale: true, owner, ageMs, reason: `pid ${owner.pid} is gone` };
  if (alive === null) return { stale: old, owner, ageMs, reason: `pid ${owner.pid} liveness unknown` };
  if (!startCache.has(owner.token)) startCache.set(owner.token, pidStartMs(owner.pid));
  const psStart = startCache.get(owner.token);
  if (psStart == null || !Number.isFinite(owner.start)) {
    return { stale: old, owner, ageMs, reason: `pid ${owner.pid} alive, start time unverifiable` };
  }
  if (Math.abs(psStart - owner.start) > START_TOLERANCE_MS) {
    return { stale: true, owner, ageMs, reason: `pid ${owner.pid} was reused by another process` };
  }
  return { stale: false, owner, ageMs, reason: `pid ${owner.pid} is alive` };
}

function describeHolder(j) {
  if (!j) return 'holder unknown (lock vanished)';
  const age = `${Math.round(j.ageMs / 1000)}s old`;
  if (!j.owner) return `no owner recorded, ${age}`;
  return `held by pid ${j.owner.pid} on ${j.owner.host || '?'}, ${age} — ${j.reason}`;
}

function rmLockDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

/**
 * Remove the lock `judged` found stale — but only if it is still that same lock. Returns true when
 * it removed it. Never throws: a failed break just means the waiter keeps waiting.
 */
function breakStaleLock(judged, log = (m) => process.stderr.write(m + '\n')) {
  try { fs.mkdirSync(LOCK_BREAK); } catch (e) {
    // Another breaker is at it. A breaker that died mid-break leaves an empty LOCK_BREAK; clear it
    // once it is far older than the microseconds a break takes, and let the next round retry.
    try { if (Date.now() - fs.statSync(LOCK_BREAK).mtimeMs > 10 * 1000) fs.rmdirSync(LOCK_BREAK); } catch (_) { /* gone */ }
    return false;
  }
  try {
    const grave = `${LOCK_DIR}.stale-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    try { fs.renameSync(LOCK_DIR, grave); } catch (_) { return false; }   // released meanwhile
    const now = readLockOwner(grave);
    const same = judged.owner ? (now && now.token === judged.owner.token) : !now;
    if (!same) {
      // A fresh lock replaced the stale one between judging and renaming — put it back untouched.
      try { fs.renameSync(grave, LOCK_DIR); } catch (_) { /* LOCK_DIR re-taken: nothing safe to do */ }
      return false;
    }
    rmLockDir(grave);
    log(`colab: broke a stale state lock ${LOCK_DIR} (${describeHolder(judged)})`);
    return true;
  } finally {
    try { fs.rmdirSync(LOCK_BREAK); } catch (_) { /* gone */ }
  }
}

/** Acquire the state lock, run fn, always release. Returns fn's result. */
function withLock(fn, { tries = 100, waitMs = 100, log } = {}) {
  ensureDir();
  const startCache = new Map();
  let me = null;
  let written = false;
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      fs.mkdirSync(LOCK_DIR);
      me = lockOwnerRecord();
      try { fs.writeFileSync(path.join(LOCK_DIR, LOCK_OWNER), JSON.stringify(me) + '\n'); written = true; } catch (_) {
        // Unrecorded is still a held lock — it just ages out like an older colab's would.
      }
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      last = judgeLock(startCache);
      if (last && last.stale && breakStaleLock(last, log)) continue;   // retry the mkdir at once
      sleep(waitMs);
    }
  }
  if (!me) {
    const holder = describeHolder(judgeLock(startCache) || last);
    throw new Error(`Lock stuck: ${LOCK_DIR} (${holder}). `
      + 'A live holder is never broken automatically; remove the directory by hand only if that process is not a colab writer.');
  }
  try {
    return fn();
  } finally {
    // Release only our own lock: if a waiter judged us dead and broke it, LOCK_DIR is now theirs —
    // including an ownerless one, when we did write our record and it is no longer there.
    const cur = readLockOwner();
    if (cur ? cur.token === me.token : !written) rmLockDir(LOCK_DIR);
  }
}

/**
 * Load → mutate under lock → save, in one atomic critical section.
 *
 * Also the ONE place every fact enters or leaves state, which is why the optional journal
 * (lib/journal.js) hooks here and nowhere else: a before/after diff taken around `fn` captures all
 * 13 delete sites and every write, with no per-command plumbing and no chance of a caller
 * forgetting to report. It is off unless `journal: true` is configured, and when off `snapshot()`
 * returns null on its first line, so the disabled path costs one boolean and allocates nothing.
 *
 * It is also where the write-time record validation runs (lib/records.js), for the same structural
 * reason and with one deliberate difference: the journal observes and cannot fail a mutation, while
 * validation REFUSES one. It throws before saveState, so a refused write leaves the file exactly as
 * it was — and it only judges fields this mutation CHANGED, so a legacy-bad record already on disk
 * does not turn every later command into a crash. That record is `colab doctor`'s to report.
 *
 * Two properties the journal must never cost us, both structural rather than promised:
 *   - It cannot fail a mutation. Everything journal-related is inside try/catch, and the catch is
 *     empty on purpose — a full disk must not roll back a claim that succeeded.
 *   - It cannot hold the lock. Only the diff is computed inside the critical section; the append
 *     happens after withLock has returned, so a slow filesystem blocks no other session.
 */
function mutate(fn) {
  // NOT named `records`: that shadowed the module of the same name for the whole closure, so the
  // guard below read `null.snapshot` and every state write died. Caught by the new tests.
  let journalRecords = null;
  const result = withLock(() => {
    const st = loadState();
    let before = null;
    try { before = journal.snapshot(st); } catch (_) { before = null; }
    const guard = records.snapshot(st);
    const r = fn(st);
    const problems = records.changedProblems(guard, st);
    if (problems.length) throw new UserError(records.refusalMessage(problems));
    saveState(st);
    if (before) {
      try { journalRecords = journal.recordDiff(before, journal.snapshot(st)); } catch (_) { journalRecords = null; }
    }
    return r;
  });
  if (journalRecords && journalRecords.length) {
    try { journal.append(journalRecords); } catch (_) { /* never at the expense of the mutation */ }
  }
  return result;
}

module.exports = {
  COLAB_DIR, STATE_FILE, CONFIG_FILE, LOCK_DIR, LOCK_OWNER, LOCK_STALE_MS, STATE_VERSION, DEFAULT_CONFIG,
  loadConfig, saveConfig, loadState, saveState, withLock, mutate, emptyState, atomicWrite,
  _lock: { judgeLock, breakStaleLock, readLockOwner },   // for tools/lib/state-lock.test.js
};
