'use strict';
/**
 * Unit tests for tools/lib/adopt.js — commit 1 of #199 (detect / derive / report; no ask, no
 * write). All scripted `io`, no real git/filesystem: `tools/lib/adopt-cli.test.js` covers the
 * real-repo path through `colab adopt` itself.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  deriveTier, deriveConsequences, detectStack, detectChannelCandidates, remainingSteps, detect,
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
