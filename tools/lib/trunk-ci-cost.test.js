'use strict';
/**
 * #495: `colab trunk-ci` measured at 4 REST + 1 GraphQL per call — `gh auth status --active`
 * (GET / + GraphQL), `gh run list` (runs + workflows), one check-runs read — and agents called it
 * every 20 s in loops. Now: no auth probe, ONE `actions/runs?head_sha=` read, and the verdict cached
 * per trunk+sha in the git dir so a second call inside the TTL makes no gh call at all.
 *
 * Real CLI, real repo, real bare `origin`, fake `gh` that logs every call and answers `api -i` with
 * an HTTP head + body — the shape `gh api -i` prints.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.resolve(__dirname, '..', 'colab');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-trunk-ci-cost-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 't@example.invalid');
  g(work, 'config', 'user.name', 't');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'));
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const sha = g(work, 'rev-parse', 'HEAD').trim();
  const runs = path.join(root, 'runs.json');
  const log = path.join(root, 'calls.log');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    `echo "$*" >> "${log}"`,
    'case "$*" in',
    `  "api -i repos/{owner}/{repo}/actions/runs?"*) printf 'HTTP/2.0 200 OK\\r\\nEtag: "e"\\r\\n\\r\\n'; cat "${runs}"; exit 0 ;;`,
    '  "api repos/{owner}/{repo}/commits/"*) echo "[]"; exit 0 ;;',
    'esac',
    'echo "fixture gh: refusing $*" >&2; exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  const setRuns = (rows) => fs.writeFileSync(runs, JSON.stringify({ workflow_runs: rows }));
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  const env = (extra = {}) => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: path.join(root, 'home'), ...extra });
  return { root, work, sha, setRuns, calls, env };
}

const run = (sha, name, conclusion, id) => ({ id, head_sha: sha, status: 'completed', conclusion, name, event: 'push', created_at: '2026-10-05T10:00:00Z' });

function trunkCi(fx, extraArgs = [], env = {}) {
  const r = spawnSync('node', [COLAB, 'trunk-ci', '--repo', fx.work, '--json', ...extraArgs], { encoding: 'utf8', env: fx.env(env) });
  return { code: r.status, body: JSON.parse(r.stdout), stderr: r.stderr };
}

test('#495 a GREEN read: no auth probe, one runs call, one check-runs call — and no `gh run list`', () => {
  const fx = fixture();
  fx.setRuns([run(fx.sha, 'CI', 'success', 1)]);
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'GREEN', JSON.stringify(t.body));
  const calls = fx.calls();
  assert.deepStrictEqual(calls.map((c) => c.split(' ').slice(0, 3).join(' ').replace(/\?.*/, '')),
    ['api -i repos/{owner}/{repo}/actions/runs', 'api repos/{owner}/{repo}/commits/' + fx.sha + '/check-runs'], calls.join('\n'));
  assert.match(calls[0], new RegExp(`head_sha=${fx.sha}&branch=main`));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('#495 a second read inside the TTL is answered from the shared cache — zero gh calls', () => {
  const fx = fixture();
  fx.setRuns([run(fx.sha, 'CI', 'failure', 1)]);
  assert.strictEqual(trunkCi(fx).body.verdict, 'RED');
  const before = fx.calls().length;
  fx.setRuns([run(fx.sha, 'CI', 'success', 2)]);
  const again = trunkCi(fx);
  assert.strictEqual(again.body.verdict, 'RED', 'cached');
  assert.strictEqual(typeof again.body.cachedAgeSec, 'number');
  assert.strictEqual(fx.calls().length, before, 'no gh call on a cache hit');
  assert.strictEqual(trunkCi(fx, ['--fresh']).body.verdict, 'GREEN', '--fresh reads through');
  assert.strictEqual(trunkCi(fx, [], { COLAB_TRUNK_CI_TTL: '0' }).body.cachedAgeSec, undefined, 'TTL 0 disables');
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('#495 a new trunk sha is never answered from the previous sha\'s cached verdict', () => {
  const fx = fixture();
  fx.setRuns([run(fx.sha, 'CI', 'failure', 1)]);
  assert.strictEqual(trunkCi(fx).body.verdict, 'RED');
  fs.writeFileSync(path.join(fx.work, 'n.txt'), 'n\n');
  execFileSync('git', ['add', '-A'], { cwd: fx.work });
  execFileSync('git', ['commit', '-q', '-m', 'fix: n'], { cwd: fx.work });
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: fx.work });
  const sha2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fx.work, encoding: 'utf8' }).trim();
  fx.setRuns([run(sha2, 'CI', 'success', 2)]);
  const t = trunkCi(fx);
  assert.strictEqual(t.body.sha, sha2);
  assert.strictEqual(t.body.verdict, 'GREEN');
  assert.strictEqual(t.body.cachedAgeSec, undefined);
  fs.rmSync(fx.root, { recursive: true, force: true });
});
