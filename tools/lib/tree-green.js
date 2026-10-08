'use strict';
/**
 * Trunk "tree already green" (#493) — the pure half of the rule, shared by `colab ship` / `colab
 * trunk-ci` (tools/colab readCiVerdict) and the audit. No gh, no git, no I/O.
 *
 * THE RULE. A ship squash-merges a branch whose green run already contained the current base, so
 * the trunk commit's tree is byte-identical to the tree that branch run passed. The CI templates'
 * `dedupe` guard therefore skips the suite on a trunk push when it finds a green `push` run of the
 * same workflow, on another ref of this repo, at exactly this tree — and leaves a
 * `tree-already-green` notice annotation naming the run it relied on. A run in that shape (the
 * guard succeeded, everything else skipped) concludes `success`, which is already the verdict;
 * this module only lets the reader FIND the citation, and say so.
 *
 * Why read the citation from an annotation: job outputs and step summaries are not readable over
 * the REST API, and a job name cannot carry a step output. An annotation is durable, shows in the
 * UI, and is one call per skip-run. Why not recompute tree equality here instead: a second copy of
 * the guard's matching logic in JavaScript is exactly the drift this repo keeps measuring.
 */

const NOTICE_TITLE = 'tree-already-green';
/** #570: the CI guard's docs-only mode leaves this notice instead — same run shape, a different reason. */
const DOCS_NOTICE_TITLE = 'docs-only-skip';

/** `tree-reuse:` in project.yml. Absent = reuse on. `off` = the one legal value. */
function parseTreeReuse(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, 'tree-reuse');
  if (!has || doc['tree-reuse'] === null || doc['tree-reuse'] === undefined) {
    return { declared: false, valid: true, off: false, value: null, reason: 'tree-reuse absent — trunk may reuse a green run of an identical tree (#493)' };
  }
  const v = doc['tree-reuse'];
  // YAML 1.1 readers turn a bare `off` into boolean false; both spell the same intent.
  if (v === 'off' || v === false) {
    return { declared: true, valid: true, off: true, value: 'off', reason: 'tree-reuse: off — trunk always runs its full suite' };
  }
  return {
    declared: true, valid: false, off: true, value: v,
    reason: `tree-reuse is ${JSON.stringify(v)} — the only defined value is "off"; the CI guard reads ANY tree-reuse line as off, so trunk runs its full suite, but say what you mean`,
  };
}

/**
 * From a commit's check runs (`[{id, name, status, conclusion, suite, annotations}]`), the ids of
 * the check runs that ARE a tree-skip: in one check suite (one workflow run), exactly one job
 * succeeded, it carries at least one annotation, and every other job was skipped (at least one).
 * Name-independent on purpose — adopters rename jobs. Null in, null out (a failed read is not "none").
 */
function treeSkipCheckRuns(checkRuns) {
  if (!Array.isArray(checkRuns)) return null;
  const bySuite = new Map();
  for (const c of checkRuns) {
    if (!c || c.suite == null) continue;
    if (!bySuite.has(c.suite)) bySuite.set(c.suite, []);
    bySuite.get(c.suite).push(c);
  }
  const ids = [];
  for (const runs of bySuite.values()) {
    const ok = runs.filter((c) => c.status === 'completed' && c.conclusion === 'success');
    const skipped = runs.filter((c) => c.status === 'completed' && c.conclusion === 'skipped');
    if (ok.length === 1 && skipped.length >= 1 && ok.length + skipped.length === runs.length && Number(ok[0].annotations) > 0) {
      ids.push(ok[0].id);
    }
  }
  return ids;
}

/** The citation in a check run's annotations (`[{title, message}]`), or null. */
function parseCitation(annotations) {
  if (!Array.isArray(annotations)) return null;
  const a = annotations.find((x) => x && x.title === NOTICE_TITLE && typeof x.message === 'string');
  if (!a) return null;
  const m = a.message.trim().match(/^(\S+)\s+tree=([0-9a-f]+)\s+head=([0-9a-f]+)\s+branch=(\S+)$/i);
  if (!m) return null;
  const runId = (m[1].match(/\/runs\/(\d+)/) || [])[1] || null;
  return { url: m[1], runId, tree: m[2], head: m[3], branch: m[4] };
}

/**
 * #570: the docs-only notice in a check run's annotations (`base=<sha> files=<n> run=<url>`), or null.
 * A docs-only skip has the same shape as a tree skip (the guard green, the rest skipped), so the
 * reader must recognise it — otherwise it reads as a tree citation nobody can parse.
 */
function parseDocsSkip(annotations) {
  if (!Array.isArray(annotations)) return null;
  const a = annotations.find((x) => x && x.title === DOCS_NOTICE_TITLE && typeof x.message === 'string');
  if (!a) return null;
  const m = a.message.trim().match(/^base=([0-9a-f]+)\s+files=(\d+)\s+run=(\S+)$/i);
  if (!m) return null;
  return { base: m[1], files: Number(m[2]), url: m[3] };
}

/**
 * The verdict suffix for a green trunk read that relied on cited runs. `cites`: [{url, branch,
 * head, proof}] where proof is 'verified' | 'unverified'; `unreadable`: count of skip-runs whose
 * citation could not be read. '' when there is nothing to say (an ordinary green run).
 */
function citationNote(cites, unreadable = 0, docs = []) {
  const parts = (cites || []).map((c) =>
    `relied on ${c.url} (${c.branch}@${String(c.head).slice(0, 7)}${c.proof === 'verified' ? ', tree verified locally' : ', tree not verified locally'})`);
  for (let i = 0; i < unreadable; i++) parts.push('cited run unreadable');
  const tree = parts.length ? ` — tree already green (#493): suite skipped, ${parts.join('; ')}` : '';
  const doc = (docs || []).map((d) => `${d.files} path(s) since ${String(d.base).slice(0, 7)}, whose green run is ${d.url}`);
  return tree + (doc.length ? ` — docs-only (#570): suite skipped, ${doc.join('; ')}` : '');
}

module.exports = { NOTICE_TITLE, DOCS_NOTICE_TITLE, parseTreeReuse, treeSkipCheckRuns, parseCitation, parseDocsSkip, citationNote };
