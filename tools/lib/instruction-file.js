'use strict';
/**
 * The repo's instruction file, and what an agent actually loads from it (#417).
 *
 * Two files can carry a repo's agent instructions: `AGENTS.md`, which most agent tools read,
 * and `CLAUDE.md`, which one tool reads by name. The shape this handbook documents
 * (CONVENTIONS.md §9 step 5) is:
 *
 *   - repo prose lives in `AGENTS.md`;
 *   - `CLAUDE.md` is a thin shell: an `@AGENTS.md` import plus the blocks tools look up
 *     in `CLAUDE.md` BY NAME (this handbook's Conventions block with its stamp, and any
 *     other tool-managed block);
 *   - no block lives in both files.
 *
 * So three questions get three different answers, and every consumer has to ask the right one:
 *
 *   | question                                   | answer                                   |
 *   |--------------------------------------------|------------------------------------------|
 *   | where are the repo's rules written?        | `authoredRouter()` — AGENTS.md, else CLAUDE.md |
 *   | what is loaded into every session (cost)?  | `collectLoaded()` — CLAUDE.md + every in-repo @-import |
 *   | where do by-name tool blocks live?         | always `CLAUDE.md` (stamp.js, `colab update`) |
 *
 * Import resolution mirrors the loader's own rules, narrowed to what a repo is accountable for:
 *
 *   - an import is an `@<path>` token at the start of a line or after whitespace (so
 *     `user@example.md` is not one); trailing `),;:!?` and one trailing `.` are stripped;
 *   - tokens inside fenced code blocks and inline code spans are ignored (a `@me` in a
 *     `gh issue edit --add-assignee @me` example is not an import);
 *   - paths are relative to the IMPORTING file;
 *   - in-repo only: an absolute path, a `~` path, a drive letter, or anything that normalizes
 *     outside the repo is rejected and recorded, never followed — a per-user import is that
 *     user's cost, not the repo's;
 *   - recursive to depth IMPORT_MAX_DEPTH (the entry file is depth 0); deeper is `truncated`;
 *   - cycle-safe: each file is read and counted once;
 *   - a missing target is recorded, not an error — prose like `@types/node` is common.
 *
 * Pure: every read goes through the caller's `readFile(relPath) -> string|null`, so the
 * audit's local and remote sources both work. No dependencies.
 *
 * `templates/docs-lint.mjs` is copy-and-own and cannot require this module; it carries a
 * one-level inline copy of `parseImports` that must stay in step with this one (both have
 * tests on the same cases).
 */

const path = require('path');

const IMPORT_MAX_DEPTH = 5;
const SHELL_IMPORT = '@AGENTS.md';
const ENTRY = 'CLAUDE.md';
const AUTHORED = 'AGENTS.md';

const escapeRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** Every line with fenced-block content and inline code spans blanked (line numbers kept). */
function stripCode(text) {
  const out = [];
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(FENCE_RE);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      out.push('');
      continue;
    }
    if (m) { fence = m[1]; out.push(''); continue; }
    // Inline code spans: a run of N backticks closes at the next run of exactly N.
    out.push(line.replace(/(`+)[\s\S]*?\1/g, (s) => ' '.repeat(s.length)));
  }
  return out;
}

const TOKEN_RE = /(^|\s)@([^\s]+)/g;

/** `[{ raw, line }]` — every import token, in order. `line` is 1-based. */
function parseImports(text) {
  const found = [];
  stripCode(text).forEach((line, i) => {
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(line)) !== null) {
      let raw = m[2].replace(/[),;:!?]+$/, '').replace(/\.$/, '');
      if (raw) found.push({ raw, line: i + 1 });
    }
  });
  return found;
}

/** `{ path }` (repo-relative, posix) or `{ rejected: 'absolute'|'home'|'escapes' }`. */
function resolveImport(fromRel, raw) {
  if (raw.startsWith('~')) return { rejected: 'home' };
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(raw)) return { rejected: 'absolute' };
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), raw.replace(/\\/g, '/')));
  if (joined === '..' || joined.startsWith('../') || joined === '.') return { rejected: 'escapes' };
  return { path: joined };
}

/**
 * What the loader pulls in when it reads `entry`: `{ files, rejected, missing, truncated }`.
 * `files` is depth-first in import order, entry first: `[{ path, text, depth, from }]`.
 * A missing entry yields `files: []`.
 */
function collectLoaded(readFile, entry = ENTRY, { maxDepth = IMPORT_MAX_DEPTH } = {}) {
  const files = [];
  const rejected = [];
  const missing = [];
  const truncated = [];
  const seen = new Set();
  const visit = (rel, depth, from) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const text = readFile(rel);
    if (text === null || text === undefined) {
      if (from !== null) missing.push({ path: rel, from });
      return;
    }
    files.push({ path: rel, text, depth, from });
    for (const { raw } of parseImports(text)) {
      const r = resolveImport(rel, raw);
      if (r.rejected) { rejected.push({ raw, from: rel, reason: r.rejected }); continue; }
      if (depth + 1 > maxDepth) { if (!seen.has(r.path)) truncated.push({ path: r.path, from: rel }); continue; }
      visit(r.path, depth + 1, rel);
    }
  };
  visit(entry, 0, null);
  return { files, rejected, missing, truncated };
}

/** In-repo imports of `CLAUDE.md` that exist, in order (one level). */
function existingImports(readFile, entry = ENTRY) {
  const text = readFile(entry);
  if (text === null || text === undefined) return [];
  const out = [];
  for (const { raw } of parseImports(text)) {
    const r = resolveImport(entry, raw);
    if (r.path && !out.includes(r.path) && readFile(r.path) !== null && readFile(r.path) !== undefined) out.push(r.path);
  }
  return out;
}

/**
 * Where the repo's rules are WRITTEN: the first existing in-repo import of `CLAUDE.md` (the
 * shell case), else `CLAUDE.md`, else `AGENTS.md`, else null.
 */
function authoredRouter(readFile) {
  const imports = existingImports(readFile);
  if (imports.length) return imports[0];
  if (readFile(ENTRY) !== null && readFile(ENTRY) !== undefined) return ENTRY;
  if (readFile(AUTHORED) !== null && readFile(AUTHORED) !== undefined) return AUTHORED;
  return null;
}

/**
 * Tool-written blocks, detected by their open/close tags. Only a properly paired block
 * counts. Kept deliberately small: the generic BEGIN/END row covers any generator using that
 * convention (one framework writes `<!-- BEGIN:nextjs-agent-rules -->` … `<!-- END:… -->`),
 * so a new row is only for a tool with a different syntax, and only with a real sample.
 */
const TOOL_BLOCKS = [
  { id: 'laravel-boost', open: /^\s*<laravel-boost-guidelines>\s*$/, close: /^\s*<\/laravel-boost-guidelines>\s*$/ },
  { id: 'begin-end', open: /^\s*<!--\s*BEGIN:(\S+)\s*-->\s*$/, close: (name) => new RegExp(`^\\s*<!--\\s*END:${escapeRe(name)}\\s*-->\\s*$`) },
  // #419: `<!-- <name>:start … -->` … `<!-- <name>:end -->` — a UI package writes its workflow block
  // this way, with a trailing note on the open line (`(managed by … — edit … instead)`); the
  // colab:derived span (#117) has the same shape. The name is everything before the LAST `:start`.
  { id: 'start-end', open: /^\s*<!--\s*(\S+?):start(?:\s.*)?-->\s*$/, close: (name) => new RegExp(`^\\s*<!--\\s*${escapeRe(name)}:end(?:\\s.*)?-->\\s*$`) },
];

/** `[{ id, startLine, endLine }]` for every paired tool block in `text`. */
function findToolBlocks(text) {
  const lines = String(text).split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    for (const row of TOOL_BLOCKS) {
      const m = lines[i].match(row.open);
      if (!m) continue;
      const id = row.id === 'laravel-boost' ? row.id : m[1];
      const close = typeof row.close === 'function' ? row.close(m[1]) : row.close;
      for (let j = i + 1; j < lines.length; j++) {
        if (close.test(lines[j])) { found.push({ id, startLine: i + 1, endLine: j + 1 }); i = j; break; }
      }
      break;
    }
  }
  return found;
}

/** `[{ id, paths }]` — every tool block id present in more than one of `files` (`[{ path, text }]`). */
function duplicateToolBlocks(files) {
  const where = new Map();
  for (const f of files) {
    for (const b of findToolBlocks(f.text)) {
      if (!where.has(b.id)) where.set(b.id, []);
      const list = where.get(b.id);
      if (!list.includes(f.path)) list.push(f.path);
    }
  }
  return [...where].filter(([, paths]) => paths.length > 1).map(([id, paths]) => ({ id, paths }));
}

/** Does `text` (a CLAUDE.md) import AGENTS.md — i.e. is it the thin-shell shape? */
function isThinShell(text) {
  return parseImports(text).some((i) => i.raw === AUTHORED || i.raw === './' + AUTHORED);
}

/**
 * The handbook's Conventions block in a CLAUDE.md: `{ startLine, endLine }` (1-based, inclusive)
 * or null. It has no close tag, so its extent is structural: it opens at the `## Conventions`-style
 * level-2+ heading directly above its stamp (or at the stamp — or, unstamped, the template's
 * "This repo follows the [colab-handbook]" sentence — when there is no such heading) and runs
 * to the line before the next heading of the same or a higher level, else to EOF. A repo that appended its own bullets to the block keeps them inside it — those are
 * the block's to carry.
 */
const STAMP_RE = /<!--\s*colab-handbook\s*@/;
const FOLLOWS_RE = /^\s*This repo follows the \[colab-handbook\]/; // the template's own sentence, not any mention
const HEADING_RE = /^(#{1,6})\s/;
function conventionsBlock(text) {
  const lines = String(text).split(/\r?\n/);
  const code = stripCode(text);
  let anchor = lines.findIndex((l) => STAMP_RE.test(l));
  if (anchor < 0) anchor = code.findIndex((l) => FOLLOWS_RE.test(l));
  if (anchor < 0) return null;
  let start = anchor;
  let level = 7; // no heading: the block ends at the next heading of any level
  for (let i = anchor - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const h = code[i].match(HEADING_RE);
    if (h && h[1].length >= 2) { start = i; level = h[1].length; } // a level-1 heading is the file's title
    break; // only the nearest non-blank line above may be the block's heading
  }
  let end = lines.length - 1;
  for (let i = anchor + 1; i < lines.length; i++) {
    const h = code[i].match(HEADING_RE);
    if (h && h[1].length <= level) { end = i - 1; break; }
  }
  while (end > anchor && !lines[end].trim()) end--;
  return { startLine: start + 1, endLine: end + 1 };
}

/**
 * Lines of a CLAUDE.md that the thin-shell shape does not allow (#419): `[lineNo]`, 1-based.
 * Allowed: blank lines, lines made only of @-import tokens, paired tool blocks (TOOL_BLOCKS), and
 * the Conventions block. Everything else is repo prose, which belongs in AGENTS.md.
 */
function shellResidue(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const allowed = new Set();
  const cover = (a, b) => { for (let n = a; n <= b; n++) allowed.add(n); };
  for (const b of findToolBlocks(text)) cover(b.startLine, b.endLine);
  const conv = conventionsBlock(text);
  if (conv) cover(conv.startLine, conv.endLine);
  const out = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    if (allowed.has(n) || !line.trim()) return;
    if (line.trim().split(/\s+/).every((tok) => /^@\S+$/.test(tok))) return;
    out.push(n);
  });
  return out;
}

/**
 * `[3,4,5,9]` → `"3-5, 9"`. With `text`, a run also spans lines that are blank in it, so prose
 * paragraphs separated by empty lines read as one range (`1-249`, not forty fragments).
 */
function lineRanges(nums, text = null) {
  const lines = text === null ? null : String(text).split(/\r?\n/);
  const bridges = (a, b) => {
    if (b === a + 1) return true;
    if (!lines) return false;
    for (let n = a + 1; n < b; n++) if ((lines[n - 1] || '').trim()) return false;
    return true;
  };
  const parts = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && bridges(nums[j], nums[j + 1])) j++;
    parts.push(j > i ? `${nums[i]}-${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return parts.join(', ');
}

module.exports = {
  stripCode,
  IMPORT_MAX_DEPTH,
  SHELL_IMPORT,
  ENTRY,
  AUTHORED,
  parseImports,
  resolveImport,
  collectLoaded,
  existingImports,
  authoredRouter,
  TOOL_BLOCKS,
  findToolBlocks,
  duplicateToolBlocks,
  isThinShell,
  conventionsBlock,
  shellResidue,
  lineRanges,
};
