'use strict';
/**
 * The CI templates' long jobs carry a `timeout-minutes` (#572): without one, a hung `build` or
 * `migrations` holds a runner for GitHub's 360-minute default — measured on two adopters, one
 * cancelled at 360 min and a self-hosted one at 1544.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Pinned, per template, with the same line scan as ci-template-dedupe.test.js (no YAML dependency):
 *   - `build` (all three) and `migrations` (ci-laravel; ci-node's opt-in block, once uncommented)
 *     declare `timeout-minutes` at job level;
 *   - the value is a whole number in a range a measured suite fits inside — never above the
 *     360 default it exists to undercut, never so low a healthy suite trips it (the slowest
 *     measured adopter's build p99 was 37 min);
 *   - the line carries an `EDIT:` note, so an adopter knows the number is theirs to set.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');

// Top-level jobs as { name: [lines of its body] }. `uncomment` strips the `  # ` fence prefix
// of an opt-in block first, so a commented job is checked exactly as an adopter would enable it.
function jobsOf(text, { uncomment = false } = {}) {
  let lines = text.split(/\r?\n/);
  if (uncomment) lines = lines.map((l) => (/^  # {2}/.test(l) || /^  # [a-z]/.test(l) ? '  ' + l.slice(4) : l));
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.notStrictEqual(at, -1, 'no jobs: block');
  const jobs = {};
  let cur = null;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (m) { cur = m[1]; jobs[cur] = []; continue; }
    if (cur) jobs[cur].push(l);
  }
  return jobs;
}

function timeoutOf(body) {
  const i = body.findIndex((l) => /^    timeout-minutes:/.test(l));
  if (i === -1) return null;
  const m = body[i].match(/^    timeout-minutes:\s*(\d+)\b/);
  // The EDIT note may sit on the line itself or on the comment lines directly under it.
  const note = [body[i]];
  for (let k = i + 1; k < body.length && /^    #/.test(body[k]); k++) note.push(body[k]);
  return { value: m ? Number(m[1]) : NaN, hasEdit: note.some((l) => /EDIT:/.test(l)) };
}

// #724: the build is the reusable light lane's `full` job now; a light template sets its timeout
// through the call's `full-timeout-minutes` input (checked below). Its own jobs keep theirs here.
const CASES = [
  ['templates/ci-node.yml', 'migrations', { uncomment: true }],
  ['templates/ci-python.yml', 'migrations', { uncomment: true }],
  ['templates/ci-laravel.yml', 'migrations', {}],
];

for (const [file, floor] of [['templates/ci-node.yml', 30], ['templates/ci-python.yml', 10], ['templates/ci-laravel.yml', 30]]) {
  test(`${file}: the call sets a measured full-timeout-minutes, with an EDIT note (#572, #724)`, () => {
    const call = jobsOf(read(file)).ci;
    assert.ok(call, `${file} has no ci job`);
    const i = call.findIndex((l) => /^      full-timeout-minutes:/.test(l));
    assert.notStrictEqual(i, -1, `${file}: no full-timeout-minutes in the call's with: — the 60-min default may not fit`);
    const v = Number((call[i].match(/full-timeout-minutes:\s*(\d+)\s*$/) || [])[1]);
    assert.ok(Number.isInteger(v) && v >= floor && v < 360, `${file}: full-timeout-minutes ${v} outside ${floor}..359`);
    const note = [];
    for (let k = i - 1; k >= 0 && /^      #/.test(call[k]); k--) note.push(call[k]);
    assert.ok(note.some((l) => /EDIT:/.test(l)), `${file}: full-timeout-minutes has no EDIT: note above it`);
  });
}

test('the reusable light lane bounds both of its suite jobs by input (#572, #721)', () => {
  const jobs = jobsOf(read('.github/workflows/ci-light.yml'));
  assert.match(jobs.quick.join('\n'), /^    timeout-minutes: \$\{\{ inputs\.quick-timeout-minutes \}\}$/m);
  assert.match(jobs.full.join('\n'), /^    timeout-minutes: \$\{\{ inputs\.full-timeout-minutes \}\}$/m);
});

for (const [file, job, opts] of CASES) {
  test(`${file} ${job}${opts.uncomment ? ' (opt-in block)' : ''} carries a measured timeout-minutes`, () => {
    const jobs = jobsOf(read(file), opts);
    assert.ok(jobs[job], `${file} has no ${job} job`);
    const t = timeoutOf(jobs[job]);
    assert.ok(t, `${file} ${job} has no job-level timeout-minutes — a hang holds the runner for 360 min`);
    assert.ok(Number.isInteger(t.value), `${file} ${job} timeout-minutes is not a whole number`);
    assert.ok(t.value >= 10 && t.value < 360, `${file} ${job} timeout-minutes ${t.value} is outside 10..359`);
    assert.ok(t.hasEdit, `${file} ${job} timeout-minutes has no EDIT: note`);
  });
}

test('the uncomment helper really reaches the opt-in block (guards the test itself)', () => {
  assert.strictEqual(jobsOf(read('templates/ci-node.yml')).migrations, undefined, 'ci-node migrations is no longer opt-in — drop the uncomment case');
  assert.strictEqual(jobsOf(read('templates/ci-python.yml')).migrations, undefined, 'ci-python migrations is no longer opt-in — drop the uncomment case');
});
