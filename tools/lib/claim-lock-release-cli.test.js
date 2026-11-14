'use strict';
/**
 * End-to-end CLI tests for #746: teardown releases the claim lock `refs/heads/claim/<N>` even when the
 * claim record carries no `lock` field — looked up on the remote, released leased on the sha read when
 * the lock names that issue and this claimer, otherwise left in place with the exact delete command.
 *
 * A lock-less record is what a colab older than #741 writes when an orchestrator took the lock at
 * spawn (measured on #746 itself), and what `doctor --sync` writes from the tracker. The tests make
 * that shape the honest way: cut with today's colab, then drop `lock` from the record.
 *
 * Same harness as worktree-cut-cli.test.js (real `colab`, real bare origin, a private COLAB_HOME, a
 * stateful fake `gh`). The fixture is copied rather than required: requiring a test file registers
 * its tests.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const branchName = require('./branch-name');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const LABEL = branchName.machineLabel(os.hostname());

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-lock-release-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'home-a');
  const ghState = path.join(root, 'gh-state');
  fs.mkdirSync(home);
  fs.mkdirSync(ghState);

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'lock-release test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'remote', 'set-head', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const ghScript = path.join(bin, 'gh-fake.js');
  fs.writeFileSync(ghScript, [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    `const STATE = ${JSON.stringify(ghState)};`,
    "const argv = process.argv.slice(2);",
    "fs.appendFileSync(path.join(STATE, 'calls.log'), JSON.stringify(argv) + '\\n');",
    "if (argv[0] === '--version') { console.log('gh version 0.0.0 (fixture)'); process.exit(0); }",
    "if (argv[0] === 'auth' && argv[1] === 'status') { console.error('Logged in (fixture)'); process.exit(0); }",
    "if (argv[0] === 'api' && argv[1] === 'user') { console.log('me'); process.exit(0); }",
    // The tracker outage switch: every issue read/write fails while `offline` exists.
    "if (argv[0] === 'issue' && fs.existsSync(path.join(STATE, 'offline'))) { console.error('HTTP 503 (fixture offline)'); process.exit(1); }",
    "function issueFile(n) { return path.join(STATE, `issue-${n}.json`); }",
    "function load(n) { try { return JSON.parse(fs.readFileSync(issueFile(n), 'utf8')); } catch (_) { return { comments: [], assignees: [], labels: [] }; } }",
    "function save(n, st) { fs.writeFileSync(issueFile(n), JSON.stringify(st)); }",
    "function counter() { const f = path.join(STATE, 'counter'); let c = 0; try { c = parseInt(fs.readFileSync(f, 'utf8'), 10) || 0; } catch (_) {} fs.writeFileSync(f, String(c + 1)); return c; }",
    "if (argv[0] === 'issue' && argv[1] === 'edit') {",
    "  const n = argv[2]; const st = load(n);",
    "  if (argv.includes('--add-assignee')) { if (!st.assignees.includes('me')) st.assignees.push('me'); }",
    "  if (argv.includes('--add-label')) { if (!st.labels.includes('in-progress')) st.labels.push('in-progress'); }",
    "  if (argv.includes('--remove-assignee')) { st.assignees = st.assignees.filter((a) => a !== 'me'); }",
    "  if (argv.includes('--remove-label')) { st.labels = st.labels.filter((l) => l !== 'in-progress'); }",
    "  save(n, st); process.exit(0);",
    "}",
    "if (argv[0] === 'issue' && argv[1] === 'comment') {",
    "  const n = argv[2]; const body = argv[argv.indexOf('--body') + 1];",
    "  const st = load(n); const c = counter();",
    "  st.comments.push({ createdAt: new Date(Date.UTC(2020, 0, 1) + (1000 + c) * 1000).toISOString(), author: { login: 'me' }, body });",
    "  save(n, st); process.exit(0);",
    "}",
    "if (argv[0] === 'issue' && argv[1] === 'view') {",
    "  const n = argv[2]; const st = load(n);",
    "  console.log(JSON.stringify({ state: 'OPEN', comments: st.comments, assignees: st.assignees.map((login) => ({ login })), labels: st.labels.map((name) => ({ name })) }));",
    "  process.exit(0);",
    "}",
    "console.error(`fixture gh: unscripted — args: ${JSON.stringify(argv)}`); process.exit(1);",
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec node ${JSON.stringify(ghScript)} "$@"\n`, { mode: 0o755 });


  return { root, origin, work, home, ghState, bin };
}

function colab(fx, args, { work = fx.work, home = fx.home } = {}) {
  const repoScoped = args[0] === 'claim' || args[0] === 'worktree' || args[0] === 'release';
  const r = spawnSync('node', [COLAB, ...args, ...(repoScoped ? ['--repo', work] : [])], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', COLAB_HUMAN: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function readState(home) { return JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8')); }
function writeState(home, st) { fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(st, null, 2)); }
/** Drop `lock` from #num's claim record — the record a pre-#741 colab (or `doctor --sync`) writes. */
function dropRecordedLock(fx, num) {
  const st = readState(fx.home);
  const key = Object.keys(st.claims).find((k) => st.claims[k].issue === `#${num}`);
  assert.ok(key, `a claim record for #${num}`);
  assert.ok(st.claims[key].lock, 'precondition: today\'s colab recorded the lock');
  delete st.claims[key].lock;
  writeState(fx.home, st);
}
const remoteLocks = (fx) => g(fx.work, 'ls-remote', 'origin', 'refs/heads/claim/*').split('\n').filter(Boolean).map((l) => l.split('\t')[1].replace('refs/heads/claim/', ''));
const lockSha = (fx, num) => g(fx.work, 'ls-remote', 'origin', `refs/heads/claim/${num}`).split('\t')[0].trim();
/** Plant a lock commit on origin the way another writer would; `force` overwrites one already there. */
function plantLock(fx, num, { author = 'orchestrator-claim', message, force = false }) {
  const env = { ...process.env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: 'claim@x.invalid', GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: 'claim@x.invalid' };
  const c = execFileSync('git', ['commit-tree', 'main^{tree}', '-p', 'main', '-m', message], { cwd: fx.work, env, encoding: 'utf8' }).trim();
  g(fx.work, 'push', '-q', ...(force ? ['--force'] : []), 'origin', `${c}:refs/heads/claim/${num}`);
  return c;
}
const deleteCmd = (num, sha) => `git push origin --force-with-lease=refs/heads/claim/${num}:${sha} --delete refs/heads/claim/${num}`;

test('#746: an orchestrator lock adopted at spawn, record without `lock` → worktree rm releases it', (t) => {
  if (!LABEL) return t.skip('no machine label derivable from this host name');
  const fx = fixture();
  plantLock(fx, 7, { author: 'orchestrator-claim', message: `claim: #7\n\nMachine: ${LABEL}\nIntent: 1\nClaim-Id: abc\n[skip ci]` });
  const r = colab(fx, ['worktree', 'new', 'feat/x-7', '--issues', '7', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  dropRecordedLock(fx, 7);
  const rm = colab(fx, ['worktree', 'rm', 'x-7']);
  assert.strictEqual(rm.code, 0, rm.out + rm.err);
  assert.match(rm.out, /released claim lock origin refs\/heads\/claim\/7 \(the claim record named no lock/);
  assert.deepStrictEqual(remoteLocks(fx), []);
});

test('#746: colab\'s own lock, record without `lock` but the same session → worktree rm releases it', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/x-7', '--issues', '7', '--session', 's1']).code, 0);
  dropRecordedLock(fx, 7);
  const rm = colab(fx, ['worktree', 'rm', 'x-7']);
  assert.strictEqual(rm.code, 0, rm.out + rm.err);
  assert.match(rm.out, /released claim lock origin refs\/heads\/claim\/7/);
  assert.deepStrictEqual(remoteLocks(fx), []);
});

test('#746: a lock naming ANOTHER machine is left in place, and the warning names the leased delete command', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/x-7', '--issues', '7', '--session', 's1']).code, 0);
  dropRecordedLock(fx, 7);
  const foreign = plantLock(fx, 7, { message: 'claim: #7\n\nMachine: other-box-zz\n[skip ci]', force: true });
  const rm = colab(fx, ['worktree', 'rm', 'x-7']);
  assert.strictEqual(rm.code, 0, rm.out + rm.err);
  const said = rm.out + rm.err;
  assert.match(said, /not provably this claim's \(orchestrator-claim wrote it for machine other-box-zz, not this one\)/);
  assert.ok(said.includes(deleteCmd(7, foreign)), said);
  assert.strictEqual(lockSha(fx, 7), foreign, 'the foreign lock survives');
});

test('#746: colab\'s lock for a DIFFERENT session is left in place with the delete command', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/x-7', '--issues', '7', '--session', 's1']).code, 0);
  dropRecordedLock(fx, 7);
  const st = readState(fx.home);
  const key = Object.keys(st.claims).find((k) => st.claims[k].issue === '#7');
  st.claims[key].session = 's-other';
  writeState(fx.home, st);
  const held = lockSha(fx, 7);
  const rm = colab(fx, ['worktree', 'rm', 'x-7']);
  assert.strictEqual(rm.code, 0, rm.out + rm.err);
  const said = rm.out + rm.err;
  assert.match(said, /colab wrote it for session s1, this claim is session s-other/);
  assert.ok(said.includes(deleteCmd(7, held)), said);
  assert.strictEqual(lockSha(fx, 7), held);
});

test('#746: a lock on claim/N whose commit names another issue is left in place', (t) => {
  if (!LABEL) return t.skip('no machine label derivable from this host name');
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/x-7', '--issues', '7', '--session', 's1']).code, 0);
  dropRecordedLock(fx, 7);
  const odd = plantLock(fx, 7, { message: `claim: #99\n\nMachine: ${LABEL}\n[skip ci]`, force: true });
  const rm = colab(fx, ['worktree', 'rm', 'x-7']);
  assert.strictEqual(rm.code, 0, rm.out + rm.err);
  assert.match(rm.out + rm.err, /the lock commit names #99, not #7/);
  assert.strictEqual(lockSha(fx, 7), odd);
});

test('#746: colab release frees a trunk claim\'s lock when the record has no `lock`', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '8', '--session', 's1']).code, 0);
  dropRecordedLock(fx, 8);
  const rr = colab(fx, ['release', '8']);
  assert.strictEqual(rr.code, 0, rr.out + rr.err);
  assert.match(rr.out, /released claim lock origin refs\/heads\/claim\/8/);
  assert.deepStrictEqual(remoteLocks(fx), []);
});

test('#746: no lock on the remote and none recorded → teardown is silent about locks', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/x-7', '--issues', '7', '--session', 's1']).code, 0);
  dropRecordedLock(fx, 7);
  g(fx.work, 'push', '-q', 'origin', '--delete', 'refs/heads/claim/7');
  const rm = colab(fx, ['worktree', 'rm', 'x-7']);
  assert.strictEqual(rm.code, 0, rm.out + rm.err);
  assert.doesNotMatch(rm.out + rm.err, /claim lock/);
});
