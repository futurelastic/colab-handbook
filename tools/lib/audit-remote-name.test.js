'use strict';
/**
 * Tests for #376 — the two places outside `tools/` that still assumed the remote is literally
 * `origin` after #301 routed every `colab` remote operation through one resolver
 * (`tools/lib/git.js` `remoteInfo`; rule order in tools/README.md, "Which remote").
 *
 *   audit/audit.mjs  read `git remote get-url origin` for the repo's GitHub slug (label check,
 *                    `--identity` metadata scan). A repo whose only remote is `upstream` lost both
 *                    silently. It now asks the resolver, and an AMBIGUOUS set of remotes is
 *                    reported (warn for labels, fail for an explicitly requested identity scan) —
 *                    never guessed, never silent.
 *   pre-push-guard   printed `origin/<trunk>` in its trunk remedy. It now names the remote git hands
 *                    the hook as $1, falling back to `colab.remote`, then `origin`, on a URL push.
 *
 * Fixtures are real git repos; `gh` is a fake on PATH that logs every call, so the test proves
 * WHICH slug the audit asked about without a network.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');
const GUARD = path.join(REPO_ROOT, 'templates', 'pre-push-guard');

const CLEAN_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(dir);
  return dir;
}

/** A throwaway repo on `main` with the given remotes ({ name: url }) and optional git config. */
function fixture(remotes, config = {}) {
  const dir = tmpdir('audit-remote-name-');
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit remote name test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), CLEAN_YML);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  for (const [name, url] of Object.entries(remotes)) g('remote', 'add', name, url);
  for (const [k, v] of Object.entries(config)) g('config', k, v);
  return dir;
}

/** A fake `gh` that logs its argv, one call per line, and fails every call (the "no auth" shape). */
function fakeGh() {
  const dir = tmpdir('audit-remote-name-bin-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(dir, 'calls');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\necho "$*" >> "${log}"\nexit 1\n`, { mode: 0o755 });
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}

function vocabulary() {
  const file = path.join(tmpdir('audit-remote-name-vocab-'), 'identity-vocabulary');
  fs.writeFileSync(file, 'build-box-01\n');
  return file;
}

function audit(dir, { gh, args = [], vocab = '' }) {
  const res = spawnSync('node', [AUDIT, '--json', '--local', dir, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${gh.bin}:${process.env.PATH}`,
      HOME: os.tmpdir(),
      COLAB_HOME: path.join(os.tmpdir(), 'no-such-colab-home'),
      COLAB_IDENTITY_VOCAB: vocab,
      COLAB_IDENTITY_SHOW: '',
    },
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch (_) { /* usage error */ }
  return { code: res.status, stderr: res.stderr, json, findings: json ? json.results[0].findings : [] };
}

const texts = (r) => r.findings.map((f) => `${f.level}: ${f.text}`);

// --- audit: which remote's slug is read -------------------------------------------------------

test('audit: an `origin` repo reads origin\'s slug — the pre-#376 path, unchanged', () => {
  const gh = fakeGh();
  const r = audit(fixture({ origin: 'https://github.com/an-owner/a-repo.git', upstream: 'https://github.com/up-owner/up-repo.git' }), { gh });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.ok(gh.calls().some((c) => c.startsWith('api repos/an-owner/a-repo/labels')), gh.calls().join('\n'));
  assert.ok(!gh.calls().some((c) => c.includes('up-owner')), 'origin outranks every other remote');
  assert.strictEqual(r.json.results[0].clean, true, texts(r).join('\n'));
});

test('audit: a repo whose only remote is `upstream` reads upstream\'s slug instead of losing it', () => {
  const gh = fakeGh();
  const r = audit(fixture({ upstream: 'https://github.com/up-owner/up-repo.git' }), { gh });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.ok(gh.calls().some((c) => c.startsWith('api repos/up-owner/up-repo/labels')),
    `the label check never asked about the only remote — calls:\n${gh.calls().join('\n')}`);
});

test('audit: `colab.remote` wins over `origin`, exactly as it does for colab', () => {
  const gh = fakeGh();
  audit(fixture({ origin: 'https://github.com/an-owner/a-repo.git', fork: 'https://github.com/fork-owner/fork-repo.git' },
    { 'colab.remote': 'fork' }), { gh });
  assert.ok(gh.calls().some((c) => c.startsWith('api repos/fork-owner/fork-repo/labels')), gh.calls().join('\n'));
  assert.ok(!gh.calls().some((c) => c.includes('an-owner')));
});

test('audit: ambiguous remotes are REPORTED, not guessed — the label check warns and names the fix', () => {
  const gh = fakeGh();
  const r = audit(fixture({ one: 'https://github.com/o1/r1.git', two: 'https://github.com/o2/r2.git' }), { gh });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.deepStrictEqual(gh.calls(), [], 'no remote may be picked when several fit');
  const w = r.findings.filter((f) => f.level === 'warn' && /convention labels: not checked/.test(f.text));
  assert.strictEqual(w.length, 1, texts(r).join('\n'));
  assert.match(w[0].text, /git config colab\.remote <name>/);
});

test('audit: a local-only repo stays silent about labels — no remote is not a problem', () => {
  const gh = fakeGh();
  const r = audit(fixture({}), { gh });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.deepStrictEqual(gh.calls(), []);
  assert.strictEqual(r.json.results[0].clean, true, texts(r).join('\n'));
});

test('audit --identity: ambiguous remotes FAIL the requested scan with the fix, not a silent not-applicable', () => {
  const gh = fakeGh();
  const r = audit(fixture({ one: 'https://github.com/o1/r1.git', two: 'https://github.com/o2/r2.git' }),
    { gh, args: ['--identity'], vocab: vocabulary() });
  assert.strictEqual(r.json.results[0].identityMetadata.status, 'unreadable');
  const f = r.findings.filter((x) => x.level === 'fail' && /repository metadata: .*identity scan did NOT run/.test(x.text));
  assert.strictEqual(f.length, 1, texts(r).join('\n'));
  assert.match(f[0].text, /colab\.remote/);
});

test('audit --identity: an `upstream`-only repo scans upstream\'s metadata', () => {
  const gh = fakeGh();
  audit(fixture({ upstream: 'https://github.com/up-owner/up-repo.git' }), { gh, args: ['--identity'], vocab: vocabulary() });
  assert.ok(gh.calls().includes('api repos/up-owner/up-repo'), gh.calls().join('\n'));
});

// --- pre-push-guard: the remedy names the remote actually pushed to ---------------------------

/** Run the guard as git would: $1 remote, $2 url, a trunk ref on stdin. Returns stderr. */
function runGuard(dir, args) {
  const res = spawnSync('sh', [GUARD, ...args], {
    cwd: dir,
    encoding: 'utf8',
    input: 'refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000\n',
    env: { ...process.env, COLAB_SHIP: '', COLAB_HUMAN: '', COLAB_PROMOTE: '' },
  });
  assert.strictEqual(res.status, 1, 'a raw push to trunk must still be refused');
  return res.stderr;
}

test('pre-push-guard: pushing to `upstream` names upstream/<trunk> in the remedy', () => {
  const dir = fixture({ upstream: 'https://github.com/up-owner/up-repo.git' });
  const err = runGuard(dir, ['upstream', 'https://github.com/up-owner/up-repo.git']);
  assert.match(err, /git log --oneline upstream\/main\.\.main/);
  assert.match(err, /git reset --hard upstream\/main/);
  assert.doesNotMatch(err, /origin\//);
});

test('pre-push-guard: an `origin` push prints exactly what it printed before #376', () => {
  const dir = fixture({ origin: 'https://github.com/an-owner/a-repo.git' });
  const err = runGuard(dir, ['origin', 'https://github.com/an-owner/a-repo.git']);
  assert.match(err, /git log --oneline origin\/main\.\.main {8}# what is actually there/);
  assert.match(err, /git reset --hard origin\/main {17}# return the checkout to at-rest/);
});

test('pre-push-guard: a push to a bare URL falls back to colab.remote, then origin', () => {
  const url = 'https://github.com/up-owner/up-repo.git';
  const withOverride = fixture({ upstream: url }, { 'colab.remote': 'upstream' });
  assert.match(runGuard(withOverride, [url, url]), /git reset --hard upstream\/main/);
  const without = fixture({ upstream: url });
  assert.match(runGuard(without, [url, url]), /git reset --hard origin\/main/);
});
