'use strict';
/**
 * tools/lib/adopt.js — the core of `colab adopt` (#199, commit 1 of 2).
 *
 * This unit is DETECT / DERIVE / REPORT only. It never asks a human a question, never gates on
 * `COLAB_HUMAN`, and never writes `.github/project.yml` — see the plan on #199 for why asking and
 * writing are a separate commit ("the seam"). What lives here is the part that is useful on its
 * own: read whatever a repo has already declared, detect what its working tree already states,
 * derive what §9's checklist says follows from those answers, and hand back a structured report.
 *
 * Pure and injected-`io`, on purpose — every function here is unit-testable with a scripted `io`,
 * no real git/filesystem required (`tools/lib/adopt.test.js`); the real CLI wiring
 * (`tools/colab`'s `cmdAdopt`) is the only place that touches `fs`/`git` for real.
 *
 * `io` matches the local shape of `makeSource()` in `audit/audit.mjs` (~:538-590) — deliberately
 * narrow, three functions:
 *   readFile(relPath) -> string | null    file contents, or null if unreadable/absent
 *   listDir(relPath)  -> string[]         non-recursive listing, [] if unreadable/absent
 *   tags()            -> string[] | null  every git tag, or null if undeterminable
 *
 * Git facts that are NOT plain file reads (trunk, `core.hooksPath`) are passed in separately via
 * `extra`, rather than folded into `io` — `detectTrunk()` already lives in `tools/lib/git.js` and
 * belongs to the CLI layer, not duplicated here.
 *
 * `.github/project.yml`'s FIVE rows are exactly §9's shared question set (CONVENTIONS.md §9):
 * tier, room, exposure, writes, channels. `trunk`/`stack`/`ports` are DETECTED, never asked, and
 * are reported alongside the rows without being rows themselves.
 */

const axisAuthority = require('./axis-authority.js');
const yaml = require('./yaml.js');
const { consumerEvidence, describeEvidence } = require('./consumer-evidence.js');

const ROW_NAMES = ['tier', 'room', 'exposure', 'writes', 'channels'];

// ---------------------------------------------------------------------- descriptor read

/** Parsed `.github/project.yml`, or {} when absent/unparseable — never throws. */
function readDescriptor(io) {
  const text = io.readFile('.github/project.yml');
  if (text === null) return {};
  try {
    return yaml.parse(text) || {};
  } catch (_) {
    return {};
  }
}

// ---------------------------------------------------------------------- detect (never ask)

/**
 * Stack candidates from manifest PRESENCE only — never a version, never a claim about which one
 * is authoritative when more than one manifest exists (a repo can genuinely be polyglot). Each
 * entry names the manifest found, so a human reads WHY a candidate was proposed.
 */
function detectStack(io) {
  const candidates = [];
  if (io.readFile('package.json') !== null) candidates.push('node (package.json)');
  if (io.readFile('composer.json') !== null) candidates.push('php (composer.json)');
  if (io.readFile('pyproject.toml') !== null) candidates.push('python (pyproject.toml)');
  if (io.readFile('.python-version') !== null) candidates.push('python (.python-version)');
  return candidates;
}

/**
 * Channel candidates (CONVENTIONS.md §2, "Channels") — evidence only, never an assertion that a
 * channel is real, mirroring the exposure-raising asymmetry: an agent may PROPOSE, never declare
 * absence. Reuses `consumerEvidence()` (#137, extracted #199) for the `workflow`/`artifact`
 * evidence it already gathers, and adds the one kind that function does not cover: a hooks dir or
 * a non-default `core.hooksPath`, evidence for `hook`.
 */
function detectChannelCandidates(io, workflows, extra) {
  const evidence = consumerEvidence(io, workflows);
  const candidates = [];
  if (evidence.deployPaths.some((p) => p.startsWith('.github/workflows/'))) candidates.push('workflow');
  if (evidence.versionTags.length) candidates.push('artifact');
  const hooksDirFiles = (extra && extra.hooksDirFiles) || [];
  const hooksPath = (extra && extra.hooksPath) || null;
  // A REPO-RELATIVE hooksPath (e.g. ".githooks") is a committed fact about the repo — real
  // evidence. An ABSOLUTE hooksPath is exactly the per-host mechanism CONVENTIONS.md §2
  // ("Channels — names the KIND, never the machine") says never belongs in the descriptor: test
  // fixtures and CI runners routinely point core.hooksPath at a scratch directory OUTSIDE the
  // repo to neutralise a developer's real hooks (CONVENTIONS.md §7, "Test fixtures"), and that
  // machine-local override must never read as the repo declaring a hook channel.
  if (hooksDirFiles.length > 0 || (hooksPath && !hooksPath.startsWith('/'))) candidates.push('hook');
  return { candidates, evidence, evidenceLine: describeEvidence(evidence) };
}

// ---------------------------------------------------------------------- derive (never ask)

/**
 * The legacy tier LETTER, as a pure function of `(production, deploy)` — never of `exposure`.
 * `tier` is a function of these two fields; the plan on #199 is emphatic about this direction
 * only, and explains why: `exposure` is what tier is now DERIVED FROM when declared, so deriving
 * exposure from a tier this function just invented would be circular.
 *
 *   production: null/absent          -> "B" (no production, the tier-B contract)
 *   production set + deploy push-main -> "C" (the promotion itself is the deploy)
 *   production set + deploy tag|manual -> "A" (a deliberate release artifact gates production)
 *   production set + deploy none/other -> null (a shape §2/schema.md has no letter for — a
 *                                          descriptor contradiction to REPORT, never guess past)
 */
function deriveTier(production, deploy) {
  const hasProduction = production !== null && production !== undefined && production !== '';
  if (!hasProduction) return 'B';
  if (deploy === 'push-main') return 'C';
  if (deploy === 'tag' || deploy === 'manual') return 'A';
  return null;
}

const RECOVERY_OBLIGATION = Object.freeze({
  none: "amend or `git reset` the trunk-direct commit — nothing outside the repo saw it",
  self: 'rebuild the checkout from a known-good ref and redeploy — the deploy gate, where the repo has one, is the recovery point',
  live: 'revert the commit, then promote the revert — the revert is a deploy in its own right, not a formality before one',
  released: 'cut a new version and publish an advisory — a release, once tagged, cannot be un-tagged',
});

/**
 * Everything §9/§7's "derived, never asked" list follows from `writes`/`exposure`/`room` alone —
 * CONVENTIONS.md §2 ("CI", "Recovery", "Ceremony", "Writes"). Every value here is null when the
 * axis it depends on is undeclared: this function derives, it never guesses a default beyond the
 * one the schema itself states (`writes` omission = `isolated`).
 */
function deriveConsequences({ exposure, writes, room }) {
  const writesResolved = writes === 'serial' ? 'serial' : 'isolated'; // omission = isolated (schema default)

  const gateCount = exposure && Object.prototype.hasOwnProperty.call(axisAuthority.GATE_COUNT, exposure)
    ? axisAuthority.GATE_COUNT[exposure]
    : null;

  const ciRole = writesResolved === 'serial'
    ? 'alarm — trunk-direct by default; CI runs after the push and reports, it does not gate (CONVENTIONS.md §7)'
    : 'gate — isolated writers always branch, so CI runs before the merge lands (CONVENTIONS.md §7)';

  const ciDepth = (exposure === 'live' || exposure === 'released')
    ? 'thorough — answers to a consumer with no way to ask a clarifying question (CONVENTIONS.md §7)'
    : (exposure === 'none' || exposure === 'self')
      ? 'answers only to the room (CONVENTIONS.md §7)'
      : null;

  const ceremonyWeight = room === 'solo'
    ? 'light narration is coherent — the trail has exactly one reader (CONVENTIONS.md §2, Ceremony)'
    : (room === 'team' || room === 'public')
      ? 'standard narration — more than one reader could ever comb the trail'
      : null;

  const branchMandatory = writesResolved === 'serial'
    ? 'optional — mandatory only when more than one unit is in flight, or a gate must inspect a unit before it lands (CONVENTIONS.md §2, Writes)'
    : 'mandatory — isolated writers always use a worktree + branch';

  const recoveryObligation = exposure && Object.prototype.hasOwnProperty.call(RECOVERY_OBLIGATION, exposure)
    ? RECOVERY_OBLIGATION[exposure]
    : null;

  return { writesResolved, gateCount, ciRole, ciDepth, ceremonyWeight, branchMandatory, recoveryObligation };
}

// ---------------------------------------------------------------------- §9 remainder checklist

/**
 * §9's steps 3-9, unconditionally — this commit never performs any of them (Boundary, #199's
 * plan: "adopt writes the descriptor and nothing else"), so the remainder is the same regardless
 * of what the descriptor already states. Handed back as data, not prose, so a caller (a report
 * printer, or a future `handbook-sync` call site) does not grow its own paraphrase of these steps.
 */
function remainingSteps() {
  return [
    { n: 3, text: 'Create the full label set (13 names) — `gh label create …`, CONVENTIONS.md §9 step 3' },
    { n: 4, text: 'Add the tier topic to the GitHub repo — `gh repo edit --add-topic tier-<b|c|a>`, step 4' },
    { n: 5, text: 'Add the handbook pointer to CLAUDE.md — copy templates/repo-CLAUDE-block.md, step 5' },
    { n: 6, text: "Make sure CI meets §7's outcome — `colab template <name>`, step 6" },
    { n: 7, text: 'Register the repo — `colab register`, step 7' },
    { n: 8, text: 'Leave existing branches alone — nothing to do, step 8' },
    { n: 9, text: 'Do not create `dev` unless genuinely Tier A or Tier C — nothing to do, step 9' },
  ];
}

// ---------------------------------------------------------------------- row state

/** One of the five §9 rows: { state: 'answered'|'missing'|'detected'|'legacy read', value, source }. */
function rowFromDeclared(cfg, key) {
  const has = Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key] !== null && cfg[key] !== undefined;
  return has
    ? { state: 'answered', value: cfg[key], source: 'declared in .github/project.yml' }
    : { state: 'missing', value: null, source: null };
}

function rowExposure(cfg, axis) {
  if (axis.source === 'exposure') {
    return { state: 'answered', value: axis.exposure, source: 'declared in .github/project.yml' };
  }
  if (axis.source === 'tier-legacy') {
    return {
      state: 'legacy read',
      value: axis.exposure, // may be null (tier: B carries no derivable opinion)
      source: `derived from tier: ${axis.tier} (tools/lib/axis-authority.js)`,
    };
  }
  return { state: 'missing', value: null, source: null };
}

function rowChannels(cfg, channelInfo) {
  const has = Object.prototype.hasOwnProperty.call(cfg, 'channels') && cfg.channels !== null && cfg.channels !== undefined;
  if (has) return { state: 'answered', value: cfg.channels, source: 'declared in .github/project.yml' };
  if (channelInfo.candidates.length > 0) {
    return {
      state: 'detected',
      value: channelInfo.candidates,
      source: channelInfo.evidenceLine || 'working-tree evidence',
    };
  }
  return { state: 'missing', value: null, source: null };
}

function rowTier(cfg, legacyTierLetter) {
  const has = Object.prototype.hasOwnProperty.call(cfg, 'tier') && cfg.tier !== null && cfg.tier !== undefined;
  if (has) return { state: 'answered', value: cfg.tier, source: 'declared in .github/project.yml' };
  if (legacyTierLetter !== null) {
    return {
      state: 'detected',
      value: legacyTierLetter,
      source: 'derived from production + deploy (tools/lib/adopt.js:deriveTier)',
    };
  }
  return { state: 'missing', value: null, source: null };
}

// ---------------------------------------------------------------------- detect (top-level)

/**
 * The whole report. `io` — see the module header. `extra` — everything the CLI already knows
 * that is not a plain file read: `{ trunk, hooksPath, hooksDirFiles }`, all optional.
 *
 * Never asks, never writes. Returns a plain object — the CLI decides how to render it (text or
 * `--json`), and both paths read the same structure so they cannot drift apart from each other.
 */
function detect(io, extra = {}) {
  const cfg = readDescriptor(io);
  const axis = axisAuthority.axisOfRecord(cfg);

  const workflows = io.listDir('.github/workflows').filter((f) => /\.ya?ml$/.test(f));
  const channelInfo = detectChannelCandidates(io, workflows, extra);
  const stackCandidates = detectStack(io);

  const production = Object.prototype.hasOwnProperty.call(cfg, 'production') ? cfg.production : null;
  const deploy = Object.prototype.hasOwnProperty.call(cfg, 'deploy') ? cfg.deploy : null;
  const legacyTierLetter = deriveTier(production, deploy);

  const rows = {
    tier: rowTier(cfg, legacyTierLetter),
    room: rowFromDeclared(cfg, 'room'),
    exposure: rowExposure(cfg, axis),
    writes: rowFromDeclared(cfg, 'writes'),
    channels: rowChannels(cfg, channelInfo),
  };

  const consequences = deriveConsequences({
    exposure: axis.exposure,
    writes: cfg.writes || null,
    room: cfg.room || null,
  });

  const declaredTrunk = Object.prototype.hasOwnProperty.call(cfg, 'trunk') ? cfg.trunk : null;
  const detectedTrunk = (extra && extra.trunk) || null;

  return {
    descriptorExists: io.readFile('.github/project.yml') !== null,
    cfg,
    axis,
    rows,
    detected: {
      trunk: { declared: declaredTrunk, detected: detectedTrunk, agree: declaredTrunk === null || detectedTrunk === null ? null : declaredTrunk === detectedTrunk },
      stackCandidates,
      ports: Object.prototype.hasOwnProperty.call(cfg, 'ports') ? cfg.ports : null,
      channelCandidates: channelInfo.candidates,
      channelEvidenceLine: channelInfo.evidenceLine,
    },
    legacyTierLetter,
    consequences,
    remaining: remainingSteps(),
  };
}

module.exports = {
  ROW_NAMES,
  readDescriptor,
  detectStack,
  detectChannelCandidates,
  deriveTier,
  deriveConsequences,
  remainingSteps,
  detect,
};
