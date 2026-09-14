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

module.exports = { PRERELEASE_TAG_GLOB, isPrereleaseTag, describeArgs, latestReleaseTag };
