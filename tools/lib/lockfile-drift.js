'use strict';
/**
 * "This merge changed a dependency lockfile — the checkout it landed in has NOT re-installed"
 * (#304).
 *
 * Measured shape. A session squash-merges a branch that adds a Composer package whose service
 * provider registers routes. The merge lands in the SHARED TRUNK CHECKOUT — `colab ship` commits
 * there directly when the target is trunk, not in a throwaway worktree — so afterwards:
 * `composer.lock` on trunk lists the new package, `vendor/` does not contain it (merging a branch
 * does not run `composer install`), the provider never loads, `php artisan route:list` reports the
 * package's routes as absent, and an always-on trunk dev server regenerating route bindings from
 * that list DELETES nine previously-committed output files. The trunk checkout is now dirty, and
 * ship's "trunk checkout ready" precondition blocks EVERY other session's merge — including one
 * whose diff never touched anything related.
 *
 * So one merge that adds a dependency can silently brick every other session's ship, and the
 * session that discovers it discovers it as an unexplained "9 files deleted" diff.
 *
 * This module is the DETECTOR half: given the paths a merge commit changed, which of them are
 * dependency lockfiles, and what would a human run to reconcile the checkout. It decides nothing
 * else — the caller (tools/colab) chooses between handing the repo's own `.colab/hooks/post-ship`
 * the job and printing a warning.
 *
 * PURE BY CONSTRUCTION, same posture as dirty-owner.js / base-ci-verdict.js / shipguard.js: plain
 * data in, a verdict out. No git, no gh, no fs, no clock, no subprocess — the caller does the
 * `git diff --name-only` and hands the result over. Every branch is directly reachable from
 * `node --test`, which is the whole reason logic lives here and not inline in `tools/colab`.
 *
 * `install` IS ADVICE TEXT PRINTED TO A HUMAN — never a string this repo executes. Running
 * `composer install` on a shared checkout is a side effect the CLI has no standing to perform:
 * the trunk checkout may carry local platform config, a partially-migrated database, or a
 * dev server mid-request. HELP_WORKTREE's hooks contract already rules on this class ("the
 * portable core does only universal steps; machine-specific steps — DB cloning, dependency
 * symlinking, dev-server restarts — live in OPTIONAL repo hooks, not here"), and dependency
 * installation is squarely that. The escape hatch is `.colab/hooks/post-ship`, three lines of
 * shell the adopting repo owns.
 *
 * ADVISORY ONLY, and it has no choice: detection is only possible AFTER the squash is pushed, so
 * there is nothing left to refuse. Nothing here is wired into any precondition, and a wrong
 * answer costs a misleading line, never a merge.
 */

/**
 * The lockfiles this recognises, most-specific first. HONEST, NOT EXHAUSTIVE — stated plainly
 * because a list that quietly under-reports is worse than no list at all: a repo whose lockfile is
 * missing here gets no warning and no hint that one was owed. That is an accepted, escapable gap
 * (`.colab/hooks/post-ship` fires regardless of what this table knows), not a bug to hide.
 *
 * `install` favours the reproducible, lockfile-respecting form of each manager where one exists
 * (`npm ci` over `npm install`), because reconciling a checkout to a lockfile is exactly the job
 * those forms are for.
 */
const LOCKFILES = [
  { file: 'composer.lock',     manager: 'composer', install: 'composer install' },
  { file: 'package-lock.json', manager: 'npm',      install: 'npm ci' },
  { file: 'pnpm-lock.yaml',    manager: 'pnpm',     install: 'pnpm install --frozen-lockfile' },
  { file: 'yarn.lock',         manager: 'yarn',     install: 'yarn install --immutable' },
  { file: 'bun.lockb',         manager: 'bun',      install: 'bun install --frozen-lockfile' },
  { file: 'Gemfile.lock',      manager: 'bundler',  install: 'bundle install' },
  { file: 'Cargo.lock',        manager: 'cargo',    install: 'cargo fetch' },
  { file: 'poetry.lock',       manager: 'poetry',   install: 'poetry install --sync' },
  { file: 'uv.lock',           manager: 'uv',       install: 'uv sync --frozen' },
  { file: 'go.sum',            manager: 'go',       install: 'go mod download' },
];

/** Escape a literal filename for embedding in a RegExp source. */
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Which of `paths` are dependency lockfiles?
 *
 * @param {string[]} paths repo-relative paths, as `git diff --name-only` prints them.
 * @returns {{path: string, manager: string, install: string}[]} one entry per matching path,
 *   in the order the paths arrived, de-duplicated by path.
 *
 * Anchored `(^|\/)`, matching `newMigrations`' idiom in tools/colab, so a monorepo's
 * `packages/api/composer.lock` counts — the skew this detects is per-installed-tree, and a
 * workspace package has its own. A path that merely CONTAINS a lockfile's name
 * (`composer.lock.bak`, `docs/package-lock.json.md`) is not one, so the match is anchored at both
 * ends: separator-or-start before, end-of-string after.
 */
function changedLockfiles(paths) {
  if (!Array.isArray(paths)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    const p = raw.trim();
    if (!p || seen.has(p)) continue;
    for (const lf of LOCKFILES) {
      if (new RegExp(`(^|/)${esc(lf.file)}$`).test(p)) {
        seen.add(p);
        out.push({ path: p, manager: lf.manager, install: lf.install });
        break;
      }
    }
  }
  return out;
}

/**
 * The human-facing warning for a drift nobody handled — one string, so the wording lives next to
 * the detector that decided it rather than being reassembled at each call site.
 *
 * Names the lockfile AND the command, because the measured failure is not "someone forgot to run
 * an install" — it is that the NEXT session meets a checkout deleting committed files and has no
 * way to connect that to a merge that already scrolled past.
 */
function driftWarning(hits) {
  if (!hits || !hits.length) return null;
  const each = hits.map((h) => `${h.path} → \`${h.install}\``).join('; ');
  return `${hits.length} dependency lockfile(s) changed in this merge and this checkout was NOT re-installed: ${each}. ` +
    'Until someone does, anything regenerating committed output from the installed tree (a route/binding ' +
    'generator, an always-on dev server) can DELETE those files and leave the checkout dirty — which blocks ' +
    "every other session's ship, not just this one (#304). Repos that want this done automatically add " +
    '`.colab/hooks/post-ship`.';
}

module.exports = { changedLockfiles, driftWarning, LOCKFILES };
