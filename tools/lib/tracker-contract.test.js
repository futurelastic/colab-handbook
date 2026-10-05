'use strict';
/**
 * The tracker contract, run as data (#501): every scenario in tools/lib/tracker-scenarios.json
 * against two implementations —
 *   - the in-memory fake (tools/lib/tracker-fake.js), seeded from the scenario's `given`;
 *   - the GitHub adapter (tools/lib/tracker-github.js), with every `gh` spawn answered from the
 *     scenario's recorded transcript in tools/lib/tracker-scenarios.github.json. The transcript is
 *     strict: each spawn must be the next recorded argv, and every recorded reply must be used.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The runner and matcher below implement the rules the scenarios file states in its `match` block;
 * a consumer's runner in another language implements the same rules from that block, not from here.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const tracker = require('./tracker');
const fake = require('./tracker-fake');
const gh = require('./tracker-github');
const SPEC = require('./tracker-scenarios.json');
const RECORDED = require('./tracker-scenarios.github.json');

const REPO = '/repo/under/test';
const ROOT = path.resolve(__dirname, '..', '..');

/** Every way `actual` fails to match `expected`, per the scenarios file's `match` rules. */
function mismatches(actual, expected, at = '$') {
  if (expected === null) return actual === null ? [] : [`${at}: expected null, got ${JSON.stringify(actual)}`];
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${at}: expected an array, got ${JSON.stringify(actual)}`];
    if (actual.length !== expected.length) return [`${at}: expected ${expected.length} element(s), got ${actual.length}: ${JSON.stringify(actual)}`];
    return expected.flatMap((e, i) => mismatches(actual[i], e, `${at}[${i}]`));
  }
  if (typeof expected === 'object') {
    if ('$re' in expected) {
      return typeof actual === 'string' && new RegExp(expected.$re).test(actual) ? [] : [`${at}: ${JSON.stringify(actual)} does not match /${expected.$re}/`];
    }
    if ('$type' in expected) {
      const t = Array.isArray(actual) ? 'array' : actual === null ? 'null' : typeof actual;
      return t === expected.$type ? [] : [`${at}: expected a ${expected.$type}, got ${t}`];
    }
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return [`${at}: expected an object, got ${JSON.stringify(actual)}`];
    return Object.keys(expected).flatMap((k) => (k in actual
      ? mismatches(actual[k], expected[k], `${at}.${k}`)
      : [`${at}.${k}: missing`]));
  }
  return actual === expected ? [] : [`${at}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}

/** Run one scenario's steps against `impl`; return every mismatch, labelled by step. */
function runScenario(impl, scenario) {
  return scenario.steps.flatMap((step, i) => {
    const actual = impl[step.call](...step.args);
    return mismatches(actual, step.expect).map((m) => `${scenario.id} step ${i + 1} (${step.call}): ${m}`);
  });
}

/**
 * A gh runner replaying one recorded transcript. Identity probes are answered from `login` on every
 * call (git.js caches them per process, so whether they spawn at all depends on test order).
 */
function replay(id, login) {
  const tape = RECORDED.scenarios[id].map((e) => ({ ...e }));
  const problems = [];
  let next = 0;
  const reply = (r) => ({ ok: r.ok !== false, code: r.code ?? (r.ok === false ? 1 : 0),
    stdout: String(r.json !== undefined ? JSON.stringify(r.json) : r.stdout ?? '').trim(),
    stderr: String(r.stderr ?? '').trim(), error: null, timedOut: false });
  const IDENTITY = [['--version'], ['auth', 'status', '--active'], ['api', 'user', '-q', '.login']];
  const runner = (args, opts) => {
    if (IDENTITY.some((a) => JSON.stringify(a) === JSON.stringify(args))) {
      return reply(args[0] === 'api' ? { stdout: login } : { stdout: 'ok' });
    }
    const want = tape[next];
    if (!want) { problems.push(`${id}: unrecorded spawn gh ${JSON.stringify(args)}`); return reply({ ok: false, stderr: 'unrecorded' }); }
    if (JSON.stringify(want.argv) !== JSON.stringify(args)) problems.push(`${id}: spawn ${next + 1} was gh ${JSON.stringify(args)}, recorded ${JSON.stringify(want.argv)}`);
    if (!opts || opts.cwd !== REPO) problems.push(`${id}: spawn ${next + 1} ran outside the repo (cwd ${opts && opts.cwd})`);
    next += 1;
    return reply(want);
  };
  const leftover = () => tape.slice(next).map((e) => `${id}: recorded spawn never made: gh ${JSON.stringify(e.argv)}`);
  return { runner, problems, leftover };
}

test('the scenarios file is well-formed: unique ids, every call a contract method', () => {
  assert.strictEqual(SPEC.version, 1);
  assert.ok(SPEC.scenarios.length > 0);
  const names = new Set(tracker.METHODS.map((m) => m.name));
  const ids = new Set();
  for (const s of SPEC.scenarios) {
    assert.ok(!ids.has(s.id), `duplicate scenario id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.description, `${s.id}: no description`);
    for (const step of s.steps) {
      assert.ok(names.has(step.call), `${s.id}: "${step.call}" is not a tracker contract method`);
      assert.ok(Array.isArray(step.args), `${s.id}: ${step.call} args must be an array`);
      assert.ok('expect' in step, `${s.id}: ${step.call} has no expect`);
    }
  }
});

test('every contract method is exercised by at least one scenario', () => {
  const called = new Set(SPEC.scenarios.flatMap((s) => s.steps.map((st) => st.call)));
  const unexercised = tracker.METHODS.map((m) => m.name).filter((n) => !called.has(n));
  assert.deepStrictEqual(unexercised, []);
});

test('the matcher follows the match rules the scenarios file states', () => {
  assert.deepStrictEqual(mismatches(null, null), []);
  assert.strictEqual(mismatches({}, null).length, 1);
  assert.deepStrictEqual(mismatches({ a: 1, extra: 2 }, { a: 1 }), []); // partial objects
  assert.strictEqual(mismatches({}, { a: 1 }).length, 1); // a missing key fails
  assert.strictEqual(mismatches([1, 2], [1]).length, 1); // arrays are length-exact
  assert.deepStrictEqual(mismatches([{ name: 'x', id: 'L' }], [{ name: 'x' }]), []);
  assert.deepStrictEqual(mismatches('https://h/issues/9', { $re: '/issues/9$' }), []);
  assert.strictEqual(mismatches('https://h/issues/19x', { $re: '/issues/9$' }).length, 1);
  assert.deepStrictEqual(mismatches([], { $type: 'array' }), []);
  assert.strictEqual(mismatches([], { $type: 'object' }).length, 1);
  assert.strictEqual(mismatches(0, false).length, 1); // scalars are strict
});

test('the fake implements every method of the contract, and forRepo knows it', () => {
  assert.ok(tracker.assertImplements(fake.create(REPO), 'fake'));
  assert.strictEqual(tracker.forRepo(REPO, { kind: 'fake' }).kind, 'fake');
});

for (const scenario of SPEC.scenarios) {
  test(`fake: ${scenario.id}`, () => {
    assert.deepStrictEqual(runScenario(fake.create(REPO, scenario.given), scenario), []);
  });
}

test('every scenario has a recorded GitHub transcript, and every transcript a scenario', () => {
  const ids = SPEC.scenarios.map((s) => s.id).sort();
  assert.deepStrictEqual(Object.keys(RECORDED.scenarios).sort(), ids);
  // git.js caches the login per process, so the recorded runner can only honour one login.
  const logins = new Set(SPEC.scenarios.map((s) => s.given.login));
  assert.deepStrictEqual([...logins], ['alice'], 'every scenario must run as the same login (see replay)');
});

for (const scenario of SPEC.scenarios) {
  test(`github (recorded): ${scenario.id}`, () => {
    const { runner, problems, leftover } = replay(scenario.id, scenario.given.login);
    const failures = gh.withRunner(runner, () => runScenario(gh.create(REPO), scenario));
    assert.deepStrictEqual([...problems, ...leftover(), ...failures], []);
  });
}

test('a scenario the implementation does not satisfy fails, naming the step', () => {
  const broken = { ...fake.create(REPO, { login: 'alice' }), currentLogin: () => 'mallory' };
  const s = SPEC.scenarios.find((x) => x.id === 'identity');
  assert.deepStrictEqual(runScenario(broken, s), ['identity step 2 (currentLogin): $: expected "alice", got "mallory"']);
});

test('the scenarios ship in the package; the GitHub transcripts and this test do not', async () => {
  // package.json `files` decides what npm packs; scripts/check-pack-allowlist.mjs is the gate that
  // runs the real `npm pack` (smoke + CI). Here: both agree on these four paths.
  const globs = require(path.join(ROOT, 'package.json')).files;
  assert.ok(globs.includes('tools/lib/tracker-scenarios.json'), 'package.json files must list tools/lib/tracker-scenarios.json');
  assert.ok(!globs.some((g) => !g.startsWith('!') && /\*\.json$|tracker-scenarios\.github/.test(g)), 'no glob may sweep in the recorded transcripts');
  const { findStrays } = await import(path.join(ROOT, 'scripts', 'check-pack-allowlist.mjs'));
  const shipped = ['tools/lib/tracker-scenarios.json', 'tools/lib/tracker-fake.js'];
  const kept = ['tools/lib/tracker-scenarios.github.json', 'tools/lib/tracker-contract.test.js'];
  assert.deepStrictEqual(findStrays(shipped, new Set(shipped)), []);
  assert.deepStrictEqual(findStrays(kept, new Set(kept)).map((x) => x.path), kept);
});
