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

module.exports = { exposure, findings, workflowPublishes, manifests };
