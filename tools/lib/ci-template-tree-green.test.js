'use strict';
/**
 * The CI workflows' `dedupe` guard, trunk TREE mode (#493): a squash merge lands a tree some
 * branch run of the same workflow already passed, so on a non-creating push to trunk the guard
 * looks for that run and, on an exact tree match, skips the suite and CITES it.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * The #418 sha mode keeps its own pins in ci-template-dedupe.test.js (unchanged by #493); this
 * file pins tree mode for the three templates and this repo's own ci.yml:
 *
 *   - wiring: the guard's `if:` admits exactly the trunk refs `concurrency` names, it can read
 *     contents (descriptor + git objects), and it exposes `cited`;
 *   - match: an exact tree match, confirmed through the git object, says tested=true and cites
 *     the run (output + a `tree-already-green` notice `colab ship` reads back);
 *   - mismatch / lookup failure / opt-out / not-trunk: tested=false, exit 0, every time.
 *
 * The fake `gh` serves fixtures by URL and applies the guard's own `--jq` program with the real
 * `jq`, so the selection logic (own run excluded, trunk ref excluded, foreign fork excluded, tree
 * compared) is exercised, not just the shell around it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FILES = ['templates/ci-node.yml', 'templates/ci-laravel.yml', 'templates/ci-python.yml', '.github/workflows/ci.yml'];
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;

// Top-level jobs as { name: [lines of its body] } — same line-scan as ci-template-dedupe.test.js.
function jobsOf(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  assert.notStrictEqual(at, -1, 'no jobs: block');
  const jobs = {};
  let cur = null;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l)) break;
    const m = l.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (m) { cur = m[1]; jobs[cur] = []; continue; }
    if (cur && !/^  #/.test(l)) jobs[cur].push(l);
  }
  return jobs;
}
const key = (body, k) => {
  const l = body.find((x) => new RegExp(`^    ${k}:`).test(x));
  return l ? l.replace(new RegExp(`^    ${k}:\\s*`), '').trim() : null;
};
function guardScript(body) {
  const at = body.findIndex((l) => /^\s+run:\s*\|\s*$/.test(l));
  assert.notStrictEqual(at, -1, 'dedupe has no run: | block');
  const ind = body[at].match(/^(\s*)/)[1].length + 2;
  const out = [];
  for (let i = at + 1; i < body.length; i++) {
    const l = body[i];
    if (l.trim() !== '' && l.match(/^(\s*)/)[1].length < ind) break;
    out.push(l.slice(ind));
  }
  return out.join('\n');
}

// A fake `gh api <url> [-H …] [--jq <prog>]`: logs its argv, serves $FIX/<key> (through the real
// jq when --jq is given), or exits 1 when $FIX/<key>.fail exists.
const FAKE_GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$FIX/args"
url="$2"; shift 2; prog=""
while [ $# -gt 0 ]; do case "$1" in --jq) prog="$2"; shift 2;; -H) shift 2;; *) shift;; esac; done
case "$url" in
  */actions/runs/*) k=run;;
  */contents/*) k=desc;;
  */git/commits/*) k="commit-\${url##*/}";;
  */workflows/*/runs*) k=list;;
  *) exit 9;;
esac
[ -f "$FIX/$k.fail" ] && exit 1
[ -f "$FIX/$k" ] || exit 1
if [ -n "$prog" ]; then jq -r "$prog" < "$FIX/$k"; else cat "$FIX/$k"; fi
`;

const runObj = (id, branch, sha, tree, repo = 'o/r') => ({
  id, head_branch: branch, head_sha: sha, html_url: `https://github.com/o/r/actions/runs/${id}`,
  event: 'push', head_repository: { full_name: repo }, head_commit: { tree_id: tree },
});

function makeRunner(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-green-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 });
  /**
   * fx: { desc, list: [runs], trees: {sha: tree}, fail: [keys], noGh, env }
   * Returns { out: {tested, cited}, stdout, args }.
   */
  const run = (fx = {}) => {
    const fix = fs.mkdtempSync(path.join(dir, 'fx-'));
    fs.writeFileSync(path.join(fix, 'run'), JSON.stringify({ workflow_id: 777 }));
    if (fx.desc !== null) fs.writeFileSync(path.join(fix, 'desc'), fx.desc ?? 'tier: B\ntrunk: main\n');
    fs.writeFileSync(path.join(fix, 'list'), JSON.stringify({ workflow_runs: fx.list ?? [] }));
    const trees = { abc123: 'T1', ...(fx.trees || {}) };
    for (const [sha, tree] of Object.entries(trees)) {
      fs.writeFileSync(path.join(fix, `commit-${sha}`), JSON.stringify({ tree: { sha: tree } }));
    }
    for (const k of fx.fail || []) fs.writeFileSync(path.join(fix, `${k}.fail`), '');
    const out = path.join(fix, 'out');
    fs.writeFileSync(out, '');
    const r = spawnSync('/bin/bash', ['-eo', 'pipefail', '-c', script], {
      env: {
        PATH: fx.noGh ? '/usr/bin:/bin' : `${bin}:${process.env.PATH}`,
        FIX: fix, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: path.join(fix, 'sum'),
        REPO: 'o/r', RUN_ID: '42', SHA: 'abc123', GH_TOKEN: 'x', CREATED: 'false', REF_NAME: 'main',
        ...(fx.env || {}),
      },
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, `guard must never fail the run: ${r.stderr}`);
    const kv = Object.fromEntries(fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
    const argsFile = path.join(fix, 'args');
    return { out: kv, stdout: r.stdout, args: fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8') : '' };
  };
  return { run, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

for (const file of FILES) {
  const text = read(file);
  const jobs = jobsOf(text);

  test(`${file}: dedupe admits exactly concurrency's trunk refs, can read contents, exposes cited (#493)`, () => {
    const d = jobs.dedupe;
    const conc = text.match(/cancel-in-progress: \$\{\{ (.*) \}\}/)[1];
    const trunks = [...conc.matchAll(/github\.ref != '([^']+)'/g)].map((m) => m[1]).sort();
    const cond = key(d, 'if');
    const admitted = [...cond.matchAll(/github\.ref == '([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(admitted, trunks, 'the guard must fire on exactly the trunk refs concurrency names');
    assert.match(cond, /github\.event_name == 'push' && \(github\.event\.created \|\|/);
    const body = d.join('\n');
    assert.match(body, /^    permissions:\n      actions: read\n      contents: read$/m);
    assert.match(body, /^      cited: \$\{\{ steps\.check\.outputs\.cited \}\}$/m);
    assert.match(body, /CREATED: \$\{\{ github\.event\.created \}\}/);
    assert.match(body, /REF_NAME: \$\{\{ github\.ref_name \}\}/);
  });

  test(`${file}: trunk tree mode — match, mismatch, lookup failure, opt-out, not-trunk (#493)`, { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const { run, cleanup } = makeRunner(guardScript(jobs.dedupe));
    try {
      const green = runObj(77, 'feat/x-1', 'bbb222', 'T1');

      // match: cites the run, in the output and as the notice ship reads back.
      let r = run({ list: [green], trees: { bbb222: 'T1' } });
      assert.deepStrictEqual(r.out, { tested: 'true', cited: 'https://github.com/o/r/actions/runs/77' });
      assert.match(r.stdout, /^::notice title=tree-already-green::https:\/\/github\.com\/o\/r\/actions\/runs\/77 tree=T1 head=bbb222 branch=feat\/x-1$/m);

      // The selection excludes this run, trunk's own runs, a foreign fork, and other trees.
      const decoys = [runObj(42, 'feat/self', 'ccc', 'T1'), runObj(50, 'main', 'ddd', 'T1'),
        runObj(51, 'feat/fork', 'eee', 'T1', 'evil/r'), runObj(52, 'feat/other', 'fff', 'T9')];
      r = run({ list: decoys, trees: { ccc: 'T1', ddd: 'T1', eee: 'T1', fff: 'T9' } });
      assert.deepStrictEqual(r.out, { tested: 'false' });
      r = run({ list: [...decoys, green], trees: { bbb222: 'T1' } });
      assert.strictEqual(r.out.cited, 'https://github.com/o/r/actions/runs/77');

      // mismatch: nothing listed; or the listing claims the tree but the git object disagrees.
      assert.deepStrictEqual(run({ list: [] }).out, { tested: 'false' });
      assert.deepStrictEqual(run({ list: [green], trees: { bbb222: 'T2' } }).out, { tested: 'false' });

      // lookup failure: each call failing in turn, no gh, an empty tree — always the full suite.
      for (const k of ['run', 'desc', 'commit-abc123', 'list', 'commit-bbb222']) {
        assert.deepStrictEqual(run({ list: [green], trees: { bbb222: 'T1' }, fail: [k] }).out, { tested: 'false' }, `${k} failing`);
      }
      assert.deepStrictEqual(run({ list: [green], noGh: true }).out, { tested: 'false' });
      assert.deepStrictEqual(run({ list: [green], trees: { abc123: '', bbb222: '' } }).out, { tested: 'false' });
      assert.deepStrictEqual(run({ list: [green], trees: { bbb222: 'T1' }, desc: null }).out, { tested: 'false' });

      // opt-out: any tree-reuse line, valid or not, runs the suite.
      for (const v of ['off', 'bogus']) {
        assert.deepStrictEqual(run({ list: [green], trees: { bbb222: 'T1' }, desc: `trunk: main\ntree-reuse: ${v}\n` }).out, { tested: 'false' }, v);
      }

      // not this repo's trunk (a release branch, or a promotion push to main on a dev-trunk repo).
      assert.deepStrictEqual(run({ list: [green], trees: { bbb222: 'T1' }, desc: 'trunk: dev\n' }).out, { tested: 'false' });
      // quoted and commented trunk values still read.
      assert.strictEqual(run({ list: [green], trees: { bbb222: 'T1' }, desc: 'trunk: "main"  # the trunk\n' }).out.tested, 'true');

      // created == true stays on #418's sha mode, never tree mode.
      r = run({ list: [green], trees: { bbb222: 'T1' }, env: { CREATED: 'true' } });
      assert.doesNotMatch(r.args, /git\/commits|contents/);

      // query shape: this workflow, push + success only, descriptor read AT this sha.
      r = run({ list: [green], trees: { bbb222: 'T1' } });
      assert.match(r.args, /repos\/o\/r\/actions\/workflows\/777\/runs\?event=push&status=success/);
      assert.match(r.args, /repos\/o\/r\/contents\/\.github\/project\.yml\?ref=abc123/);
      assert.match(r.args, /\.id != 42/);
      assert.match(r.args, /\.head_branch != "main"/);
      assert.match(r.args, /\.head_repository\.full_name == "o\/r"/);
    } finally {
      cleanup();
    }
  });
}
