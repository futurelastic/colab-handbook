'use strict';
/**
 * Subprocess/CLI tests for `colab close` (#381) — close an issue OUTSIDE a ship: evidence comment,
 * close, claim release, and one `issue.closed` event.
 *
 * Real CLI, real repo with a real bare `origin` on disk, private COLAB_HOME, and a STATEFUL fake
 * `gh` on PATH: it keeps the issue (state, labels, assignees, comments) in a JSON file so a close
 * or an edit is visible to the next read, and appends every call to a log so ordering can be
 * asserted. The notify receiver is a real HTTP server in this process — which is why the CLI is run
 * with an async spawn, never spawnSync: a blocked event loop could not accept the detached child's
 * POST, and the event count would measure the test harness instead of the command.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const ME = 'tester';

/**
 * `issue` seeds the fake tracker: { number, state, labels:[names], assignees:[logins], comments:[bodies] }.
 * `fail` names gh subcommands ("issue comment", "issue close", "issue edit") that must fail.
 */
function fixture({ issue, fail = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-close-cli-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab close test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  // The path colab keys its state by — git's own answer, so a /var vs /private/var symlink never
  // makes the seeded claim miss.
  const repoAbs = g(work, 'rev-parse', '--show-toplevel').trim();

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const tracker = path.join(root, 'tracker.json');
  const log = path.join(root, 'gh-calls.log');
  fs.writeFileSync(tracker, JSON.stringify({ issue, fail }));
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const T = ${JSON.stringify(tracker)};
const db = JSON.parse(fs.readFileSync(T, 'utf8'));
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const key = argv.slice(0, 2).join(' ');
const save = () => fs.writeFileSync(T, JSON.stringify(db));
const out = (s) => { process.stdout.write(s); process.exit(0); };
if (argv[0] === '--version') out('gh version 0.0.0 (fixture)\\n');
if (key === 'auth status') process.exit(0);
if (db.fail.includes(key)) { process.stderr.write('fixture: ' + key + ' failed\\n'); process.exit(1); }
const is = db.issue;
if (key === 'api user') out(${JSON.stringify(ME)} + '\\n');
if (argv[0] === 'api' && argv.some((a) => /\\/events$/.test(a))) out(is.labels.includes('in-progress') || is.labeledBy ? (is.labeledBy || ${JSON.stringify(ME)}) + '\\n' : '');
if (argv[0] === 'api' && argv.some((a) => /issues\\/\\d+$/.test(a))) out(is.assignees.join('\\n') + (is.assignees.length ? '\\n' : ''));
if (key === 'issue view') {
  out(JSON.stringify({
    state: is.state,
    labels: is.labels.map((name) => ({ name })),
    assignees: is.assignees.map((login) => ({ login })),
    comments: is.comments.map((body) => ({ body, author: { login: ${JSON.stringify(ME)} } })),
  }) + '\\n');
}
if (key === 'issue comment') { is.comments.push(argv[argv.indexOf('--body') + 1]); save(); out('https://example.invalid/c\\n'); }
if (key === 'issue close') { is.state = 'CLOSED'; is.reason = argv[argv.indexOf('--reason') + 1]; save(); out(''); }
if (key === 'issue edit') {
  const i = argv.indexOf('--remove-label');
  if (i > 0) is.labels = is.labels.filter((l) => l !== argv[i + 1]);
  const j = argv.indexOf('--remove-assignee');
  if (j > 0) { const drop = argv[j + 1].split(',').map((x) => (x === '@me' ? ${JSON.stringify(ME)} : x)); is.assignees = is.assignees.filter((a) => !drop.includes(a)); }
  save(); out('');
}
process.stderr.write('fixture gh: unscripted ' + JSON.stringify(argv) + '\\n');
process.exit(1);
`, { mode: 0o755 });

  return {
    root, work, home, bin, repoAbs,
    tracker: () => JSON.parse(fs.readFileSync(tracker, 'utf8')).issue,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    state: () => JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8')),
  };
}

/** A local claim record, the shape `colab claim` writes (no machine field ⇒ read as legacy/local). */
function seedClaim(fx, num, extra = {}) {
  const st = { version: 1, worktrees: {}, claims: {}, ports: {}, solo: {}, places: {} };
  st.claims[`${fx.repoAbs}#${num}`] = {
    issue: `#${num}`, repo: fx.repoAbs, worktree: null, branch: null, host: os.hostname(),
    session: 'session_close_test', sessionName: 'close-test', created: new Date().toISOString(), ...extra,
  };
  fs.writeFileSync(path.join(fx.home, 'state.json'), JSON.stringify(st, null, 2));
}

function setNotify(fx, url) {
  fs.writeFileSync(path.join(fx.home, 'config.json'), JSON.stringify({ notifyUrl: url }));
}

function colab(fx, args) {
  return new Promise((resolve) => {
    const child = spawn('node', [COLAB, ...args], {
      cwd: fx.work,
      env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
    });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/** A real receiver. `settle()` waits for stragglers from detached children, then returns every event. */
async function receiver() {
  const events = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { try { events.push(JSON.parse(body)); } catch (_) {} res.writeHead(201); res.end('{}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/api/events`,
    settle: async (ms = 1500) => { await new Promise((r) => setTimeout(r, ms)); server.close(); return events; },
  };
}

const openClaimed = (n) => ({ number: n, state: 'OPEN', labels: ['enhancement', 'in-progress'], assignees: [ME], comments: ['🔒 Claimed by close-test'] });

// --- the Done-when oracle --------------------------------------------------------------------

test('close: an open, claimed issue ends closed and unclaimed, with exactly one issue.closed event', async () => {
  const fx = fixture({ issue: openClaimed(7) });
  seedClaim(fx, 7);
  const rx = await receiver();
  setNotify(fx, rx.url);

  const r = await colab(fx, ['close', '7', '--comment', 'Live check passed on abc123; nothing left.']);
  const events = await rx.settle();
  assert.strictEqual(r.code, 0, `STDOUT:${r.out}\nSTDERR:${r.err}`);

  const is = fx.tracker();
  assert.strictEqual(is.state, 'CLOSED');
  assert.strictEqual(is.reason, 'completed');
  assert.ok(!is.labels.includes('in-progress'), 'in-progress must be gone');
  assert.deepStrictEqual(is.assignees, [], 'the claimer assignee must be gone');
  assert.ok(is.comments.includes('Live check passed on abc123; nothing left.'));
  assert.ok(!is.comments.some((c) => c.startsWith('✅ Released')), 'no release chatter on a close — the evidence comment is the story');
  assert.deepStrictEqual(Object.keys(fx.state().claims), [], 'the local claim must be gone');

  const closed = events.filter((e) => e.kind === 'issue.closed');
  assert.strictEqual(closed.length, 1, `exactly one issue.closed; got ${JSON.stringify(events)}`);
  assert.strictEqual(closed[0].issue, 7);
  assert.deepStrictEqual(closed[0].payload, { reason: 'completed' });
  assert.strictEqual(events.filter((e) => e.kind === 'claim.released').length, 1, 'the release reports itself as colab release would');

  // Order: evidence first, then the close, then the release — so a failure never leaves half a story.
  const kinds = fx.calls().map((a) => a.slice(0, 2).join(' ')).filter((k) => ['issue comment', 'issue close', 'issue edit'].includes(k));
  assert.deepStrictEqual(kinds, ['issue comment', 'issue close', 'issue edit']);
});

test('close: a dead notify receiver still closes the issue', async () => {
  const fx = fixture({ issue: openClaimed(8) });
  seedClaim(fx, 8);
  setNotify(fx, 'http://127.0.0.1:1/api/events'); // nothing listens on port 1
  const r = await colab(fx, ['close', '8', '--comment', 'done']);
  assert.strictEqual(r.code, 0, `STDOUT:${r.out}\nSTDERR:${r.err}`);
  assert.strictEqual(fx.tracker().state, 'CLOSED');
  assert.deepStrictEqual(Object.keys(fx.state().claims), []);
});

// --- refusals change nothing ----------------------------------------------------------------

test('close: no --comment and only colab markers on the issue → refused, nothing changed', async () => {
  const fx = fixture({ issue: openClaimed(9) });
  seedClaim(fx, 9);
  const r = await colab(fx, ['close', '9']);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /no evidence comment/);
  assert.strictEqual(fx.tracker().state, 'OPEN');
  assert.ok(fx.tracker().labels.includes('in-progress'));
  assert.strictEqual(Object.keys(fx.state().claims).length, 1, 'the claim stands');
});

test('close: evidence already recorded on the issue is enough — no --comment needed', async () => {
  const issue = { ...openClaimed(10), comments: ['🔒 Claimed', 'Decision recorded: not doing this, see #3.'] };
  const fx = fixture({ issue });
  seedClaim(fx, 10);
  const r = await colab(fx, ['close', '10', '--reason', 'not-planned']);
  assert.strictEqual(r.code, 0, `STDOUT:${r.out}\nSTDERR:${r.err}`);
  assert.strictEqual(fx.tracker().state, 'CLOSED');
  assert.strictEqual(fx.tracker().reason, 'not planned');
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && a[1] === 'comment'), 'nothing to post');
});

test('close: the evidence comment fails to post → NOT closed, claim untouched', async () => {
  const fx = fixture({ issue: openClaimed(11), fail: ['issue comment'] });
  seedClaim(fx, 11);
  const r = await colab(fx, ['close', '11', '--comment', 'done']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(fx.tracker().state, 'OPEN');
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && a[1] === 'close'));
  assert.strictEqual(Object.keys(fx.state().claims).length, 1);
});

test('close: gh issue close fails → claim untouched, no event', async () => {
  const fx = fixture({ issue: openClaimed(12), fail: ['issue close'] });
  seedClaim(fx, 12);
  const rx = await receiver();
  setNotify(fx, rx.url);
  const r = await colab(fx, ['close', '12', '--comment', 'done']);
  const events = await rx.settle(800);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(Object.keys(fx.state().claims).length, 1);
  assert.ok(fx.tracker().labels.includes('in-progress'));
  assert.deepStrictEqual(events.filter((e) => e.kind === 'issue.closed'), []);
});

// --- the repair path, and the worktree report -------------------------------------------------

test('close: already closed by a bare gh issue close, label still on, no local claim → label removed, event sent, no second close', async () => {
  const fx = fixture({ issue: { ...openClaimed(13), state: 'CLOSED' } });
  const rx = await receiver();
  setNotify(fx, rx.url);
  const r = await colab(fx, ['close', '13']);
  const events = await rx.settle();
  assert.strictEqual(r.code, 0, `STDOUT:${r.out}\nSTDERR:${r.err}`);
  assert.match(r.out, /already closed/);
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && a[1] === 'close'), 'never re-close');
  assert.ok(!fx.tracker().labels.includes('in-progress'));
  assert.deepStrictEqual(fx.tracker().assignees, []);
  assert.strictEqual(events.filter((e) => e.kind === 'issue.closed').length, 1);
});

test('close: a worktree left with zero claims is reported, never removed', async () => {
  const fx = fixture({ issue: openClaimed(14) });
  seedClaim(fx, 14, { worktree: 'thing-14', branch: 'feat/thing-14' });
  const r = await colab(fx, ['close', '14', '--comment', 'done']);
  assert.strictEqual(r.code, 0, `STDOUT:${r.out}\nSTDERR:${r.err}`);
  assert.match(r.out, /worktree "thing-14" now has ZERO claims \(not removed/);
  assert.strictEqual(fx.tracker().state, 'CLOSED');
});

test('close: argument errors are refused before any gh write', async () => {
  const fx = fixture({ issue: openClaimed(15) });
  const both = await colab(fx, ['close', '15', '--comment', 'a', '--comment-file', 'b']);
  assert.notStrictEqual(both.code, 0);
  const bad = await colab(fx, ['close', '15', '--comment', 'a', '--reason', 'duplicate']);
  assert.notStrictEqual(bad.code, 0);
  assert.match(bad.err + bad.out, /--reason must be completed or not-planned/);
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && ['comment', 'close', 'edit'].includes(a[1])));
});
