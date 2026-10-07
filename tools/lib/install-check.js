'use strict';
/**
 * `install.sh --check` — a READ-ONLY report on what an earlier install left behind (#341).
 *
 * Why it exists: the frozen CLI copy at <COLAB_HOME>/bin/colab is pinned on purpose, so it never
 * breaks — it gets OLD. An old complete copy answers normally for every command it knows and fails
 * only when something finally asks for a command added after it was frozen. Measured across three
 * machines of one fleet: three different stamps, none matching the tree, the oldest not dispatching
 * a dozen commands the current CLI does. Nothing reported any of it. This module is that report.
 *
 * It never writes and never refreshes. Auto-refreshing a frozen copy is a non-goal: consumers rely
 * on it not moving underneath them, so detection is the whole job and re-freezing stays a human act.
 *
 * Row severities, and the one rule behind them: ✗ (fail, exit 1) means something was INSTALLED and
 * is now stale or unusable; ⚠ means something was simply never set up, which may be a deliberate
 * choice (a machine that only wants the skills needs no fleet list) or just not done YET (no repo
 * registered, no identity vocabulary). A report that failed every skills-only machine — or every
 * correct fresh `--all` install, as it did until #521 — would teach people to ignore its exit code.
 *
 * CommonJS, zero dependencies, runnable as a script: install.sh calls
 *   node tools/lib/install-check.js --root <handbook> --colab-home <dir> --home <dir>
 * and exits with its code. lib/ is also copied into the frozen copy, where it is inert.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const stamp = require('./stamp');
const notifyEndpoint = require('./notify-endpoint');
const engines = require('./engines');

const OK = 'ok';
const WARN = 'warn';
const FAIL = 'fail';

/**
 * The top-level commands a `tools/colab` source dispatches, sorted. Read from the `switch` inside
 * `function main(argv)` — the only place a command becomes reachable — so a helper elsewhere that
 * happens to `case 'room':` is never mistaken for one. Same shape on every tag back to v1.9.0.
 */
function dispatchedCommands(src) {
  const start = src.search(/^function main\(argv\)/m);
  if (start < 0) return [];
  const body = src.slice(start);
  const end = body.search(/^\s*default:/m);
  const sw = end < 0 ? body : body.slice(0, end);
  const out = new Set();
  for (const m of sw.matchAll(/case '([a-z][a-z-]*)'/g)) out.add(m[1]);
  return [...out].sort();
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

function isExecutable(cmd, env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try { fs.accessSync(path.join(dir, cmd), fs.constants.X_OK); return true; } catch (_) { /* next */ }
  }
  return false;
}

function gitConfig(root, key, env) {
  try {
    return execFileSync('git', ['-C', root, 'config', '--get', key],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        // git itself is found on the REAL PATH: the injected env may narrow PATH to decide what
        // gitleaks lookup sees, and must not also hide git (whose config it is reading).
        env: { ...env, PATH: process.env.PATH } }).trim();
  } catch (_) {
    return '';
  }
}

/** The symlinked CLI (~/.local/bin/colab): does it follow THIS clone, with templates/ reachable? */
function checkLink({ root, home }) {
  const link = path.join(home, '.local', 'bin', 'colab');
  let target;
  try { target = fs.readlinkSync(link); } catch (e) {
    if (e.code === 'ENOENT') return { area: 'cli', severity: WARN, text: `no symlink at ${link} — sessions have no colab on PATH; install: ./install.sh --tools` };
    return { area: 'cli', severity: WARN, text: `${link} is not a symlink — not installed by install.sh, left as is` };
  }
  const ours = path.resolve(path.dirname(link), target) === path.join(root, 'tools', 'colab');
  if (!ours) return { area: 'cli', severity: WARN, text: `${link} points at ${target}, not this clone — another checkout owns your PATH colab` };
  if (!fs.existsSync(path.join(root, 'templates'))) {
    return { area: 'cli', severity: FAIL, text: `${link} follows this clone, but ${path.join(root, 'templates')} is missing — \`colab template\` cannot run` };
  }
  return { area: 'cli', severity: OK, text: `${link} → this clone (templates/ present)` };
}

/**
 * The frozen copy. Two independent questions, both needed:
 *   - classifyFrozen: has a RELEASED CLI change happened since the stamp? (bounded by the latest tag)
 *   - the command diff: which commands does the tree dispatch that the copy does not? This is the
 *     concrete failure a service hits, and it names them instead of saying "behind".
 * The diff alone is not a verdict: on a machine developing the handbook the tree legitimately
 * dispatches unreleased commands, which is a ⚠ (re-freeze after the next tag), not a ✗.
 */
function checkFrozen({ root, colabHome }) {
  const dir = path.join(colabHome, 'bin');
  const bin = path.join(dir, 'colab');
  const rows = [];
  if (!fs.existsSync(bin)) {
    return [{ area: 'frozen', severity: WARN, text: `no frozen copy at ${bin} — fine unless an always-on service calls colab; install: ./install.sh --tools` }];
  }
  const stampText = readText(path.join(dir, stamp.FROZEN_STAMP_FILE));
  const parsed = stampText ? stamp.parseWorkflowStamp(stampText) : null;
  if (!parsed || parsed.name !== stamp.FROZEN_STAMP_NAME) {
    return [{ area: 'frozen', severity: FAIL, text: `${bin} has no ${stamp.FROZEN_STAMP_FILE} beside it — not written by install.sh, lineage unknown. Re-freeze: rm -rf '${dir}' && ./install.sh --tools` }];
  }

  const partial = ['lib', 'package.json'].filter((p) => !fs.existsSync(path.join(dir, p)));
  if (partial.length) {
    rows.push({ area: 'frozen', severity: FAIL, text: `partial copy — missing ${partial.join(', ')} beside ${bin}. Re-freeze: ./install.sh --tools` });
  }

  const hb = stamp.handbookInfo(root);
  const c = stamp.classifyFrozen({ root, hb, stampVersion: parsed.version });
  const tree = stamp.freezeVersion(root).version;
  const treeCmds = dispatchedCommands(readText(path.join(root, 'tools', 'colab')) || '');
  const frozenCmds = new Set(dispatchedCommands(readText(bin) || ''));
  const missing = treeCmds.filter((x) => !frozenCmds.has(x));
  const versions = `stamped ${parsed.version}, tree ${tree}`;

  if (c.state === 'behind') {
    rows.push({ area: 'frozen', severity: FAIL, text: `behind — ${versions}. ${c.reason}` });
  } else if (c.state === 'n-a') {
    rows.push({ area: 'frozen', severity: WARN, text: `cannot compare — ${versions}. ${c.reason}` });
  } else if (missing.length) {
    rows.push({ area: 'frozen', severity: WARN, text: `current as released (${c.reason}) — ${versions}; the tree's unreleased work adds commands, re-freeze after the next tag` });
  } else {
    rows.push({ area: 'frozen', severity: OK, text: `current — ${versions} (${c.reason})` });
  }
  if (missing.length) {
    rows.push({
      area: 'frozen',
      severity: c.state === 'behind' ? FAIL : WARN,
      text: `does not dispatch ${missing.length} command(s) the tree does: ${missing.join(', ')} — a service calling one gets "Unknown command"`,
    });
  }
  return rows;
}

/**
 * The skills, per engine (#530). For every engine in engines/ with a folder of its own, plus every
 * folder an earlier --skills-dir remembered: how many of this clone's skills are linked there, which
 * are missing (a skill added since the install — re-run it), which links are broken (they point into
 * this clone's skills/ at a folder that no longer exists — ✗, installed and now unusable), and which
 * names something else holds (⚠, possibly a deliberate local variant; install.sh never clobbers it).
 *
 * An engine with nothing linked is "not installed for it" — one ✓ line naming them, because a
 * Claude-only machine is a correct machine. Only when NO engine has the skills is that a ⚠.
 * The engine's own `caveat:` lines become ⚠ rows while it is installed: they are what the user must
 * do there for the skills to work (a sandbox with no network, say), and they stay true until done.
 */
function checkSkills({ root, home, colabHome }) {
  const src = path.join(root, 'skills');
  let skills = [];
  try { skills = fs.readdirSync(src, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch (_) { /* none */ }
  const all = engines.listEngines(root);
  const byId = Object.fromEntries(all.map((e) => [e.id, e]));
  const targets = all.filter((e) => e.skills_dir).map((e) => ({ e, dir: engines.expandHome(e.skills_dir, home) }));
  for (const dir of engines.rememberedDirs(colabHome)) {
    if (!targets.some((t) => t.dir === dir)) targets.push({ e: byId.generic || { id: 'generic', label: 'another engine', note: [], caveat: [] }, dir });
  }

  const rows = [];
  const notInstalled = [];
  for (const { e, dir } of targets) {
    const linked = []; const missing = []; const broken = []; const foreign = [];
    for (const name of skills) {
      const dest = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(dest); } catch (_) { missing.push(name); continue; }
      if (!st.isSymbolicLink()) { foreign.push(name); continue; }
      const to = path.resolve(dir, fs.readlinkSync(dest));
      if (to === path.join(src, name)) linked.push(name);
      else foreign.push(name);
    }
    // Links into this clone's skills/ whose target is gone: a skill removed or renamed upstream.
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (_) { /* folder absent */ }
    for (const n of entries) {
      const p = path.join(dir, n);
      try {
        if (!fs.lstatSync(p).isSymbolicLink()) continue;
        const to = path.resolve(dir, fs.readlinkSync(p));
        if (to.startsWith(src + path.sep) && !fs.existsSync(to)) broken.push(n);
      } catch (_) { /* unreadable entry — not ours to judge */ }
    }
    const who = `${e.id} (${e.label || e.id}) ${dir}`;
    if (!linked.length && !broken.length) { notInstalled.push(e.id === 'generic' ? dir : `${e.id} (${e.label || e.id})`); continue; }
    const parts = [`${linked.length}/${skills.length} linked`];
    if (missing.length) parts.push(`missing ${missing.join(', ')} — re-run ./install.sh${e.id === 'generic' ? '' : ` --engine ${e.id}`}`);
    if (foreign.length) parts.push(`held by something else (left as is): ${foreign.join(', ')}`);
    if (broken.length) parts.push(`BROKEN links to skills that no longer exist: ${broken.join(', ')} — remove them: ${broken.map((b) => `rm '${path.join(dir, b)}'`).join('; ')}`);
    rows.push({
      area: 'skills',
      severity: broken.length ? FAIL : (missing.length || foreign.length) ? WARN : OK,
      text: `${who}: ${parts.join('; ')}`,
    });
    for (const c of e.caveat || []) rows.push({ area: 'skills', severity: WARN, text: `${e.id}: ${c}` });
    if (e.verified && /^no\b/.test(e.verified)) rows.push({ area: 'skills', severity: WARN, text: `${e.id}: engine file not verified by a run yet — ${e.verified.replace(/^no\s*[—-]?\s*/, '')}` });
  }
  if (!rows.length) {
    rows.push({ area: 'skills', severity: WARN, text: `not linked for any engine — ./install.sh asks which (or --engine <id> / --skills-dir <path>)` });
  } else if (notInstalled.length) {
    rows.push({ area: 'skills', severity: OK, text: `not installed for: ${notInstalled.join(', ')} — fine if deliberate; ./install.sh --engine <id> adds one` });
  }
  return rows;
}

/** The state file. The CLI creates it lazily, so a consumer reading it early saw an error, not an empty fleet. */
function checkState({ root, colabHome, home }) {
  const file = path.join(colabHome, 'state.json');
  const cliInstalled = fs.existsSync(path.join(colabHome, 'bin', 'colab'))
    || fs.existsSync(path.join(home, '.local', 'bin', 'colab'));
  const text = readText(file);
  if (text === null) {
    return {
      area: 'state',
      severity: cliInstalled ? FAIL : WARN,
      text: `no ${file} — ${cliInstalled ? 'the CLI is installed, so anything reading state now errors instead of seeing an empty fleet; ./install.sh --tools creates an empty one' : 'created by ./install.sh --tools (or the first state-changing colab command)'}`,
    };
  }
  try {
    const st = JSON.parse(text);
    const n = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);
    return { area: 'state', severity: OK, text: `${file} — ${n(st.claims)} claim(s), ${n(st.worktrees)} worktree(s)` };
  } catch (e) {
    return { area: 'state', severity: FAIL, text: `${file} is not valid JSON (${e.message}) — every colab command will refuse; run \`colab doctor\` from the working tree` };
  }
}

/**
 * The fleet: both machine-local registries `colab register` writes. Nothing registered is ⚠ whether or
 * not `--fleet` seeded the placeholder list: both are "not set up yet", the state every correct fresh
 * install is in until its first `colab register` (#521). The ⚠ text still names the dead end.
 */
function checkFleet({ colabHome }) {
  const rows = [];
  const txtFile = path.join(colabHome, 'repos.txt');
  const txt = readText(txtFile);
  const entries = txt === null ? null
    : txt.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  let cfgRepos = [];
  try { cfgRepos = JSON.parse(readText(path.join(colabHome, 'config.json')) || '{}').repos || []; } catch (_) { /* reported by colab itself */ }

  if (entries === null && !cfgRepos.length) {
    rows.push({ area: 'fleet', severity: WARN, text: `nothing registered — add each repo: colab register <path>` });
  } else if (entries !== null && !entries.length) {
    // #521: this is exactly what `--fleet` leaves on a new machine, and the install's own "next" list
    // says to register a repo. Not yet set up, not broken — a ✗ here failed every correct fresh install.
    rows.push({ area: 'fleet', severity: WARN, text: `nothing registered yet — ${txtFile} holds placeholders only, so \`colab update\`/\`colab release-status\` refuse "No repos registered". Next: colab register <path>` });
  } else {
    const locals = (entries || []).filter((e) => e.startsWith('/') || e.startsWith('~'));
    const unmirrored = locals.filter((e) => !cfgRepos.includes(e));
    rows.push({ area: 'fleet', severity: OK, text: `${(entries || []).length} entr${(entries || []).length === 1 ? 'y' : 'ies'} in repos.txt, ${cfgRepos.length} repo(s) in config.json` });
    if (unmirrored.length) {
      rows.push({ area: 'fleet', severity: WARN, text: `${unmirrored.length} local path(s) in repos.txt missing from config.json (hand-edited?) — their ports are not reserved. \`colab register <path>\` writes both` });
    }
  }
  return rows;
}

/**
 * The hooklets in THIS clone. Symmetric on purpose: the preflight once warned about gitleaks (the
 * first hooklet's dependency) and said nothing about the identity vocabulary the second needs — and
 * the second guards publication to a public repo. With no vocabulary it warns and passes every commit.
 * Resolution order mirrors templates/pre-commit-identity exactly.
 *
 * Both dependencies are ⚠, never ✗ (#521): the preflight calls them optional, and a missing one is
 * something not set up yet, not an install gone stale. Symmetric still — neither row is quieter.
 */
function checkHooks({ root, colabHome, home, env }) {
  const hp = gitConfig(root, 'core.hooksPath', env);
  const enabled = hp === '.githooks' || (hp && path.resolve(root, hp) === path.join(root, '.githooks'));
  if (!enabled) {
    return [{ area: 'hooks', severity: WARN, text: `not enabled in this clone (core.hooksPath=${hp || 'unset'}) — ./install.sh --hooks` }];
  }
  const rows = [];
  rows.push(isExecutable('gitleaks', env)
    ? { area: 'hooks', severity: OK, text: 'gitleaks on PATH — the secret scan runs' }
    : { area: 'hooks', severity: WARN, text: 'gitleaks not on PATH — the secret-scan hooklet skips every commit (macOS: brew install gitleaks)' });

  let vocab; let src;
  if (env.COLAB_IDENTITY_VOCAB) { vocab = env.COLAB_IDENTITY_VOCAB; src = 'COLAB_IDENTITY_VOCAB'; }
  else if ((vocab = gitConfig(root, 'colab.identityVocabulary', env))) { src = 'git config colab.identityVocabulary'; }
  else { vocab = path.join(colabHome, 'identity-vocabulary'); src = 'default'; }
  if (vocab.startsWith('~/')) vocab = path.join(home, vocab.slice(2));
  rows.push(readText(vocab) !== null
    ? { area: 'hooks', severity: OK, text: `identity vocabulary ${vocab} (${src}) — the identity scan runs` }
    : { area: 'hooks', severity: WARN, text: `no identity vocabulary at ${vocab} (${src}) — the identity hooklet warns and lets every commit through. Example: templates/identity-vocabulary.example` });
  return rows;
}

/**
 * notifyUrl against a DECLARED local observer (#414). Silent unless something says an observer runs
 * here: a machine with no <COLAB_HOME>/notify-endpoint gets no row at all — unset is the right default
 * there, and a ⚠ on every such machine would teach people to ignore the row. ⚠ rather than ✗: the
 * key is something never set up, not something installed that went stale.
 */
function checkNotify({ colabHome }) {
  let cfg = {};
  try { cfg = JSON.parse(readText(path.join(colabHome, 'config.json')) || '{}'); } catch (_) { /* reported by colab itself */ }
  const st = notifyEndpoint.status(cfg, colabHome);
  if (st.state === 'unset') return [];
  if (st.state === 'set' && !st.declared) {
    return [{ area: 'notify', severity: OK, text: `notifyUrl = ${st.url}` }];
  }
  return [{ area: 'notify', severity: WARN, text: notifyEndpoint.healthLine(st) }];
}

function runChecks(opts) {
  const o = { env: process.env, ...opts };
  return [
    ...checkSkills(o),
    checkLink(o),
    ...checkFrozen(o),
    checkState(o),
    ...checkFleet(o),
    ...checkHooks(o),
    ...checkNotify(o),
  ];
}

const MARK = { [OK]: '✓', [WARN]: '⚠', [FAIL]: '✗' };

function render(rows) {
  const lines = rows.map((r) => `  ${MARK[r.severity]} ${r.area.padEnd(7)} ${r.text}`);
  const fails = rows.filter((r) => r.severity === FAIL).length;
  const warns = rows.filter((r) => r.severity === WARN).length;
  lines.push('');
  lines.push(fails
    ? `  ${fails} ✗ row(s) — something installed here is stale or unusable (exit 1)`
    : `  no ✗ rows${warns ? ` — ${warns} ⚠ row(s) are things not set up, which may be deliberate` : ''} (exit 0)`);
  return { text: lines.join('\n'), code: fails ? 1 : 0 };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const val = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
  const home = val('--home', require('os').homedir());
  const root = path.resolve(val('--root', path.resolve(__dirname, '..', '..')));
  const colabHome = val('--colab-home', process.env.COLAB_HOME || path.join(home, '.colab'));
  const { text, code } = render(runChecks({ root, colabHome, home }));
  process.stdout.write(text + '\n');
  process.exitCode = code;
}

module.exports = {
  OK, WARN, FAIL,
  dispatchedCommands, checkSkills, checkLink, checkFrozen, checkState, checkFleet, checkHooks, checkNotify, runChecks, render,
};
