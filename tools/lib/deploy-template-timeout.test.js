'use strict';
/**
 * Every job in every deploy-* template carries `timeout-minutes` (#573).
 *
 * Without it a hung deploy holds its runner for GitHub's default 360 minutes — on a self-hosted
 * runner (deploy-xserver.yml) that is the one box every later deploy queues behind. The value is
 * the adopter's to tune (`# EDIT:`); its presence is not.
 *
 * Enumerates `templates/` itself, like deploy-template-prerelease.test.js, so a deploy template
 * added later is covered without anyone editing a list.
 *
 * Run: `node --test tools/lib/deploy-template-timeout.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { isDeployWorkflow } = require('./workflow-triggers.js');

const TEMPLATES = path.resolve(__dirname, '..', '..', 'templates');
const read = (f) => fs.readFileSync(path.join(TEMPLATES, f), 'utf8');
const deployTemplates = fs.readdirSync(TEMPLATES).filter((f) => /\.ya?ml$/.test(f) && isDeployWorkflow(f));

// Jobs of a workflow as { id, body }: the 2-space keys under a top-level `jobs:`, each body running
// to the next 2-space key or the next top-level key. Comments and blank lines never end a job.
function jobsOf(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (start < 0) return [];
  const jobs = [];
  let cur = null;
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l) && !/^#/.test(l)) break; // next top-level key
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(l);
    if (m) { cur = { id: m[1], body: [] }; jobs.push(cur); continue; }
    if (cur) cur.body.push(l);
  }
  return jobs;
}

// Direct job-level key only (4 spaces), a positive integer — not a step-level one, not a comment.
const hasJobTimeout = (body) => body.some((l) => /^ {4}timeout-minutes:\s*[1-9]\d*\s*(#.*)?$/.test(l));

test('discovery: deploy-xserver.yml is covered and has jobs', () => {
  assert.ok(deployTemplates.includes('deploy-xserver.yml'), deployTemplates.join(', '));
  assert.ok(jobsOf(read('deploy-xserver.yml')).length > 0, 'no jobs parsed from deploy-xserver.yml');
});

test('every job in every deploy-* template sets timeout-minutes (the default is 360)', () => {
  for (const f of deployTemplates) {
    const jobs = jobsOf(read(f));
    assert.ok(jobs.length > 0, `${f}: no jobs parsed`);
    for (const j of jobs) assert.ok(hasJobTimeout(j.body), `${f}: job "${j.id}" has no job-level timeout-minutes`);
  }
});

test('the parser does not accept a missing, step-level, or commented-out timeout', () => {
  const wf = (jobBody) => `on: push\njobs:\n  a:\n    runs-on: x\n${jobBody}    steps:\n      - run: true\n`;
  assert.ok(hasJobTimeout(jobsOf(wf('    timeout-minutes: 30 # EDIT\n'))[0].body));
  assert.ok(!hasJobTimeout(jobsOf(wf(''))[0].body));
  assert.ok(!hasJobTimeout(jobsOf(wf('    # timeout-minutes: 30\n'))[0].body));
  assert.ok(!hasJobTimeout(jobsOf('jobs:\n  a:\n    steps:\n      - run: true\n        timeout-minutes: 5\n')[0].body));
});
