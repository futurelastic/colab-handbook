'use strict';
/**
 * Tests for #193 + #201 — `colab ship`'s (h2) B4 plan-journal + plan-file-delete step, hoisted into
 * `shipJournalPlanFiles` (tools/colab) so BOTH completion paths run it, and resolved by NUMBER-SET
 * MEMBERSHIP rather than reconstructing `issue-<N>.md` from one number at a time:
 *
 *   #193 — `shipEvidenceClose` (the zero-diff exit) used to skip this step entirely; it now calls
 *          the same shared helper the merge path does, right before its own return.
 *   #201 — a group session's compound plan file (`issue-<A>-<B>.md`) used to be invisible to the
 *          exact-name lookup; the helper now scans `.claude/plans/issue-*.md` and acts on a file only
 *          when its OWN number set is a SUBSET of the session's issues — never on a partial overlap.
 *
 * Real CLI, real repo, real bare `origin` on disk. `gh` is faked GENEROUSLY here (unlike
 * ship-ci-grant.test.js, which deliberately fakes only enough to prove the human-only gate) because
 * this file needs a REAL ship to complete end to end on both the merge path and the evidence-close
 * path — the plan-journal step only runs after every other precondition already passed.
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

const PROJECT_YML_AUTO_TRUNK = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

/**
 * A clone with a real bare `origin`, a `main` trunk, private COLAB_HOME, and a `gh` stub generous
 * enough to let a REAL `colab ship` complete: `run list` reports every workflow at trunk's CURRENT
 * head as a green success (re-read on every call, so it stays true across the ship's own commits/
 * pushes), and `issue view`/`edit`/`comment`/`close`/`label` all succeed with an empty/open shape.
 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-plan-journal-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'plan journal test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML_AUTO_TRUNK);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ] && [ "$2" = "user" ]; then echo "me"; exit 0; fi',
    // trunk CI green — re-derive the CURRENT head sha of the branch being asked about (usually
    // "main") on every call, so it stays a green answer across the ship's own merge + push.
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
    '  BR=""; shift 2',
    '  while [ $# -gt 0 ]; do if [ "$1" = "--branch" ]; then BR="$2"; fi; shift; done',
    `  SHA=$(cd "${work}" && git rev-parse "refs/heads/$BR" 2>/dev/null)`,
    `  if [ -z "$SHA" ]; then SHA=$(cd "${work}" && git rev-parse HEAD); fi`,
    '  echo "[{\\"headSha\\":\\"$SHA\\",\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\"}]"',
    '  exit 0',
    'fi',
    // issue reads: an open issue, no labels, and ONE comment colab itself did not write — the
    // shape `shipguard.hasEvidence` requires for the evidence-close path to actually close (not
    // just leave the issue open), good enough too for corroboration/close-gate/B4-verify reads
    // regardless of which --json fields were actually requested.
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then ' +
      'echo \'{"state":"OPEN","labels":[],"comments":[{"body":"fixture: delivered by hand"}]}\'; exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "comment" ]; then exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "close" ]; then exit 0; fi',
    'if [ "$1" = "label" ]; then exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, g };
}

// `shipJournalPlanFiles` builds its journal path from `os.homedir()` DIRECTLY, not from
// `COLAB_HOME` the way state.json is — pre-existing (unrelated to #193/#201, ported verbatim from
// the code this hoists), and out of this fix's scope to change. Left as is, a real ship in this
// test would write to the machine's ACTUAL `~/.colab/plan-journal.jsonl`. Overriding `HOME` in the
// subprocess env (Node's `os.homedir()` reads it on POSIX) keeps every write inside the fixture.
function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    // #237: a fixed, non-blank COLAB_SESSION (not '') — every fixture in this file runs `claim`
    // then `ship` against the SAME trunk checkout, and #234 made `ship` acquire that checkout's
    // place-claim at B1. Under #237's coexistence default, `claim` (no --worktree) now ALSO takes
    // that same place-claim (previously only a declared `writes: serial-*` repo did). Two blank
    // ('') sessions do NOT count as "the same holder" to place.conflict's re-acquire exemption —
    // only a truthy, EQUAL session does — so leaving this blank made every ship in this file
    // refuse against its own claim's still-live hold. A real session always carries a stable
    // --session for its whole lifetime (code-start step 0); this fixture now models that instead
    // of the untested "nobody ever identifies themselves" edge case.
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: 'sess-plan-journal-test', COLAB_SESSION_NAME: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function plansDir(fx) { return path.join(fx.work, '.claude', 'plans'); }

function writePlan(fx, name, { rung = '1', cause = 'none' } = {}) {
  fs.mkdirSync(plansDir(fx), { recursive: true });
  fs.writeFileSync(path.join(plansDir(fx), name), `rung: ${rung}\ncause: ${cause}\n\nplan body\n`);
}

function journalLines(fx) {
  // `os.homedir()` under our HOME override, so `~/.colab/...` resolves inside the fixture — see the
  // comment on `colab()` above. NOT `fx.home` directly: that is state.json's home (COLAB_HOME),
  // a DIFFERENT directory shape from the hardcoded-off-HOME plan journal.
  const p = path.join(fx.home, '.colab', 'plan-journal.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// --- #193: shipEvidenceClose now runs the same step the merge path does ------------------------

test('#193: evidence-close (zero-diff) journals and deletes its plan file — the exact exit that used to skip it', () => {
  const fx = fixture();
  // Zero commits, identical tree to trunk — the evidence-close shape (#90). Branch name's trailing
  // group is the claimed issue, so corroboration passes with no commits to scan.
  fx.g(fx.work, 'branch', 'docs/decision-40');
  colab(fx, ['claim', '40', '--branch', 'docs/decision-40', '--repo', fx.work]);
  writePlan(fx, 'issue-40.md');

  const r = colab(fx, ['ship', '--branch', 'docs/decision-40', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /evidence-close/);

  assert.strictEqual(fs.existsSync(path.join(plansDir(fx), 'issue-40.md')), false, 'plan file should be deleted');
  const lines = journalLines(fx);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].issue, 40);
  assert.strictEqual(lines[0].verdict, 'pass');
});

test('evidence-close with NO plan file is still a silent no-op — rung-0 behaviour unchanged', () => {
  const fx = fixture();
  fx.g(fx.work, 'branch', 'docs/decision-41');
  colab(fx, ['claim', '41', '--branch', 'docs/decision-41', '--repo', fx.work]);

  const r = colab(fx, ['ship', '--branch', 'docs/decision-41', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(journalLines(fx).length, 0);
});

// --- #201: number-set membership, not exact-name reconstruction --------------------------------

test('#201: a group session\'s COMPOUND plan file is journalled (one line per issue) and deleted', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'fix/group-50-51');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: group work');
  fx.g(fx.work, 'checkout', '-q', 'main');
  colab(fx, ['claim', '50', '51', '--branch', 'fix/group-50-51', '--repo', fx.work]);
  writePlan(fx, 'issue-50-51.md', { rung: '2', cause: 'needs-plan' });

  const r = colab(fx, ['ship', '--branch', 'fix/group-50-51', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);

  assert.strictEqual(fs.existsSync(path.join(plansDir(fx), 'issue-50-51.md')), false,
    'the compound plan file must be collected — the pre-#201 exact-name lookup missed it entirely');
  const lines = journalLines(fx).sort((a, b) => a.issue - b.issue);
  assert.strictEqual(lines.length, 2, 'one journal line per issue in the file\'s set, not one per file');
  assert.deepStrictEqual(lines.map((l) => l.issue), [50, 51]);
  for (const l of lines) {
    assert.strictEqual(l.rung, '2');
    assert.strictEqual(l.cause, 'needs-plan');
    assert.strictEqual(l.verdict, 'pass');
  }
});

test('#201: a plan file naming an issue this session does NOT hold is left untouched — partial overlap refused', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'fix/solo-52');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: solo work');
  fx.g(fx.work, 'checkout', '-q', 'main');
  colab(fx, ['claim', '52', '--branch', 'fix/solo-52', '--repo', fx.work]);
  // This plan file names #52 (which this session DOES hold) AND #53 (which it does NOT) — a wider
  // group's file, or another session's. It must not be collected by this narrower ship.
  writePlan(fx, 'issue-52-53.md');

  const r = colab(fx, ['ship', '--branch', 'fix/solo-52', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);

  assert.strictEqual(fs.existsSync(path.join(plansDir(fx), 'issue-52-53.md')), true,
    'a partially-overlapping plan file must survive — it is not this session\'s to collect');
  assert.strictEqual(journalLines(fx).length, 0, 'nothing should be journalled for a file left untouched');
});

test('single-issue behaviour is unchanged: an exact issue-<N>.md file still journals and deletes', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'fix/single-60');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: single work');
  fx.g(fx.work, 'checkout', '-q', 'main');
  colab(fx, ['claim', '60', '--branch', 'fix/single-60', '--repo', fx.work]);
  writePlan(fx, 'issue-60.md');

  const r = colab(fx, ['ship', '--branch', 'fix/single-60', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(fs.existsSync(path.join(plansDir(fx), 'issue-60.md')), false);
  const lines = journalLines(fx);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].issue, 60);
});

// --- a failed journal append must leave the plan file in place — the chained-write oracle -------

test('a failed journal write leaves the plan file on disk, never deletes it with nothing to show for it', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'fix/single-61');
  fs.writeFileSync(path.join(fx.work, 'g.txt'), 'x\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'fix: single work');
  fx.g(fx.work, 'checkout', '-q', 'main');
  colab(fx, ['claim', '61', '--branch', 'fix/single-61', '--repo', fx.work]);
  writePlan(fx, 'issue-61.md');
  // A FILE (not a directory) sitting where `~/.colab/` needs to be — `mkdirSync(..., {recursive})`
  // throws on it, so the journal write fails before it ever opens the append stream. The ship
  // itself still succeeds (this is a deferred, non-fatal write failure, same posture as every other
  // post-merge write in B4); only the plan-file side effect is under test here.
  fs.writeFileSync(path.join(fx.home, '.colab'), 'blocking file, not a directory\n');

  const r = colab(fx, ['ship', '--branch', 'fix/single-61', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(fs.existsSync(path.join(plansDir(fx), 'issue-61.md')), true,
    'the plan file must survive a failed journal write, never be deleted with nothing journalled');
  assert.match(r.out, /could not journal\/delete the plan file/);
});
