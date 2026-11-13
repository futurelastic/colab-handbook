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
 *   - mismatch / lookup failure / opt-out / not-trunk: tested=false, exit 0, every time;
 *   - a batch-landing ref's first push (`ship-batch/**`) gets the same tree mode, and a declared
 *     trunk-only job's skip in the cited run does not stop reuse (#717).
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
// The light templates call ci-light.yml since #724 — the guard is checked where it lives.
const FILES = ['.github/workflows/ci.yml', '.github/workflows/ci-light.yml'];
// The reusable workflow (#721) has no `on:`/`concurrency:` of its own — the caller does — so its trunk refs are the
// `trunk-branches` input, not a concurrency list.
const REUSABLE = '.github/workflows/ci-light.yml';
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;
const GUARD = 'Already tested at this sha or tree?';

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
  */actions/runs/*/jobs*) k="jobs-\$(printf '%s' "$url" | sed -E 's|.*/runs/([0-9]+)/jobs.*|\\1|')";;
  */actions/runs/*) k=run;;
  */contents/*) k=desc;;
  */git/commits/*) k="commit-\${url##*/}";;
  */workflows/*/runs\?head_sha=*) k=same;;
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
   * fx: { desc, list: [runs], same: [runs at this sha], jobs: {runId: [{name, conclusion}]},
   *       trees: {sha: tree}, fail: [keys], noGh, env }
   * Every listed run gets a jobs listing — by default the guard skipped and a build succeeded.
   * Returns { out: {tested, cited}, stdout, args }.
   */
  const run = (fx = {}) => {
    const fix = fs.mkdtempSync(path.join(dir, 'fx-'));
    fs.writeFileSync(path.join(fix, 'run'), JSON.stringify({ workflow_id: 777 }));
    if (fx.desc !== null) fs.writeFileSync(path.join(fix, 'desc'), fx.desc ?? 'tier: B\ntrunk: main\n');
    fs.writeFileSync(path.join(fix, 'list'), JSON.stringify({ workflow_runs: fx.list ?? [] }));
    fs.writeFileSync(path.join(fix, 'same'), JSON.stringify({ workflow_runs: fx.same ?? [] }));
    for (const r of [...(fx.list || []), ...(fx.same || [])]) {
      const jobs = (fx.jobs && fx.jobs[r.id]) || [{ name: GUARD, conclusion: 'skipped' }, { name: 'Build', conclusion: 'success' }];
      fs.writeFileSync(path.join(fix, `jobs-${r.id}`), JSON.stringify({ total_count: jobs.length, jobs }));
    }
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
        REPO: 'o/r', RUN_ID: '42', GUARD_NAME: GUARD, SHA: 'abc123', GH_TOKEN: 'x', CREATED: 'false', REF_NAME: 'main',
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
    if (file === REUSABLE) {
      assert.strictEqual(key(d, 'if'), "github.event_name == 'push' && (github.event.created || contains(fromJSON(inputs.trunk-branches), github.ref_name))");
      const body = d.join('\n');
      assert.match(body, /^    permissions:\n      actions: read\n      contents: read$/m);
      assert.match(body, /^      cited: \$\{\{ steps\.check\.outputs\.cited \}\}$/m);
      return;
    }
    const conc = text.match(/cancel-in-progress: \$\{\{ (.*) \}\}/)[1];
    const trunks = [...conc.matchAll(/github\.ref != '([^']+)'/g)].map((m) => m[1]).sort();
    const groupLine = text.match(/^  group: (.*)$/m)[1];
    const groupTrunks = [...groupLine.matchAll(/github\.ref == '([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepStrictEqual(groupTrunks, trunks, "concurrency's group and cancel-in-progress must name the same trunk refs (#512)");
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

  test(`${file}: trunk cites a green push run at THIS sha first — the ship-batch fast-forward (#552)`, { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const { run, cleanup } = makeRunner(guardScript(jobs.dedupe));
    try {
      const batch = runObj(90, 'ship-batch/abc1234', 'abc123', 'T1');
      // Found by the exact sha query even when the 50-run tree listing does not reach it.
      let r = run({ same: [batch], list: [] });
      assert.deepStrictEqual(r.out, { tested: 'true', cited: 'https://github.com/o/r/actions/runs/90' });
      assert.match(r.stdout, /^::notice title=tree-already-green::https:\/\/github\.com\/o\/r\/actions\/runs\/90 tree=T1 head=abc123 branch=ship-batch\/abc1234$/m);
      assert.match(r.args, /repos\/o\/r\/actions\/workflows\/777\/runs\?head_sha=abc123&event=push&status=success/);
      // The sha query excludes this run, trunk's own run and a fork, like the tree query.
      r = run({ same: [runObj(42, 'feat/self', 'abc123', 'T1'), runObj(50, 'main', 'abc123', 'T1'), runObj(51, 'x', 'abc123', 'T1', 'evil/r')] });
      assert.deepStrictEqual(r.out, { tested: 'false' });
      // Nothing at this sha → the tree listing still decides (#493 unchanged).
      r = run({ same: [], list: [runObj(77, 'feat/x-1', 'bbb222', 'T1')], trees: { bbb222: 'T1' } });
      assert.strictEqual(r.out.cited, 'https://github.com/o/r/actions/runs/77');
      // The sha query failing falls through to the tree listing, never to a failed run.
      r = run({ same: [batch], fail: ['same'], list: [runObj(77, 'feat/x-1', 'bbb222', 'T1')], trees: { bbb222: 'T1' } });
      assert.strictEqual(r.out.cited, 'https://github.com/o/r/actions/runs/77');
      // Created push (sha mode, #418) never runs the trunk queries.
      r = run({ same: [batch], env: { CREATED: 'true' } });
      assert.doesNotMatch(r.args, /event=push&status=success/);
    } finally {
      cleanup();
    }
  });

  test(`${file}: a cited run that skipped a job other than the guard is not reused (#511)`, { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const { run, cleanup } = makeRunner(guardScript(jobs.dedupe));
    try {
      const green = runObj(77, 'feat/x-1', 'bbb222', 'T1');
      const base = { list: [green], trees: { bbb222: 'T1' } };
      // The trunk-only E2E job was skipped on the branch push: trunk runs the suite, no citation.
      let r = run({ ...base, jobs: { 77: [{ name: GUARD, conclusion: 'skipped' }, { name: 'Build', conclusion: 'success' }, { name: 'E2E (trunk only)', conclusion: 'skipped' }] } });
      assert.deepStrictEqual(r.out, { tested: 'false' });
      assert.doesNotMatch(r.stdout, /tree-already-green/);
      assert.match(r.stdout, /Run 77 skipped E2E \(trunk only\)/);
      // Only the guard skipped (its own `if:` is false on a non-creating branch push): reused.
      assert.strictEqual(run(base).out.tested, 'true');
      // The guard ran (a created push) and nothing skipped: reused.
      assert.strictEqual(run({ ...base, jobs: { 77: [{ name: GUARD, conclusion: 'success' }, { name: 'Build', conclusion: 'success' }] } }).out.tested, 'true');
      // A cited run that was itself a reuse (every job but the guard skipped): not reused.
      assert.strictEqual(run({ ...base, jobs: { 77: [{ name: GUARD, conclusion: 'success' }, { name: 'Build', conclusion: 'skipped' }] } }).out.tested, 'false');
      // The jobs listing failing, or truncated, runs the suite.
      assert.deepStrictEqual(run({ ...base, fail: ['jobs-77'] }).out, { tested: 'false' });
      r = run({ ...base, jobs: { 77: [{ name: 'Build', conclusion: 'success' }] } });
      assert.strictEqual(r.out.tested, 'true');
      // Same rule for a run found by the sha query (#552).
      r = run({ same: [runObj(90, 'ship-batch/abc1234', 'abc123', 'T1')], jobs: { 90: [{ name: 'Nightly', conclusion: 'skipped' }] } });
      assert.deepStrictEqual(r.out, { tested: 'false' });
      // The guard reads its own name from GUARD_NAME — the workflow sets it to this job's name.
      const env = jobs.dedupe.join('\n').match(/GUARD_NAME: (.*?) # /);
      assert.ok(env, 'dedupe sets GUARD_NAME');
      assert.strictEqual(env[1], key(jobs.dedupe, 'name'));
    } finally {
      cleanup();
    }
  });

  test(`${file}: a batch-landing ref's first push reuses a tree a branch already passed (#717)`, { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const { run, cleanup } = makeRunner(guardScript(jobs.dedupe));
    try {
      const batch = { CREATED: 'true', REF_NAME: 'ship-batch/abc1234' };
      const green = runObj(77, 'feat/x-1', 'bbb222', 'T1');
      const base = { list: [green], trees: { bbb222: 'T1' }, env: batch };

      // match: the batch's new sha carries the tree feat/x-1 passed — cited, with the notice ship reads.
      let r = run(base);
      assert.deepStrictEqual(r.out, { tested: 'true', cited: 'https://github.com/o/r/actions/runs/77' });
      assert.match(r.stdout, /^::notice title=tree-already-green::https:\/\/github\.com\/o\/r\/actions\/runs\/77 tree=T1 head=bbb222 branch=feat\/x-1$/m);
      // The same checks as trunk: descriptor read AT this sha, the listing confirmed by the git object.
      assert.match(r.args, /repos\/o\/r\/contents\/\.github\/project\.yml\?ref=abc123/);
      assert.match(r.args, /\.head_branch != "ship-batch\/abc1234"/);
      // The trunk check is trunk's own: a batch ref is not the trunk and is still reused.
      assert.strictEqual(run({ ...base, desc: 'trunk: dev\n' }).out.tested, 'true');

      // mismatch, opt-out, lookup failure, #511 — the full suite, every time.
      assert.deepStrictEqual(run({ ...base, trees: { bbb222: 'T2' } }).out, { tested: 'false' });
      assert.deepStrictEqual(run({ ...base, desc: 'trunk: main\ntree-reuse: off\n' }).out, { tested: 'false' });
      assert.deepStrictEqual(run({ ...base, desc: null }).out, { tested: 'false' });
      for (const k of ['commit-abc123', 'list', 'commit-bbb222', 'jobs-77']) {
        assert.deepStrictEqual(run({ ...base, fail: [k] }).out, { tested: 'false' }, `${k} failing`);
      }
      r = run({ ...base, jobs: { 77: [{ name: GUARD, conclusion: 'skipped' }, { name: 'Build', conclusion: 'success' }, { name: 'E2E (trunk only)', conclusion: 'skipped' }] } });
      assert.deepStrictEqual(r.out, { tested: 'false' });
      // A run of this very batch ref is never its own citation.
      assert.deepStrictEqual(run({ ...base, list: [runObj(78, 'ship-batch/abc1234', 'ccc333', 'T1')], trees: { ccc333: 'T1' } }).out, { tested: 'false' });

      // Any other creating push stays on #418's sha mode — never the tree queries.
      r = run({ ...base, env: { CREATED: 'true', REF_NAME: 'feat/ship-batch-x' } });
      assert.doesNotMatch(r.args, /git\/commits|contents/);
      // A later push to a batch ref (not creating, not trunk) is not tree mode's to reuse.
      assert.deepStrictEqual(run({ ...base, env: { CREATED: 'false', REF_NAME: 'ship-batch/abc1234' } }).out, { tested: 'false' });
    } finally {
      cleanup();
    }
  });

  test(`${file}: a cited run that skipped a declared trunk-only job is still reused (#717)`, { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const { run, cleanup } = makeRunner(guardScript(jobs.dedupe));
    try {
      const green = runObj(77, 'feat/x-1', 'bbb222', 'T1');
      const withDeploy = [{ name: GUARD, conclusion: 'skipped' }, { name: 'Build', conclusion: 'success' }, { name: 'Deploy', conclusion: 'skipped' }];
      const base = { list: [green], trees: { bbb222: 'T1' }, jobs: { 77: withDeploy } };

      // Undeclared: #511 exactly as before.
      let r = run(base);
      assert.deepStrictEqual(r.out, { tested: 'false' });
      assert.match(r.stdout, /Run 77 skipped Deploy/);
      // Declared: Deploy sits outside the gate and runs on this trunk push anyway — reuse, with the notice.
      r = run({ ...base, env: { TRUNK_ONLY_JOBS: 'Deploy' } });
      assert.deepStrictEqual(r.out, { tested: 'true', cited: 'https://github.com/o/r/actions/runs/77' });
      assert.match(r.stdout, /^::notice title=tree-already-green::/m);
      // A list, spaces around the commas.
      assert.strictEqual(run({ ...base, env: { TRUNK_ONLY_JOBS: ' Publish , Deploy ' } }).out.tested, 'true');
      // Exact names only: a different job, or a prefix, excuses nothing.
      assert.strictEqual(run({ ...base, env: { TRUNK_ONLY_JOBS: 'Publish' } }).out.tested, 'false');
      assert.strictEqual(run({ ...base, env: { TRUNK_ONLY_JOBS: 'Dep' } }).out.tested, 'false');
      // A listed name excuses only its own skip: an unlisted one still refuses, and is the one named.
      r = run({ ...base, env: { TRUNK_ONLY_JOBS: 'Deploy' }, jobs: { 77: [...withDeploy, { name: 'E2E (trunk only)', conclusion: 'skipped' }] } });
      assert.deepStrictEqual(r.out, { tested: 'false' });
      assert.match(r.stdout, /Run 77 skipped E2E \(trunk only\), which/);
      // A skip-chained run (the suite itself skipped) is still never reused.
      r = run({ ...base, env: { TRUNK_ONLY_JOBS: 'Deploy' }, jobs: { 77: [{ name: GUARD, conclusion: 'success' }, { name: 'Build', conclusion: 'skipped' }, { name: 'Deploy', conclusion: 'skipped' }] } });
      assert.deepStrictEqual(r.out, { tested: 'false' });
      // The batch-landing ref reads the same list.
      r = run({ ...base, env: { TRUNK_ONLY_JOBS: 'Deploy', CREATED: 'true', REF_NAME: 'ship-batch/abc1234' } });
      assert.strictEqual(r.out.tested, 'true');

      // The copy ships the list empty — #511 unchanged until an adopter names an ungated job.
      // The reusable workflow (#721) reads it from the `trunk-only-jobs` input, whose default is empty.
      if (file === REUSABLE) {
        assert.match(jobs.dedupe.join('\n'), /^\s+TRUNK_ONLY_JOBS: \$\{\{ inputs\.trunk-only-jobs \}\}$/m);
        assert.match(text, /^      trunk-only-jobs:\n(?:        .*\n)*?        default: ""$/m);
        return;
      }
      const decl = jobs.dedupe.join('\n').match(/^\s+TRUNK_ONLY_JOBS: "(.*)"$/m);
      assert.ok(decl, 'dedupe declares TRUNK_ONLY_JOBS');
      assert.strictEqual(decl[1], '');
    } finally {
      cleanup();
    }
  });

  // #721: a called workflow's jobs are listed as "<caller job> / <job name>". The #511 rule must see the
  // guard and each declared trunk-only job under that name too — or every caller's cited run reads as
  // "skipped Already tested…" and trunk never reuses a tree.
  if (file === REUSABLE) test(`${file}: called-job names — "<caller> / <name>" counts as the guard and as a trunk-only job (#721)`, { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const { run, cleanup } = makeRunner(guardScript(jobs.dedupe));
    try {
      const green = runObj(77, 'feat/x-1', 'bbb222', 'T1');
      const called = (extra = []) => ({ list: [green], trees: { bbb222: 'T1' }, jobs: { 77: [
        { name: `ci / ${GUARD}`, conclusion: 'skipped' }, { name: 'ci / Quick (lint, types, unit)', conclusion: 'success' },
        { name: 'ci / Full (test, build)', conclusion: 'success' }, ...extra] } });
      // The guard skipped under its called name: reused, cited.
      let r = run(called());
      assert.deepStrictEqual(r.out, { tested: 'true', cited: 'https://github.com/o/r/actions/runs/77' });
      // A called suite job skipped: never reused, and named.
      r = run(called([{ name: 'ci / E2E', conclusion: 'skipped' }]));
      assert.deepStrictEqual(r.out, { tested: 'false' });
      assert.match(r.stdout, /Run 77 skipped ci \/ E2E/);
      // A caller-level trunk-only job (no prefix) and a nested one (with one) are both excused when listed.
      assert.strictEqual(run({ ...called([{ name: 'Deploy', conclusion: 'skipped' }]), env: { TRUNK_ONLY_JOBS: 'Deploy' } }).out.tested, 'true');
      assert.strictEqual(run({ ...called([{ name: 'release / Deploy', conclusion: 'skipped' }]), env: { TRUNK_ONLY_JOBS: 'Deploy' } }).out.tested, 'true');
      // The suffix is " / <name>", whole: a name merely ending in the listed text excuses nothing.
      assert.strictEqual(run({ ...called([{ name: 'ci / PreDeploy', conclusion: 'skipped' }]), env: { TRUNK_ONLY_JOBS: 'Deploy' } }).out.tested, 'false');
      assert.strictEqual(run({ ...called([{ name: 'Deploy', conclusion: 'skipped' }]), env: { TRUNK_ONLY_JOBS: '' } }).out.tested, 'false');
    } finally {
      cleanup();
    }
  });

  // #734: the heavy job runs as two twins of one name — `full` on trunk, `full-staged` (after quick)
  // elsewhere — so every green run skips one of them. A skipped job whose name a successful job of the
  // same run carries is not a skip; without that, no branch run could ever be cited again.
  if (file === REUSABLE) test(`${file}: a skipped twin of a job that ran is not a skip (#734)`, { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const { run, cleanup } = makeRunner(guardScript(jobs.dedupe));
    try {
      const green = runObj(77, 'feat/x-1', 'bbb222', 'T1');
      const FULL = 'ci / Full (test, build)';
      const fx = (list) => ({ list: [green], trees: { bbb222: 'T1' }, jobs: { 77: list } });
      const base = [{ name: `ci / ${GUARD}`, conclusion: 'skipped' }, { name: 'ci / Quick (lint, types, unit)', conclusion: 'success' }];
      // A branch run: the staged twin ran, the trunk twin skipped — reused, cited.
      let r = run(fx([...base, { name: FULL, conclusion: 'skipped' }, { name: FULL, conclusion: 'success' }]));
      assert.deepStrictEqual(r.out, { tested: 'true', cited: 'https://github.com/o/r/actions/runs/77' });
      // Order in the listing does not matter.
      r = run(fx([...base, { name: FULL, conclusion: 'success' }, { name: FULL, conclusion: 'skipped' }]));
      assert.strictEqual(r.out.tested, 'true');
      // Both twins skipped (no full ran at all): not reused, and named.
      r = run(fx([...base, { name: FULL, conclusion: 'skipped' }, { name: FULL, conclusion: 'skipped' }]));
      assert.deepStrictEqual(r.out, { tested: 'false' });
      assert.match(r.stdout, /Run 77 skipped ci \/ Full \(test, build\)/);
      // A skip-chained run (the guard succeeded, the suite skipped): still never reused.
      r = run(fx([{ name: `ci / ${GUARD}`, conclusion: 'success' }, { name: 'ci / Quick (lint, types, unit)', conclusion: 'skipped' },
        { name: FULL, conclusion: 'skipped' }, { name: FULL, conclusion: 'skipped' }]));
      assert.strictEqual(r.out.tested, 'false');
      // The twin must share the WHOLE name: a different job that ran excuses nothing.
      r = run(fx([...base, { name: FULL, conclusion: 'success' }, { name: 'ci / E2E', conclusion: 'skipped' }]));
      assert.strictEqual(r.out.tested, 'false');
      // A twin that FAILED excuses nothing either (a red run is not listed as green, but the rule stays exact).
      r = run(fx([...base, { name: FULL, conclusion: 'failure' }, { name: FULL, conclusion: 'skipped' }]));
      assert.strictEqual(r.out.tested, 'false');
    } finally {
      cleanup();
    }
  });

  test(`${file}: trunk walks the candidates and cites the newest reusable one, not just the newest (#592)`, { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const { run, cleanup } = makeRunner(guardScript(jobs.dedupe));
    try {
      const skipChained = [{ name: GUARD, conclusion: 'success' }, { name: 'Build', conclusion: 'skipped' }];
      const e2eSkipped = [{ name: GUARD, conclusion: 'skipped' }, { name: 'Build', conclusion: 'success' }, { name: 'E2E (trunk only)', conclusion: 'skipped' }];

      // At THIS sha: the newest green run is skip-chained, an older one ran every job → cite the older.
      let r = run({ same: [runObj(91, 'ship-batch/b', 'abc123', 'T1'), runObj(90, 'ship-batch/a', 'abc123', 'T1')], jobs: { 91: skipChained } });
      assert.deepStrictEqual(r.out, { tested: 'true', cited: 'https://github.com/o/r/actions/runs/90' });
      assert.match(r.stdout, /Run 91 skipped Build/);
      assert.match(r.stdout, /^::notice title=tree-already-green::https:\/\/github\.com\/o\/r\/actions\/runs\/90 tree=T1 head=abc123 branch=ship-batch\/a$/m);

      // Same at THIS tree.
      r = run({ list: [runObj(78, 'feat/x-2', 'ccc333', 'T1'), runObj(77, 'feat/x-1', 'bbb222', 'T1')], trees: { ccc333: 'T1', bbb222: 'T1' }, jobs: { 78: e2eSkipped } });
      assert.deepStrictEqual(r.out, { tested: 'true', cited: 'https://github.com/o/r/actions/runs/77' });

      // Every sha match unusable → the tree listing is walked next, and a run already tried there is not re-checked.
      const atSha = runObj(91, 'ship-batch/b', 'abc123', 'T1');
      r = run({ same: [atSha], list: [atSha, runObj(77, 'feat/x-1', 'bbb222', 'T1')], trees: { bbb222: 'T1' }, jobs: { 91: skipChained } });
      assert.strictEqual(r.out.cited, 'https://github.com/o/r/actions/runs/77');
      assert.strictEqual((r.args.match(/runs\/91\/jobs/g) || []).length, 1, 'run 91 is checked once');

      // A candidate whose tree cannot be confirmed is passed over, not the end of the search.
      r = run({ list: [runObj(78, 'feat/x-2', 'ccc333', 'T1'), runObj(77, 'feat/x-1', 'bbb222', 'T1')], trees: { ccc333: 'T2', bbb222: 'T1' } });
      assert.strictEqual(r.out.cited, 'https://github.com/o/r/actions/runs/77');

      // Every match unusable → the full suite, said once.
      r = run({ same: [runObj(91, 'ship-batch/b', 'abc123', 'T1')], list: [runObj(78, 'feat/x-2', 'ccc333', 'T1')], trees: { ccc333: 'T1' }, jobs: { 91: skipChained, 78: e2eSkipped } });
      assert.deepStrictEqual(r.out, { tested: 'false' });
      assert.match(r.stdout, /can be cited — running the full suite \(#592\)/);
      assert.doesNotMatch(r.stdout, /tree-already-green/);

      // The sha query's hit is cited without listing the tree at all (no extra API call).
      r = run({ same: [runObj(90, 'ship-batch/a', 'abc123', 'T1')], list: [runObj(77, 'feat/x-1', 'bbb222', 'T1')], trees: { bbb222: 'T1' } });
      assert.strictEqual(r.out.cited, 'https://github.com/o/r/actions/runs/90');
      assert.doesNotMatch(r.args, /runs\?event=push&status=success&per_page=50/);

      // Sha matches unusable and the tree listing failing → the full suite.
      r = run({ same: [runObj(91, 'ship-batch/b', 'abc123', 'T1')], jobs: { 91: skipChained }, fail: ['list'] });
      assert.deepStrictEqual(r.out, { tested: 'false' });
    } finally {
      cleanup();
    }
  });
}
