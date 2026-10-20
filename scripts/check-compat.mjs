#!/usr/bin/env node
// check-compat — the handbook's public surfaces do not disappear silently (#644).
//
//   node scripts/check-compat.mjs [--base <rev>] [--list] [--json]
//
// docs/compat-surfaces.md is the committed list: one ```compat <kind>``` block per kind, one
// surface per line, plus a ```compat retired``` block. Adopters' instructions, skills and code
// name these surfaces (section anchors, skill names, `colab` commands, project.yml keys, codec
// strings, package paths, engine confs, template paths), so each one is a promise.
//
// Two passes, each catching what the other cannot:
//   1. Snapshot (always). Every listed surface must still resolve in the tree — a stub, an alias
//      or a forwarding command counts, absence does not. Every live surface of a CLOSED kind must
//      be listed, so the list cannot rot and a new public surface is registered the day it lands.
//      A codec string is pinned by value: changing it is a break even though the name survives.
//   2. Base (--base <rev>). Every surface listed at <rev> must still be listed now, or named in
//      the retired block. Without this pass, deleting the row together with the surface passes.
//
// Retirement: a retired line is `<kind> <name> — vX.Y.0 — <evidence>`. The version must be a
// minor or major release (patch 0), and a surface newly retired on this branch must name a
// version later than the newest final tag — i.e. the next minor, whose notes name it. The
// evidence (the adopter search that found nothing still using it) is required.
//
// Exit 0: clean. Exit 1: a finding. Exit 2: usage or git error.
// Runs in scripts/smoke.sh and in CI's self-check job; tools/lib/compat-surfaces.test.js proves
// each failure fires.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const LIST = "docs/compat-surfaces.md";

// Kinds in list order. `closed`: the tree can enumerate every surface of this kind, so an
// unlisted one is a finding. `export` is declared, not closed — only the listed package paths
// are public; every other tools/lib module stays internal and may move freely.
export const KINDS = {
  heading: { closed: true, what: "CONVENTIONS.md section anchor" },
  skill: { closed: true, what: "skill" },
  command: { closed: true, what: "colab command" },
  key: { closed: true, what: "project.yml key" },
  codec: { closed: true, what: "codec string" },
  export: { closed: false, what: "package path" },
  engine: { closed: true, what: "engine conf" },
  template: { closed: true, what: "template path" },
};

const readIf = (root, f) => {
  try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return null; }
};

// ---- enumeration: what the tree offers today, per kind ---------------------------------------

// GitHub's anchor rule: lowercase, drop everything but letters, digits, spaces, `-` and `_`,
// spaces to `-`; a repeated slug gets `-1`, `-2`… in document order.
export function slug(text) {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
}

export function headingAnchors(md) {
  const out = [];
  const seen = new Map();
  let fence = null;
  for (const line of md.split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (!h) continue;
    const base = slug(h[2]);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.push(n ? `${base}-${n}` : base);
  }
  return out;
}

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const l of m[1].split("\n")) {
    const kv = l.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

// A skill folder counts — the full skill or a thin alias that loads its replacement — when its
// SKILL.md still answers to the name and still says when to load it.
function skills(root) {
  const dir = path.join(root, "skills");
  const live = new Set();
  const broken = new Map();
  if (!fs.existsSync(dir)) return { live, broken };
  for (const d of fs.readdirSync(dir).sort()) {
    if (!fs.statSync(path.join(dir, d)).isDirectory()) continue;
    const md = readIf(root, `skills/${d}/SKILL.md`);
    if (md === null) { broken.set(d, "has no SKILL.md"); continue; }
    const fm = frontmatter(md);
    if (fm.name !== d) broken.set(d, `SKILL.md frontmatter name is "${fm.name ?? ""}", not "${d}"`);
    else if (!fm.description) broken.set(d, "SKILL.md has no description (its triggers)");
    else live.add(d);
  }
  return { live, broken };
}

// The top-level `colab <command>` verbs: the `case '<name>':` labels of the main dispatch switch.
// A retired verb that forwards to its replacement keeps its case, so it still counts.
export function commandsOf(src) {
  const at = src.lastIndexOf("switch (cmd) {");
  if (at === -1) return null;
  const body = src.slice(at, src.indexOf("\n  }", at));
  const out = new Set();
  for (const m of body.matchAll(/case '([a-z][a-z0-9-]*)':/g)) if (m[1] !== "help" && m[1] !== "version") out.add(m[1]);
  return out;
}

// project.yml keys: the backticked names in project.schema.md's `### ` field headings, minus the
// ones that document a deliberate non-field.
export function schemaKeys(md) {
  const out = new Set();
  let inFields = false;
  for (const line of md.split("\n")) {
    if (/^## /.test(line)) inFields = /^## Fields\s*$/.test(line);
    if (!inFields || !/^### /.test(line) || /deliberately not a field/.test(line)) continue;
    const names = line.split(/ — /)[0];
    for (const m of names.matchAll(/`([A-Za-z][A-Za-z0-9-]*)`/g)) out.add(m[1]);
  }
  return out;
}

// Codec strings: every string export, every all-string array (joined with `,`) and the
// convention label names, read from the codec as it loads. RegExps are not pinned here — the
// codec's samples.json round-trip pins them byte for byte.
export function codecStrings(root) {
  const file = path.join(root, "tools/lib/codec/index.js");
  if (!fs.existsSync(file)) return new Map();
  delete require.cache[require.resolve(file)];
  const codec = require(file);
  const out = new Map();
  for (const [k, v] of Object.entries(codec)) {
    if (typeof v === "string") out.set(k, v);
    else if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) out.set(k, v.join(","));
  }
  if (Array.isArray(codec.CONVENTION_LABELS)) out.set("CONVENTION_LABELS", codec.CONVENTION_LABELS.map((l) => l.name).join(","));
  return out;
}

const filesIn = (root, d, re) => {
  const dir = path.join(root, d);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => re.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
};

// The live surfaces, kind -> Map(name -> value|null), plus per-kind notes for a broken surface.
export function enumerate(root) {
  const live = {};
  const notes = {};
  const conv = readIf(root, "CONVENTIONS.md");
  live.heading = new Map((conv === null ? [] : headingAnchors(conv)).map((a) => [a, null]));
  const sk = skills(root);
  live.skill = new Map([...sk.live].map((s) => [s, null]));
  notes.skill = sk.broken;
  const colab = readIf(root, "tools/colab");
  live.command = new Map([...(colab === null ? [] : commandsOf(colab) || [])].map((c) => [c, null]));
  const schema = readIf(root, "project.schema.md");
  live.key = new Map([...(schema === null ? [] : schemaKeys(schema))].map((k) => [k, null]));
  live.codec = codecStrings(root);
  live.export = null; // declared kind: resolved per listed path, never enumerated
  live.engine = new Map(filesIn(root, "engines", /\.conf$/).map((f) => [f.replace(/\.conf$/, ""), null]));
  live.template = new Map(filesIn(root, "templates", /./).map((f) => [`templates/${f}`, null]));
  return { live, notes };
}

// ---- the list --------------------------------------------------------------------------------

// `NAME = "value"` pins a value (codec); anything else on a line is the surface's name.
// A `#` line inside a block is a comment.
export function parseList(md) {
  const list = Object.fromEntries(Object.keys(KINDS).map((k) => [k, new Map()]));
  const retired = [];
  const errors = [];
  let kind = null;
  md.split("\n").forEach((line, i) => {
    const open = line.match(/^```compat\s+([a-z]+)\s*$/);
    if (open) {
      kind = open[1];
      if (kind !== "retired" && !KINDS[kind]) errors.push(`${LIST}:${i + 1}: unknown kind "${kind}"`);
      return;
    }
    if (kind && /^```\s*$/.test(line)) { kind = null; return; }
    if (!kind) return;
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    if (kind === "retired") {
      const m = t.match(/^([a-z]+)\s+(\S+)\s+—\s+(v\d+\.\d+\.\d+)\s+—\s+(.*)$/);
      if (!m) errors.push(`${LIST}:${i + 1}: a retired line is "<kind> <name> — vX.Y.Z — <evidence>", got: ${t}`);
      else retired.push({ kind: m[1], name: m[2], version: m[3], evidence: m[4].trim(), line: i + 1 });
      return;
    }
    if (!KINDS[kind]) return;
    const pin = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(".*")$/);
    if (pin) {
      try { list[kind].set(pin[1], JSON.parse(pin[2])); }
      catch { errors.push(`${LIST}:${i + 1}: the pinned value is not a JSON string: ${t}`); }
    } else list[kind].set(t, null);
  });
  return { list, retired, errors };
}

// Inverse of parseList for one kind — what `--list` prints, so registering is a paste.
export function formatKind(kind, entries) {
  const lines = [...entries].map(([n, v]) => (v === null ? n : `${n} = ${JSON.stringify(v)}`));
  return "```compat " + kind + "\n" + lines.join("\n") + (lines.length ? "\n" : "") + "```";
}

const semver = (v) => v.replace(/^v/, "").split(".").map(Number);
const cmpVer = (a, b) => {
  const x = semver(a), y = semver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

// ---- the check -------------------------------------------------------------------------------

// root: the tree. base: the list's text at the base revision (null = skip the base pass).
// latestTag: the newest final vX.Y.Z tag (null = unknown; then a new retirement cannot be dated).
export function check({ root, base = null, latestTag = null }) {
  const findings = [];
  const text = readIf(root, LIST);
  if (text === null) return { findings: [`${LIST} is missing — the committed list of public surfaces`] };
  const { list, retired, errors } = parseList(text);
  findings.push(...errors);
  const { live, notes } = enumerate(root);
  const retiredKey = new Set(retired.map((r) => `${r.kind} ${r.name}`));

  for (const [kind, spec] of Object.entries(KINDS)) {
    for (const [name, pinned] of list[kind]) {
      if (retiredKey.has(`${kind} ${name}`)) {
        findings.push(`${kind} ${name} is both listed and retired — drop one`);
        continue;
      }
      if (kind === "export") {
        if (!fs.existsSync(path.join(root, name))) findings.push(`${spec.what} ${name} is gone — re-export it from its new place, or retire it in a minor release`);
        continue;
      }
      if (!live[kind].has(name)) {
        const why = notes[kind]?.get(name);
        findings.push(why
          ? `${spec.what} ${name} ${why} — keep it as a thin alias that loads its replacement`
          : `${spec.what} ${name} disappeared — ${hint(kind)}`);
        continue;
      }
      if (pinned !== null && live[kind].get(name) !== pinned) {
        findings.push(`${spec.what} ${name} changed: ${JSON.stringify(pinned)} → ${JSON.stringify(live[kind].get(name))} — a label, marker or codec string is never changed in place`);
      }
    }
    if (!spec.closed) continue;
    for (const [name, value] of live[kind]) {
      if (!list[kind].has(name)) findings.push(`${spec.what} ${name} is not in ${LIST} — register it in the \`compat ${kind}\` block (\`node scripts/check-compat.mjs --list\` prints the line)${value === null ? "" : `: ${name} = ${JSON.stringify(value)}`}`);
    }
  }

  const baseRetired = new Set();
  if (base !== null) {
    const was = parseList(base);
    for (const r of was.retired) baseRetired.add(`${r.kind} ${r.name}`);
    for (const kind of Object.keys(KINDS)) {
      for (const name of was.list[kind].keys()) {
        if (!list[kind].has(name) && !retiredKey.has(`${kind} ${name}`)) {
          findings.push(`${KINDS[kind].what} ${name} was removed from ${LIST} without a retired line — a surface leaves only in a minor release whose notes name it`);
        }
      }
    }
  }

  for (const r of retired) {
    const where = `${LIST}:${r.line}`;
    if (!KINDS[r.kind]) { findings.push(`${where}: retired line names unknown kind "${r.kind}"`); continue; }
    if (semver(r.version)[2] !== 0) findings.push(`${where}: ${r.kind} ${r.name} retires in ${r.version}, a patch release — a surface is retired only in a minor (or major) release`);
    if (!r.evidence || r.evidence.length < 10) findings.push(`${where}: ${r.kind} ${r.name} has no evidence — name the adopter search that found nothing still using it`);
    const isNew = base === null ? false : !baseRetired.has(`${r.kind} ${r.name}`);
    if (isNew) {
      if (latestTag === null) findings.push(`${where}: ${r.kind} ${r.name} is newly retired but no release tag is visible to date it — fetch tags`);
      else if (cmpVer(r.version, latestTag) <= 0) findings.push(`${where}: ${r.kind} ${r.name} retires in ${r.version}, already released (latest ${latestTag}) — name the next minor release`);
    }
  }
  return { findings };
}

function hint(kind) {
  switch (kind) {
    case "heading": return "keep the heading with a short stub (the rule in one line + where the mechanics went); never renumber";
    case "skill": return "keep the folder as a thin alias that loads its replacement guide, same name and triggers";
    case "command": return "keep the command, or have it answer with the exact command that replaces it, for at least one minor release";
    case "key": return "a project.yml key is never renamed or removed; document its meaning differently instead";
    case "codec": return "a label, marker or codec string is never removed";
    case "engine": return "engine conf names are never renamed (prose may say \"agent runtime\")";
    case "template": return "keep the file, with a header naming its new home";
    default: return "keep it, or retire it in a minor release";
  }
}

// ---- CLI -------------------------------------------------------------------------------------

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function main(argv) {
  const opt = { base: null, list: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") opt.base = argv[++i];
    else if (argv[i] === "--list") opt.list = true;
    else if (argv[i] === "--json") opt.json = true;
    else { console.error(`check-compat: unknown argument ${argv[i]}\nusage: node scripts/check-compat.mjs [--base <rev>] [--list] [--json]`); return 2; }
  }
  let root;
  try { root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim(); }
  catch { root = path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."); }

  if (opt.list) {
    const { live } = enumerate(root);
    const cur = readIf(root, LIST);
    const declared = cur === null ? new Map() : parseList(cur).list.export;
    for (const kind of Object.keys(KINDS)) console.log(formatKind(kind, kind === "export" ? declared : live[kind]) + "\n");
    return 0;
  }

  let base = null;
  if (opt.base) {
    try { base = git(root, ["show", `${opt.base}:${LIST}`]); }
    catch (e) {
      const msg = String(e.stderr || e.message);
      if (/does not exist in|exists on disk, but not in/.test(msg)) base = ""; // the list is new at base
      else { console.error(`check-compat: cannot read ${LIST} at ${opt.base}: ${msg.trim()}`); return 2; }
    }
  }
  let latestTag = null;
  try {
    latestTag = git(root, ["tag", "-l", "v*", "--sort=-v:refname"]).split("\n").find((t) => /^v\d+\.\d+\.\d+$/.test(t)) || null;
  } catch { /* no tags visible: a newly retired surface is then reported, never passed */ }

  const { findings } = check({ root, base, latestTag });
  if (opt.json) console.log(JSON.stringify({ findings }, null, 2));
  else if (findings.length) for (const f of findings) console.error(`✗ compat: ${f}`);
  else console.log(`compat: every public surface in ${LIST} still answers${base === null ? " (no --base: removals not checked)" : ""}`);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
