'use strict';
/**
 * `colab release npm` (#433) — the npm job's one input, read from the release: block — and the
 * audit reading the same npm keys. Real CLI against throwaway repos; no network.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const BASE = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nexposure: released\nstack: node\n';
const PAIR = 'release:\n  npm: .\n  npm-gate: node scripts/check-pack-allowlist.mjs\n';

function repo(projectYml, pkg = { name: '@o/p' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-npm-'));
  TMP.push(dir);
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'release npm test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg) + '\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function npmVerdict(dir) {
  const r = spawnSync('node', [COLAB, 'release', 'npm', '--repo', dir, '--json'], {
    encoding: 'utf8', env: { ...process.env, COLAB_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'colab-home-')) },
  });
  return { status: r.status, json: JSON.parse(r.stdout) };
}

test('release npm: nothing declared — no publish, exit 0', () => {
  const r = npmVerdict(repo(BASE));
  assert.equal(r.status, 0);
  assert.equal(r.json.publish, false);
  assert.match(r.json.why, /does not publish to npm/);
});

test('release npm: the pair on public-tool names the package, directory and gate', () => {
  const r = npmVerdict(repo(BASE + PAIR));
  assert.equal(r.status, 0);
  assert.deepEqual({ ...r.json, why: undefined }, { publish: true, dir: '.', gate: 'node scripts/check-pack-allowlist.mjs', package: '@o/p', why: undefined, findings: [] });
});

test('release npm: declared but unable to publish — exit 1 with the reason', () => {
  const cases = [
    [repo(BASE + PAIR, { name: '@o/p', private: true }), /"private": true/],
    [repo(BASE + PAIR, null), /package\.json is missing/],
    [repo(BASE + PAIR, { version: '1.0.0' }), /has no name/],
    [repo(BASE + 'release:\n  npm: .\n'), /without release\.npm-gate/],
    [repo(BASE.replace('deploy: none', 'deploy: tag').replace('production: null', 'production: https://x.example') + PAIR), /fits only route public-tool/],
  ];
  for (const [dir, why] of cases) {
    const r = npmVerdict(dir);
    assert.equal(r.status, 1, String(why));
    assert.equal(r.json.publish, false);
    assert.ok(r.json.findings.some((f) => why.test(f)), `${why} not in ${JSON.stringify(r.json.findings)}`);
  }
});

test('audit: a broken npm pair is a release-block failure; a valid one is not', () => {
  const fails = (dir) => {
    let out;
    try { out = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { out = e.stdout; }
    return JSON.parse(out).results[0].findings.filter((f) => f.level === 'fail').map((f) => f.text);
  };
  assert.ok(fails(repo(BASE + 'release:\n  npm-gate: x\n')).some((t) => /release\.npm-gate is declared without release\.npm/.test(t)));
  assert.ok(!fails(repo(BASE + PAIR)).some((t) => /release\.npm/.test(t)));
});
