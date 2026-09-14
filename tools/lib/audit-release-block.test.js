'use strict';
/**
 * Tests for the audit's `release:` block validation (audit/audit.mjs) — issue #337.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Real descriptors through the real audit, so the parser half (the one nested map the audit's
 * narrow reader accepts) and the validation half (tools/lib/release-policy.js) are pinned
 * together. The oracle the issue names:
 *
 *   - default: no block at all → no release finding;
 *   - narrowing: `final: human` on a no-production released repo → allowed;
 *   - widening: `final: auto` on `deploy: tag` → fails.
 *
 * Plus: `candidates: auto` on `exposure: self` fails, and a nested map under any other key — or
 * a second level under `release:` — is still a parse finding.
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

function fixture(projectYml, extraFiles = {}, tags = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-release-block-'));
  TMP.push(dir);
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
  for (const t of tags) g('tag', t);
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

const hasText = (list, rx) => list.some((t) => rx.test(t));
const all = (r) => [...r.fails, ...r.warns];

// This repo's own shape: released, no production, adopters install from tags.
const RELEASED_NO_PROD = 'trunk: main\nproduction: null\ndeploy: none\nstack: docs\nexposure: released\nchannels: [artifact]\n';
// Released, the tag deploys production.
const RELEASED_TAG = 'trunk: main\nproduction: https://app.example.com\ndeploy: tag\nstack: node\nexposure: released\n';
const DEPLOY_WF = { '.github/workflows/deploy-prod.yml': 'on:\n  push:\n    tags: ["v*.*.*", "!v*.*.*-*"]\njobs: {}\n' };

test('default: a descriptor with no release: block has no release finding', () => {
  const r = audit(fixture(RELEASED_NO_PROD));
  assert.ok(!hasText(all(r), /release[.:]/), all(r).join(' | '));
});

test('narrowing: final: human on a no-production released repo is allowed', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  candidates: auto   # keep\n  test-period: 5d\n  final: human\n`));
  assert.ok(!hasText(all(r), /release[.:]|nested|takes one level/), all(r).join(' | '));
});

test('widening: final: auto on deploy: tag fails', () => {
  const r = audit(fixture(`${RELEASED_TAG}release:\n  final: auto\n`, DEPLOY_WF));
  assert.ok(hasText(r.fails, /release\.final: auto widens the release rung — on exposure: released/), r.fails.join(' | '));
});

test('widening: candidates: auto on exposure: self fails', () => {
  const r = audit(fixture('trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\nrelease:\n  candidates: auto\n'));
  assert.ok(hasText(r.fails, /release\.candidates: auto widens the release rung — on exposure: self/), r.fails.join(' | '));
});

test('widening: a test period below 3d fails', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  test-period: 2d\n`));
  assert.ok(hasText(r.fails, /release\.test-period: 2d widens/), r.fails.join(' | '));
});

test('an unknown release sub-key fails', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  major: auto\n`));
  assert.ok(hasText(r.fails, /release\.major is not a release: key/), r.fails.join(' | '));
});

test('parser: a second level under release: is a parse finding', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  final:\n    when: later\n`));
  assert.ok(hasText(r.fails, /"release:" takes one level of "key: scalar" pairs/), r.fails.join(' | '));
});

test('parser: a list under release: is a parse finding', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  - auto\n`));
  assert.ok(hasText(r.fails, /nested\/indented YAML is not supported|takes one level/), r.fails.join(' | '));
});

test('parser: a nested map under any other key is still a parse finding', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}autonomy:\n  mode: auto-trunk\n`));
  assert.ok(hasText(r.fails, /nested\/indented YAML is not supported by this reader/), r.fails.join(' | '));
});

test('parser: a key after the block is read as a top-level key again', () => {
  const r = audit(fixture(`trunk: main\nproduction: null\ndeploy: none\nrelease:\n  final: human\nstack: docs\nexposure: released\nchannels: [artifact]\n`));
  assert.ok(!hasText(r.fails, /missing key|nested|takes one level|release[.:]/), r.fails.join(' | '));
});
