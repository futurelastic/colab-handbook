'use strict';
/**
 * tools/lib/batch-stats.js (#554) — the derivation behind `colab batch-stats`, on hand-built
 * histories: none at all, a landed batch with a drop, a red build that fell back to serial, and a
 * serial landing that left a green partner behind, and (#580) a batch of one doing either. Plus ship-batch.js's drop trailer round-trip.
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const bs = require('./batch-stats');
const sb = require('./ship-batch');

const T0 = Date.parse('2026-10-01T00:00:00Z');
const min = (n) => T0 + n * 60_000;
const run = (branch, sha, o = {}) => ({
  id: o.id || Math.floor(Math.random() * 1e9), branch, sha, event: 'push',
  status: o.status || 'completed', conclusion: o.conclusion === undefined ? 'success' : o.conclusion,
  attempt: o.attempt || 1, createdMs: o.created, updatedMs: o.updated, message: o.message || null,
});
const sha = (c) => c.repeat(40);

test('drop trailer: round-trips, unknown class reads as other, appended into the same trailer block', () => {
  const line = sb.droppedTrailer({ ref: 'ship-batch/abc1234', branch: 'fix/c-13', sha: sha('d'), cls: 'conflict' });
  assert.strictEqual(line, `Ship-Batch-Dropped: ship-batch/abc1234 fix/c-13@${'d'.repeat(12)} conflict`);
  assert.deepStrictEqual(sb.parseDroppedTrailers([`x\n\n${line}`]), [{ ref: 'ship-batch/abc1234', branch: 'fix/c-13', sha: 'd'.repeat(12), cls: 'conflict' }]);
  assert.match(sb.droppedTrailer({ ref: 'r', branch: 'b', sha: sha('e'), cls: 'nope' }), / other$/);
  // a Ship-Batch-Dropped line is never read as a member
  assert.deepStrictEqual(sb.parseMemberTrailers([line]), []);
  const msg = 'fix: b\n\nbody\n\nCloses #12\nShip-Batch: ship-batch/abc1234 fix/b-12@' + sha('b') + '\n';
  const out = sb.appendTrailers(msg, [line]);
  assert.ok(out.endsWith(`@${sha('b')}\n${line}\n`), out);
  assert.strictEqual(sb.appendTrailers(out, [line]), out, 'idempotent');
});

test('closesIssues reads GitHub\'s closing keywords only', () => {
  assert.deepStrictEqual(bs.closesIssues('feat: x\n\nCloses #12\nFixes #3, refs #9\nresolved #4'), [12, 3, 4]);
});

test('no history: no commits, no runs → an empty report, not an error', () => {
  const r = bs.derive({ commits: [], runs: [], trunk: 'main' });
  assert.strictEqual(r.history, false);
  assert.strictEqual(r.landings.total, 0);
  assert.strictEqual(r.batches.firstAttemptGreenRate, null);
  assert.strictEqual(r.dropped.rate, null);
  assert.strictEqual(r.queueWait.samples, 0);
});

test('a landed batch of two with one drop: fill, first-attempt green, eviction, queue wait', () => {
  const ref = 'ship-batch/aaaaaaa';
  const drop = sb.droppedTrailer({ ref, branch: 'fix/c-13', sha: sha('c'), cls: 'conflict' });
  const commits = [
    { sha: sha('1'), dateMs: min(10), body: `fix: a\n\nCloses #11\n${sb.memberTrailer({ ref, branch: 'fix/a-11', sha: sha('a') })}\n` },
    { sha: sha('2'), dateMs: min(10), body: `fix: b\n\nCloses #12\n${sb.memberTrailer({ ref, branch: 'fix/b-12', sha: sha('b') })}\n${drop}\n` },
  ];
  const runs = [
    run('fix/a-11', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/b-12', sha('b'), { created: min(2), updated: min(8) }),
    run(ref, sha('2'), { created: min(10), updated: min(20) }),
    run('main', sha('2'), { created: min(21), updated: min(30) }),
  ];
  const r = bs.derive({ commits, runs, trunk: 'main', config: { n: 3 } });
  assert.strictEqual(r.history, true);
  assert.deepStrictEqual(r.landings, { total: 1, batch: 1, serial: 0 });
  assert.deepStrictEqual(r.batches.fill, { 2: 1 });
  assert.strictEqual(r.batches.builds, 1);
  assert.strictEqual(r.batches.firstAttemptGreen, 1);
  assert.strictEqual(r.batches.firstAttemptGreenRate, 1);
  assert.strictEqual(r.dropped.count, 1);
  assert.strictEqual(r.dropped.attempted, 3);
  assert.deepStrictEqual(r.dropped.byClass, { conflict: 1 });
  assert.strictEqual(r.dropped.members[0].landed, true);
  // landed at the trunk run's creation (min 21): a waited 16 min, b 13 min
  assert.deepStrictEqual([r.queueWait.samples, r.queueWait.p50Sec, r.queueWait.maxSec], [2, 13 * 60, 16 * 60]);
});

test('a red build that never landed: counted red, its members read from the build, serial fallback found', () => {
  const ref = 'ship-batch/bbbbbbb';
  const buildMsgs = [
    `fix: a\n\nCloses #21\n${sb.memberTrailer({ ref, branch: 'fix/a-21', sha: sha('a') })}\n`,
    `fix: b\n\nCloses #22\n${sb.memberTrailer({ ref, branch: 'fix/b-22', sha: sha('b') })}\n${sb.droppedTrailer({ ref, branch: 'fix/c-23', sha: sha('c'), cls: 'empty' })}\n`,
  ];
  const commits = [
    { sha: sha('3'), dateMs: min(40), body: 'fix: a\n\nCloses #21\n' }, // serial re-landing of one member
  ];
  const runs = [
    run('fix/a-21', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/b-22', sha('b'), { created: min(0), updated: min(5) }),
    run(ref, sha('9'), { created: min(10), updated: min(20), conclusion: 'failure', attempt: 2 }),
    run('fix/a-21', sha('e'), { created: min(30), updated: min(35) }),
    run('main', sha('3'), { created: min(41), updated: min(50) }),
  ];
  const r = bs.derive({ commits, runs, builds: { [sha('9')]: buildMsgs }, trunk: 'main' });
  assert.strictEqual(r.batches.red, 1);
  assert.strictEqual(r.batches.landed, 0);
  assert.strictEqual(r.batches.firstAttemptGreenRate, 0);
  assert.deepStrictEqual(r.red, { builds: 1, members: 2, relandedSerially: 1, relandedAlone: 1 });
  assert.strictEqual(r.dropped.count, 1);
  assert.strictEqual(r.dropped.members[0].landed, false);
  assert.strictEqual(r.dropped.attempted, 3);
});

test('a red build whose commits are unreadable falls back to the head message, and says so when empty', () => {
  const ref = 'ship-batch/ccccccc';
  const runs = [run(ref, sha('8'), { created: min(1), updated: min(2), conclusion: 'failure' })];
  const r = bs.derive({ commits: [], runs, trunk: 'main' });
  assert.strictEqual(r.red.builds, 1);
  assert.match(r.notes.join('\n'), /could not be read/);
});

test('missed partner: a serial landing while another branch was already green at its head', () => {
  const commits = [
    { sha: sha('4'), dateMs: min(10), body: 'fix: x\n\nCloses #31\n' },
    { sha: sha('5'), dateMs: min(40), body: 'fix: y\n\nCloses #32\n' },
  ];
  const runs = [
    run('fix/x-31', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/y-32', sha('b'), { created: min(1), updated: min(6) }), // green before x landed
    run('main', sha('4'), { created: min(10), updated: min(20) }),
    run('fix/y-32', sha('c'), { created: min(11), updated: min(19) }), // the post-sync re-run
    run('main', sha('5'), { created: min(40), updated: min(50) }),
  ];
  const r = bs.derive({ commits, runs, trunk: 'main' });
  assert.strictEqual(r.serial.landings, 2);
  assert.strictEqual(r.serial.withMissedPartner, 1);
  assert.deepStrictEqual(r.serial.pairs, [{ kind: 'missed', landed: 'fix/x-31', partner: 'fix/y-32' }]);
});

test('near miss: the partner turns green inside the trunk-CI cycle — the wait it needed, from the lone one\'s own green', () => {
  const commits = [
    { sha: sha('4'), dateMs: min(10), body: 'fix: x\n\nCloses #41\n' },
    { sha: sha('5'), dateMs: min(60), body: 'fix: y\n\nCloses #42\n' },
  ];
  const runs = [
    run('fix/x-41', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/y-42', sha('b'), { created: min(9), updated: min(15) }), // still running at min 10
    run('main', sha('4'), { created: min(10), updated: min(25) }),
    run('main', sha('5'), { created: min(60), updated: min(70) }),
  ];
  const r = bs.derive({ commits, runs, trunk: 'main' });
  assert.strictEqual(r.serial.withMissedPartner, 0);
  assert.strictEqual(r.serial.withNearMiss, 1);
  assert.deepStrictEqual(r.serial.pairs, [{ kind: 'near', landed: 'fix/x-41', partner: 'fix/y-42', waitSec: 10 * 60 }]);
  assert.strictEqual(r.serial.nearMissWait.p50Sec, 600);
});

test('#556: overlap counts — cyclesRead is serial landings with a finished trunk run, overlapped those with a partner', () => {
  const commits = [
    { sha: sha('4'), dateMs: min(10), body: 'fix: x\n\nCloses #41\n' },
    { sha: sha('5'), dateMs: min(60), body: 'fix: y\n\nCloses #42\n' },
  ];
  const runs = [
    run('fix/x-41', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/y-42', sha('b'), { created: min(9), updated: min(15) }),
    run('main', sha('4'), { created: min(10), updated: min(25) }),
    run('main', sha('5'), { created: min(60), updated: min(70) }),
  ];
  const r = bs.derive({ commits, runs, trunk: 'main' });
  assert.strictEqual(r.serial.cyclesRead, 2);
  assert.strictEqual(r.serial.overlapped, 1);
  // no trunk runs at all: nothing could be judged, so the denominator is 0 — never a 0% overlap
  const bare = bs.derive({ commits, runs: [], trunk: 'main' });
  assert.deepStrictEqual([bare.serial.cyclesRead, bare.serial.overlapped], [0, 0]);
});

test('a next landing ends the cycle: a partner green only after it is no near miss of the earlier one', () => {
  const commits = [
    { sha: sha('4'), dateMs: min(10), body: 'Closes #51\n' },
    { sha: sha('6'), dateMs: min(12), body: 'Closes #53\n' },
    { sha: sha('5'), dateMs: min(60), body: 'Closes #52\n' },
  ];
  const runs = [
    run('fix/x-51', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/z-53', sha('d'), { created: min(0), updated: min(11) }),
    run('fix/y-52', sha('b'), { created: min(9), updated: min(15) }),
    run('main', sha('4'), { created: min(10), updated: min(300) }), // re-run hours later
    run('main', sha('6'), { created: min(12), updated: min(13) }),
    run('main', sha('5'), { created: min(60), updated: min(70) }),
  ];
  const r = bs.derive({ commits, runs, trunk: 'main' });
  const ofX = r.serial.pairs.filter((p) => p.landed === 'fix/x-51');
  assert.deepStrictEqual(ofX, [{ kind: 'near', landed: 'fix/x-51', partner: 'fix/z-53', waitSec: 6 * 60 }]);
});

// ---- #580: a batch of one is a lone landing too ----

test('#580: a batch of one landing while a partner was already green reports a missed partner under alone, not serial', () => {
  const ref = 'ship-batch/ddddddd';
  const commits = [
    { sha: sha('4'), dateMs: min(10), body: `fix: x\n\nCloses #61\n${sb.memberTrailer({ ref, branch: 'fix/x-61', sha: sha('a') })}\n` },
    { sha: sha('5'), dateMs: min(40), body: 'fix: y\n\nCloses #62\n' },
  ];
  const runs = [
    run('fix/x-61', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/y-62', sha('b'), { created: min(1), updated: min(6) }), // green before x's batch landed
    run(ref, sha('4'), { created: min(7), updated: min(9) }),
    run('main', sha('4'), { created: min(10), updated: min(20) }),
    run('main', sha('5'), { created: min(40), updated: min(50) }),
  ];
  const r = bs.derive({ commits, runs, trunk: 'main', config: { n: 3 } });
  assert.deepStrictEqual(r.batches.fill, { 1: 1 });
  // the serial path saw only y, which had no later partner — its meaning is unchanged
  assert.deepStrictEqual([r.serial.landings, r.serial.withMissedPartner], [1, 0]);
  assert.strictEqual(r.alone.landings, 2);
  assert.strictEqual(r.alone.batchOfOne, 1);
  assert.strictEqual(r.alone.withMissedPartner, 1);
  assert.deepStrictEqual(r.alone.pairs, [{ kind: 'missed', landed: 'fix/x-61', partner: 'fix/y-62', via: 'batch-of-one' }]);
  assert.deepStrictEqual([r.alone.cyclesRead, r.alone.overlapped], [2, 1]);
});

test('#580: a batch of two is not a lone landing — its members are never scanned for partners', () => {
  const ref = 'ship-batch/eeeeeee';
  const commits = [
    { sha: sha('1'), dateMs: min(10), body: `Closes #71\n${sb.memberTrailer({ ref, branch: 'fix/a-71', sha: sha('a') })}\n` },
    { sha: sha('2'), dateMs: min(10), body: `Closes #72\n${sb.memberTrailer({ ref, branch: 'fix/b-72', sha: sha('b') })}\n` },
    { sha: sha('5'), dateMs: min(40), body: 'Closes #73\n' },
  ];
  const runs = [
    run('fix/a-71', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/b-72', sha('b'), { created: min(0), updated: min(5) }),
    run('fix/c-73', sha('c'), { created: min(1), updated: min(6) }), // green, left out of the pair
    run('main', sha('2'), { created: min(11), updated: min(20) }),
    run('main', sha('5'), { created: min(40), updated: min(50) }),
  ];
  const r = bs.derive({ commits, runs, trunk: 'main', config: { n: 3 } });
  assert.deepStrictEqual([r.alone.landings, r.alone.batchOfOne, r.alone.withMissedPartner], [1, 0, 0]);
});

test('#580: a red build\'s member that re-lands as a batch of one counts as relanded alone, not serially', () => {
  const ref = 'ship-batch/fffffff';
  const ref2 = 'ship-batch/0000000';
  const buildMsgs = [
    `fix: a\n\nCloses #81\n${sb.memberTrailer({ ref, branch: 'fix/a-81', sha: sha('a') })}\n`,
    `fix: b\n\nCloses #82\n${sb.memberTrailer({ ref, branch: 'fix/b-82', sha: sha('b') })}\n`,
  ];
  const commits = [
    { sha: sha('3'), dateMs: min(40), body: `fix: a\n\nCloses #81\n${sb.memberTrailer({ ref: ref2, branch: 'fix/a-81', sha: sha('e') })}\n` },
  ];
  const runs = [
    run('fix/a-81', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/b-82', sha('b'), { created: min(0), updated: min(5) }),
    run(ref, sha('9'), { created: min(10), updated: min(20), conclusion: 'failure', attempt: 2 }),
    run('fix/a-81', sha('e'), { created: min(30), updated: min(35) }),
    run(ref2, sha('3'), { created: min(36), updated: min(39) }),
    run('main', sha('3'), { created: min(41), updated: min(50) }),
  ];
  const r = bs.derive({ commits, runs, builds: { [sha('9')]: buildMsgs }, trunk: 'main' });
  assert.deepStrictEqual(r.red, { builds: 1, members: 2, relandedSerially: 0, relandedAlone: 1 });
});

test('#580: on a history with no batches, alone equals serial', () => {
  const commits = [
    { sha: sha('4'), dateMs: min(10), body: 'fix: x\n\nCloses #31\n' },
    { sha: sha('5'), dateMs: min(40), body: 'fix: y\n\nCloses #32\n' },
  ];
  const runs = [
    run('fix/x-31', sha('a'), { created: min(0), updated: min(5) }),
    run('fix/y-32', sha('b'), { created: min(1), updated: min(6) }),
    run('main', sha('4'), { created: min(10), updated: min(20) }),
    run('main', sha('5'), { created: min(40), updated: min(50) }),
  ];
  const r = bs.derive({ commits, runs, trunk: 'main' });
  const strip = (x) => ({ ...x, pairs: x.pairs.map(({ via, ...p }) => p) });
  const { batchOfOne, ...alone } = r.alone;
  assert.strictEqual(batchOfOne, 0);
  assert.deepStrictEqual(strip(alone), r.serial);
});
