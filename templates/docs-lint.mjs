#!/usr/bin/env node
// docs-lint — TEMPLATE. Copy me into your repo (e.g. `tools/docs-lint.mjs`) and
// OWN it, exactly like the CI workflow templates in this directory (see
// templates/README.md — "these are NOT called remotely"). Nothing here calls
// back to the handbook, and nothing here updates itself.
//
// WHAT THIS CHECKS: the STRUCTURE of a repo's doc graph — the conventions this
// handbook already defines (CLAUDE.md as router, `docs/` as current truth,
// `log/` as dated archive, `docs/gotchas.d/` as the append-only one-file-per-
// gotcha registry, `templates/gotchas-d-README.md`) — so human attention goes
// to whether docs are TRUE, not whether their references resolve. It cannot
// know whether a gotcha is still true; that stays with `code-wrap`'s stale-docs
// step and a human hygiene pass. This split is deliberate (colab-handbook #249).
//
// ZERO DEPENDENCIES. Plain Node (>= 18), no npm install, no package.json needed
// to run it — only `node:fs`, `node:path`, (for the receipt hashes below) the
// builtin `node:crypto`, and `node:child_process` to shell out to `git
// check-ignore` once per run (see the git-ignore false-positive rule below).
// It never calls the network, and a repo with no git — or no `git` binary —
// still lints, it just filters nothing.
//
// Usage:
//   node docs-lint.mjs                 lint the current directory as repo root
//   node docs-lint.mjs --repo <path>   lint a different repo root
//   node docs-lint.mjs --json          machine-readable output (same findings)
//
// Exit code: 1 if any FAIL-severity finding fired, 0 otherwise. WARN never
// fails the process by itself — this script is advisory by design (see the
// Rollout note in #249); a repo that wants to promote a specific check to a
// hard gate does so in its OWN copy, by changing that check's severity, never
// by editing this header's contract silently.
//
// Config (all optional — .github/project.yml):
//   docs_lint:
//     router: CLAUDE.md          # default: CLAUDE.md if present, else README.md
//     docs_dir: docs
//     log_dir: log
//     gotchas_dir: docs/gotchas.d
//     gotchas_file: docs/gotchas.md      # the curated, hand-maintained guide (optional)
//     router_max_bytes: 40960            # 40 KB — same advisory ceiling audit.mjs uses (#64)
// Omitting the whole `docs_lint:` block is the common case; every default above
// mirrors the plain-prose convention this handbook already states elsewhere.
//
// HARD-WON FALSE-POSITIVE RULES (baked in from day one — colab-handbook #249,
// carried over from a memory-home pilot that needed 6 fixes in its first day):
//   - `.sync/`-style mirror copies (Resilio Sync, etc.) are never enumerated —
//     a synced duplicate of a real doc is not an "orphan" or a "dead path".
//   - a repo may use README.md as its router instead of CLAUDE.md.
//   - `*-log.md`-named files are not "dated files" by name alone — only a
//     literal `YYYY-MM-DD` substring in the filename counts (see check 5).
//   - a link target containing `...`, `<...>`, or `{...}` is a template
//     placeholder, not a dead path, and is never flagged (check 1).
//   - a line whose text contains the word "historical" is read as self-marking
//     that its own links may point at things that no longer exist on purpose,
//     and is skipped (check 1).
//   - §-numbers are per-DOCUMENT, and even within one document the same number
//     may legitimately label more than one heading (this handbook's own
//     docs/rule-inventory.md repeats "## §5 — …" a dozen times as a topic
//     grouping) — so a citation check is existence ("does N appear at all"),
//     never uniqueness (check 6).
//   - a `§N` immediately preceded by a backtick-wrapped, non-`.md` token (e.g.
//     `` `code-triage` §5.1 ``) names an external artifact this script cannot
//     generically resolve (a skill directory, a command) — it is reported as
//     SKIPPED, never guessed at and never silently miscounted as broken
//     (check 6; see the long comment at CITATION_CONTEXT below for why).
//   - a git-IGNORED markdown file is not part of the doc graph and is never
//     enumerated by any check. Scratch that never ships must not be able to
//     fail a structural check on the repo — and it was: `.claude/plans/
//     issue-<N>.md`, the git-excluded, `code-ship`-deleted plan file that
//     `code-start` writes, contributed 7 of one control run's 10 check-6
//     failures purely by quoting `§4` in prose, which made the repo lint clean
//     or dirty depending on who happened to have a session open
//     (colab-handbook #310, #313). The filter asks `git check-ignore`, not a
//     hard-coded `.claude/` path, so every adopter's own scratch convention is
//     covered by the same rule. Untracked-but-NOT-ignored files are still
//     linted on purpose: a doc you are about to commit is exactly when you
//     want the feedback. Tracked files are never treated as ignored, even when
//     they match a pattern — that is `git check-ignore`'s own default.
//   - every check reports how much it actually read (files, bytes) alongside
//     its verdict — an all-clear on zero bytes read (a missing directory, a
//     misconfigured path) must never print identically to an all-clear that
//     inspected real content. See `receipt()` below.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// CLI + config
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { repo: ".", json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") out.repo = argv[++i] ?? ".";
    else if (a.startsWith("--repo=")) out.repo = a.slice("--repo=".length);
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const HELP = `docs-lint — structural lint for a repo's doc graph (colab-handbook copy-and-own template)

Usage:
  node docs-lint.mjs [--repo <path>] [--json]

Exit code 1 iff any FAIL-severity finding fired; WARN never fails the process.`;

// Minimal, deliberately narrow reader for the OPTIONAL `docs_lint:` block in
// .github/project.yml. This is NOT a general YAML parser — it reads exactly
// one flat block of `key: value` scalar pairs, indented under `docs_lint:`,
// which is all this script's config ever needs. A repo whose project.yml uses
// anything richer than that under this key gets those extra keys ignored, not
// misparsed — the parser only ever looks for a run of two-space-or-more
// indented `key: value` lines directly under the block header.
function readDocsLintConfigBlock(repoRoot) {
  const text = readFileSafeText(join(repoRoot, ".github/project.yml"));
  if (text === null) return {};
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^docs_lint:\s*(#.*)?$/.test(l));
  if (start === -1) return {};
  const cfg = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || /^\s*#/.test(line)) continue; // blank / full-line comment
    if (!/^\s{2,}\S/.test(line)) break; // dedented back to column 0/1 — block ended
    const m = line.match(/^\s+([A-Za-z_]+):\s*(.+?)\s*(#.*)?$/);
    if (!m) continue;
    let val = m[2].trim();
    val = val.replace(/^["']|["']$/g, ""); // strip a wrapping quote pair, if any
    cfg[m[1]] = val;
  }
  return cfg;
}

function buildConfig(repoRoot) {
  const block = readDocsLintConfigBlock(repoRoot);
  const hasClaude = existsSync(join(repoRoot, "CLAUDE.md"));
  const hasReadme = existsSync(join(repoRoot, "README.md"));
  const defaultRouter = block.router ?? (hasClaude ? "CLAUDE.md" : hasReadme ? "README.md" : null);
  return {
    router: defaultRouter,
    docsDir: block.docs_dir ?? "docs",
    logDir: block.log_dir ?? "log",
    gotchasDir: block.gotchas_dir ?? "docs/gotchas.d",
    gotchasFile: block.gotchas_file ?? "docs/gotchas.md",
    routerMaxBytes: Number(block.router_max_bytes ?? 40 * 1024) || 40 * 1024,
  };
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

// Directory-name substrings that mean "not a real doc I should enumerate" —
// the ".sync/" false-positive rule generalised to every mirror-sync tool this
// fleet has actually used, plus the ordinary VCS/dependency noise.
const SKIP_DIR_RE = /(^|[\\/])(\.git|\.sync|node_modules|\.worktrees|vendor)([\\/]|$)/;

function readFileSafeText(absPath) {
  try {
    return readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

// Walks `root` for every `*.md` file, returning paths relative to `root` with
// forward slashes (so messages read the same on every OS). Skips SKIP_DIR_RE.
function walkMarkdownFiles(root) {
  const out = [];
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel === "" ? root : join(root, rel);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const childAbs = join(root, childRel);
      if (SKIP_DIR_RE.test(`/${childRel}/`)) continue;
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        out.push(childRel.split(sep).join("/"));
      }
    }
  }
  return out.sort();
}

// Git-ignore filter. A file git ignores is not part of the repo's doc graph:
// it is scratch, it never ships, and `code-ship` may delete it mid-run — so no
// check may enumerate it (colab-handbook #310). Answered by `git check-ignore`
// in ONE batched call per enumeration, cached across checks, because asking per
// file is a process spawn per file.
//
// Two properties of `check-ignore` this relies on, both its documented default:
// a TRACKED file is never reported as ignored (even if a pattern matches it —
// that needs `--no-index`), and exit 1 means "nothing matched", which is a
// successful answer, not an error. Anything else — no `git` on PATH, or "not a
// git repository" (128) — means this filter cannot answer at all, and it then
// filters NOTHING and every check behaves exactly as it did before this
// existed. Degrading to the old behaviour is the only safe direction: silently
// skipping files because git was unavailable would turn a lint into a lie.
function makeIgnoreFilter(repoRoot) {
  const cache = new Map(); // repo-relative path -> true when git ignores it
  let available = true;

  const learn = (paths) => {
    const unknown = paths.filter((p) => !cache.has(p));
    if (!available || unknown.length === 0) return;
    const res = spawnSync("git", ["-C", repoRoot, "check-ignore", "--stdin", "-z"], {
      input: unknown.join("\0"),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error || (res.status !== 0 && res.status !== 1)) {
      available = false;
      return;
    }
    const ignored = new Set((res.stdout ?? "").split("\0").filter(Boolean));
    for (const p of unknown) cache.set(p, ignored.has(p));
  };

  return (paths) => {
    learn(paths);
    const kept = [];
    let ignored = 0;
    for (const p of paths) {
      if (cache.get(p) === true) ignored++;
      else kept.push(p);
    }
    return { files: kept, ignored };
  };
}

// Repo-relative markdown enumeration with the git-ignore filter applied. Every
// check goes through this rather than calling walkMarkdownFiles directly, so
// one rule about what belongs to the doc graph holds across all of them.
// `relDir` scopes the walk (e.g. `docs`) while the returned paths stay
// repo-relative, which is what findings, receipts and link resolution all use.
function walkRepoMarkdown(ctx, relDir = "") {
  const root = relDir === "" ? ctx.repoRoot : join(ctx.repoRoot, relDir);
  const found = walkMarkdownFiles(root).map((f) => (relDir === "" ? f : `${relDir}/${f}`));
  return ctx.ignoreFilter(found);
}

function listDirFiles(root, relDir) {
  const abs = join(root, relDir);
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => `${relDir}/${e.name}`);
  } catch {
    return null; // directory does not exist — distinct from "exists but empty"
  }
}

// ---------------------------------------------------------------------------
// Receipts — "an empty read digests to a stable hash": every check states how
// much it actually inspected, so a clean verdict on nothing (a misconfigured
// path, a directory that silently doesn't exist) never prints identically to
// a clean verdict earned by reading real content. `digest` is a short, stable
// fingerprint of what was read — not cryptographic, just enough that a report
// diffed across two runs shows whether the INPUT changed, not only the verdict.
// ---------------------------------------------------------------------------

function makeReceipt() {
  const hash = createHash("sha256");
  let files = 0;
  let bytes = 0;
  return {
    add(path, text) {
      files += 1;
      bytes += Buffer.byteLength(text ?? "", "utf8");
      hash.update(path);
      hash.update("\0");
      hash.update(text ?? "");
      hash.update("\0");
    },
    summary() {
      return { files, bytes, digest: hash.copy().digest("hex").slice(0, 12) };
    },
  };
}

function formatReceipt(r) {
  const { files, bytes, digest } = r.summary();
  return `${files} file${files === 1 ? "" : "s"}, ${bytes} bytes, digest ${digest}`;
}

// ---------------------------------------------------------------------------
// Markdown structural helpers (heading slugs, link scanning) — adapted from
// this handbook's own audit/audit.mjs (#158, #64), which calibrated the
// slugifier against every real anchor link this repo carries. Copied rather
// than imported: this file is a copy-and-own template that must run standalone
// in an adopting repo with no access to this handbook's tools/lib.
// ---------------------------------------------------------------------------

function slugifyHeading(text) {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
    .replace(/#+$/, "")
    .toLowerCase()
    // `\w` is ASCII-only; GitHub keeps Unicode letters when it slugifies a heading, so
    // this widens to `\p{L}`/`\p{N}` (Unicode letter/digit) while keeping `_` as its own
    // explicit class member -- the next line folds `_` into `-` and needs it to survive
    // this step to do that. Kept in sync with audit/audit.mjs's slugifyHeading (#280).
    .replace(/[^\p{L}\p{N}_\- ]+/gu, "")
    .trim()
    .replace(/[ _]/g, "-");
}

// Blanks fenced code blocks (```/~~~) to whole-line-length spaces, so a `#`
// or `§` inside a code sample is never read as a heading or a citation, while
// line numbers stay accurate for messages.
function blankFences(text) {
  let inFence = false;
  return text.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

// Every heading in `text`, in document order, mapped to its GitHub-compatible
// resolved slug (including duplicate-slug suffixing).
function collectHeadingSlugs(text) {
  const slugs = new Set();
  const seen = new Map();
  for (const line of blankFences(text)) {
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

// Every "N" or "N.M" that leads a heading (`## 5. Foo`, `### 5.1 Bar`, or this
// repo's own `## §5 — Foo` shape), as a Set of exact strings. Existence-only,
// deliberately — see the per-document/non-unique §-numbering note above.
function collectNumberedHeadings(text) {
  const nums = new Set();
  for (const line of blankFences(text)) {
    const m = /^#{1,6}\s+(?:§\s*)?(\d+(?:\.\d+)?)(?:[.\s:—–-]|$)/.exec(line);
    if (m) nums.add(m[1]);
  }
  return nums;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  let prev = new Array(n + 1), curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function nearest(target, candidates, n = 5) {
  return [...candidates]
    .map((c) => ({ c, d: levenshtein(String(target), String(c)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((x) => x.c);
}

// Repo-relative markdown links: `](target#fragment)`, target empty for a
// same-file link. Skips external (scheme:// or //host) targets.
const LINK_RE = /\]\(([^)#\s]*\.md)?#?([^)\s]*)\)/g;
// A simpler "does this file link anywhere" scanner for the orphan check
// (check 2), which only needs the TARGET path, not the fragment.
const ANY_MD_LINK_RE = /\]\(([^)#\s]+\.md)(#[^)\s]*)?\)/g;

function isExternalTarget(t) {
  return /^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("//");
}

function resolveRepoPath(dir, target) {
  const p = target.startsWith("/") ? target.slice(1) : join(dir, target);
  return p.split(sep).join("/").split("/").filter((seg) => seg !== ".").join("/");
}

// Placeholder-aware: a link target containing `...`, an angle-bracket span,
// or a brace span is a template example, not a real path. A line self-marked
// "historical" is read as declaring its own links may be intentionally dead.
const PLACEHOLDER_TARGET_RE = /\.\.\.|<[^>]*>|\{[^}]*\}/;
function isHistoricalLine(line) {
  return /historical/i.test(line);
}

// ---------------------------------------------------------------------------
// Findings collector
// ---------------------------------------------------------------------------

function makeFindings() {
  const items = [];
  return {
    fail(check, message) { items.push({ severity: "fail", check, message }); },
    warn(check, message) { items.push({ severity: "warn", check, message }); },
    all: items,
  };
}

// ===========================================================================
// Check 1 — Router integrity: every path/link in the router resolves.
// ===========================================================================
function checkRouterIntegrity(ctx) {
  const { repoRoot, config, findings } = ctx;
  const receipt = makeReceipt();
  const check = "1 router-integrity";

  if (!config.router) {
    findings.warn(check, "no router found — neither CLAUDE.md nor README.md exists at the repo root");
    return { receipt };
  }
  const routerPath = config.router;
  const text = readFileSafeText(join(repoRoot, routerPath));
  if (text === null) {
    findings.fail(check, `configured router "${routerPath}" does not exist`);
    return { receipt };
  }
  receipt.add(routerPath, text);

  const dir = dirname(routerPath) === "." ? "" : dirname(routerPath);
  const lines = blankFences(text).length ? text.split("\n") : text.split("\n"); // keep original text for line lookup
  let checked = 0, skippedPlaceholder = 0, skippedHistorical = 0;

  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    if (isHistoricalLine(line)) { skippedHistorical++; continue; }
    ANY_MD_LINK_RE.lastIndex = 0;
    let m;
    while ((m = ANY_MD_LINK_RE.exec(line))) {
      const raw = m[1];
      if (isExternalTarget(raw)) continue;
      if (PLACEHOLDER_TARGET_RE.test(raw)) { skippedPlaceholder++; continue; }
      const target = resolveRepoPath(dir, raw);
      checked++;
      if (readFileSafeText(join(repoRoot, target)) === null) {
        findings.fail(check, `${routerPath}:${ln + 1}: links to ${target}, which does not exist`);
      }
    }
  }
  receipt.note = `${checked} link(s) checked, ${skippedPlaceholder} placeholder(s) skipped, ${skippedHistorical} historical line(s) skipped`;
  return { receipt };
}

// ===========================================================================
// Check 2 — Orphans: docs/*.md referenced by neither the router nor any doc.
// ===========================================================================
function checkOrphans(ctx) {
  const { repoRoot, config, findings } = ctx;
  const receipt = makeReceipt();
  const check = "2 orphans";

  const { files: allMd } = walkRepoMarkdown(ctx);
  if (allMd.length === 0) {
    findings.warn(check, "no markdown files found in the repo at all — nothing to check");
    return { receipt };
  }

  const referenced = new Set();
  for (const file of allMd) {
    const text = readFileSafeText(join(repoRoot, file));
    if (text === null) continue;
    receipt.add(file, text);
    const dir = dirname(file) === "." ? "" : dirname(file);
    for (const line of blankFences(text)) {
      ANY_MD_LINK_RE.lastIndex = 0;
      let m;
      while ((m = ANY_MD_LINK_RE.exec(line))) {
        const raw = m[1];
        if (isExternalTarget(raw) || PLACEHOLDER_TARGET_RE.test(raw)) continue;
        referenced.add(resolveRepoPath(dir, raw));
      }
    }
  }

  const { files: docsFiles } = walkRepoMarkdown(ctx, config.docsDir);
  const gotchasPrefix = `${config.gotchasDir}/`;
  const candidates = docsFiles.filter((f) => !f.startsWith(gotchasPrefix) && !/\/README\.md$/i.test(f));

  let orphanCount = 0;
  for (const f of candidates) {
    if (!referenced.has(f)) {
      orphanCount++;
      findings.warn(check, `${f} is never linked from ${config.router ?? "the router"} or any other doc — an orphan, or a dead-end nobody will find`);
    }
  }
  receipt.note = `${candidates.length} ${config.docsDir}/ file(s) checked (excluding ${config.gotchasDir}/ and README.md), ${orphanCount} orphan(s)`;
  return { receipt };
}

// ===========================================================================
// Check 3 — Drafts in docs/: the convention says drafts live in log/.
// ===========================================================================
// Conservative on purpose (advisory-first, false-positive-averse): a doc is
// flagged only when it carries an EXPLICIT self-description, not merely
// because the word "draft" appears somewhere in its prose (that alone was the
// naive version this handbook's own pilot rejected as noisy).
const DRAFT_MARKER_RE = /^\s*(>\s*)?\**\s*(status|state)\s*\**\s*:\s*\**\s*draft\b/i;
const DRAFT_TITLE_RE = /^#{1,6}\s+.*\((?:draft|wip)\)/i;

function checkDraftsInDocs(ctx) {
  const { repoRoot, config, findings } = ctx;
  const receipt = makeReceipt();
  const check = "3 drafts-in-docs";

  const { files: docsFiles } = walkRepoMarkdown(ctx, config.docsDir);
  const gotchasPrefix = `${config.gotchasDir}/`;
  const candidates = docsFiles.filter((f) => !f.startsWith(gotchasPrefix));

  let flagged = 0;
  for (const f of candidates) {
    const text = readFileSafeText(join(repoRoot, f));
    if (text === null) continue;
    receipt.add(f, text);
    const head = text.split("\n").slice(0, 15);
    const hit = head.find((l) => DRAFT_MARKER_RE.test(l) || DRAFT_TITLE_RE.test(l));
    if (hit) {
      flagged++;
      findings.warn(check, `${f} self-describes as a draft ("${hit.trim()}") but lives in ${config.docsDir}/ — the convention is drafts live in ${config.logDir}/`);
    }
  }
  receipt.note = `${candidates.length} file(s) checked, ${flagged} self-marked draft(s)`;
  return { receipt };
}

// ===========================================================================
// Check 4 — Router size budget.
// ===========================================================================
function checkRouterSizeBudget(ctx) {
  const { repoRoot, config, findings } = ctx;
  const receipt = makeReceipt();
  const check = "4 router-size-budget";

  if (!config.router) return { receipt }; // check 1 already reported this
  const text = readFileSafeText(join(repoRoot, config.router));
  if (text === null) return { receipt }; // check 1 already reported this
  receipt.add(config.router, text);

  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > config.routerMaxBytes) {
    findings.warn(
      check,
      `${config.router} is ${bytes} bytes (~${(bytes / 1024).toFixed(1)} KB) — over the ` +
        `${(config.routerMaxBytes / 1024).toFixed(0)} KB advisory ceiling. It is loaded in full before any work ` +
        `starts; if depth belongs in ${config.docsDir}/, the router line should be a pointer, not a copy`,
    );
  }
  receipt.note = `${bytes} bytes vs ${config.routerMaxBytes} byte ceiling`;
  return { receipt };
}

// ===========================================================================
// Check 5 — Dated-name files inside docs/ (belong in log/).
// ===========================================================================
// Strictly an ISO date substring — the false-positive rule this check exists
// to satisfy ("exclude -log.md/dated files from content budgets") is already
// structural here: a file merely named `*-log.md` (an ongoing, non-dated
// running log) has no YYYY-MM-DD substring and never matches.
const DATED_NAME_RE = /(^|[-_/])(\d{4}-\d{2}-\d{2})([-_.]|$)/;

function checkDatedFilesInDocs(ctx) {
  const { repoRoot, config, findings } = ctx;
  const receipt = makeReceipt();
  const check = "5 dated-files-in-docs";

  const { files: docsFiles } = walkRepoMarkdown(ctx, config.docsDir);
  const gotchasPrefix = `${config.gotchasDir}/`;
  const candidates = docsFiles.filter((f) => !f.startsWith(gotchasPrefix));

  let flagged = 0;
  for (const f of candidates) {
    receipt.add(f, ""); // filename check only — no content read needed
    if (DATED_NAME_RE.test(f)) {
      flagged++;
      findings.warn(check, `${f} has a dated filename but lives in ${config.docsDir}/ (current truth) — dated archives belong in ${config.logDir}/`);
    }
  }
  receipt.note = `${candidates.length} filename(s) checked, ${flagged} dated`;
  return { receipt };
}

// ===========================================================================
// Check 6 — §/section citations resolve, WITH CONTEXT.
// ===========================================================================
// Three patterns, exactly as scoped by colab-handbook #249:
//   (a) "gotchas §N"        -> resolved against config.gotchasFile's own headings
//   (b) "<file>.md §N"      -> resolved against that named file's headings
//   (c) bare "§N"           -> resolved against the CURRENT file's own headings
//
// Pattern (b) has TWO shapes, and colab-handbook #300 measured that conflating
// them is what broke this check on the handbook's own trunk. A token carrying a
// separator ("../CONVENTIONS.md", "docs/adr/288-x.md") is a PATH claim: resolve
// it against the citing file's directory and nowhere else. A token that is a
// BARE NAME ("CONVENTIONS.md") is a NAME, and a reader resolves a name the
// obvious way — the copy sitting next to this file if there is one, otherwise
// the repo's own copy at the root. Resolving a bare name against the citing
// directory ALONE made every unlinked `CONVENTIONS.md §N` inside a nested skill
// file a FAIL against a sibling that was never meant to exist. Measured on this
// handbook: all 10 filename-qualified citations in the repo name CONVENTIONS.md
// by bare name and not one is path-shaped; 8 sit in root-level files (where the
// two resolutions coincide), which is the only reason the bug stayed invisible
// until two skill files used the same style two levels down.
//
// A fifth outcome, SKIPPED, exists deliberately: a `§N` immediately preceded
// by a BACKTICK-WRAPPED token that is neither "gotchas" nor `*.md` (e.g.
// `` `code-triage` §5.1 ``, a real citation style in this very handbook,
// pointing at another skill's own SKILL.md by name) names an external
// artifact this generic script has no way to resolve — reported as skipped,
// counted in the receipt, never silently treated as broken OR silently
// dropped. This was measured against this handbook's own docs before shipping
// this check: `the §3`, `and §1`, `per §7` (ordinary prose words, not
// backtick-wrapped) all resolve correctly as bare self-citations under this
// rule, while `` `code-triage` §5.1 `` correctly reports as skipped rather
// than failing against a file that was never meant to hold that heading.
//
// A §N wrapped ENTIRELY in its own backticks (`` `§5` ``, as opposed to a
// backtick-wrapped FILENAME sitting next to a bare §N) is read as a LITERAL
// CODE-SPAN EXAMPLE — a doc illustrating the old citation style, exactly as
// this handbook's own audit/README.md does while describing the bug this
// check exists to catch — and is skipped, not resolved, the same posture
// audit.mjs's own anchor-link check takes toward inline code spans.
//
// Both link-stripping and the whole-text preceding-token lookup operate on
// the FULL FILE, not per physical line: this repo hard-wraps prose at ~90
// columns, so a markdown link's `[label](target)` — or a citation's
// qualifying filename — routinely lands on the line BEFORE its own `§N`.
// Scanning per line silently missed both of those and produced two false
// FAILs against this handbook's own docs before this fix (measured 2026-08-21).
function stripLinksForCitationScan(text) {
  // A §N that is the visible TEXT of a real markdown link (`[§9](...)`, or
  // `` [`code-triage` §0](...) ``) is already covered by check 1 / the link's
  // own href — remove the whole `[...](...)` span, replacing every non-newline
  // character with a space so line numbers computed from the result stay correct.
  return text.replace(/\[[^\]]*\]\([^)]*\)/g, (m) => m.replace(/[^\n]/g, " "));
}

const CITATION_RE = /§\s*(\d+(?:\.\d+)?)/g;
// Captures the token immediately before a match position, keeping a trailing
// backtick/quote (so we can tell "was this backtick-wrapped") separately.
function precedingToken(text, index) {
  const pre = text.slice(0, index);
  const m = /([`'"]?)([\w./-]+)([`'"]?)\s*$/.exec(pre);
  if (!m) return null;
  return { token: m[2], backticked: Boolean(m[1] || m[3]) };
}

// Candidate target(s) for a filename-qualified citation, in the order a reader
// would try them. Path-shaped token (any separator) -> exactly one candidate,
// resolved against the citing directory. Bare name -> the sibling first, then
// the repo root; the FIRST candidate that EXISTS wins, so a repo that really
// does keep a same-named file next to the citing doc still resolves there, and
// a missing heading number in it is still a genuine break rather than something
// the root copy silently papers over.
function citationCandidates(dir, token) {
  if (token.includes("/")) return [resolveRepoPath(dir, token)];
  const sibling = resolveRepoPath(dir, token);
  const atRoot = resolveRepoPath("", token);
  return sibling === atRoot ? [sibling] : [sibling, atRoot];
}

function lineNumberAt(text, index) {
  let line = 0;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line; // 0-based
}

function checkGotchaCitations(ctx) {
  const { repoRoot, config, findings } = ctx;
  const receipt = makeReceipt();
  const check = "6 section-citations";

  const { files: allMd, ignored: ignoredCount } = walkRepoMarkdown(ctx);
  const files = allMd.filter((f) => !f.startsWith(`${config.gotchasDir}/`));
  const headingCache = new Map(); // repo-relative path -> Set<numberString> | null

  const numsFor = (path) => {
    if (headingCache.has(path)) return headingCache.get(path);
    const text = readFileSafeText(join(repoRoot, path));
    const result = text === null ? null : collectNumberedHeadings(text);
    headingCache.set(path, result);
    return result;
  };

  let resolved = 0, broken = 0, skipped = 0, literalExamples = 0, viaRoot = 0;
  for (const file of files) {
    const rawText = readFileSafeText(join(repoRoot, file));
    if (rawText === null) continue;
    receipt.add(file, rawText);
    const dir = dirname(file) === "." ? "" : dirname(file);
    const fenceBlanked = blankFences(rawText).join("\n");
    const scanText = stripLinksForCitationScan(fenceBlanked);

    CITATION_RE.lastIndex = 0;
    let m;
    while ((m = CITATION_RE.exec(scanText))) {
      const num = m[1];
      const ln = lineNumberAt(scanText, m.index);

      // Entirely backtick-wrapped (`` `§5` ``) — a literal example, not a citation.
      const charBefore = scanText[m.index - 1];
      const charAfter = scanText[m.index + m[0].length];
      if (charBefore === "`" && charAfter === "`") {
        literalExamples++;
        continue;
      }

      const pre = precedingToken(scanText, m.index);
      let candidates = [file]; // default: bare -> current file
      let label = `bare §${num}`;

      if (pre && pre.token.toLowerCase() === "gotchas" && !pre.backticked) {
        candidates = [config.gotchasFile];
        label = `gotchas §${num}`;
      } else if (pre && /\.md$/i.test(pre.token)) {
        candidates = citationCandidates(dir, pre.token);
        label = `${pre.token} §${num}`;
      } else if (pre && pre.backticked) {
        // A named, non-.md, backtick-wrapped artifact — cannot resolve generically.
        skipped++;
        continue;
      }
      // else: ordinary prose word or nothing before it -> bare, current file.

      const targetFile = candidates.find((c) => numsFor(c) !== null);
      if (targetFile === undefined) {
        broken++;
        const where =
          candidates.length > 1
            ? `neither ${candidates[0]} nor ${candidates[1]} exists`
            : `${candidates[0]} does not exist`;
        findings.fail(check, `${file}:${ln + 1}: "${label}" — ${where}`);
        continue;
      }
      if (targetFile !== candidates[0]) viaRoot++;

      const nums = numsFor(targetFile);
      if (!nums.has(num)) {
        broken++;
        const suggestion = nearest(num, nums, 5);
        findings.fail(
          check,
          `${file}:${ln + 1}: "${label}" does not resolve — ${targetFile} has no heading numbered ${num}` +
            (suggestion.length ? ` (nearest: ${suggestion.join(", ")})` : " (it has no numbered headings at all)"),
        );
        continue;
      }
      resolved++;
    }
  }
  receipt.note =
    `${resolved} citation(s) resolved` +
    (viaRoot ? ` (${viaRoot} by bare name at the repo root, no sibling copy)` : "") +
    `, ${broken} broken, ${skipped} skipped (unresolvable external artifact), ${literalExamples} literal code-span example(s) ignored` +
    (ignoredCount ? `, ${ignoredCount} git-ignored file(s) not enumerated` : "");
  return { receipt };
}

// ===========================================================================
// Check 7 — gotchas.d/ registry discipline.
// ===========================================================================
const GOTCHA_FILENAME_RE = /^(\d+)-[a-z0-9-]+\.md$/i;

function checkGotchasDRegistry(ctx) {
  const { repoRoot, config, findings } = ctx;
  const receipt = makeReceipt();
  const check = "7 gotchas-d-registry";

  const files = listDirFiles(repoRoot, config.gotchasDir);
  if (files === null) {
    findings.warn(check, `${config.gotchasDir}/ does not exist — nothing to check (a repo may not have adopted it yet)`);
    return { receipt };
  }
  const entries = files.filter((f) => !/\/README\.md$/i.test(f));
  const seen = new Map(); // issue number -> [files]
  let malformed = 0;

  for (const f of entries) {
    receipt.add(f, ""); // filename discipline only
    const base = f.split("/").pop();
    const m = GOTCHA_FILENAME_RE.exec(base);
    if (!m) {
      malformed++;
      findings.warn(check, `${f} does not match "<issue-number>-<slug>.md" (templates/gotchas-d-README.md's naming rule)`);
      continue;
    }
    const num = m[1];
    if (!seen.has(num)) seen.set(num, []);
    seen.get(num).push(f);
  }
  let duplicates = 0;
  for (const [num, list] of seen) {
    if (list.length > 1) {
      duplicates++;
      findings.fail(check, `issue #${num} has ${list.length} gotchas.d entries — one file per gotcha, never two: ${list.join(", ")}`);
    }
  }
  receipt.note = `${entries.length} entr(y/ies) checked, ${malformed} malformed name(s), ${duplicates} duplicate issue number(s)`;
  return { receipt };
}

// ===========================================================================
// Check 8 — Two-surface linkage: the curated guide must point INTO the
// registry, and the same issue number must never appear as a heading in both
// (that would mean the entry was copied, not linked — the "don't copy back
// and forth" rule, machine-checked).
// ===========================================================================
function checkTwoSurfaceLinkage(ctx) {
  const { repoRoot, config, findings } = ctx;
  const receipt = makeReceipt();
  const check = "8 two-surface-linkage";

  const guideText = readFileSafeText(join(repoRoot, config.gotchasFile));
  const registryFiles = listDirFiles(repoRoot, config.gotchasDir);

  if (guideText === null) {
    findings.warn(check, `${config.gotchasFile} does not exist — nothing to check (optional surface, per templates/gotchas-d-README.md)`);
    return { receipt };
  }
  receipt.add(config.gotchasFile, guideText);
  if (registryFiles === null) {
    findings.warn(check, `${config.gotchasFile} exists but ${config.gotchasDir}/ does not — a curated guide with no registry to point into`);
    return { receipt };
  }

  const registryNums = new Set(
    registryFiles
      .map((f) => GOTCHA_FILENAME_RE.exec(f.split("/").pop()))
      .filter(Boolean)
      .map((m) => m[1]),
  );

  // Headings in the guide of the shape "... #N ..." or "... (#N) ..." are read
  // as this guide claiming to COVER issue N's gotcha, not merely mentioning
  // the number in prose — deliberately narrow, matching how the two surfaces
  // are documented to cross-reference in templates/gotchas-d-README.md.
  const guideHeadingIssues = new Set();
  for (const line of blankFences(guideText)) {
    const h = /^#{1,6}\s+.*$/.exec(line);
    if (!h) continue;
    const m = /#(\d+)\b/.exec(h[0]);
    if (m) guideHeadingIssues.add(m[1]);
  }

  let copyDrift = 0, unlinked = 0;
  for (const num of guideHeadingIssues) {
    if (registryNums.has(num)) {
      // The same issue is a HEADING in the guide AND a file in the registry.
      // That is fine when the heading merely LINKS into the entry — flag it
      // only when the guide's own body for that heading contains no link to
      // the matching gotchas.d/ file, which is the actual copy-drift signal.
      const sectionRe = new RegExp(`^#{1,6}\\s+.*#${num}\\b.*$([\\s\\S]*?)(?=^#{1,6}\\s|\\Z)`, "m");
      const m = sectionRe.exec(guideText + "\n");
      const body = m ? m[1] : "";
      if (!new RegExp(`gotchas\\.d/${num}-`, "i").test(body) && !body.includes(`${config.gotchasDir}/${num}-`)) {
        copyDrift++;
        findings.warn(
          check,
          `${config.gotchasFile}: the #${num} section is also a gotchas.d/ entry but its body never links into ${config.gotchasDir}/${num}-*.md — looks copied, not linked`,
        );
      }
    }
  }
  receipt.note = `${guideHeadingIssues.size} guide heading(s) with an issue number, ${registryNums.size} registry entries, ${copyDrift} copy-drift flag(s)`;
  return { receipt };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const CHECKS = [
  ["1 router-integrity", checkRouterIntegrity],
  ["2 orphans", checkOrphans],
  ["3 drafts-in-docs", checkDraftsInDocs],
  ["4 router-size-budget", checkRouterSizeBudget],
  ["5 dated-files-in-docs", checkDatedFilesInDocs],
  ["6 section-citations", checkGotchaCitations],
  ["7 gotchas-d-registry", checkGotchasDRegistry],
  ["8 two-surface-linkage", checkTwoSurfaceLinkage],
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  const repoRoot = args.repo;
  if (!existsSync(repoRoot)) {
    console.error(`docs-lint: --repo ${repoRoot} does not exist`);
    process.exit(2);
  }
  const config = buildConfig(repoRoot);
  const findings = makeFindings();
  const ctx = { repoRoot, config, findings, ignoreFilter: makeIgnoreFilter(repoRoot) };

  const results = [];
  for (const [name, fn] of CHECKS) {
    const before = findings.all.length;
    const { receipt } = fn(ctx);
    const produced = findings.all.slice(before);
    results.push({ name, receipt: receipt.summary(), note: receipt.note ?? null, findings: produced });
  }

  const hasFail = findings.all.some((f) => f.severity === "fail");

  if (args.json) {
    console.log(JSON.stringify({ repoRoot, config, results, hasFail }, null, 2));
  } else {
    console.log(`docs-lint — ${repoRoot}`);
    console.log(`router: ${config.router ?? "(none found)"}`);
    console.log("");
    for (const r of results) {
      const failCount = r.findings.filter((f) => f.severity === "fail").length;
      const warnCount = r.findings.filter((f) => f.severity === "warn").length;
      const verdict = failCount > 0 ? "FAIL" : warnCount > 0 ? "WARN" : "ok";
      console.log(`[${r.name}] ${verdict}  (${formatReceipt({ summary: () => r.receipt })}${r.note ? ` — ${r.note}` : ""})`);
      for (const f of r.findings) {
        console.log(`  ${f.severity === "fail" ? "FAIL" : "warn"}: ${f.message}`);
      }
    }
    console.log("");
    console.log(
      hasFail
        ? "docs-lint: FAIL — at least one structural break found (see above)"
        : "docs-lint: clean (advisory warnings, if any, are printed above)",
    );
  }
  process.exit(hasFail ? 1 : 0);
}

main();
