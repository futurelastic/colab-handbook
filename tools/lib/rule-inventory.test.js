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
  assert.ok(findings.some((f) => /row C\.ship\.01 .*carries no Hard marker/.test(f)), findings.join('\n'));
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

test('a rule may move to the CLI\'s docs under tools/docs/, and its marker there is checked (#635)', async () => {
  const { check } = await load();
  const conv = CONV.replace('**[Hard — gate: colab ship]** A human must trigger the trunk merge on a manual repo.\n\n', '');
  const dir = repo({ conventions: conv, inventoryRows: GOOD.map((r) => r.startsWith('| C.ship.01') ? r.replace('| CONVENTIONS.md |', '| tools/docs/ship.md |') : r) });
  fs.mkdirSync(path.join(dir, 'tools', 'docs'));
  fs.writeFileSync(path.join(dir, 'tools', 'docs', 'ship.md'), '# ship\n\n**[Hard — gate: colab ship]** A human must trigger the trunk merge on a manual repo.\n\n**[Hard — gate: colab claim]** An unaccounted marker.\n');
  const { findings } = check({ root: dir });
  assert.deepStrictEqual(findings, ['tools/docs/ship.md:5: a Hard marker no inventory row accounts for — add the rule\'s row (class hard)']);
  // Anywhere else under tools/ is not a home for a rule.
  const other = repo({ conventions: conv, inventoryRows: GOOD.map((r) => r.startsWith('| C.ship.01') ? r.replace('| CONVENTIONS.md |', '| tools/colab |') : r) });
  assert.ok(check({ root: other }).findings.some((f) => /row C\.ship\.01 .*must live in .*tools\/docs\//.test(f)));
});

test('a default step may move to the handbook-sync skill; a hard rule may not, its marker there is still seen; another skill is no home (#640)', async () => {
  const { check } = await load();
  const conv = CONV.replace('- Claim the issue before you start, never when finishing.\n\n', '');
  const to = (id, dest) => GOOD.map((r) => r.startsWith(`| ${id}`) ? r.replace('| CONVENTIONS.md |', `| ${dest} |`) : r);
  const dir = repo({ conventions: conv, inventoryRows: to('C.claim.01', 'skills/handbook-sync/2-adoption-procedure.md') });
  fs.mkdirSync(path.join(dir, 'skills', 'handbook-sync'), { recursive: true });
  const file = path.join(dir, 'skills', 'handbook-sync', '2-adoption-procedure.md');
  fs.writeFileSync(file, '# adopt\n\n- Claim the issue before you start, never when finishing.\n');
  assert.deepStrictEqual(check({ root: dir }).findings, []);
  fs.appendFileSync(file, '\n**[Hard — gate: colab claim]** An unaccounted marker.\n');
  assert.deepStrictEqual(check({ root: dir }).findings, ['skills/handbook-sync/2-adoption-procedure.md:5: a Hard marker no inventory row accounts for — add the rule\'s row (class hard)']);
  // A hard rule names the gate that refuses: tool text, so it stays under tools/docs/.
  const hard = repo({ conventions: CONV.replace('**[Hard — gate: colab ship]** A human must trigger the trunk merge on a manual repo.\n\n', ''), inventoryRows: to('C.ship.01', 'skills/handbook-sync/2-adoption-procedure.md') });
  fs.mkdirSync(path.join(hard, 'skills', 'handbook-sync'), { recursive: true });
  fs.writeFileSync(path.join(hard, 'skills', 'handbook-sync', '2-adoption-procedure.md'), '# adopt\n\n**[Hard — gate: colab ship]** A human must trigger the trunk merge on a manual repo.\n');
  assert.ok(check({ root: hard }).findings.some((f) => /row C\.ship\.01 .*a hard rule must live in .*under tools\/docs\/, not/.test(f)));
  const other = repo({ conventions: conv, inventoryRows: to('C.claim.01', 'skills/code-ship/SKILL.md') });
  fs.mkdirSync(path.join(other, 'skills', 'code-ship'), { recursive: true });
  fs.writeFileSync(path.join(other, 'skills', 'code-ship', 'SKILL.md'), '# ship\n\n- Claim the issue before you start, never when finishing.\n');
  assert.ok(check({ root: other }).findings.some((f) => /row C\.claim\.01 .*must live in .*skills\/handbook-sync\//.test(f)));
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

// #632: the new marker cites the row's id and states what must be refused, naming no tool.
const NEW_CONV = (marker) => [
  '# C',
  '',
  '## Trunk merges',
  '',
  `${marker} A human must trigger the trunk merge on a manual repo.`,
  '',
  '- Claim the issue before you start, never when finishing.',
  '',
].join('\n');
const NEW_OK = '**[Hard C1.ship.01 — refuse: a trunk merge no human started]**';
const newRows = ({ gate = '', id = 'C1.ship.01', cls = 'hard', dest = 'CONVENTIONS.md' } = {}) => [
  `| ${id} | ${cls} | ${gate} | Wait for a human go. | A human must trigger the trunk merge | ${dest} | #1 |`,
  '| C1.claim.01 | default | | Claim first. | Claim the issue before you start | CONVENTIONS.md | — |',
];

test('a new-form marker passes, and its row needs no gate (#632)', async () => {
  const { check } = await load();
  const { findings } = check({ root: repo({ conventions: NEW_CONV(NEW_OK), inventoryRows: newRows() }) });
  assert.deepStrictEqual(findings, []);
});

test('a new-form row that does give a gate still has it checked (#632)', async () => {
  const { check } = await load();
  const rows = newRows({ gate: '`tools/colab::function gone`' });
  const { findings } = check({ root: repo({ conventions: NEW_CONV(NEW_OK), inventoryRows: rows }) });
  assert.ok(findings.some((f) => /row C1\.ship\.01 .*gate literal not found/.test(f)), findings.join('\n'));
});

test('an old-form row with no gate is a finding — the old form names its gate (#632)', async () => {
  const { check } = await load();
  const { findings } = check({ root: repo({ conventions: NEW_CONV('**[Hard — gate: colab ship]**'), inventoryRows: newRows() }) });
  assert.ok(findings.some((f) => /row C1\.ship\.01 .*old .* names no gate/.test(f)), findings.join('\n'));
});

test('old and new markers coexist in one document (#632)', async () => {
  const { check } = await load();
  const conv = NEW_CONV(NEW_OK).replace('- Claim the issue', '- **[Hard — gate: colab claim]** Claim the issue');
  const rows = [newRows()[0], '| C1.claim.01 | hard | `tools/colab::function shipAutonomyGate` | Claim first. | Claim the issue before you start | CONVENTIONS.md | — |'];
  const { findings } = check({ root: repo({ conventions: conv, inventoryRows: rows }) });
  assert.deepStrictEqual(findings, []);
});

test('a new marker citing an unknown, a non-hard or an elsewhere-keyed id is a finding (#632)', async () => {
  const { check } = await load();
  const unknown = check({ root: repo({ conventions: NEW_CONV(NEW_OK.replace('C1.ship.01', 'C1.ship.09')), inventoryRows: newRows() }) }).findings;
  assert.ok(unknown.some((f) => /marker \[Hard C1\.ship\.09\] cites an id the inventory does not have/.test(f)), unknown.join('\n'));

  const soft = check({ root: repo({ conventions: NEW_CONV(NEW_OK.replace('C1.ship.01', 'C1.claim.01')), inventoryRows: newRows() }) }).findings;
  assert.ok(soft.some((f) => /\[Hard C1\.claim\.01\] cites a default row/.test(f)), soft.join('\n'));

  const conv = NEW_CONV(NEW_OK).replace('- Claim the issue', '- **[Hard C1.ship.01 — refuse: work started without a claim]** Claim the issue');
  const elsewhere = check({ root: repo({ conventions: conv, inventoryRows: newRows() }) }).findings;
  assert.ok(elsewhere.some((f) => /CONVENTIONS\.md:7: marker \[Hard C1\.ship\.01\]: row C1\.ship\.01's key is not in this unit/.test(f)), elsewhere.join('\n'));
});

test('a refuse clause that names a tool, or says too little, is a finding (#632)', async () => {
  const { check } = await load();
  for (const [clause, re] of [
    ['a merge colab did not see', /names a tool \("colab"\)/],
    ['a push the pre-push hook rejects', /names a tool \("hook"\)/],
    ['a merge with `--force`', /names a tool \("`"\)/],
    ['unattended merges', /too short/],
  ]) {
    const conv = NEW_CONV(`**[Hard C1.ship.01 — refuse: ${clause}]**`);
    const { findings } = check({ root: repo({ conventions: conv, inventoryRows: newRows() }) });
    assert.ok(findings.some((f) => re.test(f)), `${clause}: ${findings.join('\n')}`);
  }
});

test('a new marker quoted as code is an example, not a marker (#632)', async () => {
  const { check } = await load();
  const conv = NEW_CONV(NEW_OK).replace('- Claim the issue', '- The form is `**[Hard C9.x.01 — refuse: gh x]**`. Claim the issue');
  const { findings } = check({ root: repo({ conventions: conv, inventoryRows: newRows() }) });
  assert.deepStrictEqual(findings, []);
});

test('a malformed id is a finding (#632)', async () => {
  const { check } = await load();
  const rows = [...newRows(), '| claim-one | default | | Claim. | Claim the issue before you start | CONVENTIONS.md | — |'];
  const { findings } = check({ root: repo({ conventions: NEW_CONV(NEW_OK), inventoryRows: rows }) });
  assert.ok(findings.some((f) => /row claim-one .*id "claim-one" is not of the shape/.test(f)), findings.join('\n'));
});

test('a dest anchor must be a heading of its file — a dead anchor is a finding (#632)', async () => {
  const { check } = await load();
  const live = check({ root: repo({ conventions: NEW_CONV(NEW_OK), inventoryRows: newRows({ dest: 'CONVENTIONS.md#trunk-merges' }) }) }).findings;
  assert.deepStrictEqual(live, []);
  const dead = check({ root: repo({ conventions: NEW_CONV(NEW_OK), inventoryRows: newRows({ dest: 'CONVENTIONS.md#trunk-merge' }) }) }).findings;
  assert.ok(dead.some((f) => /row C1\.ship\.01 .*dest anchor #trunk-merge is not a heading in CONVENTIONS\.md/.test(f)), dead.join('\n'));
});

test('this repo\'s inventory is clean', async () => {
  const { check } = await load();
  const res = check({ root: ROOT });
  assert.strictEqual(res.fatal, false);
  assert.deepStrictEqual(res.findings, []);
  assert.ok(res.rows.filter((r) => r.class === 'hard').length > 0, 'no hard rows at all');
});
