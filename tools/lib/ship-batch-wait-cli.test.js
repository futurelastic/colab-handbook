'use strict';
/**
 * CLI tests for `colab ship --batch` with `ship-batch-wait:` (#555) — the wiring in tools/colab's
 * cmdShipBatch that tools/lib/ship-batch.test.js's pure cases (parseShipBatchWait, partnerWait)
 * cannot reach.
 *
 * #562 superseded #555's "absent → decline as before": one named member is now a valid batch on
 * any ship-batch repo, so EVERY one-branch call — field absent, malformed, or a valid window — gets
 * past the early refusal to the batch path. Here it then stops at the fetch, because the fixture has
 * no remote — which is the proof it got past. The window's own behaviour (wait, then build alone) is
 * pinned in ship-batch-cli.test.js against a real remote.
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

const PAST = (r) => {
  assert.doesNotMatch(r.stdout, /a batch needs at least two|names no branch/, r.stdout);
  assert.match(r.stdout + r.stderr, /could not fetch/, 'stops at the fetch — this fixture has no remote');
};

test('#562: field absent — a one-branch --batch is a batch of one, no longer declined', () => {
  PAST(shipBatchOne(fixture('')));
});

test('#555: zero or malformed fails closed to no wait — still a batch of one, plus a warning naming the value', () => {
  for (const v of ['0m', '6', 'soon']) {
    const r = shipBatchOne(fixture(`ship-batch-wait: ${v}\n`));
    PAST(r);
    if (v !== '0m') assert.match(r.stderr, /ship-batch-wait is .* ignored: a lone member does not wait/, v);
  }
});

test('#555: a valid window lets a one-branch --batch through to the batch path', () => {
  PAST(shipBatchOne(fixture('ship-batch-wait: 6m\n')));
});
