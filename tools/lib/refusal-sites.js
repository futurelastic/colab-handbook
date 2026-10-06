'use strict';
/**
 * Refusal sites and their remedies (#532).
 *
 * CONVENTIONS.md §8 (*Every refusal names the next command*): a refusal `colab` prints ends with
 * the exact next command that gets the user forward — or says plainly that no command can and who
 * decides. This module is the mechanical half of that rule: it finds every refusal site in the
 * CLI's source and answers, per site, whether a remedy is visible there.
 *
 * WHAT A SITE IS. Two shapes, both of which reach the user as a `✗` line:
 *   - `throw new UserError(…)` — the top-level handler prints it as `✗ <message>`;
 *   - a `print(…)` / `process.stderr.write(…)` / `process.stdout.write(…)` / `warn(…)` / `say(…)`
 *     whose first argument is a string literal beginning with `✗`.
 * A `✗` used as a table glyph (`c.ok ? '✓' : '✗'`) is not a site: its argument does not START with
 * `✗`. A RELAY — `✗ ${x.message}`, `✗ B1: ${syncProblem}`: nothing but an optional label and one
 * interpolation — is not a site either: its text is produced somewhere else, and that producer is
 * the site the rule binds (usually a UserError, or a `.message` built by a module).
 *
 * WHAT COUNTS AS A REMEDY — read from the site's own text: the UserError's argument, or, for a
 * `✗` write, the lines that follow it in the same block up to its `return` (a refusal usually
 * prints its remedy on the next line). Any one of:
 *   - a command: `colab …`, `gh …`, `git …`, `COLAB_HUMAN=1 …`, `export …` (and npm/npx/node/sh/
 *     launchctl), in a code span or as a printed line of its own;
 *   - a flag to pass: "pass/add/supply/use/re-run with --flag";
 *   - a plain no-command statement or who decides: "no command …", "a human must …", "the owner
 *     decides …";
 *   - a wait that names what it waits for: "re-run once …", "retry when …" (a bare "retry" does
 *     not count — CONVENTIONS: "Retry later" counts only when it names what to wait for);
 *   - a call to a remedy helper (`shipHumanDoorRefusal`, `humanDoorCommands`, a `.remedy` field).
 * This is a textual check, deliberately: it cannot judge whether the named command is RIGHT, only
 * that one is there. The judgement stays with the reviewer; the test only stops a refusal from
 * shipping with no way forward at all.
 *
 * KNOWN EXCEPTIONS. The rule arrived after ~200 refusals were written, and #532 asks for a list,
 * not a rewrite. `refusal-sites.known.json` holds the key of every site that had no remedy when the
 * rule landed. The test ratchets in both directions: a NEW site without a remedy fails, and a
 * listed key that no longer names a remedy-less site fails too, so the list only ever shrinks.
 * Keys are text, not line numbers — `<file>:<kind>:<normalized message head>[#k]` — so an
 * unrelated edit elsewhere in a 15k-line file does not churn the list.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/** The source files `colab` runs: the CLI plus every non-test module under tools/lib. */
function sourceFiles(root = ROOT) {
  const lib = path.join(root, 'tools', 'lib');
  const mods = fs.readdirSync(lib)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'refusal-sites.js')
    .sort()
    .map((f) => path.join('tools', 'lib', f));
  return ['tools/colab', ...mods];
}

/**
 * From `src[open]` === '(' return the index of its matching ')'. Skips string, template and
 * comment contents (with `${…}` nesting inside templates), which is all the CLI's own syntax
 * needs — this is not a JS parser and does not pretend to be one.
 */
function matchParen(src, open) {
  let depth = 0;
  const stack = []; // template-literal nesting: each entry is the brace depth where `${` opened
  let braces = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '`') { i = skipTemplate(src, i); continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
    else if (c === '{') braces++;
    else if (c === '}') braces--;
  }
  void stack; void braces;
  return -1;
}

/** From `src[i]` === '`' return the index of the closing backtick, honouring `${…}` nesting. */
function skipTemplate(src, i) {
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '`') return i;
    if (c === '$' && src[i + 1] === '{') {
      let d = 1;
      for (i += 2; i < src.length && d > 0; i++) {
        const k = src[i];
        if (k === "'" || k === '"') { for (i++; i < src.length && src[i] !== k; i++) if (src[i] === '\\') i++; }
        else if (k === '`') i = skipTemplate(src, i);
        else if (k === '{') d++;
        else if (k === '}') d--;
      }
      i--; // the loop's i++ lands on the char after '}'
    }
  }
  return src.length;
}

/** Message head used in a key: interpolations collapsed, escapes and quotes dropped. */
function normalizeHead(text) {
  return text
    .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '…')
    .replace(/\\n/g, ' ')
    .replace(/\\(.)/g, '$1')
    .replace(/['"`]\s*\+\s*['"`]/g, '')
    .replace(/^[\s'"`]+/, '')
    .replace(/^✗\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s'"`]+$/, '')
    .trim()
    .slice(0, 72)
    .trim();
}

const CMD_WORD = '(?:colab|gh|git|npm|npx|node|sh|launchctl|export)';
const REMEDY = [
  // a command in a code span (escaped backtick inside a template literal, or a literal backtick)
  new RegExp(`(?:\\\\\`|\`)\\s*(?:COLAB_\\w+=\\S+\\s+)?${CMD_WORD}\\s+[-\\w"'<]`),
  // a command printed as a line of its own, or after a "run"/"→" lead-in
  new RegExp(`(?:^|['"\`]|\\b(?:run|re-run|rerun|then|try|with)\\b:?|:|→)\\s*(?:COLAB_\\w+=\\S+\\s+)?${CMD_WORD}\\s+[-a-z]`, 'im'),
  /COLAB_HUMAN=1/,
  // a flag to pass
  /\b(?:pass|add|supply|use|with|re-run with|rerun with|retry with|give|drop|remove|omit|without)\s+(?:\\`|`)?--[a-z]/i,
  // an argument error that names what is valid, or the help to read
  /\b(?:expected|must be(?: one of)?|one of|valid values?|accepted)\b\s*:?\s*['"`\\]*[\w<-]/i,
  /--help\b/,
  // no command / who decides
  /\bno (?:colab |other )?(?:command|flag|field)\b/i,
  /\b(?:a human|a person|the owner|an admin|the operator|a repo admin|Boss)\s+(?:must|decides|finishes|has to|runs|closes|gives|merges|promotes|sets)\b/i,
  // a wait that names what it waits for
  /\b(?:once|when|after|until)\b[^.]{0,120}\b(?:re-?run|retry|try again)\b/i,
  /\b(?:re-?run|retry|try again)\b[^.]{0,80}\b(?:once|when|after|until)\b/i,
  /\bwait (?:for|until)\b/i,
  // an interactive re-ask is its own next step
  /\bchoose again\b/i,
  // remedy helpers
  /\.remedy\b|\bremedy:|shipHumanDoorRefusal\(|humanDoorCommands\(/,
];

function hasRemedy(text) {
  const t = text.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  return REMEDY.some((re) => re.test(t));
}

/** True when a `✗` literal is only a label plus one interpolation: its text is made elsewhere. */
function isRelay(argSrc) {
  const m = /^\s*(['"`])([\s\S]*?)\1\s*$/.exec(argSrc);
  if (!m) return false;
  const body = m[2].replace(/\\n$/, '');
  return /^\s*(?:✗\s*)?(?:[\w -]{1,24}:\s*)?(?:\$\{(?:[^{}]|\{[^{}]*\})*\}[\s:—-]*){1,2}$/.test(body);
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * Every refusal site in `files`, each `{ file, line, kind, key, head, remedy }`. `kind` is
 * `user-error` or `write`. Duplicated keys inside one file get a `#2`, `#3` suffix in source order.
 */
function scan({ root = ROOT, files = sourceFiles(root), read = (f) => fs.readFileSync(path.join(root, f), 'utf8') } = {}) {
  const sites = [];
  for (const file of files) {
    const src = read(file);
    const lines = src.split('\n');
    const seen = new Map();
    const found = [];

    for (const m of src.matchAll(/\bnew UserError\(/g)) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(src, open);
      if (close < 0) continue;
      const arg = src.slice(open + 1, close);
      // `new UserError(syncProblem)`, `new UserError(\`${a}: ${b}\`)`: a relay — the text is built
      // elsewhere, and that builder is out of this scan's reach (a documented blind spot).
      if (/^\s*[\w.]+\s*$/.test(arg) || isRelay(arg)) continue;
      found.push({ idx: m.index, kind: 'user-error', head: normalizeHead(arg), remedy: hasRemedy(arg) });
    }

    const WRITE = /\b(?:process\.(?:stderr|stdout)\.write|print|warn|say)\(\s*(['"`])\s*✗/g;
    for (const m of src.matchAll(WRITE)) {
      const open = src.indexOf('(', m.index);
      const close = matchParen(src, open);
      if (close < 0) continue;
      const arg = src.slice(open + 1, close);
      if (isRelay(arg)) continue;
      // The block: this line and the lines after it at the same or deeper indent, through the first
      // `return` — where a refusal prints its remedy.
      const ln = lineOf(src, m.index) - 1;
      const indent = /^\s*/.exec(lines[ln])[0].length;
      const block = [src.slice(m.index, close + 1)];
      const sameLineRest = lines[ln].slice(lines[ln].indexOf(lines[ln].trim()));
      if (!/\breturn\b/.test(sameLineRest.slice(sameLineRest.indexOf('✗')))) {
        for (let k = lineOf(src, close); k < Math.min(lines.length, ln + 30); k++) {
          const l = lines[k];
          if (l.trim() && /^\s*/.exec(l)[0].length < indent) break;
          block.push(l);
          if (/\breturn\b/.test(l)) break;
        }
      }
      found.push({ idx: m.index, kind: 'write', head: normalizeHead(arg), remedy: hasRemedy(block.join('\n')) });
    }

    found.sort((a, b) => a.idx - b.idx);
    for (const f of found) {
      const base = `${file}:${f.kind}:${f.head}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      sites.push({ file, line: lineOf(src, f.idx), kind: f.kind, head: f.head, remedy: f.remedy, key: n === 1 ? base : `${base}#${n}` });
    }
  }
  return sites;
}

const KNOWN_PATH = path.join(__dirname, 'refusal-sites.known.json');

/** The known-exception list: `{ "<key>": "<why / issue>" }`. */
function loadKnown(file = KNOWN_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).known;
}

/**
 * Compare a scan against the known list. `unlisted` = remedy-less sites not on the list (the rule
 * is broken); `stale` = listed keys that no longer name a remedy-less site (the list must shrink).
 */
function check(sites, known) {
  const bare = sites.filter((s) => !s.remedy);
  const bareKeys = new Set(bare.map((s) => s.key));
  return {
    total: sites.length,
    bare: bare.length,
    unlisted: bare.filter((s) => !Object.prototype.hasOwnProperty.call(known, s.key)),
    stale: Object.keys(known).filter((k) => !bareKeys.has(k)),
  };
}

module.exports = { scan, check, loadKnown, hasRemedy, isRelay, normalizeHead, matchParen, sourceFiles, KNOWN_PATH };

if (require.main === module) {
  // `node tools/lib/refusal-sites.js [--bare] [--write-known]` — list sites; --write-known
  // rewrites the known list from the current bare set, KEEPING the reasons already written.
  const sites = scan();
  const args = process.argv.slice(2);
  if (args.includes('--write-known')) {
    let prev = {};
    try { prev = loadKnown(); } catch (_) { /* first write */ }
    const known = {};
    for (const s of sites.filter((x) => !x.remedy)) known[s.key] = prev[s.key] || 'pre-#532: refusal with no next command yet';
    fs.writeFileSync(KNOWN_PATH, JSON.stringify({
      $comment: 'Refusals that had no next command when #532 landed. Shrink only: fix a refusal, then delete its key (refusal-sites.test.js fails on a stale key). Never add one — a new refusal names its next command.',
      known,
    }, null, 1) + '\n');
    process.stdout.write(`wrote ${Object.keys(known).length} key(s) to ${path.relative(ROOT, KNOWN_PATH)}\n`);
  } else {
    for (const s of sites) if (!args.includes('--bare') || !s.remedy) process.stdout.write(`${s.remedy ? '✓' : '✗'} ${s.file}:${s.line}  ${s.key}\n`);
    const r = check(sites, (() => { try { return loadKnown(); } catch (_) { return {}; } })());
    process.stdout.write(`\n${r.total} site(s), ${r.bare} without a remedy, ${r.unlisted.length} unlisted, ${r.stale.length} stale\n`);
  }
}
