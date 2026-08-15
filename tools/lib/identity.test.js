'use strict';
/**
 * Tests for tools/lib/identity.js — the vocabulary's resolution, parsing, matching and
 * redaction (#228) — plus the CONFORMANCE table that holds this module and the shell hook
 * (templates/pre-commit-identity) to one set of semantics.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * WHY TWO IMPLEMENTATIONS EXIST AT ALL. They are forced by the delivery model, not chosen. A
 * template lands in repos that have no Node and no `tools/lib/`, so the pre-commit scanner
 * must be self-contained POSIX `sh` (as `pre-push-guard` already is). The metadata scan runs
 * inside the audit, which is Node and already speaks `gh`. This repo's standing objection to
 * two readings of one rule is answered by the last section of this file rather than by
 * pretending one runtime could serve both: the same vocabulary and the same subject go
 * through both, and the verdicts must agree.
 *
 * If you are changing a matching rule, expect to change it twice. That is the cost of the
 * template model, and it is bounded by the table below refusing to let the copies drift.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const identity = require('./identity.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCANNER = path.join(REPO_ROOT, 'templates', 'pre-commit-identity');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP.push(dir);
  return dir;
}

// --- where the vocabulary comes from -----------------------------------------------------

test('COLAB_IDENTITY_VOCAB wins, and is explicit', () => {
  const r = identity.resolveVocabularyPath({ env: { COLAB_IDENTITY_VOCAB: '/a/vocab' }, gitConfig: '/b/vocab', home: '/h' });
  assert.deepStrictEqual(r, { path: '/a/vocab', source: 'COLAB_IDENTITY_VOCAB', explicit: true });
});

test('git config is next, and is also explicit — the fail direction keys on this', () => {
  const r = identity.resolveVocabularyPath({ env: {}, gitConfig: '/b/vocab', home: '/h' });
  assert.strictEqual(r.path, '/b/vocab');
  assert.strictEqual(r.explicit, true);
});

test('the machine-wide default is NOT explicit — an unconfigured machine is not a violation', () => {
  const r = identity.resolveVocabularyPath({ env: {}, gitConfig: null, home: '/h' });
  assert.strictEqual(r.path, path.join('/h', '.colab', 'identity-vocabulary'));
  assert.strictEqual(r.source, 'default');
  assert.strictEqual(r.explicit, false);
});

test('COLAB_HOME moves the default, matching the CLI and the audit', () => {
  const r = identity.resolveVocabularyPath({ env: { COLAB_HOME: '/elsewhere' }, home: '/h' });
  assert.strictEqual(r.path, path.join('/elsewhere', 'identity-vocabulary'));
});

test('~ is expanded — it is not expanded inside an env var or a git config value', () => {
  const r = identity.resolveVocabularyPath({ env: { COLAB_IDENTITY_VOCAB: '~/private/vocab' }, home: '/h' });
  assert.strictEqual(r.path, path.join('/h', 'private', 'vocab'));
});

// --- parsing -----------------------------------------------------------------------------

test('comments, blank lines and surrounding whitespace are ignored; entry is the LINE number', () => {
  const { terms, problems } = identity.parseVocabulary('# a comment\n\n   build-box-01   \n');
  assert.deepStrictEqual(problems, []);
  assert.strictEqual(terms.length, 1);
  assert.strictEqual(terms[0].value, 'build-box-01');
  assert.strictEqual(terms[0].entry, 3, 'the operator owns the file — an entry number is a line number in it');
});

test('a # inside a term is part of the term — comments are whole-line only', () => {
  const { terms } = identity.parseVocabulary('build#box\n');
  assert.strictEqual(terms[0].value, 'build#box');
});

test('a term under the minimum length is a PROBLEM, not a term', () => {
  const { terms, problems } = identity.parseVocabulary('ab\nbuild-box-01\n');
  assert.strictEqual(terms.length, 1);
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0].message, /entry 1 is only 2 character\(s\)/);
});

test('an invalid regular expression is a PROBLEM naming the entry', () => {
  const { terms, problems } = identity.parseVocabulary('re:[unclosed\n');
  assert.deepStrictEqual(terms, []);
  assert.match(problems[0].message, /entry 1 is not a valid regular expression/);
});

// --- matching ----------------------------------------------------------------------------

const RECORDS = [
  { location: 'description', text: 'Mirrors of BUILD-BOX-01, nightly' },
  { location: 'topic 1', text: 'tooling' },
];

test('a fixed term matches case-insensitively, by substring', () => {
  const { terms } = identity.parseVocabulary('build-box-01\n');
  const hits = identity.scan(RECORDS, terms);
  assert.deepStrictEqual(hits.map((h) => h.location), ['description']);
});

test('a regex term matches by shape', () => {
  const { terms } = identity.parseVocabulary('re:/(users|home)/[a-z0-9._-]+/\n');
  const hits = identity.scan([{ location: 'description', text: 'built from /home/jdoe/src' }], terms);
  assert.strictEqual(hits.length, 1);
});

test('no match is an empty list, and an empty record contributes nothing', () => {
  const { terms } = identity.parseVocabulary('build-box-01\n');
  assert.deepStrictEqual(identity.scan([{ location: 'description', text: '' }, { location: 'homepage', text: null }], terms), []);
});

test('hits are ordered by entry then location — a report a human can diff between runs', () => {
  const { terms } = identity.parseVocabulary('zebra\nalpha\n');
  const hits = identity.scan([{ location: 'b', text: 'alpha zebra' }, { location: 'a', text: 'alpha zebra' }], terms);
  assert.deepStrictEqual(hits.map((h) => `${h.entry}:${h.location}`), ['1:a', '1:b', '2:a', '2:b']);
});

// --- redaction ---------------------------------------------------------------------------

test('a hit describes itself without the matched text unless told otherwise', () => {
  const { terms } = identity.parseVocabulary('build-box-01\n');
  const [hit] = identity.scan(RECORDS, terms);
  const quiet = identity.describeHit(hit);
  assert.doesNotMatch(quiet, /build-box-01/);
  assert.strictEqual(quiet, 'description — vocabulary entry 1 (12 chars, redacted)');
  assert.match(identity.describeHit(hit, { show: true }), /vocabulary entry 1: build-box-01/);
});

// --- conformance: the shell hook and this module must agree ------------------------------

/**
 * Drive the shell scanner over `text` in FILE mode with `vocabLines`, returning
 * { blocked, entries } — the entries it reported, parsed back out of its own (redacted)
 * output. File mode exists for the commit-msg install; it doubles as the seam that makes
 * this comparison possible without building a git index per case.
 */
function shellVerdict(vocabLines, text) {
  const dir = tmpdir('identity-conformance-');
  const vocab = path.join(dir, 'identity-vocabulary');
  const subject = path.join(dir, 'subject.txt');
  fs.writeFileSync(vocab, vocabLines.join('\n') + '\n');
  fs.writeFileSync(subject, text.endsWith('\n') ? text : `${text}\n`);
  const res = spawnSync('sh', [SCANNER, subject], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: dir, COLAB_HOME: dir, COLAB_IDENTITY_VOCAB: vocab, COLAB_IDENTITY_OK: '', COLAB_IDENTITY_SHOW: '' },
  });
  const out = `${res.stdout || ''}${res.stderr || ''}`;
  // Both shapes the scanner prints: a hit ("vocabulary entry 3") and a vocabulary problem
  // ("entry 3 is only 2 characters"). Both identify a term by its line number, which is the
  // property being compared — the wording around it is the hook's own message, not semantics.
  const entries = [...out.matchAll(/(?:vocabulary )?entry (\d+)/g)].map((m) => Number(m[1]));
  return { blocked: res.status !== 0, entries: [...new Set(entries)].sort((a, b) => a - b), out };
}

/** The same question, through this module. */
function moduleVerdict(vocabLines, text) {
  const { terms, problems } = identity.parseVocabulary(vocabLines.join('\n') + '\n');
  if (problems.length) return { blocked: true, entries: problems.map((p) => p.entry).sort((a, b) => a - b) };
  const hits = identity.scan(text.split('\n').map((line, i) => ({ location: `subject:${i + 1}`, text: line })), terms);
  return { blocked: hits.length > 0, entries: [...new Set(hits.map((h) => h.entry))].sort((a, b) => a - b) };
}

// Portable POSIX-ERE patterns only: the shell side runs these through awk, which has no \d,
// no lazy quantifiers and no lookaround. Anything relying on those would pass here and fail
// on half the machines this template lands on.
const CONFORMANCE = [
  ['a plain hit', ['build-box-01'], 'host = build-box-01'],
  ['a plain miss', ['build-box-01'], 'host = an-invented-name'],
  ['case folding both ways', ['Build-Box-01'], 'HOST = build-BOX-01'],
  ['substring, not word boundary', ['box-01'], 'my-build-box-01x'],
  ['comments and blanks skipped, entry numbers preserved', ['# note', '', 'build-box-01'], 'build-box-01'],
  ['a # inside a term', ['build#box'], 'the build#box thing'],
  ['several entries, several hits', ['alpha', 'zebra'], 'alpha and zebra'],
  ['only the second entry hits', ['alpha', 'zebra'], 'just zebra'],
  ['a regex hit', ['re:/(users|home)/[a-z0-9._-]+/'], 'from /home/jdoe/src'],
  ['a regex miss', ['re:/(users|home)/[a-z0-9._-]+/'], 'from /var/lib/thing'],
  ['a regex term is case-folded too', ['re:build-box-[0-9]+'], 'BUILD-BOX-42'],
  ['a term with a space', ['Northwind Freight'], 'owned by northwind freight ltd'],
  ['a too-short term is a refusal', ['ab'], 'anything at all'],
  ['an invalid regex is a refusal', ['re:[unclosed'], 'anything at all'],
  ['an empty vocabulary blocks nothing', ['# only a comment'], 'build-box-01'],
];

for (const [name, vocabLines, text] of CONFORMANCE) {
  test(`conformance — ${name}: the shell hook and identity.js agree`, () => {
    const shell = shellVerdict(vocabLines, text);
    const mod = moduleVerdict(vocabLines, text);
    assert.strictEqual(shell.blocked, mod.blocked, `verdict differs. shell said:\n${shell.out}`);
    assert.deepStrictEqual(shell.entries, mod.entries, `entries differ. shell said:\n${shell.out}`);
  });
}
