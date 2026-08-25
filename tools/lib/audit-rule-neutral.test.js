'use strict';
/**
 * Tests for the audit's rule-neutral drift downgrade (audit/audit.mjs) — issue #272, ruling
 * option C. Same shape as `audit-ceremony.test.js`'s "item 3" block (a fake handbook checkout,
 * a target repo stamped at the old tag), except the downgrade here is triggered by a `Rule-
 * Neutral: yes` commit trailer the template's EDITOR wrote, not by the adopter's own
 * `ceremony:` setting — so these fixtures build the drifting commit's MESSAGE, not just its
 * content.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
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

/**
 * A throwaway handbook with two tagged versions of a CI workflow AND a non-CI template (the
 * CLAUDE conventions block). The v1→v2 commit is the one under test — its message is the one
 * thing each test varies.
 */
function fakeHandbook(commitMessage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-rule-neutral-hb-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'templates', 'ci-node.yml'), 'name: ci-node v1\n');
  fs.writeFileSync(path.join(dir, 'templates', 'repo-CLAUDE-block.md'), 'block v1\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: v1');
  g('tag', 'v1.0.0');
  fs.writeFileSync(path.join(dir, 'templates', 'ci-node.yml'), 'name: ci-node v1\n# a comment only\n');
  fs.writeFileSync(path.join(dir, 'templates', 'repo-CLAUDE-block.md'), 'block v1\n<!-- a comment only -->\n');
  g('add', '-A');
  g('commit', '-q', '-m', commitMessage);
  g('tag', 'v1.1.0');
  return dir;
}

function fixtureStampedAtV1() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-rule-neutral-target-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.github', 'project.yml'),
    'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n',
  );
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), '# colab-handbook: ci-node @ v1.0.0\nname: CI\n');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# hi\n<!-- colab-handbook @ v1.0.0 -->\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function auditWithHandbook(hbDir, targetDir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', targetDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, COLAB_HANDBOOK: hbDir },
    });
  } catch (err) {
    stdout = err.stdout || '';
  }
  const r = JSON.parse(stdout).results[0];
  return {
    ok: r.ok,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

test('a plain drift commit (no trailer) still fails on both the CI workflow and the CLAUDE block — the default is unaffected', () => {
  const hb = fakeHandbook('fix(templates): comment tweak');
  const r = auditWithHandbook(hb, fixtureStampedAtV1());
  assert.ok(hasText(r.fails, /ci\.yml copied @ v1\.0\.0 — template changed since/), r.fails.join(' | '));
  assert.ok(hasText(r.fails, /CLAUDE block copied @ v1\.0\.0 — template changed since/), r.fails.join(' | '));
});

test('Rule-Neutral: yes downgrades the CLAUDE-block (non-CI) drift to a warn, citing CONVENTIONS.md §8', () => {
  const hb = fakeHandbook('fix(templates): comment tweak\n\nRule-Neutral: yes');
  const r = auditWithHandbook(hb, fixtureStampedAtV1());
  assert.ok(!hasText(r.fails, /CLAUDE block copied/), `must NOT be a fail once declared: ${r.fails.join(' | ')}`);
  assert.ok(
    hasText(r.warns, /CLAUDE block copied @ v1\.0\.0 — template changed since.*declared rule-neutral at commit time — see CONVENTIONS\.md §8/),
    r.warns.join(' | '),
  );
});

test('Rule-Neutral: yes does NOT rescue a CI workflow — the same carve-out ceremony: light already respects', () => {
  const hb = fakeHandbook('fix(templates): comment tweak\n\nRule-Neutral: yes');
  const r = auditWithHandbook(hb, fixtureStampedAtV1());
  assert.ok(
    hasText(r.fails, /ci\.yml copied @ v1\.0\.0 — template changed since/),
    `CI drift must stay a fail even when declared: ${r.fails.join(' | ')}`,
  );
});

test('a differently-spelled trailer (not Rule-Neutral) is not read as a declaration — still a fail', () => {
  const hb = fakeHandbook('fix(templates): comment tweak\n\nRuleNeutral: yes');
  const r = auditWithHandbook(hb, fixtureStampedAtV1());
  assert.ok(hasText(r.fails, /CLAUDE block copied @ v1\.0\.0 — template changed since/), r.fails.join(' | '));
});
