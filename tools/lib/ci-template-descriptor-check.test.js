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
  ['ship-batch: 9', 9],
  ['ship-batch: 10', 10],
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

// #557: `ship-batch-steps:` — the same step, held to parseShipBatchSteps. The parser gets the scalar a
// flat reader hands it (a flow list arrives as its text, which the parser reads the same as an array).
// [ ship-batch value, project.yml steps line (null = none), the value the parser gets ]
const STEPS_CASES = [
  ['8', null, undefined],
  ['8', 'ship-batch-steps:', null],
  ['8', 'ship-batch-steps: ~', null],
  ['8', 'ship-batch-steps: 2,4,8', '2,4,8'],
  ['8', 'ship-batch-steps: 2, 4, 8', '2, 4, 8'],
  ['8', 'ship-batch-steps: [2, 4, 8]', '[2, 4, 8]'],
  ['8', 'ship-batch-steps: "2,4,8"   # from batch-stats', '2,4,8'],
  ['8', 'ship-batch-steps: 4', '4'],
  ['6', 'ship-batch-steps: 1,3,6', '1,3,6'],
  ['8', 'ship-batch-steps: 4,2', '4,2'],
  ['8', 'ship-batch-steps: 2,2,4', '2,2,4'],
  ['8', 'ship-batch-steps: 0,2', '0,2'],
  ['8', 'ship-batch-steps: 2,,4', '2,,4'],
  ['8', 'ship-batch-steps: 2;4', '2;4'],
  ['8', 'ship-batch-steps: 2 4', '2 4'],
  ['8', 'ship-batch-steps: 2.5,4', '2.5,4'],
  ['8', 'ship-batch-steps: two', 'two'],
  ['3', 'ship-batch-steps: 2,4', '2,4'],
  [null, 'ship-batch-steps: 2', '2'],
  [null, 'ship-batch-steps: 1', '1'],
];

test('#557: the step fails exactly the ship-batch-steps values colab ship and the audit refuse', () => {
  const script = scripts[TEMPLATES[0]];
  for (const [n, line, value] of STEPS_CASES) {
    const doc = { ...(n === null ? {} : { 'ship-batch': n }), ...(value === undefined ? {} : { 'ship-batch-steps': value }) };
    const want = shipBatch.parseShipBatchSteps(doc).valid;
    const lines = [...(n === null ? [] : [`ship-batch: ${n}`]), ...(line === null ? [] : [line])];
    const r = runCase(script, lines.length ? lines.join('\n') : null);
    const label = `ship-batch: ${n} / ${line}`;
    assert.strictEqual(r.status === 0, want, `${label}: step exit ${r.status}, parseShipBatchSteps valid=${want}\n${r.stdout}${r.stderr}`);
    if (!want) assert.match(r.stdout, /::error file=\.github\/project\.yml::ship-batch-steps is /, `${label}: no annotation`);
  }
});

test('#555: a ship-batch-wait line never reads as the ship-batch value', () => {
  // `^ship-batch[[:space:]]*:` must not match `ship-batch-wait:` — else a wait of 6m reads as a bad cap.
  const r = runCase(scripts[TEMPLATES[0]], 'ship-batch-wait: 6m');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ship-batch: absent — ok/);
  assert.match(r.stdout, /ship-batch-wait: 6m — ok/);
});

// #560: `thresholds:` — the same step, held to tools/lib/thresholds.js. The value handed to the parser
// is the RAW scalar, as the audit's reader hands it (a digit string) — the stricter of the two readers,
// so `4.0` is refused by both gates even though the CLI's YAML reader would read it as 4.
const thresholds = require('./thresholds.js');

// [ the indented lines under `thresholds:` (or the inline value after it), the map the parser gets ]
const THRESHOLD_CASES = [
  ['', null],
  [' ~', null],
  ['\n  hot-file-count: 4', { 'hot-file-count': '4' }],
  ['\n  hot-file-count: 4   # four waiting', { 'hot-file-count': '4' }],
  ['\n  hot-file-count: "4"', { 'hot-file-count': '4' }],
  ["\n  hold-stale-days: '45'\n  smoke-minutes: 5", { 'hold-stale-days': '45', 'smoke-minutes': '5' }],
  ['\n  # a comment\n\n  doc-budget-slack: 0', { 'doc-budget-slack': '0' }],
  ['\n  claude-md-line-floor-bytes: 0', { 'claude-md-line-floor-bytes': '0' }],
  ['\n  hot-file-count:', { 'hot-file-count': null }],
  ['\n  hot-file-count: 1', { 'hot-file-count': '1' }],
  ['\n  claude-md-line-multiple: 1', { 'claude-md-line-multiple': '1' }],
  ['\n  hold-stale-days: 0', { 'hold-stale-days': '0' }],
  ['\n  smoke-minutes: 2.5', { 'smoke-minutes': '2.5' }],
  ['\n  smoke-minutes: 4.0', { 'smoke-minutes': '4.0' }],
  ['\n  claude-md-kb: 40KB', { 'claude-md-kb': '40KB' }],
  ['\n  transitional-days: -3', { 'transitional-days': '-3' }],
  ['\n  transitional-days: 1234567890', { 'transitional-days': '1234567890' }],
  ['\n  hot-files: 4', { 'hot-files': '4' }],
  ['\n  hot-file-count: 4\n  hot-files: 4', { 'hot-file-count': '4', 'hot-files': '4' }],
  [' 5', '5'],
  [' high', 'high'],
  // #556: no-default batch keys, percents bounded at 100
  ['\n  batch-overlap-pct: 30', { 'batch-overlap-pct': '30' }],
  ['\n  batch-first-green-pct-min: 0', { 'batch-first-green-pct-min': '0' }],
  ['\n  batch-eviction-pct-max: 100', { 'batch-eviction-pct-max': '100' }],
  ['\n  batch-eviction-pct-max: 101', { 'batch-eviction-pct-max': '101' }],
  ['\n  batch-min-samples: 0', { 'batch-min-samples': '0' }],
  ['\n  batch-min-samples: 5', { 'batch-min-samples': '5' }],
];

test('#560: the step fails exactly the thresholds entries the parser refuses', () => {
  const script = scripts[TEMPLATES[0]];
  for (const [tail, value] of THRESHOLD_CASES) {
    const want = thresholds.parseThresholds({ thresholds: value }).problems.length === 0;
    const r = runCase(script, `thresholds:${tail}`);
    assert.strictEqual(r.status === 0, want, `thresholds:${tail}: step exit ${r.status}, parser valid=${want}\n${r.stdout}${r.stderr}`);
    if (!want) assert.match(r.stdout, /::error file=\.github\/project\.yml::thresholds/, `thresholds:${tail}: no annotation`);
  }
});

test('#560: a thresholds block ends at the next top-level key', () => {
  // `stack: node` follows the block in runCase's descriptor; it must not read as a threshold.
  const r = runCase(scripts[TEMPLATES[0]], 'thresholds:\n  hot-file-count: 4');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /thresholds\.hot-file-count: 4 — ok/);
  assert.doesNotMatch(r.stdout, /stack/);
});

test('#560/#556: the names, floors and ceilings the step lists are thresholds.js SPEC', () => {
  for (const name of TEMPLATES) {
    const script = scripts[name];
    const listed = {};
    for (const m of script.matchAll(/^\s*([a-z|-]+)\) min=(\d+)(?: max=(\d+))? ;;$/gm)) {
      for (const k of m[1].split('|')) listed[k] = [Number(m[2]), m[3] === undefined ? thresholds.MAX_VALUE : Number(m[3])];
    }
    const spec = Object.fromEntries(Object.entries(thresholds.SPEC).map(([k, s]) => [k, [s.min, s.max === undefined ? thresholds.MAX_VALUE : s.max]]));
    assert.deepStrictEqual(listed, spec, name);
  }
});

// #564: `ci-wait-factor:` — the same step, held to tools/lib/ci-profile.js parseFactor. The value handed
// to the parser is the scalar as the audit's reader hands it (quotes stripped, a string). The CLI's
// tools/lib/yaml.js gives the same verdict on every case below (it too reads `1e3` as a string).
const ciProfile = require('./ci-profile.js');

// [ project.yml line (null = no ci-wait-factor line), the value the audit's reader hands parseFactor ]
const FACTOR_CASES = [
  [null, undefined],
  ['ci-wait-factor:', null],
  ['ci-wait-factor: ~', null],
  ['ci-wait-factor: null', null],
  ['ci-wait-factor: 1', '1'],
  ['ci-wait-factor: 2', '2'],
  ['ci-wait-factor: 1.5', '1.5'],
  ['ci-wait-factor: 1.0', '1.0'],
  ['ci-wait-factor: 10   # a slow, flaky runner pool', '10'],
  ['ci-wait-factor: "3"', '3'],
  ["ci-wait-factor: '2.5'", '2.5'],
  ['ci-wait-factor: 0', '0'],
  ['ci-wait-factor: 0.5', '0.5'],
  ['ci-wait-factor: 0.99', '0.99'],
  ['ci-wait-factor: -2', '-2'],
  ['ci-wait-factor: .5', '.5'],
  ['ci-wait-factor: 1.', '1.'],
  ['ci-wait-factor: 1e3', '1e3'],
  ['ci-wait-factor: 2x', '2x'],
  ['ci-wait-factor: double', 'double'],
  ['ci-wait-factor: true', true],
];

test('#564: the step fails exactly the ci-wait-factor values parseFactor refuses', () => {
  for (const file of TEMPLATES) {
    const script = scripts[file];
    for (const [line, value] of FACTOR_CASES) {
      const doc = value === undefined ? {} : { [ciProfile.FACTOR_KEY]: value };
      const want = ciProfile.parseFactor(doc).valid;
      const r = runCase(script, line);
      const label = `${file} ${line === null ? '(no ci-wait-factor line)' : line}`;
      assert.strictEqual(r.status === 0, want, `${label}: step exit ${r.status}, parseFactor valid=${want}\n${r.stdout}${r.stderr}`);
      if (!want) assert.match(r.stdout, /::error file=\.github\/project\.yml::ci-wait-factor is /, `${label}: no annotation`);
    }
  }
});

test('#564: the step reads the key parseFactor reads', () => {
  // A renamed FACTOR_KEY must not leave the step checking a key nothing reads any more.
  assert.match(scripts[TEMPLATES[0]], new RegExp(`field ${ciProfile.FACTOR_KEY}\\)`));
  const r = runCase(scripts[TEMPLATES[0]], `${ciProfile.FACTOR_KEY}: 3`);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ci-wait-factor: 3 — ok/);
});
