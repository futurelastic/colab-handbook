'use strict';
/**
 * #765: on a Forgejo remote (#678) a red trunk goes through the same red-trunk doors as on GitHub —
 * the release-only door (#736), the cure rule (#281), a ci-grant (#105) — with their evidence read from
 * commit statuses. Before, `shipCiCheck` returned a forge verdict as final: `ciCure`, `ciGrant` and
 * `releaseOnly` were all null and a red trunk could not be cured or granted past.
 *
 * Real CLI, real repo, real bare origin on disk; the remote's configured url names a forge host the
 * machine config maps to a local HTTP server (the shape of ship-forgejo-branch-ci.test.js). The fake
 * forge answers the combined-status endpoint plus the READS a forge grant needs: the issue, its
 * comments, a login's collaborator permission and the issue timeline. PATH carries a `gh` that refuses
 * everything, so a gh call anywhere on this path would show as a failure. Nothing here is ever written
 * to the forge: the server answers GET only and fails the test on any other method.
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
const ciGrant = require('./ci-grant');
const { CI_GRANT_LABEL } = require('./labels');
const HOST = 'git.forge.test';
const ISSUE = 7;
const BRANCH = `fix/build-${ISSUE}`;

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/** The fake forge. `statuses[sha]` → status list; `issue`/`comments`/`perms`/`timeline` → the grant reads. */
function forge(t) {
  const state = { statuses: {}, issue: null, comments: [], perms: {}, timeline: [], seen: [], writes: [] };
  const server = http.createServer((req, res) => {
    state.seen.push(`${req.method} ${req.url}`);
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'GET') { state.writes.push(`${req.method} ${req.url}`); json(405, {}); return; }
    const base = '/api/v1/repos/acme/app';
    let m;
    if ((m = new RegExp(`^${base}/commits/([0-9a-f]{40})/status\\?`).exec(req.url))) {
      const list = state.statuses[m[1]] || [];
      json(200, { state: 'x', sha: m[1], total_count: list.length, statuses: list });
    } else if ((m = new RegExp(`^${base}/issues/(\\d+)/comments\\?`).exec(req.url))) {
      json(200, Number(m[1]) === ISSUE ? state.comments : []);
    } else if ((m = new RegExp(`^${base}/issues/(\\d+)/timeline\\?`).exec(req.url))) {
      json(200, Number(m[1]) === ISSUE ? state.timeline : []);
    } else if ((m = new RegExp(`^${base}/issues/(\\d+)$`).exec(req.url))) {
      if (Number(m[1]) === ISSUE && state.issue) json(200, state.issue); else json(404, {});
    } else if ((m = new RegExp(`^${base}/collaborators/([^/]+)/permission$`).exec(req.url))) {
      const p = state.perms[decodeURIComponent(m[1])];
      if (p) json(200, { permission: p }); else json(404, {});
    } else {
      json(404, {});
    }
  });
  t.after(() => new Promise((r) => server.close(r)));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ ...state, port: server.address().port, state })));
}

const st = (id, context, status) => ({ id, context, status, target_url: null, created_at: '2026-11-21T05:00:00Z', updated_at: '2026-11-21T05:00:00Z' });

/**
 * main@base (green) → main@red (the commit that broke `CI / Build`) → BRANCH cut from red, carrying the
 * fix. `extraYml` is appended to trunk's project.yml (release-only-checks, trust-humans).
 */
function fixture(port, { extraYml = '', branchFile = 'src/build.js', priorExemption = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-forgejo-red-trunk-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ forges: { [HOST]: { engine: 'forgejo', api: `http://127.0.0.1:${port}/api/v1` } } }));
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\necho "fixture gh: refusing $*" >&2\nexit 1\n', { mode: 0o755 });
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // A commit at a fixed instant (author AND committer), so "after the prior exemption" is never a same-second tie.
  const commitAt = (iso, msg) => execFileSync('git', ['commit', '-q', '-m', msg], { cwd: work, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab forgejo red-trunk test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  const url = `https://${HOST}/acme/app.git`;
  g(work, 'remote', 'add', 'origin', url);
  g(work, 'config', `url.${origin}.insteadOf`, url);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.mkdirSync(path.join(work, 'src'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'),
    `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n${extraYml}`);
  fs.writeFileSync(path.join(work, 'src', 'build.js'), 'module.exports = 1;\n');
  g(work, 'add', '-A');
  // priorExemption: the base is itself a cure merged over an earlier red (its `CI-Cure:` trailer), and a
  // commit lands between it and the red — the commit computeAntiStacking reads to ask "went green since?".
  commitAt('2026-11-20T01:00:00Z', priorExemption ? 'fix: an earlier cure\n\nCI-Cure: over-red main@abcdef1 evidence x@1234567' : 'chore: fixture');
  const baseSha = g(work, 'rev-parse', 'HEAD');
  let midSha = null;
  if (priorExemption) {
    fs.writeFileSync(path.join(work, 'src', 'other.js'), 'module.exports = 3;\n');
    g(work, 'add', '-A');
    commitAt('2026-11-20T02:00:00Z', 'chore: between');
    midSha = g(work, 'rev-parse', 'HEAD');
  }
  fs.writeFileSync(path.join(work, 'src', 'build.js'), 'module.exports = ;\n');
  g(work, 'add', '-A');
  commitAt('2026-11-20T03:00:00Z', 'feat: the change that broke the build');
  g(work, 'push', '-q', 'origin', 'main');
  const redSha = g(work, 'rev-parse', 'HEAD');

  g(work, 'checkout', '-q', '-b', BRANCH);
  fs.mkdirSync(path.dirname(path.join(work, branchFile)), { recursive: true });
  fs.writeFileSync(path.join(work, branchFile), 'module.exports = 2;\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', `fix: repair the build (#${ISSUE})`);
  g(work, 'push', '-q', 'origin', BRANCH);
  const headSha = g(work, 'rev-parse', 'HEAD');
  g(work, 'checkout', '-q', 'main');
  // The branch's claim on #ISSUE, as `colab claim` records it locally — what ship's issue set reads.
  const repo = fs.realpathSync(work);
  fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify({ claims: {
    [`${repo}#${ISSUE}`]: { repo, issue: ISSUE, branch: BRANCH, session: 'sess-765', claimedAt: '2026-11-21T04:00:00Z' } } }));
  return { work, home, bin, baseSha, midSha, redSha, headSha };
}

function colab(fx, args) {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-765', COLAB_SESSION_NAME: '' };
    delete env.FORGEJO_TOKEN;
    delete env.COLAB_HUMAN;
    const p = spawn('node', [COLAB, ...args], { env });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function dry(fx) {
  const r = await colab(fx, ['ship', '--branch', BRANCH, '--repo', fx.work, '--dry', '--json']);
  let body;
  try { body = JSON.parse(r.stdout); } catch (_) { assert.fail(`not JSON (exit ${r.code}): ${r.stdout}\n${r.stderr}`); }
  return { body, trunk: body.checks.find((c) => c.name === 'trunk CI green'), stderr: r.stderr };
}

/** Trunk red on `CI / Build` at the red head, green elsewhere. */
function redTrunk(f, fx) {
  f.state.statuses[fx.redSha] = [st(1, 'CI / Build (push)', 'failure'), st(2, 'CI / Lint (push)', 'success')];
}

test('#765 cure: a branch that contains the red head and passes the red job is admitted by the cure rule on a forge', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  redTrunk(f, fx);
  f.state.statuses[fx.headSha] = [st(3, 'CI / Build (push)', 'success'), st(4, 'CI / Lint (push)', 'success')];
  const { body, trunk } = await dry(fx);
  assert.ok(body.ciCure, `ciCure is null — the cure rule was never asked: ${JSON.stringify(trunk)}`);
  assert.strictEqual(body.ciCure.ok, true, JSON.stringify(body.ciCure));
  assert.strictEqual(body.ciCure.redSha, fx.redSha);
  assert.strictEqual(body.ciCure.evidenceSha, fx.headSha);
  assert.strictEqual(trunk.ok, true, JSON.stringify(trunk));
  assert.match(trunk.detail, /PRECONDITION OVERRIDDEN by the cure rule \(#281\)/);
  assert.deepStrictEqual(f.state.writes, [], 'nothing is written to a forge');
});

test('#765 cure: a branch whose head does not pass the red job is refused WITH a reason, not skipped', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  redTrunk(f, fx);
  f.state.statuses[fx.headSha] = [st(4, 'CI / Lint (push)', 'success')]; // green, but `CI / Build` never ran
  const { body, trunk } = await dry(fx);
  assert.ok(body.ciCure, 'the cure rule was asked');
  assert.strictEqual(body.ciCure.ok, false);
  assert.match(body.ciCure.reason, /`CI \/ Build` is red on trunk and does not exist on the branch's run/);
  assert.deepStrictEqual([trunk.ok, trunk.class], [false, 'human-gated'], JSON.stringify(trunk));
  assert.match(trunk.detail, /cure rule \(#281\): /, 'the row names the door refusal (#534)');
  // and the grant door was asked too: no grant on a forge issue that does not exist is a stated refusal
  assert.ok(body.ciGrant, 'the ci-grant door was asked');
  assert.strictEqual(body.ciGrant.ok, false);
  assert.match(JSON.stringify(body.ciGrant.missing), /could not be read from the tracker/);
});

test('#765 cure: a branch that changes a workflow file is refused by the carve-out with its reason — a status has no steps', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port, { branchFile: '.forgejo/workflows/ci.yml' });
  redTrunk(f, fx);
  f.state.statuses[fx.headSha] = [st(3, 'CI / Build (push)', 'success'), st(4, 'CI / Lint (push)', 'success')];
  const { body } = await dry(fx);
  assert.strictEqual(body.ciCure.ok, false);
  assert.match(body.ciCure.reason, /carve-out does not admit it either/);
});

test('#765 ci-grant: a live human grant on the carried issue admits a non-cure fix — read from the forge, never written', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  redTrunk(f, fx);
  f.state.statuses[fx.headSha] = [st(4, 'CI / Lint (push)', 'success')]; // not a cure: `CI / Build` never ran
  f.state.issue = { number: ISSUE, title: 'fix the build', body: '', state: 'open', labels: [{ name: CI_GRANT_LABEL }], assignees: [] };
  f.state.comments = [{ id: 1, user: { login: 'ada' }, created_at: '2026-11-21T06:00:00Z',
    body: ciGrant.grantCommentBody(BRANCH, 'main', fx.redSha, fx.headSha, 'box-a', '2026-11-21T06:00:00Z') }];
  f.state.perms.ada = 'write';
  const { body, trunk } = await dry(fx);
  assert.strictEqual(body.ciCure.ok, false, 'the cure rule refuses first');
  assert.ok(body.ciGrant, 'the grant door was asked');
  assert.strictEqual(body.ciGrant.ok, true, JSON.stringify(body.ciGrant));
  assert.deepStrictEqual(body.ciGrant.granted.map((g) => [g.issue, g.by, g.redSha, g.evidenceSha]), [[ISSUE, 'ada', fx.redSha, fx.headSha]]);
  assert.strictEqual(trunk.ok, true, JSON.stringify(trunk));
  assert.match(trunk.detail, /PRECONDITION OVERRIDDEN by a human ci-grant on #7/);
  assert.deepStrictEqual(f.state.writes, []);
});

test('#765 ci-grant: a grant posted by a read-only account is refused, and under trust-humans the label adder is read from the timeline', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port, { extraYml: 'trust-humans: [ada]\n' });
  redTrunk(f, fx);
  f.state.statuses[fx.headSha] = [st(4, 'CI / Lint (push)', 'success')];
  f.state.issue = { number: ISSUE, title: 'fix the build', body: '', state: 'open', labels: [{ name: CI_GRANT_LABEL }], assignees: [] };
  f.state.comments = [{ id: 1, user: { login: 'ada' }, created_at: '2026-11-21T06:00:00Z',
    body: ciGrant.grantCommentBody(BRANCH, 'main', fx.redSha, fx.headSha, 'box-a', '2026-11-21T06:00:00Z') }];
  f.state.perms.ada = 'read';
  let { body } = await dry(fx);
  assert.strictEqual(body.ciGrant.ok, false);
  assert.match(JSON.stringify(body.ciGrant.missing), /no longer a repo owner\/member\/collaborator/);

  // write permission, but the label was added by someone trust-humans does not list → refused on the label half
  f.state.perms.ada = 'write';
  f.state.timeline = [{ type: 'label', label: { name: CI_GRANT_LABEL }, user: { login: 'eve' }, body: '1' }];
  ({ body } = await dry(fx));
  assert.strictEqual(body.ciGrant.ok, false, JSON.stringify(body.ciGrant));
  assert.ok(f.state.seen.some((u) => u.includes(`/issues/${ISSUE}/timeline`)), 'the label adder was read from the timeline');

  // added by ada → admitted
  f.state.timeline = [{ type: 'label', label: { name: CI_GRANT_LABEL }, user: { login: 'ada' }, body: '1' }];
  ({ body } = await dry(fx));
  assert.strictEqual(body.ciGrant.ok, true, JSON.stringify(body.ciGrant));
});

test('#765 release-only: a red only on a declared release-only check the branch does not touch is admitted on a forge', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port, { extraYml: 'release-only-checks:\n  "Release / publish": [".forgejo/workflows/release.yml"]\n' });
  f.state.statuses[fx.redSha] = [st(1, 'Release / publish (push)', 'failure'), st(2, 'CI / Build (push)', 'success')];
  f.state.statuses[fx.headSha] = [st(3, 'CI / Build (push)', 'success')];
  const { body, trunk } = await dry(fx);
  assert.ok(body.releaseOnly, `releaseOnly is null: ${JSON.stringify(trunk)}`);
  assert.strictEqual(body.releaseOnly.ok, true, JSON.stringify(body.releaseOnly));
  assert.strictEqual(trunk.ok, true, JSON.stringify(trunk));
  assert.match(trunk.detail, /release-only door \(#736\)/);
});

test('#765 a green forge trunk still asks no door — the doors are reached only from a red', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  f.state.statuses[fx.redSha] = [st(1, 'CI / Build (push)', 'success')];
  f.state.statuses[fx.headSha] = [st(3, 'CI / Build (push)', 'success')];
  const { body, trunk } = await dry(fx);
  assert.strictEqual(trunk.ok, true);
  assert.deepStrictEqual([body.ciCure, body.ciGrant, body.releaseOnly], [null, null, null]);
  assert.ok(!f.state.seen.some((u) => u.includes('/issues/')), 'no issue read on a green trunk');
});

test('#765 anti-stacking on a forge: a red continuous since a prior cure refuses; a green commit since then lifts it', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port, { priorExemption: true });
  redTrunk(f, fx);
  f.state.statuses[fx.headSha] = [st(3, 'CI / Build (push)', 'success'), st(4, 'CI / Lint (push)', 'success')];
  // the commit between the prior cure and this red never went green → still the same red → stacked
  f.state.statuses[fx.midSha] = [st(5, 'CI / Build (push)', 'failure')];
  let { body } = await dry(fx);
  assert.strictEqual(body.ciCure.ok, false, JSON.stringify(body.ciCure));
  assert.match(body.ciCure.reason, /red ever since/);
  assert.ok(f.state.seen.some((u) => u.includes(`/commits/${fx.midSha}/status`)), 'trunk commits since the prior exemption were read from the forge');

  // it went green in between → a NEW red → the cure is admitted. One green context beside a red one
  // would not do: the commit's whole status is summarized.
  f.state.statuses[fx.midSha] = [st(5, 'CI / Build (push)', 'success'), st(6, 'CI / Lint (push)', 'failure')];
  ({ body } = await dry(fx));
  assert.strictEqual(body.ciCure.ok, false, 'a half-green commit is not green');
  f.state.statuses[fx.midSha] = [st(5, 'CI / Build (push)', 'success'), st(6, 'CI / Lint (push)', 'success')];
  ({ body } = await dry(fx));
  assert.strictEqual(body.ciCure.ok, true, JSON.stringify(body.ciCure));
});
