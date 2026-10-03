'use strict';
/**
 * #457 — `colab migration-grant --role migration-reviewer` refuses a `ci-roundtrip: pass` that CI
 * does not back, BEFORE anything is written.
 *
 * End to end through the CLI with a `gh` stub that answers the tracker read (an OPEN issue, the
 * grant label existing), `run list` / `run view` from fixture JSON, and LOGS every `issue edit` /
 * `issue comment` it is asked to perform. The refusal cases assert the log stays empty — "refused
 * before writing" measured, not inferred. The pure rule is pinned in migration-grant-ship.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const COLAB = path.join(__dirname, '..', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nmigration-grant: reviewer\n';
const BRANCH = 'feat/x-1';
const ran = [{ name: 'Run migrations', status: 'completed', conclusion: 'success' }];
const job = (name, over = {}) => ({ name, status: 'completed', conclusion: 'success', steps: ran, ...over });

/** A clone with a bare origin, a pushed migration branch, and a gh stub. `runs` = [{ id, jobs }],
 *  placed at the branch head. Returns the fixture plus the head sha and the write log path. */
function fixture(runs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-migration-grant-mint-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab migration-grant mint test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'checkout', '-q', '-b', BRANCH);
  fs.mkdirSync(path.join(work, 'database', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(work, 'database', 'migrations', '2026_01_01_x.php'), 'x\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: add a migration');
  g(work, 'checkout', '-q', 'main');
  g(work, 'push', '-q', 'origin', BRANCH);
  const head = g(work, 'rev-parse', BRANCH).trim();

  const data = path.join(root, 'gh-data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'runs.json'), JSON.stringify(runs.map((r) => ({
    headSha: head, status: 'completed', conclusion: 'success', createdAt: '2026-10-01T00:00:00Z',
    databaseId: r.id, workflowName: 'CI', event: 'push',
  }))));
  for (const r of runs) fs.writeFileSync(path.join(data, `run-${r.id}.json`), JSON.stringify({ jobs: r.jobs }));
  const log = path.join(root, 'writes.log');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `D='${data}'; L='${log}'`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then echo \'{"state":"OPEN","labels":[]}\'; exit 0; fi',
    'if [ "$1" = "label" ] && [ "$2" = "list" ]; then echo migration-granted; echo in-progress; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "$D/runs.json"; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "view" ]; then f="$D/run-$3.json"; [ -f "$f" ] && { cat "$f"; exit 0; }; exit 1; fi',
    'if [ "$1" = "issue" ] && { [ "$2" = "edit" ] || [ "$2" = "comment" ]; }; then echo "$*" >> "$L"; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { work, home, bin, head, log };
}

function grant(fx, extra) {
  const args = ['migration-grant', '1', '--branch', BRANCH, '--role', 'migration-reviewer', '--reviewer', 'bot-a',
    '--verdict', 'approve', '--checklist', 'pass', '--escalation', 'data-loss-rule', '--escalation-result', 'clear',
    '--ci-roundtrip', 'pass', '--head', fx.head, ...extra, '--repo', fx.work];
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_HUMAN: '1',
      COLAB_SESSION: 'sess-migration-grant-mint-test', COLAB_SESSION_NAME: '' },
  });
  const writes = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8') : '';
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', writes };
}

test('the observed case: ci-roundtrip pass citing a run with no round-trip job → refused, nothing written', () => {
  const fx = fixture([{ id: 501, jobs: [job('Gitleaks'), job('Build')] }]);
  const r = grant(fx, ['--checklist-items', '10/10', '--ci-run', '501']);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /ci-roundtrip: pass, but no "Migration round-trip" job ran at/);
  assert.match(r.err, /nothing was posted/);
  assert.equal(r.writes, '', 'no label applied, no comment posted');
});

test('a cited run that is not at the head → refused, nothing written', () => {
  const fx = fixture([{ id: 501, jobs: [job('Migration round-trip (mysql)')] }]);
  const r = grant(fx, ['--ci-run', '999']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /ci-run 999 is not a run at/);
  assert.equal(r.writes, '');
});

test('the old 4/4 denominator → refused locally, before CI or the tracker is read', () => {
  const fx = fixture([{ id: 501, jobs: [job('Migration round-trip (mysql)')] }]);
  const r = grant(fx, ['--checklist-items', '4/4']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /checklist has 10 items/);
  assert.equal(r.writes, '');
});

test('a round-trip job that passed at the head, cited by URL → recorded (label, then comment)', () => {
  const fx = fixture([{ id: 501, jobs: [job('Gitleaks'), job('Migration round-trip (mysql)'), job('Migration round-trip (sqlite)')] }]);
  const r = grant(fx, ['--checklist-items', '10/10', '--ci-run', 'https://github.com/o/r/actions/runs/501']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Recorded a migration-reviewer grant on #1/);
  const ops = r.writes.split('\n').filter((l) => /^issue (edit|comment) 1 /.test(l)).map((l) => l.split(' ')[1]);
  assert.deepEqual(ops, ['edit', 'comment'], r.writes);
  assert.match(r.writes, /ci-roundtrip: pass/);
});
