'use strict';
/**
 * tools/lib/hermetic.js — the hermetic second test run behind `colab gate-hermetic` (#403).
 *
 * The failure it exists for: a test read live state from its author's machine — the user's home
 * config and a local fleet daemon. Green in every local wrap, red on every CI runner, and the red
 * trunk then blocked the repo's sweep. The lesson was written down in prose; the same class came
 * back two days later. So code-wrap A3 now runs the TEST STEP a second time with the machine
 * taken away — a fresh empty HOME, daemon/dashboard/fleet URLs and every token unset, network
 * off where the platform allows it — and the gate is green only when BOTH runs are.
 *
 * Everything here is pure (strings/objects in, strings/objects out) except `probeNetworkIsolation`,
 * which takes an injectable `run` so tests never depend on the host's sandbox tooling.
 */

// ---- the key: `live-env:` in .github/project.yml --------------------------------------------

/**
 * `live-env:` → `{ declared, skip, valid, value, reason }`. Only `none` ("this repo's tests read
 * no live environment") skips the hermetic run. Absent = run it. Any other value is invalid and
 * read in the STRICTER direction — the run still happens — while the audit fails the value.
 */
function parseLiveEnv(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, 'live-env');
  if (!has || doc['live-env'] === null || doc['live-env'] === undefined) {
    return { declared: false, skip: false, valid: true, value: null, reason: 'live-env absent — the hermetic run is required' };
  }
  const v = doc['live-env'];
  if (v === 'none') {
    return { declared: true, skip: true, valid: true, value: 'none', reason: 'live-env: none declared — this repo states its tests read no live environment' };
  }
  return {
    declared: true, skip: false, valid: false, value: v,
    reason: `live-env is ${JSON.stringify(v)} — the only defined value is "none"; read as absent, so the hermetic run still happens`,
  };
}

// ---- the environment ------------------------------------------------------------------------

// A variable is stripped when its NAME says it points at something outside the test process: a
// service address, a credential, a socket, a proxy — or a known agent/dashboard/daemon runtime.
// Deliberately by name shape, not by a closed list of our own services: the next daemon a test
// quietly depends on will not be on any list, but it will almost certainly be `SOMETHING_URL`.
const STRIP_SUFFIX = /(_URL|_URI|_ENDPOINT|_ADDR|_ADDRESS|_HOST|_PORT|_TOKEN|_SECRET|_KEY|_KEY_ID|_PASSWORD|_PASS|_CREDENTIALS|_SOCK|_SOCKET)$/i;
const STRIP_PREFIX = /^(COLAB_|CLAUDE|ANTHROPIC_|AWS_|GH_|GITHUB_TOKEN)/i;
const STRIP_SUBSTRING = /(DASHBOARD|DAEMON|FLEET)/i;
const STRIP_EXACT = new Set(['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'ftp_proxy', 'ZDOTDIR']);
// Stripped from BOTH runs: a leaked node test-runner context makes `node --test` skip every test
// and still exit 0 (the handbook's own CI documents this as #154) — a fail-open, not a live read.
const TEST_RUNNER_LEAKS = ['NODE_TEST_CONTEXT', 'NODE_TEST_WORKER_ID'];
// HOME-derived locations re-pointed INTO the fresh home, so nothing reaches the real one through them.
const XDG_DIRS = { XDG_CONFIG_HOME: '.config', XDG_DATA_HOME: '.local/share', XDG_CACHE_HOME: '.cache', XDG_STATE_HOME: '.local/state' };

// Toolchain-manager homes (#447). A version manager's proxy (`cargo`/`rustc` from rustup, a pyenv
// or asdf shim, …) finds its installed toolchain through ONE variable whose default is under
// $HOME. With HOME swapped for an empty dir the proxy finds nothing, tries to install a toolchain,
// and — network off — fails; the verdict then read `live-env` and blamed the code for a machine
// dependency it does not have (measured: a rustup-managed Rust workspace, `live-env` locally,
// green on CI where the container brings its own toolchain). An installed toolchain is the
// compiler/interpreter the test step runs ON, not live state the tests READ, so the variable is
// pinned to the real directory BEFORE HOME moves — only when the caller has not set it already
// (a set value passes through untouched: none of these names match a strip rule) and only when
// that directory actually exists (nothing is invented). Every pin is printed in the verdict, the
// same visibility rule as --keep. The cost, stated: such a home also holds the manager's own
// config and package cache (~/.cargo/config.toml, ~/.cargo/registry, ~/go/pkg/mod), and a test
// reading THOSE is not caught — `--no-pin` restores the strict run for a suite suspected of it.
const TOOLCHAIN_HOMES = [
  { name: 'RUSTUP_HOME', rel: '.rustup', manager: 'rustup' },
  { name: 'CARGO_HOME', rel: '.cargo', manager: 'rustup/cargo' },
  { name: 'PYENV_ROOT', rel: '.pyenv', manager: 'pyenv' },
  { name: 'RBENV_ROOT', rel: '.rbenv', manager: 'rbenv' },
  { name: 'ASDF_DATA_DIR', rel: '.asdf', manager: 'asdf' },
  { name: 'NVM_DIR', rel: '.nvm', manager: 'nvm' },
  { name: 'VOLTA_HOME', rel: '.volta', manager: 'volta' },
  // mise follows XDG_DATA_HOME, which the hermetic run re-points — so its default must be resolved
  // against the CALLER's XDG_DATA_HOME, not the fresh one.
  { name: 'MISE_DATA_DIR', rel: '.local/share/mise', xdg: ['XDG_DATA_HOME', 'mise'], manager: 'mise' },
  { name: 'GOPATH', rel: 'go', manager: 'go (GOTOOLCHAIN downloads + module cache)' },
];

/**
 * Which toolchain homes to pin → `[{ name, value, manager }]`. `exists(path)` is injected so this
 * stays pure; the CLI passes a real directory check. A variable already set in `env` is never in
 * the list — it reaches the hermetic run unchanged anyway.
 */
function toolchainPins(env, exists) {
  const home = env.HOME;
  const pins = [];
  for (const t of TOOLCHAIN_HOMES) {
    if (env[t.name]) continue;
    let dir = null;
    if (t.xdg && env[t.xdg[0]]) dir = `${env[t.xdg[0]].replace(/\/+$/, '')}/${t.xdg[1]}`;
    else if (home) dir = `${home.replace(/\/+$/, '')}/${t.rel}`;
    if (dir && exists(dir)) pins.push({ name: t.name, value: dir, manager: t.manager });
  }
  return pins;
}

// The output shapes of a version manager that could not find its toolchain — what a missed pin
// looks like. Used only for a hint line under a `live-env` verdict; the verdict itself is unchanged.
const TOOLCHAIN_MISS_PATTERNS = [
  /syncing channel updates for/i,                         // rustup proxy installing a toolchain
  /static\.rust-lang\.org/i,
  /rustup could not choose a version|no default toolchain/i,
  /pyenv: version .* is not installed/i,
  /rbenv: version .* is not installed/i,
  /No version is set for command|No preset version installed/i, // asdf
  /mise .*(is not installed|missing:)/i,
  /go: downloading go\d|toolchain not available/i,
];

/** True when a failed run's output looks like a toolchain manager missing its install. */
function looksLikeToolchainMiss(output) {
  const s = String(output || '');
  return TOOLCHAIN_MISS_PATTERNS.some((re) => re.test(s));
}

function shouldStrip(name) {
  if (name === 'HOME' || name === 'PATH') return false;
  if (STRIP_EXACT.has(name) || STRIP_EXACT.has(name.toLowerCase())) return true;
  return STRIP_SUFFIX.test(name) || STRIP_PREFIX.test(name) || STRIP_SUBSTRING.test(name);
}

/** The normal run's env: the caller's own, minus only the test-runner leaks. */
function normalEnv(env) {
  const out = { ...env };
  for (const k of TEST_RUNNER_LEAKS) delete out[k];
  return out;
}

/**
 * The hermetic run's env → `{ env, stripped, kept, pinned }`. `home` is the fresh directory the
 * caller created. `keep` names variables the caller explicitly passes through anyway — every one is
 * echoed in the verdict, so a pass-through is visible, never silent. `pins` (from `toolchainPins`)
 * are toolchain-manager homes set to their real directories before HOME moves (#447) — echoed too.
 */
function hermeticEnv(env, home, keep = [], { pins = [] } = {}) {
  const keepSet = new Set(keep);
  const out = {};
  const stripped = [];
  const kept = [];
  for (const p of pins) out[p.name] = p.value;
  for (const [k, v] of Object.entries(env)) {
    if (TEST_RUNNER_LEAKS.includes(k)) continue;
    if (keepSet.has(k)) { out[k] = v; if (shouldStrip(k)) kept.push(k); continue; }
    if (k in XDG_DIRS) continue; // re-pointed below
    if (shouldStrip(k)) { stripped.push(k); continue; }
    out[k] = v;
  }
  out.HOME = home;
  for (const [k, rel] of Object.entries(XDG_DIRS)) if (!keepSet.has(k)) out[k] = `${home}/${rel}`;
  return { env: out, stripped: stripped.sort(), kept: kept.sort(), pinned: pins.map((p) => p.name) };
}

// ---- the network ----------------------------------------------------------------------------

// macOS: deny every outbound IP connection except loopback. Loopback stays open on purpose — a
// suite that starts its own server on 127.0.0.1 and talks to it is hermetic, and blocking it would
// report a live-environment dependency that is not one. The cost is stated in the verdict line:
// a test with a HARD-CODED loopback daemon URL is not caught by the network half; it is caught
// only when the URL arrives through HOME or an env var, which is the shape measured so far.
//
// A sandboxed process may not exec a setuid binary, and on macOS `/bin/ps` (and `top`) IS setuid —
// so a suite that proves process ancestry through `ps` went red under the sandbox for a reason that
// has nothing to do with the network or the home directory (measured on this repo's own suite:
// three ancestry-anchor tests). Those two read the process table and nothing else, so they are let
// out of the sandbox by exact path; every other setuid binary stays refused.
const DARWIN_PROFILE = '(version 1)(allow default)(deny network-outbound (remote ip))(allow network-outbound (remote ip "localhost:*"))'
  + '(allow process-exec (literal "/bin/ps") (with no-sandbox))(allow process-exec (literal "/usr/bin/top") (with no-sandbox))';
// Linux: a fresh user+network namespace has only a DOWN loopback. Bring it up, then exec the
// command; the probe below refuses isolation when lo cannot come up, for the same reason as above.
const LINUX_WRAPPER = 'ip link set lo up && exec "$@"';

/**
 * Decide how (and whether) the hermetic run is cut off from the network. `run(cmd, args)` returns
 * `{ status }` and is injected, so the decision is testable without the host's tooling.
 * → `{ isolated, prefix: [argv...], note }` — `note` is printed in the verdict, always.
 */
function probeNetworkIsolation({ platform, run, mode = 'auto' }) {
  if (mode === 'on') return { isolated: false, prefix: [], note: 'network: left on (--net on)' };
  if (platform === 'darwin') {
    const p = run('/usr/bin/sandbox-exec', ['-p', DARWIN_PROFILE, '/usr/bin/true']);
    if (p && p.status === 0) {
      return { isolated: true, prefix: ['/usr/bin/sandbox-exec', '-p', DARWIN_PROFILE], note: 'network: off via sandbox-exec (outbound IP denied, loopback allowed)' };
    }
    return { isolated: false, prefix: [], note: 'network: NOT isolated — sandbox-exec unavailable or refused here (already sandboxed?); HOME + env strip still applied' };
  }
  if (platform === 'linux') {
    const p = run('unshare', ['--user', '--map-root-user', '--net', 'sh', '-c', LINUX_WRAPPER, 'sh', 'true']);
    if (p && p.status === 0) {
      return { isolated: true, prefix: ['unshare', '--user', '--map-root-user', '--net', 'sh', '-c', LINUX_WRAPPER, 'sh'], note: 'network: off via unshare --net (fresh namespace, loopback up)' };
    }
    return { isolated: false, prefix: [], note: 'network: NOT isolated — unprivileged network namespaces unavailable here (or no `ip` to raise loopback); HOME + env strip still applied' };
  }
  return { isolated: false, prefix: [], note: `network: NOT isolated — no sandbox known for platform "${platform}"; HOME + env strip still applied` };
}

// ---- reading the output ---------------------------------------------------------------------

// One line format per common runner — the names are what the verdict must carry, not the transcript.
const FAILURE_PATTERNS = [
  /^\s*not ok \d+ - (.+?)(?:\s+#\s.*)?$/,          // TAP (node --test --test-reporter=tap, prove, …)
  /^\s*✖ (.+?)(?: \(\d[\d.]*m?s\))?$/,              // node --test spec reporter
  /^\s*(?:FAIL|✕|×)\s+(.+)$/,                       // jest / vitest
  /^FAILED (\S+)/,                                  // pytest -ra summary
  /^\d+\) (\S+::\S+)/,                              // phpunit
  /^--- FAIL: (\S+)/,                               // go test
];

/** Failing test names from a run's combined output, de-duplicated, capped at `max`. */
function parseFailures(output, max = 20) {
  const seen = new Set();
  const names = [];
  for (const line of String(output || '').split('\n')) {
    for (const re of FAILURE_PATTERNS) {
      const m = re.exec(line);
      if (m) {
        const n = m[1].trim();
        // node's spec reporter repeats every failure in a trailing summary; TAP nests parents.
        if (n && !seen.has(n) && !/^failing tests:?$/i.test(n)) { seen.add(n); names.push(n); }
        break;
      }
    }
    if (names.length >= max) break;
  }
  return names;
}

/** Last `n` non-empty lines — the fallback when no runner pattern named a failure. */
function tail(output, n = 15) {
  return String(output || '').split('\n').filter((l) => l.trim() !== '').slice(-n);
}

// ---- the verdict ----------------------------------------------------------------------------

/**
 * → `'green' | 'red' | 'live-env' | 'skipped'`.
 *   skipped  — `live-env: none` declared; the normal run alone decides (and must still be green)
 *   red      — the NORMAL run is red: an ordinary failing gate, hermetic run not attempted
 *   live-env — normal green, hermetic red: the tests pass only with this machine's environment
 *   green    — both green
 */
function classify({ skipped, normalOk, hermeticOk }) {
  if (!normalOk) return 'red';
  if (skipped) return 'skipped';
  return hermeticOk ? 'green' : 'live-env';
}

const VERDICT_TEXT = {
  green: 'both runs passed',
  skipped: 'counts as green — hermetic run skipped because trunk declares live-env: none',
  red: 'the normal test run fails; fix that first — the hermetic run was not attempted',
  'live-env': 'live-environment dependency: green on this machine, red with the machine taken away. It will be red on CI. Not green.',
};

module.exports = {
  parseLiveEnv, shouldStrip, normalEnv, hermeticEnv, toolchainPins, looksLikeToolchainMiss, TOOLCHAIN_HOMES, probeNetworkIsolation, parseFailures, tail,
  classify, VERDICT_TEXT, DARWIN_PROFILE, LINUX_WRAPPER, TEST_RUNNER_LEAKS,
};
