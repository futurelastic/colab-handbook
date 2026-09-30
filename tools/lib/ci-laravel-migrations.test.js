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
 *   - the seed is skipped when the change adds no migrations (the rollback then empties the
 *     schema, so there is nothing to seed into);
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
  const jobIf = block.find((l) => /^ {4}if:/.test(l));
  assert.strictEqual(jobIf, undefined, 'no job-level if:');
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
  assert.match(steps[down].body.join('\n'), /migrate:rollback --step="\$ROLLBACK_STEPS"/);
  assert.match(steps[up2].body.join('\n'), /schema-b\.json/);
  assert.match(steps[up1].body.join('\n'), /schema-a\.json/);
  assert.match(steps[cmp].body.join('\n'), /diff -u "\$RUNNER_TEMP\/schema-a\.json" "\$RUNNER_TEMP\/schema-b\.json"/);
});

test('seed runs only when a seeder is set AND the change adds migrations', () => {
  const seed = steps[find(/^3\. seed/)];
  assert.strictEqual(seed.if, "env.ROUNDTRIP_SEEDER != '' && env.ROLLBACK_STEPS != '0'");
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
