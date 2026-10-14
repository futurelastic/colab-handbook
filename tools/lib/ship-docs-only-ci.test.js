'use strict';
/**
 * End-to-end tests for #606 — `colab ship` decides docs-only, and a docs-only change does not wait
 * for CI: the branch's own run is not required (a red one that exists still refuses), trunk CI on a
 * docs-only tip is read at the newest code commit (`colab trunk-ci` too), and a secret check runs
 * on the added lines before the merge.
 *
 * Real CLI, real repo, real bare `origin`; `gh` is a node stub whose run answers come from a state
 * file each test writes — keyed by `--branch <ref>` and by `--commit <sha>`.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const SESSION = 'https://claude.ai/code/session_docs_only_ci_S';
const YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n';
// Built at run time, so no scanner reading this file finds a credential shape in it.
const FAKE_AWS = ['AKIA', 'Q3EXAMPLE7FIXTURE0'].join('').slice(0, 20);

const TMP = [];
process.on('exit', () => { for (const dir of TMP) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} } });

const GH_STUB = (state, log, origin) => `#!/usr/bin/env node
const fs = require('fs');
const { execFileSync } = require('child_process');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(' ') + '\\n');
const st = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const out = (x) => { process.stdout.write(typeof x === 'string' ? x + '\\n' : JSON.stringify(x) + '\\n'); process.exit(0); };
if (a[0] === '--version') out('gh version 0.0.0 (fixture)');
if (a[0] === 'auth') process.exit(0);
if (a[0] === 'api' && a[1] === 'user') out('me');
if (a[0] === 'run' && a[1] === 'list') {
  const br = val('--branch');
  const commit = val('--commit');
  let sha = commit;
  if (!sha) { try { sha = execFileSync('git', ['rev-parse', 'refs/heads/' + br], { cwd: ${JSON.stringify(origin)}, encoding: 'utf8' }).trim(); } catch (_) { out('[]'); } }
  const s = commit ? (st.commits || {})[commit] ?? st.commitDefault : (st.branches || {})[br];
  const r = s === undefined ? { status: 'completed', conclusion: 'success' } : s;
  if (r === 'none') out('[]');
  out([{ headSha: sha, status: r.status, conclusion: r.conclusion, databaseId: 7, workflowName: 'CI', event: 'push',
    createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:01:00Z', attempt: 1 }]);
}
if (a[0] === 'issue' && a[1] === 'view') out({ state: 'OPEN', labels: [], comments: [{ body: 'fixture' }], body: '' });
if (a[0] === 'issue' || a[0] === 'label') process.exit(0);
process.stderr.write('fixture gh: refusing ' + a.join(' ') + '\\n');
process.exit(1);
`;

function fixture(yml = YML, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-docs-ci-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghLog = path.join(root, 'gh.log');
  const state = path.join(root, 'gh-state.json');
  fs.mkdirSync(home);
  fs.writeFileSync(state, '{}');
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'docs-only ci test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), yml);
  fs.writeFileSync(path.join(work, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\njobs: {}\n');
  for (const [p, body] of Object.entries(extra)) fs.writeFileSync(path.join(work, p), body);
  fs.writeFileSync(path.join(work, 'f.js'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), GH_STUB(state, ghLog, origin), { mode: 0o755 });
  const setState = (s) => fs.writeFileSync(state, JSON.stringify(s));
  return { root, work, origin, home, bin, ghLog, g, setState };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: fx.home, COLAB_HOME: fx.home,
      COLAB_SESSION: SESSION, COLAB_SESSION_NAME: '', COLAB_HUMAN: '',
    },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** A branch off main carrying `files`, claimed as `num`, then pushed to origin; main checked out. */
function branch(fx, name, num, files) {
  fx.g(fx.work, 'branch', name);
  assert.strictEqual(colab(fx, ['claim', String(num), '--branch', name, '--repo', fx.work]).code, 0);
  fx.g(fx.work, 'checkout', '-q', name);
  for (const [p, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(fx.work, p)), { recursive: true });
    fs.writeFileSync(path.join(fx.work, p), body);
  }
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', `docs: change (#${num})`);
  fx.g(fx.work, 'push', '-q', 'origin', name);
  fx.g(fx.work, 'checkout', '-q', 'main');
}

/** Move trunk on by one CODE commit after the branch was cut — the branch run is then stale-base. */
function advanceTrunk(fx) {
  fs.writeFileSync(path.join(fx.work, 'f.js'), 'moved\n');
  fx.g(fx.work, 'commit', '-q', '-am', 'feat: trunk moved');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  fx.g(fx.work, 'fetch', '-q', 'origin');
}

function dry(fx, name) {
  const r = colab(fx, ['ship', '--branch', name, '--repo', fx.work, '--dry', '--json']);
  const j = JSON.parse(r.out);
  return { j, row: (n) => j.checks.find((c) => c.name === n) };
}

const DOCS_ROW = 'branch CI (docs-only, #606)';
const SCAN_ROW = 'docs-only secret check (#606)';
const STALE_ROW = 'branch run contains current base (#395)';

test('#606: a docs-only branch with NO CI run ships, and the 🚢 evidence says CI was not required', () => {
  const fx = fixture();
  branch(fx, 'docs/readme-61', 61, { 'README.md': 'hello\n' });
  fx.setState({ branches: { 'docs/readme-61': 'none' } });
  const d = dry(fx, 'docs/readme-61');
  assert.strictEqual(d.row(DOCS_ROW).ok, true, JSON.stringify(d.j.checks));
  assert.match(d.row(DOCS_ROW).detail, /^docs-only: CI not required \(1 files\)/);
  assert.strictEqual(d.row(SCAN_ROW).ok, true);
  assert.strictEqual(d.row(STALE_ROW), undefined, 'the docs-only row replaces the stale-base row');
  const r = colab(fx, ['ship', '--branch', 'docs/readme-61', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const log = fs.readFileSync(fx.ghLog, 'utf8');
  assert.match(log, /Shipped to main by colab ship .* — docs-only: CI not required \(1 files\) — trunk CI read at its tip; secret check clean/);
});

test('#606: a docs-only branch whose run is still in flight, or measured on an older base, is not awaited', () => {
  const fx = fixture();
  branch(fx, 'docs/guide-62', 62, { 'docs/guide.md': 'g\n' });
  fx.setState({ branches: { 'docs/guide-62': { status: 'in_progress', conclusion: null } } });
  assert.strictEqual(dry(fx, 'docs/guide-62').row(DOCS_ROW).ok, true);
  advanceTrunk(fx);
  fx.setState({ branches: { 'docs/guide-62': { status: 'completed', conclusion: 'success' } } });
  const d = dry(fx, 'docs/guide-62');
  assert.strictEqual(d.row(DOCS_ROW).ok, true, JSON.stringify(d.j.checks));
  assert.match(d.row(DOCS_ROW).detail, /stale-base/);
});

test('#606: a docs-only branch with a RED run is refused — a red verdict is never overridden', () => {
  const fx = fixture();
  branch(fx, 'docs/red-63', 63, { 'README.md': 'x\n' });
  fx.setState({ branches: { 'docs/red-63': { status: 'completed', conclusion: 'failure' } } });
  const d = dry(fx, 'docs/red-63');
  assert.strictEqual(d.row(DOCS_ROW).ok, false);
  assert.match(d.row(DOCS_ROW).detail, /finished failure .* never overridden/);
  const r = colab(fx, ['ship', '--branch', 'docs/red-63', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(fx.g(fx.work, 'log', '--format=%s', 'main'), /#63/);
});

test('#606: docs/design/x.png is docs-only; assets/x.png and AGENTS.md need CI as usual', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0, 255]);
  const fx = fixture();
  branch(fx, 'docs/mock-64', 64, { 'docs/design/x.png': png });
  branch(fx, 'feat/asset-65', 65, { 'assets/x.png': png });
  branch(fx, 'docs/agents-66', 66, { 'AGENTS.md': 'rules\n' });
  advanceTrunk(fx); // every branch run is now stale — only the docs-only one may proceed
  assert.strictEqual(dry(fx, 'docs/mock-64').row(DOCS_ROW).ok, true);
  for (const b of ['feat/asset-65', 'docs/agents-66']) {
    const d = dry(fx, b);
    assert.strictEqual(d.row(DOCS_ROW), undefined, b);
    assert.strictEqual(d.row(STALE_ROW).ok, false, b);
  }
});

test('#606: a path listed in ci-docs-skip, and ci-docs-skip: off, need CI as usual', () => {
  for (const [yml, file] of [[`${YML}ci-docs-skip: [docs/api]\n`, 'docs/api/x.md'], [`${YML}ci-docs-skip: off\n`, 'README.md']]) {
    const fx = fixture(yml);
    branch(fx, 'docs/listed-67', 67, { [file]: 'x\n' });
    advanceTrunk(fx);
    const d = dry(fx, 'docs/listed-67');
    assert.strictEqual(d.row(DOCS_ROW), undefined, yml);
    assert.strictEqual(d.row(STALE_ROW).ok, false, yml);
  }
  // the exclusion is a path prefix: docs/apiary.md is still docs-only.
  const fx = fixture(`${YML}ci-docs-skip: [docs/api]\n`);
  branch(fx, 'docs/apiary-68', 68, { 'docs/apiary.md': 'x\n' });
  assert.strictEqual(dry(fx, 'docs/apiary-68').row(DOCS_ROW).ok, true);
});

test('#606: a planted credential in a docs-only change refuses the ship by file:line, never echoing it', () => {
  const fx = fixture();
  branch(fx, 'docs/leak-69', 69, { 'docs/setup.md': `# Setup\n\nkey: ${FAKE_AWS}\n` });
  fx.setState({ branches: { 'docs/leak-69': 'none' } });
  const d = dry(fx, 'docs/leak-69');
  assert.strictEqual(d.row(SCAN_ROW).ok, false);
  assert.match(d.row(SCAN_ROW).detail, /docs\/setup\.md:3 \(AWS access key\)/);
  const r = colab(fx, ['ship', '--branch', 'docs/leak-69', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out + r.err + JSON.stringify(d.j), new RegExp(FAKE_AWS));
  assert.doesNotMatch(fx.g(fx.work, 'log', '--format=%s', 'main'), /#69/);
});

test('#606: the repo\'s own forbidden terms (.github/secret-scan-terms, read at the target) refuse too', () => {
  const fx = fixture(YML, { '.github/secret-scan-terms': '# internal names\nhost-alpha-01\n' });
  branch(fx, 'docs/term-70', 70, { 'README.md': 'reach it at HOST-ALPHA-01.example\n' });
  const d = dry(fx, 'docs/term-70');
  assert.strictEqual(d.row(SCAN_ROW).ok, false);
  assert.match(d.row(SCAN_ROW).detail, /README\.md:1 \(forbidden term, line 2 of \.github\/secret-scan-terms\)/);
  assert.doesNotMatch(d.row(SCAN_ROW).detail, /alpha/i);
});

test('#606: a docs-only tip on trunk reads trunk CI from the last code commit — trunk-ci and ship agree', () => {
  const fx = fixture();
  const code = fx.g(fx.work, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(fx.work, 'README.md'), 'docs\n');
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'docs: readme');
  fs.mkdirSync(path.join(fx.work, 'docs'));
  fs.writeFileSync(path.join(fx.work, 'docs', 'm.png'), Buffer.from([0x89, 0x50, 0, 1, 0, 255]));
  fx.g(fx.work, 'add', '-A');
  fx.g(fx.work, 'commit', '-q', '-m', 'docs: mockup');
  fx.g(fx.work, 'push', '-q', 'origin', 'main');
  const tip = fx.g(fx.work, 'rev-parse', 'HEAD');
  // trunk's tip has no run (the adopter's CI paths-ignores docs); the code commit's run is green.
  fx.setState({ branches: { main: 'none' }, commitDefault: 'none', commits: { [code]: { status: 'completed', conclusion: 'success' } } });
  const t = JSON.parse(colab(fx, ['trunk-ci', '--repo', fx.work, '--json']).out);
  assert.strictEqual(t.verdict, 'GREEN', JSON.stringify(t));
  assert.match(t.detail, new RegExp(`docs-only tip \\(#606\\): main@${tip.slice(0, 7)} and 1 commit\\(s\\) below it change only documentation, so trunk CI is read at the newest code commit — 1 run at main@${code.slice(0, 7)}: success`));
  branch(fx, 'docs/next-71', 71, { 'docs/next.md': 'n\n' });
  const d = dry(fx, 'docs/next-71');
  assert.strictEqual(d.row('trunk CI green').ok, true, JSON.stringify(d.j.checks));
  const r = colab(fx, ['ship', '--branch', 'docs/next-71', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(fs.readFileSync(fx.ghLog, 'utf8'), new RegExp(`trunk CI read at ${code.slice(0, 7)}, the newest code commit below the docs-only tip ${tip.slice(0, 7)}`));
});

test('#606: the trunk door never overrides a finished red tip, a red code commit, or ci-docs-skip: off', () => {
  const setup = (yml) => {
    const fx = fixture(yml);
    const code = fx.g(fx.work, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(fx.work, 'README.md'), 'docs\n');
    fx.g(fx.work, 'add', '-A');
    fx.g(fx.work, 'commit', '-q', '-m', 'docs: readme');
    fx.g(fx.work, 'push', '-q', 'origin', 'main');
    return { fx, code };
  };
  const verdict = (fx) => JSON.parse(colab(fx, ['trunk-ci', '--repo', fx.work, '--json']).out);
  let { fx, code } = setup(YML);
  fx.setState({ branches: { main: { status: 'completed', conclusion: 'failure' } }, commits: { [code]: { status: 'completed', conclusion: 'success' } } });
  assert.notStrictEqual(verdict(fx).verdict, 'GREEN', 'a finished red tip stays red');
  ({ fx, code } = setup(YML));
  fx.setState({ branches: { main: 'none' }, commitDefault: 'none', commits: { [code]: { status: 'completed', conclusion: 'failure' } } });
  const red = verdict(fx);
  assert.notStrictEqual(red.verdict, 'GREEN');
  assert.match(red.detail, /docs-only tip \(#606\).*conclusion=failure/);
  ({ fx, code } = setup(`${YML}ci-docs-skip: off\n`));
  fx.setState({ branches: { main: 'none' }, commitDefault: 'none', commits: { [code]: { status: 'completed', conclusion: 'success' } } });
  const off = verdict(fx);
  assert.notStrictEqual(off.verdict, 'GREEN');
  assert.doesNotMatch(off.detail, /#606/);
});
