'use strict';
/**
 * Pins the audit's `autonomy: auto-trunk` / `ceremony: light` behaviour, AND `colab solo`'s
 * real entry-gate behaviour, to the writes constraint matrix in CONVENTIONS.md §2 "Writes" —
 * issue #225, RE-BASED for #237 (the ⚖ Decision on #233).
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * WHY THIS FILE, SEPARATELY FROM audit-writes.test.js / audit-ceremony.test.js / solo.test.js:
 * those pin individual rules in isolation. This file pins the *table*, by reading it out of
 * CONVENTIONS.md rather than re-typing its cells here, so a one-cell doc edit that silently
 * contradicts the code fails the build instead of waiting for a reader to notice by eye — which
 * is exactly how #224 was caught (see below), and exactly the property #237's own re-basing has
 * to preserve through a much larger rewrite of the table.
 *
 * THE INCIDENT THIS EXISTS TO CATCH (#225, re-scoped after #224, RE-SCOPED AGAIN by #237):
 * #224 widened the `autonomy: auto-trunk` row from `forbidden` (serial-direct) / `allowed` /
 * `allowed` to `allowed` / `allowed` / `allowed` — a real, correct fix that also had to flip a
 * different row (`ceremony: light` + `autonomy: auto-trunk`) in the SAME commit, and did not,
 * until a human caught it by re-reading the whole table. This file is what should have caught
 * it instead — and #237 is the exact same class of hazard on a larger scale: the table went
 * from three declarable-method columns to two descriptor columns (veto / coexistence), AND two
 * new rows (the two trunk-direct constraints) became checkable for the first time, because they
 * now depend on session identity (`COLAB_HUMAN=1`) rather than an unaudited declared value. A
 * doc edit that gets any cell wrong in either direction must fail this file.
 *
 * PARSE, NOT HARD-CODE — the trade-off, spelled out: this file reads the matrix's cell text
 * straight out of CONVENTIONS.md instead of encoding "allowed"/"forbidden" constants here.
 * That makes CONVENTIONS.md the single source the test reasons from, so a cell edit that
 * changes meaning is caught automatically, in EITHER direction — doc changed and code didn't,
 * or code changed and doc didn't. The cost is brittleness: this parser depends on the table's
 * current shape (header text, column order, the "allowed"/"**forbidden**" spelling). An
 * ordinary prose edit near the table that does not change any cell's meaning should not touch
 * this file at all; a `parseWritesMatrix()` failure is not a false alarm about behaviour, it is
 * the parser asking a human to re-point it — the error messages below say exactly what to do.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');
const COLAB = path.join(REPO_ROOT, 'tools', 'colab');
const CONVENTIONS = path.join(REPO_ROOT, 'CONVENTIONS.md');

// The two current descriptor columns (CONVENTIONS.md §2 "Writes"), in the matrix's own column
// order. `veto` is the single explicit spelling that forbids trunk-direct; `coexistence` covers
// every other declared value AND absence — the matrix states one representative fixture per
// column (the sanity/CLI tests below use `writes: isolated` for veto, omission for coexistence);
// the full "every legacy spelling is inert too" claim is pinned separately in solo.test.js and
// writes-authority.test.js, not re-proven here.
const WRITES_COLUMNS = ['veto', 'coexistence'];

// Rows the matrix itself says describe SESSION BEHAVIOUR ("did a session take a place-claim",
// "did a session branch") that the audit — a repo read at rest — has no way to observe. Not a
// cop-out list to route around inconvenient rows: the sanity test below fails loudly if the
// matrix ever adds a row whose cells don't parse as allowed/forbidden AND isn't named in either
// this set or RUNTIME_ROWS below.
const UNCHECKABLE_ROWS = new Set(['place-claim needed', 'branch']);

// #237: the two rows that used to be UNCHECKABLE under the old three-method table are now
// checkable — not by the STATIC audit (still a repo-at-rest reader with no session to observe),
// but by driving the REAL `colab solo` against a fixture, with and without COLAB_HUMAN=1. These
// are exactly the rows the ⚖ Decision on #233 turned from "a declared value nobody could verify"
// into "a session-identity fact a CLI invocation can prove or disprove directly" — the matrix's
// own stated argument for the re-basing (CONVENTIONS.md §2, Writes: "gains auditability").
const RUNTIME_ROWS = new Set(['trunk-direct, human at the keyboard (COLAB_HUMAN=1)', 'trunk-direct, automated session']);

// ---------------------------------------------------------------------------------------
// Parse the matrix out of CONVENTIONS.md.
// ---------------------------------------------------------------------------------------

function parseWritesMatrix() {
  const text = fs.readFileSync(CONVENTIONS, 'utf8');
  // #283 widened the coexistence column header to list `free`/`direct` alongside every legacy
  // spelling — still exactly 3 pipe-cells (constraint + veto + coexistence), so WRITES_COLUMNS
  // and every downstream assertion in this file are unaffected by the wording change alone.
  const headerNeedle = '| constraint | `writes: isolated` (the veto) | `free` · `direct` · absent · `serial` · `serial-direct` · `serial-gated` (coexistence) |';
  const headerIdx = text.indexOf(headerNeedle);
  if (headerIdx === -1) {
    throw new Error(
      'audit-writes-matrix.test.js: could not find the writes constraint matrix header in '
      + 'CONVENTIONS.md §2 "Writes". Expected a table starting with exactly:\n  ' + headerNeedle
      + '\nEither the table moved, the header text changed, or the column order changed. '
      + 'Update headerNeedle (and WRITES_COLUMNS if the columns reordered) in this test file '
      + 'to match the new table, then re-check every row this file asserts on.'
    );
  }

  const lines = text.slice(headerIdx).split('\n');
  // lines[0] = the header row just matched; lines[1] must be the `|---|---|---|` separator
  // (3 columns: constraint + 2 descriptor states); data rows follow until the first line that
  // is not a pipe-table row.
  if (!/^\|[\s-]*\|[\s-]*\|[\s-]*\|\s*$/.test(lines[1] || '')) {
    throw new Error(
      'audit-writes-matrix.test.js: found the matrix header in CONVENTIONS.md, but the next '
      + 'line is not a 3-column markdown table separator ("|---|---|---|"). Got: '
      + JSON.stringify(lines[1]) + '\nThe table shape changed — update parseWritesMatrix().'
    );
  }
  const dataLines = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) break;
    dataLines.push(line);
  }
  if (dataLines.length === 0) {
    throw new Error(
      'audit-writes-matrix.test.js: found the matrix header in CONVENTIONS.md but no data '
      + 'rows followed it before a non-table line. The table may have been reformatted — '
      + 'update parseWritesMatrix().'
    );
  }

  const rows = {};
  for (const line of dataLines) {
    const cells = line.split('|');
    // A well-formed `| a | b | c |` line splits into ['', ' a ', ' b ', ' c ', '']; drop the
    // empty leading/trailing cells produced by the boundary pipes.
    const trimmed = cells.slice(1, -1).map((c) => c.trim());
    if (trimmed.length !== 3) {
      throw new Error(
        'audit-writes-matrix.test.js: a row under the matrix header does not have exactly 3 '
        + 'cells (constraint + veto + coexistence): ' + JSON.stringify(line)
        + '\nThe table gained/lost a column — update WRITES_COLUMNS and every assertion in '
        + 'this file that assumes 2 columns.'
      );
    }
    const label = trimmed[0].replace(/`/g, '');
    rows[label] = {
      veto: trimmed[1],
      coexistence: trimmed[2],
    };
  }
  return rows;
}

// A cell reads as one of: an unconditional grant ("allowed", possibly with trailing prose), an
// unconditional prohibition ("**forbidden**", possibly with a trailing citation), or something
// else this file does not attempt to interpret as a pass/fail verdict (session-behaviour prose
// like "yes"/"always"/"n/a", or a dash meaning "not applicable" — the spelling that went stale
// in #224).
function classify(cellText) {
  if (/\*\*forbidden\*\*/.test(cellText)) return 'forbidden';
  if (/^allowed\b/.test(cellText)) return 'allowed';
  return null;
}

const matrix = parseWritesMatrix();

// ---------------------------------------------------------------------------------------
// Matrix sanity: every row is either classifiable (allowed/forbidden, for every column),
// explicitly named as session-behaviour the STATIC audit cannot see (UNCHECKABLE_ROWS), or
// explicitly named as session-behaviour a REAL CLI invocation now proves (RUNTIME_ROWS). This
// three-way split is what would have caught #224's regression directly, and is what #237 had to
// widen without loosening: a row that parses as neither allowed/forbidden AND isn't named in
// either set still fails loudly.
// ---------------------------------------------------------------------------------------

test('every row in the writes constraint matrix is either checkable, explicitly declared session-only (static), or explicitly declared runtime-checked', () => {
  const problems = [];
  for (const [label, cols] of Object.entries(matrix)) {
    if (UNCHECKABLE_ROWS.has(label) || RUNTIME_ROWS.has(label)) continue;
    for (const col of WRITES_COLUMNS) {
      const verdict = classify(cols[col]);
      if (verdict === null) {
        problems.push(
          `row ${JSON.stringify(label)}, column ${JSON.stringify(col)}: cell text `
          + `${JSON.stringify(cols[col])} is neither "allowed" nor "**forbidden**". Either `
          + 'this cell needs to read one of those two (the audit only implements '
          + 'unconditional grants/prohibitions), or this row genuinely describes session '
          + 'behaviour — in which case add its label to UNCHECKABLE_ROWS (if the STATIC audit '
          + 'can never observe it) or RUNTIME_ROWS (if a real `colab solo` invocation can '
          + 'prove it) in tools/lib/audit-writes-matrix.test.js, with a comment explaining why.'
        );
      }
    }
  }
  assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('the two static rows this file expects to check are both present and both fully classifiable today', () => {
  // A belt-and-braces check on top of the sanity test above: confirms this file is actually
  // exercising the two rows the incident concerned, not silently exercising zero rows because
  // the header needle stopped matching and every subsequent lookup returned undefined.
  assert.ok('autonomy: auto-trunk' in matrix, 'matrix is missing the "autonomy: auto-trunk" row');
  assert.ok('ceremony: light + autonomy: auto-trunk' in matrix, 'matrix is missing the "ceremony: light + autonomy: auto-trunk" row');
  for (const col of WRITES_COLUMNS) {
    assert.notStrictEqual(classify(matrix['autonomy: auto-trunk'][col]), null, `autonomy: auto-trunk / ${col}`);
    assert.notStrictEqual(classify(matrix['ceremony: light + autonomy: auto-trunk'][col]), null, `ceremony: light + autonomy: auto-trunk / ${col}`);
  }
});

test('the two runtime rows this file expects to drive against the real CLI are both present and both fully classifiable today', () => {
  for (const label of RUNTIME_ROWS) {
    assert.ok(label in matrix, `matrix is missing the ${JSON.stringify(label)} row`);
    for (const col of WRITES_COLUMNS) {
      assert.notStrictEqual(classify(matrix[label][col]), null, `${label} / ${col}`);
    }
  }
});

// ---------------------------------------------------------------------------------------
// Fixture harness — static (audit) half, same shape as audit-writes.test.js / audit-ceremony.test.js.
// ---------------------------------------------------------------------------------------

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

function fixture(projectYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-writes-matrix-'));
  TMP.push(dir);
  const g = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'audit test');
  g('config', 'core.hooksPath', path.join(dir, '.nohooks'));
  fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'project.yml'), projectYml);
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: fixture');
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
    ok: r.ok,
    fails: r.findings.filter((f) => f.level === 'fail').map((f) => f.text),
    warns: r.findings.filter((f) => f.level === 'warn').map((f) => f.text),
  };
}

const hasText = (list, rx) => list.some((t) => rx.test(t));
const INCOMPATIBLE_RX = /ceremony: light is incompatible with autonomy: auto-trunk/;

function baseYml(writesLine, extra) {
  return `tier: B\ntrunk: main\nproduction: null\ndeploy: none\nstack: node\n${writesLine}${extra}`;
}

// The one representative fixture value per column — the matrix states the column, not every
// spelling that resolves to it; "every legacy spelling collapses to the same column" is pinned
// separately (solo.test.js, writes-authority.test.js, this file's own RUNTIME section below).
const COLUMN_WRITES_LINE = { veto: 'writes: isolated\n', coexistence: '' };

// ---------------------------------------------------------------------------------------
// Row: `autonomy: auto-trunk` (ceremony omitted => defaults to standard, so the
// ceremony-coherence rule below never engages — this row is checked in isolation).
// ---------------------------------------------------------------------------------------

for (const col of WRITES_COLUMNS) {
  const verdict = classify(matrix['autonomy: auto-trunk'][col]);
  test(`matrix row "autonomy: auto-trunk" / ${col} reads "${verdict}" and the audit agrees`, () => {
    const yml = baseYml(COLUMN_WRITES_LINE[col], 'autonomy: auto-trunk\n');
    const r = audit(fixture(yml));
    if (verdict === 'allowed') {
      assert.ok(!hasText(r.fails, INCOMPATIBLE_RX), `matrix says allowed but audit failed: ${r.fails.join(' | ')}`);
    } else {
      assert.ok(hasText(r.fails, INCOMPATIBLE_RX), `matrix says forbidden but audit did not fail: ${r.fails.join(' | ')}`);
    }
  });
}

// ---------------------------------------------------------------------------------------
// Row: `ceremony: light` + `autonomy: auto-trunk` — the row #224 silently invalidated.
// ---------------------------------------------------------------------------------------

for (const col of WRITES_COLUMNS) {
  const verdict = classify(matrix['ceremony: light + autonomy: auto-trunk'][col]);
  test(`matrix row "ceremony: light + autonomy: auto-trunk" / ${col} reads "${verdict}" and the audit agrees`, () => {
    const yml = baseYml(COLUMN_WRITES_LINE[col], 'ceremony: light\nautonomy: auto-trunk\n');
    const r = audit(fixture(yml));
    if (verdict === 'forbidden') {
      assert.ok(hasText(r.fails, INCOMPATIBLE_RX), `matrix says forbidden but audit did not fail: ${r.fails.join(' | ')}`);
    } else {
      assert.ok(!hasText(r.fails, INCOMPATIBLE_RX), `matrix says allowed but audit failed: ${r.fails.join(' | ')}`);
    }
  });
}

// ---------------------------------------------------------------------------------------
// RUNTIME_ROWS — the two trunk-direct rows, driven against the REAL `colab solo`, with a
// private COLAB_HOME (never the developer's real state) and COLAB_HUMAN explicitly neutralised
// or set per case. Same harness shape as tools/lib/place-cli.test.js.
// ---------------------------------------------------------------------------------------

function soloFixture(projectYml) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-writes-matrix-solo-'));
  TMP.push(root);
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const home = path.join(root, 'colab-home');
  fs.mkdirSync(home);
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', work], { encoding: 'utf8' });
  g(work, 'config', 'user.email', 'test@example.invalid');
  g(work, 'config', 'user.name', 'audit-writes-matrix solo test');
  g(work, 'config', 'core.hooksPath', path.join(root, '.nohooks'));
  g(work, 'remote', 'add', 'origin', origin);
  fs.mkdirSync(path.join(work, '.github'), { recursive: true });
  fs.writeFileSync(path.join(work, '.github', 'project.yml'), projectYml);
  g(work, 'add', '-A');
  g(work, 'commit', '-q', '-m', 'chore: fixture');
  g(work, 'push', '-q', 'origin', 'main');
  return { work, home };
}

function colabSolo(fx, extraEnv = {}) {
  const r = spawnSync('node', [COLAB, 'solo', '--repo', fx.work, '--session', 'sess-matrix'], {
    encoding: 'utf8',
    // COLAB_HUMAN neutralised to '' by default — never inherited ambiently (see place-cli.test.js
    // for the same discipline and why it matters: an exported dev COLAB_HUMAN=1 must not make
    // this test green for the wrong reason).
    env: { ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '', COLAB_HUMAN: '', ...extraEnv },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

const VETO_YML = baseYml('writes: isolated\n', '');
const COEXIST_YML = baseYml('', ''); // writes omitted entirely

test('matrix row "trunk-direct, human at the keyboard (COLAB_HUMAN=1)" / veto reads "forbidden" and colab solo agrees', () => {
  const verdict = classify(matrix['trunk-direct, human at the keyboard (COLAB_HUMAN=1)'].veto);
  const r = colabSolo(soloFixture(VETO_YML), { COLAB_HUMAN: '1' });
  if (verdict === 'forbidden') {
    assert.notStrictEqual(r.code, 0, `matrix says forbidden but colab solo succeeded: ${r.out}`);
  } else {
    assert.strictEqual(r.code, 0, `matrix says allowed but colab solo refused: ${r.err}`);
  }
});

test('matrix row "trunk-direct, human at the keyboard (COLAB_HUMAN=1)" / coexistence reads "allowed" and colab solo agrees', () => {
  const verdict = classify(matrix['trunk-direct, human at the keyboard (COLAB_HUMAN=1)'].coexistence);
  const r = colabSolo(soloFixture(COEXIST_YML), { COLAB_HUMAN: '1' });
  if (verdict === 'allowed') {
    assert.strictEqual(r.code, 0, `matrix says allowed but colab solo refused: ${r.err}`);
  } else {
    assert.notStrictEqual(r.code, 0, `matrix says forbidden but colab solo succeeded: ${r.out}`);
  }
});

test('matrix row "trunk-direct, automated session" / veto reads "forbidden" and colab solo agrees (no COLAB_HUMAN)', () => {
  const verdict = classify(matrix['trunk-direct, automated session'].veto);
  const r = colabSolo(soloFixture(VETO_YML)); // no COLAB_HUMAN
  if (verdict === 'forbidden') {
    assert.notStrictEqual(r.code, 0, `matrix says forbidden but colab solo succeeded: ${r.out}`);
  } else {
    assert.strictEqual(r.code, 0, `matrix says allowed but colab solo refused: ${r.err}`);
  }
});

test('matrix row "trunk-direct, automated session" / coexistence reads "forbidden" and colab solo agrees (no COLAB_HUMAN)', () => {
  const verdict = classify(matrix['trunk-direct, automated session'].coexistence);
  const r = colabSolo(soloFixture(COEXIST_YML)); // no COLAB_HUMAN
  if (verdict === 'forbidden') {
    assert.notStrictEqual(r.code, 0, `matrix says forbidden but colab solo succeeded: ${r.out}`);
  } else {
    assert.strictEqual(r.code, 0, `matrix says allowed but colab solo refused: ${r.err}`);
  }
});

// ---------------------------------------------------------------------------------------
// Rows NOT checked here, and why (mirrors UNCHECKABLE_ROWS above so the reasoning has a
// home next to the code, not just in the constant):
//
// - `place-claim needed` — whether a session took a place-claim is a fact about what a
//   session DID during its run, not a fact recoverable from `.github/project.yml` or any
//   other file the audit reads. There is no fixture shape that represents "a session held a
//   claim"; a repo at rest looks identical whether or not one was ever taken.
// - `branch` — same reasoning: whether a session produced a branch is an act, not a
//   descriptor. The audit can and does check things ABOUT branches it can see (trunk shape,
//   CI status), but "did THIS unit of work branch" is not observable from a checkout at rest.
// ---------------------------------------------------------------------------------------
