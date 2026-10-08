'use strict';
/**
 * tools/lib/codec (#497) — the golden round-trip over samples.json, plus the two promises the move
 * made: the old modules' exports are unchanged, and the codec ships in the package.
 *
 * Run: `node --test tools/lib/codec/*.test.js` (CI's unit-test glob includes this directory).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const codec = require('./index');
const samples = require('./samples.json');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test('every label sample decodes to its spec and re-encodes byte-identically', () => {
  assert.ok(samples.labels.length > 0);
  for (const s of samples.labels) {
    assert.deepStrictEqual(codec.decodeLabel(s.wire), s.decoded, s.wire);
    assert.strictEqual(codec.encodeLabel(codec.decodeLabel(s.wire)), s.wire, s.wire);
    assert.strictEqual(codec.encodeLabel(s.decoded), s.wire, s.wire);
  }
});

test('every claim sample decodes to its spec and re-encodes byte-identically', () => {
  assert.ok(samples.claims.length > 0);
  for (const s of samples.claims) {
    assert.deepStrictEqual(codec.decodeClaim(s.wire), s.decoded, s.wire);
    assert.strictEqual(codec.encodeClaim(codec.decodeClaim(s.wire)), s.wire, s.wire);
  }
});

test('every release sample decodes to its spec and re-encodes byte-identically', () => {
  assert.ok(samples.releases.length > 0);
  for (const s of samples.releases) {
    assert.deepStrictEqual(codec.decodeRelease(s.wire), s.decoded, s.wire);
    assert.strictEqual(codec.encodeRelease(codec.decodeRelease(s.wire)), s.wire, s.wire);
  }
});

test('the samples cover every claim/release shape the readers distinguish', () => {
  const claims = samples.claims.map((s) => s.decoded);
  assert.ok(claims.some((c) => c.session && c.sessionName), '[name](url) session');
  assert.ok(claims.some((c) => c.session && !c.sessionName), 'bare url session (legacy)');
  assert.ok(claims.some((c) => !c.session && c.sessionName), 'bare name session');
  assert.ok(claims.some((c) => !c.session && !c.sessionName), 'no session');
  assert.ok(claims.some((c) => c.machine) && claims.some((c) => !c.machine), 'machine and legacy no-machine');
  assert.ok(claims.some((c) => c.branch === '-'), 'no-branch `-`');
  const kinds = new Set(samples.releases.map((s) => s.decoded.kind));
  assert.deepStrictEqual([...kinds].sort(), ['release', 'yield']);
  assert.ok(samples.releases.some((s) => s.decoded.kind === 'release' && s.decoded.rest), 'a release with prose');
});

test('the samples are scrubbed: hosts as h: tokens, no raw session ids', () => {
  for (const s of [...samples.claims, ...samples.releases]) {
    for (const m of s.wire.matchAll(/host `([^`]*)`/g)) assert.match(m[1], /^h:[0-9a-f]{12}$/, s.wire);
    for (const m of s.wire.matchAll(/session_([A-Za-z0-9-]+)/g)) assert.match(m[1], /EXAMPLE/, s.wire);
  }
  for (const s of samples.releases.filter((r) => r.decoded.kind === 'yield')) {
    assert.match(codec.parseIdentity(s.decoded.winner).host, /^h:[0-9a-f]{12}$/, s.wire);
  }
});

test('decodeLabel/encodeLabel are lossless on any string, not only the samples', () => {
  for (const w of ['', 'x', 'delivery:', 'deferred:', 'review-by:', 'review-by:2026-1-1', 'group:a:b',
    'delivery:code ', ' in-progress', 'tracking', 'In-Progress', 'deferred:date:extra']) {
    assert.strictEqual(codec.encodeLabel(codec.decodeLabel(w)), w, JSON.stringify(w));
  }
  assert.deepStrictEqual(codec.decodeLabel({ name: 'delivery:ops' }), { kind: 'delivery', value: 'ops', known: true });
  assert.throws(() => codec.encodeLabel({ kind: 'nope', value: 'x' }), TypeError);
});

test('decodeLabel agrees with the predicates it sits beside', () => {
  for (const s of samples.labels) {
    const d = s.decoded;
    assert.strictEqual(codec.isGroupLabel(s.wire), d.kind === 'group', s.wire);
    assert.strictEqual(codec.parseReviewByDate(s.wire) !== null, d.kind === 'review-by', s.wire);
    if (d.kind === 'delivery' && d.known) assert.strictEqual(codec.deliveryType([s.wire]), d.value);
    if (d.kind === 'deferred' && d.known) assert.strictEqual(codec.deferredKind([s.wire]), d.value);
  }
});

test('encodeClaim writes the fields a claim with no worktree/branch/machine/session has always carried', () => {
  assert.strictEqual(
    codec.encodeClaim({ host: 'h:000000000000', at: '2026-01-01T00:00:00.000Z' }),
    '🔒 Claimed — worktree `-` · branch `-` · host `h:000000000000` · 2026-01-01T00:00:00.000Z',
  );
  assert.strictEqual(codec.encodeRelease(), '✅ Released');
  assert.strictEqual(codec.decodeClaim('no claim here'), null);
  assert.strictEqual(codec.decodeRelease('🔒 Claimed'), null);
});

test('the old modules keep every export, by name and by value', () => {
  const labels = require('../labels');
  assert.deepStrictEqual(Object.keys(labels), [
    'CONVENTION_LABELS', 'conventionLabelNames', 'missingConventionLabels', 'staleConventionDescriptions',
    'MINIMAL_LABEL_NAMES', 'minimalConventionLabels',
    'READINESS_LABEL', 'readinessLabelArgs', 'readinessMissingLabelHint', 'readinessMarkedMessage',
    'TRACKING_LABEL',
    'MECHANICAL_READINESS_LABEL', 'mechanicalReadinessLabelArgs',
    'MIGRATION_GRANT_LABEL', 'migrationGrantLabelArgs', 'migrationGrantMissingLabelHint',
    'CI_GRANT_LABEL', 'ciGrantLabelArgs', 'ciGrantMissingLabelHint',
    'NEEDS_DECISION_LABEL', 'DECISION_RECORDED_LABEL', 'decisionRecordedMissingLabelHint',
    'GROUP_LABEL_PREFIX', 'isGroupLabel', 'groupLabelNames',
    'DELIVERY_LABEL_PREFIX', 'DELIVERY_TYPES', 'CODE_LANE_DELIVERY_TYPES', 'NON_CODE_DELIVERY_TYPES',
    'deliveryType', 'isRouteNotStart',
    'DEFERRED_LABEL_PREFIX', 'DEFERRED_KINDS', 'deferredKind', 'isDeferred',
    'REVIEW_BY_LABEL_PREFIX', 'isReviewByLabel', 'reviewByLabelNames', 'parseReviewByDate',
  ]);
  for (const k of Object.keys(labels)) assert.strictEqual(labels[k], codec.labels[k], k);

  const cc = require('../claim-comments');
  assert.deepStrictEqual(Object.keys(cc), [
    'CLAIM_MARK', 'RELEASE_MARK', 'RACE_WINDOW_MS', 'CLAIM_RE', 'SESSION_RE', 'MACHINE_RE', 'YIELD_RE',
    'parseSessionField', 'parseIdentity', 'isNamedWinner', 'liveClaimComments', 'tieBreakVerdict', 'yieldReleaseBody',
  ]);
  for (const k of ['CLAIM_MARK', 'RELEASE_MARK', 'CLAIM_RE', 'SESSION_RE', 'MACHINE_RE', 'YIELD_RE', 'parseSessionField', 'parseIdentity']) {
    assert.strictEqual(cc[k], codec.claim[k], k);
  }
  assert.strictEqual(require('../claim-identity').looksLikeSessionId, codec.looksLikeSessionId);
});

test('the yield the tie-break writes is the codec\'s yield, and a sample yield cancels like one', () => {
  const cc = require('../claim-comments');
  const winner = { login: 'user-a', host: 'h:48773651d08a', identity: 'user-a@h:48773651d08a' };
  const body = cc.yieldReleaseBody(winner);
  assert.deepStrictEqual(codec.decodeRelease(body), { kind: 'yield', winner: 'user-a@h:48773651d08a', rest: '' });
  // A sample claim, then a plain release after it → no live claim (the reader is built on the codec).
  const claim = samples.claims[0].wire;
  const live = cc.liveClaimComments([
    { body: claim, createdAt: '2026-01-01T00:00:00Z', author: { login: 'user-a' } },
    { body: codec.encodeRelease(), createdAt: '2026-01-01T00:00:01Z', author: { login: 'user-b' } },
  ]);
  assert.deepStrictEqual(live, []);
  const still = cc.liveClaimComments([{ body: claim, createdAt: '2026-01-01T00:00:00Z', author: { login: 'user-a' } }]);
  assert.strictEqual(still.length, 1);
  assert.strictEqual(still[0].machine, samples.claims[0].decoded.machine);
  assert.strictEqual(still[0].sessionName, samples.claims[0].decoded.sessionName);
});

test('the .d.ts files declare every runtime export of the codec', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  for (const [half, file] of [['labels', 'labels.d.ts'], ['claim', 'claim.d.ts']]) {
    const dts = read(file);
    for (const k of Object.keys(codec[half])) {
      assert.match(dts, new RegExp(`export (const|function) ${k}\\b`), `${file} is missing ${k}`);
    }
  }
  const index = read('index.d.ts');
  for (const line of ["export * from './labels';", "export * from './claim';", 'export { labels, claim };']) {
    assert.ok(index.includes(line), `index.d.ts is missing ${line}`);
  }
});

test('the package ships the codec: files list and pack allowlist both cover it', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const entry of ['tools/lib/codec/*.js', 'tools/lib/codec/*.d.ts', 'tools/lib/codec/samples.json']) {
    assert.ok(pkg.files.includes(entry), `package.json files is missing ${entry}`);
  }
  assert.ok(pkg.files.includes('!tools/lib/codec/*.test.js'), 'codec tests must stay out of the tarball');
  const { ALLOWED, findStrays } = await import(path.join(ROOT, 'scripts', 'check-pack-allowlist.mjs'));
  const shipped = fs.readdirSync(__dirname).filter((f) => !f.endsWith('.test.js')).map((f) => `tools/lib/codec/${f}`);
  for (const p of shipped) assert.ok(ALLOWED.some((re) => re.test(p)), `allowlist rejects ${p}`);
  assert.deepStrictEqual(findStrays(['tools/lib/codec/codec.test.js'], new Set(['tools/lib/codec/codec.test.js'])),
    [{ path: 'tools/lib/codec/codec.test.js', why: 'test file' }]);
});

// ── #498: grant, decision, hold and release markers ──────────────────────────────────────────

/** Every sample group → its encode/decode pair. One table, so a new group cannot skip the round trip. */
const PAIRS = [
  ['grants.migration', codec.encodeMigrationGrant, codec.decodeMigrationGrant],
  ['grants.migrationRevokes', codec.encodeMigrationRevoke, codec.decodeMigrationRevoke],
  ['grants.review', codec.encodeReviewGrant, codec.decodeReviewGrant],
  ['grants.ci', codec.encodeCiGrant, codec.decodeCiGrant],
  ['grants.ciRevokes', codec.encodeCiRevoke, codec.decodeCiRevoke],
  ['grants.ciReview', codec.encodeCiReviewGrant, codec.decodeCiReviewGrant],
  ['decisions.records', codec.encodeDecision, codec.decodeDecision],
  ['decisions.reopens', codec.encodeReopen, codec.decodeReopen],
  ['holds', codec.encodeHold, codec.decodeHold],
  ['releaseMarkers.tracking', codec.encodeTrackingMarker, codec.decodeTrackingMarker],
  ['releaseMarkers.events', codec.encodeReleaseEvent, codec.decodeReleaseEvent],
  ['releaseMarkers.released', codec.encodeReleasedComment, codec.decodeReleasedComment],
  ['parents', codec.encodeParent, codec.decodeParent],
  ['closeReasons', codec.encodeCloseReason, codec.decodeCloseReason],
];
const group = (dotted) => dotted.split('.').reduce((o, k) => o[k], samples);

test('every grant/decision/hold/release/marker sample decodes to its spec and re-encodes byte-identically', () => {
  for (const [name, encode, decode] of PAIRS) {
    const list = group(name);
    assert.ok(Array.isArray(list) && list.length > 0, `samples.${name} is empty`);
    for (const s of list) {
      assert.deepStrictEqual(decode(s.wire), s.decoded, `${name}: ${s.wire}`);
      assert.strictEqual(encode(decode(s.wire)), s.wire, `${name}: ${s.wire}`);
      assert.strictEqual(encode(s.decoded), s.wire, `${name}: ${s.wire}`);
    }
  }
});

test('no marker decoder accepts another marker\'s sample — the distinct leading glyphs hold', () => {
  const comments = PAIRS.filter(([n]) => /^(grants|decisions)\./.test(n));
  for (const [name] of comments) {
    for (const s of group(name)) {
      for (const [other, , decode] of comments) {
        if (other === name) continue;
        assert.strictEqual(decode(s.wire), null, `${other} decoded a ${name} sample`);
      }
    }
  }
});

test('the old modules keep their wire exports, and they ARE the codec\'s', () => {
  const mg = require('../migration-grant');
  for (const [old, now] of [['GRANT_MARK', 'MIGRATION_GRANT_MARK'], ['REVOKE_MARK', 'MIGRATION_REVOKE_MARK'],
    ['GRANT_RE', 'MIGRATION_GRANT_RE'], ['REVOKE_RE', 'MIGRATION_REVOKE_RE'], ['REVIEW_GRANT_MARK', 'REVIEW_GRANT_MARK'],
    ['REVIEW_GRANT_RE', 'REVIEW_GRANT_RE'], ['REVIEWER_ROLE', 'REVIEWER_ROLE'], ['REVIEW_RECORD_FENCE', 'REVIEW_RECORD_FENCE'],
    ['REVIEW_RECORD_FIELDS', 'REVIEW_RECORD_FIELDS']]) assert.strictEqual(mg[old], codec.grants[now], old);
  const ci = require('../ci-grant');
  for (const [old, now] of [['GRANT_MARK', 'CI_GRANT_MARK'], ['REVOKE_MARK', 'CI_REVOKE_MARK'],
    ['GRANT_RE', 'CI_GRANT_RE'], ['REVOKE_RE', 'CI_REVOKE_RE']]) assert.strictEqual(ci[old], codec.grants[now], old);
  const dr = require('../decision-record');
  for (const k of ['DECISION_MARK', 'REOPEN_MARK', 'DECISION_RE', 'REOPEN_RE', 'OPTIONS_RE', 'MOCKUP_RE', 'mockupUrls']) {
    assert.strictEqual(dr[k], codec.decision[k], k);
  }
  const wake = require('../wake');
  assert.deepStrictEqual(Object.keys(wake),
    ['WAKE_KINDS', 'CHECKABLE_KINDS', 'parseWake', 'parseWakeLine', 'evaluateWake', 'evaluateWakeLine', 'parseQualifiedIssueRef']);
  for (const k of ['WAKE_KINDS', 'CHECKABLE_KINDS', 'parseWake', 'parseWakeLine', 'parseQualifiedIssueRef']) {
    assert.strictEqual(wake[k], codec.hold[k], k);
  }
  const rf = require('../release-finalize');
  assert.strictEqual(rf.parseReleaseMarker, codec.decodeTrackingMarker);
  assert.strictEqual(rf.releaseMarker, codec.encodeTrackingMarker);
  assert.strictEqual(rf.eventMarker, codec.encodeReleaseEvent);
});

test('the old positional writers emit exactly the codec\'s samples', () => {
  const at = (s) => s.decoded.at;
  const mg = require('../migration-grant');
  const g = samples.grants.migration[0];
  assert.strictEqual(mg.grantCommentBody(g.decoded.branch, g.decoded.host, at(g)), g.wire);
  const r = samples.grants.migrationRevokes[0];
  assert.strictEqual(mg.revokeCommentBody(r.decoded.branch, r.decoded.host, at(r)), r.wire);
  for (const s of samples.grants.review) {
    const d = s.decoded;
    assert.strictEqual(mg.reviewGrantCommentBody(d.branch, d.host, d.at, d.record), s.wire);
    const parsed = mg.parseReviewGrant(s.wire);
    assert.deepStrictEqual(parsed.problems, [], s.wire); // the samples are VALID records, not just well-formed
  }
  const ci = require('../ci-grant');
  for (const s of samples.grants.ci) {
    const d = s.decoded;
    assert.strictEqual(ci.grantCommentBody(d.branch, d.trunk, d.redSha, d.evidenceSha, d.host, d.at), s.wire);
  }
  const dr = require('../decision-record');
  for (const s of samples.decisions.records) {
    const d = s.decoded;
    assert.strictEqual(dr.decisionCommentBody(d.ruledBy, d.answers, d.host, d.at, d.body), s.wire);
    assert.strictEqual(dr.liveDecisions([{ body: s.wire, createdAt: d.at }])[0].ruledBy, d.ruledBy);
  }
  for (const s of samples.decisions.reopens) {
    const d = s.decoded;
    assert.strictEqual(dr.reopenCommentBody(d.ruledBy, d.host, d.at, d.body), s.wire);
  }
  const rf = require('../release-finalize');
  const rel = samples.releaseMarkers.released[0];
  assert.strictEqual(rf.releasedComment(rel.decoded.version, rel.decoded.sha), rel.wire);
  assert.strictEqual(rf.hasEvent([{ body: rel.wire }], rf.releasedEvent(rel.decoded.version)), true);
});

test('a tail is kept literally: an edited grant re-encodes as written, not as the canonical sentence', () => {
  const edited = samples.grants.migration.find((s) => s.decoded.tail !== null);
  assert.ok(edited, 'samples carry a non-canonical tail');
  assert.notStrictEqual(codec.encodeMigrationGrant({ ...edited.decoded, tail: null }), edited.wire);
});

test('hold samples: every wake parses in the closed vocabulary, and looser real shapes decode to null', () => {
  for (const s of samples.holds) assert.ok(codec.parseWakeLine(s.decoded.wake).ok, s.wire);
  assert.ok(samples.holds.some((s) => s.decoded.because === null), 'a hold with no Because line');
  assert.ok(samples.holds.some((s) => codec.parseWakeLine(s.decoded.wake).conditions.length > 1), 'an ANDed wake');
  assert.ok(samples.notHolds.length > 0);
  for (const s of samples.notHolds) assert.strictEqual(codec.decodeHold(s.wire), null, s.wire);
  // A trailing line after Because: is not a hold record either — never a partial read.
  assert.strictEqual(codec.decodeHold(`${samples.holds[0].wire}\nmore`), null);
  assert.strictEqual(codec.encodeHold({ label: 'x', owner: 'o', wake: ['ruling', '#3'] }), 'Hold: x — owner: o — wake: ruling, #3');
});

test('#569: a declared shape: is read, an older reader still parses the line, and absence infers from the wake', () => {
  const declared = samples.holds.filter((s) => 'shape' in s.decoded);
  assert.deepStrictEqual([...new Set(declared.map((s) => s.decoded.shape))].sort(), ['ask', 'task', 'wait'],
    'one sample per shape');
  // The pre-#569 pattern, verbatim: a reader that does not know the field must still parse every
  // line, with its wake intact — only its owner text absorbs the unknown field.
  const OLD_HOLD_RE = /^Hold: (\S+) — owner: (.+?) — wake: (.+)$/;
  for (const s of declared) {
    const m = OLD_HOLD_RE.exec(s.wire.split('\n')[0]);
    assert.ok(m, `older reader parses: ${s.wire}`);
    assert.strictEqual(m[3], s.decoded.wake, 'older reader reads the wake whole');
    assert.ok(codec.parseWakeLine(m[3]).ok);
    assert.deepStrictEqual(codec.holdShape(s.decoded), { shape: s.decoded.shape, declared: true, invalid: null });
  }
  // The point of the field: a chore whose wake is `ruling` is a task, not a choice.
  const chore = declared.find((s) => s.decoded.shape === 'task');
  assert.strictEqual(chore.decoded.wake, 'ruling');
  assert.strictEqual(codec.holdShape({ ...chore.decoded, shape: undefined }).shape, 'ask');
  // Absent → inferred exactly as before the field existed.
  for (const s of samples.holds.filter((x) => !('shape' in x.decoded))) {
    const want = codec.parseWakeLine(s.decoded.wake).conditions.some((c) => c.kind === 'ruling') ? 'ask' : 'wait';
    assert.deepStrictEqual(codec.holdShape(s.decoded), { shape: want, declared: false, invalid: null }, s.wire);
  }
  // An unknown value is named, never trusted: it falls back to the inference.
  const typo = codec.decodeHold('Hold: x — owner: o — shape: chore — wake: ruling');
  assert.strictEqual(typo.shape, 'chore');
  assert.deepStrictEqual(codec.holdShape(typo), { shape: 'ask', declared: false, invalid: 'chore' });
  assert.strictEqual(codec.encodeHold({ label: 'x', owner: 'o', shape: 'wait', wake: '#3' }), 'Hold: x — owner: o — shape: wait — wake: #3');
  // `shape:` after the wake is NOT the field — it is part of the wake, which then names no wake.
  const late = codec.decodeHold('Hold: x — owner: o — wake: ruling — shape: task');
  assert.ok(!('shape' in late));
  assert.strictEqual(codec.parseWakeLine(late.wake).ok, false);
});

test('the new samples are scrubbed: hosts as h: tokens, repos as OWNER/REPO', () => {
  const all = PAIRS.flatMap(([n]) => group(n)).concat(samples.notHolds);
  for (const s of all) {
    for (const m of s.wire.matchAll(/host `([^`]*)`/g)) assert.match(m[1], /^h:[0-9a-f]{12}$/, s.wire);
    for (const m of s.wire.matchAll(/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#\d+/g)) assert.strictEqual(`${m[1]}/${m[2]}`, 'OWNER/REPO', s.wire);
  }
});

test('no two codec halves export the same name, so the flat index never shadows one', () => {
  const seen = new Map();
  for (const half of ['labels', 'claim', 'grants', 'decision', 'hold', 'release', 'markers']) {
    for (const k of Object.keys(codec[half])) {
      assert.ok(!seen.has(k), `${k} is exported by both ${seen.get(k)} and ${half}`);
      seen.set(k, half);
      assert.strictEqual(codec[k], codec[half][k], k);
    }
  }
});

test('the .d.ts files declare every runtime export of the #498/#499 halves', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  for (const half of ['grants', 'decision', 'hold', 'release', 'markers']) {
    const dts = read(`${half}.d.ts`);
    for (const k of Object.keys(codec[half])) {
      assert.match(dts, new RegExp(`export (const|function) ${k}\\b`), `${half}.d.ts is missing ${k}`);
    }
    assert.ok(read('index.d.ts').includes(`export * from './${half}';`), `index.d.ts is missing ${half}`);
  }
});

// ── #499: parent and close-reason markers ────────────────────────────────────────────────────

test('parent: both forms for same-repo and cross-repo refs; the comment wins; a conflict is reported', () => {
  const forms = new Set(samples.parents.map((s) => s.decoded.form));
  assert.deepStrictEqual([...forms].sort(), ['comment', 'line']);
  assert.ok(samples.parents.some((s) => s.decoded.repo) && samples.parents.some((s) => !s.decoded.repo));

  const block = codec.encodeParentBlock({ number: 496 });
  assert.strictEqual(block, '<!-- colab:parent issue=#496 -->\nParent: #496');
  assert.deepStrictEqual(codec.readParent(`Some text.\n\n${block}\n`), { repo: null, number: 496, form: 'comment', conflict: false });
  // A tracker that strips HTML comments leaves only the visible line, and that still reads.
  assert.deepStrictEqual(codec.readParent('Some text.\n\nParent: #496'), { repo: null, number: 496, form: 'line', conflict: false });
  assert.strictEqual(codec.readParent('Some text.\n  Parent: #496'), null, 'an indented line is quoted text');
  assert.strictEqual(codec.readParent('no parent'), null);
  assert.strictEqual(codec.readParent('<!-- colab:parent issue=#5 -->\nParent: #6').conflict, true);
  assert.strictEqual(codec.readParent('<!-- colab:parent issue=#5 -->\nParent: #6').number, 5);
  for (const bad of ['Parent: 496', 'Parent: #0', 'Parent: #4x', '<!-- colab:parent issue=496 -->']) {
    assert.strictEqual(codec.decodeParent(bad), null, bad);
  }
  assert.throws(() => codec.encodeParent({ number: 1, form: 'edge' }), TypeError);
});

test('close reason: closed set, both forms, read for closed items only, newest wins', () => {
  assert.deepStrictEqual([...codec.CLOSE_REASONS], ['completed', 'not-planned']);
  const forms = new Set(samples.closeReasons.map((s) => s.decoded.form));
  assert.deepStrictEqual([...forms].sort(), ['comment', 'line']);
  assert.deepStrictEqual(new Set(samples.closeReasons.map((s) => s.decoded.reason)), new Set(codec.CLOSE_REASONS));
  assert.throws(() => codec.encodeCloseReason({ reason: 'duplicate' }), TypeError);
  assert.strictEqual(codec.decodeCloseReason('Close reason: wontfix'), null);

  const comments = [
    { body: `Closing.\n${codec.encodeCloseReasonBlock('not-planned')}`, createdAt: '2026-01-01T00:00:00Z' },
    { body: 'Reopened, then done.\nClose reason: completed', createdAt: '2026-01-03T00:00:00Z' },
    { body: 'unrelated', createdAt: '2026-01-04T00:00:00Z' },
  ];
  assert.strictEqual(codec.readCloseReason({ state: 'closed', comments }), 'completed');
  assert.strictEqual(codec.readCloseReason({ state: 'CLOSED', comments: comments.slice(0, 1) }), 'not-planned');
  assert.strictEqual(codec.readCloseReason({ state: 'open', comments }), null, 'an open item has no close reason');
  assert.strictEqual(codec.readCloseReason({ state: 'closed', comments: [] }), null);
  assert.strictEqual(codec.readCloseReason({ state: 'closed', comments: [{ body: '<!-- colab:close-reason reason=completed -->\nClose reason: not-planned', createdAt: 'x' }] }),
    'completed', 'within one comment the comment form wins');
});

test('a parent is never written as a dependency: no marker in this codec reads as a blocked_by edge', () => {
  const block = codec.encodeParentBlock({ repo: 'OWNER/REPO', number: 12 });
  assert.doesNotMatch(block, /block/i);
  assert.strictEqual(codec.decodeHold(block), null);
  assert.strictEqual(codec.parseWake(codec.encodeParentRef({ number: 12 })).kind, 'edge',
    'the same `#N` spelled on a Hold line IS an edge — which is why a parent lives on its own marker, never there');
});
