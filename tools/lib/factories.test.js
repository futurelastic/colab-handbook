'use strict';
/**
 * Tests for `.github/factories.yml` (#739) — tools/lib/factories.js.
 *
 * Two promises the issue names: a machine id and a slice each belong to ONE factory across the
 * file, and the validator says so naming both factories. Plus the signature format the rest of
 * epic #738 builds on: the canonical verdict payload signs and verifies with real `ssh-keygen`,
 * and a changed field, another factory's key, or another repository's context fails.
 *
 * Run: `node --test tools/lib/factories.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const f = require('./factories.js');

const KEY_A = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOQmAeVx3k0r6Q0ZbqkDqE6gH2y0kJ8b8o7pX2z6c1aA core@box-a';
const KEY_B = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB9n4oWm5pQ2kz1X0vQf2y3nRk7m1ZpQ8c4s5t6u7v8w';

function file({ a = {}, b = {}, top = '' } = {}) {
  const fa = { tier: 'steward', machines: '[box-a, box-b]', key: KEY_A, humans: '[operator-a]', slices: '[slice:core]', ...a };
  const fb = { tier: 'partner', machines: '[mobile-1]', key: KEY_B, humans: '[]', slices: '[slice:mobile]', ...b };
  const block = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `    ${k}: ${v}`).join('\n');
  return [
    'version: 1',
    'steward: core',
    'forge: github.com',
    'factories:',
    '  core:', block(fa),
    '  mobile:', block(fb),
    'steward-areas: [CONVENTIONS.md, .github/**]',
    top,
  ].join('\n') + '\n';
}

test('a well-formed file parses, normalised', () => {
  const r = f.parseFactories(file());
  assert.deepStrictEqual(r.findings, []);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.doc.steward, 'core');
  assert.strictEqual(r.doc.forge, 'github.com');
  assert.deepStrictEqual(r.doc.factories.core.machines, ['box-a', 'box-b']);
  assert.deepStrictEqual(r.doc.factories.mobile.humans, []);
  assert.deepStrictEqual(r.doc.stewardAreas, ['CONVENTIONS.md', '.github/**']);
  assert.strictEqual(f.factoryOfMachine(r, 'mobile-1'), 'mobile');
  assert.strictEqual(f.factoryOfSlice(r, 'slice:core'), 'core');
  assert.strictEqual(f.isHumanOf(r, 'core', 'Operator-A'), true, 'logins compare case-insensitively');
  assert.strictEqual(f.isHumanOf(r, 'mobile', 'operator-a'), false, 'a human of one factory is not one of another');
});

test('a machine id in two factories is rejected, naming both', () => {
  const r = f.parseFactories(file({ b: { machines: '[mobile-1, box-b]' } }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.findings.some((x) => /machine `box-b` is claimed by both `core` and `mobile`/.test(x)), r.findings.join('\n'));
});

test('a slice owned by two factories is rejected, naming both', () => {
  const r = f.parseFactories(file({ b: { slices: '[slice:mobile, slice:core]' } }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.findings.some((x) => /slice `slice:core` is claimed by both `core` and `mobile`/.test(x)), r.findings.join('\n'));
});

test('one factory id declared twice is rejected — the parser alone would merge them silently', () => {
  const text = file().replace('  mobile:', '  core:');
  const r = f.parseFactories(text);
  assert.strictEqual(r.valid, false);
  assert.ok(r.findings.some((x) => /factory `core` is declared 2 times/.test(x)), r.findings.join('\n'));
});

test('two factories sharing one key is rejected — a key identifies one factory', () => {
  const r = f.parseFactories(file({ b: { key: KEY_A } }));
  assert.ok(r.findings.some((x) => /share one key/.test(x)), r.findings.join('\n'));
});

test('steward must name the one factory of tier steward', () => {
  assert.ok(f.parseFactories(file().replace('steward: core', 'steward: nobody')).findings
    .some((x) => /steward must name a declared factory/.test(x)));
  assert.ok(f.parseFactories(file().replace('steward: core', 'steward: mobile')).findings
    .some((x) => /steward `mobile` must have tier steward/.test(x)));
  assert.ok(f.parseFactories(file({ b: { tier: 'steward' } })).findings
    .some((x) => /exactly one factory has tier steward/.test(x)));
});

test('shape errors are findings, each naming its field', () => {
  const cases = [
    [file().replace('version: 1', 'version: 2'), /version must be 1/],
    [file().replace('forge: github.com', 'forge: https://github.com/x'), /forge must be a host name/],
    [file({ a: { tier: 'owner' } }), /factories\.core\.tier must be one of/],
    [file({ a: { key: 'not-a-key' } }), /factories\.core\.key must be one SSH public key/],
    [file({ a: { machines: '[]' } }), /factories\.core\.machines is an empty list/],
    [file({ a: { machines: undefined } }), /factories\.core\.machines is missing/],
    [file({ a: { slices: '[mobile]' } }), /factories\.core\.slices has an invalid entry "mobile"/],
    [file({ a: { humans: '[not a login]' } }), /factories\.core\.humans has an invalid entry/],
    [file({ a: { owner: 'x' } }), /factories\.core: unknown key `owner`/],
    [file({ top: 'trust: everyone' }), /unknown key `trust`/],
    ['version: 1\nsteward: core\nforge: github.com\nfactories:\n  - core\n', /factories must be a map keyed by factory id/],
  ];
  for (const [text, re] of cases) {
    const r = f.parseFactories(text);
    assert.strictEqual(r.valid, false, `expected invalid: ${re}`);
    assert.ok(r.findings.some((x) => re.test(x)), `${re} not in:\n${r.findings.join('\n')}`);
  }
});

test('an invalid file fails CLOSED: every lookup answers nobody', () => {
  const r = f.parseFactories(file({ b: { machines: '[box-a]' } }));
  assert.strictEqual(r.valid, false);
  assert.strictEqual(f.factoryOfMachine(r, 'box-b'), null);
  assert.strictEqual(f.factoryOfSlice(r, 'slice:core'), null);
  assert.strictEqual(f.isHumanOf(r, 'core', 'operator-a'), false);
  assert.strictEqual(f.allowedSigners(r, f.VERDICT_NAMESPACE), '');
});

test('the vocabulary is spelled once', () => {
  assert.strictEqual(f.FACTORY_LABEL_PREFIX, 'factory:');
  assert.strictEqual(f.SLICE_LABEL_PREFIX, 'slice:');
  assert.strictEqual(f.QUEUE_READY_LABEL, 'queue:ready');
  assert.strictEqual(f.REVIEW_LABEL_PREFIX, 'review:');
  assert.strictEqual(f.AUDIT_STATUS_CONTEXT, 'audit');
  assert.strictEqual(f.reviewStatusContext('correctness', 'mobile'), 'review/correctness@mobile');
});

const HEAD = 'a'.repeat(40);
const FIELDS = { issue: 739, phase: 'review', verdict: 'pass', head: HEAD, factory: 'core' };
const CTX = { forge: 'github.com', repo: 'owner/repo' };

test('the canonical payload is fixed bytes: header, seven fields in order, LF, trailing LF', () => {
  assert.strictEqual(f.verdictPayload(FIELDS, CTX),
    'colab-verdict/1\nforge=github.com\nrepo=owner/repo\nissue=739\nphase=review\nverdict=pass\n' +
    `head=${HEAD}\nfactory=core\n`);
  assert.throws(() => f.verdictPayload({ ...FIELDS, head: 'abc1234' }, CTX), /full 40-hex/);
  assert.throws(() => f.verdictPayload({ ...FIELDS, verdict: 'ok' }, CTX), /verdict must be one of/);
  assert.throws(() => f.verdictPayload({ ...FIELDS, phase: 'a b' }, CTX), /phase must be/);
  assert.throws(() => f.verdictPayload(FIELDS, { forge: 'github.com' }), /repo must be owner\/name/);
});

test('the marker round-trips; an unsigned marker decodes but is not signed', () => {
  const m = f.encodeVerdictMarker({ phase: 'review', verdict: 'pass', head: HEAD, factory: 'core', sig: 'QUJD+/9=', extra: { round: 1 } });
  assert.strictEqual(m, `<!-- colab:verdict phase=review v=pass head=${HEAD} factory=core round=1 sig=QUJD+/9= -->`);
  const d = f.decodeVerdictMarker(m);
  assert.deepStrictEqual({ ...d, extra: { ...d.extra } }, { phase: 'review', verdict: 'pass', head: HEAD, factory: 'core', sig: 'QUJD+/9=', signed: true, extra: { round: '1' } });
  const old = f.decodeVerdictMarker('<!-- colab:verdict phase=triage-assess v=pass round=0 head=d97d6b903033 dispatch=tad_x -->');
  assert.strictEqual(old.signed, false);
  assert.strictEqual(old.factory, null);
  assert.strictEqual(f.decodeVerdictMarker('<!-- colab:parent issue=#1 -->'), null);
});

const HAVE_SSH_KEYGEN = spawnSync('ssh-keygen', ['-?'], { stdio: 'ignore' }).error === undefined;

test('a signed verdict verifies against trunk\'s allowed signers, and only for the payload it signed', { skip: !HAVE_SSH_KEYGEN && 'no ssh-keygen' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factories-sig-'));
  const keygen = (name) => {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', path.join(dir, name)]);
    return fs.readFileSync(path.join(dir, `${name}.pub`), 'utf8').trim();
  };
  const pubCore = keygen('core');
  const pubMobile = keygen('mobile');
  const parsed = f.parseFactories(file({ a: { key: pubCore }, b: { key: pubMobile } }));
  assert.deepStrictEqual(parsed.findings, []);
  const signersFile = path.join(dir, 'allowed_signers');
  fs.writeFileSync(signersFile, f.allowedSigners(parsed, f.VERDICT_NAMESPACE));

  const sign = (keyName, payload) => {
    const msg = path.join(dir, `msg-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(msg, payload);
    execFileSync('ssh-keygen', ['-Y', 'sign', '-q', '-n', f.VERDICT_NAMESPACE, '-f', path.join(dir, keyName), msg], { stdio: 'ignore' });
    return f.sigFromArmor(fs.readFileSync(`${msg}.sig`, 'utf8'));
  };
  /** The verifier: decode the marker, rebuild the payload from ITS context, check with ssh-keygen. */
  const verify = (marker, ctx) => {
    const d = f.decodeVerdictMarker(marker);
    if (!d || !d.signed) return false;
    const sigFile = path.join(dir, `v-${Math.random().toString(36).slice(2)}.sig`);
    fs.writeFileSync(sigFile, f.armorFromSig(d.sig));
    const payload = f.verdictPayload({ issue: 739, phase: d.phase, verdict: d.verdict, head: d.head, factory: d.factory }, ctx);
    const r = spawnSync('ssh-keygen', ['-Y', 'verify', '-f', signersFile, '-I', d.factory, '-n', f.VERDICT_NAMESPACE, '-s', sigFile], { input: payload });
    return r.status === 0;
  };

  const sig = sign('core', f.verdictPayload(FIELDS, CTX));
  const marker = f.encodeVerdictMarker({ phase: 'review', verdict: 'pass', head: HEAD, factory: 'core', sig, extra: { round: 0 } });
  assert.strictEqual(verify(marker, CTX), true, 'the signed marker verifies');

  assert.strictEqual(verify(marker.replace('v=pass', 'v=rework'), CTX), false, 'a changed verdict fails');
  assert.strictEqual(verify(marker.replace(`head=${HEAD}`, `head=${'b'.repeat(40)}`), CTX), false, 'a changed head fails');
  assert.strictEqual(verify(marker.replace('round=0', 'round=7'), CTX), true, 'an unsigned extra field is not covered — and must never be trusted');
  assert.strictEqual(verify(marker, { forge: 'github.com', repo: 'owner/other' }), false, 'the same marker replayed in another repository fails');
  assert.strictEqual(verify(marker.replace('factory=core', 'factory=mobile'), CTX), false, 'claiming another factory fails');

  const forged = f.encodeVerdictMarker({ phase: 'review', verdict: 'pass', head: HEAD, factory: 'core',
    sig: sign('mobile', f.verdictPayload(FIELDS, CTX)) });
  assert.strictEqual(verify(forged, CTX), false, 'another factory\'s key cannot sign for core');
});

test('a claim commit signed with a factory\'s key verifies under allowedSigners(…, "git"); another key does not', { skip: !HAVE_SSH_KEYGEN && 'no ssh-keygen' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factories-claim-'));
  const keygen = (name) => {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', path.join(dir, name)]);
    return fs.readFileSync(path.join(dir, `${name}.pub`), 'utf8').trim();
  };
  const parsed = f.parseFactories(file({ a: { key: keygen('core') }, b: { key: keygen('mobile') } }));
  assert.strictEqual(parsed.valid, true);
  const signers = path.join(dir, 'allowed_signers');
  fs.writeFileSync(signers, f.allowedSigners(parsed, f.CLAIM_NAMESPACE));
  const repo = path.join(dir, 'repo');
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@x' };
  const git = (...args) => spawnSync('git', ['-C', repo, ...args], { env, encoding: 'utf8' });
  execFileSync('git', ['init', '-q', repo], { env });
  git('config', 'gpg.format', 'ssh');
  git('config', 'gpg.ssh.allowedSignersFile', signers);
  const claim = (keyName) => {
    git('config', 'user.signingkey', path.join(dir, keyName));
    const r = git('commit', '-q', '-S', '--allow-empty', '-m', 'claim: #739');
    assert.strictEqual(r.status, 0, r.stderr);
    return git('verify-commit', '--raw', 'HEAD');
  };
  const good = claim('core');
  assert.strictEqual(good.status, 0, good.stderr);
  assert.match(good.stderr, /Good "git" signature for core/, 'the principal is the factory id');

  // A key the trunk's file does not list: no principal, no verification.
  keygen('stranger');
  assert.notStrictEqual(claim('stranger').status, 0, 'a key outside the factories file does not verify');
});
