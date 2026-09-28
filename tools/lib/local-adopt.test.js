'use strict';
/**
 * #393 — local-only adoption for a repo the fleet does not own.
 *
 * Two halves:
 *   1. the pure module (tools/lib/local-adopt.js): exclude-line arithmetic, the stub, the state
 *      classifier, and the labels subset it leans on;
 *   2. end to end on a REAL clone of a bare "owner" repo (default branch `master`, no handbook
 *      files, a fleet integration branch pushed beside it): `colab adopt --local` leaves
 *      `git status` clean, moves the main checkout onto the integration branch, `colab worktree
 *      new` cuts from that branch without dirtying the main checkout, and the audit names the
 *      state "adopted locally" instead of "not adopted".
 *
 * COLAB_HUMAN=1 below is set on a throwaway tmp fixture, exactly as tools/lib/adopt-cli.test.js
 * does — the exposure gate is exercised, not bypassed on any real repo.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const la = require('./local-adopt');
const labels = require('./labels');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// ---- pure ------------------------------------------------------------------

test('exclude paths are root-anchored and include the worktree subdir', () => {
  assert.deepStrictEqual(la.localExcludePaths(), ['/.github/project.yml', '/CLAUDE.local.md', '/.claude/plans/', '/.worktrees/']);
  assert.deepStrictEqual(la.localExcludePaths('wt/').slice(-1), ['/wt/']);
});

test('missing lines: an existing line counts with or without the leading slash; comments do not', () => {
  const have = '# .github/project.yml\n.github/project.yml\n/.worktrees/\n';
  assert.deepStrictEqual(la.missingExcludeLines(have), ['/CLAUDE.local.md', '/.claude/plans/']);
  assert.deepStrictEqual(la.missingExcludeLines(null), la.localExcludePaths());
});

test('append text is idempotent — empty once every line is there', () => {
  const first = la.excludeAppendText('# git default\n*~');
  assert.ok(first.startsWith('\n'), 'a file with no trailing newline gets one before the block');
  assert.ok(first.includes(la.EXCLUDE_HEADER));
  assert.strictEqual(la.excludeAppendText(`# git default\n*~${first}`), '');
});

test('state classifier: none / committed / local / untracked', () => {
  assert.strictEqual(la.localAdoptionState({ exists: false, tracked: false, ignored: false }), 'none');
  assert.strictEqual(la.localAdoptionState({ exists: true, tracked: true, ignored: false }), 'committed');
  assert.strictEqual(la.localAdoptionState({ exists: true, tracked: null, ignored: null }), 'committed', 'not a git checkout: nothing to say');
  assert.strictEqual(la.localAdoptionState({ exists: true, tracked: false, ignored: true }), 'local');
  assert.strictEqual(la.localAdoptionState({ exists: true, tracked: false, ignored: false }), 'untracked');
});

test('stub names both branches and the autopilot trap', () => {
  const t = la.claudeLocalStub({ trunk: 'fleet/integration', ownerTrunk: 'master' });
  assert.match(t, /Our trunk is `fleet\/integration`/);
  assert.match(t, /`master` is the owner's trunk/);
  assert.match(t, /autopilot stays OFF/);
});

test('NOT_DONE names the autopilot trap and the CI consequence for ship', () => {
  const all = la.NOT_DONE.map((n) => `${n.what} ${n.why}`).join('\n');
  assert.match(all, /autopilot/);
  assert.match(all, /human-gated/);
});

test('minimal label subset is the load-bearing four, every one a real convention label', () => {
  assert.deepStrictEqual(labels.MINIMAL_LABEL_NAMES, ['in-progress', 'deps-checked', 'agent-filed', 'epic']);
  assert.deepStrictEqual(labels.minimalConventionLabels().map((l) => l.name), labels.MINIMAL_LABEL_NAMES);
});

// ---- end to end --------------------------------------------------------------

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-adopt-'));
  TMP.push(dir);
  const bare = path.join(dir, 'owner.git');
  const clone = path.join(dir, 'clone');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g(dir, 'init', '-q', '--bare', '-b', 'master', bare);
  g(dir, 'clone', '-q', bare, clone);
  g(clone, 'config', 'user.email', 'test@example.invalid');
  g(clone, 'config', 'user.name', 'local-adopt test');
  g(clone, 'config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.writeFileSync(path.join(clone, 'app.py'), 'print(1)\n');
  fs.writeFileSync(path.join(clone, 'pyproject.toml'), '[project]\n');
  g(clone, 'add', '-A');
  g(clone, 'commit', '-q', '-m', 'init');
  g(clone, 'push', '-q', 'origin', 'master');
  g(clone, 'push', '-q', 'origin', 'master:refs/heads/fleet/integration');
  g(clone, 'remote', 'set-head', 'origin', '-a');
  const home = path.join(dir, 'colab-home');
  fs.mkdirSync(home);
  return { dir, clone, home, g };
}

function colab(fx, args, env = {}) {
  return spawnSync('node', [COLAB, ...args], {
    cwd: fx.clone, encoding: 'utf8',
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_HUMAN: '', COLAB_SESSION: '', COLAB_SESSION_NAME: '', ...env },
  });
}

const ADOPT = ['adopt', '--local', '--trunk', 'fleet/integration', '--production', 'none', '--deploy', 'none',
  '--exposure', 'self', '--answered-by', 'fixture', '--no-labels', '--no-verify'];

test('refusals: no --trunk, the owner\'s own trunk, and exposure left unanswered', () => {
  const fx = fixture();
  let r = colab(fx, ['adopt', '--local', '--no-labels', '--no-verify']);
  assert.strictEqual(r.status, 1); assert.match(r.stderr + r.stdout, /--local needs --trunk/);
  r = colab(fx, ['adopt', '--local', '--trunk', 'master', '--no-labels', '--no-verify']);
  assert.strictEqual(r.status, 1); assert.match(r.stderr + r.stdout, /owner's own default branch/);
  r = colab(fx, ['adopt', '--local', '--trunk', 'fleet/integration', '--production', 'none', '--deploy', 'none', '--no-labels', '--no-verify']);
  assert.strictEqual(r.status, 1); assert.match(r.stderr + r.stdout, /needs exposure answered/);
  assert.ok(!fs.existsSync(path.join(fx.clone, '.github', 'project.yml')), 'nothing written on refusal');
  r = colab(fx, ['adopt', '--trunk', 'x']);
  assert.notStrictEqual(r.status, 0); assert.match(r.stderr + r.stdout, /--trunk only means something with --local/);
});

test('refuses a repo that already commits its descriptor', () => {
  const fx = fixture();
  fs.mkdirSync(path.join(fx.clone, '.github'));
  fs.writeFileSync(path.join(fx.clone, '.github', 'project.yml'), 'tier: B\ntrunk: master\nproduction: null\ndeploy: none\nstack: python\n');
  fx.g(fx.clone, 'add', '-A'); fx.g(fx.clone, 'commit', '-q', '-m', 'adopt');
  const r = colab(fx, ADOPT, { COLAB_HUMAN: '1' });
  assert.strictEqual(r.status, 1); assert.match(r.stderr + r.stdout, /TRACKED/);
});

test('one command: descriptor + stub written, git status clean, main checkout on the integration branch', () => {
  const fx = fixture();
  const r = colab(fx, ADOPT, { COLAB_HUMAN: '1' });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  const yml = fs.readFileSync(path.join(fx.clone, '.github', 'project.yml'), 'utf8');
  assert.match(yml, /^trunk: fleet\/integration$/m);
  assert.match(yml, /^exposure: self$/m);
  assert.doesNotMatch(yml, /^tier:/m, 'exposure answered — no legacy tier fallback');
  assert.ok(fs.existsSync(path.join(fx.clone, 'CLAUDE.local.md')));
  assert.strictEqual(fx.g(fx.clone, 'status', '--porcelain', '-uall'), '');
  assert.strictEqual(fx.g(fx.clone, 'rev-parse', '--abbrev-ref', 'HEAD'), 'fleet/integration');
  assert.match(r.stdout, /Deliberately NOT done/);
  assert.match(r.stdout, /autopilot/);

  // Re-run: idempotent — no second exclude block, stub kept.
  const r2 = colab(fx, ['adopt', '--local', '--no-labels', '--no-verify']);
  assert.strictEqual(r2.status, 0, r2.stderr + r2.stdout);
  const excl = fs.readFileSync(path.join(fx.clone, '.git', 'info', 'exclude'), 'utf8');
  assert.strictEqual(excl.split(la.EXCLUDE_HEADER).length, 2, 'exclude block written exactly once');
  assert.match(r2.stdout, /already present — kept/);

  // A worktree cuts from the integration branch and does not dirty the main checkout.
  const w = colab(fx, ['worktree', 'new', 'feat/thing-1', '--session', 'https://example.invalid/session_x']);
  assert.strictEqual(w.status, 0, w.stderr + w.stdout);
  assert.match(w.stdout, /base origin\/fleet\/integration/);
  assert.strictEqual(fx.g(fx.clone, 'status', '--porcelain', '-uall'), '');
});

test('audit: "adopted locally", and an untracked-but-not-excluded descriptor is flagged', () => {
  const fx = fixture();
  assert.strictEqual(colab(fx, ADOPT, { COLAB_HUMAN: '1' }).status, 0);
  let a = spawnSync('node', [AUDIT, '--local', fx.clone, '--json'], { encoding: 'utf8' });
  let res = JSON.parse(a.stdout).results[0];
  assert.strictEqual(res.adoption, 'local');
  assert.ok(res.ok, JSON.stringify(res.findings));
  a = spawnSync('node', [AUDIT, '--local', fx.clone], { encoding: 'utf8' });
  assert.match(a.stdout, /adopted locally, not committed/);

  // Owner's CI gates only master: an advisory here, never a failure.
  fs.mkdirSync(path.join(fx.clone, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(fx.clone, '.github', 'workflows', 'ci.yml'),
    'on:\n  push:\n    branches: [master]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n');
  a = spawnSync('node', [AUDIT, '--local', fx.clone, '--json'], { encoding: 'utf8' });
  res = JSON.parse(a.stdout).results[0];
  assert.ok(res.ok, 'ungated integration branch is not a failure when locally adopted');
  assert.ok(res.findings.some((f) => f.level === 'warn' && /not CI-gated.*human-gated/.test(f.text)));

  // Remove the exclude line: the file is now one `git add -A` away from the owner's history.
  const exclFile = path.join(fx.clone, '.git', 'info', 'exclude');
  fs.writeFileSync(exclFile, fs.readFileSync(exclFile, 'utf8').replace('/.github/project.yml\n', ''));
  a = spawnSync('node', [AUDIT, '--local', fx.clone, '--json'], { encoding: 'utf8' });
  res = JSON.parse(a.stdout).results[0];
  assert.strictEqual(res.adoption, 'untracked');
  assert.ok(res.findings.some((f) => /untracked and NOT excluded/.test(f.text)));
});
