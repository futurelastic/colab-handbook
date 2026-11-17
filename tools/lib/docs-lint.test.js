'use strict';
/**
 * Tests for templates/docs-lint.mjs (colab-handbook #249) — a copy-and-own,
 * zero-dependency template, not a tools/lib module. Run: `node --test
 * tools/lib/*.test.js` (the existing CI glob picks this file up).
 *
 * WHY THIS FILE LIVES HERE rather than next to the template: the same
 * reasoning as tools/lib/identity-hook.test.js for the shell hook templates —
 * `node --check templates/docs-lint.mjs` (CI's syntax-check step) proves the
 * file parses, not that any of its 14 checks fire on the right input and stay
 * quiet on the wrong one. The script is invoked as a real subprocess against
 * throwaway fixture directories, exactly like identity-hook.test.js drives
 * its shell artifacts — no new machinery needed.
 *
 * Two of these fixtures (multi-line link, backtick-wrapped literal example)
 * pin false positives that were NOT on colab-handbook #249's own hard-won
 * list — they were found piloting this script against colab-handbook's own
 * docs, which hard-wrap prose at ~90 columns. A future edit to the citation
 * scanner that regresses either one will fail loudly here rather than
 * silently reappearing on the next real pilot.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'templates', 'docs-lint.mjs');

function mkfixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-lint-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function run(dir) {
  try {
    const out = execFileSync('node', [SCRIPT, '--repo', dir, '--json'], { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (e) {
    // exit code 1 (FAIL present) still prints valid JSON to stdout
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

function findingsFor(report, checkPrefix) {
  const r = report.results.find((x) => x.name.startsWith(checkPrefix));
  assert.ok(r, `no result for check "${checkPrefix}"`);
  return r.findings;
}

test('docs-lint: clean repo (router + one linked doc) reports no findings on checks 1-6 and 9-14, exit 0', () => {
  const dir = mkfixture({
    'CLAUDE.md': '# Router\n\nSee [good](docs/good.md).\n',
    'docs/good.md': '# Good\n\n## 1. Section\nText.\n',
  });
  const report = run(dir);
  assert.equal(report.hasFail, false);
  // Checks 1-6 have real inputs here and must report nothing. Checks 7/8
  // (gotchas.d/gotchas.md) legitimately warn "does not exist — nothing to
  // check" on a repo that never adopted either surface — that WARN is the
  // check doing its job (the receipt principle: never look silent when a
  // path was never there to inspect), not a false positive to assert away.
  for (const r of report.results) {
    if (r.name.startsWith('7 ') || r.name.startsWith('8 ')) continue;
    assert.equal(r.findings.length, 0, `${r.name} should be clean: ${JSON.stringify(r.findings)}`);
  }
});

test('docs-lint: check 1 fails on a broken router link, skips placeholders and historical lines', () => {
  const dir = mkfixture({
    'CLAUDE.md':
      '# Router\n\n' +
      'See [broken](docs/missing.md).\n' +
      'Historical: [gone](docs/gone.md) — historical, kept for context.\n' +
      'Placeholder: [ph](<repo>/x.md).\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '1');
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /docs\/missing\.md.*does not exist/);
});

test('docs-lint: check 2 flags an unreferenced docs/*.md as an orphan, excludes README and gotchas.d', () => {
  const dir = mkfixture({
    'CLAUDE.md': '# Router\n',
    'docs/orphaned.md': '# Orphaned\n',
    'docs/README.md': '# Not an orphan by convention\n',
    'docs/gotchas.d/1-x.md': '# Also excluded\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '2');
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /docs\/orphaned\.md/);
});

test('docs-lint: check 3 flags an explicit "Status: draft" self-description, ignores the bare word "draft" in prose', () => {
  const dir = mkfixture({
    'docs/a.md': '# A\n\nStatus: draft\n\nBody.\n',
    'docs/b.md': '# B\n\nThis document is not a draft of anything.\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '3');
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /docs\/a\.md/);
});

test('docs-lint: check 4 warns once the router crosses the configured byte ceiling', () => {
  const dir = mkfixture({
    '.github/project.yml': 'docs_lint:\n  router_max_bytes: 100\n',
    'CLAUDE.md': '# Router\n\n' + 'x'.repeat(200) + '\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '4');
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /over the/);
});

test('docs-lint: check 5 flags an ISO-dated filename in docs/, never a plain "*-log.md" name', () => {
  const dir = mkfixture({
    'docs/2026-01-01-note.md': '# Dated\n',
    'docs/progress-log.md': '# Not dated by name\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '5');
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /2026-01-01-note\.md/);
});

test('docs-lint: check 6 resolves bare, gotchas-prefixed, and file-prefixed citations; fails on a bad bare one', () => {
  const dir = mkfixture({
    'docs/gotchas.md': '# Guide\n\n## 3. Something\nBody.\n',
    'a.md': [
      '# A',
      '',
      '## 1. First',
      'Bare self-citation: see §1 above.',
      '',
      'Cross-file: b.md §2 is the rule.',
      '',
      'gotchas §3 is documented elsewhere.',
      '',
      'Bare and broken: §99 does not exist.',
      '',
    ].join('\n'),
    'b.md': '# B\n\n## 2. Rule\nText.\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '6');
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0].message, /bare §99.*a\.md has no heading numbered 99/);
});

test('docs-lint: check 6 — a markdown link split across two physical lines is not a bare citation (regression, no Issue number)', () => {
  // This handbook hard-wraps prose at ~90 columns; a real link's `](target)`
  // routinely lands on the line AFTER its `[label`. Per-line scanning missed
  // this and produced a false FAIL against colab-handbook's own docs.
  const dir = mkfixture({
    'a.md': ['# A', '', 'See CONVENTIONS.md [§5, "The thing"](CONVENTIONS.md#the-thing)', 'more text.', ''].join('\n'),
    'CONVENTIONS.md': '# C\n\n## 5. The thing\nBody.\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '6');
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('docs-lint: check 6 — a §N entirely wrapped in its own backticks is a literal example, not a citation (regression, no Issue number)', () => {
  const dir = mkfixture({
    'a.md': '# A\n\nOld citations looked like `§5` and nothing checked them.\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '6');
  assert.equal(findings.length, 0, JSON.stringify(findings));
});

test('docs-lint: check 6 — a backtick-wrapped non-.md token before §N is reported as skipped, never guessed at', () => {
  const dir = mkfixture({
    'a.md': '# A\n\nSee `some-skill` §5.1 for the procedure.\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '6');
  assert.equal(findings.length, 0); // never fails — it is unresolvable, not broken
  const result = report.results.find((r) => r.name.startsWith('6'));
  assert.match(result.note, /1 skipped/);
});

test('docs-lint: check 6 — a BARE-NAME file citation from a nested file resolves at the repo root (#300)', () => {
  // The regression: `CONVENTIONS.md §5` written two levels down was resolved
  // against skills/x/CONVENTIONS.md — a sibling nobody ever meant — and FAILed
  // on the handbook's own trunk. A bare name is a name, not a relative path.
  const dir = mkfixture({
    'CONVENTIONS.md': '# C\n\n## 5. Readiness\nBody.\n',
    'skills/x/SKILL.md': '# X\n\nThe label is monotonic (`CONVENTIONS.md` §5, *Readiness*).\n',
  });
  const report = run(dir);
  assert.equal(findingsFor(report, '6').length, 0, JSON.stringify(findingsFor(report, '6')));
  const result = report.results.find((r) => r.name.startsWith('6'));
  assert.match(result.note, /1 by bare name at the repo root/);
});

test('docs-lint: check 6 — a sibling copy still wins over the repo root, and its missing heading is still a break (#300)', () => {
  // The root fallback must not paper over a real drift: where a same-named file
  // DOES sit next to the citing doc, that is what a reader opens, so that is
  // what gets resolved — even when the root copy would have satisfied the number.
  const dir = mkfixture({
    'CONVENTIONS.md': '# root\n\n## 5. Readiness\nBody.\n',
    'skills/x/CONVENTIONS.md': '# local\n\n## 2. Other\nBody.\n',
    'skills/x/SKILL.md': '# X\n\nSee CONVENTIONS.md §5 for the rule.\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '6');
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0].message, /skills\/x\/CONVENTIONS\.md has no heading numbered 5/);
});

test('docs-lint: check 6 — a PATH-shaped citation token gets no root fallback (#300)', () => {
  // "../CONVENTIONS.md" is a claim about a path, so a wrong one stays broken;
  // silently retrying it at the root would hide a genuinely dead relative path.
  const dir = mkfixture({
    'CONVENTIONS.md': '# C\n\n## 5. Readiness\nBody.\n',
    // ../../CONVENTIONS.md IS the root from here and must resolve; ../CONVENTIONS.md
    // is skills/CONVENTIONS.md, which does not exist and must stay broken.
    'skills/x/SKILL.md':
      '# X\n\nGood: ../../CONVENTIONS.md §5 for the rule.\n\nBad: ../CONVENTIONS.md §5 too.\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '6');
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0].message, /skills\/CONVENTIONS\.md does not exist/);
  assert.doesNotMatch(findings[0].message, /neither/);
});

test('docs-lint: check 6 — a bare name that exists NOWHERE still fails, naming both candidates (#300)', () => {
  const dir = mkfixture({
    'skills/x/SKILL.md': '# X\n\nSee CONVENTIONS.md §5 for the rule.\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '6');
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.match(findings[0].message, /neither skills\/x\/CONVENTIONS\.md nor CONVENTIONS\.md exists/);
});

test('docs-lint: check 7 flags a malformed gotchas.d filename and a duplicate issue number', () => {
  const dir = mkfixture({
    'docs/gotchas.d/not-a-number.md': '# Bad\n',
    'docs/gotchas.d/42-first.md': '# 42 first\n',
    'docs/gotchas.d/42-second.md': '# 42 second\n',
    'docs/gotchas.d/README.md': '# excluded from discipline checks\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '7');
  const fails = findings.filter((f) => f.severity === 'fail');
  const warns = findings.filter((f) => f.severity === 'warn');
  assert.equal(fails.length, 1);
  assert.match(fails[0].message, /issue #42 has 2 gotchas\.d entries/);
  assert.equal(warns.length, 1);
  assert.match(warns[0].message, /not-a-number\.md/);
});

test('docs-lint: check 8 flags a curated guide section that never links into its matching gotchas.d entry', () => {
  const dir = mkfixture({
    'docs/gotchas.d/42-thing.md': '# 42 thing\n',
    'docs/gotchas.md': '# Guide\n\n## Something about #42\nNo link to the registry at all.\n',
  });
  const report = run(dir);
  const findings = findingsFor(report, '8');
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /copied, not linked/);
});

test('docs-lint: exits 1 when any FAIL fired, 0 when only warnings (or nothing) fired', () => {
  const failDir = mkfixture({ 'CLAUDE.md': '# R\n\n[x](docs/missing.md)\n' });
  assert.throws(() => execFileSync('node', [SCRIPT, '--repo', failDir], { stdio: 'pipe' }));

  const warnDir = mkfixture({ 'CLAUDE.md': '# R\n', 'docs/orphan.md': '# O\n' });
  execFileSync('node', [SCRIPT, '--repo', warnDir], { stdio: 'pipe' }); // must not throw
});

// --- #417: CLAUDE.md as a thin shell over AGENTS.md --------------------------------
// The inline parser in templates/docs-lint.mjs mirrors tools/lib/instruction-file.js
// `parseImports`; these cases match tools/lib/instruction-file.test.js.

test('docs-lint: default router is the @-import target when CLAUDE.md is a shell (#417)', () => {
  const dir = mkfixture({ 'CLAUDE.md': '@AGENTS.md\n\n## Conventions\n', 'AGENTS.md': '# Rules\n\n- [a](docs/a.md)\n', 'docs/a.md': '# A\n' });
  const report = run(dir);
  assert.equal(report.config.router, 'AGENTS.md');
  assert.deepEqual(findingsFor(report, '1 router-integrity').filter((f) => f.level === 'fail'), []);
  assert.deepEqual(findingsFor(report, '2 orphans'), []);
});

test('docs-lint: router: config still overrides the shell default (#417)', () => {
  const dir = mkfixture({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': '# Rules\n', 'README.md': '# R\n', '.github/project.yml': 'docs_lint:\n  router: README.md\n' });
  assert.equal(run(dir).config.router, 'README.md');
});

test('docs-lint: a shell whose import is missing falls back to CLAUDE.md (#417)', () => {
  const dir = mkfixture({ 'CLAUDE.md': '@AGENTS.md\n' });
  assert.equal(run(dir).config.router, 'CLAUDE.md');
});

test('docs-lint: AGENTS.md is the router when there is no CLAUDE.md (#417)', () => {
  const dir = mkfixture({ 'AGENTS.md': '# Rules\n', 'README.md': '# R\n' });
  assert.equal(run(dir).config.router, 'AGENTS.md');
});

test('docs-lint: an @-mention in a code span, an escaping path, or user@host is not a shell import (#417)', () => {
  const dir = mkfixture({ 'CLAUDE.md': 'Use `@AGENTS.md`; mail me@AGENTS.md; @../AGENTS.md\n', 'AGENTS.md': '# Rules\n' });
  assert.equal(run(dir).config.router, 'CLAUDE.md');
});

// --- #686: the docs/ layout (checks 9-14) — one fixture per check, each WARN-only ---------

const names = (report, prefix) => findingsFor(report, prefix).map((f) => f.message);

test('docs-lint: check 9 warns on 3+ root entries with no index, and on a root entry the index never names (#686)', () => {
  const none = run(mkfixture({ 'CLAUDE.md': '# R\n', 'docs/a.md': '# A\n', 'docs/b.md': '# B\n', 'docs/adr/1-x.md': '# X\n' }));
  assert.equal(findingsFor(none, '9 ').length, 1);
  assert.match(names(none, '9 ')[0], /3 root entries and no docs\/README\.md/);
  // two entries and no index is not nagged — the same threshold handbook-sync offers the template at
  assert.deepEqual(findingsFor(run(mkfixture({ 'docs/a.md': '# A\n', 'docs/b.md': '# B\n' })), '9 '), []);

  const partial = run(mkfixture({
    'docs/README.md': '# Docs\n\n- [a](a.md)\n- `adr/` — decisions\n- [design](./design/README.md)\n',
    'docs/a.md': '# A\n', 'docs/adr/1-x.md': '# X\n', 'docs/design/README.md': '# D\n', 'docs/forgotten.md': '# F\n',
  }));
  assert.equal(partial.hasFail, false);
  assert.deepEqual(names(partial, '9 '), [
    'docs/forgotten.md is a root entry of docs/ that docs/README.md never names — add its line to the index',
  ]);
});

test('docs-lint: check 10 warns on plan/proposal/report/audit names and dated non-markdown names, never a middle word (#686)', () => {
  const report = run(mkfixture({
    'docs/migration-plan.md': '# P\n', 'docs/plans/x.md': '# X\n', 'docs/audit-2025.md': '# A\n',
    'docs/shots/2026-03-01-home.png': 'png',
    'docs/planning-model.md': '# ok\n', 'docs/adr/536-handoff-missing-plan-rationale.md': '# ok\n',
    'docs/2026-03-01-notes.md': '# check 5, not 10\n',
  }));
  const msgs = names(report, '10 ');
  assert.equal(msgs.length, 4, JSON.stringify(msgs));
  for (const f of ['docs/migration-plan.md', 'docs/plans/x.md', 'docs/audit-2025.md', 'docs/shots/2026-03-01-home.png']) {
    assert.ok(msgs.some((m) => m.startsWith(f)), `${f} not flagged: ${JSON.stringify(msgs)}`);
  }
  assert.equal(findingsFor(report, '5 ').length, 1); // the dated .md stays check 5's
});

test('docs-lint: check 11 warns on a non-kebab name once per directory, exempting README.md and _assets (#686)', () => {
  const report = run(mkfixture({
    'docs/DEPLOY.md': '# D\n', 'docs/Specs/a.md': '# A\n', 'docs/Specs/b.md': '# B\n', 'docs/my_notes.md': '# N\n',
    'docs/README.md': '# I\n', 'docs/design/_assets/inter.css': '', 'docs/gotchas.d/12-x.md': '# G\n', 'docs/a.test.md': '# T\n',
  }));
  assert.deepEqual(names(report, '11 ').map((m) => m.split(' ')[0]).sort(), ['docs/DEPLOY.md', 'docs/Specs/', 'docs/my_notes.md']);
});

test('docs-lint: check 12 warns on a loose design file and a folder not named <slug>-<N> (#686)', () => {
  const report = run(mkfixture({
    'docs/design/README.md': '# Designs\n',
    'docs/design/onboard-88/onboard-88-spec.md': '# S\n', 'docs/design/onboard-88/frames/1.png': 'png',
    'docs/design/_assets/inter.woff2': 'f',
    'docs/design/login-12-mockup.html': '<p>flat</p>', 'docs/design/123/spec.md': '# bare number\n',
  }));
  const msgs = names(report, '12 ');
  assert.equal(msgs.length, 2, JSON.stringify(msgs));
  assert.match(msgs.find((m) => m.includes('login-12')), /sits loose in docs\/design\/.*lazy migration/);
  assert.match(msgs.find((m) => m.includes('/123/')), /not named <slug>-<N>/);
});

test('docs-lint: check 13 warns on an image over 1 MB under docs/, not on a small one (#686)', () => {
  const report = run(mkfixture({ 'docs/big.png': Buffer.alloc(1024 * 1024 + 1), 'docs/small.png': Buffer.alloc(1024), 'docs/big.pdf': Buffer.alloc(2 * 1024 * 1024) }));
  const msgs = names(report, '13 ');
  assert.equal(msgs.length, 1, JSON.stringify(msgs));
  assert.match(msgs[0], /^docs\/big\.png is 1\.0 MB/);
});

test('docs-lint: check 14 warns on a font inside a design folder, never in _assets/ (#686)', () => {
  const report = run(mkfixture({
    'docs/design/onboard-88/fonts/inter.woff2': 'f', 'docs/design/onboard-88/Inter.TTF': 'f',
    'docs/design/_assets/fonts/inter.woff2': 'f', 'docs/fonts/outside-design.woff2': 'f',
  }));
  assert.deepEqual(names(report, '14 ').map((m) => m.split(' ')[0]).sort(), ['docs/design/onboard-88/Inter.TTF', 'docs/design/onboard-88/fonts/inter.woff2']);
});

test('docs-lint: the layout checks only warn — a repo with every layout finding still exits 0 (#686)', () => {
  const dir = mkfixture({
    'docs/a.md': '# A\n', 'docs/b.md': '# B\n', 'docs/q3-report.md': '# R\n', 'docs/UPPER.md': '# U\n',
    'docs/design/x-mockup.html': '', 'docs/design/x-1/x.woff': 'f', 'docs/huge.jpg': Buffer.alloc(1024 * 1024 + 1),
  });
  const report = run(dir);
  for (const p of ['9 ', '10 ', '11 ', '12 ', '13 ', '14 ']) {
    const fs_ = findingsFor(report, p);
    assert.ok(fs_.length > 0, `check ${p} should fire`);
    assert.ok(fs_.every((f) => f.severity === 'warn'), `check ${p} must be WARN only`);
  }
  execFileSync('node', [SCRIPT, '--repo', dir], { stdio: 'pipe' }); // must not throw
});
