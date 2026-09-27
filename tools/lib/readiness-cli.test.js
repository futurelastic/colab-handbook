'use strict';
/**
 * Subprocess/CLI tests for `colab readiness <N>` — the deps-checked path's gh I/O and the line it
 * prints (#388). The pure halves are pinned in labels.test.js (readinessMarkedMessage) and
 * blocked-by.test.js (openBlockerSummary); this file pins the WIRING: that the real command reads
 * blockedBy after the label write, reports what it read, never refuses on it, and never again
 * prints "verified: no open blocker" — the line #388 measured on issues with open blockers.
 *
 * Fixture shape copied from decision-cli.test.js: a real git clone with a bare origin (so
 * isGhUsable() reads true), a private COLAB_HOME, and a scripted fake `gh` keyed on its first two
 * argv words. The fake also appends every argv to a log, so a test can assert which calls ran.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

function fixture(script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-readiness-cli-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab readiness test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const scriptPath = path.join(bin, 'gh-script.json');
  const logPath = path.join(bin, 'gh-calls.log');
  fs.writeFileSync(scriptPath, JSON.stringify(script));
  fs.writeFileSync(logPath, '');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env node',
    `const fs = require('fs');`,
    `const script = JSON.parse(fs.readFileSync(${JSON.stringify(scriptPath)}, 'utf8'));`,
    'const argv = process.argv.slice(2);',
    `fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + "\\n");`,
    "if (argv[0] === '--version') { console.log('gh version 0.0.0 (fixture)'); process.exit(0); }",
    "if (argv[0] === 'auth' && argv[1] === 'status') { console.error('Logged in (fixture)'); process.exit(0); }",
    'const key = argv.slice(0, 2).join(" ");',
    'const entry = script[key];',
    'if (!entry) { console.error(`fixture gh: unscripted "${key}" — args: ${JSON.stringify(argv)}`); process.exit(1); }',
    'if (entry.stdout) process.stdout.write(entry.stdout);',
    'if (entry.stderr) process.stderr.write(entry.stderr);',
    'process.exit(entry.code || 0);',
  ].join('\n') + '\n', { mode: 0o755 });

  const calls = () => fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { root, work, home, bin, calls };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    cwd: fx.work,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const EDIT_OK = { code: 0, stdout: 'https://example.invalid/issues/7\n' };
const view = (nodes, totalCount = nodes.length) => ({ code: 0, stdout: JSON.stringify({ blockedBy: { nodes, totalCount } }) + '\n' });
// The REAL `gh issue view --json blockedBy` node shape (measured live 2026-09-27): id/number/state/
// title/url — no `repository` field. An earlier draft of this file used an invented shape with
// `repository.nameWithOwner`, passed, and would have printed "unread" on every real blocked issue.
const node = (number, state) => ({ id: `I_kw${number}`, number, state, title: `t${number}`, url: `https://github.com/o/r/issues/${number}` });

test('#388: open blockers are REPORTED, the label is still written, exit 0 — and "verified: no open blocker" is gone', () => {
  const fx = fixture({
    'issue edit': EDIT_OK,
    'issue view': view([node(1, 'OPEN'), node(2, 'OPEN'), node(3, 'OPEN')]),
  });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Marked #7 in .* deps-checked — dependencies reviewed; blockedBy: 3 open of 3 \(an open edge carries the block/);
  assert.doesNotMatch(r.out, /verified|no open blocker/);
  const keys = fx.calls().map((a) => a.slice(0, 2).join(' '));
  assert.ok(keys.includes('issue edit'), 'the label write ran');
  const v = fx.calls().find((a) => a[0] === 'issue' && a[1] === 'view');
  assert.ok(v && v.includes('blockedBy'), 'blockedBy was read');
});

test('#388: an empty graph reads "0 open", still never "verified"', () => {
  const fx = fixture({ 'issue edit': EDIT_OK, 'issue view': view([]) });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /dependencies reviewed; blockedBy: 0 open\s*$/m);
  assert.doesNotMatch(r.out, /verified|no open blocker/);
});

test('#388: closed-only blockers count as 0 open of N — no block caveat', () => {
  const fx = fixture({ 'issue edit': EDIT_OK, 'issue view': view([node(1, 'CLOSED'), node(2, 'CLOSED')]) });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /blockedBy: 0 open of 2\s*$/m);
});

test('#388: a FAILED blockedBy read is "unread", never zero — and the label write still stands (exit 0)', () => {
  const fx = fixture({ 'issue edit': EDIT_OK, 'issue view': { code: 1, stderr: 'boom\n' } });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /blockedBy: unread/);
  assert.doesNotMatch(r.out, /0 open|verified|no open blocker/);
});

test('#388: --clear does not read blockedBy (nothing to report on a removal)', () => {
  const fx = fixture({ 'issue edit': EDIT_OK });
  const r = colab(fx, ['readiness', '7', '--clear']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Cleared deps-checked on #7 .* UNCHECKED/);
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && a[1] === 'view'), 'no blockedBy read on --clear');
});

test('#388: a failed label write still refuses BEFORE any blockedBy read — no success line', () => {
  const fx = fixture({ 'issue edit': { code: 1, stderr: 'HTTP 500\n' }, 'label list': { code: 0, stdout: '[]\n' } });
  const r = colab(fx, ['readiness', '7']);
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.out, /Marked #7/);
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && a[1] === 'view'), 'no read after a failed write');
});
