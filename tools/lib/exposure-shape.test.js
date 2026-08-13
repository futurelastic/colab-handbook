'use strict';
/**
 * Unit tests for tools/lib/exposure-shape.js — the ONE shared representation of the exposure
 * mechanism contract (#207), read by both `audit/audit.mjs`'s VALIDATOR and `tools/lib/adopt.js`'s
 * CONSTRUCTOR (`exposureShapeVerdict`, tested separately in `tools/lib/adopt.test.js`).
 *
 * REPLACES `tools/lib/adopt-audit-agreement.test.js` (deleted by this commit), which used to spawn
 * the real `audit/audit.mjs` against ~24 built git fixtures and assert its `ok` agreed with
 * `EXPOSURE_SHAPE`'s verdict for the identical shape — the guard against TWO implementations
 * drifting apart. That guard is now moot by construction: `exposureShapeVerdict` and the audit's
 * exposure-voiced block both call `evaluateExposure` from THIS module, so there is no second
 * implementation left to drift out of step with the first. What replaces it is testing the one
 * table that is now the actual source of truth — direct, no subprocess, no git fixture, and it
 * covers strictly more of the table's own branching (the off-enum catch-all, both `hasRunbook`
 * values on a `runbook`-kind entry) than the old fixture matrix touched, because none of that
 * requires standing up a repo on disk to exercise.
 *
 * The audit's own WIRING (does it call `checkRunbook` correctly, does it build `shapeCtx` right,
 * does a real descriptor still read clean/dirty as expected) is unaffected by this deletion — it
 * stays covered by `tools/lib/audit-authority.test.js` and `tools/lib/audit-exposure.test.js`,
 * which exercise the real `audit/audit.mjs` CLI against real fixtures and never depended on the
 * agreement test.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const { evaluateExposure } = require('./exposure-shape.js');

const kinds = (entries) => entries.map((e) => e.kind);

// --- self: no mechanism rule at all, ever -----------------------------------------------------

test('self: always zero entries, whatever the shape', () => {
  assert.deepStrictEqual(evaluateExposure('self', { trunk: 'whatever', hasProduction: true, deploy: 'anything', hasDeployWorkflow: true }), []);
  assert.deepStrictEqual(evaluateExposure('self', {}), []);
});

// --- none: trunk main, no deploy workflow ------------------------------------------------------

test('none: clean shape yields zero entries', () => {
  assert.deepStrictEqual(evaluateExposure('none', { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: false }), []);
});

test('none: wrong trunk is one fail entry, phrased for the audit\'s pinned regex', () => {
  const r = evaluateExposure('none', { trunk: 'dev', hasProduction: false, deploy: 'none', hasDeployWorkflow: false });
  assert.deepStrictEqual(kinds(r), ['fail']);
  assert.match(r[0].message, /exposure: none requires trunk "main"/);
});

test('none: a deploy workflow is one fail entry, workflow names appended when given', () => {
  const r = evaluateExposure('none', { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: true, deployWorkflowNames: ['deploy-prod.yml'] });
  assert.deepStrictEqual(kinds(r), ['fail']);
  assert.match(r[0].message, /exposure: none but a deploy workflow exists \(deploy-prod\.yml\)/);
});

test('none: workflow names are OPTIONAL — omitting them only drops the parenthetical, the entry still fires', () => {
  const r = evaluateExposure('none', { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: true });
  assert.match(r[0].message, /exposure: none but a deploy workflow exists — nothing/);
});

test('none: BOTH wrong at once is two independent fail entries, not one', () => {
  const r = evaluateExposure('none', { trunk: 'dev', hasProduction: false, deploy: 'push-main', hasDeployWorkflow: true });
  assert.deepStrictEqual(kinds(r), ['fail', 'fail']);
});

// --- live: trunk dev, production set, deploy push-main, a deploy workflow — all four -----------

test('live: fully satisfied shape yields zero entries', () => {
  const good = { trunk: 'dev', hasProduction: true, deploy: 'push-main', hasDeployWorkflow: true };
  assert.deepStrictEqual(evaluateExposure('live', good), []);
});

test('live: each of the four requirements fires its OWN entry, and the audit\'s pinned regexes still match', () => {
  const good = { trunk: 'dev', hasProduction: true, deploy: 'push-main', hasDeployWorkflow: true };
  const wrongTrunk = evaluateExposure('live', { ...good, trunk: 'main' });
  assert.deepStrictEqual(kinds(wrongTrunk), ['fail']);
  assert.match(wrongTrunk[0].message, /exposure: live requires trunk "dev"/);

  const noProduction = evaluateExposure('live', { ...good, hasProduction: false });
  assert.deepStrictEqual(kinds(noProduction), ['fail']);
  assert.match(noProduction[0].message, /exposure: live but production is null/);

  const wrongDeploy = evaluateExposure('live', { ...good, deploy: 'tag' });
  assert.deepStrictEqual(kinds(wrongDeploy), ['fail']);
  assert.match(wrongDeploy[0].message, /exposure: live requires deploy: push-main/);

  const noWorkflow = evaluateExposure('live', { ...good, hasDeployWorkflow: false });
  assert.deepStrictEqual(kinds(noWorkflow), ['fail']);
  assert.match(noWorkflow[0].message, /exposure: live but no \.github\/workflows\/deploy-\*\.yml/);
});

test('live: every requirement wrong at once is four independent entries', () => {
  const r = evaluateExposure('live', { trunk: 'main', hasProduction: false, deploy: 'tag', hasDeployWorkflow: false });
  assert.deepStrictEqual(kinds(r), ['fail', 'fail', 'fail', 'fail']);
});

// --- released, no production: trunk main, deploy none/null -------------------------------------

test('released (no production): trunk main + deploy none, or deploy null, both clean', () => {
  assert.deepStrictEqual(evaluateExposure('released', { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: false }), []);
  assert.deepStrictEqual(evaluateExposure('released', { trunk: 'main', hasProduction: false, deploy: null, hasDeployWorkflow: false }), []);
});

test('released (no production): wrong trunk and a live deploy value are independent fail entries', () => {
  const wrongTrunk = evaluateExposure('released', { trunk: 'dev', hasProduction: false, deploy: 'none', hasDeployWorkflow: false });
  assert.deepStrictEqual(kinds(wrongTrunk), ['fail']);

  const liveDeploy = evaluateExposure('released', { trunk: 'main', hasProduction: false, deploy: 'push-main', hasDeployWorkflow: false });
  assert.deepStrictEqual(kinds(liveDeploy), ['fail']);

  const both = evaluateExposure('released', { trunk: 'dev', hasProduction: false, deploy: 'tag', hasDeployWorkflow: false });
  assert.deepStrictEqual(kinds(both), ['fail', 'fail']);
});

// --- released, with production: deploy tag|manual, trunk dev (or main when deploy: tag) --------

test('released (with production): deploy tag + a committed workflow + trunk dev is clean', () => {
  const r = evaluateExposure('released', { trunk: 'dev', hasProduction: true, deploy: 'tag', hasDeployWorkflow: true });
  assert.deepStrictEqual(r, []);
});

test('released (with production): deploy tag + trunk main (the single-trunk tag-gated exemption) is clean', () => {
  const r = evaluateExposure('released', { trunk: 'main', hasProduction: true, deploy: 'tag', hasDeployWorkflow: true });
  assert.deepStrictEqual(r, []);
});

test('released (with production): deploy manual + trunk dev + a runbook entry is ALWAYS present — evaluateExposure never resolves hasRunbook itself', () => {
  // Whether the runbook entry BLOCKS is the caller's call (checkRunbook's own file read for the
  // validator; ctx.hasRunbook for the constructor) — the table always hands it back so each side
  // decides for itself, which is the whole reason this is a distinct entry kind from 'fail'.
  const withRunbook = evaluateExposure('released', { trunk: 'dev', hasProduction: true, deploy: 'manual', hasDeployWorkflow: false, hasRunbook: true });
  const withoutRunbook = evaluateExposure('released', { trunk: 'dev', hasProduction: true, deploy: 'manual', hasDeployWorkflow: false, hasRunbook: false });
  assert.deepStrictEqual(kinds(withRunbook), ['runbook']);
  assert.deepStrictEqual(kinds(withoutRunbook), ['runbook']);
  assert.strictEqual(withRunbook[0].why, 'exposure: released, deploy: manual');
  assert.match(withRunbook[0].message, /deploy: manual requires runbook:/);
});

test('released (with production): deploy tag with NO committed workflow is the external-GitOps-poller runbook shape', () => {
  const r = evaluateExposure('released', { trunk: 'dev', hasProduction: true, deploy: 'tag', hasDeployWorkflow: false });
  assert.deepStrictEqual(kinds(r), ['runbook']);
  assert.strictEqual(r[0].why, 'exposure: released, deploy: tag deployed outside CI (an external GitOps poller)');
});

test('released (with production): deploy manual, or the trunk main exemption for deploy: main (not tag), earns no runbook exemption', () => {
  const r = evaluateExposure('released', { trunk: 'main', hasProduction: true, deploy: 'manual', hasDeployWorkflow: false });
  assert.deepStrictEqual(kinds(r), ['runbook', 'fail']); // runbook needed AND trunk main has no exemption for deploy: manual
});

test('released (with production): deploy push-main is a fail — a deliberate release artifact is the whole point', () => {
  const r = evaluateExposure('released', { trunk: 'dev', hasProduction: true, deploy: 'push-main', hasDeployWorkflow: true });
  assert.deepStrictEqual(kinds(r), ['fail']);
  assert.match(r[0].message, /exposure: released with deploy: push-main/);
});

test('released (with production): deploy push-main with no workflow is TWO independent fails (push-main contradiction + no committed path)', () => {
  const r = evaluateExposure('released', { trunk: 'dev', hasProduction: true, deploy: 'push-main', hasDeployWorkflow: false });
  assert.deepStrictEqual(kinds(r), ['fail', 'fail']);
});

test('released (with production): deploy none, or deploy null, is a fail — contradictory with a live URL', () => {
  const none = evaluateExposure('released', { trunk: 'dev', hasProduction: true, deploy: 'none', hasDeployWorkflow: true });
  assert.match(none.find((e) => e.kind === 'fail').message, /deploy: none is contradictory/);

  const nullDeploy = evaluateExposure('released', { trunk: 'dev', hasProduction: true, deploy: null, hasDeployWorkflow: true });
  assert.ok(nullDeploy.some((e) => e.kind === 'fail' && /deploy: none is contradictory/.test(e.message)));
});

test('released (with production): trunk not dev, and not the deploy:tag+main exemption, is a fail', () => {
  const r = evaluateExposure('released', { trunk: 'feature-x', hasProduction: true, deploy: 'manual', hasDeployWorkflow: true });
  assert.ok(r.some((e) => e.kind === 'fail' && /exposure: released requires trunk "dev"/.test(e.message)));
});

test('released (with production): trunk not dev/main with deploy: tag phrases the "dev or main" variant', () => {
  const r = evaluateExposure('released', { trunk: 'feature-x', hasProduction: true, deploy: 'tag', hasDeployWorkflow: true });
  assert.ok(r.some((e) => e.kind === 'fail' && /exposure: released with deploy: tag requires trunk "dev" or "main"/.test(e.message)));
});

// --- the off-enum catch-all — dead on the validator side, load-bearing for the constructor ------
// (see the file banner: the constructor can be asked about an EXISTING, never-re-validated
// `deploy:`, which a hand-edited project.yml could set to anything).

test('released (with production): an off-enum deploy value is its own fail entry, distinct from every named-value fail', () => {
  const r = evaluateExposure('released', { trunk: 'dev', hasProduction: true, deploy: 'cargo', hasDeployWorkflow: true });
  const catchAll = r.find((e) => /exposure: released with a live production URL needs deploy: tag or deploy: manual/.test(e.message));
  assert.ok(catchAll, `expected the catch-all fail among: ${JSON.stringify(r)}`);
});

// --- default: an unrecognised exposure value (garbage — the audit's own comment: "already
// enum-validated ... | garbage") never throws or invents entries -------------------------------

test('an unrecognised exposure value returns zero entries — the enum-validity fail lives elsewhere (audit.mjs\'s earlier, unconditional check)', () => {
  assert.deepStrictEqual(evaluateExposure('pre-launch', { trunk: 'main', hasProduction: false, deploy: 'none', hasDeployWorkflow: false }), []);
  assert.deepStrictEqual(evaluateExposure(undefined, {}), []);
});
