'use strict';
/**
 * Local-only adoption (#393) — the pure half of `colab adopt --local`, and the one definition of
 * the "adopted locally, not committed" state the audit and handbook-sync recognise.
 *
 * The shape (CONVENTIONS.md §9, "Working in a repo you don't own"): a repo whose owner has not
 * adopted this handbook and reviews and merges changes himself. Committing handbook files there
 * is not an option, so everything the fleet needs stays OUT of his history:
 *
 *   - `.github/project.yml` lives in the local clone only. Every reader (colab's own
 *     `projectDoc()`/ports reader, adopt, code-start's `cat`, the audit's local source) reads the
 *     WORKING TREE, not git — so an untracked file is as good as a committed one to them.
 *   - It is hidden by `.git/info/exclude`, never `.gitignore`: a `.gitignore` entry is itself a
 *     tracked file, which is exactly the commit we are avoiding. `git status --porcelain -uall`
 *     does not report an excluded file, so the dirty-checkout and drift checks stay quiet.
 *   - `trunk:` names the FLEET's own integration branch, never the owner's default branch — so
 *     claims, worktrees, grading and `colab ship` land there unchanged, and the owner's trunk is
 *     only ever reached by a pull request he merges.
 *
 * Everything here is pure (text in, text/verdict out); tools/colab does the IO.
 */

/**
 * Paths hidden by `.git/info/exclude`, root-anchored (a leading `/`) so they match only at the
 * repo root — `CLAUDE.local.md` in a subdirectory the owner commits must stay visible.
 * `.claude/plans/` is the plan-file scratch dir code-start already excludes the same way.
 */
const LOCAL_EXCLUDE_PATHS = ['/.github/project.yml', '/CLAUDE.local.md', '/.claude/plans/'];

/**
 * LOCAL_EXCLUDE_PATHS plus the worktree subdir (`colab worktree new` creates worktrees INSIDE the
 * clone, `.worktrees/` by default). An adopted repo hides that dir in its own committed
 * `.gitignore`; the owner's repo does not, so without this line every worktree shows up in the
 * main checkout's `git status` — measured on the #393 fixture the moment the first one was cut.
 */
function localExcludePaths(worktreeSubdir) {
  const sub = String(worktreeSubdir || '.worktrees').replace(/^\/+|\/+$/g, '');
  return [...LOCAL_EXCLUDE_PATHS, `/${sub}/`];
}

const EXCLUDE_HEADER = '# colab-handbook: local-only adoption (#393) — handbook files this clone keeps out of the owner\'s history';

/**
 * Which of LOCAL_EXCLUDE_PATHS `existingText` (the current `info/exclude`, or null) does not
 * already carry. A line counts as present written with or without the leading `/` — an operator
 * who hand-added `.github/project.yml` is not handed a duplicate.
 */
function missingExcludeLines(existingText, paths = localExcludePaths()) {
  const have = new Set(
    String(existingText || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/^\//, '')),
  );
  return paths.filter((p) => !have.has(p.replace(/^\//, '')));
}

/** The text to append to `info/exclude` — '' when nothing is missing (idempotent re-run). */
function excludeAppendText(existingText, paths = localExcludePaths()) {
  const missing = missingExcludeLines(existingText, paths);
  if (!missing.length) return '';
  const lead = existingText && !String(existingText).endsWith('\n') ? '\n' : '';
  return `${lead}${EXCLUDE_HEADER}\n${missing.join('\n')}\n`;
}

/**
 * The stub CLAUDE.local.md — the operating note that carries the rules the owner's repo cannot.
 * Written only when absent; never overwritten (it is the operator's to edit from here on).
 */
function claudeLocalStub({ trunk, ownerTrunk }) {
  const owner = ownerTrunk || '<the owner\'s default branch>';
  return `# CLAUDE.local.md — local-only, never committed

This clone works in a repository the fleet does **not** own (colab-handbook CONVENTIONS.md §9,
"Working in a repo you don't own"). Its handbook files — \`.github/project.yml\` and this note —
are hidden by \`.git/info/exclude\` and must never be committed here.

## Where work lands

- **Our trunk is \`${trunk}\`** — the fleet's integration branch. Sessions branch off it and
  \`colab ship\` merges into it, exactly as on any adopted repo.
- **\`${owner}\` is the owner's trunk. Never push to it, merge into it, or open work on it
  directly.** It is reached only by a pull request from \`${trunk}\` that the owner reviews and
  merges himself — \`colab deliver --dry\` shows what is pending, \`COLAB_HUMAN=1 colab deliver\`
  opens (or refreshes) that one PR (needs \`owner: { branch: ${owner} }\` in the local
  \`.github/project.yml\`, which \`colab adopt --local\` writes when it detects the branch).

## What stays off

- **Scheduled autopilot stays OFF for this repo.** It would triage and start the owner's own
  issues, not only ours — there is no way today to scope it to the fleet's issues.
- No CI templates, CODEOWNERS, CLAUDE.md conventions block or repo topic: nothing gates on them,
  and each would be a commit the owner never asked for.

## Owner's rules

<!-- Add whatever the owner asked for: review expectations, branches he uses, contacts. -->
`;
}

/** What `adopt --local` deliberately does NOT do, and why — printed so the gap is a decision on
 * record, never a step someone assumes was skipped by accident. */
const NOT_DONE = [
  { what: 'CI templates (.github/workflows/)', why: 'a commit to the owner\'s repo. colab ship still gates on CI at the integration branch\'s head: if none of the owner\'s workflows runs on that branch, every ship is human-gated (a ci-granted exemption per branch) — find out which it is before the first ship' },
  { what: 'CODEOWNERS', why: 'a commit to the owner\'s repo; nothing gates on it' },
  { what: 'CLAUDE.md conventions block', why: 'a commit to the owner\'s repo; CLAUDE.local.md carries the local rules instead' },
  { what: 'repo topic', why: 'a change to the owner\'s repo settings; it only feeds fleet-wide discovery' },
  { what: 'the full label set', why: 'only the load-bearing four were ensured (colab labels --ensure --minimal); the rest are opt-in by use' },
  { what: 'colab register / the dashboard\'s repo scan', why: 'machine-local; register it yourself if you want it listed, and refresh the dashboard\'s cached scan — it does not pick a new repo up on its own' },
  { what: 'scheduled autopilot', why: 'must stay OFF here — it would triage and start the owner\'s issues, not only the fleet\'s' },
];

/**
 * The adoption state of a checkout, from three facts the caller measures:
 *   exists   — `.github/project.yml` is in the working tree
 *   tracked  — git tracks it (`git ls-files --error-unmatch`); null when not a git checkout
 *   ignored  — git ignores it (`git check-ignore`); null when not a git checkout
 *
 * Returns one of:
 *   'none'       no descriptor at all
 *   'committed'  tracked — the ordinary adopted repo (or not a git checkout: nothing to say)
 *   'local'      untracked AND ignored — adopted locally, not committed (#393)
 *   'untracked'  untracked and NOT ignored — a descriptor about to be committed by accident
 *                (or simply not committed yet); `git status` shows it
 */
function localAdoptionState({ exists, tracked, ignored }) {
  if (!exists) return 'none';
  if (tracked === null || tracked === undefined || tracked) return 'committed';
  return ignored ? 'local' : 'untracked';
}

module.exports = {
  LOCAL_EXCLUDE_PATHS, localExcludePaths, EXCLUDE_HEADER, missingExcludeLines, excludeAppendText,
  claudeLocalStub, NOT_DONE, localAdoptionState,
};
