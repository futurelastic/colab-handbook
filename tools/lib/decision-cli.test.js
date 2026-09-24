'use strict';
/**
 * Subprocess/CLI tests for `colab decision` (#121, #122) — the gh I/O wiring in tools/colab
 * (cmdDecision / cmdDecisionRecord / cmdDecisionReopen / cmdDecisionList), never exercised by
 * tools/lib/decision-record.test.js's pure cases.
 *
 * Real CLI, real repo, real bare `origin` on disk (no network) — same fixture/colab() shape as
 * tools/lib/ship-migration-grant.test.js. UNLIKE that file's fake `gh` (which fails every write
 * uniformly, because migration-grant's fixture never needs to distinguish one write succeeding
 * from another), this file's fake `gh` is per-test SCRIPTED: it must let `issue comment` succeed
 * while `issue edit` fails, to reach the exact defect class this file exists to pin (a Ship-grade
 * REJECT on #121: cmdDecisionRecord printed success text and returned 0 after warning that the
 * label swap had just failed — CROSS-LANE class, not a one-off: "a machine-facing surface that
 * disagrees with what actually happened").
 *
 * Deliberately NOT a `COLAB_FAKE_GH`-style backdoor into TRUSTED_ASSOCIATIONS or any
 * authorization read — same posture ship-migration-grant.test.js states in its own banner. This
 * fixture only ever fakes gh's TRANSPORT (whether a given subcommand succeeds), never its content
 * in a way that would let a test inject a forged decision.
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

/**
 * A clone with a real bare `origin` and a `main` trunk, private COLAB_HOME, and a SCRIPTED fake
 * `gh` on PATH ahead of any real one. `script` maps a dispatch key (see below) to either a fixed
 * `{code, stdout, stderr}` or a function of the parsed argv returning one — letting each test
 * choose exactly which gh subcommand fails.
 */
function fixture(script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-decision-cli-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'colab decision test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), PROJECT_YML);
  fs.writeFileSync(path.join(work, 'f.txt'), 'base\n');
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');

  // The scripted fake gh: a tiny node dispatcher, keyed on the FIRST TWO argv words (e.g.
  // "issue view", "issue edit", "issue comment", "label list"), falling back to a bare success
  // for --version / auth status so isGhUsable() reads true.
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const scriptPath = path.join(bin, 'gh-script.json');
  fs.writeFileSync(scriptPath, JSON.stringify(script));
  fs.writeFileSync(path.join(bin, 'gh'), [
    '#!/usr/bin/env node',
    `const fs = require('fs');`,
    `const script = JSON.parse(fs.readFileSync(${JSON.stringify(scriptPath)}, 'utf8'));`,
    'const argv = process.argv.slice(2);',
    "if (argv[0] === '--version') { console.log('gh version 0.0.0 (fixture)'); process.exit(0); }",
    "if (argv[0] === 'auth' && argv[1] === 'status') { console.error('Logged in (fixture)'); process.exit(0); }",
    'const key = argv.slice(0, 2).join(" ");',
    'const entry = script[key];',
    'if (!entry) { console.error(`fixture gh: unscripted "${key}" — args: ${JSON.stringify(argv)}`); process.exit(1); }',
    'if (entry.stdout) process.stdout.write(entry.stdout);',
    'if (entry.stderr) process.stderr.write(entry.stderr);',
    'process.exit(entry.code || 0);',
  ].join('\n') + '\n', { mode: 0o755 });

  return { root, origin, work, home, bin, g };
}

function colab(fx, args, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fx.bin}:${process.env.PATH}`, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const OPEN_NO_LABELS = { code: 0, stdout: JSON.stringify({ state: 'OPEN', labels: [] }) + '\n' };

// --- the defect this file exists to pin: comment succeeds, label swap fails ------------------

test('decision --record: comment succeeds but the label swap fails — NEVER prints the success lines, exit code is non-zero', () => {
  const fx = fixture({
    'issue view': OPEN_NO_LABELS,
    'label list': { code: 1, stderr: 'fixture: no labels\n' }, // null present — skip the missing-label-hint path
    'issue comment': { code: 0, stdout: 'https://github.com/x/y/issues/1#issuecomment-1\n' },
    'issue edit': { code: 1, stderr: 'fixture: edit failed (rate limited)\n' },
  });
  const r = colab(fx, ['decision', '1', '--record', '--ruled-by', 'boss', '--repo', fx.work]);

  assert.notStrictEqual(r.code, 0, `expected non-zero exit on a partial failure; got ${r.code}\nSTDOUT:${r.out}\nSTDERR:${r.err}`);
  // The exact defect: these two lines asserted a state ("cleared", "applied") that the label
  // edit had JUST reported failing. Must never appear together with a failed edit.
  assert.doesNotMatch(r.out, /needs-decision cleared, decision-recorded applied/);
  assert.doesNotMatch(r.out, /Reopen any time/); // that follow-up line implies full success too
  // The output must say plainly that the labels need manual attention.
  assert.match(r.out + r.err, /label swap failed/);
  assert.match(r.out, /FAILED/);
});

test('decision --record: comment succeeds AND label swap succeeds — prints the success lines, exit code 0', () => {
  const fx = fixture({
    'issue view': OPEN_NO_LABELS,
    'label list': { code: 1, stderr: 'fixture: no labels\n' },
    'issue comment': { code: 0, stdout: 'https://github.com/x/y/issues/1#issuecomment-1\n' },
    'issue edit': { code: 0, stdout: '' },
  });
  const r = colab(fx, ['decision', '1', '--record', '--ruled-by', 'boss', '--repo', fx.work]);

  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /needs-decision cleared, decision-recorded applied/);
  assert.match(r.out, /Reopen any time/);
});

test('decision --record: the comment itself failing refuses cleanly, never attempts the label edit', () => {
  const fx = fixture({
    'issue view': OPEN_NO_LABELS,
    'label list': { code: 1, stderr: 'fixture: no labels\n' },
    'issue comment': { code: 1, stderr: 'fixture: comment failed\n' },
    // no 'issue edit' entry — if the code called it, the fixture gh would exit 1 with an
    // "unscripted" message that would NOT match /nothing was written/ below, failing the test.
  });
  const r = colab(fx, ['decision', '1', '--record', '--ruled-by', 'boss', '--repo', fx.work]);

  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /nothing was written, safe to retry/);
});

// --- --ruled-by is required, and required before any network call -----------------------------

test('decision --record without --ruled-by refuses before any gh call', () => {
  const fx = fixture({}); // any gh call here would hit "unscripted" and prove the refusal ran late
  const r = colab(fx, ['decision', '1', '--record', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.err, /--ruled-by <name> is required/);
});

// --- --record is NOT gated on COLAB_HUMAN (Boss ruling, recorded on #121) ---------------------

test('decision --record proceeds with NO COLAB_HUMAN set — this command transcribes, it does not authorize', () => {
  const fx = fixture({
    'issue view': OPEN_NO_LABELS,
    'label list': { code: 1, stderr: 'fixture: no labels\n' },
    'issue comment': { code: 0, stdout: '' },
    'issue edit': { code: 0, stdout: '' },
  });
  const r = colab(fx, ['decision', '1', '--record', '--ruled-by', 'boss', '--repo', fx.work], { COLAB_HUMAN: '' });
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.err, /requires a human/);
});

// --- reopen: label swap failing refuses outright (mirrors record's ordering, gate-first) ------

test('decision --reopen: the label swap failing refuses non-zero, never claims the gate is restored', () => {
  const fx = fixture({
    'issue view': { code: 0, stdout: JSON.stringify({ state: 'OPEN', labels: [{ name: 'decision-recorded' }], comments: [] }) + '\n' },
    'issue edit': { code: 1, stderr: 'fixture: edit failed\n' },
  });
  const r = colab(fx, ['decision', '1', '--reopen', '--ruled-by', 'boss', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0);
  assert.doesNotMatch(r.out, /is restored/);
  assert.match(r.err, /gate is NOT yet restored/);
});

test('decision --reopen: label swap succeeds but the receipt comment fails — the gate DID restore, so this still exits 0 and says so (mirrors migration-grant --revoke\'s precedent)', () => {
  const fx = fixture({
    'issue view': { code: 0, stdout: JSON.stringify({ state: 'OPEN', labels: [{ name: 'decision-recorded' }], comments: [] }) + '\n' },
    'issue edit': { code: 0, stdout: '' },
    'issue comment': { code: 1, stderr: 'fixture: comment failed\n' },
  });
  const r = colab(fx, ['decision', '1', '--reopen', '--ruled-by', 'boss', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /is restored/);
  assert.match(r.err, /reopen receipt failed to post/);
});

// --- reopen: an epic never carries needs-decision (#361) -------------------------------------

test('decision --reopen on an epic refuses before any write and names the decision-issue path', () => {
  // Only `issue view` is scripted: an `issue edit` or `issue comment` would hit the fixture's
  // "unscripted" exit, so reaching the refusal text proves no write was attempted.
  const fx = fixture({
    'issue view': { code: 0, stdout: JSON.stringify({ state: 'OPEN', labels: [{ name: 'epic' }, { name: 'decision-recorded' }], comments: [] }) + '\n' },
  });
  const r = colab(fx, ['decision', '7', '--reopen', '--ruled-by', 'boss', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /#7 is an epic/);
  assert.match(r.err, /sub-issue/);
  assert.doesNotMatch(r.err, /unscripted/);
  assert.doesNotMatch(r.out, /is restored/);
});

// --- list: a failed read never reports "no outstanding decision records" ----------------------

test('decision --list never reports "no outstanding decision records" on a failed read', () => {
  const fx = fixture({
    'issue list': { code: 1, stderr: 'fixture: list failed\n' },
  });
  const r = colab(fx, ['decision', '--list', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.doesNotMatch(r.out, /no outstanding decision records/);
});

// --- #357: the both-labels pair — a second question vs an interrupted write -------------------

const RECORD_AT = '2026-09-23T15:00:00Z';
const RECORD_COMMENT = {
  body: `⚖ Decision recorded — ruled-by \`boss\` · answers \`-\` · host \`box\` · ${RECORD_AT}`,
  createdAt: RECORD_AT,
  author: { login: 'maintainer' },
  authorAssociation: 'OWNER',
};
const PAIR_VIEW = {
  code: 0,
  stdout: JSON.stringify({ state: 'OPEN', labels: [{ name: 'needs-decision' }, { name: 'decision-recorded' }], comments: [RECORD_COMMENT] }) + '\n',
};
const ASKED_AFTER = { code: 0, stdout: '2026-09-20T09:00:00Z\n2026-09-24T00:00:00Z\n' }; // newest > record
const ASKED_BEFORE = { code: 0, stdout: '2026-09-20T09:00:00Z\n' };                      // all < record

test('decision --record over the pair WITHOUT --answers refuses before any write, and names --reopen (an open second question)', () => {
  const fx = fixture({
    'issue view': PAIR_VIEW,
    'api --paginate': ASKED_AFTER,
    // no 'issue comment' / 'issue edit' — a write would hit "unscripted" and fail differently
  });
  const r = colab(fx, ['decision', '1', '--record', '--ruled-by', 'boss', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /OPEN second question/);
  assert.match(r.err, /--answers/);
  assert.match(r.err, /colab decision 1 --reopen --ruled-by <name>/);
  assert.doesNotMatch(r.err, /unscripted/);
});

test('decision --record over an interrupted write WITHOUT --answers refuses and names the label fix, not --reopen', () => {
  const fx = fixture({ 'issue view': PAIR_VIEW, 'api --paginate': ASKED_BEFORE });
  const r = colab(fx, ['decision', '1', '--record', '--ruled-by', 'boss', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /interrupted --record/);
  assert.match(r.err, /gh issue edit 1 --remove-label needs-decision/);
});

test('decision --record over the pair with an unreadable label timeline refuses as UNDETERMINED (never assumes interrupted)', () => {
  const fx = fixture({ 'issue view': PAIR_VIEW, 'api --paginate': { code: 1, stderr: 'fixture: events failed\n' } });
  const r = colab(fx, ['decision', '1', '--record', '--ruled-by', 'boss', '--repo', fx.work]);
  assert.notStrictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err, /cannot tell an open question from an interrupted write/);
  assert.match(r.err, /--reopen/);
});

test('decision --record over the pair WITH --answers proceeds — the record says which question it answers', () => {
  const fx = fixture({
    'issue view': PAIR_VIEW,
    'api --paginate': ASKED_AFTER,
    'label list': { code: 1, stderr: 'fixture: no labels\n' },
    'issue comment': { code: 0, stdout: '' },
    'issue edit': { code: 0, stdout: '' },
  });
  const r = colab(fx, ['decision', '1', '--record', '--ruled-by', 'boss', '--answers', 'issuecomment-2', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /needs-decision cleared, decision-recorded applied/);
});

test('decision --list surfaces a hand-re-asked question as pending, NOT among the live decisions', () => {
  const fx = fixture({
    'issue list': { code: 0, stdout: JSON.stringify([{ number: 7, title: 'second question' }]) + '\n' },
    'issue view': PAIR_VIEW,
    'api --paginate': ASKED_AFTER,
  });
  const r = colab(fx, ['decision', '--list', '--json', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.deepStrictEqual(j.decisions, []);
  assert.strictEqual(j.pairs.length, 1);
  assert.strictEqual(j.pairs[0].verdict, 'open-question');
  assert.strictEqual(j.pairs[0].pending, true);
  assert.match(j.pairs[0].fix, /--reopen/);

  const t = colab(fx, ['decision', '--list', '--repo', fx.work]);
  assert.strictEqual(t.code, 0, t.out + t.err);
  assert.match(t.err, /#7 carries both needs-decision and decision-recorded — an OPEN second question/);
  assert.doesNotMatch(t.out, /no outstanding decision records/);
});

test('decision --list keeps an interrupted write among the live decisions, and names the label fix', () => {
  const fx = fixture({
    'issue list': { code: 0, stdout: JSON.stringify([{ number: 7, title: 'interrupted' }]) + '\n' },
    'issue view': PAIR_VIEW,
    'api --paginate': ASKED_BEFORE,
  });
  const r = colab(fx, ['decision', '--list', '--json', '--repo', fx.work]);
  assert.strictEqual(r.code, 0, r.out + r.err);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.decisions.length, 1);
  assert.strictEqual(j.pairs[0].verdict, 'interrupted-write');
  assert.strictEqual(j.pairs[0].pending, false);
  assert.match(j.pairs[0].fix, /--remove-label needs-decision/);
});
