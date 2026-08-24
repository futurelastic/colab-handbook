'use strict';
/**
 * CLI-level tests for `colab adopt` (#199, both commits landed) — drives the real `colab`
 * binary against a real git repo, the same fixture shape as `tools/lib/place-cli.test.js`.
 * Pure-logic cases (EXPOSURE_SHAPE, gateVerdict, renderDescriptor, axisMissing) live in
 * `tools/lib/adopt.test.js` against a scripted io; this file exists because wiring bugs — a flag
 * not reaching the gate, a write happening when it should have refused — live at the CLI
 * boundary, not in the pure module.
 *
 * Every test here runs with a NON-TTY child process (`spawnSync`'s default stdio), which is
 * exactly the "no TTY" half of every gate this file exercises — the interactive prompt path
 * (`node:readline` at a real terminal) cannot be driven from `node --test` without a pty and is
 * therefore not covered here; see `tools/lib/adopt.test.js`'s `QUESTIONS`/`axisMissing` tests for
 * what IS covered of that path without a real terminal.
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
 * optional `.github/project.yml`. `branch` lets a fixture stand up a `dev` trunk for the
 * `exposure: live`/`released` shape tests.
 */
function fixture(projectYml, { branch = 'main' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-cli-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', branch, origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', branch, work], { encoding: 'utf8' });
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
  g(work, 'push', '-q', 'origin', branch);
  g(work, 'remote', 'set-head', 'origin', branch); // so origin/HEAD resolves without a real remote round-trip

  return { root, origin, work, g };
}

/**
 * Like `fixture()`, but with NO origin remote at all — first-time adoption's own shape
 * (`git init`, adopt, add a remote later), which is `detectTrunk()`'s null-returning case and
 * `colab adopt`'s primary use case for the trunk fallback.
 */
function noOriginFixture(projectYml, { branch = 'main', detach = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-cli-noorigin-'));
  TMP.push(root);
  const work = path.join(root, 'work');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '-b', branch, work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'adopt cli test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  if (projectYml !== undefined) {
    fs.mkdirSync(path.join(work, '.github'), { recursive: true });
    fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  } else {
    fs.writeFileSync(path.join(work, 'README.md'), '# fixture\n');
  }
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  if (detach) g(work, 'checkout', '-q', '--detach', 'HEAD');

  return { root, work, g };
}

function colab(fx, args, envOverrides = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.root, COLAB_HUMAN: undefined, ...envOverrides },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** A full, self-consistent descriptor — override/delete individual keys to build a fixture
 * missing exactly what a test wants missing. `undefined` deletes a key from the base. */
function fullYml(overrides = {}) {
  const base = {
    trunk: 'main', production: null, deploy: 'none', stack: 'docs',
    writes: 'serial', room: 'solo', exposure: 'self', channels: '[none]',
  };
  const merged = { ...base, ...overrides };
  return `${Object.entries(merged)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n`;
}

// --------------------------------------------------------------- already-complete descriptor

test('complete descriptor: reports every row answered, exit 0, writes nothing (no flags needed)', () => {
  const fx = fixture(fullYml());
  const before = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  const r = colab(fx, ['adopt', '--repo', fx.work, '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /tier\s+detected\s+B/); // no literal tier key in fullYml() — derived B, never written
  assert.match(r.out, /room\s+answered\s+solo/);
  assert.match(r.out, /exposure\s+answered\s+self/);
  assert.match(r.out, /writes\s+answered\s+serial/);
  assert.match(r.out, /channels\s+answered/);
  const after = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.strictEqual(after, before, 'a complete descriptor must not be touched');
});

test('colab adopt --json on a complete descriptor: same fields as before, no `written` key', () => {
  const fx = fixture(fullYml());
  const r = colab(fx, ['adopt', '--repo', fx.work, '--json', '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.strictEqual(parsed.repo, fs.realpathSync(fx.work));
  assert.strictEqual(parsed.rows.exposure.state, 'answered');
  assert.strictEqual(parsed.verify, null); // --no-verify
  assert.strictEqual(parsed.written, undefined);
});

// --------------------------------------------------------------- oracle item 10 — refuse fast, no TTY, no flags

test('incomplete descriptor, no flags, no TTY: refuses in well under 1s, names the exact missing rows, writes nothing', () => {
  const fx = fixture(fullYml({ channels: undefined }));
  const start = Date.now();
  const r = colab(fx, ['adopt', '--repo', fx.work, '--no-verify']);
  const elapsed = Date.now() - start;
  assert.notStrictEqual(r.code, 0);
  assert.ok(elapsed < 1000, `took ${elapsed}ms, expected well under 1000ms`);
  assert.match(r.err, /channels/);
  assert.match(r.err, /--channels/);
  const raw = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.ok(!/channels:/.test(raw), 'must not have written channels on refusal');
});

test('a fresh repo with no .github/project.yml at all, no flags, no TTY: refuses, file still does not exist', () => {
  const fx = fixture(undefined);
  const r = colab(fx, ['adopt', '--repo', fx.work, '--no-verify']);
  assert.notStrictEqual(r.code, 0);
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false);
});

// --------------------------------------------------------------- oracle item 8 — append-only, asks only what's missing

test('descriptor missing only channels: --channels alone writes exactly that row, git diff shows only appended lines', () => {
  const fx = fixture(fullYml({ channels: undefined }));
  fx.g(fx.work, 'add', '-A'); fx.g(fx.work, 'commit', '-q', '-m', 'chore: pin baseline', '--allow-empty');
  const r = colab(fx, ['adopt', '--repo', fx.work, '--channels', 'workflow', '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  const diff = fx.g(fx.work, 'diff', '--unified=0', '--', '.github/project.yml');
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  assert.strictEqual(removed.length, 0, `no line should be removed/changed:\n${diff}`);
  assert.ok(added.some((l) => l.includes('channels: [workflow]')), diff);
  const raw = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.match(raw, /room: solo/); // untouched
});

// --------------------------------------------------------------- oracle item 3/4 — the human gate, first declaration

test('fresh fixture + full flags + COLAB_HUMAN=1: exit 0, written, audit reports ok:true, no tier: key', () => {
  const fx = fixture(undefined);
  const r = colab(fx, [
    'adopt', '--repo', fx.work, '--json',
    '--production', 'none', '--deploy', 'none', '--stack', 'docs',
    '--room', 'solo', '--writes', 'serial', '--channels', 'none',
    '--exposure', 'self', '--answered-by', 'Test Human',
  ], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(parsed.cfg, 'tier'), false);
  assert.ok(parsed.verify && parsed.verify.ran, 'verify should have run (audit/ is available in this checkout)');
  assert.strictEqual(parsed.verify.ok, true, JSON.stringify(parsed.verify.findings));
});

// #208: the split's current vocabulary is a legal --writes flag value too, not just the
// legacy alias exercised above.
test('#208: --writes serial-direct (current vocabulary, not the legacy alias): exit 0, written, audit reports ok:true', () => {
  const fx = fixture(undefined);
  const r = colab(fx, [
    'adopt', '--repo', fx.work, '--json',
    '--production', 'none', '--deploy', 'none', '--stack', 'docs',
    '--room', 'solo', '--writes', 'serial-direct', '--channels', 'none',
    '--exposure', 'self', '--answered-by', 'Test Human',
  ], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.strictEqual(parsed.cfg.writes, 'serial-direct');
  assert.ok(parsed.verify && parsed.verify.ran, 'verify should have run (audit/ is available in this checkout)');
  assert.strictEqual(parsed.verify.ok, true, JSON.stringify(parsed.verify.findings));
});

test('same fresh fixture, same flags, WITHOUT COLAB_HUMAN=1: non-zero, class human-gated, file does not exist', () => {
  const fx = fixture(undefined);
  const r = colab(fx, [
    'adopt', '--repo', fx.work,
    '--production', 'none', '--deploy', 'none', '--stack', 'docs',
    '--room', 'solo', '--writes', 'serial', '--channels', 'none',
    '--exposure', 'self', '--answered-by', 'Test Human',
  ]);
  assert.notStrictEqual(r.code, 0);
  assert.strictEqual(r.code, 3, r.err); // GATE_CLASS.HUMAN_GATED
  assert.match(r.err, /requires a human/);
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false);
});

// --------------------------------------------------------------- oracle item 5 — the shape asymmetry

test('--exposure live on a B-shaped fixture (trunk main, no production): refuses, exit 5, writes nothing', () => {
  const fx = fixture(fullYml({ exposure: undefined }));
  const r = colab(fx, ['adopt', '--repo', fx.work, '--exposure', 'live', '--no-verify']);
  assert.strictEqual(r.code, 5, r.err);
  assert.match(r.err, /trunk/);
  const raw = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.ok(!/exposure:/.test(raw));
});

test('--exposure live on dev + deploy workflow + production: writes, with NO human bar at all', () => {
  const fx = fixture(fullYml({ exposure: undefined, production: 'https://example.com', deploy: 'push-main' }), { branch: 'dev' });
  fs.mkdirSync(path.join(fx.work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(fx.work, '.github', 'workflows', 'deploy-prod.yml'), 'on:\n  push:\n    branches: [dev]\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps: []\n');
  fx.g(fx.work, 'add', '-A'); fx.g(fx.work, 'commit', '-q', '-m', 'chore: add deploy workflow');
  const r = colab(fx, ['adopt', '--repo', fx.work, '--exposure', 'live', '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  const raw = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.match(raw, /exposure: live/);
});

// --------------------------------------------------------------- oracle item 6 — the falsifier

test('a version-shaped tag + --exposure none: exit 4 naming the tag; adding --reason writes, reason text in the file', () => {
  const fx = fixture(fullYml({ exposure: undefined }));
  execFileSync('git', ['tag', 'v1.2.0'], { cwd: fx.work, encoding: 'utf8' });
  const refused = colab(fx, ['adopt', '--repo', fx.work, '--exposure', 'none', '--no-verify'], { COLAB_HUMAN: '1' });
  assert.strictEqual(refused.code, 4, refused.err);
  assert.match(refused.err, /v1\.2\.0/);
  assert.ok(!/exposure:/.test(fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8')));

  const ok = colab(fx, [
    'adopt', '--repo', fx.work, '--exposure', 'none', '--no-verify',
    '--answered-by', 'Test Human', '--reason', 'evidence is stale, tag predates a full rewrite',
  ], { COLAB_HUMAN: '1' });
  assert.strictEqual(ok.code, 0, ok.err);
  const raw = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.match(raw, /exposure: none/);
  assert.match(raw, /evidence is stale, tag predates a full rewrite/);
});

// --------------------------------------------------------------- oracle item 7 — direction check, not falsifier

test('declared released + --exposure self: refuses without --reason, even with COLAB_HUMAN=1 (direction check, not falsifier)', () => {
  const fx = fixture(fullYml({ exposure: 'released', production: 'https://example.com', deploy: 'tag' }), { branch: 'dev' });
  const r = colab(fx, [
    'adopt', '--repo', fx.work, '--axis', 'exposure', '--exposure', 'self',
    '--answered-by', 'Test Human', '--no-verify',
  ], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 3, r.err);
  assert.match(r.err, /reason/i);
  const raw = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.strictEqual((raw.match(/exposure:/g) || []).length, 1, 'must not have appended a second exposure line');
});

// --------------------------------------------------------------- oracle item 11 — contradiction() is unconditional

test('declared tier: A + --exposure live: refuses via contradiction() even with the lowering bar fully cleared', () => {
  // Shape must clear FIRST (trunk dev, production set, deploy push-main, a deploy workflow) so
  // this exercises axis-authority.contradiction() specifically, not the shape check.
  const fx = fixture(fullYml({ exposure: undefined, tier: 'A', production: 'https://example.com', deploy: 'push-main' }), { branch: 'dev' });
  fs.mkdirSync(path.join(fx.work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(fx.work, '.github', 'workflows', 'deploy-prod.yml'), 'on:\n  push:\n    branches: [dev]\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps: []\n');
  fx.g(fx.work, 'add', '-A'); fx.g(fx.work, 'commit', '-q', '-m', 'chore: add deploy workflow');
  const r = colab(fx, [
    'adopt', '--repo', fx.work, '--exposure', 'live',
    '--answered-by', 'Test Human', '--reason', 'clearing every other bar on purpose', '--no-verify',
  ], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 4, r.err);
  assert.match(r.err, /disagree/);
  const raw = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.ok(!/exposure:/.test(raw));
});

// --------------------------------------------------------------- the tier fallback

test('exposure left unanswered this run, no tier declared: falls back to a derived tier, with its own provenance comment', () => {
  const fx = fixture(fullYml({ exposure: undefined, room: undefined }));
  const r = colab(fx, ['adopt', '--repo', fx.work, '--room', 'team', '--no-verify']);
  assert.strictEqual(r.code, 0, r.err);
  const raw = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.match(raw, /^tier: B$/m);
  assert.match(raw, /exposure unanswered/);
});

// --------------------------------------------------------------- regression: adopt must never write a
// --------------------------------------------------------------- descriptor the audit then rejects

test('DEFECT 1 regression: a manifest-less repo (a README and nothing else) refuses without --stack — never writes a file the audit would then fail', () => {
  const fx = fixture(undefined); // no project.yml, no manifest — this handbook's own shape
  const r = colab(fx, [
    'adopt', '--repo', fx.work, '--room', 'solo', '--writes', 'serial', '--channels', 'artifact',
    '--production', 'none', '--deploy', 'none', '--exposure', 'released', '--no-verify',
  ]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /stack/);
  assert.match(r.err, /--stack/);
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false);
});

test('DEFECT 1 regression: the same manifest-less repo + --stack writes, and the real audit reports ok:true', () => {
  const fx = fixture(undefined);
  const r = colab(fx, [
    'adopt', '--repo', fx.work, '--room', 'solo', '--writes', 'serial', '--channels', 'artifact',
    '--production', 'none', '--deploy', 'none', '--exposure', 'released', '--stack', 'docs', '--json',
  ]);
  assert.strictEqual(r.code, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.strictEqual(parsed.cfg.stack, 'docs');
  assert.ok(parsed.verify && parsed.verify.ran);
  assert.strictEqual(parsed.verify.ok, true, JSON.stringify(parsed.verify.findings));
});

test('DEFECT 2 regression: a repo with NO origin remote at all falls back to the current branch as trunk, writes, audit ok:true', () => {
  const fx = noOriginFixture(undefined);
  const r = colab(fx, [
    'adopt', '--repo', fx.work, '--room', 'solo', '--writes', 'serial', '--channels', 'none',
    '--production', 'none', '--deploy', 'none', '--exposure', 'self', '--stack', 'docs', '--json',
    '--answered-by', 'Test Human',
  ], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.strictEqual(parsed.cfg.trunk, 'main');
  assert.strictEqual(parsed.detected.trunk.source, 'current-branch-fallback');
  assert.ok(parsed.verify && parsed.verify.ran);
  assert.strictEqual(parsed.verify.ok, true, JSON.stringify(parsed.verify.findings));
  const raw = fs.readFileSync(path.join(fx.work, '.github', 'project.yml'), 'utf8');
  assert.match(raw, /trunk: main/);
  assert.match(raw, /no origin remote yet/);
});

test('DEFECT 2 regression: the text report says the trunk was inferred, not read from a remote', () => {
  const fx = noOriginFixture(fullYml({ trunk: undefined }));
  const r = colab(fx, ['adopt', '--repo', fx.work, '--no-verify']);
  // Nothing left to ask (fullYml() already declares everything but trunk, and trunk is never a
  // §9 row) — this is the "already complete" report path, still exercising the fallback.
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /detected trunk: main \(current branch — no origin remote\)/);
});

test('DEFECT 2 regression: a detached HEAD with no origin cannot be honestly resolved — refuses rather than guessing', () => {
  const fx = noOriginFixture(undefined, { detach: true });
  const r = colab(fx, [
    'adopt', '--repo', fx.work, '--room', 'solo', '--writes', 'serial', '--channels', 'none',
    '--production', 'none', '--deploy', 'none', '--exposure', 'self', '--stack', 'docs', '--no-verify',
  ]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /trunk could not be determined/);
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false);
});

// --------------------------------------------------------------- #258 — writes into the
// --------------------------------------------------------------- caller's OWN working tree,
// --------------------------------------------------------------- never the main checkout

test('#258: colab adopt --repo <linked worktree> writes project.yml into the worktree, never the main checkout', () => {
  const fx = fixture(undefined);
  const wtPath = path.join(fx.root, 'wt');
  execFileSync('git', ['worktree', 'add', '-b', 'feat/thing-1', wtPath, 'main'], { cwd: fx.work, encoding: 'utf8' });
  const r = colab(fx, [
    'adopt', '--repo', wtPath, '--room', 'solo', '--writes', 'serial', '--channels', 'none',
    '--production', 'none', '--deploy', 'none', '--exposure', 'self', '--stack', 'docs', '--no-verify',
    '--answered-by', 'Test Human',
  ], { COLAB_HUMAN: '1' });
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(fs.existsSync(path.join(wtPath, '.github', 'project.yml')), true, 'must write into the worktree it was run against');
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false, 'must NOT write into the main checkout');
});

test('#258: colab adopt run from inside a linked worktree (no --repo, cwd resolution) writes into the worktree, never the main checkout', () => {
  const fx = fixture(undefined);
  const wtPath = path.join(fx.root, 'wt');
  execFileSync('git', ['worktree', 'add', '-b', 'feat/thing-2', wtPath, 'main'], { cwd: fx.work, encoding: 'utf8' });
  const r = spawnSync('node', [COLAB,
    'adopt', '--room', 'solo', '--writes', 'serial', '--channels', 'none',
    '--production', 'none', '--deploy', 'none', '--exposure', 'self', '--stack', 'docs', '--no-verify',
    '--answered-by', 'Test Human',
  ], { cwd: wtPath, encoding: 'utf8', env: { ...process.env, COLAB_HOME: fx.root, COLAB_HUMAN: '1' } });
  assert.strictEqual(r.status, 0, r.stderr || '');
  assert.strictEqual(fs.existsSync(path.join(wtPath, '.github', 'project.yml')), true, 'must write into the worktree cwd was inside');
  assert.strictEqual(fs.existsSync(path.join(fx.work, '.github', 'project.yml')), false, 'must NOT write into the main checkout');
});

// --------------------------------------------------------------- --help / root help

test('colab adopt --help documents the command; root help lists it', () => {
  const help = colab({ root: os.tmpdir() }, ['adopt', '--help']);
  assert.strictEqual(help.code, 0, help.err);
  assert.match(help.out, /THE HUMAN GATE/);
  assert.match(help.out, /append-only/i);

  const root = colab({ root: os.tmpdir() }, ['--help']);
  assert.strictEqual(root.code, 0, root.err);
  assert.match(root.out, /\n\s*adopt \[--repo/);
});
