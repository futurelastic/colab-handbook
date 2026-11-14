'use strict';
/**
 * #744 — the pure half of the cross-factory takeover bar (tools/lib/claim-takeover.js). The CLI half
 * — the refusal, the lock overwrite, the claim ref removal — is claim-takeover-cli.test.js.
 * Run: `node --test tools/lib/claim-takeover.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const factories = require('./factories');
const ct = require('./claim-takeover');
const { hostToken } = require('./machine');

const KEY_A = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const KEY_B = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const FILE = `version: 1
steward: core
forge: github.com
factories:
  core:
    tier: steward
    machines: [box-a, box-b]
    key: ${KEY_A}
    humans: [operator-a]
  mobile:
    tier: partner
    machines: [mobile-1]
    key: ${KEY_B}
    humans: [operator-m]
`;
const parsed = factories.parseFactories(FILE);
const present = { present: true, parsed };
const DAY = ct.DAY_MS;

test('fixture factories file is valid', () => {
  assert.deepStrictEqual(parsed.findings, []);
  assert.strictEqual(parsed.valid, true);
});

test('a machine name resolves through its branch-prefix label on both sides', () => {
  assert.strictEqual(ct.factoryOfMachineName(parsed, 'Box_A.local'), 'core');
  assert.strictEqual(ct.factoryOfMachineName(parsed, 'mobile-1'), 'mobile');
  assert.strictEqual(ct.factoryOfMachineName(parsed, 'elsewhere'), null);
  assert.strictEqual(ct.factoryOfMachineName(factories.parseFactories('version: 2'), 'box-a'), null, 'invalid file answers nobody');
});

test('holderFactory reads each record kind', () => {
  assert.strictEqual(ct.holderFactory(parsed, 'remote', { lock: true, machine: 'mobile-1' }), 'mobile');
  assert.strictEqual(ct.holderFactory(parsed, 'remote', { lock: true, machine: null, branch: 'op/box-b/feat/x-7' }), 'core');
  assert.strictEqual(ct.holderFactory(parsed, 'remote', { branch: 'feat/x-7' }), null, 'an unprefixed branch names no machine');
  assert.strictEqual(ct.holderFactory(parsed, 'remote', { claimRef: true, branch: 'op/mobile-1/fix/y-7' }), 'mobile');
  assert.strictEqual(ct.holderFactory(parsed, 'gh', { assignees: ['Operator-M'] }), 'mobile', 'logins compare case-insensitively');
  assert.strictEqual(ct.holderFactory(parsed, 'gh', { assignees: ['operator-a', 'operator-m'] }), null, 'a split assignee set proves nothing');
  assert.strictEqual(ct.holderFactory(parsed, 'gh', { assignees: ['bot'], otherMachine: { host: hostToken('mobile-1.local'), login: 'bot' } }), 'mobile',
    'a redacted h: host token still resolves');
  assert.strictEqual(ct.holderFactory(parsed, 'local', {}, 'core'), 'core');
});

test('isCrossFactory: no file → never; invalid file → always; unproven → yes; all mine → no', () => {
  assert.strictEqual(ct.isCrossFactory({ present: false }, null, [null]), false);
  assert.strictEqual(ct.isCrossFactory({ present: true, parsed: factories.parseFactories('version: 1') }, 'core', ['core']), true);
  assert.strictEqual(ct.isCrossFactory(present, 'core', ['mobile']), true);
  assert.strictEqual(ct.isCrossFactory(present, 'core', [null]), true, 'a holder nothing ties to this team fails closed');
  assert.strictEqual(ct.isCrossFactory(present, 'core', ['core', null]), false, 'a silent assignee defers to the lock that names the machine');
  assert.strictEqual(ct.isCrossFactory(present, 'core', ['core', 'mobile']), true);
  assert.strictEqual(ct.isCrossFactory(present, null, ['core']), true, 'a machine in no factory is nobody\'s colleague');
});

test('staleness: 5 days or more is stale; unknown activity never is', () => {
  const now = Date.UTC(2026, 10, 14);
  assert.deepStrictEqual(ct.staleness(now - 5 * DAY, now), { stale: true, idleDays: 5 });
  assert.deepStrictEqual(ct.staleness(now - 5 * DAY + 1, now), { stale: false, idleDays: 4 });
  assert.deepStrictEqual(ct.staleness(null, now), { stale: false, idleDays: null });
  assert.strictEqual(ct.lastActivity([null, now - 9 * DAY, now - 2 * DAY]), now - 2 * DAY, 'the newest record wins');
  assert.strictEqual(ct.lastActivity([null, NaN]), null);
});

test('takeoverVerdict names every missing bar', () => {
  assert.deepStrictEqual(ct.takeoverVerdict({ colabHuman: false, answeredBy: null, stale: false }), { ok: false, missing: ['human', 'stale'] });
  assert.deepStrictEqual(ct.takeoverVerdict({ colabHuman: true, answeredBy: '  ', stale: true }), { ok: false, missing: ['human'] }, 'a blank name is no name');
  assert.deepStrictEqual(ct.takeoverVerdict({ colabHuman: false, answeredBy: 'Ada', stale: true }), { ok: false, missing: ['human'] }, '--answered-by alone is not the bar');
  assert.deepStrictEqual(ct.takeoverVerdict({ colabHuman: true, answeredBy: 'Ada', stale: false }), { ok: false, missing: ['stale'] });
  assert.deepStrictEqual(ct.takeoverVerdict({ colabHuman: true, answeredBy: 'Ada', stale: true }), { ok: true, missing: [] });
});
