'use strict';
/**
 * Tests for the audit's `exposure:` validation (audit/audit.mjs) — issue #132.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `exposure` names what consumes a merge here — the axis `tier`'s gate count will
 * eventually be DERIVED from (epic #128 axis 2). This unit is strictly additive: `tier`
 * stays authoritative, and no rule anywhere reads `exposure` to change a tier/trunk/
 * deploy/production finding. What is pinned here, and what a future session must DELETE
 * rather than work around before changing it:
 *
 *   - omission behaves exactly like declaring nothing — no default, `exposure: null` in
 *     JSON, and zero exposure findings (the "lowering exposure is a human act" asymmetry:
 *     the tool cannot conclude "no consumers", only a human can write that down);
 *   - an unknown value is a finding, not a silent pass;
 *   - `exposure: none` + `production: null` is the ONE advisory this unit emits, and it
 *     is a warn, never a fail;
 *   - `exposure: live`/`released` + `production: null` is CLEAN — a tag-published repo
 *     with real adopters and no server is exactly this shape (#128 §2c), and a finding
 *     here would re-assert the "exposure means a server" defect the axis removes;
 *   - `exposure` is NOT coupled to `tier` in either direction — same non-coupling pin as
 *     `writes` (audit-writes.test.js), for the same reason (CONVENTIONS.md §2, "Exposure"
 *     and "Writes": "do not add one").
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

function fixture(projectYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-exposure-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
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

test('exposure: live + a real production URL is clean', () => {
  const yml = `tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nexposure: live\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /exposure/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /exposure/), r.warns.join(' | '));
});

test('exposure: released + production: null is CLEAN — tag-published with real adopters and no server (#128 §2c)', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: docs + copy-and-own CI templates\nexposure: released\n`;
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

// --- the non-coupling pin — the whole point of this file -----------------------------

test('exposure is NOT coupled to tier — a tier: A repo with any exposure value produces no tier-related finding either way', () => {
  // exposure: self deliberately gets NO falsifier (#137: "self" claims a consumer set
  // bounded by the room, so a tag or a deploy path is compatible with it) — so this fixture
  // proves the non-coupling property cleanly, with no fixture-shaping needed to dodge the
  // falsifier/duration warns #137 later added on exposure: none.
  const yml = `tier: A\ntrunk: dev\nproduction: https://example.invalid\ndeploy: tag\nstack: node\nexposure: self\n`;
  const r = audit(fixture(yml));
  // exposure: self on a live, tagged tier-A repo is an unusual pairing in practice, but
  // nothing here may treat it as a tier/exposure mismatch — that coupling is explicitly
  // out of scope for this unit (CONVENTIONS.md §2 "Exposure": "do not add one"). Widened to
  // the union of fails AND warns (#192) — the pin previously guarded `fails` only, so a
  // coupling introduced at `warn` (the likelier shape, since this axis chose advisory over
  // failure for its own pairing rule) would have passed it untouched.
  const findings = [...r.fails, ...r.warns];
  assert.ok(!hasText(findings, /tier/i), findings.join(' | '));
  assert.ok(!hasText(findings, /exposure/), findings.join(' | '));
});

// --- independence from other axes ----------------------------------------------------

test('exposure and writes are independent — an unrelated writes finding does not suppress an exposure finding, and vice versa', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: bogus\nexposure: bogus\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /writes is "bogus"/), r.fails.join(' | '));
  assert.ok(hasText(r.fails, /exposure is "bogus"/), r.fails.join(' | '));
});
