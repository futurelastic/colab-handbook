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
  assert.deepStrictEqual(v.checks.map((c) => c.condition), rc.CONDITIONS);
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

test('the tag message records the bump, the override reason and every condition', () => {
  const v = rc.decide(facts({ suggestion: { bump: null, why: 'docs only' }, override: { bump: 'patch', reason: 'adopters read the docs' } }));
  const msg = rc.tagMessage(v, { sha: 'abc123', lastFinal: 'v1.2.0' });
  assert.match(msg, /^v1\.2\.1-rc\.1 — release candidate/);
  assert.match(msg, /reason: adopters read the docs/);
  for (const c of rc.CONDITIONS) assert.match(msg, new RegExp(`- ${c}: `));
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

// ---- switches ---------------------------------------------------------------------------------

const issue = (number, state, body, stateReason = state === 'CLOSED' ? 'COMPLETED' : null) => ({ number, state, stateReason, body });

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
