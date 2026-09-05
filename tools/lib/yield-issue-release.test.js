'use strict';
/**
 * Tests for #173 — `yieldIssue` (tools/colab, "we lost the simultaneous-claim tie-break") must
 * route its remote release through `ghIssueRelease` (GraphQL primary, REST fallback on a
 * GraphQL-specific rate limit — #164) and apply the SAME retention rule #164 already applies at
 * `cmdRelease` and worktree-rm release: when the write fails on BOTH transports, keep the local
 * claim marked `releasePending` instead of deleting it. Before this fix the claim was deleted
 * unconditionally after only a warn(), which is #164's exact divergence in a second place.
 *
 * Drives the real CLI end to end: `colab claim` against a fake `gh` whose `issue view --json
 * comments` response is rigged so the tie-break says we LOST (an earlier claim from a different
 * GitHub login is already on the issue) — this is the only way to reach `yieldIssue` without
 * calling it directly, since it is an internal function of tools/colab, not exported.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
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

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

/**
 * A clone with a real bare `origin`, private COLAB_HOME, and a `gh` stub that:
 *  - answers `--version` / `auth status` / `api user` (so `isGhUsable()`/`ghCurrentLogin()` read
 *    real values without touching the network);
 *  - answers `issue view N --json comments` with TWO live claim comments: one from a different
 *    login/host, timestamped EARLIER than ours — this is what makes `tieBreakVerdict` say we lost;
 *  - lets `issue edit --add-assignee/--add-label` (the CLAIM write) succeed;
 *  - `releaseMode` controls what the YIELD write does: 'ok' (both `--remove-assignee` and the
 *    REST DELETE fallbacks succeed), or 'fail-both' (the GraphQL edit reports a rate limit AND the
 *    REST fallback also fails — the shape #173 is about).
 */
function fixture(releaseMode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-yield-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'yield-issue test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const myHost = os.hostname();
  const comments = [
    // earlier, different login+host — the winner of the tie-break
    { createdAt: '2020-01-01T00:00:00Z', author: { login: 'other' },
      body: `🔒 Claimed — worktree \`-\` · branch \`-\` · host \`other-host\` · 2020-01-01T00:00:00Z` },
    // ours — later, same login ("me") the fixture's `gh api user` reports, same real host
    { createdAt: '2020-01-01T00:00:05Z', author: { login: 'me' },
      body: `🔒 Claimed — worktree \`-\` · branch \`-\` · host \`${myHost}\` · 2020-01-01T00:00:05Z` },
  ];

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const editRemoveBehavior = releaseMode === 'ok'
    ? 'exit 0'
    : 'echo "GraphQL: API rate limit exceeded for installation ID 1 (fixture)" >&2; exit 1';
  const apiDeleteBehavior = releaseMode === 'ok' ? 'exit 0' : 'echo "fixture gh api: refusing $*" >&2; exit 1';
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    `if [ "$1" = "api" ]; then ${apiDeleteBehavior}; fi`,
    'if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then',
    '  case " $* " in',
    `    *" --remove-assignee "*) ${editRemoveBehavior} ;;`,
    '    *) exit 0 ;;',
    '  esac',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "comment" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then cat <<\'JSONEOF\'',
    JSON.stringify({ comments }),
    'JSONEOF',
    'exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, g };
}

// #317: the agent-anchor env vars are neutralised for the same reason #237 neutralised
// COLAB_HUMAN above — a green test must never depend on WHO ran the suite. `place.resolveAnchor`
// adopts CLAUDE_PID as a `'verified'` anchor when it is alive and an ancestor of the invocation,
// and `ownsAnchor` then treats every hold taken under it as the caller's own. Run this file from
// inside an agent session with those vars set and every child `colab` here shares ONE verified
// anchor, so two fixtures pretending to be different sessions become one writer and the
// different-holder refusals below silently stop being exercised — while the same file stays green
// on CI, where the vars are unset. Measured exactly that: 9 tests across 3 files passed on a
// runner and failed on an agent's machine. Tests that WANT the verified-anchor path set CLAUDE_PID
// explicitly through `extraEnv`.
// #317: the agent-anchor env vars are neutralised for the same reason #237 neutralised
// COLAB_HUMAN elsewhere — a green test must never depend on WHO ran the suite. `place.resolveAnchor`
// adopts CLAUDE_PID as a `'verified'` anchor when it is alive and an ancestor of the invocation,
// and `ownsAnchor` then treats every hold taken under it as the caller's own. Run this file from
// inside an agent session with those vars set and every child `colab` here shares ONE verified
// anchor, so two fixtures pretending to be different sessions become one writer and the
// different-holder refusals silently stop being exercised — while the same file stays green on CI,
// where the vars are unset. Measured exactly that: 9 tests across 3 files passed on a runner and
// failed on an agent's machine. Tests that WANT the verified-anchor path set CLAUDE_PID explicitly.
function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home,
      COLAB_SESSION: '', COLAB_SESSION_NAME: '',
      CLAUDE_PID: '', CLAUDECODE: '', AI_AGENT: '',
      ...extraEnv,
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function loadClaims(fx) {
  const raw = fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8');
  return JSON.parse(raw).claims;
}

// `colab claim` exits non-zero whenever a claim is lost to the tie-break (a real issue got
// yielded, not merely claimed) — that is expected in every test here and not what is under test.

test('yieldIssue, remote release succeeds: the local claim is deleted, same as before #173', () => {
  const fx = fixture('ok');
  const r = colab(fx, ['claim', '9', '--worktree', 'wt-9', '--repo', fx.work]);
  assert.match(r.out + r.err, /Yielded #9/, r.out + r.err);
  const claims = loadClaims(fx);
  const entry = Object.values(claims).find((c) => String(c.issue).includes('9'));
  assert.strictEqual(entry, undefined, `claim for #9 should be gone, found: ${JSON.stringify(claims)}`);
});

test('yieldIssue, remote release fails on BOTH transports: the local claim is KEPT as releasePending, not silently dropped (#173)', () => {
  const fx = fixture('fail-both');
  const r = colab(fx, ['claim', '9', '--worktree', 'wt-9', '--repo', fx.work]);
  assert.match(r.out + r.err, /Yielded #9/, r.out + r.err);
  assert.match(r.err, /local claim KEPT \(releasePending\)/, r.err);
  const claims = loadClaims(fx);
  const entry = Object.values(claims).find((c) => String(c.issue).includes('9'));
  assert.ok(entry, `claim for #9 should still be present (releasePending), claims: ${JSON.stringify(claims)}`);
  assert.strictEqual(entry.releasePending, true);
  assert.match(entry.releaseNote, /GitHub release failed/);
});
