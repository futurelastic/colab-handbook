'use strict';
/**
 * Subprocess/CLI tests for #732: `colab ci-grant` and `colab migration-grant` refuse to post a
 * grant the ship gate would reject for its author's association.
 *
 * Real CLI, real repo with a real bare `origin` on disk, private COLAB_HOME, and a STATEFUL fake
 * `gh` on PATH (the shape tools/lib/close-cli.test.js uses): the issue's comments live in a JSON
 * file, a posted comment reads back with the association the fixture assigns the viewer, and every
 * call is logged so a test can assert that NOTHING was written. The fake models GitHub's tracker,
 * not colab — the verdict logic itself is pinned purely in tools/lib/trust-humans.test.js.
 *
 * Why the ci-grant cases stop at the pre-check: the poster check runs BEFORE the CI reads, so a
 * refused poster never reaches `gh run list`; the post-and-verify layer is shared code
 * (postGrantVerified) and is exercised through migration-grant, whose path has no CI read.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';
const ME = 'grant-poster';
const BRANCH = 'feat/schema-7';

/**
 * `db` seeds the fake tracker: { issue: { state, labels:[names], comments:[{login, assoc, body}] },
 * myAssoc: the association the viewer's NEW comments read back with, repoComments: REST rows }.
 */
function fixture(db, projectYml = PROJECT_YML) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-grant-poster-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab grant-poster test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  g(work, 'checkout', '-q', '-b', BRANCH);
  fs.writeFileSync(path.join(work, 'f.txt'), 'change\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'feat: change');
  g(work, 'push', '-q', 'origin', BRANCH);
  g(work, 'checkout', '-q', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const tracker = path.join(root, 'tracker.json');
  const log = path.join(root, 'gh-calls.log');
  fs.writeFileSync(tracker, JSON.stringify({ repoComments: [], nextId: 1000, ...db }));
  fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const T = ${JSON.stringify(tracker)};
const db = JSON.parse(fs.readFileSync(T, 'utf8'));
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const key = argv.slice(0, 2).join(' ');
const save = () => fs.writeFileSync(T, JSON.stringify(db));
const out = (s) => { process.stdout.write(s); process.exit(0); };
const is = db.issue;
const url = (c) => 'https://github.invalid/o/r/issues/7#issuecomment-' + c.id;
if (argv[0] === '--version') out('gh version 0.0.0 (fixture)\\n');
if (key === 'auth status') process.exit(0);
if (key === 'api user') out(${JSON.stringify(ME)} + '\\n');
if (key === 'label list') out(['migration-granted', 'ci-granted', 'in-progress'].join('\\n') + '\\n');
if (argv[0] === 'api' && argv.some((a) => /issues\\/comments\\?/.test(a))) out(JSON.stringify(db.repoComments));
if (argv[0] === 'api' && argv[1] === '-X' && argv[2] === 'DELETE') {
  const id = Number(/comments\\/(\\d+)$/.exec(argv[3])[1]);
  is.comments = is.comments.filter((c) => c.id !== id); save(); out('');
}
if (key === 'issue view') {
  out(JSON.stringify({
    state: is.state, title: is.title || 'an issue', body: '',
    labels: is.labels.map((name) => ({ name })),
    comments: is.comments.map((c) => ({ body: c.body, url: url(c), createdAt: '2026-11-13T00:00:00Z', author: { login: c.login }, authorAssociation: c.assoc })),
  }) + '\\n');
}
if (key === 'issue comment') {
  const c = { id: db.nextId++, login: ${JSON.stringify(ME)}, assoc: db.myAssoc, body: argv[argv.indexOf('--body') + 1] };
  is.comments.push(c); save(); out(url(c) + '\\n');
}
if (key === 'issue edit') {
  const a = argv.indexOf('--add-label'); if (a > 0) is.labels.push(argv[a + 1]);
  const r = argv.indexOf('--remove-label'); if (r > 0) is.labels = is.labels.filter((l) => l !== argv[r + 1]);
  save(); out('');
}
process.stderr.write('fixture gh: unscripted ' + JSON.stringify(argv) + '\\n');
process.exit(1);
`, { mode: 0o755 });

  return {
    work, home, bin,
    issue: () => JSON.parse(fs.readFileSync(tracker, 'utf8')).issue,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
  };
}

function colab(fx, args) {
  return spawnSync('node', [COLAB, ...args], {
    cwd: fx.work, encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_HUMAN: '1', COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
}

/** Every call that writes to the tracker: a comment, a label edit, a delete. */
const writes = (fx) => fx.calls().filter((a) => (a[0] === 'issue' && (a[1] === 'comment' || a[1] === 'edit'))
  || (a[0] === 'api' && a.includes('-X') && a[a.indexOf('-X') + 1] !== 'GET'));

const issueWith = (comments) => ({ state: 'OPEN', labels: [], comments: comments.map((c, i) => ({ id: i + 1, body: 'note', ...c })) });

test('migration-grant: an account whose comments read NONE exits non-zero WITHOUT posting (#732)', () => {
  const fx = fixture({ issue: issueWith([{ login: ME, assoc: 'NONE' }]), myAssoc: 'NONE' });
  const r = colab(fx, ['migration-grant', '7', '--branch', BRANCH]);
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /grant not posted — the ship gate would reject it: grant-poster \(NONE\)/);
  assert.match(r.stderr, /accept the invitation/);
  assert.match(r.stderr, /re-run: COLAB_HUMAN=1 colab migration-grant 7 --branch feat\/schema-7/);
  assert.deepStrictEqual(writes(fx), [], 'nothing may be written');
  assert.deepStrictEqual(fx.issue().labels, []);
});

test('ci-grant: an account whose comments read NONE exits non-zero WITHOUT posting, before any CI read (#732)', () => {
  const fx = fixture({ issue: issueWith([{ login: ME, assoc: 'NONE' }]), myAssoc: 'NONE' });
  const r = colab(fx, ['ci-grant', '7', '--branch', BRANCH]);
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /CI grant not posted — the ship gate would reject it: grant-poster \(NONE\)/);
  assert.match(r.stderr, /re-run: COLAB_HUMAN=1 colab ci-grant 7 --branch feat\/schema-7/);
  assert.deepStrictEqual(writes(fx), []);
  assert.ok(!fx.calls().some((a) => a[0] === 'run'), 'refused before measuring CI');
});

test('ci-grant --role ci-reviewer: the reviewer reader\'s association rule applies at the writer too (#732)', () => {
  const fx = fixture({ issue: { ...issueWith([{ login: ME, assoc: 'CONTRIBUTOR' }]), title: 'TRUNK RED: main' }, myAssoc: 'CONTRIBUTOR' },
    `${PROJECT_YML}ci-grant: reviewer\n`);
  const g = (...args) => execFileSync('git', args, { cwd: fx.work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('branch', '-m', BRANCH, 'fix/trunk-red-7'); g('push', '-q', 'origin', 'fix/trunk-red-7');
  const r = spawnSync('node', [COLAB, 'ci-grant', '7', '--branch', 'fix/trunk-red-7', '--role', 'ci-reviewer',
    '--reviewer', 'rev-a', '--verdict', 'pass', '--cures', 'ci/test'], {
    cwd: fx.work, encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_HUMAN: '', COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /CI grant not posted — the ship gate would reject it: grant-poster \(CONTRIBUTOR\)/);
  assert.deepStrictEqual(writes(fx), []);
});

test('the repo\'s newest comments predict too when the account has none on this issue — still nothing posted', () => {
  const fx = fixture({
    issue: issueWith([{ login: 'someone-else', assoc: 'OWNER' }]), myAssoc: 'NONE',
    repoComments: [{ body: 'x', user: { login: ME }, author_association: 'NONE' }],
  });
  const r = colab(fx, ['migration-grant', '7', '--branch', BRANCH]);
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /grant-poster \(NONE\)/);
  assert.deepStrictEqual(writes(fx), []);
});

test('backstop: no prior comment anywhere — the posted comment reads back NONE, is deleted, and the label never goes on', () => {
  const fx = fixture({ issue: issueWith([]), myAssoc: 'NONE' });
  const r = colab(fx, ['migration-grant', '7', '--branch', BRANCH]);
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /grant-poster \(NONE\)/);
  assert.match(r.stderr, /the comment was deleted again and the label never applied/);
  assert.deepStrictEqual(fx.issue().comments, [], 'the dead grant comment is gone');
  assert.deepStrictEqual(fx.issue().labels, [], 'the label never flashed');
  assert.ok(!fx.calls().some((a) => a[0] === 'issue' && a[1] === 'edit'), 'no label edit at all');
});

test('a trusted poster: comment first, then the label — the grant stands (#732 keeps the happy path)', () => {
  const fx = fixture({ issue: issueWith([]), myAssoc: 'MEMBER' });
  const r = colab(fx, ['migration-grant', '7', '--branch', BRANCH]);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Granted #7/);
  const w = writes(fx).map((a) => a.slice(0, 2).join(' '));
  assert.deepStrictEqual(w, ['issue comment', 'issue edit'], 'comment before label');
  assert.deepStrictEqual(fx.issue().labels, ['migration-granted']);
  assert.strictEqual(fx.issue().comments.length, 1);
});

test('trust-humans declared on trunk: an unlisted login is refused before posting, whatever its association', () => {
  const fx = fixture({ issue: issueWith([{ login: ME, assoc: 'MEMBER' }]), myAssoc: 'MEMBER' },
    `${PROJECT_YML}trust-humans: [operator-a]\n`);
  const r = colab(fx, ['migration-grant', '7', '--branch', BRANCH]);
  assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /grant-poster is not listed in trust-humans/);
  assert.match(r.stderr, /trust-humans:`, or add this login there/);
  assert.deepStrictEqual(writes(fx), []);
});
