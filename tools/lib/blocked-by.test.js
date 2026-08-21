'use strict';
/**
 * Pure-module tests for tools/lib/blocked-by.js (#251). No git, no gh, no network — every case
 * here is a data-shape judgement, which is the whole point of pulling this logic out of
 * tools/colab: the two failure modes the module exists to close (#251's wrong-database-id hazard,
 * and #250's connection-object trap) are both pure data-shape bugs, checkable in three lines each
 * instead of a subprocess fixture.
 *
 * CLI-level wiring (gh I/O, printing, exit codes) is tools/lib/blocked-cli.test.js instead.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  normaliseEdges, edgePresent, foreignEdges,
  argProblem, resolvedBlockerProblem, clearProblem,
  confirmVerdict, ADD_CONFIRMED, ADD_WRONG, ADD_MISSING, ADD_UNCONFIRMED,
  removalReceiptBody, REMOVAL_MARK, REMOVAL_RE,
  edgeKey, repoSlugFromUrl,
} = require('./blocked-by.js');

// --- repoSlugFromUrl --------------------------------------------------------------------------

test('repoSlugFromUrl: strips the REST API prefix', () => {
  assert.strictEqual(repoSlugFromUrl('https://api.github.com/repos/godx-jp/colab-handbook'), 'godx-jp/colab-handbook');
  assert.strictEqual(repoSlugFromUrl(''), null);
  assert.strictEqual(repoSlugFromUrl(null), null);
  assert.strictEqual(repoSlugFromUrl('garbage'), null);
});

// --- normaliseEdges: the #250 connection-object trap, and general shape discipline ------------

test('#250: a connection object with ZERO blockers normalises to zero edges, never 2 (the trap)', () => {
  const raw = { blockedBy: { nodes: [], totalCount: 0 } };
  const { ok, edges } = normaliseEdges(raw);
  assert.strictEqual(ok, true);
  assert.strictEqual(edges.length, 0);
  assert.strictEqual(edgePresent(edges, { number: 1, repo: 'godx-jp/colab-handbook' }), false);
});

test('normaliseEdges: the REST list shape (array of full issue objects)', () => {
  const raw = [
    { id: 5073781995, number: 132, state: 'closed', repository_url: 'https://api.github.com/repos/godx-jp/colab-handbook' },
    { id: 5073783067, number: 138, state: 'open', repository_url: 'https://api.github.com/repos/godx-jp/colab-handbook' },
  ];
  const { ok, edges } = normaliseEdges(raw);
  assert.strictEqual(ok, true);
  assert.strictEqual(edges.length, 2);
  assert.deepStrictEqual(edges[0], { id: 5073781995, number: 132, repo: 'godx-jp/colab-handbook', state: 'closed' });
  assert.strictEqual(edgePresent(edges, { number: 138, repo: 'godx-jp/colab-handbook' }), true);
});

test('normaliseEdges: the GraphQL nodes shape (repository.nameWithOwner, no id)', () => {
  const raw = { blockedBy: { nodes: [{ number: 55, state: 'OPEN', repository: { nameWithOwner: 'godx-jp/colab-handbook' } }], totalCount: 1 } };
  const { ok, edges } = normaliseEdges(raw);
  assert.strictEqual(ok, true);
  assert.strictEqual(edges.length, 1);
  assert.strictEqual(edges[0].id, null);
  assert.strictEqual(edges[0].state, 'open'); // lower-cased for uniform comparison
  assert.strictEqual(edgePresent(edges, { number: 55, repo: 'godx-jp/colab-handbook' }), true);
});

test('normaliseEdges: null/undefined/{} are NOT ok, and never ok-with-empty-edges', () => {
  for (const bad of [null, undefined, {}, 'nope', 42, []]) {
    const { ok, edges } = normaliseEdges(bad);
    if (Array.isArray(bad) && bad.length === 0) {
      // an actual empty REST array IS a legitimate "confirmed zero blockers" read
      assert.strictEqual(ok, true, 'an empty array is a valid empty read');
      assert.deepStrictEqual(edges, []);
      continue;
    }
    assert.strictEqual(ok, false, `expected not-ok for ${JSON.stringify(bad)}`);
    assert.strictEqual(edges, null, `expected edges===null (never []) for ${JSON.stringify(bad)}`);
  }
});

test('normaliseEdges: a malformed item (no number, or unresolvable repo) fails the whole read', () => {
  assert.strictEqual(normaliseEdges([{ id: 1, state: 'open' }]).ok, false); // no number
  assert.strictEqual(normaliseEdges([{ id: 1, number: 5, state: 'open' }]).ok, false); // no repo info at all
  assert.strictEqual(normaliseEdges([null]).ok, false);
});

// --- foreignEdges ------------------------------------------------------------------------------

test('foreignEdges: only edges outside thisRepo, never the caller\'s own repo', () => {
  const edges = [
    { id: 1, number: 5, repo: 'godx-jp/colab-handbook', state: 'open' },
    { id: 2, number: 9, repo: 'some-org/some-repo', state: 'open' },
  ];
  const foreign = foreignEdges(edges, 'godx-jp/colab-handbook');
  assert.strictEqual(foreign.length, 1);
  assert.strictEqual(foreign[0].repo, 'some-org/some-repo');
});

// --- argProblem: zero-gh-call refusals ----------------------------------------------------------

test('argProblem: --by missing', () => {
  assert.match(argProblem({ blocked: 251, blocker: null, clear: false }), /--by <blocker> is required/);
});

test('argProblem: self-edge refused', () => {
  assert.match(argProblem({ blocked: 251, blocker: 251, clear: false }), /cannot block itself/);
});

test('argProblem: --force without --clear refused', () => {
  assert.match(argProblem({ blocked: 251, blocker: 250, clear: false, force: true }), /--force only applies together with --clear/);
});

test('argProblem: --reason without --clear refused', () => {
  assert.match(argProblem({ blocked: 251, blocker: 250, clear: false, reason: 'because' }), /--reason only applies together with --clear/);
});

test('argProblem: --clear without --reason refused (zero-gh-call path — #18)', () => {
  assert.match(argProblem({ blocked: 251, blocker: 250, clear: true, reason: '' }), /--clear requires --reason/);
  assert.match(argProblem({ blocked: 251, blocker: 250, clear: true, reason: '   ' }), /--clear requires --reason/);
  assert.match(argProblem({ blocked: 251, blocker: 250, clear: true }), /--clear requires --reason/);
});

test('argProblem: the happy path (add) and the happy path (clear) both return null', () => {
  assert.strictEqual(argProblem({ blocked: 251, blocker: 250, clear: false }), null);
  assert.strictEqual(argProblem({ blocked: 251, blocker: 250, clear: true, reason: 'edge was never true' }), null);
});

// --- resolvedBlockerProblem: failure mode 1's guard --------------------------------------------

test('resolvedBlockerProblem: unreadable blocker (null/non-object)', () => {
  assert.match(resolvedBlockerProblem(null, 250), /could not read blocker #250/);
  assert.match(resolvedBlockerProblem(undefined, 250), /could not read blocker #250/);
});

test('resolvedBlockerProblem: missing or non-positive-integer id', () => {
  assert.match(resolvedBlockerProblem({ id: null, number: 250 }, 250), /no usable database id/);
  assert.match(resolvedBlockerProblem({ id: 0, number: 250 }, 250), /no usable database id/);
  assert.match(resolvedBlockerProblem({ id: -5, number: 250 }, 250), /no usable database id/);
  assert.match(resolvedBlockerProblem({ id: 1.5, number: 250 }, 250), /no usable database id/);
});

test('resolvedBlockerProblem: resolved number does not match the requested one — the core hazard', () => {
  assert.match(resolvedBlockerProblem({ id: 123, number: 999 }, 250), /resolved issue is #999, not the requested #250/);
});

test('resolvedBlockerProblem: happy path returns null', () => {
  assert.strictEqual(resolvedBlockerProblem({ id: 5212599008, number: 250, state: 'closed' }, 250), null);
});

// --- confirmVerdict: all four verdicts -----------------------------------------------------------

test('confirmVerdict: CONFIRMED — exactly the target edge was added, nothing else', () => {
  const target = { number: 250, repo: 'godx-jp/colab-handbook' };
  const before = [];
  const after = [{ id: 1, number: 250, repo: 'godx-jp/colab-handbook', state: 'closed' }];
  const r = confirmVerdict(before, after, target);
  assert.strictEqual(r.verdict, ADD_CONFIRMED);
  assert.strictEqual(r.intruders.length, 0);
});

test('confirmVerdict: CONFIRMED — a pre-existing edge (X) is never reported as an intruder', () => {
  const target = { number: 250, repo: 'godx-jp/colab-handbook' };
  const X = { id: 99, number: 42, repo: 'godx-jp/colab-handbook', state: 'open' };
  const before = [X];
  const after = [X, { id: 1, number: 250, repo: 'godx-jp/colab-handbook', state: 'closed' }];
  const r = confirmVerdict(before, after, target);
  assert.strictEqual(r.verdict, ADD_CONFIRMED);
  assert.deepStrictEqual(r.intruders, []);
});

test('confirmVerdict: WRONG — the read-back shows a different blocker than the one POSTed', () => {
  const target = { number: 250, repo: 'godx-jp/colab-handbook' };
  const before = [];
  const after = [{ id: 7, number: 34, repo: 'some-other-org/unrelated-repo', state: 'open' }];
  const r = confirmVerdict(before, after, target);
  assert.strictEqual(r.verdict, ADD_WRONG);
  assert.strictEqual(r.intruders.length, 1);
  assert.strictEqual(r.intruders[0].number, 34);
});

test('confirmVerdict: MISSING — POST reported success, but nothing new reads back', () => {
  const target = { number: 250, repo: 'godx-jp/colab-handbook' };
  const before = [];
  const after = [];
  const r = confirmVerdict(before, after, target);
  assert.strictEqual(r.verdict, ADD_MISSING);
});

test('confirmVerdict: UNCONFIRMED — the read-back call itself failed (after === null)', () => {
  const target = { number: 250, repo: 'godx-jp/colab-handbook' };
  const r = confirmVerdict([], null, target);
  assert.strictEqual(r.verdict, ADD_UNCONFIRMED);
});

// --- clearProblem: the closed-blocker guard ------------------------------------------------------

test('clearProblem: refuses a closed blocker without --force', () => {
  assert.match(clearProblem({ closed: true, force: false }), /CLOSED/);
});

test('clearProblem: permits a closed blocker WITH --force', () => {
  assert.strictEqual(clearProblem({ closed: true, force: true }), null);
});

test('clearProblem: an open blocker never needs --force', () => {
  assert.strictEqual(clearProblem({ closed: false, force: false }), null);
});

// --- removalReceiptBody / REMOVAL_MARK -----------------------------------------------------------

test('removalReceiptBody: carries the mark, the blocker number, host, timestamp and reason; REMOVAL_RE parses it back', () => {
  const body = removalReceiptBody(250, 'fixture-host.example', '2026-08-21T10:00:00Z', 'the edge was never true — filed against the wrong blocker');
  assert.match(body, new RegExp(REMOVAL_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, /the edge was never true/);
  const m = body.match(REMOVAL_RE);
  assert.ok(m, 'REMOVAL_RE must parse the body it generates');
  assert.strictEqual(m[1], '250');
  assert.strictEqual(m[2], 'fixture-host.example');
  assert.strictEqual(m[3], '2026-08-21T10:00:00Z');
});

// --- edgeKey (used internally, but exported for a caller building matching keys) ----------------

test('edgeKey: repo#number', () => {
  assert.strictEqual(edgeKey({ repo: 'a/b', number: 5 }), 'a/b#5');
});
