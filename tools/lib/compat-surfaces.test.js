'use strict';
/**
 * #644: the compatibility list (docs/compat-surfaces.md) and its check (scripts/check-compat.mjs).
 * Every refusal the issue's table names is shown to fire on a small fixture tree, each compatible
 * change (a stub heading, an alias skill, a re-export, a dated retirement) is shown to pass, and
 * the live repo is shown clean. A check nobody has seen fail is a comment.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const load = () => import(path.join(ROOT, 'scripts', 'check-compat.mjs'));

const LIST = `# list
\`\`\`compat heading
guide
1-claims
stub-me
\`\`\`
\`\`\`compat skill
code-start
\`\`\`
\`\`\`compat command
claim
ship
\`\`\`
\`\`\`compat key
trunk
writes
\`\`\`
\`\`\`compat codec
CLAIM_MARK = "🔒 Claimed"
KINDS = "a,b"
\`\`\`
\`\`\`compat export
tools/lib/codec/index.js
\`\`\`
\`\`\`compat engine
claude
\`\`\`
\`\`\`compat template
templates/ci-node.yml
\`\`\`
\`\`\`compat retired
# <kind> <name> — vX.Y.0 — <evidence>
\`\`\`
`;

function fixture(edit = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-'));
  const files = {
    'CONVENTIONS.md': '# Guide\n\n## 1. Claims\n\n```md\n## not a heading\n```\n\n### Stub me\n\nGone to docs/x.md.\n',
    'skills/code-start/SKILL.md': '---\nname: code-start\ndescription: open a session\n---\nbody\n',
    'tools/colab': "function main(argv) {\n  const cmd = argv[0];\n  switch (cmd) {\n    case 'claim': return 1;\n    case 'ship': return 2;\n    case '-h': case '--help': case 'help': return 0;\n    default: return 2;\n  }\n}\n",
    'project.schema.md': '# Schema\n\n## Fields\n\n### `trunk` — required\n\n### `writes` — optional\n\n### `ci` — deliberately not a field\n\n## Examples\n\n### `notakey` — example\n',
    'tools/lib/codec/index.js': "module.exports = { CLAIM_MARK: '🔒 Claimed', KINDS: ['a', 'b'], RE: /x/ };\n",
    'engines/claude.conf': 'x\n',
    'templates/ci-node.yml': 'x\n',
    'docs/compat-surfaces.md': LIST,
    ...edit,
  };
  for (const [f, body] of Object.entries(files)) {
    if (body === null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), body);
  }
  return dir;
}

async function findings(edit, opts = {}) {
  const { check } = await load();
  return check({ root: fixture(edit), ...opts }).findings;
}

const one = (fs_, re) => {
  assert.strictEqual(fs_.length, 1, `expected one finding, got:\n${fs_.join('\n')}`);
  assert.match(fs_[0], re);
};

test('the fixture as written is clean — fences are skipped, a stub heading counts', async () => {
  assert.deepStrictEqual(await findings({}), []);
});

test('a CONVENTIONS heading that disappears fails, naming the stub', async () => {
  one(await findings({ 'CONVENTIONS.md': '# Guide\n\n## 1. Claims\n' }), /anchor stub-me disappeared — keep the heading with a short stub/);
});

test('renumbering a section is a disappearance of its anchor', async () => {
  const f = await findings({ 'CONVENTIONS.md': '# Guide\n\n## 2. Claims\n\n### Stub me\n' });
  assert.ok(f.some((x) => /anchor 1-claims disappeared/.test(x)), f.join('\n'));
  assert.ok(f.some((x) => /anchor 2-claims is not in/.test(x)), f.join('\n'));
});

test('a skill folder that disappears fails; a thin alias with the same name and triggers passes', async () => {
  one(await findings({ 'skills/code-start/SKILL.md': null }), /skill code-start disappeared — keep the folder as a thin alias/);
  assert.deepStrictEqual(await findings({ 'skills/code-start/SKILL.md': '---\nname: code-start\ndescription: open a session\n---\nLoad guides/author.md.\n' }), []);
  one(await findings({ 'skills/code-start/SKILL.md': '---\nname: author\ndescription: x\n---\n' }), /code-start SKILL\.md frontmatter name is "author"/);
});

test('a colab command dropped from the dispatch fails', async () => {
  one(await findings({ 'tools/colab': "  switch (cmd) {\n    case 'claim': return 1;\n  }\n" }), /colab command ship disappeared — keep the command, or have it answer/);
});

test('a project.yml key renamed or removed fails; a non-field heading is not a key', async () => {
  const f = await findings({ 'project.schema.md': '## Fields\n\n### `trunk` — required\n\n### `writing` — optional\n' });
  assert.ok(f.some((x) => /key writes disappeared/.test(x)), f.join('\n'));
  assert.ok(f.some((x) => /key writing is not in/.test(x)), f.join('\n'));
  assert.ok(!f.some((x) => /\bci\b|notakey/.test(x)), f.join('\n'));
});

test('a codec string changed in place fails, naming both values', async () => {
  one(await findings({ 'tools/lib/codec/index.js': "module.exports = { CLAIM_MARK: '🔐 Claimed', KINDS: ['a', 'b'] };\n" }),
    /codec string CLAIM_MARK changed: "🔒 Claimed" → "🔐 Claimed"/);
  one(await findings({ 'tools/lib/codec/index.js': "module.exports = { CLAIM_MARK: '🔒 Claimed', KINDS: ['a'] };\n" }), /KINDS changed: "a,b" → "a"/);
});

test('a package path removed fails; an unlisted tools/lib module is internal', async () => {
  one(await findings({ 'tools/lib/codec/index.js': null, 'docs/compat-surfaces.md': LIST.replace(/^CLAIM_MARK.*\nKINDS.*\n/m, '') }),
    /package path tools\/lib\/codec\/index\.js is gone — re-export it/);
  assert.deepStrictEqual(await findings({ 'tools/lib/internal.js': 'x\n' }), []);
});

test('an engine conf or a template renamed fails', async () => {
  const f = await findings({ 'engines/claude.conf': null, 'engines/claude-code.conf': 'x\n' });
  assert.ok(f.some((x) => /engine conf claude disappeared/.test(x)), f.join('\n'));
  one(await findings({ 'templates/ci-node.yml': null }), /template path templates\/ci-node\.yml disappeared — keep the file, with a header naming its new home/);
});

test('a new surface of a closed kind must be registered', async () => {
  one(await findings({ 'skills/code-new/SKILL.md': '---\nname: code-new\ndescription: x\n---\n' }), /skill code-new is not in docs\/compat-surfaces\.md — register it/);
});

test('removing a row and its surface together passes the snapshot but fails against --base', async () => {
  const edit = { 'templates/ci-node.yml': null, 'docs/compat-surfaces.md': LIST.replace('templates/ci-node.yml\n', '') };
  assert.deepStrictEqual(await findings(edit), []);
  one(await findings(edit, { base: LIST, latestTag: 'v1.15.0' }), /template path templates\/ci-node\.yml was removed from .* without a retired line/);
});

test('retirement: the next minor with evidence passes; a patch, a released version, or no evidence fails', async () => {
  const retire = (line) => ({
    'templates/ci-node.yml': null,
    'docs/compat-surfaces.md': LIST.replace('templates/ci-node.yml\n', '').replace('# <kind>', `${line}\n# <kind>`),
  });
  const opts = { base: LIST, latestTag: 'v1.15.0' };
  assert.deepStrictEqual(await findings(retire('template templates/ci-node.yml — v1.16.0 — searched 12 adopters, none copy it'), opts), []);
  one(await findings(retire('template templates/ci-node.yml — v1.16.1 — searched 12 adopters, none copy it'), opts), /v1\.16\.1, a patch release — a surface is retired only in a minor/);
  one(await findings(retire('template templates/ci-node.yml — v1.15.0 — searched 12 adopters, none copy it'), opts), /already released \(latest v1\.15\.0\) — name the next minor/);
  one(await findings(retire('template templates/ci-node.yml — v1.16.0 — x'), opts), /has no evidence/);
  // Already retired at base: a historical line, valid whatever the newest tag is.
  const done = retire('template templates/ci-node.yml — v1.10.0 — searched 12 adopters, none copy it');
  assert.deepStrictEqual(await findings(done, { base: done['docs/compat-surfaces.md'], latestTag: 'v1.15.0' }), []);
});

test('the live repo is clean against its own list', async () => {
  const { check } = await load();
  assert.deepStrictEqual(check({ root: ROOT }).findings, []);
});
