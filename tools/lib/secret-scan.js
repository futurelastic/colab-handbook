'use strict';
/**
 * #606 — the secret check `colab ship` runs on a DOCS-ONLY change before it merges.
 *
 * A docs-only change lands without waiting for CI (tools/lib/docs-only.js shipDocsOnly), so the CI
 * suite's own secret scan (gitleaks in the templates) may never see it. This is the cheap stand-in:
 * the lines the change ADDS — `git diff -U0 <base>...<branch>`, text files only (git prints no lines
 * for a binary) — matched against generic credential shapes, plus the repo's own forbidden terms
 * when it keeps a file at TERMS_PATH. Seconds, no dependency, no network.
 *
 * A finding is reported as `file:line (rule)`, never with the matched text: the refusal is printed
 * to a terminal and may be pasted onto an Issue, and a public repo's Issues are public.
 *
 * It is a backstop, not gitleaks: generic shapes only, added lines only. A shape it misses is
 * missed; nothing here claims the change is clean beyond these rules.
 */

/** The repo-local forbidden-terms file (project.schema.md "ci-docs-skip"), read at the TARGET's tip. */
const TERMS_PATH = '.github/secret-scan-terms';

/** Generic credential shapes. `test` gets one added line. */
const RULES = Object.freeze([
  { rule: 'private key', re: /-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY( BLOCK)?-----/ },
  { rule: 'AWS access key', re: /(^|[^A-Z0-9])(AKIA|ASIA)[A-Z0-9]{16}([^A-Z0-9]|$)/ },
  { rule: 'GitHub token', re: /(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { rule: 'Slack token', re: /xox[abposr]-[A-Za-z0-9-]{10,}/ },
  { rule: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { rule: 'Stripe live key', re: /(sk|rk)_live_[0-9A-Za-z]{20,}/ },
  { rule: 'LLM API key', re: /sk-(ant|proj)-[A-Za-z0-9_-]{20,}/ },
]);

/**
 * `password=…` and its kin. The value must hold a lower-case letter AND a digit, so a documented
 * placeholder (`YOUR_API_KEY`, `changeme`, `$PASSWORD`, `<secret>`, `${{ secrets.X }}`) is not a
 * finding while `password=hunter22` is.
 */
const ASSIGN = /(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*["']?([^"'\s<>{}$]{8,})/i;
function assignment(line) {
  const m = ASSIGN.exec(line);
  return !!m && /[0-9]/.test(m[2]) && /[a-z]/.test(m[2]);
}

/**
 * Parse a forbidden-terms file — the format of templates/identity-vocabulary.example: one term per
 * line, trimmed; blank and `#` lines are comments; a plain term matches case-insensitively as a
 * substring; `re:<ERE>` is a regular expression matched against the lower-cased line; a term
 * shorter than 3 characters is refused as a mistake. Returns `{ terms: [{line, test}], problems }`.
 */
function parseTerms(text) {
  const terms = [];
  const problems = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#')) return;
    const line = i + 1;
    if (t.startsWith('re:')) {
      try {
        const re = new RegExp(t.slice(3));
        terms.push({ line, test: (s) => re.test(s.toLowerCase()) });
      } catch (_) {
        problems.push(`${TERMS_PATH} line ${line} is not a valid regular expression`);
      }
      return;
    }
    if (t.length < 3) { problems.push(`${TERMS_PATH} line ${line} is shorter than 3 characters`); return; }
    const want = t.toLowerCase();
    terms.push({ line, test: (s) => s.toLowerCase().includes(want) });
  });
  return { terms, problems };
}

/**
 * The added lines of a `git diff -U0 --no-renames --no-color` patch: `[{ file, line, text }]`.
 * `line` is the line number in the new file.
 */
function addedLines(patch) {
  const out = [];
  let file = null;
  let ln = 0;
  let inHunk = false;
  for (const l of String(patch || '').split('\n')) {
    // A file header only outside a hunk: an added line `++ x` prints as `+++ x` inside one.
    if (l.startsWith('diff --git ')) { inHunk = false; file = null; continue; }
    if (!inHunk && l.startsWith('+++ ')) { const f = l.slice(4); file = f === '/dev/null' ? null : f.replace(/^b\//, ''); continue; }
    const h = /^@@ -\S+ \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { ln = Number(h[1]); inHunk = true; continue; }
    if (inHunk && l.startsWith('+') && file) { out.push({ file, line: ln, text: l.slice(1) }); ln++; }
  }
  return out;
}

/** Pure: findings `[{ file, line, rule }]` over added lines, against RULES + assignment + `terms`. */
function scanLines(lines, terms = []) {
  const findings = [];
  for (const { file, line, text } of lines) {
    for (const r of RULES) if (r.re.test(text)) findings.push({ file, line, rule: r.rule });
    if (assignment(text)) findings.push({ file, line, rule: 'credential assignment' });
    for (const t of terms) if (t.test(text)) findings.push({ file, line, rule: `forbidden term, line ${t.line} of ${TERMS_PATH}` });
  }
  return findings;
}

/**
 * Scan what `branch` adds relative to its merge base with `base`, with the forbidden terms read from
 * `base`'s tree (the branch cannot edit them and stay docs-only: `.github/` is never documentation).
 * Returns `{ ok, findings, files, reason }`; `ok: false` with no findings means the scan could not
 * run — a caller refuses on that too, it never reads it as clean.
 */
function scanBranch(git, repo, base, branch) {
  const d = git.git(['diff', '-U0', '--no-renames', '--no-color', '--no-ext-diff', `${base}...${branch}`, '--'], repo);
  if (!d.ok) return { ok: false, findings: [], reason: `could not read the diff ${base}...${branch}` };
  let terms = [];
  if (git.git(['cat-file', '-e', `${base}:${TERMS_PATH}`], repo).ok) {
    const t = git.git(['show', `${base}:${TERMS_PATH}`], repo);
    if (!t.ok) return { ok: false, findings: [], reason: `could not read ${TERMS_PATH} at ${base}` };
    const parsed = parseTerms(t.stdout);
    if (parsed.problems.length) return { ok: false, findings: [], reason: parsed.problems.join('; ') };
    terms = parsed.terms;
  }
  const lines = addedLines(d.stdout);
  const findings = scanLines(lines, terms);
  const files = new Set(lines.map((l) => l.file)).size;
  const extra = terms.length ? ` and ${terms.length} forbidden term(s)` : '';
  if (findings.length) {
    const shown = findings.slice(0, 5).map((f) => `${f.file}:${f.line} (${f.rule})`).join('; ');
    const more = findings.length > 5 ? `; +${findings.length - 5} more` : '';
    return { ok: false, findings, files, reason: `${findings.length} finding(s): ${shown}${more}` };
  }
  return { ok: true, findings, files, reason: `${lines.length} added line(s) in ${files} file(s) clean against the credential shapes${extra}` };
}

module.exports = { TERMS_PATH, RULES, parseTerms, addedLines, scanLines, scanBranch, assignment };
