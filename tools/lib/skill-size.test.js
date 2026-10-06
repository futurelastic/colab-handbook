'use strict';
/**
 * #524: a skill loads whole into every session that runs it, so its size is a cost paid on
 * every run — and a one-off compaction regrows (#518: CONVENTIONS.md went from ~2,100 lines to
 * 5,781 after one). This is the brake: a checked budget per skill core.
 *
 *   - A SPLIT skill (its folder holds any .md besides SKILL.md — reference files) keeps its core
 *     SKILL.md at or under SPLIT_MAX_LINES / SPLIT_MAX_BYTES. The core carries the steps, each
 *     step's rule and stop condition, the commands and tables a run executes; rationale, edge
 *     cases and incidents live in the reference files the step names.
 *   - An UNSPLIT skill stays at or under UNSPLIT_MAX_LINES / UNSPLIT_MAX_BYTES. Crossing it is the
 *     signal to split, not to compress procedure prose until the number fits.
 *
 * Raising a limit for one skill is a reviewed line in OVERRIDES, with its reason — never an
 * edit to the constants above it.
 *
 * Also pinned here, because the split made them structural:
 *   - the local-policy hook (#520) sits in its fixed place, near the top of every core;
 *   - every relative file link in skills/ resolves (the audit checks #fragment links only);
 *   - every reference file is linked from its own core — an unlinked one is never read;
 *   - #517's hand-off filter: a moved-but-dropped regex is the loss this split risked most.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SKILLS = path.resolve(__dirname, '..', '..', 'skills');

const SPLIT_MAX_LINES = 400;
const SPLIT_MAX_BYTES = 40 * 1024;
const UNSPLIT_MAX_LINES = 700;
const UNSPLIT_MAX_BYTES = 48 * 1024;
const POLICY_WITHIN = 15; // lines after the frontmatter's closing `---`

// skill name -> { lines, bytes, reason }. Empty is the goal; every entry says why.
const OVERRIDES = {};

const skills = fs.readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(SKILLS, d.name, 'SKILL.md')))
  .map((d) => d.name)
  .sort();

const refFiles = (name) => fs.readdirSync(path.join(SKILLS, name))
  .filter((f) => f.endsWith('.md') && f !== 'SKILL.md')
  .sort();

const lineCount = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

const readCore = (name) => fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');

test('there are skills to check', () => {
  assert.ok(skills.length >= 5, `found only ${skills.length} skills under ${SKILLS}`);
});

for (const name of skills) {
  test(`${name}: core within its size budget`, () => {
    const text = readCore(name);
    const split = refFiles(name).length > 0;
    const o = OVERRIDES[name] || {};
    const maxLines = o.lines ?? (split ? SPLIT_MAX_LINES : UNSPLIT_MAX_LINES);
    const maxBytes = o.bytes ?? (split ? SPLIT_MAX_BYTES : UNSPLIT_MAX_BYTES);
    const lines = lineCount(text);
    const bytes = Buffer.byteLength(text);
    const hint = split
      ? 'move a step\'s edge cases or rationale into its reference file'
      : 'split it into a core plus reference files (#524) — do not compress procedure to fit';
    assert.ok(lines <= maxLines, `${name}/SKILL.md is ${lines} lines, budget ${maxLines} — ${hint}`);
    assert.ok(bytes <= maxBytes, `${name}/SKILL.md is ${bytes} bytes, budget ${maxBytes} — ${hint}`);
  });

  test(`${name}: local-policy hook in its fixed place`, () => {
    const lines = readCore(name).split('\n');
    assert.strictEqual(lines[0], '---', 'SKILL.md must open with frontmatter');
    const close = lines.indexOf('---', 1);
    assert.ok(close > 0, 'frontmatter is never closed');
    const at = lines.findIndex((l) => l.includes(`cat .colab/skills/${name}.md`));
    assert.ok(at > close, `no local-policy line (cat .colab/skills/${name}.md) after the frontmatter`);
    assert.ok(at - close <= POLICY_WITHIN,
      `local-policy line is ${at - close} lines after the frontmatter; keep it within ${POLICY_WITHIN} (#520)`);
  });

  test(`${name}: every reference file is linked from the core`, () => {
    const core = readCore(name);
    for (const f of refFiles(name)) {
      assert.ok(core.includes(`](${f})`) || core.includes(`](${f}#`),
        `${name}/${f} is never linked from ${name}/SKILL.md, so no run will read it`);
    }
  });
}

test('every relative file link in skills/ resolves', () => {
  const broken = [];
  for (const name of skills) {
    for (const f of ['SKILL.md', ...refFiles(name)]) {
      const file = path.join(SKILLS, name, f);
      let fence = false;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
        if (fence) return;
        const stripped = line.replace(/`[^`]*`/g, '');
        for (const m of stripped.matchAll(/\]\(([^)\s#]+)(#[^)\s]*)?\)/g)) {
          const target = m[1];
          if (/^[a-z]+:/i.test(target)) continue; // http:, mailto:, …
          if (!fs.existsSync(path.resolve(path.dirname(file), target))) {
            broken.push(`skills/${name}/${f}:${i + 1} → ${target}`);
          }
        }
      });
    }
  }
  assert.deepStrictEqual(broken, [], `broken relative links:\n  ${broken.join('\n  ')}`);
});

test('#517: the hand-off filter drops `↩️ Sent back` and bare signature lines', () => {
  const dir = path.join(SKILLS, 'code-sweep');
  const all = ['SKILL.md', ...refFiles('code-sweep')]
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.ok(all.includes('🔖 Referenced|↩️ Sent back)'),
    'code-sweep §3 test 3 no longer treats `↩️ Sent back` as bookkeeping (#517)');
  assert.ok(all.includes('select(.body | test("^—\\\\s[^\\\\n]+\\\\s*$") | not)'),
    'code-sweep §3 test 3 no longer drops a bare one-line signature comment (#517)');
});
