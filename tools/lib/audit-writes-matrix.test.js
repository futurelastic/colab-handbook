'use strict';
/**
 * Pins the audit's `autonomy: auto-trunk` / `ceremony: light` behaviour to the writes
 * constraint matrix in CONVENTIONS.md §2 "Writes" (the `| constraint | serial-direct |
 * serial-gated | isolated |` table) — issue #225.
 *
 * Run: `node --test tools/lib/*.test.js` — the existing CI glob picks this file up.
 *
 * WHY THIS FILE, SEPARATELY FROM audit-writes.test.js / audit-ceremony.test.js: those pin
 * individual rules in isolation. This file pins the *table*, by reading it out of
 * CONVENTIONS.md rather than re-typing its cells here, so a one-cell doc edit that silently
 * contradicts the code fails the build instead of waiting for a reader to notice by eye —
 * which is exactly how #224 was caught (see below).
 *
 * THE INCIDENT THIS EXISTS TO CATCH (#225, re-scoped after #224):
 * #224 widened the `autonomy: auto-trunk` row from `forbidden` (serial-direct) / `allowed` /
 * `allowed` to `allowed` / `allowed` / `allowed`. That is a real, correct fix — but the SAME
 * commit had to also flip a different row: `ceremony: light` + `autonomy: auto-trunk` had
 * read `—` (not applicable) for `serial-direct`, on the stated reasoning "solo flow does not
 * combine with an unattended-merge grant" — true only while the grant was impossible there.
 * Once it became possible, `audit/audit.mjs`'s ceremony/autonomy coherence check (~line 1074)
 * already failed that pairing UNCONDITIONALLY, never consulting `writes` at all — so the
 * table said "not applicable" exactly where the code said "fail". A human caught it before
 * merge, by re-reading the whole table. This file is what should have caught it instead.
 *
 * PARSE, NOT HARD-CODE — the trade-off, spelled out: this file reads the matrix's cell text
 * straight out of CONVENTIONS.md instead of encoding "allowed"/"forbidden" constants here.
 * That makes CONVENTIONS.md the single source the test reasons from, so a cell edit that
 * changes meaning (allowed <-> forbidden, or a checkable cell turning into an unclassifiable
 * one, like the old `—`) is caught automatically, in EITHER direction — doc changed and code
 * didn't, or code changed and doc didn't. Hard-coded expectations would have needed a human
 * to remember to update them in lockstep, which is the exact discipline #224 shows does not
 * reliably hold. The cost is brittleness: this parser depends on the table's current shape
 * (header text, column order, the "allowed"/"**forbidden**" spelling). An ordinary prose
 * edit near the table that does not change any cell's meaning should not touch this file at
 * all; a `parseWritesMatrix()` failure is not a false alarm about behaviour, it is the parser
 * asking a human to re-point it — the error messages below say exactly what to do.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AUDIT = path.join(REPO_ROOT, 'audit', 'audit.mjs');
const CONVENTIONS = path.join(REPO_ROOT, 'CONVENTIONS.md');

// The three current, declarable `writes:` methods, in the matrix's own column order
// (CONVENTIONS.md §2 "Writes", tools/lib/writes-authority.js WRITES_DECLARED).
const WRITES_COLUMNS = ['serial-direct', 'serial-gated', 'isolated'];

// Rows the matrix itself says describe SESSION BEHAVIOUR ("did a session take a place-claim",
// "did a session branch"), not descriptor state — audit/audit.mjs reads a repo at rest and
// has no way to observe either. This is not a cop-out list to route around inconvenient rows:
// the sanity test below (`every row is either checkable or explicitly declared uncheckable`)
// fails loudly if the matrix ever adds a row whose cells don't parse as allowed/forbidden AND
// isn't named here — so silently skipping real drift is not possible; only these two named,
// justified exceptions are.
const UNCHECKABLE_ROWS = new Set(['place-claim needed', 'branch']);

// ---------------------------------------------------------------------------------------
// Parse the matrix out of CONVENTIONS.md.
// ---------------------------------------------------------------------------------------

function parseWritesMatrix() {
  const text = fs.readFileSync(CONVENTIONS, 'utf8');
  const headerNeedle = '| constraint | `serial-direct` | `serial-gated` | `isolated` |';
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
  // lines[0] = the header row just matched; lines[1] must be the `|---|---|---|---|`
  // separator; data rows follow until the first line that is not a pipe-table row.
  if (!/^\|[\s-]*\|[\s-]*\|[\s-]*\|[\s-]*\|\s*$/.test(lines[1] || '')) {
    throw new Error(
      'audit-writes-matrix.test.js: found the matrix header in CONVENTIONS.md, but the next '
      + 'line is not a 4-column markdown table separator ("|---|---|---|---|"). Got: '
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
    // A well-formed `| a | b | c | d |` line splits into ['', ' a ', ' b ', ' c ', ' d ', ''];
    // drop the empty leading/trailing cells produced by the boundary pipes.
    const trimmed = cells.slice(1, -1).map((c) => c.trim());
    if (trimmed.length !== 4) {
      throw new Error(
        'audit-writes-matrix.test.js: a row under the matrix header does not have exactly 4 '
        + 'cells (constraint + 3 writes methods): ' + JSON.stringify(line)
        + '\nThe table gained/lost a column — update WRITES_COLUMNS and every assertion in '
        + 'this file that assumes 3 columns.'
      );
    }
    const label = trimmed[0].replace(/`/g, '');
    rows[label] = {
      'serial-direct': trimmed[1],
      'serial-gated': trimmed[2],
      'isolated': trimmed[3],
    };
  }
  return rows;
}

// A cell reads as one of: an unconditional grant ("allowed", possibly with trailing prose —
// see the `autonomy: auto-trunk` / serial-direct cell, which reads "allowed — governs the
// branch-merge fallback only..."), an unconditional prohibition ("**forbidden**", possibly
// with a trailing citation), or something else this file does not attempt to interpret as a
// pass/fail verdict (session-behaviour prose like "yes"/"optional"/"always", or a dash
// meaning "not applicable" — which is exactly the spelling that went stale in #224).
function classify(cellText) {
  if (/\*\*forbidden\*\*/.test(cellText)) return 'forbidden';
  if (/^allowed\b/.test(cellText)) return 'allowed';
  return null;
}

const matrix = parseWritesMatrix();

// ---------------------------------------------------------------------------------------
// Matrix sanity: every row is either classifiable (allowed/forbidden, for every column) or
// explicitly named as session-behaviour and therefore exempt. This is the mechanism that
// would have caught #224's regression directly: reintroduce the old `—` cell for
// `ceremony: light` + `autonomy: auto-trunk` / serial-direct, and this test fails, because
// that row is not in UNCHECKABLE_ROWS and `—` classifies as neither allowed nor forbidden.
// ---------------------------------------------------------------------------------------

test('every row in the writes constraint matrix is either checkable or explicitly declared session-only', () => {
  const problems = [];
  for (const [label, cols] of Object.entries(matrix)) {
    if (UNCHECKABLE_ROWS.has(label)) continue;
    for (const col of WRITES_COLUMNS) {
      const verdict = classify(cols[col]);
      if (verdict === null) {
        problems.push(
          `row ${JSON.stringify(label)}, column ${JSON.stringify(col)}: cell text `
          + `${JSON.stringify(cols[col])} is neither "allowed" nor "**forbidden**". Either `
          + 'this cell needs to read one of those two (the audit only implements '
          + 'unconditional grants/prohibitions), or this row genuinely describes session '
          + 'behaviour the audit cannot observe at rest — in which case add its label to '
          + 'UNCHECKABLE_ROWS in tools/lib/audit-writes-matrix.test.js, with a comment '
          + 'explaining why, the same way `place-claim needed` and `branch` are.'
        );
      }
    }
  }
  assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('the two rows this file expects to check are both present and both fully classifiable today', () => {
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

// ---------------------------------------------------------------------------------------
// Fixture harness — same shape as audit-writes.test.js / audit-ceremony.test.js.
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

// ---------------------------------------------------------------------------------------
// Row: `autonomy: auto-trunk` (ceremony omitted => defaults to standard, so the
// ceremony-coherence rule below never engages — this row is checked in isolation).
// ---------------------------------------------------------------------------------------

for (const col of WRITES_COLUMNS) {
  const verdict = classify(matrix['autonomy: auto-trunk'][col]);
  test(`matrix row "autonomy: auto-trunk" / writes: ${col} reads "${verdict}" and the audit agrees`, () => {
    const yml = baseYml(`writes: ${col}\n`, 'autonomy: auto-trunk\n');
    const r = audit(fixture(yml));
    if (verdict === 'allowed') {
      assert.ok(!hasText(r.fails, INCOMPATIBLE_RX), `matrix says allowed but audit failed: ${r.fails.join(' | ')}`);
    } else {
      assert.ok(hasText(r.fails, INCOMPATIBLE_RX), `matrix says forbidden but audit did not fail: ${r.fails.join(' | ')}`);
    }
  });
}

test('matrix row "autonomy: auto-trunk" / the legacy "serial" alias resolves to the serial-direct column', () => {
  const verdict = classify(matrix['autonomy: auto-trunk']['serial-direct']);
  const yml = baseYml('writes: serial\n', 'autonomy: auto-trunk\n');
  const r = audit(fixture(yml));
  if (verdict === 'allowed') {
    assert.ok(!hasText(r.fails, INCOMPATIBLE_RX), `matrix says allowed (serial-direct) but audit failed: ${r.fails.join(' | ')}`);
  } else {
    assert.ok(hasText(r.fails, INCOMPATIBLE_RX), `matrix says forbidden (serial-direct) but audit did not fail: ${r.fails.join(' | ')}`);
  }
});

// ---------------------------------------------------------------------------------------
// Row: `ceremony: light` + `autonomy: auto-trunk` — the row #224 silently invalidated.
// ---------------------------------------------------------------------------------------

for (const col of WRITES_COLUMNS) {
  const verdict = classify(matrix['ceremony: light + autonomy: auto-trunk'][col]);
  test(`matrix row "ceremony: light + autonomy: auto-trunk" / writes: ${col} reads "${verdict}" and the audit agrees`, () => {
    const yml = baseYml(`writes: ${col}\n`, 'ceremony: light\nautonomy: auto-trunk\n');
    const r = audit(fixture(yml));
    if (verdict === 'forbidden') {
      assert.ok(hasText(r.fails, INCOMPATIBLE_RX), `matrix says forbidden but audit did not fail: ${r.fails.join(' | ')}`);
    } else {
      assert.ok(!hasText(r.fails, INCOMPATIBLE_RX), `matrix says allowed but audit failed: ${r.fails.join(' | ')}`);
    }
  });
}

test('matrix row "ceremony: light + autonomy: auto-trunk" / the legacy "serial" alias resolves to the serial-direct column', () => {
  const verdict = classify(matrix['ceremony: light + autonomy: auto-trunk']['serial-direct']);
  const yml = baseYml('writes: serial\n', 'ceremony: light\nautonomy: auto-trunk\n');
  const r = audit(fixture(yml));
  if (verdict === 'forbidden') {
    assert.ok(hasText(r.fails, INCOMPATIBLE_RX), `matrix says forbidden (serial-direct) but audit did not fail: ${r.fails.join(' | ')}`);
  } else {
    assert.ok(!hasText(r.fails, INCOMPATIBLE_RX), `matrix says allowed (serial-direct) but audit failed: ${r.fails.join(' | ')}`);
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
