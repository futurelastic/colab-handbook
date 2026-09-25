'use strict';
/** Unit tests for lib/codeowners.js (#350). Run: `node --test tools/lib/*.test.js`. */
const test = require('node:test');
const assert = require('node:assert');
const co = require('./codeowners');

const owners = (text, p) => co.ownerOf(co.parse(text).rules, p);

test('#350 pattern: anchored directory covers everything under it, only at the root', () => {
  const t = '/.github/workflows/ @gate\n';
  assert.deepStrictEqual(owners(t, '.github/workflows/ci.yml'), ['@gate']);
  assert.deepStrictEqual(owners(t, '.github/workflows/sub/x.yml'), ['@gate']);
  assert.deepStrictEqual(owners(t, 'vendor/.github/workflows/ci.yml'), []);
});

test('#350 pattern: a bare name matches at any depth, as a file or a directory', () => {
  const t = 'CODEOWNERS @p\nmigrations @db\n';
  assert.deepStrictEqual(owners(t, '.github/CODEOWNERS'), ['@p']);
  assert.deepStrictEqual(owners(t, 'CODEOWNERS'), ['@p']);
  assert.deepStrictEqual(owners(t, 'app/migrations/001.sql'), ['@db']);
  assert.deepStrictEqual(owners(t, 'app/migrationsx/001.sql'), []);
});

test('#350 pattern: extension globs, dir/* one level, ** any depth, ? one char', () => {
  const t = '*.lock @a\ndocs/* @b\nconfig/**/deploy.yml @c\nv?.txt @d\n';
  assert.deepStrictEqual(owners(t, 'x/y/pnpm.lock'), ['@a']);
  assert.deepStrictEqual(owners(t, 'docs/a.md'), ['@b']);
  assert.deepStrictEqual(owners(t, 'docs/deep/a.md'), []);
  assert.deepStrictEqual(owners(t, 'config/deploy.yml'), ['@c']);
  assert.deepStrictEqual(owners(t, 'config/a/b/deploy.yml'), ['@c']);
  assert.deepStrictEqual(owners(t, 'v1.txt'), ['@d']);
  assert.deepStrictEqual(owners(t, 'v12.txt'), []);
});

test('#350 pattern: the last match wins, and an ownerless line carves a path out', () => {
  const t = '/.github/ @gate\n/.github/ISSUE_TEMPLATE/\n';
  assert.deepStrictEqual(owners(t, '.github/workflows/ci.yml'), ['@gate']);
  assert.deepStrictEqual(owners(t, '.github/ISSUE_TEMPLATE/bug.md'), []);
});

test('#350 parse: comments, escaped #, and unsupported syntax becomes a warning, never a match', () => {
  const { rules, warnings } = co.parse('# header\n\n\\#notes @h  # trailing\n!keep @x\n[ab].js @y\n');
  assert.strictEqual(rules.length, 3);
  assert.deepStrictEqual(rules[0].owners, ['@h']);
  assert.ok(rules[0].re.test('#notes'));
  assert.strictEqual(warnings.length, 2);
  assert.deepStrictEqual(co.ownerOf(rules, 'keep'), []);
  assert.deepStrictEqual(co.ownerOf(rules, 'a.js'), []);
});

test('#350 corePaths: only owned paths, deduplicated, with their owners', () => {
  const { rules } = co.parse('/.github/workflows/ @gate\n');
  assert.deepStrictEqual(co.corePaths(rules, ['.github/workflows/a.yml', 'src/x.js', '.github/workflows/a.yml']),
    [{ path: '.github/workflows/a.yml', owners: ['@gate'] }]);
});

test('#350 inert: no owned rule, or only the author, is inert; anyone else, a team, or no author is active', () => {
  const r = (t) => co.parse(t).rules;
  assert.strictEqual(co.inert([], ['me']).inert, true);
  assert.strictEqual(co.inert(r('/docs/\n'), ['me']).inert, true);
  assert.strictEqual(co.inert(r('* @Me\n/.github/ @me\n'), ['me']).inert, true);
  assert.strictEqual(co.inert(r('* @me @other\n'), ['me']).inert, false);
  assert.strictEqual(co.inert(r('* @org/core\n'), ['me']).inert, false);
  assert.strictEqual(co.inert(r('* someone@example.invalid\n'), ['me']).inert, false);
  assert.strictEqual(co.inert(r('* @me\n'), []).inert, false);
  // A branch-prefix login counts as an author too.
  assert.strictEqual(co.inert(r('* @me @bot\n'), ['me', 'bot']).inert, true);
});

const rv = (login, state, oid, at) => ({ author: { login }, state, commit: { oid }, submittedAt: at });

test('#350 approval: a non-author approval at the head sha approves', () => {
  const v = co.approvalVerdict([rv('other', 'APPROVED', 'abc', '2026-01-01T00:00:00Z')], { prAuthor: 'me', headSha: 'abc' });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.by, 'other');
});

test('#350 approval: the author, the branch-prefix login, or a shared account never counts', () => {
  assert.strictEqual(co.approvalVerdict([rv('me', 'APPROVED', 'abc')], { prAuthor: 'me', headSha: 'abc' }).ok, false);
  assert.strictEqual(co.approvalVerdict([rv('bot', 'APPROVED', 'abc')], { prAuthor: 'me', authors: ['bot'], headSha: 'abc' }).ok, false);
});

test('#350 approval: an approval of an older head is stale', () => {
  const v = co.approvalVerdict([rv('other', 'APPROVED', 'old')], { prAuthor: 'me', headSha: 'new' });
  assert.strictEqual(v.ok, false);
  assert.match(v.reason, /stale/);
});

test('#350 approval: latest review per reviewer wins; changes requested blocks; comments are ignored', () => {
  const later = co.approvalVerdict([
    rv('other', 'APPROVED', 'abc', '2026-01-01T00:00:00Z'),
    rv('other', 'CHANGES_REQUESTED', 'abc', '2026-01-02T00:00:00Z'),
  ], { prAuthor: 'me', headSha: 'abc' });
  assert.strictEqual(later.ok, false);
  assert.match(later.reason, /changes requested/);
  const recovered = co.approvalVerdict([
    rv('other', 'CHANGES_REQUESTED', 'abc', '2026-01-01T00:00:00Z'),
    rv('other', 'APPROVED', 'abc', '2026-01-02T00:00:00Z'),
    rv('other', 'COMMENTED', 'abc', '2026-01-03T00:00:00Z'),
  ], { prAuthor: 'me', headSha: 'abc' });
  assert.strictEqual(recovered.ok, true);
  assert.strictEqual(co.approvalVerdict([], { prAuthor: 'me', headSha: 'abc' }).reason, 'no approval yet');
});

// ---- #351: directVerdict, the trunk-direct unit's verdict ------------------------------------

const cf = (text, ref = 'main') => ({ path: '.github/CODEOWNERS', ref, text });

test('#351 directVerdict: no CODEOWNERS before or after is inert', () => {
  const v = co.directVerdict({ files: [null, null], authors: ['me'], changed: ['a.js'] });
  assert.strictEqual(v.verdict, 'inert');
  assert.strictEqual(v.active, false);
});

test('#351 directVerdict: an owned path touched refuses; an unowned one does not', () => {
  const f = cf('/gate/ @other\n');
  assert.strictEqual(co.directVerdict({ files: [f, f], authors: ['me'], changed: ['gate/x.js'] }).verdict, 'refuse');
  assert.strictEqual(co.directVerdict({ files: [f, f], authors: ['me'], changed: ['src/x.js'] }).verdict, 'not-core');
});

test('#351 directVerdict: the file BEFORE the unit counts, so narrowing it in the unit does not exempt', () => {
  const before = cf('/gate/ @other\n', 'abc1234');
  const after = cf('/gate/ @me\n');
  const v = co.directVerdict({ files: [before, after], authors: ['me'], changed: ['gate/x.js'] });
  assert.strictEqual(v.verdict, 'refuse');
  assert.deepStrictEqual(v.corePaths, [{ path: 'gate/x.js', owners: ['@other'] }]);
});

test('#351 directVerdict: an active rule with an unlistable change set refuses; an inert one does not', () => {
  assert.strictEqual(co.directVerdict({ files: [cf('* @other\n')], authors: ['me'], changed: null }).verdict, 'refuse');
  assert.strictEqual(co.directVerdict({ files: [cf('* @me\n')], authors: ['me'], changed: null }).verdict, 'inert');
});

test('#351 directVerdict: owners of the same path merge across the two files', () => {
  const v = co.directVerdict({ files: [cf('/g @a\n', 'old'), cf('/g @b\n')], authors: ['me'], changed: ['g'] });
  assert.deepStrictEqual(v.corePaths, [{ path: 'g', owners: ['@a', '@b'] }]);
});
