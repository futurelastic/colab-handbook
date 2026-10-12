'use strict';
/**
 * #596 — the owner-level migration-grant value, end to end through the CLI with a `gh` stub that
 * answers the tracker read, the CI read, and the owner record (`gh api repos/{owner}/.github/…`),
 * and LOGS every write it is asked to perform. Fixture shape copied from
 * migration-grant-mint.test.js (copy-not-extract, the same reason that file gives).
 *
 * Run: `node --test tools/lib/*.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const op = require('./owner-policy.js');

const COLAB = path.join(__dirname, '..', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const BASE_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const BRANCH = 'feat/x-1';
const ran = [{ name: 'Run migrations', status: 'completed', conclusion: 'success' }];
const RT = { name: 'Migration round-trip (mysql)', status: 'completed', conclusion: 'success', steps: ran };

/** `owner`: undefined = the owner has no .github repo (404); [] = repo + issue, no markers;
 *  [{value, login, assoc}] = markers on the record issue. */
function fixture({ yml = '', owner } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-owner-policy-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab owner-policy test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), BASE_YML + yml);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'checkout', '-q', '-b', BRANCH);
  fs.mkdirSync(path.join(work, 'database', 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(work, 'database', 'migrations', '2026_01_01_x.php'), 'x\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: add a migration');
  g(work, 'checkout', '-q', 'main');
  g(work, 'push', '-q', 'origin', BRANCH);
  const head = g(work, 'rev-parse', BRANCH).trim();

  const data = path.join(root, 'gh-data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data, 'runs.json'), JSON.stringify([{ headSha: head, status: 'completed', conclusion: 'success',
    createdAt: '2026-10-01T00:00:00Z', databaseId: 501, workflowName: 'CI', event: 'push' }]));
  fs.writeFileSync(path.join(data, 'run-501.json'), JSON.stringify({ jobs: [RT] }));
  if (owner !== undefined) {
    fs.writeFileSync(path.join(data, 'owner-issues.json'), JSON.stringify([{ number: 7, repository_url: 'https://api.github.com/repos/acme/.github' }]));
    // gh applies --jq itself; the stub hands back what that filter would print: one object per line.
    fs.writeFileSync(path.join(data, 'owner-comments.ndjson'), owner.map((m, i) => JSON.stringify({
      user: { login: m.login || 'boss' }, author_association: m.assoc || 'OWNER',
      created_at: `2026-10-0${i + 1}T00:00:00Z`, body: op.markerBody('migration-grant', m.value, 'box', 'x') })).join('\n') + '\n');
  }
  const log = path.join(root, 'writes.log');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `D='${data}'; L='${log}'`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ]; then',
    '  case "$*" in *"-X POST"*) echo "$*" >> "$L"; echo 7; exit 0;; esac',
    '  case "$*" in',
    '    *"/.github/issues?labels="*) [ -f "$D/owner-issues.json" ] && { cat "$D/owner-issues.json"; exit 0; }; echo "gh: Not Found (HTTP 404)" >&2; exit 1;;',
    '    *"/.github/issues/7/comments"*) cat "$D/owner-comments.ndjson"; exit 0;;',
    '    *"repos/{owner}/.github --jq"*) [ -f "$D/owner-issues.json" ] && { echo acme/.github; exit 0; }; echo "gh: Not Found (HTTP 404)" >&2; exit 1;;',
    '  esac',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then echo \'{"state":"OPEN","labels":[]}\'; exit 0; fi',
    'if [ "$1" = "label" ] && [ "$2" = "list" ]; then echo migration-granted; echo in-progress; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "$D/runs.json"; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "view" ]; then f="$D/run-$3.json"; [ -f "$f" ] && { cat "$f"; exit 0; }; exit 1; fi',
    'if [ "$1" = "issue" ] && { [ "$2" = "edit" ] || [ "$2" = "comment" ]; }; then echo "$*" >> "$L"; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { work, home, bin, head, log };
}

function colab(fx, args, env = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_HUMAN: '1',
      COLAB_SESSION: 'sess-owner-policy-test', COLAB_SESSION_NAME: '', ...env },
  });
  const writes = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8') : '';
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', writes };
}
const mint = (fx) => colab(fx, ['migration-grant', '1', '--branch', BRANCH, '--role', 'migration-reviewer', '--reviewer', 'bot-a',
  '--verdict', 'approve', '--checklist', 'pass', '--escalation', 'data-loss-rule', '--escalation-result', 'clear',
  '--ci-roundtrip', 'pass', '--head', fx.head, '--repo', fx.work]);

test('no repo key + owner value reviewer → a passing reviewer grant mints, naming the owner source', () => {
  const fx = fixture({ owner: [{ value: 'reviewer' }] });
  const r = mint(fx);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Recorded a migration-reviewer grant on #1/);
  assert.match(r.out, /Policy source: owner-level migration-grant: reviewer \(set on acme\/\.github by boss/);
  assert.match(r.writes, /issue comment 1 /);
});

test('repo migration-grant: human + owner reviewer → refused, says the repo opted out, nothing written', () => {
  const fx = fixture({ yml: 'migration-grant: human\n', owner: [{ value: 'reviewer' }] });
  const r = mint(fx);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /this repo opted out: project.yml declares migration-grant: human/);
  assert.equal(r.writes, '');
});

test('no owner value → the mint refusal is the pre-#596 text, byte for byte', () => {
  const expected = 'this repo\'s migration-grant policy is "human" (absent = human) — a reviewer grant is minted only where project.yml declares migration-grant: reviewer';
  for (const owner of [undefined, []]) {
    const r = mint(fixture({ owner }));
    assert.notStrictEqual(r.code, 0);
    assert.ok(r.err.includes(expected), r.err);
    assert.equal(r.writes, '');
  }
});

test('an owner marker from a collaborator does not count → refused as default human', () => {
  const r = mint(fixture({ owner: [{ value: 'reviewer', login: 'agent', assoc: 'COLLABORATOR' }] }));
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /policy is "human" \(absent = human\)/);
});

test('owner-policy set without COLAB_HUMAN=1 → exit 1, nothing read or written', () => {
  const fx = fixture({ owner: [] });
  const r = colab(fx, ['owner-policy', 'set', 'migration-grant', 'reviewer', '--repo', fx.work], { COLAB_HUMAN: '' });
  assert.equal(r.code, 1);
  assert.match(r.err, /requires a human/);
  assert.equal(r.writes, '');
});

test('owner-policy set with the human assertion posts one marker on the record issue', () => {
  const fx = fixture({ owner: [] });
  const r = colab(fx, ['owner-policy', 'set', 'migration-grant', 'reviewer', '--repo', fx.work]);
  assert.equal(r.code, 0, r.out + r.err);
  const posts = r.writes.split('\n').filter((l) => l.startsWith('api -X POST'));
  assert.equal(posts.length, 1, r.writes);
  assert.match(posts[0], /\.github\/issues\/7\/comments/);
  assert.match(posts[0], /colab:owner-policy key=migration-grant value=reviewer/);
});

test('owner-policy set refuses a bad key/value and never creates a missing .github repo', () => {
  const fx = fixture({ owner: undefined });
  assert.notStrictEqual(colab(fx, ['owner-policy', 'set', 'ci-grant', 'reviewer', '--repo', fx.work]).code, 0);
  assert.notStrictEqual(colab(fx, ['owner-policy', 'set', 'migration-grant', 'yes', '--repo', fx.work]).code, 0);
  const r = colab(fx, ['owner-policy', 'set', 'migration-grant', 'reviewer', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /has no \.github repo/);
  assert.equal(r.writes, '');
});

test('owner-policy show --json names value, setter, and the source this repo resolves to', () => {
  const fx = fixture({ owner: [{ value: 'reviewer' }] });
  const r = colab(fx, ['owner-policy', 'show', '--json', '--repo', fx.work]);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.deepEqual(j.owner['migration-grant'], { value: 'reviewer', by: 'boss', at: '2026-10-01T00:00:00Z' });
  assert.equal(j.resolved['migration-grant'].source, 'owner');
  assert.equal(j.resolved['migration-grant'].policy, 'reviewer');
});
