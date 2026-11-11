'use strict';
/**
 * Which workflow runs at a sha VERIFY the code there (#503) — the pure half of the rule `colab
 * ship`'s CI gate, `colab trunk-ci` and `colab ci-wait` read. No gh, no git, no I/O.
 *
 * THE RULE. A run counts toward "is this sha green" when its trigger is a push or a pull request
 * (`push`, `pull_request`, `pull_request_target`, `merge_group`) — the triggers that run a suite
 * against the code. A run of any OTHER trigger is set aside and named: `workflow_run` (the
 * handbook's own `release-auto.yml` fires on CI's completion, cuts a candidate, publishes, deploys
 * to staging — 20–30 min after the verifying run already finished), `schedule` (the same template's
 * daily finalize lands on trunk's head too), `workflow_dispatch`, `release`, `deployment`, … Those
 * runs come AFTER the verdict and act on it; their failure belongs to the release lane, so they
 * must neither turn trunk red for ship nor make ship wait for them.
 *
 * Measured (one adopted fork, 2026-10-05): CI green at 15:18Z, `Release (auto)` then in progress at
 * the same trunk sha, and four green, graded candidates parked behind it — every landing cost one
 * CI cycle plus one release cycle.
 *
 * A row with no `event` field (an older read, a hand-built fixture) is counted: absence of the field
 * never excludes anything, so every verdict computable before #503 without it is computed the same.
 *
 * OVERRIDES (project.yml), matched against the run's workflow `name:` — the only workflow identity
 * every run read carries (`gh run list` has no file path):
 *   ship-gate-workflows: [CI, Lint]     the explicit set: exactly these workflows count, whatever
 *                                       their trigger; every other workflow is set aside.
 *   ship-ignore-workflows: [Deploy]     set these aside too, even when push-triggered (a deploy
 *                                       workflow that fires on a push to trunk). Wins over the gate
 *                                       list for a name in both.
 *
 * A LOST PUSH (#567). The forge can drop a trunk commit's `push` event (measured: a ship's push landed
 * during a window of HTTP 500s and CI never started for that sha). Re-running is impossible (there is
 * no run), and dispatching the same CI workflow at that sha produced a `workflow_dispatch` run the
 * rule above set aside — so trunk stayed unmeasured until a human wrote an empty commit. Now: a
 * `workflow_dispatch` run COUNTS when (a) its workflow's own definition at that sha is triggered by a
 * branch push or a pull request — i.e. it is the workflow that verifies the code, not a release lane
 * that merely accepts a manual trigger — and (b) no push / pull-request run of that same workflow is
 * at the sha. (b) keeps the rescue narrow: where the push run exists, it is the verdict, as before.
 * The caller supplies (a) as `policy.dispatchVerifies(sha) → string[] | null` (the workflow names, read
 * from the tree at that sha — this module does no I/O); null / absent / unreadable → nothing is
 * rescued, the run stays set aside (fail closed). With `ship-gate-workflows` declared this rescue is
 * moot: the gate list already counts its workflows whatever their trigger.
 */

const VERIFYING_EVENTS = Object.freeze(['push', 'pull_request', 'pull_request_target', 'merge_group']);
const GATE_KEY = 'ship-gate-workflows';
const IGNORE_KEY = 'ship-ignore-workflows';

/** One list key: absent → null; a non-empty list of non-empty strings → the names; else invalid. */
function parseNameList(doc, key) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, key);
  if (!has || doc[key] === null || doc[key] === undefined) return { declared: false, valid: true, names: null };
  let v = doc[key];
  if (typeof v === 'string') v = [v];
  if (!Array.isArray(v) || v.length === 0) {
    return { declared: true, valid: false, names: null, reason: `${key} must be a non-empty list of workflow names (the workflow's \`name:\`), got ${JSON.stringify(doc[key])}` };
  }
  const bad = v.filter((x) => typeof x !== 'string' || !x.trim());
  if (bad.length) {
    return { declared: true, valid: false, names: null, reason: `${key} has ${bad.length} entr${bad.length === 1 ? 'y' : 'ies'} that ${bad.length === 1 ? 'is' : 'are'} not a workflow name: ${JSON.stringify(bad)}` };
  }
  return { declared: true, valid: true, names: v.map((x) => x.trim()) };
}

/**
 * The policy from a parsed project.yml doc: `{ gate: string[]|null, ignore: string[], valid,
 * problems: string[] }`. An invalid key is IGNORED by the reader (the default rule applies) and
 * reported by the audit — a malformed override must not silently widen what ship counts as green
 * in either direction, and the default is the measured-safe reading.
 */
function parsePolicy(doc) {
  const g = parseNameList(doc, GATE_KEY);
  const i = parseNameList(doc, IGNORE_KEY);
  const problems = [g, i].filter((x) => !x.valid).map((x) => x.reason);
  return {
    gate: g.valid ? g.names : null,
    ignore: i.valid && i.names ? i.names : [],
    valid: problems.length === 0,
    problems,
  };
}

/** Why one row is set aside, or null when it counts. */
function setAsideReason(row, policy) {
  const p = policy || { gate: null, ignore: [] };
  const name = row && row.workflowName;
  if (name && p.ignore && p.ignore.includes(name)) return `${IGNORE_KEY}`;
  if (p.gate) return name && p.gate.includes(name) ? null : `not in ${GATE_KEY}`;
  const ev = row && row.event;
  if (ev === undefined || ev === null || ev === '') return null;
  return VERIFYING_EVENTS.includes(ev) ? null : `event: ${ev}`;
}

/**
 * Split rows into `{ counted, setAside, dispatchCounted }`; each set-aside row carries `setAsideWhy`,
 * and `dispatchCounted` lists the `workflow_dispatch` rows the lost-push rescue (#567) moved into
 * `counted`. Null in → null out.
 */
function splitVerifying(rows, policy) {
  if (!Array.isArray(rows)) return null;
  const counted = [];
  let setAside = [];
  for (const r of rows) {
    const why = setAsideReason(r, policy);
    if (why) setAside.push({ ...r, setAsideWhy: why });
    else counted.push(r);
  }
  const dispatchCounted = [];
  const resolver = policy && typeof policy.dispatchVerifies === 'function' ? policy.dispatchVerifies : null;
  const candidates = setAside.filter((x) => x.setAsideWhy === 'event: workflow_dispatch' && x.workflowName
    && !counted.some((c) => c.workflowName === x.workflowName));
  if (resolver && candidates.length) {
    const byShas = new Map();
    const namesAt = (sha) => {
      if (!byShas.has(sha)) {
        let v = null;
        try { v = resolver(sha); } catch (_) { v = null; }
        byShas.set(sha, Array.isArray(v) ? v : null);
      }
      return byShas.get(sha);
    };
    const keep = [];
    for (const x of setAside) {
      const names = candidates.includes(x) && x.headSha ? namesAt(x.headSha) : null;
      if (names && names.includes(x.workflowName)) {
        const { setAsideWhy, ...row } = x;
        counted.push(row);
        dispatchCounted.push(row);
      } else keep.push(x);
    }
    setAside = keep;
  }
  return { counted, setAside, dispatchCounted };
}

/** Strip a trailing ` # comment` and matching quotes from a one-line YAML scalar. */
function yamlScalar(raw) {
  let v = String(raw).replace(/\s+#.*$/, '').trim();
  if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) v = v.slice(1, -1);
  return v;
}

const BRANCH_TRIGGERS = Object.freeze(['push', 'pull_request', 'pull_request_target', 'merge_group']);

/**
 * What one workflow file says about itself (#567): `{ name, verifiesBranches }`, or null when the text
 * has no top-level `on:` at all. `name` is the top-level `name:` (null when absent — GitHub then names
 * the workflow by its path, which the caller knows). `verifiesBranches` is true when the triggers
 * include a pull request, or a push that is not tags-only (`push: { tags: [...] }` with no
 * `branches`/`branches-ignore` is a release lane, never a code verifier). A deliberately small reader
 * of the three `on:` shapes (scalar, flow list, block map / block list) — not a YAML parser.
 */
function workflowTriggers(text) {
  const parsed = onEvents(text);
  if (!parsed) return null;
  const { name, events } = parsed;
  let verifies = false;
  for (const [ev, e] of events) {
    if (!BRANCH_TRIGGERS.includes(ev)) continue;
    if (ev !== 'push') { verifies = true; break; }
    const keys = e.body.map((b) => (/^([A-Za-z_-]+)\s*:/.exec(b.text) || [])[1]).filter(Boolean);
    const tagsOnly = (keys.includes('tags') || keys.includes('tags-ignore')) && !keys.includes('branches') && !keys.includes('branches-ignore');
    if (!tagsOnly) { verifies = true; break; }
  }
  return { name, verifiesBranches: verifies };
}

/**
 * The top-level `name:` and the `on:` events of one workflow file: `{ name, events }`, or null when
 * the text has no top-level `on:`. `events` maps an event name to `{ inline, body }` — `inline` is
 * what follows `<event>:` on its own line ('' for the block form), `body` the child lines with their
 * indent (`{ indent, text }`, text trimmed). The scalar and flow-list forms of `on:` give events with
 * no inline value and no body. Shared by workflowTriggers (#567) and pushTrigger (#723).
 */
function onEvents(text) {
  const lines = String(text || '').split(/\r?\n/);
  let name = null;
  let onIdx = -1;
  let onInline = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m = /^name:\s*(.*)$/.exec(l);
    if (m && name === null) { name = yamlScalar(m[1]) || null; continue; }
    m = /^(?:on|"on"|'on'|true):\s*(.*)$/.exec(l);
    if (m && onIdx < 0) { onIdx = i; onInline = yamlScalar(m[1]); }
  }
  if (onIdx < 0) return null;
  const events = new Map();
  if (onInline) {
    const list = onInline.startsWith('[') ? onInline.replace(/^\[|\]$/g, '').split(',') : [onInline];
    for (const e of list) { const v = yamlScalar(e); if (v) events.set(v, { inline: '', body: [] }); }
  } else {
    let evIndent = null;
    let cur = null;
    for (let i = onIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const indent = l.length - l.trimStart().length;
      if (indent === 0) break;
      if (evIndent === null) evIndent = indent;
      if (indent < evIndent) break;
      if (indent === evIndent) {
        const t = l.trim();
        const li = /^-\s*(.+)$/.exec(t);
        const mk = li ? null : /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(t);
        cur = li ? yamlScalar(li[1].replace(/:.*$/, '')) : (mk ? yamlScalar(mk[1]) : null);
        if (cur) events.set(cur, { inline: mk ? yamlScalar(mk[2]) : '', body: [] });
      } else if (cur) events.get(cur).body.push({ indent, text: l.trim() });
    }
  }
  return { name, events };
}

/** A YAML flow list `[a, 'b', "c"]` or a single scalar → the strings; '' → []. */
function flowList(v) {
  const t = String(v || '').trim();
  if (!t) return [];
  const inner = t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t;
  return inner.split(',').map(yamlScalar).filter(Boolean);
}

const PUSH_FILTER_KEYS = Object.freeze(['branches', 'branches-ignore', 'tags', 'tags-ignore', 'paths', 'paths-ignore']);

/**
 * #723: what one workflow file says about a BRANCH PUSH — the question "should this workflow have a
 * run at the head of branch B?" asks. Returns null when the text has no top-level `on:`, else
 * `{ name, push, readable, branches, branchesIgnore, tagsOnly, paths, dispatch }`:
 *   push            the triggers include `push`
 *   readable        the push filters were read; false for a shape this small reader does not follow
 *                   (a flow map `push: {…}`, an unknown key) — the caller then never expects a run
 *   branches / branchesIgnore   the glob lists, null when absent
 *   tagsOnly        `tags`/`tags-ignore` with no branch filter: a branch push never fires it
 *   paths           a `paths` / `paths-ignore` filter is present: whether a push fires it depends on
 *                   the files the push changed, which this reader does not judge
 *   dispatch        the triggers include `workflow_dispatch` — `gh workflow run` can give it a run
 * Not a YAML parser; the same deliberately small reader as workflowTriggers.
 */
function pushTrigger(text) {
  const parsed = onEvents(text);
  if (!parsed) return null;
  const { name, events } = parsed;
  const out = { name, push: events.has('push'), readable: true, branches: null, branchesIgnore: null,
    tagsOnly: false, paths: false, dispatch: events.has('workflow_dispatch') };
  if (!out.push) return out;
  const e = events.get('push');
  if (e.inline && !['null', '~', '{}'].includes(e.inline)) { out.readable = false; return out; }
  const lists = {};
  let key = null;
  let keyIndent = null;
  for (const b of e.body) {
    if (keyIndent === null) keyIndent = b.indent;
    if (b.indent === keyIndent) {
      const m = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(b.text);
      if (!m || !PUSH_FILTER_KEYS.includes(m[1])) { out.readable = false; return out; }
      key = m[1];
      lists[key] = flowList(m[2]);
    } else if (key && b.indent > keyIndent) {
      const li = /^-\s*(.+)$/.exec(b.text);
      if (!li) { out.readable = false; return out; }
      lists[key].push(yamlScalar(li[1]));
    } else { out.readable = false; return out; }
  }
  out.branches = lists.branches || null;
  out.branchesIgnore = lists['branches-ignore'] || null;
  out.tagsOnly = !!(lists.tags || lists['tags-ignore']) && !out.branches && !out.branchesIgnore;
  out.paths = !!(lists.paths || lists['paths-ignore']);
  return out;
}

/**
 * One GitHub filter pattern (`*` not across `/`, `**` across, `?` / `+` / `[…]` on the preceding
 * character as in a regex) → a RegExp over the whole branch name, or null when it cannot be read.
 */
function filterPatternRe(p) {
  let re = '';
  const s = String(p);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '*') { if (s[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*'; }
    else if (c === '?' || c === '+') re += c;
    else if (c === '[') { const j = s.indexOf(']', i); if (j < 0) return null; re += s.slice(i, j + 1); i = j; }
    else if (c === '\\') { if (i + 1 >= s.length) return null; re += s[i + 1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); i++; }
    else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  try { return new RegExp(`^${re}$`); } catch (_) { return null; }
}

/**
 * #723: does a push to `branch` pass a workflow's branch filters? true / false, or null when a
 * pattern cannot be read. `branches` is ordered with `!` negations (the last match decides);
 * `branches-ignore` excludes on any match. Neither list → true.
 */
function branchFilterMatches(branch, { branches = null, branchesIgnore = null } = {}) {
  if (branches) {
    let hit = false;
    for (const raw of branches) {
      const neg = raw.startsWith('!');
      const re = filterPatternRe(neg ? raw.slice(1) : raw);
      if (!re) return null;
      if (re.test(branch)) hit = !neg;
    }
    return hit;
  }
  if (branchesIgnore) {
    for (const raw of branchesIgnore) {
      const re = filterPatternRe(raw);
      if (!re) return null;
      if (re.test(branch)) return false;
    }
  }
  return true;
}

/** GitHub's skip directives (docs: "Skipping workflow runs") — a push run is not created for them. */
const SKIP_DIRECTIVES = Object.freeze(['[skip ci]', '[ci skip]', '[no ci]', '[skip actions]', '[actions skip]']);

function skipsWorkflows(message) {
  const m = String(message || '');
  const low = m.toLowerCase();
  return SKIP_DIRECTIVES.some((d) => low.includes(d)) || /^skip-checks:\s*true\s*$/mi.test(m);
}

/**
 * #723: the workflows that SHOULD have a push run at the head of `branch` — the expected set a
 * branch verdict reads before it may call the head green. A workflow is expected when its definition
 * AT THE HEAD (GitHub reads the workflow file from the pushed commit):
 *   - is triggered by `push`, read cleanly, not tags-only, with no `paths` / `paths-ignore` filter,
 *   - passes its branch filters for `branch` (an unreadable pattern → not expected),
 *   - is not in `ship-ignore-workflows`, and is in `ship-gate-workflows` when that list is declared,
 *   - is not reported anything but `active` by the workflows API (`states`: path → `{state, id, name}`
 *     or a bare state string; null = unread, every workflow taken as active). The API's `id` and
 *     `name` ride on the entry, so a run is matched by its workflow id too (git.js missingExpected).
 * Nothing is expected when the head commit's message carries a skip directive (`headMessage`).
 *
 * Every doubt resolves to NOT expected: that is today's reading (the runs that exist decide), so the
 * set can only add a hold where a workflow demonstrably should have run, never invent one.
 *
 * @param {object} a
 * @param {Array<{path:string, text:string}>} a.defs  - the workflow files at the head
 * @param {string} a.branch
 * @param {object} [a.policy]       - parsePolicy's `{gate, ignore}`
 * @param {Map<string,(string|{state:string, id:number, name:string})>|null} [a.states]
 * @param {string|null} [a.headMessage]
 * @returns {{ expected: Array<{name:string, path:string, dispatch:boolean, id?:number, apiName?:string}>, skipDirective: boolean }}
 */
function expectedWorkflows({ defs, branch, policy = null, states = null, headMessage = null }) {
  if (skipsWorkflows(headMessage)) return { expected: [], skipDirective: true };
  const p = policy || { gate: null, ignore: [] };
  const expected = [];
  for (const d of defs || []) {
    const t = pushTrigger(d.text);
    if (!t || !t.push || !t.readable || t.tagsOnly || t.paths) continue;
    if (branchFilterMatches(branch, t) !== true) continue;
    const name = t.name || d.path;
    if (p.ignore && p.ignore.includes(name)) continue;
    if (p.gate && !p.gate.includes(name)) continue;
    const st = states && states.has(d.path) ? states.get(d.path) : null;
    const info = st && typeof st === 'object' ? st : { state: st };
    if (info.state && info.state !== 'active') continue;
    expected.push({ name, path: d.path, dispatch: t.dispatch,
      ...(info.id != null ? { id: info.id } : {}), ...(info.name && info.name !== name ? { apiName: info.name } : {}) });
  }
  return { expected, skipDirective: false };
}

/**
 * #723: how to get a run for each missing workflow — a hint, never an action. `gh workflow run` where
 * the workflow takes `workflow_dispatch` (#567 counts that run as the push run it stands in for);
 * otherwise a draft PR, or an empty re-push, which is the implementer's call.
 */
function missingHint(missing, branch) {
  const list = Array.isArray(missing) ? missing : [];
  if (!list.length) return '';
  const b = branch || '<branch>';
  const parts = list.map((x) => (x.dispatch
    ? `\`gh workflow run ${String(x.path || x.name).split('/').pop()} --ref ${b}\``
    : `${x.name}: no workflow_dispatch — open a draft PR (\`gh pr create --draft --head ${b}\`) or push an empty commit (the implementer's call)`));
  return `to get the run: ${parts.join('; ')}`;
}

/** #723: the verdict-detail suffix naming the expected workflows with no run at the sha — '' when none. */
function missingNote(missing, branch) {
  const list = Array.isArray(missing) ? missing : [];
  if (!list.length) return '';
  return ` — no run of ${list.map((x) => x.name).join(', ')} at this sha, though ${list.length === 1 ? 'its' : 'their'} definition fires on a push to this branch (#723); ${missingHint(list, branch)}`;
}

/** The compact verdict-detail note for rows the lost-push rescue counted — '' when none. */
function dispatchCountedNote(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const names = list.map((x) => `${x.workflowName || 'unnamed'}${x.databaseId ? ` (run ${x.databaseId})` : ''}`);
  return ` — counted ${list.length} workflow_dispatch run${list.length === 1 ? '' : 's'} of a push-verifying workflow with no push run at this sha (lost push event, #567): ${names.join(', ')}`;
}

/**
 * The verdict-detail suffix naming what was set aside — '' when nothing was. `rows` is the compact
 * summary shape (`{workflowName, status, conclusion, databaseId, why}`).
 */
function setAsideNote(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const names = list.map((x) => `${x.workflowName || 'unnamed'} (${x.conclusion || x.status || '?'}${x.databaseId ? `, run ${x.databaseId}` : ''}${x.why ? `; ${x.why}` : ''})`);
  return ` — set aside ${list.length} run${list.length === 1 ? '' : 's'} that do${list.length === 1 ? 'es' : ''} not verify the code (post-CI release/deploy lane, #503): ${names.join(', ')}`;
}

/**
 * #688: the wholly skipped workflows a verdict did not judge (git.js setAsideWhollySkipped), named so a
 * reader can see a gated workflow did not run. '' when none.
 */
function skippedOnlyNote(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const names = list.map((x) => `${x.workflowName || 'unnamed'}${x.databaseId ? ` (run ${x.databaseId})` : ''}`);
  return ` — not judged, every run skipped so it ran nothing here (#688; name a workflow in ship-gate-workflows if it must run): ${names.join(', ')}`;
}

module.exports = {
  VERIFYING_EVENTS, GATE_KEY, IGNORE_KEY, SKIP_DIRECTIVES, parsePolicy, setAsideReason, splitVerifying, setAsideNote, skippedOnlyNote,
  workflowTriggers, pushTrigger, branchFilterMatches, skipsWorkflows, expectedWorkflows, missingHint, missingNote, dispatchCountedNote,
};
