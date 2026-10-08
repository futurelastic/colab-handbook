'use strict';
/**
 * #523: scripts/check-rule-inventory.mjs — every rule of the normative documents is still where
 * docs/rule-inventory.md says, and every hard rule carries its marker and names a gate that
 * exists. #174 is why this is mechanical: the last compaction turned an obligation into an
 * option and only a later grade noticed.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const load = () => import(path.join(ROOT, 'scripts', 'check-rule-inventory.mjs'));

const HEAD = '| id | class | gate | rule | key | dest | source |\n|---|---|---|---|---|---|---|\n';

function repo({ conventions, inventoryRows, gateFile = 'function shipAutonomyGate() {}\n' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-inventory-'));
  fs.mkdirSync(path.join(dir, 'docs', 'adr'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CONVENTIONS.md'), conventions);
  fs.writeFileSync(path.join(dir, 'project.schema.md'), '# schema\n');
  fs.writeFileSync(path.join(dir, 'tools', 'colab'), gateFile);
  fs.writeFileSync(path.join(dir, 'docs', 'adr', '9-why-rationale.md'), '# why\n\nWe measured twelve stale claims in a week.\n');
  fs.writeFileSync(path.join(dir, 'docs', 'rule-inventory.md'), `# inv\n\n${HEAD}${inventoryRows.join('\n')}\n`);
  return dir;
}

const CONV = [
  '# C',
  '',
  '**[Hard — gate: colab ship]** A human must trigger the trunk merge on a manual repo.',
  '',
  '- Claim the issue before you start, never when finishing.',
  '',
  '| field | meaning |',
  '|---|---|',
  '| `a\\|b` | either the pipe-joined pair |',
  '',
].join('\n');

const GOOD = [
  '| C.ship.01 | hard | `tools/colab::function shipAutonomyGate` | Wait for a human go. | A human must trigger the trunk merge | CONVENTIONS.md | #1 |',
  '| C.claim.01 | default | | Claim first. | Claim the issue before you start | CONVENTIONS.md | — |',
  '| C.tbl.01 | default | | Read the pair. | `a\\|b` \\| either the pipe-joined pair | CONVENTIONS.md | — |',
  '| C.why.01 | explanation | | Why claims matter. | twelve stale claims in a week | docs/adr/9-why-rationale.md | #9 |',
];

test('a consistent inventory passes, escaped pipes included', async () => {
  const { check } = await load();
  const res = check({ root: repo({ conventions: CONV, inventoryRows: GOOD }) });
  assert.deepStrictEqual(res.findings, []);
  assert.strictEqual(res.rows.length, 4);
});

test('a reworded rule is a finding naming the row (the #174 loss)', async () => {
  const { check } = await load();
  const conv = CONV.replace('Claim the issue before you start', 'You may claim the issue before you start');
  const { findings } = check({ root: repo({ conventions: conv, inventoryRows: GOOD }) });
  assert.strictEqual(findings.length, 1);
  assert.match(findings[0], /row C\.claim\.01 .*key not found in CONVENTIONS\.md/);
});

test('a hard rule without its marker is a finding', async () => {
  const { check } = await load();
  const conv = CONV.replace('**[Hard — gate: colab ship]** ', '');
  const { findings } = check({ root: repo({ conventions: conv, inventoryRows: GOOD }) });
  assert.ok(findings.some((f) => /row C\.ship\.01 .*carries no \*\*\[Hard — gate/.test(f)), findings.join('\n'));
});

test('a marker no row accounts for is a finding', async () => {
  const { check } = await load();
  const conv = CONV.replace('- Claim the issue', '- **[Hard — gate: claim]** Claim the issue');
  const { findings } = check({ root: repo({ conventions: conv, inventoryRows: GOOD }) });
  assert.ok(findings.some((f) => /CONVENTIONS\.md:5: a Hard marker no inventory row accounts for/.test(f)), findings.join('\n'));
});

test('a gate literal the gate file no longer holds is a finding', async () => {
  const { check } = await load();
  const { findings } = check({ root: repo({ conventions: CONV, inventoryRows: GOOD, gateFile: 'nothing here\n' }) });
  assert.ok(findings.some((f) => /row C\.ship\.01 .*gate literal not found in tools\/colab/.test(f)), findings.join('\n'));
});

test('a rule may not move to an ADR — only an explanation may', async () => {
  const { check } = await load();
  const rows = GOOD.map((r) => r.startsWith('| C.why.01') ? r.replace('| explanation |', '| default |') : r);
  const { findings } = check({ root: repo({ conventions: CONV, inventoryRows: rows }) });
  assert.ok(findings.some((f) => /row C\.why\.01 .*only an explanation may move to an ADR/.test(f)), findings.join('\n'));
});

test('duplicate ids, unknown classes and an unescaped pipe are findings', async () => {
  const { check } = await load();
  const rows = [...GOOD,
    '| C.claim.01 | default | | Dup. | Claim the issue before you start | CONVENTIONS.md | — |',
    '| C.x.01 | must | | Bad class. | Claim the issue before you start | CONVENTIONS.md | — |',
    '| C.x.02 | default | | Bad | pipe. | Claim the issue before you start | CONVENTIONS.md | — |'];
  const { findings } = check({ root: repo({ conventions: CONV, inventoryRows: rows }) });
  assert.ok(findings.some((f) => /duplicate id/.test(f)));
  assert.ok(findings.some((f) => /class "must"/.test(f)));
  assert.ok(findings.some((f) => /has 8 cells, expected 7/.test(f)));
});

test('this repo\'s inventory is clean', async () => {
  const { check } = await load();
  const res = check({ root: ROOT });
  assert.strictEqual(res.fatal, false);
  assert.deepStrictEqual(res.findings, []);
  assert.ok(res.rows.filter((r) => r.class === 'hard').length > 0, 'no hard rows at all');
});
