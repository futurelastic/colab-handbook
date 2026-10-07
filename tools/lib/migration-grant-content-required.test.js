'use strict';
/**
 * #563 — a reviewer grant for a branch that carries migrations always records their content id
 * (`migrations:`, #508), or it is refused at write time. Never posted silently HEAD-bound: such a
 * grant is voided by the trunk sync `colab ship` itself demands, costing a full re-review round.
 *
 * End to end through the CLI, on a repo whose `migrations:` is an explicit directory list (the
 * measured shape: per-module `modules/<m>/sql/` dirs, none of the default layouts). The `gh` stub
 * LOGS every write, so "refused before writing" is measured, not inferred.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const migrationGrant = require('./migration-grant');

const COLAB = path.join(__dirname, '..', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: go\nmigration-grant: reviewer\n' +
  'migrations:\n  - modules/billing/sql/\n  - modules/board/sql/\n';
const BRANCH = 'feat/x-1';
const MIG = 'modules/board/sql/20261007000005_x.sql';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-migration-grant-content-required-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab migration-grant content-required test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.mkdirSync(path.join(work, 'modules', 'billing', 'sql'), { recursive: true });
  fs.writeFileSync(path.join(work, 'modules', 'billing', 'sql', '20260101000001_base.sql'), 'create table a (id int);\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'checkout', '-q', '-b', BRANCH);
  fs.mkdirSync(path.join(work, path.dirname(MIG)), { recursive: true });
  fs.writeFileSync(path.join(work, MIG), 'create table b (id int);\n');
  fs.writeFileSync(path.join(work, 'modules', 'board', 'api.go'), 'package board\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: add a migration');
  g(work, 'checkout', '-q', 'main');
  g(work, 'push', '-q', 'origin', BRANCH);
  const head = g(work, 'rev-parse', BRANCH).trim();
  const blob = g(work, 'rev-parse', `${BRANCH}:${MIG}`).trim();

  // CI at the head: one run carrying a passing round-trip job, so ci-roundtrip: pass is backed (#457).
  const data = path.join(root, 'gh-data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'runs.json'), JSON.stringify([{ headSha: head, status: 'completed', conclusion: 'success',
    createdAt: '2026-10-01T00:00:00Z', databaseId: 501, workflowName: 'CI', event: 'push' }]));
  fs.writeFileSync(path.join(data, 'run-501.json'), JSON.stringify({ jobs: [{ name: 'Migration round-trip (mysql)',
    status: 'completed', conclusion: 'success', steps: [{ name: 'Run migrations', status: 'completed', conclusion: 'success' }] }] }));
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
    'if [ "$1" = "issue" ] && { [ "$2" = "edit" ] || [ "$2" = "comment" ]; }; then printf "%s\\n" "$*" >> "$L"; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, home, bin, head, blob, log, g };
}

/** A `git` shim in front of the real one that fails one subcommand — the "tree unreadable" case. */
function failingGit(fx, sub) {
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const dir = path.join(fx.root, `bin-fail-${sub}`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'git'), [
    '#!/bin/sh',
    `for a in "$@"; do [ "$a" = "${sub}" ] && { echo "fixture git: ${sub} fails" >&2; exit 128; }; done`,
    `exec '${real}' "$@"`,
  ].join('\n') + '\n', { mode: 0o755 });
  return dir;
}

function grant(fx, { pathPrefix = [] } = {}) {
  const args = ['migration-grant', '1', '--branch', BRANCH, '--role', 'migration-reviewer', '--reviewer', 'bot-a',
    '--verdict', 'approve', '--checklist', 'pass', '--checklist-items', '10/10', '--escalation', 'data-loss-rule',
    '--escalation-result', 'clear', '--ci-roundtrip', 'pass', '--ci-run', '501', '--head', fx.head, '--repo', fx.work];
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: [...pathPrefix, fx.bin, process.env.PATH].join(':'), COLAB_HOME: fx.home, COLAB_HUMAN: '1',
      COLAB_SESSION: 'sess-migration-grant-content-required-test', COLAB_SESSION_NAME: '' },
  });
  const writes = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8') : '';
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', writes };
}

test('explicit migrations: directory list → the posted record carries migrations: <content id>', () => {
  const fx = fixture();
  const r = grant(fx);
  assert.equal(r.code, 0, r.out + r.err);
  const want = migrationGrant.migrationContentId([{ path: MIG, blob: fx.blob }]);
  assert.match(r.writes, new RegExp(`^migrations: ${want}$`, 'm'), r.writes);
  assert.match(r.out, /Bound to the reviewed migration content/);
});

test('the branch diff cannot be computed (no trunk ref here) → refused, names why, nothing posted', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '--detach');
  fx.g(fx.work, 'branch', '-q', '-D', 'main');
  fx.g(fx.work, 'update-ref', '-d', 'refs/remotes/origin/main');
  const r = grant(fx);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /cannot list "feat\/x-1"'s files against main/);
  assert.match(r.err, /nothing was posted/);
  assert.equal(r.writes, '', 'no label applied, no comment posted');
});

test('migrations present but their tree is unreadable at the tip → refused, names the files, nothing posted', () => {
  const fx = fixture();
  const r = grant(fx, { pathPrefix: [failingGit(fx, 'ls-tree')] });
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /carries 1 migration file\(s\) \(modules\/board\/sql\/20261007000005_x\.sql\) but their content id could not be computed/);
  assert.match(r.err, /nothing was posted/);
  assert.equal(r.writes, '');
});
