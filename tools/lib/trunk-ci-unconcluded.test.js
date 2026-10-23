'use strict';
/**
 * #650: a trunk run whose jobs ALL completed but that the forge never concluded (run and check suite
 * stay in_progress) — read through the production caller, `classifyCiRunRaw` in tools/colab, by both
 * readers: `colab trunk-ci` and `colab ship`'s `trunk CI green` row.
 *
 * Real CLI, real repo, real bare `origin`, fake `gh` answering `run list` and `run view --json jobs`
 * from two files — the same fixture shape as trunk-ci-verb.test.js. The jobs body copies what
 * `gh run view --json jobs` prints (the fields tools/lib/git.js ghRunJobs maps).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.join(path.resolve(__dirname, '..', '..'), 'tools', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-trunk-ci-650-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const when = new Date(Date.now() - 60 * 60000).toISOString();
  const env = { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when };
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab trunk-ci test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const sha = g(work, 'rev-parse', 'HEAD').trim();
  g(work, 'checkout', '-q', '-b', 'feat/x-1');
  fs.writeFileSync(path.join(work, 'g.txt'), 'x\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: x');
  g(work, 'checkout', '-q', 'main');

  const rowsFile = path.join(root, 'rows.json');
  const jobsFile = path.join(root, 'jobs.json');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "${rowsFile}"; exit 0; fi`,
    `if [ "$1" = "run" ] && [ "$2" = "view" ] && [ "$3" = "77" ]; then cat "${jobsFile}"; exit 0; fi`,
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const runEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: home, COLAB_SESSION: 'sess-650', COLAB_SESSION_NAME: '', COLAB_TRUNK_CI_TTL: '0' };
  // The push run: in_progress, created 45 minutes ago — well inside the 6h age backstop.
  fs.writeFileSync(rowsFile, JSON.stringify([{ headSha: sha, status: 'in_progress', conclusion: '',
    createdAt: new Date(Date.now() - 45 * 60000).toISOString(), databaseId: 77, workflowName: 'CI', event: 'push' }]));
  return { work, sha, runEnv, setJobs: (jobs) => fs.writeFileSync(jobsFile, JSON.stringify({ jobs })) };
}

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const job = (name, status, conclusion, startedAt, completedAt) =>
  ({ completedAt, conclusion, databaseId: name.length, name, startedAt, status, steps: [], url: `https://example.invalid/job/${name}` });
// The measured shape: gate success, two suites skipped by it (check runs written late, so startedAt
// is later than completedAt), duration success — all `completed`, 30+ minutes ago.
const STUCK = [
  job('gate', 'completed', 'success', ago(44), ago(43)),
  job('suite (a)', 'completed', 'skipped', ago(37), ago(37.5)),
  job('suite (b)', 'completed', 'skipped', ago(37), ago(37.5)),
  job('duration', 'completed', 'success', ago(43), ago(42)),
];

function trunkCi(fx) {
  const r = spawnSync('node', [COLAB, 'trunk-ci', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.runEnv });
  return { code: r.status, body: JSON.parse(r.stdout) };
}
function shipRow(fx) {
  const r = spawnSync('node', [COLAB, 'ship', '--branch', 'feat/x-1', '--repo', fx.work, '--dry', '--json'], { encoding: 'utf8', env: fx.runEnv });
  return JSON.parse(r.stdout).checks.find((c) => c.name === 'trunk CI green');
}

test('#650 every job completed, the run never concluded → WEDGED (unconcluded), and the detail names the exits that work', () => {
  const fx = fixture();
  fx.setJobs(STUCK);
  const t = trunkCi(fx);
  assert.strictEqual(t.code, 0);
  assert.strictEqual(t.body.verdict, 'WEDGED', JSON.stringify(t.body));
  assert.strictEqual(t.body.wedge, 'unconcluded', JSON.stringify(t.body));
  assert.strictEqual(t.body.ok, false, 'never green — the forge has not said the run passed');
  assert.match(t.body.detail, /every job completed \(2 skipped, 2 success\)/);
  assert.match(t.body.detail, /colab ci-grant <issue> --branch <branch>/);
  assert.match(t.body.detail, /409 "not in progress"/);
  assert.doesNotMatch(t.body.detail, /a human must look, not retry/);
  const s = shipRow(fx);
  assert.strictEqual(s.ok, false, JSON.stringify(s));
  assert.ok(s.detail.startsWith(t.body.detail), `ship and trunk-ci must not drift: ${JSON.stringify(s.detail)}`);
});

test('#650 a job still running is not this shape — the run reads PENDING (still running, retry later)', () => {
  const fx = fixture();
  fx.setJobs(STUCK.map((j, i) => (i === 3 ? { ...j, status: 'in_progress', conclusion: '', completedAt: null } : j)));
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'PENDING', JSON.stringify(t.body));
  assert.strictEqual(t.body.wedge, undefined);
});

test('#650 the jobs could not be read → no positive from a missing signal: PENDING inside the age backstop', () => {
  const fx = fixture(); // no jobs file written: the fake gh's `cat` fails → ghRunJobs reads null
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'PENDING', JSON.stringify(t.body));
});
