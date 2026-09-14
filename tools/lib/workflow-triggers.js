'use strict';
/**
 * tools/lib/workflow-triggers.js — what a GitHub workflow's `on:` block fires on (#332, #338).
 *
 * Moved out of audit/audit.mjs, unchanged, so `colab release cut` refuses on exactly the trigger
 * the audit flags — one reading of "would a candidate tag deploy?", not two. A CLI that cut a
 * `-rc` tag the audit would have called a deploying one is the two-places drift this repo exists
 * to kill (the release-policy.js precedent). audit.mjs consumes this through createRequire.
 *
 * CommonJS, zero dependencies, pure: text in, facts out.
 */

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
//           pushTagsIgnore:[]|null, prBranches:[]|null }.
// A null list means the filter is ABSENT. For push, absent branches + absent tags =
// "all branches" (a bare `push:` fires on every branch). Absent branches but PRESENT
// tags = "tags only" — no branch push at all (a release/tag workflow).
function parseWorkflowOn(text) {
  const res = { found: false, events: new Set(), pushBranches: null, pushBranchesIgnore: null, pushTags: null, pushTagsIgnore: null, prBranches: null };
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
      res.pushTagsIgnore = listField(sub, "tags-ignore");
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

// GitHub's filter-pattern glob, exactly (#332) — not audit.mjs's minimal globMatch, because the
// question this answers is whether a pre-release tag slips THROUGH a filter, and an approximation
// errs silently. Per GitHub's "filter pattern cheat sheet": `*` is any run of characters except
// `/` — so it DOES match `-`, which is the whole hazard (`v*.*.*` matches `v1.2.0-rc.1`); `**` is
// any run including `/`; `?` and `+` are zero-or-one / one-or-more of the PRECEDING character (not
// shell `?`); `[...]` is a character class; `\` escapes the next character. Everything else is
// literal, including `.`. Returns null for a pattern that does not compile.
function githubFilterRegex(pattern) {
  const lit = (c) => c.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
  let rx = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) { rx += lit(pattern[++i]); continue; }
    if (c === "*") {
      if (pattern[i + 1] === "*") { rx += ".*"; i++; } else rx += "[^/]*";
      continue;
    }
    if ((c === "?" || c === "+") && rx) { rx += c; continue; }
    if (c === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close > i + 1) { rx += "[" + pattern.slice(i + 1, close).replace(/\\/g, "\\\\") + "]"; i = close; continue; }
    }
    rx += lit(c);
  }
  try { return new RegExp("^" + rx + "$"); } catch { return null; }
}

// A GitHub include-filter list (`tags:`, `branches:`) evaluated the way GitHub does: patterns in
// order, a `!` pattern excludes what it matches, a LATER positive pattern re-includes it. The last
// pattern that matches decides; none matching means not included.
function githubFilterMatches(patterns, ref) {
  let included = false;
  for (const raw of patterns) {
    const neg = raw.startsWith("!");
    const rx = githubFilterRegex(neg ? raw.slice(1) : raw);
    if (rx && rx.test(ref)) included = !neg;
  }
  return included;
}

// Does a parsed `on:` block (parseWorkflowOn) fire on a push of tag `tag`? GitHub's rules: a
// `tags:` list decides by inclusion; a `tags-ignore:` list fires on every tag it does not match; a
// push with NO ref filter at all fires on every branch AND every tag; a push filtered by branches
// only never fires on a tag.
function workflowFiresOnTag(on, tag) {
  if (!on.found || !on.events.has("push")) return false;
  if (on.pushTags !== null) return githubFilterMatches(on.pushTags, tag);
  if (on.pushTagsIgnore !== null) return !githubFilterMatches(on.pushTagsIgnore, tag);
  return on.pushBranches === null && on.pushBranchesIgnore === null;
}

// ---- a deploy trigger that fires on a pre-release tag (#332) ---------------
// GitHub's tag glob `*` matches `-`, so `v*.*.*` and `v*` both fire on `v1.2.0-rc.1`: the first
// release-candidate tag would deploy. In scope: every deploy-*.yml, plus — when `deploy: tag` says a
// tag IS the path to production — any other workflow carrying an explicit tag filter, whatever it is
// named. Severity follows reach: `fail` under `deploy: tag` (production is reachable by that tag),
// `warn` elsewhere. The audit maps severity onto its fail/warn; `colab release cut` refuses on
// either, because both mean "cutting a candidate runs a deploy".
const PRERELEASE_TAG_PROBE = "v1.2.0-rc.1";

/** Workflow file names that count as deploy workflows by name (`deploy-*.yml`, `deploy.yml`). */
function isDeployWorkflow(file) {
  return /^deploy[-.]/.test(file);
}

/**
 * `readFile(relPath)` returns a workflow's text (or null); `workflows` are file names under
 * .github/workflows/; `deploy` is project.yml's value. Returns [{ workflow, trigger, level, text }].
 */
function prereleaseTagTriggers({ readFile, workflows, deploy }) {
  const isTagDeploy = deploy === "tag";
  const out = [];
  for (const wf of workflows || []) {
    const on = parseWorkflowOn(readFile(`.github/workflows/${wf}`));
    const inScope = isDeployWorkflow(wf) || (isTagDeploy && (on.pushTags !== null || on.pushTagsIgnore !== null));
    if (!inScope || !workflowFiresOnTag(on, PRERELEASE_TAG_PROBE)) continue;
    const trigger = on.pushTags !== null
      ? `push.tags ${JSON.stringify(on.pushTags)}`
      : on.pushTagsIgnore !== null
        ? `push.tags-ignore ${JSON.stringify(on.pushTagsIgnore)}`
        : "an unfiltered push trigger (fires on every tag)";
    out.push({
      workflow: wf,
      trigger,
      level: isTagDeploy ? "fail" : "warn",
      text:
        `.github/workflows/${wf}: ${trigger} matches the pre-release tag ${PRERELEASE_TAG_PROBE} — ` +
        "GitHub's tag glob `*` matches `-`, so a release-candidate tag " +
        (isTagDeploy ? "would deploy to production" : "would run this deploy") +
        `. Fix: add "!v*.*.*-*" after the pattern, or use a strict pattern that cannot match "-" ` +
        "(e.g. v[0-9]+.[0-9]+.[0-9]+)",
    });
  }
  return out;
}

module.exports = {
  PRERELEASE_TAG_PROBE,
  parseWorkflowOn, listField, githubFilterRegex, githubFilterMatches, workflowFiresOnTag,
  isDeployWorkflow, prereleaseTagTriggers,
};
