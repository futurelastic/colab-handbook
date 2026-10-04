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
 * TWO NARROW ADMISSIONS (#475, #476) — the signals above stay whole (any change still sets the flag),
 * and next to each sits a classifier saying whether EVERY touched manifest's change is of one shape
 * the verdict may admit on step evidence (tools/lib/ci-cure.js):
 *
 *   - `manifestScriptsAddOnly` (#475) — every touched `package.json` exists on both sides, keeps every
 *     base script byte-for-byte (canonically), and only ADDS keys. Adding a script makes the Node
 *     template run more, never less. An added npm LIFECYCLE hook is not admitted: `postinstall`,
 *     `prepare`, or `pre<x>`/`post<x>` for a script `<x>` run inside a step that already exists and
 *     can rewrite what that step measures (e.g. replace a test binary) without a name changing.
 *   - `pythonPinOnly` (#476) — every touched Python manifest exists on both sides and differs ONLY in
 *     the version specifier (or `--hash`) of requirements present at the same position on both sides:
 *     no requirement added, removed, reordered or renamed, no extras or marker changed, and no option
 *     line (`-r`/`-c`/`-e`/index) changed. Requirements files are read line-wise; a `pyproject.toml`
 *     only inside its dependency arrays (`[project] dependencies`, `[project.optional-dependencies]`,
 *     `[dependency-groups]`, `[build-system] requires`) — every other byte must match. `setup.py` is
 *     code and `setup.cfg` is not read here: a change to either is never pin-only.
 *
 * Each classifier is `null` whenever the shape is not met (or not measurable) — which leaves the
 * condition refusing exactly as before. It is a list of what changed when it IS met.
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

/** The `scripts` object as the Node template reads it, or null when not a JSON object / not an
 *  object-valued `scripts`. */
function scriptsObject(text) {
  let obj;
  try { obj = JSON.parse(String(text).replace(/^﻿/, '')); } catch (_) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const sc = obj.scripts === undefined ? {} : obj.scripts;
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return null;
  return sc;
}

/** npm runs these on its own (install, publish, pack) — never by a template step naming them. */
const NPM_LIFECYCLE = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'prepublish',
  'prepublishOnly', 'prepack', 'postpack', 'dependencies', 'preuninstall', 'uninstall', 'postuninstall']);
/** Scripts npm knows by name, whose `pre`/`post` hooks fire even when the script itself is absent. */
const NPM_BUILTIN = new Set(['install', 'uninstall', 'publish', 'pack', 'test', 'start', 'stop', 'restart',
  'version', 'shrinkwrap']);

/** Whether adding script `key` (to a block whose keys are `keys`) adds a hook npm fires implicitly. */
function isLifecycleKey(key, keys) {
  if (NPM_LIFECYCLE.has(key)) return true;
  const m = /^(pre|post)(.+)$/.exec(key);
  return !!m && (keys.has(m[2]) || NPM_BUILTIN.has(m[2]));
}

/**
 * PURE (#475). Whether a `package.json` scripts change is ADD-ONLY. Returns `{added: [names]}` when
 * both sides are present, every base key is kept with an identical command, at least one key was
 * added, and no added key is an npm lifecycle hook — else null (not admissible, or unmeasurable).
 */
function scriptsAddition(baseText, headText) {
  if (baseText === ABSENT || headText === ABSENT || baseText === null || headText === null) return null;
  const a = scriptsObject(baseText);
  const b = scriptsObject(headText);
  if (!a || !b) return null;
  for (const k of Object.keys(a)) {
    if (!Object.prototype.hasOwnProperty.call(b, k) || canonical(a[k]) !== canonical(b[k])) return null;
  }
  const keys = new Set(Object.keys(b));
  const added = Object.keys(b).filter((k) => !Object.prototype.hasOwnProperty.call(a, k));
  if (!added.length) return null;
  if (added.some((k) => typeof b[k] !== 'string' || isLifecycleKey(k, keys))) return null;
  return { added: added.sort() };
}

const SPEC_RE = /^(?:(?:~=|===|==|!=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+\s*)(?:,\s*(?:~=|===|==|!=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+\s*)*,?$/;

/**
 * PURE. One PEP 508 requirement split into its IDENTITY (normalised name, sorted extras, marker) and
 * its version SPECIFIER — or null when it is not a plain name requirement (a URL `@`, a path, the old
 * parenthesised form). Only the specifier may differ for a change to read as a pin.
 */
function parseRequirement(text) {
  const s = String(text).trim();
  const semi = s.indexOf(';');
  const head = semi === -1 ? s : s.slice(0, semi);
  // Whitespace outside quoted values is insignificant in a marker; inside one it is data.
  const marker = semi === -1 ? '' : s.slice(semi + 1).split(/("[^"]*"|'[^']*')/)
    .map((part, i) => (i % 2 ? part : part.replace(/\s+/g, ''))).join('');
  if (head.includes('@')) return null;
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(?:\[([^\]]*)\])?\s*(.*)$/.exec(head.trim());
  if (!m) return null;
  const spec = m[3].replace(/\s+/g, '');
  if (spec && !SPEC_RE.test(spec)) return null;
  const name = m[1].toLowerCase().replace(/[-_.]+/g, '-');
  const extras = (m[2] || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).sort().join(',');
  return { name, identity: `${name}[${extras}];${marker}`, spec: spec.replace(/,$/, '') };
}

/** A requirements-format file as `{skeleton: [...], reqs: [{name, spec}]}`: comment, blank and
 *  `--hash` stripped; each requirement line reduced to its identity; every other line kept verbatim
 *  (whitespace-collapsed), so an option line or an unparseable requirement must match exactly. */
function requirementsShape(text) {
  const skeleton = [];
  const reqs = [];
  for (const raw of String(text).replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (line.startsWith('-')) { skeleton.push(`opt ${line}`); continue; }
    const bare = line.replace(/\s--hash(?:=|\s+)\S+/g, '').trim();
    const r = parseRequirement(bare);
    if (!r) { skeleton.push(`raw ${line}`); continue; }
    skeleton.push(`req ${r.identity}`);
    reqs.push({ name: r.name, spec: r.spec });
  }
  return { skeleton, reqs };
}

/** Is this `pyproject.toml` array (key `key` in table `table`) a dependency list pip installs from? */
function isDependencyArray(table, key) {
  const k = key.replace(/^["']|["']$/g, '');
  return (table === 'project' && k === 'dependencies')
    || table === 'project.optional-dependencies'
    || table === 'dependency-groups'
    || (table === 'build-system' && k === 'requires');
}

const TOML_STRING = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;

/** A `pyproject.toml` as `{skeleton, reqs}`: every line verbatim, except that inside a dependency array
 *  each requirement string is reduced to its identity. */
function pyprojectShape(text) {
  const skeleton = [];
  const reqs = [];
  let table = '';
  let depth = 0; // bracket depth of the dependency array we are inside; 0 = not in one
  for (const line of String(text).split(/\r?\n/)) {
    const bare = line.replace(TOML_STRING, '""');
    if (!depth) {
      const sec = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/.exec(line);
      if (sec) { table = sec[1].replace(/\s+/g, ''); skeleton.push(line); continue; }
      const kv = /^\s*("[^"]*"|'[^']*'|[A-Za-z0-9_.-]+)\s*=\s*\[/.exec(line);
      if (!kv || !isDependencyArray(table, kv[1])) { skeleton.push(line); continue; }
    }
    depth += (bare.match(/\[/g) || []).length - (bare.match(/\]/g) || []).length;
    if (depth < 0) depth = 0;
    skeleton.push(line.replace(TOML_STRING, (all, dq, sq) => {
      const r = parseRequirement(dq !== undefined ? dq : sq);
      if (!r) return all;
      reqs.push({ name: r.name, spec: r.spec });
      return `<${r.identity}>`;
    }));
  }
  return { skeleton, reqs };
}

/**
 * PURE (#476). Whether a Python manifest change is PIN-ONLY. Returns `{pins: [names]}` — the
 * requirements whose specifier changed — when both sides are present, the shapes match line for
 * line and at least one specifier differs; else null. `setup.py`/`setup.cfg` → always null.
 */
function pythonPinChange(filePath, baseText, headText) {
  if (baseText === ABSENT || headText === ABSENT || baseText === null || headText === null) return null;
  const base = filePath.slice(filePath.lastIndexOf('/') + 1);
  if (base === 'setup.py' || base === 'setup.cfg') return null;
  const shape = base === 'pyproject.toml' ? pyprojectShape : requirementsShape;
  const a = shape(baseText);
  const b = shape(headText);
  if (a.skeleton.length !== b.skeleton.length || a.skeleton.some((l, i) => l !== b.skeleton[i])) return null;
  const pins = [];
  for (let i = 0; i < a.reqs.length; i += 1) if (a.reqs[i].spec !== b.reqs[i].spec) pins.push(b.reqs[i].name);
  return pins.length ? { pins } : null;
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
 * manifestPaths, manifestScriptsAddOnly, pythonManifestTouched, pythonManifestPaths, pythonPinOnly }`
 * (the Python pair: condition 6, #377): `ok:false` with every flag `null` when the diff itself could
 * not be read; `manifestScriptsTouched` `true`/`false`/`null` (unmeasurable), with `manifestPaths`
 * listing every manifest whose scripts changed. `manifestScriptsAddOnly` (#475) and `pythonPinOnly`
 * (#476): `[]` when their condition is untouched, `[{path, added|pins}]` when EVERY touched manifest
 * is of the admissible shape, `null` otherwise. Never throws.
 */
function cureDiffSignals(git, repo, trunk, branch) {
  const raw = git.git(['diff', '-z', '--no-renames', '--raw', '--no-abbrev', `${trunk}...${branch}`], repo);
  if (!raw.ok) {
    return { ok: false, reason: `git diff ${trunk}...${branch} failed: ${(raw.stderr || '').split('\n')[0] || raw.code}`,
      workflowsTouched: null, manifestScriptsTouched: null, manifestPaths: [], manifestScriptsAddOnly: null,
      pythonManifestTouched: null, pythonManifestPaths: [], pythonPinOnly: null };
  }
  const entries = parseRaw(raw.stdout);
  const workflowsTouched = entries.some((e) => e.path.startsWith('.github/workflows/'));

  const touched = [];
  const unmeasured = [];
  let additions = [];
  for (const e of entries) {
    if (!isManifest(e.path)) continue;
    if (!FILE_MODES.has(e.oldMode) || !FILE_MODES.has(e.newMode)) { unmeasured.push(e.path); continue; }
    if (e.oldSha && e.oldSha === e.newSha) continue; // mode-only change: same content
    const before = sideText(git, repo, e.oldSha);
    const after = sideText(git, repo, e.newSha);
    const differs = scriptsBlockDiffers(before, after);
    if (differs === true) {
      touched.push(e.path);
      const add = additions && scriptsAddition(before, after);
      additions = add ? additions.concat([{ path: e.path, added: add.added }]) : null;
    } else if (differs === null) unmeasured.push(e.path);
  }
  let manifestScriptsTouched = false;
  if (touched.length) manifestScriptsTouched = true;
  else if (unmeasured.length) manifestScriptsTouched = null;

  const py = pythonSignal(git, repo, trunk, branch, entries);
  // #476: whether every touched Python manifest changed only a version specifier. Read only when
  // condition 6 actually fires, so an ordinary diff pays nothing for it.
  let pins = py.touched === true ? [] : (py.touched === false ? [] : null);
  if (py.touched === true) {
    const byPath = new Map(entries.map((e) => [e.path, e]));
    for (const p of py.paths) {
      const e = byPath.get(p);
      const pin = e && FILE_MODES.has(e.oldMode) && FILE_MODES.has(e.newMode)
        && pythonPinChange(p, sideText(git, repo, e.oldSha), sideText(git, repo, e.newSha));
      if (!pin) { pins = null; break; }
      pins.push({ path: p, pins: pin.pins });
    }
  }
  const reasons = [];
  if (unmeasured.length && !touched.length) reasons.push(`could not read the scripts of: ${unmeasured.join(', ')}`);
  if (py.touched === null) reasons.push(py.reason);
  return {
    ok: true,
    reason: reasons.join('; '),
    workflowsTouched, manifestScriptsTouched, manifestPaths: touched,
    manifestScriptsAddOnly: manifestScriptsTouched === false ? [] : (manifestScriptsTouched === true ? additions : null),
    pythonManifestTouched: py.touched, pythonManifestPaths: py.paths,
    pythonPinOnly: pins,
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

module.exports = { cureDiffSignals, scriptsBlockDiffers, scriptsAddition, pythonPinChange, parseRequirement,
  isPythonManifest, pythonIncludes, ABSENT };
