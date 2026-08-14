'use strict';
/**
 * Tests for #144's authority flip — the precedence ladder in `tools/lib/axis-authority.js`,
 * exercised through `audit/audit.mjs`.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * This file pins the acceptance oracle #144's plan lists, the parts not already covered by
 * audit-exposure.test.js (the enum + pairing-advisory shape) or by the fleet byte-diff run
 * outside the test suite (the primary oracle: every descriptor without `exposure` produces
 * IDENTICAL findings before and after this unit):
 *
 *   3. Matrix fixtures — exposure value x production null/named x deploy x workflow, both
 *      legal `released` shapes, and the transitional `none` + named production staying clean.
 *   4. The contradiction table — which (tier, exposure) pairs disagree, and which do not
 *      (including that `B` contradicts nothing).
 *   5. The legacy path reproduces tier-only behaviour for A, B and C with no `exposure` key.
 *   6. Neither key declared -> exactly one finding.
 *   7. Version arming — dormant at v1.x, active at v2, via a temp-clone-and-tag handbook.
 *
 * `exposure` does NOT become required in this unit (rule 1 of #144) — that stays phase 3's
 * job. This file never asserts an undeclared-exposure repo gains a NEW finding at today's
 * handbook version; only the version-arming tests below deliberately move that goalpost, on
 * a throwaway cloned handbook, never on the real one.
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

/**
 * A repo initialised on `main`, plus any extra branches, plus the given project.yml and
 * files. `checkout` leaves the working tree parked on that branch — needed for trunk-`dev`
 * fixtures, or the "main checkout is on trunk at rest" check fires on the fixture rather
 * than the check under test. `tag` adds a version-shaped git tag on HEAD, for the
 * `released` shape-2 fixtures.
 */
function fixture({ projectYml, extraBranches = [], files = {}, checkout = null, tag = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-authority-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  for (const b of extraBranches) g('branch', b);
  if (tag) g('tag', tag);
  if (checkout) g('checkout', '-q', checkout);
  return dir;
}

function audit(dir, handbookRoot = REPO_ROOT) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, COLAB_HANDBOOK: handbookRoot },
    });
  } catch (err) {
    stdout = err.stdout || '';
  }
  const r = JSON.parse(stdout).results[0];
  return {
    ok: r.ok,
    tier: r.tier,
    exposure: r.exposure,
    axisOfRecord: r.axisOfRecord,
    gates: r.gates,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));
const DEPLOY_WF = { '.github/workflows/deploy-prod.yml': 'on:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps: []\n' };

// --------------------------------------------------------------------------------
// 6. Neither key declared -> exactly one finding
// --------------------------------------------------------------------------------

test('neither tier nor exposure declared: exactly one finding, "no axis of record"', () => {
  const yml = `trunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const r = audit(fixture({ projectYml: yml }));
  assert.strictEqual(r.axisOfRecord, 'none');
  assert.strictEqual(r.fails.length, 1, r.fails.join(' | '));
  assert.ok(hasText(r.fails, /no axis of record/), r.fails.join(' | '));
  assert.strictEqual(r.warns.length, 0, r.warns.join(' | '));
});

test('`tier` left the required-key list — omitting only it (exposure present) is not itself a finding', () => {
  const yml = `trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: none\n`;
  const r = audit(fixture({ projectYml: yml }));
  assert.strictEqual(r.axisOfRecord, 'exposure');
  assert.ok(!hasText(r.fails, /missing key/), r.fails.join(' | '));
  assert.ok(!hasText(r.fails, /no axis of record/), r.fails.join(' | '));
});

// --------------------------------------------------------------------------------
// 5. Legacy path — no `exposure`, tier alone still governs, byte-identical shape
// --------------------------------------------------------------------------------

test('legacy tier: B, no exposure — clean, exactly as before #144', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const r = audit(fixture({ projectYml: yml }));
  assert.strictEqual(r.axisOfRecord, 'tier-legacy');
  assert.strictEqual(r.exposure, null);
  assert.deepStrictEqual(r.fails, []);
});

test('legacy tier: C, no exposure — clean when the C mechanism is satisfied, exactly as before #144', () => {
  const yml = `tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], files: DEPLOY_WF, checkout: 'dev' }));
  assert.strictEqual(r.axisOfRecord, 'tier-legacy');
  assert.ok(!hasText(r.fails, /tier C/), r.fails.join(' | '));
});

// #205: tier C's trunk check validates the two-branch SPLIT, not the "dev" spelling — a
// declared name other than "dev" is conforming, not a finding, as long as it is not "main"
// (the release branch the promotion deploys to).
test('#205: legacy tier: C with a NON-"dev" trunk name is clean, as long as it is not "main"', () => {
  const yml = `tier: C\ntrunk: develop\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['develop'], files: DEPLOY_WF, checkout: 'develop' }));
  assert.strictEqual(r.axisOfRecord, 'tier-legacy');
  assert.ok(!hasText(r.fails, /tier C/), r.fails.join(' | '));
});

test('#205: legacy tier: C with trunk "main" still fails — main is the release branch, collapsing the split', () => {
  const yml = `tier: C\ntrunk: main\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\n`;
  const r = audit(fixture({ projectYml: yml, files: DEPLOY_WF }));
  assert.ok(hasText(r.fails, /tier C requires trunk to be a branch distinct from "main"/), r.fails.join(' | '));
});

test('legacy tier: A, no exposure — clean when the A mechanism is satisfied, exactly as before #144', () => {
  const yml = `tier: A\ntrunk: dev\nproduction: https://example.invalid\ndeploy: tag\nstack: node\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], files: DEPLOY_WF, checkout: 'dev' }));
  assert.strictEqual(r.axisOfRecord, 'tier-legacy');
  assert.ok(!hasText(r.fails, /tier A/), r.fails.join(' | '));
});

test('legacy tier: C, no exposure, missing deploy workflow — the exact old message survives verbatim', () => {
  const yml = `tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], checkout: 'dev' }));
  assert.ok(hasText(r.fails, /^tier C but no \.github\/workflows\/deploy-\*\.yml — the path to production is not in the repo$/), r.fails.join(' | '));
});

// --------------------------------------------------------------------------------
// 4. Contradiction table — both keys declared
// --------------------------------------------------------------------------------

for (const exposure of ['live', 'none', 'self']) {
  test(`tier: A + exposure: ${exposure} disagree — exactly one contradiction fail`, () => {
    const yml = `tier: A\ntrunk: dev\nproduction: null\ndeploy: none\nstack: node\nexposure: ${exposure}\n`;
    const r = audit(fixture({ projectYml: yml }));
    assert.ok(hasText(r.fails, /tier: A and exposure: \w+ disagree/), r.fails.join(' | '));
  });
}

for (const exposure of ['released', 'none', 'self']) {
  test(`tier: C + exposure: ${exposure} disagree — exactly one contradiction fail`, () => {
    const yml = `tier: C\ntrunk: dev\nproduction: null\ndeploy: none\nstack: node\nexposure: ${exposure}\n`;
    const r = audit(fixture({ projectYml: yml }));
    assert.ok(hasText(r.fails, /tier: C and exposure: \w+ disagree/), r.fails.join(' | '));
  });
}

test('tier: A + exposure: released agree — no disagreement fail (mechanism still applies)', () => {
  const yml = `tier: A\ntrunk: dev\nproduction: https://example.invalid\ndeploy: tag\nstack: node\nexposure: released\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], files: DEPLOY_WF, checkout: 'dev' }));
  assert.ok(!hasText(r.fails, /disagree/), r.fails.join(' | '));
});

test('tier: C + exposure: live agree — no disagreement fail (mechanism still applies)', () => {
  const yml = `tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nexposure: live\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], files: DEPLOY_WF, checkout: 'dev' }));
  assert.ok(!hasText(r.fails, /disagree/), r.fails.join(' | '));
});

for (const exposure of ['none', 'self', 'live', 'released']) {
  test(`tier: B + exposure: ${exposure} — B contradicts nothing, no disagreement fail`, () => {
    const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: ${exposure}\n`;
    const r = audit(fixture({ projectYml: yml }));
    assert.ok(!hasText(r.fails, /disagree/), r.fails.join(' | '));
  });
}

test('tier: B + exposure: live yields no letter finding, only the mechanism finding (#144\'s plan, verbatim example)', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: live\n`;
  const r = audit(fixture({ projectYml: yml }));
  assert.ok(!hasText(r.fails, /disagree/), r.fails.join(' | '));
  // The mechanism finding: `live` requires a trunk distinct from "main", a production URL,
  // deploy: push-main and a deploy workflow, none of which this fixture has (trunk here is
  // "main" itself — #205: the check is the two-branch split, not the "dev" spelling).
  assert.ok(hasText(r.fails, /exposure: live requires trunk to be a branch distinct from "main"/), r.fails.join(' | '));
});

// --------------------------------------------------------------------------------
// 3. Matrix fixtures — the `exposure` contract, satisfied
// --------------------------------------------------------------------------------

test('exposure: self — no mechanism rule at all, any deploy/production/trunk shape is silent on this axis', () => {
  const yml = `trunk: main\nproduction: https://example.invalid\ndeploy: tag\nstack: node\nexposure: self\n`;
  const r = audit(fixture({ projectYml: yml }));
  assert.ok(!hasText(r.fails, /^exposure: self/), r.fails.join(' | '));
});

test('exposure: none — trunk main + no deploy workflow is clean', () => {
  const yml = `trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: none\n`;
  const r = audit(fixture({ projectYml: yml }));
  assert.deepStrictEqual(r.fails, []);
});

test('exposure: none — a deploy workflow present is a contradiction', () => {
  const yml = `trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: none\n`;
  const r = audit(fixture({ projectYml: yml, files: DEPLOY_WF }));
  assert.ok(hasText(r.fails, /exposure: none but a deploy workflow exists/), r.fails.join(' | '));
});

test('exposure: live — full mechanism satisfied (trunk dev, production, push-main, workflow) is clean', () => {
  const yml = `trunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nexposure: live\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], files: DEPLOY_WF, checkout: 'dev' }));
  assert.ok(!hasText(r.fails, /^exposure: live/), r.fails.join(' | '));
});

test('exposure: live — production set but no deploy workflow (no runbook: escape hatch)', () => {
  const yml = `trunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nexposure: live\nrunbook: docs/deploy.md\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], checkout: 'dev', files: { 'docs/deploy.md': 'x' } }));
  assert.ok(hasText(r.fails, /exposure: live but no \.github\/workflows\/deploy-\*\.yml/), r.fails.join(' | '));
});

test('exposure: released, shape 1 — production + committed deploy workflow is clean', () => {
  const yml = `trunk: dev\nproduction: https://example.invalid\ndeploy: tag\nstack: node\nexposure: released\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], files: DEPLOY_WF, checkout: 'dev' }));
  assert.ok(!hasText(r.fails, /^exposure: released/), r.fails.join(' | '));
});

test('exposure: released, shape 1 — production + deploy: manual needs a runbook, exactly like the old tier A', () => {
  const yml = `trunk: dev\nproduction: https://example.invalid\ndeploy: manual\nstack: node\nexposure: released\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], checkout: 'dev' }));
  assert.ok(hasText(r.fails, /deploy: manual requires runbook:/), r.fails.join(' | '));
});

test('exposure: released, shape 2 — production: null + a version-shaped tag is clean, no server required', () => {
  const yml = `trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: released\n`;
  const r = audit(fixture({ projectYml: yml, tag: 'v1.0.0' }));
  assert.ok(!hasText(r.fails, /^exposure: released/), r.fails.join(' | '));
});

test('exposure: released, shape 2 — production: null + channels: [artifact] is clean, no server required', () => {
  const yml = `trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: released\nchannels: [artifact]\n`;
  const r = audit(fixture({ projectYml: yml }));
  assert.ok(!hasText(r.fails, /^exposure: released/), r.fails.join(' | '));
});

test('exposure: released, neither shape — production: null, no tag, no channels: [artifact] — a WARN, never a fail (#144\'s plan: raising exposure is a direction an agent may propose)', () => {
  const yml = `trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: released\n`;
  const r = audit(fixture({ projectYml: yml }));
  assert.ok(!hasText(r.fails, /no evidence of a release artifact/), r.fails.join(' | '));
  assert.ok(hasText(r.warns, /no evidence of a release artifact/), r.warns.join(' | '));
  assert.strictEqual(r.ok, true, 'a warn must not flip ok to false');
});

// --------------------------------------------------------------------------------
// `--json` additive keys
// --------------------------------------------------------------------------------

test('`--json` reports axisOfRecord and gates as additive keys; `tier` stays the declared letter, never derived', () => {
  const yml = `tier: A\ntrunk: dev\nproduction: https://example.invalid\ndeploy: tag\nstack: node\nexposure: released\n`;
  const r = audit(fixture({ projectYml: yml, extraBranches: ['dev'], files: DEPLOY_WF, checkout: 'dev' }));
  assert.strictEqual(r.tier, 'A');
  assert.strictEqual(r.axisOfRecord, 'exposure');
  assert.strictEqual(r.gates, 2);
});

// --------------------------------------------------------------------------------
// 7. Version arming — dormant at v1.x, active at v2, on a throwaway cloned handbook
//
// No tag exists past the axis commits yet (#200, a human act, still pending) — real HEAD
// resolves to v1.9.0, which cannot exercise a v2 comparison. These three tests clone the
// handbook into a tmpdir and tag ITS HEAD synthetically (the identical throwaway-fixture
// pattern audit-adoption-window.test.js already established for the same reason), rather
// than mutating this repo's own tags. KNOWN THROWAWAY: once a real handbook tag exists on
// or past AUTHORITY_FLIP_VERSION, the "active" case here can run directly against
// REPO_ROOT and this clone-and-tag machinery can be deleted — simplify then, don't
// preserve it out of habit.
// --------------------------------------------------------------------------------

test('version arming: dormant on a handbook tagged v1.x — no new advisory on a legacy-path repo', () => {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-authority-clone-v1-'));
  TMP.push(clone);
  execFileSync('git', ['clone', '-q', '--no-hardlinks', REPO_ROOT, clone], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['-C', clone, 'tag', 'v1.99.0', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const r = audit(fixture({ projectYml: yml }), clone);
  assert.ok(!hasText(r.warns, /now read as a LEGACY value/), r.warns.join(' | '));
});

test('version arming: active on a handbook tagged v2.x — exactly one new advisory on a legacy-path repo', () => {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-authority-clone-v2-'));
  TMP.push(clone);
  execFileSync('git', ['clone', '-q', '--no-hardlinks', REPO_ROOT, clone], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['-C', clone, 'tag', 'v2.0.0', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const r = audit(fixture({ projectYml: yml }), clone);
  assert.ok(hasText(r.warns, /now read as a LEGACY value \(tier B -> exposure: null\)/), r.warns.join(' | '));
});

test('version arming: a repo that HAS declared exposure gets no nudge at v2 either — nothing to be nudged about', () => {
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-authority-clone-v2b-'));
  TMP.push(clone);
  execFileSync('git', ['clone', '-q', '--no-hardlinks', REPO_ROOT, clone], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['-C', clone, 'tag', 'v2.0.0', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n`;
  const r = audit(fixture({ projectYml: yml }), clone);
  assert.ok(!hasText(r.warns, /now read as a LEGACY value/), r.warns.join(' | '));
});
