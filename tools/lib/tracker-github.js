'use strict';
/**
 * tools/lib/tracker-github.js — the GitHub implementation of the tracker contract (#500), and the
 * ONLY place in the CLI that spawns `gh`. Every `gh` call in tools/colab and tools/lib/git.js
 * reaches the binary through `exec` below; the contract it implements is tools/lib/tracker.js.
 *
 * Two layers, on purpose:
 *   - `exec(args, opts)` — the raw spawn. git.js's `gh*` helpers call it (through their own lazy
 *     `gh()`), so their bodies, exports and callers stay exactly as they were.
 *   - `create(repoAbs)` — a repo-bound object carrying the contract's methods (tracker.METHODS).
 *     Methods are synchronous, never throw on an environment failure (no gh, no remote, offline —
 *     all come back as data), and keep the existing helpers' return shapes: a write returns
 *     git.run's `{ ok, code, stdout, stderr, error, timedOut }`; a list read adds `data` (parsed
 *     JSON, or `null` when the call failed, printed nothing, or printed something unparseable —
 *     `null` is "could not read", never "none").
 *
 * Behaviour-preserving by construction: every method spawns the exact argv and options the call
 * site it replaced spawned (pinned by tools/lib/tracker-github.test.js's argv table). The one
 * addition is the environment: `exec` pins `GH_REPO` to the resolved remote's repo (#658,
 * `pinnedOpts`), so no call depends on gh's default repo or on which other remotes exist.
 *
 * This module must NOT require ./tracker (tracker requires this one), and git.js must never require
 * this module at its top level: git.js ends in `module.exports = {…}`, which REPLACES the exports
 * object, so a load-time cycle would hand this module a stale empty `{}`. `git.run` is therefore
 * looked up at call time, never captured — tests also swap PATH between calls, so the binary is
 * resolved per call, never cached.
 */

let _runner = null; // test seam only — see withRunner

/**
 * #658 — `[HOST/]OWNER/REPO` for a remote URL, in the form `GH_REPO` takes, or null.
 *
 * Only a host gh is known to serve is pinned: `github.com`, or the `GH_HOST` the environment names.
 * Any other host — an SSH alias, a self-hosted forge gh was never pointed at — reads as null, and
 * the call keeps gh's own resolution exactly as before, rather than pinning a name gh cannot reach.
 */
function ghRepoFromUrl(url, env = process.env) {
  const s = String(url || '').trim();
  let m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/*$/i.exec(s);
  if (!m) m = /^(?:[^@/\s]+@)?([^:/\s]+):([^/]+)\/([^/]+?)(?:\.git)?\/*$/.exec(s);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const ghHost = String(env.GH_HOST || '').toLowerCase();
  if (host === 'github.com') return `${m[2]}/${m[3]}`;
  if (ghHost && host === ghHost) return `${host}/${m[2]}/${m[3]}`;
  return null;
}

const _pinCache = new Map(); // resolved cwd → GH_REPO value or null; one repo's remote does not move mid-run
function _resetPinCache() { _pinCache.clear(); }

/**
 * #658 — the repo every `gh` call is pinned to: the one colab's own resolved remote points at
 * (`origin`, or `colab.remote` / the single remote — tools/lib/git.js `remoteInfo`, #301), read
 * for the call's `cwd`. Without it a bare `gh issue|pr|run …` follows gh's own default, which on
 * a fork checkout with an `upstream` remote and no `gh repo set-default` is the UPSTREAM — a ship
 * then read the carried issues as CLOSED and trunk CI as "no run" from the wrong repo.
 * null when nothing resolves (no remote, ambiguous remotes, a host gh does not serve): unpinned.
 */
function pinnedRepo(cwd) {
  const key = require('path').resolve(cwd || process.cwd());
  if (_pinCache.has(key)) return _pinCache.get(key);
  let slug = null;
  try {
    // The CONFIGURED url, not `git remote get-url`: get-url expands `url.<x>.insteadOf`, which
    // rewrites how git reaches the remote (a mirror, a local path), never which forge repo it is.
    const g = require('./git');
    const { name } = g.remoteInfo(key);
    const u = name ? g.git(['config', '--get', `remote.${name}.url`], key) : null;
    slug = u && u.ok ? ghRepoFromUrl(u.stdout) : null;
  } catch (_) { slug = null; }
  _pinCache.set(key, slug);
  return slug;
}

/**
 * `opts` with `GH_REPO` set to `pinnedRepo(opts.cwd)` — unless the call already names its repo
 * (`--repo`/`-R`), the caller passed its own `GH_REPO`, or the environment sets one (an explicit
 * choice, honoured as gh honours it). Every other option passes through untouched.
 */
function pinnedOpts(args, opts = {}) {
  if ((args || []).some((a) => a === '--repo' || a === '-R' || /^--repo=/.test(String(a)))) return opts;
  const base = opts.env || process.env;
  if (base.GH_REPO) return opts;
  const slug = pinnedRepo(opts.cwd);
  return slug ? { ...opts, env: { ...base, GH_REPO: slug } } : opts;
}

/** Spawn `gh <args>` with `opts` (git.run's options: cwd, timeoutMs, maxBuffer, …), pinned to origin's repo (#658). */
function exec(args, opts = {}) {
  return _runner ? _runner(args, opts) : require('./git').run('gh', args, pinnedOpts(args, opts));
}

/**
 * Run `fn` with every `gh` spawn — including the ones git.js's helpers make — routed to
 * `runner(args, opts)` instead of the binary. Synchronous only; the previous runner is restored
 * even when `fn` throws.
 */
function withRunner(runner, fn) {
  const prev = _runner;
  _runner = runner;
  try { return fn(); } finally { _runner = prev; }
}

/** Parsed stdout as `data`, or null on failure / empty / unparseable output. */
function withData(r) {
  let data = null;
  if (r.ok && r.stdout) { try { data = JSON.parse(r.stdout); } catch (_) { data = null; } }
  return { ...r, data };
}

function create(repoAbs) {
  const git = () => require('./git');
  const at = { cwd: repoAbs };
  return {
    kind: 'github',
    repo: repoAbs,

    // --- identity / availability -------------------------------------------------------------
    state: () => git().ghState(),
    currentLogin: () => git().ghCurrentLogin(),

    // --- issues ------------------------------------------------------------------------------
    issueView: (num, fields) => git().ghIssueView(repoAbs, num, fields),
    issueListAll: ({ limit, fields, maxBuffer } = {}) => withData(exec(
      ['issue', 'list', '--state', 'all', '--limit', String(limit), '--json', fields.join(',')],
      { ...at, ...(maxBuffer ? { maxBuffer } : {}) })),
    issueCreate: ({ title, body }) => {
      const r = exec(['issue', 'create', '--title', title, '--body', body], at);
      const m = r.ok ? /\/issues\/([0-9]+)/.exec(r.stdout || '') : null;
      return { ...r, number: m ? Number(m[1]) : null, url: m ? (r.stdout || '').trim() : null };
    },
    issueComment: (num, body) => git().ghIssueComment(repoAbs, num, body),
    issueClose: (num, { reason } = {}) =>
      exec(['issue', 'close', String(num), ...(reason ? ['--reason', reason] : [])], at),
    issueRelease: (num, opts) => git().ghIssueRelease(repoAbs, num, opts),
    claimHolder: (num) => git().ghClaimHolder(repoAbs, num),

    // --- labels ------------------------------------------------------------------------------
    labelList: () => git().ghListLabels(repoAbs),

    // --- pull requests -----------------------------------------------------------------------
    prForBranch: (branch) => git().ghPrForBranch(repoAbs, branch),
    prCreate: (spec) => git().ghPrCreate(repoAbs, spec),
    prClose: (num, comment) => git().ghPrClose(repoAbs, num, comment),
    prList: ({ base, head, state, limit, fields }) => withData(exec(
      ['pr', 'list', '--base', base, '--head', head, '--state', state, '--limit', String(limit),
        '--json', fields.join(',')], at)),
    prEdit: (num, { title, body }) =>
      exec(['pr', 'edit', String(num), '--title', title, '--body', body], at),

    // --- CI runs -----------------------------------------------------------------------------
    runList: ({ branch, commit, limit, fields }) => withData(exec(
      ['run', 'list', '--branch', branch, ...(commit ? ['--commit', commit] : []), '-L', String(limit),
        '--json', fields.join(',')], at)),

    // --- releases ----------------------------------------------------------------------------
    releaseView: (tag) => exec(['release', 'view', tag, '--json', 'tagName'], at),
    releaseCreate: (tag, { notesFile, final = false }) => {
      const releaseCut = require('./release-cut'); // owns the argv (release-cut.test.js pins it)
      return exec(final ? releaseCut.finalReleaseArgs(tag, notesFile) : releaseCut.prereleaseArgs(tag, notesFile), at);
    },
  };
}

module.exports = { exec, withRunner, create, ghRepoFromUrl, pinnedRepo, pinnedOpts, _resetPinCache };
