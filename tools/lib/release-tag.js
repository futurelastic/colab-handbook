'use strict';
/**
 * "Which tag is the current release?" — answered ONCE, here (#334).
 *
 * Every tag reader in this toolchain used to resolve it with a bare `git describe --tags --abbrev=0`.
 * That returns the nearest tag of ANY shape, so the moment a release candidate (`v1.3.0-rc.1`) is
 * tagged it silently becomes "the release":
 *   - stamp.js `handbookInfo` / `freezeVersion` — every adopter's stamp is compared against the
 *     candidate and new copies get stamped with it; `cmpSemver` reads the `-rc.1` suffix as 0, so the
 *     candidate even compares EQUAL to the final it precedes.
 *   - `colab release-status` — "commits since the last tag" resets at each candidate, hiding the
 *     merged-but-unreleased gap (#81) exactly while a candidate is waiting.
 *   - `colab release-notes` (default range) — the final's notes cover only commits since the last
 *     candidate.
 *   - `colab handbookVersion` — same as stamp.js.
 *
 * A pre-release is any tag with a `-` in it — SemVer §9's pre-release separator, and the same shape
 * templates/release-tag.yml (#333) marks as a GitHub pre-release. `--exclude '*-*'` is git's own
 * describe filter (git >= 2.13), so the ancestry walk is unchanged and only the candidates drop out.
 * The cost is stated rather than hidden: a non-SemVer tag that happens to contain `-` (`release-2024`)
 * is excluded too. Handbook-convention repos tag `vX.Y.Z`, so nothing conforming is lost.
 *
 * A caller that legitimately wants the newest candidate (a release ritual choosing what to finalize)
 * asks for it explicitly with `{ includePrerelease: true }` — never by accident, which is what the
 * bare describe did.
 *
 * CommonJS, zero dependencies: required by tools/colab (CJS) and by stamp.js, which audit/audit.mjs
 * pulls in through createRequire — so the audit inherits the same answer without a copy of its own.
 */

const { execFileSync } = require('child_process');

/** git describe pattern matching every pre-release tag (anything carrying SemVer's `-`). */
const PRERELEASE_TAG_GLOB = '*-*';

/** True when `tag` is a pre-release by the rule above. */
function isPrereleaseTag(tag) {
  return String(tag).includes('-');
}

/**
 * Arguments for `git describe` that honour the rule. `abbrev: 0` gives the bare tag; `abbrev: null`
 * leaves git's default, which is the long form (`v1.2.0-3-gabc1234`) when `ref` is past the tag —
 * the form stamp.js `freezeVersion` stamps with. `ref` defaults to HEAD.
 */
function describeArgs({ ref = null, abbrev = 0, includePrerelease = false } = {}) {
  const args = ['describe', '--tags'];
  if (abbrev !== null) args.push(`--abbrev=${abbrev}`);
  if (!includePrerelease) args.push(`--exclude=${PRERELEASE_TAG_GLOB}`);
  if (ref) args.push(ref);
  return args;
}

/**
 * The nearest release tag reachable from `ref` (HEAD by default) in the repo at `root`, or null when
 * there is none (no tags, only candidates, not a repo). Never throws.
 *
 * Nearest by ancestry, same as the describe it replaces — "latest reachable", not "highest SemVer".
 */
function latestReleaseTag(root, { ref = null, includePrerelease = false } = {}) {
  try {
    const out = execFileSync('git', ['-C', root, ...describeArgs({ ref, abbrev: 0, includePrerelease })], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch (_) {
    return null;
  }
}

// ---- pre-tag checks (#424) — fail closed before ANY candidate or final -------------------------
//
// Learned from a library that releases on every merge and publishes to a registry. Three checks, each
// with its own named reason, run by `colab release cut` and `colab release finalize` before a tag is
// created — pure (facts in, verdicts out); the CLI measures:
//
//   manifest-version  the tag equals the version every declared manifest carries
//   on-trunk          the tagged commit is an ancestor of trunk; a shallow checkout cannot answer
//   outranks-final    the version is strictly greater than the highest final tag, so "latest" never
//                     moves backwards

const PRE_TAG_CONDITIONS = Object.freeze(['manifest-version', 'on-trunk', 'outranks-final']);

/** The manifests read, in this order. A manifest that exists but declares no version is not a declaration. */
const MANIFESTS = Object.freeze(['VERSION', 'package.json', 'Cargo.toml', 'pyproject.toml']);

const SEMVER_RE = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$/;

/** `vX.Y.Z[-pre]` or `X.Y.Z[-pre]` -> { major, minor, patch, pre }, or null. */
function parseSemver(v) {
  const m = SEMVER_RE.exec(String(v || '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] || null } : null;
}

/** Compare the X.Y.Z cores only (a pre-release suffix is ignored). */
function compareCore(a, b) {
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
}

/** The `key = "value"` of one TOML table, or undefined / { dynamic } / { workspace }. Deliberately small: a version line, not a TOML parser. */
function tomlTableVersion(text, table) {
  const lines = String(text).split(/\r?\n/);
  let inTable = false;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    const h = /^\[([^\]]+)\]$/.exec(line);
    if (h) { inTable = h[1].trim() === table; continue; }
    if (!inTable) continue;
    if (/^version\.workspace\s*=\s*true$/.test(line) || /^version\s*=\s*\{\s*workspace\s*=\s*true\s*\}$/.test(line)) return { workspace: true };
    const m = /^version\s*=\s*"([^"]*)"$/.exec(line) || /^version\s*=\s*'([^']*)'$/.exec(line);
    if (m) return { value: m[1] };
    if (/^dynamic\s*=.*["']version["']/.test(line)) return { dynamic: true };
  }
  return undefined;
}

/**
 * Every version the repo's manifests declare, read through `readFile(rel)` (string, or null when the
 * file is absent). Returns [{ file, version } | { file, error } | { file, dynamic: true }]. Absent
 * files and manifests with no version field are omitted — they declare nothing.
 */
function manifestVersions(readFile) {
  const out = [];
  for (const file of MANIFESTS) {
    const text = readFile(file);
    if (text === null || text === undefined) continue;
    if (file === 'VERSION') {
      const v = String(text).trim();
      if (!v) out.push({ file, error: 'VERSION is empty' });
      else out.push({ file, version: v.replace(/^v/, '') });
    } else if (file === 'package.json') {
      let j;
      try { j = JSON.parse(text); } catch (e) { out.push({ file, error: `package.json does not parse (${e.message})` }); continue; }
      if (j && typeof j.version === 'string') out.push({ file, version: j.version });
      else if (j && j.version !== undefined) out.push({ file, error: `package.json version is ${JSON.stringify(j.version)}, not a string` });
    } else if (file === 'Cargo.toml') {
      const v = tomlTableVersion(text, 'package');
      if (!v) continue;
      if (v.workspace) out.push({ file, error: 'Cargo.toml takes version.workspace = true — the workspace root\'s version is not read here' });
      else out.push({ file, version: v.value });
    } else if (file === 'pyproject.toml') {
      const v = tomlTableVersion(text, 'project') || tomlTableVersion(text, 'tool.poetry');
      if (!v) continue;
      if (v.dynamic) out.push({ file, dynamic: true });
      else out.push({ file, version: v.value });
    }
  }
  return out;
}

/**
 * The three pre-tag checks for `tag` (a candidate `vX.Y.Z-rc.N` or a final `vX.Y.Z`).
 *
 *   manifests   manifestVersions(...) at the tagged commit, or null when it could not be read
 *   ancestry    { ok, shallow, detail? } — is the commit an ancestor of `trunk`; shallow = the
 *               checkout cannot answer (null = not measured)
 *   tags        every tag name in the repo — the finals among them are what the version must outrank
 *   trunk       the trunk name, for the detail text
 *   versionSource  #438 — 'manifest' (default): every declared manifest must equal the tag. 'tag'
 *               (`release.version-source: tag`): the manifests are DERIVABLE — the repo's own
 *               release/deploy step stamps them from the tag, never on trunk — so a manifest that
 *               differs is skipped and named, not refused. A manifest that cannot be read at all
 *               (unparsable package.json, an empty VERSION) still refuses: "derivable" says where
 *               a number comes from, not that a broken file is fine.
 *
 * Returns [{ condition, ok, detail }] in PRE_TAG_CONDITIONS order — the manifest-version entry also
 * carries `derivable: [file]` (the manifests skipped as derivable; empty on 'manifest'). Every
 * unknown is a refusal.
 */
function preTagChecks({ tag, manifests, ancestry, tags, trunk = 'main', versionSource = 'manifest' }) {
  const checks = [];
  const add = (condition, ok, detail, extra) => checks.push({ condition, ok: !!ok, detail, ...(extra || {}) });
  const t = parseSemver(tag);
  const core = t ? `${t.major}.${t.minor}.${t.patch}` : null;

  // 1. manifest-version
  if (!t) add('manifest-version', false, `${tag} is not a vX.Y.Z tag — nothing to compare a manifest against`);
  else if (manifests === null || manifests === undefined) add('manifest-version', false, 'the manifests could not be read at the tagged commit — an unread version is not a matching one');
  else {
    const accepted = t.pre ? [core, `${core}-${t.pre}`] : [core];
    const fromTag = versionSource === 'tag';
    const bad = [];
    const good = [];
    const derivable = [];
    for (const m of manifests) {
      if (m.error) bad.push(`${m.file}: ${m.error}`);
      else if (m.dynamic) good.push(`${m.file} (dynamic — derived from the tag)`);
      else if (!accepted.includes(String(m.version).replace(/^v/, ''))) {
        if (fromTag) derivable.push(m.file);
        else bad.push(`${m.file} says ${m.version}`);
      } else good.push(`${m.file} ${m.version}`);
    }
    const skipped = derivable.length ? `; derivable (release.version-source: tag — stamped from the tag by the repo's release step, never on trunk): ${derivable.join(', ')}` : '';
    if (bad.length) {
      add('manifest-version', false, fromTag
        ? `the tag ${tag} cannot be checked against a manifest — ${bad.join('; ')}. Derivable or not, a manifest that does not read is fixed on trunk first`
        : `the tag ${tag} does not equal the manifest version — ${bad.join('; ')}. Bump the manifest on trunk first, or declare release.version-source: tag if the release stamps it; a tag that disagrees with what the package says it is publishes a lie`, { derivable });
    } else if (!good.length && !derivable.length) add('manifest-version', true, `no version manifest declared (${MANIFESTS.join(', ')}) — the tag is the version`, { derivable });
    else if (!good.length) add('manifest-version', true, `${tag} is the version${skipped}`, { derivable });
    else add('manifest-version', true, `${tag} matches ${good.join(', ')}${skipped}`, { derivable });
  }

  // 2. on-trunk
  if (!ancestry) add('on-trunk', false, `ancestry not measured — cannot confirm the commit is on ${trunk}`);
  else if (ancestry.shallow) add('on-trunk', false, `a shallow checkout cannot answer whether the commit is on ${trunk} — fetch full history (fetch-depth: 0) and re-run`);
  else if (!ancestry.ok) add('on-trunk', false, ancestry.detail || `the tagged commit is not an ancestor of ${trunk}`);
  else add('on-trunk', true, ancestry.detail || `the tagged commit is an ancestor of ${trunk}`);

  // 3. outranks-final
  if (!t) add('outranks-final', false, `${tag} is not a vX.Y.Z tag`);
  else {
    const finals = (tags || []).map((n) => ({ n, v: parseSemver(n) })).filter((x) => x.v && !x.v.pre && /^v/.test(x.n));
    finals.sort((a, b) => compareCore(a.v, b.v));
    const top = finals.length ? finals[finals.length - 1] : null;
    if (!top) add('outranks-final', true, 'no final tag yet — nothing to outrank');
    else if (compareCore(t, top.v) <= 0) add('outranks-final', false, `v${core} does not outrank the latest final ${top.n} — "latest" would move backwards`);
    else add('outranks-final', true, `v${core} > latest final ${top.n}`);
  }
  return checks;
}

module.exports = {
  PRERELEASE_TAG_GLOB, isPrereleaseTag, describeArgs, latestReleaseTag,
  PRE_TAG_CONDITIONS, MANIFESTS, parseSemver, manifestVersions, preTagChecks,
};
