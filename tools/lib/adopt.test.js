'use strict';
/**
 * Unit tests for tools/lib/adopt.js — both commits of #199 (detect/derive/report, PLUS
 * ask/gate/write). All scripted `io`, no real git/filesystem: `tools/lib/adopt-cli.test.js`
 * covers the real-repo path through `colab adopt` itself, and
 * `tools/lib/adopt-audit-agreement.test.js` covers `EXPOSURE_SHAPE` against the real audit.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  deriveTier, deriveConsequences, detectStack, detectChannelCandidates, remainingSteps, detect,
  QUESTIONS, axisMissing, ROW_NAMES, EXPOSURE_SHAPE, EXPOSURE_RANK, GATE_CLASS, EXIT_CODE,
  exposureShapeVerdict, gateVerdict, provenanceComment, renderDescriptor,
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

test('deriveConsequences: writes omitted defaults to isolated (schema default), CI is a gate', () => {
  const c = deriveConsequences({ exposure: null, writes: null, room: null });
  assert.strictEqual(c.writesResolved, 'isolated');
  assert.match(c.ciRole, /gate/);
  assert.match(c.branchMandatory, /mandatory — isolated/);
});

test('deriveConsequences: writes: serial makes CI an alarm and the branch optional', () => {
  const c = deriveConsequences({ exposure: null, writes: 'serial', room: null });
  assert.strictEqual(c.writesResolved, 'serial');
  assert.match(c.ciRole, /alarm/);
  assert.match(c.branchMandatory, /optional/);
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
  const c = provenanceComment('exposure', { mode: 'interactive', host: 'silvercube', date: '2026-08-11' });
  assert.strictEqual(c, '# exposure: answered interactively (silvercube, 2026-08-11)');
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
