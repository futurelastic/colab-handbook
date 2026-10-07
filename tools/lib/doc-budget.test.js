'use strict';
/**
 * #523: the growth brake on CONVENTIONS.md and project.schema.md (scripts/check-doc-budget.mjs).
 * Proves both failure modes fire — over budget, and so far under that the budget must ratchet
 * down — and that the live repo is within its budgets. A brake nobody has seen fail is a comment.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const load = () => import(path.join(ROOT, 'scripts', 'check-doc-budget.mjs'));

function fixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-budget-'));
  fs.writeFileSync(path.join(dir, 'DOC.md'), Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  return dir;
}

test('over budget fails, naming the fix: move the rationale to an ADR', async () => {
  const { check } = await load();
  const { findings } = check({ root: fixture(120), budget: { 'DOC.md': 100 }, slack: 50 });
  assert.strictEqual(findings.length, 1);
  assert.match(findings[0], /DOC\.md is 120 lines, budget 100 — move the rationale to an ADR/);
});

test('far under budget fails too, naming the lower budget (the ratchet)', async () => {
  const { check } = await load();
  const { findings } = check({ root: fixture(30), budget: { 'DOC.md': 100 }, slack: 50 });
  assert.strictEqual(findings.length, 1);
  assert.match(findings[0], /70 under its budget 100 — lower BUDGET\["DOC\.md"\].* to 50/);
});

test('within budget and within the slack passes', async () => {
  const { check } = await load();
  assert.deepStrictEqual(check({ root: fixture(90), budget: { 'DOC.md': 100 }, slack: 50 }).findings, []);
  assert.deepStrictEqual(check({ root: fixture(100), budget: { 'DOC.md': 100 }, slack: 50 }).findings, []);
});

test('a budgeted file that is gone is a finding, not a pass', async () => {
  const { check } = await load();
  const { findings } = check({ root: fixture(1), budget: { 'GONE.md': 100 } });
  assert.match(findings[0], /GONE\.md: missing/);
});

test('this repo is within its own budgets', async () => {
  const { check, BUDGET } = await load();
  for (const [f, n] of Object.entries(BUDGET)) assert.ok(n > 0, `BUDGET["${f}"] is unset`);
  assert.deepStrictEqual(check({ root: ROOT }).findings, []);
});
