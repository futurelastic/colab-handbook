'use strict';
/**
 * #453: the release workflow on a private repo runs on the repo's own runners.
 * Run: `node --test tools/lib/release-runner.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const rr = require('./release-runner.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'release-auto.yml'), 'utf8');

const CI_SELF = `name: CI
on: push
jobs:
  test:
    runs-on: [self-hosted, linux, trunk]
    steps: []
`;

function reader(files) {
  return { readFile: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null), workflows: Object.keys(files).map((p) => path.basename(p)) };
}

test('jobRunners reads scalar, flow-list and block-list runs-on, and skips expressions', () => {
  const text = `jobs:
  a:
    runs-on: ubuntu-latest # comment
  b:
    runs-on: [self-hosted, "linux"]
  c:
    runs-on:
      - self-hosted
      - x64
  d:
    runs-on: \${{ matrix.os }}
  e:
    runs-on: ubuntu-24.04
    steps:
      - run: npm publish --provenance
`;
  const j = Object.fromEntries(rr.jobRunners(text).map((x) => [x.job, x]));
  assert.deepStrictEqual(j.a.runsOn, ['ubuntu-latest']);
  assert.strictEqual(j.a.hosted, true);
  assert.deepStrictEqual(j.b.runsOn, ['self-hosted', 'linux']);
  assert.strictEqual(j.b.hosted, false);
  assert.deepStrictEqual(j.c.runsOn, ['self-hosted', 'x64']);
  assert.strictEqual(j.d.runsOn, null);
  assert.strictEqual(j.d.hosted, false);
  assert.strictEqual(j.e.hosted, true);
  assert.strictEqual(j.e.publishesNpm, true);
});

test('the template as shipped: release and npm-record are hosted (the edit point), npm is the publish job', () => {
  const j = Object.fromEntries(rr.jobRunners(TEMPLATE).map((x) => [x.job, x]));
  assert.ok(j.release && j['npm-record'] && j.npm, 'release, npm, npm-record jobs are present');
  assert.strictEqual(j.npm.publishesNpm, true, 'the npm job is recognised as the publish job (exempt)');
  assert.strictEqual(j.release.publishesNpm, false);
  assert.strictEqual(j['npm-record'].publishesNpm, false);
});

test('the template carries the RUNNERS section and points both EDIT points at it', () => {
  assert.match(TEMPLATE, /^# RUNNERS — ON A PRIVATE REPO, YOUR OWN \(#453\)/m);
  assert.match(TEMPLATE, /EDIT: PRIVATE repo → your ci\.yml's self-hosted trunk label/);
  assert.match(TEMPLATE, /EDIT: the same label as `release` above — PRIVATE repo → self-hosted/);
});

test('private repo + template copy unedited → one advisory per hosted job, npm exempt, label suggested from ci.yml', () => {
  const r = reader({ '.github/workflows/ci.yml': CI_SELF, '.github/workflows/release-auto.yml': TEMPLATE });
  const out = rr.findings({ ...r, visibility: 'private' });
  const jobs = out.map((t) => t.match(/job `([^`]+)`/)[1]).sort();
  assert.deepStrictEqual(jobs, ['deploy', 'npm-record', 'release']);
  for (const t of out) {
    assert.match(t, /runs-on: \[self-hosted, linux, trunk\]/);
    assert.match(t, /ci\.yml/);
    assert.match(t, /billing refusal/);
  }
});

test('internal counts as private; PRIVATE (forge casing) too', () => {
  const r = reader({ '.github/workflows/release-auto.yml': TEMPLATE });
  assert.ok(rr.findings({ ...r, visibility: 'internal' }).length > 0);
  assert.ok(rr.findings({ ...r, visibility: 'PRIVATE' }).length > 0);
});

test('no self-hosted label anywhere → generic hint, still reported', () => {
  const r = reader({ '.github/workflows/release-auto.yml': TEMPLATE });
  const out = rr.findings({ ...r, visibility: 'private' });
  assert.ok(out.length > 0);
  assert.match(out[0], /use your self-hosted trunk runner label/);
});

test('public or unknown visibility → nothing', () => {
  const r = reader({ '.github/workflows/ci.yml': CI_SELF, '.github/workflows/release-auto.yml': TEMPLATE });
  assert.deepStrictEqual(rr.findings({ ...r, visibility: 'public' }), []);
  assert.deepStrictEqual(rr.findings({ ...r, visibility: null }), []);
});

test('edited copy on self-hosted → nothing; a workflow not running release --auto is not judged', () => {
  const edited = TEMPLATE.replace(/^ {4}runs-on: ubuntu-latest\s*$/gm, '    runs-on: [self-hosted, linux, trunk]')
    .replace(/^ {4}runs-on: ubuntu-latest # EDIT: the runner your deploy needs.*$/m, '    runs-on: [self-hosted, linux, trunk]');
  const r = reader({ '.github/workflows/release-auto.yml': edited, '.github/workflows/lint.yml': 'jobs:\n  l:\n    runs-on: ubuntu-latest\n' });
  assert.deepStrictEqual(rr.findings({ ...r, visibility: 'private' }), []);
});
