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
//   - far under    → more than RATCHET_SLACK lines below budget: lower the budget in this file,
//                    so a saving is locked in instead of becoming room to regrow.
// Raising a budget is a reviewed edit to BUDGET with its reason in the same commit, never a
// silent bump. Runs in scripts/smoke.sh and in CI's self-check job.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// file -> max lines. Set from the size after #523's first pass (rounded up to the next 50);
// docs/adr/523-conventions-hard-default-and-size-budget.md records the numbers and phase 2's target.
export const BUDGET = {
  "CONVENTIONS.md": 5550, // #523 pass 1: 5,516 lines (from 5,895)
  "project.schema.md": 1750, // #523 pass 1: 1,704 lines, markers only
};
export const RATCHET_SLACK = 100;

export const lineCount = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

export function check({ root, budget = BUDGET, slack = RATCHET_SLACK }) {
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
