'use strict';
/**
 * The migration-grant marker (#98) — a per-issue, human-only, branch-bound, expiring exemption
 * to `colab ship`'s no-new-migrations precondition (`newMigrations()` in tools/colab).
 *
 * WHY A GRANT EXISTS AT ALL. The no-new-migrations gate is right by default: a schema change
 * merged into trunk is pulled by every other worktree next, and where dev data is shared a bad
 * one costs everyone at once. But it makes one legitimate class of work permanently un-shippable
 * without a person — an issue whose entire deliverable IS a schema change. Under a scheduled
 * driver such an issue parks forever, every tick. This module is the narrow yes: a human reviewed
 * THIS branch's migration and said so, for THIS issue, until THIS issue closes.
 *
 * TWO MARKERS, TWO DIFFERENT JOBS — read together, never one alone:
 *   - a LABEL (`migration-granted`, tools/lib/labels.js) — makes an outstanding grant a cheap
 *     `gh issue list --label` query (requirement 7), and — the load-bearing half — applying a
 *     label on GitHub requires triage/write permission on the repo, so a drive-by commenter on a
 *     public repo cannot manufacture a grant merely by posting a well-formed comment.
 *   - a COMMENT (this module's GRANT_MARK/REVOKE_MARK) — carries what a label cannot: the BRANCH
 *     the grant is bound to (label names cap at 50 chars; this repo's branch names run longer),
 *     who granted it, and when. The comment is the authority; the label is the gate.
 *
 * Both are required for a grant to read as live (evaluateIssue, below) — a label with no live
 * comment is exactly the state a rolled-back/failed write leaves, and must refuse, not "grant".
 *
 * PURE BY CONSTRUCTION, same posture as readiness.js / landed.js / shipguard.js: signals in,
 * verdict out. No git, no network, no `gh`. `tools/colab` has no test harness of its own (see the
 * comment at its `branchCommits` — the reason logic worth pinning lives in tools/lib/*.js instead),
 * so every decision here that is worth getting right on purpose lives in a file `node --test` can
 * reach directly.
 *
 * WHO IS ALLOWED TO WRITE THE COMMENT is a DIFFERENT question from who is allowed to APPLY the
 * label, and this module answers only the second by requiring TRUSTED_ASSOCIATIONS on read —
 * closing the "drive-by comment on a public repo" hole the label already narrows but does not, by
 * itself, close (a repo collaborator could still be a machine account; that is a policy question
 * for the repo, not this module). The human-only property on the WRITE path (nobody but a person
 * may run `colab migration-grant`) is enforced in tools/colab via COLAB_HUMAN=1 — the identical
 * bar `cmdPromote` already holds a production promotion to. This module has no opinion on how the
 * comment got posted; it only judges whether what's on the tracker, right now, is a live grant
 * this branch and this issue may rely on.
 */

/** The two comment markers. STABLE WIRE FORMAT — do not reword casually; `tools/colab` and any
 *  vendored reader parse these verbatim, the same posture as CLAIM_MARK/RELEASE_MARK in tools/colab. */
const GRANT_MARK = '🛢 Migration grant';
const REVOKE_MARK = '🚫 Migration grant revoked';

// Deliberately DIFFERENT leading emoji (not just different trailing text) so neither `startsWith`
// nor either regex can ever match the other mark's body — a revoke mark that merely suffixed the
// grant mark would make every revoke parse as a fresh grant, silently reopening exactly the door
// it was posted to close. Covered by a dedicated test (grant-revoke-mark-collision).
const GRANT_RE = /^🛢 Migration grant — branch `([^`]*)` · host `([^`]*)` · (\S+)/;
const REVOKE_RE = /^🚫 Migration grant revoked — branch `([^`]*)` · host `([^`]*)` · (\S+)/;

/** The exact grant-comment body. Keep in lockstep with GRANT_RE. */
function grantCommentBody(branch, host, iso) {
  return `${GRANT_MARK} — branch \`${branch}\` · host \`${host}\` · ${iso}`
    + ' — this exempts THIS BRANCH only, and expires when this issue closes.';
}

/** The exact revoke-comment body. Keep in lockstep with REVOKE_RE. `branch` is the branch named in
 *  the record for the audit trail — revocation itself is NOT branch-scoped (see evaluateIssue doc). */
function revokeCommentBody(branch, host, iso) {
  return `${REVOKE_MARK} — branch \`${branch}\` · host \`${host}\` · ${iso}`
    + ' — every grant on this issue up to this point is cancelled.';
}

/**
 * Every GRANT_MARK comment not cancelled by a LATER REVOKE_MARK — whoever posted the revoke.
 *
 * Deliberately NOT author-scoped, unlike liveClaimComments() in tools/colab: a claim is a
 * per-identity assertion racing other identities, so cancellation there is scoped to "the same
 * author can undo their own claim." A grant has no race to settle — it is a standing authorization
 * a human is meant to be able to pull the instant it looks wrong, from any trusted account, on any
 * machine. Scoping revocation by author would let a grant outlive a revoke posted from the other
 * maintainer's login or the other machine, which is exactly backwards for a safety gate.
 *
 * Sort is by `createdAt` (GitHub's own timestamp, sub-second, authoritative — never comment order
 * in the array, which is not guaranteed). A grant AFTER the latest revoke is live again: grant,
 * revoke, grant is "currently granted," not "permanently revoked."
 *
 * Returns [{branch, host, at, login, authorAssociation}], oldest-first — a live grant is the LAST
 * entry a caller cares about, but the whole ordered list is returned so a caller (e.g. `--list`)
 * can show history, not just the current verdict.
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
      host: m[2],
      at,
      login: (c.author && c.author.login) || '',
      authorAssociation: c.authorAssociation || '',
    });
  }
  return live;
}

/** Association values GitHub reports (`gh issue view --json comments`'s `authorAssociation`) that
 *  this module treats as trustworthy enough to write a permission a scheduled driver will rely on.
 *  This closes a DIFFERENT hole than COLAB_HUMAN (tools/colab): that gates WHO MAY WRITE the
 *  comment (a human, via the CLI); this gates WHOSE COMMENT ship WILL HONOR ON READ — closing the
 *  gap a public repo has by default, where anyone can post a perfectly-formed comment by hand. */
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * One issue's verdict for a branch about to ship. `record` is exactly what
 * `git.ghIssueView(repo, num, ['state', 'labels', 'comments'])` returns, or `null` when that read
 * FAILED — never treat `null` as "no grant"; that conflates "could not confirm" with "confirmed
 * absent," and the caller (tools/colab) must fail closed on the former exactly as hard as the latter.
 *
 * `labelName` is passed in rather than imported from labels.js, keeping this module free of any
 * dependency beyond its own two regexes — the caller (tools/colab) already has labels.js loaded
 * and is the one place that should know the label's name.
 *
 * Order of checks is deliberate: cheapest/most-fundamental failures first, and each has a distinct,
 * actionable reason string — an operator or a scheduled driver's park-and-say-once log reads this
 * directly, so vague reasons cost a person re-deriving what to do.
 */
function evaluateIssue(record, branch, issueNum, labelName) {
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
  if (!TRUSTED_ASSOCIATIONS.has(g.authorAssociation)) {
    return { issue, ok: false, grant: g,
      reason: `#${issue}'s grant was posted by ${g.login || '(unknown)'} (${g.authorAssociation || 'unknown association'}) — not a repo owner/member/collaborator` };
  }
  return { issue, ok: true, grant: g, reason: '' };
}

/**
 * The ship set's verdict (#98 requirement 5) — every issue the branch carries, not just the
 * subset that would close (`closeIssues`). A migration cannot be mechanically attributed to one
 * member of a group branch, so if ANY claimed issue lacks a valid grant, the whole set fails —
 * one granted issue must never smuggle an unreviewed migration in for its siblings.
 *
 * NON-VACUITY, on purpose: `[].every(...)` is `true` in JavaScript, and a branch carrying a
 * migration with ZERO claimed issues must NOT read as granted by default — there is no issue for
 * a human to have reviewed against. Refuses explicitly rather than falling through an empty loop.
 *
 * `records` maps issue number → the `ghIssueView` result for that issue, or `null` on a failed
 * read (the caller's job, not this function's — see tools/colab's shipMigrationGrants).
 */
function evaluateShipSet(issues, records, branch, labelName) {
  const list = Array.isArray(issues) ? issues : [];
  if (list.length === 0) {
    return { ok: false, granted: [],
      missing: [{ issue: null, reason: 'no claimed issue on this branch could carry a grant' }] };
  }
  const granted = [];
  const missing = [];
  for (const n of list) {
    const v = evaluateIssue(records ? records[n] : null, branch, n, labelName);
    if (v.ok) granted.push({ issue: n, branch: v.grant.branch, by: v.grant.login, at: v.grant.at });
    else missing.push({ issue: n, reason: v.reason });
  }
  return { ok: missing.length === 0, granted, missing };
}

// ============================================================================================
// ROLE-TAGGED GRANTS (#397) and the repo policy that says whether a reviewer may grant (#398).
//
// WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT. A human grant (above) is a label plus a
// comment, and the comment says nothing about WHO decided: one minted through a dashboard is
// byte-identical to one any trusted account could post. The reviewer role gives that decision a
// shape — a declared reviewer identity, and a REVIEW RECORD (verdict, checklist result, which
// escalation condition was checked, the CI round-trip result, the reviewed HEAD) — so a later
// reader can check the review rather than trust the comment.
//
// NOTHING IN THIS BLOCK OPENS `colab ship`'s GATE. liveGrants()/evaluateIssue()/evaluateShipSet()
// above read ONLY the human marker, and the reviewer marker is built so GRANT_RE can never match
// it (different leading emoji — the same collision discipline as grant vs revoke). The accessor
// below, evaluateReviewerGrant(), is exported for the ship-side reader to call once it exists;
// until then a reviewer grant is recorded, listed, and inert.
//
// THE REVIEWER IDENTITY IS DECLARED, NOT ATTESTED. The only anti-forgery properties are the same
// two the human grant has — the label needs write/triage permission, and TRUSTED_ASSOCIATIONS on
// read. A reader must not treat `reviewer:` as proof of who reviewed; it is who the grant SAYS
// reviewed. Likewise `ci-roundtrip:` is the reviewer's report — a gate should re-verify CI for
// `head` itself rather than rely on the recorded value.
// ============================================================================================

/** The reviewer grant's first-line mark. STABLE WIRE FORMAT. Distinct leading emoji on purpose:
 *  GRANT_RE (the human marker, the one today's ship gate reads) must never match a reviewer grant. */
const REVIEW_GRANT_MARK = '🔎 Migration review grant';
const REVIEWER_ROLE = 'migration-reviewer';
const GRANT_ROLES = Object.freeze(['human', REVIEWER_ROLE]);

const REVIEW_GRANT_RE = /^🔎 Migration review grant — role `([^`]*)` · reviewer `([^`]*)` · branch `([^`]*)` · head `([^`]*)` · host `([^`]*)` · (\S+)/;

/** The fenced block's info string — the record is found by it, never by position. */
const REVIEW_RECORD_FENCE = 'migration-review';
const REVIEW_RECORD_VERSION = '1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const REVIEWER_ID_RE = /^[A-Za-z0-9._@-]+$/;
const CONDITION_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Every key a v1 record may carry, and what each accepts. `required: false` keys may be absent.
 *  Order here is the order reviewGrantCommentBody() writes them in. */
const REVIEW_RECORD_FIELDS = Object.freeze([
  { key: 'v', required: true, values: [REVIEW_RECORD_VERSION] },
  { key: 'role', required: true, values: [REVIEWER_ROLE] },
  { key: 'reviewer', required: true, re: REVIEWER_ID_RE, hint: 'letters, digits, . _ @ -' },
  { key: 'head', required: true, re: SHA40_RE, hint: 'a full 40-hex commit sha' },
  { key: 'verdict', required: true, values: ['approve', 'reject'] },
  { key: 'checklist', required: true, values: ['pass', 'fail'] },
  { key: 'checklist-items', required: false, re: /^\d+\/\d+$/, hint: 'N/M, e.g. 7/7' },
  { key: 'escalation', required: true, re: CONDITION_ID_RE, hint: 'a condition id, lowercase-hyphenated' },
  { key: 'escalation-result', required: true, values: ['clear', 'escalated'] },
  { key: 'ci-roundtrip', required: true, values: ['pass', 'fail', 'pending'] },
  { key: 'ci-run', required: false, re: /^\S+$/, hint: 'a run id or URL, no spaces' },
]);
const REVIEW_RECORD_KEYS = new Set(REVIEW_RECORD_FIELDS.map((f) => f.key));

/**
 * Validate a record object (key → string) — from a parsed comment or from CLI flags, the SAME
 * function for both, so the mint path and the read path can never disagree about what is valid.
 * `marker` (optional) is the parsed first line; when given, `head` and `reviewer` must agree with
 * it — a record reviewing one sha under a marker naming another is not a review of anything.
 *
 * Returns { valid, passing, problems }. VALID = well-formed. PASSING = valid AND the review said
 * yes on every axis (approve · checklist pass · escalation clear · CI round-trip pass). The two are
 * separate because a well-formed failing review is a real, recordable outcome — just never a grant.
 */
function validateReviewRecord(rec, marker) {
  const problems = [];
  const r = rec && typeof rec === 'object' ? rec : {};
  for (const k of Object.keys(r)) {
    if (!REVIEW_RECORD_KEYS.has(k)) problems.push(`unknown key "${k}" — a v${REVIEW_RECORD_VERSION} review record has no such field`);
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
  if (r['checklist-items'] && /^\d+\/\d+$/.test(r['checklist-items'])) {
    const [a, b] = String(r['checklist-items']).split('/').map(Number);
    if (b === 0 || a > b) problems.push(`"checklist-items" is ${r['checklist-items']} — N must be ≤ M and M > 0`);
  }
  if (marker) {
    if (r.head && marker.head !== r.head) problems.push(`record head ${String(r.head).slice(0, 7)} differs from the marker's head ${String(marker.head).slice(0, 7)}`);
    if (r.reviewer && marker.reviewer !== r.reviewer) problems.push(`record reviewer "${r.reviewer}" differs from the marker's reviewer "${marker.reviewer}"`);
    if (marker.role !== REVIEWER_ROLE) problems.push(`marker role is "${marker.role}", expected "${REVIEWER_ROLE}"`);
    if (!SHA40_RE.test(String(marker.head || ''))) problems.push(`marker head "${marker.head}" is not a full 40-hex sha`);
  }
  const valid = problems.length === 0;
  const passing = valid && r.verdict === 'approve' && r.checklist === 'pass'
    && r['escalation-result'] === 'clear' && r['ci-roundtrip'] === 'pass';
  return { valid, passing, problems };
}

/** Why a VALID record is not passing, as one line — or '' when it passes. */
function reviewRecordFailure(rec) {
  const why = [];
  if (rec.verdict !== 'approve') why.push(`verdict ${rec.verdict}`);
  if (rec.checklist !== 'pass') why.push(`checklist ${rec.checklist}`);
  if (rec['escalation-result'] !== 'clear') why.push(`escalation ${rec.escalation} ${rec['escalation-result']}`);
  if (rec['ci-roundtrip'] !== 'pass') why.push(`CI round-trip ${rec['ci-roundtrip']}`);
  return why.join(', ');
}

/**
 * The exact reviewer-grant comment body: marker line, blank line, fenced record. Keep in lockstep
 * with REVIEW_GRANT_RE and parseReviewRecord. `rec` must carry at least role/reviewer/head; the
 * caller (tools/colab) validates it with validateReviewRecord BEFORE calling this.
 */
function reviewGrantCommentBody(branch, host, iso, rec) {
  const head = `${REVIEW_GRANT_MARK} — role \`${rec.role}\` · reviewer \`${rec.reviewer}\` · branch \`${branch}\``
    + ` · head \`${rec.head}\` · host \`${host}\` · ${iso}`
    + ' — bound to this HEAD: any new commit voids it; expires when this issue closes.';
  const lines = [];
  for (const f of REVIEW_RECORD_FIELDS) {
    const v = rec[f.key];
    if (v === undefined || v === null || String(v) === '') continue;
    lines.push(`${f.key}: ${v}`);
  }
  return `${head}\n\n\`\`\`${REVIEW_RECORD_FENCE}\n${lines.join('\n')}\n\`\`\``;
}

/**
 * Parse a reviewer-grant comment body → { marker, record, problems } or null when the first line
 * is not a reviewer-grant marker at all. The record is the FIRST fenced block whose info string is
 * exactly `migration-review`; text outside it is ignored. A marker with no such block, or a block
 * with a malformed line, returns problems — never a record silently missing fields.
 */
function parseReviewGrant(body) {
  const text = String(body || '').replace(/\r\n/g, '\n').trim();
  const m = text.match(REVIEW_GRANT_RE);
  if (!m) return null;
  const marker = { role: m[1], reviewer: m[2], branch: m[3], head: m[4], host: m[5], at: m[6] };
  const problems = [];
  const fence = new RegExp('^```' + REVIEW_RECORD_FENCE + '[ \\t]*\\n([\\s\\S]*?)^```[ \\t]*$', 'm');
  const fm = text.match(fence);
  if (!fm) {
    problems.push(`no \`\`\`${REVIEW_RECORD_FENCE} block — a reviewer grant without its review record is not a grant`);
    return { marker, record: null, problems };
  }
  const record = {};
  for (const raw of fm[1].split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const kv = line.match(/^([a-z][a-z-]*):\s*(.*)$/);
    if (!kv) { problems.push(`record line ${JSON.stringify(line)} is not "key: value"`); continue; }
    if (Object.prototype.hasOwnProperty.call(record, kv[1])) { problems.push(`"${kv[1]}" appears twice`); continue; }
    record[kv[1]] = kv[2].trim();
  }
  const v = validateReviewRecord(record, marker);
  problems.push(...v.problems);
  return { marker, record, problems };
}

/**
 * Every live grant of EVERY role — the human ones liveGrants() returns, plus reviewer grants —
 * after the same revoke rule (a revoke cancels every earlier grant, whichever role, whoever posted
 * it). Oldest-first. Reviewer entries carry { role, reviewer, head, record, problems, valid,
 * passing }; human entries carry role 'human'. For listing and for evaluateReviewerGrant — the
 * ship gate's evaluateIssue deliberately keeps reading liveGrants() (human only).
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
    if (h) { out.push({ role: 'human', branch: h[1], host: h[2], ...base }); continue; }
    const r = parseReviewGrant(body);
    if (r) {
      const v = r.record ? validateReviewRecord(r.record, r.marker) : { valid: false, passing: false };
      out.push({
        role: r.marker.role, reviewer: r.marker.reviewer, branch: r.marker.branch, head: r.marker.head,
        host: r.marker.host, ...base, record: r.record, problems: r.problems,
        valid: r.problems.length === 0 && v.valid, passing: r.problems.length === 0 && v.passing,
      });
    }
  }
  return out;
}

/**
 * HEAD binding. A human grant is branch-bound, not HEAD-bound (unchanged since #98) → unbound, ok.
 * A reviewer grant covers exactly the commit it reviewed: ok only when `branchHeadSha` is a full
 * 40-hex sha equal (case-insensitively) to the grant's head. A short or missing sha is NOT ok —
 * "could not confirm the HEAD" is never read as "the HEAD matches", and never a prefix match.
 */
function grantHeadBinding(grant, branchHeadSha) {
  if (!grant || grant.role === 'human' || grant.role === undefined) return { bound: false, ok: true, reason: '' };
  const want = String(grant.head || '').toLowerCase();
  const have = String(branchHeadSha || '').toLowerCase();
  if (!SHA40_RE.test(have)) {
    return { bound: true, ok: false, reason: `cannot confirm the branch HEAD (${have ? `"${have}" is not a full sha` : 'no sha given'}) — a reviewer grant is bound to one commit` };
  }
  if (want !== have) {
    return { bound: true, ok: false, reason: `reviewer grant is bound to ${want.slice(0, 7)}, branch is at ${have.slice(0, 7)} — a new commit voids it` };
  }
  return { bound: true, ok: true, reason: '' };
}

/** `migration-grant:` values, in project.yml (#398). Absent = human, today's behaviour. */
const GRANT_POLICIES = Object.freeze(['human', 'reviewer']);

/**
 * `migration-grant:` from a parsed project.yml → { policy, declared, valid, reason }. A flat key,
 * NOT nested under `migrations:` (which stays a list of path prefixes — three readers depend on
 * that shape, and a map there would fail every descriptor not yet migrated). An invalid value is
 * read as `human` — the stricter reading, same posture as parseShipBatch — and `valid: false` so
 * the audit fails it.
 */
function parseGrantPolicy(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, 'migration-grant');
  const raw = has ? doc['migration-grant'] : undefined;
  if (!has || raw === null || raw === undefined) {
    return { policy: 'human', declared: false, valid: true, reason: 'migration-grant absent — human grants only' };
  }
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (typeof v === 'string' && GRANT_POLICIES.includes(v)) {
    return { policy: v, declared: true, valid: true, reason: `migration-grant: ${v}` };
  }
  return { policy: 'human', declared: true, valid: false,
    reason: `migration-grant is ${JSON.stringify(raw)}, expected ${GRANT_POLICIES.join(' | ')} (omit for human)` };
}

/**
 * The reviewer-grant verdict for one issue — the accessor the ship-side reader will call. NOT
 * called by `colab ship` today. `ctx` = { branch, headSha, issueNum, labelName, policy } where
 * `policy` is parseGrantPolicy(...).policy. Checks, cheapest/most-fundamental first, each with its
 * own reason: read failed · not open · no label · policy not `reviewer` · no live reviewer grant ·
 * branch mismatch · untrusted author · record invalid · record not passing · HEAD binding.
 * The CI round-trip is checked here only as RECORDED; re-verifying it against live CI for `head`
 * is the gate's job. Returns { ok, grant, reason, checks: { policy, marker, head } }.
 */
function evaluateReviewerGrant(record, ctx) {
  const c = ctx || {};
  const issue = c.issueNum;
  const checks = { policy: false, marker: false, head: false };
  const no = (reason, grant = null) => ({ issue, ok: false, grant, reason, checks });
  if (!record) return no(`#${issue} could not be read from the tracker — a failed read is never a grant`);
  if (record.state !== 'OPEN') return no(`#${issue} is ${record.state || 'not open'} — a grant expires when its issue closes`);
  const labelNames = (record.labels || []).map((l) => (l && typeof l === 'object' ? l.name : l));
  if (!labelNames.includes(c.labelName)) return no(`#${issue} does not carry the \`${c.labelName}\` label`);
  if (c.policy !== 'reviewer') return no(`this repo's migration-grant policy is "${c.policy || 'human'}" — a reviewer grant is honoured only under migration-grant: reviewer`);
  checks.policy = true;
  const reviewer = liveGrantRecords(record.comments).filter((g) => g.role !== 'human');
  if (reviewer.length === 0) return no(`#${issue} has no live reviewer grant (revoked, or never posted)`);
  const g = reviewer[reviewer.length - 1];
  if (g.branch !== c.branch) return no(`#${issue}'s reviewer grant is bound to branch "${g.branch}", not "${c.branch}"`, g);
  if (!TRUSTED_ASSOCIATIONS.has(g.authorAssociation)) {
    return no(`#${issue}'s reviewer grant was posted by ${g.login || '(unknown)'} (${g.authorAssociation || 'unknown association'}) — not a repo owner/member/collaborator`, g);
  }
  if (!g.valid) return no(`#${issue}'s reviewer grant has an invalid review record: ${(g.problems || []).join('; ') || 'unreadable'}`, g);
  if (!g.passing) return no(`#${issue}'s review record does not pass: ${reviewRecordFailure(g.record)}`, g);
  checks.marker = true;
  const hb = grantHeadBinding(g, c.headSha);
  if (!hb.ok) return no(`#${issue}: ${hb.reason}`, g);
  checks.head = true;
  return { issue, ok: true, grant: g, reason: '', checks };
}

module.exports = {
  GRANT_MARK, REVOKE_MARK, GRANT_RE, REVOKE_RE,
  grantCommentBody, revokeCommentBody,
  liveGrants, TRUSTED_ASSOCIATIONS,
  evaluateIssue, evaluateShipSet,
  // #397 — role-tagged grants
  REVIEW_GRANT_MARK, REVIEW_GRANT_RE, REVIEWER_ROLE, GRANT_ROLES,
  REVIEW_RECORD_FENCE, REVIEW_RECORD_FIELDS,
  validateReviewRecord, reviewRecordFailure, reviewGrantCommentBody, parseReviewGrant,
  liveGrantRecords, grantHeadBinding, evaluateReviewerGrant,
  // #398 — repo policy
  GRANT_POLICIES, parseGrantPolicy,
};
