'use strict';
/**
 * #487 — a claim row keyed by a linked worktree's path could never be released.
 *
 * Every claim is keyed `<mainRoot>#N`, and `findClaim` scoped on exactly that prefix. Two things
 * broke it from inside a linked worktree:
 *   - the WRITER: `colab claims --sync` added `git.repoRoot(cwd)` (the worktree, not the main
 *     root) to its repo set, so every assigned issue was re-added as `<worktree>#N` — a second row
 *     that outlived the worktree directory;
 *   - the LOOKUPS: a dozen commands, `release` among them, fell back to `git.repoRoot(cwd)` when
 *     no --repo was given, so a release run from inside a worktree looked up `<worktree>#N`.
 * And a row already written that way was unreachable by every command: `--repo <mainRoot>` missed
 * the key, `--repo <worktree>` threw because the directory was gone.
 *
 * Driven end-to-end against the real CLI, a real repo, a real linked worktree and a fake `gh` on
 * PATH; `COLAB_HOME` is private per test so the developer's state.json is never touched.
 *
 * Run: `node --test tools/lib/claim-worktree-key.test.js`
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const COLAB = path.resolve(__dirname, '..', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/**
 * A fake `gh`: `issue list` answers with the issues in FAKE_GH_ASSIGNED, `issue view` says OPEN,
 * every write succeeds. Each invocation is appended to FAKE_GH_LOG with its cwd, so a test can
 * prove WHICH directory the tracker call was made from.
 */
function fakeGh(root) {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ cwd: process.cwd(), args }) + '\\n');
const out = (s) => { if (s) process.stdout.write(s); process.exit(0); };
if (args[0] === '--version') out('gh version 2.0.0 (fake)\\n');
if (args[0] === 'auth') out('Logged in (fake)\\n');
if (args[0] === 'issue' && args[1] === 'list') {
  out(JSON.stringify((process.env.FAKE_GH_ASSIGNED || '').split(',').filter(Boolean).map((n) => ({ number: Number(n) }))) + '\\n');
}
if (args[0] === 'issue' && args[1] === 'view') out('{"state":"OPEN"}\\n');
if (args[0] === 'api' && args.includes('user')) out('octofake\\n');
out('');
`, { mode: 0o755 });
  return bin;
}

function fixture() {
  // realpath: on macOS /tmp is a symlink, and mainRepoRoot answers with the resolved path.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'colab-wtkey-')));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'wtkey test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(work, 'README'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  // A real linked worktree, at the layout the stuck rows were measured under.
  const wt = path.join(work, '.claude', 'worktrees', 'thing-1');
  g(work, 'worktree', 'add', '-q', '-b', 'fix/thing-1', wt, 'origin/main');
  return { root, work, wt, home, g, ghBin: fakeGh(root), log: path.join(root, 'gh.log') };
}

function colab(fx, cwd, args, env = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    cwd, encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.ghBin}:${process.env.PATH}`,
      COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', FAKE_GH_LOG: fx.log, ...env,
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const readState = (fx) => JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
const writeState = (fx, claims) => fs.writeFileSync(path.join(fx.home, 'state.json'),
  JSON.stringify({ version: 1, worktrees: {}, claims, ports: {}, solo: {} }));
const row = (repo, n) => ({ issue: `#${n}`, repo, worktree: null, branch: null, host: 'test-host', session: null, sessionName: null, created: new Date().toISOString() });
const ghCalls = (fx) => (fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('claims --sync run from INSIDE a linked worktree keys the added claim by the MAIN root (the writer of the stuck rows)', () => {
  const fx = fixture();
  writeState(fx, {});
  const r = colab(fx, fx.wt, ['claims', '--sync'], { FAKE_GH_ASSIGNED: '487' });
  assert.strictEqual(r.code, 0, r.err);
  const keys = Object.keys(readState(fx).claims);
  assert.deepStrictEqual(keys, [`${fx.work}#487`], `expected only the main-root key, got ${JSON.stringify(keys)}`);
  assert.strictEqual(readState(fx).claims[`${fx.work}#487`].repo, fx.work);
});

test('claims --sync does not re-add a legacy worktree path as a repo of its own', () => {
  const fx = fixture();
  const gone = path.join(fx.work, '.claude', 'worktrees', 'gone-2');
  writeState(fx, { [`${gone}#2`]: row(gone, 2) });
  const r = colab(fx, fx.work, ['claims', '--sync'], { FAKE_GH_ASSIGNED: '2' });
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(!ghCalls(fx).some((c) => c.args[1] === 'list' && c.cwd === gone), 'no gh call may run from a vanished worktree path');
  assert.ok(readState(fx).claims[`${fx.work}#2`], 'the issue is re-mirrored under the main root');
});

test('release run from INSIDE a linked worktree, with no --repo, finds a claim keyed by the main root', () => {
  const fx = fixture();
  writeState(fx, { [`${fx.work}#9`]: row(fx.work, 9) });
  const r = colab(fx, fx.wt, ['release', '9']);
  assert.strictEqual(r.code, 0, `release from a worktree must find the claim — stderr: ${r.err}`);
  assert.strictEqual(readState(fx).claims[`${fx.work}#9`], undefined);
});

test('a legacy row keyed by a VANISHED linked-worktree path is released by `release N --repo <mainRoot>`, against the main root', () => {
  const fx = fixture();
  const gone = path.join(fx.work, '.claude', 'worktrees', 'gone-11');
  assert.ok(!fs.existsSync(gone));
  writeState(fx, { [`${gone}#11`]: row(gone, 11) });
  const r = colab(fx, fx.root, ['release', '11', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(readState(fx).claims[`${gone}#11`], undefined, 'the stuck row must be cleared');
  assert.doesNotMatch(r.err, /LOCAL-ONLY/, 'the tracker half must be released too, not skipped because the row\'s own path is gone');
  const writes = ghCalls(fx).filter((c) => c.args[0] === 'issue' || (c.args[0] === 'api' && !c.args.includes('user')));
  assert.ok(writes.length > 0, 'gh must have been called');
  assert.ok(writes.every((c) => c.cwd === fx.work), `every gh call must run in the main root, got ${JSON.stringify(writes.map((c) => c.cwd))}`);
});

test('a legacy row is also released from the main checkout with no --repo, and from inside another worktree', () => {
  const fx = fixture();
  const gone = path.join(fx.work, '.claude', 'worktrees', 'gone-12');
  const gone2 = path.join(fx.work, '.worktrees', 'gone-13');
  writeState(fx, { [`${gone}#12`]: row(gone, 12), [`${gone2}#13`]: row(gone2, 13) });
  assert.strictEqual(colab(fx, fx.work, ['release', '12']).code, 0);
  assert.strictEqual(colab(fx, fx.wt, ['release', '13']).code, 0);
  assert.deepStrictEqual(readState(fx).claims, {});
});

test('scoping does not over-match: a sibling repo sharing the prefix, or a separate repo nested inside, is not this repo', () => {
  const fx = fixture();
  const sibling = `${fx.work}-other`;
  const nested = path.join(fx.work, 'vendor', 'lib');
  fs.mkdirSync(nested, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', nested]);
  writeState(fx, { [`${sibling}#20`]: row(sibling, 20), [`${nested}#21`]: row(nested, 21) });
  const a = colab(fx, fx.root, ['release', '20', '--repo', fx.work]);
  assert.notStrictEqual(a.code, 0);
  assert.match(a.err + a.out, /No local claim for #20/);
  const b = colab(fx, fx.root, ['release', '21', '--repo', fx.work]);
  assert.notStrictEqual(b.code, 0);
  assert.match(b.err + b.out, /No local claim for #21/);
  assert.strictEqual(Object.keys(readState(fx).claims).length, 2, 'neither row may be touched');
});

test('claim taken from INSIDE a linked worktree, with no --repo, is keyed by the main root', () => {
  const fx = fixture();
  writeState(fx, {});
  const r = colab(fx, fx.wt, ['claim', '31', '--session', 'sess-wtkey']);
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(Object.keys(readState(fx).claims), [`${fx.work}#31`]);
  // and the same session, still inside the worktree, can release it again
  assert.strictEqual(colab(fx, fx.wt, ['release', '31']).code, 0);
  assert.deepStrictEqual(readState(fx).claims, {});
});
