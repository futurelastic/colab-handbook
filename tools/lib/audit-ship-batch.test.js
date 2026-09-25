'use strict';
/**
 * Tests for the audit's `ship-batch:` validation (audit/audit.mjs) — issue #373.
 *
 * Real descriptors through the real audit. An integer 1–3 passes; every malformed value fails (ship
 * would fail closed to serial, silently); a batch nothing can grade — no workflow firing on
 * `ship-batch/**` — warns, and so does one without `autonomy: auto-trunk`, where it is inert.
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

function fixture(projectYml, extraFiles = {}, tags = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ship-batch-'));
  TMP.push(dir);
  const trunkMatch = /trunk:\s*(\S+)/.exec(projectYml);
  const trunkBranch = trunkMatch ? trunkMatch[1] : 'main';
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', trunkBranch, '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  for (const [rel, content] of Object.entries(extraFiles)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  for (const t of tags) g('tag', t);
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

const hasText = (list, rx) => list.some((t) => rx.test(t));
const all = (r) => [...r.fails, ...r.warns];

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\nautonomy: auto-trunk\n';
const WIRED = { '.github/workflows/ci.yml': "name: CI\non:\n  push:\n    branches: [main, 'ship-batch/**']\njobs: {}\n" };
const UNWIRED = { '.github/workflows/ci.yml': 'name: CI\non:\n  push:\n    branches: [main]\njobs: {}\n' };

test('ship-batch absent, 1, 2 and 3 carry no ship-batch finding', () => {
  for (const extra of ['', 'ship-batch: 1\n', 'ship-batch: 2\n', 'ship-batch: 3\n']) {
    const r = audit(fixture(BASE + extra, WIRED));
    assert.ok(!hasText(all(r), /ship-batch/), `${JSON.stringify(extra)}: ${all(r).join(' | ')}`);
  }
});

test('every malformed ship-batch value fails', () => {
  for (const v of ['0', '4', '2.5', 'two', 'true']) {
    const r = audit(fixture(`${BASE}ship-batch: ${v}\n`, WIRED));
    assert.ok(hasText(r.fails, /^ship-batch is .*expected an integer 1–3/), `${v}: ${r.fails.join(' | ')}`);
  }
});

test('ship-batch > 1 with no workflow firing on ship-batch/** warns that it will always go serial', () => {
  const r = audit(fixture(`${BASE}ship-batch: 2\n`, UNWIRED));
  assert.ok(hasText(r.warns, /no workflow in \.github\/workflows fires on a push to ship-batch\/\*\* — colab ship --batch will always fall back to serial/), r.warns.join(' | '));
});

test('ship-batch > 1 without autonomy: auto-trunk warns that it is inert', () => {
  const r = audit(fixture(`${BASE.replace('autonomy: auto-trunk\n', '')}ship-batch: 3\n`, WIRED));
  assert.ok(hasText(r.warns, /ship-batch: 3 is inert without autonomy: auto-trunk/), r.warns.join(' | '));
});
