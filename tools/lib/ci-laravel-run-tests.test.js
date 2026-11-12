'use strict';
/**
 * The Laravel template's test tier (#512) — a block of the caller's `full` script since #724.
 *
 * The template dropped its `pull_request` trigger, and on a Tier B repo that run used to be the
 * only one where the Pest suite ran (`RUN_TESTS` was true on `base_ref == 'main'` or a push to
 * main). The decision therefore moved into a step that reads the repo's trunk from
 * .github/project.yml, so a branch push on a main-trunk repo still gets its tests before merge.
 *
 * Run: `node --test tools/lib/ci-laravel-run-tests.test.js`
 *
 * The block's own shell is extracted from the template and run with each env combination, the same
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

// The test tier inside the caller's `full: |` script (#724: the step became part of the script the
// reusable light lane runs) — the lines from `# ── the test tier` to `# ── end of the test tier`.
function stepScript() {
  const lines = TEXT.split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s+# ── the test tier \(#512\)/.test(l));
  assert.notStrictEqual(at, -1, 'the test tier block is in the full script');
  const endAt = lines.findIndex((l, i) => i > at && /^\s+# ── end of the test tier\s*$/.test(l));
  assert.notStrictEqual(endAt, -1, 'the test tier block is closed');
  const indent = lines[at].match(/^(\s*)/)[1].length;
  return lines.slice(at, endAt).map((l) => l.slice(indent)).join('\n') + '\necho "run_tests=$run" >> "$GITHUB_OUTPUT"\n';
}

// Run the tier in a checkout whose project.yml carries `descriptor` (null = no descriptor file). The
// called workflow's shell sees the CALLER's github context through the runner's env (GITHUB_*), and
// the default branch only through the event payload.
function decide({ declared = 'auto', event = 'push', ref = 'refs/heads/feat/x-1', baseRef = '', defaultBranch = 'main', descriptor = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-tier-'));
  try {
    if (descriptor !== null) {
      fs.mkdirSync(path.join(dir, '.github'));
      fs.writeFileSync(path.join(dir, '.github', 'project.yml'), descriptor);
    }
    const out = path.join(dir, 'out');
    fs.writeFileSync(out, '');
    const ev = path.join(dir, 'event.json');
    fs.writeFileSync(ev, JSON.stringify({ ref, repository: { name: 'r', default_branch: defaultBranch } }, null, 2));
    const r = spawnSync('bash', ['-eo', 'pipefail', '-c', stepScript()], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, RUN_TESTS: declared, GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_BASE_REF: baseRef,
        GITHUB_WORKSPACE: dir, GITHUB_EVENT_PATH: ev, GITHUB_OUTPUT: out },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return fs.readFileSync(out, 'utf8').trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const TIER_B = 'tier: B\ntrunk: main\n';
const TIER_C = 'tier: C\ntrunk: dev\n';

test('the full script declares RUN_TESTS as auto, an edit point (#724)', () => {
  assert.match(TEXT, /^ {8}# EDIT: whether the Pest suite runs\./m);
  assert.match(TEXT, /^ {8}RUN_TESTS=auto$/m);
  assert.ok(!/^  RUN_TESTS:/m.test(TEXT), 'no workflow-level env left — a called workflow would not see it');
});

test('the dev dependencies, migrate and the suite all follow the tier', () => {
  assert.match(TEXT, /if \[ "\$run" = true \]; then\n\s+composer install --no-interaction/);
  assert.match(TEXT, /composer install --no-dev /);
  assert.match(TEXT, /if \[ "\$run" = true \]; then\n(\s+#.*\n)*\s+php artisan migrate --force/);
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
