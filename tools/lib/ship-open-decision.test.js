'use strict';
/**
 * #695: `colab ship` refuses a branch whose carried issue has an OPEN `needs-decision` question.
 *
 * Measured before the fix: on an `auto-trunk` repo, `colab decision --reopen` put `needs-decision`
 * back on an issue, and 22 minutes later `colab ship --dry` read READY and `colab ship` squashed the
 * branch onto trunk and closed the issue — no precondition row read the label.
 *
 * Pinned here: the dry JSON row fails and a real ship lands nothing; a question answered through
 * `colab decision --record` ships; over the both-labels pair the time-ordered rule decides (a newer
 * ask refuses, an interrupted write ships); `--refs` issues are read too; the human door passes the
 * row only with `--answered-by`, and the 🚢 comment names the person.
 *
 * Real CLI, real repo, real bare `origin`; `gh` is a node stub whose issue answers come from a state
 * file each test writes (the ship-github-branch-ci.test.js stub, copied rather than shared, as the
 * other ship tests do). Run: `node --test tools/lib/ship-open-decision.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { decisionCommentBody } = require('./decision-record.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const SESSION = 'https://claude.ai/code/session_ship_open_decision_S';
const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
const ROW = 'no open decision on carried issues (#695)';
const T0 = '2026-11-09T10:00:00Z';
const T1 = '2026-11-09T11:00:00Z';
const T2 = '2026-11-09T12:00:00Z';

const TMP = [];
process.on('exit', () => { for (const dir of TMP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } });

const GH_STUB = (state, log, origin) => `#!/usr/bin/env node
const fs = require('fs');
const { execFileSync } = require('child_process');
const ORIGIN = ${JSON.stringify(origin)};
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
const st = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const out = (x) => { process.stdout.write(typeof x === 'string' ? x + '\\n' : JSON.stringify(x) + '\\n'); process.exit(0); };
if (a[0] === '--version') out('gh version 0.0.0 (fixture)');
if (a[0] === 'auth') process.exit(0);
if (a[0] === 'api' && a[1] === 'user') out('me');
if (a[0] === 'run' && a[1] === 'list') {
  const i = a.indexOf('--branch'), c = a.indexOf('--commit');
  let sha = c >= 0 ? a[c + 1] : null;
  if (!sha) { try { sha = execFileSync('git', ['rev-parse', 'refs/heads/' + a[i + 1]], { cwd: ORIGIN, encoding: 'utf8' }).trim(); } catch (_) { out('[]'); } }
  out([{ headSha: sha, status: 'completed', conclusion: 'success', databaseId: 7, workflowName: 'CI', event: 'push',
    createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:01:00Z', attempt: 1 }]);
}
if (a[0] === 'api' && a.some((x) => /issues\\/\\d+\\/events$/.test(x))) {
  const n = a.find((x) => /issues\\/\\d+\\/events$/.test(x)).match(/issues\\/(\\d+)\\/events/)[1];
  const ev = ((st.issues || {})[n] || {}).labelEvents || [];
  out(ev.join('\\n'));
}
if (a[0] === 'issue' && a[1] === 'view') {
  const i = (st.issues || {})[a[2]];
  if (i === 'fail') { process.stderr.write('fixture: read failed\\n'); process.exit(1); }
  const x = i || {};
  out({ state: 'OPEN', url: 'https://example.invalid/issues/' + a[2], labels: (x.labels || []).map((name) => ({ name })),
    comments: x.comments || [{ body: 'fixture', createdAt: '${T0}', author: { login: 'x' }, authorAssociation: 'NONE' }], body: '' });
}
if (a[0] === 'issue' || a[0] === 'label') process.exit(0);
process.stderr.write('fixture gh: refusing ' + a.join(' ') + '\\n');
process.exit(1);
`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-ship-open-decision-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  const state = path.join(root, 'gh-state.json');
  fs.mkdirSync(home);
  fs.writeFileSync(state, '{}');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'open decision test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), YML);
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\njobs: {}\n');
  fs.writeFileSync(path.join(work, 'f.js'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), GH_STUB(state, ghLog, origin), { mode: 0o755 });
  const setIssues = (issues) => fs.writeFileSync(state, JSON.stringify({ issues }));
  const ghCalls = () => fs.readFileSync(ghLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { root, work, origin, home, bin, g, setIssues, ghCalls };
}

function colab(fx, args, env = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '', ...env,
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** A code branch off main carrying `nums` (all claimed), pushed; main checked out. */
function branch(fx, name, nums) {
  fx.g(fx.work, 'branch', name);
  assert.strictEqual(colab(fx, ['claim', ...nums.map(String), '--branch', name, '--repo', fx.work]).code, 0);
  fx.g(fx.work, 'checkout', '-q', name);
  fs.writeFileSync(path.join(fx.work, 'g.js'), `module.exports = ${nums[0]};\n`);
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `fix: change (${nums.map((n) => '#' + n).join(' ')})`);
  fx.g(fx.work, 'push', '-q', 'origin', name);
  fx.g(fx.work, 'checkout', '-q', 'main');
}

function dry(fx, name, extra = [], env = {}) {
  const r = colab(fx, ['ship', '--branch', name, '--repo', fx.work, '--dry', '--json', ...extra], env);
  let j;
  try { j = JSON.parse(r.out); } catch (_) { assert.fail(`not JSON (exit ${r.code}): ${r.out}\n${r.err}`); }
  return { j, code: r.code, row: j.checks.find((c) => c.name === ROW), failing: j.checks.filter((c) => !c.ok) };
}

const recorded = (at) => ({ body: decisionCommentBody('Boss', '-', 'box', at, 'ruled: option A'), createdAt: at,
  author: { login: 'owner' }, authorAssociation: 'OWNER' });

test('#695 ship --dry --json: an issue carrying needs-decision with no record fails the row, human-gated, linked, with its clear', () => {
  const fx = fixture();
  branch(fx, 'fix/open-81', [81]);
  fx.setIssues({ 81: { labels: ['needs-decision'] } });
  const d = dry(fx, 'fix/open-81');
  assert.ok(d.row, `no ${ROW} row: ${JSON.stringify(d.j.checks.map((c) => c.name))}`);
  assert.deepStrictEqual([d.row.ok, d.row.class], [false, 'human-gated'], JSON.stringify(d.row));
  assert.match(d.row.detail, /#81 \(https:\/\/example\.invalid\/issues\/81\)/);
  assert.match(d.row.detail, /colab decision 81 --record --ruled-by "<name>"/);
  assert.deepStrictEqual(d.row.questions.map((q) => q.issue), [81]);
  assert.deepStrictEqual(d.failing.map((c) => c.name), [ROW], 'the open question is the only failing row');
  assert.strictEqual(d.j.ok, false);
  assert.strictEqual(d.code, 1);
});

test('#695 real ship: the same open question refuses before the push and lands nothing', () => {
  const fx = fixture();
  branch(fx, 'fix/open-82', [82]);
  fx.setIssues({ 82: { labels: ['needs-decision'] } });
  const before = fx.g(fx.origin, 'rev-parse', 'main');
  const r = colab(fx, ['ship', '--branch', 'fix/open-82', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out + r.err, /✗ +no open decision on carried issues \(#695\)/);
  assert.strictEqual(fx.g(fx.origin, 'rev-parse', 'main'), before, 'origin main did not move');
  assert.doesNotMatch(fx.g(fx.work, 'log', '--format=%s', 'main'), /#82/);
});

test('#695 a question answered through colab decision --record still ships — dry READY, and the real ship lands', () => {
  const fx = fixture();
  branch(fx, 'fix/decided-83', [83]);
  fx.setIssues({ 83: { labels: ['decision-recorded'], comments: [recorded(T1)] } });
  const d = dry(fx, 'fix/decided-83');
  assert.deepStrictEqual([d.row && d.row.ok, d.j.ok], [true, true], JSON.stringify(d.failing));
  const r = colab(fx, ['ship', '--branch', 'fix/decided-83', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(fx.g(fx.origin, 'log', '--format=%B', '-1', 'main'), /Closes #83/);
});

test('#695 both labels: a needs-decision label newer than the ⚖ record is an open question and refuses', () => {
  const fx = fixture();
  branch(fx, 'fix/second-84', [84]);
  fx.setIssues({ 84: { labels: ['needs-decision', 'decision-recorded'], comments: [recorded(T1)], labelEvents: [T0, T2] } });
  const d = dry(fx, 'fix/second-84');
  assert.deepStrictEqual([d.row.ok, d.row.class], [false, 'human-gated'], JSON.stringify(d.row));
  assert.match(d.row.detail, /newer than the newest ⚖ record/);
  assert.match(d.row.detail, /--answers <ask id>/);
  assert.ok(fx.ghCalls().some((a) => a[0] === 'api' && a.some((x) => /issues\/84\/events$/.test(x))), 'the label timeline was read');
});

test('#695 both labels: every ask older than the record is an interrupted write — answered, ships', () => {
  const fx = fixture();
  branch(fx, 'fix/interrupted-85', [85]);
  fx.setIssues({ 85: { labels: ['needs-decision', 'decision-recorded'], comments: [recorded(T1)], labelEvents: [T0] } });
  const d = dry(fx, 'fix/interrupted-85');
  assert.deepStrictEqual([d.row.ok, d.j.ok], [true, true], JSON.stringify(d.failing));
});

test('#695 a --refs issue is read too: a question there refuses just the same', () => {
  const fx = fixture();
  branch(fx, 'fix/refs-86-87', [86, 87]);
  fx.setIssues({ 87: { labels: ['needs-decision'] } });
  const d = dry(fx, 'fix/refs-86-87', ['--refs', '87']);
  assert.deepStrictEqual(d.j.refsIssues, [87]);
  assert.deepStrictEqual([d.row.ok, d.row.questions.map((q) => q.issue)], [false, [87]], JSON.stringify(d.row));
});

test('#695 an issue the tracker could not return fails the row self-clearing', () => {
  const fx = fixture();
  branch(fx, 'fix/unread-88', [88]);
  fx.setIssues({ 88: 'fail' });
  const d = dry(fx, 'fix/unread-88');
  assert.deepStrictEqual([d.row.ok, d.row.class], [false, 'self-clearing'], JSON.stringify(d.row));
});

test('#695 the human door passes the row only WITH --answered-by, and the 🚢 comment names the person', () => {
  const fx = fixture();
  branch(fx, 'fix/door-89', [89]);
  fx.setIssues({ 89: { labels: ['needs-decision'] } });
  const noName = dry(fx, 'fix/door-89', [], { COLAB_HUMAN: '1' });
  assert.strictEqual(noName.row.ok, false, 'COLAB_HUMAN=1 with no name does not pass it');
  const named = dry(fx, 'fix/door-89', ['--answered-by', 'Ada'], { COLAB_HUMAN: '1' });
  assert.deepStrictEqual([named.row.ok, named.j.ok], [true, true], JSON.stringify(named.failing));
  assert.match(named.row.detail, /passed by the human door: Ada takes this decision/);
  const r = colab(fx, ['ship', '--branch', 'fix/door-89', '--repo', fx.work, '--answered-by', 'Ada'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  const comment = fx.ghCalls().find((a) => a[0] === 'issue' && a[1] === 'comment' && a[2] === '89' && /🚢 Shipped/.test(a[4] || ''));
  assert.ok(comment, 'a 🚢 comment was posted on #89');
  assert.match(comment[4], /open needs-decision on #89 passed by the human door \(#695\): decided by Ada/);
});
