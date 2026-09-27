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
 * THE PYTHON DEPENDENCY MANIFESTS ARE PART OF THE INSTRUMENT TOO (#377) — condition 6. The Python
 * template's "Detect optional tooling" step does not ask a manifest a question the way the Node one
 * does; it asks the INSTALLED ENVIRONMENT (`python -m pytest --version`), and runs ruff/mypy/pytest
 * only when that succeeds. What is installed is decided by exactly the files the template reads:
 * `pip install -e .` from `pyproject.toml` (whose build backend reads `setup.py`/`setup.cfg`), else
 * `pip install -r requirements.txt`, then `pip install -r requirements-dev.txt`. Drop `pytest` from
 * any of them and the Test step skips while the job concludes `success`. So the signal is WHOLE-FILE,
 * not a block: in Python the dependency list IS the switch, and the switch is transitive (pytest can
 * arrive through `pytest-cov`), which no block-level parse could measure. Which files count:
 *
 *   - basename `pyproject.toml`, `setup.py`, `setup.cfg` — what `pip install -e .` reads;
 *   - a `.txt`/`.in` whose basename contains `requirements`, or that sits under a `requirements/`
 *     directory — the template's two names and the conventional layouts around them;
 *   - any file one of those pulls in: a requirements file's `-r`/`-c` include, or a
 *     `[tool.setuptools.dynamic]` `file =` in a pyproject — resolved against BOTH sides' trees, so
 *     editing `deps/test.txt` counts when an unchanged `requirements-dev.txt` includes it.
 *
 * Any depth, for the same reason as `package.json`. A content change of any kind counts — a
 * version pin included, which is the accepted false refusal: a "pin the broken upstream" cure falls
 * through to the human ci-grant. Narrowing to "a requirement NAME disappeared" is deliberately
 * unmade: a version change can drop a transitive tool, and that is unmeasurable here. Lockfiles
 * (`poetry.lock`, `uv.lock`, `Pipfile.lock`) are NOT read by the template and do not count; an
 * adopter whose CI installs from one has edited the template and owns extending this list.
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

const PY_BASENAMES = new Set(['pyproject.toml', 'setup.py', 'setup.cfg']);

/** A Python dependency manifest by NAME alone (#377) — include-referenced files are added by
 *  `pythonIncludedPaths`, which needs the trees. */
function isPythonManifest(p) {
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (PY_BASENAMES.has(base)) return true;
  if (!/\.(txt|in)$/i.test(base)) return false;
  return /requirements/i.test(base) || /(^|\/)requirements\//i.test(p);
}

/** Normalise `a/./b/../c` to `a/c`; null when it climbs out of the repo root. */
function joinRel(dir, rel) {
  const out = [];
  for (const seg of `${dir ? `${dir}/` : ''}${rel}`.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join('/');
}

/**
 * PURE. The repo-relative paths one Python manifest pulls in. A requirements file: every
 * `-r`/`--requirement`/`-c`/`--constraint` target (pip resolves it against the including file's
 * directory). A `pyproject.toml`: every string in a `file =` under `[tool.setuptools.dynamic]`.
 * URLs and paths escaping the repo are skipped — nothing in this repo can change them.
 */
function pythonIncludes(filePath, text) {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  const found = [];
  const add = (rel) => {
    const r = String(rel).trim();
    if (!r || /^[a-z][a-z0-9+.-]*:\/\//i.test(r)) return;
    const j = joinRel(dir, r);
    if (j) found.push(j);
  };
  const lines = String(text).replace(/\\\r?\n/g, ' ').split(/\r?\n/);
  if (base === 'pyproject.toml') {
    let inDynamic = false;
    for (const line of lines) {
      const sec = /^\s*\[([^\]]+)\]\s*(#.*)?$/.exec(line);
      if (sec) { inDynamic = sec[1].trim() === 'tool.setuptools.dynamic'; continue; }
      if (!inDynamic) continue;
      const m = /\bfile\s*=\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/.exec(line);
      if (m) for (const q of m[1].match(/"[^"]*"|'[^']*'/g) || []) add(q.slice(1, -1));
    }
    return found;
  }
  if (!/\.(txt|in)$/i.test(base)) return found;
  for (const raw of lines) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    const m = /^(?:-r|-c|--requirement|--constraint)(?:\s*=\s*|\s+|(?=[^\s-]))(\S+)/.exec(line);
    if (m) add(m[1]);
  }
  return found;
}

/**
 * The include closure of one tree, as a Set of paths — or null when the tree or a manifest blob in
 * it could not be read. Starts from every name-matched manifest in the tree and follows includes
 * to a fixpoint (an include of an include counts).
 */
function pythonIncludedPaths(git, repo, rev) {
  const ls = git.git(['ls-tree', '-r', '-z', '--full-tree', rev], repo);
  if (!ls.ok) return null;
  const blobs = new Map();
  for (const rec of String(ls.stdout).split('\0')) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/s.exec(rec);
    if (m && m[2] === 'blob') blobs.set(m[4], m[3]);
  }
  const included = new Set();
  const queue = [...blobs.keys()].filter(isPythonManifest);
  const seen = new Set(queue);
  while (queue.length) {
    const p = queue.shift();
    const r = git.git(['cat-file', 'blob', blobs.get(p)], repo);
    if (!r.ok) return null;
    for (const inc of pythonIncludes(p, r.stdout)) {
      included.add(inc);
      if (!seen.has(inc) && blobs.has(inc)) { seen.add(inc); queue.push(inc); }
    }
  }
  return included;
}

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
 * manifestPaths, pythonManifestTouched, pythonManifestPaths }` (the last two: condition 6, #377): `ok:false` with both flags `null` when the diff itself could not be read;
 * `manifestScriptsTouched` `true`/`false`/`null` (unmeasurable), with `manifestPaths` listing every
 * manifest whose scripts changed. Never throws.
 */
function cureDiffSignals(git, repo, trunk, branch) {
  const raw = git.git(['diff', '-z', '--no-renames', '--raw', '--no-abbrev', `${trunk}...${branch}`], repo);
  if (!raw.ok) {
    return { ok: false, reason: `git diff ${trunk}...${branch} failed: ${(raw.stderr || '').split('\n')[0] || raw.code}`,
      workflowsTouched: null, manifestScriptsTouched: null, manifestPaths: [],
      pythonManifestTouched: null, pythonManifestPaths: [] };
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

  const py = pythonSignal(git, repo, trunk, branch, entries);
  const reasons = [];
  if (unmeasured.length && !touched.length) reasons.push(`could not read the scripts of: ${unmeasured.join(', ')}`);
  if (py.touched === null) reasons.push(py.reason);
  return {
    ok: true,
    reason: reasons.join('; '),
    workflowsTouched, manifestScriptsTouched, manifestPaths: touched,
    pythonManifestTouched: py.touched, pythonManifestPaths: py.paths,
  };
}

/**
 * Condition 6's signal (#377): which Python dependency manifests the diff changes. A changed entry
 * counts when its path is a manifest by name, or is included by one on EITHER side (the base side
 * sees an include the branch deleted along with its target). Content-identical mode-only changes do
 * not count; a manifest that is a symlink or a submodule counts as touched — pip follows the link,
 * and the gate cannot vouch for what it points at, so there is nothing to call unmeasured about it.
 * The include closure is read only when some changed path is not already a manifest by name, so
 * a diff touching nothing else pays no tree reads. Returns `{touched: true|false|null, paths, reason}`.
 */
function pythonSignal(git, repo, trunk, branch, entries) {
  const changed = entries.filter((e) => !(e.oldSha && e.oldSha === e.newSha));
  const paths = changed.filter((e) => isPythonManifest(e.path)).map((e) => e.path);
  const rest = changed.filter((e) => !isPythonManifest(e.path));
  if (rest.length) {
    const mb = git.git(['merge-base', trunk, branch], repo);
    const base = mb.ok ? pythonIncludedPaths(git, repo, mb.stdout.trim()) : null;
    const head = base ? pythonIncludedPaths(git, repo, branch) : null;
    if (!base || !head) {
      return paths.length
        ? { touched: true, paths, reason: '' }
        : { touched: null, paths: [], reason: 'could not read the Python manifests\' includes (-r/-c, setuptools dynamic file)' };
    }
    for (const e of rest) if (base.has(e.path) || head.has(e.path)) paths.push(e.path);
  }
  return { touched: paths.length > 0, paths, reason: '' };
}

module.exports = { cureDiffSignals, scriptsBlockDiffers, isPythonManifest, pythonIncludes, ABSENT };
