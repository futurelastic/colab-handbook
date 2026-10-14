'use strict';
/**
 * tools/lib/integration-profile.js — where a repo's heavy CI lane runs, and what a green trunk
 * promises (#610). The pure half: project.yml in, a profile and verdicts out. No git, no gh.
 *
 * #607 split CI into a light lane (every push; the lane `colab ship` reads) and a heavy lane (the
 * whole suite, e2e, load: nightly and at every official build). That is ONE shape. Some repos cannot
 * accept a trunk that is only light-green between releases; others want the heavy lane more often
 * than at release. `integration-profile:` makes the shape a declared choice:
 *
 *   gated          every landing waits on a green heavy run at the candidate's exact sha
 *                  (the branch head, or the batch head under `colab ship --batch`). Trunk is
 *                  always heavy-green.
 *   qualify        ship reads the light lane only; the heavy lane runs on trunk on a clock (the
 *                  heavy workflow's cron), plus nightly and at the release gate. Trunk may be heavy-
 *                  red for at most one clock window; a red is reverted first.
 *   release-heavy  #607's shape and the DEFAULT when the key is absent: light per merge, heavy
 *                  nightly and at the official build.
 *   promote        a `develop → main` repo: the heavy lane gates the promotion. Kept for repos that
 *                  already run it for an approval gate; not offered to new repos.
 *
 * Under EVERY profile a final release needs the heavy lane green at the candidate's sha, wherever the
 * repo has a heavy lane at all (release-finalize.js `heavy-lane`).
 *
 * The heavy lane is found by its workflow FILE (`heavy-workflow:`, default `ci-heavy.yml` — the name
 * #607's templates give it, and the name release-auto.yml already dispatches by). Run rows carry the
 * workflow's `name:`, not its file, so the caller reads the file at the sha to learn which rows are
 * heavy (`tools/colab` heavyWorkflowNameAt).
 *
 * FAIL CLOSED, like parseShipBatch: a malformed value reads as the default (`release-heavy`, ship
 * unchanged) and the audit fails it. A typo must never silently weaken a declared `gated` — but it
 * cannot strengthen anything either, and the audit is where a broken descriptor is reported.
 */

const KEY = 'integration-profile';
const HEAVY_KEY = 'heavy-workflow';
const PROFILES = Object.freeze(['gated', 'qualify', 'release-heavy', 'promote']);
const DEFAULT_PROFILE = 'release-heavy';
const DEFAULT_HEAVY_WORKFLOW = 'ci-heavy.yml';

function hasKey(doc, key) {
  return !!doc && Object.prototype.hasOwnProperty.call(doc, key) && doc[key] !== null && doc[key] !== undefined && doc[key] !== '';
}

/** `{ profile, declared, valid, reason }` — absent → release-heavy, undeclared; bad → release-heavy, invalid. */
function parseProfile(doc) {
  if (!hasKey(doc, KEY)) return { profile: DEFAULT_PROFILE, declared: false, valid: true, reason: `${KEY} absent (${DEFAULT_PROFILE})` };
  const raw = doc[KEY];
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (typeof v === 'string' && PROFILES.includes(v)) return { profile: v, declared: true, valid: true, reason: `${KEY}: ${v}` };
  return { profile: DEFAULT_PROFILE, declared: true, valid: false,
    reason: `${KEY} is ${JSON.stringify(raw)}, expected one of ${PROFILES.join(' | ')} (omit for ${DEFAULT_PROFILE})` };
}

/** `{ file, declared, valid, reason }` — a bare workflow file name under .github/workflows. */
function parseHeavyWorkflow(doc) {
  if (!hasKey(doc, HEAVY_KEY)) return { file: DEFAULT_HEAVY_WORKFLOW, declared: false, valid: true, reason: `${HEAVY_KEY} absent (${DEFAULT_HEAVY_WORKFLOW})` };
  const raw = doc[HEAVY_KEY];
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (/^[A-Za-z0-9._-]+\.ya?ml$/.test(v)) return { file: v, declared: true, valid: true, reason: `${HEAVY_KEY}: ${v}` };
  return { file: DEFAULT_HEAVY_WORKFLOW, declared: true, valid: false,
    reason: `${HEAVY_KEY} is ${JSON.stringify(raw)}, expected a workflow file name in .github/workflows (e.g. ${DEFAULT_HEAVY_WORKFLOW})` };
}

/**
 * The heavy lane's verdict at one sha, from the rows of that workflow at that sha
 * (`{status, conclusion}`). Same all-runs reading as ship's: any finished not-green row (cancelled
 * aside) is red; any unfinished row is pending; green needs a success. A red re-run green later is
 * still red here only while the red row is the newest — callers pass the newest attempt's rows.
 *   null rows → `unread` (the run list could not be read — never "none")
 */
function heavyVerdict(rows) {
  if (!Array.isArray(rows)) return { state: 'unread', why: 'the run list could not be read' };
  if (!rows.length) return { state: 'none', why: 'no heavy run at this sha' };
  // A re-run is the same run with a higher attempt; separate dispatches are separate rows. The newest
  // dispatch speaks for the sha (a red then a green re-dispatch is green), so read the newest row.
  const newest = rows.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  const ref = newest.url || (newest.databaseId !== undefined && newest.databaseId !== null ? `run ${newest.databaseId}` : null);
  if (newest.status !== 'completed') return { state: 'pending', why: `the heavy run is ${newest.status || 'in flight'}`, url: ref };
  if (newest.conclusion === 'success') return { state: 'green', why: 'the heavy run succeeded', url: ref };
  if (newest.conclusion === 'cancelled') return { state: 'none', why: 'the newest heavy run was cancelled', url: ref };
  return { state: 'red', why: `the heavy run finished ${newest.conclusion || 'without a conclusion'}`, url: ref };
}

/**
 * #610's one restriction: on exposure `live` the promotion deploys, so a trunk that may be heavy-red
 * (qualify, release-heavy) must not feed it — unless the deploy is a tag the release gate qualifies.
 * Only a DECLARED profile is refused: an absent key reads release-heavy for ship, but a repo that never
 * declared is not suddenly failing; it gets a suggestion instead. Returns null or `{ level, message }`.
 */
function liveRestriction({ profile, declared, exposure, deploy }) {
  if (exposure !== 'live') return null;
  if (deploy === 'tag') return null;
  if (profile === 'gated' || profile === 'promote') return null;
  if (declared) {
    return { level: 'fail', message: `${KEY}: ${profile} on exposure: live with deploy: ${deploy || '(none)'} — ${profile} allows a heavy-red trunk, and here the promotion deploys it. Choose gated, or deploy from a qualified tag (CONVENTIONS.md §7, Integration profiles)` };
  }
  return { level: 'suggest', message: `exposure: live reads ${KEY}: ${DEFAULT_PROFILE} by default, which allows a heavy-red trunk to be promoted — consider declaring ${KEY}: gated (CONVENTIONS.md §7, Integration profiles)` };
}

/**
 * The gate a `colab ship` landing must pass under the profile, given the heavy verdict at the
 * candidate. Only `gated` gates a landing; every other profile returns null (ship reads the light
 * lane exactly as before). `docsOnly` landings never wait on CI (#606) and are exempt here too.
 *   → null | { ok, action: 'pass'|'dispatch'|'wait'|'refuse', detail }
 */
function landingGate({ profile, docsOnly = false, heavyPresent, verdict, file, at }) {
  if (profile !== 'gated' || docsOnly) return null;
  if (!heavyPresent) {
    return { ok: false, action: 'refuse', detail: `${KEY}: gated, but no .github/workflows/${file} at ${at} — gated lands only on a green heavy run, and there is no heavy lane to run (add one from templates/ci-<stack>-heavy.yml, or name it with ${HEAVY_KEY}:)` };
  }
  const v = verdict || { state: 'unread', why: 'not read' };
  const link = v.url ? ` (${v.url})` : '';
  switch (v.state) {
    case 'green': return { ok: true, action: 'pass', detail: `${KEY}: gated — heavy lane green at ${at}${link}` };
    case 'none': return { ok: false, action: 'dispatch', detail: `${KEY}: gated — no heavy run at ${at} yet (${v.why})` };
    case 'pending': return { ok: false, action: 'wait', detail: `${KEY}: gated — ${v.why} at ${at}${link}` };
    case 'red': return { ok: false, action: 'refuse', detail: `${KEY}: gated — ${v.why} at ${at}${link}; it blocks landing (fix it, or re-dispatch the heavy lane once a flake is proven)` };
    default: return { ok: false, action: 'wait', detail: `${KEY}: gated — cannot read the heavy lane at ${at} (${v.why})` };
  }
}

/**
 * A batch's effective verdict under `gated`: the combined (light) verdict AND the heavy verdict at the
 * batch head. Shapes match ship-batch.js combinedVerdict (`{state, attempt, runIds, why}`), so the
 * existing re-run / split / land machinery reads it unchanged — a heavy red splits the wave toward the
 * culprit exactly as a light red does. `heavy: null` (profile not gated) → the light verdict as is.
 */
function waveVerdict(light, heavy) {
  if (!heavy || !light) return light;
  if (light.state !== 'green') return light;
  if (heavy.state === 'green') return { ...light, why: `${light.why}; heavy lane green` };
  if (heavy.state === 'red') return { ...light, state: 'red', why: `heavy lane: ${heavy.why}${heavy.url ? ` (${heavy.url}; re-dispatch it for a red:infra, it is not one of the run ids below)` : ''}` };
  return { ...light, state: 'pending', heavyMissing: heavy.state === 'none', why: `light green; heavy lane: ${heavy.why}` };
}

/**
 * The final release's heavy-lane condition — under EVERY profile (#610). A repo with no heavy lane at
 * the candidate has nothing to gate (#607's templates say the same: "no heavy lane here → no gate"),
 * so it passes and says so; refusing every release of a repo that never wrote one would break every
 * adopter. With one: green → ok; red → blocking; none / running / unreadable → `pending` — the
 * candidate keeps testing, it is not refused (the release workflow starts the heavy lane at each
 * candidate; by hand: the printed command).
 *   → { ok, pending, detail }
 */
function releaseHeavyCondition({ present, file, verdict, at, ref }) {
  if (!present) return { ok: true, pending: false, detail: `no .github/workflows/${file} at ${at} — no heavy lane in this repo, nothing to gate` };
  const v = verdict || { state: 'unread', why: 'not read' };
  const link = v.url ? ` (${v.url})` : '';
  const start = `gh workflow run ${file} --ref ${ref || '<the candidate tag>'} -f ref=${ref || '<the candidate tag>'}`;
  if (v.state === 'green') return { ok: true, pending: false, detail: `heavy lane green at ${at}${link}` };
  if (v.state === 'red') return { ok: false, pending: false, detail: `heavy lane red at ${at}${link} — a final needs it green at this exact sha: re-run it green, or cut a new candidate` };
  if (v.state === 'pending') return { ok: false, pending: true, detail: `heavy lane still running at ${at}${link} — no final until it is green` };
  if (v.state === 'none') return { ok: false, pending: true, detail: `no heavy run at ${at} yet — start it: ${start}` };
  return { ok: false, pending: true, detail: `cannot read the heavy lane at ${at} (${v.why}) — not finalized in this run` };
}

module.exports = {
  KEY, HEAVY_KEY, PROFILES, DEFAULT_PROFILE, DEFAULT_HEAVY_WORKFLOW,
  parseProfile, parseHeavyWorkflow, heavyVerdict, liveRestriction, landingGate, waveVerdict, releaseHeavyCondition,
};
