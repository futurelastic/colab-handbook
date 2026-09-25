'use strict';
/**
 * End-to-end CLI tests for WHERE and AS WHAT `colab worktree new` cuts — group:session-branch-origin:
 *   #349  the cut is a freshly fetched origin/<trunk>, never local trunk; a failed fetch REFUSES
 *         (nothing created) instead of cutting from the cached remote-tracking ref.
 *   #348  under `branchPrefix: machine` the branch is <login>/<machine>/<type>/<slug>-<N>, pushed at
 *         cut, and read by another machine as a claim exactly like the unprefixed shape.
 *
 * Same harness as claim-machines-cli.test.js (real `colab`, real bare origin, a private COLAB_HOME
 * per "machine", a stateful fake `gh` whose `api user` answers `me`). The fixture helpers are
 * copied from there rather than required: requiring a test file registers its tests.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-machines-'));
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
  g(work, 'config', 'user.name', 'claim-machines test');
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

/** A second "machine": its own clone of the same origin and its own COLAB_HOME, same tracker. */
function machineB(fx) {
  const work = path.join(fx.root, 'work-b');
  execFileSync('git', ['clone', '-q', fx.origin, work]);
  g(work, 'config', 'user.email', 'b@example.invalid');
  g(work, 'config', 'user.name', 'machine b');
  g(work, 'config', 'core.hooksPath', path.join(fx.root, '.nohooks'));
  const home = path.join(fx.root, 'home-b');
  fs.mkdirSync(home);
  return { work, home };
}

function colab(fx, args, { work = fx.work, home = fx.home } = {}) {
  // `claims` and `doctor` read machine-local state for every repo and take no --repo; run them in
  // the clone instead so cwd-based repo resolution (doctor --sync) sees the same repo.
  const repoScoped = args[0] === 'claim' || args[0] === 'worktree' || args[0] === 'release';
  const r = spawnSync('node', [COLAB, ...args, ...(repoScoped ? ['--repo', work] : [])], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function readState(home) {
  try { return JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
const sha = (cwd, ref) => g(cwd, 'rev-parse', ref).trim();
const remoteHeads = (fx) => g(fx.work, 'ls-remote', '--heads', 'origin').split('\n').filter(Boolean).map((l) => l.split('\t')[1].replace('refs/heads/', ''));

/** Advance origin/main from ANOTHER clone, so this clone's local main AND its origin/main cache lag. */
function advanceOrigin(fx) {
  const other = path.join(fx.root, 'other');
  execFileSync('git', ['clone', '-q', fx.origin, other]);
  g(other, 'config', 'user.email', 'o@example.invalid');
  g(other, 'config', 'user.name', 'other');
  g(other, 'config', 'core.hooksPath', path.join(fx.root, '.nohooks'));
  fs.writeFileSync(path.join(other, 'f.txt'), 'moved on\n');
  g(other, 'commit', '-q', '-am', 'feat: origin moved on');
  g(other, 'push', '-q', 'origin', 'main');
  return sha(other, 'HEAD');
}

/** Declare `branchPrefix: machine` in the fixture repo (the working tree is what the CLI reads). */
function adoptPrefix(fx) {
  fs.appendFileSync(path.join(fx.work, '.github', 'project.yml'), 'branchPrefix: machine\n');
  g(fx.work, 'commit', '-q', '-am', 'chore: adopt branchPrefix');
  g(fx.work, 'push', '-q', 'origin', 'main');
}

test('#349: the cut is origin\'s tip after a fetch — not local main, not the stale origin/main cache', () => {
  const fx = fixture();
  const localMain = sha(fx.work, 'main');
  const staleCache = sha(fx.work, 'origin/main');
  const tip = advanceOrigin(fx);
  assert.notStrictEqual(tip, localMain);
  assert.strictEqual(sha(fx.work, 'origin/main'), staleCache, 'precondition: the cache is stale before the run');

  const r = colab(fx, ['worktree', 'new', 'feat/x-9']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(sha(fx.work, 'feat/x-9'), tip, 'branch must start at origin\'s tip');
  assert.notStrictEqual(sha(fx.work, 'feat/x-9'), localMain);
  assert.ok(r.out.includes(`base origin/main @ ${tip.slice(0, 7)}`), r.out);
});

test('#349: a failed fetch REFUSES — no worktree, no branch, no record — instead of cutting from the cache', () => {
  const fx = fixture();
  g(fx.work, 'remote', 'set-url', 'origin', path.join(fx.root, 'gone.git'));
  const r = colab(fx, ['worktree', 'new', 'feat/x-9']);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /fetch/);
  assert.ok(!fs.existsSync(path.join(fx.work, '.worktrees', 'x-9')), 'no worktree directory');
  assert.strictEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/x-9'], { cwd: fx.work }).status, 1, 'no local branch');
  const st = readState(fx.home);
  assert.ok(!st || !st.worktrees || !Object.keys(st.worktrees).length, 'no worktree record');
});

test('#348: without branchPrefix the branch is exactly the name given', () => {
  const fx = fixture();
  const r = colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.ok(remoteHeads(fx).includes('feat/x-9'), remoteHeads(fx).join(','));
  assert.ok(fs.existsSync(path.join(fx.work, '.worktrees', 'x-9')));
});

test('#348: under branchPrefix: machine, worktree new cuts and pushes <login>/<machine>/<type>/<slug>-<N>', (t) => {
  if (!LABEL) return t.skip('no machine label derivable from this host name');
  const fx = fixture();
  adoptPrefix(fx);
  const want = `me/${LABEL}/feat/x-9`;
  const r = colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.ok(remoteHeads(fx).includes(want), remoteHeads(fx).join(','));
  assert.ok(fs.existsSync(path.join(fx.work, '.worktrees', 'x-9')), 'worktree dir is the slug, not a nested path');
  const wt = Object.values(readState(fx.home).worktrees)[0];
  assert.strictEqual(wt.branch, want);
});

test('#348: an explicit prefix naming ANOTHER machine is refused before anything is created', () => {
  const fx = fixture();
  adoptPrefix(fx);
  const r = colab(fx, ['worktree', 'new', 'me/not-this-box-zz/feat/x-9']);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /names machine "not-this-box-zz"/);
  assert.ok(!fs.existsSync(path.join(fx.work, '.worktrees', 'x-9')));
});

test('#348: a prefixed branch on origin is another machine\'s claim — machine B is refused on the same issue', (t) => {
  if (!LABEL) return t.skip('no machine label derivable from this host name');
  const fx = fixture();
  adoptPrefix(fx);
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 's1']).code, 0);

  const b = machineB(fx);
  const r = colab(fx, ['worktree', 'new', 'feat/y-9', '--issues', '9', '--session', 's2'], b);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.ok((r.out + r.err).includes(`me/${LABEL}/feat/x-9`), 'the refusal names the prefixed branch holding the claim\n' + r.out + r.err);
});

// ---------------------------------------------------------------------------
// #301 — a repo whose remote is not named `origin`
// ---------------------------------------------------------------------------

test('#301: the only remote is `upstream` — worktree new fetches, cuts from and pushes the claim to upstream', () => {
  const fx = fixture();
  g(fx.work, 'remote', 'rename', 'origin', 'upstream');
  const tip = sha(fx.work, 'upstream/main');
  const r = colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(sha(fx.work, 'feat/x-9'), tip);
  assert.ok(r.out.includes(`base upstream/main @ ${tip.slice(0, 7)}`), r.out);
  assert.ok(r.out.includes('pushed feat/x-9 → upstream'), r.out);
  const heads = g(fx.work, 'ls-remote', '--heads', 'upstream');
  assert.match(heads, /refs\/heads\/feat\/x-9$/m);
  assert.ok(fs.existsSync(path.join(fx.work, '.worktrees', 'x-9')));
  assert.ok(Object.values(readState(fx.home).claims || {}).some((c) => c.issue === '#9'), 'claim recorded');
});

test('#301: two remotes, neither origin — worktree new refuses, names both and the fix, and creates nothing', () => {
  const fx = fixture();
  g(fx.work, 'remote', 'rename', 'origin', 'a');
  const b = path.join(fx.root, 'b.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', b]);
  g(fx.work, 'remote', 'add', 'b', b);
  const r = colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 's1']);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /\(a, b\)/);
  assert.match(r.err, /git config colab\.remote <name>/);
  assert.ok(!fs.existsSync(path.join(fx.work, '.worktrees', 'x-9')), 'no worktree directory');
  assert.strictEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/x-9'], { cwd: fx.work }).status, 1, 'no local branch');
  const st = readState(fx.home);
  assert.ok(!st || !Object.keys(st.worktrees || {}).length, 'no worktree record');
  assert.ok(!st || !Object.keys(st.claims || {}).length, 'no claim record');
  assert.ok(!fs.existsSync(path.join(fx.ghState, 'issue-9.json')), 'nothing written to the tracker');
});

test('#301: two remotes resolved by `git config colab.remote` — the cut and the push go to the named one', () => {
  const fx = fixture();
  g(fx.work, 'remote', 'rename', 'origin', 'a');
  const b = path.join(fx.root, 'b.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', b]);
  g(fx.work, 'remote', 'add', 'b', b);
  g(fx.work, 'config', 'colab.remote', 'a');
  const r = colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.ok(r.out.includes('base a/main @'), r.out);
  assert.match(g(fx.work, 'ls-remote', '--heads', 'a'), /refs\/heads\/feat\/x-9$/m);
  assert.strictEqual(g(fx.work, 'ls-remote', '--heads', 'b').trim(), '', 'nothing pushed to the other remote');
});
