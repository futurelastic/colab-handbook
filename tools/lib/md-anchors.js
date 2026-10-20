'use strict';
// md-anchors — the heading-to-anchor slugs a markdown link or an inventory `dest#anchor` resolves
// against. Moved out of audit/audit.mjs (#158) by #632 so the audit and
// scripts/check-rule-inventory.mjs share one slugifier.

// Minimal GitHub-compatible heading→anchor slugifier (#158). GitHub's real algorithm is
// unpublished; this is deliberately the common-case subset, calibrated against the 47
// anchor links already live in this repo (CLAUDE.md, CONVENTIONS.md, README*.md,
// project.schema.md, skills/handbook-sync/SKILL.md, tools/README.md) — every one of
// them resolves under it. Not a general markdown-heading parser: it does not need to be,
// because the only headings it is ever asked to slugify are the ones already governing
// the links this check exists to validate.
function slugifyHeading(text) {
  return text
    .replace(/`([^`]*)`/g, "$1") // code spans contribute their literal text, not backticks
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) contributes only the text
    .trim()
    .replace(/#+$/, "") // a trailing "##" some repos use to mark a self-anchor
    .toLowerCase()
    // strip punctuation, keep Unicode letters/digits, underscore, hyphens/spaces -- NOT
    // collapsed. `\w` is ASCII-only ([A-Za-z0-9_]); GitHub's real slugifier keeps Unicode
    // letters (Vietnamese, Japanese, accented Latin, ...), so `\w` alone silently deleted
    // them and produced a slug GitHub never renders (#280). `\p{L}`/`\p{N}` (with the `/u`
    // flag) widen letter/digit matching to Unicode while `_` stays its own explicit member
    // of the class -- it must NOT be folded into `\p{L}`/`\p{N}`, because the very next
    // step below (`.replace(/[ _]/g, "-")`) turns underscores into hyphens and needs them
    // to survive this line to do it; the issue's own one-line suggestion dropped `_` from
    // the class and would have silently broken every underscored heading slug.
    .replace(/[^\p{L}\p{N}_\- ]+/gu, "")
    .trim()
    // Each space/underscore becomes its OWN hyphen -- never collapsed. GitHub does not
    // merge runs: a heading like "tier -- required" strips the em-dash but keeps both
    // spaces around where it was, producing "tier--required" (double hyphen), and every
    // link already written against a real heading in this repo is punctuated that way.
    // Collapsing here silently breaks every one of them.
    .replace(/[ _]/g, "-");
}

// Every heading in `text`, in document order, mapped to its resolved slug — including
// GitHub's duplicate-slug suffixing (`-1`, `-2`, … in heading order, not alphabetical).
// Fenced code blocks are skipped so a `#` inside a code sample is never read as a heading.
function collectHeadingSlugs(text) {
  const slugs = new Set();
  const seen = new Map(); // base slug -> next suffix to try
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const base = slugifyHeading(m[1]);
    if (!base) continue;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
}

module.exports = { slugifyHeading, collectHeadingSlugs };
