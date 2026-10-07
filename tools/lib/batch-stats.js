'use strict';
/**
 * tools/lib/batch-stats.js — how batch landing (#373) actually performs in ONE repo (#554).
 *
 * The batch knobs (`ship-batch: <N>`, `ship-batch-wait: <duration>`) have no handbook default: a repo
 * picks them from its own history. This module is that history, derived from two sources every
 * machine can read — never from the optional machine-local journal, which is off by default and
 * per-machine:
 *
 *   commits  trunk's first-parent log. A batch member's squash carries `Ship-Batch: <ref>
 *            <branch>@<sha>` (ship-batch.js memberTrailer); a member dropped at build is recorded on
 *            the batch head as `Ship-Batch-Dropped: <ref> <branch>@<sha> <class>`. A trunk commit
 *            with neither is a serial landing, known by its `Closes #N`.
 *   runs     the repo's CI runs (REST rows). Runs on `ship-batch/**` are the combined runs; runs on
 *            a feature branch say when that branch went green at its head; runs on trunk say when a
 *            landing was pushed (created) and when its trunk-CI cycle ended (updated).
 *
 * Pure: facts in, a report out — no git, no gh, no clock. `tools/colab`'s `cmdBatchStats` reads.
 *
 * What it measures, per window:
 *   batches     landed and their fill; every combined-run build, first-attempt green, green after
 *               the one re-run, red, still pending
 *   red         red builds and how many of their members then landed serially (the fallback)
 *   dropped     members dropped at build, by class, and the eviction rate among attempted members
 *   serial      serial landings, and MISSED PARTNERS: another candidate that landed later but was
 *               already green when this one landed alone (could have joined), or turned green
 *               within this landing's trunk-CI cycle (a partner wait of `waitSec` would have caught
 *               it — the number `ship-batch-wait` is tuned from)
 *   queueWait   per landed change, green-at-head → landing
 */

const branchName = require('./branch-name');
const shipBatch = require('./ship-batch');

/** `Closes #N` / `Fixes #N` / `Resolves #N` numbers in a commit body (GitHub's own keywords). */
function closesIssues(body) {
  const out = new Set();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
  let m;
  while ((m = re.exec(String(body || '')))) out.add(Number(m[1]));
  return [...out];
}

/** Value at the q-th quantile (nearest-rank) of numbers, or null for none. */
function quantile(values, q) {
  const v = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))];
}

function summary(values) {
  const v = (values || []).filter(Number.isFinite);
  return { samples: v.length, p50Sec: quantile(v, 0.5), p90Sec: quantile(v, 0.9), maxSec: v.length ? Math.max(...v) : null };
}

const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);
const isBatchRef = (b) => String(b || '').startsWith(shipBatch.REF_PREFIX);

/**
 * When did `branch` go green at the head it had at time `atMs`? Its runs created before `atMs` are
 * read; the newest sha among them is the head at that moment. Green only when every run at that sha
 * finished success (cancelled aside, as combinedVerdict reads it) by `atMs` → the latest finish.
 * Null when there is no run, or the head was not green yet — unknown, never a guess.
 */
function greenAt(runsByBranch, branch, atMs, sha = null) {
  const rows = (runsByBranch.get(branch) || []).filter((r) => r.createdMs <= atMs);
  if (!rows.length) return null;
  const headSha = sha
    ? (rows.some((r) => r.sha.startsWith(sha) || sha.startsWith(r.sha)) ? rows.find((r) => r.sha.startsWith(sha) || sha.startsWith(r.sha)).sha : null)
    : rows.reduce((a, b) => (b.createdMs > a.createdMs ? b : a)).sha;
  if (!headSha) return null;
  const at = rows.filter((r) => r.sha === headSha);
  const v = shipBatch.combinedVerdict(at.map((r) => ({ status: r.status, conclusion: r.conclusion, attempt: r.attempt })));
  if (v.state !== 'green') return null;
  const done = Math.max(...at.filter((r) => r.conclusion === 'success').map((r) => r.updatedMs));
  return done <= atMs ? done : null;
}

/** Which feature branch carried a serial landing that closed `issues`, as of `atMs`? Newest run wins. */
function branchForIssues(runsByBranch, issues, atMs) {
  if (!issues.length) return null;
  let best = null;
  for (const [b, rows] of runsByBranch) {
    const nums = branchName.branchIssueNumbers(b);
    if (!nums.some((n) => issues.includes(n))) continue;
    const before = rows.filter((r) => r.createdMs <= atMs);
    if (!before.length) continue;
    const t = Math.max(...before.map((r) => r.createdMs));
    if (!best || t > best.t) best = { branch: b, t };
  }
  return best ? best.branch : null;
}

/**
 * The report. Inputs:
 *   commits  [{ sha, dateMs, body }] — trunk first-parent, inside the window, any order
 *   runs     [{ id, branch, sha, event, status, conclusion, attempt, createdMs, updatedMs, message? }]
 *            `message` is the head commit's message, needed only for ship-batch/** rows
 *   builds   optional { [sha]: [message, …] } — every commit message of an UNLANDED build, when the
 *            caller could read them (compare API); a landed build is read from trunk instead
 *   trunk    trunk branch name
 *   config   { n, waitSec } — the repo's declared knobs, echoed so the report says what it tunes
 */
function derive({ commits = [], runs = [], builds = {}, trunk = 'main', config = {} } = {}) {
  const notes = [];
  const runsByBranch = new Map();
  const trunkRuns = new Map(); // sha → rows
  const batchRuns = new Map(); // `${ref} ${sha}` → rows
  for (const r of runs || []) {
    if (!r || !r.branch || !r.sha) continue;
    if (r.branch === trunk) { (trunkRuns.get(r.sha) || trunkRuns.set(r.sha, []).get(r.sha)).push(r); continue; }
    if (isBatchRef(r.branch)) { const k = `${r.branch} ${r.sha}`; (batchRuns.get(k) || batchRuns.set(k, []).get(k)).push(r); continue; }
    (runsByBranch.get(r.branch) || runsByBranch.set(r.branch, []).get(r.branch)).push(r);
  }
  // When a landing reached trunk: its trunk push run was created then. Fallback: the commit date
  // (a fast-forward keeps the build-time date, so it reads early by the combined run's length).
  const landedAt = (sha, fallback) => {
    const rows = trunkRuns.get(sha) || [];
    return rows.length ? Math.min(...rows.map((r) => r.createdMs)) : fallback;
  };
  const cycleEnd = (sha) => {
    const rows = (trunkRuns.get(sha) || []).filter((r) => r.status === 'completed');
    return rows.length ? Math.max(...rows.map((r) => r.updatedMs)) : null;
  };

  // ---- landings, oldest first ----
  const sorted = [...(commits || [])].sort((a, b) => a.dateMs - b.dateMs);
  const batches = new Map(); // ref → { ref, commits: [], members: [], dropped: [] }
  const landings = []; // { kind, sha, atMs, members: [{ branch, sha }], issues }
  for (const c of sorted) {
    const members = shipBatch.parseMemberTrailers([c.body]);
    if (members.length) {
      const ref = members[0].ref;
      const b = batches.get(ref) || batches.set(ref, { ref, commits: [], members: [], dropped: [] }).get(ref);
      b.commits.push(c);
      b.members.push(...members);
      b.dropped.push(...shipBatch.parseDroppedTrailers([c.body]));
    } else {
      landings.push({ kind: 'serial', sha: c.sha, atMs: landedAt(c.sha, c.dateMs), commitMs: c.dateMs, issues: closesIssues(c.body) });
    }
  }
  for (const b of batches.values()) {
    const head = b.commits[b.commits.length - 1];
    b.headSha = head.sha;
    landings.push({ kind: 'batch', ref: b.ref, sha: head.sha, atMs: landedAt(head.sha, head.dateMs), commitMs: head.dateMs, members: b.members });
  }
  landings.sort((a, b) => a.atMs - b.atMs);

  // ---- every landed change, with its green-at-head time ----
  const changes = []; // { landing, branch, sha, issues, greenMs, atMs }
  for (const l of landings) {
    if (l.kind === 'batch') {
      for (const m of l.members) {
        changes.push({ landing: l, branch: m.branch, issues: branchName.branchIssueNumbers(m.branch), greenMs: greenAt(runsByBranch, m.branch, l.atMs, m.sha), atMs: l.atMs });
      }
    } else {
      const br = branchForIssues(runsByBranch, l.issues, l.atMs);
      l.branch = br;
      changes.push({ landing: l, branch: br, issues: l.issues, greenMs: br ? greenAt(runsByBranch, br, l.atMs) : null, atMs: l.atMs });
    }
  }

  // ---- combined-run builds ----
  const landedHeads = new Set([...batches.values()].map((b) => b.headSha));
  const buildRows = [];
  for (const [k, rows] of batchRuns) {
    const [ref, sha] = k.split(' ');
    const v = shipBatch.combinedVerdict(rows.map((r) => ({ status: r.status, conclusion: r.conclusion, attempt: r.attempt, databaseId: r.id })));
    const landed = landedHeads.has(sha);
    const messages = landed ? null : (builds[sha] || rows.map((r) => r.message).filter(Boolean).slice(0, 1));
    buildRows.push({ ref, sha, state: v.state, attempt: v.attempt, landed, createdMs: Math.min(...rows.map((r) => r.createdMs)), messages });
  }
  const finished = buildRows.filter((b) => b.state === 'green' || b.state === 'red');
  const firstGreen = buildRows.filter((b) => b.state === 'green' && b.attempt === 1).length;
  const rerunGreen = buildRows.filter((b) => b.state === 'green' && b.attempt > 1).length;
  const redBuilds = buildRows.filter((b) => b.state === 'red');

  // ---- red builds → did their members then land serially? ----
  const serialChanges = changes.filter((c) => c.landing.kind === 'serial');
  let redMembers = 0, relanded = 0, redMembersUnread = 0;
  for (const b of redBuilds) {
    const members = b.messages && b.messages.length ? shipBatch.parseMemberTrailers(b.messages) : [];
    if (!members.length) { redMembersUnread++; continue; }
    for (const m of members) {
      redMembers++;
      const nums = branchName.branchIssueNumbers(m.branch);
      if (serialChanges.some((c) => c.atMs >= b.createdMs && (c.branch === m.branch || c.issues.some((n) => nums.includes(n))))) relanded++;
    }
  }
  if (redMembersUnread) notes.push(`${redMembersUnread} red build(s) whose members could not be read (the ref is gone and its commits were not readable)`);

  // ---- dropped members: landed batches from trunk, unlanded builds from their messages ----
  const dropped = [];
  const seenDrop = new Set();
  const addDrop = (d, landed) => {
    const k = `${d.ref} ${d.branch}@${d.sha}`;
    if (seenDrop.has(k)) return;
    seenDrop.add(k);
    dropped.push({ ...d, landed });
  };
  for (const b of batches.values()) for (const d of b.dropped) addDrop(d, true);
  for (const b of buildRows) if (!b.landed && b.messages) for (const d of shipBatch.parseDroppedTrailers(b.messages)) addDrop(d, false);
  const builtMembers = [...batches.values()].reduce((n, b) => n + b.members.length, 0)
    + buildRows.filter((b) => !b.landed && b.messages).reduce((n, b) => n + shipBatch.parseMemberTrailers(b.messages).length, 0);
  const byClass = {};
  for (const d of dropped) byClass[d.cls] = (byClass[d.cls] || 0) + 1;

  // ---- missed partners: serial landings that landed alone while a partner was (nearly) ready ----
  const pairs = [];
  let withMissed = 0, withNear = 0, cyclesUnread = 0;
  // A partner is judged by ITS state at this landing's moment, never by the head it finally landed
  // with: a serial ship syncs the other branches, so their final heads all post-date it. The cycle
  // ends when this landing's trunk run finishes — or at the next landing, whichever is first (a
  // re-run moves a run's updated_at hours later, and the next landing moves trunk anyway).
  const landingTimes = landings.map((l) => l.atMs).sort((a, b) => a - b);
  for (const c of serialChanges) {
    const next = landingTimes.find((t) => t > c.atMs);
    let end = cycleEnd(c.landing.sha);
    if (end === null) cyclesUnread++;
    else if (next !== undefined) end = Math.min(end, next);
    let missed = false, near = false;
    const label = c.branch || c.landing.sha.slice(0, 7);
    for (const o of changes) {
      if (o === c || o.landing === c.landing || o.atMs <= c.atMs || !o.branch || o.branch === c.branch) continue;
      const gNow = greenAt(runsByBranch, o.branch, c.atMs);
      if (gNow !== null) {
        missed = true;
        pairs.push({ kind: 'missed', landed: label, partner: o.branch });
        continue;
      }
      if (end === null) continue;
      const gEnd = greenAt(runsByBranch, o.branch, end);
      if (gEnd !== null && gEnd > c.atMs) {
        near = true;
        const from = c.greenMs !== null ? c.greenMs : c.atMs;
        pairs.push({ kind: 'near', landed: label, partner: o.branch, waitSec: Math.round((gEnd - from) / 1000) });
      }
    }
    if (missed) withMissed++;
    else if (near) withNear++;
  }
  if (cyclesUnread) notes.push(`${cyclesUnread} serial landing(s) with no finished trunk run in the window — near misses not judged for them`);
  const unknownGreen = changes.filter((c) => c.greenMs === null).length;
  if (unknownGreen) notes.push(`${unknownGreen} landed change(s) with no readable green-at-head run — left out of queue wait and partner matching`);

  const fill = {};
  for (const b of batches.values()) fill[b.members.length] = (fill[b.members.length] || 0) + 1;
  const queueWait = summary(changes.filter((c) => c.greenMs !== null).map((c) => Math.round((c.atMs - c.greenMs) / 1000)));

  return {
    trunk,
    config: { n: config.n || 1, waitSec: config.waitSec || 0 },
    history: batches.size > 0 || buildRows.length > 0,
    landings: { total: landings.length, batch: batches.size, serial: landings.length - batches.size },
    batches: {
      landed: batches.size, fill,
      builds: buildRows.length, firstAttemptGreen: firstGreen, greenAfterRerun: rerunGreen, red: redBuilds.length,
      pending: buildRows.length - finished.length,
      firstAttemptGreenRate: rate(firstGreen, finished.length),
    },
    red: { builds: redBuilds.length, members: redMembers, relandedSerially: relanded },
    dropped: { count: dropped.length, attempted: builtMembers + dropped.length, rate: rate(dropped.length, builtMembers + dropped.length), byClass, members: dropped },
    serial: {
      landings: serialChanges.length, withMissedPartner: withMissed, withNearMiss: withNear,
      nearMissWait: summary(pairs.filter((p) => p.kind === 'near').map((p) => p.waitSec)),
      pairs,
    },
    queueWait,
    notes,
  };
}

module.exports = { derive, closesIssues, quantile, greenAt, branchForIssues };
