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
const writesAuthority = require('./writes-authority.js');
const yaml = require('./yaml.js');
const { consumerEvidence, describeEvidence } = require('./consumer-evidence.js');
const { evaluateExposure } = require('./exposure-shape.js');
const { UserError } = require('./util.js');

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
 * one the schema itself states.
 *
 * #237 (⚖ Decision on #233): `writes` stopped selecting a write-conflict prevention METHOD and
 * became a two-state VETO — `trunkDirectVetoed` (tools/lib/writes-authority.js), computed from
 * the RAW value, is the only reading anything downstream may act on now.
 *
 * #283 (structural fix for #282, replacing the `writesMethod`/`resolveWrites` reading): this
 * function now reads `writesAuthority.writesMode(writes)` — a TOTAL function onto exactly
 * `free` / `direct` / `isolated` — instead of `resolveWrites`, so `writesResolved` and
 * `trunkDirect` (still computed from the raw value via `trunkDirectVetoed`, unchanged since
 * #237) are derived from the SAME underlying fact and can never disagree in the same --json
 * blob. That disagreement was #282's whole complaint: `resolveWrites(raw).value` reads
 * 'isolated' for BOTH an explicit declaration and plain absence, so a `writesResolved` sourced
 * from it could say "isolated" while `trunkDirect` (sourced from `trunkDirectVetoed(raw)`) said
 * "permitted", in the same returned object. `writesMethod` — the retired 3-way parse whose only
 * job was that now-wrong reading — is dropped from the returned object entirely; nothing
 * downstream may read it as a method choice (#282's own suggested fix).
 *
 * `direct` is declared, stored, and honestly reported here — but its runtime is DEFERRED (#283,
 * Approach §2): `trunkDirect`/`ciRole`/`branchMandatory` each name that explicitly ("declared,
 * not yet enforced") rather than silently reusing `free`'s text, so a `direct` repo's report
 * never claims a guarantee this diff does not implement.
 */
function deriveConsequences({ exposure, writes, room }) {
  const { mode: writesResolved, source: modeSource } = writesAuthority.writesMode(writes);
  const writesSource = writes === null || writes === undefined ? null : modeSource;
  const vetoed = writesAuthority.trunkDirectVetoed(writes); // the ONE reading that decides anything now (#237) — unchanged, raw value, direct never vetoes

  const gateCount = exposure && Object.prototype.hasOwnProperty.call(axisAuthority.GATE_COUNT, exposure)
    ? axisAuthority.GATE_COUNT[exposure]
    : null;

  const DIRECT_DEFERRED_POINTER = 'declared, not yet enforced — see CONVENTIONS.md §2, '
    + '"writes: direct — declared today, runtime deferred (#283)"';

  // #237: absence and every non-veto value now permit trunk-direct to an ATTENDED session
  // (COLAB_HUMAN=1) — a session-identity fact this function cannot see from the descriptor
  // alone, so `trunkDirect` names both branches rather than resolving to one. `direct` gets its
  // own branch (#283): it never over-claims a guarantee `free` does not already give — see
  // writes-authority.js's `WRITES_CURRENT` comment on the fail-safe direction this rests on.
  const trunkDirect = vetoed
    ? 'vetoed — writes: isolated forbids trunk-direct for every session, human or not (CONVENTIONS.md §2, Writes)'
    : writesResolved === 'direct'
      ? `${DIRECT_DEFERRED_POINTER} — an attended session may take trunk-direct today exactly as under free (COLAB_HUMAN=1, CONVENTIONS.md §5, The human flag)`
      : 'permitted to an attended human session only — COLAB_HUMAN=1, set on a human\'s explicit instruction (CONVENTIONS.md §5, The human flag)';

  // #283, Approach §3 (Q2 — decided and shipped): under `direct` there is no merge event, so CI
  // can never gate a merge that never happens — `ciRole` is alarm, always. This is cheap to
  // decide because `ciRole` is derived prose here, not enforcement.
  const ciRole = vetoed
    ? 'gate — isolated writers always branch, so CI runs before the merge lands (CONVENTIONS.md §7)'
    : writesResolved === 'direct'
      ? `alarm, always — ${DIRECT_DEFERRED_POINTER}`
      : 'gate for a worktree session, alarm for an attended trunk-direct one — what CI is follows '
        + 'whether the unit has a branch, a fact about the session rather than a declared value (CONVENTIONS.md §7)';

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

  const branchMandatory = vetoed
    ? 'mandatory — isolated writers always use a worktree + branch'
    : writesResolved === 'direct'
      ? `${DIRECT_DEFERRED_POINTER} — the same two conditions as free decide it today`
      : 'mandatory for every session except an attended trunk-direct one, which needs a branch only '
        + 'when more than one unit is already in flight, or a gate must inspect a unit before it '
        + 'lands (CONVENTIONS.md §2, Writes)';

  const recoveryObligation = exposure && Object.prototype.hasOwnProperty.call(RECOVERY_OBLIGATION, exposure)
    ? RECOVERY_OBLIGATION[exposure]
    : null;

  return {
    writesResolved, writesSource, trunkDirect, gateCount, ciRole, ciDepth,
    ceremonyWeight, branchMandatory, recoveryObligation,
  };
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
    { n: 3, text: 'Create the full label set (13 names) — `colab labels --ensure`, CONVENTIONS.md §9 step 3 (#206)' },
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
  // 'origin-head' (the ordinary case) | 'current-branch-fallback' (no origin remote at all —
  // exactly first-time adoption's own shape: `git init`, adopt, add a remote later) | null
  // (nothing could be determined). Surfaced so a human sees a fallback was INFERRED, not read
  // from a remote's HEAD — tools/colab's adoptGitExtras() is the only place that computes it.
  const trunkSource = (extra && extra.trunkSource) || null;

  return {
    descriptorExists: io.readFile('.github/project.yml') !== null,
    cfg,
    axis,
    rows,
    detected: {
      trunk: { declared: declaredTrunk, detected: detectedTrunk, source: trunkSource, agree: declaredTrunk === null || detectedTrunk === null ? null : declaredTrunk === detectedTrunk },
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

// =========================================================================================
// commit 2 of #199 — asking, the human gate, and the write.
//
// Everything above this line is commit 1 (detect / derive / report; never asks, never
// writes). Everything below is new: which of the five §9 rows still needs a human answer,
// whether a PROPOSED answer is one this repo's own shape can support (EXPOSURE_SHAPE), whether
// the answer needs authorization before it may be written (gateVerdict), and how to append it
// to `.github/project.yml` without disturbing a single byte that was already there
// (renderDescriptor). tools/colab's cmdAdopt is the only place that reads env/tty/argv and
// calls fs.writeFileSync — every function here stays pure and unit-testable.
// =========================================================================================

const VALID_ROOM = new Set(['solo', 'team', 'public']);
// #283: `colab adopt --writes` accepts the CURRENT 3-way vocabulary (free/direct/isolated) AND
// every pre-#283 spelling (isolated/serial-direct/serial-gated, plus the `serial` alias) — an
// existing script or muscle-memory invocation keeps working, exactly like the audit's own
// read-side acceptance (tools/lib/writes-authority.js's WRITES_ACCEPTED_SET is the ONE set both
// share). `--writes direct` is legal here but subject to `writesGateVerdict` below before a
// write may proceed.
const VALID_WRITES = writesAuthority.WRITES_ACCEPTED_SET;
const VALID_EXPOSURE = new Set(['none', 'self', 'live', 'released']);
const VALID_CHANNELS = new Set(['workflow', 'hook', 'procedure', 'checkout', 'artifact', 'data', 'none']);
const VALID_DEPLOY = new Set(['tag', 'manual', 'push-main', 'none']);

/** `--channels` / the wizard's shared validator (#283: moved here from tools/colab so
 * `resolveChoice` below can share it with `adoptAnswersFromFlags`'s flag-driven path without a
 * second copy): non-empty, every member in VALID_CHANNELS, no duplicate member, and "none" must
 * stand alone. Throws UserError — the CLI's flag path lets that surface directly; `resolveChoice`
 * below catches it and turns it into an `{ ok: false, message }`. */
function adoptValidateChannels(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new UserError('--channels must be a non-empty comma-separated list — use "none" if nothing runs this code anywhere');
  }
  const unknown = list.filter((c) => !VALID_CHANNELS.has(c));
  if (unknown.length) throw new UserError(`--channels contains ${JSON.stringify(unknown)}, expected members of: ${[...VALID_CHANNELS].join(', ')}`);
  const deduped = [...new Set(list)];
  if (deduped.length !== list.length) throw new UserError(`--channels contains a duplicate member — declare each channel once: ${JSON.stringify(deduped)}`);
  if (list.includes('none') && list.length > 1) throw new UserError('--channels combines "none" with another value — "none" must stand alone');
  return list;
}

// ---------------------------------------------------------------------- §9 question set

/**
 * The five §9 rows, phrased exactly as CONVENTIONS.md §9 phrases them to a human — never
 * restated with different wording (this handbook has paid for a duplicated checklist drifting
 * from its source twice in one day; see skills/handbook-sync/SKILL.md's own note on the same
 * failure). `axis: 'tier'` writes `production` + `deploy`, never `tier` itself — question 1 is
 * the MECHANISM question ("does a deploy target exist today, and how is it reached?"), and
 * `tier` is a function of those two answers, never a row a human answers directly
 * (tools/lib/adopt.js:deriveTier). The `axis` name matches `ROW_NAMES` on purpose: it is the
 * same five names the report table already uses, so `--axis` and the report agree on vocabulary.
 *
 * #283: every entry below now carries a `choices` array — the wizard's forced multiple-choice
 * menu, rendered by `renderMenu(axis)` and resolved by `resolveChoice(axis, raw)` (both below).
 * `tier`'s `choices` are the `deploy` menu's four options — `production` is a URL, not an enum
 * member, so it is asked as its own two-option gate ("does a deploy target exist today?")
 * directly in `tools/colab`'s `adoptAskInteractive`, never through this generic mechanism; a URL
 * cannot honestly be a menu choice without pretending it belongs to a closed set. `channels` is
 * the one `multi: true` entry — "one or more numbers or names, comma-separated" — and its
 * resolution still runs through `adoptValidateChannels` unchanged (dedupe, "none" stands alone).
 * `exposure` is the one entry with a `skip` — see the "blank = skip" rule below its prompt.
 */
const QUESTIONS = Object.freeze([
  {
    axis: 'tier',
    keys: ['production', 'deploy'],
    prompt: 'Does a deploy target exist today (a URL), and how is it reached — a tag gates '
      + 'production, the promotion itself deploys (push-main), a human runs a runbook '
      + '(manual), or nothing is live yet (none)?',
    choices: [
      { value: 'push-main', label: 'the promotion itself deploys' },
      { value: 'tag', label: 'a version tag gates production' },
      { value: 'manual', label: 'a human runs a documented runbook' },
      { value: 'none', label: 'nothing is live yet' },
    ],
  },
  {
    axis: 'room',
    keys: ['room'],
    prompt: 'Who else works here? (solo / team / public)',
    choices: [
      { value: 'solo', label: 'nobody else could ever read what a session writes here' },
      { value: 'team', label: 'colleagues could read the record' },
      { value: 'public', label: 'anyone could read the record' },
    ],
  },
  {
    axis: 'exposure',
    keys: ['exposure'],
    prompt: 'What would break if you merged something wrong here? (none / self / live / released)',
    choices: [
      { value: 'none', label: 'nothing outside this room consumes a merge' },
      { value: 'self', label: 'only parties already in the room' },
      { value: 'live', label: 'the promotion into trunk is itself the deploy' },
      { value: 'released', label: 'a deliberate artifact (a tag, a runbook) deploys' },
    ],
    // #283: the ONE row that keeps a decline path — CONVENTIONS.md §9's own fallback (derive
    // `tier` from production+deploy instead) is a real fallback that consumes the absence. The
    // other four rows have no such fallback, so a skip there would just re-create #282's "leave
    // unanswered" shape under a different name.
    skip: { label: 'skip — derive tier from production + deploy instead' },
  },
  {
    axis: 'writes',
    keys: ['writes'],
    // #283: `free` IS the former blank. The old prompt told a human to "leave unanswered" for
    // coexistence because there was no spelling for it; now `free` names it directly, so this
    // prompt no longer offers (or needs) a decline — a later reader must not "restore" the
    // decline path here as a regression fix, it is deliberately gone (§5 of the plan on #283).
    prompt: 'Should a human ever be allowed to commit straight to this repo\'s trunk checkout, '
      + 'alongside worktree sessions? free allows it with no runtime restriction; direct allows '
      + 'it and additionally declares intent for a stronger guarantee later (declared today, not '
      + 'yet enforced — CONVENTIONS.md §2); isolated vetoes it outright, human or not.',
    choices: [
      { value: 'free', label: 'no restriction beyond the ordinary worktree flow (the default)' },
      { value: 'direct', label: 'declares intent for a future guarantee; declared today, not yet enforced' },
      { value: 'isolated', label: 'vetoes trunk-direct outright, human or not' },
    ],
  },
  {
    axis: 'channels',
    keys: ['channels'],
    prompt: 'By what path does a commit reach something that runs it? (a list — several may '
      + 'apply: workflow / hook / procedure / checkout / artifact / data / none)',
    multi: true,
    choices: [
      { value: 'workflow', label: 'merge → CI → a deploy workflow' },
      { value: 'hook', label: 'a git hook fires on a git act' },
      { value: 'procedure', label: 'a human builds/installs/restarts by a documented procedure' },
      { value: 'checkout', label: 'a per-machine service serves the working tree directly' },
      { value: 'artifact', label: 'a tag or package that adopters/others consume' },
      { value: 'data', label: 'the effect lands in another system\'s production data' },
      { value: 'none', label: 'nothing runs this code anywhere' },
    ],
  },
]);

// ---------------------------------------------------------------------- the wizard (#283) — pure menu logic

/**
 * The numbered menu block for `axis` — one line per choice ("N) value — label"), plus a
 * trailing skip line when the axis declares one (`exposure` only, today). Pure string building;
 * `tools/colab`'s `adoptAskInteractive` prints the question's `prompt` separately, then this.
 */
function renderMenu(axis) {
  const q = QUESTIONS.find((x) => x.axis === axis);
  if (!q || !q.choices) return '';
  const lines = q.choices.map((c, i) => `  ${i + 1}) ${c.value} — ${c.label}`);
  if (q.skip) lines.push(`  ${q.choices.length + 1}) ${q.skip.label}`);
  return lines.join('\n');
}

/**
 * Resolve a raw typed answer for `axis` against its menu (#283). Accepts EITHER the option
 * NUMBER or the literal VALUE — muscle memory and scriptability read the same validating set:
 * `resolveChoice('room', '2')` and `resolveChoice('room', 'team')` both succeed identically.
 *
 * Returns one of:
 *   { ok: true, value }     — an ordinary choice, resolved to its declared value.
 *   { ok: true, skip: true } — the skip option, only for an axis that declares one (`exposure`).
 *   { ok: false, message }  — anything else; `message` names the valid options so a reprompt
 *                             (or a scripted caller) knows exactly what would have worked.
 *
 * `channels` is the one `multi: true` axis: `raw` is a comma-separated list of numbers/names,
 * each resolved independently against the same menu, then the whole resulting list is run
 * through `adoptValidateChannels` UNCHANGED (dedupe, "none" stands alone) — a thrown UserError
 * from that call becomes this function's ordinary `{ ok: false, message }` shape, never a throw.
 */
function resolveChoice(axis, raw) {
  const q = QUESTIONS.find((x) => x.axis === axis);
  const trimmed = (raw === null || raw === undefined ? '' : String(raw)).trim();
  if (!q || !q.choices) return { ok: false, message: `no menu defined for axis "${axis}"` };

  const findOne = (part) => {
    if (/^\d+$/.test(part)) {
      const byNumber = q.choices[Number(part) - 1];
      if (byNumber) return byNumber;
    }
    return q.choices.find((c) => c.value === part) || null;
  };
  const optionsText = () => {
    const base = q.choices.map((c, i) => `${i + 1}) ${c.value}`).join(', ');
    return q.skip ? `${base}, ${q.choices.length + 1}) ${q.skip.label}` : base;
  };

  if (q.multi) {
    if (trimmed === '') {
      return { ok: false, message: `choose one or more of: ${q.choices.map((c) => c.value).join(', ')} (numbers or names, comma-separated)` };
    }
    const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    const values = [];
    for (const part of parts) {
      const choice = findOne(part);
      if (!choice) return { ok: false, message: `"${part}" is not one of: ${optionsText()}` };
      values.push(choice.value);
    }
    try {
      return { ok: true, value: adoptValidateChannels(values) };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  if (q.skip && trimmed === String(q.choices.length + 1)) return { ok: true, skip: true };
  if (trimmed === '') return { ok: false, message: `choose one of: ${optionsText()}` };

  const choice = findOne(trimmed);
  if (!choice) return { ok: false, message: `"${trimmed}" is not one of: ${optionsText()}` };
  return { ok: true, value: choice.value };
}

/**
 * Is `axis` (one of `ROW_NAMES`) still unanswered in `cfg`? This is deliberately NOT the same
 * question `detect()`'s `rows` answer — `rows.tier` reads `detected` the moment `production`
 * defaults to "no production" (a genuine derivation), and `rows.exposure` reads `legacy read`
 * off a declared `tier` (a genuine, useful fallback for REPORTING). Neither counts as "answered"
 * here: asking is about what a human has explicitly put on record, not what this tool could
 * infer on their behalf. A legacy `tier: C` reading as `exposure: live` must still be ASKED —
 * that explicit declaration is the entire point of phase 3 of the epic this unit closes.
 */
function axisMissing(cfg, axis) {
  const c = cfg || {};
  switch (axis) {
    case 'tier':
      return !('production' in c) || !('deploy' in c);
    case 'room':
      return !('room' in c) || c.room === null || c.room === undefined;
    case 'exposure':
      return axisAuthority.axisOfRecord(c).source !== 'exposure';
    case 'writes':
      return !('writes' in c) || c.writes === null || c.writes === undefined;
    case 'channels':
      return !('channels' in c) || c.channels === null || c.channels === undefined;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------- EXPOSURE_SHAPE — the constructor

/**
 * exposureShapeVerdict — the CONSTRUCTOR half of #144's exposure contract, where
 * `audit/audit.mjs`'s exposure block is the VALIDATOR half. Given the shape a repo is actually
 * IN right now — `{ trunk, hasProduction, deploy, hasDeployWorkflow, hasRunbook }` (`hasRunbook`:
 * a `runbook:` key is declared AND the file it names exists — only `released` with
 * `deploy: manual`, or `deploy: tag` with no committed workflow, ever reads it) — does it
 * support DECLARING a given exposure value?
 *
 * Both this and the audit's block now read ONE shared rule table, `tools/lib/exposure-shape.js`
 * (#207) — this function's whole job is picking the FIRST violation `evaluateExposure` reports
 * (the audit reports every one; a constructor only needs one reason to refuse) and resolving the
 * one entry kind ('runbook') whose verdict depends on which caller is asking: the audit can read
 * the repo and tell "missing" from "unreadable"; this constructor only has `ctx.hasRunbook`.
 * `EXPOSURE_SHAPE` (the old per-exposure closure table, and the module-level export of the same
 * name) is retired along with `tools/lib/adopt-audit-agreement.test.js` — see that file's
 * replacement, `tools/lib/exposure-shape.test.js`, for what now guards this.
 */
function exposureShapeVerdict(exposure, ctx) {
  for (const entry of evaluateExposure(exposure, ctx || {})) {
    if (entry.kind === 'runbook') {
      if (!(ctx && ctx.hasRunbook)) return { ok: false, reason: entry.message };
      continue; // runbook requirement met — this entry does not block the write
    }
    return { ok: false, reason: entry.message };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------- the human gate (#199's plan)

const EXPOSURE_RANK = Object.freeze({ none: 0, self: 1, live: 2, released: 3 });

const GATE_CLASS = Object.freeze({
  HUMAN_GATED: 'human-gated',
  EVIDENCE_CONTRADICTS: 'evidence-contradicts',
  REPO_SHAPE: 'repo-shape',
});

const EXIT_CODE = Object.freeze({
  ok: 0,
  [GATE_CLASS.HUMAN_GATED]: 3,
  [GATE_CLASS.EVIDENCE_CONTRADICTS]: 4,
  [GATE_CLASS.REPO_SHAPE]: 5,
});

/**
 * THE HONEST LIMIT (#199's plan is emphatic this be stated in code, not only in a comment
 * somewhere it can be missed): `COLAB_HUMAN=1` is an env var the gated party can set — #150 is
 * the parked epic that would make it mean something stronger, and until that lands this gate is
 * exactly as strong as `colab ship`'s identical bar, and no stronger. An interactive TTY is a
 * better DEFAULT (an agent must take an unusual act — allocate a pty — to defeat it, where
 * setting an env var is an entirely ordinary one), but a TTY is not identity either. The
 * provenance comment this module writes beside every answered key does not prevent a false
 * claim; it makes one require DELIBERATELY writing a lie into a committed file, which is
 * auditable after the fact. None of this becomes a real access-control boundary until #150's
 * identity work exists — this module does not pretend otherwise.
 *
 * The bar applies ONLY to the LOWERING direction (`EXPOSURE_RANK`: released > live > self >
 * none) plus first declarations of `none`/`self` — raising, or a FIRST declaration of
 * `live`/`released`, needs nothing beyond falsifier/shape clearance, because an agent may
 * PROPOSE those from committed evidence (CONVENTIONS.md §2's asymmetry) while only a human may
 * conclude "nothing" or "only the room" consumes a merge here.
 *
 * Pure — every fact this needs is passed in. `tools/colab`'s cmdAdopt is the only place that
 * reads `process.env.COLAB_HUMAN` / `process.stdin.isTTY` and passes the booleans through.
 */
function gateVerdict({ exposure, currentExposure, shapeCtx, evidence, isTTY, colabHuman, answeredBy, reason }) {
  const shape = exposureShapeVerdict(exposure, shapeCtx);
  if (!shape.ok) {
    return { ok: false, class: GATE_CLASS.REPO_SHAPE, exitCode: EXIT_CODE[GATE_CLASS.REPO_SHAPE], message: `exposure: ${exposure} — ${shape.reason}` };
  }

  // Falsifier (#137, mirrored): only ever fires on `none` — `self` gets no falsifier at all, on
  // the audit's own precedent (its consumer set is a subset of the room's, which nothing here
  // can confirm or deny from repo-local evidence). Direction-independent: this is evidence about
  // the CLAIM, not about who is authorized to make it.
  if (exposure === 'none' && evidence) {
    const line = describeEvidence(evidence);
    if (line && !reason) {
      return {
        ok: false,
        class: GATE_CLASS.EVIDENCE_CONTRADICTS,
        exitCode: EXIT_CODE[GATE_CLASS.EVIDENCE_CONTRADICTS],
        message: `exposure: none is contradicted by repo evidence — ${line}. Choose again, or `
          + 'override with --reason "<text>", written into the file',
      };
    }
  }

  const isFirst = currentExposure === null || currentExposure === undefined;
  const isLowering = !isFirst && EXPOSURE_RANK[exposure] < EXPOSURE_RANK[currentExposure];
  const isRaisingOrFirstHigh = (exposure === 'live' || exposure === 'released') && !isLowering;
  if (isRaisingOrFirstHigh) return { ok: true };

  const authorized = isTTY || (colabHuman && answeredBy);
  if (!authorized) {
    return {
      ok: false,
      class: GATE_CLASS.HUMAN_GATED,
      exitCode: EXIT_CODE[GATE_CLASS.HUMAN_GATED],
      message: isLowering
        ? `lowering exposure from ${JSON.stringify(currentExposure)} to ${JSON.stringify(exposure)} requires `
          + 'a human: answer at an interactive terminal, or re-run with COLAB_HUMAN=1 and --answered-by "<name>"'
        : `declaring exposure: ${exposure} requires a human: answer at an interactive terminal, `
          + 'or re-run with COLAB_HUMAN=1 and --answered-by "<name>"',
    };
  }
  if (isLowering && !reason) {
    return {
      ok: false,
      class: GATE_CLASS.HUMAN_GATED,
      exitCode: EXIT_CODE[GATE_CLASS.HUMAN_GATED],
      message: `lowering exposure from ${JSON.stringify(currentExposure)} to ${JSON.stringify(exposure)} also `
        + 'requires --reason "<text>", written into the file',
    };
  }
  return { ok: true };
}

/**
 * #283, Approach §6: the declaration-time gate for `writes: direct` — a SIBLING of `gateVerdict`
 * above, never an overload of it, so neither function's existing tests get entangled with the
 * other's. `direct` is the only `writes` value that EXPANDS permission relative to `free`
 * (`free`/`isolated` never do), so it is the only one gated:
 *
 *   1. Human bar — the same bar as lowering exposure: an interactive TTY, or `COLAB_HUMAN=1`
 *      together with `--answered-by <name>`. `GATE_CLASS.HUMAN_GATED`, exit 3.
 *   2. Exposure refusal, BOTH directions — refused when the EFFECTIVE exposure (this run's
 *      exposure answer, else the descriptor's own axis of record) is `live` or `released`.
 *      `GATE_CLASS.REPO_SHAPE`, exit 5. The symmetric case matters: declaring `writes: direct`
 *      when exposure is already live/released is refused, and so is answering
 *      `--exposure live|released` against an already-declared `writes: direct` (or one answered
 *      in the SAME run) — the caller (`tools/colab`'s `cmdAdopt`) is what computes `effExposure`
 *      to cover both orders; this function only ever sees the resolved value.
 *
 * No `--force`, no override flag — consistent with `HELP_ADOPT`'s "There is no --force." A
 * `writes` value other than `direct` always clears this gate; it exists for `direct` alone.
 */
function writesGateVerdict({ writes, effExposure, isTTY, colabHuman, answeredBy }) {
  if (writes !== 'direct') return { ok: true };

  if (effExposure === 'live' || effExposure === 'released') {
    return {
      ok: false,
      class: GATE_CLASS.REPO_SHAPE,
      exitCode: EXIT_CODE[GATE_CLASS.REPO_SHAPE],
      message: `writes: direct is refused when exposure is ${JSON.stringify(effExposure)} — a `
        + 'repo where a merge reaches users or adopters directly is exactly the shape this '
        + 'declaration-time gate exists to stop before direct\'s runtime lands (CONVENTIONS.md '
        + '§2, "writes: direct — declared today, runtime deferred (#283)")',
    };
  }

  const authorized = isTTY || (colabHuman && answeredBy);
  if (!authorized) {
    return {
      ok: false,
      class: GATE_CLASS.HUMAN_GATED,
      exitCode: EXIT_CODE[GATE_CLASS.HUMAN_GATED],
      message: 'declaring writes: direct requires a human: answer at an interactive terminal, or '
        + 're-run with COLAB_HUMAN=1 and --answered-by "<name>" — direct is the one writes value '
        + 'that EXPANDS permission',
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------- provenance + the append-only write

/** The comment placed beside a written key — never trusted as identity (see gateVerdict's
 * header note), only as an audit trail a false claim would have to be written deliberately into. */
function provenanceComment(key, meta) {
  if (meta.mode === 'interactive') {
    return `# ${key}: answered interactively (${meta.host}, ${meta.date})`;
  }
  const bits = [`supplied by ${meta.flags.join(', ')}`];
  if (meta.colabHuman) bits.push('COLAB_HUMAN=1');
  if (meta.answeredBy) bits.push(`--answered-by ${JSON.stringify(meta.answeredBy)}`);
  return `# ${key}: ${bits.join(', ')} (${meta.date})`;
}

function yamlScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s === '') return '""';
  if (/^(null|true|false|yes|no|~)$/i.test(s) || /[:#]/.test(s) || /^\s|\s$/.test(s) || /^['"]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function yamlFlowSeq(arr) {
  return `[${arr.map((v) => yamlScalar(v)).join(', ')}]`;
}

/**
 * Append-only. `entries` — `[{ key, value, comment? }]` — are rendered in order and added to the
 * END of `rawText` (which may be `null`/`''`/absent for a repo adopting for the first time).
 * Never re-parses, never re-serialises, never touches a byte already present: this repo's own
 * descriptor is ~60 lines of comment over 9 keys, and a parse-and-reserialise pass would destroy
 * every one of them. `tools/lib/adopt-cli.test.js` asserts `git diff` shows only appended lines.
 */
function renderDescriptor(rawText, entries) {
  const base = rawText === null || rawText === undefined ? '' : rawText;
  const lines = [];
  for (const e of entries) {
    const valueStr = Array.isArray(e.value) ? yamlFlowSeq(e.value) : yamlScalar(e.value);
    lines.push(`${e.key}: ${valueStr}`);
    if (e.comment) lines.push(e.comment);
  }
  const block = `${lines.join('\n')}\n`;
  if (base === '') return block;
  const needsNewline = !base.endsWith('\n');
  return base + (needsNewline ? '\n' : '') + block;
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
  // commit 2
  VALID_ROOM,
  VALID_WRITES,
  VALID_EXPOSURE,
  VALID_CHANNELS,
  VALID_DEPLOY,
  adoptValidateChannels,
  QUESTIONS,
  renderMenu,
  resolveChoice,
  axisMissing,
  EXPOSURE_RANK,
  GATE_CLASS,
  EXIT_CODE,
  exposureShapeVerdict,
  gateVerdict,
  writesGateVerdict,
  provenanceComment,
  renderDescriptor,
};
