'use strict';
/**
 * tools/lib/config-set.js — a TUNING change to `.github/project.yml`, made and shipped cheaply (#561).
 *
 * Before this module, changing one repo-owned value (`ship-batch: 2`, a threshold) cost an issue, a
 * code session, a wrap and a ship — the same ceremony as a feature. Repos that pay that much per
 * tuning step do not tune. The descriptor stays committed (CI templates read it from the commit,
 * worktrees are cut from git, and authority-granting fields need their review trail), so the cost is
 * cut on two sides instead:
 *
 *   1. `colab config set <key> <value>` writes ONE tuning key, validated by the same parser every
 *      reader of that key uses, and commits it on a short branch — no checkout is touched.
 *   2. `colab ship` computes a TUNING-ONLY class from the diff, modelled on the docs-only door
 *      (tools/lib/docs-only.js): no issue, no `Closes #N`, the evidence in the commit body, every
 *      other precondition unchanged.
 *
 * The allowlist and the authority list below are constants, so widening either is a handbook change
 * reviewed in a commit — never a project.yml field, a flag or an env var. Every doubt resolves to
 * "not tuning": a second file, a comment line, an authority key, a malformed value, a git read that
 * failed. A false "no" costs a human click; a false "yes" lands an unreviewed change.
 */

const yaml = require('./yaml');
const shipBatch = require('./ship-batch');
const ciProfile = require('./ci-profile');
const thresholds = require('./thresholds');

const DESCRIPTOR = '.github/project.yml';

/**
 * The tuning allowlist: key → the one validator every reader of that key already uses. Each returns
 * a problem sentence, or null when the parsed descriptor's value is valid (absent counts as valid —
 * removing a tuning key restores the documented default).
 */
const TUNING = Object.freeze({
  'ship-batch': (doc) => { const r = shipBatch.parseShipBatch(doc); return r.valid ? null : r.reason; },
  'ship-batch-wait': (doc) => { const r = shipBatch.parseShipBatchWait(doc); return r.valid ? null : r.reason; },
  [shipBatch.STEPS_KEY]: (doc) => { const r = shipBatch.parseShipBatchSteps(doc); return r.valid ? null : r.reason; },
  'ci-wait-factor': (doc) => { const r = ciProfile.parseFactor(doc); return r.valid ? null : r.reason; },
  [thresholds.KEY]: (doc) => { const r = thresholds.parseThresholds(doc); return r.problems.length ? r.problems.join('; ') : null; },
});
const TUNING_KEYS = Object.freeze(Object.keys(TUNING));

/**
 * Never on this path: these grant authority or change what deploys (#561 §4). Listed so `config set`
 * can say WHY it refuses them; any key outside TUNING is refused all the same.
 */
const AUTHORITY_KEYS = Object.freeze([
  'autonomy', 'promotion', 'migration-grant', 'ci-grant', 'trust-humans',
  'exposure', 'tier', 'trunk', 'deploy', 'release', 'production',
]);

/** A value is a plain YAML scalar — every tuning value is one (`2`, `6m`, `1.5`, `2,4,8`). */
const VALUE_RE = /^[A-Za-z0-9._,-]+$/;

/**
 * `ship-batch` → `{ top: 'ship-batch', sub: null }`; `thresholds.hot-file-count` → `{ top:
 * 'thresholds', sub: 'hot-file-count' }`. Returns `{ problem }` for anything outside the allowlist.
 */
function parseKeyPath(arg) {
  const s = String(arg || '').trim();
  const dot = s.indexOf('.');
  const top = dot < 0 ? s : s.slice(0, dot);
  const sub = dot < 0 ? null : s.slice(dot + 1);
  if (AUTHORITY_KEYS.includes(top)) {
    return { problem: `${top} grants authority or changes what deploys — it is never a tuning change; edit it on a branch with an issue and ship it the full way (#561)` };
  }
  if (!TUNING[top]) return { problem: `${s} is not a tuning key (tuning keys: ${TUNING_KEYS.join(', ')}, thresholds.<name>)` };
  if (top === thresholds.KEY) {
    if (!sub) return { problem: `${top} is a map — set one entry: ${top}.<name> (names: ${Object.keys(thresholds.SPEC).join(', ')})` };
    if (!thresholds.SPEC[sub]) return { problem: `${top}.${sub} is not a known threshold (known: ${Object.keys(thresholds.SPEC).join(', ')})` };
  } else if (sub !== null) {
    return { problem: `${top} is a scalar — set it as ${top}, not ${s}` };
  }
  return { top, sub };
}

const isTopKeyLine = (line) => /^[^\s#][^:]*:/.test(line);
const topKeyOf = (line) => (isTopKeyLine(line) ? line.slice(0, line.indexOf(':')).trim() : null);

/** Replace a `key: value  # comment` line's value, keeping the indent and the trailing comment. */
function replaceValue(line, value) {
  const m = /^(\s*[^:#]+:)([ \t]*)([^#]*?)([ \t]*#.*)?$/.exec(line);
  if (!m) return null;
  return `${m[1]} ${value}${m[4] || ''}`;
}

/**
 * Edit ONE tuning key in the descriptor's text, leaving every other byte alone. Returns `{ text,
 * old }` (`old` is the previous raw value, or null when the key was absent), or `{ problem }`.
 */
function editText(text, keyPath, value) {
  if (!VALUE_RE.test(String(value))) return { problem: `value ${JSON.stringify(value)} is not a plain scalar (letters, digits, . _ , -)` };
  const src = String(text);
  const eol = src.endsWith('\n') ? '' : '\n';
  const lines = src.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const topIdx = lines.findIndex((l) => topKeyOf(l) === keyPath.top);
  const blockEnd = (start) => { let j = start + 1; while (j < lines.length && !isTopKeyLine(lines[j]) && !/^#/.test(lines[j])) j++; return j; };
  const restOf = (l) => l.slice(l.indexOf(':') + 1).replace(/[ \t]#.*$/, '').trim();

  if (!keyPath.sub) {
    if (topIdx < 0) return { text: `${src}${eol}${keyPath.top}: ${value}\n`, old: null };
    const rest = restOf(lines[topIdx]);
    if (rest === '' && blockEnd(topIdx) > topIdx + 1 && lines.slice(topIdx + 1, blockEnd(topIdx)).some((l) => l.trim() && !l.trim().startsWith('#'))) {
      return { problem: `${keyPath.top} is written as a block in ${DESCRIPTOR} — edit it by hand` };
    }
    lines[topIdx] = replaceValue(lines[topIdx], value);
    return { text: lines.join('\n') + '\n', old: rest === '' ? null : rest };
  }

  if (topIdx < 0) return { text: `${src}${eol}${keyPath.top}:\n  ${keyPath.sub}: ${value}\n`, old: null };
  if (restOf(lines[topIdx]) !== '') return { problem: `${keyPath.top} is written inline in ${DESCRIPTOR} — edit it by hand` };
  const end = blockEnd(topIdx);
  let lastChild = topIdx, indent = '  ';
  for (let j = topIdx + 1; j < end; j++) {
    const l = lines[j];
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const m = /^(\s+)([^:#]+):/.exec(l);
    if (!m) return { problem: `${keyPath.top} has a line this command cannot read (${JSON.stringify(l)}) — edit it by hand` };
    lastChild = j; indent = m[1];
    if (m[2].trim() === keyPath.sub) {
      const old = restOf(l);
      lines[j] = replaceValue(l, value);
      return { text: lines.join('\n') + '\n', old: old === '' ? null : old };
    }
  }
  lines.splice(lastChild + 1, 0, `${indent}${keyPath.sub}: ${value}`);
  return { text: lines.join('\n') + '\n', old: null };
}

/** The value a key path resolves to in a parsed doc (undefined when absent). */
function valueAt(doc, keyPath) {
  const top = doc ? doc[keyPath.top] : undefined;
  if (!keyPath.sub) return top;
  return top && typeof top === 'object' ? top[keyPath.sub] : undefined;
}

/**
 * Line diff → the 0-based indices of changed lines on each side. A plain LCS: a descriptor is a few
 * hundred lines at most, and a dependency-free diff keeps this module pure and testable.
 */
function changedLines(aText, bText) {
  const a = String(aText).split('\n'), b = String(bText).split('\n');
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const del = [], add = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) del.push(i++); else add.push(j++);
  }
  while (i < n) del.push(i++);
  while (j < m) add.push(j++);
  return { a, b, del, add };
}

/**
 * The top-level key whose block holds line `idx`, or null for a top-level comment / a line before
 * any key. A blank line is reported as `''` (harmless wherever it sits).
 */
function ownerOf(lines, idx) {
  const l = lines[idx];
  if (!l.trim()) return '';
  if (/^#/.test(l)) return null;
  for (let k = idx; k >= 0; k--) {
    if (/^#/.test(lines[k])) return null; // a top-level comment ends the block above it
    const key = topKeyOf(lines[k]);
    if (key !== null) return key;
  }
  return null;
}

/**
 * Is the change from `baseText` to `headText` (both the descriptor's full text) TUNING ONLY?
 * `paths` are the changed entries for the whole diff — `[{ path, oldMode, newMode, binary }]`, the
 * shape docs-only.js reads — so a second file anywhere refuses the class.
 *
 * Tuning only means: exactly one file changed, the descriptor, as a regular text file; every changed
 * non-blank line sits inside a tuning key's block; every other key parses identical on both sides;
 * and every tuning key that moved holds a valid value (or is absent) at head.
 *
 * Returns `{ tuning, keys, reason }` — `reason` is one line for a human, set on both outcomes.
 */
function classify({ entries, baseText, headText }) {
  const no = (reason, keys = []) => ({ tuning: false, keys, reason });
  const files = [...new Set((entries || []).map((e) => e.path))];
  if (!files.length) return no('empty diff — nothing to call tuning');
  if (files.length !== 1 || files[0] !== DESCRIPTOR) {
    const other = files.filter((f) => f !== DESCRIPTOR);
    return no(`changes ${other.length ? other.slice(0, 3).join(', ') + (other.length > 3 ? ` +${other.length - 3} more` : '') : files.join(', ')} — a tuning change touches ${DESCRIPTOR} alone`);
  }
  for (const e of entries) {
    if (e.binary) return no(`${DESCRIPTOR} reads as binary`);
    if ((e.oldMode && e.oldMode !== '100644' && e.oldMode !== '000000') || (e.newMode && e.newMode !== '100644')) {
      return no(`${DESCRIPTOR} mode change (${e.oldMode} → ${e.newMode})`);
    }
  }
  if (typeof baseText !== 'string' || typeof headText !== 'string') return no(`could not read ${DESCRIPTOR} on both sides`);

  const d = changedLines(baseText, headText);
  const owners = new Set();
  for (const [lines, idxs] of [[d.a, d.del], [d.b, d.add]]) {
    for (const idx of idxs) {
      const o = ownerOf(lines, idx);
      if (o === '') continue;
      if (o === null) return no(`line ${JSON.stringify(lines[idx].slice(0, 60))} is a top-level comment or sits outside any key`);
      owners.add(o);
    }
  }
  if (!owners.size) return no('only blank lines changed — nothing to call tuning');
  const offending = [...owners].filter((k) => !TUNING[k]);
  if (offending.length) {
    const auth = offending.filter((k) => AUTHORITY_KEYS.includes(k));
    return no(`${offending.join(', ')} ${offending.length > 1 ? 'are' : 'is'} not a tuning key${auth.length ? ` (${auth.join(', ')} grant${auth.length > 1 ? '' : 's'} authority)` : ''}`, [...owners]);
  }

  let base, head;
  try { base = yaml.parse(baseText) || {}; head = yaml.parse(headText) || {}; } catch (e) { return no(`${DESCRIPTOR} does not parse: ${e.message}`); }
  const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])];
  const moved = keys.filter((k) => JSON.stringify(base[k]) !== JSON.stringify(head[k]));
  const nonTuning = moved.filter((k) => !TUNING[k]);
  if (nonTuning.length) return no(`${nonTuning.join(', ')} changed value — not a tuning key`, moved);
  if (!moved.length) return no('no value changed — formatting alone is not a tuning change');
  const bad = moved.map((k) => TUNING[k](head)).filter(Boolean);
  if (bad.length) return no(`malformed tuning value: ${bad.join('; ')}`, moved);
  return { tuning: true, keys: moved, reason: `tuning-only (${moved.join(', ')})` };
}

/**
 * The branch shape, with I/O: what `branch` changes relative to its merge base with `base` — the
 * same three-dot diff the squash would land, read through docs-only.js's entry reader so both doors
 * judge one diff. `git` is tools/lib/git.js (or a fake with its `git()` shape).
 */
function branchTuning(git, repo, base, branch) {
  const docsOnly = require('./docs-only');
  const entries = docsOnly.readEntries(git, repo, 'diff', [`${base}...${branch}`, '--']);
  if (!entries) return { tuning: false, keys: [], reason: `could not read the diff ${base}...${branch}` };
  const mb = git.git(['merge-base', base, branch], repo);
  if (!mb.ok) return { tuning: false, keys: [], reason: `no merge base between ${base} and ${branch}` };
  const show = (ref) => { const r = git.git(['show', `${ref}:${DESCRIPTOR}`], repo); return r.ok ? r.stdout : (/does not exist|exists on disk, but not in/.test(r.stderr || '') ? '' : null); };
  return classify({ entries, baseText: show(mb.stdout.trim()), headText: show(branch) });
}

/**
 * Commit `text` as the descriptor on top of `baseSha`, as branch `branch`, WITHOUT touching any
 * working tree or the repo's own index: a scratch index (GIT_INDEX_FILE) holds the tree. The main
 * checkout stays on trunk at rest, which a `git checkout -b` here would break (CONVENTIONS.md §4).
 * The ref is created only if absent (`update-ref <ref> <sha> ""`), so a concurrent run cannot
 * overwrite a branch someone else just made. Returns `{ ok, sha, error }`.
 */
function commitOnBranch(repo, { baseSha, text, message, branch }) {
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'colab-config-set-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tmp, 'index') };
  const run = (args, input) => {
    const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', ...(input !== undefined ? { input } : {}) });
    return { ok: r.status === 0, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
  };
  try {
    const rt = run(['read-tree', baseSha]);
    if (!rt.ok) return { ok: false, error: `read-tree ${baseSha}: ${rt.err}` };
    const blob = run(['hash-object', '-w', '--stdin'], text);
    if (!blob.ok) return { ok: false, error: `hash-object: ${blob.err}` };
    const up = run(['update-index', '--add', '--cacheinfo', `100644,${blob.out},${DESCRIPTOR}`]);
    if (!up.ok) return { ok: false, error: `update-index: ${up.err}` };
    const tree = run(['write-tree']);
    if (!tree.ok) return { ok: false, error: `write-tree: ${tree.err}` };
    const commit = run(['commit-tree', tree.out, '-p', baseSha, '-F', '-'], message);
    if (!commit.ok) return { ok: false, error: `commit-tree: ${commit.err}` };
    const ref = run(['update-ref', `refs/heads/${branch}`, commit.out, '']);
    if (!ref.ok) return { ok: false, error: `update-ref refs/heads/${branch}: ${ref.err}` };
    return { ok: true, sha: commit.out };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The descriptor's exact text at `ref` (no trimming — it becomes a blob), '' when absent, null on a git error. */
function descriptorAt(repo, ref) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('git', ['show', `${ref}:${DESCRIPTOR}`], { cwd: repo, encoding: 'utf8' });
  if (r.status === 0) return String(r.stdout);
  return /does not exist|exists on disk, but not in/.test(String(r.stderr || '')) ? '' : null;
}

/**
 * Does `colab config set <key>` mean THIS repo's descriptor (#561) rather than the machine-local
 * config? Machine keys are camelCase (`claimTTLHours`); descriptor keys are kebab-case. An authority
 * key routes here too, so its refusal names the reason instead of "unknown config key".
 */
function isDescriptorKey(arg) {
  const s = String(arg || '');
  const top = s.split('.')[0];
  return !!TUNING[top] || AUTHORITY_KEYS.includes(top) || /[-.]/.test(s);
}

/** `chore/tune-<key>` — never ending in a digit group, which `colab ship` would read as an issue number. */
function branchName(keyPath) {
  const slug = [keyPath.top, keyPath.sub].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `chore/tune-${slug}`;
}

/** The commit message: a conventional subject, the evidence in the body (#561). */
function commitMessage(keyPath, oldValue, value, evidence) {
  const name = [keyPath.top, keyPath.sub].filter(Boolean).join('.');
  return `chore(project): ${name} ${oldValue === null || oldValue === undefined ? '(unset)' : oldValue} → ${value}\n\n` +
    `Tuning-only change to ${DESCRIPTOR}, written by \`colab config set\` (#561).\n\n` +
    `Evidence: ${String(evidence).trim()}\n`;
}

module.exports = {
  DESCRIPTOR, TUNING, TUNING_KEYS, AUTHORITY_KEYS,
  parseKeyPath, editText, valueAt, changedLines, ownerOf, classify, branchTuning, commitOnBranch, descriptorAt, isDescriptorKey, branchName, commitMessage,
};
