'use strict';
/**
 * #681: the release half on a Forgejo remote (#678 landed the landing half).
 *
 *   - `colab release cut` reads CI from the forge's commit statuses, cuts and pushes the candidate tag,
 *     and publishes its pre-release through the forge's `/releases` API — no gh anywhere.
 *   - A red or unreadable status read refuses (exit 1, nothing tagged) — never "no candidate owed".
 *   - `colab release finalize` under the human bar tags the final and publishes its release object;
 *     it opens, comments on and closes no issue (the forge's tracker is the adopter's, #678).
 *   - `release finalize --auto`, and an automatic final, refuse on a forge, naming why.
 *   - A release route that tags finals (library-fast) refuses on a forge before writing anything.
 *
 * Real CLI, real repo, real bare origin on disk. The remote's CONFIGURED url names a forge host the
 * machine config's `forges` maps to a local HTTP server; `url.<bare>.insteadOf` carries git's own
 * traffic to the bare repo. PATH carries a `gh` that refuses everything, so a gh call on this path
 * would show up as a failure. The CLI runs async, because the fake forge answers from this process.
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

// This repo's own release shape (.github/project.yml): candidates on every green head, a human final.
const PROJECT_YML = [
  'tier: B', 'trunk: main', 'production: null', 'deploy: none', 'stack: node', 'exposure: released',
  'release:', '  candidates: auto', '  test-period: 0d', '  final: human', '',
].join('\n');

/** The fake forge. `statuses[sha]` is the combined-status list; `releases` the tags with a release. */
function forge(t) {
  const state = { statuses: {}, releases: new Map(), posts: [], seen: [], issues: [], failStatuses: false, writes: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      state.seen.push(`${req.method} ${req.url}`);
      const send = (code, json) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      const base = '/api/v1/repos/acme/app';
      let m;
      if (req.method === 'GET' && (m = new RegExp(`^${base}/commits/([0-9a-f]{40})/status\\?`).exec(req.url))) {
        if (state.failStatuses) return send(500, { message: 'boom' });
        const list = state.statuses[m[1]] || [];
        return send(200, { state: 'x', sha: m[1], total_count: list.length, statuses: list });
      }
      if (req.method === 'GET' && req.url.startsWith(`${base}/issues?`)) return send(200, state.issues);
      if (req.method === 'GET' && (m = new RegExp(`^${base}/issues/(\\d+)/dependencies`).exec(req.url))) return send(200, []);
      if (req.method === 'GET' && (m = new RegExp(`^${base}/releases/tags/(.+)$`).exec(req.url))) {
        const tag = decodeURIComponent(m[1]);
        return state.releases.has(tag) ? send(200, state.releases.get(tag)) : send(404, { message: 'Not Found' });
      }
      if (req.method === 'POST' && req.url === `${base}/releases`) {
        const j = JSON.parse(body || '{}');
        state.posts.push({ ...j, auth: req.headers.authorization || null });
        if (state.releases.has(j.tag_name)) return send(409, { message: 'release tag already exist' });
        const rel = { id: state.releases.size + 1, tag_name: j.tag_name, prerelease: j.prerelease, html_url: `https://${HOST}/acme/app/releases/tag/${j.tag_name}` };
        state.releases.set(j.tag_name, rel);
        return send(201, rel);
      }
      // Anything else — an issue create / comment / close / label — is a write the forge engine never makes.
      if (req.method !== 'GET') state.writes.push(`${req.method} ${req.url}`);
      return send(404, { message: 'Not Found' });
    });
  });
  t.after(() => new Promise((r) => server.close(r)));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, ...state, state })));
}

const ago = (min) => new Date(Date.now() - min * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const st = (id, context, status) => ({ id, context, status, target_url: null, created_at: ago(60), updated_at: ago(60) });

function fixture(port, { projectYml = PROJECT_YML } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-forgejo-release-'));
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

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab forgejo release test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  const url = `https://${HOST}/acme/app.git`;
  g(work, 'remote', 'add', 'origin', url);
  g(work, 'config', `url.${origin}.insteadOf`, url);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
  fs.writeFileSync(path.join(work, 'g.js'), 'module.exports = 1;\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: a feature since the last final');
  g(work, 'push', '-q', 'origin', 'main', '--follow-tags');
  const headSha = g(work, 'rev-parse', 'HEAD');
  const remoteTags = () => g(work, 'ls-remote', '--tags', 'origin').split('\n').map((l) => l.split('refs/tags/')[1]).filter((x) => x && !x.endsWith('^{}'));
  return { work, home, bin, headSha, remoteTags };
}

function colab(fx, args, env = {}) {
  return new Promise((resolve) => {
    const e = { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-681', COLAB_SESSION_NAME: '', FORGEJO_TOKEN: 'fixture-token', ...env };
    for (const k of ['COLAB_HUMAN', 'GITHUB_ACTIONS', 'GITHUB_WORKFLOW', 'FORGEJO_ACTIONS', 'GITEA_ACTIONS']) if (!(k in env)) delete e[k];
    const p = spawn('node', [COLAB, ...args], { env: e });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function json(r) {
  try { return JSON.parse(r.stdout); } catch (_) { return assert.fail(`not JSON (exit ${r.code}):\n${r.stdout}\n${r.stderr}`); }
}

const failing = (body) => (body.checks || []).filter((c) => c.ok === false && c.checked !== false).map((c) => `${c.condition}: ${c.detail}`);

test('#681 release cut on a forge: a green head is cut, pushed and published as a Forgejo pre-release — no gh', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  f.statuses[fx.headSha] = [st(1, 'CI / test (push)', 'success'), st(2, 'CI / lint (push)', 'success')];
  const r = await colab(fx, ['release', 'cut', '--repo', fx.work, '--json']);
  const body = json(r);
  assert.strictEqual(body.ok, true, `${failing(body).join('\n')}\n${r.stderr}`);
  assert.strictEqual(body.tag, 'v1.1.0-rc.1');
  assert.strictEqual(body.created, true);
  assert.ok(fx.remoteTags().includes('v1.1.0-rc.1'), 'the candidate tag is on the remote');
  assert.deepStrictEqual(body.published, { ok: true, detail: 'published the Forgejo pre-release v1.1.0-rc.1' });
  assert.strictEqual(f.posts.length, 1);
  assert.deepStrictEqual([f.posts[0].tag_name, f.posts[0].prerelease, f.posts[0].auth], ['v1.1.0-rc.1', true, 'token fixture-token']);
  assert.match(f.posts[0].body, /Candidate record/);
  const ci = body.checks.find((c) => /ci/i.test(c.condition) && /green/i.test(c.condition));
  assert.ok(ci && ci.ok, JSON.stringify(body.checks));
  assert.doesNotMatch(r.stdout + r.stderr, /fixture gh|known GitHub host/);
  assert.deepStrictEqual(f.writes, []);
});

test('#681 release cut on a forge: a red context refuses — nothing tagged, nothing published, the context named', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  f.statuses[fx.headSha] = [st(1, 'CI / test (push)', 'failure')];
  const r = await colab(fx, ['release', 'cut', '--repo', fx.work, '--json']);
  const body = json(r);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  assert.deepStrictEqual([body.ok, body.noop, body.created], [false, false, false]);
  assert.match(failing(body).join('\n'), /failure/);
  assert.ok(!fx.remoteTags().includes('v1.1.0-rc.1'));
  assert.strictEqual(f.posts.length, 0);
});

test('#681 release cut on a forge: an unreadable status read refuses — it is never "no candidate owed"', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  f.state.failStatuses = true;
  const r = await colab(fx, ['release', 'cut', '--repo', fx.work, '--auto', '--json']);
  const body = json(r);
  assert.strictEqual(r.code, 1, r.stdout + r.stderr);
  assert.deepStrictEqual([body.ok, body.noop, body.created], [false, false, false]);
  assert.match(failing(body).join('\n'), /commit statuses could not be read/);
  assert.strictEqual(f.posts.length, 0);
});

test('#681 release cut inside the Forgejo release workflow: its own dispatched run at the sha is not part of the verdict', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  f.statuses[fx.headSha] = [st(1, 'CI / test (push)', 'success'), st(9, 'release-auto / cut (workflow_dispatch)', 'pending')];
  const env = { GITHUB_ACTIONS: 'true', FORGEJO_ACTIONS: 'true', GITHUB_WORKFLOW: '.forgejo/workflows/release-auto.yml' };
  const r = await colab(fx, ['release', 'cut', '--repo', fx.work, '--auto', '--sha', fx.headSha, '--json'], env);
  const body = json(r);
  assert.strictEqual(body.ok, true, `${failing(body).join('\n')}\n${r.stderr}`);
  assert.strictEqual(body.tag, 'v1.1.0-rc.1');
});

test('#681 release finalize on a forge: the human bar tags the final and publishes its release; no issue is written', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  f.statuses[fx.headSha] = [st(1, 'CI / test (push)', 'success')];
  const cut = json(await colab(fx, ['release', 'cut', '--repo', fx.work, '--json']));
  assert.strictEqual(cut.tag, 'v1.1.0-rc.1', JSON.stringify(cut));
  const r = await colab(fx, ['release', 'finalize', '--repo', fx.work, '--tag', 'v1.1.0-rc.1', '--answered-by', 'tester', '--json'], { COLAB_HUMAN: '1' });
  const body = json(r);
  assert.strictEqual(body.state, 'finalized', `${failing(body).join('\n')}\n${r.stderr}`);
  assert.strictEqual(body.tagged, true);
  assert.ok(fx.remoteTags().includes('v1.1.0'), 'the final tag is on the remote');
  assert.deepStrictEqual(body.published, { ok: true, detail: 'published the Forgejo release v1.1.0' });
  assert.deepStrictEqual(f.posts.map((p) => [p.tag_name, p.prerelease]), [['v1.1.0-rc.1', true], ['v1.1.0', false]]);
  const tr = body.checks.find((c) => c.condition === 'tracking-issue');
  assert.match(tr.detail, /keeps no tracking record/);
  assert.strictEqual(body.tracking.number, null);
  assert.deepStrictEqual(f.writes, [], 'no issue create/comment/close on the forge');
  assert.doesNotMatch(r.stdout + r.stderr, /fixture gh|known GitHub host/);
});

test('#681 release finalize on a forge: --auto and an automatic final refuse, naming the human bar', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  const auto = await colab(fx, ['release', 'finalize', '--repo', fx.work, '--auto']);
  assert.notStrictEqual(auto.code, 0);
  assert.match(auto.stderr, /forgejo remote .* a final is a human act/);
  const bare = await colab(fx, ['release', 'finalize', '--repo', fx.work]);
  assert.notStrictEqual(bare.code, 0);
  assert.match(bare.stderr, /COLAB_HUMAN=1 colab release finalize --tag/);
  assert.strictEqual(f.posts.length, 0);
});

test('#681 a final-tagging route (library-fast) refuses on a forge before writing anything', async (t) => {
  const f = await forge(t);
  const yml = PROJECT_YML.replace('release:\n  candidates: auto\n  test-period: 0d\n  final: human\n', 'release:\n  route: library-fast\n');
  const fx = fixture(f.port, { projectYml: yml });
  f.statuses[fx.headSha] = [st(1, 'CI / test (push)', 'success')];
  const r = await colab(fx, ['release', 'cut', '--repo', fx.work, '--auto']);
  assert.notStrictEqual(r.code, 0, r.stdout);
  assert.match(r.stderr, /library-fast .* writes no issue/);
  assert.deepStrictEqual(fx.remoteTags(), ['v1.0.0']);
  assert.strictEqual(f.posts.length, 0);
});

test('#681 ci-wait on a Forgejo runner: the calling workflow\'s own pending context is not waited on', async (t) => {
  const f = await forge(t);
  const fx = fixture(f.port);
  f.statuses[fx.headSha] = [st(1, 'CI / test (push)', 'success'), st(9, 'release-auto / cut (workflow_dispatch)', 'pending')];
  const env = { GITHUB_ACTIONS: 'true', FORGEJO_ACTIONS: 'true', GITHUB_WORKFLOW: '.forgejo/workflows/release-auto.yml' };
  const r = await colab(fx, ['ci-wait', '--repo', fx.work, '--sha', fx.headSha, '--json', '--timeout', '5s'], env);
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).outcome, 'GREEN');
  // Off the runner the same statuses are still in flight — the filter is the runner's alone.
  const off = await colab(fx, ['ci-wait', '--repo', fx.work, '--sha', fx.headSha, '--json', '--timeout', '1s']);
  assert.strictEqual(off.code, 3, off.stdout + off.stderr);
});
