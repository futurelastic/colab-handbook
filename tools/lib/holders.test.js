'use strict';
/**
 * Tests for `colab holders <path>` (#152) — the who-holds-this-file check
 * (CONVENTIONS.md §5/§11, code-start step 3) exposed as a command instead of a
 * hand-copied one-liner, filtered through the same content classification `colab
 * landed` uses (tools/lib/landed.js) so a spent branch does not read as live
 * contention.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Drives the real CLI against a real repo with a real `origin` (a bare repo on disk,
 * so nothing here touches the network) for the same reason colab-base.test.js does:
 * this is a WIRING property (the git-log query, ref-name stripping, and the landed
 * filter all composing correctly through the CLI), not something a unit test of one
 * function would catch.
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

/** A clone with a real bare `origin`, a `main` trunk, and a private COLAB_HOME. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-holders-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab holders test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'DOC.md'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  return { root, origin, work, home, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// --- clean ground -------------------------------------------------------------

test('a path with no branch history reports clean ground', () => {
  const fx = fixture();
  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /clean ground/);
});

test('a nonexistent path reports clean ground, not an error', () => {
  const fx = fixture();
  const r = colab(fx, ['holders', 'no/such/file.md', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /clean ground/);
});

// --- the false-positive #152 was filed for ------------------------------------

test('a branch whose edit to the path already landed on trunk is NOT reported as a holder', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/edit-doc-9');
  fs.writeFileSync(path.join(fx.work, 'DOC.md'), 'base\nedit one\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: edit');
  fs.writeFileSync(path.join(fx.work, 'DOC.md'), 'base\nedit one\nedit two\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: edit more');
  // Squash-merge into trunk, the way `colab ship` does — so the branch's own commits are
  // never ancestors of main, which is exactly the trap the naive "commits ahead" rule falls into.
  fx.g(fx.work, 'checkout', '-q', 'main');
  fx.g(fx.work, 'merge', '-q', '--squash', 'feat/edit-doc-9');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: edit (#9)');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');

  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /clean ground/, 'a landed branch must be filtered out, not reported as a holder');
});

test('a branch with genuine unmerged cargo on the path IS reported', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/live-edit-10');
  fs.writeFileSync(path.join(fx.work, 'DOC.md'), 'base\nunshipped edit\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: unshipped edit');
  fx.g(fx.work, 'push', '-q', 'origin', 'feat/live-edit-10');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /feat\/live-edit-10/);
  assert.match(r.out, /cargo/);
});

test('--json reports the ref, branch, verdict and why — never silently drops `unknown`', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/live-edit-11');
  fs.writeFileSync(path.join(fx.work, 'DOC.md'), 'base\nlive\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: live');
  fx.g(fx.work, 'push', '-q', 'origin', 'feat/live-edit-11');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work, '--json']);
  assert.strictEqual(r.code, 0, r.err);
  const body = JSON.parse(r.out);
  // #179: fresh fetch succeeded here, so the payload says so and names no staleness cause.
  assert.strictEqual(body.fresh, true);
  assert.strictEqual(body.staleWhy, null);
  assert.strictEqual(body.holders.length, 1);
  assert.strictEqual(body.holders[0].branch, 'feat/live-edit-11');
  assert.strictEqual(body.holders[0].state, 'cargo', 'fixture invalid: this branch is genuinely unmerged, not the unknown case');
  assert.ok(body.holders[0].why, 'why must always be present, whatever the verdict');
});

// --- the load-bearing case: `unknown` must survive the filter, never collapse into either bucket ---
//
// Boss's ruling for #152 chose option A explicitly because `landed`'s `unknown` verdict means
// "no confident answer, look by hand" — never "assume clear" and never "assume cargo". A holders
// implementation that silently dropped `unknown` rows (reading them as landed, so filtered out) or
// that folded them into `cargo` with no way to tell them apart would reintroduce exactly the defect
// this issue exists to fix, just one layer removed. This proves the verdict survives verbatim.
test('a ref whose edit trunk REWROTE (not merged, not absent) reports `unknown` — and is NOT dropped', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/rewritten-12');
  fs.writeFileSync(path.join(fx.work, 'DOC.md'), 'base\nbranch version\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: branch edit');
  fx.g(fx.work, 'push', '-q', 'origin', 'feat/rewritten-12');
  fx.g(fx.work, 'checkout', '-q', 'main');
  // Trunk edits the SAME line differently, after the branch forked — a genuine merge conflict,
  // not absence of overlap. This is precisely lib/landed.js's documented "still not covered" case.
  fs.writeFileSync(path.join(fx.work, 'DOC.md'), 'base\ntrunk rewrote this differently\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: trunk edit');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');

  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work, '--json']);
  assert.strictEqual(r.code, 0, r.err);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.fresh, true);
  assert.strictEqual(body.holders.length, 1, 'unknown must appear in the output, not be silently filtered out');
  assert.strictEqual(body.holders[0].branch, 'feat/rewritten-12');
  assert.strictEqual(body.holders[0].state, 'unknown', 'fixture invalid: the merge was expected to conflict, not resolve cleanly');
  assert.strictEqual(body.holders[0].containment, 'unknown');

  // Same case through the human-readable table: the caller's-eye view must show `unknown` too,
  // not silently print it as clean ground or fold its row into the `cargo` label.
  const table = colab(fx, ['holders', 'DOC.md', '--repo', fx.work]);
  assert.strictEqual(table.code, 0, table.err);
  assert.doesNotMatch(table.out, /clean ground/, 'an unknown holder must never read as clean ground');
  assert.match(table.out, /feat\/rewritten-12/);
  assert.match(table.out, /unknown/);
});

test('--help and a missing path both print usage rather than failing', () => {
  const fx = fixture();
  const help = colab(fx, ['holders', '--help', '--repo', fx.work]);
  assert.strictEqual(help.code, 0);
  assert.match(help.out, /colab holders <path>/);

  const bare = colab(fx, ['holders', '--repo', fx.work]);
  assert.strictEqual(bare.code, 0);
  assert.match(bare.out, /colab holders <path>/);
});

// --- freshness: the enumeration reads LOCAL refs, so the command owns the fetch ---------------
//
// `git log --all` cannot see a branch this clone has never fetched. That makes "clean ground" the
// one verdict a stale clone can get catastrophically wrong — a confident answer built on missing
// data — and it is exactly the answer a caller acts on by starting a parallel branch. A command is
// held to a higher bar than the one-liner it replaces here: the one-liner at least sat next to a
// documented `git fetch --prune origin`, while a command name implies freshness is handled inside.

/** A SECOND clone of the same origin — stands in for another session, on another machine. */
function otherClone(fx, name) {
  const dir = path.join(fx.root, name);
  execFileSync('git', ['clone', '-q', fx.origin, dir], { encoding: 'utf8' });
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('config', 'user.email', 'other@example.invalid');
  g('config', 'user.name', 'other session');
  g('config', 'core.hooksPath', path.join(fx.root, '.nohooks'));
  return { dir, g };
}

test('a branch pushed by ANOTHER session and never fetched here is still found — the command fetches', () => {
  const fx = fixture();
  const other = otherClone(fx, 'other-session');
  other.g('checkout', '-q', '-b', 'feat/their-edit-20');
  fs.writeFileSync(path.join(other.dir, 'DOC.md'), 'base\ntheir unshipped edit\n');
  other.g('add', '-A');
  other.g('commit', '-q', '-m', 'feat: their edit');
  other.g('push', '-q', 'origin', 'feat/their-edit-20');

  // Our clone has never heard of that branch: prove the setup is really the trap before asserting.
  const localOnly = execFileSync('git', ['branch', '-a', '--list', '*their-edit-20*'],
    { cwd: fx.work, encoding: 'utf8' });
  assert.strictEqual(localOnly.trim(), '', 'fixture invalid: our clone already knows the branch');

  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /feat\/their-edit-20/, 'the fetch inside the command must surface a ref only origin had');
  assert.doesNotMatch(r.out, /clean ground/);
});

test('--no-fetch REFUSES a clean-ground verdict (exit 2) rather than printing one off stale refs', () => {
  const fx = fixture();
  const other = otherClone(fx, 'other-session-2');
  other.g('checkout', '-q', '-b', 'feat/their-edit-21');
  fs.writeFileSync(path.join(other.dir, 'DOC.md'), 'base\ntheir unshipped edit\n');
  other.g('add', '-A');
  other.g('commit', '-q', '-m', 'feat: their edit');
  other.g('push', '-q', 'origin', 'feat/their-edit-21');

  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work, '--no-fetch']);
  // Without the fetch the enumeration genuinely finds nothing — and that is precisely when it must
  // NOT say so. A wrong "clean ground" here is what sends a second session onto a held file.
  assert.strictEqual(r.code, 2, 'a clean result off unfetched refs must be refused, not reported');
  assert.doesNotMatch(r.out, /clean ground/, 'the affirmative line must never be printed unfetched');
  assert.match(r.err, /refusing to report "clean ground"/);
});

test('--no-fetch with --json refuses too — a machine caller cannot be handed a stale empty array', () => {
  const fx = fixture();
  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work, '--no-fetch', '--json']);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.out.trim(), '', 'no JSON body at all — `[]` would read as a confident clean answer');
});

test('--no-fetch still REPORTS holders it can see — refs you have not fetched cannot un-hold a file', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/local-edit-22');
  fs.writeFileSync(path.join(fx.work, 'DOC.md'), 'base\nlocal unshipped edit\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: local edit');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work, '--no-fetch']);
  assert.strictEqual(r.code, 0, 'a NEGATIVE answer is sound offline — only the clean verdict is not');
  assert.match(r.out, /feat\/local-edit-22/);
  assert.match(r.err, /may be incomplete/, 'the list is still flagged as possibly partial');
});

// --- #179: --json discloses staleness IN the payload, not only on stderr -----------------------
//
// A `--no-fetch` run that finds holders is answered at exit 0 (they are real regardless of
// freshness) — but before this fix the ONLY signal that the list might be incomplete was a stderr
// warn() printed AFTER the JSON on stdout. A machine caller reading stdout alone saw two clean rows
// and no way to tell "these are the two holders" from "two of an unknown number".
test('--no-fetch --json: holders present still report fresh:false and staleWhy, not just a bare array', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'feat/local-edit-23');
  fs.writeFileSync(path.join(fx.work, 'DOC.md'), 'base\nlocal unshipped edit\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'feat: local edit');
  fx.g(fx.work, 'checkout', '-q', 'main');

  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work, '--no-fetch', '--json']);
  assert.strictEqual(r.code, 0, r.err);
  const body = JSON.parse(r.out);
  assert.strictEqual(body.fresh, false);
  assert.match(body.staleWhy, /--no-fetch was passed/);
  assert.strictEqual(body.holders.length, 1);
  assert.strictEqual(body.holders[0].branch, 'feat/local-edit-23');
});

test('a repo with no origin remote cannot be fresh, so a clean result is refused there too', () => {
  const fx = fixture();
  fx.g(fx.work, 'remote', 'remove', 'origin');
  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work, '--base', 'main']);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /no `origin` remote/);
});

// #179, "also while in this function": staleness cause (iii) — an `origin` remote that EXISTS but
// whose fetch itself errors — reaches the same `!fresh` gate as (i) `--no-fetch` and (ii) no
// remote, both of which are pinned above, but nothing previously exercised this one. A regression
// that treated a nonzero `git fetch` exit as success would silently restore the pre-#152 defect
// (a wrong "clean ground" reported to a caller with a broken remote) with no test to catch it.
test('origin remote exists but the fetch itself fails: staleness cause (iii), not (i) or (ii) — still refused', () => {
  const fx = fixture();
  fx.g(fx.work, 'remote', 'set-url', 'origin', path.join(fx.root, 'no-such-origin.git'));
  const r = colab(fx, ['holders', 'DOC.md', '--repo', fx.work, '--base', 'main']);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /git fetch --prune origin failed/);
});
