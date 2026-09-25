'use strict';
/**
 * #372 — the ship comment names BOTH roles: the session holding the claim (implementer) and the
 * session that ran `colab ship` (shipper). It used to name only the claim holder, in a sentence
 * that read as "session X shipped this", so every correct coordinator ship looked like an
 * implementer merging its own work.
 *
 * Two layers: the pure suffix (tools/lib/ship-roles.js), then the real CLI against a real repo with
 * a bare `origin` and a logging `gh` stub (same shape as ship-close-paths.test.js), asserting the
 * comment bodies actually posted on the merge, evidence-close and trunk-direct paths.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { shipRolesSuffix, compareSessions, sessionRef } = require('./ship-roles');

const IMPL = 'https://claude.ai/code/session_roles_IMPL';
const SHIP = 'https://claude.ai/code/session_roles_SHIP';

// =================================================================================================
// The pure suffix
// =================================================================================================

test('#372 sessionRef: link when both, else whichever is set, else empty', () => {
  assert.strictEqual(sessionRef({ session: IMPL, sessionName: 'impl' }), `[impl](${IMPL})`);
  assert.strictEqual(sessionRef({ session: IMPL }), IMPL);
  assert.strictEqual(sessionRef({ sessionName: 'impl' }), 'impl');
  assert.strictEqual(sessionRef({}), '');
  assert.strictEqual(sessionRef(null), '');
});

test('#372 two different sessions: both roles named, each with its own identity', () => {
  assert.strictEqual(
    shipRolesSuffix({ session: IMPL, sessionName: 'impl' }, { session: SHIP, sessionName: 'ship' }),
    ` · implemented by session [impl](${IMPL}) · shipped by session [ship](${SHIP})`);
});

test('#372 same session (by URL): said plainly, as one session', () => {
  assert.strictEqual(
    shipRolesSuffix({ session: IMPL, sessionName: 'impl' }, { session: IMPL, sessionName: '' }),
    ` · implemented and shipped by the same session [impl](${IMPL})`);
});

test('#372 the URL decides over the name: same URL + different names is one session; same name + different URLs is two', () => {
  assert.match(shipRolesSuffix({ session: IMPL, sessionName: 'a' }, { session: IMPL, sessionName: 'b' }),
    /implemented and shipped by the same session \[a\]/);
  assert.match(shipRolesSuffix({ session: IMPL, sessionName: 'x' }, { session: SHIP, sessionName: 'x' }),
    /implemented by session \[x\]\(.*IMPL\) · shipped by session \[x\]\(.*SHIP\)$/);
});

test('#372 same session by NAME only: still flagged as the same session, and says the match is name-only', () => {
  const s = shipRolesSuffix({ sessionName: 'impl' }, { session: SHIP, sessionName: 'impl' });
  assert.match(s, /implemented and shipped by the same session \[impl\]\(.*SHIP\)/);
  assert.match(s, /matched by name only/);
});

test('#372 shipper unknown: says so instead of leaving the holder to read as the shipper', () => {
  assert.strictEqual(shipRolesSuffix({ session: IMPL }, {}), ` · implemented by session ${IMPL} · shipped by: unknown`);
  assert.strictEqual(shipRolesSuffix({ session: IMPL }, null), ` · implemented by session ${IMPL} · shipped by: unknown`);
});

test('#372 holder unknown / both unknown: never an empty suffix', () => {
  assert.strictEqual(shipRolesSuffix({}, { session: SHIP }), ` · implemented by: unknown · shipped by session ${SHIP}`);
  assert.strictEqual(shipRolesSuffix({}, {}), ' · implemented by: unknown · shipped by: unknown');
});

test('#372 no shared field to compare (URL on one side, name on the other): says it cannot tell', () => {
  assert.strictEqual(compareSessions({ session: IMPL }, { sessionName: 'ship' }), null);
  assert.match(shipRolesSuffix({ session: IMPL }, { sessionName: 'ship' }),
    /implemented by session .*IMPL · shipped by session ship \(no shared identity field — cannot tell/);
});

// =================================================================================================
// The real CLI — what `colab ship` actually posts
// =================================================================================================

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ship-roles-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'ship roles test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'),
    'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n');
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
    '  echo \'{"state":"OPEN","labels":[],"comments":[{"body":"fixture: delivered by hand"}]}\'; exit 0',
    'fi',
    'if [ "$1" = "issue" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { root, work, home, bin, ghLog, g };
}

function colab(fx, args, { session, sessionName = '' }) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: session, COLAB_SESSION_NAME: sessionName, COLAB_HUMAN: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function ghLog(fx) { return fs.existsSync(fx.ghLog) ? fs.readFileSync(fx.ghLog, 'utf8') : ''; }
/** The body of every `gh issue comment <num>` call, in order. */
function commentsOn(fx, num) {
  return ghLog(fx).split(/(?=^issue comment )/m).filter((c) => c.startsWith(`issue comment ${num} `));
}
function commitOnBranch(fx, branch, file, msg) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, file), `${branch}\n`);
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', msg);
  fx.g(fx.work, 'checkout', '-q', 'main');
}

test('#372 e2e: a coordinator ships an implementer\'s branch — the ship comment names both, distinctly', () => {
  const fx = fixture();
  commitOnBranch(fx, 'fix/x-80', 'x.txt', 'fix: x');
  assert.strictEqual(colab(fx, ['claim', '80', '--branch', 'fix/x-80', '--repo', fx.work],
    { session: IMPL, sessionName: 'impl-80' }).code, 0);
  const r = colab(fx, ['ship', '--branch', 'fix/x-80', '--repo', fx.work], { session: SHIP, sessionName: 'shipper' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  const ship = commentsOn(fx, 80).find((c) => /Shipped to main by colab ship/.test(c));
  assert.ok(ship, `no ship comment posted on #80:\n${ghLog(fx)}`);
  assert.match(ship, new RegExp(`implemented by session \\[impl-80\\]\\(${IMPL}\\) · shipped by session \\[shipper\\]\\(${SHIP}\\)`));
  assert.doesNotMatch(ship, /same session/);
});

test('#372 e2e: the implementer ships its own branch — the comment says it is the same session', () => {
  const fx = fixture();
  commitOnBranch(fx, 'fix/y-81', 'y.txt', 'fix: y');
  colab(fx, ['claim', '81', '--branch', 'fix/y-81', '--repo', fx.work], { session: IMPL, sessionName: 'impl-81' });
  const r = colab(fx, ['ship', '--branch', 'fix/y-81', '--repo', fx.work], { session: IMPL, sessionName: 'impl-81' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  const ship = commentsOn(fx, 81).find((c) => /Shipped to main/.test(c));
  assert.match(ship, new RegExp(`implemented and shipped by the same session \\[impl-81\\]\\(${IMPL}\\)`));
});

test('#372 e2e: a shipper with no identity is written as unknown — the holder no longer reads as the shipper', () => {
  const fx = fixture();
  commitOnBranch(fx, 'fix/z-82', 'z.txt', 'fix: z');
  colab(fx, ['claim', '82', '--branch', 'fix/z-82', '--repo', fx.work], { session: IMPL, sessionName: 'impl-82' });
  const r = colab(fx, ['ship', '--branch', 'fix/z-82', '--repo', fx.work], { session: '', sessionName: '' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  const ship = commentsOn(fx, 82).find((c) => /Shipped to main/.test(c));
  assert.match(ship, new RegExp(`implemented by session \\[impl-82\\]\\(${IMPL}\\) · shipped by: unknown`));
});

test('#372 e2e: the evidence-close comment carries the same two roles', () => {
  const fx = fixture();
  fx.g(fx.work, 'branch', 'docs/decision-83');
  colab(fx, ['claim', '83', '--branch', 'docs/decision-83', '--repo', fx.work], { session: IMPL, sessionName: 'impl-83' });
  const r = colab(fx, ['ship', '--branch', 'docs/decision-83', '--repo', fx.work], { session: SHIP, sessionName: 'shipper' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /evidence-close/);
  const close = commentsOn(fx, 83).find((c) => /evidence-close/.test(c));
  assert.ok(close, `no evidence-close comment on #83:\n${ghLog(fx)}`);
  assert.match(close, /implemented by session \[impl-83\].* · shipped by session \[shipper\]/s);
});

test('#372 e2e: a trunk-direct unit is one session by construction — its evidence-close says so', () => {
  const fx = fixture();
  colab(fx, ['claim', '84', '--repo', fx.work], { session: IMPL, sessionName: 'impl-84' });
  fs.writeFileSync(path.join(fx.work, 'd84.txt'), 'direct\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: direct unit (#84)');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  const r = colab(fx, ['ship', '--direct', '--repo', fx.work], { session: IMPL, sessionName: 'impl-84' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  const close = commentsOn(fx, 84).find((c) => /trunk-direct/.test(c));
  assert.match(close, new RegExp(`implemented and shipped by the same session \\[impl-84\\]\\(${IMPL}\\)`));
});
