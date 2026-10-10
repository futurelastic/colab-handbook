'use strict';
/**
 * #584 — `colab doctor --sync` lists open PRs whose head already landed in trunk: the CI-trigger PRs
 * a squash ship left open before ship learned to close them. Report-only.
 *
 * Real CLI, real repo with a real bare `origin`, a `gh` stub answering the reads doctor --sync makes.
 * Run: `node --test tools/lib/doctor-landed-prs.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.join(path.resolve(__dirname, '..', '..'), 'tools', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-landed-prs-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'doctor landed prs');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  g('add', '-A'); g('commit', '-q', '-m', 'chore: fixture'); g('push', '-q', 'origin', 'main');

  // fix/landed-90: its work squash-landed on main (a NEW commit with the same content)
  g('checkout', '-q', '-b', 'fix/landed-90');
  fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
  g('add', '-A'); g('commit', '-q', '-m', 'fix: a');
  const landedTip = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');
  g('merge', '-q', '--squash', 'fix/landed-90'); g('commit', '-q', '-m', 'fix: a (squash)\n\nCloses #90');
  g('push', '-q', 'origin', 'main');
  // fix/open-91: not landed
  g('checkout', '-q', '-b', 'fix/open-91');
  fs.writeFileSync(path.join(work, 'b.txt'), 'b\n');
  g('add', '-A'); g('commit', '-q', '-m', 'fix: b');
  const openTip = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');

  const prs = JSON.stringify([
    { number: 701, url: 'https://example.invalid/pull/701', headRefOid: landedTip, headRefName: 'fix/landed-90' },
    { number: 702, url: 'https://example.invalid/pull/702', headRefOid: openTip, headRefName: 'fix/open-91' },
    { number: 703, url: 'https://example.invalid/pull/703', headRefOid: 'e'.repeat(40), headRefName: 'fix/elsewhere-92' },
  ]);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ]; then exit 0; fi',
    `if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo '${prs}'; exit 0; fi`,
    'if [ "$1" = "pr" ] && [ "$2" = "close" ]; then echo "doctor must never close a PR" >&2; exit 9; fi',
    'echo "[]"; exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, home, bin };
}

function doctor(fx, extra = []) {
  const r = spawnSync('node', [COLAB, 'doctor', ...extra], {
    cwd: fx.work, encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('#584: doctor --sync lists the open PR whose head landed — not the unlanded one, not one this clone cannot see', () => {
  const fx = fixture();
  const r = doctor(fx, ['--sync', '--json']);
  assert.strictEqual(r.code, 0, r.err);
  const report = JSON.parse(r.out);
  assert.deepStrictEqual(report.landedPrs.map((p) => p.number), [701]);
  assert.strictEqual(report.landedPrs[0].branch, 'fix/landed-90');
});

test('#584: the human report names it with the close command, and --prune still closes nothing', () => {
  const fx = fixture();
  const r = doctor(fx, ['--sync', '--prune']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /Open PRs whose branch already landed \(1\)/);
  assert.match(r.out, /#701 fix\/landed-90/);
  assert.match(r.out, /gh pr close 701/);
  assert.doesNotMatch(r.err, /doctor must never close a PR/);
});

test('#584: without --sync no PR is listed (doctor stays offline)', () => {
  const fx = fixture();
  const r = doctor(fx, ['--json']);
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(JSON.parse(r.out).landedPrs, []);
});
