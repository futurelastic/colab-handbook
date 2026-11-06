'use strict';
/**
 * #681: templates/forgejo-release-auto.yml — the Forgejo dialect of the release workflow. Pins what
 * makes it a Forgejo workflow (no workflow_run, no permissions blocks, full-URL uses, runner label
 * from a variable, no step summary, no jq/gh) and runs its verdict reader for real: a missing verdict
 * fails the step, a refusal stays green with a warning, a cut says so.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FILE = path.join(__dirname, '..', '..', 'templates', 'forgejo-release-auto.yml');
const TEXT = fs.readFileSync(FILE, 'utf8');
/** The workflow's own lines — every comment line dropped (the header documents GitHub's shape). */
const CODE = TEXT.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('#681 the Forgejo dialect: no workflow_run, no permissions:, no step summary, no jq or gh', () => {
  assert.doesNotMatch(CODE, /workflow_run/);
  assert.doesNotMatch(CODE, /^\s*permissions\s*:/m);
  assert.doesNotMatch(CODE, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(CODE, /\bjq\b/);
  assert.doesNotMatch(CODE, /(^|[\s;(])gh\s/m);
  assert.match(CODE, /^on:\n {2}workflow_dispatch:\n {4}inputs:\n {6}source:/m);
  assert.match(CODE, /^\s+sha:\n/m, 'the CI dispatch passes the sha it tested');
});

test('#681 every uses: is a full URL, and the runner label comes from an Actions variable', () => {
  const uses = CODE.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
  assert.ok(uses.length >= 1);
  for (const l of uses) assert.match(l, /uses:\s+https:\/\//, l);
  const runsOn = CODE.split('\n').filter((l) => /^\s*runs-on:/.test(l));
  assert.ok(runsOn.length >= 1);
  for (const l of runsOn) assert.match(l, /\$\{\{\s*vars\.RELEASE_RUNNER/, l);
});

test('#681 name: equals the file base name it is copied to — the CLI drops its own statuses by that name', () => {
  const dest = /Copy me into your repo at\s*\n#\s*(\S+)\./.exec(TEXT);
  assert.ok(dest, 'the header names the destination');
  const base = path.basename(dest[1]).replace(/\.ya?ml$/, '');
  assert.match(CODE, new RegExp(`^name: ${base}$`, 'm'));
  assert.strictEqual(dest[1], '.forgejo/workflows/release-auto.yml');
  // The dispatch URL documented for the CI job names the same file.
  assert.match(TEXT, /actions\/workflows\/release-auto\.yml\/dispatches/);
});

test('#681 the cut runs only after ci-wait said green, and a ci-wait with no verdict fails the job', () => {
  assert.match(CODE, /node "\$COLAB" ci-wait --sha "\$SHA"/);
  assert.match(CODE, /if: steps\.wait\.outputs\.cut == 'true'/);
  assert.match(CODE, /\*\) echo "::error::colab ci-wait gave no verdict \(exit \$rc\)[^\n]*"; exit 1 ;;/);
  assert.match(CODE, /release cut --auto --sha "\$SHA" \$DRY --json/);
  assert.doesNotMatch(CODE, /release finalize/, 'the final is a human act on a forge');
});

/** The cut step's verdict reader: the node program between `node -e '` and `' "$OUT" "$rc"`. */
function verdictReader() {
  // The cut step's is the LAST `node -e '` program (the config writer comes first; the header's
  // commented dispatch example is not in CODE at all).
  const last = CODE.split("node -e '\n").pop();
  const m = /^([\s\S]*?)\n\s*' "\$OUT" "\$rc"/.exec(last);
  assert.ok(m, 'the cut step reads its verdict with node');
  return m[1];
}

function read(verdict, { dry = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forgejo-release-template-'));
  try {
    const out = path.join(dir, 'cut.json');
    if (verdict !== undefined) fs.writeFileSync(out, typeof verdict === 'string' ? verdict : JSON.stringify(verdict));
    return spawnSync(process.execPath, ['-e', verdictReader(), out, '1'], { encoding: 'utf8', env: { ...process.env, DRY_RUN: dry ? 'true' : 'false' } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('#681 the verdict reader: no verdict (missing, not JSON, no ok) fails the step — never "no candidate cut"', () => {
  for (const v of [undefined, 'Error: git fetch failed\n', '{"tag":"v1.0.0-rc.1"}']) {
    const r = read(v);
    assert.strictEqual(r.status, 1, `${JSON.stringify(v)} → ${r.stdout}`);
    assert.match(r.stdout, /::error::colab release cut produced no verdict \(exit 1\)/);
  }
});

test('#681 the verdict reader: a refusal is a warning and exits 0; a standing one is a stall error, still 0', () => {
  const checks = [{ condition: 'ci-green', ok: false, detail: 'run for main@abc: status=completed conclusion=failure' }, { condition: 'manifest', ok: true, detail: 'ok' }];
  const r = read({ ok: false, noop: false, created: false, sha: 'abc', checks, standing: [] });
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /::warning::colab release cut refused: ci-green — run for main@abc: status=completed conclusion=failure/);
  assert.match(r.stdout, /✗ ci-green/);
  const s = read({ ok: false, created: false, sha: 'abc', checks, standing: ['ci-green'] });
  assert.strictEqual(s.status, 0);
  assert.match(s.stdout, /::error title=Release stalled::/);
});

test('#681 the verdict reader: a cut says so and surfaces a failed publish as a warning; a dry run names what it would cut', () => {
  const c = read({ ok: true, created: true, tag: 'v1.1.0-rc.1', sha: 'abc', checks: [], published: { ok: false, detail: 'pre-release NOT published: HTTP 403' } });
  assert.strictEqual(c.status, 0);
  assert.match(c.stdout, /Cut v1\.1\.0-rc\.1 and pushed it\./);
  assert.match(c.stdout, /::warning::pre-release NOT published: HTTP 403/);
  const d = read({ ok: true, created: false, tag: 'v1.1.0-rc.1', sha: 'abc', checks: [] }, { dry: true });
  assert.match(d.stdout, /Dry run — would cut: v1\.1\.0-rc\.1/);
  const n = read({ ok: true, noop: true, created: false, sha: 'abc', checks: [] });
  assert.match(n.stdout, /No-op/);
});
