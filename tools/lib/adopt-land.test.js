'use strict';
/**
 * #481 — `colab adopt --autonomy` and `--land`: the maintainer's adoption act puts the descriptor,
 * grant included, on trunk as its own commit, so the follow-up branch that adds CI is judged by a
 * trunk that already carries the grant (`colab ship`'s autonomy row reads the trunk checkout's
 * descriptor). Pure verdicts first, then the CLI against a real repo with a bare origin.
 *
 * Run: `node --test tools/lib/adopt-land.test.js`
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const adopt = require('./adopt.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// ------------------------------------------------------------------- autonomyGateVerdict (pure)

const HUMAN = { isTTY: false, colabHuman: true, answeredBy: 'Test Human' };
const AGENT = { isTTY: false, colabHuman: false, answeredBy: null };

test('autonomyGateVerdict: auto-trunk expands permission — refused without a human, exit 3', () => {
  const v = adopt.autonomyGateVerdict({ autonomy: 'auto-trunk', current: undefined, ceremony: undefined, ...AGENT });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.exitCode, 3);
  // COLAB_HUMAN alone is not enough — the same bar as writes: direct.
  const half = adopt.autonomyGateVerdict({ autonomy: 'auto-trunk', ...AGENT, colabHuman: true });
  assert.strictEqual(half.ok, false);
});

test('autonomyGateVerdict: auto-trunk clears with COLAB_HUMAN=1 + --answered-by, or at a TTY', () => {
  assert.deepStrictEqual(adopt.autonomyGateVerdict({ autonomy: 'auto-trunk', ...HUMAN }), { ok: true, write: true });
  assert.deepStrictEqual(adopt.autonomyGateVerdict({ autonomy: 'auto-trunk', ...AGENT, isTTY: true }), { ok: true, write: true });
});

test('autonomyGateVerdict: manual is never gated', () => {
  assert.deepStrictEqual(adopt.autonomyGateVerdict({ autonomy: 'manual', ...AGENT }), { ok: true, write: true });
});

test('autonomyGateVerdict: auto-trunk + ceremony: light is refused even for a human, exit 5', () => {
  const v = adopt.autonomyGateVerdict({ autonomy: 'auto-trunk', ceremony: 'light', ...HUMAN });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.exitCode, 5);
});

test('autonomyGateVerdict: append-only — same value is a no-op, a different one is refused', () => {
  assert.deepStrictEqual(adopt.autonomyGateVerdict({ autonomy: 'auto-trunk', current: 'auto-trunk', ...AGENT }), { ok: true, write: false });
  const v = adopt.autonomyGateVerdict({ autonomy: 'auto-trunk', current: 'manual', ...HUMAN });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.exitCode, 5);
});

test('autonomyGateVerdict: an unknown value throws', () => {
  assert.throws(() => adopt.autonomyGateVerdict({ autonomy: 'yes', ...HUMAN }), /--autonomy must be one of/);
});

// ------------------------------------------------------------------- landVerdict (pure)

test('landVerdict: needs COLAB_HUMAN=1 AND --answered-by — no TTY substitute', () => {
  const base = { local: false, trunk: 'main', currentBranch: 'main' };
  assert.strictEqual(adopt.landVerdict({ ...base, colabHuman: false, answeredBy: 'X' }).exitCode, 3);
  assert.strictEqual(adopt.landVerdict({ ...base, colabHuman: true, answeredBy: null }).exitCode, 3);
  assert.deepStrictEqual(adopt.landVerdict({ ...base, colabHuman: true, answeredBy: 'X' }), { ok: true });
});

test('landVerdict: refuses off trunk, with --local, and with no trunk', () => {
  const ok = { colabHuman: true, answeredBy: 'X' };
  assert.strictEqual(adopt.landVerdict({ ...ok, local: false, trunk: 'main', currentBranch: 'feat/x-1' }).exitCode, 5);
  assert.strictEqual(adopt.landVerdict({ ...ok, local: true, trunk: 'main', currentBranch: 'main' }).exitCode, 5);
  assert.strictEqual(adopt.landVerdict({ ...ok, local: false, trunk: null, currentBranch: 'main' }).exitCode, 5);
});

test('landCommitMessage: Conventional, names the answerer and the paths, cites no issue number', () => {
  const m = adopt.landCommitMessage({ answeredBy: 'Ada', paths: ['.github/project.yml'] });
  assert.match(m, /^chore: /);
  assert.match(m, /--answered-by "Ada"/);
  assert.match(m, /Paths: \.github\/project\.yml/);
  assert.doesNotMatch(m, /#\d/); // lands in the ADOPTING repo — a #N there would link its own issue
});

// ------------------------------------------------------------------- CLI

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-land-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'adopt land test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(path.join(work, 'README.md'), '# fixture\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'remote', 'set-head', 'origin', 'main');
  return { root, origin, work, g };
}

function colab(fx, args, env = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.root, COLAB_HUMAN: undefined, ...env },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const ANSWERS = ['--exposure', 'self', '--stack', 'docs', '--autonomy', 'auto-trunk', '--answered-by', 'Test Human', '--no-verify'];

test('CLI: --land with COLAB_HUMAN=1 commits descriptor (grant included) + shell on trunk and pushes it', () => {
  const fx = fixture();
  const r = colab(fx, ['adopt', '--repo', fx.work, '--json', ...ANSWERS, '--land'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.err + r.out);
  const out = JSON.parse(r.out);
  assert.strictEqual(out.land.ok, true);
  assert.strictEqual(out.land.pushed, true);
  assert.deepStrictEqual([...out.land.committed].sort(), ['.github/project.yml', 'AGENTS.md', 'CLAUDE.md']);
  // origin's trunk now carries the grant — what ship reads for the follow-up branch.
  const onOrigin = fx.g(fx.origin, 'show', 'main:.github/project.yml');
  assert.match(onOrigin, /^autonomy: auto-trunk$/m);
  assert.match(onOrigin, /# autonomy: supplied by --autonomy, COLAB_HUMAN=1, --answered-by "Test Human"/);
  assert.strictEqual(fx.g(fx.work, 'status', '--porcelain'), '');
  assert.match(fx.g(fx.work, 'log', '-1', '--format=%s'), /^chore: adopt the colab-handbook conventions/);
});

test('CLI: --land without COLAB_HUMAN=1 refuses (exit 3) and writes nothing', () => {
  const fx = fixture();
  const r = colab(fx, ['adopt', '--repo', fx.work, ...ANSWERS, '--land']);
  assert.strictEqual(r.code, 3, r.err + r.out);
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false);
  assert.strictEqual(fx.g(fx.work, 'rev-list', '--count', 'HEAD').trim(), '1');
});

test('CLI: --autonomy auto-trunk without a human (no --land) refuses (exit 3) and writes nothing', () => {
  const fx = fixture();
  const r = colab(fx, ['adopt', '--repo', fx.work, '--exposure', 'live', '--stack', 'docs', '--autonomy', 'auto-trunk', '--no-verify']);
  assert.strictEqual(r.code, 3, r.err + r.out);
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false);
});

test('CLI: --land off trunk refuses (exit 5) before writing', () => {
  const fx = fixture();
  fx.g(fx.work, 'checkout', '-q', '-b', 'chore/adopt');
  const r = colab(fx, ['adopt', '--repo', fx.work, ...ANSWERS, '--land'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 5, r.err + r.out);
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false);
});

test('CLI: --land refuses when origin trunk is ahead, before writing', () => {
  const fx = fixture();
  const other = path.join(fx.root, 'other');
  execFileSync('git', ['clone', '-q', fx.origin, other]);
  fx.g(other, 'config', 'user.email', 'o@example.invalid');
  fx.g(other, 'config', 'user.name', 'other');
  fx.g(other, 'commit', '-q', '--allow-empty', '-m', 'chore: ahead');
  fx.g(other, 'push', '-q', 'origin', 'main');
  const r = colab(fx, ['adopt', '--repo', fx.work, ...ANSWERS, '--land'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 1, r.err + r.out);
  assert.match(r.err, /pull main first/);
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false);
});

test('CLI: a bare --land lands a descriptor an earlier adopt left uncommitted — and only it', () => {
  const fx = fixture();
  const first = colab(fx, ['adopt', '--repo', fx.work, ...ANSWERS], { COLAB_HUMAN: '1' });
  assert.strictEqual(first.code, 0, first.err + first.out);
  fs.writeFileSync(path.join(fx.work, 'unrelated.txt'), 'not mine\n');
  const r = colab(fx, ['adopt', '--repo', fx.work, '--json', '--no-verify', '--answered-by', 'Test Human', '--land'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.err + r.out);
  const out = JSON.parse(r.out);
  assert.deepStrictEqual(out.land.committed, ['.github/project.yml']);
  assert.match(fx.g(fx.work, 'status', '--porcelain'), /\?\? unrelated\.txt/);
});
