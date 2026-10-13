'use strict';
/**
 * #598 — the migration-grant policy's one precedence: repo key > this machine's value > human.
 * The pure record reading, the three rungs, the loader's failure states, the config write helper,
 * and the ship rule fed with the resolved policy. The CLI wiring is in grant-policy-cli.test.js.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gp = require('./grant-policy.js');
const mg = require('./migration-grant.js');

const repo = (doc) => mg.parseGrantPolicy(doc);
const m = (value, by = 'ada', at = '2026-10-13T00:00:00Z') => ({ read: 'ok', set: true, value, by, at, host: 'box-a', machine: null });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-grant-policy-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });
const cfgFile = (name, body) => { const f = path.join(TMP, name); if (body !== undefined) fs.writeFileSync(f, body); return f; };

// ---- the three rungs ----------------------------------------------------------------------------

test('no repo key + machine reviewer → reviewer, source machine, naming who set it and when', () => {
  const r = gp.resolveGrantPolicy(repo({}), m('reviewer'));
  assert.deepEqual([r.policy, r.source, r.declared, r.valid, r.optedOut], ['reviewer', 'machine', false, true, false]);
  assert.equal(r.machineBy, 'ada');
  assert.match(r.reason, /machine-level migration-grant: reviewer .*ada.*2026-10-13/);
  assert.equal(gp.sourceLabel(r), 'machine (ada at 2026-10-13T00:00:00Z)');
});

test('repo human + machine reviewer → human, source repo, opted out — the reason says so', () => {
  const r = gp.resolveGrantPolicy(repo({ 'migration-grant': 'human' }), m('reviewer'));
  assert.deepEqual([r.policy, r.source, r.optedOut], ['human', 'repo', true]);
  assert.match(r.reason, /opted out/);
});

test('repo reviewer wins over machine human; repo human + machine human is not an opt-out', () => {
  const a = gp.resolveGrantPolicy(repo({ 'migration-grant': 'reviewer' }), m('human'));
  assert.deepEqual([a.policy, a.source, a.optedOut], ['reviewer', 'repo', false]);
  assert.equal(gp.resolveGrantPolicy(repo({ 'migration-grant': 'human' }), m('human')).optedOut, false);
});

test('no machine value → every pre-#598 field identical to parseGrantPolicy, source default/repo', () => {
  for (const doc of [{}, { 'migration-grant': 'human' }, { 'migration-grant': 'reviewer' }, { 'migration-grant': 'bogus' }]) {
    const base = repo(doc);
    for (const mach of [null, { read: 'none', set: false }, gp.machinePolicyFrom({})]) {
      const r = gp.resolveGrantPolicy(base, mach);
      for (const k of ['policy', 'declared', 'valid', 'reason']) assert.deepEqual(r[k], base[k], `${JSON.stringify(doc)} ${k}`);
      assert.equal(r.source, base.declared ? 'repo' : 'default');
      assert.equal(r.machineNote, '');
    }
  }
});

test('an unusable machine record fails closed to the default, with a note', () => {
  for (const mach of [{ read: 'unread', why: 'x' }, { read: 'invalid', why: 'bad' }, { read: 'foreign', why: 'other box' }]) {
    const r = gp.resolveGrantPolicy(repo({}), mach);
    assert.deepEqual([r.policy, r.source], ['human', 'default']);
    assert.ok(r.machineNote, mach.read);
    assert.match(r.reason, /machine-level value is not usable/);
  }
});

test('an invalid repo value is not filled in by the machine value', () => {
  const r = gp.resolveGrantPolicy(repo({ 'migration-grant': 'maybe' }), m('reviewer'));
  assert.deepEqual([r.policy, r.valid, r.source], ['human', false, 'repo']);
});

// ---- the record and the loader ------------------------------------------------------------------

test('machinePolicyFrom: none · invalid · foreign · ok (and the binding skipped where an id is missing)', () => {
  assert.equal(gp.machinePolicyFrom({}).read, 'none');
  assert.equal(gp.machinePolicyFrom({ policy: { 'migration-grant': { value: 'Reviewer' } } }).read, 'invalid');
  assert.equal(gp.machinePolicyFrom({ policy: { 'migration-grant': 'reviewer' } }).read, 'invalid');
  const rec = { policy: { 'migration-grant': { value: 'reviewer', by: 'ada', at: 't', host: 'box-a', machine: 'A' } } };
  assert.equal(gp.machinePolicyFrom(rec, { machineId: 'B' }).read, 'foreign');
  for (const machineId of ['A', null]) {
    const r = gp.machinePolicyFrom(rec, { machineId });
    assert.deepEqual([r.read, r.set, r.value, r.by], ['ok', true, 'reviewer', 'ada']);
  }
});

test('readMachinePolicy never throws: a missing file is none, a broken one is unread', () => {
  assert.equal(gp.readMachinePolicy({ configFile: cfgFile('missing.json'), machineId: null }).read, 'none');
  assert.equal(gp.readMachinePolicy({ configFile: cfgFile('broken.json', '{bad'), machineId: null }).read, 'unread');
});

test('withValue keeps every other key; unset removes the record and an emptied section', () => {
  const meta = { by: 'ada', at: 't', host: 'box-a', machine: 'A' };
  const set = gp.withValue({ repos: ['/x'], portRange: '1-2' }, 'reviewer', meta);
  assert.deepEqual(set, { repos: ['/x'], portRange: '1-2', policy: { 'migration-grant': { value: 'reviewer', ...meta } } });
  assert.deepEqual(gp.withValue(set, 'unset'), { repos: ['/x'], portRange: '1-2' });
  assert.throws(() => gp.withValue({}, 'maybe'), /not one of/);
});

test('effectiveGrantPolicy (the console call) equals resolve(parse, read) on every rung', () => {
  const f = cfgFile('rungs.json', JSON.stringify(gp.withValue({}, 'reviewer', { by: 'ada', at: 't', host: 'box-a', machine: null })));
  for (const doc of [{}, { 'migration-grant': 'human' }, { 'migration-grant': 'reviewer' }]) {
    const opts = { configFile: f, machineId: null };
    assert.deepEqual(gp.effectiveGrantPolicy(doc, opts), gp.resolveGrantPolicy(mg.parseGrantPolicy(doc), gp.readMachinePolicy(opts)));
  }
  assert.equal(gp.effectiveGrantPolicy({}, { configFile: f, machineId: null }).source, 'machine');
});

// ---- the ship rule, fed the resolved policy ------------------------------------------------------

const LABEL = 'migration-granted';
const BRANCH = 'feat/schema-change-1';
const HEAD = 'a'.repeat(40);
const reviewRec = () => ({ v: '1', role: 'migration-reviewer', reviewer: 'bot-a', head: HEAD, verdict: 'approve', checklist: 'pass',
  'checklist-items': '7/7', escalation: 'destructive-ddl', 'escalation-result': 'clear', 'ci-roundtrip': 'pass' });
const issue = { state: 'OPEN', labels: [{ name: LABEL }],
  comments: [{ body: mg.reviewGrantCommentBody(BRANCH, 'box', '2026-10-13T00:00:00Z', reviewRec()), createdAt: '2026-10-13T00:00:00Z', author: { login: 'ada' }, authorAssociation: 'MEMBER' }] };
// The same expression tools/colab shipMigrationCtx builds policyReason with.
const shipCtx = (pres) => ({ policy: pres.policy, policyReason: pres.source === 'machine' || pres.optedOut || pres.machineNote ? pres.reason : null,
  headSha: HEAD, roundtrip: () => ({ ok: true, reason: '' }) });

test('ship: no repo key + machine reviewer → a passing reviewer grant ships', () => {
  const v = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL, shipCtx(gp.resolveGrantPolicy(repo({}), m('reviewer'))));
  assert.equal(v.ok, true, JSON.stringify(v.missing));
  assert.equal(v.granted[0].role, 'reviewer');
});

test('ship: repo human + machine reviewer → refused on P, and the reason says the repo opted out', () => {
  const v = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL, shipCtx(gp.resolveGrantPolicy(repo({ 'migration-grant': 'human' }), m('reviewer'))));
  assert.equal(v.ok, false);
  assert.equal(v.missing[0].failed, 'policy');
  assert.match(v.missing[0].reason, /opted out/);
});

test('ship: no machine value → the P refusal is the pre-#598 one, byte for byte', () => {
  const before = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL, { policy: 'human', headSha: HEAD, roundtrip: () => ({ ok: true }) });
  const after = mg.evaluateShipSet([1], { 1: issue }, BRANCH, LABEL, shipCtx(gp.resolveGrantPolicy(repo({}), { read: 'none', set: false })));
  assert.deepEqual(after, before);
});
