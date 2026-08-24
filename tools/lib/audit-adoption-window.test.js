'use strict';
/**
 * Tests for the adoption compatibility window (#138) — an old descriptor must report as
 * PREDATING this version, never as broken.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The mechanism reuses the stamp machinery already in tools/lib/stamp.js
 * (`axesPredating`) rather than inventing a new one: a repo's CLAUDE.md stamp names a
 * handbook version; if `project.schema.md` at THAT version did not yet document a given
 * axis (room/exposure/writes/channels), a missing axis on that repo is not an omission to
 * nag about (every other check already treats undeclared axes as silent, by design — see
 * audit-exposure.test.js / audit-writes.test.js / audit-channels.test.js) — it is a repo
 * whose marker predates the question. That earns exactly ONE `warn`, never a `fail`.
 *
 * #271: most tests below run against a SYNTHETIC throwaway handbook
 * (`buildSyntheticHandbook`), not the real one at REPO_ROOT. Reason: `checkStamps` runs
 * two independent checks off one CLAUDE.md stamp — the axis-predates read this file
 * exercises (a pure content read AT a fixed historical ref, permanently stable) and
 * `compareStamp`'s template-drift check (a commit-range scan from that stamp to the
 * handbook's *current* HEAD). Pointing the second check at the real, live-evolving
 * REPO_ROOT meant any future edit to templates/repo-CLAUDE-block.md — however trivial —
 * added an unrelated `fail` and could flip `ok` to false out from under these tests
 * (measured: `49d47a4`, a one-line link fix, did exactly this). The synthetic handbook's
 * two commits hold that template file byte-identical by construction, so the drift check
 * reports `changed: false` forever, regardless of what the real template goes on to do.
 *
 * The one test that intentionally keeps using the real handbook — "current stamp … " —
 * clones REPO_ROOT and tags its OWN HEAD, so its stamp and its "current" version are the
 * same commit; that check's range is always empty, immune to drift by construction, and
 * it is checking a real fact (that the axis commits have actually landed), so it stays.
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

// A project.schema.md with none of the four axis headings and no writes-ruling text —
// stands in for "the handbook as it was before #131/#132/#133/#151 landed".
const SYNTH_SCHEMA_OLD = [
  '# project.schema.md (synthetic fixture — see audit-adoption-window.test.js #271)',
  '',
  '### `tier`',
  'OPTIONAL, legacy.',
  '',
  '### `trunk`',
  'REQUIRED.',
  '',
].join('\n');

// Same file, with the four axis headings added — stands in for "the handbook as it is
// once the axis model has landed". templates/repo-CLAUDE-block.md is deliberately NOT
// rewritten between the two commits below — see buildSyntheticHandbook.
const SYNTH_SCHEMA_NEW = SYNTH_SCHEMA_OLD + [
  '### `room`',
  'OPTIONAL.',
  '',
  '### `exposure`',
  'OPTIONAL.',
  '',
  '### `writes`',
  'OPTIONAL.',
  '',
  '### `channels`',
  'OPTIONAL.',
  '',
].join('\n');

const SYNTH_TEMPLATE = '# repo-CLAUDE-block.md (synthetic fixture, held constant — #271)\n';

const SYNTH_OLD_TAG = 'v1.0.0';
const SYNTH_NEW_TAG = 'v2.0.0';

/**
 * A throwaway two-commit, two-tag git repo standing in for the handbook, entirely
 * decoupled from this repo's own history: `SYNTH_OLD_TAG`'s project.schema.md predates
 * the axis model, `SYNTH_NEW_TAG`'s carries it — and templates/repo-CLAUDE-block.md is
 * written ONCE and never touched again, so no commit in this synthetic history ever
 * shows up in a `templates/repo-CLAUDE-block.md` drift scan between the two tags. Built
 * once per test run and reused (git init + two commits is cheap, but no need to repeat).
 */
let _synthHandbook;
function syntheticHandbook() {
  if (_synthHandbook) return _synthHandbook;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-adoption-window-synth-hb-'));
  TMP.push(root);
  const g = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  fs.mkdirSync(path.join(root, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(root, 'templates', 'repo-CLAUDE-block.md'), SYNTH_TEMPLATE);
  fs.writeFileSync(path.join(root, 'project.schema.md'), SYNTH_SCHEMA_OLD);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: pre-axis-model handbook state');
  g('tag', SYNTH_OLD_TAG);
  fs.writeFileSync(path.join(root, 'project.schema.md'), SYNTH_SCHEMA_NEW);
  // templates/repo-CLAUDE-block.md intentionally NOT rewritten here — see docstring above.
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: axis model lands');
  g('tag', SYNTH_NEW_TAG);
  _synthHandbook = root;
  return root;
}

function fixture({ projectYml, claudeStamp }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-adoption-window-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  if (claudeStamp !== undefined) {
    // Mirror templates/repo-CLAUDE-block.md's stamp line closely enough for
    // looksLikeHandbookClaude to recognise it as a handbook-derived block when a stamp is
    // deliberately withheld (not exercised by this file, but kept honest for future tests).
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
    predatesAxes: r.predatesAxes,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

const NO_AXES_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const ALL_AXES_YML =
  'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n' +
  'room: solo\nexposure: self\nwrites: isolated\nchannels: [none]\n';

test('old stamp + no axes declared: exactly one warn naming the missing axes, zero new fails', () => {
  const r = audit(fixture({ projectYml: NO_AXES_YML, claudeStamp: SYNTH_OLD_TAG }), syntheticHandbook());
  assert.ok(!hasText(r.fails, /predates|axis/i), r.fails.join(' | '));
  assert.ok(hasText(r.warns, /marker predates the axis model/), r.warns.join(' | '));
  assert.ok(hasText(r.warns, /room/), r.warns.join(' | '));
  assert.ok(hasText(r.warns, /exposure/), r.warns.join(' | '));
  assert.ok(hasText(r.warns, /writes/), r.warns.join(' | '));
  assert.ok(hasText(r.warns, /channels/), r.warns.join(' | '));
  assert.deepStrictEqual([...r.predatesAxes].sort(), ['channels', 'exposure', 'room', 'writes']);
  assert.strictEqual(r.ok, true, 'a warn must not flip ok to false');
});

test('old stamp + all axes declared: silent — declaring closed the gap, nothing to warn about', () => {
  const r = audit(fixture({ projectYml: ALL_AXES_YML, claudeStamp: SYNTH_OLD_TAG }), syntheticHandbook());
  assert.ok(!hasText(r.warns, /predates the axis model/), r.warns.join(' | '));
  assert.deepStrictEqual(r.predatesAxes, []);
});

test('current stamp (a ref where all four axes already exist) + no axes declared: silent — undeclared stays legal and un-nagged, this is not a NEW finding', () => {
  // This is the one test in this file that intentionally checks the REAL handbook — is the
  // axis model actually landed on it? — rather than the synthetic one above. It clones
  // REPO_ROOT and tags its OWN HEAD, so the stamp version and "current" version resolve to
  // the same commit: templateChangedSince's range is always empty regardless of what the
  // real template has done since, so this stays immune to the #271 drift bug by
  // construction — no synthetic handbook needed here.
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-adoption-window-clone-'));
  TMP.push(clone);
  execFileSync('git', ['clone', '-q', '--no-hardlinks', REPO_ROOT, clone], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const schemaAtHead = execFileSync('git', ['-C', clone, 'show', 'HEAD:project.schema.md'], { encoding: 'utf8' });
  for (const axis of ['room', 'exposure', 'writes', 'channels']) {
    assert.ok(new RegExp('^###\\s+`' + axis + '`', 'm').test(schemaAtHead), `expected the clone's HEAD project.schema.md to already document ${axis}`);
  }
  execFileSync('git', ['-C', clone, 'tag', 'v99.0.0', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const r2 = audit(fixture({ projectYml: NO_AXES_YML, claudeStamp: 'v99.0.0' }), clone);
  assert.ok(!hasText(r2.warns, /predates the axis model/), r2.warns.join(' | '));
  assert.deepStrictEqual(r2.predatesAxes, []);
});

test('unresolvable stamp version: silent — same "look, do not assume" posture as an unfetched stamp elsewhere', () => {
  const r = audit(fixture({ projectYml: NO_AXES_YML, claudeStamp: 'v999.999.999' }), syntheticHandbook());
  assert.ok(!hasText(r.warns, /predates the axis model/), r.warns.join(' | '));
  assert.deepStrictEqual(r.predatesAxes, []);
});

test('no CLAUDE.md at all: silent — nothing to compare a stamp against, existing "no stamp" advisories are unaffected', () => {
  const r = audit(fixture({ projectYml: NO_AXES_YML }), syntheticHandbook());
  assert.ok(!hasText(r.warns, /predates the axis model/), r.warns.join(' | '));
  assert.deepStrictEqual(r.predatesAxes, []);
});

test('this check never becomes a fail and never touches a tier finding', () => {
  const r = audit(fixture({ projectYml: NO_AXES_YML, claudeStamp: SYNTH_OLD_TAG }), syntheticHandbook());
  assert.ok(!hasText(r.fails, /tier/i), r.fails.join(' | '));
});
