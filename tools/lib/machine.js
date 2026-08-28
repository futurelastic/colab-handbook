'use strict';
/**
 * Machine identity — #289. `os.hostname()` alone false-refuses a place-claim the instant a Mac's
 * short hostname drifts against its FQDN (`devbox.local` vs `devbox`) or DHCP/mDNS hands out
 * a different label between processes — the SAME machine reads as foreign, and `lib/place.js`'s
 * foreign-host branch (the sync-hazard backstop, CONVENTIONS.md "Place-claims") refuses on it.
 *
 * Two-tier comparison fixes this without weakening the backstop it exists inside:
 *   1. `canonHost` — a cheap, pure string normalization (case, trailing dot, drop every label after
 *      the first) that alone resolves the `.local`-vs-FQDN case.
 *   2. A hardware-bound id (`localMachine().id`), when both sides have one — exact and drift-proof,
 *      because it does not depend on hostname resolution at all.
 *
 * WHY A HARDWARE ID AND NOT A FILE UNDER `~/.colab`. A generated id persisted there inherits exactly
 * the sync hazard the foreign-host branch exists to backstop (place.js's header, "MACHINE-LOCAL ONLY,
 * DELIBERATELY"): if `~/.colab` itself is synced, two machines would read the SAME generated id and
 * the backstop silently disappears. `ioreg`/`machine-id`/MAC addresses are bound to the hardware they
 * describe and cannot travel over a file sync.
 *
 * BACKWARD COMPATIBLE BY CONSTRUCTION, NO MIGRATION. A record written before this landed has no
 * `machine` field, so `sameMachineWith` falls through to the `canonHost` comparison (branch 3) —
 * strictly MORE permissive than the raw `rec.host !== os.hostname()` check it replaces (a fixed
 * hostname-string match is a special case of a canonicalized one). No record that compared equal
 * before can start comparing unequal now.
 *
 * NEVER THROWS. Every resolution step degrades to the next on any failure (`ioreg` absent, machine-id
 * file unreadable, no non-internal network interface) and the final fallback is `id: null`, at which
 * point `sameMachineWith` falls back to the hostname comparison — never worse than what existed
 * before this module.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { run } = require('./git');

/**
 * `String(h).trim()`, drop a trailing `.` (bare or FQDN-style), lowercase, then keep only the FIRST
 * label — `split('.')[0]`. `Devbox.local.`, `devbox.local`, `devbox.hsd1.ca.comcast.net`
 * and `devbox` all canonicalize to `devbox`. Falsy input (`''`, `null`, `undefined`) → `''`.
 */
function canonHost(h) {
  if (!h) return '';
  const s = String(h).trim().replace(/\.+$/, '').toLowerCase();
  return s.split('.')[0] || '';
}

/** The scheme prefix of a `<scheme>:<value>` machine id, e.g. `iokit` from `iokit:1234-...`. */
function idScheme(id) {
  const i = String(id || '').indexOf(':');
  return i === -1 ? '' : String(id).slice(0, i);
}

/**
 * darwin: `ioreg -rd1 -c IOPlatformExpertDevice` → the `IOPlatformUUID` line → `iokit:<uuid>`.
 * `run` is injected (same helper `tools/lib/procs.js` spawns `lsof`/`ps` through) so this is testable
 * without actually running on darwin. Any failure — command missing, non-zero exit, no matching
 * line — degrades to `null`, never throws.
 */
function darwinPlatformId(runFn) {
  try {
    const r = runFn('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
    if (!r || !r.stdout) return null;
    const m = r.stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    return m ? `iokit:${m[1]}` : null;
  } catch (_) {
    return null;
  }
}

/**
 * linux: `/etc/machine-id`, falling back to `/var/lib/dbus/machine-id` → `dbus:<id>`. `readFileFn`
 * is injected for the same testability reason as `darwinPlatformId`.
 */
function linuxMachineId(readFileFn) {
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const id = String(readFileFn(p, 'utf8') || '').trim();
      if (id) return `dbus:${id}`;
    } catch (_) {
      // try the next path
    }
  }
  return null;
}

/**
 * Last-resort fallback when neither platform-specific id resolved (an unsupported OS, or the
 * platform call itself failed): a sha1 of every non-internal MAC address `os.networkInterfaces()`
 * reports, sorted so interface enumeration order cannot change the id between runs, truncated to 12
 * hex chars — enough to disambiguate machines, short enough to stay readable in a log line.
 */
function macFallbackId(networkInterfacesFn) {
  try {
    const ifaces = networkInterfacesFn() || {};
    const macs = [];
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name] || []) {
        if (iface && iface.mac && iface.mac !== '00:00:00:00:00:00' && !iface.internal) {
          macs.push(iface.mac.toLowerCase());
        }
      }
    }
    if (!macs.length) return null;
    macs.sort();
    const hash = crypto.createHash('sha1').update(macs.join(',')).digest('hex').slice(0, 12);
    return `mac:${hash}`;
  } catch (_) {
    return null;
  }
}

/**
 * The full resolution order as ONE injectable function, so `localMachine()`'s degrade path is
 * testable without mocking `require('./git')`/`require('fs')`/`require('os')` at the module level.
 * Not part of the module's stated public API (which is the four names in `module.exports` the header
 * comment describes) but exported anyway — a private helper with no test seam just moves the
 * untestable surface from here to `localMachine`, it does not remove it.
 */
function resolveMachineId({
  platform = process.platform,
  runFn = run,
  readFileFn = fs.readFileSync,
  networkInterfacesFn = os.networkInterfaces,
} = {}) {
  let id = null;
  if (platform === 'darwin') id = darwinPlatformId(runFn);
  else if (platform === 'linux') id = linuxMachineId(readFileFn);
  if (!id) id = macFallbackId(networkInterfacesFn);
  return id;
}

let _cached = null;

/**
 * `{ id, host }` for THIS machine, memoized per process — one `ioreg`/file-read spawn no matter how
 * many records `colab doctor` checks in one run. `id` is `null` when every scheme failed (unsupported
 * platform, sandboxed environment, no usable network interface); callers must tolerate that, exactly
 * as `sameMachineWith` does (falls back to the hostname comparison). Never throws.
 */
function localMachine() {
  if (_cached) return _cached;
  let id = null;
  try {
    id = resolveMachineId();
  } catch (_) {
    id = null;
  }
  let host = '';
  try {
    host = os.hostname() || '';
  } catch (_) {
    host = '';
  }
  _cached = { id: id || null, host };
  return _cached;
}

/**
 * Is `rec` (a place-claim/worktree/claim record carrying `host` and, on records written after
 * #289, `machine`) the SAME machine as `local` (the `{id, host}` shape `localMachine()` returns)?
 * Pure — never touches `os`/`fs`/child processes itself, so this is the part actually under test.
 *
 * 1. Neither side names a machine at all (`!rec.host && !rec.machine`) → `true`. Preserves today's
 *    "falsy host skips the check" behaviour (place.js's pre-#289 `rec.host && rec.host !== ...`).
 * 2. Both sides carry a hardware id of the SAME scheme → exact match. Authoritative in both
 *    directions for any record written after this landed; immune to hostname drift entirely.
 * 3. Otherwise → canonicalized hostname comparison. This is the branch every legacy record (no
 *    `machine` field) takes, and it is strictly more permissive than a raw string `===`.
 */
function sameMachineWith(rec, local) {
  const r = rec || {};
  const l = local || {};
  if (!r.host && !r.machine) return true;
  if (r.machine && l.id && idScheme(r.machine) === idScheme(l.id)) {
    return r.machine === l.id;
  }
  return canonHost(r.host) === canonHost(l.host);
}

/** `sameMachineWith(rec, localMachine())` — the impure convenience wrapper every caller reaches for. */
function isLocal(rec) {
  return sameMachineWith(rec, localMachine());
}

module.exports = { canonHost, localMachine, sameMachineWith, isLocal, resolveMachineId };
