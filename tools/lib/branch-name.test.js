'use strict';
/**
 * Tests for lib/branch-name.js — CONVENTIONS.md §4's branch shape, both of them (#348) — and for the
 * readers that key on it: shipguard (type + issue harvest), the audit's naming advisory and its
 * `branchPrefix` enum check, and the opt-in templates/branch-name.yml.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const bn = require('./branch-name');
const shipguard = require('./shipguard');
const stamp = require('./stamp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// --- parse / format round-trip, both shapes -----------------------------------------------------

const ROUND_TRIP = [
  ['feat/onboard-redesign-23', { login: null, machine: null, type: 'feat', slug: 'onboard-redesign', issues: [23] }],
  ['fix/import-fixes-115-114-113', { login: null, machine: null, type: 'fix', slug: 'import-fixes', issues: [115, 114, 113] }],
  ['ada/box-a/feat/onboard-redesign-23', { login: 'ada', machine: 'box-a', type: 'feat', slug: 'onboard-redesign', issues: [23] }],
  ['ada/box-a/fix/import-fixes-115-114-113', { login: 'ada', machine: 'box-a', type: 'fix', slug: 'import-fixes', issues: [115, 114, 113] }],
];

for (const [name, want] of ROUND_TRIP) {
  test(`parse ↔ format round-trips ${name}`, () => {
    const p = bn.parse(name);
    assert.ok(p, `${name} should conform`);
    for (const [k, v] of Object.entries(want)) assert.deepStrictEqual(p[k], v, k);
    assert.strictEqual(p.prefixed, Boolean(want.login));
    assert.strictEqual(bn.format(p), name);
  });
}

test('a four-segment name is the prefixed shape — `test/box/feat/x-1` is login `test`, type `feat`', () => {
  const p = bn.parse('test/box/feat/x-1');
  assert.strictEqual(p.login, 'test');
  assert.strictEqual(p.machine, 'box');
  assert.strictEqual(p.type, 'feat');
});

test('the trailing run is the only issue source — `feat/oauth2-login-88` is [88], prefix or not', () => {
  assert.deepStrictEqual(bn.parse('feat/oauth2-login-88').issues, [88]);
  assert.deepStrictEqual(bn.parse('ada/box2/feat/oauth2-login-88').issues, [88]);
  assert.deepStrictEqual(bn.branchIssueNumbers('ada/box-a/fix/import-fixes-115-114-113'), [115, 114, 113]);
});

test('non-conforming names parse to null', () => {
  for (const bad of ['feat/a/b', 'ada/feat/x-1', 'trunk', 'main', 'ada/box-a/nope/x-1', 'Ada/box/feat/x-1', 'ada/box/feat/X-1', '-a/box/feat/x-1']) {
    assert.strictEqual(bn.parse(bad), null, bad);
  }
});

// --- machine label, worktree name, session branch ----------------------------------------------

test('machineLabel: canonical host, [a-z0-9-] only', () => {
  assert.strictEqual(bn.machineLabel('Box_A.local'), 'box-a');
  assert.strictEqual(bn.machineLabel('devbox.hsd1.example.net.'), 'devbox');
  assert.strictEqual(bn.machineLabel(''), '');
});

test('worktreeName: the <slug>-<N> for both shapes; after-first-slash for grandfathered names', () => {
  assert.strictEqual(bn.worktreeName('feat/x-23'), 'x-23');
  assert.strictEqual(bn.worktreeName('ada/box-a/feat/x-23'), 'x-23');
  assert.strictEqual(bn.worktreeName('feature/Old_Name'), 'Old_Name');
  assert.strictEqual(bn.worktreeName('plain'), 'plain');
});

test('sessionBranch: not adopted → the name, untouched, whatever its shape', () => {
  assert.deepStrictEqual(bn.sessionBranch('feat/x-9', { adopted: false, login: 'me', machine: 'box' }), { branch: 'feat/x-9' });
  assert.deepStrictEqual(bn.sessionBranch('Weird_Old', { adopted: false }), { branch: 'Weird_Old' });
});

test('sessionBranch: adopted → prefix prepended (login lowercased); an existing matching prefix kept', () => {
  assert.deepStrictEqual(bn.sessionBranch('feat/x-9', { adopted: true, login: 'Ada', machine: 'box-a' }), { branch: 'ada/box-a/feat/x-9' });
  assert.deepStrictEqual(bn.sessionBranch('ada/box-a/feat/x-9', { adopted: true, login: 'ada', machine: 'box-a' }), { branch: 'ada/box-a/feat/x-9' });
  // No login (tracker down): an explicit prefix for THIS machine still works — #325, an outage never blocks a claim.
  assert.deepStrictEqual(bn.sessionBranch('ada/box-a/feat/x-9', { adopted: true, login: null, machine: 'box-a' }), { branch: 'ada/box-a/feat/x-9' });
});

test('sessionBranch: adopted → refuses a non-conforming name, another machine, another login, an unknown login', () => {
  assert.match(bn.sessionBranch('feature/x', { adopted: true, login: 'ada', machine: 'box-a' }).error, /does not match/);
  assert.match(bn.sessionBranch('ada/box-b/feat/x-9', { adopted: true, login: 'ada', machine: 'box-a' }).error, /names machine "box-b"/);
  assert.match(bn.sessionBranch('bob/box-a/feat/x-9', { adopted: true, login: 'ada', machine: 'box-a' }).error, /names login "bob"/);
  assert.match(bn.sessionBranch('feat/x-9', { adopted: true, login: null, machine: 'box-a' }).error, /could not be resolved.*ada|<login>\/box-a\/feat\/x-9/);
  assert.match(bn.sessionBranch('feat/x-9', { adopted: true, login: 'ada', machine: '' }).error, /machine label/);
});

// --- readers: shipguard ------------------------------------------------------------------------

test('shipguard.branchType reads the TYPE of a prefixed branch, never the login', () => {
  assert.strictEqual(shipguard.branchType('ada/box-a/fix/x-1'), 'fix');
  assert.strictEqual(shipguard.branchType('fix/x-1'), 'fix');
  assert.strictEqual(shipguard.branchType('feature/legacy'), 'feature', 'grandfathered names keep the old read');
  const parseSubject = (s) => ({ type: s.split(':')[0] });
  const f = shipguard.subjectSanity({ subject: 'fix: x', branchName: 'ada/box-a/fix/x-1', chosenFiles: ['a'], branchFiles: ['a'], commitCount: 1, parseSubject });
  assert.ok(!f.some((x) => x.kind === 'type-mismatch'), JSON.stringify(f));
});

test('shipguard.branchIssueNumbers is the same function as branch-name\'s', () => {
  assert.strictEqual(shipguard.branchIssueNumbers, bn.branchIssueNumbers);
});

// --- one regex, three homes: the drift guard ---------------------------------------------------

test('the §4 regex is byte-identical in CONVENTIONS.md §4, CLAUDE.md, audit/README.md and templates/branch-name.yml', () => {
  for (const f of ['CONVENTIONS.md', 'CLAUDE.md', 'audit/README.md', 'templates/branch-name.yml']) {
    const text = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
    assert.ok(text.includes(bn.BRANCH_RE_SOURCE), `${f} no longer carries lib/branch-name.js's regex verbatim — one of them drifted`);
  }
});

test('the template\'s regex, run by bash, accepts both shapes and rejects the rest', (t) => {
  const bash = ['/bin/bash', '/usr/bin/bash'].find((b) => fs.existsSync(b));
  if (!bash) return t.skip('no bash');
  const check = (b) => execFileSync(bash, ['-c', `RE='${bn.BRANCH_RE_SOURCE}'; [[ "$1" =~ $RE ]] && echo y || echo n`, '_', b], { encoding: 'utf8' }).trim();
  for (const [name] of ROUND_TRIP) assert.strictEqual(check(name), 'y', name);
  for (const bad of ['feat/a/b', 'ada/feat/x-1', 'trunk']) assert.strictEqual(check(bad), 'n', bad);
});

test('templates/branch-name.yml is attributed to branch-name by the workflow fingerprints', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'branch-name.yml'), 'utf8');
  const prov = stamp.workflowProvenance(text, 'branch-name', new Set(['branch-name']));
  assert.strictEqual(prov.origin, 'derived');
  assert.strictEqual(prov.template, 'branch-name');
  assert.ok(text.includes('BRANCH: ${{ github.head_ref }}') && !/run:[^\n]*github\.head_ref/.test(text),
    'the head ref reaches the script only through env:');
});

// --- readers: the audit ------------------------------------------------------------------------

function fixture(projectYml, extraBranches = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-name-audit-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  for (const b of extraBranches) g('branch', b);
  return dir;
}

function audit(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) { stdout = err.stdout || ''; }
  const r = JSON.parse(stdout).results[0];
  return {
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const TIER_B = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

test('audit: both §4 shapes are on-convention; a half prefix still warns', () => {
  const r = audit(fixture(TIER_B, ['feat/x-1', 'ada/box-a/fix/y-2', 'ada/feat/z-3']));
  const naming = r.warns.filter((w) => /off-convention/.test(w));
  assert.strictEqual(naming.length, 1, r.warns.join(' | '));
  assert.ok(naming[0].includes('ada/feat/z-3'));
  assert.ok(!naming[0].includes('feat/x-1,') && !naming[0].includes('ada/box-a/fix/y-2'), naming[0]);
  assert.match(naming[0], /<login>\/<machine>\/<type>\/<slug>/);
});

test('audit: branchPrefix accepts `machine` and fails anything else', () => {
  assert.ok(!audit(fixture(TIER_B + 'branchPrefix: machine\n')).fails.some((f) => /branchPrefix/.test(f)));
  const r = audit(fixture(TIER_B + 'branchPrefix: host\n'));
  assert.ok(r.fails.some((f) => /branchPrefix is "host"/.test(f)), r.fails.join(' | '));
});
