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
//   <tool> update [--check] [--version vX.Y.Z] [--channel next|stable]
//   <tool> rollback
//   <tool> status
//
// Anything else on the command line is the tool's own: it runs the CURRENT version's payload.
//
// LAYOUT (every path per user, none inside the package npx unpacked):
//
//   $XDG_DATA_HOME/<tool>/          (default ~/.local/share/<tool>, macOS too — no spaces in a plist)
//     vX.Y.Z/pkg/                   the package at that version (an npm prefix: node_modules/<name>/…)
//     vX.Y.Z/<os>-<arch>/<tool>     KIND 'binary' only — exactly where npx-launcher.mjs installs it
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
// SERVICE MANAGERS. macOS: a launchd agent in ~/Library/LaunchAgents (bootstrap, kickstart -k).
// Linux: a systemd user unit in $XDG_CONFIG_HOME/systemd/user (enable --now, restart). A Linux
// service that must outlive the login session needs `loginctl enable-linger` — `init` prints it,
// never runs it. <TOOL>_SERVICE_MANAGER=none skips the manager entirely (a container, a unit you
// manage yourself). Windows is refused.
//
// Node >= 18, zero dependencies; needs `git` (and `npm` for `update`). The unit carries only the
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
const KIND = 'binary';
// The launchd label / systemd unit name. null = `local.<tool>` (launchd) and `<tool>` (systemd).
const LABEL = null;
// Arguments the service is started with (KIND 'binary': the binary's; 'package': ENTRY's).
const SERVICE_ARGS = ['serve'];
// KIND 'package': the file node runs, relative to the package root.
const ENTRY = 'server.mjs';
// A URL reporting the running version (e.g. http://127.0.0.1:8080/version), or null.
const HEALTH_URL = null;
// How many versions to keep side by side (current and previous are never pruned).
const KEEP = 3;
// The verbs this file owns. They shadow the tool's own subcommands of the same names — rename
// them here (e.g. 'self-update') if your tool already has an `update`.
const VERBS = { init: 'init', update: 'update', rollback: 'rollback', status: 'status' };
// ----------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));

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
    const m = a.match(/^--(check|version|channel|health-url)(?:=(.*))?$/);
    if (!m) { rest.push(a); continue; }
    if (m[1] === 'check') { flags.check = true; continue; }
    const v = m[2] !== undefined ? m[2] : argv[++i];
    if (v === undefined) return { error: `--${m[1]} needs a value` };
    flags[m[1] === 'health-url' ? 'healthUrl' : m[1]] = v;
  }
  return { flags, rest };
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
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
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
    : `exec ${shq(execPath)} ${cur}/pkg/node_modules/${name}/${entry} "$@"`;
  return `#!/bin/sh
# Written by \`${tool} ${verbs.init}\` (npx-service.mjs, #465). Re-run init to rewrite it.
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
function complete({ root, version, kind, name, tool, plat }) {
  const v = join(root, version);
  if (!existsSync(join(v, 'pkg', 'node_modules', name, 'package.json'))) return false;
  return kind !== 'binary' || existsSync(join(v, plat, tool));
}

/**
 * Install `version` side by side, into a temp dir renamed into place — a failure leaves nothing
 * behind. `fromPkg` (init) copies the package npx already unpacked; otherwise npm fetches it.
 */
export function installVersion({ kind = KIND, version, origin, root, name, tool, plat, fromPkg, io }) {
  if (complete({ root, version, kind, name, tool, plat })) return join(root, version);
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
  return { tool, p, P, plat, spec, mgr };
}

function healthUrl(rec, P, io, flags = {}) {
  return flags.healthUrl || io.env[`${P}_HEALTH_URL`] || (rec && rec.healthUrl) || HEALTH_URL;
}

function writeUnit(c, io) {
  if (!c.mgr) return false;
  const text = c.mgr.render(c.spec);
  let old = null;
  try { old = readFileSync(c.mgr.unitPath, 'utf8'); } catch { /* none yet */ }
  if (old === text) return false;
  mkdirSync(dirname(c.mgr.unitPath), { recursive: true });
  writeFileSync(c.mgr.unitPath, text);
  ctl(io, c.mgr.load);
  return true;
}

/**
 * One verb. opts: { tool, name, kind, pkgDir, serviceRel, label, args, entry }. Returns an exit code.
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
  const kind = opts.kind || KIND;
  const c = context({ ...opts, kind }, io);
  const rec = readInstall(c.p);

  if (verb === VERBS.status) {
    if (!rec) { io.err(`not installed — run \`npx <origin>#vX.Y.Z ${VERBS.init}\``); return 1; }
    io.out([
      `current:  ${readLink(c.p.root, 'current') || '—'}`,
      `previous: ${readLink(c.p.root, 'previous') || '—'}`,
      `channel:  ${rec.channel}`,
      `origin:   ${rec.origin}`,
      `versions: ${installedVersions(c.p.root).join(' ') || '—'}`,
      `unit:     ${c.mgr ? c.mgr.unitPath : '(no service manager)'}`,
      `node:     ${io.execPath}`,
    ].join('\n'));
    return 0;
  }

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
      installVersion({ kind, version: t.version, origin: t.origin, root: c.p.root, name: opts.name, tool: c.tool, plat: c.plat, fromPkg: npxRoot, io });
      const record = rec || { origin: t.origin, channel: flags.channel || t.channel || 'stable' };
      if (flags.channel) record.channel = flags.channel;
      if (flags.healthUrl) record.healthUrl = flags.healthUrl;
      writeInstall(c.p, record);
      mkdirSync(c.p.state, { recursive: true, mode: 0o700 });
      mkdirSync(dirname(c.p.shim), { recursive: true });
      writeFileSync(c.p.shim, renderShim({ kind, root: c.p.root, tool: c.tool, name: opts.name, plat: c.plat, execPath: io.execPath, entry: opts.entry, serviceRel: opts.serviceRel }), { mode: 0o755 });
      chmodSync(c.p.shim, 0o755);
      const first = !readLink(c.p.root, 'current');
      if (first) pointTo(c.p.root, 'current', t.version);   // the unit must find something at load
      writeUnit(c, io);
      const s = first
        ? { ok: await healthy({ version: t.version, url: healthUrl(record, c.P, io), mgr: c.mgr, io }), to: t.version }
        : await switchTo({ to: t.version, root: c.p.root, mgr: c.mgr, url: healthUrl(record, c.P, io), io });
      if (!s.ok) {
        if (first && c.mgr) ctl(io, c.mgr.unload);
        io.err(first ? `${t.version} installed but not healthy — service unloaded; see ${c.p.state}` : `${t.version} not healthy — switched back to ${s.from}`);
        return 1;
      }
      io.out(`${c.tool} ${t.version} installed and running (channel ${record.channel}); shim ${c.p.shim}`);
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
      installVersion({ kind, version: target, origin: rec.origin, root: c.p.root, name: opts.name, tool: c.tool, plat: c.plat, io });
    } catch (e) { io.err(`${e.message}\nnothing switched — still on ${cur}`); return 1; }
    writeUnit(c, io);
    const s = await switchTo({ to: target, root: c.p.root, mgr: c.mgr, url, io });
    if (!s.ok) { io.err(`${target} not healthy — switched back to ${s.from}${s.backHealthy ? '' : ' (which is not reporting healthy either)'}`); return 1; }
    const gone = prune(c.p.root);
    io.out(`updated: ${s.from} -> ${target} (${channel})${gone.length ? `; pruned ${gone.join(' ')}` : ''}`);
    return 0;
  });
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
    const r = spawnSync(process.execPath, [join(pkgDir, ENTRY), ...argv], { stdio: 'inherit' });
    return r.status ?? 1;
  }
  const io = defaultIo(process.env);
  const ms = Number(process.env[`${envPrefix(tool)}_HEALTH_TIMEOUT_MS`]);
  if (ms) io.timing.timeoutMs = ms;
  return run(verb, argv.slice(1), { tool, name, kind: KIND, pkgDir, serviceRel: relative(pkgDir, fileURLToPath(import.meta.url)) }, io);
}

function isEntry() {
  try { return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}
if (process.argv[1] && isEntry()) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
