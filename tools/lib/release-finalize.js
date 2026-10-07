'use strict';
/**
 * tools/lib/release-finalize.js — the decision behind `colab release finalize` (#339).
 *
 * `colab release cut` (#338, release-cut.js) makes a CANDIDATE, `vX.Y.Z-rc.N`. This module decides
 * what happens to that candidate next under CONVENTIONS.md §6's release rung: keep testing, stop on
 * a human veto, ask for a new candidate, hand a human the one command, or tag the final.
 *
 * PURE BY CONSTRUCTION, the release-cut.js posture: no git, no network, no `gh`, no clock (`now` is
 * passed in). The CLI in tools/colab is the measuring half.
 *
 * WHERE PER-CANDIDATE STATE LIVES (the contract a downstream dashboard's release view reads — change
 * it and every consumer breaks, so it is frozen here and documented in tools/README.md, *Release finalize*):
 *
 *   - the candidates are the annotated `vX.Y.Z-rc.N` tags on origin that `colab release cut` made
 *     (first line of the tag message ends `(colab release cut)`); nothing else stores them;
 *   - ONE tracking issue per VERSION, never per candidate: title `release: vX.Y.Z`, body's first
 *     line `<!-- colab:release version=vX.Y.Z -->`. Per version because the veto lives on it — a
 *     `release-hold` on rc.1's issue must still hold rc.2, and no command may move or remove it;
 *   - the veto is the `release-hold` label on that issue (a held, still-open issue of a SUPERSEDED
 *     version blocks too — a human's hold is never outlived by a newer version number);
 *   - a regression against the candidate is a `blocked_by` edge on that issue
 *     (`colab blocked <tracking> --by <regression>`): open -> not finalizable; closed AFTER the test
 *     period started -> the fix is not in this candidate, so a new candidate is owed;
 *   - the test period starts at max(candidate tag's taggerdate, tracking issue's createdAt), so an
 *     issue opened late can never shorten the window a human had to veto in;
 *   - events are comments on the issue carrying `<!-- colab:release-event k=v … -->` markers.
 *
 * Nothing else is stored: trunk-green-throughout is re-measured from GitHub's run list on every run —
 * over `main` and, where project.yml's `trunk:` is another branch, that branch too (#437, windowBranches).
 *
 * `--auto` (#423) changes WHICH candidate a run judges, nothing else: instead of always the newest
 * one (whose clock a daily cut keeps restarting, so on a repo cutting a candidate every day no
 * candidate ever finished a test period), it walks the open candidates newest-first and finalizes
 * the newest one whose OWN test period has elapsed clean — each candidate on its own clock, a newer
 * candidate never restarting an older one's (openCandidates + pickNewestClean). Trunk-green is then
 * read over that candidate's own window [start, endsAt], so a red run after its window closed is
 * about newer code, not it. The release-hold veto and the regression blocked_by rule are unchanged.
 * On a route whose final is a human act (`deploy-tag`) --auto never tags: it stops at
 * candidate-ready and posts the one command, number pre-filled.
 *
 * `--tag` (#548) may name ANY open candidate, not only the newest, so a human can release what
 * finished testing without trunk freezing for a whole period. An older one is held to the same rule
 * --auto applies to it: its own test period and its own trunk window are required on every row
 * (selectCandidate marks it `older`; decide() reads that). Newer candidates stay open, and a
 * version's record closes as superseded only once a final ABOVE it is tagged.
 *
 * Before ANY final, the three #424 pre-tag checks (release-tag.js preTagChecks) are required:
 * manifest-version, on-trunk, outranks-final.
 *
 * ANNOUNCING THE FINAL ON THE ISSUES IT CARRIES (#426). For a repo others install, merged is not
 * delivered: the reporter of a fixed bug needs to know which VERSION has the fix. Once a final is
 * tagged, every issue the version carries gets one comment, `Released in vX.Y.Z`. "Carries" is read
 * from git, not from the tracker: every commit in (previous final, the final's commit] whose message
 * holds a GitHub closing keyword (`Closes #N`, `Fixes #N`, … — the vocabulary GitHub itself honours,
 * the same one lib/squash.js CLOSING_KEYWORD_RE scans) — i.e. exactly the issues trunk closed. Each
 * comment carries `<!-- colab:release-event released=vX.Y.Z -->`, so a re-run (or the `already-final`
 * resume after a run died between the tag push and the comments) posts nothing twice. With no
 * previous final there is no lower bound; the first version announces nothing rather than every
 * issue the repo ever closed.
 */

const releaseTag = require('./release-tag');

// The tracking marker and the event marker are wire format: codec/release.js (#498, epic #496),
// re-exported below under the names this module always had. VERSION_RE is the codec's, so a
// marker's version and a tag's version are judged by one pattern.
const releaseCodec = require('./codec/release');
const { VERSION_RE } = releaseCodec;
const CANDIDATE_RE = /^(v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))-rc\.([1-9][0-9]*)$/;
const CUT_SUBJECT_SUFFIX = '(colab release cut)';
const HOLD_LABEL = 'release-hold';

const STATES = Object.freeze([
  'no-candidate', 'already-final', 'testing', 'held', 'needs-new-candidate', 'refused', 'candidate-ready', 'finalized',
]);

const CONDITIONS = Object.freeze([
  'release-policy', 'candidate', 'tracking-issue', 'release-hold', 'regressions', 'test-period', 'trunk-green',
  'ci-green', 'full-suite', 'schema-additive', 'switch-dependencies',
  ...releaseTag.PRE_TAG_CONDITIONS, 'final-grant', 'migration-grant', 'human',
]);

// A completed run with one of these conclusions does not make trunk red.
const NOT_RED = new Set(['success', 'skipped', 'neutral']);

function parseVersion(v) {
  const m = VERSION_RE.exec(String(v || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  const x = parseVersion(a); const y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** `vX.Y.Z-rc.N` -> { version, n }, or null. */
function parseCandidate(tag) {
  const m = CANDIDATE_RE.exec(String(tag || ''));
  return m ? { version: m[1], n: Number(m[2]) } : null;
}

// ---- the tracking issue -------------------------------------------------------------------------

/** The version a tracking issue's body declares, or null. Only the marker counts, never the title. */
const parseReleaseMarker = releaseCodec.decodeTrackingMarker;
const releaseMarker = releaseCodec.encodeTrackingMarker;
/** `<!-- colab:release-event k=v … -->`, keys in the order given. */
const eventMarker = releaseCodec.encodeReleaseEvent;

/** True when some comment body already carries exactly this event marker — a re-run posts nothing twice. */
function hasEvent(comments, fields) {
  const marker = eventMarker(fields);
  return (comments || []).some((c) => String((c && c.body) || '').includes(marker));
}

function trackingTitle(version) { return `release: ${version}`; }

/** The body, written once at creation. The candidate is deliberately not in it — the tags record that. */
function trackingBody({ version, row, final, testPeriodDays }) {
  return [
    releaseMarker(version),
    '',
    `Release tracking record for **${version}** — opened by \`colab release finalize\` (CONVENTIONS.md §6, *The release rung*). A record, not a unit of work: never claimed, never started.`,
    '',
    `- Rung row: \`${row}\` — the final tag is **${final === 'auto' ? `automatic after a clean ${testPeriodDays}-day test period` : 'a human act'}**.`,
    `- **Veto:** add the \`${HOLD_LABEL}\` label. While it is present no final is tagged for this version; only a human removes it.`,
    `- **Regression against a candidate:** \`colab blocked <this issue> --by <regression issue>\`. An open one stops the final; one closed after the test period started means a new candidate is owed, and the test period restarts on it.`,
    '- Candidates are the `' + version + '-rc.N` tags; each one is announced below as it is picked up.',
  ].join('\n') + '\n';
}

// ---- which candidate ----------------------------------------------------------------------------

/**
 * `tags` is [{ name, annotated, sha, date, subject, onMain }] for every tag in the repo.
 * `pin` is `--tag`, or null. Returns one of:
 *   { kind: 'none', detail }
 *   { kind: 'already-final', version, detail }
 *   { kind: 'refused', detail }
 *   { kind: 'candidate', candidate: { tag, version, n, sha, cutAt }, superseded: [version], detail }
 *   { kind: 'candidate', older: true, newest: <tag>, … }   #548: `pin` names an open candidate that
 *     is not the newest — decide() then requires its own test period and trunk window, as --auto does
 */
function selectCandidate(tags, pin, remote = 'origin') {
  const all = tags || [];
  const finals = new Set(all.filter((t) => parseVersion(t.name)).map((t) => t.name));
  const rcs = all.map((t) => ({ t, p: parseCandidate(t.name) })).filter((x) => x.p);

  if (pin) {
    const p = parseCandidate(pin);
    if (!p) return { kind: 'refused', detail: `--tag ${pin} is not a candidate tag (vX.Y.Z-rc.N)` };
    if (!all.some((t) => t.name === pin)) return { kind: 'refused', detail: `--tag ${pin} does not exist on ${remote}` };
    if (finals.has(p.version)) return { kind: 'already-final', version: p.version, detail: `${p.version} is already a final tag` };
  }

  const open = rcs.filter((x) => !finals.has(x.p.version));
  if (!open.length) {
    if (pin) return { kind: 'refused', detail: `--tag ${pin} is not an open candidate` };
    const done = rcs.map((x) => x.p.version).sort(compareVersions);
    return done.length
      ? { kind: 'already-final', version: done[done.length - 1], detail: `every candidate's version is already final (newest: ${done[done.length - 1]})` }
      : { kind: 'none', detail: 'no candidate tag (vX.Y.Z-rc.N) whose version is not final yet' };
  }
  open.sort((a, b) => compareVersions(a.p.version, b.p.version) || a.p.n - b.p.n);
  const newest = open[open.length - 1];
  const superseded = [...new Set(open.map((x) => x.p.version).filter((v) => v !== newest.p.version))];

  // #548: --tag may name an OLDER open candidate. It is then judged on its own clock, exactly as
  // --auto judges it (decide() makes test-period and trunk-green over its own window required), so a
  // human can release what finished testing while trunk keeps merging; the newer candidates stay open.
  const chosen = pin ? open.find((x) => x.t.name === pin) : newest;
  if (!chosen) return { kind: 'refused', detail: `--tag ${pin} is not an open candidate` };
  const older = chosen !== newest;
  const t = chosen.t;
  if (!t.annotated || !String(t.subject || '').endsWith(CUT_SUBJECT_SUFFIX)) {
    return { kind: 'refused', detail: `${t.name} was not made by \`colab release cut\` (not an annotated tag whose message ends "${CUT_SUBJECT_SUFFIX}") — a candidate cut by hand is never finalized (CONVENTIONS.md §6)` };
  }
  if (!t.onMain) return { kind: 'refused', detail: `${t.name} (${String(t.sha).slice(0, 7)}) is not on ${remote}/main — candidates are cut from main` };
  if (!t.date || Number.isNaN(Date.parse(t.date))) return { kind: 'refused', detail: `${t.name} has no readable tagger date — the test period cannot be placed` };

  if (older) {
    // Only versions BELOW the pinned one are superseded by it; a newer version's candidates stay open.
    const below = [...new Set(open.map((x) => x.p.version).filter((v) => compareVersions(v, chosen.p.version) < 0))];
    const newer = open.filter((x) => compareVersions(x.p.version, chosen.p.version) > 0 || (x.p.version === chosen.p.version && x.p.n > chosen.p.n)).map((x) => x.t.name);
    return {
      kind: 'candidate',
      older: true,
      newest: newest.t.name,
      candidate: { tag: t.name, version: chosen.p.version, n: chosen.p.n, sha: t.sha, cutAt: new Date(t.date).toISOString() },
      superseded: below,
      detail: `${t.name} at ${String(t.sha).slice(0, 7)}, cut ${new Date(t.date).toISOString()} — an older candidate, judged on its own clock (newer, still open: ${newer.join(', ')})${below.length ? `; supersedes ${below.join(', ')}` : ''}`,
    };
  }
  return {
    kind: 'candidate',
    candidate: { tag: t.name, version: newest.p.version, n: newest.p.n, sha: t.sha, cutAt: new Date(t.date).toISOString() },
    superseded,
    detail: `${t.name} at ${String(t.sha).slice(0, 7)}, cut ${new Date(t.date).toISOString()}${superseded.length ? ` (supersedes ${superseded.join(', ')})` : ''}`,
  };
}

/**
 * --auto (#423): every OPEN candidate, newest first — the walk pickNewestClean takes. Each entry is
 * { tag, version, n, sha, cutAt, refused } where `refused` is null or why this one candidate can never
 * be finalized (hand-made, off main, no tagger date) — it is skipped, never finalized, and reported.
 */
function openCandidates(tags, remote = 'origin') {
  const all = tags || [];
  const finals = new Set(all.filter((t) => parseVersion(t.name)).map((t) => t.name));
  const open = all.map((t) => ({ t, p: parseCandidate(t.name) })).filter((x) => x.p && !finals.has(x.p.version));
  open.sort((a, b) => compareVersions(b.p.version, a.p.version) || b.p.n - a.p.n);
  return open.map(({ t, p }) => {
    let refused = null;
    if (!t.annotated || !String(t.subject || '').endsWith(CUT_SUBJECT_SUFFIX)) refused = `${t.name} was not made by \`colab release cut\` — a candidate cut by hand is never finalized`;
    else if (!t.onMain) refused = `${t.name} (${String(t.sha).slice(0, 7)}) is not on ${remote}/main`;
    else if (!t.date || Number.isNaN(Date.parse(t.date))) refused = `${t.name} has no readable tagger date — its test period cannot be placed`;
    return { tag: t.name, version: p.version, n: p.n, sha: t.sha, cutAt: refused ? null : new Date(t.date).toISOString(), refused };
  });
}

/**
 * #468: the one check that explains a verdict's state, as `<condition>: <detail>` — or null when the
 * state needs no explaining (finalized, already-final). What a reader of a run needs is WHY this
 * candidate did not finalize, not the whole checklist again.
 */
function stateDetail(verdict) {
  const v = verdict || {};
  const checks = v.checks || [];
  const failing = (name) => checks.find((c) => c.condition === name && !c.ok);
  const fmt = (c) => (c ? `${c.condition}: ${c.detail}` : null);
  switch (v.state) {
    case 'finalized': case 'already-final': return null;
    case 'held': return fmt(failing('release-hold'));
    case 'needs-new-candidate': return fmt(failing('regressions') || failing('trunk-green'));
    case 'testing': return fmt(failing('test-period') || failing('trunk-green'));
    case 'candidate-ready': return fmt(failing('human'));
    default: return fmt(checks.find((c) => c.required !== false && !c.ok) || checks.find((c) => !c.ok));
  }
}

/**
 * --auto (#423): `evaluations` is [{ candidate, verdict, period? }] NEWEST FIRST, one decide() per
 * candidate judged. Returns { candidate, verdict, skipped: [{ tag, state, detail, endsAt }] }:
 *   - any `held` verdict wins outright — a human veto is never walked around;
 *   - else the first `finalized` (the newest candidate clean on its own clock);
 *   - else the newest candidate's verdict (testing, refused …), with the older ones listed as skipped.
 * #468: each skipped entry says why (stateDetail) and when its own period ends, so a run that
 * finalizes nothing can say which candidate finals first — the fallback to the newest candidate
 * otherwise reads exactly like "only the newest candidate is considered".
 */
function pickNewestClean(evaluations) {
  const ev = evaluations || [];
  if (!ev.length) return { candidate: null, verdict: null, skipped: [] };
  const held = ev.find((e) => e.verdict.state === 'held');
  const pick = held || ev.find((e) => e.verdict.state === 'finalized') || ev[0];
  return {
    candidate: pick.candidate,
    verdict: pick.verdict,
    skipped: ev.filter((e) => e !== pick).map((e) => ({
      tag: e.candidate.tag, state: e.verdict.state, detail: stateDetail(e.verdict), endsAt: e.period ? e.period.endsAt : null,
    })),
  };
}

/**
 * #468: is any red trunk run (`redAts`, ISO createdAt times from trunkGreenVerdict's `redAt`) inside
 * this candidate's own window [start, endsAt)? The window is half-open exactly as trunkGreenVerdict
 * reads it. True means the candidate would read `needs-new-candidate` — IF the red run's workflow is
 * among the ones that vetted it; that is only known after a full judge, so a true here may be wrong
 * in the safe direction only: a final delayed, never one made.
 */
function windowHasRed(period, redAts) {
  if (!period) return null;
  const startMs = Date.parse(period.start);
  const endMs = Date.parse(period.endsAt);
  return (redAts || []).find((t) => { const ms = Date.parse(t); return ms >= startMs && ms < endMs; }) || null;
}

/**
 * #468: why a run produced no final, in one line, plus the candidate that finals first.
 *   state, candidate, checks   the picked verdict (and its candidate) — the run's reported state
 *   period                     the picked candidate's own period, or null
 *   skipped                    pickNewestClean's skipped list, the cheap-skipped testing ones included
 *   now                        ISO timestamp (the module stays clock-free)
 * Returns null when a final was made (or the version is already final); else { line, next } where
 * `next` = { tag, endsAt, hoursLeft } for the TESTING candidate whose own period ends soonest, or null.
 */
function whyNoFinal({ state, candidate, checks, period, skipped, now } = {}) {
  if (state === 'finalized' || state === 'already-final') return null;
  const nowMs = Date.parse(now);
  const testing = [
    ...(state === 'testing' && candidate && period ? [{ tag: candidate.tag, endsAt: period.endsAt }] : []),
    ...(skipped || []).filter((x) => x.state === 'testing' && x.endsAt),
  ].filter((x) => !Number.isNaN(Date.parse(x.endsAt)));
  testing.sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt) || String(a.tag).localeCompare(String(b.tag)));
  const first = testing[0] || null;
  const next = first
    ? { tag: first.tag, endsAt: first.endsAt, hoursLeft: Number.isNaN(nowMs) ? null : Math.max(0, Math.ceil((Date.parse(first.endsAt) - nowMs) / 3600000)) }
    : null;
  const nextText = next ? `${next.tag} is first, its own test period ends ${next.endsAt}${next.hoursLeft !== null ? ` (${next.hoursLeft}h left)` : ''}` : null;
  const why = stateDetail({ state, checks });
  const tag = candidate ? candidate.tag : 'no candidate';
  let line;
  if (state === 'no-candidate') line = `no open candidate to finalize${why ? ` — ${why}` : ''}`;
  else if (state === 'testing') {
    const allTesting = (skipped || []).every((x) => x.state === 'testing');
    line = allTesting && nextText
      ? `no candidate's own test period has elapsed clean — ${nextText}`
      : `${tag} is still testing (${why || 'test period'})${nextText ? `; ${nextText}` : ''}`;
  } else line = `${tag}: ${state}${why ? ` — ${why}` : ''}${nextText ? `; ${nextText}` : ''}`;
  const older = (skipped || []).filter((x) => x.state !== 'testing');
  if (older.length && state === 'testing') {
    const counts = {};
    for (const x of older) counts[x.state] = (counts[x.state] || 0) + 1;
    line += `; older candidates: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}`;
  }
  return { line, next };
}

// ---- the test period ----------------------------------------------------------------------------

/**
 * { start, endsAt, days, elapsed, detail } — start = max(cutAt, trackingCreatedAt), ISO strings. `days` 0
 * (#549, human final only) is no test period: elapsed at once, and the detail says so.
 */
function periodVerdict({ cutAt, trackingCreatedAt, testPeriodDays, now }) {
  const cut = Date.parse(cutAt);
  const created = trackingCreatedAt ? Date.parse(trackingCreatedAt) : NaN;
  const nowMs = Date.parse(now);
  const startMs = Number.isNaN(created) ? Math.max(cut, nowMs) : Math.max(cut, created);
  const endMs = startMs + testPeriodDays * 86400000;
  const elapsed = nowMs >= endMs;
  const left = Math.max(0, endMs - nowMs);
  const hours = Math.ceil(left / 3600000);
  return {
    start: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    days: testPeriodDays,
    elapsed,
    detail: testPeriodDays === 0
      ? 'no test period (release.test-period: 0d, a human final — the human\'s finalize is the test, #549)'
      : elapsed
      ? `${testPeriodDays}d test period from ${new Date(startMs).toISOString()} ended ${new Date(endMs).toISOString()}`
      : `${testPeriodDays}d test period from ${new Date(startMs).toISOString()} ends ${new Date(endMs).toISOString()} (${hours}h left)`,
  };
}

/**
 * Trunk CI green THROUGHOUT the period. `runs` is the window's `gh run list --branch <b>` rows, merged
 * across windowBranches() by mergeWindowRuns() (null = unread), `truncated` true when a read hit its
 * limit, `branches` the branches read (named in the detail). Only runs created at/after `periodStart`, of a
 * workflow in `suiteWorkflows` (the workflows that vetted the candidate — an unrelated scheduled
 * workflow cannot veto a release), and not `pull_request` events, count.
 *
 * Returns { ok, permanent, pending, detail }:
 *   - a completed run that failed (anything but success/skipped/neutral/cancelled) -> permanent:
 *     trunk was red during this candidate's period, and nothing later un-reds it;
 *   - cancelled -> fine when a LATER run of the same workflow ON THE SAME BRANCH succeeded or is still running
 *     (pending), otherwise not clean (not permanent: a re-run can settle it);
 *   - a run still queued/in progress -> pending.
 */
function trunkGreenVerdict(runs, { periodStart, periodEnd = null, suiteWorkflows, truncated, branches = ['main'] }) {
  const on = (branches && branches.length ? branches : ['main']).join(' + ');
  if (runs === null || runs === undefined) return { ok: false, permanent: false, pending: false, detail: `gh run list on ${on} failed — cannot confirm trunk stayed green` };
  if (truncated) return { ok: false, permanent: false, pending: false, detail: 'the run list hit its read limit — cannot confirm trunk stayed green' };
  const startMs = Date.parse(periodStart);
  // #423: --auto bounds the window to the candidate's own period — a run after it closed is about newer code.
  const endMs = periodEnd ? Date.parse(periodEnd) : Infinity;
  const suite = new Set(suiteWorkflows || []);
  const inWindow = runs.filter((r) => r && Date.parse(r.createdAt) >= startMs && Date.parse(r.createdAt) < endMs && suite.has(r.workflowName || '(unnamed workflow)') && r.event !== 'pull_request');
  const red = inWindow.filter((r) => r.status === 'completed' && !NOT_RED.has(r.conclusion) && r.conclusion !== 'cancelled');
  if (red.length) {
    // #468: redAt — when each red run started — lets an --auto walk skip older candidates whose
    // window holds the same red run without paying a full judge for each (windowHasRed).
    return { ok: false, permanent: true, pending: false, redAt: red.map((r) => r.createdAt), detail: `trunk went red during the test period: ${red.map((r) => `${r.workflowName} ${r.conclusion}${r.branch ? ` on ${r.branch}` : ''} at ${String(r.headSha).slice(0, 7)} (${r.createdAt})`).join('; ')}` };
  }
  const unsettled = [];
  let pending = inWindow.some((r) => r.status !== 'completed');
  for (const c of inWindow.filter((r) => r.status === 'completed' && r.conclusion === 'cancelled')) {
    // #437: a later run on ANOTHER branch tested other code — it never settles this one's cancellation.
    const later = inWindow.filter((r) => r.workflowName === c.workflowName && (r.branch || null) === (c.branch || null) && Date.parse(r.createdAt) > Date.parse(c.createdAt));
    if (later.some((r) => r.status === 'completed' && r.conclusion === 'success')) continue;
    if (later.some((r) => r.status !== 'completed')) { pending = true; continue; }
    unsettled.push(`${c.workflowName} cancelled${c.branch ? ` on ${c.branch}` : ''} at ${String(c.headSha).slice(0, 7)} with no later run`);
  }
  if (unsettled.length) return { ok: false, permanent: false, pending: false, detail: `not settled: ${unsettled.join('; ')}` };
  if (pending) return { ok: false, permanent: false, pending: true, detail: 'a trunk run in the test period is still in flight' };
  return { ok: true, permanent: false, pending: false, detail: `${inWindow.length} run(s) on ${on} of the candidate's workflows since ${periodStart}${periodEnd ? ` until ${periodEnd}` : ''}, none red` };
}

/**
 * #437: the branches whose runs make up the trunk-green window. Candidates are cut from `main`, so
 * `main` is always read; where project.yml's `trunk:` is another branch (`trunk: dev` + `deploy: tag`)
 * it is read too. On that shape `main` receives CI only at promotions, so a `main`-only window holds
 * little beyond the promotion's own run and "trunk stayed green" would be close to vacuous — `trunk:`
 * is where the code under test actually moves during the period. A red run there counts exactly as a
 * red run on `main` does on `trunk: main`, where every run after the cut is newer code too.
 */
function windowBranches(trunk) {
  const t = String(trunk || '').trim();
  return t && t !== 'main' ? [t, 'main'] : ['main'];
}

/**
 * #437: `reads` is [{ branch, read }] where `read` is ghRunsSince()'s { runs, truncated } or null. Returns
 * { runs, truncated } with every row tagged `branch` (deduplicated by databaseId, first read wins), or
 * null when ANY branch could not be read — a window missing one branch is not a window that was clean.
 */
function mergeWindowRuns(reads) {
  const list = reads || [];
  if (!list.length || list.some((x) => !x || !x.read || !Array.isArray(x.read.runs))) return null;
  const seen = new Set();
  const runs = [];
  for (const { branch, read } of list) {
    for (const r of read.runs) {
      if (!r) continue;
      if (r.databaseId !== undefined && r.databaseId !== null) {
        if (seen.has(r.databaseId)) continue;
        seen.add(r.databaseId);
      }
      runs.push({ ...r, branch });
    }
  }
  return { runs, truncated: list.some((x) => !!x.read.truncated) };
}

/**
 * `edges` is the tracking issue's blocked_by list [{ number, state, closedAt }] (null = unread;
 * [] when there is no tracking issue yet). Returns { ok, permanent, detail }.
 */
function regressionVerdict(edges, { periodStart }) {
  if (edges === null || edges === undefined) return { ok: false, permanent: false, detail: 'the tracking issue\'s blocked_by edges could not be read — an unread regression is not a cleared one' };
  const startMs = Date.parse(periodStart);
  const open = edges.filter((e) => String(e.state).toLowerCase() !== 'closed');
  const closedAfter = edges.filter((e) => String(e.state).toLowerCase() === 'closed' && (!e.closedAt || Date.parse(e.closedAt) >= startMs));
  if (open.length) return { ok: false, permanent: false, detail: `open regression(s) against the candidate: ${open.map((e) => `#${e.number}`).join(', ')}` };
  if (closedAfter.length) {
    return { ok: false, permanent: true, detail: `regression(s) fixed after this candidate's test period began (${closedAfter.map((e) => `#${e.number}`).join(', ')}) — the fix is not in it; a new candidate is owed` };
  }
  return { ok: true, permanent: false, detail: edges.length ? `${edges.length} regression edge(s), all closed before the test period began` : 'no regression recorded against the candidate' };
}

// ---- an operator-granted automatic final (#441) ------------------------------------------------

/**
 * On a deploy-tag route whose final the operator granted automatic (release.final-grant), a final
 * that deploys production must not carry a database migration nobody granted: migration stays a
 * human gate. `paths` is every migration file changed since the last final (null = unread);
 * `grant` is migration-grant.js evaluateIssue() of the version's TRACKING issue, bound to the
 * version (`colab migration-grant <tracking> --branch vX.Y.Z`), or null when there was nothing to
 * evaluate. Returns { ok, detail }.
 */
function migrationGrantVerdict({ paths, grant, since }) {
  if (paths === null || paths === undefined) return { ok: false, unread: true, detail: 'the migration files since the last final could not be read — an unread migration is not an absent one' };
  if (!paths.length) return { ok: true, detail: `no migration file changed since ${since || 'the first commit'}` };
  const list = paths.join(', ');
  if (grant && grant.ok) return { ok: true, detail: `${paths.length} migration file(s) since ${since || 'the first commit'} (${list}), granted on the tracking issue #${grant.issue}` };
  return {
    ok: false,
    detail: `${paths.length} migration file(s) since ${since || 'the first commit'} (${list}) and no migration grant on the release${grant && grant.reason ? ` (${grant.reason})` : ''} — an automatically deployed final never carries an ungranted migration; a human finalizes, or grants it first (COLAB_HUMAN=1 colab migration-grant <tracking issue> --branch <version>)`,
  };
}

// ---- the verdict --------------------------------------------------------------------------------

/** The one command a human runs to finalize — printed and posted, never written into a skill. */
function handoffCommand(tag) {
  return `COLAB_HUMAN=1 colab release finalize --tag ${tag} --answered-by "<your name>"`;
}

/**
 * `facts`:
 *   policy       release-policy.js evaluateRelease(doc)
 *   selection    selectCandidate(...)
 *   tracking     { number|null, createdAt|null, held, wouldCreate } | { error }
 *   supersededHeld  [issue numbers]
 *   period       periodVerdict(...)            (when there is a candidate)
 *   trunk        trunkGreenVerdict(...)
 *   regressions  regressionVerdict(...)
 *   ci, suite, schema, switches   { ok, detail }
 *   finalGrant   #441 — release-policy.js finalGrantVerdict() of policy.effective.finalGrant (only
 *                read when the policy carries one; absent = unresolved, never a grant)
 *   migrations   #441 — migrationGrantVerdict() (only read when the policy carries a grant)
 *   human        { bar: bool, answeredBy }
 *
 * Returns { state, checks: [{ condition, ok, required, detail }], finalTag, handoff, grant }.
 *
 * #441: where the final is automatic only by an operator's grant (deploy-tag + release.final-grant),
 * the grant must still resolve AND no ungranted migration may ride along. Either one failing does not
 * refuse the release — it takes the automatic final away, so the run stops at candidate-ready and
 * hands a human the one command, exactly as on an ungranted deploy-tag repo. A human running the
 * bar on a granted repo takes the human path too: the grant adds a way to finalize, never removes one.
 * `grant` in the verdict is { issue, ruledBy } when a granted automatic final was reached, else null.
 */
function decide(facts) {
  const f = facts || {};
  const checks = [];
  const add = (condition, ok, detail, required = true) => checks.push({ condition, ok: !!ok, required, detail });
  const out = (state, extra = {}) => ({ state, checks, finalTag: null, handoff: null, grant: null, ...extra });

  const p = f.policy;
  const finalMode = p && p.effective ? p.effective.final : 'human';
  const row = p && p.derived ? p.derived.row : 'unmatched';
  if (!p) add('release-policy', false, 'no release policy was evaluated');
  else if (p.findings && p.findings.length) add('release-policy', false, `the release: block is invalid — ${p.findings.map((x) => x.text).join('; ')}`);
  else if (!/^released-/.test(row)) add('release-policy', false, `${p.derived.axis}: ${p.derived.why} — nothing to finalize here (CONVENTIONS.md §6, The release rung)`);
  else add('release-policy', true, `${p.derived.axis} (${row}): final ${finalMode}, test period ${p.effective.testPeriodDays}d`);
  if (!checks[0].ok) return out('refused');
  // #446: route deploy-tag-fast tags its finals in `release cut --auto`, with no candidate. A leftover
  // candidate from an earlier route is superseded by the next final — never finalized here, where the
  // grant would otherwise finalize an old -rc days after the operator chose the fast route.
  if (p.effective.finalize === 'on-green-head') {
    add('candidate', false, 'route deploy-tag-fast cuts its finals in `colab release cut --auto` on every green head — there is no candidate to finalize; one left over from an earlier route is superseded by the next final');
    return out('no-candidate');
  }

  const s = f.selection || { kind: 'none', detail: 'no candidate selected' };
  if (s.kind === 'none') { add('candidate', false, s.detail); return out('no-candidate'); }
  if (s.kind === 'already-final') { add('candidate', true, s.detail); return out('already-final', { version: s.version }); }
  if (s.kind !== 'candidate') { add('candidate', false, s.detail); return out('refused'); }
  add('candidate', true, s.detail);
  const cand = s.candidate;

  const t = f.tracking || {};
  if (t.error) { add('tracking-issue', false, t.error); return out('refused'); }
  add('tracking-issue', true, t.number ? `#${t.number} (${trackingTitle(cand.version)})` : `none yet — ${t.wouldCreate ? 'this run opens' : 'a non-dry run opens'} "${trackingTitle(cand.version)}"`);

  const held = [...(t.held && t.number ? [t.number] : []), ...(f.supersededHeld || [])];
  add('release-hold', !held.length, held.length
    ? `${HOLD_LABEL} on ${held.map((n) => `#${n}`).join(', ')} — a human veto; not finalized while it is present, and no command removes it`
    : `no ${HOLD_LABEL} on the tracking issue${(f.supersededHeld || []).length ? '' : ' or any superseded open one'}`);

  const h = f.human || { bar: false };
  // #441: an automatic final that deploys production exists only by the operator's grant.
  const granted = p.effective.finalGrant || null;
  let auto = finalMode === 'auto';
  let grantUsed = null;
  if (granted && auto) {
    const g = f.finalGrant || { ok: false, detail: `release.final-grant #${granted.issue} was not resolved — an unresolved grant is not a grant` };
    add('final-grant', g.ok, `${g.detail}${g.ok ? '' : ' — the final falls back to a human act'}`, false);
    const mig = f.migrations || { ok: false, detail: 'migrations since the last final were not measured' };
    add('migration-grant', mig.ok, `${mig.detail}${mig.ok || !g.ok ? '' : ' — the final falls back to a human act'}`, false);
    if (!g.ok || !mig.ok || h.bar) auto = false;
    else grantUsed = { issue: granted.issue, ruledBy: g.ruledBy || null };
  }
  const reg = f.regressions || { ok: false, permanent: false, detail: 'not measured' };
  add('regressions', reg.ok, reg.detail);
  // #548: an older candidate pinned by --tag is finalized only on its own clean clock — the rule
  // --auto applies to it — whatever the row: a newer candidate exists, so "the human is the test"
  // no longer explains why THIS one, and its own clean period is what does.
  const ownClock = auto || !!s.older;
  const per = f.period || { elapsed: false, detail: 'not measured' };
  add('test-period', per.elapsed, s.older && !auto ? `${per.detail} — required: an older candidate is finalized only once its own period elapsed clean (#548)` : per.detail, ownClock);
  const tr = f.trunk || { ok: false, permanent: false, pending: false, detail: 'not measured' };
  add('trunk-green', tr.ok, tr.detail, ownClock);
  for (const [condition, v] of [['ci-green', f.ci], ['full-suite', f.suite], ['schema-additive', f.schema], ['switch-dependencies', f.switches]]) {
    add(condition, v && v.ok, v ? v.detail : 'not measured');
  }
  // #424: before any final — the tag equals the manifests, the commit is on trunk, the version outranks the latest final.
  for (const c of releaseTag.preTagChecks({ tag: cand.version, manifests: f.manifests, ancestry: f.ancestry, tags: f.tags, trunk: 'main', versionSource: p.effective.versionSource === 'tag' ? 'tag' : 'manifest' })) add(c.condition, c.ok, c.detail);
  if (!auto) {
    add('human', h.bar, h.bar
      ? `human bar met — answered by ${h.answeredBy}`
      : 'the final tag is a human act on this row: an agent run stops at candidate-ready and hands over the command');
  }

  if (held.length) return out('held');
  if ((reg.permanent) || (ownClock && tr.permanent)) return out('needs-new-candidate');
  const blocking = checks.filter((c) => c.required && !c.ok && !['test-period', 'trunk-green', 'human'].includes(c.condition));
  if (blocking.length) return out('refused');
  if (ownClock) {
    if (!tr.ok && !tr.pending) return out('refused');
    if (!per.elapsed || tr.pending) return out('testing');
  }
  if (auto) return out('finalized', { finalTag: cand.version, grant: grantUsed });
  if (!h.bar) return out('candidate-ready', { handoff: handoffCommand(cand.tag) });
  return out('finalized', { finalTag: cand.version });
}

// ---- announcing the final (#426) ----------------------------------------------------------------

// GitHub's closing-keyword vocabulary — kept identical to lib/squash.js CLOSING_KEYWORD_RE.
const CARRIED_RE = /\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s*:?\s*#(\d+)\b/gi;

/**
 * The issue numbers a release carries: every closing reference in `messages` (the commit messages in
 * the version's range), deduplicated, ascending, minus `exclude` (the release tracking issues — a
 * record, never something a release "fixes").
 */
function carriedIssues(messages, { exclude = [] } = {}) {
  const skip = new Set((exclude || []).map(Number));
  const out = new Set();
  for (const msg of messages || []) {
    CARRIED_RE.lastIndex = 0;
    let m;
    while ((m = CARRIED_RE.exec(String(msg || '')))) {
      const n = Number(m[1]);
      if (n > 0 && !skip.has(n)) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The highest final tag strictly below `version`, or null — the lower bound of what `version` carries. */
function previousFinal(tagNames, version) {
  const below = (tagNames || []).filter((t) => parseVersion(t) && compareVersions(t, version) < 0).sort(compareVersions);
  return below.length ? below[below.length - 1] : null;
}

/** The event fields of a "released in" comment — one per issue per version. */
function releasedEvent(version) { return { released: version }; }

/** The comment body posted on each carried issue (marker included) — codec `encodeReleasedComment`. */
function releasedComment(version, sha) {
  return releaseCodec.encodeReleasedComment({ version, sha });
}

/** The final tag's annotated message: which candidate, which period, every condition, who. */
function tagMessage(verdict, { candidate, period, actor }) {
  return [
    `${candidate.version} — release (colab release finalize)`,
    '',
    `Candidate: ${candidate.tag}`,
    `Commit: ${candidate.sha}`,
    period ? (period.days === 0 ? 'Test period: none (release.test-period: 0d — the human final is the test)' : `Test period: ${period.start} -> ${period.endsAt}`) : null,
    `Finalized by: ${actor}`,
    verdict.grant ? `Automatic final granted by: release.final-grant -> decision #${verdict.grant.issue}${verdict.grant.ruledBy ? `, ruled by ${verdict.grant.ruledBy}` : ''} (an operator's per-repo grant; deleting it, or final: human, revokes it)` : null,
    '',
    'Conditions (CONVENTIONS.md §6):',
    ...verdict.checks.map((c) => `- ${c.condition}: ${c.ok ? 'ok' : (c.required ? 'FAILED' : 'informational')} — ${c.detail}`),
  ].filter((l) => l !== null).join('\n') + '\n';
}

module.exports = {
  STATES, CONDITIONS, HOLD_LABEL, CUT_SUBJECT_SUFFIX,
  parseVersion, compareVersions, parseCandidate,
  parseReleaseMarker, releaseMarker, eventMarker, hasEvent, trackingTitle, trackingBody,
  selectCandidate, openCandidates, pickNewestClean, stateDetail, windowHasRed, whyNoFinal, periodVerdict, trunkGreenVerdict, windowBranches, mergeWindowRuns, regressionVerdict,
  handoffCommand, decide, tagMessage, migrationGrantVerdict,
  carriedIssues, previousFinal, releasedEvent, releasedComment,
};
