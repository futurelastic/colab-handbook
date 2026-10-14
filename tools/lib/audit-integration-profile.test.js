'use strict';
/**
 * Tests for the audit's `integration-profile:` / `heavy-workflow:` validation (#610, audit/audit.mjs).
 * Real fixture repos through the real audit, like audit-integration.test.js: the values are read by
 * the audit's own YAML reader and by tools/lib/integration-profile.js, and the two must agree.
 * Run: `node --test tools/lib/audit-integration-profile.test.js`.
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
 * A tier B repo on `main`, plus any extra branches, plus the given project.yml body.
 * Deliberately minimal: every other audit rule must stay silent so a finding in the result is
 * unambiguously the one under test.
 */
function fixture(projectYml, extraBranches = [], files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-integration-profile-'));
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
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
    suggestions: r.suggestions || [],
  };
}

const TIER_B = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const LIVE = 'exposure: live\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\n';
const DEPLOY_WF = { '.github/workflows/deploy-x.yml': 'on:\n  push:\n    branches: [main]\njobs: {}\n' };
const HEAVY_WF = { '.github/workflows/ci-heavy.yml': 'name: CI (heavy)\non:\n  workflow_dispatch:\njobs: {}\n' };
const hasText = (list, rx) => list.some((t) => rx.test(t));
const profileFindings = (r) => r.fails.concat(r.warns).filter((t) => /integration-profile|heavy-workflow/.test(t));

test('no integration-profile: nothing new on an ordinary repo', () => {
  const r = audit(fixture(TIER_B));
  assert.deepStrictEqual(profileFindings(r), []);
  assert.ok(!hasText(r.suggestions, /integration-profile/));
});

test('each of the four values is accepted (promote on a dev trunk)', () => {
  for (const v of ['gated', 'qualify', 'release-heavy']) {
    const r = audit(fixture(TIER_B + `integration-profile: ${v}\n`, [], HEAVY_WF));
    assert.deepStrictEqual(profileFindings(r), [], v);
  }
  const r = audit(fixture(LIVE + 'integration-profile: promote\n', ['dev'], DEPLOY_WF));
  assert.deepStrictEqual(profileFindings(r), []);
});

test('a bad value fails — the gates would silently read it as release-heavy', () => {
  const r = audit(fixture(TIER_B + 'integration-profile: strict\n'));
  assert.ok(hasText(r.fails, /integration-profile is "strict", expected one of gated \| qualify \| release-heavy \| promote/), r.fails.join(' | '));
});

test('a bad heavy-workflow fails; a file name is accepted', () => {
  assert.ok(hasText(audit(fixture(TIER_B + 'heavy-workflow: CI (heavy)\n')).fails, /heavy-workflow is "CI \(heavy\)"/));
  assert.deepStrictEqual(profileFindings(audit(fixture(TIER_B + 'heavy-workflow: e2e.yml\n'))), []);
});

test('exposure live: a declared qualify or release-heavy fails; gated passes; tag deploy is exempt', () => {
  for (const v of ['qualify', 'release-heavy']) {
    const r = audit(fixture(LIVE + `integration-profile: ${v}\n`, ['dev'], DEPLOY_WF));
    assert.ok(hasText(r.fails, new RegExp(`integration-profile: ${v} on exposure: live with deploy: push-main`)), r.fails.join(' | '));
  }
  const gated = audit(fixture(LIVE + 'integration-profile: gated\n', ['dev'], { ...DEPLOY_WF, ...HEAVY_WF }));
  assert.deepStrictEqual(profileFindings(gated), []);
});

test('exposure live with no profile declared: a suggestion, never a new failure', () => {
  const r = audit(fixture(LIVE, ['dev'], DEPLOY_WF));
  assert.deepStrictEqual(profileFindings(r), []);
  assert.ok(hasText(r.suggestions, /consider declaring integration-profile: gated/), r.suggestions.join(' | '));
});

test('promote on a single-trunk main fails — there is no promotion to gate', () => {
  const r = audit(fixture(TIER_B + 'integration-profile: promote\n'));
  assert.ok(hasText(r.fails, /integration-profile: promote gates the promotion into main/), r.fails.join(' | '));
});

test('gated with no heavy workflow warns: ship would refuse every code landing', () => {
  const r = audit(fixture(TIER_B + 'integration-profile: gated\n'));
  assert.ok(hasText(r.warns, /integration-profile: gated but no \.github\/workflows\/ci-heavy\.yml/), r.warns.join(' | '));
  const named = audit(fixture(TIER_B + 'integration-profile: gated\nheavy-workflow: e2e.yml\n', [], { '.github/workflows/e2e.yml': 'on:\n  workflow_dispatch:\njobs: {}\n' }));
  assert.deepStrictEqual(profileFindings(named), []);
});
