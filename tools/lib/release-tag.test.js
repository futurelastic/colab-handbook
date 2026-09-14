'use strict';
/**
 * Tests for #334 — every "current release" read skips pre-release tags.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The issue's own done-when, as one fixture: a repo tagged `v1.2.0`, then two commits (a feat and a
 * fix), then `v1.3.0-rc.1` on top. Every site must report `v1.2.0`, and the unreleased count must
 * include the commits sitting under the candidate. Sites:
 *   - release-tag.js latestReleaseTag      (the shared helper)
 *   - stamp.js handbookInfo / freezeVersion
 *   - tools/colab handbookVersion          (via `colab template` on a copied CLI — see handbookFixture)
 *   - tools/colab release-notes (default range) and release-status
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const releaseTag = require('./release-tag.js');
const stamp = require('./stamp.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(d);
  return d;
}

function g(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

function initRepo(dir, root) {
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { encoding: 'utf8' });
  g(dir, 'config', 'user.email', 'test@example.invalid');
  g(dir, 'config', 'user.name', 'colab release-tag test');
  // A global core.hooksPath must not run real hooks inside a fixture (#108).
  g(dir, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
}

function commit(dir, file, text, msg) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
  g(dir, 'add', '-A');
  g(dir, 'commit', '-q', '-m', msg);
}

/** v1.2.0 · feat · fix · v1.3.0-rc.1 — the issue's fixture. Annotated final, lightweight candidate:
 *  describe --tags must skip the candidate whichever kind it is. */
function tagCandidateOnTop(dir) {
  g(dir, 'tag', '-a', 'v1.2.0', '-m', 'v1.2.0');
  commit(dir, 'feat.txt', 'feature\n', 'feat: add feature');
  commit(dir, 'fix.txt', 'fixed\n', 'fix: urgent bug');
  g(dir, 'tag', 'v1.3.0-rc.1');
}

function colab(bin, args) {
  const home = tmp('colab-reltag-home-');
  const r = spawnSync('node', [bin, ...args], { encoding: 'utf8', env: { ...process.env, COLAB_HOME: home } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

// --- the helper -------------------------------------------------------------

test('isPrereleaseTag: a hyphen marks a pre-release, a bare vX.Y.Z does not', () => {
  assert.strictEqual(releaseTag.isPrereleaseTag('v1.3.0-rc.1'), true);
  assert.strictEqual(releaseTag.isPrereleaseTag('v2.0.0-beta'), true);
  assert.strictEqual(releaseTag.isPrereleaseTag('v1.2.0'), false);
});

test('latestReleaseTag skips a candidate on top; includePrerelease asks for it explicitly', () => {
  const root = tmp('colab-reltag-');
  const repo = path.join(root, 'r');
  initRepo(repo, root);
  commit(repo, 'a.txt', 'a\n', 'chore: init');
  tagCandidateOnTop(repo);

  assert.strictEqual(releaseTag.latestReleaseTag(repo), 'v1.2.0');
  assert.strictEqual(releaseTag.latestReleaseTag(repo, { includePrerelease: true }), 'v1.3.0-rc.1');
  // Regression proof of the hazard itself: the bare describe every site used returns the candidate.
  assert.strictEqual(g(repo, 'describe', '--tags', '--abbrev=0').trim(), 'v1.3.0-rc.1');
});

test('latestReleaseTag is null with only candidates, no tags, or no repo — never throws', () => {
  const root = tmp('colab-reltag-');
  const repo = path.join(root, 'r');
  initRepo(repo, root);
  commit(repo, 'a.txt', 'a\n', 'chore: init');
  assert.strictEqual(releaseTag.latestReleaseTag(repo), null);
  g(repo, 'tag', 'v1.0.0-rc.1');
  assert.strictEqual(releaseTag.latestReleaseTag(repo), null);
  assert.strictEqual(releaseTag.latestReleaseTag(path.join(root, 'nope')), null);
});

// --- stamp.js ---------------------------------------------------------------

test('handbookInfo reports the final, not the candidate on top of it', () => {
  const root = tmp('colab-reltag-');
  const repo = path.join(root, 'hb');
  initRepo(repo, root);
  commit(repo, 'tools/colab', '#!/usr/bin/env node\n', 'chore: init');
  tagCandidateOnTop(repo);
  const hb = stamp.handbookInfo(repo);
  assert.strictEqual(hb.version, 'v1.2.0');
  assert.strictEqual(hb.untagged, false);
});

test('handbookInfo with only a candidate tag is still untagged (v0)', () => {
  const root = tmp('colab-reltag-');
  const repo = path.join(root, 'hb');
  initRepo(repo, root);
  commit(repo, 'tools/colab', '#!/usr/bin/env node\n', 'chore: init');
  g(repo, 'tag', 'v1.0.0-rc.1');
  const hb = stamp.handbookInfo(repo);
  assert.strictEqual(hb.untagged, true);
  assert.strictEqual(hb.version, 'v0');
});

test('freezeVersion on a tree sitting on a candidate stamps the long form of the final, never the candidate', () => {
  const root = tmp('colab-reltag-');
  const repo = path.join(root, 'hb');
  initRepo(repo, root);
  commit(repo, 'tools/colab', '#!/usr/bin/env node\n', 'chore: init');
  tagCandidateOnTop(repo);
  const f = stamp.freezeVersion(repo);
  assert.strictEqual(f.tag, 'v1.2.0');
  assert.strictEqual(f.exact, false);
  assert.match(f.version, /^v1\.2\.0-2-g[0-9a-f]+$/);
  // …and that stamp stays usable as classifyFrozen's lower bound.
  assert.strictEqual(stamp.classifyFrozen({ root: repo, hb: stamp.handbookInfo(repo), stampVersion: f.version }).state, 'current');
});

// --- tools/colab ------------------------------------------------------------

/**
 * handbookVersion resolves the handbook from the CLI's own location (`__dirname/..`), so the only
 * honest way to aim it at a fixture is a fixture that IS a handbook: copy the real tools/ into it.
 */
function handbookFixture() {
  const root = tmp('colab-reltag-hb-');
  const hb = path.join(root, 'hb');
  initRepo(hb, root);
  fs.cpSync(path.join(REPO_ROOT, 'tools', 'colab'), path.join(hb, 'tools', 'colab'));
  fs.cpSync(path.join(REPO_ROOT, 'tools', 'lib'), path.join(hb, 'tools', 'lib'), { recursive: true });
  fs.cpSync(path.join(REPO_ROOT, 'tools', 'package.json'), path.join(hb, 'tools', 'package.json'));
  fs.mkdirSync(path.join(hb, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(hb, 'templates', 'ci-fixture.yml'), 'name: fixture\n');
  g(hb, 'add', '-A');
  g(hb, 'commit', '-q', '-m', 'chore: fixture handbook');
  tagCandidateOnTop(hb);
  return { hb, bin: path.join(hb, 'tools', 'colab') };
}

test('colab template (handbookVersion) and colab version report the final, not the candidate', () => {
  const fx = handbookFixture();
  const t = colab(fx.bin, ['template']);
  assert.strictEqual(t.code, 0, t.out + t.err);
  assert.match(t.out, /\(handbook v1\.2\.0\):/);
  assert.doesNotMatch(t.out, /rc\.1/);

  const v = colab(fx.bin, ['version']);
  assert.match(v.out, /colab-handbook v1\.2\.0 /, v.out + v.err);
});

test('release-notes default range starts at the final, covering the commits under the candidate', () => {
  const root = tmp('colab-reltag-');
  const repo = path.join(root, 'r');
  initRepo(repo, root);
  commit(repo, 'a.txt', 'a\n', 'chore: init');
  tagCandidateOnTop(repo);
  const r = colab(COLAB, ['release-notes', '--repo', repo]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /since `?v1\.2\.0/);
  assert.doesNotMatch(r.out, /v1\.3\.0-rc\.1/);
  assert.match(r.out, /feat: add feature|add feature/);
  assert.match(r.out, /fix: urgent bug|urgent bug/);
});

test('release-notes with only candidate tags refuses to guess', () => {
  const root = tmp('colab-reltag-');
  const repo = path.join(root, 'r');
  initRepo(repo, root);
  commit(repo, 'a.txt', 'a\n', 'chore: init');
  g(repo, 'tag', 'v1.0.0-rc.1');
  const r = colab(COLAB, ['release-notes', '--repo', repo]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err + r.out, /No release tags/);
});

test('release-status: a waiting candidate does not reset the unreleased gap (#81 stays visible)', () => {
  const root = tmp('colab-reltag-');
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  initRepo(work, root);
  g(work, 'remote', 'add', 'origin', origin);
  commit(work, '.github/project.yml',
    'tier: A\ntrunk: main\nproduction: https://example.invalid\ndeploy: tag\nstack: node\n', 'chore: fixture');
  tagCandidateOnTop(work);
  g(work, 'push', '-q', 'origin', 'main', '--tags');

  const r = colab(COLAB, ['release-status', '--repo', work, '--json']);
  const row = JSON.parse(r.out).rows[0];
  assert.strictEqual(row.applicable, true, r.out + r.err);
  assert.strictEqual(row.unreleased.tag, 'v1.2.0');
  assert.strictEqual(row.unreleased.commits, 2, 'both commits under the candidate are still unreleased');
  assert.strictEqual(row.unreleased.fixFlag, true);
  assert.strictEqual(row.flag, true);
  assert.strictEqual(r.code, 1);
});
