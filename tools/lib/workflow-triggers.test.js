'use strict';
/**
 * workflowFiresOnBranchPush / workflowsFiringOnBranchPush (#373) — the static read that decides
 * whether a `ship-batch/**` combined run can ever arrive, and which workflows would grade it.
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const wt = require('./workflow-triggers');

const PROBE = 'ship-batch/0000000';
const fires = (yml, branch) => wt.workflowFiresOnBranchPush(wt.parseWorkflowOn(yml), branch);

test('branches: decides by inclusion', () => {
  const yml = "on:\n  push:\n    branches: [main, 'ship-batch/**']\n  pull_request:\n";
  assert.strictEqual(fires(yml, PROBE), true);
  assert.strictEqual(fires(yml, 'main'), true);
  assert.strictEqual(fires(yml, 'feat/x-1'), false);
  assert.strictEqual(fires("on:\n  push:\n    branches: [main]\n", PROBE), false);
});

test('branches-ignore: fires on everything it does not match', () => {
  assert.strictEqual(fires("on:\n  push:\n    branches-ignore: ['ship-batch/**']\n", PROBE), false);
  assert.strictEqual(fires("on:\n  push:\n    branches-ignore: [gh-pages]\n", PROBE), true);
});

test('a bare push fires on every branch; a tags-only push on none', () => {
  assert.strictEqual(fires('on: push\n', PROBE), true);
  assert.strictEqual(fires('on: [push, pull_request]\n', PROBE), true);
  assert.strictEqual(fires("on:\n  push:\n    tags: ['v*']\n", PROBE), false);
  assert.strictEqual(fires('on: pull_request\n', PROBE), false);
  assert.strictEqual(fires('', PROBE), false);
});

test('workflowsFiringOnBranchPush lists the files that fire', () => {
  const files = {
    '.github/workflows/ci.yml': "on:\n  push:\n    branches: [main, 'ship-batch/**']\n",
    '.github/workflows/deploy.yml': "on:\n  push:\n    branches: [main]\n",
    '.github/workflows/release.yml': "on:\n  push:\n    tags: ['v*']\n",
  };
  const readFile = (p) => files[p] || null;
  const workflows = ['ci.yml', 'deploy.yml', 'release.yml', 'missing.yml'];
  assert.deepStrictEqual(wt.workflowsFiringOnBranchPush({ readFile, workflows, branch: PROBE }), ['ci.yml']);
  assert.deepStrictEqual(wt.workflowsFiringOnBranchPush({ readFile, workflows, branch: 'main' }), ['ci.yml', 'deploy.yml']);
});
