'use strict';
/**
 * Every tag-triggered DEPLOY template excludes pre-release tags (#513).
 *
 * GitHub's tag glob `*` matches `-`, so `v*.*.*` also matches `v1.2.3-rc.1`. The release workflow
 * cuts candidate tags automatically (#330), so a deploy template that trusts the bare positive
 * pattern deploys every candidate to production in whatever repo adopts it unedited. The final tag
 * is the deploy; a candidate never is.
 *
 * This file is deliberately separate from the CI-template trigger tests: it enumerates
 * `templates/` itself, so a deploy template added later is covered without anyone editing a list.
 *
 * Run: `node --test tools/lib/deploy-template-prerelease.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { parseWorkflowOn, workflowFiresOnTag, prereleaseTagTriggers, isDeployWorkflow, PRERELEASE_TAG_PROBE } = require('./workflow-triggers.js');

const TEMPLATES = path.resolve(__dirname, '..', '..', 'templates');
const read = (f) => fs.readFileSync(path.join(TEMPLATES, f), 'utf8');
const workflows = fs.readdirSync(TEMPLATES).filter((f) => /\.ya?ml$/.test(f));

// The one template that fires on a pre-release tag ON PURPOSE: it records a GitHub pre-release and
// deploys nothing (its header says so). Adding a name here is a decision, never a convenience.
const RECORDS_PRERELEASES = new Set(['release-tag.yml']);

const tagTriggered = workflows.filter((f) => {
  const on = parseWorkflowOn(read(f));
  return on.pushTags !== null || on.pushTagsIgnore !== null;
});
const deployTemplates = workflows.filter((f) => isDeployWorkflow(f));

test('discovery: the deploy templates this test must cover are actually found', () => {
  assert.ok(deployTemplates.includes('deploy-xserver.yml'), deployTemplates.join(', '));
  assert.ok(deployTemplates.includes('deploy-container.yml'), deployTemplates.join(', '));
});

test('every deploy-* template triggers on version tags, and never on a pre-release tag', () => {
  for (const f of deployTemplates) {
    const on = parseWorkflowOn(read(f));
    assert.ok(on.pushTags !== null || on.pushTagsIgnore !== null, `${f}: no push.tags filter at all`);
    assert.ok(workflowFiresOnTag(on, 'v1.2.3'), `${f}: a final tag must still deploy`);
    assert.ok(!workflowFiresOnTag(on, PRERELEASE_TAG_PROBE), `${f}: fires on ${PRERELEASE_TAG_PROBE} — add "!v*.*.*-*" right after the positive pattern`);
    for (const tag of ['v1.2.3-beta.2', 'v10.0.0-rc.12']) assert.ok(!workflowFiresOnTag(on, tag), `${f}: fires on ${tag}`);
  }
});

test('every tag-triggered template is either a deploy that excludes pre-releases or the declared release recorder', () => {
  for (const f of tagTriggered) {
    if (RECORDS_PRERELEASES.has(f)) continue;
    const on = parseWorkflowOn(read(f));
    assert.ok(!workflowFiresOnTag(on, PRERELEASE_TAG_PROBE), `${f}: tag-triggered, not on the RECORDS_PRERELEASES list, and fires on a pre-release tag`);
  }
});

test('the negative pattern comes right after the positive one it excludes (GitHub applies patterns in order)', () => {
  for (const f of deployTemplates) {
    const { pushTags } = parseWorkflowOn(read(f));
    if (!pushTags || !pushTags.some((p) => p.startsWith('!'))) continue; // a strict pattern with no "-" is the other valid shape
    const pos = pushTags.indexOf('v*.*.*');
    const neg = pushTags.indexOf('!v*.*.*-*');
    assert.ok(pos >= 0 && neg === pos + 1, `${f}: expected "v*.*.*" immediately followed by "!v*.*.*-*", got ${JSON.stringify(pushTags)}`);
  }
});

test('the audit reads every deploy template as clean under deploy: tag', () => {
  const files = Object.fromEntries(deployTemplates.map((f) => [f, read(f)]));
  const found = prereleaseTagTriggers({ readFile: (p) => files[path.basename(p)], workflows: deployTemplates, deploy: 'tag' });
  assert.deepEqual(found.map((x) => x.text), []);
});

test('the check has teeth: the xserver template without its exclusion is caught by the same assertion', () => {
  const stripped = read('deploy-xserver.yml').replace(/^\s*- "!v\*\.\*\.\*-\*"\s*$/m, '');
  assert.notEqual(stripped, read('deploy-xserver.yml'), 'the exclusion line was not found to strip');
  assert.ok(workflowFiresOnTag(parseWorkflowOn(stripped), PRERELEASE_TAG_PROBE));
  // And a negative pattern placed BEFORE the positive one excludes nothing — GitHub applies them in order.
  const misordered = 'on:\n  push:\n    tags:\n      - "!v*.*.*-*"\n      - "v*.*.*"\n';
  assert.ok(workflowFiresOnTag(parseWorkflowOn(misordered), PRERELEASE_TAG_PROBE));
});
