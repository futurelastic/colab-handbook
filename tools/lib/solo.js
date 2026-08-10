'use strict';
/**
 * Solo flow (CONVENTIONS.md, "Solo flow") — the entry/exit gate `colab solo` runs.
 *
 * Extracted from tools/colab so the gate is testable against a REAL git repo (same reason
 * lib/landed.js is a module and not inline in the CLI): the whole point of this gate is "never
 * an honor system", so its answer has to be measured against git's actual state, not a mock that
 * agrees with whatever we believed when we wrote it.
 *
 * Pure with respect to state.json: every function here takes the loaded state object (or its
 * relevant slice) as a parameter and returns a verdict; nothing in this module reads or writes
 * ~/.colab/state.json itself — that stays tools/colab's job, same split as lib/readiness.js.
 */

const git = require('./git');

/**
 * Local branches carrying commits their upstream (or, absent one, `origin/<trunk>`) does not have.
 * Returns `[{branch, reason}]` — empty means every local branch is fully pushed.
 *
 * Checked against ALL local branches, not just the current one: a forgotten feature branch sitting
 * unpushed beside the trunk checkout is exactly the kind of "was somebody already partway into
 * something here" fact solo flow's entry gate exists to catch, and it would be invisible to a check
 * that only looked at HEAD.
 */
function unpushedBranches(repoAbs, trunk) {
  const r = git.git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], repoAbs);
  if (!r.ok) return [];
  const out = [];
  for (const b of r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const up = git.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${b}@{u}`], repoAbs);
    const remoteRef = up.ok && up.stdout ? up.stdout : `origin/${trunk}`;
    if (!git.git(['rev-parse', '--verify', '--quiet', remoteRef], repoAbs).ok) {
      out.push({ branch: b, reason: `no upstream and no ${remoteRef} — never pushed` });
      continue;
    }
    const ahead = git.git(['rev-list', '--count', `${remoteRef}..${b}`], repoAbs);
    const n = ahead.ok ? (parseInt(ahead.stdout, 10) || 0) : 0;
    if (n > 0) out.push({ branch: b, reason: `${n} commit(s) ahead of ${remoteRef}` });
  }
  return out;
}

/**
 * `git status --porcelain`, tracked AND untracked. Solo's "clean tree" is deliberately the
 * stricter reading (lib/git.js's `dirtyTracked` ignores untracked cruft, which is right for a
 * ship precondition but wrong here — solo flow's whole premise is "this checkout has nothing
 * anyone else needs to know about", and an untracked file is exactly the kind of thing a returning
 * session would otherwise have to notice by eye).
 *
 * #86: this is now a thin adapter over `git.dirtyAny` rather than its own porcelain call. It was
 * written here first, which is how the repo ended up with two independent implementations of one
 * reading — and only this copy counted untracked files, while the teardown gate that most needed
 * them did not. Keeps the array shape solo's callers and tests expect.
 */
function fullyDirty(repoAbs) {
  const d = git.dirtyAny(repoAbs);
  return d ? d.split('\n').filter(Boolean) : [];
}

/**
 * Entry-gate problems for `colab solo` in `repoAbs`, given the already-loaded state and the repo's
 * resolved trunk. Empty array = clear to open solo flow. Never throws; every check degrades to "no
 * problem found" if git itself is unavailable, because a missing git is a bigger failure the CLI
 * surfaces elsewhere, not a reason to silently claim the tree is dirty.
 */
function entryProblems(st, repoAbs, trunk) {
  const problems = [];

  const wts = Object.values((st && st.worktrees) || {}).filter((w) => w.repo === repoAbs);
  if (wts.length) problems.push(`worktree(s) held: ${wts.map((w) => w.name).join(', ')}`);

  const claims = Object.entries((st && st.claims) || {}).filter(([k]) => k.startsWith(`${repoAbs}#`));
  if (claims.length) problems.push(`claim(s) held: ${claims.map(([, c]) => c.issue).join(', ')}`);

  const cur = git.git(['branch', '--show-current'], repoAbs);
  if (cur.ok && cur.stdout && cur.stdout !== trunk) {
    problems.push(`checked out on "${cur.stdout}", not trunk "${trunk}" — solo commits go straight to trunk`);
  }

  for (const u of unpushedBranches(repoAbs, trunk)) problems.push(`unpushed branch "${u.branch}" (${u.reason})`);

  const dirty = fullyDirty(repoAbs);
  if (dirty.length) problems.push(`tree not clean (${dirty.length} path(s) — tracked or untracked)`);

  return problems;
}

/**
 * Exit-gate problems for `colab solo --done`: tree clean, and the checked-out branch fully pushed
 * to `origin/<trunk>`. Deliberately narrower than the entry gate — `--done` is closing THIS
 * checkout's work, not re-auditing every local branch in the repo.
 */
function exitProblems(repoAbs, trunk) {
  const problems = [];

  const dirty = fullyDirty(repoAbs);
  if (dirty.length) problems.push(`tree not clean (${dirty.length} path(s)) — commit or discard first`);

  const cur = git.git(['branch', '--show-current'], repoAbs);
  const branchName = cur.ok && cur.stdout ? cur.stdout : trunk;
  const upstreamRef = `origin/${trunk}`;
  if (git.git(['rev-parse', '--verify', '--quiet', upstreamRef], repoAbs).ok) {
    const ahead = git.git(['rev-list', '--count', `${upstreamRef}..${branchName}`], repoAbs);
    const n = ahead.ok ? (parseInt(ahead.stdout, 10) || 0) : 0;
    if (n > 0) problems.push(`${n} commit(s) not pushed to ${upstreamRef} — push before closing`);
  }

  return problems;
}

/**
 * Which write-conflict prevention method a repo's `project.yml` declares (`writes:` —
 * CONVENTIONS.md §2 "Writes", project.schema.md "writes — optional"). Fails closed to
 * `'isolated'` on anything unrecognised, the same direction `promotion:` fails closed
 * (toward the safer, more-isolated reading) — never toward `serial`, which is the one
 * that trusts a single writer.
 */
function writesMode(doc) {
  const raw = doc && doc.writes;
  return raw === 'serial' ? 'serial' : 'isolated';
}

/**
 * Is solo flow (the serial trunk-direct cell) legal for this repo, and via which key?
 * `writes: serial` is the only key (#175 removed the `ceremony: light` legacy proxy that
 * #133 introduced as a bridge — no repo can silently ride the old key any more). Returns
 * `{ok:true, via}` or `{ok:false, reason}`.
 */
function soloEligibility(doc) {
  if (writesMode(doc) === 'serial') return { ok: true, via: 'writes' };
  return {
    ok: false,
    reason: 'solo flow requires writes: serial — this repo declares neither',
  };
}

/**
 * The two conditions from CONVENTIONS.md §2 ("Writes") that make a branch mandatory on a
 * `writes: serial` repo, evaluated against state where it can be:
 *
 *   1. units-in-flight — more than one claim/worktree/place-claim already live on the repo.
 *      Machine-decidable from `st`, so `met` is a real boolean.
 *   2. pre-merge-gate — something (CI, review) must inspect the unit before it lands. This is
 *      a DECLARED fact this module cannot see from git/state alone, so `met` is `null` — never
 *      `false`. Returning `false` here would read as "no gate exists", which this function is
 *      not positioned to claim.
 *
 * `mandatory` is `true` only when condition 1 is affirmatively met; a `null` condition 2 never
 * flips `mandatory` to `true` on its own, because "cannot tell" must not read as "cannot apply".
 */
function branchMandatory(st, repoAbs) {
  const wts = Object.values((st && st.worktrees) || {}).filter((w) => w.repo === repoAbs).length;
  const claims = Object.entries((st && st.claims) || {}).filter(([k]) => k.startsWith(`${repoAbs}#`)).length;
  const places = Object.values((st && st.places) || {}).filter((p) => p.repo === repoAbs).length;
  const unitsInFlight = wts + claims + places;
  const unitsMet = unitsInFlight > 1;

  const conditions = [
    {
      id: 'units-in-flight',
      met: unitsMet,
      why: unitsMet
        ? `${unitsInFlight} units in flight on this repo (worktrees+claims+place-claims) — more than one writer`
        : `${unitsInFlight} unit(s) in flight — a single writer needs no branch on this condition alone`,
    },
    {
      id: 'pre-merge-gate',
      met: null,
      why: 'not machine-decidable — a repo declares whether a unit must be inspected before landing; this check cannot see that fact',
    },
  ];

  return { mandatory: unitsMet, conditions };
}

module.exports = { unpushedBranches, fullyDirty, entryProblems, exitProblems, writesMode, soloEligibility, branchMandatory };
