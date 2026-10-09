'use strict';
/**
 * #578 — `colab ship --branch <br> --handoff <comment-url>`: a remote-built branch lands from its
 * executor's recorded hand-off, with no `--force` and nothing taken over.
 *
 * Two layers: the pure verdict (tools/lib/ship-handoff.js), then the REAL CLI across two
 * "machines" — two clones of one bare origin, each with its own COLAB_HOME (its own claim
 * registry), sharing one stateful fake tracker. Machine A cuts, claims, commits and pushes; machine
 * B, whose registry has nothing for the branch, ships it from A's hand-off comment.
 *
 * Run: `node --test tools/lib/ship-handoff.test.js`
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ho = require('./ship-handoff');

// =================================================================================================
// The pure verdict
// =================================================================================================

const BR = 'feat/thing-90';
const HEAD = 'abcdef0123456789abcdef0123456789abcdef01';
const URL = 'https://github.com/acme/widget/issues/90#issuecomment-555';
const COMMENT = {
  body: `wrapped on \`${BR}\` (head ${HEAD.slice(0, 8)}, cut from main @ 1234567).`,
  login: 'exec', createdAt: '2026-10-08T12:00:00Z', htmlUrl: URL,
};
const CLAIM = { login: 'exec', branch: BR, at: '2026-10-08T10:00:00Z', host: 'box-a', machine: 'm:aaaaaaaaaaaa' };
const REFS = { localSha: null, remoteSha: HEAD, localFromRemote: false };
const base = (over = {}) => ({ url: URL, comment: COMMENT, branch: BR, refs: REFS, claimsByIssue: { 90: [CLAIM] }, ...over });

test('#578 parseHandoffUrl: issue-comment URLs only', () => {
  assert.deepStrictEqual(ho.parseHandoffUrl(URL), { owner: 'acme', repo: 'widget', issue: 90, commentId: '555' });
  assert.strictEqual(ho.parseHandoffUrl('https://github.com/acme/widget/issues/90'), null);
  assert.strictEqual(ho.parseHandoffUrl('555'), null);
  assert.strictEqual(ho.parseHandoffUrl(''), null);
});

test('#578 namesBranch is a whole-token match; namedShas finds hex runs of 7–40', () => {
  assert.ok(ho.namesBranch('on `feat/thing-90` (head', BR));
  assert.ok(!ho.namesBranch('on `feat/thing-901`', BR), 'a longer branch is not this one');
  assert.ok(!ho.namesBranch('on `x/feat/thing-90`', BR), 'a prefixed branch is not this one');
  assert.deepStrictEqual(ho.namedShas('head 7603D143, run 37792136118, #90'), ['7603d143', '37792136118']);
});

test('#578 a complete hand-off passes and yields the branch-named issue set', () => {
  const v = ho.handoffVerdict(base());
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.deepStrictEqual(v.issues, [90]);
  assert.strictEqual(v.sha, HEAD);
  assert.strictEqual(v.executor.login, 'exec');
  assert.strictEqual(ho.handoffTrailer(v), `Colab-Handoff: ${URL} @ ${HEAD.slice(0, 12)}`);
});

test('#578 a group branch needs the executor\'s live claim on EVERY member', () => {
  const br = 'fix/pair-90-91';
  const c = { ...COMMENT, body: `wrapped on \`${br}\` (head ${HEAD.slice(0, 8)})` };
  const ok = ho.handoffVerdict(base({ branch: br, comment: c, claimsByIssue: { 90: [{ ...CLAIM, branch: br }], 91: [{ ...CLAIM, branch: br }] } }));
  assert.deepStrictEqual(ok.issues, [90, 91]);
  const missing = ho.handoffVerdict(base({ branch: br, comment: c, claimsByIssue: { 90: [{ ...CLAIM, branch: br }], 91: [] } }));
  assert.strictEqual(missing.reason, 'no-executor-claim');
  assert.match(missing.detail, /#91/);
});

test('#578 every way a hand-off can fail to prove itself refuses, with its own reason', () => {
  const cases = [
    ['bad-url', { url: 'https://github.com/acme/widget/issues/90' }],
    ['unreadable', { comment: null }],
    ['mismatch', { comment: { ...COMMENT, htmlUrl: 'https://github.com/acme/widget/issues/7#issuecomment-555' } }],
    ['mismatch', { comment: { ...COMMENT, htmlUrl: 'https://github.com/other/widget/issues/90#issuecomment-555' } }],
    ['branch-names-no-issue', { branch: 'feat/thing' }],
    ['not-this-branch', { branch: 'feat/thing-91', comment: { ...COMMENT, body: 'feat/thing-91 ' + HEAD } }],
    ['branch-not-named', { comment: { ...COMMENT, body: `wrapped (head ${HEAD.slice(0, 8)})` } }],
    ['no-remote-branch', { refs: { localSha: null, remoteSha: null } }],
    ['local-diverges', { refs: { localSha: '1111111111111111111111111111111111111111', remoteSha: HEAD, localFromRemote: false } }],
    ['local-diverges', { refs: { localSha: '1111111111111111111111111111111111111111', remoteSha: HEAD, localFromRemote: true } }],
    ['head-moved', { refs: { localSha: null, remoteSha: '9999999999999999999999999999999999999999' } }],
    ['head-moved', { comment: { ...COMMENT, body: `wrapped on \`${BR}\`, done.` } }],
    ['claims-unreadable', { claimsByIssue: { 90: null } }],
    ['no-executor-claim', { claimsByIssue: { 90: [] } }],
    ['no-executor-claim', { claimsByIssue: { 90: [{ ...CLAIM, branch: 'feat/other-90' }] } }],
    ['no-executor-claim', { claimsByIssue: { 90: [{ ...CLAIM, login: 'someone-else' }] } }],
    ['no-executor-claim', { claimsByIssue: { 90: [{ ...CLAIM, at: '2026-10-08T13:00:00Z' }] } }],
  ];
  for (const [reason, over] of cases) {
    const v = ho.handoffVerdict(base(over));
    assert.strictEqual(v.ok, false, `${reason}: ${JSON.stringify(over)}`);
    assert.strictEqual(v.reason, reason, `${JSON.stringify(over)} → ${v.reason}: ${v.detail}`);
  }
});

test('#578 a local ref equal to the remote head is fine (a DWIM checkout of the same sha)', () => {
  assert.strictEqual(ho.handoffVerdict(base({ refs: { localSha: HEAD, remoteSha: HEAD, localFromRemote: true } })).ok, true);
});

// =================================================================================================
// The real CLI — two registries, one tracker
// =================================================================================================

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-handoff-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const workA = path.join(root, 'work-a');
  const homeA = path.join(root, 'home-a');
  const homeB = path.join(root, 'home-b');
  const ghState = path.join(root, 'gh-state');
  for (const d of [homeA, homeB, ghState]) fs.mkdirSync(d);

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', workA]);
  const cfg = (w, who) => {
    g(w, 'config', 'user.email', `${who}@example.invalid`);
    g(w, 'config', 'user.name', `handoff ${who}`);
    g(w, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  };
  cfg(workA, 'a');
  g(workA, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(workA, '.github'), { recursive: true });
  fs.writeFileSync(path.join(workA, '.github', 'project.yml'),
    'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nautonomy: auto-trunk\n');
  fs.writeFileSync(path.join(workA, '.gitignore'), '.worktrees/\n');
  fs.writeFileSync(path.join(workA, 'f.txt'), 'base\n');
  g(workA, 'add', '-A');
  g(workA, 'commit', '-q', '-m', 'chore: fixture');
  g(workA, 'push', '-q', 'origin', 'main');
  g(workA, 'remote', 'set-head', 'origin', 'main');

  const workB = path.join(root, 'work-b');
  execFileSync('git', ['clone', '-q', origin, workB]);
  cfg(workB, 'b');

  // A stateful tracker both machines share. Same shape as claim-machines-cli.test.js, plus the
  // single-comment REST read the hand-off door makes, and the CI/visibility reads ship makes.
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const ghScript = path.join(bin, 'gh-fake.js');
  fs.writeFileSync(ghScript, [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const { execFileSync } = require('child_process');",
    `const STATE = ${JSON.stringify(ghState)};`,
    `const ORIGIN = ${JSON.stringify(origin)};`,
    "const argv = process.argv.slice(2);",
    "fs.appendFileSync(path.join(STATE, 'calls.log'), JSON.stringify(argv) + '\\n');",
    "if (argv[0] === '--version') { console.log('gh version 0.0.0 (fixture)'); process.exit(0); }",
    "if (argv[0] === 'auth' && argv[1] === 'status') { console.error('Logged in (fixture)'); process.exit(0); }",
    "if (argv[0] === 'api' && argv[1] === 'user') { console.log('me'); process.exit(0); }",
    "if (argv[0] === 'repo' && argv[1] === 'view') { console.log('PRIVATE'); process.exit(0); }",
    "const cm = argv[0] === 'api' && String(argv[1]).match(/issues\\/comments\\/(\\d+)$/);",
    "if (cm) { const f = path.join(STATE, `comment-${cm[1]}.json`); if (!fs.existsSync(f)) { console.error('HTTP 404: Not Found'); process.exit(1); } process.stdout.write(fs.readFileSync(f, 'utf8')); process.exit(0); }",
    "if (argv[0] === 'run' && argv[1] === 'list') {",
    "  const i = argv.indexOf('--branch'); const br = i >= 0 ? argv[i + 1] : 'main';",
    "  let sha = ''; try { sha = execFileSync('git', ['--git-dir', ORIGIN, 'rev-parse', `refs/heads/${br}`], { encoding: 'utf8' }).trim(); } catch (_) {}",
    "  console.log(JSON.stringify(sha ? [{ headSha: sha, status: 'completed', conclusion: 'success' }] : [])); process.exit(0);",
    "}",
    "function issueFile(n) { return path.join(STATE, `issue-${n}.json`); }",
    "function load(n) { try { return JSON.parse(fs.readFileSync(issueFile(n), 'utf8')); } catch (_) { return { comments: [], assignees: [], labels: [] }; } }",
    "function save(n, st) { fs.writeFileSync(issueFile(n), JSON.stringify(st)); }",
    "function counter() { const f = path.join(STATE, 'counter'); let c = 0; try { c = parseInt(fs.readFileSync(f, 'utf8'), 10) || 0; } catch (_) {} fs.writeFileSync(f, String(c + 1)); return c; }",
    "if (argv[0] === 'issue' && argv[1] === 'edit') {",
    "  const n = argv[2]; const st = load(n);",
    "  if (argv.includes('--add-assignee')) { if (!st.assignees.includes('me')) st.assignees.push('me'); }",
    "  if (argv.includes('--add-label')) { if (!st.labels.includes('in-progress')) st.labels.push('in-progress'); }",
    "  if (argv.includes('--remove-assignee')) { st.assignees = st.assignees.filter((a) => a !== 'me'); }",
    "  if (argv.includes('--remove-label')) { st.labels = st.labels.filter((l) => l !== 'in-progress'); }",
    "  save(n, st); process.exit(0);",
    "}",
    "if (argv[0] === 'issue' && argv[1] === 'comment') {",
    "  const n = argv[2]; const body = argv[argv.indexOf('--body') + 1];",
    "  const st = load(n); const c = counter();",
    "  st.comments.push({ createdAt: new Date(Date.UTC(2020, 0, 1) + (1000 + c) * 1000).toISOString(), author: { login: 'me' }, body });",
    "  save(n, st); process.exit(0);",
    "}",
    "if (argv[0] === 'issue' && argv[1] === 'view') {",
    "  const n = argv[2]; const st = load(n);",
    "  console.log(JSON.stringify({ state: 'OPEN', comments: st.comments, assignees: st.assignees.map((login) => ({ login })), labels: st.labels.map((name) => ({ name })) }));",
    "  process.exit(0);",
    "}",
    "if (argv[0] === 'issue' || argv[0] === 'label') process.exit(0);",
    "console.error(`fixture gh: unscripted — args: ${JSON.stringify(argv)}`); process.exit(1);",
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec node ${JSON.stringify(ghScript)} "$@"\n`, { mode: 0o755 });
  return { root, origin, workA, workB, homeA, homeB, ghState, bin };
}

function colab(fx, args, { home, session }) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, HOME: home, COLAB_HOME: home,
      COLAB_SESSION: session, COLAB_SESSION_NAME: '', COLAB_HUMAN: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const issueState = (fx, n) => JSON.parse(fs.readFileSync(path.join(fx.ghState, `issue-${n}.json`), 'utf8'));
const callLog = (fx) => fs.readFileSync(path.join(fx.ghState, 'calls.log'), 'utf8');

/** Machine A: cut + claim, commit, push. Returns the pushed head. */
function executorBuilds(fx, branch, issues) {
  const r = colab(fx, ['worktree', 'new', branch, '--issues', issues.join(','), '--repo', fx.workA],
    { home: fx.homeA, session: 'https://example.invalid/session_EXEC' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  const wt = path.join(fx.workA, '.worktrees', branch.split('/').pop());
  fs.writeFileSync(path.join(wt, 'thing.txt'), 'built on A\n');
  g(wt, 'add', '-A');
  g(wt, 'commit', '-q', '-m', `feat: the thing (#${issues[0]})`);
  g(wt, 'push', '-q', 'origin', branch);
  return { wt, head: g(wt, 'rev-parse', 'HEAD') };
}

/** The executor's wrap comment, as the tracker stores it — later than its claim. */
function postHandoff(fx, issue, id, body, login = 'me') {
  const url = `https://github.com/acme/widget/issues/${issue}#issuecomment-${id}`;
  const createdAt = '2021-06-01T00:00:00Z';
  const st = issueState(fx, issue);
  st.comments.push({ createdAt, author: { login }, body });
  fs.writeFileSync(path.join(fx.ghState, `issue-${issue}.json`), JSON.stringify(st));
  fs.writeFileSync(path.join(fx.ghState, `comment-${id}.json`),
    JSON.stringify({ id: Number(id), body, user: { login }, created_at: createdAt, html_url: url }));
  return url;
}

const SHIPPER = { session: 'https://example.invalid/session_LANDER' };

test('#578 e2e: claim on machine A, ship on machine B from the hand-off — lands and closes, no --force', () => {
  const fx = fixture();
  const { head } = executorBuilds(fx, BR, [90]);
  const url = postHandoff(fx, 90, '555', `**2026-10-08** — wrapped on \`${BR}\` (head ${head.slice(0, 8)}, cut from main). Wrapped, not merged.`);

  // Machine B's registry has nothing for the branch: today's refusal, unchanged.
  g(fx.workB, 'fetch', '-q', 'origin');
  const bare = colab(fx, ['ship', '--branch', BR, '--repo', fx.workB], { home: fx.homeB, ...SHIPPER });
  assert.strictEqual(bare.code, 1, bare.out + bare.err);
  assert.match(bare.err, /claim registry has nothing for this branch/);

  // The dry JSON a lander reads first — the hand-off row passes and nothing is human-gated.
  const dry = colab(fx, ['ship', '--branch', BR, '--handoff', url, '--repo', fx.workB, '--dry', '--json'], { home: fx.homeB, ...SHIPPER });
  const rep = JSON.parse(dry.out);
  const row = rep.checks.find((c) => /hand-off verified/.test(c.name));
  assert.ok(row && row.ok, JSON.stringify(rep.checks, null, 1));
  assert.ok(!rep.checks.some((c) => /registry-gap/.test(c.name) && !c.ok), JSON.stringify(rep.checks, null, 1));

  const r = colab(fx, ['ship', '--branch', BR, '--handoff', url, '--repo', fx.workB], { home: fx.homeB, ...SHIPPER });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /✓\s+hand-off verified \(#578\)/);
  assert.match(r.out, /✓ Shipped feat\/thing-90 → main/);

  // Landed on origin's trunk, as one squash carrying Closes + the door it came through.
  const msg = execFileSync('git', ['--git-dir', fx.origin, 'log', '-1', '--format=%B', 'main'], { encoding: 'utf8' });
  assert.match(msg, /Closes #90/);
  assert.match(msg, new RegExp(`Colab-Handoff: ${url.replace(/[.?/#]/g, '\\$&')} @ ${head.slice(0, 12)}`));
  assert.strictEqual(execFileSync('git', ['--git-dir', fx.origin, 'show', 'main:thing.txt'], { encoding: 'utf8' }), 'built on A\n');

  // The 🚢 comment names the hand-off; no takeover anywhere; the branch is kept for the executor.
  const comments = issueState(fx, 90).comments.map((c) => c.body);
  assert.ok(comments.some((b) => /Shipped to main by colab ship/.test(b) && b.includes(url)), comments.join('\n---\n'));
  assert.ok(!callLog(fx).includes('--force'));
  assert.ok(g(fx.workB, 'ls-remote', 'origin', `refs/heads/${BR}`), 'the executor\'s branch is not deleted');
  // Machine B wrote no claim of its own.
  const stB = JSON.parse(fs.readFileSync(path.join(fx.homeB, 'state.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(stB.claims || {}), []);
});

test('#578 e2e: the same call without a matching hand-off still refuses', () => {
  const fx = fixture();
  const { wt, head } = executorBuilds(fx, BR, [90]);

  // Names the wrong head.
  const stale = postHandoff(fx, 90, '601', `wrapped on \`${BR}\` (head 0000000a).`);
  let r = colab(fx, ['ship', '--branch', BR, '--handoff', stale, '--repo', fx.workB], { home: fx.homeB, ...SHIPPER });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /Refusing --handoff: .*moved after it was handed off/);

  // Posted by someone who is not the claim holder.
  const foreign = postHandoff(fx, 90, '602', `wrapped on \`${BR}\` (head ${head.slice(0, 8)}).`, 'someone-else');
  r = colab(fx, ['ship', '--branch', BR, '--handoff', foreign, '--repo', fx.workB], { home: fx.homeB, ...SHIPPER });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /no live 🔒 claim/);

  // A comment that is not on this repo (the tracker answers 404).
  r = colab(fx, ['ship', '--branch', BR, '--handoff', 'https://github.com/acme/widget/issues/90#issuecomment-999', '--repo', fx.workB], { home: fx.homeB, ...SHIPPER });
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /could not be read from this repo/);

  // A valid hand-off, but the executor pushed again afterwards: the hand-off no longer covers the head.
  const good = postHandoff(fx, 90, '603', `wrapped on \`${BR}\` (head ${head.slice(0, 8)}).`);
  fs.writeFileSync(path.join(wt, 'more.txt'), 'later\n');
  g(wt, 'add', '-A'); g(wt, 'commit', '-q', '-m', 'feat: more'); g(wt, 'push', '-q', 'origin', BR);
  const json = JSON.parse(colab(fx, ['ship', '--branch', BR, '--handoff', good, '--repo', fx.workB, '--dry', '--json'], { home: fx.homeB, ...SHIPPER }).out);
  assert.strictEqual(json.ok, false);
  const row = json.checks.find((c) => /hand-off verified/.test(c.name));
  assert.ok(row && !row.ok && /head-moved/.test(row.detail), JSON.stringify(json.checks, null, 1));

  // Nothing landed on trunk through any of it.
  assert.doesNotMatch(execFileSync('git', ['--git-dir', fx.origin, 'log', '--format=%s', 'main'], { encoding: 'utf8' }), /the thing/);
});

test('#578 e2e: --handoff on a branch this machine already claims is refused as a contradiction', () => {
  const fx = fixture();
  executorBuilds(fx, BR, [90]);
  const r = colab(fx, ['ship', '--branch', BR, '--handoff', URL, '--repo', fx.workA, '--dry'], { home: fx.homeA, ...SHIPPER });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /this machine holds #90/);
});

// =================================================================================================
// #579 — a stale remote-built branch: the lander's base-sync merges do not void the hand-off
// =================================================================================================

test('#579 verdict: a hand-off naming a sha the head reached through base-sync merges passes', () => {
  const H = '1111111111111111111111111111111111111111';
  const M1 = '2222222222222222222222222222222222222222';
  const M2 = '3333333333333333333333333333333333333333';
  const c = { ...COMMENT, body: `wrapped on \`${BR}\` (head ${H.slice(0, 8)})` };
  const v = ho.handoffVerdict(base({ comment: c, refs: { localSha: null, remoteSha: M2 }, syncChain: [M1, H] }));
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.strictEqual(v.sha, M2, 'what lands is the synced head');
  assert.strictEqual(v.handedOff, H);
  assert.strictEqual(v.syncMerges, 2);
  assert.strictEqual(ho.handoffTrailer(v), `Colab-Handoff: ${URL} @ ${H.slice(0, 12)} (synced to ${M2.slice(0, 12)} by 2 base merges)`);
  // Without the chain the same hand-off is head-moved — the rule #578 shipped, unchanged.
  const bare = ho.handoffVerdict(base({ comment: c, refs: { localSha: null, remoteSha: M2 } }));
  assert.strictEqual(bare.reason, 'head-moved');
  // A chain that does not reach the named sha (a fix-up stopped the walk) still refuses, and says why.
  const short = ho.handoffVerdict(base({ comment: c, refs: { localSha: null, remoteSha: M2 }, syncChain: [M1] }));
  assert.strictEqual(short.reason, 'head-moved');
  assert.match(short.detail, /nor the sha its base-sync merges sit on/);
  // An unsynced hand-off's trailer is exactly #578's.
  assert.strictEqual(ho.handoffTrailer(ho.handoffVerdict(base())), `Colab-Handoff: ${URL} @ ${HEAD.slice(0, 12)}`);
});

/** A throwaway repo with a `main` and a branch `br` off it, for the chain walk on real git. */
function chainRepo() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-syncchain-'));
  TMP.push(d);
  execFileSync('git', ['init', '-q', '-b', 'main', d]);
  g(d, 'config', 'user.email', 'c@example.invalid'); g(d, 'config', 'user.name', 'chain');
  g(d, 'config', 'core.hooksPath', path.join(d, '.nohooks'));
  const commit = (file, text, msg) => { fs.writeFileSync(path.join(d, file), text); g(d, 'add', '-A'); g(d, 'commit', '-q', '-m', msg); return g(d, 'rev-parse', 'HEAD'); };
  commit('shared.txt', 'one\n', 'base');
  g(d, 'checkout', '-q', '-b', 'br');
  const H = commit('feature.txt', 'feature\n', 'feat: the work');
  g(d, 'checkout', '-q', 'main');
  commit('trunk.txt', 'trunk moved\n', 'trunk 1');
  g(d, 'checkout', '-q', 'br');
  return { d, H, commit, run: (a) => { const r = spawnSync('git', a, { cwd: d, encoding: 'utf8' }); return { ok: r.status === 0, code: r.status, stdout: (r.stdout || '').trim() }; } };
}

test('#579 syncMergeChain: clean base merges are walked; a fix-up, a side merge, a hand edit stop it', () => {
  // Two clean syncs stacked on H.
  const r = chainRepo();
  g(r.d, 'merge', '-q', '--no-edit', 'main');
  const M1 = g(r.d, 'rev-parse', 'HEAD');
  g(r.d, 'checkout', '-q', 'main'); r.commit('trunk2.txt', 'again\n', 'trunk 2'); g(r.d, 'checkout', '-q', 'br');
  g(r.d, 'merge', '-q', '--no-edit', 'main');
  const M2 = g(r.d, 'rev-parse', 'HEAD');
  assert.deepStrictEqual(ho.syncMergeChain(r.run, M2, 'main'), [M1, r.H]);
  assert.deepStrictEqual(ho.syncMergeChain(r.run, r.H, 'main'), [], 'an unsynced head has no chain');

  // A non-merge commit after H, then a sync: the walk stops at the fix-up, so H is not reached.
  const f = chainRepo();
  const fix = f.commit('feature.txt', 'feature, edited after the hand-off\n', 'fix: later');
  g(f.d, 'merge', '-q', '--no-edit', 'main');
  assert.deepStrictEqual(ho.syncMergeChain(f.run, g(f.d, 'rev-parse', 'HEAD'), 'main'), [fix]);

  // A merge whose result was hand-edited (amended) is not git's clean merge — not walked.
  const e = chainRepo();
  g(e.d, 'merge', '-q', '--no-edit', 'main');
  fs.writeFileSync(path.join(e.d, 'feature.txt'), 'smuggled into the merge\n');
  g(e.d, 'add', '-A'); g(e.d, 'commit', '-q', '--amend', '--no-edit');
  assert.deepStrictEqual(ho.syncMergeChain(e.run, g(e.d, 'rev-parse', 'HEAD'), 'main'), []);

  // A merge of something NOT on the base (a side branch) is not a base sync.
  const s = chainRepo();
  g(s.d, 'checkout', '-q', '-b', 'side', 'main~1'); s.commit('side.txt', 'side\n', 'side work'); g(s.d, 'checkout', '-q', 'br');
  g(s.d, 'merge', '-q', '--no-edit', 'side');
  assert.deepStrictEqual(ho.syncMergeChain(s.run, g(s.d, 'rev-parse', 'HEAD'), 'main'), []);

  // A conflict resolved by hand: merge-tree reports the conflict, so the merge is not walked.
  const c = chainRepo();
  g(c.d, 'checkout', '-q', 'main'); c.commit('shared.txt', 'trunk side\n', 'trunk edits shared'); g(c.d, 'checkout', '-q', 'br');
  c.commit('shared.txt', 'branch side\n', 'branch edits shared');
  const pre = g(c.d, 'rev-parse', 'HEAD');
  spawnSync('git', ['merge', '-q', '--no-edit', 'main'], { cwd: c.d });
  fs.writeFileSync(path.join(c.d, 'shared.txt'), 'resolved by hand\n');
  g(c.d, 'add', '-A'); g(c.d, 'commit', '-q', '--no-edit');
  assert.notStrictEqual(g(c.d, 'rev-parse', 'HEAD'), pre);
  assert.deepStrictEqual(ho.syncMergeChain(c.run, g(c.d, 'rev-parse', 'HEAD'), 'main'), []);
});

/** Trunk moves on origin after the hand-off (another branch lands), from machine B's clone. */
function trunkMoves(fx, file = 'other.txt') {
  g(fx.workB, 'checkout', '-q', 'main');
  g(fx.workB, 'pull', '-q', '--ff-only', 'origin', 'main');
  fs.writeFileSync(path.join(fx.workB, file), 'landed elsewhere\n');
  g(fx.workB, 'add', '-A'); g(fx.workB, 'commit', '-q', '-m', 'feat: something else landed');
  g(fx.workB, 'push', '-q', 'origin', 'main');
}

/** The lander's B0 sync: merge the base into the remote branch and push — from machine B. */
function landerSyncs(fx, branch) {
  g(fx.workB, 'fetch', '-q', 'origin');
  g(fx.workB, 'checkout', '-q', '-B', branch, `origin/${branch}`);
  g(fx.workB, 'merge', '-q', '--no-edit', 'origin/main');
  g(fx.workB, 'push', '-q', 'origin', branch);
  const head = g(fx.workB, 'rev-parse', 'HEAD');
  g(fx.workB, 'checkout', '-q', 'main');
  return head;
}

test('#579 e2e: a handed-off branch behind trunk is synced by the lander and lands from the SAME hand-off', () => {
  const fx = fixture();
  const { head } = executorBuilds(fx, BR, [90]);
  const url = postHandoff(fx, 90, '701', `wrapped on \`${BR}\` (head ${head.slice(0, 8)}, cut from main).`);
  trunkMoves(fx);
  const synced = landerSyncs(fx, BR);
  assert.notStrictEqual(synced, head);

  const rep = JSON.parse(colab(fx, ['ship', '--branch', BR, '--handoff', url, '--repo', fx.workB, '--dry', '--json'], { home: fx.homeB, ...SHIPPER }).out);
  const row = rep.checks.find((c) => /hand-off verified/.test(c.name));
  assert.ok(row && row.ok && /1 clean base-sync merge/.test(row.detail), JSON.stringify(rep.checks, null, 1));

  const r = colab(fx, ['ship', '--branch', BR, '--handoff', url, '--repo', fx.workB], { home: fx.homeB, ...SHIPPER });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /✓ Shipped feat\/thing-90 → main/);
  const msg = execFileSync('git', ['--git-dir', fx.origin, 'log', '-1', '--format=%B', 'main'], { encoding: 'utf8' });
  assert.match(msg, /Closes #90/);
  assert.ok(msg.includes(`Colab-Handoff: ${url} @ ${head.slice(0, 12)} (synced to ${synced.slice(0, 12)} by 1 base merge)`), msg);
  assert.strictEqual(execFileSync('git', ['--git-dir', fx.origin, 'show', 'main:thing.txt'], { encoding: 'utf8' }), 'built on A\n');
  assert.strictEqual(execFileSync('git', ['--git-dir', fx.origin, 'show', 'main:other.txt'], { encoding: 'utf8' }), 'landed elsewhere\n');
  assert.ok(!callLog(fx).includes('--force'));
});

test('#579 e2e: a non-merge commit after the handed-off head is still refused, synced or not', () => {
  const fx = fixture();
  const { wt, head } = executorBuilds(fx, BR, [90]);
  const url = postHandoff(fx, 90, '702', `wrapped on \`${BR}\` (head ${head.slice(0, 8)}).`);
  fs.writeFileSync(path.join(wt, 'more.txt'), 'after the hand-off\n');
  g(wt, 'add', '-A'); g(wt, 'commit', '-q', '-m', 'feat: more'); g(wt, 'push', '-q', 'origin', BR);
  trunkMoves(fx);
  landerSyncs(fx, BR);

  const r = colab(fx, ['ship', '--branch', BR, '--handoff', url, '--repo', fx.workB], { home: fx.homeB, ...SHIPPER });
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.err, /Refusing --handoff: .*moved after it was handed off by more than a clean merge of its base/);
  assert.doesNotMatch(execFileSync('git', ['--git-dir', fx.origin, 'log', '--format=%s', 'main'], { encoding: 'utf8' }), /the thing/);
});
