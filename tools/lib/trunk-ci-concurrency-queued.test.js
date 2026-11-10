'use strict';
/**
 * #705: a trunk run `pending` with zero jobs while an OLDER run of the same workflow on trunk is
 * `in_progress` is waiting for its concurrency group — PENDING, naming the run it waits on — not
 * WEDGED. Read through the production caller, `classifyCiRunRaw` in tools/colab, by both readers:
 * `colab trunk-ci` and `colab ship`'s `trunk CI green` row.
 *
 * Real CLI, real repo, real bare `origin`, fake `gh` — the same fixture shape as
 * trunk-ci-unconcluded.test.js. The fake refuses `gh api`, so every read takes its `gh run list`
 * fallback: the at-sha read answers the pending run, the `--status in_progress` read (git.js
 * ghActiveRunsOfWorkflow) answers the active-runs file.
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
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

function fixture({ pendingAgeMin = 15 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-trunk-ci-705-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const when = ago(60);
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
  const activeFile = path.join(root, 'active.json');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then case " $* " in *" --status in_progress "*) cat "${activeFile}"; exit $?;; esac; cat "${rowsFile}"; exit 0; fi`,
    'if [ "$1" = "run" ] && [ "$2" = "view" ] && [ "$3" = "200" ]; then echo \'{"jobs":[]}\'; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  const runEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, COLAB_HOME: home, COLAB_SESSION: 'sess-705', COLAB_SESSION_NAME: '', COLAB_TRUNK_CI_TTL: '0' };
  // The trunk run at the head: pending, zero jobs, past the 2m zero-jobs floor, inside the 6h backstop.
  fs.writeFileSync(rowsFile, JSON.stringify([{ headSha: sha, status: 'pending', conclusion: '', createdAt: ago(pendingAgeMin),
    databaseId: 200, workflowName: 'CI', workflowDatabaseId: 9, event: 'push', headBranch: 'main' }]));
  return {
    work, sha, runEnv,
    // The previous trunk run of the same workflow, on an older sha, still in progress.
    setActive: (rows) => fs.writeFileSync(activeFile, JSON.stringify(rows)),
  };
}

const HOLDER = { databaseId: 199, status: 'in_progress', createdAt: ago(20), headSha: 'b'.repeat(40), headBranch: 'main', workflowDatabaseId: 9 };

function trunkCi(fx) {
  const r = spawnSync('node', [COLAB, 'trunk-ci', '--repo', fx.work, '--json'], { encoding: 'utf8', env: fx.runEnv });
  return { code: r.status, body: JSON.parse(r.stdout) };
}
function shipRow(fx) {
  const r = spawnSync('node', [COLAB, 'ship', '--branch', 'feat/x-1', '--repo', fx.work, '--dry', '--json'], { encoding: 'utf8', env: fx.runEnv });
  return JSON.parse(r.stdout).checks.find((c) => c.name === 'trunk CI green');
}

test('#705 pending, zero jobs, an older run of the same workflow on trunk in progress → PENDING queued behind it, not WEDGED', () => {
  const fx = fixture();
  fx.setActive([HOLDER]);
  const t = trunkCi(fx);
  assert.strictEqual(t.code, 0);
  assert.strictEqual(t.body.verdict, 'PENDING', JSON.stringify(t.body));
  assert.strictEqual(t.body.wedge, undefined);
  assert.match(t.body.detail, /queued behind run 199 \(bbbbbbb\) of the same workflow on main \(concurrency\), retry later/);
  assert.doesNotMatch(t.body.detail, /a human must look/);
  const s = shipRow(fx);
  assert.strictEqual(s.ok, false, JSON.stringify(s));
  assert.ok(s.detail.startsWith(t.body.detail), `ship and trunk-ci must not drift: ${JSON.stringify(s.detail)}`);
});

test('#705 the same run with nothing in progress ahead of it is still WEDGED (zero-jobs) — no runner ever picked it up', () => {
  const fx = fixture();
  fx.setActive([]);
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'WEDGED', JSON.stringify(t.body));
  assert.strictEqual(t.body.wedge, 'zero-jobs');
  assert.match(t.body.detail, /a human must look, not retry/);
});

test('#705 the active-runs read fails → the verdict it had stands (WEDGED), never a guess toward waiting', () => {
  const fx = fixture(); // no active file written: the fake gh's `cat` fails → the read is null
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'WEDGED', JSON.stringify(t.body));
  assert.strictEqual(t.body.wedge, 'zero-jobs');
});

test('#705 the wait is bounded: queued past the 6h age backstop → WEDGED (age), naming the run it waited on', () => {
  const fx = fixture({ pendingAgeMin: 7 * 60 });
  fx.setActive([{ ...HOLDER, createdAt: ago(8 * 60) }]);
  const t = trunkCi(fx);
  assert.strictEqual(t.body.verdict, 'WEDGED', JSON.stringify(t.body));
  assert.strictEqual(t.body.wedge, 'age');
  assert.match(t.body.detail, /queued behind run 199/);
});
