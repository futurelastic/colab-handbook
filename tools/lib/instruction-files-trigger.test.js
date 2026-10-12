'use strict';
/**
 * The instruction-files caller's trigger (#599).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The measured failure: an adopter narrowed its copy of templates/instruction-files.yml to
 * `push: branches: [main]` (15 of 16 copies in one workspace), so the ratchet never ran on a session
 * branch, first failed on trunk, and the cure branch could neither show the job on its push run (#297)
 * nor dispatch it (#510, the template declared no workflow_dispatch) — a human ci-grant was the only
 * way out. These tests pin the three halves of the fix:
 *
 *   1. the template fires on every branch push (trunk and session branches), on pull_request, and is
 *      dispatchable by exactly the reading `colab ship`'s dispatchableWorkflows uses;
 *   2. instructionFilesCallerFindings (and the audit through it) reports a narrowed or
 *      non-dispatchable caller, and is silent on the template itself and on non-callers;
 *   3. the cure rule, fed the jobs a template caller produces, cures a red instruction-files job with
 *      no grant — on the push run's own evidence, or, where the push skipped it, by dispatch.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  parseWorkflowOn, workflowFiresOnBranchPush, workflowNameOf, SESSION_BRANCH_PROBES,
  isInstructionFilesCaller, instructionFilesCallerFindings,
} = require('./workflow-triggers.js');
const { cureVerdict, cureDispatchPlan, shapeJobEvidence, DRY_RUN_STEP } = require('./ci-cure.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');
const TEMPLATE = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'instruction-files.yml'), 'utf8');

const caller = (on) => `name: instruction-files\n${on}jobs:\n  instruction-files:\n    uses: futurelastic/colab-handbook/.github/workflows/instruction-files.yml@main\n`;
const findings = (text, trunk = 'main') =>
  instructionFilesCallerFindings({ readFile: () => text, workflows: ['instruction-files.yml'], trunk });

// --- 1. the template -----------------------------------------------------------------------------

test('#599 template: push fires on trunk and every session-branch shape; pull_request and workflow_dispatch declared', () => {
  const on = parseWorkflowOn(TEMPLATE);
  assert.ok(on.found);
  for (const ev of ['push', 'pull_request', 'workflow_dispatch']) assert.ok(on.events.has(ev), ev);
  assert.equal(on.pushBranches, null, 'push stays unfiltered');
  assert.equal(on.pushBranchesIgnore, null, 'push stays unfiltered');
  for (const b of ['main', 'dev', ...SESSION_BRANCH_PROBES]) assert.ok(workflowFiresOnBranchPush(on, b), b);
});

test('#599 template: dispatchable by the same reading colab ship uses (name, workflow_dispatch, not dry-run capable)', () => {
  // dispatchableWorkflows (tools/colab) keeps a workflow iff it has a top-level name, declares
  // workflow_dispatch and does not carry the dry-run step — the three facts checked here.
  assert.equal(workflowNameOf(TEMPLATE), 'instruction-files');
  assert.ok(parseWorkflowOn(TEMPLATE).events.has('workflow_dispatch'));
  assert.ok(!TEMPLATE.includes(DRY_RUN_STEP));
});

test('#599 template: recognised as a caller, and reports nothing', () => {
  assert.ok(isInstructionFilesCaller(TEMPLATE));
  assert.deepEqual(findings(TEMPLATE), []);
  assert.deepEqual(findings(TEMPLATE, 'dev'), [], 'any trunk spelling');
});

// --- 2. the finding ------------------------------------------------------------------------------

test('#599 finding: the measured shape — push narrowed to main, no dispatch — is both problems, fix named', () => {
  const [f, ...rest] = findings(caller('on:\n  push:\n    branches: [main]\n  pull_request:\n'));
  assert.equal(rest.length, 0);
  assert.equal(f.dispatchable, false);
  assert.deepEqual(f.narrowed, SESSION_BRANCH_PROBES);
  assert.match(f.text, /does not fire on feat\/probe-1/);
  assert.match(f.text, /no workflow_dispatch/);
  assert.match(f.text, /Fix: use the template trigger/);
  assert.match(f.text, /handbook-sync grafts it/);
});

test('#599 finding: narrowed but dispatchable → only the trigger half', () => {
  const [f] = findings(caller('on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n'));
  assert.equal(f.dispatchable, true);
  assert.doesNotMatch(f.text, /no workflow_dispatch/);
  assert.match(f.text, /does not fire on/);
});

test('#599 finding: unfiltered push but no dispatch → only the dispatch half', () => {
  const [f] = findings(caller('on:\n  push:\n  pull_request:\n'));
  assert.deepEqual(f.narrowed, []);
  assert.match(f.text, /no workflow_dispatch/);
  assert.doesNotMatch(f.text, /does not fire on/);
});

test('#599 finding: a partial branch list (feat/** only) is narrowed too — every session type is probed', () => {
  const [f] = findings(caller("on:\n  push:\n    branches: ['feat/**']\n  workflow_dispatch:\n"));
  assert.ok(f.narrowed.includes('fix/probe-1'));
  assert.ok(!f.narrowed.includes('feat/probe-1'));
  assert.ok(f.narrowed.includes('ada/box-a/feat/probe-1'), 'a machine-prefixed branch is not under feat/**');
});

test('#599 finding: branches-ignore of the trunk is narrowed the other way', () => {
  const [f] = findings(caller('on:\n  push:\n    branches-ignore: [dev]\n  workflow_dispatch:\n'), 'dev');
  assert.deepEqual(f.narrowed, ['dev']);
});

test('#599 finding: no push at all, and the inline `on:` form, are read', () => {
  const [a] = findings(caller('on:\n  pull_request:\n  workflow_dispatch:\n'));
  assert.match(a.text, /has no push trigger/);
  const [b] = findings(caller('on: [push, pull_request]\n'));
  assert.deepEqual(b.narrowed, []);
  assert.equal(b.dispatchable, false);
  assert.deepEqual(findings(caller('on: [push, pull_request, workflow_dispatch]\n')), []);
});

test('#599 caller recognition: by what it runs, not its name; a local ./ path counts; a non-caller does not', () => {
  assert.ok(isInstructionFilesCaller('jobs:\n  x:\n    uses: ./.github/workflows/instruction-files.yml\n'));
  assert.ok(isInstructionFilesCaller('jobs:\n  x:\n    uses: "o/r/.github/workflows/instruction-files.yaml@v1.2.0"  # pinned\n'));
  assert.ok(!isInstructionFilesCaller('jobs:\n  x:\n    uses: o/r/.github/workflows/instruction-files-extra.yml@main\n'));
  assert.ok(!isInstructionFilesCaller('jobs:\n  x:\n    steps:\n      - run: colab instruction-files\n'));
  // The reusable workflow itself is not a caller (workflow_call, no `uses:` of itself).
  const reusable = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'instruction-files.yml'), 'utf8');
  assert.ok(!isInstructionFilesCaller(reusable));
  assert.deepEqual(instructionFilesCallerFindings({ readFile: () => 'name: CI\non:\n  push:\n    branches: [main]\njobs: {}\n',
    workflows: ['ci.yml'], trunk: 'main' }), []);
});

// --- the audit, end to end -----------------------------------------------------------------------

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture(workflow) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-instruction-files-trigger-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: test\n');
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'instruction-files.yml'), workflow);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function warnsOf(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    stdout = err.stdout || '';
  }
  return JSON.parse(stdout).results[0].findings.filter((f) => /\(#599\)/.test(f.text));
}

test('#599 audit: a narrowed, non-dispatchable caller is a WARN naming the fix; the template copy is silent', () => {
  const bad = warnsOf(fixture(caller('on:\n  push:\n    branches: [main]\n  pull_request:\n')));
  assert.equal(bad.length, 1);
  assert.equal(bad[0].level, 'warn');
  assert.match(bad[0].text, /^\.github\/workflows\/instruction-files\.yml calls the reusable instruction-files workflow/);
  assert.deepEqual(warnsOf(fixture(TEMPLATE)), []);
});

// --- 3. the cure ---------------------------------------------------------------------------------
//
// Trunk is red on the caller's job (`instruction-files / instruction-files`, the caller job / called
// job name GitHub reports). With the template trigger the cure branch's own push run carries that job.

const RED_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WF = 'instruction-files';
const WF_ID = 4242;
const JOB = 'instruction-files / instruction-files';
const STEPS = ['Set up job', 'Run actions/checkout', 'Check CLAUDE.md is @AGENTS.md + tool blocks', 'Complete job'];
const T0 = '2026-01-01T00:00:00Z';
const step = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion });

const trunkRed = () => ({ name: JOB, workflowName: WF, workflowId: WF_ID, status: 'completed', conclusion: 'failure',
  startedAt: T0, completedAt: '2026-01-01T00:01:00Z', steps: STEPS.map((n, k) => step(n, k < 2 ? 'success' : k === 2 ? 'failure' : 'skipped')) });
const branchJob = (event, over = {}) => ({ name: JOB, workflowName: WF, workflowId: WF_ID, event, headSha: HEAD_SHA,
  status: 'completed', conclusion: 'success', startedAt: T0, completedAt: '2026-01-01T00:02:00Z', steps: STEPS.map((n) => step(n)), ...over });
// The branch's other CI (its own workflow) is green either way — what differs is whether the caller ran.
const otherCi = () => ({ name: 'test', workflowName: 'CI', workflowId: 1001, event: 'push', headSha: HEAD_SHA, status: 'completed',
  conclusion: 'success', startedAt: T0, completedAt: '2026-01-01T00:03:00Z', steps: [step('Set up job'), step('Test')] });
const verdictFor = (jobs, extra = {}) => cureVerdict({
  containsRedSha: true, evidence: { ok: true, sha: HEAD_SHA }, redSha: RED_SHA, stacking: { ok: true, reason: '' },
  workflowsTouched: false, manifestScriptsTouched: false, manifestPaths: [], pythonManifestTouched: false, pythonManifestPaths: [],
  jobEvidence: shapeJobEvidence({ redRunJobs: [trunkRed()], branchRunJobs: [otherCi(), ...jobs], branchSha: HEAD_SHA }), ...extra,
});

test('#599 cure: the template caller\'s push run carries the job → cures with no grant and no dispatch', () => {
  const v = verdictFor([branchJob('push')]);
  assert.equal(v.ok, true, v.reason);
  assert.deepEqual(v.provenJobs, [JOB]);
});

test('#599 cure: the narrowed caller (job absent from the push run) refuses — the measured dead end', () => {
  const v = verdictFor([]);
  assert.equal(v.ok, false);
  assert.match(v.reason, /does not exist on the branch's run/);
  assert.equal(v.dispatchWanted, undefined, 'not dispatchable: the copy declared no workflow_dispatch');
});

test('#599 cure: absent from the push run but dispatchable → ship asks for the dispatch, and the green dispatch cures', () => {
  const runs = [{ workflowName: WF, workflowId: WF_ID, event: 'push', status: 'completed', conclusion: 'success' }];
  const ev = shapeJobEvidence({ redRunJobs: [trunkRed()], branchRunJobs: [otherCi()], branchSha: HEAD_SHA });
  assert.deepEqual(cureDispatchPlan(ev, { dispatchable: [WF], branchRuns: runs }), { dryRun: [], dispatch: [WF] });
  assert.deepEqual(verdictFor([], { dispatchable: [WF], branchRuns: runs }).dispatchWanted, [WF]);
  const cured = verdictFor([branchJob('workflow_dispatch')]);
  assert.equal(cured.ok, true, cured.reason);
});
