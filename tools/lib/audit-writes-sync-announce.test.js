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
 * `v1.9.0` is used as the "old" ref for the same reason audit-adoption-window.test.js gives:
 * a real, resolvable tag in this repo's own history that predates the ruling (⚖ #233 landed
 * long after it, and remains untagged as of this test being written).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');
const OLD_REF = 'v1.9.0'; // predates ⚖ #233 in project.schema.md

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

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
  const r = audit(fixture({ projectYml: BASE, claudeStamp: OLD_REF }));
  assert.ok(hasText(r.warns, /writes is undeclared.*COEXISTENCE/s), r.warns.join(' | '));
  assert.strictEqual(r.ok, true, 'a warn must not flip ok to false');
});

test('old stamp, writes: isolated: the meaning-changed message, not the coexistence one', () => {
  const r = audit(fixture({ projectYml: BASE + 'writes: isolated\n', claudeStamp: OLD_REF }));
  assert.ok(hasText(r.warns, /writes: isolated changed meaning.*VETOES/s), r.warns.join(' | '));
  assert.ok(!hasText(r.warns, /writes is undeclared/), r.warns.join(' | '));
});

test('old stamp, writes: serial-direct: the inert/may-be-removed message', () => {
  const r = audit(fixture({ projectYml: BASE + 'writes: serial-direct\n', claudeStamp: OLD_REF }));
  assert.ok(hasText(r.warns, /writes: serial-direct is inert.*may be removed/s), r.warns.join(' | '));
});

test('old stamp, writes: serial (legacy alias): the same inert message, spelled as declared', () => {
  const r = audit(fixture({ projectYml: BASE + 'writes: serial\n', claudeStamp: OLD_REF }));
  assert.ok(hasText(r.warns, /writes: serial is inert.*may be removed/s), r.warns.join(' | '));
});

test('old stamp, writes: serial-gated: the moved-to-the-gating-axis message', () => {
  const r = audit(fixture({ projectYml: BASE + 'writes: serial-gated\n', claudeStamp: OLD_REF }));
  assert.ok(hasText(r.warns, /writes: serial-gated is inert.*axis that owns gating/s), r.warns.join(' | '));
});

// --- silence conditions --------------------------------------------------------

test('no CLAUDE.md at all: silent — nothing to compare a stamp against', () => {
  const r = audit(fixture({ projectYml: BASE }));
  assert.ok(!hasText(r.warns, /⚖ #233/), r.warns.join(' | '));
});

test('unresolvable stamp version: silent — same "look, do not assume" posture as elsewhere', () => {
  const r = audit(fixture({ projectYml: BASE, claudeStamp: 'v999.999.999' }));
  assert.ok(!hasText(r.warns, /⚖ #233/), r.warns.join(' | '));
});

test('a stamp naming a ref where the ruling already landed: silent — this repo already got told', () => {
  // Build a throwaway clone of the handbook and tag its current HEAD (which already carries
  // #237's landed text) with a synthetic version, so a real, resolvable "already knows" ref
  // exists to test against — mirrors audit-adoption-window.test.js's own clone-and-tag fixture,
  // and for the identical reason: no tag past #237 exists yet.
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-writes-sync-clone-'));
  TMP.push(clone);
  execFileSync('git', ['clone', '-q', '--no-hardlinks', REPO_ROOT, clone], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const schemaAtHead = execFileSync('git', ['-C', clone, 'show', 'HEAD:project.schema.md'], { encoding: 'utf8' });
  assert.ok(schemaAtHead.includes('two-state VETO'), 'expected the clone HEAD to already carry the ⚖ #233 ruling text');
  execFileSync('git', ['-C', clone, 'tag', 'v99.0.0', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const r = audit(fixture({ projectYml: BASE, claudeStamp: 'v99.0.0' }), clone);
  assert.ok(!hasText(r.warns, /⚖ #233/), r.warns.join(' | '));
});
