#!/usr/bin/env node
// check-github-binding — bindings/github.md shows only wire strings the codec accepts (#634).
//
//   node scripts/check-github-binding.mjs [binding.md] [samples.json]
//        (defaults: bindings/github.md, tools/lib/codec/samples.json)
//
// WHY. The binding is the public "how do I do this by hand on GitHub" page. A hand-copied
// comment that is one separator off is silently ignored by every reader, so a binding that
// drifts from the codec teaches people to write records nobody reads. The codec's golden
// samples are the spec; this keeps the page a view of them.
//
// What is read: only fenced blocks whose info string is `wire <section>` or
// `wire <section> not` (any fence length, so a wire containing a ``` block can sit in ````).
// In a `labels` block each non-empty line is one label; in any other block the whole body is
// one wire string. Everything else in the file — prose, tables — is not checked.
//
// Findings, one rule id each:
//   unknown-section  the block names a section samples.json does not have.
//   no-sample        the wire is not byte-equal to any sample of that polarity in the section
//                    (plain block → a sample readers decode; `not` → a sample decoding to null).
//   unknown-label    a label whose sample is known:false shown as a convention label.
//   missing-section  a samples section the binding never shows.
//   missing-label    a known:true sample label the binding never lists.
//
// Exit 0 clean · 1 findings · 2 an input file is missing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every `wire` block: `[{section, not, body, line}]` (line = 1-based line of the opening fence). */
export function parseBlocks(md) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})(.*)$/.exec(lines[i]);
    if (!open) continue;
    const fence = open[1];
    const closeRe = new RegExp(`^\`{${fence.length},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j])) j++;
    const info = open[2].trim().split(/\s+/);
    if (info[0] === "wire") {
      out.push({ section: info[1] || "", not: info[2] === "not", body: lines.slice(i + 1, j).join("\n"), line: i + 1 });
    }
    i = j;
  }
  return out;
}

/** A section's samples as a flat list — grants, decisions, releaseMarkers are objects of arrays. */
function flat(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v).flatMap(flat);
  return [];
}
/** A sample readers act on: decodes to a value, and (for a label) one the conventions know. */
const accepted = (s) => s.decoded !== null && !(s.decoded && s.decoded.known === false);

/** Compare a binding's text against the samples object; returns `[{line, rule, text}]`. */
export function check(md, samples) {
  const findings = [];
  const sections = Object.keys(samples).filter((k) => !k.startsWith("$"));
  const shown = new Set();
  const labelsShown = new Set();
  for (const b of parseBlocks(md)) {
    if (!sections.includes(b.section)) {
      findings.push({ line: b.line, rule: "unknown-section", text: `wire ${b.section}` });
      continue;
    }
    shown.add(b.section);
    const pool = flat(samples[b.section]);
    const wires = b.section === "labels" ? b.body.split("\n").filter((l) => l.trim() !== "") : [b.body];
    for (const w of wires) {
      const hit = pool.find((s) => s.wire === w);
      if (hit && b.section === "labels" && !b.not && !accepted(hit)) {
        findings.push({ line: b.line, rule: "unknown-label", text: w });
      } else if (!hit || accepted(hit) === b.not) {
        findings.push({ line: b.line, rule: "no-sample", text: w.split("\n")[0] });
      }
      if (b.section === "labels" && !b.not) labelsShown.add(w);
    }
  }
  for (const s of sections) {
    if (!shown.has(s)) findings.push({ line: 0, rule: "missing-section", text: s });
  }
  for (const s of flat(samples.labels)) {
    if (s.decoded && s.decoded.known === true && !labelsShown.has(s.wire)) {
      findings.push({ line: 0, rule: "missing-label", text: s.wire });
    }
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const mdPath = path.resolve(process.argv[2] || path.join(root, "bindings", "github.md"));
  const samplesPath = path.resolve(process.argv[3] || path.join(root, "tools", "lib", "codec", "samples.json"));
  for (const p of [mdPath, samplesPath]) {
    if (!fs.existsSync(p)) { console.error(`check-github-binding: no such file ${p}`); process.exit(2); }
  }
  const found = check(fs.readFileSync(mdPath, "utf8"), JSON.parse(fs.readFileSync(samplesPath, "utf8")));
  const rel = path.relative(root, mdPath);
  for (const f of found) console.error(`${rel}:${f.line}: [${f.rule}] ${f.text.slice(0, 160)}`);
  if (found.length) {
    console.error(`check-github-binding: ${found.length} disagreement(s) between ${rel} and the codec samples — ` +
      `copy the wire from tools/lib/codec/samples.json byte for byte, or add the sample first (#634).`);
    process.exit(1);
  }
  console.log(`check-github-binding: ok — every wire block in ${rel} is a codec sample, every section shown`);
}
