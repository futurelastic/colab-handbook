'use strict';
/**
 * Tests for the audit's `exposure:` validation (audit/audit.mjs) — issue #132, re-keyed by
 * #144's authority flip.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `exposure` names what consumes a merge here. As of #144 it is the AXIS OF RECORD when
 * declared — it no longer merely rides alongside `tier`, it governs gate count outright
 * (`tools/lib/axis-authority.js`). What is pinned here, and what a future session must
 * DELETE rather than work around before changing it:
 *
 *   - omission behaves exactly like declaring nothing — no default, `exposure: null` in
 *     JSON, and zero exposure findings (the "lowering exposure is a human act" asymmetry:
 *     the tool cannot conclude "no consumers", only a human can write that down). With no
 *     `exposure`, `tier` is read as a LEGACY value instead — see audit-authority.test.js;
 *   - an unknown value is a finding, not a silent pass;
 *   - `exposure: none` + `production: null` is the ONE advisory this unit emits, and it
 *     is a warn, never a fail;
 *   - `exposure: none` + a NAMED `production` is CLEAN, no fail of any kind — the pinned
 *     "visibly transitional" read (CONVENTIONS.md §2, "Exposure") survives the flip
 *     unchanged: raising exposure is a direction an agent may propose, so the mechanism
 *     rules re-keyed onto `exposure` (#144) must never punish it;
 *   - `exposure: released` + `production: null` is CLEAN, provided the repo shows the
 *     OTHER legal evidence of a release (a version-shaped tag, or `channels: [artifact]`)
 *     — a tag-published repo with real adopters and no server is exactly this shape
 *     (#128 §2c, and this handbook's own descriptor), and a finding here would re-assert
 *     the "exposure means a server" defect the axis removes;
 *   - `exposure` IS now coupled to `tier` — DELIBERATELY, as of #144: when both are
 *     declared and disagree about gate count, that is exactly one `fail` naming the
 *     disagreement (see audit-authority.test.js for the contradiction table). The
 *     "non-coupling" pin this file used to carry (a `tier: A` + `exposure: self` fixture
 *     expected to produce nothing) was deleted for this reason — it pinned the PRE-flip
 *     behaviour this unit exists to change.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// `files` is an optional map of repo-relative path -> content, for fixtures that need more
// than a bare project.yml — e.g. a committed `.github/workflows/deploy-*.yml` to satisfy the
// `exposure: live` / `exposure: released` mechanism rules #144 re-keyed onto `deploy`.
function fixture(projectYml, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-exposure-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function audit(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    stdout = err.stdout || '';
  }
  const r = JSON.parse(stdout).results[0];
  return {
    ok: r.ok,
    exposure: r.exposure,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

// --- omission: the whole asymmetry lives here -----------------------------------

test('no exposure key at all reports exposure: null (undeclared, not "none") and zero exposure findings', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const r = audit(fixture(yml));
  assert.strictEqual(r.exposure, null);
  assert.ok(!hasText(r.fails, /exposure/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /exposure/), r.warns.join(' | '));
});

// --- the four plain values are quiet ----------------------------------------------

test('exposure: none + a non-null production is clean — the transitional read the axis legitimises', () => {
  const yml = `tier: B\ntrunk: main\nproduction: https://example.invalid\ndeploy: none\nstack: node\nexposure: none\n`;
  const r = audit(fixture(yml));
  assert.strictEqual(r.exposure, 'none');
  assert.ok(!hasText(r.fails, /exposure/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /exposure/), r.warns.join(' | '));
});

test('exposure: self + production: null is clean — the terminal read', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /exposure/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /exposure/), r.warns.join(' | '));
});

test('exposure: live + a real production URL + a committed deploy workflow is clean', () => {
  // #144: `live` is the contract now enforced directly off `exposure`, and it keeps tier
  // C's old no-runbook asymmetry — a deploy workflow must actually be committed, exactly
  // like a legacy tier: C repo needed one.
  const yml = `tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nexposure: live\n`;
  const r = audit(fixture(yml, { '.github/workflows/deploy-prod.yml': 'on:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps: []\n' }));
  assert.ok(!hasText(r.fails, /exposure/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /exposure/), r.warns.join(' | '));
});

test('exposure: released + production: null + channels: [artifact] is CLEAN — tag-published with real adopters and no server (#128 §2c, this handbook\'s own shape)', () => {
  // #144's "shape 2": no server at all, evidenced by channels: [artifact] (or, equally, a
  // version-shaped git tag) rather than a live production URL + deploy path ("shape 1").
  // This is the exact row #144's plan says the old tier: B weld could never express, and it
  // is this repo's own descriptor.
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: docs + copy-and-own CI templates\nexposure: released\nchannels: [artifact]\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /exposure/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /exposure/), r.warns.join(' | '));
});

// --- the one advisory this unit emits ---------------------------------------------

test('exposure: none + production: null is an advisory (warn), never a fail', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: none\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /exposure/), r.fails.join(' | '));
  assert.ok(hasText(r.warns, /exposure: none and production: null/), r.warns.join(' | '));
  assert.strictEqual(r.ok, true, 'a warn must not flip ok to false');
});

// --- unknown value ------------------------------------------------------------------

test('an unrecognised exposure value is a finding, not a silent pass', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: pre-launch\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /exposure is "pre-launch".*expected one of: none, self, live, released/), r.fails.join(' | '));
});

// --- the coupling table now lives in audit-authority.test.js -------------------------
//
// #144 deliberately COUPLES `exposure` to `tier` when both are declared and disagree about
// gate count: a `tier: A` + `exposure: self` fixture used to be pinned here as producing NO
// finding at all ("the non-coupling pin"). That pin described the PRE-flip behaviour this
// unit exists to change, so it is deleted rather than adjusted — see audit-authority.test.js
// for the contradiction table that replaces it (which pairs, and which stay silent).

// --- independence from other axes ----------------------------------------------------

test('exposure and writes are independent — an unrelated writes finding does not suppress an exposure finding, and vice versa', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: bogus\nexposure: bogus\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /writes is "bogus"/), r.fails.join(' | '));
  assert.ok(hasText(r.fails, /exposure is "bogus"/), r.fails.join(' | '));
});
