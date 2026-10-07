#!/usr/bin/env node
// check-engine-neutral — no skill body assumes one coding agent (#531).
//
//   node scripts/check-engine-neutral.mjs [dir]      (default: skills/)
//
// WHY. The skills install into any engine (#530): each engine has its own file under engines/
// saying how a skill is invoked, whether helper agents exist, and so on. A skill body that writes
// one engine's slash command, calls one engine's tool by name, or names a vendor's model reads as
// broken everywhere else — and the coupling creeps back one helpful example at a time. So this
// scans every .md under skills/ and fails on any of the shapes below. engines/ and the READMEs'
// engine table are where engine-specific text belongs; they are not scanned.
//
// What fails, one rule each (a rule id is printed with every finding):
//   slash-invoke   `/<skill-name>` used as a command — name the skill instead ("run code-start").
//                  A path segment (`skills/code-start/`, `../code-start/SKILL.md`) is not a hit.
//   tool-call      one engine's helper/tool syntax: `Agent(`, `subagent_type`, `TodoWrite`,
//                  `SendMessage`, `$ARGUMENTS`, "the <X> tool" for an engine's built-in tool.
//   engine-name    a product or vendor host: Claude Code, claude.ai, Codex, Cursor, Copilot, Gemini.
//   model-name     a model family: Opus, Sonnet, Haiku, GPT-n.
//
// Exit 0 clean · 1 findings · 2 nothing to scan.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function rules(skillNames) {
  const names = skillNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return [
    names && { id: "slash-invoke", re: new RegExp(`(^|[^\\w./~-])/(${names})(?![\\w/-])`) },
    { id: "tool-call", re: /\bAgent\(|subagent_type|\bTodoWrite\b|\bSendMessage\b|\$ARGUMENTS\b|\b(Skill|Bash|Read|Edit|Write|Grep|Glob|Agent|Task) tool\b/ },
    { id: "engine-name", re: /Claude Code|claude\.ai|\bCodex\b|\bCursor\b|\bCopilot\b|\bGemini\b/i },
    { id: "model-name", re: /\b(Opus|Sonnet|Haiku)\b|\bGPT-?\d/i },
  ].filter(Boolean);
}

function mdFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...mdFiles(p));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out.sort();
}

/** Scan `dir` (a skills folder); returns `[{file, line, rule, text}]`. */
export function scan(dir) {
  const skillNames = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name);
  const rs = rules(skillNames);
  const findings = [];
  for (const f of mdFiles(dir)) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const r of rs) if (r.re.test(text)) findings.push({ file: f, line: i + 1, rule: r.id, text: text.trim() });
    });
  }
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const dir = path.resolve(process.argv[2] || path.join(root, "skills"));
  if (!fs.existsSync(dir)) { console.error(`check-engine-neutral: no such directory ${dir}`); process.exit(2); }
  const found = scan(dir);
  for (const f of found) {
    console.error(`${path.relative(root, f.file)}:${f.line}: [${f.rule}] ${f.text.slice(0, 160)}`);
  }
  if (found.length) {
    console.error(`check-engine-neutral: ${found.length} engine-specific line(s) in skill bodies — name the skill, ` +
      `describe the capability, and leave the engine's syntax to engines/<id>.conf (#531).`);
    process.exit(1);
  }
  console.log("check-engine-neutral: ok — no skill body names an engine's tool, invocation or model");
}
