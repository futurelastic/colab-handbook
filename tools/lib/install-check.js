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
 * choice (a machine that only wants the skills needs no fleet list). A report that failed every
 * skills-only machine would teach people to ignore its exit code.
 *
 * CommonJS, zero dependencies, runnable as a script: install.sh calls
 *   node tools/lib/install-check.js --root <handbook> --colab-home <dir> --home <dir>
 * and exits with its code. lib/ is also copied into the frozen copy, where it is inert.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const stamp = require('./stamp');

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
 * The fleet: both machine-local registries `colab register` writes. A repos.txt that exists with no
 * live entry is the `--fleet` dead end — seeded from placeholders, and the next command refuses with
 * "No repos registered". That one is a ✗; never having asked for a fleet is a ⚠.
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
    rows.push({ area: 'fleet', severity: FAIL, text: `${txtFile} exists with no live entry (placeholders only) — \`colab update\`/\`colab release-status\` refuse "No repos registered". Fix: colab register <path>` });
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
    : { area: 'hooks', severity: FAIL, text: 'gitleaks not on PATH — the secret-scan hooklet skips every commit (macOS: brew install gitleaks)' });

  let vocab; let src;
  if (env.COLAB_IDENTITY_VOCAB) { vocab = env.COLAB_IDENTITY_VOCAB; src = 'COLAB_IDENTITY_VOCAB'; }
  else if ((vocab = gitConfig(root, 'colab.identityVocabulary', env))) { src = 'git config colab.identityVocabulary'; }
  else { vocab = path.join(colabHome, 'identity-vocabulary'); src = 'default'; }
  if (vocab.startsWith('~/')) vocab = path.join(home, vocab.slice(2));
  rows.push(readText(vocab) !== null
    ? { area: 'hooks', severity: OK, text: `identity vocabulary ${vocab} (${src}) — the identity scan runs` }
    : { area: 'hooks', severity: FAIL, text: `no identity vocabulary at ${vocab} (${src}) — the identity hooklet warns and lets every commit through. Example: templates/identity-vocabulary.example` });
  return rows;
}

function runChecks(opts) {
  const o = { env: process.env, ...opts };
  return [
    checkLink(o),
    ...checkFrozen(o),
    checkState(o),
    ...checkFleet(o),
    ...checkHooks(o),
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
  dispatchedCommands, checkLink, checkFrozen, checkState, checkFleet, checkHooks, runChecks, render,
};
