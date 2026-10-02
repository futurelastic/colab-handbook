#!/usr/bin/env node
// npx launcher — TEMPLATE. Copy me into your repo (e.g. `colab template npx-launcher.mjs --dest
// bin/launch.mjs`) and point your root package.json's `bin` at the copy. YOU OWN THE COPY.
//
// WHAT IT IS FOR. CONVENTIONS.md §6, *Distribution* (#442): every distributed tool installs with
// `npx`. A PRIVATE repo shipping a COMPILED tool installs as
//
//   npx github:<org>/<repo>#vX.Y.Z [args…]
//
// npx clones the repo at that tag (with the user's own git credentials) and runs this file. This
// file then: resolves the platform → fetches the one dist ref `refs/tags/dist/vX.Y.Z/<os>-<arch>`
// (pushed by templates/dist-refs.yml) from the same origin, with the same git, so the same
// credentials → verifies the binary against that ref's SHA256SUMS → installs it to a stable
// per-user path → execs it with the arguments it was given. Repository read access is the only
// lock, exactly as for the source.
//
// Node >= 18, zero dependencies, needs `git` on PATH (npx already needed it to clone the repo).
//
// WHERE THE VERSION AND ORIGIN COME FROM, in order:
//   1. env  <TOOL>_DIST_VERSION / <TOOL>_DIST_ORIGIN   (TOOL upper-cased, non-alnum → `_`)
//   2. the installing project's record of THIS package: its package.json dependency spec gives
//      the `#vX.Y.Z` committish, and its package-lock.json `resolved` gives the exact git URL
//      npm fetched from — under npx that is the npx cache dir two levels up from this package.
//      A candidate (`#vX.Y.Z-rc.N`) installs the candidate's binaries this way, which a
//      manifest version (`X.Y.Z` for both) could not tell apart.
//   3. this package's own package.json: `version` → `v<version>`, `repository.url` → origin.
// Nothing found → it refuses and says which variable to set. It never guesses a version.
//
// The checksum lives in the same ref as the binary, so it proves the bytes arrived whole and are
// the bytes the release run pushed — not that the release run was honest. The trust anchor is
// write access to the repository, as it is for the source npx just ran.
//
// A long-running tool must not run from npx's cache (npm may prune it under a live process).
// This launcher never does: the binary always runs from the stable install path below, and
// `--print-path` (consumed by the launcher, never passed on) prints that path so an `init` /
// `install` step can wire a service to it.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// EDIT: the binary's name inside each dist ref (dist-refs.yml's `bin` input). null = this
// package's name without its scope.
const BIN = null;

const VERSION_RE = /^v\d+\.\d+\.\d+(-rc\.\d+)?$/;
const here = dirname(fileURLToPath(import.meta.url));

function die(msg) {
  process.stderr.write(`npx-launcher: ${msg}\n`);
  process.exit(1);
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/** This package's root: the nearest directory upward holding a package.json. */
export function packageRoot(start) {
  let d = start;
  for (;;) {
    if (existsSync(join(d, 'package.json'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** The project that installed `pkgDir`: the directory holding the node_modules it lives in. */
export function installerRoot(pkgDir, name) {
  const parts = name.split('/').length;               // @scope/name sits one level deeper
  let d = pkgDir;
  for (let i = 0; i < parts; i++) d = dirname(d);
  return d.endsWith('node_modules') ? dirname(d) : null;
}

/** `git+ssh://…#sha` → `ssh://…`; git itself does not take the `git+` prefix or the committish. */
export function gitUrl(spec) {
  if (!spec || typeof spec !== 'string') return null;
  let u = spec.replace(/#.*$/, '');
  if (u.startsWith('git+')) u = u.slice(4);
  const gh = u.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);  // github:o/r, o/r
  if (gh && !u.includes('://') && !u.includes('@')) return `https://github.com/${gh[1]}/${gh[2]}.git`;
  return u;
}

/** Version + origin, from env, then the installer's record, then this package. Pure but for reads. */
export function resolveTarget({ env, pkgDir, pkg, read = readJson }) {
  const tool = BIN || String(pkg.name || '').replace(/^@[^/]+\//, '');
  if (!tool) return { error: 'no binary name — set BIN in the launcher or `name` in package.json' };
  const envKey = tool.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_DIST';
  let version = env[`${envKey}_VERSION`] || null;
  let origin = env[`${envKey}_ORIGIN`] || null;

  const inst = pkg.name ? installerRoot(pkgDir, pkg.name) : null;
  if (inst) {
    const ipkg = read(join(inst, 'package.json')) || {};
    const spec = (ipkg.dependencies || {})[pkg.name] || (ipkg.devDependencies || {})[pkg.name];
    const committish = typeof spec === 'string' && spec.includes('#') ? spec.slice(spec.lastIndexOf('#') + 1) : null;
    if (!version && committish && VERSION_RE.test(committish)) version = committish;
    const lock = read(join(inst, 'package-lock.json')) || {};
    const entry = (lock.packages || {})[`node_modules/${pkg.name}`];
    if (!origin && entry && entry.resolved) origin = gitUrl(entry.resolved);
    if (!origin && spec) origin = gitUrl(spec);
  }
  if (!version && pkg.version) version = `v${pkg.version}`;
  if (!origin && pkg.repository) origin = gitUrl(typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url);

  if (!version || !VERSION_RE.test(version)) {
    return { error: `cannot tell which release to run (got ${version || 'nothing'}) — install with \`npx github:<org>/<repo>#vX.Y.Z\`, or set ${envKey}_VERSION=vX.Y.Z` };
  }
  if (!origin) return { error: `cannot tell which repository to fetch from — set ${envKey}_ORIGIN to its git URL` };
  return { tool, version, origin, envKey };
}

export function platformKey(p = process.platform, a = process.arch) {
  return `${p}-${a}`;
}

export function installDir({ env, tool, version, plat, platform = process.platform }) {
  const base = platform === 'win32'
    ? (env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'))
    : (env.XDG_DATA_HOME || join(homedir(), '.local', 'share'));
  return join(base, tool, version, plat);
}

/** The expected sha256 of `file` in a SHA256SUMS text (`<hex>  <name>` or `<hex> *<name>`). */
export function expectedSum(sumsText, file) {
  for (const line of String(sumsText).split('\n')) {
    const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
    if (m && m[2] === file) return m[1];
  }
  return null;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', ...opts });
  if (r.error) die(`git could not run: ${r.error.message}`);
  return r;
}

/** Fetch the dist ref into a throwaway repo, verify, install atomically. Returns the binary path. */
export function install({ origin, version, plat, exe, dir }) {
  const ref = `refs/tags/dist/${version}/${plat}`;
  const tmp = mkdtempSync(join(tmpdir(), 'npx-launcher-'));
  try {
    git(['init', '-q', '--bare', tmp]);
    const f = git(['-C', tmp, 'fetch', '-q', '--depth', '1', '--no-tags', origin, ref]);
    if (f.status !== 0) {
      die(`could not fetch ${ref} from ${origin} — is ${version} released for ${plat}?\n${(f.stderr || '').trim()}`);
    }
    const sums = git(['-C', tmp, 'cat-file', 'blob', `FETCH_HEAD:SHA256SUMS`]);
    if (sums.status !== 0) die(`${ref} carries no SHA256SUMS — refusing an unverifiable binary`);
    const want = expectedSum(sums.stdout, exe);
    if (!want) die(`${ref}'s SHA256SUMS has no line for ${exe}`);

    mkdirSync(dir, { recursive: true });
    const part = join(dir, `.${exe}.part-${process.pid}`);
    const fd = openSync(part, 'w');
    let r;
    try {
      r = spawnSync('git', ['-C', tmp, 'cat-file', 'blob', `FETCH_HEAD:${exe}`], { stdio: ['ignore', fd, 'pipe'] });
    } finally { closeSync(fd); }
    if (r.error || r.status !== 0) { rmSync(part, { force: true }); die(`${ref} has no ${exe}`); }
    const got = sha256(part);
    if (got !== want) { rmSync(part, { force: true }); die(`checksum mismatch for ${exe} in ${ref}: expected ${want}, got ${got}`); }
    chmodSync(part, 0o755);
    renameSync(part, join(dir, exe));
    return join(dir, exe);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(argv) {
  const pkgDir = packageRoot(here);
  const pkg = (pkgDir && readJson(join(pkgDir, 'package.json'))) || die('cannot find this package\'s package.json');
  const t = resolveTarget({ env: process.env, pkgDir, pkg });
  if (t.error) die(t.error);
  const plat = platformKey();
  const exe = process.platform === 'win32' ? `${t.tool}.exe` : t.tool;
  const dir = installDir({ env: process.env, tool: t.tool, version: t.version, plat });
  const bin = join(dir, exe);

  // Installed already? A release's dist ref never moves, so an existing binary is that release's
  // — re-fetching on every run would make every invocation a network round-trip.
  if (!existsSync(bin)) install({ origin: t.origin, version: t.version, plat, exe, dir });

  const args = argv.filter((a) => a !== '--print-path');
  if (args.length !== argv.length) { process.stdout.write(`${bin}\n`); return 0; }
  const r = spawnSync(bin, args, { stdio: 'inherit' });
  if (r.error) die(`could not run ${bin}: ${r.error.message}`);
  if (r.signal) process.kill(process.pid, r.signal);
  return r.status ?? 1;
}

// Run only as the entry point, so a test can import the helpers above. realpath, because npm
// runs a bin through a symlink in node_modules/.bin.
function isEntry() {
  try { return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (process.argv[1] && isEntry()) {
  process.exit(main(process.argv.slice(2)));
}
