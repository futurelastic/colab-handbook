'use strict';
/**
 * Which workflow runs at a sha VERIFY the code there (#503) — the pure half of the rule `colab
 * ship`'s CI gate, `colab trunk-ci` and `colab ci-wait` read. No gh, no git, no I/O.
 *
 * THE RULE. A run counts toward "is this sha green" when its trigger is a push or a pull request
 * (`push`, `pull_request`, `pull_request_target`, `merge_group`) — the triggers that run a suite
 * against the code. A run of any OTHER trigger is set aside and named: `workflow_run` (the
 * handbook's own `release-auto.yml` fires on CI's completion, cuts a candidate, publishes, deploys
 * to staging — 20–30 min after the verifying run already finished), `schedule` (the same template's
 * daily finalize lands on trunk's head too), `workflow_dispatch`, `release`, `deployment`, … Those
 * runs come AFTER the verdict and act on it; their failure belongs to the release lane, so they
 * must neither turn trunk red for ship nor make ship wait for them.
 *
 * Measured (one adopted fork, 2026-10-05): CI green at 15:18Z, `Release (auto)` then in progress at
 * the same trunk sha, and four green, graded candidates parked behind it — every landing cost one
 * CI cycle plus one release cycle.
 *
 * A row with no `event` field (an older read, a hand-built fixture) is counted: absence of the field
 * never excludes anything, so every verdict computable before #503 without it is computed the same.
 *
 * OVERRIDES (project.yml), matched against the run's workflow `name:` — the only workflow identity
 * every run read carries (`gh run list` has no file path):
 *   ship-gate-workflows: [CI, Lint]     the explicit set: exactly these workflows count, whatever
 *                                       their trigger; every other workflow is set aside.
 *   ship-ignore-workflows: [Deploy]     set these aside too, even when push-triggered (a deploy
 *                                       workflow that fires on a push to trunk). Wins over the gate
 *                                       list for a name in both.
 */

const VERIFYING_EVENTS = Object.freeze(['push', 'pull_request', 'pull_request_target', 'merge_group']);
const GATE_KEY = 'ship-gate-workflows';
const IGNORE_KEY = 'ship-ignore-workflows';

/** One list key: absent → null; a non-empty list of non-empty strings → the names; else invalid. */
function parseNameList(doc, key) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, key);
  if (!has || doc[key] === null || doc[key] === undefined) return { declared: false, valid: true, names: null };
  let v = doc[key];
  if (typeof v === 'string') v = [v];
  if (!Array.isArray(v) || v.length === 0) {
    return { declared: true, valid: false, names: null, reason: `${key} must be a non-empty list of workflow names (the workflow's \`name:\`), got ${JSON.stringify(doc[key])}` };
  }
  const bad = v.filter((x) => typeof x !== 'string' || !x.trim());
  if (bad.length) {
    return { declared: true, valid: false, names: null, reason: `${key} has ${bad.length} entr${bad.length === 1 ? 'y' : 'ies'} that ${bad.length === 1 ? 'is' : 'are'} not a workflow name: ${JSON.stringify(bad)}` };
  }
  return { declared: true, valid: true, names: v.map((x) => x.trim()) };
}

/**
 * The policy from a parsed project.yml doc: `{ gate: string[]|null, ignore: string[], valid,
 * problems: string[] }`. An invalid key is IGNORED by the reader (the default rule applies) and
 * reported by the audit — a malformed override must not silently widen what ship counts as green
 * in either direction, and the default is the measured-safe reading.
 */
function parsePolicy(doc) {
  const g = parseNameList(doc, GATE_KEY);
  const i = parseNameList(doc, IGNORE_KEY);
  const problems = [g, i].filter((x) => !x.valid).map((x) => x.reason);
  return {
    gate: g.valid ? g.names : null,
    ignore: i.valid && i.names ? i.names : [],
    valid: problems.length === 0,
    problems,
  };
}

/** Why one row is set aside, or null when it counts. */
function setAsideReason(row, policy) {
  const p = policy || { gate: null, ignore: [] };
  const name = row && row.workflowName;
  if (name && p.ignore && p.ignore.includes(name)) return `${IGNORE_KEY}`;
  if (p.gate) return name && p.gate.includes(name) ? null : `not in ${GATE_KEY}`;
  const ev = row && row.event;
  if (ev === undefined || ev === null || ev === '') return null;
  return VERIFYING_EVENTS.includes(ev) ? null : `event: ${ev}`;
}

/** Split rows into `{ counted, setAside }`; each set-aside row carries `setAsideWhy`. Null in → null out. */
function splitVerifying(rows, policy) {
  if (!Array.isArray(rows)) return null;
  const counted = [];
  const setAside = [];
  for (const r of rows) {
    const why = setAsideReason(r, policy);
    if (why) setAside.push({ ...r, setAsideWhy: why });
    else counted.push(r);
  }
  return { counted, setAside };
}

/**
 * The verdict-detail suffix naming what was set aside — '' when nothing was. `rows` is the compact
 * summary shape (`{workflowName, status, conclusion, databaseId, why}`).
 */
function setAsideNote(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const names = list.map((x) => `${x.workflowName || 'unnamed'} (${x.conclusion || x.status || '?'}${x.databaseId ? `, run ${x.databaseId}` : ''}${x.why ? `; ${x.why}` : ''})`);
  return ` — set aside ${list.length} run${list.length === 1 ? '' : 's'} that do${list.length === 1 ? 'es' : ''} not verify the code (post-CI release/deploy lane, #503): ${names.join(', ')}`;
}

module.exports = { VERIFYING_EVENTS, GATE_KEY, IGNORE_KEY, parsePolicy, setAsideReason, splitVerifying, setAsideNote };
