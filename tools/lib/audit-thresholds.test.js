'use strict';
/**
 * The audit's `thresholds:` block (audit/audit.mjs) — issue #560.
 *
 * Real descriptors through the real audit: a declared value moves the advisory it names, a
 * malformed one fails and leaves the default in force.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-thresholds-'));
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

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
// A CLAUDE.md of ~12 KB of ordinary lines: under the 40 KB default, over a declared 10 KB.
const CLAUDE = { 'CLAUDE.md': '# CLAUDE.md\n\n' + 'A router line that names where the depth lives, nothing more.\n'.repeat(200) };
// One 3 KB line among short ones: over the default floor (2048) and multiple (6×).
const LONG_LINE = { 'CLAUDE.md': '# CLAUDE.md\n\n' + 'short line here\n'.repeat(20) + 'x'.repeat(3000) + '\n' };

test('#560: no thresholds block — the defaults decide, no thresholds finding', () => {
  const r = audit(fixture(BASE, CLAUDE));
  assert.ok(!hasText(all(r), /thresholds|advisory ceiling/), all(r).join(' | '));
});

test('#560: a declared claude-md-kb lowers the CLAUDE.md ceiling and says it was declared', () => {
  const r = audit(fixture(`${BASE}thresholds:\n  claude-md-kb: 10\n`, CLAUDE));
  assert.ok(hasText(r.warns, /over the 10 KB advisory ceiling \(#64, declared in thresholds\.claude-md-kb\)/), r.warns.join(' | '));
  assert.ok(!hasText(r.fails, /thresholds/), r.fails.join(' | '));
});

test('#560: claude-md-line-floor-bytes / -multiple move the long-line advisory', () => {
  assert.ok(hasText(audit(fixture(BASE, LONG_LINE)).warns, /has a single line of 3000 bytes/));
  const raised = audit(fixture(`${BASE}thresholds:\n  claude-md-line-floor-bytes: 4096\n`, LONG_LINE));
  assert.ok(!hasText(raised.warns, /has a single line of/), raised.warns.join(' | '));
  const wide = audit(fixture(`${BASE}thresholds:\n  claude-md-line-multiple: 500\n`, LONG_LINE));
  assert.ok(!hasText(wide.warns, /has a single line of/), wide.warns.join(' | '));
});

test('#560: every malformed thresholds entry fails, and the default still applies', () => {
  for (const [line, rx] of [
    ['  claude-md-kb: 0', /thresholds\.claude-md-kb must be a whole number ≥ 1, got "0" — using the default 40/],
    ['  claude-md-kb: ten', /thresholds\.claude-md-kb must be a whole number/],
    ['  hot-file-count: 1', /thresholds\.hot-file-count must be a whole number ≥ 2/],
    ['  hot-files: 4', /thresholds\.hot-files is not a known threshold/],
  ]) {
    const r = audit(fixture(`${BASE}thresholds:\n${line}\n`, CLAUDE));
    assert.ok(hasText(r.fails, rx), `${line}: ${r.fails.join(' | ')}`);
    assert.ok(!hasText(r.warns, /advisory ceiling/), `${line}: the default 40 KB must still apply`);
  }
});

test('#560: a second level under thresholds is a parse finding', () => {
  const r = audit(fixture(`${BASE}thresholds:\n  hot-file-count:\n    value: 4\n`, CLAUDE));
  assert.ok(hasText(r.fails, /"thresholds:" takes one level/), r.fails.join(' | '));
});

test('#560: transitional-days moves when a held exposure: none earns its duration line', () => {
  // One descriptor commit dated 100 days ago: under the 180-day default, over a declared 90.
  const at = new Date(Date.now() - 100 * 86400 * 1000).toISOString();
  const env = Object.assign({}, process.env, { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
  const backdated = (yml) => {
    const dir = fixture('trunk: main\n');
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), yml);
    execFileSync('git', ['commit', '-q', '-am', 'chore: descriptor'], { cwd: dir, env, stdio: 'ignore' });
    return dir;
  };
  const NONE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: none\n';
  assert.ok(!hasText(audit(backdated(NONE)).warns, /exposure: none has held for/));
  const r = audit(backdated(`${NONE}thresholds:\n  transitional-days: 90\n`));
  assert.ok(hasText(r.warns, /exposure: none has held for 3 months/), r.warns.join(' | '));
});
