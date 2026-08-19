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
const writesAuthority = require('./writes-authority.js');

// #237 (⚖ Decision on #233): `writes` stopped selecting a write-conflict prevention METHOD and
// became a two-state VETO — see writes-authority.js's header. `writesMode` and the old
// `soloEligibility` below (which keyed off `resolveWrites(...).value === 'serial-direct'`) are
// retired with it. Eligibility is now a SESSION-IDENTITY question — is a human at the keyboard,
// asserted with COLAB_HUMAN=1 — gated by the veto, not selected by a declared method.

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
 *
 * Deliberately does NOT refuse merely because a worktree exists somewhere in this repo (#236), nor
 * because a claim is held somewhere in this repo (#240) — the same category error, twice. The claim
 * registry (lib/state.js `claims`) holds an *issue*, not a *place* (lib/place.js header): a claim
 * tied to a worktree elsewhere is that worktree's business, not this checkout's, and a worktree is a
 * different directory with a different checkout — a session writing there is not a writer of the
 * checkout solo flow is about to commit straight to, and cannot become one. The resource this gate
 * protects is `repoAbs`'s own checkout, not the repo as a whole: `cmdSolo` covers that
 * checkout-scoped conflict separately, via `place.conflict` against a live place-claim held here
 * (CONVENTIONS.md, "Solo flow", rule 1) — the thing a worktree or an off-checkout claim can never
 * be. A claim taken directly against the trunk checkout (no worktree) already acquires that same
 * place-claim at claim time (`cmdClaim`'s `takingPlace` path), so `place.conflict` catches it too;
 * nothing here needs to re-check the claim registry to see it.
 */
function entryProblems(st, repoAbs, trunk) {
  const problems = [];

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
 * Is solo flow (trunk-direct) legal for this repo right now, and on what authority?
 *
 * #237 (⚖ Decision on #233): eligibility is a SESSION-IDENTITY question, gated by the veto —
 * not a declared-method question. `writes: isolated` refuses outright, for a human exactly as
 * for an automated session — no flag lowers that bar. Absence, and every other declared value
 * (both `serial-*` spellings, the `serial` alias, anything unrecognised), permit trunk-direct
 * to an ATTENDED session: `human` must be `true`, asserted by the CALLER from `COLAB_HUMAN=1`
 * (transcribed on the human's explicit instruction, never inferred, and never from a headless,
 * scheduled or driver session — CONVENTIONS.md §5, "The human flag").
 *
 * Deliberately does NOT read `process.env` itself — this module's header states every function
 * here is pure with respect to external state, and that split is what lets a test drive both
 * branches without mutating the ambient environment. The CLI (`tools/colab`'s `cmdSolo`) reads
 * `COLAB_HUMAN` and passes the boolean in.
 *
 * `human` defaults to `false` so a caller that forgets the argument fails CLOSED (refused), not
 * open. The veto is checked FIRST: a vetoed repo must never be told "re-run with COLAB_HUMAN=1"
 * — that would advertise a route around a bar no flag may lower.
 *
 * Returns `{ok:true, via:'human'}` or `{ok:false, code, reason}` where `code` is `'veto'`
 * (writes: isolated — no flag can change this) or `'not-human'` (set COLAB_HUMAN=1).
 */
function soloEligibility(doc, { human = false } = {}) {
  if (writesAuthority.trunkDirectVetoed(doc && doc.writes)) {
    return {
      ok: false,
      code: 'veto',
      reason: 'solo flow is refused here: this repo declares writes: isolated, which vetoes '
        + 'trunk-direct for every session, human or not (CONVENTIONS.md, Writes). Use a '
        + 'worktree and a branch.',
    };
  }
  if (!human) {
    return {
      ok: false,
      code: 'not-human',
      reason: 'solo flow commits straight to trunk and requires a human at the keyboard: '
        + 're-run with COLAB_HUMAN=1, set only on a human\'s explicit instruction — never '
        + 'inferred, and never from a headless, scheduled or driver session. (No field, flag '
        + 'or project.yml value can lower this bar.)',
    };
  }
  return { ok: true, via: 'human' };
}

/**
 * The two conditions from CONVENTIONS.md §2 ("Writes") that make a branch mandatory for an
 * ATTENDED trunk-direct session (#237: every other kind of session has a branch by construction
 * — a worktree — so this now governs solo flow specifically, not a declared `writes: serial`
 * method), evaluated against state where it can be:
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

module.exports = { unpushedBranches, fullyDirty, entryProblems, exitProblems, soloEligibility, branchMandatory };
