'use strict';
/**
 * Tests for `colab release finalize` (#339) — the measuring and writing half, end to end.
 *
 * Real CLI, real repo with a real bare `origin` on disk (no network), private COLAB_HOME. Candidates
 * are cut by the REAL `colab release cut` (so the annotated-tag contract finalize reads is the one cut
 * writes), back-dated through GIT_COMMITTER_DATE. `gh` is a small node stub holding tracker state in
 * a JSON file — issues, comments, labels, blocked_by edges and two run lists (by commit, and trunk
 * since a date) — so a test can assert what finalize opened, posted and closed, not only what it said.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const AUTO_YML = 'trunk: main\nexposure: released\nproduction: null\ndeploy: none\nstack: node\n';
const HUMAN_YML = 'trunk: main\nexposure: released\nproduction: https://example.invalid\ndeploy: tag\nstack: node\n';

const GH_STUB = `#!/usr/bin/env node
const fs = require('fs');
const file = process.env.GH_STUB_STATE;
const st = JSON.parse(fs.readFileSync(file, 'utf8'));
const a = process.argv.slice(2);
const save = () => fs.writeFileSync(file, JSON.stringify(st, null, 2));
const out = (v) => { process.stdout.write(typeof v === 'string' ? v + '\\n' : JSON.stringify(v)); process.exit(0); };
const flag = (n) => { const i = a.indexOf(n); return i === -1 ? null : a[i + 1]; };
st.calls.push(a.join(' ')); save();
if (a[0] === '--version') out('gh version 0.0.0 (fixture)');
if (a[0] === 'auth' && a[1] === 'status') process.exit(0);
if (a[0] === 'run' && a[1] === 'list') out(a.includes('--created') ? st.runsSince : st.runsAtCommit);
if (a[0] === 'issue' && a[1] === 'list') out(st.issues);
if (a[0] === 'issue' && a[1] === 'create') {
  const number = st.next++;
  st.issues.push({ number, title: flag('--title'), body: flag('--body'), state: 'OPEN', stateReason: null, labels: [], createdAt: new Date().toISOString(), url: 'https://github.com/o/r/issues/' + number, comments: [] });
  save(); out('https://github.com/o/r/issues/' + number);
}
const issue = () => st.issues.find((i) => i.number === Number(a[2]));
if (a[0] === 'issue' && a[1] === 'view') out({ comments: issue().comments });
if (a[0] === 'issue' && a[1] === 'comment') { issue().comments.push({ body: flag('--body') }); save(); out(''); }
if (a[0] === 'issue' && a[1] === 'close') { issue().state = 'CLOSED'; save(); out(''); }
const m = a[0] === 'api' ? /issues\\/([0-9]+)\\/dependencies\\/blocked_by$/.exec(a[1] || '') : null;
if (m) out(st.edges[m[1]] || []);
process.stderr.write('fixture gh: refusing ' + a.join(' ') + '\\n');
process.exit(1);
`;

function fixture(projectYml = AUTO_YML) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-release-finalize-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  const g = (...args) => execFileSync('git', args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'release finalize test');
  g('config', 'core.hooksPath', path.join(root, '.nohooks'));
  g('remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  g('tag', '-a', 'v1.2.0', '-m', 'v1.2.0');
  g('push', '-q', 'origin', 'main', '--tags');

  const stateFile = path.join(root, 'gh-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ next: 100, issues: [], edges: {}, runsAtCommit: [], runsSince: [], calls: [] }));
  fs.writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 });
  const fx = { root, origin, work, home, bin, g, stateFile };
  commit(fx, 'fix.txt', 'fix: a bug');
  return fx;
}

const readState = (fx) => JSON.parse(fs.readFileSync(fx.stateFile, 'utf8'));
const writeState = (fx, fn) => { const s = readState(fx); fn(s); fs.writeFileSync(fx.stateFile, JSON.stringify(s, null, 2)); };

/** Commit + push, and mark the new head green in the by-commit run list. */
function commit(fx, file, subject) {
  fs.writeFileSync(path.join(fx.work, file), `${subject}\n`);
  fx.g('add', '-A');
  fx.g('commit', '-q', '-m', subject);
  fx.g('push', '-q', 'origin', 'main');
  const sha = fx.g('rev-parse', 'HEAD');
  writeState(fx, (s) => {
    s.runsAtCommit = [{ headSha: sha, status: 'completed', conclusion: 'success', workflowName: 'ci', event: 'push', createdAt: new Date().toISOString(), databaseId: 1 }];
  });
  return sha;
}

function colab(fx, args, { env = {} } = {}) {
  const r = spawnSync('node', [COLAB, 'release', ...args, '--repo', fx.work, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: 'sess-release-finalize-test', GH_STUB_STATE: fx.stateFile, COLAB_HUMAN: '', ...env },
  });
  let body = null;
  try { body = JSON.parse(r.stdout); } catch (_) { /* a UserError prints no JSON */ }
  return { code: r.status, body, out: r.stdout || '', err: r.stderr || '' };
}

function cutCandidate(fx, daysAgo) {
  const r = colab(fx, ['cut'], { env: daysAgo ? { GIT_COMMITTER_DATE: ago(daysAgo) } : {} });
  assert.strictEqual(r.code, 0, r.out + r.err);
  return r.body.tag;
}

const finalize = (fx, args = [], opts) => colab(fx, ['finalize', ...args], opts);

/** Where a release channel branch (#445) points on origin, or null when it does not exist. */
function originBranch(fx, name) {
  const out = execFileSync('git', ['ls-remote', '--heads', fx.origin, `refs/heads/${name}`], { encoding: 'utf8' }).trim();
  return out ? out.split('\t')[0] : null;
}

function originTags(fx) {
  const out = execFileSync('git', ['ls-remote', '--tags', fx.origin], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((l) => l.split('\t')[1].replace(/^refs\/tags\//, '')).filter((t) => !t.endsWith('^{}')).sort();
}

const tracking = (fx) => readState(fx).issues.filter((i) => /<!-- colab:release version=/.test(i.body));
function ageTracking(fx, days) { writeState(fx, (s) => { for (const i of s.issues) i.createdAt = ago(days); }); }

// ---- the automatic-final row ------------------------------------------------------------------

test('auto row: --dry writes nothing; a run opens ONE tracking issue and tests; a clean period tags the final and closes it', () => {
  const fx = fixture();
  const rc = cutCandidate(fx, 5);
  assert.strictEqual(rc, 'v1.2.1-rc.1');
  const rcSha = fx.g('rev-parse', `${rc}^{commit}`);

  const dry = finalize(fx, ['--dry']);
  assert.strictEqual(dry.code, 1, dry.out + dry.err);
  assert.strictEqual(dry.body.state, 'testing', 'the issue would open now, so the period starts now');
  assert.deepStrictEqual(tracking(fx), [], '--dry opens nothing');

  const first = finalize(fx);
  assert.strictEqual(first.body.state, 'testing', first.out + first.err);
  assert.strictEqual(first.body.tracking.created, true);
  const again = finalize(fx);
  assert.strictEqual(again.body.tracking.created, false);
  let issues = tracking(fx);
  assert.strictEqual(issues.length, 1, 'a re-run never opens a second tracking issue');
  assert.strictEqual(issues[0].title, 'release: v1.2.1');
  assert.strictEqual(issues[0].body.split('\n')[0], '<!-- colab:release version=v1.2.1 -->');
  assert.strictEqual(issues[0].comments.filter((c) => c.body.includes('candidate=v1.2.1-rc.1')).length, 1, 'the candidate event is posted once');

  ageTracking(fx, 4);
  const done = finalize(fx);
  assert.strictEqual(done.code, 0, done.out + done.err);
  assert.strictEqual(done.body.state, 'finalized');
  assert.strictEqual(done.body.tagged, true);
  assert.ok(originTags(fx).includes('v1.2.1'));
  fx.g('fetch', '-q', '--tags', 'origin');
  assert.strictEqual(fx.g('cat-file', '-t', 'v1.2.1'), 'tag', 'the final is annotated');
  assert.strictEqual(fx.g('rev-parse', 'v1.2.1^{commit}'), rcSha, 'the final names the candidate commit');
  // #445: the final moves the `stable` channel to its commit.
  assert.strictEqual(done.body.channel.action, 'create', JSON.stringify(done.body.channel));
  assert.strictEqual(originBranch(fx, 'stable'), rcSha);
  issues = tracking(fx);
  assert.strictEqual(issues[0].state, 'CLOSED');

  const after = finalize(fx);
  assert.strictEqual(after.body.state, 'already-final');
  assert.strictEqual(tracking(fx).length, 1);
  assert.strictEqual(after.body.channel.action, 'noop', 'stable is already there');

  // A run that died between the tag push and the channel move: already-final repairs stable.
  execFileSync('git', ['push', '-q', 'origin', '--delete', 'stable'], { cwd: fx.work, env: { ...process.env, COLAB_HUMAN: '1' } });
  const repaired = finalize(fx);
  assert.strictEqual(repaired.body.state, 'already-final');
  assert.strictEqual(repaired.body.channel.action, 'create');
  assert.strictEqual(originBranch(fx, 'stable'), rcSha);
});

test('#426: the final tells every issue it carries "Released in vX.Y.Z" — once, and a resume finishes it', () => {
  const fx = fixture();
  writeState(fx, (s) => {
    for (const n of [7, 8]) s.issues.push({ number: n, title: `bug ${n}`, body: '', state: 'CLOSED', stateReason: 'COMPLETED', labels: [], createdAt: ago(10), url: 'https://github.com/o/r/issues/' + n, comments: [] });
  });
  commit(fx, 'a.txt', 'fix: first bug\n\nCloses #7');
  commit(fx, 'b.txt', 'fix: second bug\n\nFixes: #8\nCloses #9');
  cutCandidate(fx, 5);
  assert.strictEqual(finalize(fx).body.state, 'testing');
  ageTracking(fx, 4);
  writeState(fx, (s) => { for (const n of [7, 8]) s.issues.find((i) => i.number === n).createdAt = ago(10); });

  const done = finalize(fx);
  assert.strictEqual(done.body.state, 'finalized', done.out + done.err);
  assert.deepStrictEqual(done.body.announced.issues, [7, 8, 9]);
  assert.deepStrictEqual(done.body.announced.posted, [7, 8]);
  assert.deepStrictEqual(done.body.announced.skipped, [9], 'an issue the tracker cannot read is reported, not fatal');
  const said = (n) => readState(fx).issues.find((i) => i.number === n).comments.filter((c) => c.body.includes('<!-- colab:release-event released=v1.2.1 -->'));
  assert.strictEqual(said(7).length, 1);
  assert.match(said(8)[0].body, /Released in \*\*v1\.2\.1\*\*/);
  assert.strictEqual(tracking(fx)[0].comments.filter((c) => /Released in/.test(c.body)).length, 0, 'the tracking record is not something the release carries');

  // Resume: reopen the record as if the run had died after the tag push — nothing is posted twice.
  writeState(fx, (s) => { for (const i of s.issues) if (/colab:release version=/.test(i.body)) i.state = 'OPEN'; });
  const resumed = finalize(fx);
  assert.strictEqual(resumed.body.state, 'already-final');
  assert.deepStrictEqual(resumed.body.announced.posted, []);
  assert.strictEqual(said(7).length, 1);
  assert.strictEqual(said(8).length, 1);
});

test('auto row: release-hold stops the final — no tag reaches origin, the label stays', () => {
  const fx = fixture();
  cutCandidate(fx, 5);
  finalize(fx);
  ageTracking(fx, 4);
  writeState(fx, (s) => { s.issues[0].labels = [{ name: 'release-hold' }]; });
  const r = finalize(fx);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.body.state, 'held');
  assert.ok(!originTags(fx).includes('v1.2.1'));
  assert.deepStrictEqual(readState(fx).issues[0].labels, [{ name: 'release-hold' }]);
  assert.ok(!readState(fx).calls.some((c) => /label/.test(c) && /edit/.test(c)), 'nothing touched the labels');
});

test('auto row: trunk red during the period, or a regression fixed after it began, owes a new candidate; rc.2 restarts the period', () => {
  const fx = fixture();
  const rc1 = cutCandidate(fx, 5);
  finalize(fx);
  ageTracking(fx, 4);
  const rc1Sha = fx.g('rev-parse', `${rc1}^{commit}`);

  writeState(fx, (s) => { s.runsSince = [{ headSha: 'd'.repeat(40), status: 'completed', conclusion: 'failure', workflowName: 'ci', event: 'push', createdAt: ago(1) }]; });
  const red = finalize(fx);
  assert.strictEqual(red.body.state, 'needs-new-candidate', red.out + red.err);

  writeState(fx, (s) => { s.runsSince = []; s.edges[s.issues[0].number] = [{ number: 7, state: 'closed', closed_at: ago(1) }]; });
  writeState(fx, (s) => { s.runsAtCommit = [{ headSha: rc1Sha, status: 'completed', conclusion: 'success', workflowName: 'ci', event: 'push', createdAt: ago(5) }]; });
  const reg = finalize(fx);
  assert.strictEqual(reg.body.state, 'needs-new-candidate', reg.out + reg.err);
  assert.match(reg.body.checks.find((c) => c.condition === 'regressions').detail, /#7/);
  assert.ok(!originTags(fx).includes('v1.2.1'));

  commit(fx, 'fix2.txt', 'fix: the regression');
  const rc2 = cutCandidate(fx);
  assert.strictEqual(rc2, 'v1.2.1-rc.2');
  const next = finalize(fx);
  assert.strictEqual(next.body.state, 'testing', next.out + next.err);
  assert.strictEqual(next.body.candidate.tag, 'v1.2.1-rc.2');
  const issues = tracking(fx);
  assert.strictEqual(issues.length, 1, 'rc.2 reuses the version\'s tracking issue');
  assert.ok(issues[0].comments.some((c) => c.body.includes('candidate=v1.2.1-rc.2')));
});

test('a hand-made candidate is refused', () => {
  const fx = fixture();
  fx.g('tag', 'v1.2.1-rc.1');
  fx.g('push', '-q', 'origin', 'v1.2.1-rc.1');
  const r = finalize(fx);
  assert.strictEqual(r.body.state, 'refused');
  assert.match(r.body.checks.find((c) => c.condition === 'candidate').detail, /not made by `colab release cut`/);
  assert.deepStrictEqual(tracking(fx), []);
});

// ---- the human-final row ----------------------------------------------------------------------

test('human row: an agent run stops at candidate-ready with the handoff; the human bar with --tag tags the final', () => {
  const fx = fixture(HUMAN_YML);
  const rc = cutCandidate(fx, 1);
  const ready = finalize(fx);
  assert.strictEqual(ready.code, 0, ready.out + ready.err);
  assert.strictEqual(ready.body.state, 'candidate-ready');
  assert.strictEqual(ready.body.tagged, false);
  assert.match(ready.body.handoff, new RegExp(`--tag ${rc.replace(/\./g, '\\.')}`));
  assert.ok(!originTags(fx).includes('v1.2.1'));
  assert.ok(tracking(fx)[0].comments.some((c) => c.body.includes(ready.body.handoff)), 'the handoff is posted on the tracking issue');

  const noTag = finalize(fx, ['--answered-by', 'Ops'], { env: { COLAB_HUMAN: '1' } });
  assert.strictEqual(noTag.code, 1);
  assert.match(noTag.err, /needs --tag/);

  const flagOnly = finalize(fx, ['--tag', rc, '--answered-by', 'Ops']);
  assert.strictEqual(flagOnly.body.state, 'candidate-ready', '--answered-by without COLAB_HUMAN=1 is not the bar');

  const done = finalize(fx, ['--tag', rc, '--answered-by', 'Ops'], { env: { COLAB_HUMAN: '1' } });
  assert.strictEqual(done.code, 0, done.out + done.err);
  assert.strictEqual(done.body.state, 'finalized');
  assert.ok(originTags(fx).includes('v1.2.1'));
  fx.g('fetch', '-q', '--tags', 'origin');
  assert.match(fx.g('tag', '-l', '--format=%(contents)', 'v1.2.1'), /Finalized by: Ops/);
});

// ---- --auto (#423) ------------------------------------------------------------------------------

/** One fix commit + one candidate per entry of `daysAgo`; every candidate's commit stays green. */
function dailyCandidates(fx, daysAgo) {
  const rows = [];
  const tags = [];
  daysAgo.forEach((d, i) => {
    if (i > 0) commit(fx, `fix-${i}.txt`, `fix: daily ${i}`);
    const sha = fx.g('rev-parse', 'HEAD');
    rows.push({ headSha: sha, status: 'completed', conclusion: 'success', workflowName: 'ci', event: 'push', createdAt: new Date().toISOString(), databaseId: 10 + i });
    writeState(fx, (s) => { s.runsAtCommit = rows; });
    tags.push(cutCandidate(fx, d));
  });
  return tags;
}

test('--auto: a candidate cut every day still finalizes — the newest one clean on its own clock', () => {
  const fx = fixture();
  const tags = dailyCandidates(fx, [6, 5, 4, 2, 1, 0.01]);
  assert.deepStrictEqual(tags, ['v1.2.1-rc.1', 'v1.2.1-rc.2', 'v1.2.1-rc.3', 'v1.2.1-rc.4', 'v1.2.1-rc.5', 'v1.2.1-rc.6']);

  // Without --auto the newest (rc.6, minutes old) is the only one judged: testing, forever.
  const plain = finalize(fx, ['--dry']);
  assert.strictEqual(plain.body.state, 'testing');

  const first = finalize(fx, ['--auto']); // opens the tracking issue — its creation places every clock
  assert.strictEqual(first.code, 0, first.out + first.err);
  assert.strictEqual(tracking(fx).length, 1);
  ageTracking(fx, 7);

  const r = finalize(fx, ['--auto']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.state, 'finalized', JSON.stringify(r.body.checks, null, 2));
  assert.strictEqual(r.body.candidate.tag, 'v1.2.1-rc.3', 'cut 4 days ago: the newest whose own 3d period elapsed');
  assert.ok(originTags(fx).includes('v1.2.1'));
  assert.strictEqual(fx.g('rev-parse', 'v1.2.1^{commit}'), fx.g('rev-parse', 'v1.2.1-rc.3^{commit}'));
  assert.deepStrictEqual(r.body.skipped.map((x) => x.tag), ['v1.2.1-rc.6', 'v1.2.1-rc.5', 'v1.2.1-rc.4']);
  const t = tracking(fx)[0];
  assert.strictEqual(t.state, 'CLOSED');
  assert.ok(t.comments.some((c) => /does not restart an older one's clock/.test(c.body)));
});

test('--auto: release-hold still vetoes, whichever candidate would have been clean', () => {
  const fx = fixture();
  dailyCandidates(fx, [6, 0.01]);
  finalize(fx, ['--auto']);
  ageTracking(fx, 7);
  writeState(fx, (s) => { for (const i of s.issues) i.labels = [{ name: 'release-hold' }]; });
  const r = finalize(fx, ['--auto']);
  assert.strictEqual(r.body.state, 'held');
  assert.ok(!originTags(fx).includes('v1.2.1'));
});

test('--auto on a deploy-tag route never tags — it hands over the one click, number pre-filled', () => {
  const fx = fixture(HUMAN_YML);
  dailyCandidates(fx, [6]);
  finalize(fx, ['--auto']);
  ageTracking(fx, 7);
  const r = finalize(fx, ['--auto']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.strictEqual(r.body.state, 'candidate-ready');
  assert.match(r.body.handoff, /--tag v1\.2\.1-rc\.1/);
  assert.ok(!originTags(fx).includes('v1.2.1'));
  assert.ok(tracking(fx)[0].comments.some((c) => /v1\.2\.1-rc\.1 is ready/.test(c.body)));
});

test('--auto never combines with the human bar', () => {
  const fx = fixture();
  const r = finalize(fx, ['--auto', '--tag', 'v1.2.1-rc.1', '--answered-by', 'Ops'], { env: { COLAB_HUMAN: '1' } });
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /never carries the human bar/);
});

test('#424: a manifest that disagrees with the version refuses at the cut, before any final can exist', () => {
  const fx = fixture();
  dailyCandidates(fx, [6]);
  // A VERSION file that disagrees with the computed version: the cut refuses under the same named
  // check finalize runs (release-finalize.test.js covers the final's side of it).
  fs.writeFileSync(path.join(fx.work, 'VERSION'), '9.9.9\n');
  fx.g('add', '-A'); fx.g('commit', '-q', '-m', 'fix: version file'); fx.g('push', '-q', 'origin', 'main');
  writeState(fx, (s) => { s.runsAtCommit = [{ headSha: fx.g('rev-parse', 'HEAD'), status: 'completed', conclusion: 'success', workflowName: 'ci', event: 'push', createdAt: new Date().toISOString(), databaseId: 99 }]; });
  const cutR = colab(fx, ['cut'], { env: { GIT_COMMITTER_DATE: ago(5) } });
  assert.strictEqual(cutR.code, 1, 'the cut itself refuses on the same check');
  assert.strictEqual(cutR.body.checks.find((c) => c.condition === 'manifest-version').ok, false);
});
