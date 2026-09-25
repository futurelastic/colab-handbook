'use strict';
/**
 * Pure tests for tools/lib/claim-comments.js — the claim tie-break's input (`liveClaimComments`)
 * and verdict (`tieBreakVerdict`), after #369 (host tokens on public destinations) and #375 (which
 * release cancels which claim). The property every test here protects in the end is CONVERGENCE:
 * two racers reading the same comments reach the same verdict, so exactly one of them yields.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const cc = require('./claim-comments');
const claimIdentity = require('./claim-identity');
const machine = require('./machine');

const T = (n) => new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString();
const DAY = 86400;

function claim(login, host, at, { machineTok = '', session = '' } = {}) {
  let body = `🔒 Claimed — worktree \`w\` · branch \`-\` · host \`${host}\` · ${T(at)}`;
  if (machineTok) body += ` · machine \`${machineTok}\``;
  if (session) body += ` · session ${session}`;
  return { author: { login }, createdAt: T(at), body };
}
function release(login, at) { return { author: { login }, createdAt: T(at), body: '✅ Released' }; }
function yielded(login, at, winnerId) {
  return { author: { login }, createdAt: T(at), body: `✅ Released (yielded — earlier claim by ${winnerId} wins)` };
}

const MX = 'm:aaaaaaaaaaaa';
const MY = 'm:bbbbbbbbbbbb';

// --- #375: a release cancels a claim whoever posted it --------------------------------------------

test('#375 measured: a claim released under ANOTHER account no longer wins a race 24 days later', () => {
  const comments = [
    claim('alice', 'box-x', 0, { machineTok: MX }), // account A, machine X
    release('bob', 120),                             // account B releases, two minutes later
    claim('alice', 'box-y', 24 * DAY, { machineTok: MY }), // account A, machine Y, 24 days on
  ];
  const live = cc.liveClaimComments(comments);
  assert.deepStrictEqual(live.map((c) => c.host), ['box-y'], 'the released claim is not live');
  const v = cc.tieBreakVerdict(comments, 'alice', 'box-y', '', null, MY);
  assert.strictEqual(v.lost, false, 'machine Y keeps free work instead of yielding to a released claim');
});

test('#375: a plain release does NOT cancel a claim posted AFTER it', () => {
  const live = cc.liveClaimComments([release('bob', 0), claim('alice', 'box-x', 5)]);
  assert.strictEqual(live.length, 1);
});

test('#375: a yield cancels only its author\'s claims — never the winner it names', () => {
  // Two machines of ONE account race; Y loses and yields to X. The author-keyed rule used to cancel
  // X's winning claim too (same login), blanking the comment the cross-machine refusal reads.
  const comments = [
    claim('alice', 'box-x', 0, { machineTok: MX }),
    claim('alice', 'box-y', 1, { machineTok: MY }),
    yielded('alice', 2, 'alice@box-x'),
  ];
  assert.deepStrictEqual(cc.liveClaimComments(comments).map((c) => c.host), ['box-x']);
});

test('#375: a yield by one account leaves another account\'s claim alone', () => {
  const comments = [claim('carol', 'c', 0), claim('alice', 'a', 1), claim('bob', 'b', 2), yielded('bob', 3, 'carol@c')];
  assert.deepStrictEqual(cc.liveClaimComments(comments).map((c) => c.login), ['carol', 'alice']);
});

test('#375: a yield naming a winner by its h: token still keeps that winner\'s raw-host claim live', () => {
  const comments = [
    claim('alice', 'box-x', 0, { machineTok: MX }),
    claim('alice', 'box-y', 1, { machineTok: MY }),
    yielded('alice', 2, `alice@${machine.hostToken('box-x')}`),
  ];
  assert.deepStrictEqual(cc.liveClaimComments(comments).map((c) => c.host), ['box-x']);
});

test('#375: a fine-setting co-tenant yield cancels the yielder, not the named session', () => {
  const comments = [
    claim('alice', 'box', 0, { session: 'session_s1' }),
    claim('alice', 'box', 1, { session: 'session_s2' }),
    yielded('alice', 2, 'alice@box#session_s1'),
  ];
  assert.deepStrictEqual(cc.liveClaimComments(comments, claimIdentity.FINE_COMPONENTS).map((c) => c.session), ['session_s1']);
});

// --- convergence ---------------------------------------------------------------------------------

function verdicts(comments, racers, comps) {
  return racers.map((r) => cc.tieBreakVerdict(comments, r.login, r.host, r.session || '', comps, r.machine || null));
}

test('convergence: two racers on the same comments — exactly one yields, and both name the same winner', () => {
  const cases = [
    { name: 'different accounts', racers: [{ login: 'alice', host: 'a' }, { login: 'bob', host: 'b' }] },
    { name: 'one account, two machines', racers: [{ login: 'alice', host: 'box-x', machine: MX }, { login: 'alice', host: 'box-y', machine: MY }] },
  ];
  for (const { name, racers } of cases) {
    for (const [ta, tb] of [[10, 11], [11, 10], [10, 10]]) {
      const comments = [
        claim(racers[0].login, racers[0].host, ta, { machineTok: racers[0].machine || '' }),
        claim(racers[1].login, racers[1].host, tb, { machineTok: racers[1].machine || '' }),
      ];
      const [va, vb] = verdicts(comments, racers);
      assert.strictEqual([va.lost, vb.lost].filter(Boolean).length, 1, `${name} @ ${ta}/${tb}: exactly one yields`);
      const loser = va.lost ? va : vb;
      const winnerIdx = va.lost ? 1 : 0;
      assert.strictEqual(loser.winner.login, racers[winnerIdx].login, `${name} @ ${ta}/${tb}: the winner is the other racer`);
      assert.ok(machine.sameHostName(loser.winner.host, racers[winnerIdx].host), `${name} @ ${ta}/${tb}`);
    }
  }
});

test('convergence: a stale claim released by another account is ignored by BOTH racers alike', () => {
  const racers = [{ login: 'alice', host: 'box-y', machine: MY }, { login: 'bob', host: 'b' }];
  const comments = [
    claim('alice', 'box-x', 0, { machineTok: MX }),
    release('bob', 60),
    claim('alice', 'box-y', 1000, { machineTok: MY }),
    claim('bob', 'b', 1001),
  ];
  const [va, vb] = verdicts(comments, racers);
  assert.strictEqual(va.lost, false, 'alice (earliest live) keeps it');
  assert.strictEqual(vb.lost, true, 'bob yields');
  assert.strictEqual(vb.winner.host, 'box-y', 'to alice\'s LIVE claim, not the released one');
});

test('convergence: racers whose comments carry h: tokens (#369) converge exactly as raw-host ones do', () => {
  const racers = [{ login: 'alice', host: 'box-x' }, { login: 'alice', host: 'box-y' }]; // no machine id at all
  const comments = [
    claim('alice', machine.hostToken('box-x'), 10),
    claim('alice', machine.hostToken('box-y'), 11),
  ];
  const [va, vb] = verdicts(comments, racers);
  assert.strictEqual(va.lost, false);
  assert.strictEqual(vb.lost, true);
  assert.strictEqual(vb.winner.host, machine.hostToken('box-x'));
});

// --- #369: our own redacted comment is still ours ------------------------------------------------

test('#369: a claim carrying our h: token (no machine id) is recognised as OURS — never a yield to ourselves', () => {
  const tok = machine.hostToken('devbox.local');
  const comments = [claim('alice', tok, 5), claim('alice', tok, 6)]; // a re-claim posted a second comment
  const v = cc.tieBreakVerdict(comments, 'alice', 'Devbox', '', null, null);
  assert.strictEqual(v.lost, false);
});

test('#369: a legacy raw-host claim and our new token-host claim are one claimant', () => {
  const comments = [claim('alice', 'devbox', 5), claim('alice', machine.hostToken('devbox.lan'), 6)];
  assert.strictEqual(cc.tieBreakVerdict(comments, 'alice', 'devbox.local', '', null, null).lost, false);
});

test('#369: yieldReleaseBody redacts the winner\'s raw host, keeps a fine session tail, and still parses', () => {
  const winner = { login: 'alice', host: 'secret-box', session: 's1', identity: 'alice@secret-box#s1' };
  const body = cc.yieldReleaseBody(winner, { redact: true });
  assert.ok(!body.includes('secret-box'), body);
  assert.ok(body.includes(`alice@${machine.hostToken('secret-box')}#s1`), body);
  const parsed = cc.parseIdentity(body.match(cc.YIELD_RE)[1]);
  assert.ok(cc.isNamedWinner({ login: 'alice', host: 'secret-box', session: 's1' }, parsed));
  assert.strictEqual(cc.yieldReleaseBody(winner), '✅ Released (yielded — earlier claim by alice@secret-box#s1 wins)');
});

test('parseSessionField still decodes all three session shapes (moved from tools/colab)', () => {
  assert.deepStrictEqual(cc.parseSessionField('x · session [n](https://u)'), { sessionName: 'n', session: 'https://u' });
  assert.deepStrictEqual(cc.parseSessionField('x · session https://u/session_1'), { sessionName: '', session: 'https://u/session_1' });
  assert.deepStrictEqual(cc.parseSessionField('x · session my-name'), { sessionName: 'my-name', session: '' });
  assert.deepStrictEqual(cc.parseSessionField('x'), { sessionName: '', session: '' });
});
