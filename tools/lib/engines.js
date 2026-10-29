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
const crypto = require('crypto');

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

/**
 * Per-repo copies (#664): `install.sh --repo <path> --engine <id>` copies the skills into the agent
 * runtime's PROJECT skills folder (`project_skills_dir:`), for a runtime whose sessions run in a
 * private home and never see a user-level install. Each copy is remembered in
 * <COLAB_HOME>/skills-copies as one `<engine id>|<repo path>` line, so `--check` finds it.
 */
function rememberedCopies(colabHome) {
  let text = '';
  try { text = fs.readFileSync(path.join(colabHome, 'skills-copies'), 'utf8'); } catch (_) { return []; }
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('|'))
    .map((l) => { const i = l.indexOf('|'); return { engine: l.slice(0, i), repo: l.slice(i + 1) }; });
}

/** The manifest install.sh writes beside the copies: what it copied, at which version, with what content. */
const COPY_MANIFEST = '.colab-handbook-skills';

/**
 * A skill folder's content digest — the same algorithm as install.sh's tree_digest, and
 * install-sh.test.js holds the two to it: sha256 over one `<sha256 of file>  <relative path>\n`
 * line per regular file, links followed, paths sorted bytewise (LC_ALL=C sort). Null when absent.
 */
function treeDigest(dir) {
  const files = [];
  const walk = (rel) => {
    for (const n of fs.readdirSync(path.join(dir, rel))) {
      const r = rel ? `${rel}/${n}` : n;
      const st = fs.statSync(path.join(dir, r)); // stat, not lstat: links are followed, as cp -RL does
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) files.push(r);
    }
  };
  try { if (!fs.statSync(dir).isDirectory()) return null; walk(''); } catch (_) { return null; }
  files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  return sha(files.map((f) => `${sha(fs.readFileSync(path.join(dir, f)))}  ${f}\n`).join(''));
}

/** Parse a COPY_MANIFEST: its stamp version, engine, and `{ <skill>: <digest> }`. Null when absent. */
function readCopyManifest(dir) {
  let text;
  try { text = fs.readFileSync(path.join(dir, COPY_MANIFEST), 'utf8'); } catch (_) { return null; }
  const out = { version: null, engine: null, skills: {} };
  for (const l of text.split(/\r?\n/)) {
    let m;
    if ((m = /^#\s*colab-handbook:\s*skills\s*@\s*(\S+)/.exec(l))) out.version = m[1];
    else if ((m = /^#\s*engine:\s*(\S+)/.exec(l))) out.engine = m[1];
    else if ((m = /^([0-9a-f]{64})  (.+)$/.exec(l))) out.skills[m[2]] = m[1];
  }
  return out;
}

module.exports = { parseConf, expandHome, listEngines, rememberedDirs, rememberedCopies, COPY_MANIFEST, treeDigest, readCopyManifest };
