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

// --- #474: workflow_dispatch inputs and the workflow's name ---------------------------------

{
  const { workflowDispatchInputs, workflowNameOf } = require('./workflow-triggers.js');
  const fsx = require('fs');
  const px = require('path');
  const root = px.resolve(__dirname, '..', '..');

  test('#474 workflowDispatchInputs: the template declares dry_run; a bare workflow_dispatch declares nothing', () => {
    const tpl = fsx.readFileSync(px.join(root, 'templates', 'release-auto.yml'), 'utf8');
    assert.deepStrictEqual(workflowDispatchInputs(tpl), ['dry_run']);
    assert.deepStrictEqual(workflowDispatchInputs(fsx.readFileSync(px.join(root, '.github', 'workflows', 'release-auto.yml'), 'utf8')), ['dry_run']);
    assert.deepStrictEqual(workflowDispatchInputs('on:\n  push:\n  workflow_dispatch:\njobs: {}\n'), []);
    assert.deepStrictEqual(workflowDispatchInputs('on:\n  push:\njobs: {}\n'), []);
    assert.deepStrictEqual(workflowDispatchInputs('on: [push, workflow_dispatch]\n'), []);
    assert.deepStrictEqual(workflowDispatchInputs(
      'on:\n  workflow_dispatch:\n    # c\n    inputs:\n      a:\n        type: string\n      b_2:\n        default: x\n  schedule:\n    - cron: "1 * * * *"\n'), ['a', 'b_2']);
    assert.deepStrictEqual(workflowDispatchInputs(null), []);
  });

  test('#474 workflowNameOf: the top-level name, unquoted; null when absent', () => {
    assert.strictEqual(workflowNameOf('name: Release (auto)\non: push\n'), 'Release (auto)');
    assert.strictEqual(workflowNameOf('name: "CI"  # trailing\n'), 'CI');
    assert.strictEqual(workflowNameOf('on: push\njobs:\n  a:\n    name: not-me\n'), null);
  });
}
