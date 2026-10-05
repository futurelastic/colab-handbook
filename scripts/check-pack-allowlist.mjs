#!/usr/bin/env node
// Privacy gate for the npm tarball (#431): `npm pack --dry-run --json`, every file compared
// against an allowlist, any file outside it fails.
//
// WHY. The repo is public, so the risk is not a secret in tracked code (gitleaks covers that) —
// it is a stray LOCAL file (a scratch note, an .env, a half-written template) that a `files`
// glob happens to sweep into a published tarball. A glob like `templates/` allows whatever is
// in that directory on the machine that packs, so the allowlist here is checked twice:
//   1. the path matches a shape we meant to ship, and
//   2. the path is TRACKED by git — an untracked file under an allowed directory fails.
// That is what makes "never ship what we did not mean to" mechanical instead of a review habit.
//
// package.json has no `version` (the tag is the version, #424), and `npm pack` refuses a package
// without one — so the check packs with a throwaway version stamped in and restores the file.
//
// Usage: node scripts/check-pack-allowlist.mjs     (exit 0 = clean, 1 = stray file, 2 = could not measure)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What a tarball of this package may contain. Everything else is a finding. */
export const ALLOWED = [
  /^package\.json$/,
  /^README(\.vi)?\.md$/,
  /^LICENSE$/,
  /^tools\/colab$/,
  /^tools\/lib\/[A-Za-z0-9._-]+\.js$/,
  // The tracker contract scenarios (#501): the language-neutral spec every adapter runs. Named
  // exactly — the GitHub transcripts beside it (tracker-scenarios.github.json) are test-only.
  /^tools\/lib\/tracker-scenarios\.json$/,
  // The tracker codec (#497): its modules, their types, and the golden samples that specify it.
  /^tools\/lib\/codec\/[A-Za-z0-9._-]+\.(js|d\.ts)$/,
  /^tools\/lib\/codec\/samples\.json$/,
  /^templates\/[A-Za-z0-9._-]+$/,
  /^audit\/audit\.mjs$/,
];
const TEST_FILE = /\.test\.js$/;

/** Pure: given the packed paths and the tracked set, return [{ path, why }]. */
export function findStrays(packed, tracked) {
  const out = [];
  for (const p of packed) {
    if (TEST_FILE.test(p)) out.push({ path: p, why: 'test file' });
    else if (!ALLOWED.some((re) => re.test(p))) out.push({ path: p, why: 'not on the allowlist' });
    else if (!tracked.has(p) && p !== 'package.json') out.push({ path: p, why: 'not tracked by git' });
  }
  return out;
}

function main() {
  const manifestPath = resolve(root, 'package.json');
  const original = readFileSync(manifestPath, 'utf8');
  let packed;
  try {
    const m = JSON.parse(original);
    if (!m.version) writeFileSync(manifestPath, JSON.stringify({ ...m, version: '0.0.0-pack-check' }, null, 2) + '\n');
    const json = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    packed = JSON.parse(json)[0].files.map((f) => f.path);
  } catch (e) {
    console.error(`pack-allowlist: could not run npm pack (${e.message.split('\n')[0]})`);
    return 2;
  } finally {
    writeFileSync(manifestPath, original);
  }
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean));
  const strays = findStrays(packed, tracked);
  if (strays.length) {
    console.error(`pack-allowlist: ${strays.length} file(s) in the tarball that were not meant to ship:`);
    for (const s of strays) console.error(`  ${s.path}  (${s.why})`);
    return 1;
  }
  console.log(`pack-allowlist: ok — ${packed.length} files, all on the allowlist and tracked`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
