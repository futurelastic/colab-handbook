#!/usr/bin/env node
// check-skill-split — prove a skill split into a core plus reference files dropped nothing (#524).
//
//   node scripts/check-skill-split.mjs --base <rev> --skill <name> [--json]
//
// Reads the skill's single-file SKILL.md as it stood at <rev> (`git show`), cuts it into
// units — a whole fenced block, one table row, one list item with its continuation lines,
// one paragraph, one heading — and checks each unit is contained in the CURRENT working-tree
// text of skills/<name>/*.md (core plus every reference file, concatenated). Comparison is on
// normalised text: whitespace collapsed, a heading's `#` level ignored, and a link's file part
// dropped (`](x.md#a)` and `](#a)` both read `](#a)`), because moving a paragraph into a
// sibling file legitimately retargets its same-file anchors and changes nothing it says.
//
// Also checks that every numbered heading of the old file (`## 3.`, `### 0.1`, `## B1a.`,
// `### A2b.`) is still a heading of the CORE — other skills, CONVENTIONS.md and tools cite
// those steps by name, so they never leave SKILL.md.
//
// Exit 0: nothing missing. Exit 1: a unit or a numbered heading is missing (each printed
// with its old line number). Exit 2: usage or git error. Not run in CI — the split is a
// one-time act per skill; docs/skill-step-inventory.md records each run's output.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { normalise, units, headingsOf } from "./lib/md-units.mjs"; // shared with check-doc-move (#523)

function usage(msg) {
  if (msg) console.error(`check-skill-split: ${msg}`);
  console.error("usage: node scripts/check-skill-split.mjs --base <rev> --skill <name> [--json]");
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = { json: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base") opt.base = args[++i];
  else if (args[i] === "--skill") opt.skill = args[++i];
  else if (args[i] === "--json") opt.json = true;
  else usage(`unknown argument ${args[i]}`);
}
if (!opt.base || !opt.skill) usage();

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
let oldText;
try {
  oldText = execFileSync("git", ["show", `${opt.base}:skills/${opt.skill}/SKILL.md`], {
    cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  usage(`cannot read skills/${opt.skill}/SKILL.md at ${opt.base}: ${String(e.stderr || e.message).trim()}`);
}

const dir = path.join(root, "skills", opt.skill);
const coreText = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
const refFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "SKILL.md").sort();
const allNew = [coreText, ...refFiles.map((f) => fs.readFileSync(path.join(dir, f), "utf8"))].join("\n\n");

const NUMBERED = /^\s{0,3}#{1,6}\s+((\d+(\.\d+)*\.?)|([A-B]\d+[a-z]?\.?))\s/;
const hay = normalise(allNew);
const old = units(oldText);
const missing = old.filter((u) => !hay.includes(normalise(u.text)));
const coreHeadings = headingsOf(coreText);
const numberedMissing = old
  .filter((u) => u.kind === "heading" && NUMBERED.test(u.text) && !coreHeadings.has(normalise(u.text)));

const summary = {
  skill: opt.skill,
  base: opt.base,
  files: ["SKILL.md", ...refFiles],
  coreLines: coreText.split("\n").length - (coreText.endsWith("\n") ? 1 : 0),
  coreBytes: Buffer.byteLength(coreText),
  units: old.length,
  found: old.length - missing.length,
  missing: missing.map((u) => ({ line: u.line, kind: u.kind, text: u.text.slice(0, 160) })),
  numberedHeadingsNotInCore: numberedMissing.map((u) => ({ line: u.line, text: u.text })),
};

if (opt.json) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(`${opt.skill} @ ${opt.base}: units ${summary.units} · found ${summary.found} · missing ${missing.length} · numbered headings not in core ${numberedMissing.length}`);
  console.log(`core SKILL.md: ${summary.coreLines} lines, ${summary.coreBytes} bytes · reference files: ${refFiles.length}`);
  for (const u of missing) console.log(`  missing L${u.line} [${u.kind}] ${u.text.split("\n")[0].slice(0, 120)}`);
  for (const u of numberedMissing) console.log(`  not in core L${u.line} ${u.text}`);
}
process.exit(missing.length || numberedMissing.length ? 1 : 0);
