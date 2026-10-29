'use strict';
/**
 * tools/lib/migration-paths.js — where a repo's migrations live (#383): the ONE rule every
 * migration detector reads, so no consumer keeps its own regex.
 *
 * Before this, `colab ship`'s no-new-migrations gate and `release cut`'s schema-additive check each
 * hard-coded two layouts (Laravel `database/migrations/`, Prisma `prisma/migrations/`). A repo whose
 * migrations live anywhere else — a Node service's `backend/migrations/`, a Go service's
 * `migrations/` — was invisible to both: `colab ship --dry` reported `no new migrations ✓` on a
 * branch adding a production data backfill, so the human-only grant (#98) never engaged.
 *
 * `migrations:` in `.github/project.yml` names the extra places, as repo-relative paths:
 *
 *   migrations: [backend/migrations/, server/db.ts]
 *
 * #673: an entry is a DIRECTORY when it ends in `/` (matched by prefix, as before), and otherwise a
 * path that may be a FILE: that exact path, or anything under it. So `backend/migrations` still covers
 * `backend/migrations/x.sql`, and `server/db.ts` covers a schema the server applies inline at start-up
 * (`CREATE TABLE`/`ALTER TABLE` in its own code, no migrations directory) — before this, that layout
 * could not be declared at all, and #671's fail-closed grant gate left such a repo no tooled release.
 * A change to a declared file IS a migration; release-cut's schema-additive reads the lines it added.
 *
 * The declared list is ADDED to the two defaults, never a replacement for them: a declaration can
 * only make the gate see more. There is deliberately no opt-out of the defaults — an opt-out can
 * only make a human-only gate see LESS, and weakening one should wait for a repo that genuinely
 * needs it (a `database/migrations/` that is not migrations), not be built ahead of one.
 *
 * Pure: strings in, strings out — no fs, no git. Same posture as ship-batch.js.
 */

// Matched ANYWHERE in the path — `(^|/)` — so a monorepo's `api/database/migrations/` counts, as it
// always has. Declared prefixes are matched from the repo root only (they are repo-relative paths).
const DEFAULT_MIGRATION_PATHS = Object.freeze(['database/migrations/', 'prisma/migrations/']);

// Dependency trees a repo commits but does not author. A `vendor/foo/migrations/` is a library's
// migrations, run (if at all) through the library — not an undeclared layout of this repo's own.
const FOREIGN_TREE_SEGMENTS = new Set(['node_modules', 'vendor']);

/**
 * One declared entry → its normalised path, or `{ problem }`. `./` and doubled `/` are removed; a
 * trailing `/` is KEPT when written (a directory) and never added (#673: without one, the entry may
 * name a file). Rejected, not guessed: absolute paths and `..` (not repo-relative), globs (a path
 * match would silently match nothing for `*`), and empties.
 */
function normalizeEntry(raw) {
  if (typeof raw !== 'string') return { problem: `${JSON.stringify(raw)} is not a path` };
  let p = raw.trim();
  if (p === '') return { problem: 'an empty entry is not a path' };
  if (p.startsWith('/')) return { problem: `"${p}" is absolute — declare a repo-relative prefix (e.g. "backend/migrations/")` };
  if (/[*?[\]{}]/.test(p)) return { problem: `"${p}" is a glob — declare a plain directory prefix ("backend/migrations/") or a file ("server/db.ts"); entries are matched by path, not by pattern` };
  p = p.replace(/^(\.\/)+/, '').replace(/\/{2,}/g, '/').replace(/(\/\.)+\/?$/, '/');
  if (p === '' || p === '.' || p === '/' || p === './') return { problem: `"${raw}" names the repo root — every file would be a migration` };
  if (p.split('/').includes('..')) return { problem: `"${p}" climbs out of the repo — declare a repo-relative prefix` };
  return { path: p };
}

/** The directory form of an entry (`a/b` → `a/b/`) — what duplicates and defaults compare by. */
function dirForm(p) {
  return p.endsWith('/') ? p : `${p}/`;
}

/** Does declared entry `p` cover repo-relative `f`? A directory by prefix; a no-slash entry exactly or below it. */
function entryCovers(p, f) {
  if (p.endsWith('/')) return f.startsWith(p);
  return f === p || f.startsWith(`${p}/`);
}

/**
 * `migrations:` from a parsed project.yml → `{ declared, paths, problems, notes, reason }`.
 * `problems` are invalid shapes/entries (the audit fails them); `notes` are harmless redundancy — an
 * empty list, a default restated, a duplicate — which the audit only warns about.
 *
 * - absent / null        → declared: false, paths: [] (the defaults alone — today's behaviour)
 * - a list               → every entry that normalises; the rest land in `problems`
 * - a bare scalar string → read as a one-entry list, with a problem saying so: the reader is
 *                          lenient in the direction that makes the gate STRICTER (it still sees
 *                          the path the author obviously meant); the audit fails the shape.
 *
 * `paths` never includes the defaults — `isMigrationPath` always applies those itself. An entry
 * keeps its trailing `/` as written (#673): `a/b/` is a directory, `a/b` a file or a directory.
 */
function parseMigrationPaths(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, 'migrations');
  if (!has || doc.migrations === null || doc.migrations === undefined) {
    return { declared: false, paths: [], problems: [], notes: [], reason: 'migrations absent — defaults only' };
  }
  const v = doc.migrations;
  const problems = [];
  const notes = [];
  let entries;
  if (Array.isArray(v)) entries = v;
  else if (typeof v === 'string' && v.trim() !== '') {
    entries = [v];
    problems.push(`migrations is a bare string ${JSON.stringify(v)}, expected a list (e.g. [${v.trim()}])`);
  } else {
    return { declared: true, paths: [], problems: [`migrations is ${JSON.stringify(v)}, expected a list of repo-relative prefixes (e.g. [backend/migrations/])`], notes, reason: 'migrations malformed — defaults only' };
  }
  if (Array.isArray(v) && v.length === 0) {
    notes.push('migrations is an empty list — omit the key for the defaults alone');
  }
  const paths = [];
  for (const raw of entries) {
    const r = normalizeEntry(raw);
    if (r.problem) { problems.push(`migrations: ${r.problem}`); continue; }
    if (DEFAULT_MIGRATION_PATHS.includes(dirForm(r.path))) {
      notes.push(`migrations: "${r.path}" is already a default — it need not be declared`);
      continue;
    }
    if (paths.some((q) => dirForm(q) === dirForm(r.path))) { notes.push(`migrations: "${r.path}" is declared twice`); continue; }
    paths.push(r.path);
  }
  return { declared: true, paths, problems, notes, reason: paths.length ? `migrations: [${paths.join(', ')}] + defaults` : 'defaults only' };
}

/** Union of several docs' declared prefixes (trunk's + the branch's) — the gate sees every one. */
function unionPaths(...docs) {
  const out = [];
  for (const d of docs) for (const p of parseMigrationPaths(d).paths) if (!out.includes(p)) out.push(p);
  return out;
}

/** Is `file` (repo-relative, `/`-separated) a migration under the defaults or a declared prefix? */
function isMigrationPath(file, declared) {
  const f = String(file || '');
  for (const d of DEFAULT_MIGRATION_PATHS) {
    if (f.startsWith(d) || f.includes(`/${d}`)) return true;
  }
  for (const p of declared || []) if (entryCovers(p, f)) return true;
  return false;
}

/**
 * #673: is `file` exactly a declared no-slash entry — a schema FILE, edited in place by nature (one
 * `db.ts` that runs its `CREATE`/`ALTER` at start-up)? Such a file is not a migration *history*: an
 * edit is how it grows, never "an existing migration was rewritten", so schema-additive reads the
 * lines the edit ADDED instead. A file under a declared directory is not one (that is a history).
 */
function isDeclaredFile(file, declared) {
  const f = String(file || '');
  return (declared || []).some((p) => !p.endsWith('/') && f === p);
}

/**
 * Directories named `migrations` in a tracked-file list that NO rule covers — the likely
 * undeclared layout the audit reports. `files` is `git ls-files` output (repo-relative). Returns the
 * outermost such directory per path (`x/migrations/`), sorted, deduped. Paths inside a committed
 * dependency tree (`node_modules/`, `vendor/`) are skipped.
 */
function undeclaredMigrationDirs(files, declared) {
  const out = new Set();
  for (const file of files || []) {
    const segs = String(file).split('/');
    if (segs.some((s) => FOREIGN_TREE_SEGMENTS.has(s))) continue;
    // Directory segments only — a FILE named `migrations` is not a layout.
    const idx = segs.slice(0, -1).indexOf('migrations');
    if (idx === -1) continue;
    if (isMigrationPath(file, declared)) continue;
    out.add(`${segs.slice(0, idx + 1).join('/')}/`);
  }
  return [...out].sort();
}

module.exports = {
  DEFAULT_MIGRATION_PATHS, parseMigrationPaths, unionPaths, isMigrationPath, isDeclaredFile, undeclaredMigrationDirs,
};
