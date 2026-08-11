'use strict';
/**
 * Tests for the audit's markdown anchor-link check (audit/audit.mjs) — issue #158.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Section numbers (`§N`) are cited by number from ~20 files, and nothing checks them —
 * a renumber breaks them silently. The fix is to migrate those citations to anchor
 * links (`CONVENTIONS.md#who-holds-this`), which survive renumbering, and to add a
 * check that a referenced anchor actually resolves, so a future break is loud instead
 * of silent. This file tests only the check; the ~280-citation migration is a separate,
 * later unit (see #158's follow-up).
 *
 * The check is deliberately LINK-SHAPED ONLY: a bare `§N` in prose, or a bare
 * `FILE.md#slug` mention with no `[...](...)` around it, must never be touched — that
 * is what keeps the not-yet-migrated citations out of this check's scope.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/**
 * A tier B repo on `main` with the given files (repo-relative path -> content). Minimal
 * `.github/project.yml` so every other audit rule stays silent and a finding in the
 * result is unambiguously the anchor-link check.
 */
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-anchor-links-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  // A global `core.hooksPath` (this handbook installs one) must not run the repo's real
  // hooks inside a fixture that is not a real project — see tools/lib/orphan-worktree.test.js:107 (#108).
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.github', 'project.yml'),
    'tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n',
  );
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  return dir;
}

function audit(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    stdout = err.stdout || '';
  }
  const r = JSON.parse(stdout).results[0];
  return {
    ok: r.ok,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));

// --- happy path: real links to real headings are silent ---------------------

test('a same-file link to a real heading is clean', () => {
  const r = audit(fixture({
    'CONVENTIONS.md': '# Conventions\n\n## 5. Claiming work\n\nSee [above](#5-claiming-work).\n',
  }));
  assert.ok(!hasText(r.fails.concat(r.warns), /anchor/i), r.fails.concat(r.warns).join(' | '));
});

test('a cross-file link to a real heading in another tracked file is clean', () => {
  const r = audit(fixture({
    'CONVENTIONS.md': '# Conventions\n\n### Who holds this\n\nBody.\n',
    'skills/code-start/SKILL.md': 'See [who holds this](../../CONVENTIONS.md#who-holds-this).\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

test('a relative ../ link resolves against the linking file\'s own directory', () => {
  const r = audit(fixture({
    'CONVENTIONS.md': '# Conventions\n\n## 9. Adopting this\n\nBody.\n',
    'skills/handbook-sync/SKILL.md': 'See [adoption](../../CONVENTIONS.md#9-adopting-this).\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

// --- the failure modes the check exists to catch -----------------------------

test('a link to a nonexistent slug fails, naming the file, the anchor, and the target', () => {
  const r = audit(fixture({
    'CONVENTIONS.md': '# Conventions\n\n## 5. Claiming work\n\nBody.\n',
    'docs/x.md': 'See [claiming](../CONVENTIONS.md#4-branches-and-commits).\n',
  }));
  assert.ok(hasText(r.fails, /docs\/x\.md/), r.fails.join(' | '));
  assert.ok(hasText(r.fails, /#4-branches-and-commits/), r.fails.join(' | '));
  assert.ok(hasText(r.fails, /CONVENTIONS\.md/), r.fails.join(' | '));
});

test('a link naming a slug that does not exist lists real headings as candidates', () => {
  const r = audit(fixture({
    'CONVENTIONS.md': '# Conventions\n\n## 5. Claiming work\n\n## 4. Branches and commits\n\n',
    'docs/x.md': 'See [claiming](../CONVENTIONS.md#claiming-wrok).\n', // typo'd slug
  }));
  assert.ok(hasText(r.fails, /5-claiming-work/), r.fails.join(' | '));
});

test('candidates are ranked by edit distance, not document order (#187)', () => {
  const r = audit(fixture({
    'CONVENTIONS.md':
      '# Conventions\n\n' +
      '## 1. Overview\n\n' +
      '## 2. Getting started\n\n' +
      '## 3. Claiming work\n\n' +
      '## 4. Branches and commits\n\n' +
      '## 9. Adopting this\n\n',
    // Typo'd fragment: one letter short of the LAST heading in the document, nowhere
    // near the first four. The old check took the first five headings in document
    // order, so it would have suggested "1-overview" et al and never surfaced the
    // actual near-miss at all — this is the fixture that distinguishes the new
    // ranked-by-distance behaviour from the old first-five-in-file one (the test
    // above passes under both, since its correct answer already happens to be first).
    'docs/x.md': 'See [adoption](../CONVENTIONS.md#9-adoptng-this).\n',
  }));
  const msg = r.fails.find((t) => /does not resolve/.test(t));
  assert.ok(msg, r.fails.join(' | '));
  const listed = msg.split('nearest headings: ')[1].split(', ');
  assert.ok(listed.includes('9-adopting-this'), msg);
  // Not just present — nearest, so it must be ranked first.
  assert.strictEqual(listed[0], '9-adopting-this', msg);
});

test('a link to a file that does not exist at all fails', () => {
  const r = audit(fixture({
    'docs/x.md': 'See [ghost](../NOPE.md#somewhere).\n',
  }));
  assert.ok(hasText(r.fails, /NOPE\.md.*does not exist/), r.fails.join(' | '));
});

test('a same-file link to a nonexistent slug in a file with no headings fails plainly', () => {
  const r = audit(fixture({
    'docs/x.md': 'Just prose, no headings.\n\nSee [nowhere](#nowhere).\n',
  }));
  assert.ok(hasText(r.fails, /docs\/x\.md.*#nowhere.*no headings at all/s), r.fails.join(' | '));
});

// --- duplicate headings get GitHub's -1, -2 suffixing ------------------------

test('duplicate headings resolve with -1, -2 suffixes in document order', () => {
  const r = audit(fixture({
    'docs/x.md':
      '# Overview\n\n' +
      '## Setup\n\nFirst.\n\n' +
      '## Setup\n\nSecond.\n\n' +
      'See [first](#setup), [second](#setup-1).\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

test('the FIRST duplicate heading has no suffix; #setup-2 with only two headings fails', () => {
  const r = audit(fixture({
    'docs/x.md': '## Setup\n\n## Setup\n\nSee [third](#setup-2).\n',
  }));
  assert.ok(hasText(r.fails, /#setup-2/), r.fails.join(' | '));
});

// --- scope boundary: bare §N prose and non-.md links must be INVISIBLE -------

test('a bare §N prose citation produces no finding — the check must never touch it', () => {
  const r = audit(fixture({
    'docs/x.md': 'This is described in §5 of CONVENTIONS.md, and also §200 which does not exist.\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

test('a bare FILE.md#slug mention with no markdown-link brackets is ignored', () => {
  const r = audit(fixture({
    'docs/x.md': 'Reference: CONVENTIONS.md#nonexistent-slug (not a real link).\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

test('an external http(s) link with a fragment is ignored', () => {
  const r = audit(fixture({
    'docs/x.md': 'See [external](https://example.com/page#frag-that-does-not-exist-here).\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

// The three below are #184. The test above passes trivially — its target has no `.md`,
// so ANCHOR_LINK_RE never captures it and the scheme guard is never reached. Kept as a
// separate case rather than edited into the ones below, because it exercises a different
// branch: replacing it would leave the suite no better covered than before, and one case
// worse.

test('an external http(s) link whose target ENDS IN .md is ignored (#184)', () => {
  const r = audit(fixture({
    'docs/x.md': 'See [install](https://example.com/repo/README.md#installation).\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

test('a protocol-relative //host link ending in .md is ignored — it carries no scheme (#184)', () => {
  const r = audit(fixture({
    'docs/x.md': 'See [install](//example.com/repo/README.md#installation).\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

test('a repo-absolute /path.md#slug still resolves — the // guard must not swallow it (#184)', () => {
  const r = audit(fixture({
    'CONVENTIONS.md': '# Conventions\n\n### Who holds this\n\nBody.\n',
    'docs/x.md': 'See [holders](/CONVENTIONS.md#who-holds-this) and [gone](/CONVENTIONS.md#not-a-slug).\n',
  }));
  assert.deepStrictEqual(r.fails.length, 1, r.fails.join(' | '));
  // Message shape is "anchor #FRAGMENT does not resolve in FILE" (checkAnchorLinks's
  // `fail(...)` call, audit/audit.mjs), not "FILE#FRAGMENT" — matches the two-piece
  // assertion style the "nonexistent slug" test above already uses rather than assuming
  // a concatenated order this check has never produced.
  assert.match(r.fails[0], /#not-a-slug does not resolve in CONVENTIONS\.md/);
});

test('a mailto: link is ignored', () => {
  const r = audit(fixture({
    'docs/x.md': 'Contact [us](mailto:team@example.invalid#nope).\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

// --- a doc SHOWING link syntax as a literal example must not trip the check --

test('link syntax inside an inline code span is a literal example, not a real citation', () => {
  const r = audit(fixture({
    'docs/x.md': 'Same-file links look like `[…](#slug)`, and a bad one like `[x](#nonexistent-slug)` is just prose here.\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

test('link syntax inside a fenced code block is a literal example, not a real citation', () => {
  const r = audit(fixture({
    'docs/x.md': '```md\n[broken example](#nonexistent-slug)\n```\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});

// --- headings inside fenced code blocks are not real headings ----------------

test('a "#" inside a fenced code block is not read as a heading', () => {
  const r = audit(fixture({
    'docs/x.md': '```\n# not a real heading\n```\n\nSee [nope](#not-a-real-heading).\n',
  }));
  assert.ok(hasText(r.fails, /#not-a-real-heading/), r.fails.join(' | '));
});

// --- code-span and link text inside a heading are slugified sensibly ---------

test("a heading containing a code span and an em dash slugifies with GitHub's double hyphen", () => {
  // GitHub does not collapse the two spaces the em-dash leaves behind — "text — text"
  // becomes "text--text", not "text-text". Every real link in this repo already relies
  // on that, so a collapsing slugifier would break them all silently.
  const r = audit(fixture({
    'docs/x.md': '## `.github/project.yml` — the marker\n\nSee [marker](#githubprojectyml--the-marker).\n',
  }));
  assert.deepStrictEqual(r.fails, []);
});
