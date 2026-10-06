'use strict';
/**
 * #528 — a person at a plain terminal has no session id.
 *
 * Measured on a clean machine: the trunk `colab claim` refused (#242's gate wants a session),
 * `colab worktree new` warned about a missing holder identity every time, and ship evidence read
 * `implemented by: unknown · shipped by: unknown`. With no --session and COLAB_SESSION UNSET, in a
 * shell that is not an agent's, colab now derives `person:<git user.email or $USER>/<h:token>`.
 *
 * Pure parts first (claim-identity.js, the codec, ship-roles.js), then the real CLI against a real
 * repo and a fake `gh` on PATH; `COLAB_HOME` is private per test.
 *
 * Run: `node --test tools/lib/person-session.test.js`
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const claimIdentity = require('./claim-identity');
const codec = require('./codec/claim');
const { shipRolesSuffix } = require('./ship-roles');

const COLAB = path.resolve(__dirname, '..', 'colab');

// ── pure ──────────────────────────────────────────────────────────────────────────────────────

test('derivation applies only when COLAB_SESSION is UNSET and the shell is not an agent\'s', () => {
  assert.strictEqual(claimIdentity.shouldDerivePersonSession({}), true);
  assert.strictEqual(claimIdentity.shouldDerivePersonSession({ USER: 'ada' }), true);
  assert.strictEqual(claimIdentity.shouldDerivePersonSession({ COLAB_SESSION: '' }), false,
    'an explicit empty COLAB_SESSION is a deliberate "no identity" and is honoured');
  assert.strictEqual(claimIdentity.shouldDerivePersonSession({ COLAB_SESSION: 'x' }), false);
  assert.strictEqual(claimIdentity.shouldDerivePersonSession({ CLAUDECODE: '1' }), false);
  assert.strictEqual(claimIdentity.shouldDerivePersonSession({ AI_AGENT: 'some-agent' }), false);
});

test('derivePersonSession: email wins over user, host is the opaque token, blank when either half is missing', () => {
  const t = 'h:0123456789ab';
  assert.strictEqual(claimIdentity.derivePersonSession({ email: 'ada@example.invalid', user: 'ada', hostToken: t }),
    `person:ada@example.invalid/${t}`);
  assert.strictEqual(claimIdentity.derivePersonSession({ email: '', user: 'ada', hostToken: t }), `person:ada/${t}`);
  assert.strictEqual(claimIdentity.derivePersonSession({ email: '', user: '', hostToken: t }), '');
  assert.strictEqual(claimIdentity.derivePersonSession({ email: 'ada@x', user: 'ada', hostToken: '' }), '');
  assert.strictEqual(claimIdentity.derivePersonSession({ email: 'a b@x', user: '', hostToken: t }), '',
    'a value with whitespace would not survive a claim comment, so nothing is derived');
});

test('a derived id reads as a session id — no #306 warning, and it round-trips a claim comment as the session field', () => {
  const id = 'person:ada@example.invalid/h:0123456789ab';
  assert.strictEqual(claimIdentity.looksLikeSessionId(id), true);
  assert.strictEqual(claimIdentity.isPersonSession(id), true);
  assert.strictEqual(claimIdentity.isPersonSession('https://claude.ai/code/session_x'), false);
  assert.strictEqual(codec.looksLikeSessionId('person:'), false);
  const body = `🔒 Claimed by @ada${codec.encodeSessionField(id, '')}`;
  assert.deepStrictEqual(codec.parseSessionField(body), { sessionName: '', session: id });
});

test('ship evidence names the person instead of "unknown"', () => {
  const p = { session: 'person:ada@example.invalid/h:0123456789ab', sessionName: '' };
  assert.strictEqual(shipRolesSuffix(p, p),
    ' · implemented and shipped by the same session person:ada@example.invalid/h:0123456789ab');
  assert.doesNotMatch(shipRolesSuffix(p, { session: 'https://claude.ai/code/session_y' }), /unknown/);
});

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fakeGh(root) {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const args = process.argv.slice(2);
const out = (s) => { if (s) process.stdout.write(s); process.exit(0); };
if (args[0] === '--version') out('gh version 2.0.0 (fake)\\n');
if (args[0] === 'auth') out('Logged in (fake)\\n');
if (args[0] === 'issue' && args[1] === 'list') out('[]\\n');
if (args[0] === 'issue' && args[1] === 'view') out('{"state":"OPEN","comments":[],"labels":[],"assignees":[]}\\n');
if (args[0] === 'api' && args.includes('user')) out('octofake\\n');
out('');
`, { mode: 0o755 });
  return bin;
}

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'colab-person-')));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'ada@example.invalid');
  g(work, 'config', 'user.name', 'person test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'));
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: test\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  return { root, work, home, ghBin: fakeGh(root) };
}

/** A plain terminal: no COLAB_SESSION at all, no agent markers — unless `env` adds them. */
function colab(fx, args, env = {}) {
  const base = { ...process.env, PATH: `${fx.ghBin}:${process.env.PATH}`, COLAB_HOME: fx.home };
  for (const k of ['COLAB_SESSION', 'COLAB_SESSION_NAME', 'CLAUDECODE', 'AI_AGENT', 'CLAUDE_PID', 'COLAB_HUMAN']) delete base[k];
  const r = spawnSync('node', [COLAB, ...args], { cwd: fx.work, encoding: 'utf8', env: { ...base, ...env } });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const claimRows = (fx) => Object.values(JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8')).claims);
const warnings = (err) => err.split('\n').filter((l) => l.startsWith('!'));

test('a person\'s trunk `colab claim` succeeds with no --session, records the derived id, and says once that it derived it', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '7']);
  assert.strictEqual(r.code, 0, r.err);
  const [row] = claimRows(fx);
  assert.match(row.session, /^person:ada@example\.invalid\/h:[0-9a-f]{12}$/);
  assert.strictEqual((r.err.match(/\(derived/g) || []).length, 1, r.err);
  assert.deepStrictEqual(warnings(r.err), [], r.err);
});

test('the explicit --session still wins over the derived id', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '7', '--session', 'https://claude.ai/code/session_abc']);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(claimRows(fx)[0].session, 'https://claude.ai/code/session_abc');
  assert.doesNotMatch(r.err, /derived/);
});

test('COLAB_SESSION wins too, and an explicit empty COLAB_SESSION still refuses the trunk claim (#242)', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '7'], { COLAB_SESSION: 'stable-id' });
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(claimRows(fx)[0].session, 'stable-id');
  const fx2 = fixture();
  const r2 = colab(fx2, ['claim', '7'], { COLAB_SESSION: '' });
  assert.notStrictEqual(r2.code, 0);
  assert.match(r2.err, /no --session given/);
});

test('an agent shell derives nothing — #242\'s refusal stands for it', () => {
  const fx = fixture();
  const r = colab(fx, ['claim', '7'], { CLAUDECODE: '1' });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /no --session given/);
});

test('a person\'s `colab worktree new` succeeds with no identity warnings', () => {
  const fx = fixture();
  const r = colab(fx, ['worktree', 'new', 'fix/thing-7', '--issues', '7']);
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(warnings(r.err), [], r.err);
  assert.match(claimRows(fx)[0].session, /^person:ada@example\.invalid\//);
});
