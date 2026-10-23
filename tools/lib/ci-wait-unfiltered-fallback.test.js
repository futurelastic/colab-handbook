'use strict';
/**
 * #654: #651 taught ship's reader (`ghRunsAtShaRest`) not to believe an empty FILTERED
 * `actions/runs` answer — the forge's filter index was measured empty for hours over finished green
 * runs. Two other readers of the same index were left blind: `colab ci-wait --sha` (it polled the
 * filtered path, read zero rows as pending, and timed out on a sha ship already read GREEN) and
 * `ghRunsAtCommit` (`gh run list --commit`, the by-commit second opinion and release finalize's
 * read). Both now re-read an empty answer from the bounded unfiltered listing.
 *
 * Real CLI, real repo. The fake `gh` answers every filtered query with nothing (conditional or not),
 * every unfiltered page from a file, and logs each call.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.resolve(__dirname, '..', 'colab');
const GIT_JS = path.resolve(__dirname, 'git.js');
const COMMITTED = '2026-01-01T00:00:00Z';
const NOW = '2026-01-01T00:05:00Z'; // a run created five minutes after the commit

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-wait-654-'));
  const work = path.join(root, 'work');
  const dated = { ...process.env, GIT_AUTHOR_DATE: COMMITTED, GIT_COMMITTER_DATE: COMMITTED };
  const g = (...args) => execFileSync('git', args, { cwd: work, env: dated, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g('config', 'user.email', 't@example.invalid');
  g('config', 'user.name', 't');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  fs.mkdirSync(path.join(work, '.github'));
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  const sha = g('rev-parse', 'HEAD').trim();
  const pages = path.join(root, 'pages');
  fs.mkdirSync(pages);
  const log = path.join(root, 'calls.log');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const head = "printf 'HTTP/2.0 200 OK\\r\\nEtag: \"e\"\\r\\n\\r\\n'";
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    `echo "$*" >> "${log}"`,
    'case "$*" in',
    // the filter index answers nothing — with or without If-None-Match (always a fresh 200)
    `  *"actions/runs?head_sha="*) ${head}; echo '{"total_count":0,"workflow_runs":[]}'; exit 0 ;;`,
    `  *"actions/runs?per_page=100&page="*)`,
    `    p=$(printf '%s' "$*" | sed -E 's/.*page=([0-9]+).*/\\1/'); ${head};`,
    `    if [ -f "${pages}/$p.json" ]; then cat "${pages}/$p.json"; else echo '{"total_count":0,"workflow_runs":[]}'; fi; exit 0 ;;`,
    // the by-commit read is blind to the same index
    '  "run list --commit"*) echo "[]"; exit 0 ;;',
    'esac',
    'echo "fixture gh: refusing $*" >&2; exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  const setPage = (n, rows) => fs.writeFileSync(path.join(pages, `${n}.json`), JSON.stringify({ total_count: 545, workflow_runs: rows }));
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: path.join(root, 'home') };
  return { root, work, sha, setPage, calls, env, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const run = (sha, name, conclusion, id, branch = 'main', status = 'completed') => ({
  id, head_sha: sha, head_branch: branch, status, conclusion, name, event: 'push', created_at: NOW, updated_at: NOW,
});
const unfilteredCalls = (fx) => fx.calls().filter((c) => /actions\/runs\?per_page=100&page=/.test(c));

function ciWait(fx, ...extra) {
  const r = spawnSync('node', [COLAB, 'ci-wait', '--repo', fx.work, '--sha', fx.sha, '--json', ...extra], { encoding: 'utf8', env: fx.env, timeout: 60000 });
  let body = null;
  try { body = JSON.parse(r.stdout); } catch (_) { /* asserted below */ }
  return { code: r.status, body, stdout: r.stdout, stderr: r.stderr };
}

function runsAtCommit(fx) {
  const r = spawnSync('node', ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(GIT_JS)}).ghRunsAtCommit(process.argv[1], process.argv[2])))`, fx.work, fx.sha],
    { encoding: 'utf8', env: fx.env });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('#654 ci-wait --sha: filtered empty, unfiltered holds a green run at the sha → GREEN at the first poll, fallback named', () => {
  const fx = fixture();
  fx.setPage(1, [run('a'.repeat(40), 'CI', 'failure', 9), run(fx.sha, 'CI', 'success', 7)]);
  const t = ciWait(fx, '--timeout', '10m');
  assert.strictEqual(t.body && t.body.outcome, 'GREEN', t.stdout + t.stderr);
  assert.strictEqual(t.code, 0);
  assert.strictEqual(t.body.polls, 1, 'no waiting on a sha whose CI already finished');
  assert.strictEqual(t.body.readVia, 'unfiltered-listing');
  fx.done();
});

test('#654 ci-wait --sha: the human line names the fallback', () => {
  const fx = fixture();
  fx.setPage(1, [run(fx.sha, 'CI', 'success', 7)]);
  const r = spawnSync('node', [COLAB, 'ci-wait', '--repo', fx.work, '--sha', fx.sha, '--timeout', '10m'], { encoding: 'utf8', env: fx.env });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^GREEN .*read via unfiltered listing \(forge filter index empty, #651\)/);
  fx.done();
});

test('#654 ci-wait --sha --branch: the client filter keeps the branch key', () => {
  const fx = fixture();
  fx.setPage(1, [run(fx.sha, 'CI', 'failure', 6, 'feat/other-1'), run(fx.sha, 'CI', 'success', 7, 'main')]);
  const t = ciWait(fx, '--branch', 'main', '--timeout', '10m');
  assert.strictEqual(t.body && t.body.outcome, 'GREEN', t.stdout + t.stderr);
  fx.done();
});

test('#654 ci-wait --sha: a red run found by the fallback is RED, not pending', () => {
  const fx = fixture();
  fx.setPage(1, [run(fx.sha, 'CI', 'failure', 7)]);
  const t = ciWait(fx, '--timeout', '10m');
  assert.strictEqual(t.body && t.body.outcome, 'RED', t.stdout + t.stderr);
  fx.done();
});

test('#654 ci-wait --sha: every query empty → unchanged, pending until the deadline (TIMEOUT), no note', () => {
  const fx = fixture();
  const t = ciWait(fx, '--timeout', '2s');
  assert.strictEqual(t.body && t.body.outcome, 'TIMEOUT', t.stdout + t.stderr);
  assert.ok(!('readVia' in t.body), JSON.stringify(t.body));
  assert.ok(unfilteredCalls(fx).length >= 1, 'the empty filtered answer was re-read');
  fx.done();
});

test('#654 ci-wait --sha: a non-empty filtered answer never touches the unfiltered listing', () => {
  const fx = fixture();
  // swap the stub's filtered answer for one that holds the run
  const ghPath = path.join(fx.root, 'bin', 'gh');
  const row = JSON.stringify({ total_count: 1, workflow_runs: [run(fx.sha, 'CI', 'success', 7)] });
  fs.writeFileSync(ghPath, fs.readFileSync(ghPath, 'utf8').replace(`'{"total_count":0,"workflow_runs":[]}'; exit 0 ;;\n  *"actions/runs?per_page`, `'${row}'; exit 0 ;;\n  *"actions/runs?per_page`));
  const t = ciWait(fx, '--timeout', '10m');
  assert.strictEqual(t.body && t.body.outcome, 'GREEN', t.stdout + t.stderr);
  assert.ok(!('readVia' in t.body));
  assert.deepStrictEqual(unfilteredCalls(fx), []);
  fx.done();
});

test('#654 ghRunsAtCommit: `run list --commit` empty, unfiltered listing holds runs at the sha → those rows', () => {
  const fx = fixture();
  fx.setPage(1, [run('b'.repeat(40), 'CI', 'success', 9), run(fx.sha, 'CI', 'success', 7), run(fx.sha, 'Release', 'success', 8, 'feat/any-2')]);
  const rows = runsAtCommit(fx);
  assert.deepStrictEqual(rows.map((r) => r.databaseId).sort(), [7, 8], 'any ref — the by-commit read never had a branch key');
  for (const r of rows) {
    assert.strictEqual(r.headSha, fx.sha);
    assert.strictEqual(r.readVia, 'unfiltered-listing');
    for (const k of ['status', 'conclusion', 'createdAt', 'updatedAt', 'workflowName', 'event']) assert.ok(k in r, `row carries ${k}`);
  }
  fx.done();
});

test('#654 ghRunsAtCommit: every query empty → still the empty set (not null)', () => {
  const fx = fixture();
  assert.deepStrictEqual(runsAtCommit(fx), []);
  assert.ok(unfilteredCalls(fx).length >= 1);
  fx.done();
});
