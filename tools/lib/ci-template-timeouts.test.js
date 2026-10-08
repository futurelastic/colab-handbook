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

const CASES = [
  ['templates/ci-node.yml', 'build', {}],
  ['templates/ci-node.yml', 'migrations', { uncomment: true }],
  ['templates/ci-python.yml', 'build', {}],
  ['templates/ci-laravel.yml', 'build', {}],
  ['templates/ci-laravel.yml', 'migrations', {}],
];

for (const [file, job, opts] of CASES) {
  test(`${file} ${job}${opts.uncomment ? ' (opt-in block)' : ''} carries a measured timeout-minutes`, () => {
    const jobs = jobsOf(read(file), opts);
    assert.ok(jobs[job], `${file} has no ${job} job`);
    const t = timeoutOf(jobs[job]);
    assert.ok(t, `${file} ${job} has no job-level timeout-minutes — a hang holds the runner for 360 min`);
    assert.ok(Number.isInteger(t.value), `${file} ${job} timeout-minutes is not a whole number`);
    assert.ok(t.value >= 10 && t.value < 360, `${file} ${job} timeout-minutes ${t.value} is outside 10..359`);
    if (job === 'build') assert.ok(t.value >= 30, `${file} build timeout ${t.value} sits under the measured slowest-adopter p99 (37 min, node) margin`);
    assert.ok(t.hasEdit, `${file} ${job} timeout-minutes has no EDIT: note`);
  });
}

test('the uncomment helper really reaches the opt-in block (guards the test itself)', () => {
  assert.strictEqual(jobsOf(read('templates/ci-node.yml')).migrations, undefined, 'ci-node migrations is no longer opt-in — drop the uncomment case');
});
