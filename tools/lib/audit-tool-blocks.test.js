'use strict';
/**
 * Tests for the audit's instruction-file block checks (audit/audit.mjs
 * `checkInstructionFileBlocks`) — issue #417.
 *
 * With CLAUDE.md as a thin shell over AGENTS.md, two things go wrong silently: a
 * tool-generated block written into both files loads twice every session, and a Conventions
 * block moved into AGENTS.md hides its stamp from every by-name reader. Both are WARN only.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const AUDIT = path.resolve(__dirname, '..', '..', 'audit', 'audit.mjs');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-tool-blocks-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  for (const [rel, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), body);
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
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}
const hasText = (list, rx) => list.some((t) => rx.test(t));

const BOOST = '<laravel-boost-guidelines>\n# Guidelines\n- rule one\n</laravel-boost-guidelines>\n';
const NEXT = '<!-- BEGIN:nextjs-agent-rules -->\nRead the docs before writing code.\n<!-- END:nextjs-agent-rules -->\n';

test('a Laravel Boost block in both CLAUDE.md and an imported AGENTS.md warns (loads twice)', () => {
  const r = audit(fixture({ 'CLAUDE.md': '@AGENTS.md\n\n' + BOOST, 'AGENTS.md': '# Rules\n\n' + BOOST }));
  assert.ok(hasText(r.warns, /tool block "laravel-boost" appears in both CLAUDE\.md and AGENTS\.md.*loaded twice/), r.warns.join(' | '));
  assert.deepStrictEqual(r.fails, []);
});

test('a Next.js BEGIN/END block in both files warns', () => {
  const r = audit(fixture({ 'CLAUDE.md': '@AGENTS.md\n\n' + NEXT, 'AGENTS.md': NEXT }));
  assert.ok(hasText(r.warns, /tool block "nextjs-agent-rules" appears in both/), r.warns.join(' | '));
});

test('a block in both files, without the import, still warns (keep one copy)', () => {
  const r = audit(fixture({ 'CLAUDE.md': '# plain\n\n' + BOOST, 'AGENTS.md': BOOST }));
  assert.ok(hasText(r.warns, /tool block "laravel-boost" appears in both.*keep one copy/), r.warns.join(' | '));
});

test('a Boost block only in AGENTS.md is clean', () => {
  const r = audit(fixture({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': '# Rules\n\n' + BOOST }));
  assert.ok(!hasText(r.warns, /tool block|Conventions block/), r.warns.join(' | '));
});

test('byte-identical CLAUDE.md and AGENTS.md do not warn', () => {
  const body = '# Rules\n\n' + BOOST;
  const r = audit(fixture({ 'CLAUDE.md': body, 'AGENTS.md': body }));
  assert.ok(!hasText(r.warns, /tool block/), r.warns.join(' | '));
});

test('the Conventions block only in AGENTS.md warns misplaced', () => {
  const block = '## Conventions\n\nThis repo follows the [colab-handbook](https://example.invalid) conventions.\n';
  const r = audit(fixture({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': '# Rules\n\n' + block }));
  assert.ok(hasText(r.warns, /Conventions block is in AGENTS\.md, not CLAUDE\.md/), r.warns.join(' | '));
  assert.deepStrictEqual(r.fails, []);
});

test('the Conventions block in the CLAUDE.md shell is clean', () => {
  const block = '## Conventions\n\nThis repo follows the [colab-handbook](https://example.invalid) conventions.\n';
  const r = audit(fixture({ 'CLAUDE.md': '@AGENTS.md\n\n' + block, 'AGENTS.md': '# Rules\n' }));
  assert.ok(!hasText(r.warns, /Conventions block is in/), r.warns.join(' | '));
});
