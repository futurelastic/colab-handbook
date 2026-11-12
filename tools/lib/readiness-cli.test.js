'use strict';
/**
 * Subprocess/CLI tests for `colab readiness <N>` — the deps-checked path's gh I/O and the line it
 * prints (#388). The pure halves are pinned in labels.test.js (readinessMarkedMessage) and
 * blocked-by.test.js (openBlockerSummary); this file pins the WIRING: that the real command reads
 * blockedBy after the label write, reports what it read, never refuses on it, and never again
 * prints "verified: no open blocker" — the line #388 measured on issues with open blockers.
 *
 * Fixture shape copied from decision-cli.test.js: a real git clone with a bare origin (so
 * isGhUsable() reads true), a private COLAB_HOME, and a scripted fake `gh` keyed on its first two
 * argv words. The fake also appends every argv to a log, so a test can assert which calls ran.
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

function fixture(script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-readiness-cli-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab readiness test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const scriptPath = path.join(bin, 'gh-script.json');
  const logPath = path.join(bin, 'gh-calls.log');
  fs.writeFileSync(scriptPath, JSON.stringify(script));
  fs.writeFileSync(logPath, '');
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env node',
    `const fs = require('fs');`,
    `const script = JSON.parse(fs.readFileSync(${JSON.stringify(scriptPath)}, 'utf8'));`,
    'const argv = process.argv.slice(2);',
    `fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(argv) + "\\n");`,
    "if (argv[0] === '--version') { console.log('gh version 0.0.0 (fixture)'); process.exit(0); }",
    "if (argv[0] === 'auth' && argv[1] === 'status') { console.error('Logged in (fixture)'); process.exit(0); }",
    'const key = argv.slice(0, 2).join(" ");',
    'const entry = script[key];',
    'if (!entry) { console.error(`fixture gh: unscripted "${key}" — args: ${JSON.stringify(argv)}`); process.exit(1); }',
    'if (entry.stdout) process.stdout.write(entry.stdout);',
    'if (entry.stderr) process.stderr.write(entry.stderr);',
    'process.exit(entry.code || 0);',
  ].join('\n') + '\n', { mode: 0o755 });

  const calls = () => fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { root, work, home, bin, calls };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    cwd: fx.work,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const EDIT_OK = { code: 0, stdout: 'https://example.invalid/issues/7\n' };
// #727: the blockedBy read goes through the REST dependencies endpoint, never `gh issue view --json
// blockedBy` — that JSON field is absent on gh 2.85.0 ("Unknown JSON field"), which made the add
// path print "unread" and --mechanical refuse on every issue. The fake keys on the first two argv
// words, so the API call's key is `api <endpoint>`, query string included.
const EDGES_KEY = 'api repos/{owner}/{repo}/issues/7/dependencies/blocked_by?per_page=100';
// The REST shape readBlockedByEdges asks for with -q (measured live 2026-11-12 on an issue with one
// blocker): id/number/state/repository_url, state lower-case.
const edge = (number, state) => ({ id: 6000000000 + number, number, state, repository_url: 'https://api.github.com/repos/o/r' });
const edges = (list) => ({ code: 0, stdout: JSON.stringify(list) + '\n' });
// What gh 2.85.0 answers to the old route — scripted so a regression to it fails loudly here.
const VIEW_NO_FIELD = { code: 1, stderr: 'Unknown JSON field: "blockedBy"\n' };

const readCalls = (fx) => fx.calls().filter((a) => a[0] === 'api' && /\/dependencies\/blocked_by/.test(a[1] || ''));
const viewCalls = (fx) => fx.calls().filter((a) => a[0] === 'issue' && a[1] === 'view');

test('#388: open blockers are REPORTED, the label is still written, exit 0 — and "verified: no open blocker" is gone', () => {
  const fx = fixture({
    'issue edit': EDIT_OK,
    'issue view': VIEW_NO_FIELD,
    [EDGES_KEY]: edges([edge(1, 'open'), edge(2, 'open'), edge(3, 'open')]),
  });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Marked #7 in .* deps-checked — dependencies reviewed; blockedBy: 3 open of 3 \(an open edge carries the block/);
  assert.doesNotMatch(r.out, /verified|no open blocker/);
  const keys = fx.calls().map((a) => a.slice(0, 2).join(' '));
  assert.ok(keys.includes('issue edit'), 'the label write ran');
  assert.equal(readCalls(fx).length, 1, 'blockedBy was read once, through the REST endpoint');
});

test('#727: the read route is pinned — REST dependencies/blocked_by, never `gh issue view --json blockedBy`', () => {
  const fx = fixture({ 'issue edit': EDIT_OK, 'issue view': VIEW_NO_FIELD, [EDGES_KEY]: edges([]) });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /unread/, 'the gh 2.85.0 symptom: "unread" on an issue that reads fine via the API');
  assert.equal(viewCalls(fx).length, 0, 'no `gh issue view` call at all');
  const [read] = readCalls(fx);
  assert.ok(read, 'the REST endpoint was read');
  assert.equal(read[1], 'repos/{owner}/{repo}/issues/7/dependencies/blocked_by?per_page=100');
});

test('#388: an empty graph reads "0 open", still never "verified"', () => {
  const fx = fixture({ 'issue edit': EDIT_OK, [EDGES_KEY]: edges([]) });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /dependencies reviewed; blockedBy: 0 open\s*$/m);
  assert.doesNotMatch(r.out, /verified|no open blocker/);
});

test('#388: closed-only blockers count as 0 open of N — no block caveat', () => {
  const fx = fixture({ 'issue edit': EDIT_OK, [EDGES_KEY]: edges([edge(1, 'closed'), edge(2, 'closed')]) });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /blockedBy: 0 open of 2\s*$/m);
});

test('#388: a FAILED blockedBy read is "unread", never zero — and the label write still stands (exit 0)', () => {
  const fx = fixture({ 'issue edit': EDIT_OK, [EDGES_KEY]: { code: 1, stderr: 'HTTP 502\n' } });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /blockedBy: unread/);
  assert.doesNotMatch(r.out, /0 open|verified|no open blocker/);
});

test('#728: the add path\'s "unread" line names the underlying error — exit code and stderr', () => {
  const fx = fixture({ 'issue edit': EDIT_OK, [EDGES_KEY]: { code: 1, stderr: '\nHTTP 502: Bad Gateway (https://api.github.com/...)\nmore detail\n' } });
  const r = colab(fx, ['readiness', '7']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /blockedBy: unread \(`gh api …\/dependencies\/blocked_by` exit 1: HTTP 502: Bad Gateway \(https:\/\/api\.github\.com\/\.\.\.\); the label records your review/);
  assert.doesNotMatch(r.out, /more detail/, 'first non-empty stderr line only');
});

test('#388: --clear does not read blockedBy (nothing to report on a removal)', () => {
  const fx = fixture({ 'issue edit': EDIT_OK });
  const r = colab(fx, ['readiness', '7', '--clear']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Cleared deps-checked on #7 .* UNCHECKED/);
  assert.equal(readCalls(fx).length + viewCalls(fx).length, 0, 'no blockedBy read on --clear');
});

test('#388: a failed label write still refuses BEFORE any blockedBy read — no success line', () => {
  const fx = fixture({ 'issue edit': { code: 1, stderr: 'HTTP 500\n' }, 'label list': { code: 0, stdout: '[]\n' } });
  const r = colab(fx, ['readiness', '7']);
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.out, /Marked #7/);
  assert.equal(readCalls(fx).length + viewCalls(fx).length, 0, 'no read after a failed write');
});

// --- --mechanical (#69), on the same read (#727) ---------------------------------------------------

const LABELS_WITH_GRAPH_EMPTY = { code: 0, stdout: 'deps-checked\ngraph-empty\n' };
const COMMENT_OK = { code: 0, stdout: 'https://example.invalid/issues/7#issuecomment-1\n' };

test('#727: --mechanical on an empty graph writes graph-empty and posts its receipt — even where `issue view --json blockedBy` fails', () => {
  const fx = fixture({
    'label list': LABELS_WITH_GRAPH_EMPTY,
    'issue view': VIEW_NO_FIELD,
    [EDGES_KEY]: edges([]),
    'issue edit': EDIT_OK,
    'issue comment': COMMENT_OK,
  });
  const r = colab(fx, ['readiness', '7', '--mechanical']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Marked #7 in .* graph-empty — blockedBy reads empty \(receipt posted\)/);
  assert.equal(viewCalls(fx).length, 0, 'no `gh issue view` call');
  const edit = fx.calls().find((a) => a[0] === 'issue' && a[1] === 'edit');
  assert.ok(edit && edit.includes('graph-empty'), 'graph-empty was added');
  assert.ok(!edit.includes('deps-checked'), 'deps-checked is never touched by the mechanical lane');
  const comment = fx.calls().find((a) => a[0] === 'issue' && a[1] === 'comment');
  assert.ok(comment, 'the receipt was posted');
  assert.match(comment[comment.indexOf('--body') + 1], /^Mechanical readiness: `blockedBy` reads 0 edges/);
});

test('#727: --mechanical with recorded blockers REFUSES and reports the count — no label, no receipt', () => {
  const fx = fixture({
    'label list': LABELS_WITH_GRAPH_EMPTY,
    [EDGES_KEY]: edges([edge(1, 'open'), edge(2, 'closed'), edge(3, 'open')]),
  });
  const r = colab(fx, ['readiness', '7', '--mechanical']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /#7 has 3 recorded blocker\(s\), 2 open — graph-empty asserts an EMPTY graph.*`colab readiness 7`/);
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && (a[1] === 'edit' || a[1] === 'comment')), 'nothing written');
});

test('#727/#728: --mechanical on a FAILED read still refuses — and names the underlying error and the next command', () => {
  const fx = fixture({ 'label list': LABELS_WITH_GRAPH_EMPTY, [EDGES_KEY]: { code: 4, stderr: 'HTTP 401: Bad credentials (https://api.github.com/graphql)\n' } });
  const r = colab(fx, ['readiness', '7', '--mechanical']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /could not read #7's blockedBy graph \(`gh api …\/dependencies\/blocked_by` exit 4: HTTP 401: Bad credentials [^)]*\)\) — refusing to write graph-empty on an unmeasured read/);
  assert.match(r.err, /`gh api repos\/\{owner\}\/\{repo\}\/issues\/7\/dependencies\/blocked_by`/, 'names the read to re-run');
  assert.match(r.err, /`colab readiness 7 --mechanical`/, 'names the command to resume with');
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && (a[1] === 'edit' || a[1] === 'comment')), 'nothing written');
});

test('#728: --mechanical on an UNPARSEABLE response refuses as a parse failure, not as a gh failure', () => {
  const fx = fixture({ 'label list': LABELS_WITH_GRAPH_EMPTY, [EDGES_KEY]: { code: 0, stdout: '<html>not json</html>\n' } });
  const r = colab(fx, ['readiness', '7', '--mechanical']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /could not read #7's blockedBy graph \(unparseable response from `gh api …\/dependencies\/blocked_by` \(/);
  assert.doesNotMatch(r.err, /exit \d/);
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && (a[1] === 'edit' || a[1] === 'comment')), 'nothing written');
});

test('#728: --mechanical on JSON of the wrong SHAPE refuses and says so', () => {
  const fx = fixture({ 'label list': LABELS_WITH_GRAPH_EMPTY, [EDGES_KEY]: { code: 0, stdout: '{"message":"Not Found"}\n' } });
  const r = colab(fx, ['readiness', '7', '--mechanical']);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /could not read #7's blockedBy graph \(the response was not a list of issues \(unexpected shape\)\)/);
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && (a[1] === 'edit' || a[1] === 'comment')), 'nothing written');
});
