'use strict';
/**
 * Subprocess/CLI tests for #234 — `colab ship` and `colab promote` write the MAIN checkout
 * (`repoAbs`) directly whenever that is the target (`target === trunk` for ship,
 * `useRepoDir` for promote), and until this fix neither ever consulted the place registry
 * (tools/lib/place.js) before doing it. A live place-claim held by a DIFFERENT session on that
 * exact checkout — the thing the registry exists to make visible — was invisible to both.
 *
 * Same fixture/colab() shape as tools/lib/ship-migration-grant.test.js (real CLI, real repo, real
 * bare `origin` on disk, no network), with one addition: a fake `gh` that answers `run list` with a
 * green run for the fixture's actual HEAD sha, so the real (non-dry) ship/promote paths can run to
 * completion — every other `gh` subcommand still refuses, matching the "no local fallback" posture
 * the other ship test files establish (this file makes no GitHub issue/label call at all: every
 * scenario here claims zero issues, so `ship`'s only per-issue gh loops never iterate).
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

/**
 * A clone with a real bare `origin`, a `main` trunk already pushed, and a fake `gh` on PATH that
 * reports a green CI run for whatever sha `main`/the promotion target currently sits at — computed
 * fresh each call (`refreshRuns`), since ship re-checks CI at B1 after B0 may have moved things.
 */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-place-claim-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'place-claim test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const runsFile = path.join(root, 'runs.json');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    `if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "${runsFile}"; exit 0; fi`,
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  // Green CI for a branch's CURRENT sha ON ORIGIN — `ghRunForSha` resolves the sha via
  // `git ls-remote origin`, never the local ref, so this reads the bare `origin` directly (matters
  // for the push-race test below, where local `work` and `origin` deliberately diverge).
  function greenCi(branch) {
    const sha = execFileSync('git', ['rev-parse', branch], { cwd: origin, encoding: 'utf8' }).trim();
    fs.writeFileSync(runsFile, JSON.stringify([
      { headSha: sha, status: 'completed', conclusion: 'success', createdAt: new Date().toISOString(), databaseId: 1 },
    ]));
  }

  return { root, origin, work, home, bin, g, greenCi };
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

const PROJECT_YML_TIER_B = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
// Tier C shape (exposure: live equivalent): trunk `dev`, promotion dev->main is deploy=push-main.
const PROJECT_YML_TIER_C = 'tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\n';

function branchWithCommit(fx, branch, file, subject) {
  fx.g(fx.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(fx.work, file), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', subject);
  fx.g(fx.work, 'checkout', '-q', 'main');
}

/** Read the raw state.json a fixture's colab wrote/would write. */
function readState(fx) {
  const p = path.join(fx.home, 'state.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// --- colab ship: the main checkout, target === trunk -----------------------------------------

test('ship refuses when a LIVE place-claim on the trunk checkout is held by a different session — never writes, never pushes', () => {
  const fx = fixture(PROJECT_YML_TIER_B);
  branchWithCommit(fx, 'feat/no-issue-here', 'g.txt', 'feat: something');
  fx.greenCi('main');

  // A place-claim acquired by a DIFFERENT (but genuinely live) session — `colab place acquire`
  // records `pid: process.ppid` of the CLI invocation, i.e. THIS test process, which is alive for
  // the duration of the test. That is exactly the "another session is mid-write" shape #234 names.
  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session', 'session_other-holder']);
  assert.strictEqual(acq.code, 0, acq.out + acq.err);

  const beforeSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  const r = colab(fx, ['ship', '--branch', 'feat/no-issue-here', '--repo', fx.work], { COLAB_SESSION: 'session_shipper' });
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /refusing/);
  assert.match(r.err, /place .* is held by session/);
  // #317: the refusal now names WHICH of the three cases this is. `live-other` here is also the
  // regression sentinel for `ownsAnchor`'s term 3: the hold was written by a `colab place acquire`
  // whose anchor is this test process's own parent (`anchorProof: 'default'`), and the command
  // under test is a descendant of that same parent — so terms 1/2/4/5 alone would return "own",
  // it would self-own a live FOREIGN hold, and this assertion would read `own` instead. If that
  // ever happens, #242 has been reopened.
  assert.match(r.err, /class: live-other/);
  // Never offered as a self-service escape hatch — the only remedy named is the human-gated one.
  assert.doesNotMatch(r.err + r.out, /re-run with --force/);
  assert.doesNotMatch(r.err + r.out, /--force to (take|clear|override)/);
  assert.match(r.err, /COLAB_HUMAN=1/);

  // Nothing landed: main is unchanged locally and on origin.
  const afterSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  assert.strictEqual(afterSha, beforeSha);
  const originSha = execFileSync('git', ['rev-parse', 'main'], { cwd: fx.origin, encoding: 'utf8' }).trim();
  assert.strictEqual(originSha, beforeSha);

  // The refused ship must not have disturbed the other session's hold.
  const st = readState(fx);
  const rec = st.places[fs.realpathSync(fx.work)];
  assert.ok(rec, 'the other session\'s place-claim must still be recorded');
  assert.strictEqual(rec.session, 'session_other-holder');
});

// --- #317: ship must not destroy a hold it merely renewed, and must not refuse its own ----------

test('#317: ship on a checkout its OWN claim already holds leaves that hold in place (the 8.5h specimen)', () => {
  const fx = fixture(PROJECT_YML_TIER_B);
  branchWithCommit(fx, 'feat/own-hold-7', 'g.txt', 'feat: own hold');
  fx.greenCi('main');

  // A no-worktree `colab claim` mints the checkout place-claim (`takingPlace`), then the same
  // session ships. `--branch` is what lets `resolveShipSession` FIND that claim and so resolve the
  // identity string: its filter is worktree-keyed or branch-keyed, and a claim carrying neither is
  // invisible to it — which is the specimen's own shape, covered by the anchor test below.
  const claimed = colab(fx, ['claim', '7', '--repo', fx.work, '--branch', 'feat/own-hold-7', '--session', 'session_shipper']);
  assert.strictEqual(claimed.code, 0, claimed.out + claimed.err);
  const key = fs.realpathSync(fx.work);
  const before = readState(fx).places[key];
  assert.ok(before, 'the claim must have taken the checkout hold');

  const r = colab(fx, ['ship', '--branch', 'feat/own-hold-7', '--repo', fx.work], { COLAB_SESSION: 'session_shipper' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /already held by this session/);

  // BEFORE #317 this record was gone: ship's acquire overwrote the claim's hold, and its cleanup
  // deleted the record on the way out — leaving the claim standing with nothing holding the
  // checkout for it. The claim is still open here, so its hold must survive its own ship.
  const after = readState(fx).places[key];
  assert.ok(after, "the claim's hold must survive the ship");
  assert.strictEqual(after.session, 'session_shipper');
  assert.strictEqual(after.since, before.since, 'left in place, not re-taken (a re-acquire would reset `since`)');
});

test('#317: a ship whose session STRING does not match is still its own holder under a verified anchor', () => {
  const fx = fixture(PROJECT_YML_TIER_B);
  branchWithCommit(fx, 'feat/anchor-own-here', 'g.txt', 'feat: anchor own');
  fx.greenCi('main');

  // CLAUDE_PID = this test process, a real ancestor of both child invocations — `resolveAnchor`
  // rule 2 fires for real, so the hold is recorded `anchorProof: 'verified'`.
  // Claimed with NEITHER --worktree NOR --branch — so `resolveShipSession` cannot find this claim
  // and ship presents a blank/other identity. The branch name deliberately carries no issue number,
  // for the same reason: this is the specimen, where ship and its own claim never met.
  const agent = { CLAUDE_PID: String(process.pid) };
  const claimed = colab(fx, ['claim', '8', '--repo', fx.work, '--session', 'coding-dashboard-1545'], agent);
  assert.strictEqual(claimed.code, 0, claimed.out + claimed.err);
  const key = fs.realpathSync(fx.work);
  assert.strictEqual(readState(fx).places[key].anchorProof, 'verified');

  // The specimen: ship resolves its identity from the worktree/branch-keyed claim, and a
  // no-worktree claim carries `branch: null`, so it presented a session the hold does not name.
  // That was an 8.5-hour trunk stall; it is now class `own`.
  const r = colab(fx, ['ship', '--branch', 'feat/anchor-own-here', '--repo', fx.work],
    { ...agent, COLAB_SESSION: 'a-session-string-the-hold-does-not-carry' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /already held by this session/);
  assert.strictEqual(readState(fx).places[key].session, 'coding-dashboard-1545', 'not overwritten either');
});

test('ship proceeds when the only place record on the checkout is a DEAD holder (pid gone) — liveness is re-derived, not trusted', () => {
  const fx = fixture(PROJECT_YML_TIER_B);
  branchWithCommit(fx, 'feat/dead-holder-here', 'g.txt', 'feat: something else');
  fx.greenCi('main');

  // Seed a place record directly (bypassing the CLI, which would record a genuinely live pid) with
  // a pid essentially guaranteed not to be alive.
  const key = fs.realpathSync(fx.work);
  fs.writeFileSync(path.join(fx.home, 'state.json'), JSON.stringify({
    version: 1, worktrees: {}, claims: {}, ports: {}, solo: {},
    places: { [key]: { path: key, repo: fx.work, branch: null, host: os.hostname(), session: 'session_dead', sessionName: 'dead', pid: 999999, since: new Date().toISOString() } },
  }));

  const r = colab(fx, ['ship', '--branch', 'feat/dead-holder-here', '--repo', fx.work], { COLAB_SESSION: 'session_shipper' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /Shipped feat\/dead-holder-here → main/);

  // And the dead holder's stale record is gone too — ship's own acquire overwrote it, then released.
  const st = readState(fx);
  assert.strictEqual((st.places || {})[key], undefined);
});

test('ship (no place-claim on the machine at all): unaffected, and leaves no place record behind on success', () => {
  const fx = fixture(PROJECT_YML_TIER_B);
  branchWithCommit(fx, 'feat/plain-ship-here', 'g.txt', 'feat: plain');
  fx.greenCi('main');

  const r = colab(fx, ['ship', '--branch', 'feat/plain-ship-here', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /Shipped feat\/plain-ship-here → main/);

  const st = readState(fx);
  assert.deepStrictEqual(st.places || {}, {}, 'a successful ship must not leave a stale place record');
});

test('ship: the place-claim is released even when B2 (the push) FAILS — the actual race #234 is about', () => {
  const fx = fixture(PROJECT_YML_TIER_B);
  branchWithCommit(fx, 'feat/push-race-here', 'g.txt', 'feat: something');

  // Simulate a DIFFERENT writer landing on origin/main between ship's precondition table and its
  // own push — a raw clone (not fx.work) pushes directly to origin. fx.work's local `main` ref is
  // deliberately left stale, exactly like a real trunk checkout that has not re-synced yet.
  const raceClone = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-place-claim-race-'));
  TMP.push(raceClone);
  execFileSync('git', ['clone', '-q', fx.origin, raceClone], { encoding: 'utf8' });
  fs.writeFileSync(path.join(raceClone, 'race.txt'), 'x\n');
  execFileSync('git', ['-C', raceClone, 'config', 'user.email', 'race@example.invalid']);
  execFileSync('git', ['-C', raceClone, 'config', 'user.name', 'race']);
  execFileSync('git', ['-C', raceClone, 'add', '-A']);
  execFileSync('git', ['-C', raceClone, 'commit', '-q', '-m', 'chore: a different writer lands first']);
  execFileSync('git', ['-C', raceClone, 'push', '-q', 'origin', 'main']);
  fx.greenCi('main'); // green for origin's NEW head — the sha ship's CI checks will actually see

  const r = colab(fx, ['ship', '--branch', 'feat/push-race-here', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /B2: push failed/);

  const st = readState(fx);
  assert.deepStrictEqual(st.places || {}, {}, 'a failed push must still release the hold ship took before B1');
});

// --- colab promote: the main checkout, useRepoDir --------------------------------------------

test('promote refuses when a LIVE place-claim on the main checkout is held by a different session', () => {
  const fx = fixture(PROJECT_YML_TIER_C);
  // dev already exists as a branch of main in this fixture (trunk: dev) — create it, add a commit,
  // push, so promote has something to merge --no-ff.
  fx.g(fx.work, 'checkout', '-q', '-b', 'dev');
  fs.writeFileSync(path.join(fx.work, 'd.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: dev work');
  fx.g(fx.work, 'push', '-q', 'origin', 'dev');
  fx.g(fx.work, 'checkout', '-q', 'main'); // main checkout is what promote will use directly
  fx.greenCi('dev');

  const acq = colab(fx, ['place', 'acquire', fx.work, '--repo', fx.work, '--session', 'session_other-holder']);
  assert.strictEqual(acq.code, 0, acq.out + acq.err);

  const beforeSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  const r = colab(fx, ['promote', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /refusing/);
  assert.match(r.err, /place .* is held by session/);
  // #317: the refusal now names WHICH of the three cases this is. `live-other` here is also the
  // regression sentinel for `ownsAnchor`'s term 3: the hold was written by a `colab place acquire`
  // whose anchor is this test process's own parent (`anchorProof: 'default'`), and the command
  // under test is a descendant of that same parent — so terms 1/2/4/5 alone would return "own",
  // it would self-own a live FOREIGN hold, and this assertion would read `own` instead. If that
  // ever happens, #242 has been reopened.
  assert.match(r.err, /class: live-other/);
  assert.doesNotMatch(r.err + r.out, /re-run with --force/);
  assert.doesNotMatch(r.err + r.out, /--force to (take|clear|override)/);

  const afterSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  assert.strictEqual(afterSha, beforeSha);
});

test('promote (no place-claim on the machine): unaffected, and leaves no place record behind on success', () => {
  const fx = fixture(PROJECT_YML_TIER_C);
  fx.g(fx.work, 'checkout', '-q', '-b', 'dev');
  fs.writeFileSync(path.join(fx.work, 'd.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: dev work 2');
  fx.g(fx.work, 'push', '-q', 'origin', 'dev');
  fx.g(fx.work, 'checkout', '-q', 'main');
  fx.greenCi('dev');

  const r = colab(fx, ['promote', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /Promoted dev → main/);

  const st = readState(fx);
  assert.deepStrictEqual(st.places || {}, {}, 'a successful promote must not leave a stale place record');
});

// --- syncedStateProblem guards this write site too (same posture as cmdClaim/cmdSolo/cmdWorktreeNew,
// tools/lib/place-cli.test.js's "ship-grade remainder" cluster) --------------------------------

test('ship refuses to write the trunk checkout when COLAB_HOME sits under a synced marker — same guard as cmdSolo/cmdWorktreeNew', () => {
  const fx = fixture(PROJECT_YML_TIER_B);
  branchWithCommit(fx, 'feat/synced-home-here', 'g.txt', 'feat: something');
  fx.greenCi('main');
  fs.mkdirSync(path.join(fx.home, '.sync'));

  const beforeSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  const r = colab(fx, ['ship', '--branch', 'feat/synced-home-here', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /file-synced/);
  const afterSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  assert.strictEqual(afterSha, beforeSha, 'a file-synced COLAB_HOME must degrade to a refusal, never a silent write');
});

test('promote refuses to write the main checkout when COLAB_HOME sits under a synced marker', () => {
  const fx = fixture(PROJECT_YML_TIER_C);
  fx.g(fx.work, 'checkout', '-q', '-b', 'dev');
  fs.writeFileSync(path.join(fx.work, 'd.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: dev work 3');
  fx.g(fx.work, 'push', '-q', 'origin', 'dev');
  fx.g(fx.work, 'checkout', '-q', 'main');
  fx.greenCi('dev');
  fs.mkdirSync(path.join(fx.home, '.sync'));

  const beforeSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  const r = colab(fx, ['promote', '--repo', fx.work], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /file-synced/);
  const afterSha = fx.g(fx.work, 'rev-parse', 'main').trim();
  assert.strictEqual(afterSha, beforeSha);
});
