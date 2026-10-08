'use strict';
/**
 * The audit's `ci-wait-factor:` validation (audit/audit.mjs) — issue #559. Real descriptors
 * through the real audit: absent or a number ≥ 1 passes; anything else fails.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const AUDIT = path.join(path.resolve(__dirname, '..', '..'), 'audit', 'audit.mjs');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function audit(projectYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ci-wait-factor-'));
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
  let stdout;
  try { stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (err) { stdout = err.stdout || ''; }
  const r = JSON.parse(stdout).results[0];
  return r.findings.map((f) => `${f.level}: ${f.text}`);
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';

test('ci-wait-factor absent, empty or a number ≥ 1 carries no finding', () => {
  for (const extra of ['', 'ci-wait-factor:\n', 'ci-wait-factor: 1\n', 'ci-wait-factor: 2.5\n', 'ci-wait-factor: "3"\n']) {
    const f = audit(BASE + extra);
    assert.ok(!f.some((t) => /ci-wait-factor/.test(t)), `${JSON.stringify(extra)}: ${f.join(' | ')}`);
  }
});

test('every malformed ci-wait-factor fails', () => {
  for (const v of ['0', '0.5', '-1', '2x', 'two', 'true', '[2]']) {
    const f = audit(`${BASE}ci-wait-factor: ${v}\n`);
    assert.ok(f.some((t) => /^fail: ci-wait-factor must be a number ≥ 1/.test(t)), `${v}: ${f.join(' | ')}`);
  }
});
