'use strict';
/**
 * Unit tests for tools/lib/adopt.js — both commits of #199 (detect/derive/report, PLUS
 * ask/gate/write). All scripted `io`, no real git/filesystem: `tools/lib/adopt-cli.test.js`
 * covers the real-repo path through `colab adopt` itself, and (#207) `exposureShapeVerdict`'s own
 * rule table now lives in `tools/lib/exposure-shape.js`, shared with `audit/audit.mjs` — see
 * `tools/lib/exposure-shape.test.js` for the matrix that used to be this file's separate
 * `adopt-audit-agreement.test.js`, run against the real audit.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  deriveTier, deriveConsequences, detectStack, detectChannelCandidates, remainingSteps, releaseRungSteps, detect,
  detectMigrationCandidates, detectUpstreamAgentFiles, renderClaudeShell,
  QUESTIONS, axisMissing, ROW_NAMES, EXPOSURE_RANK, GATE_CLASS, EXIT_CODE,
  exposureShapeVerdict, gateVerdict, writesGateVerdict, provenanceComment, renderDescriptor,
  renderMenu, resolveChoice,
} = require('./adopt.js');

/** A minimal scripted io — every field defaults to "nothing here", override per test. */
function io(overrides = {}) {
  const files = overrides.files || {};
  const dirs = overrides.dirs || {};
  return {
    readFile: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
    listDir: (p) => dirs[p] || [],
    tags: () => (overrides.tags !== undefined ? overrides.tags : []),
  };
}

// --------------------------------------------------------------- deriveTier — the three cases

test('deriveTier: production null/absent -> B', () => {
  assert.strictEqual(deriveTier(null, 'none'), 'B');
  assert.strictEqual(deriveTier(undefined, undefined), 'B');
  assert.strictEqual(deriveTier('', 'none'), 'B'); // empty string reads the same as null/absent
});

test('deriveTier: production set + deploy push-main -> C', () => {
  assert.strictEqual(deriveTier('https://example.com', 'push-main'), 'C');
});

test('deriveTier: production set + deploy tag|manual -> A', () => {
  assert.strictEqual(deriveTier('https://example.com', 'tag'), 'A');
  assert.strictEqual(deriveTier('https://example.com', 'manual'), 'A');
});

test('deriveTier: production set + deploy none/unknown -> null (a shape with no letter, never guessed)', () => {
  assert.strictEqual(deriveTier('https://example.com', 'none'), null);
  assert.strictEqual(deriveTier('https://example.com', 'bogus'), null);
});

test('deriveTier is a function of (production, deploy) only — never reads exposure', () => {
  // No exposure argument exists at all; this test pins the SIGNATURE as the guarantee.
  assert.strictEqual(deriveTier.length, 2);
});

// --------------------------------------------------------------- deriveConsequences

// #283: `writes` widened again, and the reading `deriveConsequences` uses changed structurally,
// not just cosmetically — this whole block was rewritten (not just added-to) for it. Before:
// `writesResolved` was `resolveWrites(writes).value`'s 2-state summary, which read 'isolated'
// for BOTH an explicit declaration AND plain absence — the exact defect #282 reported, because
// `trunkDirect` (computed separately, from the raw value via `trunkDirectVetoed`) could then
// disagree with it in the same --json blob. Now: `writesResolved` is `writesMode(writes).mode` —
// a TOTAL function onto exactly `free` / `direct` / `isolated` — and `trunkDirect` is still
// `trunkDirectVetoed(writes)`, so both read the SAME underlying fact and can never disagree.
// `writesMethod` (the retired 3-way parse) is DROPPED from the returned object entirely.

test('deriveConsequences: writes omitted resolves to free — coexistence, not vetoed, CI/branch conditional on session identity', () => {
  const c = deriveConsequences({ exposure: null, writes: null, room: null });
  assert.strictEqual(c.writesResolved, 'free');
  assert.strictEqual(c.writesSource, null); // genuinely omitted — not "default"
  assert.match(c.trunkDirect, /permitted/);
  assert.match(c.trunkDirect, /COLAB_HUMAN=1/);
  assert.match(c.ciRole, /gate for a worktree/);
  assert.match(c.ciRole, /alarm for an attended trunk-direct/);
  assert.match(c.branchMandatory, /mandatory for every session except an attended trunk-direct/);
  assert.strictEqual('writesMethod' in c, false);
});

test('deriveConsequences: writes: isolated (the EXPLICIT veto) forbids trunk-direct outright, CI is always a gate, branch always mandatory', () => {
  const c = deriveConsequences({ exposure: null, writes: 'isolated', room: null });
  assert.strictEqual(c.writesResolved, 'isolated');
  assert.match(c.trunkDirect, /vetoed/);
  assert.doesNotMatch(c.trunkDirect, /COLAB_HUMAN/, 'the veto never advertises a way around itself');
  assert.match(c.ciRole, /^gate —/);
  assert.match(c.branchMandatory, /^mandatory — isolated/);
});

test('deriveConsequences: writes: free reads identically to omission', () => {
  const c = deriveConsequences({ exposure: null, writes: 'free', room: null });
  assert.strictEqual(c.writesResolved, 'free');
  assert.strictEqual(c.writesSource, 'declared');
  assert.match(c.trunkDirect, /permitted/);
  assert.match(c.ciRole, /alarm for an attended trunk-direct/);
});

test('deriveConsequences: every legacy spelling (serial, serial-direct, serial-gated) resolves to free, source legacy, reading identically to omission', () => {
  for (const writes of ['serial', 'serial-direct', 'serial-gated']) {
    const c = deriveConsequences({ exposure: null, writes, room: null });
    assert.strictEqual(c.writesResolved, 'free', writes);
    assert.strictEqual(c.writesSource, 'legacy', writes);
    assert.match(c.trunkDirect, /permitted/, writes);
    assert.match(c.ciRole, /alarm for an attended trunk-direct/, writes);
  }
});

test('#283: deriveConsequences: writes: direct is declared honestly, not vetoed, and every consequence field says "declared, not yet enforced"', () => {
  const c = deriveConsequences({ exposure: null, writes: 'direct', room: null });
  assert.strictEqual(c.writesResolved, 'direct');
  assert.strictEqual(c.writesSource, 'declared');
  assert.doesNotMatch(c.trunkDirect, /vetoed/);
  assert.match(c.trunkDirect, /declared, not yet enforced/);
  assert.match(c.ciRole, /declared, not yet enforced/);
  assert.match(c.ciRole, /alarm, always/);
  assert.match(c.branchMandatory, /declared, not yet enforced/);
});

test('#208: deriveConsequences: writesSource is null (not "default") when writes is genuinely omitted', () => {
  const c = deriveConsequences({ exposure: null, writes: null, room: null });
  assert.strictEqual(c.writesResolved, 'free');
  assert.strictEqual(c.writesSource, null);
});

test('#208/#282/#283: deriveConsequences no longer returns writesMethod at all', () => {
  const c = deriveConsequences({ exposure: null, writes: 'serial-direct', room: null });
  assert.strictEqual('writesMethod' in c, false);
});

test('#282 regression, restated as a coherence invariant for the full #283 vocabulary: writesResolved === "isolated" iff trunkDirect is vetoed', () => {
  for (const writes of [undefined, null, 'serial', 'serial-direct', 'serial-gated', 'free', 'direct', 'isolated']) {
    const c = deriveConsequences({ exposure: null, writes, room: null });
    assert.strictEqual(
      c.writesResolved === 'isolated',
      /^vetoed/.test(c.trunkDirect),
      `writes=${JSON.stringify(writes)}: writesResolved=${JSON.stringify(c.writesResolved)}, trunkDirect=${JSON.stringify(c.trunkDirect)}`,
    );
  }
});

test('deriveConsequences: gate count and recovery obligation follow exposure, null when undeclared', () => {
  const undeclared = deriveConsequences({ exposure: null, writes: null, room: null });
  assert.strictEqual(undeclared.gateCount, null);
  assert.strictEqual(undeclared.recoveryObligation, null);
  assert.strictEqual(undeclared.ciDepth, null);

  const none = deriveConsequences({ exposure: 'none', writes: null, room: null });
  assert.strictEqual(none.gateCount, 0);
  assert.match(none.recoveryObligation, /git reset/);
  assert.match(none.ciDepth, /room/);

  const self_ = deriveConsequences({ exposure: 'self', writes: null, room: null });
  assert.strictEqual(self_.gateCount, 0);
  assert.match(self_.recoveryObligation, /rebuild the checkout/);

  const live = deriveConsequences({ exposure: 'live', writes: null, room: null });
  assert.strictEqual(live.gateCount, 1);
  assert.match(live.recoveryObligation, /revert/);
  assert.match(live.ciDepth, /thorough/);

  const released = deriveConsequences({ exposure: 'released', writes: null, room: null });
  assert.strictEqual(released.gateCount, 2);
  assert.match(released.recoveryObligation, /cut a new version/);
  assert.match(released.ciDepth, /thorough/);
});

test('deriveConsequences: ceremony weight follows room, null when undeclared', () => {
  assert.strictEqual(deriveConsequences({ exposure: null, writes: null, room: null }).ceremonyWeight, null);
  assert.match(deriveConsequences({ exposure: null, writes: null, room: 'solo' }).ceremonyWeight, /one reader/);
  assert.match(deriveConsequences({ exposure: null, writes: null, room: 'team' }).ceremonyWeight, /standard/);
  assert.match(deriveConsequences({ exposure: null, writes: null, room: 'public' }).ceremonyWeight, /standard/);
});

// --------------------------------------------------------------- detectStack / detectChannelCandidates

test('detectStack proposes a candidate per manifest found, several at once for a polyglot repo', () => {
  const i = io({ files: { 'package.json': '{}', 'composer.json': '{}' } });
  assert.deepStrictEqual(detectStack(i), ['node (package.json)', 'php (composer.json)']);
});

test('detectStack finds nothing when no manifest is present', () => {
  assert.deepStrictEqual(detectStack(io()), []);
});

test('detectChannelCandidates: a version-shaped tag proposes "artifact"', () => {
  const i = io({ tags: ['v1.2.0'] });
  const r = detectChannelCandidates(i, [], {});
  assert.deepStrictEqual(r.candidates, ['artifact']);
  assert.match(r.evidenceLine, /release artifact exists/);
});

test('detectChannelCandidates: a non-version tag proposes nothing', () => {
  const i = io({ tags: ['backup-2024'] });
  const r = detectChannelCandidates(i, [], {});
  assert.deepStrictEqual(r.candidates, []);
});

test('detectChannelCandidates: a deploy-*.yml workflow proposes "workflow"', () => {
  const r = detectChannelCandidates(io(), ['deploy-prod.yml'], {});
  assert.deepStrictEqual(r.candidates, ['workflow']);
});

test('detectChannelCandidates: a populated .githooks dir proposes "hook"', () => {
  const r = detectChannelCandidates(io(), [], { hooksDirFiles: ['pre-commit'] });
  assert.deepStrictEqual(r.candidates, ['hook']);
});

test('detectChannelCandidates: a non-default core.hooksPath proposes "hook" even with an empty dir listing', () => {
  const r = detectChannelCandidates(io(), [], { hooksPath: '.githooks' });
  assert.deepStrictEqual(r.candidates, ['hook']);
});

test('detectChannelCandidates never returns duplicate false candidates and reports several at once', () => {
  const i = io({ tags: ['v2.0.0'] });
  const r = detectChannelCandidates(i, ['deploy-prod.yml'], { hooksDirFiles: ['post-merge'] });
  assert.deepStrictEqual(r.candidates.sort(), ['artifact', 'hook', 'workflow']);
});

// --------------------------------------------------------------- remainingSteps

test('remainingSteps returns §9 steps 3-9, unconditionally (commit 1 performs none of them)', () => {
  const steps = remainingSteps();
  assert.strictEqual(steps.length, 7);
  assert.deepStrictEqual(steps.map((s) => s.n), [3, 4, 5, 6, 7, 8, 9]);
});

test('#449: remainingSteps on a fork — step 5 is the append-only block, never the thin shell', () => {
  const steps = remainingSteps({ fork: { remote: 'upstream', url: 'https://example.invalid/up.git', source: 'upstream-remote' } });
  const five = steps.filter((s) => s.n === 5);
  assert.strictEqual(five.length, 1);
  assert.match(five[0].text, /append templates\/repo-CLAUDE-block\.md at the END/);
  assert.match(five[0].text, /do NOT make CLAUDE\.md the thin shell/);
  assert.match(five[0].text, /remote "upstream"/);
  assert.ok(!steps.some((s) => /^Make CLAUDE\.md the thin shell/.test(s.text)));
});

test('#449: remainingSteps on a fork with an upstream agent workflow names it for the precedence line', () => {
  const steps = remainingSteps({ fork: { source: 'flag' }, upstreamAgentFiles: ['.claude/skills/spec-flow', '.claude/commands/fix.md'] });
  const five = steps.filter((s) => s.n === 5);
  assert.strictEqual(five.length, 2);
  assert.match(five[0].text, /\(--fork\)/);
  assert.match(five[1].text, /\.claude\/skills\/spec-flow, \.claude\/commands\/fix\.md/);
  assert.match(five[1].text, /code-start → code-wrap → code-ship/);
});

// --------------------------------------------------------------- releaseRungSteps (#492)

test('#492: releaseRungSteps is silent unless exposure is released', () => {
  for (const exposure of ['none', 'self', 'live']) {
    assert.deepStrictEqual(releaseRungSteps({ cfg: { exposure, production: null, deploy: 'none' }, tags: [] }), []);
  }
  assert.deepStrictEqual(releaseRungSteps({ cfg: { tier: 'B' }, tags: [] }), []);
});

test('#492: released + deploy: tag -> deploy-tag block, release workflow, PHP deploy template disarmed, first final human', () => {
  const steps = releaseRungSteps({
    cfg: { exposure: 'released', production: 'https://app.example.invalid', deploy: 'tag' },
    workflowTexts: { 'ci.yml': 'name: CI' }, tags: ['backup-1'], stackFiles: ['composer.json'],
  });
  assert.ok(steps.every((s) => s.n === 6));
  assert.match(steps[0].text, /`route: deploy-tag` and `version-source: tag`/);
  assert.match(steps[1].text, /colab template release-auto/);
  assert.match(steps[1].text, /HANDBOOK_REF/);
  assert.match(steps[1].text, /self-hosted/);
  assert.match(steps[2].text, /colab template deploy-xserver/);
  assert.match(steps[2].text, /DISARMED/);
  assert.match(steps[3].text, /First final: none yet/);
  assert.match(steps[3].text, /only when told/);
});

test('#492: released + deploy: manual on a container stack proposes deploy-container', () => {
  const steps = releaseRungSteps({
    cfg: { exposure: 'released', production: 'https://app.example.invalid', deploy: 'manual', runbook: 'docs/deploy.md' },
    workflowTexts: {}, tags: ['v1.0.0'], stackFiles: ['Dockerfile'],
  });
  assert.match(steps[0].text, /`route: deploy-tag`/);
  assert.ok(steps.some((s) => /colab template deploy-container/.test(s.text)));
  assert.ok(!steps.some((s) => /First final/.test(s.text)), 'a final already exists');
});

test('#492: released with no production proposes rapid-app (team) or public-tool (public), and copies no deploy template', () => {
  const team = releaseRungSteps({ cfg: { exposure: 'released', production: null, deploy: 'none', room: 'team' }, tags: [], stackFiles: ['composer.json'] });
  assert.match(team[0].text, /`route: rapid-app`/);
  assert.match(team[0].text, /PROPOSED/);
  assert.ok(!team.some((s) => /deploy-xserver|deploy-container/.test(s.text)));
  const pub = releaseRungSteps({ cfg: { exposure: 'released', production: null, deploy: 'none', room: 'public' }, tags: ['v0.1.0'] });
  assert.match(pub[0].text, /`route: public-tool`/);
});

test('#492: a declared route and an existing release workflow are kept, not re-copied', () => {
  const steps = releaseRungSteps({
    cfg: { exposure: 'released', production: null, deploy: 'none', release: { route: 'library-fast' } },
    workflowTexts: { 'release.yml': 'run: colab release cut --auto' }, tags: ['v2.1.0'],
  });
  assert.match(steps[0].text, /`release.route: library-fast` declared/);
  assert.match(steps[1].text, /Release workflow present \(\.github\/workflows\/release\.yml\)/);
  assert.strictEqual(steps.length, 2);
});

test('#492: unreadable tags and an unmatched released row both say so instead of guessing', () => {
  const unread = releaseRungSteps({ cfg: { exposure: 'released', production: null, deploy: 'none' }, tags: null });
  assert.ok(unread.some((s) => /tags could not be read/.test(s.text)));
  const unmatched = releaseRungSteps({ cfg: { exposure: 'released', production: 'https://x.example.invalid', deploy: 'none' }, tags: [] });
  assert.strictEqual(unmatched.length, 1);
  assert.match(unmatched[0].text, /match no §6 row/);
});

test('#492: detect() on a released repo carries the release-rung lines inside step 6', () => {
  const projectYml = 'trunk: main\nexposure: released\nproduction: https://app.example.invalid\ndeploy: tag\n';
  const r = detect(io({ files: { '.github/project.yml': projectYml }, tags: [] }));
  const six = r.remaining.filter((s) => s.n === 6);
  assert.ok(six.length >= 3);
  assert.ok(six.some((s) => /`route: deploy-tag`/.test(s.text)));
  assert.deepStrictEqual([...new Set(r.remaining.map((s) => s.n))], [3, 4, 5, 6, 7, 8, 9]);
});

test('#449: remainingSteps with a migrations scan leads with a step-2 line, in all three shapes', () => {
  const none = remainingSteps({ migrations: { declared: null, candidates: [] } });
  assert.deepStrictEqual(none.map((s) => s.n), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.match(none[0].text, /none detected/);
  const found = remainingSteps({ migrations: { declared: null, candidates: ['modules/billing/sql/'] } });
  assert.match(found[0].text, /candidate layouts .*modules\/billing\/sql\//);
  const declared = remainingSteps({ migrations: { declared: ['db/'], candidates: [] } });
  assert.match(declared[0].text, /`migrations:` declared \(db\/\)/);
});

test('#449: detectMigrationCandidates — uncovered migrations/ and *.sql dirs, defaults and declared prefixes skipped', () => {
  const files = [
    'modules/billing/sql/001_init.sql', 'modules/billing/sql/002_add.sql', 'modules/users/sql/001.sql',
    'database/migrations/2024_01_01_x.php', 'backend/migrations/001.js', 'db/schema.sql',
    'vendor/lib/sql/x.sql', 'node_modules/a/migrations/1.js', 'root.sql', 'README.md',
  ];
  const r = detectMigrationCandidates({}, files);
  assert.strictEqual(r.declared, null);
  assert.deepStrictEqual(r.candidates, ['backend/migrations/', 'db/', 'modules/billing/sql/', 'modules/users/sql/']);
  const d = detectMigrationCandidates({ migrations: ['modules/'] }, files);
  assert.deepStrictEqual(d.declared, ['modules/']);
  assert.deepStrictEqual(d.candidates, ['backend/migrations/', 'db/']);
});

test('#449: detectUpstreamAgentFiles lists .claude/skills and .claude/commands entries, dotfiles skipped', () => {
  const r = detectUpstreamAgentFiles(io({ dirs: { '.claude/skills': ['spec-flow', '.DS_Store'], '.claude/commands': ['fix.md'] } }));
  assert.deepStrictEqual(r, ['.claude/skills/spec-flow', '.claude/commands/fix.md']);
});

test('#449: detect — fork + trackedFiles reach the report; without them the pre-#449 list is unchanged', () => {
  const d = io({ dirs: { '.claude/skills': ['spec-flow'] } });
  const plain = detect(d);
  assert.strictEqual(plain.fork, null);
  assert.strictEqual(plain.migrations, null);
  assert.deepStrictEqual(plain.upstreamAgentFiles, []);
  assert.deepStrictEqual(plain.remaining.map((s) => s.n), [3, 4, 5, 6, 7, 8, 9]);
  const fork = detect(d, { fork: { remote: 'upstream', url: 'u', source: 'upstream-remote' }, trackedFiles: ['modules/a/sql/1.sql'] });
  assert.deepStrictEqual(fork.upstreamAgentFiles, ['.claude/skills/spec-flow']);
  assert.deepStrictEqual(fork.migrations.candidates, ['modules/a/sql/']);
  assert.deepStrictEqual(fork.remaining.map((s) => s.n), [2, 3, 4, 5, 5, 6, 7, 8, 9]);
});

test('#449: renderClaudeShell with importAgents:false is the block alone — no @AGENTS.md line', () => {
  const tpl = '<!-- Paste this -->\n## Conventions\n<!-- colab-handbook @ <version> -->\n';
  const out = renderClaudeShell(tpl, { version: 'v1.0.0', trunk: 'main', tier: 'B', importAgents: false });
  assert.ok(!out.includes('@AGENTS.md'));
  assert.match(out, /^## Conventions/);
  assert.match(renderClaudeShell(tpl, { version: 'v1.0.0', trunk: 'main', tier: 'B' }), /^@AGENTS\.md\n\n## Conventions/);
});

// --------------------------------------------------------------- detect() — the whole report

test('detect: no descriptor at all -> no axis of record, and the tier row still shows the B candidate ' +
     '(absence of production genuinely derives B — the other four rows have no such default and read missing)', () => {
  const r = detect(io());
  assert.strictEqual(r.descriptorExists, false);
  assert.strictEqual(r.axis.source, 'none');
  assert.strictEqual(r.rows.tier.state, 'detected');
  assert.strictEqual(r.rows.tier.value, 'B');
  assert.strictEqual(r.rows.room.state, 'missing');
  assert.strictEqual(r.rows.exposure.state, 'missing');
  assert.strictEqual(r.rows.writes.state, 'missing');
  assert.strictEqual(r.rows.channels.state, 'missing');
  assert.strictEqual(r.legacyTierLetter, 'B'); // no production declared -> B
});

test('detect: a complete descriptor (this repo\'s own shape) reads every row as answered', () => {
  const projectYml = [
    'tier: B',
    'trunk: main',
    'production: null',
    'deploy: none',
    'stack: docs',
    'writes: serial',
    'room: public',
    'exposure: released',
    'channels: [artifact]',
  ].join('\n');
  const r = detect(io({ files: { '.github/project.yml': projectYml } }));
  assert.strictEqual(r.descriptorExists, true);
  assert.strictEqual(r.axis.source, 'exposure');
  assert.strictEqual(r.rows.tier.state, 'answered');
  assert.strictEqual(r.rows.room.state, 'answered');
  assert.strictEqual(r.rows.exposure.state, 'answered');
  assert.strictEqual(r.rows.exposure.value, 'released');
  assert.strictEqual(r.rows.writes.state, 'answered');
  assert.strictEqual(r.rows.channels.state, 'answered');
  assert.deepStrictEqual(r.rows.channels.value, ['artifact']);
});

test('detect: a descriptor missing only channels reports exactly that row as missing/detected, the rest answered', () => {
  const projectYml = [
    'tier: A',
    'trunk: dev',
    'production: https://example.com',
    'deploy: tag',
    'stack: laravel',
    'writes: isolated',
    'room: team',
  ].join('\n');
  const r = detect(io({ files: { '.github/project.yml': projectYml }, tags: ['v3.0.0'] }));
  assert.strictEqual(r.rows.tier.state, 'answered');
  assert.strictEqual(r.rows.room.state, 'answered');
  assert.strictEqual(r.rows.writes.state, 'answered');
  // exposure undeclared, tier declared -> legacy read
  assert.strictEqual(r.rows.exposure.state, 'legacy read');
  assert.strictEqual(r.rows.exposure.value, 'released'); // LEGACY.A = released
  // channels undeclared, but a version-shaped tag is evidence -> detected, never answered
  assert.strictEqual(r.rows.channels.state, 'detected');
  assert.deepStrictEqual(r.rows.channels.value, ['artifact']);
});

test('detect: exposure declared alone (no tier) reads as answered, not legacy', () => {
  const projectYml = ['trunk: main', 'production: null', 'deploy: none', 'exposure: self'].join('\n');
  const r = detect(io({ files: { '.github/project.yml': projectYml } }));
  assert.strictEqual(r.axis.source, 'exposure');
  assert.strictEqual(r.rows.exposure.state, 'answered');
  assert.strictEqual(r.rows.exposure.value, 'self');
});

test('detect: tier: B carries no derivable exposure opinion — legacy read resolves to null, not a guess', () => {
  const projectYml = ['tier: B', 'trunk: main', 'production: null', 'deploy: none'].join('\n');
  const r = detect(io({ files: { '.github/project.yml': projectYml } }));
  assert.strictEqual(r.rows.exposure.state, 'legacy read');
  assert.strictEqual(r.rows.exposure.value, null);
});

test('detect: undeclared tier with production+deploy present derives a candidate letter, never writes it', () => {
  const projectYml = ['trunk: dev', 'production: https://example.com', 'deploy: push-main'].join('\n');
  const r = detect(io({ files: { '.github/project.yml': projectYml } }));
  assert.strictEqual(r.rows.tier.state, 'detected');
  assert.strictEqual(r.rows.tier.value, 'C');
  assert.strictEqual(r.legacyTierLetter, 'C');
  // the descriptor object itself is untouched — detect() never mutates or writes
  assert.strictEqual(Object.prototype.hasOwnProperty.call(r.cfg, 'tier'), false);
});

test('detect: reports declared vs detected trunk and flags disagreement', () => {
  const projectYml = ['trunk: main'].join('\n');
  const r = detect(io({ files: { '.github/project.yml': projectYml } }), { trunk: 'develop' });
  assert.strictEqual(r.detected.trunk.declared, 'main');
  assert.strictEqual(r.detected.trunk.detected, 'develop');
  assert.strictEqual(r.detected.trunk.agree, false);
});

// =========================================================================================
// commit 2 — QUESTIONS / axisMissing
// =========================================================================================

test('QUESTIONS covers exactly the five ROW_NAMES, in that order, and the tier question never mentions writing tier', () => {
  assert.deepStrictEqual(QUESTIONS.map((q) => q.axis), ROW_NAMES);
  const tierQ = QUESTIONS.find((q) => q.axis === 'tier');
  assert.deepStrictEqual(tierQ.keys, ['production', 'deploy']);
});

test('#283: every QUESTIONS entry carries a non-empty choices array, the wizard\'s forced menu', () => {
  for (const q of QUESTIONS) {
    assert.ok(Array.isArray(q.choices) && q.choices.length > 0, q.axis);
  }
});

test('#283: the writes menu is exactly free/direct/isolated — the retired serial vocabulary appears nowhere in it', () => {
  const writesQ = QUESTIONS.find((q) => q.axis === 'writes');
  assert.deepStrictEqual(writesQ.choices.map((c) => c.value), ['free', 'direct', 'isolated']);
  assert.doesNotMatch(writesQ.prompt, /serial/);
  assert.doesNotMatch(writesQ.prompt, /leave unanswered/);
});

test('#283: exposure is the only QUESTIONS entry that declares a skip', () => {
  for (const q of QUESTIONS) {
    if (q.axis === 'exposure') assert.ok(q.skip, 'exposure must declare a skip');
    else assert.strictEqual(q.skip, undefined, `${q.axis} must not declare a skip`);
  }
});

// --------------------------------------------------------------- renderMenu / resolveChoice (#283)

test('renderMenu: writes lists free/direct/isolated and never mentions serial', () => {
  const menu = renderMenu('writes');
  assert.match(menu, /free/);
  assert.match(menu, /direct/);
  assert.match(menu, /isolated/);
  assert.doesNotMatch(menu, /serial/);
});

test('renderMenu: exposure lists its four values plus a trailing skip line', () => {
  const menu = renderMenu('exposure');
  assert.match(menu, /5\) skip/);
});

test('renderMenu: an axis with no choices renders an empty string', () => {
  assert.strictEqual(renderMenu('nonexistent-axis'), '');
});

test('resolveChoice: an ordinary axis accepts EITHER the option number or the literal value, identically', () => {
  assert.deepStrictEqual(resolveChoice('room', '2'), { ok: true, value: 'team' });
  assert.deepStrictEqual(resolveChoice('room', 'team'), { ok: true, value: 'team' });
});

test('resolveChoice: writes has no skip — a blank answer refuses, naming the three options', () => {
  const r = resolveChoice('writes', '');
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /free/);
  assert.match(r.message, /direct/);
  assert.match(r.message, /isolated/);
});

test('resolveChoice: exposure\'s skip option resolves via its number', () => {
  assert.deepStrictEqual(resolveChoice('exposure', '5'), { ok: true, skip: true });
});

test('resolveChoice: an out-of-range number refuses', () => {
  const r = resolveChoice('writes', '9');
  assert.strictEqual(r.ok, false);
});

test('resolveChoice: channels is multi-select — comma-separated numbers resolve to their values, validated through adoptValidateChannels', () => {
  const r = resolveChoice('channels', '1,3');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.value, ['workflow', 'procedure']);
});

test('resolveChoice: channels rejects "none" combined with another member, via adoptValidateChannels', () => {
  const r = resolveChoice('channels', 'none,workflow');
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /none/);
});

test('resolveChoice: an unknown axis refuses rather than throwing', () => {
  const r = resolveChoice('nonexistent-axis', '1');
  assert.strictEqual(r.ok, false);
});

// --------------------------------------------------------------- writesGateVerdict (#283, §6)

test('writesGateVerdict: free and isolated always clear, in every combination — the gate exists for direct alone', () => {
  for (const writes of ['free', 'isolated']) {
    for (const effExposure of ['none', 'self', 'live', 'released']) {
      for (const isTTY of [true, false]) {
        assert.deepStrictEqual(
          writesGateVerdict({ writes, effExposure, isTTY, colabHuman: false, answeredBy: null }),
          { ok: true },
          `writes=${writes} effExposure=${effExposure} isTTY=${isTTY}`,
        );
      }
    }
  }
});

test('writesGateVerdict: direct + exposure live/released refuses, exit 5, regardless of human bar', () => {
  for (const effExposure of ['live', 'released']) {
    const r = writesGateVerdict({ writes: 'direct', effExposure, isTTY: true, colabHuman: true, answeredBy: 'x' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.class, GATE_CLASS.REPO_SHAPE);
    assert.strictEqual(r.exitCode, 5);
  }
});

test('writesGateVerdict: direct + exposure none/self, no TTY, no COLAB_HUMAN refuses, exit 3', () => {
  for (const effExposure of ['none', 'self', null]) {
    const r = writesGateVerdict({ writes: 'direct', effExposure, isTTY: false, colabHuman: false, answeredBy: null });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.class, GATE_CLASS.HUMAN_GATED);
    assert.strictEqual(r.exitCode, 3);
  }
});

test('writesGateVerdict: direct + exposure none clears via COLAB_HUMAN + answeredBy, no TTY needed', () => {
  const r = writesGateVerdict({ writes: 'direct', effExposure: 'none', isTTY: false, colabHuman: true, answeredBy: 'x' });
  assert.deepStrictEqual(r, { ok: true });
});

test('writesGateVerdict: direct + exposure none clears via isTTY alone, no COLAB_HUMAN needed', () => {
  const r = writesGateVerdict({ writes: 'direct', effExposure: 'none', isTTY: true, colabHuman: false, answeredBy: null });
  assert.deepStrictEqual(r, { ok: true });
});

test('axisMissing: an empty descriptor is missing every axis', () => {
  for (const axis of ROW_NAMES) assert.strictEqual(axisMissing({}, axis), true, axis);
});

test('axisMissing: a fully declared descriptor (this repo\'s own shape) is missing nothing', () => {
  const cfg = { production: null, deploy: 'none', room: 'public', exposure: 'released', writes: 'serial', channels: ['artifact'] };
  for (const axis of ROW_NAMES) assert.strictEqual(axisMissing(cfg, axis), false, axis);
});

test('axisMissing: a legacy tier-only descriptor still reports exposure as MISSING — a legacy read is not an answer', () => {
  const cfg = { tier: 'C', production: 'https://x', deploy: 'push-main' };
  assert.strictEqual(axisMissing(cfg, 'exposure'), true);
  assert.strictEqual(axisMissing(cfg, 'tier'), false); // production+deploy both present
});

test('axisMissing: tier axis needs BOTH production and deploy present, not just one', () => {
  assert.strictEqual(axisMissing({ production: null }, 'tier'), true);
  assert.strictEqual(axisMissing({ deploy: 'none' }, 'tier'), true);
  assert.strictEqual(axisMissing({ production: null, deploy: 'none' }, 'tier'), false);
});

// =========================================================================================
// commit 2 — EXPOSURE_SHAPE (the constructor half of #144's exposure contract)
// =========================================================================================

test('EXPOSURE_SHAPE.self: always ok — self carries no mechanism rule at all', () => {
  assert.deepStrictEqual(exposureShapeVerdict('self', { trunk: 'wherever', hasProduction: true, deploy: 'anything', hasDeployWorkflow: false }), { ok: true });
});

test('EXPOSURE_SHAPE.none: ok only on trunk main with no deploy workflow', () => {
  assert.strictEqual(exposureShapeVerdict('none', { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: false }).ok, true);
  assert.strictEqual(exposureShapeVerdict('none', { trunk: 'dev', hasProduction: false, deploy: 'none', hasDeployWorkflow: false }).ok, false);
  assert.strictEqual(exposureShapeVerdict('none', { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: true }).ok, false);
});

test('EXPOSURE_SHAPE.live: needs trunk dev, production set, deploy push-main, and a deploy workflow — all four', () => {
  const good = { trunk: 'dev', hasProduction: true, deploy: 'push-main', hasDeployWorkflow: true };
  assert.strictEqual(exposureShapeVerdict('live', good).ok, true);
  assert.strictEqual(exposureShapeVerdict('live', { ...good, trunk: 'main' }).ok, false);
  assert.strictEqual(exposureShapeVerdict('live', { ...good, hasProduction: false }).ok, false);
  assert.strictEqual(exposureShapeVerdict('live', { ...good, deploy: 'tag' }).ok, false);
  assert.strictEqual(exposureShapeVerdict('live', { ...good, hasDeployWorkflow: false }).ok, false);
});

test('EXPOSURE_SHAPE.released: no-production shape needs trunk main + deploy none/null', () => {
  assert.strictEqual(exposureShapeVerdict('released', { trunk: 'main', hasProduction: false, deploy: null, hasDeployWorkflow: false }).ok, true);
  assert.strictEqual(exposureShapeVerdict('released', { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: false }).ok, true);
  assert.strictEqual(exposureShapeVerdict('released', { trunk: 'dev', hasProduction: false, deploy: null, hasDeployWorkflow: false }).ok, false);
  assert.strictEqual(exposureShapeVerdict('released', { trunk: 'main', hasProduction: false, deploy: 'push-main', hasDeployWorkflow: false }).ok, false);
});

test('EXPOSURE_SHAPE.released: with-production shape needs deploy tag|manual, never push-main or none', () => {
  const withProd = (deploy, trunk) => exposureShapeVerdict('released', { trunk, hasProduction: true, deploy, hasDeployWorkflow: true, hasRunbook: true });
  assert.strictEqual(withProd('tag', 'dev').ok, true);
  assert.strictEqual(withProd('manual', 'dev').ok, true);
  assert.strictEqual(withProd('tag', 'main').ok, true); // the single-trunk tag-gated variant
  assert.strictEqual(withProd('manual', 'main').ok, false); // manual has no single-trunk exemption
  assert.strictEqual(withProd('push-main', 'dev').ok, false);
  assert.strictEqual(withProd('none', 'dev').ok, false);
});

test('EXPOSURE_SHAPE.released: deploy: manual, or deploy: tag with no committed workflow, needs a runbook (mirrors audit.mjs\'s checkRunbook)', () => {
  const manualNoRunbook = exposureShapeVerdict('released', { trunk: 'dev', hasProduction: true, deploy: 'manual', hasDeployWorkflow: false, hasRunbook: false });
  assert.strictEqual(manualNoRunbook.ok, false);
  assert.match(manualNoRunbook.reason, /runbook/);

  const manualWithRunbook = exposureShapeVerdict('released', { trunk: 'dev', hasProduction: true, deploy: 'manual', hasDeployWorkflow: false, hasRunbook: true });
  assert.strictEqual(manualWithRunbook.ok, true);

  const externalTagNoRunbook = exposureShapeVerdict('released', { trunk: 'dev', hasProduction: true, deploy: 'tag', hasDeployWorkflow: false, hasRunbook: false });
  assert.strictEqual(externalTagNoRunbook.ok, false);

  const tagWithWorkflow = exposureShapeVerdict('released', { trunk: 'dev', hasProduction: true, deploy: 'tag', hasDeployWorkflow: true, hasRunbook: false });
  assert.strictEqual(tagWithWorkflow.ok, true, 'a committed workflow already answers the path — no runbook needed');
});

// =========================================================================================
// commit 2 — gateVerdict (the human gate)
// =========================================================================================

const okShapeCtx = { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: false }; // supports self/none
const noEvidence = { versionTags: [], deployPaths: [] };

test('gateVerdict: raising to live/released, or a first declaration of either, needs nothing beyond shape', () => {
  const liveCtx = { trunk: 'dev', hasProduction: true, deploy: 'push-main', hasDeployWorkflow: true };
  const v1 = gateVerdict({ exposure: 'live', currentExposure: null, shapeCtx: liveCtx, evidence: noEvidence, isTTY: false, colabHuman: false, answeredBy: null, reason: null });
  assert.strictEqual(v1.ok, true);
  const v2 = gateVerdict({ exposure: 'released', currentExposure: 'live', shapeCtx: { ...liveCtx, deploy: 'tag' }, evidence: noEvidence, isTTY: false, colabHuman: false, answeredBy: null, reason: null });
  assert.strictEqual(v2.ok, true); // raising live -> released
});

test('gateVerdict: first declaration of none/self is human-gated — refused with neither TTY nor COLAB_HUMAN', () => {
  const v = gateVerdict({ exposure: 'self', currentExposure: null, shapeCtx: okShapeCtx, evidence: noEvidence, isTTY: false, colabHuman: false, answeredBy: null, reason: null });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.class, GATE_CLASS.HUMAN_GATED);
  assert.strictEqual(v.exitCode, 3);
});

test('gateVerdict: first declaration of none/self clears with COLAB_HUMAN + answeredBy, no reason needed', () => {
  const v = gateVerdict({ exposure: 'none', currentExposure: null, shapeCtx: okShapeCtx, evidence: noEvidence, isTTY: false, colabHuman: true, answeredBy: 'Alex', reason: null });
  assert.strictEqual(v.ok, true);
});

test('gateVerdict: first declaration of none/self clears via isTTY alone, no COLAB_HUMAN needed', () => {
  const v = gateVerdict({ exposure: 'self', currentExposure: null, shapeCtx: okShapeCtx, evidence: noEvidence, isTTY: true, colabHuman: false, answeredBy: null, reason: null });
  assert.strictEqual(v.ok, true);
});

test('gateVerdict: lowering an existing exposure needs the human bar PLUS a reason', () => {
  const noBar = gateVerdict({ exposure: 'self', currentExposure: 'released', shapeCtx: okShapeCtx, evidence: noEvidence, isTTY: false, colabHuman: false, answeredBy: null, reason: null });
  assert.strictEqual(noBar.ok, false);
  assert.strictEqual(noBar.class, GATE_CLASS.HUMAN_GATED);

  const barNoReason = gateVerdict({ exposure: 'self', currentExposure: 'released', shapeCtx: okShapeCtx, evidence: noEvidence, isTTY: true, colabHuman: false, answeredBy: null, reason: null });
  assert.strictEqual(barNoReason.ok, false, 'a human bar alone is not enough to lower — reason is also required');
  assert.strictEqual(barNoReason.class, GATE_CLASS.HUMAN_GATED);

  const both = gateVerdict({ exposure: 'self', currentExposure: 'released', shapeCtx: okShapeCtx, evidence: noEvidence, isTTY: true, colabHuman: false, answeredBy: null, reason: 'a considered downgrade' });
  assert.strictEqual(both.ok, true);
});

test('gateVerdict: the shape check runs FIRST — a shape refusal wins even over a fully-cleared human bar', () => {
  const badShape = { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: false }; // does not support live
  const v = gateVerdict({ exposure: 'live', currentExposure: null, shapeCtx: badShape, evidence: noEvidence, isTTY: true, colabHuman: true, answeredBy: 'Alex', reason: 'anything' });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.class, GATE_CLASS.REPO_SHAPE);
  assert.strictEqual(v.exitCode, 5);
});

test('gateVerdict: the falsifier fires only on "none", never on "self" — self gets no falsifier at all', () => {
  const evidence = { versionTags: ['v1.0.0'], deployPaths: [] };
  const noneRefused = gateVerdict({ exposure: 'none', currentExposure: null, shapeCtx: okShapeCtx, evidence, isTTY: true, colabHuman: false, answeredBy: null, reason: null });
  assert.strictEqual(noneRefused.ok, false);
  assert.strictEqual(noneRefused.class, GATE_CLASS.EVIDENCE_CONTRADICTS);
  assert.strictEqual(noneRefused.exitCode, 4);
  assert.match(noneRefused.message, /v1\.0\.0/);

  const selfOk = gateVerdict({ exposure: 'self', currentExposure: null, shapeCtx: okShapeCtx, evidence, isTTY: true, colabHuman: false, answeredBy: null, reason: null });
  assert.strictEqual(selfOk.ok, true, 'self has no falsifier — the same evidence must not block it');
});

test('gateVerdict: a falsifier-contradicted "none" clears with --reason, regardless of direction', () => {
  const evidence = { versionTags: ['v1.0.0'], deployPaths: [] };
  const v = gateVerdict({ exposure: 'none', currentExposure: null, shapeCtx: okShapeCtx, evidence, isTTY: true, colabHuman: false, answeredBy: null, reason: 'the tag predates a rewrite' });
  assert.strictEqual(v.ok, true);
});

test('EXPOSURE_RANK orders released > live > self > none', () => {
  assert.ok(EXPOSURE_RANK.released > EXPOSURE_RANK.live);
  assert.ok(EXPOSURE_RANK.live > EXPOSURE_RANK.self);
  assert.ok(EXPOSURE_RANK.self > EXPOSURE_RANK.none);
});

test('EXIT_CODE matches the documented scheme: 3 human-gated, 4 evidence-contradicts, 5 repo-shape', () => {
  assert.strictEqual(EXIT_CODE[GATE_CLASS.HUMAN_GATED], 3);
  assert.strictEqual(EXIT_CODE[GATE_CLASS.EVIDENCE_CONTRADICTS], 4);
  assert.strictEqual(EXIT_CODE[GATE_CLASS.REPO_SHAPE], 5);
});

// =========================================================================================
// commit 2 — provenanceComment / renderDescriptor (append-only)
// =========================================================================================

test('provenanceComment: interactive mode names the host and date, not a flag', () => {
  const c = provenanceComment('exposure', { mode: 'interactive', host: 'build-box-01', date: '2026-08-11' });
  assert.strictEqual(c, '# exposure: answered interactively (build-box-01, 2026-08-11)');
});

test('#369 provenanceComment: interactive mode with no nameable host keeps the date and drops the host', () => {
  const c = provenanceComment('exposure', { mode: 'interactive', host: null, date: '2026-08-11' });
  assert.strictEqual(c, '# exposure: answered interactively (2026-08-11)');
});

test('provenanceComment: flag mode names the flag(s), and COLAB_HUMAN/--answered-by when present', () => {
  const c = provenanceComment('exposure', { mode: 'flag', flags: ['--exposure'], date: '2026-08-11', colabHuman: true, answeredBy: 'Alex' });
  assert.strictEqual(c, '# exposure: supplied by --exposure, COLAB_HUMAN=1, --answered-by "Alex" (2026-08-11)');
});

test('provenanceComment: flag mode omits COLAB_HUMAN/--answered-by when not part of the story (a raising exposure answer, or any non-exposure row)', () => {
  const c = provenanceComment('room', { mode: 'flag', flags: ['--room'], date: '2026-08-11', colabHuman: false, answeredBy: null });
  assert.strictEqual(c, '# room: supplied by --room (2026-08-11)');
});

test('renderDescriptor: a fresh file (null) is just the entries, nothing prepended', () => {
  const text = renderDescriptor(null, [{ key: 'room', value: 'solo' }]);
  assert.strictEqual(text, 'room: solo\n');
});

test('renderDescriptor: appends after existing content, adding a trailing newline first if missing — never touches an existing line', () => {
  const before = 'tier: B\ntrunk: main';
  const text = renderDescriptor(before, [{ key: 'room', value: 'solo', comment: '# room: answered interactively (host, date)' }]);
  assert.strictEqual(text, 'tier: B\ntrunk: main\nroom: solo\n# room: answered interactively (host, date)\n');
  assert.ok(text.startsWith(before), 'the original bytes must be a strict prefix of the result');
});

test('renderDescriptor: a list value renders as an inline flow sequence, parseable by this repo\'s own yaml.js', () => {
  const text = renderDescriptor('room: solo', [{ key: 'channels', value: ['workflow', 'artifact'] }]);
  assert.match(text, /channels: \[workflow, artifact\]/);
  const yaml = require('./yaml.js');
  assert.deepStrictEqual(yaml.parse(text).channels, ['workflow', 'artifact']);
});

test('renderDescriptor: a null value renders as the bare YAML null this repo\'s parser reads back as null', () => {
  const text = renderDescriptor('room: solo', [{ key: 'production', value: null }]);
  assert.match(text, /^production: null$/m);
  const yaml = require('./yaml.js');
  assert.strictEqual(yaml.parse(text).production, null);
});

test('renderDescriptor: multiple entries, each on its own line, in the order given', () => {
  const text = renderDescriptor(null, [
    { key: 'production', value: null, comment: '# c1' },
    { key: 'deploy', value: 'none', comment: '# c2' },
  ]);
  assert.strictEqual(text, 'production: null\n# c1\ndeploy: none\n# c2\n');
});

// --------------------------------------------------------------- #417 — the thin-shell CLAUDE.md

test('renderClaudeShell: first line @AGENTS.md, stamp/trunk/tier filled, no placeholder or paste note left', () => {
  const { renderClaudeShell } = require('./adopt.js');
  const tmpl = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'templates', 'repo-CLAUDE-block.md'), 'utf8');
  const out = renderClaudeShell(tmpl, { version: 'v1.2.3', trunk: 'dev', tier: 'A' });
  assert.strictEqual(out.split('\n')[0], '@AGENTS.md');
  assert.match(out, /<!-- colab-handbook @ v1\.2\.3 -->/);
  assert.match(out, /\*\*Trunk:\*\* `dev`/);
  assert.match(out, /\*\*Tier:\*\* `A` — a tag deploys/);
  assert.doesNotMatch(out, /<version>|<dev\|main>|<A\|B\|C>|Paste this|Delete this line/);
  assert.ok(require('./instruction-file.js').isThinShell(out));
  assert.ok(require('./stamp.js').parseClaudeStamp(out), 'the stamp must stay readable by the audit');
});

test('renderClaudeShell: a null tier leaves the placeholder for a human, never a guess', () => {
  const { renderClaudeShell } = require('./adopt.js');
  const out = renderClaudeShell('## Conventions\n\n- **Tier:** `<A|B|C>` — <A = x · C = y · B = z>\n', { version: 'v1', trunk: 'main', tier: null });
  assert.match(out, /`<A\|B\|C>`/);
});

test('#483: detectInheritedCodeowners names a fork\'s foreign-org teams, and only on a fork', () => {
  const { detectInheritedCodeowners } = require('./adopt.js');
  const files = { '.github/CODEOWNERS': '* @upstream-org/maintainers\n/ops/ @acme/ops\n' };
  const io = { readFile: (p) => (p in files ? files[p] : null) };
  const fork = { remote: 'upstream', url: 'https://example.invalid/upstream-org/app.git', source: 'upstream-remote' };
  assert.deepStrictEqual(detectInheritedCodeowners(io, fork, 'acme'),
    { path: '.github/CODEOWNERS', ownOrg: 'acme', teams: ['@upstream-org/maintainers'] });
  assert.strictEqual(detectInheritedCodeowners(io, null, 'acme'), null);
  assert.strictEqual(detectInheritedCodeowners(io, fork, null), null);
  assert.strictEqual(detectInheritedCodeowners({ readFile: () => null }, fork, 'acme'), null);
  assert.strictEqual(detectInheritedCodeowners({ readFile: () => '* @acme/core\n' }, fork, 'acme'), null);
});

// ---------------------------------------------------------------------- #533 / #522 — asked rows, human command

test('#533 axesToAsk: a fresh repo asks only the gating rows', () => {
  const adopt = require('./adopt.js');
  assert.deepStrictEqual(adopt.axesToAsk({}, [], []), ['tier', 'exposure']);
});

test('#533 axesToAsk: an optional row is asked when forced (--axis) or flagged, never otherwise', () => {
  const adopt = require('./adopt.js');
  assert.deepStrictEqual(adopt.axesToAsk({}, new Set(['channels']), new Set(['room'])), ['tier', 'room', 'exposure', 'channels']);
  const full = { production: null, deploy: 'none', exposure: 'self' };
  assert.deepStrictEqual(adopt.axesToAsk(full, [], []), []);
  assert.deepStrictEqual(adopt.axesToAsk(full, ['exposure'], []), ['exposure']); // forced re-answer still works
});

test('#533 optionalUnanswered / optionalRowsLine: names only the missing optional rows, with the --axis command', () => {
  const adopt = require('./adopt.js');
  assert.deepStrictEqual(adopt.optionalUnanswered({ room: 'solo' }), ['writes', 'channels']);
  assert.strictEqual(adopt.optionalRowsLine([]), null);
  assert.match(adopt.optionalRowsLine(['writes', 'channels']), /writes, channels — answer later with `colab adopt --axis writes,channels`/);
});

test('#522 humanAdoptCommand: one pasteable line, quoted only where needed, --answered-by placeholder when absent', () => {
  const adopt = require('./adopt.js');
  assert.strictEqual(
    adopt.humanAdoptCommand([['--production', 'none'], ['--deploy', 'none'], ['--exposure', 'none'], ['--stack', 'node app']]),
    'COLAB_HUMAN=1 colab adopt --production none --deploy none --exposure none --stack "node app" --answered-by "<your name>"',
  );
  assert.strictEqual(adopt.humanAdoptCommand([['--exposure', 'self'], ['--answered-by', 'ana'], ['--land', true]]),
    'COLAB_HUMAN=1 colab adopt --exposure self --answered-by ana --land');
});
