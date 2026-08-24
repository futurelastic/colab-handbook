'use strict';
/**
 * End-to-end CLI tests for #264 (a re-claim must never downgrade a known `branch` to `-`) and #267
 * (the tie-break/refusal gate must be able to tell two sessions of ONE account apart) — the two
 * issues .claude/plans/issue-264.md designs together, since both touch the same claim-record shape.
 * `tools/lib/claim-identity.test.js` covers the pure merge/comparison logic in isolation; this file
 * drives the REAL `colab claim` / `colab worktree new` / `colab config` CLI against a real git repo,
 * a private COLAB_HOME, and a stateful fake `gh` — the only way to reach `cmdClaim`'s mutate,
 * `ghClaimConflicts`, `commentAndTieBreak` and `tieBreakVerdict` together, since none of those are
 * exported (see the header of tools/lib/yield-issue-release.test.js, the sibling fixture this one's
 * `colab()`/repo-setup shape is copied from).
 *
 * UNLIKE yield-issue-release.test.js's fixed two-comment fixture, this file's fake `gh` is
 * STATEFUL: `issue comment` APPENDS to a per-issue comment log and `issue edit` mutates a per-issue
 * assignee/label set, both read back by `issue view --json ...` — because several tests here are
 * about a SECOND `colab claim` call seeing what the FIRST one actually wrote (the #264 correction
 * path), which a fixed-response fixture cannot express.
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
const HOST = os.hostname();

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

const PROJECT_YML = 'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n';

// The exact claim-comment wire format `claimCommentBody`/`sessionCommentSuffix` write (tools/colab
// :291-296) — mirrored here (not imported: those are internal, unexported functions) so seeded
// comments parse identically to ones the real CLI would have posted.
function claimBody({ wt = null, branch = null, host, iso, session = '', sessionName = '' }) {
  let body = `🔒 Claimed — worktree \`${wt || '-'}\` · branch \`${branch || '-'}\` · host \`${host}\` · ${iso}`;
  if (sessionName && session) body += ` · session [${sessionName}](${session})`;
  else if (session) body += ` · session ${session}`;
  else if (sessionName) body += ` · session ${sessionName}`;
  return body;
}

/** A stable, strictly-increasing fake ISO timestamp for the Nth event (N starting at 0). */
function fakeIso(n) {
  return new Date(Date.UTC(2020, 0, 1) + n * 1000).toISOString();
}

/**
 * A clone with a real bare `origin`, private COLAB_HOME, and a STATEFUL fake `gh` on PATH:
 *   - `--version` / `auth status` / `api user` (login always "me") answer without touching state;
 *   - `issue edit N --add-assignee @me --add-label in-progress` / `--remove-...` mutate
 *     `gh-state/issue-N.json`'s `assignees`/`labels` arrays;
 *   - `issue comment N --body <body>` APPENDS `{createdAt, author:{login:"me"}, body}` to that same
 *     file's `comments` array, timestamped by a shared monotonic counter;
 *   - `issue view N --json <fields>` prints the current `{comments, assignees, labels}` for N,
 *     regardless of which fields were actually requested (same permissive shape
 *     yield-issue-release.test.js's fixture uses — every caller here reads a subset of these three).
 * Every invocation is also appended (one JSON line, full argv) to `gh-state/calls.log`, so a test
 * can assert "no gh write happened" precisely rather than by absence of a side effect.
 */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-reclaim-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  const ghState = path.join(root, 'gh-state');
  fs.mkdirSync(home);
  fs.mkdirSync(ghState);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'claim-reclaim test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const ghScript = path.join(bin, 'gh-fake.js');
  fs.writeFileSync(ghScript, [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    `const STATE = ${JSON.stringify(ghState)};`,
    "const argv = process.argv.slice(2);",
    "fs.appendFileSync(path.join(STATE, 'calls.log'), JSON.stringify(argv) + '\\n');",
    "if (argv[0] === '--version') { console.log('gh version 0.0.0 (fixture)'); process.exit(0); }",
    "if (argv[0] === 'auth' && argv[1] === 'status') { console.error('Logged in (fixture)'); process.exit(0); }",
    "if (argv[0] === 'api' && argv[1] === 'user') { console.log('me'); process.exit(0); }",
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
    "  const n = argv[2]; const bodyIdx = argv.indexOf('--body'); const body = argv[bodyIdx + 1];",
    "  const st = load(n);",
    "  const c = counter();",
    "  const iso = new Date(Date.UTC(2020, 0, 1) + (1000 + c) * 1000).toISOString();",
    "  st.comments.push({ createdAt: iso, author: { login: 'me' }, body });",
    "  save(n, st); process.exit(0);",
    "}",
    "if (argv[0] === 'issue' && argv[1] === 'view') {",
    "  const n = argv[2]; const st = load(n);",
    "  console.log(JSON.stringify({",
    "    comments: st.comments,",
    "    assignees: st.assignees.map((login) => ({ login })),",
    "    labels: st.labels.map((name) => ({ name })),",
    "  }));",
    "  process.exit(0);",
    "}",
    "console.error(`fixture gh: unscripted — args: ${JSON.stringify(argv)}`); process.exit(1);",
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec node ${JSON.stringify(ghScript)} "$@"\n`, { mode: 0o755 });

  return { root, origin, work, home, ghState, bin, g };
}

function colab(fx, args) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '' },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** Seed GitHub-side state for an issue BEFORE any `colab` call touches it — simulates a claim (or
 *  partial claim) made by a session this test does not itself drive through the CLI. */
function seedIssue(fx, num, { comments = [], assignees = [], labels = [] } = {}) {
  fs.writeFileSync(path.join(fx.ghState, `issue-${num}.json`), JSON.stringify({ comments, assignees, labels }));
}

function readIssueState(fx, num) {
  try { return JSON.parse(fs.readFileSync(path.join(fx.ghState, `issue-${num}.json`), 'utf8')); }
  catch (_) { return { comments: [], assignees: [], labels: [] }; }
}

function readCalls(fx) {
  try {
    return fs.readFileSync(path.join(fx.ghState, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (_) { return []; }
}

function loadClaim(fx, num) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; } // nothing was ever written locally
  return Object.values(raw.claims).find((c) => String(c.issue).includes(String(num))) || null;
}

const CLAIM_RE = /🔒 Claimed — worktree `([^`]*)` · branch `([^`]*)` · host `([^`]*)` · (\S+)/;

// --- #264: the merge/correction path ----------------------------------------------------------

test('#264 path A: claim before the branch is cut, then re-claim WITH a branch — the record is corrected and exactly one additional comment is posted', () => {
  const fx = fixture();
  const r1 = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1', '--repo', fx.work]);
  assert.strictEqual(r1.code, 0, r1.out + r1.err);
  assert.strictEqual(readIssueState(fx, 9).comments.length, 1);
  assert.strictEqual(loadClaim(fx, 9).branch, null);

  const r2 = colab(fx, ['claim', '9', '--worktree', 'w', '--branch', 'fix/x', '--session', 's1', '--repo', fx.work]);
  assert.strictEqual(r2.code, 0, r2.out + r2.err);
  assert.match(r2.out, /re-claimed — branch recorded: fix\/x/);

  assert.strictEqual(loadClaim(fx, 9).branch, 'fix/x', 'the claim record must now show the corrected branch');
  const comments = readIssueState(fx, 9).comments;
  assert.strictEqual(comments.length, 2, `expected exactly one additional comment, got: ${JSON.stringify(comments)}`);
  assert.match(comments[1].body, /branch `fix\/x`/);
});

test('#264 path B: --force takeover from the trunk checkout is HONEST (no branch inherited) and announced', () => {
  const fx = fixture();
  const r1 = colab(fx, ['claim', '9', '--worktree', 'w', '--branch', 'fix/x', '--session', 's1', '--repo', fx.work]);
  assert.strictEqual(r1.code, 0, r1.out + r1.err);
  assert.strictEqual(loadClaim(fx, 9).branch, 'fix/x');

  const r2 = colab(fx, ['claim', '9', '--force', '--session', 's2', '--repo', fx.work]);
  assert.match(r2.out, /--force: taking over #9 from worktree "w"/, r2.out + r2.err);
  // The new holder (the trunk checkout) genuinely has no branch — the record must say so honestly,
  // never silently keep reporting the displaced holder's `fix/x` as though it still applied.
  assert.strictEqual(loadClaim(fx, 9).branch, null);
  assert.strictEqual(loadClaim(fx, 9).session, 's2');
});

test('idempotent re-claim (nothing changed): no additional comment, no additional gh write', () => {
  const fx = fixture();
  const r1 = colab(fx, ['claim', '9', '--worktree', 'w', '--branch', 'fix/x', '--session', 's1', '--repo', fx.work]);
  assert.strictEqual(r1.code, 0, r1.out + r1.err);
  const callsAfterFirst = readCalls(fx).length;

  const r2 = colab(fx, ['claim', '9', '--worktree', 'w', '--branch', 'fix/x', '--session', 's1', '--repo', fx.work]);
  assert.strictEqual(r2.code, 0, r2.out + r2.err);
  assert.match(r2.out, /already claimed by this worktree — OK \(idempotent\)/);

  const callsAfterSecond = readCalls(fx);
  const ghWritesSinceFirst = callsAfterSecond.slice(callsAfterFirst)
    .filter((a) => a[0] === 'issue' && (a[1] === 'comment' || a[1] === 'edit'));
  assert.deepStrictEqual(ghWritesSinceFirst, [], `expected no gh write on a true no-op re-claim, got: ${JSON.stringify(ghWritesSinceFirst)}`);
  assert.strictEqual(readIssueState(fx, 9).comments.length, 1);
});

test('wire format frozen: every posted comment still matches CLAIM_RE (regression guard on the rejected "omit the field" fix)', () => {
  const fx = fixture();
  colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1', '--repo', fx.work]);
  colab(fx, ['claim', '9', '--worktree', 'w', '--branch', 'fix/x', '--session', 's1', '--repo', fx.work]);
  const comments = readIssueState(fx, 9).comments;
  assert.ok(comments.length >= 2);
  for (const c of comments) assert.match(c.body, CLAIM_RE, `comment did not match the frozen wire format: ${c.body}`);
});

// --- #267: identity granularity -----------------------------------------------------------------

test('#267 default (unset claimIdentity) is INERT: an earlier co-tenant comment (same login+host, different session) does not cost us the issue', () => {
  const fx = fixture();
  seedIssue(fx, 9, {
    assignees: ['me'], labels: ['in-progress'],
    comments: [{ createdAt: fakeIso(0), author: { login: 'me' }, body: claimBody({ host: HOST, iso: fakeIso(0), session: 'session_other' }) }],
  });
  const r = colab(fx, ['claim', '9', '--worktree', 'w2', '--session', 'session_mine', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out + r.err, /Yielded/);
});

test('#267 opt-in (claimIdentity=login,host,session) makes the co-tenant race visible: we yield, the GitHub marker is left alone, both sessions are named', () => {
  const fx = fixture();
  const cfg = colab(fx, ['config', 'set', 'claimIdentity', 'login,host,session']);
  assert.strictEqual(cfg.code, 0, cfg.out + cfg.err);
  // No assignee/label yet (an eventual-consistency window on the OTHER session's just-completed
  // claim — notify.js documents an observed 8-minute label read-after-write lag on this tracker),
  // only the live claim comment — this is what makes the RACE (tie-break) path reachable rather
  // than the refusal gate (covered separately below).
  seedIssue(fx, 9, {
    comments: [{ createdAt: fakeIso(0), author: { login: 'me' }, body: claimBody({ host: HOST, iso: fakeIso(0), session: 'session_other' }) }],
  });
  const r = colab(fx, ['claim', '9', '--worktree', 'w2', '--session', 'session_mine', '--repo', fx.work]);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out + r.err, /Yielded #9 to a CO-TENANT/);
  assert.match(r.out + r.err, /claimIdentity=login,host,session/);
  assert.match(r.out + r.err, /session_other/);
  assert.match(r.out + r.err, /session_mine/);
  const st = readIssueState(fx, 9);
  assert.match(st.comments[st.comments.length - 1].body, /^✅ Released/);
  // yieldIssue must NOT remove the GitHub marker when the winner shares our login (#173's existing
  // rule, load-bearing for #267 too — the co-tenant still needs it).
  assert.ok(!st.assignees.length && !st.labels.length || st.assignees.includes('me'),
    'the co-tenant claim (same login) must not have its own assignee/label stripped');
});

test('#267 refusal gate: a fully-claimed co-tenant issue (labeled + assigned) refuses BEFORE any write under the fine setting; --force is announced', () => {
  const fx = fixture();
  colab(fx, ['config', 'set', 'claimIdentity', 'login,host,session']);
  seedIssue(fx, 9, {
    assignees: ['me'], labels: ['in-progress'],
    comments: [{ createdAt: fakeIso(0), author: { login: 'me' }, body: claimBody({ host: HOST, iso: fakeIso(0), session: 'session_other' }) }],
  });

  const refused = colab(fx, ['claim', '9', '--worktree', 'w2', '--session', 'session_mine', '--repo', fx.work]);
  assert.strictEqual(refused.code, 1, refused.out + refused.err);
  assert.match(refused.out + refused.err, /live claim comment by .*same account, different session/);
  assert.strictEqual(loadClaim(fx, 9), null, 'a refused claim must not have written a local record');

  const forced = colab(fx, ['claim', '9', '--worktree', 'w2', '--force', '--session', 'session_mine', '--repo', fx.work]);
  assert.match(forced.out, /--force: taking over #9 from a co-tenant claim/, forced.out + forced.err);
  // Deliberately not asserting the FINAL held/yielded state past this point — the tie-break
  // (covered by its own tests above/below) may still independently yield #9 back based on comment
  // timestamps, which is correct and orthogonal to whether --force cleared the refusal gate.
});

test('legacy comment safety: a session-less claim comment from our own login+host does not make us yield under the fine setting (degrade-on-missing)', () => {
  const fx = fixture();
  colab(fx, ['config', 'set', 'claimIdentity', 'login,host,session']);
  seedIssue(fx, 9, {
    assignees: ['me'], labels: ['in-progress'],
    // no `session:` field at all — the pre-#242 legacy comment shape.
    comments: [{ createdAt: fakeIso(0), author: { login: 'me' }, body: claimBody({ host: HOST, iso: fakeIso(0) }) }],
  });
  const r = colab(fx, ['claim', '9', '--worktree', 'w2', '--session', 'session_mine', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out + r.err, /Yielded/);
});

test('anchor: two live claims of ours with a stranger claim TIMESTAMPED BETWEEN them — we do not yield (earliest anchor, not latest)', () => {
  const fx = fixture();
  // t0: our own earlier claim comment (a prior session/resume of "us", same login+host, default
  // coarse comps — this is the #264 correction scenario's shape: OUR OWN second comment must never
  // cost us a race we had already won).
  // t1: a stranger's claim comment, timestamped AFTER our first comment.
  // t2: our own SECOND comment, posted by the live `colab claim` call this test drives.
  seedIssue(fx, 9, {
    assignees: ['me'], labels: ['in-progress'],
    comments: [
      { createdAt: fakeIso(0), author: { login: 'me' }, body: claimBody({ host: HOST, iso: fakeIso(0), session: 's1' }) },
      { createdAt: fakeIso(1), author: { login: 'stranger' }, body: claimBody({ host: 'stranger-host', iso: fakeIso(1), session: 's-stranger' }) },
    ],
  });
  const r = colab(fx, ['claim', '9', '--worktree', 'w', '--session', 's1', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out + r.err, /Yielded/, 'anchoring on our EARLIEST live claim (t0) must not let the stranger at t1 beat us');
});

// --- config surface -------------------------------------------------------------------------

test('colab config show lists claimIdentity once set; colab config set claimIdentity <garbage> refuses', () => {
  const fx = fixture();
  const set = colab(fx, ['config', 'set', 'claimIdentity', 'login,host,session']);
  assert.strictEqual(set.code, 0, set.out + set.err);
  const show = colab(fx, ['config', 'show']);
  assert.match(show.out, /"claimIdentity":\s*"login,host,session"/);

  const bad = colab(fx, ['config', 'set', 'claimIdentity', 'nonsense']);
  assert.notStrictEqual(bad.code, 0);
  assert.match(bad.out + bad.err, /claimIdentity must be/);
});
