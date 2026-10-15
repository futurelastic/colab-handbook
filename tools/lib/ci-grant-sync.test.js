'use strict';
/**
 * #615 on real git: the lineage the ship caller hands ci-grant.js's evaluateIssue
 * (`syncChain: (head, red) => ship-handoff.js syncMergeChain(run, head, red)`). The measured
 * deadlock: a human grant bound to evidence head H, trunk red at R, and the B0 sync #395 demands
 * (merge R into the branch) moved the head to M — voiding the grant every time R was not already in
 * the branch. Here: syncing R keeps it; a commit of its own, a hand-edited merge, or a merge of
 * trunk PAST R (anything the human did not review against) still voids it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ho = require('./ship-handoff.js');
const { grantCommentBody, evaluateIssue } = require('./ci-grant.js');

const TMP = [];
test.after(() => { for (const d of TMP) fs.rmSync(d, { recursive: true, force: true }); });
const g = (d, ...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8' }).trim();

/** main: base → R (red). br: base → H (the granted, reviewed head). */
function redRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-cigrant-sync-'));
  TMP.push(d);
  execFileSync('git', ['init', '-q', '-b', 'main', d]);
  g(d, 'config', 'user.email', 'c@example.invalid'); g(d, 'config', 'user.name', 'sync');
  g(d, 'config', 'core.hooksPath', path.join(d, '.nohooks'));
  const commit = (file, text, msg) => { fs.writeFileSync(path.join(d, file), text); g(d, 'add', '-A'); g(d, 'commit', '-q', '-m', msg); return g(d, 'rev-parse', 'HEAD'); };
  commit('shared.txt', 'one\n', 'base');
  g(d, 'checkout', '-q', '-b', 'br');
  const H = commit('feature.txt', 'feature\n', 'feat: the bystander work');
  g(d, 'checkout', '-q', 'main');
  const R = commit('check.txt', 'a check only trunk runs, now red\n', 'chore: the red commit');
  g(d, 'checkout', '-q', 'br');
  const run = (a) => { const r = spawnSync('git', a, { cwd: d, encoding: 'utf8' }); return { ok: r.status === 0, code: r.status, stdout: (r.stdout || '').trim() }; };
  return { d, H, R, commit, run };
}

function verdict(r, head) {
  const record = { state: 'OPEN', labels: [{ name: 'ci-granted' }], comments: [{
    body: grantCommentBody('br', 'main', r.R, r.H, 'box', '2026-10-15T00:00:00Z'),
    createdAt: '2026-10-15T00:00:00Z', author: { login: 'maintainer' }, authorAssociation: 'MEMBER' }] };
  return evaluateIssue(record, 'br', 'main', r.R, { ok: true, sha: head }, 615, 'ci-granted',
    { syncChain: (h, red) => ho.syncMergeChain(r.run, h, red) });
}

test('#615: merging the red trunk sha into the granted head keeps the grant (the measured deadlock)', () => {
  const r = redRepo();
  g(r.d, 'merge', '-q', '--no-edit', r.R);
  const M = g(r.d, 'rev-parse', 'HEAD');
  const v = verdict(r, M);
  assert.equal(v.ok, true, v.reason);
  assert.deepEqual(v.synced, { to: M, merges: 1 });
});

test('#615: merging a trunk sha OLDER than the red one still keeps it (ancestor of R)', () => {
  const r = redRepo();
  g(r.d, 'checkout', '-q', 'main');
  g(r.d, 'reset', '-q', '--hard', `${r.R}~1`);
  const older = r.commit('older.txt', 'older trunk\n', 'chore: older');
  const R2 = r.commit('check.txt', 'red\n', 'chore: red');
  g(r.d, 'checkout', '-q', 'br');
  g(r.d, 'merge', '-q', '--no-edit', older);
  const M = g(r.d, 'rev-parse', 'HEAD');
  const v = verdict({ ...r, R: R2 }, M);
  assert.equal(v.ok, true, v.reason);
});

test('#615: a commit of the branch\'s own after the sync voids it', () => {
  const r = redRepo();
  g(r.d, 'merge', '-q', '--no-edit', r.R);
  const after = r.commit('feature.txt', 'feature, changed after the review\n', 'fix: unreviewed');
  assert.equal(verdict(r, after).ok, false);
});

test('#615: a commit of its own BEFORE the sync voids it too — the walk stops short of H', () => {
  const r = redRepo();
  r.commit('feature.txt', 'feature, changed after the review\n', 'fix: unreviewed');
  g(r.d, 'merge', '-q', '--no-edit', r.R);
  assert.equal(verdict(r, g(r.d, 'rev-parse', 'HEAD')).ok, false);
});

test('#615: a sync merge carrying hand-written content voids it', () => {
  const r = redRepo();
  g(r.d, 'merge', '-q', '--no-edit', r.R);
  fs.writeFileSync(path.join(r.d, 'feature.txt'), 'smuggled into the merge\n');
  g(r.d, 'add', '-A'); g(r.d, 'commit', '-q', '--amend', '--no-edit');
  assert.equal(verdict(r, g(r.d, 'rev-parse', 'HEAD')).ok, false);
});

test('#615: merging trunk PAST the red sha voids it — that content was never reviewed against', () => {
  const r = redRepo();
  g(r.d, 'checkout', '-q', 'main');
  r.commit('later.txt', 'landed after the review\n', 'feat: later on trunk');
  g(r.d, 'checkout', '-q', 'br');
  g(r.d, 'merge', '-q', '--no-edit', 'main');
  assert.equal(verdict(r, g(r.d, 'rev-parse', 'HEAD')).ok, false);
});
