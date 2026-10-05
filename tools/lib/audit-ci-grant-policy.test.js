'use strict';
/**
 * Tests for the audit's `ci-grant:` policy key (audit/audit.mjs) — issue #504.
 *
 * Real descriptors through the real audit. Absent and `human` are clean and report `human`;
 * `reviewer` is reported and clean; anything else fails, because the reader falls back to `human`
 * silently.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ci-grant-'));
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
    ciGrant: r.ciGrant,
    trustHumans: r.trustHumans,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
const mentions = (r) => [...r.fails, ...r.warns].filter((t) => /ci-grant/.test(t));

for (const [yml, want] of [['', 'human'], ['ci-grant: human\n', 'human'], ['ci-grant: reviewer\n', 'reviewer']]) {
  test(`ci-grant ${yml.trim() || 'absent'} → reported as ${want}, no finding`, () => {
    const r = audit(fixture(BASE + yml));
    assert.strictEqual(r.ciGrant, want);
    assert.deepStrictEqual(mentions(r), []);
  });
}

test('ci-grant: an unknown value fails and is read as human', () => {
  const r = audit(fixture(`${BASE}ci-grant: agent\n`));
  assert.strictEqual(r.ciGrant, 'human');
  assert.ok(r.fails.some((t) => /ci-grant is "agent"/.test(t)), r.fails.join(' | '));
});

