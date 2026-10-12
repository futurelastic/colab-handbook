'use strict';
/**
 * Owner-level grant policy (#596): one `migration-grant` value set once, by a human, for every repo
 * an owner runs. Precedence: the repo's explicit `migration-grant:` > the owner value > `human`.
 *
 * WHERE IT LIVES. Not in a file. A committed file (in the repo, or in the owner's `.github` repo)
 * is edited by any session that can commit, and nothing in it names who set it. So the value is a
 * tracker record, the same class as a migration grant itself:
 *   - repo  = `<owner>/.github` (GitHub's own owner-wide-defaults repo; `<owner>` is the GitHub
 *             owner of the repo being judged, resolved by `gh` from its remote);
 *   - issue = the lowest-numbered OPEN issue there labelled `colab-owner-policy`;
 *   - value = marker comments `<!-- colab:owner-policy key=<key> value=<value> -->`. The LATEST
 *             marker for a key whose author counts as human wins. `value=unset` withdraws it.
 *
 * HOW A READER PROVES A HUMAN SET IT. The same two halves a human grant has, no weaker and no
 * stronger: the write is refused without `COLAB_HUMAN=1` (tools/colab `owner-policy set`), and
 * the read counts a marker only when its author is the `.github` repo's OWNER or a MEMBER and, where
 * the repo being judged declares `trust-humans:` (read from its trunk / merge target, never from a
 * branch), only when that login is listed (trust-humans.js authorIsHuman). A marker from anyone
 * else is ignored and reported, never honoured. COLLABORATOR is deliberately not enough here: an
 * outside collaborator on the owner's defaults repo does not answer for every repo the owner runs.
 *
 * PURE: parsed records in, verdicts out. No git, no network — tools/colab does the I/O.
 */
const trustHumans = require('./trust-humans');

const LABEL = 'colab-owner-policy';
const RECORD_REPO = '.github';
const ISSUE_TITLE = 'colab owner policy';
/** Keys the owner record may carry. `ci-grant` could take the same shape later (#596, out of scope). */
const KEYS = ['migration-grant'];
const VALUES = { 'migration-grant': ['human', 'reviewer'] };
const UNSET = 'unset';
/** Owner-level record authors: the owner account, or an org member. Not COLLABORATOR — see above. */
const OWNER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER']);

const MARK_RE = /<!--\s*colab:owner-policy\s+key=([a-z][a-z-]*)\s+value=([a-z]+)\s*-->/;

function isValidValue(key, value) {
  return KEYS.includes(key) && (value === UNSET || (VALUES[key] || []).includes(value));
}

/** The comment body `owner-policy set` posts. Marker first, so a reader never parses prose. */
function markerBody(key, value, host, iso) {
  if (!isValidValue(key, value)) throw new Error(`owner-policy: ${key}=${value} is not settable`);
  const what = value === UNSET
    ? `withdraws the owner-level \`${key}\` value — repos without their own key fall back to the default`
    : `sets the owner-level \`${key}\` to \`${value}\` for every repo this owner runs that does not declare its own \`${key}:\``;
  return `<!-- colab:owner-policy key=${key} value=${value} -->\n` +
    `**colab owner policy** — ${what}. Host \`${host}\` · ${iso}. A repo's own \`${key}:\` still wins; ` +
    `\`${key}: human\` in a repo's project.yml opts that repo out.`;
}

/**
 * Normalise one comment from either shape colab reads: REST (`user.login`, `author_association`,
 * `created_at`) or gh's GraphQL JSON (`author.login`, `authorAssociation`, `createdAt`).
 */
function normComment(c) {
  const o = c || {};
  return {
    login: (o.user && o.user.login) || (o.author && o.author.login) || '',
    authorAssociation: o.author_association || o.authorAssociation || '',
    at: o.created_at || o.createdAt || '',
    body: String(o.body || ''),
  };
}

/**
 * The owner value for `key` from the record issue's comments. `trust` = the JUDGED repo's
 * parseTrustHumans(...) at its trunk/target (or null = undeclared).
 * Returns { set, value, by, at, ignored: [{ login, at, value, reason }] } — `set` false when no
 * trusted marker exists or the latest trusted one is `unset`.
 */
function ownerValue(comments, key, trust) {
  const list = (Array.isArray(comments) ? comments : []).map(normComment)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let cur = null;
  const ignored = [];
  for (const c of list) {
    const m = c.body.trim().match(MARK_RE);
    if (!m || m[1] !== key) continue;
    const value = m[2];
    if (!isValidValue(key, value)) { ignored.push({ login: c.login, at: c.at, value, reason: `"${value}" is not a ${key} value` }); continue; }
    if (!OWNER_ASSOCIATIONS.has(c.authorAssociation)) {
      ignored.push({ login: c.login, at: c.at, value, reason: `${c.login || '(unknown)'} (${c.authorAssociation || 'unknown association'}) is not the owner or an org member` });
      continue;
    }
    const h = trustHumans.authorIsHuman(c, trust);
    if (!h.ok) { ignored.push({ login: c.login, at: c.at, value, reason: h.reason }); continue; }
    cur = { value, by: c.login, at: c.at };
  }
  if (!cur || cur.value === UNSET) return { set: false, value: null, by: cur ? cur.by : null, at: cur ? cur.at : null, ignored };
  return { set: true, value: cur.value, by: cur.by, at: cur.at, ignored };
}

/**
 * Three-level precedence for `migration-grant`. `repoPol` = migration-grant.js parseGrantPolicy(doc);
 * `owner` = { read: 'ok'|'none'|'unread', owner, set, value, by, at, why } from tools/colab's reader,
 * or null when the owner record was not consulted (the repo declares its own key, so it is not needed).
 * Returns repoPol's shape plus { source: 'repo'|'owner'|'default', optedOut, owner, ownerBy, ownerAt,
 * ownerNote }. `reason` is a sentence naming the source — the caller prints it on refusal.
 */
function resolveGrantPolicy(repoPol, owner) {
  const o = owner || null;
  const ownerSet = !!(o && o.read === 'ok' && o.set);
  const ownerBits = ownerSet ? { owner: o.owner || null, ownerBy: o.by || null, ownerAt: o.at || null } : { owner: null, ownerBy: null, ownerAt: null };
  if (repoPol.declared) {
    const optedOut = repoPol.valid && repoPol.policy === 'human' && ownerSet && o.value === 'reviewer';
    return { ...repoPol, source: 'repo', optedOut, ...ownerBits, ownerNote: '',
      reason: optedOut
        ? `this repo opted out: project.yml declares migration-grant: human, which wins over the owner-level reviewer value (set by ${o.by} at ${o.at})`
        : repoPol.reason };
  }
  if (ownerSet) {
    return { policy: o.value, declared: false, valid: true, source: 'owner', optedOut: false, ...ownerBits, ownerNote: '',
      reason: `owner-level migration-grant: ${o.value} (set on ${o.owner || 'the owner'}/${RECORD_REPO} by ${o.by} at ${o.at}; this repo declares no key of its own)` };
  }
  const ownerNote = o && o.read === 'unread' ? `the owner-level record could not be read (${o.why || 'unknown error'}) — read as unset` : '';
  return { ...repoPol, source: 'default', optedOut: false, ...ownerBits, ownerNote,
    reason: ownerNote ? `${repoPol.reason}; ${ownerNote}` : repoPol.reason };
}

/** One-line source label for a printed policy: `repo`, `owner (<by> at <at>)`, or `default`. */
function sourceLabel(res) {
  if (!res) return 'default';
  if (res.source === 'owner') return `owner (${res.ownerBy || '?'} at ${res.ownerAt || '?'})`;
  return res.source;
}

module.exports = {
  LABEL, RECORD_REPO, ISSUE_TITLE, KEYS, VALUES, UNSET, OWNER_ASSOCIATIONS, MARK_RE,
  isValidValue, markerBody, normComment, ownerValue, resolveGrantPolicy, sourceLabel,
};
