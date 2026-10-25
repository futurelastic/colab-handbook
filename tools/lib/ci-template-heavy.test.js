'use strict';
/**
 * The two-lane CI templates (#607): the heavy lane templates/ci-<stack>-heavy.yml, the release
 * workflows that gate an official build on it, and the light lane's loss of the docs-only guard.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Like the other template tests, the `run:` blocks are lifted out of the template TEXT and run
 * under bash — here against a fake `gh` answering canned output per argument pattern — so what the
 * nightly does on an unmoved trunk, what the report does with an open issue or an unreadable list,
 * and what release-auto's gate does with a green, red, running or missing heavy run are executed,
 * not just their schema (actionlint has that, in CI's adopter-layout lint).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('./yaml.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STACKS = ['node', 'python', 'laravel'];
const read = (name) => fs.readFileSync(path.join(REPO_ROOT, 'templates', name), 'utf8');
const HAS_JQ = spawnSync('jq', ['--version']).status === 0;

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });
function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(dir);
  return dir;
}

/** The dedented body of the `run: |` block belonging to the step named `name`. */
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
  // Drop the comment block that introduces the NEXT job.
  while (end > at && /^ {2}#|^$/.test(lines[end - 1])) end--;
  return lines.slice(at, end).join('\n');
}

/**
 * Runs `script` under bash with a fake `gh` on PATH. `rules` is [[regex-on-args, stdout, exit]];
 * the first match answers, and an unmatched call exits 1. Every call is logged, one per line.
 */
function runWithGh(script, { rules = [], env = {}, cwd } = {}) {
  const dir = tmpdir('heavy-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(dir, 'gh.log');
  fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify(rules.map(([re, out, code]) => [re.source, out, code || 0])));
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2).join(' ');
fs.appendFileSync(${JSON.stringify(log)}, args.replace(/\\n/g, '\\\\n') + '\\n');
for (const [re, out, code] of JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, 'rules.json'))}, 'utf8'))) {
  if (new RegExp(re).test(args)) { process.stdout.write(out); process.exit(code); }
}
process.exit(1);
`, { mode: 0o755 });
  const out = path.join(dir, 'output');
  const summary = path.join(dir, 'summary');
  fs.writeFileSync(out, '');
  const r = spawnSync('bash', ['-c', script], {
    cwd: cwd || dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: dir, GITHUB_SERVER_URL: 'https://github.com', ...env },
  });
  const outputs = Object.fromEntries(fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, outputs, calls };
}

// ---- the heavy lane's shape ------------------------------------------------------------------

for (const s of STACKS) {
  const text = read(`ci-${s}-heavy.yml`);
  const doc = yaml.parse(text);

  test(`ci-${s}-heavy.yml: schedule, dispatch and call with a ref — never push or pull_request, never cancelled`, () => {
    assert.deepStrictEqual(Object.keys(doc.on).sort(), ['schedule', 'workflow_call', 'workflow_dispatch']);
    assert.strictEqual(doc.on.workflow_call.inputs.ref.required, true);
    assert.strictEqual(doc.on.workflow_dispatch.inputs.ref.required, false);
    assert.ok(!('concurrency' in doc), 'a heavy run is never cancelled — a release may wait on it');
    assert.match(text, /^permissions: \{\}$/m, 'no token scope at the top; each job names its own');
    assert.ok(text.startsWith(`# CI heavy lane (`) && text.includes('— TEMPLATE. Copy me into your repo'), 'the house header, which the provenance fingerprints read');
  });

  test(`ci-${s}-heavy.yml: the suite job names its sha, needs plan, and checks out exactly that sha`, () => {
    const h = doc.jobs.heavy;
    assert.strictEqual(h.name, 'Full suite @ ${{ needs.plan.outputs.sha }}');
    assert.strictEqual(h.needs, 'plan');
    assert.strictEqual(h.if, "${{ needs.plan.outputs.run == 'true' }}");
    assert.match(jobText(text, 'heavy'), /ref: \$\{\{ needs\.plan\.outputs\.sha \}\}/);
    assert.ok(h['timeout-minutes'] > 0);
    assert.doesNotMatch(jobText(text, 'heavy'), /steps\.(tier|scripts|tools)\./, 'no reference to a light-lane-only step');
  });

  test(`ci-${s}-heavy.yml: its toolchain steps are the light lane's, verbatim`, () => {
    const light = read(`ci-${s}.yml`);
    const step = { node: 'Resolve Node version', python: 'Resolve Python version', laravel: 'Resolve toolchain versions' }[s];
    assert.strictEqual(stepScript(text, step), stepScript(light, step), 'two resolvers would let the lanes test different versions');
  });
}

test('the plan and report jobs are identical in all three heavy templates', () => {
  const [a, ...rest] = STACKS.map((s) => read(`ci-${s}-heavy.yml`));
  for (const t of rest) {
    assert.strictEqual(jobText(t, 'plan'), jobText(a, 'plan'));
    assert.strictEqual(jobText(t, 'report'), jobText(a, 'report'));
  }
});

// ---- the plan step: what to test, and the nightly skip ---------------------------------------

const PLAN = stepScript(read('ci-node-heavy.yml'), 'Resolve the commit; skip a nightly on an unmoved trunk');
const SHA = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const planEnv = (event, ref = '') => ({ EVENT: event, REF: ref, REPO: 'o/r', TRUNK: 'main', WORKFLOW_REF: 'o/r/.github/workflows/ci-heavy.yml@refs/heads/main' });

test('plan: a nightly on an unmoved trunk skips, and still concludes success', () => {
  const r = runWithGh(PLAN, {
    env: planEnv('schedule'),
    rules: [
      [/^api repos\/o\/r\/commits\/main /, `${SHA}\n`],
      [/workflows\/ci-heavy\.yml\/runs\?event=schedule&status=success/, '901\n900\n'],
      [/runs\/901\/jobs/, `${SHA}\n`],
    ],
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.outputs, { sha: SHA, run: 'false', since: SHA });
  assert.match(r.stdout, /heavy-skipped/);
});

test('plan: a nightly on a moved trunk runs, and names the last green nightly as the range start', () => {
  const r = runWithGh(PLAN, {
    env: planEnv('schedule'),
    rules: [
      [/^api repos\/o\/r\/commits\/main /, `${SHA}\n`],
      [/runs\?event=schedule/, '901\n900\n'],
      [/runs\/901\/jobs/, ''], // a skipped nightly carries no green suite job — look further back
      [/runs\/900\/jobs/, `${OLD}\n`],
    ],
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.outputs, { sha: SHA, run: 'true', since: OLD });
});

test('plan: an unreadable history runs the suite (never skips on doubt)', () => {
  const r = runWithGh(PLAN, { env: planEnv('schedule'), rules: [[/^api repos\/o\/r\/commits\/main /, `${SHA}\n`]] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.outputs, { sha: SHA, run: 'true', since: '' });
});

test('plan: a dispatch or call tests its ref and never asks about nightlies', () => {
  const r = runWithGh(PLAN, { env: planEnv('workflow_dispatch', 'v1.2.0-rc.1'), rules: [[/^api repos\/o\/r\/commits\/v1\.2\.0-rc\.1 /, `${SHA}\n`]] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.outputs, { sha: SHA, run: 'true', since: '' });
  assert.strictEqual(r.calls.length, 1);
});

test('plan: a ref that does not resolve fails the run', () => {
  const r = runWithGh(PLAN, { env: planEnv('workflow_dispatch', 'nope') });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /cannot resolve 'nope'/);
});

// ---- the report step: one trunk-red issue per lane -------------------------------------------

const REPORT = stepScript(read('ci-node-heavy.yml'), 'File one trunk-red issue');
const reportEnv = { REPO: 'o/r', SHA, SINCE: OLD, WORKFLOW: 'CI (heavy)', RUN_URL: 'https://github.com/o/r/actions/runs/7' };
const created = (calls) => calls.filter((c) => /^issue create /.test(c));

test('report: no open issue → files one, naming the range since the last green nightly', () => {
  const r = runWithGh(REPORT, { env: reportEnv, rules: [[/^issue list /, ''], [/^label create /, ''], [/^issue create /, 'https://github.com/o/r/issues/9\n']] });
  assert.strictEqual(r.status, 0, r.stderr);
  const c = created(r.calls);
  assert.strictEqual(c.length, 1);
  assert.match(c[0], /--title Nightly heavy lane red: CI \(heavy\)/);
  assert.match(c[0], /--label trunk-red/);
  assert.match(c[0], new RegExp(`compare/${OLD}\\.\\.\\.${SHA}`));
});

test('report: an open issue for the lane suppresses a new one', () => {
  const r = runWithGh(REPORT, { env: reportEnv, rules: [[/^issue list /, '12\n']] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(created(r.calls).length, 0);
  assert.match(r.stdout, /#12 already reports this lane red/);
});

test('report: an unreadable issue list files nothing and fails the job', () => {
  const r = runWithGh(REPORT, { env: reportEnv, rules: [[/^issue list /, '', 1]] });
  assert.notStrictEqual(r.status, 0);
  assert.strictEqual(created(r.calls).length, 0);
});

test('report: only on a scheduled run whose suite failed', () => {
  const job = yaml.parse(read('ci-node-heavy.yml')).jobs.report;
  assert.strictEqual(job.if, "${{ always() && github.event_name == 'schedule' && needs.heavy.result == 'failure' }}");
  assert.deepStrictEqual(job.permissions, { issues: 'write' });
});

// ---- release-tag: the record is published only on a green heavy lane --------------------------

test('release-tag.yml calls the heavy lane at the tag, and publishes only after it', () => {
  const doc = yaml.parse(read('release-tag.yml'));
  assert.strictEqual(doc.jobs.heavy.uses, './.github/workflows/ci-heavy.yml');
  assert.deepStrictEqual(doc.jobs.heavy.with, { ref: '${{ github.ref_name }}' });
  // A called workflow's jobs are capped by the caller: the report job's issues: write must be granted.
  assert.strictEqual(doc.jobs.heavy.permissions.issues, 'write');
  assert.strictEqual(doc.jobs.release.needs, 'heavy');
});

// ---- release-auto: a final waits for the heavy lane's green at the candidate's sha -----------

const AUTO = read('release-auto.yml');
const GATE = stepScript(AUTO, 'Heavy lane green at the candidate?');
const START = stepScript(AUTO, 'Start the heavy lane at the new candidate');
/** The workflow-level `env:` block scalar `name: |`, dedented. */
function envBlock(name) {
  const lines = AUTO.split('\n');
  const at = lines.findIndex((l) => l === `  ${name}: |`);
  const body = [];
  for (let i = at + 1; i < lines.length && (lines[i] === '' || lines[i].startsWith('    ')); i++) body.push(lines[i].slice(4));
  return body.join('\n').trimEnd() + '\n';
}
const RETRY = { RETRY_TRANSIENT: envBlock('RETRY_TRANSIENT'), HEAVY_DISPATCH: envBlock('HEAVY_DISPATCH'), RETRY_ATTEMPTS: '1', RETRY_DELAY: '0' };
/** #661: an adopter's own heavy lane whose only dispatch input is a boolean — `ref` only on workflow_call. */
const HEAVY_NO_REF = 'name: CI (heavy)\non:\n  workflow_dispatch:\n    inputs:\n      force:\n        type: boolean\n        default: false\n  workflow_call:\n    inputs:\n      ref:\n        type: string\n        required: true\njobs: {}\n';

/**
 * A repo dir with (or without) the heavy workflow, and a stub colab printing a dry finalize verdict.
 * `heavy: true` is the template's own ci-node-heavy.yml (declares a `ref` dispatch input); a string is
 * the file's text.
 */
function autoRepo({ heavy = true, candidate = { tag: 'v1.2.0-rc.1', sha: SHA } } = {}) {
  const dir = tmpdir('release-auto-heavy-');
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  if (heavy) fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci-heavy.yml'), heavy === true ? read('ci-node-heavy.yml') : heavy);
  const colab = path.join(dir, 'colab-stub.js');
  fs.writeFileSync(colab, `process.stdout.write(${JSON.stringify(JSON.stringify({ state: 'testing', candidate }))});\n`);
  return { dir, env: { ...RETRY, COLAB: colab, HEAVY_WORKFLOW: 'ci-heavy.yml' } };
}
const dispatched = (calls) => calls.filter((c) => /^workflow run ci-heavy\.yml /.test(c));

test('release-auto gate: a green heavy run at the candidate sha lets the final through', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const { dir, env } = autoRepo();
  const r = runWithGh(GATE, { cwd: dir, env, rules: [[/^run list --workflow ci-heavy\.yml --commit a{40} /, '[{"status":"completed","conclusion":"failure","url":"u1"},{"status":"completed","conclusion":"success","url":"u2"}]']] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.outputs, {});
  assert.strictEqual(dispatched(r.calls).length, 0);
});

test('release-auto gate: a red heavy run refuses the final, and does not re-dispatch', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const { dir, env } = autoRepo();
  const r = runWithGh(GATE, { cwd: dir, env, rules: [[/^run list /, '[{"status":"completed","conclusion":"failure","url":"u1"}]']] });
  assert.strictEqual(r.status, 0, 'a refusal is not a failure');
  assert.deepStrictEqual(r.outputs, { ok: 'false' });
  assert.match(r.stdout, /not finalized: the heavy lane is red/);
  assert.strictEqual(dispatched(r.calls).length, 0);
});

test('release-auto gate: a heavy run still going holds the final without a second dispatch', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const { dir, env } = autoRepo();
  const r = runWithGh(GATE, { cwd: dir, env, rules: [[/^run list /, '[{"status":"in_progress","conclusion":"","url":"u1"}]']] });
  assert.deepStrictEqual(r.outputs, { ok: 'false' });
  assert.strictEqual(dispatched(r.calls).length, 0);
});

test('release-auto gate: no heavy run at the sha → dispatches one at the candidate tag and holds the final', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const { dir, env } = autoRepo();
  const r = runWithGh(GATE, { cwd: dir, env, rules: [[/^run list /, '[]'], [/^workflow run /, '']] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.outputs, { ok: 'false' });
  assert.deepStrictEqual(dispatched(r.calls), ['workflow run ci-heavy.yml --ref v1.2.0-rc.1 -f ref=v1.2.0-rc.1']);
});

test('release-auto gate: runs that cannot be read hold the final', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const { dir, env } = autoRepo();
  const r = runWithGh(GATE, { cwd: dir, env, rules: [[/^run list /, '', 1]] });
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.outputs, { ok: 'false' });
});

test('release-auto gate: no heavy workflow, or no candidate → no gate at all', { skip: !HAS_JQ && 'jq not installed' }, () => {
  for (const opts of [{ heavy: false }, { candidate: null }]) {
    const { dir, env } = autoRepo(opts);
    const r = runWithGh(GATE, { cwd: dir, env });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(r.outputs, {});
    assert.ok(!r.calls.some((c) => /^(run list|workflow run) /.test(c)), r.calls.join(' | '));
  }
});

test('release-auto: the finalize step is skipped exactly when the gate says ok=false', () => {
  const lines = AUTO.split('\n');
  const at = lines.findIndex((l) => l.trim() === '- name: Finalize the newest clean candidate (colab release finalize --auto)');
  assert.match(lines[at + 2], /&& steps\.heavy\.outputs\.ok != 'false'$/);
  assert.ok(lines.findIndex((l) => l.trim() === '- name: Heavy lane green at the candidate?') < at, 'the gate runs before the finalize');
});

test('release-auto: a new candidate starts the heavy lane at its tag, when the repo has one', () => {
  const { dir, env } = autoRepo();
  const r = runWithGh(START, { cwd: dir, env: { ...env, TAG: 'v1.2.0-rc.2' }, rules: [[/^workflow run /, '']] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(dispatched(r.calls), ['workflow run ci-heavy.yml --ref v1.2.0-rc.2 -f ref=v1.2.0-rc.2']);
  const none = autoRepo({ heavy: false });
  const r2 = runWithGh(START, { cwd: none.dir, env: { ...none.env, TAG: 'v1.2.0-rc.2' } });
  assert.strictEqual(r2.status, 0);
  assert.strictEqual(r2.calls.length, 0);
});

test('#661 release-auto: a heavy lane with no `ref` dispatch input is dispatched with --ref alone, at both steps', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const { dir, env } = autoRepo({ heavy: HEAVY_NO_REF });
  const start = runWithGh(START, { cwd: dir, env: { ...env, TAG: 'v1.2.0-rc.2' }, rules: [[/^workflow run /, '']] });
  assert.strictEqual(start.status, 0, start.stderr);
  assert.deepStrictEqual(dispatched(start.calls), ['workflow run ci-heavy.yml --ref v1.2.0-rc.2']);
  assert.match(start.stdout, /Dispatched ci-heavy\.yml at v1\.2\.0-rc\.2/);
  const gate = runWithGh(GATE, { cwd: dir, env, rules: [[/^run list /, '[]'], [/^workflow run /, '']] });
  assert.strictEqual(gate.status, 0, gate.stderr);
  assert.deepStrictEqual(gate.outputs, { ok: 'false' });
  assert.deepStrictEqual(dispatched(gate.calls), ['workflow run ci-heavy.yml --ref v1.2.0-rc.1']);
});

test('#661 release-auto: the inputs are read from the workflow AT THE TAG, not the checked-out tree', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const { execFileSync } = require('child_process');
  const { dir, env } = autoRepo({ heavy: HEAVY_NO_REF });
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.github');
  g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'heavy without ref');
  g('tag', 'v1.2.0-rc.3');
  // The working tree has since gained the input; the tag has not — the tag's file decides.
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci-heavy.yml'), read('ci-node-heavy.yml'));
  const r = runWithGh(START, { cwd: dir, env: { ...env, TAG: 'v1.2.0-rc.3' }, rules: [[/^workflow run /, '']] });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(dispatched(r.calls), ['workflow run ci-heavy.yml --ref v1.2.0-rc.3']);
});

test('#661 heavy_dispatch_inputs reads a workflow exactly as colab\'s workflowDispatchInputs does', () => {
  const { workflowDispatchInputs } = require('./workflow-triggers.js');
  const fixtures = [
    HEAVY_NO_REF,
    'on:\n  push:\n  workflow_dispatch:\njobs: {}\n',
    'on:\n  push:\njobs: {}\n',
    'on: [push, workflow_dispatch]\n',
    'on:\n  workflow_dispatch:\n    # c\n    inputs:\n      a:\n        type: string\n      b_2:\n        default: x\n  schedule:\n    - cron: "1 * * * *"\n',
    '"on":\n  workflow_dispatch:\n    inputs: # note\n\n      ref:\n        default: ""\n      force:\n        type: boolean\njobs: {}\n',
    "'on':\n  workflow_call:\n    inputs:\n      ref:\n        type: string\n  workflow_dispatch:\n    inputs:\n      x-y:\n        type: string\n",
    'name: x\non:\n  workflow_dispatch:\n    inputs:\n      ref:\n# a column-0 comment ends the on: block\n      later:\n',
    '',
  ];
  for (const dirName of ['templates', path.join('.github', 'workflows')]) {
    for (const f of fs.readdirSync(path.join(REPO_ROOT, dirName)).filter((n) => /\.ya?ml$/.test(n))) fixtures.push(fs.readFileSync(path.join(REPO_ROOT, dirName, f), 'utf8'));
  }
  const script = `${envBlock('HEAVY_DISPATCH')}\nheavy_dispatch_inputs`;
  for (const text of fixtures) {
    const r = spawnSync('bash', ['-c', script], { input: text, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(r.stdout.split('\n').filter(Boolean), workflowDispatchInputs(text), text.slice(0, 120));
  }
});

// ---- the light lane: the docs-only guard is gone (#607) --------------------------------------

for (const s of STACKS) {
  test(`ci-${s}.yml: no docs-only guard; dedupe's verdict is its own check step`, () => {
    const text = read(`ci-${s}.yml`);
    assert.doesNotMatch(text, /docs_base|docs-only-skip|steps\.docs\./);
    assert.match(text, /^ {6}tested: \$\{\{ steps\.check\.outputs\.tested \}\}$/m);
    assert.match(text, /^ {4}# paths-ignore: \['\*\*\/\*\.md', 'docs\/\*\*'\]$/m, 'the optional docs paths-ignore example');
    assert.match(text, /LIGHT LANE \(#607\)/);
  });
}

// ---- the audit: an adopter's own CI copy is a suggestion, end to end (#607) ------------------

test('audit: unstamped light and heavy CI copies are suggestions — no fail, no warn, and the repo stays ok', () => {
  const { execFileSync } = require('child_process');
  const dir = tmpdir('audit-ci-guidance-');
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n');
  // Hand-edited, unstamped copies: an adopter's own CI.
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), read('ci-node.yml').replace('BUILD_COMMAND: "build"', 'BUILD_COMMAND: "compile"'));
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci-heavy.yml'), read('ci-node-heavy.yml').replace('timeout-minutes: 120', 'timeout-minutes: 240'));
  g('add', '-A');
  g('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', `core.hooksPath=${path.join(dir, '.nohooks')}`, 'commit', '-q', '-m', 'chore: fixture');
  let stdout;
  try {
    stdout = execFileSync('node', [path.join(REPO_ROOT, 'audit', 'audit.mjs'), '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) { stdout = err.stdout || ''; }
  const r = JSON.parse(stdout).results[0];
  const texts = r.findings.map((f) => `${f.level}: ${f.text}`);
  assert.ok(!texts.some((t) => /crashed/.test(t)), texts.join(' | '));
  assert.ok(!texts.some((t) => /ci(-heavy)?\.yml/.test(t)), `a CI copy's difference is never a finding: ${texts.join(' | ')}`);
  assert.ok(r.suggestions.some((s) => /^ci\.yml unstamped/.test(s)), r.suggestions.join(' | '));
  assert.ok(r.suggestions.some((s) => /^ci-heavy\.yml unstamped/.test(s)), r.suggestions.join(' | '));
});
