'use strict';
/**
 * Cheap, repo-local evidence that SOMETHING consumes a repo — a version-shaped git tag, or a
 * committed deploy path. Extracted from `audit/audit.mjs` (#137's falsifiers) so `colab adopt`
 * (#199) can reuse the identical detection without a second implementation: `install.sh` freezes
 * `tools/colab` + `tools/lib/` only, nothing under `audit/` is frozen, so anything both the audit
 * and the CLI need has to live here, not there.
 *
 * CommonJS, matching stamp.js / axis-authority.js: `audit/audit.mjs` (ESM) consumes this through
 * its existing `createRequire`; `tools/colab` (CJS) can `require` it directly. One implementation,
 * not two, for the identical reason every other cross-tool reading in this handbook lives in one
 * place — two readings of "does anything consume this repo" disagreeing is the two-places-drift
 * disease this handbook exists to kill.
 *
 * This module only ever GATHERS evidence — it never decides severity, never reads `exposureRaw` or
 * `channelsRaw`, and never says what a caller should conclude from what it finds. That policy (warn
 * vs fail, the 2-of-5 falsifier reach, why `exposure: self` gets nothing) is the audit's own and
 * stays in `audit/audit.mjs` — see its "exposure/channels falsifiers" comment block.
 */

// "v2.1.0", "1.4", "v3.0.0-rc1" count; "backup-2024" does not — no dot-separated numeric
// parts, so nothing about it claims to be a release. Calibration knob, not a settled
// grammar: real-world tag schemes vary, and a repo with an unusual-but-real scheme is a
// false negative here (silence), never a false positive.
const VERSION_TAG_RE = /^v?\d+\.\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.]+)*$/;

function versionShapedTags(tags) {
  return (tags || []).filter((t) => VERSION_TAG_RE.test(t));
}

// A `deploy`/`release` basename, any single extension (or none — a plain shell script often
// carries none). Matched only against a NON-recursive listing of the repo root, scripts/,
// and bin/ — the exclusion of templates/, examples/, docs/ in #137's plan is achieved simply
// by never looking there, not by an exclude list.
const DEPLOY_BASENAME_RE = /^(deploy|release)(\.[A-Za-z0-9]+)?$/i;

// Cheap repo-local evidence that something OTHER than "nothing" consumes this repo. Never
// throws, never returns null itself — every source it reads (tags(), listDir()) already
// degrades to null/[] on failure, and an unreadable source just means less evidence, not an
// error. Takes `workflows` from the caller (already listed by the tier checks) rather than
// re-listing .github/workflows — the "zero new IO" half of F5.
function consumerEvidence(src, workflows) {
  const versionTags = versionShapedTags(src.tags());

  const deployPaths = [];
  for (const wf of workflows) {
    if (/^(deploy|release)[-.]/.test(wf)) deployPaths.push(`.github/workflows/${wf}`);
  }
  for (const dir of ["", "scripts", "bin"]) {
    for (const f of src.listDir(dir)) {
      if (DEPLOY_BASENAME_RE.test(f)) deployPaths.push(dir ? `${dir}/${f}` : f);
    }
  }

  return { versionTags, deployPaths };
}

// One line of prose describing whatever consumerEvidence() found, or "" when it found
// nothing — the caller stays silent on "".
function describeEvidence(evidence) {
  const bits = [];
  if (evidence.versionTags.length) {
    const [first, ...rest] = evidence.versionTags;
    bits.push(`a release artifact exists (tag ${first}${rest.length ? ` +${rest.length} more` : ""})`);
  }
  if (evidence.deployPaths.length) {
    const shown = evidence.deployPaths.slice(0, 3);
    const more = evidence.deployPaths.length > 3 ? ", …" : "";
    bits.push(`a committed deploy path exists (${shown.join(", ")}${more})`);
  }
  return bits.join("; ");
}

module.exports = { VERSION_TAG_RE, versionShapedTags, DEPLOY_BASENAME_RE, consumerEvidence, describeEvidence };
