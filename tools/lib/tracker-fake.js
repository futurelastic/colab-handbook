'use strict';
/**
 * tools/lib/tracker-fake.js — an in-memory implementation of the tracker contract (#501).
 *
 * It exists for two readers:
 *   - tools/lib/tracker-contract.test.js runs every scenario in tools/lib/tracker-scenarios.json
 *     against it, next to the GitHub adapter. When both pass the same scenarios, the scenarios
 *     describe the contract rather than one implementation's habits.
 *   - a consumer of this package that wants a tracker in a test without a network.
 *
 * `create(repoAbs, given)` seeds it from a scenario's `given` block (the shape is documented in
 * tracker-scenarios.json's `given` key). Semantics follow tools/lib/tracker.js: synchronous,
 * bound to one repo, never throws on an "environment" failure — `given.offline: true` makes every
 * read come back as "could not read" (null, or `data: null`) and every write as `ok: false`.
 *
 * Fidelity points that a scenario pins, because GitHub behaves this way and a caller relies on it:
 *   - issues and pull requests share one number sequence;
 *   - a closed issue carries `stateReason` COMPLETED or NOT_PLANNED;
 *   - the claimer of an issue is the actor of the LATEST `labeled in-progress` event (tools/lib/git.js
 *     ghClaimHolder), and release unassigns the caller plus that claimer unless `selfOnly`;
 *   - list reads come back newest first.
 */

function result(ok, extra = {}) {
  return { ok, code: ok ? 0 : 1, stdout: '', stderr: ok ? '' : 'tracker unavailable (fake: offline)',
    error: null, timedOut: false, ...extra };
}

function fail(stderr) {
  return { ok: false, code: 1, stdout: '', stderr, error: null, timedOut: false };
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const pick = (obj, fields) => Object.fromEntries(fields.filter((f) => f in obj).map((f) => [f, obj[f]]));

function create(repoAbs, given = {}) {
  const login = given.login === undefined ? 'fake-user' : given.login;
  const offline = Boolean(given.offline);
  const labels = clone(given.labels || []);
  const issues = new Map();
  const prs = new Map();
  const runs = clone(given.runs || []);
  const releases = new Map((given.releases || []).map((r) => [r.tag, clone(r)]));
  const base = `https://tracker.invalid/${String(repoAbs).replace(/^\/+/, '')}`;

  for (const i of given.issues || []) {
    issues.set(i.number, {
      number: i.number, title: i.title || '', body: i.body || '', state: i.state || 'OPEN',
      stateReason: i.stateReason || (i.state === 'CLOSED' ? 'COMPLETED' : ''),
      createdAt: i.createdAt || null, closedAt: i.closedAt || null,
      labels: clone(i.labels || []), assignees: clone(i.assignees || []),
      comments: (i.comments || []).map((c) => ({ author: c.author, body: c.body })),
      events: clone(i.events || []),
    });
  }
  for (const p of given.prs || []) {
    prs.set(p.number, { reviews: [], body: '', state: 'OPEN', headRefOid: null, mergedAt: null, ...clone(p) });
  }
  const nextNumber = () => Math.max(0, ...issues.keys(), ...prs.keys()) + 1;

  /** The issue as `gh issue view --json` shapes it: label/assignee/comment objects, not strings. */
  function issueShape(i) {
    return {
      number: i.number, title: i.title, body: i.body, state: i.state, stateReason: i.stateReason,
      createdAt: i.createdAt, closedAt: i.closedAt, url: `${base}/issues/${i.number}`,
      labels: i.labels.map((name) => ({ name })),
      assignees: i.assignees.map((l) => ({ login: l })),
      comments: i.comments.map((c) => ({ author: { login: c.author }, body: c.body })),
    };
  }
  function prShape(p) {
    return {
      number: p.number, title: p.title, body: p.body, state: p.state, headRefName: p.head,
      baseRefName: p.base, headRefOid: p.headRefOid, mergedAt: p.mergedAt, reviews: clone(p.reviews),
      author: { login: p.author }, url: `${base}/pull/${p.number}`,
    };
  }
  function claimHolder(num) {
    const i = issues.get(num);
    if (offline || !i) return { assignees: null, claimer: null };
    const actors = i.events.filter((e) => e.event === 'labeled' && e.label === 'in-progress').map((e) => e.actor);
    return { assignees: [...i.assignees], claimer: actors.length ? actors[actors.length - 1] : null };
  }
  const withList = (data) => (offline ? result(false, { data: null }) : result(true, { stdout: JSON.stringify(data), data }));

  return {
    kind: 'fake',
    repo: repoAbs,

    state: () => (offline ? { ok: false, reason: 'missing' } : { ok: true, reason: null }),
    currentLogin: () => (offline ? null : login),

    issueView: (num, fields) => {
      const i = issues.get(Number(num));
      return offline || !i ? null : pick(issueShape(i), fields);
    },
    issueListAll: ({ limit, fields } = {}) => withList([...issues.values()]
      .sort((a, b) => b.number - a.number).slice(0, limit).map((i) => pick(issueShape(i), fields))),
    issueCreate: ({ title, body }) => {
      if (offline) return { ...result(false), number: null, url: null };
      const number = nextNumber();
      issues.set(number, { number, title, body, state: 'OPEN', stateReason: '', createdAt: null, closedAt: null,
        labels: [], assignees: [], comments: [], events: [] });
      const url = `${base}/issues/${number}`;
      return { ...result(true, { stdout: url }), number, url };
    },
    issueComment: (num, body) => {
      const i = issues.get(Number(num));
      if (offline) return result(false);
      if (!i) return fail(`issue #${num} not found`);
      i.comments.push({ author: login, body });
      return result(true, { stdout: `${base}/issues/${num}#issuecomment-${i.comments.length}` });
    },
    issueClose: (num, { reason } = {}) => {
      const i = issues.get(Number(num));
      if (offline) return result(false);
      if (!i) return fail(`issue #${num} not found`);
      i.state = 'CLOSED';
      i.stateReason = reason === 'not planned' ? 'NOT_PLANNED' : 'COMPLETED';
      return result(true);
    },
    issueRelease: (num, opts = {}) => {
      const caller = offline ? null : login;
      if (offline) return { ...result(false), others: [], caller, note: '' };
      const i = issues.get(Number(num));
      if (!i) return { ...fail(`issue #${num} not found`), others: [], caller, note: '' };
      let others = [];
      let note = '';
      if (!opts.selfOnly) {
        const h = claimHolder(Number(num));
        if (h.claimer && h.claimer !== caller && (h.assignees === null || h.assignees.includes(h.claimer))) others = [h.claimer];
        else if (!h.claimer && h.assignees === null) note = 'could not read who holds the claim — unassigned @me only';
      }
      const drop = new Set([caller, ...others]);
      i.assignees = i.assignees.filter((l) => !drop.has(l));
      i.labels = i.labels.filter((l) => l !== 'in-progress');
      return { ...result(true), others, caller, note };
    },
    claimHolder: (num) => claimHolder(Number(num)),

    labelList: () => (offline ? null : [...labels]),

    prForBranch: (branch) => {
      if (offline) return { error: 'tracker unavailable (fake: offline)' };
      const open = [...prs.values()].filter((p) => p.head === branch && p.state === 'OPEN').sort((a, b) => b.number - a.number);
      if (!open.length) return { pr: null };
      return { pr: pick(prShape(open[0]), ['number', 'url', 'state', 'author', 'headRefOid', 'reviews']) };
    },
    prCreate: ({ base: into, head, title, body }) => {
      if (offline) return { ok: false, url: null, stderr: 'tracker unavailable (fake: offline)' };
      if ([...prs.values()].some((p) => p.head === head && p.base === into && p.state === 'OPEN')) {
        return { ok: false, url: null, stderr: `a pull request for branch "${head}" into branch "${into}" already exists` };
      }
      const number = nextNumber();
      prs.set(number, { number, base: into, head, title, body, state: 'OPEN', author: login, headRefOid: null, mergedAt: null, reviews: [] });
      return { ok: true, url: `${base}/pull/${number}`, stderr: '' };
    },
    prClose: (num, comment) => {
      const p = prs.get(Number(num));
      if (offline) return result(false);
      if (!p) return fail(`pull request #${num} not found`);
      p.state = 'CLOSED';
      if (comment) (p.comments = p.comments || []).push({ author: login, body: comment });
      return result(true);
    },
    prList: ({ base: into, head, state, limit, fields }) => withList([...prs.values()]
      .filter((p) => p.base === into && p.head === head && (state === 'all' || p.state === String(state).toUpperCase()))
      .sort((a, b) => b.number - a.number).slice(0, limit).map((p) => pick(prShape(p), fields))),
    prEdit: (num, { title, body }) => {
      const p = prs.get(Number(num));
      if (offline) return result(false);
      if (!p) return fail(`pull request #${num} not found`);
      Object.assign(p, { title, body });
      return result(true);
    },

    runList: ({ branch, commit, limit, fields }) => withList(runs
      .filter((r) => r.headBranch === branch && (!commit || r.headSha === commit))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit).map((r) => pick(r, fields))),

    releaseView: (tag) => {
      if (offline) return result(false);
      return releases.has(tag) ? result(true, { stdout: JSON.stringify({ tagName: tag }) }) : fail('release not found');
    },
    releaseCreate: (tag, { final = false } = {}) => {
      if (offline) return result(false);
      if (releases.has(tag)) return fail(`a release with tag ${tag} already exists`);
      releases.set(tag, { tag, prerelease: !final });
      return result(true, { stdout: `${base}/releases/tag/${tag}` });
    },
  };
}

module.exports = { create };
