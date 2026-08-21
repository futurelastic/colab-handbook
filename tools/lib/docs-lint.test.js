'use strict';
/**
 * Tests for templates/docs-lint.mjs (colab-handbook #249) — a copy-and-own,
 * zero-dependency template, not a tools/lib module. Run: `node --test
 * tools/lib/*.test.js` (the existing CI glob picks this file up).
 *
 * WHY THIS FILE LIVES HERE rather than next to the template: the same
 * reasoning as tools/lib/identity-hook.test.js for the shell hook templates —
 * `node --check templates/docs-lint.mjs` (CI's syntax-check step) proves the
 * file parses, not that any of its 8 checks fire on the right input and stay
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

test('docs-lint: clean repo (router + one linked doc) reports no findings on checks 1-6, exit 0', () => {
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
    if (r.name.startsWith('7') || r.name.startsWith('8')) continue;
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
