#!/usr/bin/env node
// check-doc-budget — the growth brake on the normative documents (#523).
//
//   node scripts/check-doc-budget.mjs
//
// CONVENTIONS.md went from about 2,100 lines (the #159/#167 compact reissue) to 5,781 in two
// months, because each incident wrote its story into the rule it produced. A one-off compaction
// regrows; a checked budget does not (#518). Two failures, both deliberate:
//   - over budget  → move the rationale to an ADR (docs/adr/README.md); the rule keeps one
//                    sentence and a link. Never compress a rule's wording to fit.
//   - far under    → more than RATCHET_SLACK lines (thresholds.doc-budget-slack, #560) below budget: lower the budget in this file,
//                    so a saving is locked in instead of becoming room to regrow.
// Raising a budget is a reviewed edit to BUDGET with its reason in the same commit, never a
// silent bump. Runs in scripts/smoke.sh and in CI's self-check job.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("../tools/lib/yaml.js");
const { thresholdValue } = require("../tools/lib/thresholds.js");

// file -> max lines. Set from the size after #523's first pass (rounded up to the next 50);
// docs/adr/523-conventions-hard-default-and-size-budget.md records pass 1, docs/adr/539-rationale-split-phase-2.md phase 2.
export const BUDGET = {
  "CONVENTIONS.md": 5200, // #539 phase 2: 5,049 lines (from 5,580 at its base), +50 for #512's pending 28-line §4/§7 hunk; raised +100 by #569: trunk had reached 5,100 (the #512 headroom spent by later merges), #569's `shape:` rule adds 23 lines that are rules, not movable rationale, and #512's 28 still have to fit
  "project.schema.md": 1650, // #539 phase 2: 1,551 lines (from 1,704); +50 for #560's `thresholds` entry — a new field, its rationale already in the issue, no story to move to an ADR
};
// The default; a repo may declare its own as `thresholds.doc-budget-slack` in .github/project.yml (#560).
export const RATCHET_SLACK = thresholdValue({}, "doc-budget-slack");

/** The slack the repo at `root` declares, else RATCHET_SLACK. A malformed value falls back to the default. */
export function slackFor(root) {
  const p = path.join(root, ".github", "project.yml");
  if (!fs.existsSync(p)) return RATCHET_SLACK;
  try { return thresholdValue(yaml.parse(fs.readFileSync(p, "utf8")) || {}, "doc-budget-slack"); } catch { return RATCHET_SLACK; }
}

export const lineCount = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

export function check({ root, budget = BUDGET, slack = slackFor(root) }) {
  const findings = [];
  const sizes = {};
  for (const [file, max] of Object.entries(budget)) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) { findings.push(`${file}: missing — remove it from BUDGET or restore it`); continue; }
    const n = lineCount(fs.readFileSync(p, "utf8"));
    sizes[file] = { lines: n, budget: max };
    if (n > max) {
      findings.push(`${file} is ${n} lines, budget ${max} — move the rationale to an ADR (docs/adr/README.md); keep the rule and one link`);
    } else if (max - n > slack) {
      findings.push(`${file} is ${n} lines, ${max - n} under its budget ${max} — lower BUDGET["${file}"] in scripts/check-doc-budget.mjs to ${Math.ceil(n / 50) * 50} so the saving holds`);
    }
  }
  return { sizes, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const { sizes, findings } = check({ root });
  console.log(`doc budget: ${Object.entries(sizes).map(([f, s]) => `${f} ${s.lines}/${s.budget}`).join(" · ")}`);
  for (const f of findings) console.log(`  ${f}`);
  process.exit(findings.length ? 1 : 0);
}
