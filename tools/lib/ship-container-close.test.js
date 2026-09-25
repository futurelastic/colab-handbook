'use strict';
/**
 * End-to-end tests for #371's container close in `colab ship`: after a ship closes an issue, its
 * native parent is closed with evidence in the same step when lib/container-close.js says `close`,
 * and left alone (with a finding where a human should look) otherwise.
 *
 * Real CLI, real repo, real bare `origin` — the fixture shape of ship-close-paths.test.js. The `gh`
 * stub answers `issue view <N>` from a per-issue JSON file, and reports a child CLOSED only once
 * origin's `main` carries `Closes #<N>` (the way GitHub's auto-close behaves), so the merge path
 * sees exactly what it would see live. Every call is logged so a test asserts what was closed.
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

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const SESSION = 'https://claude.ai/code/session_container_close_S';
const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

function fixture(views) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-container-close-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  const viewDir = path.join(root, 'views');
  fs.mkdirSync(home);
  fs.mkdirSync(viewDir);
  for (const [n, v] of Object.entries(views)) fs.writeFileSync(path.join(viewDir, `${n}.json`), JSON.stringify(v));
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'container close test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$*" >> "${ghLog}"`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    'if [ "$1" = "repo" ] && [ "$2" = "view" ]; then echo PRIVATE; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    `  SHA=$(cd "${work}" && git rev-parse "refs/heads/$BR" 2>/dev/null)`,
    `  if [ -z "$SHA" ]; then SHA=$(cd "${work}" && git rev-parse HEAD); fi`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\"}]"',
    '  exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    '  N="$3"',
    // a child reads CLOSED once origin/main carries `Closes #N` — GitHub's auto-close, simulated
    `  if git -C "${origin}" log main --format=%B 2>/dev/null | grep -q "Closes #$N\\b"; then`,
    `    sed 's/"state":"OPEN"/"state":"CLOSED"/' "${viewDir}/$N.json"; exit 0`,
    '  fi',
    `  if [ -f "${viewDir}/$N.json" ]; then cat "${viewDir}/$N.json"; exit 0; fi`,
    '  echo \'{"state":"OPEN","labels":[],"comments":[]}\'; exit 0',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "comment" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "close" ]; then exit 0; fi',
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
function ghLog(fx) { return fs.existsSync(fx.ghLog) ? fs.readFileSync(fx.ghLog, 'utf8') : ''; }
function commitOnBranch(fx, branch, file, msg) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, file), `${branch}\n`);
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', msg);
  fx.g(fx.work, 'checkout', '-q', 'main');
}
function shipChild(fx, num) {
  commitOnBranch(fx, `fix/child-${num}`, `c${num}.txt`, 'fix: child');
  assert.strictEqual(colab(fx, ['claim', String(num), '--branch', `fix/child-${num}`, '--repo', fx.work]).code, 0);
  return colab(fx, ['ship', '--branch', `fix/child-${num}`, '--repo', fx.work]);
}

const child = (parent) => ({ state: 'OPEN', labels: [], comments: [], parent: parent ? { number: parent } : null });
const epic = (n, over = {}) => ({
  number: n, state: 'OPEN', labels: [{ name: 'epic' }], body: '## Goal\n\ncontainer\n',
  subIssuesSummary: { total: 2, completed: 2 }, parent: null, ...over,
});

test('#371: shipping the last open child closes its epic with an evidence comment', () => {
  const fx = fixture({ 70: child(40), 40: epic(40) });
  const r = shipChild(fx, 70);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /closed container #40/);
  assert.match(ghLog(fx), /issue comment 40 --body 📦 Closed by colab ship — its last open sub-issue #70 shipped/);
  assert.match(ghLog(fx), /issue close 40 --reason completed/);
});

test('#371: a parent whose sub-issues are not all closed is left open, silently', () => {
  const fx = fixture({ 70: child(40), 40: epic(40, { subIssuesSummary: { total: 3, completed: 2 } }) });
  const r = shipChild(fx, 70);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(ghLog(fx), /issue close 40/);
  assert.doesNotMatch(r.out + r.err, /container #40/);
});

test('#371: an unlabelled parent is a finding, never closed', () => {
  const fx = fixture({ 70: child(40), 40: epic(40, { labels: [] }) });
  const r = shipChild(fx, 70);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(ghLog(fx), /issue close 40/);
  assert.match(r.out + r.err, /#40: all 2 sub-issue\(s\) closed, but it is not labelled `epic`/);
});

test('#371: an epic still listing an unticked item is a finding, never closed', () => {
  const fx = fixture({ 70: child(40), 40: epic(40, { body: '- [x] #70\n- [ ] phase 2, not filed yet\n' }) });
  const r = shipChild(fx, 70);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(ghLog(fx), /issue close 40/);
  assert.match(r.out + r.err, /1 unticked item/);
});

test('#371: an epic of epics empties bottom-up — the grandparent closes too', () => {
  const fx = fixture({ 70: child(40), 40: epic(40, { parent: { number: 30 } }), 30: epic(30) });
  const r = shipChild(fx, 70);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(ghLog(fx), /issue close 40 --reason completed/);
  assert.match(ghLog(fx), /issue comment 30 --body 📦 Closed by colab ship — its last open sub-issue #40 shipped/);
  assert.match(ghLog(fx), /issue close 30 --reason completed/);
});

test('#371: the evidence-close (zero-diff) path closes the container too', () => {
  const fx = fixture({ 71: { ...child(40), comments: [{ body: 'fixture: delivered by hand' }] }, 40: epic(40) });
  fx.g(fx.work, 'branch', 'docs/decision-71');
  colab(fx, ['claim', '71', '--branch', 'docs/decision-71', '--repo', fx.work]);
  const r = colab(fx, ['ship', '--branch', 'docs/decision-71', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /evidence-close/);
  assert.match(ghLog(fx), /issue close 71 --reason completed/);
  assert.match(ghLog(fx), /issue close 40 --reason completed/);
});
