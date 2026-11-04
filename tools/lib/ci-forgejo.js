'use strict';
/**
 * tools/lib/ci-forgejo.js — the CI half of the tracker contract on a Forgejo (or Gitea) forge
 * (#678). The owner's ruling on #678 was "landing only": on a Forgejo remote the CLI reads CI so
 * `colab ship` can land code, and writes nothing to the forge's issue tracker (claims, readiness,
 * holds and close-with-evidence stay frozen per #604/#608 — the adopter's own tracker layer owns
 * them there). So this module implements `tracker.CI_METHODS` only: `ciVerdict`.
 *
 * The read: the commit's COMBINED status, `GET {api}/repos/{owner}/{repo}/commits/{sha}/status`,
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
 * The token: read from the environment variable the engine map names (default FORGEJO_TOKEN),
 * inside the child process that makes the request — never on an argument list, never logged. No
 * token is not an error: a public repo's statuses read anonymously; a private one answers 404/401,
 * which is null.
 *
 * Synchronous like the rest of the CLI: the request runs in a child `node` (global fetch, Node >= 18)
 * through spawnSync. `withFetcher` is the test seam.
 */

const { spawnSync } = require('child_process');

const PAGE_LIMIT = 50; // Forgejo's default maximum page size
const MAX_PAGES = 10;
const TIMEOUT_MS = 30000;

let _fetcher = null; // test seam only — see withFetcher

// The child: GET argv[1] with the token from the env var COLAB_FORGE_TOKEN_ENV names; print
// {status, body} as JSON on stdout. Network failures print {status: 0, error}.
const CHILD = `
const [url] = process.argv.slice(1);
const name = process.env.COLAB_FORGE_TOKEN_ENV;
const token = name ? process.env[name] : '';
const headers = { accept: 'application/json' };
if (token) headers.authorization = 'token ' + token;
fetch(url, { headers, signal: AbortSignal.timeout(${TIMEOUT_MS - 2000}) })
  .then(async (r) => process.stdout.write(JSON.stringify({ status: r.status, body: await r.text() })))
  .catch((e) => process.stdout.write(JSON.stringify({ status: 0, error: String(e && e.message || e) })));
`;

/** GET `url` → `{ status, body }` (status 0 = the request never completed). Never throws. */
function httpGet(url, tokenEnv) {
  if (_fetcher) return _fetcher(url, { tokenEnv });
  const r = spawnSync(process.execPath, ['-e', CHILD, url], {
    encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, COLAB_FORGE_TOKEN_ENV: tokenEnv || '' },
  });
  if (r.error || r.status !== 0) return { status: 0, body: '' };
  try { const o = JSON.parse(r.stdout || '{}'); return { status: Number(o.status) || 0, body: o.body || '' }; } catch (_) { return { status: 0, body: '' }; }
}

/** Run `fn` with every HTTP read answered by `fetcher(url, { tokenEnv })` → `{status, body}`. */
function withFetcher(fetcher, fn) {
  const prev = _fetcher;
  _fetcher = fetcher;
  try { return fn(); } finally { _fetcher = prev; }
}

/** One commit status → one run row in tools/lib/git.js's shape. Pure. */
function statusRow(sha, st) {
  const state = String((st && st.status) || (st && st.state) || '').toLowerCase();
  const done = state !== 'pending' && state !== '';
  return {
    headSha: sha,
    workflowName: (st && st.context) || null,
    status: done ? 'completed' : 'in_progress',
    conclusion: done ? state : '',
    createdAt: (st && (st.updated_at || st.created_at)) || null,
    databaseId: null,
    url: (st && st.target_url) || null,
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

function create(repoAbs, eng) {
  const base = `${eng.api}/repos/${encodeURIComponent(eng.owner)}/${encodeURIComponent(eng.repo)}`;
  return {
    kind: 'forgejo',
    repo: repoAbs,
    engine: eng,

    /**
     * The CI verdict at `sha` (tracker contract, #678). `branch` is accepted and ignored: a commit
     * status belongs to the commit, whatever ref carries it.
     */
    ciVerdict: (sha) => {
      const full = /^[0-9a-f]{40}$/i.test(String(sha || '')) ? String(sha).toLowerCase() : require('./git').fullSha(repoAbs, sha);
      if (!full) return null;
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
      const rows = rowsFromPages(full, pages);
      return rows === null ? null : require('./git').summarizeRunsForCommit(rows, full);
    },
  };
}

module.exports = { create, withFetcher, statusRow, rowsFromPages, PAGE_LIMIT };
