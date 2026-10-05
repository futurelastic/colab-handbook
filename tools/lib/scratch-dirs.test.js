'use strict';
/**
 * #488 — the scratch dirs (plan files, dispatch briefs) default OUTSIDE `.claude/`, are
 * overridable by COLAB_PLANS_DIR / COLAB_BRIEFS_DIR, and readers fall back to the legacy
 * `.claude/plans/` for one transition. Pure; the CLI wiring is covered in
 * ship-plan-journal.test.js and scratch-dirs-cli.test.js.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const sd = require('./scratch-dirs');

const ROOT = '/r/repo';

test('defaults: a fresh session writes nothing under .claude/', () => {
  const env = {};
  assert.strictEqual(sd.planWriteDir(ROOT, env), path.join(ROOT, '.plans'));
  assert.strictEqual(sd.briefsWriteDir(ROOT, env), path.join(ROOT, '.briefs'));
  for (const d of [sd.planWriteDir(ROOT, env), sd.briefsWriteDir(ROOT, env)]) {
    assert.ok(!path.relative(ROOT, d).split(path.sep).includes('.claude'), `${d} must not be under .claude/`);
  }
});

test('readers: configured dir first, then the legacy .claude/plans/ — a plan in either location is found', () => {
  assert.deepStrictEqual(sd.planReadDirs(ROOT, {}), [path.join(ROOT, '.plans'), path.join(ROOT, '.claude', 'plans')]);
  assert.deepStrictEqual(sd.planReadDirs(ROOT, { COLAB_PLANS_DIR: 'work/plans/' }),
    [path.join(ROOT, 'work', 'plans'), path.join(ROOT, '.claude', 'plans')]);
});

test('readers: configured TO the legacy dir reads it once, not twice', () => {
  assert.deepStrictEqual(sd.planReadDirs(ROOT, { COLAB_PLANS_DIR: '.claude/plans' }), [path.join(ROOT, '.claude', 'plans')]);
});

test('override: absolute dirs are honoured as-is and never become an exclude line', () => {
  const env = { COLAB_PLANS_DIR: '/var/scratch/plans', COLAB_BRIEFS_DIR: '../briefs' };
  assert.strictEqual(sd.planWriteDir(ROOT, env), '/var/scratch/plans');
  assert.deepStrictEqual(sd.excludeLines(env), ['/.claude/plans/'], 'neither an absolute nor a climbing-out dir can be repo-excluded');
});

test('override: blank or "/" falls back to the default', () => {
  assert.strictEqual(sd.plansDirSetting({ COLAB_PLANS_DIR: '  ' }), '.plans');
  assert.strictEqual(sd.plansDirSetting({ COLAB_PLANS_DIR: '/' }), '.plans');
});

test('exclude lines: configured plans + briefs + legacy plans, root-anchored, deduplicated', () => {
  assert.deepStrictEqual(sd.excludeLines({}), ['/.plans/', '/.briefs/', '/.claude/plans/']);
  assert.deepStrictEqual(sd.excludeLines({ COLAB_PLANS_DIR: './.claude/plans' }), ['/.claude/plans/', '/.briefs/']);
});

test('isScratchPath / withoutScratch: only paths inside a scratch dir are dropped', () => {
  const env = {};
  assert.ok(sd.isScratchPath('.plans/issue-1.md', env));
  assert.ok(sd.isScratchPath('.briefs/x.md', env));
  assert.ok(sd.isScratchPath('.claude/plans/issue-1.md', env));
  assert.ok(!sd.isScratchPath('.plansfoo/x.md', env), 'prefix must stop at a path boundary');
  assert.ok(!sd.isScratchPath('src/.plans/x.md', env), 'root-anchored: a nested .plans/ is real content');
  assert.ok(!sd.isScratchPath('.claude/settings.json', env));
  assert.strictEqual(sd.withoutScratch('?? .plans/issue-1.md\n?? src/new.js\n?? .briefs/b.md', env), '?? src/new.js');
  assert.strictEqual(sd.withoutScratch('', env), '');
});
