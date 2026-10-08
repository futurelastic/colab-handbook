'use strict';
/**
 * The Laravel template's "Decide the test tier" step (#512).
 *
 * The template dropped its `pull_request` trigger, and on a Tier B repo that run used to be the
 * only one where the Pest suite ran (`RUN_TESTS` was true on `base_ref == 'main'` or a push to
 * main). The decision therefore moved into a step that reads the repo's trunk from
 * .github/project.yml, so a branch push on a main-trunk repo still gets its tests before merge.
 *
 * Run: `node --test tools/lib/ci-laravel-run-tests.test.js`
 *
 * The step's own shell is extracted from the template and run with each env combination, the same
 * approach ci-template-dedupe.test.js uses for its guard.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEXT = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'ci-laravel.yml'), 'utf8');

// The `run: |` body of the step named "Decide the test tier".
function stepScript() {
  const lines = TEXT.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s+- name: Decide the test tier\s*$/.test(l));
  assert.notStrictEqual(at, -1, 'step "Decide the test tier" present');
  const runAt = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
  const indent = lines[runAt].match(/^(\s*)/)[1].length + 2;
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    if (lines[i].trim() !== '' && lines[i].match(/^(\s*)/)[1].length < indent) break;
    body.push(lines[i].slice(indent));
  }
  return body.join('\n');
}

// Run the step in a checkout whose project.yml carries `descriptor` (null = no descriptor file).
function decide({ declared = 'auto', event = 'push', ref = 'refs/heads/feat/x-1', baseRef = '', defaultBranch = 'main', descriptor = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-tier-'));
  try {
    if (descriptor !== null) {
      fs.mkdirSync(path.join(dir, '.github'));
      fs.writeFileSync(path.join(dir, '.github', 'project.yml'), descriptor);
    }
    const out = path.join(dir, 'out');
    fs.writeFileSync(out, '');
    const r = spawnSync('sh', ['-c', stepScript()], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, DECLARED: declared, EVENT: event, REF: ref, BASE_REF: baseRef, DEFAULT_BRANCH: defaultBranch, GITHUB_OUTPUT: out },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return fs.readFileSync(out, 'utf8').trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const TIER_B = 'tier: B\ntrunk: main\n';
const TIER_C = 'tier: C\ntrunk: dev\n';

test('workflow env declares RUN_TESTS as auto, not as an expression', () => {
  assert.match(TEXT, /^  RUN_TESTS: auto$/m);
  assert.ok(!/^  RUN_TESTS: \$\{\{/m.test(TEXT), 'no expression left at workflow level');
});

test('every test step reads the step output, not the env', () => {
  assert.ok(!/if: env\.RUN_TESTS/.test(TEXT));
  assert.match(TEXT, /if: steps\.tier\.outputs\.run_tests == 'true'/);
});

test('main-trunk repo: a push to any branch runs the suite (the PR run used to carry it)', () => {
  assert.strictEqual(decide({ ref: 'refs/heads/feat/x-1', descriptor: TIER_B }), 'run_tests=true');
  assert.strictEqual(decide({ ref: 'refs/heads/main', descriptor: TIER_B }), 'run_tests=true');
  assert.strictEqual(decide({ event: 'workflow_dispatch', ref: 'refs/heads/feat/x-1', descriptor: TIER_B }), 'run_tests=true');
});

test('dev-trunk repo: light CI on dev and its branches, the suite on main', () => {
  assert.strictEqual(decide({ ref: 'refs/heads/dev', descriptor: TIER_C }), 'run_tests=false');
  assert.strictEqual(decide({ ref: 'refs/heads/feat/x-1', descriptor: TIER_C }), 'run_tests=false');
  assert.strictEqual(decide({ ref: 'refs/heads/main', descriptor: TIER_C }), 'run_tests=true');
});

test('a copy that restored pull_request keeps the old rule: heavy when the PR targets main', () => {
  assert.strictEqual(decide({ event: 'pull_request', ref: 'refs/pull/7/merge', baseRef: 'main', descriptor: TIER_C }), 'run_tests=true');
  assert.strictEqual(decide({ event: 'pull_request', ref: 'refs/pull/7/merge', baseRef: 'dev', descriptor: TIER_C }), 'run_tests=false');
});

test('a literal declaration wins over everything else', () => {
  assert.strictEqual(decide({ declared: 'true', ref: 'refs/heads/dev', descriptor: TIER_C }), 'run_tests=true');
  assert.strictEqual(decide({ declared: 'false', ref: 'refs/heads/main', descriptor: TIER_B }), 'run_tests=false');
});

test('no descriptor: the default branch stands in for the trunk', () => {
  assert.strictEqual(decide({ ref: 'refs/heads/feat/x-1', defaultBranch: 'main' }), 'run_tests=true');
  assert.strictEqual(decide({ ref: 'refs/heads/feat/x-1', defaultBranch: 'dev' }), 'run_tests=false');
});

test('a quoted or commented trunk value is read correctly', () => {
  assert.strictEqual(decide({ ref: 'refs/heads/feat/x-1', descriptor: 'trunk: "main"  # the trunk\n' }), 'run_tests=true');
  assert.strictEqual(decide({ ref: 'refs/heads/feat/x-1', descriptor: "trunk: 'dev'\n" }), 'run_tests=false');
});
