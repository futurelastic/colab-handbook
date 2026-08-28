'use strict';
/**
 * "The trunk checkout is dirty — whose is it?" (#294).
 *
 * `git status`, wherever this fleet asks it, answers exactly one question: is the repo root
 * dirty. It has no opinion on whose change that is — a working tree carries no metadata linking a
 * line back to a session. CONVENTIONS.md §4 used to fill that gap with an assumption ("an
 * uncommitted file in the shared main checkout is someone else's live, uncommitted work"), and
 * #294 is the measured case where that assumption was exactly backwards: a session's own stray
 * relative-path write, read as someone else's, shipped uninvestigated and left the trunk checkout
 * dirty for every other session's merge to trip over.
 *
 * This module is the attribution GUESS that replaces the assumption — never a certainty. It ranks
 * two signals, in order:
 *
 *   1. BRANCH OVERLAP — does a live worktree's own branch touch this exact path (a real git diff
 *      against its base)? Strong: it is precisely the observed #294 shape, a file edited on both
 *      sides with the trunk copy carrying content the worktree copy does not.
 *   2. TIME WINDOW — was exactly one live worktree's session already open when this path last
 *      changed on disk? Weak and only reached when branch overlap found nothing — an mtime
 *      correlation, not a content fact.
 *
 * Exactly one live worktree matching a signal is `attributed`, more than one is `ambiguous` (the
 * signal picked out a set, not an owner), and neither signal producing a single match is
 * `unattributed` — which covers "no live worktree in this repo" every bit as much as "the file
 * predates every live worktree's session", because both leave nothing to name.
 *
 * PURE BY CONSTRUCTION, same posture as base-ci-verdict.js / ci-verdict.js / shipguard.js: plain
 * data in, a verdict out. No git, no gh, no fs, no clock — the caller (tools/colab) does every
 * subprocess/filesystem read (a `git diff --name-only` per live worktree, an `fs.statSync` per
 * dirty path) and hands this module the numbers it needs. Every branch is directly reachable from
 * `node --test`.
 *
 * ADVISORY ONLY. Nothing here is wired into any precondition — it enriches the ALREADY-COMPUTED
 * "trunk checkout ready" check's `detail` string, never its `ok`/`class`/exit code. A wrong guess
 * here costs a misleading hint in a report; a wrong guess baked into a gate would cost a merge.
 */

/**
 * One porcelain line's path, tolerating a caller whose SOURCE STRING already lost a leading
 * character.
 *
 * The ordinary shape is a 2-character status code, one space, then the path (index 2 is the
 * space) — `git.js`'s own `statusPorcelain` relies on that same fixed offset for its
 * tracked/untracked split. But this module's callers hand in `git.dirtyTracked(...)`'s return
 * value, and `git.js`'s `run()` wrapper `.trim()`s the ENTIRE multi-line status blob as ONE
 * string before it is ever split into lines — so when the very first porcelain line in that blob
 * begins with a literal space (an unstaged-only change, e.g. ` M path.md`), that space is the
 * first character of the whole blob and is stripped, shifting just that one line to a
 * 1-character-code + space + path shape (`M path.md`). Which line (if any) was first is already
 * lost by the time this module sees the filtered, joined string, so this checks each line's own
 * shape rather than assuming a fixed position: index 2 is the space in the ordinary case, index 1
 * in the shifted one. (This is a property of the shared `git.js` wrapper, not a bug in it worth
 * fixing there — `dirtyTracked`'s callers elsewhere only ever treat its return value as an opaque
 * "is something dirty" string, never parse it positionally, which is exactly why this narrow case
 * was never visible before #294 needed to read a PATH out of it.)
 *
 * A rename line reads `R  old -> new`; the path this module (and every caller attributing a
 * CURRENT dirty file) cares about is the destination, so `-> ` wins when present.
 */
function pathFromPorcelainLine(line) {
  let rest;
  if (line.length > 2 && line[2] === ' ') rest = line.slice(3);
  else if (line.length > 1 && line[1] === ' ') rest = line.slice(2);
  else rest = line;
  const arrow = rest.indexOf(' -> ');
  return arrow === -1 ? rest : rest.slice(arrow + 4);
}

/** Parse `git status --porcelain [-uall]` output into a plain list of repo-relative paths. */
function parsePorcelainPaths(porcelainText) {
  if (!porcelainText) return [];
  return String(porcelainText).split('\n').filter(Boolean).map(pathFromPorcelainLine);
}

function toCandidate(wt, confidence) {
  return {
    worktree: wt.name,
    branch: wt.branch || null,
    session: wt.session || null,
    sessionName: wt.sessionName || null,
    confidence,
  };
}

/**
 * `dirtyPaths`: array of `{ path, mtimeMs }` (or a bare path string when no mtime is known —
 * mtimeMs then reads as `null`). `worktrees`: array of `{ name, branch, session, sessionName,
 * touchedPaths, createdAtMs }` — every entry the CALLER already judged to be a live candidate;
 * this module does not itself decide which worktrees count as live (that is `colab`'s own
 * `st.worktrees[...].status` reading, not a fact this module can derive from the shapes it is
 * handed). `touchedPaths` is that worktree's branch's own `git diff --name-only <base>...<branch>`
 * output; `createdAtMs` is `null` when the caller could not resolve a timestamp.
 *
 * Returns `{ paths: [{ path, verdict, candidates, why }] }` — one entry per input path, in the
 * same order, `verdict` one of `attributed | ambiguous | unattributed`.
 */
function attributeDirtyPaths({ dirtyPaths, worktrees }) {
  const wts = Array.isArray(worktrees) ? worktrees : [];
  const inputs = Array.isArray(dirtyPaths) ? dirtyPaths : [];
  const paths = inputs.map((entry) => {
    const p = typeof entry === 'string' ? entry : entry.path;
    const mtimeMs = typeof entry === 'string' ? null
      : (typeof entry.mtimeMs === 'number' ? entry.mtimeMs : null);
    return attributeOne(p, mtimeMs, wts);
  });
  return { paths };
}

function attributeOne(p, mtimeMs, wts) {
  const branchHits = wts.filter((w) => Array.isArray(w.touchedPaths) && w.touchedPaths.includes(p));
  if (branchHits.length === 1) {
    return {
      path: p, verdict: 'attributed', candidates: [toCandidate(branchHits[0], 'branch-overlap')],
      why: `${branchHits[0].branch || branchHits[0].name}'s own branch diff touches this path`,
    };
  }
  if (branchHits.length > 1) {
    return {
      path: p, verdict: 'ambiguous', candidates: branchHits.map((w) => toCandidate(w, 'branch-overlap')),
      why: `${branchHits.length} live branches touch this path — no single owner`,
    };
  }

  if (mtimeMs != null) {
    const timeHits = wts.filter((w) => typeof w.createdAtMs === 'number' && w.createdAtMs <= mtimeMs);
    if (timeHits.length === 1) {
      return {
        path: p, verdict: 'attributed', candidates: [toCandidate(timeHits[0], 'time-window')],
        why: `only ${timeHits[0].branch || timeHits[0].name}'s session was open when this path last ` +
          'changed — weak signal, no branch touched it directly',
      };
    }
    if (timeHits.length > 1) {
      return {
        path: p, verdict: 'ambiguous', candidates: timeHits.map((w) => toCandidate(w, 'time-window')),
        why: `${timeHits.length} live sessions were already open when this path last changed — no single owner`,
      };
    }
  }

  return {
    path: p, verdict: 'unattributed', candidates: [],
    why: wts.length === 0
      ? 'no live worktree in this repo to attribute to'
      : 'no live branch touches this path, and it predates every live session (or no mtime was available)',
  };
}

module.exports = { attributeDirtyPaths, parsePorcelainPaths };
