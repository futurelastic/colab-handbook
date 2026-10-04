'use strict';
/**
 * A declared distributed tool has an install route §6 recognises (#469).
 *
 * CONVENTIONS.md §6, *Distribution*: every distributed tool installs with `npx`, by one of four
 * rows (public/private × JS/compiled). What the audit cannot measure is whether a repository
 * ships a tool at all — a root `bin`, a build matrix or a release workflow is just as true of a
 * library or an app nobody installs. So the signal is DECLARED, never inferred: a repository
 * says `distribution: js | compiled` in `.github/project.yml`, and only then is its row's route
 * checked. Undeclared → no finding and no IO, by construction (the admission test: markers
 * identify our text, not a stack).
 *
 * Pure: takes a reader plus the repository's visibility (read from the GitHub API at the
 * caller, never guessed) and returns findings.
 *
 *   VALID_DISTRIBUTION                -> Set of the declared values
 *   rootBin(readFile)                 -> true when the root package.json has a non-empty bin
 *   distRefsCallers(workflows, read)  -> [{ wf, line, target }] in-repo routes to dist refs
 *   evidence(reader)                  -> per-row route evidence (what is present, what is missing)
 *   findings({ distribution, … })     -> [{ level, text }]
 */

const npmGuard = require('./npm-publish-guard.js');

const VALID_DISTRIBUTION = new Set(['js', 'compiled']);

// The one string the dist-refs template writes that no other workflow has a reason to: the ref
// namespace its orphan commits are pushed to. Content, not file name — a renamed copy counts.
const DIST_REF = /refs\/tags\/dist\//;
const LOCAL_USES = /^\s*-?\s*uses:\s*['"]?\.\/\.github\/workflows\/([\w.-]+\.ya?ml)['"]?\s*$/;

function stripComment(line) {
  return line.replace(/(^|\s)#.*$/, '');
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (_) { return undefined; }
}

function hasBin(pkg) {
  if (!pkg || typeof pkg !== 'object') return false;
  const b = pkg.bin;
  if (typeof b === 'string') return b.trim() !== '';
  return !!b && typeof b === 'object' && Object.keys(b).length > 0;
}

function rootBin(readFile) {
  const text = readFile('package.json');
  return text != null && hasBin(parseJson(text));
}

function codeLines(text) {
  return String(text || '').split('\n').map(stripComment);
}

function mentionsDistRef(text) {
  return codeLines(text).some((l) => DIST_REF.test(l));
}

function isReusable(text) {
  return codeLines(text).some((l) => /^\s*workflow_call\s*:/.test(l) || /\bworkflow_call\b/.test(l) && /^\s*on\s*:/.test(l));
}

/**
 * In-repo routes to dist refs: a workflow line `uses: ./.github/workflows/<f>` whose target
 * pushes to refs/tags/dist/, or a non-reusable workflow that does so itself (inlined).
 * A dist-refs copy that nothing calls is not a route.
 */
function distRefsCallers(workflows, readFile) {
  const out = [];
  for (const wf of workflows || []) {
    const text = readFile(`.github/workflows/${wf}`);
    if (!text) continue;
    codeLines(text).forEach((line, i) => {
      const m = line.match(LOCAL_USES);
      if (!m) return;
      if (mentionsDistRef(readFile(`.github/workflows/${m[1]}`))) out.push({ wf, line: i + 1, target: m[1] });
    });
    if (!isReusable(text) && mentionsDistRef(text)) out.push({ wf, line: null, target: wf });
  }
  return out;
}

/** What each §6 row's route needs, and whether this repository has it. */
function evidence({ readFile, listDir, workflows }) {
  const publishes = npmGuard.workflowPublishes(workflows, readFile).length > 0;
  const ms = npmGuard.manifests(readFile, listDir).filter((m) => !m.unparsed && m.pkg && typeof m.pkg === 'object');
  const publicBin = ms.some((m) => m.pkg.private !== true && hasBin(m.pkg));
  const publicBinOptDeps = ms.some((m) => m.pkg.private !== true && hasBin(m.pkg)
    && m.pkg.optionalDependencies && typeof m.pkg.optionalDependencies === 'object'
    && Object.keys(m.pkg.optionalDependencies).length > 0);
  const bin = rootBin(readFile);
  const callers = distRefsCallers(workflows, readFile);
  const missing = {
    'js/public': [
      ...(publishes ? [] : ['no workflow step publishes to npm']),
      ...(publicBin ? [] : ['no non-private package.json has a bin']),
    ],
    'js/private': bin ? [] : ['root package.json has no bin (the npx github: entry point)'],
    'compiled/public': [
      ...(publishes ? [] : ['no workflow step publishes to npm']),
      ...(publicBinOptDeps ? [] : ['no non-private package.json has a bin and per-platform optionalDependencies']),
    ],
    'compiled/private': [
      ...(bin ? [] : ['root package.json has no bin (the launcher, templates/npx-launcher.mjs)']),
      ...(callers.length ? [] : ['no workflow calls a dist-refs workflow (uses: ./.github/workflows/dist-refs.yml, templates/dist-refs.yml)']),
    ],
  };
  return { missing };
}

const RULE = 'every distributed tool installs with npx — public: an npm package; private: `npx github:<org>/<repo>#vX.Y.Z`, compiled binaries as dist refs (CONVENTIONS.md §6, Distribution, #469). A publish in a workflow outside this repository is not visible here';

/**
 * @param distribution the raw declared value (undefined/null → not declared → [])
 * @param visibility 'public' | 'private' | 'internal' | null (unknown)
 * An invalid value is the caller's enum check, not reported here.
 */
function findings({ distribution, readFile, listDir, workflows, visibility }) {
  if (distribution == null || !VALID_DISTRIBUTION.has(distribution)) return [];
  const { missing } = evidence({ readFile, listDir, workflows });
  const pub = missing[`${distribution}/public`];
  const priv = missing[`${distribution}/private`];
  if (visibility === 'public') {
    if (!pub.length) return [];
    return [{ level: 'warn', text: `distribution: ${distribution}, but no install route §6 recognises — public repository: ${pub.join('; ')} — ${RULE}` }];
  }
  if (visibility === 'private' || visibility === 'internal') {
    if (!priv.length) return [];
    return [{ level: 'warn', text: `distribution: ${distribution}, but no install route §6 recognises — ${visibility} repository: ${priv.join('; ')} — ${RULE}` }];
  }
  if (!pub.length || !priv.length) return [];
  return [{
    level: 'warn',
    text: `distribution: ${distribution}, but no install route §6 recognises — repository visibility could not be read, and neither row's route was found (public: ${pub.join('; ')}; private: ${priv.join('; ')}) — ${RULE}`,
  }];
}

module.exports = { VALID_DISTRIBUTION, rootBin, distRefsCallers, evidence, findings };
