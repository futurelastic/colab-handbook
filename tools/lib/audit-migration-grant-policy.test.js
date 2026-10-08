'use strict';
/**
 * Tests for the audit's `migration-grant:` policy key (audit/audit.mjs) — issue #398.
 *
 * Real descriptors through the real audit. Absent and `human` are clean and report `human`;
 * `reviewer` is reported and clean when a `Migration round-trip` job exists (colab ship honours it
 * under P+M+HEAD+R, #401) and warned without one (#494); anything else
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

function fixture(projectYml, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-migration-grant-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
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

const RT_JOB = 'name: CI\non:\n  push:\njobs:\n  migrations:\n    name: Migration round-trip (${{ matrix.engine }})\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n';

test('migration-grant: reviewer with a round-trip job → reported and clean — ship honours it (#401)', () => {
  const r = audit(fixture(`${BASE}migration-grant: reviewer\n`, { '.github/workflows/ci.yml': RT_JOB }));
  assert.strictEqual(r.migrationGrant, 'reviewer');
  assert.deepStrictEqual(mentions(r), []);
});

test('migration-grant: reviewer with no round-trip job → a warning naming the job, not a failure (#494)', () => {
  const r = audit(fixture(`${BASE}migration-grant: reviewer\n`));
  assert.strictEqual(r.migrationGrant, 'reviewer');
  assert.deepStrictEqual(r.fails.filter((t) => /migration-grant/.test(t)), []);
  assert.ok(r.warns.some((t) => /^migration-grant: reviewer, but no workflow .* "Migration round-trip" job/.test(t)), r.warns.join(' | '));
});

test('migration-grant: reviewer with the round-trip job only commented out → still the warning (#494)', () => {
  const commented = RT_JOB.split('\n').map((l, i) => (i >= 3 && l ? `# ${l}` : l)).join('\n');
  const r = audit(fixture(`${BASE}migration-grant: reviewer\n`, { '.github/workflows/ci.yml': commented }));
  assert.ok(r.warns.some((t) => /no workflow .* "Migration round-trip" job/.test(t)), r.warns.join(' | '));
});

test('migration-grant: human with no round-trip job → no warning (#494)', () => {
  const r = audit(fixture(`${BASE}migration-grant: human\n`));
  assert.deepStrictEqual(r.warns.filter((t) => /Migration round-trip/.test(t)), []);
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
