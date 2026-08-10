'use strict';
/**
 * Tests for the audit's `channels:` validation (audit/audit.mjs) — issue #151.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `channels` names every path by which a commit reaches something that RUNS it — a
 * different question from `deploy`, which names only the trigger that promotes to
 * production (epic #128 §2d). This unit is strictly additive: `deploy` stays
 * authoritative, and no rule anywhere reads `channels` to change a tier/trunk/deploy/
 * production finding. What is pinned here, and what a future session must DELETE rather
 * than work around before changing it:
 *
 *   - omission behaves exactly like declaring nothing — no default, `channels: null` in
 *     JSON, and zero channels findings (the "lowering — declaring absence — is a human
 *     act" asymmetry, identical to `exposure`'s: the tool cannot conclude "nothing runs
 *     this", only a human can write that down);
 *   - a bare scalar (not a list) is a finding naming the list shape;
 *   - an empty list is a finding — it is not an answer;
 *   - an unknown member is a finding, not a silent pass;
 *   - `["none", "workflow"]` (or any combination with "none") is a finding — "none" must
 *     stand alone;
 *   - a clean multi-member list (e.g. `[workflow, hook]`) is CLEAN — the whole reason this
 *     key is a list and not a scalar;
 *   - `channels: [none]` + a non-null `production` OR a non-`none` `deploy` is the ONE
 *     advisory this unit emits, and it is a warn, never a fail;
 *   - `channels` is NOT coupled to `exposure` in either direction — same non-coupling
 *     shape as `writes`/`exposure` (audit-writes.test.js, audit-exposure.test.js), for the
 *     same reason (CONVENTIONS.md §2, "Channels" and "Writes": "do not add one").
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

function fixture(projectYml, extraFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-channels-'));
  TMP.push(dir);
  // Checkout on whatever branch the descriptor declares as trunk, so a fixture built to
  // isolate the channels advisory does not also trip the unrelated "checkout is not on
  // trunk" / "declared trunk does not exist" checks.
  const trunkMatch = /trunk:\s*(\S+)/.exec(projectYml);
  const trunkBranch = trunkMatch ? trunkMatch[1] : 'main';
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', trunkBranch, '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  for (const [rel, content] of Object.entries(extraFiles)) {
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
    channels: r.channels,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

// --- omission: the whole asymmetry lives here -----------------------------------

test('no channels key at all reports channels: null (undeclared, not ["none"]) and zero channels findings', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const r = audit(fixture(yml));
  assert.strictEqual(r.channels, null);
  assert.ok(!hasText(r.fails, /channels/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /channels/), r.warns.join(' | '));
});

// --- shape: must be a list -------------------------------------------------------

test('a bare scalar channels value is a finding naming the list shape', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nchannels: workflow\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /channels is "workflow".*expected a list/), r.fails.join(' | '));
});

test('an empty channels list is a finding — it is not an answer', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nchannels: []\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /channels is an empty list/), r.fails.join(' | '));
});

// --- unknown member ---------------------------------------------------------------

test('an unrecognised channels member is a finding, not a silent pass', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nchannels: [magic]\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /channels contains \["magic"\].*expected members of/), r.fails.join(' | '));
});

// --- "none" exclusivity ------------------------------------------------------------

test('channels: [none, workflow] is a finding — "none" must stand alone', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nchannels: [none, workflow]\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /channels combines "none" with another value/), r.fails.join(' | '));
});

// --- clean cases: the reason this key is a list -------------------------------------

test('channels: [none] with production: null and deploy: none is clean', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nchannels: [none]\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /channels/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /channels/), r.warns.join(' | '));
});

test('a multi-member channels list is clean — the whole reason this key is a LIST, not a scalar', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nchannels: [workflow, hook, artifact]\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /channels/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /channels/), r.warns.join(' | '));
});

// --- the one advisory this unit emits ------------------------------------------------

test('channels: [none] + a non-null production is an advisory (warn), never a fail', () => {
  // tier A + deploy: manual so the production URL itself is legal (a bare tier-B repo
  // forbids production non-null outright, which would be a second, unrelated fail here) —
  // isolates the production half of the OR condition; a runbook is provided so deploy:
  // manual's own requirement is satisfied and does not itself produce a fail.
  const yml = `tier: A\ntrunk: dev\nproduction: https://example.invalid\ndeploy: manual\nrunbook: docs/deploy.md\nstack: node\nchannels: [none]\n`;
  const r = audit(fixture(yml, { 'docs/deploy.md': '# deploy\n' }));
  assert.ok(!hasText(r.fails, /channels/), r.fails.join(' | '));
  assert.ok(hasText(r.warns, /channels: \[none\] together with production:/), r.warns.join(' | '));
  assert.strictEqual(r.ok, true, 'a warn must not flip ok to false');
});

test('channels: [none] + a non-none deploy is an advisory (warn), never a fail', () => {
  // tier C requires production non-null and a deploy workflow to exist for push-main to be
  // legal on its own terms — both provided so this isolates the deploy half of the OR
  // condition without an unrelated tier/deploy-workflow fail.
  const yml = `tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nchannels: [none]\n`;
  const r = audit(fixture(yml, { '.github/workflows/deploy-main.yml': 'on: push\n' }));
  assert.ok(!hasText(r.fails, /channels/), r.fails.join(' | '));
  assert.ok(hasText(r.warns, /channels: \[none\] together with production:/), r.warns.join(' | '));
  assert.strictEqual(r.ok, true, 'a warn must not flip ok to false');
});

// --- the non-coupling pin — the whole point of this file -----------------------------

test('channels is NOT coupled to exposure — declaring both, or either alone, produces no cross-axis finding', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\nchannels: [artifact]\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /exposure/), r.fails.join(' | '));
  assert.ok(!hasText(r.fails, /channels/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /channels/), r.warns.join(' | '));
});

// --- independence from other axes ----------------------------------------------------

test('channels and writes are independent — an unrelated writes finding does not suppress a channels finding, and vice versa', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: bogus\nchannels: [bogus]\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /writes is "bogus"/), r.fails.join(' | '));
  assert.ok(hasText(r.fails, /channels contains \["bogus"\]/), r.fails.join(' | '));
});
