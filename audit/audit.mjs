#!/usr/bin/env node
// colab-handbook convention audit.
//
// This is NOT in-repo CI. It is a CLI you run locally (or on a schedule) that audits
// MANY repositories across MULTIPLE owners at once — five of them, GitHub orgs and
// personal accounts alike — plus local-only repos that have no GitHub presence
// at all. That breadth is the point: the failure mode it exists to catch is drift
// BETWEEN repos, which no single repo's CI can ever see.
//
// Why it left CI: a convention guard living inside each repo can only check the repo
// it ships in, has to be copied everywhere to be useful, and rots differently in each
// copy. One external auditor with one source of truth is simpler and honest about
// what it is — an advisory report, not a gate.
//
// Dependencies: none. Plain Node, plus `gh` shelled out for GitHub API reads (only
// when a repo is given as an owner/name slug rather than a local path).
//
// It also runs RECONCILIATION checks: copied handbook artifacts carry a stamp naming
// the template and the handbook version they were copied at (see `colab template`).
// This audit compares each stamp against the handbook's own git history and flags a
// repo whose copy is now behind a changed template — so an adopted repo finds out via
// the audit, not by luck. The handbook is this checkout (the audit knows its own
// location); its current version is `git describe --tags --abbrev=0`.
//
// Repo list resolution (highest precedence first):
//   1. --config <path>            explicit; errors if missing
//   2. ~/.colab/repos.txt         machine-local fleet registry (PRIVATE, not committed)
//   3. <this dir>/repos.txt       the committed neutral example (fallback only)
// (COLAB_HOME overrides ~/.colab, matching the colab CLI.)
//
// Usage:
//   node audit.mjs                       # audit everything in the resolved repo list
//   node audit.mjs --local ~/code/foo    # audit one local path, ad hoc
//   node audit.mjs --config other.txt    # a different repo list
//   node audit.mjs --json                # machine-readable
//   node audit.mjs --quiet               # only repos with findings
//
// Exit code: 0 when every repo passes, 1 when any repo has a finding, 2 on a usage
// error. Findings never crash the run — a repo missing project.yml is a result, not
// an exception.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// The stamp/drift logic is SHARED with `colab update` (tools/lib/stamp.js), which refreshes what
// this tool reports. Two readings of a stamp that disagreed about what "behind" means is the
// two-places-drift disease this handbook exists to kill, so there is one implementation. It is
// CommonJS because the CLI is; `createRequire` is how ESM consumes it.
const require = createRequire(import.meta.url);
const stamp = require("../tools/lib/stamp.js");
// The convention-label set is shared with adoption/sync (they provision what this reports),
// so the three surfaces cannot drift about what the full set is. See tools/lib/labels.js.
const { missingConventionLabels } = require("../tools/lib/labels.js");
// #144's authority-flip precedence ladder — shared with `tools/colab` for the same reason
// every other cross-tool reading in this file is: two implementations of "which key governs"
// is exactly the two-places-drift disease this handbook exists to kill.
const axisAuthority = require("../tools/lib/axis-authority.js");
// #137's falsifier evidence-gathering — shared with `colab adopt` (#199) for the identical
// reason: `install.sh` freezes tools/colab + tools/lib/ only, nothing under audit/ is frozen,
// so anything both need has to live in tools/lib/. This module only gathers evidence; the
// severity policy built on top of it (warn vs fail, the 2-of-5 reach) stays here.
const {
  VERSION_TAG_RE, versionShapedTags, DEPLOY_BASENAME_RE, consumerEvidence, describeEvidence,
} = require("../tools/lib/consumer-evidence.js");
const {
  handbookInfo, templateNames, templateChangedSince, cmpParts, cmpSemver,
  parseWorkflowStamp, parseClaudeStamp, workflowProvenance, unstampedFinding, looksLikeHandbookClaude,
} = stamp;

const HERE = dirname(fileURLToPath(import.meta.url));
// audit/ lives inside the handbook checkout; COLAB_HANDBOOK overrides for running the
// audit from elsewhere (or for tests that point at a scratch handbook).
const HANDBOOK_ROOT = process.env.COLAB_HANDBOOK ? resolve(process.env.COLAB_HANDBOOK) : resolve(HERE, "..");
const COLAB_HOME = process.env.COLAB_HOME || join(homedir(), ".colab");

// ---------------------------------------------------------------------------- args

function parseArgs(argv) {
  // config === null means "resolve from the precedence chain"; a string means explicit.
  const opts = { config: null, locals: [], slugs: [], json: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--quiet" || a === "-q") opts.quiet = true;
    else if (a === "--local") {
      const p = argv[++i];
      if (!p) die("--local needs a path");
      opts.locals.push(p);
    } else if (a === "--config" || a === "-c") {
      const p = argv[++i];
      if (!p) die("--config needs a path");
      opts.config = p;
    } else if (a === "--help" || a === "-h") {
      // Signal, don't print-and-exit. The help text is ~12 KB — larger than a
      // pipe buffer — so exiting here truncated it for any reader that is not
      // a terminal. See the note above process.exitCode in main.
      opts.help = true;
      return opts;
    } else if (a.startsWith("-")) die(`unknown flag: ${a}`);
    else opts.slugs.push(a); // bare argument = slug or path
  }
  return opts;
}

// Resolve the repo-list file per the documented precedence. Returns { path, source }
// or null when auditing only --local / positional targets (no list needed).
function resolveConfig(opts) {
  if (opts.config) {
    if (!existsSync(opts.config)) die(`config not found: ${opts.config}`);
    return { path: opts.config, source: "--config" };
  }
  const local = join(COLAB_HOME, "repos.txt");
  if (existsSync(local)) return { path: local, source: COLAB_HOME + "/repos.txt" };
  const bundled = join(HERE, "repos.txt");
  return { path: bundled, source: "bundled example (audit/repos.txt)" };
}

function die(msg) {
  // Deliberately keeps process.exit(): die() is a control-flow terminator called
  // from mid-loop and mid-function, where returning would let the caller carry
  // on with invalid state. Exiting is safe here because it writes a single short
  // line to stderr — always well under a pipe buffer, and stderr is a separate
  // buffer from the JSON on stdout, so it cannot be the thing that gets cut.
  console.error(`audit: ${msg}`);
  process.exit(2);
}

// ------------------------------------------------------------------- tiny YAML read
//
// project.yml is a flat mapping of scalars by design. A hand-rolled reader keeps this
// tool dependency-free; anything it cannot understand is reported as a parse finding
// rather than silently ignored, so the narrowness is visible instead of dangerous.
//
// ONE indented form is accepted: a block sequence of scalars under a key, because
// `integration:` is a list and a descriptor that cannot express a list would push repos
// into encoding one in a string. Nesting of every other shape remains a finding — the
// reader stays narrow on purpose, and the narrowness stays visible.
//
// (The `colab` CLI reads the same file through tools/lib/yaml.js, which accepts nested
// maps as well. The two are deliberately NOT merged: this one's refusal to parse nesting
// is a CHECK — it is how an over-clever descriptor gets reported instead of silently
// half-read — while the CLI only needs to consume valid files. Sharing one reader would
// mean deleting the check.)

function parseScalarValue(raw) {
  let val = raw.replace(/\s+#.*$/, "").trim(); // strip trailing comment
  if (/^".*"$/.test(val) || /^'.*'$/.test(val)) return val.slice(1, -1);
  if (val === "" || val === "null" || val === "~") return null;
  if (val === "true") return true;
  if (val === "false") return false;
  return val;
}

function parseFlatYaml(text) {
  const out = {};
  const problems = [];
  // The key whose block sequence may follow. Cleared by any column-0 line, so a `- item`
  // can never attach to a key it does not sit directly under.
  let listKey = null;
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim() || /^\s*#/.test(line)) return;
    if (/^\s+/.test(line)) {
      const item = line.match(/^\s+-\s*(.*)$/);
      if (listKey !== null && item) {
        if (!Array.isArray(out[listKey])) out[listKey] = [];
        out[listKey].push(parseScalarValue(item[1]));
        return;
      }
      problems.push(`line ${idx + 1}: nested/indented YAML is not supported by this reader (flat key: value, or a "- item" list under a key)`);
      return;
    }
    listKey = null;
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!m) {
      problems.push(`line ${idx + 1}: not a "key: value" pair -> ${line.trim()}`);
      return;
    }
    const [, key, rawVal] = m;
    const trimmed = rawVal.replace(/\s+#.*$/, "").trim();
    if (/^\[.*\]$/.test(trimmed)) {
      const inner = trimmed.slice(1, -1).trim();
      out[key] = inner === "" ? [] : inner.split(",").map((s) => parseScalarValue(s));
      return;
    }
    out[key] = parseScalarValue(rawVal);
    // A key with a genuinely empty value may open a block sequence on the next lines. It
    // stays `null` if none follows — `production:` must keep meaning null, not [].
    if (trimmed === "") listKey = key;
  });
  return { data: out, problems };
}

// ------------------------------------------------------------------ version helpers

// "^8.3" ">=22.1 <23" "v22" "22.x" -> "8.3" "22.1" "22" "22"
function normaliseVersion(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  const m = s.match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}

function major(v) {
  const n = normaliseVersion(v);
  return n ? n.split(".")[0] : null;
}

function isRange(s) {
  const t = String(s).trim();
  return /^[\^~><=]/.test(t) || /[\s|]/.test(t) || /\.(\*|x)$/i.test(t);
}

// (cmpParts comes from tools/lib/stamp.js — one numeric version compare, shared.)

// Agreement at the precision both sides actually state. "22" vs "22.1" agree —
// nobody declared the minor, so nobody is claiming anything about it. "8.3" vs "8.4"
// DISagree, because both sides stated a minor and they differ. This matters: a Node
// major is the unit that breaks builds, while PHP minors are real feature releases.
function prefixAgree(a, b) {
  const A = (normaliseVersion(a) || "").split(".").map(Number);
  const B = (normaliseVersion(b) || "").split(".").map(Number);
  if (!A.length || !B.length) return true;
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) if (A[i] !== B[i]) return false;
  return true;
}

// Does a concrete version satisfy a manifest constraint like "^8.3", "~22.1",
// ">=22 <23"? Whitespace-separated clauses are ANDed, which is how both npm and
// composer read them. Anything unparseable returns true — this tool reports drift,
// it does not invent violations out of syntax it does not understand.
function satisfiesConstraint(version, constraint) {
  const v = normaliseVersion(version);
  if (!v) return true;
  const vp = v.split(".").map(Number);
  const clauses = String(constraint).trim().split(/\s+/).filter(Boolean);
  if (!clauses.length) return true;
  return clauses.every((cl) => {
    const m = cl.match(/^(\^|~|>=|<=|>|<|=)?v?(\d+(?:\.\d+)*)/);
    if (!m) return true;
    const op = m[1] || "=";
    const t = m[2].split(".").map(Number);
    const c = cmpParts(vp, t);
    switch (op) {
      case "^": // same major, at or above
        return vp[0] === t[0] && c >= 0;
      case "~": // same major.minor (when a minor was given), at or above
        return vp[0] === t[0] && (t.length < 2 || vp[1] === t[1]) && c >= 0;
      case ">=": return c >= 0;
      case ">": return c > 0;
      case "<=": return c <= 0;
      case "<": return c < 0;
      default: return prefixAgree(v, m[2]);
    }
  });
}


// ------------------------------------------------------- handbook version + stamps
//
// Reconciliation rests on two facts the audit can establish locally:
//   1. The handbook's CURRENT version — `git describe --tags --abbrev=0` in this
//      checkout. Before any tag exists that command fails; we then treat the version
//      as `v0` and mark the handbook "untagged", which DEACTIVATES stamp comparisons
//      (there is no real version line to compare against) rather than failing.
//   2. Whether a template CHANGED since a given stamp — `git log <stamp>..HEAD` scoped
//      to that template's file. Non-empty history = the adopter's copy is behind.

// All of the above now lives in tools/lib/stamp.js, imported at the top of this file:
// gitIn, handbookInfo, templateNames, cmpSemver, templateChangedSince, parseWorkflowStamp,
// parseClaudeStamp, WORKFLOW_FINGERPRINTS, workflowProvenance, unstampedFinding, looksLikeHandbookClaude.
// They take the handbook root explicitly (this file passes HANDBOOK_ROOT) because `colab update`
// locates the handbook differently.

// Run all stamp/reconciliation checks for one repo, pushing findings via fail/warn.
// Silent when there is nothing to say (the common, healthy case).
function checkStamps(src, hb, tmplNames, fail, warn, { ceremony = "standard", missingAxes = [], predatesAxes = [] } = {}) {
  const cur = hb.version;

  const compareStamp = (kind, name, stampVersion, files, { isCi = false } = {}) => {
    // Deactivated while the handbook is untagged — a global note already says so.
    if (hb.untagged || !hb.hasGit) return;
    if (name !== null && !tmplNames.has(name)) {
      warn(`${kind} stamped @ ${stampVersion} names unknown template "${name}" — not in handbook templates/`);
      return;
    }
    if (cmpSemver(stampVersion, cur) > 0) {
      warn(`${kind} stamped @ ${stampVersion} is NEWER than handbook current ${cur} — clock skew or a hand-edited stamp`);
      return;
    }
    const { verifiable, changed } = templateChangedSince(HANDBOOK_ROOT, files, stampVersion);
    if (!verifiable) {
      warn(`${kind} stamped @ ${stampVersion}, a version not in this handbook checkout — cannot verify drift (fetch tags, or re-copy)`);
      return;
    }
    if (changed) {
      // ceremony: light (#79) downgrades drift on a NON-CI template to an advisory — CI/secret-scan
      // integrity is never optional, on any ceremony value or any production status, so a `ci-*`
      // template copy stays a hard finding regardless (isCi guards this unconditionally, below).
      // This is the "stamp drift on non-CI templates" item project.schema.md's ceremony section
      // names; it exists to stop beta noise from drowning real findings on a repo nobody in the
      // room will comb through, never to let a live repo's CI drift unnoticed — narration (which
      // `light` relaxes) and CI integrity (which it never does) are exactly the two things #175
      // split apart.
      const msg = `${kind} copied @ ${stampVersion} — template changed since (${cur}): review, re-copy via colab template`;
      if (ceremony === "light" && !isCi) warn(`${msg} (ceremony: light — advisory, not a build/secret-scan template)`);
      else fail(msg);
    }
  };

  // --- workflow copies ---
  for (const wf of src.listDir(".github/workflows").filter((f) => /\.ya?ml$/.test(f))) {
    const text = src.readFile(`.github/workflows/${wf}`);
    const stem = wf.replace(/\.ya?ml$/, "");
    const stamp = parseWorkflowStamp(text);
    if (stamp) {
      const isCi = /^ci-/.test(stamp.name);
      compareStamp(`${wf}`, stamp.name, stamp.version, [`templates/${stamp.name}.yml`, `templates/${stamp.name}.yaml`], { isCi });
    } else {
      // Content decides, never the filename — a workflow that merely SHARES a template's name
      // was not copied from it, and saying otherwise pushes people toward asserting a lineage
      // they never had (the advice being `--force`, that is a data-loss bug once a template of
      // that name exists). `unstampedFinding` is shared with `colab update` so the two tools
      // cannot drift on this. The `unrelated` finding is deliberately NOT raised here: it has no
      // action, and the audit reports drift, not reassurance.
      const finding = unstampedFinding(workflowProvenance(text, stem, tmplNames));
      if (finding && finding.state === 'unstamped') warn(`${wf} unstamped — ${finding.reason}`);
    }
  }

  // --- CLAUDE.md conventions block ---
  const claude = src.readFile("CLAUDE.md");
  if (claude) {
    const stampInfo = parseClaudeStamp(claude);
    if (stampInfo) {
      compareStamp("CLAUDE block", null, stampInfo.version, ["templates/repo-CLAUDE-block.md"]);
      // Adoption compatibility window (#138): an axis missing on this repo is only a
      // finding when its marker actually PREDATES the axis — never merely undeclared,
      // which stays silent everywhere else (#131/#132/#133/#151's own asymmetry). `warn`
      // only, never `fail`: the marker was not lying when it was written; the question
      // simply did not exist yet.
      if (!hb.untagged && hb.hasGit && missingAxes.length) {
        const { verifiable, axes } = stamp.axesPredating(HANDBOOK_ROOT, stampInfo.version);
        if (verifiable) {
          const predates = missingAxes.filter((a) => axes.includes(a));
          if (predates.length) {
            predates.forEach((a) => predatesAxes.push(a));
            warn(`marker predates the axis model — ${predates.join("/")} entered the model after this repo's stamp @ ${stampInfo.version}; answer ${predates.length > 1 ? "them" : "it"} via CONVENTIONS.md §9's question set (a sync), same as first-time adoption asks (omission stays legal: undeclared, never a default)`);
          }
        }
      }
    } else if (looksLikeHandbookClaude(claude)) {
      warn("CLAUDE.md has the conventions block but no colab-handbook stamp — cannot track handbook drift; re-paste the current block");
    }
  }
}

// -------------------------------------------------------- workflow `on:` triggers
//
// project.yml gets a flat reader; a GitHub workflow's `on:` block is nested, so it
// gets its own pragmatic parser. Workflows are machine-formatted enough that a small
// indentation-aware scan (not a full YAML engine) reads triggers reliably. We only
// need a few facts per workflow: which events fire it, and — for push and
// pull_request — the branch/tag filter lists. Everything else is ignored on purpose.
//
// Returns { found, events:Set,
//           pushBranches:[]|null, pushBranchesIgnore:[]|null, pushTags:[]|null,
//           prBranches:[]|null }.
// A null list means the filter is ABSENT. For push, absent branches + absent tags =
// "all branches" (a bare `push:` fires on every branch). Absent branches but PRESENT
// tags = "tags only" — no branch push at all (a release/tag workflow).
function parseWorkflowOn(text) {
  const res = { found: false, events: new Set(), pushBranches: null, pushBranchesIgnore: null, pushTags: null, prBranches: null };
  if (!text) return res;
  const all = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < all.length; i++) {
    // top-level `on:` at column 0 (YAML also lets it be quoted).
    if (/^(on|["']on["'])\s*:/.test(all[i])) { start = i; break; }
  }
  if (start === -1) return res;
  res.found = true;
  const header = all[start];
  const inline = header.slice(header.indexOf(":") + 1).replace(/#.*$/, "").trim();

  // Inline forms `on: push` / `on: [push, pull_request]` carry no branch filters.
  if (inline) {
    const items = inline.startsWith("[") ? inline.replace(/^\[|\].*$/g, "").split(",") : [inline];
    items.map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean).forEach((e) => res.events.add(e));
    return res;
  }

  // Block form: everything indented past column 0 belongs to the `on:` block.
  const body = [];
  for (let i = start + 1; i < all.length; i++) {
    if (/^\S/.test(all[i])) break; // next column-0 key ends the block
    body.push(all[i]);
  }
  const meaningful = body.filter((l) => l.trim() && !/^\s*#/.test(l));
  if (!meaningful.length) return res;
  const childIndent = Math.min(...meaningful.map((l) => l.match(/^(\s*)/)[1].length));

  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(/^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m || m[1].length !== childIndent) continue;
    const ev = m[2];
    res.events.add(ev);
    if (ev !== "push" && ev !== "pull_request" && ev !== "pull_request_target") continue;
    // The event's sub-block = following lines indented deeper than childIndent.
    const sub = [];
    for (let j = i + 1; j < body.length; j++) {
      if (body[j].trim() === "") { sub.push(body[j]); continue; }
      if (body[j].match(/^(\s*)/)[1].length <= childIndent) break;
      sub.push(body[j]);
    }
    if (ev === "push") {
      res.pushBranches = listField(sub, "branches");
      res.pushBranchesIgnore = listField(sub, "branches-ignore");
      res.pushTags = listField(sub, "tags");
    } else {
      const b = listField(sub, "branches");
      if (b !== null) res.prBranches = b;
    }
  }
  return res;
}

// Extract a YAML list field ("branches"/"tags") from an event sub-block. Handles the
// flow form (`branches: [a, b]`), the block form (`branches:` then `- a` lines) and a
// bare scalar (`branches: main`). Returns null when the field is absent entirely.
function listField(subLines, field) {
  const re = new RegExp("^(\\s*)" + field + "\\s*:\\s*(.*)$");
  for (let i = 0; i < subLines.length; i++) {
    const m = subLines[i].match(re);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2].replace(/#.*$/, "").trim();
    if (inline) {
      if (inline.startsWith("[")) {
        return inline.replace(/^\[|\].*$/g, "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
      return [inline.replace(/^["']|["']$/g, "")];
    }
    const out = [];
    for (let j = i + 1; j < subLines.length; j++) {
      if (subLines[j].trim() === "") continue;
      const bm = subLines[j].match(/^(\s*)-\s*(.+)$/);
      if (bm && bm[1].length > indent) {
        out.push(bm[2].replace(/#.*$/, "").trim().replace(/^["']|["']$/g, ""));
        continue;
      }
      if (subLines[j].match(/^(\s*)/)[1].length <= indent) break; // dedent ends the list
    }
    return out;
  }
  return null;
}

// Minimal shell-glob for branch patterns like `release/*`. Plain names compare as
// equality; only `*` and `?` are honoured — enough for GitHub branch filters.
function globMatch(pattern, name) {
  if (!/[*?[]/.test(pattern)) return pattern === name;
  const rx = "^" + pattern.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
  try { return new RegExp(rx).test(name); } catch { return false; }
}

// ------------------------------------------------------------------- repo acquisition

function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// A slug is fetched read-only through the API — nothing is cloned, nothing is written
// into anyone's working tree.
function readRemoteFile(slug, path) {
  try {
    return runGh(["api", `repos/${slug}/contents/${path}`, "-H", "Accept: application/vnd.github.raw"]);
  } catch {
    return null;
  }
}

function listRemoteDir(slug, path) {
  try {
    const out = runGh(["api", `repos/${slug}/contents/${path}`, "--jq", ".[].name"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function listRemoteBranches(slug) {
  try {
    const out = runGh(["api", `repos/${slug}/branches`, "--paginate", "--jq", ".[].name"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null; // null = could not determine, distinct from "no branches"
  }
}

// Same null/[] contract as listRemoteBranches: null = could not determine (no remote, no
// auth, gh absent, API error), never invented as "no tags". Used by the exposure/channels
// falsifiers (#137) — a version-shaped tag is evidence against a declared "nothing consumes
// this" claim, whether the source is local or remote.
function listRemoteTags(slug) {
  try {
    const out = runGh(["api", `repos/${slug}/tags`, "--paginate", "--jq", ".[].name"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

// Labels live on GitHub, not in the working tree, so this is the audit's one check that
// needs the tracker. `null` means "could not determine" — no remote, no auth, gh absent,
// API error — and the caller stays SILENT on it rather than warning: unlike branches
// (every git repo has them), labels are a GitHub-only concept and a remote-less or
// offline audit legitimately cannot see them. A warn per offline repo would be noise,
// and we cannot assert a label is missing when we could not read the set at all.
function listRemoteLabels(slug) {
  try {
    const out = runGh(["api", `repos/${slug}/labels`, "--paginate", "--jq", ".[].name"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

// github.com/owner/name, git@github.com:owner/name.git → "owner/name". Non-GitHub or
// unparseable remotes return null, so a local-only repo (or a self-hosted git remote)
// contributes no label finding — matching the skill's "no remote" branch.
function githubSlugFromRemote(url) {
  if (!url) return null;
  const m = String(url).trim().match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

// A uniform accessor so every check below is written once and works for both a local
// path and a remote slug.
function makeSource(target) {
  if (target.kind === "local") {
    const root = resolve(target.path);
    return {
      label: target.label,
      kind: "local",
      exists: existsSync(root),
      readFile: (p) => {
        const f = join(root, p);
        return existsSync(f) ? readFileSync(f, "utf8") : null;
      },
      listDir: (p) => {
        const d = join(root, p);
        try {
          return existsSync(d) ? readdirSync(d) : [];
        } catch {
          return [];
        }
      },
      branches: () => {
        try {
          const out = execFileSync("git", ["-C", root, "for-each-ref", "--format=%(refname:short)", "refs/heads"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
          const heads = out.split("\n").map((s) => s.trim()).filter(Boolean);
          // Zero local branch refs plus a detached HEAD is what a shallow `pull_request`
          // checkout looks like (actions/checkout defaults to fetch-depth 1 and checks out
          // the merge commit detached, with no refs/heads at all) — not the same claim as
          // "this repo genuinely has no branches". Report it the same way as "not a git
          // checkout": unverifiable, not a trunk-missing finding (#104). This guard is
          // keyed off `refs/heads` alone, on purpose — a real shallow CI checkout has no
          // remote-tracking refs either, so unioning in refs/remotes below never changes
          // whether this fires.
          if (heads.length === 0) {
            try {
              const head = execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
              if (head === "HEAD") return null;
            } catch {
              // rev-parse itself failed — fall through and report the (empty) list as-is.
            }
          }
          // A branch that exists only as a remote-tracking ref (refs/remotes/<remote>/<name>)
          // is still a branch in every sense the checks below care about: `git clone
          // --branch main` leaves every OTHER branch — including trunk, on a Tier A/C repo
          // where trunk isn't the default — in exactly this shape, and `colab worktree new`
          // already cuts from origin/<trunk>, never a local ref. Reading refs/heads alone
          // reported that trunk as missing on the most pristine checkout there is (#204).
          // Union it in, stripping the leading "<remote>/" generically (not hard-coded to
          // "origin" — whatever remote is configured) and excluding the symbolic ref every
          // remote carries pointing at its default branch. `refname:short` renders that one
          // two different ways depending on git version: "<remote>/HEAD" (has a slash, would
          // strip to the literal branch name "HEAD") or just "<remote>" with no slash at all
          // (git's shorthand for "this remote's HEAD") — the no-slash form is why entries
          // without a "/" are dropped BEFORE stripping, not after; naively slicing one at
          // `indexOf("/") + 1` over "-1" would keep the whole remote name as a fake branch.
          let remotes = [];
          try {
            const remoteOut = execFileSync("git", ["-C", root, "for-each-ref", "--format=%(refname:short)", "refs/remotes"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            remotes = remoteOut.split("\n").map((s) => s.trim()).filter(Boolean)
              .filter((s) => s.includes("/"))
              .map((s) => s.slice(s.indexOf("/") + 1))
              .filter((s) => s && s !== "HEAD");
          } catch {
            // no remotes configured, or the command failed — local refs alone still stand.
          }
          return [...new Set([...heads, ...remotes])];
        } catch {
          return null; // not a git repo, or git unavailable
        }
      },
      // refs/heads only, no remote union — used exactly once, by the "checkout parked on
      // the wrong branch" finding below, to tell "trunk exists but this checkout drifted
      // off it" (fire) apart from "trunk has never had a local ref here" (a fresh `git
      // clone --branch <default>` or a CI checkout — nothing to "return" the checkout to,
      // because it was never there). branches() above stays the general-purpose,
      // remote-inclusive answer for existence checks; this one exists to preserve the
      // local/remote distinction that decision specifically needs (#204).
      localBranches: () => {
        try {
          const out = execFileSync("git", ["-C", root, "for-each-ref", "--format=%(refname:short)", "refs/heads"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
          return out.split("\n").map((s) => s.trim()).filter(Boolean);
        } catch {
          return null;
        }
      },
      currentBranch: () => {
        try {
          return execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        } catch {
          return null;
        }
      },
      // Every tag name, no filtering — the exposure/channels falsifiers (#137) decide
      // which are version-shaped. null = could not determine (not a git repo, git
      // unavailable), same contract as branches() above.
      tags: () => {
        try {
          const out = execFileSync("git", ["-C", root, "tag", "--list"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
          return out.split("\n").map((s) => s.trim()).filter(Boolean);
        } catch {
          return null;
        }
      },
      // Commits whose diff to .github/project.yml touched a line matching `^\s*<key>:`,
      // newest first — the raw material declaredStateAge() (#137) walks to find when a
      // declared axis last changed. `-G`, not `-S`: `-S` counts occurrence-count changes
      // (a line moved elsewhere with the same net count would be invisible to it); `-G`
      // matches any diff touching a line the pattern matches, which is what "did this
      // key's line change" actually means. Capped at 50 commits — a repo whose descriptor
      // has changed that many times has no honest "since when" answer either way, and the
      // cap becomes one of declaredStateAge's own lower-bound degradations rather than an
      // unbounded git log over a huge history. null = could not determine (not a git repo,
      // git unavailable); the caller stays silent on null, same contract as tags()/
      // branches() above.
      descriptorHistory: (key) => {
        try {
          const out = execFileSync(
            "git",
            ["-C", root, "log", `-G^\\s*${key}:`, "--max-count=50", "--format=%H %ct", "--", ".github/project.yml"],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
          );
          const lines = out.split("\n").map((s) => s.trim()).filter(Boolean);
          if (!lines.length) return null;
          return lines.map((l) => {
            const sp = l.indexOf(" ");
            return { sha: l.slice(0, sp), epoch: Number(l.slice(sp + 1)) };
          });
        } catch {
          return null;
        }
      },
      // A file's content AT a given ref (`git show <ref>:<path>`), or null — the same
      // shape as tools/lib/stamp.js's templateAt, reused here rather than duplicated
      // because both answer "what did this path look like as of some historical point."
      // null covers every unreadable case identically: the ref does not resolve (a
      // shallow clone's history boundary, e.g. `<sha>^` past the fetched depth), the path
      // did not exist at that ref, or git itself is unavailable — declaredStateAge (#137)
      // reads null as "cannot see further back" and degrades to a lower bound rather than
      // guessing.
      fileAt: (ref, path) => {
        try {
          return execFileSync("git", ["-C", root, "show", `${ref}:${path}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        } catch {
          return null;
        }
      },
      // A LINKED worktree is on a feature branch by design — that is the whole point of
      // one. Only the main checkout owes the on-trunk invariant, so the caller skips the
      // check here. Detection: git-dir sits under .git/worktrees/<name> in a linked tree,
      // while git-common-dir always points at the real .git.
      isLinkedWorktree: () => {
        try {
          const g = (a) => execFileSync("git", ["-C", root, "rev-parse", a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
          const dir = resolve(root, g("--git-dir"));
          const common = resolve(root, g("--git-common-dir"));
          return dir !== common;
        } catch {
          return false;
        }
      },
      // A local checkout has no labels of its own — they live on its GitHub remote, if it
      // has one. Resolve the origin slug and read them there; a repo with no GitHub origin
      // returns null and contributes no label finding.
      labels: () => {
        let url;
        try {
          url = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        } catch {
          return null;
        }
        const slug = githubSlugFromRemote(url);
        return slug ? listRemoteLabels(slug) : null;
      },
      // Every tracked `*.md` path, repo-relative — used by the anchor-link check (#158).
      // git-tracked, not a filesystem walk: an untracked scratch file citing a bogus
      // anchor is not a repo finding. Empty array (not null) on any failure — the
      // caller's contract is "nothing to check", not "unverifiable", because a local
      // checkout with no `.md` files at all is a legitimate, silent pass.
      markdownFiles: () => {
        try {
          const out = execFileSync("git", ["-C", root, "ls-files", "*.md"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
          return out.split("\n").map((s) => s.trim()).filter(Boolean);
        } catch {
          return [];
        }
      },
    };
  }
  return {
    label: target.label,
    kind: "remote",
    exists: true,
    readFile: (p) => readRemoteFile(target.slug, p),
    listDir: (p) => listRemoteDir(target.slug, p),
    branches: () => listRemoteBranches(target.slug),
    currentBranch: () => null,
    isLinkedWorktree: () => false,
    labels: () => listRemoteLabels(target.slug),
    // Anchor-link check is local-only by design (#158) — enumerating markdown remotely
    // would be N `gh api` calls per repo across a fleet sweep. Empty list = the check
    // scans nothing and emits nothing for a remote source, matching checkRunbook's
    // "would rather under-report than invent" posture for API-backed reads.
    markdownFiles: () => [],
    tags: () => listRemoteTags(target.slug),
    // The duration report (#137) needs a per-commit walk over historical blobs
    // (`git show <sha>^:path`), which has no cheap `gh api` equivalent — reading N
    // historical revisions would be N API calls per repo across a fleet sweep, the same
    // cost markdownFiles() above already declined for the identical reason. A remote
    // source contributes no duration finding, silently, rather than an advisory.
    descriptorHistory: () => null,
    fileAt: () => null,
  };
}

// --------------------------------------------------------------------- self-audit
//
// The sweep covers the handbook's CONSUMERS — and the handbook itself is in the repo
// list, so it ends up asking the handbook whether it has copied the handbook. The
// answer is permanently "no", and the two stamp advisories that follow can never be
// cleared honestly: this repo's ci.yml is purpose-written rather than derived from
// templates/ci-node.yml, and its CLAUDE.md is the source the conventions block is
// extracted FROM, not a paste of it. Hand-stamping them would clear the output and
// simultaneously make the repo claim it copied itself from a version of itself —
// converting an honest advisory into a false claim, which is strictly worse than noise.
//
// Detected STRUCTURALLY, never by matching the string "colab-handbook": a fork or a
// rename must keep working, and a consumer that merely happens to carry that name must
// not inherit the exemption. Two structural facts, in order:
//
//   1. the target resolves to HANDBOOK_ROOT — the ordinary case.
//   2. the target shares a git COMMON DIR with HANDBOOK_ROOT — a linked worktree of the
//      handbook is still the handbook. Sessions run from a worktree while the repo list
//      names the main checkout, so a path-only test would silently miss exactly when an
//      agent is looking at the output.
//
// Remote (owner/name) targets are out of scope: recognising "self" through the API would
// require the name match this deliberately avoids.

// The predicate itself now lives in tools/lib/stamp.js, shared with `colab update`. It was
// duplicated, and the copies had already drifted: this one compared git common dirs (worktree-safe)
// while the CLI's compared path strings, so the same handbook was exempt here and audited as its
// own consumer there. Only this target-shaped wrapper — kind, `~`, existence — stays local.
function isHandbookItself(target) {
  if (target.kind !== "local") return false;
  const raw = target.path.startsWith("~") ? join(process.env.HOME || "", target.path.slice(1)) : target.path;
  const root = resolve(raw);
  if (!existsSync(root)) return false;
  return stamp.isHandbookItself(root, HANDBOOK_ROOT);
}

// ------------------------------------------------------------------------- checks

const BRANCH_RE = /^(feat|fix|docs|chore|refactor|test|perf)\/[a-z0-9._-]+$/;
const INTEGRATION_BRANCHES = new Set(["main", "dev", "master", "trunk"]);
// Tiers count the GATES between a merge and users: B has no production (0), C promotes and
// that promotion IS the deploy (1), A promotes to verify and a tag deploys (2). They are
// labels, not grades — C is not "worse than B"; B has no production at all.
const VALID_TIERS = new Set(["A", "B", "C"]);
const VALID_DEPLOY = new Set(["tag", "manual", "push-main", "none"]);
// `ceremony` scales memory/record-keeping DEPTH, never the safety rails (claim discipline,
// worktree isolation, reserved ports, squash + Closes #N, CI secret scan + build stay full-
// strength on every value). Omission means "standard" — no existing repo's behaviour changes
// by this field merely existing. `light` is for repos where narration has no reader (follows
// `room`, not production status — #175); the one coherence rule below (vs `autonomy:
// auto-trunk`) keeps it from drifting onto an unattended-merge repo, where an evidence trail
// is needed for a different reason than narration (project.schema.md "ceremony — optional").
const VALID_CEREMONY = new Set(["standard", "light"]);

// `writes` names which write-conflict prevention method a repo's sessions default to —
// a separate axis from both `tier` and `ceremony` (project.schema.md "writes — optional").
// Omission means "isolated", the fleet's status quo, so an unset key changes no behavior.
const VALID_WRITES = new Set(["isolated", "serial"]);
// `room` names who else could ever read what a session writes down — the fourth axis
// (#131). Omission means undeclared, not "solo": nothing infers this from GitHub
// visibility or anything else, and no rule reads it yet (project.schema.md "room — optional").
const VALID_ROOM = new Set(["solo", "team", "public"]);
// `exposure` names what consumes a merge here — the axis `tier`'s gate count will
// eventually be DERIVED from (#132, epic #128 axis 2). Strictly additive alongside `tier`
// in this unit: `tier` stays authoritative, and no rule here reads `exposure` to change a
// `tier`/`trunk`/`deploy`/`production` finding. Omission means undeclared, not "none" —
// exactly like `room`, and for the same reason: the only path to a value is a human
// committing the string. Nothing here infers it from GitHub visibility, `production:`,
// `tier`, or a deploy workflow (project.schema.md "exposure — optional").
const VALID_EXPOSURE = new Set(["none", "self", "live", "released"]);
// `channels` names every path by which a commit reaches something that RUNS it — a
// different question from `deploy`, which names only the trigger that promotes to
// production (#151, epic #128 §2d). Strictly additive alongside `deploy` in this unit:
// `deploy` stays authoritative, and no rule here reads `channels` to change a
// `tier`/`trunk`/`deploy`/`production` finding. A LIST, not a scalar — unlike every other
// axis here — because a repo can genuinely have several channels open at once (a deploy
// workflow AND a machine-local hook AND a tag adopters copy out of); a scalar would force
// picking the most visible one, the exact failure that produced this finding. Omission
// means undeclared, not "none" — the identical asymmetry `exposure` carries, and for the
// identical reason: only a human may write down that nothing runs this code anywhere,
// because every candidate value for an undeclared repo is a claim about an absence that
// nothing here can verify (project.schema.md "channels — optional").
const VALID_CHANNELS = new Set(["workflow", "hook", "procedure", "checkout", "artifact", "data", "none"]);
// `deploy` answers HOW a repo reaches production, never WHETHER it is tier A — the tier
// test is "does a deploy target exist today?". `manual` describes the honest third case:
// production exists, but shipping is a human running a documented runbook (rsync, compose
// up) with no workflow and no tag trigger. Before it existed, such repos had to either
// claim `tier: A, deploy: tag` (and fail the deploy-workflow rule) or claim `tier: B` and
// declare `production: null` — a lie, which §8 calls the worst outcome we can produce.
// `push-main` stays in the enum and always will: for the repos using it, a push to `main`
// GENUINELY triggers the deploy, and a project.yml that describes something other than what
// happens is the worst outcome this tool can produce (§8). It is a legitimate mechanism —
// the finding is on the combination `tier: A` + `push-main` (see the tier A block), because
// tier A's contract requires a release artifact gating production, which this shape has no
// room for. That is a mismatch with the tier, not a defect in the mechanism — and `tier: C`
// is where the mechanism fits, so the finding now has somewhere to point rather than only
// telling repos what they are not.
// NOTE: `stack` is deliberately NOT validated against a closed set. The old enum had
// no value for a Capacitor mobile app and forced one of ours to be mislabelled, so the
// enum was doing harm. It is now free-form documentation.

// ----------------------------------------------------------- exposure/channels falsifiers
//
// #137: the audit cannot CONFIRM a declared "nothing consumes this" claim (`exposure: none`
// / `channels: [none]`) — no local check can prove a negative about the outside world. What
// it CAN do is hunt for cheap repo-local artifacts that CONTRADICT the claim, the same
// falsification posture the rest of this file already takes toward tier/trunk/deploy.
//
// Severity is `warn`, never `fail`, on `exposure`'s own precedent (see the `production:`
// pairing advisory above): a falsifier proves evidence of the class that USUALLY accompanies
// a consumer, not a consumer itself — a repo released years ago and now dead is truthfully
// `exposure: none` today, tag and all. `fail` stays reserved for a descriptor contradicting
// something authoritative INSIDE itself (the tier/trunk/deploy checks above); this is
// evidence from outside the descriptor, which can misfire on a repo that is honestly
// describing its own history.
//
// Reach is deliberately 2 of 5 possible falsifiers, the two answerable from what is already
// on disk or one `gh api` call, with no per-host or cross-repo reads:
//   F1 — a version-shaped tag exists (versionShapedTags, tools/lib/consumer-evidence.js).
//   F5 — a committed deploy path exists: a `deploy-*`/`release-*` workflow (already
//        enumerated by the tier checks — zero new IO), or a `deploy`/`release` basename
//        file directly under the repo root, scripts/, or bin/ (no recursion, so a
//        `templates/deploy-*.yml` — this very repo has one — or an example under docs/ is
//        never mistaken for a live path).
// Three more were named in #137 and deliberately deferred, each for a reason that does not
// go away with more code:
//   F2 (a per-machine service definition serves the path) — the schema already ruled this
//      OUT as a field ("Per-host deploy target — deliberately not a field", project.schema.md):
//      it answers differently on every machine for the same commit, and reading outside the
//      checkout is a line this tool has never crossed.
//   F3 (another repo's stamp names this one as a source) — the stamp vocabulary today has
//      exactly one possible source, the literal string "colab-handbook", which declares
//      `exposure: released` and so could never fire on a `none` claim. Dead code until a
//      later unit generalises the stamp to name an arbitrary source.
//   F4 (a declared `production:` target resolves in DNS) — the repo-local half is already
//      BLESSED: `exposure: none` with a named `production` is the pinned-clean "visibly
//      transitional" read (CONVENTIONS.md §2, audit-exposure.test.js). Firing on it would
//      contradict a shipped ruling. The resolving half needs network, which this tool does
//      not use, and is weak evidence anyway (parked domains, wildcards, CDN catch-alls).
//      What F4 reached for — visibility into a state that has lasted a long time — is served
//      by the duration report below instead.
//
// `exposure: self` gets NO falsifier: `self` claims a consumer set bounded by the room
// (CONVENTIONS.md §2, "Room"), and a tag or a deploy script is perfectly compatible with a
// team shipping to itself — falsifying `self` needs evidence of a consumer OUTSIDE the room,
// which none of F1/F5 are. That falsifier (if one is ever built) is out of scope here.
//
// Non-coupling, by construction: consumerEvidence() reads only the working tree (tags,
// workflow filenames, root/scripts/bin listings) — it never reads `exposureRaw` or
// `channelsRaw`. Each caller below decides independently, from its OWN key only, whether to
// gather evidence at all; neither key's finding is used to compute the other's.

// VERSION_TAG_RE, versionShapedTags, DEPLOY_BASENAME_RE, consumerEvidence and describeEvidence
// moved to tools/lib/consumer-evidence.js (#199) — install.sh freezes tools/lib/ but not audit/,
// so `colab adopt` needed them there. Consumed above via the same createRequire this file already
// uses for stamp.js/labels.js/axis-authority.js. No behaviour change: verified with a byte-diff of
// `audit.mjs --local . --json` before/after the move.

// The raw right-hand side of a top-level `key: value` line in flat project.yml text, comment
// stripped, or undefined when the key is absent. Deliberately not parseFlatYaml: this only
// ever compares two revisions of the SAME key for equality (did the text change), so a raw
// string compare is enough and a second parser implementation is not needed for it.
function yamlRawValue(text, key) {
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`, "m");
  const m = re.exec(text || "");
  if (!m) return undefined;
  return m[1].replace(/\s+#.*$/, "").trim();
}

const DURATION_MIN_DAYS = 180; // below this, silence — see audit-exposure.test.js's pinned
                                // "transitional descriptor is clean" case, which this
                                // threshold exists to keep passing untouched: a descriptor
                                // committed moments ago must never earn a duration line.
const DURATION_DAY_SECONDS = 86400;

// How long `key`'s CURRENT value has held, from the descriptor's own git history — never a
// new field, recomputed every run. Walks descriptorHistory(key) newest -> oldest, reading
// each commit's PARENT blob, and stops at the first commit whose parent disagreed with the
// current value (that commit is when the current value was set). Three ways this degrades
// to a LOWER BOUND instead of a precise date, all handled identically (return the oldest
// commit actually inspected, marked lowerBound): the walk hits its cap without finding a
// disagreement, the oldest matching commit's own parent blob is unreadable (a shallow
// clone's history boundary, or the repo's root commit), or every parent inspected already
// agreed with HEAD (the value has not changed across all of this key's tracked history).
// Returns null — silently — when there is nothing to determine at all: no git, no matching
// commit, or the key is not currently present (nothing to date).
function declaredStateAge(src, key) {
  const history = src.descriptorHistory(key);
  if (!history || !history.length) return null;

  const currentText = src.readFile(".github/project.yml");
  if (currentText === null) return null;
  const currentValue = yamlRawValue(currentText, key);
  if (currentValue === undefined) return null;

  for (const { sha, epoch } of history) {
    const parentText = src.fileAt(`${sha}^`, ".github/project.yml");
    if (parentText === null) return { epoch, lowerBound: true }; // shallow boundary / root commit
    if (yamlRawValue(parentText, key) !== currentValue) return { epoch, lowerBound: false };
  }
  // Exhausted every matching commit (or the walk cap) without a disagreement — the value
  // has held for at least as long as the oldest inspected commit.
  return { epoch: history[history.length - 1].epoch, lowerBound: true };
}

// Prose for a declaredStateAge() result, or null when it is too recent to be worth saying
// (the DURATION_MIN_DAYS gate — the caller must check this before calling warn()).
function renderDuration(age) {
  const days = Math.floor((Date.now() / 1000 - age.epoch) / DURATION_DAY_SECONDS);
  if (days < DURATION_MIN_DAYS) return null;
  const months = Math.floor(days / 30); // coarse on purpose — a report, not a countdown
  return `${age.lowerBound ? "at least " : ""}${months} month${months === 1 ? "" : "s"}`;
}

function auditRepo(target, ctx) {
  const src = makeSource(target);
  const findings = []; // { level: 'fail'|'warn', text }
  // `self` = this target IS the handbook, not one of its consumers. Surfaced in the
  // report (and in --json) so the row reads as source-of-truth rather than clean-by-luck:
  // a silent skip is indistinguishable from a check that quietly stopped working.
  const isSelf = isHandbookItself(target);
  const info = { repo: src.label, kind: src.kind, tier: null, exposure: null, channels: null, self: isSelf, findings: [] };

  const fail = (t) => findings.push({ level: "fail", text: t });
  const warn = (t) => findings.push({ level: "warn", text: t });

  if (!src.exists) {
    fail(`path does not exist: ${target.path}`);
    return finish();
  }

  // ---- .github/project.yml -------------------------------------------------
  const rawCfg = src.readFile(".github/project.yml");
  let cfg = null;
  if (rawCfg === null) {
    fail("no .github/project.yml — repo is undescribed (tier/trunk/deploy unknown)");
  } else {
    const { data, problems } = parseFlatYaml(rawCfg);
    problems.forEach((p) => fail(`project.yml: ${p}`));
    cfg = data;
    // `tier` is deliberately NOT in this list as of #144: it used to be the sole axis of
    // record and therefore unconditionally required, but a descriptor may now answer the
    // gate-count question with `exposure` instead — see the "axis of record" check below,
    // which fails exactly once when NEITHER key is present. `trunk`/`production`/`deploy`/
    // `stack` are unrelated to that flip and stay required unconditionally.
    const required = ["trunk", "production", "deploy", "stack"];
    // `production: null` is legal and meaningful for Tier B, so test key PRESENCE,
    // not truthiness.
    const missing = required.filter((k) => !(k in data));
    if (missing.length) fail(`project.yml: missing key(s): ${missing.join(", ")}`);
  }

  // Read once, early, so both the tier/deploy checks further down AND the exposure/
  // channels falsifiers (#137) can reuse the same listing — the falsifiers' F5 evidence
  // is explicitly "zero new IO" over what the tier checks already enumerate.
  const workflows = src.listDir(".github/workflows").filter((f) => /\.ya?ml$/.test(f));

  const tier = cfg?.tier ?? null;
  const trunk = cfg?.trunk ?? null;
  const production = cfg?.production ?? null;
  const deploy = cfg?.deploy ?? null;
  // #144: which key is the axis of record for gate count — set inside `if (cfg)` below
  // (an unparseable/missing project.yml already fails earlier and has nothing to derive
  // from). Declared here so both halves of the decomposition — the legacy trunk-shape
  // check inside that block, and the deploy/production dispatch further down, outside it —
  // can read the same computation.
  let authority = null;
  // Omission means "standard" (#9 step 3's "no existing repo changes behavior" guarantee) —
  // so the raw value (possibly absent) is what gets validated against the enum, while the
  // defaulted value is what the coherence rules below reason from.
  const ceremonyRaw = "ceremony" in (cfg || {}) ? cfg.ceremony : null;
  const ceremony = ceremonyRaw ?? "standard";
  const autonomy = cfg?.autonomy ?? null;
  info.tier = tier;
  // Raw, no `?? default` — the load-bearing line for the "lowering exposure is a human
  // act" asymmetry (#132): there is no defaulted `exposure` variable anywhere in this
  // file, so no rule can accidentally reason from a synthesised value, and `--json`
  // reports `null` (undeclared) rather than "none" (declared: nothing consumes this).
  const exposureRaw = "exposure" in (cfg || {}) ? cfg.exposure : null;
  info.exposure = exposureRaw;
  // Raw, no `?? default` — the identical asymmetry, for the identical reason (#151):
  // `--json` reports `null` (undeclared) rather than `["none"]` (declared: nothing runs
  // this code anywhere).
  const channelsRaw = "channels" in (cfg || {}) ? cfg.channels : null;
  info.channels = channelsRaw;

  if (cfg) {
    // Gated on presence, unlike before #144: `tier` left the `required` list above, so an
    // absent tier is no longer itself a finding here — the axis-of-record check below
    // (which runs whether or not `exposure` fills the gap) is what reports an undescribed
    // repo now. A PRESENT-but-invalid value is still reported exactly as before.
    if (tier !== null && !VALID_TIERS.has(tier)) fail(`tier is ${JSON.stringify(tier)}, expected "A", "B" or "C"`);
    if (deploy !== null && !VALID_DEPLOY.has(deploy)) fail(`deploy is ${JSON.stringify(deploy)}, expected one of: ${[...VALID_DEPLOY].join(", ")}`);
    // Only when the key exists but is blank — a wholly absent key is already
    // reported by the missing-keys check above, and saying it twice is noise.
    if ("stack" in cfg && (cfg.stack === null || cfg.stack === "")) warn("stack is empty — set a free-form string describing the stack");
    if (ceremonyRaw !== null && !VALID_CEREMONY.has(ceremonyRaw)) fail(`ceremony is ${JSON.stringify(ceremonyRaw)}, expected "standard" or "light" (omit for standard)`);

    // ---- ceremony coherence (#79, narrowed by #175) --------------------------
    // `light` relaxes memory-ceremony DEPTH only. #175 removed the `production: null`
    // rule this used to carry: narration follows the ROOM (a live single-operator repo's
    // trail still has one reader, live or not), recoverability follows exposure and
    // irreplaceable state, and welding the two together forbade the first and was silent
    // on the second. The one guarantee left here protects anyone other than this repo's
    // own history: an unattended merge needs an evidence trail exactly when nobody
    // watched it happen.
    if (ceremony === "light") {
      if (autonomy === "auto-trunk") {
        fail(`ceremony: light is incompatible with autonomy: auto-trunk — an unattended merge with no evidence trail is a closure nobody can audit. Keep autonomy: auto-trunk and use ceremony: standard, or drop autonomy to manual`);
      }
    }

    // ---- writes axis (#133) --------------------------------------------------
    // Deliberately NOT coupled to tier/production/exposure — see CONVENTIONS.md §2 and
    // project.schema.md.
    const writesRaw = "writes" in (cfg || {}) ? cfg.writes : null;
    if (writesRaw !== null && !VALID_WRITES.has(writesRaw)) fail(`writes is ${JSON.stringify(writesRaw)}, expected "isolated" or "serial" (omit for isolated)`);

    // ---- room axis (#131) ----------------------------------------------------
    // Enum sanity only — the same shape as ceremony/writes above. #131 introduces the
    // field's meaning; nothing here infers a repo's room from GitHub visibility or
    // anything else, and no downstream rule reads this value yet. A later unit may add
    // one; until it does, `room` is a declared fact this check only spell-checks.
    const roomRaw = "room" in (cfg || {}) ? cfg.room : null;
    if (roomRaw !== null && !VALID_ROOM.has(roomRaw)) fail(`room is ${JSON.stringify(roomRaw)}, expected "solo", "team" or "public" (omit if undeclared)`);

    // ---- exposure axis (#132) -------------------------------------------------
    // Enum sanity, plus exactly one pairing advisory — the same restrained shape as
    // room/writes above. `tier` stays authoritative in this unit; nothing here changes
    // any tier/trunk/deploy/production finding, and no rule couples exposure to tier
    // (CONVENTIONS.md §2 "Exposure", project.schema.md "exposure — optional": "do not add
    // one" mirrors the writes axis's own instruction, for the same reason).
    if (exposureRaw !== null && !VALID_EXPOSURE.has(exposureRaw)) {
      fail(`exposure is ${JSON.stringify(exposureRaw)}, expected one of: none, self, live, released (omit if undeclared)`);
    }
    // The one case that asserts BOTH "nothing consumes this" AND "there is nothing to
    // point at" — advisory, not a failure: the descriptor isn't lying (nothing here can
    // verify absence of a consumer), it's unanswered, and answering it is a human act
    // (#128 ruling) this unit does not perform. A `fail` here would make declaring the
    // key riskier than omitting it, which would suppress exactly the opt-in adoption data
    // a later unit needs.
    if (exposureRaw === "none" && (production === null || production === "")) {
      warn(`exposure: none and production: null — either nothing is left to reach here, or nobody has answered the exposure question yet. Both read the same to this tool; a human should confirm which`);
    }
    // ---- exposure falsifier + duration report (#137) --------------------------
    // Gated on the raw value alone — `self`/`live`/`released`/undeclared never reach here,
    // so an outside adopter who has not opted into this axis does no new IO at all. See the
    // "exposure/channels falsifiers" block above for the full argument (severity, the 2-of-5
    // reach, why `self` gets nothing here).
    if (exposureRaw === "none") {
      const evidenceLine = describeEvidence(consumerEvidence(src, workflows));
      if (evidenceLine) {
        warn(
          `exposure: none is contradicted by repo evidence — ${evidenceLine}. This does not ` +
          `prove a live consumer (a repo released years ago and now dead is truthfully ` +
          `exposure: none) — it means the claim is worth a second look, not that it is wrong`,
        );
      }
      const exposureAge = declaredStateAge(src, "exposure");
      const durationLine = exposureAge && renderDuration(exposureAge);
      if (durationLine) {
        warn(`exposure: none has held for ${durationLine} (per the descriptor's own git history) — visible so a long-running transitional state does not go unnoticed`);
      }
    }

    // ---- channels axis (#151) -------------------------------------------------
    // Shape + enum sanity, a descriptor-internal coherence advisory, and — when the shape is
    // exactly `[none]` — the repo-evidence falsifier and duration report (#137, wired below,
    // gated on `channelsRaw` alone so it never reads `exposureRaw`). `deploy` stays
    // authoritative in this unit; nothing here changes any tier/trunk/deploy/production
    // finding, and no rule couples `channels` to `exposure` (CONVENTIONS.md §2 "Channels",
    // project.schema.md "channels — optional": deliberately not paired, mirroring the writes
    // axis's own "do not add one" instruction).
    if (channelsRaw !== null) {
      if (!Array.isArray(channelsRaw)) {
        fail(`channels is ${JSON.stringify(channelsRaw)}, expected a list (e.g. [workflow]) — a bare scalar is not a valid shape`);
      } else if (channelsRaw.length === 0) {
        fail(`channels is an empty list — that is not an answer; declare [none] if nothing runs this code anywhere, or omit the key if undeclared`);
      } else {
        const unknown = channelsRaw.filter((c) => !VALID_CHANNELS.has(c));
        const deduped = [...new Set(channelsRaw)];
        if (unknown.length) {
          fail(`channels contains ${JSON.stringify(unknown)}, expected members of: ${[...VALID_CHANNELS].join(", ")}`);
        } else if (deduped.length !== channelsRaw.length) {
          // #197's second ruling: a duplicate member (even of an otherwise-valid value, e.g.
          // `[workflow, workflow]`) previously passed silently — only `[none, none]` was ever
          // caught, and only incidentally, via the exclusivity check below. Same severity as
          // every other shape rule in this block (`fail`): a duplicate is a malformed answer,
          // not a real one, same class as the empty-list and unknown-member cases above.
          fail(`channels contains a duplicate member (${JSON.stringify(channelsRaw)}) — declare each channel once: ${JSON.stringify(deduped)}`);
        } else if (channelsRaw.includes("none") && channelsRaw.length > 1) {
          fail(`channels combines "none" with another value (${JSON.stringify(channelsRaw)}) — "none" means nothing runs this code anywhere and must stand alone`);
        } else if (
          channelsRaw.length === 1 &&
          channelsRaw[0] === "none" &&
          ((production !== null && production !== "") || (deploy !== null && deploy !== "none"))
        ) {
          // The one advisory: "nothing runs this code anywhere" against a fact already
          // authoritative elsewhere in the same descriptor that says otherwise. `warn`,
          // never `fail`, on exposure's precedent — a `fail` would make declaring the key
          // riskier than omitting it.
          warn(`channels: [none] together with production: ${JSON.stringify(production)} / deploy: ${JSON.stringify(deploy)} — either nothing actually runs this code, or channels was declared before the rest of the descriptor was; a human should confirm which`);
        }

        // ---- channels falsifier + duration report (#137) --------------------
        // Gated on the validated shape alone (length 1, "none") — a standalone check, not a
        // branch of the if/else-if chain above, but the condition alone already implies
        // `unknown` is empty and nothing else is combined with "none" ("none" is a member of
        // VALID_CHANNELS and length 1 excludes the multi-value case). See the "exposure/
        // channels falsifiers" block above for the full argument.
        if (channelsRaw.length === 1 && channelsRaw[0] === "none") {
          const evidenceLine = describeEvidence(consumerEvidence(src, workflows));
          if (evidenceLine) {
            warn(
              `channels: [none] is contradicted by repo evidence — ${evidenceLine}. This does ` +
              `not prove a live consumer — it means the claim is worth a second look, not that ` +
              `it is wrong`,
            );
          }
          const channelsAge = declaredStateAge(src, "channels");
          const durationLine = channelsAge && renderDuration(channelsAge);
          if (durationLine) {
            warn(`channels: [none] has held for ${durationLine} (per the descriptor's own git history) — visible so a long-running transitional state does not go unnoticed`);
          }
        }
      }
    }

    // ---- axis of record (#144) -----------------------------------------------
    // Which key governs gate count: `exposure` when declared (it wins outright — see
    // tools/lib/axis-authority.js for why this is a function, not a bijection, of `tier`),
    // else a LEGACY read derived from `tier` (byte-identical to pre-#144 behaviour for every
    // descriptor that has not declared `exposure`), else neither — the one new hard failure
    // this unit adds, replacing the old unconditional "missing key(s): tier".
    authority = axisAuthority.axisOfRecord(cfg);
    if (authority.source === "none") {
      fail("project.yml: no axis of record — neither tier nor exposure is declared. Set one (CONVENTIONS.md §2)");
    } else if (authority.tier !== null && VALID_TIERS.has(authority.tier) && authority.source === "exposure") {
      // Both declared. Consistent -> silent (no nag to delete `tier`; carrying both is fine
      // and this repo's own descriptor models exactly that). Inconsistent -> exactly one
      // fail naming the disagreement; the `exposure` branch below still enforces afterward.
      const disagreement = axisAuthority.contradiction(authority.tier, authority.exposure);
      if (disagreement) fail(disagreement);
    }
    // The one new advisory this unit ships, and it is dormant today: activates only once
    // the HANDBOOK ITSELF (not this repo's stamp) reaches AUTHORITY_FLIP_VERSION, mirroring
    // the `hb.untagged` precedent `compareStamp` already uses elsewhere in this file. Gated
    // on `tier-legacy` only — a repo that already declared `exposure` has nothing to be
    // nudged about.
    if (
      authority.source === "tier-legacy" &&
      !ctx.handbook.untagged && ctx.handbook.hasGit &&
      cmpSemver(ctx.handbook.version, stamp.AUTHORITY_FLIP_VERSION) >= 0
    ) {
      warn(
        `exposure is undeclared — tier is now read as a LEGACY value (tier ${authority.tier} -> ` +
        `exposure: ${authority.exposure ?? "null"}) rather than the axis of record. Declare ` +
        `exposure: explicitly to opt in (CONVENTIONS.md §2)`,
      );
    }

    // ---- tier <-> trunk coherence, legacy voice ------------------------------
    // Runs ONLY on the `tier-legacy` path (no `exposure` declared) and is otherwise
    // UNCHANGED from before #144 — this is the half of the decomposition that must stay
    // byte-identical for every descriptor without `exposure` (#144's primary oracle). The
    // canonical Tier A shape is the dev/main split — sessions land on dev, main is the
    // release branch — which buys a place for the expensive suite to run at promotion time.
    // But a TAG-GATED A may run a SINGLE trunk `main`: when a version tag gates production,
    // the tag itself marks the release boundary, so a second branch marking the same
    // boundary (dev vs main) is redundant. The tier is defined by the promotion GATE (a
    // deliberate release artifact — the tag), not the trunk NAME, so `main` is coherent here
    // — and ONLY here. `deploy: manual`/`push-main` have no tag to mark the boundary, so
    // they keep the dev split and its promotion as the ship-ward act.
    if (authority.source === "tier-legacy") {
      if (tier === "A" && trunk !== "dev" && !(deploy === "tag" && trunk === "main")) {
        fail(deploy === "tag"
          ? `tier A with deploy: tag requires trunk "dev" or "main", found ${JSON.stringify(trunk)}`
          : `tier A requires trunk "dev", found ${JSON.stringify(trunk)} — only a tag-gated A (deploy: tag) may run a single trunk "main"`);
      }
      if (tier === "B" && trunk !== "main") fail(`tier B requires trunk "main", found ${JSON.stringify(trunk)}`);
      // C uses A's two-branch split: main = what is live, dev = where sessions land.
      if (tier === "C" && trunk !== "dev") fail(`tier C requires trunk "dev", found ${JSON.stringify(trunk)} — C uses the same split as A (main = what is live, dev = where sessions land)`);
    }
  }

  // Additive `--json` keys only (#144's oracle: "`tier` continues to report the DECLARED
  // letter... New keys are additive"). `axisOfRecord` names which key governs
  // ('exposure' | 'tier-legacy' | 'none' | null when project.yml itself did not parse);
  // `gates` is the gate count that resolves to, when known.
  info.axisOfRecord = authority ? authority.source : null;
  info.gates = authority && authority.exposure ? (axisAuthority.GATE_COUNT[authority.exposure] ?? null) : null;

  // ---- convention labels present on the tracker ---------------------------
  // A convention label absent from an adopted repo is a check that can never fire: the
  // claim (`in-progress`) cannot land, the readiness column (`deps-checked`) can never
  // leave "nobody looked", provenance (`agent-filed`) reads every filed issue as human-
  // approved. It happens when a repo adopted at an OLDER handbook version, before a label
  // entered the set, and nothing back-filled it — so a repo missing the label passes clean
  // while a downstream board keeps advising "run triage to fill the column", a no-op.
  //   Gated on `cfg`: an undescribed repo already fails above, and labels are meaningless
  // without adoption. `labels()` is null for a remote-less or offline audit (see
  // listRemoteLabels) — we stay silent there, since we cannot assert a label is missing
  // when we could not read the set. A warn, not a fail: the fix is one `gh label create`,
  // it breaks no build and it does not make the descriptor lie.
  if (cfg) {
    const labels = src.labels();
    if (labels) {
      const missing = missingConventionLabels(labels);
      if (missing.length) {
        warn(
          `missing convention label(s): ${missing.join(", ")} — a repo adopted before a ` +
          `label entered the set never back-filled it, so the check it powers can never ` +
          `fire. Create each (\`gh label create\`, see CONVENTIONS.md §9) or run handbook-sync`,
        );
      }
    }
  }

  // ---- CLAUDE.md is a router, not an archive (#64) -------------------------
  // Unconditional: this is a repo-doc concern, not a tier/deploy one, and it applies to
  // the handbook's OWN CLAUDE.md too (not a stamp check, so it is not gated on !isSelf).
  checkClaudeMdSize(src, warn);

  // ---- markdown anchor links resolve (#158) --------------------------------
  // Unconditional, same posture as checkClaudeMdSize above: general markdown hygiene,
  // not a stamp/tier concern, applies to the handbook's own docs unchanged. A `§N`
  // prose citation is invisible to this on purpose — only an actual `](file#slug)`
  // link is checked, so the ~280 not-yet-migrated citations produce zero findings.
  checkAnchorLinks(src, fail);

  // ---- deploy workflow presence -------------------------------------------
  const deployWorkflows = workflows.filter((f) => /^deploy[-.]/.test(f));

  const runbook = cfg && "runbook" in cfg ? cfg.runbook : null;

  // ---- gate contract, dispatched by axis of record (#144) ------------------
  // `authority` is null only when project.yml itself did not parse (already failed above,
  // nothing to derive from). `tier-legacy` runs the UNCHANGED tier-voiced block — the half
  // that must stay byte-identical for every descriptor without `exposure`. `exposure` runs
  // the new exposure-voiced rules below: the DECOMPOSITION #144's plan calls for. No branch
  // in the exposure-voiced half ever reads `tier` — proof the split was cut in the right
  // place. `none` (no axis of record at all) already got its one fail above; there is
  // nothing further to derive a gate contract from.
  if (authority && authority.source === "tier-legacy") {
    if (tier === "A") {
      // The answer to "how does this reach production?" must be committed. A CI-driven deploy commits
      // it as an in-repo deploy-*.yml; a deploy that runs OUTSIDE CI must instead be WRITTEN DOWN in a
      // runbook: — the same invariant, honoured two ways. Two shapes deploy outside CI:
      //   - deploy: manual              → a human runs the runbook.
      //   - deploy: tag with no workflow → an EXTERNAL deployer (a GitOps poller fast-forwards a
      //                                    release branch on the tag, or the like) ships it; the
      //                                    runbook documents that path. A deploy: tag repo whose own
      //                                    CI holds the deploy job keeps its deploy-*.yml and needs no
      //                                    runbook — the workflow already commits the answer.
      const externalTagDeploy = deploy === "tag" && !deployWorkflows.length;
      if (deploy === "manual") {
        checkRunbook(src, runbook, fail, warn, "deploy: manual");
      } else if (externalTagDeploy) {
        checkRunbook(src, runbook, fail, warn, "deploy: tag deployed outside CI (an external GitOps poller)");
      } else if (!deployWorkflows.length) {
        fail("tier A but no .github/workflows/deploy-*.yml — the path to production is not in the repo (use deploy: manual + runbook: if it ships by hand, or deploy: tag + runbook: when a GitOps poller deploys the tag from outside CI)");
      }
      if (production === null || production === "") fail("tier A but production is null — set the live URL, or drop to tier B");
      if (deploy === "none") fail('tier A with deploy: none is contradictory — use "tag" or "manual"');
      // A TIER MISMATCH, not a bad mechanism. push-main is a perfectly good way to deploy;
      // it just cannot satisfy tier A's contract, which is that a deliberate release artifact
      // gates production. Here every push to main reaches users, so that gate does not exist.
      // The message says "options include" on purpose: the two named exits are not exhaustive
      // and must not read as though they were.
      if (deploy === "push-main") {
        fail(
          "tier A with deploy: push-main — tier A's contract is that a deliberate release " +
          "artifact gates production, and here every push to main reaches users with no such " +
          "gate. Options include: retier to C (tier C is exactly this shape — promotion IS the " +
          "deploy — and is the honest home for a live, low-stakes site), migrate the pipeline " +
          "to a tag trigger (deploy: tag), or — if shipping really is run by hand — " +
          "deploy: manual plus runbook: naming the committed procedure.",
        );
      }
    } else if (tier === "C") {
      // C = "promotion IS the deploy": one gate (the dev→main merge) stands between a merge and
      // users. It exists because a tag ritual nobody honours is worse than no tag ritual — a
      // live low-stakes site had nowhere honest to sit, so it claimed A and failed A's contract.
      if (production === null || production === "") fail("tier C but production is null — tier C is for repos that ARE live; set the live URL, or drop to tier B");
      if (!deployWorkflows.length) fail("tier C but no .github/workflows/deploy-*.yml — the path to production is not in the repo");
      // C is defined by its mechanism: the promotion itself deploys. Any other `deploy` value
      // describes a DIFFERENT number of gates, which is a different tier — so each wrong value
      // is redirected to the tier that actually matches it, rather than being merely rejected.
      if (deploy !== "push-main") {
        if (deploy === "tag") {
          fail('tier C with deploy: tag — a tag gating production is tier A\'s shape (promotion verifies, the tag deploys = two gates). If you really have a tag ritual, you are tier A; if the tag is aspirational, drop it and use deploy: push-main');
        } else if (deploy === "manual") {
          fail('tier C with deploy: manual — there the promotion does NOT deploy (a human running the runbook does), which is tier A with deploy: manual. Retier to A, or use deploy: push-main if the promotion itself ships');
        } else if (deploy === "none") {
          fail('tier C with deploy: none is contradictory — tier C means the promotion deploys. Use deploy: push-main, or drop to tier B if nothing is live');
        } else {
          fail(`tier C requires deploy: push-main, found ${JSON.stringify(deploy)} — C is defined as "promotion IS the deploy"`);
        }
      }
    } else if (tier === "B") {
      // This was silently unchecked before: a tier B repo that actually deploys is
      // either mistiered or shipping to production with none of the tier A gates.
      if (deploy !== null && deploy !== "none") fail(`tier B must have deploy: none, found ${JSON.stringify(deploy)} — if this really deploys, retier: C when the promotion itself ships, A when a tag or a runbook gates it`);
      if (production !== null && production !== "") fail(`tier B must not declare a production URL, found ${JSON.stringify(production)} — retier to C (promotion deploys) or A (a tag/runbook gates the deploy)`);
      if (deployWorkflows.length) fail(`tier B but a deploy workflow exists (${deployWorkflows.join(", ")}) — retier to C or A, or delete it`);
    }
  } else if (authority && authority.source === "exposure") {
    const exp = authority.exposure; // already enum-validated above: none | self | live | released | garbage
    if (exp === "self") {
      // CONVENTIONS.md §2, "Exposure": self's consumer set is a subset of the room's — no
      // mechanism or contract rule applies here AT ALL, not even trunk shape. An unusual
      // deploy/production/trunk combination alongside a directly-declared `exposure: self`
      // is not this unit's business to police (#144's plan: "self gets no mechanism rule").
    } else if (exp === "none") {
      // Deliberately NOT "production must be null, deploy must be none": `exposure: none`
      // with a NAMED `production` is the pinned-clean "visibly transitional" read
      // (CONVENTIONS.md §2, "Exposure"; project.schema.md "exposure — optional") — a repo
      // heading toward a consumer it has not opted into yet. A `fail` there would punish
      // exactly the direction an agent may propose, which the schema explicitly forbids.
      // What stays a real contradiction: claiming trunk shape or a wired-up deploy path for
      // a repo that says nothing consumes it.
      if (trunk !== "main") fail(`exposure: none requires trunk "main", found ${JSON.stringify(trunk)} — nothing consumes this repo, so there is no release branch to speak of`);
      if (deployWorkflows.length) fail(`exposure: none but a deploy workflow exists (${deployWorkflows.join(", ")}) — nothing is supposed to consume this repo, yet something is wired to deploy it`);
    } else if (exp === "live") {
      // Mirrors the old tier C contract exactly, INCLUDING its no-runbook asymmetry: a
      // deploy workflow is required, with no runbook: escape hatch — #144's plan records
      // this as a deliberate ruling, not an oversight (CONVENTIONS.md §2, "Exposure").
      if (trunk !== "dev") fail(`exposure: live requires trunk "dev", found ${JSON.stringify(trunk)} — the promotion is the deploy, and dev is where sessions land before it ships`);
      if (production === null || production === "") fail("exposure: live but production is null — the promotion ships straight to users, so a live URL must be set");
      if (deploy !== "push-main") fail(`exposure: live requires deploy: push-main, found ${JSON.stringify(deploy)} — the promotion itself IS the deploy`);
      if (!deployWorkflows.length) fail("exposure: live but no .github/workflows/deploy-*.yml — the promotion needs a committed path to production (no runbook: escape hatch here — live means the promotion itself deploys)");
    } else if (exp === "released") {
      // Two legal shapes (#144's plan) — the decomposition's whole point: (1) a live
      // production URL with a committed deploy path, mirroring the old tier A contract; or
      // (2) no server at all, evidenced by a version-shaped git tag or channels: [artifact]
      // — the shape THIS repo's own descriptor is (production: null, channels: [artifact]),
      // which the old tier: B weld could never express.
      const hasProduction = production !== null && production !== "";
      if (!hasProduction) {
        const hasArtifactEvidence = versionShapedTags(src.tags()).length > 0 || (Array.isArray(channelsRaw) && channelsRaw.includes("artifact"));
        // `warn`, deliberately never `fail` (#144's plan, "rulings"): raising exposure —
        // proposing `released` ahead of the evidence that would confirm it — is the
        // direction an agent may propose, and a `fail` here would make declaring the key
        // riskier than omitting it, punishing exactly the adoption this axis exists to
        // invite. Mirrors `exposure: none` + `production: null`'s own advisory-not-failure
        // precedent above.
        if (!hasArtifactEvidence) {
          warn(
            "exposure: released with production: null and no evidence of a release artifact " +
            "(no version-shaped git tag, no channels: [artifact]) — either the evidence has not " +
            "landed yet, or this should read exposure: self/none for now. Both look the same to " +
            "this tool; a human should confirm which",
          );
        }
        if (trunk !== "main") fail(`exposure: released with production: null requires trunk "main", found ${JSON.stringify(trunk)} — nothing is live, so there is no release branch to speak of`);
        if (deploy !== null && deploy !== "none") fail(`exposure: released with production: null and deploy: ${JSON.stringify(deploy)} is contradictory — nothing is live to deploy to; use deploy: none, or set production if something IS live`);
      } else {
        const externalTagDeploy = deploy === "tag" && !deployWorkflows.length;
        if (deploy === "manual") {
          checkRunbook(src, runbook, fail, warn, "exposure: released, deploy: manual");
        } else if (externalTagDeploy) {
          checkRunbook(src, runbook, fail, warn, "exposure: released, deploy: tag deployed outside CI (an external GitOps poller)");
        } else if (!deployWorkflows.length) {
          fail("exposure: released but no .github/workflows/deploy-*.yml — the path to production is not in the repo (use deploy: manual + runbook: if it ships by hand, or deploy: tag + runbook: when a GitOps poller deploys the tag from outside CI)");
        }
        if (deploy === "none") fail('exposure: released with a live production URL but deploy: none is contradictory — use "tag" or "manual"');
        if (deploy === "push-main") {
          fail(
            "exposure: released with deploy: push-main — released means a deliberate release " +
            "artifact gates production, and here every push to main reaches users with no such " +
            "gate. Options include: declare exposure: live instead (that IS this shape), migrate " +
            "the pipeline to a tag trigger (deploy: tag), or — if shipping really is run by hand " +
            "— deploy: manual plus runbook: naming the committed procedure.",
          );
        }
        if (trunk !== "dev" && !(deploy === "tag" && trunk === "main")) {
          fail(deploy === "tag"
            ? `exposure: released with deploy: tag requires trunk "dev" or "main", found ${JSON.stringify(trunk)}`
            : `exposure: released requires trunk "dev", found ${JSON.stringify(trunk)} — only a tag-gated release (deploy: tag) may run a single trunk "main"`);
        }
      }
    }
  }

  // ---- declared trunk actually exists -------------------------------------
  const branches = src.branches();
  if (trunk && branches === null) {
    warn(`cannot list branches (not a git checkout, or gh unavailable) — trunk "${trunk}" unverified`);
  } else if (trunk && branches && !branches.includes(trunk)) {
    fail(`declared trunk "${trunk}" does not exist (branches: ${branches.slice(0, 6).join(", ")}${branches.length > 6 ? ", …" : ""})`);
  }

  // ---- the main checkout is on trunk at rest -------------------------------
  // Other things read a repo's working tree — a dev server, a symlink, a LaunchAgent —
  // and none of them know a session branched it. We branched one repo's main checkout
  // for a chore; it ran always-on from that tree, so the live app served unmerged
  // feature-branch code until a human noticed by eye. Sessions belong in a worktree;
  // a checkout parked on a feature branch is the failure, not the work.
  // Remote (owner/name) targets have no checkout, so currentBranch() is null there —
  // stay silent rather than invent a violation, as with `branches === null` above.
  //
  // Decision (#204): only fire when trunk has (or had) a LOCAL ref here. `git clone
  // --branch main` of a conforming Tier A/C repo legitimately leaves the checkout on
  // "main" with trunk ("dev") existing only as `origin/dev` — that checkout was never on
  // trunk, so "return the checkout to dev" is not advice, it is noise: there is nothing to
  // return it to. A checkout that once had trunk locally and has since drifted onto
  // another branch is the actual failure this check exists for, so that case still fires
  // exactly as before — the branch-existence fix above (union with refs/remotes) is
  // deliberately NOT reused here; `localBranches()` keeps the local/remote distinction
  // this specific decision turns on.
  const head = src.currentBranch();
  const localBranches = src.localBranches ? src.localBranches() : null;
  const trunkEverLocal = Array.isArray(localBranches) && localBranches.includes(trunk);
  if (trunk && head && head !== "HEAD" && head !== trunk && !src.isLinkedWorktree() && trunkEverLocal) {
    fail(`main checkout is on "${head}", not trunk "${trunk}" — anything reading this working tree (dev server, symlink, LaunchAgent) is serving that branch. Move the work to a worktree and return the checkout to ${trunk}`);
  }

  // ---- integration lines (optional, dev-side only) -------------------------
  // A declared long-lived line that worktrees may be cut from and shipped back into. It is NOT a
  // second trunk: nothing in the promote / tag / deploy path reads this field, which is what keeps
  // such a line unable to reach production BY CONSTRUCTION rather than by discipline. The tier↔trunk
  // coherence check above is deliberately untouched — relaxing `trunk:` was the rejected design,
  // because on tiers A and C trunk IS the branch promotion consumes.
  const integration = checkIntegration(cfg, trunk, branches, fail, warn);
  // Declared lines are integration points, so they inherit trunk's exemptions: the §4 branch-name
  // regex does not apply to them, and a workflow naming one is not referencing a ghost.

  // ---- release branch (optional, production-side, opposite axis from integration) ----
  // Names the branch an EXTERNAL GitOps poller fast-forwards on tag, in the single-trunk
  // tag-gated shape (trunk: main). Unlike integration lines this is a PRODUCTION ref — it
  // grants no worktree base, nothing here adds it to allowedBases() — but it needs the same
  // naming-regex and ghost-branch exemptions integration lines get, for the same reason: it
  // is a long-lived name a workflow or a human may reasonably reference. Its real payoff is
  // in `colab doctor` (tools/colab), which otherwise reads it as a spent branch between
  // releases and advises deleting a live deploy target (#63).
  const releaseBranch = checkReleaseBranch(cfg, trunk, branches, fail, warn, deploy);
  const exemptList = releaseBranch ? [...integration, releaseBranch] : integration;
  const exempt = exemptList.length ? new Set([...INTEGRATION_BRANCHES, ...exemptList]) : INTEGRATION_BRANCHES;

  // ---- branch naming -------------------------------------------------------
  // Deliberately LOCAL branches only, not the refs/remotes-inclusive `branches` union above
  // (#204). "Does trunk exist" and "is a workflow's trigger a ghost" are existence
  // questions, where a remote-only branch is as real as a local one. Naming convention is a
  // different question — it is about what THIS checkout's own history has produced — and
  // widening it to every branch that has ever touched the remote pulls in every worktree
  // session, past or present, from every machine and every collaborator: measured against
  // the live fleet, that turned a quiet advisory into a double-digit list on several repos,
  // none of it actionable from here. `localBranches()` is null for a remote (owner/name)
  // target (no local checkout to have local refs), so that case still falls back to the
  // full API list `branches()` already gave it — unaffected by this distinction, exactly as
  // before this fix.
  const branchesForNaming = localBranches !== null ? localBranches : branches;
  if (branchesForNaming) {
    const bad = branchesForNaming.filter((b) => !exempt.has(b) && !BRANCH_RE.test(b));
    if (bad.length) {
      warn(`branch name(s) off-convention: ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? ` (+${bad.length - 4})` : ""} — want <type>/<slug>`);
    }
  }

  // ---- trunk is CI-gated ---------------------------------------------------
  // Merges land on the trunk as PUSHES; if no CI workflow triggers on push to the
  // declared trunk, every merge runs zero CI while everyone believes it is gated.
  checkTrunkCiGated(src, trunk, workflows, branches, fail, warn, { integration, exempt });

  // ---- toolchain agreement -------------------------------------------------
  // Report disagreement; never auto-resolve. Three sources can disagree: the
  // descriptor, the ecosystem manifest, and what the workflows actually pin.
  const tool = collectToolchain(src, cfg, workflows);
  tool.findings.forEach((f) => findings.push(f));

  // ---- handbook reconciliation (stamps) -----------------------------------
  // EXEMPTION, not suppression, and scoped by CONSTRUCTION: a single guarded STATEMENT
  // rather than `if (!isSelf) { … }`, so a check somebody adds next to this one cannot
  // silently inherit the exemption by landing inside the block. The handbook is not
  // exempt from its own rules — every check above runs on it unchanged — it is exempt
  // only from being audited as its own consumer.
  //
  // Note this is narrower than it may look: one of our Python+Node hybrids emits the
  // SAME two advisory lines, legitimately (its ci.yml really is an unstamped copy).
  // Identical text, opposite meanings — nothing here may generalise to that row.
  // ---- adoption compatibility window (#138) --------------------------------
  // An old descriptor must report as PREDATING this version, never as broken — reusing
  // the stamp machinery already above rather than a new mechanism. Missing axes are
  // "undeclared" on every repo (#131/#132/#133/#151's own asymmetry: never a default,
  // never nagged on their own); this adds exactly one extra fact when a repo's CLAUDE
  // stamp names a handbook version at which those axes did not yet exist in
  // project.schema.md — the marker is not lying, it is simply from before the question
  // was ever asked.
  const missingAxes = cfg ? stamp.AXES.filter((a) => !(a in cfg)) : [];
  info.predatesAxes = [];
  if (!isSelf) checkStamps(src, ctx.handbook, ctx.templateNames, fail, warn, { ceremony, missingAxes, predatesAxes: info.predatesAxes });

  function finish() {
    info.findings = findings;
    info.ok = !findings.some((f) => f.level === "fail");
    info.clean = findings.length === 0;
    return info;
  }
  return finish();
}

// `integration:` — the declared dev-side axis. Optional; absent is the normal case.
//
// It answers one question: which OTHER long-lived branches may a worktree legitimately be cut from
// and shipped back into? A team keeping a line for a release months out otherwise has nowhere to put
// it, and the two available workarounds are both worse: park the main checkout on it (the exact
// state the on-trunk check exists to catch — everything reading that working tree serves the line),
// or declare it as `trunk` (which points the promotion path at it, since on tiers A and C trunk is
// what promotion consumes).
//
// The validity rules all defend the same boundary — that a declared line is a DEVELOPMENT
// integration point and can never be a production one:
//   - not `trunk`: trunk is already the primary integration point; listing it twice would give the
//     same branch two sets of rules, one of which reaches production.
//   - not `main`: on tiers A and C that is the release branch, and on tier B it is trunk. Either way
//     it is the branch this field must never touch.
//   - not literally `trunk`: a branch by that name is banned outright (§2 — trunk is a role).
//   - it must EXIST: a declared line nobody cut is the "release branch nothing consumes" failure
//     under a new name, and the CLI would cut worktrees from a ref that is not there.
//
// Returns the validated list (possibly empty) so callers can exempt these branches from the
// naming regex and the ghost-branch advisory.
function checkIntegration(cfg, trunk, branches, fail, warn) {
  if (!cfg || !("integration" in cfg)) return [];
  const raw = cfg.integration;
  if (raw === null) return []; // `integration:` with nothing under it — an empty list, the default
  if (!Array.isArray(raw)) {
    fail(`integration must be a list of branch names, found ${JSON.stringify(raw)} — write it as "- <branch>" lines or [a, b]`);
    return [];
  }
  const out = [];
  for (const entry of raw) {
    const b = entry === null || entry === undefined ? "" : String(entry).trim();
    if (!b) { fail("integration contains an empty entry"); continue; }
    if (b === trunk) {
      fail(`integration lists the trunk ("${b}") — trunk is already the primary integration point; the field is for ADDITIONAL lines`);
      continue;
    }
    if (b === "main") {
      fail('integration lists "main" — that is the release branch (tiers A and C) or the trunk (tier B), and nothing on this axis may have a path to production');
      continue;
    }
    if (b === "trunk") {
      fail('integration lists "trunk" — "trunk" is a role, never a branch name (CONVENTIONS.md §2)');
      continue;
    }
    if (out.includes(b)) { warn(`integration lists "${b}" twice`); continue; }
    out.push(b);
  }
  if (Array.isArray(branches)) {
    for (const b of out) {
      if (!branches.includes(b)) fail(`integration line "${b}" does not exist as a branch — a declared line nobody cut is the same failure as a release branch nothing consumes`);
    }
  } else if (out.length) {
    warn(`cannot list branches — integration line(s) ${out.join(", ")} unverified`);
  }
  return out;
}

// `releaseBranch:` — the declared external-deploy axis. Optional; absent is the normal case, and
// most Tier A repos deploy from `main` itself and need no extra name.
//
// It answers a different question from `integration:`, on the opposite side of the fence: which
// branch does an EXTERNAL GitOps poller fast-forward on release, in the single-trunk tag-gated
// shape (`trunk: main`, `deploy: tag`)? That branch is, by construction, an ancestor of trunk
// between releases — the release script fast-forwarded it to trunk's tip as of the last tag, and
// trunk has moved on since — which reads identically to a spent session branch to any check that
// reasons from ancestry alone. `colab doctor` is exactly that kind of check (tools/colab), and
// undeclared it prints a ready-to-paste delete command for a ref a live deploy pipeline is
// polling (#63). Declaring it here is what lets doctor tell the two apart.
//
// The validity rules mirror checkIntegration's, because both defend a declared name actually
// meaning something — but the axis itself is inverted: this field is scoped to touch nothing
// BUT production (a worktree may never be cut from it or ship into it), where integration's
// whole guarantee is to never touch production at all.
//   - not `trunk`: this field names a THIRD branch, distinct from trunk and from `main` — the
//     single-trunk tag-gated shape already treats `main` as the release artifact's landing spot.
//   - not `main`: same branch, same reasoning, stated for the same "fail closed on a malformed
//     descriptor" reason integration's check states it.
//   - not literally `trunk`: banned outright, same as everywhere (§2 — trunk is a role).
//   - it must EXIST: a declared branch nobody cut is the identical failure this field exists to
//     name — "a release branch nothing consumes" — just reached from the descriptor side instead
//     of doctor's ancestry side.
//
// Returns the validated branch name, or "" (never a list — a repo has at most one).
function checkReleaseBranch(cfg, trunk, branches, fail, warn, deploy) {
  if (!cfg || !("releaseBranch" in cfg)) return "";
  const raw = cfg.releaseBranch;
  if (raw === null) return ""; // `releaseBranch:` with nothing under it — same as absent
  if (Array.isArray(raw) || (typeof raw === "object" && raw !== null)) {
    fail(`releaseBranch must be a single branch name, found ${JSON.stringify(raw)} — a repo has at most one`);
    return "";
  }
  const b = String(raw).trim();
  if (!b) { fail("releaseBranch is set but empty"); return ""; }
  if (b === trunk) {
    fail(`releaseBranch names the trunk ("${b}") — it must name a DIFFERENT branch than trunk (the single-trunk tag-gated shape already lands day-to-day work on trunk itself)`);
    return "";
  }
  if (b === "main") {
    fail('releaseBranch is "main" — that is trunk itself in the single-trunk tag-gated shape this field targets; name the separate branch the external poller actually watches');
    return "";
  }
  if (b === "trunk") {
    fail('releaseBranch is "trunk" — "trunk" is a role, never a branch name (CONVENTIONS.md §2)');
    return "";
  }
  if (Array.isArray(branches)) {
    if (!branches.includes(b)) {
      fail(`releaseBranch "${b}" does not exist as a branch — a declared release branch nobody cut is the same failure as a release branch nothing consumes`);
      return "";
    }
  } else {
    warn(`cannot list branches — releaseBranch "${b}" unverified`);
  }
  // Advisory, not a failure: the field's only meaning is a tag fast-forwarding this branch, so a
  // repo declaring it under any other `deploy:` is very likely describing a shape that does not
  // exist yet, or that has already changed underneath the descriptor.
  if (deploy !== "tag") {
    warn(`releaseBranch "${b}" is declared but deploy is ${JSON.stringify(deploy)} — this field only means something for deploy: tag (an external poller fast-forwarding it on release)`);
  }
  return b;
}

// `CLAUDE.md` is the router (code-wrap A2), loaded in full into EVERY session before any
// work starts. Issue #64: A2's rule was prose-only, and its own worst-case citation is
// framed in LINES — which is structurally blind to the failure that actually occurred. A
// repo audited clean at 197 lines carried 112,382 bytes because a single "pointer" row had
// grown into a hand-maintained paraphrase of the whole document it was meant to point at:
// 68,350 bytes, 60.8% of the file, 9.3x the next-largest row. Because CLAUDE.md sits in the
// cached prompt PREFIX, that cost is paid on every TURN of every session, not once per
// session — a byte ceiling on the whole file catches the aggregate, and a per-LINE ceiling
// catches the specific signature: one physical line ballooning while nothing else grows.
//
// Deliberately NOT scoped to markdown table rows: a repo that routes with a bullet list
// (`- docs/x.md — one line`) carries the identical risk if one bullet's line balloons, and
// scanning physical lines catches both shapes without assuming either.
//
// Both thresholds are WARN, not FAIL. The issue that proposed them offered the numbers "as
// a starting point rather than a recommendation", wanting calibration across adopting repos
// before anything here becomes a hard gate — the goal is a finding with the measured number
// ("state the condition"), not a build-breaking assertion of a still-uncalibrated one.
const CLAUDE_MD_MAX_BYTES = 40 * 1024; // near the handbook's own cited worst case (39 KB / 452 lines)
const CLAUDE_MD_LINE_MULTIPLE = 6; // "some small multiple of the [file's] median row"
const CLAUDE_MD_LINE_ABS_FLOOR = 2048; // below this, flagging on multiple alone is noise (tiny medians make everything look huge)

// #117: the byte ceiling above was built to catch hand-written accretion, but it counts
// TOTAL file bytes — which also charges a repo for content it cannot shorten by the rule's
// own logic: a derived block (e.g. a generated table of contents a script rebuilds from
// another doc's headings) that a test elsewhere asserts matches byte-for-byte. That content
// grows by construction, one line per source fact, and editing it by hand to "fix" the
// advisory makes the repo's OWN gate red. A repo following the router rule perfectly still
// gets charged for adopting a pattern the handbook prefers.
//
// The fix: let a repo mark a span as derived, and gate the advisory on AUTHORED bytes
// (total minus every marked span) instead of total. Total is still reported — a file that
// is mostly derived is still fully loaded into every session, and that cost stays visible —
// but only authored bytes decide whether the finding fires. `id=` is required so a repo
// with more than one generated block (e.g. a TOC and a changelog) can have both.
const DERIVED_START_RE = /^<!--\s*colab:derived:start\s+id=(\S+)\s*-->\s*$/;
const DERIVED_END_RE = /^<!--\s*colab:derived:end\s*-->\s*$/;

/**
 * Splits `text` into `{ authoredLines, derivedBytes, malformed }`. `authoredLines` holds
 * every physical line (marker lines included, since they are structural annotations, not
 * prose) EXCEPT lines inside a well-formed derived span. `malformed` lists any marker
 * problem (unterminated start, stray end, nested start) — on malformed input we fail open:
 * the offending span and everything after its unmatched marker is treated as AUTHORED, so a
 * broken marker never hides real prose from the advisory it exists to inform.
 */
function splitDerivedSpans(text) {
  const lines = text.split(/\r?\n/);
  const authoredLines = [];
  const malformed = [];
  let openId = null;
  let spanLines = [];

  for (const line of lines) {
    if (openId === null) {
      const m = line.match(DERIVED_START_RE);
      if (m) {
        openId = m[1];
        spanLines = [line];
        continue;
      }
      if (DERIVED_END_RE.test(line)) {
        malformed.push(`a colab:derived:end with no matching start`);
        authoredLines.push(line); // stray end — keep it, it's just text at that point
        continue;
      }
      authoredLines.push(line);
    } else {
      if (DERIVED_START_RE.test(line)) {
        malformed.push(`nested colab:derived:start (id=${openId} was still open)`);
        // Fail open: treat the whole thing-so-far as authored and stop tracking a span.
        authoredLines.push(...spanLines, line);
        openId = null;
        spanLines = [];
        continue;
      }
      spanLines.push(line);
      if (DERIVED_END_RE.test(line)) {
        openId = null; // well-formed span closes; its lines are NOT authored
        spanLines = [];
      }
    }
  }

  if (openId !== null) {
    malformed.push(`colab:derived:start id=${openId} was never closed`);
    authoredLines.push(...spanLines); // fail open — count the unterminated span as authored
  }

  return { authoredLines, malformed };
}

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
    .replace(/[^\w\- ]+/g, "") // strip punctuation, keep word chars/hyphens/spaces -- NOT collapsed
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

// Every `](target#fragment)` markdown link, repo-relative to the file that carries it.
// `target` is `""` for a same-file link (`[…](#slug)`); anything already resolved by the
// caller. Deliberately link-shaped ONLY — a bare `§N` in prose, or a bare `FILE.md#slug`
// mention with no `[...](...)` around it, is not a citation this check may touch (#158's
// whole scope boundary: the ~280 un-migrated `§N` citations must be invisible to this).
const ANCHOR_LINK_RE = /\]\(([^)#\s]*\.md)?#([^)\s]+)\)/g;

// Blanks out fenced code blocks and inline `code spans` before the link scan runs, so a
// doc that shows link syntax as a LITERAL EXAMPLE (this very file does, documenting this
// very check) is never mistaken for a real citation. Same fence-skip as
// collectHeadingSlugs, plus a same-line inline-span strip; not a full markdown parser,
// just enough to keep a documented example from tripping the thing it documents.
function stripCodeForLinkScan(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; out.push(""); continue; }
    out.push(inFence ? "" : line.replace(/`[^`\n]*`/g, ""));
  }
  return out.join("\n");
}

// Levenshtein edit distance, local and dependency-free (#187) — the check's suggestion
// list needs a real similarity measure to earn the word "nearest" in its message; plain
// two-row DP is all that's warranted at the scale of a heading slug, no need to optimise.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function checkAnchorLinks(src, fail) {
  if (src.kind !== "local") return; // remote enumeration is O(files) gh API calls — skip, not warn (see markdownFiles())
  const files = src.markdownFiles();
  const headingCache = new Map(); // repo-relative path -> Set<slug> | null (null = unreadable)

  const slugsFor = (path) => {
    if (headingCache.has(path)) return headingCache.get(path);
    const text = src.readFile(path);
    const result = text === null ? null : collectHeadingSlugs(text);
    headingCache.set(path, result);
    return result;
  };

  for (const file of files) {
    const text = src.readFile(file);
    if (text === null) continue; // listed by git but unreadable — not this check's concern
    const dir = dirname(file);
    let m;
    ANCHOR_LINK_RE.lastIndex = 0;
    const scanText = stripCodeForLinkScan(text);
    while ((m = ANCHOR_LINK_RE.exec(scanText))) {
      const [, rawTarget, fragment] = m;
      // An external target is not a repo-relative path, even though it ends in ".md".
      // The comment that stood here claimed ANCHOR_LINK_RE's `.md$` requirement already
      // excluded http(s) — it does not: `https://host/README.md#install` ends in ".md"
      // exactly as happily as a local file, so it was joined against the linking file's
      // directory and reported as missing, at `fail` severity, with a mangled path. The
      // false comment is why the gap survived review, so it is corrected rather than
      // merely supplemented (#184). Two shapes, because the second carries no scheme:
      // an absolute URL (`https:`, `mailto:`) and a protocol-relative one (`//host/…`).
      // Checked BEFORE the repo-absolute `/` branch below — `//host/x.md` starts with
      // "/" too, and would otherwise be sliced into the path `/host/x.md`.
      if (rawTarget && (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget) || rawTarget.startsWith("//"))) continue;
      const targetPath = rawTarget ? (rawTarget.startsWith("/") ? rawTarget.slice(1) : join(dir, rawTarget)) : file;
      const normalized = targetPath.split("/").filter((p) => p !== ".").join("/");
      const slugs = slugsFor(normalized);
      if (slugs === null) {
        fail(`${file}: links to ${normalized}#${fragment}, but ${normalized} does not exist`);
        continue;
      }
      if (!slugs.has(fragment)) {
        // Ranked by edit distance to the unresolved fragment, ascending, so "nearest"
        // means what it says (#187 — it used to be the first five headings in document
        // order, unrelated to the broken fragment). Ties break on document order (the
        // Set's insertion order) so the message is deterministic — it is asserted in
        // tests, and a nondeterministic suggestion list would make the suite flaky.
        const near = [...slugs]
          .map((slug, index) => ({ slug, index, dist: levenshtein(fragment, slug) }))
          .sort((a, b) => a.dist - b.dist || a.index - b.index)
          .slice(0, 5)
          .map((entry) => entry.slug);
        fail(
          `${file}: anchor #${fragment} does not resolve in ${normalized} — ` +
          (near.length ? `nearest headings: ${near.join(", ")}` : "that file has no headings at all"),
        );
      }
    }
  }
}

function checkClaudeMdSize(src, warn) {
  const text = src.readFile("CLAUDE.md");
  if (text === null) return; // no CLAUDE.md here — a separate concern (project.yml already covers "undescribed")

  const bytes = Buffer.byteLength(text, "utf8");
  const { authoredLines, malformed } = splitDerivedSpans(text);
  for (const problem of malformed) {
    warn(`CLAUDE.md has a malformed colab:derived marker (${problem}) — treating the affected span as authored, not derived, until it's fixed`);
  }

  const authoredText = authoredLines.join("\n");
  const authoredBytes = Buffer.byteLength(authoredText, "utf8");
  const derivedBytes = Math.max(0, bytes - authoredBytes);

  if (authoredBytes > CLAUDE_MD_MAX_BYTES) {
    const totalNote = derivedBytes > 0
      ? ` (of ${bytes} bytes total; ${derivedBytes} bytes are marked colab:derived and excluded — #117)`
      : "";
    warn(
      `CLAUDE.md is ${authoredBytes} bytes (~${(authoredBytes / 1024).toFixed(1)} KB)${totalNote} — over the ` +
      `${CLAUDE_MD_MAX_BYTES / 1024} KB advisory ceiling (#64). It is loaded in full into every session before ` +
      `any work starts; if the knowledge belongs in docs/, the CLAUDE.md change is a pointer, not a copy (code-wrap A2)`,
    );
  }

  // Median over non-empty PHYSICAL lines, derived spans excluded — a monster line is one
  // that never wrapped, so a line-count-based reader (like A2's own cited metric) never
  // sees it either. Excluding derived lines here too: a generated block can legitimately
  // contain a long row, and that is not the "pointer became a copy" signature this hunts.
  const lens = authoredLines.filter((l) => l.length > 0).map((l) => Buffer.byteLength(l, "utf8")).sort((a, b) => a - b);
  if (lens.length < 2) return; // no meaningful median from 0 or 1 lines
  const median = lens[Math.floor(lens.length / 2)];
  const worst = lens[lens.length - 1];
  if (median > 0 && worst > CLAUDE_MD_LINE_ABS_FLOOR && worst > median * CLAUDE_MD_LINE_MULTIPLE) {
    const pct = ((worst / authoredBytes) * 100).toFixed(1);
    warn(
      `CLAUDE.md has a single line of ${worst} bytes — ${(worst / median).toFixed(1)}x the file's median line ` +
      `(${median} bytes), ${pct}% of authored content (#64). That is the "pointer became a copy" signature: a ` +
      `router line should name where the depth lives, not reproduce it`,
    );
  }
}

// `deploy: manual` promises that the hand-deploy procedure is written down and findable.
// An unwritten runbook is how "only one person can ship this" happens, so the field is
// required and the path is verified — but verification degrades by source:
//
//   local working tree  → authoritative. A declared path that is not on disk is a FAIL.
//   remote (gh API)     → best-effort. A miss can mean "file absent" OR "the API read
//                         failed" (private repo, token scope, rate limit, default branch
//                         differs). Those are indistinguishable from here, so a miss is an
//                         ADVISORY naming both possibilities. We would rather under-report
//                         than invent a violation — the same reason `branches === null`
//                         downgrades the trunk check to "unverified".
// `why` names the deploy shape that OWES the runbook, so the finding reads honestly whether the
// caller is `deploy: manual` (a human runs it) or `deploy: tag` deployed OUTSIDE CI (a GitOps
// poller runs it). Both share the same invariant: the deploy runs off no in-repo workflow, so the
// path to production must be WRITTEN DOWN or nobody but its author can ship it.
function checkRunbook(src, runbook, fail, warn, why = "deploy: manual") {
  if (runbook === null || runbook === "") {
    fail(`${why} requires runbook: — name the committed doc that describes how production is reached (e.g. docs/deploy.md), or nobody but you can ship`);
    return;
  }
  const path = String(runbook).trim().replace(/^\.\//, "");
  if (src.readFile(path) !== null) return;
  if (src.kind === "local") fail(`runbook "${runbook}" does not exist in the repo — ${why} points at a doc that is not there`);
  else warn(`runbook "${runbook}" not found via the API — either it is missing, or the read failed (permissions/branch); verify in a checkout`);
}

// The bug this catches (found in the wild in three of our Tier A repos): a repo moved
// its trunk (main -> dev) but its CI workflows' push triggers still named the OLD
// branches, so every merge to the real trunk ran ZERO CI — silently — while the B1
// gate ("check trunk CI is green") checked runs that could never exist.
//
// Deploy/release workflows are NOT CI gates: a deploy-*.yml firing on a push to main is a
// deploy trigger, not a check, so it must never be counted as "the trunk is gated". We
// exclude them by filename (deploy*/release*) and by trigger shape (a tags-only or
// workflow_dispatch-only workflow does no branch gating and is not CI-type). This exclusion
// is about what COUNTS AS CI here and says nothing about whether the setup is desirable —
// a `deploy: push-main` repo is separately a tier A finding above.
function checkTrunkCiGated(src, trunk, workflows, branches, fail, warn, { integration = [], exempt = INTEGRATION_BRANCHES } = {}) {
  if (!trunk || !workflows.length) return;

  const ci = []; // CI-type workflows: { wf, pushGate, prGate, refs }
  for (const wf of workflows) {
    if (/^(deploy|release)[-.]/.test(wf)) continue; // deploy/release by filename
    const on = parseWorkflowOn(src.readFile(`.github/workflows/${wf}`));
    if (!on.found) continue;

    // Effective push branch gate: an array of patterns | "all" | {ignore:[…]} | null.
    // Bare `push:` = every branch ("all"); `push:` with only tags = no branch push.
    let pushGate = null;
    if (on.events.has("push")) {
      if (on.pushBranches !== null) pushGate = on.pushBranches;
      else if (on.pushBranchesIgnore !== null) pushGate = { ignore: on.pushBranchesIgnore };
      else if (on.pushTags !== null) pushGate = null; // tags-only push
      else pushGate = "all";
    }
    const prGate = (on.events.has("pull_request") || on.events.has("pull_request_target"))
      ? (on.prBranches !== null ? on.prBranches : "all")
      : null;

    // Not CI-type if it does no branch-based triggering (tags-only + dispatch, etc.).
    if (pushGate === null && prGate === null) continue;

    // Positive branch references, for the stale-reference advisory (ignore lists and
    // glob patterns are not concrete "references" to a branch).
    const refs = [];
    for (const list of [on.pushBranches, on.prBranches]) {
      if (Array.isArray(list)) for (const b of list) if (b) refs.push(b);
    }
    ci.push({ wf, pushGate, prGate, refs });
  }

  // No CI at all here is a DIFFERENT concern (does this repo want CI?) — out of scope.
  // This check only catches CI that exists but points at the wrong branch.
  if (!ci.length) return;

  const pushGates = (g, branch) => {
    if (g === "all") return true;
    if (Array.isArray(g)) return g.some((p) => globMatch(p, branch));
    if (g && g.ignore) return !g.ignore.some((p) => globMatch(p, branch));
    return false;
  };
  const gatedBySomeWorkflow = (branch) => ci.some((c) => pushGates(c.pushGate, branch));

  if (!gatedBySomeWorkflow(trunk)) {
    const gates = ci.map((c) => {
      if (Array.isArray(c.pushGate)) return `${c.wf} gates: ${c.pushGate.join(", ")}`;
      if (c.pushGate === "all") return `${c.wf} gates: all branches`;
      return `${c.wf}: pull_request only`;
    });
    fail(`trunk "${trunk}" is not CI-gated — no workflow triggers on push to it (${gates.join("; ")})`);
  }

  // A declared integration line without its own push gate is an ADVISORY, never a failure. Work
  // merges into such a line the same way it merges into trunk, so ungated is a real gap — but a
  // line that is not yet CI-gated is a normal early state, and failing the repo for it would push
  // teams to declare the line nowhere (which is the state this field exists to end). Trunk's gate
  // is the one that must exist, because trunk is what reaches a release.
  for (const b of integration) {
    if (!gatedBySomeWorkflow(b)) {
      warn(`integration line "${b}" is not CI-gated — no workflow triggers on push to it, so merges into it run zero CI (advisory: an ungated line is a normal early state)`);
    }
  }

  // Stale-reference advisory: a workflow names a branch that does not exist. Standard
  // integration aliases (main/master/dev/trunk) and this repo's declared integration
  // lines are exempt — teams list them defensively; the anti-pattern is a
  // project-specific ghost like develop/workos.
  if (Array.isArray(branches)) {
    for (const c of ci) {
      const ghosts = [...new Set(c.refs)]
        .filter((b) => !/[*?[]/.test(b)) // glob patterns aren't concrete branches
        .filter((b) => !exempt.has(b))
        .filter((b) => !branches.includes(b));
      if (ghosts.length) warn(`${c.wf} triggers on nonexistent branch(es): ${ghosts.join(", ")}`);
    }
  }
}

function collectToolchain(src, cfg, workflows) {
  const findings = [];

  // --- declared -------------------------------------------------------------
  const declared = {
    node: cfg && "node" in cfg ? cfg.node : null,
    php: cfg && "php" in cfg ? cfg.php : null,
    python: cfg && "python" in cfg ? cfg.python : null,
  };

  // --- manifest -------------------------------------------------------------
  const manifest = {
    node: null, nodeRaw: null, nodeFrom: null,
    php: null, phpRaw: null, phpFrom: null,
    python: null, pythonRaw: null, pythonFrom: null,
  };

  const nvmrc = src.readFile(".nvmrc");
  if (nvmrc && nvmrc.trim()) {
    manifest.nodeRaw = nvmrc.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? null;
    manifest.node = normaliseVersion(manifest.nodeRaw);
    manifest.nodeFrom = ".nvmrc";
  }
  const pkgRaw = src.readFile("package.json");
  let pkg = null;
  if (pkgRaw) {
    try {
      pkg = JSON.parse(pkgRaw);
    } catch (e) {
      findings.push({ level: "fail", text: `package.json does not parse: ${e.message.split("\n")[0]}` });
    }
  }
  if (pkg && !manifest.node && pkg.engines?.node) {
    manifest.nodeRaw = pkg.engines.node;
    manifest.node = normaliseVersion(pkg.engines.node);
    manifest.nodeFrom = "engines.node";
  }

  const composerRaw = src.readFile("composer.json");
  let composer = null;
  if (composerRaw) {
    try {
      composer = JSON.parse(composerRaw);
    } catch (e) {
      findings.push({ level: "fail", text: `composer.json does not parse: ${e.message.split("\n")[0]}` });
    }
  }
  if (composer?.require?.php) {
    manifest.phpRaw = composer.require.php;
    manifest.php = normaliseVersion(composer.require.php);
    manifest.phpFrom = "composer.json require.php";
  }

  // Python. Precedence mirrors node's: the dedicated version file first (pyenv's
  // .python-version, which local tooling also reads), then the package manifest.
  //
  // requirements.txt is deliberately ABSENT from this list — it pins dependencies,
  // never the interpreter. A repo carrying only a requirements.txt has declared
  // nothing about which Python it runs on, and the undeclared-but-pinned advisory
  // below is exactly the right thing to say about it.
  const pyver = src.readFile(".python-version");
  if (pyver && pyver.trim()) {
    manifest.pythonRaw = pyver.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? null;
    manifest.python = normaliseVersion(manifest.pythonRaw);
    manifest.pythonFrom = ".python-version";
  }
  const pyproject = src.readFile("pyproject.toml");
  if (pyproject && !manifest.python) {
    // A line match, not a TOML parser: this tool is dependency-free by design, and
    // requires-python is a single top-level string in [project].
    const m = pyproject.match(/^\s*requires-python\s*=\s*["']([^"']+)["']/m);
    if (m) {
      manifest.pythonRaw = m[1];
      manifest.python = normaliseVersion(m[1]);
      manifest.pythonFrom = "pyproject.toml requires-python";
    }
  }

  // --- what the workflows actually pin -------------------------------------
  const pins = { node: [], php: [], python: [] };
  for (const wf of workflows) {
    const text = src.readFile(`.github/workflows/${wf}`);
    if (!text) continue;
    for (const [, v] of text.matchAll(/^\s*node-version:\s*["']?([^"'\s#]+)/gm)) {
      if (!v.includes("${{")) pins.node.push({ wf, v: normaliseVersion(v) });
    }
    for (const [, v] of text.matchAll(/^\s*php-version:\s*["']?([^"'\s#]+)/gm)) {
      if (!v.includes("${{")) pins.php.push({ wf, v: normaliseVersion(v) });
    }
    for (const [, v] of text.matchAll(/^\s*python-version:\s*["']?([^"'\s#]+)/gm)) {
      if (!v.includes("${{")) pins.python.push({ wf, v: normaliseVersion(v) });
    }
  }

  for (const eco of ["node", "php", "python"]) {
    const d = declared[eco] ? normaliseVersion(declared[eco]) : null;
    const m = manifest[eco];
    const rawConstraint = manifest[`${eco}Raw`];
    const from = manifest[`${eco}From`];

    // Descriptor vs manifest. If the manifest states a range, the descriptor's
    // concrete version must live inside it; otherwise compare them directly.
    if (d && m) {
      const agrees = isRange(rawConstraint) ? satisfiesConstraint(d, rawConstraint) : prefixAgree(d, m);
      if (!agrees) {
        findings.push({ level: "fail", text: `${eco}: project.yml=${d} but ${from}=${rawConstraint}` });
      }
    }

    // Declared truth vs what the workflows actually pin. project.yml wins as the
    // reference when present; otherwise the manifest is the reference.
    const truthLabel = d ? "project.yml" : from;
    const reference = d || m;
    const referenceIsRange = !d && isRange(rawConstraint);
    for (const p of pins[eco]) {
      if (!p.v || !reference) continue;
      const agrees = referenceIsRange ? satisfiesConstraint(p.v, rawConstraint) : prefixAgree(reference, p.v);
      if (!agrees) {
        const shown = referenceIsRange ? rawConstraint : normaliseVersion(reference);
        findings.push({ level: "fail", text: `${eco}: ${truthLabel}=${shown} but ${p.wf} pins ${p.v}` });
      }
    }

    // workflows disagreeing with EACH OTHER is the exact bug that started this:
    // ci.yml on Node 20, deploy-xserver.yml on Node 22.
    const pinned = pins[eco].filter((p) => p.v);
    const inconsistent = pinned.some((p) => !prefixAgree(p.v, pinned[0].v));
    if (inconsistent) {
      findings.push({
        level: "fail",
        text: `${eco}: workflows disagree — ${pins[eco].map((p) => `${p.wf}=${p.v}`).join(", ")}`,
      });
    }

    // Nothing declared anywhere, but CI pins something: the pin is the only source
    // of truth and nobody can see it without opening the YAML.
    if (!reference && pins[eco].length) {
      findings.push({
        level: "warn",
        text: `${eco}: undeclared — only pinned inside ${[...new Set(pins[eco].map((p) => p.wf))].join(", ")} (declare it in project.yml)`,
      });
    }
  }

  return { findings };
}

// -------------------------------------------------------------------- config load

function loadTargets(opts) {
  const targets = [];

  for (const p of opts.locals) {
    targets.push({ kind: "local", path: p, label: labelForPath(p) });
  }

  const entries = [];
  if (opts.slugs.length) {
    entries.push(...opts.slugs);
  } else if (!opts.locals.length) {
    const cfg = resolveConfig(opts);
    opts.resolvedConfig = cfg; // surfaced in the report header
    for (const line of readFileSync(cfg.path, "utf8").split(/\r?\n/)) {
      const s = line.replace(/#.*$/, "").trim();
      if (s) entries.push(s);
    }
  }

  for (const e of entries) {
    // A path if it looks like one or exists on disk; otherwise an owner/name slug.
    const looksPath = e.startsWith("/") || e.startsWith("~") || e.startsWith(".");
    const expanded = e.startsWith("~") ? join(process.env.HOME || "", e.slice(1)) : e;
    if (looksPath || existsSync(expanded)) {
      targets.push({ kind: "local", path: expanded, label: labelForPath(expanded) });
    } else if (/^[^/]+\/[^/]+$/.test(e)) {
      targets.push({ kind: "remote", slug: e, label: e });
    } else {
      targets.push({ kind: "local", path: expanded, label: e }); // will report "does not exist"
    }
  }
  return targets;
}

// Two path segments read better than one in a report: `company/project`.
function labelForPath(p) {
  const r = resolve(p.startsWith("~") ? join(process.env.HOME || "", p.slice(1)) : p);
  const parent = basename(dirname(r));
  return parent && parent !== "/" ? `${parent}/${basename(r)}` : basename(r);
}

// ------------------------------------------------------------------------- output

function report(results, opts, ctx) {
  if (opts.json) {
    console.log(JSON.stringify({
      generated: new Date().toISOString(),
      handbook: { version: ctx.handbook.version, untagged: ctx.handbook.untagged, root: ctx.handbook.root },
      configSource: opts.resolvedConfig?.source ?? (opts.locals.length || opts.slugs.length ? "ad-hoc (--local / positional)" : null),
      results,
    }, null, 2));
    return;
  }

  // Header: which repo list + handbook version, so a scheduled run is self-documenting.
  if (opts.resolvedConfig) console.log(`repo list: ${opts.resolvedConfig.source}`);
  console.log(`handbook:  ${ctx.handbook.version}${ctx.handbook.untagged ? " (untagged — stamp checks inactive)" : ""}`);
  console.log("");

  const shown = opts.quiet ? results.filter((r) => !r.clean) : results;
  const width = Math.max(0, ...shown.map((r) => r.repo.length));
  const tierW = 6;

  for (const r of shown) {
    const tier = r.tier ? `tier ${r.tier}` : "tier ?";
    const head = `${r.repo.padEnd(width)}  ${tier.padEnd(tierW)}`;
    const cont = "".padEnd(width + 2 + tierW + 2); // continuation indent

    const lines = [];
    // The handbook's own row says WHY it carries no stamp findings. Without this it
    // would read as clean-by-luck, which is indistinguishable from a check that
    // quietly stopped working.
    if (r.self) lines.push("⌂ handbook source — every rule applies except its own stamps (it has nothing to copy from)");
    else if (r.clean) lines.push("✓");
    r.findings.forEach((f) => lines.push(`${f.level === "fail" ? "⚠" : "·"} ${f.text}`));

    // Repeat the name on every line so the output stays greppable.
    lines.forEach((l, i) => console.log(`${i === 0 ? head : cont}  ${l}`));
  }

  const failed = results.filter((r) => !r.ok).length;
  const warned = results.filter((r) => r.ok && !r.clean).length;
  console.log("");
  console.log(`${results.length} repo(s): ${results.length - failed - warned} clean, ${warned} with advisories, ${failed} with problems.`);
}

// The usage block is this file's own leading comment, rendered on demand.
function helpText() {
  return readFileSync(fileURLToPath(import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("//"))
    .map((l) => l.replace(/^\/\/ ?/, ""))
    .join("\n");
}

// Returns the exit code rather than taking it — see the note in main.
function runAudit(opts) {
  const targets = loadTargets(opts);
  if (!targets.length) die("nothing to audit — add entries to the repo list or pass --local <path>");

  const ctx = { handbook: handbookInfo(HANDBOOK_ROOT), templateNames: templateNames(HANDBOOK_ROOT) };

  const results = [];
  for (const t of targets) {
    try {
      results.push(auditRepo(t, ctx));
    } catch (err) {
      // Degrade gracefully: one broken repo must never take the whole sweep down.
      results.push({
        repo: t.label,
        kind: t.kind,
        tier: null,
        ok: false,
        clean: false,
        findings: [{ level: "fail", text: `audit crashed: ${err.message.split("\n")[0]}` }],
      });
    }
  }

  report(results, opts, ctx);
  return results.every((r) => r.ok) ? 0 : 1;
}

// --------------------------------------------------------------------------- main

/*
 * Both branches below SET process.exitCode and let Node exit on its own once stdout
 * has drained. process.exit() would not wait: writes to a pipe are asynchronous, so
 * exiting straight after console.log() discards whatever is still buffered, handing
 * the reader a truncated payload *with a success-looking exit code*. Nothing in the
 * contract signals the failure, so a consumer parses garbage or silently sees less.
 *
 * Two things made this expensive to diagnose, both worth remembering:
 *   - `| wc -c` does NOT reproduce it. A shell consumer drains greedily and wins the
 *     race, reporting the full byte count. Only a reader that buffers stdout
 *     (execFile/spawn — i.e. every tool that consumes --json) sees the cut.
 *   - The threshold is the platform's pipe buffer: ~8 KB on macOS, 64 KB on Linux.
 *     So it surfaces per-machine, and only once the report grows past it. Findings
 *     inflate the payload faster than repo count does.
 *
 * The exit-code contract is unchanged: 0 clean, 1 findings, 2 usage error.
 * (Block-comment syntax deliberately: helpText scrapes line comments, and this note
 * is for maintainers, not users.)
 */

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log(helpText());
  process.exitCode = 0;
} else {
  process.exitCode = runAudit(opts);
}
