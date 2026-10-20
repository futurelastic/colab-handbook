'use strict';
/**
 * #642: the role guides in guides/ hold the judgement the session skills carried, written as the
 * files each role leaves for the next step. The old skills stay, same name and triggers, and name
 * their guide first (docs/compat-surfaces.md: "the skill becomes a thin alias that loads its
 * replacement guide"). This pins what makes that true:
 *
 *   - the five role guides and the index exist;
 *   - they stay short — the point of a guide is that it is read whole, so the total is capped;
 *   - every file a guide says its role leaves has a fixed shape, as a fenced block;
 *   - every relative link in guides/ resolves;
 *   - each aliased skill links the guide(s) it now points to.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const GUIDES = path.join(ROOT, 'guides');

const ROLES = ['author', 'reviewer', 'coordinator', 'cure', 'by-hand'];
const MAX_TOTAL_LINES = 520; // the ask was "about 440 lines in all"; raising it is a reviewed edit here

// skill -> the guide(s) its SKILL.md names first. A skill's body stays as that guide's mechanics.
const ALIASES = {
  'code-plan': ['author'],
  'code-start': ['author'],
  'code-wrap': ['author'],
  'code-ship': ['reviewer', 'by-hand'],
  'code-triage': ['coordinator'],
  'code-sweep': ['by-hand'],
  'release-rung': ['by-hand'],
};

const read = (f) => fs.readFileSync(path.join(GUIDES, f), 'utf8');
const lineCount = (t) => t.split('\n').length - (t.endsWith('\n') ? 1 : 0);

test('the index and every role guide exist', () => {
  for (const f of ['README.md', ...ROLES.map((r) => `${r}.md`)]) {
    assert.ok(fs.existsSync(path.join(GUIDES, f)), `guides/${f} is missing`);
  }
});

test(`the guides stay short: ${MAX_TOTAL_LINES} lines in all`, () => {
  const files = fs.readdirSync(GUIDES).filter((f) => f.endsWith('.md'));
  const total = files.reduce((n, f) => n + lineCount(read(f)), 0);
  assert.ok(total <= MAX_TOTAL_LINES, `guides/ is ${total} lines, cap ${MAX_TOTAL_LINES} — a guide carries judgement; mechanics stay with the skill or the tool`);
});

for (const role of ROLES) {
  test(`${role}: every file it leaves has a shape`, () => {
    const text = read(`${role}.md`);
    // A "Leaves:" heading line names one file the role hands on; the next fenced block is its shape.
    const leaves = [...text.matchAll(/^### Leaves: (.+)$/gm)];
    assert.ok(leaves.length >= 1, `guides/${role}.md names no file it leaves (a "### Leaves: <file>" heading)`);
    for (const m of leaves) {
      const after = text.slice(m.index + m[0].length);
      const nextHeading = after.search(/^#{1,3} /m);
      const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
      assert.ok(/^```/m.test(section), `guides/${role}.md: "${m[1]}" has no fenced shape before the next heading`);
    }
  });
}

test('every relative link in guides/ resolves', () => {
  const broken = [];
  for (const f of fs.readdirSync(GUIDES).filter((x) => x.endsWith('.md'))) {
    let fence = false;
    read(f).split('\n').forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
      if (fence) return;
      for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s#]+)(#[^)\s]*)?\)/g)) {
        if (/^[a-z]+:/i.test(m[1])) continue;
        if (!fs.existsSync(path.resolve(GUIDES, m[1]))) broken.push(`guides/${f}:${i + 1} → ${m[1]}`);
      }
    });
  }
  assert.deepStrictEqual(broken, [], `broken relative links:\n  ${broken.join('\n  ')}`);
});

for (const [skill, guides] of Object.entries(ALIASES)) {
  test(`${skill} names its guide`, () => {
    const md = fs.readFileSync(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.match(md, new RegExp(`^name: ${skill}$`, 'm'), `${skill}/SKILL.md lost its name`);
    for (const g of guides) {
      assert.ok(md.includes(`](../../guides/${g}.md`), `${skill}/SKILL.md does not link guides/${g}.md`);
    }
  });
}
