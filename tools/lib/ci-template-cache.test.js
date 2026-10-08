'use strict';
/**
 * The CI templates' package caches (#571) are on only where they are safe:
 *   - GitHub-hosted runner — a persistent self-hosted runner already keeps its local cache, and a
 *     remote cache on top was measured as a loss (#512);
 *   - the dependency file the cache keys on exists — `setup-node`'s `cache:` and `setup-python`'s
 *     `cache: pip` fail the step outright without one, and the templates allow a repo without one.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Pinned, per template, with the same line scan as ci-template-timeouts.test.js (no YAML dependency):
 *   - every cache-bearing input / step condition is EVALUATED for each combination of
 *     runner.environment × which files exist, not grepped for a substring: cache on iff hosted
 *     AND the lockfile is present;
 *   - setup-node's automatic `package-manager-cache` follows the same condition, so it can never
 *     switch caching back on where `cache:` says off;
 *   - the step names `colab ship`'s cure rule matches by exact name are still there, and the only
 *     new steps are the gated cache steps;
 *   - each cache carries an `EDIT:` note naming self-hosted.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');

// Top-level jobs as { name: [lines] }. `uncomment` strips the `  # ` fence of an opt-in block.
function jobsOf(text, { uncomment = false } = {}) {
  let lines = text.split(/\r?\n/);
  if (uncomment) lines = lines.map((l) => (/^  # {2}/.test(l) || /^  # [a-z]/.test(l) ? '  ' + l.slice(4) : l));
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.notStrictEqual(at, -1, 'no jobs: block');
  const jobs = {};
  let cur = null;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (m) { cur = m[1]; jobs[cur] = []; continue; }
    if (cur) jobs[cur].push(l);
  }
  return jobs;
}

// Steps of a job body: { name, uses, if, with: {k: v}, comments: [preceding comment lines] }.
function stepsOf(body) {
  const steps = [];
  let cur = null;
  let pending = [];
  let inWith = false;
  for (const l of body) {
    if (/^ {6}#/.test(l)) { pending.push(l); continue; }
    const start = l.match(/^ {6}- (.*)$/);
    if (start) {
      cur = { name: null, uses: null, if: null, with: {}, comments: pending };
      pending = [];
      inWith = false;
      steps.push(cur);
      const kv = start[1].match(/^([a-z-]+):\s*(.*)$/);
      if (kv) cur[kv[1]] = kv[2];
      continue;
    }
    if (!cur) continue;
    const top = l.match(/^ {8}([a-z-]+):\s*(.*)$/);
    if (top) { inWith = top[1] === 'with'; if (!inWith) cur[top[1]] = top[2]; continue; }
    const w = inWith && l.match(/^ {10}([a-z-]+):\s*(.*)$/);
    if (w) cur.with[w[1]] = w[2];
    if (/^\S|^ {0,5}\S/.test(l)) { cur = null; inWith = false; }
  }
  for (const s of steps) if (s.uses) s.uses = s.uses.replace(/\s+#.*$/, '');
  return steps;
}

// Evaluate a GitHub expression of the shape these templates use: runner.environment, hashFiles(),
// string literals, ==/!=, &&/||, true/false. `files` is the set of root files that exist; a
// hashFiles() argument is a glob matched against it.
function evalExpr(src, { env, files }) {
  const expr = src.trim().replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const glob = (g) => new RegExp('^' + g.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
  const hash = (...gs) => (files.some((f) => gs.some((g) => glob(g).test(f))) ? 'h' : '');
  const js = expr
    .replace(/runner\.environment/g, JSON.stringify(env))
    .replace(/==/g, '===').replace(/!===/g, '!==');
  assert.ok(/^[\w\s'".*,()=!&|$-]*$/.test(js), `unexpected token in expression: ${expr}`);
  // eslint-disable-next-line no-new-func
  return Function('hashFiles', `return (${js});`)(hash);
}

const truthy = (v) => v !== '' && v !== false && v !== 'false' && v != null;
const ENVS = ['github-hosted', 'self-hosted'];

// [file, job, uncomment, find step, lockfile(s) that turn it on, other files that must not,
//  the `cache:` value when on]
const SETUP_CASES = [
  ['templates/ci-node.yml', 'build', false, (s) => s.name === 'Setup Node', ['package-lock.json'], ['package.json', 'pnpm-lock.yaml'], 'npm'],
  ['templates/ci-node.yml', 'migrations', true, (s) => s.name === 'Setup Node', ['package-lock.json'], ['package.json', 'pnpm-lock.yaml'], 'npm'],
  ['templates/ci-laravel.yml', 'build', false, (s) => /actions\/setup-node@/.test(s.uses || ''), ['package-lock.json'], ['package.json', 'composer.lock'], 'npm'],
  ['templates/ci-python.yml', 'build', false, (s) => /actions\/setup-python@/.test(s.uses || ''), ['requirements.txt', 'requirements-dev.txt', 'pyproject.toml'], ['setup.py', 'setup.cfg'], 'pip'],
];

for (const [file, job, uncomment, find, onFiles, offFiles, value] of SETUP_CASES) {
  const label = `${file} ${job}${uncomment ? ' (opt-in block)' : ''}`;
  test(`${label}: package cache on iff GitHub-hosted AND a lockfile exists`, () => {
    const jobs = jobsOf(read(file), { uncomment });
    assert.ok(jobs[job], `${file} has no ${job} job`);
    const step = stepsOf(jobs[job]).find(find);
    assert.ok(step, `${label} has no setup step`);
    assert.ok(step.with.cache, `${label} setup step has no cache: input`);
    const isNode = /setup-node/.test(step.uses || '');
    if (isNode) assert.ok(step.with['package-manager-cache'], `${label} leaves setup-node's automatic packageManager cache ungated`);
    const fileSets = [[], offFiles, ...onFiles.map((f) => [f]), ...onFiles.map((f) => [f, ...offFiles])];
    for (const env of ENVS) {
      for (const files of fileSets) {
        const want = env === 'github-hosted' && files.some((f) => onFiles.includes(f));
        const got = evalExpr(step.with.cache, { env, files });
        assert.strictEqual(got, want ? value : '', `${label} cache: on ${env} with [${files}] → ${JSON.stringify(got)}`);
        if (isNode) {
          const pmc = evalExpr(step.with['package-manager-cache'], { env, files });
          assert.strictEqual(truthy(pmc), want, `${label} package-manager-cache on ${env} with [${files}] → ${pmc}`);
        }
      }
    }
    assert.ok(step.comments.some((l) => /EDIT:/.test(l)) || uncomment, `${label} cache has no EDIT: note`);
  });
}

test('templates/ci-python.yml: cache-dependency-path names the same manifests the gate checks', () => {
  const body = jobsOf(read('templates/ci-python.yml')).build;
  const at = body.findIndex((l) => /cache-dependency-path:\s*\|/.test(l));
  assert.notStrictEqual(at, -1, 'no multi-line cache-dependency-path');
  const listed = [];
  for (let i = at + 1; i < body.length && /^ {12}\S/.test(body[i]); i++) listed.push(body[i].trim());
  assert.deepStrictEqual(listed.sort(), ['pyproject.toml', 'requirements*.txt']);
});

test('templates/ci-laravel.yml: Composer cache steps run iff GitHub-hosted AND composer.lock exists', () => {
  const steps = stepsOf(jobsOf(read('templates/ci-laravel.yml')).build);
  const names = steps.map((s) => s.name);
  const locate = steps.find((s) => s.name === 'Locate Composer cache');
  const restore = steps.find((s) => s.name === 'Restore Composer cache');
  assert.ok(locate && restore, 'Composer cache steps missing');
  assert.ok(/^actions\/cache@[0-9a-f]{40}$/.test(restore.uses), `actions/cache is not pinned by sha: ${restore.uses}`);
  assert.ok(names.indexOf('Restore Composer cache') < names.indexOf('Composer install'), 'cache restore must precede Composer install');
  for (const s of [locate, restore]) {
    for (const env of ENVS) {
      for (const files of [[], ['composer.json'], ['composer.lock'], ['composer.json', 'composer.lock']]) {
        const want = env === 'github-hosted' && files.includes('composer.lock');
        assert.strictEqual(evalExpr(s.if, { env, files }), want, `${s.name} if: on ${env} with [${files}]`);
      }
    }
  }
  assert.ok(/hashFiles\('composer\.lock'\)/.test(restore.with.key), 'cache key does not hash composer.lock');
  assert.ok(locate.comments.some((l) => /EDIT:/.test(l) && /self-hosted/i.test(l)) ||
    locate.comments.join('\n').match(/EDIT:[\s\S]*self-hosted/), 'Composer cache has no self-hosted EDIT: note');
});

// The names `colab ship`'s cure rule matches by exact name (#475/#476: executed-step superset).
// Renaming one of these is an instrument change, so this list moves only on purpose.
const KEPT_NAMES = {
  'templates/ci-node.yml': ['Resolve Node version', 'Setup Node', 'Install dependencies', 'Detect optional scripts', 'Typecheck', 'Lint', 'Test', 'Build'],
  'templates/ci-python.yml': ['Resolve Python version', 'Install dependencies', 'Byte-compile', 'Detect optional tooling', 'Lint (ruff)', 'Typecheck (mypy)', 'Test (pytest)'],
  'templates/ci-laravel.yml': ['Resolve toolchain versions', 'Setup PHP', 'Composer install', 'Build frontend assets (Vite)', 'Run migrations against sqlite', 'Test (Pest)'],
};
const NEW_CACHE_STEPS = new Set(['Locate Composer cache', 'Restore Composer cache']);

for (const [file, kept] of Object.entries(KEPT_NAMES)) {
  test(`${file}: build step names the cure rule reads are unchanged; only gated cache steps are new`, () => {
    const steps = stepsOf(jobsOf(read(file)).build);
    const names = steps.map((s) => s.name).filter(Boolean);
    for (const n of kept) assert.ok(names.includes(n), `${file} build lost step "${n}"`);
    for (const s of steps.filter((x) => /cache/i.test(x.name || ''))) {
      assert.ok(NEW_CACHE_STEPS.has(s.name), `${file} has an unexpected cache step "${s.name}"`);
      assert.ok(/runner\.environment == 'github-hosted'/.test(s.if || ''), `${file} "${s.name}" runs on self-hosted`);
    }
  });
}

test('the expression evaluator is not vacuous (guards the test itself)', () => {
  const e = "${{ runner.environment == 'github-hosted' && hashFiles('package-lock.json') != '' && 'npm' || '' }}";
  assert.strictEqual(evalExpr(e, { env: 'github-hosted', files: ['package-lock.json'] }), 'npm');
  assert.strictEqual(evalExpr(e, { env: 'github-hosted', files: ['package.json'] }), '');
  assert.strictEqual(evalExpr(e, { env: 'self-hosted', files: ['package-lock.json'] }), '');
  assert.strictEqual(evalExpr("hashFiles('requirements*.txt', 'pyproject.toml') != ''", { env: 'x', files: ['requirements-dev.txt'] }), true);
});
