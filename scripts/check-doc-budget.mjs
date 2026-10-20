#!/usr/bin/env node
// check-doc-budget — the growth brake on the normative documents (#523).
//
//   node scripts/check-doc-budget.mjs
//
// CONVENTIONS.md went from about 2,100 lines (the #159/#167 compact reissue) to 5,781 in two
// months, because each incident wrote its story into the rule it produced. A one-off compaction
// regrows; a checked budget does not (#518). Two failures, both deliberate:
//   - over budget  → move the rationale to an ADR (docs/adr/README.md); the rule keeps one
//                    sentence and a link. Never compress a rule's wording to fit.
//   - far under    → more than RATCHET_SLACK lines (thresholds.doc-budget-slack, #560) below budget: lower the budget in this file,
//                    so a saving is locked in instead of becoming room to regrow.
// Raising a budget is a reviewed edit to BUDGET with its reason in the same commit, never a
// silent bump. Runs in scripts/smoke.sh and in CI's self-check job.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("../tools/lib/yaml.js");
const { thresholdValue } = require("../tools/lib/thresholds.js");

// file -> max lines. Set from the size after #523's first pass (rounded up to the next 50);
// docs/adr/523-conventions-hard-default-and-size-budget.md records pass 1, docs/adr/539-rationale-split-phase-2.md phase 2.
export const BUDGET = {
  "CONVENTIONS.md": 3350, // −650 by #639: §5's claim records, readiness markers, the wake vocabulary and shape field, the disposition marker, the decision records and asks, the human flag and the migration grant moved verbatim to tools/docs/claims.md, readiness.md, decisions.md and grants.md (each heading left as a stub); §5 keeps readiness, holds, the decision gate, provenance and the rest, plus a nine-item claims and decisions contract — saving locked in; was 4000, −100 by #638: §4's Machine trailer, squash-subject picker, issue-close gates (checklist, remainder, --refs, corroboration, evidence-close, claim release, adoption) and the landed --ci advisory moved verbatim to tools/docs/branches.md; §4 keeps naming, commits, squash, who may touch, has-it-landed and a nine-item landing contract — saving locked in; was 4100, −350 by #637: §6's cut, finalize, candidate, channel, publishing and deploy mechanics moved verbatim to tools/docs/releases.md, Distribution and Services over npx to tools/docs/distribution.md (each heading left as a stub); §6 keeps the routes, the human-only steps and an eight-item release contract — saving locked in; was 4450, −250 by #636: §2's Solo flow and Place-claims mechanics moved verbatim to tools/docs/contention.md, each heading left as a stub; §2 keeps a four-line Contention rule — saving locked in; was 4700, −660 by #635: the CI mechanism text of §4, §5 and §7 moved verbatim to tools/docs/ (the CLI's own docs), each heading left as a stub; §7 keeps the CI contract — saving locked in; was 5360, +28 by #633: the Glossary section (one table defining each word the rules rely on, once, in neutral terms, plus its one-line pointer in the preamble) — definitions are normative, not movable rationale; why lives on the issue; was 5332, +2 by #625: §9 step 6 copies CI with its round-trip under `migration-grant: reviewer` — a rule and one link; why lives in templates/README.md *Migration round-trip — have it from the first copy*; was 5330, −5 by #630: a shared file no longer groups or serialises (§5 Readiness/Grouping); the grouping limits' rationale moved to docs/adr/630-shared-files-start-in-parallel.md and the 316 ADRs — saving locked in; was 5335, +3 by #626: §2/§4 name the `docs-only-paths` field (widens the no-CI-wait path only — a rule, rationale on the issue); was 5332, +6 by #621: §4 gains the follow-up rule of the squash-subject picker (which commit never titles a unit, and what is not one) — a rule; the measured case lives on the issue; was 5326, +39 by #610: §7 gains the integration-profiles rule section (the four-profile table, the default, the release and `live` rules, the test-tier vocabulary, revert-first, batch size) plus one-line pointers in §3 and §4 batch landing — rules; why lives in docs/adr/610-integration-profiles.md; was 5287, +10 by #607: §7 gains two rule sections (what ship reads from CI, the two lanes) — rules, not rationale, net of the §4 #570 guard bullet they retire (−16); was 5277, +7 by #609: the `needs-boss` → `needs-owner` legacy-read rule in §5 (read both, write the new, one proposal not two, the park label alike, the 14-day window) is four rules; why lives on the issue; was 5270, +7 by #604: the scope-freeze notice at the head of §5 (what is frozen, what stays, the link) is a standing rule for contributors; its full list and reasoning live in docs/adr/604-scope-freeze.md; was 5263, +37 by #606: §4's new docs-only no-CI-wait rule (four gated bullets) and §2's design-artifact exception are rules; their rationale moved to docs/adr/606-docs-only-no-ci-wait-rationale.md; was 5226, +8 by #605: batch landing step 11 (the speculative chain) is a rule — its refusals, its in-order land and its decline; why and the edge rulings live in docs/adr/605-speculative-batch-chain-rationale.md; was 5218, +3 by #602: the fork's `instruction-files: upstream` exemption is a rule (§9 step 5 + the fork section), its reading lives in project.schema.md; was 5215, +7 by #601: §7's CI-artifacts rule (heading, one sentence, the link) and the remote-call exception it adds to §7's opening; its rationale, adoption and lifecycle detail live in docs/artifact-store.md; was 5208, +8 by #596: the owner-level migration-grant precedence, its human-only setter and its proof rule are rules, not movable rationale (why-not-a-file moved to docs/adr/539-migration-rationale.md); was // #539 phase 2: 5,049 lines (from 5,580 at its base), +50 for #512's pending 28-line §4/§7 hunk; raised +100 by #569: trunk had reached 5,100 (the #512 headroom spent by later merges), #569's `shape:` rule adds 23 lines that are rules, not movable rationale, and #512's 28 still have to fit
  "project.schema.md": 1802, // +1 by #636: `contention` names `coupled` as its only field and links the §2 Contention rule it serves — a rule; was 1801, +20 by #641: the Key kinds section (one table classing every key as a fact, an owner's grant or tool tuning, and the grant rule written once) — a rule; why lives on the issue; was 1781, +1 by #625: `migration-grant` names ci-python's opt-in block and `colab template --roundtrip` (a rule; why in templates/README.md); was 1780, +15 by #630: the `contention.coupled` field (the only path-keyed start brake — a rule; why lives in docs/adr/630-shared-files-start-in-parallel.md); was 1765, +15 by #626: the `docs-only-paths` field and its finding row (a rule, rationale on the issue); was 1750, +22 by #610: the `integration-profile` / `heavy-workflow` fields and their three finding rows (rules; rationale in ADR 610); was 1728, +11 by #606: `ci-docs-skip` flipped to on-by-default with `off`, and the new `.github/secret-scan-terms` file (rules; rationale in ADR 606); was 1717, +17 by #602: the new `instruction-files` field (a rule, rationale on the issue); was 1700, #539 phase 2: 1,551 lines (from 1,704); +50 for #560's `thresholds` entry — a new field, its rationale already in the issue, no story to move to an ADR; +50 by #570: trunk was at 1,649 and the new `ci-docs-skip` field adds 15 lines of rule, its rationale already in CONVENTIONS §4
};
// The default; a repo may declare its own as `thresholds.doc-budget-slack` in .github/project.yml (#560).
export const RATCHET_SLACK = thresholdValue({}, "doc-budget-slack");

/** The slack the repo at `root` declares, else RATCHET_SLACK. A malformed value falls back to the default. */
export function slackFor(root) {
  const p = path.join(root, ".github", "project.yml");
  if (!fs.existsSync(p)) return RATCHET_SLACK;
  try { return thresholdValue(yaml.parse(fs.readFileSync(p, "utf8")) || {}, "doc-budget-slack"); } catch { return RATCHET_SLACK; }
}

export const lineCount = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

export function check({ root, budget = BUDGET, slack = slackFor(root) }) {
  const findings = [];
  const sizes = {};
  for (const [file, max] of Object.entries(budget)) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) { findings.push(`${file}: missing — remove it from BUDGET or restore it`); continue; }
    const n = lineCount(fs.readFileSync(p, "utf8"));
    sizes[file] = { lines: n, budget: max };
    if (n > max) {
      findings.push(`${file} is ${n} lines, budget ${max} — move the rationale to an ADR (docs/adr/README.md); keep the rule and one link`);
    } else if (max - n > slack) {
      findings.push(`${file} is ${n} lines, ${max - n} under its budget ${max} — lower BUDGET["${file}"] in scripts/check-doc-budget.mjs to ${Math.ceil(n / 50) * 50} so the saving holds`);
    }
  }
  return { sizes, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const { sizes, findings } = check({ root });
  console.log(`doc budget: ${Object.entries(sizes).map(([f, s]) => `${f} ${s.lines}/${s.budget}`).join(" · ")}`);
  for (const f of findings) console.log(`  ${f}`);
  process.exit(findings.length ? 1 : 0);
}
