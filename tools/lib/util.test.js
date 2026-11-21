'use strict';
/**
 * Tests for tools/lib/util.js's `humanAge` (#238) — a hold's age rendered self-evidently, never a
 * raw ISO timestamp a reader has to subtract by hand. `colab places` and every refusal that names
 * a hold (tools/lib/place.js's `conflict()`, `holdAge()`) both build on this.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');

const { humanAge } = require('./util.js');

function isoMsAgo(ms) { return new Date(Date.now() - ms).toISOString(); }

test('humanAge: a moment ago reads "just now"', () => {
  assert.strictEqual(humanAge(isoMsAgo(5_000)), 'just now');
});

test('humanAge: under an hour reads in minutes', () => {
  assert.strictEqual(humanAge(isoMsAgo(4 * 60_000)), '4m ago');
  assert.strictEqual(humanAge(isoMsAgo(59 * 60_000)), '59m ago');
});

test('humanAge: under a day reads in hours, not minutes', () => {
  assert.strictEqual(humanAge(isoMsAgo(60 * 60_000)), '1h ago');
  assert.strictEqual(humanAge(isoMsAgo(3 * 3_600_000)), '3h ago');
  assert.strictEqual(humanAge(isoMsAgo(23 * 3_600_000)), '23h ago');
});

test('humanAge: a day or beyond reads in days, not hours — the #238 "records days old" case', () => {
  assert.strictEqual(humanAge(isoMsAgo(24 * 3_600_000)), '1d ago');
  assert.strictEqual(humanAge(isoMsAgo(4 * 24 * 3_600_000)), '4d ago');
});

test('humanAge: a fresh hold and a days-old hold render visibly differently (the #238 complaint, directly)', () => {
  const fresh = humanAge(isoMsAgo(4 * 60_000));
  const stale = humanAge(isoMsAgo(3 * 24 * 3_600_000));
  assert.notStrictEqual(fresh, stale);
});

test('humanAge: an unparseable timestamp degrades to a labelled "unknown", never throws', () => {
  assert.strictEqual(humanAge('not-a-date'), 'age unknown');
  assert.strictEqual(humanAge(undefined), 'age unknown');
});

test('humanAge: clock skew (a "since" in the future) never renders a negative age', () => {
  assert.strictEqual(humanAge(isoMsAgo(-60_000)), 'just now');
});

// --- #479: parseArgs repeat handling ------------------------------------------
{
  const { parseArgs: pa, UserError: UE } = require('./util');

  test('#479 parseArgs: a `lists` flag accumulates across repeats, inline and spaced, like one comma list', () => {
    const o = pa(['--refs', '1', '--refs=2,3', '--refs', '4'], { lists: { '--refs': 'refs' } });
    assert.strictEqual(o.refs, '1,2,3,4');
  });

  test('#479 parseArgs: `once` makes a repeated value flag a usage error naming the flag', () => {
    assert.throws(() => pa(['--branch', 'a', '--branch', 'b'], { values: { '--branch': 'branch' }, once: true }),
      (e) => e instanceof UE && /--branch given more than once/.test(e.message));
  });

  test('#479 parseArgs: without `once`, a repeated value flag keeps the old last-one-wins behaviour', () => {
    assert.strictEqual(pa(['--repo', 'a', '--repo', 'b'], { values: { '--repo': 'repo' } }).repo, 'b');
  });

  test('#479 parseArgs: `once` does not affect `lists` flags or a single use', () => {
    const o = pa(['--refs', '1', '--refs', '2', '--branch', 'x'], { values: { '--branch': 'branch' }, lists: { '--refs': 'refs' }, once: true });
    assert.deepStrictEqual([o.refs, o.branch], ['1,2', 'x']);
  });
}

// --- #763: a value flag never swallows the next option as its value -------------------------
{
  const { parseArgs: pa, UserError: UE } = require('./util');
  const spec = { values: { '--answers': 'answers', '--body-file': 'bodyFile' }, lists: { '--refs': 'refs' }, flags: { '--json': 'json' } };

  test('#763 parseArgs: a value flag followed by another option is a usage error naming both', () => {
    assert.throws(() => pa(['--answers', '--body-file', 'f'], spec),
      (e) => e instanceof UE && /Option --answers needs a value/.test(e.message) && /"--body-file"/.test(e.message) && /--answers=<value>/.test(e.message));
    assert.throws(() => pa(['--answers', '--json'], spec), (e) => e instanceof UE && /--answers needs a value/.test(e.message));
  });

  test('#763 parseArgs: the same refusal applies to a `lists` flag', () => {
    assert.throws(() => pa(['--refs', '--json'], spec), (e) => e instanceof UE && /--refs needs a value/.test(e.message));
  });

  test('#763 parseArgs: a value that starts with -- is still accepted inline', () => {
    assert.strictEqual(pa(['--answers=--odd'], spec).answers, '--odd');
    assert.strictEqual(pa(['--refs=--odd'], spec).refs, '--odd');
  });

  test('#763 parseArgs: a lone `-` and a single-dash value stay ordinary values', () => {
    assert.strictEqual(pa(['--answers', '-'], spec).answers, '-');
    assert.strictEqual(pa(['--answers', '-x', '--body-file', 'f'], spec).answers, '-x');
  });

  test('#763 parseArgs: a value flag at the end of argv keeps its old "needs a value" error', () => {
    assert.throws(() => pa(['--answers'], spec), (e) => e instanceof UE && e.message === 'Option --answers needs a value');
  });
}
