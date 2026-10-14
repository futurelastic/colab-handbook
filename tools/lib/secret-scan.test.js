'use strict';
/**
 * Unit tests for lib/secret-scan.js (#606) — the secret check `colab ship` runs on a docs-only
 * change. The CLI wiring is tested end to end in ship-docs-only-ci.test.js.
 *
 * Every credential-shaped fixture is assembled at run time, so no scanner reading this file (the
 * repo's own gitleaks job included) finds one in it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('./secret-scan');

const j = (...p) => p.join('');
const L = (text, file = 'README.md', line = 1) => ({ file, line, text });
const rules = (text, terms) => s.scanLines([L(text)], terms).map((f) => f.rule);

test('each generic credential shape is found', () => {
  assert.deepEqual(rules(j('-----BEGIN ', 'OPENSSH PRIVATE KEY-----')), ['private key']);
  assert.deepEqual(rules(j('-----BEGIN ', 'PRIVATE KEY-----')), ['private key']);
  assert.deepEqual(rules(j('id ', 'AKIA', 'ABCDEFGHIJKLMNOP', ' x')), ['AWS access key']);
  assert.deepEqual(rules(j('ghp', '_', 'a'.repeat(36))), ['GitHub token']);
  assert.deepEqual(rules(j('xox', 'b-', '1234567890-abc')), ['Slack token']);
  assert.deepEqual(rules(j('AI', 'za', 'B'.repeat(35))), ['Google API key']);
  assert.deepEqual(rules(j('sk', '_live_', 'a1'.repeat(12))), ['Stripe live key']);
  assert.deepEqual(rules(j('sk-', 'ant-', 'x'.repeat(24))), ['LLM API key']);
  assert.deepEqual(rules(j('password', '=hunter22x')), ['credential assignment']);
  assert.deepEqual(rules(j('api_key: "', 'q8w7e6r5t4', '"')), ['credential assignment']);
});

test('documented placeholders and prose are not findings', () => {
  for (const t of ['password: changeme', 'API_KEY=YOUR_API_KEY', 'password=$PASSWORD', 'token: ${{ secrets.TOKEN }}',
    'secret=<your-secret>', 'Set the password in the settings page.', j('AKIA', 'SHORT'), 'see docs/api/README.md']) {
    assert.deepEqual(rules(t), [], t);
  }
});

test('forbidden terms: the identity-vocabulary format', () => {
  const { terms, problems } = s.parseTerms('# comment\n\n  Host-Alpha-01  \nre:proj-[0-9]+\n');
  assert.deepEqual(problems, []);
  assert.deepEqual(terms.map((t) => t.line), [3, 4]);
  assert.deepEqual(rules('ssh host-alpha-01.example', terms), [`forbidden term, line 3 of ${s.TERMS_PATH}`]);
  assert.deepEqual(rules('ticket PROJ-42', terms), [`forbidden term, line 4 of ${s.TERMS_PATH}`]);
  assert.deepEqual(rules('nothing here', terms), []);
  assert.match(s.parseTerms('ab\n').problems[0], /line 1 is shorter than 3 characters/);
  assert.match(s.parseTerms('re:(\n').problems[0], /line 1 is not a valid regular expression/);
});

test('addedLines: new-file line numbers, file headers only outside a hunk', () => {
  const patch = [
    'diff --git a/a.md b/a.md', '--- a/a.md', '+++ b/a.md', '@@ -3,0 +4,2 @@', '+one', '+++ two',
    'diff --git a/gone.md b/gone.md', '--- a/gone.md', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye',
    'diff --git a/b.md b/b.md', '--- /dev/null', '+++ b/b.md', '@@ -0,0 +1 @@', '+three', '',
  ].join('\n');
  assert.deepEqual(s.addedLines(patch), [
    { file: 'a.md', line: 4, text: 'one' }, { file: 'a.md', line: 5, text: '++ two' }, { file: 'b.md', line: 1, text: 'three' },
  ]);
});
