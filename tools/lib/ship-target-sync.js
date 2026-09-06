'use strict';
/**
 * `colab ship` precondition (#322): is the LOCAL merge target in sync with `origin/<target>`?
 *
 * WHY THIS EXISTS — it is not tidiness, it is the door that produced a guard bypass.
 *
 * `ship` squash-merges into the target checkout and THEN pushes it (B1, then B2). Until this
 * check, the only thing standing between those two steps and reality was "trunk checkout ready",
 * which asks whether the checkout is ON trunk and CLEAN — never whether the local ref agrees with
 * the remote. A trunk that was fetched but never fast-forwarded, or that carries a hand-made
 * commit, passes that row unchanged. So B1 completed a merge that B2 could not publish, and the
 * session was left holding a landed local merge with no sanctioned way forward. The refusal it
 * then hit — `pre-push-guard`'s — named the environment variable that opens the guard, so the
 * only visible exit was the bypass. Two independent sessions took it on the same day, one of them
 * reporting it as ordinary housekeeping.
 *
 * Hardening the guard alone would have converted that bypass into a hard stall. This check is the
 * other half: the disagreement is discovered BEFORE the merge, while the remedy is still an
 * ordinary git command instead of an authorization assertion.
 *
 * TWO CLASSES, NOT ONE — and the distinction is the whole point of reporting them separately:
 *   - BEHIND only  → mechanical. A clean checkout strictly behind its remote fast-forwards
 *     losslessly; nobody has to decide anything, so this is SELF-CLEARING.
 *   - AHEAD (or DIVERGED) → a judgement call. Those commits are unpublished work sitting on a
 *     branch that is push-guarded on purpose. The remedy is to move them onto a session branch and
 *     ship THAT — never to publish them by hand, which is exactly the act the guard exists to
 *     refuse. HUMAN-GATED.
 *
 * NOTHING IN THIS FILE NAMES AN ENVIRONMENT VARIABLE, deliberately. A refusal message is read by
 * an agent looking for the next command to type; whatever it names is what gets typed. It names
 * the remedy.
 *
 * `ship` does not fast-forward for you, even in the mechanical case. The write would land in the
 * shared trunk checkout BEFORE ship acquires that checkout's place-claim (which it takes at B1,
 * see #234) — writing into a tree another session may be holding, to save one command, is the
 * trade this repo has repeatedly declined.
 */

/** The precondition's row name — one spelling, shared by the prose table and `--dry --json`. */
const NAME = 'target in sync with origin';

/**
 * Pure classifier: counts in, verdict out. No git, no io — every branch below is reachable from a
 * plain object, which is what makes the four cases testable without a network or a fixture.
 *
 * @param {object} a
 * @param {string} a.target      - the branch being merged INTO (trunk, or a declared line)
 * @param {boolean} a.fetched    - did the remote-tracking ref get refreshed?
 * @param {string} [a.why]       - when `fetched` is false, why not (verbatim, for the detail line)
 * @param {number} [a.ahead]     - commits on local `<target>` that `origin/<target>` does not have
 * @param {number} [a.behind]    - commits on `origin/<target>` that local `<target>` does not have
 * @param {string} [a.repoLabel] - what to put after `git -C` in the remedy (default `<repo>`)
 * @returns {{ok: boolean, cls: string, name: string, detail: string, remedy: string[]}}
 */
function classifyTargetSync(a) {
  const target = a.target;
  const repo = a.repoLabel || '<repo>';
  const remote = `origin/${target}`;

  if (!a.fetched) {
    return {
      ok: false,
      cls: 'unknown',
      name: NAME,
      detail: `could not compare local ${target} with ${remote}: ${a.why || 'unknown reason'}`,
      remedy: [
        `Cannot tell whether ${target} is publishable, and a merge that cannot be pushed is the`,
        'state this check exists to prevent. Restore the comparison, then re-run this ship:',
        `    git -C ${repo} fetch origin ${target}`,
      ],
    };
  }

  const ahead = Number(a.ahead || 0);
  const behind = Number(a.behind || 0);

  if (ahead === 0 && behind === 0) {
    return { ok: true, cls: 'synced', name: NAME, detail: `local ${target} == ${remote}`, remedy: [] };
  }

  const plural = (n) => (n === 1 ? 'commit' : 'commits');

  if (ahead === 0) {
    return {
      ok: false,
      cls: 'behind',
      name: NAME,
      detail: `local ${target} is ${behind} ${plural(behind)} behind ${remote} — the merge would land on a stale base and the push would be rejected`,
      remedy: [
        `Fast-forward the checkout, then re-run this ship (nothing here needs a decision):`,
        `    git -C ${repo} merge --ff-only ${remote}`,
      ],
    };
  }

  const strayLines = [
    `The ${ahead} unpublished ${plural(ahead)} on ${target} ${ahead === 1 ? 'is' : 'are'} work that never went through a branch.`,
    `Publishing ${ahead === 1 ? 'it' : 'them'} straight from here is the act ${target} is push-guarded to refuse — move`,
    `${ahead === 1 ? 'it' : 'them'} onto a session branch and ship that instead:`,
    `    git -C ${repo} log --oneline ${remote}..${target}   # what is actually there`,
    `    git -C ${repo} branch <type>/<slug>-<issue> ${target}   # keep it, on a branch`,
    `    git -C ${repo} reset --hard ${remote}   # return the checkout to at-rest`,
    `then claim its issue and ship that branch. If the ${plural(ahead)} ${ahead === 1 ? 'was' : 'were'} never wanted, the reset`,
    'alone is the whole remedy.',
  ];

  if (behind === 0) {
    return {
      ok: false,
      cls: 'ahead',
      name: NAME,
      detail: `local ${target} has ${ahead} unpushed ${plural(ahead)} ${remote} does not — merging on top would produce a commit ship cannot publish`,
      remedy: strayLines,
    };
  }

  return {
    ok: false,
    cls: 'diverged',
    name: NAME,
    detail: `local ${target} has ${ahead} unpushed ${plural(ahead)} and is ${behind} behind ${remote} — diverged`,
    remedy: strayLines.concat([
      `Then fast-forward before re-running:   git -C ${repo} merge --ff-only ${remote}`,
    ]),
  };
}

/**
 * Read the counts from git and classify. Best-effort fetch first — a comparison against a
 * remote-tracking ref nobody refreshed answers the wrong question with total confidence, the same
 * failure `colab holders` refuses rather than guesses through.
 *
 * @param {object} git      - tools/lib/git (injected so the classifier above stays io-free)
 * @param {string} repoAbs  - the MAIN checkout (where the target branch ref lives)
 * @param {string} target   - branch being merged into
 * @param {object} [opts]
 * @param {string} [opts.repoLabel] - label for the remedy commands (defaults to `repoAbs`)
 * @param {boolean} [opts.fetch]    - set false to compare against whatever is already on disk
 */
function readTargetSync(git, repoAbs, target, opts = {}) {
  const repoLabel = opts.repoLabel || repoAbs;
  const base = { target, repoLabel };

  if (!git.originUrl(repoAbs)) {
    return classifyTargetSync({ ...base, fetched: false, why: 'this repo has no `origin` remote' });
  }
  if (opts.fetch !== false) {
    const f = git.git(['fetch', 'origin', target], repoAbs, { timeoutMs: 60000 });
    if (!f.ok) {
      return classifyTargetSync({
        ...base, fetched: false,
        why: `git fetch origin ${target} failed: ${(f.stderr || 'unknown error').split('\n')[0]}`,
      });
    }
  }
  // `--count --left-right A...B` → "<behind-of-A>\t<ahead-of-A>" is the reading that trips people
  // up; spell the two sides out rather than rely on remembering which column is which.
  const counts = git.git(['rev-list', '--left-right', '--count', `origin/${target}...${target}`], repoAbs);
  if (!counts.ok) {
    return classifyTargetSync({
      ...base, fetched: false,
      why: `could not count commits against origin/${target}: ${(counts.stderr || 'unknown error').split('\n')[0]}`,
    });
  }
  const parts = counts.stdout.split(/\s+/).filter(Boolean).map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    return classifyTargetSync({ ...base, fetched: false, why: `unreadable rev-list output: "${counts.stdout}"` });
  }
  // left = origin/<target> side = commits local is BEHIND by; right = local side = AHEAD by.
  return classifyTargetSync({ ...base, fetched: true, behind: parts[0], ahead: parts[1] });
}

module.exports = { NAME, classifyTargetSync, readTargetSync };
