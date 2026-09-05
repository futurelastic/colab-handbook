'use strict';
/**
 * Tests for tools/lib/lockfile-drift.js — "this merge changed a dependency lockfile and the
 * checkout it landed in was not re-installed" (#304). Pure, so no git fixture is needed: the
 * path list is handed in directly, exactly as `tools/colab` hands over a real
 * `git diff --name-only <sha>~1..<sha>` result.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const { changedLockfiles, driftWarning, LOCKFILES } = require('./lockfile-drift.js');

// --- changedLockfiles: the hits -------------------------------------------------------------

test('changedLockfiles: composer.lock at the repo root is a hit, and carries its install advice', () => {
  const out = changedLockfiles(['composer.lock']);
  assert.deepStrictEqual(out, [{ path: 'composer.lock', manager: 'composer', install: 'composer install' }]);
});

test('changedLockfiles: package-lock.json is a hit and advises the lockfile-respecting form', () => {
  const out = changedLockfiles(['package-lock.json']);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].manager, 'npm');
  // `npm ci` and not `npm install`: reconciling a checkout TO a lockfile is what `ci` is for, and
  // `install` is free to rewrite the lockfile it was supposed to be obeying.
  assert.strictEqual(out[0].install, 'npm ci');
});

test('changedLockfiles: a monorepo-nested lockfile counts — the skew is per installed tree', () => {
  const out = changedLockfiles(['packages/api/composer.lock']);
  assert.deepStrictEqual(out.map((h) => h.path), ['packages/api/composer.lock']);
});

test('changedLockfiles: several managers in one merge all report, in path order', () => {
  const out = changedLockfiles(['package-lock.json', 'src/app.ts', 'composer.lock']);
  assert.deepStrictEqual(out.map((h) => h.manager), ['npm', 'composer']);
});

// --- changedLockfiles: the near-misses ------------------------------------------------------
//
// The whole value of an anchored match. An unanchored `includes()` would fire on every one of
// these, and a warning that cries wolf on `composer.json` teaches the next reader to skip the
// line that actually matters.

test('changedLockfiles: composer.json is NOT a lockfile — the manifest changing installs nothing', () => {
  assert.deepStrictEqual(changedLockfiles(['composer.json']), []);
});

test('changedLockfiles: a path merely CONTAINING a lockfile name does not match', () => {
  assert.deepStrictEqual(
    changedLockfiles(['docs/package-lock.json.md', 'composer.lock.bak', 'my-composer.lock.txt']),
    [],
  );
});

test('changedLockfiles: a lockfile name as a DIRECTORY component does not match — the path must END there', () => {
  assert.deepStrictEqual(changedLockfiles(['composer.lock/notes.md']), []);
});

test('changedLockfiles: a filename that merely ends with a lockfile name needs a separator before it', () => {
  // `my-composer.lock` is one file, not a composer lockfile in a directory called `my-`.
  assert.deepStrictEqual(changedLockfiles(['my-composer.lock']), []);
});

// --- changedLockfiles: the degenerate inputs ------------------------------------------------

test('changedLockfiles: empty input is an empty result, not a throw', () => {
  assert.deepStrictEqual(changedLockfiles([]), []);
});

test('changedLockfiles: a non-array (a failed git read handing over null/undefined) answers [] rather than throwing', () => {
  // The call site runs right after a successful push. A throw here would surface as a crash on a
  // ship whose merge already landed — the one outcome this feature must never produce.
  assert.deepStrictEqual(changedLockfiles(null), []);
  assert.deepStrictEqual(changedLockfiles(undefined), []);
  assert.deepStrictEqual(changedLockfiles('composer.lock'), []);
});

test('changedLockfiles: blank lines and non-strings are skipped', () => {
  assert.deepStrictEqual(changedLockfiles(['', '   ', null, 42, 'composer.lock']).map((h) => h.path), ['composer.lock']);
});

test('changedLockfiles: the same path twice reports once', () => {
  assert.strictEqual(changedLockfiles(['composer.lock', 'composer.lock']).length, 1);
});

// --- the table itself -----------------------------------------------------------------------

test('LOCKFILES: every entry is complete, and no install advice is empty', () => {
  assert.ok(LOCKFILES.length > 0);
  for (const lf of LOCKFILES) {
    assert.ok(lf.file && lf.manager && lf.install, `incomplete entry: ${JSON.stringify(lf)}`);
  }
});

test('LOCKFILES: every declared file is actually detected by changedLockfiles', () => {
  // Guards the table and the matcher drifting apart — an entry added with a name the anchored
  // regex cannot match would otherwise sit there looking supported.
  for (const lf of LOCKFILES) {
    assert.strictEqual(changedLockfiles([lf.file]).length, 1, `${lf.file} declared but not matched`);
    assert.strictEqual(changedLockfiles([`sub/dir/${lf.file}`]).length, 1, `${lf.file} not matched when nested`);
  }
});

// --- driftWarning ---------------------------------------------------------------------------

test('driftWarning: no hits produces no warning at all', () => {
  assert.strictEqual(driftWarning([]), null);
  assert.strictEqual(driftWarning(null), null);
});

test('driftWarning: names both the lockfile and the command, and cites the issue', () => {
  const msg = driftWarning(changedLockfiles(['composer.lock']));
  assert.match(msg, /composer\.lock/);
  assert.match(msg, /composer install/);
  // The next session meets this as an unexplained mass deletion; the warning has to connect the
  // two, and has to say it blocks OTHER sessions, not just this one.
  assert.match(msg, /#304/);
  assert.match(msg, /post-ship/);
});

test('driftWarning: reports every hit, not just the first', () => {
  const msg = driftWarning(changedLockfiles(['composer.lock', 'package-lock.json']));
  assert.match(msg, /composer install/);
  assert.match(msg, /npm ci/);
  assert.match(msg, /^2 dependency lockfile/);
});
