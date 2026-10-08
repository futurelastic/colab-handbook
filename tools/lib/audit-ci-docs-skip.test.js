'use strict';
/**
 * Tests for the audit's `ci-docs-skip:` key (audit/audit.mjs) — issue #570.
 *
 * `ci-docs-skip` opts the CI guard into docs-only mode. Absent is clean and reported as null; a
 * list of plain repo paths is clean and reported; anything else fails — the guard reads it as not
 * opted in, so the declaration silently does nothing.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ci-docs-skip-'));
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
    ciDocsSkip: r.ciDocsSkip,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
const mentions = (r) => [...r.fails, ...r.warns].filter((t) => /ci-docs-skip/.test(t));

test('ci-docs-skip absent → reported as null, no finding', () => {
  const r = audit(fixture(BASE));
  assert.strictEqual(r.ciDocsSkip, null);
  assert.deepStrictEqual(mentions(r), []);
});

test('ci-docs-skip as a list → reported, no finding', () => {
  assert.deepStrictEqual(audit(fixture(`${BASE}ci-docs-skip: []\n`)).ciDocsSkip, []);
  const r = audit(fixture(`${BASE}ci-docs-skip:\n  - docs/api/\n`));
  assert.deepStrictEqual(r.ciDocsSkip, ['docs/api']);
  assert.deepStrictEqual(mentions(r), []);
});

test('every other ci-docs-skip value fails', () => {
  for (const v of ['on', 'true', '"docs/"', '[docs/*]', '[../x]']) {
    const r = audit(fixture(`${BASE}ci-docs-skip: ${v}\n`));
    assert.strictEqual(r.ciDocsSkip, null, v);
    assert.ok(r.fails.some((t) => /^ci-docs-skip .* must be a list of repo paths/.test(t)), `${v}: ${r.fails.join(' | ')}`);
  }
});
