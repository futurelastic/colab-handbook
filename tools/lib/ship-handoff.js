'use strict';
/**
 * #578 — `colab ship --branch <br> --handoff <comment-url>`: land a branch whose claim lives on
 * ANOTHER machine, from the hand-off its executor already recorded, without `--force`.
 *
 * The problem. `colab ship` takes the issue set to close from THIS machine's claim registry only.
 * A branch built and wrapped on machine A and landed from machine B has its claim in A's registry,
 * so on B ship reads zero claims and refuses (#153 / #324). The only way to write a record on B was
 * `colab claim --force` — a human-only takeover — so an agent lander had no sanctioned path, and
 * every remote-built branch waited for a person even when it had passed review and merged clean.
 *
 * The door. The executor has already said, on the tracker, which branch it handed off and at which
 * head. That comment, checked against git and against the executor's own live claim, is the
 * evidence ship would otherwise get from a local claim. Nothing on B's registry is written and
 * nothing of A's is taken over: A keeps its claim, worktree and branch until it confirms the land
 * (its own `colab worktree rm`, which releases the claim as usual).
 *
 * What a hand-off must prove, in order — the first failure is the verdict:
 *   1. the URL is an issue-comment URL (`…/issues/<N>#issuecomment-<id>`);
 *   2. the comment was read from THIS repo (fetched through `{owner}/{repo}`, so an off-repo id is a
 *      404) and its own html_url names the same issue the URL does;
 *   3. that issue is one the branch NAME carries (its trailing number run, CONVENTIONS.md §4) — the
 *      issue set is exactly that run, so git corroborates every `Closes #N` (#87) by construction;
 *   4. the body names the branch, as a whole token;
 *   5. the branch exists on the remote, and this machine holds no diverging copy of its own;
 *   6. the body names a sha that is a prefix of the remote branch's CURRENT head — a branch that
 *      moved after its hand-off was not handed off at that head, and lands only after a new one.
 *      ONE movement is not "moved" (#579): base-sync merges stacked on the handed-off head. The
 *      stale-base gate (#395) sends every behind-trunk branch through B0's sync, and the sync moves
 *      the head; without this a remote-built branch that fell behind could land only after its
 *      executor — whose session has usually ended — posted again. A sync merge is accepted only
 *      when it adds nothing of its own (syncMergeChain, below): two parents, the second already on
 *      the base, and a tree equal to git's own clean merge of the two. Any other commit after the
 *      handed-off sha — a fix-up, a rebase, a hand-resolved conflict — is still `head-moved`;
 *   7. every issue the branch carries has a LIVE `🔒 Claimed` comment naming this branch, posted by
 *      the hand-off's author before the hand-off — the claim really does live elsewhere, and the
 *      party handing off is the party holding it.
 *      ONE exemption (#647): an issue the trailing run carries that was already CLOSED before the
 *      hand-off was posted only names history (a flaky test named after it) — it needs no claim, and
 *      goes back in `refIssues` so the squash says `Refs #A` and ship neither closes it nor posts a
 *      ship comment on it. Closed AFTER the hand-off is no exemption: closing an issue must never
 *      launder away the claim it lacked. An issue whose state could not be read is not exempt. Every
 *      OPEN issue still needs its claim, `--refs` or not — `--refs` decides Closes vs Refs, never who
 *      may land; and at least one issue must remain to close, or there is nothing handed off.
 *
 * Pure: every input is already read. tools/colab does the IO (`gh api`, `git fetch`, issue views).
 */

const { branchIssueNumbers } = require('./branch-name');

/** `https://github.com/<o>/<r>/issues/<N>#issuecomment-<id>` → parts, or null. Host-agnostic (GHE). */
function parseHandoffUrl(url) {
  const m = String(url || '').trim().match(/^https?:\/\/[^/\s]+\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)\/?#issuecomment-(\d+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], issue: Number(m[3]), commentId: m[4] };
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }

/** Does `body` name `branch` as a whole token (not as a prefix of a longer branch name)? */
function namesBranch(body, branch) {
  if (!branch) return false;
  return new RegExp(`(^|[^A-Za-z0-9._/-])${escapeRe(branch)}(?![A-Za-z0-9._/-])`).test(String(body || ''));
}

/** Every 7–40 hex token in `body`, lower-cased — the candidate head shas a hand-off names. */
function namedShas(body) {
  return [...String(body || '').matchAll(/(?<![0-9A-Za-z])([0-9a-fA-F]{7,40})(?![0-9A-Za-z])/g)]
    .map((m) => m[1].toLowerCase());
}

/**
 * The verdict. Inputs:
 *   url          — the --handoff value
 *   comment      — { body, login, createdAt, htmlUrl } as read from THIS repo, or null (unreadable)
 *   branch       — the branch being shipped
 *   refs         — git.branchRefs(): { localSha, remoteSha, localFromRemote }
 *   claimsByIssue — { [n]: [{ login, branch, at, host, machine }] } live claim comments per issue,
 *                  or null for an issue whose comments could not be read
 *   syncChain    — (#579) the first-parent ancestors of the remote head reached through pure
 *                  base-sync merges only, nearest first (syncMergeChain's output); [] or absent = none
 *   issueStates  — (#647) { [n]: { state, closedAt } } per issue as read now; a missing entry is
 *                  unknown and earns no exemption
 *   refNumbers   — (#647) the --refs numbers; used only to say why they do not waive a claim
 * Returns { ok: true, issues, refIssues, sha, handedOff, syncMerges, executor, url } or { ok: false, reason, detail }.
 * `issues` is the whole trailing run; `refIssues` is its closed-before-the-hand-off subset (#647).
 * `sha` is what lands (the remote head); `handedOff` is the sha the hand-off named — equal to `sha`
 * unless the head was synced, in which case `syncMerges` counts the merges between them.
 */
function handoffVerdict({ url, comment, branch, refs, claimsByIssue, syncChain, issueStates, refNumbers }) {
  const no = (reason, detail) => ({ ok: false, reason, detail });
  const u = parseHandoffUrl(url);
  if (!u) return no('bad-url', `--handoff ${url || '(empty)'} is not an issue-comment URL (…/issues/<N>#issuecomment-<id>)`);
  if (!comment) return no('unreadable', `comment ${u.commentId} could not be read from this repo — it must be a comment on one of this repo's issues`);
  const got = parseHandoffUrl(comment.htmlUrl);
  if (!got || got.commentId !== u.commentId || got.issue !== u.issue ||
      got.owner.toLowerCase() !== u.owner.toLowerCase() || got.repo.toLowerCase() !== u.repo.toLowerCase()) {
    return no('mismatch', `the URL says ${u.owner}/${u.repo}#${u.issue}, but comment ${u.commentId} is ${comment.htmlUrl || 'somewhere else'}`);
  }
  const issues = branchIssueNumbers(branch);
  if (!issues.length) return no('branch-names-no-issue', `${branch} carries no trailing issue number, so a hand-off has no issue set to close — ship it with --adopt if it genuinely has none`);
  if (!issues.includes(u.issue)) return no('not-this-branch', `the hand-off is on #${u.issue}, which ${branch} does not carry (${issues.map((n) => '#' + n).join(' ')})`);
  if (!namesBranch(comment.body, branch)) return no('branch-not-named', `the hand-off comment does not name the branch ${branch}`);
  if (!refs || !refs.remoteSha) return no('no-remote-branch', `${branch} is not on the remote — a hand-off lands a pushed branch only`);
  // Ship merges the local ref when one exists (shipRefFor), so it must BE the remote head: a stale
  // copy a DWIM checkout made earlier would land a sha the hand-off never named.
  if (refs.localSha && refs.localSha !== refs.remoteSha) {
    return no('local-diverges', refs.localFromRemote
      ? `this machine's ${branch} (${refs.localSha.slice(0, 8)}, created from the remote by an earlier checkout) is behind or apart from the remote's (${refs.remoteSha.slice(0, 8)}) — reset it to the remote's (git branch -f ${branch} <remote>/${branch}, from a checkout not on it) and re-run`
      : `this machine has its own ${branch} (${refs.localSha.slice(0, 8)}) that differs from the remote's (${refs.remoteSha.slice(0, 8)}) — not a remote-built branch here`);
  }
  const head = String(refs.remoteSha).toLowerCase();
  const shas = namedShas(comment.body);
  // #579: the head itself first, then each sha a pure base-sync merge sits on, nearest first.
  const lineage = [head, ...(Array.isArray(syncChain) ? syncChain : []).map((x) => String(x).toLowerCase())];
  const at = lineage.findIndex((l) => shas.some((s) => l.startsWith(s)));
  if (at < 0) {
    const synced = lineage.length > 1 ? ` (nor ${lineage.length - 1 === 1 ? 'the sha' : 'any of the ' + (lineage.length - 1) + ' shas'} its base-sync merges sit on)` : '';
    return no('head-moved', shas.length
      ? `the hand-off names ${shas.map((s) => s.slice(0, 8)).join(', ')}, but the remote ${branch} is at ${head.slice(0, 8)}${synced} — the branch moved after it was handed off by more than a clean merge of its base; ask its executor for a new hand-off`
      : `the hand-off names no head sha — it must say which commit it hands off (the remote is at ${head.slice(0, 8)})`);
  }
  const refIssues = issues.filter((n) => closedBefore(issueStates && issueStates[n], comment.createdAt));
  if (refIssues.length === issues.length) {
    return no('nothing-to-close', `every issue ${branch} carries (${issues.map((n) => '#' + n).join(' ')}) was closed before the hand-off — there is no open, claimed issue for it to land`);
  }
  const waived = new Set((refNumbers || []).map(Number));
  let executor = null;
  for (const n of issues) {
    if (refIssues.includes(n)) continue;
    const live = claimsByIssue ? claimsByIssue[n] : null;
    if (!live) return no('claims-unreadable', `#${n}'s comments could not be read — the executor's claim cannot be checked`);
    const match = live.find((c) => c.branch === branch && c.login === comment.login && c.at < comment.createdAt);
    if (!match) {
      const st = issueStates && issueStates[n];
      const why = st && String(st.state).toUpperCase() === 'CLOSED'
        ? ` (it was closed at ${st.closedAt || 'an unreadable time'}, not before the hand-off at ${comment.createdAt} — only an issue already closed when the hand-off was posted needs no claim)`
        : waived.has(n) ? ' (--refs keeps it open in the squash; it does not waive the claim of an open issue)' : '';
      return no('no-executor-claim', `#${n} has no live 🔒 claim on ${branch} by ${comment.login || 'the hand-off author'} posted before the hand-off${why} — ` +
        'the hand-off must come from the party holding the claim');
    }
    if (!executor) executor = { login: match.login, host: match.host, machine: match.machine || '' };
  }
  return { ok: true, issues, refIssues, sha: refs.remoteSha, handedOff: lineage[at], syncMerges: at, executor, url: String(url).trim() };
}

/** #647: was this issue CLOSED strictly before `at` (the hand-off's createdAt)? Unknown ⇒ false. */
function closedBefore(st, at) {
  if (!st || String(st.state || '').toUpperCase() !== 'CLOSED') return false;
  const c = Date.parse(st.closedAt || '');
  const h = Date.parse(at || '');
  return Number.isFinite(c) && Number.isFinite(h) && c < h;
}

/**
 * The squash trailer recording the door the issue set came through. It names the HANDED-OFF sha —
 * the one the executor vouched for — and, after a sync (#579), the head that actually landed.
 */
function handoffTrailer(v) {
  if (!v || !v.ok) return '';
  const handed = String(v.handedOff || v.sha).slice(0, 12);
  const synced = v.syncMerges ? ` (synced to ${String(v.sha).slice(0, 12)} by ${v.syncMerges} base merge${v.syncMerges === 1 ? '' : 's'})` : '';
  return `Colab-Handoff: ${v.url} @ ${handed}${synced}`;
}

/**
 * #579 — walk the remote head's first-parent line while each commit is a PURE base-sync merge, and
 * return the shas it sits on, nearest first. A commit qualifies only when all three hold:
 *   - exactly two parents (a squash, a rebase, a cherry-pick or a fix-up has one);
 *   - its second parent is already on the base (`merge-base --is-ancestor p2 <baseRef>`) — it
 *     brought in landed base content, not a side branch;
 *   - its tree equals `git merge-tree --write-tree p1 p2`'s — git's own conflict-free merge of the
 *     two. A conflict (exit 1) or a hand-edited result (a different tree) is NOT pure: someone wrote
 *     content into it, and only the executor can vouch for content.
 * The walk stops at the first commit that fails, so a sync merge stacked on a fix-up yields only
 * the fix-up's sha — which a hand-off naming the commit before the fix-up does not match.
 *
 * `run(args)` is git in the repo, returning { ok, code, stdout } (tools/lib/git.js `git`). A git
 * too old for `merge-tree --write-tree` (< 2.38) proves nothing, so the chain is just empty there:
 * the hand-off then needs the exact head, exactly as before #579.
 */
function syncMergeChain(run, head, baseRef, maxDepth = 50) {
  const chain = [];
  let cur = String(head || '');
  for (let i = 0; cur && i < maxDepth; i++) {
    const p = run(['rev-list', '--parents', '-n', '1', cur]);
    if (!p.ok) break;
    const parts = String(p.stdout).trim().split(/\s+/);
    if (parts.length !== 3) break;
    const [, p1, p2] = parts;
    if (run(['merge-base', '--is-ancestor', p2, baseRef]).code !== 0) break;
    const mt = run(['merge-tree', '--write-tree', p1, p2]);
    if (mt.code !== 0) break;
    const merged = String(mt.stdout).split('\n')[0].trim();
    const tree = run(['rev-parse', `${cur}^{tree}`]);
    if (!tree.ok || !/^[0-9a-f]{40,64}$/.test(merged) || merged !== String(tree.stdout).trim()) break;
    chain.push(p1.toLowerCase());
    cur = p1;
  }
  return chain;
}

/**
 * #591 — `--batch b1,b2@<handoff-url>`: split the batch list into member branch names and, for the
 * members built on another machine, the hand-off each one names. One list, one source: the `@` rides
 * the member it belongs to, so the hand-off cannot drift from the member list the way a second
 * `--handoffs` map could. Each entry splits on its FIRST `@` — a §4 branch name never holds one, and
 * a hand-off URL never holds a `,`. The URL itself is judged later by handoffVerdict, exactly as a
 * single `--handoff` is, so a malformed one is refused with today's message, not a new one.
 * Returns { members: [branch…] (deduped, in order), handoffs: { [branch]: url }, errors: [msg…] }.
 */
function parseBatchEntries(list) {
  const members = [];
  const handoffs = {};
  const errors = [];
  for (const raw of String(list || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const at = raw.indexOf('@');
    const branch = (at < 0 ? raw : raw.slice(0, at)).trim();
    const url = at < 0 ? '' : raw.slice(at + 1).trim();
    if (!branch) { errors.push(`"${raw}" names a hand-off but no branch — write <branch>@<hand-off-url>`); continue; }
    if (at >= 0 && !url) { errors.push(`"${raw}" has an @ but no hand-off URL after it`); continue; }
    if (url) {
      if (handoffs[branch] && handoffs[branch] !== url) { errors.push(`${branch} is named with two different hand-offs (${handoffs[branch]}, ${url})`); continue; }
      handoffs[branch] = url;
    }
    if (!members.includes(branch)) members.push(branch);
  }
  return { members, handoffs, errors };
}

/**
 * #591 — read a `Colab-Handoff:` trailer back off a squash commit body (handoffTrailer's inverse):
 * `{ url, handedOff }` or null. A batch lands in a second call, so the member's door is read from
 * the commit the combined run graded, never re-supplied on the command line.
 */
function parseHandoffTrailer(body) {
  const m = String(body || '').match(/^Colab-Handoff: (\S+) @ ([0-9a-f]{7,40})\b/m);
  return m ? { url: m[1], handedOff: m[2] } : null;
}

module.exports = { parseHandoffUrl, namesBranch, namedShas, handoffVerdict, closedBefore, handoffTrailer, syncMergeChain, parseBatchEntries, parseHandoffTrailer };
