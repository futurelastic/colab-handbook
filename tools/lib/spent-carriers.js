'use strict';
/**
 * #760 — is a remote branch that carries `#N` in its name still a claim on `#N`, or is it spent?
 *
 * `colab claim` refuses when a branch on the remote carries `#N` and is not this machine's
 * (tools/docs/claims.md, *Record of a claim*). Two kinds of branch kept refusing after their work
 * was over, and on a REOPENED issue they refused every new start on it, the automated fixer
 * included (measured: 98 refused starts over about 20 hours on one repo):
 *
 *   1. a branch that already SHIPPED — squash-merged, then left on the remote. A squash mints a new
 *      commit, so the branch tip is never an ancestor of trunk and the branch reads as live;
 *   2. a PREPARED REVERT named for the issue (`<type>/revert-<sha>-N`), cut by a trunk-red bisect
 *      and never pushed through CI.
 *
 * This module decides "spent" for those two shapes and nothing else, and it fails toward "still a
 * carrier" every time it cannot prove otherwise — refusing a free issue costs a delete command,
 * skipping a live holder costs two sessions merging over each other.
 *
 * SHIPPED, proof one = all four, never fewer:
 *   - landed.js says `landed` by CONTENT (`git merge-tree`: merging the branch would not change
 *     trunk's tree). Never `git cherry` — a squash of more than one commit shares no patch-id with
 *     any of them (landed.js, "WHY NOT git cherry"). Never the two-signal fallback either: it calls
 *     a branch with zero commits ahead `landed`, and that is exactly a branch cut a minute ago;
 *   - at least one commit ahead of trunk. A branch with none may be freshly cut and pushed (no
 *     commits is not no branch — code-start §3); the squash shape always has some;
 *   - a commit on trunk whose message references `#N` — the ship that closed it. Its sha is the
 *     evidence printed, so a human can check the skip before deleting the ref;
 *   - an `unknown` from landed.js is NOT landed: the branch stays a carrier.
 *
 * SHIPPED, proof two — for when proof one has no answer: the branch tip's TREE is the tree of a
 * trunk commit whose message references `#N`, and the branch has at least one commit ahead. That is
 * the shape a ship leaves when it brought trunk into the branch first and then squashed: the squash
 * commit IS the branch's tree. It survives trunk later rewriting the same lines, where merge-tree
 * conflicts and proof one says `unknown` — measured on this repo's own remote: a branch shipped as
 * two squash commits, its lines since edited on trunk, `unknown` by content and an exact tree match
 * with the first of them.
 *
 * PREPARED REVERT = the name's last segment is `revert-<hex sha, 7..40>-<N…>`, `#N` is in that
 * trailing run, and the sha names a commit already on trunk — the commit being reverted. Matching
 * the segment as a whole means an all-digit short sha is read as the sha, never as an issue number.
 * The issue's Done-when settles which issue a revert named for `#N` is skipped for: `#N` itself. A
 * session genuinely working a revert still holds the claim LOCK `refs/heads/claim/<N>`, which this
 * module never touches, so it stays visible and still refuses.
 *
 * Not covered, on purpose: a shipped branch whose change trunk has since reverted reads as cargo
 * again and stays a carrier (the status quo); a legacy claim ref `refs/claims/<branch>` points at
 * the commit it was cut from, so "on trunk" says nothing about it and it is never considered here.
 *
 * Network: ONE fetch, and only when there is at least one candidate — the clean path of a claim
 * stays exactly as fetch-free as before. A failed fetch, or a branch that moved between the
 * `ls-remote` and the fetch, keeps every affected candidate a carrier.
 */

const git = require('./git.js');
const landed = require('./landed.js');
const branchName = require('./branch-name.js');

const REVERT_SEGMENT = /^revert-([0-9a-f]{7,40})-(\d+(?:-\d+)*)$/;

/** `<type>/revert-<sha>-<N…>` → `{ sha, issues }`, or null. Pure. */
function revertShape(branch) {
  const b = String(branch || '');
  if (!branchName.parse(b)) return null;
  const m = REVERT_SEGMENT.exec(b.split('/').pop());
  if (!m) return null;
  return { sha: m[1], issues: m[2].split('-').map(Number).filter((n) => Number.isInteger(n) && n > 0) };
}

/** Does a commit message reference `#num` (not `#num0`, not `#1num`)? Pure. */
function referencesIssue(message, num) {
  return new RegExp(`(^|[^0-9A-Za-z_&])#${Number(num)}(?![0-9])`).test(String(message || ''));
}

/**
 * The pure verdict — facts in, `{ spent, reason, why }` out. `reason` is `'revert'` or `'shipped'`
 * when spent, null otherwise; `why` is the human sentence either way.
 *
 * facts: { num, revert: revertShape()|null, revertOnTrunk: bool, landed: landedState()|null,
 *          refCommit: short sha of a trunk commit referencing #num | '',
 *          treeCommit: short sha of a trunk commit referencing #num whose tree IS the tip's | '',
 *          trunk: name }
 */
function verdict({ num, revert, revertOnTrunk, landed: l, refCommit, treeCommit = '', trunk }) {
  if (revert && revert.issues.includes(Number(num)) && revertOnTrunk === true) {
    return { spent: true, reason: 'revert', why: `prepared revert of ${revert.sha} (on ${trunk}), not a claim` };
  }
  if (!l || !Number.isInteger(l.commitsAhead) || l.commitsAhead < 1) {
    return { spent: false, reason: null, why: 'no commits ahead of trunk — may be freshly cut' };
  }
  if (l.state === 'landed' && l.method === 'content' && refCommit) {
    return { spent: true, reason: 'shipped', why: `already shipped — its change is on ${trunk} (${refCommit} references #${num})` };
  }
  if (treeCommit) {
    return { spent: true, reason: 'shipped', why: `already shipped — its tree is ${treeCommit} on ${trunk}, which references #${num}` };
  }
  if (l.state !== 'landed' || l.method !== 'content') {
    return { spent: false, reason: null, why: l.why || 'no content answer' };
  }
  return { spent: false, reason: null, why: `no commit on ${trunk} references #${num}` };
}

/**
 * The git half. `candidates` = `[{ num, branch, sha }]` (sha short, from `ls-remote`), each a remote
 * BRANCH head that carries `num` and is not this machine's. Returns
 * `{ kept: [...candidates still carriers], skipped: [{ ...candidate, reason, why }], warning }`.
 */
function partitionSpent(repoAbs, remote, trunk, candidates) {
  const list = candidates || [];
  if (!list.length || !remote || !trunk) return { kept: list, skipped: [], warning: null };

  const branches = [...new Set(list.map((c) => c.branch))];
  const specs = [`+refs/heads/${trunk}:refs/remotes/${remote}/${trunk}`,
    ...branches.map((b) => `+refs/heads/${b}:refs/remotes/${remote}/${b}`)];
  const f = git.git(['fetch', '--quiet', '--no-tags', remote, ...specs], repoAbs, { timeoutMs: 120_000 });
  if (!f.ok) {
    const why = String(f.stderr || (f.timedOut ? 'fetch timed out' : `exit ${f.code}`)).split('\n').filter(Boolean)[0] || 'fetch failed';
    return { kept: list, skipped: [], warning: `could not fetch to check whether ${branches.length === 1 ? 'that branch is' : 'those branches are'} already shipped (${why}) — counted as claims (#760)` };
  }

  const trunkRef = `${remote}/${trunk}`;
  // Trunk commits whose message references #num, newest first: `[{ sha (short), tree }]`.
  const refCommits = new Map();
  const refCommitsFor = (num) => {
    if (!refCommits.has(num)) {
      const r = git.git(['log', '-E', `--grep=#${num}([^0-9]|$)`, '--format=%h%x00%T%x00%B%x1e', '-n', '50', trunkRef], repoAbs);
      const hits = r.ok ? r.stdout.split('\x1e').map((e) => e.replace(/^\n/, '').split('\x00'))
        .filter(([sha, tree, body]) => sha && tree && referencesIssue(body, num)).map(([sha, tree]) => ({ sha, tree })) : [];
      refCommits.set(num, hits);
    }
    return refCommits.get(num);
  };

  const kept = [];
  const skipped = [];
  for (const c of list) {
    const tip = git.git(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${c.branch}^{commit}`], repoAbs);
    if (!tip.ok || !c.sha || !tip.stdout.startsWith(String(c.sha))) { kept.push(c); continue; } // moved since ls-remote

    const revert = revertShape(c.branch);
    let revertOnTrunk = false;
    if (revert) {
      const sha = git.git(['rev-parse', '--verify', '--quiet', `${revert.sha}^{commit}`], repoAbs);
      revertOnTrunk = sha.ok && git.git(['merge-base', '--is-ancestor', sha.stdout, trunkRef], repoAbs).code === 0;
    }
    const isRevert = !!(revert && revertOnTrunk && revert.issues.includes(Number(c.num)));
    const l = isRevert ? null : landed.landedState(repoAbs, trunkRef, `${remote}/${c.branch}`);
    const refs = l && Number.isInteger(l.commitsAhead) && l.commitsAhead > 0 ? refCommitsFor(c.num) : [];
    const tipTree = refs.length ? git.git(['rev-parse', `${tip.stdout}^{tree}`], repoAbs) : null;
    const treeHit = tipTree && tipTree.ok ? refs.find((r) => r.tree === tipTree.stdout) : null;
    const v = verdict({ num: c.num, revert, revertOnTrunk, landed: l, refCommit: refs.length ? refs[0].sha : '',
      treeCommit: treeHit ? treeHit.sha : '', trunk });
    if (v.spent) skipped.push({ ...c, reason: v.reason, why: v.why });
    else kept.push(c);
  }
  return { kept, skipped, warning: null };
}

module.exports = { revertShape, referencesIssue, verdict, partitionSpent };
