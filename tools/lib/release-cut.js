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
 *   schema-additive      §6 condition 3 — no destructive migration since the last final tag
 *   switch-dependencies  §6 condition 4 — the colab:switch markers are readable, and no finished
 *                        switch needs one that is still unfinished
 *
 * Never a final tag. Finalizing a candidate is the release skill's (#339), and a final is a human
 * act on every row where a tag reaches production.
 */

const VERSION_RE = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const BUMPS = Object.freeze(['patch', 'minor']);

const CONDITIONS = Object.freeze([
  'release-policy', 'prerelease-trigger', 'version', 'already-candidate',
  'ci-green', 'full-suite', 'schema-additive', 'switch-dependencies',
]);

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
  const byWorkflow = new Map();
  for (const r of rows) {
    const name = r.workflowName || '(unnamed workflow)';
    if (!byWorkflow.has(name)) byWorkflow.set(name, []);
    byWorkflow.get(name).push(r);
  }
  const missing = [];
  for (const [name, runs] of byWorkflow) {
    if (!runs.some((r) => r.status === 'completed' && r.conclusion === 'success')) {
      missing.push(`${name} (${runs.map((r) => (r.status === 'completed' ? r.conclusion || 'none' : r.status)).join(', ')})`);
    }
  }
  if (missing.length) return { ok: false, detail: `no successful run at ${at} for: ${missing.join('; ')}` };
  return { ok: true, detail: `${byWorkflow.size} workflow(s) at ${at}, each with a successful run` };
}

// ---- §6 condition 3: schema changes are additive -----------------------------------------------

/** The migration layouts `colab ship`'s migration gate reads (Laravel + Prisma) — one rule for both. */
function isMigrationPath(f) {
  return /(^|\/)database\/migrations\//.test(f) || /(^|\/)prisma\/migrations\//.test(f);
}

// Laravel schema-builder calls that destroy or rewrite existing structure. Read only inside `up()`:
// a `down()` that drops what `up()` created is the ordinary shape of an ADDITIVE migration.
const LARAVEL_DESTRUCTIVE = /(\b(drop|dropIfExists|dropColumn|dropColumns|dropForeign|dropConstrainedForeignId|dropIndex|dropPrimary|dropUnique|dropSoftDeletes|dropTimestamps|dropMorphs|dropRememberToken|rename|renameColumn|renameIndex)\s*\(|->\s*change\s*\()/;
// SQL (Prisma writes plain migration.sql). `--` comment lines are stripped first: Prisma labels its
// statements `-- DropIndex`, which is a comment, not a statement.
const SQL_DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE|VIEW|SCHEMA)|RENAME\s+(TO|COLUMN)|ALTER\s+COLUMN|TRUNCATE)\b/i;

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
 */
function schemaVerdict(changes, since) {
  const migrations = (changes || []).filter((c) => isMigrationPath(c.path) && /\.(php|sql)$/.test(c.path));
  const scope = 'Laravel database/migrations + Prisma prisma/migrations — other layouts are not read';
  if (!migrations.length) return { ok: true, detail: `no migration file changed since ${since} (${scope})` };
  const findings = [];
  for (const c of migrations) {
    const st = String(c.status || '').charAt(0);
    if (st !== 'A') { findings.push(`${c.path}: ${st === 'D' ? 'deleted' : st === 'R' ? 'renamed' : 'edited'} — an existing migration was rewritten`); continue; }
    const text = String(c.content || '');
    if (c.path.endsWith('.php')) {
      const m = LARAVEL_DESTRUCTIVE.exec(laravelUpBody(text));
      if (m) findings.push(`${c.path}: \`${m[0].trim()}\` in up()`);
    } else {
      const sql = text.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
      const m = SQL_DESTRUCTIVE.exec(sql);
      if (m) findings.push(`${c.path}: \`${m[0]}\``);
    }
  }
  if (findings.length) {
    return { ok: false, detail: `destructive schema change since ${since} — a release carrying one is a human's to cut (CONVENTIONS.md §6, Switched epics rule 5): ${findings.join('; ')}` };
  }
  return { ok: true, detail: `${migrations.length} migration file(s) added since ${since}, none destructive (${scope})` };
}

// ---- §6 condition 4: switch dependencies -------------------------------------------------------

const SWITCH_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const MARKER_RE = /<!--\s*colab:switch\b([\s\S]*?)-->/g;

/**
 * Every `<!-- colab:switch … -->` marker in one issue body (CONVENTIONS.md §5, Switched epics).
 * Returns { markers: [{ name, needs: [], role: null|'add'|'remove' }], malformed: [text] } — an
 * unknown token, a bad name, `needs` on a child, or two markers for one name disagreeing are all
 * `malformed`: "not cleared", reported, never defaulted.
 */
function parseSwitchMarkers(body) {
  const markers = [];
  const malformed = [];
  const text = String(body || '');
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
  if (issues === null || issues === undefined) return { ok: false, detail: 'the issue list could not be read — switch dependencies cannot be cleared' };
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

// ---- the verdict ------------------------------------------------------------------------------

/**
 * `facts`:
 *   policy        release-policy.js evaluateRelease(doc)
 *   triggers      workflow-triggers.js prereleaseTagTriggers(...) findings
 *   lastFinal, suggestion, override, tags, tagsAtSha
 *   ci, suite, schema, switches   { ok, detail } each, measured by the caller
 *
 * Returns { ok, checks: [{ condition, ok, detail }], refusals, version, tag, bump, overridden }.
 * Every check is reported, not just the first failure: a caller fixing one refusal should not
 * discover the next only on the re-run.
 */
function decide(facts) {
  const f = facts || {};
  const checks = [];
  const add = (condition, ok, detail) => checks.push({ condition, ok: !!ok, detail });

  const p = f.policy;
  if (!p) add('release-policy', false, 'no release policy was evaluated');
  else if (p.findings && p.findings.length) add('release-policy', false, `the release: block is invalid — ${p.findings.map((x) => x.text).join('; ')}`);
  else if (p.effective.candidates !== 'auto') {
    const narrowed = p.declared && p.declared.candidates === 'off' && p.derived.candidates === 'auto';
    add('release-policy', false, narrowed
      ? 'release: candidates: off — this repo narrowed its rung row to no automatic candidates'
      : `candidates are off on ${p.derived.axis}: ${p.derived.why} (CONVENTIONS.md §6, The release rung)`);
  } else {
    add('release-policy', true, `${p.derived.axis} (${p.derived.row}): candidates auto, final ${p.effective.final}, test period ${p.effective.testPeriodDays}d`);
  }

  const trig = f.triggers || [];
  if (trig.length) add('prerelease-trigger', false, `a deploy would fire on a candidate tag: ${trig.map((t) => t.text).join('; ')}`);
  else add('prerelease-trigger', true, 'no deploy workflow fires on a pre-release tag');

  const v = decideVersion({ lastFinal: f.lastFinal, suggestion: f.suggestion, override: f.override, tags: f.tags });
  add('version', v.ok, v.detail);

  let tag = null;
  if (v.ok) {
    const here = candidateNumbers(f.tagsAtSha || [], v.version);
    if (here.length) add('already-candidate', false, `this commit is already ${v.version}-rc.${here[here.length - 1]} — a second candidate for the same commit tests nothing new`);
    else {
      tag = `${v.version}-rc.${nextCandidateNumber(f.tags, v.version)}`;
      add('already-candidate', true, `next candidate: ${tag}`);
    }
  }

  for (const [condition, verdict] of [['ci-green', f.ci], ['full-suite', f.suite], ['schema-additive', f.schema], ['switch-dependencies', f.switches]]) {
    if (!verdict) add(condition, false, 'not measured');
    else add(condition, verdict.ok, verdict.detail);
  }

  const refusals = checks.filter((c) => !c.ok);
  const ok = refusals.length === 0 && !!tag;
  return { ok, checks, refusals, version: v.ok ? v.version : null, tag: ok ? tag : null, bump: v.ok ? v.bump : null, overridden: v.ok ? v.overridden : null };
}

/** The annotated tag's message — where the chosen bump, its reason and every checked condition are recorded. */
function tagMessage(verdict, { sha, lastFinal }) {
  const lines = [
    `${verdict.tag} — release candidate (colab release cut)`,
    '',
    `Commit: ${sha}`,
    `Since: ${lastFinal}`,
    `Bump: ${verdict.bump}${verdict.overridden ? ` (overridden from ${verdict.overridden.from || 'no bump'} — reason: ${verdict.overridden.reason})` : ''}`,
    '',
    'Conditions (CONVENTIONS.md §6):',
    ...verdict.checks.map((c) => `- ${c.condition}: ${c.detail}`),
    '',
    'A candidate, never a final: finalizing it is the release skill\'s, after its test period.',
  ];
  return lines.join('\n') + '\n';
}

module.exports = {
  CONDITIONS, BUMPS,
  parseVersion, formatVersion, candidateNumbers, nextCandidateNumber, decideVersion,
  fullSuiteVerdict, isMigrationPath, schemaVerdict,
  parseSwitchMarkers, switchVerdict,
  decide, tagMessage,
};
