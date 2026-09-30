'use strict';
/**
 * Tests for the audit's `live-env:` key (audit/audit.mjs) — issue #403.
 *
 * `live-env: none` is the one declaration that lets `colab gate-hermetic` skip code-wrap A3's
 * hermetic second test run. Absent is clean and reported as null; `none` is clean and reported;
 * anything else fails, because the reader treats it as absent and the declaration silently does
 * nothing. Same fixture shape as audit-migration-grant-policy.test.js.
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

function fixture(projectYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-live-env-'));
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
  } catch (err) {
    stdout = err.stdout || '';
  }
  const r = JSON.parse(stdout).results[0];
  return {
    liveEnv: r.liveEnv,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
const mentions = (r) => [...r.fails, ...r.warns].filter((t) => /live-env/.test(t));

test('live-env absent → reported as null, no finding', () => {
  const r = audit(fixture(BASE));
  assert.strictEqual(r.liveEnv, null);
  assert.deepStrictEqual(mentions(r), []);
});

test('live-env: none → reported, no finding', () => {
  const r = audit(fixture(`${BASE}live-env: none\n`));
  assert.strictEqual(r.liveEnv, 'none');
  assert.deepStrictEqual(mentions(r), []);
});

test('every other live-env value fails — the reader ignores it, so the declaration would do nothing', () => {
  for (const v of ['off', 'None', 'true', '[none]', 'reads-home']) {
    const r = audit(fixture(`${BASE}live-env: ${v}\n`));
    assert.ok(r.fails.some((t) => /^live-env is .* the only defined value is "none"/.test(t)), `${v}: ${r.fails.join(' | ')}`);
  }
});
