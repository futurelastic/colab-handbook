'use strict';
// #532 — every refusal `colab` prints names the next command (CONVENTIONS.md §8, *Refusals name
// the next command*). The gate: a new remedy-less refusal fails here, and so does a known-list
// key that no longer names one, so the list in refusal-sites.known.json only ever shrinks.
const test = require('node:test');
const assert = require('node:assert');
const rs = require('./refusal-sites');

const sites = rs.scan();
const known = rs.loadKnown();
const result = rs.check(sites, known);

test('every refusal names its next command (new refusals carry a remedy)', () => {
  assert.ok(sites.length > 100, `the scan found only ${sites.length} refusal site(s) — the scanner, not the CLI, is broken`);
  assert.deepStrictEqual(result.unlisted.map((s) => `${s.file}:${s.line}  ${s.head}`), [],
    'these refusals end with no next command. Add the exact command that gets the user forward — or say ' +
    'that no command can, and who decides (CONVENTIONS.md §8). Do NOT add them to refusal-sites.known.json; ' +
    'that list only shrinks.');
});

test('the known-exception list only shrinks (no stale keys)', () => {
  assert.deepStrictEqual(result.stale, [],
    'these keys no longer name a remedy-less refusal — it was fixed, reworded or removed. Delete them from ' +
    'tools/lib/refusal-sites.known.json (`node tools/lib/refusal-sites.js --write-known` rewrites it, keeping ' +
    'the reasons already written). A reworded refusal that still has no remedy must gain one instead.');
});

test('the four refusals measured on a clean machine (#532) each name their next command', () => {
  const find = (file, re) => {
    const hit = sites.filter((s) => s.file === file && re.test(s.head));
    assert.ok(hit.length, `no refusal site in ${file} matches ${re}`);
    return hit;
  };
  // 1. #522 — adopt's exposure answer refused: the re-prompt says why, and the final refusal says how through.
  for (const s of find('tools/colab', /^exposure: no answer this repo's shape supports/)) assert.ok(s.remedy, s.key);
  for (const s of find('tools/colab', /no valid answer after one re-prompt/)) assert.ok(s.remedy, s.key);
  // 2. #525 — ship on a manual repo prints the human door's commands.
  for (const s of find('tools/colab', /does not grant auto-trunk/)) assert.ok(s.remedy, s.key);
  // 4. #528 — a claim with no session names the flag to pass.
  for (const s of find('tools/colab', /^no --session given for/)) assert.ok(s.remedy, s.key);
  // 3. #522 — adopt's topic step is a remaining-step note, not a `✗`: it says it needs admin and is optional.
  const src = require('node:fs').readFileSync(require.resolve('./adopt'), 'utf8');
  assert.match(src, /--add-topic[^\n]*ADMIN[^\n]*skip it when you are not one/);
});

test('scanner: a ✗ write with no remedy is caught; one whose next line names a command is not', () => {
  const files = { 'x.js': [
    "function a() {",
    "  print(`✗ the widget is broken — nothing was changed`);",
    "  return 1;",
    "}",
    "function b() {",
    "  process.stderr.write(`✗ the widget is held by ${who}.\\n`);",
    "  process.stderr.write('  Run `colab widget release <name>` once it is yours.\\n');",
    "  return 1;",
    "}",
    "function c() { print(`✗ ${e.message}`); return 1; }",
    "function d() { const ok = x ? '✓' : '✗'; print(`  ${ok} row`); }",
  ].join('\n') };
  const got = rs.scan({ files: ['x.js'], read: (f) => files[f] });
  assert.deepStrictEqual(got.map((s) => [s.kind, s.remedy]), [['write', false], ['write', true]],
    'relays (✗ ${e.message}) and table glyphs are not sites');
});

test('scanner: a UserError is a site; its argument is the text that must carry the remedy', () => {
  const files = { 'y.js': [
    "throw new UserError(`--net must be auto or on, got \"${v}\"`);",
    "throw new UserError('the evidence comment is empty');",
    "throw new UserError(`No repos registered — add one with: colab register [<path>]`);",
    "throw new UserError(syncProblem);",
    "throw new UserError(`could not write (${e}) — retry`);",
    "throw new UserError(`could not write (${e}) — re-run once the tracker answers`);",
    "throw new UserError(`only a human may do this — no command lowers this bar`);",
  ].join('\n') };
  const got = rs.scan({ files: ['y.js'], read: (f) => files[f] });
  assert.deepStrictEqual(got.map((s) => s.remedy), [true, false, true, false, true, true],
    'valid values · bare stop · a command · a bare retry · a named wait · no-command-and-who');
});

test('keys are text, not line numbers, and repeated texts are numbered in order', () => {
  const src = "throw new UserError('x is not a git repo');\n\n\nthrow new UserError('x is not a git repo');";
  const got = rs.scan({ files: ['z.js'], read: () => src });
  assert.deepStrictEqual(got.map((s) => s.key), ['z.js:user-error:x is not a git repo', 'z.js:user-error:x is not a git repo#2']);
});
