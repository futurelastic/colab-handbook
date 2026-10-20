'use strict';
/**
 * `colab template … --roundtrip` (#625): the Migration round-trip job written live at copy, so a
 * repo under `migration-grant: reviewer` has it from the commit that creates its CI.
 *
 * Run: `node --test tools/lib/*.test.js`.
 *
 * The pure module first (tools/lib/template-roundtrip.js), then the real CLI against a scratch repo
 * with an isolated COLAB_HOME — the only way the cmdTemplate wiring is exercised.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('./yaml');
const mg = require('./migration-grant');
const rt = require('./template-roundtrip');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const tpl = (n) => fs.readFileSync(path.join(REPO_ROOT, 'templates', `${n}.yml`), 'utf8');
const files = (text) => ({ readFile: () => text, workflows: ['ci.yml'] });

// --- the pure module ------------------------------------------------------------------------------

test('enableRoundtrip: every fence opened, the job live, APPLY and paths filled (#625)', () => {
  for (const n of ['ci-node', 'ci-python']) {
    const r = rt.enableRoundtrip(tpl(n), { apply: "knex migrate:latest --env 'ci'", paths: ['db/migrations/', 'more/'] });
    assert.deepStrictEqual(r.missed, [], n);
    assert.match(r.changes[0], /uncommented 4 fenced blocks/);
    const doc = yaml.parse(r.text);
    assert.ok(doc.jobs.migrations, `${n}: no migrations job`);
    assert.deepStrictEqual(mg.roundtripJobWorkflows(files(r.text)), ['ci.yml']);
    // YAML single quotes: an inner ' doubles (tools/lib/yaml.js keeps the raw text between the outer quotes).
    assert.match(r.text, /^  ROUNDTRIP_APPLY: 'knex migrate:latest --env ''ci'''$/m);
    assert.match(r.text, /^      MIGRATIONS_PATHS: 'db\/migrations\/ more\/'$/m);
  }
});

test('enableRoundtrip with no APPLY leaves it empty — the job is skipped, never a green no-op (#625)', () => {
  const r = rt.enableRoundtrip(tpl('ci-node'), {});
  assert.deepStrictEqual(r.missed, []);
  assert.ok(!r.changes.includes('ROUNDTRIP_APPLY'));
  const doc = yaml.parse(r.text);
  assert.strictEqual(doc.env.ROUNDTRIP_APPLY, '');
  assert.match(doc.jobs.migrations.if, /needs\.build\.outputs\.roundtrip == 'on'/);
  assert.match(r.text, /^      MIGRATIONS_PATHS: "migrations\/"$/m, 'no declared paths: the template default stays');
});

test('enableRoundtrip touches nothing outside the round-trip fences', () => {
  const src = tpl('ci-python');
  const out = rt.enableRoundtrip(src, {}).text;
  const strip = (t) => {
    let inside = false;
    return t.split('\n').filter((l) => {
      if (rt.FENCE_OPEN.test(l)) { inside = true; return false; }
      if (rt.FENCE_CLOSE.test(l)) { inside = false; return false; }
      return !inside;
    }).join('\n');
  };
  assert.strictEqual(strip(out), strip(src));
});

test('enableRoundtrip refuses a multi-line APPLY, and reports a template with no fences as missed', () => {
  assert.throws(() => rt.enableRoundtrip(tpl('ci-node'), { apply: 'a\nb' }), /one line/);
  const r = rt.enableRoundtrip('name: CI\n', {});
  assert.deepStrictEqual(r.missed, ['round-trip block']);
  assert.strictEqual(r.text, 'name: CI\n');
});

test('refusal: heavy lanes refused (R reads the shipped head), laravel always on, node/python allowed', () => {
  for (const n of ['ci-node-heavy', 'ci-python-heavy', 'ci-laravel-heavy']) assert.match(rt.refusal(n, tpl(n)), /heavy lane/, n);
  for (const n of ['ci-node', 'ci-python', 'ci-laravel']) assert.strictEqual(rt.refusal(n, tpl(n)), null, n);
  assert.match(rt.refusal('docs-lint', tpl('docs-lint')), /no Migration round-trip block/);
});

// --- the real CLI ---------------------------------------------------------------------------------

function scratch(descriptor, { machinePolicy } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-rt-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-rt-home-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), descriptor);
  if (machinePolicy) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ policy: { 'migration-grant': { value: machinePolicy } } }));
  const run = (...args) => spawnSync(process.execPath, [COLAB, 'template', ...args],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', COLAB_HOME: home } });
  const read = (rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const done = () => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); };
  return { dir, run, read, done };
}
const REVIEWER = 'trunk: main\nexposure: none\nmigration-grant: reviewer\nmigrations: [db/migrations/]\n';
const WARN = /migration-grant resolves to reviewer here .*no workflow has a "Migration round-trip" job/;

test('colab template ci-node under reviewer, no --roundtrip: copies, and names the missing job (#625)', () => {
  const s = scratch(REVIEWER);
  try {
    const r = s.run('ci-node', '--dest', '.github/workflows/ci.yml');
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, WARN);
    assert.match(r.stdout, /--roundtrip/);
  } finally { s.done(); }
});

test('colab template ci-node --roundtrip: the job is live in the copy, MIGRATIONS_PATHS from project.yml, skipped until APPLY (#625)', () => {
  const s = scratch(REVIEWER);
  try {
    const r = s.run('ci-node', '--dest', '.github/workflows/ci.yml', '--roundtrip');
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.doesNotMatch(r.stdout, WARN);
    assert.match(r.stdout, /round-trip: wrote the "Migration round-trip" job live/);
    assert.match(r.stdout, /ROUNDTRIP_APPLY is empty, so the job is SKIPPED/);
    const copy = s.read('.github/workflows/ci.yml');
    assert.match(copy, /^# colab-handbook: ci-node @ /, 'still stamped');
    assert.deepStrictEqual(mg.roundtripJobWorkflows({ readFile: () => copy, workflows: ['ci.yml'] }), ['ci.yml']);
    assert.match(copy, /^      MIGRATIONS_PATHS: 'db\/migrations\/'$/m);
    assert.strictEqual(yaml.parse(copy).env.ROUNDTRIP_APPLY, '');
  } finally { s.done(); }
});

test('colab template ci-python --roundtrip-apply: implies --roundtrip and writes the command (#625)', () => {
  const s = scratch(REVIEWER);
  try {
    const r = s.run('ci-python', '--dest', '.github/workflows/ci.yml', '--roundtrip-apply', 'alembic upgrade head');
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    assert.doesNotMatch(r.stdout, /SKIPPED/);
    assert.match(s.read('.github/workflows/ci.yml'), /^  ROUNDTRIP_APPLY: 'alembic upgrade head'$/m);
  } finally { s.done(); }
});

test('colab template ci-node-heavy --roundtrip: refused, nothing written (#625)', () => {
  const s = scratch(REVIEWER);
  try {
    const r = s.run('ci-node-heavy', '--roundtrip');
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /heavy lane/);
    assert.ok(!fs.existsSync(path.join(s.dir, '.github', 'workflows', 'ci-node-heavy.yml')));
  } finally { s.done(); }
});

test('the reviewer warning follows the RESOLVED policy: machine-level reviewer warns, human does not, a repo opt-out wins (#625, #598)', () => {
  const cases = [
    ['trunk: main\nexposure: none\n', 'reviewer', true],
    ['trunk: main\nexposure: none\n', null, false],
    ['trunk: main\nexposure: none\nmigration-grant: human\n', 'reviewer', false],
  ];
  for (const [desc, machine, warns] of cases) {
    const s = scratch(desc, { machinePolicy: machine });
    try {
      const r = s.run('ci-node', '--dest', '.github/workflows/ci.yml');
      assert.strictEqual(r.status, 0, r.stderr + r.stdout);
      assert.strictEqual(WARN.test(r.stdout), warns, `${JSON.stringify(desc)} machine=${machine}: ${r.stdout}`);
    } finally { s.done(); }
  }
});

test('a repo whose other workflow already carries the job gets no warning; ci-laravel needs no flag (#625)', () => {
  const s = scratch(REVIEWER);
  try {
    fs.writeFileSync(path.join(s.dir, '.github', 'workflows', 'migrate.yml'),
      'name: M\non:\n  push:\njobs:\n  m:\n    name: Migration round-trip (pg)\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n');
    const r = s.run('ci-node', '--dest', '.github/workflows/ci.yml');
    assert.doesNotMatch(r.stdout, WARN);
    const l = s.run('ci-laravel', '--dest', '.github/workflows/l.yml', '--roundtrip');
    assert.strictEqual(l.status, 0, l.stderr + l.stdout);
    assert.match(l.stdout, /always on — nothing to enable/);
  } finally { s.done(); }
});
