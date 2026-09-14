'use strict';
/**
 * #345 — is a change DOCUMENTATION ONLY? The one mechanical input to the docs-only exception to
 * `colab ship`'s autonomy gate (CONVENTIONS.md §2, "Autonomy — the docs-only exception").
 *
 * On a repo that does not declare `autonomy: auto-trunk`, an agent may still complete Phase B for a
 * change this module classifies docs-only. The judgement is COMPUTED FROM GIT, never asserted by the
 * caller. Nothing here takes a list, a flag, an env var or a project.yml field. The allowlist and the
 * exclusions below are constants, so widening them is a handbook change reviewed in a commit.
 *
 * Every doubt resolves to "not docs-only": an empty diff, a git read that failed, a binary, a
 * symlink, a submodule pointer. A false "no" costs a human click. A false "yes" merges code nobody
 * approved.
 */

/** Extensions that count as documentation. Compared exactly (`README.MD` does not match). */
const DOC_EXTENSIONS = Object.freeze(['.md', '.mdx', '.txt']);
/** A path under this top-level directory counts as documentation whatever its extension. */
const DOCS_DIR = 'docs/';
/** Rules and agent instructions: never documentation, at any depth, even though they are `.md`. */
const NEVER_BASENAMES = Object.freeze(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md']);
/** Config directories: nothing under them is documentation, at any depth. */
const NEVER_DIRS = Object.freeze(['.claude', '.github', '.githooks']);

const MODE_SYMLINK = '120000';
const MODE_GITLINK = '160000';

/**
 * Classify ONE path by name alone. Returns `null` when the path is documentation, else the reason it
 * is not.
 */
function pathReason(p) {
  const segs = String(p).split('/');
  const base = segs[segs.length - 1];
  if (NEVER_BASENAMES.includes(base)) return `${base} is agent rules, not documentation`;
  const dir = segs.slice(0, -1).find((s) => NEVER_DIRS.includes(s));
  if (dir) return `under ${dir}/ (config)`;
  if (String(p).startsWith(DOCS_DIR)) return null;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot) : '';
  if (DOC_EXTENSIONS.includes(ext)) return null;
  return `not ${DOC_EXTENSIONS.join('/')} and not under ${DOCS_DIR}`;
}

/**
 * Classify a set of changed entries. `entries`: `[{ path, oldMode, newMode, binary }]`, one per path
 * per side. A rename arrives as a deletion plus an addition, so both names are judged.
 *
 * Returns `{ docsOnly, files, offenders: [{ path, reason }], reason }`. `files` counts distinct paths.
 * `reason` is one line for a human, set on both outcomes.
 */
function classify(entries) {
  const paths = new Map();
  for (const e of entries || []) {
    const why = [];
    const nameWhy = pathReason(e.path);
    if (nameWhy) why.push(nameWhy);
    if (e.oldMode === MODE_SYMLINK || e.newMode === MODE_SYMLINK) why.push('symlink change');
    if (e.oldMode === MODE_GITLINK || e.newMode === MODE_GITLINK) why.push('submodule change');
    if (e.binary) why.push('binary change');
    const prev = paths.get(e.path) || [];
    paths.set(e.path, [...new Set([...prev, ...why])]);
  }
  const files = paths.size;
  if (files === 0) return { docsOnly: false, files: 0, offenders: [], reason: 'empty diff — nothing to call documentation' };
  const offenders = [...paths.entries()].filter(([, why]) => why.length)
    .map(([p, why]) => ({ path: p, reason: why.join(', ') }));
  if (offenders.length) {
    const shown = offenders.slice(0, 3).map((o) => `${o.path} (${o.reason})`).join('; ');
    const more = offenders.length > 3 ? `; +${offenders.length - 3} more` : '';
    return { docsOnly: false, files, offenders, reason: `${offenders.length} of ${files} file(s) not documentation: ${shown}${more}` };
  }
  return { docsOnly: true, files, offenders: [], reason: `docs-only (${files} files)` };
}

/** Parse `git diff --raw -z --no-renames --no-abbrev` output into `[{ path, oldMode, newMode }]`. */
function parseRaw(stdout) {
  const parts = String(stdout || '').split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const head = parts[i].replace(/^\n+/, '');
    if (!head.startsWith(':')) continue;
    const [oldMode, newMode] = head.slice(1).split(' ');
    const p = parts[i + 1];
    if (p) out.push({ path: p, oldMode, newMode });
    i++;
  }
  return out;
}

/** Parse `git diff --numstat -z --no-renames` output into the set of paths git calls binary. */
function parseBinary(stdout) {
  const bin = new Set();
  for (const rec of String(stdout || '').split('\0')) {
    const m = /^\n*(-|\d+)\t(-|\d+)\t(.+)$/s.exec(rec);
    if (m && m[1] === '-' && m[2] === '-') bin.add(m[3]);
  }
  return bin;
}

/**
 * Read the entries one git diff invocation produces. `range` is passed through to `git diff`
 * (`a...b`) or `git diff-tree` (`<sha>`), selected by `cmd`. Returns an entry array, or `null` when
 * either read failed — which the caller must treat as not docs-only.
 */
function readEntries(git, repo, cmd, range) {
  const common = cmd === 'diff-tree'
    ? ['diff-tree', '-r', '-z', '--no-renames', '--no-commit-id', '--root', '-m']
    : ['diff', '-z', '--no-renames'];
  const raw = git.git([...common, '--raw', '--no-abbrev', ...range], repo);
  const num = git.git([...common, '--numstat', ...range], repo);
  if (!raw.ok || !num.ok) return null;
  const binary = parseBinary(num.stdout);
  return parseRaw(raw.stdout).map((e) => ({ ...e, binary: binary.has(e.path) }));
}

/**
 * The branch shape: what `branch` changes relative to its merge base with `base` — the same three-dot
 * diff the squash would land.
 */
function branchChanges(git, repo, base, branch) {
  const entries = readEntries(git, repo, 'diff', [`${base}...${branch}`, '--']);
  if (!entries) return { docsOnly: false, files: 0, offenders: [], reason: `could not read the diff ${base}...${branch}` };
  return classify(entries);
}

/**
 * The trunk-direct shape (#302 has no branch): every commit on `trunk` committed at or after `since`
 * (the unit's earliest claim), by ANYONE. That over-includes other sessions' commits on purpose.
 * Nothing mechanical ties a trunk commit to a session, and the error must lean toward refusing. No
 * `since`, or no commits in the window, is refused like an empty diff.
 */
function directChanges(git, repo, trunk, since) {
  if (!since) return { docsOnly: false, files: 0, offenders: [], reason: 'the claim records no creation time to bound the unit' };
  const revs = git.git(['rev-list', `--since=${since}`, trunk], repo);
  if (!revs.ok) return { docsOnly: false, files: 0, offenders: [], reason: `could not list ${trunk} commits since ${since}` };
  const shas = revs.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const entries = [];
  for (const sha of shas) {
    const e = readEntries(git, repo, 'diff-tree', [sha]);
    if (!e) return { docsOnly: false, files: 0, offenders: [], reason: `could not read commit ${sha.slice(0, 7)}` };
    entries.push(...e);
  }
  const verdict = classify(entries);
  return { ...verdict, commits: shas.length };
}

module.exports = {
  DOC_EXTENSIONS, DOCS_DIR, NEVER_BASENAMES, NEVER_DIRS,
  pathReason, classify, parseRaw, parseBinary, branchChanges, directChanges,
};
