'use strict';
/**
 * Tests for the audit's `gate:` block (audit/audit.mjs) — issue #410.
 *
 * Absent is clean and reported as null; a valid block is reported; an invalid one fails (the reader
 * falls back to the local full gate, so it silently does nothing); `authoritative: ci` with no
 * workflow firing on a feature-branch push warns. Same fixture shape as audit-live-env.test.js.
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

function fixture(projectYml, workflows = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-gate-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  if (Object.keys(workflows).length) fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  for (const [name, text] of Object.entries(workflows)) fs.writeFileSync(path.join(dir, '.github', 'workflows', name), text);
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
    gate: r.gate,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
const mentions = (r) => [...r.fails, ...r.warns].filter((t) => /gate/.test(t) && !/gate-hermetic/.test(t));
const CI = 'gate:\n  smoke: npm run smoke\n  authoritative: ci\n';
const BRANCH_PUSH = { 'ci.yml': "name: ci\non:\n  push:\n    branches: ['**']\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n" };
const PR_ONLY = { 'ci.yml': "name: ci\non:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n" };

test('gate absent → reported as null, no finding', () => {
  const r = audit(fixture(BASE));
  assert.strictEqual(r.gate, null);
  assert.deepStrictEqual(mentions(r), []);
});

test('gate ci + a workflow firing on branch pushes → reported, no finding', () => {
  const r = audit(fixture(BASE + CI, BRANCH_PUSH));
  assert.deepStrictEqual(r.gate, { smoke: 'npm run smoke', authoritative: 'ci' });
  assert.deepStrictEqual(mentions(r), []);
});

test('gate ci + PR/trunk-only CI → warns that branch CI can never arrive', () => {
  const r = audit(fixture(BASE + CI, PR_ONLY));
  assert.deepStrictEqual(r.gate, { smoke: 'npm run smoke', authoritative: 'ci' });
  assert.ok(r.warns.some((t) => /^gate: authoritative ci/.test(t)), r.warns.join('\n'));
});

test('gate authoritative local → reported, no finding even without branch CI', () => {
  const r = audit(fixture(BASE + 'gate:\n  smoke: make check\n  authoritative: local\n'));
  assert.deepStrictEqual(r.gate, { smoke: 'make check', authoritative: 'local' });
  assert.deepStrictEqual(mentions(r), []);
});

test('invalid gate → fail, reported as null', () => {
  const r = audit(fixture(BASE + 'gate:\n  smoke: x\n  authoritative: nope\n'));
  assert.strictEqual(r.gate, null);
  assert.ok(r.fails.some((t) => /gate\.authoritative/.test(t)), r.fails.join('\n'));
});
