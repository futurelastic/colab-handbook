'use strict';
/**
 * templates/release-auto.yml (#425): its shell steps, its recognition, and the CLI's self-exclusion.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Like release-tag-template.test.js, the `run:` blocks are lifted out of the template TEXT and run
 * under bash — here against a stub `colab` that prints a canned verdict — so what the steps do with
 * a cut, a no-op, a refusal and a crash is checked, not just their schema (actionlint has that).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const stamp = require('./stamp.js');
const { withoutOwnWorkflow } = require('./release-cut.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEXT = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'release-auto.yml'), 'utf8');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });
function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(dir);
  return dir;
}

/** The dedented body of the `run: |` block belonging to the step named `name`. */
function stepScript(name, text = TEXT) {
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

const HAS_JQ = spawnSync('jq', ['--version']).status === 0;

/** Runs a lifted step with a stub colab printing `stdout` and exiting `exit`. */
function runWithStub(step, { stdout, exit }) {
  const dir = tmpdir('release-auto-');
  const stub = path.join(dir, 'colab');
  fs.writeFileSync(stub, `process.stdout.write(${JSON.stringify(stdout)}); process.exitCode = ${exit};\n`);
  const out = path.join(dir, 'output');
  const summary = path.join(dir, 'summary');
  fs.writeFileSync(out, '');
  const r = spawnSync('bash', ['-c', stepScript(step)], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, COLAB: stub, RUNNER_TEMP: dir, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary },
  });
  const o = {};
  for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) o[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return { status: r.status, output: o, stdout: r.stdout, summary: fs.existsSync(summary) ? fs.readFileSync(summary, 'utf8') : '' };
}

const CUT = 'Cut a candidate (colab release cut --auto)';
const FIN = 'Finalize the newest clean candidate (colab release finalize --auto)';
const check = (condition, ok) => ({ condition, ok, detail: `${condition} detail` });

test('cut: a created candidate is handed to the publish step', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const r = runWithStub(CUT, { exit: 0, stdout: JSON.stringify({ ok: true, noop: false, created: true, tag: 'v1.3.0-rc.1', checks: [check('ci-green', true)] }) });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.output.tag, 'v1.3.0-rc.1');
  assert.match(r.summary, /✓ \*\*ci-green\*\*/);
});

test('cut: a refusal is a warning, the job stays green, nothing is published', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const r = runWithStub(CUT, { exit: 1, stdout: JSON.stringify({ ok: false, noop: false, created: false, tag: null, checks: [check('ci-green', true), check('version', false)] }) });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.output.tag, undefined);
  assert.match(r.stdout, /::warning::colab release cut refused: version/);
});

test('cut: a no-op is green and publishes nothing', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const r = runWithStub(CUT, { exit: 0, stdout: JSON.stringify({ ok: false, noop: true, created: false, tag: null, checks: [] }) });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.output.tag, undefined);
});

test('cut: no verdict at all (a crash) fails the job', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const r = runWithStub(CUT, { exit: 1, stdout: '' });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout, /::error::colab release cut produced no verdict/);
});

test('finalize: a final tag is handed to the publish step; testing / held are not failures', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const fin = runWithStub(FIN, { exit: 0, stdout: JSON.stringify({ state: 'finalized', tagged: true, finalTag: 'v1.3.0', checks: [check('test-period', true)] }) });
  assert.strictEqual(fin.status, 0);
  assert.strictEqual(fin.output.tag, 'v1.3.0');

  const testing = runWithStub(FIN, { exit: 0, stdout: JSON.stringify({ state: 'testing', tagged: false, finalTag: null, checks: [] }) });
  assert.strictEqual(testing.status, 0);
  assert.strictEqual(testing.output.tag, undefined);

  const held = runWithStub(FIN, { exit: 1, stdout: JSON.stringify({ state: 'held', tagged: false, finalTag: null, checks: [] }) });
  assert.strictEqual(held.status, 0);
  assert.match(held.stdout, /::warning::colab release finalize: held/);

  const crash = runWithStub(FIN, { exit: 1, stdout: 'not json' });
  assert.notStrictEqual(crash.status, 0);
});

test('the template publishes in its own run and never pushes commits', () => {
  assert.match(TEXT, /^\s+gh release create "\$TAG" --verify-tag/m);
  assert.match(TEXT, /\*-\*\) KIND=\(--prerelease --latest=false\)/, 'a candidate must be a pre-release, never Latest');
  const code = TEXT.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /\bgit\s+commit\b/);
  assert.doesNotMatch(code, /\bgit\s+push\b/);
  assert.doesNotMatch(code, /^\s+push:/m, 'a push trigger here would make the release workflow fire on its own tags');
});

test('the fingerprints attribute a copy to release-auto, not release-tag', () => {
  const prov = stamp.workflowProvenance(TEXT, 'release-auto', new Set(['release-auto', 'release-tag']));
  assert.strictEqual(prov.origin, 'derived');
  assert.strictEqual(prov.template, 'release-auto');
  // Copied under another name, still attributed by its text.
  assert.strictEqual(stamp.workflowProvenance(TEXT, 'release', new Set(['release-auto', 'release-tag'])).template, 'release-auto');
});

test('withoutOwnWorkflow drops the calling workflow\'s rows inside Actions only', () => {
  const rows = [
    { workflowName: 'CI', status: 'completed', conclusion: 'success' },
    { workflowName: 'Release (auto)', status: 'in_progress', conclusion: null },
    { workflowName: 'Release (auto)', status: 'completed', conclusion: 'failure' },
  ];
  const inside = { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'Release (auto)' };
  assert.deepStrictEqual(withoutOwnWorkflow(rows, inside).map((r) => r.workflowName), ['CI']);
  assert.strictEqual(withoutOwnWorkflow(rows, {}).length, 3, 'off Actions nothing is dropped');
  assert.strictEqual(withoutOwnWorkflow(rows, { GITHUB_WORKFLOW: 'Release (auto)' }).length, 3, 'GITHUB_WORKFLOW alone is not Actions');
  assert.strictEqual(withoutOwnWorkflow(null, inside), null, 'a failed read stays a failed read');
});

// ---- the audit recognises it ----------------------------------------------------------------------

function fixture(projectYml, files) {
  const dir = tmpdir('audit-release-auto-');
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function warns(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    stdout = err.stdout || '';
  }
  return JSON.parse(stdout).results[0].findings.filter((f) => f.level === 'warn').map((f) => f.text);
}

const RELEASED = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nexposure: released\nstack: node\n';
const NONE = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nexposure: none\nstack: node\n';
const TAG_WORKFLOW = 'name: Release\non:\n  push:\n    tags:\n      - "v*.*.*"\njobs:\n  r:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n';
const BARE_CUT = 'name: Auto\non:\n  schedule:\n    - cron: "0 3 * * *"\njobs:\n  r:\n    runs-on: ubuntu-latest\n    steps:\n      - run: colab release cut --auto\n';

test('audit: the template as shipped draws no release-auto finding on a repo whose rung cuts candidates', () => {
  const dir = fixture(RELEASED, { '.github/workflows/release-auto.yml': TEXT, '.github/workflows/release.yml': TAG_WORKFLOW });
  const w = warns(dir).filter((t) => t.startsWith('release-auto.yml runs') || t.startsWith('release-auto.yml creates'));
  assert.deepStrictEqual(w, []);
});

test('audit: cut --auto where the rung leaves candidates off', () => {
  const dir = fixture(NONE, { '.github/workflows/release-auto.yml': TEXT });
  assert.ok(warns(dir).some((t) => /^release-auto\.yml runs `colab release cut --auto`, but the release rung leaves candidates off/.test(t)));
});

test('audit: tags without publishing while another workflow waits on the tag push', () => {
  const dir = fixture(RELEASED, { '.github/workflows/auto.yml': BARE_CUT, '.github/workflows/release.yml': TAG_WORKFLOW });
  assert.ok(warns(dir).some((t) => /^auto\.yml creates release tags but publishes nothing in its own run, while release\.yml fires on the tag push/.test(t)));
  // No tag-push workflow waiting → nothing silently missed, no finding.
  const alone = fixture(RELEASED, { '.github/workflows/auto.yml': BARE_CUT });
  assert.ok(!warns(alone).some((t) => /publishes nothing in its own run/.test(t)));
});

test('audit: a release workflow that commits', () => {
  const committing = BARE_CUT.replace('      - run: colab release cut --auto\n', '      - run: colab release cut --auto\n      - run: git commit -am bump && git push origin main\n');
  const dir = fixture(RELEASED, { '.github/workflows/auto.yml': committing });
  assert.ok(warns(dir).some((t) => /^auto\.yml runs `colab release … --auto` and also commits or pushes a non-tag ref/.test(t)));
});

// ---------------------------------------------------------------------------------------------
// The handbook's OWN copy (#428): .github/workflows/release-auto.yml. It differs from the template
// in exactly two ways — it runs this checkout's tools/colab instead of a pinned HANDBOOK_REF clone
// (ruling on #428), and it gates a red CI run in a step so the run never concludes `skipped`. The
// cut / finalize / publish steps stay the template's, verbatim.

const OWN = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'release-auto.yml'), 'utf8');
const CI_NAME = /^name:\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'))[1];

test("own copy: triggers on ci.yml's own workflow name, on main", () => {
  const m = /workflow_run:\s*\n(?:\s*#.*\n)*\s*workflows:\s*\[([^\]]*)\]/.exec(OWN);
  assert.ok(m, 'no workflow_run.workflows list');
  const names = m[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, ''));
  assert.ok(names.includes(CI_NAME), `workflows ${JSON.stringify(names)} does not name ci.yml's "${CI_NAME}"`);
  assert.match(OWN, /branches: \[main\]/);
});

test("own copy: runs this checkout's tools/colab — no pinned ref, no clone", () => {
  assert.doesNotMatch(OWN, /^\s*HANDBOOK_REF:/m);
  assert.doesNotMatch(OWN, /git clone/);
  assert.match(OWN, /COLAB=\$GITHUB_WORKSPACE\/tools\/colab/);
  assert.match(OWN, /ref: main\n/);
  assert.match(OWN, /fetch-depth: 0/);
});

test('own copy: cut, finalize and publish are the template\'s steps verbatim', () => {
  for (const step of [CUT, FIN, 'Publish GitHub Release (same run)']) {
    assert.strictEqual(stepScript(step, OWN), stepScript(step), `step "${step}" drifted from the template`);
  }
});

test('own copy: no job-level if — a red CI run is gated in a step, so the run never concludes skipped', () => {
  assert.doesNotMatch(OWN, /^ {4}if:/m);
  assert.match(OWN, /if: steps\.gate\.outputs\.cut == 'true'/);
  const gate = stepScript('Gate on the triggering CI run', OWN);
  const run = (env) => {
    const dir = tmpdir('release-auto-gate-');
    const out = path.join(dir, 'output');
    fs.writeFileSync(out, '');
    const r = spawnSync('bash', ['-c', gate], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: path.join(dir, 'summary') } });
    return { status: r.status, out: fs.readFileSync(out, 'utf8') };
  };
  assert.deepStrictEqual(run({ EVENT: 'workflow_run', CONCLUSION: 'failure', HEAD_SHA: 'abc' }), { status: 0, out: 'cut=false\n' });
  assert.deepStrictEqual(run({ EVENT: 'workflow_run', CONCLUSION: 'success', HEAD_SHA: 'abc' }), { status: 0, out: 'cut=true\n' });
  assert.deepStrictEqual(run({ EVENT: 'schedule', CONCLUSION: '', HEAD_SHA: '' }), { status: 0, out: 'cut=true\n' });
});

test('own copy: the self-audit reads it as a release-auto workflow with nothing to warn about', () => {
  const r = spawnSync('node', [AUDIT, '--local', REPO_ROOT], { encoding: 'utf8' });
  assert.doesNotMatch(r.stdout + r.stderr, /release-auto\.yml/);
});
