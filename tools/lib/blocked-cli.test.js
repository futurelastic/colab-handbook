'use strict';
/**
 * Subprocess/CLI tests for `colab blocked` (#251) — the gh I/O wiring in tools/colab
 * (cmdBlocked / cmdBlockedAdd / cmdBlockedClear / readBlockedByEdges / resolveBlockerIssue),
 * never exercised by tools/lib/blocked-by.test.js's pure cases.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network), private COLAB_HOME, a fake `gh`
 * first on PATH — same fixture shape as tools/lib/decision-cli.test.js. TWO deliberate
 * divergences from that file's fixture, both load-bearing here and documented at the point they
 * matter:
 *
 *   (a) THE DISPATCHER MATCHES ON METHOD + ENDPOINT SHAPE, not on `argv.slice(0,2).join(' ')`.
 *       decision-cli's fixture can key on "issue view" / "issue edit" because gh's subcommand
 *       words ARE the call's identity there. Every write this command makes is `gh api ...`,
 *       so the first two words are always `api <endpoint>` (or `api -X <method>`) — the thing
 *       that actually distinguishes "resolve the blocker", "read the edges" and "POST/DELETE
 *       the edge" is the HTTP method plus the endpoint's shape, so `classify()` below parses
 *       that out of the full argv instead.
 *   (b) THE FAKE GH APPENDS EVERY ARGV TO A LOG FILE, so a test can assert a write was
 *       **never issued** — the only way to pin "the guard fired before the write" (e.g. #250's
 *       already-present short-circuit, or the closed-blocker refusal), which a script keyed by
 *       call presence alone cannot prove absence for.
 *
 * Same posture as every fixture in this file's family: it fakes gh's TRANSPORT and payload
 * SHAPE only, never an authorization read — nothing here can be used to forge a decision.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

/**
 * Parse a `gh api` invocation's argv (everything AFTER the leading `api`) into its HTTP method
 * (default GET) and its endpoint path — skipping `-X <method>`, `-q <expr>` and `-F <field>`,
 * each of which consumes the token that follows it. Mirrors, structurally, what `gh` itself does
 * with these flags; this file re-derives it rather than importing anything from tools/colab, so
 * the test stays honest about what a REAL gh invocation would look like on the wire.
 */
function apiEndpointAndMethod(rest) {
  let method = 'GET';
  let endpoint = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-X') { method = rest[++i]; continue; }
    if (a === '-q') { i++; continue; }
    if (a === '-F') { i++; continue; }
    if (typeof a === 'string' && a.startsWith('-')) continue;
    if (endpoint === null) endpoint = a;
  }
  return { method, endpoint };
}

/** Dispatch key for one `gh` invocation's argv. See the file banner, divergence (a). */
function classify(argv) {
  if (argv[0] === '--version') return 'version';
  if (argv[0] === 'auth' && argv[1] === 'status') return 'auth-status';
  if (argv[0] === 'issue' && argv[1] === 'comment') return 'issue-comment';
  if (argv[0] !== 'api') return `raw:${argv.join(' ')}`;

  const { method, endpoint } = apiEndpointAndMethod(argv.slice(1));
  const ep = endpoint || '';
  if (/\/dependencies\/blocked_by$/.test(ep)) {
    if (method === 'POST') return 'post-edge';
    if (method === 'GET') return 'read-edges';
  }
  if (/\/dependencies\/blocked_by\/\d+$/.test(ep) && method === 'DELETE') return 'delete-edge';
  if (/\/issues\/\d+$/.test(ep) && method === 'GET') return 'resolve-blocker';
  return `api:${method}:${ep}`;
}

/**
 * A clone with a real bare `origin` and a `main` trunk, private COLAB_HOME, and a SCRIPTED fake
 * `gh` on PATH ahead of any real one. `script` maps a dispatch key (see `classify` above) to
 * either a single `{code, stdout, stderr}` or an ARRAY of them, consumed FIFO per call — needed
 * because `read-edges` is called twice in the add path (before the write, and again after), and
 * each call must be able to answer differently.
 */
function fixture(script, { noOrigin = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-blocked-cli-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab blocked test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  if (!noOrigin) g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  if (!noOrigin) g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const scriptPath = path.join(bin, 'gh-script.json');
  const logPath = path.join(bin, 'gh-calls.log');
  fs.writeFileSync(scriptPath, JSON.stringify(script));
  fs.writeFileSync(logPath, '');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env node',
    `const fs = require('fs');`,
    `const scriptPath = ${JSON.stringify(scriptPath)};`,
    `const logPath = ${JSON.stringify(logPath)};`,
    'const script = JSON.parse(fs.readFileSync(scriptPath, "utf8"));',
    'const argv = process.argv.slice(2);',
    "if (argv[0] === '--version') { console.log('gh version 0.0.0 (fixture)'); process.exit(0); }",
    "if (argv[0] === 'auth' && argv[1] === 'status') { console.error('Logged in (fixture)'); process.exit(0); }",
    `${apiEndpointAndMethod.toString()}`,
    `${classify.toString()}`,
    'const key = classify(argv);',
    // Each `gh` call is a SEPARATE process, so an in-memory counter cannot survive between them
    // (measured: relying on `global` here silently cycled nothing, every call reading index 0).
    // The log file IS the persistent state — count this key's occurrences BEFORE this call to
    // pick this call's index into a scripted array, then append.
    'const priorLines = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8").trim().split("\\n").filter(Boolean) : [];',
    'const priorCount = priorLines.filter((l) => classify(JSON.parse(l)) === key).length;',
    'fs.appendFileSync(logPath, JSON.stringify(argv) + "\\n");',
    'let entry = script[key];',
    'if (Array.isArray(entry)) { entry = entry[Math.min(priorCount, entry.length - 1)]; }',
    'if (!entry) { console.error(`fixture gh: unscripted "${key}" — args: ${JSON.stringify(argv)}`); process.exit(1); }',
    'if (entry.stdout) process.stdout.write(entry.stdout);',
    'if (entry.stderr) process.stderr.write(entry.stderr);',
    'process.exit(entry.code || 0);',
  ].join('\n') + '\n', { mode: 0o755 });

  return {
    root, origin, work, home, bin, g,
    calls() { return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); },
    callCount(key) { return this.calls().filter((argv) => classify(argv) === key).length; },
  };
}

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const REPO_URL = 'https://api.github.com/repos/godx-jp/colab-handbook';
function issueJson({ id, number, state, url = REPO_URL }) {
  return { code: 0, stdout: JSON.stringify({ id, number, state, repository_url: url }) + '\n' };
}
function edgesJson(edges) { return { code: 0, stdout: JSON.stringify(edges) + '\n' }; }

// --- add: happy path -----------------------------------------------------------------------

test('blocked add: happy path — exit 0, success line, exactly one POST logged', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 250, state: 'open' }),
    'read-edges': [edgesJson([]), edgesJson([{ id: 900, number: 250, state: 'open', repository_url: REPO_URL }])],
    'post-edge': { code: 0 },
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /#1 is now blocked by #250/);
  assert.strictEqual(fx.callCount('post-edge'), 1);
});

// --- add: already present is a no-op, idempotent -------------------------------------------

test('blocked add: edge already present — exit 0, "already recorded", ZERO POSTs', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 250, state: 'open' }),
    'read-edges': edgesJson([{ id: 900, number: 250, state: 'open', repository_url: REPO_URL }]),
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /already recorded/);
  assert.strictEqual(fx.callCount('post-edge'), 0);
});

// --- add: failure mode 1's guard — resolution mismatch never reaches a POST ----------------

test('blocked add: blocker resolution returns a MISMATCHED number — non-zero, ZERO POSTs', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 999, state: 'open' }), // asked for 250, got 999
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /resolved issue is #999, not the requested #250/);
  assert.strictEqual(fx.callCount('post-edge'), 0);
});

test('blocked add: blocker resolution has no usable database id — non-zero, ZERO POSTs', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: null, number: 250, state: 'open' }),
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /no usable database id/);
  assert.strictEqual(fx.callCount('post-edge'), 0);
});

// --- add: read-back shows the WRONG blocker — the live worse-than-nothing failure ----------

test('blocked add: read-back shows a DIFFERENT blocker than the one POSTed — non-zero, no success line, prints the DELETE remediation, no auto-rollback', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 250, state: 'open' }),
    'read-edges': [
      edgesJson([]),
      edgesJson([{ id: 77, number: 34, state: 'open', repository_url: 'https://api.github.com/repos/some-other-org/unrelated-repo' }]),
    ],
    'post-edge': { code: 0 },
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.doesNotMatch(r.out, /is now blocked by/);
  assert.match(r.err, /WRONG BLOCKER/);
  assert.match(r.err, /gh api -X DELETE .*dependencies\/blocked_by\/77/);
  assert.strictEqual(fx.callCount('delete-edge'), 0); // no auto-rollback
});

// --- add: read-back call itself fails --------------------------------------------------------

test('blocked add: read-back call fails outright — non-zero, no success line, says unconfirmed', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 250, state: 'open' }),
    'read-edges': [edgesJson([]), { code: 1, stderr: 'fixture: read failed\n' }],
    'post-edge': { code: 0 },
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.doesNotMatch(r.out, /is now blocked by/);
  assert.match(r.err, /could not be confirmed/);
});

// --- add: arg-level refusals never touch the network -----------------------------------------

test('blocked add: missing --by — non-zero, ZERO gh calls of any kind', () => {
  const fx = fixture({});
  const r = colab(fx, ['blocked', '1', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--by <blocker> is required/);
  assert.strictEqual(fx.calls().length, 0);
});

test('blocked add: self-edge (#1 --by 1) — non-zero, ZERO gh calls', () => {
  const fx = fixture({});
  const r = colab(fx, ['blocked', '1', '--by', '1', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /cannot block itself/);
  assert.strictEqual(fx.calls().length, 0);
});

test('blocked --clear without --reason — non-zero, ZERO gh calls', () => {
  const fx = fixture({});
  const r = colab(fx, ['blocked', '1', '--by', '250', '--clear', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--clear requires --reason/);
  assert.strictEqual(fx.calls().length, 0);
});

// --- clear: already absent is a no-op ---------------------------------------------------------

test('blocked --clear: edge already absent — exit 0, no DELETE, no comment', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 250, state: 'open' }),
    'read-edges': edgesJson([]),
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--clear', '--reason', 'never true', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /nothing to do/);
  assert.strictEqual(fx.callCount('delete-edge'), 0);
  assert.strictEqual(fx.callCount('issue-comment'), 0);
});

// --- clear: closed blocker guard --------------------------------------------------------------

test('blocked --clear: CLOSED blocker without --force — non-zero, no DELETE, message names the guard', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 250, state: 'closed' }),
    'read-edges': edgesJson([{ id: 900, number: 250, state: 'closed', repository_url: REPO_URL }]),
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--clear', '--reason', 'was closed so I am clearing it', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /CLOSED/);
  assert.strictEqual(fx.callCount('delete-edge'), 0);
});

test('blocked --clear --force on a CLOSED blocker: DELETE logged, read-back clean, exit 0, receipt comment carries the --reason text', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 250, state: 'closed' }),
    'read-edges': [
      edgesJson([{ id: 900, number: 250, state: 'closed', repository_url: REPO_URL }]),
      edgesJson([]),
    ],
    'delete-edge': { code: 0 },
    'issue-comment': { code: 0 },
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--clear', '--force', '--reason', 'the edge was never true', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(fx.callCount('delete-edge'), 1);
  assert.strictEqual(fx.callCount('issue-comment'), 1);
  const commentCall = fx.calls().find((argv) => classify(argv) === 'issue-comment');
  assert.ok(commentCall.join(' ').includes('the edge was never true'), 'the receipt comment body must carry the --reason text');
});

// --- clear: receipt comment fails — the delete already landed, so this still exits 0 ---------

test('blocked --clear: receipt comment fails to post — exit 0 with a warning (the delete already landed)', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 250, state: 'open' }),
    'read-edges': [
      edgesJson([{ id: 900, number: 250, state: 'open', repository_url: REPO_URL }]),
      edgesJson([]),
    ],
    'delete-edge': { code: 0 },
    'issue-comment': { code: 1, stderr: 'fixture: comment failed\n' },
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--clear', '--reason', 'no longer true', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /receipt failed to post/);
});

// --- clear: read-back still shows the edge — never claim removal ------------------------------

test('blocked --clear: read-back STILL shows the edge after DELETE reports success — non-zero, does not claim removal', () => {
  const fx = fixture({
    'resolve-blocker': issueJson({ id: 900, number: 250, state: 'open' }),
    'read-edges': [
      edgesJson([{ id: 900, number: 250, state: 'open', repository_url: REPO_URL }]),
      edgesJson([{ id: 900, number: 250, state: 'open', repository_url: REPO_URL }]), // still there
    ],
    'delete-edge': { code: 0 },
  });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--clear', '--reason', 'no longer true', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.doesNotMatch(r.out, /Cleared/);
  assert.match(r.err, /STILL shows/);
});

// --- gh unusable: refuses before any write, names the reason ----------------------------------

test('blocked: gh unusable (no origin remote) — non-zero, message says it cannot be written local-only', () => {
  const fx = fixture({}, { noOrigin: true });
  const r = colab(fx, ['blocked', '1', '--by', '250', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /cannot be written local-only/);
});

// --- event discipline: no live pushEvent for this action ---------------------------------------

test('no ACTION_KIND entry exists for a blocked_by action, and tools/colab has no live pushEvent( call for it', () => {
  const notify = fs.readFileSync(path.join(REPO_ROOT, 'tools', 'lib', 'notify.js'), 'utf8');
  assert.doesNotMatch(notify, /'blocked-by':/);
  assert.doesNotMatch(notify, /dependency\.changed/);
  const colabSrc = fs.readFileSync(COLAB, 'utf8');
  // Only the prose comment mentioning the proposed kind may reference it; there must be no LIVE
  // call — i.e. no `pushEvent('blocked-by'` anywhere in the source.
  assert.doesNotMatch(colabSrc, /pushEvent\('blocked-by'/);
});
