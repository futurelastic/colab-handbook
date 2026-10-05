'use strict';
/**
 * tools/lib/tracker.js — the tracker contract (#500): what the CLI asks of an issue tracker, named
 * once, so an implementation other than GitHub (and #501's in-memory fake) has a method set to
 * satisfy instead of a scatter of `gh` argv to imitate.
 *
 * The only real implementation today is tools/lib/tracker-github.js; tools/lib/tracker-fake.js is an
 * in-memory one (#501). What every implementation must do is specified as data, in
 * tools/lib/tracker-scenarios.json, and tools/lib/tracker-contract.test.js runs those scenarios
 * against both. Semantics every implementation keeps:
 *   - synchronous — the CLI is spawnSync throughout;
 *   - bound to one repo — `forRepo(repoAbs)` fixes it, so no method takes a repo argument;
 *   - never throws on an environment failure (no tracker binary, no remote, offline): results are
 *     data. Writes return `{ ok, code, stdout, stderr, … }`; list reads add `data`, `null` meaning
 *     "could not read" and never "none"; the read helpers keep their existing null-on-failure
 *     contract.
 *
 * Deliberately NOT in the contract yet (#501 left it so: no scenario needs them, and each would
 * pin a GitHub-only shape into a spec other trackers must satisfy): the CI-run
 * summarisers and REST probes, label create/delete/edit, raw `issue edit` flags and raw `api`
 * access. They still reach `gh` only through the adapter's `exec`.
 */

const METHODS = Object.freeze([
  { name: 'state', kind: 'read', returns: '{ ok, reason }' },
  { name: 'currentLogin', kind: 'read', returns: 'login | null' },
  { name: 'issueView', kind: 'read', returns: 'object | null' },
  { name: 'issueListAll', kind: 'read', returns: 'result + data: issue[] | null' },
  { name: 'issueCreate', kind: 'write', returns: 'result + number, url' },
  { name: 'issueComment', kind: 'write', returns: 'result' },
  { name: 'issueClose', kind: 'write', returns: 'result' },
  { name: 'issueRelease', kind: 'write', returns: '{ ok, stderr, code, others, caller, note }' },
  { name: 'claimHolder', kind: 'read', returns: '{ assignees, claimer }' },
  { name: 'labelList', kind: 'read', returns: 'name[] | null' },
  { name: 'prForBranch', kind: 'read', returns: '{ pr } | { error }' },
  { name: 'prCreate', kind: 'write', returns: '{ ok, url, stderr }' },
  { name: 'prClose', kind: 'write', returns: 'result' },
  { name: 'prList', kind: 'read', returns: 'result + data: pr[] | null' },
  { name: 'prEdit', kind: 'write', returns: 'result' },
  { name: 'runList', kind: 'read', returns: 'result + data: run[] | null' },
  { name: 'releaseView', kind: 'read', returns: 'result' },
  { name: 'releaseCreate', kind: 'write', returns: 'result' },
].map(Object.freeze));

/** Throw, naming every contract method `impl` lacks. Returns `impl` when it is complete. */
function assertImplements(impl, label = 'tracker') {
  const missing = METHODS.filter((m) => !impl || typeof impl[m.name] !== 'function').map((m) => m.name);
  if (missing.length) throw new Error(`${label} does not implement the tracker contract: missing ${missing.join(', ')}`);
  return impl;
}

const KINDS = { github: () => require('./tracker-github'), fake: () => require('./tracker-fake') };
const _checked = new Set();

/** The tracker for one repo. `kind` defaults to the one implementation, `github`. */
function forRepo(repoAbs, { kind = 'github' } = {}) {
  const load = KINDS[kind];
  if (!load) throw new Error(`unknown tracker kind "${kind}" (known: ${Object.keys(KINDS).join(', ')})`);
  const impl = load().create(repoAbs);
  if (!_checked.has(kind)) { assertImplements(impl, `tracker "${kind}"`); _checked.add(kind); }
  return impl;
}

module.exports = { METHODS, assertImplements, forRepo };
