'use strict';
/**
 * #322 — the OTHER two environment variables, and the surface that teaches them.
 *
 * #277 made "no automated path sets COLAB_HUMAN" mechanical, and that property is duplicated in
 * ship-ci-grant.test.js and ship-migration-grant.test.js because each of those features rests on it.
 * It did not cover this file's subject on either axis:
 *
 *   WRONG VARIABLE. `COLAB_SHIP=1` has identical bypass power over the trunk-push hook, and
 *   `COLAB_PROMOTE=1` has it over `main`. Neither was tested anywhere. And neither carries
 *   COLAB_HUMAN's carve-out: COLAB_HUMAN has ONE sanctioned hand-set case (#237, solo-flow
 *   attendance — a human saying so, transcribed). These two have NONE. They are PROCESS-IDENTITY
 *   assertions — "`colab ship` ran its preconditions", "`colab promote` ran its preconditions" —
 *   set by the tool, about the tool. A hand-typed one asserts something no process performed:
 *   it skips the grade, the branch-CI check, the claim release and the evidence comment, and then
 *   pushes to trunk anyway.
 *
 *   WRONG SURFACE. Nothing needs to read `COLAB_SHIP=1` in a skill to type it — `pre-push-guard`'s
 *   own refusal used to name it, so the guard taught the bypass at the exact moment it refused.
 *   That is where both measured occurrences came from: two independent sessions, one day, one repo,
 *   neither aware it was crossing a line, one reporting it in a status summary as ordinary
 *   housekeeping. So the second half of this file scans the REFUSAL TEXT itself.
 *
 * The guard is shell, not a module, so it is scanned as text — the same call
 * `tools/lib/identity-hook.test.js` makes about the hook templates it drives.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GUARD = path.join(REPO_ROOT, 'templates', 'pre-push-guard');

const TMP = [];
process.on('exit', () => { for (const d of TMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} } });

// --- (a) the property: no skill sets a sanctioned-PATH variable, with no carve-out --------------

/** Both spellings an instruction can take — `VAR=1 cmd` and `export VAR=1`, quoted or not. */
const SETTERS = {
  COLAB_SHIP: [/COLAB_SHIP\s*=\s*1/, /COLAB_SHIP=['"]?1/],
  COLAB_PROMOTE: [/COLAB_PROMOTE\s*=\s*1/, /COLAB_PROMOTE=['"]?1/],
};

function skillFilesSetting(repoRoot, varName) {
  const skillsDir = path.join(repoRoot, 'skills');
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(md|mjs|js|sh)$/.test(name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      if (SETTERS[varName].some((re) => re.test(text))) offenders.push(p);
    }
  };
  walk(skillsDir);
  return offenders;
}

test('process-identity property: no file under skills/ sets COLAB_SHIP=1 (#322)', () => {
  const offenders = skillFilesSetting(REPO_ROOT, 'COLAB_SHIP');
  assert.deepStrictEqual(offenders, [],
    'a skill sets COLAB_SHIP=1 — that variable asserts "`colab ship` ran its preconditions", so a ' +
    'hand-set one is a false assertion that reaches a direct trunk push while skipping the grade, ' +
    `the branch-CI check, the claim release and the evidence comment: ${offenders.join(', ')}`);
});

test('process-identity property: no file under skills/ sets COLAB_PROMOTE=1 (#322)', () => {
  const offenders = skillFilesSetting(REPO_ROOT, 'COLAB_PROMOTE');
  assert.deepStrictEqual(offenders, [],
    'a skill sets COLAB_PROMOTE=1 — promotion is human on every repo, with no field able to say ' +
    `otherwise: ${offenders.join(', ')}`);
});

// Pin the boundary, not just the happy path — and pin that it has NO solo-flow carve-out, which is
// the one difference from #237's COLAB_HUMAN property that a future edit is most likely to erase.
function fakeSkillsRoot(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanctioned-path-skills-'));
  TMP.push(dir);
  fs.mkdirSync(path.join(dir, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'SKILL.md'), content);
  return dir;
}

test('COLAB_SHIP has NO solo-flow exemption — mentioning solo does not make it acceptable', () => {
  const root = fakeSkillsRoot('Solo flow is fine here. If the push is refused, COLAB_SHIP=1 git push origin main.');
  assert.strictEqual(skillFilesSetting(root, 'COLAB_SHIP').length, 1,
    'COLAB_SHIP is not a human gate, so "a human said so" cannot exempt it the way #237 exempts COLAB_HUMAN');
});

test('the export spelling is caught too — an instruction is an instruction', () => {
  const root = fakeSkillsRoot('Then `export COLAB_SHIP=1` and push.');
  assert.strictEqual(skillFilesSetting(root, 'COLAB_SHIP').length, 1);
});

test('merely NAMING the variable in prose is not an offence — this file forbids setting it, not discussing it', () => {
  const root = fakeSkillsRoot('`colab ship` sets COLAB_SHIP in its own environment; you never do.');
  assert.deepStrictEqual(skillFilesSetting(root, 'COLAB_SHIP'), []);
});

// --- (b) the surface: a refusal names the remedy, never the door -------------------------------

test('pre-push-guard: every refusal message names a `colab` command to run', () => {
  const text = fs.readFileSync(GUARD, 'utf8');
  const messages = text.split('\n').filter((l) => /^\s*echo .*>&2/.test(l));
  assert.ok(messages.length >= 3, `expected the three guards to speak; found ${messages.length} lines`);
  const spoken = messages.join('\n');
  assert.match(spoken, /colab ship/);
  assert.match(spoken, /colab promote/);
});

test('pre-push-guard: NO refusal message names an environment variable — the guard must not teach its own bypass (#322)', () => {
  const text = fs.readFileSync(GUARD, 'utf8');
  // Only the lines the hook actually PRINTS. The file's header comment documents the variables on
  // purpose: a person looks that up deliberately, and an agent reading an error message does not.
  const offenders = text.split('\n')
    .filter((l) => /^\s*echo .*>&2/.test(l))
    .filter((l) => /COLAB_(SHIP|HUMAN|PROMOTE)/.test(l));
  assert.deepStrictEqual(offenders, [],
    'a pre-push-guard refusal names the variable that defeats it. Two sessions typed exactly what ' +
    `this message told them, one day apart, neither having read it in a skill:\n${offenders.join('\n')}`);
});

test('pre-push-guard: the trunk refusal also says what to do about a commit ALREADY on trunk', () => {
  // The measured corner (#322): the session was refused while holding a hand-made trunk commit, and
  // `colab ship` merges a BRANCH — so "use colab ship" alone answers a question it was not asked,
  // and the only remaining idea was the variable. The way out has to be spelled here.
  const text = fs.readFileSync(GUARD, 'utf8');
  const spoken = text.split('\n').filter((l) => /^\s*echo .*>&2/.test(l)).join('\n');
  assert.match(spoken, /branch <type>\/<slug>-<issue>/);
  assert.match(spoken, /reset --hard origin/);
});
