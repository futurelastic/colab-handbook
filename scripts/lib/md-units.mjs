// md-units — cut markdown into the units a "nothing dropped" check compares, and normalise them.
//
// Shared by scripts/check-skill-split.mjs (#524) and scripts/check-doc-move.mjs (#523). A unit is
// a whole fenced block, one table row, one list item with its continuation lines, one paragraph,
// one heading, or the frontmatter. Line numbers are 1-based.

// The hard-rule marker (#523). Stripped before comparison, so adding a marker to a rule is not
// read as a change to the rule's text. Format: `**[Hard — gate: <gate>]**` followed by one space.
export const HARD_MARKER = /\*\*\[Hard — gate: [^\]]+\]\*\* ?/g;

export function normalise(s) {
  return s
    .replace(HARD_MARKER, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // heading level is presentation, not content
    .replace(/\]\([^)#\s]*\.md(#[^)\s]+)\)/g, "]($1)") // same anchor, possibly another file
    .replace(/\]\((?:\.\.\/)+/g, "](") // a file link retargeted from a deeper directory
    .replace(/\s+/g, " ")
    .trim();
}

export function units(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  const isBlank = (l) => /^\s*$/.test(l);
  const isFence = (l) => /^\s*(```|~~~)/.test(l);
  const isHeading = (l) => /^\s{0,3}#{1,6}\s/.test(l);
  const isTable = (l) => /^\s*\|/.test(l);
  const listStart = (l) => /^(\s*)([-*+]|\d+[.)])\s+/.exec(l);
  if (lines[0] === "---") {
    let j = 1;
    while (j < lines.length && lines[j] !== "---") j++;
    out.push({ line: 1, kind: "frontmatter", text: lines.slice(0, j + 1).join("\n") });
    i = j + 1;
  }
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }
    if (isFence(l)) {
      const indent = /^(\s*)/.exec(l)[1];
      let j = i + 1;
      while (j < lines.length && !(isFence(lines[j]) && lines[j].startsWith(indent))) j++;
      out.push({ line: i + 1, kind: "fence", text: lines.slice(i, j + 1).join("\n") });
      i = j + 1;
      continue;
    }
    if (isHeading(l)) { out.push({ line: i + 1, kind: "heading", text: l }); i++; continue; }
    if (isTable(l)) {
      if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) out.push({ line: i + 1, kind: "table-row", text: l });
      i++;
      continue;
    }
    const ls = listStart(l);
    if (ls) {
      const ind = ls[1].length;
      let j = i + 1;
      while (j < lines.length) {
        const n = lines[j];
        if (isBlank(n)) {
          // A blank line ends the item unless the next non-blank line is indented continuation
          // that is not itself a list item or fence at this item's indent or shallower.
          let k = j;
          while (k < lines.length && isBlank(lines[k])) k++;
          if (k < lines.length && /^\s*/.exec(lines[k])[0].length > ind && !listStart(lines[k]) && !isFence(lines[k])) { j = k; continue; }
          break;
        }
        if (isFence(n) || isHeading(n) || isTable(n)) break;
        const nls = listStart(n);
        if (nls && nls[1].length <= ind + 1) break;
        if (nls) break; // nested item: its own unit
        j++;
      }
      out.push({ line: i + 1, kind: "list-item", text: lines.slice(i, j).join("\n") });
      i = j;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !isBlank(lines[j]) && !isFence(lines[j]) && !isHeading(lines[j]) && !isTable(lines[j]) && !listStart(lines[j])) j++;
    out.push({ line: i + 1, kind: "paragraph", text: lines.slice(i, j).join("\n") });
    i = j;
  }
  return out;
}

// Headings outside fences, normalised.
export function headingsOf(text) {
  const hs = new Set();
  let fence = false;
  for (const l of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (!fence && /^\s{0,3}#{1,6}\s/.test(l)) hs.add(normalise(l));
  }
  return hs;
}

// Sentences of a unit, for the fallback when a mixed paragraph was split at sentence
// boundaries (rule kept, rationale moved). Cuts after . ! ? : ; ) — optionally closed by bold,
// italics or a backtick — followed by whitespace and a capital,
// a backtick, an asterisk or an opening bracket — good enough for this prose, never for code.
export function sentences(text) {
  return normalise(text)
    .split(/(?<=[.!?:;)](?:\*\*|\*|`)?)\s+(?=[A-Z`*(\[“"—-])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
