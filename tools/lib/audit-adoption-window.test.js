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
 * `v1.9.0` is used as the "old" ref throughout: it is a real, resolvable tag in this
 * repo's own history, and all four axis commits (room/exposure/writes/channels) landed
 * AFTER it and remain untagged as of this test being written (#138's plan file records
 * this as a known, deliberate fixture choice — there is no later tag to use instead yet).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');
const OLD_REF = 'v1.9.0'; // predates room/exposure/writes/channels in project.schema.md

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

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
  const r = audit(fixture({ projectYml: NO_AXES_YML, claudeStamp: OLD_REF }));
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
  const r = audit(fixture({ projectYml: ALL_AXES_YML, claudeStamp: OLD_REF }));
  assert.ok(!hasText(r.warns, /predates the axis model/), r.warns.join(' | '));
  assert.deepStrictEqual(r.predatesAxes, []);
});

test('current stamp (a ref where all four axes already exist) + no axes declared: silent — undeclared stays legal and un-nagged, this is not a NEW finding', () => {
  // No tag exists yet AFTER the four axis commits (they are all untagged past v1.9.0, per
  // this unit's own plan file) — `git describe --tags` on HEAD still resolves to v1.9.0,
  // the very ref this file uses as "old", and `parseClaudeStamp`'s regex requires a
  // version starting with a digit or "v", so a bare commit SHA cannot be used as the
  // stamp text either. So this test builds its OWN throwaway clone of the handbook and
  // tags its current HEAD (which already carries all four axis commits — verified below
  // rather than assumed) with a synthetic version past v1.9.0, purely so a real, digit-
  // prefixed, resolvable "current" ref exists to test against. Nothing here mutates the
  // real repo's tags.
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
  const r = audit(fixture({ projectYml: NO_AXES_YML, claudeStamp: 'v999.999.999' }));
  assert.ok(!hasText(r.warns, /predates the axis model/), r.warns.join(' | '));
  assert.deepStrictEqual(r.predatesAxes, []);
});

test('no CLAUDE.md at all: silent — nothing to compare a stamp against, existing "no stamp" advisories are unaffected', () => {
  const r = audit(fixture({ projectYml: NO_AXES_YML }));
  assert.ok(!hasText(r.warns, /predates the axis model/), r.warns.join(' | '));
  assert.deepStrictEqual(r.predatesAxes, []);
});

test('this check never becomes a fail and never touches a tier finding', () => {
  const r = audit(fixture({ projectYml: NO_AXES_YML, claudeStamp: OLD_REF }));
  assert.ok(!hasText(r.fails, /tier/i), r.fails.join(' | '));
});
