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
/**
 * #570: build inputs that happen to end in `.txt` — a suite installs or compiles from them, so a change
 * to one changes behaviour. Never documentation, at any depth: a Python dependency manifest exactly as
 * the cure rule names one (cure-diff.js isPythonManifest — a name containing `requirements`, or under a
 * `requirements/` directory, any case), a pip constraints file, and `CMakeLists.txt`. A `.txt` pulled
 * in by `-r`/`-c` under some other name is NOT caught by name — a repo with one lists it in
 * `ci-docs-skip`.
 */
function buildInput(p, base) {
  // Lazy: cure-diff.js requires this module at load time.
  if (require('./cure-diff').isPythonManifest(p)) return true;
  return /constraints.*\.txt$/i.test(base) || base === 'CMakeLists.txt';
}
/** Config directories: nothing under them is documentation, at any depth. */
const NEVER_DIRS = Object.freeze(['.claude', '.github', '.githooks']);
/**
 * Agent-instruction directories named by more than one segment (#520): nothing under them is
 * documentation, at any depth. `.colab/skills/<skill>.md` is a skill's local policy — text an agent
 * loads and follows over the skill's own — so one `.md` there changes agent behaviour exactly as a
 * `CLAUDE.md` does. Only this subtree: the rest of `.colab/` is judged by the ordinary rules.
 */
const NEVER_SUBDIRS = Object.freeze(['.colab/skills']);

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
  if (buildInput(String(p), base)) return `${base} is a build input, not documentation`;
  const dir = segs.slice(0, -1).find((s) => NEVER_DIRS.includes(s));
  if (dir) return `under ${dir}/ (config)`;
  const dirs = segs.slice(0, -1);
  for (const sub of NEVER_SUBDIRS) {
    const want = sub.split('/');
    for (let i = 0; i + want.length <= dirs.length; i++) {
      if (want.every((w, j) => dirs[i + j] === w)) return `under ${sub}/ (skill local policy — agent instructions)`;
    }
  }
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

/**
 * Parse `git diff --raw -z --no-renames --no-abbrev` output into
 * `[{ path, oldMode, newMode, oldSha, newSha, status }]`. The sha/status fields are additive
 * (#297): the cure rule's manifest check (tools/lib/cure-diff.js) reads each side's blob by sha, so
 * it reuses this parser rather than growing a second one that could disagree with it.
 */
function parseRaw(stdout) {
  const parts = String(stdout || '').split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const head = parts[i].replace(/^\n+/, '');
    if (!head.startsWith(':')) continue;
    const [oldMode, newMode, oldSha, newSha, status] = head.slice(1).split(' ');
    const p = parts[i + 1];
    if (p) out.push({ path: p, oldMode, newMode, oldSha, newSha, status });
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

/**
 * #570: `ci-docs-skip:` in project.yml — the opt-in to the CI templates' docs-only mode. Absent (or
 * null) = off. A list = on; each member is a repo path whose changes always run the suite even though
 * this module calls them documentation (`docs/api/` feeding a generator). `[]` = on, nothing excluded.
 *
 * The CI guard parses the same shape in shell and reads anything else as "not opted in" — the
 * stricter direction — so an invalid value here is a finding: a declaration that silently does
 * nothing. Members are plain paths (the guard matches `p == x` or `p` under `x/`): no glob, no `..`
 * or `.` segment, not absolute, only `[A-Za-z0-9._/-]`.
 */
const CI_DOCS_SKIP_KEY = 'ci-docs-skip';
function parseCiDocsSkip(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, CI_DOCS_SKIP_KEY);
  const v = has ? doc[CI_DOCS_SKIP_KEY] : null;
  if (v === null || v === undefined) {
    return { declared: false, valid: true, on: false, exclude: null, reason: 'ci-docs-skip absent — a docs-only change runs the full CI suite (#570)' };
  }
  const bad = (why) => ({ declared: true, valid: false, on: false, exclude: null,
    reason: `ci-docs-skip ${why} — it must be a list of repo paths (\`[]\` for none); the CI guard reads anything else as not opted in, so docs-only changes run the full suite` });
  if (!Array.isArray(v)) return bad(`is ${JSON.stringify(v)}`);
  const exclude = [];
  for (const m of v) {
    const s = typeof m === 'string' ? m.replace(/\/+$/, '') : null;
    if (!s || !/^[A-Za-z0-9._/-]+$/.test(s) || s.startsWith('/') || s.split('/').some((x) => x === '..' || x === '.' || x === '')) {
      return bad(`lists ${JSON.stringify(m)}, which is not a plain repo path`);
    }
    exclude.push(s);
  }
  return { declared: true, valid: true, on: true, exclude,
    reason: exclude.length ? `ci-docs-skip on, except ${exclude.join(', ')}` : 'ci-docs-skip on — a docs-only change skips the CI suite' };
}

module.exports = {
  DOC_EXTENSIONS, DOCS_DIR, NEVER_BASENAMES, NEVER_DIRS, NEVER_SUBDIRS,
  pathReason, classify, parseRaw, parseBinary, readEntries, branchChanges, directChanges,
  CI_DOCS_SKIP_KEY, parseCiDocsSkip,
};
