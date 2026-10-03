'use strict';
/**
 * CLI oracle for `colab gate-hermetic` (#403) — the issue's four cases, against the real CLI:
 *
 *   a fixture test reading $HOME/.claude/… or calling a local daemon URL
 *     → normal run green, hermetic run red, verdict live-env, failing test named;
 *   the same fixture with the dependency removed → both green;
 *   trunk declaring `live-env: none` → hermetic run skipped, and the skip printed.
 *
 * The CLI is spawned ASYNCHRONOUSLY on purpose: the daemon case needs this process's own http
 * server to answer while the fixture's normal run calls it, and spawnSync would block the event
 * loop that server lives on. The fixture's "real" HOME is a temp dir too — nothing here reads the
 * machine running the tests, which is the property this command exists to check.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile, execFileSync } = require('child_process');

const COLAB = path.resolve(__dirname, '..', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP.push(d); return d; };

const BASE_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

// Fixture tests, TAP-shaped so the verdict can name them.
const READS_HOME = `
const fs = require('fs'), os = require('os'), path = require('path');
const f = path.join(os.homedir(), '.claude', 'fixture.json');
if (fs.existsSync(f)) { console.log('ok 1 - reads home config'); }
else { console.log('not ok 1 - reads home config'); process.exit(1); }
`;
const CALLS_DAEMON = `
const url = process.env.FIXTURE_DAEMON_URL;
if (!url) { console.log('not ok 1 - talks to the fleet daemon'); process.exit(1); }
require('http').get(url, (res) => {
  if (res.statusCode === 200) console.log('ok 1 - talks to the fleet daemon');
  else { console.log('not ok 1 - talks to the fleet daemon'); process.exitCode = 1; }
  res.resume();
}).on('error', () => { console.log('not ok 1 - talks to the fleet daemon'); process.exitCode = 1; });
`;
// A stand-in for rustup's cargo proxy (#447): it finds its toolchain through RUSTUP_HOME, else
// $HOME/.rustup — and, missing both, tries to download one, exactly the way the real proxy fails.
const TOOLCHAIN_PROXY = `
const fs = require('fs'), os = require('os'), path = require('path');
const dir = process.env.RUSTUP_HOME || path.join(os.homedir(), '.rustup');
if (fs.existsSync(path.join(dir, 'toolchains'))) { console.log('ok 1 - pure arithmetic under the toolchain'); }
else {
  console.log("info: syncing channel updates for 'stable-x86_64-unknown-linux-gnu'");
  console.log("error: could not download file from 'https://static.rust-lang.org/dist/channel-rust-stable.toml.sha256'");
  process.exit(1);
}
`;
const SELF_CONTAINED = `console.log('ok 1 - pure arithmetic'); if (1 + 1 !== 2) process.exit(1);`;
const PLAIN_RED = `console.log('not ok 1 - genuinely broken'); process.exit(1);`;

function makeRepo({ trunkYml = BASE_YML, branchYml = null, script }) {
  const dir = tmp('colab-hermetic-repo-');
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: dir, stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks')); // never the developer's global hooks
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), trunkYml);
  fs.writeFileSync(path.join(dir, 'fixture.test.js'), script);
  g('add', '-A'); g('commit', '-q', '-m', 'init');
  if (branchYml !== null) {
    g('checkout', '-q', '-b', 'feat/x-1');
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), branchYml);
  }
  return dir;
}

/** A "real" home for the normal run: the fixture's config file present. */
function fakeRealHome() {
  const home = tmp('colab-hermetic-realhome-');
  fs.mkdirSync(path.join(home, '.claude'));
  fs.writeFileSync(path.join(home, '.claude', 'fixture.json'), '{}');
  return home;
}

function runColab(args, { cwd, env }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [COLAB, ...args], { cwd, env, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

const baseEnv = (home, extra = {}) => {
  const e = { ...process.env, HOME: home, COLAB_HOME: tmp('colab-hermetic-state-'), ...extra };
  delete e.NODE_TEST_CONTEXT; delete e.NODE_TEST_WORKER_ID;
  return e;
};

test('reads $HOME/.claude → normal green, hermetic red, verdict live-env naming the test', async () => {
  const repo = makeRepo({ script: READS_HOME });
  const r = await runColab(['gate-hermetic', '--', process.execPath, 'fixture.test.js'], { cwd: repo, env: baseEnv(fakeRealHome()) });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /normal run: {3}green/);
  assert.match(r.out, /hermetic run: RED/);
  assert.match(r.out, /- reads home config/);
  assert.match(r.out, /VERDICT: live-env/);
  assert.match(r.out, /network: /, 'the network line is always printed');
});

test('calls a local daemon URL from env → live-env; the variable is named as unset', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('ok'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const repo = makeRepo({ script: CALLS_DAEMON });
    const r = await runColab(['gate-hermetic', '--', process.execPath, 'fixture.test.js'],
      { cwd: repo, env: baseEnv(fakeRealHome(), { FIXTURE_DAEMON_URL: url }) });
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /normal run: {3}green/);
    assert.match(r.out, /FIXTURE_DAEMON_URL/);
    assert.match(r.out, /- talks to the fleet daemon/);
    assert.match(r.out, /VERDICT: live-env/);
  } finally { server.close(); }
});

test('dependency removed → both runs green, exit 0', async () => {
  const repo = makeRepo({ script: SELF_CONTAINED });
  const r = await runColab(['gate-hermetic', '--', process.execPath, 'fixture.test.js'], { cwd: repo, env: baseEnv(fakeRealHome()) });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /hermetic run: green/);
  assert.match(r.out, /VERDICT: green/);
});

test('trunk declares live-env: none → hermetic run skipped and the skip printed', async () => {
  const repo = makeRepo({ trunkYml: `${BASE_YML}live-env: none\n`, script: READS_HOME });
  const r = await runColab(['gate-hermetic', '--', process.execPath, 'fixture.test.js'], { cwd: repo, env: baseEnv(fakeRealHome()) });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /hermetic run: SKIPPED — main declares live-env: none/);
  assert.match(r.out, /VERDICT: skipped/);
});

test('a BRANCH-only live-env: none does not skip — trunk decides, and the note says so', async () => {
  const repo = makeRepo({ branchYml: `${BASE_YML}live-env: none\n`, script: READS_HOME });
  const r = await runColab(['gate-hermetic', '--', process.execPath, 'fixture.test.js'], { cwd: repo, env: baseEnv(fakeRealHome()) });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /declared on this branch but not on main/);
  assert.match(r.out, /VERDICT: live-env/);
});

test('normal run red → verdict red, hermetic not attempted', async () => {
  const repo = makeRepo({ script: PLAIN_RED });
  const r = await runColab(['gate-hermetic', '--', process.execPath, 'fixture.test.js'], { cwd: repo, env: baseEnv(fakeRealHome()) });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /hermetic run: not attempted/);
  assert.match(r.out, /- genuinely broken/);
  assert.match(r.out, /VERDICT: red/);
});

test('--json carries the verdict, the stripped names and the network note', async () => {
  const repo = makeRepo({ script: READS_HOME });
  const r = await runColab(['gate-hermetic', '--json', '--', process.execPath, 'fixture.test.js'],
    { cwd: repo, env: baseEnv(fakeRealHome(), { SOME_SERVICE_URL: 'http://127.0.0.1:1/' }) });
  assert.strictEqual(r.code, 1, r.out);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.verdict, 'live-env');
  assert.deepStrictEqual(j.failing, ['reads home config']);
  assert.ok(j.hermetic.stripped.includes('SOME_SERVICE_URL'));
  assert.strictEqual(typeof j.hermetic.network, 'string');
});

/** A real home with a rustup install in it — the toolchain, and nothing a test reads. */
function rustupHome() {
  const home = fakeRealHome();
  fs.mkdirSync(path.join(home, '.rustup', 'toolchains'), { recursive: true });
  return home;
}
const noToolchainVars = (e) => { delete e.RUSTUP_HOME; delete e.CARGO_HOME; return e; };

test('#447: rustup-managed toolchain at the default home → pinned, printed, verdict green', async () => {
  const repo = makeRepo({ script: TOOLCHAIN_PROXY });
  const r = await runColab(['gate-hermetic', '--', process.execPath, 'fixture.test.js'], { cwd: repo, env: noToolchainVars(baseEnv(rustupHome())) });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /toolchain homes pinned to their real dirs: .*RUSTUP_HOME/);
  assert.match(r.out, /VERDICT: green/);
});

test('#447: --no-pin restores the strict run → live-env, with the toolchain hint', async () => {
  const repo = makeRepo({ script: TOOLCHAIN_PROXY });
  const r = await runColab(['gate-hermetic', '--no-pin', '--', process.execPath, 'fixture.test.js'], { cwd: repo, env: noToolchainVars(baseEnv(rustupHome())) });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /toolchain homes: NOT pinned \(--no-pin\)/);
  assert.match(r.out, /hint: the hermetic failure looks like a toolchain manager/);
  assert.match(r.out, /VERDICT: live-env/);
});

test('#447: a pin never reaches the home a test READS — the home-config fixture is still live-env', async () => {
  const repo = makeRepo({ script: READS_HOME });
  const r = await runColab(['gate-hermetic', '--json', '--', process.execPath, 'fixture.test.js'], { cwd: repo, env: noToolchainVars(baseEnv(rustupHome())) });
  const j = JSON.parse(r.out);
  assert.strictEqual(j.verdict, 'live-env');
  assert.ok(j.hermetic.pinned.includes('RUSTUP_HOME'));
  assert.ok(!r.out.includes('hint:'), 'json mode prints no prose');
});

test('usage: no command after -- is refused', async () => {
  const repo = makeRepo({ script: SELF_CONTAINED });
  const r = await runColab(['gate-hermetic'], { cwd: repo, env: baseEnv(fakeRealHome()) });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /no test command/);
});
