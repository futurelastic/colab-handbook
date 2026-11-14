'use strict';
/**
 * tools/lib/tracker.js — the tracker contract (#500): what the CLI asks of an issue tracker, named
 * once, so an implementation other than GitHub (and #501's in-memory fake) has a method set to
 * satisfy instead of a scatter of `gh` argv to imitate.
 *
 * The only real implementation today is tools/lib/tracker-github.js; tools/lib/tracker-fake.js is an
 * in-memory one (#501). What every implementation must do is specified as data, in
 * tools/lib/tracker-scenarios.json, and tools/lib/tracker-contract.test.js runs those scenarios
 * against both. Semantics every implementation keeps:
 *   - synchronous — the CLI is spawnSync throughout;
 *   - bound to one repo — `forRepo(repoAbs)` fixes it, so no method takes a repo argument;
 *   - never throws on an environment failure (no tracker binary, no remote, offline): results are
 *     data. Writes return `{ ok, code, stdout, stderr, … }`; list reads add `data`, `null` meaning
 *     "could not read" and never "none"; the read helpers keep their existing null-on-failure
 *     contract.
 *
 * CI verdict (#678): `ciVerdict(sha, { branch })` answers "is this sha green" as ONE summary —
 * `{ status, conclusion, sha, createdAt, databaseId, runCount, … }` (tools/lib/git.js
 * `summarizeRunsForCommit`'s shape, the one ship's CI rows and the docs-only row already read), or
 * null when the read failed. `status: 'none'` is "no run at this sha", never "could not read". A
 * forge the CLI lands code on and releases on, but never writes issues to, implements
 * `FORGE_METHODS` (#681): the CI verdict, a READ of the issue list, and the release object —
 * tools/lib/ci-forgejo.js, Forgejo commit statuses and `/releases`. `CI_METHODS` stays the subset
 * the landing path (#678) needs. Which engine a repo gets is `engineFor` below.
 *
 * Batch turn (#742): `runsAtRef(ref, sha)` — every CI run on one ref at one sha, as rows
 * `{ headSha, status, conclusion, createdAt, updatedAt, databaseId, workflowName, attempt? }`, or null
 * when the read failed ([] is "no run yet"). `colab ship --batch` judges its combined run from these
 * (the attempt caps the one re-run; updatedAt dates a green settle). A forge whose CI is a commit
 * status reads the commit and ignores the ref, and may omit `attempt` (read as 1).
 *
 * Deliberately NOT in the contract yet (#501 left it so: no scenario needs them, and each would
 * pin a GitHub-only shape into a spec other trackers must satisfy): the raw CI-run lists and REST
 * probes behind `ciVerdict`, label create/delete/edit, raw `issue edit` flags and raw `api`
 * access. They still reach `gh` only through the adapter's `exec`.
 */

const METHODS = Object.freeze([
  { name: 'state', kind: 'read', returns: '{ ok, reason }' },
  { name: 'currentLogin', kind: 'read', returns: 'login | null' },
  { name: 'issueView', kind: 'read', returns: 'object | null' },
  { name: 'issueListAll', kind: 'read', returns: 'result + data: issue[] | null' },
  { name: 'issueCreate', kind: 'write', returns: 'result + number, url' },
  { name: 'issueComment', kind: 'write', returns: 'result' },
  { name: 'issueClose', kind: 'write', returns: 'result' },
  { name: 'issueRelease', kind: 'write', returns: '{ ok, stderr, code, others, caller, note }' },
  { name: 'claimHolder', kind: 'read', returns: '{ assignees, claimer }' },
  { name: 'labelList', kind: 'read', returns: 'name[] | null' },
  { name: 'prForBranch', kind: 'read', returns: '{ pr } | { error }' },
  { name: 'prCreate', kind: 'write', returns: '{ ok, url, stderr }' },
  { name: 'prClose', kind: 'write', returns: 'result' },
  { name: 'prList', kind: 'read', returns: 'result + data: pr[] | null' },
  { name: 'prEdit', kind: 'write', returns: 'result' },
  { name: 'runList', kind: 'read', returns: 'result + data: run[] | null' },
  { name: 'ciVerdict', kind: 'read', returns: 'run summary | null' },
  { name: 'runsAtRef', kind: 'read', returns: 'run[] | null' },
  { name: 'releaseView', kind: 'read', returns: 'result' },
  { name: 'releaseCreate', kind: 'write', returns: 'result' },
].map(Object.freeze));

/** The methods the landing path reads on a forge (#678): the CI verdict alone. */
const CI_METHODS = Object.freeze(['ciVerdict']);

/**
 * The methods a forge engine implements (#681): landing (`CI_METHODS`), the batch turn's run read
 * (#742, `runsAtRef`), plus what a release needs —
 * the issue list READ (switch markers, the release hold, an existing tracking record) and the release
 * object. No issue write is here on purpose: #678's ruling keeps the forge's tracker the adopter's.
 */
const FORGE_METHODS = Object.freeze([...CI_METHODS, 'runsAtRef', 'issueListAll', 'releaseView', 'releaseCreate']);

/**
 * Throw, naming every contract method `impl` lacks. Returns `impl` when it is complete.
 * `names` narrows the check to a subset (CI_METHODS for a CI-only engine); default: the whole contract.
 */
function assertImplements(impl, label = 'tracker', names = null) {
  const want = names ? METHODS.filter((m) => names.includes(m.name)) : METHODS;
  const missing = want.filter((m) => !impl || typeof impl[m.name] !== 'function').map((m) => m.name);
  if (missing.length) throw new Error(`${label} does not implement the tracker contract: missing ${missing.join(', ')}`);
  return impl;
}

const KINDS = { github: () => require('./tracker-github'), fake: () => require('./tracker-fake') };
const _checked = new Set();

/** The tracker for one repo. `kind` defaults to the one implementation, `github`. */
function forRepo(repoAbs, { kind = 'github' } = {}) {
  const load = KINDS[kind];
  if (!load) throw new Error(`unknown tracker kind "${kind}" (known: ${Object.keys(KINDS).join(', ')})`);
  const impl = load().create(repoAbs);
  if (!_checked.has(kind)) { assertImplements(impl, `tracker "${kind}"`); _checked.add(kind); }
  return impl;
}

// ---------------------------------------------------------------------------------------------
// Engine choice by remote host (#678)
// ---------------------------------------------------------------------------------------------

/** Engines the map may name. `github` is the default for every host the map does not name. */
const ENGINES = Object.freeze(['github', 'forgejo']);
const DEFAULT_TOKEN_ENV = 'FORGEJO_TOKEN';

/** `{ host, owner, repo }` for a remote URL (https, ssh://, scp-like), or null. Pure. */
function parseRemoteUrl(url) {
  const s = String(url || '').trim();
  let m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(?:(.+)\/)?([^/]+)\/([^/]+?)(?:\.git)?\/*$/i.exec(s);
  if (m) return { host: m[1].toLowerCase(), owner: m[3], repo: m[4] };
  m = /^(?:[^@/\s]+@)?([^:/\s]+):(?:(.+)\/)?([^/]+)\/([^/]+?)(?:\.git)?\/*$/.exec(s);
  if (m) return { host: m[1].toLowerCase(), owner: m[3], repo: m[4] };
  return null;
}

/**
 * The engine for one remote URL, from a parsed machine config. Pure.
 *
 * The map is `forges` in the machine config (`$COLAB_HOME/config.json`, never a tracked file):
 *   { "forges": { "<host>": { "engine": "forgejo", "api": "https://<host>/api/v1", "tokenEnv": "FORGEJO_TOKEN" } } }
 * `api` defaults to `https://<host>/api/v1`, `tokenEnv` to FORGEJO_TOKEN. A host the map does not
 * name, a URL that does not parse, and a missing config all read `github` — today's behaviour.
 * An entry naming an engine this CLI does not know is `invalid` (and reads github), never a guess.
 *
 * Returns `{ engine, host, owner, repo, api, tokenEnv, source: 'default'|'map'|'invalid', why }`.
 */
function engineFromConfig(url, cfg) {
  const p = parseRemoteUrl(url);
  const base = { engine: 'github', host: p ? p.host : null, owner: p ? p.owner : null, repo: p ? p.repo : null,
    api: null, tokenEnv: null, source: 'default', why: '' };
  if (!p) return base;
  const forges = cfg && typeof cfg === 'object' && cfg.forges && typeof cfg.forges === 'object' ? cfg.forges : null;
  const ent = forges ? (forges[p.host] ?? Object.entries(forges).find(([k]) => k.toLowerCase() === p.host)?.[1]) : undefined;
  if (ent === undefined || ent === null) return base;
  const engine = typeof ent === 'string' ? ent : (ent && typeof ent === 'object' ? ent.engine : null);
  if (!ENGINES.includes(engine)) {
    return { ...base, source: 'invalid', why: `forges["${p.host}"] in the machine config names engine ${JSON.stringify(engine)} (known: ${ENGINES.join(', ')}) — read as github` };
  }
  if (engine === 'github') return { ...base, source: 'map' };
  const o = typeof ent === 'object' ? ent : {};
  const api = String(o.api || `https://${p.host}/api/v1`).replace(/\/+$/, '');
  const tokenEnv = typeof o.tokenEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(o.tokenEnv) ? o.tokenEnv : DEFAULT_TOKEN_ENV;
  return { ...base, engine, api, tokenEnv, source: 'map' };
}

/** The machine config, parsed; `{}` when absent or unreadable (the engine then reads github). */
function readMachineConfig(configFile) {
  try { return JSON.parse(require('fs').readFileSync(configFile || require('./state').CONFIG_FILE, 'utf8')) || {}; } catch (_) { return {}; }
}

const _engineCache = new Map();
function _resetEngineCache() { _engineCache.clear(); }

/**
 * The engine for one repo: its resolved remote's CONFIGURED url (not `git remote get-url`, which
 * expands `url.<x>.insteadOf` — that rewrites how git reaches the remote, never which forge it is;
 * the same read tracker-github's pinnedRepo makes) looked up in the machine config's `forges`.
 * Never throws. Cached per resolved repo path for the life of the process.
 */
function engineFor(repoAbs, { configFile = null } = {}) {
  const key = require('path').resolve(repoAbs || process.cwd());
  if (!configFile && _engineCache.has(key)) return _engineCache.get(key);
  let url = null;
  try {
    const g = require('./git');
    const { name } = g.remoteInfo(key);
    const u = name ? g.git(['config', '--get', `remote.${name}.url`], key) : null;
    url = u && u.ok ? u.stdout : null;
  } catch (_) { url = null; }
  const eng = engineFromConfig(url, readMachineConfig(configFile));
  if (!configFile) _engineCache.set(key, eng);
  return eng;
}

const CI_KINDS = { forgejo: () => require('./ci-forgejo') };

/**
 * The forge engine for one repo, or null when its engine is GitHub — the caller keeps its existing,
 * gh-based reads there, which `ciVerdict` on the GitHub tracker wraps one-for-one. Non-null only
 * for an engine the map names (#678); it implements FORGE_METHODS (#681).
 */
function ciFor(repoAbs, opts = {}) {
  const eng = engineFor(repoAbs, opts);
  const load = CI_KINDS[eng.engine];
  if (!load) return null;
  const impl = load().create(repoAbs, eng);
  if (!_checked.has(`ci:${eng.engine}`)) { assertImplements(impl, `forge engine "${eng.engine}"`, FORGE_METHODS); _checked.add(`ci:${eng.engine}`); }
  return impl;
}

module.exports = {
  METHODS, CI_METHODS, FORGE_METHODS, ENGINES, assertImplements, forRepo,
  parseRemoteUrl, engineFromConfig, engineFor, ciFor, _resetEngineCache,
};
