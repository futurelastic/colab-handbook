'use strict';
/**
 * #682: on a Forgejo remote (#678), the BRANCH half of the CI gate reads the forge too.
 *
 *   - `colab ship --dry --json` refuses a branch whose head carries a failing commit status
 *     (human-gated, naming the context) and reports a running one as not ready (self-clearing).
 *     Measured before the fix: both read READY — only the stale-base row looked at the branch.
 *   - `colab ci-wait --sha` waits on and classifies a forge branch head (it exited 5 with
 *     `no known GitHub host` before: it always asked gh).
 *
 * Real CLI, real repo, real bare origin on disk. The remote's CONFIGURED url names a forge host the
 * machine config's `forges` maps to a local HTTP server that answers the combined-status endpoint;
 * `url.<bare>.insteadOf` carries git's own traffic to the bare repo (the engine is read from the
 * configured url, never the rewritten one — tools/lib/tracker.js engineFor). No `gh` is reachable:
 * PATH carries a `gh` that refuses everything, so any gh call on this path would show as a failure.
 * The CLI runs async here, because the fake forge answers from this process.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const HOST = 'git.forge.test';

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

/** The fake forge: `statuses[sha]` is the status list its combined-status endpoint returns. */
function forge(t) {
  const statuses = {};
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.url);
    const m = /^\/api\/v1\/repos\/acme\/app\/commits\/([0-9a-f]{40})\/status\?/.exec(req.url);
    if (!m) { res.writeHead(404); res.end('{}'); return; }
    const list = statuses[m[1]] || [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ state: 'x', sha: m[1], total_count: list.length, statuses: list }));
  });
  t.after(() => new Promise((r) => server.close(r)));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, statuses, seen })));
}

const st = (id, context, status) => ({ id, context, status, target_url: null, created_at: '2026-11-06T05:00:00Z', updated_at: '2026-11-06T05:00:00Z' });

function fixture(port, { mapped = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-forgejo-branch-ci-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(mapped ? { forges: { [HOST]: { engine: 'forgejo', api: `http://127.0.0.1:${port}/api/v1` } } } : {}));
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "fixture gh: refusing $*" >&2\nexit 1\n', { mode: 0o755 });
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab forgejo branch-ci test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  const url = `https://${HOST}/acme/app.git`;
  g(work, 'remote', 'add', 'origin', url);
  g(work, 'config', `url.${origin}.insteadOf`, url);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const trunkSha = g(work, 'rev-parse', 'HEAD');

  g(work, 'checkout', '-q', '-b', 'feat/forge-x');
  fs.writeFileSync(path.join(work, 'g.js'), 'module.exports = 1;\n'); // code, so the docs-only door stays shut
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: x');
  g(work, 'push', '-q', 'origin', 'feat/forge-x');
  const headSha = g(work, 'rev-parse', 'HEAD');
  g(work, 'checkout', '-q', 'main');
  return { work, home, bin, trunkSha, headSha };
}

function colab(fx, args) {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-682', COLAB_SESSION_NAME: '' };
    delete env.FORGEJO_TOKEN;
    const p = spawn('node', [COLAB, ...args], { env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function shipRows(fx) {
  const r = await colab(fx, ['ship', '--branch', 'feat/forge-x', '--repo', fx.work, '--dry', '--json']);
  let body;
  try { body = JSON.parse(r.stdout); } catch (_) { assert.fail(`not JSON (exit ${r.code}): ${r.stdout}\n${r.stderr}`); }
  const row = (name) => body.checks.find((c) => c.name === name);
  return { body, trunk: row('trunk CI green'), stale: row('branch run contains current base (#395)'), head: row('branch CI green at its head (#682)') };
}

const GREEN_TRUNK = (f) => { f.statuses[f.trunkSha] = [st(1, 'CI / smoke (push)', 'success')]; };

test('#682 ship --dry: a failing branch context refuses (human-gated, the context named) — it read READY before', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  GREEN_TRUNK({ statuses: f.statuses, trunkSha: fx.trunkSha });
  f.statuses[fx.headSha] = [st(2, 'CI / lint (push)', 'success'), st(3, 'CI / smoke (push)', 'failure')];
  const { body, trunk, stale, head } = await shipRows(fx);
  assert.strictEqual(trunk.ok, true, JSON.stringify(trunk));
  assert.strictEqual(stale.ok, true, 'the head contains trunk — the stale-base row alone passes, which was the bug');
  assert.ok(head, `no branch-head row: ${JSON.stringify(body.checks.map((c) => c.name))}`);
  assert.deepStrictEqual([head.ok, head.class, head.verdict], [false, 'human-gated', 'red'], JSON.stringify(head));
  assert.match(head.detail, /failing: CI \/ smoke \(push\) \(failure\)/);
  assert.strictEqual(body.ok, false, 'the dry run is not READY');
  assert.ok(f.seen.some((u) => u.includes(fx.headSha)), 'the branch head was read from the forge');
});

test('#682 ship --dry: a running branch context is not ready — self-clearing, with the ci-wait to run', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  GREEN_TRUNK({ statuses: f.statuses, trunkSha: fx.trunkSha });
  f.statuses[fx.headSha] = [st(2, 'CI / smoke (push)', 'pending')];
  const { body, head } = await shipRows(fx);
  assert.deepStrictEqual([head.ok, head.class, head.verdict], [false, 'self-clearing', 'pending'], JSON.stringify(head));
  assert.ok(head.detail.includes(`colab ci-wait --sha ${fx.headSha} --branch feat/forge-x`), head.detail);
  assert.strictEqual(body.ok, false);
});

test('#682 ship --dry: a green branch head passes the row', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  GREEN_TRUNK({ statuses: f.statuses, trunkSha: fx.trunkSha });
  f.statuses[fx.headSha] = [st(2, 'CI / lint (push)', 'success'), st(3, 'CI / smoke (push)', 'success')];
  const { head } = await shipRows(fx);
  assert.deepStrictEqual([head.ok, head.class, head.verdict], [true, null, 'green'], JSON.stringify(head));
  assert.match(head.detail, /2 contexts at feat\/forge-x@.* all success/);
});

test('#682 ship --dry: no status at the head adds no row — Branch CI\'s `none` governs it, unchanged', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  GREEN_TRUNK({ statuses: f.statuses, trunkSha: fx.trunkSha });
  const { stale, head } = await shipRows(fx);
  assert.strictEqual(head, undefined);
  assert.strictEqual(stale.verdict, 'no-run');
});

test('#682 ci-wait --sha on a forge: green exits 0, red exits 1 naming the failing context — no gh involved', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  f.statuses[fx.headSha] = [st(2, 'CI / smoke (push)', 'success')];
  const g = await colab(fx, ['ci-wait', '--repo', fx.work, '--sha', fx.headSha, '--branch', 'feat/forge-x', '--json', '--timeout', '5s']);
  assert.strictEqual(g.code, 0, g.stdout + g.stderr);
  const gj = JSON.parse(g.stdout);
  assert.deepStrictEqual([gj.outcome, gj.status, gj.conclusion], ['GREEN', 'completed', 'success']);
  assert.match(gj.target, /forgejo commit status/);

  f.statuses[fx.headSha] = [st(2, 'CI / lint (push)', 'success'), st(3, 'CI / smoke (push)', 'failure')];
  const r = await colab(fx, ['ci-wait', '--repo', fx.work, '--sha', fx.headSha, '--branch', 'feat/forge-x', '--timeout', '5s']);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^RED .*not green: CI \/ smoke \(push\) \(failure\)/m);
  assert.doesNotMatch(r.stdout + r.stderr, /known GitHub host|fixture gh/);
});

test('#682 ci-wait on a forge: a running context waits out the deadline (exit 3); a run id is a usage error (exit 2)', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  f.statuses[fx.headSha] = [st(2, 'CI / smoke (push)', 'pending')];
  const p = await colab(fx, ['ci-wait', '--repo', fx.work, '--sha', fx.headSha, '--branch', 'feat/forge-x', '--json', '--timeout', '1s']);
  assert.strictEqual(p.code, 3, p.stdout + p.stderr);
  assert.strictEqual(JSON.parse(p.stdout).outcome, 'TIMEOUT');
  const u = await colab(fx, ['ci-wait', '--repo', fx.work, '12345']);
  assert.strictEqual(u.code, 2, u.stdout + u.stderr);
  assert.match(u.stderr, /forgejo forge — a commit status has no run id/);
});

test('#682 ship --dry (prose table): the red branch head is a ✗ row, and the dry run does not read READY', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  GREEN_TRUNK({ statuses: f.statuses, trunkSha: fx.trunkSha });
  f.statuses[fx.headSha] = [st(3, 'CI / smoke (push)', 'failure')];
  const r = await colab(fx, ['ship', '--branch', 'feat/forge-x', '--repo', fx.work, '--dry']);
  assert.match(r.stdout, /✗\s+branch CI green at its head \(#682\)\s+feat\/forge-x@\S+ \(forgejo commit status\) is red — failing: CI \/ smoke \(push\) \(failure\)/);
  assert.match(r.stdout, /→ NOT READY/);
  assert.notStrictEqual(r.code, 0, r.stdout);
});

test('#682 the same repo with no forges entry reads as GitHub: no branch-head row, the forge never asked — unchanged', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port, { mapped: false });
  f.statuses[fx.headSha] = [st(3, 'CI / smoke (push)', 'failure')];
  const { body, stale, head } = await shipRows(fx);
  assert.strictEqual(head, undefined, JSON.stringify(body.checks.map((c) => c.name)));
  assert.ok(stale, 'the code branch reaches the #395 row, not the docs-only one');
  assert.deepStrictEqual(f.seen, [], 'no request reached the forge');
});
