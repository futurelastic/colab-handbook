'use strict';
/**
 * `colab batch-stats` reading a trunk log past spawnSync's 1 MiB default (#585). Real git
 * against a bare origin on disk; no gh (the command degrades to trunk commits only).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const COLAB = path.resolve(__dirname, '..', 'colab');

/** A clone whose origin/main holds `n` commits with `bodyBytes`-byte messages. */
function repo(n, bodyBytes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-stats-cli-'));
  const origin = path.join(root, 'origin.git');
  const dir = path.join(root, 'work');
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  g('config', 'user.email', 't@example.com'); g('config', 'user.name', 't');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'trunk: main\n');
  const msg = path.join(root, 'msg');
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(path.join(dir, `f${i}`), String(i));
    g('add', '-A');
    fs.writeFileSync(msg, `feat: change ${i} (#${i + 1})\n\n${'x'.repeat(bodyBytes)}\n`);
    g('commit', '-q', '-F', msg);
  }
  g('remote', 'add', 'origin', origin);
  g('push', '-q', 'origin', 'main');
  return dir;
}

const run = (dir, env = {}) => spawnSync('node', [COLAB, 'batch-stats', '--repo', dir, '--since', '30d', '--json'], {
  encoding: 'utf8', env: { ...process.env, ...env, PATH: `/usr/bin:/bin:${path.dirname(process.execPath)}` },
});

test('#585: a trunk log over 1 MiB is read in full', () => {
  const dir = repo(3, 400 * 1024);
  const out = execFileSync('git', ['-C', dir, 'log', 'origin/main', '--format=%B'], { maxBuffer: 1 << 28 });
  assert.ok(out.length > 1024 * 1024, `fixture log is ${out.length} bytes — must pass 1 MiB`);
  const r = run(dir);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).landings.total, 3);
});

test('#585: a log past the read buffer names ENOBUFS, never the fetch remedy', () => {
  const dir = repo(2, 4 * 1024);
  const r = run(dir, { COLAB_BATCH_STATS_MAX_BUFFER: '1024' });
  assert.notStrictEqual(r.status, 0);
  const err = r.stderr + r.stdout;
  assert.match(err, /could not read origin\/main: ENOBUFS: output passed the 1 KiB read buffer/);
  assert.match(err, /pass a shorter --since/);
  assert.doesNotMatch(err, /git fetch/);
});
