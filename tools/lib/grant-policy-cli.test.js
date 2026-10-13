'use strict';
/**
 * #598 — the machine-level migration-grant value (repo key > machine value > human), end to end
 * through the CLI with a `gh` stub that answers the tracker read, the CI read, and the retired #596
 * owner record (`gh api repos/{owner}/.github/…`), and LOGS every write and every owner-record read. Fixture shape copied from
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
const gp = require('./grant-policy.js');

const COLAB = path.join(__dirname, '..', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const BASE_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const BRANCH = 'feat/x-1';
const ran = [{ name: 'Run migrations', status: 'completed', conclusion: 'success' }];
const RT = { name: 'Migration round-trip (mysql)', status: 'completed', conclusion: 'success', steps: ran };

/** `owner`: undefined = the owner has no .github repo (404); [] = repo + issue, no markers;
 *  [{value, login, assoc}] = markers on the record issue. `machine`: a value to store in this
 *  fixture's COLAB_HOME config.json, as `config set migration-grant` would (no machine id). */
function fixture({ yml = '', owner, machine } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-owner-policy-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  if (machine) {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(gp.withValue({}, machine,
      { by: 'ada', at: '2026-10-13T00:00:00Z', host: 'box-a', machine: null })));
  }
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
  const reads = path.join(root, 'owner-reads.log');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/bin/sh',
    `D='${data}'; L='${log}'; R='${reads}'`,
    'if [ "$1" = "--version" ]; then echo "gh version 0.0.0 (fixture)"; exit 0; fi',
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo "Logged in (fixture)" >&2; exit 0; fi',
    'if [ "$1" = "api" ]; then',
    '  case "$*" in *"-X POST"*) echo "$*" >> "$L"; echo 7; exit 0;; esac',
    '  case "$*" in *"/.github"*) echo "$*" >> "$R";; esac',
    '  case "$*" in',
    '    *"/.github/issues?labels="*) [ -f "$D/owner-issues.json" ] && { cat "$D/owner-issues.json"; exit 0; }; echo "gh: Not Found (HTTP 404)" >&2; exit 1;;',
    '    *"/.github/issues/7/comments"*) cat "$D/owner-comments.ndjson"; exit 0;;',
    '    *"repos/{owner}/.github --jq"*) [ -f "$D/owner-issues.json" ] && { echo acme/.github; exit 0; }; echo "gh: Not Found (HTTP 404)" >&2; exit 1;;',
    '  esac',
    'fi',
    'if [ "$1" = "issue" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi',
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then echo \'{"state":"OPEN","labels":[]}\'; exit 0; fi',
    'if [ "$1" = "label" ] && [ "$2" = "list" ]; then echo migration-granted; echo in-progress; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "list" ]; then cat "$D/runs.json"; exit 0; fi',
    'if [ "$1" = "run" ] && [ "$2" = "view" ]; then f="$D/run-$3.json"; [ -f "$f" ] && { cat "$f"; exit 0; }; exit 1; fi',
    'if [ "$1" = "issue" ] && { [ "$2" = "edit" ] || [ "$2" = "comment" ]; }; then echo "$*" >> "$L"; exit 0; fi',
    'echo "fixture gh: refusing $*" >&2',
    'exit 1',
  ].join('\n') + '\n', { mode: 0o755 });
  return { work, home, bin, head, log, reads };
}

function colab(fx, args, env = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_HUMAN: '1',
      COLAB_SESSION: 'sess-owner-policy-test', COLAB_SESSION_NAME: '', ...env },
  });
  const writes = fs.existsSync(fx.log) ? fs.readFileSync(fx.log, 'utf8') : '';
  const ownerReads = fs.existsSync(fx.reads) ? fs.readFileSync(fx.reads, 'utf8') : '';
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', writes, ownerReads };
}
const mint = (fx) => colab(fx, ['migration-grant', '1', '--branch', BRANCH, '--role', 'migration-reviewer', '--reviewer', 'bot-a',
  '--verdict', 'approve', '--checklist', 'pass', '--escalation', 'data-loss-rule', '--escalation-result', 'clear',
  '--ci-roundtrip', 'pass', '--head', fx.head, '--repo', fx.work]);

const cfgOf = (fx) => (fs.existsSync(path.join(fx.home, 'config.json')) ? JSON.parse(fs.readFileSync(path.join(fx.home, 'config.json'), 'utf8')) : {});

// ---- setting the machine value: a human act ------------------------------------------------------

test('config set migration-grant without COLAB_HUMAN=1 → exit 1, nothing written', () => {
  const fx = fixture();
  const r = colab(fx, ['config', 'set', 'migration-grant', 'reviewer'], { COLAB_HUMAN: '' });
  assert.equal(r.code, 1);
  assert.match(r.err, /requires a human/);
  assert.match(r.err, /COLAB_HUMAN=1 colab config set migration-grant/);
  assert.equal(cfgOf(fx).policy, undefined);
});

test('config set migration-grant with the human assertion records value, who, when, host', () => {
  const fx = fixture();
  const r = colab(fx, ['config', 'set', 'migration-grant', 'reviewer', '--by', 'ada']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^migration-grant \(machine\) = reviewer — set by ada at \d{4}-/);
  const rec = cfgOf(fx).policy['migration-grant'];
  assert.equal(rec.value, 'reviewer');
  assert.equal(rec.by, 'ada');
  assert.match(rec.at, /^\d{4}-\d\d-\d\dT/);
  assert.ok(rec.host);
  const u = colab(fx, ['config', 'set', 'migration-grant', 'unset']);
  assert.equal(u.code, 0, u.err);
  assert.equal(cfgOf(fx).policy, undefined);
});

test('config set migration-grant refuses a bad value and every repo-path flag', () => {
  const fx = fixture();
  const bad = colab(fx, ['config', 'set', 'migration-grant', 'maybe']);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /human \| reviewer \| unset/);
  const repoFlag = colab(fx, ['config', 'set', 'migration-grant', 'reviewer', '--repo', fx.work]);
  assert.equal(repoFlag.code, 1);
  assert.match(repoFlag.err, /MACHINE/);
  assert.equal(cfgOf(fx).policy, undefined);
});

test('the descriptor route is unchanged: config set ship-batch still goes to project.yml', () => {
  const fx = fixture();
  const r = colab(fx, ['config', 'set', 'ship-batch', '2', '--evidence', 'x', '--dry', '--repo', fx.work]);
  assert.match(r.out + r.err, /tuning-only/);
});

// ---- the mint, under each rung --------------------------------------------------------------------

test('machine reviewer + no repo key → a passing reviewer grant mints, naming the machine source', () => {
  const fx = fixture({ machine: 'reviewer' });
  const r = mint(fx);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Recorded a migration-reviewer grant on #1/);
  assert.match(r.out, /Policy source: machine-level migration-grant: reviewer \(set by ada at 2026-10-13/);
  assert.match(r.writes, /issue comment 1 /);
});

test('machine reviewer + repo migration-grant: human → refused, says the repo opted out, nothing written', () => {
  const fx = fixture({ yml: 'migration-grant: human\n', machine: 'reviewer' });
  const r = mint(fx);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /this repo opted out: project.yml declares migration-grant: human/);
  assert.equal(r.writes, '');
});

test('no machine value → the mint refusal is the pre-#596 text, byte for byte', () => {
  const expected = 'this repo\'s migration-grant policy is "human" (absent = human) — a reviewer grant is minted only where project.yml declares migration-grant: reviewer';
  const r = mint(fixture());
  assert.notStrictEqual(r.code, 0);
  assert.ok(r.err.includes(expected), r.err);
  assert.equal(r.writes, '');
});

test('an owner-level reviewer record is retired: not read, not honoured', () => {
  const r = mint(fixture({ owner: [{ value: 'reviewer' }] }));
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /policy is "human" \(absent = human\)/);
  assert.equal(r.ownerReads, '', 'the mint path must not read <owner>/.github');
  assert.equal(r.writes, '');
});

test('migration-grant --list --json names the machine source and who set it', () => {
  const fx = fixture({ machine: 'reviewer' });
  const r = colab(fx, ['migration-grant', '--list', '--json', '--repo', fx.work]);
  assert.equal(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.deepEqual([j.policy.value, j.policy.source, j.policy.by], ['reviewer', 'machine', 'ada']);
});

// ---- the retired owner-policy command ------------------------------------------------------------

test('owner-policy set is retired: exit 1 even as a human, names the machine command, posts nothing', () => {
  const fx = fixture({ owner: [] });
  for (const human of ['1', '']) {
    const r = colab(fx, ['owner-policy', 'set', 'migration-grant', 'reviewer', '--repo', fx.work], { COLAB_HUMAN: human });
    assert.equal(r.code, 1);
    assert.match(r.err, /retired/);
    assert.match(r.err, /colab config set migration-grant/);
    assert.equal(r.writes, '');
  }
});

test('owner-policy show --json reports the owner value as retired and the machine resolution', () => {
  const fx = fixture({ owner: [{ value: 'reviewer' }], machine: 'human' });
  const r = colab(fx, ['owner-policy', 'show', '--json', '--repo', fx.work]);
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.owner.retired, true);
  assert.deepEqual(j.owner['migration-grant'], { value: 'reviewer', by: 'boss', at: '2026-10-01T00:00:00Z' });
  assert.deepEqual([j.resolved['migration-grant'].policy, j.resolved['migration-grant'].source], ['human', 'machine']);
});
