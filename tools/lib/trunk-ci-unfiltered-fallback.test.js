'use strict';
/**
 * #651: the forge's filter index was measured empty. `actions/runs?head_sha=` and `?branch=` both
 * answered `total_count: 0` hours after the runs finished, while the unfiltered listing held them
 * (green). Read alone, that turned a green trunk into "NONE — CI is not wired". The reader now
 * re-reads an empty filtered answer from the unfiltered listing, filters it locally, and names the
 * fallback. An empty listing still reads NONE: the read keeps failing closed.
 *
 * Real CLI, real repo, real bare `origin`. The fake `gh` answers every filtered `actions/runs`
 * query with nothing and every unfiltered page from a file, then logs each call.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.resolve(__dirname, '..', 'colab');
const COMMITTED = '2026-01-01T00:00:00Z';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-trunk-ci-651-'));
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  // dated in the past: outside #413's empty-read grace, so an empty read classes NONE, not PENDING
  const dated = { ...process.env, GIT_AUTHOR_DATE: COMMITTED, GIT_COMMITTER_DATE: COMMITTED };
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, env: dated, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
    // the filter index answers nothing — the measured #651 shape
    `  "api -i repos/{owner}/{repo}/actions/runs?head_sha="*) ${head}; echo '{"total_count":0,"workflow_runs":[]}'; exit 0 ;;`,
    `  "api -i repos/{owner}/{repo}/actions/runs?per_page=100&page="*)`,
    `    p=$(printf '%s' "$*" | sed -E 's/.*page=([0-9]+).*/\\1/'); ${head};`,
    `    if [ -f "${pages}/$p.json" ]; then cat "${pages}/$p.json"; else echo '{"total_count":0,"workflow_runs":[]}'; fi; exit 0 ;;`,
    '  "api repos/{owner}/{repo}/commits/"*) echo "[]"; exit 0 ;;',
    // the by-commit second opinion (#413) is blind to the same index
    '  "run list --commit"*) echo "[]"; exit 0 ;;',
    'esac',
    'echo "fixture gh: refusing $*" >&2; exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  const setPage = (n, rows) => fs.writeFileSync(path.join(pages, `${n}.json`), JSON.stringify({ total_count: 545, workflow_runs: rows }));
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  const env = (extra = {}) => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: path.join(root, 'home'), COLAB_TRUNK_CI_TTL: '0', ...extra });
  return { root, work, sha, setPage, calls, env };
}

const NOW = '2026-01-01T00:05:00Z'; // a run created five minutes after the commit
const OLD = '2020-01-01T00:00:00Z';
const run = (sha, name, conclusion, id, branch = 'main', created = NOW) => ({
  id, head_sha: sha, head_branch: branch, status: 'completed', conclusion, name, event: 'push', created_at: created,
});
const filler = (n, created) => Array.from({ length: n }, (_, i) => run('f'.repeat(40), 'CI', 'success', 1000 + i, 'main', created));
const unfilteredCalls = (fx) => fx.calls().filter((c) => /actions\/runs\?per_page=100&page=/.test(c));

function trunkCi(fx) {
  const r = spawnSync('node', [COLAB, 'trunk-ci', '--repo', fx.work, '--json', '--fresh'], { encoding: 'utf8', env: fx.env() });
  return { code: r.status, body: JSON.parse(r.stdout), stderr: r.stderr };
}

test('#651 filtered queries empty, unfiltered listing holds a green push run at the sha → GREEN, fallback named', () => {
  const fx = fixture();
  fx.setPage(1, [run('a'.repeat(40), 'CI', 'failure', 9), run(fx.sha, 'CI', 'success', 7), run(fx.sha, 'Surface', 'success', 8)]);
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'GREEN', JSON.stringify(t.body));
  assert.match(JSON.stringify(t.body), /read via unfiltered listing \(forge filter index empty, #651\)/);
  assert.match(JSON.stringify(t.body), /2 runs at main@/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('#651 the fallback is judged as usual — a red run found there still reads RED', () => {
  const fx = fixture();
  fx.setPage(1, [run(fx.sha, 'CI', 'failure', 7)]);
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'RED', JSON.stringify(t.body));
  assert.match(JSON.stringify(t.body), /read via unfiltered listing/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('#651 every query empty → still NONE (fails closed), and the note is absent', () => {
  const fx = fixture();
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'NONE', JSON.stringify(t.body));
  assert.doesNotMatch(JSON.stringify(t.body), /unfiltered listing/);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('#651 a run at the sha on ANOTHER branch is not trunk\'s run — the client filter keeps the branch key', () => {
  const fx = fixture();
  fx.setPage(1, [run(fx.sha, 'CI', 'success', 7, 'feat/x-1')]);
  const t = trunkCi(fx);
  // The branch-keyed read drops it. #654: the by-commit second opinion (#413) has no branch key by
  // design, and now reads through the same fallback — so it finds the run, exactly as `gh run list
  // --commit` does on a healthy index. The verdict names both routes.
  assert.match(t.body.detail, /\(by commit — the branch-filtered read was empty\)/, JSON.stringify(t.body));
  assert.strictEqual(t.body.verdict, 'GREEN', JSON.stringify(t.body));
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('#651 bounded: a full page reaching back past the commit stops the re-read at one page', () => {
  const fx = fixture();
  fx.setPage(1, filler(100, OLD));
  fx.setPage(2, [run(fx.sha, 'CI', 'success', 7)]);
  trunkCi(fx);
  const reads = unfilteredCalls(fx);
  assert.ok(reads.length >= 1, fx.calls().join('\n'));
  assert.ok(reads.every((c) => /page=1\b/.test(c)), `only page 1 is read: ${reads.join('\n')}`);
  fs.rmSync(fx.root, { recursive: true, force: true });
});

test('#651 bounded: full pages of newer runs are followed, never past the page cap', () => {
  const fx = fixture();
  for (let p = 1; p <= 5; p++) fx.setPage(p, filler(100, NOW));
  fx.setPage(2, [...filler(99, NOW), run(fx.sha, 'CI', 'success', 7)]);
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'GREEN', JSON.stringify(t.body));
  const pagesRead = new Set(unfilteredCalls(fx).map((c) => c.replace(/.*page=(\d+).*/, '$1')));
  assert.ok(!pagesRead.has('4') && !pagesRead.has('5'), `capped at 3 pages: ${[...pagesRead]}`);
  fs.rmSync(fx.root, { recursive: true, force: true });
});
