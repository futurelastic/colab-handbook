'use strict';
/**
 * Tests for the audit's `release:` block validation (audit/audit.mjs) — issue #337.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * Real descriptors through the real audit, so the parser half (the one nested map the audit's
 * narrow reader accepts) and the validation half (tools/lib/release-policy.js) are pinned
 * together. The oracle the issue names:
 *
 *   - default: no block at all → no release finding;
 *   - narrowing: `final: human` on a no-production released repo → allowed;
 *   - widening: `final: auto` on `deploy: tag` → fails.
 *
 * Plus: `candidates: auto` on `exposure: self` fails, and a nested map under any other key — or
 * a second level under `release:` — is still a parse finding.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture(projectYml, extraFiles = {}, tags = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-release-block-'));
  TMP.push(dir);
  const trunkMatch = /trunk:\s*(\S+)/.exec(projectYml);
  const trunkBranch = trunkMatch ? trunkMatch[1] : 'main';
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', trunkBranch, '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  for (const [rel, content] of Object.entries(extraFiles)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
  for (const t of tags) g('tag', t);
  return dir;
}

function audit(dir) {
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    stdout = err.stdout || '';
  }
  const r = JSON.parse(stdout).results[0];
  return {
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));
const all = (r) => [...r.fails, ...r.warns];

// This repo's own shape: released, no production, adopters install from tags.
const RELEASED_NO_PROD = 'trunk: main\nproduction: null\ndeploy: none\nstack: docs\nexposure: released\nchannels: [artifact]\n';
// Released, the tag deploys production.
const RELEASED_TAG = 'trunk: main\nproduction: https://app.example.com\ndeploy: tag\nstack: node\nexposure: released\n';
const DEPLOY_WF = { '.github/workflows/deploy-prod.yml': 'on:\n  push:\n    tags: ["v*.*.*", "!v*.*.*-*"]\njobs: {}\n' };

test('default: a descriptor with no release: block has no release finding', () => {
  const r = audit(fixture(RELEASED_NO_PROD));
  assert.ok(!hasText(all(r), /release[.:]/), all(r).join(' | '));
});

test('narrowing: final: human on a no-production released repo is allowed', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  candidates: auto   # keep\n  test-period: 5d\n  final: human\n`));
  assert.ok(!hasText(all(r), /release[.:]|nested|takes one level/), all(r).join(' | '));
});

test('widening: final: auto on deploy: tag fails', () => {
  const r = audit(fixture(`${RELEASED_TAG}release:\n  final: auto\n`, DEPLOY_WF));
  assert.ok(hasText(r.fails, /release\.final: auto widens the release route — on exposure: released/), r.fails.join(' | '));
});

test('widening: candidates: auto on exposure: self fails', () => {
  const r = audit(fixture('trunk: main\nproduction: null\ndeploy: none\nstack: node\nexposure: self\nrelease:\n  candidates: auto\n'));
  assert.ok(hasText(r.fails, /release\.candidates: auto widens the release route — on exposure: self/), r.fails.join(' | '));
});

test('widening: a test period below 3d fails', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  test-period: 2d\n`));
  assert.ok(hasText(r.fails, /release\.test-period: 2d widens/), r.fails.join(' | '));
});

test('an unknown release sub-key fails', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  major: auto\n`));
  assert.ok(hasText(r.fails, /release\.major is not a release: key/), r.fails.join(' | '));
});

test('parser: a second level under release: is a parse finding', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  final:\n    when: later\n`));
  assert.ok(hasText(r.fails, /"release:" takes one level of "key: scalar" pairs/), r.fails.join(' | '));
});

test('parser: a list under release: is a parse finding', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  - auto\n`));
  assert.ok(hasText(r.fails, /nested\/indented YAML is not supported|takes one level/), r.fails.join(' | '));
});

test('parser: a nested map under any other key is still a parse finding', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}autonomy:\n  mode: auto-trunk\n`));
  assert.ok(hasText(r.fails, /nested\/indented YAML is not supported by this reader/), r.fails.join(' | '));
});

test('parser: a key after the block is read as a top-level key again', () => {
  const r = audit(fixture(`trunk: main\nproduction: null\ndeploy: none\nrelease:\n  final: human\nstack: docs\nexposure: released\nchannels: [artifact]\n`));
  assert.ok(!hasText(r.fails, /missing key|nested|takes one level|release[.:]/), r.fails.join(' | '));
});

// ---- #441: an operator-granted automatic final on deploy-tag -------------------------------------

/** A fake `gh` answering only `issue view <num> --repo an-owner/a-repo …` with `record` (null = fail). */
function fakeGhIssue(num, record) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-release-grant-bin-'));
  TMP.push(dir);
  const payload = path.join(dir, 'issue.json');
  if (record) fs.writeFileSync(payload, JSON.stringify(record));
  fs.writeFileSync(path.join(dir, 'gh'), [
    '#!/bin/sh',
    `if [ "$1" = "issue" ] && [ "$2" = "view" ] && [ "$3" = "${num}" ]; then`,
    record ? `  cat "${payload}"; exit 0` : '  exit 1',
    'fi',
    'exit 1',
  ].join('\n'), { mode: 0o755 });
  return dir;
}

function auditWithGh(dir, ghDir) {
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/an-owner/a-repo.git'], { cwd: dir });
  let stdout;
  try {
    stdout = execFileSync('node', [AUDIT, '--json', '--local', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PATH: `${ghDir}:${process.env.PATH}` } });
  } catch (err) { stdout = err.stdout || ''; }
  const r = JSON.parse(stdout).results[0];
  return { fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text), warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text) };
}

const DECISION = { body: '⚖ Decision recorded — ruled-by `Operator` · answers `-` · host `box` · 2026-10-02T00:00:00Z', createdAt: '2026-10-02T00:00:00Z', authorAssociation: 'OWNER', author: { login: 'op' } };
const REOPEN = { body: '↩ Decision reopened — ruled-by `Operator` · host `box` · 2026-10-03T00:00:00Z — every decision on this issue up to this point is superseded.', createdAt: '2026-10-03T00:00:00Z', authorAssociation: 'OWNER', author: { login: 'op' } };
const GRANTED = `${RELEASED_TAG}release:\n  final: auto\n  final-grant: 7\n`;

test('#441: final: auto on deploy-tag with a recorded grant passes the audit', () => {
  const r = auditWithGh(fixture(GRANTED, DEPLOY_WF), fakeGhIssue(7, { state: 'CLOSED', labels: [{ name: 'decision-recorded' }], comments: [DECISION] }));
  assert.ok(!hasText(r.fails, /release\./), r.fails.join(' | '));
});

test('#441 (d): a grant whose decision was reopened fails the audit', () => {
  const r = auditWithGh(fixture(GRANTED, DEPLOY_WF), fakeGhIssue(7, { state: 'OPEN', labels: [{ name: 'decision-recorded' }], comments: [DECISION, REOPEN] }));
  assert.ok(hasText(r.fails, /release\.final: auto on deploy-tag has no resolvable operator grant — release\.final-grant #7 does not grant an automatic final: its decision was reopened/), r.fails.join(' | '));
});

test('#441: an unreadable grant fails closed', () => {
  const r = auditWithGh(fixture(GRANTED, DEPLOY_WF), fakeGhIssue(7, null));
  assert.ok(hasText(r.fails, /no resolvable operator grant — release\.final-grant #7 could not be read/), r.fails.join(' | '));
});

test('#441: final: auto on deploy-tag with no grant line still fails as a widening', () => {
  const r = audit(fixture(`${RELEASED_TAG}release:\n  final: auto\n`, DEPLOY_WF));
  assert.ok(hasText(r.fails, /release\.final: auto widens the release route.*release\.final-grant: <N>/), r.fails.join(' | '));
});

test('#439: an unquoted whole number under release: is a number — candidates-per-day: 1 passes, as colab release cut reads it', () => {
  const r = audit(fixture(`${RELEASED_NO_PROD}release:\n  candidates-per-day: 1\n`));
  assert.ok(!hasText(all(r), /release[.:]/), all(r).join(' | '));
  const quoted = audit(fixture(`${RELEASED_NO_PROD}release:\n  candidates-per-day: "1"\n`));
  assert.ok(hasText(quoted.fails, /release\.candidates-per-day is "1", expected a positive whole number/), quoted.fails.join(' | '));
  // #443: no route derives a cap, so a declared 4 is a narrowing like any other — no finding.
  const four = audit(fixture(`${RELEASED_NO_PROD}release:\n  candidates-per-day: 4\n`));
  assert.ok(!hasText(all(four), /release[.:]/), all(four).join(' | '));
});

// ---- #446: route deploy-tag-fast ------------------------------------------------------------------

const FAST = `${RELEASED_TAG}release:\n  route: deploy-tag-fast\n  final-grant: 7\n  health-url: https://app.example.com/health\n  rollback: auto\n`;
const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'release-auto.yml'), 'utf8');
const EDITED = TEMPLATE.replace(/echo "::error::the deploy step of release-auto\.yml was never edited[^\n]*\n\s*exit 1/, './scripts/deploy.sh "$TAG"');
const RECORDED = { state: 'CLOSED', labels: [{ name: 'decision-recorded' }], comments: [DECISION] };
const fastFiles = (wf) => ({ ...DEPLOY_WF, ...(wf ? { '.github/workflows/release-auto.yml': wf } : {}) });

test('#446: a granted, health-gated deploy-tag-fast with an edited same-run deploy passes', () => {
  assert.notStrictEqual(EDITED, TEMPLATE, 'the placeholder deploy step was not found in the template');
  const r = auditWithGh(fixture(FAST, fastFiles(EDITED)), fakeGhIssue(7, RECORDED));
  assert.ok(!hasText(r.fails, /release\.|deploy-tag-fast/), r.fails.join(' | '));
});

test('#446: a reopened or unreadable grant fails, named for the route', () => {
  const reopened = auditWithGh(fixture(FAST, fastFiles(EDITED)), fakeGhIssue(7, { ...RECORDED, state: 'OPEN', comments: [DECISION, REOPEN] }));
  assert.ok(hasText(reopened.fails, /route: deploy-tag-fast has no resolvable operator grant — release\.final-grant #7 does not grant an automatic final: its decision was reopened/), reopened.fails.join(' | '));
  const unread = auditWithGh(fixture(FAST, fastFiles(EDITED)), fakeGhIssue(7, null));
  assert.ok(hasText(unread.fails, /route: deploy-tag-fast has no resolvable operator grant — release\.final-grant #7 could not be read/), unread.fails.join(' | '));
});

test('#446: no health-url, or deploy: manual, fails', () => {
  const noHealth = audit(fixture(FAST.replace(/  health-url: [^\n]+\n/, ''), fastFiles(EDITED)));
  assert.ok(hasText(noHealth.fails, /release\.route: deploy-tag-fast needs .*release\.health-url/), noHealth.fails.join(' | '));
  const manual = audit(fixture(FAST.replace('deploy: tag', 'deploy: manual\nrunbook: docs/deploy.md'), { ...fastFiles(EDITED), 'docs/deploy.md': 'x\n' }));
  assert.ok(hasText(manual.fails, /release\.route: deploy-tag-fast does not fit/), manual.fails.join(' | '));
});

test('#446: a release workflow that deploys nothing, an unedited deploy step, or no release workflow at all — each fails', () => {
  const noDeploy = TEMPLATE.slice(0, TEMPLATE.indexOf('\n  # ---------------------------------------------------------------------------------------------\n  # deploy (#446)'))
    .replace(/deploy-tag: \$\{\{ steps\.cut\.outputs\.final \}\}/, '').replace(/echo "final=\$TAG"[^\n]*\n/, '').replace(/jq -r '\.final \/\/ false'/, 'jq -r \'.x\'');
  const r1 = auditWithGh(fixture(FAST, fastFiles(noDeploy)), fakeGhIssue(7, RECORDED));
  assert.ok(hasText(r1.fails, /deploys nothing from its result — a tag pushed with GITHUB_TOKEN starts no `push: tags` run/), r1.fails.join(' | '));
  const r2 = auditWithGh(fixture(FAST, fastFiles(TEMPLATE)), fakeGhIssue(7, RECORDED));
  assert.ok(hasText(r2.fails, /deploy step is still the template's unedited placeholder/), r2.fails.join(' | '));
  const r3 = auditWithGh(fixture(FAST, fastFiles(null)), fakeGhIssue(7, RECORDED));
  assert.ok(hasText(r3.fails, /no workflow runs `colab release cut --auto`/), r3.fails.join(' | '));
});

test('#446: the candidates-off advisory is not raised on the fast route', () => {
  const r = auditWithGh(fixture(FAST, fastFiles(EDITED)), fakeGhIssue(7, RECORDED));
  const warns = all(r).filter((t) => /leaves candidates off/.test(t));
  assert.deepStrictEqual(warns, []);
});

// ---- #452: health-url is shared with deploy-tag; the container deploy is one path -----------------

const CONTAINER = fs.readFileSync(path.join(__dirname, '..', '..', 'templates', 'deploy-container.yml'), 'utf8');
/** release-auto.yml with its placeholder `deploy` job swapped for the commented deploy-container one. */
function withContainerJob(text) {
  const start = text.indexOf('\n  # ---------------------------------------------------------------------------------------------\n  # deploy (#446)');
  const alt = text.indexOf('\n  # deploy:\n');
  assert.ok(start > 0 && alt > start, 'the deploy job or its commented alternative was not found');
  const job = text.slice(alt + 1).split('\n').filter((l) => l.startsWith('  # ')).map((l) => `  ${l.slice(4)}`).join('\n');
  return `${text.slice(0, start)}\n${job}\n`;
}

test('#452: health-url on route deploy-tag passes; on a route nothing deploys from it fails', () => {
  const ok = audit(fixture(`${RELEASED_TAG}release:\n  health-url: https://app.example.com/version\n`, DEPLOY_WF));
  assert.ok(!hasText(ok.fails, /release\./), ok.fails.join(' | '));
  const bad = audit(fixture(`${RELEASED_NO_PROD}release:\n  health-url: https://app.example.com/version\n`));
  assert.ok(hasText(bad.fails, /release\.health-url fits only route deploy-tag or deploy-tag-fast/), bad.fails.join(' | '));
});

test('#452: the fast route reaching deploy-container.yml through the commented job passes', () => {
  const wf = withContainerJob(TEMPLATE);
  assert.match(wf, /\n {2}deploy:\n[\s\S]*uses: \.\/\.github\/workflows\/deploy-container\.yml/);
  assert.doesNotMatch(wf, /was never edited/);
  const files = { ...fastFiles(wf), '.github/workflows/deploy-container.yml': CONTAINER };
  const r = auditWithGh(fixture(FAST, files), fakeGhIssue(7, RECORDED));
  assert.ok(!hasText(r.fails, /release\.|deploy-tag-fast/), r.fails.join(' | '));
  assert.ok(!hasText(r.warns, /deploy-container-run, but release\.health-url/), r.warns.join(' | '));
});

test('#452: a deploy-container copy with no release.health-url is an advisory', () => {
  const r = audit(fixture(RELEASED_TAG, { '.github/workflows/deploy-container.yml': CONTAINER }));
  assert.ok(hasText(r.warns, /deploy-container\.yml deploys through deploy-container-run, but release\.health-url is not declared/), r.warns.join(' | '));
  const declared = audit(fixture(`${RELEASED_TAG}release:\n  health-url: https://app.example.com/version\n`, { '.github/workflows/deploy-container.yml': CONTAINER }));
  assert.ok(!hasText(all(declared), /deploy-container-run, but release\.health-url/), all(declared).join(' | '));
});
