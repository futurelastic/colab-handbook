'use strict';
/**
 * templates/ci-laravel.yml's `migrations` job — the migration round-trip (#399).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * actionlint checks the job's schema. It cannot check the properties that make the job worth
 * having, each of which a tidy-looking edit could silently remove:
 *
 *   - the seed sits BETWEEN the rollback and the second migrate. Seeded after the new
 *     migrations, the rows must already satisfy them, so the old-shaped rows that trip the
 *     data traps cannot be written at all (measured while building this job: an old-shape
 *     insert simply failed the seed step; with the seed moved, a `->change()` dropping
 *     `nullable` went red on both engines at the second migrate);
 *   - the seed is skipped when the change adds or modifies no migrations (the rollback then
 *     empties the schema, so there is nothing to seed into);
 *   - MODIFIED migrations count, not only added ones (#507): a branch that only repairs an
 *     existing down() got a green round-trip that never ran it, because the step counted
 *     `--diff-filter=A`. The rollback reaches the OLDEST touched migration — exercised below
 *     by running the step's own shell against a scratch git repo;
 *   - the job is not gated on RUN_TESTS — it has to run on the branch, before the merge;
 *   - the matrix carries a sqlite row with no service container AND a server-engine row: the
 *     engines disagree (NOT NULL without default: sqlite refuses, MariaDB fills ''), so one
 *     leg alone passes a migration the other refuses;
 *   - the service port is never fixed on the host (README, "Self-hosted patterns").
 *
 * No YAML dependency here, same as ci-template-triggers.test.js: the job is sliced out as text.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const TEXT = fs.readFileSync(path.resolve(__dirname, '..', '..', 'templates', 'ci-laravel.yml'), 'utf8');

// The `migrations:` job's lines: from its 2-space-indented key to the next job key or EOF.
function jobBlock(text, name) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l === `  ${name}:`);
  if (at === -1) return null;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^ {2}[a-z][\w-]*:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(at, end);
}

// Each step as { name, if, body } — a step starts at a `      - ` line.
function stepsOf(block) {
  const steps = [];
  let cur = null;
  for (const l of block) {
    if (/^ {6}- /.test(l)) { cur = { name: null, if: null, body: [] }; steps.push(cur); }
    if (!cur) continue;
    cur.body.push(l);
    const n = l.match(/^ {6}(?:- | {2})name:\s*(.*)$/);
    if (n && cur.name === null) cur.name = n[1].trim();
    const c = l.match(/^ {8}if:\s*(.*)$/);
    if (c) cur.if = c[1].trim();
  }
  return steps;
}

const block = jobBlock(TEXT, 'migrations');
const steps = block ? stepsOf(block) : [];
const find = (re) => steps.findIndex((s) => s.name && re.test(s.name));

test('ci-laravel.yml has a migrations job', () => {
  assert.ok(block, 'jobs.migrations exists');
});

test('the job is not gated on RUN_TESTS (runs on every branch push)', () => {
  // A job-level if: is allowed — #418's `!cancelled() && needs.build.result == 'success'` is
  // what keeps this job running when the `dedupe` guard is skipped — but never on RUN_TESTS.
  const jobIf = block.find((l) => /^ {4}if:/.test(l));
  assert.ok(!/RUN_TESTS/.test(jobIf || ''), `job-level if: is not gated on RUN_TESTS (${jobIf})`);
  for (const s of steps) {
    assert.ok(!/RUN_TESTS/.test(s.if || ''), `step "${s.name}" is not gated on RUN_TESTS`);
  }
});

test('order: migrate -> rollback -> seed -> migrate -> compare', () => {
  const up1 = find(/^1\. migrate/);
  const down = find(/^2\. roll back/);
  const seed = find(/^3\. seed/);
  const up2 = find(/^4\. migrate again/);
  const cmp = find(/^5\./);
  for (const [k, v] of Object.entries({ up1, down, seed, up2, cmp })) assert.ok(v >= 0, `${k} step present`);
  assert.ok(up1 < down && down < seed && seed < up2 && up2 < cmp, 'seed sits between the rollback and the second migrate');
  assert.match(steps[down].body.join('\n'), /rollback-steps\.php/);
  assert.match(steps[down].body.join('\n'), /migrate:rollback --step="\$steps"/);
  assert.match(steps[up2].body.join('\n'), /schema-b\.json/);
  assert.match(steps[up1].body.join('\n'), /schema-a\.json/);
  assert.match(steps[cmp].body.join('\n'), /diff -u "\$RUNNER_TEMP\/schema-a\.json" "\$RUNNER_TEMP\/schema-b\.json"/);
});

test('seed runs only when a seeder is set AND the change touches migrations', () => {
  const seed = steps[find(/^3\. seed/)];
  assert.strictEqual(seed.if, "env.ROUNDTRIP_SEEDER != '' && env.ROUNDTRIP_FROM != ''");
});

test('the rollback depth is read from the migrations table, at or after ROUNDTRIP_FROM', () => {
  const text = block.join('\n');
  assert.match(text, /rollback-steps\.php" <<'PHP'/);
  assert.match(text, /->where\('migration', '>=', getenv\('ROUNDTRIP_FROM'\)\)->count\(\)/);
});

// The find step's `run: |` body, dedented — the exact shell CI runs.
function findStepScript() {
  const s = steps[find(/^Find the migrations this change adds or modifies/)];
  assert.ok(s, 'find step present');
  const at = s.body.findIndex((l) => /^ {8}run: \|\s*$/.test(l));
  return s.body.slice(at + 1).map((l) => l.replace(/^ {10}/, '')).join('\n');
}

test('added AND modified migrations are found; the oldest touched one is where the rollback stops (#507)', (t) => {
  const script = findStepScript();
  assert.doesNotMatch(script, /--diff-filter=A /, 'not added-only');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-laravel-rt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const mig = path.join(repo, 'database', 'migrations');
  fs.mkdirSync(mig, { recursive: true });
  fs.mkdirSync(path.join(repo, '.github'));
  fs.writeFileSync(path.join(repo, '.github', 'project.yml'), 'trunk: main\n');
  fs.writeFileSync(path.join(dir, 'step.sh'), script);
  const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo, stdio: 'pipe' }).toString();
  for (const n of ['2024_01_01_000000_a', '2024_02_01_000000_b', '2024_03_01_000000_c']) {
    fs.writeFileSync(path.join(mig, `${n}.php`), '<?php\n');
  }
  fs.writeFileSync(path.join(mig, 'README.md'), 'x\n');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'init');
  git('clone', '-q', '--bare', '.', path.join(dir, 'origin.git'));
  git('remote', 'add', 'origin', path.join(dir, 'origin.git'));
  git('fetch', '-q', 'origin');
  const run = () => {
    const envFile = path.join(dir, 'env');
    fs.writeFileSync(envFile, '');
    const out = execFileSync('bash', [path.join(dir, 'step.sh')], {
      cwd: repo, stdio: 'pipe',
      env: { ...process.env, GITHUB_ENV: envFile, MIGRATIONS_PATH: 'database/migrations', DEFAULT_BRANCH: 'main', GITHUB_BASE_REF: '' },
    }).toString();
    const from = (fs.readFileSync(envFile, 'utf8').match(/^ROUNDTRIP_FROM=(.*)$/m) || [])[1];
    return { out, from };
  };
  const branch = (name, edit) => { git('checkout', '-q', 'main'); git('checkout', '-qb', name); edit(); git('add', '-A'); git('commit', '-qm', name); return run(); };

  const none = branch('none', () => fs.appendFileSync(path.join(mig, 'README.md'), 'y\n'));
  assert.strictEqual(none.from, '', 'a non-PHP edit touches no migration');

  const modOnly = branch('mod-only', () => fs.appendFileSync(path.join(mig, '2024_02_01_000000_b.php'), '// down() fixed\n'));
  assert.strictEqual(modOnly.from, '2024_02_01_000000_b', 'a modified-only branch still round-trips');
  assert.match(modOnly.out, /modified {2}database\/migrations\/2024_02_01_000000_b\.php/, 'the log names the file');

  const mixed = branch('mixed', () => {
    fs.appendFileSync(path.join(mig, '2024_01_01_000000_a.php'), '// fix\n');
    fs.writeFileSync(path.join(mig, '2024_04_01_000000_d.php'), '<?php\n');
  });
  assert.strictEqual(mixed.from, '2024_01_01_000000_a', 'rolls back past the older modified one, not just the new step');
  assert.match(mixed.out, /1 added, 1 modified/);
  assert.match(mixed.out, /added {5}database\/migrations\/2024_04_01_000000_d\.php/);
});

test('matrix: a sqlite row with no service, and at least one server-engine row', () => {
  const text = block.join('\n');
  const rows = [...text.matchAll(/^ {10}- engine: (\S+)\n((?: {12}.*\n?)*)/gm)].map((m) => ({ engine: m[1], body: m[2] }));
  const sqlite = rows.find((r) => r.engine === 'sqlite');
  assert.ok(sqlite, 'sqlite row');
  assert.match(sqlite.body, /image: ''/, 'sqlite row starts no service container');
  const server = rows.filter((r) => r.engine !== 'sqlite');
  assert.ok(server.length >= 1, 'a deploy-engine row');
  for (const r of server) assert.match(r.body, /image: \S+:\S+/, `${r.engine} row pins an image version`);
  assert.match(text, /image: \$\{\{ matrix\.image \}\}/);
});

test('the service port is published unmapped and read back from job.services', () => {
  const text = block.join('\n');
  assert.match(text, /ports:\n {10}- 3306\n/);
  assert.doesNotMatch(text, /- ["']?\d+:3306/);
  assert.match(text, /job\.services\.db\.ports\['3306'\]/);
});

test('PHP comes from the build job, which exports it', () => {
  assert.match(block.join('\n'), /needs: build/);
  assert.match(block.join('\n'), /needs\.build\.outputs\.php-version/);
  const build = jobBlock(TEXT, 'build').join('\n');
  assert.match(build, /outputs:\n {6}php-version: \$\{\{ steps\.toolchain\.outputs\.php-version \}\}/);
});
