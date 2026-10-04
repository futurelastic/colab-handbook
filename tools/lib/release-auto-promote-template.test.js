'use strict';
/**
 * templates/release-auto.yml's unattended-promotion step (#440) — the template TEXT and its shell.
 *
 * Who may promote is the CLI's decision (`colab promote --auto`, tested end to end in
 * promote-auto-cli.test.js); what is pinned here is the workflow around it: the step runs on the
 * schedule (and a manual dispatch) BEFORE the cut, never on the CI-completion trigger; a promotion
 * dispatches CI on main (a GITHUB_TOKEN push triggers no workflow); a no-op, a refusal, and an older
 * CLI with no verdict all leave the job green; and the CI templates accept that dispatch.
 * Kept apart from release-auto-template.test.js (#425's) so the two can move independently.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEXT = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'release-auto.yml'), 'utf8');
const PROMOTE = 'Promote unattended (colab promote --auto)';
const CUT = 'Cut a candidate (colab release cut --auto)';
const HAS_JQ = spawnSync('jq', ['--version']).status === 0;
// #464: every network step evals the workflow-level retry helper; lift it the same way the steps are.
const RETRY_TRANSIENT = (() => {
  const lines = TEXT.split('\n');
  const at = lines.indexOf('  RETRY_TRANSIENT: |');
  assert.ok(at >= 0, 'env RETRY_TRANSIENT not found');
  const body = [];
  for (let i = at + 1; i < lines.length && (lines[i] === '' || lines[i].startsWith('    ')); i++) body.push(lines[i].slice(4));
  return body.join('\n');
})();

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/** The lines of the step named `name`, up to the next step. */
function stepLines(name) {
  const lines = TEXT.split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `step "${name}" not found`);
  const indent = lines[at].indexOf('-');
  const out = [lines[at]];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && !l.trim().startsWith('#') && l.indexOf(l.trim()) <= indent) break;
    out.push(l);
  }
  return out;
}

/** The dedented `run: |` body of the step named `name`. */
function stepScript(name) {
  const lines = stepLines(name);
  const runAt = lines.findIndex((l) => /^\s*run: \|\s*$/.test(l));
  assert.ok(runAt >= 0, `step "${name}" has no run: | block`);
  const body = lines.slice(runAt + 1);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.indexOf(l.trim())));
  return body.map((l) => l.slice(indent)).join('\n');
}

/** Runs the promote step with a stub colab printing `stdout`, and a stub gh logging its argv. */
function runPromote({ stdout, exit, ghExit = 0 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-auto-promote-'));
  TMP.push(dir);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const stub = path.join(dir, 'colab');
  fs.writeFileSync(stub, `process.stdout.write(${JSON.stringify(stdout)}); process.exitCode = ${exit};\n`);
  const log = path.join(dir, 'gh.log');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash\necho "$*" >> "${log}"\nexit ${ghExit}\n`, { mode: 0o755 });
  const out = path.join(dir, 'output');
  const summary = path.join(dir, 'summary');
  fs.writeFileSync(out, '');
  const r = spawnSync('bash', ['-c', stepScript(PROMOTE)], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, RETRY_TRANSIENT, RETRY_DELAY: '0', PATH: `${bin}:${process.env.PATH}`, COLAB: stub, CI_WORKFLOW: 'CI', RUNNER_TEMP: dir, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary },
  });
  return {
    status: r.status,
    stdout: r.stdout,
    output: fs.readFileSync(out, 'utf8'),
    gh: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '',
  };
}

const verdict = (v) => JSON.stringify({ ok: true, promoted: false, noop: false, reason: null, checks: [], sha: null, ...v });

test('the promote step runs on the schedule and a manual dispatch, before the cut — never on the CI trigger', () => {
  const lines = TEXT.split('\n');
  const p = lines.findIndex((l) => l.trim() === `- name: ${PROMOTE}`);
  const c = lines.findIndex((l) => l.trim() === `- name: ${CUT}`);
  assert.ok(p >= 0 && c > p, 'promote must come before the cut');
  const cond = stepLines(PROMOTE).find((l) => /^\s+if:/.test(l));
  assert.match(cond, /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(cond, /workflow_run/);
  // #474: `--dry` rides in only on a dry run (DRY_RUN=true), through an empty-safe array.
  assert.match(stepScript(PROMOTE), /node "\$COLAB" promote --auto \$\{DRY\[@\]\+"\$\{DRY\[@\]\}"\} --json/);
});

test('the job may dispatch CI: actions: write; the CI workflow to dispatch is an EDIT point', () => {
  assert.match(TEXT, /^\s+actions: write\b/m);
  assert.match(stepLines(PROMOTE).join('\n'), /# EDIT:.*\n\s+CI_WORKFLOW: "CI"/);
});

test('no promotion decision lives in YAML — the descriptor is the CLI\'s to read', () => {
  // Code only: comments and the echoed messages may name the cell, the logic may not.
  const code = stepLines(PROMOTE).filter((l) => !/^\s*#/.test(l) && !/^\s*echo /.test(l)).join('\n');
  assert.doesNotMatch(code, /main-loop|deploy|promotion|COLAB_HUMAN/);
});

test('promoted: CI is dispatched on main and the summary says so', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const r = runPromote({ exit: 0, stdout: verdict({ promoted: true, sha: 'abc1234', checks: [{ condition: 'dev ahead of main', ok: true, detail: '1 commit(s)' }] }) });
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.output, /^promoted=true$/m);
  assert.match(r.gh, /^workflow run CI --ref main$/m);
});

test('promoted but the dispatch failed: a warning naming the fix, the job stays green', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const r = runPromote({ exit: 0, ghExit: 1, stdout: verdict({ promoted: true, sha: 'abc1234' }) });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /::warning::promoted, but could not dispatch CI on main \(does it declare workflow_dispatch:\?\)/);
});

test('a no-op dispatches nothing and stays green', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const r = runPromote({ exit: 0, stdout: verdict({ noop: true, reason: 'promotion=human (default) — this repo has not granted promotion: main-loop' }) });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.gh, '');
  assert.doesNotMatch(r.output, /promoted=true/);
  assert.match(r.stdout, /No promotion: promotion=human/);
});

test('a refusal is a warning, dispatches nothing, and stays green', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const r = runPromote({ exit: 1, stdout: verdict({ ok: false, reason: 'a precondition failed' }) });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.gh, '');
  assert.match(r.stdout, /::warning::colab promote --auto refused: a precondition failed/);
});

test('an older CLI (no verdict) is a warning, never a failed run', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const r = runPromote({ exit: 2, stdout: '' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.gh, '');
  assert.match(r.stdout, /::warning::colab promote --auto gave no verdict/);
});

test('every CI template accepts the dispatch the promotion relies on', () => {
  for (const f of ['ci-node.yml', 'ci-laravel.yml', 'ci-python.yml']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'templates', f), 'utf8');
    const on = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(text);
    assert.ok(on, `${f}: no on: block`);
    assert.match(on[1], /^  workflow_dispatch:\s*$/m, `${f}: no workflow_dispatch trigger`);
  }
});
