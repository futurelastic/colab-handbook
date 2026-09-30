'use strict';
/**
 * #394 (ruled D) — the owner's branch: a repo the fleet builds in but does not own.
 *
 * `project.yml` may declare
 *
 *     owner:
 *       branch: master        # the owner's branch — required when the block is present
 *       remote: origin        # optional; the repo's own remote when absent
 *
 * `trunk:` stays the fleet's integration branch, and per-issue landing (`colab ship`) is unchanged.
 * The owner's branch is reached ONLY by one pull request from trunk that the owner merges himself
 * (`colab deliver`). No colab command may move that branch — `refuseMove()` is the one guard every
 * branch-moving push site asks.
 *
 * The key is `owner:`, not `upstream:`: "upstream" already names a different thing in CONVENTIONS
 * §8 (a consumer filing a changed convention meaning back to the handbook) and, in git, a branch's
 * tracking ref. A third meaning of the same word would be read wrong by somebody.
 *
 * Everything here is pure: the CLI does the git/gh reads and hands the results in.
 */

const RESERVED = new Set(['trunk']);

/**
 * Read the block. Absent → `{ declared: false }` (and every caller behaves exactly as before the
 * key existed). Present → `{ declared: true, branch, remote, problems[] }`; a non-empty `problems`
 * means the block is malformed and callers must fail closed.
 */
function read(doc) {
  if (!doc || !Object.prototype.hasOwnProperty.call(doc, 'owner') || doc.owner === null || doc.owner === undefined) {
    return { declared: false, branch: null, remote: null, problems: [] };
  }
  const raw = doc.owner;
  const problems = [];
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(`owner must be a block with "branch:" (and optionally "remote:"), found ${JSON.stringify(raw)}`);
    return { declared: true, branch: null, remote: null, problems };
  }
  for (const k of Object.keys(raw)) {
    if (k !== 'branch' && k !== 'remote') problems.push(`owner has an unknown key "${k}" — only "branch" and "remote" are defined`);
  }
  const branch = raw.branch === null || raw.branch === undefined ? '' : String(raw.branch).trim();
  const remote = raw.remote === null || raw.remote === undefined ? null : String(raw.remote).trim() || null;
  if (!branch) problems.push('owner is declared without "branch:" — name the owner\'s branch the delivery PR targets');
  else if (RESERVED.has(branch)) problems.push('owner.branch is "trunk" — "trunk" is a role, never a branch name (CONVENTIONS.md §2)');
  return { declared: true, branch: branch || null, remote, problems };
}

/**
 * Descriptor-level findings for the audit: the block's own shape, plus the collisions that would
 * let a colab command reach the owner's branch — it may not BE trunk, an integration line, or the
 * releaseBranch. Returns `[{ level: 'fail'|'warn', text }]`.
 */
function evaluate(doc, { trunk, integration = [], releaseBranch = '', branches = null } = {}) {
  const o = read(doc);
  if (!o.declared) return [];
  const out = o.problems.map((text) => ({ level: 'fail', text }));
  if (!o.branch) return out;
  if (trunk && o.branch === trunk) {
    out.push({ level: 'fail', text: `owner.branch is the trunk ("${o.branch}") — trunk is the fleet's integration branch that \`colab ship\` merges into; the owner's branch must be a different one, reached only by \`colab deliver\`'s pull request` });
  }
  if ((integration || []).includes(o.branch)) {
    out.push({ level: 'fail', text: `owner.branch "${o.branch}" is also listed in integration: — a session could then be cut from and shipped into the owner's branch` });
  }
  if (releaseBranch && releaseBranch === o.branch) {
    out.push({ level: 'fail', text: `owner.branch "${o.branch}" is also the releaseBranch — a release would then fast-forward the owner's branch` });
  }
  if (Array.isArray(branches) && !branches.includes(o.branch)) {
    out.push({ level: 'warn', text: `owner.branch "${o.branch}" is not among the branches this audit could list — check the name (it lives on the owner's remote)` });
  }
  return out;
}

/**
 * The guard. `null` when a push to `branch` is allowed as far as this key is concerned; otherwise
 * the refusal line. Fails closed on a malformed block: a descriptor that says "there is an owner's
 * branch" but not legibly which one may not be pushed to at all — every refusal names why.
 */
function refuseMove(doc, branch) {
  const o = read(doc);
  if (!o.declared) return null;
  if (o.problems.length) {
    return `project.yml owner: is malformed (${o.problems[0]}) — refusing to move any shared branch until it is fixed`;
  }
  if (branch && o.branch === String(branch)) {
    return `"${branch}" is the owner's branch (project.yml owner.branch) — no colab command moves it. Deliver with \`colab deliver\`, which opens a pull request the owner merges himself.`;
  }
  return null;
}

/**
 * Classify the delivery PRs (head = trunk, base = owner.branch, any state), newest first by number.
 * `prs` is `gh pr list --state all --json number,url,state,mergedAt,headRefOid,closedAt,title`.
 *
 * Returns `{ open, lastMerged, lastClosed, latest }` where `lastClosed` is the newest PR closed
 * WITHOUT merge that is newer than `lastMerged` — the owner's rejection of the current batch.
 * A merge is read from PR state (`state: MERGED` or a `mergedAt`), never from ancestry: the owner
 * may squash or rebase, and then no trunk commit is an ancestor of his branch.
 */
function classifyPrs(prs) {
  const list = (Array.isArray(prs) ? prs : [])
    .filter((p) => p && Number.isFinite(Number(p.number)))
    .slice()
    .sort((a, b) => Number(b.number) - Number(a.number));
  const isMerged = (p) => String(p.state || '').toUpperCase() === 'MERGED' || !!p.mergedAt;
  const isOpen = (p) => String(p.state || '').toUpperCase() === 'OPEN';
  const open = list.find(isOpen) || null;
  const lastMerged = list.find(isMerged) || null;
  const lastClosed = list.find((p) => !isOpen(p) && !isMerged(p)
    && (!lastMerged || Number(p.number) > Number(lastMerged.number))) || null;
  return { open, lastMerged, lastClosed, latest: list[0] || null };
}

/**
 * `#N` references in commit messages, in first-seen order, de-duplicated. Reads what `colab ship`
 * writes (`Closes #N`, `Refs #N`, a trailing `(#N)`); an `owner/name#N` cross-repo reference is
 * skipped — it names another tracker.
 */
function issueRefs(messages) {
  const seen = new Set();
  const out = [];
  for (const m of messages || []) {
    const re = /(^|[^\w/.-])#(\d+)\b/g;
    let x;
    while ((x = re.exec(String(m))) !== null) {
      const n = Number(x[2]);
      if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
  }
  return out;
}

/**
 * Decide what `colab deliver` does, from the reads. Inputs:
 *   pending   — `[{ sha, subject, body }]` trunk commits not yet delivered (oldest first)
 *   prs       — classifyPrs() output
 *   headSha   — trunk's tip on the remote
 *   reopen    — `--reopen` given
 * Returns `{ state, action, detail }`:
 *   state  : 'nothing-to-deliver' | 'waiting-on-owner' | 'rejected' | 'ready'
 *   action : 'none' | 'refresh' | 'create'
 * Pure and exhaustive — every combination lands on exactly one row, tested.
 */
function decide({ pending, prs, headSha, reopen = false }) {
  const n = (pending || []).length;
  if (prs.open) {
    return { state: 'waiting-on-owner', action: n ? 'refresh' : 'none',
      detail: `PR #${prs.open.number} is open, waiting on the owner to merge it${n ? ` — ${n} commit(s) on it` : ''}` };
  }
  if (!n) {
    return { state: 'nothing-to-deliver', action: 'none',
      detail: prs.lastMerged ? `everything up to PR #${prs.lastMerged.number} is delivered; nothing new on trunk since` : 'trunk has nothing the owner\'s branch lacks' };
  }
  if (prs.lastClosed && !reopen) {
    const same = headSha && prs.lastClosed.headRefOid && prs.lastClosed.headRefOid === headSha;
    return { state: 'rejected', action: 'none',
      detail: `PR #${prs.lastClosed.number} was closed without a merge${same ? ' at this same trunk tip' : ''} — the owner declined it. `
        + 'Nothing opened. Read his reason on the PR; re-run with --reopen to offer the batch again.' };
  }
  return { state: 'ready', action: 'create', detail: `${n} commit(s) on trunk not yet delivered` };
}

/** Title and body of the delivery PR. No closing keywords: the issues already closed on trunk. */
function prText({ trunk, ownerBranch, pending, lastMerged }) {
  const issues = issueRefs((pending || []).map((c) => `${c.subject}\n${c.body || ''}`));
  const title = `Deliver ${trunk} → ${ownerBranch}: ${pending.length} change(s)${issues.length ? ` (${issues.map((i) => '#' + i).join(', ')})` : ''}`;
  const lines = [
    `This pull request carries work already landed on \`${trunk}\`, the integration branch, to \`${ownerBranch}\`.`,
    'It is opened by `colab deliver`, which never merges it: merging is yours, by any method (merge commit, squash or rebase).',
    '',
    `## Changes (${pending.length})`,
    ...pending.map((c) => `- \`${String(c.sha).slice(0, 7)}\` ${c.subject}`),
  ];
  if (issues.length) {
    lines.push('', '## Issues carried', ...issues.map((i) => `- #${i}`));
  }
  if (lastMerged) lines.push('', `Previous delivery: #${lastMerged.number}.`);
  return { title, body: lines.join('\n') + '\n' };
}

module.exports = { read, evaluate, refuseMove, classifyPrs, issueRefs, decide, prText };
