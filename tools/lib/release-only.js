'use strict';
/**
 * #736: checks that matter only to a RELEASE — building and installing the shipped artifact on a
 * clean machine, signing, publishing. When one of them is red on trunk, every branch used to wait
 * for a ci-grant or a cure, including branches that cannot affect that check at all. Measured: one
 * release-only install lane went red from an untested change, and about six hours of finished work
 * waited behind it, every branch green on every check it could reach.
 *
 * A repo declares those checks in project.yml, each next to the paths it covers:
 *
 *   release-only-checks:
 *     Install smoke: [packaging/, scripts/install.sh]        # a whole workflow (its `name:`)
 *     "CI / install (*)": [packaging/**]                      # one job of a workflow; `*` in the job part
 *
 * `colab ship`'s trunk-CI row then lets ONE branch past a trunk that is red ONLY on declared checks,
 * provided the branch touches none of the paths those red checks cover — a third red-trunk door
 * beside the cure rule (#281) and the ci-grant (#105). Like them it makes nothing green: `colab
 * trunk-ci` still reads the red, and `colab release cut` still refuses at that commit, because
 * neither reads this key. The verifying-runs policy (verify-runs.js) is deliberately untouched, so
 * `ship-ignore-workflows` keeps its one shared meaning for ship and the cut.
 *
 * PURE: a parsed descriptor and run/job/diff facts in, verdicts out. The I/O is tools/colab's
 * shipReleaseOnly. Every doubt refuses: the door is an exemption, and a false refusal costs exactly
 * today's behaviour (the cure rule and the ci-grant are still consulted), while a false admission
 * lands a branch over a red nobody looked at.
 */

const codeowners = require('./codeowners');

const KEY = 'release-only-checks';
const JOB_SEP = ' / ';

/** Conclusions of a run or job that executed nothing — never a red, never a verification. */
const NEUTRAL = new Set(['skipped', 'neutral']);

function unquote(s) {
  const t = String(s).trim();
  if (t.length > 1 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) return t.slice(1, -1).trim();
  return t;
}

/** `*` in a job name matches any run of characters (matrix legs: `install (*)`); the rest is literal. */
function jobPattern(job) {
  return new RegExp(`^${job.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

/**
 * The declaration from a parsed project.yml doc:
 * `{ declared, valid, checks: [{key, workflow, job, paths, res, jobRe}], problems: string[] }`.
 * Any problem makes the whole key invalid and the reader IGNORES it (no exemption at all) — a
 * half-read declaration must never exempt a check its owner did not name. The audit fails it.
 */
function parseReleaseOnly(doc) {
  const has = !!doc && Object.prototype.hasOwnProperty.call(doc, KEY);
  const none = { declared: false, valid: true, checks: [], problems: [] };
  if (!has || doc[KEY] === null || doc[KEY] === undefined) return none;
  const v = doc[KEY];
  const bad = (why) => ({ declared: true, valid: false, checks: [], problems: [why] });
  if (typeof v !== 'object' || Array.isArray(v)) {
    return bad(`${KEY} must be a map of "<workflow>" or "<workflow> / <job>" to an inline list of the paths that check covers, got ${JSON.stringify(v)}`);
  }
  const entries = Object.entries(v);
  if (!entries.length) return bad(`${KEY} declares no check — remove the key, or name at least one`);
  const problems = [];
  const checks = [];
  for (const [rawKey, rawPaths] of entries) {
    const key = unquote(rawKey);
    // Split at the FIRST ` / ` — the way the forge displays a check ("CI / install (macos)"). A trailing
    // ` /` with nothing after it is a job key with no job, never a workflow named "CI /".
    const m = /^(.*?)\s+\/(?:\s+(.*))?$/.exec(key);
    const workflow = (m ? m[1] : key).trim();
    const job = m ? String(m[2] || '').trim() : null;
    if (!workflow || (m && !job)) { problems.push(`${KEY}: "${key}" names no ${!workflow ? 'workflow' : 'job'}`); continue; }
    const list = typeof rawPaths === 'string' ? [rawPaths] : rawPaths;
    if (!Array.isArray(list) || !list.length) {
      problems.push(`${KEY}: "${key}" must list the paths it covers (a check with no paths would exempt every branch), got ${JSON.stringify(rawPaths)}`);
      continue;
    }
    const paths = [];
    const res = [];
    for (const p of list) {
      const s = typeof p === 'string' ? unquote(p) : '';
      const re = s ? codeowners.compile(s) : null;
      if (!re) { problems.push(`${KEY}: "${key}" path ${JSON.stringify(p)} is not a CODEOWNERS-style pattern (no negation, no [ ] ranges)`); continue; }
      paths.push(s);
      res.push(re);
    }
    if (paths.length !== list.length) continue;
    checks.push({ key, workflow, job, paths, res, jobRe: job ? jobPattern(job) : null });
  }
  if (problems.length) return { declared: true, valid: false, checks: [], problems };
  return { declared: true, valid: true, checks, problems: [] };
}

/** The checks that name `workflow`, split into whole-workflow and per-job ones. */
function checksFor(checks, workflow) {
  const mine = checks.filter((c) => c.workflow === workflow);
  return { whole: mine.find((c) => !c.job) || null, jobs: mine.filter((c) => c.job) };
}

function isGreen(c) { return c === 'success'; }
function isNeutral(c) { return NEUTRAL.has(c); }

/**
 * Does the release-only door admit this branch over a red trunk?
 *
 * @param {object} a
 * @param {Array<{workflowName, status, conclusion, databaseId}>|null} a.heads - the JUDGED heads at the
 *        red sha (newest run per counted workflow, git.summarizeRunsForCommit `opts.heads`); null = unread
 * @param {(runId:number) => Array<{name, status, conclusion}>|null} [a.jobsOf] - a run's jobs; null = unread
 * @param {string[]|null} a.changed - the paths the branch changes (three-dot diff); null = unread
 * @param {Array} a.checks - parseReleaseOnly's `checks`
 * @returns {{applies:boolean, ok:boolean, reason:string, ignored:Array, touched:Array}}
 *   `applies: false` — nothing declared, or the red is not a finished run (none, wedged, in flight):
 *   the door has nothing to say and the raw verdict stands with no note.
 */
function releaseOnlyVerdict({ heads, jobsOf = null, changed, checks }) {
  const out = (applies, ok, reason, ignored = [], touched = []) => ({ applies, ok, reason, ignored, touched });
  if (!Array.isArray(checks) || !checks.length) return out(false, false, 'no release-only check declared');
  if (!Array.isArray(heads)) return out(true, false, 'could not read the runs at the red sha');
  const unfinished = heads.filter((h) => h.status !== 'completed');
  const red = heads.filter((h) => h.status === 'completed' && !isGreen(h.conclusion) && !isNeutral(h.conclusion));
  if (!red.length) return out(false, false, 'no finished red run at the red sha');
  if (unfinished.length) {
    return out(true, false, `a run is still in flight at the red sha (${unfinished.map((h) => h.workflowName || 'unnamed').join(', ')})`);
  }

  let verifiedElsewhere = heads.some((h) => h.status === 'completed' && isGreen(h.conclusion) && !checksFor(checks, h.workflowName).whole);
  const ignored = [];
  const redChecks = [];
  for (const h of red) {
    const name = h.workflowName || null;
    const runRef = `${name || 'unnamed'}${h.databaseId ? ` (run ${h.databaseId})` : ''}`;
    const { whole, jobs } = name ? checksFor(checks, name) : { whole: null, jobs: [] };
    if (whole) {
      ignored.push({ check: whole.key, workflow: name, job: null, runId: h.databaseId || null, conclusion: h.conclusion });
      redChecks.push(whole);
      continue;
    }
    if (!jobs.length) return out(true, false, `trunk is also red on ${runRef}, which is not a release-only check`);
    const list = jobsOf && h.databaseId ? jobsOf(h.databaseId) : null;
    if (!Array.isArray(list) || !list.length) return out(true, false, `could not read the jobs of ${runRef} to tell a release-only job from the rest`);
    const redJobs = list.filter((j) => j.status === 'completed' && !isGreen(j.conclusion) && !isNeutral(j.conclusion));
    const stillRunning = list.filter((j) => j.status !== 'completed');
    if (stillRunning.length) return out(true, false, `${runRef} still has a job in flight (${stillRunning.map((j) => j.name).join(', ')})`);
    if (!redJobs.length) return out(true, false, `${runRef} is red but no job of it finished red — nothing to attribute the red to`);
    for (const j of redJobs) {
      const c = jobs.find((x) => x.jobRe.test(String(j.name || '')));
      if (!c) return out(true, false, `trunk is also red on ${name} / ${j.name || 'unnamed'} (run ${h.databaseId}), which is not a release-only check`);
      ignored.push({ check: c.key, workflow: name, job: j.name, runId: h.databaseId || null, conclusion: j.conclusion });
      if (!redChecks.includes(c)) redChecks.push(c);
    }
    if (list.some((j) => j.status === 'completed' && isGreen(j.conclusion) && !jobs.some((x) => x.jobRe.test(String(j.name || ''))))) verifiedElsewhere = true;
  }
  if (!verifiedElsewhere) {
    return out(true, false, 'nothing but release-only checks verified the red sha — no other check ran green there', ignored);
  }
  if (!Array.isArray(changed)) return out(true, false, 'could not read the branch diff to check it against the release-only paths', ignored);
  const touched = [];
  for (const c of redChecks) {
    const hits = changed.filter((p) => c.res.some((re) => re.test(p)));
    if (hits.length) touched.push({ check: c.key, paths: hits });
  }
  if (touched.length) {
    const t = touched.map((x) => `${x.paths.slice(0, 3).join(', ')}${x.paths.length > 3 ? ` (+${x.paths.length - 3})` : ''} — covered by "${x.check}"`).join('; ');
    return out(true, false, `the branch touches what a red release-only check covers (${t}), so it must show that check green on itself — the cure rule or a ci-grant`, ignored, touched);
  }
  return out(true, true, `trunk is red only on release-only check(s), and the branch touches none of their paths`, ignored);
}

/** The compact list a detail or trailer names the ignored red by: `Install smoke (run 7), CI / install (macos) (run 9)`. */
function ignoredList(ignored) {
  const seen = new Set();
  const parts = [];
  for (const x of ignored || []) {
    const s = `${x.workflow}${x.job ? `${JOB_SEP}${x.job}` : ''}${x.runId ? ` (run ${x.runId})` : ''}`;
    if (!seen.has(s)) { seen.add(s); parts.push(s); }
  }
  return parts.join(', ');
}

module.exports = { KEY, JOB_SEP, parseReleaseOnly, releaseOnlyVerdict, ignoredList };
