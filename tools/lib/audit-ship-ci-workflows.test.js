'use strict';
/**
 * Tests for the audit's `ship-gate-workflows:` / `ship-ignore-workflows:` keys (audit/audit.mjs) —
 * issue #503. Absent is clean and reported as null; a list of names is clean and reported; anything
 * else fails — the reader ignores an invalid list and applies the default, so it does nothing.
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

function fixture(projectYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ship-ci-wf-'));
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
  } catch (err) { stdout = err.stdout || ''; }
  const r = JSON.parse(stdout).results[0];
  return {
    v: r.shipCiWorkflows,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text).filter((t) => /ship-(gate|ignore)-workflows/.test(t)),
  };
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';

test('#503 absent → null, no finding', () => {
  const r = audit(fixture(BASE));
  assert.strictEqual(r.v, null);
  assert.deepStrictEqual(r.fails, []);
});

test('#503 declared lists → reported, no finding', () => {
  const r = audit(fixture(BASE + 'ship-gate-workflows: [CI]\nship-ignore-workflows: [Deploy, Release (auto)]\n'));
  assert.deepStrictEqual(r.v, { gate: ['CI'], ignore: ['Deploy', 'Release (auto)'] });
  assert.deepStrictEqual(r.fails, []);
});

test('#503 an empty list fails', () => {
  const r = audit(fixture(BASE + 'ship-gate-workflows: []\n'));
  assert.strictEqual(r.fails.length, 1, JSON.stringify(r));
});
