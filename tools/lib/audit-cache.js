'use strict';
/**
 * The audit's GitHub REST reads, cached across runs (#593).
 *
 * Why: the audit reads GitHub for every repo on every run (`repos/<r>`, `repos/<r>/labels`, and
 * for a slug target its files, branches and tags). A host that runs it often — a dashboard
 * rebuilding its overview — made it the largest consumer of the account's REST quota (measured
 * ≈10,000 calls/h on one machine against a 5,000/h limit), stalling everything else that machine
 * does with GitHub. Repo settings and label sets change rarely.
 *
 * How:
 *   - one JSON file per repo, keyed by API path (+ Accept), holding each PAGE's body and ETag;
 *   - within the TTL (default 600 s) an entry is served with no request at all;
 *   - past it, every page is re-asked with `If-None-Match` — a 304 costs no quota and re-arms the
 *     TTL; a 200 replaces the page;
 *   - `fresh` skips the TTL (every read goes to the server, still conditional — a 304 is the
 *     server saying "unchanged", which is as fresh as a 200);
 *   - a 404 is cached as "missing" for the TTL (it has no ETag, so re-asking it past the TTL costs one call);
 *   - on a rate limit or no response at all, an existing entry is served and labelled `stale`;
 *     any other error (404, 403, unparseable) is an error, never a stale answer — a repo that
 *     was deleted must not keep reporting its old label set.
 *
 * Where: `COLAB_AUDIT_CACHE_DIR`, else `<COLAB_HOME>/cache/audit` — but only when COLAB_HOME
 * already EXISTS. The audit never creates the operator's colab home; without it the cache lives
 * in memory for one run (each read still made at most once per run).
 *
 * Partitioned by WHO answers: the `gh` binary's resolved path, GH_HOST and a hash of any token in
 * the environment. Two tokens can see different repos, and a test's fake `gh` must never read —
 * or write — the operator's real entries.
 *
 * Provenance: every read is logged against the repo currently being audited (`begin()`), and
 * `summary()` reports how many reads came from cache, were revalidated, fetched, or stale, and
 * the age of the oldest data served — what `--json` shows per repo.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { parseHttp } = require('./ci-wait');

const DEFAULT_TTL_SECONDS = 600;
const PER_PAGE = 100;
const MAX_PAGES = 50; // 5,000 labels/tags/branches — a runaway Link chain must not loop forever
const PRUNE_AFTER_MS = 7 * 24 * 3600 * 1000;
const FORMAT = 1;

/** TTL in seconds from a flag value, else COLAB_AUDIT_CACHE_TTL, else the default. null = invalid. */
function resolveTtlSeconds(flag, env = process.env) {
  const raw = flag !== undefined && flag !== null ? flag : env.COLAB_AUDIT_CACHE_TTL;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TTL_SECONDS;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** The cache directory, or null when there is nowhere we are allowed to write. */
function resolveDir(env = process.env, colabHome) {
  if (env.COLAB_AUDIT_CACHE_DIR) return path.resolve(env.COLAB_AUDIT_CACHE_DIR);
  if (colabHome && fs.existsSync(colabHome)) return path.join(colabHome, 'cache', 'audit');
  return null;
}

/** First executable `gh` on PATH, resolved — the transport half of the partition key. */
function ghOnPath(env = process.env) {
  for (const d of String(env.PATH || '').split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, 'gh');
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.realpathSync(p);
    } catch (_) { /* next */ }
  }
  return null;
}

function partitionKey(env = process.env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || env.GH_ENTERPRISE_TOKEN || '';
  const parts = [ghOnPath(env) || 'no-gh', env.GH_HOST || 'github.com',
    token ? crypto.createHash('sha256').update(token).digest('hex') : 'ambient'];
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

/**
 * One GET through `gh api -i`. The path stays the first argument after `api` (callers and fakes
 * match on it). Returns { kind: 'ok'|'not-modified'|'rate-limited'|'unreachable'|'error',
 * etag, next, body }.
 */
function ghFetch(apiPath, { etag, accept } = {}) {
  const args = ['api', apiPath, '-i'];
  if (etag) args.push('-H', `If-None-Match: ${etag}`);
  if (accept) args.push('-H', `Accept: ${accept}`);
  const r = spawnSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { kind: 'unreachable' };
  return classify(r.stdout, r.stderr, r.status);
}

function classify(stdout, stderr, exitCode) {
  const http = parseHttp(stdout);
  const status = http.status;
  const h = http.headers || {};
  const rateText = /rate limit/i.test(String(stderr || '') + (status && status >= 400 ? http.body : ''));
  if (status === 429 || (status === 403 && (h['x-ratelimit-remaining'] === '0' || rateText)) || (status === null && rateText)) {
    return { kind: 'rate-limited' };
  }
  if (status === 304) return { kind: 'not-modified', etag: h.etag || null };
  const next = /rel="next"/.test(h.link || '');
  if (status !== null && status >= 200 && status < 300) return { kind: 'ok', etag: h.etag || null, next, linkKnown: true, body: http.body };
  // No status line: a `gh` that does not print headers. Exit 0 is an answer without an ETag.
  if (status === null && exitCode === 0) return { kind: 'ok', etag: null, next: false, linkKnown: false, body: String(stdout || '') };
  if (status === null) return { kind: 'unreachable' };
  return { kind: 'error', status };
}

function withPage(apiPath, page) {
  return `${apiPath}${apiPath.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`;
}

/**
 * create({ dir, ttlSeconds, fresh, offline, now, fetch, env })
 *   get(slug, apiPath, { accept, paginate }) → { status: 'ok', text } | { status: 'ok', items }
 *                                             | { status: 'offline' } | { status: 'error' }
 *   begin() — start logging reads for the next repo; summary() — that repo's provenance.
 */
function create(opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now || Date.now;
  const fetch = opts.fetch || ghFetch;
  const ttlMs = (opts.ttlSeconds === undefined ? DEFAULT_TTL_SECONDS : opts.ttlSeconds) * 1000;
  const fresh = !!opts.fresh;
  const offline = !!opts.offline;
  const dir = opts.dir ? path.join(opts.dir, opts.partition || partitionKey(env)) : null;

  const files = new Map(); // slug → { entries }
  const doneThisRun = new Set(); // slug|key validated or fetched in this process
  let log = [];
  let pruned = false;

  const fileFor = (slug) => (dir ? path.join(dir, `${slug.replace(/[^A-Za-z0-9._-]/g, '__')}.json`) : null);

  function load(slug) {
    if (files.has(slug)) return files.get(slug);
    let data = { format: FORMAT, slug, entries: {} };
    const f = fileFor(slug);
    if (f) {
      try {
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (parsed && parsed.format === FORMAT && parsed.entries && typeof parsed.entries === 'object') data = parsed;
      } catch (_) { /* absent or corrupt: start empty, the next write repairs it */ }
    }
    files.set(slug, data);
    return data;
  }

  function save(slug) {
    const f = fileFor(slug);
    if (!f) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${f}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(files.get(slug)));
      fs.renameSync(tmp, f); // atomic: a concurrent audit reads the old file or the new one
    } catch (_) { /* a cache that cannot be written is a slower run, never a failed one */ }
    if (!pruned) { pruned = true; prune(); }
  }

  function prune() {
    const root = path.dirname(dir);
    const cutoff = now() - PRUNE_AFTER_MS;
    let parts;
    try { parts = fs.readdirSync(root); } catch (_) { return; }
    for (const p of parts) {
      const d = path.join(root, p);
      let names;
      try { names = fs.readdirSync(d); } catch (_) { continue; }
      for (const n of names) {
        const fp = path.join(d, n);
        try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch (_) { /* raced */ }
      }
      try { if (!fs.readdirSync(d).length) fs.rmdirSync(d); } catch (_) { /* not empty / raced */ }
    }
  }

  function record(source, ageMs) { log.push({ source, ageSeconds: Math.max(0, Math.round(ageMs / 1000)) }); }

  function answer(entry, paginate) {
    if (entry.missing) return { status: 'error' };
    if (!paginate) return { status: 'ok', text: entry.pages[0].body };
    const items = [];
    for (const p of entry.pages) {
      let arr;
      try { arr = JSON.parse(p.body); } catch (_) { return { status: 'error' }; }
      if (!Array.isArray(arr)) return { status: 'error' };
      items.push(...arr);
    }
    return { status: 'ok', items };
  }

  function get(slug, apiPath, { accept = null, paginate = false } = {}) {
    if (offline) { record('offline', 0); return { status: 'offline' }; }
    const key = accept ? `${apiPath}|${accept}` : apiPath;
    const data = load(slug);
    const entry = data.entries[key];
    const runKey = `${slug}|${key}`;

    if (entry && (doneThisRun.has(runKey) || (!fresh && now() - entry.at < ttlMs))) {
      record(doneThisRun.has(runKey) ? 'run' : 'cache', now() - entry.at);
      return answer(entry, paginate);
    }

    const pages = [];
    let allNotModified = true;
    for (let i = 0; i < (paginate ? MAX_PAGES : 1); i++) {
      const cached = entry && !entry.missing && entry.pages[i];
      const r = fetch(paginate ? withPage(apiPath, i + 1) : apiPath, { etag: cached ? cached.etag : null, accept });
      let page;
      if (r.kind === 'not-modified' && cached) page = cached;
      else if (r.kind === 'ok') {
        allNotModified = false;
        let next = !!r.next;
        if (paginate && !r.linkKnown) { // no headers to follow: a full page means there may be more
          try { const a = JSON.parse(r.body); next = Array.isArray(a) && a.length >= PER_PAGE; } catch (_) { next = false; }
        }
        page = { etag: r.etag || null, next, body: r.body };
      } else {
        if (entry && (r.kind === 'rate-limited' || r.kind === 'unreachable')) {
          record('stale', now() - entry.at);
          return { ...answer(entry, paginate), stale: true };
        }
        if (r.kind === 'error' && r.status === 404 && i === 0) {
          // An absent file is an answer too, and the audit asks for several on every run (a
          // runbook, a tool, a workflow dir). Cached for the TTL like any other; past it, asked
          // again — a 404 carries no ETag, so that one costs a call.
          data.entries[key] = { at: now(), missing: true, pages: [] };
          doneThisRun.add(runKey);
          save(slug);
          record('fetched', 0);
          return { status: 'error' };
        }
        record('error', 0);
        return { status: 'error' };
      }
      pages.push(page);
      if (!paginate || !page.next) break;
    }

    data.entries[key] = { at: now(), pages };
    doneThisRun.add(runKey);
    save(slug);
    record(allNotModified ? 'revalidated' : 'fetched', 0);
    return answer(data.entries[key], paginate);
  }

  function begin() { log = []; }

  /** This repo's remote provenance since begin(); null when it made no GitHub read at all. */
  function summary() {
    if (offline) return { mode: 'offline' };
    if (!log.length) return null;
    const count = (s) => log.filter((e) => e.source === s).length;
    const served = log.filter((e) => e.source !== 'error');
    return {
      mode: 'live',
      reads: log.length,
      cache: count('cache') + count('run'),
      revalidated: count('revalidated'),
      fetched: count('fetched'),
      stale: count('stale'),
      errors: count('error'),
      oldestAgeSeconds: served.length ? Math.max(...served.map((e) => e.ageSeconds)) : null,
    };
  }

  return { get, begin, summary, dir, ttlSeconds: ttlMs / 1000, fresh, offline };
}

module.exports = { create, ghFetch, classify, resolveTtlSeconds, resolveDir, partitionKey, DEFAULT_TTL_SECONDS, PER_PAGE };
