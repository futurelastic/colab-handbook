'use strict';
/**
 * #495 — one CI-wait primitive, so no agent hand-rolls a `sleep N; gh run …` loop again.
 *
 * Measured over one hour on one fleet: ~88% of ~4,500 REST calls on a shared agent identity were
 * agents waiting for CI in their own shell loops — `sleep 5`–`sleep 20` around `gh run view` /
 * `gh run list` / `colab trunk-ci`, two loops on the same run, one orphaned loop polling for 5½ h
 * with its stderr thrown away, and a loop that read a rate-limit error as "keep waiting". The quota
 * (5,000/h) ran out and every agent's `gh` call failed for the rest of the hour.
 *
 * What this module fixes, by construction:
 *   - backoff, not a fixed interval: 30 s → 60 s → 120 s, then 120 s until a deadline. A 15-minute
 *     run costs ~10 polls instead of ~180 at `sleep 5`;
 *   - conditional requests: every poll after the first sends `If-None-Match`, and a `304 Not
 *     Modified` is not counted against the primary rate limit (GitHub REST docs, "conditional
 *     requests") — capped (#505): after two 304s in a row, and on the deadline's poll, it re-reads
 *     unconditionally, because a validator that never changes would otherwise pin a stale state;
 *   - a rate limit (403 with remaining 0, or 429) ENDS the wait with its own outcome — never a retry;
 *   - an unreadable or unrecognised state ends it too (UNKNOWN), never "keep waiting";
 *   - one wait per run per checkout: a second waiter on the same key is refused (ALREADY_WAITING).
 *
 * The loop is pure over injected `poll` / `sleep` / `now`, so the cost of a 15-minute wait is a
 * unit test, not a guess. The `gh` transport lives in git.js (`ghApiConditional`).
 */

const fs = require('fs');
const path = require('path');

/** Exit codes of `colab ci-wait` — one per outcome, so a caller branches on `$?`, never on text. */
const EXIT = Object.freeze({
  GREEN: 0,
  RED: 1,
  USAGE: 2,
  TIMEOUT: 3,
  RATE_LIMITED: 4,
  UNKNOWN: 5,
  ALREADY_WAITING: 6,
});

const DEFAULT_SCHEDULE_SEC = Object.freeze([30, 60, 120]);
const DEFAULT_DEADLINE_SEC = 45 * 60;

/** Seconds to sleep before poll number `i` (0-based, i ≥ 1); the last step repeats. */
function delayFor(i, schedule = DEFAULT_SCHEDULE_SEC) {
  if (i <= 0) return 0;
  return schedule[Math.min(i - 1, schedule.length - 1)];
}

/**
 * Parse `gh api -i` stdout: status line, headers, blank line, body. gh prints the head to stdout
 * on a non-2xx too (a 304 exits 1 with `gh: HTTP 304` on stderr — measured), so this is read
 * whatever the exit code. Returns `{ status, headers, body }`; status null when no head was found.
 */
function parseHttp(stdout) {
  const text = String(stdout || '');
  const m = /^HTTP\/[\d.]+\s+(\d{3})[^\n]*\n/.exec(text);
  if (!m) return { status: null, headers: {}, body: text };
  const rest = text.slice(m[0].length);
  const split = rest.search(/\r?\n\r?\n/);
  const head = split === -1 ? rest : rest.slice(0, split);
  const body = split === -1 ? '' : rest.slice(split).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: Number(m[1]), headers, body };
}

/**
 * Classify one response: `ok` (2xx, body parsed) · `not-modified` (304) · `rate-limited` (429, or
 * 403 with `x-ratelimit-remaining: 0`, or gh's own "rate limit" text) · `error` (anything else).
 */
function classifyResponse({ status, headers = {}, body, stderr = '' }) {
  const remaining = headers['x-ratelimit-remaining'];
  const resetAt = headers['x-ratelimit-reset'] ? Number(headers['x-ratelimit-reset']) * 1000 : null;
  if (status === 429 || (status === 403 && (remaining === '0' || /rate limit/i.test(String(body) + stderr)))
      || (status === null && /rate limit/i.test(stderr))) {
    return { kind: 'rate-limited', status, resetAt, detail: firstLine(stderr) || `HTTP ${status}` };
  }
  if (status === 304) return { kind: 'not-modified', status, etag: headers.etag || null };
  if (status !== null && status >= 200 && status < 300) {
    let json;
    try { json = JSON.parse(body); } catch (_) { return { kind: 'error', status, detail: 'unparseable body' }; }
    return { kind: 'ok', status, etag: headers.etag || null, json };
  }
  return { kind: 'error', status, detail: firstLine(stderr) || (status ? `HTTP ${status}` : 'no response') };
}

function firstLine(s) { return String(s || '').split('\n').map((x) => x.trim()).find(Boolean) || ''; }

/** A REST workflow-run object → the row shape git.summarizeRunsForCommit reads (`gh run list --json`). */
function restRow(x) {
  return {
    headSha: x.head_sha, status: x.status, conclusion: x.conclusion || null,
    createdAt: x.created_at || null, databaseId: x.id, workflowName: x.name || null,
    event: x.event || null, url: x.html_url || null,
    // #510: the workflow FILE's id — the cure rule's same-workflow test, which a display name cannot answer.
    workflowId: x.workflow_id ?? null,
  };
}

/**
 * The state of what is being waited on, from a summarized run (`{status, conclusion}`):
 * `green` · `red` · `pending` · `unknown`. `none` (no run at the sha yet) is pending: runs appear
 * seconds after a push, and the deadline bounds the wait if they never do.
 */
function runState(s) {
  if (!s) return 'unknown';
  if (s.status === 'none') return 'pending';
  if (s.status === 'completed') return s.conclusion === 'success' ? 'green' : 'red';
  if (['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(s.status)) return 'pending';
  return 'unknown';
}

/**
 * #505: how many 304s in a row may stand for the state before the next poll re-reads without
 * `If-None-Match`. Measured: the runs-list read kept answering 304 for ten minutes while every run
 * at the sha had completed green — the validator never changed, so a loop that trusted it would
 * have reported TIMEOUT on a green sha. A cap of 2 bounds that to one paid call per three polls.
 */
const DEFAULT_MAX_NOT_MODIFIED = 2;

/**
 * The wait loop. `poll(etag)` returns a classifyResponse() result, plus `state` (runState) and
 * `summary` on `ok`. `sleep(ms)` blocks; `now()` is epoch ms. A 304 keeps the previous state — but
 * only for `maxNotModified` polls in a row, and never on the last poll before the deadline: those
 * polls send no ETag (`poll(null)`), so a stale validator costs one paid read, not the wait (#505).
 *
 * Returns `{ outcome, polls, notModified, forced, waitedMs, last, detail }`, outcome one of the
 * EXIT keys; `forced` counts the unconditional re-reads #505 added.
 */
function waitLoop({ poll, sleep, now = Date.now, deadlineSec = DEFAULT_DEADLINE_SEC,
  schedule = DEFAULT_SCHEDULE_SEC, maxNotModified = DEFAULT_MAX_NOT_MODIFIED, onPoll = () => {} }) {
  const start = now();
  let etag = null;
  let last = null;
  let polls = 0;
  let notModified = 0;
  let streak = 0; // consecutive 304s
  let forced = 0;
  for (let i = 0; ; i++) {
    const d = delayFor(i, schedule) * 1000;
    if (d) {
      const left = start + deadlineSec * 1000 - now();
      if (left <= 0) return done('TIMEOUT', `still ${last ? last.state : 'unread'} at the ${fmtDuration(deadlineSec * 1000)} deadline`);
      sleep(Math.min(d, left));
    }
    // The poll that lands on the deadline is the last one: it must read the truth, not a 304.
    const final = now() - start >= deadlineSec * 1000;
    const force = Boolean(etag) && (streak >= maxNotModified || final);
    if (force) forced++;
    const r = poll(force ? null : etag);
    polls++;
    if (r.kind === 'rate-limited') return done('RATE_LIMITED', r.detail + (r.resetAt ? ` — quota resets ${new Date(r.resetAt).toISOString()}` : ''), r);
    if (r.kind === 'error') return done('UNKNOWN', `read failed: ${r.detail}`, r);
    if (r.kind === 'not-modified') {
      notModified++;
      streak++;
      if (!last) return done('UNKNOWN', '304 on the first read — nothing to compare against', r);
    } else {
      streak = 0;
      etag = r.etag || etag;
      last = r;
    }
    onPoll({ poll: polls, state: last.state, notModified: r.kind === 'not-modified', forced: force, elapsedMs: now() - start });
    if (last.state === 'green') return done('GREEN', null);
    if (last.state === 'red') return done('RED', null);
    if (last.state !== 'pending') return done('UNKNOWN', `unrecognised state (${JSON.stringify(last.summary || null)})`);
    if (now() - start >= deadlineSec * 1000) return done('TIMEOUT', `still pending at the ${fmtDuration(deadlineSec * 1000)} deadline`);
  }
  function done(outcome, detail, r) {
    return { outcome, polls, notModified, forced, waitedMs: now() - start, last: last || r || null, detail };
  }
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** Parse `--timeout`: `45m`, `90s`, `1h`, or bare seconds. Null when unparseable. */
function parseDuration(v) {
  const m = /^(\d+)\s*([smh]?)$/.exec(String(v || '').trim());
  if (!m) return null;
  return Number(m[1]) * ({ '': 1, s: 1, m: 60, h: 3600 })[m[2]];
}

/**
 * One wait per key per checkout. The lock is `<dir>/ci-wait-<key>.lock` holding the waiter's pid;
 * a lock whose pid is dead is taken over. Returns `{ ok, holder, release }`.
 */
function acquireLock(dir, key, pid = process.pid, alive = pidAlive) {
  const file = path.join(dir, `ci-wait-${String(key).replace(/[^A-Za-z0-9._-]/g, '_')}.lock`);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* best effort */ }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(pid), { flag: 'wx' });
      return { ok: true, file, release: () => { try { fs.unlinkSync(file); } catch (_) {} } };
    } catch (e) {
      if (e.code !== 'EEXIST') return { ok: true, file: null, release: () => {} }; // cannot lock: do not block the wait
      const holder = Number(String(safeRead(file)).trim());
      if (holder && holder !== pid && alive(holder)) return { ok: false, holder, file, release: () => {} };
      try { fs.unlinkSync(file); } catch (_) {}
    }
  }
  return { ok: true, file: null, release: () => {} };
}

function safeRead(f) { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } }
function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

/** Blocking sleep without a busy loop — the CLI's main() is synchronous. */
function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

module.exports = {
  EXIT, DEFAULT_SCHEDULE_SEC, DEFAULT_DEADLINE_SEC, DEFAULT_MAX_NOT_MODIFIED,
  delayFor, parseHttp, classifyResponse, restRow, runState, waitLoop, fmtDuration, parseDuration,
  acquireLock, sleepSync,
};
