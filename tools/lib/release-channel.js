'use strict';
/**
 * tools/lib/release-channel.js — the release CHANNELS `next` and `stable` (#445).
 *
 * Adopters follow a channel, not a hand-bumped pin:
 *
 *   next     always the newest CANDIDATE (vX.Y.Z-rc.N) — moved by `colab release cut`
 *   stable   always the newest FINAL (vX.Y.Z)          — moved by `colab release finalize`
 *
 * They are BRANCHES, not tags. A moving tag is refused by every clone that already fetched it
 * (`would clobber existing tag`), and a non-semver tag can be read as "the newest version" by tag
 * readers (`git describe --tags`, stamps). A branch moves cleanly and no tag reader sees it. Version
 * tags stay immutable.
 *
 * Forward only. A channel is fast-forwarded to the commit the tag names, never forced: a channel
 * that is not an ancestor of that commit is a finding (somebody moved it by hand, or a branch of the
 * same name means something else in this repo) and is reported, never overwritten. `stable` lagging
 * behind `next` is the design, not drift — they are two channels, each moving forward on its own.
 *
 * Best-effort, like the GitHub pre-release (#443): the tag is already on the remote when a channel
 * moves, so a channel that could not move is reported (warning, --json `channel.ok: false`) and
 * never a reason to undo the tag. The next cut / finalize retries, and finalize's already-final path
 * repairs a `stable` a dead run left behind.
 *
 * The push carries COLAB_RELEASE=1 — the process-identity assertion templates/pre-push-guard reads
 * for these two refs, the COLAB_SHIP precedent. Nothing else writes them.
 *
 * Two halves: decideMove is pure (facts in, an action out); moveChannel measures and writes through
 * git, on the remote it is given.
 */

const git = require('./git');

const CHANNELS = Object.freeze({ next: 'next', stable: 'stable' });
/** The env a release command pushes a channel with — what pre-push-guard lets through. */
const RELEASE_ENV = 'COLAB_RELEASE';

/**
 * What to do with `channel`, given where it is now and where it should be.
 *
 *   current            the channel's commit on the remote, or null when the branch does not exist
 *   target             the commit the tag names
 *   currentIsAncestor  current is an ancestor of target (a fast-forward)
 *   targetIsAncestor   target is an ancestor of current (the channel is already past it)
 *
 * Returns { action: 'create' | 'move' | 'noop' | 'refuse', detail }.
 */
function decideMove({ channel, current, target, label, currentIsAncestor, targetIsAncestor }) {
  const at = label ? `${label} (${short(target)})` : short(target);
  if (!target) return { action: 'refuse', detail: `${channel}: no target commit` };
  if (!current) return { action: 'create', detail: `${channel} created at ${at}` };
  if (current === target) return { action: 'noop', detail: `${channel} already at ${at}` };
  if (currentIsAncestor) return { action: 'move', detail: `${channel} fast-forwarded ${short(current)} -> ${at}` };
  if (targetIsAncestor) return { action: 'noop', detail: `${channel} already past ${at} (at ${short(current)}) — a channel only moves forward` };
  return {
    action: 'refuse',
    detail: `${channel} NOT moved: it is at ${short(current)}, which is not an ancestor of ${at} — a channel only fast-forwards; find out who moved it before moving it back by hand`,
  };
}

function short(sha) { return sha ? String(sha).slice(0, 7) : '—'; }

/**
 * Move `channel` on `remote` to `sha` (the commit `label`, a tag, names). Forward only, never forced.
 * Returns { channel, ok, action, detail } — ok is false only on a refusal or a failed push/read.
 * With `dry`, measures and reports what it would do, writing nothing.
 */
function moveChannel(repoAbs, { remote, channel, sha, label, dry = false, env = process.env }) {
  const fail = (detail) => ({ channel, ok: false, action: 'refuse', detail });
  const ls = git.git(['ls-remote', '--heads', remote, `refs/heads/${channel}`], repoAbs);
  if (!ls.ok) return fail(`${channel} NOT moved: could not read it on ${remote} (${(ls.stderr || '').split('\n')[0] || ls.code})`);
  const line = ls.stdout.split('\n').find((l) => l.endsWith(`\trefs/heads/${channel}`));
  const current = line ? line.split('\t')[0] : null;

  let currentIsAncestor = false;
  let targetIsAncestor = false;
  if (current && current !== sha) {
    // The channel's commit is not necessarily local yet (a clone that never fetched the branch).
    const have = git.git(['cat-file', '-e', `${current}^{commit}`], repoAbs);
    if (!have.ok) {
      const f = git.git(['fetch', '--quiet', remote, `refs/heads/${channel}`], repoAbs);
      if (!f.ok) return fail(`${channel} NOT moved: could not fetch it from ${remote} to check it only moves forward (${(f.stderr || '').split('\n')[0] || f.code})`);
    }
    currentIsAncestor = git.git(['merge-base', '--is-ancestor', current, sha], repoAbs).ok;
    if (!currentIsAncestor) targetIsAncestor = git.git(['merge-base', '--is-ancestor', sha, current], repoAbs).ok;
  }

  const d = decideMove({ channel, current, target: sha, label, currentIsAncestor, targetIsAncestor });
  if (d.action === 'refuse') return { channel, ok: false, ...d };
  if (d.action === 'noop' || dry) return { channel, ok: true, ...d, ...(dry && d.action !== 'noop' ? { detail: `[--dry] would be: ${d.detail}` } : {}) };

  // No --force, no lease: git itself refuses a non-fast-forward, so a channel moved meanwhile is
  // refused here too rather than overwritten.
  const push = git.run('git', ['push', remote, `${sha}:refs/heads/${channel}`], { cwd: repoAbs, env: { ...env, [RELEASE_ENV]: '1' } });
  if (!push.ok) return fail(`${channel} NOT moved: git push ${remote} ${short(sha)}:refs/heads/${channel} failed (${(push.stderr || '').split('\n').filter(Boolean).pop() || push.code})`);
  return { channel, ok: true, ...d };
}

module.exports = { CHANNELS, RELEASE_ENV, decideMove, moveChannel };
