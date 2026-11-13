'use strict';
/**
 * #736: the audit's `release-only-checks:` key (audit/audit.mjs). Absent is clean and reported as null;
 * a valid map is clean and reported; anything else fails — the reader ignores an invalid declaration,
 * so it exempts nothing, and only the audit can say so. The audit's own flat YAML reader accepts this
 * one map with free-text keys and inline-list values; a block list under it is a finding.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const AUDIT = path.join(path.resolve(__dirname, '..', '..'), 'audit', 'audit.mjs');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture(projectYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-release-only-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function audit(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) { stdout = err.stdout || ''; }
  const r = JSON.parse(stdout).results[0];
  return {
    v: r.releaseOnlyChecks,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text).filter((t) => /release-only-checks/.test(t)),
  };
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';

test('#736 absent → null, no finding', () => {
  const r = audit(fixture(BASE));
  assert.strictEqual(r.v, null);
  assert.deepStrictEqual(r.fails, []);
});

test('#736 a whole workflow and a quoted workflow / job → reported, no finding', () => {
  const r = audit(fixture(BASE + 'release-only-checks:\n  Install smoke: [packaging/, scripts/install.sh]\n  "CI / install (*)": [installer/**]\n'));
  assert.deepStrictEqual(r.fails, []);
  assert.deepStrictEqual(r.v, [
    { check: 'Install smoke', workflow: 'Install smoke', job: null, paths: ['packaging/', 'scripts/install.sh'] },
    { check: 'CI / install (*)', workflow: 'CI', job: 'install (*)', paths: ['installer/**'] },
  ]);
});

test('#736 a check with no paths fails, and nothing is reported', () => {
  const r = audit(fixture(BASE + 'release-only-checks:\n  Install smoke: []\n'));
  assert.strictEqual(r.v, null);
  assert.ok(r.fails.some((t) => /must list the paths it covers/.test(t)), JSON.stringify(r.fails));
});

test('#736 a list instead of a map fails', () => {
  const r = audit(fixture(BASE + 'release-only-checks: [Install smoke]\n'));
  assert.strictEqual(r.v, null);
  assert.ok(r.fails.length, 'a finding names the key');
});

test('#736 a block list under a check is a reader finding, not a silent half-read', () => {
  let stdout;
  const dir = fixture(BASE + 'release-only-checks:\n  Install smoke:\n    - packaging/\n');
  try { stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (err) { stdout = err.stdout || ''; }
  const r = JSON.parse(stdout).results[0];
  const texts = r.findings.map((f) => f.text).join('\n');
  assert.match(texts, /"release-only-checks:" takes one level of "<check name>: \[paths\]" pairs/);
});
