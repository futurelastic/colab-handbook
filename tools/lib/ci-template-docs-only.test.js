'use strict';
/**
 * The CI workflows' `dedupe` guard, docs-only mode (#570): on a repo that declared `ci-docs-skip`,
 * a change whose every path is documentation — by the rule `colab ship` applies — from a base that
 * has a green run of this workflow, skips the suite and ends green with a `docs-only-skip` notice.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 *   - wiring: the two steps run only after the sha/tree step found nothing, feed the job's `tested`
 *     output, check nothing out (#418), never fail the run, and are byte-identical in all three
 *     templates;
 *   - base: a fake `gh` (fixtures through the real `jq`) drives the base step — merge base on a new
 *     branch, previous tip on trunk, a green base required, every doubt → no base;
 *   - classify: a REAL git repo served over file:// drives the classifier step, so the blobless
 *     fetch, the mode check and the binary check are exercised, not mocked;
 *   - parity: the classifier's shell copy of the rule agrees with tools/lib/docs-only.js pathReason
 *     on a table of paths — the template cannot require the module (copy-and-own), so this test is
 *     what keeps it one rule.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathReason } = require('./docs-only.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['templates/ci-node.yml', 'templates/ci-python.yml', 'templates/ci-laravel.yml'];
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;
const HAVE_GIT = spawnSync('git', ['--version']).status === 0;

// The `dedupe` job's body lines — same line-scan as ci-template-dedupe.test.js.
function dedupeBody(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^  dedupe:\s*$/.test(l));
  assert.notStrictEqual(at, -1, 'no dedupe job');
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (/^  \S/.test(lines[i]) && !/^  #/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}
// One step of the job, by id: { if, script }.
function step(body, id) {
  const at = body.findIndex((l) => l === `        id: ${id}`);
  assert.notStrictEqual(at, -1, `no step with id ${id}`);
  let cond = null;
  let run = -1;
  for (let i = at + 1; i < body.length && !/^      - /.test(body[i]); i++) {
    const m = body[i].match(/^        if: (.*)$/);
    if (m) cond = m[1];
    if (/^        run: \|\s*$/.test(body[i])) { run = i; break; }
  }
  assert.notStrictEqual(run, -1, `step ${id} has no run: | block`);
  const out = [];
  for (let i = run + 1; i < body.length; i++) {
    const l = body[i];
    if (l.trim() !== '' && !l.startsWith('          ')) break;
    out.push(l.slice(10));
  }
  return { if: cond, script: out.join('\n') };
}

const sh = (script, env) => spawnSync('/bin/bash', ['-eo', 'pipefail', '-c', script], { env, encoding: 'utf8' });
const outputs = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  .map((l) => l.split(/=(.*)/s).slice(0, 2)));

const per = FILES.map((f) => {
  const body = dedupeBody(read(f));
  return { f, body, base: step(body, 'docs_base'), docs: step(body, 'docs') };
});

for (const { f, body, base, docs } of per) {
  test(`${f}: docs-only steps are wired behind the sha/tree step and feed tested (#570)`, () => {
    const text = body.join('\n');
    assert.strictEqual(base.if, "steps.check.outputs.tested != 'true'");
    assert.strictEqual(docs.if, "steps.docs_base.outputs.base != ''");
    assert.match(text, /^      tested: \$\{\{ steps\.docs\.outputs\.tested == 'true' && 'true' \|\| steps\.check\.outputs\.tested \}\}$/m);
    assert.ok(body.indexOf('        id: check') < body.indexOf('        id: docs_base'), 'the sha/tree step must run first');
    assert.ok(body.indexOf('        id: docs_base') < body.indexOf('        id: docs'));
    assert.doesNotMatch(text, /actions\/checkout/);
    assert.doesNotMatch(base.script + docs.script, /\bexit 1\b/);
    assert.match(docs.script, /::notice title=docs-only-skip::base=\$BASE files=\$n run=\$BASE_RUN/);
  });
}

test('the docs-only steps are byte-identical in all three templates (#570)', () => {
  for (const p of per.slice(1)) {
    assert.strictEqual(p.base.script, per[0].base.script, `${p.f} docs_base differs from ${per[0].f}`);
    assert.strictEqual(p.docs.script, per[0].docs.script, `${p.f} docs differs from ${per[0].f}`);
  }
});

// ---- the base step, against a fake gh -------------------------------------------------------

const FAKE_GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$FIX/args"
url="$2"; shift 2; prog=""
while [ $# -gt 0 ]; do case "$1" in --jq) prog="$2"; shift 2;; -H) shift 2;; *) shift;; esac; done
case "$url" in
  */actions/runs/*) k=run;;
  */contents/*) k=desc;;
  */compare/*) k=compare;;
  */workflows/*/runs\\?head_sha=*) k="runs-\${url##*head_sha=}"; k="\${k%%&*}";;
  *) exit 9;;
esac
[ -f "$FIX/$k.fail" ] && exit 1
[ -f "$FIX/$k" ] || exit 1
if [ -n "$prog" ]; then jq -r "$prog" < "$FIX/$k"; else cat "$FIX/$k"; fi
`;

test('docs_base: the base is the merge base on a new branch, the previous tip on trunk, and must be green (#570)', { skip: !HAVE_JQ && 'jq not installed' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-base-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  const green = (id, event = 'push') => ({ id, event, html_url: `https://github.com/o/r/actions/runs/${id}` });
  const run = (fx = {}) => {
    const fix = fs.mkdtempSync(path.join(dir, 'fx-'));
    fs.writeFileSync(path.join(fix, 'run'), JSON.stringify({ workflow_id: 777 }));
    if (fx.desc !== null) fs.writeFileSync(path.join(fix, 'desc'), fx.desc ?? 'trunk: main\nci-docs-skip: []\n');
    fs.writeFileSync(path.join(fix, 'compare'), JSON.stringify({ merge_base_commit: { sha: 'mb111' } }));
    const runs = fx.runs ?? { mb111: [green(10)], bef222: [green(11)] };
    for (const [sha, list] of Object.entries(runs)) fs.writeFileSync(path.join(fix, `runs-${sha}`), JSON.stringify({ workflow_runs: list }));
    for (const k of fx.fail || []) fs.writeFileSync(path.join(fix, `${k}.fail`), '');
    const out = path.join(fix, 'out');
    fs.writeFileSync(out, '');
    const r = sh(per[0].base.script, {
      PATH: fx.noGh ? '/usr/bin:/bin' : `${bin}:${process.env.PATH}`,
      FIX: fix, GITHUB_OUTPUT: out, REPO: 'o/r', RUN_ID: '42', SHA: 'abc123', GH_TOKEN: 'x',
      BEFORE: '0000000000000000000000000000000000000000', CREATED: 'true', REF: 'refs/heads/docs/x-1', REF_NAME: 'docs/x-1',
      ...(fx.env || {}),
    });
    assert.strictEqual(r.status, 0, `the step must never fail the run: ${r.stderr}`);
    const argsFile = path.join(fix, 'args');
    return { out: outputs(out), stdout: r.stdout, args: fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8') : '' };
  };
  const TRUNK = { CREATED: 'false', REF: 'refs/heads/main', REF_NAME: 'main', BEFORE: 'bef222' };
  try {
    // a new branch: merge base with the declared trunk, green there.
    let r = run();
    assert.deepStrictEqual(r.out, { base: 'mb111', base_run: 'https://github.com/o/r/actions/runs/10', exclude: '' });
    assert.match(r.args, /repos\/o\/r\/compare\/main\.\.\.abc123/);
    assert.match(r.args, /repos\/o\/r\/actions\/workflows\/777\/runs\?head_sha=mb111&status=success/);
    // a push to trunk: the previous tip, no compare call.
    r = run({ env: TRUNK });
    assert.deepStrictEqual(r.out, { base: 'bef222', base_run: 'https://github.com/o/r/actions/runs/11', exclude: '' });
    assert.doesNotMatch(r.args, /compare/);

    // the opt-in list: flow, quoted, commented, block — trailing slashes dropped.
    const ex = (desc) => run({ desc: `trunk: main\n${desc}` }).out.exclude;
    assert.strictEqual(ex('ci-docs-skip: [docs/api/, "docs/gen"]  # read by the generator\n'), 'docs/api docs/gen');
    assert.strictEqual(ex("ci-docs-skip:\n  - docs/api/\n  - 'openapi.md'\nnext: 1\n"), 'docs/api openapi.md');
    assert.strictEqual(ex('ci-docs-skip: []\n'), '');

    // no opt-in, or one nobody can read as a list of repo paths → no base, whatever else holds.
    for (const desc of ['trunk: main\n', 'trunk: main\nci-docs-skip: yes\n', 'trunk: main\nci-docs-skip:\n',
      'trunk: main\nci-docs-skip: [../x]\n', 'trunk: main\nci-docs-skip: [docs/*]\n', 'trunk: main\nci-docs-skip: [/abs]\n',
      'ci-docs-skip: []\n']) {
      assert.deepStrictEqual(run({ desc }).out, {}, JSON.stringify(desc));
    }
    assert.deepStrictEqual(run({ desc: null }).out, {});

    // a base with no green run of this workflow: none, a PR run only, or only this run itself.
    for (const list of [[], [green(10, 'pull_request')], [green(42)]]) {
      assert.deepStrictEqual(run({ runs: { mb111: list } }).out, {}, JSON.stringify(list));
    }
    // neither a new branch nor a trunk push; trunk's first push; a tag; trunk created as a new ref.
    assert.deepStrictEqual(run({ env: { CREATED: 'false' } }).out, {});
    assert.deepStrictEqual(run({ env: { ...TRUNK, BEFORE: '0000000000000000000000000000000000000000' } }).out, {});
    assert.deepStrictEqual(run({ env: { REF: 'refs/tags/v1', REF_NAME: 'v1' } }).out, {});
    assert.deepStrictEqual(run({ env: { REF: 'refs/heads/main', REF_NAME: 'main' } }).out, {});
    // every lookup failing in turn, and no gh at all.
    for (const k of ['desc', 'compare', 'run', 'runs-mb111']) assert.deepStrictEqual(run({ fail: [k] }).out, {}, `${k} failing`);
    assert.deepStrictEqual(run({ noGh: true }).out, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the classifier step, against a real git repo ----------------------------------------------

function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-only-'));
  const srv = path.join(dir, 'o', 'r');
  fs.mkdirSync(srv, { recursive: true });
  const g = (...a) => {
    const r = spawnSync('git', a, { cwd: srv, encoding: 'utf8', env: { ...process.env, HOME: dir, XDG_CONFIG_HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    assert.strictEqual(r.status, 0, `git ${a.join(" ")}: ${r.stdout} ${r.stderr}`);
    return r.stdout.trim();
  };
  g('init', '-q');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  g('config', 'uploadpack.allowFilter', 'true');
  g('config', 'uploadpack.allowAnySHA1InWant', 'true');
  fs.writeFileSync(path.join(srv, 'app.js'), 'x\n');
  fs.mkdirSync(path.join(srv, 'docs'));
  fs.writeFileSync(path.join(srv, 'docs', 'old.md'), 'old\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  const base = g('rev-parse', 'HEAD');
  /** A commit on `base` applying `files` ({path: string|Buffer|{link}|null}); returns its sha. */
  const commit = (files) => {
    g('checkout', '-q', '--detach', base);
    for (const [p, v] of Object.entries(files)) {
      const abs = path.join(srv, p);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (v === null) fs.rmSync(abs);
      else if (typeof v === 'object' && !Buffer.isBuffer(v)) fs.symlinkSync(v.link, abs);
      else fs.writeFileSync(abs, v);
    }
    g('add', '-A');
    g('commit', '-q', '-m', 'change');
    return g('rev-parse', 'HEAD');
  };
  const classify = (sha, { from = base, exclude = '', server = `file://${dir}` } = {}) => {
    const tmp = fs.mkdtempSync(path.join(dir, 'run-'));
    const out = path.join(tmp, 'out');
    fs.writeFileSync(out, '');
    const r = sh(per[0].docs.script, {
      PATH: process.env.PATH, HOME: tmp, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: path.join(tmp, 'sum'),
      RUNNER_TEMP: tmp, GITHUB_RUN_ID: '42', GH_TOKEN: 'x', SERVER_URL: server, REPO: 'o/r',
      SHA: sha, BASE: from, BASE_RUN: 'https://github.com/o/r/actions/runs/10', EXCLUDE: exclude,
    });
    assert.strictEqual(r.status, 0, `the step must never fail the run: ${r.stderr}`);
    assert.ok(!fs.existsSync(path.join(tmp, 'docs-only-42')), 'the fetch dir is removed');
    return { tested: outputs(out).tested, stdout: r.stdout };
  };
  return { base, commit, classify, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('docs: a docs-only diff from a green base skips; anything else runs the suite (#570)', { skip: !HAVE_GIT && 'git not installed' }, () => {
  const { base, commit, classify, cleanup } = fixtureRepo();
  try {
    const docs = commit({ 'README.md': 'hi\n', 'docs/guide.md': 'g\n', 'notes.txt': 'n\n', 'docs/old.md': null });
    let r = classify(docs);
    assert.strictEqual(r.tested, 'true', r.stdout);
    assert.match(r.stdout, new RegExp(`^::notice title=docs-only-skip::base=${base} files=4 run=https://github.com/o/r/actions/runs/10$`, 'm'));

    const no = (files, why, opts) => {
      const s = commit(files);
      const res = classify(s, opts);
      assert.strictEqual(res.tested, 'false', `${why}: ${res.stdout}`);
      return res.stdout;
    };
    assert.match(no({ 'README.md': 'hi\n', 'app.js': 'y\n' }, 'a code path'), /app\.js \(not \.md\/\.mdx\/\.txt and not under docs\/\)/);
    no({ 'CLAUDE.md': 'rules\n' }, 'agent rules');
    no({ '.github/notes.md': 'x\n' }, 'config dir');
    assert.match(no({ 'docs/link.md': { link: '../app.js' } }, 'a symlink'), /symlink change/);
    assert.match(no({ 'docs/img.png': Buffer.from([0, 1, 2, 0, 255]) }, 'a binary'), /binary change/);
    assert.match(no({ 'docs/api/x.md': 'x\n' }, 'an excluded prefix', { exclude: 'docs/api' }), /listed in ci-docs-skip/);
    // the exclusion is a path prefix, never a string prefix.
    assert.strictEqual(classify(commit({ 'docs/apiary.md': 'x\n' }), { exclude: 'docs/api' }).tested, 'true');
    // an empty diff, and a fetch that fails.
    assert.strictEqual(classify(base).tested, 'false');
    assert.strictEqual(classify(docs, { server: 'file:///nonexistent' }).tested, 'false');
  } finally {
    cleanup();
  }
});

test('docs: the shell rule agrees with tools/lib/docs-only.js pathReason, path by path (#570)', { skip: !HAVE_GIT && 'git not installed' }, () => {
  const PATHS = [
    'README.md', 'a/b/c.md', 'guide.mdx', 'notes.txt', 'docs/x.json', 'docs/sub/deep.yml', '.x.md',
    'x.MD', '.md', 'docs.md', 'docsx/a.js', 'a/docs/x.js', 'src/x.js', 'Makefile',
    'AGENTS.md', 'docs/CLAUDE.md', 'a/CLAUDE.local.md', '.claude/x.md', 'a/.github/x.md',
    '.githooks/README.md', '.colab/skills/x.md', 'a/.colab/skills/b.md', '.colab/hooks/readme.md', '.colab/x.md',
  ];
  const { commit, classify, cleanup } = fixtureRepo();
  try {
    for (const p of PATHS) {
      const want = pathReason(p) === null ? 'true' : 'false';
      assert.strictEqual(classify(commit({ [p]: 'text\n' })).tested, want, `${p}: pathReason says ${pathReason(p) || 'documentation'}`);
    }
  } finally {
    cleanup();
  }
});
