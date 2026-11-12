'use strict';
/**
 * The secret scan's range (#716). The light lane's "gitleaks detect" step scans only the commits
 * its run brings — never `git log --all`, which on a fetch-depth-0 checkout is every branch and
 * tag, so one unshipped branch's finding turned every branch's CI red. The full history of
 * trunk's tip moved to the heavy lane's `secrets` job, which blocks no merge.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The step's `run: |` block is lifted out of the template TEXT and run under bash in a scratch
 * clone (an origin with a trunk, a branch carrying a "leak", and the branch under test), with a
 * fake `gitleaks` on PATH that records which commits its `--log-opts` range reaches. So the range
 * is executed against real git, not matched as a string. Where a real gitleaks is installed, one
 * more test runs it end to end on a real-looking key.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STACKS = ['node', 'python', 'laravel'];
const read = (name) => fs.readFileSync(path.join(REPO_ROOT, 'templates', name), 'utf8');
const HAS_GITLEAKS = spawnSync('gitleaks', ['version']).status === 0;

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });
function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(dir);
  return dir;
}

/** The dedented body of the `run: |` block belonging to the step named `name` (first match). */
function stepScript(text, name) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `step "${name}" not found`);
  const stepIndent = lines[at].indexOf('-');
  let runAt = -1;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.indexOf(l.trim()) <= stepIndent) break;
    if (/^\s*run: \|\s*$/.test(l)) { runAt = i; break; }
  }
  assert.ok(runAt >= 0, `step "${name}" has no run: | block`);
  const runIndent = lines[runAt].indexOf('run:');
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.indexOf(l.trim()) <= runIndent) break;
    body.push(l);
  }
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.indexOf(l.trim())));
  return body.map((l) => l.slice(indent)).join('\n');
}

/** The text of one top-level job (`  <name>:` up to the next top-level job). */
function jobText(text, name) {
  const lines = text.split('\n');
  const at = lines.indexOf(`  ${name}:`);
  assert.ok(at >= 0, `job ${name} not found`);
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) if (/^ {2}[a-z][a-z0-9-]*:$/.test(lines[i])) { end = i; break; }
  while (end > at && /^ {2}#|^$/.test(lines[end - 1])) end--;
  return lines.slice(at, end).join('\n');
}

/** The text of one step, `- name: <name>` up to the next step of the same job. */
function stepText(text, name) {
  const at = text.indexOf(`      - name: ${name}\n`);
  assert.ok(at >= 0, `step "${name}" not found`);
  const next = text.indexOf('\n      - ', at + 1);
  const lines = text.slice(at, next < 0 ? undefined : next).split('\n');
  while (lines.length && /^( {6}#.*)?$/.test(lines[lines.length - 1])) lines.pop(); // the next step's comments
  return lines.join('\n');
}

const DETECT = 'gitleaks detect';
// #724: the light templates call the reusable light lane, so the step lives once, in its gitleaks job.
const LIGHT = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci-light.yml'), 'utf8');
const SCRIPT = stepScript(LIGHT, DETECT);

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } }).trim();
const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const commit = (cwd, file, content, msg) => {
  fs.writeFileSync(path.join(cwd, file), content);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
};

// A real-looking key gitleaks' default rules catch (its `stripe-access-token` shape). Assembled at
// run time, so this file never holds it whole: the pre-commit and CI secret scans read this source.
const LEAK = `stripe_key = "${['sk', 'live', '51H8xQ2eZvKYlo2C9aBcDeFgHiJkLmNoPq'].join('_')}"\n`;

/**
 * An origin with: trunk `trunk` (two commits, a third pushed later), a branch `leak` carrying a
 * secret, and a branch `fix` off trunk with one clean commit. Returns a clone that fetched every
 * branch, the way actions/checkout with fetch-depth: 0 does (refs/remotes/origin/*).
 */
function fixture({ trunk = 'main', projectYml = true } = {}) {
  const root = tmpdir('secret-range-');
  const src = path.join(root, 'src');
  fs.mkdirSync(src);
  git(src, 'init', '-q', '-b', trunk);
  if (projectYml) {
    fs.mkdirSync(path.join(src, '.github'));
    fs.writeFileSync(path.join(src, '.github', 'project.yml'), `exposure: none\ntrunk: ${trunk} # the branch sessions merge into\n`);
    git(src, 'add', '.github');
  }
  const t1 = commit(src, 'a.txt', 'one\n', 'one');
  const t2 = commit(src, 'a.txt', 'two\n', 'two');
  git(src, 'checkout', '-q', '-b', 'leak');
  const leak = commit(src, 'fixture.txt', LEAK, 'test: a fixture with a live-looking key');
  git(src, 'checkout', '-q', trunk);
  git(src, 'checkout', '-q', '-b', 'fix');
  const fix = commit(src, 'b.txt', 'fix\n', 'fix: format');
  git(src, 'checkout', '-q', trunk);
  const t3 = commit(src, 'a.txt', 'three\n', 'three');
  const clone = path.join(root, 'clone');
  git(root, 'clone', '-q', '--no-checkout', src, clone);
  return { root, clone, t1, t2, t3, leak, fix, trunk };
}

/** A fake gitleaks that records every commit its --log-opts range reaches, one sha per line. */
function fakeGitleaks(root) {
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(root, 'scanned');
  fs.writeFileSync(path.join(bin, 'gitleaks'), `#!/usr/bin/env bash
opts=
for a in "$@"; do case "$a" in --log-opts=*) opts="\${a#--log-opts=}" ;; esac; done
[ -n "$opts" ] || { echo "no --log-opts: this would scan git log --all" >&2; exit 3; }
echo "$opts" > ${JSON.stringify(path.join(root, 'opts'))}
git log --format=%H $opts > ${JSON.stringify(log)}
`, { mode: 0o755 });
  return { bin, scanned: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean), opts: () => fs.readFileSync(path.join(root, 'opts'), 'utf8').trim() };
}

function run(fx, checkout, env, { real = false } = {}) {
  git(fx.clone, 'checkout', '-q', '--detach', checkout);
  const fake = fakeGitleaks(fx.root);
  const r = spawnSync('bash', ['-eo', 'pipefail', '-c', SCRIPT], {
    cwd: fx.clone,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV, PATH: real ? process.env.PATH : `${fake.bin}:${process.env.PATH}`, EVENT: 'push', BEFORE: '', DEFAULT_BRANCH: 'main', ...env },
  });
  return { ...r, scanned: real ? [] : (r.status === 0 ? fake.scanned() : []), opts: real ? '' : (r.status === 0 ? fake.opts() : '') };
}

// ---- the step is one step, everywhere --------------------------------------------------------

test('the light templates carry no scan of their own: they call the lane that runs it (#724)', () => {
  for (const s of STACKS) {
    const text = read(`ci-${s}.yml`);
    assert.match(text, /^    uses: [^\n]*\/\.github\/workflows\/ci-light\.yml@/m, `ci-${s}.yml calls ci-light.yml`);
    assert.doesNotMatch(text, /gitleaks detect/, `ci-${s}.yml: a second copy of the scan`);
  }
});

test('the reusable light lane\'s "gitleaks detect" step always names a range', () => {
  {
    const s = 'ci-light';
    const job = jobText(LIGHT, 'gitleaks');
    for (const k of ['EVENT: ${{ github.event_name }}', 'REF_NAME: ${{ github.ref_name }}', 'BEFORE: ${{ github.event.before }}',
      'DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}']) assert.ok(job.includes(`          ${k}\n`), `${s}: env ${k}`);
    assert.match(job, /gitleaks detect --source \. --no-banner --log-opts="\$range"/);
    // A scan with no --log-opts is `git log --all`: the defect.
    assert.doesNotMatch(job, /gitleaks detect --source \. --no-banner\s*$/m, 'a bare scan reads every fetched branch');
    assert.match(job, /^ {10}fetch-depth: 0$/m, 'the range needs both of its ends in the clone');
  }
});

// ---- the range, executed ---------------------------------------------------------------------

test('a branch push scans its own commits — never an unrelated branch\'s', () => {
  const fx = fixture();
  const r = run(fx, 'origin/fix', { REF_NAME: 'fix' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.opts, 'refs/remotes/origin/main..HEAD');
  assert.deepStrictEqual(r.scanned, [fx.fix], 'only the commit trunk does not have');
  assert.ok(!r.scanned.includes(fx.leak), 'the leak on another branch is not this run\'s finding');
});

test('the branch that carries the finding still scans it', () => {
  const fx = fixture();
  const r = run(fx, 'origin/leak', { REF_NAME: 'leak' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.scanned, [fx.leak]);
});

test('a trunk push scans the pushed range', () => {
  const fx = fixture();
  const r = run(fx, 'origin/main', { REF_NAME: 'main', BEFORE: fx.t2 });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.opts, `${fx.t2}..HEAD`);
  assert.deepStrictEqual(r.scanned, [fx.t3]);
});

test('a trunk push with no readable range scans trunk\'s own history, still no other branch', () => {
  const fx = fixture();
  const ZERO = '0'.repeat(40);
  const cases = [
    ['a first push (before is all zeros)', { BEFORE: ZERO }],
    ['a forced push (before is not an ancestor)', { BEFORE: fx.leak }],
    ['before is not in the clone', { BEFORE: 'f'.repeat(40) }],
    ['a dispatch (no before at all)', { EVENT: 'workflow_dispatch', BEFORE: '' }],
  ];
  for (const [why, env] of cases) {
    const r = run(fx, 'origin/main', { REF_NAME: 'main', ...env });
    assert.strictEqual(r.status, 0, `${why}: ${r.stderr}`);
    assert.strictEqual(r.opts, 'HEAD', why);
    assert.deepStrictEqual(r.scanned.sort(), [fx.t1, fx.t2, fx.t3].sort(), why);
  }
});

test('trunk is read from project.yml — a trunk named dev is trunk, main beside it is not', () => {
  const fx = fixture({ trunk: 'dev' });
  const t = run(fx, 'origin/dev', { REF_NAME: 'dev', BEFORE: fx.t2 });
  assert.strictEqual(t.opts, `${fx.t2}..HEAD`);
  const b = run(fx, 'origin/fix', { REF_NAME: 'fix', DEFAULT_BRANCH: 'main' });
  assert.strictEqual(b.opts, 'refs/remotes/origin/dev..HEAD', 'the descriptor wins over the default branch');
  assert.deepStrictEqual(b.scanned, [fx.fix]);
});

test('no project.yml: the default branch stands in for trunk', () => {
  const fx = fixture({ projectYml: false });
  const r = run(fx, 'origin/fix', { REF_NAME: 'fix', DEFAULT_BRANCH: 'main' });
  assert.strictEqual(r.opts, 'refs/remotes/origin/main..HEAD');
  assert.deepStrictEqual(r.scanned, [fx.fix]);
});

test('trunk not in the clone: the branch scans its own history, never every branch', () => {
  const fx = fixture();
  git(fx.clone, 'update-ref', '-d', 'refs/remotes/origin/main');
  const r = run(fx, 'origin/fix', { REF_NAME: 'fix' });
  assert.strictEqual(r.opts, 'HEAD');
  assert.ok(r.scanned.includes(fx.fix) && !r.scanned.includes(fx.leak));
});

test('real gitleaks: an unrelated branch\'s key no longer reds this branch, and still reds its own', { skip: !HAS_GITLEAKS && 'gitleaks not installed' }, () => {
  const fx = fixture();
  const fix = run(fx, 'origin/fix', { REF_NAME: 'fix' }, { real: true });
  assert.strictEqual(fix.status, 0, fix.stdout + fix.stderr);
  const leak = run(fx, 'origin/leak', { REF_NAME: 'leak' }, { real: true });
  assert.notStrictEqual(leak.status, 0, 'the branch carrying the key must still fail');
  // And the old, range-less command reproduces the defect on the clean branch.
  const old = spawnSync('gitleaks', ['detect', '--source', '.', '--no-banner'], { cwd: fx.clone, encoding: 'utf8' });
  assert.notStrictEqual(old.status, 0, 'the pre-#716 command reads the leak branch from the fix branch');
});

// ---- the full-history scan lives in the heavy lane -------------------------------------------

const pin = (text) => text.match(/^ {2}GITLEAKS_VERSION: "([^"]+)"/m)[1];

for (const s of STACKS) {
  test(`ci-${s}-heavy.yml: a full-history scan of trunk's tip, installed exactly as the light lane installs it`, () => {
    const heavy = read(`ci-${s}-heavy.yml`);
    const light = LIGHT; // #724: the light lane's scan is the reusable workflow's
    const job = jobText(heavy, 'secrets');
    for (const l of ['    needs: plan', "    if: ${{ needs.plan.outputs.run == 'true' }}", '    permissions:\n      contents: read',
      '          ref: ${{ needs.plan.outputs.sha }}', '          fetch-depth: 0',
      '        run: gitleaks detect --source . --no-banner --log-opts=HEAD']) assert.ok(job.includes(l), `${s}: ${l}`);
    assert.doesNotMatch(job, /--all/, 'HEAD only, never every branch');
    // The pin and the install are the light lane's: two installers would drift apart.
    assert.strictEqual(pin(heavy), (light.match(/^ {6}gitleaks-version:\n(?: {8}.*\n)*? {8}default: "([^"]+)"$/m) || [])[1]);
    const install = 'Install gitleaks (pinned release binary)';
    // The commands, not the prose: the light lane's comments were rewritten once, for one file (#721).
    const code = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    assert.strictEqual(code(stepScript(job, install)), code(stepScript(light, install)));
    for (const n of ['Restore gitleaks cache', install]) assert.strictEqual(code(stepText(job, n)), code(stepText(jobText(light, 'gitleaks'), n)), n);
    // A red full-history scan on a nightly reports, like a red suite.
    const report = jobText(heavy, 'report');
    assert.ok(report.includes('    needs: [plan, heavy, secrets]\n'));
    assert.match(report, /needs\.secrets\.result == 'failure'/);
  });
}

test('the light lane is never scheduled — its run at trunk\'s sha is the merge verdict', () => {
  for (const s of STACKS) assert.doesNotMatch(read(`ci-${s}.yml`).split('\njobs:')[0], /^ {2}schedule:/m, s);
});

// ---- this repo's own CI (#722) ---------------------------------------------------------------
// The handbook's ci.yml is purpose-written, not copied from a template, so #716 left its scan on
// `git log --all`. It now runs the light templates' step verbatim, and the full history of trunk's
// tip moved to a workflow of its own (this repo has no heavy lane) that no merge gate reads.

const own = (name) => fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf8');
const FULL = 'secrets-full-history.yml';
const jobPin = (job) => job.match(/^ {6}GITLEAKS_VERSION: "([^"]+)"/m)[1];

test('this repo\'s ci.yml runs the templates\' ranged "gitleaks detect" step, byte for byte', () => {
  const ci = own('ci.yml');
  // Identical to the reusable light lane's script, so every executed range test above covers it too.
  assert.strictEqual(stepScript(ci, DETECT), SCRIPT, '.github/workflows/ci.yml drifted from .github/workflows/ci-light.yml');
  const job = jobText(ci, 'gitleaks');
  for (const k of ['EVENT: ${{ github.event_name }}', 'REF_NAME: ${{ github.ref_name }}', 'BEFORE: ${{ github.event.before }}',
    'DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}']) assert.ok(job.includes(`          ${k}\n`), `env ${k}`);
  assert.doesNotMatch(job, /gitleaks detect --source \. --no-banner\s*$/m, 'a bare scan reads every fetched branch');
  assert.match(job, /^ {10}fetch-depth: 0$/m, 'the range needs both of its ends in the clone');
  // This repo's trunk, read the way the step reads it.
  assert.match(fs.readFileSync(path.join(REPO_ROOT, '.github', 'project.yml'), 'utf8'), /^trunk: main$/m);
});

test(`${FULL}: a full-history scan of trunk's tip, installed exactly as ci.yml installs it`, () => {
  const full = own(FULL);
  const ci = own('ci.yml');
  const job = jobText(full, 'secrets');
  for (const l of ['    permissions:\n      contents: read', '          fetch-depth: 0',
    '        run: gitleaks detect --source . --no-banner --log-opts=HEAD']) assert.ok(job.includes(l), l);
  assert.doesNotMatch(job, /--all/, 'HEAD only, never every branch');
  const install = 'Install gitleaks (pinned binary)';
  assert.strictEqual(stepScript(job, install), stepScript(jobText(ci, 'gitleaks'), install), 'two installers drift apart');
  assert.strictEqual(jobPin(job), jobPin(jobText(ci, 'gitleaks')), 'bump both pins together');
  const report = jobText(full, 'report');
  assert.match(report, /github\.event_name == 'schedule' && needs\.secrets\.result == 'failure'/);
  assert.match(full.split('\njobs:')[0], /^permissions: \{\}$/m);
});

test(`${FULL} is never a merge verdict — the gate sets aside every run of it, dispatch included`, () => {
  const { workflowTriggers, splitVerifying } = require('./verify-runs');
  const header = own(FULL).split('\njobs:')[0];
  assert.doesNotMatch(header, /^ {2}(push|pull_request|pull_request_target|merge_group):/m, 'a push trigger makes it a verdict');
  assert.match(header, /^ {2}schedule:/m);
  const full = workflowTriggers(own(FULL));
  const ci = workflowTriggers(own('ci.yml'));
  assert.deepStrictEqual(full, { name: 'Secret scan (full history)', verifiesBranches: false });
  assert.deepStrictEqual(ci, { name: 'CI', verifiesBranches: true });
  // The lost-push rescue (#567), fed the real files: it counts ci.yml's dispatch, never this one's.
  const policy = { gate: null, ignore: [], dispatchVerifies: () => [full, ci].filter((w) => w.verifiesBranches).map((w) => w.name) };
  const sha = 'a'.repeat(40);
  const rows = [
    { workflowName: full.name, event: 'schedule', headSha: sha, conclusion: 'failure' },
    { workflowName: full.name, event: 'workflow_dispatch', headSha: sha, conclusion: 'failure' },
    { workflowName: 'CI', event: 'workflow_dispatch', headSha: sha, conclusion: 'success' },
  ];
  const split = splitVerifying(rows, policy);
  assert.deepStrictEqual(split.counted.map((r) => `${r.workflowName}/${r.event}`), ['CI/workflow_dispatch']);
  assert.deepStrictEqual(split.setAside.map((r) => r.event).sort(), ['schedule', 'workflow_dispatch']);
});
