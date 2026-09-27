'use strict';
/**
 * The CI templates' trigger + concurrency block (#384).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * actionlint checks the block's schema; it cannot check what the block MEANS. These tests read
 * each template's `on:` through the same parser the audit and `colab ship --batch` use
 * (workflow-triggers.js), and evaluate its `cancel-in-progress` expression for the refs that
 * matter, so the three copies cannot drift apart or quietly lose the property the issue is about:
 *
 *   - a push to ANY branch runs CI — a session's branch gets a run of its own before the merge,
 *     and `ship-batch/**` (the batch-landing opt-in) is covered without a separate entry;
 *   - a tag push does NOT (a branches-only filter never fires on tags — unchanged from before);
 *   - a superseded run on the same branch is cancelled, a TRUNK run never is: every trunk sha
 *     keeps a completed run of its own, which is what the merge gate reads (#92).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseWorkflowOn, workflowFiresOnBranchPush, workflowFiresOnTag } = require('./workflow-triggers.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATES = ['ci-node.yml', 'ci-laravel.yml', 'ci-python.yml'];
const read = (f) => fs.readFileSync(path.join(REPO_ROOT, 'templates', f), 'utf8');

// The top-level `concurrency:` block, as { group, cancel } strings (no YAML dependency here).
function concurrencyOf(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /^concurrency\s*:/.test(l));
  if (at === -1) return null;
  const out = {};
  for (let i = at + 1; i < lines.length && /^\s/.test(lines[i]); i++) {
    const m = lines[i].match(/^\s+(group|cancel-in-progress)\s*:\s*(.*)$/);
    if (m) out[m[1] === 'group' ? 'group' : 'cancel'] = m[2].trim();
  }
  return out;
}

// Evaluate the one expression shape the templates use: `${{ github.ref != '<r>' && … }}`.
// Anything else throws — a reshaped expression must be re-pinned here deliberately, not
// silently read as "true".
function evalCancel(expr, ref) {
  const m = expr.match(/^\$\{\{\s*(.*?)\s*\}\}$/);
  if (!m) throw new Error(`not an expression: ${expr}`);
  const terms = m[1].split(/\s*&&\s*/);
  const protectedRefs = terms.map((t) => {
    const tm = t.match(/^github\.ref\s*!=\s*'([^']+)'$/);
    if (!tm) throw new Error(`unexpected term in cancel-in-progress: ${t}`);
    return tm[1];
  });
  return { value: protectedRefs.every((r) => r !== ref), protectedRefs };
}

for (const file of TEMPLATES) {
  const text = read(file);

  test(`${file}: push fires on every branch, trunk and session branches alike (#384)`, () => {
    const on = parseWorkflowOn(text);
    assert.ok(on.found && on.events.has('push'), 'push trigger present');
    assert.deepStrictEqual(on.pushBranches, ['**']);
    for (const branch of ['main', 'dev', 'feat/onboard-redesign-23', 'ada/box-a/fix/import-fixes-115-114',
      'ship-batch/abc1234']) {
      assert.ok(workflowFiresOnBranchPush(on, branch), `fires on a push to ${branch}`);
    }
  });

  test(`${file}: a tag push does not run CI (branches-only filter)`, () => {
    const on = parseWorkflowOn(text);
    assert.strictEqual(workflowFiresOnTag(on, 'v1.2.0'), false);
    assert.strictEqual(workflowFiresOnTag(on, 'v1.2.0-rc.1'), false);
  });

  test(`${file}: pull_request still targets the trunk/release branches only`, () => {
    const on = parseWorkflowOn(text);
    assert.ok(on.events.has('pull_request'));
    assert.deepStrictEqual(on.prBranches, ['main', 'dev']);
  });

  test(`${file}: superseded branch runs are cancelled, trunk runs never are`, () => {
    const c = concurrencyOf(text);
    assert.ok(c, 'top-level concurrency block present');
    assert.strictEqual(c.group, 'ci-${{ github.ref }}', 'grouped per ref, so only the same branch supersedes');
    const { protectedRefs } = evalCancel(c.cancel, 'refs/heads/main');
    assert.deepStrictEqual(protectedRefs.sort(), ['refs/heads/dev', 'refs/heads/main']);
    assert.strictEqual(evalCancel(c.cancel, 'refs/heads/main').value, false, 'main never cancelled');
    assert.strictEqual(evalCancel(c.cancel, 'refs/heads/dev').value, false, 'dev never cancelled');
    assert.strictEqual(evalCancel(c.cancel, 'refs/heads/feat/x-384').value, true, 'a session branch is');
    assert.strictEqual(evalCancel(c.cancel, 'refs/heads/ship-batch/abc1234').value, true,
      'a force-replaced batch ref supersedes its own earlier run');
    assert.strictEqual(evalCancel(c.cancel, 'refs/pull/7/merge').value, true, 'a PR merge ref is');
  });
}

test('the three templates carry one identical trigger + concurrency block', () => {
  const block = (t) => {
    const lines = t.split(/\r?\n/);
    const from = lines.findIndex((l) => /^on\s*:/.test(l));
    const to = lines.findIndex((l, i) => i > from && /^env\s*:/.test(l));
    return lines.slice(from, to).join('\n');
  };
  const [first, ...rest] = TEMPLATES.map((f) => block(read(f)));
  for (const [i, b] of rest.entries()) assert.strictEqual(b, first, `${TEMPLATES[i + 1]} drifted from ${TEMPLATES[0]}`);
});
