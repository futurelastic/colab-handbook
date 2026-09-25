'use strict';
/**
 * Thin wrappers over `git` and `gh` via child_process. No dependencies.
 * Every function degrades gracefully: git/gh missing, no remote, not a repo — return null/false,
 * never throw for "environment doesn't have it". Real failures (bad args) still surface.
 */

const { spawnSync } = require('child_process');
const path = require('path');

/**
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - bound how long we'll wait (see #62: `git worktree remove` on
 *   a slow/synced volume, or a hook script blocked on a dead network call, used to hang forever
 *   with NO output — indistinguishable from slow-but-working). Omit for the historical unbounded
 *   behavior; every call site that can plausibly block on something outside the repo should pass one.
 */
function run(cmd, args, opts = {}) {
  const { timeoutMs, ...spawnOpts } = opts;
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...(timeoutMs ? { timeout: timeoutMs } : {}), ...spawnOpts });
  const timedOut = !!(res.error && res.error.code === 'ETIMEDOUT');
  return {
    ok: res.status === 0 && !timedOut,
    code: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: timedOut ? `timed out after ${timeoutMs}ms with no output` : (res.stderr || '').trim(),
    error: res.error || null,
    timedOut,
  };
}

function git(args, cwd, opts = {}) {
  return run('git', args, { ...(cwd ? { cwd } : {}), ...opts });
}

/** Absolute repo root for a path (default cwd), or null if not a git repo. */
function repoRoot(cwd) {
  const r = git(['rev-parse', '--show-toplevel'], cwd);
  return r.ok ? r.stdout : null;
}

/**
 * The MAIN working tree's root, even when `cwd` is inside a linked worktree.
 *
 * `repoRoot` answers "which tree am I standing in", which is a different question and the wrong
 * one for anything keyed by repo identity. Claims, ports and worktree records are all stored
 * under the main repo path, so resolving from inside a worktree used to miss every one of them:
 * `colab ship` composed its squash message with an EMPTY issue list and never emitted `Closes #N`,
 * silently, while the issue stayed open with its code merged.
 *
 * `--git-common-dir` is the shared `.git` for every worktree of a repo, so its parent is the main
 * tree. Falls back to `repoRoot` whenever the layout is not the ordinary one (bare repos, a
 * `.git` file that is not named `.git`) rather than guessing.
 */
function mainRepoRoot(cwd) {
  let dir = null;
  // --path-format needs git >= 2.31; fall back to resolving the relative answer ourselves.
  const abs = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (abs.ok && abs.stdout) dir = abs.stdout;
  else {
    const rel = git(['rev-parse', '--git-common-dir'], cwd);
    if (rel.ok && rel.stdout) dir = path.resolve(cwd || process.cwd(), rel.stdout);
  }
  if (dir && path.basename(dir) === '.git') return path.dirname(dir);
  return repoRoot(cwd);
}

// ---------------------------------------------------------------------------
// Which remote (#301) — the ONE place colab decides it. Every fetch, push, ls-remote,
// remote-tracking ref and remote-naming message routes through here instead of the literal
// `origin`. The first matching rule wins:
//   1. `git config colab.remote <name>`  — the explicit, per-clone override. Wins even over
//      `origin`. Naming a remote that does not exist is an error, never a fall-through to a guess.
//   2. a remote named `origin`            — the parity rule: every repo that worked before #301
//      takes byte-for-byte the same path it took then.
//   3. `remote.pushDefault`, if it names an existing remote.
//   4. exactly one remote                 — that one.
//   5. no remote at all                   — null (a local-only repo; callers keep their
//      "no remote" behavior).
//   6. anything else is AMBIGUOUS         — refused with the remotes named and the fix. colab
//      never picks one of several remotes by itself.
// `origin` ranks above `pushDefault` on purpose: pushDefault is a push-only knob used in fork
// (triangular) setups, and letting it outrank `origin` would silently move where trunk is fetched
// from and where claims are pushed in a repo that works today. `colab.remote` is the one
// deliberate way off `origin`. It lives in git config, not project.yml: the remote name belongs to
// one clone, not to the repo.
// ---------------------------------------------------------------------------

const REMOTE_OVERRIDE_KEY = 'colab.remote';
const remoteCache = new Map();

/** Test hook: forget every cached resolution (a test that adds/renames remotes after resolving). */
function _resetRemoteCache() { remoteCache.clear(); }

function listRemotes(repo) {
  const r = git(['remote'], repo);
  return r.ok && r.stdout ? r.stdout.split('\n').map((x) => x.trim()).filter(Boolean) : [];
}

function configValue(repo, key) {
  const r = git(['config', '--get', key], repo);
  return r.ok && r.stdout ? r.stdout : null;
}

/**
 * How this repo's remote resolves — `{ name, source, remotes }`. NEVER throws (this module's
 * contract: an environment without something is an answer, not an exception); `name` is null for
 * `none`, `ambiguous` and `config-missing`. `source` ∈ config | origin | pushDefault | single |
 * none | ambiguous | config-missing. Cached per resolved repo path for the life of the process —
 * a linked worktree and its main checkout share config, so either path answers the same.
 */
function remoteInfo(repo) {
  const key = path.resolve(repo || process.cwd());
  if (remoteCache.has(key)) return remoteCache.get(key);
  const remotes = listRemotes(repo);
  const has = (n) => remotes.includes(n);
  let info;
  const override = configValue(repo, REMOTE_OVERRIDE_KEY);
  const pushDefault = configValue(repo, 'remote.pushDefault');
  if (override) info = has(override) ? { name: override, source: 'config' } : { name: null, source: 'config-missing', override };
  else if (has('origin')) info = { name: 'origin', source: 'origin' };
  else if (pushDefault && has(pushDefault)) info = { name: pushDefault, source: 'pushDefault' };
  else if (remotes.length === 1) info = { name: remotes[0], source: 'single' };
  else if (remotes.length === 0) info = { name: null, source: 'none' };
  else info = { name: null, source: 'ambiguous' };
  info.remotes = remotes;
  remoteCache.set(key, info);
  return info;
}

/** The refusal text for an unresolvable remote, or null when it resolves (or there is none). */
function remoteProblem(info) {
  if (info.source === 'ambiguous') {
    return `this repo has ${info.remotes.length} git remotes (${info.remotes.join(', ')}) and none is named origin — ` +
      `colab will not guess which one to fetch from and push to. Pick one: git config ${REMOTE_OVERRIDE_KEY} <name>`;
  }
  if (info.source === 'config-missing') {
    return `git config ${REMOTE_OVERRIDE_KEY} names "${info.override}", but this repo has no such remote ` +
      `(remotes: ${info.remotes.length ? info.remotes.join(', ') : 'none'}). Fix it: git config ${REMOTE_OVERRIDE_KEY} <name>, ` +
      `or git config --unset ${REMOTE_OVERRIDE_KEY}`;
  }
  return null;
}

/**
 * The remote colab uses in this repo, or null when there is none. THROWS a UserError (loudly,
 * naming the remotes and the fix) when the remotes are ambiguous or the override is broken —
 * the one case this module throws for, because silently guessing a remote is worse than stopping.
 */
function remoteName(repo) {
  const info = remoteInfo(repo);
  const problem = remoteProblem(info);
  if (problem) {
    const { UserError } = require('./util'); // lazy: util must stay free of a git.js dependency
    throw new UserError(problem);
  }
  return info.name;
}

/**
 * For call sites that used the literal `'origin'` unconditionally: the resolved remote, or the
 * literal `'origin'` when the repo has none — so a local-only repo fails at git exactly as it did
 * before #301 (same command, same error), instead of in some new way. Throws like remoteName.
 */
function remoteFor(repo) {
  return remoteName(repo) || 'origin';
}

/** URL of the resolved remote, or null (no remote, or unresolvable — never throws). */
function remoteUrl(repo) {
  const { name } = remoteInfo(repo);
  if (!name) return null;
  const r = git(['remote', 'get-url', name], repo);
  return r.ok && r.stdout ? r.stdout : null;
}

/** Pre-#301 name, kept as an alias: the resolved remote's URL (it was `origin`'s, which is still what an origin repo gets). */
function originUrl(repo) {
  return remoteUrl(repo);
}

/** Trunk branch name from <remote>/HEAD, best-effort. Never throws: an unresolvable remote reads as `origin`, as before #301. */
function detectTrunk(repo, remote = remoteInfo(repo).name || 'origin') {
  let r = git(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], repo);
  if (r.ok && r.stdout) return r.stdout.startsWith(`${remote}/`) ? r.stdout.slice(remote.length + 1) : r.stdout;
  r = git(['remote', 'show', remote], repo);
  if (r.ok) {
    const m = r.stdout.match(/HEAD branch:\s*(\S+)/);
    if (m) {
      git(['remote', 'set-head', remote, m[1]], repo); // cache it
      return m[1];
    }
  }
  return null;
}

/**
 * Does a branch name resolve to a ref in this repo — locally, or as origin's copy?
 *
 * The local check alone is not enough: a session on another machine pushed the branch, and a claim
 * naming it is perfectly healthy here. False in this function therefore means "nothing anywhere
 * knows this name", which is the only claim strong enough to refuse a ship over. A falsy branch
 * (null = "no branch") is false without asking git.
 */
function branchExists(repo, branch, remote = remoteInfo(repo).name || 'origin') {
  if (!branch || typeof branch !== 'string') return false;
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/${remote}/${branch}`]) {
    if (git(['rev-parse', '--verify', '--quiet', ref], repo).ok) return true;
  }
  return false;
}

/**
 * #324: WHERE a branch name resolves — `{localSha, remoteSha}`, each a full sha or null. The answer
 * `branchExists` above deliberately flattens: "exists only as origin's copy" is exactly the shape of
 * another machine's work, which `ship` must not adopt silently. Read it BEFORE anything that runs
 * `git worktree add <dir> <branch>`: git's DWIM checkout silently creates the local ref from the
 * remote one, after which the branch is indistinguishable from one this machine made.
 *
 * #343: "indistinguishable" by refs alone — but not by the branch's reflog. `localFromRemote` is true
 * when the local ref's OLDEST reflog entry says it was created from origin's copy of the SAME name.
 * Measured on git 2.55, one fixture per creation path:
 *   git checkout <b> / git switch <b> / git worktree add <dir> <b>   (DWIM)
 *                                            → `branch: Created from refs/remotes/origin/<b>`
 *   git branch --track <b> origin/<b> / git worktree add -b <b> <dir> origin/<b> / checkout -b <b> origin/<b>
 *                                            → `branch: Created from origin/<b>`
 *   git checkout -b <b>                       → `branch: Created from HEAD`       (a local branch)
 *   git checkout -b <b> origin/main           → `branch: Created from origin/main` (a local branch)
 * The signal is one-directional: it can only turn a "local" reading into "came from origin", never
 * the reverse. Where it is absent it degrades to the pre-#343 reading, silently — the known blind
 * spots are an expired reflog (gc.reflogExpire, 90 days by default), `core.logAllRefUpdates=false`,
 * and a ref created by `git fetch origin <b>:<b>` (reflog `fetch …: storing head`, deliberately not
 * matched — its wording carries the refspec, not a "created from" source).
 */
function branchRefs(repo, branch, remote = remoteInfo(repo).name || 'origin') {
  if (!branch || typeof branch !== 'string') return { localSha: null, remoteSha: null, localFromRemote: false };
  const at = (ref) => { const r = git(['rev-parse', '--verify', '--quiet', ref], repo); return r.ok && r.stdout ? r.stdout : null; };
  const localSha = at(`refs/heads/${branch}`);
  const remoteSha = at(`refs/remotes/${remote}/${branch}`);
  return { localSha, remoteSha, localFromRemote: localSha ? createdFromRemote(repo, branch, remote) : false };
}

/** #343: is `refs/heads/<branch>`'s oldest reflog entry "Created from <remote>/<branch>"? See branchRefs. */
function createdFromRemote(repo, branch, remote = remoteInfo(repo).name || 'origin') {
  const r = git(['reflog', 'show', '--format=%gs', `refs/heads/${branch}`, '--'], repo);
  if (!r.ok || !r.stdout) return false;
  const lines = r.stdout.split('\n').filter(Boolean);
  const oldest = lines[lines.length - 1] || '';
  return oldest === `branch: Created from refs/remotes/${remote}/${branch}` || oldest === `branch: Created from ${remote}/${branch}`;
}

/**
 * Authoritative "does this branch name already resolve to a ref" check — for the one caller
 * (`worktree new`, #124) that must refuse rather than silently cut a fresh branch over an
 * existing one's history.
 *
 * `branchExists` above is not enough here: it trusts the LOCAL remote-tracking ref, and the
 * `git fetch origin <base>` `worktree new` runs beforehand only refreshes `base` — never an
 * arbitrary branch name — so a branch pushed from another machine (or by a session whose
 * worktree was already torn down) can be invisible to it. `ls-remote` asks origin directly, no
 * local cache involved, so it is fresh regardless of what has or hasn't been fetched.
 *
 * Local wins when both exist (it is the one a `git worktree add -b` would actually collide
 * with). Returns `{ ref, sha }` (sha short, 7 chars) or `null` when neither resolves.
 */
function existingBranchRef(repo, branch, remote = remoteFor(repo)) {
  if (!branch || typeof branch !== 'string') return null;
  const local = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo);
  if (local.ok && local.stdout) return { ref: `refs/heads/${branch}`, sha: local.stdout.slice(0, 7) };
  const r = git(['ls-remote', '--exit-code', remote, `refs/heads/${branch}`], repo);
  if (r.ok && r.stdout) {
    const sha = r.stdout.split(/\s+/)[0] || '';
    return { ref: `refs/remotes/${remote}/${branch}`, sha: sha.slice(0, 7) };
  }
  return null;
}

/**
 * The git remote a CLAIM is recorded on (#325). Since #301 this is `remoteName` — the same resolver
 * every other remote-touching command uses — so claims live on the remote everything else fetches
 * from. `null` = a repo with no remote at all, where the local record is the whole truth because
 * nothing else could ever share the branch. Throws on ambiguous remotes, like remoteName.
 */
function claimRemote(repo) {
  return remoteName(repo);
}

/**
 * Every branch head on `remoteName`, asked of the remote directly (`ls-remote --heads`, no fetch, no
 * local cache) — the claim record another machine can read (#325). Unlike `existingBranchRef`, a
 * failed ask is NOT "no branches": it returns `{ ok: false, stderr }` so the caller can refuse
 * (fail closed) instead of reading an unreachable remote as clear ground.
 * `{ ok: true, heads: [{ branch, sha }] }` otherwise, `sha` short (7).
 */
function remoteHeads(repo, remoteName) {
  const r = git(['ls-remote', '--heads', remoteName], repo, { timeoutMs: 60_000 });
  if (!r.ok) return { ok: false, stderr: r.stderr || (r.timedOut ? 'ls-remote timed out' : `exit ${r.code}`) };
  const heads = [];
  for (const line of String(r.stdout || '').split('\n')) {
    const m = line.match(/^([0-9a-f]{7,})\s+refs\/heads\/(.+)$/);
    if (m) heads.push({ branch: m[2], sha: m[1].slice(0, 7) });
  }
  return { ok: true, heads };
}

/** List worktree paths registered in a repo (porcelain). */
function worktreeList(repo) {
  const r = git(['worktree', 'list', '--porcelain'], repo);
  if (!r.ok) return [];
  return r.stdout.split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));
}

/**
 * `git worktree list --porcelain`, parsed per-block instead of flattened — a caller that needs
 * "which branch is checked out at THIS path" (not just "is this branch checked out somewhere")
 * needs the path/branch pairing, which a flat line-filter throws away. Returns
 * `[{path, branch, detached, bare}]`; `branch` is null for a detached or bare entry.
 *
 * Ground truth for what worktrees actually exist, independent of anyone's record of them — see
 * `worktreeList` above for the flat form, kept because `shippedBranches` only ever needed "is this
 * branch checked out anywhere" and a block parse would be pure overhead there.
 */
function worktreeListDetailed(repo) {
  const r = git(['worktree', 'list', '--porcelain'], repo);
  if (!r.ok) return [];
  const out = [];
  let cur = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = { path: line.slice('worktree '.length), branch: null, detached: false, bare: false };
    } else if (cur && line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (cur && line === 'detached') {
      cur.detached = true;
    } else if (cur && line === 'bare') {
      cur.bare = true;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Resolves where `branch` is actually checked out right now, from git's own ground truth —
 * never a caller's own record of it (a `wtPath` field on a session/worktree object), which can
 * be null or stale (the record went missing, or was never written — happens, has multiple real
 * producers) while a live worktree of that branch still exists on disk. `colab ship`'s B0 used
 * to trust `sess.wtPath` alone and, on a stale/missing record, fall through to minting an
 * ADDITIONAL temp checkout of the same branch — which git then refuses ("already checked out
 * at …"), because two checkouts of one branch is something git itself does not allow (#286).
 *
 * Built on `worktreeListDetailed` above rather than re-parsing `--porcelain` output — same
 * ground-truth source already used for `colab worktrees`' reconciliation and the orphan-branch
 * scan, and already covered by its own tests.
 *
 * Returns null when git itself says the branch is not checked out anywhere — the only case in
 * which minting a fresh (ephemeral) checkout is safe.
 */
function resolveWorktreePathForBranch(repo, branch) {
  const hit = worktreeListDetailed(repo).find((w) => w.branch === branch);
  return hit ? hit.path : null;
}

/**
 * `stderr.split('\n')[0]` on a failed `git worktree add` keeps git's own generic progress line
 * ("Preparing worktree (checking out '<branch>')") and discards the `fatal:` line beneath it —
 * the only line that actually names what went wrong, including (in a checkout-collision) the
 * path of the worktree already holding that branch (#287). Prefer the first `fatal:` line; fall
 * back to the last non-empty line for a failure that doesn't say `fatal:` at all, rather than
 * always the first line, which is the one most likely to be boilerplate progress output.
 */
function gitFailureLine(stderr) {
  const lines = (stderr || '').split('\n');
  const fatal = lines.find((l) => l.startsWith('fatal:'));
  if (fatal) return fatal;
  const nonEmpty = lines.filter(Boolean);
  return nonEmpty.length ? nonEmpty[nonEmpty.length - 1] : lines[0];
}

/**
 * `git status --porcelain` split into its tracked and untracked halves, or null if git could not
 * answer. Two deliberate choices, both load-bearing for the callers below:
 *
 * - **`-uall`, not the default `-unormal`.** Porcelain normally collapses an untracked directory
 *   into a single `?? dir/` line. The callers of `dirtyUntracked` are about to DELETE what they
 *   are describing, and `?? tools/lib/` does not tell a human which of their new sources is at
 *   stake. Listing them costs a directory walk over non-ignored paths only.
 * - **No `--ignored`, ever.** Ignored files stay invisible here by construction. Build output,
 *   `node_modules`, a copied `.env` — those are exactly what a teardown is right to destroy
 *   without asking, and a worktree post-create hook legitimately produces them.
 */
function statusPorcelain(wtPath) {
  const r = git(['status', '--porcelain', '-uall'], wtPath);
  if (!r.ok) return null;
  const lines = r.stdout.split('\n').filter(Boolean);
  return {
    tracked: lines.filter((l) => !l.startsWith('??')),
    untracked: lines.filter((l) => l.startsWith('??')),
  };
}

// All three degrade to '' ("clean") when git itself cannot answer, which for a destructive caller
// means "proceed". That is deliberate and not a fail-open bug: the case where `git status` fails in
// a directory that exists is a worktree that is no longer a worktree — the #62 husk, whose whole
// removal path exists to clean it up. A gate that refused there would make husks unremovable.

/** Tracked (non-untracked) uncommitted changes in a worktree, or '' if clean. */
function dirtyTracked(wtPath) {
  const s = statusPorcelain(wtPath);
  return s ? s.tracked.join('\n') : '';
}

/**
 * Untracked, NON-IGNORED files in a worktree, or '' if none (#86).
 *
 * The companion `dirtyTracked` never had. A file that has never been `git add`ed exists in exactly
 * one place — the working tree — so it is the ONLY category of work a teardown can destroy with
 * nothing to restore from: not the index, not a commit, not the remote. Tracked changes always
 * have at least a committed base to diff against; untracked ones have nothing.
 */
function dirtyUntracked(wtPath) {
  const s = statusPorcelain(wtPath);
  return s ? s.untracked.join('\n') : '';
}

/** Everything uncommitted: tracked changes AND untracked non-ignored files. '' if the tree is clean. */
function dirtyAny(wtPath) {
  const s = statusPorcelain(wtPath);
  return s ? [...s.tracked, ...s.untracked].join('\n') : '';
}

// ---- gh ----

/**
 * #344: is gh usable — and if not, WHY. `{ ok, reason }`, reason `null` | `'missing'` (no gh binary)
 * | `'no-credential'` (gh is there, but the credential it would actually use does not work). Cached
 * per process.
 *
 * A bare `gh auth status` is the wrong question: it exits 1 when ANY configured account is broken,
 * even when the one gh actually uses is fine (measured: a valid `GH_TOKEN` plus an expired, inactive
 * keyring account → `gh auth status` exit 1 while `gh api user` / `gh run list` work). That read gh
 * as absent for the whole run — ship refused CI, claims went local-only — and flipped whenever the
 * inactive token expired. So: `gh auth status --active` (only the account gh will use; present on
 * gh 2.98, measured — absent on older builds)
 * first, and when that fails — an older gh without the flag, or a genuinely broken active account —
 * the decisive probe is the credential doing real work: `gh api user`.
 */
let _ghState = null;
function ghState() {
  if (_ghState) return _ghState;
  if (!run('gh', ['--version']).ok) return (_ghState = { ok: false, reason: 'missing' });
  if (run('gh', ['auth', 'status', '--active']).ok) return (_ghState = { ok: true, reason: null });
  const who = run('gh', ['api', 'user', '-q', '.login']);
  if (who.ok && who.stdout) {
    if (_ghLogin === undefined) _ghLogin = who.stdout;
    return (_ghState = { ok: true, reason: null });
  }
  return (_ghState = { ok: false, reason: 'no-credential' });
}

function ghAvailable() {
  return ghState().ok;
}

/** gh issue edit — returns {ok, stderr}. cwd must be inside the repo so gh resolves the remote. */
function ghIssueEdit(repo, issueNum, args) {
  return run('gh', ['issue', 'edit', String(issueNum), ...args], { cwd: repo });
}

/** The current gh user's login (`gh api user`), or null if it can't be determined. Cached. */
let _ghLogin;
function ghCurrentLogin() {
  if (_ghLogin !== undefined) return _ghLogin;
  const r = run('gh', ['api', 'user', '-q', '.login']);
  _ghLogin = r.ok && r.stdout ? r.stdout : null;
  return _ghLogin;
}

/** Raw `gh api` call — returns {ok, stdout, stderr, code}. cwd must be inside the repo so `{owner}`
 * / `{repo}` placeholders resolve to the right remote. */
function ghApi(repo, args) {
  return run('gh', ['api', ...args], { cwd: repo });
}

/**
 * True when a gh CLI failure is specifically a GraphQL quota exhaustion, not a REST one (#164).
 * `gh` prefixes every GraphQL-transport error with a literal `GraphQL:` on the first line of
 * stderr (its own reporting convention, not something we control) — so this is the one reliable
 * signal that the failing write went over GraphQL rather than REST. REST and GraphQL are counted
 * as SEPARATE hourly quotas, so this failure says nothing about whether the REST equivalent below
 * can still complete — that is the entire reason a fallback is worth attempting.
 */
function isGraphqlRateLimit(stderr) {
  const first = String(stderr || '').split('\n')[0] || '';
  return /^GraphQL:/i.test(first) && /rate limit/i.test(first);
}

/**
 * Who holds an issue's tracker claim, read from the issue itself (#363) — never assumed to be the
 * caller. A fleet that works under more than one account (an operator login and an agent login,
 * say) routinely claims under one and releases under the other; a release that only drops `@me`
 * then removes `in-progress` and leaves the claimer assigned — a half-claim by §5's own
 * definition, which nobody starts and nothing repairs.
 *
 * The claimer is the actor of the LATEST `labeled in-progress` event: the claim writes the label
 * and the assignee in one call, by one account, so that actor is the account whose assignee is
 * the claim's other half. The event survives the label's removal, so this also finds the claimer
 * of an issue already reduced to an assignee-only half-claim — the repair case.
 *
 * Both reads are REST (`gh api`), deliberately: release has a REST fallback for a GraphQL-only
 * rate limit (#164), and a lookup that spent GraphQL quota would fail in exactly that case.
 * Returns {assignees, claimer}; either is null when it could not be read — "could not read",
 * never "nobody", the same contract as ghIssueView.
 */
function ghClaimHolder(repo, issueNum) {
  const a = ghApi(repo, [`repos/{owner}/{repo}/issues/${issueNum}`, '--jq', '.assignees[].login']);
  const assignees = a.ok ? String(a.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean) : null;
  const e = ghApi(repo, [
    '--paginate', `repos/{owner}/{repo}/issues/${issueNum}/events`,
    '--jq', '.[] | select(.event == "labeled" and .label.name == "in-progress") | .actor.login',
  ]);
  const actors = e.ok ? String(e.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean) : [];
  const claimer = actors.length ? actors[actors.length - 1] : null;
  return { assignees, claimer };
}

/**
 * Release an issue's tracker claim — remove the `in-progress` label and the assignee that holds
 * the claim. Primary path is `gh issue edit` (GraphQL, one mutation for both). On a GraphQL-specific
 * rate limit (#164) it retries each half over REST instead, since the two quotas are independent:
 *   DELETE /repos/{owner}/{repo}/issues/{n}/labels/in-progress
 *   DELETE /repos/{owner}/{repo}/issues/{n}/assignees   (body: {assignees:[login,...]})
 * Any other kind of failure (network down, issue not found, ...) is NOT retried — a GraphQL
 * rate limit is the one case where "try a different transport" is actually a different question,
 * not a repeat of the same one.
 *
 * Which assignee (#363): the caller (`@me`, always — unassigning a login that is not assigned is a
 * no-op) AND the claimer read from the issue by `ghClaimHolder`, when that is a different login
 * still assigned. `opts.selfOnly` restricts it to `@me` — for the yield path, where the latest
 * labeler may be the WINNER of the race, whose assignee must survive. A lookup that fails
 * degrades to `@me` alone (the pre-#363 behaviour) and says so in `note`; it never blocks the
 * release.
 *
 * Returns {ok, stderr, code, others, caller, note}: `others` = logins other than the caller that
 * were unassigned (empty in the ordinary one-account case) — a caller prints them, because
 * removing someone else's assignee is a thing a human should see happened.
 */
function ghIssueRelease(repo, issueNum, opts = {}) {
  const caller = ghCurrentLogin();
  let others = [];
  let note = '';
  if (!opts.selfOnly) {
    const h = ghClaimHolder(repo, issueNum);
    if (h.claimer && h.claimer !== caller && (h.assignees === null || h.assignees.includes(h.claimer))) {
      others = [h.claimer];
    } else if (!h.claimer && h.assignees === null) {
      note = 'could not read who holds the claim — unassigned @me only';
    }
  }
  const r = run('gh', ['issue', 'edit', String(issueNum),
    '--remove-assignee', ['@me', ...others].join(','), '--remove-label', 'in-progress'], { cwd: repo });
  if (r.ok || !isGraphqlRateLimit(r.stderr)) return { ...r, others: r.ok ? others : [], caller, note };

  const label = ghApi(repo, ['-X', 'DELETE', `repos/{owner}/{repo}/issues/${issueNum}/labels/in-progress`]);
  const logins = [caller, ...others].filter(Boolean);
  const assignee = logins.length
    ? ghApi(repo, ['-X', 'DELETE', `repos/{owner}/{repo}/issues/${issueNum}/assignees`,
      ...logins.flatMap((l) => ['-f', `assignees[]=${l}`])])
    : { ok: false, stderr: 'could not resolve current gh login for assignee removal (gh api user failed)' };

  const ok = label.ok && assignee.ok;
  const stderr = ok ? '' : [
    !label.ok && `label removal: ${label.stderr.split('\n')[0] || label.code}`,
    !assignee.ok && `assignee removal: ${assignee.stderr.split('\n')[0] || assignee.code}`,
  ].filter(Boolean).join('; ');
  return { ok, stderr, code: ok ? 0 : 1, others: assignee.ok ? others : [], caller, note };
}

/**
 * `gh issue view N --json <fields>` → parsed object, or null on any failure (gh missing,
 * bad repo, network, unparseable). Callers treat null as "couldn't read" — never as "empty".
 */
function ghIssueView(repo, issueNum, fields) {
  const r = run('gh', ['issue', 'view', String(issueNum), '--json', fields.join(',')], { cwd: repo });
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout); }
  catch (_) { return null; }
}

/**
 * Post a comment on an issue — returns {ok, stderr}. Best-effort at the call sites. Primary path
 * is `gh issue comment` (GraphQL); on a GraphQL-specific rate limit (#164) it retries once over
 * the REST equivalent (`POST /repos/{owner}/{repo}/issues/{n}/comments`) — a separate quota, so a
 * GraphQL exhaustion says nothing about whether this can still land.
 */
/**
 * #350: the OPEN pull request whose head is `branch`, with its reviews, or null (none open, or the
 * read failed — `{ error }` distinguishes the two). One call answers both "is there a PR?" and "has
 * someone approved it?", so the core-path pause costs one read on the resume path.
 */
function ghPrForBranch(repo, branch) {
  const r = run('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,state,author,headRefOid,reviews'], { cwd: repo });
  if (!r.ok) return { error: (r.stderr || '').split('\n')[0] || `gh pr list exited ${r.code}` };
  try {
    const list = JSON.parse(r.stdout || '[]');
    return { pr: Array.isArray(list) && list.length ? list[0] : null };
  } catch (_) { return { error: 'gh pr list returned unparseable JSON' }; }
}

/**
 * #367: the forge's visibility for this repo — "PUBLIC" | "PRIVATE" | "INTERNAL" — or null when it
 * could not be read (no gh, no GitHub remote, offline). Null is "could not read", never "private":
 * tools/lib/machine-trailer.js fails closed on it.
 */
function ghRepoVisibility(repo) {
  const r = run('gh', ['repo', 'view', '--json', 'visibility', '-q', '.visibility'], { cwd: repo });
  if (!r.ok) return null;
  const v = (r.stdout || '').trim().toUpperCase();
  return /^[A-Z]+$/.test(v) ? v : null;
}

/** #350: open a PR `head` → `base`. Returns {ok, url, stderr}; `url` is gh's printed PR URL. */
function ghPrCreate(repo, { base, head, title, body }) {
  const r = run('gh', ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body], { cwd: repo });
  const url = (r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).pop() || null;
  return { ok: r.ok, url, stderr: r.stderr };
}

/** #350: close a PR whose work landed by squash elsewhere, with a comment saying where. */
function ghPrClose(repo, num, comment) {
  return run('gh', ['pr', 'close', String(num), '--comment', comment], { cwd: repo });
}

function ghIssueComment(repo, issueNum, body) {
  const r = run('gh', ['issue', 'comment', String(issueNum), '--body', body], { cwd: repo });
  if (r.ok || !isGraphqlRateLimit(r.stderr)) return r;
  return ghApi(repo, ['-X', 'POST', `repos/{owner}/{repo}/issues/${issueNum}/comments`, '-f', `body=${body}`]);
}

/**
 * #357: the created-at timestamps of every `labeled` event for `label` on one issue (issue
 * events API, paginated), oldest-first — or null when the read failed. Null is "could not read",
 * never "no events": tools/lib/decision-record.js pairVerdict keeps an unread timeline
 * UNDETERMINED (surfaced as pending) rather than guessing.
 */
function ghIssueLabelEvents(repo, issueNum, label) {
  const r = ghApi(repo, [
    '--paginate', `repos/{owner}/{repo}/issues/${issueNum}/events`,
    '--jq', `.[] | select(.event == "labeled" and .label.name == ${JSON.stringify(label)}) | .created_at`,
  ]);
  if (!r.ok) return null;
  return String(r.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * The label names defined on a repo's tracker (`gh label list`), or null on any failure (gh
 * missing, no remote, network). Null means "could not read" — never "empty set", the same
 * contract as ghIssueView: a caller must not read absence as proof a label is missing.
 */
function ghListLabels(repo) {
  const r = run('gh', ['label', 'list', '--limit', '500', '--json', 'name', '-q', '.[].name'], { cwd: repo });
  if (!r.ok) return null;
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * `gh issue list --label <name> --state <state>` → array of parsed objects (the requested JSON
 * fields), or null on failure (gh missing, no remote, network). Null means "could not read" —
 * the same contract as ghIssueView; a caller must not read a failed call as "no issues".
 */
function ghIssueListByLabel(repo, label, state, fields) {
  const r = run('gh', ['issue', 'list', '--label', label, '--state', state,
    '--json', fields.join(','), '--limit', '200'], { cwd: repo });
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout); }
  catch (_) { return null; }
}

/**
 * `gh label delete <name> --yes` — returns {ok, stderr}. Deletes the LABEL OBJECT from the
 * repo's tracker, not one issue's use of it — every issue that carried it loses it. Callers
 * that mean "remove this label from one issue" want ghIssueEdit(..., ['--remove-label', name])
 * instead; this is only for tearing down a spent `group:<key>` label (CONVENTIONS.md §5).
 */
function ghLabelDelete(repo, name) {
  return run('gh', ['label', 'delete', name, '--yes'], { cwd: repo });
}

/**
 * `gh label create <name> --color <color> --description <description>`, or the raw `run()`
 * result on failure (the label already exists, no auth, rate limit) — the caller (`colab labels
 * --ensure`, #206) decides what a failure means; this is a thin wrapper, same posture as
 * ghLabelDelete just above. No `--force`: overwriting an existing label's color/description is a
 * different, more destructive act than provisioning a MISSING one, and `--ensure`'s whole contract
 * is "create what's absent, never touch what's there" — the caller checks presence first via
 * ghListLabels and only calls this for a name confirmed missing.
 */
function ghLabelCreate(repo, name, color, description) {
  return run('gh', ['label', 'create', name, '--color', color, '--description', description], { cwd: repo });
}

/**
 * `gh label list` WITH descriptions → [{ name, description }], or null on failure — the same
 * null-means-could-not-read contract as ghListLabels (which stays names-only for its many
 * callers). Only `colab labels --ensure` needs the text, to find a convention label whose
 * description has drifted from the handbook's (#364).
 */
function ghListLabelsDetailed(repo) {
  const r = run('gh', ['label', 'list', '--limit', '500', '--json', 'name,description'], { cwd: repo });
  if (!r.ok) return null;
  try {
    const rows = JSON.parse(r.stdout);
    if (!Array.isArray(rows)) return null;
    return rows.map((l) => ({ name: String(l.name), description: typeof l.description === 'string' ? l.description : '' }));
  } catch (_) { return null; }
}

/**
 * `gh label edit <name> --description <text>` — returns {ok, stderr}. Rewrites ONE label's
 * description on the tracker; colour is deliberately never passed (#364 out of scope). Called
 * only by `colab labels --ensure --refresh-descriptions`, for a name ghListLabelsDetailed just
 * read with a differing description.
 */
function ghLabelEditDescription(repo, name, description) {
  return run('gh', ['label', 'edit', name, '--description', description], { cwd: repo });
}

/**
 * CI verdict for a branch, judged by SHA rather than by recency (#92).
 *
 * The naive "read the newest run" reading breaks under the repo's own
 * `concurrency: { cancel-in-progress: true }`: two runs can race on one push, one gets cancelled by
 * design, and if THAT one happens to land last, the gate reports red while an identical run on the
 * exact same commit already passed. Nothing inside `colab ship` can clear that — the branch that
 * would produce a newer run is the one the gate is blocking — so it deadlocked every queued ship
 * until a human re-ran the cancelled workflow by hand.
 *
 * Ask the right question instead: does a completed, successful run exist for `branch`'s CURRENT
 * remote head? `git ls-remote` reads that head without touching local refs — this may run before
 * any fetch, mid-precondition. `-L limit` widens the window past "the latest row" because the
 * duplicate this exists for can be two runs deep.
 *
 * Returns { status, conclusion, sha, createdAt, databaseId, runCount }:
 *   - EVERY run at the head sha finished, and one succeeded → {status:'completed', conclusion:'success', sha}
 *   - the head sha has run(s) and no green verdict is owed → {status, conclusion} of the most
 *     informative one (a still-running row over a finished-but-failed/cancelled one), sha set.
 *     "No green verdict owed" covers both a sha where nothing succeeded AND a sha where something
 *     did but a sibling has not finished yet (#307) — the latter reads as still-running, not green.
 *   - the head sha has no run in the recent window     → {status:'none', conclusion:null, sha}
 *     (still not green — this is also how a billing-style fail-to-start reads: no run was ever
 *     created for the commit that would need one)
 *   - the branch does not exist on the remote (#301: the resolved one, `origin` in an origin repo), or `git`/`gh` failed → null
 * `runCount` (#176) is additive on every non-null branch — the number of workflow rows found at
 * that sha (0 for the 'none' case) — so a caller can report a verdict that names its own sample
 * size instead of a bare singular that hides how many workflows were actually consulted.
 *
 * A cancelled sibling of a passing run on the SAME sha is not evidence of anything — it is simply
 * not read, because the passing run for that sha is what answers the question. Any OTHER completed
 * conclusion sitting next to it is a different matter: `forSha` holds one row per workflow, and
 * green requires ALL of them to have succeeded (cancelled excepted), not merely one having
 * succeeded (#146/#162/#165) — checked BEFORE the success check below, so a `failure`, `timed_out`,
 * `action_required`, `startup_failure`, or any other not-success completed conclusion is never
 * masked by a passing sibling on the same sha. This is deliberately an ALLOWLIST (only `success` and
 * `cancelled` are not-bad) rather than a denylist of conclusion values as they get discovered —
 * #146 covered `failure` alone and #165 was filed the moment a second denylist entry was on the
 * table; inverting the quantifier once closes the whole family instead of chasing it value by value.
 *
 * That ALL-quantifier binds `status` exactly as it binds `conclusion` (#307), and for one reason:
 * a sibling that has not FINISHED has not passed — it can still fail. Applying the quantifier to
 * only one of the two fields made the same workflow gating when red and invisible when merely
 * unfinished, so a repo whose fast workflows (build, lint) finish ahead of its slow one (a
 * self-hosted test suite) read fully green for as long as the gap between them — tens of minutes
 * on the measured repo, with `colab ship`'s autonomy path trusting exactly this verdict. The
 * not-yet-finished sha therefore falls through to the still-running branch below, which is the
 * state `classifyCiRun` already knows how to handle: SELF_CLEARING (retry later), or HUMAN_GATED
 * when tools/lib/ci-verdict.js finds the run WEDGED rather than merely slow. Nothing here waits or
 * polls — it reports what is true at read time and lets the caller decide.
 */
function ghRunForSha(repo, branch, limit = 10, remote = remoteInfo(repo).name || 'origin') {
  const head = run('git', ['ls-remote', remote, `refs/heads/${branch}`], { cwd: repo });
  if (!head.ok) return null;
  const sha = (head.stdout.split('\n')[0] || '').split('\t')[0].trim();
  if (!sha) return null; // branch does not exist on the remote
  return ghRunForCommit(repo, branch, sha, limit);
}

/**
 * The same per-sha verdict `ghRunForSha` computes for a branch's CURRENT remote head, generalized
 * to ANY sha reachable through `branch`'s workflow history (#293). `ghRunForSha` resolves its own
 * sha via `git ls-remote` — fine for "is this branch's head green", useless for "was the commit
 * this branch was CUT FROM green", which is almost never any branch's current head. Split out so
 * both callers share one allowlist rule (only `success`/`cancelled` are not-bad) rather than
 * silently drifting apart the way `shipCiCheck` and `ci-grant`'s red check once did (#155's frame).
 *
 * `branch` narrows the `gh run list` query exactly as it does in `ghRunForSha` (workflow runs list
 * by branch, not by sha) — pass the branch whose history `sha` lives on. For a base-sha check that
 * is almost always trunk, since the sha in question is the merge-base a feature branch was cut from.
 *
 * Returns the identical `{status, conclusion, sha, createdAt, databaseId, runCount}` shape as
 * `ghRunForSha` (see its doc comment for what each state means), or null on a `gh`/parse failure or
 * a missing `sha`. Never resolves `sha` itself — a caller with no sha to ask about has nothing to
 * pass here, unlike `ghRunForSha`'s branch-name convenience.
 */
/**
 * EVERY workflow run at one sha — the raw row list `ghRunForCommit` picks its single verdict from
 * (#321). Same query, same `--json` field set, same filter; split out so both share one filter
 * rather than drifting apart the way `shipCiCheck` and `ci-grant`'s red check once did.
 *
 * Returns the (possibly empty) array of rows at `sha`, or `null` on a `gh`/parse failure or a
 * missing `sha` — `null` is "the read failed", never "no runs", exactly as it is for the singular
 * function below.
 *
 * WHY A CALLER WOULD WANT ALL OF THEM. `ghRunForCommit` answers "is this sha green", for which one
 * picked row is the right answer. It is the WRONG answer for "which jobs are red at this sha": a
 * sha can carry several workflow runs, so building a red-job set from the one picked row could
 * miss a second failing workflow entirely. tools/lib/ci-cure.js's #321 carve-out needs the full
 * set for exactly that reason.
 */
function ghRunsForCommit(repo, branch, sha, limit = 10) {
  if (!sha) return null;

  // createdAt + databaseId are additive (#155): a NON-completed pick needs both to let a caller
  // judge whether it is merely slow or structurally WEDGED (tools/lib/ci-verdict.js) — createdAt for
  // the age backstop, databaseId to look up its job count (ghRunJobCount, below — a second call, made
  // lazily by the caller, never here: an ordinary green check must not pay for a read it never needs).
  const r = run('gh', ['run', 'list', '--branch', branch, '-L', String(limit),
    // workflowName is additive (#338): `colab release cut`'s full-suite condition groups the rows by
    // workflow — a workflow whose only run at the sha was cancelled never ran its suite.
    '--json', 'headSha,status,conclusion,createdAt,databaseId,workflowName'], { cwd: repo });
  if (!r.ok) return null;
  let runs;
  try { runs = JSON.parse(r.stdout); } catch (_) { return null; }
  if (!Array.isArray(runs)) return null;
  return runs.filter((x) => x && x.headSha === sha);
}

function ghRunForCommit(repo, branch, sha, limit = 10) {
  return summarizeRunsForCommit(ghRunsForCommit(repo, branch, sha, limit), sha);
}

/**
 * Every run at `sha` read by commit, not by branch recency (#339): `colab release finalize` checks
 * a candidate that may be days and many trunk runs old, which a `--branch main -L 10` window no
 * longer reaches. Same row shape as ghRunsForCommit; null on failure.
 */
function ghRunsAtCommit(repo, sha, limit = 100) {
  if (!sha) return null;
  const r = run('gh', ['run', 'list', '--commit', sha, '-L', String(limit),
    '--json', 'headSha,status,conclusion,createdAt,databaseId,workflowName,event'], { cwd: repo });
  if (!r.ok) return null;
  let runs;
  try { runs = JSON.parse(r.stdout); } catch (_) { return null; }
  if (!Array.isArray(runs)) return null;
  return runs.filter((x) => x && x.headSha === sha);
}

/**
 * Runs on `branch` created on or after `sinceDay` (YYYY-MM-DD; a caller filters the exact instant
 * locally) — #339's trunk-green-throughout read. Returns { runs, truncated } or null on failure;
 * `truncated` is true when the read filled its limit, which a caller must treat as unread.
 */
function ghRunsSince(repo, branch, sinceDay, limit = 1000) {
  const r = run('gh', ['run', 'list', '--branch', branch, '--created', `>=${sinceDay}`, '-L', String(limit),
    '--json', 'headSha,status,conclusion,createdAt,databaseId,workflowName,event'], { cwd: repo });
  if (!r.ok) return null;
  let runs;
  try { runs = JSON.parse(r.stdout); } catch (_) { return null; }
  if (!Array.isArray(runs)) return null;
  return { runs, truncated: runs.length >= limit };
}

/** ghRunForCommit's pick, over rows already read (null in -> null out). */
function summarizeRunsForCommit(forSha, sha) {
  if (forSha === null) return null;
  if (forSha.length === 0) return { status: 'none', conclusion: null, sha, createdAt: null, databaseId: null, runCount: 0 };

  // runCount (#176) is additive: how many sibling workflow rows exist at this sha, so a caller can
  // report "N runs at <sha>: all success" instead of a singular verdict that hides how many
  // workflows actually agreed. It is the row count BEFORE any of the picks below, not "how many
  // succeeded" — the picked row already tells the caller the conclusion; this tells it the sample size.
  const runCount = forSha.length;

  // A completed sibling whose conclusion is anything but success or cancelled makes the sha
  // not-green, regardless of any sibling that succeeded — checked BEFORE the success check below,
  // so it is never masked by a passing one on the same sha.
  const notGreen = forSha.find(
    (x) => x.status === 'completed' && x.conclusion !== 'success' && x.conclusion !== 'cancelled',
  );
  if (notGreen) return { status: 'completed', conclusion: notGreen.conclusion, sha, createdAt: notGreen.createdAt || null, databaseId: notGreen.databaseId || null, runCount };

  // A green verdict is owed only when EVERY sibling at this sha has finished (#307). A row that is
  // still queued/in_progress has not passed — it has not run — so picking the first completed
  // success here would stamp `runCount` (the FULL sibling count) onto a verdict that inspected one
  // row. Same all-quantifier as `notGreen` above, on `status` instead of `conclusion`; when it does
  // not hold, control reaches the still-running pick below.
  const allFinished = forSha.every((x) => x.status === 'completed');
  const success = allFinished ? forSha.find((x) => x.conclusion === 'success') : null;
  if (success) return { status: 'completed', conclusion: 'success', sha, createdAt: success.createdAt || null, databaseId: success.databaseId || null, runCount };

  // No green verdict is owed for this sha — either nothing succeeded, or something did while a
  // sibling is still unfinished (#307). Report the most informative row: a run still in flight (the
  // sha may yet go green) over a finished-but-not-successful one (gh returns newest-first, so
  // forSha[0] is the newest remaining row either way).
  const pending = forSha.find((x) => x.status !== 'completed');
  const pick = pending || forSha[0];
  return { status: pick.status, conclusion: pick.conclusion || null, sha, createdAt: pick.createdAt || null, databaseId: pick.databaseId || null, runCount };
}

/**
 * Job count for one workflow run (#155) — how many jobs GitHub has attached to it. A queued run
 * with ZERO jobs has not been picked up by any runner: the measured shape of a billing lockout or a
 * dead runner pool, and the PRIMARY signal tools/lib/ci-verdict.js uses to call a non-completed run
 * WEDGED rather than merely slow. Deliberately a separate call from `ghRunForSha` (never folded into
 * its `--json` field list): job counts require `gh run view`, one call per run, and the ordinary
 * green-trunk ship makes zero of these — callers fetch it lazily, only for a run that is already
 * non-completed and therefore a wedge candidate.
 *
 * Returns the job count, or null if it could not be read (gh failure, run gone) — null must NOT be
 * read as zero; a caller that cannot measure this falls back to the age backstop alone.
 */
function ghRunJobCount(repo, runDatabaseId) {
  if (runDatabaseId === null || runDatabaseId === undefined) return null;
  const r = run('gh', ['run', 'view', String(runDatabaseId), '--json', 'jobs', '-q', '.jobs | length'], { cwd: repo });
  if (!r.ok) return null;
  const n = Number(r.stdout);
  return Number.isFinite(n) ? n : null;
}

/**
 * The JOBS of one workflow run, with their steps (#321) — `[{name, status, conclusion, startedAt,
 * completedAt, steps: [{name, status, conclusion}]}]`, or `null` if it could not be read (gh
 * failure, run gone, unparseable body). `null` must NOT be read as "no jobs"; every consumer of
 * this fails closed on it.
 *
 * A SIBLING of `ghRunJobCount` above, deliberately not a refactor of it: that function sits on the
 * wedge-detection hot path, and rewriting it as `ghRunJobs(...).length` would be churn with real
 * regression surface for no gain here.
 *
 * Costs one `gh run view` per run, so callers fetch it LAZILY — tools/lib/ci-cure.js's #321
 * carve-out is the only caller today, and `colab ship` reaches it only for a branch that both
 * touches `.github/workflows/**` and is already blocked by a red trunk. Every other ship path
 * makes zero of these calls.
 *
 * Step-level detail is the whole point: GitHub reports a job whose steps were all SKIPPED as
 * `conclusion: success`, so run- and job-level conclusions are blind to exactly the fast-exit the
 * carve-out has to catch.
 */
function ghRunJobs(repo, runDatabaseId) {
  if (runDatabaseId === null || runDatabaseId === undefined) return null;
  const r = run('gh', ['run', 'view', String(runDatabaseId), '--json', 'jobs'], { cwd: repo });
  if (!r.ok) return null;
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch (_) { return null; }
  if (!parsed || !Array.isArray(parsed.jobs)) return null;
  return parsed.jobs.map((j) => ({
    name: j && j.name,
    status: j && j.status,
    conclusion: j && j.conclusion,
    startedAt: (j && j.startedAt) || null,
    completedAt: (j && j.completedAt) || null,
    steps: j && Array.isArray(j.steps)
      ? j.steps.map((s) => ({ name: s && s.name, status: s && s.status, conclusion: s && s.conclusion }))
      : null,
  }));
}

/**
 * Issues claimed by the current gh user in a repo = assigned to @me AND labeled in-progress
 * (that pairing is exactly what `colab claim` writes). Returns array of numbers, or null on failure.
 */
function ghAssignedIssues(repo) {
  const r = run('gh', ['issue', 'list', '--assignee', '@me', '--label', 'in-progress', '--state', 'open',
    '--json', 'number', '--limit', '200'], { cwd: repo });
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout).map((o) => o.number); }
  catch (_) { return null; }
}

module.exports = {
  run, git, repoRoot, mainRepoRoot, originUrl, remoteInfo, remoteName, remoteFor, remoteUrl, remoteProblem, _resetRemoteCache,
  detectTrunk, branchExists, branchRefs, existingBranchRef,
  claimRemote, remoteHeads,
  worktreeList, worktreeListDetailed, resolveWorktreePathForBranch, gitFailureLine,
  dirtyTracked, dirtyUntracked, dirtyAny,
  ghAvailable, ghState, ghIssueEdit, ghListLabels, ghAssignedIssues,
  ghCurrentLogin, ghIssueView, ghIssueComment, ghRunForSha, ghRunForCommit, ghRunsForCommit, ghRunsAtCommit, ghRunsSince, summarizeRunsForCommit,
  ghRunJobCount, ghRunJobs,
  ghIssueListByLabel, ghLabelDelete, ghLabelCreate, ghListLabelsDetailed, ghLabelEditDescription,
  ghApi, isGraphqlRateLimit, ghIssueRelease, ghClaimHolder, ghIssueLabelEvents,
  ghPrForBranch, ghPrCreate, ghPrClose, ghRepoVisibility,
};
