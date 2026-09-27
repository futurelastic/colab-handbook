'use strict';
/**
 * The `--refs` brake reminder (#385). PURE — labels/body in, finding out; all `gh` I/O stays in
 * the CLI, same split as `lib/checklist.js`.
 *
 * THE INCIDENT. A ship landed an issue's code with `colab ship --refs #N`, deliberately keeping
 * it open: its only unticked "done when" items were a live end-to-end proof no code session can
 * produce. After the merge the issue was open, `deps-checked`, unclaimed and carried no hold, so
 * it was startable again AS CODE WORK. An implementer session picked it up, found nothing to do,
 * and sat holding a concurrency slot for about an hour until a human-side watch parked it.
 *
 * `--refs` is a deliberate choice and stays ungated (CONVENTIONS.md §4, #263). What it did not do
 * is ask for the other half of that choice: an issue kept open for a non-code leftover has to say
 * "do not start me" in a form a scheduler reads — a hold label (§5, *Disposition* / *Holds*).
 * This module decides when to remind. It never refuses, and never writes the label itself: which
 * hold, whose wake and which date are the shipper's judgement, the same authorship argument #263
 * made for not auto-filing a `Remainder: #M`.
 *
 * WHEN IT FIRES — all three:
 *   1. the issue was kept open by the `--refs` FLAG (the caller filters; the `tracking` label and
 *      the checklist gate are not this path);
 *   2. its body still has at least one unticked `- [ ]` box ANYWHERE — not only under `## Plan`.
 *      The incident's leftovers sat under a "Done when" heading, which the close gate's parser
 *      (Plan-only, on purpose) cannot see. A reminder may over-fire; a gate may not.
 *   3. it carries NOTHING that already stops a start (`brakeLabel` below).
 */

const labels = require('./labels');

/** A GitHub checklist line, same shape as checklist.js ITEM_RE. */
const ITEM_RE = /^\s*[-*]\s*\[([ xX])\]\s*\S/;

/** Count checklist boxes anywhere in a body. */
function countBoxes(body) {
  let total = 0, unticked = 0;
  for (const line of String(body || '').split('\n')) {
    const m = ITEM_RE.exec(line);
    if (!m) continue;
    total++;
    if (m[1] === ' ') unticked++;
  }
  return { total, unticked };
}

function names(present) {
  return (present || []).map((n) => (n && typeof n === 'object' ? n.name : n)).filter((n) => n !== undefined && n !== null).map(String);
}

/**
 * The first label already stopping a start, or `null`. Recognised:
 *   - `deferred:*`                         a park (CONVENTIONS.md §5, *Disposition*)
 *   - `needs-decision`                      waiting on a human ruling
 *   - a non-code `delivery:*` value         routed, not started (`labels.isRouteNotStart`)
 *   - `tracking`                            long-lived memory, referenced by design
 *   - any label declared under `holds:`     (§5, *Holds*, #360) — passed in as `declaredHolds`
 */
function brakeLabel(present, declaredHolds) {
  const have = names(present);
  const declared = new Set((Array.isArray(declaredHolds) ? declaredHolds : []).map(String));
  for (const n of have) {
    if (n.startsWith(labels.DEFERRED_LABEL_PREFIX)) return n;
    if (n === labels.NEEDS_DECISION_LABEL) return n;
    if (n === labels.TRACKING_LABEL) return n;
    if (declared.has(n)) return n;
  }
  if (labels.isRouteNotStart(present)) return have.find((n) => n.startsWith('delivery:')) || 'delivery:*';
  return null;
}

/**
 * The finding for one `--refs`'d issue, or `null` when no reminder is due.
 * Shape: `{ issue, unticked, total, reason }`.
 */
function refsBrakeFinding({ issue, body, labels: present, declaredHolds } = {}) {
  const { total, unticked } = countBoxes(body);
  if (unticked === 0) return null;
  if (brakeLabel(present, declaredHolds)) return null;
  return {
    issue, unticked, total,
    reason: `kept open by --refs with ${unticked}/${total} unticked box(es) and no hold — it reads as startable code work after this ship`,
  };
}

/** The operator-facing lines for one finding — the two shapes §4 offers, in order of preference. */
function reminderLines(f) {
  return [
    `#${f.issue}: ${f.reason}.`,
    `  Leftover is NOT code (a live proof, an ops check, a measurement)? Park it in the same step:`,
    `    gh issue edit ${f.issue} --add-label deferred:<date|measurement|external-party> --add-label review-by:<YYYY-MM-DD>`,
    `    + one comment: "Hold: deferred:<kind> — owner: <who posts it> — wake: <wake>" / "Because: <what is left>"`,
    `  Leftover IS code? Prefer \`Remainder: #M\` on #${f.issue} over --refs, and let it close.`,
  ];
}

module.exports = { countBoxes, brakeLabel, refsBrakeFinding, reminderLines };
