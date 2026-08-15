'use strict';
/**
 * The identity vocabulary: where it comes from, how it parses, how a string is matched
 * against it, and how a match is reported without republishing what it matched.
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM THE HOOK. #228 has two scanners, and they cannot be
 * one program. The pre-commit scan (`templates/pre-commit-identity`) is a template: it is
 * copied into repos that have no Node, no `tools/lib/`, and no relationship to this checkout
 * beyond a file somebody once copied — so it must be self-contained POSIX `sh`, exactly like
 * `templates/pre-push-guard`. The metadata scan runs inside `audit/audit.mjs`, which sweeps
 * many repos across owners and already speaks `gh`. Two runtimes, forced by the delivery
 * model, not by preference.
 *
 * This repo's standing objection to two implementations of one rule is answered the only
 * honest way available: the SEMANTICS live here, and `tools/lib/identity.test.js` runs a
 * conformance table through BOTH — the shell script in file mode and the functions below —
 * asserting they reach the same verdict on the same vocabulary. If a future session changes
 * a matching rule in one, that test fails until the other moves too.
 *
 * ⚠ Nothing here ever holds a real vocabulary. Every function takes one by path or by text
 * supplied by the caller; a list of the strings an organisation considers sensitive is a
 * precise index of what to look for, so it lives outside every repo (CONVENTIONS.md §9).
 *
 * CommonJS, and in tools/lib/ rather than audit/, for the reason every shared reading in
 * this directory carries: `install.sh` freezes `tools/colab` + `tools/lib/` and nothing under
 * `audit/`, and the audit consumes CJS through `createRequire`.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/** A term shorter than this matches nearly everything; it is a mistake, not a term. */
const MIN_TERM_LENGTH = 3;

/** The machine-wide default file name, alongside the (equally private) fleet registry. */
const DEFAULT_VOCABULARY_NAME = 'identity-vocabulary';

/**
 * Where the vocabulary comes from, first hit wins:
 *   1. COLAB_IDENTITY_VOCAB                       explicit, per invocation
 *   2. git config colab.identityVocabulary        explicit, per clone — caller supplies the
 *                                                 value, since only a single-repo caller has
 *                                                 one repo to read it from. The audit sweeps
 *                                                 many repos at once and passes null here on
 *                                                 purpose: a per-repo setting cannot answer a
 *                                                 fleet-wide question, and silently using the
 *                                                 first repo's would be worse than not asking.
 *   3. ${COLAB_HOME:-~/.colab}/identity-vocabulary the machine-wide default
 *
 * Returns { path, source, explicit }. `explicit` drives the fail direction: an explicitly
 * configured vocabulary that cannot be read is a check that was configured and did not run
 * (refuse), while an absent default is a machine that has none configured (say so, carry on).
 * Never touches the filesystem — resolution and existence are separate questions.
 */
function resolveVocabularyPath({ env = process.env, gitConfig = null, home = os.homedir() } = {}) {
  const fromEnv = (env.COLAB_IDENTITY_VOCAB || '').trim();
  if (fromEnv) return { path: expandTilde(fromEnv, home), source: 'COLAB_IDENTITY_VOCAB', explicit: true };

  const fromGit = (gitConfig || '').trim();
  if (fromGit) return { path: expandTilde(fromGit, home), source: 'git config colab.identityVocabulary', explicit: true };

  const colabHome = (env.COLAB_HOME || '').trim() || path.join(home, '.colab');
  return { path: path.join(colabHome, DEFAULT_VOCABULARY_NAME), source: 'default', explicit: false };
}

// `~` is not expanded inside an environment variable or a git config value.
function expandTilde(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

/**
 * Parse vocabulary text into { terms, problems }.
 *
 * One term per line. Surrounding whitespace is ignored. A line whose first non-space
 * character is `#` is a comment, and so is a blank line — comments are WHOLE-LINE only, so a
 * `#` inside a term is part of the term. A leading `re:` marks an extended regular
 * expression; anything else is a fixed string.
 *
 * `entry` is the 1-based LINE NUMBER in the operator's file, not an index into `terms`:
 * every message about a term names it that way, and the operator owns that file, so a line
 * number is the one identifier that is both actionable for them and meaningless to anyone
 * reading a log over their shoulder.
 *
 * A problem is not a term that failed to match — it is a term that cannot be applied at all
 * (too short, or an invalid regex). Callers must treat problems as "this check did not run".
 */
function parseVocabulary(text) {
  const terms = [];
  const problems = [];
  const lines = String(text == null ? '' : text).split('\n');

  lines.forEach((raw, i) => {
    const entry = i + 1;
    let line = raw.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#')) return;

    let kind = 'fixed';
    if (line.slice(0, 3) === 're:') {
      kind = 'regex';
      line = line.slice(3).replace(/^[ \t]+/, '');
    }
    if (line === '') return;
    line = line.replace(/\t/g, ' '); // tab separates the fields of the hook's own record format

    if (line.length < MIN_TERM_LENGTH) {
      problems.push({ entry, message: `entry ${entry} is only ${line.length} character(s) — too short to be a term (minimum ${MIN_TERM_LENGTH})` });
      return;
    }
    if (kind === 'regex') {
      try {
        // Lower-cased, matched against a lower-cased subject — the same shape the shell
        // scanner uses (awk has no case-insensitive flag, so both sides are folded instead).
        new RegExp(line.toLowerCase());
      } catch (_) {
        problems.push({ entry, message: `entry ${entry} is not a valid regular expression` });
        return;
      }
    }
    terms.push({ entry, kind, value: line, chars: line.length });
  });

  return { terms, problems };
}

/** Read + parse a vocabulary file. Returns null when the file cannot be read at all. */
function loadVocabulary(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null;
  }
  return parseVocabulary(text);
}

/**
 * Match `records` — [{ location, text }] — against `terms`. Case-insensitive and by
 * SUBSTRING for a fixed term, deliberately: a hostname or a handle appears inside URLs,
 * paths and identifiers with no word boundary near it, and over-blocking has a one-command
 * override while under-blocking has none.
 *
 * Returns [{ entry, kind, chars, location, value }] — `value` is carried so a caller that has
 * been asked to unredact can, and so that nothing else has to go back to the vocabulary.
 */
function scan(records, terms) {
  const hits = [];
  for (const rec of records) {
    const text = String(rec.text == null ? '' : rec.text).toLowerCase();
    if (!text) continue;
    for (const t of terms) {
      const matched = t.kind === 'regex'
        ? new RegExp(t.value.toLowerCase()).test(text)
        : text.includes(t.value.toLowerCase());
      if (matched) hits.push({ entry: t.entry, kind: t.kind, chars: t.chars, location: rec.location, value: t.value });
    }
  }
  // By entry, then by location — stable output for a report that a human diffs between runs.
  hits.sort((a, b) => (a.entry - b.entry) || String(a.location).localeCompare(String(b.location)));
  return hits;
}

/**
 * One line about a hit, REDACTED unless explicitly told otherwise.
 *
 * The matched text is the thing that must not be published; a report, a terminal and a CI log
 * are all places it would then live, and the audit's --json output is routinely pasted
 * elsewhere. The entry number plus the length is enough for the person who owns the
 * vocabulary and useless to anybody else.
 */
function describeHit(hit, { show = false } = {}) {
  return show
    ? `${hit.location} — vocabulary entry ${hit.entry}: ${hit.value}`
    : `${hit.location} — vocabulary entry ${hit.entry} (${hit.chars} chars, redacted)`;
}

module.exports = {
  MIN_TERM_LENGTH,
  DEFAULT_VOCABULARY_NAME,
  resolveVocabularyPath,
  parseVocabulary,
  loadVocabulary,
  scan,
  describeHit,
};
