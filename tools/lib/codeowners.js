'use strict';
/**
 * #350 — the core-path review rule for `colab ship` (CONVENTIONS.md §2, "Core paths").
 *
 * A branch whose diff touches a path the TARGET's CODEOWNERS covers does not squash directly: ship
 * opens a PR and pauses, and landing resumes once an account other than the author has approved the
 * branch's current head. Everything else keeps the machine-only landing.
 *
 * "Core" is whatever CODEOWNERS covers. The handbook tells a repo to write that file BY KIND (the
 * gate, merge behaviour, permissions, the descriptor, irreversible state), so this module adds no
 * kind list of its own. A second list here would be a second source of truth for the same fact.
 *
 * This module is PURE: text and arrays in, verdicts out. All git and gh I/O stays in the CLI, where
 * `tools/colab` has no test harness. The same split docs-only.js uses.
 *
 * Every doubt resolves toward "the rule is active". A false "active" costs one PR and one approval.
 * A false "inert" lands a change to the gate that nobody else looked at.
 */

/** Where the forge looks for the file, in its own order. The first one present wins. */
const CODEOWNERS_PATHS = Object.freeze(['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']);

/**
 * Parse CODEOWNERS text into `{ rules: [{ pattern, owners, line, re }], warnings: [] }`.
 * `re` is null for a pattern this module will not match (see `compile`), and such a line is recorded
 * in `warnings`, never silently widened into a match.
 */
function parse(text) {
  const rules = [];
  const warnings = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    // An unescaped `#` starts a comment. `\#` is a literal hash.
    let s = '';
    for (let k = 0; k < raw.length; k++) {
      if (raw[k] === '\\' && raw[k + 1] === '#') { s += '#'; k++; continue; }
      if (raw[k] === '#') break;
      s += raw[k];
    }
    const parts = s.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return;
    const [pattern, ...owners] = parts;
    const re = compile(pattern);
    if (!re) warnings.push(`line ${i + 1}: "${pattern}" uses syntax the forge does not support in CODEOWNERS (! or [ ]) — it matches nothing`);
    rules.push({ pattern, owners, line: i + 1, re });
  });
  return { rules, warnings };
}

/**
 * Compile one CODEOWNERS pattern (the forge's gitignore subset) to a RegExp over repo-relative paths.
 * - a leading `/` anchors at the repo root; so does any `/` in the middle;
 * - a pattern with no `/` except a trailing one matches at any depth;
 * - a pattern that names a directory also covers everything under it;
 * - `*` does not cross `/`, `**` does, `?` is one non-`/` character.
 * Negation (`!`) and character ranges (`[ ]`) are not supported by the forge here: returns null.
 */
function compile(pattern) {
  let p = String(pattern);
  if (p.startsWith('!') || /[[\]]/.test(p)) return null;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith('/') || p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  if (p === '' || p === '*' || p === '**') return /^.+$/;
  let body = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      i++;
      if (p[i + 1] === '/') { i++; body += '(?:.*/)?'; } else { body += '.*'; }
    } else if (c === '*') {
      body += '[^/]*';
    } else if (c === '?') {
      body += '[^/]';
    } else {
      body += c.replace(/[.+^${}()|\\]/g, '\\$&');
    }
  }
  const lead = anchored ? '^' : '^(?:.*/)?';
  // A name matches the file itself, or — as a directory — everything under it. `dir/*` stops at one
  // level because its last segment is `[^/]*` and there is no second chance after it.
  const tail = /\[\^\/\]\*$/.test(body) && !/\.\*$/.test(body) ? '$' : '(?:/.*)?$';
  return new RegExp(lead + body + (dirOnly ? '/.*$' : tail));
}

/** Owners of `path` under `rules`: the LAST matching rule wins. `[]` = unowned (or carved out). */
function ownerOf(rules, p) {
  let owners = [];
  for (const r of rules || []) if (r.re && r.re.test(p)) owners = r.owners;
  return owners;
}

/** The subset of `paths` that CODEOWNERS covers with at least one owner, each with its owners. */
function corePaths(rules, paths) {
  const out = [];
  for (const p of [...new Set(paths || [])]) {
    const owners = ownerOf(rules, p);
    if (owners.length) out.push({ path: p, owners });
  }
  return out;
}

const norm = (s) => String(s || '').replace(/^@/, '').toLowerCase();

/**
 * Is the rule inert on this repo? `authors` = the logins that count as the author of this landing
 * (the forge login running ship, plus a branch-prefix login when it differs).
 *
 * Inert when the file owns nothing, or when every owner token is one of the authors. That is the
 * single-operator repo, which lands as it does today. Anything else is active: another login, a team
 * (`@org/team`, which cannot be expanded without a network call, so it counts as someone else), an
 * email address. With no known author at all the rule is never inert while anything is owned.
 */
function inert(rules, authors) {
  const owned = (rules || []).filter((r) => r.owners.length);
  if (!owned.length) return { inert: true, reason: 'CODEOWNERS owns no path' };
  const me = new Set((authors || []).filter(Boolean).map(norm));
  if (!me.size) return { inert: false, reason: 'the author\'s forge login is unknown, so nobody can be ruled out' };
  const others = [...new Set(owned.flatMap((r) => r.owners).filter((o) => !me.has(norm(o))))];
  if (!others.length) return { inert: true, reason: `CODEOWNERS names only the author (${[...me].map((m) => '@' + m).join(', ')})` };
  return { inert: false, reason: `CODEOWNERS names ${others.join(', ')}` };
}

/**
 * #483 — the owner (user or org) of a forge remote URL, lowercased, or null when the URL has no
 * `<owner>/<repo>` shape this can read. Handles `https://host/owner/repo(.git)`,
 * `ssh://git@host[:port]/owner/repo` and the scp form `git@host:owner/repo`.
 */
function remoteOwner(url) {
  const s = String(url || '').trim().replace(/\/+$/, '').replace(/\.git$/, '');
  let m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/([^/]+)\/[^/]+$/i.exec(s);
  if (!m) m = /^[^@/\s]+@[^:/\s]+:([^/]+)\/[^/]+$/.exec(s);
  return m ? m[1].toLowerCase() : null;
}

const TEAM_RE = /^@([^/\s@]+)\/[^/\s]+$/;

/**
 * #483 — the owner tokens a FORK must not be bound by: teams (`@org/team`) of an org other than
 * the fork's own owner (`ownOrg`). A fork inherits the upstream's CODEOWNERS unchanged, and a team
 * of another org cannot review in the fork at all, so honouring it would turn every landing into a
 * human gate nobody here decided on (CONVENTIONS.md §2, *Core paths*, "A fork's inherited
 * CODEOWNERS").
 *
 * Narrow on purpose — every doubt still resolves toward review: not a fork, or the fork's owner
 * unknown, drops nothing; a login or an email is never dropped (a person can be a collaborator
 * anywhere); a team of the fork's own org is kept.
 */
function foreignTeams(rules, { fork, ownOrg } = {}) {
  if (!fork || !ownOrg) return [];
  const own = String(ownOrg).toLowerCase();
  const out = new Set();
  for (const r of rules || []) {
    for (const o of r.owners) {
      const m = TEAM_RE.exec(o);
      if (m && m[1].toLowerCase() !== own) out.add(o);
    }
  }
  return [...out];
}

/**
 * #483 — `rules` with `foreignTeams` removed from every rule's owners. A rule left with no owner
 * stays in place and, like an ownerless line, carves its paths out (the last match still wins), so
 * an inherited `* @upstream/team` leaves the fork's own later lines exactly as they were.
 * Returns `{ rules, dropped }`; `dropped` is `[]` (and `rules` the input) when nothing applies.
 */
function dropForeignTeams(rules, ctx) {
  const dropped = foreignTeams(rules, ctx);
  if (!dropped.length) return { rules, dropped };
  const gone = new Set(dropped);
  return { rules: (rules || []).map((r) => ({ ...r, owners: r.owners.filter((o) => !gone.has(o)) })), dropped };
}

/** #483: the one-line reason a fork's foreign teams were ignored — shared by every reader. */
function foreignNote(dropped, ctx) {
  return `fork of an upstream: ignored ${dropped.join(', ')} — team(s) of an org other than ${ctx.ownOrg}, inherited and unable to review here (#483)`;
}

/**
 * Has a PR been approved by someone other than its author, AT `headSha`?
 *
 * `reviews`: the forge's review list, `[{ author: { login }, state, submittedAt, commit: { oid } }]`.
 * COMMENTED and PENDING carry no verdict and are dropped; the rest keep only the LATEST per reviewer.
 * Any latest CHANGES_REQUESTED blocks. Otherwise an APPROVED from a reviewer who is neither the PR's
 * author nor any of `authors`, whose commit is `headSha`, approves. An approval of an older head is
 * stale: the reviewer did not see what would land.
 *
 * Fleets that share ONE forge account cannot approve each other through this — to the forge they are
 * one author, and so they are here. That is the rule working, not a gap: a factory is an account.
 */
function approvalVerdict(reviews, { prAuthor, authors = [], headSha }) {
  const excluded = new Set([prAuthor, ...authors].filter(Boolean).map(norm));
  const latest = new Map();
  const sorted = [...(reviews || [])].sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));
  for (const r of sorted) {
    if (!r || !r.author || !r.author.login) continue;
    if (r.state !== 'APPROVED' && r.state !== 'CHANGES_REQUESTED' && r.state !== 'DISMISSED') continue;
    latest.set(norm(r.author.login), r);
  }
  const blocking = [...latest.values()].filter((r) => r.state === 'CHANGES_REQUESTED');
  if (blocking.length) return { ok: false, by: null, reason: `changes requested by ${blocking.map((r) => r.author.login).join(', ')}` };
  const approvals = [...latest.values()].filter((r) => r.state === 'APPROVED');
  const foreign = approvals.filter((r) => !excluded.has(norm(r.author.login)));
  const current = foreign.find((r) => r.commit && r.commit.oid && headSha && r.commit.oid === headSha);
  if (current) return { ok: true, by: current.author.login, reason: `approved by ${current.author.login} at ${String(headSha).slice(0, 7)}` };
  if (foreign.length) return { ok: false, by: null, reason: `approval by ${foreign.map((r) => r.author.login).join(', ')} is for an older head, not ${String(headSha || '?').slice(0, 7)} — stale` };
  if (approvals.length) return { ok: false, by: null, reason: 'only the author\'s own account has approved — a non-author approval is required' };
  return { ok: false, by: null, reason: 'no approval yet' };
}

/**
 * #351 — the core-path verdict for a BRANCHLESS trunk-direct unit (`colab ship --direct`).
 *
 * A branch that touches a core path pauses on a PR (#350). A trunk-direct unit has no branch and so no
 * PR, and its commits are already on trunk. Ruling A on #351: `ship --direct` refuses to close such a
 * unit, and the operator redoes the change on a branch, where #350's review applies. So there are
 * only three verdicts here: 'inert' | 'not-core' | 'refuse'. No 'pending', no 'approved'.
 *
 * `files`: the CODEOWNERS to honour, as `{ path, ref, text }` or null. The caller passes the one on
 * trunk BEFORE the unit's first commit and the one on trunk NOW. For `--direct` the target already
 * contains the unit, so reading only the current file would let a unit exempt itself by deleting or
 * narrowing CODEOWNERS in its own commit. So a path is core if EITHER active file covers it, and the
 * rule is inert only when every file present is inert. Identical texts count once.
 * `changed`: every path the unit's commits touched, or null when they could not be listed. Null
 * refuses while the rule is active: an unbounded unit cannot be shown to avoid core paths.
 * `fork`: `{ fork, ownOrg }` (#483) — on a fork, teams of another org are dropped from both files
 * before anything else is read (`dropForeignTeams`). Absent = nothing dropped.
 */
function directVerdict({ files, authors, changed, fork = null }) {
  const out = { active: false, inertReason: null, codeownersPath: null, warnings: [], corePaths: [], verdict: 'inert', detail: '' };
  const seen = new Set();
  const present = (files || []).filter((f) => f && !seen.has(f.text) && seen.add(f.text));
  if (!present.length) { out.inertReason = 'no CODEOWNERS on trunk before or after the unit'; out.detail = `inert: ${out.inertReason}`; return out; }
  const byPath = new Map();
  const inertReasons = [];
  const activeReasons = [];
  for (const f of present) {
    const parsed = parse(f.text);
    for (const w of parsed.warnings) out.warnings.push(`${f.path}@${f.ref}: ${w}`);
    // #483: a fork's inherited foreign-org teams bind neither file.
    const { rules, dropped } = dropForeignTeams(parsed.rules, fork || {});
    if (dropped.length) out.warnings.push(`${f.path}@${f.ref}: ${foreignNote(dropped, fork)}`);
    const iv = inert(rules, authors);
    if (iv.inert) { inertReasons.push(`${f.path}@${f.ref}: ${iv.reason}`); continue; }
    out.active = true;
    if (!out.codeownersPath) out.codeownersPath = f.path;
    activeReasons.push(iv.reason);
    for (const c of corePaths(rules, changed || [])) {
      const prev = byPath.get(c.path);
      byPath.set(c.path, prev ? [...new Set([...prev, ...c.owners])] : c.owners);
    }
  }
  if (!out.active) { out.inertReason = inertReasons.join('; '); out.detail = `inert: ${out.inertReason}`; return out; }
  if (changed === null || changed === undefined) {
    out.verdict = 'refuse';
    out.detail = `the core-path rule is active (${activeReasons[0]}) and the unit's commits could not be listed — cannot show it avoids core paths`;
    return out;
  }
  out.corePaths = [...byPath].map(([p, owners]) => ({ path: p, owners }));
  if (!out.corePaths.length) { out.verdict = 'not-core'; out.detail = `no core path touched (${activeReasons[0]})`; return out; }
  const list = out.corePaths.map((c) => c.path);
  const shown = list.slice(0, 3).join(', ') + (list.length > 3 ? ` (+${list.length - 3})` : '');
  out.verdict = 'refuse';
  out.detail = `${list.length} core path(s): ${shown} — a trunk-direct unit has no PR to review them; redo the change on a branch (#351)`;
  return out;
}

module.exports = {
  CODEOWNERS_PATHS, parse, compile, ownerOf, corePaths, inert, approvalVerdict, directVerdict,
  remoteOwner, foreignTeams, dropForeignTeams, foreignNote,
};
