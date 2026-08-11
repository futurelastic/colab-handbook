'use strict';
/**
 * Agreement test between `tools/lib/adopt.js`'s `EXPOSURE_SHAPE` (the CONSTRUCTOR half: given a
 * repo's shape, does it support DECLARING a given exposure value?) and `audit/audit.mjs`'s real
 * exposure contract block (the VALIDATOR half, ~audit/audit.mjs:1321-1396) — the thing that keeps
 * the two from drifting apart, since #199's plan is explicit that `EXPOSURE_SHAPE` is a
 * DELIBERATELY SEPARATE table, not a re-key of the audit's own ~130-line block (that block's
 * byte-identical behaviour was #144's own oracle, hours old when #199 landed).
 *
 * Each case builds a real, otherwise-clean git fixture (so the ONLY thing that can produce a
 * `fail` finding is the exposure contract itself), runs the real `audit/audit.mjs --local --json`
 * against it, and asserts `EXPOSURE_SHAPE`'s verdict for the identical shape agrees with the
 * audit's `ok`.
 *
 * If a future case here disagrees and the fix would require editing `audit.mjs`'s finding
 * strings, STOP — #199's plan is explicit that this is its own unit, not a same-session fix.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { exposureShapeVerdict } = require('./adopt.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

/**
 * An otherwise-clean local git fixture: exposure declared (never tier, to isolate the
 * exposure-voiced half of the contract — #144's decomposition), `trunk`/`production`/`deploy`/
 * `stack` all present (audit's required-key list), one branch (named `trunk`, so both "declared
 * trunk exists" and "checkout is on trunk" are trivially satisfied), and — when `hasWorkflow` —
 * a `deploy-*.yml` in `.github/workflows/` (excluded from CI-gate detection by filename, so it
 * cannot itself produce an unrelated `fail`).
 */
function buildFixture({ trunk, production, deploy, exposure, hasWorkflow, hasRunbook }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-agree-'));
  TMP.push(root);
  execFileSync('git', ['init', '-q', '-b', trunk, root], { encoding: 'utf8' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'agreement test'], { cwd: root, encoding: 'utf8' });
  // #108: neutralise the developer's real global hooks — never inherit ambient machine state.
  execFileSync('git', ['config', 'core.hooksPath', path.join(root, '.nohooks')], { cwd: root, encoding: 'utf8' });

  const prodLine = production === null || production === undefined ? 'production: null' : `production: ${production}`;
  const deployLine = deploy === null || deploy === undefined ? 'deploy: null' : `deploy: ${deploy}`;
  const lines = [`trunk: ${trunk}`, prodLine, deployLine, 'stack: docs', `exposure: ${exposure}`];
  if (hasRunbook) lines.push('runbook: docs/deploy.md');
  const yml = `${lines.join('\n')}\n`;
  fs.mkdirSync(path.join(root, '.github'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'project.yml'), yml);
  if (hasRunbook) {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'deploy.md'), '# deploy runbook\n');
  }

  if (hasWorkflow) {
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.github', 'workflows', 'deploy-prod.yml'),
      `on:\n  push:\n    branches: [${trunk}]\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps: []\n`,
    );
  }

  execFileSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8' });
  execFileSync('git', ['commit', '-q', '-m', 'chore: fixture'], { cwd: root, encoding: 'utf8' });
  return root;
}

function auditOk(root) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('node', [AUDIT, '--local', root, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(r.stdout || '{}');
  const result = (parsed.results && parsed.results[0]) || null;
  return { ok: !!(result && result.ok), findings: (result && result.findings) || [] };
}

// { exposure, trunk, production, deploy, hasWorkflow } — the matrix #199's plan asks for.
const CASES = [
  // self — no mechanism rule at all; every combination must read ok on both sides.
  { exposure: 'self', trunk: 'main', production: null, deploy: 'none', hasWorkflow: false },
  { exposure: 'self', trunk: 'dev', production: 'https://example.com', deploy: 'push-main', hasWorkflow: true },
  { exposure: 'self', trunk: 'main', production: 'https://example.com', deploy: 'tag', hasWorkflow: false },

  // none — trunk main, no deploy workflow.
  { exposure: 'none', trunk: 'main', production: null, deploy: 'none', hasWorkflow: false },
  { exposure: 'none', trunk: 'main', production: null, deploy: 'none', hasWorkflow: true },
  { exposure: 'none', trunk: 'dev', production: null, deploy: 'none', hasWorkflow: false },

  // live — trunk dev, production set, deploy push-main, a deploy workflow: all four required.
  { exposure: 'live', trunk: 'dev', production: 'https://example.com', deploy: 'push-main', hasWorkflow: true },
  { exposure: 'live', trunk: 'main', production: 'https://example.com', deploy: 'push-main', hasWorkflow: true },
  { exposure: 'live', trunk: 'dev', production: null, deploy: 'push-main', hasWorkflow: true },
  { exposure: 'live', trunk: 'dev', production: 'https://example.com', deploy: 'tag', hasWorkflow: true },
  { exposure: 'live', trunk: 'dev', production: 'https://example.com', deploy: 'push-main', hasWorkflow: false },

  // released, no production — trunk main, deploy none/null.
  { exposure: 'released', trunk: 'main', production: null, deploy: 'none', hasWorkflow: false },
  { exposure: 'released', trunk: 'main', production: null, deploy: null, hasWorkflow: false },
  { exposure: 'released', trunk: 'dev', production: null, deploy: 'none', hasWorkflow: false },
  { exposure: 'released', trunk: 'main', production: null, deploy: 'push-main', hasWorkflow: false },

  // released, with production — deploy tag|manual, trunk dev (or main when deploy: tag).
  { exposure: 'released', trunk: 'dev', production: 'https://example.com', deploy: 'tag', hasWorkflow: true },
  // deploy: manual has no committed CI path at all — needs a runbook: (checkRunbook, mirrored).
  { exposure: 'released', trunk: 'dev', production: 'https://example.com', deploy: 'manual', hasWorkflow: false, hasRunbook: false },
  { exposure: 'released', trunk: 'dev', production: 'https://example.com', deploy: 'manual', hasWorkflow: false, hasRunbook: true },
  // deploy: tag with NO committed workflow is the "external GitOps poller" shape — also needs a runbook.
  { exposure: 'released', trunk: 'dev', production: 'https://example.com', deploy: 'tag', hasWorkflow: false, hasRunbook: false },
  { exposure: 'released', trunk: 'dev', production: 'https://example.com', deploy: 'tag', hasWorkflow: false, hasRunbook: true },
  { exposure: 'released', trunk: 'main', production: 'https://example.com', deploy: 'tag', hasWorkflow: true },
  { exposure: 'released', trunk: 'main', production: 'https://example.com', deploy: 'manual', hasWorkflow: false, hasRunbook: true },
  { exposure: 'released', trunk: 'dev', production: 'https://example.com', deploy: 'push-main', hasWorkflow: true },
  { exposure: 'released', trunk: 'dev', production: 'https://example.com', deploy: 'none', hasWorkflow: false },
];

for (const c of CASES) {
  const label = `${c.exposure} / trunk:${c.trunk} / production:${c.production === null ? 'null' : 'set'} / deploy:${c.deploy ?? 'null'} / workflow:${c.hasWorkflow}${c.hasRunbook !== undefined ? ` / runbook:${c.hasRunbook}` : ''}`;
  test(`agreement — ${label}`, () => {
    const root = buildFixture(c);
    const adoptVerdict = exposureShapeVerdict(c.exposure, {
      trunk: c.trunk,
      hasProduction: c.production !== null && c.production !== undefined && c.production !== '',
      deploy: c.deploy,
      hasDeployWorkflow: c.hasWorkflow,
      hasRunbook: !!c.hasRunbook,
    });
    const audit = auditOk(root);
    assert.strictEqual(
      adoptVerdict.ok,
      audit.ok,
      `adopt says ok=${adoptVerdict.ok}${adoptVerdict.ok ? '' : ` (${adoptVerdict.reason})`}, audit says ok=${audit.ok} `
      + `(${audit.findings.filter((f) => f.level === 'fail').map((f) => f.text).join(' | ')})`,
    );
  });
}
