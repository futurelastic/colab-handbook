'use strict';
/**
 * Tests for the instruction-file gate (#588): tools/lib/instruction-gate.js, the ratchet in
 * tools/lib/instruction-file.js, `colab instruction-files`, the pre-commit hook template and the
 * audit's warn → fail — all on real throwaway git repos, because the ratchet is a question about
 * a merge base and a diff, and a pure test of it would only test the arithmetic.
 *
 * The five-case matrix the Issue asks for, by name:
 *   a. conforming repo, branch edits AGENTS.md            → green
 *   b. conforming repo, branch adds prose to CLAUDE.md    → red (touched)
 *   c. unmigrated repo, branch leaves CLAUDE.md alone     → green (the ratchet)
 *   d. unmigrated repo, branch edits CLAUDE.md, still prose → red (touched)
 *   e. every recognised tool block is allowed             → green
 *
 * Run: `node --test tools/lib/instruction-gate.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const inst = require('./instruction-file.js');
const gateLib = require('./instruction-gate.js');

const ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(ROOT, 'tools', 'colab');
const HOOK = path.join(ROOT, 'templates', 'pre-commit-instruction-files');
const AUDIT = path.join(ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const CONV = '## Conventions\n\n<!-- colab-handbook @ v1.12.0 -->\n\n' +
  'This repo follows the [colab-handbook](https://example.invalid/CONVENTIONS.md) conventions.\n\n' +
  '- **Tier:** `B` — no production target.\n- **Trunk:** `main`.\n';
const SHELL = '@AGENTS.md\n';
const AGENTS = '# AGENTS.md\n\nRepo prose lives here.\n';
const LEGACY = '# CLAUDE.md\n\nRun the tests with `npm test`.\n\n- docs/a.md — thing a\n';

/** A repo with `files` committed on `main`, then `branch` checked out with `edits` committed on it. */
function repo(files, edits = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'instruction-gate-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'gate test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  write(dir, { '.github/project.yml': 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n', 'README.md': '# r\n', ...files });
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: base');
  if (edits) {
    g('checkout', '-q', '-b', 'feat/x-1');
    write(dir, edits);
    g('add', '-A');
    g('commit', '-q', '-m', 'feat: change');
  }
  return { dir, g };
}

function write(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(dir, rel);
    if (body === null) { fs.rmSync(f, { force: true }); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
}

const run = (dir, base = 'main') => gateLib.gate({ cwd: dir, base });

// --- the five-case matrix --------------------------------------------------------

test('a. a conforming repo whose branch edits AGENTS.md stays green', () => {
  const { dir } = repo({ 'CLAUDE.md': SHELL + '\n' + CONV, 'AGENTS.md': AGENTS }, { 'AGENTS.md': AGENTS + '\nMore prose.\n' });
  const r = run(dir);
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.fail, false);
  assert.deepStrictEqual(r.bad, []);
  assert.deepStrictEqual(r.changed, ['AGENTS.md']);
});

test('b. a branch adding prose to a conforming CLAUDE.md fails, naming the fix', () => {
  const { dir } = repo({ 'CLAUDE.md': SHELL, 'AGENTS.md': AGENTS }, { 'CLAUDE.md': SHELL + '\nAlways run lint first.\n' });
  const r = run(dir);
  assert.strictEqual(r.fail, true);
  assert.strictEqual(r.reason, 'touched');
  assert.match(r.bad[0].message, /^CLAUDE\.md line 3 carry repo prose next to its @AGENTS\.md import — move them to AGENTS\.md/);
});

test('c. an unmigrated repo whose branch leaves CLAUDE.md alone stays green (the ratchet)', () => {
  const { dir } = repo({ 'CLAUDE.md': LEGACY }, { 'README.md': '# r\n\nchanged\n' });
  const r = run(dir);
  assert.strictEqual(r.fail, false);
  assert.strictEqual(r.bad.length, 1, 'the file is still non-conforming — reported, not failed');
  assert.ok(gateLib.describe(r).some((l) => /not failing: unmigrated repo/.test(l)));
});

test('d. an unmigrated repo whose branch edits CLAUDE.md and leaves it non-conforming fails', () => {
  const { dir } = repo({ 'CLAUDE.md': LEGACY }, { 'CLAUDE.md': LEGACY + '\n- docs/b.md — thing b\n' });
  const r = run(dir);
  assert.strictEqual(r.fail, true);
  assert.strictEqual(r.reason, 'touched');
  assert.match(r.bad[0].message, /no @AGENTS\.md import \(a legacy prose-only file\)/);
});

test('d\'. ...and the migration itself (prose moved to AGENTS.md) turns it green', () => {
  const { dir } = repo({ 'CLAUDE.md': LEGACY }, { 'CLAUDE.md': SHELL, 'AGENTS.md': LEGACY.replace('CLAUDE', 'AGENTS') });
  assert.strictEqual(run(dir).fail, false);
});

test('e. every recognised tool block is allowed — Conventions, BEGIN/END, <name>:start/end, laravel-boost', () => {
  const body = SHELL + '\n' + CONV + '\n' +
    '<!-- BEGIN:framework-rules -->\nframework text\n<!-- END:framework-rules -->\n\n' +
    '<!-- ui-kit:start (managed by a package — edit elsewhere) -->\n## UI\nrules\n<!-- ui-kit:end -->\n\n' +
    '<laravel-boost-guidelines>\n# Boost\nguidance\n</laravel-boost-guidelines>\n';
  const { dir } = repo({ 'CLAUDE.md': SHELL, 'AGENTS.md': AGENTS }, { 'CLAUDE.md': body });
  const r = run(dir);
  assert.strictEqual(r.fail, false, gateLib.describe(r).join('\n'));
  assert.deepStrictEqual(r.bad, []);
});

// --- beyond the matrix -----------------------------------------------------------

test('every tracked CLAUDE.md is judged, each against the AGENTS.md beside it', () => {
  const { dir } = repo({ 'CLAUDE.md': SHELL, 'AGENTS.md': AGENTS }, { 'pkg/CLAUDE.md': SHELL + 'pkg prose\n', 'pkg/AGENTS.md': AGENTS });
  const r = run(dir);
  assert.strictEqual(r.fail, true);
  assert.deepStrictEqual(r.bad.map((f) => f.path), ['pkg/CLAUDE.md']);
  assert.match(r.bad[0].message, /move them to pkg\/AGENTS\.md/);
});

test('a symlinked CLAUDE.md -> AGENTS.md pair is one file: conforming', () => {
  const { dir, g } = repo({ 'AGENTS.md': AGENTS });
  fs.symlinkSync('AGENTS.md', path.join(dir, 'CLAUDE.md'));
  g('add', '-A'); g('commit', '-q', '-m', 'chore: link');
  const r = gateLib.gate({ cwd: dir });
  assert.strictEqual(r.fail, false, gateLib.describe(r).join('\n'));
  assert.strictEqual(r.files.length, 1);
});

test('the ratchet\'s "regressed" arm, pure: a migrated base and a non-conforming head fail untouched', () => {
  const v = inst.ratchetVerdict({ changed: ['src/x.js'], head: [{ path: 'CLAUDE.md', conforming: false }], base: [{ path: 'CLAUDE.md', conforming: true }] });
  assert.deepStrictEqual([v.fail, v.reason], [true, 'regressed']);
  const u = inst.ratchetVerdict({ changed: ['src/x.js'], head: [{ path: 'CLAUDE.md', conforming: false }], base: [{ path: 'CLAUDE.md', conforming: false }] });
  assert.strictEqual(u.fail, false);
});

test('a base that is not in the clone cannot be judged — ok:false, never a pass', () => {
  const { dir } = repo({ 'CLAUDE.md': LEGACY }, { 'CLAUDE.md': LEGACY + 'x\n' });
  const r = gateLib.gate({ cwd: dir, base: 'origin/main' });
  assert.strictEqual(r.ok, false);
  const cli = spawnSync(process.execPath, [COLAB, 'instruction-files', '--base', 'origin/main'], { cwd: dir, encoding: 'utf8' });
  assert.strictEqual(cli.status, 2, cli.stderr);
});

test('CLI: exit 1 with the fix named on a red branch, 0 on a green one', () => {
  const red = repo({ 'CLAUDE.md': SHELL, 'AGENTS.md': AGENTS }, { 'CLAUDE.md': SHELL + 'prose\n' });
  const r = spawnSync(process.execPath, [COLAB, 'instruction-files', '--base', 'main'], { cwd: red.dir, encoding: 'utf8' });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /move it to AGENTS\.md/);
  const green = repo({ 'CLAUDE.md': LEGACY }, { 'README.md': 'x\n' });
  const s = spawnSync(process.execPath, [COLAB, 'instruction-files', '--base', 'main'], { cwd: green.dir, encoding: 'utf8' });
  assert.strictEqual(s.status, 0, s.stdout + s.stderr);
});

// --- the pre-commit hook -----------------------------------------------------------

function hook(dir, env = {}) {
  return spawnSync('sh', [HOOK], { cwd: dir, encoding: 'utf8', env: { ...process.env, COLAB_BIN: COLAB, ...env } });
}

test('hook: a staged non-conforming CLAUDE.md is rejected', () => {
  const { dir, g } = repo({ 'CLAUDE.md': SHELL, 'AGENTS.md': AGENTS });
  write(dir, { 'CLAUDE.md': SHELL + 'prose\n' });
  g('add', 'CLAUDE.md');
  const r = hook(dir);
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, /commit BLOCKED: move the prose above into AGENTS\.md/);
});

test('hook: a staged conforming CLAUDE.md is allowed', () => {
  const { dir, g } = repo({ 'CLAUDE.md': LEGACY });
  write(dir, { 'CLAUDE.md': SHELL + '\n' + CONV, 'AGENTS.md': AGENTS });
  g('add', '-A');
  const r = hook(dir);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('hook: with no CLAUDE.md/AGENTS.md staged it never starts node, even on an unmigrated repo', () => {
  const { dir, g } = repo({ 'CLAUDE.md': LEGACY });
  write(dir, { 'README.md': 'changed\n' });
  g('add', 'README.md');
  const r = hook(dir, { COLAB_BIN: '/nonexistent/colab' }); // would warn if it got that far
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, '');
});

test('hook: no colab on the machine warns and passes (CI still judges)', () => {
  const { dir, g } = repo({ 'CLAUDE.md': SHELL, 'AGENTS.md': AGENTS });
  write(dir, { 'CLAUDE.md': SHELL + 'prose\n' });
  g('add', 'CLAUDE.md');
  const env = { ...process.env, PATH: '/usr/bin:/bin' };
  delete env.COLAB_BIN;
  const r = spawnSync('sh', [HOOK], { cwd: dir, encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /not installed/);
});

// --- the audit: warn, and fail under the same ratchet ------------------------------

function audit(dir, ...extra) {
  const r = spawnSync(process.execPath, [AUDIT, '--local', dir, '--json', ...extra], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  const f = out.results[0].findings;
  return { fails: f.filter((x) => x.level === 'fail').map((x) => x.text), warns: f.filter((x) => x.level === 'warn').map((x) => x.text) };
}

test('audit: the ratchet tripping FAILS prose-in-claude-md; the same file untouched only warns', () => {
  const red = repo({ 'CLAUDE.md': LEGACY }, { 'CLAUDE.md': LEGACY + 'more\n' });
  const a = audit(red.dir, '--base', 'main');
  assert.ok(a.fails.some((t) => /^prose-in-claude-md: CLAUDE\.md lines .* \(#588\)$/.test(t)), a.fails.join(' | '));
  assert.ok(!a.warns.some((t) => t.startsWith('prose-in-claude-md:')), 'reported once, as the failure');
  const green = repo({ 'CLAUDE.md': LEGACY }, { 'README.md': 'x\n' });
  const b = audit(green.dir, '--base', 'main');
  assert.ok(!b.fails.some((t) => t.startsWith('prose-in-claude-md')), b.fails.join(' | '));
  assert.ok(b.warns.some((t) => t.startsWith('prose-in-claude-md:')), b.warns.join(' | '));
});

test('audit: no base to compare against (no origin/<trunk>) keeps the warning', () => {
  const { dir } = repo({ 'CLAUDE.md': LEGACY }, { 'CLAUDE.md': LEGACY + 'more\n' });
  const a = audit(dir);
  assert.ok(!a.fails.some((t) => t.startsWith('prose-in-claude-md')), a.fails.join(' | '));
  assert.ok(a.warns.some((t) => t.startsWith('prose-in-claude-md:')));
});

// --- the reusable workflow's base resolution on a pull request (#595) ---------------------------
//
// These run the workflow's OWN `run:` block (read out of .github/workflows/instruction-files.yml,
// not a copy of it) inside a fixture whose HEAD is what actions/checkout gives a pull_request run:
// the merge commit refs/pull/N/merge, first parent = the base tip GitHub merged onto, second = the
// PR head. The base branch moves AFTER `pull_request.base.sha` — the measured shape: base.sha is
// older than the merge commit's first parent.

const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'instruction-files.yml');

/** The `run: |` block of the judging step, dedented — the shell the runner executes. */
function workflowScript() {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const at = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  assert.ok(at > 0, 'the workflow has a run: | block');
  const keyIndent = lines[at].search(/\S/);
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() && l.search(/\S/) <= keyIndent) break;
    body.push(l);
  }
  const ind = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(ind)).join('\n');
}

/**
 * Unmigrated repo: `main` at A (legacy CLAUDE.md) = the PR's base.sha; the PR branch forks at A and
 * commits `pr`; then `main` gains `later` (after base.sha). HEAD = the merge of the PR onto main's tip.
 */
function prFixture(pr, later, { mergeCommit = true } = {}) {
  const { dir, g } = repo({ 'CLAUDE.md': LEGACY, 'AGENTS.md': AGENTS });
  const baseSha = g('rev-parse', 'HEAD').trim();
  g('checkout', '-q', '-b', 'feat/x-1');
  write(dir, pr); g('add', '-A'); g('commit', '-q', '-m', 'feat: the PR');
  g('checkout', '-q', 'main');
  write(dir, later); g('add', '-A'); g('commit', '-q', '-m', 'docs: main moves on after the PR was cut');
  if (mergeCommit) {
    g('checkout', '-q', '--detach', 'main');
    g('merge', '-q', '--no-ff', '--no-edit', 'feat/x-1');
  } else {
    g('checkout', '-q', 'feat/x-1');
  }
  fs.symlinkSync(ROOT, path.join(dir, '.colab-handbook-checker'));
  return { dir, g, baseSha };
}

function runWorkflow(dir, env) {
  return spawnSync('bash', ['-e', '-c', workflowScript()], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
      EVENT: 'pull_request', REF: 'refs/pull/7/merge', BEFORE: '', DEFAULT_BRANCH: 'main',
      ...env,
    },
  });
}

test('#595 PR: unmigrated repo, PR touches neither file, base edits AGENTS.md after the cut → green', () => {
  const { dir, g, baseSha } = prFixture({ 'README.md': '# r\n\nthe PR\n' }, { 'AGENTS.md': AGENTS + '\nTrunk prose.\n' });
  // The failure being fixed, reproduced: judged from base.sha the base's own AGENTS.md edit is in the diff.
  const old = gateLib.gate({ cwd: dir, base: baseSha });
  assert.deepStrictEqual([old.fail, old.reason], [true, 'touched'], 'fixture reproduces the measured red');
  const r = runWorkflow(dir, { PR_BASE: baseSha });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`ratchet base: ${g('rev-parse', 'HEAD^1').trim()}`));
});

test('#595 PR: unmigrated repo, PR edits CLAUDE.md and leaves it prose → still red, with the base moved', () => {
  const { dir, baseSha } = prFixture({ 'CLAUDE.md': LEGACY + '\n- docs/b.md — thing b\n' }, { 'AGENTS.md': AGENTS + '\nTrunk prose.\n' });
  const r = runWorkflow(dir, { PR_BASE: baseSha });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /move it to AGENTS\.md/);
});

test('#595 PR: a caller that checked out the head (no merge commit) keeps base.sha — the fork point', () => {
  const { dir, baseSha } = prFixture({ 'README.md': '# r\n\nthe PR\n' }, { 'AGENTS.md': AGENTS + '\nTrunk prose.\n' }, { mergeCommit: false });
  const r = runWorkflow(dir, { PR_BASE: baseSha });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`ratchet base: ${baseSha}`));
});
