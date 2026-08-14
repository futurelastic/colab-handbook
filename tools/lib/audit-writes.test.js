'use strict';
/**
 * Tests for the audit's `writes:` validation (audit/audit.mjs) — issue #133.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * `writes` names a repo's default write-conflict prevention method (serial / isolated) — a
 * separate axis from `tier`, `ceremony`, and `production`. Three things are pinned here: omission
 * behaves exactly like `isolated` (no existing repo's behaviour changes), an unknown value is a
 * finding, and — the important one — `writes: serial` on a repo WITH a live `production` URL
 * passes clean, pinning that this axis is deliberately NOT coupled to exposure/tier/production
 * (CONVENTIONS.md §2, "Writes"). A future session must delete this test, not merely work around
 * it, before it could add that coupling back.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-writes-'));
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
    ok: r.ok,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

// --- omission and the plain values are all quiet -----------------------------

test('a Tier B repo with no writes key at all is unaffected — omission = isolated', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /writes/), r.fails.join(' | '));
});

test('writes: isolated on a Tier B repo is clean', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: isolated\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /writes/), r.fails.join(' | '));
});

test('writes: serial on a Tier B repo is clean — the legacy alias stays accepted (#208)', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: serial\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /writes/), r.fails.join(' | '));
});

test('#208: writes: serial-direct on a Tier B repo is clean', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: serial-direct\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /writes/), r.fails.join(' | '));
});

test('#208: writes: serial-gated on a Tier B repo is clean', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: serial-gated\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /writes/), r.fails.join(' | '));
});

// --- unknown value -------------------------------------------------------------

test('an unrecognised writes value is a finding, not a silent pass', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: parallel\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /writes is "parallel", expected "isolated", "serial-direct", or "serial-gated"/), r.fails.join(' | '));
});

// --- the non-coupling pin — the whole point of this file -----------------------

test('writes: serial + a real production URL passes clean — the axis is NOT coupled to tier/production/exposure', () => {
  const yml = `tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\nwrites: serial\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /writes/), r.fails.join(' | '));
});

test('writes: serial + tier: A + a tag deploy passes clean too', () => {
  const yml = `tier: A\ntrunk: main\nproduction: https://example.invalid\ndeploy: tag\nstack: node\nwrites: serial\n`;
  const r = audit(fixture(yml));
  assert.ok(!hasText(r.fails, /writes/), r.fails.join(' | '));
});

// --- independence from ceremony -------------------------------------------------

test('writes and ceremony are independent — an unrelated ceremony finding does not suppress a writes finding, and vice versa', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nceremony: bogus\nwrites: bogus\n`;
  const r = audit(fixture(yml));
  assert.ok(hasText(r.fails, /ceremony is "bogus"/), r.fails.join(' | '));
  assert.ok(hasText(r.fails, /writes is "bogus"/), r.fails.join(' | '));
});
