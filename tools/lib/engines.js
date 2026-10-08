'use strict';
/**
 * engines/<id>.conf — one data file per coding agent the skills can be installed for (#530).
 *
 * The format is deliberately trivial (`key: value` lines, `#` comments, `note:`/`caveat:`
 * repeatable) so install.sh can read it with sed, without node — a skills-only install must not
 * need the CLI's runtime. This module is the JS reader for `install.sh --check`; the two readers
 * must agree, and install-sh.test.js holds them to it. engines/README.md is the format's doc.
 */

const fs = require('fs');
const path = require('path');

const REPEATABLE = new Set(['note', 'caveat']);

/** Parse one conf file's text. First occurrence of a single-valued key wins, as `sed …;q` does. */
function parseConf(text) {
  const out = { note: [], caveat: [] };
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*#/.test(raw)) continue;
    const m = /^([a-z_]+):[ \t]*(.*)$/.exec(raw);
    if (!m) continue;
    const [, key, value] = m;
    if (REPEATABLE.has(key)) out[key].push(value);
    else if (!(key in out)) out[key] = value;
  }
  return out;
}

/** `~/x` → <home>/x. Same rule as install.sh's expand_home for the values a conf file can hold. */
function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

/** Every engine in <root>/engines, in file order (the order install.sh's prompt numbers them). */
function listEngines(root) {
  const dir = path.join(root, 'engines');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.conf')).sort(); } catch (_) { return []; }
  return files.map((f) => ({ id: f.slice(0, -'.conf'.length), ...parseConf(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

/** Folders given with --skills-dir on an earlier install, one per line in <COLAB_HOME>/skills-dirs. */
function rememberedDirs(colabHome) {
  let text = '';
  try { text = fs.readFileSync(path.join(colabHome, 'skills-dirs'), 'utf8'); } catch (_) { return []; }
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

module.exports = { parseConf, expandHome, listEngines, rememberedDirs };
