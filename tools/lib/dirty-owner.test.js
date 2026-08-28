'use strict';
/**
 * Tests for tools/lib/dirty-owner.js — the "trunk checkout is dirty, whose is it" attribution
 * guess (#294). Pure, so no git/gh fixture is needed: worktree/mtime shapes are handed in
 * directly, exactly as `tools/colab` constructs them after a real `git diff --name-only` /
 * `fs.statSync` read.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const { attributeDirtyPaths, parsePorcelainPaths } = require('./dirty-owner.js');

function wt(overrides) {
  return {
    name: 'some-worktree', branch: 'fix/some-thing-1', session: null, sessionName: null,
    touchedPaths: [], createdAtMs: null,
    ...overrides,
  };
}

// --- parsePorcelainPaths --------------------------------------------------------------------

test('parsePorcelainPaths: ordinary modified/untracked lines', () => {
  const out = parsePorcelainPaths(' M skills/code-wrap/SKILL.md\n?? scratch.txt\n');
  assert.deepStrictEqual(out, ['skills/code-wrap/SKILL.md', 'scratch.txt']);
});

test('parsePorcelainPaths: a rename line reports the DESTINATION path', () => {
  const out = parsePorcelainPaths('R  old-name.md -> new-name.md\n');
  assert.deepStrictEqual(out, ['new-name.md']);
});

test('parsePorcelainPaths: a SHIFTED first line (git.js\'s run() wrapper trims the leading status ' +
  'space off a lone unstaged-modification line) still resolves the real path, not a truncated one', () => {
  // This is exactly what `git.dirtyTracked(repoAbs)` returns for a single ` M f.txt` porcelain
  // line once tools/lib/git.js's `run()` has `.trim()`d the whole blob (#294) — the case that
  // motivated this function to stop assuming a fixed 3-column offset.
  const out = parsePorcelainPaths('M f.txt');
  assert.deepStrictEqual(out, ['f.txt']);
});

test('parsePorcelainPaths: a shifted line mixed with an ordinary, unshifted second line', () => {
  const out = parsePorcelainPaths('M f.txt\n M g.txt');
  assert.deepStrictEqual(out, ['f.txt', 'g.txt']);
});

test('parsePorcelainPaths: empty/null input is an empty list, never throws', () => {
  assert.deepStrictEqual(parsePorcelainPaths(''), []);
  assert.deepStrictEqual(parsePorcelainPaths(null), []);
  assert.deepStrictEqual(parsePorcelainPaths(undefined), []);
});

// --- attributed via branch-overlap ------------------------------------------------------------

test('#294 the observed shape: exactly one live branch touches the path — attributed, branch-overlap', () => {
  const r = attributeDirtyPaths({
    dirtyPaths: ['skills/code-wrap/SKILL.md'],
    worktrees: [
      wt({ name: 'wrap-dirty-attribution-294', branch: 'fix/wrap-dirty-attribution-294',
        sessionName: 'colab-handbook-294', touchedPaths: ['skills/code-wrap/SKILL.md', 'CONVENTIONS.md'] }),
      wt({ name: 'unrelated-1', branch: 'fix/unrelated-1', touchedPaths: ['README.md'] }),
    ],
  });
  assert.strictEqual(r.paths.length, 1);
  const [p] = r.paths;
  assert.strictEqual(p.verdict, 'attributed');
  assert.strictEqual(p.candidates.length, 1);
  assert.strictEqual(p.candidates[0].confidence, 'branch-overlap');
  assert.strictEqual(p.candidates[0].sessionName, 'colab-handbook-294');
});

// --- ambiguous — branch overlap picks out more than one ----------------------------------------

test('two live branches both touch the path — ambiguous, not a guess at either', () => {
  const r = attributeDirtyPaths({
    dirtyPaths: ['CONVENTIONS.md'],
    worktrees: [
      wt({ name: 'a', branch: 'fix/a-1', touchedPaths: ['CONVENTIONS.md'] }),
      wt({ name: 'b', branch: 'fix/b-2', touchedPaths: ['CONVENTIONS.md'] }),
    ],
  });
  assert.strictEqual(r.paths[0].verdict, 'ambiguous');
  assert.strictEqual(r.paths[0].candidates.length, 2);
});

// --- attributed via time-window (weak, only reached when branch overlap found nothing) --------

test('no branch touches the path, but exactly one live session predates its mtime — attributed, time-window', () => {
  const r = attributeDirtyPaths({
    dirtyPaths: [{ path: 'scratch.txt', mtimeMs: 2000 }],
    worktrees: [
      wt({ name: 'old-session', branch: 'fix/old-1', createdAtMs: 1000 }),   // opened before the edit
      wt({ name: 'new-session', branch: 'fix/new-2', createdAtMs: 3000 }),   // opened AFTER the edit
    ],
  });
  assert.strictEqual(r.paths[0].verdict, 'attributed');
  assert.strictEqual(r.paths[0].candidates[0].confidence, 'time-window');
  assert.strictEqual(r.paths[0].candidates[0].worktree, 'old-session');
});

test('several live sessions predate the mtime — ambiguous, not the earliest/latest picked arbitrarily', () => {
  const r = attributeDirtyPaths({
    dirtyPaths: [{ path: 'scratch.txt', mtimeMs: 5000 }],
    worktrees: [
      wt({ name: 'a', branch: 'fix/a-1', createdAtMs: 1000 }),
      wt({ name: 'b', branch: 'fix/b-2', createdAtMs: 2000 }),
    ],
  });
  assert.strictEqual(r.paths[0].verdict, 'ambiguous');
  assert.strictEqual(r.paths[0].candidates.length, 2);
});

// --- unattributed — predates every live session -------------------------------------------------

test('the file predates every live session — unattributed, not a wrong guess', () => {
  const r = attributeDirtyPaths({
    dirtyPaths: [{ path: 'scratch.txt', mtimeMs: 500 }],
    worktrees: [
      wt({ name: 'a', branch: 'fix/a-1', createdAtMs: 1000 }),
      wt({ name: 'b', branch: 'fix/b-2', createdAtMs: 2000 }),
    ],
  });
  assert.strictEqual(r.paths[0].verdict, 'unattributed');
  assert.deepStrictEqual(r.paths[0].candidates, []);
});

// --- unattributed — no live worktrees at all ----------------------------------------------------

test('no live worktrees in the repo at all — unattributed, "someone else" has no candidate', () => {
  const r = attributeDirtyPaths({ dirtyPaths: ['CONVENTIONS.md'], worktrees: [] });
  assert.strictEqual(r.paths[0].verdict, 'unattributed');
  assert.match(r.paths[0].why, /no live worktree/);
});

test('no mtime available and no branch touches the path — unattributed, never a false guess', () => {
  const r = attributeDirtyPaths({
    dirtyPaths: [{ path: 'scratch.txt', mtimeMs: null }],
    worktrees: [wt({ name: 'a', branch: 'fix/a-1', createdAtMs: 1000 })],
  });
  assert.strictEqual(r.paths[0].verdict, 'unattributed');
});

// --- shape / degeneracy -----------------------------------------------------------------------

test('multiple dirty paths preserve input order, each judged independently', () => {
  const r = attributeDirtyPaths({
    dirtyPaths: ['a.md', 'b.md'],
    worktrees: [wt({ name: 'only', branch: 'fix/only-1', touchedPaths: ['a.md'] })],
  });
  assert.strictEqual(r.paths[0].path, 'a.md');
  assert.strictEqual(r.paths[0].verdict, 'attributed');
  assert.strictEqual(r.paths[1].path, 'b.md');
  assert.strictEqual(r.paths[1].verdict, 'unattributed');
});

test('malformed/missing input degrades to an empty result, never throws', () => {
  assert.deepStrictEqual(attributeDirtyPaths({}), { paths: [] });
  assert.deepStrictEqual(attributeDirtyPaths({ dirtyPaths: null, worktrees: null }), { paths: [] });
});

test('a bare path string (no mtime known) is accepted alongside {path, mtimeMs} objects', () => {
  const r = attributeDirtyPaths({
    dirtyPaths: ['a.md', { path: 'b.md', mtimeMs: 42 }],
    worktrees: [wt({ name: 'w', branch: 'fix/w-1', touchedPaths: ['a.md', 'b.md'] })],
  });
  assert.strictEqual(r.paths[0].verdict, 'attributed');
  assert.strictEqual(r.paths[1].verdict, 'attributed');
});
