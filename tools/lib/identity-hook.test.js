'use strict';
/**
 * Tests for the two shell artifacts shipped by #228 part 2:
 *   templates/pre-commit-identity  — the staged-content identity scan
 *   templates/pre-commit-dispatch  — the pre-commit.d dispatcher it composes through
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * WHY A NODE TEST FOR A SHELL SCRIPT. Nothing in this repo exercised a shell artifact
 * before: `pre-push-guard` (the only prior hook template) has no test at all, and the
 * closest thing to shell coverage is `sh -n install.sh` in CI, which is a syntax check —
 * it would pass a script that refuses every commit. Since the whole point of this unit is
 * a guard that must fire on the right input and stay quiet on the wrong one, a syntax check
 * is not coverage. The suite already spawns processes and builds throwaway git repos in a
 * dozen files, so driving `sh` from here needs no new machinery and puts these cases under
 * the same one command CI already runs.
 *
 * What is pinned here, and what a future session must DELETE rather than work around:
 *
 *   - the scanner reads its vocabulary BY PATH and never from the repo. No fixture writes a
 *     vocabulary into the working tree, because the artifact is not allowed to look there;
 *   - an EXPLICIT vocabulary (env / git config) that cannot be read BLOCKS the commit, while
 *     the absent machine-wide DEFAULT warns and passes. A configured check that cannot run
 *     is not a pass; an unconfigured machine is a different statement;
 *   - the matched text is REDACTED by default and unredacted only by COLAB_IDENTITY_SHOW=1;
 *   - a staged PATH is scanned as content, and is reported by ordinal — never printed —
 *     because there the path is itself the offending string;
 *   - the override is per-invocation (COLAB_IDENTITY_OK=1) and does NOT excuse a broken
 *     vocabulary, only a match;
 *   - the dispatcher runs EVERY hooklet (no short-circuit) and refuses when it has nothing
 *     to run or when a hooklet is present but not executable — the "looks configured, runs
 *     nothing" state this whole unit exists to prevent.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCANNER = path.join(REPO_ROOT, 'templates', 'pre-commit-identity');
const DISPATCH = path.join(REPO_ROOT, 'templates', 'pre-commit-dispatch');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(dir);
  return dir;
}

/**
 * A throwaway repo with `files` written and staged (never committed — the scanner reads the
 * INDEX, so staging is the whole fixture). `core.hooksPath` is neutralised per #108 even
 * though nothing here commits: the guard is about what the fixture could inherit, not about
 * what it happens to call today.
 */
function stagedRepo(files) {
  const dir = tmpdir('identity-hook-');
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'identity hook test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  g('add', '-A');
  return dir;
}

/** A vocabulary file OUTSIDE any repo — the only shape the scanner accepts. */
function vocabulary(lines) {
  const dir = tmpdir('identity-vocab-');
  const file = path.join(dir, 'identity-vocabulary');
  fs.writeFileSync(file, Array.isArray(lines) ? lines.join('\n') + '\n' : lines);
  return file;
}

/** Run a script with `sh`, returning { code, out } where out is stdout+stderr. */
function run(script, { cwd, args = [], env = {} } = {}) {
  const res = require('child_process').spawnSync('sh', [script, ...args], {
    cwd,
    encoding: 'utf8',
    // HOME is overridden in every case so the DEFAULT vocabulary path can never resolve to
    // the developer's real one — the #101/#108 ambient-state failure, applied to this unit.
    env: { ...process.env, HOME: cwd || os.tmpdir(), COLAB_HOME: '', COLAB_IDENTITY_VOCAB: '', COLAB_IDENTITY_OK: '', COLAB_IDENTITY_SHOW: '', ...env },
  });
  return { code: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

// --- the scan itself ---------------------------------------------------------------------

test('a staged added line matching the vocabulary blocks the commit', () => {
  const repo = stagedRepo({ 'src/a.js': 'const host = "build-box-01.corp.invalid";\n' });
  const vocab = vocabulary(['# comment', '', 'build-box-01']);
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocab } });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /commit BLOCKED/);
  assert.match(r.out, /src\/a\.js:1/, 'reports the real file and line, reconstructed from the hunk header');
  assert.match(r.out, /vocabulary entry 3/, 'names the entry by its line number in the operator-owned file');
});

test('the matched text is redacted by default and shown only under COLAB_IDENTITY_SHOW', () => {
  const repo = stagedRepo({ 'src/a.js': 'const host = "build-box-01";\n' });
  const vocab = vocabulary(['build-box-01']);
  const quiet = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocab } });
  assert.doesNotMatch(quiet.out, /build-box-01/, 'the whole point is not to republish the string into a terminal or a log');
  assert.match(quiet.out, /\(12 chars, redacted\)/);

  const loud = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocab, COLAB_IDENTITY_SHOW: '1' } });
  assert.match(loud.out, /vocabulary entry 1: build-box-01/);
  assert.strictEqual(loud.code, 1, 'showing the term is not a bypass');
});

test('content that does not match passes silently', () => {
  const repo = stagedRepo({ 'src/a.js': 'const host = "an-invented-name";\n' });
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocabulary(['build-box-01']) } });
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(r.out.trim(), '', 'a clean scan says nothing — a hook that chatters gets ignored');
});

test('matching is case-insensitive and by substring', () => {
  const repo = stagedRepo({ 'src/a.js': 'https://BUILD-BOX-01.corp.invalid/x\n' });
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocabulary(['build-box-01']) } });
  assert.strictEqual(r.code, 1, r.out);
});

test('a staged PATH is scanned as content, and reported by ordinal rather than printed', () => {
  const repo = stagedRepo({ 'Northwind Freight/x.txt': 'nothing to see\n' });
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocabulary(['Northwind Freight']) } });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /\(staged path 1\)/);
  assert.doesNotMatch(r.out, /Northwind/, 'the path IS the offending string here — printing it as a location would republish it');
  assert.match(r.out, /git diff --cached --name-only/, 'tells the operator how to turn the ordinal back into a path');
});

test('a regular-expression term matches by shape', () => {
  const repo = stagedRepo({ 'README.md': 'run it from /home/jdoe/work\n' });
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocabulary(['re:/(users|home)/[a-z0-9._-]+/']) } });
  assert.strictEqual(r.code, 1, r.out);
});

test('deleted lines and unstaged work are not scanned — only what this commit publishes', () => {
  const repo = stagedRepo({ 'src/a.js': 'const host = "build-box-01";\n' });
  const g = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('config', 'commit.gpgsign', 'false');
  g('commit', '-q', '--no-verify', '-m', 'chore: fixture');
  // Now REMOVE the offending line and stage that; and separately leave an unstaged offender.
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'const host = "an-invented-name";\n');
  g('add', 'src/a.js');
  fs.writeFileSync(path.join(repo, 'scratch.txt'), 'build-box-01\n');
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocabulary(['build-box-01']) } });
  assert.strictEqual(r.code, 0, r.out);
});

// --- how the vocabulary is found -----------------------------------------------------------

test('no vocabulary on the machine warns and passes — an unconfigured machine is not a violation', () => {
  const repo = stagedRepo({ 'src/a.js': 'const host = "build-box-01";\n' });
  const r = run(SCANNER, { cwd: repo, env: { COLAB_HOME: path.join(repo, 'no-such-colab-home') } });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /no vocabulary at/);
  assert.match(r.out, /nothing was scanned/, 'silence would be indistinguishable from a clean scan');
});

test('an EXPLICIT vocabulary that cannot be read blocks — a configured check that cannot run is not a pass', () => {
  const repo = stagedRepo({ 'src/a.js': 'ordinary\n' });
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: path.join(repo, 'nope') } });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /cannot be read/);
});

test('git config colab.identityVocabulary is honoured, and is explicit for the rule above', () => {
  const repo = stagedRepo({ 'src/a.js': 'const host = "build-box-01";\n' });
  const vocab = vocabulary(['build-box-01']);
  execFileSync('git', ['config', 'colab.identityVocabulary', vocab], { cwd: repo, stdio: 'ignore' });
  const found = run(SCANNER, { cwd: repo });
  assert.strictEqual(found.code, 1, found.out);

  execFileSync('git', ['config', 'colab.identityVocabulary', path.join(repo, 'gone')], { cwd: repo, stdio: 'ignore' });
  const missing = run(SCANNER, { cwd: repo });
  assert.strictEqual(missing.code, 1, missing.out);
  assert.match(missing.out, /git config colab\.identityVocabulary/);
});

test('COLAB_IDENTITY_VOCAB wins over git config', () => {
  const repo = stagedRepo({ 'src/a.js': 'const host = "build-box-01";\n' });
  execFileSync('git', ['config', 'colab.identityVocabulary', vocabulary(['build-box-01'])], { cwd: repo, stdio: 'ignore' });
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocabulary(['something-else-entirely']) } });
  assert.strictEqual(r.code, 0, r.out);
});

// --- overrides and refusals ----------------------------------------------------------------

test('COLAB_IDENTITY_OK=1 lets a match through, loudly, for that one invocation', () => {
  const repo = stagedRepo({ 'src/a.js': 'const host = "build-box-01";\n' });
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocabulary(['build-box-01']), COLAB_IDENTITY_OK: '1' } });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /allowed through by COLAB_IDENTITY_OK/);
  assert.match(r.out, /vocabulary entry 1/, 'an override still prints what it let past');
});

test('the override does not excuse a broken vocabulary — that is a check that did not run', () => {
  const repo = stagedRepo({ 'src/a.js': 'ordinary\n' });
  const r = run(SCANNER, {
    cwd: repo,
    env: { COLAB_IDENTITY_VOCAB: vocabulary(['ab']), COLAB_IDENTITY_OK: '1' },
  });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /too short/);
});

test('an invalid regular expression is a refusal naming the entry, not a silent skip', () => {
  const repo = stagedRepo({ 'src/a.js': 'ordinary\n' });
  const r = run(SCANNER, { cwd: repo, env: { COLAB_IDENTITY_VOCAB: vocabulary(['re:[unclosed']) } });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /entry 1 is not a valid regular expression/);
});

// --- file mode (installs as commit-msg; also how the conformance test drives it) ------------

test('given a file argument it scans that file — the commit-msg install shape', () => {
  const repo = stagedRepo({ 'src/a.js': 'ordinary\n' });
  const msg = path.join(repo, 'COMMIT_EDITMSG');
  fs.writeFileSync(msg, 'fix: stop reading from build-box-01\n');
  const r = run(SCANNER, { cwd: repo, args: [msg], env: { COLAB_IDENTITY_VOCAB: vocabulary(['build-box-01']) } });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /COMMIT_EDITMSG:1/);
});

test('an unreadable file argument blocks rather than scanning nothing', () => {
  const repo = stagedRepo({ 'src/a.js': 'ordinary\n' });
  const r = run(SCANNER, { cwd: repo, args: [path.join(repo, 'absent')], env: { COLAB_IDENTITY_VOCAB: vocabulary(['build-box-01']) } });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /could not run/);
});

// --- the dispatcher --------------------------------------------------------------------------

/** A hooks directory with `hooklets` = { name: [body, executable] }. */
function hooksDir(hooklets) {
  const dir = tmpdir('identity-dispatch-');
  const d = path.join(dir, 'pre-commit.d');
  fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(DISPATCH, path.join(dir, 'pre-commit'));
  fs.chmodSync(path.join(dir, 'pre-commit'), 0o755);
  for (const [name, [body, exec = true]] of Object.entries(hooklets)) {
    const f = path.join(d, name);
    fs.writeFileSync(f, body);
    fs.chmodSync(f, exec ? 0o755 : 0o644);
  }
  return dir;
}

test('the dispatcher runs EVERY hooklet — a failure never hides the checks after it', () => {
  const dir = hooksDir({
    '10-fails': ['#!/bin/sh\necho ran-10\nexit 1\n'],
    '20-passes': ['#!/bin/sh\necho ran-20\n'],
    '30-fails': ['#!/bin/sh\necho ran-30\nexit 1\n'],
  });
  const r = run(path.join(dir, 'pre-commit'), { cwd: dir });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /ran-10/);
  assert.match(r.out, /ran-20/, 'the whole reason for a dispatcher: no short-circuit');
  assert.match(r.out, /ran-30/);
});

test('all hooklets passing is a pass', () => {
  const dir = hooksDir({ '10-a': ['#!/bin/sh\nexit 0\n'], '20-b': ['#!/bin/sh\nexit 0\n'] });
  const r = run(path.join(dir, 'pre-commit'), { cwd: dir });
  assert.strictEqual(r.code, 0, r.out);
});

test('a dispatcher with nothing to dispatch REFUSES — "looks configured, runs nothing" is the failure', () => {
  const empty = hooksDir({});
  const r = run(path.join(empty, 'pre-commit'), { cwd: empty });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /no runnable hooklet/);

  fs.rmSync(path.join(empty, 'pre-commit.d'), { recursive: true, force: true });
  const gone = run(path.join(empty, 'pre-commit'), { cwd: empty });
  assert.strictEqual(gone.code, 1, gone.out);
  assert.match(gone.out, /no hooklet directory/);
});

test('a hooklet that is present but not executable is a refusal, not a silent skip', () => {
  const dir = hooksDir({ '10-a': ['#!/bin/sh\nexit 0\n', false] });
  const r = run(path.join(dir, 'pre-commit'), { cwd: dir });
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /not executable/);
});

test('*.disabled, dotfiles and READMEs in pre-commit.d are ignored by name', () => {
  const dir = hooksDir({
    '10-a': ['#!/bin/sh\necho ran-10\n'],
    '20-b.disabled': ['#!/bin/sh\necho ran-20\nexit 1\n', false],
    '.keep': ['', false],
    'README.md': ['not a hook\n', false],
  });
  const r = run(path.join(dir, 'pre-commit'), { cwd: dir });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /ran-10/);
  assert.doesNotMatch(r.out, /ran-20/);
});

test('an explicit hooklet directory argument is honoured — how the handbook execs the template', () => {
  const dir = hooksDir({ '10-a': ['#!/bin/sh\necho ran-10\n'] });
  const r = run(DISPATCH, { cwd: dir, args: [path.join(dir, 'pre-commit.d')] });
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /ran-10/);
});

// --- this repo's own installation ------------------------------------------------------------

test("the handbook's own hooks are wired to the templates it ships", () => {
  const hook = fs.readFileSync(path.join(REPO_ROOT, '.githooks', 'pre-commit'), 'utf8');
  assert.match(hook, /templates\/pre-commit-dispatch/, 'the handbook is not exempt from its own handbook');
  const hooklets = fs.readdirSync(path.join(REPO_ROOT, '.githooks', 'pre-commit.d')).sort();
  assert.deepStrictEqual(hooklets, ['10-secrets', '20-identity'],
    'the secret scan kept its own hooklet — this mechanism sequences checks, it never replaces one');
  const identity = fs.readFileSync(path.join(REPO_ROOT, '.githooks', 'pre-commit.d', '20-identity'), 'utf8');
  assert.match(identity, /templates\/pre-commit-identity/);
});

test('no vocabulary is committed to this repo — only the invented example', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n');
  const notTheExample = tracked
    .filter((f) => /identity-vocabulary/.test(f))
    .filter((f) => f !== 'templates/identity-vocabulary.example');
  assert.deepStrictEqual(notTheExample, [],
    'a filled-in vocabulary is a precise index of what not to publish — it never belongs in a repo');
});
