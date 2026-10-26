'use strict';
/**
 * #619 — a failed B1 squash commit must report the line that names the cause, not stderr's first
 * line. Measured: a repo's pre-commit hook (gitleaks) prints an ASCII banner to stderr before its
 * verdict, and `colab ship` reported `commit failed (○)` — the banner's first glyph — while the
 * real reason was discarded; an identical retry passed, so it could never be recovered.
 *
 * End to end on purpose: the message is written by cmdShip's serial B1 path, which only a REAL
 * ship reaches (every precondition has to pass first). Fixture/gh-stub shape ported from
 * ship-post-ship-hook.test.js. The fixture neutralises core.hooksPath (#108) and a test then
 * repoints it at a directory holding the failing hook, after the fixture's own commits.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML_AUTO_TRUNK = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

/**
 * A clone with a real bare `origin`, a `main` trunk, private COLAB_HOME, and a `gh` stub generous
 * enough to let a REAL `colab ship` complete end to end. Ported from ship-plan-journal.test.js —
 * including `core.hooksPath` pointed at a nonexistent dir (#108: a fixture that inherits the
 * machine's global hooks is the exact copy-paste gap fixture-hooks-lint.test.js exists to catch).
 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-commit-fail-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'ship commit-failure test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML_AUTO_TRUNK);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
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
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then ' +
      'echo \'{"state":"OPEN","labels":[],"comments":[{"body":"fixture: delivered by hand"}]}\'; exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "comment" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "close" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    // HOME override: keeps anything resolved off os.homedir() inside the fixture (the plan journal
    // itself follows COLAB_HOME since #663).
    // A stable non-blank COLAB_SESSION (#237): claim and ship run against the same trunk checkout,
    // and two blank sessions do not count as the same place-claim holder.
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: 'sess-commit-fail-test', COLAB_SESSION_NAME: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}


/** A branch with one ordinary change, left unmerged — the shape a session's branch has at ship. */
function branchWithWork(fx, branch) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, 'f.txt'), 'changed\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: branch work');
  fx.g(fx.work, 'checkout', '-q', 'main');
}

/** Point the clone's hooks at a dir holding `pre-commit` = `body` — AFTER the fixture's commits. */
function failingPreCommit(fx, body) {
  const dir = path.join(fx.root, 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pre-commit'), body, { mode: 0o755 });
  fx.g(fx.work, 'config', 'core.hooksPath', dir);
}

test('#619: a hook that prints a banner and then fails — the refusal names the failing line, not the banner', () => {
  const fx = fixture();
  branchWithWork(fx, 'fix/banner-hook-70');
  colab(fx, ['claim', '70', '--branch', 'fix/banner-hook-70', '--repo', fx.work]);
  const before = fx.g(fx.origin, 'rev-parse', 'main').trim();
  // gitleaks' shape: the banner on stderr first, findings in the middle, the verdict last. Half of
  // it on stdout on purpose — git sends a hook's stdout to stderr too, so both halves must count.
  failingPreCommit(fx, [
    '#!/bin/sh',
    'echo "    ○" >&2',
    'echo "    │╲" >&2',
    'echo "    ○ ░" >&2',
    'echo "Finding: fixture-secret-pattern"',
    'echo "fixture-hook: leaks found: 1" >&2',
    'exit 1',
  ].join('\n') + '\n');

  const r = colab(fx, ['ship', '--branch', 'fix/banner-hook-70', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /✗ B1: commit failed \(fixture-hook: leaks found: 1\)\. main reset, nothing pushed\./, r.err);
  assert.doesNotMatch(r.err, /commit failed \(\s*○\s*\)/, 'the banner must not be the reported cause');
  // The full hook output follows the summary, so a cause no single line names still survives.
  assert.match(r.err, /git output:\n(?:.*\n)*\s+Finding: fixture-secret-pattern\n/, r.err);
  assert.match(r.err, /re-run `colab ship --branch fix\/banner-hook-70` once it passes/, 'the refusal names its next command (#532)');
  assert.strictEqual(fx.g(fx.origin, 'rev-parse', 'main').trim(), before, 'nothing pushed to trunk');
});

test('#619: a hook that fails with ONE line — the summary carries it and no detail block is added', () => {
  const fx = fixture();
  branchWithWork(fx, 'fix/oneline-hook-71');
  colab(fx, ['claim', '71', '--branch', 'fix/oneline-hook-71', '--repo', fx.work]);
  failingPreCommit(fx, '#!/bin/sh\necho "fixture-hook: refused" >&2\nexit 1\n');

  const r = colab(fx, ['ship', '--branch', 'fix/oneline-hook-71', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /✗ B1: commit failed \(fixture-hook: refused\)\./, r.err);
  assert.doesNotMatch(r.err, /git output:/, 'one line is already the whole story');
});
