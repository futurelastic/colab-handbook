'use strict';
/**
 * tools/lib/release-cut.js — the decision behind `colab release cut` (#338).
 *
 * CONVENTIONS.md §6's release rung lets an agent cut a release CANDIDATE, `vX.Y.Z-rc.N`, where the
 * rung row says so and only once four conditions hold on the exact commit the tag names. This module
 * is that decision, pure: facts in (what the CLI measured from git, `gh` and project.yml), a verdict
 * out — a list of named checks, each `ok` or not, and the tag to create when every one is.
 *
 * PURE BY CONSTRUCTION, the ci-verdict.js / release-policy.js posture: no git, no network, no `gh`,
 * no clock. Every refusal is reachable from `node --test` without a fixture repo; the CLI tests in
 * release-cut-cli.test.js cover the measuring half.
 *
 * The checks, in the order they are reported (the `condition` names are a closed vocabulary — a
 * caller reading `--json` keys on them):
 *
 *   release-policy       the rung row + the repo's `release:` block (release-policy.js — the SAME
 *                        reading the audit uses) leave `candidates: auto`
 *   prerelease-trigger   no deploy workflow fires on a pre-release tag (workflow-triggers.js — the
 *                        SAME logic as the audit's #332 check, not a second copy)
 *   version              a patch/minor bump is owed and allowed: never a major, never 0.x -> 1.0,
 *                        never onto a version that is already final
 *   already-candidate    the commit does not already carry a candidate of this version
 *   ci-green             §6 condition 1 — every run at the sha finished, one succeeded
 *   full-suite           §6 condition 2 — every workflow that ran at the sha has a successful run
 *                        (both over the code-verifying runs only, the ship gate's rule — #624)
 *   schema-additive      §6 condition 3 — no destructive migration since the last final tag
 *   switch-dependencies  §6 condition 4 — the colab:switch markers are readable, and no finished
 *                        switch needs one that is still unfinished
 *
 *   manifest-version     #424 — the tag equals every declared manifest's version (release-tag.js)
 *   on-trunk             #424 — the commit is an ancestor of the release branch, `main` — on every
 *                        trunk shape (§6: never tag from `dev`); a shallow checkout is a refusal
 *   outranks-final       #424 — the version is strictly greater than the highest final tag
 *   cadence              #422, --auto only — a declared release.candidates-per-day cap (no route has
 *                        one by default since #443); inside the window the run is a NO-OP
 *                        (verdict.noop), not a refusal, and the first run after it cuts main's head
 *   already-candidate    (above) under --auto, head already carrying a candidate is a NO-OP (#443):
 *                        the newest candidate names head, which is the guarantee holding
 *   promotion            #429, --auto on `trunk:` other than `main` only — `main`'s head is a promotion
 *                        of trunk (a --no-ff merge whose later parent is on trunk, or a fast-forward
 *                        onto trunk). Any other head is a NO-OP, like cadence; an unread trunk refuses.
 *                        Absent entirely on `trunk: main`, so that repo's --json is unchanged.
 *
 * `--auto` (#422) computes the bump with no human input (autoSignals + decideAutoVersion): commit
 * types, a repo guard's result and an exports diff, majors included — a major only with a migration
 * section carrying its measured cost (parseMigrationSection). Every signal is written into the tag
 * message, so the reason for the bump is recorded mechanically.
 *
 * Never a final tag — with two exceptions, `library-fast` (#590, below) and `deploy-tag-fast` (#446): on the latter the operator granted a
 * final on every green trunk head, so `--auto` tags `vX.Y.Z` directly (no candidate, no test period)
 * and the release workflow deploys it in the same run. That branch adds five checks, all in the
 * same closed vocabulary:
 *
 *   spacing              --auto only — finals at least release.final-spacing apart; inside the window
 *                        the run is a NO-OP, and the first run after it tags main's head
 *   already-final        replaces already-candidate — a head already carrying a final is a NO-OP
 *   final-grant          the operator's recorded decision still resolves (release-policy.js
 *                        finalGrantVerdict — the #441 reader, unchanged)
 *   release-hold         no open issue carries the human veto label
 *   migration-grant      no migration since the last final unless the version's tracking issue is
 *                        granted one — otherwise a refusal whose `handoff` names the human command
 *
 * #590: route `library-fast` is the second final route — a library released per merge, nothing
 * deployed. `cut` (by hand or `--auto`) tags `vX.Y.Z` directly once a first final exists, with
 * `already-final` in place of `already-candidate` and the `release-hold` veto, and none of the fast
 * route's grant, spacing, migration hand-off or health gate. Its version on `version-source:
 * manifest` is the manifest's (decideManifestVersion): equal to the last final is a NO-OP, a break the
 * manifest under-declares is a refusal; on `version-source: tag` the bump is computed as for a
 * candidate.
 *
 * Elsewhere finalizing a candidate is the release skill's (#339), and a final is a human act on
 * every row where a tag reaches production.
 */

const migrationPaths = require('./migration-paths');
const releaseTag = require('./release-tag');
const { stripCode } = require('./instruction-file');
const verifyRuns = require('./verify-runs');

const VERSION_RE = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const BUMPS = Object.freeze(['patch', 'minor']);

/**
 * The branch a candidate is cut on and a final is tagged on — `main`, whatever `trunk:` says (§6:
 * "Do not tag from `dev`"). This is NOT project.yml's `trunk:`; on `trunk: dev` the two differ and
 * the candidate is cut on the promotion merge (#429).
 */
const RELEASE_BRANCH = 'main';

const CONDITIONS = Object.freeze([
  'release-policy', 'cadence', 'spacing', 'promotion', 'qualified-sha', 'prerelease-trigger', 'version', 'already-candidate', 'already-final',
  ...releaseTag.PRE_TAG_CONDITIONS,
  'ci-green', 'full-suite', 'schema-additive', 'switch-dependencies',
  'final-grant', 'release-hold', 'migration-grant',
]);

/**
 * #467: the refusals that do NOT clear by themselves. A run refused on one of these refuses again on
 * the next run and the one after — nothing but a human act (a first final tag, a fixed marker, a
 * fixed manifest, a recorded grant) moves it — so the release workflow reports it as a STALL, an
 * error annotation, never as the routine warning a CI-still-running refusal gets. The rest are
 * transient: `ci-green` / `full-suite` (a run in flight, a red run the next merge fixes), an UNREAD
 * anything (a read that failed — the next run reads again), and `release-hold` (a deliberate human
 * veto is not a stall; it is the system working). Classified in decide() as `standing`.
 */
const STANDING_CONDITIONS = Object.freeze([
  'release-policy', 'prerelease-trigger', 'version', 'schema-additive', 'switch-dependencies',
  ...releaseTag.PRE_TAG_CONDITIONS, 'final-grant', 'migration-grant',
]);

/** #446: the conditions only route deploy-tag-fast reports. */
const FAST_CONDITIONS = Object.freeze(['spacing', 'already-final', 'final-grant', 'release-hold', 'migration-grant']);

/** #446: the label a human puts on an issue to veto a release — the same one release-finalize reads. */
const HOLD_LABEL = 'release-hold';

/** #446: is this policy the fast route, where `cut --auto` tags the final itself? */
function isFastRoute(policy) {
  return !!(policy && policy.effective && policy.effective.finalize === 'on-green-head');
}

/**
 * #590: is this policy route library-fast as declared — no candidates, an automatic final reached
 * by the tag itself? There `cut` tags the FINAL directly, as on deploy-tag-fast, but nothing deploys:
 * no grant, no spacing, no migration hand-off, no health gate. A `final: human` narrowing keeps
 * `finalize: on-tag` but makes every final a human act, so it is not this.
 */
function isLibraryRoute(policy) {
  const e = policy && policy.effective;
  return !!(e && e.finalize === 'on-tag' && e.final === 'auto' && e.candidates === 'off');
}

/** #590: the route a refusal names — the one in effect, never the derived default it replaced. */
function routeWhy(policy) {
  const releasePolicy = require('./release-policy');
  const route = policy && policy.effective && policy.effective.route;
  const own = route && releasePolicy.ROUTE_POLICY[route];
  return { route, why: own ? own.why : policy.derived.why };
}

/** The file a major's migration section is read from, at the candidate commit (#422). */
const MIGRATION_FILE = 'MIGRATION.md';

/** `vX.Y.Z` -> { major, minor, patch }, or null for anything else (a candidate included). */
function parseVersion(tag) {
  const m = VERSION_RE.exec(String(tag || ''));
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

function formatVersion(v) { return `v${v.major}.${v.minor}.${v.patch}`; }

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** The candidate numbers already used for `version` (`vX.Y.Z`) among `tags`, ascending. */
function candidateNumbers(tags, version) {
  const re = new RegExp(`^${escapeRe(version)}-rc\\.([1-9][0-9]*)$`);
  return (tags || []).map((t) => re.exec(t)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
}

/** Next `N` for `vX.Y.Z-rc.N`: one past the highest used, so a deleted rc.2 is never re-issued over rc.3. */
function nextCandidateNumber(tags, version) {
  const used = candidateNumbers(tags, version);
  return used.length ? used[used.length - 1] + 1 : 1;
}

/**
 * Which version the candidate is for.
 *
 *   lastFinal   the nearest final tag on main (release-tag.js — candidates skipped), or null
 *   suggestion  release-status's `semverSuggestion` shape: { bump: 'major'|'minor'|'patch'|null, why }
 *   override    { bump, reason } from --bump/--reason, either may be absent
 *   tags        every tag name in the repo, to refuse a version that is already final
 *
 * Returns { ok, detail, version?, bump?, why?, overridden? }. Refusal order is deliberate: a request
 * for a major is refused before anything is read about the commits, because no fact changes it.
 */
function decideVersion({ lastFinal, suggestion, override, tags }) {
  const o = override || {};
  const s = suggestion || { bump: null, why: 'no suggestion' };
  const refuse = (detail) => ({ ok: false, detail });

  if (o.bump !== undefined && o.bump !== null) {
    if (o.bump === 'major') {
      return refuse('--bump major refused: a major — including the pre-1.0 -> 1.0.0 step — is a human decision (CONVENTIONS.md §6, Versioning); no flag lets an agent cut one');
    }
    if (!BUMPS.includes(o.bump)) return refuse(`--bump ${JSON.stringify(o.bump)} is not patch or minor`);
    if (!o.reason || !String(o.reason).trim()) {
      return refuse(`--bump ${o.bump} needs --reason "<why>": an override of the computed bump is recorded on the tag, and an unexplained one cannot be`);
    }
  }

  if (!lastFinal) return refuse('no final release tag (vX.Y.Z) on main yet — the first version is a human decision, not a computed bump');
  const last = parseVersion(lastFinal);
  if (!last) return refuse(`the last release tag ${lastFinal} is not vX.Y.Z — cannot compute a bump from it`);

  let computed = s.bump || null;
  let why = s.why || '';
  if (computed === 'major') {
    if (last.major > 0) {
      return refuse(`a breaking change since ${lastFinal} (${why}) on a >=1.0 repo — ${last.major + 1}.0.0 is a human decision, so nothing is cut (CONVENTIONS.md §6). ` +
        'If the change is not in fact breaking, a human says so; --bump does not override a detected breaking change');
    }
    computed = 'minor';
    why = `${why}; pre-1.0, a breaking change ships as a minor (SemVer §4, CONVENTIONS.md §6)`;
  }

  const bump = o.bump || computed;
  if (!bump) {
    return refuse(`${why || 'no bump computed'} — nothing to cut. If a release is owed anyway, pass --bump patch|minor --reason "<why>"`);
  }

  const next = bump === 'minor'
    ? { major: last.major, minor: last.minor + 1, patch: 0 }
    : { major: last.major, minor: last.minor, patch: last.patch + 1 };
  // Unreachable through the arithmetic above — kept so a future edit that lets a major through
  // fails here, loudly, rather than tagging one.
  if (next.major !== last.major) return refuse(`${formatVersion(next)} changes the major version — a human decision`);

  const version = formatVersion(next);
  if ((tags || []).includes(version)) return refuse(`${version} is already a final tag — a candidate for a released version is meaningless`);

  const overridden = o.bump && o.bump !== computed ? { from: computed, to: o.bump, reason: String(o.reason).trim() } : null;
  const detail = overridden
    ? `${lastFinal} -> ${version} (${bump}, overridden from ${computed || 'no bump'}: ${overridden.reason})`
    : `${lastFinal} -> ${version} (${bump}: ${why})`;
  return { ok: true, detail, version, bump, why, overridden };
}

// ---- --auto: the computed bump (#422) ---------------------------------------------------------
//
// CONVENTIONS.md §6, *Versioning*: fixes/chores -> patch; a feature or an epic's switch-removal child
// -> minor; a breaking change -> minor below 1.0, major from 1.0. Breaking is read from three places,
// because the break that bites is the one the commit types do not reveal:
//
//   commits   `!` / `BREAKING CHANGE:` since the last final
//   guard     a repo-declared detector (project.yml `release.guard-run` — a command — or
//             `release.guard-result` — a file an earlier CI step wrote). THE CONTRACT: one JSON object
//             { "breaking": true|false, "findings": ["<one line each>"] } on stdout / in the file.
//             Exit non-zero, unparseable output or a missing file is a REFUSAL — an unread guard is
//             not a clean one. The command runs at the repo root with COLAB_RELEASE_FROM (the last
//             final tag) and COLAB_RELEASE_SHA (the commit being tagged) in its environment.
//   exports   a removed or renamed public export since the last final: package.json `exports`
//             subpaths and `bin` names, plus — when `release.exports` names one — a committed list
//             of public symbols, one per line (`#` comments allowed); a line gone is a break (a
//             rename is a removal plus an addition).

/** Validate one guard's raw output against the contract. Returns { name, breaking, findings } or { name, error }. */
function parseGuardOutput(name, text) {
  let j;
  try { j = JSON.parse(String(text || '').trim()); } catch (e) {
    return { name, error: `${name} output is not JSON (${e.message}) — expected {"breaking": bool, "findings": [string]}` };
  }
  if (!j || typeof j !== 'object' || Array.isArray(j) || typeof j.breaking !== 'boolean') {
    return { name, error: `${name} output has no boolean "breaking" — expected {"breaking": bool, "findings": [string]}` };
  }
  const findings = j.findings === undefined ? [] : j.findings;
  if (!Array.isArray(findings) || findings.some((f) => typeof f !== 'string')) {
    return { name, error: `${name} "findings" is not a list of strings` };
  }
  return { name, breaking: j.breaking, findings };
}

function pkgExportKeys(pkg) {
  const keys = new Set();
  if (!pkg || typeof pkg !== 'object') return keys;
  const ex = pkg.exports;
  if (typeof ex === 'string' || Array.isArray(ex)) keys.add('exports:.');
  else if (ex && typeof ex === 'object') {
    const sub = Object.keys(ex).filter((k) => k.startsWith('.'));
    if (sub.length) for (const k of sub) keys.add(`exports:${k}`);
    else keys.add('exports:.'); // a conditions-only map is the root export
  }
  if (typeof pkg.bin === 'string') keys.add(`bin:${pkg.name || '(package name)'}`);
  else if (pkg.bin && typeof pkg.bin === 'object') for (const k of Object.keys(pkg.bin)) keys.add(`bin:${k}`);
  return keys;
}

function listLines(text) {
  return new Set(String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
}

/**
 * Removed public exports between the last final (`before`) and the candidate (`after`).
 *   before/after  { pkg: string|null, list: string|null } — package.json text and the declared list
 *                 file's text at each side (null = absent)
 *   listFile      release.exports, or null
 * Returns { removed: [string], detail } or { error }.
 */
function exportsDiff({ before, after, listFile }) {
  const parse = (t, side) => {
    if (t === null || t === undefined) return { pkg: null };
    try { return { pkg: JSON.parse(t) }; } catch (e) { return { error: `package.json at ${side} does not parse (${e.message})` }; }
  };
  const b = parse(before && before.pkg, 'the last final');
  const a = parse(after && after.pkg, 'the candidate');
  if (b.error || a.error) return { error: b.error || a.error };
  const removed = [];
  const bk = pkgExportKeys(b.pkg); const ak = pkgExportKeys(a.pkg);
  for (const k of bk) if (!ak.has(k)) removed.push(`package.json ${k.replace(':', ' ')}`);
  const read = ['package.json exports/bin'];
  if (listFile) {
    if (!after || after.list === null || after.list === undefined) {
      return { error: `release.exports names ${listFile}, which does not exist at the candidate — an unread export list is not a clean one` };
    }
    if (before && before.list !== null && before.list !== undefined) {
      const al = listLines(after.list);
      for (const l of listLines(before.list)) if (!al.has(l)) removed.push(`${listFile}: ${l}`);
      read.push(listFile);
    } else read.push(`${listFile} (new since the last final — no baseline)`);
  }
  return { removed, detail: removed.length ? `removed export(s): ${removed.join('; ')}` : `no export removed (read: ${read.join(', ')})` };
}

/**
 * Switch-removal children (`role=remove`) closed done after `sinceIso` — each one makes the release a
 * minor. `only` (#429), a Set of issue numbers, replaces the date filter: on `trunk:` other than
 * `main` an issue closes when it merges to trunk, not when it is promoted, so the caller passes the
 * issues whose closing keyword is in the promoted range and the close date stops deciding.
 */
function switchRemovalsSince(issues, sinceIso, { only = null } = {}) {
  const since = Date.parse(sinceIso || '');
  const out = [];
  for (const issue of issues || []) {
    if (!closedDone(issue)) continue;
    if (only) {
      if (!only.has(Number(issue.number))) continue;
    } else {
      const closed = Date.parse(issue.closedAt || '');
      if (!Number.isNaN(since) && !(closed > since)) continue;
    }
    const { markers } = parseSwitchMarkers(issue.body);
    for (const mk of markers) if (mk.role === 'remove') out.push({ number: issue.number, name: mk.name });
  }
  return out;
}

/**
 * Every bump signal, gathered — the input decideAutoVersion reads and the lines the release notes
 * print. `cc` is ccSummary's shape { total, counts, breaking }; `guard` is null (none declared) or a
 * parseGuardOutput result; `exports` an exportsDiff result; `switchRemovals` switchRemovalsSince's.
 * Returns { total, breaking: [why], minor: [why], patch: [why], unread: [why], lines: [string] }.
 */
function autoSignals({ cc, guard, exports: ex, switchRemovals }) {
  const c = cc || { total: 0, counts: {}, breaking: false };
  const counts = c.counts || {};
  const sig = { total: c.total || 0, breaking: [], minor: [], patch: [], unread: [], lines: [] };
  const line = (s) => sig.lines.push(s);

  if (c.breaking) { sig.breaking.push('a commit marked breaking (! or BREAKING CHANGE:)'); line('commits: breaking — a commit marked ! or BREAKING CHANGE:'); }
  else line('commits: no commit marked breaking');
  if (counts.feat) sig.minor.push(`${counts.feat} feat commit(s)`);
  if (sig.total) {
    const parts = Object.entries(counts).filter(([, n]) => n).map(([t, n]) => `${n} ${t}`);
    line(`commits: ${sig.total} since the last final (${parts.join(', ') || 'none typed'})`);
    if (!counts.feat) sig.patch.push(`${sig.total} commit(s), none a feature`);
  } else line('commits: none since the last final');

  const sw = switchRemovals || [];
  if (sw.length) {
    sig.minor.push(`switch-removal child merged: ${sw.map((s) => `#${s.number} (${s.name})`).join(', ')}`);
    line(`switches: removed — ${sw.map((s) => `#${s.number} ${s.name}`).join(', ')}`);
  } else line('switches: no switch-removal child merged');

  if (!guard) line('guard: none declared (release.guard-run / release.guard-result)');
  else if (guard.error) { sig.unread.push(`guard ${guard.error}`); line(`guard: UNREAD — ${guard.error}`); }
  else {
    if (guard.breaking) sig.breaking.push(`guard ${guard.name} reported a breaking change`);
    line(`guard ${guard.name}: ${guard.breaking ? 'BREAKING' : 'not breaking'}${guard.findings.length ? ` — ${guard.findings.join('; ')}` : ''}`);
  }

  if (!ex) line('exports: not read');
  else if (ex.error) { sig.unread.push(`exports: ${ex.error}`); line(`exports: UNREAD — ${ex.error}`); }
  else {
    if (ex.removed.length) sig.breaking.push(`${ex.removed.length} public export(s) removed or renamed`);
    line(`exports: ${ex.detail}`);
  }
  return sig;
}

/**
 * The section of MIGRATION.md for `version` (vX.0.0): a heading naming it, up to the next heading of
 * the same or a higher level, carrying a non-empty `Measured cost:` line. Returns { ok, section, detail }.
 */
function parseMigrationSection(text, version) {
  if (text === null || text === undefined) {
    return { ok: false, section: null, detail: `no ${MIGRATION_FILE} at the candidate commit — a major needs a migration section for ${version} with its measured cost (CONVENTIONS.md §6, Versioning)` };
  }
  const lines = String(text).split(/\r?\n/);
  const want = escapeRe(version);
  let start = -1; let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (h && new RegExp(`(^|[^0-9A-Za-z.])${want}([^0-9A-Za-z.-]|$)`).test(h[2])) { start = i; level = h[1].length; break; }
  }
  if (start === -1) return { ok: false, section: null, detail: `${MIGRATION_FILE} has no heading naming ${version} — a major needs its own migration section` };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const h = /^(#{1,6})\s/.exec(lines[i]);
    if (h && h[1].length <= level) { end = i; break; }
  }
  const section = lines.slice(start, end).join('\n').trim();
  if (!/^\s*(?:[-*]\s*)?\**Measured cost:?\**:?\s*\S/im.test(section)) {
    return { ok: false, section, detail: `${MIGRATION_FILE}'s ${version} section has no non-empty "Measured cost:" line — a major states what adopters must change and how much of it was measured` };
  }
  return { ok: true, section, detail: `${MIGRATION_FILE} carries a ${version} migration section with its measured cost` };
}

/**
 * --auto's version: the bump from `signals` (autoSignals), no override possible.
 *   migration  (version) => parseMigrationSection result — asked only when the bump is a major
 * Returns decideVersion's shape plus { signals, migration }.
 */
function decideAutoVersion({ lastFinal, signals, migration, tags }) {
  const refuse = (detail, extra = {}) => ({ ok: false, detail, ...extra });
  const s = signals || { total: 0, breaking: [], minor: [], patch: [], unread: [] };
  if (s.unread && s.unread.length) return refuse(`a bump signal could not be read — fail closed: ${s.unread.join('; ')}`, { unread: true });
  if (!lastFinal) return refuse('no final release tag (vX.Y.Z) on main yet — the first version is a human decision, not a computed bump');
  const last = parseVersion(lastFinal);
  if (!last) return refuse(`the last release tag ${lastFinal} is not vX.Y.Z — cannot compute a bump from it`);
  if (!s.total && !s.breaking.length && !s.minor.length) return refuse(`nothing merged since ${lastFinal} — nothing to cut`, { nothing: true });

  let bump; let why;
  if (s.breaking.length) {
    if (last.major === 0) { bump = 'minor'; why = `${s.breaking.join('; ')} — pre-1.0, a breaking change ships as a minor (SemVer §4)`; }
    else { bump = 'major'; why = s.breaking.join('; '); }
  } else if (s.minor.length) { bump = 'minor'; why = s.minor.join('; '); }
  else { bump = 'patch'; why = s.patch.join('; ') || 'fixes/chores only'; }

  const next = bump === 'major' ? { major: last.major + 1, minor: 0, patch: 0 }
    : bump === 'minor' ? { major: last.major, minor: last.minor + 1, patch: 0 }
      : { major: last.major, minor: last.minor, patch: last.patch + 1 };
  const version = formatVersion(next);
  let mig = null;
  if (bump === 'major') {
    mig = typeof migration === 'function' ? migration(version) : (migration || null);
    if (!mig || !mig.ok) {
      return refuse(`${lastFinal} -> ${version} is a major (${why}), refused: ${mig ? mig.detail : `no migration section read for ${version}`}`, { bump, migration: mig });
    }
  }
  if ((tags || []).includes(version)) return refuse(`${version} is already a final tag — a candidate for a released version is meaningless`);
  return { ok: true, detail: `${lastFinal} -> ${version} (${bump}, computed: ${why})`, version, bump, why, overridden: null, migration: mig };
}

// ---- #590: library-fast — the version the manifest already says ------------------------------

/**
 * Route library-fast with `release.version-source: manifest`: the release is the version a merge
 * already put in the manifest, so the cut computes no bump — it checks the manifest's.
 *   manifests  release-tag.js manifestVersions() at the commit (null = unread)
 *   breaking   [why] — a breaking signal since the last final (autoSignals' `breaking`, or the
 *              manual cut's semverSuggestion when it says major); empty when none
 *   migration  (version) => parseMigrationSection result, asked only for a major
 * Returns decideVersion's shape, plus `nothing` (the manifest still says the last final — a no-op
 * under --auto) and `fallback` (no manifest declares a version: the caller computes the bump as on
 * version-source: tag).
 */
function decideManifestVersion({ lastFinal, manifests, tags, breaking, migration }) {
  const refuse = (detail, extra = {}) => ({ ok: false, detail, ...extra });
  if (!lastFinal) return refuse('no final release tag (vX.Y.Z) on main yet — the first version is a human decision, not a computed bump');
  const last = parseVersion(lastFinal);
  if (!last) return refuse(`the last release tag ${lastFinal} is not vX.Y.Z — cannot compare the manifest against it`);
  if (manifests === null || manifests === undefined) return refuse('the manifests could not be read at the commit — an unread version is not a release', { unread: true });
  const bad = manifests.filter((m) => m.error).map((m) => `${m.file}: ${m.error}`);
  if (bad.length) return refuse(`a manifest does not read — ${bad.join('; ')}`);
  const stated = manifests.filter((m) => !m.dynamic && m.version !== undefined && m.version !== null);
  if (!stated.length) return { ok: false, fallback: true, detail: 'no manifest states a version' };
  const values = [...new Set(stated.map((m) => String(m.version).replace(/^v/, '')))];
  if (values.length > 1) return refuse(`the manifests disagree on the version — ${stated.map((m) => `${m.file} says ${m.version}`).join('; ')}`);
  const v = parseVersion(`v${values[0]}`);
  const where = stated.map((m) => m.file).join(', ');
  if (!v) return refuse(`${where} says ${values[0]}, which is not X.Y.Z — route library-fast tags finals only, never a pre-release`);
  const version = formatVersion(v);
  const cmp = (a, b) => (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
  if (cmp(v, last) === 0) {
    return refuse(`${where} still says ${values[0]}, the last final ${lastFinal} — nothing to release until a merge bumps it (route library-fast, release.version-source: manifest)`, { nothing: true });
  }
  if (cmp(v, last) < 0) return refuse(`${where} says ${values[0]}, below the last final ${lastFinal} — the manifest moved backwards`);
  if ((tags || []).includes(version)) return refuse(`${version} is already a final tag`);

  const bump = v.major !== last.major ? 'major' : v.minor !== last.minor ? 'minor' : 'patch';
  const brk = breaking || [];
  let mig = null;
  if (bump === 'major') {
    if (last.major === 0) {
      return refuse(`${where} says ${values[0]} — the step from 0.x to ${version} is a human decision (CONVENTIONS.md §6, Versioning): tag it by hand, and later finals follow the manifest`, { bump });
    }
    mig = typeof migration === 'function' ? migration(version) : (migration || null);
    if (!mig || !mig.ok) {
      return refuse(`${lastFinal} -> ${version} is a major, refused: ${mig ? mig.detail : `no migration section read for ${version}`}`, { bump, migration: mig });
    }
  } else if (brk.length) {
    const owed = last.major === 0 ? 'minor' : 'major';
    if (owed === 'major' || bump === 'patch') {
      return refuse(`a breaking change since ${lastFinal} (${brk.join('; ')}) but ${where} only bumps to ${values[0]} (a ${bump}) — a break needs a ${owed}. Bump the manifest on trunk, or show the change is not breaking`, { bump });
    }
  }
  const why = `${where} says ${values[0]}${brk.length ? ` (breaking since ${lastFinal}: ${brk.join('; ')})` : ''}`;
  return { ok: true, detail: `${lastFinal} -> ${version} (${bump}, from the manifest: ${why})`, version, bump, why, overridden: null, migration: mig };
}

// ---- --auto: cadence (#422) ------------------------------------------------------------------

/**
 * The route's candidates-per-day cap as a rolling 24h window. `candidates` is [{ name, date }] for
 * every candidate `colab release cut` made (date = tagger date); `perDay` null = uncapped.
 * Returns { ok, detail, nextAt }. Not ok is a NO-OP for the caller, never a refusal.
 */
function cadenceVerdict({ candidates, perDay, now }) {
  if (perDay === null || perDay === undefined) return { ok: true, detail: 'no candidates-per-day cap on this route', nextAt: null };
  const nowMs = Date.parse(now);
  const recent = (candidates || []).map((c) => ({ ...c, ms: Date.parse(c.date) }))
    .filter((c) => !Number.isNaN(c.ms) && c.ms > nowMs - 86400000 && c.ms <= nowMs)
    .sort((a, b) => a.ms - b.ms);
  if (recent.length < perDay) return { ok: true, detail: `${recent.length} candidate(s) in the last 24h, cap ${perDay}`, nextAt: null };
  const nextAt = new Date(recent[recent.length - perDay].ms + 86400000).toISOString();
  return { ok: false, detail: `${recent.length} candidate(s) in the last 24h (${recent.map((c) => c.name).join(', ')}) — release.candidates-per-day caps at ${perDay} a day; the first run from ${nextAt} cuts main's head, never an older commit`, nextAt };
}

// ---- #622: a candidate at a named sha that is not main's head ----------------------------------

/**
 * `release cut --sha <sha>` (#622): a busy trunk moves during every long qualifying suite, so the sha
 * that went green is rarely still main's head when its run ends. The cut may name that sha instead —
 * every other condition is already measured at the sha; this verdict answers only what is new about
 * tagging a commit below the head. Null when the sha IS main's head (nothing new: today's cut).
 *
 *   newer        release tags (candidate or final) on a commit that DESCENDS from the sha — a CI run
 *                finishing out of order. A candidate here would move `next` backwards.
 *   finalRoute   deploy-tag-fast / library-fast: their cut is a FINAL, and #622 is candidates-only —
 *                those routes keep tagging main's head.
 *   capped       --auto under a declared release.candidates-per-day cap: a capped route spends its
 *                cut on the head (#443's "never an older commit").
 *
 * Returns { ok, detail, unread }. Not ok is a NO-OP under --auto (the head's own run cuts), a refusal
 * by hand. `newer: null` = the tags could not be read — unread, never "none newer".
 */
function qualifiedShaVerdict({ sha, head, newer, finalRoute = false, capped = false, auto = false }) {
  const s = String(sha || '').slice(0, 7);
  const h = String(head || '').slice(0, 7);
  if (!sha || !head || sha === head) return null;
  if (finalRoute) return { ok: false, detail: `${s} is not main's head (${h}) — this route's cut is a final, and a final is tagged only on main's head; --sha names a candidate (#622)` };
  if (auto && capped) return { ok: false, detail: `${s} is not main's head (${h}) — under a release.candidates-per-day cap a cut is spent on the head, never an older commit (#443)` };
  if (newer === null || newer === undefined) return { ok: false, unread: true, detail: `the release tags on commits after ${s} could not be read — an unread newer candidate is not an absent one` };
  if (newer.length) return { ok: false, detail: `${newer.join(', ')} already names a commit after ${s} — a candidate here would move \`next\` backwards; the newer one stands` };
  return { ok: true, detail: `${s} is below main's head (${h}) and no release tag names a later commit — the candidate is cut at ${s} (#622)` };
}

// ---- #446: deploy-tag-fast — spacing and holds ------------------------------------------------

/**
 * Finals at least `spacingHours` apart. `finals` is [{ name, date }] for every final tag (tagger
 * date) — a human's final counts as much as an automatic one. Returns { ok, detail, nextAt }; not ok
 * is a NO-OP for the caller, never a refusal, so the first run after the window tags main's head.
 */
function spacingVerdict({ finals, spacingHours, now }) {
  if (!spacingHours) return { ok: true, detail: 'no final spacing on this route', nextAt: null };
  const nowMs = Date.parse(now);
  const dated = (finals || []).map((f) => ({ ...f, ms: Date.parse(f.date) }))
    .filter((f) => !Number.isNaN(f.ms) && f.ms <= nowMs).sort((a, b) => a.ms - b.ms);
  if (!dated.length) return { ok: true, detail: 'no earlier final to space from', nextAt: null };
  const last = dated[dated.length - 1];
  const nextMs = last.ms + spacingHours * 3600000;
  if (nowMs >= nextMs) return { ok: true, detail: `last final ${last.name} at ${new Date(last.ms).toISOString()}, spacing ${spacingHours}h`, nextAt: null };
  const nextAt = new Date(nextMs).toISOString();
  return { ok: false, detail: `last final ${last.name} at ${new Date(last.ms).toISOString()} — release.final-spacing keeps finals ${spacingHours}h apart; the first run from ${nextAt} tags main's head`, nextAt };
}

/**
 * The human veto, repo-wide: `issues` is the open-issue list (null = unread — never "no hold").
 * Any open issue carrying `release-hold` holds the next final; the fast route has no candidate issue
 * to put the label on, so a human may put it on any issue, and only a human removes it.
 */
function holdsVerdict(issues) {
  if (issues === null || issues === undefined) return { ok: false, unread: true, detail: `the open issues could not be read — an unread ${HOLD_LABEL} is not an absent one` };
  const held = issues.filter((i) => i && (!i.state || String(i.state).toUpperCase() === 'OPEN')
    && (i.labels || []).some((l) => (l && typeof l === 'object' ? l.name : l) === HOLD_LABEL)).map((i) => i.number);
  return held.length
    ? { ok: false, detail: `${HOLD_LABEL} on ${held.map((n) => `#${n}`).join(', ')} — a human veto; no final is tagged while it is present, and no command removes it` }
    : { ok: true, detail: `no open issue carries ${HOLD_LABEL}` };
}

/** The command a human runs to let a migration ride an automatic final on the fast route. */
function migrationHandoff(tracking, version) {
  return `COLAB_HUMAN=1 colab migration-grant ${tracking || '<tracking issue>'} --branch ${version}`;
}

// ---- #443: the newest candidate names trunk's head -------------------------------------------

/** Events that run DOWNSTREAM of the suite (the release workflow itself) — never part of "head is green". */
const DOWNSTREAM_EVENTS = Object.freeze(['workflow_run', 'schedule', 'workflow_dispatch']);

/**
 * #443's guarantee, read back: once main's head is green, the newest candidate names it. `colab
 * release-status` flags a head that has been green for longer than one CI cycle and carries no tag.
 *
 *   candidatesAuto   the effective policy says candidates: auto (else nothing is owed: 'off')
 *   sha              main's head
 *   tagsAtSha        every tag pointing at it — a candidate OR a final names it
 *   owed             commits on main since the last final (0 = nothing to release; null = no final yet)
 *   runs             `gh run list --commit <sha>` rows: {status, conclusion, event, createdAt,
 *                    updatedAt}; null when the read failed
 *   promotion        on `trunk:` other than main, measurePromotion's verdict — a head that is not a
 *                    promotion is cut by hand, never by --auto, so it is not flagged (null elsewhere)
 *   now              ISO timestamp (the module stays clock-free)
 *
 * "One CI cycle" is measured, not configured: the longest suite run at this sha (updatedAt -
 * createdAt). The release workflow fires when the suite completes, so a head still untagged one
 * whole suite-duration after it went green is one the release run did not tag.
 *
 * Returns { state, flag, detail, greenAt, cycleMs } — state is one of: off · named · nothing-owed ·
 * no-final · not-promotion · unread · not-green · pending · untagged. `untagged` and `no-final` flag.
 *
 * `no-final` (#467): candidates are automatic but there is no final tag to compute a bump from, so
 * `release cut --auto` refuses on every run, forever, until a human tags the first version. That is a
 * stall, not "nothing owed" — reading it as nothing-owed is how a repo sat green for days with no tag.
 */
function headCandidateVerdict({ candidatesAuto, sha, tagsAtSha, owed, runs, promotion, now }) {
  const at = `main@${String(sha || '').slice(0, 7)}`;
  const out = (state, detail, extra = {}) => ({ state, flag: state === 'untagged' || state === 'no-final', detail, greenAt: null, cycleMs: null, ...extra });
  if (!candidatesAuto) return out('off', 'candidates are not automatic here — nothing names the head by itself');
  const named = (tagsAtSha || []).filter((t) => /^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[1-9][0-9]*)?$/.test(t));
  if (named.length) return out('named', `${at} is ${named.join(', ')}`);
  if (owed === 0) return out('nothing-owed', `nothing merged on main since the last final — no candidate is owed`);
  if (owed === null || owed === undefined) {
    return out('no-final', 'no final tag yet — `release cut --auto` refuses every run until a human tags the first version (CONVENTIONS.md §6, Versioning); release stalled');
  }
  if (promotion && !promotion.ok) return out('not-promotion', `${at} is not a promotion of trunk — --auto never cuts it (${promotion.detail})`);
  if (!Array.isArray(runs)) return out('unread', `gh run list failed — cannot tell whether ${at} is green`);
  const suite = runs.filter((r) => r && !DOWNSTREAM_EVENTS.includes(r.event));
  if (!suite.length) return out('not-green', `no suite run at ${at} yet — nothing is owed until it is green`);
  if (suite.some((r) => r.status !== 'completed')) return out('not-green', `a suite run at ${at} is still in flight`);
  // #618: a workflow whose every run here was `skipped` (an opt-in gated off by `if:`) did not run —
  // same reading as release ci-green/full-suite (#616). Skipped beside a red run stays red; a head
  // whose only runs were skipped falls through to "no successful suite run" below.
  const judged = withoutSkippedOnlyWorkflows(suite);
  if (judged.some((r) => r.conclusion !== 'success' && r.conclusion !== 'cancelled')) return out('not-green', `${at} is not green — no candidate is owed for a red head`);
  const ok = judged.filter((r) => r.conclusion === 'success');
  if (!ok.length) return out('not-green', `no successful suite run at ${at}`);
  const ms = (x) => Date.parse(x);
  const greenMs = Math.max(...ok.map((r) => ms(r.updatedAt)).filter((n) => !Number.isNaN(n)));
  const cycleMs = Math.max(0, ...ok.map((r) => ms(r.updatedAt) - ms(r.createdAt)).filter((n) => !Number.isNaN(n)));
  if (!Number.isFinite(greenMs)) return out('unread', `the suite runs at ${at} carry no completion time`);
  const greenAt = new Date(greenMs).toISOString();
  const untaggedMs = ms(now) - greenMs;
  const mins = (n) => `${Math.round(n / 60000)}m`;
  if (untaggedMs <= cycleMs) return out('pending', `${at} went green at ${greenAt}; inside one CI cycle (${mins(cycleMs)}) — the release run may still tag it`, { greenAt, cycleMs });
  return out('untagged', `${at} has been green since ${greenAt} (${mins(untaggedMs)}, longer than one CI cycle of ${mins(cycleMs)}) and carries no candidate — head not a candidate`, { greenAt, cycleMs });
}

/**
 * The GitHub pre-release a candidate gets (#443): `gh release create` arguments, notes = the tag's
 * own message. The release workflow publishes its own; a candidate cut by hand published none, so
 * the CLI now does it for every cut — the workflow's publish step then finds it and skips.
 */
function prereleaseArgs(tag, notesFile) {
  return ['release', 'create', tag, '--verify-tag', '--title', tag, '--notes-file', notesFile, '--prerelease', '--latest=false'];
}

/** #446: a deploy-tag-fast final's GitHub Release — a full release, marked latest. */
function finalReleaseArgs(tag, notesFile) {
  return ['release', 'create', tag, '--verify-tag', '--title', tag, '--notes-file', notesFile, '--latest'];
}

/**
 * #446: the tracking issue a fast-route migration hand-off opens. Same marker as release-finalize's
 * (`<!-- colab:release version=… -->`), so every reader finds it; the text says what is owed here —
 * a migration grant, not a candidate's test period.
 */
function handoffTrackingBody(version) {
  return [
    `<!-- colab:release version=${version} -->`,
    '',
    `Release tracking record for **${version}** — opened by \`colab release cut --auto\` on route \`deploy-tag-fast\` (CONVENTIONS.md §6). A record, not a unit of work: never claimed, never started.`,
    '',
    '- The final is automatic on every green head, by the operator\'s grant — but a database migration since the last final never rides an automatic deploy ungranted.',
    `- **To let it ride:** a human runs \`COLAB_HUMAN=1 colab migration-grant <this issue> --branch ${version}\`; the next green run tags and deploys ${version}.`,
    `- **Veto:** add the \`${HOLD_LABEL}\` label to any open issue. While it is present no final is tagged; only a human removes it.`,
  ].join('\n') + '\n';
}

// ---- §6 condition 2: the full suite ------------------------------------------------------------

/**
 * `rows` is `git.ghRunsForCommit`'s list for the sha (null when the read failed). Condition 1 (the
 * ship check) treats a `cancelled` sibling as not-bad — right for a cancel-in-progress straggler
 * next to its own re-run, wrong for "the suite passed": a workflow whose only run at the sha was
 * cancelled never ran its tests. So: group by workflow, and every workflow needs a successful run.
 */
function fullSuiteVerdict(rows, at) {
  if (rows === null || rows === undefined) return { ok: false, detail: `gh run list failed — cannot confirm the suite ran at ${at}` };
  if (!rows.length) return { ok: false, detail: `no workflow run at ${at} — the suite never ran on this commit` };
  const byWorkflow = groupByWorkflow(rows);
  const skippedOnly = [];
  for (const [name, runs] of byWorkflow) if (isSkippedOnly(runs)) { skippedOnly.push(name); byWorkflow.delete(name); }
  // #616: a workflow whose every run was skipped did not run — it vouches for nothing and fails nothing.
  if (!byWorkflow.size) return { ok: false, detail: `no workflow ran at ${at} — every run was skipped (${skippedOnly.join(', ')})` };
  const missing = [];
  for (const [name, runs] of byWorkflow) {
    if (!runs.some((r) => r.status === 'completed' && r.conclusion === 'success')) {
      missing.push(`${name} (${runs.map((r) => (r.status === 'completed' ? r.conclusion || 'none' : r.status)).join(', ')})`);
    }
  }
  if (missing.length) return { ok: false, detail: `no successful run at ${at} for: ${missing.join('; ')}` };
  const note = skippedOnly.length ? ` (not run, skipped: ${skippedOnly.join(', ')})` : '';
  return { ok: true, detail: `${byWorkflow.size} workflow(s) at ${at}, each with a successful run${note}` };
}

function groupByWorkflow(rows) {
  const byWorkflow = new Map();
  for (const r of rows) {
    const name = (r && r.workflowName) || '(unnamed workflow)';
    if (!byWorkflow.has(name)) byWorkflow.set(name, []);
    byWorkflow.get(name).push(r);
  }
  return byWorkflow;
}

/** Every run of the workflow finished and concluded `skipped` — it executed nothing (#514, #616). */
function isSkippedOnly(runs) {
  return runs.length > 0 && runs.every((r) => r && r.status === 'completed' && r.conclusion === 'skipped');
}

/**
 * #616: the run rows minus every workflow whose runs at the sha were ALL `skipped` — an opt-in
 * workflow gated off by an `if:` (a scheduled load profile waiting for its runner) records a skipped
 * run on every tick, and one landing on the candidate's commit made ci-green read
 * "conclusion=skipped" and refused every finalize older than one schedule period. Release-only on
 * purpose: the ship gate (git.summarizeRunsForCommit, #514) keeps reading an all-skipped workflow
 * as not-green, so this filter is applied by the release callers, never inside git.js.
 * A workflow with a skipped run AND any other run keeps all its rows (skipped + failure stays red;
 * cancelled-only is untouched and still fails full-suite). null passes through.
 */
function withoutSkippedOnlyWorkflows(rows) {
  if (!Array.isArray(rows)) return rows;
  const drop = new Set();
  for (const [name, runs] of groupByWorkflow(rows)) if (isSkippedOnly(runs)) drop.add(name);
  if (!drop.size) return rows;
  return rows.filter((r) => !drop.has((r && r.workflowName) || '(unnamed workflow)'));
}

/**
 * #624: the run rows `release cut` judges ci-green and full-suite over — the runs that VERIFY the code
 * at the sha, by the ship gate's own rule (verify-runs.js, #503: push / pull_request / merge_group
 * triggers, project.yml `ship-gate-workflows` / `ship-ignore-workflows`, the #567 dispatch rescue).
 * One rule for "which workflows may veto", not a second. Measured: a qualified sha whose CI push run
 * had succeeded was refused ci-green AND full-suite because a scheduled `Nightly` run at the same sha
 * was still in progress — a run that comes after the verdict, not part of it. Returns `{ rows,
 * setAside }`; each set-aside row carries `setAsideWhy`. null passes through as `{ rows: null }`.
 */
function verifyingRunsForCut(rows, policy) {
  if (!Array.isArray(rows)) return { rows, setAside: [], dispatchCounted: [] };
  const split = verifyRuns.splitVerifying(rows, policy || { gate: null, ignore: [] });
  return { rows: split.counted, setAside: split.setAside, dispatchCounted: split.dispatchCounted || [] };
}

/**
 * #624: the detail suffix naming what `verifyingRunsForCut` set aside (and any lost-push dispatch run
 * it counted, #567) — the ship gate's own wording, so one reader learns one phrase. '' when neither.
 */
function verifyingNote(read) {
  if (!read) return '';
  const summary = (list) => (list || []).map((x) => ({
    workflowName: x.workflowName || null, status: x.status || null, conclusion: x.conclusion || null,
    databaseId: x.databaseId || null, ...(x.setAsideWhy ? { why: x.setAsideWhy } : {}),
  }));
  return verifyRuns.setAsideNote(summary(read.setAside)) + verifyRuns.dispatchCountedNote(summary(read.dispatchCounted));
}

/**
 * The run rows minus the CALLING workflow's own runs (#425). Inside the release workflow
 * (templates/release-auto.yml) `release cut` / `release finalize` read the runs at the very commit
 * that workflow is running on — and its own run is one of them, still in progress. Counted, it makes
 * ci-green "not every run finished" and full-suite "no successful run" forever, and a refused run's
 * red conclusion would poison the next run's read the same way. The release workflow is never part of
 * the suite it judges, so its rows are dropped — keyed on GITHUB_WORKFLOW (the running workflow's
 * `name:`), and only when GITHUB_ACTIONS says we are inside Actions. Off Actions: rows unchanged.
 * null (a failed read) passes through untouched.
 */
function withoutOwnWorkflow(rows, env = process.env) {
  if (!Array.isArray(rows)) return rows;
  const own = env && env.GITHUB_ACTIONS === 'true' ? String(env.GITHUB_WORKFLOW || '') : '';
  if (!own) return rows;
  return rows.filter((r) => (r && r.workflowName) !== own);
}

// ---- §6 condition 3: schema changes are additive -----------------------------------------------

/**
 * The migration layouts `colab ship`'s migration gate reads — one rule for both, and it lives in
 * migration-paths.js (#383): the two defaults plus whatever project.yml `migrations:` declares
 * (`declared` = that module's normalised prefixes; omitted = the defaults alone).
 */
function isMigrationPath(f, declared) {
  return migrationPaths.isMigrationPath(f, declared);
}

// Laravel schema-builder calls that destroy or rewrite existing structure. Read only inside `up()`:
// a `down()` that drops what `up()` created is the ordinary shape of an ADDITIVE migration.
const LARAVEL_DESTRUCTIVE = /(\b(drop|dropIfExists|dropColumn|dropColumns|dropForeign|dropConstrainedForeignId|dropIndex|dropPrimary|dropUnique|dropSoftDeletes|dropTimestamps|dropMorphs|dropRememberToken|rename|renameColumn|renameIndex)\s*\(|->\s*change\s*\()/;
// SQL (Prisma writes plain migration.sql). `--` comment lines are stripped first: Prisma labels its
// statements `-- DropIndex`, which is a comment, not a statement.
const SQL_DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE|VIEW|SCHEMA)|RENAME\s+(TO|COLUMN)|ALTER\s+COLUMN|TRUNCATE)\b/i;

// #545: SQL migration tools that keep the rollback in the SAME file mark it with a comment line —
// sql-migrate `-- +migrate Up|Down`, goose `-- +goose Up|Down`, dbmate `-- migrate:up|down`. The Down
// section dropping what Up created is the ordinary shape of an additive migration (same reading as
// Laravel's down() above), so only lines outside a Down section are matched. Measured: one adopting
// repo's release stalled ~26 h on a purely additive file (six CREATE TABLE in Up, six DROP TABLE IF
// EXISTS in Down) because the whole file was read. Fails CLOSED: lines before any marker are kept, a
// file with no marker is read whole, and a second Up marker re-opens reading after a Down.
const SQL_UP_MARKER = /^\s*--\s*(\+(migrate|goose)\s+up|migrate:up)\b/i;
const SQL_DOWN_MARKER = /^\s*--\s*(\+(migrate|goose)\s+down|migrate:down)\b/i;
// golang-migrate and friends put the rollback in its own `<n>_<name>.down.sql` — the whole file is a
// Down section. Only an ADDED one is exempt; editing or deleting it is still a rewritten migration.
const SQL_DOWN_FILE = /\.down\.sql$/i;

/**
 * The first destructive SQL statement outside a Down section — `{ statement, line, inUp }` (1-based
 * line in the original file; `inUp` = an Up marker opened the section it sits in) — or null. Skipped
 * lines are blanked, not removed, so line numbers stay true and a statement split across lines
 * (`DROP\n  TABLE`) still matches, as it did when the whole file was read.
 */
function sqlDestructive(text) {
  let section = 'pre';
  const sections = [];
  const kept = String(text).split('\n').map((l) => {
    if (SQL_DOWN_MARKER.test(l)) section = 'down';
    else if (SQL_UP_MARKER.test(l)) section = 'up';
    sections.push(section);
    // `--` comment lines (markers included) are blanked too: Prisma labels its statements `-- DropIndex`.
    return section === 'down' || /^\s*--/.test(l) ? '' : l;
  });
  const joined = kept.join('\n');
  const m = SQL_DESTRUCTIVE.exec(joined);
  if (!m) return null;
  const line = joined.slice(0, m.index).split('\n').length;
  return { statement: m[0].replace(/\s+/g, ' '), line, inUp: sections[line - 1] === 'up' };
}

function laravelUpBody(text) {
  const up = text.search(/function\s+up\s*\(/);
  if (up === -1) return text;
  const down = text.slice(up).search(/function\s+down\s*\(/);
  return down === -1 ? text.slice(up) : text.slice(up, up + down);
}

/**
 * `changes` is [{ status, path, content }] for every changed path since the last final tag —
 * `status` is git's --name-status letter (A/M/D/R…), `content` the file at the candidate commit
 * (added files only). Non-migration paths are ignored here.
 *
 * Heuristic, and it says so: it reads two layouts and a list of destructive calls. It fails CLOSED
 * — an edited or deleted migration counts as destructive, because rewriting history a database has
 * already run is not an add. A false positive costs a human cutting the candidate; a false negative
 * is the §6 judgement the release notes still owe (read the diff, not only this).
 *
 * #670: a third outcome beside ✓ and ✗ — NOT CHECKED, `{ ok: true, checked: false }`. It refuses
 * nothing (an absent `migrations:` still changes no gate — project.schema.md `migrations`; for a
 * DECLARED migration in an unread format, the #441 migration-grant check still holds an automatic
 * final), but it is never printed as a green pass:
 * a ✓ reading "other layouts are not read" was read as "no migration" by the human finalizing a
 * release whose migrations sat in a directory this check never looked at. Two cases:
 *   - nothing declared and no default layout at the candidate (`layout` false) — nothing was read;
 *   - a declared migration in a format the heuristic does not read changed, and nothing it did read
 *     is destructive (a destructive read file is still ✗).
 * `layout` = does `database/migrations/` or `prisma/migrations/` exist in the tree at the candidate:
 * true / false / null (the tree could not be read — never "absent"). Undefined = a caller that does
 * not measure it, read as today: present.
 */
function schemaVerdict(changes, since, declared, layout) {
  const inPaths = (changes || []).filter((c) => isMigrationPath(c.path, declared));
  // #673: a declared schema FILE (an inline schema the server applies itself) is read by the lines
  // its change added — never "unread", and an edit is never "an existing migration was rewritten".
  const schemaFiles = inPaths.filter((c) => migrationPaths.isDeclaredFile(c.path, declared));
  const history = inPaths.filter((c) => !migrationPaths.isDeclaredFile(c.path, declared));
  const migrations = history.filter((c) => /\.(php|sql)$/.test(c.path));
  // #383: a declared path widens what COUNTS as a migration, not what this heuristic can READ. A
  // declared migration in any other format (a Node boot migration, a Go file) is named in the
  // detail, so the §6 judgement the release notes owe knows exactly which files it still has to
  // read by hand — never silently folded into "none destructive". Only for DECLARED paths: under
  // the defaults a non-php/sql file is Prisma's migration_lock.toml and the like, as it always was.
  const unread = (declared && declared.length)
    ? history.filter((c) => !/\.(php|sql)$/.test(c.path) && !migrationPaths.isMigrationPath(c.path, []))
    : [];
  const scope = `Laravel database/migrations + Prisma prisma/migrations${declared && declared.length ? ` + declared ${declared.join(', ')} (php/sql only; a declared file: the SQL it added)` : ''} — other layouts are not read`;
  const hasDeclared = !!(declared && declared.length);
  const notChecked = (why) => ({ ok: true, checked: false, detail: `not checked — ${why}` });
  const unreadWhy = () => `${unread.length} declared migration file(s) changed since ${since} in a format this check does not read (php/sql only) — a human reads them before the final: ${unread.map((c) => c.path).join(', ')}`;
  const howToDeclare = 'a repo whose migrations live elsewhere declares their directory as `migrations:` in .github/project.yml (project.schema.md `migrations`); a repo with no database has nothing to declare';
  if (!migrations.length && !schemaFiles.length) {
    if (unread.length) return notChecked(unreadWhy());
    if (!hasDeclared && layout === false) return notChecked(`no Laravel database/migrations/ or Prisma prisma/migrations/ directory at the candidate and no \`migrations:\` declared, so no migration was read — ${howToDeclare}`);
    if (!hasDeclared && layout === null) return notChecked(`the tree at the candidate could not be read for a migration layout, so no migration was read — ${howToDeclare}`);
    return { ok: true, detail: `no migration file changed since ${since} (${scope})` };
  }
  const findings = [];
  for (const c of migrations) {
    const st = String(c.status || '').charAt(0);
    if (st !== 'A') { findings.push(`${c.path}: ${st === 'D' ? 'deleted' : st === 'R' ? 'renamed' : 'edited'} — an existing migration was rewritten`); continue; }
    const text = String(c.content || '');
    if (c.path.endsWith('.php')) {
      const m = LARAVEL_DESTRUCTIVE.exec(laravelUpBody(text));
      if (m) findings.push(`${c.path}: \`${m[0].trim()}\` in up()`);
    } else {
      if (SQL_DOWN_FILE.test(c.path)) continue;
      const m = sqlDestructive(text);
      if (m) findings.push(`${c.path}:${m.line}: \`${m.statement}\`${m.inUp ? ' in the Up section' : ''}`);
    }
  }
  for (const c of schemaFiles) {
    const f = schemaFileFinding(c);
    if (f) findings.push(f);
  }
  if (findings.length) {
    return { ok: false, detail: `destructive schema change since ${since} — a release carrying one is a human's to cut (CONVENTIONS.md §6, Switched epics rule 5): ${findings.join('; ')}` };
  }
  const read = [
    ...(migrations.length ? [`${migrations.length} migration file(s) added`] : []),
    ...(schemaFiles.length ? [`declared schema file(s) changed (${schemaFiles.map((c) => c.path).join(', ')}), the SQL they added read`] : []),
  ].join(' and ');
  if (unread.length) return notChecked(`${read} since ${since}, none destructive — but ${unreadWhy()}`);
  return { ok: true, detail: `${read} since ${since}, none destructive (${scope})` };
}

/**
 * #673: one declared schema file's change → a destructive finding, or null. Reads ONLY what the change
 * added (`c.added` = [{ line, text }], new-side line numbers; for an added file, its whole content):
 * a `CREATE TABLE` the file has always held is not this release's, a `DROP COLUMN` it just gained is.
 * Fails CLOSED — a deleted file, or added lines that could not be read, is a finding. Lines removed
 * from the file are not read: a schema that stops creating a table drops nothing that exists.
 */
function schemaFileFinding(c) {
  const st = String(c.status || '').charAt(0);
  if (st === 'D') return `${c.path}: deleted — the declared schema file is gone`;
  let lines = Array.isArray(c.added) ? c.added : null;
  if (!lines && st === 'A' && typeof c.content === 'string') lines = c.content.split('\n').map((text, i) => ({ line: i + 1, text }));
  if (!lines) return `${c.path}: the lines this change added could not be read — an unread schema change is not an additive one`;
  const m = sqlDestructive(lines.map((l) => l.text).join('\n'));
  if (!m) return null;
  const at = lines[m.line - 1];
  return `${c.path}:${at ? at.line : '?'}: \`${m.statement}\` added`;
}

/**
 * #673: `git diff -U0` output for ONE file → the lines it added, [{ line, text }] with new-side line
 * numbers read from each hunk header. Pure, so the shape is tested without git.
 */
function addedLinesFromDiff(diffText) {
  const out = [];
  let next = null;
  for (const l of String(diffText || '').split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { next = Number(h[1]); continue; }
    if (next === null) continue;                       // the file header, before the first hunk
    if (l.startsWith('+')) { out.push({ line: next, text: l.slice(1) }); next += 1; }
    else if (l.startsWith(' ')) next += 1;             // context (none at -U0, kept for safety)
  }
  return out;
}

// ---- §6 condition 4: switch dependencies -------------------------------------------------------

const SWITCH_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const MARKER_RE = /<!--\s*colab:switch\b([\s\S]*?)-->/g;

/**
 * Every `<!-- colab:switch … -->` marker in one issue body (CONVENTIONS.md §5, Switched epics).
 * Returns { markers: [{ name, needs: [], role: null|'add'|'remove' }], malformed: [text] } — an
 * unknown token, a bad name, `needs` on a child, or two markers for one name disagreeing are all
 * `malformed`: "not cleared", reported, never defaulted.
 *
 * #466: fenced code blocks and inline code spans are blanked first (`stripCode`, the same reader
 * the instruction-file import scan uses), so a body that QUOTES the marker family — prose such as
 * "the `<!-- colab:switch -->` marker" — is documentation, not a malformed marker blocking every
 * release. A real marker sits outside code, so it is still read, and still refused when malformed.
 */
function parseSwitchMarkers(body) {
  const markers = [];
  const malformed = [];
  const text = stripCode(String(body || '')).join('\n');
  let m;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(text)) !== null) {
    const raw = m[0];
    const fields = {};
    let bad = null;
    for (const tok of m[1].trim().split(/\s+/).filter(Boolean)) {
      const kv = /^(name|needs|role)=(.*)$/.exec(tok);
      if (!kv) { bad = `unrecognised token ${JSON.stringify(tok)}`; break; }
      if (kv[1] in fields) { bad = `${kv[1]} given twice`; break; }
      fields[kv[1]] = kv[2];
    }
    if (!bad && !fields.name) bad = 'no name=';
    if (!bad && !SWITCH_NAME_RE.test(fields.name)) bad = `name ${JSON.stringify(fields.name)} does not match ${SWITCH_NAME_RE}`;
    if (!bad && fields.role !== undefined && fields.role !== 'add' && fields.role !== 'remove') bad = `role ${JSON.stringify(fields.role)} is not add or remove`;
    if (!bad && fields.role !== undefined && fields.needs !== undefined) bad = 'needs= belongs on the epic marker, not on a role= child marker';
    let needs = [];
    if (!bad && fields.needs !== undefined) {
      needs = fields.needs.split(',').map((s) => s.trim());
      const wrong = needs.find((n) => !SWITCH_NAME_RE.test(n));
      if (wrong !== undefined) bad = `needs names ${JSON.stringify(wrong)}, not a switch name`;
    }
    if (bad) { malformed.push(`${raw.replace(/\s+/g, ' ')}: ${bad}`); continue; }
    markers.push({ name: fields.name, needs: needs.sort(), role: fields.role || null });
  }
  // Two markers on one issue for the same name must agree.
  const seen = new Map();
  for (const mk of markers) {
    const key = JSON.stringify([mk.role, mk.needs]);
    if (seen.has(mk.name) && seen.get(mk.name) !== key) malformed.push(`two colab:switch markers for "${mk.name}" disagree`);
    seen.set(mk.name, key);
  }
  return { markers, malformed };
}

/** Closed by a merge: CLOSED and not closed as not-planned. */
function closedDone(issue) {
  return String(issue.state || '').toUpperCase() === 'CLOSED' && String(issue.stateReason || '').toUpperCase() !== 'NOT_PLANNED';
}

/**
 * `issues` is [{ number, state, stateReason, body }] — every issue in the repo (null when the read
 * failed). A switch EXISTS once a `role=add` child is closed done, is FINISHED once a `role=remove`
 * child is. Rule 3: a finished switch whose epic `needs` another that is not finished is a release
 * the configuration never supported — B shipped live on top of an A that is still dark.
 *
 * Reads the markers only. The `blocked_by` edge that enforces rule 3 before a merge is not re-read
 * here: this is the release-time consequence, not the edge audit.
 */
function switchVerdict(issues) {
  if (issues === null || issues === undefined) return { ok: false, unread: true, detail: 'the issue list could not be read — switch dependencies cannot be cleared' };
  const problems = [];
  const needsOf = new Map(); // name -> { needs: [..], from: #N }
  const declared = new Set();
  const finished = new Set();
  const exists = new Set();
  for (const issue of issues) {
    const { markers, malformed } = parseSwitchMarkers(issue.body);
    for (const bad of malformed) problems.push(`#${issue.number}: ${bad}`);
    for (const mk of markers) {
      declared.add(mk.name);
      if (mk.role === null) {
        const prev = needsOf.get(mk.name);
        if (prev && JSON.stringify(prev.needs) !== JSON.stringify(mk.needs)) {
          problems.push(`#${prev.from} and #${issue.number} declare switch "${mk.name}" with different needs=`);
        } else if (!prev) needsOf.set(mk.name, { needs: mk.needs, from: issue.number });
      } else if (closedDone(issue)) {
        (mk.role === 'add' ? exists : finished).add(mk.name);
      }
    }
  }
  for (const [name, { needs, from }] of needsOf) {
    for (const dep of needs) {
      if (!declared.has(dep)) problems.push(`#${from}: switch "${name}" needs "${dep}", which no issue declares`);
      else if (finished.has(name) && !finished.has(dep)) {
        problems.push(`switch "${name}" is finished (its role=remove child closed) but needs "${dep}", which is ${exists.has(dep) ? 'still switched' : 'not landed'}`);
      }
    }
  }
  if (problems.length) return { ok: false, detail: `switch dependencies not cleared (CONVENTIONS.md §5, Switched epics rule 3): ${problems.join('; ')}` };
  if (!declared.size) return { ok: true, detail: 'no colab:switch markers in this repo' };
  const unfinished = [...exists].filter((n) => !finished.has(n));
  return { ok: true, detail: `${declared.size} switch(es) declared — ${finished.size} finished, ${unfinished.length} unfinished (dark in this release); every declared dependency satisfied` };
}

/**
 * #429 — is `main@sha` a promotion of `trunk`? Topology, not the subject line: `colab promote
 * --message` overrides the subject and a hand-run `git merge --no-ff dev` writes git's own.
 *   trunk            project.yml's `trunk:` (never `main` here — the caller skips the check there)
 *   sha, parents     the head and its parent shas, first parent first
 *   headOnTrunk      sha is an ancestor of origin/<trunk> (a fast-forward promotion)
 *   mergedFromTrunk  some non-first parent is an ancestor of origin/<trunk> (the --no-ff merge)
 *   error            origin/<trunk> could not be read — an unread trunk is not a clean one
 * Returns { ok, detail, unread }. Not-a-promotion is `ok: false` without `unread`: decide() reads it
 * as a no-op, because a hotfix on `main` is cut by the next promotion or by hand.
 */
function promotionVerdict({ trunk, sha, parents, headOnTrunk, mergedFromTrunk, error } = {}) {
  const short = (x) => String(x || '').slice(0, 7);
  if (error) return { ok: false, unread: true, detail: `origin/${trunk} could not be read (${error}) — whether \`${RELEASE_BRANCH}\` is a promotion is unknown, and an unread trunk is not a clean one` };
  if (headOnTrunk) return { ok: true, detail: `${RELEASE_BRANCH}@${short(sha)} is on ${trunk} — a fast-forward promotion` };
  const ps = parents || [];
  if (ps.length >= 2 && mergedFromTrunk) {
    return { ok: true, detail: `${RELEASE_BRANCH}@${short(sha)} promotes ${trunk}@${short(mergedFromTrunk === true ? ps[ps.length - 1] : mergedFromTrunk)}` };
  }
  const what = ps.length >= 2 ? `a merge of a branch not on ${trunk}` : 'a direct commit';
  return { ok: false, detail: `${RELEASE_BRANCH}@${short(sha)} is not a promotion of ${trunk} (${what}) — the next promotion's range carries it; to release it now, cut by hand with \`colab release cut\`` };
}

// ---- the verdict ------------------------------------------------------------------------------

/**
 * `facts`:
 *   policy        release-policy.js evaluateRelease(doc)
 *   triggers      workflow-triggers.js prereleaseTagTriggers(...) findings
 *   lastFinal, suggestion, override, tags, tagsAtSha
 *   ci, suite, schema, switches   { ok, detail } each, measured by the caller
 *   heavy         #610 — integration-profile.js releaseHeavyCondition(), read on the final routes only;
 *                 absent → no row
 *
 * Returns { ok, checks: [{ condition, ok, detail }], refusals, version, tag, bump, overridden }.
 * Every check is reported, not just the first failure: a caller fixing one refusal should not
 * discover the next only on the re-run.
 */
function decide(facts) {
  const f = facts || {};
  const checks = [];
  // #467: `unread` marks a failure that is a failed READ, not a measured fact — the next run reads
  // again, so it is never a standing refusal. Kept out of the check rows (their shape is frozen).
  const unreadSet = new Set();
  const add = (condition, ok, detail, unread) => {
    checks.push({ condition, ok: !!ok, detail });
    if (!ok && unread) unreadSet.add(condition);
  };
  const isUnread = (verdict) => !!(verdict && verdict.unread);

  const p = f.policy;
  const fast = isFastRoute(p) && !(p.findings && p.findings.length);
  // #590: route library-fast — a final with no candidate, like the fast route, and nothing deployed.
  const library = !fast && isLibraryRoute(p) && !(p.findings && p.findings.length);
  const finalRoute = fast || library;
  if (!p) add('release-policy', false, 'no release policy was evaluated', true);
  else if (p.findings && p.findings.length) add('release-policy', false, `the release: block is invalid — ${p.findings.map((x) => x.text).join('; ')}`);
  else if (fast && !f.auto) {
    add('release-policy', false, 'route deploy-tag-fast tags its finals only from the release workflow (`colab release cut --auto`), where the deploy runs in the same run — a final cut by hand would reach production with no deploy job behind it');
  } else if (fast) {
    add('release-policy', true, `${p.derived.axis} (${p.derived.row}, route deploy-tag-fast): a final on every green head, granted by decision #${p.effective.finalGrant.issue}, health gate ${p.effective.healthGate.url} (rollback: ${p.effective.healthGate.rollback}), spacing ${p.effective.finalSpacingHours}h`);
  } else if (library) {
    add('release-policy', true, `${p.derived.axis} (${p.derived.row}, route library-fast): a final on every release the version source owes — no candidate, nothing deployed (version source: ${versionSourceOf(p)})`);
  } else if (p.effective.candidates !== 'auto') {
    const narrowed = p.declared && p.declared.candidates === 'off' && p.derived.candidates === 'auto';
    const { route, why } = routeWhy(p);
    const humanFinal = route === 'library-fast' && p.effective.final === 'human';
    add('release-policy', false, narrowed
      ? 'release: candidates: off — this repo narrowed its rung row to no automatic candidates'
      : humanFinal
        ? `route library-fast with release.final: human — every final here is a human act: tag vX.Y.Z by hand (CONVENTIONS.md §6, The release rung)`
        : `candidates are off on ${p.derived.axis}${route ? `, route ${route}` : ''}: ${why} (CONVENTIONS.md §6, The release rung)`);
  } else {
    add('release-policy', true, `${p.derived.axis} (${p.derived.row}${p.effective.route ? `, route ${p.effective.route}` : ''}): candidates auto, final ${p.effective.final}, test period ${p.effective.testPeriodDays}d`);
  }

  // #422: --auto honours the route's cadence. Inside the window the run is a no-op, not a refusal.
  let noop = false;
  if (f.auto) {
    const cad = f.auto.cadence || { ok: false, detail: 'cadence not measured' };
    add('cadence', cad.ok, cad.detail, !f.auto.cadence);
    if (!cad.ok) noop = !!f.auto.cadence;
    if (fast) {
      const sp = f.auto.spacing || { ok: false, detail: 'final spacing not measured' };
      add('spacing', sp.ok, sp.detail);
      if (!sp.ok && f.auto.spacing) noop = true;
    }
    // #429: on `trunk:` other than main, only a promotion head is a candidate; anything else no-ops.
    const pr = f.auto.promotion;
    if (pr) {
      add('promotion', pr.ok, pr.detail, isUnread(pr));
      if (!pr.ok && !pr.unread) noop = true;
    }
  }

  // #622: a cut at a named sha below main's head — only what is new about it; every other row is
  // already measured at the sha. Null (no row) when the sha is the head or no --sha was given.
  const q = f.qualified;
  if (q) {
    add('qualified-sha', q.ok, q.detail, isUnread(q));
    if (!q.ok && f.auto && !q.unread) noop = true;
  }

  const trig = f.triggers || [];
  if (trig.length) add('prerelease-trigger', false, `a deploy would fire on a candidate tag: ${trig.map((t) => t.text).join('; ')}`);
  else add('prerelease-trigger', true, 'no deploy workflow fires on a pre-release tag');

  const computed = () => (f.auto
    ? decideAutoVersion({ lastFinal: f.lastFinal, signals: f.auto.signals, migration: f.auto.migration, tags: f.tags })
    : decideVersion({ lastFinal: f.lastFinal, suggestion: f.suggestion, override: f.override, tags: f.tags }));
  let v;
  if (library && versionSourceOf(p) === 'manifest') {
    // #590: the manifest is the version; the signals only decide whether it under-declares a break.
    if (f.override && f.override.bump) v = { ok: false, detail: `--bump ${f.override.bump} has nothing to override — on route library-fast with release.version-source: manifest the version is the manifest's; bump it on trunk` };
    else {
      const sig = f.auto ? (f.auto.signals || {}) : null;
      if (sig && sig.unread && sig.unread.length) v = { ok: false, unread: true, detail: `a bump signal could not be read — fail closed: ${sig.unread.join('; ')}` };
      else {
        const breaking = sig ? (sig.breaking || [])
          : (f.suggestion && f.suggestion.bump === 'major' ? [f.suggestion.why || 'a breaking change'] : []);
        v = decideManifestVersion({ lastFinal: f.lastFinal, manifests: f.manifests, tags: f.tags, breaking, migration: f.auto ? f.auto.migration : f.migration });
        if (v.fallback) v = computed();
      }
    }
  } else v = computed();
  add('version', v.ok, v.detail, isUnread(v));
  // "Nothing merged since the last final" is a no-op for the release workflow, not a failure.
  if (f.auto && v.nothing) noop = true;

  let tag = null;
  let derivable = [];
  if (v.ok && finalRoute) {
    const finalHere = (f.tagsAtSha || []).filter((t) => VERSION_RE.test(t));
    if (finalHere.length) {
      add('already-final', false, `this commit is already the final ${finalHere.join(', ')} — a head that carries a final is the route holding`);
      if (f.auto) noop = true;
    } else {
      tag = v.version;
      add('already-final', true, `next final: ${tag} (no candidate — route ${fast ? 'deploy-tag-fast' : 'library-fast'})`);
    }
  } else if (v.ok) {
    const here = candidateNumbers(f.tagsAtSha || [], v.version);
    if (here.length) {
      add('already-candidate', false, `this commit is already ${v.version}-rc.${here[here.length - 1]} — a second candidate for the same commit tests nothing new`);
      // #443: under --auto, main's head already carrying a candidate is the guarantee HOLDING — the
      // newest candidate names head — so a re-run (the daily schedule, a CI re-run) is a no-op.
      if (f.auto) noop = true;
    } else {
      tag = `${v.version}-rc.${nextCandidateNumber(f.tags, v.version)}`;
      add('already-candidate', true, `next candidate: ${tag}`);
    }
  }

  // #424: the three pre-tag checks, on the tag this run would create.
  if (tag) {
    for (const c of releaseTag.preTagChecks({ tag, manifests: f.manifests, ancestry: f.ancestry, tags: f.tags, trunk: RELEASE_BRANCH, versionSource: versionSourceOf(p) })) {
      // An unread manifest list or an unmeasured ancestry is a failed read, not a wrong manifest.
      const unreadPre = (c.condition === 'manifest-version' && (f.manifests === null || f.manifests === undefined))
        || (c.condition === 'on-trunk' && !f.ancestry);
      add(c.condition, c.ok, c.detail, unreadPre);
      if (c.derivable && c.derivable.length) derivable = c.derivable;
    }
  } else if (f.ancestry && f.ancestry.shallow) {
    // A shallow checkout cannot even find the last final, so no tag is computed — name the cause.
    add('on-trunk', false, 'a shallow checkout cannot answer whether the commit is on main (nor find the last final tag) — fetch full history (fetch-depth: 0) and re-run');
  }

  for (const [condition, verdict] of [['ci-green', f.ci], ['full-suite', f.suite], ['schema-additive', f.schema], ['switch-dependencies', f.switches]]) {
    if (!verdict) add(condition, false, 'not measured', true);
    else {
      add(condition, verdict.ok, verdict.detail, isUnread(verdict));
      // #670: a not-checked verdict passes but is not a ✓ — the one optional field a row can carry,
      // present only then, so every other row (and `--json` on every other run) is unchanged.
      if (verdict.checked === false) checks[checks.length - 1].checked = false;
    }
  }

  // #610: a final needs the heavy lane green at its exact sha, under every integration profile. Only
  // the two final routes tag a final here; a candidate is gated at `release finalize`. A heavy run
  // still to start or still running is the route holding (a no-op under --auto), not a refusal.
  if (finalRoute && tag && f.heavy) {
    add('heavy-lane', f.heavy.ok, f.heavy.detail, f.heavy.pending);
    if (!f.heavy.ok && f.heavy.pending && f.auto) noop = true;
  }

  // #446: what the fast route keeps in place of the test period it does not have.
  let handoff = null;
  let grant = null;
  if (fast) {
    const g = f.finalGrant || { ok: false, detail: `release.final-grant #${p.effective.finalGrant.issue} was not resolved — an unresolved grant is not a grant` };
    add('final-grant', g.ok, g.detail, !f.finalGrant || isUnread(g));
    if (g.ok) grant = { issue: p.effective.finalGrant.issue, ruledBy: g.ruledBy || null };
    const h = f.holds || { ok: false, detail: `${HOLD_LABEL} was not measured` };
    add('release-hold', h.ok, h.detail, !f.holds || isUnread(h));
    const mig = f.migrations || { ok: false, detail: 'migrations since the last final were not measured' };
    add('migration-grant', mig.ok, mig.detail, !f.migrations || isUnread(mig));
    if (!mig.ok && v.ok && mig.paths && mig.paths.length) handoff = migrationHandoff(f.trackingIssue, v.version);
  } else if (library) {
    // #590: a human veto still holds an automatic final; nothing else the fast route adds applies.
    const h = f.holds || { ok: false, detail: `${HOLD_LABEL} was not measured` };
    add('release-hold', h.ok, h.detail, !f.holds || isUnread(h));
  }

  const refusals = checks.filter((c) => !c.ok);
  const ok = refusals.length === 0 && !!tag;
  // #467: the refusals that will not clear by themselves — empty on ok and on a no-op, whose
  // "failures" (cadence, nothing merged, head already a candidate) are the route holding.
  const standing = ok || noop ? [] : refusals
    .filter((c) => STANDING_CONDITIONS.includes(c.condition) && !unreadSet.has(c.condition))
    .map((c) => c.condition);
  return {
    ok, noop: !ok && noop, standing, checks, refusals, version: v.ok ? v.version : null, tag: ok ? tag : null,
    bump: v.ok ? v.bump : (v.bump || null), overridden: v.ok ? v.overridden : null,
    signals: f.auto ? f.auto.signals || null : null, migration: v.migration || null,
    derivable,
    versionSourceDeclared: !!(p && p.effective && p.effective.versionSourceDeclared),
    final: finalRoute, route: finalRoute ? (fast ? 'deploy-tag-fast' : 'library-fast') : null, grant, handoff,
    healthGate: fast ? p.effective.healthGate : null,
  };
}

/** #438: the policy's version source — 'manifest' when there is no policy to read. */
function versionSourceOf(policy) {
  return policy && policy.effective && policy.effective.versionSource === 'tag' ? 'tag' : 'manifest';
}

/** The annotated tag's message — where the chosen bump, its reason and every checked condition are recorded. */
function tagMessage(verdict, { sha, lastFinal, checkedBy }) {
  // #446: a fast-route final. Its subject deliberately does NOT end in "(colab release cut)", so no
  // reader of candidates (cutCandidates, finalize's CUT_SUBJECT_SUFFIX) ever mistakes it for one.
  const fast = !!verdict.final;
  const route = verdict.route || 'deploy-tag-fast';
  const lines = [
    fast ? `${verdict.tag} — release (colab release cut, ${route})` : `${verdict.tag} — release candidate (colab release cut)`,
    '',
    `Commit: ${sha}`,
    `Since: ${lastFinal}`,
    // #673: which colab decided — two channels reading one commit differently is then visible here.
    ...(checkedBy ? [`Checked by: ${checkedBy}`] : []),
    `Bump: ${verdict.bump}${verdict.overridden ? ` (overridden from ${verdict.overridden.from || 'no bump'} — reason: ${verdict.overridden.reason})` : ''}${verdict.signals ? ' (computed by --auto)' : ''}`,
    '',
    ...(verdict.signals ? ['Signals (every input the bump read):', ...verdict.signals.lines.map((l) => `- ${l}`), ''] : []),
    ...(verdict.migration && verdict.migration.section ? ['Migration:', '', verdict.migration.section, ''] : []),
    ...(fast && verdict.grant ? [`Automatic final granted by: release.final-grant -> decision #${verdict.grant.issue}${verdict.grant.ruledBy ? `, ruled by ${verdict.grant.ruledBy}` : ''} (an operator's per-repo grant; deleting it, or route: deploy-tag, revokes it)`] : []),
    ...(fast && verdict.healthGate ? [`Health gate: ${verdict.healthGate.url} (rollback: ${verdict.healthGate.rollback}) — the release workflow deploys this tag in the same run and verifies it there`, ''] : []),
    // #484: a defaulted `tag` says so — the stale manifest is named on every cut, so an artifact that
    // reads it unstamped is visible here rather than discovered by a user.
    ...(verdict.derivable && verdict.derivable.length ? [verdict.versionSourceDeclared
      ? `Derivable manifests (release.version-source: tag, not checked against the tag): ${verdict.derivable.join(', ')}`
      : `Derivable manifests (release.version-source: tag — the default on a route that tags automatically, #484; not checked against the tag): ${verdict.derivable.join(', ')}`, ''] : []),
    'Conditions (CONVENTIONS.md §6):',
    ...verdict.checks.map((c) => `- ${c.condition}: ${c.detail}`),
    '',
    fast
      ? (route === 'library-fast'
        ? 'A final with no candidate: route library-fast — a library released per merge; nothing deploys from this tag (CONVENTIONS.md §6).'
        : 'A final with no candidate: route deploy-tag-fast, by the operator\'s grant (CONVENTIONS.md §6).')
      : 'A candidate, never a final: finalizing it is the release skill\'s, after its test period.',
  ];
  return lines.join('\n') + '\n';
}

module.exports = {
  CONDITIONS, FAST_CONDITIONS, STANDING_CONDITIONS, BUMPS, MIGRATION_FILE, RELEASE_BRANCH, HOLD_LABEL,
  isFastRoute, isLibraryRoute, decideManifestVersion, spacingVerdict, holdsVerdict, migrationHandoff,
  parseVersion, formatVersion, candidateNumbers, nextCandidateNumber, decideVersion,
  parseGuardOutput, exportsDiff, switchRemovalsSince, autoSignals, parseMigrationSection, decideAutoVersion, cadenceVerdict, qualifiedShaVerdict,
  fullSuiteVerdict, withoutOwnWorkflow, withoutSkippedOnlyWorkflows, verifyingRunsForCut, verifyingNote, isMigrationPath, schemaVerdict, addedLinesFromDiff,
  parseSwitchMarkers, switchVerdict,
  promotionVerdict, decide, tagMessage, versionSourceOf,
  DOWNSTREAM_EVENTS, headCandidateVerdict, prereleaseArgs, finalReleaseArgs, handoffTrackingBody,
};
