'use strict';
/**
 * Tests for #445 — the release channels `next` and `stable`.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Three layers, matching the issue's done-when:
 *   - decideMove, pure: create / fast-forward / no-op / refuse
 *   - moveChannel against a real bare remote WITH templates/pre-push-guard installed as its pre-push
 *     hook — so "the release command moves the channel" and "a hand push is refused" are proved on
 *     the same fixture, through the same hook
 *   - the guard alone: refusal text names the remedy, never the variable that opens it (#322)
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const channel = require('./release-channel.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'templates', 'pre-push-guard');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });
function tmpdir(prefix) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); TMP.push(d); return d; }

// The variables the guard reads, cleared so the developer's own shell cannot open it.
const CLEAN_ENV = { ...process.env, COLAB_SHIP: '', COLAB_HUMAN: '', COLAB_PROMOTE: '', COLAB_RELEASE: '' };

/** A clone of a bare remote, the guard installed as its pre-push hook. Two commits on main. */
function fixture() {
  const root = tmpdir('release-channel-');
  const bare = path.join(root, 'remote.git');
  const dir = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: CLEAN_ENV }).trim();
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'release channel test');
  const hooks = path.join(root, 'hooks');
  fs.mkdirSync(hooks);
  fs.copyFileSync(GUARD, path.join(hooks, 'pre-push'));
  fs.chmodSync(path.join(hooks, 'pre-push'), 0o755);
  g('config', 'core.hooksPath', hooks);
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'exposure: released\ntrunk: main\nproduction: null\ndeploy: tag\nstack: node\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: one');
  const c1 = g('rev-parse', 'HEAD');
  g('commit', '-q', '--allow-empty', '-m', 'feat: two');
  const c2 = g('rev-parse', 'HEAD');
  g('remote', 'add', 'origin', bare);
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: dir, env: { ...CLEAN_ENV, COLAB_HUMAN: '1' } });
  const remoteHead = (ch) => {
    const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${ch}`], { cwd: bare, encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  return { dir, bare, g, c1, c2, remoteHead };
}

// --- decideMove: pure ------------------------------------------------------------------------

test('decideMove: an absent channel is created', () => {
  const d = channel.decideMove({ channel: 'stable', current: null, target: 'a'.repeat(40), label: 'v1.12.0' });
  assert.strictEqual(d.action, 'create');
  assert.match(d.detail, /stable created at v1\.12\.0/);
});

test('decideMove: a fast-forward moves; the same commit is a no-op', () => {
  assert.strictEqual(channel.decideMove({ channel: 'next', current: 'a'.repeat(40), target: 'b'.repeat(40), currentIsAncestor: true }).action, 'move');
  assert.strictEqual(channel.decideMove({ channel: 'next', current: 'b'.repeat(40), target: 'b'.repeat(40) }).action, 'noop');
});

test('decideMove: a channel already past the target stays put — forward only', () => {
  const d = channel.decideMove({ channel: 'stable', current: 'b'.repeat(40), target: 'a'.repeat(40), currentIsAncestor: false, targetIsAncestor: true });
  assert.strictEqual(d.action, 'noop');
  assert.match(d.detail, /only moves forward/);
});

test('decideMove: a diverged channel is refused, never forced', () => {
  const d = channel.decideMove({ channel: 'next', current: 'b'.repeat(40), target: 'a'.repeat(40), currentIsAncestor: false, targetIsAncestor: false });
  assert.strictEqual(d.action, 'refuse');
  assert.match(d.detail, /NOT moved/);
});

// --- moveChannel through the installed guard ------------------------------------------------

test('moveChannel creates, fast-forwards and then no-ops — through the pre-push guard', () => {
  const f = fixture();
  let r = channel.moveChannel(f.dir, { remote: 'origin', channel: 'next', sha: f.c1, label: 'v1.0.1-rc.1', env: CLEAN_ENV });
  assert.ok(r.ok, r.detail);
  assert.strictEqual(r.action, 'create');
  assert.strictEqual(f.remoteHead('next'), f.c1);

  r = channel.moveChannel(f.dir, { remote: 'origin', channel: 'next', sha: f.c2, label: 'v1.0.1-rc.2', env: CLEAN_ENV });
  assert.ok(r.ok, r.detail);
  assert.strictEqual(r.action, 'move');
  assert.strictEqual(f.remoteHead('next'), f.c2);

  r = channel.moveChannel(f.dir, { remote: 'origin', channel: 'next', sha: f.c2, label: 'v1.0.1-rc.2', env: CLEAN_ENV });
  assert.strictEqual(r.action, 'noop');
});

test('moveChannel never moves a channel backwards (stable already past an older final)', () => {
  const f = fixture();
  assert.ok(channel.moveChannel(f.dir, { remote: 'origin', channel: 'stable', sha: f.c2, label: 'v1.1.0', env: CLEAN_ENV }).ok);
  const r = channel.moveChannel(f.dir, { remote: 'origin', channel: 'stable', sha: f.c1, label: 'v1.0.0', env: CLEAN_ENV });
  assert.strictEqual(r.action, 'noop');
  assert.strictEqual(f.remoteHead('stable'), f.c2);
});

test('moveChannel refuses a diverged channel and leaves it where it was', () => {
  const f = fixture();
  f.g('checkout', '-q', '-b', 'side', f.c1);
  f.g('commit', '-q', '--allow-empty', '-m', 'chore: elsewhere');
  const side = f.g('rev-parse', 'HEAD');
  execFileSync('git', ['push', '-q', 'origin', `${side}:refs/heads/next`], { cwd: f.dir, env: { ...CLEAN_ENV, COLAB_HUMAN: '1' } });
  const r = channel.moveChannel(f.dir, { remote: 'origin', channel: 'next', sha: f.c2, label: 'v1.0.1-rc.1', env: CLEAN_ENV });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.action, 'refuse');
  assert.strictEqual(f.remoteHead('next'), side);
});

test('moveChannel --dry writes nothing', () => {
  const f = fixture();
  const r = channel.moveChannel(f.dir, { remote: 'origin', channel: 'next', sha: f.c2, label: 'v1.0.1-rc.1', dry: true, env: CLEAN_ENV });
  assert.ok(r.ok);
  assert.match(r.detail, /^\[--dry\] would be: next created/);
  assert.strictEqual(f.remoteHead('next'), null);
});

// --- the guard: a hand push to either channel is refused -------------------------------------

for (const ch of ['next', 'stable']) {
  test(`pre-push-guard refuses a hand push to ${ch}, naming the release command — never the variable`, () => {
    const f = fixture();
    const res = spawnSync('git', ['push', 'origin', `${f.c2}:refs/heads/${ch}`], { cwd: f.dir, encoding: 'utf8', env: CLEAN_ENV });
    assert.notStrictEqual(res.status, 0, 'a hand push must be refused');
    assert.match(res.stderr, new RegExp(`refusing raw push to release channel '${ch}'`));
    assert.match(res.stderr, ch === 'next' ? /colab release cut/ : /colab release finalize/);
    assert.doesNotMatch(res.stderr, /COLAB_[A-Z]+/, '#322: a refusal names the remedy, never the door');
    assert.strictEqual(f.remoteHead(ch), null);
  });
}

test('pre-push-guard lets an ordinary branch through untouched', () => {
  const f = fixture();
  const res = spawnSync('git', ['push', 'origin', `${f.c2}:refs/heads/feat/thing-1`], { cwd: f.dir, encoding: 'utf8', env: CLEAN_ENV });
  assert.strictEqual(res.status, 0, res.stderr);
});
