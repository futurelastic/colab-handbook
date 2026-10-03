'use strict';
/**
 * The release workflow on a private repo runs on the repo's own runners (#453).
 *
 * On a PRIVATE (or internal) repository GitHub-hosted minutes are billed, and when the
 * owner's billing fails GitHub refuses a hosted job before it starts. The release workflow
 * (templates/release-auto.yml, or anything running `colab release cut|finalize --auto`) fires
 * on every green trunk run, so a refused hosted job is a failed run at trunk's head — and
 * `colab ship` reads that as "trunk not green" and refuses every landing until a human
 * intervenes. Measured: two consecutive trunk-red events on one adopting repo, the release
 * workflow being the only one on trunk still on hosted runners.
 *
 * The one job exempt is the one that publishes to npm: npm trusted publishing does not support
 * self-hosted runners, and a private repo never publishes to public npm anyway (#432).
 *
 * Pure: takes a reader, the workflow list and the visibility the caller read from the forge
 * (never a local guess). Unknown visibility → no finding (under-report, never invent).
 *
 *   jobRunners(text)   -> [{ job, runsOn, line, hosted, publishesNpm }]
 *   findings(...)      -> string[]   advisories, one per offending job
 */

const RELEASE_AUTO_RUN = /\brelease\s+(cut|finalize)\s+--auto\b/;
const HOSTED_LABEL = /^(ubuntu|windows|macos)-[\w.-]+$/i;
const NPM_PUBLISH = /(^|[\s;&|(])(npm|pnpm|bun|yarn(\s+npm)?)\s+publish\b/;

function stripComment(line) {
  return line.replace(/(^|\s)#.*$/, '');
}

function unquote(s) {
  return s.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * The labels a `runs-on:` value names, or null when it cannot be read statically
 * (an expression, a `group:` mapping, nothing at all).
 */
function labelsOf(value, following) {
  const v = stripComment(value).trim();
  if (v.includes('${{')) return null;
  if (v.startsWith('[')) {
    return v.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  }
  if (v) return [unquote(v)];
  // Block list on the following lines: `- label`.
  const out = [];
  for (const raw of following) {
    const l = stripComment(raw);
    if (!l.trim()) continue;
    const m = l.match(/^\s+-\s+(.+)$/);
    if (!m) break;
    if (m[1].includes('${{')) return null;
    out.push(unquote(m[1]));
  }
  return out.length ? out : null;
}

/** Every job's `runs-on`, by a line scan of the `jobs:` mapping (2-space job keys). */
function jobRunners(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let inJobs = false;
  let current = null;
  const flush = () => { if (current) out.push(current); current = null; };
  lines.forEach((raw, i) => {
    if (/^jobs:\s*(#.*)?$/.test(raw)) { inJobs = true; return; }
    if (!inJobs) return;
    if (/^\S/.test(raw) && !/^#/.test(raw)) { flush(); inJobs = false; return; }
    const key = raw.match(/^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/);
    if (key) { flush(); current = { job: key[1], runsOn: null, line: null, hosted: false, publishesNpm: false }; return; }
    if (!current) return;
    if (NPM_PUBLISH.test(stripComment(raw))) current.publishesNpm = true;
    const ro = raw.match(/^ {4}runs-on:(.*)$/);
    if (ro) {
      const labels = labelsOf(ro[1], lines.slice(i + 1));
      current.runsOn = labels;
      current.line = i + 1;
      current.hosted = !!(labels && labels.length && labels.every((l) => HOSTED_LABEL.test(l)));
    }
  });
  flush();
  return out;
}

/** The first statically-readable self-hosted `runs-on` in the repo's other workflows, as written. */
function selfHostedLabel(workflows, readFile, except) {
  for (const wf of workflows || []) {
    if (wf === except) continue;
    const text = readFile(`.github/workflows/${wf}`);
    if (!text) continue;
    for (const j of jobRunners(text)) {
      if (j.runsOn && j.runsOn.some((l) => l === 'self-hosted')) {
        return { wf, labels: j.runsOn };
      }
    }
  }
  return null;
}

function isPrivate(visibility) {
  const v = visibility ? String(visibility).toLowerCase() : null;
  return v === 'private' || v === 'internal';
}

function findings({ readFile, workflows, visibility }) {
  if (!isPrivate(visibility)) return [];
  const out = [];
  for (const wf of workflows || []) {
    const text = readFile(`.github/workflows/${wf}`);
    if (!text || !RELEASE_AUTO_RUN.test(text)) continue;
    const hosted = jobRunners(text).filter((j) => j.hosted && !j.publishesNpm);
    if (!hosted.length) continue;
    const own = selfHostedLabel(workflows, readFile, wf);
    const hint = own
      ? `use the label your ${own.wf} already runs on: runs-on: [${own.labels.join(', ')}]`
      : 'use your self-hosted trunk runner label';
    for (const j of hosted) {
      out.push(`${wf} job \`${j.job}\` runs on GitHub-hosted (${j.runsOn.join(', ')}, line ${j.line}) on a ${String(visibility).toLowerCase()} repo — hosted minutes are billed here, and a billing refusal fails this run at trunk's head, which turns trunk red for \`colab ship\`; ${hint} (templates/release-auto.yml, RUNNERS)`);
    }
  }
  return out;
}

module.exports = { jobRunners, selfHostedLabel, findings, isPrivate, RELEASE_AUTO_RUN };
