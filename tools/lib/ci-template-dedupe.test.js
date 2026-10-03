'use strict';
/**
 * The CI workflows' `dedupe` guard (#418): a ref's FIRST push (a session claim pushes its
 * branch at trunk's head) must not re-run the full suite on a sha this workflow already
 * passed — and must still end in a run `colab ship` reads as green.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * actionlint checks the schema; these tests pin what the wiring MEANS, for the three templates
 * and this repo's own ci.yml, without a YAML dependency (same line-scan style as
 * ci-template-triggers.test.js):
 *
 *   - `dedupe` fires only on a push that created the ref, needs `actions: read`, checks nothing
 *     out, and is fail-open (no `exit 1`);
 *   - every other top-level job carries `!cancelled()` in its `if:` — a job without it inherits
 *     the implicit success(), which reads EVERY ancestor, so a job that only transitively needs
 *     `dedupe` (Laravel `migrations`) would be skipped on every ordinary push, where `dedupe` is;
 *   - every root job (no other `needs`) needs `dedupe` and skips on `tested == 'true'`, so the
 *     guard-only run ends with one success and the rest skipped → conclusion `success`, never the
 *     all-skipped `skipped` that ship reads as not-green;
 *   - the guard's shell step, run against a fake `gh`, says tested=true only when the API lists a
 *     green run, and tested=false on every failure path.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['templates/ci-node.yml', 'templates/ci-laravel.yml', 'templates/ci-python.yml', '.github/workflows/ci.yml'];
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');

// Top-level jobs as { name: [lines of its body] } (2-space job keys under `jobs:`).
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
  return jobs;
}
const key = (body, k) => {
  const l = body.find((x) => new RegExp(`^    ${k}:`).test(x));
  return l ? l.replace(new RegExp(`^    ${k}:\\s*`), '').trim() : null;
};

// The guard step's `run: |` script, de-indented.
function guardScript(body) {
  const at = body.findIndex((l) => /^\s+run:\s*\|\s*$/.test(l));
  assert.notStrictEqual(at, -1, 'dedupe has no run: | block');
  const ind = body[at].match(/^(\s*)/)[1].length + 2;
  const out = [];
  for (let i = at + 1; i < body.length; i++) {
    const l = body[i];
    if (l.trim() !== '' && l.match(/^(\s*)/)[1].length < ind) break;
    out.push(l.slice(ind));
  }
  return out.join('\n');
}

for (const file of FILES) {
  const jobs = jobsOf(read(file));

  test(`${file}: dedupe fires only on a ref-creating push, read-only, no checkout, fail-open (#418)`, () => {
    const d = jobs.dedupe;
    assert.ok(d, 'no dedupe job');
    const cond = key(d, 'if');
    assert.match(cond, /github\.event_name == 'push'/);
    assert.match(cond, /github\.event\.created/);
    const body = d.join('\n');
    assert.match(body, /^    permissions:\n      actions: read$/m);
    assert.doesNotMatch(body, /actions\/checkout/);
    assert.doesNotMatch(body, /\bexit 1\b/);
    assert.match(body, /tested: \$\{\{ steps\.check\.outputs\.tested \}\}/);
  });

  test(`${file}: every other job runs when dedupe is skipped and skips when it says tested (#418)`, () => {
    const others = Object.keys(jobs).filter((j) => j !== 'dedupe');
    assert.ok(others.length >= 2, `expected the suite jobs, got ${others}`);
    for (const j of others) {
      const cond = key(jobs[j], 'if') || '';
      assert.match(cond, /!cancelled\(\)/, `${j}: if: must carry !cancelled() — implicit success() reads every ancestor, dedupe included`);
      const needs = key(jobs[j], 'needs');
      if (needs === 'dedupe') {
        assert.match(cond, /needs\.dedupe\.outputs\.tested != 'true'/, `${j}: must skip when dedupe says tested`);
      } else {
        assert.ok(needs && others.includes(needs), `${j}: needs neither dedupe nor a guarded job (${needs})`);
        assert.match(cond, new RegExp(`needs\\.${needs}\\.result == 'success'`), `${j}: must require ${needs} to have succeeded`);
      }
    }
    assert.ok(others.some((j) => key(jobs[j], 'needs') === 'dedupe'));
  });

  test(`${file}: the guard script decides tested only from a listed green run (#418)`, () => {
    const script = guardScript(jobs.dedupe);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedupe-'));
    try {
      const run = (ghBody) => {
        const bin = path.join(dir, 'bin');
        fs.rmSync(bin, { recursive: true, force: true });
        fs.mkdirSync(bin);
        if (ghBody !== null) {
          fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\n${ghBody}\n`, { mode: 0o755 });
        }
        const out = path.join(dir, 'out');
        fs.writeFileSync(out, '');
        const r = spawnSync('/bin/bash', ['-e', '-c', script], {
          env: {
            PATH: `${bin}:/usr/bin:/bin`, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: path.join(dir, 'sum'),
            REPO: 'o/r', RUN_ID: '42', SHA: 'abc123', GH_TOKEN: 'x',
          },
          encoding: 'utf8',
        });
        assert.strictEqual(r.status, 0, `script failed: ${r.stderr}`);
        return fs.readFileSync(out, 'utf8').trim();
      };
      // `gh api <url> --jq …`: answer by URL shape. $2 is the URL.
      const gh = (wf, count) =>
        `case "$2" in */runs/42) ${wf};; */workflows/*) ${count};; *) exit 9;; esac`;
      assert.strictEqual(run(gh('echo 777', 'echo 1')), 'tested=true');
      assert.strictEqual(run(gh('echo 777', 'echo 0')), 'tested=false');
      assert.strictEqual(run(gh('echo 777', 'exit 1')), 'tested=false');
      assert.strictEqual(run(gh('exit 1', 'echo 1')), 'tested=false');
      assert.strictEqual(run(gh('echo', 'echo 1')), 'tested=false'); // empty workflow id
      assert.strictEqual(run(gh('echo 777', 'echo garbage')), 'tested=false');
      assert.strictEqual(run(null), 'tested=false'); // no gh on the runner
      // The run listing must be this workflow at this sha, green only, excluding itself and PR runs.
      const log = path.join(dir, 'args');
      run(`echo "$@" >> ${log}; ${gh('echo 777', 'echo 0')}`);
      const args = fs.readFileSync(log, 'utf8');
      assert.match(args, /repos\/o\/r\/actions\/workflows\/777\/runs\?head_sha=abc123&status=success/);
      assert.match(args, /\.id != 42/);
      assert.match(args, /\.event != "pull_request"/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
