'use strict';
/**
 * Subprocess/CLI tests for #263: the close gate (#74, tools/lib/checklist.js) now refuses the
 * MERGE, not just the close, when an issue's `## Plan` checklist carries an unticked box with no
 * declared `Remainder: #M`. Before this, `resolveCloseRefsSplit` silently downgraded that issue's
 * trailer from `Closes #N` to `Refs #N` and let the ship proceed — measured (#263's own issue body)
 * at roughly one ship in seven leaving a half-done issue open with no record anyone meant it that
 * way. Now it is a precondition row like any other (CI green, no new migrations, …): red until the
 * remainder is declared (or the boxes are ticked, or the operator explicitly `--refs`'s it).
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same fixture/colab() shape as
 * tools/lib/ship-dry-json.test.js and tools/lib/ship-migration-grant.test.js. UNLIKE those two
 * files, this feature is reached only when `gh` calls actually resolve real content — a bare
 * local-origin fixture makes every `gh issue view` fail, which reads as "read failed, degrade,
 * never gate" (resolveCloseRefsSplit's own contract) and would leave this gate silently untested.
 * So this file puts a FAKE `gh` first on PATH (same technique as ship-migration-grant.test.js's
 * `withFakeGh`-style binary) that answers `--version`/`auth status` for real, and answers
 * `issue view <N> --json body,comments` / `--json labels` from a small per-issue JSON fixture on
 * disk — never a live authorization decision, just the same shape a real `gh` would hand back for
 * an issue's own recorded scope.
 *
 * `gh run list` (the CI-green check) always fails against this fixture's non-GitHub origin, so
 * every table here carries exactly one OTHER always-red row: `... CI green`, class self-clearing.
 * That is the fixture's floor, not a symptom of this feature — matches the precedent set by
 * ship-dry-json.test.js's "clean, all-green table" test, which accepts the identical single red row
 * as the definition of clean. The BOTH-DIRECTIONS oracle this file exists to assert:
 *   - unticked box, no remainder  → the new row is ALSO red (two red rows total) — RED direction.
 *   - unticked box, remainder set → the new row is the ONLY green box added — the table is back to
 *     the fixture's floor (one red row, CI only) — GREEN direction.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML_AUTO_TRUNK = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

/** A clone with a real bare `origin` and a `main` trunk, private COLAB_HOME, plus a fake `gh` on
 *  its own `bin/` — same fixture shape as ship-migration-grant.test.js's fixture(), with the fake
 *  `gh` extended to answer `issue view --json body,comments` / `--json labels` from disk. */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ship-checklist-gate-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const issuesDir = path.join(root, 'issues');
  fs.mkdirSync(home);
  fs.mkdirSync(issuesDir);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab ship-checklist-gate test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  // Fake `gh`, first on PATH (see file banner): real for --version/auth status, and answers
  // `issue view <N> --json body,comments` from `<issuesDir>/<N>.json` when present. `--json
  // labels` always reports no labels (so the "tracking" label check this gate composes with never
  // fires here — this file's scope is the checklist gate alone). Anything else fails loudly, the
  // same "fixture gh: refusing $*" shape ship-migration-grant.test.js uses.
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    '  num="$3"',
    '  fields=""',
    '  shift 3',
    '  while [ $# -gt 0 ]; do',
    '    if [ "$1" = "--json" ]; then fields="$2"; fi',
    '    shift',
    '  done',
    '  if [ "$fields" = "labels" ]; then echo \'{"labels":[]}\'; exit 0; fi',
    '  if [ "$fields" = "body,comments" ]; then',
    `    f="${issuesDir}/\${num}.json"`,
    '    if [ -f "$f" ]; then cat "$f"; exit 0; fi',
    '  fi',
    'fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, issuesDir, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fx.bin}:${process.env.PATH}`,
      COLAB_HOME: fx.home,
      // #242: a non-blank, fixed COLAB_SESSION — claims here use no --worktree, which mints the
      // trunk-checkout place-claim and now requires a session id up front. Same fix as the
      // ship-plan-journal.test.js precedent comment for the identical #237 root cause.
      COLAB_SESSION: 'sess-checklist-gate-test',
      COLAB_SESSION_NAME: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function writeIssueFixture(fx, num, body, comments = []) {
  fs.writeFileSync(path.join(fx.issuesDir, `${num}.json`), JSON.stringify({ body, comments }));
}

const UNTICKED_NO_REMAINDER = '## Plan\n\n- [ ] one\n- [x] two\n';
function unTickedWithRemainder(remainderNum) {
  return `## Plan\n\n- [ ] one\n- [x] two\n\nRemainder: #${remainderNum}\n`;
}

/** Branch fx.work onto <branch> with one ordinary commit, claim <issue> on it, return to main. */
function addClaimedBranch(fx, branch, issue) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, `${branch.replace(/\//g, '-')}.txt`), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `fix: address the thing for #${issue}`);
  fx.g(fx.work, 'checkout', '-q', 'main');
  colab(fx, ['claim', String(issue), '--branch', branch, '--repo', fx.work]);
}

// --- RED direction: unticked box, no declared remainder --------------------------------------

test('--dry --json: unticked Plan box with NO declared remainder adds a red "remainder declared" row (RED direction)', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  writeIssueFixture(fx, 301, UNTICKED_NO_REMAINDER);
  addClaimedBranch(fx, 'fix/gate-red-301', 301);

  const r = colab(fx, ['ship', '--branch', 'fix/gate-red-301', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);

  const row = body.checks.find((c) => c.name === 'remainder declared for unticked issues');
  assert.ok(row, `missing check row in ${JSON.stringify(body.checks.map((c) => c.name))}`);
  assert.strictEqual(row.ok, false);
  assert.strictEqual(row.class, 'human-gated');
  assert.match(row.detail, /#301/);
  assert.deepStrictEqual(body.checklistFindings.map((f) => f.issue), [301]);

  // The gate is what blocks — the ONLY two red rows are CI (unavoidable in this fixture, #263 is
  // not what's being asserted there) and this one.
  const notOk = body.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.strictEqual(notOk.length, 2, JSON.stringify(notOk));
  assert.ok(notOk.some((n) => /CI green/.test(n)), JSON.stringify(notOk));
  assert.ok(notOk.includes('remainder declared for unticked issues'), JSON.stringify(notOk));
  assert.strictEqual(body.ok, false);
});

test('--dry (prose): unticked Plan box with no declared remainder refuses, naming the issue and the remedy', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  writeIssueFixture(fx, 302, UNTICKED_NO_REMAINDER);
  addClaimedBranch(fx, 'fix/gate-red-302', 302);

  const r = colab(fx, ['ship', '--branch', 'fix/gate-red-302', '--repo', fx.work, '--dry']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out + r.err, /#302:.*refusing to ship until this is resolved/);
  assert.match(r.out + r.err, /Remainder: #M/);
  assert.match(r.out, /remainder declared for unticked issues/);
});

// --- GREEN direction: unticked box, remainder declared ----------------------------------------

test('--dry --json: unticked Plan box WITH a declared remainder reports the row green (GREEN direction)', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  writeIssueFixture(fx, 401, unTickedWithRemainder(999));
  addClaimedBranch(fx, 'fix/gate-green-401', 401);

  const r = colab(fx, ['ship', '--branch', 'fix/gate-green-401', '--repo', fx.work, '--dry', '--json']);
  const body = JSON.parse(r.out);

  const row = body.checks.find((c) => c.name === 'remainder declared for unticked issues');
  assert.ok(row);
  assert.strictEqual(row.ok, true);
  assert.strictEqual(row.class, null);
  assert.deepStrictEqual(body.checklistFindings, []);
  // #401 keeps its Closes, exactly as closeGate's own contract says a declared remainder permits.
  assert.deepStrictEqual(body.closeIssues, [401]);
  assert.deepStrictEqual(body.refsIssues, []);

  // Back to the fixture's floor: the ONLY red row left is the always-unreachable CI check — this
  // gate contributes nothing red once the remainder is declared.
  const notOk = body.checks.filter((c) => !c.ok).map((c) => c.name);
  assert.strictEqual(notOk.length, 1, JSON.stringify(notOk));
  assert.match(notOk[0], /CI green/);
});

test('--dry (prose): unticked Plan box with a declared remainder does not print the refusal warning', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  writeIssueFixture(fx, 402, unTickedWithRemainder(999));
  addClaimedBranch(fx, 'fix/gate-green-402', 402);

  const r = colab(fx, ['ship', '--branch', 'fix/gate-green-402', '--repo', fx.work, '--dry']);
  assert.doesNotMatch(r.out + r.err, /refusing to ship until this is resolved/);
  assert.match(r.out, /remainder declared for unticked issues/);
});

// --- the escape hatch: an explicit --refs never reaches the checklist gate at all -------------

test('--dry --json: --refs on the claimed issue bypasses the checklist gate entirely (deliberate, not a gate failure)', () => {
  const fx = fixture(PROJECT_YML_AUTO_TRUNK);
  writeIssueFixture(fx, 501, UNTICKED_NO_REMAINDER);
  addClaimedBranch(fx, 'fix/gate-refs-501', 501);

  const r = colab(fx, ['ship', '--branch', 'fix/gate-refs-501', '--repo', fx.work, '--refs', '501', '--dry', '--json']);
  const body = JSON.parse(r.out);

  const row = body.checks.find((c) => c.name === 'remainder declared for unticked issues');
  assert.ok(row);
  assert.strictEqual(row.ok, true, JSON.stringify(row));
  assert.deepStrictEqual(body.checklistFindings, []);
  assert.deepStrictEqual(body.refsIssues, [501]);
});
