'use strict';
/**
 * ci-node's opt-in Migration round-trip (#494).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The block ships COMMENTED between two fences. These tests pin that it stays inert as shipped,
 * that the template's own one-line uncomment yields the job R and the dedupe wiring expect, and
 * what its three passes do — the step's script run against a fake runner, ledger and database
 * in a scratch git repo.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('./yaml');
const mg = require('./migration-grant');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEXT = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'ci-node.yml'), 'utf8');

/** The template's own adoption recipe: `sed '/^  ##>>>/,/^  ##<<</ s/^  # \{0,1\}/  /'`. */
function uncomment(text) {
  let inside = false;
  return text.split('\n').map((l) => {
    if (/^  ##>>>/.test(l)) { inside = true; return l; }
    if (/^  ##<<</.test(l)) { inside = false; return l; }
    return inside ? l.replace(/^  # ?/, '  ') : l;
  }).join('\n');
}

const ADOPTED = uncomment(TEXT);
// The Round-trip step's `run: |` block, by line scan (tools/lib/yaml.js reads no block scalars).
function roundTripScript(text) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^      - name: Round-trip$/.test(l));
  assert.notStrictEqual(at, -1, 'no Round-trip step');
  const run = lines.findIndex((l, i) => i > at && /^        run: \|$/.test(l));
  const out = [];
  for (let i = run + 1; i < lines.length && (/^          /.test(lines[i]) || lines[i].trim() === ''); i++) out.push(lines[i].slice(10));
  return out.join('\n');
}
const SCRIPT = roundTripScript(ADOPTED);
const files = (text) => ({ readFile: (p) => (p === '.github/workflows/ci.yml' ? text : null), workflows: ['ci.yml'] });

test('as shipped: the block is fenced and every line in it is a comment — no job, nothing skipped (#494)', () => {
  const lines = TEXT.split('\n');
  const a = lines.findIndex((l) => /^  ##>>> migration round-trip/.test(l));
  const b = lines.findIndex((l) => /^  ##<<< migration round-trip/.test(l));
  assert.ok(a > 0 && b > a, 'fences present, in order');
  for (const l of lines.slice(a + 1, b)) assert.match(l, /^  #/, l);
  assert.deepStrictEqual(Object.keys(yaml.parse(TEXT).jobs), ['dedupe', 'gitleaks', 'build']);
  assert.deepStrictEqual(mg.roundtripJobWorkflows(files(TEXT)), []);
});

test('adopted: the job R reads, wired after build like ci-laravel (#494)', () => {
  const jobs = yaml.parse(ADOPTED).jobs;
  const m = jobs.migrations;
  assert.ok(m, 'uncommenting yields a migrations job');
  assert.ok(m.name.startsWith(mg.ROUNDTRIP_JOB_PREFIX), m.name);
  assert.strictEqual(m.needs, 'build');
  assert.match(m.if, /!cancelled\(\) && needs\.build\.result == 'success'/);
  assert.strictEqual(jobs.build.outputs['node-version'], '${{ steps.toolchain.outputs.node-version }}');
  assert.deepStrictEqual(mg.roundtripJobWorkflows(files(ADOPTED)), ['ci.yml']);
  assert.strictEqual(m.env.ROUNDTRIP_APPLY, '', 'APPLY ships empty: the adopter names the runner');
  for (const k of ['MIGRATIONS_PATHS', 'ROUNDTRIP_RESET', 'ROUNDTRIP_DUMP', 'ROUNDTRIP_SEED']) assert.ok(k in m.env, k);
  assert.match(ADOPTED, /^          DATABASE_URL: postgres:\/\/postgres:postgres@127\.0\.0\.1:\$\{\{ job\.services\.db\.ports\['5432'\] \}\}\/roundtrip$/m);
  assert.ok(SCRIPT.length > 0, 'the leg has a Round-trip step with a script — R needs a step that ran');
});

// --- the script, against a fake runner ----------------------------------------------------------
// A forward-only runner with a ledger: applies each migrations/*.sql not yet recorded, in name order.
const APPLY = 'for f in $(ls migrations/*.sql | LC_ALL=C sort); do grep -qxF "$(basename "$f")" "$DB/ledger" || { cat "$f" >> "$DB/schema"; basename "$f" >> "$DB/ledger"; }; done';
const APPLY_EVERY_TIME = 'for f in migrations/*.sql; do cat "$f" >> "$DB/schema"; done';
const RESET = 'rm -rf "$DB" && mkdir -p "$DB" && : > "$DB/ledger" && : > "$DB/schema"';
const DUMP = 'printf \'%s\\n\' "\\\\restrict k$RANDOM"; LC_ALL=C sort "$DB/schema"';

function scenario({ base = { '001.sql': 'create a;\n' }, head = { '002.sql': 'create b;\n' }, originRef = true, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-rt-'));
  const g = (...a) => { const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' }); assert.strictEqual(r.status, 0, r.stderr); return r.stdout.trim(); };
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't'); g('config', 'core.hooksPath', '/dev/null');
  fs.mkdirSync(path.join(dir, 'migrations'));
  for (const [f, c] of Object.entries(base)) fs.writeFileSync(path.join(dir, 'migrations', f), c);
  g('add', '-A'); g('commit', '-q', '-m', 'base');
  if (originRef) g('update-ref', 'refs/remotes/origin/main', 'HEAD');
  g('checkout', '-q', '-b', 'feat/x-1');
  for (const [f, c] of Object.entries(head)) fs.writeFileSync(path.join(dir, 'migrations', f), c);
  g('add', '-A'); g('commit', '-q', '-m', 'change');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'node-rt-tmp-'));
  const r = spawnSync('/bin/bash', ['-e', '-c', SCRIPT], {
    cwd: dir, encoding: 'utf8',
    env: {
      PATH: process.env.PATH, RUNNER_TEMP: tmp, DB: path.join(tmp, 'db'), DEFAULT_BRANCH: 'main',
      ROUNDTRIP_APPLY: APPLY, ROUNDTRIP_RESET: RESET, ROUNDTRIP_DUMP: DUMP, ROUNDTRIP_SEED: '', MIGRATIONS_PATHS: 'migrations/',
      ...env,
    },
  });
  const status = g('status', '--porcelain');
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr, status };
}

test('a clean added migration passes all three passes, and the checkout is restored', () => {
  const r = scenario();
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /Round-trip passed/);
  assert.match(r.out, /added +migrations\/002\.sql/);
  assert.strictEqual(r.status, '', 'pass 3 leaves the migrations as committed');
});

test('a non-idempotent apply fails pass 2', () => {
  const r = scenario({ env: { ROUNDTRIP_APPLY: APPLY_EVERY_TIME } });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /::error::Pass 2 \(re-apply\)/);
});

test('editing a migration the base already applies fails pass 3, and the log names it modified', () => {
  const r = scenario({ head: { '001.sql': 'create a2;\n' } });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /modified +migrations\/001\.sql/);
  assert.match(r.out, /::error::Pass 3 \(base, then this change\)/);
});

test('an empty ROUNDTRIP_APPLY fails before any pass — an enabled job never passes R by running nothing', () => {
  const r = scenario({ env: { ROUNDTRIP_APPLY: '' } });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /::error::ROUNDTRIP_APPLY is empty/);
  assert.doesNotMatch(r.out, /Pass /);
});

test('no base ref: pass 3 applies from empty, with a notice', () => {
  const r = scenario({ originRef: false });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /::notice::No base to compare against/);
});

test('the dump normaliser drops pg_dump\'s random \\restrict lines (they differ on every dump)', () => {
  // DUMP above prints a fresh random \restrict key each time; a clean run passing proves it was dropped.
  assert.match(SCRIPT, /grep -vE '\^\\\\\(un\)\?restrict '/);
  assert.strictEqual(scenario().code, 0);
});
