'use strict';
/**
 * #367: whether a squash `colab ship` lands may name the machine that landed it.
 *
 * #350 writes `Machine: <label>` on every squash so cross-machine conflicts are measurable from
 * git alone. The label is a normalised HOSTNAME, and a commit message is the one artifact that can
 * never be edited after it is pushed. On a private repository that is the traceability #350 wanted;
 * on a PUBLIC one it publishes an internal hostname permanently, once per ship. The same goes for
 * the `on <host> (machine <id>)` tail of #324's `Colab-Adopted:` trailer.
 *
 * So the decision reads the destination, not the machine:
 *
 *   1. the forge says PUBLIC                    → omit (the measured fact wins)
 *   2. project.yml declares `room: public`      → omit (the repo's own marker — covers a repo that
 *                                                  is private today but declared for publication,
 *                                                  whose history goes public with it)
 *   3. the forge says PRIVATE / INTERNAL        → include (#350 unchanged)
 *   4. the forge could not be read, and `room:` is `solo` or `team`
 *                                               → include (the declared room is the fallback)
 *   5. the forge could not be read, no `room:`  → OMIT, and say so — FAIL CLOSED. A missing trailer
 *                                                  costs one traceability line; a published hostname
 *                                                  cannot be taken back. Declaring `room:` restores it.
 *
 * Pure: no git, no network. The caller hands in the host label, the visibility it read (or null),
 * and the descriptor's `room:` value.
 */

const VISIBLE = new Set(['PUBLIC']);
const HIDDEN = new Set(['PRIVATE', 'INTERNAL']);
const PRIVATE_ROOMS = new Set(['solo', 'team']);

/**
 * @param {{ label: string|null, visibility: string|null, room: string|null|undefined }} input
 * @returns {{ include: boolean, line: string|null, visibility: string|null, room: string|null,
 *             reason: string, failClosed: boolean }}
 */
function decide({ label, visibility, room }) {
  const vis = visibility ? String(visibility).toUpperCase() : null;
  const rm = room === undefined || room === null || room === '' ? null : String(room);
  const base = { visibility: vis, room: rm, failClosed: false };
  if (vis && VISIBLE.has(vis)) {
    return { ...base, include: false, line: null, reason: 'repository is public — a hostname in a squash would be published permanently (#367)' };
  }
  if (rm === 'public') {
    return { ...base, include: false, line: null, reason: 'project.yml declares room: public — a hostname in a squash would be published with it (#367)' };
  }
  let why;
  if (vis && HIDDEN.has(vis)) why = `repository is ${vis.toLowerCase()}`;
  else if (rm && PRIVATE_ROOMS.has(rm)) why = `visibility unreadable; project.yml declares room: ${rm}`;
  else {
    return { ...base, failClosed: true, include: false, line: null,
      reason: `visibility ${vis ? `"${vis}" not recognised` : 'could not be read'} and project.yml declares no private room: — omitted, failing closed (#367); declare room: solo|team to keep it` };
  }
  if (!label) {
    return { ...base, include: false, line: null, reason: `${why}, but no machine label could be derived from the host name` };
  }
  return { ...base, include: true, line: `Machine: ${label}`, reason: `${why} — the squash names the machine that landed it (#350)` };
}

/**
 * #324 + #367: the `Colab-Adopted:` trailer. The branch and sha are the audit trail and always stay;
 * the `on <host> (machine <id>)` tail is written only where the Machine: trailer itself may be.
 */
function adoptedTrailer(adopt, decision) {
  if (!adopt) return null;
  const head = `Colab-Adopted: origin/${adopt.branch} @ ${adopt.remoteSha}`;
  if (!decision || !decision.include) return head;
  return `${head} on ${adopt.host} (machine ${adopt.machine || 'unknown'})`;
}

module.exports = { decide, adoptedTrailer };
