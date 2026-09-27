'use strict';
/**
 * Unit tests for tools/lib/migration-paths.js (#383) — every exported rule, no I/O — plus
 * release-cut's schemaVerdict reading the same rule.
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const mp = require('./migration-paths');
const rc = require('./release-cut');

test('parseMigrationPaths: absent / null → defaults only, nothing declared', () => {
  for (const doc of [{}, null, undefined, { migrations: null }]) {
    const r = mp.parseMigrationPaths(doc);
    assert.strictEqual(r.declared, false);
    assert.deepStrictEqual(r.paths, []);
    assert.deepStrictEqual(r.problems, []);
  }
});

test('parseMigrationPaths: a list is normalised to repo-relative prefixes ending in /', () => {
  const r = mp.parseMigrationPaths({ migrations: ['backend/migrations', './svc/db/migrations/', 'a//b/'] });
  assert.deepStrictEqual(r.paths, ['backend/migrations/', 'svc/db/migrations/', 'a/b/']);
  assert.deepStrictEqual(r.problems, []);
});

test('parseMigrationPaths: invalid entries are problems, never guessed into a prefix', () => {
  const r = mp.parseMigrationPaths({ migrations: ['/abs/migrations/', '../up/', 'db/*/migrations/', '', '.', 7, 'ok/'] });
  assert.deepStrictEqual(r.paths, ['ok/']);
  assert.strictEqual(r.problems.length, 6, r.problems.join('\n'));
  assert.match(r.problems.join('\n'), /absolute/);
  assert.match(r.problems.join('\n'), /climbs out/);
  assert.match(r.problems.join('\n'), /glob/);
  assert.match(r.problems.join('\n'), /repo root/);
});

test('parseMigrationPaths: a bare string is still READ (stricter gate) but reported as the wrong shape', () => {
  const r = mp.parseMigrationPaths({ migrations: 'backend/migrations/' });
  assert.deepStrictEqual(r.paths, ['backend/migrations/']);
  assert.match(r.problems[0], /bare string/);
});

test('parseMigrationPaths: a non-list non-string fails, and falls back to the defaults', () => {
  const r = mp.parseMigrationPaths({ migrations: true });
  assert.deepStrictEqual(r.paths, []);
  assert.strictEqual(r.problems.length, 1);
});

test('parseMigrationPaths: redundancy is a note, not a problem', () => {
  const r = mp.parseMigrationPaths({ migrations: ['database/migrations/', 'x/', 'x'] });
  assert.deepStrictEqual(r.paths, ['x/']);
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(r.notes.length, 2);
  assert.strictEqual(mp.parseMigrationPaths({ migrations: [] }).notes.length, 1);
});

test('isMigrationPath: the defaults match anywhere in the path — exactly as before #383', () => {
  assert.ok(mp.isMigrationPath('database/migrations/2026_x.php'));
  assert.ok(mp.isMigrationPath('api/database/migrations/2026_x.php'));
  assert.ok(mp.isMigrationPath('prisma/migrations/2026/migration.sql'));
  assert.ok(!mp.isMigrationPath('backend/migrations/013-x.mjs'));
  assert.ok(!mp.isMigrationPath('mydatabase/migrations/x.php'), 'a segment boundary, not a substring');
  assert.ok(!mp.isMigrationPath('database/migrations.md'));
});

test('isMigrationPath: a declared prefix matches from the repo root only', () => {
  const d = ['backend/migrations/'];
  assert.ok(mp.isMigrationPath('backend/migrations/013-x.mjs', d));
  assert.ok(mp.isMigrationPath('backend/migrations/sub/x.sql', d));
  assert.ok(!mp.isMigrationPath('other/backend/migrations/x.mjs', d));
  assert.ok(!mp.isMigrationPath('backend/migrations-old/x.mjs', d), 'the trailing / is what keeps a prefix a directory');
  assert.ok(mp.isMigrationPath('database/migrations/x.php', d), 'declaring never drops the defaults');
});

test('unionPaths: every doc contributes; a doc that drops a declaration cannot remove another\'s', () => {
  assert.deepStrictEqual(mp.unionPaths({ migrations: ['a/'] }, {}, { migrations: ['b/', 'a/'] }), ['a/', 'b/']);
  assert.deepStrictEqual(mp.unionPaths({}, null), []);
});

test('undeclaredMigrationDirs: reports an uncovered */migrations/ dir once, outermost, sorted', () => {
  const files = [
    'backend/migrations/001.mjs', 'backend/migrations/002.mjs',
    'migrations/0001.sql',
    'database/migrations/x.php',
    'node_modules/pkg/migrations/1.js', 'vendor/lib/migrations/1.php',
    'src/migrations', // a FILE named migrations is not a layout
  ];
  assert.deepStrictEqual(mp.undeclaredMigrationDirs(files, []), ['backend/migrations/', 'migrations/']);
  assert.deepStrictEqual(mp.undeclaredMigrationDirs(files, ['backend/migrations/']), ['migrations/']);
  assert.deepStrictEqual(mp.undeclaredMigrationDirs(files, ['backend/migrations/', 'migrations/']), []);
  assert.deepStrictEqual(mp.undeclaredMigrationDirs(['svc/db/migrations/1.sql'], ['svc/']), [], 'covered by a wider declared prefix');
});

// ---- release-cut's schema-additive check reads the same rule ------------------------------------

test('schemaVerdict: with nothing declared, a backend/migrations file is invisible — today\'s behaviour, unchanged', () => {
  const v = rc.schemaVerdict([{ status: 'A', path: 'backend/migrations/013.sql', content: 'DROP TABLE users;' }], 'v1');
  assert.strictEqual(v.ok, true);
  assert.match(v.detail, /no migration file changed/);
});

test('schemaVerdict: a declared .sql migration is read by the destructive heuristic', () => {
  const d = ['backend/migrations/'];
  const bad = rc.schemaVerdict([{ status: 'A', path: 'backend/migrations/013.sql', content: 'DROP TABLE users;' }], 'v1', d);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.detail, /DROP TABLE/);
  const edited = rc.schemaVerdict([{ status: 'M', path: 'backend/migrations/001.sql' }], 'v1', d);
  assert.strictEqual(edited.ok, false);
});

test('schemaVerdict: a declared migration in an unread format is NAMED, never folded into "none destructive"', () => {
  const d = ['backend/migrations/'];
  const v = rc.schemaVerdict([{ status: 'A', path: 'backend/migrations/013-backfill.mjs', content: 'x' }], 'v1', d);
  assert.strictEqual(v.ok, true);
  assert.match(v.detail, /format this check does not read — a human reads them: backend\/migrations\/013-backfill\.mjs/);
  // Under the defaults alone a non-php/sql file (Prisma's lock file) stays silent, as before.
  const lock = rc.schemaVerdict([{ status: 'A', path: 'prisma/migrations/migration_lock.toml', content: 'x' }], 'v1', d);
  assert.doesNotMatch(lock.detail, /does not read — a human/);
});
