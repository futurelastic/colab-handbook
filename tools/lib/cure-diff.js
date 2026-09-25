'use strict';
/**
 * The cure rule's DIFF signals (#297) — what the branch's diff against trunk touches of "the
 * instrument grading it": the CI workflow files (condition 4) and any `package.json`'s `scripts`
 * block (condition 5). The verdict itself stays in the PURE tools/lib/ci-cure.js; this module is the
 * git read behind it, injected the same way tools/lib/docs-only.js takes its `git`, so the subtle
 * parts (renames, deleted manifests, unparseable JSON) are tested against real repositories rather
 * than left as tools/colab's untestable residue.
 *
 * WHY `package.json` IS PART OF THE INSTRUMENT. The Node CI template does not hardcode what it
 * measures: its "Detect optional scripts" step asks `package.json` whether `typecheck`/`lint`/`test`
 * exist and SKIPS each step whose script is absent — and the job still concludes `success`. So a
 * branch that deletes `scripts.test` stops the failing suite from running at all without touching
 * `.github/workflows/**`, and condition 4 alone would call it a cure.
 *
 * ANY `package.json`, AT ANY DEPTH — not just the root. The template's
 * `defaults.run.working-directory` is an adopter-edited point, workspace runners read nested
 * `scripts`, and parsing an adopter's own YAML to find the one manifest that matters would be
 * brittle in the fail-open direction. The cost is a false refusal on an unrelated nested manifest's
 * scripts change during a red trunk, which falls through to the human ci-grant: the safe direction.
 *
 * `--no-renames`, deliberately. With rename detection on (git's default for `diff`), a rename lists
 * only its NEW path, so moving `.github/workflows/ci.yml` to `ci.yml.off` — or `package.json` to
 * `package.json.bak` — used to read as touching neither. Without it a rename is a delete plus an add,
 * and the deleted side is seen.
 *
 * FAIL CLOSED. Every unmeasurable input is `null`, never `false`: a failed diff read, a manifest
 * blob that could not be read, a manifest that does not parse, a manifest that is a symlink or a
 * submodule. ci-cure.js's `cureVerdict` refuses on `null`.
 */

const { parseRaw } = require('./docs-only');

/** Stands for "no such file on this side of the diff" (an all-zero sha in `--raw`). */
const ABSENT = Symbol('absent');

const ZERO_SHA = /^0+$/;
/** Modes a manifest may carry and still be read as a plain file. `000000` = absent on that side. */
const FILE_MODES = new Set(['100644', '100755', '000000']);

function isManifest(p) {
  return p === 'package.json' || p.endsWith('/package.json');
}

/** Key-order-independent JSON, so reordering `scripts` keys is not a change but editing a command is. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** The `scripts` value as the Node template reads it (`scripts || {}`), canonicalised — or null when
 *  the text is not a JSON object. */
function scriptsOf(text) {
  let obj;
  try { obj = JSON.parse(String(text).replace(/^﻿/, '')); } catch (_) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  return canonical(obj.scripts || {});
}

/**
 * PURE. Whether the `scripts` block differs between two versions of one `package.json`. Each side is
 * its text, or `ABSENT` when the file does not exist on that side. Returns `true`/`false`, or `null`
 * when either present side does not parse as a JSON object.
 *
 * A file that exists on only one side DIFFERS, whatever it holds: deleting the root manifest flips
 * the template's `hashFiles('package.json') != ''` guard and skips every Node step, build included.
 */
function scriptsBlockDiffers(baseText, headText) {
  if (baseText === ABSENT && headText === ABSENT) return false;
  if (baseText === ABSENT || headText === ABSENT) return true;
  const a = scriptsOf(baseText);
  const b = scriptsOf(headText);
  if (a === null || b === null) return null;
  return a !== b;
}

/** One side's text for a raw-diff entry: `ABSENT`, the blob text, or null on a failed read. */
function sideText(git, repo, sha) {
  if (!sha || ZERO_SHA.test(sha)) return ABSENT;
  const r = git.git(['cat-file', 'blob', sha], repo);
  return r.ok ? r.stdout : null;
}

/**
 * The diff signals for one branch against trunk, over the merge-base range (`trunk...branch` — the
 * same tree a squash lands). Returns `{ ok, reason, workflowsTouched, manifestScriptsTouched,
 * manifestPaths }`: `ok:false` with both flags `null` when the diff itself could not be read;
 * `manifestScriptsTouched` `true`/`false`/`null` (unmeasurable), with `manifestPaths` listing every
 * manifest whose scripts changed. Never throws.
 */
function cureDiffSignals(git, repo, trunk, branch) {
  const raw = git.git(['diff', '-z', '--no-renames', '--raw', '--no-abbrev', `${trunk}...${branch}`], repo);
  if (!raw.ok) {
    return { ok: false, reason: `git diff ${trunk}...${branch} failed: ${(raw.stderr || '').split('\n')[0] || raw.code}`,
      workflowsTouched: null, manifestScriptsTouched: null, manifestPaths: [] };
  }
  const entries = parseRaw(raw.stdout);
  const workflowsTouched = entries.some((e) => e.path.startsWith('.github/workflows/'));

  const touched = [];
  const unmeasured = [];
  for (const e of entries) {
    if (!isManifest(e.path)) continue;
    if (!FILE_MODES.has(e.oldMode) || !FILE_MODES.has(e.newMode)) { unmeasured.push(e.path); continue; }
    if (e.oldSha && e.oldSha === e.newSha) continue; // mode-only change: same content
    const differs = scriptsBlockDiffers(sideText(git, repo, e.oldSha), sideText(git, repo, e.newSha));
    if (differs === true) touched.push(e.path);
    else if (differs === null) unmeasured.push(e.path);
  }
  let manifestScriptsTouched = false;
  if (touched.length) manifestScriptsTouched = true;
  else if (unmeasured.length) manifestScriptsTouched = null;
  return {
    ok: true,
    reason: unmeasured.length && !touched.length ? `could not read the scripts of: ${unmeasured.join(', ')}` : '',
    workflowsTouched, manifestScriptsTouched, manifestPaths: touched,
  };
}

module.exports = { cureDiffSignals, scriptsBlockDiffers, ABSENT };
