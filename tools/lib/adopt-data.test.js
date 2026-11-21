'use strict';
/**
 * #762 — `colab adopt --data none|real`: whether any database this repo's code runs against holds
 * real data, recorded at adoption with provenance. `data: none` lowers a protection (colab ship's
 * migration gate is exempt while no sign of production is present), so it carries the human bar
 * of `--autonomy auto-trunk` and is refused beside a falsifier. Pure gate first, then the CLI.
 * The interactive first-adoption question needs a pty and is not driven here (adopt-cli.test.js's
 * header says why); its default is `dataDefault`, tested pure.
 * Run: `node --test tools/lib/adopt-data.test.js`.
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

const HUMAN = { isTTY: false, colabHuman: true, answeredBy: 'Test Human' };
const AGENT = { isTTY: false, colabHuman: false, answeredBy: null };
const GREEN = { production: null, deploy: 'none', exposure: 'self' };

// ------------------------------------------------------------------- dataGateVerdict (pure)

test('dataGateVerdict: none needs a human — COLAB_HUMAN=1 + --answered-by, or a TTY', () => {
  const v = adopt.dataGateVerdict({ data: 'none', current: undefined, eff: GREEN, ...AGENT });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.exitCode, 3);
  assert.match(v.message, /declaring data: none requires a human/);
  assert.strictEqual(adopt.dataGateVerdict({ data: 'none', eff: GREEN, ...AGENT, colabHuman: true }).ok, false, 'COLAB_HUMAN alone is not enough');
  assert.deepStrictEqual(adopt.dataGateVerdict({ data: 'none', eff: GREEN, ...HUMAN }), { ok: true, write: true });
  assert.deepStrictEqual(adopt.dataGateVerdict({ data: 'none', eff: GREEN, ...AGENT, isTTY: true }), { ok: true, write: true });
});

test('dataGateVerdict: real is never gated', () => {
  assert.deepStrictEqual(adopt.dataGateVerdict({ data: 'real', eff: { production: 'https://x.example' }, ...AGENT }), { ok: true, write: true });
});

test('dataGateVerdict: none beside a falsifier is refused even for a human, exit 5', () => {
  for (const eff of [{ ...GREEN, production: 'https://x.example' }, { ...GREEN, deploy: 'tag' }, { ...GREEN, exposure: 'live' }, { tier: 'A' }]) {
    const v = adopt.dataGateVerdict({ data: 'none', eff, ...HUMAN });
    assert.strictEqual(v.ok, false, JSON.stringify(eff));
    assert.strictEqual(v.exitCode, 5);
    assert.match(v.message, /data: none contradicts this descriptor/);
  }
});

test('dataGateVerdict: append-only — same value is a no-op, a different one is refused', () => {
  assert.deepStrictEqual(adopt.dataGateVerdict({ data: 'none', current: 'none', eff: GREEN, ...AGENT }), { ok: true, write: false });
  const v = adopt.dataGateVerdict({ data: 'none', current: 'real', eff: GREEN, ...HUMAN });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.exitCode, 5);
});

test('dataGateVerdict: an unknown value throws', () => {
  assert.throws(() => adopt.dataGateVerdict({ data: 'nothing', eff: GREEN, ...HUMAN }), /--data must be one of/);
});

test('dataDefault: none only when nothing deploys', () => {
  assert.strictEqual(adopt.dataDefault(GREEN), 'none');
  assert.strictEqual(adopt.dataDefault({}), 'none');
  assert.strictEqual(adopt.dataDefault({ ...GREEN, production: 'https://x.example' }), 'real');
  assert.strictEqual(adopt.dataDefault({ ...GREEN, deploy: 'push-main' }), 'real');
});

// ------------------------------------------------------------------- CLI

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-data-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'adopt data test');
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

const BASE = ['--exposure', 'self', '--stack', 'docs', '--no-verify'];
const readYml = (fx) => fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');

test('CLI: a first adoption with --data none and the human bar records it with provenance', () => {
  const fx = fixture();
  const r = colab(fx, ['adopt', '--repo', fx.work, ...BASE, '--data', 'none', '--answered-by', 'Test Human'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.err + r.out);
  const yml = readYml(fx);
  assert.match(yml, /^data: none$/m);
  assert.match(yml, /# data: supplied by --data, COLAB_HUMAN=1, --answered-by "Test Human"/);
});

test('CLI: --data none without a human refuses (exit 3) and writes nothing', () => {
  const fx = fixture();
  const r = colab(fx, ['adopt', '--repo', fx.work, '--production', 'none', '--deploy', 'none', '--stack', 'docs', '--no-verify', '--data', 'none']);
  assert.strictEqual(r.code, 3, r.err + r.out);
  assert.match(r.err, /declaring data: none requires a human/);
  assert.ok(!fs.existsSync(path.join(fx.work, '.github', 'project.yml')), 'nothing partially written');
});

test('CLI: --data none beside --production is refused (exit 5) and writes nothing', () => {
  const fx = fixture();
  const r = colab(fx, ['adopt', '--repo', fx.work, '--production', 'https://x.example', '--deploy', 'manual', '--stack', 'docs', '--no-verify',
    '--data', 'none', '--answered-by', 'Test Human'], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 5, r.err + r.out);
  assert.match(r.err, /data: none contradicts this descriptor — production is https:\/\/x\.example/);
  assert.ok(!fs.existsSync(path.join(fx.work, '.github', 'project.yml')));
});

test('CLI: --data real needs no human', () => {
  const fx = fixture();
  const r = colab(fx, ['adopt', '--repo', fx.work, '--production', 'none', '--deploy', 'none', '--stack', 'docs', '--no-verify', '--data', 'real']);
  assert.strictEqual(r.code, 0, r.err + r.out);
  assert.match(readYml(fx), /^data: real$/m);
});

test('CLI: a first adoption without --data says it is unanswered', () => {
  const fx = fixture();
  const r = colab(fx, ['adopt', '--repo', fx.work, '--production', 'none', '--deploy', 'none', '--stack', 'docs', '--no-verify']);
  assert.strictEqual(r.code, 0, r.err + r.out);
  assert.match(r.err, /data: unanswered — a first adoption records/);
  assert.doesNotMatch(readYml(fx), /^data:/m);
});

test('CLI: --data on a repo that already declares it is append-only', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['adopt', '--repo', fx.work, '--production', 'none', '--deploy', 'none', '--stack', 'docs', '--no-verify', '--data', 'real']).code, 0);
  const again = colab(fx, ['adopt', '--repo', fx.work, '--no-verify', '--data', 'real']);
  assert.strictEqual(again.code, 0, again.err + again.out);
  const lower = colab(fx, ['adopt', '--repo', fx.work, '--no-verify', '--data', 'none', '--answered-by', 'Test Human'], { COLAB_HUMAN: '1' });
  assert.strictEqual(lower.code, 5, lower.err + lower.out);
  assert.match(lower.err, /already declares data: real/);
});

test('CLI: --data alone on an adopted repo appends it (the human bar still applies)', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ['adopt', '--repo', fx.work, '--production', 'none', '--deploy', 'none', '--stack', 'docs', '--no-verify']).code, 0);
  const refused = colab(fx, ['adopt', '--repo', fx.work, '--no-verify', '--data', 'none']);
  assert.strictEqual(refused.code, 3, refused.err + refused.out);
  const ok = colab(fx, ['adopt', '--repo', fx.work, '--no-verify', '--data', 'none', '--answered-by', 'Test Human'], { COLAB_HUMAN: '1' });
  assert.strictEqual(ok.code, 0, ok.err + ok.out);
  assert.match(readYml(fx), /^data: none$/m);
});
