'use strict';
/**
 * Tests for the pre-release tag hazard check (audit/audit.mjs) — issue #332.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * GitHub's tag-filter glob `*` matches `-`, so a deploy workflow on `v*.*.*` or `v*` also fires on
 * `v1.2.0-rc.1`. Once release-candidate tags are cut automatically (#330), such a trigger deploys a
 * candidate to production. The audit probes every deploy workflow's push trigger with that tag,
 * honouring `!` negations in order the way GitHub does: `fail` under `deploy: tag`, `warn` elsewhere.
 *
 * Fixtures are real git repos, same shape as audit-tier-a-tag.test.js, so the audit runs end to end.
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

function fixture(projectYml, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-prerelease-tag-'));
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
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const HAZARD = /pre-release tag v1\.2\.0-rc\.1/;
const hazards = (list) => list.filter((t) => HAZARD.test(t));

// Tag-gated single-trunk `main` with its deploy job in CI — the shape #51 already accepts cleanly,
// so any hazard finding here is unambiguously the one under test.
const TAG_YML = 'tier: A\ntrunk: main\nproduction: https://example.invalid\ndeploy: tag\nstack: node\n';
// A push-main deploy repo (tier C shape) — the hazard there is reported, but only as a warning.
const PUSH_MAIN_YML = 'tier: C\ntrunk: main\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\n';

const wf = (onBlock, name = 'deploy-prod.yml') => ({ [`.github/workflows/${name}`]: `on:\n  push:\n${onBlock}jobs: {}\n` });

// --- the three fixtures the issue's "Done when" names ----------------------

test('deploy: tag + tags ["v*.*.*"] fails — `*` matches `-`', () => {
  const r = audit(fixture(TAG_YML, wf('    tags: ["v*.*.*"]\n')));
  const h = hazards(r.fails);
  assert.strictEqual(h.length, 1, `expected one hazard fail, got fails=${JSON.stringify(r.fails)}`);
  assert.match(h[0], /deploy-prod\.yml/);
  assert.match(h[0], /v\*\.\*\.\*/);
  assert.match(h[0], /!v\*\.\*\.\*-\*/, 'the finding names the fix');
  assert.strictEqual(hazards(r.warns).length, 0);
});

test('deploy: tag + tags ["v*.*.*", "!v*.*.*-*"] passes', () => {
  const r = audit(fixture(TAG_YML, wf('    tags: ["v*.*.*", "!v*.*.*-*"]\n')));
  assert.deepStrictEqual(hazards(r.fails), []);
  assert.deepStrictEqual(hazards(r.warns), []);
});

test('deploy: tag + tags ["v*"] fails', () => {
  const r = audit(fixture(TAG_YML, wf('    tags: ["v*"]\n')));
  assert.strictEqual(hazards(r.fails).length, 1, JSON.stringify(r.fails));
});

// --- GitHub's evaluation order and glob semantics --------------------------

test('block-form list with the exclusion passes', () => {
  const r = audit(fixture(TAG_YML, wf('    tags:\n      - "v*.*.*"\n      - "!v*.*.*-*"\n')));
  assert.deepStrictEqual(hazards(r.fails), []);
});

test('a later positive pattern re-includes what a `!` excluded — fails', () => {
  const r = audit(fixture(TAG_YML, wf('    tags: ["v*.*.*", "!v*.*.*-*", "v*-rc.*"]\n')));
  assert.strictEqual(hazards(r.fails).length, 1, JSON.stringify(r.fails));
});

test('a strict pattern that cannot match `-` passes (v[0-9]+.[0-9]+.[0-9]+)', () => {
  const r = audit(fixture(TAG_YML, wf('    tags: ["v[0-9]+.[0-9]+.[0-9]+"]\n')));
  assert.deepStrictEqual(hazards(r.fails), []);
});

test('tags-ignore that does not exclude pre-releases fails; one that does passes', () => {
  const bad = audit(fixture(TAG_YML, wf('    tags-ignore: ["legacy-*"]\n')));
  assert.strictEqual(hazards(bad.fails).length, 1, JSON.stringify(bad.fails));
  const good = audit(fixture(TAG_YML, wf('    tags-ignore: ["*-*"]\n')));
  assert.deepStrictEqual(hazards(good.fails), []);
});

test('a branches-only deploy trigger never fires on a tag — no finding', () => {
  const r = audit(fixture(PUSH_MAIN_YML, wf('    branches: [main]\n')));
  assert.deepStrictEqual(hazards(r.fails), []);
  assert.deepStrictEqual(hazards(r.warns), []);
});

// --- severity and scope ----------------------------------------------------

test('without deploy: tag the same hazard is a warn, not a fail', () => {
  const r = audit(fixture(PUSH_MAIN_YML, wf('    branches: [main]\n    tags: ["v*.*.*"]\n')));
  assert.deepStrictEqual(hazards(r.fails), []);
  assert.strictEqual(hazards(r.warns).length, 1, JSON.stringify(r.warns));
});

test('an unfiltered push on a deploy workflow fires on every tag — reported', () => {
  const r = audit(fixture(PUSH_MAIN_YML, { '.github/workflows/deploy-prod.yml': 'on: push\njobs: {}\n' }));
  assert.strictEqual(hazards(r.warns).length, 1, JSON.stringify(r.warns));
  assert.match(hazards(r.warns)[0], /unfiltered push/);
});

test('deploy: tag — a tag-filtered workflow not named deploy-* is still in scope', () => {
  const files = { ...wf('    tags: ["v*.*.*", "!v*.*.*-*"]\n'), ...wf('    tags: ["v*"]\n', 'ship.yml') };
  const r = audit(fixture(TAG_YML, files));
  const h = hazards(r.fails);
  assert.strictEqual(h.length, 1, JSON.stringify(r.fails));
  assert.match(h[0], /ship\.yml/);
});

test('without deploy: tag, a non-deploy workflow on v* is out of scope', () => {
  const files = { ...wf('    branches: [main]\n'), ...wf('    tags: ["v*"]\n', 'release-tag.yml') };
  const r = audit(fixture(PUSH_MAIN_YML, files));
  assert.deepStrictEqual(hazards(r.warns), []);
  assert.deepStrictEqual(hazards(r.fails), []);
});

// --- the handbook's own release-tag template (#346) ------------------------
//
// templates/release-tag.yml fires on `v*.*.*` ON PURPOSE (#333): a candidate publishes as a GitHub
// pre-release, and nothing deploys. Under `deploy: tag` the scope rule above would fail it, so a copy
// identified by provenance (stamp.js fingerprints, or its stamp) is exempt — unless it is deploy-named.

const RELEASE_TAG_TEMPLATE = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'release-tag.yml'), 'utf8');
const SAFE_DEPLOY = wf('    tags: ["v*.*.*", "!v*.*.*-*"]\n');

test('deploy: tag + a copied release-tag.yml on v*.*.* — no finding (#346)', () => {
  const r = audit(fixture(TAG_YML, { ...SAFE_DEPLOY, '.github/workflows/release.yml': RELEASE_TAG_TEMPLATE }));
  assert.deepStrictEqual(hazards(r.fails), []);
  assert.deepStrictEqual(hazards(r.warns), []);
});

test('deploy: tag + a STAMPED release-tag copy with its header stripped — still exempt (#346)', () => {
  const stripped = RELEASE_TAG_TEMPLATE.split('\n').filter((l) => !/TEMPLATE\. Copy me/.test(l)).join('\n');
  const body = `# colab-handbook: release-tag @ v1.0.0\n${stripped}`;
  const r = audit(fixture(TAG_YML, { ...SAFE_DEPLOY, '.github/workflows/release.yml': body }));
  assert.deepStrictEqual(hazards(r.fails), []);
});

test('deploy: tag + the same template text in deploy-prod.yml — still fails (guardrail, #346)', () => {
  const r = audit(fixture(TAG_YML, { '.github/workflows/deploy-prod.yml': RELEASE_TAG_TEMPLATE }));
  const h = hazards(r.fails);
  assert.strictEqual(h.length, 1, JSON.stringify(r.fails));
  assert.match(h[0], /deploy-prod\.yml/);
});

test('deploy: tag + a hand-written release.yml on v*.*.* (name only, no provenance) — still fails (#346)', () => {
  const r = audit(fixture(TAG_YML, { ...SAFE_DEPLOY, ...wf('    tags: ["v*.*.*"]\n', 'release.yml') }));
  const h = hazards(r.fails);
  assert.strictEqual(h.length, 1, JSON.stringify(r.fails));
  assert.match(h[0], /release\.yml/);
});

test('deploy: tag + a workflow stamped as a DIFFERENT template on v*.*.* — still fails (#346)', () => {
  const body = `# colab-handbook: ci-node @ v1.0.0\non:\n  push:\n    tags: ["v*.*.*"]\njobs: {}\n`;
  const r = audit(fixture(TAG_YML, { ...SAFE_DEPLOY, '.github/workflows/ship.yml': body }));
  assert.strictEqual(hazards(r.fails).length, 1, JSON.stringify(r.fails));
});
