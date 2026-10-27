'use strict';
/**
 * Unit tests for tools/lib/release-cut.js (#338) — the pure decision behind `colab release cut`.
 * The measuring half (git, a faked gh, a real bare origin) is release-cut-cli.test.js.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const rc = require('./release-cut.js');
const releasePolicy = require('./release-policy.js');

const RELEASED = { trunk: 'main', exposure: 'released', production: null, deploy: 'none' };
const green = { ok: true, detail: 'green' };

function facts(over = {}) {
  return {
    policy: releasePolicy.evaluateRelease(RELEASED),
    triggers: [],
    lastFinal: 'v1.2.0',
    suggestion: { bump: 'patch', why: '1 fix commit(s) since the last tag' },
    override: null,
    tags: ['v1.2.0'],
    tagsAtSha: [],
    ci: green, suite: green, schema: green, switches: green,
    manifests: [], ancestry: { ok: true, shallow: false },
    ...over,
  };
}

const refusal = (v, condition) => v.checks.find((c) => c.condition === condition);

// ---- version ----------------------------------------------------------------------------------

test('fix -> patch, feat -> minor, from the last final tag', () => {
  assert.strictEqual(rc.decideVersion({ lastFinal: 'v1.2.0', suggestion: { bump: 'patch', why: 'x' }, tags: [] }).version, 'v1.2.1');
  assert.strictEqual(rc.decideVersion({ lastFinal: 'v1.2.1', suggestion: { bump: 'minor', why: 'x' }, tags: [] }).version, 'v1.3.0');
});

test('a breaking change on a >=1.0 repo refuses, and --bump does not override it', () => {
  const v = rc.decideVersion({ lastFinal: 'v1.2.0', suggestion: { bump: 'major', why: 'a breaking change' }, tags: [] });
  assert.strictEqual(v.ok, false);
  assert.match(v.detail, /2\.0\.0 is a human decision/);
  const o = rc.decideVersion({ lastFinal: 'v1.2.0', suggestion: { bump: 'major', why: 'b' }, override: { bump: 'minor', reason: 'not really breaking' }, tags: [] });
  assert.strictEqual(o.ok, false);
});

test('pre-1.0, a breaking change ships as a minor', () => {
  const v = rc.decideVersion({ lastFinal: 'v0.4.2', suggestion: { bump: 'major', why: 'a breaking change' }, tags: [] });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.version, 'v0.5.0');
  assert.match(v.why, /pre-1\.0/);
});

test('--bump major is refused outright — including the 0.x -> 1.0.0 step', () => {
  for (const lastFinal of ['v0.9.0', 'v1.2.0']) {
    const v = rc.decideVersion({ lastFinal, suggestion: { bump: 'patch', why: 'x' }, override: { bump: 'major', reason: 'ship 1.0' }, tags: [] });
    assert.strictEqual(v.ok, false);
    assert.match(v.detail, /pre-1\.0 -> 1\.0\.0 step/);
  }
});

test('an override needs a reason, and the reason is recorded', () => {
  assert.strictEqual(rc.decideVersion({ lastFinal: 'v1.2.0', suggestion: { bump: null, why: 'docs only' }, override: { bump: 'patch' }, tags: [] }).ok, false);
  const v = rc.decideVersion({ lastFinal: 'v1.2.0', suggestion: { bump: null, why: 'docs only' }, override: { bump: 'patch', reason: 'docs adopters read' }, tags: [] });
  assert.strictEqual(v.version, 'v1.2.1');
  assert.deepStrictEqual(v.overridden, { from: null, to: 'patch', reason: 'docs adopters read' });
});

test('no bump owed, no final tag, a non-semver last tag, an already-final version — each refuses', () => {
  assert.match(rc.decideVersion({ lastFinal: 'v1.2.0', suggestion: { bump: null, why: 'only docs' }, tags: [] }).detail, /nothing to cut/);
  assert.match(rc.decideVersion({ lastFinal: null, suggestion: { bump: 'minor', why: 'x' }, tags: [] }).detail, /first version is a human decision/);
  assert.strictEqual(rc.decideVersion({ lastFinal: 'release-7', suggestion: { bump: 'minor', why: 'x' }, tags: [] }).ok, false);
  assert.match(rc.decideVersion({ lastFinal: 'v1.2.0', suggestion: { bump: 'patch', why: 'x' }, tags: ['v1.2.1'] }).detail, /already a final tag/);
});

test('candidate numbering: one past the highest used, per version', () => {
  const tags = ['v1.2.1-rc.1', 'v1.2.1-rc.3', 'v1.3.0-rc.9', 'v1.2.1-rc.x', 'v1.2.10-rc.4'];
  assert.strictEqual(rc.nextCandidateNumber(tags, 'v1.2.1'), 4);
  assert.strictEqual(rc.nextCandidateNumber(tags, 'v1.4.0'), 1);
});

// ---- decide -----------------------------------------------------------------------------------

test('green path: every check ok, tag is the next candidate', () => {
  const v = rc.decide(facts({ tags: ['v1.2.0', 'v1.2.1-rc.1'] }));
  assert.strictEqual(v.ok, true, JSON.stringify(v.refusals));
  assert.strictEqual(v.tag, 'v1.2.1-rc.2');
  // `cadence` is reported only under --auto (#422); `promotion` only under --auto off trunk: main (#429);
  // `qualified-sha` only for a --sha below main's head (#622).
  assert.deepStrictEqual(v.checks.map((c) => c.condition), rc.CONDITIONS.filter((c) => c !== 'cadence' && c !== 'promotion' && c !== 'qualified-sha' && !rc.FAST_CONDITIONS.includes(c)));
});

test('candidates off — derived (self) and narrowed (release: candidates: off) — refuse on release-policy', () => {
  const self = rc.decide(facts({ policy: releasePolicy.evaluateRelease({ ...RELEASED, exposure: 'self' }) }));
  assert.strictEqual(refusal(self, 'release-policy').ok, false);
  const off = rc.decide(facts({ policy: releasePolicy.evaluateRelease({ ...RELEASED, release: { candidates: 'off' } }) }));
  assert.strictEqual(off.ok, false);
  assert.match(refusal(off, 'release-policy').detail, /candidates: off/);
  const widened = rc.decide(facts({ policy: releasePolicy.evaluateRelease({ ...RELEASED, exposure: 'live', release: { candidates: 'auto' } }) }));
  assert.match(refusal(widened, 'release-policy').detail, /invalid/);
});

test('a pre-release trigger, of either severity, refuses', () => {
  const v = rc.decide(facts({ triggers: [{ level: 'warn', text: 'deploy-prod.yml fires' }] }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(refusal(v, 'prerelease-trigger').ok, false);
});

test('a commit already carrying a candidate of that version refuses', () => {
  const v = rc.decide(facts({ tags: ['v1.2.0', 'v1.2.1-rc.1'], tagsAtSha: ['v1.2.1-rc.1'] }));
  assert.strictEqual(refusal(v, 'already-candidate').ok, false);
  assert.strictEqual(v.tag, null);
});

test('every refusal is reported, not just the first', () => {
  const bad = { ok: false, detail: 'no' };
  const v = rc.decide(facts({ ci: bad, suite: bad, schema: bad, switches: bad }));
  assert.deepStrictEqual(v.refusals.map((c) => c.condition), ['ci-green', 'full-suite', 'schema-additive', 'switch-dependencies']);
});

test('#670: a not-checked schema verdict passes, and its row (only its row) carries checked: false', () => {
  const v = rc.decide(facts({ schema: { ok: true, checked: false, detail: 'not checked — nothing read' } }));
  assert.strictEqual(v.ok, true, 'not checked refuses nothing');
  const row = refusal(v, 'schema-additive');
  assert.strictEqual(row.ok, true);
  assert.strictEqual(row.checked, false);
  for (const c of v.checks.filter((x) => x.condition !== 'schema-additive')) assert.ok(!('checked' in c), c.condition);
  // A real pass keeps the frozen row shape — no checked key at all.
  assert.ok(!('checked' in refusal(rc.decide(facts()), 'schema-additive')));
});

test('the tag message records the bump, the override reason and every condition', () => {
  const v = rc.decide(facts({ suggestion: { bump: null, why: 'docs only' }, override: { bump: 'patch', reason: 'adopters read the docs' } }));
  const msg = rc.tagMessage(v, { sha: 'abc123', lastFinal: 'v1.2.0' });
  assert.match(msg, /^v1\.2\.1-rc\.1 — release candidate/);
  assert.match(msg, /reason: adopters read the docs/);
  for (const c of rc.CONDITIONS.filter((x) => x !== 'cadence' && x !== 'promotion' && x !== 'qualified-sha' && !rc.FAST_CONDITIONS.includes(x))) assert.match(msg, new RegExp(`- ${c}: `));
});

// ---- full suite -------------------------------------------------------------------------------

test('full suite: a workflow whose only run was cancelled did not pass, even beside a green one', () => {
  const rows = [
    { workflowName: 'ci', status: 'completed', conclusion: 'success' },
    { workflowName: 'suite', status: 'completed', conclusion: 'cancelled' },
  ];
  const v = rc.fullSuiteVerdict(rows, 'main@abc');
  assert.strictEqual(v.ok, false);
  assert.match(v.detail, /suite \(cancelled\)/);
  rows.push({ workflowName: 'suite', status: 'completed', conclusion: 'success' });
  assert.strictEqual(rc.fullSuiteVerdict(rows, 'main@abc').ok, true);
  assert.strictEqual(rc.fullSuiteVerdict([], 'main@abc').ok, false);
  assert.strictEqual(rc.fullSuiteVerdict(null, 'main@abc').ok, false);
});

test('#616: a workflow whose only run at the sha was skipped is not run — full-suite and ci-green both pass', () => {
  const git = require('./git');
  const S = 'abc123';
  const row = (workflowName, conclusion, i) => ({ workflowName, status: 'completed', conclusion, headSha: S, event: 'push', databaseId: i, createdAt: `2026-10-16T00:0${i}:00Z` });
  const rows = [row('CI', 'success', 1), row('Release gate', 'success', 2), row('Load', 'skipped', 3)];
  const suite = rc.fullSuiteVerdict(rows, 'main@abc');
  assert.strictEqual(suite.ok, true, suite.detail);
  assert.match(suite.detail, /2 workflow\(s\).*skipped: Load/);
  const judged = rc.withoutSkippedOnlyWorkflows(rows);
  assert.deepStrictEqual(judged.map((r) => r.workflowName), ['CI', 'Release gate']);
  assert.strictEqual(rc.fullSuiteVerdict(judged, 'main@abc').ok, true);
  const ci = git.summarizeRunsForCommit(judged, S);
  assert.strictEqual(ci.conclusion, 'success');
  // the ship gate is untouched: unfiltered, the same rows still read not-green there (#514)
  assert.strictEqual(git.summarizeRunsForCommit(rows, S).conclusion, 'skipped');
});

test('#616: skipped beside a red run of the same workflow stays red; cancelled-only and all-skipped stay refused', () => {
  const git = require('./git');
  const S = 'abc123';
  const row = (workflowName, conclusion, i) => ({ workflowName, status: 'completed', conclusion, headSha: S, event: 'push', databaseId: i, createdAt: `2026-10-16T00:0${i}:00Z` });
  const red = [row('CI', 'success', 1), row('Load', 'skipped', 2), row('Load', 'failure', 3)];
  assert.strictEqual(rc.fullSuiteVerdict(red, 'main@abc').ok, false);
  const judged = rc.withoutSkippedOnlyWorkflows(red);
  assert.strictEqual(judged, red, 'a workflow with any non-skipped run keeps all its rows');
  assert.strictEqual(git.summarizeRunsForCommit(judged, S).conclusion, 'failure');
  const cancelled = [row('CI', 'success', 1), row('suite', 'cancelled', 2)];
  assert.strictEqual(rc.withoutSkippedOnlyWorkflows(cancelled), cancelled);
  assert.strictEqual(rc.fullSuiteVerdict(cancelled, 'main@abc').ok, false);
  const allSkipped = [row('Load', 'skipped', 1)];
  const v = rc.fullSuiteVerdict(allSkipped, 'main@abc');
  assert.strictEqual(v.ok, false);
  assert.match(v.detail, /every run was skipped/);
  assert.deepStrictEqual(rc.withoutSkippedOnlyWorkflows(allSkipped), []);
  assert.strictEqual(git.summarizeRunsForCommit([], S).status, 'none');
  // an unfinished run of the same workflow is not "skipped only"
  const inFlight = [row('CI', 'success', 1), row('Load', 'skipped', 2), { ...row('Load', null, 3), status: 'in_progress' }];
  assert.strictEqual(rc.withoutSkippedOnlyWorkflows(inFlight), inFlight);
  assert.strictEqual(rc.withoutSkippedOnlyWorkflows(null), null);
});

// ---- schema -----------------------------------------------------------------------------------

const LARAVEL_ADD = `<?php
return new class extends Migration {
  public function up(): void { Schema::table('users', function (Blueprint $t) { $t->string('nick')->nullable(); }); }
  public function down(): void { Schema::table('users', function (Blueprint $t) { $t->dropColumn('nick'); }); }
};`;
const LARAVEL_DROP = `<?php
return new class extends Migration {
  public function up(): void { Schema::table('users', function (Blueprint $t) { $t->dropColumn('legacy'); }); }
  public function down(): void {}
};`;

test('schema: an additive Laravel migration passes — a drop in down() is the ordinary additive shape', () => {
  const v = rc.schemaVerdict([{ status: 'A', path: 'database/migrations/2026_add_nick.php', content: LARAVEL_ADD }, { status: 'M', path: 'src/app.js' }], 'v1.2.0');
  assert.strictEqual(v.ok, true, v.detail);
});

test('schema: a drop in up(), an edited migration, destructive Prisma SQL — each refuses', () => {
  assert.match(rc.schemaVerdict([{ status: 'A', path: 'database/migrations/x.php', content: LARAVEL_DROP }], 'v1').detail, /dropColumn/);
  assert.match(rc.schemaVerdict([{ status: 'M', path: 'database/migrations/old.php' }], 'v1').detail, /edited/);
  const sql = '-- DropIndex\nALTER TABLE "User" DROP COLUMN "legacy";\n';
  assert.strictEqual(rc.schemaVerdict([{ status: 'A', path: 'prisma/migrations/20260901/migration.sql', content: sql }], 'v1').ok, false);
  const additive = '-- AlterTable\nALTER TABLE "User" ADD COLUMN "nick" TEXT;\n-- DropIndex is only a comment here\n';
  assert.strictEqual(rc.schemaVerdict([{ status: 'A', path: 'prisma/migrations/20260902/migration.sql', content: additive }], 'v1').ok, true);
});

// #545: an explicit Down/rollback section is read like Laravel's down() — its DROPs never count.
const D = ['modules/'];
const sqlMigrate = (up, down) => `-- +migrate Up\n${up}\n\n-- +migrate Down\n${down}\n`;
const CREATES = Array.from({ length: 6 }, (_, i) => `CREATE TABLE IF NOT EXISTS t${i} (\n  id BIGINT PRIMARY KEY\n);`).join('\n');
const DROPS = Array.from({ length: 6 }, (_, i) => `DROP TABLE IF EXISTS t${i};`).join('\n');

test('schema #545: sql-migrate file — DROP TABLE only in the Down section passes (the measured stall)', () => {
  const v = rc.schemaVerdict([{ status: 'A', path: 'modules/billing/sql/001_init.sql', content: sqlMigrate(CREATES, DROPS) }], 'v1', D);
  assert.strictEqual(v.ok, true, v.detail);
  assert.match(v.detail, /1 migration file\(s\) added since v1, none destructive/);
});

test('schema #545: goose and dbmate markers are read the same way, case-insensitively', () => {
  const goose = `-- +goose Up\nCREATE TABLE a (id INT);\n-- +goose Down\nDROP TABLE a;\n`;
  const dbmate = `-- migrate:up\nCREATE TABLE b (id INT);\n\n-- migrate:down\nDROP TABLE b;\n`;
  const upper = `-- +MIGRATE UP\nCREATE TABLE c (id INT);\n-- +MIGRATE DOWN\nDROP TABLE c;\n`;
  for (const content of [goose, dbmate, upper]) {
    const v = rc.schemaVerdict([{ status: 'A', path: 'modules/x/sql/1.sql', content }], 'v1', D);
    assert.strictEqual(v.ok, true, `${content}\n${v.detail}`);
  }
});

test('schema #545: a DROP in the Up section still refuses, and the detail names file, line and statement', () => {
  const content = sqlMigrate('CREATE TABLE a (id INT);\nDROP TABLE legacy;', 'DROP TABLE a;');
  const v = rc.schemaVerdict([{ status: 'A', path: 'modules/x/sql/2.sql', content }], 'v1', D);
  assert.strictEqual(v.ok, false);
  assert.match(v.detail, /modules\/x\/sql\/2\.sql:3: `DROP TABLE` in the Up section/);
});

test('schema #545: fails closed — no marker reads the whole file; text before any marker is read; a second Up re-opens', () => {
  const noMarker = 'CREATE TABLE a (id INT);\nDROP TABLE a;\n';
  assert.strictEqual(rc.schemaVerdict([{ status: 'A', path: 'modules/x/sql/3.sql', content: noMarker }], 'v1', D).ok, false);
  const beforeMarker = 'TRUNCATE users;\n-- +migrate Up\nCREATE TABLE a (id INT);\n-- +migrate Down\nDROP TABLE a;\n';
  const pre = rc.schemaVerdict([{ status: 'A', path: 'modules/x/sql/4.sql', content: beforeMarker }], 'v1', D);
  assert.strictEqual(pre.ok, false);
  assert.match(pre.detail, /4\.sql:1: `TRUNCATE`/);
  assert.doesNotMatch(pre.detail, /in the Up section/);
  const reopened = `${sqlMigrate('CREATE TABLE a (id INT);', 'DROP TABLE a;')}-- +migrate Up\nALTER TABLE b DROP COLUMN c;\n`;
  assert.strictEqual(rc.schemaVerdict([{ status: 'A', path: 'modules/x/sql/5.sql', content: reopened }], 'v1', D).ok, false);
});

test('schema #545: a statement split across lines still matches, at its first line', () => {
  const v = rc.schemaVerdict([{ status: 'A', path: 'prisma/migrations/1/migration.sql', content: 'SELECT 1;\nDROP\n  TABLE x;\n' }], 'v1');
  assert.strictEqual(v.ok, false);
  assert.match(v.detail, /migration\.sql:2: `DROP TABLE`/);
});

test('schema #545: an added golang-migrate .down.sql is a rollback file — exempt; editing one still refuses', () => {
  const added = rc.schemaVerdict([
    { status: 'A', path: 'modules/x/sql/000001_init.up.sql', content: 'CREATE TABLE a (id INT);' },
    { status: 'A', path: 'modules/x/sql/000001_init.down.sql', content: 'DROP TABLE a;' },
  ], 'v1', D);
  assert.strictEqual(added.ok, true, added.detail);
  const edited = rc.schemaVerdict([{ status: 'M', path: 'modules/x/sql/000001_init.down.sql' }], 'v1', D);
  assert.strictEqual(edited.ok, false);
  assert.match(edited.detail, /edited/);
  const upDrop = rc.schemaVerdict([{ status: 'A', path: 'modules/x/sql/000002_x.up.sql', content: 'DROP TABLE a;' }], 'v1', D);
  assert.strictEqual(upDrop.ok, false);
});

// ---- switches ---------------------------------------------------------------------------------

const issue = (number, state, body, stateReason = state === 'CLOSED' ? 'COMPLETED' : null) => ({ number, state, stateReason, body });

test('switches: a marker quoted in an inline code span or a fenced block is documentation, not a marker (#466)', () => {
  const prose = 'NOT a reader of the `<!-- colab:switch -->` GitHub-issue-marker family';
  assert.deepStrictEqual(rc.parseSwitchMarkers(prose), { markers: [], malformed: [] });
  assert.strictEqual(rc.switchVerdict([issue(7, 'CLOSED', prose)]).ok, true);
  const doubleTick = 'see ``<!-- colab:switch name=Bad_Name -->`` for the shape';
  assert.deepStrictEqual(rc.parseSwitchMarkers(doubleTick), { markers: [], malformed: [] });
  for (const fence of ['```', '~~~', '````']) {
    const body = `Example:\n${fence}md\n<!-- colab:switch -->\n<!-- colab:switch name=a colour=red -->\n${fence}\nafter`;
    assert.deepStrictEqual(rc.parseSwitchMarkers(body), { markers: [], malformed: [] }, fence);
  }
  // A real marker beside quoted documentation is still read …
  const mixed = 'The `<!-- colab:switch -->` family:\n\n<!-- colab:switch name=a needs=b -->\n```\n<!-- colab:switch -->\n```';
  assert.deepStrictEqual(rc.parseSwitchMarkers(mixed), { markers: [{ name: 'a', needs: ['b'], role: null }], malformed: [] });
  // … a real marker spanning lines still parses …
  assert.deepStrictEqual(rc.parseSwitchMarkers('<!-- colab:switch\n  name=a role=add -->').markers, [{ name: 'a', needs: [], role: 'add' }]);
  // … and a malformed real marker outside code is still refused.
  const bad = rc.parseSwitchMarkers('`<!-- colab:switch -->` aside, this one is real: <!-- colab:switch -->');
  assert.strictEqual(bad.malformed.length, 1);
  assert.match(bad.malformed[0], /no name=/);
  assert.strictEqual(rc.switchVerdict([issue(8, 'OPEN', '<!-- colab:switch -->')]).ok, false);
});

test('switches: none declared passes; malformed markers are "not cleared"', () => {
  assert.strictEqual(rc.switchVerdict([issue(1, 'OPEN', 'no markers')]).ok, true);
  assert.strictEqual(rc.switchVerdict(null).ok, false);
  for (const body of ['<!-- colab:switch name=Bad_Name -->', '<!-- colab:switch name=a role=maybe -->', '<!-- colab:switch name=a colour=red -->', '<!-- colab:switch name=a role=add needs=b -->']) {
    assert.strictEqual(rc.switchVerdict([issue(1, 'OPEN', body)]).ok, false, body);
  }
  assert.strictEqual(rc.switchVerdict([issue(1, 'OPEN', '<!-- colab:switch name=a role=add -->\n<!-- colab:switch name=a role=remove -->')]).ok, false);
});

test('switches: a finished switch whose dependency is still switched refuses; both finished passes', () => {
  const epics = [
    issue(10, 'OPEN', '<!-- colab:switch name=bulk-import -->'),
    issue(20, 'OPEN', '<!-- colab:switch name=bulk-export needs=bulk-import -->'),
    issue(11, 'CLOSED', '<!-- colab:switch name=bulk-import role=add -->'),
    issue(21, 'CLOSED', '<!-- colab:switch name=bulk-export role=add -->'),
    issue(22, 'CLOSED', '<!-- colab:switch name=bulk-export role=remove -->'),
  ];
  const open = [...epics, issue(12, 'OPEN', '<!-- colab:switch name=bulk-import role=remove -->')];
  const v = rc.switchVerdict(open);
  assert.strictEqual(v.ok, false);
  assert.match(v.detail, /"bulk-export" is finished .* needs "bulk-import", which is still switched/);
  const done = [...epics, issue(12, 'CLOSED', '<!-- colab:switch name=bulk-import role=remove -->')];
  assert.strictEqual(rc.switchVerdict(done).ok, true);
  // closed as not planned is not "closed by a merge"
  const notPlanned = [...epics, issue(12, 'CLOSED', '<!-- colab:switch name=bulk-import role=remove -->', 'NOT_PLANNED')];
  assert.strictEqual(rc.switchVerdict(notPlanned).ok, false);
});

test('switches: an unfinished dependent is fine (it ships dark); an undeclared dependency is not', () => {
  const dark = [
    issue(10, 'OPEN', '<!-- colab:switch name=a -->'),
    issue(20, 'OPEN', '<!-- colab:switch name=b needs=a -->'),
    issue(21, 'CLOSED', '<!-- colab:switch name=b role=add -->'),
  ];
  assert.strictEqual(rc.switchVerdict(dark).ok, true);
  assert.match(rc.switchVerdict([issue(20, 'OPEN', '<!-- colab:switch name=b needs=ghost -->')]).detail, /which no issue declares/);
});

// ---- --auto: the computed bump (#422) ---------------------------------------------------------

const CC = (counts, extra = {}) => ({ total: Object.values(counts).reduce((a, b) => a + b, 0), counts, breaking: false, ...extra });
const noExports = { removed: [], detail: 'no export removed' };
function autoFacts({ cc = CC({ fix: 1 }), guard = null, exports: ex = noExports, switchRemovals = [], migration, cadence, promotion = null, ...over } = {}) {
  return facts({
    suggestion: null,
    auto: {
      signals: rc.autoSignals({ cc, guard, exports: ex, switchRemovals }),
      migration: migration || ((v) => ({ ok: false, section: null, detail: `no MIGRATION.md for ${v}` })),
      cadence: cadence || { ok: true, detail: 'uncapped' },
      promotion,
    },
    ...over,
  });
}

test('--auto: fixes/chores -> patch; a chore alone still owes a patch', () => {
  assert.strictEqual(rc.decide(autoFacts({ cc: CC({ fix: 2 }) })).tag, 'v1.2.1-rc.1');
  assert.strictEqual(rc.decide(autoFacts({ cc: CC({ chore: 1 }) })).tag, 'v1.2.1-rc.1');
});

test('--auto: a feature, or a switch-removal child merged, -> minor', () => {
  assert.strictEqual(rc.decide(autoFacts({ cc: CC({ feat: 1, fix: 3 }) })).tag, 'v1.3.0-rc.1');
  const sw = rc.decide(autoFacts({ cc: CC({ chore: 1 }), switchRemovals: [{ number: 9, name: 'new-nav' }] }));
  assert.strictEqual(sw.tag, 'v1.3.0-rc.1');
  assert.match(sw.checks.find((c) => c.condition === 'version').detail, /switch-removal child merged: #9 \(new-nav\)/);
});

test('--auto: nothing merged is a no-op, not a refusal', () => {
  const v = rc.decide(autoFacts({ cc: CC({}) }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.noop, true);
});

test('--auto: each breaking signal — commit, guard, exports — makes a major from 1.0, a minor below', () => {
  const signals = {
    commit: { cc: CC({ fix: 1 }, { breaking: true }) },
    guard: { guard: rc.parseGuardOutput('schema-guard', '{"breaking": true, "findings": ["users.legacy dropped"]}') },
    exports: { exports: { removed: ['package.json exports ./old'], detail: 'removed export(s): package.json exports ./old' } },
  };
  for (const [name, sig] of Object.entries(signals)) {
    const pre = rc.decide(autoFacts({ ...sig, lastFinal: 'v0.4.2', tags: ['v0.4.2'] }));
    assert.strictEqual(pre.tag, 'v0.5.0-rc.1', `${name} pre-1.0`);
    const ok = rc.decide(autoFacts({ ...sig, migration: (v) => rc.parseMigrationSection(`## ${v}\n\nRename X.\n\nMeasured cost: 3 call sites in 2 adopters.\n`, v) }));
    assert.strictEqual(ok.tag, 'v2.0.0-rc.1', `${name} from 1.0`);
    assert.strictEqual(ok.bump, 'major');
  }
});

test('--auto: a major without a migration section carrying its measured cost is refused', () => {
  const brk = { cc: CC({ feat: 1 }, { breaking: true }) };
  const none = rc.decide(autoFacts(brk));
  assert.strictEqual(none.ok, false);
  assert.strictEqual(none.noop, false);
  assert.match(none.checks.find((c) => c.condition === 'version').detail, /is a major .* refused/);
  const noCost = rc.decide(autoFacts({ ...brk, migration: (v) => rc.parseMigrationSection(`## ${v}\n\nRename X.\n`, v) }));
  assert.match(noCost.checks.find((c) => c.condition === 'version').detail, /Measured cost/);
  const wrongVersion = rc.parseMigrationSection('## v3.0.0\n\nMeasured cost: 1\n', 'v2.0.0');
  assert.strictEqual(wrongVersion.ok, false);
  assert.strictEqual(rc.parseMigrationSection(null, 'v2.0.0').ok, false);
});

test('--auto: an unread guard or exports list fails closed', () => {
  const g = rc.decide(autoFacts({ guard: rc.parseGuardOutput('g', 'not json') }));
  assert.strictEqual(g.ok, false);
  assert.match(g.checks.find((c) => c.condition === 'version').detail, /could not be read — fail closed/);
  assert.match(rc.parseGuardOutput('g', '{"findings": []}').error, /boolean "breaking"/);
  const e = rc.decide(autoFacts({ exports: rc.exportsDiff({ before: { pkg: null, list: 'a\n' }, after: { pkg: null, list: null }, listFile: 'api.txt' }) }));
  assert.strictEqual(e.ok, false);
});

test('exportsDiff: removed subpaths, bin names and list lines are breaks; additions are not', () => {
  const before = { pkg: JSON.stringify({ name: 'p', exports: { '.': './i.js', './old': './o.js' }, bin: { tool: 'b.js' } }), list: 'foo\nbar\n# comment\n' };
  const after = { pkg: JSON.stringify({ name: 'p', exports: { '.': './i.js', './new': './n.js' }, bin: { tool: 'b.js' } }), list: 'foo\nbaz\n' };
  const d = rc.exportsDiff({ before, after, listFile: 'api.txt' });
  assert.deepStrictEqual(d.removed, ['package.json exports ./old', 'api.txt: bar']);
  const add = rc.exportsDiff({ before: { pkg: '{"bin":"x.js","name":"p"}', list: null }, after: { pkg: '{"bin":{"p":"x.js","q":"y.js"},"name":"p"}', list: null }, listFile: null });
  assert.deepStrictEqual(add.removed, []);
});

test('--auto: every signal and detector result is written into the tag message', () => {
  const v = rc.decide(autoFacts({ cc: CC({ feat: 1 }), guard: rc.parseGuardOutput('schema-guard', '{"breaking": false, "findings": ["2 tables read"]}') }));
  const msg = rc.tagMessage(v, { sha: 'abc', lastFinal: 'v1.2.0' });
  assert.match(msg, /Signals \(every input the bump read\):/);
  assert.match(msg, /- guard schema-guard: not breaking — 2 tables read/);
  assert.match(msg, /- exports: no export removed/);
  assert.match(msg, /- switches: no switch-removal child merged/);
  assert.match(msg, /- cadence: uncapped/);
});

test('#622 qualifiedShaVerdict: null at the head; newer tags, a final route and a cap each hold the older sha', () => {
  const sha = 'a'.repeat(40), head = 'b'.repeat(40);
  assert.strictEqual(rc.qualifiedShaVerdict({ sha: head, head, newer: [] }), null, 'the head is today\'s cut — no row');
  const ok = rc.qualifiedShaVerdict({ sha, head, newer: [] });
  assert.strictEqual(ok.ok, true);
  assert.match(ok.detail, /below main's head \(bbbbbbb\)/);
  const newer = rc.qualifiedShaVerdict({ sha, head, newer: ['v1.2.1-rc.3'] });
  assert.strictEqual(newer.ok, false);
  assert.match(newer.detail, /v1\.2\.1-rc\.3 already names a commit after aaaaaaa/);
  const unread = rc.qualifiedShaVerdict({ sha, head, newer: null });
  assert.strictEqual(unread.ok, false);
  assert.strictEqual(unread.unread, true, 'an unread tag list is never "none newer"');
  assert.match(rc.qualifiedShaVerdict({ sha, head, newer: [], finalRoute: true }).detail, /a final is tagged only on main's head/);
  assert.match(rc.qualifiedShaVerdict({ sha, head, newer: [], capped: true, auto: true }).detail, /candidates-per-day cap/);
  assert.strictEqual(rc.qualifiedShaVerdict({ sha, head, newer: [], capped: true, auto: false }).ok, true, 'a cap narrows --auto only');
});

test('#622 decide: qualified-sha is a row only when given; not ok is a no-op under --auto, a refusal by hand', () => {
  const okRow = { ok: true, detail: 'below head' };
  const v = rc.decide(facts({ qualified: okRow }));
  assert.strictEqual(v.ok, true, JSON.stringify(v.checks));
  assert.ok(v.checks.some((c) => c.condition === 'qualified-sha' && c.ok));
  assert.ok(!rc.decide(facts()).checks.some((c) => c.condition === 'qualified-sha'));

  const held = { ok: false, detail: 'v1.2.1-rc.3 already names a commit after aaaaaaa' };
  const auto = rc.decide(autoFacts({ qualified: held }));
  assert.strictEqual(auto.ok, false);
  assert.strictEqual(auto.noop, true);
  assert.deepStrictEqual(auto.standing, []);
  const hand = rc.decide(facts({ qualified: held }));
  assert.strictEqual(hand.ok, false);
  assert.strictEqual(hand.noop, false);
  assert.ok(!hand.standing.includes('qualified-sha'), 'not a standing refusal — the next run reads again');

  const unread = rc.decide(autoFacts({ qualified: { ok: false, unread: true, detail: 'unread' } }));
  assert.strictEqual(unread.noop, false, 'an unread read is a refusal, never a quiet no-op');
});

test('--auto cadence: at most N candidates per rolling day — inside the window is a no-op', () => {
  const now = '2026-10-02T12:00:00.000Z';
  const cad = rc.cadenceVerdict({ candidates: [{ name: 'v1.2.1-rc.1', date: '2026-10-02T01:00:00.000Z' }], perDay: 1, now });
  assert.strictEqual(cad.ok, false);
  assert.strictEqual(cad.nextAt, '2026-10-03T01:00:00.000Z');
  const v = rc.decide(autoFacts({ cadence: cad }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.noop, true);
  assert.strictEqual(v.tag, null);
  assert.strictEqual(rc.cadenceVerdict({ candidates: [{ name: 'x', date: '2026-10-01T11:00:00.000Z' }], perDay: 1, now }).ok, true);
  assert.strictEqual(rc.cadenceVerdict({ candidates: [], perDay: null, now }).ok, true);
});

test('switchRemovalsSince: only role=remove children closed done after the last final', () => {
  const issues = [
    { number: 1, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-09-10T00:00:00Z', body: '<!-- colab:switch name=nav role=remove -->' },
    { number: 2, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-08-01T00:00:00Z', body: '<!-- colab:switch name=old role=remove -->' },
    { number: 3, state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-09-10T00:00:00Z', body: '<!-- colab:switch name=x role=remove -->' },
    { number: 4, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-09-10T00:00:00Z', body: '<!-- colab:switch name=y role=add -->' },
  ];
  assert.deepStrictEqual(rc.switchRemovalsSince(issues, '2026-09-01T00:00:00Z'), [{ number: 1, name: 'nav' }]);
});

test('switchRemovalsSince { only } (#429): carried removals count whatever their close date; uncarried ones never', () => {
  const issues = [
    { number: 1, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-08-01T00:00:00Z', body: '<!-- colab:switch name=nav role=remove -->' },
    { number: 2, state: 'CLOSED', stateReason: 'COMPLETED', closedAt: '2026-09-10T00:00:00Z', body: '<!-- colab:switch name=old role=remove -->' },
  ];
  assert.deepStrictEqual(rc.switchRemovalsSince(issues, '2026-09-01T00:00:00Z', { only: new Set([1]) }), [{ number: 1, name: 'nav' }]);
  assert.deepStrictEqual(rc.switchRemovalsSince(issues, '2026-09-01T00:00:00Z', { only: new Set() }), []);
});

// ---- promotion (#429) -------------------------------------------------------------------------

const SHA = 'a'.repeat(40); const P1 = 'b'.repeat(40); const P2 = 'c'.repeat(40);

test('promotionVerdict: a --no-ff merge whose later parent is on trunk is a promotion', () => {
  const v = rc.promotionVerdict({ trunk: 'dev', sha: SHA, parents: [P1, P2], headOnTrunk: false, mergedFromTrunk: P2 });
  assert.strictEqual(v.ok, true);
  assert.match(v.detail, /main@aaaaaaa promotes dev@ccccccc/);
});

test('promotionVerdict: a fast-forward head on trunk is a promotion', () => {
  assert.strictEqual(rc.promotionVerdict({ trunk: 'dev', sha: SHA, parents: [P1], headOnTrunk: true }).ok, true);
});

test('promotionVerdict: a direct commit, or a merge of a branch not on trunk, is not — and is not unread', () => {
  for (const parents of [[P1], [P1, P2]]) {
    const v = rc.promotionVerdict({ trunk: 'dev', sha: SHA, parents, headOnTrunk: false, mergedFromTrunk: false });
    assert.strictEqual(v.ok, false);
    assert.ok(!v.unread);
    assert.match(v.detail, /not a promotion of dev/);
    assert.match(v.detail, /colab release cut/);
  }
  assert.match(rc.promotionVerdict({ trunk: 'dev', sha: SHA, parents: [P1] }).detail, /a direct commit/);
  assert.match(rc.promotionVerdict({ trunk: 'dev', sha: SHA, parents: [P1, P2] }).detail, /a merge of a branch not on dev/);
});

test('promotionVerdict: an unreadable trunk is unread', () => {
  const v = rc.promotionVerdict({ trunk: 'dev', sha: SHA, error: 'no origin/dev' });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.unread, true);
});

test('decide --auto (#429): a non-promotion head is a no-op, not a refusal', () => {
  const v = rc.decide(autoFacts({ promotion: { ok: false, detail: 'main@x is not a promotion of dev (a direct commit)' } }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.noop, true);
  assert.strictEqual(v.tag, null);
  assert.strictEqual(v.checks.find((c) => c.condition === 'promotion').ok, false);
});

test('decide --auto (#429): an unread promotion refuses', () => {
  const v = rc.decide(autoFacts({ promotion: { ok: false, unread: true, detail: 'origin/dev could not be read' } }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.noop, false);
});

test('decide --auto (#429): a promotion head cuts; no promotion fact (trunk: main) adds no promotion check', () => {
  const v = rc.decide(autoFacts({ promotion: { ok: true, detail: 'main@x promotes dev@y' } }));
  assert.strictEqual(v.tag, 'v1.2.1-rc.1', JSON.stringify(v.refusals));
  assert.ok(v.checks.some((c) => c.condition === 'promotion' && c.ok));
  assert.ok(rc.decide(autoFacts()).checks.every((c) => c.condition !== 'promotion'));
});

test('RELEASE_BRANCH is main: the on-trunk check reads the release branch, never project.yml trunk', () => {
  assert.strictEqual(rc.RELEASE_BRANCH, 'main');
  const v = rc.decide(facts({ ancestry: { ok: false, shallow: false, detail: 'x is not an ancestor of origin/main' } }));
  assert.match(v.checks.find((c) => c.condition === 'on-trunk').detail, /main/);
});

// ---- pre-tag checks (#424) ---------------------------------------------------------------------

// #484: public-tool defaults to version-source: tag, so a refusing manifest needs `manifest` declared.
const PINNED = releasePolicy.evaluateRelease({ ...RELEASED, release: { 'version-source': 'manifest' } });

test('decide: each pre-tag check refuses under its own name', () => {
  const man = rc.decide(facts({ policy: PINNED, manifests: [{ file: 'package.json', version: '1.2.0' }] }));
  assert.deepStrictEqual(man.refusals.map((c) => c.condition), ['manifest-version']);
  const shallow = rc.decide(facts({ ancestry: { ok: false, shallow: true } }));
  assert.deepStrictEqual(shallow.refusals.map((c) => c.condition), ['on-trunk']);
  const back = rc.decide(facts({ tags: ['v1.2.0', 'v1.5.0'] }));
  assert.deepStrictEqual(back.refusals.map((c) => c.condition), ['outranks-final']);
  const unmeasured = rc.decide(facts({ manifests: undefined, ancestry: undefined }));
  assert.deepStrictEqual(unmeasured.refusals.map((c) => c.condition), ['manifest-version', 'on-trunk']);
});

// ---- #443: the newest candidate always names trunk's head --------------------------------------

test('#443 --auto: head already carrying a candidate is a no-op, not a refusal (the schedule re-runs safely)', () => {
  const v = rc.decide(autoFacts({ tags: ['v1.2.0', 'v1.2.1-rc.1'], tagsAtSha: ['v1.2.1-rc.1'] }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.noop, true);
  assert.strictEqual(v.tag, null);
  // without --auto it is still a refusal — a human asking for a second candidate on one commit
  assert.strictEqual(rc.decide(facts({ tags: ['v1.2.0', 'v1.2.1-rc.1'], tagsAtSha: ['v1.2.1-rc.1'] })).noop, false);
});

test('#443 burst: with no cap every green head is cut — four merges, four candidates', () => {
  const tags = ['v1.2.0'];
  const cut = [];
  for (let i = 0; i < 4; i++) {
    const cad = rc.cadenceVerdict({ candidates: cut, perDay: null, now: `2026-10-02T12:0${i}:00.000Z` });
    const v = rc.decide(autoFacts({ tags: [...tags], tagsAtSha: [], cadence: cad }));
    assert.strictEqual(v.ok, true, `merge ${i}`);
    tags.push(v.tag);
    cut.push({ name: v.tag, date: `2026-10-02T12:0${i}:00.000Z` });
  }
  assert.deepStrictEqual(tags.slice(1), ['v1.2.1-rc.1', 'v1.2.1-rc.2', 'v1.2.1-rc.3', 'v1.2.1-rc.4']);
});

test('#443 declared cap: blocked inside the window, the first run after it cuts the head', () => {
  const cut = [{ name: 'v1.2.1-rc.1', date: '2026-10-02T01:00:00.000Z' }];
  const inside = rc.cadenceVerdict({ candidates: cut, perDay: 1, now: '2026-10-02T13:00:00.000Z' });
  assert.strictEqual(inside.ok, false);
  assert.match(inside.detail, /first run from 2026-10-03T01:00:00\.000Z cuts main's head, never an older commit/);
  assert.strictEqual(rc.decide(autoFacts({ tags: ['v1.2.0', 'v1.2.1-rc.1'], cadence: inside })).noop, true);
  // the scheduled run after the window: head (which carries no tag yet) is cut
  const after = rc.cadenceVerdict({ candidates: cut, perDay: 1, now: '2026-10-03T03:17:00.000Z' });
  const v = rc.decide(autoFacts({ tags: ['v1.2.0', 'v1.2.1-rc.1'], tagsAtSha: [], cadence: after }));
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.tag, 'v1.2.1-rc.2');
});

test('#443 headCandidateVerdict: flags a head green for longer than one CI cycle with no tag', () => {
  const run = (o) => ({ status: 'completed', conclusion: 'success', event: 'push', createdAt: '2026-10-02T12:00:00Z', updatedAt: '2026-10-02T12:05:00Z', ...o });
  const base = { candidatesAuto: true, sha: 'abcdef1234', tagsAtSha: [], owed: 3, runs: [run()], promotion: null };
  const at = (now, over = {}) => rc.headCandidateVerdict({ ...base, now, ...over });
  assert.strictEqual(at('2026-10-02T12:08:00Z').state, 'pending'); // 3m after green, cycle 5m
  const late = at('2026-10-02T12:11:00Z');
  assert.strictEqual(late.state, 'untagged');
  assert.strictEqual(late.flag, true);
  assert.match(late.detail, /head not a candidate/);
  assert.strictEqual(late.cycleMs, 300000);
  assert.strictEqual(at('2026-10-02T13:00:00Z', { tagsAtSha: ['v1.2.1-rc.3'] }).state, 'named');
  assert.strictEqual(at('2026-10-02T13:00:00Z', { tagsAtSha: ['v1.3.0'] }).state, 'named');
  assert.strictEqual(at('2026-10-02T13:00:00Z', { owed: 0 }).state, 'nothing-owed');
  // #467: no final at all is a stall, not "nothing owed" — every --auto cut refuses until a human tags one.
  const noFinal = at('2026-10-02T13:00:00Z', { owed: null });
  assert.strictEqual(noFinal.state, 'no-final');
  assert.strictEqual(noFinal.flag, true);
  assert.match(noFinal.detail, /no final tag yet/);
  assert.strictEqual(at('2026-10-02T13:00:00Z', { owed: 0 }).flag, false);
  assert.strictEqual(at('2026-10-02T13:00:00Z', { candidatesAuto: false }).state, 'off');
  assert.strictEqual(at('2026-10-02T13:00:00Z', { runs: null }).state, 'unread');
  assert.strictEqual(at('2026-10-02T13:00:00Z', { runs: [run({ conclusion: 'failure' })] }).state, 'not-green');
  assert.strictEqual(at('2026-10-02T13:00:00Z', { runs: [run({ status: 'in_progress', conclusion: null })] }).state, 'not-green');
  assert.strictEqual(at('2026-10-02T13:00:00Z', { promotion: { ok: false, detail: 'a hotfix' } }).state, 'not-promotion');
  // the release workflow's own run (workflow_run) is downstream of the suite — a failed one does not hide the flag
  const withRelease = at('2026-10-02T13:00:00Z', { runs: [run(), run({ event: 'workflow_run', conclusion: 'failure' })] });
  assert.strictEqual(withRelease.state, 'untagged');
});

test('#618 headCandidateVerdict: an all-skipped workflow did not run — it no longer hides an untagged green head', () => {
  const run = (o) => ({ status: 'completed', conclusion: 'success', event: 'push', workflowName: 'CI', createdAt: '2026-10-02T12:00:00Z', updatedAt: '2026-10-02T12:05:00Z', ...o });
  const skipped = (o) => run({ conclusion: 'skipped', workflowName: 'Load', ...o }); // a push-triggered opt-in gated off by `if:` (schedule rows are already downstream)
  const at = (runs) => rc.headCandidateVerdict({ candidatesAuto: true, sha: 'abcdef1234', tagsAtSha: [], owed: 3, runs, promotion: null, now: '2026-10-02T13:00:00Z' });
  const green = at([run(), skipped()]);
  assert.strictEqual(green.state, 'untagged');
  assert.strictEqual(green.flag, true);
  assert.strictEqual(green.cycleMs, 300000);
  // skipped beside a failure of the same workflow is still red
  const red = at([run(), skipped({ workflowName: 'CI' }), run({ conclusion: 'failure' })]);
  assert.strictEqual(red.state, 'not-green');
  assert.match(red.detail, /red head/);
  // a head whose only runs were skipped never went green
  const none = at([skipped(), skipped({ workflowName: 'Nightly' })]);
  assert.strictEqual(none.state, 'not-green');
  assert.strictEqual(none.flag, false);
  assert.match(none.detail, /no successful suite run/);
});

test('#443 prereleaseArgs: a published pre-release that never becomes Latest', () => {
  assert.deepStrictEqual(rc.prereleaseArgs('v1.2.1-rc.1', '/tmp/n.md'),
    ['release', 'create', 'v1.2.1-rc.1', '--verify-tag', '--title', 'v1.2.1-rc.1', '--notes-file', '/tmp/n.md', '--prerelease', '--latest=false']);
});

// ---- #446: deploy-tag-fast — a final on every green head ----------------------------------------

const FAST_DESC = { trunk: 'main', exposure: 'released', production: 'https://app.example', deploy: 'tag',
  release: { route: 'deploy-tag-fast', 'final-grant': 7, 'health-url': 'https://app.example/health', rollback: 'auto' } };
const NOW = '2026-10-03T12:00:00Z';
function fastFacts({ spacing, finalGrant, holds, migrations, ...over } = {}) {
  const f = autoFacts({
    policy: releasePolicy.evaluateRelease(FAST_DESC),
    finalGrant: finalGrant === undefined ? { ok: true, ruledBy: 'Op', detail: 'decision recorded' } : finalGrant,
    holds: holds === undefined ? rc.holdsVerdict([]) : holds,
    migrations: migrations === undefined ? { ok: true, paths: [], detail: 'no migration' } : migrations,
    ...over,
  });
  f.auto.spacing = spacing === undefined ? { ok: true, detail: 'spaced' } : spacing;
  return f;
}

test('#446 a green fast head tags the final directly — no -rc, final: true, grant and health gate on the verdict', () => {
  const v = rc.decide(fastFacts());
  assert.strictEqual(v.ok, true, JSON.stringify(v.refusals));
  assert.strictEqual(v.tag, 'v1.2.1');
  assert.strictEqual(v.final, true);
  assert.deepStrictEqual(v.grant, { issue: 7, ruledBy: 'Op' });
  assert.deepStrictEqual(v.healthGate, { url: 'https://app.example/health', rollback: 'auto' });
  for (const c of ['spacing', 'already-final', 'final-grant', 'release-hold', 'migration-grant']) assert.ok(refusal(v, c), c);
  assert.strictEqual(refusal(v, 'already-candidate'), undefined);
  const msg = rc.tagMessage(v, { sha: 'abc123', lastFinal: 'v1.2.0' });
  assert.match(msg, /^v1\.2\.1 — release \(colab release cut, deploy-tag-fast\)/);
  assert.doesNotMatch(msg.split('\n')[0], /\(colab release cut\)$/);
  assert.match(msg, /decision #7, ruled by Op/);
  assert.match(msg, /Health gate: https:\/\/app\.example\/health \(rollback: auto\)/);
  assert.doesNotMatch(msg, /A candidate, never a final/);
});

test('#446 the fast route refuses a hand cut: finals come only from the workflow, where the deploy runs', () => {
  const v = rc.decide(facts({ policy: releasePolicy.evaluateRelease(FAST_DESC), finalGrant: { ok: true, detail: 'x' }, holds: rc.holdsVerdict([]), migrations: { ok: true, paths: [], detail: 'x' } }));
  assert.strictEqual(v.ok, false);
  assert.match(refusal(v, 'release-policy').detail, /only from the release workflow/);
});

test('#446 an unresolved grant, a release-hold, an unread issue list each refuse', () => {
  const g = rc.decide(fastFacts({ finalGrant: { ok: false, detail: 'its decision was reopened' } }));
  assert.strictEqual(g.ok, false);
  assert.strictEqual(refusal(g, 'final-grant').ok, false);
  assert.strictEqual(g.noop, false);
  const held = rc.decide(fastFacts({ holds: rc.holdsVerdict([{ number: 12, state: 'OPEN', labels: [{ name: 'release-hold' }] }]) }));
  assert.strictEqual(held.ok, false);
  assert.match(refusal(held, 'release-hold').detail, /release-hold on #12/);
  assert.strictEqual(rc.decide(fastFacts({ holds: rc.holdsVerdict(null) })).ok, false);
  assert.strictEqual(rc.decide(fastFacts({ finalGrant: null })).ok, false);
});

test('#446 an ungranted migration refuses with a hand-off; a granted one passes', () => {
  const v = rc.decide(fastFacts({ migrations: { ok: false, paths: ['db/1.sql'], detail: '1 migration file' }, trackingIssue: 40 }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(refusal(v, 'migration-grant').ok, false);
  assert.strictEqual(v.handoff, 'COLAB_HUMAN=1 colab migration-grant 40 --branch v1.2.1');
  assert.strictEqual(rc.decide(fastFacts({ migrations: { ok: true, paths: ['db/1.sql'], detail: 'granted' } })).ok, true);
});

test('#671 the fast route refuses a final where no migration layout could be seen — no grant hand-off, nothing to grant', () => {
  const rf = require('./release-finalize');
  const blind = { ...rf.migrationGrantVerdict({ paths: [], grant: null, since: 'v1.2.0', layout: false }), paths: [] };
  const v = rc.decide(fastFacts({ migrations: blind, trackingIssue: 40 }));
  assert.strictEqual(v.ok, false);
  assert.match(refusal(v, 'migration-grant').detail, /`migrations:`/);
  assert.strictEqual(v.handoff, null, 'an empty list has nothing to grant');
  const unread = { ...rf.migrationGrantVerdict({ paths: [], grant: null, since: 'v1.2.0', layout: null }), paths: [] };
  assert.strictEqual(rc.decide(fastFacts({ migrations: unread })).ok, false);
  const seen = { ...rf.migrationGrantVerdict({ paths: [], grant: null, since: 'v1.2.0', layout: true }), paths: [] };
  assert.strictEqual(rc.decide(fastFacts({ migrations: seen })).ok, true);
});

test('#446 spacing and an already-final head are no-ops, not refusals', () => {
  const sp = rc.decide(fastFacts({ spacing: rc.spacingVerdict({ finals: [{ name: 'v1.2.0', date: '2026-10-03T11:30:00Z' }], spacingHours: 1, now: NOW }) }));
  assert.strictEqual(sp.ok, false);
  assert.strictEqual(sp.noop, true);
  assert.match(refusal(sp, 'spacing').detail, /2026-10-03T12:30:00\.000Z/);
  const done = rc.decide(fastFacts({ tagsAtSha: ['v1.2.0'] }));
  assert.strictEqual(done.ok, false);
  assert.strictEqual(done.noop, true);
  assert.strictEqual(refusal(done, 'already-final').ok, false);
});

test('#446 the candidate gates still apply: red CI and a destructive migration refuse', () => {
  assert.strictEqual(refusal(rc.decide(fastFacts({ ci: { ok: false, detail: 'red' } })), 'ci-green').ok, false);
  assert.strictEqual(refusal(rc.decide(fastFacts({ schema: { ok: false, detail: 'DROP TABLE' } })), 'schema-additive').ok, false);
});

test('#446 spacingVerdict and holdsVerdict', () => {
  assert.strictEqual(rc.spacingVerdict({ finals: [], spacingHours: 1, now: NOW }).ok, true);
  assert.strictEqual(rc.spacingVerdict({ finals: [{ name: 'v1.0.0', date: '2026-10-03T09:00:00Z' }], spacingHours: 1, now: NOW }).ok, true);
  const in6 = rc.spacingVerdict({ finals: [{ name: 'v1.0.0', date: '2026-10-03T09:00:00Z' }, { name: 'v0.9.0', date: '2026-10-01T00:00:00Z' }], spacingHours: 6, now: NOW });
  assert.strictEqual(in6.ok, false);
  assert.strictEqual(in6.nextAt, '2026-10-03T15:00:00.000Z');
  assert.strictEqual(rc.holdsVerdict([{ number: 3, labels: ['bug'] }]).ok, true);
  assert.strictEqual(rc.holdsVerdict([{ number: 3, state: 'CLOSED', labels: ['release-hold'] }]).ok, true);
  assert.strictEqual(rc.holdsVerdict([{ number: 3, labels: ['release-hold'] }]).ok, false);
});

test('#446 a candidate route is unchanged: no fast condition reported, final: false', () => {
  const v = rc.decide(autoFacts());
  assert.strictEqual(v.final, false);
  for (const c of rc.FAST_CONDITIONS) assert.strictEqual(refusal(v, c), undefined, c);
});

// ---- #467: a standing refusal is told apart from a transient one --------------------------------

test('#467 standing: no final tag under --auto is a standing refusal, never a no-op', () => {
  const v = rc.decide(autoFacts({ lastFinal: null, tags: [] }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.noop, false);
  assert.deepStrictEqual(v.standing, ['version']);
});

test('#467 standing: an unread bump signal fails version, but transiently', () => {
  const v = rc.decide(autoFacts({ guard: { error: 'guard exited 2' } }));
  assert.strictEqual(refusal(v, 'version').ok, false);
  assert.deepStrictEqual(v.standing, []);
});

test('#467 standing: red or unfinished CI is transient; a malformed switch marker is standing, an unread issue list is not', () => {
  assert.deepStrictEqual(rc.decide(autoFacts({ ci: { ok: false, detail: 'in flight' }, suite: { ok: false, detail: 'red' } })).standing, []);
  const malformed = rc.switchVerdict([{ number: 7, state: 'OPEN', body: '<!-- colab:switch name=Bad! -->' }]);
  assert.strictEqual(malformed.ok, false);
  assert.deepStrictEqual(rc.decide(autoFacts({ switches: malformed })).standing, ['switch-dependencies']);
  const unread = rc.switchVerdict(null);
  assert.strictEqual(unread.unread, true);
  assert.deepStrictEqual(rc.decide(autoFacts({ switches: unread })).standing, []);
  assert.deepStrictEqual(rc.decide(autoFacts({ switches: undefined })).standing, [], 'not measured is a read, not a fact');
});

test('#467 standing: a no-op and an ok cut carry none', () => {
  const nothing = rc.decide(autoFacts({ cc: CC({}) }));
  assert.strictEqual(nothing.noop, true);
  assert.deepStrictEqual(nothing.standing, []);
  const already = rc.decide(autoFacts({ tags: ['v1.2.0', 'v1.2.1-rc.1'], tagsAtSha: ['v1.2.1-rc.1'] }));
  assert.strictEqual(already.noop, true);
  assert.deepStrictEqual(already.standing, []);
  const ok = rc.decide(autoFacts());
  assert.strictEqual(ok.ok, true);
  assert.deepStrictEqual(ok.standing, []);
});

test('#467 standing: a wrong manifest is standing, an unread one is not', () => {
  const wrong = rc.decide(autoFacts({ policy: PINNED, manifests: [{ file: 'package.json', version: '9.9.9' }] }));
  assert.deepStrictEqual(wrong.standing, ['manifest-version']);
  assert.deepStrictEqual(rc.decide(autoFacts({ policy: PINNED, manifests: null })).standing, []);
});

test('#484 default: on an automatic route a lagging manifest is derivable, not a standing refusal', () => {
  const v = rc.decide(autoFacts({ manifests: [{ file: 'package.json', version: '1.2.0' }] }));
  assert.strictEqual(v.ok, true, JSON.stringify(v.refusals));
  assert.strictEqual(v.tag, 'v1.2.1-rc.1');
  assert.deepStrictEqual(v.derivable, ['package.json']);
  assert.deepStrictEqual(v.standing, []);
  assert.strictEqual(v.versionSourceDeclared, false);
  const msg = rc.tagMessage(v, { sha: 'abc', lastFinal: 'v1.2.0' });
  assert.match(msg, /Derivable manifests \(release\.version-source: tag — the default on a route that tags automatically, #484; not checked against the tag\): package\.json/);
  // an unreadable manifest still refuses under the default — derivable is not "broken is fine"
  assert.deepStrictEqual(rc.decide(autoFacts({ manifests: [{ file: 'package.json', error: 'package.json does not parse (x)' }] })).standing, ['manifest-version']);
});

test('#467 every standing condition is one decide() can report', () => {
  for (const c of rc.STANDING_CONDITIONS) assert.ok(rc.CONDITIONS.includes(c), c);
  for (const c of ['ci-green', 'full-suite', 'release-hold', 'cadence', 'spacing', 'promotion', 'already-candidate', 'already-final']) {
    assert.ok(!rc.STANDING_CONDITIONS.includes(c), `${c} must be transient or a no-op`);
  }
});

// ---- #590: library-fast — the cut is the final, nothing deploys --------------------------------

const LIB_DESC = { trunk: 'main', exposure: 'released', production: null, deploy: 'none', release: { route: 'library-fast' } };
const pkg = (version) => [{ file: 'package.json', version }];
function libFacts({ manifest = '1.2.1', holds, ...over } = {}) {
  return autoFacts({
    policy: releasePolicy.evaluateRelease(LIB_DESC),
    manifests: manifest === null ? null : pkg(manifest),
    holds: holds === undefined ? rc.holdsVerdict([]) : holds,
    ...over,
  });
}

test('#590 isLibraryRoute: library-fast as declared only — not a final: human narrowing, not the fast route, not public-tool', () => {
  assert.strictEqual(rc.isLibraryRoute(releasePolicy.evaluateRelease(LIB_DESC)), true);
  assert.strictEqual(rc.isLibraryRoute(releasePolicy.evaluateRelease({ ...LIB_DESC, release: { route: 'library-fast', final: 'human' } })), false);
  assert.strictEqual(rc.isLibraryRoute(releasePolicy.evaluateRelease(RELEASED)), false);
  assert.strictEqual(rc.isLibraryRoute(releasePolicy.evaluateRelease(FAST_DESC)), false);
});

test('#590 a green library head with the manifest bumped tags the final directly — no -rc, final: true, nothing deployed', () => {
  const v = rc.decide(libFacts());
  assert.strictEqual(v.ok, true, JSON.stringify(v.refusals));
  assert.strictEqual(v.tag, 'v1.2.1');
  assert.strictEqual(v.final, true);
  assert.strictEqual(v.route, 'library-fast');
  assert.strictEqual(v.healthGate, null);
  assert.strictEqual(v.grant, null);
  assert.match(refusal(v, 'release-policy').detail, /route library-fast/);
  assert.match(refusal(v, 'version').detail, /from the manifest: package\.json says 1\.2\.1/);
  for (const c of ['already-final', 'release-hold']) assert.ok(refusal(v, c), c);
  for (const c of ['already-candidate', 'spacing', 'final-grant', 'migration-grant']) assert.strictEqual(refusal(v, c), undefined, c);
  const msg = rc.tagMessage(v, { sha: 'abc123', lastFinal: 'v1.2.0' });
  assert.match(msg, /^v1\.2\.1 — release \(colab release cut, library-fast\)/);
  assert.doesNotMatch(msg.split('\n')[0], /\(colab release cut\)$/);
  assert.match(msg, /nothing deploys from this tag/);
  assert.doesNotMatch(msg, /Health gate|final-grant ->/);
});

test('#590 the manifest decides the version, not the commit types: a fix with the manifest at a minor cuts the minor', () => {
  const v = rc.decide(libFacts({ manifest: '1.3.0' }));
  assert.strictEqual(v.tag, 'v1.3.0');
  assert.strictEqual(v.bump, 'minor');
});

test('#590 a hand cut works too (no --auto): same final, from the manifest; --bump has nothing to override', () => {
  const hand = facts({ policy: releasePolicy.evaluateRelease(LIB_DESC), manifests: pkg('1.2.1'), holds: rc.holdsVerdict([]) });
  const v = rc.decide(hand);
  assert.strictEqual(v.ok, true, JSON.stringify(v.refusals));
  assert.strictEqual(v.tag, 'v1.2.1');
  const o = rc.decide({ ...hand, override: { bump: 'minor', reason: 'x' } });
  assert.strictEqual(o.ok, false);
  assert.match(refusal(o, 'version').detail, /nothing to override/);
});

test('#590 manifest still at the last final is a no-op under --auto, never a stall', () => {
  const v = rc.decide(libFacts({ manifest: '1.2.0' }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.noop, true);
  assert.deepStrictEqual(v.standing, []);
  assert.match(refusal(v, 'version').detail, /still says 1\.2\.0.*nothing to release until a merge bumps it/);
});

test('#590 the first final is a human act: release-policy passes, version refuses as a stall', () => {
  const v = rc.decide(libFacts({ lastFinal: null, tags: [] }));
  assert.strictEqual(v.ok, false);
  assert.strictEqual(refusal(v, 'release-policy').ok, true);
  assert.match(refusal(v, 'version').detail, /first version is a human decision/);
  assert.deepStrictEqual(v.standing, ['version']);
});

test('#590 manifest refusals: backwards, disagreeing, pre-release, 0.x -> 1.0, an unread manifest list', () => {
  assert.match(refusal(rc.decide(libFacts({ manifest: '1.1.9' })), 'version').detail, /moved backwards/);
  assert.match(refusal(rc.decide(libFacts({ manifests: [{ file: 'package.json', version: '1.2.1' }, { file: 'VERSION', version: '1.2.2' }] })), 'version').detail, /disagree/);
  assert.match(refusal(rc.decide(libFacts({ manifest: '1.2.1-beta.1' })), 'version').detail, /never a pre-release/);
  assert.match(refusal(rc.decide(libFacts({ manifest: '1.0.0', lastFinal: 'v0.4.0', tags: ['v0.4.0'] })), 'version').detail, /0\.x to v1\.0\.0 is a human decision/);
  const unread = rc.decide(libFacts({ manifest: null }));
  assert.strictEqual(unread.ok, false);
  assert.ok(!unread.standing.includes('version'), 'an unread manifest is transient');
});

test('#590 a break the manifest under-declares refuses; a declared major needs MIGRATION.md', () => {
  const brk = CC({ fix: 1 }, { breaking: true });
  assert.match(refusal(rc.decide(libFacts({ cc: brk, manifest: '1.3.0' })), 'version').detail, /a break needs a major/);
  assert.match(refusal(rc.decide(libFacts({ cc: brk, manifest: '0.4.1', lastFinal: 'v0.4.0', tags: ['v0.4.0'] })), 'version').detail, /a break needs a minor/);
  assert.strictEqual(rc.decide(libFacts({ cc: brk, manifest: '0.5.0', lastFinal: 'v0.4.0', tags: ['v0.4.0'] })).tag, 'v0.5.0');
  assert.match(refusal(rc.decide(libFacts({ cc: brk, manifest: '2.0.0' })), 'version').detail, /no MIGRATION\.md for v2\.0\.0/);
  const ok = rc.decide(libFacts({ cc: brk, manifest: '2.0.0', migration: () => ({ ok: true, section: '## v2.0.0\nMeasured cost: 1 line', detail: 'ok' }) }));
  assert.strictEqual(ok.tag, 'v2.0.0');
});

test('#590 no manifest states a version: the bump is computed, as on version-source: tag', () => {
  const v = rc.decide(libFacts({ manifests: [], cc: CC({ feat: 1 }) }));
  assert.strictEqual(v.tag, 'v1.3.0');
  const tagSrc = rc.decide(libFacts({ policy: releasePolicy.evaluateRelease({ ...LIB_DESC, release: { route: 'library-fast', 'version-source': 'tag' } }), manifest: '0.0.0', cc: CC({ fix: 1 }) }));
  assert.strictEqual(tagSrc.tag, 'v1.2.1');
});

test('#590 the route\'s checks still apply: red CI, a release-hold, a head already final', () => {
  assert.strictEqual(refusal(rc.decide(libFacts({ ci: { ok: false, detail: 'red' } })), 'ci-green').ok, false);
  const held = rc.decide(libFacts({ holds: rc.holdsVerdict([{ number: 12, state: 'OPEN', labels: [{ name: 'release-hold' }] }]) }));
  assert.strictEqual(refusal(held, 'release-hold').ok, false);
  // Re-run on a head already tagged: that tag is now the last final, so the manifest equals it.
  const again = rc.decide(libFacts({ lastFinal: 'v1.2.1', tagsAtSha: ['v1.2.1'], tags: ['v1.2.0', 'v1.2.1'], manifest: '1.2.1' }));
  assert.strictEqual(again.ok, false);
  assert.strictEqual(again.noop, true);
});

test('#590 release-policy names the route in effect: library-fast narrowed to a human final, and the derived row', () => {
  const human = rc.decide(facts({ policy: releasePolicy.evaluateRelease({ ...LIB_DESC, release: { route: 'library-fast', final: 'human' } }) }));
  assert.match(refusal(human, 'release-policy').detail, /route library-fast with release\.final: human — every final here is a human act/);
  assert.doesNotMatch(refusal(human, 'release-policy').detail, /adopters install it/);
  const self = rc.decide(facts({ policy: releasePolicy.evaluateRelease({ ...RELEASED, exposure: 'self' }) }));
  assert.match(refusal(self, 'release-policy').detail, /route none/);
});

test('#610 a final route needs the heavy lane green at the head: red refuses, pending no-ops under --auto, none-in-repo passes', () => {
  const ip = require('./integration-profile.js');
  const heavy = (state) => ip.releaseHeavyCondition({ present: true, file: 'ci-heavy.yml', verdict: { state, why: state }, at: 'main@abc1234', ref: 'main' });
  assert.strictEqual(rc.decide(libFacts({ heavy: heavy('green') })).ok, true);
  const red = rc.decide(libFacts({ heavy: heavy('red') }));
  assert.strictEqual(red.ok, false);
  assert.strictEqual(red.noop, false);
  assert.match(refusal(red, 'heavy-lane').detail, /heavy lane red at main@abc1234/);
  const pending = rc.decide(libFacts({ heavy: heavy('pending') }));
  assert.deepStrictEqual([pending.ok, pending.noop], [false, true]);
  assert.ok(!pending.standing.includes('heavy-lane'));
  const absent = ip.releaseHeavyCondition({ present: false, file: 'ci-heavy.yml', verdict: null, at: 'main@abc1234', ref: 'main' });
  assert.strictEqual(rc.decide(libFacts({ heavy: absent })).ok, true);
  assert.strictEqual(refusal(rc.decide(libFacts()), 'heavy-lane'), undefined, 'no heavy fact → no row');
});

// ---- #624: verifyingRunsForCut — the ship gate's rule for which runs may veto a cut ---------------

test('#624 verifyingRunsForCut: push runs count, a schedule run is set aside and named; null passes through', () => {
  const rows = [
    { workflowName: 'CI', event: 'push', status: 'completed', conclusion: 'success', databaseId: 1 },
    { workflowName: 'Nightly', event: 'schedule', status: 'in_progress', conclusion: null, databaseId: 2 },
    { workflowName: 'legacy', status: 'completed', conclusion: 'success', databaseId: 3 }, // no event: counted
  ];
  const read = rc.verifyingRunsForCut(rows, { gate: null, ignore: [] });
  assert.deepStrictEqual(read.rows.map((r) => r.workflowName), ['CI', 'legacy']);
  assert.deepStrictEqual(read.setAside.map((r) => [r.workflowName, r.setAsideWhy]), [['Nightly', 'event: schedule']]);
  assert.match(rc.verifyingNote(read), /set aside 1 run that does not verify the code .*Nightly \(in_progress, run 2; event: schedule\)/);
  assert.strictEqual(rc.verifyingNote(rc.verifyingRunsForCut(rows.slice(0, 1), null)), '');
  assert.strictEqual(rc.verifyingRunsForCut(null, null).rows, null);
  const gated = rc.verifyingRunsForCut(rows, { gate: ['CI', 'Nightly'], ignore: [] });
  assert.deepStrictEqual(gated.rows.map((r) => r.workflowName), ['CI', 'Nightly']);
});
