'use strict';
/**
 * The two-role session suffix on the comments `colab ship` posts (#372).
 *
 * The comment used to end `· session <name>`, and that name was the session holding the CLAIM,
 * not the session that ran `colab ship`. The sentence around it reads "Shipped … by colab ship —
 * … session X", so a correct ship read as "session X shipped its own work" — the one thing
 * `code-wrap` / `code-ship` keep apart. Measured: 8 of 8 merges in one day on an auto-trunk repo
 * named the implementer; one separate ship session had run every ship; a coordinator read the
 * comments and reported the implementers for self-shipping. Only the transcripts could clear them.
 *
 * So the suffix names both roles, and says which it cannot name:
 *
 *   · implemented by session <holder> · shipped by session <shipper>
 *   · implemented by session <holder> · shipped by: unknown
 *   · implemented and shipped by the same session <x>          ← the case a reviewer needs to spot
 *
 * "Same" is decided by the session URL when both sides carry one — that is the only join key.
 * With a URL missing on either side, the names are compared, and a match says so ("matched by
 * name only"), because a name is display text and two sessions can share one. When the two sides
 * share no field at all, the comment says it cannot tell rather than guessing either way.
 *
 * Pure: no git, no I/O, no env. tools/colab resolves both identities (`resolveShipSession`).
 */

/** One identity as comment text: `[name](url)` when both, else whichever is set, else ''. */
function sessionRef(id) {
  const session = (id && id.session) || '';
  const sessionName = (id && id.sessionName) || '';
  if (sessionName && session) return `[${sessionName}](${session})`;
  return session || sessionName;
}

/**
 * Are two identities the same session? `{ same, by }`, or null when they share no field to compare.
 * `by` is 'url' (authoritative) or 'name' (display text — reported as such).
 */
function compareSessions(a, b) {
  if (a && b && a.session && b.session) return { same: a.session === b.session, by: 'url' };
  if (a && b && a.sessionName && b.sessionName) return { same: a.sessionName === b.sessionName, by: 'name' };
  return null;
}

/**
 * The ` · implemented by … · shipped by …` suffix. Never '' — an unknown role is written as
 * `unknown`, because leaving it out is exactly the ambiguity #372 removes.
 *
 * @param {{session?: string, sessionName?: string}} holder  the session holding the claim / worktree
 * @param {{session?: string, sessionName?: string}} shipper the session that ran `colab ship`
 */
function shipRolesSuffix(holder, shipper) {
  const h = sessionRef(holder);
  const s = sessionRef(shipper);
  if (!h && !s) return ' · implemented by: unknown · shipped by: unknown';
  if (!s) return ` · implemented by session ${h} · shipped by: unknown`;
  if (!h) return ` · implemented by: unknown · shipped by session ${s}`;
  const cmp = compareSessions(holder, shipper);
  if (cmp && cmp.same) {
    // Merge the two records: either side may carry the half the other lacks.
    const merged = sessionRef({
      session: holder.session || shipper.session,
      sessionName: holder.sessionName || shipper.sessionName,
    });
    const how = cmp.by === 'name' ? ' (matched by name only — no session URL on one side)' : '';
    return ` · implemented and shipped by the same session ${merged}${how}`;
  }
  const note = cmp ? '' : ' (no shared identity field — cannot tell whether these are one session)';
  return ` · implemented by session ${h} · shipped by session ${s}${note}`;
}

module.exports = { shipRolesSuffix, compareSessions, sessionRef };
