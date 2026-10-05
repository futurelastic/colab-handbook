'use strict';
/**
 * #508 — a reviewer migration grant binds the reviewed migration CONTENT, not the HEAD. These tests
 * run the id against a real git repository: the shape that voided every grant in the field was a
 * merge-of-trunk sync (ship's stale-base rule) that left the migration files byte-identical.
 *
 * Run: `node --test tools/lib/migration-grant-content.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const mg = require('./migration-grant.js');

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-content-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
  const write = (f, body) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); };
  g('init', '-q', '-b', 'main');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  write('README.md', 'x\n');
  write('db/migrations/0001_init.sql', 'create table a (id int);\n');
  g('add', '-A'); g('commit', '-q', '-m', 'init');
  return { dir, g, write };
}
/** The id exactly as tools/colab computes it: the branch's changed migration paths, blobs at `sha`. */
function idAt(r, base, sha) {
  const paths = r.g('diff', '--name-only', `${base}...${sha}`).split('\n').filter((f) => f.startsWith('db/migrations/'));
  if (paths.length === 0) return null;
  const out = execFileSync('git', ['ls-tree', '-z', sha, '--', ...paths], { cwd: r.dir, encoding: 'utf8' });
  return mg.migrationContentId(mg.migrationEntriesFromLsTree(out, paths));
}

test('a merge-of-trunk sync keeps the content id; editing or adding a migration moves it', (t) => {
  const r = repo();
  t.after(() => fs.rmSync(r.dir, { recursive: true, force: true }));
  r.g('checkout', '-q', '-b', 'feat/schema-1');
  r.write('db/migrations/0002_add_b.sql', 'create table b (id int);\n');
  r.write('src/model.js', 'module.exports = 1;\n');
  r.g('add', '-A'); r.g('commit', '-q', '-m', 'feat: b');
  const reviewed = r.g('rev-parse', 'HEAD');
  const id = idAt(r, 'main', reviewed);
  assert.match(id, /^[0-9a-f]{64}$/);

  // Trunk moves (an unrelated change, and an unrelated migration of trunk's own), then the B0 sync.
  r.g('checkout', '-q', 'main');
  r.write('docs/notes.md', 'n\n');
  r.write('db/migrations/0003_trunk_c.sql', 'create table c (id int);\n');
  r.g('add', '-A'); r.g('commit', '-q', '-m', 'trunk moves');
  r.g('checkout', '-q', 'feat/schema-1');
  r.g('merge', '-q', '--no-edit', 'main');
  const synced = r.g('rev-parse', 'HEAD');
  assert.notEqual(synced, reviewed, 'the sync made a new HEAD — the case that voided every grant');
  assert.equal(idAt(r, 'main', synced), id, 'byte-identical migrations: the grant still binds');

  const g = { role: 'migration-reviewer', head: reviewed, record: { migrations: id } };
  assert.equal(mg.grantHeadBinding(g, synced, idAt(r, 'main', synced)).via, 'content');
  // The pre-#508 record shape is still voided by the same sync.
  assert.equal(mg.grantHeadBinding({ role: 'migration-reviewer', head: reviewed, record: {} }, synced, id).ok, false);

  // A non-migration commit keeps it too.
  r.write('src/model.js', 'module.exports = 2;\n');
  r.g('commit', '-q', '-am', 'fix: model');
  assert.equal(idAt(r, 'main', r.g('rev-parse', 'HEAD')), id);

  // Editing the reviewed migration voids it.
  r.write('db/migrations/0002_add_b.sql', 'create table b (id int, name text);\n');
  r.g('commit', '-q', '-am', 'edit migration');
  const edited = r.g('rev-parse', 'HEAD');
  assert.notEqual(idAt(r, 'main', edited), id);
  assert.equal(mg.grantHeadBinding(g, edited, idAt(r, 'main', edited)).ok, false);

  // Restoring the bytes restores the id (it is content, not history) — and adding a migration moves it.
  r.write('db/migrations/0002_add_b.sql', 'create table b (id int);\n');
  r.g('commit', '-q', '-am', 'revert edit');
  assert.equal(idAt(r, 'main', r.g('rev-parse', 'HEAD')), id);
  r.write('db/migrations/0004_add_d.sql', 'create table d (id int);\n');
  r.g('add', '-A'); r.g('commit', '-q', '-m', 'another migration');
  assert.notEqual(idAt(r, 'main', r.g('rev-parse', 'HEAD')), id);
});

test('migrationEntriesFromLsTree: a path the tree lacks is a deletion; unrelated records are ignored', () => {
  const blob = 'c'.repeat(40);
  const out = `100644 blob ${blob}\tdb/migrations/a.sql\u0000040000 tree ${'d'.repeat(40)}\tdb/other\0`;
  assert.deepEqual(mg.migrationEntriesFromLsTree(out, ['db/migrations/a.sql', 'db/migrations/gone.sql']),
    [{ path: 'db/migrations/a.sql', blob }, { path: 'db/migrations/gone.sql', blob: null }]);
  assert.deepEqual(mg.migrationEntriesFromLsTree('', []), []);
});
