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
