'use strict';
/**
 * Tests for the audit's `migration-grant:` policy key (audit/audit.mjs) — issue #398.
 *
 * Real descriptors through the real audit. Absent and `human` are clean and report `human`;
 * `reviewer` is reported and warns (no ship reader honours reviewer grants yet); anything else
 * fails, because the reader falls back to `human` silently. The list-shaped `migrations:` key next
 * to it is untouched — the policy is a separate flat key on purpose.
 *
 * Run: `node --test tools/lib/*.test.js`.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-migration-grant-'));
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
    migrationGrant: r.migrationGrant,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
const mentions = (r) => [...r.fails, ...r.warns].filter((t) => /migration-grant/.test(t));

test('migration-grant absent → reported as human, no finding', () => {
  const r = audit(fixture(BASE));
  assert.strictEqual(r.migrationGrant, 'human');
  assert.deepStrictEqual(mentions(r), []);
});

test('migration-grant: human → reported, no finding', () => {
  const r = audit(fixture(`${BASE}migration-grant: human\n`));
  assert.strictEqual(r.migrationGrant, 'human');
  assert.deepStrictEqual(mentions(r), []);
});

test('migration-grant: reviewer → reported, and warns that no ship reader honours it yet', () => {
  const r = audit(fixture(`${BASE}migration-grant: reviewer\n`));
  assert.strictEqual(r.migrationGrant, 'reviewer');
  assert.deepStrictEqual(r.fails.filter((t) => /migration-grant/.test(t)), []);
  assert.ok(r.warns.some((t) => /^migration-grant: reviewer declared — colab ship does not honour reviewer grants yet/.test(t)), r.warns.join(' | '));
});

test('every malformed migration-grant value fails and is reported as the fallback, human', () => {
  for (const v of ['Reviewer', 'yes', 'true', '[human]', '1']) {
    const r = audit(fixture(`${BASE}migration-grant: ${v}\n`));
    assert.strictEqual(r.migrationGrant, 'human', v);
    assert.ok(r.fails.some((t) => /^migration-grant is .*expected human \| reviewer/.test(t)), `${v}: ${r.fails.join(' | ')}`);
  }
});

test('the list-shaped migrations: key beside it is unaffected', () => {
  const r = audit(fixture(`${BASE}migrations: [backend/migrations/]\nmigration-grant: human\n`));
  assert.strictEqual(r.migrationGrant, 'human');
  assert.deepStrictEqual([...r.fails, ...r.warns].filter((t) => /^migrations/.test(t)), []);
});
