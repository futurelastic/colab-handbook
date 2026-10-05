'use strict';
/**
 * Tests for the audit's `tree-reuse:` key (audit/audit.mjs) — issue #493.
 *
 * `tree-reuse: off` makes the CI guard run trunk's full suite even when a green run of the same
 * workflow already passed an identical tree. Absent is clean and reported as null; `off` is clean
 * and reported; anything else fails — the guard reads any tree-reuse line as off, so the repo is
 * safe, but a value nobody defined is not a declaration anyone can trust.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-tree-reuse-'));
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
    treeReuse: r.treeReuse,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
const mentions = (r) => [...r.fails, ...r.warns].filter((t) => /tree-reuse/.test(t));

test('tree-reuse absent → reported as null, no finding', () => {
  const r = audit(fixture(BASE));
  assert.strictEqual(r.treeReuse, null);
  assert.deepStrictEqual(mentions(r), []);
});

test('tree-reuse: off → reported, no finding', () => {
  const r = audit(fixture(`${BASE}tree-reuse: off\n`));
  assert.strictEqual(r.treeReuse, 'off');
  assert.deepStrictEqual(mentions(r), []);
});

test('every other tree-reuse value fails', () => {
  for (const v of ['on', 'true', 'none', 'Off']) {
    const r = audit(fixture(`${BASE}tree-reuse: ${v}\n`));
    assert.ok(r.fails.some((t) => /^tree-reuse is .* the only defined value is "off"/.test(t)), `${v}: ${r.fails.join(' | ')}`);
  }
});
