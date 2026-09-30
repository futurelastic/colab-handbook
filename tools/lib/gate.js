'use strict';
/**
 * tools/lib/gate.js — the optional `gate:` block in .github/project.yml (#410).
 *
 * The ruling it encodes: local is a fast smoke check, branch CI is the one authoritative gate.
 * On a shared, loaded workstation a full local suite ran 6–10 min and flaked on timeouts, while the
 * same suite finished in 2–7 min on a clean CI runner — and #403's hermetic rule doubled every local
 * run. So a repo may declare
 *
 *   gate:
 *     smoke: npm run smoke        # the fast local check code-wrap A3 runs once
 *     authoritative: ci           # the verdict is branch CI at the pushed head sha
 *
 * and code-wrap / code-ship then read branch CI instead of re-running the suite locally. Absent (or
 * `authoritative: local`) = today's behaviour exactly: the local full gate plus `colab gate-hermetic`.
 *
 * `authoritative: ci` only takes effect where branch CI can actually arrive: `gateMode` returns
 * `ci` only when a workflow fires on a feature-branch push. A repo whose CI runs on PRs and trunk
 * pushes alone keeps the local gate however it is declared — the audit warns about that shape.
 *
 * Pure: objects in, objects out. The audit and the skills read through this one module.
 */

const AUTHORITATIVE = ['ci', 'local'];
const KEYS = ['smoke', 'authoritative'];
// A branch name no repo would ever cut, shaped like a conforming feature branch — the probe the
// audit feeds to workflowsFiringOnBranchPush to ask "does a push to an ordinary session branch
// trigger any workflow?".
const PROBE_REF = 'feat/gate-probe-0';

function absent() {
  return { declared: false, valid: true, smoke: null, authoritative: 'local', reason: 'gate absent — the local full gate (plus the hermetic run) is the verdict' };
}

function invalid(reason) {
  return { declared: true, valid: false, smoke: null, authoritative: 'local', reason: `${reason} — read as absent, so the local full gate stays the verdict` };
}

/**
 * `gate:` → `{ declared, valid, smoke, authoritative, reason }`. Any defect is read in the STRICTER
 * direction (local full gate) while the audit fails the value — a declaration nobody can trust is
 * not an answer.
 */
function parseGate(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, 'gate');
  if (!has || doc.gate === null || doc.gate === undefined) return absent();
  const g = doc.gate;
  if (typeof g === 'string' && g.trim().startsWith('{')) {
    return invalid('gate: is written as an inline {…} map, which project.yml does not parse — write it as a block (gate:\\n  smoke: <cmd>\\n  authoritative: ci)');
  }
  if (typeof g !== 'object' || Array.isArray(g)) {
    return invalid(`gate is ${JSON.stringify(g)} — it must be a block with smoke: <command> and optional authoritative: ci|local`);
  }
  const unknown = Object.keys(g).filter((k) => !KEYS.includes(k));
  if (unknown.length) return invalid(`gate has unknown key${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')} — only smoke and authoritative are defined`);
  if (typeof g.smoke !== 'string' || !g.smoke.trim()) {
    return invalid('gate.smoke is missing or empty — it names the fast local check code-wrap A3 runs');
  }
  const auth = g.authoritative === undefined || g.authoritative === null ? 'local' : g.authoritative;
  if (!AUTHORITATIVE.includes(auth)) {
    return invalid(`gate.authoritative is ${JSON.stringify(auth)} — the defined values are ci and local`);
  }
  return {
    declared: true, valid: true, smoke: g.smoke.trim(), authoritative: auth,
    reason: auth === 'ci'
      ? 'gate: authoritative ci — local runs the smoke check once; branch CI at the pushed head is the verdict'
      : 'gate: authoritative local — the local full gate (plus the hermetic run) is the verdict; smoke is the iteration check',
  };
}

/**
 * Which verdict the skills read: `'ci'` only when `authoritative: ci` is validly declared AND a
 * workflow fires on a feature-branch push (`branchCiFires`). Everything else is `'local'`.
 */
function gateMode({ gate, branchCiFires }) {
  const g = gate || absent();
  return g.valid && g.authoritative === 'ci' && branchCiFires ? 'ci' : 'local';
}

module.exports = { parseGate, gateMode, PROBE_REF, AUTHORITATIVE };
