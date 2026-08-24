'use strict';
/**
 * Tests for the ⚖ #233 sync announcement (#239) — `tools/lib/stamp.js`'s
 * `writesRulingKnownAt`, wired into `audit/audit.mjs`'s CLAUDE-stamp block, and
 * `tools/lib/writes-authority.js`'s `writesSyncAdvisory`.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Same fixture shape as `audit-adoption-window.test.js` (#138), on purpose: this is the
 * identical "does this repo's marker predate a change project.schema.md now describes"
 * question, just keyed on the ruling's own landed text instead of a missing heading — see
 * `writesRulingKnownAt`'s docstring in stamp.js for why a version number was NOT hand-picked
 * the way `AUTHORITY_FLIP_VERSION` was for #144's flip.
 *
 * #271: most tests below run against a SYNTHETIC throwaway handbook
 * (`buildSyntheticHandbook`), not the real one at REPO_ROOT — for the identical reason
 * `audit-adoption-window.test.js` gives: `checkStamps` also runs `compareStamp`'s
 * template-drift scan off the same CLAUDE.md stamp, and that scan's range is
 * `stampVersion..HEAD` of whatever handbook root it's given. Pointing it at the real,
 * live-evolving REPO_ROOT let an unrelated future edit to templates/repo-CLAUDE-block.md
 * add a `fail` and flip `ok` to false out from under these tests (measured: `49d47a4`, a
 * one-line link fix, did exactly this). The synthetic handbook's two commits hold that
 * template file byte-identical by construction, so the drift check reports `changed:
 * false` forever, regardless of what the real template goes on to do.
 *
 * The one test that intentionally keeps using the real handbook — "a stamp naming a ref
 * where the ruling already landed" — clones REPO_ROOT and tags its OWN HEAD, so its stamp
 * and its "current" version are the same commit; that check's range is always empty,
 * immune to drift by construction, and it is checking a real fact (that #237 has actually
 * landed), so it stays.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// A project.schema.md carrying none of the ⚖ #233 ruling's landed vocabulary — stands in
// for "the handbook as it was before #237 landed".
const SYNTH_SCHEMA_OLD = [
  '# project.schema.md (synthetic fixture — see audit-writes-sync-announce.test.js #271)',
  '',
  '### `tier`',
  'OPTIONAL, legacy.',
  '',
  '### `trunk`',
  'REQUIRED.',
  '',
  '### `writes`',
  'OPTIONAL. isolated (the veto) | serial-direct | serial-gated.',
  '',
].join('\n');

// Same file, with the ⚖ #233 ruling's own text (`WRITES_VETO_MARKER` in stamp.js) added —
// stands in for "the handbook as it is once #237 has landed". templates/repo-CLAUDE-block.md
// is deliberately NOT rewritten between the two commits below — see buildSyntheticHandbook.
const SYNTH_SCHEMA_NEW = [
  '# project.schema.md (synthetic fixture — see audit-writes-sync-announce.test.js #271)',
  '',
  '### `tier`',
  'OPTIONAL, legacy.',
  '',
  '### `trunk`',
  'REQUIRED.',
  '',
  '### `writes`',
  'OPTIONAL. ⚖ #233: stopped selecting a write-conflict prevention METHOD, became a',
  'two-state VETO — isolated forbids trunk-direct outright; every other value is inert.',
  '',
].join('\n');

const SYNTH_TEMPLATE = '# repo-CLAUDE-block.md (synthetic fixture, held constant — #271)\n';

const SYNTH_OLD_TAG = 'v1.0.0';
const SYNTH_NEW_TAG = 'v2.0.0';

/**
 * A throwaway two-commit, two-tag git repo standing in for the handbook, entirely
 * decoupled from this repo's own history: `SYNTH_OLD_TAG`'s project.schema.md predates
 * the ⚖ #233 ruling text, `SYNTH_NEW_TAG`'s carries it — and templates/repo-CLAUDE-block.md
 * is written ONCE and never touched again, so no commit in this synthetic history ever
 * shows up in a `templates/repo-CLAUDE-block.md` drift scan between the two tags. Built
 * once per test run and reused (git init + two commits is cheap, but no need to repeat).
 */
let _synthHandbook;
function syntheticHandbook() {
  if (_synthHandbook) return _synthHandbook;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-writes-sync-synth-hb-'));
  TMP.push(root);
  const g = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  fs.mkdirSync(path.join(root, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(root, 'templates', 'repo-CLAUDE-block.md'), SYNTH_TEMPLATE);
  fs.writeFileSync(path.join(root, 'project.schema.md'), SYNTH_SCHEMA_OLD);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: pre-#233-ruling handbook state');
  g('tag', SYNTH_OLD_TAG);
  fs.writeFileSync(path.join(root, 'project.schema.md'), SYNTH_SCHEMA_NEW);
  // templates/repo-CLAUDE-block.md intentionally NOT rewritten here — see docstring above.
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: ⚖ #233 ruling lands');
  g('tag', SYNTH_NEW_TAG);
  _synthHandbook = root;
  return root;
}

function fixture({ projectYml, claudeStamp }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-writes-sync-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  if (claudeStamp !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'CLAUDE.md'),
      `# CLAUDE.md\n\n<!-- colab-handbook @ ${claudeStamp} -->\nYou are working in a repo that follows the colab-handbook conventions.\n`,
    );
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function audit(dir, handbookRoot = REPO_ROOT) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, COLAB_HANDBOOK: handbookRoot },
    });
  } catch (err) {
    stdout = err.stdout || '';
  }
  const r = JSON.parse(stdout).results[0];
  return {
    ok: r.ok,
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

const BASE = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

// --- old stamp: the four tailored messages ------------------------------------

test('old stamp, writes undeclared: the coexistence-default message, never a fail', () => {
  const r = audit(fixture({ projectYml: BASE, claudeStamp: SYNTH_OLD_TAG }), syntheticHandbook());
  assert.ok(hasText(r.warns, /writes is undeclared.*COEXISTENCE/s), r.warns.join(' | '));
  assert.strictEqual(r.ok, true, 'a warn must not flip ok to false');
});

test('old stamp, writes: isolated: the meaning-changed message, not the coexistence one', () => {
  const r = audit(fixture({ projectYml: BASE + 'writes: isolated\n', claudeStamp: SYNTH_OLD_TAG }), syntheticHandbook());
  assert.ok(hasText(r.warns, /writes: isolated changed meaning.*VETOES/s), r.warns.join(' | '));
  assert.ok(!hasText(r.warns, /writes is undeclared/), r.warns.join(' | '));
});

test('old stamp, writes: serial-direct: the inert/may-be-removed message', () => {
  const r = audit(fixture({ projectYml: BASE + 'writes: serial-direct\n', claudeStamp: SYNTH_OLD_TAG }), syntheticHandbook());
  assert.ok(hasText(r.warns, /writes: serial-direct is inert.*may be removed/s), r.warns.join(' | '));
});

test('old stamp, writes: serial (legacy alias): the same inert message, spelled as declared', () => {
  const r = audit(fixture({ projectYml: BASE + 'writes: serial\n', claudeStamp: SYNTH_OLD_TAG }), syntheticHandbook());
  assert.ok(hasText(r.warns, /writes: serial is inert.*may be removed/s), r.warns.join(' | '));
});

test('old stamp, writes: serial-gated: the moved-to-the-gating-axis message', () => {
  const r = audit(fixture({ projectYml: BASE + 'writes: serial-gated\n', claudeStamp: SYNTH_OLD_TAG }), syntheticHandbook());
  assert.ok(hasText(r.warns, /writes: serial-gated is inert.*axis that owns gating/s), r.warns.join(' | '));
});

// --- silence conditions --------------------------------------------------------

test('no CLAUDE.md at all: silent — nothing to compare a stamp against', () => {
  const r = audit(fixture({ projectYml: BASE }), syntheticHandbook());
  assert.ok(!hasText(r.warns, /⚖ #233/), r.warns.join(' | '));
});

test('unresolvable stamp version: silent — same "look, do not assume" posture as elsewhere', () => {
  const r = audit(fixture({ projectYml: BASE, claudeStamp: 'v999.999.999' }), syntheticHandbook());
  assert.ok(!hasText(r.warns, /⚖ #233/), r.warns.join(' | '));
});

test('a stamp naming a ref where the ruling already landed: silent — this repo already got told', () => {
  // This is the one test in this file that intentionally checks the REAL handbook — has
  // #237 actually landed on it? — rather than the synthetic one above. It clones REPO_ROOT
  // and tags its OWN HEAD, so the stamp version and "current" version resolve to the same
  // commit: templateChangedSince's range is always empty regardless of what the real
  // template has done since, so this stays immune to the #271 drift bug by construction —
  // no synthetic handbook needed here.
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-writes-sync-clone-'));
  TMP.push(clone);
  execFileSync('git', ['clone', '-q', '--no-hardlinks', REPO_ROOT, clone], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const schemaAtHead = execFileSync('git', ['-C', clone, 'show', 'HEAD:project.schema.md'], { encoding: 'utf8' });
  assert.ok(schemaAtHead.includes('two-state VETO'), 'expected the clone HEAD to already carry the ⚖ #233 ruling text');
  execFileSync('git', ['-C', clone, 'tag', 'v99.0.0', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const r = audit(fixture({ projectYml: BASE, claudeStamp: 'v99.0.0' }), clone);
  assert.ok(!hasText(r.warns, /⚖ #233/), r.warns.join(' | '));
});
