'use strict';
/**
 * Tests for the audit's exposure/channels FALSIFIERS and duration report (audit/audit.mjs)
 * — issue #137.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The audit cannot CONFIRM a declared "nothing consumes this" claim (`exposure: none` /
 * `channels: [none]`) — no local check can prove a negative about the outside world. This
 * unit hunts for cheap repo-local artifacts that CONTRADICT the claim instead: a
 * version-shaped git tag (F1), or a committed deploy path — a `deploy-*`/`release-*`
 * workflow, or a `deploy`/`release` basename under the repo root/scripts/bin (F5). It also
 * reports how long the current value has held, computed from the descriptor's own git
 * history — never a new date field.
 *
 * What is pinned here, and what a future session must DELETE rather than work around
 * before changing it:
 *
 *   - every new finding here is a `warn`, never a `fail` — `ok` stays `true` even when a
 *     repo trips every falsifier (severity argued at length in the plan: this is evidence
 *     of the CLASS that usually accompanies a consumer, not proof of one — a repo released
 *     years ago and dead since is truthfully `exposure: none` today, tag and all);
 *   - gathering (tags, workflow/root/scripts/bin listing, the git-history walk) happens
 *     ONLY when `exposure` is exactly `"none"` or `channels` is exactly `["none"]` — every
 *     other value, and undeclared, does no new IO;
 *   - `exposure: self` gets no falsifier at all;
 *   - the two keys are NOT coupled — a contradicting `exposure` produces no `channels`
 *     finding and vice versa, even when the other key is declared and innocent;
 *   - the duration report is computed from git history alone (no new field), degrades to a
 *     lower bound when the true origin is not visible (shallow clone, walk cap, or the
 *     oldest inspected commit already agreed with the current value), and stays silent
 *     under ~180 days — the exact gate that keeps audit-exposure.test.js's/
 *     audit-channels.test.js's "committed moments ago" fixtures clean;
 *   - non-git, or a repo whose history does not resolve, is silence — never a crash, never
 *     a finding.
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

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/**
 * Builds a real git repo from a list of commits: `[{ files, remove, message, daysAgo }]`,
 * applied in order. `daysAgo` (optional) backdates BOTH author and committer date via env
 * vars — the mechanism the plan specifies, and the only wall-clock dependency this suite
 * takes (a fixed offset from "now" at build time, never a sleep).
 */
function buildRepo(commits, { branch = 'main' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-falsifiers-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', branch, '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));

  for (const c of commits) {
    for (const [rel, content] of Object.entries(c.files || {})) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    for (const rel of c.remove || []) {
      fs.rmSync(path.join(dir, rel), { force: true });
    }
    g('add', '-A');
    const env = { ...process.env };
    if (c.daysAgo != null) {
      const iso = isoDaysAgo(c.daysAgo);
      env.GIT_AUTHOR_DATE = iso;
      env.GIT_COMMITTER_DATE = iso;
    }
    execFileSync('git', ['commit', '-q', '-m', c.message || 'chore: fixture'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
  }
  return dir;
}

function tag(dir, name) {
  execFileSync('git', ['tag', name], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function shallowClone(srcDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-falsifiers-shallow-'));
  TMP.push(dir);
  execFileSync('git', ['clone', '-q', '--depth', '1', 'file://' + srcDir, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return dir;
}

function plainDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-falsifiers-nogit-'));
  TMP.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
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

const TIER_B_NONE = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: none\n`;
const TIER_B_CHANNELS_NONE = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nchannels: [none]\n`;

// --- F1: version-shaped tag ---------------------------------------------------------

test('exposure: none contradicted by a version-shaped tag is a warn naming the tag, and ok stays true', () => {
  const dir = buildRepo([{ files: { '.github/project.yml': TIER_B_NONE }, message: 'chore: fixture' }]);
  tag(dir, 'v1.0.0');
  const r = audit(dir);
  assert.ok(hasText(r.warns, /exposure: none is contradicted by repo evidence.*tag v1\.0\.0/), r.warns.join(' | '));
  assert.ok(!hasText(r.fails, /exposure/), r.fails.join(' | '));
  assert.strictEqual(r.ok, true, 'a falsifier finding must not flip ok to false');
});

test('a non-version-shaped tag is not evidence — "backup-2024" produces no exposure falsifier finding', () => {
  const dir = buildRepo([{ files: { '.github/project.yml': TIER_B_NONE }, message: 'chore: fixture' }]);
  tag(dir, 'backup-2024');
  const r = audit(dir);
  assert.ok(!hasText(r.warns, /contradicted by repo evidence/), r.warns.join(' | '));
});

test('channels: [none] contradicted by a version-shaped tag is a warn naming the tag, and ok stays true', () => {
  const dir = buildRepo([{ files: { '.github/project.yml': TIER_B_CHANNELS_NONE }, message: 'chore: fixture' }]);
  tag(dir, 'v2.3.1');
  const r = audit(dir);
  assert.ok(hasText(r.warns, /channels: \[none\] is contradicted by repo evidence.*tag v2\.3\.1/), r.warns.join(' | '));
  assert.ok(!hasText(r.fails, /channels/), r.fails.join(' | '));
  assert.strictEqual(r.ok, true, 'a falsifier finding must not flip ok to false');
});

// --- F5: committed deploy path ------------------------------------------------------

test('exposure: none contradicted by a deploy-*.yml workflow (zero new IO — already enumerated by the tier checks)', () => {
  const dir = buildRepo([{
    files: {
      '.github/project.yml': TIER_B_NONE,
      '.github/workflows/deploy-prod.yml': 'on: push\n',
    },
    message: 'chore: fixture',
  }]);
  const r = audit(dir);
  assert.ok(hasText(r.warns, /exposure: none is contradicted by repo evidence.*deploy-prod\.yml/), r.warns.join(' | '));
});

test('exposure: none contradicted by a committed scripts/deploy.sh', () => {
  const dir = buildRepo([{
    files: {
      '.github/project.yml': TIER_B_NONE,
      'scripts/deploy.sh': '#!/bin/sh\necho deploying\n',
    },
    message: 'chore: fixture',
  }]);
  const r = audit(dir);
  assert.ok(hasText(r.warns, /exposure: none is contradicted by repo evidence.*scripts\/deploy\.sh/), r.warns.join(' | '));
});

test('a deploy script under templates/ is NOT evidence — no recursion, and templates/ is explicitly excluded', () => {
  const dir = buildRepo([{
    files: {
      '.github/project.yml': TIER_B_NONE,
      'templates/deploy-xserver.yml': 'placeholder\n',
    },
    message: 'chore: fixture',
  }]);
  const r = audit(dir);
  assert.ok(!hasText(r.warns, /contradicted by repo evidence/), r.warns.join(' | '));
});

test('a deploy script under docs/ is NOT evidence — the same non-recursion boundary', () => {
  const dir = buildRepo([{
    files: {
      '.github/project.yml': TIER_B_NONE,
      'docs/deploy.md': '# how we used to deploy\n',
    },
    message: 'chore: fixture',
  }]);
  const r = audit(dir);
  assert.ok(!hasText(r.warns, /contradicted by repo evidence/), r.warns.join(' | '));
});

// --- non-coupling — the whole point of gating each block on its OWN key -------------

test('a contradicted exposure produces no channels finding when channels declares something else (innocent)', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: none\nchannels: [artifact]\n`;
  const dir = buildRepo([{ files: { '.github/project.yml': yml }, message: 'chore: fixture' }]);
  tag(dir, 'v1.0.0');
  const r = audit(dir);
  assert.ok(hasText(r.warns, /exposure: none is contradicted by repo evidence/), r.warns.join(' | '));
  assert.ok(!hasText(r.warns, /channels.*contradicted/), r.warns.join(' | '));
});

test('a contradicted channels produces no exposure finding when exposure declares something else (innocent)', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: released\nchannels: [none]\n`;
  const dir = buildRepo([{ files: { '.github/project.yml': yml }, message: 'chore: fixture' }]);
  tag(dir, 'v1.0.0');
  const r = audit(dir);
  assert.ok(hasText(r.warns, /channels: \[none\] is contradicted by repo evidence/), r.warns.join(' | '));
  assert.ok(!hasText(r.warns, /exposure.*contradicted/), r.warns.join(' | '));
});

// --- duration report ------------------------------------------------------------------

test('a fresh fixture (committed moments ago) reports no duration — the 180-day gate', () => {
  const dir = buildRepo([{ files: { '.github/project.yml': TIER_B_NONE }, message: 'chore: fixture' }]);
  const r = audit(dir);
  assert.ok(!hasText(r.warns, /has held for/), r.warns.join(' | '));
});

test('a backdated exposure change reports a precise months figure — not a lower bound', () => {
  const dir = buildRepo([
    { files: { '.github/project.yml': `tier: B\ntrunk: main\nproduction: https://example.invalid\ndeploy: none\nstack: node\nexposure: live\n` }, message: 'chore: initial', daysAgo: 400 },
    { files: { '.github/project.yml': TIER_B_NONE }, message: 'chore: drop the consumer', daysAgo: 370 },
  ]);
  const r = audit(dir);
  assert.ok(hasText(r.warns, /exposure: none has held for \d+ months? \(per the descriptor's own git history\)/), r.warns.join(' | '));
  assert.ok(!hasText(r.warns, /has held for at least/), r.warns.join(' | '));
  assert.strictEqual(r.ok, true);
});

test('a channels backdated change reports a duration line too, independent of exposure', () => {
  const dir = buildRepo([
    { files: { '.github/project.yml': `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nchannels: [workflow]\n` }, message: 'chore: initial', daysAgo: 300 },
    { files: { '.github/project.yml': TIER_B_CHANNELS_NONE }, message: 'chore: drop the workflow', daysAgo: 250 },
  ]);
  const r = audit(dir);
  assert.ok(hasText(r.warns, /channels: \[none\] has held for \d+ months? \(per the descriptor's own git history\)/), r.warns.join(' | '));
});

test('a shallow clone degrades the same duration fact to a lower bound ("at least N months")', () => {
  const origin = buildRepo([
    { files: { '.github/project.yml': `tier: B\ntrunk: main\nproduction: https://example.invalid\ndeploy: none\nstack: node\nexposure: live\n` }, message: 'chore: initial', daysAgo: 400 },
    { files: { '.github/project.yml': TIER_B_NONE }, message: 'chore: drop the consumer', daysAgo: 370 },
  ]);
  const full = audit(origin);
  assert.ok(hasText(full.warns, /has held for \d+ months? \(per/), full.warns.join(' | '));
  assert.ok(!hasText(full.warns, /has held for at least/), 'full history should read as precise: ' + full.warns.join(' | '));

  const shallow = shallowClone(origin);
  const r = audit(shallow);
  assert.ok(hasText(r.warns, /exposure: none has held for at least \d+ months? \(per the descriptor's own git history\)/), r.warns.join(' | '));
});

test('a non-git directory produces no duration finding and does not crash the audit', () => {
  const dir = plainDir({ '.github/project.yml': TIER_B_NONE });
  const r = audit(dir);
  assert.ok(!hasText(r.warns, /has held for/), r.warns.join(' | '));
  assert.ok(!hasText(r.fails, /audit crashed/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /contradicted by repo evidence/), r.warns.join(' | '));
});

// --- gating: undeclared / any other value does no new IO (no finding text at all) ----

test('exposure undeclared: a tag and a deploy script in the same repo produce no falsifier or duration finding', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n`;
  const dir = buildRepo([{
    files: { '.github/project.yml': yml, 'scripts/deploy.sh': '#!/bin/sh\n' },
    message: 'chore: fixture',
  }]);
  tag(dir, 'v1.0.0');
  const r = audit(dir);
  assert.ok(!hasText(r.warns, /contradicted by repo evidence/), r.warns.join(' | '));
  assert.ok(!hasText(r.warns, /has held for/), r.warns.join(' | '));
});

test('exposure: self gets no falsifier even with a version tag present', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n`;
  const dir = buildRepo([{ files: { '.github/project.yml': yml }, message: 'chore: fixture' }]);
  tag(dir, 'v1.0.0');
  const r = audit(dir);
  assert.ok(!hasText(r.warns, /exposure.*contradicted/), r.warns.join(' | '));
});

test('channels: [artifact] (not [none]) with a version tag present produces no channels falsifier — the tag is the declared artifact, not a contradiction', () => {
  const yml = `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nchannels: [artifact]\n`;
  const dir = buildRepo([{ files: { '.github/project.yml': yml }, message: 'chore: fixture' }]);
  tag(dir, 'v1.0.0');
  const r = audit(dir);
  assert.ok(!hasText(r.warns, /channels.*contradicted/), r.warns.join(' | '));
});
