'use strict';
/**
 * #538 — `colab ship --dry --json`, the prose `--dry`, and the real ship must reach the SAME verdict on
 * the trunk-CI-green gate over one red-trunk state. Measured: dry said READY on a red trunk (the cure
 * rule admitted the fix branch), and a moment later the real ship aborted at B1 with only the RAW
 * trunk detail ("conclusion=failure") — no word on why the cure that admitted the table no longer did.
 *
 * Unlike ship-ci-cure.test.js (whose fixture `gh` refuses every run read, so the cure is never
 * consulted), this fixture's `gh` ANSWERS the run and job reads, so the cure rule actually fires end
 * to end: trunk is red on one job at its head, the fix branch contains that head and is green on the
 * same job at its own head. Real CLI, real repo, real bare `origin` on disk, no network.
 *
 * The fake `gh` is a node script driven by a JSON file (`state.json` in the fixture root) the test
 * rewrites between steps — so a test can flip ONE read (e.g. make the branch's job read fail) and see
 * which way each path goes.
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

const SESSION = 'https://claude.ai/code/session_dry_real_parity';
const BRANCH = 'fix/red-trunk-cure-77';
const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';

// The fake gh: answers `run list`, `run view --json jobs`, issue reads/writes; refuses everything else
// (including `gh api …actions/runs`, which sends git.js to its `gh run list` fallback — the same path
// an older gh takes). Every call is appended to gh.log.
const FAKE_GH = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = __dirname.replace(/\\/bin$/, '');
const st = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
const a = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'gh.log'), a.join(' ') + '\\n');
const out = (v) => { process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v)); process.exit(0); };
const fail = (m) => { process.stderr.write('fixture gh: ' + m + '\\n'); process.exit(1); };
const tip = (ref) => { try { return execFileSync('git', ['rev-parse', ref], { cwd: path.join(root, 'origin.git'), encoding: 'utf8' }).trim(); } catch (_) { return ''; } };
if (a[0] === '--version') out('gh version 0.0.0 (fixture)\\n');
if (a[0] === 'auth' && a[1] === 'status') { process.stderr.write('Logged in (fixture)\\n'); process.exit(0); }
if (a[0] === 'api' && a[1] === 'user') out('me\\n');
if (a[0] === 'repo' && a[1] === 'view') out('PRIVATE\\n');
if (a[0] === 'run' && a[1] === 'list') {
  const bi = a.indexOf('--branch');
  const br = bi >= 0 ? a[bi + 1] : null;
  if (st.failRunList && st.failRunList.includes(br)) fail('run list failed (fixture)');
  const rows = [];
  for (const r of st.runs) {
    if (br && r.branch !== br) continue;
    const sha = tip('refs/heads/' + r.branch);
    rows.push({ headSha: r.headSha || sha, status: r.status, conclusion: r.conclusion, createdAt: r.createdAt || '2026-01-01T00:00:00Z',
      databaseId: r.id, workflowName: r.workflow, workflowDatabaseId: r.workflowId, event: r.event, attempt: 1 });
  }
  out(rows);
}
if (a[0] === 'run' && a[1] === 'view') {
  const id = Number(a[2]);
  if (st.failJobs && st.failJobs.includes(id)) fail('run view failed (fixture)');
  // failJobsOnCall: { "<id>": [n, …] } — fail the n-th \`run view <id>\` since the counter was reset.
  if (st.failJobsOnCall && st.failJobsOnCall[id]) {
    const cf = path.join(root, 'calls-' + id);
    const n = (fs.existsSync(cf) ? Number(fs.readFileSync(cf, 'utf8')) : 0) + 1;
    fs.writeFileSync(cf, String(n));
    if (st.failJobsOnCall[id].includes(n)) fail('run view failed (fixture, call ' + n + ')');
  }
  const r = st.runs.find((x) => x.id === id);
  if (!r) fail('no such run');
  out({ jobs: r.jobs });
}
if (a[0] === 'issue' && a[1] === 'view') out({ state: 'OPEN', title: 'TRUNK RED: fixture', labels: [], comments: [] });
if (a[0] === 'issue' && ['edit', 'comment', 'close'].includes(a[1])) process.exit(0);
if (a[0] === 'label') process.exit(0);
fail('refusing ' + a.join(' '));
`;

function job(name, conclusion) {
  return {
    name, status: 'completed', conclusion,
    startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:05:00Z',
    steps: [{ name: 'Set up job', status: 'completed', conclusion: 'success' },
      { name: 'Run tests', status: 'completed', conclusion }],
  };
}

function fixture(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-dry-real-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'dry real parity test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), YML);
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n');
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  // The red trunk head — a later commit, so the branch below is cut from (and contains) it.
  fs.writeFileSync(path.join(work, 'flaky.txt'), 'red\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', opts.redMessage || 'feat: the commit trunk went red on');
  g(work, 'push', '-q', 'origin', 'main');

  g(work, 'checkout', '-q', '-b', BRANCH);
  fs.writeFileSync(path.join(work, 'flaky.txt'), 'fixed\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'fix: the red test (#77)');
  g(work, 'checkout', '-q', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });

  const state = {
    runs: [
      { id: 100, branch: 'main', workflow: 'CI', workflowId: 9, event: 'push', status: 'completed', conclusion: 'failure',
        jobs: [job('test', 'failure'), job('lint', 'success')] },
      ...(opts.releaseRun ? [{ id: 101, branch: 'main', workflow: 'Release (auto)', workflowId: 10, event: 'workflow_run', status: 'completed', conclusion: 'skipped',
        jobs: [{ name: 'release', status: 'completed', conclusion: 'skipped', startedAt: null, completedAt: null, steps: [] }] }] : []),
      { id: 200, branch: BRANCH, workflow: 'CI', workflowId: 9, event: opts.branchEvent || 'push', status: 'completed', conclusion: 'success',
        jobs: [job('test', 'success'), job('lint', 'success')] },
    ],
    failJobs: [],
    failRunList: [],
  };
  const setState = (patch) => fs.writeFileSync(path.join(root, 'state.json'), JSON.stringify({ ...state, ...patch }));
  setState({});
  const resetCalls = () => { for (const f of fs.readdirSync(root)) if (f.startsWith('calls-')) fs.unlinkSync(path.join(root, f)); };
  return { root, origin, work, home, bin, g, state, setState, resetCalls, ghLog: path.join(root, 'gh.log') };
}

function colab(fx, args, env = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '', COLAB_B1_REMEASURE_MS: '0', ...env,
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function claim(fx) {
  const r = colab(fx, ['claim', '77', '--branch', BRANCH, '--repo', fx.work, '--session', SESSION]);
  assert.strictEqual(r.code, 0, `claim failed: ${r.out}${r.err}`);
}

function dryJson(fx) {
  const r = colab(fx, ['ship', '--branch', BRANCH, '--repo', fx.work, '--dry', '--json']);
  let body;
  try { body = JSON.parse(r.out); } catch (_) { assert.fail(`--dry --json did not print JSON: ${r.out}${r.err}`); }
  return { ...r, body, ci: body.checks.find((c) => c.name === 'trunk CI green') };
}

function assertAllAgreeAndLand(fx) {
  claim(fx);
  fx.g(fx.work, 'push', '-q', 'origin', BRANCH);

  // Each step counts its own `gh run view` calls from 1 (see failJobsOnCall).
  fx.resetCalls();
  const dj = dryJson(fx);
  assert.strictEqual(dj.ci.ok, true, `dry json trunk row: ${JSON.stringify(dj.ci)}`);
  assert.match(dj.ci.detail, /cure rule/);
  assert.ok(dj.body.ciCure && dj.body.ciCure.ok, `ciCure: ${JSON.stringify(dj.body.ciCure)}`);

  fx.resetCalls();
  const dp = colab(fx, ['ship', '--branch', BRANCH, '--repo', fx.work, '--dry']);
  assert.match(dp.out, /✓\s+trunk CI green/, dp.out + dp.err);
  assert.match(dp.out, /READY/);

  fx.resetCalls();
  const real = colab(fx, ['ship', '--branch', BRANCH, '--repo', fx.work]);
  assert.doesNotMatch(real.err, /✗ B1/, real.out + real.err);
  assert.strictEqual(real.code, 0, real.out + real.err);
  const msg = fx.g(fx.origin, 'log', '-1', '--format=%B', 'main');
  assert.match(msg, /^CI-Cure:/m, `landed without the cure trailer: ${msg}`);
  return real;
}

test('#538: a cure-eligible branch on a red trunk — --dry --json, prose --dry and the real ship all agree it lands', () => {
  assertAllAgreeAndLand(fixture());
});

test('#534: a green pull_request-event run at the branch head IS the cure evidence (a repo whose branch CI runs only on PRs)', () => {
  assertAllAgreeAndLand(fixture({ branchEvent: 'pull_request' }));
});

test('#538: a skipped post-CI workflow_run at the red sha does not change the verdict on any path', () => {
  assertAllAgreeAndLand(fixture({ releaseRun: true }));
});

test('#538: ONE failed read at B1 (the branch run\'s job list) no longer aborts a ship the table admitted — B1 re-measures once and lands', () => {
  const fx = fixture();
  // Call 1 = the table's cure measurement, call 2 = B1's; call 3 = B1's single re-measure.
  fx.setState({ failJobsOnCall: { 200: [2] } });
  const real = assertAllAgreeAndLand(fx);
  assert.match(real.err + real.out, /re-measuring once/);
});

test('#538: B1 refusing twice at the same red sha aborts naming the door and the door\'s own reason — not a bare "no longer green"', () => {
  const fx = fixture();
  fx.setState({ failJobsOnCall: { 200: [2, 3] } });
  claim(fx);
  fx.g(fx.work, 'push', '-q', 'origin', BRANCH);
  assert.strictEqual(dryJson(fx).ci.ok, true);
  fx.resetCalls();
  const real = colab(fx, ['ship', '--branch', BRANCH, '--repo', fx.work]);
  assert.notStrictEqual(real.code, 0);
  assert.match(real.err, /✗ B1: the cure rule admitted this branch in the precondition table, then refused twice/);
  assert.match(real.err, /cure rule \(#281\): .*could not be measured/);
  assert.match(real.err, /Nothing pushed/);
  assert.strictEqual(fx.g(fx.origin, 'rev-parse', 'main'), fx.g(fx.work, 'rev-parse', 'main'), 'trunk must not have moved');
});

test('#534: a refused cure says WHY on the trunk-CI row — prose --dry and --dry --json name the same reason (stacked on a prior exemption)', () => {
  // The red head is itself an exemption merge, and trunk never went green since: condition 3 refuses.
  const fx = fixture({ redMessage: 'fix: an earlier cure (#70)\n\nCI-Cure: red 0000000 evidence 1111111' });
  claim(fx);
  fx.g(fx.work, 'push', '-q', 'origin', BRANCH);
  const dj = dryJson(fx);
  assert.strictEqual(dj.ci.ok, false);
  assert.ok(dj.body.ciCure && !dj.body.ciCure.ok && dj.body.ciCure.reason, JSON.stringify(dj.body.ciCure));
  assert.ok(dj.ci.detail.includes(`cure rule (#281): ${dj.body.ciCure.reason}`), dj.ci.detail);
  assert.match(dj.ci.detail, /ci-grant \(#105\): /);
  const dp = colab(fx, ['ship', '--branch', BRANCH, '--repo', fx.work, '--dry']);
  assert.match(dp.out, /✗\s+trunk CI green/);
  assert.ok(dp.out.includes('cure rule (#281): '), dp.out);
});
