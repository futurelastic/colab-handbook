'use strict';
/**
 * #488: where a session's scratch lives — the plan file (`code-start` / `code-plan` write it,
 * `code-wrap` / `code-ship` read and delete it) and dispatch briefs.
 *
 * Both used to be literals under `.claude/` (`.claude/plans/`, `.claude/briefs/`). The agent CLI
 * guards `.claude/` as configuration, so every scratch write there could cost the operator a
 * permission prompt — for a file that is disposable by definition. Defaults now sit outside it:
 *
 *   plans   `<main checkout>/.plans/`   overridable by COLAB_PLANS_DIR
 *   briefs  `<main checkout>/.briefs/`  overridable by COLAB_BRIEFS_DIR
 *
 * A configured value is relative to the repo root, or absolute. Writers use ONLY the configured
 * dir. Readers use the configured dir first, then the legacy `.claude/plans/` — one transition,
 * so a plan written before the switch is still graded, journalled and deleted. Old files are never
 * moved.
 *
 * Everything here is pure (env + strings in, strings out); tools/colab does the IO.
 */

const path = require('path');

const DEFAULT_PLANS_DIR = '.plans';
const DEFAULT_BRIEFS_DIR = '.briefs';
/** Read-only fallbacks for the transition (#488). Never written to by anything that follows #488. */
const LEGACY_PLANS_DIR = '.claude/plans';
const LEGACY_BRIEFS_DIR = '.claude/briefs';

/** A configured dir, normalised: trimmed, forward slashes, no trailing slash; blank → the default. */
function normalise(value, dflt) {
  const v = String(value === undefined || value === null ? '' : value).trim().replace(/\\/g, '/');
  if (!v) return dflt;
  if (v === '/') return dflt; // the filesystem root is never a scratch dir — treat as unset
  return v.replace(/\/+$/, '') || dflt;
}

/** The plans dir as configured — relative to the repo root unless absolute. */
function plansDirSetting(env = process.env) { return normalise(env.COLAB_PLANS_DIR, DEFAULT_PLANS_DIR); }
/** The briefs dir as configured — relative to the repo root unless absolute. */
function briefsDirSetting(env = process.env) { return normalise(env.COLAB_BRIEFS_DIR, DEFAULT_BRIEFS_DIR); }

function resolveIn(repoRoot, rel) { return path.isAbsolute(rel) ? rel : path.join(repoRoot, rel); }

/** Absolute dir a writer puts a plan file in. Never the legacy dir (unless configured to it). */
function planWriteDir(repoRoot, env = process.env) { return resolveIn(repoRoot, plansDirSetting(env)); }

/** Absolute dir a writer puts a brief in. */
function briefsWriteDir(repoRoot, env = process.env) { return resolveIn(repoRoot, briefsDirSetting(env)); }

/** Absolute dirs a reader looks in, in order: configured first, then legacy. Deduplicated. */
function planReadDirs(repoRoot, env = process.env) {
  const out = [];
  for (const d of [planWriteDir(repoRoot, env), resolveIn(repoRoot, LEGACY_PLANS_DIR)]) {
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * A configured dir that is relative and stays inside the repo, as a root-anchored exclude line
 * (`/.plans/`) — or null for an absolute dir or one that climbs out (`../x`), which no repo-local
 * ignore file can or needs to hide.
 */
function anchoredLine(rel) {
  if (path.isAbsolute(rel)) return null;
  const n = path.posix.normalize(rel);
  if (n === '.' || n.startsWith('../') || n === '..') return null;
  return `/${n.replace(/^\.\//, '')}/`;
}

/**
 * Root-anchored `.git/info/exclude` lines for every scratch dir — configured plans, configured
 * briefs, and the legacy `.claude/plans/` (kept: a clone may still hold pre-#488 files).
 */
function excludeLines(env = process.env) {
  const out = [];
  for (const rel of [plansDirSetting(env), briefsDirSetting(env), LEGACY_PLANS_DIR]) {
    const line = anchoredLine(rel);
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

/**
 * #527: the root-anchored exclude line for the worktree subdir (`colab worktree new` creates
 * worktrees INSIDE the clone, `.worktrees/` by default), or null when the configured subdir is
 * absolute or climbs out of the repo. Deliberately NOT part of `excludeLines`: those are scratch
 * (disposable, filtered out of the uncommitted-work gate by `isScratchPath`); a worktree is live
 * work and must never be filtered — it only has to stay out of the main checkout's `git status`,
 * where one habitual `git add -A` would otherwise commit it as an embedded-repo gitlink.
 */
function worktreeExcludeLine(worktreeSubdir) {
  return anchoredLine(normalise(worktreeSubdir, '.worktrees'));
}

/**
 * Is a repo-relative path (as `git status --porcelain` prints it) inside a scratch dir? Used to
 * keep scratch out of the uncommitted-work gate: a plan or brief left in a worktree is disposable
 * by definition, and must never be what makes a teardown refuse (#488).
 */
function isScratchPath(relPath, env = process.env) {
  const p = String(relPath || '').replace(/^"|"$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
  return excludeLines(env).some((line) => p.startsWith(line.slice(1)));
}

/** Drop porcelain lines (`?? path`, ` M path`) whose path is scratch. Text in, text out. */
function withoutScratch(porcelainText, env = process.env) {
  if (!porcelainText) return porcelainText;
  return String(porcelainText).split('\n')
    .filter((l) => l && !isScratchPath(l.slice(3), env))
    .join('\n');
}

module.exports = {
  DEFAULT_PLANS_DIR, DEFAULT_BRIEFS_DIR, LEGACY_PLANS_DIR, LEGACY_BRIEFS_DIR,
  plansDirSetting, briefsDirSetting, planWriteDir, briefsWriteDir, planReadDirs,
  excludeLines, worktreeExcludeLine, isScratchPath, withoutScratch,
};
