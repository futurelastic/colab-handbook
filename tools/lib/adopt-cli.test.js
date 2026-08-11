'use strict';
/**
 * CLI-level tests for `colab adopt` (#199, commit 1 of 2) — drives the real `colab` binary
 * against a real git repo, the same fixture shape as `tools/lib/place-cli.test.js`. Pure-logic
 * cases already live in `tools/lib/adopt.test.js` against a scripted io; this file exists because
 * wiring bugs (a flag not reaching `adopt.detect()`, `--json` not actually matching the text
 * report's data) live at the CLI boundary, not in the pure module.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
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

/**
 * A real repo with a bare `origin` (so `colab adopt` can detect trunk via origin/HEAD) and an
 * optional `.github/project.yml`. `--no-verify` is used by every test here — `colab adopt`'s
 * verify step shells out to `node audit/audit.mjs`, which is this repo's OWN audit; exercising it
 * against a throwaway fixture is `adopt`'s CLI wiring, not the audit's, and is intentionally out
 * of scope for these tests (the audit has its own fixture suite).
 */
function fixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-cli-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'adopt cli test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  if (projectYml !== undefined) {
    fs.mkdirSync(path.join(work, '.github'), { recursive: true });
    fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  } else {
    fs.writeFileSync(path.join(work, 'README.md'), '# fixture\n');
  }
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'remote', 'set-head', 'origin', 'main'); // so origin/HEAD resolves without a real remote round-trip

  return { root, origin, work, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], { encoding: 'utf8', env: { ...process.env, COLAB_HOME: fx.root } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// --------------------------------------------------------------- no descriptor at all

test('colab adopt --repo <no .github/project.yml> reports every row missing except the B tier candidate, exit 0, writes nothing', () => {
  const fx = fixture(undefined);
  const before = fs.readdirSync(fx.work);
  const r = colab(fx, ['adopt', '--repo', fx.work, '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /No \.github\/project\.yml/);
  assert.match(r.out, /room\s+missing/);
  assert.match(r.out, /exposure\s+missing/);
  assert.match(r.out, /writes\s+missing/);
  assert.match(r.out, /channels\s+missing/);
  assert.deepStrictEqual(fs.readdirSync(fx.work).sort(), before.sort(), 'adopt must write nothing, ever, in this commit');
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false);
});

// --------------------------------------------------------------- complete descriptor

test('colab adopt --repo <complete descriptor> reports every row as answered', () => {
  const yml = [
    'tier: B', 'trunk: main', 'production: null', 'deploy: none', 'stack: node',
    'writes: serial', 'room: solo', 'exposure: self', 'channels: [none]',
  ].join('\n');
  const fx = fixture(yml);
  const r = colab(fx, ['adopt', '--repo', fx.work, '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /tier\s+answered\s+B/);
  assert.match(r.out, /room\s+answered\s+solo/);
  assert.match(r.out, /exposure\s+answered\s+self/);
  assert.match(r.out, /writes\s+answered\s+serial/);
  assert.match(r.out, /channels\s+answered/);
});

// --------------------------------------------------------------- descriptor missing only some rows

test('colab adopt --repo <descriptor missing room+writes+channels> reports exactly those as missing/legacy, the rest answered', () => {
  const yml = ['tier: A', 'trunk: dev', 'production: https://example.com', 'deploy: tag', 'stack: laravel'].join('\n');
  const fx = fixture(yml);
  const r = colab(fx, ['adopt', '--repo', fx.work, '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /tier\s+answered\s+A/);
  assert.match(r.out, /room\s+missing/);
  // exposure undeclared but tier is -> legacy read, LEGACY.A = released
  assert.match(r.out, /exposure\s+legacy read\s+released/);
  assert.match(r.out, /writes\s+missing/);
  assert.match(r.out, /channels\s+missing/);
});

// --------------------------------------------------------------- version-shaped tag as channel evidence

test('a version-shaped tag on the fixture surfaces as detected channel evidence ("artifact"), never as answered', () => {
  const fx = fixture(undefined);
  execFileSync('git', ['tag', 'v1.4.0'], { cwd: fx.work, encoding: 'utf8' });
  const r = colab(fx, ['adopt', '--repo', fx.work, '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /channels\s+detected\s+\["artifact"\]/);
  assert.match(r.out, /release artifact exists \(tag v1\.4\.0\)/);
});

test('a non-version-shaped tag surfaces no channel evidence', () => {
  const fx = fixture(undefined);
  execFileSync('git', ['tag', 'backup-2024'], { cwd: fx.work, encoding: 'utf8' });
  const r = colab(fx, ['adopt', '--repo', fx.work, '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /channels\s+missing/);
});

// --------------------------------------------------------------- --json shape

test('colab adopt --json emits the same data the text report renders, plus a repo field', () => {
  const yml = ['tier: B', 'trunk: main', 'production: null', 'deploy: none'].join('\n');
  const fx = fixture(yml);
  const r = colab(fx, ['adopt', '--repo', fx.work, '--json', '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.strictEqual(parsed.repo, fs.realpathSync(fx.work));
  assert.strictEqual(parsed.descriptorExists, true);
  assert.strictEqual(parsed.rows.tier.state, 'answered');
  assert.strictEqual(parsed.rows.tier.value, 'B');
  assert.strictEqual(parsed.rows.exposure.state, 'legacy read'); // tier: B -> LEGACY.B = null
  assert.strictEqual(parsed.rows.exposure.value, null);
  assert.strictEqual(parsed.legacyTierLetter, 'B');
  assert.ok(Array.isArray(parsed.remaining) && parsed.remaining.length === 7);
  assert.strictEqual(parsed.verify, null); // --no-verify
});

// --------------------------------------------------------------- --help / root help

test('colab adopt --help documents the command; root help lists it', () => {
  const help = colab({ root: os.tmpdir() }, ['adopt', '--help']);
  assert.strictEqual(help.code, 0, help.err);
  assert.match(help.out, /writes nothing/i);

  const root = colab({ root: os.tmpdir() }, ['--help']);
  assert.strictEqual(root.code, 0, root.err);
  assert.match(root.out, /\n\s*adopt \[--repo/);
});
