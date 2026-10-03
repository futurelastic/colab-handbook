'use strict';
/**
 * notify-endpoint.js — is this machine's `notifyUrl` set, and SHOULD it be? (#414)
 *
 * `notifyUrl` is optional by design (lib/notify.js): unset means colab makes no network call of its
 * own, and silence is the right behaviour on a machine with no observer. But a machine that DOES run
 * a local observer (a companion dashboard ingesting `issue.merged`, `issue.closed`,
 * `readiness.marked`, `gate.recorded`) depends on the push for the kinds it cannot recover by
 * polling state.json, and an unset key there is a silent outage. Measured on a two-machine fleet
 * running the same observer: the machine set up by hand had recorded 2 292 `issue.merged` events;
 * the one set up a month later with install.sh had 0, and nothing said so until someone asked for
 * lead time.
 *
 * Two inputs answer "should it be set", and colab guesses neither:
 *
 *   1. an explicit URL a human passes to `install.sh --notify-url <url>`;
 *   2. the DECLARED ENDPOINT FILE, `<COLAB_HOME>/notify-endpoint` — the convention by which a local
 *      observer announces itself. The observer writes its own events URL there (one http(s) URL on
 *      the first non-comment line); colab only reads it. No port is probed and no well-known URL is
 *      hard-coded: an observer's address is the observer's fact, not the handbook's.
 *
 * What reads this:
 *   - install.sh seeds `notifyUrl` from (1), else (2), ONLY when the key is absent — an existing
 *     value is someone's deliberate choice and is never overwritten. When nothing seeds it, install
 *     says plainly that the key is unset and what that costs.
 *   - `install.sh --check` and `colab doctor` report `notifyUrl: unset` when (2) exists and the key
 *     does not. No declared endpoint → nothing is reported: silence stays right for a machine with
 *     no observer.
 *
 * CommonJS, zero dependencies. Runnable as a script (install.sh's entry):
 *   node tools/lib/notify-endpoint.js seed --colab-home <dir> [--url <url>] [--dry]
 * It writes config.json through lib/state.js, the CLI's own writer, so the file's shape cannot drift
 * from what `colab config set` produces. state.js reads COLAB_HOME at require time, so the entry
 * sets it from --colab-home before requiring it.
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT_FILE = 'notify-endpoint';
const HTTP_RE = /^https?:\/\//i;

/** The event kinds a local observer only learns of by push — named in the "unset" line. */
const PUSH_ONLY_KINDS = Object.freeze(['issue.merged', 'issue.closed', 'readiness.marked', 'gate.recorded']);

function endpointFile(colabHome) {
  return path.join(colabHome, ENDPOINT_FILE);
}

/**
 * Read the declared endpoint. Returns null when no file exists (the common, silent case), else
 * `{ file, url }` for a usable URL or `{ file, invalid }` naming what is wrong with it — a declared
 * endpoint that cannot be used is reported, never silently treated as absent.
 */
function readDeclared(colabHome) {
  const file = endpointFile(colabHome);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  const line = raw.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).find(Boolean);
  if (!line) return { file, invalid: 'empty — no URL on any non-comment line' };
  if (!HTTP_RE.test(line)) return { file, invalid: `not an http(s) URL: ${line}` };
  return { file, url: line };
}

function configuredUrl(cfg) {
  return cfg && typeof cfg.notifyUrl === 'string' ? cfg.notifyUrl.trim() : '';
}

/**
 * The read-only verdict both health checks print. `state`:
 *   'set'              notifyUrl is configured (payload: url; `declared` when the file names another)
 *   'unset-declared'   notifyUrl absent while an observer declared an endpoint — the outage case
 *   'declared-invalid' notifyUrl absent and the declared file is unusable
 *   'unset'            neither — a machine with no observer; callers stay silent
 */
function status(cfg, colabHome) {
  const url = configuredUrl(cfg);
  const declared = readDeclared(colabHome);
  if (url) {
    return declared && declared.url && declared.url !== url
      ? { state: 'set', url, declared }
      : { state: 'set', url };
  }
  if (!declared) return { state: 'unset' };
  if (declared.invalid) return { state: 'declared-invalid', declared };
  return { state: 'unset-declared', declared };
}

/** One human line for a status, or null when the right output is silence. */
function healthLine(st) {
  if (st.state === 'unset-declared') {
    return `notifyUrl: unset — ${st.declared.file} declares a local observer at ${st.declared.url}, ` +
      `which receives no events (${PUSH_ONLY_KINDS.join(', ')}). Fix: colab config set notifyUrl ${st.declared.url}`;
  }
  if (st.state === 'declared-invalid') {
    return `notifyUrl: unset — ${st.declared.file} is ${st.declared.invalid}, so nothing could be seeded from it`;
  }
  if (st.state === 'set' && st.declared) {
    return `notifyUrl: ${st.url} — differs from the endpoint declared in ${st.declared.file} (${st.declared.url}); ` +
      'left as configured, check which one the local observer listens on';
  }
  return null;
}

/**
 * Decide what install.sh does. Pure: returns `{ action, url?, source?, lines[] }` and writes nothing.
 *   action 'keep'  the key is already set — never overwritten
 *   action 'seed'  write `url` (from the flag, else the declared file)
 *   action 'none'  nothing to seed — the lines say plainly the key is unset and what it costs
 */
function plan({ cfg, colabHome, flagUrl }) {
  const current = configuredUrl(cfg);
  const declared = readDeclared(colabHome);
  if (flagUrl && !HTTP_RE.test(flagUrl)) {
    return { action: 'error', lines: [`--notify-url must be an http(s) URL, got: ${flagUrl}`] };
  }
  if (current) {
    const lines = [`✓ notifyUrl = ${current} (already set → left untouched)`];
    if (flagUrl && flagUrl !== current) {
      lines.push(`⚠ --notify-url ${flagUrl} NOT applied: an existing value is never overwritten. ` +
        `To change it: colab config set notifyUrl ${flagUrl}`);
    }
    const hl = healthLine(status(cfg, colabHome));
    if (hl) lines.push(`⚠ ${hl}`);
    return { action: 'keep', lines };
  }
  if (flagUrl) return { action: 'seed', url: flagUrl, source: '--notify-url', lines: [] };
  if (declared && declared.url) return { action: 'seed', url: declared.url, source: declared.file, lines: [] };
  const lines = [];
  if (declared && declared.invalid) lines.push(`⚠ ${declared.file} is ${declared.invalid} — ignored.`);
  lines.push(
    '⚠ notifyUrl is UNSET — colab pushes no events from this machine.',
    `  A local observer (e.g. a companion dashboard) here will never receive ${PUSH_ONLY_KINDS.join(', ')}.`,
    '  Observer on this machine? Re-run with --notify-url <its events URL>, or: colab config set notifyUrl <url>',
    '  No observer here? Nothing to do — unset is the right default.',
  );
  return { action: 'none', lines };
}

function main(argv) {
  const sub = argv[0];
  const val = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : undefined;
  };
  const colabHome = val('--colab-home') || process.env.COLAB_HOME || path.join(require('os').homedir(), '.colab');
  if (sub !== 'seed') {
    process.stderr.write('usage: notify-endpoint.js seed --colab-home <dir> [--url <url>] [--dry]\n');
    return 2;
  }
  process.env.COLAB_HOME = colabHome; // before state.js computes its paths
  const state = require('./state');
  const cfg = state.loadConfig();
  const p = plan({ cfg, colabHome, flagUrl: val('--url') });
  const out = (l) => process.stdout.write(`  ${l}\n`);
  if (p.action === 'error') { process.stderr.write(`  ✗ ${p.lines[0]}\n`); return 2; }
  if (p.action !== 'seed') { p.lines.forEach(out); return 0; }
  if (argv.includes('--dry')) { out(`[dry] seed notifyUrl = ${p.url} (from ${p.source})`); return 0; }
  // Re-read inside the write: a key set between plan and write is still never overwritten.
  const fresh = state.loadConfig();
  if (configuredUrl(fresh)) { out(`✓ notifyUrl = ${configuredUrl(fresh)} (already set → left untouched)`); return 0; }
  fresh.notifyUrl = p.url;
  state.saveConfig(fresh);
  out(`📡 notifyUrl seeded: ${p.url} (from ${p.source}) — colab now pushes its events there`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { ENDPOINT_FILE, PUSH_ONLY_KINDS, endpointFile, readDeclared, status, healthLine, plan, main };
