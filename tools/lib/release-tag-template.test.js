'use strict';
/**
 * Behaviour tests for templates/release-tag.yml's two shell steps (#333).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The template is copy-and-own YAML, so nothing else in the suite executes it; actionlint
 * checks its schema, not what its shell does. These tests lift the `run:` blocks of
 * "Resolve tag and previous tag" and "Build grouped release summary" out of the template
 * TEXT (no YAML dependency — this repo has none) and run them under bash against throwaway
 * git repos, exactly as a tag push would, so the header's stated behaviour table is
 * checked against what the steps actually do:
 *
 *   v1.3.0-rc.N  → pre-release, summary since the previous FINAL tag
 *   v1.3.0       → full release, summary since the previous FINAL tag — never since the
 *                  candidate it was promoted from
 *
 * The hazard pinned here (#330): GitHub's and git's `*` both match `-rc.1`, so a
 * `v*.*.*` match without an exclusion picks the candidate as "previous".
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE = path.join(REPO_ROOT, 'templates', 'release-tag.yml');
const TEXT = fs.readFileSync(TEMPLATE, 'utf8');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });
function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(dir);
  return dir;
}

/** The dedented body of the `run: |` block belonging to the step named `name`. */
function stepScript(name) {
  const lines = TEXT.split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `step "${name}" not found in the template`);
  const stepIndent = lines[at].indexOf('-');
  let runAt = -1;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.indexOf(l.trim()) <= stepIndent) break; // next step / out of steps
    if (/^\s*run: \|\s*$/.test(l)) { runAt = i; break; }
  }
  assert.ok(runAt >= 0, `step "${name}" has no run: | block`);
  const runIndent = lines[runAt].indexOf('run:');
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.indexOf(l.trim()) <= runIndent) break;
    body.push(l);
  }
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.indexOf(l.trim())));
  return body.map((l) => l.slice(indent)).join('\n');
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

function repo() {
  const dir = tmpdir('release-tag-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'config', 'user.name', 'T');
  git(dir, 'config', 'tag.gpgSign', 'false');
  git(dir, 'config', 'commit.gpgSign', 'false');
  return dir;
}
let n = 0;
function commit(dir, subject) {
  fs.writeFileSync(path.join(dir, 'f.txt'), `${++n}\n`);
  git(dir, 'add', 'f.txt');
  git(dir, 'commit', '-q', '-m', subject);
}

/** Runs one lifted step under bash; returns its $GITHUB_OUTPUT as an object. */
function runStep(dir, name, env) {
  const out = path.join(tmpdir('gh-out-'), 'output');
  const summary = path.join(path.dirname(out), 'summary');
  fs.writeFileSync(out, '');
  execFileSync('bash', ['-e', '-c', stepScript(name)], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, GIT_CONFIG_GLOBAL: '/dev/null', ...env },
  });
  const o = {};
  for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) o[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return o;
}

function release(dir, tag) {
  const tags = runStep(dir, 'Resolve tag and previous tag', { GITHUB_REF_NAME: tag });
  const notes = runStep(dir, 'Build grouped release summary', { TAG: tags.tag, PREV: tags.prev, RANGE: tags.range });
  return { ...tags, body: fs.readFileSync(notes['body-file'], 'utf8') };
}

// v1.2.0 ─ v1.2.1 ─ feat ─ fix [v1.3.0-rc.1] ─ fix [v1.3.0-rc.2, v1.3.0 (annotated)]
// The final is cut on the candidate's own commit — the ordinary promotion shape, and the one
// where the old `--match 'v*.*.*'` resolved "previous" to v1.3.0-rc.1.
function fixture() {
  const dir = repo();
  commit(dir, 'feat: first');
  git(dir, 'tag', 'v1.2.0');
  commit(dir, 'fix: patch');
  git(dir, 'tag', 'v1.2.1');
  commit(dir, 'feat: new thing');
  commit(dir, 'fix: candidate one bug');
  git(dir, 'tag', 'v1.3.0-rc.1');
  commit(dir, 'fix: candidate two bug');
  git(dir, 'tag', 'v1.3.0-rc.2');
  git(dir, 'tag', '-a', 'v1.3.0', '-m', 'v1.3.0');
  return dir;
}

test('the fixture reproduces the hazard: the old previous-tag match picks the candidate', () => {
  const dir = fixture();
  const old = git(dir, 'describe', '--tags', '--abbrev=0', '--match', 'v*.*.*', 'v1.3.0^');
  assert.strictEqual(old, 'v1.3.0-rc.1');
});

test('a candidate tag is a pre-release summarised since the previous FINAL tag', () => {
  const dir = fixture();
  const rc1 = release(dir, 'v1.3.0-rc.1');
  assert.strictEqual(rc1.prerelease, 'true');
  assert.strictEqual(rc1.prev, 'v1.2.1');
  assert.strictEqual(rc1.range, 'v1.2.1..v1.3.0-rc.1');
  assert.match(rc1.body, /^2 commits since v1\.2\.1\.$/m);

  // rc.2 is NOT summarised against rc.1.
  const rc2 = release(dir, 'v1.3.0-rc.2');
  assert.strictEqual(rc2.prerelease, 'true');
  assert.strictEqual(rc2.prev, 'v1.2.1');
  assert.match(rc2.body, /^3 commits since v1\.2\.1\.$/m);
});

test('a final tag is a full release summarised since the previous final, not its candidate', () => {
  const dir = fixture();
  const fin = release(dir, 'v1.3.0');
  assert.strictEqual(fin.prerelease, 'false');
  assert.strictEqual(fin.prev, 'v1.2.1');
  assert.strictEqual(fin.range, 'v1.2.1..v1.3.0');
  assert.match(fin.body, /^3 commits since v1\.2\.1\.$/m);
  assert.match(fin.body, /### Features\n\n- new thing/);
  assert.match(fin.body, /- candidate one bug/);
});

test('a patch final after a patch: prev is the prior final', () => {
  const dir = fixture();
  const p = release(dir, 'v1.2.1');
  assert.strictEqual(p.prerelease, 'false');
  assert.strictEqual(p.prev, 'v1.2.0');
  assert.match(p.body, /^1 commits since v1\.2\.0\.$/m);
});

test('a candidate with no earlier final summarises all history, still as a pre-release', () => {
  const dir = repo();
  commit(dir, 'feat: a');
  commit(dir, 'fix: b');
  git(dir, 'tag', 'v0.1.0-rc.1');
  const r = release(dir, 'v0.1.0-rc.1');
  assert.strictEqual(r.prerelease, 'true');
  assert.strictEqual(r.prev, '');
  assert.strictEqual(r.range, 'v0.1.0-rc.1');
  assert.match(r.body, /^First release\. 2 commits\.$/m);

  // And an earlier CANDIDATE alone is still not a "previous" for the next final.
  commit(dir, 'fix: c');
  git(dir, 'tag', 'v0.1.0');
  const f = release(dir, 'v0.1.0');
  assert.strictEqual(f.prerelease, 'false');
  assert.strictEqual(f.prev, '');
});

test('the publish step takes prerelease from the tag name, not a constant', () => {
  assert.doesNotMatch(TEXT, /^\s*RELEASE_PRERELEASE:/m, 'a fixed RELEASE_PRERELEASE env is back');
  assert.match(TEXT, /^\s*prerelease: \$\{\{ steps\.tags\.outputs\.prerelease == 'true' \}\}\s*$/m);
});

test('the header ships the safe deploy-trigger example', () => {
  assert.match(TEXT, /^#\s+- "v\*\.\*\.\*"/m);
  assert.match(TEXT, /^#\s+- "!v\*\.\*\.\*-\*"/m);
  assert.doesNotMatch(TEXT, /deploy workflow both key off v\*\.\*\.\*/, 'the unsafe trigger comment is back');
});
