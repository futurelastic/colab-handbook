'use strict';
/**
 * Tests for #525 — the human door on `colab ship`'s autonomy gate.
 *
 * Ruling on #525 (option 1): on a repo without `autonomy: auto-trunk`, a person running ship IS the
 * go — at an interactive terminal (confirmed), or COLAB_HUMAN=1 + --answered-by. An unattended run
 * still refuses, now naming the command a human runs; auto-trunk is unchanged.
 *
 * The TTY branch is covered on the pure verdict (lib/ship-human-door.js): a spawned CLI never has
 * a TTY, and a test-only switch that fakes one would itself be a way through the door.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const door = require('./ship-human-door');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const SESSION = 'https://claude.ai/code/session_human_door_S';
const NO_AUTONOMY = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

const TMP = [];
process.on('exit', () => { for (const dir of TMP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } });

function fixture(yml = NO_AUTONOMY) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-human-door-'));
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
  g(work, 'config', 'user.name', 'human-door test');
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

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '', CLAUDECODE: '', AI_AGENT: '',
      ...extraEnv,
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


const HUMAN = { COLAB_HUMAN: '1' };

// ---- the pure verdict ---------------------------------------------------------------------------

test('#525: an interactive terminal outside an agent shell opens the door', () => {
  const v = door.humanDoorVerdict({ isTTY: true, colabHuman: false, answeredBy: null, agentShell: false });
  assert.deepStrictEqual([v.open, v.how], [true, 'tty']);
});

test('#525: a TTY inside an agent shell does not open the door', () => {
  const v = door.humanDoorVerdict({ isTTY: true, colabHuman: false, answeredBy: null, agentShell: true });
  assert.strictEqual(v.open, false);
  assert.match(v.why, /agent shell/);
});

test('#525: COLAB_HUMAN=1 needs --answered-by; with it, the door opens without a TTY', () => {
  assert.strictEqual(door.humanDoorVerdict({ isTTY: false, colabHuman: true, answeredBy: null, agentShell: false }).open, false);
  const v = door.humanDoorVerdict({ isTTY: false, colabHuman: true, answeredBy: 'Ada', agentShell: false });
  assert.deepStrictEqual([v.open, v.how], [true, 'colab-human']);
});

test('#525: unattended — no TTY, no COLAB_HUMAN — stays closed', () => {
  const v = door.humanDoorVerdict({ isTTY: false, colabHuman: false, answeredBy: 'Ada', agentShell: false });
  assert.strictEqual(v.open, false);
  assert.match(v.why, /unattended/);
});

test('#525: agent-shell detection reads CLAUDECODE and AI_AGENT', () => {
  assert.strictEqual(door.isAgentShell({ CLAUDECODE: '1' }), true);
  assert.strictEqual(door.isAgentShell({ AI_AGENT: 'x' }), true);
  assert.strictEqual(door.isAgentShell({}), false);
});

// ---- the CLI ------------------------------------------------------------------------------------

test('#525: unattended ship on a manual repo refuses and names the command a human runs', () => {
  const fx = fixture();
  branch(fx, 'feat/code-71', 71, { 'x.js': 'x\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/code-71', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /does not grant auto-trunk/);
  assert.match(r.err, /human door \(#525\) did not open: unattended/);
  assert.match(r.err, /COLAB_HUMAN=1 colab ship --branch feat\/code-71 --answered-by "<your name>"/);
  assert.match(r.err, /at your own terminal:\s+colab ship --branch feat\/code-71/);
  assert.doesNotMatch(mainLog(fx), /#71/);
});

test('#525: COLAB_HUMAN=1 without --answered-by still refuses, saying what is missing', () => {
  const fx = fixture();
  branch(fx, 'feat/code-72', 72, { 'x.js': 'x\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/code-72', '--repo', fx.work], HUMAN);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /also needs --answered-by/);
  assert.doesNotMatch(mainLog(fx), /#72/);
});

test('#525: COLAB_HUMAN=1 + --answered-by ships a code branch on a manual repo, recorded on the 🚢 comment', () => {
  const fx = fixture();
  branch(fx, 'feat/code-73', 73, { 'x.js': 'x\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/code-73', '--repo', fx.work, '--answered-by', 'Ada'], HUMAN);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /autonomy granted\s+human door \(#525\): COLAB_HUMAN=1, answered by Ada/);
  assert.match(mainLog(fx), /Closes #73|\(#73\)/);
  assert.strictEqual(fx.g(fx.work, 'show', 'main:x.js'), 'x');
  assert.match(log(fx), /🚢 Shipped to main by colab ship .*merged through the human door \(#525\): COLAB_HUMAN=1, answered by Ada/);
});

test('#525: --dry --json reports the human door, open or closed', () => {
  const fx = fixture();
  branch(fx, 'feat/code-74', 74, { 'x.js': 'x\n' });
  const closed = colab(fx, ['ship', '--branch', 'feat/code-74', '--repo', fx.work, '--dry', '--json']);
  assert.strictEqual(closed.code, 1, closed.out + closed.err);
  const jc = JSON.parse(closed.out);
  assert.strictEqual(jc.autonomyGate.via, null);
  assert.deepStrictEqual([jc.autonomyGate.human.open, jc.autonomyGate.human.how], [false, null]);

  const open = colab(fx, ['ship', '--branch', 'feat/code-74', '--repo', fx.work, '--dry', '--json', '--answered-by', 'Ada'], HUMAN);
  const jo = JSON.parse(open.out);
  assert.strictEqual(jo.autonomyGate.via, 'human');
  assert.strictEqual(jo.autonomyGate.human.how, 'colab-human');
  assert.strictEqual(jo.checks.find((c) => c.name === 'autonomy granted').ok, true);
});

test('#525: an agent shell without COLAB_HUMAN refuses exactly as unattended', () => {
  const fx = fixture();
  branch(fx, 'feat/code-75', 75, { 'x.js': 'x\n' });
  const r = colab(fx, ['ship', '--branch', 'feat/code-75', '--repo', fx.work], { CLAUDECODE: '1' });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /does not grant auto-trunk/);
  assert.doesNotMatch(mainLog(fx), /#75/);
});

test('#525: auto-trunk is unchanged — ships unattended, no human field, no human-door clause', () => {
  const fx = fixture(`${NO_AUTONOMY}autonomy: auto-trunk\n`);
  branch(fx, 'feat/code-76', 76, { 'x.js': 'x\n' });
  const j = JSON.parse(colab(fx, ['ship', '--branch', 'feat/code-76', '--repo', fx.work, '--dry', '--json']).out);
  assert.deepStrictEqual(j.autonomyGate, { via: 'auto-trunk', docsOnly: null });
  const r = colab(fx, ['ship', '--branch', 'feat/code-76', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(log(fx), /human door/);
});

test('#525: ship --direct — a code trunk-direct unit closes through the human door', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '77', '--repo', fx.work]).code, 0);
  fs.writeFileSync(path.join(fx.work, 'y.js'), 'direct\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: direct unit (#77)');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  const refused = colab(fx, ['ship', '--direct', '--repo', fx.work]);
  assert.strictEqual(refused.code, 1, refused.out + refused.err);
  assert.match(refused.err, /COLAB_HUMAN=1 colab ship --direct --answered-by/);
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work, '--answered-by', 'Ada'], HUMAN);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /AUTONOMY: human door \(#525\)/);
  assert.match(log(fx), /issue close 77/);
  assert.match(log(fx), /merged through the human door \(#525\)/);
});
