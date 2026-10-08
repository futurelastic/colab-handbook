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
 *      observer announces itself. Each observer writes its own events URL there on its OWN line (one
 *      http(s) URL per non-comment line, #546 — a machine may run two observers side by side, and
 *      neither may overwrite the other's line); colab only reads it. A one-line file is the
 *      one-observer case and stays valid. No port is probed and no well-known URL is hard-coded: an
 *      observer's address is the observer's fact, not the handbook's.
 *
 * What reads this:
 *   - install.sh ADDS to `notifyUrl` every URL from (1) and (2) that the key lacks, and never
 *     removes or rewrites an entry already there — an existing value is someone's deliberate choice.
 *     With one URL the key is written as a plain string, exactly as before the list form (#546).
 *     When nothing seeds it, install says plainly that the key is unset and what that costs.
 *   - `install.sh --check` and `colab doctor` report `notifyUrl: unset` when (2) exists and the key
 *     does not, and name EACH declared URL the key lacks when it is set. No declared endpoint →
 *     nothing is reported: silence stays right for a machine with no observer.
 *
 * CommonJS, zero dependencies. Runnable as a script (install.sh's entry):
 *   node tools/lib/notify-endpoint.js seed --colab-home <dir> [--url <url>] [--dry]
 * It writes config.json through lib/state.js, the CLI's own writer, so the file's shape cannot drift
 * from what `colab config set` produces. state.js reads COLAB_HOME at require time, so the entry
 * sets it from --colab-home before requiring it.
 */

const fs = require('fs');
const path = require('path');
const { configuredUrls, storedNotifyUrl } = require('./notify');

const ENDPOINT_FILE = 'notify-endpoint';
const HTTP_RE = /^https?:\/\//i;

/** The event kinds a local observer only learns of by push — named in the "unset" line. */
const PUSH_ONLY_KINDS = Object.freeze(['issue.merged', 'issue.closed', 'readiness.marked', 'gate.recorded']);

function endpointFile(colabHome) {
  return path.join(colabHome, ENDPOINT_FILE);
}

/**
 * Read the declared endpoints. Returns null when no file exists (the common, silent case), else
 * `{ file, urls, bad }`: every usable URL in file order (deduplicated), and every non-comment line
 * that is not one. When no line is usable it also carries `invalid`, naming what is wrong — a
 * declared endpoint that cannot be used is reported, never silently treated as absent. `url` is the
 * first usable URL, kept for readers that predate the list form.
 */
function readDeclared(colabHome) {
  const file = endpointFile(colabHome);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const urls = [];
  const bad = [];
  for (const l of lines) {
    if (!HTTP_RE.test(l)) bad.push(l);
    else if (!urls.includes(l)) urls.push(l);
  }
  if (urls.length === 0) {
    const invalid = lines.length === 0 ? 'empty — no URL on any non-comment line' : `not an http(s) URL: ${bad[0]}`;
    return { file, urls, bad, invalid };
  }
  return { file, urls, bad, url: urls[0] };
}

/**
 * The read-only verdict both health checks print. `state`:
 *   'set'              notifyUrl is configured (payload: url, urls; `missing` lists each declared URL
 *                      the key lacks — the observers that receive nothing — empty when none)
 *   'unset-declared'   notifyUrl absent while an observer declared an endpoint — the outage case
 *   'declared-invalid' notifyUrl absent and the declared file is unusable
 *   'unset'            neither — a machine with no observer; callers stay silent
 * `declared` rides along whenever the file exists.
 */
function status(cfg, colabHome) {
  const urls = configuredUrls(cfg);
  const declared = readDeclared(colabHome);
  if (urls.length) {
    const st = { state: 'set', url: urls[0], urls, missing: declared ? declared.urls.filter((u) => !urls.includes(u)) : [] };
    if (declared) st.declared = declared;
    return st;
  }
  if (!declared) return { state: 'unset' };
  if (declared.invalid) return { state: 'declared-invalid', declared };
  return { state: 'unset-declared', declared };
}

/** The fix command for one or several URLs a key lacks. One URL on an unset key: the same `set` as ever. */
function fixFor(urls, keyIsSet) {
  if (!keyIsSet && urls.length === 1) return `colab config set notifyUrl ${urls[0]}`;
  return urls.map((u) => `colab config add-notify-url ${u}`).join(' && ');
}

/** Human lines for a status — one per problem — or [] when the right output is silence. */
function healthLines(st) {
  const out = [];
  const d = st.declared;
  if (st.state === 'unset-declared') {
    const where = d.urls.length === 1 ? `a local observer at ${d.urls[0]}, which receives` : `${d.urls.length} local observers (${d.urls.join(', ')}), which receive`;
    out.push(`notifyUrl: unset — ${d.file} declares ${where} no events (${PUSH_ONLY_KINDS.join(', ')}). ` +
      `Fix: ${fixFor(d.urls, false)}`);
  } else if (st.state === 'declared-invalid') {
    out.push(`notifyUrl: unset — ${d.file} is ${d.invalid}, so nothing could be seeded from it`);
    return out;
  } else if (st.state === 'set') {
    for (const u of st.missing || []) {
      out.push(`notifyUrl: lacks ${u} — declared in ${d.file} by a local observer, which receives no events ` +
        `(${PUSH_ONLY_KINDS.join(', ')}). Fix: ${fixFor([u], true)}`);
    }
  }
  for (const b of (d && d.bad) || []) out.push(`notifyUrl: ${d.file} has a line that is not an http(s) URL — ignored: ${b}`);
  return out;
}

/** The lines above joined, or null when the right output is silence. Kept for one-string readers. */
function healthLine(st) {
  const lines = healthLines(st);
  return lines.length ? lines.join('\n') : null;
}

/**
 * Decide what install.sh does. Pure: returns `{ action, add?, lines[] }` and writes nothing.
 *   action 'keep'  the key already holds every URL there is to add — left exactly as it is
 *   action 'seed'  add each `{ url, source }` in `add` (from the flag and the declared file) that the
 *                  key lacks; existing entries are never removed or rewritten
 *   action 'none'  nothing to seed — the lines say plainly the key is unset and what it costs
 *   action 'error' a non-http --notify-url
 * The flag is one more "an observer lives here" source, added beside the declared ones rather than
 * winning over them: since #546 a second receiver is an addition, never a replacement.
 */
function plan({ cfg, colabHome, flagUrl }) {
  const current = configuredUrls(cfg);
  const declared = readDeclared(colabHome);
  if (flagUrl && !HTTP_RE.test(flagUrl)) {
    return { action: 'error', lines: [`--notify-url must be an http(s) URL, got: ${flagUrl}`] };
  }
  const candidates = [];
  if (flagUrl) candidates.push({ url: flagUrl, source: '--notify-url' });
  for (const u of (declared && declared.urls) || []) candidates.push({ url: u, source: declared.file });
  const add = [];
  for (const c of candidates) {
    if (!current.includes(c.url) && !add.some((a) => a.url === c.url)) add.push(c);
  }
  const badLines = ((declared && declared.bad) || []).map((b) => `⚠ ${declared.file} has a line that is not an http(s) URL — ignored: ${b}`);
  if (add.length) return { action: 'seed', add, lines: badLines };
  if (current.length) {
    return { action: 'keep', lines: [`✓ notifyUrl = ${current.join(', ')} (already set → left untouched)`, ...badLines] };
  }
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

/**
 * The config value after adding `add` to `cfg`'s current list — existing entries first, untouched and
 * in order, new ones appended. Pure; used by the seed entry right before it writes.
 */
function merged(cfg, add) {
  const urls = configuredUrls(cfg);
  for (const a of add) if (!urls.includes(a.url)) urls.push(a.url);
  return storedNotifyUrl(urls);
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
  p.lines.forEach(out);
  if (p.action !== 'seed') return 0;
  const hadAny = configuredUrls(cfg).length > 0;
  if (argv.includes('--dry')) {
    for (const a of p.add) out(`[dry] ${hadAny ? 'add to' : 'seed'} notifyUrl ${a.url} (from ${a.source})`);
    return 0;
  }
  // Re-read inside the write: an entry added between plan and write is kept, never rewritten or
  // removed, and a URL someone else just added is not added twice.
  const fresh = state.loadConfig();
  const before = configuredUrls(fresh);
  const add = p.add.filter((a) => !before.includes(a.url));
  if (!add.length) { out(`✓ notifyUrl = ${before.join(', ')} (already set → left untouched)`); return 0; }
  fresh.notifyUrl = merged(fresh, add);
  state.saveConfig(fresh);
  for (const a of add) {
    out(before.length
      ? `📡 notifyUrl: added ${a.url} (from ${a.source}) — existing entries left untouched`
      : `📡 notifyUrl seeded: ${a.url} (from ${a.source}) — colab now pushes its events there`);
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { ENDPOINT_FILE, PUSH_ONLY_KINDS, endpointFile, readDeclared, status, healthLines, healthLine, plan, merged, main };
