'use strict';
/**
 * tools/lib/ci-forgejo.js — the forge engine on a Forgejo (or Gitea) remote (#678, #681). The owner's
 * ruling on #678 was "landing only": on a Forgejo remote the CLI reads CI so `colab ship` can land
 * code, and writes nothing to the forge's issue tracker (claims, readiness, holds and
 * close-with-evidence stay frozen per #604/#608 — the adopter's own tracker layer owns them there).
 * #681 adds the release half: `colab release cut` / `release finalize` (human bar) / `promote` read CI
 * here and publish the release object here. So this module implements `tracker.FORGE_METHODS`:
 *   ciVerdict     — the CI verdict at a commit (below);
 *   runsAtRef     — the rows at a batch head (#742): the same status read, ignoring the ref;
 *   issueListAll  — a READ of every issue (switch markers, the release hold, an existing tracking
 *                   record), in the GitHub adapter's shape; nothing here writes an issue;
 *   issueView / commentView — (#740) READS of one issue (its comments and state: the executor's
 *                   claim a hand-off land checks) and of one comment by id (the hand-off itself);
 *   releaseView / releaseCreate — the release object for a tag (`/releases`).
 * Plus three reads that are NOT contract (forge-shaped, like the GitHub adapter's raw run lists):
 * `ciRunsAt` (the status rows at a commit), `ciRunsSince` (rows for every commit on a branch since a
 * day — finalize's trunk window) and `blockedBy` (an issue's dependencies — a tracking record's
 * regression edges).
 *
 * The CI read: the commit's COMBINED status, `GET {api}/repos/{owner}/{repo}/commits/{sha}/status`,
 * which already holds the newest status per context. Each status becomes one row in the shape
 * tools/lib/git.js summarizes for GitHub runs (`context` is the workflow name), and the verdict is
 * `git.summarizeRunsForCommit` over those rows — the same all-quantifier rule, so a forge cannot
 * read green where GitHub would read red:
 *   pending                       -> status in_progress (not finished: not green yet)
 *   success                       -> completed / success
 *   failure | error | warning | ? -> completed / <state> (only success counts — the allowlist rule)
 * No statuses at all -> `status: 'none'`. Any failed read (HTTP error, timeout, bad JSON, a 404
 * for a commit the forge does not have) -> null, which every caller reads as "could not read",
 * never as "none". `databaseId` is always null: a forge status has no run whose jobs `gh run view`
 * could list, so nothing downstream ever reaches for gh with it.
 *
 * #681: a row also carries `event`, read from the context's trailing `(<event>)` — a Forgejo Actions
 * context is `<workflow> / <job> (<event>)`. Additive: the ship verdict never filters on it; release
 * cut's verifying-runs rule (tools/lib/verify-runs.js) does, so a dispatched or scheduled run at the
 * sha (the release workflow itself) is set aside exactly as on GitHub. Gotcha: a combined status
 * keeps only the NEWEST status per context, so a finished row's `createdAt` is when it finished —
 * there is no start time to read. finalize's cut-run check (#566) therefore finds no run "in
 * progress at the cut" on a forge and reports the candidate as cut by hand; that is the honest read.
 *
 * The token: read from the environment variable the engine map names (default FORGEJO_TOKEN),
 * inside the child process that makes the request — never on an argument list, never logged. No
 * token is not an error for a read: a public repo's statuses read anonymously; a private one answers
 * 404/401, which is null. A write without a token answers 401/403, which is ok:false.
 *
 * Synchronous like the rest of the CLI: the request runs in a child `node` (global fetch, Node >= 18)
 * through spawnSync; a request body travels on the child's stdin. `withFetcher` is the test seam.
 */

const { spawnSync } = require('child_process');

const PAGE_LIMIT = 50; // Forgejo's default maximum page size
const MAX_PAGES = 10;
const TIMEOUT_MS = 30000;

let _fetcher = null; // test seam only — see withFetcher

// The child: send argv[2] (a method) to argv[1] with the token from the env var COLAB_FORGE_TOKEN_ENV
// names, and stdin as a JSON body when there is one; print {status, body} as JSON on stdout. Network
// failures print {status: 0, error}.
const CHILD = `
const [url, method] = process.argv.slice(1);
const name = process.env.COLAB_FORGE_TOKEN_ENV;
const token = name ? process.env[name] : '';
const headers = { accept: 'application/json' };
if (token) headers.authorization = 'token ' + token;
let input = '';
try { input = require('fs').readFileSync(0, 'utf8'); } catch (_) { input = ''; }
const init = { method: method || 'GET', headers, signal: AbortSignal.timeout(${TIMEOUT_MS - 2000}) };
if (input) { headers['content-type'] = 'application/json'; init.body = input; }
fetch(url, init)
  .then(async (r) => process.stdout.write(JSON.stringify({ status: r.status, body: await r.text() })))
  .catch((e) => process.stdout.write(JSON.stringify({ status: 0, error: String(e && e.message || e) })));
`;

/**
 * `method` `url` (JSON `body` when given) → `{ status, body }` (status 0 = the request never
 * completed). Never throws. The fetcher seam sees `(url, { tokenEnv, method, body })`.
 */
function httpRequest(method, url, tokenEnv, body = null) {
  const payload = body === null || body === undefined ? '' : JSON.stringify(body);
  if (_fetcher) return _fetcher(url, { tokenEnv, method, ...(payload ? { body: payload } : {}) });
  const r = spawnSync(process.execPath, ['-e', CHILD, url, method], {
    encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, input: payload,
    env: { ...process.env, COLAB_FORGE_TOKEN_ENV: tokenEnv || '' },
  });
  if (r.error || r.status !== 0) return { status: 0, body: '' };
  try { const o = JSON.parse(r.stdout || '{}'); return { status: Number(o.status) || 0, body: o.body || '' }; } catch (_) { return { status: 0, body: '' }; }
}

/** GET `url` → `{ status, body }`. Never throws. */
function httpGet(url, tokenEnv) {
  return httpRequest('GET', url, tokenEnv);
}

/** Run `fn` with every HTTP request answered by `fetcher(url, { tokenEnv, method, body })` → `{status, body}`. */
function withFetcher(fetcher, fn) {
  const prev = _fetcher;
  _fetcher = fetcher;
  try { return fn(); } finally { _fetcher = prev; }
}

/** One commit status → one run row in tools/lib/git.js's shape. Pure. */
function statusRow(sha, st) {
  const state = String((st && st.status) || (st && st.state) || '').toLowerCase();
  const done = state !== 'pending' && state !== '';
  const ev = /\(([a-z_]+)\)\s*$/.exec(String((st && st.context) || ''));
  return {
    headSha: sha,
    workflowName: (st && st.context) || null,
    status: done ? 'completed' : 'in_progress',
    conclusion: done ? state : '',
    createdAt: (st && (st.updated_at || st.created_at)) || null,
    updatedAt: (st && (st.updated_at || st.created_at)) || null,
    databaseId: null,
    url: (st && st.target_url) || null,
    ...(ev ? { event: ev[1] } : {}), // #681: `<workflow> / <job> (<event>)`
  };
}

/** The status rows for `sha` from a sequence of combined-status pages, or null when any page failed. Pure. */
function rowsFromPages(sha, pages) {
  const rows = [];
  for (const p of pages) {
    if (!p || !Array.isArray(p.statuses)) return null;
    for (const st of p.statuses) rows.push(statusRow(sha, st));
  }
  return rows;
}

/** One issue from Forgejo's issue API → the GitHub adapter's issue shape (`gh issue list --json`). Pure. */
function issueShape(i) {
  return {
    number: i.number,
    title: i.title == null ? null : String(i.title),
    body: i.body == null ? '' : String(i.body),
    state: String(i.state || '').toLowerCase() === 'closed' ? 'CLOSED' : 'OPEN',
    stateReason: null, // Forgejo records no close reason
    labels: Array.isArray(i.labels) ? i.labels.map((l) => ({ name: typeof l === 'string' ? l : (l && l.name) })) : [],
    assignees: Array.isArray(i.assignees) ? i.assignees.map((u) => ({ login: u && u.login })) : [],
    createdAt: i.created_at || null,
    closedAt: i.closed_at || null,
    url: i.html_url || null,
  };
}

/** One comment from Forgejo's comment API → the GitHub adapter's comment shape (`gh issue view --json comments`). Pure. */
function commentShape(c) {
  return {
    author: { login: (c && c.user && c.user.login) || '' },
    body: c && c.body != null ? String(c.body) : '',
    createdAt: (c && c.created_at) || null,
    url: (c && c.html_url) || null,
  };
}

function pick(o, fields) {
  if (!Array.isArray(fields) || !fields.length) return o;
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(o, f)) out[f] = o[f];
  return out;
}

const result = (ok, extra = {}) => ({ ok, code: ok ? 0 : 1, stdout: '', stderr: '', ...extra });

function create(repoAbs, eng) {
  const base = `${eng.api}/repos/${encodeURIComponent(eng.owner)}/${encodeURIComponent(eng.repo)}`;
  const fullOf = (sha) => (/^[0-9a-f]{40}$/i.test(String(sha || '')) ? String(sha).toLowerCase() : require('./git').fullSha(repoAbs, sha));

  /** The status rows at a full sha, or null when any page failed. */
  const rowsAt = (full) => {
    const pages = [];
    let seen = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = httpGet(`${base}/commits/${full}/status?page=${page}&limit=${PAGE_LIMIT}`, eng.tokenEnv);
      if (r.status !== 200) return null;
      let j;
      try { j = JSON.parse(r.body); } catch (_) { return null; }
      if (!j || typeof j !== 'object') return null;
      pages.push(j);
      const n = Array.isArray(j.statuses) ? j.statuses.length : 0;
      seen += n;
      const total = Number(j.total_count);
      if (n < PAGE_LIMIT || (Number.isFinite(total) && seen >= total)) break;
      if (page === MAX_PAGES) return null; // more statuses than we read: never a partial verdict
    }
    return rowsFromPages(full, pages);
  };

  return {
    kind: 'forgejo',
    repo: repoAbs,
    engine: eng,

    /**
     * The CI verdict at `sha` (tracker contract, #678). `branch` is accepted and ignored: a commit
     * status belongs to the commit, whatever ref carries it. `rowsFilter` (#681) narrows the rows
     * before the verdict — ci-wait inside the release workflow drops that workflow's own contexts.
     */
    ciVerdict: (sha, { rowsFilter = null } = {}) => {
      const full = fullOf(sha);
      if (!full) return null;
      let rows = rowsAt(full);
      if (rows === null) return null;
      if (typeof rowsFilter === 'function') rows = rowsFilter(rows);
      const summary = require('./git').summarizeRunsForCommit(rows, full);
      // #682: additive — the contexts that keep this sha from green, so a refusal can name them.
      // #688: a context the verdict set aside as skipped is not one of them.
      const aside = new Set((summary.skippedOnly || []).map((x) => x.workflowName));
      const ng = notGreen(rows).filter((x) => !aside.has(x.name));
      return ng.length ? { ...summary, notGreen: ng } : summary;
    },

    /**
     * #742, tracker contract: the runs on batch `ref` at `sha`. A commit status belongs to the commit,
     * so the ref is accepted and ignored (a batch head is a commit no other ref carries). No `attempt`:
     * a re-run replaces the context's newest status, and nothing counts how often — the batch reads 1.
     */
    runsAtRef: (ref, sha) => {
      const full = fullOf(sha);
      return full ? rowsAt(full) : null;
    },

    /** #681, not contract: the status rows at `sha` (statusRow's shape), or null when the read failed. */
    ciRunsAt: (sha) => {
      const full = fullOf(sha);
      return full ? rowsAt(full) : null;
    },

    /**
     * #681, not contract: the rows of every commit on `<remote>/<branch>` committed on or after
     * `sinceDay` (YYYY-MM-DD) — `git.ghRunsSince`'s `{ runs, truncated }`, each row carrying `branch`.
     * The commits come from git (the caller fetched); a forge has no run list to filter by date. null
     * when git or any status read failed. `truncated` when more than `limit` commits fall in the window.
     */
    ciRunsSince: (branch, sinceDay, { remote = null, limit = 100 } = {}) => {
      const g = require('./git');
      const rem = remote || g.remoteFor(repoAbs);
      const log = g.git(['log', `--since=${sinceDay}T00:00:00Z`, '--format=%H', `refs/remotes/${rem}/${branch}`], repoAbs);
      if (!log.ok) return null;
      const shas = log.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
      const runs = [];
      for (const sha of shas.slice(0, limit)) {
        const rows = rowsAt(sha.toLowerCase());
        if (rows === null) return null;
        for (const r of rows) runs.push({ ...r, branch });
      }
      return { runs, truncated: shas.length > limit };
    },

    /**
     * Every issue, open and closed, newest first (tracker contract). Pull requests are not issues here:
     * `type=issues`. `data` null when any page failed — never a partial list read as complete.
     */
    issueListAll: ({ limit = 1000, fields = null } = {}) => {
      const out = [];
      const max = Math.max(1, Math.ceil(limit / PAGE_LIMIT));
      for (let page = 1; page <= max && out.length < limit; page++) {
        const r = httpGet(`${base}/issues?state=all&type=issues&page=${page}&limit=${PAGE_LIMIT}`, eng.tokenEnv);
        if (r.status !== 200) return result(false, { stderr: `GET issues page ${page}: HTTP ${r.status || 'no reply'}`, data: null });
        let j;
        try { j = JSON.parse(r.body); } catch (_) { return result(false, { stderr: `GET issues page ${page}: not JSON`, data: null }); }
        if (!Array.isArray(j)) return result(false, { stderr: `GET issues page ${page}: not a list`, data: null });
        for (const i of j) if (i && !i.pull_request) out.push(issueShape(i));
        if (j.length < PAGE_LIMIT) break;
      }
      out.sort((x, y) => y.number - x.number);
      return result(true, { data: out.slice(0, limit).map((i) => pick(i, fields)) });
    },

    /**
     * One issue (tracker contract, #740): the GitHub adapter's shape, narrowed to `fields`; null when it
     * could not be read (absent, any failed read). `comments` costs a second, paged
     * read, so it is made only when asked for — and a partial comment list is null, never a short list.
     */
    issueView: (num, fields = null) => {
      const r = httpGet(`${base}/issues/${Number(num)}`, eng.tokenEnv);
      if (r.status !== 200) return null;
      let i;
      try { i = JSON.parse(r.body); } catch (_) { return null; }
      if (!i || typeof i !== 'object' || Array.isArray(i)) return null;
      const out = issueShape(i);
      if (Array.isArray(fields) && fields.includes('comments')) {
        const comments = [];
        for (let page = 1; ; page++) {
          if (page > MAX_PAGES) return null; // more comments than we read: never a partial claim read
          const c = httpGet(`${base}/issues/${Number(num)}/comments?page=${page}&limit=${PAGE_LIMIT}`, eng.tokenEnv);
          if (c.status !== 200) return null;
          let list;
          try { list = JSON.parse(c.body); } catch (_) { return null; }
          if (!Array.isArray(list)) return null;
          for (const x of list) comments.push(commentShape(x));
          if (list.length < PAGE_LIMIT) break;
        }
        out.comments = comments;
      }
      return pick(out, fields);
    },

    /** One issue comment by id (tracker contract, #740): `{ body, login, createdAt, htmlUrl }`, null when unread. */
    commentView: (id) => {
      if (!/^\d+$/.test(String(id || ''))) return null;
      const r = httpGet(`${base}/issues/comments/${String(id)}`, eng.tokenEnv);
      if (r.status !== 200) return null;
      let c;
      try { c = JSON.parse(r.body); } catch (_) { return null; }
      if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
      return { body: c.body == null ? '' : String(c.body), login: (c.user && c.user.login) || '', createdAt: c.created_at || '', htmlUrl: c.html_url || '' };
    },

    /** #681, not contract: the issues blocking issue `num` — `[{ number, state, closedAt }]`, null when unread. */
    blockedBy: (num) => {
      const r = httpGet(`${base}/issues/${Number(num)}/dependencies?limit=${PAGE_LIMIT}`, eng.tokenEnv);
      if (r.status !== 200) return null;
      try {
        const list = JSON.parse(r.body);
        if (!Array.isArray(list)) return null;
        return list.map((i) => ({ number: i.number, state: String(i.state || '').toLowerCase(), closedAt: i.closed_at || null }));
      } catch (_) { return null; }
    },

    /** The release for `tag` (tracker contract): ok when it exists, ok:false (data) when not or unread. */
    releaseView: (tag) => {
      const r = httpGet(`${base}/releases/tags/${encodeURIComponent(tag)}`, eng.tokenEnv);
      if (r.status === 200) return result(true, { stdout: JSON.stringify({ tagName: tag }) });
      return result(false, { code: r.status || 1, stderr: r.status === 404 ? 'release not found' : `HTTP ${r.status || 'no reply'}` });
    },

    /**
     * Publish the release for an EXISTING tag (tracker contract): a pre-release unless `final`. The
     * notes are the file's text. A tag that already has a release answers 409 — ok:false, as data.
     */
    releaseCreate: (tag, { notesFile = null, final = false } = {}) => {
      let notes = '';
      if (notesFile) { try { notes = require('fs').readFileSync(notesFile, 'utf8'); } catch (_) { notes = ''; } }
      const r = httpRequest('POST', `${base}/releases`, eng.tokenEnv, { tag_name: tag, name: tag, body: notes, draft: false, prerelease: !final });
      if (r.status === 200 || r.status === 201) {
        let url = '';
        try { url = (JSON.parse(r.body) || {}).html_url || ''; } catch (_) { url = ''; }
        return result(true, { stdout: url || `${String(eng.api).replace(/\/api\/v1$/, '')}/${eng.owner}/${eng.repo}/releases/tag/${tag}` });
      }
      const why = r.status === 409 ? `a release with tag ${tag} already exists` : r.status === 401 || r.status === 403 ? `HTTP ${r.status} — the token in ${eng.tokenEnv} cannot write releases` : `HTTP ${r.status || 'no reply'}`;
      return result(false, { code: r.status || 1, stderr: why });
    },
  };
}

/**
 * #682: every context that is not `success` — still pending, or finished red — in the compact
 * `{name, status, conclusion}` shape a verdict detail names them by. Pure; [] when all are green.
 */
function notGreen(rows) {
  return (rows || []).filter((x) => !(x.status === 'completed' && x.conclusion === 'success'))
    .map((x) => ({ name: x.workflowName || 'unnamed', status: x.status, conclusion: x.conclusion || null }));
}

module.exports = { create, withFetcher, statusRow, rowsFromPages, notGreen, issueShape, commentShape, PAGE_LIMIT };
