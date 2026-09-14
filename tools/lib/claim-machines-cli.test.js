'use strict';
/**
 * End-to-end CLI tests for claims across machines — group:claims-across-machines, one branch:
 *   #327  claims carry the canonical machine id; one machine never reads as two claimants.
 *   #326  a planner `--session intent:<id>` claim, upgraded in place by its session, pruned if orphaned.
 *   #325  the branch on the git remote is the claim record: pushed at cut, refused across machines,
 *         fail closed without the remote, tracker outage = pending (not blocking).
 *
 * Drives the REAL `colab` against a real bare `origin`, a private COLAB_HOME per "machine", and a
 * stateful fake `gh` (same shape as claim-reclaim-cli.test.js, plus an `offline` switch). "Machine B"
 * is a second clone of the same bare origin with its OWN COLAB_HOME sharing the fake tracker — which
 * is exactly what another machine is to this tool: a different local state, the same remote and
 * tracker. Its hardware id is necessarily this test host's, so a truly FOREIGN machine on the tracker
 * is simulated by seeding a claim comment carrying a different `machine` token.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const machine = require('./machine');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const HOST = os.hostname();
const LOCAL_ID = machine.localMachine().id;
const FOREIGN_TOKEN = 'm:000000000000';

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

function fakeIso(n) { return new Date(Date.UTC(2020, 0, 1) + n * 1000).toISOString(); }

function claimBody({ wt = null, branch = null, host, iso, machineTok = '', session = '' }) {
  let body = `🔒 Claimed — worktree \`${wt || '-'}\` · branch \`${branch || '-'}\` · host \`${host}\` · ${iso}`;
  if (machineTok) body += ` · machine \`${machineTok}\``;
  if (session) body += ` · session ${session}`;
  return body;
}

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

function seedIssue(fx, num, st) {
  fs.writeFileSync(path.join(fx.ghState, `issue-${num}.json`), JSON.stringify({ comments: [], assignees: [], labels: [], ...st }));
}
function issueState(fx, num) {
  try { return JSON.parse(fs.readFileSync(path.join(fx.ghState, `issue-${num}.json`), 'utf8')); }
  catch (_) { return { comments: [], assignees: [], labels: [] }; }
}
function trackerWrites(fx, num) {
  let lines = [];
  try { lines = fs.readFileSync(path.join(fx.ghState, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
  catch (_) { /* none */ }
  return lines.filter((a) => a[0] === 'issue' && (a[1] === 'edit' || a[1] === 'comment') && a[2] === String(num));
}
function readState(home) {
  try { return JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function writeState(home, st) { fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(st, null, 2)); }
function claimsFor(home, num) {
  const st = readState(home);
  return st ? Object.entries(st.claims).filter(([, c]) => c.issue === `#${num}`) : [];
}
function remoteHas(fx, branch) {
  return g(fx.work, 'ls-remote', 'origin', `refs/heads/${branch}`).trim() !== '';
}
function jsonOut(out) { return JSON.parse(out.slice(out.indexOf('{'))); }

// --- #327: canonical machine id ------------------------------------------------------------------

test('#327: a claim records the canonical machine id, and its comment carries only the digest', (t) => {
  if (!LOCAL_ID) return t.skip('no machine id resolvable on this host');
  const fx = fixture();
  const r = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const [[, c]] = claimsFor(fx.home, 9);
  assert.strictEqual(c.machine, LOCAL_ID);
  const body = issueState(fx, 9).comments[0].body;
  assert.match(body, /· machine `m:[0-9a-f]{12}`/);
  assert.ok(body.includes(machine.machineToken(LOCAL_ID)));
  assert.ok(!body.includes(LOCAL_ID), 'the raw hardware id must never be posted');
  assert.match(body, /🔒 Claimed — worktree `w` · branch `-` · host `[^`]*` · \S+/, 'legacy four-field prefix still parses');
  assert.match(body, /· session s1$/, 'session suffix still ends the body');
});

test('#327: a legacy trunk claim written under another spelling of THIS host is upgraded by worktree new, not refused', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '9', '--worktree', 'w0', '--session', 's0']).code, 0);
  const st = readState(fx.home);
  const [key, c] = Object.entries(st.claims)[0];
  st.claims[key] = { ...c, worktree: null, host: `${HOST.split('.')[0].toUpperCase()}.local.`, session: 's0' };
  delete st.claims[key].machine;
  delete st.worktrees.w0;
  writeState(fx.home, st);

  const r = colab(fx, ['worktree', 'new', 'feat/a-9', '--issues', '9', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const claims = claimsFor(fx.home, 9);
  assert.strictEqual(claims.length, 1);
  assert.strictEqual(claims[0][1].worktree, 'a-9');
});

test('#327: an earlier live claim from this machine under a different hostname is OURS — the tie-break does not yield to it', (t) => {
  if (!LOCAL_ID) return t.skip('no machine id resolvable on this host');
  const fx = fixture();
  seedIssue(fx, 9, { comments: [{ createdAt: fakeIso(0), author: { login: 'me' },
    body: claimBody({ host: 'some-other-spelling.lan', iso: fakeIso(0), machineTok: machine.machineToken(LOCAL_ID) }) }] });
  const r = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.err, /Yielded/);
  assert.strictEqual(claimsFor(fx.home, 9).length, 1);
});

test('#327: doctor reports records filed under a renamed host — renamed (same id) vs unproven (no id) — without counting them', (t) => {
  if (!LOCAL_ID) return t.skip('no machine id resolvable on this host');
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1']).code, 0);
  const st = readState(fx.home);
  const [, c] = Object.entries(st.claims)[0];
  st.claims[`${c.repo}#10`] = { ...c, issue: '#10', host: 'oldname', machine: LOCAL_ID };
  st.claims[`${c.repo}#11`] = { ...c, issue: '#11', host: 'oldname2' };
  delete st.claims[`${c.repo}#11`].machine;
  writeState(fx.home, st);

  const r = colab(fx, ['doctor', '--json']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const rep = jsonOut(r.out);
  assert.deepStrictEqual(rep.renamedHostRecords.map((x) => x.name), ['#10']);
  assert.deepStrictEqual(rep.unprovenHostRecords.map((x) => x.name), ['#11']);
  const text = colab(fx, ['doctor']);
  assert.match(text.out, /previous name of THIS machine/);
});

// --- #326: planner intent claims -----------------------------------------------------------------

test('#326: planner claim → session claim from the same machine is ONE record, upgraded in place, tracker not re-posted, no checkout hold', () => {
  const fx = fixture();
  const r1 = colab(fx, ['claim', '9', '--session', 'intent:plan-1']);
  assert.strictEqual(r1.code, 0, r1.out + r1.err);
  assert.doesNotMatch(r1.err, /does not look like a session URL/, 'an intent id is not a mistyped name');
  const st1 = readState(fx.home);
  assert.deepStrictEqual(Object.values(st1.places || {}).filter((p) => p.path === Object.values(st1.claims)[0].repo), [],
    'a planner claim must not take the checkout place-claim');
  assert.strictEqual(trackerWrites(fx, 9).length, 2, 'planner claim: one assign/label edit + one claim comment');

  const r2 = colab(fx, ['worktree', 'new', 'feat/a-9', '--issues', '9', '--session', 's1']);
  assert.strictEqual(r2.code, 0, r2.out + r2.err);
  const claims = claimsFor(fx.home, 9);
  assert.strictEqual(claims.length, 1);
  assert.strictEqual(claims[0][1].worktree, 'a-9');
  assert.strictEqual(claims[0][1].session, 's1');
  assert.strictEqual(trackerWrites(fx, 9).length, 2, 'the upgrade re-posts nothing');
});

test('#326: `colab claim N --worktree` upgrades the planner claim the same way, and `colab claims` marks a planner row', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '9', '--session', 'intent:plan-1']).code, 0);
  const shown = colab(fx, ['claims']);
  assert.match(shown.out, /intent:plan-1 \(planner\)/);
  const r = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /planner claim upgraded in place/);
  assert.strictEqual(claimsFor(fx.home, 9).length, 1);
  assert.strictEqual(trackerWrites(fx, 9).length, 2);
});

test('#326: a planner claim takes no --worktree', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 'intent:plan-1']);
  assert.strictEqual(r.code, 1);
  assert.match(r.err + r.out, /planner intent id/);
});

test('#326: an orphaned planner claim past the TTL — plain --prune keeps it; --prune --sync releases it on the tracker', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '9', '--session', 'intent:plan-1']).code, 0);
  const st = readState(fx.home);
  for (const c of Object.values(st.claims)) c.created = new Date(Date.now() - 2 * 3_600_000).toISOString();
  writeState(fx.home, st);

  const r1 = colab(fx, ['doctor', '--prune', '--json']);
  assert.strictEqual(r1.code, 0, r1.out + r1.err);
  assert.deepStrictEqual(jsonOut(r1.out).staleClaims.map((c) => c.reason), ['intent']);
  assert.strictEqual(claimsFor(fx.home, 9).length, 1, 'plain --prune must not strand the tracker half');

  const r2 = colab(fx, ['doctor', '--prune', '--sync']);
  assert.strictEqual(r2.code, 0, r2.out + r2.err);
  assert.strictEqual(claimsFor(fx.home, 9).length, 0);
  const is = issueState(fx, 9);
  assert.ok(is.comments[is.comments.length - 1].body.startsWith('✅ Released'), JSON.stringify(is.comments));
  assert.deepStrictEqual(is.assignees, []);
  assert.deepStrictEqual(is.labels, []);
});

test('#326: a planner claim is NOT pruned inside the TTL', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['claim', '9', '--session', 'intent:plan-1']).code, 0);
  const r = colab(fx, ['doctor', '--prune', '--sync', '--json']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.deepStrictEqual(jsonOut(r.out).staleClaims, []);
  assert.strictEqual(claimsFor(fx.home, 9).length, 1);
});

test('#326/#325: a planner claim held from ANOTHER machine refuses a session claim here', () => {
  const fx = fixture();
  seedIssue(fx, 9, { assignees: ['me'], labels: ['in-progress'], comments: [{ createdAt: fakeIso(0), author: { login: 'me' },
    body: claimBody({ host: 'elsewhere', iso: fakeIso(0), machineTok: FOREIGN_TOKEN, session: 'intent:plan-x' }) }] });
  const r = colab(fx, ['worktree', 'new', 'feat/a-9', '--issues', '9', '--session', 's1']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /another machine/);
  assert.strictEqual(claimsFor(fx.home, 9).length, 0);
});

test('#326: plannerClaimTTLMinutes refuses a non-number', () => {
  const fx = fixture();
  const r = spawnSync('node', [COLAB, 'config', 'set', 'plannerClaimTTLMinutes', 'soon'], {
    encoding: 'utf8', env: { ...process.env, COLAB_HOME: fx.home } });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr + r.stdout, /positive number/);
});

// --- #325: the remote is the lock ----------------------------------------------------------------

test('#325: machine A cuts + pushes; machine B (a clone that never fetched) is refused, named the branch and how to continue it', () => {
  const fx = fixture();
  const b = machineB(fx); // cloned BEFORE A pushes — B never sees the branch through a fetch
  const ra = colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 'sA']);
  assert.strictEqual(ra.code, 0, ra.out + ra.err);
  assert.ok(remoteHas(fx, 'feat/x-9'), 'worktree new must push the branch at cut');

  const rb = colab(fx, ['claim', '9', '--session', 'sB'], b);
  assert.strictEqual(rb.code, 1, rb.out + rb.err);
  assert.match(rb.err, /origin\/feat\/x-9/);
  assert.match(rb.err, /git worktree add/);
  assert.strictEqual(claimsFor(b.home, 9).length, 0);

  const rb2 = colab(fx, ['worktree', 'new', 'feat/y-9', '--issues', '9', '--session', 'sB'], b);
  assert.strictEqual(rb2.code, 1, rb2.out + rb2.err);
  assert.match(rb2.err, /origin\/feat\/x-9/);
  assert.ok(!remoteHas(fx, 'feat/y-9'));

  // Resume on A: its own branch is its own claim record.
  const ra2 = colab(fx, ['claim', '9', '--worktree', 'x-9', '--branch', 'feat/x-9', '--session', 'sA']);
  assert.strictEqual(ra2.code, 0, ra2.out + ra2.err);
});

test('#325: --force on machine B takes the remote-carried claim over loudly', () => {
  const fx = fixture();
  const b = machineB(fx);
  assert.strictEqual(colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 'sA']).code, 0);
  const rb = colab(fx, ['claim', '9', '--worktree', 'wb', '--session', 'sB', '--force'], b);
  assert.strictEqual(rb.code, 0, rb.out + rb.err);
  assert.match(rb.out, /--force: taking over #9 although branch origin\/feat\/x-9/);
});

test('#325: tracker unreachable, remote reachable → the claim succeeds with its tracker half PENDING, completed by re-running it', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.ghState, 'offline'), '');
  const r1 = colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 'sA']);
  assert.strictEqual(r1.code, 0, r1.out + r1.err);
  assert.match(r1.err, /--add-label in-progress/);
  assert.doesNotMatch(r1.out + r1.err, /LOCAL-ONLY/);
  assert.strictEqual(claimsFor(fx.home, 9)[0][1].trackerPending, true);
  assert.match(colab(fx, ['claims']).out, /#9 ⚠/);

  fs.rmSync(path.join(fx.ghState, 'offline'));
  const r2 = colab(fx, ['claim', '9', '--worktree', 'x-9', '--branch', 'feat/x-9', '--session', 'sA']);
  assert.strictEqual(r2.code, 0, r2.out + r2.err);
  const is = issueState(fx, 9);
  assert.deepStrictEqual(is.assignees, ['me']);
  assert.deepStrictEqual(is.labels, ['in-progress']);
  assert.strictEqual(is.comments.filter((c) => c.body.startsWith('🔒 Claimed')).length, 1);
  assert.strictEqual(claimsFor(fx.home, 9)[0][1].trackerPending, undefined);
});

test('#325: remote unreachable → claim REFUSED, no local-only fallback, nothing recorded', () => {
  const fx = fixture();
  g(fx.work, 'remote', 'set-url', 'origin', path.join(fx.root, 'missing.git'));
  const r = colab(fx, ['claim', '9', '--session', 's1']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /could not be read/);
  assert.doesNotMatch(r.out + r.err, /LOCAL-ONLY/);
  assert.strictEqual(claimsFor(fx.home, 9).length, 0);
  assert.deepStrictEqual(trackerWrites(fx, 9), []);
});

test('#325: a repo with no remote at all still claims — this machine is the whole truth, and it says so', () => {
  const fx = fixture();
  g(fx.work, 'remote', 'remove', 'origin');
  const r = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /no git remote/);
  assert.strictEqual(claimsFor(fx.home, 9).length, 1);
});

test('#325: push rejected at cut → exit 1 and nothing half-exists: no worktree, no branch, no claim', () => {
  const fx = fixture();
  const hook = path.join(fx.origin, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\necho "rejected by fixture" >&2\nexit 1\n', { mode: 0o755 });
  const r = colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 'sA']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /claim NOT taken/);
  assert.ok(!fs.existsSync(path.join(fx.work, '.worktrees', 'x-9')));
  assert.strictEqual(spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/feat/x-9'], { cwd: fx.work }).status, 1);
  assert.strictEqual(claimsFor(fx.home, 9).length, 0);
  assert.deepStrictEqual(trackerWrites(fx, 9), []);
});

test('#325: this account\'s live claim comment from another machine refuses a claim here; --force takes it over', () => {
  const fx = fixture();
  seedIssue(fx, 9, { assignees: ['me'], labels: ['in-progress'], comments: [{ createdAt: fakeIso(0), author: { login: 'me' },
    body: claimBody({ wt: 'wx', branch: 'feat/other-9', host: 'elsewhere', iso: fakeIso(0), machineTok: FOREIGN_TOKEN, session: 'sX' }) }] });
  const r = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1']);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /another machine \(host elsewhere/);
  const rf = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1', '--force']);
  assert.match(rf.out, /--force: taking over #9 from this account's claim on another machine/, rf.out + rf.err);
});

test('#325: single machine, nothing elsewhere → worktree new claims exactly as before, plus the machine id and a pushed branch', () => {
  const fx = fixture();
  const r = colab(fx, ['worktree', 'new', 'feat/x-9', '--issues', '9', '--session', 'sA', '--session-name', 'x']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const [[, c]] = claimsFor(fx.home, 9);
  assert.deepStrictEqual(Object.keys(c).sort(),
    ['branch', 'created', 'host', 'issue', 'machine', 'repo', 'session', 'sessionName', 'worktree'].sort());
  assert.ok(remoteHas(fx, 'feat/x-9'));
  const is = issueState(fx, 9);
  assert.deepStrictEqual(is.assignees, ['me']);
  assert.strictEqual(is.comments.length, 1);
});
