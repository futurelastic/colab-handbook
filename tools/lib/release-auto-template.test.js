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
// The handbook's OWN copy (#428): .github/workflows/release-auto.yml. It runs this checkout's
// tools/colab instead of a pinned HANDBOOK_REF clone (ruling on #428). It also gated a red CI run
// in a step, so the run never concludes `skipped`. That second difference ended in #435, when the
// template adopted the same gate. The gate, cut, finalize and publish steps are the template's,
// verbatim.

const OWN = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'release-auto.yml'), 'utf8');
const CI_NAME = /^name:\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'))[1];

// #435: measured on GitHub, a workflow_run-triggered run whose every job a job-level `if:`
// skipped concludes `skipped` at the run level, not `success`. summarizeRunsForCommit reads that
// as not-green, so a red-then-re-run-green trunk sha stayed blocked for `colab ship`. The template
// therefore gates in a step, exactly as the handbook's own copy does.
const GATE = 'Gate on the triggering CI run';

function runGate(env, text = TEXT) {
  const dir = tmpdir('release-auto-gate-');
  const out = path.join(dir, 'output');
  fs.writeFileSync(out, '');
  const r = spawnSync('bash', ['-c', stepScript(GATE, text)], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: path.join(dir, 'summary') } });
  return { status: r.status, out: fs.readFileSync(out, 'utf8') };
}

test('template: the release job has no job-level if — a red CI run is gated in a step, so the run never concludes skipped (#435)', () => {
  const release = TEXT.slice(TEXT.indexOf('\n  release:\n'), TEXT.indexOf('\n  npm:'));
  assert.ok(release.length > 0, 'release job not found');
  assert.doesNotMatch(release, /^ {4}if:/m, 'job-level if: on the release job');
  // The gate comes before anything that could tag, and the cut step is switched off by it.
  assert.ok(release.indexOf(`- name: ${GATE}`) >= 0, 'no gate step');
  assert.ok(release.indexOf(`- name: ${GATE}`) < release.indexOf(`- name: ${CUT}`), 'gate after cut');
  assert.match(release, /- name: Cut a candidate \(colab release cut --auto\)\n\s+id: cut\n\s+if: steps\.gate\.outputs\.cut == 'true' && /);
});

test('template: the gate step ends green either way — red switches the cut off, green or a non-workflow_run event leaves it on (#435)', () => {
  assert.deepStrictEqual(runGate({ EVENT: 'workflow_run', CONCLUSION: 'failure', HEAD_SHA: 'abc' }), { status: 0, out: 'cut=false\n' });
  assert.deepStrictEqual(runGate({ EVENT: 'workflow_run', CONCLUSION: 'cancelled', HEAD_SHA: 'abc' }), { status: 0, out: 'cut=false\n' });
  assert.deepStrictEqual(runGate({ EVENT: 'workflow_run', CONCLUSION: 'success', HEAD_SHA: 'abc' }), { status: 0, out: 'cut=true\n' });
  assert.deepStrictEqual(runGate({ EVENT: 'schedule', CONCLUSION: '', HEAD_SHA: '' }), { status: 0, out: 'cut=true\n' });
  assert.deepStrictEqual(runGate({ EVENT: 'workflow_dispatch', CONCLUSION: '', HEAD_SHA: '' }), { status: 0, out: 'cut=true\n' });
});

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

test('own copy: gate, cut, finalize and publish are the template\'s steps verbatim', () => {
  for (const step of [GATE, CUT, FIN, 'Publish GitHub Release (same run)']) {
    assert.strictEqual(stepScript(step, OWN), stepScript(step), `step "${step}" drifted from the template`);
  }
});

test('own copy: no job-level if — a red CI run is gated in a step, so the run never concludes skipped', () => {
  // Only the `release` job: the npm jobs (#434) are skipped by a job-level `if:` on purpose — the
  // run still concludes success through `release`, so no skipped row can keep a sha red.
  assert.doesNotMatch(OWN.slice(0, OWN.indexOf('\n  npm:')), /^ {4}if:/m);
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

test("own copy: the npm target and publish steps are the template's, and the job runs on a GitHub-hosted runner (#434)", () => {
  assert.strictEqual(stepScript('Read the npm target (colab release npm)', OWN), stepScript('Read the npm target (colab release npm)'));
  assert.strictEqual(stepScript('Publish each tag (npm publish --provenance)', OWN), stepScript('Publish each tag (npm publish --provenance)'));
  assert.match(OWN, /\n  npm:\n[\s\S]*?runs-on: ubuntu-latest[\s\S]*?id-token: write/);
  assert.doesNotMatch(OWN.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'), /^\s*(NODE_AUTH_TOKEN|NPM_TOKEN):|\$\{\{\s*secrets\./m);
});

test('own copy: the self-audit reads it as a release-auto workflow with nothing to warn about', () => {
  const r = spawnSync('node', [AUDIT, '--local', REPO_ROOT], { encoding: 'utf8' });
  // Not the visibility advisory: it names the npm job's lines whenever the audit cannot read the
  // repository's visibility (no gh auth on a runner) — environment, not a finding about the workflow.
  const text = (r.stdout + r.stderr).split('\n').filter((l) => !/repository visibility could not be read/.test(l)).join('\n');
  assert.doesNotMatch(text, /release-auto\.yml/);
});

// ---------------------------------------------------------------------------------------------
// The npm job (#433): opt-in, GitHub-hosted, trusted publishing only, rc -> next, final -> latest,
// never moves git, refuses a private repo, gates the tarball, records the outcome on the Release.
// Its run blocks are lifted and run against stub `npm` / `gh` / `colab` on PATH.

const NPM_TARGET = 'Read the npm target (colab release npm)';
const REFUSE = 'Refuse a private repository, and any npm token';
const PUBLISH_NPM = 'Publish each tag (npm publish --provenance)';
const RECORD = 'Record the npm outcome';

/** Runs a lifted template step with shell stubs on PATH. `stubs` maps a command to a shell body. */
function runStep(step, { env = {}, stubs = {}, cwd } = {}) {
  const dir = tmpdir('release-auto-npm-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const [cmd, body] of Object.entries(stubs)) {
    fs.writeFileSync(path.join(bin, cmd), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  }
  const out = path.join(dir, 'output');
  const summary = path.join(dir, 'summary');
  fs.writeFileSync(out, '');
  const r = spawnSync('bash', ['-c', stepScript(step)], {
    cwd: cwd || dir,
    encoding: 'utf8',
    env: { ...process.env, NODE_AUTH_TOKEN: '', NPM_TOKEN: '', ...env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary, LOG: path.join(dir, 'log') },
  });
  const o = {};
  for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) o[line.slice(0, eq)] = line.slice(eq + 1);
  }
  const log = path.join(dir, 'log');
  return { status: r.status, output: o, stdout: r.stdout, stderr: r.stderr, dir, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

function colabStub(dir, stdout) {
  const stub = path.join(dir, 'colab-stub.js');
  fs.writeFileSync(stub, `process.stdout.write(${JSON.stringify(stdout)});\n`);
  return stub;
}

test('npm target: a publishing verdict hands tags, directory, gate and package to the npm job', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const d = tmpdir('npm-target-');
  const COLAB = colabStub(d, JSON.stringify({ publish: true, dir: '.', gate: 'node scripts/check-pack-allowlist.mjs', package: '@o/p', why: 'x', findings: [] }));
  const r = runStep(NPM_TARGET, { env: { COLAB, TAGS: 'v1.3.0-rc.1 ' } });
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.output, { publish: 'true', tags: 'v1.3.0-rc.1', dir: '.', gate: 'node scripts/check-pack-allowlist.mjs', package: '@o/p' });
});

test('npm target: not declared, declared-but-broken, or an old CLI — no publish, and the release stays green', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const d = tmpdir('npm-target-');
  const off = runStep(NPM_TARGET, { env: { COLAB: colabStub(d, JSON.stringify({ publish: false, findings: [] })), TAGS: 'v1.3.0' } });
  assert.deepStrictEqual([off.status, off.output], [0, { publish: 'false' }]);
  assert.doesNotMatch(off.stdout, /::warning::/);

  const broken = runStep(NPM_TARGET, { env: { COLAB: colabStub(tmpdir('n-'), JSON.stringify({ publish: false, findings: ['release.npm: ./package.json has no name'] })), TAGS: 'v1.3.0' } });
  assert.deepStrictEqual([broken.status, broken.output], [0, { publish: 'false' }]);
  assert.match(broken.stdout, /::warning::not publishing to npm: release\.npm: \.\/package\.json has no name/);

  const old = runStep(NPM_TARGET, { env: { COLAB: colabStub(tmpdir('n-'), 'Usage: colab release <issue>'), TAGS: 'v1.3.0' } });
  assert.deepStrictEqual([old.status, old.output], [0, { publish: 'false' }]);
  assert.match(old.stdout, /::warning::colab release npm gave no verdict/);
});

test('npm job: a private repository, an unreadable visibility, or a token in the environment is refused', () => {
  const gh = (v) => (v === null ? 'exit 1' : `echo ${v}`);
  assert.strictEqual(runStep(REFUSE, { stubs: { gh: gh('false') }, env: { REPO: 'o/p' } }).status, 0);
  const priv = runStep(REFUSE, { stubs: { gh: gh('true') }, env: { REPO: 'o/p' } });
  assert.notStrictEqual(priv.status, 0);
  assert.match(priv.stdout, /::error::o\/p is private.*never publishes to public npm/);
  assert.notStrictEqual(runStep(REFUSE, { stubs: { gh: gh(null) }, env: { REPO: 'o/p' } }).status, 0, 'unknown visibility fails closed');
  for (const t of ['NODE_AUTH_TOKEN', 'NPM_TOKEN']) {
    const r = runStep(REFUSE, { stubs: { gh: gh('false') }, env: { REPO: 'o/p', [t]: 'npm_xxx' } });
    assert.notStrictEqual(r.status, 0, t);
    assert.match(r.stdout, /trusted publishing \(OIDC\) only and never with a token/);
  }
});

/** A package repo with a candidate and its final tagged, the way release-auto leaves it. */
function packageRepo() {
  const dir = tmpdir('npm-pkg-');
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'npm test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "@o/p" }\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'feat: x');
  g('tag', 'v1.3.0-rc.1');
  g('tag', 'v1.3.0');
  return dir;
}

// npm stub: logs every call; `npm view` says "not published" unless $PUBLISHED names the version.
// `npm pkg set version=X` really stamps package.json, so the gate can be shown to see the stamped version.
const NPM_STUB = 'echo "npm $*" >> "$LOG"; if [ "$1" = pkg ]; then node -e \'const j=require(process.cwd()+"/package.json");j.version=process.argv[1].split("=")[1];require("fs").writeFileSync("package.json",JSON.stringify(j))\' "$3"; exit 0; fi; if [ "$1" = view ]; then case " ${PUBLISHED:-} " in *" ${2##*@} "*) echo "${2##*@}"; exit 0 ;; esac; exit 1; fi; exit 0';

test('npm job: a candidate goes to next and a final to latest, with provenance, gate after the version stamp, git untouched', () => {
  const repo = packageRepo();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' });
  const r = runStep(PUBLISH_NPM, {
    cwd: repo, stubs: { npm: NPM_STUB },
    env: { TAGS: 'v1.3.0-rc.1 v1.3.0', PKG_DIR: '.', PACKAGE: '@o/p', GATE: 'echo "gate $(node -p "require(\'./package.json\').version")" >> "$LOG"' },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const calls = r.log.trim().split('\n');
  assert.deepStrictEqual(calls, [
    'npm view @o/p@1.3.0-rc.1 version',
    'npm pkg set version=1.3.0-rc.1',
    'gate 1.3.0-rc.1',
    'npm publish --tag next --provenance --access public --ignore-scripts',
    'npm view @o/p@1.3.0 version',
    'npm pkg set version=1.3.0',
    'gate 1.3.0',
    'npm publish --tag latest --provenance --access public --ignore-scripts',
  ]);
  assert.strictEqual(execFileSync('git', ['for-each-ref', '--format=%(refname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').sort().join(','),
    'refs/heads/main,refs/tags/v1.3.0,refs/tags/v1.3.0-rc.1', 'no ref created or moved');
  assert.strictEqual(execFileSync('git', ['rev-parse', 'refs/heads/main'], { cwd: repo, encoding: 'utf8' }), head);
});

test('npm job: a version already on npm is skipped, so a re-run never double-publishes', () => {
  const repo = packageRepo();
  const r = runStep(PUBLISH_NPM, { cwd: repo, stubs: { npm: NPM_STUB }, env: { TAGS: 'v1.3.0-rc.1', PKG_DIR: '.', PACKAGE: '@o/p', GATE: 'true', PUBLISHED: '1.3.0-rc.1' } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.log, /npm publish/);
  assert.match(r.stdout, /@o\/p@1\.3\.0-rc\.1 is already on npm — skipping/);
});

test('npm job: a failing gate stops the publish and fails the job', () => {
  const repo = packageRepo();
  const r = runStep(PUBLISH_NPM, { cwd: repo, stubs: { npm: NPM_STUB }, env: { TAGS: 'v1.3.0-rc.1', PKG_DIR: '.', PACKAGE: '@o/p', GATE: 'exit 1' } });
  assert.notStrictEqual(r.status, 0);
  assert.doesNotMatch(r.log, /npm publish/);
});

test('npm-record: published, or tagged-not-published with the re-run hint — replacing its own earlier line', () => {
  const ghStub = 'if [ "$1 $2" = "release view" ]; then cat "$BODY_FILE"; exit 0; fi; if [ "$1 $2" = "release edit" ]; then for a; do [ -n "${next:-}" ] && cp "$a" "$LOG.notes" && exit 0; [ "$a" = --notes-file ] && next=1; done; fi; exit 1';
  const body = path.join(tmpdir('rec-'), 'body');
  fs.writeFileSync(body, '## v1.3.0-rc.1\n\nnotes\n');
  const base = { TAGS: 'v1.3.0-rc.1', REPO: 'o/p', PACKAGE: '@o/p', RUN_URL: 'https://example.invalid/run/1', BODY_FILE: body };

  const failed = runStep(RECORD, { stubs: { gh: ghStub }, env: { ...base, RESULT: 'failure' } });
  assert.strictEqual(failed.status, 0, failed.stderr);
  const failedNotes = fs.readFileSync(path.join(failed.dir, 'log.notes'), 'utf8');
  assert.match(failedNotes, /^## v1\.3\.0-rc\.1\n\nnotes\n/);
  assert.match(failedNotes, /\*\*npm: tagged, not published\*\* \(`@o\/p@1\.3\.0-rc\.1`, job failure\)\. Re-run the failed `npm` job of https:\/\/example\.invalid\/run\/1/);

  fs.writeFileSync(body, failedNotes);
  const ok = runStep(RECORD, { stubs: { gh: ghStub }, env: { ...base, RESULT: 'success' } });
  const okNotes = fs.readFileSync(path.join(ok.dir, 'log.notes'), 'utf8');
  assert.match(okNotes, /npm: published `@o\/p@1\.3\.0-rc\.1` \(dist-tag `next`\)\./);
  assert.doesNotMatch(okNotes, /not published/, 'the re-run replaces the earlier line');
  assert.strictEqual((okNotes.match(/<!-- colab:npm -->/g) || []).length, 1);
});

test('npm job: GitHub-hosted, OIDC only, opt-in, and no token anywhere in the template', () => {
  const lines = TEXT.split('\n');
  const job = (name) => {
    const at = lines.indexOf(`  ${name}:`);
    assert.ok(at >= 0, `job ${name} not found`);
    const end = lines.findIndex((l, i) => i > at && /^ {2}[a-z][\w-]*:\s*$/.test(l));
    return lines.slice(at, end < 0 ? undefined : end).join('\n');
  };
  const npm = job('npm');
  assert.match(npm, /^ {4}runs-on: ubuntu-latest\b/m, 'npm trusted publishing does not support self-hosted runners');
  assert.match(npm, /^ {4}if: needs\.release\.outputs\.npm == 'true'$/m, 'opt-in');
  assert.match(npm, /id-token: write/);
  assert.doesNotMatch(job('release'), /id-token/, 'the OIDC grant lives on the npm job alone');
  assert.doesNotMatch(job('npm-record'), /id-token/);
  const code = lines.filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s#.*$/, '')).join('\n');
  assert.doesNotMatch(code, /secrets\./, 'no stored secret is read — no token fallback');
  assert.doesNotMatch(code, /registry-url/, 'setup-node registry-url writes an .npmrc expecting a token');
});

// ---- #446: deploy-tag-fast — the final is deployed in this run ------------------------------------

const DEPLOY_STEP = 'Deploy the final (EDIT)';
const HEALTH_STEP = 'Verify the health endpoint reports the final';

test('#446 cut step: a fast-route final writes final= and health-url=; a candidate writes neither', { skip: !HAS_JQ && 'jq not installed' }, () => {
  const fin = runWithStub(CUT, { stdout: JSON.stringify({ ok: true, created: true, tag: 'v1.2.1', final: true, deploy: { healthUrl: 'https://app.example/health', rollback: 'auto' }, checks: [] }), exit: 0 });
  assert.strictEqual(fin.status, 0);
  assert.strictEqual(fin.output.tag, 'v1.2.1');
  assert.strictEqual(fin.output.final, 'v1.2.1');
  assert.strictEqual(fin.output['health-url'], 'https://app.example/health');
  const cand = runWithStub(CUT, { stdout: JSON.stringify({ ok: true, created: true, tag: 'v1.2.1-rc.1', final: false, deploy: null, checks: [] }), exit: 0 });
  assert.strictEqual(cand.output.tag, 'v1.2.1-rc.1');
  assert.strictEqual(cand.output.final, undefined);
  // An older CLI prints no `final` key at all — still a candidate.
  const old = runWithStub(CUT, { stdout: JSON.stringify({ ok: true, created: true, tag: 'v1.2.1-rc.1', checks: [] }), exit: 0 });
  assert.strictEqual(old.output.final, undefined);
});

test('#446 template: the deploy job needs release, runs only on a fast final, reads no secret, checks out the tag', () => {
  const job = TEXT.slice(TEXT.indexOf('\n  deploy:\n'));
  assert.ok(job.length > 1, 'no deploy job');
  assert.match(job, /^ {4}needs: release$/m);
  assert.match(job, /^ {4}if: needs\.release\.outputs\.deploy-tag != ''$/m);
  assert.match(job, /contents: read/);
  assert.doesNotMatch(job, /secrets\./);
  assert.match(job, /ref: refs\/tags\/\$\{\{ needs\.release\.outputs\.deploy-tag \}\}/);
  assert.match(TEXT, /deploy-tag: \$\{\{ steps\.cut\.outputs\.final \}\}/);
  assert.match(TEXT, /health-url: \$\{\{ steps\.cut\.outputs\.health-url \}\}/);
  // The own copy is public-tool: it carries the cut step's change but no deploy job.
  assert.doesNotMatch(OWN, /\n {2}deploy:\n/);
});

test('#446 deploy step: unedited, it fails loudly — a final is never reported deployed when nothing deployed it', () => {
  const r = runStep(DEPLOY_STEP, { env: { TAG: 'v1.2.1' } });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /never edited — v1\.2\.1 is tagged and published but NOT deployed/);
});

test('#446 health step: passes once the endpoint reports the version, fails at the timeout', () => {
  const ok = runStep(HEALTH_STEP, { env: { TAG: 'v1.2.1', HEALTH_URL: 'https://app.example/health', HEALTH_TIMEOUT_SECONDS: '0' }, stubs: { curl: 'echo \'{"version":"1.2.1"}\'' } });
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /reports 1\.2\.1/);
  const stale = runStep(HEALTH_STEP, { env: { TAG: 'v1.2.1', HEALTH_URL: 'https://app.example/health', HEALTH_TIMEOUT_SECONDS: '0' }, stubs: { curl: 'echo \'{"version":"1.2.0"}\'' } });
  assert.strictEqual(stale.status, 1);
  assert.match(stale.stdout, /did not report 1\.2\.1 within 0s/);
  const down = runStep(HEALTH_STEP, { env: { TAG: 'v1.2.1', HEALTH_URL: 'https://app.example/health', HEALTH_TIMEOUT_SECONDS: '0' }, stubs: { curl: 'exit 7' } });
  assert.strictEqual(down.status, 1);
});

test('#459 health step: boundary-aware, accepting and rejecting exactly the bodies reportsVersion does', async () => {
  const { reportsVersion } = await import(require('url').pathToFileURL(path.join(REPO_ROOT, 'templates', 'deploy-container-run.mjs')).href);
  const bodies = [
    ['{"version":"1.2.1"}', true],
    ['running v1.2.1.', true],
    ['1.2.1', true],
    ['{"status":"ok"}\n{"version":"1.2.1"}\n', true],
    ['version 1.2.1.\nnext', true],
    ['{"version":"1.2.10"}', false],
    ['{"version":"11.2.1"}', false],
    ['{"version":"1.2.1.4"}', false],
    ['{"version":"1.2.0"}', false],
    ['{"version":"1x2y1"}', false],
    ['{"version":"0.1.2.1"}', false],
  ];
  for (const [body, want] of bodies) {
    assert.strictEqual(reportsVersion(body, '1.2.1'), want, `reportsVersion on ${JSON.stringify(body)}`);
    const file = path.join(tmpdir('release-auto-health-'), 'body');
    fs.writeFileSync(file, body);
    const r = runStep(HEALTH_STEP, { env: { TAG: 'v1.2.1', HEALTH_URL: 'https://app.example/health', HEALTH_TIMEOUT_SECONDS: '0' }, stubs: { curl: `cat '${file}'` } });
    assert.strictEqual(r.status, want ? 0 : 1, `health step on ${JSON.stringify(body)}: ${r.stdout}${r.stderr}`);
  }
});
