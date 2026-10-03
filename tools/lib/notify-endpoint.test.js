'use strict';
// #414 — notifyUrl is optional, but a machine running a local observer silently loses every pushed
// event when it is unset. These pin the three readers: the pure plan install.sh acts on, the
// read-only status both health checks print, and `colab doctor`'s line end to end.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ne = require('./notify-endpoint');
const check = require('./install-check');

const COLAB = path.resolve(__dirname, '..', 'colab');
const URL_A = 'http://127.0.0.1:9000/api/events';
const URL_B = 'http://127.0.0.1:9001/api/events';

function home(t, declared) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-notify-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  if (declared !== undefined) fs.writeFileSync(path.join(d, ne.ENDPOINT_FILE), declared);
  return d;
}

test('readDeclared: absent file is null; first non-comment line is the URL; junk is reported, not ignored', (t) => {
  assert.strictEqual(ne.readDeclared(home(t)), null);
  assert.strictEqual(ne.readDeclared(home(t, `# written by the observer\n\n${URL_A}\n`)).url, URL_A);
  assert.match(ne.readDeclared(home(t, '# only a comment\n')).invalid, /empty/);
  assert.match(ne.readDeclared(home(t, 'ftp://x\n')).invalid, /not an http\(s\) URL/);
});

test('status: silent ("unset") with no observer — the default stays silence', (t) => {
  const st = ne.status({}, home(t));
  assert.deepStrictEqual(st, { state: 'unset' });
  assert.strictEqual(ne.healthLine(st), null);
});

test('status: unset while an observer declared an endpoint is the outage case, named with its fix', (t) => {
  const st = ne.status({}, home(t, URL_A));
  assert.strictEqual(st.state, 'unset-declared');
  const line = ne.healthLine(st);
  assert.match(line, /^notifyUrl: unset/);
  assert.match(line, /issue\.merged/);
  assert.ok(line.includes(`colab config set notifyUrl ${URL_A}`));
});

test('status: set is quiet unless the declared endpoint disagrees', (t) => {
  assert.strictEqual(ne.healthLine(ne.status({ notifyUrl: URL_A }, home(t, URL_A))), null);
  assert.strictEqual(ne.healthLine(ne.status({ notifyUrl: URL_A }, home(t))), null);
  assert.match(ne.healthLine(ne.status({ notifyUrl: URL_A }, home(t, URL_B))), /differs/);
});

test('plan: an existing value is NEVER overwritten — not by the flag, not by the declared file', (t) => {
  const p = ne.plan({ cfg: { notifyUrl: URL_A }, colabHome: home(t, URL_B), flagUrl: URL_B });
  assert.strictEqual(p.action, 'keep');
  assert.ok(p.lines.some((l) => /NOT applied/.test(l)));
});

test('plan: flag wins over the declared file; declared file seeds without a flag', (t) => {
  const h = home(t, URL_B);
  assert.deepStrictEqual(ne.plan({ cfg: {}, colabHome: h, flagUrl: URL_A }), { action: 'seed', url: URL_A, source: '--notify-url', lines: [] });
  const p = ne.plan({ cfg: {}, colabHome: h });
  assert.strictEqual(p.action, 'seed');
  assert.strictEqual(p.url, URL_B);
});

test('plan: nothing to seed says plainly the key is unset and what it costs', (t) => {
  const p = ne.plan({ cfg: {}, colabHome: home(t) });
  assert.strictEqual(p.action, 'none');
  const text = p.lines.join('\n');
  assert.match(text, /notifyUrl is UNSET/);
  for (const k of ne.PUSH_ONLY_KINDS) assert.ok(text.includes(k), k);
});

test('plan: a non-http flag is an error, never written', (t) => {
  assert.strictEqual(ne.plan({ cfg: {}, colabHome: home(t), flagUrl: 'localhost:9000' }).action, 'error');
});

test('install --check row: absent without an observer, ⚠ when declared and unset, ✓ when set', (t) => {
  assert.deepStrictEqual(check.checkNotify({ colabHome: home(t) }), []);
  const rows = check.checkNotify({ colabHome: home(t, URL_A) });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].severity, check.WARN);
  const h = home(t, URL_A);
  fs.writeFileSync(path.join(h, 'config.json'), JSON.stringify({ notifyUrl: URL_A }));
  assert.strictEqual(check.checkNotify({ colabHome: h })[0].severity, check.OK);
});

function doctor(h) {
  const env = { ...process.env, COLAB_HOME: h };
  return spawnSync(process.execPath, [COLAB, 'doctor'], { encoding: 'utf8', env, cwd: h });
}

test('colab doctor: prints "notifyUrl: unset" only when an observer declared an endpoint', (t) => {
  const quiet = doctor(home(t));
  assert.strictEqual(quiet.status, 0, quiet.stderr);
  assert.doesNotMatch(quiet.stdout, /notifyUrl/);

  const loud = doctor(home(t, URL_A));
  assert.strictEqual(loud.status, 0, loud.stderr);
  assert.match(loud.stdout, /notifyUrl: unset — .*notify-endpoint declares a local observer/);
});

test('seed entry: writes an absent key through state.js, leaves a present one alone', (t) => {
  const h = home(t, URL_A);
  const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'notify-endpoint.js'), 'seed', '--colab-home', h, ...a],
    { encoding: 'utf8', env: { ...process.env, COLAB_HOME: '' } });
  const dry = run('--dry');
  assert.match(dry.stdout, /\[dry\] seed notifyUrl/);
  assert.ok(!fs.existsSync(path.join(h, 'config.json')), '--dry wrote config.json');

  const r = run();
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(h, 'config.json'), 'utf8')).notifyUrl, URL_A);

  const again = run('--url', URL_B);
  assert.match(again.stdout, /NOT applied/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(h, 'config.json'), 'utf8')).notifyUrl, URL_A);
});
