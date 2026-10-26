'use strict';
/**
 * Tests for process/port ownership (tools/lib/procs.js).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Only the PURE parts are tested here: lsof's output format and the cwd containment rule. Spawning
 * lsof in CI would test the runner's process table rather than our logic, and would be flaky on a
 * machine where lsof is absent or restricted.
 *
 * The property under test is "does a directory own this process". Getting it wrong in the
 * permissive direction orphans a server onto a deleted checkout (issue #22); getting the ownership
 * TEST wrong — by using the port instead of the cwd — kills an unrelated process that legitimately
 * holds a port the registry is merely confused about.
 */

const test = require('node:test');
const assert = require('node:assert');

const { isInside, parseLsofCwd, isAncestor, ancestorPids } = require('./procs.js');

const WT = '/repo/.claude/worktrees/feat-x';

test('isInside: the directory itself and its descendants, nothing else', () => {
  assert.ok(isInside(WT, WT), 'the directory owns itself');
  assert.ok(isInside(WT, WT + '/server'), 'a descendant is owned');
  assert.ok(!isInside(WT, '/repo'), 'the parent is not owned');
  assert.ok(!isInside(WT, '/repo/.claude/worktrees/feat-x-2'),
    'a SIBLING sharing the name as a prefix is not owned — plain startsWith gets this wrong');
  assert.ok(!isInside(WT, ''), 'empty is not owned');
  assert.ok(!isInside('', WT), 'no directory owns nothing');
});

// lsof -F is a STREAM of prefixed lines, not one record per line: a `p<pid>` applies to every
// following field line until the next `p`. Splitting per line and expecting pid+path together
// yields pids with no paths — i.e. silently finds nothing, which reads exactly like "all clear".
const LSOF = [
  'p101', 'fcwd', 'n/repo/.claude/worktrees/feat-x',
  'p202', 'fcwd', 'n/repo/.claude/worktrees/feat-x/server',
  'p303', 'fcwd', 'n/somewhere/else',
  'p404', 'fcwd', 'n/repo',
].join('\n');

test('parseLsofCwd carries the pid across following field lines', () => {
  assert.deepStrictEqual(parseLsofCwd(LSOF, WT), [
    { pid: '101', cwd: '/repo/.claude/worktrees/feat-x' },
    { pid: '202', cwd: '/repo/.claude/worktrees/feat-x/server' },
  ]);
});

test('parseLsofCwd excludes processes outside the directory, including its parent', () => {
  const pids = parseLsofCwd(LSOF, WT).map((p) => p.pid);
  assert.ok(!pids.includes('303'), 'unrelated cwd must not be claimed as owned');
  assert.ok(!pids.includes('404'), 'the parent repo must not be claimed as owned');
});

test('parseLsofCwd tolerates empty and malformed input rather than throwing', () => {
  assert.deepStrictEqual(parseLsofCwd('', WT), []);
  assert.deepStrictEqual(parseLsofCwd(null, WT), []);
  assert.deepStrictEqual(parseLsofCwd('n/orphan/path\nfcwd', WT), [],
    'a path line with no preceding pid is not a process');
});

// isAncestor (#288) walks real `ps -o ppid=` links, so — same discipline as the rest of this file —
// only the inputs that degrade to `false` WITHOUT spawning anything are exercised here; the walk
// itself is exercised indirectly via `resolveAnchor`'s injected `isAncestor` in place.test.js, which
// never touches a real process tree either.

test('isAncestor: hops=0 refuses to walk at all — false, no spawn', () => {
  assert.strictEqual(isAncestor(process.ppid, process.pid, 0), false);
});

test('isAncestor: an empty/non-numeric candidate is false, never throws', () => {
  assert.strictEqual(isAncestor('', process.pid), false);
  assert.strictEqual(isAncestor(null, process.pid), false);
  assert.strictEqual(isAncestor('not-a-pid', process.pid), false);
});

test('isAncestor: `of` already <= 1 (init/kernel) is false immediately, never throws', () => {
  assert.strictEqual(isAncestor(process.ppid, 1), false);
  assert.strictEqual(isAncestor(process.ppid, 0), false);
});

// ancestorPids (#668) — the set worktree teardown must never stop. The walk is driven through an
// injected `ppidOf`, so none of these touch a real process tree except the last, which only asks
// that this test's own parent is in its own ancestor set.

const chain = (links) => (pid) => (pid in links ? links[pid] : null);

test('ancestorPids: walks ppid links up to (not including) init, as strings', () => {
  const got = ancestorPids(500, 64, chain({ 500: 400, 400: 300, 300: 1 }));
  assert.deepStrictEqual([...got], ['400', '300']);
});

test('ancestorPids: a ppid cycle from bad ps output ends the walk instead of spinning', () => {
  const got = ancestorPids(500, 64, chain({ 500: 400, 400: 300, 300: 400 }));
  assert.deepStrictEqual([...got], ['400', '300']);
});

test('ancestorPids: hops bounds the walk', () => {
  const got = ancestorPids(500, 1, chain({ 500: 400, 400: 300, 300: 200 }));
  assert.deepStrictEqual([...got], ['400']);
});

test('ancestorPids: ps failing, or throwing, ends the walk with what it has — never throws', () => {
  assert.deepStrictEqual([...ancestorPids(500, 64, chain({ 500: 400 }))], ['400']);
  assert.deepStrictEqual([...ancestorPids(500, 64, () => { throw new Error('ps gone'); })], []);
  assert.deepStrictEqual([...ancestorPids(1, 64, chain({ 1: 0 }))], []);
});

test('ancestorPids: the real default walk includes this process\'s parent', () => {
  if (process.platform === 'win32') return;
  assert.ok(ancestorPids().has(String(process.ppid)));
});
