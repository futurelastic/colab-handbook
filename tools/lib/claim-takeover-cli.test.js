'use strict';
/**
 * #744 — end to end: `colab claim --force` over ANOTHER FACTORY's claim needs a stale holder and a
 * human, and removes the displaced holder's claim ref. Drives the REAL `colab` against a bare
 * `origin` whose trunk carries `.github/factories.yml`, a private COLAB_HOME, and a minimal stateful
 * fake `gh` (the claim-machines-cli.test.js shape). The other factory's machine is simulated the way
 * a real one appears to this tool: a claim lock on the remote whose `Machine:` names it, plus a
 * legacy `refs/claims/<branch>` it left. Activity age is the commit time of those refs, so "stale"
 * is seeded by backdating them.
 *
 * Run: `node --test tools/lib/claim-takeover-cli.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { machineLabel } = require('./branch-name');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const ME = machineLabel(os.hostname());
const DAY = 24 * 60 * 60;

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const KEY_A = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const KEY_B = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const FACTORIES_YML = `version: 1
steward: core
forge: github.com
factories:
  core:
    tier: steward
    machines: [${ME}, box-b]
    key: ${KEY_A}
  mobile:
    tier: partner
    machines: [mobile-1]
    key: ${KEY_B}
`;

const g = (cwd, args, env) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env }).trim();

function fixture({ factoriesFile = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-takeover-'));
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
  g(work, ['config', 'user.name', 'takeover test']);
  g(work, ['config', 'core.hooksPath', path.join(root, '.nohooks')]);
  g(work, ['remote', 'add', 'origin', origin]);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  if (factoriesFile) fs.writeFileSync(path.join(work, '.github', 'factories.yml'), FACTORIES_YML);
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
    "  st.comments.push({ createdAt: new Date(Date.UTC(2020, 0, 1) + st.comments.length * 1000).toISOString(), author: { login: 'me' }, body: argv[argv.indexOf('--body') + 1] });",
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
  return { root, origin, work, home, ghState, bin };
}

/**
 * Plant another machine's claim on #num: the lock `refs/heads/claim/<num>` (Machine: `holder`) and
 * the legacy claim ref `refs/claims/<branch>` an older cut left — both committed `ageDays` ago.
 */
function seedForeignClaim(fx, num, { holder, ageDays, branch = `feat/thing-${num}` }) {
  const at = `${Math.floor(Date.now() / 1000) - ageDays * DAY} +0000`;
  const env = { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at };
  const tree = g(fx.work, ['mktree'], env);
  const lockMsg = `claim: #${num}\n\nBranch: ${branch}\nMachine: ${holder}\nClaimed-At: ${new Date(Date.now() - ageDays * DAY * 1000).toISOString()}\n[skip ci]\n`;
  const lock = execFileSync('git', ['commit-tree', tree, '-m', lockMsg], { cwd: fx.work, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
  const cut = execFileSync('git', ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', `wip #${num}`], { cwd: fx.work, encoding: 'utf8', env: { ...process.env, ...env } }).trim();
  g(fx.work, ['push', '-q', 'origin', `${lock}:refs/heads/claim/${num}`, `${cut}:refs/claims/${branch}`]);
  return { lock, branch };
}

function colab(fx, args, { human = false } = {}) {
  const env = { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' };
  delete env.COLAB_HUMAN;
  if (human) env.COLAB_HUMAN = '1';
  const r = spawnSync('node', [COLAB, ...args, '--repo', fx.work], { cwd: fx.work, encoding: 'utf8', env });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const lsRemote = (fx, ref) => g(fx.work, ['ls-remote', 'origin', ref]).split(/\s+/)[0] || '';
const comments = (fx, num) => { try { return JSON.parse(fs.readFileSync(path.join(fx.ghState, `issue-${num}.json`), 'utf8')).comments; } catch (_) { return []; } };

test('#744: an agent cannot force another factory\'s FRESH claim — nothing moves', () => {
  const fx = fixture();
  const { lock, branch } = seedForeignClaim(fx, 7, { holder: 'mobile-1', ageDays: 1 });
  const r = colab(fx, ['claim', '7', '--worktree', 'w', '--session', 's1', '--force']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /another factory's claim/);
  assert.match(r.err, /#7 held by factory mobile; this machine is factory core/);
  assert.match(r.err, /not stale/);
  assert.match(r.err, /needs a human: COLAB_HUMAN=1/);
  assert.strictEqual(lsRemote(fx, 'refs/heads/claim/7'), lock, 'the holder\'s lock is untouched');
  assert.ok(lsRemote(fx, `refs/claims/${branch}`), 'the holder\'s claim ref is untouched');
  assert.deepStrictEqual(comments(fx, 7), [], 'no tracker write on a refusal');
});

test('#744: an agent cannot force a STALE one either — the human is the other half of the bar', () => {
  const fx = fixture();
  const { lock } = seedForeignClaim(fx, 7, { holder: 'mobile-1', ageDays: 9 });
  const r = colab(fx, ['claim', '7', '--worktree', 'w', '--session', 's1', '--force', '--answered-by', 'Ada']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /needs a human/);
  assert.doesNotMatch(r.err, /not stale/);
  assert.strictEqual(lsRemote(fx, 'refs/heads/claim/7'), lock);
});

test('#744: a human cannot force a FRESH one', () => {
  const fx = fixture();
  const { lock } = seedForeignClaim(fx, 7, { holder: 'mobile-1', ageDays: 2 });
  const r = colab(fx, ['claim', '7', '--worktree', 'w', '--session', 's1', '--force', '--answered-by', 'Ada'], { human: true });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /not stale/);
  assert.doesNotMatch(r.err, /needs a human/);
  assert.strictEqual(lsRemote(fx, 'refs/heads/claim/7'), lock);
});

test('#744: a human can force a STALE one, and the old holder\'s refs are gone afterwards', () => {
  const fx = fixture();
  const { lock, branch } = seedForeignClaim(fx, 7, { holder: 'mobile-1', ageDays: 9 });
  const r = colab(fx, ['claim', '7', '--worktree', 'w', '--session', 's1', '--force', '--answered-by', 'Ada'], { human: true });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /another factory's claim \(mobile\), idle 9 days — taken over by factory core, answered by Ada/);
  const now = lsRemote(fx, 'refs/heads/claim/7');
  assert.ok(now && now !== lock, 'the lock now points at this claim, not the old holder\'s');
  g(fx.work, ['fetch', '-q', 'origin', 'refs/heads/claim/7']);
  assert.match(g(fx.work, ['log', '-1', '--format=%B', 'FETCH_HEAD']), /Claimed-By: colab/);
  assert.strictEqual(lsRemote(fx, `refs/claims/${branch}`), '', 'the displaced holder\'s claim ref is removed');
  const notes = comments(fx, 7).map((c) => c.body);
  assert.ok(notes.some((b) => /Cross-factory takeover \(#744\).*factory `mobile`.*9 days.*factory `core`.*answered by Ada/.test(b)), notes.join('\n'));
});

test('#744: a holder proven to be this machine\'s own factory is taken over as before — no human, no wait', () => {
  const fx = fixture();
  const { lock, branch } = seedForeignClaim(fx, 7, { holder: 'box-b', ageDays: 0 });
  const r = colab(fx, ['claim', '7', '--worktree', 'w', '--session', 's1', '--force']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.notStrictEqual(lsRemote(fx, 'refs/heads/claim/7'), lock);
  assert.strictEqual(lsRemote(fx, `refs/claims/${branch}`), '', 'a takeover removes the displaced claim ref on any --force');
});

test('#744: a holder nothing ties to a factory fails closed', () => {
  const fx = fixture();
  seedForeignClaim(fx, 7, { holder: 'unlisted-box', ageDays: 1 });
  const r = colab(fx, ['claim', '7', '--worktree', 'w', '--session', 's1', '--force']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /unknown — no record ties the holder to a factory/);
});

test('#744: no factories file on trunk — --force behaves as before', () => {
  const fx = fixture({ factoriesFile: false });
  const { lock } = seedForeignClaim(fx, 7, { holder: 'mobile-1', ageDays: 0 });
  const r = colab(fx, ['claim', '7', '--worktree', 'w', '--session', 's1', '--force']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out + r.err, /factory/);
  assert.notStrictEqual(lsRemote(fx, 'refs/heads/claim/7'), lock);
});

test('#744: worktree new --issues --force clears the same bar', () => {
  const fx = fixture();
  const { lock } = seedForeignClaim(fx, 7, { holder: 'mobile-1', ageDays: 1 });
  const r = colab(fx, ['worktree', 'new', 'feat/other-7', '--issues', '7', '--session', 's1', '--force']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /another factory's claim/);
  assert.strictEqual(lsRemote(fx, 'refs/heads/claim/7'), lock);
  assert.ok(!fs.existsSync(path.join(fx.work, '.claude', 'worktrees', 'other-7')), 'refused before any worktree is cut');
});
