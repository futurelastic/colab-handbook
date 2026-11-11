'use strict';
/**
 * The audit's CI gate drift findings (audit/audit.mjs checkGateDrift) — issue #721.
 *
 *   - static: a workflow carrying its own copy of the dedupe gate, with no call to the handbook's
 *     reusable ci-light.yml, is drift; calling it is clean;
 *   - history: a guarded workflow whose recent trunk runs never skipped, although one landed a tree a
 *     branch had already passed green, is drift — read through a fake `gh` serving the REST pages.
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
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP.push(d); return d; };

const BASE = 'trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\n';
const COPY = 'name: CI\non: push\njobs:\n  dedupe:\n    name: Already tested at this sha or tree?\n    runs-on: ubuntu-latest\n    steps:\n      - name: Look for a green run of this workflow at this sha or tree\n        run: true\n';
const CALL = 'name: CI\non: push\njobs:\n  ci:\n    uses: futurelastic/colab-handbook/.github/workflows/ci-light.yml@v9.9.9\n';

function fixture(workflows, { remote = false } = {}) {
  const dir = tmp('audit-gate-drift-');
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), BASE);
  for (const [f, body] of Object.entries(workflows)) fs.writeFileSync(path.join(dir, '.github', 'workflows', f), body);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  if (remote) g('remote', 'add', 'origin', 'git@github.com:o/r.git');
  return dir;
}

// A fake `gh api <path> -i`: serves $FIX/<path with / and ? flattened>.json bodies, no headers (exit 0 = ok);
// anything else exits 1 — unreadable, which every other remote check treats as "say nothing".
function fakeGh(pages) {
  const dir = tmp('fake-gh-');
  const fix = path.join(dir, 'fix');
  fs.mkdirSync(fix);
  const keyOf = (p) => p.replace(/[^A-Za-z0-9]+/g, '_');
  for (const [p, body] of Object.entries(pages)) fs.writeFileSync(path.join(fix, keyOf(`repos/o/r/${p}`)), JSON.stringify(body));
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
[ "$1" = api ] || exit 1
k=$(printf '%s' "$2" | sed -E 's/[^A-Za-z0-9]+/_/g')
[ -f "${fix}/$k" ] || exit 1
cat "${fix}/$k"
`, { mode: 0o755 });
  return dir;
}

function audit(dir, ghDir) {
  let stdout;
  const env = { ...process.env, COLAB_AUDIT_CACHE_DIR: tmp('audit-cache-'), COLAB_AUDIT_CACHE_TTL: '0' };
  if (ghDir) env.PATH = `${ghDir}:${process.env.PATH}`;
  const args = [AUDIT, '--json', '--local', dir];
  if (!ghDir) args.push('--offline');
  try {
    stdout = execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env });
  } catch (err) {
    stdout = err.stdout || '';
  }
  const r = JSON.parse(stdout).results[0];
  return r.findings.filter((f) => /^drift: /.test(f.text)).map((f) => `${f.level}: ${f.text}`);
}

test('a copied gate with no call to ci-light.yml is drift; calling it is clean (#721)', () => {
  const copy = audit(fixture({ 'ci.yml': COPY }));
  assert.strictEqual(copy.length, 1, copy.join('\n'));
  assert.match(copy[0], /^warn: drift: \.github\/workflows\/ci\.yml carries its own copy of the CI dedupe gate instead of calling the handbook's reusable workflow \(\.github\/workflows\/ci-light\.yml\)/);
  assert.match(copy[0], /templates\/ci-call\.yml/);
  assert.deepStrictEqual(audit(fixture({ 'ci.yml': CALL })), []);
  // A caller beside a leftover copy: the copy is still drift, named.
  const both = audit(fixture({ 'ci.yml': CALL, 'old-ci.yml': COPY }));
  assert.strictEqual(both.length, 1);
  assert.match(both[0], /old-ci\.yml carries its own copy/);
  // No gate at all is somebody's own CI — not this finding.
  assert.deepStrictEqual(audit(fixture({ 'ci.yml': 'name: CI\non: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n' })), []);
});

test('a guarded workflow whose trunk runs never skip despite a green tree is drift; one skip is clean (#721)', () => {
  const run = (id, branch, tree, created) => ({ id, head_branch: branch, created_at: created, head_commit: { tree_id: tree } });
  const trunkList = { workflow_runs: [run(9, 'main', 'T1', '2026-11-10T10:05:00Z')] };
  const greenList = { workflow_runs: [run(7, 'feat/x-1', 'T1', '2026-11-10T10:01:00Z')] };
  const pages = (trunkJobs) => ({
    'actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=10': trunkList,
    'actions/workflows/ci.yml/runs?event=push&status=success&per_page=50': greenList,
    'actions/runs/9/jobs?per_page=100': { jobs: trunkJobs },
  });
  const ran = [{ name: 'ci / Already tested at this sha or tree?', conclusion: 'success' }, { name: 'ci / Full (test, build)', conclusion: 'success' }];
  const skipped = [{ name: 'ci / Already tested at this sha or tree?', conclusion: 'success' }, { name: 'ci / Full (test, build)', conclusion: 'skipped' }];
  const inert = audit(fixture({ 'ci.yml': CALL }, { remote: true }), fakeGh(pages(ran)));
  assert.strictEqual(inert.length, 1, inert.join('\n'));
  assert.match(inert[0], /^warn: drift: the dedupe gate in \.github\/workflows\/ci\.yml never skipped — .*trunk run 9 could have cited run 7 on feat\/x-1/);
  assert.deepStrictEqual(audit(fixture({ 'ci.yml': CALL }, { remote: true }), fakeGh(pages(skipped))), []);
  // History unreadable (no page served) — nothing said.
  assert.deepStrictEqual(audit(fixture({ 'ci.yml': CALL }, { remote: true }), fakeGh({})), []);
});
