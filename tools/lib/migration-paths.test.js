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

test('schemaVerdict: with nothing declared, a backend/migrations file is invisible — a ✓ only where a default layout exists', () => {
  const change = [{ status: 'A', path: 'backend/migrations/013.sql', content: 'DROP TABLE users;' }];
  // A caller that does not measure the layout (undefined), or a tree that has one: unchanged.
  for (const layout of [undefined, true]) {
    const v = rc.schemaVerdict(change, 'v1', [], layout);
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.checked, undefined, 'a real pass carries no checked field');
    assert.match(v.detail, /no migration file changed/);
  }
  // #670: no default layout and nothing declared — nothing was read, so NOT CHECKED, never a ✓.
  // It refuses nothing (ok stays true) and says how to declare the directory.
  const none = rc.schemaVerdict(change, 'v1', [], false);
  assert.strictEqual(none.ok, true);
  assert.strictEqual(none.checked, false);
  assert.match(none.detail, /^not checked — no Laravel database\/migrations\/ or Prisma prisma\/migrations\/ directory/);
  assert.match(none.detail, /`migrations:` in \.github\/project\.yml/);
  assert.doesNotMatch(none.detail, /no migration file changed/);
  // An unread tree is not an absent layout — also not checked, and says it could not read.
  const unread = rc.schemaVerdict(change, 'v1', undefined, null);
  assert.strictEqual(unread.checked, false);
  assert.match(unread.detail, /could not be read/);
  // A declared path is a layout: with nothing changed under it, a real ✓ even if no default exists.
  const declared = rc.schemaVerdict([], 'v1', ['backend/migrations/'], false);
  assert.strictEqual(declared.checked, undefined);
  assert.match(declared.detail, /no migration file changed/);
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
  // #670: named AND not checked — passes (refuses nothing), never a ✓.
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.checked, false);
  assert.match(v.detail, /^not checked — 1 declared migration file\(s\) changed since v1 in a format this check does not read \(php\/sql only\) — a human reads them before the final: backend\/migrations\/013-backfill\.mjs/);
  // Beside a read, additive .sql: still not checked — part of the release was not read.
  const mixed = rc.schemaVerdict([
    { status: 'A', path: 'backend/migrations/014.sql', content: 'CREATE TABLE t (id int);' },
    { status: 'A', path: 'backend/migrations/015.mjs', content: 'x' },
  ], 'v1', d);
  assert.strictEqual(mixed.ok, true);
  assert.strictEqual(mixed.checked, false);
  assert.match(mixed.detail, /1 migration file\(s\) added since v1, none destructive — but 1 declared migration file\(s\).*015\.mjs/);
  // Beside a destructive read file: ✗, as before — not checked never softens a finding.
  const bad = rc.schemaVerdict([
    { status: 'A', path: 'backend/migrations/016.sql', content: 'DROP TABLE users;' },
    { status: 'A', path: 'backend/migrations/017.mjs', content: 'x' },
  ], 'v1', d);
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.checked, undefined);
  // Under the defaults alone a non-php/sql file (Prisma's lock file) stays silent, as before.
  const lock = rc.schemaVerdict([{ status: 'A', path: 'prisma/migrations/migration_lock.toml', content: 'x' }], 'v1', d);
  assert.doesNotMatch(lock.detail, /does not read — a human/);
});
