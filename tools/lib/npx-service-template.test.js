'use strict';
/**
 * templates/npx-service.mjs (+ the channel half of templates/npx-launcher.mjs) — per-machine
 * services over npx (#465). Run: node --test tools/lib/npx-service-template.test.js
 *
 * End to end against a local bare repo standing in for a private origin: three releases
 * (v1.0.0, v1.1.0, v1.2.0-rc.1), each with a hand-built dist ref whose "binary" prints its version,
 * `stable` and `next` channel branches, PATH shims standing in for systemctl/launchctl (they log
 * their argv) and npm (a git clone into the prefix), and an in-process HTTP health endpoint that
 * reports whatever `current` points at — unless that version is marked broken. What each assertion
 * protects:
 *
 *   - a channel is resolved to the release tag at its tip, never installed as a ref;
 *   - init installs side by side under the per-user data dir, writes the unit through `current`
 *     (never npx's cache), and writes nothing into the package npx unpacked;
 *   - `update --check` writes nothing at all; `update` switches and records `previous`;
 *   - an unhealthy update switches back and exits 1; `rollback` toggles;
 *   - `--version` pins; refusals change nothing.
 */

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVICE = path.join(ROOT, 'templates', 'npx-service.mjs');
const LAUNCHER = path.join(ROOT, 'templates', 'npx-launcher.mjs');
const PLAT = `${process.platform}-${process.arch}`;
const posix = process.platform !== 'win32';
const NAME = 'probe-svc';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
const gitIn = (cwd, input, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, input, encoding: 'utf8' }).trim();

const load = () => import(pathToFileURL(SERVICE).href);
const loadLauncher = () => import(pathToFileURL(LAUNCHER).href);

/** A dist ref for `version` holding a binary that prints `<NAME> <version>: <args>`. */
function pushDistRef(work, version) {
  const body = `#!/bin/sh\necho "${NAME} ${version}: $*"\n`;
  const sum = require('crypto').createHash('sha256').update(body).digest('hex');
  const bin = gitIn(work, body, 'hash-object', '-w', '--stdin');
  const sums = gitIn(work, `${sum}  ${NAME}\n`, 'hash-object', '-w', '--stdin');
  const tree = gitIn(work, `100644 blob ${sums}\tSHA256SUMS\n100755 blob ${bin}\t${NAME}\n`, 'mktree');
  const commit = git(work, 'commit-tree', tree, '-m', `dist ${version}`);
  git(work, 'push', '-q', 'origin', `${commit}:refs/tags/dist/${version}/${PLAT}`);
}

/** Commit the package (manifest + both templates) at `version` and tag it. */
function release(work, version, { annotated = false } = {}) {
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: NAME, private: true, version: version.replace(/^v|-rc\.\d+$/g, ''), bin: { [NAME]: 'service.mjs' } }));
  git(work, 'add', '-A');
  git(work, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', `release ${version}`, '--allow-empty');
  if (annotated) git(work, 'tag', '-a', version, '-m', version); else git(work, 'tag', version);
  git(work, 'push', '-q', 'origin', 'HEAD:main', version);
  pushDistRef(work, version);
  return git(work, 'rev-parse', 'HEAD');
}

function moveChannel(work, channel, version) {
  git(work, 'push', '-q', '-f', 'origin', `${version}^{commit}:refs/heads/${channel}`);
}

function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'npx-service-')));
  const origin = path.join(base, 'origin.git');
  const work = path.join(base, 'work');
  git(base, 'init', '-q', '--bare', origin);
  git(base, 'init', '-q', '-b', 'main', work);
  fs.copyFileSync(SERVICE, path.join(work, 'service.mjs'));
  fs.copyFileSync(LAUNCHER, path.join(work, 'npx-launcher.mjs'));
  git(work, 'remote', 'add', 'origin', origin);
  const shas = {};
  shas['v1.0.0'] = release(work, 'v1.0.0');
  shas['v1.1.0'] = release(work, 'v1.1.0', { annotated: true });
  shas['v1.2.0-rc.1'] = release(work, 'v1.2.0-rc.1');
  moveChannel(work, 'stable', 'v1.1.0');
  moveChannel(work, 'next', 'v1.2.0-rc.1');

  const home = path.join(base, 'home');
  const shim = path.join(base, 'shim');
  fs.mkdirSync(home); fs.mkdirSync(shim);
  const ctlLog = path.join(base, 'ctl.log');
  for (const c of ['systemctl', 'launchctl']) {
    fs.writeFileSync(path.join(shim, c), `#!/bin/sh\necho "${c} $*" >> '${ctlLog}'\n`, { mode: 0o755 });
  }
  // npm: `npm install --prefix DIR … git+file:///origin#vX` → a clone at DIR/node_modules/<name>.
  fs.writeFileSync(path.join(shim, 'npm'), `#!/bin/sh
prefix=; spec=
while [ $# -gt 0 ]; do case "$1" in --prefix) prefix=$2; shift ;; install|--*) ;; *) spec=$1 ;; esac; shift; done
url=\${spec%%#*}; ref=\${spec#*#}; url=\${url#git+}; url=\${url#file://}
git clone -q --depth 1 -b "$ref" "$url" "$prefix/.clone" 2>/dev/null || { echo "npm: cannot fetch $spec" >&2; exit 1; }
mkdir -p "$prefix/node_modules" && mv "$prefix/.clone" "$prefix/node_modules/${NAME}"
`, { mode: 0o755 });
  const env = {
    ...GIT_ENV,
    HOME: home,
    XDG_DATA_HOME: path.join(home, 'data'),
    XDG_CONFIG_HOME: path.join(home, 'config'),
    XDG_STATE_HOME: path.join(home, 'state'),
    PATH: `${shim}${path.delimiter}${process.env.PATH}`,
  };
  return { base, origin, work, home, ctlLog, env, shas, root: path.join(home, 'data', NAME) };
}

/** Lay the package out the way npx installs `git+file://<origin>#<spec>`, at release `version`. */
function npxLayout(fx, spec, version = spec) {
  const cache = path.join(fx.base, `npx-${spec}`);
  const pkgDir = path.join(cache, 'node_modules', NAME);
  fs.mkdirSync(path.dirname(pkgDir), { recursive: true });
  git(fx.base, '-c', 'advice.detachedHead=false', 'clone', '-q', '-b', version, fx.origin, pkgDir);
  fs.rmSync(path.join(pkgDir, '.git'), { recursive: true });
  const url = `git+file://${fx.origin}`;
  fs.writeFileSync(path.join(cache, 'package.json'), JSON.stringify({ dependencies: { [NAME]: `${url}#${spec}` } }));
  fs.writeFileSync(path.join(cache, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: { [`node_modules/${NAME}`]: { version: '1.0.0', resolved: `${url}#${fx.shas[version]}` } },
  }));
  return pkgDir;
}

/** The in-process health endpoint: reports `current` unless that version is broken. */
async function healthServer(fx) {
  const broken = new Set();
  const srv = http.createServer((req, res) => {
    let v = null;
    try { v = path.basename(fs.readlinkSync(path.join(fx.root, 'current'))); } catch { /* none */ }
    if (!v || broken.has(v)) { res.writeHead(500); res.end('down'); return; }
    res.writeHead(200); res.end(`{"version":"${v.replace(/^v/, '')}"}`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { broken, url: `http://127.0.0.1:${srv.address().port}/version`, close: () => srv.close() };
}

function makeIo(S, fx, extra = {}) {
  const out = []; const err = [];
  const io = {
    ...S.defaultIo(fx.env),
    platform: 'linux', uid: 501, home: fx.home,
    timing: { timeoutMs: 400, pollMs: 20, settleMs: 0 },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    out: (s) => out.push(s), err: (s) => err.push(s),
    ...extra,
  };
  return { io, out, err };
}

function opts(pkgDir) {
  return { tool: NAME, name: NAME, kind: 'binary', pkgDir, serviceRel: 'service.mjs' };
}

/** Every path + content under `dir`, for "nothing changed" assertions. */
function snapshot(dir) {
  const acc = [];
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) acc.push(`${p} -> ${fs.readlinkSync(p)}`);
      else if (st.isDirectory()) { acc.push(`${p}/`); walk(p); } else acc.push(`${p} ${fs.readFileSync(p, 'utf8').length}`);
    }
  };
  walk(dir);
  return acc.join('\n');
}

const ctlLines = (fx) => (fs.existsSync(fx.ctlLog) ? fs.readFileSync(fx.ctlLog, 'utf8').trim().split('\n') : []);
const link = (fx, n) => { try { return path.basename(fs.readlinkSync(path.join(fx.root, n))); } catch { return null; } };

// ---- pure helpers -----------------------------------------------------------------------------

test('channelVersion: stable → highest final at the tip, next → highest release tag there; dist refs ignored; no tag refuses', async () => {
  const L = await loadLauncher();
  const A = 'a'.repeat(40); const B = 'b'.repeat(40); const C = 'c'.repeat(40); const T = 'f'.repeat(40);
  const ls = [
    `${A}\trefs/heads/stable`, `${B}\trefs/heads/next`,
    `${T}\trefs/tags/v1.1.0`, `${A}\trefs/tags/v1.1.0^{}`,              // annotated, peeled
    `${A}\trefs/tags/v1.0.9`,                                            // a lower final on the same commit
    `${B}\trefs/tags/v1.2.0-rc.2`, `${B}\trefs/tags/v1.2.0`,             // final + its rc, same commit
    `${B}\trefs/tags/dist/v1.2.0/${PLAT}`, `${C}\trefs/tags/v9.9.9-rc.1`,
  ].join('\n');
  assert.deepStrictEqual(L.channelVersion(ls, 'stable'), { version: 'v1.1.0', sha: A });
  assert.deepStrictEqual(L.channelVersion(ls, 'next'), { version: 'v1.2.0', sha: B });
  assert.deepStrictEqual(L.channelVersion(ls, 'next', C), { version: 'v9.9.9-rc.1', sha: C }, 'reads the commit npx installed');
  assert.match(L.channelVersion(ls, 'stable', C).error, /no final release tag/);
  assert.match(L.channelVersion(`${C}\trefs/heads/stable`, 'stable').error, /stable.*carries no final release tag/);
  assert.match(L.channelVersion('', 'next').error, /no `next` channel branch/);
  assert.match(L.channelVersion(ls, 'main').error, /not a release channel/);
  assert.strictEqual(L.compareVersions('v1.2.0-rc.9', 'v1.2.0'), -1);
  assert.strictEqual(L.compareVersions('v1.10.0', 'v1.9.0'), 1);
});

test('resolveTarget returns a channel (and the installed sha), never a manifest version, for #next/#stable', async () => {
  const L = await loadLauncher();
  const files = {};
  const read = (p) => files[p] || null;
  const pkgDir = path.join('/c', 'node_modules', 'tool');
  const pkg = { name: 'tool', version: '2.0.0' };
  const sha = '1'.repeat(40);
  files[path.join('/c', 'package.json')] = { dependencies: { tool: 'github:o/tool#next' } };
  files[path.join('/c', 'package-lock.json')] = { packages: { 'node_modules/tool': { resolved: `git+ssh://git@github.com/o/tool.git#${sha}` } } };
  const t = L.resolveTarget({ env: {}, pkgDir, pkg, read });
  assert.deepStrictEqual([t.version, t.channel, t.sha, t.origin], [undefined, 'next', sha, 'ssh://git@github.com/o/tool.git']);
  // An explicit version still wins over the channel.
  assert.strictEqual(L.resolveTarget({ env: { TOOL_DIST_VERSION: 'v1.0.0' }, pkgDir, pkg, read }).version, 'v1.0.0');
});

test('paths: XDG honoured, defaults under HOME, config and state never inside the data root', async () => {
  const S = await load();
  const d = S.paths({ env: {}, home: '/h', tool: 't' });
  assert.deepStrictEqual(d, {
    root: '/h/.local/share/t', config: '/h/.config/t', state: '/h/.local/state/t', shim: '/h/.local/bin/t',
    systemdDir: '/h/.config/systemd/user', launchAgents: '/h/Library/LaunchAgents',
  });
  const x = S.paths({ env: { XDG_DATA_HOME: '/d', XDG_CONFIG_HOME: '/c', XDG_STATE_HOME: '/s' }, home: '/h', tool: 't' });
  assert.deepStrictEqual([x.root, x.config, x.state, x.systemdDir], ['/d/t', '/c/t', '/s/t', '/c/systemd/user']);
  for (const p of [d, x]) for (const k of ['config', 'state']) assert.ok(!p[k].startsWith(`${p.root}/`));
});

test('unit renderers and manager commands: the program runs through `current`, env carries locations only', async () => {
  const S = await load();
  const spec = S.unitSpec({ kind: 'binary', tool: 'probe', name: 'probe', root: '/d/probe', state: '/s/probe', config: '/c/probe', execPath: '/n/node', plat: 'linux-x64', envPath: '/usr/bin', label: 'com.example.probe', args: ['serve', 'a b'] });
  assert.deepStrictEqual(spec.programArgs, ['/d/probe/current/linux-x64/probe', 'serve', 'a b']);
  assert.deepStrictEqual(spec.env, { PROBE_CONFIG_DIR: '/c/probe', PROBE_STATE_DIR: '/s/probe', PATH: '/usr/bin' });
  const unit = S.renderSystemd(spec);
  assert.match(unit, /^ExecStart=\/d\/probe\/current\/linux-x64\/probe serve "a b"$/m);
  assert.match(unit, /^Environment=PROBE_CONFIG_DIR=\/c\/probe$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  const plist = S.renderLaunchd(spec);
  assert.match(plist, /<key>Label<\/key>\n {2}<string>com\.example\.probe<\/string>/);
  assert.match(plist, /<string>\/d\/probe\/current\/linux-x64\/probe<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>\n {2}<true\/>/);
  if (process.platform === 'darwin' && spawnSync('plutil', ['-help']).status !== null) {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plist-')), 'x.plist');
    fs.writeFileSync(f, plist);
    assert.strictEqual(spawnSync('plutil', ['-lint', f]).status, 0, 'plist lints');
  }
  const pkgSpec = S.unitSpec({ kind: 'package', tool: 'probe', name: '@o/probe', root: '/d/probe', state: '/s', config: '/c', execPath: '/n/node', plat: 'x', envPath: '', label: null, args: [], entry: 'server.mjs' });
  assert.deepStrictEqual(pkgSpec.programArgs, ['/n/node', '/d/probe/current/pkg/node_modules/@o/probe/server.mjs']);
  assert.strictEqual(pkgSpec.label, 'local.probe');

  const p = S.paths({ env: {}, home: '/h', tool: 'probe' });
  const mac = S.managerCommands('darwin', { uid: 501, spec, p });
  assert.strictEqual(mac.unitPath, '/h/Library/LaunchAgents/com.example.probe.plist');
  assert.deepStrictEqual(mac.restart, [['launchctl', 'kickstart', '-k', 'gui/501/com.example.probe']]);
  assert.deepStrictEqual(mac.load[1], ['launchctl', 'bootstrap', 'gui/501', mac.unitPath]);
  assert.ok(mac.running({ status: 0, stdout: '\tstate = running\n' }));
  assert.ok(!mac.running({ status: 0, stdout: '\tstate = waiting\n' }));
  const lin = S.managerCommands('linux', { uid: 501, spec, p });
  assert.strictEqual(lin.unitPath, '/h/.config/systemd/user/com.example.probe.service');
  assert.deepStrictEqual(lin.load, [['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', '--now', 'com.example.probe.service']]);
  assert.strictEqual(S.npmSpec('/srv/o.git', 'v1.0.0'), 'git+file:///srv/o.git#v1.0.0');
  assert.strictEqual(S.npmSpec('ssh://git@github.com/o/r.git', 'v1.0.0'), 'git+ssh://git@github.com/o/r.git#v1.0.0');
  assert.deepStrictEqual(S.parseArgs(['--check', '--channel=next', '--version', 'v1.0.0', 'x']), { flags: { check: true, channel: 'next', version: 'v1.0.0' }, rest: ['x'] });
});

// ---- end to end -------------------------------------------------------------------------------

test('binary service: init → update --check → update → --channel next → broken switches back → rollback toggles → pin', { skip: !posix }, async () => {
  const S = await load();
  const fx = fixture();
  const h = await healthServer(fx);
  try {
    fx.env.PROBE_SVC_HEALTH_URL = h.url;
    const pkgDir = npxLayout(fx, 'v1.0.0');
    const npxBefore = snapshot(path.dirname(path.dirname(pkgDir)));

    // init
    let t = makeIo(S, fx);
    assert.strictEqual(await S.run('init', [], opts(pkgDir), t.io), 0, t.err.join('\n'));
    assert.strictEqual(link(fx, 'current'), 'v1.0.0');
    const bin = path.join(fx.root, 'current', PLAT, NAME);
    assert.strictEqual(execFileSync(bin, ['hi'], { encoding: 'utf8' }).trim(), `${NAME} v1.0.0: hi`);
    assert.ok(fs.existsSync(path.join(fx.root, 'v1.0.0', 'pkg', 'node_modules', NAME, 'service.mjs')), 'the manager is versioned with the payload');
    const unit = fs.readFileSync(path.join(fx.home, 'config', 'systemd', 'user', `${NAME}.service`), 'utf8');
    assert.match(unit, new RegExp(`ExecStart=${fx.root.replace(/[.]/g, '\\.')}/current/`));
    assert.ok(!unit.includes(fx.base + '/npx-'), 'the unit never points into npx\'s cache');
    assert.deepStrictEqual(ctlLines(fx), [`systemctl --user daemon-reload`, `systemctl --user enable --now ${NAME}.service`]);
    const shim = path.join(fx.home, '.local', 'bin', NAME);
    assert.ok(fs.statSync(shim).mode & 0o100, 'shim executable');
    assert.strictEqual(execFileSync(shim, ['hi'], { encoding: 'utf8', env: fx.env }).trim(), `${NAME} v1.0.0: hi`, 'shim runs the current payload');
    const rec = JSON.parse(fs.readFileSync(path.join(fx.home, 'config', NAME, 'install.json'), 'utf8'));
    assert.deepStrictEqual(rec, { origin: `file://${fx.origin}`, channel: 'stable' });
    assert.strictEqual(fs.statSync(path.join(fx.home, 'config', NAME)).mode & 0o777, 0o700);
    assert.strictEqual(snapshot(path.dirname(path.dirname(pkgDir))), npxBefore, 'nothing written into the npx install');

    // the shim reaches the verbs too (a real subprocess through `current`)
    const st = spawnSync(shim, ['status'], { encoding: 'utf8', env: fx.env });
    assert.strictEqual(st.status, 0, st.stderr);
    assert.match(st.stdout, /current: {2}v1\.0\.0/);

    // update --check writes nothing
    const before = snapshot(fx.home); const ctlBefore = ctlLines(fx);
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('update', ['--check'], opts(pkgDir), t.io), 0, t.err.join('\n'));
    assert.deepStrictEqual(t.out, ['update available: v1.0.0 -> v1.1.0 (stable)']);
    assert.strictEqual(snapshot(fx.home), before, 'update --check changed nothing');
    assert.deepStrictEqual(ctlLines(fx), ctlBefore);

    // update follows stable
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('update', [], opts(pkgDir), t.io), 0, t.err.join('\n'));
    assert.deepStrictEqual([link(fx, 'current'), link(fx, 'previous')], ['v1.1.0', 'v1.0.0']);
    assert.strictEqual(ctlLines(fx).at(-1), `systemctl --user restart ${NAME}.service`);

    // --channel next moves to the candidate and is remembered
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('update', ['--channel', 'next'], opts(pkgDir), t.io), 0, t.err.join('\n'));
    assert.deepStrictEqual([link(fx, 'current'), link(fx, 'previous')], ['v1.2.0-rc.1', 'v1.1.0']);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fx.home, 'config', NAME, 'install.json'), 'utf8')).channel, 'next');

    // a broken release on `next`: switched back, exit 1, previous untouched, restarted twice
    release(fx.work, 'v1.3.0-rc.1');
    moveChannel(fx.work, 'next', 'v1.3.0-rc.1');
    h.broken.add('v1.3.0-rc.1');
    const restarts = ctlLines(fx).filter((l) => l.includes(' restart ')).length;
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('update', [], opts(pkgDir), t.io), 1);
    assert.match(t.err.join('\n'), /v1\.3\.0-rc\.1 not healthy — switched back to v1\.2\.0-rc\.1/);
    assert.deepStrictEqual([link(fx, 'current'), link(fx, 'previous')], ['v1.2.0-rc.1', 'v1.1.0']);
    assert.strictEqual(ctlLines(fx).filter((l) => l.includes(' restart ')).length, restarts + 2);

    // rollback, and rollback again toggles
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('rollback', [], opts(pkgDir), t.io), 0, t.err.join('\n'));
    assert.deepStrictEqual([link(fx, 'current'), link(fx, 'previous')], ['v1.1.0', 'v1.2.0-rc.1']);
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('rollback', [], opts(pkgDir), t.io), 0, t.err.join('\n'));
    assert.deepStrictEqual([link(fx, 'current'), link(fx, 'previous')], ['v1.2.0-rc.1', 'v1.1.0']);

    // --version pins; a later update reports pinned and changes nothing
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('update', ['--version', 'v1.0.0'], opts(pkgDir), t.io), 0, t.err.join('\n'));
    assert.strictEqual(link(fx, 'current'), 'v1.0.0');
    const pinnedState = snapshot(fx.home);
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('update', [], opts(pkgDir), t.io), 0, t.err.join('\n'));
    assert.match(t.out.join('\n'), /pinned at v1\.0\.0/);
    assert.strictEqual(snapshot(fx.home), pinnedState);

    // pruning keeps current, previous and the KEEP newest
    const left = fs.readdirSync(fx.root).filter((n) => /^v\d/.test(n)).sort();
    assert.ok(left.includes('v1.0.0') && left.includes('v1.2.0-rc.1'), `current/previous kept: ${left}`);
  } finally { h.close(); }
});

test('a failed install (no dist ref for the target) switches nothing', { skip: !posix }, async () => {
  const S = await load();
  const fx = fixture();
  const h = await healthServer(fx);
  try {
    fx.env.PROBE_SVC_HEALTH_URL = h.url;
    const pkgDir = npxLayout(fx, 'v1.0.0');
    let t = makeIo(S, fx);
    assert.strictEqual(await S.run('init', [], opts(pkgDir), t.io), 0, t.err.join('\n'));
    // A release whose dist ref was never pushed (the channel moved first).
    fs.writeFileSync(path.join(fx.work, 'x'), '1');
    git(fx.work, 'add', '-A'); git(fx.work, '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'x'); git(fx.work, 'tag', 'v1.4.0');
    git(fx.work, 'push', '-q', 'origin', 'HEAD:main', 'v1.4.0');
    moveChannel(fx.work, 'stable', 'v1.4.0');
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('update', [], opts(pkgDir), t.io), 1);
    assert.match(t.err.join('\n'), /could not fetch refs\/tags\/dist\/v1\.4\.0[\s\S]*nothing switched — still on v1\.0\.0/);
    assert.strictEqual(link(fx, 'current'), 'v1.0.0');
    assert.ok(!fs.existsSync(path.join(fx.root, 'v1.4.0')), 'no half-installed version left behind');
    assert.deepStrictEqual(fs.readdirSync(fx.root).filter((n) => n.startsWith('.')), [], 'no temp dirs left');
  } finally { h.close(); }
});

test('package service: init from the npx copy, update through npm, rollback', { skip: !posix }, async () => {
  const S = await load();
  const fx = fixture();
  const h = await healthServer(fx);
  try {
    fx.env.PROBE_SVC_HEALTH_URL = h.url;
    const pkgDir = npxLayout(fx, 'v1.0.0');
    const o = { ...opts(pkgDir), kind: 'package', entry: 'service.mjs' };
    let t = makeIo(S, fx);
    assert.strictEqual(await S.run('init', [], o, t.io), 0, t.err.join('\n'));
    assert.ok(!fs.existsSync(path.join(fx.root, 'v1.0.0', PLAT)), 'package kind fetches no binary');
    const unit = fs.readFileSync(path.join(fx.home, 'config', 'systemd', 'user', `${NAME}.service`), 'utf8');
    assert.match(unit, new RegExp(`current/pkg/node_modules/${NAME}/service\\.mjs`));
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('update', [], o, t.io), 0, t.err.join('\n'));
    assert.ok(fs.existsSync(path.join(fx.root, 'v1.1.0', 'pkg', 'node_modules', NAME, 'service.mjs')));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fx.root, 'v1.1.0', 'pkg', 'node_modules', NAME, 'package.json'), 'utf8')).version, '1.1.0');
    t = makeIo(S, fx);
    assert.strictEqual(await S.run('rollback', [], o, t.io), 0, t.err.join('\n'));
    assert.strictEqual(link(fx, 'current'), 'v1.0.0');
  } finally { h.close(); }
});

test('health without a URL asks the service manager; init failing health unloads the unit', { skip: !posix }, async () => {
  const S = await load();
  const fx = fixture();
  const pkgDir = npxLayout(fx, 'v1.0.0');
  let t = makeIo(S, fx, { run: (cmd, args) => (cmd === 'systemctl' && args[1] === 'is-active' ? { status: 3, stdout: 'failed\n' } : { status: 0, stdout: '' }) });
  assert.strictEqual(await S.run('init', [], opts(pkgDir), t.io), 1);
  assert.match(t.err.join('\n'), /not healthy — service unloaded/);
  t = makeIo(S, fx, { run: (cmd, args) => (cmd === 'npm' ? spawnSync(cmd, args, { encoding: 'utf8', env: fx.env }) : { status: 0, stdout: args[1] === 'is-active' ? 'active\n' : '' }) });
  assert.strictEqual(await S.run('init', [], opts(pkgDir), t.io), 0, t.err.join('\n'));
});

test('refusals change nothing: Windows, #main with no version, update/rollback before init, a held lock', { skip: !posix }, async () => {
  const S = await load();
  const fx = fixture();
  const pkgDir = npxLayout(fx, 'v1.0.0');
  const before = snapshot(fx.home);
  const cases = [
    ['init', [], { platform: 'win32' }, /not supported on Windows/],
    ['update', [], {}, /not installed — run `npx <origin>#vX\.Y\.Z init` first/],
    ['rollback', [], {}, /not installed/],
    ['update', ['--channel', 'main'], {}, /--channel must be one of next, stable/],
  ];
  for (const [verb, argv, extra, re] of cases) {
    const t = makeIo(S, fx, extra);
    assert.strictEqual(await S.run(verb, argv, opts(pkgDir), t.io), 1, `${verb} ${argv}`);
    assert.match(t.err.join('\n'), re);
  }
  // #main and a manifest with no version: refuses and names the variable.
  const mainDir = npxLayout(fx, 'main', 'v1.0.0');
  fs.writeFileSync(path.join(mainDir, 'package.json'), JSON.stringify({ name: NAME, private: true }));
  let t = makeIo(S, fx);
  assert.strictEqual(await S.run('init', [], opts(mainDir), t.io), 1);
  assert.match(t.err.join('\n'), /PROBE_SVC_DIST_VERSION/);
  assert.strictEqual(snapshot(fx.home), before, 'nothing written by any refusal');

  // rollback with no previous; update with a live lock holder
  t = makeIo(S, fx, { env: { ...fx.env, PROBE_SVC_SERVICE_MANAGER: 'none' } });
  assert.strictEqual(await S.run('init', [], opts(pkgDir), t.io), 0, t.err.join('\n'));
  t = makeIo(S, fx, { env: { ...fx.env, PROBE_SVC_SERVICE_MANAGER: 'none' } });
  assert.strictEqual(await S.run('rollback', [], opts(pkgDir), t.io), 1);
  assert.match(t.err.join('\n'), /no previous version/);
  fs.writeFileSync(path.join(fx.home, 'state', NAME, 'update.lock'), `${process.pid}\n`);
  t = makeIo(S, fx, { env: { ...fx.env, PROBE_SVC_SERVICE_MANAGER: 'none' } });
  assert.strictEqual(await S.run('update', [], opts(pkgDir), t.io), 1);
  assert.match(t.err.join('\n'), /another update is running/);
  assert.strictEqual(link(fx, 'current'), 'v1.0.0');
});

test('init at #stable resolves the channel to the release npx installed', { skip: !posix }, async () => {
  const S = await load();
  const fx = fixture();
  const pkgDir = npxLayout(fx, 'stable', 'v1.1.0');
  const t = makeIo(S, fx, { env: { ...fx.env, PROBE_SVC_SERVICE_MANAGER: 'none' } });
  assert.strictEqual(await S.run('init', [], opts(pkgDir), t.io), 0, t.err.join('\n'));
  assert.strictEqual(link(fx, 'current'), 'v1.1.0');
});

test('the launcher alone runs a channel: #stable → the final, #next → the candidate, #main refuses', { skip: !posix }, () => {
  const fx = fixture();
  const launch = (spec, version) => spawnSync(process.execPath, [path.join(npxLayout(fx, spec, version), 'npx-launcher.mjs'), 'x'], { encoding: 'utf8', env: fx.env });
  let r = launch('stable', 'v1.1.0');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), `${NAME} v1.1.0: x`);
  r = launch('next', 'v1.2.0-rc.1');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), `${NAME} v1.2.0-rc.1: x`);
  const mainDir = npxLayout(fx, 'main', 'v1.0.0');
  fs.writeFileSync(path.join(mainDir, 'package.json'), JSON.stringify({ name: NAME, private: true }));
  r = spawnSync(process.execPath, [path.join(mainDir, 'npx-launcher.mjs')], { encoding: 'utf8', env: fx.env });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /PROBE_SVC_DIST_VERSION/);
});
