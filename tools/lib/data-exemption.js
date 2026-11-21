'use strict';
/**
 * `data:` (#762): an optional repo fact — does any database this repo's code runs against hold
 * real data? — and the one exemption it opens: `colab ship`'s no-new-migrations gate.
 *
 * WHY. The migration gate protects data. On a brand-new repo whose scaffold creates the first
 * migrations, no database anywhere holds data anyone would miss — no production target, no deploy,
 * no release — yet the gate still parked the very first issue for a person's grant, and on an
 * `auto-trunk` repo it was the only thing stopping the first merge. A grant has nothing to review
 * against when no real data exists (the migration-review skill's hard rule is about a database
 * holding real data).
 *
 * THE RULE.
 *   - `data: none` declared on the TARGET's committed descriptor, and no falsifier present → the
 *     gate is exempt. Absent (or `data: real`) → the gate runs exactly as before.
 *   - A FALSIFIER is any computed sign of production, and any one restores the gate with no edit:
 *       production   `production:` is non-null
 *       axis         `tier: A|C`, or `exposure: live|released`
 *       deploy       `deploy:` names a mechanism (anything but `none`)
 *       tag          a version-shaped tag is on the target (or on the remote and cannot be placed)
 *     So the exemption cannot outlive the greenfield stage.
 *   - A malformed value reads as ABSENT — the stricter direction: the gate runs — and the audit
 *     fails it, so the declaration is never silently ignored for long.
 *   - WHERE it is read from is the caller's job: always the merge target's committed project.yml,
 *     never the branch being shipped (tools/colab shipMigrationGate), so a branch that adds
 *     `data: none` does not exempt its own migrations. Adding it is a human act — `colab adopt`
 *     asks it at first adoption under the human bar, and `colab ship` refuses an unattended landing
 *     of a branch that introduces it (`loweringVerdict` below).
 *
 * PURE: parsed docs and measured facts in, verdicts out. No git, no network.
 */

const KEY = 'data';
const VALUES = Object.freeze(['none', 'real']);

/** `v1.2.3`, `1.2.3`, `v1.2.3-rc.1` — the SemVer core is what makes a tag a release. */
const VERSION_TAG_RE = /^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:[-+][0-9A-Za-z.+-]*)?$/;

const isVersionTag = (t) => VERSION_TAG_RE.test(String(t || '').trim());

/**
 * `data:` from a parsed project.yml → { declared, valid, value, reason }.
 *   value — 'none' | 'real' when valid and declared; null otherwise (absent, or malformed).
 */
function parseData(doc) {
  const has = !!doc && typeof doc === 'object' && Object.prototype.hasOwnProperty.call(doc, KEY);
  const raw = has ? doc[KEY] : undefined;
  if (!has || raw === undefined) {
    return { declared: false, valid: true, value: null, reason: `${KEY} absent — the migration gate runs` };
  }
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (!VALUES.includes(v)) {
    return { declared: true, valid: false, value: null,
      reason: `${KEY} must be one of ${VALUES.join(' | ')}, got ${JSON.stringify(raw)} — read as absent (the migration gate runs) until fixed` };
  }
  return { declared: true, valid: true, value: v, reason: `${KEY}: ${v}` };
}

/** True only for a valid `data: none`. */
const declaresNone = (doc) => parseData(doc).value === 'none';

/** A descriptor value that says "nothing" — null, absent, blank, or the literal `none`/`null`. */
function isNothing(v) {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || s === 'none' || s === 'null' || s === '~';
}

/**
 * The falsifiers present → [{ kind, detail }]. `doc` is the target's parsed descriptor.
 * `tags` = { ok, tags: [names] } — version-shaped tags on the target as measured by the caller;
 * `ok: false` (the read failed) is itself a falsifier, so an unreadable remote fails closed.
 * Pass `tags: null` to skip the tag check (the descriptor-only reading the audit and adopt use).
 */
function falsifiers(doc, tags) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const out = [];
  if (!isNothing(d.production)) out.push({ kind: 'production', detail: `production is ${d.production}` });
  const tier = isNothing(d.tier) ? null : String(d.tier).trim().toUpperCase();
  const exposure = isNothing(d.exposure) ? null : String(d.exposure).trim().toLowerCase();
  const axis = [];
  if (tier === 'A' || tier === 'C') axis.push(`tier ${tier}`);
  if (exposure === 'live' || exposure === 'released') axis.push(`exposure ${exposure}`);
  if (axis.length) out.push({ kind: 'axis', detail: `${axis.join(' and ')} — a merge here reaches users` });
  if (!isNothing(d.deploy)) out.push({ kind: 'deploy', detail: `deploy is ${d.deploy}` });
  if (tags) {
    if (!tags.ok) out.push({ kind: 'tag', detail: `the version tags could not be read${tags.why ? ` (${tags.why})` : ''} — an unread release is not proof of none` });
    else {
      const v = (tags.tags || []).filter(isVersionTag);
      if (v.length) out.push({ kind: 'tag', detail: `version tag${v.length > 1 ? 's' : ''} ${v.slice(0, 3).join(', ')}${v.length > 3 ? ` (+${v.length - 3})` : ''} on the target — something was released` });
    }
  }
  return out;
}

/**
 * The exemption, whole → { declared, exempt, falsifiers, reason }.
 *   declared — the target declares a valid `data: none`.
 *   exempt   — declared AND no falsifier.
 *   reason   — the clause the ship row prints, in either direction.
 */
function exemptionVerdict(doc, tags) {
  const p = parseData(doc);
  if (p.value !== 'none') {
    return { declared: false, exempt: false, falsifiers: [], reason: p.reason };
  }
  const f = falsifiers(doc, tags);
  if (f.length) {
    return { declared: true, exempt: false, falsifiers: f,
      reason: `data: none does not apply: ${f.map((x) => x.detail).join('; ')}` };
  }
  return { declared: true, exempt: true, falsifiers: [],
    reason: 'exempt — data: none (no production, no deploy, no release)' };
}

/**
 * Does the branch introduce `data: none` against a target that lacks it? That lowers a protection,
 * so its landing needs the human door — the same bar as lowering exposure. → { lowers, reason }.
 */
function loweringVerdict(targetDoc, branchDoc) {
  if (!declaresNone(branchDoc) || declaresNone(targetDoc)) return { lowers: false, reason: '' };
  const before = parseData(targetDoc);
  return { lowers: true,
    reason: `this branch adds data: none (the target has ${before.declared ? `data: ${before.valid ? before.value : 'malformed'}` : 'none declared'}) — it lowers the migration gate, so a person lands it` };
}

module.exports = { KEY, VALUES, VERSION_TAG_RE, isVersionTag, parseData, declaresNone, falsifiers, exemptionVerdict, loweringVerdict };
