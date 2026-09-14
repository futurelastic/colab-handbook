'use strict';
/**
 * End-to-end tests for #345 — the docs-only exception to `colab ship`'s autonomy gate, on a repo
 * that does NOT declare `autonomy: auto-trunk`. One test per acceptance case on the issue, plus the
 * `--dry` / `--dry --json` reports and the trunk-direct door (#342 ruling A: the exception applies
 * to `cmdShipDirect` too).
 *
 * Real CLI, real repo, real bare `origin`; `gh` is the logging stub from ship-close-paths.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const SESSION = 'https://claude.ai/code/session_docs_only_S';
const NO_AUTONOMY = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

const TMP = [];
process.on('exit', () => { for (const dir of TMP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } });

function fixture(yml = NO_AUTONOMY) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-docs-only-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'docs-only test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(work, 'f.js'), 'base\n');
  g(work, 'add', '-A');
  // Backdated, so a trunk-direct unit's --since window (whole seconds) never includes this commit.
  execFileSync('git', ['commit', '-q', '-m', 'chore: fixture'], {
    cwd: work, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' },
  });
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$*" >> "${ghLog}"`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    `  SHA=$(cd "${work}" && git rev-parse "refs/heads/$BR" 2>/dev/null)`,
    `  if [ -z "$SHA" ]; then SHA=$(cd "${work}" && git rev-parse HEAD); fi`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\"}]"',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    '  echo \'{"state":"OPEN","labels":[],"comments":[{"body":"fixture: delivered by hand"}]}\'; exit 0',
    'fi',
    'if [ "$1" = "issue" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, home, bin, ghLog, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** A branch off main carrying `files` (path → content), claimed as issue `num`, main checked out. */
function branch(fx, name, num, files) {
  fx.g(fx.work, 'checkout', '-q', '-b', name);
  for (const [p, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(fx.work, p)), { recursive: true });
    fs.writeFileSync(path.join(fx.work, p), body);
  }
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '--allow-empty', '-m', `docs: change (#${num})`);
  fx.g(fx.work, 'checkout', '-q', 'main');
  assert.strictEqual(colab(fx, ['claim', String(num), '--branch', name, '--repo', fx.work]).code, 0);
}

const log = (fx) => (fs.existsSync(fx.ghLog) ? fs.readFileSync(fx.ghLog, 'utf8') : '');
const mainLog = (fx) => fx.g(fx.work, 'log', '--format=%s', 'main');

// ---- acceptance 2: the six cases -------------------------------------------------------------

test('#345: a docs-only branch on a non-auto-trunk repo ships', () => {
  const fx = fixture();
  branch(fx, 'docs/readme-81', 81, { 'README.md': 'hello\n', 'docs/guide.txt': 'g\n' });
  const r = colab(fx, ['ship', '--branch', 'docs/readme-81', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /autonomy granted\s+docs-only \(2 files\) — autonomy exception/);
  assert.match(mainLog(fx), /Closes #81|\(#81\)/);
  assert.strictEqual(fx.g(fx.work, 'show', 'main:README.md'), 'hello');
});

test('#345: a branch with one .js file refuses with the existing message', () => {
  const fx = fixture();
  branch(fx, 'docs/mixed-82', 82, { 'x.js': 'x\n' });
  const r = colab(fx, ['ship', '--branch', 'docs/mixed-82', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /does not grant auto-trunk \(project\.yml autonomy: absent\)/);
  assert.match(r.err, /A human must trigger Phase B/);
  assert.match(r.err, /x\.js/);
  assert.doesNotMatch(mainLog(fx), /#82/);
});

test('#345: a branch touching only CLAUDE.md refuses', () => {
  const fx = fixture();
  branch(fx, 'docs/claude-83', 83, { 'CLAUDE.md': 'rules\n' });
  const r = colab(fx, ['ship', '--branch', 'docs/claude-83', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /does not grant auto-trunk/);
  assert.match(r.err, /CLAUDE\.md is agent rules/);
});

test('#345: a branch touching .github/workflows/x.yml refuses', () => {
  const fx = fixture();
  branch(fx, 'docs/wf-84', 84, { '.github/workflows/x.yml': 'on: push\n' });
  const r = colab(fx, ['ship', '--branch', 'docs/wf-84', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /under \.github\/ \(config\)/);
});

test('#345: an empty diff refuses', () => {
  const fx = fixture();
  branch(fx, 'docs/empty-85', 85, {});
  const r = colab(fx, ['ship', '--branch', 'docs/empty-85', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /does not grant auto-trunk/);
  assert.match(r.err, /empty diff/);
  assert.doesNotMatch(log(fx), /issue close/);
});

test('#345: a mixed docs/ + code branch refuses', () => {
  const fx = fixture();
  branch(fx, 'docs/mixed-86', 86, { 'docs/a.md': 'a\n', 'src/b.js': 'b\n' });
  const r = colab(fx, ['ship', '--branch', 'docs/mixed-86', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /1 of 2 file\(s\) not documentation: src\/b\.js/);
});

// ---- acceptance 3: --dry names the exception, and --dry --json says which branch applied -----

test('#345: ship --dry on a docs-only branch reports the exception by name and changes nothing', () => {
  const fx = fixture();
  branch(fx, 'docs/dry-87', 87, { 'README.md': 'dry\n' });
  const r = colab(fx, ['ship', '--branch', 'docs/dry-87', '--repo', fx.work, '--dry']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /docs-only \(1 files\) — autonomy exception/);
  assert.doesNotMatch(mainLog(fx), /#87/);
});

test('#345: --dry --json reports via docs-only on the exception, via auto-trunk on the grant', () => {
  const fx = fixture();
  branch(fx, 'docs/json-88', 88, { 'docs/x.md': 'x\n' });
  const j = JSON.parse(colab(fx, ['ship', '--branch', 'docs/json-88', '--repo', fx.work, '--dry', '--json']).out);
  assert.strictEqual(j.autonomyGate.via, 'docs-only');
  assert.strictEqual(j.autonomyGate.docsOnly.files, 1);
  const row = j.checks.find((c) => c.name === 'autonomy granted');
  assert.strictEqual(row.ok, true);
  assert.strictEqual(row.detail, 'docs-only (1 files) — autonomy exception');

  const fx2 = fixture(`${NO_AUTONOMY}autonomy: auto-trunk\n`);
  branch(fx2, 'feat/code-89', 89, { 'x.js': 'x\n' });
  const j2 = JSON.parse(colab(fx2, ['ship', '--branch', 'feat/code-89', '--repo', fx2.work, '--dry', '--json']).out);
  assert.deepStrictEqual(j2.autonomyGate, { via: 'auto-trunk', docsOnly: null });
});

test('#345: --dry --json on a code branch without the grant reports via null and why', () => {
  const fx = fixture();
  branch(fx, 'feat/code-90', 90, { 'x.js': 'x\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/code-90', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.autonomyGate.via, null);
  assert.strictEqual(j.autonomyGate.docsOnly.docsOnly, false);
  const row = j.checks.find((c) => c.name === 'autonomy granted');
  assert.strictEqual(row.class, 'human-gated');
  assert.match(row.detail, /a human must trigger Phase B \(not docs-only: /);
});

// ---- #342 ruling A: the exception applies to the trunk-direct door too ------------------------

function directUnit(fx, num, file) {
  assert.strictEqual(colab(fx, ['claim', String(num), '--repo', fx.work]).code, 0);
  fs.writeFileSync(path.join(fx.work, file), 'direct\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `docs: direct unit (#${num})`);
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
}

test('#345/#342: ship --direct closes a docs-only trunk-direct unit without auto-trunk', () => {
  const fx = fixture();
  directUnit(fx, 91, 'NOTES.md');
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /AUTONOMY: docs-only \(1 files\) — autonomy exception \(#345\)/);
  assert.match(log(fx), /issue close 91/);
});

test('#345/#342: ship --direct refuses a code trunk-direct unit without auto-trunk, naming the file', () => {
  const fx = fixture();
  directUnit(fx, 92, 'x.js');
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /does not grant auto-trunk/);
  assert.match(r.err, /x\.js/);
  assert.doesNotMatch(log(fx), /issue close/);
});
