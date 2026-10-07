'use strict';
/**
 * CLI tests for `colab ship --batch` with `ship-batch-wait:` (#555) — the wiring in tools/colab's
 * cmdShipBatch that tools/lib/ship-batch.test.js's pure cases (parseShipBatchWait, partnerWait)
 * cannot reach.
 *
 * The done-criterion pinned here: with the field ABSENT (or malformed, which fails closed to the
 * same), a one-branch --batch call answers byte-for-byte what it answered before the field existed
 * — the same two lines, the same exit 4, and nothing fetched. With a valid window the one-branch
 * call is let through to the batch path instead; here it then stops at the fetch, because the
 * fixture has no remote — which is the proof it got past the old early refusal.
 *
 * Real CLI, real repo, private COLAB_HOME, no network. Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.join(__dirname, '..', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\nautonomy: auto-trunk\nship-batch: 3\n';

function fixture(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-batch-wait-cli-'));
  TMP.push(dir);
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'cli test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), BASE + extra);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function shipBatchOne(dir) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-batch-wait-home-'));
  TMP.push(home);
  return spawnSync('node', [COLAB, 'ship', '--batch', 'feat/a-1', '--repo', dir], {
    encoding: 'utf8', env: { ...process.env, COLAB_HOME: home, NO_COLOR: '1' },
  });
}

const BEFORE = '✗ ship-batch: --batch names 1 branch(es) — a batch needs at least two\n→ SERIAL: colab ship --branch feat/a-1\n';

test('#555: field absent — a one-branch --batch is declined exactly as before', () => {
  const r = shipBatchOne(fixture(''));
  assert.strictEqual(r.status, 4, r.stdout + r.stderr);
  assert.strictEqual(r.stdout, BEFORE);
});

test('#555: zero or malformed fails closed — the same decline, plus a warning naming the value', () => {
  for (const v of ['0m', '6', 'soon']) {
    const r = shipBatchOne(fixture(`ship-batch-wait: ${v}\n`));
    assert.strictEqual(r.status, 4, `${v}: ${r.stdout}${r.stderr}`);
    assert.strictEqual(r.stdout, BEFORE, v);
    if (v !== '0m') assert.match(r.stderr, /ship-batch-wait is .* ignored: a lone member does not wait/, v);
  }
});

test('#555: a valid window lets a one-branch --batch through to the batch path', () => {
  const r = shipBatchOne(fixture('ship-batch-wait: 6m\n'));
  assert.doesNotMatch(r.stdout, /a batch needs at least two/, r.stdout);
  assert.match(r.stdout + r.stderr, /could not fetch/, 'stops at the fetch — this fixture has no remote');
});
