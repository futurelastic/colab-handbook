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
 * WHERE PER-CANDIDATE STATE LIVES (the contract futurelastic/hangar#125 reads — change it and every
 * consumer breaks, so it is frozen here and documented in tools/README.md, *Release finalize*):
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
 * Nothing else is stored: trunk-green-throughout is re-measured from GitHub's run list on every run.
 */

const VERSION_RE = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const CANDIDATE_RE = /^(v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))-rc\.([1-9][0-9]*)$/;
const CUT_SUBJECT_SUFFIX = '(colab release cut)';
const HOLD_LABEL = 'release-hold';

const STATES = Object.freeze([
  'no-candidate', 'already-final', 'testing', 'held', 'needs-new-candidate', 'refused', 'candidate-ready', 'finalized',
]);

const CONDITIONS = Object.freeze([
  'release-policy', 'candidate', 'tracking-issue', 'release-hold', 'regressions', 'test-period', 'trunk-green',
  'ci-green', 'full-suite', 'schema-additive', 'switch-dependencies', 'human',
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

const RELEASE_MARKER_RE = /<!--\s*colab:release\s+version=(v[0-9]+\.[0-9]+\.[0-9]+)\s*-->/;

/** The version a tracking issue's body declares, or null. Only the marker counts, never the title. */
function parseReleaseMarker(body) {
  const m = RELEASE_MARKER_RE.exec(String(body || ''));
  return m && parseVersion(m[1]) ? m[1] : null;
}

function releaseMarker(version) { return `<!-- colab:release version=${version} -->`; }

/** `<!-- colab:release-event k=v … -->`, keys in the order given. */
function eventMarker(fields) {
  return `<!-- colab:release-event ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ')} -->`;
}

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

  if (pin && pin !== newest.t.name) {
    return { kind: 'refused', detail: `--tag ${pin} is not the newest candidate (${newest.t.name}) — a final names the candidate that was actually tested last` };
  }
  const t = newest.t;
  if (!t.annotated || !String(t.subject || '').endsWith(CUT_SUBJECT_SUFFIX)) {
    return { kind: 'refused', detail: `${t.name} was not made by \`colab release cut\` (not an annotated tag whose message ends "${CUT_SUBJECT_SUFFIX}") — a candidate cut by hand is never finalized (CONVENTIONS.md §6)` };
  }
  if (!t.onMain) return { kind: 'refused', detail: `${t.name} (${String(t.sha).slice(0, 7)}) is not on ${remote}/main — candidates are cut from main` };
  if (!t.date || Number.isNaN(Date.parse(t.date))) return { kind: 'refused', detail: `${t.name} has no readable tagger date — the test period cannot be placed` };

  return {
    kind: 'candidate',
    candidate: { tag: t.name, version: newest.p.version, n: newest.p.n, sha: t.sha, cutAt: new Date(t.date).toISOString() },
    superseded,
    detail: `${t.name} at ${String(t.sha).slice(0, 7)}, cut ${new Date(t.date).toISOString()}${superseded.length ? ` (supersedes ${superseded.join(', ')})` : ''}`,
  };
}

// ---- the test period ----------------------------------------------------------------------------

/** { start, endsAt, elapsed, detail } — start = max(cutAt, trackingCreatedAt). All ISO strings. */
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
    elapsed,
    detail: elapsed
      ? `${testPeriodDays}d test period from ${new Date(startMs).toISOString()} ended ${new Date(endMs).toISOString()}`
      : `${testPeriodDays}d test period from ${new Date(startMs).toISOString()} ends ${new Date(endMs).toISOString()} (${hours}h left)`,
  };
}

/**
 * Trunk CI green THROUGHOUT the period. `runs` is `gh run list --branch main` rows (null = unread),
 * `truncated` true when the read hit its limit. Only runs created at/after `periodStart`, of a
 * workflow in `suiteWorkflows` (the workflows that vetted the candidate — an unrelated scheduled
 * workflow cannot veto a release), and not `pull_request` events, count.
 *
 * Returns { ok, permanent, pending, detail }:
 *   - a completed run that failed (anything but success/skipped/neutral/cancelled) -> permanent:
 *     trunk was red during this candidate's period, and nothing later un-reds it;
 *   - cancelled -> fine when a LATER run of the same workflow succeeded or is still running
 *     (pending), otherwise not clean (not permanent: a re-run can settle it);
 *   - a run still queued/in progress -> pending.
 */
function trunkGreenVerdict(runs, { periodStart, suiteWorkflows, truncated }) {
  if (runs === null || runs === undefined) return { ok: false, permanent: false, pending: false, detail: 'gh run list failed — cannot confirm trunk stayed green' };
  if (truncated) return { ok: false, permanent: false, pending: false, detail: 'the run list hit its read limit — cannot confirm trunk stayed green' };
  const startMs = Date.parse(periodStart);
  const suite = new Set(suiteWorkflows || []);
  const inWindow = runs.filter((r) => r && Date.parse(r.createdAt) >= startMs && suite.has(r.workflowName || '(unnamed workflow)') && r.event !== 'pull_request');
  const red = inWindow.filter((r) => r.status === 'completed' && !NOT_RED.has(r.conclusion) && r.conclusion !== 'cancelled');
  if (red.length) {
    return { ok: false, permanent: true, pending: false, detail: `trunk went red during the test period: ${red.map((r) => `${r.workflowName} ${r.conclusion} at ${String(r.headSha).slice(0, 7)} (${r.createdAt})`).join('; ')}` };
  }
  const unsettled = [];
  let pending = inWindow.some((r) => r.status !== 'completed');
  for (const c of inWindow.filter((r) => r.status === 'completed' && r.conclusion === 'cancelled')) {
    const later = inWindow.filter((r) => r.workflowName === c.workflowName && Date.parse(r.createdAt) > Date.parse(c.createdAt));
    if (later.some((r) => r.status === 'completed' && r.conclusion === 'success')) continue;
    if (later.some((r) => r.status !== 'completed')) { pending = true; continue; }
    unsettled.push(`${c.workflowName} cancelled at ${String(c.headSha).slice(0, 7)} with no later run`);
  }
  if (unsettled.length) return { ok: false, permanent: false, pending: false, detail: `not settled: ${unsettled.join('; ')}` };
  if (pending) return { ok: false, permanent: false, pending: true, detail: 'a trunk run in the test period is still in flight' };
  return { ok: true, permanent: false, pending: false, detail: `${inWindow.length} trunk run(s) of the candidate's workflows since ${periodStart}, none red` };
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
 *   human        { bar: bool, answeredBy }
 *
 * Returns { state, checks: [{ condition, ok, required, detail }], finalTag, handoff }.
 */
function decide(facts) {
  const f = facts || {};
  const checks = [];
  const add = (condition, ok, detail, required = true) => checks.push({ condition, ok: !!ok, required, detail });
  const out = (state, extra = {}) => ({ state, checks, finalTag: null, handoff: null, ...extra });

  const p = f.policy;
  const finalMode = p && p.effective ? p.effective.final : 'human';
  const row = p && p.derived ? p.derived.row : 'unmatched';
  if (!p) add('release-policy', false, 'no release policy was evaluated');
  else if (p.findings && p.findings.length) add('release-policy', false, `the release: block is invalid — ${p.findings.map((x) => x.text).join('; ')}`);
  else if (!/^released-/.test(row)) add('release-policy', false, `${p.derived.axis}: ${p.derived.why} — nothing to finalize here (CONVENTIONS.md §6, The release rung)`);
  else add('release-policy', true, `${p.derived.axis} (${row}): final ${finalMode}, test period ${p.effective.testPeriodDays}d`);
  if (!checks[0].ok) return out('refused');

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

  const auto = finalMode === 'auto';
  const reg = f.regressions || { ok: false, permanent: false, detail: 'not measured' };
  add('regressions', reg.ok, reg.detail);
  const per = f.period || { elapsed: false, detail: 'not measured' };
  add('test-period', per.elapsed, per.detail, auto);
  const tr = f.trunk || { ok: false, permanent: false, pending: false, detail: 'not measured' };
  add('trunk-green', tr.ok, tr.detail, auto);
  for (const [condition, v] of [['ci-green', f.ci], ['full-suite', f.suite], ['schema-additive', f.schema], ['switch-dependencies', f.switches]]) {
    add(condition, v && v.ok, v ? v.detail : 'not measured');
  }
  const h = f.human || { bar: false };
  if (!auto) {
    add('human', h.bar, h.bar
      ? `human bar met — answered by ${h.answeredBy}`
      : 'the final tag is a human act on this row: an agent run stops at candidate-ready and hands over the command');
  }

  if (held.length) return out('held');
  if ((reg.permanent) || (auto && tr.permanent)) return out('needs-new-candidate');
  const blocking = checks.filter((c) => c.required && !c.ok && !['test-period', 'trunk-green', 'human'].includes(c.condition));
  if (blocking.length) return out('refused');
  if (auto) {
    if (!tr.ok && !tr.pending) return out('refused');
    if (!per.elapsed || tr.pending) return out('testing');
    return out('finalized', { finalTag: cand.version });
  }
  if (!h.bar) return out('candidate-ready', { handoff: handoffCommand(cand.tag) });
  return out('finalized', { finalTag: cand.version });
}

/** The final tag's annotated message: which candidate, which period, every condition, who. */
function tagMessage(verdict, { candidate, period, actor }) {
  return [
    `${candidate.version} — release (colab release finalize)`,
    '',
    `Candidate: ${candidate.tag}`,
    `Commit: ${candidate.sha}`,
    period ? `Test period: ${period.start} -> ${period.endsAt}` : null,
    `Finalized by: ${actor}`,
    '',
    'Conditions (CONVENTIONS.md §6):',
    ...verdict.checks.map((c) => `- ${c.condition}: ${c.ok ? 'ok' : (c.required ? 'FAILED' : 'informational')} — ${c.detail}`),
  ].filter((l) => l !== null).join('\n') + '\n';
}

module.exports = {
  STATES, CONDITIONS, HOLD_LABEL, CUT_SUBJECT_SUFFIX,
  parseVersion, compareVersions, parseCandidate,
  parseReleaseMarker, releaseMarker, eventMarker, hasEvent, trackingTitle, trackingBody,
  selectCandidate, periodVerdict, trunkGreenVerdict, regressionVerdict,
  handoffCommand, decide, tagMessage,
};
