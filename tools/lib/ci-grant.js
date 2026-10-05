'use strict';
/**
 * The ci-grant marker (#105) — a per-issue, human-only, branch-bound, RED-TRUNK-SHA-bound,
 * expiring exemption to `colab ship`'s trunk-CI-green precondition (`shipCiCheck` in tools/colab).
 *
 * WHY A GRANT EXISTS AT ALL. `ship`'s first precondition — a completed, successful CI run for the
 * target's head sha — is right by default: unattended merges into a red trunk are exactly how a
 * broken repo stays broken. But it has exactly one un-exitable case: a GENUINELY red trunk, where
 * the candidate branch's entire content IS the fix. Nothing inside the merge can clear the
 * precondition, and nothing outside it can either — the fix cannot reach trunk without shipping,
 * and shipping requires the green the fix would produce. Without a sanctioned door the repo is
 * bricked for unattended work until a human performs the whole of Phase B by hand — squash
 * trailers, guard push, teardown, evidence, claim release, group-label cleanup — precisely the
 * surface the gates exist to get right, and the hand path is where their mistakes come back (a
 * wrong `Closes #N` is immutable once pushed).
 *
 * THIS IS NOT THE SAME DEADLOCK AS THE ONE CONVENTIONS.md:505 ALREADY NAMES. That text (and the
 * "ask by sha, not by recency" fix) resolves a FALSE red — a cancelled `cancel-in-progress`
 * straggler outranking a passing run on the same commit. Asking per-sha fixed a red that was never
 * real. A genuinely red trunk is untreated by that fix: the sha really did fail, and no amount of
 * asking differently changes the answer.
 *
 * MODELLED ON tools/lib/migration-grant.js (#98) — same problem SHAPE (a precondition right in
 * general, wrong for exactly one legitimate deliverable), so it gets the same solution rather than
 * a new mechanism: two markers (a LABEL gating who may even attempt the read, a COMMENT carrying
 * what the label cannot), written under `COLAB_HUMAN=1`, read on `ship`, visible from any machine.
 * DELIBERATELY A SEPARATE MODULE, not a shared base extracted from migration-grant.js — extracting
 * would touch a passing safety-critical module for a reason unrelated to migrations, the same
 * argument tools/lib/ship-migration-grant.test.js makes about its own fixture.
 *
 * WHY THIS GRANT IS STRICTLY MORE DANGEROUS THAN THE MIGRATION ONE, and what compensates:
 *   - A bad migration grant merges ONE reviewed schema change. A bad CI grant merges into a repo
 *     whose OWN TEST SUITE is known-failing — the merge itself is unverified by the gate that
 *     exists to verify it.
 *   - So, unlike migration-grant, THIS grant is bound to the RED TRUNK SHA it was reviewed
 *     against, and expires the instant trunk's head moves — granted-and-consumed or not. A grant
 *     surviving into a DIFFERENT red (trunk moved, a new and different failure) was never reviewed
 *     against that failure and must not silently keep working.
 *   - And it requires MEASURED evidence — a real, completed, successful CI run on the branch's OWN
 *     head — never a human's say-so alone. `--evidence-run` (tools/colab) is a recording-only
 *     pointer for the audit trail; it can never substitute for the measured run this module checks.
 *   - Anti-stacking (evaluated at grant-CREATE time in tools/colab, not here — this module is pure)
 *     refuses a second grant while trunk is STILL red after one grant already merged something:
 *     otherwise the exemption becomes the way work ships on a permanently broken repo, exactly the
 *     failure the gate was built to prevent.
 *
 * TWO MARKERS, TWO DIFFERENT JOBS — read together, never one alone, same split as migration-grant:
 *   - a LABEL (`ci-granted`, tools/lib/labels.js) — a cheap `gh issue list --label` query, and the
 *     load-bearing half: applying a label on GitHub requires triage/write permission, so a
 *     drive-by commenter on a public repo cannot manufacture a grant merely by posting a
 *     well-formed comment.
 *   - a COMMENT (this module's GRANT_MARK/REVOKE_MARK) — carries what a label cannot: the branch,
 *     the RED TRUNK SHA, the EVIDENCE RUN SHA, who granted it, and when.
 *
 * Both are required for a grant to read as live (evaluateIssue, below) — a label with no live
 * comment is exactly the state a rolled-back/failed write leaves, and must refuse, not "grant".
 *
 * PURE BY CONSTRUCTION, same posture as migration-grant.js / readiness.js / landed.js /
 * shipguard.js: signals in, verdict out. No git, no network, no `gh`. The caller (tools/colab)
 * measures the red trunk sha and the branch's evidence run and hands them in — this module never
 * reads either off the network itself, so every decision worth pinning lives where `node --test`
 * can reach it directly.
 *
 * WHO IS ALLOWED TO WRITE THE COMMENT is a DIFFERENT question from who is allowed to APPLY the
 * label — identical split to migration-grant.js. This module answers only the READ side
 * (TRUSTED_ASSOCIATIONS), closing the "drive-by comment on a public repo" hole the label narrows
 * but does not by itself close. The human-only WRITE path is enforced in tools/colab via
 * `COLAB_HUMAN=1`, the same bar `cmdPromote` and `cmdMigrationGrant` already hold.
 */

// The wire format — both marks (a leading emoji distinct from migration-grant's 🛢/🚫 AND from
// each other; ci-grant.test.js's four-way collision test pins it), both regexes, and the
// encode/decode pairs — lives in codec/grants.js (#498, epic #496). Re-exported below under the
// names this module always had.
const codec = require('./codec/grants');
const GRANT_MARK = codec.CI_GRANT_MARK;
const REVOKE_MARK = codec.CI_REVOKE_MARK;
const GRANT_RE = codec.CI_GRANT_RE;
const REVOKE_RE = codec.CI_REVOKE_RE;

/** The exact grant-comment body (codec `encodeCiGrant`, canonical tail). Carries strictly more than
 *  migration-grant's equivalent: the TRUNK NAME + RED SHA it was reviewed against, and the
 *  EVIDENCE RUN sha that proved the branch's own head green — both are read back and re-checked
 *  by evaluateIssue, not merely stored for audit. */
function grantCommentBody(branch, trunk, redSha, evidenceSha, host, iso) {
  return codec.encodeCiGrant({ branch, trunk, redSha, evidenceSha, host, at: iso });
}

/** The exact revoke-comment body (codec `encodeCiRevoke`). `branch` is for the audit trail —
 *  revocation itself is NOT branch-scoped (see evaluateIssue doc in migration-grant.js). */
function revokeCommentBody(branch, host, iso) {
  return codec.encodeCiRevoke({ branch, host, at: iso });
}

/**
 * Every GRANT_MARK comment not cancelled by a LATER REVOKE_MARK — identical algorithm to
 * migration-grant.js's liveGrants (see that module's doc for why revocation is NOT author-scoped).
 * Sort is by `createdAt` (GitHub's own timestamp, authoritative — never comment array order).
 *
 * Returns [{branch, trunk, redSha, evidenceSha, host, at, login, authorAssociation}], oldest-first.
 */
function liveGrants(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  let lastRevokeAt = null;
  for (const c of sorted) {
    const body = String(c.body || '').trim();
    if (REVOKE_RE.test(body)) {
      if (lastRevokeAt === null || c.createdAt > lastRevokeAt) lastRevokeAt = c.createdAt;
    }
  }

  const live = [];
  for (const c of sorted) {
    const body = String(c.body || '').trim();
    const m = body.match(GRANT_RE);
    if (!m) continue;
    const at = c.createdAt;
    const cancelled = lastRevokeAt !== null && lastRevokeAt > at;
    if (cancelled) continue;
    live.push({
      branch: m[1],
      trunk: m[2],
      redSha: m[3],
      evidenceSha: m[4],
      host: m[5],
      at,
      login: (c.author && c.author.login) || '',
      authorAssociation: c.authorAssociation || '',
    });
  }
  return live;
}

/** Association values this module treats as trustworthy enough to write a permission a scheduled
 *  driver will rely on — identical set and identical reasoning to migration-grant.js's. */
const { TRUSTED_ASSOCIATIONS, authorIsHuman, labelApplierIsHuman } = require('./trust-humans.js');

/**
 * One issue's verdict for a branch about to ship, against the trunk sha it is CURRENTLY red at
 * and the evidence run CURRENTLY measured for the branch's head.
 *
 * `record` is exactly what `git.ghIssueView(repo, num, ['state', 'labels', 'comments'])` returns,
 * or `null` when that read FAILED — never treat `null` as "no grant" (see migration-grant.js's
 * identical warning; the caller must fail closed on a failed read exactly as hard as on a
 * confirmed absence).
 *
 * `redTrunkSha` is the trunk head sha the caller measured as CURRENTLY red — passed in, never
 * re-derived here, because this module is pure. `evidence` is `{ok, sha}` — `ok` true only for a
 * completed, successful run measured on `branch`'s current head; `sha` is that head's sha. Passing
 * `evidence: null` means the caller's own read of the branch's run FAILED — refuses, same
 * fail-closed posture as a null `record`.
 *
 * `labelName` is passed in rather than imported from labels.js, keeping this module free of any
 * dependency beyond its own two regexes — identical reasoning to migration-grant.js.
 *
 * Order of checks: cheapest/most-fundamental first, each with a distinct actionable reason string.
 *
 * `opts` (#407) — OPTIONAL `{ trust, labelActors }`, the same contract as migration-grant.js's
 * evaluateIssue: absent/undeclared trust keeps the association check byte-identical; declared, the
 * grant author and the label's latest applier must both be listed in trust-humans.
 */
function evaluateIssue(record, branch, trunk, redTrunkSha, evidence, issueNum, labelName, opts) {
  const trust = opts && opts.trust;
  const issue = issueNum;
  if (!record) {
    return { issue, ok: false, grant: null,
      reason: `#${issue} could not be read from the tracker — a failed read is never a grant` };
  }
  if (record.state !== 'OPEN') {
    return { issue, ok: false, grant: null,
      reason: `#${issue} is ${record.state || 'not open'} — a grant expires when its issue closes` };
  }
  const labelNames = (record.labels || []).map((l) => (l && typeof l === 'object' ? l.name : l));
  if (!labelNames.includes(labelName)) {
    return { issue, ok: false, grant: null,
      reason: `#${issue} does not carry the \`${labelName}\` label` };
  }
  const grants = liveGrants(record.comments);
  if (grants.length === 0) {
    return { issue, ok: false, grant: null,
      reason: `#${issue} carries the label but has no live grant comment (revoked, or never posted)` };
  }
  const g = grants[grants.length - 1]; // most recent live grant
  if (g.branch !== branch) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant is bound to branch "${g.branch}", not "${branch}"` };
  }
  const who = authorIsHuman(g, trust);
  if (!who.ok) {
    return { issue, ok: false, grant: g,
      reason: trust && trust.declared
        ? `#${issue}'s grant is not a human's: ${who.reason}`
        : `#${issue}'s grant was posted by ${who.reason}` };
  }
  if (g.trunk !== trunk || g.redSha !== redTrunkSha) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant was reviewed against \`${g.trunk}\`@\`${g.redSha}\`, not the current \`${trunk}\`@\`${redTrunkSha}\` — trunk moved since the review, and the new head was never reviewed` };
  }
  if (!evidence) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant could not be checked against the branch's current CI run — a failed evidence read is never a grant` };
  }
  if (!evidence.ok) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant requires a completed, successful CI run on \`${branch}\`'s current head — none exists` };
  }
  if (evidence.sha !== g.evidenceSha) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant was reviewed against evidence run \`${g.evidenceSha}\`, but \`${branch}\`'s head is now \`${evidence.sha}\` — the branch moved since the human reviewed it` };
  }
  if (trust && trust.declared) {
    // #407 Wanted 2 — the label applier, read last: only once the grant would otherwise pass.
    let actors = null;
    try { actors = opts && typeof opts.labelActors === 'function' ? opts.labelActors(issue) : null; } catch (_) { actors = null; }
    const lab = labelApplierIsHuman(actors, trust, labelName);
    if (!lab.ok) return { issue, ok: false, grant: g, reason: `#${issue}: ${lab.reason}` };
  }
  return { issue, ok: true, grant: g, reason: '' };
}

/**
 * The ship set's verdict — every issue the branch carries, not just the subset that would close.
 * A red-trunk merge cannot be mechanically attributed to one member of a group branch, so if ANY
 * claimed issue lacks a valid grant, the whole set fails — one granted issue must never smuggle an
 * unreviewed red-trunk merge in for its siblings. Identical reasoning to migration-grant.js's
 * evaluateShipSet, including the NON-VACUITY guard: `[].every(...)` is `true` in JavaScript, and a
 * branch with ZERO claimed issues must NOT read as granted by default.
 *
 * `records` maps issue number → the `ghIssueView` result for that issue, or `null` on a failed
 * read (the caller's job, not this function's).
 *
 * `opts` (#504) additionally carries `{ policy, now, redJobs }` for the reviewer role: per issue a
 * live human grant wins, unchanged; otherwise an issue carrying a live reviewer grant is judged by
 * evaluateReviewerIssue (records must then include `title`). `redJobs` is a thunk, called at most
 * once per set. A granted reviewer entry carries `role: 'ci-reviewer'`, `reviewer`, `head`, `cures`.
 */
function evaluateShipSet(issues, records, branch, trunk, redTrunkSha, evidence, labelName, opts) {
  const list = Array.isArray(issues) ? issues : [];
  if (list.length === 0) {
    return { ok: false, granted: [],
      missing: [{ issue: null, reason: 'no claimed issue on this branch could carry a grant' }] };
  }
  const granted = [];
  const missing = [];
  // #504: the red-job set is read at most once per set, and only by an issue whose reviewer grant
  // has cleared every cheaper check.
  let redJobsMemo;
  const redJobs = () => {
    if (redJobsMemo === undefined) {
      try { redJobsMemo = opts && typeof opts.redJobs === 'function' ? opts.redJobs() : null; } catch (_) { redJobsMemo = null; }
    }
    return redJobsMemo;
  };
  for (const n of list) {
    const rec = records ? records[n] : null;
    const v = evaluateIssue(rec, branch, trunk, redTrunkSha, evidence, n, labelName, opts);
    if (v.ok) {
      granted.push({ issue: n, branch: v.grant.branch, by: v.grant.login, at: v.grant.at, redSha: v.grant.redSha, evidenceSha: v.grant.evidenceSha });
      continue;
    }
    // #504: a reviewer grant is consulted only when the human one failed AND the issue carries a
    // live reviewer marker — so an issue with none keeps the human reason byte for byte.
    const hasReviewer = !!rec && liveGrantRecords(rec.comments).some((g) => g.role !== 'human');
    if (!hasReviewer) { missing.push({ issue: n, reason: v.reason }); continue; }
    const r = evaluateReviewerIssue(rec, { branch, trunk, redTrunkSha, evidence, issueNum: n, labelName,
      policy: opts && opts.policy, now: opts && opts.now, redJobs });
    if (r.ok) {
      granted.push({ issue: n, role: REVIEWER_ROLE, reviewer: r.grant.reviewer, head: r.grant.head,
        branch: r.grant.branch, by: r.grant.login, at: r.grant.at, redSha: r.grant.redSha, evidenceSha: r.grant.head,
        cures: parseCures(r.grant.record.cures) });
    } else {
      missing.push({ issue: n, reason: `reviewer grant: ${r.reason}` });
    }
  }
  return { ok: missing.length === 0, granted, missing };
}

/**
 * Whether trunk went green at some point strictly after `priorAtIso` (#229) — pure, taking `runs`
 * as plain data so it is testable without git/gh. Compares INSTANTS via `Date.parse`, never raw ISO
 * strings: `git log --format=%aI` reports the machine's LOCAL UTC offset (`2026-08-15T11:21:46+09:00`)
 * while `gh run list --json createdAt` is always UTC (`2026-08-15T09:57:00Z`). String comparison
 * diverges at the offset digits — `"...T09:57:00Z" > "...T11:21:46+09:00"` reads false even though
 * the run is 7.6 hours LATER as an instant — which can rank a truly later run as "before" the prior
 * grant merge, permanently wedging `stackingVerdict`'s second-grant path once it happens once (#229).
 *
 * `NaN` on either side (an unparseable date) counts as "cannot prove it went green" — the same
 * conservative posture the caller already takes on a JSON parse failure below.
 */
function wentGreenSince(runs, priorAtIso) {
  const priorAt = Date.parse(priorAtIso);
  if (Number.isNaN(priorAt) || !Array.isArray(runs)) return false;
  return runs.some((r) => {
    if (!r || r.status !== 'completed' || r.conclusion !== 'success') return false;
    const at = Date.parse(r.createdAt);
    return !Number.isNaN(at) && at > priorAt;
  });
}

/**
 * Anti-stacking verdict (#105 guard 2) — pure, used by the `colab ci-grant` CREATE path (tools/
 * colab), NOT by ship's read path above (ship only ever re-checks a grant already made; whether a
 * NEW one may be MADE is a separate, narrower question this function answers).
 *
 * `trunkIsRed` — the caller's OWN measurement of whether trunk currently has a completed,
 * successful run. Refuses outright when trunk is NOT red: an exemption with nothing to exempt is a
 * loaded gun sitting on an issue, never a no-op grant.
 *
 * `priorGrantMerge` — `null` when no `CI-Grant:`-trailer merge was found on trunk since the last
 * time trunk was confirmed green (the caller's job to search, via `git log --grep`), or
 * `{sha, at}` naming the most recent one. When one exists, a second grant is refused UNLESS trunk
 * has gone green at some point since that merge (i.e. the red the new grant would exempt is a
 * DIFFERENT, later red than the one the prior grant fixed) — the caller signals this via
 * `redSince`, `null`/absent meaning "still the same continuous red".
 */
function stackingVerdict({ trunkIsRed, priorGrantMerge, redContinuousSincePriorGrant }) {
  if (!trunkIsRed) {
    return { ok: false, reason: 'trunk is not currently red — nothing for a CI grant to exempt' };
  }
  if (priorGrantMerge && redContinuousSincePriorGrant) {
    // `stacked`/`prior` are additive (#477): the cure rule may lift THIS refusal — and only this
    // one — on measured progress (tools/lib/ci-cure.js redSetShrank); the grant CREATE path ignores them.
    return { ok: false, stacked: true, prior: priorGrantMerge, reason: `a CI grant already merged ${priorGrantMerge.sha} against this red trunk and trunk has been red ever since — a second exemption is how a permanently broken repo ships anyway. Revert the bad merge or fix trunk by hand instead of granting again.` };
  }
  return { ok: true, reason: '' };
}

// ============================================================================================
// THE REVIEWER ROLE (#504) — `colab ci-grant <N> --role ci-reviewer`.
//
// Maintainer ruling 2026-10-05: the coordinator agent owns a red trunk end to end, including this
// exemption, where the cure rule (tools/lib/ci-cure.js) still refuses. Mirrors the reviewer
// migration grant (#397, #401): a declared reviewer, a review record, bound to ONE HEAD — and, like
// every CI grant, to ONE red trunk sha. Unlike the migration reviewer it is minted WITHOUT
// COLAB_HUMAN=1, and only because the repo opted in on trunk (`ci-grant: reviewer`). Everything it
// relies on is MEASURED by the reader, never taken from the record:
//   - the issue is open, labelled, and titled `TRUNK RED:` (the work is the red trunk's repair);
//   - trunk is still at the red sha the review names;
//   - the branch's own CI is green at the exact HEAD the review names;
//   - every check the record claims to cure is red on trunk at that sha;
//   - a host-imposed revoke window (`not-before`) has passed.
// Never-stacks is a MINT-time guard (stackingVerdict, as for the human grant): once any exemption
// merges, trunk's head moves, and a grant bound to the old red sha is dead.
//
// THE REVIEWER IDENTITY IS DECLARED, NOT ATTESTED — same caveat as the migration reviewer. The
// anti-forgery properties are the label (write/triage permission) and TRUSTED_ASSOCIATIONS on read.
// ============================================================================================

const REVIEW_GRANT_MARK = codec.CI_REVIEW_GRANT_MARK;
const REVIEW_GRANT_RE = codec.CI_REVIEW_GRANT_RE;
const REVIEWER_ROLE = codec.CI_REVIEWER_ROLE;
const GRANT_ROLES = Object.freeze(['human', REVIEWER_ROLE]);
const REVIEW_RECORD_FIELDS = codec.CI_REVIEW_RECORD_FIELDS;
const REVIEW_RECORD_KEYS = new Set(REVIEW_RECORD_FIELDS.map((f) => f.key));
/** The issue-title prefix a reviewer grant requires: the branch's work IS the red trunk's repair. */
const TRUNK_RED_TITLE_PREFIX = 'TRUNK RED:';
/** `ci-grant:` values in project.yml (#504). Absent = human, the behaviour before #504. */
const GRANT_POLICIES = Object.freeze(['human', 'reviewer']);

/**
 * `ci-grant:` from a parsed project.yml → { policy, declared, valid, reason }. Same shape and the same
 * fail-safe posture as migration-grant.js's parseGrantPolicy: an invalid value reads as `human` (the
 * stricter reading) with `valid: false`, so the audit fails it.
 */
function parseGrantPolicy(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, 'ci-grant');
  const raw = has ? doc['ci-grant'] : undefined;
  if (!has || raw === null || raw === undefined) {
    return { policy: 'human', declared: false, valid: true, reason: 'ci-grant absent — human grants only' };
  }
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (typeof v === 'string' && GRANT_POLICIES.includes(v)) {
    return { policy: v, declared: true, valid: true, reason: `ci-grant: ${v}` };
  }
  return { policy: 'human', declared: true, valid: false,
    reason: `ci-grant is ${JSON.stringify(raw)}, expected ${GRANT_POLICIES.join(' | ')} (omit for human)` };
}

/** The `cures:` value → a list of check names, trimmed, empties dropped. */
function parseCures(value) {
  return String(value == null ? '' : value).split(codec.CI_CURES_SEPARATOR).map((x) => x.trim()).filter(Boolean);
}

/** A list of check names → the `cures:` value. */
function formatCures(list) {
  return (Array.isArray(list) ? list : []).map((x) => String(x).trim()).filter(Boolean).join(`${codec.CI_CURES_SEPARATOR} `);
}

/**
 * Validate a `ci-review` record — from a parsed comment or from CLI flags, the SAME function for
 * both. `marker` (optional) is the parsed first line; given, its head/reviewer/red/role must agree
 * with the record. Returns { valid, passing, problems }; PASSING = valid AND `verdict: pass`.
 */
function validateReviewRecord(rec, marker) {
  const problems = [];
  const r = rec && typeof rec === 'object' ? rec : {};
  for (const k of Object.keys(r)) {
    if (!REVIEW_RECORD_KEYS.has(k)) problems.push(`unknown key "${k}" — a v${codec.CI_REVIEW_RECORD_VERSION} ci-review record has no such field`);
  }
  for (const f of REVIEW_RECORD_FIELDS) {
    const has = Object.prototype.hasOwnProperty.call(r, f.key) && r[f.key] !== undefined && r[f.key] !== null && String(r[f.key]) !== '';
    if (!has) {
      if (f.required) problems.push(`missing "${f.key}"`);
      continue;
    }
    const v = String(r[f.key]);
    if (f.values && !f.values.includes(v)) problems.push(`"${f.key}" is ${JSON.stringify(v)}, expected ${f.values.join(' | ')}`);
    if (f.re && !f.re.test(v)) problems.push(`"${f.key}" is ${JSON.stringify(v)}, expected ${f.hint}`);
  }
  if (r['not-before'] && Number.isNaN(Date.parse(r['not-before']))) problems.push(`"not-before" is ${JSON.stringify(r['not-before'])}, not a parseable instant`);
  if (marker) {
    if (r.head && marker.head !== r.head) problems.push(`record head ${String(r.head).slice(0, 7)} differs from the marker's head ${String(marker.head).slice(0, 7)}`);
    if (r.red && marker.redSha !== r.red) problems.push(`record red ${String(r.red).slice(0, 7)} differs from the marker's red ${String(marker.redSha).slice(0, 7)}`);
    if (r.reviewer && marker.reviewer !== r.reviewer) problems.push(`record reviewer "${r.reviewer}" differs from the marker's reviewer "${marker.reviewer}"`);
    if (marker.role !== REVIEWER_ROLE) problems.push(`marker role is "${marker.role}", expected "${REVIEWER_ROLE}"`);
  }
  const valid = problems.length === 0;
  return { valid, passing: valid && r.verdict === 'pass', problems };
}

/** The exact reviewer-grant comment body. Only v1 fields are written. The caller validates `rec`
 *  (validateReviewRecord) BEFORE calling this. */
function reviewGrantCommentBody(branch, trunk, host, iso, rec) {
  const record = {};
  for (const f of REVIEW_RECORD_FIELDS) if (Object.prototype.hasOwnProperty.call(rec, f.key)) record[f.key] = rec[f.key];
  return codec.encodeCiReviewGrant({ role: rec.role, reviewer: rec.reviewer, branch, head: rec.head,
    trunk, redSha: rec.red, host, at: iso, record });
}

/** A reviewer-grant comment → { marker, record, problems } or null. Syntax from the codec, values
 *  from validateReviewRecord. */
function parseReviewGrant(body) {
  const d = codec.decodeCiReviewGrant(body);
  if (!d) return null;
  const marker = { role: d.role, reviewer: d.reviewer, branch: d.branch, head: d.head, trunk: d.trunk,
    redSha: d.redSha, host: d.host, at: d.at };
  if (!d.record) return { marker, record: null, problems: d.problems };
  const v = validateReviewRecord(d.record, marker);
  return { marker, record: d.record, problems: [...d.problems, ...v.problems] };
}

/**
 * Every live grant of EVERY role — human ones as liveGrants() reads them, plus reviewer grants —
 * after the same revoke rule (a revoke cancels every earlier grant, whichever role, whoever posted
 * it). Oldest-first. Human entries carry role 'human' and liveGrants()'s fields; reviewer entries
 * carry { role, reviewer, branch, head, trunk, redSha, record, problems, valid, passing }.
 */
function liveGrantRecords(comments) {
  const list = Array.isArray(comments) ? comments : [];
  const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  let lastRevokeAt = null;
  for (const c of sorted) {
    if (REVOKE_RE.test(String(c.body || '').trim())) {
      if (lastRevokeAt === null || c.createdAt > lastRevokeAt) lastRevokeAt = c.createdAt;
    }
  }
  const out = [];
  for (const c of sorted) {
    const at = c.createdAt;
    if (lastRevokeAt !== null && lastRevokeAt > at) continue;
    const body = String(c.body || '').trim();
    const base = { at, login: (c.author && c.author.login) || '', authorAssociation: c.authorAssociation || '' };
    const h = body.match(GRANT_RE);
    if (h) {
      out.push({ role: 'human', branch: h[1], trunk: h[2], redSha: h[3], evidenceSha: h[4], host: h[5], ...base });
      continue;
    }
    const r = parseReviewGrant(body);
    if (r) {
      const v = r.record ? validateReviewRecord(r.record, r.marker) : { valid: false, passing: false };
      out.push({ role: r.marker.role, reviewer: r.marker.reviewer, branch: r.marker.branch, head: r.marker.head,
        trunk: r.marker.trunk, redSha: r.marker.redSha, host: r.marker.host, ...base,
        record: r.record, problems: r.problems,
        valid: r.problems.length === 0 && v.valid, passing: r.problems.length === 0 && v.passing });
    }
  }
  return out;
}

/** The label a check is named by in `cures:` and in reasons — `workflow / job`, or the bare job
 *  name when the workflow is unknown (tools/lib/ci-cure.js jobLabel). */
function checkLabel(j) {
  return j && j.workflowName ? `${j.workflowName} / ${j.name}` : String((j && j.name) || '');
}

/**
 * Which claimed cures are NOT red on trunk. `redJobs` is ci-cure.js redJobSet's `[{name,
 * workflowName}]` at the red sha, or null when it could not be measured. A claimed name matches a red
 * job by its full `workflow / job` label, or by its bare job name when exactly one red job carries
 * it (an ambiguous bare name matches nothing — never a guess). Returns { ok, unmatched, reason }.
 */
function curesAreRed(cures, redJobs) {
  if (!Array.isArray(redJobs)) {
    return { ok: false, unmatched: [], reason: 'trunk\'s red checks at that sha could not be measured — an unmeasured red set never confirms a cure' };
  }
  const list = Array.isArray(cures) ? cures : [];
  if (list.length === 0) return { ok: false, unmatched: [], reason: 'the review names no red check it cures' };
  const labelsSet = new Set(redJobs.map(checkLabel));
  const byName = new Map();
  for (const j of redJobs) byName.set(j.name, (byName.get(j.name) || 0) + 1);
  const unmatched = list.filter((c) => !labelsSet.has(c) && byName.get(c) !== 1);
  if (unmatched.length) {
    const red = redJobs.length ? redJobs.map((j) => `\`${checkLabel(j)}\``).join(', ') : 'none';
    return { ok: false, unmatched,
      reason: `the review claims to cure ${unmatched.map((c) => `\`${c}\``).join(', ')}, which ${unmatched.length === 1 ? 'is' : 'are'} not red on trunk at that sha (red: ${red})` };
  }
  return { ok: true, unmatched: [], reason: '' };
}

function titleIsTrunkRed(title) {
  return String(title || '').trimStart().startsWith(TRUNK_RED_TITLE_PREFIX);
}

/**
 * The reviewer-grant verdict for one issue on a ship. `ctx` = { branch, trunk, redTrunkSha, evidence,
 * issueNum, labelName, policy, now, redJobs } where `evidence` is `{ok, sha}` for the branch's CURRENT
 * remote head (or null on a failed read), `now` is an ISO instant or ms (absent = Date.now()), and
 * `redJobs` is a function returning the red-job set at `redTrunkSha` (or null) — called only once
 * everything cheaper has passed. Checks, cheapest first, each with its own reason. `record` must be a
 * ghIssueView result carrying `title`. Returns { ok, grant, reason }.
 */
function evaluateReviewerIssue(record, ctx) {
  const c = ctx || {};
  const issue = c.issueNum;
  const no = (reason, grant = null) => ({ issue, ok: false, grant, reason });
  if (!record) return no(`#${issue} could not be read from the tracker — a failed read is never a grant`);
  if (record.state !== 'OPEN') return no(`#${issue} is ${record.state || 'not open'} — a grant expires when its issue closes`);
  const labelNames = (record.labels || []).map((l) => (l && typeof l === 'object' ? l.name : l));
  if (!labelNames.includes(c.labelName)) return no(`#${issue} does not carry the \`${c.labelName}\` label`);
  if (c.policy !== 'reviewer') return no(`this repo's ci-grant policy is "${c.policy || 'human'}" — a reviewer grant is honoured only under ci-grant: reviewer`);
  if (!titleIsTrunkRed(record.title)) {
    return no(`#${issue}'s title does not start "${TRUNK_RED_TITLE_PREFIX}" — a reviewer CI grant covers only a branch whose work is the red trunk's repair`);
  }
  const reviewer = liveGrantRecords(record.comments).filter((g) => g.role !== 'human');
  if (reviewer.length === 0) return no(`#${issue} has no live reviewer grant (revoked, or never posted)`);
  const g = reviewer[reviewer.length - 1];
  if (g.branch !== c.branch) return no(`#${issue}'s reviewer grant is bound to branch "${g.branch}", not "${c.branch}"`, g);
  if (!TRUSTED_ASSOCIATIONS.has(g.authorAssociation)) {
    return no(`#${issue}'s reviewer grant was posted by ${g.login || '(unknown)'} (${g.authorAssociation || 'unknown association'}) — not a repo owner/member/collaborator`, g);
  }
  if (!g.valid) return no(`#${issue}'s reviewer grant has an invalid review record: ${(g.problems || []).join('; ') || 'unreadable'}`, g);
  if (!g.passing) return no(`#${issue}'s review record says verdict ${g.record && g.record.verdict} — only a pass is a grant`, g);
  if (g.trunk !== c.trunk || g.redSha !== c.redTrunkSha) {
    return no(`#${issue}'s reviewer grant was reviewed against \`${g.trunk}\`@\`${String(g.redSha).slice(0, 7)}\`, not the current \`${c.trunk}\`@\`${String(c.redTrunkSha || '').slice(0, 7)}\` — trunk moved since the review`, g);
  }
  const nb = g.record['not-before'];
  if (nb) {
    const now = c.now === undefined ? Date.now() : (typeof c.now === 'number' ? c.now : Date.parse(c.now));
    if (!(now >= Date.parse(nb))) return no(`#${issue}'s reviewer grant is not yet usable — its revoke window runs until ${nb}`, g);
  }
  if (!c.evidence) return no(`#${issue}'s reviewer grant could not be checked against the branch's current CI run — a failed evidence read is never a grant`, g);
  if (!c.evidence.ok) return no(`#${issue}'s reviewer grant requires a completed, successful CI run on \`${c.branch}\`'s current head — none exists`, g);
  if (String(c.evidence.sha || '').toLowerCase() !== String(g.head).toLowerCase()) {
    return no(`#${issue}'s reviewer grant is bound to ${String(g.head).slice(0, 7)}, \`${c.branch}\` is at ${String(c.evidence.sha || '?').slice(0, 7)} — a new commit voids it`, g);
  }
  let redJobs = null;
  try { redJobs = typeof c.redJobs === 'function' ? c.redJobs() : (c.redJobs === undefined ? null : c.redJobs); } catch (_) { redJobs = null; }
  const cr = curesAreRed(parseCures(g.record.cures), redJobs);
  if (!cr.ok) return no(`#${issue}: ${cr.reason}`, g);
  return { issue, ok: true, grant: g, reason: '' };
}

module.exports = {
  GRANT_MARK, REVOKE_MARK, GRANT_RE, REVOKE_RE,
  grantCommentBody, revokeCommentBody,
  liveGrants, TRUSTED_ASSOCIATIONS,
  evaluateIssue, evaluateShipSet, stackingVerdict, wentGreenSince,
  // #504 — the reviewer role
  REVIEW_GRANT_MARK, REVIEW_GRANT_RE, REVIEWER_ROLE, GRANT_ROLES, REVIEW_RECORD_FIELDS, TRUNK_RED_TITLE_PREFIX,
  GRANT_POLICIES, parseGrantPolicy, parseCures, formatCures, validateReviewRecord, reviewGrantCommentBody,
  parseReviewGrant, liveGrantRecords, checkLabel, curesAreRed, titleIsTrunkRed, evaluateReviewerIssue,
};
