'use strict';
/**
 * The audit's `--batch-history` (audit/audit.mjs, #556) — end to end, through the real
 * `colab batch-stats --json` on a fixture repo with a local bare `origin` (no GitHub, so
 * batch-stats reads trunk commits only). The judging rules themselves are pinned on hand-built
 * reports in batch-history.test.js; this file pins the wiring: off by default, shown not judged,
 * and a remote target says why it was skipped.
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

const BASE = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

function fixture(extraYml = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-batch-history-'));
  TMP.push(root);
  const dir = path.join(root, 'work');
  const bare = path.join(root, 'origin.git');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  fs.mkdirSync(dir);
  g(root, 'init', '-q', '--bare', '-b', 'main', bare);
  g(dir, 'init', '-q', '-b', 'main', '.');
  g(dir, 'config', 'user.email', 'test@example.invalid');
  g(dir, 'config', 'user.name', 'audit test');
  g(dir, 'config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), BASE + extraYml);
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', 'chore: fixture');
  for (const n of [11, 12]) g(dir, 'commit', '-q', '--allow-empty', '-m', `fix: change ${n}\n\nCloses #${n}`);
  g(dir, 'remote', 'add', 'origin', bare);
  g(dir, 'push', '-q', 'origin', 'main');
  return dir;
}

function audit(dir, ...flags) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', ...flags, '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    stdout = err.stdout || '';
  }
  const out = JSON.parse(stdout);
  const r = out.results[0];
  return { out, r, warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text) };
}

test('#556: off by default — not read, the run says so once, and declared keys are still listed', () => {
  const dir = fixture('thresholds:\n  batch-overlap-pct: 20\n');
  const { out, r, warns } = audit(dir);
  assert.deepStrictEqual(out.batchHistory, { read: false, reason: 'not requested (--batch-history)' });
  assert.deepStrictEqual(r.batchHistory, { status: 'not-requested', declared: ['batch-overlap-pct'] });
  assert.ok(!warns.some((w) => /batch history/.test(w)), warns.join('\n'));
});

test('#556: --batch-history with nothing declared — measured and shown, never a finding', () => {
  const dir = fixture();
  const { out, r, warns } = audit(dir, '--batch-history');
  assert.deepStrictEqual(out.batchHistory, { read: true });
  assert.strictEqual(r.batchHistory.status, 'read', JSON.stringify(r.batchHistory));
  assert.strictEqual(r.batchHistory.landings.serial, 3);
  assert.deepStrictEqual(r.batchHistory.declared, []);
  assert.match(r.batchHistory.picture.join('\n'), /3 landing\(s\), 0 batch · 3 serial/);
  assert.ok(!warns.some((w) => /batch history/.test(w)), warns.join('\n'));
});

test('#556: a declared threshold with no measurable samples is reported as not judged, not as a pass', () => {
  const dir = fixture('thresholds:\n  batch-overlap-pct: 0\n');
  const { r, warns } = audit(dir, '--batch-history');
  assert.strictEqual(r.batchHistory.status, 'read');
  assert.deepStrictEqual(r.batchHistory.judged, []);
  assert.deepStrictEqual(r.batchHistory.unjudged.map((u) => u.key), ['batch-overlap-pct']);
  assert.ok(!warns.some((w) => /batch history/.test(w)), warns.join('\n'));
});

test('#556: the text report prints the picture under the repo row and the run header', () => {
  const dir = fixture();
  let stdout;
  try { stdout = execFileSync('node', [AUDIT, '--batch-history', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (err) { stdout = err.stdout || ''; }
  assert.match(stdout, /^batch: {5}batch landing history read per local repo/m);
  assert.match(stdout, /▸ batch history .*3 landing\(s\)/);
  assert.match(stdout, /▸ no batch-\* thresholds declared — shown, not judged/);
});
