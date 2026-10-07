'use strict';
/** `colab thresholds` (#560) — the one place a skill reads a repo's advisory thresholds. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const COLAB = path.resolve(__dirname, '..', 'colab');

function repo(yml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thresholds-cli-'));
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  if (yml !== undefined) {
    fs.mkdirSync(path.join(dir, '.github'));
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), yml);
  }
  return dir;
}
const run = (dir, ...args) => spawnSync('node', [COLAB, 'thresholds', '--repo', dir, ...args], { encoding: 'utf8' });

test('#560: no descriptor — every threshold is its default', () => {
  const r = run(repo(), '--json');
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.thresholds['hot-file-count'].value, 3);
  assert.strictEqual(j.thresholds['hot-file-count'].declared, false);
  assert.deepStrictEqual(j.problems, []);
});

test('#560: a declared value is printed bare for a skill, a malformed one falls back loudly', () => {
  const dir = repo('trunk: main\nthresholds:\n  hot-file-count: 4\n  smoke-minutes: 0\n');
  assert.strictEqual(run(dir, 'hot-file-count').stdout, '4\n');
  const bad = run(dir, 'smoke-minutes');
  assert.strictEqual(bad.stdout, '3\n');
  assert.match(bad.stderr, /thresholds\.smoke-minutes must be a whole number ≥ 1/);
  const j = JSON.parse(run(dir, '--json').stdout);
  assert.strictEqual(j.thresholds['hot-file-count'].declared, true);
  assert.strictEqual(j.problems.length, 1);
});

test('#560: an unknown name is refused, naming the known ones', () => {
  const r = run(repo(), 'hot-files');
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /unknown threshold hot-files — expected one of: hot-file-count/);
});
