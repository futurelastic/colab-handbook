'use strict';
/**
 * templates/release-auto.yml on a `trunk: dev` + `deploy: tag` repo (#429) — the template TEXT.
 *
 * The decision (cut only on a promotion head, bump from the promoted commits, manifest read on main)
 * is the CLI's and is tested end to end in release-cut-cli.test.js. What is pinned here is that the
 * template carries no second copy of it: one file, unchanged, serves both trunk shapes — triggered
 * by CI on main only, checking out main, and leaving "is this a promotion" to `release cut --auto`.
 * Kept apart from release-auto-template.test.js (#425's) so the two can move independently.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const stamp = require('./stamp.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEXT = fs.readFileSync(path.join(REPO_ROOT, 'templates', 'release-auto.yml'), 'utf8');
const CODE = TEXT.split('\n').filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#.*$/, '')).join('\n');

/** The indented block under `key:` (up to the next line at the same or lower indent). */
function block(text, key) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^(\\s*)${key}:\\s*$`).test(l));
  assert.ok(i >= 0, `no ${key}: block`);
  const indent = /^(\s*)/.exec(lines[i])[1].length;
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() && /^(\s*)/.exec(l)[1].length <= indent) break;
    out.push(l);
  }
  return out.join('\n');
}

test('the trigger is CI on main only — on trunk: dev that is the promotion\'s push, never dev', () => {
  const wr = block(CODE, 'workflow_run');
  assert.match(wr, /workflows:\s*\[/);
  assert.match(wr, /types:\s*\[completed\]/);
  assert.match(wr, /branches:\s*\[main\]/);
  assert.doesNotMatch(wr, /\bdev\b/);
});

test('the header says the template fits trunk: dev + deploy: tag', () => {
  assert.match(TEXT, /`trunk: dev`\s+\+ `deploy: tag`/);
  assert.match(TEXT, /main's head IS a promotion of dev/);
  assert.doesNotMatch(TEXT, /does not fit\s*\n?#?\s*a `trunk: dev` repo/);
});

test('the cut step checks out main and leaves the promotion decision to the CLI', () => {
  // main on every real run; the dispatched ref only on a #474 dry run.
  assert.match(CODE, /ref: \$\{\{ env\.DRY_RUN == 'true' && github\.sha \|\| 'main' \}\}\n/);
  assert.match(CODE, /fetch-depth: 0/);
  assert.match(CODE, /node "\$COLAB" release cut --auto \$\{DRY\[@\]\+"\$\{DRY\[@\]\}"\} --json/);
  // No trunk-shape condition in YAML: the CLI reads project.yml's trunk:, the file does not.
  assert.doesNotMatch(CODE, /if:.*\b(trunk|dev|head_branch|head_commit)\b/);
  assert.doesNotMatch(CODE, /\btrunk\b/);
});

test('the fingerprints still attribute the template to release-auto', () => {
  const prov = stamp.workflowProvenance(TEXT, 'release-auto', new Set(['release-auto', 'release-tag']));
  assert.strictEqual(prov.template, 'release-auto');
});
