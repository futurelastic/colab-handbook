'use strict';
/**
 * Tests for machine identity (tools/lib/machine.js, #289).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Everything here is PURE or takes injected dependencies (`resolveMachineId`'s `runFn`/`readFileFn`/
 * `networkInterfacesFn`) — no test depends on what `os.hostname()`/`ioreg`/`/etc/machine-id` happen
 * to say on the machine running this suite.
 */

const test = require('node:test');
const assert = require('node:assert');

const machine = require('./machine.js');

// --- canonHost -------------------------------------------------------------------

test('canonHost: case, trailing dot, and every label after the first are all dropped', () => {
  assert.strictEqual(machine.canonHost('Foo.local'), 'foo');
  assert.strictEqual(machine.canonHost('foo.local.'), 'foo');
  assert.strictEqual(machine.canonHost('FOO'), 'foo');
  assert.strictEqual(machine.canonHost('foo.hsd1.ca.comcast.net'), 'foo');
});

test('canonHost: falsy input is the empty string, never throws', () => {
  assert.strictEqual(machine.canonHost(''), '');
  assert.strictEqual(machine.canonHost(null), '');
  assert.strictEqual(machine.canonHost(undefined), '');
});

// --- sameMachineWith ---------------------------------------------------------------

test('sameMachineWith: same scheme + same id is true even when hostnames differ entirely (#289 drift case)', () => {
  const rec = { host: 'totally-different-name', machine: 'iokit:ABC-123' };
  const local = { host: 'devbox', id: 'iokit:ABC-123' };
  assert.strictEqual(machine.sameMachineWith(rec, local), true);
});

test('sameMachineWith: same scheme + different id is false even when hostnames are identical', () => {
  const rec = { host: 'devbox', machine: 'iokit:ABC-123' };
  const local = { host: 'devbox', id: 'iokit:XYZ-999' };
  assert.strictEqual(machine.sameMachineWith(rec, local), false);
});

test('sameMachineWith: a legacy record (no machine field) with a drifted host of the same first label is true', () => {
  const rec = { host: 'devbox.local.' };
  const local = { host: 'devbox.hsd1.ca.comcast.net', id: 'iokit:ABC-123' };
  assert.strictEqual(machine.sameMachineWith(rec, local), true);
});

test('sameMachineWith: different first label, no machine id on either side, is false (foreign-host backstop intact)', () => {
  const rec = { host: 'some-other-box' };
  const local = { host: 'devbox', id: null };
  assert.strictEqual(machine.sameMachineWith(rec, local), false);
});

test('sameMachineWith: a record with neither host nor machine is true (today\'s falsy-host behaviour, preserved)', () => {
  const rec = {};
  const local = { host: 'devbox', id: 'iokit:ABC-123' };
  assert.strictEqual(machine.sameMachineWith(rec, local), true);
});

test('sameMachineWith: different schemes never compare — falls back to canonHost even when both sides have a machine id', () => {
  const rec = { host: 'devbox', machine: 'dbus:same-value' };
  const local = { host: 'devbox', id: 'iokit:same-value' };
  // Schemes differ (dbus vs iokit) so branch 2 does not fire; branch 3 (hostname) still agrees here.
  assert.strictEqual(machine.sameMachineWith(rec, local), true);
});

// --- resolveMachineId (the injectable core localMachine() wraps) -------------------

test('resolveMachineId: darwin, ioreg reports IOPlatformUUID, produces an iokit:-prefixed id', () => {
  const runFn = () => ({ ok: true, stdout: '    | "IOPlatformUUID" = "ABCD-1234-EFGH"', stderr: '' });
  const id = machine.resolveMachineId({ platform: 'darwin', runFn, networkInterfacesFn: () => ({}) });
  assert.strictEqual(id, 'iokit:ABCD-1234-EFGH');
});

test('resolveMachineId: darwin, ioreg unusable, falls through to the MAC fallback', () => {
  const runFn = () => { throw new Error('ioreg not found'); };
  const networkInterfacesFn = () => ({
    en0: [{ mac: 'aa:bb:cc:dd:ee:ff', internal: false }, { mac: '00:00:00:00:00:00', internal: false }],
    lo0: [{ mac: '00:00:00:00:00:00', internal: true }],
  });
  const id = machine.resolveMachineId({ platform: 'darwin', runFn, networkInterfacesFn });
  assert.match(id, /^mac:[0-9a-f]{12}$/);
});

test('resolveMachineId: linux reads /etc/machine-id, produces a dbus:-prefixed id', () => {
  const readFileFn = (p) => (p === '/etc/machine-id' ? '  deadbeef1234  \n' : (() => { throw new Error('ENOENT'); })());
  const id = machine.resolveMachineId({ platform: 'linux', readFileFn, networkInterfacesFn: () => ({}) });
  assert.strictEqual(id, 'dbus:deadbeef1234');
});

test('resolveMachineId: linux, /etc/machine-id unreadable, falls back to /var/lib/dbus/machine-id', () => {
  const readFileFn = (p) => {
    if (p === '/etc/machine-id') throw new Error('ENOENT');
    if (p === '/var/lib/dbus/machine-id') return 'cafef00d';
    throw new Error('unexpected path');
  };
  const id = machine.resolveMachineId({ platform: 'linux', readFileFn, networkInterfacesFn: () => ({}) });
  assert.strictEqual(id, 'dbus:cafef00d');
});

test('resolveMachineId: every scheme fails (unsupported platform, no usable interface) — null, never throws', () => {
  assert.doesNotThrow(() => {
    const id = machine.resolveMachineId({
      platform: 'win32',
      runFn: () => { throw new Error('nope'); },
      readFileFn: () => { throw new Error('nope'); },
      networkInterfacesFn: () => ({}),
    });
    assert.strictEqual(id, null);
  });
});

test('resolveMachineId: MAC fallback itself throwing (a hostile networkInterfaces) degrades to null, never throws', () => {
  assert.doesNotThrow(() => {
    const id = machine.resolveMachineId({
      platform: 'win32',
      networkInterfacesFn: () => { throw new Error('boom'); },
    });
    assert.strictEqual(id, null);
  });
});

// --- localMachine() — the real, memoized, impure wrapper ---------------------------

test('localMachine: never throws on the real machine running this test, and returns an {id, host}-tolerant shape', () => {
  let result;
  assert.doesNotThrow(() => { result = machine.localMachine(); });
  assert.ok(result && typeof result === 'object');
  assert.ok('id' in result);
  assert.ok('host' in result);
  // id is either null or a non-empty scheme-prefixed string — never throws either way.
  assert.ok(result.id === null || (typeof result.id === 'string' && result.id.includes(':')));
});

test('localMachine: memoized — repeated calls return the identical object, not merely equal values', () => {
  assert.strictEqual(machine.localMachine(), machine.localMachine());
});

// --- isLocal — the impure convenience wrapper --------------------------------------

test('isLocal: a record with neither host nor machine is always local (falsy-host behaviour)', () => {
  assert.strictEqual(machine.isLocal({}), true);
});
