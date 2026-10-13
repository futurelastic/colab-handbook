'use strict';
/**
 * The migration-grant policy's ONE precedence (#598): the repo's explicit `migration-grant:` >
 * this machine's value > `human`. Every reader resolves through here — `colab migration-grant`
 * (mint and --list), `colab ship`, and any console on the same machine that imports this module —
 * so none of them can compute a different answer than the gate does.
 *
 * THE MACHINE VALUE lives in this machine's colab config (`~/.colab/config.json`, or
 * `$COLAB_HOME/config.json`), under `policy["migration-grant"]`:
 *   { "value": "human" | "reviewer", "by": "<who>", "at": "<ISO>", "host": "<hostname>", "machine": "<id>|null" }
 * Written only by `COLAB_HUMAN=1 colab config set migration-grant <human|reviewer|unset>` — the
 * human gate is in tools/colab, before anything is parsed. Its reach is ONE machine: a ship run on
 * another machine never sees it and resolves to `human`, which is the safe direction.
 * `machine` binds the record to the machine that wrote it, so a dotfile-synced or copied config
 * does not carry the switch to another box (read: 'foreign'). Where either side has no machine id,
 * the binding is skipped.
 *
 * THE OWNER-LEVEL RECORD (#596) IS NOT A RUNG. It was a tracker comment any org member could post,
 * including the shared account agent sessions post from, and it reached every repo of the owner
 * (#598, docs/adr/539-migration-rationale.md). `colab owner-policy show` still reads it, read-only.
 *
 * A CONSOLE: call `effectiveGrantPolicy(doc)` with the project.yml the gate reads (the trunk
 * checkout for a mint, the merge target for ship). It reads the same config file colab does —
 * pass `{ configFile }` explicitly if the console process does not inherit colab's COLAB_HOME.
 *
 * Everything here is pure except `readMachinePolicy` (and `effectiveGrantPolicy`, which calls it).
 */
const fs = require('fs');
const migrationGrant = require('./migration-grant');

const MACHINE_KEY = 'migration-grant';
const CONFIG_SECTION = 'policy';
const VALUES = ['human', 'reviewer'];
const UNSET = 'unset';

/**
 * The machine record from a parsed config.json object. Pure.
 * Returns { read: 'ok'|'none'|'invalid'|'foreign', set, value, by, at, host, machine, why }.
 * Anything but read 'ok' is unset.
 */
function machinePolicyFrom(cfg, { machineId = null } = {}) {
  const sec = cfg && typeof cfg === 'object' ? cfg[CONFIG_SECTION] : null;
  const rec = sec && typeof sec === 'object' ? sec[MACHINE_KEY] : undefined;
  const empty = { set: false, value: null, by: null, at: null, host: null, machine: null };
  if (rec === undefined || rec === null) return { read: 'none', ...empty, why: '' };
  if (typeof rec !== 'object' || Array.isArray(rec) || !VALUES.includes(rec.value)) {
    return { read: 'invalid', ...empty, why: `${CONFIG_SECTION}.${MACHINE_KEY} in the machine config is not a human|reviewer record` };
  }
  const bits = { value: rec.value, by: rec.by || null, at: rec.at || null, host: rec.host || null, machine: rec.machine || null };
  if (bits.machine && machineId && bits.machine !== machineId) {
    return { read: 'foreign', ...empty, why: `the machine-level value was written on another machine (${bits.host || bits.machine}) — a copied config does not carry it` };
  }
  return { read: 'ok', set: true, ...bits, why: '' };
}

function defaultConfigFile() { return require('./state').CONFIG_FILE; }
function defaultMachineId() {
  try { return require('./machine').localMachine().id || null; } catch (_) { return null; }
}

/** The machine record, read from disk. Never throws: an unreadable file reads as unset. */
function readMachinePolicy({ configFile, machineId } = {}) {
  const file = configFile || defaultConfigFile();
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return machinePolicyFrom({}, {});
    return { read: 'unread', set: false, value: null, why: `${file}: ${e.message}` };
  }
  let cfg;
  try { cfg = JSON.parse(raw); } catch (e) { return { read: 'unread', set: false, value: null, why: `${file} is not valid JSON` }; }
  return machinePolicyFrom(cfg, { machineId: machineId === undefined ? defaultMachineId() : machineId });
}

/**
 * The precedence. `repoPol` = migration-grant.js parseGrantPolicy(doc); `machine` = a
 * machinePolicyFrom/readMachinePolicy result, or null. Returns repoPol's shape plus
 * { source: 'repo'|'machine'|'default', optedOut, machineBy, machineAt, machineHost, machineNote }.
 * `reason` names the source — callers print it on refusal. Pure.
 */
function resolveGrantPolicy(repoPol, machine) {
  const m = machine || null;
  const set = !!(m && m.read === 'ok' && m.set);
  const bits = set ? { machineBy: m.by || null, machineAt: m.at || null, machineHost: m.host || null }
    : { machineBy: null, machineAt: null, machineHost: null };
  if (repoPol.declared) {
    const optedOut = repoPol.valid && repoPol.policy === 'human' && set && m.value === 'reviewer';
    return { ...repoPol, source: 'repo', optedOut, ...bits, machineNote: '',
      reason: optedOut
        ? `this repo opted out: project.yml declares migration-grant: human, which wins over this machine's reviewer value (set by ${m.by} at ${m.at})`
        : repoPol.reason };
  }
  if (set) {
    return { policy: m.value, declared: false, valid: true, source: 'machine', optedOut: false, ...bits, machineNote: '',
      reason: `machine-level migration-grant: ${m.value} (set by ${m.by || '?'} at ${m.at || '?'} on ${m.host || 'this machine'}; this repo declares no key of its own)` };
  }
  const machineNote = m && (m.read === 'unread' || m.read === 'invalid' || m.read === 'foreign')
    ? `the machine-level value is not usable (${m.why || m.read}) — read as unset` : '';
  return { ...repoPol, source: 'default', optedOut: false, ...bits, machineNote,
    reason: machineNote ? `${repoPol.reason}; ${machineNote}` : repoPol.reason };
}

/** The one call a console makes: the policy for `doc`, against this machine's config. */
function effectiveGrantPolicy(doc, opts = {}) {
  return resolveGrantPolicy(migrationGrant.parseGrantPolicy(doc), readMachinePolicy(opts));
}

/** One-line source label: `repo`, `machine (<by> at <at>)`, or `default`. */
function sourceLabel(res) {
  if (!res) return 'default';
  if (res.source === 'machine') return `machine (${res.machineBy || '?'} at ${res.machineAt || '?'})`;
  return res.source;
}

/** The stored record. Pure. */
function recordFor(value, { by = null, at = null, host = null, machine = null } = {}) {
  if (!VALUES.includes(value)) throw new Error(`grant-policy: ${JSON.stringify(value)} is not one of ${VALUES.join(' | ')}`);
  return { value, by, at, host, machine };
}

/** A new config object with the machine value set (or removed, on `unset`). Every other key kept. Pure. */
function withValue(cfg, value, meta = {}) {
  const next = { ...(cfg || {}) };
  const sec = { ...(next[CONFIG_SECTION] && typeof next[CONFIG_SECTION] === 'object' ? next[CONFIG_SECTION] : {}) };
  if (value === UNSET) delete sec[MACHINE_KEY];
  else sec[MACHINE_KEY] = recordFor(value, meta);
  if (Object.keys(sec).length) next[CONFIG_SECTION] = sec; else delete next[CONFIG_SECTION];
  return next;
}

module.exports = {
  MACHINE_KEY, CONFIG_SECTION, VALUES, UNSET,
  machinePolicyFrom, readMachinePolicy, resolveGrantPolicy, effectiveGrantPolicy, sourceLabel, recordFor, withValue,
};
