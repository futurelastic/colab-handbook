'use strict';
/** Pure-function tests for tools/lib/hermetic.js (#403). The CLI oracle lives in gate-hermetic-cli.test.js. */

const test = require('node:test');
const assert = require('node:assert');
const h = require('./hermetic');

test('parseLiveEnv: absent → run; none → skip; anything else → invalid AND still run', () => {
  assert.deepStrictEqual([h.parseLiveEnv({}).skip, h.parseLiveEnv({}).valid], [false, true]);
  assert.deepStrictEqual([h.parseLiveEnv(null).skip, h.parseLiveEnv(null).declared], [false, false]);
  assert.strictEqual(h.parseLiveEnv({ 'live-env': null }).declared, false);
  const none = h.parseLiveEnv({ 'live-env': 'none' });
  assert.deepStrictEqual([none.skip, none.valid, none.declared], [true, true, true]);
  for (const bad of ['off', true, false, 'None', ['none']]) {
    const r = h.parseLiveEnv({ 'live-env': bad });
    assert.strictEqual(r.skip, false, `${JSON.stringify(bad)} must not skip`);
    assert.strictEqual(r.valid, false);
  }
});

test('shouldStrip: service addresses, credentials, sockets, proxies and runtimes go; ordinary vars stay', () => {
  for (const k of ['FLEET_URL', 'MY_DAEMON', 'DASHBOARD_BASE', 'GH_TOKEN', 'GITHUB_TOKEN', 'NPM_TOKEN', 'API_KEY',
    'OPENAI_API_KEY', 'AWS_REGION', 'DB_PASSWORD', 'SSH_AUTH_SOCK', 'COLAB_HOME', 'CLAUDECODE', 'CLAUDE_CODE_X',
    'ANTHROPIC_BASE_URL', 'REDIS_HOST', 'APP_PORT', 'https_proxy', 'HTTPS_PROXY', 'ZDOTDIR', 'SOME_ENDPOINT']) {
    assert.strictEqual(h.shouldStrip(k), true, k);
  }
  for (const k of ['HOME', 'PATH', 'LANG', 'TERM', 'TMPDIR', 'USER', 'SHELL', 'CI', 'NODE_ENV', 'GITHUB_ACTIONS', 'GITHUB_SHA']) {
    assert.strictEqual(h.shouldStrip(k), false, k);
  }
});

test('hermeticEnv: fresh HOME, XDG re-pointed, strip listed, --keep passes through and is reported', () => {
  const env = { HOME: '/Users/real', PATH: '/bin', FLEET_URL: 'http://x', GH_TOKEN: 't', XDG_CONFIG_HOME: '/Users/real/.config', LANG: 'C', NODE_TEST_CONTEXT: 'child' };
  const r = h.hermeticEnv(env, '/tmp/fresh', ['GH_TOKEN']);
  assert.strictEqual(r.env.HOME, '/tmp/fresh');
  assert.strictEqual(r.env.XDG_CONFIG_HOME, '/tmp/fresh/.config');
  assert.strictEqual(r.env.PATH, '/bin');
  assert.strictEqual(r.env.LANG, 'C');
  assert.strictEqual(r.env.FLEET_URL, undefined);
  assert.strictEqual(r.env.GH_TOKEN, 't');
  assert.strictEqual(r.env.NODE_TEST_CONTEXT, undefined);
  assert.deepStrictEqual(r.stripped, ['FLEET_URL']);
  assert.deepStrictEqual(r.kept, ['GH_TOKEN']);
  assert.ok(!Object.values(r.env).some((v) => String(v).includes('/Users/real')), 'nothing may still point at the real home');
});

test('normalEnv: only the node test-runner leak is removed (#154)', () => {
  const r = h.normalEnv({ HOME: '/h', FLEET_URL: 'u', NODE_TEST_CONTEXT: 'c', NODE_TEST_WORKER_ID: '1' });
  assert.deepStrictEqual(r, { HOME: '/h', FLEET_URL: 'u' });
});

test('probeNetworkIsolation: each platform, probe success and refusal, and --net on', () => {
  const ok = () => ({ status: 0 });
  const no = () => ({ status: 1 });
  const d = h.probeNetworkIsolation({ platform: 'darwin', run: ok });
  assert.strictEqual(d.isolated, true);
  assert.strictEqual(d.prefix[0], '/usr/bin/sandbox-exec');
  assert.match(d.note, /loopback allowed/);
  const dn = h.probeNetworkIsolation({ platform: 'darwin', run: no });
  assert.deepStrictEqual([dn.isolated, dn.prefix], [false, []]);
  assert.match(dn.note, /NOT isolated/);
  const l = h.probeNetworkIsolation({ platform: 'linux', run: ok });
  assert.strictEqual(l.prefix[0], 'unshare');
  assert.strictEqual(h.probeNetworkIsolation({ platform: 'linux', run: no }).isolated, false);
  assert.match(h.probeNetworkIsolation({ platform: 'win32', run: ok }).note, /no sandbox known/);
  let called = false;
  const on = h.probeNetworkIsolation({ platform: 'darwin', mode: 'on', run: () => { called = true; return { status: 0 }; } });
  assert.deepStrictEqual([on.isolated, called], [false, false]);
});

test('parseFailures: names from TAP, node spec, jest/vitest, pytest, phpunit, go — deduped', () => {
  const out = [
    'ok 1 - fine',
    'not ok 2 - reads home config # TODO-ish',
    'not ok 2 - reads home config',
    '  ✖ talks to daemon (12.5ms)',
    'FAIL src/a.test.ts',
    'FAILED tests/test_x.py::test_y - AssertionError',
    '1) Tests\\FooTest::testBar',
    '--- FAIL: TestThing (0.00s)',
  ].join('\n');
  assert.deepStrictEqual(h.parseFailures(out), [
    'reads home config', 'talks to daemon', 'src/a.test.ts', 'tests/test_x.py::test_y', 'Tests\\FooTest::testBar', 'TestThing',
  ]);
  assert.deepStrictEqual(h.parseFailures(''), []);
  assert.strictEqual(h.parseFailures(Array.from({ length: 50 }, (_, i) => `not ok ${i} - t${i}`).join('\n'), 5).length, 5);
});

test('classify: the four verdicts, and a red normal run outranks everything', () => {
  assert.strictEqual(h.classify({ skipped: false, normalOk: true, hermeticOk: true }), 'green');
  assert.strictEqual(h.classify({ skipped: false, normalOk: true, hermeticOk: false }), 'live-env');
  assert.strictEqual(h.classify({ skipped: true, normalOk: true, hermeticOk: false }), 'skipped');
  assert.strictEqual(h.classify({ skipped: true, normalOk: false, hermeticOk: false }), 'red');
  assert.strictEqual(h.classify({ skipped: false, normalOk: false, hermeticOk: true }), 'red');
});
