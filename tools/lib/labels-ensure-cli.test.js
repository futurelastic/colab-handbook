'use strict';
/**
 * CLI-level tests for `colab labels --ensure` (#206) — the 19-name convention label set (16
 * until `deferred:date` / `deferred:measurement` / `deferred:external-party` joined it in #279;
 * 15 until `delivery:elsewhere` joined it in #274) used to be typed out by hand in three places
 * (CONVENTIONS.md §9 step 3, skills/handbook-sync/SKILL.md §2, and `tools/lib/labels.js`'s
 * CONVENTION_LABELS, the only one actually executed). This is the missing executable: create
 * every label a repo lacks, idempotent, reporting created vs already there — reading the missing
 * set from `labels.missingConventionLabels`, the same function the audit and the readiness/grant
 * hint functions already read, rather than restating the names a fourth time.
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
    // #364: --ensure reads names AND descriptions (`--json name,description`); the colab() helper
    // below always supplies the JSON form, derived from FAKE_GH_LABELS unless a test sets it.
    '  case "$*" in *description*) printf "%s\\n" "$FAKE_GH_LABELS_JSON"; exit 0;; esac',
    '  OLDIFS=$IFS; IFS=","',
    '  for n in $FAKE_GH_LABELS; do echo "$n"; done',
    '  IFS=$OLDIFS',
    '  exit 0',
    'fi',
    'if [ "$1" = "label" ] && [ "$2" = "edit" ]; then',
    '  name="$3"',
    '  if [ "$name" = "$FAKE_GH_LABEL_EDIT_FAIL" ]; then echo "fixture gh: label edit refused for $name" >&2; exit 1; fi',
    '  shift 3; printf "%s\\t%s\\n" "$name" "$*" >> "$FAKE_GH_EDIT_LOG"',
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

// FAKE_GH_LABELS (names) is turned into the JSON `label list --json name,description` answers
// with, each carrying the HANDBOOK's description — so a test that only names labels still means
// "provisioned exactly as the handbook says". A test about drift passes FAKE_GH_LABELS_JSON itself.
// Every `label edit` is appended to <root>/edits.log, read back with edits(fx).
function colab(fx, args, extraEnv = {}) {
  const want = new Map(CONVENTION_LABELS.map((l) => [l.name, l.description]));
  const names = String(extraEnv.FAKE_GH_LABELS || '').split(',').filter(Boolean);
  const json = JSON.stringify(names.map((name) => ({ name, description: want.get(name) || '' })));
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '',
      FAKE_GH_LABELS_JSON: json, FAKE_GH_EDIT_LOG: path.join(fx.root, 'edits.log'), ...extraEnv,
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function edits(fx) {
  const f = path.join(fx.root, 'edits.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
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

// #274: the set's size was independently restated as a hand-typed prose number in (at least)
// CONVENTIONS.md §5 ("Four labels" — now "Five"), CONVENTIONS.md §9 step 3 ("fifteen names" — now
// "sixteen"), and skills/handbook-sync/SKILL.md ("fifteen-name set" — now "sixteen-name"), on top
// of the literal pinned here. None of those four is checkable against the others, so adding
// `delivery:elsewhere` here silently left three of them wrong until this issue found it by hand.
// #279 repeated the exact same pattern moving 16 -> 19 (three `deferred:*` labels, Disposition):
// CONVENTIONS.md §9 step 3 count, and skills/handbook-sync/SKILL.md's "sixteen-name set", plus
// this literal. #339 moved 19 -> 20 (`release-hold`) and moved the same sites together.
// This assertion cannot make prose self-updating, but it is the one count a CI run
// actually exercises — if you bump CONVENTION_LABELS.length again, this fails LOUDLY, and that
// failure is the reminder to grep the prose sites above and move them all together.
test('CONVENTION_LABELS is what --ensure iterates — the source this command must never restate', () => {
  assert.strictEqual(conventionLabelNames().length, 20,
    'label count changed — also update the prose counts in CONVENTIONS.md §5/§9 and skills/handbook-sync/SKILL.md');
  for (const l of CONVENTION_LABELS) {
    assert.ok(l.name && l.color && l.description, `label ${JSON.stringify(l)} is missing a field --ensure needs to create it`);
  }
});

// --- #364: a reworded convention description is reported, and refreshed only on request -------

/** Every convention label present, with the handbook's text except for the `drift` overrides. */
function trackerJson(drift) {
  return JSON.stringify(CONVENTION_LABELS.map((l) => ({
    name: l.name, description: Object.prototype.hasOwnProperty.call(drift, l.name) ? drift[l.name] : l.description,
  })).concat([{ name: 'bug', description: 'a label outside the set, never compared' }]));
}

const OLD = {
  'needs-decision': 'Awaiting a maintainer ruling — blocks the issues wired blocked-by it',
  'migration-granted': "Human-granted, per-issue exemption to ship's no-new-migrations precondition (#98)",
};

test('#364: without --refresh-descriptions a drifted description is REPORTED by name with both texts, never rewritten, exit 0', () => {
  const fx = fixture();
  const r = colab(fx, ['labels', '--ensure', '--repo', fx.work], { FAKE_GH_LABELS_JSON: trackerJson(OLD) });
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /Description differs from the handbook's:/);
  for (const [name, old] of Object.entries(OLD)) {
    assert.match(r.out, new RegExp(`^  ${escapeRe(name)}$`, 'm'));
    assert.ok(r.out.includes(`tracker:  ${JSON.stringify(old)}`), `old text of ${name} shown`);
    const want = CONVENTION_LABELS.find((l) => l.name === name).description;
    assert.ok(r.out.includes(`handbook: ${JSON.stringify(want)}`), `handbook text of ${name} shown`);
  }
  assert.doesNotMatch(r.out, /^  epic$/m, 'a label already matching is not listed');
  assert.doesNotMatch(r.out, /bug/, 'a label outside the convention set is never compared');
  assert.match(r.out, /--refresh-descriptions/);
  assert.deepStrictEqual(edits(fx), [], 'report-only: no gh label edit ran');
});

test('#364: a tracker whose descriptions all match reports no difference', () => {
  const fx = fixture();
  const r = colab(fx, ['labels', '--ensure', '--repo', fx.work], { FAKE_GH_LABELS_JSON: trackerJson({}) });
  assert.strictEqual(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /Description differs/);
  assert.deepStrictEqual(edits(fx), []);
});

test('#364: --refresh-descriptions rewrites exactly the drifted labels to the handbook text — description only, never colour', () => {
  const fx = fixture();
  const r = colab(fx, ['labels', '--ensure', '--refresh-descriptions', '--repo', fx.work], { FAKE_GH_LABELS_JSON: trackerJson(OLD) });
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /Description refreshed: needs-decision, migration-granted/);
  assert.doesNotMatch(r.out, /Description differs/);
  const want = (n) => CONVENTION_LABELS.find((l) => l.name === n).description;
  assert.deepStrictEqual(edits(fx), [
    `needs-decision\t--description ${want('needs-decision')}`,
    `migration-granted\t--description ${want('migration-granted')}`,
  ]);
});

test('#364: --keep leaves a declared divergence alone and still reports it; the rest are refreshed', () => {
  const fx = fixture();
  const r = colab(fx, ['labels', '--ensure', '--refresh-descriptions', '--keep', 'needs-decision', '--repo', fx.work],
    { FAKE_GH_LABELS_JSON: trackerJson(OLD) });
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /Description refreshed: migration-granted/);
  assert.match(r.out, /Description differs from the handbook's \(kept by --keep\):\n  needs-decision\n/);
  assert.deepStrictEqual(edits(fx).map((l) => l.split('\t')[0]), ['migration-granted']);
});

test('#364: a failed `gh label edit` is reported by name and fails the run; the other refresh still lands', () => {
  const fx = fixture();
  const r = colab(fx, ['labels', '--ensure', '--refresh-descriptions', '--repo', fx.work],
    { FAKE_GH_LABELS_JSON: trackerJson(OLD), FAKE_GH_LABEL_EDIT_FAIL: 'needs-decision' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out, /needs-decision — fixture gh: label edit refused for needs-decision/);
  assert.match(r.out, /Description refreshed: migration-granted/);
});

test('#364: a created label is never also "refreshed" — creation already writes the handbook text', () => {
  const fx = fixture();
  const r = colab(fx, ['labels', '--ensure', '--refresh-descriptions', '--repo', fx.work], { FAKE_GH_LABELS: '' });
  assert.strictEqual(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /Description refreshed/);
  assert.deepStrictEqual(edits(fx), []);
});

test('#364: --keep without --refresh-descriptions, or naming a non-convention label, is refused before any gh call', () => {
  const fx = fixture();
  const a = colab(fx, ['labels', '--ensure', '--keep', 'needs-decision', '--repo', fx.work], { FAKE_GH_LABELS_JSON: trackerJson(OLD) });
  assert.notStrictEqual(a.code, 0);
  assert.match(a.err, /--keep only means something with --refresh-descriptions/);
  const b = colab(fx, ['labels', '--ensure', '--refresh-descriptions', '--keep', 'bug', '--repo', fx.work], { FAKE_GH_LABELS_JSON: trackerJson(OLD) });
  assert.notStrictEqual(b.code, 0);
  assert.match(b.err, /outside the convention set: bug/);
  assert.deepStrictEqual(edits(fx), []);
});
