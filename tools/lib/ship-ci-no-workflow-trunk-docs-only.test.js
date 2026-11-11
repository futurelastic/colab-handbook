'use strict';
/**
 * #711: #482's no-workflow door hands the trunk-CI decision to the branch's own run, but a docs-only
 * branch (#606) on a trunk with no workflow can never draw one, and #606 already says that run is not
 * required. So when trunk has no repo-owned workflow AND the candidate is docs-only (secret check
 * included), the `trunk CI green` row passes, naming both. Anything else keeps #482's behaviour: the
 * branch's own run decides, and no run still refuses.
 *
 * Real CLI, real repo, real bare `origin`. The fake `gh` reports no runs anywhere: no trunk run (no
 * workflow there) and no branch run (a docs-only branch on such a trunk never draws one).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.join(path.resolve(__dirname, '..', '..'), 'tools', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const BRANCH = 'docs/design-1';

/** `files`: path → content, committed on the branch. Trunk carries only the descriptor and f.txt. */
function fixture(files, { push = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ci-no-wf-docs-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const when = new Date(Date.now() - 60 * 60000).toISOString();
  const env = { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when };
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab no-workflow docs-only test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  g(work, 'checkout', '-q', '-b', BRANCH);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, rel)), { recursive: true });
    fs.writeFileSync(path.join(work, rel), body);
  }
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'docs: design artifacts');
  if (push) g(work, 'push', '-q', 'origin', BRANCH);
  g(work, 'checkout', '-q', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { work, home, bin };
}

function shipDry(fx) {
  const r = spawnSync('node', [COLAB, 'ship', '--branch', BRANCH, '--repo', fx.work, '--dry', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-711', COLAB_SESSION_NAME: '' },
  });
  const body = JSON.parse(r.stdout);
  const row = (name) => body.checks.find((c) => c.name === name);
  return { trunk: row('trunk CI green'), docs: row('branch CI (docs-only, #606)'), scan: row('docs-only secret check (#606)') };
}

const DOCS = {
  'docs/design/x-1/spec.md': '# spec\n',
  'docs/design/x-1/mockup.html': '<p>mockup</p>\n',
  'NOTES.md': 'notes\n',
};

test('#711 no-workflow trunk + docs-only branch with no run → the trunk CI row passes, citing #482 and #606', () => {
  const fx = fixture(DOCS);
  const { trunk, docs } = shipDry(fx);
  assert.ok(docs && docs.ok, `the #606 row applies: ${JSON.stringify(docs)}`);
  assert.strictEqual(trunk.ok, true, JSON.stringify(trunk));
  assert.strictEqual(trunk.class, null);
  assert.match(trunk.detail, /^none — main@\w+ has no repo-owned workflow/);
  assert.match(trunk.detail, /#482/);
  assert.match(trunk.detail, /docs-only branch, CI not required \(3 files, secret check clean — #606\)/);
});

test('#711 same setup + one non-docs file → still refuses as #482 does: the branch has no run', () => {
  const fx = fixture({ ...DOCS, 'src/app.js': 'module.exports = 1;\n' });
  const { trunk, docs } = shipDry(fx);
  assert.strictEqual(docs, undefined, 'not docs-only, so no #606 row');
  assert.strictEqual(trunk.ok, false);
  assert.strictEqual(trunk.class, 'human-gated', JSON.stringify(trunk));
  assert.match(trunk.detail, /\(#482\), so the branch's own run decides, and docs\/design-1@\w+ has no run/);
  assert.doesNotMatch(trunk.detail, /#606/);
});

test('#711 docs-only branch whose secret check fails → the door does not open, the branch run still decides', () => {
  const fx = fixture({ ...DOCS, 'docs/leak.md': `key: AKIA${'A'.repeat(16)}\n` });
  const { trunk, scan } = shipDry(fx);
  assert.ok(scan && scan.ok === false, `secret check fails: ${JSON.stringify(scan)}`);
  assert.strictEqual(trunk.ok, false);
  assert.strictEqual(trunk.class, 'human-gated', JSON.stringify(trunk));
  assert.match(trunk.detail, /has no run/);
});

test('#711 docs-only branch NOT on the remote → the door keeps #482\'s precondition and does not open', () => {
  const fx = fixture(DOCS, { push: false });
  const { trunk } = shipDry(fx);
  assert.strictEqual(trunk.ok, false, JSON.stringify(trunk));
  assert.doesNotMatch(trunk.detail, /#606/);
});
