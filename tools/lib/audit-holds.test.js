'use strict';
/**
 * Tests for the audit's `holds:` validation (audit/audit.mjs) — issue #360.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `holds` lists the labels a repo's scheduler treats as start holds, beyond the handbook's own
 * gates, so code-triage can report an issue carrying one as blocked instead of ready
 * (CONVENTIONS.md §5, Holds; project.schema.md "holds — optional"). The audit checks the shape
 * only. What is pinned here:
 *
 *   - omission, and an empty list, are clean (absent means none declared);
 *   - flow and block lists both parse, and a label name containing a colon survives;
 *   - a bare scalar is a finding naming the list shape — read as "no holds", it would let held
 *     work report ready;
 *   - an empty member is a finding;
 *   - a duplicate member is a finding pointing at the deduplicated form.
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

const BASE = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

function fixture(projectYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-holds-'));
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
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const holdsFindings = (r) => [...r.fails, ...r.warns].filter((t) => /\bholds\b/.test(t));

test('no holds key at all produces zero holds findings', () => {
  const r = audit(fixture(BASE));
  assert.deepStrictEqual(holdsFindings(r), []);
});

test('holds: [] is clean — an explicit "none declared"', () => {
  const r = audit(fixture(`${BASE}holds: []\n`));
  assert.deepStrictEqual(holdsFindings(r), []);
});

test('a flow list is clean, and a label name containing a colon survives the parse', () => {
  const r = audit(fixture(`${BASE}holds: [hold:manual, needs-rescope]\n`));
  assert.deepStrictEqual(holdsFindings(r), []);
});

test('a block list is clean', () => {
  const r = audit(fixture(`${BASE}holds:\n  - hold:manual\n  - needs-rescope\n`));
  assert.deepStrictEqual(holdsFindings(r), []);
});

test('a bare scalar is a finding naming the list shape', () => {
  const r = audit(fixture(`${BASE}holds: needs-rescope\n`));
  assert.ok(r.fails.some((t) => /holds is "needs-rescope".*expected a list/.test(t)), r.fails.join(' | '));
});

test('an empty member is a finding', () => {
  const r = audit(fixture(`${BASE}holds:\n  - needs-rescope\n  -\n`));
  assert.ok(r.fails.some((t) => /holds contains an empty or non-string member/.test(t)), r.fails.join(' | '));
});

test('a duplicate member is a finding pointing at the deduplicated form', () => {
  const r = audit(fixture(`${BASE}holds: [needs-rescope, needs-rescope]\n`));
  assert.ok(r.fails.some((t) => /holds contains a duplicate member.*list each label once.*\["needs-rescope"\]/.test(t)), r.fails.join(' | '));
});
