'use strict';
/**
 * The private-repo / public-npm rule (#432, part of #420).
 *
 * Owner ruling 2026-10-02: `@<org>` on public npm is always public, so a PRIVATE repository
 * never publishes to public npm. Private apps are installed from git
 * (`npx github:<org>/<repo>#<tag>`), where repository access is the access control.
 *
 * This module is pure: it takes a reader and the repository's visibility and returns findings.
 * Visibility comes from the GitHub API at the caller (never a local guess).
 *
 *   exposure(...)  -> { problems: string[] }   every way this repo could reach public npm
 *   findings(...)  -> [{ level, text }]        what the audit reports given visibility
 *
 * Two kinds of problem, both only a finding when the repo is private:
 *   1. a package.json (root or workspace member) without `"private": true`, or whose
 *      `publishConfig.registry` is the public registry;
 *   2. a workflow step that publishes to registry.npmjs.org.
 */

const PUBLIC_REGISTRY = /registry\.(npmjs\.org|yarnpkg\.com)/i;

// `npm publish`, `pnpm publish`, `yarn publish`, `yarn npm publish`, `bun publish`.
const PUBLISH_CMD = /(^|[\s;&|(])(npm|pnpm|bun|yarn(\s+npm)?)\s+publish\b/;
const PUBLISH_ACTION = /\buses:\s*['"]?[\w.-]*\/?[\w.-]*npm-publish\b/i;

function stripComment(line) {
  return line.replace(/(^|\s)#.*$/, '');
}

/** Workflow lines that publish to the public registry. Returns [{ wf, line, text }]. */
function workflowPublishes(workflows, readFile) {
  const out = [];
  for (const wf of workflows || []) {
    const text = readFile(`.github/workflows/${wf}`);
    if (!text) continue;
    text.split('\n').forEach((raw, i) => {
      const line = stripComment(raw);
      const isCmd = PUBLISH_CMD.test(line);
      const isAction = PUBLISH_ACTION.test(line);
      if (!isCmd && !isAction) return;
      if (isCmd) {
        if (/--dry-run\b/.test(line)) return; // cannot publish
        const reg = line.match(/--registry[=\s]+(\S+)/);
        if (reg && !PUBLIC_REGISTRY.test(reg[1])) return; // pointed elsewhere
      }
      out.push({ wf, line: i + 1, text: line.trim() });
    });
  }
  return out;
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return undefined; }
}

function expandPattern(pat, listDir, readFile) {
  const p = String(pat).replace(/^\.\//, '').replace(/\/+$/, '');
  if (!p || p.startsWith('!')) return [];
  if (p.endsWith('/*') || p.endsWith('/**')) {
    const base = p.replace(/\/\*+$/, '');
    return listDir(base)
      .map((d) => `${base}/${d}`)
      .filter((d) => readFile(`${d}/package.json`) != null);
  }
  return readFile(`${p}/package.json`) != null ? [p] : [];
}

function workspacePatterns(rootPkg, readFile) {
  const out = [];
  const ws = rootPkg && rootPkg.workspaces;
  if (Array.isArray(ws)) out.push(...ws);
  else if (ws && Array.isArray(ws.packages)) out.push(...ws.packages);
  const pnpm = readFile('pnpm-workspace.yaml');
  if (pnpm) {
    for (const m of pnpm.matchAll(/^\s*-\s*['"]?([^'"#\n]+?)['"]?\s*(#.*)?$/gm)) out.push(m[1]);
  }
  return out;
}

/** Every package.json that could be published: root plus workspace members. */
function manifests(readFile, listDir) {
  const out = [];
  const rootText = readFile('package.json');
  if (rootText == null) return out;
  const root = parseJson(rootText);
  out.push({ path: 'package.json', pkg: root, unparsed: root === undefined });
  const seen = new Set(['package.json']);
  for (const pat of workspacePatterns(root, readFile)) {
    for (const dir of expandPattern(pat, listDir, readFile)) {
      const p = `${dir}/package.json`;
      if (seen.has(p)) continue;
      seen.add(p);
      const pkg = parseJson(readFile(p));
      out.push({ path: p, pkg, unparsed: pkg === undefined });
    }
  }
  return out;
}

/** Everything in this repo that could reach public npm. */
function exposure({ readFile, listDir, workflows }) {
  const problems = [];
  for (const m of manifests(readFile, listDir)) {
    if (m.unparsed || !m.pkg || typeof m.pkg !== 'object') continue; // the toolchain check reports unparsable JSON
    if (m.pkg.private !== true) {
      problems.push(`${m.path} lacks "private": true`);
    }
    const reg = m.pkg.publishConfig && m.pkg.publishConfig.registry;
    if (typeof reg === 'string' && PUBLIC_REGISTRY.test(reg)) {
      problems.push(`${m.path} publishConfig.registry points at ${reg}`);
    }
  }
  for (const p of workflowPublishes(workflows, readFile)) {
    problems.push(`.github/workflows/${p.wf}:${p.line} publishes to public npm (\`${p.text}\`)`);
  }
  return { problems };
}

const RULE = 'a private repository never publishes to public npm — install private apps from git (`npx github:<org>/<repo>#<tag>`) and set "private": true (CONVENTIONS.md, owner ruling 2026-10-02)';

/**
 * @param visibility 'public' | 'private' | 'internal' | null (unknown)
 * Public repos pass. Unknown visibility is reported (warn), never passed — but only when there is
 * something it would matter for, so a repo with no npm surface stays silent.
 */
function findings({ readFile, listDir, workflows, visibility }) {
  if (visibility === 'public') return [];
  const { problems } = exposure({ readFile, listDir, workflows });
  if (!problems.length) return [];
  if (visibility === 'private' || visibility === 'internal') {
    return problems.map((t) => ({ level: 'fail', text: `${t} — ${RULE}` }));
  }
  return [{
    level: 'warn',
    text: `repository visibility could not be read, so the private-repo npm rule could not be checked (${problems.length} candidate finding(s): ${problems.join('; ')}) — ${RULE}`,
  }];
}

// ---- #442: GitHub Release assets are not an install path ------------------------------------
//
// CONVENTIONS.md §6, *Distribution*: every distributed tool installs with `npx`. A private compiled
// tool ships its binaries as dist refs in its own repo (templates/dist-refs.yml) and installs with
// `npx github:<org>/<repo>#vX.Y.Z`; a private repo uploading binaries as Release assets is asking
// every user for the `gh` CLI (or a token) to install it. Advisory: a Release asset can be a
// legitimate by-product (an SBOM, a changelog), so this warns and never fails.

// Actions that upload Release assets unconditionally, and those that do only with a files key.
const ASSET_ACTION_ALWAYS = /\buses:\s*['"]?(actions\/upload-release-asset|svenstaro\/upload-release-action)\b/i;
const ASSET_ACTION_KEYED = [
  { re: /\buses:\s*['"]?softprops\/action-gh-release\b/i, key: /^\s*files:\s*\S/ },
  { re: /\buses:\s*['"]?ncipollo\/release-action\b/i, key: /^\s*artifacts:\s*\S/ },
];
// `gh release create <tag> [<file>…]` flags that take a value — their value is not a file.
const GH_VALUE_FLAGS = new Set(['-n', '--notes', '-F', '--notes-file', '-t', '--title', '--target',
  '--discussion-category', '--notes-start-tag', '-R', '--repo', '--fail-on-no-commits']);

function shellTokens(line) {
  return (line.match(/"(?:[^"\\]|\\.)*"|'[^']*'|\S+/g) || []);
}

// A positional argument that is a file: a path, a glob, or a name with an extension. A bare
// expansion like "${KIND[@]}" (an array of flags, in the handbook's own release templates) is not.
function looksLikeAsset(tok) {
  const t = tok.replace(/^["']|["']$/g, '');
  if (/^\$\{?\w+(\[@\])?\}?$/.test(t)) return false;
  return /[/*]/.test(t) || /\.[A-Za-z0-9]{1,8}(#.*)?$/.test(t);
}

// `files: ${{ env.ATTACH_ARTIFACTS == 'true' && '…' || '' }}` with `ATTACH_ARTIFACTS: "false"`
// declared in the same file — templates/release-tag.yml's opt-in, as shipped — uploads nothing.
// Flipping the switch to "true" makes it an upload again, and that is reported.
function switchedOff(line, text) {
  const m = line.match(/env\.(\w+)\s*==\s*'true'/);
  return !!m && new RegExp(`^\\s*${m[1]}:\\s*["']?false["']?\\s*(#.*)?$`, 'm').test(text);
}

/** `gh release create` lines that pass files, after the tag. */
function ghCreateUploads(line) {
  const toks = shellTokens(line);
  const at = toks.findIndex((t, i) => t === 'create' && toks[i - 1] === 'release' && toks[i - 2] === 'gh');
  if (at === -1) return false;
  const pos = [];
  for (let i = at + 1; i < toks.length; i++) {
    const t = toks[i];
    if (/^[;&|]/.test(t)) break;
    if (t.startsWith('-')) { if (GH_VALUE_FLAGS.has(t)) i++; continue; }
    pos.push(t);
  }
  return pos.slice(1).some(looksLikeAsset);
}

/** Workflow lines that upload GitHub Release assets. Returns [{ wf, line, text }]. */
function releaseAssetUploads(workflows, readFile) {
  const out = [];
  for (const wf of workflows || []) {
    const text = readFile(`.github/workflows/${wf}`);
    if (!text) continue;
    const lines = text.split('\n');
    lines.forEach((raw, i) => {
      const line = stripComment(raw);
      let hit = /(^|[\s;&|(])gh\s+release\s+upload\b/.test(line) || ghCreateUploads(line) || ASSET_ACTION_ALWAYS.test(line);
      if (!hit) {
        const keyed = ASSET_ACTION_KEYED.find((k) => k.re.test(line));
        if (keyed) {
          // The step's own lines: until the next list item at this indent or shallower.
          const indent = raw.search(/\S/);
          const stepIndent = /^\s*-\s/.test(raw) ? indent : indent - 2;
          for (let j = i + 1; j < lines.length; j++) {
            const l = lines[j];
            if (!l.trim()) continue;
            const ind = l.search(/\S/);
            if (ind <= stepIndent) break;
            if (keyed.key.test(stripComment(l))) { hit = !switchedOff(l, text); break; }
          }
        }
      }
      if (hit) out.push({ wf, line: i + 1, text: line.trim() });
    });
  }
  return out;
}

const ASSET_RULE = 'GitHub Release assets are not an install path — a private compiled tool pushes its binaries as dist refs (templates/dist-refs.yml) and installs with `npx github:<org>/<repo>#vX.Y.Z` (CONVENTIONS.md §6, Distribution, #442)';

/**
 * Advisory only. Private/internal → one warn per upload site; public → nothing (a public compiled
 * tool's install path is npm platform packages, and the npm job's own rules cover it); unknown
 * visibility → one warn saying the rule could not be checked.
 */
function assetFindings({ readFile, workflows, visibility }) {
  if (visibility === 'public') return [];
  const uploads = releaseAssetUploads(workflows, readFile);
  if (!uploads.length) return [];
  const sites = uploads.map((u) => `.github/workflows/${u.wf}:${u.line} (\`${u.text}\`)`);
  if (visibility === 'private' || visibility === 'internal') {
    return sites.map((s) => ({ level: 'warn', text: `${s} uploads a GitHub Release asset — ${ASSET_RULE}` }));
  }
  return [{ level: 'warn', text: `repository visibility could not be read, so the Release-asset install rule could not be checked (${sites.join('; ')}) — ${ASSET_RULE}` }];
}

module.exports = { exposure, findings, workflowPublishes, manifests, releaseAssetUploads, assetFindings };
