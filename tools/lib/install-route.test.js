'use strict';
/** Tests for the declared-tool install-route check — issue #469. Run: node --test tools/lib/install-route.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const route = require('./install-route.js');

function reader(files) {
  const readFile = (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null);
  const listDir = (d) => {
    const pre = d.replace(/\/$/, '') + '/';
    return [...new Set(Object.keys(files).filter((f) => f.startsWith(pre)).map((f) => f.slice(pre.length).split('/')[0]))];
  };
  const workflows = Object.keys(files).filter((f) => f.startsWith('.github/workflows/')).map((f) => path.basename(f));
  return { readFile, listDir, workflows };
}
const pkg = (o) => JSON.stringify(o);
const run = (distribution, files, visibility) => route.findings({ distribution, ...reader(files), visibility });
const PUBLISH = 'on: push\njobs:\n  p:\n    steps:\n      - run: npm publish --access public\n';
const DRY = 'on: push\njobs:\n  p:\n    steps:\n      - run: npm publish --dry-run\n';
const DIST_TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'dist-refs.yml'), 'utf8');
const CALLER = (f) => `on:\n  push:\n    tags: ['v*']\njobs:\n  dist:\n    uses: ./.github/workflows/${f}\n`;
const hit = (f) => f.filter((x) => /no install route/.test(x.text));

test('undeclared → nothing, whatever the repository looks like (a library or an undistributed app)', () => {
  const files = { 'package.json': pkg({ name: 'x', private: true, bin: 'cli.js' }) };
  for (const d of [undefined, null]) {
    for (const v of ['public', 'private', null]) assert.deepStrictEqual(run(d, files, v), []);
  }
  assert.deepStrictEqual(run(undefined, {}, null), []);
});

test('an invalid value is the enum check\'s job, not this module\'s', () => {
  assert.deepStrictEqual(run('tool', {}, 'private'), []);
});

test('js / private: root bin is the route', () => {
  assert.deepStrictEqual(run('js', { 'package.json': pkg({ private: true, bin: 'cli.js' }) }, 'private'), []);
  assert.deepStrictEqual(run('js', { 'package.json': pkg({ private: true, bin: { x: 'cli.js' } }) }, 'internal'), []);
  const f = run('js', { 'package.json': pkg({ private: true }) }, 'private');
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].level, 'warn');
  assert.match(f[0].text, /no install route/);
  assert.match(f[0].text, /root package\.json has no bin/);
  assert.strictEqual(run('js', { 'package.json': pkg({ private: true, bin: {} }) }, 'private').length, 1);
  assert.strictEqual(run('js', {}, 'private').length, 1);
});

test('js / public: a publish step and a non-private manifest with a bin', () => {
  const ok = { 'package.json': pkg({ name: '@o/x', bin: 'cli.js' }), '.github/workflows/rel.yml': PUBLISH };
  assert.deepStrictEqual(run('js', ok, 'public'), []);
  const noPub = run('js', { 'package.json': pkg({ name: '@o/x', bin: 'cli.js' }) }, 'public');
  assert.strictEqual(noPub.length, 1);
  assert.match(noPub[0].text, /no workflow step publishes to npm/);
  const dry = run('js', { 'package.json': pkg({ name: '@o/x', bin: 'cli.js' }), '.github/workflows/rel.yml': DRY }, 'public');
  assert.strictEqual(dry.length, 1);
  const priv = run('js', { 'package.json': pkg({ name: '@o/x', private: true, bin: 'cli.js' }), '.github/workflows/rel.yml': PUBLISH }, 'public');
  assert.strictEqual(priv.length, 1);
  assert.match(priv[0].text, /no non-private package\.json has a bin/);
});

test('js / public: a workspace member with a bin counts', () => {
  const files = {
    'package.json': pkg({ private: true, workspaces: ['packages/*'] }),
    'packages/cli/package.json': pkg({ name: '@o/cli', bin: 'cli.js' }),
    '.github/workflows/rel.yml': PUBLISH,
  };
  assert.deepStrictEqual(run('js', files, 'public'), []);
});

test('compiled / private: root bin plus a workflow calling the dist-refs template', () => {
  const ok = {
    'package.json': pkg({ private: true, bin: 'launcher.mjs' }),
    '.github/workflows/release.yml': CALLER('dist-refs.yml'),
    '.github/workflows/dist-refs.yml': DIST_TEMPLATE,
  };
  assert.deepStrictEqual(run('compiled', ok, 'private'), []);

  const uncalled = { ...ok, '.github/workflows/release.yml': 'on: push\njobs:\n  b:\n    steps:\n      - run: make\n' };
  const f = run('compiled', uncalled, 'private');
  assert.strictEqual(f.length, 1);
  assert.match(f[0].text, /no workflow calls a dist-refs workflow/);

  const renamed = {
    'package.json': pkg({ private: true, bin: 'launcher.mjs' }),
    '.github/workflows/release.yml': CALLER('ship-bins.yml'),
    '.github/workflows/ship-bins.yml': 'on:\n  workflow_call:\njobs:\n  p:\n    steps:\n      - run: git push origin "HEAD:refs/tags/dist/$V/$P"\n',
  };
  assert.deepStrictEqual(run('compiled', renamed, 'private'), []);

  const noBin = { ...ok, 'package.json': pkg({ private: true }) };
  const nb = run('compiled', noBin, 'private');
  assert.strictEqual(nb.length, 1);
  assert.match(nb[0].text, /root package\.json has no bin/);
  assert.doesNotMatch(nb[0].text, /dist-refs workflow/);
});

test('compiled / private: a caller pointing at a file that is not a dist-refs workflow is not a route', () => {
  const files = {
    'package.json': pkg({ private: true, bin: 'launcher.mjs' }),
    '.github/workflows/release.yml': CALLER('build.yml'),
    '.github/workflows/build.yml': 'on:\n  workflow_call:\njobs:\n  b:\n    steps:\n      - run: make # pushes refs/tags/dist/ later\n',
  };
  assert.strictEqual(run('compiled', files, 'private').length, 1);
});

test('compiled / private: an inlined (non-reusable) workflow pushing dist refs counts', () => {
  const files = {
    'package.json': pkg({ private: true, bin: 'launcher.mjs' }),
    '.github/workflows/release.yml': 'on:\n  push:\n    tags: ["v*"]\njobs:\n  p:\n    steps:\n      - run: git push origin "HEAD:refs/tags/dist/$V/$P"\n',
  };
  assert.deepStrictEqual(run('compiled', files, 'private'), []);
});

test('compiled / public: publish step plus a bin manifest with per-platform optionalDependencies', () => {
  const ok = {
    'package.json': pkg({ name: '@o/x', bin: 'run.js', optionalDependencies: { '@o/x-linux-x64': '1.0.0' } }),
    '.github/workflows/rel.yml': PUBLISH,
  };
  assert.deepStrictEqual(run('compiled', ok, 'public'), []);
  const f = run('compiled', { ...ok, 'package.json': pkg({ name: '@o/x', bin: 'run.js' }) }, 'public');
  assert.strictEqual(f.length, 1);
  assert.match(f[0].text, /optionalDependencies/);
});

test('unknown visibility: either row\'s evidence clears it; neither → one warn saying so', () => {
  assert.deepStrictEqual(run('js', { 'package.json': pkg({ private: true, bin: 'cli.js' }) }, null), []);
  const f = run('compiled', {}, null);
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].level, 'warn');
  assert.match(f[0].text, /visibility could not be read/);
  assert.match(f[0].text, /no install route/);
});

test('VALID_DISTRIBUTION is exactly the two §6 columns', () => {
  assert.deepStrictEqual(route.VALID_DISTRIBUTION, new Set(['js', 'compiled']));
});

test('the dist-refs template is reusable, so a copy alone never reads as an inlined route', () => {
  const files = { 'package.json': pkg({ private: true, bin: 'l.mjs' }), '.github/workflows/dist-refs.yml': DIST_TEMPLATE };
  assert.deepStrictEqual(route.distRefsCallers(reader(files).workflows, reader(files).readFile), []);
  assert.strictEqual(hit(run('compiled', files, 'private')).length, 1);
});
