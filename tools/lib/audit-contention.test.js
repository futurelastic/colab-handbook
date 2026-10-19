'use strict';
/**
 * The audit's reader accepts `contention:` (#630) — one level, whose `coupled:` holds an INLINE
 * list — and still refuses deeper or block-list shapes there. Real descriptors, real audit.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-contention-'));
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

test('contention.coupled as an inline list parses without a reader finding', () => {
  const r = audit(fixture(BASE + 'contention:\n  coupled: [database/migrations/, openapi.yaml]\n'));
  assert.ok(!hasText(all(r), /nested|contention|one level/), JSON.stringify(r));
});

test('an empty inline list is accepted too', () => {
  const r = audit(fixture(BASE + 'contention:\n  coupled: []\n'));
  assert.ok(!hasText(all(r), /nested|contention|one level/), JSON.stringify(r));
});

test('a block list under contention.coupled is still a reader finding', () => {
  const r = audit(fixture(BASE + 'contention:\n  coupled:\n    - database/migrations/\n'));
  assert.ok(hasText(all(r), /nested|one level/), JSON.stringify(r));
});

test('an inline list under another map key (thresholds) is still a reader finding', () => {
  const r = audit(fixture(BASE + 'thresholds:\n  hot-file-count: [3]\n'));
  assert.ok(hasText(all(r), /one level/), JSON.stringify(r));
});
