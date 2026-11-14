'use strict';
/**
 * #744 — `colab claim --force` over ANOTHER FACTORY's claim.
 *
 * Before this, `--force` took over any holder without a human; only a live checkout place-claim
 * asked for `COLAB_HUMAN=1`. Inside one team that is a session clearing a dead colleague's claim.
 * Across factories (`.github/factories.yml`, #739) it is one team taking another team's work, so the
 * takeover needs both of:
 *
 *   - the STALE rule — nothing new on the holder's claim for STALE_DAYS (5) days: the newest commit
 *     on any remote ref that carries the issue (the claim lock, a legacy claim ref, the claim's
 *     branch), or, with no remote ref at all, the newest live claim comment; and
 *   - a HUMAN — `COLAB_HUMAN=1` together with `--answered-by <name>`, the bar `colab release
 *     finalize` and `colab ship`'s human door already use.
 *
 * WHO IS ANOTHER FACTORY. Read from trunk's committed factories file only (the caller's job, the
 * `trust-humans:` rule). No file → one team, the rule is off and `--force` behaves as before. A file
 * is present → a foreign holder counts as another factory UNLESS it is proven to be this machine's
 * own factory: an unknown holder (a branch with no machine prefix, an agent login, a machine the file
 * does not list) and an invalid file both fail closed, the stance `factories.js` takes everywhere.
 *
 * PURE: decisions over values the caller read. No git, no network, no clock (`nowMs` is passed in).
 */

const { machineLabel, parse: parseBranch } = require('./branch-name.js');
const { sameHostName } = require('./machine.js');

const STALE_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function usableDoc(parsed) { return parsed && parsed.valid && parsed.doc ? parsed.doc : null; }

/**
 * The factory a machine NAME belongs to, compared as branch-prefix labels on both sides (`Box_A.local`
 * and `box-a` are one machine), or null. A factories file lists machine ids as labels, and a claim
 * lock's `Machine:` trailer is one.
 */
function factoryOfMachineName(parsed, name) {
  const doc = usableDoc(parsed);
  const want = machineLabel(name || '');
  if (!doc || !want) return null;
  for (const [id, f] of Object.entries(doc.factories)) {
    if (f.machines.some((m) => machineLabel(m) === want)) return id;
  }
  return null;
}

/** The factory a hostname — raw, or the `h:` token a public claim comment carries — belongs to. */
function factoryOfHost(parsed, host) {
  const doc = usableDoc(parsed);
  if (!doc || !host) return null;
  for (const [id, f] of Object.entries(doc.factories)) {
    if (f.machines.some((m) => sameHostName(m, host))) return id;
  }
  return null;
}

/** The ONE factory every login in `logins` is a declared human of, or null (none, or split). */
function factoryOfLogins(parsed, logins) {
  const doc = usableDoc(parsed);
  if (!doc || !logins || !logins.length) return null;
  const ids = new Set();
  for (const login of logins) {
    const l = String(login || '').toLowerCase();
    const id = Object.entries(doc.factories).find(([, f]) => f.humans.includes(l));
    if (!id) return null;
    ids.add(id[0]);
  }
  return ids.size === 1 ? [...ids][0] : null;
}

/**
 * The factory holding a conflict, or null when the record does not say. `c` is one entry of the
 * conflict lists `colab claim` builds:
 *   kind 'remote'  — `{ lock, machine, branch, claimRef }`: a lock names its machine; a branch (or a
 *                    legacy claim ref) names one only through a `<login>/<machine>/` prefix.
 *   kind 'gh'      — `{ assignees, otherMachine?, cotenant? }`: a claim comment names its host; an
 *                    assignee is resolved through the file's `humans`.
 *   kind 'local'   — this machine's own state, so this machine's factory.
 */
function holderFactory(parsed, kind, c, mine = null) {
  if (!usableDoc(parsed) || !c) return null;
  if (kind === 'local') return mine;
  if (kind === 'remote') {
    if (c.lock) return factoryOfMachineName(parsed, c.machine) || prefixFactory(parsed, c.branch);
    return prefixFactory(parsed, c.branch);
  }
  if (kind === 'gh') {
    const comment = c.otherMachine || c.cotenant || null;
    if (comment) return factoryOfHost(parsed, comment.host) || factoryOfLogins(parsed, [comment.login]);
    return factoryOfLogins(parsed, c.assignees || []);
  }
  return null;
}

function prefixFactory(parsed, branch) {
  const p = branch ? parseBranch(branch) : null;
  return p && p.machine ? factoryOfMachineName(parsed, p.machine) : null;
}

/**
 * Is taking over ONE issue a cross-factory takeover? `file` = `{ present, parsed }` read from trunk;
 * `holders` = the factory each record holding the issue resolves to (`holderFactory`), null where a
 * record does not say. One issue is often held by several records of ONE holder — a lock naming its
 * machine, an assignee naming nothing — so a silent record defers to one that speaks.
 *   no file                             → false (one team; nothing here applies)
 *   invalid file                        → true  (fail closed: an invalid file trusts nobody)
 *   a record proves another factory     → true
 *   no record proves any factory        → true  (a holder nothing ties to this team)
 *   every proving record says mine      → false
 */
function isCrossFactory(file, mine, holders) {
  if (!file || !file.present) return false;
  if (!usableDoc(file.parsed)) return true;
  const proven = (holders || []).filter(Boolean);
  if (!mine || !proven.length) return true;
  return proven.some((f) => f !== mine);
}

/**
 * The newest activity time (ms) across what a holder left — commit times of its remote refs and the
 * times of its live claim comments — or null when nothing could be read. `times` = numbers or null.
 */
function lastActivity(times) {
  const known = (times || []).filter((t) => Number.isFinite(t));
  return known.length ? Math.max(...known) : null;
}

/** `{ stale, idleDays }` — unknown activity is never stale (fail closed). */
function staleness(lastMs, nowMs, days = STALE_DAYS) {
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return { stale: false, idleDays: null };
  const idle = nowMs - lastMs;
  return { stale: idle >= days * DAY_MS, idleDays: Math.floor(idle / DAY_MS) };
}

/**
 * The verdict for one cross-factory takeover: `{ ok, missing: [..] }`, `missing` naming each bar
 * not met — 'human' (COLAB_HUMAN=1 with --answered-by) and/or 'stale'. Both are always reported, so
 * one refusal says everything a person has to fix.
 */
function takeoverVerdict({ colabHuman, answeredBy, stale }) {
  const missing = [];
  if (!(colabHuman && String(answeredBy || '').trim())) missing.push('human');
  if (!stale) missing.push('stale');
  return { ok: missing.length === 0, missing };
}

module.exports = {
  STALE_DAYS, DAY_MS,
  factoryOfMachineName, factoryOfHost, factoryOfLogins, holderFactory, isCrossFactory,
  lastActivity, staleness, takeoverVerdict,
};
