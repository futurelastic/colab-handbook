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
const URL_C = 'http://127.0.0.1:9002/api/events';

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

test('status: set is quiet unless a declared endpoint is missing from it — each missing URL named (#546)', (t) => {
  assert.strictEqual(ne.healthLine(ne.status({ notifyUrl: URL_A }, home(t, URL_A))), null);
  assert.strictEqual(ne.healthLine(ne.status({ notifyUrl: URL_A }, home(t))), null);
  // A configured receiver the file does not declare (a remote observer, say) is a deliberate value — quiet.
  assert.strictEqual(ne.healthLine(ne.status({ notifyUrl: [URL_A, URL_C] }, home(t, URL_A))), null);
  const st = ne.status({ notifyUrl: URL_A }, home(t, `${URL_A}\n${URL_B}\n`));
  assert.deepStrictEqual(st.missing, [URL_B]);
  const lines = ne.healthLines(st);
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^notifyUrl: lacks http:\/\/127\.0\.0\.1:9001/);
  assert.ok(lines[0].includes(`colab config add-notify-url ${URL_B}`));
  // Both missing → one line each, so the operator sees which observer goes without.
  assert.strictEqual(ne.healthLines(ne.status({ notifyUrl: URL_C }, home(t, `${URL_A}\n${URL_B}\n`))).length, 2);
});

test('readDeclared: several observers, one line each; a bad line among good ones is reported, not fatal', (t) => {
  const d = ne.readDeclared(home(t, `# observer one\n${URL_A}\n# observer two\n${URL_B}\n${URL_A}\nnot-a-url\n`));
  assert.deepStrictEqual(d.urls, [URL_A, URL_B]);
  assert.strictEqual(d.url, URL_A);
  assert.deepStrictEqual(d.bad, ['not-a-url']);
  assert.strictEqual(d.invalid, undefined);
  const lines = ne.healthLines(ne.status({ notifyUrl: [URL_A, URL_B] }, home(t, `${URL_A}\n${URL_B}\nnot-a-url\n`)));
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /not an http\(s\) URL — ignored: not-a-url/);
});

test('status: unset with two declared observers names both, with an add per URL', (t) => {
  const line = ne.healthLine(ne.status({}, home(t, `${URL_A}\n${URL_B}\n`)));
  assert.match(line, /declares 2 local observers/);
  assert.ok(line.includes(`colab config add-notify-url ${URL_A} && colab config add-notify-url ${URL_B}`));
});

test('plan: an existing entry is NEVER removed or rewritten — the flag and the file only ADD (#546)', (t) => {
  const p = ne.plan({ cfg: { notifyUrl: URL_A }, colabHome: home(t, URL_B), flagUrl: URL_C });
  assert.strictEqual(p.action, 'seed');
  assert.deepStrictEqual(p.add.map((a) => a.url), [URL_C, URL_B]);
  assert.deepStrictEqual(ne.merged({ notifyUrl: URL_A }, p.add), [URL_A, URL_C, URL_B]);
  // Everything already there → keep, untouched.
  const k = ne.plan({ cfg: { notifyUrl: [URL_B, URL_A] }, colabHome: home(t, URL_A), flagUrl: URL_B });
  assert.strictEqual(k.action, 'keep');
  assert.match(k.lines[0], /already set → left untouched/);
});

test('plan: two declared lines seed into an existing one-entry list without touching it (#546)', (t) => {
  const p = ne.plan({ cfg: { notifyUrl: [URL_A] }, colabHome: home(t, `${URL_A}\n${URL_B}\n`) });
  assert.strictEqual(p.action, 'seed');
  assert.deepStrictEqual(p.add.map((a) => a.url), [URL_B]);
  assert.deepStrictEqual(ne.merged({ notifyUrl: [URL_A] }, p.add), [URL_A, URL_B]);
});

test('plan: flag and declared file both seed an absent key; one source seeds a plain string', (t) => {
  const h = home(t, URL_B);
  const p = ne.plan({ cfg: {}, colabHome: h, flagUrl: URL_A });
  assert.deepStrictEqual(p, { action: 'seed', add: [{ url: URL_A, source: '--notify-url' }, { url: URL_B, source: path.join(h, ne.ENDPOINT_FILE) }], lines: [] });
  const one = ne.plan({ cfg: {}, colabHome: h });
  assert.deepStrictEqual(one.add.map((a) => a.url), [URL_B]);
  assert.strictEqual(ne.merged({}, one.add), URL_B, 'one URL is stored exactly as before the list form');
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
  // Two declared observers, the key holding one → one ⚠ row naming the missing URL (#546).
  const h2 = home(t, `${URL_A}\n${URL_B}\n`);
  fs.writeFileSync(path.join(h2, 'config.json'), JSON.stringify({ notifyUrl: URL_A }));
  const r2 = check.checkNotify({ colabHome: h2 });
  assert.strictEqual(r2.length, 1);
  assert.strictEqual(r2[0].severity, check.WARN);
  assert.ok(r2[0].text.includes(URL_B));
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

  // #546: the key set, a second observer declared → doctor names the URL the key lacks.
  const h = home(t, `${URL_A}\n${URL_B}\n`);
  fs.writeFileSync(path.join(h, 'config.json'), JSON.stringify({ notifyUrl: URL_A }));
  const lacks = doctor(h);
  assert.strictEqual(lacks.status, 0, lacks.stderr);
  assert.ok(lacks.stdout.includes(`notifyUrl: lacks ${URL_B}`), lacks.stdout);
  assert.ok(!lacks.stdout.includes(`lacks ${URL_A}`));
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

  // Re-run with nothing new: on-disk state unchanged, still a plain string (#546 ask 4).
  const same = run();
  assert.match(same.stdout, /already set → left untouched/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(h, 'config.json'), 'utf8')).notifyUrl, URL_A);

  // A second observer declares its own line → ADDED; the first entry stays first and untouched.
  fs.writeFileSync(path.join(h, ne.ENDPOINT_FILE), `${URL_A}\n${URL_B}\n`);
  const added = run();
  assert.strictEqual(added.status, 0, added.stderr);
  assert.match(added.stdout, /added http:\/\/127\.0\.0\.1:9001.*existing entries left untouched/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(h, 'config.json'), 'utf8')).notifyUrl, [URL_A, URL_B]);
});

test('colab config add-notify-url / rm-notify-url change one entry; one URL stays a string', (t) => {
  const h = home(t);
  const cfgOf = () => JSON.parse(fs.readFileSync(path.join(h, 'config.json'), 'utf8')).notifyUrl;
  const c = (...a) => spawnSync(process.execPath, [COLAB, 'config', ...a], { encoding: 'utf8', env: { ...process.env, COLAB_HOME: h }, cwd: h });
  assert.strictEqual(c('set', 'notifyUrl', URL_A).status, 0);
  assert.strictEqual(cfgOf(), URL_A);
  assert.strictEqual(c('add-notify-url', URL_B).status, 0);
  assert.deepStrictEqual(cfgOf(), [URL_A, URL_B]);
  assert.strictEqual(c('add-notify-url', URL_B).status, 0, 'adding a present URL is a no-op, not an error');
  assert.deepStrictEqual(cfgOf(), [URL_A, URL_B]);
  assert.notStrictEqual(c('add-notify-url', 'ftp://x').status, 0);
  assert.strictEqual(c('rm-notify-url', URL_A).status, 0);
  assert.strictEqual(cfgOf(), URL_B, 'back to one entry → stored as a plain string again');
  assert.notStrictEqual(c('rm-notify-url', URL_A).status, 0, 'removing an absent entry says so');
  assert.strictEqual(c('rm-notify-url', URL_B).status, 0);
  assert.strictEqual(cfgOf(), undefined, 'removing the last entry unsets the key');
});
