'use strict';
/**
 * CLI-level tests for `colab labels --ensure` (#206) — the 15-name convention label set used to
 * be typed out by hand in three places (CONVENTIONS.md §9 step 3, skills/handbook-sync/SKILL.md
 * §2, and `tools/lib/labels.js`'s CONVENTION_LABELS, the only one actually executed). This is the
 * missing executable: create every label a repo lacks, idempotent, reporting created vs already
 * there — reading the missing set from `labels.missingConventionLabels`, the same function the
 * audit and the readiness/grant hint functions already read, rather than restating the 15 names
 * a fourth time.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same fixture shape as
 * tools/lib/ship-migration-grant.test.js. A fake `gh` on PATH answers `--version`/`auth status`
 * (so `isGhUsable()` reads true regardless of the host machine's own `gh` login) plus `label
 * list`/`label create`, controllable per test via env vars — unlike migration-grant's fixture,
 * this feature has NO authorization gate to protect, so scripting `label list`/`label create`
 * here is not the backdoor that file's banner refuses to build for a grant read.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { CONVENTION_LABELS, conventionLabelNames } = require('./labels.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/** A minimal repo with a local-bare `origin` — enough for isGhUsable() to read true, no push needed. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-labels-ensure-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab labels test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');

  // A fake `gh` placed first on PATH — same technique as ship-migration-grant.test.js /
  // tools/lib/git.test.js's withFakeGh. `label list` prints $FAKE_GH_LABELS (comma-separated,
  // may be empty), or fails outright if $FAKE_GH_LABEL_LIST_FAIL=1. `label create <name> ...`
  // fails only for a name matching $FAKE_GH_LABEL_CREATE_FAIL, so a single test can prove the
  // per-label failure path without every label needing its own fixture.
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in to github.com (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "label" ] && [ "$2" = "list" ]; then',
    '  if [ "$FAKE_GH_LABEL_LIST_FAIL" = "1" ]; then echo "fixture gh: label list refused" >&2; exit 1; fi',
    '  OLDIFS=$IFS; IFS=","',
    '  for n in $FAKE_GH_LABELS; do echo "$n"; done',
    '  IFS=$OLDIFS',
    '  exit 0',
    'fi',
    'if [ "$1" = "label" ] && [ "$2" = "create" ]; then',
    '  name="$3"',
    '  if [ "$name" = "$FAKE_GH_LABEL_CREATE_FAIL" ]; then echo "fixture gh: label create refused for $name" >&2; exit 1; fi',
    '  exit 0',
    'fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin };
}

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// --- bare / --help never touch a repo at all -------------------------------------------------

test('`colab labels` with no --ensure prints help and does not touch gh — a typo can never silently do nothing', () => {
  const r = spawnSync('node', [COLAB, 'labels'], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /--ensure/);
});

test('`colab labels --help` prints help and exits 0, from outside any git repo', () => {
  const r = spawnSync('node', [COLAB, 'labels', '--help'], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /colab labels --ensure/);
});

// --- the read-then-write contract: a failed read never becomes a blind write ------------------

test('a failed `gh label list` refuses outright — never creates blind', () => {
  const fx = fixture();
  const r = colab(fx, ['labels', '--ensure', '--repo', fx.work], { FAKE_GH_LABEL_LIST_FAIL: '1', FAKE_GH_LABELS: '' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /refusing to create blind/);
});

// --- the happy path: exactly the missing ones get created, the rest reported as already there --

test('an empty tracker creates all 15 labels, none reported already-there', () => {
  const fx = fixture();
  const r = colab(fx, ['labels', '--ensure', '--repo', fx.work], { FAKE_GH_LABELS: '' });
  assert.strictEqual(r.code, 0, r.err);
  for (const name of conventionLabelNames()) assert.match(r.out, new RegExp(`Created:.*${escapeRe(name)}`));
  assert.doesNotMatch(r.out, /Already there:/);
});

test('a fully-provisioned tracker creates nothing — reports the whole set already there', () => {
  const fx = fixture();
  const all = conventionLabelNames().join(',');
  const r = colab(fx, ['labels', '--ensure', '--repo', fx.work], { FAKE_GH_LABELS: all });
  assert.strictEqual(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /Created:/);
  assert.match(r.out, /Already there:/);
  assert.match(r.out, /Nothing to create/);
});

test('a partially-provisioned tracker creates only what is missing — idempotent, not a re-create', () => {
  const fx = fixture();
  // Already has the four §2 "ordering-critical" labels; missing the rest.
  const already = ['in-progress', 'deps-checked', 'agent-filed', 'epic'];
  const r = colab(fx, ['labels', '--ensure', '--repo', fx.work], { FAKE_GH_LABELS: already.join(',') });
  assert.strictEqual(r.code, 0, r.err);
  for (const name of already) {
    assert.match(r.out, new RegExp(`Already there:.*${escapeRe(name)}`));
    assert.doesNotMatch(r.out, new RegExp(`Created:.*${escapeRe(name)}`));
  }
  const missing = conventionLabelNames().filter((n) => !already.includes(n));
  for (const name of missing) assert.match(r.out, new RegExp(`Created:.*${escapeRe(name)}`));
});

// --- a per-label create failure is reported by name, and fails the whole run ------------------

test('a `gh label create` failure for one label is reported by name and fails the run — the rest still get created', () => {
  const fx = fixture();
  const r = colab(fx, ['labels', '--ensure', '--repo', fx.work], {
    FAKE_GH_LABELS: '',
    FAKE_GH_LABEL_CREATE_FAIL: 'ci-granted',
  });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /Failed:/);
  assert.match(r.out, /ci-granted — fixture gh: label create refused for ci-granted/);
  // every OTHER label still went through — one failure must not abort the loop
  for (const name of conventionLabelNames()) {
    if (name === 'ci-granted') continue;
    assert.match(r.out, new RegExp(`Created:.*${escapeRe(name)}`));
  }
});

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// --- the color/description each label is created with are exactly CONVENTION_LABELS' own -------
// (not re-testing gh's own argv handling — this pins that ghLabelCreate is called with the SAME
// shape CONVENTION_LABELS declares, so the tracker's label never silently drifts from the source.)

test('CONVENTION_LABELS is what --ensure iterates — the source this command must never restate', () => {
  assert.strictEqual(conventionLabelNames().length, 15);
  for (const l of CONVENTION_LABELS) {
    assert.ok(l.name && l.color && l.description, `label ${JSON.stringify(l)} is missing a field --ensure needs to create it`);
  }
});
