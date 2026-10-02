'use strict';
/**
 * Tests for tools/lib/instruction-file.js (#417) — the @-import resolver and the tool-block
 * table every instruction-file consumer shares. `templates/docs-lint.mjs` carries an inline
 * one-level copy of `parseImports`; tools/lib/docs-lint.test.js pins the same cases there.
 *
 * Run: `node --test tools/lib/*.test.js`.
 */

const test = require('node:test');
const assert = require('node:assert');
const inst = require('./instruction-file.js');

const reader = (files) => (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null);

test('parseImports: own-line and mid-line @tokens; ignores code spans, fenced blocks, and user@host', () => {
  const text = [
    '@AGENTS.md',
    'See @docs/rules.md, and also @notes.md.',
    'Run `gh issue edit 1 --add-assignee @me` here.',
    '```sh',
    '@inside-fence.md',
    '```',
    'mail user@example.md please',
  ].join('\n');
  assert.deepStrictEqual(inst.parseImports(text).map((i) => i.raw), ['AGENTS.md', 'docs/rules.md', 'notes.md']);
  assert.strictEqual(inst.parseImports(text)[1].line, 2);
});

test('resolveImport: relative to the importing file; rejects /abs, ~/x, ../x, a/../../x', () => {
  assert.deepStrictEqual(inst.resolveImport('CLAUDE.md', 'AGENTS.md'), { path: 'AGENTS.md' });
  assert.deepStrictEqual(inst.resolveImport('docs/a.md', 'b.md'), { path: 'docs/b.md' });
  assert.deepStrictEqual(inst.resolveImport('docs/a.md', '../c.md'), { path: 'c.md' });
  assert.deepStrictEqual(inst.resolveImport('CLAUDE.md', '/etc/x.md'), { rejected: 'absolute' });
  assert.deepStrictEqual(inst.resolveImport('CLAUDE.md', '~/x.md'), { rejected: 'home' });
  assert.deepStrictEqual(inst.resolveImport('CLAUDE.md', '../x.md'), { rejected: 'escapes' });
  assert.deepStrictEqual(inst.resolveImport('CLAUDE.md', 'a/../../x.md'), { rejected: 'escapes' });
});

test('collectLoaded: recursive to depth 5; deeper imports reported as truncated', () => {
  const files = { 'CLAUDE.md': '@f1.md' };
  for (let i = 1; i <= 7; i++) files[`f${i}.md`] = `@f${i + 1}.md`;
  const r = inst.collectLoaded(reader(files));
  assert.deepStrictEqual(r.files.map((f) => f.path), ['CLAUDE.md', 'f1.md', 'f2.md', 'f3.md', 'f4.md', 'f5.md']);
  assert.deepStrictEqual(r.truncated.map((t) => t.path), ['f6.md']);
});

test('collectLoaded: cycle CLAUDE.md -> AGENTS.md -> CLAUDE.md reads each file once', () => {
  let reads = 0;
  const files = { 'CLAUDE.md': '@AGENTS.md', 'AGENTS.md': 'rules\n@CLAUDE.md' };
  const r = inst.collectLoaded((p) => { reads++; return reader(files)(p); });
  assert.deepStrictEqual(r.files.map((f) => f.path), ['CLAUDE.md', 'AGENTS.md']);
  assert.strictEqual(reads, 2);
});

test('collectLoaded: missing target recorded, not thrown; escaping import rejected', () => {
  const r = inst.collectLoaded(reader({ 'CLAUDE.md': '@types/node is a package\n@../outside.md' }));
  assert.deepStrictEqual(r.files.map((f) => f.path), ['CLAUDE.md']);
  assert.deepStrictEqual(r.missing.map((m) => m.path), ['types/node']);
  assert.deepStrictEqual(r.rejected.map((m) => m.reason), ['escapes']);
});

test('collectLoaded: a missing entry yields no files', () => {
  assert.deepStrictEqual(inst.collectLoaded(reader({})).files, []);
});

test('findToolBlocks: Laravel Boost pair and BEGIN/END pair found; unpaired open ignored', () => {
  const text = [
    '# x',
    '<laravel-boost-guidelines>',
    'guidance',
    '</laravel-boost-guidelines>',
    '<!-- BEGIN:nextjs-agent-rules -->',
    'rules',
    '<!-- END:nextjs-agent-rules -->',
    '<!-- BEGIN:never-closed -->',
    'tail',
  ].join('\n');
  assert.deepStrictEqual(inst.findToolBlocks(text), [
    { id: 'laravel-boost', startLine: 2, endLine: 4 },
    { id: 'nextjs-agent-rules', startLine: 5, endLine: 7 },
  ]);
});

test('duplicateToolBlocks: same id in two files is reported once with both paths', () => {
  const block = '<laravel-boost-guidelines>\nx\n</laravel-boost-guidelines>\n';
  assert.deepStrictEqual(
    inst.duplicateToolBlocks([{ path: 'CLAUDE.md', text: block }, { path: 'AGENTS.md', text: block }]),
    [{ id: 'laravel-boost', paths: ['CLAUDE.md', 'AGENTS.md'] }],
  );
  assert.deepStrictEqual(inst.duplicateToolBlocks([{ path: 'AGENTS.md', text: block }]), []);
});

test('authoredRouter: shell -> AGENTS.md; no CLAUDE.md -> AGENTS.md; plain CLAUDE.md -> CLAUDE.md; neither -> null', () => {
  assert.strictEqual(inst.authoredRouter(reader({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': 'x' })), 'AGENTS.md');
  assert.strictEqual(inst.authoredRouter(reader({ 'AGENTS.md': 'x' })), 'AGENTS.md');
  assert.strictEqual(inst.authoredRouter(reader({ 'CLAUDE.md': 'plain', 'AGENTS.md': 'x' })), 'CLAUDE.md');
  assert.strictEqual(inst.authoredRouter(reader({ 'CLAUDE.md': '@AGENTS.md' })), 'CLAUDE.md');
  assert.strictEqual(inst.authoredRouter(reader({})), null);
});

test('isThinShell: recognises the @AGENTS.md import, not a mention in code', () => {
  assert.ok(inst.isThinShell('@AGENTS.md\n\n## Conventions\n'));
  assert.ok(!inst.isThinShell('Write `@AGENTS.md` on line one.'));
});

test('findToolBlocks: <name>:start/end pair with a trailing note on the open line (#419)', () => {
  const text = '<!-- ui-kit:start (managed by a package) -->\nx\n<!-- ui-kit:end -->\n<!-- colab:derived:start id=toc -->\ny\n<!-- colab:derived:end -->\n';
  assert.deepStrictEqual(inst.findToolBlocks(text), [
    { id: 'ui-kit', startLine: 1, endLine: 3 },
    { id: 'colab:derived', startLine: 4, endLine: 6 },
  ]);
});

test('conventionsBlock: heading above the stamp to the next same-level heading; a title heading is not the block (#419)', () => {
  const text = '@AGENTS.md\n\n## Conventions\n\n<!-- colab-handbook @ v1 -->\n\n- bullet\n\n## Other\nprose\n';
  assert.deepStrictEqual(inst.conventionsBlock(text), { startLine: 3, endLine: 7 });
  assert.strictEqual(inst.conventionsBlock('# CLAUDE.md\n\nA repo that follows the colab-handbook conventions.\n'), null);
  assert.deepStrictEqual(inst.conventionsBlock('# Title\n<!-- colab-handbook @ v1 -->\n- b\n### sub\n'), { startLine: 2, endLine: 3 });
});

test('shellResidue + lineRanges: imports, blanks, tool blocks and the Conventions block are not prose (#419)', () => {
  const text = '@AGENTS.md @docs/extra.md\n\n## Conventions\n<!-- colab-handbook @ v1 -->\n- b\n\n## Mine\na\n\nb\n<!-- BEGIN:x -->\nz\n<!-- END:x -->\nc\n';
  const residue = inst.shellResidue(text);
  assert.deepStrictEqual(residue, [7, 8, 10, 14]);
  assert.strictEqual(inst.lineRanges(residue), '7-8, 10, 14');
  assert.strictEqual(inst.lineRanges(residue, text), '7-10, 14');
});
