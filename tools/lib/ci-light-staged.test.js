'use strict';
/**
 * The staged start of the reusable light lane (#734): on a ref the caller's `concurrency` can cancel
 * (every non-trunk ref), the full command starts only after `quick` passed, so a run superseded during
 * `quick` never took a full slot. A trunk run is never delayed: its full job sits beside `quick`.
 *
 * `needs:` cannot be conditional, so the heavy job is two twins of ONE display name — `full` (trunk)
 * and `full-staged` (elsewhere). These tests pin what that wiring MEANS, line-scan style like
 * ci-template-dedupe.test.js (no YAML dependency):
 *
 *   - `full-staged` needs `quick`, starts only on its success and never on a trunk ref, and keeps
 *     `!cancelled()` — a cancel during `quick` therefore never starts it;
 *   - `full` does NOT need `quick` and runs only on a trunk ref — trunk unchanged;
 *   - the two twins carry one name and, below `if:`, one body (edit one, edit both);
 *   - the workflow outputs read either twin;
 *   - the self-test workflow carries the live proof (`staging-proof`) that reads its own run's jobs.
 *
 * The dedupe gate's "skipped twin" rule is tested with the guard's other #511 cases, in
 * ci-template-tree-green.test.js.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const LIGHT = read('.github/workflows/ci-light.yml');
const SELFTEST = read('.github/workflows/ci-light-selftest.yml');
const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;

// Top-level jobs as { id: [lines of its body] }, comment lines at job-key indent dropped.
function jobsOf(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.notStrictEqual(at, -1, 'no jobs: block');
  const jobs = {};
  let cur = null;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (m) { cur = m[1]; jobs[cur] = []; continue; }
    if (cur && !/^  #/.test(l)) jobs[cur].push(l);
  }
  // A trailing blank line belongs to the gap between jobs, not to the job.
  for (const k of Object.keys(jobs)) while (jobs[k].length && jobs[k][jobs[k].length - 1].trim() === '') jobs[k].pop();
  return jobs;
}
const key = (body, k) => {
  const l = body.find((x) => new RegExp(`^    ${k}:`).test(x));
  return l ? l.replace(new RegExp(`^    ${k}:\\s*`), '').trim() : null;
};
const TRUNK_REF = 'contains(fromJSON(inputs.trunk-branches), github.ref_name)';

const jobs = jobsOf(LIGHT);

test('full-staged waits for quick, starts only on its success, never on trunk, never after a cancel (#734)', () => {
  const s = jobs['full-staged'];
  assert.ok(s, 'no full-staged job');
  assert.strictEqual(key(s, 'needs'), '[dedupe, quick]');
  const cond = key(s, 'if');
  assert.match(cond, /!cancelled\(\)/, 'a cancelled run must not start the staged full job');
  assert.match(cond, /needs\.quick\.result == 'success'/, 'starts only once quick passed');
  assert.match(cond, /needs\.dedupe\.outputs\.tested != 'true'/, 'still skips with the suite');
  assert.ok(cond.includes(`!${TRUNK_REF}`), 'never on a trunk ref');
  assert.doesNotMatch(cond, /always\(\)/, 'always() would run it after a cancel');
});

test('full (the trunk twin) does not wait for quick and runs only on a trunk ref — trunk unchanged (#734)', () => {
  const f = jobs.full;
  assert.ok(f, 'no full job');
  assert.strictEqual(key(f, 'needs'), 'dedupe', 'a trunk run must never wait for quick');
  const cond = key(f, 'if');
  assert.match(cond, /!cancelled\(\)/);
  assert.match(cond, /needs\.dedupe\.outputs\.tested != 'true'/);
  assert.ok(cond.includes(TRUNK_REF) && !cond.includes(`!${TRUNK_REF}`), 'only on a trunk ref');
});

test('the twins are complementary: exactly one of them can run for any ref (#734)', () => {
  // Same predicate, opposite polarity — and nothing else that could exclude both on a green quick.
  const f = key(jobs.full, 'if'); const s = key(jobs['full-staged'], 'if');
  assert.strictEqual((f.match(/contains\(fromJSON\(inputs\.trunk-branches\), github\.ref_name\)/g) || []).length, 1);
  assert.strictEqual((s.match(/contains\(fromJSON\(inputs\.trunk-branches\), github\.ref_name\)/g) || []).length, 1);
});

test('the twins carry one display name and, below if:, one body (#734)', () => {
  const f = jobs.full; const s = jobs['full-staged'];
  assert.strictEqual(key(f, 'name'), 'Full (test, build)');
  assert.strictEqual(key(s, 'name'), key(f, 'name'), 'one name: a required check by name is met by the twin that ran');
  const below = (b) => b.slice(b.findIndex((l) => /^    if:/.test(l)) + 1);
  assert.deepStrictEqual(below(s), below(f), 'the twins drifted apart — edit one, edit both');
  assert.ok(below(f).length > 20, 'body suspiciously short — did the line scan break?');
});

test('the workflow outputs read either twin (#734)', () => {
  for (const k of ['node', 'python', 'php']) {
    assert.ok(LIGHT.includes(`value: \${{ jobs.full.outputs.${k}-version || jobs.full-staged.outputs.${k}-version }}`), `${k}-version`);
  }
});

test('every job that reads jobs.full by id also reads full-staged (#734)', () => {
  // A caller-visible reference to one twin alone would be empty on half the refs.
  const refs = LIGHT.match(/jobs\.full\.outputs\.[a-z-]+/g) || [];
  for (const r of refs) assert.ok(LIGHT.includes(r.replace('jobs.full.', 'jobs.full-staged.')), r);
  assert.doesNotMatch(LIGHT, /needs\.full\./, 'no job may depend on one twin by id');
});

// The live proof in the self-test (#734): a job reading its own run's jobs. Its jq is run here against
// fixtures, so the proof cannot pass vacuously.
const proof = jobsOf(SELFTEST)['staging-proof'];

test('the self-test carries the staged-start proof, behind the call and read-only (#734)', () => {
  assert.ok(proof, 'ci-light-selftest.yml has no staging-proof job');
  assert.strictEqual(key(proof, 'needs'), 'ci');
  assert.match(key(proof, 'if'), /!cancelled\(\)/);
  assert.match(key(proof, 'if'), /needs\.ci\.outputs\.tested != 'true'/, 'nothing to prove when the suite was skipped');
  assert.match(proof.join('\n'), /actions: read/);
  assert.doesNotMatch(proof.join('\n'), /actions: write/);
});

function proofScript() {
  const at = proof.findIndex((l) => /^\s+run:\s*\|\s*$/.test(l));
  assert.notStrictEqual(at, -1, 'staging-proof has no run: | block');
  const ind = proof[at].match(/^(\s*)/)[1].length + 2;
  const out = [];
  for (let i = at + 1; i < proof.length; i++) {
    const l = proof[i];
    if (l.trim() !== '' && l.match(/^(\s*)/)[1].length < ind) break;
    out.push(l.slice(ind));
  }
  return out.join('\n');
}

test('the proof passes a staged branch run and a trunk run, and fails every broken shape (#734)', { skip: !HAVE_JQ && 'jq not installed' }, () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-proof-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  // Fake gh: `gh api <url>` prints $FIX; nothing else is called.
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\ncat "$FIX"\n', { mode: 0o755 });
  const Q = 'ci / Quick (lint, types, unit)'; const F = 'ci / Full (test, build)';
  const job = (name, conclusion, started_at, completed_at) => ({ name, conclusion, started_at, completed_at });
  const run = (ref, list) => {
    const fix = path.join(dir, `fx-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(fix, JSON.stringify({ total_count: list.length, jobs: list }));
    return spawnSync('/bin/bash', ['-eo', 'pipefail', '-c', proofScript()], {
      env: { PATH: `${bin}:${process.env.PATH}`, FIX: fix, GH_TOKEN: 'x', REPO: 'o/r', RUN_ID: '42', REF_NAME: ref, TRUNK: 'main' },
      encoding: 'utf8',
    });
  };
  try {
    const quick = job(Q, 'success', '2026-11-13T10:00:00Z', '2026-11-13T10:01:00Z');
    // Branch: the staged twin started after quick completed, the trunk twin skipped → pass.
    let r = run('feat/x-1', [quick, job(F, 'skipped', null, null), job(F, 'success', '2026-11-13T10:01:05Z', '2026-11-13T10:03:00Z')]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    // Branch: full started BEFORE quick completed → the stage is broken → fail.
    r = run('feat/x-1', [quick, job(F, 'skipped', null, null), job(F, 'success', '2026-11-13T10:00:10Z', '2026-11-13T10:03:00Z')]);
    assert.notStrictEqual(r.status, 0, 'a full job beside quick on a branch must fail the proof');
    assert.match(r.stdout + r.stderr, /before quick completed/);
    // Branch: both twins ran → fail.
    r = run('feat/x-1', [quick, job(F, 'success', '2026-11-13T10:00:01Z', '2026-11-13T10:03:00Z'), job(F, 'success', '2026-11-13T10:01:05Z', '2026-11-13T10:03:00Z')]);
    assert.notStrictEqual(r.status, 0, 'two full jobs ran');
    // Branch: no full ran at all → fail (the proof must not pass vacuously).
    r = run('feat/x-1', [quick, job(F, 'skipped', null, null), job(F, 'skipped', null, null)]);
    assert.notStrictEqual(r.status, 0, 'no full job ran');
    // Trunk: one twin ran, one skipped, no ordering demanded → pass, even when full started first.
    r = run('main', [quick, job(F, 'success', '2026-11-13T10:00:02Z', '2026-11-13T10:03:00Z'), job(F, 'skipped', null, null)]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
