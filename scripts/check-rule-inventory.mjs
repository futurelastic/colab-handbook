#!/usr/bin/env node
// check-rule-inventory — every rule in the normative documents is still where the inventory
// says, and every hard rule carries its marker and names a gate that exists (#523).
//
//   node scripts/check-rule-inventory.mjs [--inventory docs/rule-inventory.md] [--json]
//
// The inventory is a set of markdown tables whose header row is exactly
//   | id | class | gate | rule | key | dest | source |
// One row per rule. The columns this check reads:
//   id     stable identity, never renumbered (`C5.claim.03`, `S.trunk.01`); unique.
//   class  hard | default | explanation.
//   gate   hard rows only: one or more `<file>::<literal>` separated by ` ; ` — each literal must
//          occur in that repo file. A literal, not a line number, so the check does not drift.
//   key    a verbatim phrase from the rule (a few words, plain prose, no link). Compared after
//          collapsing whitespace and dropping `*` emphasis; `\|` in a cell is a literal pipe.
//   dest   the file the rule lives in now, optionally with `#anchor` (ignored by the check).
// Passes when:
//   1. ids are unique and every class is one of the three;
//   2. every key is found in its dest file;
//   3. hard and default rows live in a normative file (CONVENTIONS.md or project.schema.md) —
//      only an explanation may move to docs/adr/ or docs/gotchas.d/;
//   4. a hard row's key sits in a unit (paragraph, list item, table row) carrying the marker
//      `**[Hard — gate: …]**`, and each of its gate literals is found;
//   5. every marked unit in the normative files holds at least one hard row's key — a marker no
//      row accounts for is a rule the inventory never saw.
// Exit 0 clean · 1 findings · 2 usage or unreadable inventory.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { units } from "./lib/md-units.mjs";

export const NORMATIVE = ["CONVENTIONS.md", "project.schema.md"];
export const CLASSES = new Set(["hard", "default", "explanation"]);
const HEADER = ["id", "class", "gate", "rule", "key", "dest", "source"];
const MARKER = /\*\*\[Hard — gate: [^\]]+\]\*\*/;

// Split a table row on unescaped pipes; `\|` becomes `|`.
export function cells(line) {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i++; continue; }
    if (t[i] === "|") { out.push(cur.trim()); cur = ""; continue; }
    cur += t[i];
  }
  out.push(cur.trim());
  return out;
}

export function parseInventory(text) {
  const rows = [];
  let inTable = false;
  text.split("\n").forEach((line, i) => {
    if (!/^\s*\|/.test(line)) { inTable = false; return; }
    const c = cells(line);
    if (!inTable) {
      inTable = c.length === HEADER.length && c.every((x, k) => x.toLowerCase() === HEADER[k]);
      return;
    }
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return;
    const r = Object.fromEntries(HEADER.map((h, k) => [h, c[k] ?? ""]));
    r.line = i + 1;
    r.cols = c.length;
    rows.push(r);
  });
  return rows;
}

// Inventory cells wrap a key or literal in backticks only when it is code; strip one outer pair.
const unwrap = (s) => s.replace(/^`(.*)`$/, "$1");
export const flat = (s) => s.replace(/\\\|/g, "|").replace(/\*/g, "").replace(/\s+/g, " ").trim();

export function check({ root, inventory = "docs/rule-inventory.md" }) {
  const findings = [];
  const say = (r, msg) => findings.push(`row ${r.id || "?"} (inventory line ${r.line}): ${msg}`);
  const readCache = new Map();
  const read = (f) => {
    if (!readCache.has(f)) {
      const p = path.join(root, f);
      readCache.set(f, fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
    }
    return readCache.get(f);
  };
  const flatCache = new Map();
  const flatOf = (f) => {
    if (!flatCache.has(f)) { const t = read(f); flatCache.set(f, t == null ? null : flat(t)); }
    return flatCache.get(f);
  };

  const text = read(inventory);
  if (text == null) return { rows: [], findings: [`cannot read ${inventory}`], fatal: true };
  const rows = parseInventory(text);
  if (!rows.length) return { rows, findings: [`${inventory} has no table with header | ${HEADER.join(" | ")} |`], fatal: true };

  const seen = new Map();
  for (const r of rows) {
    if (r.cols !== HEADER.length) { say(r, `has ${r.cols} cells, expected ${HEADER.length} — an unescaped | in a cell?`); continue; }
    if (!r.id) say(r, "empty id");
    else if (seen.has(r.id)) say(r, `duplicate id (also inventory line ${seen.get(r.id)})`);
    else seen.set(r.id, r.line);
    if (!CLASSES.has(r.class)) { say(r, `class "${r.class}" is not hard, default or explanation`); continue; }
    const dest = r.dest.replace(/`/g, "").split("#")[0].trim();
    const key = flat(unwrap(r.key));
    if (key.split(" ").length < 3) { say(r, `key "${r.key}" is too short to identify a rule`); continue; }
    if (r.class !== "explanation" && !NORMATIVE.includes(dest)) {
      say(r, `a ${r.class} rule must live in ${NORMATIVE.join(" or ")}, not "${dest}" — only an explanation may move to an ADR`);
    }
    const hay = flatOf(dest);
    if (hay == null) { say(r, `dest "${dest}" does not exist`); continue; }
    if (!hay.includes(key)) { say(r, `key not found in ${dest}: "${key.slice(0, 100)}" — update the row, or restore the rule`); continue; }
    if (r.class === "hard") {
      const gates = r.gate.split(" ; ").map((g) => g.trim()).filter(Boolean);
      if (!gates.length) say(r, "a hard rule names no gate (`<file>::<literal>`)");
      for (const g of gates) {
        const m = /^`?([^`:]+)::(.+?)`?$/.exec(g);
        if (!m) { say(r, `gate "${g}" is not <file>::<literal>`); continue; }
        const src = read(m[1].trim());
        if (src == null) say(r, `gate file ${m[1]} does not exist`);
        else if (!src.includes(unwrap(m[2].trim()))) say(r, `gate literal not found in ${m[1]}: ${m[2]} — is this rule still gated?`);
      }
    }
  }

  // Marker coverage, both directions.
  const hardKeys = rows.filter((r) => r.class === "hard").map((r) => ({ r, key: flat(unwrap(r.key)) }));
  for (const f of NORMATIVE) {
    const t = read(f);
    if (t == null) continue;
    const us = units(t).filter((u) => u.kind !== "fence" && u.kind !== "heading");
    for (const u of us) {
      const marked = MARKER.test(u.text.replace(/`[^`]*`/g, "")); // a marker quoted as code is an example, not a marker
      const ft = flat(u.text);
      const held = hardKeys.filter(({ r, key }) => r.dest.replace(/`/g, "").split("#")[0].trim() === f && ft.includes(key));
      if (marked && !held.length) findings.push(`${f}:${u.line}: a Hard marker no inventory row accounts for — add the rule's row (class hard)`);
      for (const { r } of held) r._marked = r._marked || marked;
    }
  }
  for (const { r } of hardKeys) {
    if (r._marked === false || r._marked === undefined) {
      if (findings.some((x) => x.startsWith(`row ${r.id} `))) continue;
      say(r, "a hard rule whose paragraph carries no **[Hard — gate: …]** marker");
    }
  }
  return { rows, findings, fatal: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let inventory = "docs/rule-inventory.md", json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--inventory") inventory = args[++i];
    else if (args[i] === "--json") json = true;
    else { console.error(`check-rule-inventory: unknown argument ${args[i]}`); process.exit(2); }
  }
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const res = check({ root, inventory });
  const by = {};
  for (const r of res.rows) by[r.class] = (by[r.class] || 0) + 1;
  if (json) console.log(JSON.stringify({ counts: by, findings: res.findings }, null, 2));
  else {
    console.log(`rule inventory: ${res.rows.length} rows (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ")}) · findings ${res.findings.length}`);
    for (const f of res.findings) console.log(`  ${f}`);
  }
  process.exit(res.fatal ? 2 : res.findings.length ? 1 : 0);
}
