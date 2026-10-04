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
  // `cadence` is reported only under --auto (#422); `promotion` only under --auto off trunk: main (#429).
  assert.deepStrictEqual(v.checks.map((c) => c.condition), rc.CONDITIONS.filter((c) => c !== 'cadence' && c !== 'promotion' && !rc.FAST_CONDITIONS.includes(c)));
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
  for (const c of rc.CONDITIONS.filter((x) => x !== 'cadence' && x !== 'promotion' && !rc.FAST_CONDITIONS.includes(x))) assert.match(msg, new RegExp(`- ${c}: `));
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

test('decide: each pre-tag check refuses under its own name', () => {
  const man = rc.decide(facts({ manifests: [{ file: 'package.json', version: '1.2.0' }] }));
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
  const wrong = rc.decide(autoFacts({ manifests: [{ file: 'package.json', version: '9.9.9' }] }));
  assert.deepStrictEqual(wrong.standing, ['manifest-version']);
  assert.deepStrictEqual(rc.decide(autoFacts({ manifests: null })).standing, []);
});

test('#467 every standing condition is one decide() can report', () => {
  for (const c of rc.STANDING_CONDITIONS) assert.ok(rc.CONDITIONS.includes(c), c);
  for (const c of ['ci-green', 'full-suite', 'release-hold', 'cadence', 'spacing', 'promotion', 'already-candidate', 'already-final']) {
    assert.ok(!rc.STANDING_CONDITIONS.includes(c), `${c} must be transient or a no-op`);
  }
});
