#!/usr/bin/env node
// npx service manager — TEMPLATE. Copy me into your repo NEXT TO your copy of npx-launcher.mjs
// (e.g. `colab template npx-service.mjs --dest bin/service.mjs` and
// `colab template npx-launcher.mjs --dest bin/npx-launcher.mjs`) and point your root
// package.json's `bin` at THIS copy. YOU OWN THE COPY.
//
// WHAT IT IS FOR. CONVENTIONS.md §6, *Services over npx* (#465): a tool that runs as a per-machine
// service (a dashboard, a daemon, a JS app a launch agent serves) installs, updates and rolls back
// through three verbs, and never runs from npx's cache:
//
//   npx github:<org>/<repo>#vX.Y.Z init [--channel next|stable] [--health-url URL]
//                                       [--auto-update <interval> | --no-auto-update]
//   <tool> update [--check] [--version vX.Y.Z] [--channel next|stable]
//   <tool> rollback
//   <tool> status
//   <tool> uninstall [--purge]
//
// Anything else on the command line is the tool's own: it runs the CURRENT version's payload.
//
// LAYOUT (every path per user, none inside the package npx unpacked):
//
//   $XDG_DATA_HOME/<tool>/          (default ~/.local/share/<tool>, macOS too — no spaces in a plist)
//     vX.Y.Z/pkg/                   the package at that version (an npm prefix: node_modules/<name>/…)
//     vX.Y.Z/<os>-<arch>/<tool>     KIND 'binary' only — exactly where npx-launcher.mjs installs it
//     vX.Y.Z/app/                   KIND 'dist' only — the prebuilt app, unpacked from its tarball
//     current  -> vX.Y.Z            the launch agent and the shim go THROUGH this link, so an update
//     previous -> vW.Y.Z            or a rollback is one atomic rename, never a rewritten unit
//   $XDG_CONFIG_HOME/<tool>/        (0700) install.json {origin, channel, healthUrl?} + YOUR config
//                                   and secrets — never in the package, the install dir or the unit
//   $XDG_STATE_HOME/<tool>/         (0700) logs, update.lock, your runtime state
//   ~/.local/bin/<tool>             a small sh shim: the verbs above → this file at `current`,
//                                   anything else → the current payload
//
// UPDATE IS A TRANSACTION. The new version is installed side by side FIRST (a failed fetch or
// build changes nothing), then `current` is pointed at it and the service restarted. If the
// health check fails, `current` is pointed back, the service restarted again, and the command
// exits 1 — "switched back". `rollback` is the same switch to `previous`; run it twice to toggle.
//
// A CHANNEL IS RESOLVED TO A VERSION, never installed as one. `update` asks the origin (same git,
// same URL as npx used, so the same credentials) for the channel branch's tip and the release tag
// on it — `stable` → the highest final, `next` → the highest release tag — and installs exactly
// that `vX.Y.Z`. A tip with no release tag refuses. `update --version vX.Y.Z` pins: later
// `update`s report "pinned" until `--channel` is given again.
//
// HEALTH. With a health URL (install.json, env <TOOL>_HEALTH_URL, or HEALTH_URL below): poll it
// until a 2xx body reports the version just switched to. Without one: the service manager must
// report the service running after a settle period. <TOOL>_HEALTH_TIMEOUT_MS overrides the wait.
//
// THREE KINDS. 'binary': a compiled tool; the service runs the binary from the platform's dist ref.
// 'package': a JS app that runs from its package (built by `prepare` if it needs building).
// 'dist': a JS app whose build cannot run on the target (#470) — the release ships its output
// prebuilt as ONE tarball (DIST_FILE) in the platform-neutral dist ref refs/tags/dist/vX.Y.Z/any
// (templates/dist-refs.yml with `platforms: any`, `bin: <DIST_FILE>`). It is fetched and verified
// against that ref's SHA256SUMS exactly as the launcher fetches a binary, then unpacked into
// vX.Y.Z/app/, and the service runs app/ENTRY with node. The package itself is still installed
// beside it (vX.Y.Z/pkg/) because this manager lives there. Build the tarball with its files at
// the top level: `tar -czf <DIST_FILE> -C <build-output-dir> .` — an absolute or `..` entry is
// refused before anything is unpacked.
//
// AUTO-UPDATE (#471) is a timer that runs the same `update`, never a second mechanism. Opt in with
// `init --auto-update 6h` (seconds, or a number with s/m/h/d; at least 60s), opt out with
// `init --no-auto-update`; AUTO_UPDATE below sets the default for a first init. macOS: a second
// launchd agent (<label>.update) with StartInterval. Linux: a systemd user <unit>-update.service
// (oneshot) plus <unit>-update.timer. Its output goes to update.out.log / update.err.log in the
// state dir. A pinned install's timer runs and changes nothing ("pinned"), as `update` does.
//
// UNINSTALL (#472) unloads the timer and the service, deletes their unit files, the shim (only if
// this template wrote it) and the whole data dir — every installed version. The config and state
// dirs stay, so a later init picks up the same config; `--purge` deletes them too.
//
// SERVICE MANAGERS. macOS: a launchd agent in ~/Library/LaunchAgents (bootstrap, kickstart -k).
// Linux: a systemd user unit in $XDG_CONFIG_HOME/systemd/user (enable --now, restart). A Linux
// service that must outlive the login session needs `loginctl enable-linger` — `init` prints it,
// never runs it. <TOOL>_SERVICE_MANAGER=none skips the manager entirely (a container, a unit you
// manage yourself). Windows is refused.
//
// Node >= 18, zero dependencies; needs `git` (and `npm` for `update`; `tar` for KIND 'dist'). The unit carries only the
// LOCATIONS of config and state (<TOOL>_CONFIG_DIR, <TOOL>_STATE_DIR) — never a secret value.

import { spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync,
  renameSync, rmSync, symlinkSync, writeFileSync, writeSync, realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// EDIT: the path of YOUR copy of templates/npx-launcher.mjs, relative to this file.
import * as launcher from './npx-launcher.mjs';

// ---- EDIT POINTS ----------------------------------------------------------------------------
// 'binary': a compiled tool shipped as dist refs (templates/dist-refs.yml); the service runs the
//           binary npx-launcher.mjs installs. 'package': a JS app; the service runs ENTRY with node.
// 'dist':   a prebuilt JS app shipped as ONE tarball in the dist ref `dist/vX.Y.Z/any`; the
//           service runs app/ENTRY with node (THREE KINDS, above).
const KIND = 'binary';
// The launchd label / systemd unit name. null = `local.<tool>` (launchd) and `<tool>` (systemd).
const LABEL = null;
// Arguments the service is started with (KIND 'binary': the binary's; 'package': ENTRY's).
const SERVICE_ARGS = ['serve'];
// KIND 'package': the file node runs, relative to the package root. KIND 'dist': relative to the
// unpacked tarball's root.
const ENTRY = 'server.mjs';
// KIND 'dist': the tarball's name inside the `any` dist ref. null = `<tool>.tgz`.
const DIST_FILE = null;
// The auto-update interval a FIRST init uses when no --auto-update/--no-auto-update is given
// (e.g. '6h'), or null for none. Re-running init keeps whatever the install already records.
const AUTO_UPDATE = null;
// A URL reporting the running version (e.g. http://127.0.0.1:8080/version), or null.
const HEALTH_URL = null;
// How many versions to keep side by side (current and previous are never pruned).
const KEEP = 3;
// The verbs this file owns. They shadow the tool's own subcommands of the same names — rename
// them here (e.g. 'self-update') if your tool already has an `update`.
const VERBS = { init: 'init', update: 'update', rollback: 'rollback', status: 'status', uninstall: 'uninstall' };
// ----------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const DIST_PLAT = 'any';
const SHIM_MARK = 'npx-service.mjs, #465';

/** Every per-user location, from the environment. Pure. */
export function paths({ env, home, tool }) {
  const data = env.XDG_DATA_HOME || join(home, '.local', 'share');
  const config = env.XDG_CONFIG_HOME || join(home, '.config');
  const state = env.XDG_STATE_HOME || join(home, '.local', 'state');
  return {
    root: join(data, tool),
    config: join(config, tool),
    state: join(state, tool),
    shim: join(home, '.local', 'bin', tool),
    systemdDir: join(config, 'systemd', 'user'),
    launchAgents: join(home, 'Library', 'LaunchAgents'),
  };
}

export function envPrefix(tool) {
  return tool.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** `<tool> update --check --channel next` → { verb, flags, rest }. Pure. */
export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = a.match(/^--(check|purge|no-auto-update|version|channel|health-url|auto-update)(?:=(.*))?$/);
    if (!m) { rest.push(a); continue; }
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (['check', 'purge', 'noAutoUpdate'].includes(key)) { flags[key] = true; continue; }
    const v = m[2] !== undefined ? m[2] : argv[++i];
    if (v === undefined) return { error: `--${m[1]} needs a value` };
    flags[key] = v;
  }
  return { flags, rest };
}

/** `6h` / `30m` / `1d` / `900s` / `900` → seconds; anything else, or under 60s, → null. Pure. */
export function parseInterval(s) {
  const m = String(s ?? '').trim().match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return null;
  const n = Number(m[1]) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2].toLowerCase()];
  return n >= 60 ? n : null;
}

/** Seconds → the shortest exact `Nd` / `Nh` / `Nm` / `Ns`. Pure. */
export function formatInterval(sec) {
  for (const [u, n] of [['d', 86400], ['h', 3600], ['m', 60]]) if (sec % n === 0) return `${sec / n}${u}`;
  return `${sec}s`;
}

/** A git URL npm will install from. */
export function npmSpec(origin, version) {
  let o = origin;
  if (o.startsWith('/')) o = `git+file://${o}`;
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(o) && !o.startsWith('git+')) o = `git+${o}`;
  return `${o}#${version}`;
}

/** Same rule as templates/deploy-container-run.mjs: the version as a whole token, `v` optional. */
export function reportsVersion(body, version) {
  const v = String(version).replace(/^v/, '').replace(/\./g, '\\.');
  return new RegExp(`(?<![0-9.])v?${v}(?![0-9]|\\.[0-9])`).test(String(body || ''));
}

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** What the service runs — always through `current`, never through npx's cache. Pure. */
export function unitSpec({ kind = KIND, tool, name, root, state, config, execPath, plat, envPath, label = LABEL, args = SERVICE_ARGS, entry = ENTRY }) {
  const cur = join(root, 'current');
  const programArgs = kind === 'binary'
    ? [join(cur, plat, tool), ...args]
    : kind === 'dist'
      ? [execPath, join(cur, 'app', entry), ...args]
      : [execPath, join(cur, 'pkg', 'node_modules', name, entry), ...args];
  const P = envPrefix(tool);
  return {
    label: label || `local.${tool}`,
    unitName: `${label || tool}.service`,
    programArgs,
    env: { [`${P}_CONFIG_DIR`]: config, [`${P}_STATE_DIR`]: state, PATH: envPath },
    logOut: join(state, `${tool}.out.log`),
    logErr: join(state, `${tool}.err.log`),
  };
}

export function renderLaunchd(spec) {
  const args = spec.programArgs.map((a) => `    <string>${xml(a)}</string>`).join('\n');
  const env = Object.entries(spec.env).filter(([, v]) => v).map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
${spec.startInterval ? `  <key>StartInterval</key>
  <integer>${Number(spec.startInterval)}</integer>
  <key>RunAtLoad</key>
  <false/>` : `  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>`}
  <key>StandardOutPath</key>
  <string>${xml(spec.logOut)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(spec.logErr)}</string>
</dict>
</plist>
`;
}

export function renderSystemd(spec) {
  const q = (a) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(a) ? a : `"${String(a).replace(/(["\\])/g, '\\$1')}"`);
  const env = Object.entries(spec.env).filter(([, v]) => v).map(([k, v]) => `Environment=${q(`${k}=${v}`)}`).join('\n');
  return `[Unit]
Description=${spec.label}

[Service]
ExecStart=${spec.programArgs.map(q).join(' ')}
${env}
Restart=on-failure
StandardOutput=append:${spec.logOut}
StandardError=append:${spec.logErr}

[Install]
WantedBy=default.target
`;
}

/** The auto-update timer's oneshot service: runs `update` once, then exits. Pure. */
export function renderSystemdOneshot(spec) {
  return renderSystemd(spec)
    .replace(/^Restart=on-failure\n/m, '')
    .replace(/^\[Service\]$/m, '[Service]\nType=oneshot')
    .replace(/\n\[Install\]\nWantedBy=default\.target\n$/, '\n');
}

export function renderSystemdTimer(spec) {
  return `[Unit]
Description=${spec.label} (timer)

[Timer]
OnBootSec=${spec.startInterval}s
OnUnitActiveSec=${spec.startInterval}s
Unit=${spec.unitName}

[Install]
WantedBy=timers.target
`;
}

/**
 * The auto-update timer's spec: `<this manager at current> update`, every `interval` seconds,
 * with the same XDG bases the install was made under (a launchd/systemd job does not inherit the
 * shell's), so the update it runs finds the same install. Pure.
 */
export function timerSpec({ spec, tool, name, p, execPath, serviceRel, interval, verbs = VERBS }) {
  const base = spec.unitName.replace(/\.service$/, '');
  return {
    label: `${spec.label}.update`,
    unitName: `${base}-update.service`,
    timerName: `${base}-update.timer`,
    startInterval: interval,
    programArgs: [execPath, join(p.root, 'current', 'pkg', 'node_modules', name, serviceRel), verbs.update],
    env: {
      ...spec.env,
      XDG_DATA_HOME: dirname(p.root), XDG_CONFIG_HOME: dirname(p.config), XDG_STATE_HOME: dirname(p.state),
    },
    logOut: join(p.state, 'update.out.log'),
    logErr: join(p.state, 'update.err.log'),
  };
}

/** The timer's unit files and the manager's argv to load / unload it. Pure. */
export function timerCommands(platform, { uid, tspec, p }) {
  if (platform === 'darwin') {
    const unitPath = join(p.launchAgents, `${tspec.label}.plist`);
    const target = `gui/${uid}/${tspec.label}`;
    return {
      files: [[unitPath, renderLaunchd(tspec)]],
      load: [['launchctl', 'bootout', target, '?'], ['launchctl', 'bootstrap', `gui/${uid}`, unitPath]],
      unload: [['launchctl', 'bootout', target, '?']],
    };
  }
  return {
    files: [[join(p.systemdDir, tspec.unitName), renderSystemdOneshot(tspec)], [join(p.systemdDir, tspec.timerName), renderSystemdTimer(tspec)]],
    load: [['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', '--now', tspec.timerName]],
    unload: [['systemctl', '--user', 'disable', '--now', tspec.timerName, '?']],
  };
}

/** The unit file's path and the manager's argv for each step. Pure. */
export function managerCommands(platform, { uid, spec, p }) {
  if (platform === 'darwin') {
    const unitPath = join(p.launchAgents, `${spec.label}.plist`);
    const target = `gui/${uid}/${spec.label}`;
    return {
      unitPath,
      render: renderLaunchd,
      load: [['launchctl', 'bootout', target, '?'], ['launchctl', 'bootstrap', `gui/${uid}`, unitPath]],
      unload: [['launchctl', 'bootout', target, '?']],
      forget: [],
      restart: [['launchctl', 'kickstart', '-k', target]],
      status: ['launchctl', 'print', target],
      running: (r) => r.status === 0 && /\bstate = running\b/.test(r.stdout || ''),
    };
  }
  const unitPath = join(p.systemdDir, spec.unitName);
  return {
    unitPath,
    render: renderSystemd,
    load: [['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', '--now', spec.unitName]],
    unload: [['systemctl', '--user', 'disable', '--now', spec.unitName, '?']],
    forget: [['systemctl', '--user', 'daemon-reload', '?']],
    restart: [['systemctl', '--user', 'restart', spec.unitName]],
    status: ['systemctl', '--user', 'is-active', spec.unitName],
    running: (r) => r.status === 0,
  };
}

/** The ~/.local/bin shim: verbs → this manager at `current`; anything else → the payload. Pure. */
export function renderShim({ kind = KIND, root, tool, name, plat, execPath, entry = ENTRY, verbs = VERBS, serviceRel }) {
  const cur = `"$ROOT/current"`;
  const manager = `${cur}/pkg/node_modules/${name}/${serviceRel}`;
  const payload = kind === 'binary'
    ? `exec ${cur}/${plat}/${tool} "$@"`
    : kind === 'dist'
      ? `exec ${shq(execPath)} ${cur}/app/${entry} "$@"`
      : `exec ${shq(execPath)} ${cur}/pkg/node_modules/${name}/${entry} "$@"`;
  return `#!/bin/sh
# Written by \`${tool} ${verbs.init}\` (${SHIM_MARK}). Re-run init to rewrite it.
ROOT=${shq(root)}
case "\${1:-}" in
  ${Object.values(verbs).join('|')}) exec ${shq(execPath)} ${manager} "$@" ;;
esac
${payload}
`;
}

// ---- filesystem -------------------------------------------------------------------------------

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

export function readInstall(p) {
  return readJson(join(p.config, 'install.json'));
}

function writeInstall(p, rec) {
  mkdirSync(p.config, { recursive: true, mode: 0o700 });
  const f = join(p.config, 'install.json');
  writeFileSync(`${f}.tmp`, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${f}.tmp`, f);
}

export function readLink(root, name) {
  try { return basename(readlinkSync(join(root, name))); } catch { return null; }
}

/** Point `root/name` at `version`, atomically (symlink beside it, then rename over it). */
export function pointTo(root, name, version) {
  const tmp = join(root, `.${name}.${process.pid}`);
  rmSync(tmp, { force: true });
  symlinkSync(version, tmp);
  renameSync(tmp, join(root, name));
}

export function installedVersions(root) {
  let names = [];
  try { names = readdirSync(root); } catch { return []; }
  return names.filter((n) => launcher.VERSION_RE.test(n)).sort(launcher.compareVersions);
}

/** Remove all but `keep` newest versions, never `current` or `previous`. Returns what went. */
export function prune(root, keep = KEEP) {
  const all = installedVersions(root);
  const pinned = new Set([readLink(root, 'current'), readLink(root, 'previous')]);
  const newest = new Set(all.slice(-keep));
  const gone = all.filter((v) => !pinned.has(v) && !newest.has(v));
  for (const v of gone) rmSync(join(root, v), { recursive: true, force: true });
  return gone;
}

/** One update at a time per user: an O_EXCL lock file holding the pid; a dead holder is stale. */
export function withLock(stateDir, fn) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const lock = join(stateDir, 'update.lock');
  let fd;
  try { fd = openSync(lock, 'wx'); } catch {
    const pid = Number(String(readFileSync(lock, 'utf8')).trim());
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
    if (alive) throw new Error(`another update is running (pid ${pid}; ${lock})`);
    rmSync(lock, { force: true });
    fd = openSync(lock, 'wx');
  }
  writeSync(fd, `${process.pid}\n`);
  closeSync(fd);
  const done = () => rmSync(lock, { force: true });
  let out;
  try { out = fn(); } catch (e) { done(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(done);
  done();
  return out;
}

// ---- the transaction --------------------------------------------------------------------------

function ctl(io, steps) {
  for (const s of steps) {
    const tolerant = s[s.length - 1] === '?';
    const argv = tolerant ? s.slice(0, -1) : s;
    const r = io.run(argv[0], argv.slice(1));
    if (r.status !== 0 && !tolerant) throw new Error(`${argv.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  }
}

/** Is `version` the one serving? Health URL if there is one, else the manager's own answer. */
export async function healthy({ version, url, mgr, io }) {
  const until = io.now() + io.timing.timeoutMs;
  if (!url) {
    if (!mgr) return true;          // no manager, no URL: nothing to ask
    await io.sleep(io.timing.settleMs);
    return mgr.running(io.run(mgr.status[0], mgr.status.slice(1)));
  }
  for (;;) {
    try {
      const res = await io.fetch(url);
      const body = await res.text();
      if (res.ok && reportsVersion(body, version)) return true;
    } catch { /* not up yet */ }
    if (io.now() >= until) return false;
    await io.sleep(io.timing.pollMs);
  }
}

/** Point `current` at `to`, restart, check; on failure point back, restart, report. */
export async function switchTo({ to, root, mgr, url, io }) {
  const from = readLink(root, 'current');
  pointTo(root, 'current', to);
  if (mgr) ctl(io, mgr.restart);
  if (await healthy({ version: to, url, mgr, io })) {
    if (from && from !== to) pointTo(root, 'previous', from);
    return { ok: true, from, to };
  }
  if (!from || from === to) return { ok: false, from, to, back: false };
  pointTo(root, 'current', from);
  if (mgr) ctl(io, mgr.restart);
  const backHealthy = await healthy({ version: from, url, mgr, io });
  return { ok: false, from, to, back: true, backHealthy };
}

/** Is `root/version` a complete install for this kind? */
function complete({ root, version, kind, name, tool, plat, entry = ENTRY }) {
  const v = join(root, version);
  if (!existsSync(join(v, 'pkg', 'node_modules', name, 'package.json'))) return false;
  if (kind === 'dist') return existsSync(join(v, 'app', entry));
  return kind !== 'binary' || existsSync(join(v, plat, tool));
}

/** A tarball listing → the first entry that would land outside its target dir, or null. Pure. */
export function unsafeEntry(listing) {
  for (const e of String(listing || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    if (e.startsWith('/') || e.split('/').includes('..')) return e;
  }
  return null;
}

/** KIND 'dist': fetch + verify the tarball from `dist/<version>/any`, unpack it into `dir`. */
export function installDist({ origin, version, dir, file, entry = ENTRY, io }) {
  const tgz = launcher.fetchDistFile({ origin, version, plat: DIST_PLAT, file, dest: join(dirname(dir), `.${file}`), mode: 0o644 });
  try {
    const ls = io.run('tar', ['-tzf', tgz]);
    if (ls.status !== 0) throw new Error(`${file} in dist/${version}/${DIST_PLAT} is not a gzip tarball: ${(ls.stderr || '').trim()}`);
    const bad = unsafeEntry(ls.stdout);
    if (bad) throw new Error(`${file} in dist/${version}/${DIST_PLAT} has an entry outside its root (${bad}) — refusing to unpack it`);
    mkdirSync(dir, { recursive: true });
    const x = io.run('tar', ['-xzf', tgz, '-C', dir]);
    if (x.status !== 0) throw new Error(`could not unpack ${file}: ${(x.stderr || '').trim()}`);
  } finally { rmSync(tgz, { force: true }); }
  if (!existsSync(join(dir, entry))) throw new Error(`${version}: ${file} has no ${entry} at its top level`);
}

/**
 * Install `version` side by side, into a temp dir renamed into place — a failure leaves nothing
 * behind. `fromPkg` (init) copies the package npx already unpacked; otherwise npm fetches it.
 */
export function installVersion({ kind = KIND, version, origin, root, name, tool, plat, fromPkg, entry = ENTRY, distFile, io }) {
  if (complete({ root, version, kind, name, tool, plat, entry })) return join(root, version);
  mkdirSync(root, { recursive: true });
  const tmp = join(root, `.install-${version}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  try {
    const pkg = join(tmp, 'pkg');
    if (fromPkg) {
      cpSync(fromPkg, pkg, { recursive: true, dereference: false });
    } else {
      mkdirSync(pkg, { recursive: true });
      const r = io.run('npm', ['install', '--prefix', pkg, '--omit=dev', '--no-audit', '--no-fund', npmSpec(origin, version)]);
      if (r.status !== 0) throw new Error(`npm could not install ${version}: ${(r.stderr || r.stdout || '').trim()}`);
    }
    if (!existsSync(join(pkg, 'node_modules', name, 'package.json'))) throw new Error(`${version}: the package did not land at node_modules/${name}`);
    if (kind === 'binary') {
      launcher.install({ origin, version, plat, exe: tool, dir: join(tmp, plat) });
    }
    if (kind === 'dist') {
      installDist({ origin, version, dir: join(tmp, 'app'), file: distFile || `${tool}.tgz`, entry, io });
    }
    rmSync(join(root, version), { recursive: true, force: true });
    renameSync(tmp, join(root, version));
    return join(root, version);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

function context(opts, io) {
  const tool = opts.tool;
  const p = paths({ env: io.env, home: io.home, tool });
  const P = envPrefix(tool);
  const plat = launcher.platformKey();
  const spec = unitSpec({
    kind: opts.kind, tool, name: opts.name, root: p.root, state: p.state, config: p.config,
    execPath: io.execPath, plat, envPath: io.env.PATH, label: opts.label, args: opts.args, entry: opts.entry,
  });
  const managed = io.env[`${P}_SERVICE_MANAGER`] !== 'none';
  const mgr = managed ? managerCommands(io.platform, { uid: io.uid, spec, p }) : null;
  // The timer's unit files are known whatever the interval (uninstall and opt-out remove them).
  const tspec = timerSpec({ spec, tool, name: opts.name, p, execPath: io.execPath, serviceRel: opts.serviceRel || 'service.mjs', interval: 0 });
  const timer = managed ? timerCommands(io.platform, { uid: io.uid, tspec, p }) : null;
  return { tool, p, P, plat, spec, mgr, timer, tspec };
}

function healthUrl(rec, P, io, flags = {}) {
  return flags.healthUrl || io.env[`${P}_HEALTH_URL`] || (rec && rec.healthUrl) || HEALTH_URL;
}

function readText(f) {
  try { return readFileSync(f, 'utf8'); } catch { return null; }
}

function writeUnit(c, io, rec) {
  if (!c.mgr) return false;
  const text = c.mgr.render(c.spec);
  if (readText(c.mgr.unitPath) !== text) {
    mkdirSync(dirname(c.mgr.unitPath), { recursive: true });
    writeFileSync(c.mgr.unitPath, text);
    ctl(io, c.mgr.load);
  }
  writeTimer(c, io, rec && rec.autoUpdate);
  return true;
}

/** Write (and load) the auto-update timer for `interval` seconds — or remove it when falsy. */
function writeTimer(c, io, interval) {
  if (!c.timer) return;
  if (!interval) { removeTimer(c, io); return; }
  const t = timerCommands(io.platform, { uid: io.uid, tspec: { ...c.tspec, startInterval: interval }, p: c.p });
  if (t.files.every(([f, text]) => readText(f) === text)) return;
  for (const [f, text] of t.files) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); }
  ctl(io, t.load);
}

/** Unload the timer and delete its unit files, if any are there. Returns the files removed. */
function removeTimer(c, io) {
  if (!c.timer) return [];
  const present = c.timer.files.map(([f]) => f).filter((f) => existsSync(f));
  if (!present.length) return [];
  ctl(io, c.timer.unload);
  for (const f of present) rmSync(f, { force: true });
  ctl(io, c.mgr.forget);
  return present;
}

/**
 * One verb. opts: { tool, name, kind, pkgDir, serviceRel, label, args, entry, distFile }. Returns an exit code.
 * Every refusal happens before anything is written.
 */
export async function run(verb, argv, opts, io) {
  try {
    return await runVerb(verb, argv, opts, io);
  } catch (e) {
    io.err(e.message);
    return 1;
  }
}

async function runVerb(verb, argv, opts, io) {
  if (io.platform === 'win32') { io.err('services are not supported on Windows by this template'); return 1; }
  const a = parseArgs(argv);
  if (a.error) { io.err(a.error); return 1; }
  const { flags } = a;
  if (flags.channel && !launcher.CHANNELS.includes(flags.channel)) { io.err(`--channel must be one of ${launcher.CHANNELS.join(', ')}`); return 1; }
  if (flags.version && !launcher.VERSION_RE.test(flags.version)) { io.err(`--version must be vX.Y.Z or vX.Y.Z-rc.N (got ${flags.version})`); return 1; }
  if (flags.autoUpdate !== undefined && !parseInterval(flags.autoUpdate)) { io.err(`--auto-update must be seconds, or a number with s/m/h/d, at least 60s (got ${flags.autoUpdate})`); return 1; }
  if (flags.autoUpdate !== undefined && flags.noAutoUpdate) { io.err('--auto-update and --no-auto-update contradict each other'); return 1; }
  const kind = opts.kind || KIND;
  const c = context({ ...opts, kind }, io);
  const rec = readInstall(c.p);
  const inst = { kind, name: opts.name, tool: c.tool, plat: c.plat, entry: opts.entry, distFile: opts.distFile, io };

  if (verb === VERBS.status) {
    if (!rec) { io.err(`not installed — run \`npx <origin>#vX.Y.Z ${VERBS.init}\``); return 1; }
    io.out([
      `current:  ${readLink(c.p.root, 'current') || '—'}`,
      `previous: ${readLink(c.p.root, 'previous') || '—'}`,
      `channel:  ${rec.channel}`,
      `origin:   ${rec.origin}`,
      `versions: ${installedVersions(c.p.root).join(' ') || '—'}`,
      `unit:     ${c.mgr ? c.mgr.unitPath : '(no service manager)'}`,
      `auto-update: ${rec.autoUpdate ? `every ${formatInterval(rec.autoUpdate)}` : 'off'}`,
      `node:     ${io.execPath}`,
    ].join('\n'));
    return 0;
  }

  if (verb === VERBS.uninstall) return uninstall(c, flags, io);

  if (verb === VERBS.init) {
    const pkg = readJson(join(opts.pkgDir, 'package.json')) || {};
    const t = launcher.resolveTarget({ env: io.env, pkgDir: opts.pkgDir, pkg });
    if (t.error) { io.err(t.error); return 1; }
    if (!t.version) {
      const ch = launcher.resolveChannel({ origin: t.origin, channel: t.channel, at: t.sha, run: io.git });
      if (ch.error) { io.err(ch.error); return 1; }
      t.version = ch.version;
    }
    const npxRoot = launcher.installerRoot(opts.pkgDir, opts.name);
    if (!npxRoot) { io.err(`run init through npx: \`npx <origin>#${t.version} ${VERBS.init}\` (no installing project above ${opts.pkgDir})`); return 1; }
    return withLock(c.p.state, async () => {
      installVersion({ ...inst, version: t.version, origin: t.origin, root: c.p.root, fromPkg: npxRoot });
      const record = rec || { origin: t.origin, channel: flags.channel || t.channel || 'stable' };
      if (flags.channel) record.channel = flags.channel;
      if (flags.healthUrl) record.healthUrl = flags.healthUrl;
      if (!rec && AUTO_UPDATE && parseInterval(AUTO_UPDATE)) record.autoUpdate = parseInterval(AUTO_UPDATE);
      if (flags.autoUpdate !== undefined) record.autoUpdate = parseInterval(flags.autoUpdate);
      if (flags.noAutoUpdate) delete record.autoUpdate;
      writeInstall(c.p, record);
      mkdirSync(c.p.state, { recursive: true, mode: 0o700 });
      mkdirSync(dirname(c.p.shim), { recursive: true });
      writeFileSync(c.p.shim, renderShim({ kind, root: c.p.root, tool: c.tool, name: opts.name, plat: c.plat, execPath: io.execPath, entry: opts.entry, serviceRel: opts.serviceRel }), { mode: 0o755 });
      chmodSync(c.p.shim, 0o755);
      const first = !readLink(c.p.root, 'current');
      if (first) pointTo(c.p.root, 'current', t.version);   // the unit must find something at load
      writeUnit(c, io, record);
      const s = first
        ? { ok: await healthy({ version: t.version, url: healthUrl(record, c.P, io), mgr: c.mgr, io }), to: t.version }
        : await switchTo({ to: t.version, root: c.p.root, mgr: c.mgr, url: healthUrl(record, c.P, io), io });
      if (!s.ok) {
        if (first && c.mgr) { removeTimer(c, io); ctl(io, c.mgr.unload); }
        io.err(first ? `${t.version} installed but not healthy — service unloaded; see ${c.p.state}` : `${t.version} not healthy — switched back to ${s.from}`);
        return 1;
      }
      io.out(`${c.tool} ${t.version} installed and running (channel ${record.channel}); shim ${c.p.shim}`);
      if (record.autoUpdate) io.out(c.timer ? `auto-update: \`${VERBS.update}\` every ${formatInterval(record.autoUpdate)}; log ${c.tspec.logOut}` : 'auto-update recorded, but no service manager is in use — no timer written');
      if (io.platform === 'linux' && c.mgr) io.out(`to keep it running after logout: loginctl enable-linger ${io.env.USER || '$USER'}`);
      return 0;
    });
  }

  if (verb !== VERBS.update && verb !== VERBS.rollback) { io.err(`unknown verb ${verb}`); return 1; }
  if (!rec) { io.err(`not installed — run \`npx <origin>#vX.Y.Z ${VERBS.init}\` first`); return 1; }
  const cur = readLink(c.p.root, 'current');
  const url = healthUrl(rec, c.P, io);

  if (verb === VERBS.rollback) {
    const prev = readLink(c.p.root, 'previous');
    if (!prev || !existsSync(join(c.p.root, prev))) { io.err('nothing to roll back to — no previous version'); return 1; }
    return withLock(c.p.state, async () => {
      const s = await switchTo({ to: prev, root: c.p.root, mgr: c.mgr, url, io });
      if (!s.ok) { io.err(`${prev} not healthy — switched back to ${s.from}`); return 1; }
      io.out(`rolled back: ${s.from} -> ${prev}`);
      return 0;
    });
  }

  // update
  let target;
  let channel = rec.channel;
  if (flags.version) { target = flags.version; channel = 'pinned'; } else {
    if (flags.channel) channel = flags.channel;
    if (channel === 'pinned') { io.out(`pinned at ${cur} — \`${VERBS.update} --channel stable|next\` to follow a channel again`); return 0; }
    const r = launcher.resolveChannel({ origin: rec.origin, channel, run: io.git });
    if (r.error) { io.err(r.error); return 1; }
    target = r.version;
  }
  if (flags.check) {
    io.out(target === cur ? `up to date: ${cur}` : `update available: ${cur} -> ${target} (${channel})`);
    return 0;
  }
  return withLock(c.p.state, async () => {
    if (channel !== rec.channel) writeInstall(c.p, { ...rec, channel });
    if (target === cur) { io.out(`up to date: ${cur}`); return 0; }
    try {
      installVersion({ ...inst, version: target, origin: rec.origin, root: c.p.root });
    } catch (e) { io.err(`${e.message}\nnothing switched — still on ${cur}`); return 1; }
    writeUnit(c, io, rec);
    const s = await switchTo({ to: target, root: c.p.root, mgr: c.mgr, url, io });
    if (!s.ok) { io.err(`${target} not healthy — switched back to ${s.from}${s.backHealthy ? '' : ' (which is not reporting healthy either)'}`); return 1; }
    const gone = prune(c.p.root);
    io.out(`updated: ${s.from} -> ${target} (${channel})${gone.length ? `; pruned ${gone.join(' ')}` : ''}`);
    return 0;
  });
}

/**
 * Unload and delete the timer and the service unit, the shim (only one this template wrote) and
 * the data dir. Config and state stay unless `--purge`. Safe to re-run: what is gone is skipped.
 */
function uninstall(c, flags, io) {
  const shimText = readText(c.p.shim);
  const ours = shimText !== null && shimText.includes(SHIM_MARK);
  const unit = c.mgr && existsSync(c.mgr.unitPath);
  const timerFiles = c.timer ? c.timer.files.map(([f]) => f).filter((f) => existsSync(f)) : [];
  const data = existsSync(c.p.root);
  const keep = [c.p.config, c.p.state].filter((d) => existsSync(d));
  if (!ours && !unit && !timerFiles.length && !data && !(flags.purge && keep.length)) {
    io.out(`nothing to uninstall — no ${c.tool} install found`);
    return 0;
  }
  const removed = [];
  const work = () => {
    removed.push(...removeTimer(c, io));
    if (unit) {
      ctl(io, c.mgr.unload);
      rmSync(c.mgr.unitPath, { force: true });
      ctl(io, c.mgr.forget);
      removed.push(c.mgr.unitPath);
    }
    if (ours) { rmSync(c.p.shim, { force: true }); removed.push(c.p.shim); }
    if (data) { rmSync(c.p.root, { recursive: true, force: true }); removed.push(c.p.root); }
  };
  // Under the update lock, so a timer-started update cannot install into what is being deleted.
  if (existsSync(c.p.state)) withLock(c.p.state, work); else work();
  if (flags.purge) {
    for (const d of keep) { rmSync(d, { recursive: true, force: true }); removed.push(d); }
  }
  io.out(`${c.tool} uninstalled. removed:\n${removed.map((r) => `  ${r}`).join('\n')}`);
  if (shimText !== null && !ours) io.out(`left ${c.p.shim} in place — this template did not write it`);
  if (!flags.purge && keep.length) io.out(`kept (config and state; \`${VERBS.uninstall} --purge\` deletes them):\n${keep.map((d) => `  ${d}`).join('\n')}`);
  return 0;
}

export function defaultIo(env = process.env) {
  return {
    env,
    platform: process.platform,
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    home: env.HOME || homedir(),
    execPath: process.execPath,
    run: (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', env }),
    git: (args) => spawnSync('git', args, { encoding: 'utf8', env }),
    fetch: (url) => fetch(url),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    timing: { timeoutMs: 60000, pollMs: 1000, settleMs: 3000 },
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`npx-service: ${s}\n`),
  };
}

async function main(argv) {
  const pkgDir = launcher.packageRoot(here);
  const pkg = (pkgDir && readJson(join(pkgDir, 'package.json'))) || {};
  const name = pkg.name;
  if (!name) { process.stderr.write('npx-service: cannot find this package\'s package.json\n'); return 1; }
  const tool = name.replace(/^@[^/]+\//, '');
  const verb = argv[0];
  if (!Object.values(VERBS).includes(verb)) {
    // Not ours: the tool's own command line, run from the CURRENT install — never from npx's cache.
    if (KIND === 'binary') return launcher.main(argv, here);
    let entry = join(pkgDir, ENTRY);
    if (KIND === 'dist') {
      // The prebuilt app is not in the package — it exists only in an install.
      entry = join(paths({ env: process.env, home: process.env.HOME || homedir(), tool }).root, 'current', 'app', ENTRY);
      if (!existsSync(entry)) { process.stderr.write(`npx-service: ${tool} is not installed — run \`npx <origin>#vX.Y.Z ${VERBS.init}\` first\n`); return 1; }
    }
    const r = spawnSync(process.execPath, [entry, ...argv], { stdio: 'inherit' });
    return r.status ?? 1;
  }
  const io = defaultIo(process.env);
  const ms = Number(process.env[`${envPrefix(tool)}_HEALTH_TIMEOUT_MS`]);
  if (ms) io.timing.timeoutMs = ms;
  return run(verb, argv.slice(1), { tool, name, kind: KIND, pkgDir, distFile: DIST_FILE, serviceRel: relative(pkgDir, fileURLToPath(import.meta.url)) }, io);
}

function isEntry() {
  try { return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (process.argv[1] && isEntry()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
