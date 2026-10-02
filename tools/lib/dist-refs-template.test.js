'use strict';
/**
 * templates/dist-refs.yml + templates/npx-launcher.mjs — one install surface for private compiled
 * tools (#442). Run: node --test tools/lib/dist-refs-template.test.js
 *
 * End to end, against a local bare repo standing in for the private origin: the workflow's REAL
 * push script (sliced out of the template between its begin/end markers, run with bash — no copy
 * of it lives here to drift) pushes the dist refs; the REAL launcher, laid out exactly as npx lays
 * a git dependency out (an npx cache root whose package.json names `<url>#vX.Y.Z` and whose
 * package-lock.json records the resolved git URL), fetches one, verifies it, installs it and
 * execs it. What each assertion protects:
 *
 *   - a dist ref is an ORPHAN (no parent), holding the binary + SHA256SUMS and nothing else;
 *   - a missing artifact refuses BEFORE any push — never a partial set;
 *   - no dist ref for a version that is not a tag; an existing dist ref is never moved;
 *   - the launcher runs the candidate's binary for `#vX.Y.Z-rc.N` (the manifest says X.Y.Z for
 *     both, so reading the manifest alone would fetch the wrong release);
 *   - a checksum mismatch refuses and installs nothing.
 */

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const YML = fs.readFileSync(path.join(ROOT, 'templates', 'dist-refs.yml'), 'utf8');
const LAUNCHER = path.join(ROOT, 'templates', 'npx-launcher.mjs');
const PLAT = `${process.platform}-${process.arch}`;
const posix = process.platform !== 'win32';

// A hermetic git: no user hooks, no global config, a fixed identity.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();

/** The push script, verbatim from the template, de-indented. */
function pushScript() {
  const lines = YML.split('\n');
  const a = lines.findIndex((l) => l.includes('--- dist-refs push script (begin) ---'));
  const b = lines.findIndex((l) => l.includes('--- dist-refs push script (end) ---'));
  assert.ok(a > 0 && b > a, 'push script markers present in templates/dist-refs.yml');
  const indent = lines[a].match(/^ */)[0].length;
  return 'set -euo pipefail\n' + lines.slice(a, b + 1).map((l) => l.slice(indent)).join('\n') + '\n';
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dist-refs-'));
}

/** origin (bare) + a working clone with a release tag; returns paths. */
function fixture(tag = 'v1.2.0') {
  const base = tmp();
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'init', '-q', '-b', 'main', work);
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'probe-tool', private: true, version: '1.2.0', bin: { 'probe-tool': 'launch.mjs' } }));
  git(work, 'add', '-A');
  git(work, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'init');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'main');
  if (tag) { git(work, 'tag', tag); git(work, 'push', '-q', 'origin', tag); }
  // macOS has no sha256sum; the CI runner does. Shim it from shasum for the local run only.
  const shim = path.join(base, 'bin');
  fs.mkdirSync(shim);
  if (spawnSync('sh', ['-c', 'command -v sha256sum'], { encoding: 'utf8' }).status !== 0) {
    fs.writeFileSync(path.join(shim, 'sha256sum'), '#!/bin/sh\nexec shasum -a 256 "$@"\n', { mode: 0o755 });
  }
  return { base, origin, work, shim };
}

/** One artifact dir per platform; the current platform's binary prints its argv. */
function artifacts(fx, plats, { bin = 'probe-tool', label = 'final' } = {}) {
  const dir = path.join(fx.base, 'dist-in');
  for (const p of plats) {
    const d = path.join(dir, `dist-${p}`);
    fs.mkdirSync(d, { recursive: true });
    const exe = p.startsWith('win32-') ? `${bin}.exe` : bin;
    fs.writeFileSync(path.join(d, exe), `#!/bin/sh\necho "${label} ${p}: $*"\n`);
  }
  return dir;
}

function runPush(fx, { version, plats, artifactsDir }) {
  return spawnSync('bash', ['-c', pushScript()], {
    cwd: fx.work,
    encoding: 'utf8',
    env: {
      ...GIT_ENV,
      PATH: `${fx.shim}${path.delimiter}${process.env.PATH}`,
      VERSION: version, PLATFORMS: plats.join(' '), BIN: 'probe-tool', PREFIX: 'dist-',
      ARTIFACTS: artifactsDir, REMOTE: 'origin',
    },
  });
}

/** Lay the launcher out the way npx installs `git+file://<origin>#<spec>`. */
function npxLayout(fx, spec) {
  const cache = path.join(fx.base, `npx-${spec}`);
  const pkgDir = path.join(cache, 'node_modules', 'probe-tool');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'probe-tool', private: true, version: '1.2.0', bin: { 'probe-tool': 'launch.mjs' } }));
  fs.copyFileSync(LAUNCHER, path.join(pkgDir, 'launch.mjs'));
  const url = `git+file://${fx.origin}`;
  fs.writeFileSync(path.join(cache, 'package.json'), JSON.stringify({ dependencies: { 'probe-tool': `${url}#${spec}` } }));
  fs.writeFileSync(path.join(cache, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: { 'node_modules/probe-tool': { version: '1.2.0', resolved: `${url}#0123456789abcdef0123456789abcdef01234567` } },
  }));
  return path.join(pkgDir, 'launch.mjs');
}

function launch(fx, launcher, args = [], extraEnv = {}) {
  const data = path.join(fx.base, 'data');
  return spawnSync(process.execPath, [launcher, ...args], {
    encoding: 'utf8',
    env: { ...GIT_ENV, XDG_DATA_HOME: data, ...extraEnv },
  });
}

test('the push script pushes one orphan ref per platform: binary + SHA256SUMS, nothing else', { skip: !posix }, () => {
  const fx = fixture();
  const plats = [PLAT, 'linux-arm64', 'win32-x64'];
  const r = runPush(fx, { version: 'v1.2.0', plats, artifactsDir: artifacts(fx, plats) });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  for (const p of plats) {
    const ref = `refs/tags/dist/v1.2.0/${p}`;
    const sha = git(fx.origin, 'rev-parse', ref);
    assert.strictEqual(git(fx.origin, 'rev-list', '--parents', '-n', '1', sha), sha, `${p}: orphan (no parent)`);
    const exe = p.startsWith('win32-') ? 'probe-tool.exe' : 'probe-tool';
    assert.deepStrictEqual(git(fx.origin, 'ls-tree', '--name-only', sha).split('\n').sort(), ['SHA256SUMS', exe].sort());
    const sums = git(fx.origin, 'cat-file', 'blob', `${sha}:SHA256SUMS`);
    assert.match(sums, new RegExp(`^[0-9a-f]{64}  ${exe.replace('.', '\\.')}$`));
  }
  assert.strictEqual(git(fx.origin, 'rev-list', '--count', 'main'), '1', 'trunk history untouched');
});

test('a missing artifact refuses before any push — never a partial set', { skip: !posix }, () => {
  const fx = fixture();
  const dir = artifacts(fx, [PLAT]);
  const r = runPush(fx, { version: 'v1.2.0', plats: [PLAT, 'linux-arm64'], artifactsDir: dir });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /linux-arm64: no probe-tool in artifact/);
  assert.strictEqual(git(fx.origin, 'for-each-ref', 'refs/tags/dist'), '', 'nothing pushed');
});

test('no dist refs for a version that is not a tag, or not a release version', { skip: !posix }, () => {
  const fx = fixture('v1.2.0');
  const dir = artifacts(fx, [PLAT]);
  const missing = runPush(fx, { version: 'v9.9.9', plats: [PLAT], artifactsDir: dir });
  assert.notStrictEqual(missing.status, 0);
  assert.match(missing.stdout, /tag v9\.9\.9 does not exist/);
  const bad = runPush(fx, { version: 'latest', plats: [PLAT], artifactsDir: dir });
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stdout, /is not vX\.Y\.Z/);
  assert.strictEqual(git(fx.origin, 'for-each-ref', 'refs/tags/dist'), '');
});

test('an existing dist ref is never moved — a re-run pushes only what is missing', { skip: !posix }, () => {
  const fx = fixture();
  const first = runPush(fx, { version: 'v1.2.0', plats: [PLAT], artifactsDir: artifacts(fx, [PLAT]) });
  assert.strictEqual(first.status, 0, first.stderr);
  const before = git(fx.origin, 'rev-parse', `refs/tags/dist/v1.2.0/${PLAT}`);
  fs.rmSync(path.join(fx.base, 'dist-in'), { recursive: true });
  const again = runPush(fx, { version: 'v1.2.0', plats: [PLAT, 'linux-arm64'], artifactsDir: artifacts(fx, [PLAT, 'linux-arm64'], { label: 'rebuilt' }) });
  assert.strictEqual(again.status, 0, again.stderr);
  assert.match(again.stdout, /1 pushed, 1 already present/);
  assert.strictEqual(git(fx.origin, 'rev-parse', `refs/tags/dist/v1.2.0/${PLAT}`), before, 'not moved');
});

test('the launcher fetches the tag npx installed, verifies, installs to a stable path, and execs', { skip: !posix }, () => {
  const fx = fixture('v1.2.0');
  assert.strictEqual(runPush(fx, { version: 'v1.2.0', plats: [PLAT], artifactsDir: artifacts(fx, [PLAT], { label: 'final' }) }).status, 0);
  // The candidate of the same version: manifest version is 1.2.0 for both.
  git(fx.work, 'tag', 'v1.2.0-rc.1'); git(fx.work, 'push', '-q', 'origin', 'v1.2.0-rc.1');
  fs.rmSync(path.join(fx.base, 'dist-in'), { recursive: true });
  assert.strictEqual(runPush(fx, { version: 'v1.2.0-rc.1', plats: [PLAT], artifactsDir: artifacts(fx, [PLAT], { label: 'candidate' }) }).status, 0);

  const rc = launch(fx, npxLayout(fx, 'v1.2.0-rc.1'), ['a', 'b']);
  assert.strictEqual(rc.status, 0, rc.stderr);
  assert.strictEqual(rc.stdout.trim(), `candidate ${PLAT}: a b`);

  const final = npxLayout(fx, 'v1.2.0');
  const r = launch(fx, final, ['x']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), `final ${PLAT}: x`);

  const where = launch(fx, final, ['--print-path']);
  const expected = path.join(fx.base, 'data', 'probe-tool', 'v1.2.0', PLAT, 'probe-tool');
  assert.strictEqual(where.stdout.trim(), expected);
  assert.ok(fs.statSync(expected).mode & 0o100, 'installed executable');

  // Installed once: a run with the origin gone still works (no fetch per invocation).
  fs.rmSync(fx.origin, { recursive: true });
  assert.strictEqual(launch(fx, final, ['y']).stdout.trim(), `final ${PLAT}: y`);
});

test('a checksum mismatch refuses and installs nothing', { skip: !posix }, () => {
  const fx = fixture('v1.2.0');
  // Hand-build a dist ref whose SHA256SUMS lies about the binary.
  const bin = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: fx.work, env: GIT_ENV, input: '#!/bin/sh\necho evil\n', encoding: 'utf8' }).trim();
  const sums = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: fx.work, env: GIT_ENV, input: `${'0'.repeat(64)}  probe-tool\n`, encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['mktree'], { cwd: fx.work, env: GIT_ENV, input: `100644 blob ${sums}\tSHA256SUMS\n100755 blob ${bin}\tprobe-tool\n`, encoding: 'utf8' }).trim();
  const commit = git(fx.work, 'commit-tree', tree, '-m', 'bad');
  git(fx.work, 'push', '-q', 'origin', `${commit}:refs/tags/dist/v1.2.0/${PLAT}`);

  const r = launch(fx, npxLayout(fx, 'v1.2.0'), []);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /checksum mismatch/);
  const dir = path.join(fx.base, 'data', 'probe-tool', 'v1.2.0', PLAT);
  assert.deepStrictEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], [], 'nothing installed');
});

test('a release with no dist ref for this platform refuses and names the ref', { skip: !posix }, () => {
  const fx = fixture('v1.2.0');
  const r = launch(fx, npxLayout(fx, 'v1.2.0'), []);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, new RegExp(`could not fetch refs/tags/dist/v1\\.2\\.0/${PLAT}`));
});

test('resolveTarget: env wins, then the installer record, then the manifest; never a guess', async () => {
  const L = await import(LAUNCHER);
  const files = {};
  const read = (p) => files[p] || null;
  const pkgDir = path.join('/c', 'node_modules', '@o', 'tool');
  const pkg = { name: '@o/tool', version: '2.0.0', repository: { url: 'git+https://github.com/o/tool.git' } };

  // Manifest only (e.g. a global install with no installer record).
  let t = L.resolveTarget({ env: {}, pkgDir, pkg, read });
  assert.deepStrictEqual([t.tool, t.version, t.origin], ['tool', 'v2.0.0', 'https://github.com/o/tool.git']);

  // Installer record: scoped package sits two levels under node_modules.
  files[path.join('/c', 'package.json')] = { dependencies: { '@o/tool': 'github:o/tool#v2.0.0-rc.3' } };
  files[path.join('/c', 'package-lock.json')] = { packages: { 'node_modules/@o/tool': { resolved: 'git+ssh://git@github.com/o/tool.git#abc' } } };
  t = L.resolveTarget({ env: {}, pkgDir, pkg, read });
  assert.deepStrictEqual([t.version, t.origin], ['v2.0.0-rc.3', 'ssh://git@github.com/o/tool.git']);

  // Env overrides both.
  t = L.resolveTarget({ env: { TOOL_DIST_VERSION: 'v1.0.0', TOOL_DIST_ORIGIN: '/srv/tool.git' }, pkgDir, pkg, read });
  assert.deepStrictEqual([t.version, t.origin], ['v1.0.0', '/srv/tool.git']);

  // A non-release committish (a branch) and no manifest version: refuse, naming the variable.
  files[path.join('/c', 'package.json')] = { dependencies: { '@o/tool': 'github:o/tool#main' } };
  t = L.resolveTarget({ env: {}, pkgDir, pkg: { name: '@o/tool' }, read });
  assert.match(t.error, /TOOL_DIST_VERSION/);
});

test('helpers: platform key, SHA256SUMS parsing, git URL normalisation', async () => {
  const L = await import(LAUNCHER);
  assert.strictEqual(L.platformKey('darwin', 'arm64'), 'darwin-arm64');
  const h = 'a'.repeat(64);
  assert.strictEqual(L.expectedSum(`${h}  tool\n${'b'.repeat(64)}  other\n`, 'tool'), h);
  assert.strictEqual(L.expectedSum(`${h} *tool.exe\n`, 'tool.exe'), h);
  assert.strictEqual(L.expectedSum(`${h}  tool\n`, 'nope'), null);
  assert.strictEqual(L.gitUrl('github:o/r#v1.0.0'), 'https://github.com/o/r.git');
  assert.strictEqual(L.gitUrl('git+ssh://git@github.com/o/r.git#abc'), 'ssh://git@github.com/o/r.git');
  assert.strictEqual(L.gitUrl('git+file:///srv/r.git#v1'), 'file:///srv/r.git');
});
