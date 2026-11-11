'use strict';
/**
 * The state lock survives a dead holder (#712). Before, `withLock` was a bare `mkdir` that recorded
 * nothing: a holder killed inside the critical section left `state.lock` forever, and every state
 * write on the machine failed with "Lock stuck" until someone removed it by hand. These tests kill
 * a real process inside `withLock`, and plant locks with dead, reused, live and missing owners.
 *
 * Every case runs against a private COLAB_HOME, set before state.js is required (it resolves the
 * directory at load time), so nothing here touches the machine's real ~/.colab.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-lock-'));
process.env.COLAB_HOME = HOME;
const STATE_JS = path.join(__dirname, 'state.js');
const state = require('./state.js');
const { LOCK_DIR, LOCK_OWNER, LOCK_STALE_MS } = state;

const FAST = { tries: 5, waitMs: 10 };

function reset() {
  for (const f of fs.readdirSync(HOME)) fs.rmSync(path.join(HOME, f), { recursive: true, force: true });
}

function plant(owner) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  if (owner) fs.writeFileSync(path.join(LOCK_DIR, LOCK_OWNER), JSON.stringify(owner) + '\n');
}

function deadPid() {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
}

function owner(over) {
  return { pid: process.pid, host: os.hostname(), start: Date.now() - Math.round(process.uptime() * 1000),
    at: Date.now(), token: 'planted-' + Math.random().toString(36).slice(2), ...over };
}

function collect() {
  const lines = [];
  return { lines, log: (m) => lines.push(m) };
}

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
test.beforeEach(reset);

test('a holder SIGKILLed inside withLock does not block the next withLock', () => {
  const r = spawnSync(process.execPath, ['-e',
    `require(${JSON.stringify(STATE_JS)}).withLock(() => process.kill(process.pid, 'SIGKILL'))`],
  { env: { ...process.env, COLAB_HOME: HOME }, encoding: 'utf8' });
  assert.strictEqual(r.signal, 'SIGKILL', 'the child died inside the critical section');
  assert.ok(fs.existsSync(LOCK_DIR), 'its lock was left behind — the #712 situation');
  assert.strictEqual(state._lock.readLockOwner().pid, r.pid, 'and records who held it');

  const { lines, log } = collect();
  assert.strictEqual(state.withLock(() => 'ran', { ...FAST, log }), 'ran');
  assert.strictEqual(lines.length, 1, 'breaking it logs exactly one line');
  assert.match(lines[0], new RegExp(`pid ${r.pid} .*is gone`));
  assert.ok(!fs.existsSync(LOCK_DIR), 'released after');
  assert.deepStrictEqual(fs.readdirSync(HOME).filter((f) => f.startsWith('state.lock')), [], 'no grave or break dir left');
});

test('a planted lock whose pid is dead is broken without manual removal', () => {
  plant(owner({ pid: deadPid() }));
  const { lines, log } = collect();
  assert.strictEqual(state.withLock(() => 42, { ...FAST, log }), 42);
  assert.strictEqual(lines.length, 1);
});

test('a live holder is never broken, even when older than the stale bound, and the failure names it', async () => {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    await new Promise((res) => child.once('spawn', res));
    const o = owner({ pid: child.pid, start: Date.now(), at: Date.now() - 2 * LOCK_STALE_MS });
    plant(o);
    const { lines, log } = collect();
    let ran = false;
    assert.throws(() => state.withLock(() => { ran = true; }, { ...FAST, log }),
      (e) => /Lock stuck/.test(e.message) && e.message.includes(`pid ${child.pid}`) && /\d+s old/.test(e.message));
    assert.strictEqual(ran, false);
    assert.deepStrictEqual(lines, [], 'nothing was broken');
    assert.strictEqual(state._lock.readLockOwner().token, o.token, 'the holder still owns the lock');
  } finally { child.kill('SIGKILL'); }
});

test('a live pid whose start time differs from the record (pid reused) is broken', () => {
  plant(owner({ start: Date.now() - 24 * 3600 * 1000 }));
  const { lines, log } = collect();
  assert.strictEqual(state.withLock(() => 'ok', { ...FAST, log }), 'ok');
  assert.match(lines[0], /reused/);
});

test('an ownerless lock (an older colab) waits while young and is broken once past the bound', () => {
  plant(null);
  assert.throws(() => state.withLock(() => {}, FAST), /Lock stuck: .*no owner recorded, \d+s old/);
  assert.ok(fs.existsSync(LOCK_DIR), 'a fresh ownerless lock is left alone');

  const old = (Date.now() - 2 * LOCK_STALE_MS) / 1000;
  fs.utimesSync(LOCK_DIR, old, old);
  const { lines, log } = collect();
  assert.strictEqual(state.withLock(() => 'ok', { ...FAST, log }), 'ok');
  assert.strictEqual(lines.length, 1);
});

test('release removes the owner record and the directory', () => {
  state.withLock(() => {
    assert.strictEqual(state._lock.readLockOwner().pid, process.pid, 'the holder records itself');
  }, FAST);
  assert.ok(!fs.existsSync(LOCK_DIR));
});

test('a holder whose lock was broken and re-taken does not release the new holder', () => {
  const other = owner({ token: 'someone-else' });
  state.withLock(() => {
    fs.rmSync(LOCK_DIR, { recursive: true });   // judged dead and broken by a waiter …
    plant(other);                                // … which now holds the lock itself
  }, FAST);
  assert.strictEqual(state._lock.readLockOwner().token, 'someone-else', 'the new holder keeps it');
});

test('a breaker that finds a fresh lock in place of the one it judged puts it back untouched', () => {
  const fresh = owner({ token: 'fresh' });
  plant(fresh);
  const judged = { stale: true, owner: owner({ token: 'the-dead-one' }), ageMs: 0, reason: 'test' };
  const { lines, log } = collect();
  assert.strictEqual(state._lock.breakStaleLock(judged, log), false);
  assert.strictEqual(state._lock.readLockOwner().token, 'fresh');
  assert.deepStrictEqual(lines, []);
  assert.deepStrictEqual(fs.readdirSync(HOME).filter((f) => f !== 'state.lock' && f.startsWith('state.lock')), []);
});

test('mutate still serializes through the lock and leaves no lock behind', () => {
  state.mutate((st) => { st.claims = st.claims || {}; });
  assert.ok(!fs.existsSync(LOCK_DIR));
});
