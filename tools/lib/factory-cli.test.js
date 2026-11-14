'use strict';
/**
 * `colab factory` (#743) — this machine's factory, read from TRUNK's committed
 * `.github/factories.yml` (#739), never the working tree or the branch being worked on. The id is
 * what a 🔒 claim comment and code-wrap's hand-off marker name.
 *
 * Drives the real CLI against a real repo on disk (no network): the property is the WIRING — the
 * trunk ref read, the machine label lookup and the fail-closed answers composing through the CLI.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { machineLabel } = require('./branch-name');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const ME = machineLabel(os.hostname());
const KEY_A = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOQmAeVx3k0r6Q0ZbqkDqE6gH2y0kJ8b8o7pX2z6c1aA';
const KEY_B = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB9n4oWm5pQ2kz1X0vQf2y3nRk7m1ZpQ8c4s5t6u7v8w';

function factoriesYml(coreMachines, partnerMachines) {
  return [
    'version: 1', 'steward: core', 'forge: github.com', 'factories:',
    '  core:', '    tier: steward', `    machines: [${coreMachines.join(', ')}]`, `    key: ${KEY_A}`, '    humans: []', '    slices: [slice:core]',
    '  partner:', '    tier: partner', `    machines: [${partnerMachines.join(', ')}]`, `    key: ${KEY_B}`, '    humans: []', '    slices: [slice:partner]',
  ].join('\n') + '\n';
}

function fixture(t, trunkFactories) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-factory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'colab factory test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  fs.mkdirSync(path.join(work, '.github'));
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  if (trunkFactories !== null) fs.writeFileSync(path.join(work, '.github', 'factories.yml'), trunkFactories);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return { work, home, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args, '--repo', fx.work], {
    encoding: 'utf8', env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('trunk lists this machine → prints its factory, exit 0', (t) => {
  const fx = fixture(t, factoriesYml([ME], ['other-box']));
  const r = colab(fx, ['factory']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out.trim(), 'core');
  const j = JSON.parse(colab(fx, ['factory', '--json']).out);
  assert.deepStrictEqual({ factory: j.factory, reason: j.reason, machine: j.machine, ref: j.ref }, { factory: 'core', reason: 'listed', machine: ME, ref: 'main' });
});

test('no factories file → no factory, exit 1, one team', (t) => {
  const fx = fixture(t, null);
  const r = colab(fx, ['factory']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.out, '');
  assert.match(r.err, /no \.github\/factories\.yml on trunk/);
});

test('a file that does not list this machine names no factory', (t) => {
  const fx = fixture(t, factoriesYml(['box-a'], ['box-b']));
  const r = colab(fx, ['factory', '--json']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(JSON.parse(r.out).reason, 'unlisted');
});

test('an invalid file names nobody (fail closed), even though it lists this machine', (t) => {
  const fx = fixture(t, factoriesYml([ME], [ME])); // one machine in two factories
  const j = JSON.parse(colab(fx, ['factory', '--json']).out);
  assert.strictEqual(j.factory, null);
  assert.strictEqual(j.reason, 'invalid');
  assert.ok(j.findings.length > 0);
});

test('read from TRUNK only: a branch moving this machine to another factory changes nothing', (t) => {
  const fx = fixture(t, factoriesYml([ME], ['other-box']));
  fx.g('checkout', '-q', '-b', 'feat/move-me-1');
  fs.writeFileSync(path.join(fx.work, '.github', 'factories.yml'), factoriesYml(['other-box'], [ME]));
  fx.g('commit', '-q', '-am', 'feat: move me');
  // And an uncommitted edit on top, for good measure.
  fs.writeFileSync(path.join(fx.work, '.github', 'factories.yml'), factoriesYml(['x-box'], [ME]));
  const r = colab(fx, ['factory']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out.trim(), 'core');
});
