'use strict';
/**
 * Tests for the audit's repository-METADATA identity scan (audit/audit.mjs, #228 part 4).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Description, topics, homepage and the repository name never pass through git, so the
 * pre-commit identity scan structurally cannot see any of them — and they are the first
 * thing a visitor reads. This is the periodic sweep for that class.
 *
 * What is pinned here, and what a future session must DELETE rather than work around:
 *
 *   - it is OFF unless --identity is passed, and no `gh` call happens without it. A fleet
 *     sweep has to stay runnable offline, and the input is the operator's private file;
 *   - the report says on EVERY run whether metadata was scanned. A run that did not check is
 *     never silently indistinguishable from one that checked and found nothing;
 *   - unreadable metadata is a FAIL, not a warn and not silence: --identity was asked for, so
 *     a repo the API could not answer for is a scan that did not run. A check that cannot run
 *     must never report clean — the whole reason this part is separate from the hook;
 *   - a PRIVATE repo is not-applicable, which is a determination (visibility was read), not a
 *     failure to run — and it is silent in the text report but explicit in --json;
 *   - a repo with no GitHub remote has no metadata to scan: also not-applicable, also silent;
 *   - findings are REDACTED. The audit's output is pasted into issues and chat, so a finding
 *     about a string must never carry the string. COLAB_IDENTITY_SHOW=1 unredacts locally;
 *   - the vocabulary is never in a repo and never in the output: it is resolved by path, and
 *     every way of failing to load it exits 2 BEFORE any repo is audited.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const CLEAN_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(dir);
  return dir;
}

/** A throwaway repo, optionally with a GitHub `origin`. */
function fixture({ origin = 'https://github.com/an-owner/a-repo.git' } = {}) {
  const dir = tmpdir('audit-identity-');
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit identity test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), CLEAN_YML);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  if (origin) g('remote', 'add', 'origin', origin);
  return dir;
}

/**
 * A fake `gh` on PATH answering exactly ONE request — `api repos/<slug>`, the metadata read —
 * and touching a marker file when it is asked, so a test can assert it was never called.
 *
 * Everything else fails, deliberately: the audit also reads `repos/<slug>/labels` for any
 * local repo with a GitHub origin, and a fake that answered every `api` call with this
 * payload fed garbage to the label check and made the fixture non-clean for a reason that has
 * nothing to do with this unit. Failing that call is also the truthful shape — it is what a
 * `gh` with no auth does — and the label check stays silent on it by design.
 *
 * `payload === null` makes the metadata call itself fail, which is what offline,
 * unauthenticated and deleted-repo all look like from here.
 */
function fakeGh(payload, { slug = 'an-owner/a-repo' } = {}) {
  const dir = tmpdir('audit-identity-bin-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const marker = path.join(dir, 'called');
  const payloadFile = path.join(dir, 'payload.json');
  if (payload !== null) fs.writeFileSync(payloadFile, JSON.stringify(payload));
  const body = [
    '#!/bin/sh',
    `if [ "$1" = "api" ] && [ "$2" = "repos/${slug}" ]; then`,
    `  : >> "${marker}"`,
    payload === null ? '  exit 1' : `  cat "${payloadFile}"; exit 0`,
    'fi',
    'exit 1',
  ];
  fs.writeFileSync(path.join(bin, 'gh'), body.join('\n'), { mode: 0o755 });
  return { bin, marker, called: () => fs.existsSync(marker) };
}

function vocabulary(lines) {
  const dir = tmpdir('audit-identity-vocab-');
  const file = path.join(dir, 'identity-vocabulary');
  fs.writeFileSync(file, Array.isArray(lines) ? lines.join('\n') + '\n' : lines);
  return file;
}

/** Run the audit over `dir`; returns { code, stdout, stderr, json (or null) }. */
function audit(dir, { args = [], gh = null, vocab = null, env = {} } = {}) {
  const res = spawnSync('node', [AUDIT, '--json', '--local', dir, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // Ambient state is the #101/#108 failure class: without these, whether this test passes
      // depends on whether the developer happens to have a vocabulary configured.
      PATH: gh ? `${gh.bin}:${process.env.PATH}` : process.env.PATH,
      HOME: os.tmpdir(),
      COLAB_HOME: path.join(os.tmpdir(), 'no-such-colab-home'),
      COLAB_IDENTITY_VOCAB: vocab || '',
      COLAB_IDENTITY_SHOW: '',
      ...env,
    },
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch (_) { /* a usage error prints nothing on stdout */ }
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

// --- off by default ---------------------------------------------------------------------

test('without --identity nothing is scanned and `gh` is never called for metadata', () => {
  const gh = fakeGh({ visibility: 'public', name: 'a-repo', description: 'build-box-01' });
  const r = audit(fixture(), { gh, vocab: vocabulary(['build-box-01']) });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.json.identity.scanned, false);
  assert.strictEqual(r.json.results[0].clean, true);
  assert.strictEqual(r.json.results[0].identityMetadata, undefined);
  assert.ok(!gh.called(), 'a fleet sweep must stay runnable offline — no metadata call unless asked');
});

test('the text report states on every run whether metadata was scanned', () => {
  const withoutFlag = spawnSync('node', [AUDIT, '--local', fixture()], {
    encoding: 'utf8',
    env: { ...process.env, HOME: os.tmpdir(), COLAB_HOME: path.join(os.tmpdir(), 'nope'), COLAB_IDENTITY_VOCAB: '' },
  });
  assert.match(withoutFlag.stdout, /identity: {2}repository metadata NOT scanned/,
    'silence would let a run that checked nothing read exactly like a run that found nothing');
});

// --- the scan itself --------------------------------------------------------------------

test('a public repo whose metadata matches the vocabulary is a FAIL, redacted', () => {
  const gh = fakeGh({
    visibility: 'public',
    name: 'a-repo',
    description: 'mirrors of build-box-01',
    homepage: '',
    topics: ['tooling'],
  });
  const r = audit(fixture(), { gh, args: ['--identity'], vocab: vocabulary(['build-box-01']) });
  assert.strictEqual(r.code, 1, r.stderr);
  const meta = r.json.results[0].identityMetadata;
  assert.strictEqual(meta.status, 'matched');
  assert.deepStrictEqual(meta.hits.map((h) => h.location), ['description']);
  assert.strictEqual(meta.hits[0].entry, 1);
  assert.doesNotMatch(r.stdout, /build-box-01/, 'a finding ABOUT a string must never carry the string');
  assert.match(r.stdout, /redacted/);
});

test('every metadata field is scanned — name, description, homepage and each topic', () => {
  const gh = fakeGh({
    visibility: 'public',
    name: 'build-box-01-tools',
    description: 'nothing here',
    homepage: 'https://build-box-01.corp.invalid',
    topics: ['fine', 'build-box-01'],
  });
  const r = audit(fixture(), { gh, args: ['--identity'], vocab: vocabulary(['build-box-01']) });
  assert.strictEqual(r.code, 1, r.stderr);
  const locations = r.json.results[0].identityMetadata.hits.map((h) => h.location).sort();
  assert.deepStrictEqual(locations, ['homepage', 'repository name', 'topic 2']);
});

test('COLAB_IDENTITY_SHOW=1 unredacts, in both the text report and --json', () => {
  const gh = fakeGh({ visibility: 'public', name: 'a-repo', description: 'build-box-01' });
  const r = audit(fixture(), {
    gh, args: ['--identity'], vocab: vocabulary(['build-box-01']), env: { COLAB_IDENTITY_SHOW: '1' },
  });
  assert.match(r.stdout, /build-box-01/);
  assert.strictEqual(r.json.results[0].identityMetadata.hits[0].value, 'build-box-01');
});

test('a public repo with clean metadata reports clean, and says which fields it read', () => {
  const gh = fakeGh({ visibility: 'public', name: 'a-repo', description: 'an invented description', topics: ['tooling'] });
  const r = audit(fixture(), { gh, args: ['--identity'], vocab: vocabulary(['build-box-01']) });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.deepStrictEqual(r.json.results[0].identityMetadata, { status: 'clean', fields: 3 });
  assert.strictEqual(r.json.identity.scanned, true);
  assert.strictEqual(r.json.identity.terms, 1);
});

// --- the safe direction -----------------------------------------------------------------

test('metadata that cannot be read is a FAIL — a check that could not run never reports clean', () => {
  const gh = fakeGh(null); // offline / unauthenticated / repo gone — indistinguishable from here
  const r = audit(fixture(), { gh, args: ['--identity'], vocab: vocabulary(['build-box-01']) });
  assert.strictEqual(r.code, 1, r.stderr);
  assert.strictEqual(r.json.results[0].identityMetadata.status, 'unreadable');
  assert.match(r.stdout, /identity scan did NOT run/);
});

test('a PRIVATE repo is not-applicable — a determination, not a failure to run', () => {
  const gh = fakeGh({ visibility: 'private', name: 'a-repo', description: 'build-box-01 lives here' });
  const r = audit(fixture(), { gh, args: ['--identity'], vocab: vocabulary(['build-box-01']) });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.json.results[0].identityMetadata.status, 'not-applicable');
  assert.match(r.json.results[0].identityMetadata.reason, /not public/);
  assert.strictEqual(r.json.results[0].clean, true, 'the harm this answers is publication');
});

test('a repo with no GitHub remote has no metadata to scan, and no call is made', () => {
  const gh = fakeGh({ visibility: 'public', name: 'a-repo', description: 'build-box-01' });
  const r = audit(fixture({ origin: null }), { gh, args: ['--identity'], vocab: vocabulary(['build-box-01']) });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.json.results[0].identityMetadata.reason, /no GitHub remote/);
  assert.ok(!gh.called());
});

// --- the vocabulary is an input, and a missing input is not a degraded run ----------------

test('--identity with no vocabulary anywhere exits 2 before auditing a single repo', () => {
  const gh = fakeGh({ visibility: 'public', name: 'a-repo' });
  const r = audit(fixture(), { gh, args: ['--identity'] });
  assert.strictEqual(r.code, 2, r.stdout);
  assert.match(r.stderr, /no vocabulary at/);
  assert.ok(!gh.called(), 'it stops before the sweep — never a run that prints clean over a check that did not happen');
});

test('--identity with an unusable vocabulary exits 2 and names the entry', () => {
  const r = audit(fixture(), { gh: fakeGh({ visibility: 'public' }), args: ['--identity'], vocab: vocabulary(['ab']) });
  assert.strictEqual(r.code, 2, r.stdout);
  assert.match(r.stderr, /entry 1 is only 2 character\(s\)/);
});

test('--identity with an empty vocabulary exits 2 — an empty list is not a scan', () => {
  const r = audit(fixture(), { gh: fakeGh({ visibility: 'public' }), args: ['--identity'], vocab: vocabulary(['# only a comment']) });
  assert.strictEqual(r.code, 2, r.stdout);
  assert.match(r.stderr, /no terms/);
});

test('the vocabulary path is reported but its terms never are', () => {
  const vocab = vocabulary(['build-box-01', 'Northwind Freight']);
  const gh = fakeGh({ visibility: 'public', name: 'a-repo', description: 'clean' });
  const r = audit(fixture(), { gh, args: ['--identity'], vocab });
  assert.strictEqual(r.json.identity.vocabulary, vocab);
  assert.strictEqual(r.json.identity.terms, 2);
  assert.doesNotMatch(r.stdout, /Northwind/, 'the list is the index of what not to publish — it never enters a report');
});
