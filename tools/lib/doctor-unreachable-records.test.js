'use strict';
/**
 * Tests for `colab doctor`'s two "unreachable record" predicates — #110 and #111.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Both cover a `colab doctor` pass, so both drive the real CLI against a real repo with a real
 * bare `origin` and a private COLAB_HOME (state.json is written by hand for setup — that part is
 * not going through gh, so no fake `gh` is needed for it). Modelled on doctor-release-branch.test.js.
 *
 * #110 — a `pending` worktree stub referenced by NO claim. Its only documented purpose (records.js)
 * is shielding a claim from the orphan pass until `worktree new` replaces it; once no claim points
 * at it that purpose is spent and the row is provably garbage. No TTL: age is the wrong predicate
 * for a fact, not a probability.
 *
 * #111 — a worktree-less claim whose issue the tracker no longer shows assigned+in-progress. This
 * needs a network read, so it is gated behind `--sync` and needs a fake `gh` on PATH (ghAvailable()
 * checks `gh --version` + `gh auth status`; the real predicate is `gh issue list --assignee @me
 * --label in-progress --state open --json number --limit 200`, the exact call `syncClaims` makes).
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

const TIER_B = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

/** A clone with a real bare `origin`, a `main` trunk, and a private COLAB_HOME. No fake gh here. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-unreachable-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'doctor unreachable-records test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), TIER_B);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  g('push', '-q', 'origin', 'main');

  const repoAbs = g('rev-parse', '--show-toplevel').trim();
  return { root, origin, work, home, repoAbs };
}

/** Write ~/.colab/state.json (COLAB_HOME) directly — setup only, never how the CLI itself writes. */
function writeState(fx, { worktrees = {}, claims = {}, ports = {} } = {}) {
  fs.writeFileSync(
    path.join(fx.home, 'state.json'),
    JSON.stringify({ version: 1, worktrees, claims, ports, solo: {} }, null, 2),
  );
}

// #317: the agent-anchor env vars are neutralised for the same reason #237 neutralised
// COLAB_HUMAN elsewhere — a green test must never depend on WHO ran the suite. `place.resolveAnchor`
// adopts CLAUDE_PID as a `'verified'` anchor when it is alive and an ancestor of the invocation,
// and `ownsAnchor` then treats every hold taken under it as the caller's own, so two fixtures
// pretending to be different sessions would silently become one writer here while the same file
// stayed green on CI, where those vars are unset.
function doctor(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, 'doctor', '--json', ...args], {
    cwd: fx.work,
    encoding: 'utf8',
    env: {
      ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '',
      CLAUDE_PID: '', CLAUDECODE: '', AI_AGENT: '',
      ...extraEnv,
    },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// --- #110: zero-claim pending stub ------------------------------------------------------------

test('#110: a pending stub with NO claim referencing it is reported, no TTL (fresh, not past ttl)', () => {
  const fx = fixture();
  writeState(fx, {
    worktrees: {
      'orphan-stub': {
        name: 'orphan-stub', repo: fx.repoAbs, branch: null, path: null, ports: [],
        host: 'test-host', status: 'pending', created: new Date().toISOString(), // fresh — 0h old
      },
    },
  });
  const report = doctor(fx, []);
  const entry = report.brokenRecords.find((r) => r.name === 'orphan-stub');
  assert.ok(entry, `expected orphan-stub in brokenRecords, got: ${JSON.stringify(report.brokenRecords)}`);
  assert.ok(entry.problems.some((p) => /ZERO claims/.test(p)), `expected a zero-claims problem, got: ${entry.problems}`);
  assert.strictEqual(entry.repaired, null, 'report-only run must not delete anything');

  // still on disk after a report-only run
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.ok(st.worktrees['orphan-stub'], 'report-only run must not touch state.json');
});

test('#110: --prune deletes the zero-claim stub outright', () => {
  const fx = fixture();
  writeState(fx, {
    worktrees: {
      'orphan-stub': {
        name: 'orphan-stub', repo: fx.repoAbs, branch: null, path: null, ports: [],
        host: 'test-host', status: 'pending', created: new Date().toISOString(),
      },
    },
  });
  const report = doctor(fx, ['--prune']);
  const entry = report.brokenRecords.find((r) => r.name === 'orphan-stub');
  assert.ok(entry, 'expected orphan-stub reported even under --prune');
  assert.deepStrictEqual(entry.repaired, { deleted: true });

  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.strictEqual(st.worktrees['orphan-stub'], undefined, 'the stub must be gone from state.json');
});

test('#110: a pending stub a claim STILL holds is untouched (not zero-claim, TTL rule applies instead)', () => {
  const fx = fixture();
  writeState(fx, {
    worktrees: {
      'live-stub': {
        name: 'live-stub', repo: fx.repoAbs, branch: null, path: null, ports: [],
        host: 'test-host', status: 'pending', created: new Date().toISOString(), // fresh
      },
    },
    claims: {
      [`${fx.repoAbs}#42`]: {
        issue: '#42', repo: fx.repoAbs, worktree: 'live-stub', branch: null,
        host: 'test-host', created: new Date().toISOString(),
      },
    },
  });
  const report = doctor(fx, ['--prune']);
  assert.strictEqual(report.brokenRecords.find((r) => r.name === 'live-stub'), undefined,
    'a fresh pending stub still referenced by a claim must not be reported at all (TTL not exceeded)');

  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.ok(st.worktrees['live-stub'], 'must not be deleted — a claim still points at it');
});

test('#110: a pending stub past TTL but still claimed uses the OLD age-gated report, not deletion', () => {
  const fx = fixture();
  const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString(); // 30h old, default ttl is 24h
  writeState(fx, {
    worktrees: {
      'aging-stub': {
        name: 'aging-stub', repo: fx.repoAbs, branch: null, path: null, ports: [],
        host: 'test-host', status: 'pending', created: old,
      },
    },
    claims: {
      [`${fx.repoAbs}#43`]: {
        issue: '#43', repo: fx.repoAbs, worktree: 'aging-stub', branch: null,
        host: 'test-host', created: old,
      },
    },
  });
  const report = doctor(fx, ['--prune']);
  const entry = report.brokenRecords.find((r) => r.name === 'aging-stub');
  assert.ok(entry, 'a claimed-but-aged stub is still reported through the pre-existing TTL branch');
  assert.ok(entry.problems.some((p) => /claim stub \d+h old/.test(p)));
  assert.strictEqual(entry.repaired, null, 'the TTL branch never deletes — only the zero-claim branch does');
});

// --- #111: tracker-dead worktree-less claim -----------------------------------------------------

/** A fake `gh` on PATH: `--version` and `auth status` succeed; `issue list ...` returns `assigned`. */
function withFakeGh(fx, assigned, fn) {
  const bin = path.join(fx.root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const issuesFile = path.join(fx.root, 'assigned.json');
  fs.writeFileSync(issuesFile, JSON.stringify(assigned.map((n) => ({ number: n }))));
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 2.0.0"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "list" ]; then cat "' + issuesFile + '"; exit 0; fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });
  return fn({ PATH: `${bin}:${process.env.PATH}` });
}

/** A fake `gh` whose `auth status` fails — ghAvailable() must read false, never "nothing assigned". */
function withUnreachableGh(fx, fn) {
  const bin = path.join(fx.root, 'bin-unreachable');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 2.0.0"; exit 0; fi',
    'exit 1', // auth status (and everything else) fails
  ].join('\n'), { mode: 0o755 });
  return fn({ PATH: `${bin}:${process.env.PATH}` });
}

test('#111: --sync flags a worktree-less claim the tracker no longer shows assigned, with NO age floor', () => {
  const fx = fixture();
  writeState(fx, {
    claims: {
      // fresh — 0h old, far under the 24h default TTL — but NOT in the fake gh's assigned set below
      [`${fx.repoAbs}#111`]: {
        issue: '#111', repo: fx.repoAbs, worktree: null, branch: null,
        host: 'test-host', created: new Date().toISOString(),
      },
    },
  });
  const report = withFakeGh(fx, [999], (env) => doctor(fx, ['--sync'], env));
  const entry = report.staleClaims.find((c) => c.issue === '#111');
  assert.ok(entry, `expected #111 flagged stale under --sync, got: ${JSON.stringify(report.staleClaims)}`);
  assert.strictEqual(entry.reason, 'tracker');
  assert.strictEqual(entry.ageHours, 0);
});

test('#111: WITHOUT --sync the same fresh claim is invisible (age-only path never sees it)', () => {
  const fx = fixture();
  writeState(fx, {
    claims: {
      [`${fx.repoAbs}#111`]: {
        issue: '#111', repo: fx.repoAbs, worktree: null, branch: null,
        host: 'test-host', created: new Date().toISOString(),
      },
    },
  });
  const report = doctor(fx, []); // no --sync — no gh on PATH needed at all
  assert.strictEqual(report.staleClaims.find((c) => c.issue === '#111'), undefined,
    'the tracker check must never run without --sync');
});

test('#111: a claim whose issue IS still assigned+in-progress is left alone under --sync', () => {
  const fx = fixture();
  writeState(fx, {
    claims: {
      [`${fx.repoAbs}#7`]: {
        issue: '#7', repo: fx.repoAbs, worktree: null, branch: null,
        host: 'test-host', created: new Date().toISOString(),
      },
    },
  });
  const report = withFakeGh(fx, [7], (env) => doctor(fx, ['--sync'], env));
  assert.strictEqual(report.staleClaims.find((c) => c.issue === '#7'), undefined,
    'still assigned on the tracker — must not be flagged');
});

test('#111: --sync --prune removes the tracker-dead claim', () => {
  const fx = fixture();
  writeState(fx, {
    claims: {
      [`${fx.repoAbs}#111`]: {
        issue: '#111', repo: fx.repoAbs, worktree: null, branch: null,
        host: 'test-host', created: new Date().toISOString(),
      },
    },
  });
  withFakeGh(fx, [], (env) => doctor(fx, ['--sync', '--prune'], env));
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  assert.strictEqual(st.claims[`${fx.repoAbs}#111`], undefined, 'the claim must be gone from state.json');
});

test('#111: an unreachable tracker is SKIPPED, never read as "nothing assigned" (would reap everything)', () => {
  const fx = fixture();
  writeState(fx, {
    claims: {
      [`${fx.repoAbs}#111`]: {
        issue: '#111', repo: fx.repoAbs, worktree: null, branch: null,
        host: 'test-host', created: new Date().toISOString(),
      },
    },
  });
  const report = withUnreachableGh(fx, (env) => doctor(fx, ['--sync'], env));
  assert.strictEqual(report.staleClaims.find((c) => c.issue === '#111'), undefined,
    'gh unreachable must skip the tracker check for this claim, not treat it as unassigned');
});

test('#111: age and tracker can both fire — reason says so, and it is still one report not two', () => {
  const fx = fixture();
  const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString(); // 30h — past default 24h ttl
  writeState(fx, {
    claims: {
      [`${fx.repoAbs}#111`]: {
        issue: '#111', repo: fx.repoAbs, worktree: null, branch: null,
        host: 'test-host', created: old,
      },
    },
  });
  const report = withFakeGh(fx, [], (env) => doctor(fx, ['--sync'], env));
  const matches = report.staleClaims.filter((c) => c.issue === '#111');
  assert.strictEqual(matches.length, 1, 'must appear exactly once, not once per predicate');
  assert.strictEqual(matches[0].reason, 'age+tracker');
});
