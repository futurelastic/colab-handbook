'use strict';
/**
 * templates/deploy-container.yml (#452): its triggers, its tag resolution, its concurrency, the
 * secrets it reads, its recognition as a copy, and release-auto's commented job that calls it.
 *
 * Run: `node --test tools/lib/*.test.js`. The schema is actionlint's (CI); this checks behaviour —
 * the tag step's `run:` block is lifted out of the template text and run under bash.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const stamp = require('./stamp.js');
const { parseWorkflowOn, workflowFiresOnTag, prereleaseTagTriggers } = require('./workflow-triggers.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEXT = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'deploy-container.yml'), 'utf8');
const AUTO = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'release-auto.yml'), 'utf8');

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

function resolveTag({ input = '', refName = '' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-container-tag-'));
  const out = path.join(dir, 'out');
  fs.writeFileSync(out, '');
  const r = spawnSync('bash', ['-c', stepScript('Resolve the tag to deploy')], {
    encoding: 'utf8', env: { ...process.env, INPUT_TAG: input, GITHUB_REF_NAME: refName, GITHUB_OUTPUT: out },
  });
  const written = fs.readFileSync(out, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, output: written };
}

test('template: tag triggers exclude pre-releases — a candidate never deploys', () => {
  const on = parseWorkflowOn(TEXT);
  assert.ok(workflowFiresOnTag(on, 'v1.2.3'));
  assert.ok(!workflowFiresOnTag(on, 'v1.2.3-rc.1'));
  const files = { 'deploy-container.yml': TEXT };
  assert.deepEqual(prereleaseTagTriggers({ readFile: (p) => files[path.basename(p)], workflows: ['deploy-container.yml'], deploy: 'tag' }), []);
  for (const ev of ['push', 'workflow_dispatch', 'workflow_call']) assert.ok(on.events.has(ev), ev);
});

test('template: workflow_call, workflow_dispatch and push all resolve to one tag; a -rc or branch ref is refused', () => {
  assert.equal(resolveTag({ input: 'v1.2.3', refName: 'main' }).output, 'tag=v1.2.3\n'); // call / dispatch
  assert.equal(resolveTag({ refName: 'v2.0.1' }).output, 'tag=v2.0.1\n'); // push: tags
  for (const [label, args] of [
    ['candidate', { refName: 'v1.2.3-rc.1' }],
    ['branch', { refName: 'main' }],
    ['dispatch candidate', { input: 'v1.2.3-rc.2' }],
    ['injection', { input: 'v1.2.3; rm -rf /' }],
  ]) {
    const r = resolveTag(args);
    assert.notEqual(r.status, 0, label);
    assert.equal(r.output, '', label);
    assert.match(r.stdout, /::error::.*is not a final tag/, label);
  }
});

test('template: concurrency never cancels a deploy half-way, and its group does not depend on the caller', () => {
  assert.match(TEXT, /^concurrency:\n {2}group: deploy-container-\$\{\{ github\.repository \}\}\n {2}cancel-in-progress: false$/m);
});

test('template: reads only the named secrets', () => {
  const secrets = [...new Set([...TEXT.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(secrets, ['HEALTH_AUTH_HEADER', 'HEALTH_BASIC_AUTH', 'PORTAINER_API_KEY', 'REGISTRY_PASSWORD']);
  // Every secret it reads, a workflow_call caller can pass (secrets: inherit or by name).
  const call = TEXT.slice(TEXT.indexOf('  workflow_call:'), TEXT.indexOf('\nconcurrency:'));
  for (const sname of secrets) assert.match(call, new RegExp(`^ {6}${sname}:\\n {8}required: false$`, 'm'), sname);
  // The tag reaches the driver through env, never interpolated into the shell line.
  assert.match(TEXT, /run: node \.github\/deploy\/deploy-container-run\.mjs --tag "\$TAG" --publish-only$/m);
  assert.match(TEXT, /run: node \.github\/deploy\/deploy-container-run\.mjs --tag "\$TAG" --deploy-only$/m);
});

/** The text of one top-level job, `  <name>:` up to the next job or the end. */
function job(name) {
  const at = TEXT.indexOf(`\n  ${name}:\n`, TEXT.indexOf('\njobs:\n'));
  assert.ok(at >= 0, `job ${name}`);
  const rest = TEXT.slice(at + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test('template (#460): publish runs on every final, ungated; deploy needs it and never builds', () => {
  const pub = job('publish');
  const dep = job('deploy');
  assert.doesNotMatch(pub, /^ {4}if:/m, 'publish is never gated on the platform');
  assert.doesNotMatch(pub, /^ {4}environment:/m, 'publish needs no platform environment');
  assert.doesNotMatch(pub, /PORTAINER|HEALTH_/, 'publish reads no platform or health configuration');
  assert.match(pub, /--publish-only/);
  assert.match(pub, /^ {6}packages: write/m);
  assert.match(pub, /^ {6}tag: \$\{\{ steps\.tag\.outputs\.tag \}\}$/m, 'publish hands the resolved tag on');
  assert.match(dep, /^ {4}needs: publish$/m);
  assert.match(dep, /--deploy-only/);
  assert.doesNotMatch(dep, /--publish-only|- name: Resolve the tag/);
  assert.match(dep, /^ {6}packages: read/m, 'deploy only reads the registry');
  assert.match(dep, /ref: refs\/tags\/\$\{\{ needs\.publish\.outputs\.tag \}\}/);
  assert.match(dep, /TAG: \$\{\{ needs\.publish\.outputs\.tag \}\}/);
  // Images and build args are written once, read by both jobs.
  const wfEnv = TEXT.slice(TEXT.indexOf('\nenv:\n'), TEXT.indexOf('\njobs:\n'));
  assert.match(wfEnv, /^ {2}DEPLOY_IMAGES: \|$/m);
  assert.match(wfEnv, /^ {2}DEPLOY_BUILD_ARGS: ""/m);
  assert.doesNotMatch(TEXT.slice(TEXT.indexOf('\njobs:\n')), /DEPLOY_IMAGES:|DEPLOY_BUILD_ARGS:/);
});

test('template: recognised as a deploy-container copy, and its scripts sit beside it under .github/deploy/', () => {
  const prov = stamp.workflowProvenance(TEXT, 'whatever', new Set(['deploy-container']));
  assert.equal(prov.origin, 'derived');
  assert.equal(prov.template, 'deploy-container');
  for (const f of ['deploy-container-run.mjs', 'deploy-adapter-portainer.mjs']) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, 'templates', f)), f);
    assert.match(fs.readFileSync(path.join(REPO_ROOT, 'templates', f), 'utf8'), /^#!\/usr\/bin\/env node\n/, `${f} opens with a shebang (stamp goes on line 2)`);
  }
});

test("template: release-auto's commented block calls deploy-container.yml with needs.release.outputs.deploy-tag", () => {
  const at = AUTO.indexOf('\n  # deploy:\n');
  assert.ok(at > AUTO.indexOf('\n  deploy:\n'), 'the commented job follows the live #446 job');
  const job = AUTO.slice(at + 1).split('\n').filter((l) => l.startsWith('  # ')).map((l) => l.slice(4)).join('\n');
  assert.match(job, /^ {2}needs: release$/m);
  assert.match(job, /^ {2}if: needs\.release\.outputs\.deploy-tag != ''$/m);
  assert.match(job, /^ {2}uses: \.\/\.github\/workflows\/deploy-container\.yml$/m);
  assert.match(job, /^ {4}tag: \$\{\{ needs\.release\.outputs\.deploy-tag \}\}$/m);
  assert.match(job, /^ {4}health-url: \$\{\{ needs\.release\.outputs\.health-url \}\}$/m);
  for (const p of ['contents: read', 'packages: write', 'issues: write']) assert.match(job, new RegExp(`^ {4}${p}$`, 'm'), p);
  assert.doesNotMatch(job, /was never edited/);
  // The called workflow declares exactly the inputs the job passes.
  assert.match(TEXT, /workflow_call:\n {4}inputs:\n {6}tag:[\s\S]*? {6}health-url:/);
});
