'use strict';
/**
 * Tests for #204 — `branches()` (audit/audit.mjs) read `refs/heads` only, so a trunk that
 * exists on the remote but has no local branch ref was reported as ABSENT: a `fail`, not an
 * advisory, on a repo that is fully conforming. This is not an edge case: it is the shape of
 * every fresh `git clone --branch <default>` of a Tier A/C repo, because trunk (`dev`) and the
 * remote's default branch (`main`) are routinely different. `git clone` creates exactly one
 * local branch ref — everything else lands under `refs/remotes/origin/*` only.
 *
 * The fix unions `refs/heads` with `refs/remotes/*`, stripped of the remote prefix and
 * deduped, for the general "does this branch exist" question. A second, narrower question —
 * "is the checkout parked on the wrong branch" — deliberately keeps the local/remote
 * distinction: firing "return the checkout to dev" is right advice when dev was once checked
 * out locally and the checkout has since drifted, and noise when it never was (nothing to
 * "return" to).
 *
 * Fixtures are real git repos with a real `git clone` step (not mocks, and not `git init` with
 * hand-placed refs) — the bug is specifically about what `git clone --branch X` leaves in
 * `refs/remotes` vs `refs/heads`, and only an actual clone reproduces that shape faithfully.
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

const TIER_C = 'tier: C\ntrunk: dev\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\n';
const CI_WF = 'name: CI\non:\n  push:\n    branches: [main, dev]\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n';
const DEPLOY_WF = 'on:\n  push:\n    branches: [main]\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps: []\n';

/** An "upstream" repo on `main`, with `dev` cut as a second branch, and the Tier C
 * project.yml + CI workflow the issue's repro uses (trunk `dev`, default branch `main`). */
function upstream({ projectYml = TIER_C } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-remote-trunk-up-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), CI_WF);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: init');
  g('branch', 'dev');
  return dir;
}

/** Clone `srcDir` checked out on `main` — the shape a fresh `git clone --branch main` (or
 * `--branch <default>`) leaves: one local branch ref (`main`), `dev` present only under
 * `refs/remotes/<remote>/dev`. `remoteName` defaults to git's own default ("origin") so one
 * test can verify the fix does not hard-code that name. */
function cloneOnMain(srcDir, { remoteName = 'origin' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-remote-trunk-clone-'));
  TMP.push(dir);
  execFileSync('git', ['clone', '-q', '--branch', 'main', '-o', remoteName, srcDir, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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
    ok: r.ok,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

test('#204 repro: a fresh clone on the default branch, trunk remote-only, reports neither trunk-missing nor wrong-checkout', () => {
  const up = upstream();
  const clone = cloneOnMain(up);
  const r = audit(clone);
  assert.ok(!hasText(r.fails, /does not exist/), `trunk wrongly reported missing: ${r.fails.join(' | ')}`);
  assert.ok(!hasText(r.fails, /main checkout is on/), `wrong-checkout finding fired on a checkout that was never on trunk: ${r.fails.join(' | ')}`);
  assert.ok(!hasText(r.warns, /triggers on nonexistent branch/), `CI's "dev" trigger flagged as a ghost branch: ${r.warns.join(' | ')}`);
});

test('#204: same clone, fully conforming (deploy workflow present) — clean', () => {
  const up = upstream();
  fs.writeFileSync(path.join(up, '.github', 'workflows', 'deploy-prod.yml'), DEPLOY_WF);
  execFileSync('git', ['add', '-A'], { cwd: up });
  execFileSync('git', ['commit', '-q', '-m', 'chore: add deploy workflow'], { cwd: up });
  const clone = cloneOnMain(up);
  const r = audit(clone);
  assert.deepStrictEqual(r.fails, []);
});

test('#204: a checkout that HAD trunk locally and drifted off it still gets the wrong-checkout finding', () => {
  const up = upstream();
  const clone = cloneOnMain(up);
  const g = (...args) => execFileSync('git', args, { cwd: clone, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('checkout', '-q', 'dev'); // creates a local `dev` ref tracking origin/dev
  g('checkout', '-q', 'main'); // ...then drifts back off it
  const r = audit(clone);
  assert.ok(hasText(r.fails, /main checkout is on "main", not trunk "dev"/), r.fails.join(' | '));
});

test('#204: remote-only branch existence is not tied to the name "origin"', () => {
  const up = upstream();
  const clone = cloneOnMain(up, { remoteName: 'upstream' });
  const r = audit(clone);
  assert.ok(!hasText(r.fails, /does not exist/), r.fails.join(' | '));
});

test('#204: a genuinely absent trunk still fails, and the branch list in the message is deduped, not doubled', () => {
  const yml = 'tier: C\ntrunk: release\nproduction: https://example.invalid\ndeploy: push-main\nstack: node\n';
  const up = upstream({ projectYml: yml });
  const clone = cloneOnMain(up);
  const r = audit(clone);
  const finding = r.fails.find((t) => /declared trunk "release" does not exist/.test(t));
  assert.ok(finding, r.fails.join(' | '));
  const m = /branches: (.+)\)$/.exec(finding);
  assert.ok(m, finding);
  const listed = m[1].split(', ');
  assert.strictEqual(new Set(listed).size, listed.length, `branch list has duplicates: ${m[1]}`);
  assert.deepStrictEqual([...listed].sort(), ['dev', 'main'], `expected exactly main + dev, got: ${m[1]}`);
});
