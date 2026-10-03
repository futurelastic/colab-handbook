'use strict';
// #436 — run: node --test tools/lib/conflict-markers.test.js
const test = require('node:test');
const assert = require('node:assert');
const cm = require('./conflict-markers');

test('markerLines finds the outer markers at column 0, with or without a label', () => {
  const t = 'a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> fix/x\nb\n<<<<<<<\n>>>>>>>\r\n';
  assert.deepStrictEqual(cm.markerLines(t), [2, 6, 8, 9]);
});

test('markerLines ignores a bare ======= (a setext underline), indented markers and longer runs', () => {
  assert.deepStrictEqual(cm.markerLines('Title\n=======\n'), []);
  assert.deepStrictEqual(cm.markerLines('  <<<<<<< HEAD\n<<<<<<<< eight\n>>>>>>>x\n'), []);
  assert.deepStrictEqual(cm.markerLines(''), []);
  assert.deepStrictEqual(cm.markerLines(null), []);
});

test('stagedMarkerPaths reads stage 0 and skips paths absent from the index', () => {
  const index = { 'doc.md': 'x\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> m\n', 'clean.md': 'ok\n' };
  const calls = [];
  const gitFn = (args, cwd) => {
    calls.push([args, cwd]);
    const p = args[1].replace(/^:0:/, '');
    return p in index ? { ok: true, stdout: index[p] } : { ok: false, stdout: '' };
  };
  const hits = cm.stagedMarkerPaths(gitFn, '/w', ['doc.md', 'clean.md', 'gone.md', 'doc.md']);
  assert.deepStrictEqual(hits, [{ path: 'doc.md', lines: [2, 6] }]);
  assert.deepStrictEqual(calls.map((c) => c[0]), [['show', ':0:doc.md'], ['show', ':0:clean.md'], ['show', ':0:gone.md']]);
  assert.strictEqual(calls[0][1], '/w');
  assert.strictEqual(cm.describe(hits), 'doc.md:2,6');
  assert.strictEqual(cm.describe([{ path: 'a', lines: [1, 2, 3, 4] }]), 'a:1,2,3,…');
});
