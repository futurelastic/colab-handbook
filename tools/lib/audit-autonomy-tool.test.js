'use strict';
/**
 * Tests for the audit's `autonomy: auto-trunk` + `tools/colab` presence check
 * (audit/audit.mjs) — issue #216.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `autonomy: auto-trunk` grants code-ship exactly one graduated exception: Phase B may
 * complete unattended, but ONLY through `colab ship` (CLAUDE.md, "One graduated
 * exception"). A repo that declares the grant with no `tools/colab` on disk to run it
 * with is not a safety hazard — nothing can act on a permission nothing can invoke — but
 * it is a descriptor asserting a capability the repo does not have, which is worth a
 * `warn`, not a `fail`.
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

function fixture(projectYml, { withColab = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-autonomy-tool-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  if (withColab) {
    fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tools', 'colab'), '#!/usr/bin/env node\n// fixture stand-in\n');
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
    ok: r.ok,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

// --- the finding itself -------------------------------------------------------

test('autonomy: auto-trunk with no tools/colab is a WARN, not a fail — nothing can act on the grant', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n`;
  const r = audit(fixture(yml, { withColab: false }));
  assert.ok(hasText(r.warns, /autonomy: auto-trunk but no tools\/colab/), r.warns.join(' | '));
  assert.ok(!hasText(r.fails, /autonomy/), r.fails.join(' | '));
});

// --- the grant is honoured, so no finding -------------------------------------

test('autonomy: auto-trunk WITH tools/colab present is clean', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n`;
  const r = audit(fixture(yml, { withColab: true }));
  assert.ok(!hasText(r.warns, /tools\/colab/), r.warns.join(' | '));
  assert.ok(!hasText(r.fails, /tools\/colab/), r.fails.join(' | '));
});

// --- no grant, no tool: this repo describes itself honestly -------------------

test('no autonomy key and no tools/colab is unaffected — nothing was ever asserted', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const r = audit(fixture(yml, { withColab: false }));
  assert.ok(!hasText(r.warns, /tools\/colab/), r.warns.join(' | '));
  assert.ok(!hasText(r.fails, /tools\/colab/), r.fails.join(' | '));
});

// --- other autonomy values (or its absence) never trigger this check ----------

test('autonomy: manual with no tools/colab does not trigger the check — the check is auto-trunk-specific', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: manual\n`;
  const r = audit(fixture(yml, { withColab: false }));
  assert.ok(!hasText(r.warns, /tools\/colab/), r.warns.join(' | '));
  assert.ok(!hasText(r.fails, /tools\/colab/), r.fails.join(' | '));
});
