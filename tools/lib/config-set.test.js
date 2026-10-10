'use strict';
/**
 * Unit tests for lib/config-set.js (#561) — `colab config set`'s editor and `colab ship`'s
 * tuning-only class. The CLI wiring is tested end to end in config-set-cli.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('./config-set');

const DESC = '.github/project.yml';
const one = [{ path: DESC, oldMode: '100644', newMode: '100644', binary: false }];
const BASE = [
  '# This repo\'s descriptor.',
  'tier: B',
  'trunk: main',
  'autonomy: none   # a human ships',
  'ship-batch: 1',
  '',
  '# advisory thresholds',
  'thresholds:',
  '  hot-file-count: 3',
  'stack: node',
  '',
].join('\n');

const set = (text, key, value) => {
  const kp = c.parseKeyPath(key);
  assert.ok(!kp.problem, kp.problem);
  const r = c.editText(text, kp, value);
  assert.ok(!r.problem, r.problem);
  return r;
};

test('parseKeyPath: the allowlist, thresholds.<name>, and the authority keys refused with the reason', () => {
  for (const k of ['ship-batch', 'ship-batch-wait', 'ci-wait-factor', 'thresholds.hot-file-count']) {
    assert.ok(!c.parseKeyPath(k).problem, k);
  }
  for (const k of c.AUTHORITY_KEYS) assert.match(c.parseKeyPath(k).problem, /grants authority/, k);
  assert.match(c.parseKeyPath('stack').problem, /not a tuning key/);
  assert.match(c.parseKeyPath('thresholds').problem, /is a map/);
  assert.match(c.parseKeyPath('thresholds.nope').problem, /not a known threshold/);
  assert.match(c.parseKeyPath('ship-batch.x').problem, /is a scalar/);
});

test('editText: replaces a scalar in place, keeping its comment and every other byte', () => {
  const r = set(BASE, 'ship-batch', '2');
  assert.equal(r.old, '1');
  assert.equal(r.text, BASE.replace('ship-batch: 1', 'ship-batch: 2'));
  const withComment = BASE.replace('ship-batch: 1', 'ship-batch: 1  # measured');
  assert.equal(set(withComment, 'ship-batch', '3').text, withComment.replace('ship-batch: 1  #', 'ship-batch: 3  #'));
});

test('editText: appends an absent scalar, and an absent threshold under an existing or a new map', () => {
  const a = set(BASE, 'ship-batch-wait', '6m');
  assert.equal(a.old, null);
  assert.ok(a.text.endsWith('stack: node\nship-batch-wait: 6m\n'));
  const b = set(BASE, 'thresholds.hold-stale-days', '45');
  assert.ok(b.text.includes('thresholds:\n  hot-file-count: 3\n  hold-stale-days: 45\nstack: node'));
  const c2 = set(BASE, 'thresholds.hot-file-count', '5');
  assert.equal(c2.old, '3');
  const noMap = BASE.replace('thresholds:\n  hot-file-count: 3\n', '');
  assert.ok(set(noMap, 'thresholds.hot-file-count', '4').text.endsWith('\nthresholds:\n  hot-file-count: 4\n'));
});

test('editText: refuses a value that is not a plain scalar', () => {
  const kp = c.parseKeyPath('ship-batch');
  for (const v of ['2 # x', 'a: b', '[1]', '', '1\nautonomy: auto-trunk']) {
    assert.match(c.editText(BASE, kp, v).problem, /plain scalar/, JSON.stringify(v));
  }
});

test('#557: ship-batch-steps is a tuning key — a comma list is a plain scalar, validated against ship-batch', () => {
  const base8 = BASE.replace('ship-batch: 1\n', 'ship-batch: 8\n');
  const kp = c.parseKeyPath('ship-batch-steps');
  assert.ok(!kp.problem, kp.problem);
  const ok = c.classify({ entries: one, baseText: base8, headText: set(base8, 'ship-batch-steps', '2,4,8').text });
  assert.equal(ok.tuning, true, ok.reason);
  const over = c.classify({ entries: one, baseText: BASE, headText: set(BASE, 'ship-batch-steps', '2,4').text });
  assert.equal(over.tuning, false, 'a step above ship-batch: 1 is an invalid value, never the class');
});

test('classify: a tuning-only diff is the class (one key, a threshold, an addition, a removal)', () => {
  for (const [key, value] of [['ship-batch', '2'], ['thresholds.hot-file-count', '6'], ['ship-batch-wait', '90s'], ['ci-wait-factor', '1.5']]) {
    const v = c.classify({ entries: one, baseText: BASE, headText: set(BASE, key, value).text });
    assert.equal(v.tuning, true, `${key}: ${v.reason}`);
  }
  const removed = BASE.replace('ship-batch: 1\n', '');
  assert.equal(c.classify({ entries: one, baseText: BASE, headText: removed }).tuning, true);
});

test('classify: a diff touching one tuning key AND one authority key is refused the class', () => {
  const head = set(BASE, 'ship-batch', '2').text.replace('autonomy: none', 'autonomy: auto-trunk');
  const v = c.classify({ entries: one, baseText: BASE, headText: head });
  assert.equal(v.tuning, false);
  assert.match(v.reason, /autonomy/);
  assert.match(v.reason, /grants authority/);
});

test('classify: a malformed value is refused the class (#416 pattern)', () => {
  for (const [from, to] of [['ship-batch: 1', 'ship-batch: 9'], ['ship-batch: 1', 'ship-batch: two'],
    ['hot-file-count: 3', 'hot-file-count: 1'], ['hot-file-count: 3', 'hot-file-coutn: 3']]) {
    const v = c.classify({ entries: one, baseText: BASE, headText: BASE.replace(from, to) });
    assert.equal(v.tuning, false, to);
    assert.match(v.reason, /malformed/, to);
  }
});

test('classify: a second file, a comment, a formatting-only change, a mode change — never tuning', () => {
  const head = set(BASE, 'ship-batch', '2').text;
  assert.equal(c.classify({ entries: [...one, { path: 'README.md', oldMode: '100644', newMode: '100644' }], baseText: BASE, headText: head }).tuning, false);
  assert.match(c.classify({ entries: one, baseText: BASE, headText: BASE.replace('# advisory', '# ADVISORY') }).reason, /top-level comment/);
  assert.match(c.classify({ entries: one, baseText: BASE, headText: BASE.replace('ship-batch: 1', 'ship-batch:  1') }).reason, /no value changed/);
  assert.equal(c.classify({ entries: [{ path: DESC, oldMode: '100644', newMode: '100755' }], baseText: BASE, headText: head }).tuning, false);
  assert.equal(c.classify({ entries: [], baseText: BASE, headText: BASE }).tuning, false);
  assert.equal(c.classify({ entries: one, baseText: null, headText: head }).tuning, false);
});

test('classify: a new top-level key smuggled in a tuning block is caught by its own line', () => {
  const head = BASE.replace('ship-batch: 1\n', 'ship-batch: 2\nci-grant: anyone\n');
  const v = c.classify({ entries: one, baseText: BASE, headText: head });
  assert.equal(v.tuning, false);
  assert.match(v.reason, /ci-grant/);
});

test('branchName never ends in a digit group (ship would read it as an issue number)', () => {
  for (const k of ['ship-batch', 'thresholds.hot-file-count', 'ci-wait-factor']) {
    const b = c.branchName(c.parseKeyPath(k));
    assert.match(b, /^chore\/tune-[a-z-]+$/);
    assert.doesNotMatch(b, /\d$/);
  }
});

test('commitMessage: conventional subject, the evidence in the body', () => {
  const m = c.commitMessage(c.parseKeyPath('ship-batch'), '1', '2', 'batch-stats: 14 lone waits / 30d');
  assert.match(m, /^chore\(project\): ship-batch 1 → 2\n\n/);
  assert.match(m, /Evidence: batch-stats: 14 lone waits/);
});
