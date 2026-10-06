#!/usr/bin/env node
// check-doc-move — prove moving rationale out of the normative documents dropped nothing (#523).
//
//   node scripts/check-doc-move.mjs --base <rev> [--files CONVENTIONS.md,project.schema.md]
//        [--into docs/adr,docs/gotchas.d] [--allow docs/rule-inventory.md] [--json]
//
// The same unit check as scripts/check-skill-split.mjs (#524), applied to CONVENTIONS.md and
// project.schema.md. Each file is read as it stood at <rev> and cut into units (paragraph, list
// item, table row, fence, heading). Every unit must be found, after normalising, in the union of
// the CURRENT working-tree text of the --files plus every .md under the --into directories:
//   - whole, or
//   - sentence by sentence, for a mixed paragraph split at sentence boundaries (rule kept in
//     place, rationale moved to an ADR — each part verbatim).
// The hard-rule marker (`**[Hard — gate: …]**`) is stripped before comparing, so marking a rule
// is not read as rewording it.
//
// Every heading of a file at <rev> must still be a heading of the SAME file: skills, tools and
// adopters link to those anchors, and section numbers are cited by number.
//
// A unit or heading rewritten on purpose (the §2 reframe around `exposure`) is listed in the
// allow ledger: any line in the --allow file holding a backticked `<file>:<line>` (the line at
// <rev>) and a reason. Each entry excuses exactly that unit. An entry that excuses nothing is a
// finding too — a stale ledger hides the next real loss.
//
// Exit 0: nothing missing. Exit 1: a unit or heading missing, or a stale ledger entry.
// Exit 2: usage or git error. One-off per move, like check-skill-split; the run's output is
// recorded in docs/rule-inventory.md ("Move check").
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { normalise, units, headingsOf, sentences } from "./lib/md-units.mjs";

function usage(msg) {
  if (msg) console.error(`check-doc-move: ${msg}`);
  console.error("usage: node scripts/check-doc-move.mjs --base <rev> [--files a.md,b.md] [--into dir,dir] [--allow ledger.md] [--json]");
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = { json: false, files: ["CONVENTIONS.md", "project.schema.md"], into: ["docs/adr", "docs/gotchas.d"], allow: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base") opt.base = args[++i];
  else if (args[i] === "--files") opt.files = args[++i].split(",").filter(Boolean);
  else if (args[i] === "--into") opt.into = args[++i].split(",").filter(Boolean);
  else if (args[i] === "--allow") opt.allow = args[++i];
  else if (args[i] === "--json") opt.json = true;
  else usage(`unknown argument ${args[i]}`);
}
if (!opt.base) usage();

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const show = (f) => {
  try {
    return execFileSync("git", ["show", `${opt.base}:${f}`], {
      cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    usage(`cannot read ${f} at ${opt.base}: ${String(e.stderr || e.message).trim()}`);
  }
};
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const newTexts = opt.files.map(read);
for (const d of opt.into) {
  const dir = path.join(root, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) newTexts.push(read(path.join(d, f)));
}
const hay = normalise(newTexts.join("\n\n"));

// Ledger: `file:line` in backticks, anywhere in the --allow file.
const ledger = new Map(); // "file:line" -> { used: false, text }
if (opt.allow) {
  for (const l of read(opt.allow).split("\n")) {
    for (const m of l.matchAll(/`([A-Za-z0-9._/-]+\.md):(\d+)`/g)) {
      if (opt.files.includes(m[1])) ledger.set(`${m[1]}:${m[2]}`, { used: false, text: l.trim() });
    }
  }
}
const excused = (file, line) => {
  const e = ledger.get(`${file}:${line}`);
  if (!e) return false;
  e.used = true;
  return true;
};

const report = { base: opt.base, files: [], missing: [], headingsMoved: [], staleLedger: [] };
for (const file of opt.files) {
  const oldText = show(file);
  const cur = read(file);
  const old = units(oldText);
  const curHeadings = headingsOf(cur);
  let whole = 0, bySentence = 0;
  for (const u of old) {
    const n = normalise(u.text);
    if (u.kind === "heading" && !curHeadings.has(n)) {
      if (!excused(file, u.line)) report.headingsMoved.push({ file, line: u.line, text: u.text });
      continue;
    }
    if (hay.includes(n)) { whole++; continue; }
    if (u.kind !== "fence" && sentences(u.text).every((s) => hay.includes(s))) { bySentence++; continue; }
    if (!excused(file, u.line)) report.missing.push({ file, line: u.line, kind: u.kind, text: u.text.slice(0, 160) });
  }
  report.files.push({ file, units: old.length, whole, bySentence, lines: cur.split("\n").length - (cur.endsWith("\n") ? 1 : 0) });
}
for (const [k, e] of ledger) if (!e.used) report.staleLedger.push(k);

if (opt.json) console.log(JSON.stringify(report, null, 2));
else {
  for (const f of report.files) {
    console.log(`${f.file} @ ${opt.base}: units ${f.units} · found whole ${f.whole} · by sentence ${f.bySentence} · now ${f.lines} lines`);
  }
  console.log(`missing ${report.missing.length} · headings gone from their file ${report.headingsMoved.length} · ledger entries ${ledger.size} (stale ${report.staleLedger.length})`);
  for (const u of report.missing) console.log(`  missing ${u.file}:${u.line} [${u.kind}] ${u.text.split("\n")[0].slice(0, 120)}`);
  for (const u of report.headingsMoved) console.log(`  heading gone ${u.file}:${u.line} ${u.text}`);
  for (const k of report.staleLedger) console.log(`  stale ledger entry \`${k}\` excuses nothing — remove it`);
}
process.exit(report.missing.length || report.headingsMoved.length || report.staleLedger.length ? 1 : 0);
