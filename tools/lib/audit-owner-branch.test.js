'use strict';
/**
/**
 * Tests for the audit's `owner:` block (#394, ruled D) — real descriptors through the real audit,
 * so the parser half (`owner` is a NESTED_MAP_KEYS entry) and the validation half
 * (tools/lib/owner-branch.js evaluate) are pinned together.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-owner-branch-'));
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

const BASE = 'trunk: fleet/integration\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';

test('no owner: key → no owner finding', () => {
  const r = audit(fixture(BASE));
  assert.ok(!hasText(all(r), /owner/), JSON.stringify(r));
});

test('a well-formed owner: block parses and passes (the owner branch is exempt from branch naming)', () => {
  const dir = fixture(BASE + 'owner:\n  branch: master\n  remote: origin\n');
  execFileSync('git', ['branch', 'master'], { cwd: dir });
  const r = audit(dir);
  assert.ok(!hasText(all(r), /owner|nested|master/), JSON.stringify(r));
});

test('owner.branch equal to trunk fails', () => {
  const r = audit(fixture(BASE + 'owner:\n  branch: fleet/integration\n'));
  assert.ok(hasText(r.fails, /owner\.branch is the trunk/), JSON.stringify(r));
});

test('owner: without branch, or with an unknown sub-key, fails', () => {
  assert.ok(hasText(audit(fixture(BASE + 'owner:\n  remote: origin\n')).fails, /without "branch:"/));
  assert.ok(hasText(audit(fixture(BASE + 'owner:\n  branch: master\n  merge: auto\n')).fails, /unknown key "merge"/));
});

test('owner.branch also listed in integration: fails', () => {
  const dir = fixture(BASE + 'integration:\n  - master\nowner:\n  branch: master\n');
  execFileSync('git', ['branch', 'master'], { cwd: dir });
  assert.ok(hasText(audit(dir).fails, /also listed in integration/));
});
