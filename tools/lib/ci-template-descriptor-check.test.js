'use strict';
/**
 * The CI templates' descriptor check (#416).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * An out-of-range `ship-batch:` used to be caught only by the audit and by `colab ship`, and
 * neither runs in an adopter's CI: the audit is run by hand, and ship fails closed to serial
 * without failing anything. So the templates carry a small shell step that fails the build on
 * the same values. A shell copy of a rule is a second source of truth, so these tests hold it
 * to the one in tools/lib/ship-batch.js: the step's own `run:` script is extracted from each
 * template and executed against a set of descriptors, and its verdict must equal
 * parseShipBatch's on every one. The three templates must carry the identical step, too.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const shipBatch = require('./ship-batch.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATES = ['ci-node.yml', 'ci-laravel.yml', 'ci-python.yml'];
const STEP_NAME = 'Descriptor check (.github/project.yml)';

// The step's `run: |` block, dedented — the exact text the runner would execute.
function stepScript(text) {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === `- name: ${STEP_NAME}`);
  if (at === -1) return null;
  const stepIndent = lines[at].indexOf('-');
  let r = -1;
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.search(/\S/) <= stepIndent) break; // next step / job
    if (/^\s+run:\s*\|\s*$/.test(l)) { r = i; break; }
  }
  if (r === -1) return null;
  const runIndent = lines[r].search(/\S/);
  const body = [];
  for (let i = r + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && l.search(/\S/) <= runIndent) break;
    body.push(l);
  }
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return body.map((l) => l.slice(pad)).join('\n') + '\n';
}

// [ project.yml line (null = no ship-batch line; undefined = no project.yml at all),
//   the value a YAML reader hands parseShipBatch ]
const CASES = [
  [undefined, undefined],
  [null, undefined],
  ['ship-batch:', null],
  ['ship-batch: ~', null],
  ['ship-batch: null', null],
  ['ship-batch: 1', 1],
  ['ship-batch: 2', 2],
  ['ship-batch: 3', 3],
  ['ship-batch: 3   # start low', 3],
  ['ship-batch: "3"', '3'],
  ["ship-batch: '2'", '2'],
  ['ship-batch: 0', 0],
  ['ship-batch: 4', 4],
  ['ship-batch: 5', 5],
  ['ship-batch: 8  # we have 8 sessions', 8],
  ['ship-batch: 2.5', 2.5],
  ['ship-batch: -1', -1],
  ['ship-batch: true', true],
  ['ship-batch: three', 'three'],
];

function runCase(script, line) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desc-check-'));
  try {
    if (line !== undefined) {
      fs.mkdirSync(path.join(dir, '.github'));
      const body = ['trunk: main', 'exposure: self', ...(line === null ? [] : [line]), 'stack: node', ''].join('\n');
      fs.writeFileSync(path.join(dir, '.github', 'project.yml'), body);
    }
    // GitHub's default `run:` shell on Linux: bash -e {0}.
    return spawnSync('bash', ['-e', '-c', script], { cwd: dir, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const scripts = {};
for (const file of TEMPLATES) {
  scripts[file] = stepScript(fs.readFileSync(path.join(REPO_ROOT, 'templates', file), 'utf8'));
}

test('every CI template carries the descriptor check (#416)', () => {
  for (const file of TEMPLATES) assert.ok(scripts[file], `${file}: no "${STEP_NAME}" step with a run: block`);
});

test('the three copies of the descriptor check are identical', () => {
  const [first, ...rest] = TEMPLATES;
  for (const file of rest) assert.strictEqual(scripts[file], scripts[first], `${file} differs from ${first}`);
});

test('the step fails exactly the values colab ship and the audit refuse', () => {
  const script = scripts[TEMPLATES[0]];
  for (const [line, value] of CASES) {
    const doc = value === undefined ? {} : { 'ship-batch': value };
    const want = shipBatch.parseShipBatch(doc).valid;
    const r = runCase(script, line);
    const label = line === undefined ? '(no project.yml)' : line === null ? '(no ship-batch line)' : line;
    assert.strictEqual(r.status === 0, want, `${label}: step exit ${r.status}, parseShipBatch valid=${want}\n${r.stdout}${r.stderr}`);
    if (!want) assert.match(r.stdout, /::error file=\.github\/project\.yml::ship-batch is /, `${label}: no annotation`);
  }
});

test('the cap the step enforces is the cap ship-batch.js declares', () => {
  // The case arm lists the valid integers literally; if MAX_BATCH moves, this must move with it.
  const arm = scripts[TEMPLATES[0]].match(/^\s*''\|'~'\|null\|([0-9|]+)\)/m);
  assert.ok(arm, 'case arm not found');
  const listed = arm[1].split('|').map(Number);
  assert.deepStrictEqual(listed, Array.from({ length: shipBatch.MAX_BATCH }, (_, i) => i + 1));
});

// #555: `ship-batch-wait:` — the same step, held to parseShipBatchWait the same way.
// [ project.yml line (null = no ship-batch-wait line), the value a YAML reader hands the parser ]
const WAIT_CASES = [
  [null, undefined],
  ['ship-batch-wait:', null],
  ['ship-batch-wait: ~', null],
  ['ship-batch-wait: null', null],
  ['ship-batch-wait: 90s', '90s'],
  ['ship-batch-wait: 6m', '6m'],
  ['ship-batch-wait: 6m   # from colab batch-stats', '6m'],
  ['ship-batch-wait: "6m"', '6m'],
  ["ship-batch-wait: '1h'", '1h'],
  ['ship-batch-wait: 0m', '0m'],
  ['ship-batch-wait: 48h', '48h'],
  ['ship-batch-wait: 6', 6],
  ['ship-batch-wait: 6min', '6min'],
  ['ship-batch-wait: 1.5m', '1.5m'],
  ['ship-batch-wait: -1m', '-1m'],
  ['ship-batch-wait: soon', 'soon'],
  ['ship-batch-wait: true', true],
];

test('#555: the step fails exactly the ship-batch-wait values colab ship and the audit refuse', () => {
  const script = scripts[TEMPLATES[0]];
  for (const [line, value] of WAIT_CASES) {
    const doc = value === undefined ? {} : { 'ship-batch-wait': value };
    const want = shipBatch.parseShipBatchWait(doc).valid;
    const r = runCase(script, line === null ? 'ship-batch: 3' : `ship-batch: 3\n${line}`);
    const label = line === null ? '(no ship-batch-wait line)' : line;
    assert.strictEqual(r.status === 0, want, `${label}: step exit ${r.status}, parseShipBatchWait valid=${want}\n${r.stdout}${r.stderr}`);
    if (!want) assert.match(r.stdout, /::error file=\.github\/project\.yml::ship-batch-wait is /, `${label}: no annotation`);
  }
});

test('#555: a ship-batch-wait line never reads as the ship-batch value', () => {
  // `^ship-batch[[:space:]]*:` must not match `ship-batch-wait:` — else a wait of 6m reads as a bad cap.
  const r = runCase(scripts[TEMPLATES[0]], 'ship-batch-wait: 6m');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ship-batch: absent — ok/);
  assert.match(r.stdout, /ship-batch-wait: 6m — ok/);
});
