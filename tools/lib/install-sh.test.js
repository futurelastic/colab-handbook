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
const engines = require('./engines');

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
  close: 'per-issue close outside a ship, driven by the skills (#381)',
  claims: 'per-session flow, read by code-triage',
  'trunk-ci': 'read-only trunk-CI verdict, called by code-triage / code-sweep / code-ship (#463)',
  'ci-wait': 'per-run CI wait, called by code-ship / code-sweep / code-wrap (#495)',
  'issue-filed': 'notify event emitted by code-start, never typed by a new user',
  'gate-recorded': 'notify event emitted by the skills, never typed by a new user',
  'gate-hermetic': 'per-session test run, driven by code-wrap A3 (#403)',
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
  'batch-stats': 'per-repo tuning report for ship-batch knobs, read when a repo picks its values (#554)',
  'ci-profile': 'per-repo CI-duration report; ci-wait reads the same bounds itself (#559)',
  thresholds: 'per-repo advisory-threshold report, read by code-triage / code-wrap (#560)',
  promote: 'human release act, never a first-run step',
  deliver: 'human act on a repo the fleet does not own (project.yml owner:), never a first-run step (#394)',
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

test('fleet: never set up is ⚠; a placeholder-only list is ⚠ too (not set up yet, #521); hand-edited drift is ⚠', (t) => {
  const colabHome = tmp(t);
  assert.strictEqual(check.checkFleet({ colabHome })[0].severity, check.WARN);

  fs.copyFileSync(path.join(ROOT, 'audit', 'repos.txt'), path.join(colabHome, 'repos.txt'));
  const seeded = check.checkFleet({ colabHome });
  assert.strictEqual(seeded[0].severity, check.WARN, 'the committed example registers nothing, and that is not a failure');
  assert.match(seeded[0].text, /placeholders only/, 'the committed example must register nothing');
  assert.match(seeded[0].text, /colab register/);

  fs.appendFileSync(path.join(colabHome, 'repos.txt'), '/srv/a\nowner/remote-only\n');
  const drift = check.checkFleet({ colabHome });
  assert.deepStrictEqual(drift.map((r) => r.severity), [check.OK, check.WARN]);

  fs.writeFileSync(path.join(colabHome, 'config.json'), JSON.stringify({ repos: ['/srv/a'] }));
  assert.deepStrictEqual(check.checkFleet({ colabHome }).map((r) => r.severity), [check.OK]);
});

test('hooks: enabled with no vocabulary and no gitleaks warns on BOTH rows — neither quieter, neither ✗ (#521)', (t) => {
  const h = tempHandbook(t);
  const home = tmp(t);
  const env = { PATH: '', HOME: home };
  assert.strictEqual(check.checkHooks({ root: h.root, colabHome: home, home, env })[0].severity, check.WARN,
    'core.hooksPath pointing elsewhere = not enabled');

  h.git('config', 'core.hooksPath', '.githooks');
  const rows = check.checkHooks({ root: h.root, colabHome: home, home, env });
  assert.deepStrictEqual(rows.map((r) => r.severity), [check.WARN, check.WARN]);
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
    // Never let a test move THIS checkout: a fresh HOME on a trunk checkout at origin's tip is exactly
    // the first-install shape that pins a release (#521). The ref step has its own tests below.
    COLAB_INSTALL_REF: 'keep',
  };
  delete env.COLAB_IDENTITY_VOCAB;
  delete env.COLAB_INSTALL_REEXEC;
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
  for (const p of ['.colab', '.claude', '.agents', path.join('.local', 'bin')]) {
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

// #414 — a new machine with a local observer either gets notifyUrl or is told plainly it did not.
test('install.sh --tools seeds notifyUrl from a declared endpoint; says plainly when there is none', (t) => {
  const bare = tmp(t);
  const r0 = runInstall(bare, ['--tools']);
  assert.strictEqual(r0.status, 0, r0.stdout + r0.stderr);
  assert.match(r0.stdout, /notifyUrl is UNSET/);
  const cfg0 = path.join(bare, '.colab', 'config.json');
  assert.ok(!fs.existsSync(cfg0) || !JSON.parse(fs.readFileSync(cfg0, 'utf8')).notifyUrl, 'seeded with nothing to seed from');

  const home = tmp(t);
  fs.mkdirSync(path.join(home, '.colab'), { recursive: true });
  fs.writeFileSync(path.join(home, '.colab', 'notify-endpoint'), 'http://127.0.0.1:9000/api/events\n');
  const r = runInstall(home, ['--tools']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /notifyUrl seeded: http:\/\/127\.0\.0\.1:9000\/api\/events/);
  const cfg = JSON.parse(fs.readFileSync(path.join(home, '.colab', 'config.json'), 'utf8'));
  assert.strictEqual(cfg.notifyUrl, 'http://127.0.0.1:9000/api/events');
});

test('install.sh --notify-url seeds without --tools, then only ADDS — never removes or rewrites an entry (#546)', (t) => {
  const home = tmp(t);
  const r = runInstall(home, ['--notify-url', 'http://127.0.0.1:9000/api/events']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const cfgFile = path.join(home, '.colab', 'config.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).notifyUrl, 'http://127.0.0.1:9000/api/events');

  // Same URL again: nothing to add, on-disk value still the plain string.
  const same = runInstall(home, ['--notify-url', 'http://127.0.0.1:9000/api/events']);
  assert.strictEqual(same.status, 0, same.stdout + same.stderr);
  assert.match(same.stdout, /already set → left untouched/);
  assert.strictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).notifyUrl, 'http://127.0.0.1:9000/api/events');

  // A second observer's URL is added after the first, which stays first and untouched.
  const again = runInstall(home, ['--notify-url=http://127.0.0.1:9001/api/events']);
  assert.strictEqual(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /added http:\/\/127\.0\.0\.1:9001\/api\/events/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).notifyUrl,
    ['http://127.0.0.1:9000/api/events', 'http://127.0.0.1:9001/api/events']);
});

test('install.sh --notify-url refuses a non-http value before installing anything', (t) => {
  const home = tmp(t);
  const r = runInstall(home, ['--tools', '--notify-url', 'localhost:9000']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /must be an http\(s\) URL/);
  assert.ok(!fs.existsSync(path.join(home, '.claude')), 'installed skills before refusing');
});

// --- #521: which ref a new machine installs ---------------------------------------------------------

/**
 * A throwaway "handbook" with a remote: v1.0.0 carries a stub installer that only echoes its argv
 * (so a re-exec is observable), v1.1.0-rc.1 sits above it, and trunk runs ahead of both with the
 * real install.sh. Returns a fresh clone of trunk — the exact state the README's clone step leaves.
 */
function releasedHandbook(t) {
  const base = tmp(t);
  const origin = path.join(base, 'origin');
  const clone = path.join(base, 'clone');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (rel, text, mode) => {
    fs.mkdirSync(path.dirname(path.join(origin, rel)), { recursive: true });
    fs.writeFileSync(path.join(origin, rel), text);
    if (mode) fs.chmodSync(path.join(origin, rel), mode);
  };
  fs.mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'user.email', 'test@example.invalid');
  git(origin, 'config', 'user.name', 'test');
  git(origin, 'config', 'core.hooksPath', path.join(origin, '.nohooks'));
  write('.github/project.yml', 'trunk: main\n');
  write('skills/demo/SKILL.md', '---\nname: demo\n---\n');
  write('tools/package.json', '{"engines":{"node":">=18"}}\n');
  write('install.sh', '#!/usr/bin/env bash\necho "OLD INSTALLER args:[$*] reexec:[$COLAB_INSTALL_REEXEC]"\n', 0o755);
  git(origin, 'add', '-A'); git(origin, 'commit', '-qm', 'v1'); git(origin, 'tag', 'v1.0.0');
  write('skills/demo/SKILL.md', '---\nname: demo\n---\nrc\n');
  git(origin, 'add', '-A'); git(origin, 'commit', '-qm', 'rc'); git(origin, 'tag', 'v1.1.0-rc.1');
  write('install.sh', installText, 0o755);
  // The real installer reads its install targets from engines/ (#530); trunk ships them beside it.
  for (const f of fs.readdirSync(path.join(ROOT, 'engines'))) write(`engines/${f}`, fs.readFileSync(path.join(ROOT, 'engines', f), 'utf8'));
  git(origin, 'add', '-A'); git(origin, 'commit', '-qm', 'trunk work');
  execFileSync('git', ['clone', '-q', origin, clone], { stdio: 'ignore' });
  return { clone, git: (...a) => git(clone, ...a) };
}

function runClone(clone, home, args, extraEnv = {}) {
  const env = {
    ...process.env, HOME: home, COLAB_HOME: path.join(home, '.colab'),
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '',
    ...extraEnv,
  };
  delete env.COLAB_INSTALL_REF; delete env.COLAB_INSTALL_REEXEC;
  Object.assign(env, extraEnv);
  return spawnSync('bash', [path.join(clone, 'install.sh'), ...args], { encoding: 'utf8', env });
}

test('#521: a first install from a fresh clone of trunk pins the newest FINAL tag and hands over to its installer', (t) => {
  const h = releasedHandbook(t);
  const r = runClone(h.clone, tmp(t), ['--tools', '--hooks']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /first install from a fresh clone of main → pinning the newest final release/);
  assert.strictEqual(h.git('describe', '--tags', '--exact-match'), 'v1.0.0', 'not the rc, not trunk');
  assert.match(r.stdout, /OLD INSTALLER args:\[--tools --hooks\] reexec:\[1\]/, 'did not re-exec the tag\'s own installer with the flags');
});

test('#521: --trunk (or the env) keeps a fresh clone on trunk; --release afterwards moves it to the release', (t) => {
  const h = releasedHandbook(t);
  const home = tmp(t);
  const r = runClone(h.clone, home, ['--trunk']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ trunk main @ v1\.1\.0-rc\.1-1-g[0-9a-f]+ — unreleased work included/);
  assert.strictEqual(h.git('symbolic-ref', '--short', 'HEAD'), 'main');
  assert.ok(fs.lstatSync(path.join(home, '.claude', 'skills', 'demo')).isSymbolicLink());

  // Installed on trunk now: a flagless re-run keeps it and says how to pin a release.
  const again = runClone(h.clone, home, []);
  assert.strictEqual(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /main @ v1\.1\.0-rc\.1-1-g[0-9a-f]+ — not a final release[\s\S]*\.\/install\.sh --release/);
  assert.strictEqual(h.git('symbolic-ref', '--short', 'HEAD'), 'main');

  const rel = runClone(h.clone, home, ['--release']);
  assert.strictEqual(rel.status, 0, rel.stdout + rel.stderr);
  assert.strictEqual(h.git('describe', '--tags', '--exact-match'), 'v1.0.0');
});

test('#521: a dirty clone is never moved, keep never moves, and the two ref flags refuse together', (t) => {
  const h = releasedHandbook(t);
  fs.appendFileSync(path.join(h.clone, 'skills', 'demo', 'SKILL.md'), 'local edit\n');
  const dirty = runClone(h.clone, tmp(t), ['--release']);
  assert.strictEqual(dirty.status, 0, dirty.stdout + dirty.stderr);
  assert.match(dirty.stdout, /uncommitted changes — NOT switching to v1\.0\.0/);
  assert.strictEqual(h.git('symbolic-ref', '--short', 'HEAD'), 'main');
  h.git('checkout', '--', '.');

  const kept = runClone(h.clone, tmp(t), [], { COLAB_INSTALL_REF: 'keep' });
  assert.strictEqual(kept.status, 0, kept.stdout + kept.stderr);
  assert.strictEqual(h.git('symbolic-ref', '--short', 'HEAD'), 'main');

  const both = runClone(h.clone, tmp(t), ['--release', '--trunk']);
  assert.strictEqual(both.status, 2);
  assert.match(both.stderr, /opposite choices/);
});

test('#521: a fresh --tools --fleet then --check is ⚠-only, exit 0 — not set up yet is not broken', (t) => {
  const home = tmp(t);
  // Not --all: --hooks writes core.hooksPath into THIS clone's .git/config. The hooks rows, the other
  // half of the #521 measurement, are covered against a throwaway handbook above.
  const r = runInstall(home, ['--tools', '--fleet']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const c = runInstall(home, ['--check']);
  assert.strictEqual(c.status, 0, c.stdout + c.stderr);
  assert.doesNotMatch(c.stdout, /^\s+✗ /m);
  assert.match(c.stdout, /⚠ fleet\s+nothing registered yet/);
});

// --- engines (#530): the install target is per engine, chosen by flag or at a prompt -------------

const SKILL_NAMES = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const linkedInto = (dir) => SKILL_NAMES.filter((n) => {
  try { return fs.readlinkSync(path.join(dir, n)) === path.join(ROOT, 'skills', n); } catch (_) { return false; }
});

test('#530: every engine file declares every key, with yes/no where the format says so', () => {
  const all = engines.listEngines(ROOT);
  assert.deepStrictEqual(all.map((e) => e.id).sort(), ['claude', 'codex', 'generic']);
  for (const e of all) {
    for (const k of ['label', 'skills_dir', 'invoke', 'instructions', 'helper_agents', 'load_time_injection', 'shell_network', 'verified']) {
      assert.ok(k in e, `engines/${e.id}.conf has no ${k}:`);
    }
    for (const k of ['helper_agents', 'load_time_injection']) assert.match(e[k], /^(yes|no)$/, `${e.id} ${k}`);
    assert.match(e.shell_network, /^(yes|no|unknown)$/, `${e.id} shell_network`);
  }
  assert.strictEqual(all.find((e) => e.id === 'generic').skills_dir, '', 'generic must leave the folder to the user');
  assert.deepStrictEqual(all.filter((e) => e.default === 'yes').map((e) => e.id), ['claude'], 'exactly one default engine, and it is Claude Code (#530)');
});

test('#530: install.sh (sed) and engines.js read every engine file the same way', () => {
  for (const e of engines.listEngines(ROOT)) {
    for (const k of ['label', 'skills_dir', 'invoke']) {
      const sed = execFileSync('sed', ['-n', `/^${k}:/{s/^${k}:[[:space:]]*//;p;q;}`, path.join(ROOT, 'engines', `${e.id}.conf`)], { encoding: 'utf8' }).replace(/\n$/, '');
      assert.strictEqual(sed, e[k], `${e.id} ${k}`);
    }
  }
  const p = engines.parseConf('# c\nlabel: A\nlabel: B\nnote: one\nnote: two\nskills_dir:\n');
  assert.deepStrictEqual(p, { label: 'A', skills_dir: '', note: ['one', 'two'], caveat: [] });
});

test('#530: no flag, not a terminal, nothing linked → Claude Code, said aloud; a re-run changes nothing', (t) => {
  const home = tmp(t);
  const r = runInstall(home, []);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /none had the skills linked yet → defaulted to claude/);
  assert.match(r.stdout, /--engine <id>/);
  assert.deepStrictEqual(linkedInto(path.join(home, '.claude', 'skills')), SKILL_NAMES);
  assert.ok(!fs.existsSync(path.join(home, '.agents')), 'a no-flag install must not pick a second engine');
  assert.doesNotMatch(r.stdout, /takes precedence over this\s/, 'the old, wrong precedence note is back');

  const again = runInstall(home, []);
  assert.strictEqual(again.status, 0, again.stdout + again.stderr);
  assert.doesNotMatch(again.stdout, /defaulted to/);
  assert.doesNotMatch(again.stdout, /🔗 link/, 'a re-run linked something new');
});

test('#530: --engine and --skills-dir install there; a later no-flag run keeps every one; --check reports each', (t) => {
  const home = tmp(t);
  const own = path.join(home, 'my-agent', 'skills');
  const r = runInstall(home, ['--engine', 'codex', '--skills-dir', own]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.deepStrictEqual(linkedInto(path.join(home, '.agents', 'skills')), SKILL_NAMES);
  assert.deepStrictEqual(linkedInto(own), SKILL_NAMES);
  assert.ok(!fs.existsSync(path.join(home, '.claude')), 'an explicit --engine must not add claude');
  assert.match(r.stdout, /⚠ the default workspace-write sandbox has NO network/, 'the engine caveat was not printed');
  assert.strictEqual(fs.readFileSync(path.join(home, '.colab', 'skills-dirs'), 'utf8'), own + '\n');

  const again = runInstall(home, []);
  assert.strictEqual(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /skills → .*\.agents\/skills/);
  assert.match(again.stdout, new RegExp(`skills → ${own.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.strictEqual(fs.readFileSync(path.join(home, '.colab', 'skills-dirs'), 'utf8'), own + '\n', 'remembered twice');

  const c = runInstall(home, ['--check']);
  assert.strictEqual(c.status, 0, c.stdout + c.stderr);
  assert.match(c.stdout, new RegExp(`✓ skills\\s+codex .*: ${SKILL_NAMES.length}/${SKILL_NAMES.length} linked`));
  assert.match(c.stdout, new RegExp(`✓ skills\\s+generic .*my-agent/skills: ${SKILL_NAMES.length}/${SKILL_NAMES.length} linked`));
  assert.match(c.stdout, /⚠ skills\s+codex: the default workspace-write sandbox/);
  assert.match(c.stdout, /✓ skills\s+not installed for: claude/);
});

test('#530: an unknown engine, or generic with no folder, refuses before anything is written', (t) => {
  const home = tmp(t);
  const bad = runInstall(home, ['--engine', 'nope']);
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /no engine 'nope' — known: claude codex/);
  const gen = runInstall(home, ['--engine=generic']);
  assert.strictEqual(gen.status, 2);
  assert.match(gen.stderr, /--skills-dir <path>/);
  assert.deepStrictEqual(fs.readdirSync(home), [], 'a refused run wrote into HOME');
});

test('#530: --check skills rows — broken link ✗, missing ⚠, a Claude-only machine is not told off', (t) => {
  const home = tmp(t);
  const colabHome = path.join(home, '.colab');
  assert.deepStrictEqual(check.checkSkills({ root: ROOT, home, colabHome }).map((r) => r.severity), [check.WARN]);

  const dir = path.join(home, '.claude', 'skills');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of SKILL_NAMES) fs.symlinkSync(path.join(ROOT, 'skills', n), path.join(dir, n));
  let rows = check.checkSkills({ root: ROOT, home, colabHome });
  assert.deepStrictEqual(rows.map((r) => r.severity), [check.OK, check.OK], JSON.stringify(rows));
  assert.match(rows[1].text, /not installed for: codex/);

  fs.unlinkSync(path.join(dir, SKILL_NAMES[0]));
  rows = check.checkSkills({ root: ROOT, home, colabHome });
  assert.strictEqual(rows[0].severity, check.WARN);
  assert.match(rows[0].text, new RegExp(`missing ${SKILL_NAMES[0]} — re-run ./install.sh --engine claude`));

  fs.symlinkSync(path.join(ROOT, 'skills', 'removed-upstream'), path.join(dir, 'removed-upstream'));
  rows = check.checkSkills({ root: ROOT, home, colabHome });
  assert.strictEqual(rows[0].severity, check.FAIL);
  assert.match(rows[0].text, /BROKEN links to skills that no longer exist: removed-upstream/);
});
