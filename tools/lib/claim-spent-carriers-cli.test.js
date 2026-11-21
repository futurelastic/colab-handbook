'use strict';
/**
 * #760 — end to end: a REOPENED issue whose only carriers on the remote are a squash-shipped branch
 * and a prepared revert can be claimed again, and both refs are named as skipped with their delete
 * commands; a live branch, a freshly cut one and an unproven one still refuse. Drives the REAL
 * `colab` against a bare `origin`, a private COLAB_HOME and a minimal fake `gh` (the
 * claim-takeover-cli.test.js shape). "Another machine's branch" is simply a branch pushed to the
 * remote that no claim record on this machine names — exactly how a real one appears to this tool.
 *
 * Run: `node --test tools/lib/claim-spent-carriers-cli.test.js`.
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
const g = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-spent-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'home');
  const ghState = path.join(root, 'gh-state');
  fs.mkdirSync(home);
  fs.mkdirSync(ghState);
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, ['config', 'user.email', 'test@example.invalid']);
  g(work, ['config', 'user.name', 'spent carriers test']);
  g(work, ['config', 'core.hooksPath', path.join(root, '.nohooks')]);
  g(work, ['remote', 'add', 'origin', origin]);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  g(work, ['add', '-A']);
  g(work, ['commit', '-q', '-m', 'chore: fixture']);
  g(work, ['push', '-q', 'origin', 'main']);

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const ghScript = path.join(bin, 'gh-fake.js');
  fs.writeFileSync(ghScript, [
    "'use strict';",
    "const fs = require('fs'); const path = require('path');",
    `const STATE = ${JSON.stringify(ghState)};`,
    "const argv = process.argv.slice(2);",
    "if (argv[0] === '--version') { console.log('gh version 0.0.0 (fixture)'); process.exit(0); }",
    "if (argv[0] === 'auth' && argv[1] === 'status') { console.error('Logged in (fixture)'); process.exit(0); }",
    "if (argv[0] === 'api' && argv[1] === 'user') { console.log('me'); process.exit(0); }",
    "function file(n) { return path.join(STATE, `issue-${n}.json`); }",
    "function load(n) { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch (_) { return { comments: [], assignees: [], labels: [] }; } }",
    "function save(n, st) { fs.writeFileSync(file(n), JSON.stringify(st)); }",
    "if (argv[0] === 'issue' && argv[1] === 'edit') {",
    "  const n = argv[2]; const st = load(n);",
    "  if (argv.includes('--add-assignee') && !st.assignees.includes('me')) st.assignees.push('me');",
    "  if (argv.includes('--add-label') && !st.labels.includes('in-progress')) st.labels.push('in-progress');",
    "  save(n, st); process.exit(0);",
    "}",
    "if (argv[0] === 'issue' && argv[1] === 'comment') {",
    "  const n = argv[2]; const st = load(n);",
    "  st.comments.push({ createdAt: new Date().toISOString(), author: { login: 'me' }, body: argv[argv.indexOf('--body') + 1] });",
    "  save(n, st); process.exit(0);",
    "}",
    "if (argv[0] === 'issue' && argv[1] === 'view') {",
    "  const st = load(argv[2]);",
    "  console.log(JSON.stringify({ state: 'OPEN', comments: st.comments, assignees: st.assignees.map((login) => ({ login })), labels: st.labels.map((name) => ({ name })) }));",
    "  process.exit(0);",
    "}",
    "console.error(`fixture gh: unscripted — ${JSON.stringify(argv)}`); process.exit(1);",
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec node ${JSON.stringify(ghScript)} "$@"\n`, { mode: 0o755 });
  return { root, origin, work, home, bin };
}

function commitFile(fx, name, body, message) {
  fs.writeFileSync(path.join(fx.work, name), body);
  g(fx.work, ['add', name]);
  g(fx.work, ['commit', '-q', '-m', message]);
  return g(fx.work, ['rev-parse', 'HEAD']);
}

/** A branch off main carrying `files`, one commit each, pushed; the work tree returns to main. */
function pushBranch(fx, branch, files) {
  g(fx.work, ['checkout', '-q', '-b', branch, 'main']);
  for (const f of files) commitFile(fx, f, `${f}\n`, `wip: ${f}`);
  g(fx.work, ['push', '-q', 'origin', branch]);
  g(fx.work, ['checkout', '-q', 'main']);
}

/** Squash-merge `branch` into main with `message` and push main — the branch stays on the remote. */
function squashShip(fx, branch, message) {
  g(fx.work, ['merge', '-q', '--squash', branch]);
  g(fx.work, ['commit', '-q', '-m', message]);
  g(fx.work, ['push', '-q', 'origin', 'main']);
  return g(fx.work, ['rev-parse', 'HEAD']);
}

/** A prepared revert of `sha`, named `fix/revert-<sha7>-<num>`, pushed but never merged. */
function pushRevert(fx, sha, num) {
  const branch = `fix/revert-${sha.slice(0, 7)}-${num}`;
  g(fx.work, ['checkout', '-q', '-b', branch, 'main']);
  g(fx.work, ['revert', '--no-edit', sha]);
  g(fx.work, ['push', '-q', 'origin', branch]);
  g(fx.work, ['checkout', '-q', 'main']);
  return branch;
}

function colab(fx, args) {
  const env = { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' };
  delete env.COLAB_HUMAN;
  const r = spawnSync('node', [COLAB, ...args, '--repo', fx.work], { cwd: fx.work, encoding: 'utf8', env });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test('#760: a reopened issue whose only carriers are a squash-shipped branch and a prepared revert is claimable — both refs listed as skipped', () => {
  const fx = fixture();
  pushBranch(fx, 'fix/thing-7', ['a.txt', 'b.txt']); // two commits: the multi-commit squash git cherry gets wrong
  const ship = squashShip(fx, 'fix/thing-7', 'fix: the thing (#7)\n\nCloses #7');
  commitFile(fx, 'later.txt', 'later\n', 'chore: trunk moved on after the ship');
  g(fx.work, ['push', '-q', 'origin', 'main']);
  const revert = pushRevert(fx, ship, 7);

  const r = colab(fx, ['claim', '7', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /#7: skipped origin\/fix\/thing-7 @ \w{7} — already shipped — its change is on main \(\w+ references #7\)/);
  assert.match(r.out, /Delete it: git push origin --delete fix\/thing-7/);
  assert.match(r.out, new RegExp(`#7: skipped origin/${revert.replace(/\//g, '\\/')} @ \\w{7} — prepared revert of ${ship.slice(0, 7)} \\(on main\\), not a claim`));
  assert.match(r.out, new RegExp(`Delete it: git push origin --delete ${revert.replace(/\//g, '\\/')}`));
  assert.ok(g(fx.work, ['ls-remote', 'origin', 'refs/heads/fix/thing-7']), 'the skipped branch is named, never deleted');
});

test('#760: a live, unshipped branch carrying #N still refuses', () => {
  const fx = fixture();
  pushBranch(fx, 'fix/other-8', ['c.txt']);
  const r = colab(fx, ['claim', '8', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /#8 remote: branch origin\/fix\/other-8 @ \w{7} carries it/);
  assert.doesNotMatch(r.out, /skipped/);
});

test('#760: a branch with no commits ahead of trunk still refuses — no commits is not no branch', () => {
  const fx = fixture();
  commitFile(fx, 'd.txt', 'd\n', 'fix: something (#9)');
  g(fx.work, ['push', '-q', 'origin', 'main', 'main:refs/heads/fix/fresh-9']);
  const r = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /#9 remote: branch origin\/fix\/fresh-9/);
});

test('#760: content on trunk but no trunk commit referencing #N — still a carrier', () => {
  const fx = fixture();
  pushBranch(fx, 'fix/quiet-10', ['e.txt', 'f.txt']);
  squashShip(fx, 'fix/quiet-10', 'fix: a squash that names no issue');
  const r = colab(fx, ['claim', '10', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /#10 remote: branch origin\/fix\/quiet-10/);
});

test('#760: a revert-shaped name whose sha is not on trunk still refuses', () => {
  const fx = fixture();
  pushBranch(fx, 'fix/revert-abcdef1-11', ['g.txt']);
  const r = colab(fx, ['claim', '11', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /#11 remote: branch origin\/fix\/revert-abcdef1-11/);
});

test('#760: one live carrier beside a spent one — refused, and the spent one is still named', () => {
  const fx = fixture();
  pushBranch(fx, 'fix/thing-12', ['h.txt', 'i.txt']);
  squashShip(fx, 'fix/thing-12', 'fix: the thing (#12)');
  pushBranch(fx, 'feat/again-12', ['j.txt']);
  const r = colab(fx, ['claim', '12', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /#12 remote: branch origin\/feat\/again-12/);
  assert.doesNotMatch(r.err, /origin\/fix\/thing-12 @/);
  assert.match(r.out, /#12: skipped origin\/fix\/thing-12/);
});

test('#760: shipped, then trunk rewrote the same lines — content says unknown, the tree match still proves it', () => {
  const fx = fixture();
  commitFile(fx, 'k.txt', 'one\n', 'chore: a file both sides edit');
  g(fx.work, ['push', '-q', 'origin', 'main']);
  pushBranch(fx, 'fix/edit-13', ['l.txt']);
  g(fx.work, ['checkout', '-q', 'fix/edit-13']);
  commitFile(fx, 'k.txt', 'two\n', 'wip: edit k');
  g(fx.work, ['push', '-q', 'origin', 'fix/edit-13']);
  g(fx.work, ['checkout', '-q', 'main']);
  const ship = squashShip(fx, 'fix/edit-13', 'fix: edit (#13)');
  commitFile(fx, 'k.txt', 'three\n', 'chore: trunk rewrites the shipped line');
  g(fx.work, ['push', '-q', 'origin', 'main']);
  const r = colab(fx, ['claim', '13', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, new RegExp(`#13: skipped origin/fix/edit-13 @ \\w{7} — already shipped — its tree is ${ship.slice(0, 7)} on main`));
});
