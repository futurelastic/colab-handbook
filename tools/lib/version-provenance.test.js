'use strict';
// #444: `colab --version` names its provenance — frozen copy, working tree, or npm package — and
// prints ONE version from it. An npm install used to print `colab 1.0.0 — colab-handbook v0
// (working tree: <npx cache>)`: a hard-coded version, a git lookup with no git, and the wrong label.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const stamp = require('./stamp.js');

const TOOLS = path.resolve(__dirname, '..');
const HANDBOOK = path.resolve(TOOLS, '..');

function tmp() { return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ver-'))); }

/** Copy the CLI (colab + lib, no tests) into <dir>/tools, the way every install lays it out. */
function copyCli(toolsDir) {
  fs.mkdirSync(path.join(toolsDir, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(TOOLS, 'colab'), path.join(toolsDir, 'colab'));
  for (const f of fs.readdirSync(path.join(TOOLS, 'lib'))) {
    if (f.endsWith('.js') && !f.endsWith('.test.js')) {
      fs.copyFileSync(path.join(TOOLS, 'lib', f), path.join(toolsDir, 'lib', f));
    }
  }
}

function git(dir, ...args) {
  execFileSync('git', ['-C', dir, ...args], {
    stdio: 'ignore',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
}

function version(colabPath) {
  return execFileSync(process.execPath, [colabPath, '--version'], {
    encoding: 'utf8', env: { ...process.env, COLAB_HOME: tmp() },
  }).trim();
}

test('npm package: the installed package.json version, labelled npm package', () => {
  const root = path.join(tmp(), 'node_modules', '@futurelastic', 'colab-handbook');
  copyCli(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'package.json'),
    JSON.stringify({ name: stamp.PACKAGE_NAME, version: '1.12.0-rc.8' }));
  assert.strictEqual(version(path.join(root, 'tools', 'colab')), `colab 1.12.0-rc.8 (npm package: ${root})`);
});

test('working tree: the git-derived version and branch, as before', () => {
  const root = tmp();
  copyCli(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: stamp.PACKAGE_NAME, version: '9.9.9' }));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  git(root, 'tag', 'v1.2.3');
  assert.strictEqual(version(path.join(root, 'tools', 'colab')), `colab v1.2.3 (working tree: ${root}, branch main)`);
});

test('frozen copy: the stamp sidecar version, unchanged', () => {
  const home = tmp();
  const bin = path.join(home, 'bin');
  copyCli(bin);
  fs.writeFileSync(path.join(bin, stamp.FROZEN_STAMP_FILE), stamp.stampLine(stamp.FROZEN_STAMP_NAME, 'v1.6.1-14-gc8436c6'));
  assert.strictEqual(version(path.join(bin, 'colab')), `colab v1.6.1-14-gc8436c6 (frozen copy: ${bin})`);
});

test('npmPackageInfo: every condition is required', () => {
  const mk = (base, pkg) => {
    const d = path.join(base, 'node_modules', 'x');
    fs.mkdirSync(d, { recursive: true });
    if (pkg) fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pkg));
    return d;
  };
  const ok = { name: stamp.PACKAGE_NAME, version: '1.12.0' };
  const good = mk(tmp(), ok);
  assert.deepStrictEqual(stamp.npmPackageInfo(good), { root: good, version: '1.12.0' });
  assert.strictEqual(stamp.npmPackageInfo(mk(tmp(), { name: 'other', version: '1.0.0' })), null, 'another package');
  assert.strictEqual(stamp.npmPackageInfo(mk(tmp(), null)), null, 'no package.json');

  // A synced working tree with no .git: right name, but not under node_modules.
  const synced = tmp();
  fs.writeFileSync(path.join(synced, 'package.json'), JSON.stringify(ok));
  assert.strictEqual(stamp.npmPackageInfo(synced), null, 'not under node_modules');

  // Under node_modules but its own git checkout (a linked/cloned dependency).
  const cloned = mk(tmp(), ok);
  git(cloned, 'init', '-q');
  assert.strictEqual(stamp.npmPackageInfo(cloned), null, 'owns a git checkout');
});

test('PACKAGE_NAME is the name the root package.json publishes', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(HANDBOOK, 'package.json'), 'utf8'));
  assert.strictEqual(stamp.PACKAGE_NAME, pkg.name);
});
