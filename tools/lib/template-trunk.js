'use strict';
/**
 * Trunk substitution for a copied CI template (#526). Pure: text in, text out, no I/O.
 *
 * The CI templates protect two refs by name — `main` and `dev` — in three places: the concurrency
 * `group`, `cancel-in-progress`, and the `dedupe` guard's `if:`. Those names are the defaults of the
 * two shapes a repo can have, not facts about any one repo. Copied verbatim into a repo whose trunk
 * is `master`, the trunk runs become cancellable (the deadlock CONVENTIONS §4 warns about) and the
 * tree-reuse guard never fires there. `colab template` knows the trunk — it is in
 * `.github/project.yml` — so it writes the right refs instead of leaving an EDIT point.
 *
 * Which refs a repo protects:
 *   - one branch (trunk `main`, or any trunk on a repo with no release branch) → `[trunk]`;
 *   - two branches (trunk ≠ `main` where the promotion into `main` releases — exposure live or
 *     released, or legacy tier A/C) → `['main', trunk]`.
 *
 * The Laravel template's test tier also names `main` as the branch whose suite gates a release;
 * on a one-branch repo that branch is the trunk, so it is rewritten too.
 *
 * Only the exact expression shapes the templates ship are rewritten. A copy whose shape was
 * already edited is left alone and reported as `missed`, never guessed at.
 */

const TEMPLATE_REFS = ['main', 'dev'];

/** The refs a repo's CI protects, from its parsed descriptor. null when no `trunk:` is declared. */
function protectedRefs(doc) {
  const trunk = doc && typeof doc.trunk === 'string' && doc.trunk.trim() ? doc.trunk.trim() : null;
  if (!trunk) return null;
  const exposure = doc.exposure == null ? null : String(doc.exposure);
  const tier = doc.tier == null ? null : String(doc.tier).toUpperCase();
  const promotes = exposure === 'live' || exposure === 'released' || (exposure == null && (tier === 'A' || tier === 'C'));
  const twoBranch = trunk !== 'main' && promotes;
  return { trunk, twoBranch, refs: twoBranch ? ['main', trunk] : [trunk] };
}

const eq = (r) => `github.ref == 'refs/heads/${r}'`;
const ne = (r) => `github.ref != 'refs/heads/${r}'`;

/**
 * Rewrite the template's `main`/`dev` refs to `p` (protectedRefs' result).
 * Returns { text, changes: [what], missed: [what] }. `changes` is empty when the template's own
 * refs are already right (a `dev` trunk with a `main` release branch).
 */
function substituteTrunk(text, p) {
  const changes = [];
  const missed = [];
  let out = text;
  const swap = (label, from, to) => {
    if (!out.includes(from)) { missed.push(label); return; }
    if (from !== to) { out = out.split(from).join(to); changes.push(label); }
  };
  const tplEq = TEMPLATE_REFS.map(eq);
  swap('concurrency group', `(${tplEq.join(' || ')}) && format(`, `(${p.refs.map(eq).join(' || ')}) && format(`);
  swap('cancel-in-progress', `cancel-in-progress: \${{ ${TEMPLATE_REFS.map(ne).join(' && ')} }}`,
    `cancel-in-progress: \${{ ${p.refs.map(ne).join(' && ')} }}`);
  // #721: the reusable-workflow caller (templates/ci-call.yml) names its trunk refs in the `trunk-branches`
  // input instead of a guard `if:` of its own — the guard lives in the called workflow.
  const tplList = `trunk-branches: '${JSON.stringify(TEMPLATE_REFS)}'`;
  if (out.includes(tplList)) swap('trunk-branches input', tplList, `trunk-branches: '${JSON.stringify(p.refs)}'`);
  else swap("dedupe guard's if:", `github.event.created || ${tplEq.join(' || ')})`, `github.event.created || ${p.refs.map(eq).join(' || ')})`);
  // ci-laravel's test tier (only present there): the release-gating branch is the trunk on a one-branch repo.
  if (!p.twoBranch && p.trunk !== 'main' && out.includes('[ "$REF" = "refs/heads/main" ] || [ "$trunk" = "main" ]')) {
    out = out.split('[ "$BASE_REF" = "main" ]').join(`[ "$BASE_REF" = "${p.trunk}" ]`);
    out = out.split('[ "$REF" = "refs/heads/main" ] || [ "$trunk" = "main" ]')
      .join(`[ "$REF" = "refs/heads/${p.trunk}" ] || [ "$trunk" = "${p.trunk}" ]`);
    changes.push('test tier');
  }
  return { text: out, changes, missed };
}

/**
 * What `colab template <name>` writes for a repo whose descriptor is `doc`: the body with this
 * repo's refs when `name` is a CI template and a trunk is declared, else the body unchanged.
 * `colab update` uses the same rendering both to recognise a pristine copy and to refresh one, so
 * a refreshed file stays byte-identical to what `colab template <name> --force` would write.
 */
function renderForRepo(name, body, doc, version) {
  if (!/^ci-/.test(String(name || ''))) return body;
  const pinned = version ? pinHandbookTag(body, version).text : body;
  const p = protectedRefs(doc);
  return p ? substituteTrunk(pinned, p).text : pinned;
}

/**
 * #721: the reusable-workflow caller pins the handbook by tag — `uses: …/ci-light.yml@HANDBOOK_TAG`
 * in the template. A copy is written with the version its stamp records, so "copied from handbook X"
 * and "calls handbook X" are one fact, and a refresh moves both together. `v0` (an untagged handbook)
 * pins nothing: there is no tag to call, and the token is left for the copier to see.
 */
const HANDBOOK_TAG = 'HANDBOOK_TAG';
function pinHandbookTag(text, version) {
  const token = `@${HANDBOOK_TAG}`;
  if (!String(text).includes(token)) return { text, pinned: null };
  if (!version || version === 'v0') return { text, pinned: null, unpinned: true };
  return { text: text.split(token).join(`@${version}`), pinned: version };
}

module.exports = { TEMPLATE_REFS, HANDBOOK_TAG, protectedRefs, substituteTrunk, renderForRepo, pinHandbookTag };
