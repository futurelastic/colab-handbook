'use strict';

/**
 * The session-branch NAME, per CONVENTIONS.md §4 — the one place its shape is defined (#348).
 *
 * Two shapes, both conforming:
 *
 *   <type>/<slug>-<N…>                    the original shape, and still the default
 *   <login>/<machine>/<type>/<slug>-<N…>  the machine-carried shape, emitted once a repo declares
 *                                         `branchPrefix: machine` in .github/project.yml
 *
 * The prefix is what makes a branch pushed to origin read as ONE MACHINE's work claim: the forge
 * account that holds it and the machine it was cut on, readable by any other machine from the ref
 * alone. The issue numbers stay in the TRAILING `-<N>` run in both shapes, so every reader that
 * anchors at the end of the name (ship's harvest, the remote-claim check, the skills' `(-[0-9]+)+$`)
 * reads either shape without knowing the prefix exists.
 *
 * The shapes cannot be confused: the unprefixed slug class has no `/`, so a name with four
 * `/`-separated segments can only be the prefixed shape, and a name with two only the original one.
 * `test/box/feat/x-1` is login `test`, machine `box`, type `feat` — never type `test`.
 *
 * Pure: no git, no network. `machineLabel` reads nothing — the caller hands it the hostname.
 */

const { canonHost } = require('./machine.js');

const TYPES = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'perf', 'design'];

// Kept as a SOURCE STRING, not only a RegExp, because it is shared verbatim with places that cannot
// `require` this file — CONVENTIONS.md §4 prints it, and templates/branch-name.yml runs it in bash.
// branch-name.test.js asserts both copies are byte-identical to this one.
const BRANCH_RE_SOURCE =
  '^([a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*/)?(feat|fix|docs|chore|refactor|test|perf|design)/[a-z0-9._-]+$';
const BRANCH_RE = new RegExp(BRANCH_RE_SOURCE);

// One prefix segment (a login or a machine label): same class the regex's prefix group uses.
const SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Issue numbers a branch NAME claims: the numbers live in one trailing run.
 *
 * Anchored to the trailing run deliberately — a naive sweep for every `\d+` reads
 * `feat/oauth2-login-88` as issues 2 and 88, and an invented issue number is exactly the class of
 * error this exists to prevent. `fix/import-fixes-115-114-113` → [115, 114, 113], and the prefixed
 * `ada/box-a/fix/import-fixes-115-114-113` → the same, because the prefix is at the other end.
 *
 * Returns [] for a branch that carries no trailing number group. That is not an error: plenty of
 * legitimate branches predate the rule (§4 grandfathers them), so callers must treat [] as "this
 * source has nothing to say", never as "this branch claims no issues".
 */
function branchIssueNumbers(branchName) {
  const m = /-(\d+(?:-\d+)*)$/.exec(String(branchName || ''));
  if (!m) return [];
  return m[1].split('-').map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * A §4-conforming name → `{ login, machine, type, rest, slug, issues, prefixed }`, or `null` when the
 * name conforms to neither shape. `rest` is `<slug>-<N…>` (everything after the type); `slug` is
 * `rest` minus its trailing issue run. `login`/`machine` are `null` on the unprefixed shape.
 */
function parse(name) {
  const s = String(name || '');
  if (!BRANCH_RE.test(s)) return null;
  const parts = s.split('/');
  const prefixed = parts.length === 4;
  const [login, machine] = prefixed ? parts.slice(0, 2) : [null, null];
  const type = prefixed ? parts[2] : parts[0];
  const rest = parts[parts.length - 1];
  const slug = rest.replace(/-\d+(?:-\d+)*$/, '');
  return { login, machine, type, rest, slug, issues: branchIssueNumbers(s), prefixed };
}

/** The inverse of `parse`: `{ login?, machine?, type, rest }` → a branch name. */
function format({ login, machine, type, rest }) {
  const base = `${type}/${rest}`;
  return login && machine ? `${login}/${machine}/${base}` : base;
}

/**
 * The machine segment of the prefix, from a hostname: `canonHost` (first label, lowercased), then
 * every character outside `[a-z0-9-]` becomes `-`, repeats collapse, edges trim. `Box_A.local` →
 * `box-a`. A LABEL, not an identity: two machines with the same canonical hostname share it. Claim
 * comparisons stay on the hardware digest (lib/machine.js) — never on this.
 */
function machineLabel(host) {
  return canonHost(host).replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * The branch `colab worktree new` should create, given what the caller passed and whether the repo
 * adopted the prefix. Returns `{ branch }` or `{ error }` (a sentence for the operator).
 *
 *   - not adopted → the name as given, unchanged (any shape — the unprefixed default stays legal).
 *   - adopted, already prefixed → accepted only if the prefix names THIS login (when known) and THIS
 *     machine label; a prefix naming another machine would plant a claim record in its name.
 *   - adopted, unprefixed → `<login>/<machine>/` prepended. No resolvable login → error: the operator
 *     may spell the full prefixed name instead, which needs no network (#325: a tracker outage never
 *     blocks a claim).
 */
function sessionBranch(name, { adopted, login, machine }) {
  if (!adopted) return { branch: name };
  const p = parse(name);
  if (!p) {
    return { error: `"${name}" does not match CONVENTIONS.md §4 (${BRANCH_RE_SOURCE}) — this repo declares branchPrefix: machine, so the name is checked before anything is created` };
  }
  const me = login ? String(login).toLowerCase() : '';
  if (!machine || !SEGMENT_RE.test(machine)) {
    return { error: `cannot derive a machine label for the branch prefix from this host's name ("${machine || ''}")` };
  }
  if (p.prefixed) {
    if (p.machine !== machine) return { error: `"${name}" names machine "${p.machine}", but this machine's label is "${machine}" — a prefix is a claim in that machine's name` };
    if (me && p.login !== me) return { error: `"${name}" names login "${p.login}", but this account is "${me}"` };
    return { branch: name };
  }
  if (!me || !SEGMENT_RE.test(me)) {
    return { error: `this repo declares branchPrefix: machine, but the forge login could not be resolved (gh api user). Pass the full name instead: <login>/${machine}/${name}` };
  }
  return { branch: format({ login: me, machine, type: p.type, rest: p.rest }) };
}

/**
 * The default worktree directory name for a branch: `rest` for a §4 name (`feat/x-23` and
 * `ada/box-a/feat/x-23` both → `x-23`), else everything after the first `/` — the rule that
 * predates this module, kept for grandfathered names.
 */
function worktreeName(branch) {
  const p = parse(branch);
  if (p) return p.rest;
  const s = String(branch || '');
  return s.includes('/') ? s.slice(s.indexOf('/') + 1) : s;
}

module.exports = {
  TYPES, BRANCH_RE_SOURCE, BRANCH_RE,
  branchIssueNumbers, parse, format, machineLabel, sessionBranch, worktreeName,
};
