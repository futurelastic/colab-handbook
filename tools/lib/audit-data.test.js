'use strict';
/**
 * Tests for the audit's `data:` key (audit/audit.mjs) — issue #762.
 *
 * `data: none` exempts `colab ship`'s no-new-migrations gate while no sign of production is
 * present. Absent is clean and reported as null; `none`/`real` are clean and reported; anything
 * else fails (the gate reads it as absent, so it would silently do nothing); `data: none` beside a
 * falsifier in the same descriptor warns. Same fixture shape as audit-live-env.test.js.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-data-'));
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
    data: r.data,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
const mentions = (r) => [...r.fails, ...r.warns].filter((t) => /\bdata\b/.test(t));

test('data absent → reported as null, no finding', () => {
  const r = audit(fixture(BASE));
  assert.strictEqual(r.data, null);
  assert.deepStrictEqual(mentions(r), []);
});

test('data: none and data: real → reported, no finding', () => {
  for (const v of ['none', 'real']) {
    const r = audit(fixture(`${BASE}data: ${v}\n`));
    assert.strictEqual(r.data, v);
    assert.deepStrictEqual(mentions(r), [], v);
  }
});

test('a malformed data value fails', () => {
  const r = audit(fixture(`${BASE}data: empty\n`));
  assert.strictEqual(r.data, null);
  assert.strictEqual(r.fails.filter((t) => /data must be one of none \| real/.test(t)).length, 1);
});

test('data: none beside a falsifier warns that it no longer applies', () => {
  const r = audit(fixture(BASE.replace('exposure: self', 'exposure: live') + 'data: none\n'));
  assert.strictEqual(r.warns.filter((t) => /^data: none no longer applies — exposure live/.test(t)).length, 1);
});
