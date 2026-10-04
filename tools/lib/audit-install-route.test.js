'use strict';
/** End to end: the audit's declared-tool install-route check — issue #469.
 *  Run: node --test tools/lib/audit-install-route.test.js */
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AUDIT = path.join(__dirname, '..', '..', 'audit', 'audit.mjs');
const BASE = 'exposure: released\ntrunk: main\nproduction: null\ndeploy: none\nstack: go\nchannels: [artifact]\n';

function audit(extraYml, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-route-'));
  try {
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('init', '-q', '-b', 'main', '.');
    g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
    g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
    fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'project.yml'), BASE + extraYml);
    for (const [p, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), body);
    }
    g('add', '-A'); g('commit', '-q', '-m', 'chore: fixture');
    let out;
    try { out = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { out = e.stdout; }
    return JSON.parse(out).results[0].findings;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const routeHits = (f) => f.filter((x) => /no install route/.test(x.text));
const NO_BIN = { 'package.json': JSON.stringify({ name: 'x', private: true }) };

test('declared compiled, no route anywhere → exactly one advisory', () => {
  const hits = routeHits(audit('distribution: compiled\n', NO_BIN));
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].level, 'warn');
  assert.match(hits[0].text, /visibility could not be read/);
});

test('the same repository, undeclared → silent', () => {
  assert.strictEqual(routeHits(audit('', NO_BIN)).length, 0);
});

test('an unknown value is a hard failure', () => {
  const f = audit('distribution: tool\n', NO_BIN);
  const bad = f.filter((x) => /distribution is "tool", expected "js" or "compiled"/.test(x.text));
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].level, 'fail');
  assert.strictEqual(routeHits(f).length, 0);
});

test('declared js with a root bin → silent', () => {
  const f = audit('distribution: js\n', { 'package.json': JSON.stringify({ name: 'x', private: true, bin: 'cli.js' }) });
  assert.strictEqual(routeHits(f).length, 0);
});
