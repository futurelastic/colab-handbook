'use strict';
/**
 * The adversarial half of #285: does the place-claim actually SERIALIZE concurrent writers of one
 * shared checkout, driven by real racing processes rather than by a mock that agrees with us?
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * WHY A SEPARATE FILE FROM place.test.js / place-cli.test.js. `place.test.js` unit-tests the
 * primitive with an injected probe (deterministic, no processes). `place-cli.test.js` drives the
 * CLI one invocation at a time, pinning the #133/#136/#242 refusal MESSAGES. Neither can observe
 * the defect this file exists for, because that defect only exists BETWEEN processes:
 *
 *   Every shared-checkout acquire site was a check-then-act pair straddling the state lock —
 *   `placeState()` loaded state with no lock, `place.conflict` judged that snapshot, and
 *   `placeMutate` then wrote the record UNCONDITIONALLY inside the lock, never re-checking the
 *   fact the decision rested on. Measured on this exact fixture against the pre-#285 binary:
 *   **8 of 8 concurrent `colab place acquire` invocations exited 0**, and `state.json` ended up
 *   holding one record belonging to whoever happened to write last. The place-claim provided no
 *   mutual exclusion at all — the "two sessions can each read unlocked, each write held by me, and
 *   both proceed WITH CONFIDENCE" failure CONVENTIONS.md ("Place-claims") calls worse than having
 *   no lock, arriving through the check/write split rather than through a synced filesystem.
 *
 * THE TEST WAS DEMONSTRATED RED BEFORE THE FIX, not merely green after it. A concurrency test
 * nobody has seen fail is not an oracle — a K-process race can serialize by scheduler accident.
 * Two things guard against a false green here:
 *   1. The pre-change measurement above (8/8 winners) is reproducible by pointing `COLAB_BIN` at a
 *      pre-#285 checkout of `tools/`; that env override exists in THIS FILE ONLY, for that purpose.
 *   2. `place.test.js`'s `acquire` block proves the same property deterministically, with no
 *      timing at all. If the scheduler ever makes this file pass for the wrong reason, that one
 *      still fails for the right one.
 *
 * REPS is deliberately > 1: a single round that happens to serialize proves nothing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
// Test-only override, see the header: point this at a pre-#285 `tools/colab` to watch these fail.
const COLAB = process.env.COLAB_BIN || path.join(REPO_ROOT, 'tools', 'colab');

const K = 8;      // concurrent writers per round
const REPS = 3;   // rounds per case

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function baseYml(writes) {
  return `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\nwrites: ${writes}\n`;
}

/** A real repo with a bare `origin`, a declared `writes:` value, and a PRIVATE COLAB_HOME. */
function fixture(writes) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'place-serialize-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'place serialize test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), baseYml(writes));
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  return { root, work, home };
}

/**
 * Ambient identity is scrubbed on EVERY child (the same discipline place-cli.test.js states and for
 * the same reason): a developer's exported COLAB_SESSION would make every child the *same* holder,
 * and the re-acquire exemption would then turn a broken lock into a green test.
 */
function childEnv(fx, extra = {}) {
  return {
    ...process.env,
    COLAB_HOME: fx.home,
    COLAB_SESSION: '', COLAB_SESSION_NAME: '', COLAB_HUMAN: '', COLAB_PLACE_PID: '',
    CLAUDECODE: '', AI_AGENT: '', CLAUDE_PID: '',
    ...extra,
  };
}

/** The argv for one contender, per command under test. */
function argvFor(cmd, fx, session, n) {
  if (cmd === 'place acquire') return ['place', 'acquire', fx.work, '--repo', fx.work, '--session', session];
  if (cmd === 'solo') return ['solo', '--repo', fx.work, '--session', session];
  // Distinct ISSUE numbers on purpose: the claim registry then has nothing to refuse, so anything
  // that serializes these can only be the place-claim on the trunk checkout.
  if (cmd === 'claim') return ['claim', String(100 + n), '--repo', fx.work, '--session', session];
  throw new Error(`unknown cmd ${cmd}`);
}

/** Launch K contenders at once and resolve once every one has exited. */
function race(cmd, fx, sessions, extraEnv = {}) {
  return Promise.all(sessions.map((session, n) => new Promise((resolve) => {
    const child = spawn('node', [COLAB, ...argvFor(cmd, fx, session, n)], {
      env: childEnv(fx, extraEnv), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ session, code, out, err }));
  })));
}

function placesOf(fx) {
  const raw = fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8');
  return JSON.parse(raw).places || {};
}

// ---------------------------------------------------------------------------------------
// The matrix: {place acquire, solo, claim} x {direct, free}, all-distinct sessions.
//
// `solo` needs COLAB_HUMAN=1 to clear its attendance gate (⚖ #233/#237) — that gate is NOT what is
// under test here, so it is satisfied for every contender equally and the race is decided by the
// place-claim alone. This file changes nothing about who may open solo flow; #285 deliberately
// moves no permission.
// ---------------------------------------------------------------------------------------

for (const writes of ['direct', 'free']) {
  for (const cmd of ['place acquire', 'solo', 'claim']) {
    test(`${K} concurrent "colab ${cmd}" on one trunk checkout (writes: ${writes}) — exactly ONE wins, every round`, async () => {
      for (let round = 0; round < REPS; round++) {
        const fx = fixture(writes);
        const sessions = Array.from({ length: K }, (_, i) => `sess-${round}-${i}`);
        const results = await race(cmd, fx, sessions, cmd === 'solo' ? { COLAB_HUMAN: '1' } : {});

        const winners = results.filter((r) => r.code === 0);
        assert.strictEqual(winners.length, 1,
          `round ${round}: expected exactly 1 winner, got ${winners.length} `
          + `(${winners.map((w) => w.session).join(', ')}). This is the #285 defect: a check-then-act `
          + `pair straddling the state lock lets every contender read "free" and then write "held by me".`);

        // Every loser refuses with a place-claim verdict — 1 (a live other holder) or 2 (liveness
        // unprovable). A crash, a stack trace, or any other code is a different failure.
        for (const l of results.filter((r) => r.code !== 0)) {
          assert.ok(l.code === 1 || l.code === 2,
            `round ${round}: loser ${l.session} exited ${l.code}, expected 1 or 2.\n${l.out}\n${l.err}`);
        }

        // And the one surviving record belongs to the one winner — not to whoever wrote last.
        const places = placesOf(fx);
        assert.strictEqual(Object.keys(places).length, 1, `round ${round}: expected exactly one place record`);
        assert.strictEqual(Object.values(places)[0].session, winners[0].session,
          `round ${round}: the recorded holder is not the process that was told it won`);
      }
    });
  }
}

// ---------------------------------------------------------------------------------------
// The mirror-image row: the SAME session re-acquiring must NOT be serialized against itself.
// `conflict`'s self-exemption (#242) is what makes a session able to renew its own hold across
// commands, and #285 must not regress it into a self-collision.
// ---------------------------------------------------------------------------------------

test(`${K} concurrent "colab place acquire" all carrying the SAME --session — every one succeeds (re-acquire, #242)`, async () => {
  const fx = fixture('direct');
  const results = await race('place acquire', fx, Array.from({ length: K }, () => 'one-and-the-same'));
  for (const r of results) {
    assert.strictEqual(r.code, 0, `a re-acquire by the same holder must not be refused: ${r.out}${r.err}`);
  }
  const places = placesOf(fx);
  assert.strictEqual(Object.keys(places).length, 1);
  assert.strictEqual(Object.values(places)[0].session, 'one-and-the-same');
});

// ---------------------------------------------------------------------------------------
// A held checkout stays held for a LATER writer too — the serialization is not a one-shot property
// of the racing moment. Also pins that the refusal names a holder a human can act on (#235).
// ---------------------------------------------------------------------------------------

test('a second, LATER writer is refused by the standing hold and the refusal names the holder', async () => {
  const fx = fixture('direct');
  const [first] = await race('place acquire', fx, ['holder-1']);
  assert.strictEqual(first.code, 0, first.out + first.err);
  const [second] = await race('place acquire', fx, ['late-comer']);
  assert.strictEqual(second.code, 1);
  assert.match(second.out + second.err, /holder-1/, 'the refusal must name a holder a human can go ask');
  assert.strictEqual(Object.values(placesOf(fx))[0].session, 'holder-1');
});

// ---------------------------------------------------------------------------------------
// Change 3 (#285): `colab solo` reclaims a solo lock whose CO-LOCATED place-claim holder is
// confirmed dead, instead of demanding the same `--force` used to take over a LIVE holder.
// Deliberately not gated on `writes:` — a stale record is stale under every value.
// ---------------------------------------------------------------------------------------

function writeState(fx, st) {
  fs.writeFileSync(path.join(fx.home, 'state.json'), JSON.stringify(st, null, 2) + '\n');
}

/** A pid that is certainly not running: allocate one, reap it, reuse the number immediately. */
function deadPid() {
  const r = spawn('node', ['-e', '0'], { stdio: 'ignore' });
  const pid = r.pid;
  return new Promise((resolve) => r.on('close', () => resolve(pid)));
}

for (const writes of ['direct', 'free']) {
  test(`solo reclaims a stale solo lock when its place-claim holder is CONFIRMED dead (writes: ${writes}) — no --force`, async () => {
    const fx = fixture(writes);
    const [opened] = await race('solo', fx, ['first-session'], { COLAB_HUMAN: '1' });
    assert.strictEqual(opened.code, 0, opened.out + opened.err);

    // Kill the holder by making its anchor a pid that is provably gone. This is the crashed-session
    // shape: `st.solo` still present, its place-claim's holder demonstrably not running.
    const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
    const key = Object.keys(st.places)[0];
    st.places[key].pid = await deadPid();
    st.places[key].pidKind = 'anchor';
    writeState(fx, st);

    const [reclaimed] = await race('solo', fx, ['second-session'], { COLAB_HUMAN: '1' });
    assert.strictEqual(reclaimed.code, 0,
      `a solo lock whose holder is confirmed gone must be reclaimable without --force:\n${reclaimed.out}${reclaimed.err}`);
    assert.match(reclaimed.out, /Superseding a solo lock/);
    assert.strictEqual(Object.values(placesOf(fx))[0].session, 'second-session');
  });
}

test('solo does NOT reclaim while the place-claim holder is alive — today\'s refusal stands', async () => {
  const fx = fixture('direct');
  const [opened] = await race('solo', fx, ['live-holder'], { COLAB_HUMAN: '1' });
  assert.strictEqual(opened.code, 0, opened.out + opened.err);
  const [blocked] = await race('solo', fx, ['newcomer'], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(blocked.code, 0, 'a LIVE holder must still refuse');
  assert.strictEqual(Object.values(placesOf(fx))[0].session, 'live-holder');
});

test('solo does NOT reclaim an UNPROVABLE holder — #288\'s fail-closed direction survives #285', async () => {
  // A `pidKind: 'invocation'` hold reads live:null forever by design (#288). Auto-reclaiming it
  // would silently undo the fix that issue shipped, so this pins that it does not happen.
  const fx = fixture('direct');
  const [opened] = await race('solo', fx, ['unprovable-holder'], { COLAB_HUMAN: '1' });
  assert.strictEqual(opened.code, 0, opened.out + opened.err);
  const st = JSON.parse(fs.readFileSync(path.join(fx.home, 'state.json'), 'utf8'));
  const key = Object.keys(st.places)[0];
  st.places[key].pid = await deadPid();     // dead AND unprobeable — `invocation` wins, so no reclaim
  st.places[key].pidKind = 'invocation';
  writeState(fx, st);
  const [blocked] = await race('solo', fx, ['newcomer'], { COLAB_HUMAN: '1' });
  assert.notStrictEqual(blocked.code, 0, 'an unprovable holder must fail closed, never be reclaimed');
  assert.strictEqual(Object.values(placesOf(fx))[0].session, 'unprovable-holder');
});

// ---------------------------------------------------------------------------------------
// Change 4 (#285): under `writes: direct`, a place-claim on the repo's OWN trunk checkout must
// carry an identity — the #242 floor raised for the one descriptor that declares the serialization
// contract. A blank-identity hold can never be re-acquired or released by its own owner, which
// under that contract wedges the checkout until a human intervenes.
//
// This is a TIGHTENING, and it is the only mode-conditional behaviour in #285. The matching
// loosening — letting an automated session take trunk-direct — is a ⚖ ruling, not an
// implementation, and is deliberately absent from this diff (see audit-writes-matrix.test.js,
// which still passes unedited, proving no constraint-matrix cell moved).
// ---------------------------------------------------------------------------------------

test('writes: direct — `place acquire` on the repo\'s own trunk checkout REFUSES a blank identity', async () => {
  const fx = fixture('direct');
  const [r] = await race('place acquire', fx, ['']);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.out + r.err, /writes: direct/);
  assert.ok(!fs.existsSync(path.join(fx.home, 'state.json'))
    || Object.keys(placesOf(fx)).length === 0, 'nothing may be written by a refused acquire');
});

test('writes: free — the same blank-identity acquire still SUCCEEDS with a warning (#235 floor unchanged)', async () => {
  const fx = fixture('free');
  const [r] = await race('place acquire', fx, ['']);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.err + r.out, /NO holder identity/);
  assert.strictEqual(Object.keys(placesOf(fx)).length, 1);
});

test('writes: direct — a NON-trunk path keeps the warn-only floor; the tightening is scoped to the declared checkout', async () => {
  const fx = fixture('direct');
  const other = path.join(fx.root, 'somewhere-else');
  fs.mkdirSync(other, { recursive: true });
  const child = spawn('node', [COLAB, 'place', 'acquire', other, '--repo', fx.work], {
    env: childEnv(fx), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((res) => child.on('close', res));
  assert.strictEqual(code, 0, `a hold on a path that is not the declared trunk checkout is unaffected: ${out}${err}`);
});
