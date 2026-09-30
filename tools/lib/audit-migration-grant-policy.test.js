'use strict';
/**
 * Tests for the audit's `migration-grant:` policy key (audit/audit.mjs) — issue #398.
 *
 * Real descriptors through the real audit. Absent and `human` are clean and report `human`;
 * `reviewer` is reported and clean (colab ship honours it under P+M+HEAD+R, #401); anything else
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
    trustHumans: r.trustHumans,
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

test('migration-grant: reviewer → reported and clean — ship honours it now (#401)', () => {
  const r = audit(fixture(`${BASE}migration-grant: reviewer\n`));
  assert.strictEqual(r.migrationGrant, 'reviewer');
  assert.deepStrictEqual(mentions(r), []);
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

// --- #407: the `trust-humans` list, read through tools/lib/trust-humans.js ------------------

const trustMentions = (r) => [...r.fails, ...r.warns].filter((t) => /trust-humans/.test(t));

test('trust-humans absent → reported as null, no finding', () => {
  const r = audit(fixture(BASE));
  assert.strictEqual(r.trustHumans, null);
  assert.deepStrictEqual(trustMentions(r), []);
});

test('trust-humans: a valid list → reported lowercased, no finding', () => {
  const r = audit(fixture(`${BASE}trust-humans:\n  - Operator-A\n  - second-human\n`));
  assert.deepStrictEqual(r.trustHumans, ['operator-a', 'second-human']);
  assert.deepStrictEqual(trustMentions(r), []);
});

test('trust-humans: every malformed shape fails — the reader treats nobody as human', () => {
  for (const v of ['trust-humans: operator-a', 'trust-humans: []', 'trust-humans: [not a login]', 'trust-humans: [ok, -bad]']) {
    const r = audit(fixture(`${BASE}${v}\n`));
    assert.strictEqual(r.trustHumans, null, v);
    assert.ok(r.fails.some((t) => /^trust-humans .*nobody is human/.test(t)), `${v}: ${r.fails.join(' | ')}`);
  }
});
