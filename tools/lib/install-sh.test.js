'use strict';
// install.sh as a release artifact (#341). Its last substantive edit sat six weeks behind the CLI
// it installs, and nothing noticed: the frozen-source list omitted a file freeze_cli copies, the
// "next" block named three commands out of thirty, and an old frozen copy reported nothing. These
// tests hold install.sh to the CLI mechanically, so the next drift fails a build instead of a
// service.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const stamp = require('./stamp');
const check = require('./install-check');

const ROOT = path.resolve(__dirname, '..', '..');
const INSTALL = path.join(ROOT, 'install.sh');
const installText = fs.readFileSync(INSTALL, 'utf8');
const cliText = fs.readFileSync(path.join(ROOT, 'tools', 'colab'), 'utf8');

// Every dispatched command that deliberately has NO line in install.sh's "next" block, with why.
// Adding a command to tools/colab fails the test below until it gets a "next" line or an entry here —
// that entry IS the "records why it does not" the release-artifact rule asks for.
const NOT_IN_NEXT = {
  help: 'reached as `colab --help`, which is in the block',
  version: 'provenance query, not a setup step — README step 3 covers it',
  claim: 'per-session flow, driven by the code-start skill',
  release: 'per-session flow, driven by code-wrap / code-ship',
  claims: 'per-session flow, read by code-triage',
  'issue-filed': 'notify event emitted by code-start, never typed by a new user',
  'gate-recorded': 'notify event emitted by the skills, never typed by a new user',
  solo: 'per-session entry gate, needs a live human — not a setup step',
  place: 'per-session place-claim primitive',
  places: 'per-session place-claim listing',
  readiness: 'per-issue triage query',
  blocked: 'per-issue dependency-edge write',
  'migration-grant': 'human-only per-branch gate, not a setup step',
  decision: 'per-issue ruling record',
  'ci-grant': 'human-only per-branch gate, not a setup step',
  port: 'allocated by `worktree new`; hand use is rare',
  ports: 'diagnostic listing',
  worktree: 'per-session, driven by code-start',
  worktrees: 'per-session listing',
  ship: 'Phase B, driven by code-ship',
  landed: 'per-branch query used by code-sweep',
  holders: 'per-file query used by code-start',
  promote: 'human release act, never a first-run step',
  doctor: 'maintenance of claims/worktrees that a fresh machine does not have yet',
  'release-notes': 'release-time tool',
  'release-status': 'release-time report across tag-gated repos',
  template: 'optional per-repo copy, pointed to by §9 adoption, not by machine setup',
  config: 'register writes the one config key a new machine needs',
};

function nextBlockCommands(text) {
  const start = text.indexOf('echo "next"');
  assert.ok(start >= 0, 'install.sh has no "next" block');
  const out = new Set();
  for (const m of text.slice(start).matchAll(/echo "\s+colab ([a-z][a-z-]*)/g)) out.add(m[1]);
  return out;
}

test('every command the CLI dispatches is in the "next" block or recorded as deliberately not', () => {
  const cmds = check.dispatchedCommands(cliText);
  assert.ok(cmds.length > 20, `dispatch extraction found only ${cmds.length} commands — has main() changed shape?`);
  const next = nextBlockCommands(installText);
  const unaccounted = cmds.filter((c) => !next.has(c) && !(c in NOT_IN_NEXT));
  assert.deepStrictEqual(unaccounted, [],
    `new command(s) with no "next" line in install.sh and no reason in NOT_IN_NEXT: ${unaccounted.join(', ')}`);
});

test('NOT_IN_NEXT and the "next" block name only commands that exist, and never the same one twice', () => {
  const cmds = new Set(check.dispatchedCommands(cliText));
  const next = nextBlockCommands(installText);
  assert.deepStrictEqual([...next].filter((c) => !cmds.has(c)), [], 'install.sh "next" names a command the CLI does not dispatch');
  assert.deepStrictEqual(Object.keys(NOT_IN_NEXT).filter((c) => !cmds.has(c)), [], 'stale NOT_IN_NEXT entry');
  assert.deepStrictEqual(Object.keys(NOT_IN_NEXT).filter((c) => next.has(c)), [], 'command both in "next" and in NOT_IN_NEXT');
});

test('the "next" block names what a new machine needs: register, adopt, labels', () => {
  const next = nextBlockCommands(installText);
  for (const c of ['register', 'adopt', 'labels']) assert.ok(next.has(c), `"next" is missing colab ${c}`);
});

test('FROZEN_SOURCES covers every path freeze_cli copies', () => {
  const body = installText.slice(installText.indexOf('freeze_cli() {'));
  const fnBody = body.slice(0, body.indexOf('\n}\n'));
  const copied = new Set();
  for (const line of fnBody.split('\n').filter((l) => /^\s*cp\b/.test(l))) {
    if (line.includes('"$TOOL_SRC"')) copied.add('tools/colab');
    for (const m of line.matchAll(/"\$DIR\/(tools\/[^"]+)"/g)) copied.add(m[1]);
  }
  assert.ok(copied.size >= 3, `parsed only ${[...copied].join(', ')} from freeze_cli`);
  assert.deepStrictEqual([...copied].sort(), [...stamp.FROZEN_SOURCES].sort());
});

test('dispatchedCommands reads only main()\'s switch, not a helper that also uses case', () => {
  const src = [
    "function helper(x) { switch (x) {",
    "    case 'room': return 1;",
    "} }",
    "function main(argv) {",
    "  switch (argv[0]) {",
    "    case 'claim': return cmdClaim(rest);",
    "    case '-h': case '--help': case 'help': return print(HELP_ROOT);",
    "    default:",
    "    case 'after-default': return 0;",
  ].join('\n');
  assert.deepStrictEqual(check.dispatchedCommands(src), ['claim', 'help']);
  assert.deepStrictEqual(check.dispatchedCommands('no main here'), []);
});

// --- the check rows, against throwaway directories ----------------------------------------------

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-install-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/** A throwaway handbook with tags, same shape as stamp.test.js — no dependency on this checkout's tags. */
function tempHandbook(t) {
  const root = tmp(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('config', 'core.hooksPath', path.join(root, '.nohooks')); // see orphan-worktree.test.js (#108)
  const cli = (cmds) => `function main(argv) {\n  switch (argv[0]) {\n${cmds.map((c) => `    case '${c}': return 0;`).join('\n')}\n    default:\n  }\n}\n`;
  write('tools/colab', cli(['claim']));
  write('tools/lib/state.js', 'module.exports = {};\n');
  write('tools/package.json', '{}\n');
  git('add', '-A'); git('commit', '-qm', 'init'); git('tag', 'v1.0.0');
  return { root, git, write, cli, commit: (msg) => { git('add', '-A'); git('commit', '-qm', msg); } };
}

function freezeInto(colabHome, cliText, version) {
  const dir = path.join(colabHome, 'bin');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'colab'), cliText);
  fs.writeFileSync(path.join(dir, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'STAMP'), `# colab-handbook: colab-bin @ ${version}\n`);
}

test('an old COMPLETE frozen copy is ✗ behind and names the commands it does not dispatch', (t) => {
  const h = tempHandbook(t);
  const home = tmp(t);
  freezeInto(home, h.cli(['claim']), 'v1.0.0');
  h.write('tools/colab', h.cli(['claim', 'adopt', 'register']));
  h.commit('feat: two commands'); h.git('tag', 'v1.1.0');

  const rows = check.checkFrozen({ root: h.root, colabHome: home });
  assert.ok(rows.every((r) => r.severity === check.FAIL), JSON.stringify(rows));
  assert.match(rows[0].text, /behind — stamped v1\.0\.0/);
  assert.match(rows[1].text, /2 command\(s\) the tree does: adopt, register/);
});

test('unreleased commands in the tree are ⚠, not ✗ — a maintainer\'s resting state is not a failure', (t) => {
  const h = tempHandbook(t);
  const home = tmp(t);
  freezeInto(home, h.cli(['claim']), 'v1.0.0');
  h.write('tools/colab', h.cli(['claim', 'adopt']));
  h.commit('feat: unreleased');

  const rows = check.checkFrozen({ root: h.root, colabHome: home });
  assert.deepStrictEqual(rows.map((r) => r.severity), [check.WARN, check.WARN]);
  assert.match(rows[1].text, /adopt/);
});

test('a current frozen copy is ✓; a copy with no STAMP or a partial copy is ✗', (t) => {
  const h = tempHandbook(t);
  const home = tmp(t);
  freezeInto(home, h.cli(['claim']), 'v1.0.0');
  assert.deepStrictEqual(check.checkFrozen({ root: h.root, colabHome: home }).map((r) => r.severity), [check.OK]);

  fs.rmSync(path.join(home, 'bin', 'package.json'));
  assert.ok(check.checkFrozen({ root: h.root, colabHome: home }).some((r) => r.severity === check.FAIL && /partial copy/.test(r.text)));

  fs.rmSync(path.join(home, 'bin', 'STAMP'));
  const noStamp = check.checkFrozen({ root: h.root, colabHome: home });
  assert.strictEqual(noStamp.length, 1);
  assert.strictEqual(noStamp[0].severity, check.FAIL);

  const empty = tmp(t);
  assert.strictEqual(check.checkFrozen({ root: h.root, colabHome: empty })[0].severity, check.WARN);
});

test('state: absent is ✗ only once a CLI is installed; unparseable is ✗', (t) => {
  const home = tmp(t);
  const colabHome = path.join(home, '.colab');
  assert.strictEqual(check.checkState({ colabHome, home }).severity, check.WARN);
  freezeInto(colabHome, '', 'v1.0.0');
  assert.strictEqual(check.checkState({ colabHome, home }).severity, check.FAIL);
  fs.writeFileSync(path.join(colabHome, 'state.json'), '{"claims":{},"worktrees":{}}\n');
  assert.strictEqual(check.checkState({ colabHome, home }).severity, check.OK);
  fs.writeFileSync(path.join(colabHome, 'state.json'), '{nope');
  assert.strictEqual(check.checkState({ colabHome, home }).severity, check.FAIL);
});

test('fleet: never set up is ⚠; a placeholder-only list is ✗ (the --fleet dead end); hand-edited drift is ⚠', (t) => {
  const colabHome = tmp(t);
  assert.strictEqual(check.checkFleet({ colabHome })[0].severity, check.WARN);

  fs.copyFileSync(path.join(ROOT, 'audit', 'repos.txt'), path.join(colabHome, 'repos.txt'));
  const seeded = check.checkFleet({ colabHome });
  assert.strictEqual(seeded[0].severity, check.FAIL, 'the committed example must register nothing');
  assert.match(seeded[0].text, /colab register/);

  fs.appendFileSync(path.join(colabHome, 'repos.txt'), '/srv/a\nowner/remote-only\n');
  const drift = check.checkFleet({ colabHome });
  assert.deepStrictEqual(drift.map((r) => r.severity), [check.OK, check.WARN]);

  fs.writeFileSync(path.join(colabHome, 'config.json'), JSON.stringify({ repos: ['/srv/a'] }));
  assert.deepStrictEqual(check.checkFleet({ colabHome }).map((r) => r.severity), [check.OK]);
});

test('hooks: enabled with no vocabulary and no gitleaks fails BOTH rows — neither dependency is quieter', (t) => {
  const h = tempHandbook(t);
  const home = tmp(t);
  const env = { PATH: '', HOME: home };
  assert.strictEqual(check.checkHooks({ root: h.root, colabHome: home, home, env })[0].severity, check.WARN,
    'core.hooksPath pointing elsewhere = not enabled');

  h.git('config', 'core.hooksPath', '.githooks');
  const rows = check.checkHooks({ root: h.root, colabHome: home, home, env });
  assert.deepStrictEqual(rows.map((r) => r.severity), [check.FAIL, check.FAIL]);
  assert.match(rows[1].text, /identity vocabulary/);

  fs.writeFileSync(path.join(home, 'identity-vocabulary'), 'example\n');
  const withVocab = check.checkHooks({ root: h.root, colabHome: home, home, env });
  assert.strictEqual(withVocab[1].severity, check.OK);
});

// --- install.sh itself, end to end, in a throwaway HOME -----------------------------------------

function runInstall(home, args) {
  const env = {
    ...process.env,
    HOME: home,
    COLAB_HOME: path.join(home, '.colab'),
    // Pin core.hooksPath off for the clone under test: a developer's own clone may have --hooks
    // enabled, and the hooks row must not make this test machine-dependent.
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '',
  };
  delete env.COLAB_IDENTITY_VOCAB;
  return spawnSync('bash', [INSTALL, ...args], { encoding: 'utf8', env });
}

test('install.sh --check on a machine with nothing installed: only ⚠ rows, exit 0, nothing written', (t) => {
  const home = tmp(t);
  const r = runInstall(home, ['--check']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /⚠ frozen/);
  assert.match(r.stdout, /⚠ state/);
  assert.doesNotMatch(r.stdout, /^\s+✗ /m, "a ✗ row"); // the summary line itself says "no ✗ rows"
  // Only paths install.sh owns. The preflight's `gh auth status` writes gh's own
  // ~/.local/state/gh/device-id, which is gh's doing and predates --check.
  for (const p of ['.colab', '.claude', path.join('.local', 'bin')]) {
    assert.ok(!fs.existsSync(path.join(home, p)), `--check wrote ${p} into HOME`);
  }
});

test('install.sh --check refuses to combine with an install flag', (t) => {
  const r = runInstall(tmp(t), ['--check', '--tools']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /takes no other flag/);
});

test('install.sh --check exits 1 on a frozen copy that install.sh did not write', (t) => {
  const home = tmp(t);
  fs.mkdirSync(path.join(home, '.colab', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, '.colab', 'bin', 'colab'), '#!/bin/sh\n');
  const r = runInstall(home, ['--check']);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /✗ frozen .*no STAMP/);
});

test('install.sh --tools --fleet creates an empty state file, never overwrites one, and points at register', (t) => {
  const home = tmp(t);
  const r = runInstall(home, ['--tools', '--fleet']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const stateFile = path.join(home, '.colab', 'state.json');
  assert.ok(JSON.parse(fs.readFileSync(stateFile, 'utf8')));
  assert.match(r.stdout, /colab register \/path\/to\/repo/);

  fs.writeFileSync(stateFile, '{"version":1,"claims":{"x":{}},"worktrees":{}}\n');
  runInstall(home, ['--tools']);
  assert.match(fs.readFileSync(stateFile, 'utf8'), /"x"/, 'a second --tools overwrote live state');

  // The frozen copy refuses `template` with a reason, rather than failing on a missing directory.
  const tpl = spawnSync(path.join(home, '.colab', 'bin', 'colab'), ['template'],
    { encoding: 'utf8', env: { ...process.env, HOME: home, COLAB_HOME: path.join(home, '.colab') } });
  assert.strictEqual(tpl.status, 1);
  assert.match(tpl.stderr, /frozen copy .* no templates\//);
});
