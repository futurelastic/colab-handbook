# Rule inventory — CONVENTIONS.md + project.schema.md

One row per rule in the two normative documents, each with a verbatim key phrase, so that a
rule cannot leave either document without a check failing. Rebuilt by #523 against trunk
`e01b9e27` (CONVENTIONS.md 5,895 lines, project.schema.md 1,704). It supersedes the #160
find-only snapshot (430 rows against a 2,055 + 532 line document at `4b46c08`, still in git
history), which served as each section's checklist.

**Checked, not just written.** `node scripts/check-rule-inventory.mjs` runs in
`scripts/smoke.sh` and in CI. It fails when:

- a row's key is no longer found in the file its `dest` names — the rule was reworded, moved
  or dropped. Update the row in the same commit as the edit, or restore the rule;
- a `hard` or `default` row's `dest` is not `CONVENTIONS.md` or `project.schema.md`. Only an
  `explanation` may move to `docs/adr/` or `docs/gotchas.d/`;
- a `hard` row's key is not inside a unit carrying the `**[Hard — gate: …]**` marker, or one
  of its gate literals is no longer in the named file — the rule may no longer be gated;
- a marker in either document holds no `hard` row's key.

A new rule needs a new row, and a new hard rule needs its marker too. The checker cannot see
a rule nobody added a row for; review still has to.

## Columns

- **id** — stable identity, never renumbered or reused: `C<§>.<subsection>.<nn>` for
  CONVENTIONS.md, `S1.`/`S2.` for project.schema.md. A prefix letter after the section number
  (`C2x.`, `C5a.`) only splits one long section between inventory passes.
- **class** — what [CONVENTIONS.md](../CONVENTIONS.md#hard-rules-and-defaults) means by it:
  - `hard` — a `colab` refusal or a git hook enforces it. Marked in the text; names its gate.
  - `default` — every other obligation: one way to do it, which a repo may refine in its
    local policy. The wording keeps its modal verb; "default" says where the rule can be
    refined, not that it is optional.
  - `explanation` — rationale. Listed only where it was moved out of the normative text, so
    the row records where it went.
- **gate** — hard rows only: `<file>::<literal>`, several joined by ` ; `. A literal rather
  than a line number, so the check does not drift with every edit to the gate's file.
- **rule** — a one-sentence paraphrase, for reading. Not checked.
- **key** — a verbatim phrase from the rule's text. Compared after collapsing whitespace and
  dropping `*` emphasis; `\|` in a cell is a literal pipe.
- **dest** — the file the rule (or moved explanation) lives in now.
- **source** — the issue the text cites for it, or `—`.

## The #160 kinds, re-read

#160 typed rows `hard rule` / `default` / `advisory` / `explanation`, where "hard rule"
meant "no exception without a separate human-only door". #518 ruled that a rule is hard only
when a gate enforces it. So most of #160's hard rules are `default` here. Their text is
unchanged: a `must` stays a `must`. What changed is the claim about enforcement, which is now
true. `advisory` rows are `default`.

## Move check

`node scripts/check-doc-move.mjs --base e01b9e27 --allow docs/rule-inventory.md` proves that
every unit of both documents at the base (paragraph, list item, table row, fence, heading) is
still present, verbatim, in the documents or in `docs/adr/` / `docs/gotchas.d/`, and that
every heading is still in its own file. Result for #523's pass:

```
CONVENTIONS.md @ e01b9e27: units 1179 · found whole 1106 · by sentence 72 · now 5516 lines
project.schema.md @ e01b9e27: units 414 · found whole 414 · by sentence 0 · now 1704 lines
missing 0 · headings gone from their file 0 · ledger entries 1 (stale 0)
```

Result for #539's phase 2 (base `bc1100ea`, after #523's pass had landed), run as
`node scripts/check-doc-move.mjs --base bc1100ea --allow docs/rule-inventory.md`:

```
CONVENTIONS.md @ bc1100ea: units 1202 · found whole 965 · by sentence 134 · now 5049 lines
project.schema.md @ bc1100ea: units 414 · found whole 359 · by sentence 29 · now 1551 lines
missing 0 · headings gone from their file 0 · ledger entries 129 (stale 0)
```

Phase 2 split rationale off rule sentences under the ruling on #539 (option A): the rule half
keeps its meaning and modal verb, the rationale moves verbatim to `docs/adr/539-*.md`, and each
reworded unit the check could not find by itself is listed in a `#539 ledger` block after its
section's table. A reword that kept every part verbatim (a sentence boundary already existed)
needs no ledger entry; the check finds it by sentence. The rows whose checked columns changed,
before → after:

| id | column | before | after |
|---|---|---|---|
| C2.tiers.11 | key | Name the release branch in | name that branch in |
| C2.tiers.12 | key | Tier C exists because a tag ritual nobody honours is worse than no tag ritual | C describes that shape honestly |
| C2.room.02 | key | Issue language has been derived from repo privacy | Issue language follows the room, not repo privacy |
| C2.exposure.06 | dest | CONVENTIONS.md | docs/adr/539-room-exposure-rationale.md |
| C2x.branch.07 | key | so no such rule exists, and none should be added later | none should be added later |
| C4.s4.29 | key | original rule still holds exactly as before: **report it, never clean it.** The | original rule still holds exactly as before: **report it, never clean it.** |
| C4.s4.53 | key | A ship releases every claim it carried (#319)** — not only the worktree's. A claim with | A ship releases every claim it carried (#319)** — not only the worktree's. |
| C5b.da.03 | key | In the body, never only in a comment. A reader finds it with one | In the body, never only in a comment. |
| C5b.me.02 | key | A declaration only ever widens what the gate sees, never narrows it; | A declaration only ever widens what the gate sees, never narrows it. |
| C5b.me.49 | key | a branch that edits `.github/workflows/` cannot pass it either, | a branch that edits `.github/workflows/` cannot pass it either. |
| C5b.rt.05 | key | It is the only re-run actor for a red trunk: | It is the only re-run actor for a red trunk |
| C5b.re.18 | key | Trunk-only — an integration line's red already | or `colab promote`. Trunk-only — |
| C5c.cure.13 | key | at any depth counts (the template's working directory is an adopter's edit point | at any depth counts |
| C5c.cure.16 | key | is never admitted — it runs inside a step that already exists | is never admitted |
| C5c.cure.27 | key | So a workflow-touching branch may still cure when, on top of 1-3 | A workflow-touching branch may still cure when, on top of 1-3 |
| C5c.drivers.03 | key | `epic`-labelled issues are excluded — an epic can pass provenance cleanly | `epic`-labelled issues are excluded. |
| C5c.drivers.04 | key | `needs-decision` issues are excluded, for a third distinct reason | even if the work item itself is human-filed |
| C5c.drivers.22 | key | So its jobs run on the self-hosted label the repo's CI already uses | Its jobs run on the self-hosted label the repo's CI already uses |
| C5c.epics.21 | key | an epic never carries `needs-decision`, and never a `decision:options` block | An epic never carries `needs-decision`, and never a `decision:options` block |
| C5c.delivery.08 | key | is in the provisioned label set because every adopting repo needs all six | `delivery:*` is in the provisioned label set. |
| C5c.delivery.18 | key | It routes for the same reason `content`/`ops` do | It routes as `content`/`ops` do |
| C5c.priority.09 | key | is in the provisioned label set for the same reason | `low-priority` is in the provisioned label set. |
| C5c.conclusion.07 | key | It fetches before it enumerates, and that is part of the check, not a convenience | It fetches before it enumerates. |
| C6.rel.111 | key | A moving tag is refused by every clone that already fetched it | They are branches, not tags. |
| C9.first-time.09 | key | the person answering is standing in the repo, not reading a schema, | Question 3 is phrased this way |
| S1.trunk.12 | key | This holds for hand-deployed Tier A repos too (`deploy: manual`) | holds for hand-deployed Tier A repos too (`deploy: manual`) |
| S1.trunk.13 | key | Tier C keeps the identical split for the identical reason, whatever its trunk | Tier C keeps the identical split |
| S2.channels.15 | dest | project.schema.md | docs/adr/539-schema-exposure-and-channels-rationale.md |
| S2.writes.15 | key | No coherence rule is audited against `tier`/`production` for this | No coherence rule is audited against `tier`/`production` |
| S2.release.22 | key | It is not optional: a publish with no gate is the stray-local-file | It is not optional |
| S2.live-env.07 | dest | project.schema.md | docs/adr/539-schema-checks-and-gates-rationale.md |

## Reframe ledger

The reframe around `exposure` added a lead paragraph to §2 (new text, so nothing to excuse;
rows C2.frame.01–03) and rewrote the one unit below. It was the only unit #523's move check
(base `e01b9e27`) excused, and it names the rows that carry its rules now. Against #539's base
`bc1100ea` the fence is already in its reframed form, so the entry is kept as history in plain
text and no longer excuses anything.

- CONVENTIONS.md line 5863 at `e01b9e27` — the §11 quick-reference fence. Its releasing comment now reads
  `exposure: released (legacy tier A; …)` instead of `Tier A / exposure: released (…)`;
  every command line in the fence is unchanged. Rows: C11.quick.08, C11.quick.09.

### #539 ledger — coordinator review fixes

A read-only review of the merged slices looked for a rule that left with its rationale, or a
sentence whose referent moved. Each fix below restores the minimal rule clause; no rationale
came back.

- `CONVENTIONS.md:163` — before: "Name the release branch in `releaseBranch:`." (after the slice A cut, the sentence that introduced the release branch had moved) → after: "Where a release script fast-forwards a long-lived release branch that an external poller watches, name that branch in `releaseBranch:`." The condition is restored so the duty does not widen to every tag-gated single-trunk repo. Rows: C2.tiers.11 (key updated).
- `CONVENTIONS.md:526` — before: "Why the premise was wrong in both halves" (the premise had moved to ADR 233's side) → after: "Why the original proposal (loosen `colab solo`'s entry gate so direct writers could share the trunk checkout) was wrong in both halves". Pointer only; none keyed.
- `CONVENTIONS.md:1474` — before: "the shipper's call, for the same reason the gate does not file the remainder issue" (the reason had moved) → after: "the shipper's call, never the tool's — the gate does not file the remainder issue either". None keyed.
- §2 Exposure, the bold lead "What this unit (#132) shipped, and what #144 later added." → "What later units added (what #132 and #144 shipped: ADR 539)." The #132/#144 account had moved; the lead now names what follows it. None keyed.
- `CONVENTIONS.md:3175` — slice D's entry above cut the whole tail after "**Trunk-only**". The first clause is a rule (how an integration line's red is judged with no runs of its own), so it is restored: after: "**Trunk-only** — an integration line's red borrows trunk's advisory verdict when the line has no runs of its own; the exemption does not extend to lines." The "deliberately unmade decision" wording stays in the ADR. Rows: C5b.re.18 (key updated).
- `CONVENTIONS.md:2329` — the slice C cut took "deleting the edge once code is written" with the declined alternatives, but it is the rule that reversed the older "remove the now-false edge". After: "…never recorded as a second label, and the `blocked_by` edge is never deleted once the blocker's code is written." Rows: C5a.boolean.07 (key unchanged).
- `CONVENTIONS.md:3408` — the cut left "for the same reason `needs-decision` is" (a later bullet) without its reason. After: "`needs-decision` issues are excluded — no human has answered the blocking question — even if the work item itself is human-filed,". Rows: C5c.drivers.04 (key updated).
- `project.schema.md:126` — "This holds for hand-deployed Tier A repos too" lost its referent when the slice G cut moved the two-branch description; after: "The two-branch split (`dev` → `main`) holds for hand-deployed Tier A repos too (`deploy: manual`)." None keyed.
- project.schema.md line 1229 (base; the restored sentence makes the unit found by the move check again) — the #443 rule "the newest candidate always names trunk's head" had moved with its measurement; restored ahead of "So any value narrows." None keyed.
- project.schema.md line 652 (base; the restored sentence makes the unit found by the move check again) — `room`: the rule contrasts (Issue language no longer derived from repo privacy, `ceremony` no longer the audit-trail proxy) restored as "It replaces both earlier proxies: …"; the "by coincidence" rationale stays in the ADR. None keyed.
- CONVENTIONS.md line 4322 (base; the restored sentence makes the unit found by the move check again) — the container-deploy descriptor mapping ("the existing `deploy: tag` shape with an in-repo deploy workflow (`channels: [workflow]`)") restored; "so no rule changes; the template is what was missing" stays in the ADR. None keyed.
- `CONVENTIONS.md:5522` — anti-pattern "Now a finding." names its combination again: "(`tier: A`/`exposure: released` with `deploy: push-main`)". None keyed.
- project.schema.md `writes` — a blank line restored after list item 1, so the "Reclassifying an EXISTING repo's descriptor" paragraph no longer renders inside it (the struck-through item 2 between them had moved).
- §2 Room — the slice A move took the contrast "Issue language follows the room, not repo privacy" with its rationale; restored as a rule sentence. Rows: C2.room.02 (key updated).

### #539 ledger — follow-ups (#544)

The ship grade of #539 found no violation of the ruling's limits, but listed loose ends. Each is
settled here: restored as a minimal clause, or recorded as redundant with the reason.

- `CONVENTIONS.md:2626` — "Fails towards `human`, always": the closing "for the same reason" pointed at a reason that had already moved to the ADR (before #539). After: "…the posture *Readiness* (above) takes towards `ready`." The reason stays in ADR 539. None keyed.
- `CONVENTIONS.md:3939` — conclusion step 2: the scope clause "not a typo exempt from ceremony" left with the rationale sentence. Restored as a minimal clause: "…wrapped normally — never under a typo fix's exemption from ceremony." The "*most* consequential kind of doc change" reasoning stays in ADR 539. None keyed.
- CONVENTIONS.md line 5122 (base; found by sentence, so it excuses nothing in the check) — "Land the descriptor on trunk in the same human act (#481)": the "On a freshly adopted repo" scope now lives only in ADR 539. **Redundant, not restored:** the paragraph is a step in §9's first-time adoption list and describes `colab adopt --land`, so its scope is the adoption it sits in; restoring the phrase would add nothing a reader of that step lacks. None keyed.
- CONVENTIONS.md line 5184 (base; found by sentence) — the label-set step lost "`migration-granted`/`ci-granted` are **not opt-in** (unlike `tracking`)". **Redundant, not restored:** the step reads "Create the whole label set — twenty-three names, not a subset" and lists both labels by name, so neither can be read as optional. None keyed.
- Inventory rows not trimmed like the doc (limit 2): C2.tiers.11's rule column now carries the release-script/external-poller condition the doc restored; C5c.delivery.08, C5c.delivery.18 and C5c.priority.09 drop the *because…* / *for the same reason…* clauses that moved to the ADR. Key columns unchanged.
- #543, same pass: §5 *Planning* no longer names a model. C5c.planning.15 now states `code-plan`'s two-path contract (a helper agent where the engine has one, otherwise the session itself, recording `drafted-by: self`). Key unchanged.

### #568 ledger — clauses #567 and #547 left for after #512

Two units reworded on purpose (base `c56bac20`), each to carry one new clause inside the line budget:

- `CONVENTIONS.md:1386` — §4 trunk-CI gate: the #503 set-aside now ends "— except a dispatch of the push- or PR-triggered CI workflow with no push run at the sha (#567: a lost push event)"; the "four green candidates parked ~30 min" measurement, already in ADR 539, became a Why link; the #463 filter story moved to ADR 539 behind a Why link; "in `project.yml`" dropped from the override sentence. Rows: C4.s4.62 (key updated), C4.s4.67 (new).
- `CONVENTIONS.md:3200` — §6 *Scheduled drivers*: the `release-auto.yml` paragraph gains "an hourly run re-tries only a refused cut, once the fetched colab CLI has moved (#547)" and is re-wrapped. Rows: C5c.drivers.34 (new).

---

### 1. Hard rules and defaults (added by #523)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C1.hard.01 | default | | A rule is hard only when a gate enforces it, and a hard rule opens with a marker naming what refuses. | A rule is hard only when a gate enforces it. | CONVENTIONS.md | #518 |
| C1.hard.02 | default | | Every unmarked rule is a default, refinable through a `project.yml` field or the repo's local policy. | which a repo may refine through a `project.yml` field where one exists | CONVENTIONS.md | #518 |
| C1.hard.03 | default | | A local-policy refinement never lowers a hard rule. | A refinement never lowers a hard rule. | CONVENTIONS.md | #520 |
| C1.hard.04 | default | | An unrefined default stands as written: a "must" is still a "must". | Until a repo refines a default, its wording stands as written | CONVENTIONS.md | #523 |
| C1.hard.05 | default | | Every rule's class and each hard rule's gate literal are listed in the rule inventory, kept in step by its check. | keeps the list and this file in step | CONVENTIONS.md | #523 |

### 2. Reading §2 through exposure (added by #523)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2.frame.01 | default | | Read §2 through `exposure`: what consumes a merge sets the gate count — `none`/`self` 0, `live` 1, `released` 2. | What consumes a merge sets the gate count | CONVENTIONS.md | #144 |
| C2.frame.02 | default | | `tier:` is a legacy read of exposure: `A` → `released`, `C` → `live`, `B` → no derivable value. | `tier:` is a legacy read of it | CONVENTIONS.md | #144 |
| C2.frame.03 | default | | A bare `B` is never renamed to an exposure value without asking what consumes the repo. | a bare `B` cannot be renamed to an exposure value | CONVENTIONS.md | #523 |


### Preamble

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C1.preamble.01 | default | | Agents starting a session read CONVENTIONS.md and the repo's `.github/project.yml` before touching anything. | read this file and the repo's `.github/project.yml` before touching anything | CONVENTIONS.md | — |
| C1.preamble.02 | default | | The handbook decides outcomes, not implementations; a command shown illustrates a rule and is not a tool to adopt. | It never tells you which Node version to build with | CONVENTIONS.md | — |
| C1.preamble.03 | default | | Conformance is checked from outside by the audit tool and otherwise rests on habit; nothing is enforced by GitHub settings. | Conformance is checked *from outside* by the audit tool | CONVENTIONS.md | — |

### 1. The model in one picture

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C1.model.01 | default | | Every rule exists as a substitute for shared context between parties that cannot accumulate it. | Every rule exists because one party | CONVENTIONS.md | — |
| C1.model.02 | default | | Anything guarding against agent failure must be machine-checked, a rail for an agent where a human gets a reminder. | anything guarding against agent failure has to be machine-checked | CONVENTIONS.md | — |
| C1.model.03 | default | | A new axis is warranted only when a class of context one party cannot hold is not made visible by an existing axis. | A new axis is warranted when a class of context one party structurally cannot hold | CONVENTIONS.md | — |
| C1.model.04 | default | | A repo's model follows two questions: does it deploy to production, and if so what gates that deploy. | does it deploy to production, and if so, what gates that deploy | CONVENTIONS.md | — |
| C1.model.05 | default | | Count the gates between a merge and users: B none, C one (the promotion), A two (promotion, then tag). | Count the gates between a merge and users | CONVENTIONS.md | — |
| C1.model.06 | default | | Tier B is the default; a repo stays there until something actually consumes a release, and no `dev` is created to be ready. | A repo starts here and stays here until something actually consumes a release | CONVENTIONS.md | — |
| C1.model.07 | default | | Do not create `dev` "to be ready". | Do not create `dev` "to be ready" | CONVENTIONS.md | — |
| C1.model.08 | default | | If the test suite is fast Tier A is unnecessary; write the suite first, then split. | If your test suite is fast, you do not need Tier A | CONVENTIONS.md | — |
| C1.model.09 | explanation | | Tier A `main` is a pure release branch so the expensive suite runs at promotion time, keeping sessions fast. | `main` in Tier A is a **pure release branch** | CONVENTIONS.md | — |

### 2. Tiers

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2.tiers.01 | default | | The tier table fixes per tier: production, gate count, trunk, release branch, CI, tags and deploy trigger. | Gates between merge and users | CONVENTIONS.md | — |
| C2.tiers.02 | default | | A tag-gated Tier A (`deploy: tag`) may collapse the split and run a single trunk `main`. | may collapse the split and run a single trunk | CONVENTIONS.md | — |
| C2.tiers.03 | default | | Tier C's trunk is a declared setting, a branch distinct from `main`; `dev` is the default and another name conforms. | Tier C's trunk is a **declared setting, not a fixed spelling** | CONVENTIONS.md | #205 |
| C2.tiers.04 | default | | A, B and C are labels, not grades; claim the tier that is true and never upgrade a repo's tier to be helpful. | Never "upgrade" a repo's tier to | CONVENTIONS.md | — |
| C2.tiers.05 | default | | The first tier question is whether a production target exists today, not whether deploying is automated; an imminent launch is still B. | The first question is "is there a production target *today*? | CONVENTIONS.md | — |
| C2.tiers.06 | default | | With production, the second question decides: a deliberate release artifact gates it (A), or the promotion itself ships (C). | does a deliberate release artifact gate production (A), or does the promotion itself ship (C) | CONVENTIONS.md | — |
| C2.tiers.07 | default | | A live repo that ships by hand is Tier A with `deploy: manual`, naming its procedure in `runbook:`; never force it to Tier B. | is Tier A with `deploy: manual`, naming its procedure in `runbook:` | CONVENTIONS.md | — |
| C2.tiers.08 | explanation | | Hand-deployed Tier A keeps two branches: `main` is what runs on the host, `dev` is where sessions land. | Hand-deployed Tier A keeps the two branches because they earn their keep | CONVENTIONS.md | — |
| C2.tiers.09 | default | | A tag-gated Tier A may run a single trunk `main`; the tier is set by the promotion gate, never by trunk name or deploy location. | A tag-gated Tier A may instead run a single trunk `main`. | CONVENTIONS.md | — |
| C2.tiers.10 | default | | Where the deploy runs outside CI, commit the path to production as `runbook:`. | the path to production must be committed as | CONVENTIONS.md | — |
| C2.tiers.11 | default | | Where a release script fast-forwards a long-lived release branch that an external poller watches, name that branch in `releaseBranch:`. | name that branch in | CONVENTIONS.md | #63 |
| C2.tiers.12 | default | | Tier C describes a live low-stakes site: `deploy: push-main`, `main` is live, the promotion is the one decision to ship. | C describes that shape honestly | CONVENTIONS.md | — |
| C2.tiers.13 | default | | Deploying off a `main` push meets Tier C's contract; `tier: A` + `push-main` is a finding, usually fixed by retiering to C. | So `tier: A` + `push-main` is a finding | CONVENTIONS.md | — |
| C2.tiers.14 | default | | Migrating to `deploy: tag`, or declaring `deploy: manual` + `runbook:`, remain valid alternatives when earned. | remain valid alternatives when the site has genuinely earned them | CONVENTIONS.md | — |
| C2.tiers.15 | default | | "Trunk" is a role, read from `project.yml`'s `trunk:`: a single default branch in Tier B, distinct from `main` in Tier C, `dev` or tag-gated `main` in Tier A. | the branch sessions merge into, declared in | CONVENTIONS.md | #522 |
| C2.tiers.16 | default | | "Any name is legal" is not licensed: Tier A's value stays fixed outside the tag-gated exception and Tier B's single trunk never sits beside a `main`; never rename a default branch to satisfy a spelling. | "Any name is legal" is not what this licenses | CONVENTIONS.md | — |
| C2.tiers.17 | hard | tools/lib/records.js::is a ROLE, not a branch name ; tools/colab::const bp = records.branchProblem(branch) | Never create a branch named `trunk` and never record the word as a branch; the absence of a branch is null. | Never create a branch literally named `trunk` — and never *record* the word either | CONVENTIONS.md | — |
| C2.tiers.18 | default | | A tool storing a branch should refuse the word `trunk` on write and treat "no claimed issues" as suspicious, not routine. | A tool storing this should refuse the word on write | CONVENTIONS.md | — |
| C2.tiers.19 | hard | tools/colab::it is a declared integration line (project.yml integration:) | A declared integration line never gets a path to production; tooling refuses to ship it into trunk, so merging it is a human act. | tooling refuses to perform that merge | CONVENTIONS.md | — |
| C2.tiers.20 | default | | A repo may declare additional long-lived lines in `integration:`; sessions may cut from one and ship back into it, guarded as trunk is. | Sessions may cut from a declared line and ship back into it, guarded exactly as trunk is | CONVENTIONS.md | — |
| C2.tiers.21 | default | | `trunk:` answers the correctness consumers (worktree classification, landed/delete-safety, cut-from base) with one shared value. | which must keep reading one shared value | CONVENTIONS.md | — |
| C2.tiers.22 | default | | The per-host "which line does this checkout serve" question gets no descriptor field on any tier. | Group B gets no descriptor field, on any tier | CONVENTIONS.md | — |
| C2.tiers.23 | default | | A per-host mechanism must name a branch, be unset by default, and never widen or disable the gate it overrides. | must **name** a branch, unset-by-default, never widen or disable the gate it overrides | CONVENTIONS.md | — |
| C2.tiers.24 | default | | A repo on N hosts with N lines stays one repo and one descriptor, never N descriptors or a second `trunk:`/`integration:` entry. | A repo on N hosts with N lines stays one repo, one descriptor | CONVENTIONS.md | — |

### 2. Tiers — Room

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2.room.01 | default | | `room` is an optional axis naming who could read what a session writes: `solo`, `team` or `public`; it decides what an Issue is for, its language, and whether a human release names a role. | names who could ever read | CONVENTIONS.md | — |
| C2.room.02 | default | | Issue language follows the room, not repo privacy, and `ceremony` follows the room rather than production status. | Issue language follows the room, not repo privacy | CONVENTIONS.md | — |
| C2.room.03 | default | | State the function of claim discipline, not the etiquette gloss: it stops two of one person's own sessions editing the same file. | so state the function, not the etiquette gloss on it | CONVENTIONS.md | — |
| C2.room.04 | default | | `room` is a declared fact a human writes down; no audit check reads it and no tool infers it from visibility. | `room` is a declared fact a human writes down | CONVENTIONS.md | — |

### 2. Tiers — Exposure

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2.exposure.01 | default | | `exposure` names what consumes a merge: `none`, `self`, `live` or `released`, lowercase relationship words. | names what actually consumes a merge to | CONVENTIONS.md | #132 |
| C2.exposure.02 | default | | `self` is bounded by the room: the consumer set is a subset of the room's collaborators. | the consumer set is a subset of the room's collaborator set | CONVENTIONS.md | #132 |
| C2.exposure.03 | default | | Gate count derives from `exposure` when declared (`none` 0, `self` 0, `live` 1, `released` 2); a bare `tier` is read as legacy `A → released`, `C → live`, `B → null`. | `exposure`, when declared, is the axis of record outright | CONVENTIONS.md | #144 |
| C2.exposure.04 | default | | Declaring neither `exposure` nor `tier` is the one hard failure ("no axis of record"). | Declaring **neither** key is now | CONVENTIONS.md | #144 |
| C2.exposure.05 | default | | `exposure` is not required by the authority flip; requiring it is a later phase. | `exposure` does **not** become required by this flip | CONVENTIONS.md | #144 |
| C2.exposure.06 | explanation | | `prelaunch` was rejected for a relationship word; "not yet, but headed there" lives in `production:`. | `prelaunch` was rejected in favour of a relationship word | docs/adr/539-room-exposure-rationale.md | — |
| C2.exposure.07 | default | | The old-to-new mapping is code: `tier: A` is `released`, `tier: C` is `live`, and `tier: B` maps to nothing, so no rule may conclude a `B` repo's exposure. | so no rule may ever conclude a `B` repo's exposure value | CONVENTIONS.md | #144 |
| C2.exposure.08 | default | | When both `tier` and `exposure` are declared and disagree on gate count that is exactly one finding; a bare `B` contradicts nothing. | When BOTH keys are declared and disagree | CONVENTIONS.md | #144 |
| C2.exposure.09 | hard | tools/lib/adopt.js::lowering exposure from | Lowering a repo's exposure is a human act; the audit assigns no default and omission reports undeclared, never `none`. | Lowering a repo's exposure is a human act, with no field that can override it | CONVENTIONS.md | — |
| C2.exposure.10 | default | | An agent may find and report evidence of a consumer but never write down that none exists. | it may never write down that none exists | CONVENTIONS.md | — |
| C2.exposure.11 | default | | `exposure: none` with `production: null` gets a `warn` advisory, never `fail`; every other combination is clean. | gets an advisory, at `warn`, never `fail` | CONVENTIONS.md | #132 |
| C2.exposure.12 | default | | Nothing derives `exposure` from `tier` by inference; comparing two declared values is detection, not inference. | nothing derives `exposure` from `tier`, ever | CONVENTIONS.md | #144 |
| C2.exposure.13 | default | | Falsifiers against `exposure: none` (a version-shaped tag, a committed deploy path) are `warn` naming the evidence, never `fail`; `self` has none. | each a `warn` naming the evidence, never a `fail` | CONVENTIONS.md | #137 |
| C2.exposure.14 | default | | `colab adopt` asks, derives and writes exposure in one act, gated on a human for `none`, `self` and lowering. | gated on a human for the `none`/`self`/lowering direction | CONVENTIONS.md | #199 |

### 2. Tiers — Ceremony

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2.ceremony.01 | default | | `ceremony: light` thins Issue narration and skips Phase B evidence comments, never the rails (claim discipline, worktree isolation, reserved ports, squash + `Closes #N`, CI secret scan, core-path PR pause). | never the rails that protect | CONVENTIONS.md | — |
| C2.ceremony.02 | default | | Narration follows the room; recoverability follows exposure and irreplaceable state. | **narration** — Issue prose, progress comments, Phase B evidence | CONVENTIONS.md | — |
| C2.ceremony.03 | default | | `ceremony` reduces narration only, gated on the room, and never waives the recoverability record a live repo needs. | it may not skip the record required to undo a change | CONVENTIONS.md | — |
| C2.ceremony.04 | hard | tools/lib/adopt.js::autonomy: auto-trunk is refused alongside ceremony: light | `light` may not combine with `autonomy: auto-trunk`. | `light` may not combine with `autonomy: auto-trunk` | CONVENTIONS.md | — |

### 2. Tiers — Recovery

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2.recovery.01 | default | | Prevention and recovery are alternatives chosen by whether the unit has a branch; a trunk-direct commit with no branch gets recovery as its only instrument. | Prevention and recovery are alternatives | CONVENTIONS.md | #233 |
| C2.recovery.02 | default | | The recovery obligation follows exposure: `none` amend/reset, `self` rebuild and redeploy, `live` revert then promote, `released` new version plus advisory. | The obligation follows | CONVENTIONS.md | — |
| C2.recovery.03 | default | | `released` is the strictest cell: a tag cannot be un-tagged or un-pulled, so catching it before it lands is the only defense. | By the time a bad commit reaches | CONVENTIONS.md | — |

### 3. `.github/project.yml` — the marker

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C3.marker.01 | default | | Every repo commits `.github/project.yml`, readable with no guessing or API call and with no GitHub remote. | Every repo commits this file | CONVENTIONS.md | — |
| C3.marker.02 | default | | `deploy` says how the repo reaches production, never whether production exists. | never **whether** production exists | CONVENTIONS.md | — |
| C3.marker.03 | default | | `deploy: manual` requires `runbook: <path>` naming the documented procedure, and the audit checks the file exists. | it requires `runbook: <path>` naming | CONVENTIONS.md | — |
| C3.marker.04 | default | | `stack` is a free-form string, not a closed list. | `stack` is a **free-form string**, not a fixed list | CONVENTIONS.md | — |
| C3.marker.05 | default | | Optional toolchain keys may be added; a long-lived line is declared in `integration:`; `ceremony`, `channels`, `room`, `exposure`, `writes` and `ship-batch` are optional and read as undeclared when absent, and `exposure` never defaults to `none`. | each optional, each read as undeclared rather than defaulted when absent | CONVENTIONS.md | — |
| C3.marker.06 | default | | Mirror the tier as a GitHub topic (`tier-a`/`tier-b`/`tier-c`); the file is the source of truth. | Mirror the tier as a GitHub **topic** | CONVENTIONS.md | — |

### 3. Boot recipe

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C3.boot.01 | default | | If `<repo>/.colab/dev` exists and is executable it starts the trunk dev server: no arguments, foreground, exits when the server stops. | if `<repo>/.colab/dev` exists | CONVENTIONS.md | — |
| C3.boot.02 | default | | Absent `.colab/dev`, a caller falls back to its own ecosystem default; the recipe lives beside the code, not in the schema. | Absent it, a caller falls back to its own ecosystem default | CONVENTIONS.md | — |
| C3.boot.03 | default | | Verify a start by the declared port accepting a connection, never by the process manager's exit code. | A start is verified by the declared port accepting a connection | CONVENTIONS.md | — |

### 10. Anti-patterns

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C10.anti.01 | default | | A branch with no pipeline hanging off it decays into noise; Tier B is the default and going live starts with adding the deploy workflow. | A branch with no pipeline hanging off it decays into noise | CONVENTIONS.md | — |
| C10.anti.02 | default | | Three tiers without automated promotion is a tax on every hotfix; use two. | Three tiers without automated promotion is a tax on every hotfix | CONVENTIONS.md | — |
| C10.anti.03 | default | | Do not copy CI that encodes intentions nobody adopted. | Copy-pasted CI encodes intentions nobody adopted | CONVENTIONS.md | — |
| C10.anti.04 | default | | Do not claim a gate you do not have; a tier claiming a release gate while deploying on `main` push is a finding. | claiming a gate you do not have is not | CONVENTIONS.md | — |
| C10.anti.05 | default | | Docs must describe the repo as it is; an aspirational doc is worse than none. | An aspirational doc is worse than no doc | CONVENTIONS.md | — |
| C10.anti.06 | default | | Reference config by name, not by copy, so branch references do not drift. | Config drifts silently when copied rather than referenced | CONVENTIONS.md | — |
| C10.anti.07 | default | | A decision goes on an Issue before any file is touched; work only agreed in a room is undocumented once it closes. | Work only agreed to in a room is undocumented the moment the room closes | CONVENTIONS.md | — |
| C10.anti.08 | default | | A silent version default hides behind green CI (see §7). | the bug was invisible because CI was green the whole time | CONVENTIONS.md | — |

### 11. Quick reference

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C11.quick.01 | default | | Start by listing taken issues and claiming with `gh issue edit N --add-assignee @me --add-label in-progress`. | gh issue edit N --add-assignee @me --add-label in-progress | CONVENTIONS.md | — |
| C11.quick.02 | default | | Leave `agent-filed`, `epic`, `delivery:*` and `deferred:*` issues alone: a human approves, a container is never a start, non-code work is routed, parked work names a wake condition. | a container for sub-issues — never a start candidate | CONVENTIONS.md | — |
| C11.quick.03 | default | | Issues under one `group:<key>` label share one branch and start together. | must share one branch — start them together | CONVENTIONS.md | — |
| C11.quick.04 | default | | Cut the branch from a fresh `origin/<trunk>`, never local trunk; the `<login>/<machine>/` prefix only under `branchPrefix: machine`. | cut from a FRESH origin/<trunk>, never local trunk | CONVENTIONS.md | — |
| C11.quick.05 | default | | Before editing an existing file run `colab holders <path>`, which refuses to answer "clean ground" if it could not fetch. | REFUSES (exit 2) to answer | CONVENTIONS.md | — |
| C11.quick.06 | default | | Finish with `colab landed --worktree <name>`: landed means teardown, cargo means merge. | landed → teardown, cargo → merge | CONVENTIONS.md | — |
| C11.quick.07 | default | | Release both halves of a claim; a lone half is a half-claim, and `<claimer>` is `@me` only if you claimed it. | both halves — one alone is a half-claim | CONVENTIONS.md | — |
| C11.quick.08 | default | | Release a Tier A / `released` repo by promoting `dev` into `main` with `--no-ff`, never squash. | --no-ff, never squash | CONVENTIONS.md | — |
| C11.quick.09 | default | | `colab release cut` makes a candidate and refuses unless §6's four conditions hold; the final tag is automatic after 3 clean days where nothing deploys and a human act where the tag deploys. | refuses unless §6's four conditions hold | CONVENTIONS.md | — |
| C11.quick.10 | default | | The version number is computed and its reasoning goes in the release notes. | its reasoning goes in the release notes | CONVENTIONS.md | — |
| C11.quick.11 | default | | Changes to this file change how everyone works; explain the why in the PR body. | Explain the why in the PR body | CONVENTIONS.md | — |
### Writes — the trunk-direct veto

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.veto.01 | default |  | `writes` answers one question: may a human ever commit straight to this repo's trunk checkout alongside worktree sessions. | may a human ever commit straight to this repo's trunk checkout, alongside worktree sessions? | CONVENTIONS.md | — |
| C2x.veto.02 | default |  | `writes` resolves to exactly two states, veto or coexistence, not a write-conflict method (mixed). | The vocabulary now resolves to exactly two states: | CONVENTIONS.md | #233 |
| C2x.veto.03 | default |  | Absent `writes` means coexistence: worktree sessions and an attended human trunk-direct session run side by side. | the default. Worktree sessions and an attended human trunk-direct session run side by side. | CONVENTIONS.md | #233 |
| C2x.veto.04 | default |  | `free` is the same state as absence, given a name. | `free` IS the former blank | CONVENTIONS.md | #283 |
| C2x.veto.05 | default |  | `direct` is coexistence plus a declared intent; it behaves exactly like `free` at runtime. | behaves exactly like `free` at runtime until a separate unit implements what it declares | CONVENTIONS.md | #283 |
| C2x.veto.06 | hard | tools/lib/writes-authority.js::trunkDirectVetoed ; tools/lib/solo.js::function soloEligibility | `writes: isolated` vetoes trunk-direct in this repo for every session, human or not; no field, flag or override lowers it. | no trunk-direct in this repo, human or not. No field, flag, or override lowers this bar. | CONVENTIONS.md | #233 |
| C2x.veto.07 | default |  | `serial`, `serial-direct`, `serial-gated` stay valid and are inert, identical to `free`. | These spellings stay valid (no adopter's descriptor breaks) | CONVENTIONS.md | #283 |
| C2x.veto.08 | default |  | Anything that acts on the veto reads `trunkDirectVetoed(raw)`, never the 3-way `resolveWrites` value. | is the one function anything may act on | CONVENTIONS.md | — |
| C2x.veto.09 | hard | tools/lib/solo.js::function soloEligibility | An automated session never gets trunk-direct, veto or not; only an attended human session may. | An automated session never gets trunk-direct here, veto or not | CONVENTIONS.md | #233 |
| C2x.veto.10 | default |  | Attendance is asserted with `COLAB_HUMAN=1`, set only on a human's explicit instruction, never inferred. | set only on a human's explicit instruction (never inferred, never | CONVENTIONS.md | — |
| C2x.veto.11 | default |  | Matrix: trunk-direct by a human at the keyboard is forbidden under `writes: isolated`, allowed under coexistence. | trunk-direct, human at the keyboard (`COLAB_HUMAN=1`) | CONVENTIONS.md | #233 |
| C2x.veto.12 | default |  | Matrix: trunk-direct by an automated session is forbidden in both columns. | trunk-direct, automated session | CONVENTIONS.md | #233 |
| C2x.veto.13 | default |  | Matrix: `ceremony: light` combined with `autonomy: auto-trunk` is forbidden in both columns. | `ceremony: light` + `autonomy: auto-trunk` | CONVENTIONS.md | — |
| C2x.veto.14 | default |  | Matrix: a place-claim is needed on the trunk checkout under coexistence, and n/a under `isolated`. | n/a — nothing writes the shared checkout | CONVENTIONS.md | #233 |
| C2x.veto.15 | default |  | Matrix: a branch is always required, except an attended trunk-direct unit. | always, except an attended trunk-direct unit | CONVENTIONS.md | #233 |
| C2x.veto.16 | explanation |  | Why the two matrix rows that never varied by method keep their cells unchanged. | keep their cells unchanged — that they never depended on | docs/adr/233-writes-veto-and-direct-rationale.md | #233 |

### writes: direct — declared today, runtime deferred

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.direct.01 | default |  | `direct` never claims more than `free` already grants. | it never claims more than `free` already grants. | CONVENTIONS.md | #283 |
| C2x.direct.02 | default |  | `direct` under-delivers relative to its name and never over-delivers. | **under-delivers** relative to a naive reading of its | CONVENTIONS.md | #283 |
| C2x.direct.03 | default |  | Under `direct`, `ciRole` is alarm, always. | Under `direct`, `ciRole` is alarm, always — nothing branches under a merge event that never happens | CONVENTIONS.md | #283 |
| C2x.direct.04 | default |  | The human merge gate and Phase A/B split under `direct` follow the #284 ruling, below. | The ruling amended it in one place — see Phase A / Phase B under `direct` immediately below | CONVENTIONS.md | #284 |
| C2x.direct.05 | default |  | A place-claim on a `direct` repo's own trunk checkout must carry an identity (`--session`) (mixed). | a `direct` repo's own trunk checkout must carry an identity (`--session`) | CONVENTIONS.md | #285 |
| C2x.direct.06 | default |  | Whether `direct` should admit automated trunk-direct writers is a ruling nobody has made; the matrix stays forbidden. | is a ⚖ ruling nobody has made, not an implementation detail | CONVENTIONS.md | #285 |
| C2x.direct.07 | explanation |  | Why the concurrency premise was wrong in both halves, measured. | There was nothing to loosen. | docs/adr/233-writes-veto-and-direct-rationale.md | #285 |
| C2x.direct.08 | default |  | Everything else about `direct`'s runtime is still deferred. | everything else about `direct`'s runtime is still deferred. | CONVENTIONS.md | #284 |
| C2x.direct.09 | hard | tools/lib/adopt.js::function writesGateVerdict | Declaring `writes: direct` needs the same human bar as lowering exposure: a TTY, or `COLAB_HUMAN=1` with `--answered-by`. | Declaring `writes: direct` requires the same human bar as lowering exposure | CONVENTIONS.md | #283 |
| C2x.direct.10 | hard | tools/lib/adopt.js::function writesGateVerdict | Declaring `writes: direct` is refused when the effective exposure is `live` or `released`, in both directions. | is refused outright when the effective exposure | CONVENTIONS.md | #283 |
| C2x.direct.11 | default |  | No `--force` or override flag lifts the `writes: direct` declaration gate. | No `--force`, no override flag, consistent with the rest of this command's asymmetry. | CONVENTIONS.md | #283 |

### Phase A / Phase B under direct

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.phase.01 | default |  | Under `direct`, Phase A (`code-wrap`) applies in full and unchanged. | Phase A (`code-wrap`) applies in full and unchanged | CONVENTIONS.md | #284 |
| C2x.phase.02 | default |  | Under `direct`, the merge half of Phase B never runs. | The MERGE half of Phase B never runs. | CONVENTIONS.md | #284 |
| C2x.phase.03 | default |  | Under `direct`, `code-ship` still runs in its evidence-close mode: evidence posted, issue closed, claims released. | `code-ship` still runs, in its existing evidence-close mode. | CONVENTIONS.md | #284 |
| C2x.phase.04 | default |  | Under `direct`, the human authorization bar moves from the merge act to the session-start instruction. | The human authorization bar moves from the merge act to the session-start | CONVENTIONS.md | #284 |
| C2x.phase.05 | explanation |  | Why option A (Phase B never runs at all) was declined. | Because Phase A does not close issues — it only distills onto them. | docs/adr/233-writes-veto-and-direct-rationale.md | #284 |
| C2x.phase.06 | default |  | Whoever implements `direct`'s runtime verifies, rather than assumes, that a direct unit falls into evidence-close (mixed). | Whoever implements `direct`'s runtime verifies that rather than assumes it | CONVENTIONS.md | #284 |
| C2x.phase.07 | default |  | `colab ship --direct` closes claims matched by the session's identity, never a widened filter; a blank identity is refused. | never by a widened filter, and a blank identity is refused. | CONVENTIONS.md | #302 |
| C2x.phase.08 | default |  | `colab ship --direct` reuses the autonomy gate, trunk CI, close/refs split, evidence comment, claim release and plan journal of a branch's evidence-close. | It reuses everything else a branch's evidence-close runs | CONVENTIONS.md | #302 |
| C2x.phase.09 | default |  | `writes: direct` is not required to use `colab ship --direct`; any repo that does not veto trunk-direct may. | `writes: direct` is not required to use it: it grants no | CONVENTIONS.md | #302 |
| C2x.phase.10 | hard | tools/colab::carries no evidence comment | Evidence-close is gated on the issue already carrying a comment the tool did not write; an issue without one is left open. | Evidence-close is gated on the issue already carrying a comment the tool did not write | CONVENTIONS.md | #342 |
| C2x.phase.11 | hard | tools/colab::function shipAutonomyGate | The autonomy gate still applies to `colab ship --direct`; without `auto-trunk` a human closes the unit, unless it is docs-only. | the autonomy gate still applies to `--direct` | CONVENTIONS.md | #342 |
| C2x.phase.12 | default |  | Trunk CI still gates a `--direct` close, as it does a branch's evidence-close. | trunk CI still gates the close, as it does a branch's evidence-close | CONVENTIONS.md | #342 |
| C2x.phase.13 | default |  | Counting trunk commits that mention `#N` as evidence was rejected; relaxing any of the three gates is a separate human change. | relaxing any of the three gates is a separate change for a human | CONVENTIONS.md | #342 |
| C2x.phase.14 | default |  | The ruling does not authorize any session to take trunk-direct where the veto and the attendance bar do not already allow it. | it does not authorize any session to take trunk-direct anywhere | CONVENTIONS.md | #284 |
| C2x.phase.15 | explanation |  | Why option C (defer until #285's design) was declined. | Close-accounting is independent of how concurrent writers are serialized | docs/adr/233-writes-veto-and-direct-rationale.md | #284 |
| C2x.phase.16 | explanation |  | The retired `auto-trunk`/`serial-direct` argument. | The old three-method table spent several paragraphs establishing that | docs/adr/233-writes-veto-and-direct-rationale.md | #233 |

### Exactly two conditions make a branch mandatory

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.branch.01 | default |  | Exactly two conditions make a branch mandatory for an attended trunk-direct session. | Exactly two conditions make a branch mandatory for an attended trunk-direct session | CONVENTIONS.md | #233 |
| C2x.branch.02 | default |  | Condition 1: more than one unit of work is in flight (a second claim, worktree or place-claim already live). | More than one unit of work is in flight | CONVENTIONS.md | #233 |
| C2x.branch.03 | default |  | Condition 2: a gate must inspect the unit before it lands, evidenced by a trunk-gating CI workflow or branch protection. | A gate must inspect the unit before it lands | CONVENTIONS.md | #233 |
| C2x.branch.04 | default |  | "It feels safer" is not a condition for a branch. | Not on that list: "it feels safer." A branch is one way to draw a unit boundary | CONVENTIONS.md | #233 |
| C2x.branch.05 | default |  | A clean changelog is not a condition for a branch. | Nor does "so the changelog reads cleanly" qualify | CONVENTIONS.md | #233 |
| C2x.branch.06 | default |  | The branch rule is deliberately not coupled to exposure, tier or production (mixed). | Deliberately not coupled to exposure, tier, or production. | CONVENTIONS.md | #233 |
| C2x.branch.07 | default |  | No audited rule encoding the observed correlation exists, and none should be added later. | none should be added later | CONVENTIONS.md | #233 |
| C2x.branch.08 | default |  | The audit reports an undeclared live-and-trunk-main shape as an informational advisory, never a refusal; `writes: isolated` is the way to say not here (mixed). | the audit reports the combination as an informational advisory (never a refusal) | CONVENTIONS.md | #233 |
| C2x.branch.09 | explanation |  | The deploy-shape prohibition, retired by #233, and the measurement behind dropping it. | A now-dropped rule once required a repo whose | docs/adr/233-writes-veto-and-direct-rationale.md | #233 |

### Autonomy — the docs-only exception (#345)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.docs.01 | hard | tools/colab::function shipAutonomyGate | On a repo without `autonomy: auto-trunk`, an agent may complete Phase B through `colab ship` for a documentation-only change. | an agent may complete Phase B through `colab ship` for a change that is documentation only, with no human trigger. | CONVENTIONS.md | #345 |
| C2x.docs.02 | hard | tools/colab::function shipAutonomyGate ; tools/lib/docs-only.js::function classify | The documentation-only judgement is computed by `colab ship` from git, never asserted by the caller. | computed by `colab ship` from git — never asserted by the caller | CONVENTIONS.md | #345 |
| C2x.docs.03 | explanation |  | Why a docs-only exception exists, measured. | Some branches carry nothing but text: path repoints, typo fixes, doc updates. | docs/adr/345-docs-only-autonomy-exception-rationale.md | #345 |
| C2x.docs.04 | default |  | For a branch, ship measures `git diff <target>...<branch>`, with renames split so both names and a deletion's path are judged. | `git diff <target>...<branch>`, the same three-dot diff the squash lands | CONVENTIONS.md | #345 |
| C2x.docs.05 | default |  | For a `--direct` unit, ship measures every trunk commit since the unit's earliest claim, by anyone. | every commit on trunk since the unit's earliest claim, by anyone. | CONVENTIONS.md | #342 |
| C2x.docs.06 | default |  | The `--direct` change set over-includes on purpose, so it can only err toward a refusal. | so this over-includes on purpose | CONVENTIONS.md | #345 |
| C2x.docs.07 | default |  | A change is docs-only when every path has extension `.md`, `.mdx` or `.txt`, or sits under a top-level `docs/`. | Docs-only when every path is either: | CONVENTIONS.md | #345 |
| C2x.docs.08 | hard | tools/colab::function shipAutonomyGate ; tools/lib/docs-only.js::function classify | Never docs-only, even if matched above: rules and config files, `.colab/skills/**`, binaries, symlinks, an empty diff. | Never docs-only, even if matched above: | CONVENTIONS.md | #345 |
| C2x.docs.09 | default |  | `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/**`, `.github/**` and `.githooks/**` are never docs-only. | `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/**`, `.github/**`, `.githooks/**` | CONVENTIONS.md | #345 |
| C2x.docs.10 | default |  | `.colab/skills/**` is never docs-only: a skill's local policy changes agent behaviour like a `CLAUDE.md`. | is agent instructions that win over the skill's own text | CONVENTIONS.md | #520 |
| C2x.docs.11 | default |  | The tool reads the exclusions at the strict end wherever the list is silent. | The tool reads the exclusions at the strict end wherever the list is silent. | CONVENTIONS.md | #345 |
| C2x.docs.12 | default |  | The three file names, three directories and the `.colab/skills` subtree match at any depth. | match **at any depth** | CONVENTIONS.md | #345 |
| C2x.docs.13 | default |  | Extensions compare exactly; `README.MD` is not `.md`. | Extensions compare exactly (`README.MD` is not `.md`). | CONVENTIONS.md | #345 |
| C2x.docs.14 | default |  | A submodule pointer counts as a binary change. | A submodule pointer counts as a binary change. | CONVENTIONS.md | #345 |
| C2x.docs.15 | default |  | A zero-commit evidence-close has an empty diff and still needs `auto-trunk` or a human. | A zero-commit evidence-close has an empty diff, so it still needs `auto-trunk` or a human. | CONVENTIONS.md | #345 |
| C2x.docs.16 | hard | tools/colab::function shipAutonomyGate | The docs-only exception relaxes the autonomy gate and only that gate; every other precondition is unchanged. | It relaxes the autonomy gate, and only that gate. | CONVENTIONS.md | #345 |
| C2x.docs.17 | default |  | The autonomy row reads `docs-only (N files) — autonomy exception`; `--dry --json` adds `autonomyGate: { via, docsOnly }`. | reads `docs-only (N files) — autonomy exception` in place of `auto-trunk`. | CONVENTIONS.md | #345 |
| C2x.docs.18 | default |  | A branch is measured again after B0 sync, before the squash. | A branch is measured again after B0 sync, before the squash | CONVENTIONS.md | #345 |
| C2x.docs.19 | hard | tools/colab::NEVER tags, NEVER promotes ; templates/pre-push-guard::COLAB_PROMOTE | The docs-only exception grants nothing past the trunk merge; promotion and deploys stay human and a tag never comes from `colab ship`. | nothing past the trunk merge — promotion and deploys stay human | CONVENTIONS.md | #345 |
| C2x.docs.20 | default |  | Nothing widens the docs-only allowlist: no field, flag or environment variable; widening is a handbook change. | No `project.yml` field, flag or environment variable can add | CONVENTIONS.md | #345 |

### Autonomy — the tuning-only class (#561)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.tune.01 | hard | tools/colab::function shipAutonomyGate ; tools/lib/config-set.js::function classify | `project.yml` stays committed; a tuning change to it is what is made cheap. | What is made cheap is a tuning change | CONVENTIONS.md | #561 |
| C2x.tune.02 | default |  | `colab config set` edits one tuning key, validated by the key's own parser, committed on a short branch without touching a checkout. | edits that one key only, validates the value with the parser every reader of the key uses | CONVENTIONS.md | #561 |
| C2x.tune.03 | default |  | Ship computes the tuning-only class from the diff; it needs no issue and every other precondition still applies. | It needs no issue and no `Closes #N`. | CONVENTIONS.md | #561 |
| C2x.tune.04 | hard | tools/colab::function shipAutonomyGate ; tools/lib/config-set.js::const AUTHORITY_KEYS | Authority and deploy keys are never tuning; a malformed value is refused by `config set` and by the class. | Never tuning, because they grant authority or change what deploys | CONVENTIONS.md | #561 |

### Autonomy — the human door (#525)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.human.01 | hard | tools/colab::function shipAutonomyGate ; tools/lib/ship-human-door.js::function humanDoorVerdict | Without `auto-trunk`, a person running `colab ship` is the go; ship opens the autonomy gate for them and runs every other precondition. | a person runs `colab ship` themselves. Running the command is the go. | CONVENTIONS.md | #525 |
| C2x.human.02 | default |  | The human bar: an interactive terminal outside an agent shell, confirmed at a `[y/N]` prompt, or `COLAB_HUMAN=1` with `--answered-by`. | The bar is the one the CLI already applies to human-only acts | CONVENTIONS.md | #525 |
| C2x.human.03 | hard | tools/lib/ship-human-door.js::function isAgentShell | An agent never opens the human door on its own; an agent shell is not a terminal. | An agent never opens this door on its own. | CONVENTIONS.md | #525 |
| C2x.human.04 | default |  | The human door is checked after auto-trunk and docs-only; the refusal names the commands a human runs; the 🚢 comment records the door; `--batch` still needs `auto-trunk`. | It is checked after auto-trunk and docs-only | CONVENTIONS.md | #525 |

### Core paths — a PR and a non-author approval before landing (#350)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.core.01 | hard | tools/colab::core-path review (#350) ; tools/colab::function shipCoreReview | A branch touching a core path goes up as a pull request and lands only after an account other than its author approves it. | it lands only after an account other than its author has approved it. | CONVENTIONS.md | #350 |
| C2x.core.02 | default |  | The core is whatever the target's `CODEOWNERS` covers. | The core is whatever the target's `CODEOWNERS` covers. | CONVENTIONS.md | #350 |
| C2x.core.03 | default |  | Write `CODEOWNERS` by kind (gate, merge behaviour, permissions, descriptor, irreversible state), not by directory. | Write that file by kind, not by directory: | CONVENTIONS.md | #350 |
| C2x.core.04 | default |  | The tool adds no core list of its own; it reads the file the forge reads. | The tool adds no list of its own; it reads the file the forge already reads. | CONVENTIONS.md | #350 |
| C2x.core.05 | default |  | The first of `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS` is read from the target, never from the branch. | reads the file from the target, never from the branch | CONVENTIONS.md | #350 |
| C2x.core.06 | default |  | A branch that adds the first `CODEOWNERS` is inert for its own landing. | A branch that adds the first `CODEOWNERS` is inert for its own landing | CONVENTIONS.md | #350 |
| C2x.core.07 | default |  | The rule is inert while one account is alone: no `CODEOWNERS`, or only the author's own logins. | Inert while one account is alone. | CONVENTIONS.md | #350 |
| C2x.core.08 | default |  | A team or an email counts as someone else; every doubt resolves toward review. | A team (`@org/team`) or an email counts as someone else | CONVENTIONS.md | #350 |
| C2x.core.09 | default |  | A fork's inherited `CODEOWNERS` binds nothing until the fork writes its own. | A fork's inherited `CODEOWNERS` binds nothing until the fork writes its own (#483). | CONVENTIONS.md | #483 |
| C2x.core.10 | default |  | On a fork, ship ignores every `@org/team` owner whose org is not the fork's own, and says so in the core-path review row. | `colab ship` ignores every owner of the form `@org/team` whose org is not the fork's own | CONVENTIONS.md | #483 |
| C2x.core.11 | explanation |  | The measured fork whose inherited owners paused two docs-only branches. | paused two docs-only branches in a row | docs/adr/483-core-path-fork-codeowners-rationale.md | #483 |
| C2x.core.12 | hard | tools/colab::core-path review (#350) ; tools/colab::function shipCoreReview | When the rule is active and the branch touches a core path, ship pushes the branch, opens or reuses a PR, prints PR-PENDING and exits 3, merging nothing. | When the rule is active and the branch touches a core path: | CONVENTIONS.md | #350 |
| C2x.core.13 | default |  | A paused ship adds a `core-path review` row marked `⏸` to the precondition table. | The precondition table gains a `core-path review` row, marked | CONVENTIONS.md | #350 |
| C2x.core.14 | default |  | Once every other precondition passes, ship pushes the branch and opens or reuses the PR. | ship pushes the branch, opens a PR to the target (or | CONVENTIONS.md | #350 |
| C2x.core.15 | default |  | The paused ship stops with exit 3, leaving claims, worktree and branch untouched. | It then stops with exit 3 and merges nothing. | CONVENTIONS.md | #350 |
| C2x.core.16 | default |  | A paused ship is a human-gated outcome, not a failure; `--dry --json` reports `mode: "pr-pending"`. | A paused ship is not a failed one. | CONVENTIONS.md | #350 |
| C2x.core.17 | default |  | Resuming: re-run the same `colab ship`; it lands the branch when the review is approved, on the current head, by someone other than the author. | It lands the branch when a review meets all of | CONVENTIONS.md | #350 |
| C2x.core.18 | default |  | An approval of an older head is stale. | it was given on the branch's current head. An approval of an older head is stale; | CONVENTIONS.md | #350 |
| C2x.core.19 | default |  | Only the latest review from each reviewer counts; any outstanding `CHANGES_REQUESTED` blocks the landing. | Only the latest review from each reviewer counts | CONVENTIONS.md | #350 |
| C2x.core.20 | default |  | The landing is ship's squash, not the PR's merge button; after B0 the diff is measured again and an uncovered core path refuses. | The landing itself is still ship's squash, not the PR's merge button. | CONVENTIONS.md | #350 |
| C2x.core.21 | default |  | Operators sharing one forge account cannot approve each other; a second operator needs a second account. | Operators who share one forge account cannot approve each other. | CONVENTIONS.md | #350 |
| C2x.core.22 | hard | tools/colab::core-path review (#350/#351) ; tools/colab::function shipDirectCoreReview | A trunk-direct unit that touches a core path is refused, not paused: `colab ship --direct` closes nothing and the change is redone on a branch. | A trunk-direct unit that touches a core path is refused, not paused (#351). | CONVENTIONS.md | #351 |
| C2x.core.23 | default |  | For `--direct`, `CODEOWNERS` is read from trunk before the unit's first commit and from trunk now; a path is core if either file covers it. | `CODEOWNERS` is read twice: from trunk as it stood before the unit's first commit | CONVENTIONS.md | #351 |
| C2x.core.24 | default |  | `colab solo`, the door that makes the trunk-direct commit, does not check core paths. | The door that makes the trunk-direct commit in the first place | CONVENTIONS.md | #351 |
| C2x.core.25 | default |  | Escalating to the repo owner after a set wait is not covered here. | Not covered here: escalating to the repo owner after a set wait. | CONVENTIONS.md | #350 |

### Solo flow — trunk-direct, issue-on-demand, entry-gated

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.solo.01 | default |  | Solo flow is legal on any repo that does not declare `writes: isolated`, and only to a session a human is behind. | legal on any repo that does not declare `writes: isolated` | CONVENTIONS.md | #233 |
| C2x.solo.02 | hard | tools/lib/solo.js::function soloEligibility | Attendance comes first, before any mechanical check: `colab solo` requires `COLAB_HUMAN=1`. | Attendance comes first — before any mechanical check below. | CONVENTIONS.md | #237 |
| C2x.solo.03 | default |  | Set `COLAB_HUMAN=1` only on a human's explicit instruction: transcription, never inference. | Set it only on a human's explicit instruction — transcription, never inference | CONVENTIONS.md | — |
| C2x.solo.04 | default |  | A headless, scheduled or driver session may never set `COLAB_HUMAN=1`, whatever its prompt contains. | Live conversation only — a headless, scheduled, or driver session may never set it | CONVENTIONS.md | — |
| C2x.solo.05 | hard | tools/lib/solo.js::function soloEligibility | `writes: isolated` vetoes solo flow for a human exactly as for an automated session. | `writes: isolated` vetoes this outright, for a human exactly as for | CONVENTIONS.md | #233 |
| C2x.solo.06 | hard | tools/lib/solo.js::function entryProblems ; tools/colab::solo refused in | `colab solo` checks fresh on every invocation: `COLAB_HUMAN=1`, no veto, no live solo session, trunk checked out with nothing unpushed, a clean tree, no conflicting place-claim. | `colab solo` checks fresh on every invocation, never a cached answer | CONVENTIONS.md | #136 |
| C2x.solo.07 | hard | tools/lib/solo.js::function entryProblems ; tools/colab::solo refused in | Anything held or unmet refuses solo entry outright: full ceremony, no partial credit. | held/unmet refuses outright — full ceremony, no partial credit | CONVENTIONS.md | — |
| C2x.solo.08 | default |  | A solo record whose co-located place-claim holder is confirmed dead is superseded rather than refused. | a solo record whose co-located place-claim holder is confirmed dead is superseded rather than refused | CONVENTIONS.md | #285 |
| C2x.solo.09 | explanation |  | Why the place-claim, not the solo record, is asked for liveness. | carries no liveness signal — it used to refuse on mere presence | docs/adr/236-solo-flow-entry-gate-rationale.md | #285 |
| C2x.solo.10 | default |  | A solo-record holder with liveness `true` or `null` (unprovable) keeps the refusal: fail closed. | `live: true` and `live: null` (unprovable | CONVENTIONS.md | #288 |
| C2x.solo.11 | default |  | The dead-holder supersession is not gated on any `writes:` value. | is deliberately not gated on any `writes:` value | CONVENTIONS.md | #285 |
| C2x.solo.12 | default |  | A worktree elsewhere in the repo (#236) or a claim held elsewhere (#240) is not on the entry-gate list. | a worktree existing anywhere else in the repo (#236), or a claim held | CONVENTIONS.md | #236 |
| C2x.solo.13 | explanation |  | Why a worktree's claim is that worktree's business, not this checkout's. | holds an *issue*, not a *place*, so a claim tied to a worktree elsewhere is that | docs/adr/236-solo-flow-entry-gate-rationale.md | #240 |
| C2x.solo.14 | default |  | A claim taken directly against this checkout, with no worktree, still refuses solo entry via the place-claim check. | A claim taken directly against this checkout, with no worktree, already acquires | CONVENTIONS.md | #240 |
| C2x.solo.15 | default |  | Small Conventional Commits go straight to trunk in solo flow. | Small Conventional Commits go straight to trunk; | CONVENTIONS.md | — |
| C2x.solo.16 | default |  | CI after a solo push is an alarm, not a gate, so recovery rather than prevention is the obligation. | an alarm, not a gate, so recovery rather than prevention is the obligation | CONVENTIONS.md | — |
| C2x.solo.17 | default |  | Solo flow stops requiring a branch but does not forbid one. | solo flow stops requiring a branch, it does not forbid one. | CONVENTIONS.md | — |
| C2x.solo.18 | default |  | An Issue is filed on demand, not on entry. | An Issue is filed on demand, not on entry | CONVENTIONS.md | — |
| C2x.solo.19 | default |  | The exit check is never gated on attendance: `colab solo --done` re-derives fresh that the tree is clean and everything pushed. | Exit check, not teardown, and never gated on attendance. | CONVENTIONS.md | #237 |
| C2x.solo.20 | default |  | `colab solo --done` dispatches before the eligibility check, so a missing `COLAB_HUMAN=1` cannot strand the lock. | so it dispatches before the eligibility check | CONVENTIONS.md | #237 |
| C2x.solo.21 | default |  | Solo flow's own invariants are never relaxed: CI secret scan, reserved ports, Conventional Commits, no scheduled driver. | Solo flow's own invariants, never relaxed even here: | CONVENTIONS.md | — |
| C2x.solo.22 | default |  | `production: null` is not required for solo flow; a live repo may run it if it does not declare the veto. | is not on this list — `writes` is deliberately not coupled to production | CONVENTIONS.md | — |
| C2x.solo.23 | default |  | `autonomy: auto-trunk` is not required for solo flow; the grant governs only the branch fallback. | is not either — a solo-flow trunk-direct commit produces no branch | CONVENTIONS.md | — |
| C2x.solo.24 | default |  | A checkout more than one session touches can never legally run solo flow there, scoped to the checkout, not the repo. | A *checkout* more than one session touches can never legally run solo flow there | CONVENTIONS.md | #236 |
| C2x.solo.25 | default |  | A repo hosting another session via a worktree or a claim tied to one is not disqualifying by itself. | is not disqualifying by itself | CONVENTIONS.md | #240 |
| C2x.solo.26 | default |  | Consumers inferring activity from worktrees and claims under-report a solo session; fixing that is each consumer's call. | fixing that is each such consumer's own call, not mandated here. | CONVENTIONS.md | — |

### Place-claims — the writer-verifiable hold a shared checkout needs

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.place.01 | default |  | A worktree writer needs no lock; a writer of the shared trunk checkout needs a place-claim. | A **worktree** writer needs no lock | CONVENTIONS.md | #233 |
| C2x.place.02 | default |  | A place-claim is path-scoped, held by a session and verified by the writer itself. | **path-scoped**, not repo-scoped — the checkout path is the unit | CONVENTIONS.md | — |
| C2x.place.03 | explanation |  | What a place-claim is not: the claim registry, a worktree's existence, a spawner's trunk-lock. | Three partial mechanisms already exist in this fleet | docs/adr/242-place-claims-rationale.md | — |
| C2x.place.04 | default |  | A hold on the main checkout records `branch: null`; a hold on a worktree records its real branch; the literal `trunk` is refused. | the main checkout records `branch: null` | CONVENTIONS.md | — |
| C2x.place.05 | default |  | Release is a read-time liveness lookup, never a state transition written at kill time. | Release is a liveness lookup at read time — never a state transition written at kill time. | CONVENTIONS.md | — |
| C2x.place.06 | default |  | A place-claim's check re-derives whether its holder is alive every time it is read, not a stored `released` flag. | re-derives whether its holder is still alive every time it is | CONVENTIONS.md | — |
| C2x.place.07 | explanation |  | The measured lag of the spawn-time trunk-lock's poller. | Measured on the one such lock already running in this fleet | docs/adr/242-place-claims-rationale.md | — |
| C2x.place.08 | default |  | Adopt the read-time liveness semantics rather than the poller's. | A read-time liveness check has no such lag; adopt that stronger semantics rather than the poller's. | CONVENTIONS.md | — |
| C2x.place.09 | default |  | `colab release` frees a trunk claim's hold once no claim of that session still holds that checkout. | `colab release` frees it once | CONVENTIONS.md | #305 |
| C2x.place.10 | default |  | A hold is released on ownership proved from the claim record's own session, never an ambient `--session`. | never from an ambient `--session` | CONVENTIONS.md | #305 |
| C2x.place.11 | explanation |  | The 45-minute measurement of a hold that outlived its release. | blocking every sibling claim on the machine. | docs/adr/242-place-claims-rationale.md | #305 |
| C2x.place.12 | default |  | Identity is fixed when the hold is written, never matched loosely when it is released. | Identity is fixed when the hold is written, never matched loosely when it is released. | CONVENTIONS.md | #306 |
| C2x.place.13 | default |  | `sessionName` is never widened into an exemption key. | `sessionName` is **never** widened into an exemption key | CONVENTIONS.md | #306 |
| C2x.place.14 | default |  | The place-claim decision happens inside the state lock, in `acquire`, called from within `state.mutate`. | The decision happens INSIDE the state lock, not beside it (#285). | CONVENTIONS.md | #285 |
| C2x.place.15 | explanation |  | The measured 8-of-8 concurrent acquire race on one checkout. | Measured on a fixture: 8 concurrent `colab place acquire` invocations against one checkout ALL exited 0 | docs/adr/242-place-claims-rationale.md | #285 |
| C2x.place.16 | default |  | The cheap lock-free pre-check remains at every call site and owns the `--force`/`COLAB_HUMAN=1` policy, but is not the authority. | The cheap lock-free pre-check remains at every call site | CONVENTIONS.md | #285 |
| C2x.place.17 | default |  | The lock is a same-filesystem `mkdir`: it orders writers on one machine only. | the lock is a same-filesystem `mkdir`, so it orders writers on ONE machine | CONVENTIONS.md | #285 |
| C2x.place.18 | default |  | Serialization means acquire-or-refuse, never a queue with waiting. | Serialization means acquire-or-refuse, never a queue with waiting. | CONVENTIONS.md | #285 |
| C2x.place.19 | default |  | Nothing sleeps, polls or blocks inside the place-claim tool. | Nothing sleeps, polls, or blocks inside the tool. | CONVENTIONS.md | #285 |
| C2x.place.20 | explanation |  | The two structural reasons against a waiting queue. | Two reasons, both structural rather than stylistic | docs/adr/242-place-claims-rationale.md | #285 |
| C2x.place.21 | default |  | A caller that wants to wait polls `colab place check <path>` itself. | A caller that wants to wait polls `colab place check <path>` itself | CONVENTIONS.md | #285 |
| C2x.place.22 | hard | tools/lib/place.js::syncedStateProblem | A place-claim refuses to acquire from a file-synced location. | A place-claim refuses to acquire from such a path. | CONVENTIONS.md | #289 |
| C2x.place.23 | default |  | The synced-path rule rules only on the lock's own state path, not on the checkout being synced. | **This rules only on the lock's own state path** | CONVENTIONS.md | #289 |
| C2x.place.24 | default |  | A repo whose working tree is synced to another machine cannot use trunk-direct at all. | a repo whose working tree is synced to another machine cannot use | CONVENTIONS.md | #289 |
| C2x.place.25 | default |  | Degraded mode: if the lock cannot be reached, the writer is told to use a worktree and branch, never to proceed unlocked. | the writer is told to use a worktree and branch instead | CONVENTIONS.md | — |
| C2x.place.26 | default |  | Nothing ever proceeds trunk-direct without a hold. | nothing ever proceeds trunk-direct without a hold. | CONVENTIONS.md | — |
| C2x.place.27 | hard | tools/lib/place.js::live-other | Overriding a held place-claim with a live holder requires `COLAB_HUMAN=1`, the same bar as a migration grant or a promotion. | overriding one requires the same `COLAB_HUMAN=1` bar as | CONVENTIONS.md | #289 |
| C2x.place.28 | default |  | An `unknown`-liveness holder needs a human: wait for the liveness window or override on confirmed knowledge. | An `unknown`-liveness holder (recorded by session URL | CONVENTIONS.md | #289 |
| C2x.place.29 | default |  | A place-claim refusal always names a resolvable holder, never a bare unknown. | The refusal always names a resolvable holder — never a bare "unknown" (#235). | CONVENTIONS.md | #235 |
| C2x.place.30 | default |  | Acquiring without `--session`/`--session-name` through `colab place acquire` or a worktree's hold succeeds but warns. | still succeeds without `--session`/`--session-name` (a never-fail stance) but warns | CONVENTIONS.md | #235 |
| C2x.place.31 | default |  | Supply an identity when one is available; the pid fallback is a floor, not a substitute. | supply an identity when one is available, this is a floor, not a substitute. | CONVENTIONS.md | #235 |
| C2x.place.32 | hard | tools/colab::function requirePlaceIdentity | `colab claim` with no `--worktree` and `colab solo` refuse outright when no `--session` or `COLAB_SESSION` is given. | So both now REFUSE outright, before any state is touched, when no `--session` | CONVENTIONS.md | #242 |
| C2x.place.33 | default |  | A bare `pid` is process lineage, never used to decide the re-acquire exemption, only surfaced as a hint (mixed). | A BARE `pid` is process lineage, not a session, and is never used to decide the re-acquire exemption | CONVENTIONS.md | #242 |
| C2x.place.34 | explanation |  | Why a bare pid never exempts a re-acquire: the falsifier run. | Two invocations sharing a parent shell share one `pid` without being one writer | docs/adr/242-place-claims-rationale.md | #242 |
| C2x.place.35 | default |  | The anchor pid is resolved per call, not always `process.ppid`. | The anchor pid is resolved per call, not always `process.ppid` (#288). | CONVENTIONS.md | #288 |
| C2x.place.36 | default |  | Anchor resolution: an explicit `--pid` or `COLAB_PLACE_PID` wins, then a verified auto-detected ancestor. | an explicit `--pid <n\|none>` (or `COLAB_PLACE_PID`) always wins; | CONVENTIONS.md | #288 |
| C2x.place.37 | default |  | An agent shell with nothing provable fails closed rather than anchoring on its own `ppid`. | an agent shell (`CLAUDECODE`/`AI_AGENT`) with nothing provable fails CLOSED rather than | CONVENTIONS.md | #288 |
| C2x.place.38 | default |  | A pid that fails closed is recorded and surfaced as a lead but never treated as a liveness signal. | it is simply never treated as a liveness signal, so it | CONVENTIONS.md | #288 |
| C2x.place.39 | default |  | A hold's holder is identified by its proven anchor process as well as its session string. | A hold's holder is identified by its proven anchor process as well as by its session string (#317). | CONVENTIONS.md | #317 |
| C2x.place.40 | default |  | A hold is also yours when its recorded anchor pid is alive and provably contains this invocation. | So a hold is also yours when its recorded anchor pid is alive and | CONVENTIONS.md | #317 |
| C2x.place.41 | default |  | A `default`-proof anchor and every record written before #317 are excluded from self-ownership. | A `default` proof — a bare `process.ppid` — and every | CONVENTIONS.md | #317 |
| C2x.place.42 | default |  | `sessionName` is never an ownership key, on any path. | `sessionName` is still never an ownership key, on any path. | CONVENTIONS.md | #317 |
| C2x.place.43 | default |  | A confirmed-dead holder lapses at read time: it is a record to clear, not a conflict to override. | A confirmed-dead holder lapses at read time — it is a record to clear, not a conflict to override (#317). | CONVENTIONS.md | #317 |
| C2x.place.44 | explanation |  | The 01:35 incident: a dead holder's record that needed `COLAB_HUMAN=1` to clear. | Only `colab doctor --prune` removed one, and only when | docs/adr/242-place-claims-rationale.md | #317 |
| C2x.place.45 | default |  | Every command that writes at a path clears a confirmed-dead holder, and releasing one needs no human flag. | releasing one needs no human flag: overriding nobody is not a human decision. | CONVENTIONS.md | #317 |
| C2x.place.46 | default |  | `unknown` liveness is untouched by the lapse and keeps the human bar. | `unknown` liveness is untouched — that is the case #288/#289 deliberately fail closed on | CONVENTIONS.md | #317 |
| C2x.place.47 | default |  | `colab places` stays a read: it labels a lapsed row rather than deleting it. | `colab places` stays a READ: it labels a lapsed row rather than deleting | CONVENTIONS.md | #317 |
| C2x.place.48 | default |  | A claim's hold is given back by every command that deletes the claim, not just `release`. | A claim's hold is given back by every command that deletes that claim, not just by `release` | CONVENTIONS.md | #312 |
| C2x.place.49 | default |  | The hold give-back applies three guards: skip a claim with a worktree, skip while another no-worktree claim of the session holds the checkout, never on a branch that keeps the claim. | Each applies the same three guards: skip a claim that | CONVENTIONS.md | #312 |
| C2x.place.50 | default |  | Machine identity is compared in two tiers: canonicalized hostname, then a hardware-bound id when both sides carry one. | Comparison is now two-tier: a cheap, pure canonicalization | CONVENTIONS.md | #289 |
| C2x.place.51 | default |  | A record written before #289 carries no hardware id and takes the hostname-comparison branch. | A record written before this landed carries no such id and | CONVENTIONS.md | #289 |
| C2x.place.52 | explanation |  | How this section relates to the spawn-time lock a session dashboard already keeps. | A related lock already exists outside this convention | docs/adr/242-place-claims-rationale.md | — |
| C2x.place.53 | default |  | Any cross-machine or distributed form of the place-claim lock is out of scope. | Explicitly out of scope: any cross-machine or distributed form of this lock. | CONVENTIONS.md | — |
| C2x.place.54 | default |  | Separate working trees plus git's own push rejection on a stale ref remain the cross-machine backstop. | The existing backstop — separate working trees, plus git's own push rejection on a stale ref | CONVENTIONS.md | — |
| C2x.place.55 | default |  | With no `--session` and `COLAB_SESSION` unset, a person at a plain terminal is given a derived `person:` identity instead of a refusal. | a person at a plain terminal is given an identity instead of a refusal | CONVENTIONS.md | #528 |
| C2x.place.56 | default |  | An explicitly empty `COLAB_SESSION=''` still means no identity. | still means "no identity" | CONVENTIONS.md | #528 |
| C2x.place.57 | default |  | Agents never derive an identity, because concurrent agent sessions on one machine would derive the same value. | Agents never derive: two concurrent agent sessions on | CONVENTIONS.md | #528 |
| C2x.place.58 | default |  | A person running several units at once from separate shells gives each shell its own `COLAB_SESSION`. | gives each shell its own `COLAB_SESSION` | CONVENTIONS.md | #528 |

### Channels — by what path does code reach the thing that runs it?

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C2x.chan.01 | default |  | `channels` names every path by which a commit reaches something that runs it, a different question from `deploy`. | names every path by which a commit reaches something that runs it | CONVENTIONS.md | — |
| C2x.chan.02 | explanation |  | The measured fleet behind the `channels` axis. | `deploy:` covers roughly two of the paths this fleet has actually observed | docs/adr/523-channels-axis-rationale.md | — |
| C2x.chan.03 | default |  | Channel `workflow`: merge, then CI, then a deploy workflow. | merge → CI → a deploy workflow | CONVENTIONS.md | — |
| C2x.chan.04 | default |  | Channel `hook`: a git hook, in-repo or installed on a machine, fires on a git act. | a git hook, in-repo or installed on a machine, fires on a git act | CONVENTIONS.md | — |
| C2x.chan.05 | default |  | Channel `procedure`: a human builds, installs or restarts from a checkout by a documented procedure. | a human builds/installs/restarts from a checkout, by a documented procedure | CONVENTIONS.md | — |
| C2x.chan.06 | default |  | Channel `checkout`: a per-machine service definition serves the working tree directly. | a per-machine service definition serves the working tree directly — no build, no copy | CONVENTIONS.md | — |
| C2x.chan.07 | default |  | Channel `artifact`: a tag or package that adopters consume. | a tag or package that adopters/others consume | CONVENTIONS.md | — |
| C2x.chan.08 | default |  | Channel `data`: the process is local and the effect lands in another system's production data. | the process is local; the effect lands in another system's production data | CONVENTIONS.md | — |
| C2x.chan.09 | default |  | Channel `none`: nothing runs this code anywhere. | nothing runs this code anywhere \| `none` | CONVENTIONS.md | — |
| C2x.chan.10 | default |  | `channels` values are lowercase, in a list, because a repo can have several channels open at once. | Lowercase, a list (a repo can genuinely have several channels open at once | CONVENTIONS.md | — |
| C2x.chan.11 | default |  | The field shape lives in `project.schema.md`; this section states the argument. | this section states the argument, that page states the field. | CONVENTIONS.md | — |
| C2x.chan.12 | explanation |  | Why `channels` is not the exposure axis again. | They fail differently: a repo can answer exposure correctly and still have an undeclared channel | docs/adr/523-channels-axis-rationale.md | — |
| C2x.chan.13 | default |  | `channels` names the kind of channel; the machine is never in the descriptor. | Names the KIND of channel; the MACHINE is never in the descriptor. | CONVENTIONS.md | — |
| C2x.chan.14 | default |  | The `channels` axis inherits the `trunk:` ruling that a per-host entry gets no descriptor field. | This axis inherits that ruling rather than reopening it | CONVENTIONS.md | — |
| C2x.chan.15 | default |  | Intended channels get declared; unintended ones are findings, never values. | Intended channels get declared; unintended ones are findings, never values. | CONVENTIONS.md | — |
| C2x.chan.16 | default |  | A working tree file-synced between machines while git metadata is excluded is a bug, not a legal channel. | A working tree file-synced between machines while git metadata is deliberately excluded is a bug, | CONVENTIONS.md | — |
| C2x.chan.17 | explanation |  | The two shapes of consequence of an unintended channel. | Two shapes of consequence, described here by what was true | docs/adr/523-channels-axis-rationale.md | — |
| C2x.chan.18 | default |  | A file-synced working tree cannot use trunk-direct at all. | Consequence — a file-synced working tree cannot use trunk-direct at all. | CONVENTIONS.md | — |
| C2x.chan.19 | default |  | Trunk-direct is unavailable until the repo is excluded from the sync. | is unavailable until the repo is excluded from the sync | CONVENTIONS.md | — |
| C2x.chan.20 | default |  | The synced-checkout rule is distinct from the lock's own state path never being on a synced path. | this rules on whether the checkout being locked is itself trustworthy as | CONVENTIONS.md | — |
| C2x.chan.21 | explanation |  | The retired second consequence, where the trunk merge was itself the deploy. | A rule used to sit here requiring such a repo to keep a branch | docs/adr/523-channels-axis-rationale.md | #233 |
| C2x.chan.22 | explanation |  | What the unit that introduced `channels` did and did not do. | It ships the `channels` key, its shape/enum check, and the descriptor-internal advisory | docs/adr/523-channels-axis-rationale.md | #137 |
| C2x.chan.23 | default |  | Only `artifact` and `workflow` are checked today; the other values are named deliberate deferrals. | only `artifact` (a tag) and `workflow` (a committed deploy path) | CONVENTIONS.md | #137 |
| C2x.chan.24 | default |  | No mechanism flips authority from `tier`/`deploy` to `channels` or makes the key required. | No mechanism flips authority from `tier`/`deploy` to `channels`, or makes the key required | CONVENTIONS.md | #144 |
| C2x.chan.25 | default |  | The channel question is asked by the §9 shared question set, and `colab adopt` proposes candidates, never an asserted absence. | The channel question is now asked, in words, by | CONVENTIONS.md | #199 |
| C2x.chan.26 | explanation |  | What the `channels` merge left unchanged. | breaks on this merge. | docs/adr/523-channels-axis-rationale.md | #137 |

#### #539 ledger — slice A (§1, §2 Tiers…Channels, §3)

- base line 69 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "This buys one thing: the expensive test suite runs at … Sessions stay fast; releases stay safe." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-tiers-rationale.md`. Rows: none re-keyed.
- base line 73 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "The split answers slow CI, not seriousness. A repo with … `main` becomes a branch nobody trusts." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-tiers-rationale.md`. Rows: none re-keyed.
- base line 163 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "Common in tag-gated GitOps: a release script cuts `vX.Y.Z` and … **no in-repo deploy workflow** by design."; "— between releases it is, by construction, an ancestor of … it as safe to delete (#63)." → after: the example sentence is gone and the release-branch sentence now ends "Name the release branch in releaseBranch: (link)." with a Why link (was: "…releaseBranch: — between releases it is… misreads it as safe to delete (#63)."); every other rule sentence unchanged. Rationale → `docs/adr/539-tiers-rationale.md`. Rows: none re-keyed.
- base line 179 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "**Tier C exists because a tag ritual nobody honours is worse than no tag ritual.**"; "Not a lesser A — a different, honest gate count." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-tiers-rationale.md`. Rows: C2.tiers.12 (key updated).
- base line 192 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "Measured: a session's record read `branch: 'trunk'`; the merge tool … below reached by a different path." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-tiers-rationale.md`. Rows: none re-keyed.
- base line 219 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "A `deploys: { <host>: <branch> }` entry would drift the … stale entry from a live one." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-tiers-rationale.md`. Rows: none re-keyed.
- base line 244 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "**Replaces two things that were standing in for it by … of whether the thing is live." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-room-exposure-rationale.md`. Rows: C2.room.02 (key updated). Coordinator fix: the paragraph also carried this rule's contrast, so the rule half is restated in §2 Room as "Issue language follows the room, not repo privacy, and `ceremony` follows the room, not production status."
- base line 263 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "**Landed first because the exposure axis is defined against it** … nothing until the room axis exists)." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-room-exposure-rationale.md`. Rows: none re-keyed.
- base line 294 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "A repo that has never declared `exposure` sees zero change … opted in, breaks on this flip." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-room-exposure-rationale.md`. Rows: none re-keyed.
- base line 308 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "**`prelaunch` was rejected in favour of a relationship word.** An … a home: `production:`, which exists today." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-room-exposure-rationale.md`. Rows: C2.exposure.06 (key kept; dest now the ADR, an explanation row).
- base line 337 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "Advisory, not failure, because the descriptor is not *lying* (the … adoption data a later unit needs." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-room-exposure-rationale.md`. Rows: none re-keyed.
- `CONVENTIONS.md:358` — before: "**What this unit (#132) shipped, and what #144 later added.** #132 shipped the key, its four-value enum check, and the `production:` pairing advisory … not by this one. **#137 shipped 2 of 5 possible falsifiers …** `exposure: self` gets no falsifier at all. Three more named in #137 stay deliberately deferred: … `audit/README.md`. #137 also added a **duration report** … #144 shipped the authority flip described above; it deliberately does **not** make the key required — that stays phase 3. The exposure question is now asked …" → after: the same paragraph without the three removed history/deferral sentences ("#132 shipped … by this one.", "Three more named in #137 … `audit/README.md`.", "#144 shipped the authority flip … phase 3."); the falsifier warns, the `self` rule, the duration report, the §9 question and the closing "no rule here answers the question for any specific repo" sentence are verbatim. Rationale → `docs/adr/539-room-exposure-rationale.md`. Rows: none re-keyed.
- base line 395 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "The rule required `production: null` for `light`, reasoning that a live repo cannot skip its own audit trail. That conflates:" → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-ceremony-recovery-rationale.md`. Rows: none re-keyed.
- base line 406 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "A live, single-operator repo whose only irreplaceable asset is a … mode instead of a declared one." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-ceremony-recovery-rationale.md`. Rows: none re-keyed.
- base line 458 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "Before this ruling, the field named which of three coherent … length explaining. That machinery is retired." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-writes-direct-rationale.md`. Rows: none re-keyed.
- base line 520 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "The proposal of record was that under `direct` the trunk … worth more than the original plan:" → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-writes-direct-rationale.md`. Rows: none re-keyed.
- base line 535 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "Cheap to decide because `ciRole` is derived prose in `tools/lib/adopt.js`'s `deriveConsequences`, not enforcement." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-writes-direct-rationale.md`. Rows: none re-keyed.
- base line 603 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "**⚠️ Measured during #285:** the question was premature, because `colab … the gate exactly as it is.**"; "Counting trunk commits that mention `#N` as evidence was considered … so the evidence would be self-declared." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-writes-direct-rationale.md`. Rows: none re-keyed.
- base line 655 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "The correlation visible across today's fleet — light/beta repos tending … later 'to catch the common case.'" → after: the paragraph keeps its bold lead and reads "No audited rule couples this to them, and none should be added later 'to catch the common case.'" (was: "so no such rule exists, and none should be added later 'to catch the common case.'"); the correlation argument moved. Rationale → `docs/adr/539-writes-direct-rationale.md`. Rows: C2x.branch.07 (key updated).
- base line 729 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "Before this rule the refusal sent the human away with … human go on every later merge." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-autonomy-core-paths-rationale.md`. Rows: none re-keyed.
- base line 786 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "A team of another org cannot review in the fork, … gate that nobody here decided on." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-autonomy-core-paths-rationale.md`. Rows: none re-keyed.
- base line 834 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "That would be a separate change, taken only if a bypass is ever measured, because `--direct` is attended by construction."; "For `--direct` the target already contains the unit, so reading … itself by deleting or narrowing it." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-autonomy-core-paths-rationale.md`. Rows: none re-keyed.
- base line 853 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "`ceremony: light` relaxed the record-keeping *end* of a session; the … — stayed full weight even there." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-solo-place-claims-rationale.md`. Rows: none re-keyed.
- `CONVENTIONS.md:871` — before: "… is deliberately **not** gated on any `writes:` value — a stale record is equally stale under every one of them, and a safety rule that only applies in one mode is the kind of conditional §4's incident log warns about." → after: "… is deliberately **not** gated on any `writes:` value." Rationale → `docs/adr/539-solo-place-claims-rationale.md`. Rows: none re-keyed.
- base line 950 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "'Dies with its session' is what a reader assumes, and … at the moment a session dies." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-solo-place-claims-rationale.md`. Rows: none re-keyed.
- base line 1053 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "The string has to be reproduced identically by every later … a human cleared it by hand."; "The equivalence class this admits is never coarser than the … already exempt by exporting `COLAB_SESSION` once." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-solo-place-claims-rationale.md`. Rows: none re-keyed.
- base line 1084 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "A record's `host` alone false-refuses the SAME machine the instant … out a different label between processes." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-solo-place-claims-rationale.md`. Rows: none re-keyed.
- base line 1144 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "What makes a shared-checkout hold safe is a lock on … believe they hold the only checkout." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-channels-marker-rationale.md`. Rows: none re-keyed.
- `CONVENTIONS.md:1189` — before: "`stack` is a **free-form string**, not a fixed list — a closed enum was tried and immediately failed on a Capacitor app fitting no bucket." → after: "`stack` is a **free-form string**, not a fixed list. Why: ADR 539." Rationale → `docs/adr/539-channels-marker-rationale.md`. Rows: none keyed.
- `CONVENTIONS.md:1218` — before: "`ports:` declares **where** a repo's trunk dev server listens; nothing declares **how** it starts, so every consumer wanting to start one has kept its own external table of start commands, unvalidated against the repo, forcing a default onto any repo it has no entry for." → after: "`ports:` declares **where** a repo's trunk dev server listens; nothing declares **how** it starts." Rationale → `docs/adr/539-channels-marker-rationale.md`. Rows: none keyed.
- base line 1228 (unit's first line; verbatim parts, so the move check needs no entry) — before: the unit also carried the rationale "Measured cost of the status quo: a repo silently inherited … indefinitely, with nothing to flag it." → after: that text removed (or, where noted in the ADR, replaced by a Why link); every rule sentence of the unit is unchanged and verbatim. Rationale → `docs/adr/539-channels-marker-rationale.md`. Rows: none re-keyed.

### §4 Branches and commits

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C4.s4.01 | default |  | Name branches `feat/<slug>-<issue-number>` (type from the branch-name regex) so claim, worktree and Issue line up. | Convention is `feat/<slug>-<issue-number>`, e.g. `feat/onboard-redesign-23` — the issue number in the name | CONVENTIONS.md | — |
| C4.s4.02 | default |  | A repo declaring `branchPrefix: machine` gets session branches `<login>/<machine>/<type>/<slug>-<issue-number>`. | gets session branches shaped `<login>/<machine>/<type>/<slug>-<issue-number>`, e.g. | CONVENTIONS.md | #348 |
| C4.s4.03 | default |  | `colab worktree new` adds the prefix itself; the session passes the unprefixed name. | `colab worktree new` adds the prefix itself — you still pass the unprefixed name | CONVENTIONS.md | #348 |
| C4.s4.04 | default |  | Issue numbers stay in the trailing `-<N>` run so every reader anchors there regardless of prefix. | the issue numbers stay in the **trailing** `-<N>` run, and every | CONVENTIONS.md | #348 |
| C4.s4.05 | default |  | Every squash `colab ship` lands carries a `Machine: <label>` trailer, composed or `--message`. | Every squash `colab ship` lands carries `Machine: <label>`, whether the message is composed | CONVENTIONS.md | #350 |
| C4.s4.06 | default |  | The `Machine:` label is a normalised host label, a name and never a hardware identifier. | same normalised host label the prefix uses — a name, never a hardware identifier | CONVENTIONS.md | #350 |
| C4.s4.07 | default |  | On a public repository (forge-reported or `room: public`) the squash carries no `Machine:` trailer and `Colab-Adopted:` drops its host tail. | If the forge reports the repository as public, or `project.yml` declares `room: public`, the squash carries no | CONVENTIONS.md | #367 |
| C4.s4.08 | default |  | When visibility cannot be read and `room:` is not `solo`/`team`, ship omits the trailer and warns (fails closed). | ship **omits** the trailer and warns. It fails closed because a missing | CONVENTIONS.md | #367 |
| C4.s4.09 | default |  | A branch may carry a related group of issues by suffixing every number in its name. | A branch may carry a group of related issues — suffix them all: | CONVENTIONS.md | — |
| C4.s4.10 | default |  | Claim every issue in the group before starting. | Claim every issue in the group before starting, and | CONVENTIONS.md | — |
| C4.s4.11 | default |  | Release every claim in the group together at wrap, unconditionally, including unfinished issues. | release every claim in the group together at wrap — unconditionally, including | CONVENTIONS.md | — |
| C4.s4.12 | default |  | A group (same code, one branch, trailing numbers) is not a chain; a chain is recorded as a dependency, never by a branch name. | together on one branch, spelled with trailing numbers in the branch name. | CONVENTIONS.md | — |
| C4.s4.13 | default |  | Branches predating adoption are grandfathered: do not rename them; apply the convention to new branches only. | do not rename them; several may be | CONVENTIONS.md | — |
| C4.s4.14 | default |  | Never branch off another feature branch. | Never** branch off another feature branch — that couples two unfinished things, | CONVENTIONS.md | — |
| C4.s4.15 | default |  | Always branch off trunk or a declared integration line; "declared" means a commit in the repo. | Always branch off trunk, or a **declared integration line** | CONVENTIONS.md | — |
| C4.s4.16 | default |  | A line is declared by a commit in the repo, not by habit. | "Declared" is a commit in the repo, not a habit. | CONVENTIONS.md | — |
| C4.s4.17 | default |  | The branch base is a session fact recorded at worktree creation, and the branch ships back into it. | The base is a **session fact**, recorded when the worktree is created, and the branch | CONVENTIONS.md | — |
| C4.s4.18 | default |  | Base and merge target are one decision: say which branch you merged into when reporting a session done. | Base and merge target are **one decision, not two** — say which branch you merged into | CONVENTIONS.md | — |
| C4.s4.19 | default |  | Keep the main checkout on trunk at rest; a worktree is the default, not a preference. | The main checkout stays on trunk at rest — a worktree is the default, not a | CONVENTIONS.md | — |
| C4.s4.20 | default |  | A plain branch is allowed only on a repo nothing reads from, and the session then owns returning the checkout to trunk before wrap. | taking it means **you** own returning the checkout to trunk | CONVENTIONS.md | — |
| C4.s4.21 | default |  | Never use a bare `git stash` in any checkout of a repo that has more than one. | never reach for a bare stash in any checkout of a repo that has more than one. | CONVENTIONS.md | — |
| C4.s4.22 | default |  | The stash hazard follows the repo, not where the session stands. | The hazard follows the repo, not where a session stands | CONVENTIONS.md | #241 |
| C4.s4.23 | default |  | Prefer `git diff`/`git status`, then targeted `git checkout -- <path>`, then comparing against `origin/<trunk>`; never touch `refs/stash`. | Prefer, in order: `git diff`/`git status` to read without moving; targeted | CONVENTIONS.md | — |
| C4.s4.24 | default |  | If a stash is unavoidable, label it and re-run `git stash list` immediately before touching any `stash@{N}` index. | touching any `stash@{N}` index — a concurrent push renumbers every existing entry | CONVENTIONS.md | — |
| C4.s4.25 | default |  | Edits landed in the wrong checkout are recovered with a patch, never a stash entry. | recover with a **patch**, never a stash entry. A patch file is private to the | CONVENTIONS.md | — |
| C4.s4.26 | default |  | Never infer a dirty main checkout from a nested worktree's path; ask git. | A nested worktree's path shares the main checkout's prefix — never infer dirty from | CONVENTIONS.md | #273 |
| C4.s4.27 | default |  | The only reliable dirtiness check is `git -C <repo-root> status --porcelain`, scoped to the repo root. | The only reliable check is `git -C <repo-root> status --porcelain`, | CONVENTIONS.md | #273 |
| C4.s4.28 | default |  | Treat a dirty path in the main checkout as possibly yours until shown otherwise. | The default is "possibly mine until shown otherwise," not the | CONVENTIONS.md | #294 |
| C4.s4.29 | default |  | A dirty path conclusively not yours is reported, never cleaned. | original rule still holds exactly as before: **report it, never clean it.** | CONVENTIONS.md | #294 |
| C4.s4.30 | default |  | Commits use Conventional Commit prefixes, which §6 groups into the release summary. | Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, | CONVENTIONS.md | — |
| C4.s4.31 | default |  | A commit with no prefix is invisible in release notes. | A commit with no prefix is invisible in release notes. | CONVENTIONS.md | — |
| C4.s4.32 | default |  | `colab ship`'s default squash subject is the branch's highest-weight commit, ranked as listed (ties to the oldest). | commit — highest wins, ties go to the oldest — in this order, | CONVENTIONS.md | #261 |
| C4.s4.33 | default |  | A Conventional-Commit-shaped commit of an unweighed type ranks below every named type but above a shapeless commit. | below every named type, but above a commit with no Conventional Commit shape at all: | CONVENTIONS.md | #261 |
| C4.s4.34 | default |  | Fix an unrecognised commit type by re-wording it, or ship with `--message` so the subject is stated. | the fix is to re-word the commit to a recognised type, or ship with | CONVENTIONS.md | #261 |
| C4.s4.35 | default |  | Feature branch to trunk merges are squashes, one commit per unit of work. | Feature branch → trunk: **squash**, one commit per unit of work. | CONVENTIONS.md | — |
| C4.s4.36 | default |  | `dev` to `main` promotion is a `--no-ff` merge commit, never a squash. | promotion (Tiers A and C): **`--no-ff` merge commit**, never squash — | CONVENTIONS.md | — |
| C4.s4.37 | default |  | The merge message writes `Closes #N` once per issue, not a bare `(#N)`. | The merge message closes its issues: write `Closes #N` (one per issue), not a bare | CONVENTIONS.md | — |
| C4.s4.38 | default |  | An issue's `## Plan` is a real GitHub checklist, one `- [ ]` per deliverable. | An issue's `## Plan` is a real GitHub checklist — one | CONVENTIONS.md | #74 |
| C4.s4.39 | hard | tools/colab::remainder declared for unticked issues | `colab ship` refuses to merge a claimed issue with an unticked Plan box and no declared `Remainder: #M`. | `colab ship` parses the checklist before composing the squash body: any | CONVENTIONS.md | #263 |
| C4.s4.40 | default |  | Ticking every box, declaring `Remainder: #M`, or an explicit `--refs #N` clears the close gate. | Ticking every box, declaring | CONVENTIONS.md | #263 |
| C4.s4.41 | default |  | A hand-merge runs the identical checklist check by reading the issue body and comments. | A hand-merge runs the identical check by reading the same two fields | CONVENTIONS.md | #74 |
| C4.s4.42 | default |  | The remainder issue is required by convention; the gate does not file it for you. | Requiring the remainder issue is the convention — the gate does not file one for | CONVENTIONS.md | #263 |
| C4.s4.43 | default |  | Choosing `--refs` must also stop the open issue being started again. | keeps an issue open, so the same step must also stop it being started | CONVENTIONS.md | #385 |
| C4.s4.44 | default |  | When the leftover is a human-only check, do not `--refs`: close the issue and add a row to the open `Human verify:` issue. | do not `--refs` it. Close #N and add one row to | CONVENTIONS.md | #385 |
| C4.s4.45 | default |  | When the leftover is another non-code wait, park the issue in the same ship with `deferred:<kind>`, `review-by:<date>` and a `Hold:` line. | park #N in the same ship. Add `deferred:<kind>` + | CONVENTIONS.md | #385 |
| C4.s4.46 | default |  | When the leftover is code, prefer `Remainder: #M` and let the issue close. | prefer `Remainder: #M` and let #N close. | CONVENTIONS.md | #385 |
| C4.s4.47 | default |  | `colab ship` prints a reminder, never a refusal, for a `--refs`'d issue with unticked boxes and nothing stopping a start. | prints a **reminder, never a refusal**, when a `--refs`'d issue still has | CONVENTIONS.md | #385 |
| C4.s4.48 | hard | tools/colab::claims corroborated by git | `colab ship` refuses an issue named by neither the branch name's trailing number group nor a commit-body `#N`; a hand merge performs the same check. | Every closed issue must be corroborated by git, not the claim registry alone | CONVENTIONS.md | #87 |
| C4.s4.49 | default |  | Do not resolve an uncorroborated issue by quietly writing `Refs #N`. | Do not resolve it by quietly writing `Refs #N` — that hides the collision | CONVENTIONS.md | #87 |
| C4.s4.50 | default |  | A deliverable with no diff still has to close, through `colab ship` evidence-close (`landed` and zero own commits, measured from git). | `colab ship` detects `landed ∧ zero own commits` (both | CONVENTIONS.md | #90 |
| C4.s4.51 | hard | tools/colab::carries no evidence comment | Evidence-close is gated on the issue already carrying a comment the tool did not write. | Gated on the issue **already carrying a comment the tool did not write**. | CONVENTIONS.md | #90 |
| C4.s4.52 | default |  | A unit committed straight to trunk closes through `colab ship --direct`, which matches claims by session identity and refuses until published. | way through `colab ship --direct` (#302), which matches its claims by session identity and | CONVENTIONS.md | #302 |
| C4.s4.53 | default |  | A ship releases every claim it carried, not only the worktree's. | A ship releases every claim it carried (#319)** — not only the worktree's. | CONVENTIONS.md | #319 |
| C4.s4.54 | default |  | An unattached claim of the same session is carried by a branch ship only when the branch name's trailing group names it; otherwise it is reported and left alone. | is carried by a branch ship only when the branch name's trailing group names it; | CONVENTIONS.md | #319 |
| C4.s4.55 | hard | tools/colab::remote-only-unclaimed | `colab ship` refuses a branch that exists only on origin with no issue number and no local claim unless `--adopt` is passed. | `colab ship` refuses it unless `--adopt` is passed, and an | CONVENTIONS.md | #324 |
| C4.s4.56 | default |  | A local ref created by git from `origin/<same name>` reads the same as remote-only. | A local ref does not make it this machine's (#343): when the ref's oldest reflog entry says | CONVENTIONS.md | #343 |
| C4.s4.57 | hard | tools/colab::'line'} CI green | `colab ship` refuses to merge unless trunk's CI is green and actually ran. | Before merging to trunk, check that trunk's last CI run is green — and that it ran at | CONVENTIONS.md | — |
| C4.s4.58 | default |  | Read trunk CI by commit: every run at the head sha completed and one succeeded. | The right question: has EVERY run at this branch's current head sha completed, and did | CONVENTIONS.md | #92 |
| C4.s4.59 | default |  | A sibling run still in progress has not passed; a fast green workflow never answers for a slow one. | a sibling that is merely still in progress has not passed either (#307) | CONVENTIONS.md | #307 |
| C4.s4.60 | default |  | Only runs of workflows the repo owns count; `event: dynamic` runs are dropped before the verdict. | Only runs of workflows the repo owns count (#451) | CONVENTIONS.md | #451 |
| C4.s4.61 | default |  | Only runs that verify the code (push or pull request) count; release-lane `workflow_run`, scheduled, dispatch and deploy runs are set aside. | Only runs that **verify the code** count (#503) | CONVENTIONS.md | #503 |
| C4.s4.62 | default |  | `ship-gate-workflows:` / `ship-ignore-workflows:` override the counted set by workflow name. | override the set by workflow name | CONVENTIONS.md | #503 |
| C4.s4.67 | default |  | Exception: a `workflow_dispatch` run of the push- or PR-triggered CI workflow counts where that workflow has no push run at the sha. | except a dispatch of the push- or PR-triggered CI workflow with no push run at the sha | CONVENTIONS.md | #567 |
| C4.s4.63 | default |  | A trunk sha whose tree has no workflow file reads `none`; the candidate's own run at its remote head decides, and a trunk with workflows but no run still refuses. | A trunk that has workflows but no run at its sha is a real gap and still refuses. | CONVENTIONS.md | #482 |
| C4.s4.64 | default |  | Each workflow is judged by its newest run at the sha; a cancelled run never supersedes; different workflows are never reduced. | Each workflow is then judged by its **newest** run at the sha (#461) | CONVENTIONS.md | #461 |
| C4.s4.65 | default |  | A skill needing the trunk verdict calls `colab trunk-ci` rather than restating the rule as a `gh run list` filter. | a skill that needs it calls the verb instead of restating the rule as a `gh run | CONVENTIONS.md | #463 |
| C4.s4.66 | default |  | Wait for the CI verdict with `colab ci-wait`, never a hand-rolled `sleep` loop. | Waiting for that verdict is `colab ci-wait`, never a loop (#495). | CONVENTIONS.md | #495 |

### Branch CI — the candidate's own run, read as a class (#314)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C4.bci.01 | default |  | The local gate is green only when the test step passed twice: as-is and hermetically (`colab gate-hermetic`, `code-wrap` A3). | So the local gate is green only when | CONVENTIONS.md | #403 |
| C4.bci.02 | default |  | A toolchain manager's home is carried across the hermetic run, pinned to its real path and printed. | the one thing carried across, pinned to its real path and printed | CONVENTIONS.md | #447 |
| C4.bci.03 | default |  | A green normal run with a red hermetic run is the verdict `live-env`, and it is not green. | hermetic run is its own verdict, `live-env`, and it is not green. | CONVENTIONS.md | #403 |
| C4.bci.04 | default |  | The only exemption from the hermetic run is `live-env: none` on trunk's `project.yml`. | `live-env: none` declaration on trunk's `project.yml` | CONVENTIONS.md | #403 |
| C4.bci.05 | default |  | A branch-CI run counts as the hermetic run when it is green at the current head, runs the same test command, and its runner does not share a developer's machine. | it is `green` at the branch's current head sha (the class below), its workflow runs the | CONVENTIONS.md | #408 |
| C4.bci.06 | default |  | Run `colab gate-hermetic` locally only when branch CI cannot arrive, is not green, or does not run the tests. | `colab gate-hermetic` runs locally only | CONVENTIONS.md | #408 |
| C4.bci.07 | default |  | After a sync, push and read the new branch run before re-running the suite locally. | push and read the new branch run before | CONVENTIONS.md | #408 |
| C4.bci.08 | default |  | A repo declaring `gate:` with `smoke:` and `authoritative: ci` runs one smoke check in `code-wrap` A3, and the verdict is the branch-CI run at the pushed head. | A repo whose branch CI can | CONVENTIONS.md | #410 |
| C4.bci.09 | default |  | `code-ship` reads the branch-CI run and never re-runs the suite locally where `authoritative: ci` holds. | `code-ship` reads the run and never re-runs the suite | CONVENTIONS.md | #410 |
| C4.bci.10 | default |  | While iterating run the tests for what changed; the full suite runs once, where the verdict comes from. | While iterating, run the tests for what | CONVENTIONS.md | #410 |
| C4.bci.11 | default |  | With no `gate:`, `authoritative: local`, or no workflow on a session-branch push, the local full gate plus the hermetic run applies. | no `gate:`, `authoritative: local`, or no workflow firing on a session-branch | CONVENTIONS.md | #410 |
| C4.bci.12 | default |  | Report branch CI at the head sha as one of four classes, spelled exactly `green`, `none`, `red:infra`, `red:finding`, not as pass/fail. | report the result as one of four | CONVENTIONS.md | — |
| C4.bci.13 | default |  | A `none` (run queued, in flight, or absent) is waited on for the repo's measured CI wait bound per candidate (15 minutes with no history, #559), then deferred with a re-measure trigger, never polled open-endedly. | then a defer carrying a re-measure trigger, never an open-ended poll | CONVENTIONS.md | #370 |
| C4.bci.14 | default |  | A run that cannot arrive for the ref is not pending: proceed, and read the trunk run at the squash sha after merge, filing `TRUNK RED:` on red. | is not pending: proceed, and the base's own CI is the whole CI story | CONVENTIONS.md | #374 |
| C4.bci.15 | default |  | A `red:infra` run is re-run once; an identical second failure goes to the ops lane, never merged past and never sent back. | an identical failure twice is the runner, not the branch — hand it to the ops lane. | CONVENTIONS.md | — |
| C4.bci.16 | default |  | A `red:finding` goes back to an implementer session as a class send-back, never merged past and never re-run. | back to an implementer session, **as a class** | CONVENTIONS.md | — |
| C4.bci.17 | hard | tools/colab::branch run contains current base (#395) | `colab ship` refuses a branch whose run head does not contain the base's current tip (`stale-base`). | A class read at a head that does not contain the base's current tip is | CONVENTIONS.md | #395 |
| C4.bci.18 | default |  | A stale-base class is cleared by syncing the base in, pushing and waiting on the new run (the same bound), then landing. | The next step is mechanical — sync the base in, push, wait on the new run | CONVENTIONS.md | #395 |
| C4.bci.19 | default |  | Skipping the re-run on a stale base is allowed only on a measurement, never on a guess. | ever allowed on a measurement, never on a guess | CONVENTIONS.md | #395 |
| C4.bci.20 | default |  | A fast green sibling never answers for a slow run still going (that sha is `none`); a cancelled straggler beside a real success is still `green`. | a fast sibling already green never answers for a slow one still running | CONVENTIONS.md | #307 |
| C4.bci.21 | default |  | The ladder must not reintroduce the deadlock #92 fixed. | the ladder must not reintroduce the deadlock #92 fixed. | CONVENTIONS.md | #92 |
| C4.bci.22 | default |  | A claim's first push is green through the `dedupe` guard run when the same workflow already passed at that sha, not through a second suite run. | A claim's first push is `green` from a guard run, not a second suite run | CONVENTIONS.md | #418 |
| C4.bci.23 | default |  | An identical tree plus a green run of the same workflow counts as tested on trunk. | an identical tree plus a green run of the same workflow is tested. | CONVENTIONS.md | #493 |
| C4.bci.24 | default |  | A repo whose suite depends on state outside the repo declares `tree-reuse: off` and trunk always runs in full. | declares `tree-reuse: off` | CONVENTIONS.md | #493 |
| C4.bci.25 | default |  | Any doubt (no descriptor, opt-out, API error, no exact match) runs the full suite; a trunk-only publish/deploy/release job never sits behind the gate. | Any doubt — no descriptor, an opt-out, an API error, no exact match — runs the full suite. | CONVENTIONS.md | #493 |
| C4.bci.26 | default |  | Read a failing job's log far enough to say which side of the line it fell on; an unclassifiable red is `red:finding`. | if that cannot be told, report `red:finding`. | CONVENTIONS.md | — |
| C4.bci.27 | default |  | At least one named failing assertion means `red:finding`, whatever else the run shows. | **At least one named failing assertion ⇒ `red:finding`**, whatever else the run | CONVENTIONS.md | #354 |
| C4.bci.28 | default |  | Never re-run a run with a named failing assertion. | Never re-run it**: a green second run hides a real | CONVENTIONS.md | #354 |
| C4.bci.29 | default |  | Otherwise a red is `red:infra` only when the tests demonstrably never ran (duration far below norm, empty `--log-failed`, environment-naming failure text). | Otherwise it is `red:infra` when the tests demonstrably never ran | CONVENTIONS.md | #354 |
| C4.bci.30 | default |  | With neither signal the red is `red:finding`. | Neither ⇒ `red:finding` — the unclassifiable rule above, unchanged. | CONVENTIONS.md | #354 |
| C4.bci.31 | default |  | A timeout is `red:infra` only if the host was loaded; with no host evidence it is `red:finding`. | A timeout is `red:infra` only if the host was loaded. | CONVENTIONS.md | #354 |
| C4.bci.32 | default |  | An infra-shaped port collision from a single random draw is re-run once to clear the red and also filed as a defect. | is re-run once to clear the red **and** filed as a defect | CONVENTIONS.md | #354 |
| C4.bci.33 | default |  | CI templates trigger on every branch push with a per-ref `concurrency` group that cancels a superseded run on the same branch and never a trunk run. | group that cancels a superseded run on the same branch and **never** a trunk run | CONVENTIONS.md | #384 |
| C4.bci.34 | default |  | On a single self-hosted agent shared with trunk, keep trunk-only triggers (and restore `pull_request`) until a trunk lane exists. | On a **single self-hosted agent shared with trunk**, keep trunk-only triggers (and restore | CONVENTIONS.md | #384 |
| C4.bci.35 | default |  | The cancel list names the repo's trunk and release branch by name. | The cancel list | CONVENTIONS.md | #384 |
| C4.bci.36 | default |  | Say which `none`: a bare `none` turns a bounded wait into a wait for a run that never comes. | A bare `none` turns a bounded wait into a wait for a run that was | CONVENTIONS.md | — |
| C4.bci.37 | default |  | At a red base, only the branch carrying the fix may open a PR to give its `none` a run; a bystander waits for green and does not rebase onto the red. | So opening one is legitimate for exactly one | CONVENTIONS.md | #353 |
| C4.bci.38 | default |  | Ask first whether this branch is the patch: yes goes first ahead of the queue, no waits. | No → it waits, and | CONVENTIONS.md | #353 |
| C4.bci.39 | default |  | A class describes one sha; anything that moves the head (a sync merge) invalidates it and it is read again. | A class describes one sha.** Anything that moves the head — a sync merge of the base | CONVENTIONS.md | — |
| C4.bci.40 | default |  | The one sanctioned substitute for that re-read is a batch's combined run. | The one sanctioned substitute for that re-read is a **batch's combined run** | CONVENTIONS.md | #373 |
| C4.bci.41 | default |  | A red class is recorded by the implementer, who stops; only `red:finding` names the implementer, and only for the branch's own finding. | The implementer records it and stops; the | CONVENTIONS.md | — |
| C4.bci.42 | default |  | One re-run per red episode, not per attempt, and it is the only CI action the coordinator takes. | **One re-run per red episode, not per attempt** — and it is the only CI action the | CONVENTIONS.md | — |

### Who may touch a branch — the coordinator never edits implementer work (#409)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C4.touch.01 | default |  | The coordinator (ship or sweep session) never edits, commits, wraps or gates an implementer's work. | never edits, commits, wraps or gates | CONVENTIONS.md | #409 |
| C4.touch.02 | default |  | The coordinator syncs the base into a branch that has fallen behind it (`code-ship` B0). | Sync the base into a branch that has fallen behind it | CONVENTIONS.md | #409 |
| C4.touch.03 | default |  | The coordinator regenerates a generated file after taking one side of a conflict on it. | Regenerate a generated file after taking one side | CONVENTIONS.md | #409 |
| C4.touch.04 | default |  | The coordinator resolves a purely mechanical conflict only (keeps both sides' hunks, adds no line, picks no winner). | Resolve a purely mechanical conflict | CONVENTIONS.md | #409 |
| C4.touch.05 | default |  | The coordinator may also push a wrapped head unchanged, re-run an infra-class red once, cure-merge, open the red-trunk-fix PR and re-take a released claim. | push a wrapped head unchanged, re-run an | CONVENTIONS.md | #409 |
| C4.touch.06 | default |  | The coordinator runs a gate only on a commit it made itself, never the implementer's gate on their behalf. | The coordinator runs a gate only on a commit it made itself | CONVENTIONS.md | #409 |
| C4.touch.07 | hard | tools/lib/shipguard.js::↩️ Sent back | Everything else is a send-back: one Issue comment starting with `↩️ Sent back` addressed to the implementer, which is neither evidence nor a hand-off, posted once per head. | Everything else is a send-back.** A conflict that needs judgement, a hand-off that does not | CONVENTIONS.md | #409 |

### Batch landing — one combined run, then a fast-forward (#373)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C4.batch.01 | default |  | A repo declaring `ship-batch: <N>` (1–8) may land through `colab ship --batch`; absent or 1 is serial. | may land through `colab ship --batch <b1,b2[,…]>`: | CONVENTIONS.md | #373 |
| C4.batch.02 | default |  | A batch member is `green` at its own head, passes every gate its own serial ship would, and is an ordinary auto-trunk squash. | passes every gate its own serial ship would, | CONVENTIONS.md | #373 |
| C4.batch.03 | default |  | Anything special (docs-only door, migration, ci-grant or cure, core-path review, adopted branch, workflow edits) ships serially. | Anything special ships serially, where its path already is | CONVENTIONS.md | #373 |
| C4.batch.04 | default |  | Disjointness is never the correctness gate; the combined run is. | Disjointness is never the correctness gate | CONVENTIONS.md | #373 |
| C4.batch.05 | default |  | Build the batch as trunk's green head plus one squash commit per member, each with its own `Closes #N`. | each its own commit with its own `Closes #N` | CONVENTIONS.md | #373 |
| C4.batch.06 | default |  | A conflicting member drops to the next batch unless every conflicting path is `generated`, in which case `pre-ship` regenerates them. | A member that conflicts with those | CONVENTIONS.md | #387 |
| C4.batch.07 | hard | tools/colab::<<<<<<< | A pre-ship hook that exits 0 but leaves a conflict-marker line staged in a path it was handed has failed; the staged index is the proof. | its exit code is a claim, the index is the proof | CONVENTIONS.md | #436 |
| C4.batch.08 | default |  | One combined run at the batch head must be `green` and replaces each member's post-sync re-run. | One combined run** there must be `green`. It **replaces** each member's post-sync | CONVENTIONS.md | #373 |
| C4.batch.09 | default |  | Trunk fast-forwards to the batch head only if trunk has not moved, by a plain non-forced push; otherwise rebuild. | Trunk fast-forwards to the batch head **only if trunk has not moved** since | CONVENTIONS.md | #373 |
| C4.batch.10 | default |  | A green batch run stands in for trunk's own in-flight run only when the same workflows fire on a trunk push and a `ship-batch/**` push. | only when **the same workflows** ran there: the workflow files | CONVENTIONS.md | #373 |
| C4.batch.11 | default |  | On `red:infra` re-run once; on `red:finding` (`--split`) or red after the re-run, a batch of two or more lands nothing and splits: the same ref is rebuilt with its first half, the rest wait for the next batch. | rebuilt on the same base with the **first half** of its members | CONVENTIONS.md | #557 |
| C4.batch.19 | default |  | A red batch of one cannot split: it lands nothing and that member ships serially. | A red batch of **one** cannot split | CONVENTIONS.md | #557 |
| C4.batch.12 | default |  | If no workflow fires on a `ship-batch/**` push, `colab ship` says so and declines to serial, never waiting. | `colab ship` says so and declines to serial — it never waits for it. | CONVENTIONS.md | #373 |
| C4.batch.13 | hard | tools/colab::a batch never passes the cure/grant doors | A red trunk declines the whole batch; the cure/grant doors apply per member, never to a batch. | A red trunk still stops everything** except the cure/grant doors, and those apply | CONVENTIONS.md | #373 |
| C4.batch.14 | default |  | `colab ship --batch` never waits; it exits 0 landed, 3 paused (wait on the printed run, rerun) or 4 declined (ship members one at a time). | `colab ship --batch` never waits: each call reads the remote, takes one step, and exits | CONVENTIONS.md | #373 |
| C4.batch.15 | default |  | Declining is never a silent fall-through to the serial path. | Declining is never a silent fall-through to the serial path | CONVENTIONS.md | #373 |
| C4.batch.16 | default |  | A ship pass builds a batch from every candidate ready at that moment, re-reading the set before each `--batch` call. | re-read the set right before each `--batch` call | CONVENTIONS.md | #555 |
| C4.batch.18 | default |  | On a `ship-batch` repo a lone ready candidate lands through the batch path as a batch of one, never serially. | A batch of one is a batch | CONVENTIONS.md | #562 |
| C4.batch.17 | default |  | A lone ready candidate waits for a partner only up to the repo's declared `ship-batch-wait`, with the lane otherwise idle. | it waits up to that window | CONVENTIONS.md | #555 |
| C4.batch.20 | default |  | With `ship-batch-steps` declared, each batch is built one step up after a green batch, one step down after a red one. | one step up after a green batch, one step down after a red one | CONVENTIONS.md | #557 |

### Is a shipped half actually shippable? — the mechanical gate is not the judgement call (#263)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C4.shippable.01 | default |  | A half-done issue that genuinely outlived one session is a filing defect: file it as an epic next time, not by shipping the half. | the fix is filing it that way next time, not shipping the half. | CONVENTIONS.md | #263 |
| C4.shippable.02 | default |  | An inseparable half (stages of one change) is left on its branch to finish next session, never shipped by declaring a remainder to pass the gate. | never to declare a remainder just to get the gate to pass. | CONVENTIONS.md | #263 |
| C4.shippable.03 | default |  | The close gate is a precondition, never the answer to whether a half should ship. | So the gate is a precondition, never the answer to "should this half | CONVENTIONS.md | #263 |
| C4.shippable.04 | default |  | At grading time (`code-ship` B1c), ask whether the shipped half has its own oracle, before the close gate. | The test, applied at grading time (`code-ship` B1c) before the close gate is ever | CONVENTIONS.md | #263 |
| C4.shippable.05 | default |  | A half with no oracle of its own is inseparable and not shippable regardless of the checklist. | it is case 3 — | CONVENTIONS.md | #263 |
| C4.shippable.06 | default |  | A half with its own oracle ships with a declared `Remainder: #M`. | a declared `Remainder: #M` is the honest way to ship it. | CONVENTIONS.md | #263 |

### Has it landed? — the one rule, because the obvious one is wrong

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C4.landed.01 | default |  | Never decide landed by counting commits; use `colab landed`. | Never decide it by counting commits — a squash mints a new commit with a new sha, so | CONVENTIONS.md | — |
| C4.landed.02 | default |  | Ask whether merging the branch into its base changes the base's tree at all. | The rule asks directly: does merging this branch into its base change the | CONVENTIONS.md | — |
| C4.landed.03 | default |  | Ask against the branch's base, trunk only by default. | Asked against the branch's base**, trunk only by default | CONVENTIONS.md | — |
| C4.landed.04 | default |  | `unknown` means cargo; verdicts never round up to `landed`. | Verdicts never round up to `landed`. | CONVENTIONS.md | — |
| C4.landed.05 | default |  | Before shipping a candidate, ask the base's history whether it already shipped under another sha, with the `git log --grep` on `Closes #N`. | also ask the base's history whether it already shipped under | CONVENTIONS.md | #370 |
| C4.landed.06 | default |  | Keep the `([^0-9]\|$)` tail in the grep: a bare `#37` also matches `#370`. | is load-bearing: a bare `--grep="#37"` also matches `#370`. | CONVENTIONS.md | #370 |
| C4.landed.07 | default |  | A match for every issue, each CLOSED, with no branch commit newer than the squash, means shipped: evidence, release, teardown, never a second merge. | with each issue CLOSED and no commit on the branch newer | CONVENTIONS.md | #370 |
| C4.landed.08 | default |  | Anything short of all three (reopened issue, later commit, `Refs #N` only) stays cargo. | Anything short of all three (an issue reopened since, a commit after | CONVENTIONS.md | #370 |
| C4.landed.09 | default |  | The grep answers whether a ship happened, never whether the content is on base; an unmatched grep never rounds toward `landed`. | an unmatched grep never rounds a verdict toward `landed`. | CONVENTIONS.md | #370 |
| C4.landed.10 | default |  | Git state and claim state are two signals; neither replaces the other. | Git state and claim state are two signals, and neither replaces the other. | CONVENTIONS.md | — |
| C4.landed.11 | default |  | `colab landed --ci` is advisory only and never blocks `colab landed` or `colab ship`. | Advisory only — it never blocks `colab landed` or `colab ship` | CONVENTIONS.md | #293 |

#### #539 ledger — §4 Branches and commits (slice B)

Rationale from this slice moved to `docs/adr/539-branches-and-commits-rationale.md`, `docs/adr/539-branch-ci-rationale.md`, `docs/adr/539-who-may-touch-and-batch-landing-rationale.md` and `docs/adr/539-landed-rationale.md`. Every other cut in the slice removed whole sentences (or whole list items) verbatim, so the move check finds them without an entry. The two units below were reworded inside a sentence.

- `CONVENTIONS.md:1272` — before: "The label is a hostname, and a commit message cannot be edited once it is pushed. On a public repository the trailer would publish an internal hostname permanently, once per ship. So `colab ship` reads the destination first." → after: "`colab ship` reads the destination first." Rationale → `docs/adr/539-branches-and-commits-rationale.md`. Rows: C4.s4.07, C4.s4.08 (keys intact).
- `CONVENTIONS.md:1409` — before: "`design:` (a specification, mockup, or visual decision rather than a behaviour change) is ranked here, not merely branch-legal — added because an adopter had 3 genuine `design:` commits over 400, six live `design/…` branches, and its own conventions already named `design` a legitimate type before this repo's tooling recognised it." → after: "`design:` (a specification, mockup, or visual decision rather than a behaviour change) is ranked here, not merely branch-legal." Rationale → `docs/adr/539-branches-and-commits-rationale.md`. Rows: none keyed.

Keys shortened because the sentence that followed them was moved whole (the rule text itself is unchanged):

- C4.s4.29 — key was "…**report it, never clean it.** The"; now ends at "**report it, never clean it.**" (the moved sentence began "The investigation is what changed…").
- C4.s4.53 — key was "…— not only the worktree's. A claim with"; now ends at "— not only the worktree's." (the moved sentence began "A claim with no worktree … used to survive…").

### §5 Claiming work — Who holds this

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.claim.01 | default |  | Parallel sessions and agents must not collide on the same Issue. | Parallel sessions and parallel agents must not collide on the same Issue. | CONVENTIONS.md | — |

### §5 Record of a claim — the branch on the remote

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.record.01 | hard | tools/colab::Refusing — one or more issues are already claimed | A branch or claim ref on the remote carrying #N that is not this machine's refuses a second claim on #N from anywhere. | refuses a second claim on `#N` from anywhere, naming the ref | CONVENTIONS.md | #325, #550 |
| C5a.record.02 | default |  | The record of a claim is its branch on the remote, recorded when cut at session start and pushed at wrap. | the moment it is cut at session start and pushed at wrap | CONVENTIONS.md | #325 |
| C5a.record.10 | default |  | At the cut the claim is recorded as the claim ref refs/claims/<branch>, not the branch, so no CI push trigger fires; colab worktree rm deletes it. | a claim ref fires none | CONVENTIONS.md | #550 |
| C5a.record.03 | default |  | Each machine sweeps its own worktrees. | Each machine sweeps its own worktrees. | CONVENTIONS.md | — |
| C5a.record.04 | hard | tools/colab::function printRemoteUnreachable | Fail closed: with the remote unreachable, make no claim (a repo with no remote at all excepted). | Fail closed: a claim checked against nothing is not a lock. | CONVENTIONS.md | #325 |
| C5a.record.05 | default |  | A repo with no remote at all relies on the machine's own record. | A repo with no remote at all is the one exception | CONVENTIONS.md | — |
| C5a.record.06 | default |  | With the tracker unreachable the claim stands; its tracker half is recorded pending and posted on re-run. | Tracker unreachable → the claim still stands. | CONVENTIONS.md | — |
| C5a.record.07 | default |  | One account on two machines is two holders; a live claim comment from the same login on another machine refuses too. | One account on two machines is two holders | CONVENTIONS.md | — |
| C5a.record.08 | default |  | Name the machine in a claim by canonical id (not hostname), and carry only a digest of it in the comment. | A claim names the machine by a canonical id, not its hostname | CONVENTIONS.md | #327 |
| C5a.record.09 | default |  | A planner may hold an issue before its session exists (--session intent:<id>); the session's own claim upgrades it, and an unused planner claim is released after a short window. | A planner may hold an issue before the session that will work it exists | CONVENTIONS.md | #326 |

### §5 Mirror for people — GitHub

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.mirror.01 | default |  | Check in-progress before taking work; claim with assignee plus label at session start; release at session end. | gh issue list --label in-progress | CONVENTIONS.md | — |
| C5a.mirror.02 | hard | tools/colab::half-claim — labeled in-progress but nobody is assigned | A claim is both halves, the assignee and in-progress; `colab claim` refuses a half-claim until repaired, --force taking it over loudly. | `colab claim` refuses it until then, `--force` taking it over loudly like any other claim | CONVENTIONS.md | #323 |
| C5a.mirror.03 | default |  | Either half alone is a half-claim: a broken claim, neither free nor taken. | a broken claim, which is neither free nor taken | CONVENTIONS.md | #323 |
| C5a.mirror.04 | default |  | Nobody starts on a half-claim; triage reports it for repair — the assignee completes it or drops it. | Nobody starts on it; triage reports it for repair | CONVENTIONS.md | #323 |
| C5a.mirror.05 | default |  | Our own half-claim is the one exception: re-claiming completes it. | Our own half-claim is the one exception: re-claiming completes it. | CONVENTIONS.md | #323 |
| C5a.mirror.06 | default |  | Release drops both halves, never only the label. | Release therefore drops both halves; removing only the label is what leaves | CONVENTIONS.md | #323 |
| C5a.mirror.07 | default |  | Release removes the assignee who holds the claim, not the account releasing it. | Release removes the assignee who holds the claim, not the account releasing it | CONVENTIONS.md | #363 |
| C5a.mirror.08 | default |  | The claimer is the account that applied in-progress (the latest such event on the issue). | The claimer is the account that applied `in-progress` | CONVENTIONS.md | #363 |
| C5a.mirror.09 | explanation |  | Why a release that drops @me leaves the claimer assigned: measured on this repo. | A fleet working under more than one account claims under one | docs/adr/363-claim-release-rationale.md | #363 |
| C5a.mirror.10 | default |  | `colab release` reads the claimer from the issue, unassigns it alongside the caller, and says so when the login differs. | `colab release` (and every path that releases through it) reads the claimer from the issue | CONVENTIONS.md | #363 |
| C5a.mirror.11 | default |  | By hand, <claimer> is @me only when you took the claim yourself. | By hand, `<claimer>` is `@me` only when you took the claim yourself | CONVENTIONS.md | #363 |
| C5a.mirror.12 | default |  | When yielding a lost race, the latest labeler is the winner and its assignee must stay. | there the latest labeler is the winner, whose assignee must stay | CONVENTIONS.md | #363 |
| C5a.mirror.13 | default |  | Assignee plus in-progress is the mirror for people, not the lock; the lock is the branch on the remote. | is the claim's mirror for people, not its lock | CONVENTIONS.md | #325 |
| C5a.mirror.14 | default |  | Create the in-progress label as part of adoption; it does not exist in a fresh repo. | The label does not exist in a fresh repo — creating it is part of adoption | CONVENTIONS.md | — |

### §5 Fast path — local cache

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.fastpath.01 | default |  | The machine-local cache at ~/.colab/state.json is a cache, not the truth. | It is a cache, not the truth | CONVENTIONS.md | — |
| C5a.fastpath.02 | default |  | When cache and GitHub disagree about the assignee/label, GitHub wins. | When cache and GitHub disagree about the assignee/label, GitHub wins. | CONVENTIONS.md | — |
| C5a.fastpath.03 | default |  | Never file-sync the cache between machines — it answers which remote branches are this machine's own. | which is why it is never file-synced between machines | CONVENTIONS.md | — |
| C5a.fastpath.04 | default |  | Reconcile the cache with `colab claims --sync` and free dead claims with `colab doctor --prune`. | colab doctor --prune # free claims whose worktrees no longer exist | CONVENTIONS.md | — |

### §5 Rules

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.rules.01 | hard | tools/colab::Refusing — one or more issues are already claimed ; tools/colab::zeroClaimVerdict | Claim before you start, not when you open the PR. | Claim before you start, not when you open the PR | CONVENTIONS.md | — |
| C5a.rules.02 | hard | tools/colab::Refusing — one or more issues are already claimed | A live claim is enforced, not advisory: claim and worktree-new refuse an issue with a live claim, naming the holder. | `colab claim`/`colab worktree new` refuse an issue with a live claim | CONVENTIONS.md | — |
| C5a.rules.03 | default |  | --force takes over a live claim loudly. | naming the holder; `--force` takes over loudly | CONVENTIONS.md | — |
| C5a.rules.04 | default |  | Say so on the Issue if you intend to return to an unfinished issue whose claim a wrap released. | say so on the Issue if you intend to return | CONVENTIONS.md | — |
| C5a.rules.05 | default |  | A claim carries its details as a structured Issue comment: 🔒 Claimed on claim, ✅ Released on release. | A claim carries its details as a structured Issue comment | CONVENTIONS.md | — |
| C5a.rules.06 | default |  | code-ship's evidence comment prepends an invisible `<!-- colab:evidence sha=<trunk-sha> -->` marker line to free prose. | `<!-- colab:evidence sha=<trunk-sha> -->`, prepended to free prose | CONVENTIONS.md | — |
| C5a.rules.07 | default |  | Degrade, never gate: a comment missing the evidence marker still counts as evidence; no consumer treats its absence as no evidence. | a comment missing the marker still counts as evidence; no consumer may treat its absence | CONVENTIONS.md | — |
| C5a.rules.08 | default |  | code-ship's grade verdict is a `<!-- colab:grade verdict=<token> round=<n> -->` line, the token one of a closed set (pass, reject-decision, reject-escalate, rework). | `<token>` one of a closed set | CONVENTIONS.md | — |
| C5a.rules.09 | default |  | No grade token is a prefix or decorated variant of another. | no token a prefix or decorated variant of another | CONVENTIONS.md | — |
| C5a.rules.10 | default |  | `rework` is posted only at round=1 and is held, never cleared. | It is emitted only at `round=1`, and it is held, never cleared. | CONVENTIONS.md | #328, #406 |
| C5a.rules.11 | default |  | Read marker attributes by name, never position. | Attributes are read by name, never position | CONVENTIONS.md | — |
| C5a.rules.12 | default |  | Read markers by equality, never prefix or heading; an unrecognised token or a missing marker both mean not cleared. | an unrecognised token or a missing marker both mean "not cleared" | CONVENTIONS.md | — |
| C5a.rules.13 | default |  | A third marker, `colab:disposition proposed=<token>`, proposes how a non-code unit of work ends, under the same closed-set rules. | proposes how a non-code unit of work ends | CONVENTIONS.md | — |
| C5a.rules.14 | default |  | Simultaneous claims break ties deterministically: re-read after claiming; the earliest live claim comment wins and the loser posts Released (yielded). | Simultaneous claims break ties deterministically | CONVENTIONS.md | — |
| C5a.rules.15 | default |  | Release the claim even if you did not finish; a stale claim silently blocks others. | Release the claim even if you did not finish | CONVENTIONS.md | — |
| C5a.rules.16 | default |  | For long-running work, comment progress onto the Issue. | For long-running work, comment progress onto the Issue | CONVENTIONS.md | — |

### §5 Tracking issues — claimed but referenced, not closed

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.tracking.01 | default |  | A tracking issue may be claimed and referenced without closing; the merge message says Refs #N instead of Closes #N. | The merge message says `Refs #N` (links, does not auto-close) | CONVENTIONS.md | — |
| C5a.tracking.02 | default |  | A `tracking` label makes any session claiming the issue reference it automatically. | declarative and durable; any session claiming a labelled issue references it automatically | CONVENTIONS.md | — |
| C5a.tracking.03 | default |  | `colab ship --refs <N[,M]>` references an unlabelled issue explicitly, per ship. | explicit, per-ship, for an unlabelled issue | CONVENTIONS.md | — |
| C5a.tracking.04 | default |  | An issue kept open for a non-code leftover must also be parked in the same step. | must also be parked in the same step, or it reads as startable again | CONVENTIONS.md | #385 |
| C5a.tracking.05 | default |  | A leftover that is only a check a person must run: close the issue and add a row to the Human verify issue. | close it and add a row to the `Human verify:` issue | CONVENTIONS.md | — |
| C5a.tracking.06 | default |  | The claim is released unconditionally either way. | The claim is released unconditionally either way | CONVENTIONS.md | — |
| C5a.tracking.07 | default |  | `tracking` is deliberately not in the convention label set, so adoption does not provision it. | `tracking` is deliberately not in the convention label set | CONVENTIONS.md | — |
| C5a.tracking.08 | default |  | Do not write Closes #<tracking> in a commit body; GitHub closes on the keyword regardless of intent. | Do not write `Closes #<tracking>` in a commit body | CONVENTIONS.md | — |
| C5a.tracking.09 | default |  | `colab ship` detects a stray Closes on a tracking issue after the push and warns to reopen by hand. | `colab ship` detects this after the push and warns to reopen by hand | CONVENTIONS.md | — |
| C5a.tracking.10 | default |  | `ship` drops a stale Refs before the push when the same issue is now one of the branch's Closes. | `ship` drops the stale `Refs` before the push rather than shipping | CONVENTIONS.md | #58 |

### §5 Human verify — a person-only check closes the issue and becomes one row (#491)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.humanverify.01 | explanation |  | Why --refs plus a hold does not fit a person-only check: five finished issues sat open for days. | `--refs` + a hold was built for an issue with work still left in it. | docs/adr/491-human-verify-rationale.md | #491 |
| C5a.humanverify.02 | default |  | When the code is all on trunk and only a human check is left, the ship closes the issue with Closes #N, not --refs. | The ship closes the issue: `Closes #N`, not `--refs` | CONVENTIONS.md | #491 |
| C5a.humanverify.03 | default |  | In the same step, append one row (source issue, steps, evidence wanted) to the repo's single open Human verify issue. | it appends one row to the repo's single open issue titled | CONVENTIONS.md | #491 |
| C5a.humanverify.04 | default |  | If no Human verify issue is open, the ship files one labelled delivery:ops. | the ship files one, labelled `delivery:ops` so it is | CONVENTIONS.md | #491 |
| C5a.humanverify.05 | default |  | Where the repo declares a holds: label for human-owned waits, put it on the Human verify issue too. | Where the repo declares a `holds:` label | CONVENTIONS.md | #491 |
| C5a.humanverify.06 | default |  | A row that fails becomes a new bug issue linked to the source issue; the source issue stays closed. | A row that fails becomes a new bug issue | CONVENTIONS.md | #491 |
| C5a.humanverify.07 | default |  | The person ticks rows off, closes the Human verify issue with colab close when all are ticked; the next ship files a fresh one. | they close the `Human verify:` issue with `colab close` | CONVENTIONS.md | #491 |
| C5a.humanverify.08 | default |  | A code remainder still takes Remainder: #M (or --refs plus a hold). | A code remainder still takes `Remainder: #M` | CONVENTIONS.md | #491 |
| C5a.humanverify.09 | default |  | A tracking issue is still Refs #N. | A `tracking` issue is still `Refs #N`, as above. | CONVENTIONS.md | #491 |
| C5a.humanverify.10 | default |  | deferred:measurement is only for waits a machine can measure; a person looking is not a measurement. | `deferred:measurement` is only for waits a machine can measure | CONVENTIONS.md | #491 |

### §5 Provenance — who decided the work should exist

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.provenance.01 | explanation |  | Why provenance exists: issues arrive from three directions and nothing else records whether a human decided the work should happen. | Issues arrive from three directions: a person, an agent that hit something | docs/adr/89-provenance-and-ask-rationale.md | — |
| C5a.provenance.02 | default |  | An agent filing on its own initiative labels the issue agent-filed and ends the body with a Filed-by: line. | an agent filing on its own initiative labels the issue `agent-filed` and ends the | CONVENTIONS.md | — |
| C5a.provenance.03 | default |  | No label means a human filed it; no backfill of existing issues. | No label means a human filed it | CONVENTIONS.md | — |
| C5a.provenance.04 | default |  | Provenance is whose intent it was, not whose keyboard: transcribing a person's decision is Filed-by: boss with no label; an agent noticing a problem is agent-filed. | Provenance is whose intent it was, not whose keyboard | CONVENTIONS.md | — |
| C5a.provenance.05 | default |  | Write both the Filed-by: line (durable record) and the label (queryable). | The `Filed-by:` line is the durable record; the label makes it queryable | CONVENTIONS.md | — |
| C5a.provenance.06 | explanation |  | Why the label: anything starting work in bulk must be able to exclude work no human approved. | anything that starts work in bulk (a start button, batch triage, a scheduled | docs/adr/89-provenance-and-ask-rationale.md | — |

### §5 Ask — the filer declares the ask class (#89)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.ask.01 | explanation |  | Why an ask class: agent-filed does not say what decision the issue waits on; measured on a 34-item approve queue. | `agent-filed` says a human did not decide the work exists | docs/adr/89-provenance-and-ask-rationale.md | #89 |
| C5a.ask.02 | default |  | An agent-filed issue declares its ask class on an Ask: line: permission \| backlog \| ruling \| deferred(<trigger>). | Ask: permission \| backlog \| ruling \| deferred(<trigger>) | CONVENTIONS.md | #89 |
| C5a.ask.03 | default |  | permission: asking to touch machine or production state before proceeding. | asking to touch machine or production state before proceeding | CONVENTIONS.md | #89 |
| C5a.ask.04 | default |  | backlog: a work proposal to accept and schedule, and the default. | a work proposal to accept and schedule, not a decision itself | CONVENTIONS.md | #89 |
| C5a.ask.05 | default |  | ruling: resolves to human judgment, never startable as code. | resolves to human judgment, never startable as code | CONVENTIONS.md | #89 |
| C5a.ask.06 | default |  | A ruling issue's choices belong in a decision:options block. | A `ruling` issue's choices belong in a `decision:options` block | CONVENTIONS.md | #89 |
| C5a.ask.07 | default |  | deferred(<trigger>): no action needed now; the issue carries its own wake condition. | no action needed now; the issue carries its own wake | CONVENTIONS.md | #89 |
| C5a.ask.08 | default |  | An absent Ask: line means backlog. | Absent line means `backlog` | CONVENTIONS.md | #89 |
| C5a.ask.09 | default |  | Write the Ask: line at filing time, by whoever files, never reconstructed after the fact. | Written at filing time, by whoever files — never reconstructed after the fact | CONVENTIONS.md | #89 |
| C5a.ask.10 | default |  | The Ask: line appears only on agent-filed issues. | Appears only on `agent-filed` issues | CONVENTIONS.md | #89 |

### §5 Readiness — open and unclaimed is not enough

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.readiness.01 | default |  | An issue is ready to start only when open, unclaimed, and nothing it depends on is still missing. | An issue is ready to start only when open, unclaimed, | CONVENTIONS.md | — |
| C5a.readiness.02 | default |  | Record dependencies in GitHub's own relationship model: sub-issues for parent/child, blocked-by for a dependency. | dependencies are recorded in GitHub's own relationship model | CONVENTIONS.md | — |
| C5a.readiness.03 | default |  | A blocked_by edge records a dependency, never a queue position. | A `blocked_by` edge records a dependency, never a queue position | CONVENTIONS.md | #361 |
| C5a.readiness.04 | default |  | A queue position (someone wants A before B, nothing flowing between) is not an edge. | A queue position means someone wants A before B, with nothing flowing between them. | CONVENTIONS.md | #361 |
| C5a.readiness.05 | explanation |  | Why an order-only edge misleads: B inherits a wait parked on A; measured on a 10-node chain. | GitHub has one edge type, so an order-only edge looks exactly like | docs/adr/361-readiness-and-dependency-edges-rationale.md | #361 |
| C5a.readiness.06 | default |  | Record queue order as an ordered list in the ruling itself, which code-triage reads to rank ready groups. | Put it in the ruling itself, as an ordered list on the issue or epic | CONVENTIONS.md | #361 |
| C5a.readiness.07 | default |  | low-priority is the label for later. | `low-priority` (*Priority*, below) is the label for "later" | CONVENTIONS.md | #361 |
| C5a.readiness.08 | explanation |  | Rejected: an order-only edge that has to be re-threaded whenever a node parks. | Rejected: an order-only edge that has to be re-threaded whenever a node | docs/adr/361-readiness-and-dependency-edges-rationale.md | #361 |
| C5a.readiness.09 | default |  | File contention is never an edge. | File contention is never an edge (#371). | CONVENTIONS.md | #371 |
| C5a.readiness.10 | explanation |  | Why contention is stated separately: six design issues chained to serialise one docs index. | It is stated separately because it was the | docs/adr/361-readiness-and-dependency-edges-rationale.md | #371 |
| C5a.readiness.11 | default |  | A real collision is answered by Grouping: one group:<key> label, one branch, one review cycle, never a chain of edges. | one `group:<key>` label, one branch, one review cycle | CONVENTIONS.md | #371 |
| C5a.readiness.12 | default |  | A shared file every unit of work must edit is a design defect: fix the file, do not serialize the work (mixed). | A shared file that every unit of work must edit is a design defect. | CONVENTIONS.md | #371 |
| C5a.readiness.13 | default |  | An issue names the files it will edit on a Touches: line in its body. | An issue names the files it will edit on a `Touches:` line in its body | CONVENTIONS.md | #386 |
| C5a.readiness.14 | default |  | code-triage appends a live branch's held path to Touches: in the same step it reports the collision. | that path to `Touches:` in the same step it reports the collision | CONVENTIONS.md | #386 |
| C5a.readiness.15 | default |  | Split an issue at the external-wait line: the part the repo can build now becomes its own issue; the part behind the wait keeps the edge or the park. | Split an issue at the external-wait line (#371). | CONVENTIONS.md | #371 |
| C5a.readiness.16 | explanation |  | Why split: one issue bundled a buildable surface with a mode needing an outside API, holding back two more issues. | Measured: one issue bundled a surface the repo owned, whose | docs/adr/361-readiness-and-dependency-edges-rationale.md | #371 |
| C5a.readiness.17 | default |  | code-triage reports the split as a structural finding; it does not split the issue itself. | `code-triage` reports the split as a structural finding | CONVENTIONS.md | #371 |
| C5a.readiness.18 | default |  | colab owns the blocked_by write, taking issue numbers only, and reads back to confirm. | write a sequence — colab owns this write (#251); it takes NUMBERS ONLY, | CONVENTIONS.md | #251 |
| C5a.readiness.19 | default |  | removeSubIssue requires both ids. | a child cannot be detached by naming only itself | CONVENTIONS.md | — |
| C5a.readiness.20 | default |  | Sub-issues are GraphQL keyed by node id; dependencies are REST keyed by database id — the two halves do not share an API. | The two halves do not share an API, and that is the trap. | CONVENTIONS.md | — |
| C5a.readiness.21 | explanation |  | Why reading back matters: the REST endpoint accepted an issue number as a database id and attached a stranger's blocker. | Measured: `issue_id=34` silently attached a blocker | docs/adr/361-readiness-and-dependency-edges-rationale.md | #251 |
| C5a.readiness.22 | default |  | Read blockedBy back after every write. | Read `blockedBy` back after every write. | CONVENTIONS.md | — |
| C5a.readiness.23 | default |  | Read the confirmation from the blockedBy/blocking connections, never issueDependenciesSummary. | Read that confirmation from the `blockedBy`/`blocking` connections, never | CONVENTIONS.md | — |
| C5a.readiness.24 | default |  | "No blockers" and "nobody checked" are the same empty list; the second needs its own marker, deps-checked. | "No blockers" and "nobody checked" are the same empty list | CONVENTIONS.md | — |
| C5a.readiness.25 | default |  | Set deps-checked only after actually looking, with `colab readiness <N>`. | set only after actually looking | CONVENTIONS.md | — |
| C5a.readiness.26 | default |  | Clear deps-checked only for a genuinely new blocker or a reopened issue, never for "not now". | a genuinely NEW blocker appeared, or the issue reopened — never "not now" | CONVENTIONS.md | — |
| C5a.readiness.27 | default |  | deps-checked is monotonic: once set, it stays set. | `deps-checked` is monotonic (#279): once set, it stays set. | CONVENTIONS.md | #279 |
| C5a.readiness.28 | default |  | Clearing deps-checked means exactly one of two things: a new blocker appeared, or the issue reopened. | Clearing it means exactly one of two things | CONVENTIONS.md | #279 |
| C5a.readiness.29 | default |  | It never means startable in principle but not now; that fact has its own carrier (Disposition). | It never means "startable in principle, but not right now" | CONVENTIONS.md | #279 |
| C5a.readiness.30 | default |  | A prose note saying checked, no blockers does not count as setting deps-checked. | A prose note saying "checked, no blockers" does not count as setting it. | CONVENTIONS.md | #279 |

### §5 Readiness is not a boolean — read the blocker's state, not just its existence

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.boolean.01 | explanation |  | Why one verdict was not enough: an open blocker hid two situations (not started vs pushed awaiting merge). | An open blocker used to end the question. | docs/adr/361-readiness-and-dependency-edges-rationale.md | — |
| C5a.boolean.02 | default |  | The readiness verdict has three values plus the unchecked state, which is not a kind of ready. | So the verdict has three values, plus the | CONVENTIONS.md | #279 |
| C5a.boolean.03 | default |  | No relationship data at all: unchecked — not ready. | no relationship data at all | CONVENTIONS.md | — |
| C5a.boolean.04 | default |  | Open blocker nobody has started: blocked — name the blocker. | open, nobody has started it | CONVENTIONS.md | — |
| C5a.boolean.05 | default |  | Open blocker with code pushed and unmerged: ready, with a note. | open, code pushed and unmerged | CONVENTIONS.md | — |
| C5a.boolean.06 | default |  | Blocker closed or its work already on trunk: ready. | closed, or its work is already on trunk | CONVENTIONS.md | — |
| C5a.boolean.07 | default |  | Compute the middle value at read time; never record it as a second label. | The middle value is computed at read time, never recorded as a second label | CONVENTIONS.md | #279 |
| C5a.boolean.08 | default |  | An active session on the blocker is not evidence; a pushed branch with real commits is. | An active session on the blocker is not evidence — a pushed branch with real commits | CONVENTIONS.md | — |
| C5a.boolean.09 | explanation |  | Why a session is not evidence: a session open ten minutes was already dead. | Measured: a session open ten minutes | docs/adr/361-readiness-and-dependency-edges-rationale.md | — |
| C5a.boolean.10 | default |  | An unpushed branch does not count. | An unpushed branch does not count either | CONVENTIONS.md | — |
| C5a.boolean.11 | default |  | The judgement fails toward blocked, never toward ready. | The judgement fails toward `blocked`, never toward `ready` | CONVENTIONS.md | — |
| C5a.boolean.12 | default |  | Reference implementation: tools/lib/readiness.js (classify, isStartable), pure, deriving unmerged-code from landed.js. | Reference implementation: `tools/lib/readiness.js` (`classify`, `isStartable`), pure | CONVENTIONS.md | — |

### §5 Mechanical readiness — a weaker, honest claim for the empty case (#69)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.mechanical.01 | default |  | A mechanical check must never write deps-checked itself. | A mechanical check must never write `deps-checked` itself | CONVENTIONS.md | #69 |
| C5a.mechanical.02 | default |  | `colab readiness <N> --mechanical` reads blockedBy and, if empty, applies graph-empty and posts a receipt. | reads blockedBy; if empty, applies graph-empty + posts a receipt | CONVENTIONS.md | #69 |
| C5a.mechanical.03 | default |  | The mechanical check re-derives its own evidence on every run, not trusting a caller-supplied flag. | Re-derives its own evidence on every run, rather than trusting a caller-supplied | CONVENTIONS.md | #69 |
| C5a.mechanical.04 | default |  | The mechanical check posts a receipt naming what was read and when. | Posts a receipt naming what was read and when. | CONVENTIONS.md | #69 |
| C5a.mechanical.05 | default |  | The mechanical check reads blockedBy only, nothing about parent/child relations. | says nothing about parent/child relations | CONVENTIONS.md | #69 |
| C5a.mechanical.06 | default |  | classify() keeps graphEmpty and depsChecked distinct; empty-but-unchecked reads unchecked-mechanical and isStartable stays no. | empty-but-unchecked reads a fourth verdict, `unchecked-mechanical` | CONVENTIONS.md | #69 |
| C5a.mechanical.07 | default |  | graph-empty is not in the convention label set. | Not in the convention label set | CONVENTIONS.md | #69 |
| C5a.mechanical.08 | default |  | No readiness.marked event fires for --mechanical. | No `readiness.marked` event fires for `--mechanical` | CONVENTIONS.md | #45, #46 |

### §5 Disposition — a park must name its wake condition (#279)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.park.01 | explanation |  | Why a park needed its own carrier: clearing deps-checked reused the nobody-looked state to mean parked. | `deps-checked` (above) is monotonic: it records that triage looked, nothing more. | docs/adr/279-disposition-park-rationale.md | #279 |
| C5a.park.02 | default |  | Needs a human answer: needs-decision. | Needs a human answer | CONVENTIONS.md | #279 |
| C5a.park.03 | default |  | Blocked by another issue: a blockedBy edge; do not also clear deps-checked. | Blocked by another issue | CONVENTIONS.md | #279 |
| C5a.park.04 | default |  | Waiting on a date, measurement or external party: deferred:<kind> plus review-by:<date>. | Waiting on a date / measurement / external party | CONVENTIONS.md | #279 |
| C5a.park.05 | default |  | Not code delivery: a non-code delivery:* value. | Not code delivery | CONVENTIONS.md | #279 |
| C5a.park.06 | default |  | deferred:date is parked until a specific date, paired with review-by:<date>. | parked until a specific date. Pair with `review-by:<date>` | CONVENTIONS.md | #279 |
| C5a.park.07 | default |  | deferred:measurement names the metric and threshold, and a machine must be able to take the measurement. | Name the metric and the threshold on the issue. A machine must be able to take the measurement | CONVENTIONS.md | #279 |
| C5a.park.08 | default |  | A check only a person can run goes on the Human verify issue instead. | A check only a person can run goes on the `Human verify:` issue instead | CONVENTIONS.md | #491 |
| C5a.park.09 | default |  | deferred:external-party names who; when tracked, point the wake at it; when not, pair it with review-by. | parked until someone outside this repo acts. Name who. | CONVENTIONS.md | #279 |
| C5a.park.10 | default |  | A defer must name its wake condition; an unbounded park is a silent wontfix. | A defer must name its wake condition. | CONVENTIONS.md | #279 |
| C5a.park.11 | default |  | review-by:<date> is created on demand. | is created on demand, the same way `group:<key>` is | CONVENTIONS.md | #279 |
| C5a.park.12 | default |  | This section defines vocabulary only; consumer-side rendering is meant to land before the write. | This section defines vocabulary only. Landing it changes nothing | CONVENTIONS.md | #279 |
| C5a.park.13 | explanation |  | How deferred generalises the Ask deferred(<trigger>) line into a label pair. | gives it a machine-readable carrier: that line is free text, | docs/adr/279-disposition-park-rationale.md | #279 |

### §5 Holds — every label that stops a start names its owner and its wake (#360)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.holds.01 | explanation |  | The three recurring consumer hold kinds and the measurements (2026-09-24) behind this subsection. | `deferred:*` is not the only way work gets parked. | docs/adr/360-holds-rationale.md | #360 |
| C5a.holds.02 | default |  | The three consumer holds stay consumer-local, not adopted into the convention label set. | The three stay consumer-local. They are not adopted into the convention label set | CONVENTIONS.md | #360 |
| C5a.holds.03 | default |  | A "not yet" hold is a park: deferred:date plus review-by, or low-priority. | `deferred:date` + `review-by:<date>`, or `low-priority` | CONVENTIONS.md | #360 |
| C5a.holds.04 | default |  | A "needs rescope" hold fails Actionable in code-triage's readiness gate; rewriting the issue is the wake. | fails *Actionable* in `code-triage`'s readiness gate; rewriting the issue is the wake | CONVENTIONS.md | #360 |
| C5a.holds.05 | default |  | A "waiting on the operator" hold is needs-decision for a question, or a hold for an act. | `needs-decision` for a question | CONVENTIONS.md | #360 |
| C5a.holds.06 | default |  | A repo that already uses its own hold names keeps them. | A repo that already uses its own names keeps them | CONVENTIONS.md | #360 |
| C5a.holds.07 | default |  | Declare hold labels in .github/project.yml under holds:. | Declare them in `.github/project.yml`, so no reader has to guess: | CONVENTIONS.md | #360 |
| C5a.holds.08 | default |  | Every label listed under holds: blocks a start. | Every label listed under `holds:` blocks a start. | CONVENTIONS.md | #360 |
| C5a.holds.09 | default |  | code-triage reports an issue carrying a hold as blocked, never as ready. | `code-triage` reports an issue carrying one as blocked, never as ready | CONVENTIONS.md | #360 |
| C5a.holds.10 | default |  | The holds list lives in the descriptor, and changing it is a trunk commit. | The list lives in the descriptor. | CONVENTIONS.md | #360 |
| C5a.holds.11 | default |  | Absent holds means none declared; nothing infers a hold from a name. | Absent means none declared. | CONVENTIONS.md | #360 |
| C5a.holds.12 | default |  | Every hold names an owner and a wake condition when it is applied, deferred:* included. | Every hold names an owner and a wake condition when it is applied. | CONVENTIONS.md | #360 |
| C5a.holds.13 | default |  | Write one comment with two lines, a Hold: line and a Because: line. | Write one comment with two lines, the same shape | CONVENTIONS.md | #360 |
| C5a.holds.14 | default |  | owner: names who clears the hold and is never blank. | names who clears the hold: a login, or a role the repo's own docs define | CONVENTIONS.md | #360 |
| C5a.holds.15 | default |  | An owner is not an assignee, so it lives on the Hold: line. | An owner is not an assignee: an assignee without `in-progress` is a half-claim | CONVENTIONS.md | #360 |
| C5a.holds.16 | default |  | wake: is drawn from a small closed vocabulary; free text is never a wake. | is drawn from a small closed vocabulary | CONVENTIONS.md | #360 |
| C5a.holds.17 | default |  | The newest Hold: line for a label is the live one; clearing a hold is the owner removing the label. | The newest `Hold:` line for a label is the live one. | CONVENTIONS.md | #360 |
| C5a.holds.18 | default |  | The comment stays as history when a hold is cleared. | Clearing a hold is the owner removing the label once the wake fires. | CONVENTIONS.md | #360 |
| C5a.holds.19 | default |  | A hold that names no owner or no wake is a finding and never ready. | A hold that names no owner, or no wake, is a finding and never ready. | CONVENTIONS.md | #360 |
| C5a.holds.20 | default |  | code-triage prints a hold with no owner or wake as a STALL, first among its blocked lines. | prints it as a `STALL`, first among its blocked lines | CONVENTIONS.md | #360 |
| C5a.holds.21 | default |  | A deferred:* label with its wake but no Hold: line has no named owner, so it is a stall. | A `deferred:*` label that carries its wake but has no `Hold:` | CONVENTIONS.md | #360 |
| C5a.holds.22 | default |  | A legacy hold already on record is transcribed, not stalled. | A legacy hold already on record is transcribed, not stalled (#386). | CONVENTIONS.md | #386 |
| C5a.holds.23 | default |  | code-triage writes the Hold: line for a legacy hold: owner from the reason, wake review-by, Because: summarising. | `code-triage` writes it: owner from the reason, `wake: review-by:<date>`, | CONVENTIONS.md | #386 |
| C5a.holds.24 | default |  | The wake holds only the date; an "or" in the reason belongs in Because:. | an "or" in the reason belongs in `Because:` | CONVENTIONS.md | #386 |
| C5a.holds.25 | default |  | If the date, the reason or the owner is missing, the hold stays a stall for a human. | If the date, the reason or the owner is missing, the hold stays a stall for a human. | CONVENTIONS.md | #386 |

### §5 The wake: vocabulary — a wake a scheduler can check (#382)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.wake.01 | explanation |  | Why wake needed a checkable vocabulary: conditions came true and nothing noticed; four measured cases. | Until #382, `wake:` was one of three forms, | docs/adr/382-wake-vocabulary-rationale.md | #382 |
| C5a.wake.02 | default |  | wake: is one of the listed forms, and a scheduler can evaluate every form on every beat. | So `wake:` is now one of these, and a scheduler can evaluate every form on every beat: | CONVENTIONS.md | #382 |
| C5a.wake.03 | default |  | review-by:<date> is met when the date is reached; the label is on the issue too. | the date is reached. The `review-by:<date>` label is on the issue too. | CONVENTIONS.md | #382 |
| C5a.wake.04 | default |  | #N is met when the issue behind the blocked_by edge closes; the edge must exist. | the issue behind the `blocked_by` edge to `#N` closes | CONVENTIONS.md | #382 |
| C5a.wake.05 | default |  | ruling is met when the owner acts; the owner's act is removing the label. | the owner acts. `Because:` is the ask (below). | CONVENTIONS.md | #382 |
| C5a.wake.06 | default |  | issueClosed:<owner>/<repo>#<n> is met when that issue is closed. | that issue is closed. Use it for another repo's issue when no cross-repo edge is set. | CONVENTIONS.md | #382 |
| C5a.wake.07 | default |  | branchLanded:<ref> is met when the ref is an ancestor of trunk; where branches land by squash, wait on the issue or a landed commit instead. | `<ref>`, resolved as written, is an ancestor of trunk. | CONVENTIONS.md | #382 |
| C5a.wake.08 | default |  | trunkAt:<sha> is met when trunk contains the sha (7-40 hex). | trunk contains `<sha>` (7–40 hex) | CONVENTIONS.md | #382 |
| C5a.wake.09 | default |  | labelPresent:<label> is met when the held issue carries the label. | the held issue carries `<label>` | CONVENTIONS.md | #382 |
| C5a.wake.10 | default |  | after:<date> is met when the date is reached, the form a scheduler stores. | Same meaning as `review-by:`, in the form a scheduler stores | CONVENTIONS.md | #382 |
| C5a.wake.11 | default |  | ruling is the one definition of the waiting-on-the-operator reason line. | `ruling` is the one definition of the "waiting on the operator" reason line. | CONVENTIONS.md | #382 |
| C5a.wake.12 | default |  | When the wake is ruling, the Because: line is the ask itself. | the `Because:` line is the ask itself, written as what the owner has to | CONVENTIONS.md | #382 |
| C5a.wake.13 | default |  | A consumer's card reader does not invent a second syntax for the reason line. | A consumer's card reader parses this line and does not invent a second | CONVENTIONS.md | #382 |
| C5a.wake.14 | default |  | A question rather than an act belongs under needs-decision. | it belongs under `needs-decision` instead, where the answer gets a record of its own | CONVENTIONS.md | #382 |
| C5a.wake.15 | default |  | Every checkable wake name is spelled exactly as the adopting scheduler spells it. | Every checkable name above is spelled exactly the way the one | CONVENTIONS.md | #382 |
| C5a.wake.16 | explanation |  | Why session-liveness wake kinds are not adopted. | That scheduler also accepts two kinds about a live session | docs/adr/382-wake-vocabulary-rationale.md | #382 |
| C5a.wake.17 | default |  | A consumer evaluating a wake never invents a second spelling for a name on the list. | a consumer that evaluates a `wake:` never invents a second spelling for a name on this list | CONVENTIONS.md | #382 |
| C5a.wake.18 | default |  | tools/lib/wake.js is the parser and evaluator, and its tests pin the list. | `tools/lib/wake.js` is the parser and evaluator, and its tests pin the list. | CONVENTIONS.md | #382 |
| C5a.wake.19 | default |  | Several wake conditions on one line are ANDed. | Several conditions on one line are ANDed: | CONVENTIONS.md | #382 |
| C5a.wake.20 | default |  | A hold never wakes early on part of its condition; a line with one piece outside the vocabulary names no wake. | A hold never wakes early on part of its condition | CONVENTIONS.md | #382 |
| C5a.wake.21 | default |  | A wait on other work must use a checkable form; if the work has no issue yet, file one and point the hold at it. | A wait on other work must use one of the checkable forms. | CONVENTIONS.md | #382 |
| C5a.wake.22 | default |  | A wait with no checkable form stays prose in Because: and must carry review-by:<date>. | That wait must carry `review-by:<date>`. | CONVENTIONS.md | #382 |
| C5a.wake.23 | default |  | A wake naming an issue or ref that does not exist is a finding when it is written. | A `wake:` that names an issue or ref that does not exist is a finding when it is written | CONVENTIONS.md | #382 |
| C5a.wake.24 | default |  | A met wake does not lift the hold by itself; the scheduler posts once and hands the issue to triage, the owner removes the label. | A met wake does not lift the hold by itself. | CONVENTIONS.md | #382 |
| C5a.wake.25 | default |  | The evaluator proposes; it never clears. | The evaluator proposes; it never clears. | CONVENTIONS.md | #382 |
| C5a.wake.26 | default |  | Wakes are re-checked on every triage pass, not only once review-by: is reached. | Wakes are re-checked on every triage pass | CONVENTIONS.md | #382 |
| C5a.wake.27 | default |  | The wake rules apply to deferred:* and every label under holds: alike. | This applies to `deferred:*` and to every label declared under `holds:` alike | CONVENTIONS.md | #382 |
| C5a.wake.28 | default |  | Whoever parks the issue writes the Hold: line, and code-triage reads it. | Whoever parks the issue writes the line, and `code-triage` reads it | CONVENTIONS.md | #382 |
| C5a.wake.29 | default |  | The codec decodes only the exact Hold: line shape; a looser line names no owner or wake and stays a stall. | decodes only this exact shape | CONVENTIONS.md | #382 |
| C5a.shape.01 | default |  | shape: is optional, sits between owner: and wake: (never after wake:), and every new hold declares it. | Optional, between `owner:` and `wake:`, never after `wake:`; every new hold declares it. | CONVENTIONS.md | #569 |
| C5a.shape.02 | default |  | An owner choice is never a bare hold: it goes through needs-decision plus a decision:options block with a recommended option. | a **choice** between ways forward | CONVENTIONS.md | #569 |
| C5a.shape.03 | default |  | A task is an act only a person can perform; it is a hold with wake: ruling and Because: is the act. | an **act** only a person can perform | CONVENTIONS.md | #569 |
| C5a.shape.04 | default |  | A wait is a hold with a checkable wake: or review-by:<date>. | a hold with a checkable `wake:` or `review-by:<date>` | CONVENTIONS.md | #569 |
| C5a.shape.05 | default |  | Present shape: is used; absent is inferred from the wake (ruling -> ask, else wait); any other value is a finding that falls back to the inference. | absent → inferred from the wake as before | CONVENTIONS.md | #569 |
| C5a.shape.06 | explanation |  | Why shape: is declared, why a choice is never a bare hold, and why the field sits between owner: and wake:. | Measured on one installation: an owner's decision queue held 21 items. | docs/adr/569-hold-shape-rationale.md | #569 |

### §5 Disposition — the marker, the seven kinds, and who may apply one (#315)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5a.disposition.01 | default |  | A session does not dispose of its own issue. | A session does not dispose of its own issue. | CONVENTIONS.md | #315 |
| C5a.disposition.02 | default |  | A session does the work, posts evidence and proposes a disposition; a separate later pass applies it. | proposes a disposition; a separate later pass applies it | CONVENTIONS.md | #315 |
| C5a.disposition.03 | explanation |  | Why the separation: looking something up is not doing it; a session grading its own measurement. | That separation is the whole | docs/adr/315-disposition-kinds-rationale.md | #315 |
| C5a.disposition.04 | default |  | The proposal is a one-line colab:disposition marker followed by a one-line reason. | The proposal is a marker, one line, the family | CONVENTIONS.md | #315 |
| C5a.disposition.05 | default |  | The token is one of a closed set of seven, read by equality. | is one of a closed set of seven, read by equality | CONVENTIONS.md | #315 |
| C5a.disposition.06 | default |  | No disposition token is a prefix or decorated variant of another. | No token is a prefix or a decorated variant of another. | CONVENTIONS.md | #315 |
| C5a.disposition.07 | default |  | An unrecognised token, a missing marker, or two markers proposing different things all mean not cleared. | An unrecognised token, a missing marker, or two markers proposing different things all mean | CONVENTIONS.md | #315 |
| C5a.disposition.08 | default |  | Degrade, never gate applies: a comment with no marker is evidence with no proposal. | a comment with no marker is evidence with no proposal | CONVENTIONS.md | #315 |
| C5a.disposition.09 | default |  | The not planned kind uses the token not-planned. | its token is `not-planned`, because a token compared by equality cannot carry whitespace | CONVENTIONS.md | #315 |
| C5a.disposition.10 | default |  | done: the ask was executed and cross-checked; acceptance ticked or a remainder declared; closes with evidence. | The ask was executed and cross-checked; acceptance ticked, or a remainder declared | CONVENTIONS.md | #315 |
| C5a.disposition.11 | default |  | split: part landed and the remainder is filed as a native sub-issue; closes with evidence. | Part landed; the remainder is filed as a native sub-issue carrying the same | CONVENTIONS.md | #315 |
| C5a.disposition.12 | default |  | routed-out: the work belongs to another repo, whose issue exists and links back; closes with evidence. | The work belongs to another repo; `<other-repo>#N` exists and links back | CONVENTIONS.md | #315 |
| C5a.disposition.13 | default |  | hold: parked on a named wake condition; converts to deferred:<kind> plus a Hold: line with a wake from the closed vocabulary. | Parked on a named wake condition | CONVENTIONS.md | #315 |
| C5a.disposition.14 | default |  | needs-boss: a human must answer before anything else; converts to a recorded decision. | A human must answer before anything else can happen | CONVENTIONS.md | #315 |
| C5a.disposition.15 | default |  | not planned: superseded or abandoned; closes as not planned. | Superseded, or the direction was abandoned | CONVENTIONS.md | #315 |
| C5a.disposition.16 | default |  | leave: nothing decided; never applied by an agent — a nameable wake becomes hold, nothing to name is a finding. | never applied by an agent — a nameable wake ⇒ `hold`; nothing to name ⇒ a finding | CONVENTIONS.md | #315 |
| C5a.disposition.17 | default |  | An agent converts or reports leave and never leaves an issue; a human may leave with a reason that is itself the wake. | so an agent converts it or reports it, and never leaves it. | CONVENTIONS.md | #315 |
| C5a.disposition.18 | default |  | A human may leave with a reason; that reason is itself the wake condition. | A human may leave with a reason; that reason is itself the wake condition. | CONVENTIONS.md | #315 |
| C5a.disposition.19 | default |  | The evidence a marker rides on has a fixed shape: what was done, the command, the result, what remains. | The evidence a marker rides on has a fixed shape | CONVENTIONS.md | #315 |
| C5a.disposition.20 | default |  | Free-form evidence is a finding, not a disposition. | Free-form evidence is a **finding, not a disposition** | CONVENTIONS.md | #315 |
| C5a.disposition.21 | default |  | Where the ask was an action, a fifth line carries a second, independent, re-runnable cross-check. | a fifth line carries the cross-check: a second, independent, re-runnable | CONVENTIONS.md | #315 |
| C5a.disposition.22 | default |  | Who may apply a disposition is decided from measurable facts on the issue, never an agent's confidence. | decided from facts on the issue, never from an agent's own confidence in its work. | CONVENTIONS.md | #315 |
| C5a.disposition.23 | default |  | The two shared inputs gate only done and not planned, whose close asserts an outcome. | both gate only the two kinds whose close asserts an outcome | CONVENTIONS.md | #315 |
| C5a.disposition.24 | default |  | Axis of record: exposure released means a human confirms; none, self and live mean the agent applies. | `exposure: released` ⇒ a human confirms; `none`, `self` and `live` ⇒ the agent applies. | CONVENTIONS.md | #315 |
| C5a.disposition.25 | default |  | Read a legacy tier-only descriptor through the axis; a bare tier: B is no opinion, and no opinion is not permission. | a bare `tier: B` resolves to *no opinion*, and no opinion is not permission | CONVENTIONS.md | #315 |
| C5a.disposition.26 | default |  | Skip-fence class evidence (production, credentials, destructive, promotion) means human, whatever the exposure. | Evidence naming one of these ⇒ human, whatever the exposure. | CONVENTIONS.md | #315 |
| C5a.disposition.27 | default |  | The agent names the skip-fence classes its evidence touches; nothing sniffs prose for them. | The agent names the classes its evidence touches; nothing sniffs prose for them. | CONVENTIONS.md | #315 |
| C5a.disposition.28 | default |  | done is agent-applied only with fixed-shape evidence, a re-runnable cross-check, acceptance ticked, nothing open gated, the axis permitting and no skip-fence class. | evidence in the fixed shape ∧ a re-runnable cross-check recorded | CONVENTIONS.md | #315 |
| C5a.disposition.29 | default |  | split is agent-applied when the remainder is filed as a native sub-issue with the same delivery: and a wake; never human-only. | the remainder is filed as a native sub-issue with the same `delivery:` | CONVENTIONS.md | #315 |
| C5a.disposition.30 | default |  | routed-out is agent-applied when the other repo's issue exists and links back, obeying its language rule. | `<other-repo>#N` exists and links back to this issue | CONVENTIONS.md | #315 |
| C5a.disposition.31 | default |  | hold is agent-applied with a wake condition present; a wake standing 30 d unmoved needs a human to confirm or not-plan. | a wake condition is present — `review-by:<date>`, a real `blockedBy` edge, | CONVENTIONS.md | #315 |
| C5a.disposition.32 | default |  | needs-boss is never agent-applied: the agent records the question and moves on. | the agent records the question and moves on (record-first) | CONVENTIONS.md | #315 |
| C5a.disposition.33 | default |  | not planned is agent-applied only when superseded by a merged or closed replacement referencing this issue. | superseded by a merged or closed replacement that references this issue | CONVENTIONS.md | #315 |
| C5a.disposition.34 | default |  | leave is never agent-applied; the agent converts it. | the agent converts it (see above) | CONVENTIONS.md | #315 |
| C5a.disposition.35 | default |  | The disposition verdict fails towards human, always. | Fails towards `human`, always. | CONVENTIONS.md | #315 |
| C5a.disposition.36 | default |  | An agent may is never a human may not: a human can apply any disposition at any time. | "An agent may" is never "a human may not." | CONVENTIONS.md | #315 |
| C5a.disposition.37 | default |  | A mechanical gap is incomplete, not escalated; only outcome-asserting kinds escalate. | A mechanical gap is not a judgement call. | CONVENTIONS.md | #315 |
| C5a.disposition.38 | default |  | The reference implementation is tools/lib/disposition.js, pure: facts in, agent or human out. | The reference implementation is `tools/lib/disposition.js` | CONVENTIONS.md | #315 |
| C5a.disposition.39 | default |  | Two consumers must call one function or copy-and-own disposition.js, never keep two prose copies of the table. | only if both call one function, or copy-and-own that file | CONVENTIONS.md | #315 |
| C5a.disposition.40 | default |  | parseMarker / formatMarker are the only sanctioned way to read or write the disposition marker. | `parseMarker` / `formatMarker` are the only sanctioned way to read or write the marker | CONVENTIONS.md | #315 |
| C5a.disposition.41 | default |  | The disposition section defines vocabulary only; nothing here writes or reads colab:disposition. | This section defines vocabulary only**, exactly as the park above does. | CONVENTIONS.md | #315 |

#### #539 ledger — §5 Who holds this · Who decided it should exist · What may start (to the disposition marker)

Each entry lists the rule text of a unit whose rationale clause moved out (the unit's first line at `bc1100ea`). Every rule word stays; only the *because* clause, measurement or story moved, verbatim. No inventory key changed: every row's key is still a verbatim phrase of the new text.

- `CONVENTIONS.md:1990` — before: "The git remote is the one store every machine already shares, whatever the tracker is, so it is what a claim is refused against: a branch on the remote carrying" → after: "A claim is refused against the git remote: a branch on the remote carrying". Rationale → `docs/adr/539-claims-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2004` — before: "(#327) — one machine spells its hostname more than one way. The comment carries only a digest of that id: the raw id is a hardware serial, and on a public repo the comment is published." → after: "(#327). The comment carries only a digest of that id. Why, with the measurement: [ADR 539](docs/adr/539-claims-rationale.md).". Rationale → `docs/adr/539-claims-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2038` — before: "above — because a tracker can change or go down while the git remote is the store every machine already shares." → after: "above. Why, with the measurement: [ADR 539](docs/adr/539-claims-rationale.md).". Rationale → `docs/adr/539-claims-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2068` — before: ", so a qualifier can never be mistaken for `pass`)." → after: ").". Rationale → `docs/adr/539-claims-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2097` — before: "without closing — its checklist still has open items, and closing it would bury its knowledge. The merge" → after: "without closing. The merge". Rationale → `docs/adr/539-claims-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2114` — before: "in a commit body — GitHub closes on the keyword regardless of intent, and it cannot be un-closed by another keyword. `colab ship` detects" → after: "in a commit body. `colab ship` detects". Rationale → `docs/adr/539-claims-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2132` — before: "The source issue stays closed: its code shipped, and the failure is new work." → after: "The source issue stays closed.". Rationale → `docs/adr/539-claims-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2143` — before: "is not a measurement, and a `review-by:` date on it only hides whose turn it is." → after: "is not a measurement.". Rationale → `docs/adr/539-claims-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2196` — before: "and no tool can read them — measured: an epic tracking ~14 children by hand-edited checklist reported `subIssues.totalCount = 0`." → after: "and no tool can read them.". Rationale → `docs/adr/539-readiness-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2272` — before: "to move a child that already has a parent; verified live against the GraphQL schema, not restated from memory — `removeSubIssue` has neither.)" → after: "to move a child that already has a parent; `removeSubIssue` has neither.)". Rationale → `docs/adr/539-readiness-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2303` — before: ", and piling it onto this label is what #279 measured going wrong: `code-triage` clearing `deps-checked` to keep non-startable work out of the ready column, at a rate where more than half of one repo's untriaged-looking backlog was actually triaged work misreporting as untriaged." → after: ".". Rationale → `docs/adr/539-readiness-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2329` — before: "— rejected: a second label (stale the moment the blocker's own state moves — narrower a hazard than it once was, now that `deps-checked` itself is monotonic (#279) and only ever goes stale on a genuinely new blocker, but still a hazard a read-time computation avoids entirely); deleting the edge once code is written (destroys a true fact, doesn't survive a revert)." → after: ". Why, with the measurement: [ADR 539](docs/adr/539-readiness-rationale.md).". Rationale → `docs/adr/539-readiness-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2349` — before: ", because a prose-only blocker is invisible to a mechanical read and visible to a reader." → after: "."; and before: "— that launders a weaker guarantee into a stronger one." → after: ".". Rationale → `docs/adr/539-readiness-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2368` — before: "— that event kind's payload means `deps-checked` specifically (#45, #46); emitting it here would be indistinguishable from the stronger claim." → after: ". Why, with the measurement: [ADR 539](docs/adr/539-readiness-rationale.md).". Rationale → `docs/adr/539-readiness-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2400` — before: "— the date varies per issue, so there is no fixed set to provision up front." → after: ".". Rationale → `docs/adr/539-holds-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2403` — before: "— emitting the label before something renders it distinctly produces a park that is machine-readable and unread, which is worse than the silent park it replaces." → after: ". Why, with the measurement: [ADR 539](docs/adr/539-holds-rationale.md).". Rationale → `docs/adr/539-holds-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2428` — before: "keeps them, because its scheduler depends on them." → after: "keeps them.". Rationale → `docs/adr/539-holds-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2525` — before: "line, because a later ruling may have tightened the condition, and reports" → after: "line, and reports". Rationale → `docs/adr/539-holds-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2589` — before: "disposition**: a pass that cannot tell what was done from what remains cannot verify either, and applying anything on top of it is a guess wearing a marker. Where" → after: "disposition**. Where". Rationale → `docs/adr/539-disposition-marker-rationale.md`. Rows: none keyed (every key unchanged).
- `CONVENTIONS.md:2644` — before: "and no skill here reads it: the pass that applies a disposition is coupled to a consumer's own surfaces and lives with that consumer, not in a repo-generic handbook. What lives" → after: "and no skill here reads it. What lives". Rationale → `docs/adr/539-disposition-marker-rationale.md`. Rows: none keyed (every key unchanged).
### Decision gate — a human must answer first (#122)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5b.dg.01 | default |  | A designer producing a spec decides whether a surface needs human pre-approval and applies `needs-decision` if so. | A designer producing a spec decides, while producing it, whether a | CONVENTIONS.md | #122 |
| C5b.dg.02 | default |  | The pre-approval call is never inferred mechanically from title or labels. | the call belongs to whoever is producing the spec, never inferred mechanically from title or | CONVENTIONS.md | #122 |
| C5b.dg.03 | default |  | `needs-decision` blocks starting the issue, as a readiness gate, until a human answers and the answer is recorded. | blocks starting the issue — a readiness gate exactly like an open hard blocker | CONVENTIONS.md | #122 |
| C5b.dg.04 | default |  | No session, manual or scheduled, starts an issue that still carries `needs-decision`. | No session, manual or scheduled, starts an issue that still carries it. | CONVENTIONS.md | #122 |
| C5b.dg.05 | default |  | On a design-artifact issue, approving the artifact is not a question asked at filing. | On an issue whose deliverable is a design artifact, approving the artifact is not a | CONVENTIONS.md | #361 |
| C5b.dg.06 | default |  | At filing, `needs-decision` goes on such an issue only for a question that must be answered before design work starts. | goes on such an issue only for a question that must be | CONVENTIONS.md | #361 |
| C5b.dg.07 | default |  | Approval of the finished artifact is asked once the artifact exists, by the session that produced it, with a `Mockup:` line; with a ruling already recorded it goes through `colab decision --reopen`. | is asked once the artifact exists, by the session that produced it | CONVENTIONS.md | #379 |
| C5b.dg.08 | default |  | A `decision-recorded` that predates the review is not approval of the artifact. | A `decision-recorded` that predates the review is not approval of the artifact | CONVENTIONS.md | #379 |
| C5b.dg.09 | default |  | Promoting the artifact to `docs/design/` waits for a ruling recorded after the review. | waits for a ruling recorded after the review. | CONVENTIONS.md | #379 |
| C5b.dg.10 | explanation |  | A design issue carrying an earlier start ruling got a hand-added `needs-decision` and the lane read the earlier record as the approval. | Measured in one adopting repo: a design issue carrying an earlier | docs/adr/122-decision-gate-rationale.md | #379 |
| C5b.dg.11 | explanation |  | Eleven design issues held for about 4 h by a filing-time label with nothing to approve. | Measured in one adopting repo: 11 design issues each got `needs-decision` within 2 s | docs/adr/122-decision-gate-rationale.md | #361 |
| C5b.dg.12 | default |  | An epic never carries `needs-decision` and never a `decision:options` block. | An epic never carries `needs-decision`, and never a `decision:options` block | CONVENTIONS.md | #361 |
| C5b.dg.13 | explanation |  | A decision inbox may leave epics out, so a question on an epic goes unseen. | A decision inbox built on start gates may also leave | docs/adr/122-decision-gate-rationale.md | #361 |
| C5b.dg.14 | default |  | A question about an epic goes on its own decision issue carrying the question and any `decision:options` block. | goes on its own decision issue**, the same shape as the third | CONVENTIONS.md | #361 |
| C5b.dg.15 | default |  | The decision issue carries `needs-decision` and is attached to the epic as a sub-issue; a held-back child gets a `blocked_by` edge to it. | It carries `needs-decision`, and it is attached to the epic as a sub-issue. | CONVENTIONS.md | #361 |
| C5b.dg.16 | default |  | Once the ruling is recorded the decision issue closes with the record as its evidence. | the decision issue closes with the record as its evidence. | CONVENTIONS.md | #361 |
| C5b.dg.17 | hard | tools/colab::is an epic — an epic never carries | `colab decision --reopen` refuses on an `epic`-labelled issue and names the decision-issue path. | `colab decision --reopen` refuses on an `epic`-labelled issue and names this path. | CONVENTIONS.md | #361 |
| C5b.dg.18 | explanation |  | Why the epic's question is a sub-issue: it stays visible from the epic and from every inbox reading start gates. | Why a sub-issue: it keeps the question visible | docs/adr/122-decision-gate-rationale.md | #361 |
| C5b.dg.19 | default |  | A session discovering a significant design decision mid-work continues on the designer's spec rather than stopping to request a ruling. | A session discovering a significant design decision mid-work continues on the designer's spec | CONVENTIONS.md | #122 |
| C5b.dg.20 | default |  | Such a session records `design-not-preapproved` in its ship evidence. | records `design-not-preapproved` in its ship evidence | CONVENTIONS.md | #122 |
| C5b.dg.21 | default |  | Only when there is no usable default and the work cannot finish, the session files the ruling as its own issue and wires a `blocked_by` edge to it. | files the ruling as its own issue, wires a `blocked_by` edge | CONVENTIONS.md | #122 |
| C5b.dg.22 | default |  | The session keeps its claim while the ruling issue is open. | from the issue it is working, and keeps its claim | CONVENTIONS.md | #122 |
| C5b.dg.23 | default |  | The third path is not licence to stop on any fork; the usable-default case stays the ordinary rule. | This is not licence to stop on any fork | CONVENTIONS.md | #122 |
| C5b.dg.24 | default |  | Recording the decision clears the gate: a `⚖ Decision recorded` comment plus `decision-recorded`, written together by `colab decision --record`, never `needs-decision` cleared alone. | written together by `colab decision <N> --record --ruled-by <name>` — never | CONVENTIONS.md | #127 |
| C5b.dg.25 | default |  | A reader checks for `decision-recorded` or the live comment marker, never merely for `needs-decision`'s absence. | A reader checking whether an issue is decided looks for `decision-recorded` or the live | CONVENTIONS.md | #127 |
| C5b.dg.26 | default |  | A second question on a decided issue goes through `colab decision --reopen`, never a hand-added `needs-decision`. | A second question on an already-decided issue goes through `colab decision <N> --reopen --ruled-by | CONVENTIONS.md | #357 |
| C5b.dg.27 | explanation |  | A hand-added second label hid the question from a decision inbox for about nine hours. | Measured in one adopting repo: one such hand-added label hid the second question | docs/adr/122-decision-gate-rationale.md | #357 |
| C5b.dg.28 | default |  | Both labels at once is ambiguous and a reader resolves it by time. | Both labels at once is ambiguous, and a reader resolves it by time. | CONVENTIONS.md | #357 |
| C5b.dg.29 | default |  | Compare the newest ask with the newest live, trusted `⚖ Decision recorded` marker; the ask is the newest `needs-decision` labeled event or `decision:options` comment. | Compare the newest ask with the newest live, trusted `⚖ Decision recorded` marker. | CONVENTIONS.md | #357 |
| C5b.dg.30 | default |  | An ask newer than the marker is an open question, pending. | The ask is newer than the marker | CONVENTIONS.md | #357 |
| C5b.dg.31 | default |  | No live marker at all, only the label, is an open question. | No live marker at all, only the label | CONVENTIONS.md | #357 |
| C5b.dg.32 | default |  | When the label timeline was read and every ask predates the marker, the write was interrupted: finish it by removing `needs-decision`. | The label timeline was read, and every ask predates the marker | CONVENTIONS.md | #357 |
| C5b.dg.33 | default |  | Anything the reader cannot prove is undetermined and surfaced as pending, never hidden. | Anything the reader cannot prove (timeline unread, no event found) | CONVENTIONS.md | #357 |
| C5b.dg.34 | default |  | The reading leans towards showing the issue, like Readiness. | This leans towards showing the issue, like Readiness does. | CONVENTIONS.md | #357 |
| C5b.dg.35 | explanation |  | Showing a settled question costs a glance; hiding an open one costs a ruling. | Showing a settled question once more costs a glance. | docs/adr/122-decision-gate-rationale.md | #357 |
| C5b.dg.36 | hard | tools/colab::Recording over this pair must name the question it answers | `colab decision --record` refuses over the both-labels pair unless `--answers <ref>` names the question answered. | over the pair unless `--answers <ref>` says which question the new record answers | CONVENTIONS.md | #357 |

### Decision options — what a ruling chooses between (#126)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5b.do.01 | explanation |  | Options left as prose are unreadable by consumers and a recommendation reads like an acceptance. | Left as prose — headings, bullets, a sentence saying | docs/adr/126-decision-options-rationale.md | #126 |
| C5b.do.02 | default |  | The filer of a `needs-decision` issue writes the options as a fenced `decision:options` block at filing time. | The filer of a `needs-decision` issue writes the options as a fenced block | CONVENTIONS.md | #126 |
| C5b.do.03 | default |  | Each option is one `LETTER: label \| detail` line; detail is optional. | `LETTER: label \| detail`, one option per line; | CONVENTIONS.md | #126 |
| C5b.do.04 | default |  | The block needs two or more lines to count. | Two or more lines, or the block does not count | CONVENTIONS.md | #126 |
| C5b.do.05 | default |  | The block is an HTML comment fence. | An HTML comment fence, so it costs a human reader nothing | CONVENTIONS.md | #126 |
| C5b.do.06 | default |  | The block states the choices and never the answer. | The block states the choices. It never states the answer | CONVENTIONS.md | #126 |
| C5b.do.07 | default |  | The options block lives in the issue body by default; a re-posted block makes the newest by creation time live. | the newest block by creation time is the live one | CONVENTIONS.md | #126 |
| C5b.do.08 | default |  | Which block a recorded decision answers is named by `--answers <ref>`, never inferred from recency. | is never inferred from recency: `--answers <ref>` names it explicitly, | CONVENTIONS.md | #126 |
| C5b.do.09 | default |  | An absent block means options not declared, with no backfill. | no backfill, no new failure state for issues filed before this | CONVENTIONS.md | #126 |
| C5b.do.10 | default |  | A `needs-decision` question in neither shape is reported to its filer as a finding. | in neither shape is reported to its filer as a finding | CONVENTIONS.md | #379 |
| C5b.do.11 | default |  | That report is never a gate and never changes whether the question is pending. | That is a report, never a gate, and it never changes whether the question is pending. | CONVENTIONS.md | #379 |

### Design-approval ask — the `Mockup:` line (#379)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5b.da.01 | explanation |  | Design-approval asks posted as review comments read as unstructured and gated seven build issues. | The design lane did what the text said: it posted the frozen | docs/adr/379-design-approval-ask-rationale.md | #379 |
| C5b.da.02 | default |  | The design issue's body carries the approval ask as one `Mockup:` line. | The design issue's body carries the ask as one line: | CONVENTIONS.md | #379 |
| C5b.da.03 | default |  | The `Mockup:` line goes in the body, never only in a comment. | In the body, never only in a comment. | CONVENTIONS.md | #379 |
| C5b.da.04 | default |  | `Mockup:` is anchored at the start of a line and followed by the URL of the frozen image. | Anchored at the start of a line: `Mockup:`, then the URL of the frozen image. | CONVENTIONS.md | #379 |
| C5b.da.05 | default |  | A set reviewed together puts one `Mockup:` line in each member's body. | A set reviewed together (one review per workflow set) puts one `Mockup:` line in | CONVENTIONS.md | #379 |
| C5b.da.06 | default |  | Several `Mockup:` lines are allowed when one approval covers several frozen images. | Several lines are allowed when one issue's approval covers several | CONVENTIONS.md | #379 |
| C5b.da.07 | default |  | When both shapes are present, the options block is read. | Both shapes present read as the options block | CONVENTIONS.md | #379 |
| C5b.da.08 | default |  | On an issue already carrying `decision-recorded`, the ask still goes through `colab decision --reopen`. | the ask still goes through `colab decision <N> --reopen` | CONVENTIONS.md | #379 |
| C5b.da.09 | default |  | A `needs-decision` issue whose ask is in neither shape is a finding for its filer. | A `needs-decision` issue whose ask is in neither shape is a finding for its filer | CONVENTIONS.md | #379 |
| C5b.da.10 | default |  | `code-triage` and `code-sweep` report an unshaped ask and name the filer; they never rewrite the ask. | They do not rewrite the ask, because the question is not theirs to restate. | CONVENTIONS.md | #379 |

### An ask is said once — a later pass reports that it is still waiting (#489)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5b.as.01 | explanation |  | A coordinator re-rendering every ask on every pass buried the one copy a human might read. | On a repo blocked only on its operator, every pass added | docs/adr/489-ask-said-once-rationale.md | #489 |
| C5b.as.02 | default |  | An ask is open when the tracker already carries it as a pending `needs-decision` with a shape, or a newest `Hold:` line with `wake: ruling`. | The tracker already carries it. The issue has a pending `needs-decision` | CONVENTIONS.md | #489 |
| C5b.as.03 | default |  | An ask is also open when an earlier pass of the same skill already rendered it and stored it. | An earlier pass of the same skill already rendered it in its own output and stored | CONVENTIONS.md | #489 |
| C5b.as.04 | default |  | An open ask gets exactly one line on every later pass and its options are never rendered again. | An open ask gets exactly one line on every later pass. A pass never renders its options | CONVENTIONS.md | #489 |
| C5b.as.05 | default |  | The `<link>` in the one-liner is where the answer goes. | `<link>` is where the answer goes: the options-block comment, the `Hold:` line comment, | CONVENTIONS.md | #489 |
| C5b.as.06 | default |  | The `<date>` is when the ask was first put, never the date of this pass. | `<date>` is when the ask was first put. | CONVENTIONS.md | #489 |
| C5b.as.07 | default |  | A pass may append who clears the ask but never repeats the question, options or recommendation. | A pass may append who clears the ask. | CONVENTIONS.md | #489 |
| C5b.as.08 | default |  | A new ask is rendered once as a five-line card: question, options, recommendation, what stays parked, link. | A new ask is rendered once, as a five-line card: | CONVENTIONS.md | #489 |
| C5b.as.09 | default |  | A card is session output and never authorises a tracker comment a skill's write list does not name. | It never authorises a tracker comment that a skill's own write list does | CONVENTIONS.md | #489 |
| C5b.as.10 | default |  | Waiting on a human is not a change: age is never an input, and a pass never re-asks, escalates or re-renders for it. | It never re-asks, escalates or re-renders because time has passed. | CONVENTIONS.md | #489 |
| C5b.as.11 | default |  | A repo with no open human ask renders nothing new. | A repo with no open human ask renders nothing new. | CONVENTIONS.md | #489 |

### An ask the human must answer can be raised once in a decision box (#490)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5b.db.01 | default |  | The decision box is optional and set by the deployment; a skill reads its endpoint from a deployment setting. | A skill reads its endpoint from a deployment setting. | CONVENTIONS.md | #490 |
| C5b.db.02 | default |  | No host is ever written into a skill or into the handbook. | No host is ever written into a skill or into this handbook. | CONVENTIONS.md | #490 |
| C5b.db.03 | default |  | With no endpoint set, nothing changes and the ask stays on the issue. | No endpoint set means no change: | CONVENTIONS.md | #490 |
| C5b.db.04 | default |  | Only a human-only item is raised; an ask a coordinator can rule on is ruled on, not sent on. | Only a human-only item is raised. | CONVENTIONS.md | #490 |
| C5b.db.05 | default |  | Raising an item changes nothing on the issue; the tracker stays the record and the box only delivers. | The tracker stays the record. The box only delivers. | CONVENTIONS.md | #490 |
| C5b.db.06 | default |  | A box that is down loses a delivery, never the ask. | A box that is down, or never answers, loses a delivery, never the ask. | CONVENTIONS.md | #490 |
| C5b.db.07 | default |  | A raise carries everything needed to answer without opening the tracker. | A raise carries everything needed to answer without opening the tracker: | CONVENTIONS.md | #490 |
| C5b.db.08 | default |  | Raised options come from the issue's `decision:options` block, never re-derived. | taken from the issue's `decision:options` block, never re-derived; | CONVENTIONS.md | #490 |
| C5b.db.09 | default |  | A raise carries an opaque reply-to that the box hands back unchanged and never parses. | an opaque reply-to. The raiser composes it and the box hands it back unchanged with | CONVENTIONS.md | #490 |
| C5b.db.10 | default |  | An item is keyed by its issue link plus the date of its newest ask. | An item is identified by its issue link plus the date of its newest ask | CONVENTIONS.md | #490 |
| C5b.db.11 | default |  | Before raising, a pass looks for an earlier raise under that key in its stored asks and in the box. | Before raising, a pass looks for an earlier raise under that key. | CONVENTIONS.md | #490 |
| C5b.db.12 | default |  | An item already raised is not raised again; the pass writes the one-line unchanged form. | It does not raise the item again. | CONVENTIONS.md | #490 |
| C5b.db.13 | default |  | A newer ask on the issue is a new key and is raised once in turn. | A newer ask on the issue (a re-posted options block, a | CONVENTIONS.md | #490 |
| C5b.db.14 | default |  | The answer comes back as a comment on the issue and the raiser never polls. | The answer comes back as a comment on the issue, and the raiser never polls. | CONVENTIONS.md | #490 |
| C5b.db.15 | default |  | The raising skill never asks the box whether an answer has arrived. | The raising skill never asks the box whether an answer has arrived. | CONVENTIONS.md | #490 |
| C5b.db.16 | default |  | A comment answer is recorded as Decision gate requires before the gate lifts. | it is recorded as Decision gate requires before the gate lifts. | CONVENTIONS.md | #490 |
| C5b.db.17 | default |  | The box itself never removes a label or records a decision. | The box itself never removes a label or records a decision. | CONVENTIONS.md | #490 |

### The human flag — what `COLAB_HUMAN=1` asserts

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5b.hf.01 | default |  | `COLAB_HUMAN=1` asserts that a human is behind the command, and every gate site is one instance of that assertion. | Read every site below as an instance of the same assertion, never as a separate rule | CONVENTIONS.md | #233 |
| C5b.hf.02 | default |  | Promotion uses the flag to authorise the act that deploys to production. | authorises the act that deploys to production. | CONVENTIONS.md | #233 |
| C5b.hf.03 | default |  | The migration and red-trunk exemptions use the flag to authorise a write that did not exist before. | authorise a write that did not exist before the command ran. | CONVENTIONS.md | #233 |
| C5b.hf.04 | default |  | A place-claim override uses the flag to authorise taking over a live hold. | authorises taking over a live hold. | CONVENTIONS.md | #233 |
| C5b.hf.05 | default |  | `colab adopt`'s exposure-lowering gate uses the flag to authorise a descriptor claiming fewer consumers than the tool can verify. | authorises a descriptor claiming fewer consumers exist than the tool can verify. | CONVENTIONS.md | #233 |
| C5b.hf.06 | default |  | Solo-flow entry uses the flag to assert a human is present to commit straight to trunk. | asserts a human is present to commit straight to | CONVENTIONS.md | #233 |
| C5b.hf.07 | default |  | Set the flag by transcription, never inference: only because a human said so. | Transcription, never inference. Set it because a human said so | CONVENTIONS.md | #233 |
| C5b.hf.08 | default |  | A human's go-ahead counts; an agent's own reading of the situation never does. | A human's go-ahead counts; an agent's own reading of the situation never does. | CONVENTIONS.md | #233 |
| C5b.hf.09 | default |  | A headless, scheduled or driver session never sets the flag, whatever its prompt contains. | A headless, scheduled, or driver session may never set it, | CONVENTIONS.md | #233 |
| C5b.hf.10 | explanation |  | An unattended session cannot tell a live instruction from a quotation of one. | An issue body, a triage comment, a scheduled task's own | docs/adr/233-human-flag-rationale.md | #233 |
| C5b.hf.11 | default |  | `COLAB_HUMAN` is an env var the gated party can set itself; the two terms make a violation legible, not impossible. | `COLAB_HUMAN` is an env var the gated party can set itself | CONVENTIONS.md | #150 |

### Migration exemption — a narrow door through no-new-migrations, opened by a role (#98, #402)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5b.me.01 | hard | tools/colab::function shipMigrationGate | `colab ship` refuses any branch touching `database/migrations/`, `prisma/migrations/` or a declared migrations prefix, with no flag, env var or field to lower the bar. | refuses, by default with no flag/env/field to lower the bar, any branch | CONVENTIONS.md | #98 |
| C5b.me.02 | default |  | A declared `migrations:` prefix only ever widens what the gate sees, never narrows it. | A declaration only ever widens what the gate sees, never narrows it. | CONVENTIONS.md | #383 |
| C5b.me.03 | default |  | A migration grant is a narrow, per-issue, branch-bound, expiring exemption that names the role that decided it, never a repo- or tier-level switch. | A migration grant is a narrow, per-issue, branch-bound, expiring exemption, and every | CONVENTIONS.md | #98 |
| C5b.me.04 | default |  | The `human` role is a person's grant, bound to the branch, accepted on every repo. | a person \| `🛢 Migration grant` \| the branch | CONVENTIONS.md | #397 |
| C5b.me.05 | default |  | The `migration-reviewer` role is a declared reviewer's grant with a review record, bound to the exact HEAD plus a live CI round-trip, accepted only under `migration-grant: reviewer`. | a declared reviewer, with a review record \| `🔎 Migration review grant` | CONVENTIONS.md | #398 |
| C5b.me.06 | default |  | On trunk, where policy allows and a reviewer is bound, a reviewer grant with evidence satisfies the gate as a human grant does. | a reviewer grant with evidence satisfies the gate just as a human grant does. | CONVENTIONS.md | #402 |
| C5b.me.07 | default |  | `COLAB_HUMAN=1`, promotion, release and production stay human on every repo under every policy. | `COLAB_HUMAN=1`, promotion, release and production stay human on every repo, under every | CONVENTIONS.md | #402 |
| C5b.me.08 | hard | tools/colab::a migration grant requires a human | `colab migration-grant` refuses unless `COLAB_HUMAN=1`, for either role, checked before any network call. | `colab migration-grant` refuses (exit 1) unless | CONVENTIONS.md | #98 |
| C5b.me.09 | default |  | The reviewer role changes what a grant must prove, not who may post it. | The reviewer role changes what a grant must prove, not who may post it. | CONVENTIONS.md | #397 |
| C5b.me.10 | default |  | A grant is two parts: a `migration-granted` label and a comment naming the exact branch; it never authorises another branch. | Two required parts: a `migration-granted` label (requires write/triage permission) | CONVENTIONS.md | #98 |
| C5b.me.11 | default |  | A grant expires the instant its issue closes; `ship` reads the live open/closed state. | Expires the instant its issue closes — `ship` reads the issue's live open/closed | CONVENTIONS.md | #98 |
| C5b.me.12 | default |  | A grant is visible from any machine, with no local-only fallback. | Visible from any machine — no local-only fallback. | CONVENTIONS.md | #98 |
| C5b.me.13 | default |  | A grant covers the whole ship set, never narrowed by `--refs`; one issue without a valid grant fails the set. | Covers the whole ship set, never narrowed by `--refs`. | CONVENTIONS.md | #98 |
| C5b.me.14 | default |  | `--revoke` removes the label first, then posts a receipt. | `--revoke` removes the label first (gate restored immediately), then posts a receipt. | CONVENTIONS.md | #98 |
| C5b.me.15 | default |  | A revoke cancels every earlier grant on the issue, of either role, whoever posted it. | A revoke cancels every earlier grant on the issue, of either role, whoever posted it. | CONVENTIONS.md | #98 |
| C5b.me.16 | default |  | `colab migration-grant --list` names every live grant. | `colab migration-grant --list` names every live grant. | CONVENTIONS.md | #98 |
| C5b.me.17 | default |  | A grant never weakens any other precondition: CI green, claim corroboration, trunk-checkout and hand-merge checks still run in full. | Never weakens any other precondition — CI green, claim corroboration, trunk-checkout | CONVENTIONS.md | #98 |
| C5b.me.18 | default |  | `--batch` still refuses every member that carries a migration, granted or not. | `--batch` still refuses every member that carries a migration, granted or not. | CONVENTIONS.md | #98 |
| C5b.me.19 | explanation |  | The association class cannot tell a person from an agent running under its own account. | That class cannot tell a person from an agent that runs under | docs/adr/98-migration-exemption-rationale.md | #407 |
| C5b.me.20 | default |  | With `trust-humans:` declared, a human grant or ruling counts only when its author's login is listed. | a human grant or ruling counts only when its author's login is listed | CONVENTIONS.md | #407 |
| C5b.me.21 | default |  | For `migration-granted` and `ci-granted`, the account that last applied the label must be listed too. | the account that last applied the label must be listed too | CONVENTIONS.md | #407 |
| C5b.me.22 | default |  | An unlisted, unknown or unreadable author is not human, and the refusal names the login. | An unlisted, unknown or unreadable author is not human, and the | CONVENTIONS.md | #407 |
| C5b.me.23 | default |  | With `trust-humans:` absent, the association class decides as before. | the association class decides, exactly as before. | CONVENTIONS.md | #407 |
| C5b.me.24 | default |  | Ship reads the `trust-humans` list from `project.yml` at the tip of the target, and rulings read trunk's; a branch cannot add its own author. | Ship reads the list from `project.yml` at the tip of the branch being merged into, | CONVENTIONS.md | #407 |
| C5b.me.25 | default |  | Editing the `trust-humans` list is a human act. | Editing the list is a human act | CONVENTIONS.md | #407 |
| C5b.me.26 | default |  | A reviewer grant is not judged by the `trust-humans` list. | A reviewer grant is not judged by this list. | CONVENTIONS.md | #407 |
| C5b.me.27 | default |  | The human role is branch-bound, not HEAD-bound, and honoured on every repo; where both roles are live a valid human grant wins. | Where both roles are live on an issue, a valid human grant wins. | CONVENTIONS.md | #98 |
| C5b.me.28 | default |  | The reviewer role names the reviewer's declared identity and carries a `migration-review` record. | names the reviewer's declared identity and carries a review record: | CONVENTIONS.md | #397 |
| C5b.me.29 | default |  | A reviewer grant is bound to the migration content id, not the commit. | The grant covers that content, not that commit. | CONVENTIONS.md | #508 |
| C5b.me.30 | default |  | The content id is a sha256 over the path and git blob id of every migration file the branch changes at the reviewed HEAD. | The content id is a sha256 over the path and git | CONVENTIONS.md | #508 |
| C5b.me.31 | default |  | Editing, adding, removing or renaming a migration changes the content id and voids the grant. | Editing, adding, removing or renaming a migration changes the id and voids it. | CONVENTIONS.md | #508 |
| C5b.me.32 | explanation |  | Ship's stale-base sync voided a commit-bound grant every time, so the grant binds migration content. | ship's stale-base rule (#395) makes a branch merge trunk in before it ships | docs/adr/98-migration-exemption-rationale.md | #508 |
| C5b.me.33 | default |  | A record with no content id stays bound to its HEAD alone, and a new commit voids it. | stays bound to its HEAD alone, and a new commit voids it as before. | CONVENTIONS.md | #508 |
| C5b.me.34 | default |  | `migration-grant: reviewer` is read from the trunk checkout when a grant is minted, so a branch cannot raise its own policy. | is read from the trunk checkout when a | CONVENTIONS.md | #397 |
| C5b.me.35 | default |  | `colab migration-grant` refuses to mint a reviewer grant where the policy is not `reviewer`. | `colab migration-grant` refuses to mint a reviewer grant anywhere else. | CONVENTIONS.md | #397 |
| C5b.me.36 | default |  | A reviewer grant is recorded only if the review passed: approve, checklist, escalation and CI round-trip. | The record must approve, pass the checklist, clear the escalation and pass the CI round-trip. | CONVENTIONS.md | #397 |
| C5b.me.37 | default |  | A failing review is refused, not recorded. | A failing review is refused, not recorded. | CONVENTIONS.md | #397 |
| C5b.me.38 | default |  | A claimed pass is checked before anything is written: the round-trip job ran and passed at the recorded HEAD and the checklist count matches. | A claimed pass is checked too, before anything is written | CONVENTIONS.md | #457 |
| C5b.me.39 | default |  | A repo whose CI has no round-trip job cannot mint a reviewer grant at all. | A repo whose CI has no round-trip job cannot mint a reviewer grant at all | CONVENTIONS.md | #457 |
| C5b.me.40 | default |  | The reviewer id and recorded CI result are claims, so a gate re-verifies CI for the recorded HEAD itself. | The reviewer id and the recorded CI result are claims made in the | CONVENTIONS.md | #397 |
| C5b.me.41 | hard | tools/colab::function shipMigrationGate | `colab ship` honours a reviewer grant only when policy P, record M, HEAD and round-trip R all hold. | honours a reviewer grant only when four conditions hold together (#401): | CONVENTIONS.md | #401 |
| C5b.me.42 | default |  | P: `migration-grant: reviewer` in `project.yml` at the tip of the branch being merged into; the branch's own copy never counts. | `migration-grant: reviewer` in `project.yml` at the tip of the branch | CONVENTIONS.md | #401 |
| C5b.me.43 | default |  | M: a live reviewer marker from a trusted author, bound to this branch, with a valid record. | A live reviewer marker from a trusted author, bound to this branch, | CONVENTIONS.md | #401 |
| C5b.me.44 | default |  | HEAD: the local branch must agree with the remote head, and the grant binds that head or the same migrations id. | Ship reads the branch's head on the remote, and the local branch must agree | CONVENTIONS.md | #508 |
| C5b.me.45 | default |  | R: the live CI round-trip must have passed on the shipped head. | The live CI round-trip passed on the shipped head, which after a | CONVENTIONS.md | #401 |
| C5b.me.46 | default |  | Ship re-reads CI itself and never trusts the recorded `ci-roundtrip:` value. | Ship re-reads CI itself | CONVENTIONS.md | #401 |
| C5b.me.47 | default |  | Every round-trip leg needs a run that completed with success and ran at least one step. | Every leg needs a run that completed with success and ran at least one step. | CONVENTIONS.md | #401 |
| C5b.me.48 | default |  | A copy of the round-trip job that counts added files only must be re-synced before a reviewer grant relies on it. | re-sync it before a reviewer grant | CONVENTIONS.md | #507 |
| C5b.me.49 | default |  | A branch that edits `.github/workflows/` cannot pass R and ships on a human grant. | a branch that edits `.github/workflows/` cannot pass it either. | CONVENTIONS.md | #401 |
| C5b.me.50 | default |  | If any condition fails, the gate behaves as it does without a reviewer grant. | If any condition fails, the gate behaves exactly as it does without a reviewer grant: | CONVENTIONS.md | #401 |
| C5b.me.51 | default |  | One function makes the reviewer-grant decision for every ship path. | One function makes this decision for every ship path | CONVENTIONS.md | #401 |
| C5b.me.52 | default |  | `needs-migration-grant` is the gate's plan-time half, not a second gate, and authorises nothing by itself. | is this gate's plan-time half, not a second gate (#230). | CONVENTIONS.md | #230 |

### A red trunk with no patch — never parked in silence (#390)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5b.rt.01 | default |  | A green, finished branch is never parked behind trunk CI while there is neither an open accepted `TRUNK RED:` issue nor a re-run in flight. | A green, finished branch is never parked behind trunk CI while there is neither an | CONVENTIONS.md | #390 |
| C5b.rt.02 | default |  | An issue diagnosing the red under another title, or still `agent-filed`, does not count as the patch. | An issue that diagnoses the red under another title, or still carries `agent-filed`, does not count | CONVENTIONS.md | #390 |
| C5b.rt.03 | default |  | Triage's full pass adopts such an issue: it retitles it and drops `agent-filed`. | The full pass adopts such an issue: it retitles it | CONVENTIONS.md | #430 |
| C5b.rt.04 | default |  | The scheduled driver re-runs once per red sha, only for a docs-lane-only red commit with no `TRUNK RED:` issue open. | Once per red sha, only when the red commit's diff is docs-lane-only | CONVENTIONS.md | #390 |
| C5b.rt.05 | default |  | The scheduled driver is the only re-run actor for a red trunk. | It is the only re-run actor for a red trunk | CONVENTIONS.md | #390 |
| C5b.rt.06 | default |  | Triage files `TRUNK RED: <sha> fails <check>` when the re-run was tried or cannot apply and no accepted issue is open. | triage files `TRUNK RED: <sha> fails <check>` — or comments | CONVENTIONS.md | #390 |
| C5b.rt.07 | default |  | Triage files, comments or adopts at most once per red sha. | adopts an open issue that already diagnoses the sha — at most once per red sha. | CONVENTIONS.md | #390 |
| C5b.rt.08 | default |  | Triage never re-runs a job itself. | triage never re-runs a job itself. | CONVENTIONS.md | #390 |
| C5b.rt.09 | explanation |  | A known-flake red on a docs-only commit parked a green branch for 1 h 45 min. | Measured: a red from a known flake class, on a docs-only commit, parked a green | docs/adr/390-red-trunk-no-patch-rationale.md | #390 |

### Red-trunk exemption — the one-shot door through trunk-CI-green (#105)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5b.re.01 | explanation |  | A bad CI grant merges into a repo whose own test suite is known-failing, so it is more dangerous than a migration grant. | Same shape as a migration grant, strictly more dangerous — a bad migration grant merges | docs/adr/105-red-trunk-exemption-rationale.md | #105 |
| C5b.re.02 | default |  | A red-trunk grant has two roles, `human` and `ci-reviewer`, and the repo says which it accepts. | Two roles, as for a migration grant (#504). | CONVENTIONS.md | #504 |
| C5b.re.03 | hard | tools/colab::a CI grant requires a human | A `human` red-trunk grant requires `COLAB_HUMAN=1`, for minting and revoking. | a person, `COLAB_HUMAN=1` \| `🚨 Red-trunk CI grant` \| the branch and the red trunk sha | CONVENTIONS.md | #105 |
| C5b.re.04 | default |  | A `ci-reviewer` grant is the coordinator agent's, with a review record, bound to the exact HEAD and the red trunk sha. | the coordinator agent, with a review record | CONVENTIONS.md | #504 |
| C5b.re.05 | explanation |  | The maintainer ruled the coordinator owns a red trunk end to end, including this exemption. | The reviewer role exists because the maintainer ruled (2026-10-05) that the coordinator | docs/adr/105-red-trunk-exemption-rationale.md | #504 |
| C5b.re.06 | hard | tools/colab::Without that opt-in a CI grant is human-only ; tools/colab::a CI grant requires a human | A `ci-reviewer` grant mints without `COLAB_HUMAN=1` only where trunk's committed `project.yml` declares `ci-grant: reviewer`; revoking stays human. | and only where trunk's committed `project.yml` declares the opt-in (a branch cannot opt itself in) | CONVENTIONS.md | #504 |
| C5b.re.07 | default |  | Every reviewer-grant guard is measured at mint, nothing taken from the flags. | Every guard is measured at mint, nothing is taken from the | CONVENTIONS.md | #504 |
| C5b.re.08 | default |  | The review record carries `verdict: pass`, the reviewed `head`, the `red` sha and the `cures`. | carries `verdict: pass`, the reviewed `head`, the `red` sha and the | CONVENTIONS.md | #504 |
| C5b.re.09 | default |  | `ship` re-measures issue, title, opt-in, red sha, branch green at that head and cures still red. | `ship` re-measures all of it — issue, title, opt-in at the merge target, | CONVENTIONS.md | #504 |
| C5b.re.10 | default |  | An optional `not-before` makes the grant not yet usable until it passes. | honours an optional `not-before` (a revoke window the host imposes) by reading the grant as | CONVENTIONS.md | #504 |
| C5b.re.11 | default |  | The reviewer identity is declared, not attested. | The reviewer identity is declared, not attested — the same caveat as | CONVENTIONS.md | #504 |
| C5b.re.12 | hard | tools/lib/ci-grant.js::function evaluateIssue | A red-trunk grant is bound to one issue, the branch and the exact red trunk sha, and expires when trunk's head moves. | Bound to one issue, the branch, AND the exact red trunk sha reviewed against — it expires | CONVENTIONS.md | #105 |
| C5b.re.13 | hard | tools/lib/ci-grant.js::function evaluateIssue | A red-trunk grant requires a completed, successful CI run for the branch's own current head sha, measured not asserted. | creating one requires a completed, successful CI run for the branch's own current head sha | CONVENTIONS.md | #105 |
| C5b.re.14 | default |  | `--evidence-run` is recording-only and never substitutes for the measured run. | `--evidence-run` is recording-only and never substitutes for the measured run. | CONVENTIONS.md | #105 |
| C5b.re.15 | hard | tools/lib/ci-grant.js::function stackingVerdict | A red-trunk grant never stacks: it refuses against a green trunk and again after a prior grant merged while trunk stayed red. | refuses against a green trunk, and refuses again if a prior grant | CONVENTIONS.md | #105 |
| C5b.re.16 | default |  | A grant-authorised merge carries a `CI-Grant:` trailer in the squash commit and a tracker comment. | A grant-authorised merge carries a `CI-Grant:` trailer in the squash commit itself, | CONVENTIONS.md | #105 |
| C5b.re.17 | default |  | A red-trunk grant exempts exactly one precondition, trunk-CI-green, never the others or `colab promote`. | Scoped to exactly one precondition (trunk-CI-green) — never exempts | CONVENTIONS.md | #105 |
| C5b.re.18 | default |  | A red-trunk grant is trunk-only, not for integration lines. | or `colab promote`. Trunk-only — | CONVENTIONS.md | #105 |
### Cure rule — the machine-checkable door through trunk-CI-green (#281)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.cure.01 | default |  | `colab ship` fires the cure door automatically when trunk-CI-green fails HUMAN_GATED, and falls through to the ordinary ci-grant when any condition is not met. | falls straight through to the ordinary ci-grant when any condition below is not met | CONVENTIONS.md | #281 |
| C5c.cure.02 | hard | tools/lib/ci-cure.js::does not contain trunk's current red head | Condition 1: the branch must contain trunk's current red head sha as an ancestor. | contains trunk's current red head sha as an ancestor | CONVENTIONS.md | #281 |
| C5c.cure.03 | hard | tools/lib/ci-cure.js::branch has no completed, successful CI run at its own current head | Condition 2: the branch's own CI must be green at its own current head, measured, never asserted. | the branch's own CI is green at its own current head, measured, never asserted | CONVENTIONS.md | #281 |
| C5c.cure.04 | hard | tools/lib/ci-cure.js::a cure may not make the failing job disappear | Condition 2b: every job red on trunk's runs at the red sha must exist on the branch's runs at that head, completed and concluded success. | exists in the branch's runs at that head, completed and concluded `success` | CONVENTIONS.md | #297 |
| C5c.cure.05 | default |  | The cure is scoped to trunk's red set: an advisory job failing only on the branch does not refuse it. | It is scoped to trunk's red set, so an advisory job failing only on the branch does not refuse | CONVENTIONS.md | #297 |
| C5c.cure.06 | default |  | A job instance from a workflow_dispatch run counts for 2b only under the #510 rules. | counts here only under the #510 rules | CONVENTIONS.md | #510 |
| C5c.cure.07 | hard | tools/lib/ci-cure.js::anti-stacking verdict unavailable | Condition 3: the same anti-stacking guard as ci-grant must hold - no prior grant or cure merged while trunk stayed continuously red. | the same anti-stacking guard ci-grant uses holds | CONVENTIONS.md | #281 |
| C5c.cure.08 | hard | tools/lib/ci-cure.js::a new failure is not progress ; tools/lib/ci-cure.js::no progress | Condition 3 admission: a further cure passes when trunk's red-job set at its current red sha is a strict subset of the set the prior exemption was measured against; an unchanged set or any new red job refuses. | a further cure passes condition 3 when trunk's red-job set at its current red sha | CONVENTIONS.md | #477 |
| C5c.cure.09 | default |  | The progress admission belongs to the cure rule only; a human ci-grant create keeps the plain guard. | a human `ci-grant` create keeps the plain guard | CONVENTIONS.md | #477 |
| C5c.cure.10 | hard | tools/lib/ci-cure.js::the cure rule refuses to let a branch self-certify | Condition 4: the branch diff must not touch .github/workflows/** (a human ci-grant otherwise, unless the carve-out admits it). | the branch diff does not touch `.github/workflows/**` | CONVENTIONS.md | #281 |
| C5c.cure.11 | default |  | Read the diff without rename detection, so moving a workflow file out of the directory counts as touching it. | The diff is read without rename detection | CONVENTIONS.md | #297 |
| C5c.cure.12 | hard | tools/lib/ci-cure.js::so it is part of the instrument grading this branch | Condition 5: the branch diff must not change the scripts block of any package.json. | the branch diff does not change the `scripts` block of any `package.json` | CONVENTIONS.md | #297 |
| C5c.cure.13 | default |  | Any package.json at any depth counts; key order does not, a changed command does, and deleting or renaming a manifest counts. | at any depth counts | CONVENTIONS.md | #297 |
| C5c.cure.14 | hard | tools/lib/ci-cure.js::there is no carve-out for this case | Condition 5 has no carve-out. | is no carve-out for this condition | CONVENTIONS.md | #297 |
| C5c.cure.15 | hard | tools/lib/ci-cure.js::a lifecycle hook added | Condition 5 admission: an add-only change passes when every touched manifest exists on both sides, keeps every script with an identical command and only adds keys, and every step that ran in each red job on trunk ran on the branch and concluded success. | keeps every script it had with an identical command, and only adds keys | CONVENTIONS.md | #475 |
| C5c.cure.16 | hard | tools/lib/ci-cure.js::a lifecycle hook added | An added npm lifecycle hook is never admitted by the add-only change. | is never admitted | CONVENTIONS.md | #475 |
| C5c.cure.17 | hard | tools/lib/ci-cure.js::not add-only — a script removed, renamed | A removed, renamed or changed script, a new manifest, or an add-only change beside another change in a different manifest still refuses. | A removed, renamed or changed script, a new manifest, and an add-only change | CONVENTIONS.md | #475 |
| C5c.cure.18 | hard | tools/lib/ci-cure.js::will not let a branch change them and grade itself | Condition 6: the branch diff must not change a Python dependency manifest. | the branch diff does not change a Python dependency manifest | CONVENTIONS.md | #377 |
| C5c.cure.19 | default |  | What counts as a Python dependency manifest: pyproject.toml, setup.py, setup.cfg, requirements .txt/.in files, and any file one of those pulls in, read from both sides of the diff. | What counts, at any depth: `pyproject.toml`, `setup.py`, `setup.cfg` | CONVENTIONS.md | #377 |
| C5c.cure.20 | default |  | Lockfiles are not read by the template and do not count. | Lockfiles are not read by the template and do not count | CONVENTIONS.md | #377 |
| C5c.cure.21 | hard | tools/lib/ci-cure.js::not pin-only | Condition 6 has no carve-out; its one narrow admission is a pin-only change that differs only in version specifier or hash of requirements at the same position. | When every touched manifest exists on both sides and differs only in the version specifier | CONVENTIONS.md | #476 |
| C5c.cure.22 | hard | tools/lib/ci-cure.js::comes after trunk's failure point and was skipped on the branch | A pin-only change also requires that no step after the last one that ran on trunk is skipped on the branch. | no step after the last one that ran on trunk may be `skipped` on the branch | CONVENTIONS.md | #476 |
| C5c.cure.23 | default |  | A pyproject.toml is read only inside its dependency arrays; every other byte must match. | A `pyproject.toml` is read only inside its dependency arrays | CONVENTIONS.md | #476 |
| C5c.cure.24 | hard | tools/lib/ci-cure.js::not pin-only | setup.py and setup.cfg are never pin-only. | `setup.py` (code) and `setup.cfg` are never pin-only | CONVENTIONS.md | #476 |
| C5c.cure.25 | hard | tools/lib/ci-cure.js::an unmeasured diff is never a cure | An unmeasurable diff (failed read, unparseable manifest, symlinked manifest) refuses. | a manifest that is a symlink — refuses, the same as any other unmeasured signal | CONVENTIONS.md | #297 |
| C5c.cure.26 | default |  | Order of checks: 1, 2, 2b, 3, diff measurable, 5, 6, then 4 with its carve-out. | checks: 1 → 2 → 2b → 3 → diff measurable → 5 → 6 → 4 | CONVENTIONS.md | #297 |
| C5c.cure.27 | default |  | The workflow carve-out is one guarded door through condition 4, not a relaxation of it: a workflow-touching branch may still cure on top of 1-3 and 5 when 4a, 4b and 4c all hold. | A workflow-touching branch may still cure when, on top of 1-3 | CONVENTIONS.md | #321 |
| C5c.cure.28 | hard | tools/lib/ci-cure.js::a cure may not make the failing job disappear | 4a: every job red on trunk's run at the red sha must exist on the branch's own green run, completed and concluded success. | exists on the branch's own green run, completed and concluded `success` | CONVENTIONS.md | #321 |
| C5c.cure.29 | default |  | Since #297 4a is condition 2b and applies to every cure; 4b and 4c stay the carve-out's alone. | this sub-test is condition 2b and applies to **every** cure | CONVENTIONS.md | #297 |
| C5c.cure.30 | hard | tools/lib/ci-cure.js::a step skipped away is not a step repaired | 4b: every step that ran on trunk must be present on the branch's job and concluded success. | is present on the branch's job and concluded `success` | CONVENTIONS.md | #321 |
| C5c.cure.31 | default |  | Steps after the failing one are skipped on trunk and constrain nothing; only steps that ran do. | one are `skipped` on trunk and so constrain nothing | CONVENTIONS.md | #321 |
| C5c.cure.32 | hard | tools/lib/ci-cure.js::too fast to have done the work | 4c: each of those jobs must have cost at least the wall time its failure did on trunk. | Each of those jobs cost at least the wall time its failure did on trunk | CONVENTIONS.md | #321 |
| C5c.cure.33 | hard | tools/lib/ci-cure.js::could not be read — an unmeasurable step list is never a cure | Anything unmeasurable in the carve-out (no job evidence, empty red-job set, unreadable step list, missing duration) refuses. | a missing duration — **refuses**, exactly as before | CONVENTIONS.md | #321 |
| C5c.cure.34 | default |  | A main-only workflow's red can be cured on dry-run evidence: the template's dry run is dispatched on the fix branch and runs the same job with every external write off. | The template therefore offers a dry run: dispatched on the fix branch | CONVENTIONS.md | #474 |
| C5c.cure.35 | default |  | A dry run makes no promotion, tag, Release, push or dispatch; only [publish] steps are skipped. | No promotion, tag, Release, push or dispatch happens | CONVENTIONS.md | #474 |
| C5c.cure.36 | default |  | A sentinel step marks a job instance as a dry run and runs only in dry-run mode. | runs only in that mode, and it is what marks a job instance as a dry run | CONVENTIONS.md | #474 |
| C5c.cure.37 | hard | tools/lib/ci-cure.js::a dry run is admissible only step by step | D1: both step lists (trunk's ran-steps and the dry run's steps) must be measurable. | both step lists are measurable: trunk's ran-steps and the dry run's steps | CONVENTIONS.md | #474 |
| C5c.cure.38 | hard | tools/lib/ci-cure.js::a dry run cannot cure a red in a step it does not execute | D2: every step that ran on trunk, the failing one included, must conclude success in the dry run. | every step that ran on trunk, the failing one included, concluded `success` in the dry run | CONVENTIONS.md | #474 |
| C5c.cure.39 | hard | tools/lib/ci-cure.js::is not a publishing step | D3: every step the dry run did not run to success must be a skipped publishing step. | every step the dry run did not run to success is a skipped | CONVENTIONS.md | #474 |
| C5c.cure.40 | default |  | A green ordinary instance of the same job outranks a dry one, so the D-rules apply only when a dry run is the sole evidence. | outranks a dry one, so the D-rules apply only when a dry run is the sole evidence | CONVENTIONS.md | #474 |
| C5c.cure.41 | default |  | `colab ship` dispatches the dry run once, never waits and never dispatches from --dry or --dry --json. | It never waits, and it never dispatches from `--dry` or `--dry --json` | CONVENTIONS.md | #474 |
| C5c.cure.42 | default |  | Dispatch is gated on a static read of the branch's copy: it must have a name:, a dry_run input and the sentinel step. | it must have a `name:`, a `dry_run` input and the sentinel step | CONVENTIONS.md | #474 |
| C5c.cure.43 | hard | tools/lib/ci-cure.js::a dry run cannot cure a red in a step it does not execute | A red in a [publish] step, or in the npm/deploy jobs, cannot be cured by a dry run and stays a ci-grant. | cannot be cured by a dry run and stays a ci-grant | CONVENTIONS.md | #474 |
| C5c.cure.44 | default |  | A dispatch instance is the job's 2b (and 4a) evidence only when W1 to W6 all hold on top of 2b's own tests. | on top of 2b's own tests, all of | CONVENTIONS.md | #510 |
| C5c.cure.45 | hard | tools/lib/ci-cure.js::a display name is not proof of that | W1: the dispatch run's workflow id must equal the red run's; either id missing refuses. | The dispatch run's workflow id equals the red run's | CONVENTIONS.md | #510 |
| C5c.cure.46 | hard | tools/lib/ci-cure.js::evidence counts only at the head being shipped | W2: the dispatch run must be at the branch's evidence head sha; a row at any other sha is never evidence. | The dispatch run is at the branch's evidence head sha | CONVENTIONS.md | #510 |
| C5c.cure.47 | default |  | W3: the event must be workflow_dispatch; ordinary instances are unchanged. | is `workflow_dispatch`. Ordinary instances are unchanged | CONVENTIONS.md | #510 |
| C5c.cure.48 | default |  | W4: the job must have completed with success and no other instance at the head may be red or pending. | no other instance at the head red or pending | CONVENTIONS.md | #510 |
| C5c.cure.49 | hard | tools/lib/ci-cure.js::a job that reports success with that step skipped has not run it | W5: every step that went red on trunk must be present by exact name in the dispatch instance and conclude success. | is present by exact name in the dispatch instance and concluded `success` | CONVENTIONS.md | #510 |
| C5c.cure.50 | default |  | A trunk red with no red step leaves W5 nothing to check, and W4 decides. | leaves W5 nothing to check, and W4 decides | CONVENTIONS.md | #510 |
| C5c.cure.51 | default |  | W6: match per job by exact name; matrix shards match by expanded names and nothing matches by prefix. | one green shard never covers another; nothing matches by prefix | CONVENTIONS.md | #510 |
| C5c.cure.52 | default |  | W1 and W2 also apply to a dry run whose run reports workflow_dispatch. | W1 and W2 apply to a #474 dry run as well | CONVENTIONS.md | #510 |
| C5c.cure.53 | default |  | A green ordinary instance outranks a green dispatch instance, which outranks a green dry run; each rule set applies only when that instance is the job's sole evidence. | which outranks a green dry run: each rule set applies only when that instance | CONVENTIONS.md | #510 |
| C5c.cure.54 | default |  | When a cure refuses at 2b only because red jobs are absent or skipped in a qualifying workflow and every later condition holds, ship dispatches it once with no inputs, and never waits. | **once** (`gh workflow run <file> --ref <branch>`, no inputs). It never waits | CONVENTIONS.md | #510 |
| C5c.cure.55 | default |  | Ship never dispatches from --dry or --dry --json, which report ciCure.dispatchWanted. | never dispatches from `--dry` or `--dry --json`, which report `ciCure.dispatchWanted` | CONVENTIONS.md | #510 |
| C5c.cure.56 | default |  | Wait with colab ci-wait sized to the job, then re-run ship. | sized to the job, then re-run ship | CONVENTIONS.md | #510 |
| C5c.cure.57 | hard | tools/lib/ci-cure.js::there is no carve-out for this case | The package.json scripts block is condition 5, not part of the carve-out, and must not be folded into it. | and must not be folded into it | CONVENTIONS.md | #297 |
| C5c.cure.58 | default |  | Where workflows never fire for a branch ref, that round is a PR, for the patch only; a bystander waits for green. | Where workflows never fire for a branch ref, that round is a PR | CONVENTIONS.md | #353 |
| C5c.cure.59 | default |  | A bystander does not rebase onto the red and does not open a PR: it waits for green. | A bystander does not rebase onto the red and does not open a PR | CONVENTIONS.md | #353 |
| C5c.cure.60 | default |  | A cured merge carries a CI-Cure: trailer instead of CI-Grant:, naming the branch, the red trunk sha it contained and the evidence run sha. | A cured merge carries a `CI-Cure:` trailer instead of `CI-Grant:` | CONVENTIONS.md | #281 |
| C5c.cure.61 | default |  | The trailer and the --dry --json payload name which door was used: a carve-out cure appends via workflow-carve-out jobs and reports ciCure.via. | A cure admitted through the carve-out appends | CONVENTIONS.md | #321 |
| C5c.cure.62 | default |  | A dry-run cure appends via dry-run jobs and reports ciCure.dryRun; a refusal reports ciCure.dryRunWanted. | A cure proven by a dry run (#474) appends | CONVENTIONS.md | #474 |
| C5c.cure.63 | default |  | A dispatch cure appends via dispatch jobs and reports ciCure.dispatch; a refusal reports ciCure.dispatchWanted. | A cure proven by a `workflow_dispatch` run (#510) appends | CONVENTIONS.md | #510 |
| C5c.cure.64 | default |  | ciCure.provenJobs lists the red jobs 2b proved passing; a consumer reads it rather than re-deriving a verdict from check-runs. | lists the red jobs | CONVENTIONS.md | #297 |
| C5c.cure.65 | default |  | A cure admitted under #475/#476 appends admitted add-only-scripts and/or pin-only-requirements and reports ciCure.admitted. | A cure that changed a manifest under #475/#476's admissions appends | CONVENTIONS.md | #475 |
| C5c.cure.66 | default |  | A cure that passed condition 3 by progress appends after-progress healed and reports ciCure.progress. | A cure that passed condition 3 by progress (#477) appends | CONVENTIONS.md | #477 |
| C5c.cure.67 | default |  | `colab ci-grant`'s anti-stacking scan recognises either the CI-Grant: or the CI-Cure: trailer as an exemption already merged against the red. | anti-stacking scan now recognises either trailer | CONVENTIONS.md | #281 |
| C5c.cure.68 | default |  | The cure rule is scoped identically to the grant: trunk-only, and never exempts anything but trunk-CI-green. | never exempts anything but trunk-CI-green | CONVENTIONS.md | #281 |
| C5c.expl.01 | explanation |  | Rationale moved to the ADR: Condition 1. | A ci-grant's evidence guard checks the branch's own head is | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.02 | explanation |  | Rationale moved to the ADR: Condition 2b. | A green run alone never proved the check trunk is | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.03 | explanation |  | Rationale moved to the ADR: Condition 3, progress admission. | A trunk with two independent failures, or a fix that | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.04 | explanation |  | Rationale moved to the ADR: Condition 5. | The Node CI template does not hardcode what it measures: | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.05 | explanation |  | Rationale moved to the ADR: Condition 6. | The Python CI template runs ruff, mypy and pytest only | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.06 | explanation |  | Rationale moved to the ADR: Condition 6. | The whole file counts, not a block: in Python the | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.07 | explanation |  | Rationale moved to the ADR: Condition 6, pin-only admission. | That is the answer to a pin dropping a transitively | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.08 | explanation |  | Rationale moved to the ADR: Order of checks. | Conditions 5 and 6 come before 4 because the carve-out | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.09 | explanation |  | Rationale moved to the ADR: Workflow carve-out (#321). | Worse, the human is measurably the wrong judge here: a | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.10 | explanation |  | Rationale moved to the ADR: Carve-out 4b. | This is the structural, primary sub-test: it embeds no constant | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.11 | explanation |  | Rationale moved to the ADR: Carve-out 4c. | The comparison is against a measurement taken in the same | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.12 | explanation |  | Rationale moved to the ADR: Dry-run evidence (#474). | `release-auto.yml` fires after trunk CI or on a schedule, so | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.13 | explanation |  | Rationale moved to the ADR: Dry-run evidence (#474). | It is also what keeps the dry run from being | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.14 | explanation |  | Rationale moved to the ADR: Dry-run evidence (#474). | A dry run that also skipped an ordinary step past | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.15 | explanation |  | Rationale moved to the ADR: Dry-run evidence (#474). | The marker is a step name on purpose. Steps are | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.16 | explanation |  | Rationale moved to the ADR: Dispatch evidence (#510). | The workflow runs on a branch push, but one of | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.17 | explanation |  | Rationale moved to the ADR: Dispatch evidence (#510), W1. | Ids are per workflow file and the same on every | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.18 | explanation |  | Rationale moved to the ADR: Dispatch evidence (#510), W5. | Deliberately not the full executed-step superset (D2/4b): a cache-conditional step | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.19 | explanation |  | Rationale moved to the ADR: Why the door needs no human step. | Conditions 1+2 together mean the branch's tree passed the full | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.20 | explanation |  | Rationale moved to the ADR: Honest limits and accepted false refusals. | Honest limit, not glossed over: test-file self-weakening (gutting the failing | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.21 | explanation |  | Rationale moved to the ADR: Instrument paths. | Two instrument paths, two different doors. What is named once | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.22 | explanation |  | Rationale moved to the ADR: Containment. | Containment costs a fresh CI round, by design. Requiring the | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.23 | explanation |  | Rationale moved to the ADR: Trailer. | This is not decoration: anti-stacking permits one exemption per continuous | docs/adr/281-cure-rule-rationale.md | — |
| C5c.expl.24 | explanation |  | Rationale moved to the ADR: Group branches. | Group branches get simpler under this door. A ci-grant on | docs/adr/281-cure-rule-rationale.md | — |

#### #539 ledger — slice D (§5 decision gate, human flag, migration, red trunk, cure rule)

- `CONVENTIONS.md:2651` — before: "`needs-decision` (named `needs-ruling` before #122; widened because 'ruling' read narrower than the gate actually covers) marks that." → after: "`needs-decision` marks that.". Rationale → `docs/adr/539-decision-gate-rationale.md`. Rows: C5b.dg.01, C5b.dg.02 (keys intact).
- `CONVENTIONS.md:2695` — before: "in its ship evidence — so the closure itself is what a human reviews, after the fact. This default" → after: "in its ship evidence. This default". Rationale → `docs/adr/539-decision-gate-rationale.md`. Rows: C5b.dg.19, C5b.dg.20.
- `CONVENTIONS.md:2710` — before: "remember.** Measured failure (#127): a ruling was posted as ordinary prose in a comment and the `needs-decision` label removed by hand. A later triage pass, reading the issue fresh, saw no machine-readable trace of a decision, re-gated it, and reported it not-startable — the ruling had been sitting in the comment the whole time. **A cleared label is indistinguishable from a label never applied.** So the answer," → after: "remember.** The answer,". Rationale → `docs/adr/539-decision-gate-rationale.md`. Rows: C5b.dg.24, C5b.dg.25.
- `CONVENTIONS.md:2771` — before: "does not count** — a one-option decision is not a decision." → after: "does not count**.". Rationale → `docs/adr/539-decision-gate-rationale.md`. Rows: C5b.do.04.
- `CONVENTIONS.md:2937` — before: "**a human is behind this command.** ⚖ #233 widened it to this single statement, covering both uses it already had and one it gained. Read every" → after: "**a human is behind this command.** Read every". Rationale → `docs/adr/539-human-flag-rationale.md`. Rows: C5b.hf.01.
- `CONVENTIONS.md:2954` — before: "not just statable** — the same standard `code-ship` already holds itself to, restated here as the general rule rather than one skill's local convention:" → after: "not just statable**:". Rationale → `docs/adr/539-human-flag-rationale.md`. Rows: C5b.hf.07.
- `CONVENTIONS.md:2972` — before: "never narrows it; a repo keeping migrations elsewhere without declaring them is a repo whose gate reads `no new migrations ✓` on a backfill." → after: "never narrows it.". Rationale → `docs/adr/539-migration-rationale.md`. Rows: C5b.me.01, C5b.me.02 (key updated).
- `CONVENTIONS.md:2998` — before: "naming the exact branch (labels cap at 50 chars, cannot carry a branch name)." → after: "naming the exact branch.". Rationale → `docs/adr/539-migration-rationale.md`. Rows: C5b.me.10.
- `CONVENTIONS.md:3004` — before: "One issue without a valid grant fails the set: a migration cannot be attributed to one member of a group branch." → after: "One issue without a valid grant fails the set.". Rationale → `docs/adr/539-migration-rationale.md`. Rows: C5b.me.13.
- `CONVENTIONS.md:3054` — before: "when a grant is minted, so a branch cannot raise its own policy." → after: "when a grant is minted.". Rationale → `docs/adr/539-migration-rationale.md`. Rows: C5b.me.34, C5b.me.35.
- `CONVENTIONS.md:3080` — before: "cannot pass it either, because a branch must not rewrite the job that grades it." → after: "cannot pass it either.". Rationale → `docs/adr/539-migration-rationale.md`. Rows: C5b.me.45, C5b.me.46, C5b.me.49 (key updated).
- `CONVENTIONS.md:3100` — before: "alongside `migration-granted` for the same malignant-absence reason, but … a schema migration, so the grant request surfaces before `ship` ever has a reason to refuse." → after: "alongside `migration-granted`, but … a schema migration.". Rationale → `docs/adr/539-migration-rationale.md`. Rows: C5b.me.52.
- `CONVENTIONS.md:3116` — before: "does not count: nobody will pick it up as the patch." → after: "does not count.". Rationale → `docs/adr/539-red-trunk-rationale.md`. Rows: C5b.rt.02.
- `CONVENTIONS.md:3124` — before: "**only** re-run actor for a red trunk: two actors each allowed one re-run per sha make two, and a green second run can bury a real defect (" → after: "**only** re-run actor for a red trunk (". Rationale → `docs/adr/539-red-trunk-rationale.md`. Rows: C5b.rt.04, C5b.rt.05 (key updated).
- `CONVENTIONS.md:3175` — before: "**Trunk-only** — an integration line's red already borrows trunk's advisory verdict when the line has no runs of its own; widening the exemption to lines is a deliberately unmade decision." → after: "**Trunk-only**.". Rationale → `docs/adr/539-red-trunk-rationale.md`. Rows: C5b.re.17, C5b.re.18 (key updated).
- `CONVENTIONS.md:3188` — before: "as an ancestor — proof the branch was built against the exact failure, not merely conflict-free with it." → after: "as an ancestor.". Rationale → `docs/adr/539-cure-rationale.md`. Rows: C5c.cure.02.
- `CONVENTIONS.md:3190` — before: "does not refuse: the rule certifies that the branch cures trunk's red, not that the branch is spotless. A job" → after: "does not refuse. A job". Rationale → `docs/adr/539-cure-rationale.md`. Rows: C5c.cure.04, C5c.cure.05.
- `CONVENTIONS.md:3198` — before: "An **unchanged** set refuses (the prior exemption fixed nothing that stayed fixed), and so … even if another healed — trading one red for another is the loop this condition exists to break." → after: "An **unchanged** set refuses, and so … even if another healed.". Rationale → `docs/adr/539-cure-rationale.md`. Rows: C5c.cure.07, C5c.cure.08.
- `CONVENTIONS.md:3216` — before: "at any depth counts (the template's working directory is an adopter's edit point, and workspace runners read nested scripts); … only *adds* keys, the template runs more, never less — so it passes … is never admitted — it runs inside a step that already exists and can rewrite what that step measures with no name changing." → after: "at any depth counts; … only *adds* keys, it passes … is never admitted.". Rationale → `docs/adr/539-cure-rationale.md`. Rows: C5c.cure.12, C5c.cure.13 (key updated), C5c.cure.15, C5c.cure.16 (key updated).
- `CONVENTIONS.md:3251` — before: "of it.** The repair for a CI-*infrastructure* outage is, by construction, a workflow change: when trunk goes red because the runner pool cannot reach a service container, the branch that fixes it necessarily edits `.github/workflows/**` and was therefore permanently cure-ineligible however green it was — leaving a mechanically-verifiable repair waiting on a human who may not be watching. So a workflow-touching" → after: "of it.** A workflow-touching". Rationale → `docs/adr/539-cure-rationale.md`. Rows: C5c.cure.27 (key updated).
- `CONVENTIONS.md:3269` — before: "its failure did on trunk. 4b proves the *steps* ran; it cannot see a step's `run:` body gutted to a no-op inside the very workflow file being carved for, and duration is the only signal that touches that." → after: "its failure did on trunk.". Rationale → `docs/adr/539-cure-rationale.md`. Rows: C5c.cure.32.
- `CONVENTIONS.md:3336` — before: "It never waits — the job may take hours, and ship measures up to three times per invocation — and never" → after: "It never waits and never". Rationale → `docs/adr/539-cure-rationale.md`. Rows: C5c.cure.54, C5c.cure.55.
- `CONVENTIONS.md:3387` — before: "already merged against this red', so a repo that has used both doors is scanned as one continuous stacking history rather than two independent ones." → after: "already merged against this red'.". Rationale → `docs/adr/539-cure-rationale.md`. Rows: C5c.cure.67.

### Scheduled drivers — provenance and autonomy meet a caller that is not a person

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.drivers.01 | default |  | A scheduler inherits the provenance gate, re-applied on every tick, not filtered once. | It inherits the provenance gate, re-applied on every tick, not filtered once | CONVENTIONS.md | — |
| C5c.drivers.02 | default |  | agent-filed issues are excluded from what a scheduler starts, every run. | `agent-filed` issues are excluded from what a scheduler starts, every run | CONVENTIONS.md | — |
| C5c.drivers.03 | default |  | epic-labelled issues are excluded from what a scheduler starts. | `epic`-labelled issues are excluded. | CONVENTIONS.md | — |
| C5c.drivers.04 | default |  | needs-decision issues are excluded from what a scheduler starts. | even if the work item itself is human-filed | CONVENTIONS.md | — |
| C5c.drivers.05 | default |  | The only admission past those exclusions is a human act recording the decision (colab decision --record). | The only admission is a human act recording the decision | CONVENTIONS.md | — |
| C5c.drivers.06 | default |  | A scheduler may never infer an answer from content, age or repeat proposal, and never treats the label's absence as an answer. | a scheduler may never infer an answer from content, age, or repeat proposal | CONVENTIONS.md | — |
| C5c.drivers.07 | default |  | needs-decision beside decision-recorded is not an admission; it is resolved by the pair rule and stays excluded unless a write is proven interrupted. | *beside* `decision-recorded` is not an admission | CONVENTIONS.md | — |
| C5c.drivers.08 | default |  | An agent-filed issue whose Ask: reads ruling or permission is excluded. | whose `Ask:` reads `ruling` or `permission` is excluded | CONVENTIONS.md | — |
| C5c.drivers.09 | default |  | A scheduler starts work only by spawning ordinary sessions; it may not claim, label, comment or merge directly. | A scheduler starts work only by spawning ordinary sessions | CONVENTIONS.md | — |
| C5c.drivers.10 | hard | tools/colab::function shipAutonomyGate ; templates/pre-push-guard::COLAB_SHIP:-}" != "1" | A scheduler may complete a trunk merge only where the repo has granted autonomy: auto-trunk (or ship measures the change docs-only), and only through colab ship. | It may complete a trunk merge only where the repo has granted `autonomy: auto-trunk` | CONVENTIONS.md | — |
| C5c.drivers.11 | hard | tools/colab::HUMAN_GATED | A scheduler's ship is subject to the identical gates as any other caller; without a proven cure or the grant, ship refuses and a human runs Phase B. | subject to the identical gates as any other caller | CONVENTIONS.md | — |
| C5c.drivers.12 | hard | tools/colab::HUMAN_GATED | A genuinely red trunk with no proven cure and no valid CI grant is human-gated, not self-clearing. | is human-gated, not self-clearing | CONVENTIONS.md | — |
| C5c.drivers.13 | default |  | A scheduler must not queue and wait on a human-gated red trunk: it parks, states it once, and stops. | it parks, states it once, and stops | CONVENTIONS.md | — |
| C5c.drivers.14 | hard | tools/lib/ci-grant.js::is not a human's | A scheduler never mints a ci-grant itself; only the cure rule's mechanical door is available to it unattended. | A scheduler never mints a ci-grant itself either way | CONVENTIONS.md | — |
| C5c.drivers.15 | default |  | On a repo declaring ci-grant: reviewer a coordinator session that reviewed the cure may mint a ci-reviewer grant; the scheduler only reads it through colab ship. | may mint a `ci-reviewer` grant | CONVENTIONS.md | #504 |
| C5c.drivers.16 | hard | tools/colab::NEVER tags, NEVER promotes ; templates/pre-push-guard::COLAB_PROMOTE | A scheduler never promotes, on any repo or tier, except the release workflow through colab promote --auto on deploy: tag with promotion: main-loop. | Never promotes, on any repo, on any tier | CONVENTIONS.md | #440 |
| C5c.drivers.17 | hard | tools/colab::NEVER tags, NEVER promotes ; templates/pre-push-guard::COLAB_PROMOTE | A scheduler never tags by any path but the release workflow's two commands (release cut --auto, release finalize --auto), and nothing else it runs tags. | never tags by any path but the release workflow's two commands | CONVENTIONS.md | #420 |
| C5c.drivers.18 | default |  | The release workflow runs colab release cut --auto and finalize --auto unattended because both refuse on any failed condition; a refusal is the run's whole output, never a reason to retry around it. | a refusal is the run's whole output, never a reason to retry around it | CONVENTIONS.md | #420 |
| C5c.drivers.19 | default |  | A scheduler never finalizes a tag on a deploy-tag route unless the operator granted that repo an automatic final; on deploy-tag-fast under such a grant cut --auto tags the final on a green head. | It may never finalize a tag on a `deploy-tag` route | CONVENTIONS.md | #441 |
| C5c.drivers.20 | default |  | A candidate a human has put release-hold on is held for the workflow exactly as for a person. | A candidate a human has put `release-hold` on is held for the workflow | CONVENTIONS.md | — |
| C5c.drivers.21 | default |  | The handbook ships a release workflow template to copy: cut on a green CI run on main, finalize daily and publish in the same run. | cut on a green CI run on `main`, finalize daily, and publish in the same run | CONVENTIONS.md | #425 |
| C5c.drivers.34 | default |  | The release workflow template's hourly run re-tries only a refused cut, once the fetched colab CLI has moved. | run re-tries only a refused cut, once the fetched colab CLI has moved (#547) | CONVENTIONS.md | #547 |
| C5c.drivers.22 | default |  | On a private repo the release workflow's jobs run on the self-hosted label the repo's CI already uses; ubuntu-latest is right only on a public repo. | Its jobs run on the self-hosted label the repo's CI already uses | CONVENTIONS.md | #453 |
| C5c.drivers.23 | default |  | The npm publish job is the one exception: hosted everywhere, and it only ever runs on a public repo. | hosted everywhere because npm trusted publishing requires it | CONVENTIONS.md | #453 |
| C5c.drivers.24 | default |  | The runner label is a literal edit point in the template, not an expression keyed on visibility. | The label is a literal edit point in the template, not an expression keyed on visibility | CONVENTIONS.md | #453 |
| C5c.drivers.25 | default |  | The audit flags a private repo whose release workflow still runs a hosted job and names the label its other workflows use (advisory). | The audit flags a private repo whose release workflow still runs a hosted job | CONVENTIONS.md | #453 |
| C5c.drivers.26 | default |  | Where a deploy: tag repo declares promotion: main-loop, the release workflow's daily run first runs colab promote --auto; everywhere else --auto is a recorded no-op. | the workflow's daily run first runs `colab promote --auto` | CONVENTIONS.md | #440 |
| C5c.drivers.27 | default |  | COLAB_HUMAN changes nothing in either direction for a workflow: a workflow is not a human, and the grant is the descriptor's. | `COLAB_HUMAN` changes nothing in either direction | CONVENTIONS.md | #440 |
| C5c.drivers.28 | hard | tools/colab::ownerBranch.refuseMove | A scheduler never acts on an owner's branch: no colab command moves it at all. | no colab command moves the owner's branch at all | CONVENTIONS.md | #394 |
| C5c.drivers.29 | default |  | On an owner: repo a scheduler may run colab deliver --dry and report its state, and nothing more. | a scheduler may run `colab deliver --dry` and report its state, and nothing more | CONVENTIONS.md | #394 |
| C5c.drivers.30 | default |  | An open delivery PR reads as waiting on the owner: human-gated, stated once, never re-announced. | An open delivery PR reads as **waiting on the owner** | CONVENTIONS.md | #394 |
| C5c.drivers.31 | default |  | A scheduler must tell a self-clearing blocker apart from a human-gated one. | A scheduler must tell a **self-clearing** blocker | CONVENTIONS.md | — |
| C5c.drivers.32 | default |  | For a human-gated blocker a scheduler states it once and parks, never re-announcing the same unmet gate every cycle. | For a human-gated blocker it states it once and parks | CONVENTIONS.md | — |
| C5c.drivers.33 | default |  | A migration grant is the one human-gated blocker a driver may watch for clearing; the grant itself is only ever minted by a human. | A migration grant is the one human-gated blocker a driver may | CONVENTIONS.md | — |
| C5c.expl.25 | explanation |  | Rationale moved to the ADR: Release workflow runners (#453). | On a private (or internal) repo GitHub-hosted minutes are billed, | docs/adr/440-scheduled-drivers-rationale.md | — |
| C5c.expl.26 | explanation |  | Rationale moved to the ADR: Promotion cell (#440). | This is the one cell where a scheduled caller may | docs/adr/440-scheduled-drivers-rationale.md | — |

### Grouping — issues that must share one branch

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.grouping.01 | default |  | Issues that touch the same files must move on one branch; the group is a collision-prevention mechanism. | Issues that touch the same files must move on one branch | CONVENTIONS.md | — |
| C5c.grouping.02 | default |  | A one-way blocked_by chain is the wrong shape for a group; when the only overlap is a file every unit must edit, fix the file before grouping on it (mixed). | fix the file before grouping on it | CONVENTIONS.md | #371 |
| C5c.grouping.03 | default |  | The group key is the branch slug minus its trailing numbers and minus any login/machine prefix; label every member group:<key>. | The key is the branch slug minus its trailing numbers | CONVENTIONS.md | — |
| C5c.grouping.04 | default |  | Each member also gets a comment with machine-readable Group: and Because: lines, re-quoted from the current tree. | Each member also gets a comment | CONVENTIONS.md | — |
| C5c.grouping.05 | default |  | The group:<key> label has three states: grouped on two or more open issues, spent on exactly one, and absent meaning ungrouped or nobody triaged. | on two-or-more open issues = grouped (start together or not at | CONVENTIONS.md | — |
| C5c.grouping.06 | default |  | Whoever breaks a group removes the label from the members it no longer covers. | Whoever breaks a group removes the label from the members it no longer covers | CONVENTIONS.md | — |
| C5c.grouping.07 | default |  | code-triage writes the group label; code-start reads it before branching. | writes the label; `code-start` reads it before branching | CONVENTIONS.md | — |
| C5c.grouping.08 | default |  | colab ship's B4 tears down the group:<key> label object once every member is closed; deletion never touches closed issues' timelines or the Because: comment. | tears down the label OBJECT (not just an issue's use of it) | CONVENTIONS.md | #82 |
| C5c.grouping.09 | default |  | Only group:* labels are ever in scope for the teardown, never the operational label set. | Only `group:*` labels are ever in scope | CONVENTIONS.md | #82 |
| C5c.grouping.10 | default |  | The group label is a serialisation contract: the group is one unit of work, realized as one branch (always on writes: isolated; one branch or one attended trunk-direct place-claim otherwise). | so the group is ONE unit of work | CONVENTIONS.md | #316 |
| C5c.grouping.11 | default |  | A second live branch across a group's members is a finding, never a spawn. | A second live branch across a group's members is a finding, never a spawn | CONVENTIONS.md | #316 |
| C5c.grouping.12 | default |  | Triage never offers a start: line that would mint a second branch in a group, and names every second live branch it sees with the carrier branch and rebase order. | a triage pass never offers a `start:` line that would | CONVENTIONS.md | #316 |
| C5c.grouping.13 | default |  | Ship lands one member branch at a time against a re-fetched base and never merges a sibling member's branch to borrow its unmerged fix. | never merges a sibling member's branch to borrow its unmerged fix | CONVENTIONS.md | #316 |
| C5c.grouping.14 | default |  | code-start is not a third enforcement point; it is the reader that honours the offer. | `code-start` is not a third enforcement point | CONVENTIONS.md | #316 |
| C5c.grouping.15 | default |  | Triage sees pass time only: a second branch created after a pass ends is invisible to that pass and is caught on the next. | A second branch created after a pass ends is invisible to that pass | CONVENTIONS.md | #316 |
| C5c.grouping.16 | default |  | The next pass cannot short-circuit, because a newly-pushed sibling ref moves code-triage §0's branch digest. | so the next ping cannot short-circuit and takes a full pass | CONVENTIONS.md | #316 |
| C5c.expl.27 | explanation |  | Rationale moved to the ADR: Why a group exists. | Measured: a real triage run concluded two issues MUST share | docs/adr/316-grouping-measured-incident-rationale.md | — |
| C5c.expl.28 | explanation |  | Rationale moved to the ADR: Measured incident. | Measured on a downstream session orchestrator, 2026-09-05 — its own | docs/adr/316-grouping-measured-incident-rationale.md | — |

### Scope — diagnosing across repos is not license to act in them

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.scope.01 | default |  | Reading and diagnosing across repos to find a root cause is expected. | Reading and diagnosing across repos to find a root cause is expected | CONVENTIONS.md | — |
| C5c.scope.02 | default |  | Acting in another repo (branching, committing, pushing, rebasing/force-pushing an existing branch, merging) requires that repo's own claim and its own explicit go-ahead. | requires that repo's own claim and its own explicit go-ahead | CONVENTIONS.md | — |
| C5c.scope.03 | default |  | When a diagnosing session finds the real fix in another repo, report the finding and stop. | The correct move: report the finding and stop | CONVENTIONS.md | — |
| C5c.expl.29 | explanation |  | Rationale moved to the ADR: Scope. | Measured: a session traced a downstream issue to an existing | docs/adr/127-epics-switched-epics-and-scope-rationale.md | — |

### Epics — a container is not a start candidate

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.epics.01 | default |  | An issue whose checklist will outlive one session is an epic, and its items are issues; each child is independently claimable, blockable and shippable. | An issue whose checklist will outlive one session is an epic, and its items are | CONVENTIONS.md | #127 |
| C5c.epics.02 | default |  | Nothing a child does can put a closure claim on the parent. | nothing a child does can put a closure claim on the parent | CONVENTIONS.md | #127 |
| C5c.epics.03 | default |  | At filing time ask whether the items would be worked by one session. | At filing time, ask whether the items would be worked by one session | CONVENTIONS.md | #127 |
| C5c.epics.04 | default |  | The three signals are evidence for the rule, never its definition; a genuinely one-session multi-item issue should not be forced apart merely because its items differ on paper. | evidence for the rule, never its definition | CONVENTIONS.md | #127 |
| C5c.epics.05 | default |  | No backfill: the rule governs what gets filed next; converting an existing checklist issue is optional cleanup. | No backfill — this governs what gets filed next, not existing checklist issues | CONVENTIONS.md | #127 |
| C5c.epics.06 | default |  | Not every checklist is an epic: boxes that are steps of one session's own work make a normal issue with a to-do list; the test is whether the work outlives a session. | Not every checklist is an epic | CONVENTIONS.md | #127 |
| C5c.epics.07 | default |  | The epic label marks a container for sub-issues: informative, never a start candidate, never claimed as a unit of work. | informative, never a start candidate, never claimed as a unit of work | CONVENTIONS.md | #127 |
| C5c.epics.08 | default |  | Secondary signals (epic( title prefix, subIssuesSummary.total > 0) corroborate but never substitute for the label. | corroborate but never substitute for the label | CONVENTIONS.md | #127 |
| C5c.epics.09 | default |  | epic lives in the provisioned convention label set because an unattended driver's decision depends on it. | lives in the provisioned convention label set (unlike `tracking`) | CONVENTIONS.md | #127 |
| C5c.epics.10 | default |  | An epic still gets closed and referenced exactly as any other issue once its children finish. | An epic still gets closed and referenced exactly as any other issue | CONVENTIONS.md | #127 |
| C5c.epics.11 | default |  | After colab ship closes an issue it reads the issue's native parent and closes it in the same step, with an evidence comment, when the conditions below all hold. | reads the issue's native parent and closes it in the same step | CONVENTIONS.md | #371 |
| C5c.epics.12 | default |  | Container-close condition: the parent carries the epic label. | it carries the `epic` label | CONVENTIONS.md | #371 |
| C5c.epics.13 | default |  | Container-close condition: the parent has native sub-issues and every one of them is closed. | it has native sub-issues, and every one of them is closed | CONVENTIONS.md | #371 |
| C5c.epics.14 | default |  | Container-close condition: the parent's body lists no unticked checklist item. | its body lists no unticked checklist item | CONVENTIONS.md | #371 |
| C5c.epics.15 | default |  | Container-close condition: the parent is not a release tracking record, which colab release finalize closes. | it is not a release tracking record, which `colab release finalize` closes | CONVENTIONS.md | #371 |
| C5c.epics.16 | default |  | After closing a container, ask the same question of its own parent; any other shape is left open. | Then it asks the same question of that parent's own parent | CONVENTIONS.md | #371 |
| C5c.epics.17 | default |  | A parent with all sub-issues closed but no epic label, or with an unticked item, is reported as a finding for a human. | is reported as a finding for a human | CONVENTIONS.md | #371 |
| C5c.epics.18 | default |  | A hand-written checklist with no native sub-issues is never closed by container-close. | A hand-written checklist with no native sub-issues is never closed this way | CONVENTIONS.md | #371 |
| C5c.epics.19 | default |  | code-sweep §5 closes containers whose last child closed by another route, using the same conditions. | closes containers whose last child closed by some other route | CONVENTIONS.md | #371 |
| C5c.epics.20 | default |  | A container never carries a delivery:* label; code-triage reports one as a finding in its epic bucket. | A container never carries a `delivery:*` label | CONVENTIONS.md | #371 |
| C5c.epics.21 | hard | tools/colab::is an epic — an epic never carries | An epic never carries needs-decision and never a decision:options block. | An epic never carries `needs-decision`, and never a `decision:options` block | CONVENTIONS.md | #361 |
| C5c.epics.22 | default |  | A question about an epic goes on its own decision issue, attached as a sub-issue. | question about an epic goes on its own decision issue, attached as a sub-issue | CONVENTIONS.md | #361 |
| C5c.expl.30 | explanation |  | Rationale moved to the ADR: Epics: one claim, six readiness states. | You cannot claim half an issue: a checklist issue shipped | docs/adr/127-epics-switched-epics-and-scope-rationale.md | — |
| C5c.expl.31 | explanation |  | Rationale moved to the ADR: Epics: containers closing (#371). | Before #371 nothing closed the parent, and a backlog review | docs/adr/127-epics-switched-epics-and-scope-rationale.md | — |
| C5c.expl.32 | explanation |  | Rationale moved to the ADR: Epics: containers carry no delivery label. | In the same review, one closed-out container still carried `delivery:code`, | docs/adr/127-epics-switched-epics-and-scope-rationale.md | — |

### Switched epics — concurrent unfinished features (#336)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.switched.01 | default |  | The switched-epic policy applies to repos that tag (exposure: released); on none and self, and on live, it does not apply, and a bare tier: B carries no exposure opinion. | this subsection does not apply | CONVENTIONS.md | #336 |
| C5c.switched.02 | default |  | Every large feature is an epic; a multi-merge epic carries a switch, added in its first child and removed in its last child. | Every large feature is an epic; a multi-merge epic carries a switch | CONVENTIONS.md | #336 |
| C5c.switched.03 | default |  | Single-merge work gets no switch and rides the next release as it is. | Single-merge work gets no switch | CONVENTIONS.md | #336 |
| C5c.switched.04 | default |  | Two configurations only: release (every remaining switch off) and development (every remaining switch on); CI runs the suite in both; an intermediate combination is unsupported. | Two configurations, never more | CONVENTIONS.md | #336 |
| C5c.switched.05 | default |  | Absent a selector, the code runs the release configuration. | Absent a selector, the code runs the release configuration | CONVENTIONS.md | #336 |
| C5c.switched.06 | default |  | Switch dependencies are declared and enforced: B's declaration names A and B's switch-removal child carries a native blocked_by edge on A's switch-removal child. | Switch dependencies are declared and enforced, following the issue graph | CONVENTIONS.md | #336 |
| C5c.switched.07 | default |  | File-level collisions are not a switch's job; they still serialize through Grouping. | File-level collisions are not a switch's job | CONVENTIONS.md | #336 |
| C5c.switched.08 | default |  | What a switch cannot hide stays backward-compatible while the epic is unfinished: schema changes add only and every destructive step happens in the switch-removal child. | What a switch cannot hide stays backward-compatible while the epic is | CONVENTIONS.md | #336 |
| C5c.switched.09 | default |  | At most about 3 unfinished switched epics at once, and a switch older than about 4 weeks surfaces for a decision; both are findings for a human, never blockers. | At most ~3 unfinished switched epics at once | CONVENTIONS.md | #336 |
| C5c.switched.10 | default |  | Releases are cut from trunk and versions live in tags only; a release/X.Y branch exists only when an older version needs a fix of its own. | Releases are cut from trunk; versions live in tags only | CONVENTIONS.md | #336 |
| C5c.switched.11 | default |  | Never put a version in a branch name. | Never put a version in a branch name | CONVENTIONS.md | #336 |
| C5c.switched.12 | default |  | A switch is declared by a colab:switch marker on its own line in the epic's body, and by role=add and role=remove markers on the two children that change its existence. | on its own line in the **epic's body** | CONVENTIONS.md | #336 |
| C5c.switched.13 | default |  | The marker name matches ^[a-z0-9][a-z0-9-]*$ and is the literal identifier the code reads. | is the literal identifier the code reads | CONVENTIONS.md | #336 |
| C5c.switched.14 | default |  | needs (epic marker only) is the dependency declaration; a needs with no matching blocked_by edge, or an edge with no needs, is a finding. | A `needs` with no matching edge | CONVENTIONS.md | #336 |
| C5c.switched.15 | default |  | role (child marker only) is a closed set of two, add and remove, read by equality; a child with no marker is an ordinary child. | is a **closed** set of two | CONVENTIONS.md | #336 |
| C5c.switched.16 | default |  | An unrecognised token, a malformed name, or two disagreeing markers on one issue all mean not cleared: reported, never defaulted. | all mean **"not cleared"** — reported | CONVENTIONS.md | #336 |
| C5c.switched.17 | default |  | A marker quoted inside an inline code span or a fenced block is documentation and is never read as a marker. | is documentation and is never read as a marker | CONVENTIONS.md | #466 |
| C5c.switched.18 | default |  | Only one selector chooses between the two configurations, its absence means release, and each switch's identifier is its declared name; how the code reads it is the repo's own. | this subsection fixes only that one selector chooses between the two configurations | CONVENTIONS.md | #336 |
| C5c.switched.19 | default |  | code-triage §2 reports each epic's switch state with rule 3's and rule 6's findings, as findings and never as blockers. | as findings and never as blockers | CONVENTIONS.md | #340 |
| C5c.switched.20 | default |  | code-ship B1c grades a switched epic's children: an add or ordinary child must be dark with the switch off, and the remove child must remove the switch completely and perform the deferred destructive steps. | an `add` or ordinary child must be dark with the switch off | CONVENTIONS.md | #340 |
| C5c.expl.33 | explanation |  | Rationale moved to the ADR: Switched epics: rule 3. | With only two configurations, a dependency has exactly one runtime | docs/adr/127-epics-switched-epics-and-scope-rationale.md | — |
| C5c.expl.34 | explanation |  | Rationale moved to the ADR: Switched epics: markers quoted in code. | We measured one closed issue whose body only described the | docs/adr/127-epics-switched-epics-and-scope-rationale.md | — |

### Delivery type — route, not start (#112)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.delivery.01 | default |  | Six labels (delivery:code, docs-only, content, ops, elsewhere, design) name whether finishing an issue produces a code commit in this repo at all. | name whether finishing an issue produces a code | CONVENTIONS.md | #112 |
| C5c.delivery.02 | default |  | Delivery is three-valued: no label means not asked; code and docs-only are the code lane; content, ops, elsewhere and design are non-code-here, not a code start. | no label = not asked | CONVENTIONS.md | #112 |
| C5c.delivery.03 | default |  | Not asked must never collapse into non-code. | must never collapse into | CONVENTIONS.md | #112 |
| C5c.delivery.04 | default |  | content, ops and elsewhere gate exactly like needs-decision: route, not a start candidate for anyone. | gate exactly like `needs-decision` — route | CONVENTIONS.md | #112 |
| C5c.delivery.05 | default |  | design is not a code start but is not routed away: it is a design session's start, reported in triage's design bucket. | it is not routed away | CONVENTIONS.md | #359 |
| C5c.delivery.06 | default |  | A code session landing on any of the four non-code values distills the finding onto the issue and ends the session. | A code session landing on any of the four distills the finding onto the issue | CONVENTIONS.md | #112 |
| C5c.delivery.07 | default |  | Whoever files or triages sets the delivery label; no mechanical rule infers it from a title or body. | no mechanical rule infers it from a title or body | CONVENTIONS.md | #112 |
| C5c.delivery.08 | default |  | delivery:* is in the provisioned label set. | `delivery:*` is in the provisioned label set. | CONVENTIONS.md | #112 |
| C5c.delivery.09 | default |  | delivery:docs-only is a code-lane value: the filer expects an in-repo commit whose diff is documentation only. | is a code-lane value: the filer expects an in-repo commit | CONVENTIONS.md | #358 |
| C5c.delivery.10 | default |  | docs-only starts, is gated and ships exactly like delivery:code, and triage gives it deps-checked once its blockers clear. | It starts, is gated and ships exactly like | CONVENTIONS.md | #358 |
| C5c.delivery.11 | default |  | The docs-only label is not colab ship's docs-only exception: ship measures that from the diff and never reads the label. | ship measures that from the diff and never reads this label | CONVENTIONS.md | #358 |
| C5c.delivery.12 | default |  | docs-only is not a home for design work; design work has its own value. | Nor is it a home for design work | CONVENTIONS.md | #358 |
| C5c.delivery.13 | default |  | delivery:design names an issue whose deliverable is a design artifact for a new surface, worked by a design session on the issue's own branch. | names an issue whose deliverable is a design artifact | CONVENTIONS.md | #359 |
| C5c.delivery.14 | default |  | The build issue that implements the surface waits on the design issue through a blocked_by edge. | the build issue that implements the surface waits on it through a `blocked_by` edge | CONVENTIONS.md | #359 |
| C5c.delivery.15 | default |  | delivery:design is never a code start candidate and triage reports it in a bucket of its own. | It is never a code start candidate, and triage reports it in a bucket of its own | CONVENTIONS.md | #359 |
| C5c.delivery.16 | default |  | When its blocked_by edges are all closed, or it has none, triage stamps deps-checked on a design issue by the same bar as a code issue. | triage stamps `deps-checked` on it by | CONVENTIONS.md | #380 |
| C5c.delivery.17 | default |  | delivery:elsewhere names an issue whose deliverable is code that lands in a different repository than the one the issue lives in. | names an issue whose deliverable IS code, but code that | CONVENTIONS.md | #274 |
| C5c.delivery.18 | default |  | delivery:elsewhere routes as content and ops do. | It routes as `content`/`ops` do | CONVENTIONS.md | #274 |
| C5c.delivery.19 | default |  | A delivery:* value outside the six has no handbook meaning and is consumer-local. | has no handbook meaning | CONVENTIONS.md | #366 |
| C5c.delivery.20 | default |  | The classifier reads an undefined delivery value as not asked: no lane, startable by a code session; next to a provisioned value, the provisioned value alone decides. | The classifier reads it as not asked | CONVENTIONS.md | #366 |
| C5c.delivery.21 | default |  | handbook-sync reports an undefined delivery value as value drift until the consumer declares it in Local divergences with a handbook issue that states its meaning. | reports it as `value` drift, not as a gap | CONVENTIONS.md | #366 |
| C5c.delivery.22 | default |  | When part of a deliverable is code in another repository and part is here, split the issue in two; link them with a blocked_by edge only where one needs the other's output. | The shape it seems to name has a handbook answer: split the issue | CONVENTIONS.md | #366 |
| C5c.expl.35 | explanation |  | Rationale moved to the ADR: delivery:docs-only (#358). | It was provisioned in #112 as a non-code value ("a | docs/adr/112-delivery-type-and-priority-rationale.md | — |
| C5c.expl.36 | explanation |  | Rationale moved to the ADR: delivery:design (#359). | Two consumers hand-created the label before the handbook provisioned it, | docs/adr/112-delivery-type-and-priority-rationale.md | — |
| C5c.expl.37 | explanation |  | Rationale moved to the ADR: delivery:elsewhere (#274). | Before #274, an issue explicitly labelled `delivery:elsewhere` was byte-identical, to | docs/adr/112-delivery-type-and-priority-rationale.md | — |

### Priority — a throttle, not a veto (#268)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.priority.01 | default |  | low-priority orders a queue; it does not remove work from one. | orders a queue; it does not remove work from one | CONVENTIONS.md | #268 |
| C5c.priority.02 | default |  | A low-priority issue is a start candidate: it passes the readiness gate like any other and stays on the ready list. | is** a start candidate | CONVENTIONS.md | #268 |
| C5c.priority.03 | default |  | code-triage's ordering step ranks a low-priority group behind every other ready group, never off the ready list. | ranks a `low-priority` group behind every other ready group | CONVENTIONS.md | #268 |
| C5c.priority.04 | default |  | A scheduled driver may decline to auto-start a low-priority group unattended provided three things hold. | provided three things hold | CONVENTIONS.md | #268 |
| C5c.priority.05 | default |  | The decline applies only to unattended starts, checked after every harder objection, with the group still ranked last. | the decline applies only to *unattended* starts | CONVENTIONS.md | #268 |
| C5c.priority.06 | default |  | The group never leaves the ready list, so a human may start it by hand at any time. | the group never leaves the ready list | CONVENTIONS.md | #268 |
| C5c.priority.07 | default |  | Clearing the label is the sanctioned way to release the group back to the scheduler. | clearing the label is the sanctioned way | CONVENTIONS.md | #268 |
| C5c.priority.08 | default |  | A driver that implements the hard-veto reading must say so somewhere code-triage's output can be checked against. | must say so somewhere `code-triage`'s output can be checked against | CONVENTIONS.md | #268 |
| C5c.priority.09 | default |  | low-priority is in the provisioned label set. | `low-priority` is in the provisioned label set. | CONVENTIONS.md | #268 |
| C5c.priority.10 | default |  | priority:now and priority:high rank upward: now › high › default › low-priority. | rank upward (#537) | CONVENTIONS.md | #537 |
| C5c.priority.11 | default |  | The priority rank orders ready work for start and merge; it never skips a gate or overrides a hold — a held file drains, the holder ships first. | a `now` issue whose file is held drains the | CONVENTIONS.md | #537 |
| C5c.priority.12 | default |  | Only the repo owner sets priority:now, or a coordinator relaying the owner's order quoted on the issue; priority:high the owner or a coordinator. | Only the repo owner sets `priority:now` | CONVENTIONS.md | #537 |
| C5c.priority.13 | default |  | An agent never sets priority:now or priority:high; it proposes one in a comment. | An agent never sets either | CONVENTIONS.md | #537 |
| C5c.priority.14 | default |  | A scheduling tool may compute a high-equivalent from leverage, never a now. | never a `now` | CONVENTIONS.md | #537 |
| C5c.priority.15 | default |  | No per-repo cap on now, no reserved capacity, no expiry or ageing, no batch membership. | Not part of it: a per-repo cap on `now` | CONVENTIONS.md | #537 |
| C5c.priority.16 | default |  | Both priority labels are provisioned beside low-priority. | Both labels are provisioned beside `low-priority` | CONVENTIONS.md | #537 |
| C5c.expl.38 | explanation |  | Rationale moved to the ADR: Priority (#268). | Reading the label as a hard veto turns "later" into | docs/adr/112-delivery-type-and-priority-rationale.md | — |
| C5c.expl.39 | explanation |  | Rationale moved to the ADR: Priority (#268). | A driver meeting all three is honouring the throttle, not | docs/adr/112-delivery-type-and-priority-rationale.md | — |

### Planning — a plan file that outlives one command, and who drafts it (#94)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.planning.01 | default |  | The plan is a repo-local scratch file, not an Issue comment: .plans/issue-<N>.md in the main checkout, outside any worktree. | The plan is a repo-local scratch file, not an Issue comment | CONVENTIONS.md | #94 |
| C5c.planning.02 | default |  | The plan file is git-excluded and never committed; anything worth keeping past the session moves to the Issue at wrap. | Git-excluded, **never committed** | CONVENTIONS.md | #94 |
| C5c.planning.03 | default |  | COLAB_PLANS_DIR overrides .plans and COLAB_BRIEFS_DIR overrides .briefs; the directory is not under .claude/. | overrides `.plans` (relative to the main checkout, or absolute) | CONVENTIONS.md | #488 |
| C5c.planning.04 | default |  | Writers write only the configured dir; readers read the configured dir first, then the legacy .claude/plans/, for one transition. | Writers write only the configured | CONVENTIONS.md | #488 |
| C5c.planning.05 | default |  | Teardown deletes the plan wherever it found it; old files are never moved. | Old files are never moved | CONVENTIONS.md | #488 |
| C5c.planning.06 | default |  | colab worktree new and colab adopt --local hide the configured dirs and the legacy one in .git/info/exclude; a scratch file in a worktree never makes teardown refuse. | hide the configured dirs and the legacy one | CONVENTIONS.md | #488 |
| C5c.planning.07 | default |  | Resolve the plan path via an absolute path, never bare relative, since a bare path from inside a worktree resolves to the worktree's own copy. | Resolved via an absolute path, never bare relative | CONVENTIONS.md | #113 |
| C5c.planning.08 | default |  | Rung 0 (none) is for trivial or mechanical work whose oracle is self-evident. | trivial/mechanical, oracle self-evident | CONVENTIONS.md | #94 |
| C5c.planning.09 | default |  | Rung 1 (plan-lite) is the default for every other session: 3-5 lines at session start of intent, files, oracle and stop condition. | 3-5 lines at session start: intent · files · oracle · stop condition | CONVENTIONS.md | #94 |
| C5c.planning.10 | default |  | Rung 2 (full plan) applies when needs-plan is set or a mid-session trigger fires, drafted by code-plan into the same file. | a mid-session trigger (ambiguous ask, no repo precedent, long dependency chain) | CONVENTIONS.md | #94 |
| C5c.planning.11 | default |  | Failing to state rung 1's oracle in one line is the signal to stop and ask on the Issue; never guess, never silently drop to rung 0. | itself the signal to stop and ask on the | CONVENTIONS.md | #94 |
| C5c.planning.12 | default |  | code-wrap checks the rung it finds: the plan file is present or its place holds one line rung 0 because <reason>. | `code-wrap` checks the rung it finds | CONVENTIONS.md | #486 |
| C5c.planning.13 | default |  | A non-rung-0 change wrapped with neither is reported as plan file missing, never as hand-off complete, and is never back-filled. | never as hand-off complete — and is never | CONVENTIONS.md | #486 |
| C5c.planning.14 | default |  | code-triage may flag a hard group needs-plan with a one-line reason; a cross-backlog judgement, never a plan of its own. | may flag a hard group `needs-plan` with a one-line reason | CONVENTIONS.md | #94 |
| C5c.planning.15 | default |  | The full plan is drafted at code-session start, inside the implementing session, seeded with the Issue plus the reason line: by a helper agent where the engine has one, otherwise by the session itself, which records drafted-by: self in the plan's frontmatter. | The full plan is drafted at code-session start** | CONVENTIONS.md | #94 |
| C5c.planning.16 | default |  | A rung-1 stub may upgrade to rung 2 mid-session; the flag decides only the default. | A rung-1 stub may still upgrade to rung 2 mid-session | CONVENTIONS.md | #94 |
| C5c.planning.17 | default |  | Read the needs-plan flag by direct issue fetch, never the Search API. | Read the `needs-plan` flag by direct issue fetch | CONVENTIONS.md | #94 |
| C5c.planning.18 | default |  | A plan is a sketch the code may overrule, not a contract; note deviation where the plan lives. | note deviation where the plan lives | CONVENTIONS.md | #94 |
| C5c.planning.19 | default |  | needs-plan is provisioned on adoption and back-filled on sync, like every other fixed convention label. | is provisioned on adoption and back-filled on sync | CONVENTIONS.md | #94 |
| C5c.expl.40 | explanation |  | Rationale moved to the ADR: Planning (#94). | Coordinator (triage/grading) and implementer (coding) sessions often run at different | docs/adr/94-planning-and-conclusion-writing-rationale.md | — |
| C5c.expl.41 | explanation |  | Rationale moved to the ADR: Planning (#488). | Both used to sit under `.claude/`, which agent CLIs guard | docs/adr/94-planning-and-conclusion-writing-rationale.md | — |

### Writing a conclusion down — the decision and the document are two units

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.conclusion.01 | default |  | A conclusion reaches trunk as two units, in order. | It reaches trunk as two units, in order | CONVENTIONS.md | — |
| C5c.conclusion.02 | default |  | Step 1: the conclusion goes on an Issue immediately, before any file is touched. | the conclusion goes on an Issue immediately, before any file is touched | CONVENTIONS.md | — |
| C5c.conclusion.03 | default |  | Step 2: the write is its own coding unit: own Issue, claim, branch off trunk in a worktree, wrapped normally. | own Issue, claim, branch off trunk in a worktree, wrapped normally | CONVENTIONS.md | — |
| C5c.conclusion.04 | default |  | The collision unit is the file (the hunk), never the folder. | The collision unit is the file (the hunk), never the folder | CONVENTIONS.md | — |
| C5c.conclusion.05 | default |  | Run colab holders <path>: empty output (or a nonexistent path) is clean ground; non-empty is a file-level group, so use the same branch or sequence after theirs lands. | Empty output (or a nonexistent path) is clean ground | CONVENTIONS.md | — |
| C5c.conclusion.06 | default |  | An unknown holders verdict means look, never assume clear. | `unknown` still means *look*, never *assume clear* | CONVENTIONS.md | — |
| C5c.conclusion.07 | default |  | colab holders fetches before it enumerates, as part of the check; with --no-fetch it still reports holders it can see but refuses the clean verdict with exit 2. | It fetches before it enumerates. | CONVENTIONS.md | — |
| C5c.conclusion.08 | default |  | With no colab installed, run git fetch --prune origin first, then the git log --all --not origin/<trunk> --source sweep; every ref it lists is a candidate to check by hand. | No `colab` installed: `git fetch --prune origin` **first** | CONVENTIONS.md | — |
| C5c.conclusion.09 | default |  | Never write the final artifact in the main checkout; a throwaway draft in a git-ignored scratch directory is fine. | Never write the final artifact in the main checkout | CONVENTIONS.md | — |
| C5c.conclusion.10 | default |  | Two doc branches landing in the same window are wrapped one at a time, each re-checked against the trunk the other just moved. | Two doc branches landing in the same window are wrapped one at a time | CONVENTIONS.md | — |
| C5c.conclusion.11 | default |  | A branch that never touched a line still carries it as diff context: read the region and resolve as a union when the edits are non-contradictory, never take one side of a prose conflict wholesale. | read the region and resolve as a union when the edits are non-contradictory | CONVENTIONS.md | — |
| C5c.expl.42 | explanation |  | Rationale moved to the ADR: Writing a conclusion down: colab holders. | `colab holders` filters every ref that ever touched `<path>` through | docs/adr/94-planning-and-conclusion-writing-rationale.md | — |
| C5c.expl.43 | explanation |  | Rationale moved to the ADR: Writing a conclusion down: doc branches. | Measured: on two adjacent edits to one paragraph, the correct | docs/adr/94-planning-and-conclusion-writing-rationale.md | — |

### Design conclusions are three units, not two

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.design.01 | default |  | A design ruling needs one more part: an immutable visual record. | A design ruling needs one more part | CONVENTIONS.md | — |
| C5c.design.02 | default |  | Unit 1, the ruling (chosen option, why, what was rejected), goes on the Issue immediately and is what clears needs-decision. | This is what clears `needs-decision` | CONVENTIONS.md | — |
| C5c.design.03 | default |  | Record the ruling with colab decision --record, never as prose alone with the label cleared by hand. | never as prose alone with the label cleared by hand | CONVENTIONS.md | #361 |
| C5c.design.04 | default |  | Approval of a finished artifact is asked once the artifact exists, never at filing, with a Mockup: line in the issue body. | Approval of a finished artifact is asked once | CONVENTIONS.md | #379 |
| C5c.design.05 | default |  | Only a ruling recorded after the review approves the artifact; an earlier ruling does not. | Only a ruling recorded **after** that review approves the artifact | CONVENTIONS.md | #379 |
| C5c.design.06 | default |  | Unit 2, the artifact, is a repo file under docs/design/ named <slug>-<N>-mockup.html or <slug>-<N>-spec.md, landing via a claimed docs branch. | a repo file under `docs/design/`, named | CONVENTIONS.md | — |
| C5c.design.07 | default |  | Superseded artifacts are marked, never deleted; trunk carries the design lineage. | Superseded artifacts are marked, never deleted | CONVENTIONS.md | — |
| C5c.design.08 | default |  | Unit 3, the frozen evidence, is a screenshot of the approved option attached to the ruling comment. | a screenshot of the approved option attached to the ruling | CONVENTIONS.md | — |
| C5c.design.09 | default |  | Rejected alternatives need never land on trunk; their screenshot on the Issue is the whole record. | Rejected alternatives need never land | CONVENTIONS.md | — |
| C5c.design.10 | default |  | Design work splits by size with one test: does building this need a screen, page or panel that no approved artifact under docs/design/ already covers? It is a judgement, never inferred mechanically. | never inferred mechanically from a title, a body or a file path | CONVENTIONS.md | #359 |
| C5c.design.11 | default |  | A new surface gets a separate delivery:design issue filed first, whose deliverable is unit 2 on that issue's own branch. | File a separate `delivery:design` issue first | CONVENTIONS.md | #359 |
| C5c.design.12 | default |  | The build issue waits on the design issue through a native blocked_by edge and through nothing else: no label, no artifact-presence check. | through nothing else: no label, no artifact-presence check | CONVENTIONS.md | #359 |
| C5c.design.13 | default |  | A small change to an already-designed surface does not need a separate design issue. | a small change to an already-designed surface | CONVENTIONS.md | #359 |
| C5c.design.14 | default |  | A missing artifact never blocks a small change; the design gate is needs-decision, and only that. | A missing artifact never blocks a small change | CONVENTIONS.md | #356 |
| C5c.design.15 | default |  | A consumer that wants a build to wait on design files the new-surface design issue and its edge, never an artifact check. | design files the new-surface design issue and its edge | CONVENTIONS.md | #356 |
| C5c.design.16 | default |  | Consumer docs link to code-triage §6 instead of restating it. | Consumer docs should link to | CONVENTIONS.md | #356 |
| C5c.design.17 | default |  | A ruling given elsewhere and never recorded does not block, but must be written down as unit 1 with colab decision --record --ruled-by <human>; triage reports it and does not treat it as a gate. | A ruling given elsewhere and never recorded does not block either | CONVENTIONS.md | — |
| C5c.design.18 | default |  | The index of what lives under docs/design/ belongs in that directory itself, never in CLAUDE.md, which gets one pointer row. | belongs in that directory itself | CONVENTIONS.md | — |
| C5c.expl.44 | explanation |  | Rationale moved to the ADR: Design conclusions: missing artifact. | Following it stalls settled work, measured at about a day | docs/adr/94-planning-and-conclusion-writing-rationale.md | — |

### Design exploration files its Issue first — before the first mockup, not after

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C5c.exploration.01 | default |  | The Issue number must exist before the first mockup is drawn, not retrofitted once one is approved. | The Issue number must exist before the first mockup is drawn | CONVENTIONS.md | — |
| C5c.exploration.02 | default |  | A small change explores on the issue that builds it; a new surface explores on its own delivery:design issue, filed before the first mockup. | A small change explores on the issue that builds it | CONVENTIONS.md | #359 |
| C5c.exploration.03 | default |  | When the build spans several sessions, an epic parent holds the design issue and the build issues as children, each build child with its own blocked_by edge to the design issue. | an `epic` parent holds the design issue and the build issues as | CONVENTIONS.md | #359 |
| C5c.exploration.04 | default |  | The design issue is never itself turned into the epic. | The design issue is never itself turned into the epic | CONVENTIONS.md | #359 |
| C5c.exploration.05 | default |  | ceremony: light repos are exempt from the file ceremony: a mockup lives as a preview link and units 1 and 3 collapse into one screenshot-bearing Issue comment. | are exempt from the file ceremony | CONVENTIONS.md | — |

#### #539 ledger — §5 scheduled drivers through design exploration

- `CONVENTIONS.md:3406` — before: "- `epic`-labelled issues are excluded — an epic can pass provenance cleanly and still not be a pick-up-and-code task." → after: "- `epic`-labelled issues are excluded.". Rationale → `docs/adr/539-drivers-rationale.md`. Rows: C5c.drivers.03 (key updated).
- `CONVENTIONS.md:3408` — before: "- `needs-decision` issues are excluded, for a third distinct reason: no human has answered the blocking question, even if the work item itself is human-filed, unblocked, and a genuine leaf task." → after: "- `needs-decision` issues are excluded, even if the work item itself is human-filed, unblocked, and a genuine leaf task.". Rationale → `docs/adr/539-drivers-rationale.md`. Rows: C5c.drivers.04 (key updated).
- `CONVENTIONS.md:3411` — before: "it checks for `decision-recorded` or the live comment marker, since a cleared `needs-decision` with neither present is the stale, not-yet-swept state, not a decided one. The converse" → after: "it checks for `decision-recorded` or the live comment marker. The converse". Rationale → `docs/adr/539-drivers-rationale.md`. Rows: C5c.drivers.05, C5c.drivers.06, C5c.drivers.07.
- `CONVENTIONS.md:3442` — before: "and **publish in the same run** — a tag pushed with `GITHUB_TOKEN` triggers no other workflow, so a Release left to a tag-push workflow is never published. It reads" → after: "and **publish in the same run**. It reads". Rationale → `docs/adr/539-drivers-rationale.md`. Rows: C5c.drivers.16, C5c.drivers.17, C5c.drivers.18, C5c.drivers.19, C5c.drivers.20, C5c.drivers.21.
- `CONVENTIONS.md:3481` — before: "then dispatches CI on `main` — a push made with `GITHUB_TOKEN` triggers no workflow, a `workflow_dispatch` is the documented exception — and that run's … `COLAB_HUMAN` changes nothing in either direction: a workflow is not a human, and the grant is the descriptor's." → after: "then dispatches CI on `main`, and that run's … `COLAB_HUMAN` changes nothing in either direction.". Rationale → `docs/adr/539-drivers-rationale.md`. Rows: C5c.drivers.26, C5c.drivers.27.
- `CONVENTIONS.md:3562` — before: "a file-level group), because a branch carrying a sibling's unlanded commits cannot land independently of it, and then neither converges." → after: "a file-level group).". Rationale → `docs/adr/539-grouping-rationale.md`. Rows: C5c.grouping.13.
- `CONVENTIONS.md:3614` — before: "is a normal issue with a to-do list, and splitting it would be pure overhead. The test" → after: "is a normal issue with a to-do list. The test". Rationale → `docs/adr/539-epics-rationale.md`. Rows: C5c.epics.05, C5c.epics.06.
- `CONVENTIONS.md:3636` — before: "(`- [ ]`). An unticked item on an epic is work someone listed and nobody filed yet, and closing over it would bury that work;" → after: "(`- [ ]`);". Rationale → `docs/adr/539-epics-rationale.md`. Rows: C5c.epics.14.
- `CONVENTIONS.md:3665` — before: "On `none` and `self` nothing consumes a half-finished epic, so a switch there is pure cost and this subsection does not apply; … `exposure: live` is not bound: its promotion is a human act that can simply wait for an epic to finish." → after: "On `none` and `self` this subsection does not apply; … `exposure: live` is not bound.". Rationale → `docs/adr/539-switched-epics-rationale.md`. Rows: C5c.switched.01.
- `CONVENTIONS.md:3689` — before: "serialize through *Grouping*, above; a switch hides behaviour, never a merge conflict." → after: "serialize through *Grouping*, above.". Rationale → `docs/adr/539-switched-epics-rationale.md`. Rows: C5c.switched.07.
- `CONVENTIONS.md:3873` — before: "in the **main checkout, outside any worktree** (exists before the worktree, survives its teardown)." → after: "in the **main checkout, outside any worktree**.". Rationale → `docs/adr/539-planning-rationale.md`. Rows: C5c.planning.01, C5c.planning.02.
- `CONVENTIONS.md:3910` — before: "and is never back-filled, since a plan written after the code only describes the code." → after: "and is never back-filled.". Rationale → `docs/adr/539-planning-rationale.md`. Rows: C5c.planning.12, C5c.planning.13.
- `CONVENTIONS.md:3915` — before: "a **cross-backlog judgement**, never a plan of its own (authoring at triage time produced stale artifacts for groups not started soon)." → after: "a **cross-backlog judgement**, never a plan of its own.". Rationale → `docs/adr/539-planning-rationale.md`. Rows: C5c.planning.14, C5c.planning.15, C5c.planning.16.

### 6. Releases

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C6.rel.01 | default |  | Tier A release is merge dev into main, then tag. | A release is: merge `dev` → `main`, then tag. | CONVENTIONS.md | — |
| C6.rel.02 | default |  | The tag push is the deploy trigger; pushing main only runs the full suite. | Pushing the tag is the deploy trigger; pushing `main` only runs the full test suite. | CONVENTIONS.md | — |
| C6.rel.03 | default |  | A single-trunk (tag-gated) Tier A has no promotion; a release is the tag on main. | has no promotion — work already lives on `main`. | CONVENTIONS.md | — |
| C6.rel.04 | default |  | Where the deploy is an external GitOps poller, tagging is what the release script keys off. | Where the deploy is an external GitOps poller, tagging | CONVENTIONS.md | — |
| C6.rel.05 | default |  | A Tier C release is the dev to main merge, which is the deploy. | merge `dev` → `main`. That is the deploy. | CONVENTIONS.md | — |
| C6.rel.06 | default |  | Tier C promotes with --no-ff, never squash, so the merge commit records what shipped. | Same `--no-ff`, never squash, for the same reason: the merge commit records what shipped | CONVENTIONS.md | — |
| C6.rel.07 | default |  | Treat a Tier C promotion with the seriousness Tier A gives the tag; there is no ship-it-later step. | treat the promotion with the seriousness Tier A gives the tag. | CONVENTIONS.md | — |
| C6.rel.08 | default |  | Tagging on Tier C is optional and harmless. | Tagging on C is optional and harmless; wanting tags consistently is the | CONVENTIONS.md | — |
| C6.rel.09 | hard | tools/colab::Re-run with COLAB_HUMAN=1, or set project.yml promotion: main-loop | On a deploy: manual repo promotion always requires a human, and promotion: main-loop cannot say otherwise. | promotion there always requires a human, and `promotion: main-loop` cannot say otherwise. | CONVENTIONS.md | — |
| C6.rel.10 | default |  | On a deploy: manual repo the sequence is promote, tag, then run the runbook. | promote, tag, then run the runbook | CONVENTIONS.md | — |
| C6.rel.11 | default |  | On a deploy: manual repo the final tag is a human act too. | The final tag there is a human act too | CONVENTIONS.md | — |
| C6.rel.12 | default |  | Human gate count follows exposure; an up-front yes authorizes an intent, not an unseen result. | An up-front yes can authorize an intent; it cannot authorize a result nobody has seen. | CONVENTIONS.md | — |
| C6.rel.13 | default |  | Where a merge reaches beyond the room (live, released), approve the idea and then look at what actually shipped. | approve the idea, then look at what actually shipped | CONVENTIONS.md | — |
| C6.rel.14 | default |  | The permission ladder has one rung per boundary: ship, promote, release. | ship (branch→trunk, gated by `autonomy:`) · promote (trunk→main, gated by | CONVENTIONS.md | — |
| C6.rel.15 | hard | tools/colab::function shipAutonomyGate ; templates/pre-push-guard::COLAB_PROMOTE | The pre-push-guard hook enforces the ship and promote rungs mechanically; COLAB_SHIP never opens main. | The `pre-push-guard` hook enforces the first two mechanically; `COLAB_SHIP` never opens `main`. | CONVENTIONS.md | — |
| C6.rel.16 | default |  | An agent never sets COLAB_SHIP or COLAB_PROMOTE by hand, and a refusal never names one. | an agent never sets either by hand, and a refusal never names one. | CONVENTIONS.md | — |
| C6.rel.17 | default |  | Neither COLAB_SHIP nor COLAB_PROMOTE has any sanctioned hand-set case, not even solo flow's. | neither has any sanctioned hand-set case at all — not even solo flow's. | CONVENTIONS.md | — |
| C6.rel.18 | default |  | Every refusal on the ship and promote path names the remedy (colab ship, colab promote) and nothing else. | every refusal on this path now names the remedy (`colab ship`, `colab promote`) and nothing else. | CONVENTIONS.md | — |
| C6.rel.19 | default |  | Ship preconditions measure the local target against origin/target and refuse before merging. | preconditions now measure the local target against `origin/<target>` and refuse before merging | CONVENTIONS.md | — |
| C6.rel.20 | default |  | A failed B2 push rolls the squash back so no unpublishable state exists. | a failed B2 push rolls the squash back so the unpublishable state does not exist to be | CONVENTIONS.md | — |
| C6.rel.21 | default |  | A distilled doc lands on the session branch, never as a commit on the trunk checkout. | doc lands on the session branch, never as a commit on the trunk checkout | CONVENTIONS.md | — |
| C6.rel.22 | hard | tools/colab::Re-run with COLAB_HUMAN=1, or set project.yml promotion: main-loop | On Tier C promotion always requires COLAB_HUMAN=1; promotion: main-loop never applies to C. | promotion there always requires `COLAB_HUMAN=1`; `promotion: main-loop` applies only | CONVENTIONS.md | — |
| C6.rel.23 | default |  | Nothing about Tier C widens what an agent may do; auto-trunk still only merges into dev. | Nothing about C widens what an agent may do: `autonomy: auto-trunk` still only ever | CONVENTIONS.md | — |
| C6.rel.24 | hard | tools/lib/release-finalize.js::the final tag is a human act on this row | A human is asked exactly once, for the final tag on a repo where that tag deploys production. | is asked exactly once: for the final tag on a repo where that tag deploys production | CONVENTIONS.md | — |
| C6.rel.25 | hard | tools/lib/release-finalize.js::const HOLD_LABEL = 'release-hold' | A human can veto any candidate with release-hold. | Everything else is automatic, and a human can still veto any candidate with | CONVENTIONS.md | — |
| C6.rel.26 | default |  | Every candidate is vX.Y.Z-rc.N and the final is that candidate's commit tagged final. | the final `vX.Y.Z` is that candidate's commit, tagged final | CONVENTIONS.md | — |
| C6.rel.27 | default |  | Release routes table: each route fixes when candidates and finals are cut. | `deploy: tag` / `deploy: manual` — the tag deploys production | CONVENTIONS.md | — |
| C6.rel.28 | default |  | On the live route there are no automatic tags; the promotion is the deploy and stays human. | unchanged — no automatic tags; the promotion is the deploy and stays human; tagging stays optional | CONVENTIONS.md | — |
| C6.rel.29 | default |  | A repo declares release.route; absent, it is derived from exposure and deploy. | A repo declares its route as `release.route`; absent, it is derived from `exposure` + | CONVENTIONS.md | — |
| C6.rel.30 | default |  | A declared route its row does not permit is an audit failure, never an override. | is an audit failure, never an override: change `exposure`/`deploy` first if the | CONVENTIONS.md | — |
| C6.rel.31 | default |  | Anything the table does not name derives no route and fails closed: a human tags. | derives no route and fails closed: no automatic tag, a human tags. | CONVENTIONS.md | — |
| C6.rel.32 | default |  | Where the final tag is a human act, no project.yml value lowers that. | no value in `project.yml` lowers that — the one way is an operator's recorded grant, | CONVENTIONS.md | — |
| C6.rel.33 | default |  | A repo may narrow its route only. | A repo may narrow its route — turn candidates off, cap candidates per day, | CONVENTIONS.md | — |
| C6.rel.34 | default |  | A release block that tries to widen the route is an audit failure. | a block that tries to widen it is an audit failure, not an override. | CONVENTIONS.md | — |
| C6.rel.35 | default |  | The newest candidate always names trunk's head; every green trunk run whose head has no candidate cuts one. | every green trunk run whose head carries no candidate cuts one, and no route caps how many a day. | CONVENTIONS.md | — |
| C6.rel.36 | default |  | Inside a candidates-per-day window the run is a no-op, and the first run after it cuts the head, never an older commit. | the next green CI, or the daily scheduled run, which cuts too — cuts the head, never an older commit | CONVENTIONS.md | — |
| C6.rel.37 | default |  | A final is still the newest candidate whose own test period is clean. | a final is still the newest candidate whose own test period is clean | CONVENTIONS.md | — |
| C6.rel.38 | default |  | colab release-status flags head not a candidate when a green head stays untagged past one CI cycle. | reads the guarantee back and flags head not a candidate when a green head | CONVENTIONS.md | — |
| C6.rel.39 | default |  | Every candidate has a release page; colab release cut publishes the pre-release itself. | `colab release cut` publishes the GitHub pre-release itself | CONVENTIONS.md | — |
| C6.rel.40 | hard | tools/lib/release-cut.js::const refusals = checks.filter((c) => !c.ok); | A candidate is cut only when all four conditions hold on the exact commit it names. | A candidate is cut only when all four hold, on the exact commit it names: | CONVENTIONS.md | — |
| C6.rel.41 | hard | tools/lib/release-cut.js::'ci-green' | Condition 1: CI is green on that commit, every run at that sha finished and one succeeded. | CI green on that commit — every run at that sha finished and one succeeded | CONVENTIONS.md | — |
| C6.rel.42 | hard | tools/lib/release-cut.js::'full-suite' | Condition 2: the full suite passed on that commit. | The full suite passed on it — the rule at the end of this section, unchanged. | CONVENTIONS.md | — |
| C6.rel.43 | hard | tools/lib/release-cut.js::'schema-additive' | Condition 3: every schema change since the last final tag is additive. | Every schema change since the last final tag is additive | CONVENTIONS.md | — |
| C6.rel.44 | default |  | A release carrying a destructive schema change is not a candidate an agent cuts; a human decides it. | A release carrying a destructive one is not a candidate an agent cuts; a human decides it. | CONVENTIONS.md | — |
| C6.rel.45 | hard | tools/lib/release-cut.js::'switch-dependencies' | Condition 4: switch dependencies are satisfied. | Switch dependencies are satisfied | CONVENTIONS.md | — |
| C6.rel.46 | hard | tools/lib/release-finalize.js::'test-period' | The test period is 3 days and is clean only if trunk CI stayed green throughout and no regression is open. | The test period is 3 days, and it is clean only if trunk CI stayed green throughout | CONVENTIONS.md | — |
| C6.rel.47 | default |  | Trunk means both main and the trunk: branch where that is a different one. | where candidates are cut, and the `trunk:` branch where that is a different one | CONVENTIONS.md | — |
| C6.rel.48 | default |  | A route may lengthen the test period, never shorten it — except that a repo whose final is a human act may declare test-period 0d, no period at all. | A route may lengthen it, never shorten it | CONVENTIONS.md | #549 |
| C6.rel.49 | hard | tools/lib/release-finalize.js::const HOLD_LABEL = 'release-hold' | A human vetoes by holding the candidate; a held candidate is not finalized. | A human vetoes by holding the candidate during it; a held candidate is not finalized. | CONVENTIONS.md | — |
| C6.rel.50 | hard | tools/lib/release-finalize.js::'trunk-green' | Finalizing re-checks every condition at the moment it runs; a candidate no longer clean stays a candidate. | Finalizing re-checks every condition above at the moment it runs | CONVENTIONS.md | — |
| C6.rel.51 | default |  | Where the final tag is a human act, the agent's work ends with the candidate, release notes and the one click. | the agent's work ends with the candidate, its release notes, and the one click | CONVENTIONS.md | — |
| C6.rel.52 | default |  | Each repo that tags carries a release workflow run by a trigger, not a person or session. | Each repo that tags carries a | CONVENTIONS.md | — |
| C6.rel.53 | default |  | A green CI run on main, and the daily scheduled run, tries a candidate with colab release cut --auto. | a green CI run on `main` — and the daily scheduled run (#443) — tries a candidate | CONVENTIONS.md | #443 |
| C6.rel.54 | default |  | A daily run tries to finalize clean candidates, and publishing happens inside the same run. | tries to finalize clean candidates (`colab release finalize --auto`), and publishing happens | CONVENTIONS.md | — |
| C6.rel.55 | hard | tools/lib/release-cut.js::const refusals = checks.filter((c) => !c.ok); | The release commands may run unattended because both refuse on any failed condition. | It may do this unattended because both commands refuse on any failed condition | CONVENTIONS.md | — |
| C6.rel.56 | hard | tools/colab::NEVER tags, NEVER promotes | Never colab ship or code-ship, and colab promote only as --auto where promotion: main-loop grants it; none of them tags. | Never `colab ship` or `code-ship`, and `colab promote` only as `--auto` where `promotion: main-loop` grants it | CONVENTIONS.md | — |
| C6.rel.57 | default |  | Keep one tracking issue per version (release: vX.Y.Z). | Either way keeps one tracking issue per version | CONVENTIONS.md | — |
| C6.rel.58 | default |  | A human holds a candidate with the release-hold label; only a human removes it. | a human holds a candidate by putting the `release-hold` label on it (only a human removes it) | CONVENTIONS.md | — |
| C6.rel.59 | default |  | A regression against the candidate is a blocked_by edge on it; open, the final waits. | a regression against the candidate is a `blocked_by` edge on it — open, the final waits | CONVENTIONS.md | — |
| C6.rel.60 | default |  | A regression fixed after the test period began owes a new -rc.N+1 whose period starts afresh. | a new `-rc.N+1` is owed and its period starts afresh. | CONVENTIONS.md | — |
| C6.rel.61 | default |  | On deploy-tag the run stops at candidate ready and hands a human the one click. | on `deploy-tag` it stops at candidate ready and hands a human the one click. | CONVENTIONS.md | — |
| C6.rel.62 | default |  | Once a final is tagged, every issue the version carries gets one Released in vX.Y.Z comment. | gets one comment, `Released in vX.Y.Z`, telling its reporter which version has the fix | CONVENTIONS.md | — |
| C6.rel.63 | default |  | No agent cuts a final tag, or a candidate, by hand around these commands. | No agent cuts a final tag, or a candidate, by hand around these commands. | CONVENTIONS.md | — |
| C6.rel.64 | default |  | A deploy must never fire on a candidate; the audit flags a deploy trigger that matches one. | A deploy must never fire on a candidate: | CONVENTIONS.md | — |
| C6.rel.65 | default |  | The default stands: a final that deploys production is a human act, unless the operator grants otherwise for one repo. | The default above stands: a final that deploys production is a human act. | CONVENTIONS.md | — |
| C6.rel.66 | hard | tools/lib/release-finalize.js::an unresolved grant is not a grant | An automatic final is recorded by a human decision and never written by an agent; the grant is re-read on every run. | Recorded, never written by an agent. The operator rules on a decision issue | CONVENTIONS.md | — |
| C6.rel.67 | default |  | final: auto on deploy-tag without a recorded final-grant is a widening failure. | `final: auto` on `deploy-tag` without that line is the widening failure it always was. | CONVENTIONS.md | — |
| C6.rel.68 | default |  | An operator-granted automatic final is deploy: tag only; on deploy: manual the final stays human. | On `deploy: manual` a person runs the deploy anyway, so its final | CONVENTIONS.md | — |
| C6.rel.69 | default |  | The grant is per repo and revocable at once. | Deleting the line, `final: human`, or `colab decision <N> | CONVENTIONS.md | — |
| C6.rel.70 | hard | tools/lib/release-finalize.js::an automatically deployed final never carries an ungranted migration | An automatically deployed final carries no database migration since the last final unless the release is granted one. | an automatically deployed final carries no database migration since the last final unless the | CONVENTIONS.md | — |
| C6.rel.71 | default |  | An unresolved grant or ungranted migration takes the automatic final away; finalize --auto stops at candidate ready. | An unresolved grant or an ungranted migration does not refuse the release | CONVENTIONS.md | — |
| C6.rel.72 | default |  | Every automatic deploy says whose choice made it so in the final tag's message. | The final tag's message names the grant and its decision issue, and who ruled it. | CONVENTIONS.md | — |
| C6.rel.73 | default |  | On route deploy-tag-fast, every green trunk head tags the final directly, with no -rc and no test period. | `colab release cut --auto` tags the final `vX.Y.Z` directly — no `-rc`, no test period | CONVENTIONS.md | — |
| C6.rel.74 | default |  | deploy-tag-fast replaces the test period with two declarations and keeps every gate that does not depend on one. | It replaces the test period with two declarations and keeps | CONVENTIONS.md | — |
| C6.rel.75 | hard | tools/lib/release-cut.js::'final-grant' | deploy-tag-fast needs the operator's grant, re-read on every run; unreadable, untrusted or reopened means no tag. | names a recorded decision, re-read on every run by the audit and by `cut`; unreadable, untrusted or reopened → no tag | CONVENTIONS.md | — |
| C6.rel.76 | default |  | deploy-tag-fast needs a health-gated deploy that rolls itself back (release.health-url and release.rollback: auto). | (an `https://` endpoint reporting the running version) and `release.rollback: auto`. | CONVENTIONS.md | — |
| C6.rel.77 | default |  | The audit checks that both health-url and rollback are declared and that the release workflow deploys what it tags. | The audit checks that both are declared and that the release workflow deploys what it tags | CONVENTIONS.md | — |
| C6.rel.78 | default |  | deploy-tag-fast is deploy: tag only, not deploy: manual and not a no-production repo. | Not `deploy: manual` (a person deploys anyway), not a no-production | CONVENTIONS.md | — |
| C6.rel.79 | default |  | Missing the grant or the health gate, the route is an audit failure and deploy-tag stays in effect. | Missing the grant or the health gate, the route is an audit failure and `deploy-tag` stays in effect, final human. | CONVENTIONS.md | — |
| C6.rel.80 | default |  | On deploy-tag-fast the gates that stay: trunk CI green on the head and every other candidate condition. | trunk CI green on the head and every other candidate condition above | CONVENTIONS.md | — |
| C6.rel.81 | default |  | On deploy-tag-fast no open issue carrying release-hold may exist, repo-wide. | no open issue carrying `release-hold` (repo-wide — there is no candidate issue to put it on) | CONVENTIONS.md | — |
| C6.rel.82 | hard | tools/lib/release-cut.js::'migration-grant' | On deploy-tag-fast a database migration since the last final needs a migration grant on the version's tracking issue; otherwise the run refuses. | unless the version's tracking issue carries a migration grant | CONVENTIONS.md | — |
| C6.rel.83 | default |  | Finals are at least release.final-spacing apart (default and floor 1h); inside it a run is a no-op. | `release.final-spacing` (default and floor `1h`; longer | CONVENTIONS.md | — |
| C6.rel.84 | default |  | On deploy-tag-fast the deploy runs in the same run as the tag, never by a tag-push workflow. | A tag pushed with `GITHUB_TOKEN` starts no `push: tags` run, so a separate deploy-on-tag workflow | CONVENTIONS.md | — |
| C6.rel.85 | hard | tools/lib/release-cut.js::tags its finals only from the release workflow | A final cut by hand refuses on route deploy-tag-fast because it would have no deploy behind it. | a cut by hand refuses on this route, because it would have no deploy behind it. | CONVENTIONS.md | — |
| C6.rel.86 | default |  | colab release finalize on deploy-tag-fast always reports no candidate. | `colab release finalize` here always reports no candidate: | CONVENTIONS.md | — |
| C6.rel.87 | default |  | A container deploy builds every listed image once per final tag, in its own job not gated on the platform being switched on. | CI builds every image the repo lists once per final tag (`vX.Y.Z` and the commit sha) | CONVENTIONS.md | — |
| C6.rel.88 | default |  | A per-repo pre-deploy step runs before the deploy; its failure stops the deploy before anything changes. | A per-repo pre-deploy step (a database snapshot, say) runs next; its failure stops the deploy | CONVENTIONS.md | — |
| C6.rel.89 | default |  | A platform adapter tells the platform to run exactly vX.Y.Z, every image in one call. | A **platform adapter** tells the platform | CONVENTIONS.md | — |
| C6.rel.90 | default |  | A container deploy is green only on a verified running version, never on an HTTP 200 from the platform. | The deploy is green only on a verified running version | CONVENTIONS.md | — |
| C6.rel.91 | default |  | A failure after the platform accepted the call rolls back to the previous final and still fails the run. | A failure after the platform accepted the call rolls back to what ran before | CONVENTIONS.md | — |
| C6.rel.92 | default |  | A manual rollback is the same workflow run with the previous tag. | A manual rollback is the same workflow run with the previous tag. | CONVENTIONS.md | — |
| C6.rel.93 | default |  | On deploy-tag a human-pushed final starts the one deploy path (push: tags, finals only). | on `deploy-tag` a human-pushed final starts it (`push: tags`, finals only); | CONVENTIONS.md | — |
| C6.rel.94 | default |  | Use one platform key per app, for a non-admin user owning only that app's stack, never an admin key. | for a non-admin user owning only that app's stack — never an admin key. | CONVENTIONS.md | — |
| C6.rel.95 | default |  | Every server runs its own platform instance, configured by that host's URL, environment and stack. | Every server runs its own platform instance, so the configuration is that host's URL, environment and | CONVENTIONS.md | — |
| C6.rel.96 | hard | tools/lib/release-tag.js::does not equal the manifest version | Under release.version-source: manifest the pre-tag check refuses a tag that disagrees with a declared manifest. | pre-tag check refuses a tag that disagrees with any declared manifest | CONVENTIONS.md | — |
| C6.rel.97 | default |  | Stamp the version from the tag on a deploy-only ref or at build time, never as a commit on trunk. | never as a commit on trunk: the release workflow never pushes one | CONVENTIONS.md | — |
| C6.rel.98 | default |  | The default version-source follows who cuts the tag: tag where the machine cuts, manifest where a person does. | Where the machine does — automatic candidates, or a final | CONVENTIONS.md | — |
| C6.rel.99 | default |  | A declared version-source wins either way. | A declared value wins either way; the cut and the final read the same one | CONVENTIONS.md | — |
| C6.rel.100 | default |  | Under tag, any version a user sees reads the tag or a stamp made from it, never the trunk manifest. | each reads the tag or a stamp made from it at release or build time. | CONVENTIONS.md | — |
| C6.rel.101 | default |  | On public-tool a repo may opt in to npm publishing through release.npm and release.npm-gate. | the package directory and the command that proves its tarball holds only what was meant to ship | CONVENTIONS.md | — |
| C6.rel.102 | default |  | npm publishes a candidate to dist-tag next and a final to latest, both with provenance; latest never moves to a candidate. | a candidate `vX.Y.Z-rc.N` to dist-tag `next`, a final `vX.Y.Z` to `latest`, both with provenance | CONVENTIONS.md | — |
| C6.rel.103 | default |  | npm publishing is offered on public-tool alone and is an audit failure on any other route. | npm is offered on `public-tool` alone and is an audit failure on any other route. | CONVENTIONS.md | — |
| C6.rel.104 | default |  | npm publishing uses trusted publishing (OIDC) only; no npm token is stored, read or offered as a fallback. | No npm token is stored, read, or offered as a fallback; | CONVENTIONS.md | — |
| C6.rel.105 | default |  | The npm job runs GitHub-hosted even where the rest of the workflow is self-hosted. | so this job runs **GitHub-hosted** even where the rest of the workflow is | CONVENTIONS.md | — |
| C6.rel.106 | default |  | The npm publish happens in the same run as the tag, never in a tag-triggered workflow. | Same run, never a tag-triggered workflow | CONVENTIONS.md | — |
| C6.rel.107 | default |  | A private repository never publishes to public npm; the job reads visibility from the API and refuses a private or unreadable one. | Visibility is not in `project.yml`, so the job reads it from the API and refuses a private or unreadable one. | CONVENTIONS.md | — |
| C6.rel.108 | default |  | The npm publish never moves git; if publishing fails the tag stands and re-running publishes it. | If publishing fails, the tag stands, the Release says tagged, not published | CONVENTIONS.md | — |
| C6.rel.109 | default |  | next always names the newest candidate and colab release cut fast-forwards it. | always the newest **candidate** (`vX.Y.Z-rc.N`). `colab release cut`, automatic or | CONVENTIONS.md | — |
| C6.rel.110 | default |  | stable always names the newest final and colab release finalize fast-forwards it. | always the newest **final** (`vX.Y.Z`). `colab release finalize`, automatic or | CONVENTIONS.md | — |
| C6.rel.111 | default |  | Channels are branches, not tags, so version tags stay immutable. | They are branches, not tags. | CONVENTIONS.md | — |
| C6.rel.112 | hard | templates/pre-push-guard::COLAB_RELEASE | Release channels move only with a release, forward only; pre-push-guard refuses a hand push to either. | refuses a hand push to either (the release commands push with their own process-identity variable, the `colab ship` | CONVENTIONS.md | — |
| C6.rel.113 | default |  | Channels move forward only, never forced; a channel that is not an ancestor of the new commit is reported and left alone. | both move forward only, never forced — a channel that is not an ancestor of the new commit | CONVENTIONS.md | — |
| C6.rel.114 | default |  | A channel move that cannot happen is a warning, never a reason to undo the tag. | A channel move is best-effort like the GitHub pre-release | CONVENTIONS.md | — |
| C6.rel.115 | default |  | A consumer pins stable by default, next as the fast channel, or an exact version tag as frozen. | defaults to `stable`; a repo may pin `next` (the fast channel) or an exact version | CONVENTIONS.md | — |
| C6.rel.116 | default |  | A pinned ref the handbook does not carry falls back to the newest final carrying every verb, else next, with a warning. | the fetch step falls back to the | CONVENTIONS.md | — |
| C6.rel.117 | default |  | A tool installed with npx follows a channel by resolving it to the release tag before installing, never as a ref. | the channel is resolved to the release tag on it before anything is installed, never installed as | CONVENTIONS.md | — |
| C6.rel.118 | default |  | Versioning is SemVer: patch for fixes, minor for features, major for breaking changes. | Patch for fixes, minor for features, major for breaking changes. | CONVENTIONS.md | — |
| C6.rel.119 | default |  | Pre-1.0 repos use v0.x.y, treating minor as a meaningful increment. | Pre-1.0 repos use `v0.x.y`, treating minor as | CONVENTIONS.md | — |
| C6.rel.120 | default |  | Every version number is computed, majors included; no human picks or approves a number. | No human picks or approves a | CONVENTIONS.md | — |
| C6.rel.121 | default |  | Since the last final tag, fixes and chores only give a patch bump. | fixes / chores only → patch (`1.2.0` → `1.2.1`); | CONVENTIONS.md | — |
| C6.rel.122 | default |  | Any feature, or an epic's switch-removal child merged, gives a minor bump. | any feature, or an epic's switch-removal child merged → minor | CONVENTIONS.md | — |
| C6.rel.123 | default |  | A breaking change is a minor below 1.0 and a major from 1.0. | a breaking change → minor below 1.0 (SemVer §4 | CONVENTIONS.md | — |
| C6.rel.124 | hard | tools/lib/release-cut.js::a major needs its own migration section | A major must carry a migration section with the measured cost or it is refused. | A major must carry a migration section with the measured cost | CONVENTIONS.md | — |
| C6.rel.125 | default |  | Put the reasoning in the release notes: the bump computed, which input decided it, and each breaking change found. | Put the reasoning in the release notes: the bump computed, which input decided it, and each breaking change found | CONVENTIONS.md | — |
| C6.rel.126 | default |  | An unfinished feature never waits for a release and never reaches one switched on. | An unfinished feature never waits for a release, and never reaches one switched on. | CONVENTIONS.md | — |
| C6.rel.127 | default |  | Every tag gets a release summary grouping commits since the previous tag by Conventional-Commit type. | Every tag gets a release summary — a published GitHub Release grouping commits since | CONVENTIONS.md | — |
| C6.rel.128 | default |  | When the release workflow cannot run, the summary is still owed; use the manual fallback. | the summary is still owed. Manual fallback, same output: | CONVENTIONS.md | — |
| C6.rel.129 | default |  | Merged is not released: measure the gap with colab release-status, flagging a fix: or breaking commit. | Merged is not released — measure the gap, don't wait to notice it by eye. | CONVENTIONS.md | — |
| C6.rel.130 | default |  | The suggested SemVer bump is an input; the coordinator confirms or overrides it and states the reason in the release notes. | the coordinator confirms or overrides it and states the reason in the release notes | CONVENTIONS.md | — |
| C6.rel.131 | default |  | Measure the release gap against main, never dev. | Measured against `main`, never `dev` — `git describe` from a `dev` checkout answers a stale question. | CONVENTIONS.md | — |
| C6.rel.132 | default |  | Do not tag from dev; do not tag a commit that has not passed the full suite on main. | Do not tag from `dev`. Do not tag a commit that has not passed the full suite on `main`. | CONVENTIONS.md | — |
| C6.rel.133 | default |  | On a trunk: dev repo a version bump reaches main through the promotion, never after it. | a version bump reaches `main` through the promotion, never after it. | CONVENTIONS.md | — |

### Distribution — one install surface: npx (#442)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C6.dist.01 | default |  | Every distributed tool installs with npx so installing looks the same everywhere and needs no gh CLI or token. | Every distributed tool installs with `npx`, so installing looks the same everywhere | CONVENTIONS.md | — |
| C6.dist.02 | default |  | GitHub Releases are not an install path; a Release carries the summary, never the bits a user runs. | GitHub Releases are not an install path — a Release carries the summary, never the bits a user runs | CONVENTIONS.md | — |
| C6.dist.03 | default |  | A public compiled tool ships per-platform npm packages (optionalDependencies with os/cpu), with no postinstall download. | per-platform npm packages (`optionalDependencies`, each with `os`/`cpu`) — no `postinstall` download | CONVENTIONS.md | — |
| C6.dist.04 | default |  | A private JS tool installs from git and is built by prepare if it needs building. | (none — built by `prepare` if it needs building) | CONVENTIONS.md | — |
| C6.dist.05 | default |  | A private compiled tool ships its binaries as dist refs in the same repo. | dist refs in the same repo (below) | CONVENTIONS.md | — |
| C6.dist.06 | default |  | A private repo never reaches public npm, so both private rows install from git. | A private repo never reaches public npm — `@<org>` there is always public | CONVENTIONS.md | — |
| C6.dist.07 | default |  | A private compiled tool's release run pushes one orphan commit per platform to a dist ref holding the binary and its SHA256SUMS. | The release run builds every platform and pushes one orphan commit per platform to | CONVENTIONS.md | — |
| C6.dist.08 | default |  | Dist-ref commits have no parent so they never touch trunk history. | The commits have no parent, so they never touch trunk history. | CONVENTIONS.md | — |
| C6.dist.09 | default |  | The launcher fetches exactly one dist ref with the same git and URL npx just cloned from, verifies the checksum and execs the binary. | with the same git and the same URL npx just cloned from | CONVENTIONS.md | — |
| C6.dist.10 | default |  | Repository read access is the only lock on a dist ref, exactly as for the source. | Repository read access is the only lock, exactly as for the source. | CONVENTIONS.md | — |
| C6.dist.11 | default |  | The dist-refs workflow refuses a public or unreadable repository, a non-tag version and a platform without its binary, and never moves an existing dist ref. | it refuses a public or unreadable repository, a version that is not a | CONVENTIONS.md | — |
| C6.dist.12 | default |  | The launcher installs the release npx was asked for and refuses rather than guessing when no version source exists. | with none of them it refuses rather than guessing. | CONVENTIONS.md | — |
| C6.dist.13 | default |  | The checksum proves the bytes, not the publisher; the trust anchor is write access to the repository. | The checksum proves the bytes, not the publisher. | CONVENTIONS.md | — |
| C6.dist.14 | default |  | A dist ref is a tag, so contributors who mind a full clone clone with --no-tags. | Contributors who mind clone with `--no-tags`. | CONVENTIONS.md | — |
| C6.dist.15 | default |  | Publish or push in the same run as the release cut. | Publish or push in the same run as the release cut. | CONVENTIONS.md | — |
| C6.dist.16 | default |  | Use trusted publishing (OIDC) for npm, never a token. | Trusted publishing (OIDC) for npm, never a token | CONVENTIONS.md | — |
| C6.dist.17 | default |  | A long-running tool never runs from npx's cache. | A long-running tool never runs from npx's cache. | CONVENTIONS.md | — |
| C6.dist.18 | default |  | The audit reports a private repository whose workflows upload GitHub Release assets as advisory. | as **advisory** (`warn`): an asset can be a legitimate by-product | CONVENTIONS.md | — |
| C6.dist.19 | default |  | A repository that declares distribution: js or compiled is checked for its row's install route; a missing route is advisory. | is checked for its row's install route: a publish step plus a non-private `bin` | CONVENTIONS.md | — |
| C6.dist.20 | default |  | An undeclared repository is never checked for a distribution route. | An undeclared repository is never checked | CONVENTIONS.md | — |

### Services over npx — init, update, rollback (#465)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C6.svc.01 | default |  | A per-machine service installs with npx like every other tool but never runs from npx. | installs with npx like every other tool, but never runs from npx | CONVENTIONS.md | — |
| C6.svc.02 | default |  | A service owns init, update and rollback verbs plus status and uninstall, implemented with templates/npx-service.mjs. | (plus `status` and `uninstall`), and adopters implement them with | CONVENTIONS.md | — |
| C6.svc.03 | default |  | init installs the version npx was asked for under a stable per-user path, writes a shim, writes and loads the unit and checks health. | installs the version npx was asked for under a stable per-user path | CONVENTIONS.md | — |
| C6.svc.04 | default |  | update installs the target beside the running version, switches, restarts and checks health. | resolves its target, installs it **beside** the running version | CONVENTIONS.md | — |
| C6.svc.05 | default |  | A failed update health check switches back to the previous version and exits 1. | A failed health check switches back | CONVENTIONS.md | — |
| C6.svc.06 | default |  | A failed fetch or build happens before the switch and changes nothing. | A failed fetch or build happens before the switch, so it changes nothing at all. | CONVENTIONS.md | — |
| C6.svc.07 | default |  | update --check reports what an update would do and writes nothing. | reports what an update would do and writes nothing. | CONVENTIONS.md | — |
| C6.svc.08 | default |  | rollback switches to the previous version through the same health-checked switch. | switches to the previous version through the same health-checked switch | CONVENTIONS.md | — |
| C6.svc.09 | default |  | uninstall unloads the service, deletes unit files, shim and data directory, keeps config and state unless --purge. | unloads the service (and its update timer), deletes the unit files, the | CONVENTIONS.md | — |
| C6.svc.10 | default |  | uninstall removes only a shim the template wrote. | It removes only a shim the template wrote. | CONVENTIONS.md | — |
| C6.svc.11 | default |  | Each version is installed into its own directory under the user's data directory, with links naming the running and previous version. | Each version is installed into its own directory under the user's data directory | CONVENTIONS.md | — |
| C6.svc.12 | default |  | The service unit and the shim point through the current link so an update or rollback is one atomic rename. | The service unit and the shim point | CONVENTIONS.md | — |
| C6.svc.13 | default |  | A few versions are kept; the running and previous ones are never pruned. | the running and previous ones are never pruned. | CONVENTIONS.md | — |
| C6.svc.14 | default |  | A service unit pointing into npx's cache or a checkout is the failure this rule prevents. | A service unit pointing into npx's cache, or into | CONVENTIONS.md | — |
| C6.svc.15 | default |  | A channel is resolved to a version, never installed as one. | so a channel is resolved to a version, never | CONVENTIONS.md | — |
| C6.svc.16 | default |  | update resolves a channel through the origin's channel tip and its release tags; a tip with no release tag refuses and is never guessed. | A tip with no release tag refuses | CONVENTIONS.md | — |
| C6.svc.17 | default |  | init records the channel to follow (default stable); update --channel changes it; update --version pins. | `init` records the channel to follow (default `stable`); | CONVENTIONS.md | — |
| C6.svc.18 | default |  | Following automatically is a timer that runs the same update, never a second mechanism. | Following automatically is a timer that runs the same `update`, never a second mechanism | CONVENTIONS.md | — |
| C6.svc.19 | default |  | A pinned install's timer runs and changes nothing. | A pinned install's timer runs and changes nothing | CONVENTIONS.md | — |
| C6.svc.20 | default |  | A one-shot command at a channel resolves the channel on the commit npx installed to its release tag; pin a version where round trips matter. | the launcher resolves the channel on the commit npx installed | CONVENTIONS.md | — |
| C6.svc.21 | default |  | Any branch other than a release channel is refused for a one-shot command because it names no release. | Any other branch (`#main`) is still refused: it names no release. | CONVENTIONS.md | — |
| C6.svc.22 | default |  | Everything under the install directory is disposable; nothing a machine owns may live there, in the package or in the unit file. | nothing a machine owns may live there, nor in the package, nor in the unit file | CONVENTIONS.md | — |
| C6.svc.23 | default |  | Config and secrets live in XDG_CONFIG_HOME/tool (mode 0700, secret files 0600) or the OS keychain. | (mode `0700`, secret files `0600`) or the OS | CONVENTIONS.md | — |
| C6.svc.24 | default |  | State and logs live in XDG_STATE_HOME/tool. | state and logs: `$XDG_STATE_HOME/<tool>/`. | CONVENTIONS.md | — |
| C6.svc.25 | default |  | The unit passes the service the locations of config and state, never a value. | The unit passes the service the **locations** | CONVENTIONS.md | — |
| C6.svc.26 | default |  | init creates the directories and never overwrites a file in them. | `init` creates the directories and never overwrites a file in them. | CONVENTIONS.md | — |
| C6.svc.27 | default |  | Deleting the whole data directory must lose nothing a reinstall cannot bring back. | Deleting the whole data directory must lose nothing a reinstall cannot bring back. | CONVENTIONS.md | — |
| C6.svc.28 | default |  | A JS app that needs a build builds in prepare, lists the built output in files, and every machine needs the toolchain. | Two conditions: the built output must be listed in `files` | CONVENTIONS.md | — |
| C6.svc.29 | default |  | A build that cannot run on the target ships prebuilt as a platform-neutral dist ref (platforms: any). | ships its output prebuilt instead, as a platform-neutral dist ref (#470) | CONVENTIONS.md | #470 |
| C6.svc.30 | default |  | The service template's dist kind verifies the archive and refuses an absolute or .. entry before any switch. | refuses an archive with an absolute or `..` entry | CONVENTIONS.md | — |
| C6.svc.31 | default |  | The service template writes a launchd agent on macOS and a systemd user unit on Linux, and refuses Windows. | The template writes a launchd agent on macOS and a systemd user unit on | CONVENTIONS.md | — |
| C6.svc.32 | default |  | init prints the lingering command for a Linux service and never runs it. | `init` prints the command and never runs it. | CONVENTIONS.md | — |

### 7. CI and toolchain

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C7.ci.01 | default |  | CI lives in the adopter's repo and belongs to it; templates are copyable starting points, nothing is called remotely. | Your CI lives in your repo and belongs to you. | CONVENTIONS.md | — |
| C7.ci.02 | default |  | A copy of a deploy template is the adopter's to keep green from then on. | a copy is the adopter's to keep green from then on. | CONVENTIONS.md | — |
| C7.ci.03 | default |  | Every pull request must run, at minimum, a secret scan and a build. | every pull request must run, at minimum, a secret scan and a build | CONVENTIONS.md | — |
| C7.ci.04 | default |  | CI must trigger on pushes to the trunk itself, not only on branches the trunk no longer is. | CI must trigger on pushes to the trunk itself, not only on branches the trunk no | CONVENTIONS.md | — |
| C7.ci.05 | default |  | When a repo's trunk moves, updating the CI triggers is part of the move. | When a repo's trunk moves, updating the CI triggers is part of the move, and the audit checks it. | CONVENTIONS.md | — |

### CI — what it is follows the unit's shape, how much follows exposure

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C7.ci-shape.01 | default |  | With a branch, CI runs before the merge as a gate; with no branch it runs after the push as an alarm, not a filter. | CI runs before the merge: a gate, something to inspect before a unit lands. | CONVENTIONS.md | — |
| C7.ci-shape.02 | default |  | Never read a post-push run as a gate. | reading a post-push run as a gate is the mistake | CONVENTIONS.md | — |
| C7.ci-shape.03 | default |  | A repo where a pre-merge gate must inspect every unit says so by having one, a trunk-gating CI workflow or branch protection, never by a declared value. | A repo where a pre-merge gate must inspect every unit says so by having one | CONVENTIONS.md | — |
| C7.ci-shape.04 | default |  | How thorough CI must be comes from exposure: live and released answer to a consumer, so more is caught before it reaches them. | `live` and `released` answer to a consumer with no way to ask a clarifying question | CONVENTIONS.md | — |
| C7.ci-shape.05 | default |  | Trunk-direct needs a gate somewhere other than CI's alarm, at the deploy step if nowhere else. | trunk-direct needs a gate somewhere other than CI's alarm, at the deploy step if | CONVENTIONS.md | — |
| C7.ci-shape.06 | default |  | Where nothing gates the deploy either, trunk-direct is unsafe and that is the finding to report. | Where nothing gates the deploy either, trunk-direct is unsafe, and that is | CONVENTIONS.md | — |
| C7.ci-shape.07 | default |  | Provision CI for planned exposure, not current: an exposure: none repo with a named production runs at live thoroughness. | Provision CI for planned exposure, not current. | CONVENTIONS.md | — |
| C7.ci-shape.08 | default |  | Test contracts follow the named consumer. | Test contracts follow the named consumer | CONVENTIONS.md | — |
| C7.ci-shape.09 | default |  | A repo holding an unfinished switched epic runs its suite twice, in the release and development configurations. | A repo holding an unfinished switched epic runs its suite twice | CONVENTIONS.md | — |
| C7.ci-shape.10 | default |  | There is no ci: field; a repo needing more edits its copied workflow directly. | A repo needing something its copied templates don't cover edits that | CONVENTIONS.md | — |

### Self-hosted runners — capacity is the agent count, not the machine (#355)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C7.runners.01 | default |  | A repo's capacity is how many agents it has, not how big the host is. | A repo's capacity is how many agents it has, not how big the host is. | CONVENTIONS.md | — |
| C7.runners.02 | default |  | Measure queue and work separately, at job and step level, before optimising either. | Measure queue and work separately, at job and step level. | CONVENTIONS.md | — |
| C7.runners.03 | default |  | Where the merge gate waits for a completed trunk run, give trunk its own agent. | Where the merge gate waits for a completed trunk run, give trunk its own agent. | CONVENTIONS.md | — |
| C7.runners.04 | default |  | Use disjoint label sets: trunk gets a trunk-only label, everything else the general one, chosen in runs-on on github.ref. | label sets: trunk → a trunk-only label, everything else → the general one, | CONVENTIONS.md | — |
| C7.runners.05 | default |  | Register the agent before merging the routing, and change the routing in the same change that retires the agent. | Register the agent before merging the routing, and change the routing in the same | CONVENTIONS.md | — |
| C7.runners.06 | default |  | Route every job of a trunk run, including non-blocking ones. | Route every job of a trunk run, including non-blocking ones. | CONVENTIONS.md | — |
| C7.runners.07 | default |  | With few agents, fold a tiny job such as the secret scan into the main job as its first steps, with full history checked out. | Fold it into the main job as its first steps | CONVENTIONS.md | — |
| C7.runners.08 | default |  | Split jobs out again only when there are enough agents to run them side by side. | Split jobs out again only when there are enough agents | CONVENTIONS.md | — |
| C7.runners.09 | default |  | Never run the same check twice in one job. | Never run the same check twice in one job. | CONVENTIONS.md | — |
| C7.runners.10 | default |  | Test parallelism follows the cores the runner exposes, but more cores only help a CPU-bound suite; compare wall time with CPU used. | Test parallelism follows the cores the runner exposes, but more cores only help a | CONVENTIONS.md | — |
| C7.runners.11 | default |  | Cap test-runner workers in CI with a fixed number sized to the slot's memory, not to the CPUs the job can see. | Cap test-runner workers in CI with a fixed number. Size it to the slot's memory, | CONVENTIONS.md | — |
| C7.runners.12 | default |  | Read the worker cap from CI so that local runs keep their full parallelism. | The fix is a cap in the test config, read from CI so that local runs keep | CONVENTIONS.md | — |
| C7.runners.13 | default |  | Pick the worker number from the slot's memory divided by one worker's peak, with room left for the work dir; do not use the core count. | Pick the number from the slot's memory divided by one worker's peak | CONVENTIONS.md | — |
| C7.runners.14 | default |  | If a suite that was green times out on a self-hosted pool with no code change, check the slot's memory pressure and the worker count before widening any timeout. | If a suite that used to be green starts timing out on a self-hosted pool with | CONVENTIONS.md | — |
| C7.runners.15 | default |  | Before adding an agent, check the runner's disk as well as its memory. | Before adding an agent, check the runner's disk as well as its memory. | CONVENTIONS.md | — |
| C7.runners.16 | default |  | On a persistent runner tests must clean up after themselves. | A persistent runner never resets, so tests must clean up after themselves. | CONVENTIONS.md | — |

### Toolchain versions — strict precedence

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C7.toolchain.01 | default |  | Never hardcode a version in CI; resolve it in the strict order below. | Never hardcode a version in CI. Resolve it, in this order: | CONVENTIONS.md | — |
| C7.toolchain.02 | default |  | Toolchain keys in .github/project.yml win. | toolchain keys, if present — wins. | CONVENTIONS.md | — |
| C7.toolchain.03 | default |  | Otherwise resolve from the ecosystem's own manifest. | (`.nvmrc`/`engines.node`; `composer.json`; `.python-version`/`requires-python`) — the normal answer. | CONVENTIONS.md | — |
| C7.toolchain.04 | default |  | Otherwise fail the build; never fall back to a default. | Fail the build. Never fall back to a default. | CONVENTIONS.md | — |
| C7.toolchain.05 | default |  | When project.yml's pin and the manifest disagree, report a finding, do not resolve it quietly. | When project.yml's pin and the manifest disagree, that is a finding to report, not resolve quietly. | CONVENTIONS.md | — |
| C7.toolchain.06 | default |  | requirements.txt does not declare an interpreter; a Python repo with only that file must add python: to project.yml or a .python-version. | a Python repo carrying only that file must add `python:` to `project.yml` or a `.python-version`. | CONVENTIONS.md | — |
| C7.toolchain.07 | default |  | A missing template is not a neutral absence; do not copy another ecosystem's template with a hardcoded version. | A missing template is not a neutral absence | CONVENTIONS.md | — |

### Test fixtures — neutralise ambient machine state, don't inherit it

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C7.fixtures.01 | default |  | A test asserting a specific message or refusal must neutralise ambient credentials and configuration rather than inherit them. | A test asserting a specific message or refusal must neutralise ambient credentials and | CONVENTIONS.md | — |
| C7.fixtures.02 | default |  | A git fixture helper sets user.email, user.name and core.hooksPath (pointed at a nonexistent directory) before it ever commits. | and `core.hooksPath` (pointed at a nonexistent directory) | CONVENTIONS.md | — |

### 8. Conformance and reconciliation

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C8.conf.01 | default |  | Conformance is checked from outside by the audit tool, across every owner including local-only repos. | Because branch protection is unavailable, conformance is checked from outside by the | CONVENTIONS.md | — |
| C8.conf.02 | default |  | Run the audit on a schedule; only genuine findings fail the exit code. | Run it on a schedule; only genuine findings fail the exit code. | CONVENTIONS.md | — |

### How repos find out when the handbook changes

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C8.stamps.01 | default |  | Templates are copy-and-own, never called remotely, and every copy is stamped with the handbook version it came from. | Templates are copy-and-own, never called remotely. Every copy is stamped with the handbook | CONVENTIONS.md | — |
| C8.stamps.02 | default |  | Workflow copies carry the stamp # colab-handbook: template @ version. | Workflow copies: `# colab-handbook: <template> @ <version>`. | CONVENTIONS.md | — |
| C8.stamps.03 | default |  | The CLAUDE conventions block carries the stamp <!-- colab-handbook @ version -->. | The CLAUDE conventions block: `<!-- colab-handbook @ <version> -->`. | CONVENTIONS.md | — |
| C8.stamps.04 | hard | tools/colab::already exists — not overwriting. | colab template copies and stamps in one act, refusing to overwrite without --force. | copies and stamps in one act, refusing to overwrite without | CONVENTIONS.md | — |
| C8.stamps.05 | default |  | A template changed since the stamped version is an audit finding; an unstamped copy, unknown template or newer stamp is advisory. | a template changed since the stamped version is a finding; an unstamped copy, unknown template, or a | CONVENTIONS.md | — |
| C8.stamps.06 | default |  | Reconcile deliberately: read the diff, colab template name --force, commit. | Reconcile deliberately: read the diff, `colab template <name> --force`, commit. | CONVENTIONS.md | — |
| C8.stamps.07 | default |  | A rule-neutral change downgrades the finding to a warn only when declared, never inferred (#272). | A rule-neutral change downgrades the finding to a warn — declared, never inferred | CONVENTIONS.md | #272 |
| C8.stamps.08 | default |  | Bytes drift is always a hard fail by default. | Bytes drift is always a hard fail by default | CONVENTIONS.md | — |
| C8.stamps.09 | default |  | The person editing templates/ declares rule-neutrality with a Rule-Neutral: yes commit trailer. | the person editing `templates/` states the claim themselves | CONVENTIONS.md | — |
| C8.stamps.10 | default |  | The audit downgrades fail to warn only when every commit touching that template since the stamp carries the trailer. | The audit only downgrades fail→warn when every commit touching that template | CONVENTIONS.md | — |
| C8.stamps.11 | default |  | Declaring nothing is the default and keeps today's drift reporting. | Declaring nothing is the default and it is exactly today's behaviour | CONVENTIONS.md | — |
| C8.stamps.12 | default |  | CI and secret-scan templates (ci-*) are never eligible for the rule-neutral downgrade. | CI and secret-scan templates (`ci-*`) are never eligible, trailer or not | CONVENTIONS.md | — |
| C8.stamps.13 | default |  | A Rule-Neutral declaration is a claim about intent; a false one is a human error to catch in review. | This is a claim about intent, not a computed fact | CONVENTIONS.md | — |
| C8.stamps.14 | hard | tools/lib/squash.js::Rule-Neutral | The Rule-Neutral trailer must survive the squash, so it stays on the squash's carried-trailer allowlist. | The trailer must survive the squash. This repo's own | CONVENTIONS.md | — |
| C8.stamps.15 | hard | tools/colab::Rewrite a behind-but-pristine workflow copy as the current template | colab update --apply refreshes only copies still pristine as of their own stamp and never commits or rewrites a hand-edited copy. | refreshes only those still pristine as of their own stamp — never commits, never rewrites a | CONVENTIONS.md | — |
| C8.stamps.16 | default |  | A stamp older than current is not behind; behind means the template actually changed since that stamp. | behind means the template actually changed since that stamp | CONVENTIONS.md | — |
| C8.stamps.17 | default |  | The frozen CLI copy is measured against the latest tag, not HEAD. | The frozen CLI copy is measured against the latest tag, not `HEAD` | CONVENTIONS.md | — |
| C8.stamps.18 | hard | tools/colab::stamp.unstampedFinding(prov) | An unstamped copy is never rewritten by any flag. | An unstamped copy is never rewritten by any flag — unknown lineage, human re-copies deliberately. | CONVENTIONS.md | — |
| C8.stamps.19 | hard | tools/lib/stamp.js::workflowProvenance | Provenance is decided by content, never filename; a file merely sharing a template's name is reported unrelated. | Provenance is decided by content, never filename — a file merely sharing a template's name is reported `unrelated` | CONVENTIONS.md | — |

### Labels reconcile too — not just stamped files

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C8.labels.01 | default |  | An adopted repo missing any convention label is a finding, provided the audit can read the label set. | An adopted repo missing any convention label is a finding — provided the audit can read | CONVENTIONS.md | — |
| C8.labels.02 | default |  | Label-set provisioning is idempotent (\|\| true) and safe to re-run on every sync. | and safe to re-run on every sync — the mechanism by which a label added in a | CONVENTIONS.md | — |

### Local policy — a repo refines a skill without forking it (#520)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C8.policy.01 | default |  | A repo refines a handbook skill in .colab/skills/skill.md, one optional file per skill, free prose. | one optional file per skill, free prose. | CONVENTIONS.md | — |
| C8.policy.02 | default |  | Every skill loads its local-policy file: if .colab/skills/skill.md exists in this repo, read it before continuing. | exists in this repo, read it before continuing | CONVENTIONS.md | — |
| C8.policy.03 | default |  | With no local-policy file, the skill runs unchanged. | With no file, the skill runs unchanged. | CONVENTIONS.md | — |
| C8.policy.04 | default |  | Keep every skill step under its own number so an overlay names the step it refines. | the core keeps every step under its own number | CONVENTIONS.md | — |
| C8.policy.05 | default |  | Local policy refines the skill for this repo and wins over the skill's own text where they differ. | local policy refines the skill for this repo and wins over the skill's own | CONVENTIONS.md | — |
| C8.policy.06 | default |  | Local policy never changes a colab gate; a refusal from a colab command is not prose an overlay can talk past. | It never changes a `colab` gate — a refusal from `colab ship`, | CONVENTIONS.md | — |
| C8.policy.07 | hard | tools/lib/docs-only.js::.colab/skills | A diff touching .colab/skills/ is never docs-only; it merges on auto-trunk or a human's go. | Because the file is agent instructions, a diff touching `.colab/skills/` is never | CONVENTIONS.md | — |
| C8.policy.08 | default |  | The handbook defines the one local-policy layer and nothing on top of it. | The handbook defines this one layer and nothing on top of it. | CONVENTIONS.md | — |

### Upstream — a consumer that changes what a convention means files it here (#362)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C8.upstream.01 | default |  | A consumer change that alters what a convention label or value means, or adds a value inside a convention family, carries a linked handbook issue. | A consumer change that does either of these carries a linked handbook issue: | CONVENTIONS.md | — |
| C8.upstream.02 | default |  | The author of the consumer change files the upstream issue as part of the same unit of work. | Who files it: the author of the consumer change | CONVENTIONS.md | — |
| C8.upstream.03 | default |  | File the upstream issue before the consumer change reaches its own trunk, with a Handbook: issue URL line in the issue or merge message. | How fast: before the consumer change reaches its own trunk. | CONVENTIONS.md | — |
| C8.upstream.04 | default |  | A divergence discovered after the fact is filed by whoever discovers it, in the same session, never deferred to the next sync. | A divergence discovered after the fact, with no such line, is filed by whoever discovers it, in the same session. | CONVENTIONS.md | — |
| C8.upstream.05 | default |  | The upstream issue carries no agent-filed label and its Filed-by line names whoever approved the consumer change. | so it carries no `agent-filed` label. | CONVENTIONS.md | — |
| C8.upstream.06 | default |  | The upstream issue describes the consumer by shape; the link runs consumer to handbook, never the reverse. | The link runs consumer → handbook, never the reverse, because the handbook is public. | CONVENTIONS.md | — |
| C8.upstream.07 | default |  | The upstream issue ends in one of three outcomes: adopt the meaning, decline and revert, or rule a legitimate local variant. | The upstream issue ends in one of three outcomes: | CONVENTIONS.md | — |
| C8.upstream.08 | default |  | Until the upstream issue closes, the consumer declares the divergence in its CLAUDE.md as a Local divergences: list. | the consumer declares the divergence in its `CLAUDE.md`, next to the handbook pointer block | CONVENTIONS.md | — |
| C8.upstream.09 | default |  | Each Local divergences line gives the label or value, what it means here, and the handbook issue URL. | Each line gives the label or value, what it means here, and the handbook issue URL. | CONVENTIONS.md | — |
| C8.upstream.10 | default |  | When the upstream issue closes, remove the line if the meaning was adopted or reverted; keep it pointing at the ruling for a local variant. | When the issue closes, remove the line if the meaning was adopted or reverted. | CONVENTIONS.md | — |
| C8.upstream.11 | default |  | An undeclared consumer-local meaning or value is drift, not a local customisation. | An undeclared consumer-local meaning or value is **drift, not a local customisation**. | CONVENTIONS.md | — |
| C8.upstream.12 | default |  | handbook-sync is the enforcement point for a missing upstream issue. | This is the enforcement point, chosen over the two alternatives: | CONVENTIONS.md | — |
| C8.upstream.13 | default |  | The filing obligation sits with the change; handbook-sync is where a skipped one gets found. | The filing obligation still sits with the change. | CONVENTIONS.md | — |
| C8.upstream.14 | default |  | colab labels --ensure creates missing labels and never rewrites an existing description on its own. | `colab labels --ensure` creates missing labels and never rewrites an existing | CONVENTIONS.md | — |
| C8.upstream.15 | default |  | colab labels --ensure --refresh-descriptions rewrites differing descriptions on request; --keep name spares a declared divergence. | `colab labels --ensure --refresh-descriptions` rewrites them on request | CONVENTIONS.md | — |

### Refusals name the next command (#532)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C8.refusal.01 | hard | tools/lib/refusal-sites.test.js::every refusal names its next command | Every refusal colab prints ends with the exact next command, or says no command can and who decides. | Every refusal `colab` prints ends with the exact next command | CONVENTIONS.md | #532 |
| C8.refusal.02 | default |  | "Retry later" counts as a remedy only when it names what to wait for. | counts only when it names what to wait for | CONVENTIONS.md | #532 |
| C8.refusal.03 | default |  | An interactive flow checks each answer when it is given, not after the last question. | an interactive flow checks each answer when it is | CONVENTIONS.md | #532 |
| C8.refusal.04 | default |  | The known list of pre-rule refusals with no remedy only shrinks. | which only shrinks | CONVENTIONS.md | #532 |

### The fleet registry is private

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C8.registry.01 | default |  | The list of repos the audit sweeps lives at ~/.colab/repos.txt, machine-local and never committed. | The list of repos the audit sweeps lives at `~/.colab/repos.txt`, machine-local, never | CONVENTIONS.md | — |
| C8.registry.02 | default |  | The committed audit/repos.txt is a neutral format example and last-resort fallback only. | is a neutral format example and last-resort fallback | CONVENTIONS.md | — |
| C8.registry.03 | default |  | The fleet list resolves --config flag, then ~/.colab/repos.txt, then the bundled example. | Resolution order: `--config` flag > `~/.colab/repos.txt` > bundled example. | CONVENTIONS.md | — |

#### #539 ledger — §6 Releases, §7 CI and toolchain, §8 Conformance (slice F)

Reworded units, one bullet each. Row key changed: C6.rel.111 (the moved sentence held its old key; new key `They are branches, not tags.`). Every other row key is unchanged.

- `CONVENTIONS.md:4097` — before: "They mean "that command ran its preconditions", which is a claim only the command can truthfully make; typed at a shell, one asserts it falsely and reaches a direct trunk push having skipped the grade, the branch-CI check, the claim release and the evidence comment. Unlike `COLAB_HUMAN`, neither has any sanctioned hand-set case at all — not even solo flow's. Measured: two independent sessions set `COLAB_SHIP=1` by hand … which named the variable that opens it. A guard that teaches its bypass at the moment it refuses is not a guard, so every refusal on this path now names the remedy (`colab ship`, `colab promote`) and nothing else." → after: "Unlike `COLAB_HUMAN`, neither has any sanctioned hand-set case at all — not even solo flow's. Accordingly, every refusal on this path now names the remedy (`colab ship`, `colab promote`) and nothing else.". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.16, C6.rel.17, C6.rel.18 (keys unchanged).
- `CONVENTIONS.md:4196` — before: ""Trunk" here is both `main`, where candidates are cut, and the `trunk:` branch where that is a different one (`trunk: dev`, #437): there `main` receives CI only at promotions, so a `main`-only reading would hold little beyond the promotion's own run, while `trunk:` is where the code actually moved during the period. … `library-fast` and `deploy-tag-fast` have none, because they cut no candidate." → after: ""Trunk" here is both `main`, where candidates are cut, and the `trunk:` branch where that is a different one (`trunk: dev`, #437). … `library-fast` and `deploy-tag-fast` have none.". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.46, C6.rel.47, C6.rel.48, C6.rel.49, C6.rel.50, C6.rel.51 (keys unchanged).
- `CONVENTIONS.md:4239` — before: "The operator may choose otherwise for **one repo at a time** — *"in some cases I want the release to deploy too; only some cases, but possible when I choose"*." → after: "The operator may choose otherwise for **one repo at a time**.". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.65 (keys unchanged).
- `CONVENTIONS.md:4265` — before: "Some repos have nobody to test a candidate: an app whose only user is its operator, where a 3-day period only measures "nothing new merged for 3 days". For such a repo the operator may choose route `deploy-tag-fast`: on every green trunk head …" → after: "For a repo with nobody to test a candidate, the operator may choose route `deploy-tag-fast`: on every green trunk head …". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.73, C6.rel.74 (keys unchanged).
- `CONVENTIONS.md:4307` — before: "… and pushes it — in its own job, never gated on whether the platform is switched on, so a repo not yet cut over still has every final's image in the registry (#460)." → after: "… and pushes it — in its own job, never gated on whether the platform is switched on.". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.87 (keys unchanged).
- `CONVENTIONS.md:4313` — before: "An HTTP 200 from the platform is never the evidence — a platform can accept a deploy it then refuses to run." → after: "An HTTP 200 from the platform is never the evidence.". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.90 (keys unchanged).
- `CONVENTIONS.md:4333` — before: "… **never as a commit on trunk**: the release workflow never pushes one, and a stamp on trunk would put a version in the tree before the release it names exists." → after: "… **never as a commit on trunk**: the release workflow never pushes one.". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.96, C6.rel.97 (keys unchanged).
- `CONVENTIONS.md:4343` — before: "… it is `tag`, because nobody is there to bump a manifest before each cut: under `manifest` the first candidate after a final refuses, and so does every one after it, a stall that reads only as a warning in a green run. Where a person cuts the tag it stays `manifest`. A declared value wins either way; the cut and the final read the same one, so a candidate cut under `tag` is never refused as a final under `manifest`." → after: "… it is `tag`. Where a person cuts the tag it stays `manifest`. A declared value wins either way; the cut and the final read the same one.". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.98, C6.rel.99 (keys unchanged).
- `CONVENTIONS.md:4373` — before: "**Same run, never a tag-triggered workflow** — the reason the GitHub Release is published in the same run: a tag pushed with `GITHUB_TOKEN` triggers nothing." → after: "**Same run, never a tag-triggered workflow**.". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.106 (keys unchanged).
- `CONVENTIONS.md:4453` — before: "… flags whichever gap holds a `fix:`-typed or breaking commit — exactly the class that has bitten before, in payroll. Its suggested SemVer bump is an input, not a verdict …" → after: "… flags whichever gap holds a `fix:`-typed or breaking commit. Its suggested SemVer bump is an input, not a verdict …". Rationale → `docs/adr/539-releases-routes-rationale.md`. Rows: C6.rel.129, C6.rel.130, C6.rel.131 (keys unchanged).
- `CONVENTIONS.md:4500` — before: "It reads the `#vX.Y.Z` committish from the installing project's own record of the package, not from the manifest — a candidate `#vX.Y.Z-rc.N` and its final carry the same manifest version, and only the committish tells them apart." → after: "It reads the `#vX.Y.Z` committish from the installing project's own record of the package, not from the manifest.". Rationale → `docs/adr/539-releases-distribution-rationale.md`. Rows: C6.dist.12 (keys unchanged).
- `CONVENTIONS.md:4520` — before: "**A long-running tool never runs from npx's cache.** npm may prune that cache under a live process. A tool that runs as a service installs, updates and rolls back through the contract in …" → after: "**A long-running tool never runs from npx's cache.** A tool that runs as a service installs, updates and rolls back through the contract in …". Rationale → `docs/adr/539-releases-distribution-rationale.md`. Rows: C6.dist.17 (keys unchanged).
- `CONVENTIONS.md:4529` — before: "A missing route is **advisory** (`warn`): a publish in a reusable workflow outside the repository is invisible to the check. An undeclared repository is never checked — nothing in a repository tells a tool from a library, so the audit does not guess (#469)." → after: "A missing route is **advisory** (`warn`). An undeclared repository is never checked (#469).". Rationale → `docs/adr/539-releases-distribution-rationale.md`. Rows: C6.dist.19, C6.dist.20 (keys unchanged).
- `CONVENTIONS.md:4592` — before: "npx re-resolves a branch committish on every run (measured on npm 11: the cached install is reused, and its lockfile's commit moves with the branch), so a one-shot command at a channel costs one round trip …" → after: "npx re-resolves a branch committish on every run, so a one-shot command at a channel costs one round trip …". Rationale → `docs/adr/539-releases-distribution-rationale.md`. Rows: C6.svc.20, C6.svc.21 (keys unchanged).
- `CONVENTIONS.md:4644` — before: "… a **secret scan** and a **build** — a committed credential is the one failure that cannot be undone by reverting." → after: "… a **secret scan** and a **build**.". Rationale → `docs/adr/539-ci-toolchain-rationale.md`. Rows: C7.ci.03 (keys unchanged).
- `CONVENTIONS.md:4655` — before: "**What CI *is* comes from whether the unit has a branch — a fact about the session, not a declared value** (⚖ #233 retired the `writes`-keyed reading this heading used to carry: `writes` is a veto now, not a method, so it no longer selects which CI role applies)." → after: "**What CI *is* comes from whether the unit has a branch — a fact about the session, not a declared value**.". Rationale → `docs/adr/539-ci-toolchain-rationale.md`. Rows: C7.ci-shape.01, C7.ci-shape.02 (keys unchanged).
- `CONVENTIONS.md:4686` — before: "… free to be red, rather than discover the gap on cutover day: the one day it is most expensive to." → after: "… free to be red, rather than discover the gap on cutover day.". Rationale → `docs/adr/539-ci-toolchain-rationale.md`. Rows: C7.ci-shape.07 (keys unchanged).
- `CONVENTIONS.md:4785` — before: "The same persistence makes a hosted cache action redundant: the package cache is already on disk, and restoring GitHub's copy of it cost ~37 s per job." → after: "The same persistence makes a hosted cache action redundant: the package cache is already on disk.". Rationale → `docs/adr/539-ci-toolchain-rationale.md`. Rows: C7.runners.16 (keys unchanged).
- `CONVENTIONS.md:4854` — before: "Bytes drift is always a hard fail by default: … including a fix that touches no rule at all (a corrected hyperlink, once, flipped every under-stamped adopter red — the incident that motivated this). The fix is not a classifier that reads the diff and guesses whether it mattered; that trades a loud, honest failure for a quiet, wrong one. Instead, the person editing `templates/` states the claim themselves …" → after: "Bytes drift is always a hard fail by default: … including a fix that touches no rule at all. Instead of a classifier, the person editing `templates/` states the claim themselves …". Rationale → `docs/adr/539-conformance-rationale.md`. Rows: C8.stamps.07, C8.stamps.08, C8.stamps.09 (keys unchanged).
- `CONVENTIONS.md:4893` — before: "**The frozen CLI copy is measured against the latest tag, not `HEAD`** — measured against `HEAD` it reported "behind" for every unreleased CLI commit and advised adopting untagged code." → after: "**The frozen CLI copy is measured against the latest tag, not `HEAD`**.". Rationale → `docs/adr/539-conformance-rationale.md`. Rows: C8.stamps.17 (keys unchanged).

### §9 Any repo, first-time adoption

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C9.first-time.01 | default | | Answer the shared question set, asking each question as a human answers it rather than as a schema field name. | Each question is asked as a human answers it, not as a schema field name | CONVENTIONS.md | — |
| C9.first-time.02 | default | | Ask question 1 (deploy target and how it is reached) at adoption, asking for the URL only when deploy is not none. | the URL only when `deploy` is not `none` | CONVENTIONS.md | — |
| C9.first-time.03 | default | | Phrase question 3 as what would break if you merged something wrong here, and ask it at adoption. | what would break if you merged something wrong here? | CONVENTIONS.md | #128 |
| C9.first-time.04 | default | | Ask only what changes a gate: leave questions 2, 4 and 5 unanswered on a fresh adoption and print one line naming the `colab adopt --axis` that answers each later. | fresh adoption leaves them unanswered and prints one line naming them and the | CONVENTIONS.md | #533 |
| C9.first-time.05 | hard | tools/lib/adopt.js::function gateVerdict | Answering question 3 with none or self is a human's act. | Answering question 3 with `none` or `self` is a human's act | CONVENTIONS.md | #522 |
| C9.first-time.06 | default | | When adopt cannot finish without a human, the first line it prints is the one command the human runs, with the answers already filled in. | the first line it prints is the one command the human runs | CONVENTIONS.md | #522 |
| C9.first-time.07 | hard | tools/lib/adopt.js::function exposureShapeVerdict | At a terminal, check the exposure answer against the repo's shape when it is given and re-ask with the reason. | At a terminal, the exposure answer is checked | CONVENTIONS.md | #522 |
| C9.first-time.08 | default | | Question 1 writes production and deploy, never tier directly, because tier is a pure function of the two. | Question 1 writes `production` and `deploy`, never `tier` directly | CONVENTIONS.md | — |
| C9.first-time.09 | default | | Phrase question 3 as what breaks, never as who consumes this. | Question 3 is phrased this way | CONVENTIONS.md | #128 |
| C9.first-time.10 | default | | Never ask a human for trunk, stack, toolchain pins or ports; detect them. | Do not ask a human something the repo already states. | CONVENTIONS.md | — |
| C9.first-time.11 | default | | Never ask for a derived value (gate count, CI role and thoroughness, ceremony weight, branch-mandatory, rollback obligation). | Every one of these follows from the answers above | CONVENTIONS.md | — |
| C9.first-time.12 | default | | A repo with nothing recorded asks the two gating questions now and leaves the optional three for later. | A repo with nothing recorded yet asks the two gating | CONVENTIONS.md | — |
| C9.first-time.13 | default | | A sync asks the same five questions in the same wording; it does not grow its own paraphrase of the rows. | do not let a sync grow its own paraphrase of these five | CONVENTIONS.md | — |
| C9.first-time.14 | default | | A sync or interrupted adoption records a human's answer and never fills a missing key on its own. | it never fills a missing key on its own, | CONVENTIONS.md | — |
| C9.first-time.15 | default | | Never resolve the production-pairing advisory by deleting an already-declared key; declaring must never be riskier than omitting. | Declaring must never be riskier than omitting. | CONVENTIONS.md | — |
| C9.first-time.16 | hard | tools/lib/adopt.js::function gateVerdict | Only a human answer may write down that nothing, or only the room, consumes a merge here. | only a human answer may write down that nothing, or only | CONVENTIONS.md | — |
| C9.first-time.17 | default | | An agent walking the checklist may propose live or released on committed evidence, never none or self; omission reports as null. | may propose `live` or `released` when it finds committed evidence for one | CONVENTIONS.md | — |
| C9.first-time.18 | hard | tools/lib/adopt.js::function gateVerdict | Lowering an existing exposure, or a first declaration of none or self, requires a human: an interactive terminal or COLAB_HUMAN=1 with --answered-by. | an interactive terminal, or `COLAB_HUMAN=1` together | CONVENTIONS.md | — |
| C9.first-time.19 | default | | `colab adopt` never runs steps 3 onward; it prints them as a to-do list on exit. | never runs steps 3 onward below; it prints | CONVENTIONS.md | — |
| C9.first-time.20 | default | | The five questions are asked as forced numbered menus, each answerable by number or literal value. | The five questions above are asked as forced numbered | CONVENTIONS.md | #283 |
| C9.first-time.21 | default | | Exposure is the only one of the five questions that carries a skip option. | `exposure` is the only one of the five that carries a skip option | CONVENTIONS.md | #283 |
| C9.first-time.22 | default | | On a freshly adopted repo the maintainer's adoption command lands its own output on trunk in the same human act. | The maintainer's adoption command is the human step, so it can land its own output | CONVENTIONS.md | #481 |
| C9.first-time.23 | hard | tools/lib/adopt.js::--land commits to trunk, which is a human act | `--land` requires COLAB_HUMAN=1 and --answered-by, with no terminal substitute, since it writes trunk. | It requires `COLAB_HUMAN=1` and `--answered-by`, with no terminal substitute, since it writes trunk | CONVENTIONS.md | #481 |
| C9.first-time.24 | hard | tools/lib/adopt.js::function autonomyGateVerdict | `--autonomy auto-trunk` records the grant with the same provenance comment as every answer, behind the same bar as writes: direct. | records the grant with the same provenance comment as every | CONVENTIONS.md | #481 |
| C9.first-time.25 | hard | tools/lib/adopt.js::function autonomyGateVerdict | `ceremony: light` refuses the auto-trunk grant; manual is never gated. | `manual` is never gated, and `ceremony: light` refuses it | CONVENTIONS.md | #481 |
| C9.first-time.26 | hard | tools/lib/adopt.js::function landVerdict ; tools/colab::--land refuses: origin/ | `--land` refuses off trunk, with --local, and when origin's trunk is ahead. | it refuses off trunk, with `--local`, and when origin's trunk is ahead | CONVENTIONS.md | #481 |
| C9.first-time.27 | default | | Everything else in the adoption (CI workflow, guards, docs) ships through the normal lane under the grant; the CI-adding branch passes trunk CI green on its own run. | then ships through the normal lane under the grant. | CONVENTIONS.md | #482 |
| C9.first-time.28 | default | | `ci-granted` stays the door only for a trunk that already has workflows and no run at its sha. | `ci-granted` stays the door only for a trunk that already has workflows | CONVENTIONS.md | #482 |
| C9.first-time.29 | default | | Write `.github/project.yml` with the answers from step 1. | with the answers from step 1 | CONVENTIONS.md | — |
| C9.first-time.30 | default | | Declare `migrations:` when the repo keeps migrations anywhere but the two default paths; adopt lists it as the first remaining step. | declare `migrations:` when the repo keeps migrations anywhere but | CONVENTIONS.md | #449 |
| C9.first-time.31 | default | | Create the whole label set, all twenty-three names, with `colab labels --ensure`. | Create the whole label set — twenty-three names, not a subset | CONVENTIONS.md | #206 |
| C9.first-time.32 | default | | Rewrite an existing convention label's description only when asked with --refresh-descriptions. | description differs from the handbook's, and rewrites it only when asked | CONVENTIONS.md | #364 |
| C9.first-time.33 | default | | When adding a label, bump the pinned test and grep the other three prose counts. | bump that test, then grep for the other three prose counts before you're done | CONVENTIONS.md | #274 |
| C9.first-time.34 | default | | Provision the full label set again on every sync, not only at adoption. | This full set is provisioned again on every sync, not only at adoption. | CONVENTIONS.md | — |
| C9.first-time.35 | default | | Add the tier topic with gh repo edit --add-topic. | Add the tier topic — `gh repo edit <owner>/<repo> --add-topic tier-b` | CONVENTIONS.md | — |
| C9.first-time.36 | default | | Add the handbook pointer block to CLAUDE.md, creating the file if none exists; do not skip it. | create the file if none exists | CONVENTIONS.md | — |
| C9.first-time.37 | default | | Repo prose goes in AGENTS.md, the repo's instruction file. | what the repo is, how to run and test it, | CONVENTIONS.md | #417 |
| C9.first-time.38 | default | | CLAUDE.md is a thin shell: @AGENTS.md on its first line plus the name-looked-up blocks (Conventions block with stamp, Local divergences list). | `@AGENTS.md` on its first line, plus the blocks tools | CONVENTIONS.md | #417 |
| C9.first-time.39 | default | | No block lives in both files; configure a generator that supports targets to write AGENTS.md only. | No block lives in both files. | CONVENTIONS.md | #417 |
| C9.first-time.40 | default | | A repo with only a CLAUDE.md is still conforming. | A repo with only a `CLAUDE.md` is still conforming | CONVENTIONS.md | #417 |
| C9.first-time.41 | default | | A fork of an upstream you don't own does not take the thin-shell shape and uses the append-only block instead. | A fork of an upstream you don't own does not take this shape | CONVENTIONS.md | #449 |
| C9.first-time.42 | default | | The audit holds the shape with warnings, never failures: tool block in both files, Conventions block outside CLAUDE.md, prose-in-claude-md, no-agents-md. | warns when a tool block appears in both files, when the Conventions | CONVENTIONS.md | #419 |
| C9.first-time.43 | default | | Make sure CI meets §7's outcome by copying a template via `colab template`, which stamps for reconciliation. | copy a template via `colab template <name>`, which stamps for reconciliation | CONVENTIONS.md | — |
| C9.first-time.44 | default | | On exposure: released, step 6 also wires the release rung at adoption: release block, release workflow, deploy template, first final. | On `exposure: released`, this step also wires the release rung | CONVENTIONS.md | #492 |
| C9.first-time.45 | default | | The first final is the operator's to set, because `colab release cut` refuses with none to bump from. | which is the operator's to set because `colab release cut` refuses | CONVENTIONS.md | #492 |
| C9.first-time.46 | default | | The no-production row's release route is a proposal for the human to confirm, never a choice the agent makes. | the no-production row's route is a proposal for the human to confirm | CONVENTIONS.md | #492 |
| C9.first-time.47 | default | | Register the repo with `colab register`, updating both the audit fleet list and the reserved-ports aggregation. | `colab register`, updating both the audit fleet list and the | CONVENTIONS.md | — |
| C9.first-time.48 | default | | Leave existing branches alone, grandfathered. | Leave existing branches alone — grandfathered. | CONVENTIONS.md | — |
| C9.first-time.49 | default | | Do not create dev unless the repo is genuinely Tier A or Tier C. | Do not create `dev` unless the repo is genuinely Tier A or Tier C | CONVENTIONS.md | — |

### §9 Going live: Tier B → Tier C or Tier A

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C9.going-live.01 | default | | Go live on the day a deploy target exists, not before. | Do this on the day a deploy target exists | CONVENTIONS.md | — |
| C9.going-live.02 | default | | Commit the path to production (deploy workflow, tag workflow or runbook) before proceeding. | One of these must be committed before proceeding. | CONVENTIONS.md | — |
| C9.going-live.03 | default | | Create dev from main and push it. | `git checkout -b dev main && git push -u origin dev` | CONVENTIONS.md | — |
| C9.going-live.04 | default | | Set the repo's default branch to dev. | Set the repo's default branch to `dev`. | CONVENTIONS.md | — |
| C9.going-live.05 | default | | Add dev to every CI workflow's trigger branches. | Add `dev` to every CI workflow's trigger branches | CONVENTIONS.md | — |
| C9.going-live.06 | default | | Update project.yml: C is tier C, trunk dev, real production, deploy push-main; A is tier A, trunk dev, real production, deploy tag or manual plus runbook, never push-main. | `deploy: tag` or `deploy: manual` + `runbook:` — never `push-main` | CONVENTIONS.md | — |
| C9.going-live.07 | default | | The tag-gated single-trunk variant keeps trunk: main and skips creating dev. | keep `trunk: main` and skip steps 2–3 entirely | CONVENTIONS.md | — |
| C9.going-live.08 | default | | Swap the topic to tier-c or tier-a and update the internal project table. | Swap the topic to `tier-c`/`tier-a`; update the internal project table. | CONVENTIONS.md | — |
| C9.going-live.09 | default | | Tier A only: tag the first release; Tier C has nothing to tag. | tag the first release (on `manual`, tags are still worth cutting) | CONVENTIONS.md | — |
| C9.going-live.10 | default | | Re-answer questions 3 and 5 of the shared question set at going live. | Re-answer questions 3 and 5 of the shared question set above | CONVENTIONS.md | — |
| C9.going-live.11 | default | | Leave room and writes alone unless who works here or how many units are in flight genuinely changed. | Leave `room` and `writes` alone unless who works | CONVENTIONS.md | — |

### §9 Tier C → Tier A — when the site earns a release ritual

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C9.c-to-a.01 | default | | Migrate C to A only when you find yourself wanting to name what shipped, not before. | Do this when you find yourself wanting to name what shipped | CONVENTIONS.md | — |
| C9.c-to-a.02 | default | | Retrigger the deploy workflow on a tag instead of a main push; until it lands the tier claim is false. | Retrigger the deploy workflow on a tag instead of a `main` push | CONVENTIONS.md | — |
| C9.c-to-a.03 | default | | Update project.yml to tier A, deploy tag, trunk stays dev; swap the topic to tier-a. | Update `project.yml`: `tier: A`, `deploy: tag`. `trunk` stays `dev` | CONVENTIONS.md | — |
| C9.c-to-a.04 | default | | Tag the current main so the first tagged release names what is already live. | Tag the current `main`, so the first tagged release names what is already live | CONVENTIONS.md | — |
| C9.c-to-a.05 | default | | Re-answer question 5 (channels): a tag ritual is itself a new channel. | Re-answer question 5 (`channels`) — a tag ritual is itself a new channel | CONVENTIONS.md | — |
| C9.c-to-a.06 | default | | Check questions 2–4 at this transition only if who works here or how work lands changed. | rarely move at this transition; check them only if something about who works here | CONVENTIONS.md | — |
| C9.c-to-a.07 | default | | A to C (tier A with deploy push-main) is descriptor-only: set tier C, leave the pipeline, swap the topic. | is descriptor-only: set `tier: C`, leave the pipeline exactly as it is, | CONVENTIONS.md | — |

### §9 Working in a repo you don't own

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C9.not-your-repo.01 | default | | Keep `.github/project.yml` in the local clone's main checkout only, hidden by `.git/info/exclude`. | the local clone's main checkout only, hidden by `.git/info/exclude` | CONVENTIONS.md | #393 |
| C9.not-your-repo.02 | default | | Provision only the four load-bearing labels; other convention labels are opt-in via `colab labels --ensure --minimal`. | the load-bearing subset a session itself writes | CONVENTIONS.md | #393 |
| C9.not-your-repo.03 | default | | Carry the rules the owner's repo cannot in an excluded `CLAUDE.local.md` operating note. | carries the rules the owner's repo cannot | CONVENTIONS.md | #393 |
| C9.not-your-repo.04 | default | | Exclude the worktree subdir (`.worktrees/`) locally, since the owner's repo does not ignore it. | an adopted repo hides it in its committed `.gitignore`; the owner's repo does not | CONVENTIONS.md | #393 |
| C9.not-your-repo.05 | default | | Do not add CI templates, CODEOWNERS, the CLAUDE.md block or the topic to the owner's repo. | nothing in claim, start or ship gates on them, and each would be a | CONVENTIONS.md | #393 |
| C9.not-your-repo.06 | default | | `trunk:` names the fleet's own integration branch, never the owner's default branch. | `trunk:` names the fleet's own integration branch | CONVENTIONS.md | #393 |
| C9.not-your-repo.07 | default | | The owner's trunk is reached only by a pull request he reviews and merges himself, via `colab deliver`. | the owner's trunk is reached only by a pull request he reviews and | CONVENTIONS.md | #393 |
| C9.not-your-repo.08 | default | | Declare exposure: self, because a merge onto the integration branch reaches only the fleet. | Declare `exposure: self`: a merge onto the integration branch reaches | CONVENTIONS.md | #393 |
| C9.not-your-repo.09 | hard | tools/lib/adopt.js::function gateVerdict | Exposure self is human-gated as always. | reaches only the fleet, and the owner's review is the next gate | CONVENTIONS.md | #393 |
| C9.not-your-repo.10 | hard | tools/lib/adopt.js::function gateVerdict | A human answers the exposure row of the one-command local adoption, at a terminal or with COLAB_HUMAN=1 --answered-by. | a human answers the exposure row, at a terminal or with | CONVENTIONS.md | #393 |
| C9.not-your-repo.11 | default | | Push the integration branch once from the owner's trunk if it does not exist yet. | origin <owner-trunk>:refs/heads/<prefix>/integration # once, if it doesn't exist yet | CONVENTIONS.md | #393 |
| C9.not-your-repo.12 | hard | tools/colab::is TRACKED here ; tools/colab::--local needs --trunk ; tools/colab::is the owner's own default branch | `colab adopt --local` refuses when the descriptor is tracked, when --trunk is missing, and when --trunk names the owner's own trunk. | It refuses when the descriptor is tracked (the repo is adopted, so use plain | CONVENTIONS.md | #393 |
| C9.not-your-repo.13 | default | | `colab adopt --local` appends the exclude lines before writing anything and writes the descriptor into the main checkout. | exclude lines before writing anything, writes the descriptor into the main checkout | CONVENTIONS.md | #393 |
| C9.not-your-repo.14 | default | | A bare re-run of `colab adopt --local` is the idempotent re-apply. | A bare re-run is the idempotent re-apply | CONVENTIONS.md | #393 |
| C9.not-your-repo.15 | default | | Declare the owner's branch in the same local descriptor under an owner block. | The owner's branch is declared in the same local descriptor | CONVENTIONS.md | #394 |
| C9.not-your-repo.16 | default | | Each session still ships onto the integration branch and closes its issues there; delivery is a separate batch-shaped step. | each session still ships onto the integration branch, | CONVENTIONS.md | #394 |
| C9.not-your-repo.17 | hard | tools/lib/owner-branch.js::no colab command moves it | `colab deliver` never merges; no colab command moves the owner's branch, and ship, the ship batch and promote refuse a push to it. | moves his branch: `ship`, the ship batch and `promote` refuse a push to it | CONVENTIONS.md | #394 |
| C9.not-your-repo.18 | default | | Delivered is read from PR state: the last merged delivery PR's head is the boundary; the next run offers only what landed after it. | merged delivery PR's head is the boundary; the next run offers only what landed | CONVENTIONS.md | #394 |
| C9.not-your-repo.19 | default | | An open delivery PR is refreshed, never duplicated. | An open PR is refreshed (its head follows the integration branch on its | CONVENTIONS.md | #394 |
| C9.not-your-repo.20 | hard | tools/lib/owner-branch.js::re-run with --reopen to offer the batch again | A closed-without-merge delivery PR stops deliver (exit 3) until a human re-offers the batch with --reopen. | opens nothing until a human re-offers the batch with `--reopen` | CONVENTIONS.md | #394 |
| C9.not-your-repo.21 | default | | The delivery PR carries no closing keywords; the body lists the issues as carried. | The PR carries no closing keywords | CONVENTIONS.md | #394 |
| C9.not-your-repo.22 | hard | tools/colab::the delivery PR — re-run with COLAB_HUMAN=1 (--dry needs none) | Opening or editing the delivery PR needs a human (COLAB_HUMAN=1); --dry needs none. | Opening or editing the PR needs a human | CONVENTIONS.md | #394 |
| C9.not-your-repo.23 | default | | A scheduled driver may run --dry and read the state; it never acts on the owner's branch. | A scheduled driver may run `--dry` and read the state | CONVENTIONS.md | #394 |
| C9.not-your-repo.24 | hard | tools/colab::PR-PENDING | The core-path rule still applies: a branch touching a CODEOWNERS path needs a non-author approval before it lands on the integration branch. | The core-path rule still applies on top | CONVENTIONS.md | #350 |
| C9.not-your-repo.25 | default | | A PR per issue that the owner merges one by one is a different shape, deferred until a repo asks for it. | A PR per issue that the owner merges one by one is a different shape, | CONVENTIONS.md | #394 |
| C9.not-your-repo.26 | default | | Hide the descriptor with `.git/info/exclude`, never a `.gitignore` entry, which is itself a tracked file. | Hiding the descriptor that way is exactly the commit you are avoiding | CONVENTIONS.md | #393 |
| C9.not-your-repo.27 | default | | Scheduled autopilot must stay off on such a repo. | Scheduled autopilot must stay OFF on such a repo | CONVENTIONS.md | #393 |
| C9.not-your-repo.28 | default | | Before the first ship, find out whether any workflow runs on push to the integration branch; if none, each ship needs a ci-granted exemption per branch. | Find out which case you are in before the first ship | CONVENTIONS.md | #393 |
| C9.not-your-repo.29 | default | | The main checkout must rest on the integration branch, not on the owner's trunk. | The main checkout must rest on the integration branch | CONVENTIONS.md | #393 |
| C9.not-your-repo.30 | default | | A dashboard's cached repo scan does not pick the repo up until refreshed. | A dashboard's cached repo scan does not pick the repo up | CONVENTIONS.md | #393 |
| C9.not-your-repo.31 | default | | A local audit reports a locally adopted repo as such and flags a descriptor that is untracked but not excluded. | A local audit reports `⌂ adopted locally, not committed` | CONVENTIONS.md | #393 |
| C9.not-your-repo.32 | default | | Prefer full adoption whenever the owner is willing to carry the files; local adoption is a working arrangement for one operator's clones. | Prefer full adoption instead whenever the owner is willing to carry the files | CONVENTIONS.md | #393 |

### §9 A fork of an upstream — a repo you own that tracks one you don't (#449)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C9.fork.01 | default | | A fork you own adopts in full: descriptor, labels, CI and registration, all committed. | The fork is yours, so it adopts in full | CONVENTIONS.md | #449 |
| C9.fork.02 | default | | `colab adopt` detects a fork by a remote named upstream whose URL differs from origin's; --fork and --no-fork override. | `colab adopt` detects it, never asks. | CONVENTIONS.md | #449 |
| C9.fork.03 | default | | Write nothing about the fork shape to the descriptor; the remote is the fact. | Nothing is written to the descriptor: the remote is the fact | CONVENTIONS.md | #449 |
| C9.fork.04 | default | | Step 5 is append-only: paste the pointer block at the end of the upstream's CLAUDE.md and leave the upstream's prose where it is. | at the end of the upstream's `CLAUDE.md`. Leave the upstream's prose where it is, | CONVENTIONS.md | #449 |
| C9.fork.05 | default | | Leave AGENTS.md alone and record the append in the fork's patch list. | and record the append in whatever list the fork keeps of its patches | CONVENTIONS.md | #449 |
| C9.fork.06 | default | | Without an upstream CLAUDE.md, adopt writes one; without an upstream AGENTS.md it writes the block alone and no AGENTS.md stub. | Without one it is the block alone, and adopt writes no `AGENTS.md` stub | CONVENTIONS.md | #449 |
| C9.fork.07 | default | | Use CLAUDE.local.md instead only when the fork must stay byte-identical to the upstream. | only when the fork must stay byte-identical to the upstream | CONVENTIONS.md | #449 |
| C9.fork.08 | default | | Leave the upstream's files alone and decline the AGENTS.md graft; the prose-in-claude-md and no-agents-md warnings are expected. | Leave the upstream's files alone and decline the graft | CONVENTIONS.md | #449 |
| C9.fork.09 | default | | The upstream's agent workflow stays where it is, and the appended block says which flow governs. | The upstream's agent workflow stays where it is, and the appended block says which flow | CONVENTIONS.md | #449 |
| C9.fork.10 | default | | Do not delete or edit the upstream's skills and commands; add one line inside the appended block instead. | Add one line inside the appended block instead | CONVENTIONS.md | #449 |
| C9.fork.11 | default | | Declare `migrations:` before the first ship; an upstream's layout is usually not a default. | Declare `migrations:` (step 2) before the first ship. | CONVENTIONS.md | #449 |
| C9.fork.12 | default | | The upstream's CODEOWNERS is inert here; leave the file alone unless some paths need a review. | Leave the file alone unless some paths here need a review | CONVENTIONS.md | #449 |
| C9.fork.13 | default | | Everything else in §9 applies to a fork unchanged: the five questions, labels, topic, CI and registration. | Everything else in §9 applies unchanged: the five questions, labels, | CONVENTIONS.md | #449 |
| C9.fork.14 | default | | Upstream merges come into the fork, and nothing is pushed to the upstream's branches. | nothing is pushed to the upstream's branches | CONVENTIONS.md | #449 |

### §9 Fixtures and examples use invented values

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| C9.fixtures.01 | default | | Test fixtures, sample data and documentation examples must use invented values. | Test fixtures, sample data and documentation examples MUST use invented values | CONVENTIONS.md | — |
| C9.fixtures.02 | default | | Never a real hostname, account handle, filesystem path, internal domain, customer or partner name, even when the real value is what was measured. | Never a real hostname, account handle, filesystem path, internal domain, customer or | CONVENTIONS.md | — |
| C9.fixtures.03 | default | | Write an invented name such as build-box-01, not the machine you ran it on. | Write `build-box-01`, not the machine you ran it on | CONVENTIONS.md | — |
| C9.fixtures.04 | default | | Where the real value genuinely matters, put it in an Issue on a private tracker, not a tracked file. | it belongs in an Issue on a private tracker, not in a tracked file | CONVENTIONS.md | — |
| C9.fixtures.05 | default | | The identity scanner is shipped; the vocabulary never is, and is supplied by path outside every repo. | so it is supplied by path and kept outside every repo | CONVENTIONS.md | — |
| C9.fixtures.06 | default | | Repository metadata never passes through git; sweep it periodically with the identity audit. | that needs a periodic sweep instead | CONVENTIONS.md | — |
| C9.fixtures.07 | default | | A machine with no vocabulary configured scans nothing and says so on every commit. | A machine with no vocabulary configured scans nothing | CONVENTIONS.md | — |
| C9.fixtures.08 | default | | Neither limitation is a reason to relax the rule; the mechanisms are backstops. | Neither is a reason to relax the rule above | CONVENTIONS.md | — |
### Preamble

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.preamble.01 | default |  | Keep project.yml flat: no nested maps, no anchors. | Keep it flat. No nested maps, no anchors | project.schema.md | — |
| S1.preamble.02 | default |  | Anything outside the minimal YAML subset is reported as a parse finding, not half-read. | Anything else is reported as a parse finding rather than half-read. | project.schema.md | — |

### `tier`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.tier.01 | default |  | `tier` is optional and legacy; allowed values are A, B or C. | `A`, `B` or `C`. The tiers differ in | project.schema.md | — |
| S1.tier.02 | default |  | Tier B: no production, 0 gates, one branch `main`. | one branch, `main`. Nothing to deploy. | project.schema.md | — |
| S1.tier.03 | default |  | Tier C: production, 1 gate; the promotion is the deploy. | promotion `dev` → `main` is the deploy. | project.schema.md | — |
| S1.tier.04 | default |  | Tier A: production, 2 gates; promotion verifies and a tag deploys. | promotion verifies; a tag deploys. | project.schema.md | — |
| S1.tier.05 | default |  | B means no production target and is the default; an imminent launch is still B. | no production target. The default; an imminent launch is still | project.schema.md | — |
| S1.tier.06 | default |  | C means live where the promotion itself ships; C is A minus the tag. | live, but the promotion itself ships it. `C` is `A` minus the tag. | project.schema.md | — |
| S1.tier.07 | default |  | A means live with a deliberate release artifact (the tag) gating production. | live, and a deliberate release artifact (the tag) gates production. | project.schema.md | — |
| S1.tier.08 | default |  | Pick the tier that describes the pipeline truthfully; never claim a gate the pipeline lacks. | Pick the one that describes your pipeline truthfully; a repo claiming a | project.schema.md | — |
| S1.tier.09 | default |  | Tier and `deploy` must agree. | job, and the two must agree. | project.schema.md | — |
| S1.tier.10 | default |  | `colab adopt` writes `tier` only when `exposure` ends the run unanswered and no `tier` key exists. | writes `tier` only when `exposure` ends the run still unanswered | project.schema.md | #199 |
| S1.tier.11 | default |  | The adopt-written tier is derived purely from (production, deploy), never from `exposure`. | The written value is derived purely from | project.schema.md | #199 |
| S1.tier.12 | default |  | When `exposure` is answered, adopt never writes `tier`. | never writes `tier` at all: nothing in `tools/colab` reads it | project.schema.md | #199 |
| S1.tier.13 | default |  | An already-declared `tier` is never touched by adopt. | An already-declared `tier` is never touched. | project.schema.md | #199 |
| S1.tier.14 | default |  | `exposure` is the axis of record when declared; `tier` is a legacy read, not a second source of truth. | `tier` is a legacy read, not a second source of truth. | project.schema.md | #144 |
| S1.tier.15 | default |  | When `exposure` is declared it governs gate count outright. | it governs gate count outright. `tier`, declared or not, is | project.schema.md | #144 |
| S1.tier.16 | default |  | Without `exposure`, derive gate count from `tier`: A to released, C to live, B to null; never guess for B. | gate count is DERIVED from it: `A → released`, `C → live`, | project.schema.md | #144 |
| S1.tier.17 | default |  | A descriptor declaring neither `exposure` nor `tier` is a finding: no axis of record. | Neither declared → a finding: no axis of record. | project.schema.md | #144 |
| S1.tier.18 | default |  | `exposure` is not required by the legacy-read unit; do not make it mandatory here. | `exposure` does NOT become required by this unit. | project.schema.md | #144 |
| S1.tier.19 | default |  | Declaring both keys and agreeing is silent and fine. | Both keys declared and agreeing is silent — carrying both is fine | project.schema.md | — |
| S1.tier.20 | default |  | Both keys declared and disagreeing about gate count is exactly one finding. | Both declared and DISAGREEING about gate count is exactly one finding | project.schema.md | — |
| S1.tier.21 | default |  | `tier: A` is consistent only with `exposure: released`, `tier: C` only with `live`, `tier: B` with every value. | `tier: A` is consistent only with `exposure: released`; `tier: C` only with `exposure: live` | project.schema.md | — |
| S1.tier.22 | default |  | When `exposure` is declared the tier-voiced coherence checks do not run; `exposure`'s gate-contract table governs. | tier-voiced coherence checks below do not run at all | project.schema.md | — |
| S1.tier.23 | default |  | Read trunk/production/deploy as the legacy shape and `exposure`'s table as the current one when declared. | Read `trunk`/`production`/`deploy` below as the legacy shape, and | project.schema.md | — |

### `trunk`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.trunk.01 | default |  | On tier B (exposure none, or released with production null) trunk is the repo's default branch. | it is the repo's default branch | project.schema.md | #522 |
| S1.trunk.02 | default |  | The default branch may be `main`, `master` or any spelling that conforms. | `main` by convention, but an existing repo's `master`, or any other spelling, is | project.schema.md | #522 |
| S1.trunk.03 | default |  | On a single-trunk shape the trunk must be the only long-lived branch. | What is enforced there is that it is the only long-lived branch | project.schema.md | #522 |
| S1.trunk.04 | default |  | A `main` beside a non-`main` trunk on a single-trunk repo is a finding. | a `main` beside a non-`main` trunk is the two-branch shape and is a finding | project.schema.md | #522 |
| S1.trunk.05 | default |  | On tier A trunk is `dev`, or `main` when `deploy: tag`. | On `tier: A` it is `dev` or, when `deploy: tag`, `main` | project.schema.md | — |
| S1.trunk.06 | default |  | Any other trunk value on tier A outside the tag-gated exception is a finding. | Any other value on (outside the tag-gated exception) A | project.schema.md | — |
| S1.trunk.07 | default |  | On tier C trunk must be a branch distinct from `main`, the release branch the promotion deploys to. | `trunk` must be a branch distinct from `main`, the release branch the promotion deploys to. | project.schema.md | #205 |
| S1.trunk.08 | default |  | `dev` is the default tier C trunk proposed by adopt and the templates. | `dev` is the default — the value `colab adopt` and the templates propose | project.schema.md | #205 |
| S1.trunk.09 | default |  | A tier C repo declaring a different trunk name is conforming, with no advisory or legacy framing. | is conforming, not exempted: no advisory, no "legacy" framing. | project.schema.md | #205 |
| S1.trunk.10 | default |  | Non-tag-gated tier A keeps a fixed trunk value. | (non-tag-gated) Tier A keeps a fixed | project.schema.md | #205 |
| S1.trunk.11 | default |  | Tier B's single trunk may never sit beside a `main`. | Tier B's single trunk may never sit beside a `main` | project.schema.md | #205 |
| S1.trunk.12 | default |  | Hand-deployed tier A (`deploy: manual`) keeps the dev/main split. | holds for hand-deployed Tier A repos too (`deploy: manual`) | project.schema.md | — |
| S1.trunk.13 | default |  | Tier C keeps the identical two-branch split whatever its trunk is named. | Tier C keeps the identical split | project.schema.md | — |
| S1.trunk.14 | default |  | A tag-gated tier A may run a single trunk `main`. | The exception: a tag-gated Tier A may run a single trunk `main`. | project.schema.md | — |
| S1.trunk.15 | default |  | The single-trunk exception applies only to `deploy: tag`. | This applies only to `deploy: tag`: `manual` and | project.schema.md | — |
| S1.trunk.16 | default |  | `manual` and `push-main` keep the dev/main split; `main` as trunk on either is a finding. | keep the `dev`/`main` split, and `main` on either of those is still a finding. | project.schema.md | — |

### `production`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.production.01 | default |  | `production` is required: the production URL string, or `null`. | The production URL as a string, or `null`. | project.schema.md | — |
| S1.production.02 | default |  | `production` must be non-null on tier A or C and null on tier B. | Must be non-null when `tier: A` or `tier: C`, `null` when `tier: B`. | project.schema.md | — |

### `deploy`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.deploy.01 | default |  | `deploy` is required and states how the repo reaches production, never whether it is Tier A. | the repo reaches production — never whether it is Tier A. | project.schema.md | — |
| S1.deploy.02 | default |  | `deploy` only describes the mechanism a Tier A repo uses. | `deploy` only describes the mechanism a Tier A repo uses. | project.schema.md | — |
| S1.deploy.03 | default |  | `deploy: tag` needs a committed path to production: an in-repo deploy workflow on the tag, or a `runbook:` for an external deployer. | The tag's path to production must be committed: either an in-repo deploy workflow | project.schema.md | — |
| S1.deploy.04 | default |  | `deploy: manual` means a human runs a documented procedure with no workflow or tag trigger. | shipping is a human running a documented procedure | project.schema.md | — |
| S1.deploy.05 | default |  | `deploy: manual` requires `runbook:`. | a console action) with no workflow and no tag trigger. | project.schema.md | — |
| S1.deploy.06 | default |  | `deploy: none` is the required value for tier B. | nothing deploys. Required value for `tier: B`. | project.schema.md | — |
| S1.deploy.07 | default |  | `deploy: none` names the absence of a promotion trigger, not of anything running the code; that question is `channels`. | Names the absence of a promotion trigger, never the absence of anything that runs | project.schema.md | — |
| S1.deploy.08 | default |  | `deploy: push-main` is the required value for tier C. | a push to `main` is the deploy. The required value for | project.schema.md | — |
| S1.deploy.09 | default |  | `deploy: push-main` on tier A is a finding. | and a finding on `tier: A` — see below. | project.schema.md | — |
| S1.deploy.10 | default |  | The push-main finding is on the combination tier A + push-main, never on the value itself. | the finding is on the combination `tier: A` + `push-main`, | project.schema.md | — |
| S1.deploy.11 | default |  | Resolve tier A + push-main by retiering to C, usually the right answer. | Retier to `C` — usually the right answer. | project.schema.md | — |
| S1.deploy.12 | default |  | Or resolve it by migrating the pipeline to a tag trigger (`deploy: tag`) and staying tier A. | Migrate the pipeline to a tag trigger → `deploy: tag`, staying tier A. | project.schema.md | — |
| S1.deploy.13 | default |  | Or, if shipping really is by hand, declare `deploy: manual` plus `runbook:`. | If shipping really is run by hand, say so → `deploy: manual` plus | project.schema.md | — |
| S1.deploy.14 | hard | tools/colab::a human must promote ; tools/colab::This requires a human: re-run with COLAB_HUMAN=1 | `manual` grants no automation: `colab promote` allows unattended promotion only on a `deploy: tag` repo. | `colab promote` allows an unattended promotion only on a `deploy: tag` repo | project.schema.md | — |
| S1.deploy.15 | hard | tools/colab::This requires a human: re-run with COLAB_HUMAN=1 | On a `manual` repo promotion needs `COLAB_HUMAN=1`, exactly like `push-main`. | so it needs `COLAB_HUMAN=1` — exactly like `push-main`, and | project.schema.md | — |
| S1.deploy.16 | hard | tools/colab::This requires a human: re-run with COLAB_HUMAN=1 | `promotion: main-loop` cannot lower the `manual` human bar. | `promotion: main-loop` cannot lower it. | project.schema.md | — |

### `runbook`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.runbook.01 | default |  | `runbook` is a repo-relative path to the committed document describing how production is reached. | Repo-relative path to the committed document describing how production is | project.schema.md | — |
| S1.runbook.02 | default |  | The audit checks that the `runbook` path exists. | The audit checks that the path actually exists. | project.schema.md | — |
| S1.runbook.03 | default |  | `runbook` is required where the deploy runs outside CI so no workflow documents it. | Required in the two cases where the deploy runs outside CI, so no workflow | project.schema.md | — |
| S1.runbook.04 | default |  | `deploy: manual` always requires `runbook`. | runs the procedure. Always required. | project.schema.md | — |
| S1.runbook.05 | default |  | `deploy: tag` with no in-repo deploy workflow (external deployer) requires `runbook`. | `deploy: tag` with no in-repo deploy workflow — an external deployer | project.schema.md | — |
| S1.runbook.06 | default |  | A `deploy: tag` repo whose own CI holds the deploy job needs no runbook. | whose own CI holds the deploy job documents itself in that | project.schema.md | — |
| S1.runbook.07 | default |  | On route `deploy-tag-fast` the release workflow counts as the in-repo deploy path. | On route `deploy-tag-fast` that workflow is the release workflow itself | project.schema.md | #454 |
| S1.runbook.08 | default |  | Omit `runbook` when an in-repo deploy workflow already answers how it reaches production. | Omit the key when an in-repo deploy workflow already answers | project.schema.md | — |

### `stack`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.stack.01 | default |  | `stack` is required and a free-form string describing the repo honestly. | Free-form string. Describe the repo honestly: | project.schema.md | — |
| S1.stack.02 | default |  | `stack` is for orientation only, never machine dispatch. | Used by humans and agents for orientation, never for machine dispatch. | project.schema.md | — |

### `integration`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.integration.01 | default |  | `integration` optionally lists additional long-lived integration branches; absent is normal. | Additional long-lived integration branches — lines that accumulate work for a | project.schema.md | — |
| S1.integration.02 | default |  | An integration line accumulates work for a release far enough out that it is not merged into trunk for weeks. | release far enough out that they are not merged into trunk for weeks. | project.schema.md | — |
| S1.integration.03 | hard | tools/colab::is not a declared base for this repo | A declared line lets `colab worktree new --base` cut from it, ship merges a worktree back to its base, and guards the line like trunk. | will cut from it, `colab ship` merges a worktree back into | project.schema.md | — |
| S1.integration.04 | default |  | Nothing in the promote/tag/deploy path reads `integration`. | nothing in the promote / tag / deploy path reads this field. | project.schema.md | — |
| S1.integration.05 | hard | tools/colab::is a declared integration line (project.yml integration:) | `colab ship` refuses the integration line to trunk merge even under `autonomy: auto-trunk`. | `colab ship` refuses the line → trunk merge even under | project.schema.md | — |
| S1.integration.06 | default |  | An `integration` entry may not equal trunk, `main` or the word `trunk`, and must exist as a branch. | Validity: an entry may not be `trunk`'s value, may not be `main` (the release branch on Tiers A and C, | project.schema.md | — |
| S1.integration.07 | default |  | A declared integration line nobody ever cut is reported by the audit. | A declared line nobody ever cut is the same failure as a release branch | project.schema.md | — |
| S1.integration.08 | default |  | CI on an integration line is checked but advisory: a line with no push workflow gets a warning, never a failure. | CI on a line is checked but advisory | project.schema.md | — |
| S1.integration.09 | hard | tools/colab::fail-to-start counts as not green | Trunk's CI gate remains a hard requirement. | Trunk's CI gate remains a hard requirement. | project.schema.md | — |

### `releaseBranch`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.releasebranch.01 | default |  | `releaseBranch` optionally names the long-lived branch an external GitOps poller fast-forwards on release. | Names the long-lived branch an external GitOps poller fast-forwards on release, in | project.schema.md | — |
| S1.releasebranch.02 | default |  | Absent is the normal case; most tier A repos deploy from `main` and need no extra name. | most Tier A repos deploy from `main` itself and need no | project.schema.md | — |
| S1.releasebranch.03 | hard | tools/colab::is not a declared base for this repo | A worktree may never be cut from or shipped into a release branch; declaring one grants no such base. | A worktree may never be cut from it or shipped into it | project.schema.md | — |
| S1.releasebranch.04 | default |  | A `releaseBranch` entry may not equal trunk, `main` or the word `trunk`, and must exist as a branch. | Validity: an entry may not be `trunk`'s value, may not be `main`, may not be the word | project.schema.md | — |
| S1.releasebranch.05 | default |  | A malformed `releaseBranch` entry is dropped, not honoured, and the audit reports it as a finding. | a malformed entry is dropped rather than honoured, and the | project.schema.md | — |

### `owner`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.owner.01 | default |  | `owner.branch` names the owner's branch, the one only the owner merges into; used for a repo the fleet builds in but does not own. | It names the owner's branch: the one only the owner merges into. | project.schema.md | #394 |
| S1.owner.02 | default |  | Absent `owner` means today's behaviour, byte for byte. | Absent is the normal case, and absent means today's behaviour, byte for byte | project.schema.md | #394 |
| S1.owner.03 | default |  | `colab adopt --local` writes the block when it detects the owner's default branch and never overwrites a declared one. | `colab adopt --local` writes the block when it detects the owner's default branch | project.schema.md | #405 |
| S1.owner.04 | default |  | Per-issue landing is unchanged: `colab ship` squashes each branch onto `trunk:`. | `colab ship` keeps squashing each branch onto | project.schema.md | #394 |
| S1.owner.05 | default |  | The owner's branch is reached by one pull request from `colab deliver`, never by a push; the PR is batch-shaped. | The owner's branch is reached by one pull request, never by a push. | project.schema.md | #394 |
| S1.owner.06 | default |  | Delivered is read from PR state, not ancestry. | Delivered is read from PR state, not ancestry. | project.schema.md | #394 |
| S1.owner.07 | default |  | A delivery PR the owner closed unmerged is a rejection; nothing new is opened without `--reopen`. | is reported as a rejection, and nothing new is opened without `--reopen`. | project.schema.md | #394 |
| S1.owner.08 | hard | tools/colab::function assertNotOwnerBranch ; tools/lib/owner-branch.js::function refuseMove | No colab command moves `owner.branch`; ship, batch and promote refuse a push to it, whatever the grant, and no worktree is cut from it. | No colab command moves `owner.branch`. | project.schema.md | #394 |
| S1.owner.09 | hard | tools/colab::re-run with COLAB_HUMAN=1 (--dry needs none) | Opening or editing the delivery PR requires `COLAB_HUMAN=1`. | A write to the owner's repo needs a human. | project.schema.md | #394 |
| S1.owner.10 | default |  | `colab deliver --dry` only reads, so a scheduled driver may run it and never acts on the owner's branch unattended. | `colab deliver --dry` only reads, so a scheduled driver may run it | project.schema.md | #394 |
| S1.owner.11 | hard | tools/colab::core-path review (#350) | A branch touching a CODEOWNERS path still needs a non-author approval before ship lands it on trunk. | The core-path rule stays on top. | project.schema.md | #350 |
| S1.owner.12 | default |  | `owner.branch` is required and is not the word `trunk`; only `branch` and `remote` are defined sub-keys. | `branch` is required and is not the word `trunk`; only `branch` and `remote` are | project.schema.md | #394 |
| S1.owner.13 | default |  | `owner.branch` may not equal `trunk:`, appear in `integration:` or equal `releaseBranch:`. | may not equal `trunk:`, appear in `integration:`, or equal | project.schema.md | #394 |
| S1.owner.14 | default |  | `colab deliver` supports only an owner's branch on the same remote trunk is pushed to; a fork delivery is refused. | `colab deliver` supports only the case where the owner's branch lives on | project.schema.md | #394 |
| S1.owner.15 | hard | tools/colab::function assertNotOwnerBranch ; tools/lib/owner-branch.js::function refuseMove | A malformed `owner` block fails closed: every branch-moving push refuses until it is fixed. | block fails closed: every branch-moving push refuses until it is fixed. | project.schema.md | #394 |

### Per-host deploy target

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.perhost.01 | default |  | A per-host deploy target holds no key in project.yml, on any tier. | so it holds no key in this file, on any tier. | project.schema.md | — |
| S1.perhost.02 | default |  | A per-host deploy target belongs to a per-host mechanism the repo owns, not a schema entry. | That fact belongs to a per-host mechanism the repo owns | project.schema.md | — |
| S1.perhost.03 | default |  | Never put a `deploys: { <host>: <branch> }` entry into the shared descriptor. | Putting it here instead (`deploys: { <host>: <branch> }`) would put hostnames into | project.schema.md | — |
| S1.perhost.04 | default |  | A per-host mechanism must name the branch it serves, be unset by default, and never widen or disable the gate it overrides. | it must name the branch it serves, unset-by-default, and | project.schema.md | — |
| S1.perhost.05 | default |  | The per-host axis never reads `trunk:` or `integration:`, and they never read it. | this axis never reads them and they never read it. | project.schema.md | — |

### `ports`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.ports.01 | default |  | `ports` is optional: TCP ports reserved for the repo's trunk dev server(s). | TCP ports reserved for this repo's trunk dev server(s). | project.schema.md | — |
| S1.ports.02 | hard | tools/lib/ports.js::A reserved port is NEVER handed to a worktree | A reserved port is aggregated machine-wide and never allocated to a worktree, even when the trunk server is down. | across all registered repos into the machine-wide reserved set | project.schema.md | — |
| S1.ports.03 | default |  | Omit `ports` if the repo has no dev server. | Omit if the repo has no dev server (CLI tools, libraries). | project.schema.md | — |

### `worktreePorts`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.worktreeports.01 | default |  | `worktreePorts` is an optional two-element `[lo, hi]` range for worktree port allocation, distinct from `ports`. | A two-element `[lo, hi]` range naming the window that worktrees of this repo | project.schema.md | — |
| S1.worktreeports.02 | default |  | Allocation precedence: explicit `--range`/`--at` flag, then `worktreePorts`, then machine-global `config.portRange`. | Precedence when allocating: explicit `--range`/`--at` flag > this field > the | project.schema.md | — |
| S1.worktreeports.03 | default |  | Malformed `worktreePorts` values fall through to the default. | Malformed values fall through to the default. | project.schema.md | — |
| S1.worktreeports.04 | default |  | Keep the `worktreePorts` window disjoint from every repo's reserved `ports`. | Keep the window disjoint from every repo's reserved `ports:` | project.schema.md | — |

### `autonomy`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.autonomy.01 | default |  | `autonomy` is optional (`manual` or `auto-trunk`) and sets how much of Phase B an agent may do alone. | How much of a session's Phase B (merge to trunk) an agent may perform alone. | project.schema.md | — |
| S1.autonomy.02 | hard | tools/colab::function shipAutonomyGate | With `manual` or absent, an agent stops after Phase A and a human triggers the merge. | an agent stops after Phase A; a human triggers the merge. | project.schema.md | — |
| S1.autonomy.03 | hard | tools/colab::function shipAutonomyGate | A change ship measures as documentation only passes the autonomy gate without the grant. | a change `colab ship` measures as documentation only passes the autonomy gate | project.schema.md | #345 |
| S1.autonomy.04 | hard | tools/colab::function shipAutonomyGate | No value of this field or any other widens what counts as documentation. | No value of this field, or of any other, widens what counts as documentation. | project.schema.md | #345 |
| S1.autonomy.05 | hard | tools/colab::function shipAutonomyGate ; templates/pre-push-guard::COLAB_SHIP:-}" != "1" | With `auto-trunk` an agent may complete the trunk merge through `colab ship` only, and only when every precondition passes; any failure falls back to a human. | an agent may complete the trunk merge itself through `colab ship` only | project.schema.md | — |
| S1.autonomy.06 | hard | tools/colab::NEVER tags, NEVER promotes ; templates/pre-push-guard::COLAB_PROMOTE | `autonomy` grants trunk autonomy only, never promotion, a tag or anything that deploys. | This grants trunk autonomy only — never promotion, a tag, or anything that deploys | project.schema.md | — |
| S1.autonomy.07 | default |  | The autonomy grant lives in the repo file, not the caller's flags, and is reviewed in a commit. | The grant lives in the repo file (not the caller's flags) | project.schema.md | — |
| S1.autonomy.08 | default |  | First adoption may record the grant with `colab adopt --autonomy auto-trunk --land` (`COLAB_HUMAN=1`, `--answered-by`). | records the grant and commits the descriptor straight | project.schema.md | #481 |

### `ship-batch`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.shipbatch.01 | default |  | `ship-batch` is optional: how many green candidates `colab ship --batch` may land at once. | How many green candidates `colab ship --batch` may land at once | project.schema.md | — |
| S1.shipbatch.02 | default |  | `ship-batch` is an integer from 1 to 8, the repo's ceiling. | integer from 1 to 8 — the repo's ceiling | project.schema.md | — |
| S1.shipbatch.03 | default |  | Absent or `1` keeps serial landing exactly; every `--batch` call declines. | Absent or `1` keeps today's serial landing exactly | project.schema.md | — |
| S1.shipbatch.04 | hard | tools/lib/ship-batch.js::expected an integer 1 | Any other `ship-batch` value fails the audit and ship fails closed to serial on it. | and `colab ship` fails closed to serial on it | project.schema.md | #416 |
| S1.shipbatch.05 | default |  | Any other value also fails the CI templates' descriptor check. | value (`0`, `9`, `2.5`, a word) fails the audit and the CI templates' descriptor check | project.schema.md | #416 |
| S1.shipbatch.06 | default |  | A copy of the CI templates older than #416 lacks the descriptor step; copy it in. | A copy of the CI templates older than #416 lacks the step. | project.schema.md | #416 |
| S1.shipbatch.07 | default |  | A red combined run of two or more members splits rather than going serial, so a red stays logarithmic. | so a red stays logarithmic | project.schema.md | #557 |
| S1.shipbatch.08 | default |  | A queue longer than the cap drains as consecutive batches. | A queue longer than the cap still drains as consecutive batches. | project.schema.md | — |
| S1.shipbatch.09 | hard | tools/colab::could never arrive; landing serially instead | A batch puts trunk's head plus one squash commit per member (each with `Closes #N`) on a ship-batch ref, needs one green combined run, and fast-forwards trunk only if trunk has not moved. | puts trunk's head plus one squash commit per | project.schema.md | #373 |
| S1.shipbatch.10 | hard | tools/colab::could never arrive; landing serially instead | A CI workflow must fire on a `ship-batch/**` push; without it every `--batch` call declines. | A CI workflow fires on a `ship-batch/**` push. | project.schema.md | #384 |
| S1.shipbatch.11 | hard | tools/colab::batch landing needs it | A batch needs `autonomy: auto-trunk`; without the grant the field is inert. | A batch lands every member in one unattended push | project.schema.md | — |
| S1.shipbatch.12 | default |  | `ship-batch/` is a ref namespace `colab ship` owns and manages itself. | `ship-batch/` is a ref namespace `colab ship` owns | project.schema.md | — |
| S1.shipbatch.13 | default |  | `--batch` exit codes: 0 landed, 3 paused, 4 declined. | Exit codes of `--batch`: `0` landed · | project.schema.md | — |

### `ship-batch-wait`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.shipbatchwait.01 | default |  | `ship-batch-wait` is optional: how long a lone ready candidate waits for a partner; absent keeps today's behaviour. | Absent keeps today's behaviour exactly. | project.schema.md | #555 |
| S1.shipbatchwait.02 | default |  | The handbook ships no default value and no ceiling for the window. | no default value and no ceiling | project.schema.md | #555 |
| S1.shipbatchwait.03 | hard | tools/lib/ship-batch.js::expected a whole number with a unit | A malformed `ship-batch-wait` fails the audit and the CI descriptor check; `colab ship` fails closed to no wait on it. | and `colab ship` fails closed to no wait on it | project.schema.md | #555 |
| S1.shipbatchwait.04 | default |  | The window is counted from when the lone member became ready, so it never restarts. | so the window never restarts | project.schema.md | #555 |

### `ship-batch-steps`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.shipbatchsteps.01 | default |  | `ship-batch-steps` is optional: the sizes an adaptive batch walks through; absent keeps a fixed size. | Absent keeps a fixed size | project.schema.md | #557 |
| S1.shipbatchsteps.02 | default |  | The handbook ships no default steps; `ship-batch` stays the ceiling. | The handbook ships **no default steps** | project.schema.md | #557 |
| S1.shipbatchsteps.03 | default |  | The size is read from the newest `Ship-Batch-Size:` trailer on trunk: green → one step up, red → one step down, none → the smallest step. | green → the smallest step above `s` | project.schema.md | #557 |
| S1.shipbatchsteps.04 | hard | tools/lib/ship-batch.js::expected strictly ascending sizes | A malformed `ship-batch-steps` fails the audit and the CI descriptor check; `colab ship` fails closed to the fixed size on it. | and `colab ship` fails closed to the fixed size on it | project.schema.md | #557 |

### `ci-wait-factor`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.ciwaitfactor.01 | default |  | Every CI wait bound is measured from the repo's own CI history; the factor is the only declared part. | only declared part of it (#559) | project.schema.md | #559 |
| S1.ciwaitfactor.02 | default |  | With too few samples a bound stays on its bootstrap value, the pre-#559 value exactly. | A kind with too few samples stays on its | project.schema.md | #559 |
| S1.ciwaitfactor.03 | default |  | The 6 h wedge cap and the 30/60/120 s schedule are safety limits measurement may only tighten. | are safety limits measurement may only tighten | project.schema.md | #559 |
| S1.ciwaitfactor.04 | default |  | `colab ship` reads the cached profile only; a verdict never waits on a history fetch. | a verdict never waits on a history fetch | project.schema.md | #559 |
| S1.ciwaitfactor.05 | hard | tools/lib/ci-profile.js::must be a number ≥ 1 | A malformed `ci-wait-factor` fails the audit; the tools use the default 2 and say so. | a bad value never produces a different behaviour | project.schema.md | #559 |

### `thresholds`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.thresholds.01 | default |  | Advisory thresholds (what is flagged, ranked or warned about, never what is refused) are the repo's to set under `thresholds:`. | are the repo's to set (#560) | project.schema.md | #560 |
| S1.thresholds.02 | default |  | Each default is today's value, so a repo that declares nothing sees no change. | a repo that declares nothing sees no change | project.schema.md | #560 |
| S1.thresholds.03 | default |  | Safety limits and protocol counts are not thresholds and keep their own fields. | Safety limits (a cap a repo may only tighten) and protocol counts are not thresholds | project.schema.md | #560 |
| S1.thresholds.04 | hard | tools/lib/thresholds.js::must be a whole number | An unknown name, a non-whole-number or a value under its floor fails the audit and the CI descriptor check; every reader falls back to the default. | falls back to the default and says so | project.schema.md | #560 |
| S1.thresholds.05 | default |  | The `batch-*` thresholds have no default: the audit's `--batch-history` shows the measured batch picture and flags only against a value the repo declares. | have **no default** | project.schema.md | #556 |
| S1.thresholds.06 | default |  | A declared batch rate with no samples, or fewer than `batch-min-samples`, is listed as not judged — never as a pass. | is listed as not judged | project.schema.md | #556 |

### `migrations`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.migrations.01 | default |  | `migrations` lists repo-relative prefixes where migrations live beyond Laravel `database/migrations/` and Prisma `prisma/migrations/`. | Where this repo's migrations live, beyond the two layouts every reader already knows | project.schema.md | — |
| S1.migrations.02 | hard | tools/colab::function shipMigrationGate | Ship's no-new-migrations gate and `release cut`'s schema-additive check read this one list and keep no regex of their own. | `schema-additive` check read this one list | project.schema.md | — |
| S1.migrations.03 | default |  | Absent `migrations` changes nothing. | Absent changes nothing | project.schema.md | — |
| S1.migrations.04 | default |  | Entries are repo-relative directory prefixes matched from the repo root. | Entries are repo-relative directory prefixes, matched from the repo root. | project.schema.md | — |
| S1.migrations.05 | default |  | An absolute path, a `..`, a glob or the repo root itself is a finding. | an absolute path, a `..`, a glob, or the repo root | project.schema.md | — |
| S1.migrations.06 | hard | tools/colab::function shipMigrationGate | `migrations` is additive, never a replacement: the defaults always apply and there is no opt-out. | Additive, never a replacement. The defaults always apply; | project.schema.md | — |
| S1.migrations.07 | hard | tools/colab::function shipMigrationGate | Ship reads trunk's declaration and the branch's, unioned. | Ship reads trunk's declaration and the branch's, unioned. | project.schema.md | — |
| S1.migrations.08 | default |  | `release cut` reads `.php`/`.sql` under a declared prefix; any other format is named in the check detail, never folded into none destructive. | `release cut` reads `.php`/`.sql` under a declared prefix | project.schema.md | — |
| S1.migrations.09 | default |  | The audit reports a tracked `*/migrations/` directory no rule covers (advisory, local audits only). | The audit reports a tracked `*/migrations/` directory no rule covers | project.schema.md | — |

### `migration-grant`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.migrationgrant.01 | default |  | `migration-grant` decides who may open the no-new-migrations door. | This key decides who may open the no-new-migrations door | project.schema.md | — |
| S1.migrationgrant.02 | hard | tools/lib/migration-grant.js::function parseGrantPolicy ; tools/colab::function shipMigrationGate | `migration-grant: human` accepts only the human grant; `reviewer` also lets a migration-reviewer grant be minted. | `human` accepts only the human grant. | project.schema.md | — |
| S1.migrationgrant.03 | hard | tools/lib/migration-grant.js::function parseGrantPolicy ; tools/colab::function shipMigrationGate | A reviewer grant is bound to the reviewed migration content, so a trunk sync leaving the files byte-identical keeps it. | The grant is bound to the reviewed migration content (a `migrations:` id in the record, | project.schema.md | #508 |
| S1.migrationgrant.04 | default |  | `migration-grant` is a separate flat key, not nested under `migrations:`. | It is a separate flat key, not nested under `migrations:`. | project.schema.md | — |
| S1.migrationgrant.05 | hard | tools/colab::function shipMigrationGate | Only the trunk checkout's `migration-grant` value counts; a branch cannot raise its own policy. | Only the trunk checkout's value counts. | project.schema.md | — |
| S1.migrationgrant.06 | hard | tools/lib/migration-grant.js::function parseGrantPolicy | An invalid `migration-grant` value falls back to `human`, and the audit fails it. | An invalid value falls back to `human`. That is the stricter reading, and the audit | project.schema.md | — |
| S1.migrationgrant.07 | hard | tools/colab::function shipMigrationGate | Ship honours a reviewer grant only with P + M + HEAD + R: the key at the target tip, a passing review record binding the head, and a live passing `Migration round-trip` CI job. | `colab ship` honours a reviewer grant only with P + M + HEAD + R | project.schema.md | #401 |
| S1.migrationgrant.08 | default |  | A repo with no `Migration round-trip` job can declare `reviewer`, but every reviewer grant there fails R and the audit warns (#494). | A repo with no such job can declare `reviewer`, but every reviewer grant there fails R and the audit warns. | project.schema.md | — |
| S1.migrationgrant.09 | default |  | The audit always reports the value in `--json` as `migrationGrant`. | It appears in `--json` as `migrationGrant`. | project.schema.md | — |

### `ci-grant`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.cigrant.01 | default |  | `ci-grant` decides who may open the red-trunk door when the cure rule refuses. | This key decides who may open the red-trunk door when the cure rule refuses | project.schema.md | — |
| S1.cigrant.02 | hard | tools/lib/ci-grant.js::function parseGrantPolicy | `ci-grant: human` accepts only the human grant (`COLAB_HUMAN=1`). | `human` accepts only the human grant (`COLAB_HUMAN=1`). | project.schema.md | #504 |
| S1.cigrant.03 | default |  | `ci-grant: reviewer` also lets `colab ci-grant --role ci-reviewer` mint a grant without `COLAB_HUMAN=1`, bound to one HEAD and one red trunk sha. | `reviewer` also lets `colab ci-grant | project.schema.md | #504 |
| S1.cigrant.04 | hard | tools/lib/ci-grant.js::function parseGrantPolicy | Only trunk's committed `ci-grant` value counts, read from trunk by both `colab ci-grant` and ship; a branch cannot opt itself in. | Only trunk's committed value counts. | project.schema.md | #504 |
| S1.cigrant.05 | hard | tools/lib/ci-grant.js::function parseGrantPolicy | An invalid `ci-grant` value falls back to `human`, and the audit fails it. | An invalid value falls back to `human`. That is the stricter reading, and the audit | project.schema.md | — |
| S1.cigrant.06 | default |  | Declaring `ci-grant` is a human act, like lowering exposure; the agent it lets through does not add it. | Declaring it is a human act, like lowering exposure | project.schema.md | — |
| S1.cigrant.07 | default |  | The audit always reports the value in `--json` as `ciGrant`. | It appears in `--json` as `ciGrant`. | project.schema.md | — |

### `trust-humans`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.trusthumans.01 | default |  | `trust-humans` names the logins that count as human for a grant or a ruling. | This key names the logins that count as human for a grant | project.schema.md | — |
| S1.trusthumans.02 | default |  | Declare `trust-humans` when agents run under their own GitHub account. | Declare it when your agents run under their own GitHub account. | project.schema.md | — |
| S1.trusthumans.03 | default |  | Absent `trust-humans` changes nothing: a trusted association counts as human. | A trusted association counts as human, as before. | project.schema.md | — |
| S1.trusthumans.04 | hard | tools/lib/trust-humans.js::function authorIsHuman | When `trust-humans` is declared only listed logins are human; a grant or ruling by any other author is refused, and the reason names the login. | Declared → only listed logins are human. | project.schema.md | — |
| S1.trusthumans.05 | hard | tools/lib/trust-humans.js::function labelApplierIsHuman | For the two grant labels the account that last applied the label must be listed too. | the account that last applied the label must be listed too. | project.schema.md | — |
| S1.trusthumans.06 | hard | tools/colab::ALWAYS the merge target / trunk, never the branch | `trust-humans` is read from the target (trunk), never the branch. | Read from the target, never the branch. | project.schema.md | — |
| S1.trusthumans.07 | default |  | Editing the `trust-humans` list is a human act, like lowering exposure. | Editing the list is a human act, like lowering exposure. | project.schema.md | — |
| S1.trusthumans.08 | default |  | A reviewer grant is not judged by `trust-humans`; the list only decides what a human grant is. | A reviewer grant is not judged by it. | project.schema.md | — |
| S1.trusthumans.09 | default |  | `trust-humans` is a flat key holding a list, not `trust: { humans: … }`. | A flat key holding a list, not `trust: { humans: … }`. | project.schema.md | — |
| S1.trusthumans.10 | hard | tools/lib/trust-humans.js::function parseTrustHumans | A malformed `trust-humans` value means nobody is human, blocking every human grant and ruling until fixed. | A malformed value means nobody is human. | project.schema.md | — |
| S1.trusthumans.11 | default |  | The audit always reports the value in `--json` as `trustHumans`. | It appears in `--json` as `trustHumans` | project.schema.md | — |

### `room`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.room.01 | default |  | `room` (`solo`, `team` or `public`) says who else could ever read what a session writes down here. | Who else could ever read what a session writes down here | project.schema.md | — |
| S1.room.02 | default |  | `room` decides what an Issue is for, which language it is written in, and whether a human release names a role. | It decides what an Issue is for (memory for `solo`, | project.schema.md | — |
| S1.room.03 | default |  | Omission of `room` means undeclared, not `solo`. | Omission means undeclared, not `solo`. | project.schema.md | — |
| S1.room.04 | default |  | Never infer a repo's room from GitHub visibility, `production:` or anything else. | Nothing infers a repo's room from its GitHub visibility | project.schema.md | — |
| S1.room.05 | default |  | The audit only enum-checks `room`; no downstream rule reads it yet. | and nothing more: no downstream rule reads `room` yet. | project.schema.md | — |

### `branchPrefix`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.branchprefix.01 | default |  | `branchPrefix` says whether session branches carry the account and machine that cut them. | Whether session branches carry the account and machine that cut them | project.schema.md | — |
| S1.branchprefix.02 | default |  | The one value is `machine`; absent means the unprefixed `<type>/<slug>-<N>` shape, which stays conforming. | absent means the unprefixed `<type>/<slug>-<N>` shape, which stays conforming either way. | project.schema.md | — |
| S1.branchprefix.03 | default |  | With `branchPrefix` declared, `colab worktree new` takes the ordinary §4 name and prepends `<login>/<machine>/` itself. | With it declared, `colab worktree new` takes the ordinary §4 name and prepends | project.schema.md | — |
| S1.branchprefix.04 | default |  | Readers never need `branchPrefix`; both shapes parse everywhere. | Readers never need this field: both shapes parse everywhere | project.schema.md | — |
| S1.branchprefix.05 | default |  | The machine label is a label, not an identity; claim comparisons stay on the per-machine identity. | The machine label is a label, not an | project.schema.md | — |
| S1.branchprefix.06 | default |  | The audit only enum-checks `branchPrefix`. | The audit enum-checks the value, nothing more. | project.schema.md | — |

### `holds`

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S1.holds.01 | default |  | `holds` lists labels beyond the handbook's own start gates that the repo treats as start holds. | The labels, beyond the handbook's own start gates, that this repo treats as start holds | project.schema.md | — |
| S1.holds.02 | default |  | `code-triage` reports an issue carrying a declared hold label as blocked, never ready. | `code-triage` reads the list and reports an issue carrying any of these labels as blocked, | project.schema.md | — |
| S1.holds.03 | default |  | Absent `holds` means none declared; an undeclared label is not a hold to triage. | Absent means none declared. | project.schema.md | — |
| S1.holds.04 | default |  | Declaring a hold label does not relax the rule: the issue still names an owner and a wake condition in a `Hold:` line. | Declaring a label here does not relax the rule every hold follows | project.schema.md | — |
| S1.holds.05 | default |  | Declaring a hold label does not add it to the convention set, and `colab labels --ensure` never creates it. | Nor does it add the label to the convention set. | project.schema.md | — |
| S1.holds.06 | default |  | The audit checks `holds` shape only: a list, each member a non-empty string listed once. | The audit checks the shape only: a list, and each member a non-empty string listed once. | project.schema.md | — |
### `exposure` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.exposure.01 | default |  | `exposure`, when declared, is the axis of record for gate count and drives the trunk-shape, deploy-path and production-non-null rules. | the AXIS OF RECORD for gate count when | project.schema.md | #144 |
| S2.exposure.02 | default |  | `exposure: none` requires `trunk: main` and no committed deploy workflow. | `none` — `trunk: main` (nothing consumes this repo | project.schema.md | #144 |
| S2.exposure.03 | default |  | `exposure: self` carries no mechanism or contract rule, not even trunk shape. | no mechanism or contract rule at all, not even trunk shape. | project.schema.md | #144 |
| S2.exposure.04 | default |  | `exposure: live` requires a trunk distinct from `main`, a non-null `production`, `deploy: push-main` and a committed `deploy-*.yml`, with no `runbook:` escape hatch. | there is **no `runbook:` escape hatch** for `live` | project.schema.md | #205 |
| S2.exposure.05 | default |  | `exposure: released` with a non-null `production` (shape 1) requires `deploy` to be `tag` or `manual`, a committed deploy path, and `trunk: dev` (or `main` only when `deploy: tag`). | `deploy` must be `tag` or `manual` (never `push-main` | project.schema.md | #144 |
| S2.exposure.06 | default |  | `exposure: released` with `production: null` (shape 2) requires `trunk: main` and `deploy` absent or `none`, evidenced by a version-shaped tag or `channels: [artifact]`. | `trunk: main`, and `deploy` absent or `none` — nothing is live | project.schema.md | #144 |
| S2.exposure.07 | default |  | `exposure: none` together with `production: null` is a `warn` advisory, never a `fail`. | It is a `warn`, never a `fail`: the descriptor is not | project.schema.md | #144 |
| S2.exposure.08 | default |  | Every other `exposure`/`production` combination, including `live`/`released` with `production: null`, is clean. | Every other combination is clean, including `live`/`released` **with `production: null`** | project.schema.md | #144 |
| S2.exposure.09 | default |  | `exposure: none` gets evidence falsification (version-shaped tag or committed deploy path) as a `warn`, never a `fail`, plus a duration report; `self` and undeclared get neither. | Finding one is a `warn` naming the evidence, never a `fail` | project.schema.md | #137 |
| S2.exposure.10 | default |  | Omission of `exposure` means undeclared, never `none`: nothing infers exposure from visibility, `production:`, `tier` or a deploy workflow. | **Omission means undeclared, not `none`.** Nothing infers a repo's exposure from its GitHub | project.schema.md | #144 |
| S2.exposure.11 | default |  | Only a human may write a `none`/`self` value; an agent may propose raising exposure but never lowering it. | Raising exposure (proposing `live`/`released` from a committed `production` URL | project.schema.md | #144 |
| S2.exposure.12 | default |  | When both `tier` and `exposure` are declared and disagree about gate count, that is a finding (`tier: A` only with `released`, `tier: C` only with `live`, `tier: B` with any). | when BOTH are declared and disagree about gate count, that is a finding | project.schema.md | #144 |
| S2.exposure.13 | default |  | `tools/lib/exposure-shape.js` is the one executable version of the exposure gate contract; if prose and module disagree, the module runs. | read it, not this prose, if the two ever | project.schema.md | #144 |

### `channels` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.channels.01 | default |  | `channels` is a list of the kinds of path by which a commit reaches something that runs it, drawn from the seven named values. | By what path a commit reaches something that *runs* it | project.schema.md | — |
| S2.channels.02 | default |  | `channels` is strictly additive: `deploy` stays authoritative and no rule reads `channels` to change a `tier`/`trunk`/`deploy`/`production` finding. | **Strictly additive in this unit**: a new key alongside `deploy` | project.schema.md | — |
| S2.channels.03 | default |  | `channels` is always a list, never a scalar, because a repo can have several channels at once. | **A list, not a scalar** — the one structural difference from | project.schema.md | — |
| S2.channels.04 | default |  | `channels` names the KIND of channel, never the machine; machine-specific mechanism lives in a per-host config the repo owns, never in this descriptor. | Machine-specific mechanism lives in a | project.schema.md | — |
| S2.channels.05 | default |  | A bare scalar `channels` is a finding naming the list form. | A bare scalar is a finding naming the list form. | project.schema.md | — |
| S2.channels.06 | default |  | Every `channels` member must be one of the seven values; an unknown member is a finding. | Every member must be one of the seven values above. An unknown member is a finding. | project.schema.md | — |
| S2.channels.07 | default |  | `channels` has no duplicate members; a duplicate is a finding pointing at the deduplicated form. | **No duplicate members** — `[workflow, workflow]` is a finding | project.schema.md | — |
| S2.channels.08 | default |  | `none` is exclusive: `[none]` alone, never combined with another kind. | `none` is **exclusive** — `[none]` alone, never combined with another kind. | project.schema.md | — |
| S2.channels.09 | default |  | An empty `channels: []` is a finding pointing at `[none]`. | `[]` (empty list) is a finding pointing at `[none]` | project.schema.md | — |
| S2.channels.10 | default |  | Omission of `channels` means undeclared, never `none`; an agent may propose a channel it found evidence for but must never write `[none]`. | it may never write `[none]`. | project.schema.md | — |
| S2.channels.11 | default |  | `deploy: none` is not evidence about `channels`; no rule may conclude a repo's channel set from `deploy` alone. | no rule may ever conclude a `deploy: none` repo's channel | project.schema.md | — |
| S2.channels.12 | default |  | An unintended channel (a file-synced working tree with git metadata excluded) is a finding, never a legal `channels` value. | An unintended channel is a finding, never a value. | project.schema.md | #233 |
| S2.channels.13 | default |  | `channels: [none]` together with a non-null `production:` or a `deploy:` other than `none` is a `warn` advisory, never a `fail`, and is not paired with `exposure`. | is an advisory. It is a `warn`, never a `fail`, on `exposure`'s precedent | project.schema.md | — |
| S2.channels.14 | default |  | `channels: [none]` gets evidence falsification (tag or committed deploy path) as a `warn` plus a duration report, never paired with `exposure`. | additionally gets **evidence falsification** | project.schema.md | #137 |
| S2.channels.15 | explanation |  | Why `procedure` is the value name rather than `manual`: `deploy: manual` and `channels: [procedure]` answer two different questions (moved to the ADR). | Why `procedure` and not `manual`. | docs/adr/539-schema-exposure-and-channels-rationale.md | — |

### `distribution` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.distribution.01 | default |  | `distribution` is `js` or `compiled`, says the repo distributes a tool, and names its column of the §6 Distribution table; public/private is read from the GitHub API, never declared. | Says that this repository **distributes a tool**, and which column of CONVENTIONS.md | project.schema.md | #469 |
| S2.distribution.02 | default |  | Omission of `distribution` means undeclared, not "no tool"; the audit checks only a declared value and never infers one, and there is no `none` value. | **Omission means undeclared, not | project.schema.md | #469 |
| S2.distribution.03 | default |  | The audit accepts a declared tool's install route per the table of (value, visibility) rows. | What the audit accepts as the install route, per row: | project.schema.md | #469 |
| S2.distribution.04 | default |  | An unknown `distribution` value is a `fail` finding. | An unknown value is a **finding** (`fail`), like every enum. | project.schema.md | #469 |
| S2.distribution.05 | default |  | A declared tool with no install route is an advisory `warn`. | A declared tool with no route is | project.schema.md | #469 |
| S2.distribution.06 | default |  | `distribution` is not coupled to `exposure`; every distributed tool installs with npx, a team-only tool included. | Not coupled to `exposure` — §6 says *every* distributed tool installs with npx | project.schema.md | #469 |

### `ci` — deliberately not a field

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.ci.01 | default |  | There is no `ci:` field; what CI is derives from whether the unit has a branch and how thorough it must be derives from `exposure`. | What CI *is* — gate or alarm — is derived from whether the unit has a branch | project.schema.md | #233 |
| S2.ci.02 | default |  | A repo needing more than its copied workflow covers edits that file directly; the audit classifies the edit as drift to reconcile, not a violation. | A repo needing something its copied workflow doesn't cover edits that file directly. | project.schema.md | — |
| S2.ci.03 | default |  | `gate` declares the fast local command and which verdict the skills read, never what CI is or how thorough it must be. | never what CI is or how thorough it must be. | project.schema.md | #410 |

### `ceremony` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.ceremony.01 | default |  | `ceremony` is `standard` (default; omission = standard) or `light`, and sets only how much record-keeping depth a session owes the repo. | How much record-keeping DEPTH a session owes this repo | project.schema.md | — |
| S2.ceremony.02 | default |  | Under `ceremony: light`, Phase B evidence comments are skipped (the squash's `Closes #N` suffices) and issue narration distills real gotchas only. | Phase B evidence comments are skipped; the squash's | project.schema.md | — |
| S2.ceremony.03 | default |  | Under `ceremony: light`, triage orders and groups but skips the `deps-checked` labeling pass. | triage orders and groups but skips the `deps-checked` | project.schema.md | — |
| S2.ceremony.04 | default |  | Under `ceremony: light`, memory-ceremony audit gaps downgrade to advisories. | memory-ceremony gaps (empty readiness column, missing | project.schema.md | — |
| S2.ceremony.05 | default |  | `ceremony: light` never relaxes claim before start, branch-off-trunk and worktree discipline, reserved ports, main checkout at rest on trunk, squash plus `Closes #N`, Conventional Commits, or the CI secret scan and build. | **What `light` may never relax:** claim before start | project.schema.md | — |
| S2.ceremony.06 | hard | tools/lib/adopt.js::autonomy: auto-trunk is refused alongside ceremony: light | `ceremony: light` is incompatible with `autonomy: auto-trunk`. | `light` is incompatible with `autonomy: auto-trunk`. | project.schema.md | #175 |
| S2.ceremony.07 | default |  | `ceremony: light` no longer, by itself, enables solo flow; solo flow's gate is `writes` and attendance. | `ceremony: light` no longer, by itself, enables solo flow. | project.schema.md | #175 |
| S2.ceremony.08 | hard | tools/colab::solo refused in | `colab solo` refuses outright on any repo declaring `writes: isolated` and on any session that cannot assert `COLAB_HUMAN=1`. | `colab solo` now refuses outright on any | project.schema.md | #233 |

### `writes` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.writes.01 | default |  | `writes: isolated` means no trunk-direct in the repo, human or not; no field, flag or override lowers that bar. | no field/flag/override lowers that bar. | project.schema.md | #233 |
| S2.writes.02 | default |  | Absence and every other declared value (`free`, `direct`, `serial`, `serial-direct`, `serial-gated`) mean coexistence; `serial-direct`, `serial-gated` and `serial` are inert, identical to absence. | identical to absence), means **coexistence** | project.schema.md | #233 |
| S2.writes.03 | default |  | `writes: free` is coexistence spelled out; `writes: direct` is coexistence plus a declared intent whose runtime is deferred and changes no session's permissions. | its runtime is **deferred** | project.schema.md | #283 |
| S2.writes.04 | default |  | Every pre-#283 `writes` spelling is still accepted and resolves the same way. | is still accepted and still resolves the same way. | project.schema.md | #283 |
| S2.writes.05 | default |  | Many units in flight writing trunk-direct with no attendance and no veto is incoherent and has no declarable value. | has no declarable value. | project.schema.md | #233 |
| S2.writes.06 | default |  | Constraint matrix: trunk-direct by a human at the keyboard is forbidden under `writes: isolated` and allowed under coexistence; trunk-direct by an automated session is forbidden in both. | trunk-direct, human at the keyboard (`COLAB_HUMAN=1`) | project.schema.md | #233 |
| S2.writes.07 | default |  | Constraint matrix: `autonomy: auto-trunk` is allowed under both columns. | `autonomy: auto-trunk` \| allowed \| allowed | project.schema.md | #233 |
| S2.writes.08 | default |  | Constraint matrix: a place-claim is needed on the trunk checkout under coexistence and not under `isolated`. | place-claim needed \| n/a — nothing writes the shared checkout | project.schema.md | #233 |
| S2.writes.09 | default |  | Constraint matrix: a branch is always required except for an attended trunk-direct unit under coexistence. | always, except an attended trunk-direct unit | project.schema.md | #233 |
| S2.writes.10 | default |  | Constraint matrix: `ceremony: light` plus `autonomy: auto-trunk` is forbidden under both columns. | `ceremony: light` + `autonomy: auto-trunk` | project.schema.md | #233 |
| S2.writes.11 | default |  | Exactly two conditions make a branch mandatory for an attended trunk-direct session: more than one unit in flight, or a gate that must inspect a unit before it lands; "it feels safer" is not one. | **Exactly two conditions make a branch mandatory** | project.schema.md | #233 |
| S2.writes.12 | default |  | A repo where a gate must inspect every unit says so by having a trunk-gating CI workflow or branch protection, never by a declared value. | says so by *having* one | project.schema.md | #233 |
| S2.writes.13 | default |  | `tools/lib/writes-authority.js` is the one shared resolver for `writes` spellings (the audit and `colab adopt` both read it). | is the ONE shared | project.schema.md | #233 |
| S2.writes.14 | default |  | Reclassifying an existing repo's descriptor to `serial-gated` is presentation-only and changes nothing observable. | is now presentation-only — | project.schema.md | #233 |
| S2.writes.15 | default |  | `writes` is deliberately not coupled to `tier`, `production` or exposure, and no coherence rule is audited against them; do not add one. | No coherence rule is audited against `tier`/`production` | project.schema.md | — |
| S2.writes.16 | default |  | There is no field for the place-claim itself; it lives in session state (`~/.colab/state.json`), never in this file. | never in this file. | project.schema.md | — |

### `promotion` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.promotion.01 | default |  | `promotion` is `human` (default) or `main-loop` and says who may run `colab promote` without a per-instance human word; it is distinct from release (the tag). | Who may run the **promotion** | project.schema.md | #440 |
| S2.promotion.02 | default |  | `promotion: human` (or absent) means promotion needs `COLAB_HUMAN=1`. | `human` (or absent) — promotion needs `COLAB_HUMAN=1`. | project.schema.md | — |
| S2.promotion.03 | default |  | `promotion: main-loop` lets the main loop promote unattended only on a `deploy: tag` repo, where promotion is verification-only. | the main loop may promote unattended, **but only on a | project.schema.md | #440 |
| S2.promotion.04 | default |  | With `promotion: main-loop`, the final tag stays a human click; without that value `colab promote --auto` is a no-op. | The final tag stays a human click. | project.schema.md | #440 |
| S2.promotion.05 | hard | tools/colab::doc.promotion === 'main-loop' ; templates/pre-push-guard::COLAB_PROMOTE | Unknown `promotion` values fail closed to `human`; the field cannot lower the bar set by `deploy:`, and `push-main` and `manual` repos always require `COLAB_HUMAN=1`; nothing here ever authorizes tagging. | Unknown values fail closed to `human`. | project.schema.md | — |
| S2.promotion.06 | default |  | Permission ladder, one rung per boundary: ship (gated by `autonomy`), promote (gated by `deploy` plus `promotion`), release (candidates automatic, final tag by exposure). | The full permission ladder, one rung per boundary: | project.schema.md | — |

### `release` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.release.01 | default |  | `release` declares how the tag runs on this repo (route, candidates, test period, final); it is the one nested-map block, accepted under this key only. | The one block that is a nested map; the | project.schema.md | — |
| S2.release.02 | default |  | When `release` is absent the default is derived from `exposure` + `deploy` (+ `production`), never declared, per the §6 route table. | **Absent means the default, and the default is derived — never declared.** | project.schema.md | — |
| S2.release.03 | default |  | Derived route table: `none` for `exposure: none`/`self`; `public-tool` for no-production `released`; `deploy-tag` for `released` with `deploy: tag` or `manual`; `live` for `exposure: live`; fail closed (`none`) for anything else. | anything else — undeclared or unknown `exposure`, a bare `tier: B` | project.schema.md | — |
| S2.release.04 | default |  | `rapid-app` and `library-fast` are the extra routes only a no-production `released` repo may choose, with their candidates/test-period/final settings as tabled. | The two routes only a no-production `released` repo may choose | project.schema.md | — |
| S2.release.05 | default |  | `deploy-tag-fast` is the one extra route a `deploy: tag` repo may choose, only with the operator's grant and a declared health gate. | only with the operator's grant and a declared health gate | project.schema.md | #446 |
| S2.release.06 | default |  | Legacy `tier: A` reads as `released` and takes the route its `deploy` names; `tier: C` reads as `live`. | Legacy `tier: A` reads as `released` and takes the route its `deploy` names | project.schema.md | — |
| S2.release.07 | default |  | A declared `route` must be one the descriptor's row permits; a route outside that set is a failure and the derived route stays in effect. | A route outside that set is a **failure**, and the derived | project.schema.md | — |
| S2.release.08 | default |  | `route: none` is permitted everywhere because turning releases off is always a narrowing. | `none` is permitted everywhere: turning releases off is always a | project.schema.md | — |
| S2.release.09 | default |  | The other `release` keys may narrow the route in effect, never widen it. | The other keys may narrow the route in effect, never widen it. | project.schema.md | — |
| S2.release.10 | default |  | `candidates: auto` is a narrowing to `off`; `auto` where the route cuts none is a failure (`none`, `live`, `library-fast` and a fail-closed descriptor reject it). | `auto` where the route cuts none is a | project.schema.md | — |
| S2.release.11 | default |  | `candidates-per-day` is a positive whole number and an opt-in cap; no route carries one by default, and on a route with no candidates it is a failure. | a positive whole number, an **opt-in** cap. | project.schema.md | #443 |
| S2.release.12 | default |  | With a declared `candidates-per-day`, inside the rolling 24h window `colab release cut --auto` is a no-op and the first run after it cuts main's head, never an older commit. | inside the rolling 24h window `colab release cut --auto` is a no-op | project.schema.md | #443 |
| S2.release.13 | default |  | `final: auto` to `human` is a narrowing; `final: auto` where the route says `human` is a failure. | `auto` where the route says `human` is a **failure**. | project.schema.md | — |
| S2.release.14 | default |  | `final: auto` on a `deploy-tag` route is never an override; only the operator's recorded `final-grant` lowers it. | where the final tag deploys production, no key *on its own* lowers that. | project.schema.md | — |
| S2.release.15 | default |  | `test-period` is a whole number of days `<N>d`; longer than `3d` narrows, shorter is a failure except `0d` where the final is a human act (no test period, #549), and on `library-fast` and `deploy-tag-fast` any value is a failure. | Longer than `3d` narrows; shorter is a | project.schema.md | — |
| S2.release.16 | default |  | `guard-run`, `guard-result` and `exports` add evidence to the computed version, never permission; each must be a non-empty string. | **Three keys add evidence to the computed version, never permission** | project.schema.md | #422 |
| S2.release.17 | default |  | `guard-run` is a command that prints one JSON object `{"breaking": true\|false, "findings": [string]}`, run at the repo root with `COLAB_RELEASE_FROM` / `COLAB_RELEASE_SHA` set. | a command `colab release cut --auto` runs at the repo root | project.schema.md | #422 |
| S2.release.18 | default |  | `guard-result` names a file in the same shape written by an earlier CI step; declaring both `guard-run` and `guard-result` is a failure. | One   detector or the other: declaring both is a failure. | project.schema.md | #422 |
| S2.release.19 | default |  | `exports` is a committed list of public symbols, one per line; a line removed since the last final tag is a breaking change. | a line removed since the last final | project.schema.md | #422 |
| S2.release.20 | hard | tools/lib/release-cut.js::guard: UNREAD | A guard that cannot be read refuses the cut. | A guard that cannot be read refuses the cut | project.schema.md | #422 |
| S2.release.21 | default |  | `npm` and `npm-gate` opt a `public-tool` repo into publishing to npm; `npm` is the package directory relative to the repo root whose `package.json` must name a package and not be `"private": true`. | Two keys opt a `public-tool` repo into publishing to npm | project.schema.md | #433 |
| S2.release.22 | default |  | `npm-gate` is required with `npm`: the command run at the repo root after the version stamp and before every `npm publish` that fails when the tarball would carry an unintended file. | It is not optional | project.schema.md | #433 |
| S2.release.23 | default |  | `npm` and `npm-gate` are a pair (one without the other is a failure), fit only the `public-tool` route, and a directory outside the repo is a failure. | one without the other is a **failure** | project.schema.md | #433 |
| S2.release.24 | default |  | Absent `npm`/`npm-gate` means nothing publishes to npm. | Absent, nothing publishes to npm. | project.schema.md | #433 |
| S2.release.25 | default |  | `version-source` is `manifest` or `tag` and only decides which file the tag's version lives in; it narrows and widens nothing. | It narrows and widens nothing; it only decides which file the number lives in. | project.schema.md | #438 |
| S2.release.26 | default |  | The `version-source` default is `tag` wherever the machine cuts the tag and `manifest` wherever a person cuts it, read from the route as narrowed; a declared value always wins and an invalid one is a finding. | A declared value always wins, in either direction; an invalid one is a | project.schema.md | #484 |
| S2.release.27 | hard | tools/lib/release-cut.js::manifest-version | With `version-source: manifest`, every declared manifest must already equal the tag at the tagged commit or `colab release cut` / `finalize` refuse at `manifest-version`. | must already equal the tag at the tagged commit, or `colab release cut` | project.schema.md | — |
| S2.release.28 | default |  | With `version-source: tag`, manifests are derivable (`manifest-version` skips and names a differing one); the repo's own release or deploy step stamps the number, never as a commit on trunk, and an unreadable manifest still refuses. | never as a commit on trunk**, which the release workflow never pushes. | project.schema.md | — |
| S2.release.29 | default |  | `final-grant` lets an operator make one `deploy-tag` repo's final automatic; the default stays that a final tag that deploys production is a human act. | **`final-grant` lets an operator make one `deploy-tag` repo's final automatic** | project.schema.md | #441 |
| S2.release.30 | default |  | `final-grant` is a decision issue's number, valid only on the `deploy-tag` route of a `deploy: tag` repo, with `final: auto`; anywhere else it is a failure and `deploy: manual` stays human. | anywhere else it is a **failure** | project.schema.md | #441 |
| S2.release.31 | default |  | The `final-grant` decision issue must carry the `decision-recorded` label and a live `⚖ Decision recorded` comment by a trusted human, checked on every read; otherwise the audit fails and finalize falls back to the human final. | must carry the `decision-recorded` label and a live | project.schema.md | #441 |
| S2.release.32 | default |  | `final-grant` is revocable at once by deleting the line, `final: human`, or `colab decision <N> --reopen`. | Deleting the line, or `final: human`, revokes it | project.schema.md | #441 |
| S2.release.33 | default |  | An agent never writes `final-grant`; it is the operator's choice, transcribed. | **An agent never writes it.** | project.schema.md | #441 |
| S2.release.34 | default |  | `deploy-tag-fast` stands only with `final-grant`, `health-url` and `rollback: auto`; it has no candidate and no test period, and `final: human` on it is a failure. | the route stands only with all of them | project.schema.md | #446 |
| S2.release.35 | default |  | On `deploy-tag-fast`, `final-grant` needs no `final: auto` beside it, because the route itself is the automatic final. | On this route it needs no `final: auto` beside it | project.schema.md | #446 |
| S2.release.36 | default |  | `health-url` is an absolute `https://` URL the release workflow polls after the deploy until it reports the version; anything else is a failure. | Anything else is a **failure**. | project.schema.md | #446 |
| S2.release.37 | default |  | `rollback: auto` is the only accepted value, the operator's statement that the deploy restores the previous version by itself when the check fails. | the only accepted value | project.schema.md | #446 |
| S2.release.38 | default |  | Missing any of `final-grant`, `health-url` or `rollback: auto` makes the `deploy-tag-fast` route a failure, the derived `deploy-tag` stays in effect, and the final stays human. | it fails closed, never into an untested automatic deploy | project.schema.md | #446 |
| S2.release.39 | default |  | `deploy-tag-fast` is accepted only on `deploy: tag`; `deploy: manual` and a no-production repo reject it. | Only on `deploy: tag`: `deploy: manual` and a no-production repo reject it | project.schema.md | #446 |
| S2.release.40 | default |  | `final-spacing` is `<N>h` or `<N>d` with default and floor `1h`, keeping two finals at least that far apart; shorter, `0h` or a minute value is a failure. | Shorter, `0h` or a minute value is a **failure**. | project.schema.md | #446 |
| S2.release.41 | default |  | `rollback` and `final-spacing` on any other route are a failure, and so are `candidates`, `candidates-per-day` and `test-period` on `deploy-tag-fast`. | on any other route are a **failure**, and so are `candidates` | project.schema.md | #446 |
| S2.release.42 | default |  | The `deploy-tag-fast` gates it keeps — trunk CI green, no `release-hold`, no ungranted migration since the last final — are stated in CONVENTIONS §6. | no `release-hold`, no ungranted migration since the last final | project.schema.md | #446 |
| S2.release.43 | default |  | `health-url` on `deploy-tag` is optional and grants nothing; it names the URL the container deploy waits on, with the same absolute-`https://` shape rule. | On route `deploy-tag` (`deploy: tag` or `deploy: manual`) `health-url` is optional and grants nothing | project.schema.md | #452 |
| S2.release.44 | default |  | `health-url` on a route nothing deploys from (`public-tool`, `rapid-app`, `library-fast`, `none`, `live`) is a failure. | On a route nothing deploys from | project.schema.md | #452 |
| S2.release.45 | default |  | A workflow running the container deploy with no `health-url` declared and no `HEALTH_URL` set in the copy is an audit advisory. | is an audit **advisory** | project.schema.md | #452 |
| S2.release.46 | default |  | An unknown `release` sub-key, a value outside its set, or a scalar `release:` is a failure. | An unknown sub-key, a value outside its set, or a scalar `release:` is a failure too. | project.schema.md | — |
| S2.release.47 | default |  | No `release` key picks or approves a version number; every number is computed, majors included, and a major without a migration section carrying its measured cost is refused. | **No key picks or approves a version number** | project.schema.md | — |
| S2.release.48 | default |  | `tools/lib/release-policy.js` is the one executable version of the release tables; if this page and that module disagree, the module runs and the drift is reported. | If this page and that module ever disagree, the module is what runs; report the drift. | project.schema.md | #338 |

### `generated` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.generated.01 | default |  | `generated` lists path globs that are regenerated, not authored; a sync-merge conflict confined to them is resolvable by the repo's `.colab/hooks/pre-ship` regen step, on a single branch's sync and inside a `ship --batch` build. | Path globs that are **regenerated, not authored** | project.schema.md | #387 |
| S2.generated.02 | default |  | `generated` extends the built-in default set (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `composer.lock`, `Cargo.lock`, `go.sum`, `dist/`, `build/`, `public/build/`, `.astro/`). | Extends the built-in default set | project.schema.md | — |

### `live-env` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.live-env.01 | default |  | `live-env: none` declares the repo's tests read no live environment and is the only way to skip code-wrap A3's hermetic second test run (`colab gate-hermetic`). | It is the only way to skip the | project.schema.md | #403 |
| S2.live-env.02 | default |  | Absent `live-env` means the hermetic second run happens; the default is the check, not the exemption. | **Absent means the run happens** | project.schema.md | #403 |
| S2.live-env.03 | default |  | `none` is the only `live-env` value; anything else is a finding and is read as absent. | **`none` is the only value.** Anything else is a finding. | project.schema.md | — |
| S2.live-env.04 | default |  | Only trunk's `live-env` value counts: `colab gate-hermetic` reads it from `origin/<trunk>` (else local `<trunk>`), never from the branch being gated. | **Only trunk's value counts.** | project.schema.md | — |
| S2.live-env.05 | default |  | Declare `live-env` only when it is true and cheap to keep true; a suite too slow to run twice should be split rather than opted out. | **Declare it only when it is true, and cheap to keep true.** | project.schema.md | — |
| S2.live-env.06 | default |  | The one reading of `live-env` is `tools/lib/hermetic.js` `parseLiveEnv`. | The one reading is `tools/lib/hermetic.js` `parseLiveEnv` | project.schema.md | — |
| S2.live-env.07 | explanation |  | Why the hermetic run exists: a test read its author's home config and a local fleet daemon and was green locally and red on CI (moved to the ADR). | Why the run exists: a test read its author's home config | docs/adr/539-schema-checks-and-gates-rationale.md | — |

### `tree-reuse` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.tree-reuse.01 | default |  | `tree-reuse: off` turns off the trunk half of the CI templates' `dedupe` guard; absent means reuse is on and a trunk push whose tree matches a green branch run skips the suite and cites that run. | Turns off the trunk half of the CI templates' `dedupe` guard | project.schema.md | #493 |
| S2.tree-reuse.02 | default |  | Declare `tree-reuse: off` when trunk's run proves something a branch run cannot (secrets only trunk gets, `github.ref` branching, unpinned runner image or toolchain, an audited trunk run). | **Declare `off` when trunk's run proves something a branch run cannot** | project.schema.md | #493 |
| S2.tree-reuse.03 | default |  | `off` is the only `tree-reuse` value; anything else is a finding, though the guard reads any `tree-reuse:` line as off. | **`off` is the only value.** Anything else is a finding. | project.schema.md | #493 |
| S2.tree-reuse.04 | default |  | The `dedupe` guard reads `tree-reuse` at the pushed sha, so the declaration that counts is the one that landed with that commit. | **Read at the pushed sha.** | project.schema.md | #493 |
| S2.tree-reuse.05 | default |  | Trunk-only jobs (publish, deploy, release) are never gated by the `dedupe` guard, whatever `tree-reuse` says. | Trunk-only jobs (publish, deploy, release) are never gated by the guard | project.schema.md | #493 |
| S2.tree-reuse.06 | default |  | The one reading of `tree-reuse` in tooling is `tools/lib/tree-green.js` `parseTreeReuse`. | The one reading in tooling is `tools/lib/tree-green.js` `parseTreeReuse` | project.schema.md | #493 |

### `ship-gate-workflows`, `ship-ignore-workflows` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.ship-workflows.01 | default |  | `ship-gate-workflows` / `ship-ignore-workflows` choose which workflow runs at a sha count as its CI for `colab ship`'s CI gate, `colab trunk-ci` and `colab ci-wait --sha`. | Which workflow runs at a sha count as **its CI** | project.schema.md | #503 |
| S2.ship-workflows.02 | default |  | Absent, the runs that verify the code (triggered by `push`, `pull_request`, `pull_request_target` or `merge_group`) count, and every run of another trigger at the same sha is set aside and named in the verdict. | **Absent means the runs that verify the code count** | project.schema.md | #503 |
| S2.ship-workflows.03 | default |  | `ship-gate-workflows` is the explicit set: exactly these workflows count, whatever their trigger; declare it when a verifying workflow is not push-triggered. | Exactly these workflows count, whatever their | project.schema.md | #503 |
| S2.ship-workflows.04 | default |  | `ship-ignore-workflows` sets named workflows aside even when push-triggered; a name in both lists is set aside. | A name in both lists is set aside. | project.schema.md | #503 |
| S2.ship-workflows.05 | default |  | Values are workflow names (the file's `name:`); a single string is a one-item list; an empty list or a non-string entry is a finding and the reader applies the default. | Values are workflow **names** | project.schema.md | #503 |
| S2.ship-workflows.06 | default |  | A run with no recorded trigger is counted. | A run with no recorded trigger (an older read) is counted. | project.schema.md | #503 |
| S2.ship-workflows.07 | default |  | `ship-gate-workflows` is not the refused `ci` field: it says which runs the ship gate reads, never what CI is or how thorough it must be. | this says which runs the   ship gate reads | project.schema.md | #503 |
| S2.ship-workflows.08 | default |  | The one reading of the ship workflow lists is `tools/lib/verify-runs.js` `parsePolicy`. | The one reading in tooling is `tools/lib/verify-runs.js` `parsePolicy` | project.schema.md | #503 |

### `gate` — optional

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.gate.01 | default |  | With `gate.authoritative: ci`, code-wrap A3 runs `smoke` once with no hermetic second pass and pushes, and the verdict is the branch-CI run at the pushed head sha, which `code-ship` reads instead of re-running tests locally. | With `authoritative: ci`, `code-wrap` A3 runs | project.schema.md | #410 |
| S2.gate.02 | default |  | Absent, or `authoritative: local`, means the local full gate plus `colab gate-hermetic`. | means today's gate exactly | project.schema.md | #410 |
| S2.gate.03 | default |  | `authoritative: ci` takes effect only where a workflow fires on a push to a session branch (`tools/lib/gate.js` `gateMode`); otherwise the repo stays on the local gate and the audit warns. | stays on the local gate however it is declared | project.schema.md | #410 |
| S2.gate.04 | default |  | For `authoritative: ci` the workflow must also run the tests, on a runner that does not share a developer's machine. | the workflow runs the tests, on a runner | project.schema.md | #408 |
| S2.gate.05 | default |  | `gate` is a block, not an inline map; `smoke` is required, `authoritative` is `ci` or `local`, any other key is a finding, and every defect is read as absent while the audit fails it. | `gate: { smoke: … }` is not parsed by this descriptor's readers | project.schema.md | #410 |
| S2.gate.06 | default |  | A `#` in the `smoke` command starts a comment; wrap a command that needs one in a script. | A `#` in the command starts a comment | project.schema.md | #410 |
| S2.gate.07 | default |  | Only trunk's `gate` value counts, so a branch cannot move its own verdict to CI. | a branch cannot move its own verdict to CI. | project.schema.md | #410 |
| S2.gate.08 | default |  | The one reading of `gate` is `tools/lib/gate.js` `parseGate`. | The one reading is `tools/lib/gate.js` `parseGate` | project.schema.md | #410 |

### `node`, `php`, `python` — optional toolchain pins

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.toolchain.01 | default |  | `node`, `php` and `python` declare explicit toolchain versions that win over the ecosystem manifest per CONVENTIONS §7. | Explicit toolchain versions. These **win** over the ecosystem manifest | project.schema.md | — |
| S2.toolchain.02 | default |  | Use a toolchain pin only when the manifest cannot express the truth, or for a deliberate pin; the manifest is the normal answer. | Use only when the manifest cannot express the truth | project.schema.md | — |
| S2.toolchain.03 | default |  | If neither the pin nor the manifest declares a version, CI must fail, not guess. | CI must fail, not guess. | project.schema.md | — |
| S2.toolchain.04 | default |  | `requirements.txt` is not a manifest for the Python interpreter; a Python repo carrying only one must set `python:` or add a `.python-version`. | it must set `python:` here or | project.schema.md | — |
| S2.toolchain.05 | default |  | When a pin contradicts the manifest, the audit reports it; a disagreement is a finding to surface, not to auto-resolve. | a disagreement is a finding to surface, not to auto-resolve. | project.schema.md | — |

### Examples

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.examples.01 | default |  | `tier` is optional, so a descriptor declared purely by axis (`exposure: released`, non-null `production`, committed deploy path) is legal on its own; add `tier: A` only if something outside the handbook still reads it. | `tier` is optional precisely so this is legal on its own | project.schema.md | #144 |
| S2.examples.02 | default |  | `writes` and `room` are independent axes: `writes: serial` never implies `room: solo`. | `writes: serial` never implies `room: solo`. | project.schema.md | — |

### Validity rules (what the audit tool checks)

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.validity.01 | default |  | A descriptor file must be present and parseable. | file present and parseable | project.schema.md | — |
| S2.validity.02 | default |  | Both `tier` and `exposure` absent is a finding, "no axis of record". | both absent → **finding**, "no axis of record" | project.schema.md | — |
| S2.validity.03 | default |  | `tier` and `exposure` both present and disagreeing about gate count is a finding. | both present and disagreeing about gate count → **finding** | project.schema.md | — |
| S2.validity.04 | default |  | `tier` must be one of A, B, C when set. | `tier` ∈ {A, B, C}, when set | project.schema.md | — |
| S2.validity.05 | default |  | Legacy path (`tier` set, `exposure` absent) reproduces every tier rule below, byte for byte with pre-#144 behaviour. | **Legacy path** (`tier` set, `exposure` absent) | project.schema.md | #144 |
| S2.validity.06 | default |  | `tier: A` requires `trunk: dev`, non-null `production`, and `deploy` of `tag` or `manual`. | `tier: A` → `trunk: dev`, `production` non-null | project.schema.md | — |
| S2.validity.07 | default |  | `tier: A` with `deploy: push-main` is a finding pointing at tier C. | `tier: A` + `deploy: push-main` → **finding**, pointing at tier C | project.schema.md | — |
| S2.validity.08 | default |  | `tier: C` requires a trunk distinct from `main`, non-null `production`, `deploy: push-main`, and a deploy workflow. | `tier: C` → `trunk` a branch distinct from `main` | project.schema.md | — |
| S2.validity.09 | default |  | `deploy: tag` (or `push-main`) requires a deploy workflow to exist. | `deploy: tag` (or `push-main`) → a deploy workflow exists | project.schema.md | — |
| S2.validity.10 | default |  | `deploy: manual` requires `runbook:` set and the path to exist in the repo. | `deploy: manual` → `runbook:` set, and the path exists in the repo | project.schema.md | — |
| S2.validity.11 | default |  | `tier: B` requires `trunk: main`, `deploy: none` and `production: null`. | `tier: B` → `trunk: main`, `deploy: none`, `production: null` | project.schema.md | — |
| S2.validity.12 | default |  | Axis path (`exposure` set) governs regardless of whether `tier` is also set. | **Axis path** (`exposure` set — governs regardless of whether `tier` is also set) | project.schema.md | #144 |
| S2.validity.13 | default |  | `exposure: live` requires a trunk distinct from `main`, non-null `production`, `deploy: push-main` and a deploy workflow, with no `runbook:` escape hatch. | `exposure: live` → `trunk` a branch distinct from `main` | project.schema.md | — |
| S2.validity.14 | default |  | `exposure: released` shape 1 requires non-null `production`, `deploy` of `tag` or `manual`, a committed deploy path, and `trunk: dev` (or `main` only when `deploy: tag`). | `exposure: released`, shape 1 → `production` non-null | project.schema.md | — |
| S2.validity.15 | default |  | `exposure: released` shape 2 requires `production: null`, `trunk: main`, `deploy` absent or `none`, and a version-shaped tag or `channels: [artifact]`. | `exposure: released`, shape 2 → `production: null` | project.schema.md | — |
| S2.validity.16 | default |  | `exposure: none` requires `trunk: main` and no committed deploy workflow (a named `production` alone stays clean). | `exposure: none` → `trunk: main` + no committed deploy workflow | project.schema.md | — |
| S2.validity.17 | default |  | `exposure: self` has no rule at all. | `exposure: self` → no rule at all | project.schema.md | — |
| S2.validity.18 | default |  | The declared `trunk` branch must actually exist. | declared `trunk` branch actually exists | project.schema.md | — |
| S2.validity.19 | default |  | Every `integration` entry must exist and must not be `trunk`, `main` or the word `trunk`. | every `integration` entry exists, and is not `trunk` / `main` | project.schema.md | — |
| S2.validity.20 | default |  | A declared `releaseBranch` must exist and must not be `trunk`, `main` or the word `trunk`. | declared `releaseBranch` exists, and is not `trunk` / `main` | project.schema.md | — |
| S2.validity.21 | default |  | A declared `owner` must have a `branch`, only `branch`/`remote` sub-keys, and a branch that is not trunk, an `integration` line or the `releaseBranch`. | declared `owner` has a `branch`, only `branch`/`remote` sub-keys | project.schema.md | #394 |
| S2.validity.22 | default |  | A toolchain pin must agree with the manifest. | toolchain pin vs manifest agreement | project.schema.md | — |
| S2.validity.23 | default |  | `ceremony` must be `standard` or `light` when set. | `ceremony` ∈ {`standard`, `light`} when set | project.schema.md | — |
| S2.validity.24 | default |  | `ceremony: light` must not be combined with `autonomy: auto-trunk`. | `ceremony: light` → not `autonomy: auto-trunk` | project.schema.md | — |
| S2.validity.25 | default |  | `writes` must be one of `free`, `direct`, `isolated`, `serial-direct`, `serial-gated`, `serial` when set. | `writes` ∈ {`free`, `direct`, `isolated`, `serial-direct`, `serial-gated`, `serial`} when set | project.schema.md | #233 |
| S2.validity.26 | default |  | `room` must be `solo`, `team` or `public` when set. | `room` ∈ {`solo`, `team`, `public`} when set | project.schema.md | — |
| S2.validity.27 | default |  | `branchPrefix` must be `machine` when set. | `branchPrefix` = `machine` when set | project.schema.md | — |
| S2.validity.28 | default |  | `ship-batch` must be an integer 1-8 when set, else a finding. | `ship-batch` an integer 1–8 when set | project.schema.md | — |
| S2.validity.29 | default |  | `ship-batch` > 1 with no workflow firing on a `ship-batch/**` push, or without `autonomy: auto-trunk`, is an advisory. | `ship-batch` > 1 with no workflow firing on a `ship-batch/**` push | project.schema.md | — |
| S2.validity.52 | default |  | `ship-batch-steps` must be strictly ascending whole numbers within `ship-batch` when set, else a finding. | `ship-batch-steps` strictly ascending whole numbers within `ship-batch` when set | project.schema.md | #557 |
| S2.validity.53 | default |  | `ship-batch-steps` with `ship-batch` absent or 1 is an advisory. | `ship-batch-steps` with `ship-batch` absent or 1 | project.schema.md | #557 |
| S2.validity.30 | default |  | `migrations` must be a list of repo-relative prefixes when set; an absolute path, `..`, glob, the repo root or a non-list is a finding. | `migrations` a list of repo-relative prefixes when set | project.schema.md | — |
| S2.validity.31 | default |  | `migrations` empty, restating a default, or naming one prefix twice is an advisory. | `migrations` empty, restating a default, or naming one prefix twice | project.schema.md | — |
| S2.validity.32 | default |  | A tracked `*/migrations/` directory outside the defaults and every declared prefix is an advisory (local only). | a tracked `*/migrations/` directory outside the defaults | project.schema.md | — |
| S2.validity.33 | default |  | `migration-grant` must be `human` or `reviewer` when set, else a finding. | `migration-grant` ∈ {`human`, `reviewer`} when set | project.schema.md | — |
| S2.validity.34 | default |  | `trust-humans` must be a non-empty list of GitHub logins when set, else a finding. | `trust-humans` a non-empty list of GitHub logins when set | project.schema.md | — |
| S2.validity.35 | default |  | `live-env` must be `none` when set, else a finding. | `live-env` = `none` when set | project.schema.md | #403 |
| S2.validity.36 | default |  | `tree-reuse` must be `off` when set, else a finding. | `tree-reuse` = `off` when set | project.schema.md | #493 |
| S2.validity.37 | default |  | `ship-gate-workflows` / `ship-ignore-workflows` must be a non-empty list of workflow names when set, else a finding. | `ship-gate-workflows` / `ship-ignore-workflows` = a non-empty list of workflow names | project.schema.md | #503 |
| S2.validity.38 | default |  | `gate` must be a block with `smoke` and `authoritative` of `ci` or `local` when set, else a finding; `ci` with no branch-push trigger is a warn. | `gate` a block with `smoke` + `authoritative` ∈ {`ci`,`local`} when set | project.schema.md | #410 |
| S2.validity.39 | default |  | `holds` must be a list of non-empty strings, each listed once, when set, else a finding. | `holds` is a list of non-empty strings, each listed once, when set | project.schema.md | — |
| S2.validity.40 | default |  | `exposure` must be `none`, `self`, `live` or `released` when set. | `exposure` ∈ {`none`, `self`, `live`, `released`} when set | project.schema.md | — |
| S2.validity.41 | default |  | `exposure: none` with `production: null` is an advisory. | `exposure: none` + `production: null` → **advisory** | project.schema.md | — |
| S2.validity.42 | default |  | `exposure: live` with `trunk: main` and no `writes: isolated` is an advisory. | `exposure: live` + `trunk: main` + no `writes: isolated` → **advisory** | project.schema.md | #233 |
| S2.validity.43 | default |  | `channels` must be a list whose members are `workflow`, `hook`, `procedure`, `checkout`, `artifact`, `data` or `none` when set. | `channels` is a list, each member ∈ | project.schema.md | — |
| S2.validity.44 | default |  | `channels` must contain no duplicate member, else a finding. | `channels` contains no duplicate member → **finding** | project.schema.md | — |
| S2.validity.45 | default |  | `channels: [none]` combined with another member, or `channels: []`, is a finding. | `channels: [none]` combined with another member, or `channels: []` | project.schema.md | — |
| S2.validity.46 | default |  | `channels: [none]` with a non-null `production` or `deploy` other than `none` is an advisory. | `channels: [none]` + (`production` non-null or `deploy` ≠ `none`) | project.schema.md | — |
| S2.validity.47 | default |  | `distribution` must be `js` or `compiled` when set, else a finding. | `distribution` ∈ {`js`, `compiled`}, when set | project.schema.md | #469 |
| S2.validity.48 | default |  | `distribution` declared with no install route §6 recognises for its row is an advisory. | `distribution` declared, but no install route §6 recognises | project.schema.md | #469 |
| S2.validity.49 | default |  | `release` must be a one-level block of `candidates`, `test-period` and `final` with valid values and no other sub-key. | `release` is a one-level block of `candidates` | project.schema.md | — |
| S2.validity.50 | default |  | `release` widening its derived default (candidates auto where none are cut, final auto where the final tag is a human act, test-period under 3d except 0d on a human final) is a finding. | `release` widening its derived default | project.schema.md | — |
| S2.validity.51 | default |  | `route: deploy-tag-fast` without a resolvable `final-grant`, `health-url` and `rollback: auto`, or whose release workflow deploys nothing from the final it tags, is a finding. | `route: deploy-tag-fast` without a resolvable `final-grant` | project.schema.md | #446 |

### Validity rules — trailing notes

| id | class | gate | rule | key | dest | source |
|---|---|---|---|---|---|---|
| S2.validity-notes.01 | default |  | `push-main` on a Tier A repo is a finding (a mismatch between mechanism and the tier's contract); the usual fix is `tier: C` rather than any pipeline change; on Tier B it is caught by the `deploy: none` rule. | `push-main` on a Tier A repo **is a finding** | project.schema.md | — |
| S2.validity-notes.02 | default |  | On Tier C a wrong `deploy` value is redirected: `tag` and `manual` point back to A, `none` points to B. | `tag` and `manual` both point back to A | project.schema.md | — |
| S2.validity-notes.03 | default |  | The `runbook:` path is verified against a local working tree; through the GitHub API a miss is reported as an advisory instead of a violation. | a miss is reported as an advisory instead of a violation. | project.schema.md | — |

#### #539 ledger — Slice G (§9 adoption, §10 anti-patterns, project.schema.md)

- `CONVENTIONS.md:5048` — before: "Questions 1 and 3 decide the gate count; 2, 4 and 5 are optional in the schema and legal absent — `room` only tunes how verbose the trail is, `writes` absent already reads as the common `free`, and `channels` is descriptive (and easy to mis-answer `workflow` on a repo that merely has CI)." → after: "Questions 1 and 3 decide the gate count; 2, 4 and 5 are optional in the schema and legal absent.". Rationale → `docs/adr/539-adoption-first-time-rationale.md`. Rows: C9.first-time.04.
- `CONVENTIONS.md:5065` — before: "Question 1 writes `production` and `deploy`, never `tier` directly — `tier` is a pure function of those two answers (`tools/lib/adopt.js:deriveTier`: no production → `B`; production + `push-main` → `C`; production + `tag`/`manual` → `A`), so asking for the letter directly would be asking for a value that is always derivable from a more basic answer already on record — the same drift-by-redundancy this whole model exists to stop." → after: "Question 1 writes `production` and `deploy`, never `tier` directly — `tier` is a pure function of those two answers (`tools/lib/adopt.js:deriveTier`: no production → `B`; production + `push-main` → `C`; production + `tag`/`manual` → `A`).". Rationale → `docs/adr/539-adoption-first-time-rationale.md`. Rows: C9.first-time.08.
- `CONVENTIONS.md:5071` — before: "Question 3 is phrased this way — never 'who consumes this?' — per the ruling on #128: the person answering is standing in the repo, not reading a schema, and 'what breaks' is the question they can actually answer." → after: "Question 3 is phrased this way — never 'who consumes this?'.". Rationale → `docs/adr/539-adoption-first-time-rationale.md`. Rows: C9.first-time.09 (key updated).
- `CONVENTIONS.md:5079` — before: "Every one of these follows from the answers above; a checklist that also prompts for a derived value is exactly how the fields drift apart from each other again (the failure this whole model exists to stop)." → after: "Every one of these follows from the answers above.". Rationale → `docs/adr/539-adoption-first-time-rationale.md`. Rows: C9.first-time.11.
- `CONVENTIONS.md:5084` — before: "— same five questions, same wording, at sync time ('Predates an axis', `handbook-sync`). Building this once and pointing both moments at it is the point; do not let a sync grow its own paraphrase of these five rows." → after: "— same five questions, same wording, at sync time ('Predates an axis', `handbook-sync`); do not let a sync grow its own paraphrase of these five rows.". Rationale → `docs/adr/539-adoption-first-time-rationale.md`. Rows: C9.first-time.12, C9.first-time.13.
- `CONVENTIONS.md:5103` — before: "**The five questions above are asked as forced numbered menus (#283)**, not free text — every option is answerable by its number or its literal value — and `exposure` is the only one of the five that carries a skip option (its own fallback, deriving `tier` instead, is a real fallback that consumes the absence; the other four have none, so declining them would just recreate #282's shape under a different row)." → after: "**The five questions above are asked as forced numbered menus (#283)**, not free text — every option is answerable by its number or its literal value — and `exposure` is the only one of the five that carries a skip option.". Rationale → `docs/adr/539-adoption-first-time-rationale.md`. Rows: C9.first-time.18, C9.first-time.19, C9.first-time.20, C9.first-time.21.
- `CONVENTIONS.md:5170` — before: "— **none checkable against the others except the one pinned assertion in `tools/lib/labels-ensure-cli.test.js`.** #274: adding `delivery:elsewhere` left three of the four wrong until found by hand. … What each absence costs, briefly: `in-progress` — the first claim cannot land. `deps-checked` — a readiness check can never tell *free* from *nobody looked*. `agent-filed` — every agent-filed issue reports as human-approved. `epic` — an epic passes every readiness gate and reads as a normal start candidate. `needs-decision` — the blocking-question gate cannot be applied at all. `decision-recorded` — a recorded answer has no positive marker to distinguish it from a label nobody ever applied, so the next mechanical pass re-gates settled work (measured: #127). `needs-plan` — `code-start` always sees 'no flag', every session falls back to rung 1. `migration-granted`/`ci-granted` are **not opt-in …" → after: "— **none checkable against the others except the one pinned assertion in `tools/lib/labels-ensure-cli.test.js`.** … (sentence removed)". Rationale → `docs/adr/539-adoption-first-time-rationale.md`. Rows: C9.first-time.33, C9.first-time.34.
- `CONVENTIONS.md:5198` — before: "**Do not skip this** — it is the only reason a future agent discovers these conventions." → after: "**Do not skip this**.". Rationale → `docs/adr/539-adoption-first-time-rationale.md`. Rows: C9.first-time.36.
- `CONVENTIONS.md:5219` — before: "**A fork of an upstream you don't own does not take this shape** — the thin-shell conversion would rewrite a file the upstream keeps editing." → after: "**A fork of an upstream you don't own does not take this shape**.". Rationale → `docs/adr/539-adoption-first-time-rationale.md`. Rows: C9.first-time.41.
- `CONVENTIONS.md:5254` — before: "**Add `dev` to every CI workflow's trigger branches** — CI that still gates only `main` runs zero checks on your actual work." → after: "**Add `dev` to every CI workflow's trigger branches**.". Rationale → `docs/adr/539-adoption-tier-transitions-rationale.md`. Rows: C9.going-live.05.
- `CONVENTIONS.md:5268` — before: "Step 1 comes first because `main` only becomes meaningful once something consumes it — what must not exist is a `main` that nothing and nobody reads." → after: "Step 1 comes first.". Rationale → `docs/adr/539-adoption-tier-transitions-rationale.md`. Rows: none keyed.
- `CONVENTIONS.md:5273` — before: "Do this when you find yourself *wanting* to name what shipped — not before, since an unused tag ritual decays exactly like an unused branch." → after: "Do this when you find yourself *wanting* to name what shipped — not before.". Rationale → `docs/adr/539-adoption-tier-transitions-rationale.md`. Rows: C9.c-to-a.01.
- `CONVENTIONS.md:5276` — before: "**Retrigger the deploy workflow on a tag** instead of a `main` push — the whole change; until it lands, the tier claim would be false." → after: "**Retrigger the deploy workflow on a tag** instead of a `main` push — the whole change.". Rationale → `docs/adr/539-adoption-tier-transitions-rationale.md`. Rows: C9.c-to-a.02.
- `CONVENTIONS.md:5374` — before: "A PR per issue that the owner merges one by one is a different shape, deferred until a repo asks for it; the measured case wants the batch." → after: "A PR per issue that the owner merges one by one is a different shape, deferred until a repo asks for it.". Rationale → `docs/adr/539-adoption-repo-you-dont-own-rationale.md`. Rows: C9.not-your-repo.25.
- `CONVENTIONS.md:5385` — before: "The audit reports an ungated integration branch as an advisory here, not a failure, because the fix would be a commit to his repo." → after: "The audit reports an ungated integration branch as an advisory here, not a failure.". Rationale → `docs/adr/539-adoption-repo-you-dont-own-rationale.md`. Rows: C9.not-your-repo.28.
- `CONVENTIONS.md:5414` — before: "Nothing is written to the descriptor: the remote is the fact, and a key would be a second copy of it that could drift." → after: "Nothing is written to the descriptor: the remote is the fact.". Rationale → `docs/adr/539-adoption-fork-rationale.md`. Rows: C9.fork.02, C9.fork.03.
- `CONVENTIONS.md:5496` — before: "Neither is a reason to relax the rule above: the rule is the control, and both mechanisms are backstops for the day somebody forgets it." → after: "Neither is a reason to relax the rule above.". Rationale → `docs/adr/539-adoption-fixtures-rationale.md`. Rows: C9.fixtures.06, C9.fixtures.07, C9.fixtures.08.
- `project.schema.md:41` — before: "The normal path — `exposure` answered — never writes `tier` at all: nothing in `tools/colab` reads it, and a redundant key a later hand-edit can contradict is exactly the drift this axis exists to end." → after: "The normal path — `exposure` answered — never writes `tier` at all: nothing in `tools/colab` reads it.". Rationale → `docs/adr/539-schema-tier-rationale.md`. Rows: S1.tier.10, S1.tier.11, S1.tier.12, S1.tier.13.
- `project.schema.md:56` — before: "B` carries no derivable opinion about what consumes it (`none`, `self` and `released` are all measured under `B` in this fleet), so nothing may guess which one it means." → after: "B` carries no derivable opinion about what consumes it, so nothing may guess which one it means.". Rationale → `docs/adr/539-schema-tier-rationale.md`. Rows: S1.tier.16.
- `project.schema.md:64` — before: "**`exposure` does NOT become required by this unit.** 16 of 17 repos in this handbook's own fleet have never declared it, and they see zero change: the legacy read reproduces pre-#144 behaviour byte for byte." → after: "**`exposure` does NOT become required by this unit.**". Rationale → `docs/adr/539-schema-tier-rationale.md`. Rows: S1.tier.18.
- `project.schema.md:84` — before: "The three fields that follow are worded in `tier`'s vocabulary because that was, historically, the only axis that constrained them, and the wording is kept for the descriptors that still speak only `tier`. But the rule that is actually enforced is dispatched by axis of record, not always by `tier`: on a descriptor that has declared `exposure`, the tier-voiced coherence checks below **do not run at all** — `exposure`'s own gate-contract table, in `exposure` below, is what governs trunk shape, `production`'s non-null-ness, and `deploy`'s legal values instead (`tools/lib/exposure-shape.js`, consumed by both the audit and `colab adopt`; the split point is `tools/lib/axis-authority.js`, whose own comment names it:" → after: "The rule that is actually enforced is dispatched by axis of record, not always by `tier`: on a descriptor that has declared `exposure`, the tier-voiced coherence checks below **do not run at all** — `exposure`'s own gate-contract table, in `exposure` below, is what governs trunk shape, `production`'s non-null-ness, and `deploy`'s legal values instead (`tools/lib/exposure-shape.js`, consumed by both the audit and `colab adopt`; the split point is `tools/lib/axis-authority.js`, whose own comment names it:". Rationale → `docs/adr/539-schema-tier-rationale.md`. Rows: S1.tier.22, S1.tier.23.
- `project.schema.md:110` — before: "It answered the question the same way `dev` would have. … Tier A keeps a fixed value, and Tier B's single trunk may never sit beside a `main`, because there either is no second branch at all, or the tag itself already marks the release boundary. Only the one-gate shape (Tier C) has a second branch whose *existence*, not its *spelling*, is what the model measures." → after: "(sentence removed) … Tier A keeps a fixed value, and Tier B's single trunk may never sit beside a `main`.". Rationale → `docs/adr/539-schema-trunk-deploy-rationale.md`. Rows: S1.trunk.07, S1.trunk.08, S1.trunk.09, S1.trunk.10, S1.trunk.11.
- `project.schema.md:126` — before: "This holds for hand-deployed Tier A repos too (`deploy: manual`), and the shape earns its keep there rather than being ceremony: `main` is **what is currently running on the host**, `dev` is where sessions land, and the `dev` → `main` promotion is the deliberate 'I am about to deploy' act. Without automation, that merge is the only record of what shipped and when — collapsing the two branches would erase it." → after: "This holds for hand-deployed Tier A repos too (`deploy: manual`).". Rationale → `docs/adr/539-schema-trunk-deploy-rationale.md`. Rows: S1.trunk.12.
- `project.schema.md:133` — before: "Tier C keeps the identical split for the identical reason, whatever its trunk is named. There `main` is literally what is live — the promotion deploys it — so collapsing the branches would remove the only moment at which anyone decides to ship." → after: "Tier C keeps the identical split, whatever its trunk is named.". Rationale → `docs/adr/539-schema-trunk-deploy-rationale.md`. Rows: S1.trunk.13 (key updated).
- `project.schema.md:176` — before: "`push-main` describes a real mechanism truthfully: for the repos using it, pushing `main` really does deploy. It has a home — **tier C is exactly this shape** — and the finding is on the **combination** `tier:" → after: "`push-main` has a home — **tier C is exactly this shape** — and the finding is on the **combination** `tier:". Rationale → `docs/adr/539-schema-trunk-deploy-rationale.md`. Rows: S1.deploy.10.
- `project.schema.md:270` — before: "**Why this is not `trunk`.** The tempting alternative is to let a repo declare its long-lived line as trunk and be done. That does not stay on the development side of the fence: on Tiers A and C, `trunk` **is** the production spine — it is the branch `colab promote` merges into the release branch. Naming the line as trunk points the promotion path straight at it, which is the opposite of the intent. So `trunk` stays tier-locked (above) and this is a separate axis." → after: "`trunk` stays tier-locked (above) and this is a separate axis.". Rationale → `docs/adr/539-schema-lines-and-hosts-rationale.md`. Rows: none keyed.
- `project.schema.md:539` — before: "There is deliberately no opt-out of the defaults: an opt-out can only make a human-only gate see *less*, and that waits for a repo that genuinely needs it." → after: "There is deliberately no opt-out of the defaults.". Rationale → `docs/adr/539-schema-migrations-and-grants-rationale.md`. Rows: S1.migrations.06.
- `project.schema.md:656` — before: "Nothing infers a repo's room from its GitHub visibility, its `production:` value, or anything else — a wrong inference here is worse than an honest 'not yet answered.' The audit enum-checks the value for typos exactly like `ceremony`/`writes` do, and nothing more: no downstream rule reads `room` yet." → after: "Nothing infers a repo's room from its GitHub visibility, its `production:` value, or anything else. The audit enum-checks the value for typos exactly like `ceremony`/`writes` do, and nothing more: no downstream rule reads `room` yet.". Rationale → `docs/adr/539-schema-checks-and-gates-rationale.md`. Rows: S1.room.03, S1.room.04, S1.room.05, S2.distribution.02.
- `project.schema.md:716` — before: "A repo that has **never** declared `exposure` sees zero change: the legacy `tier` read reproduces pre-#144 behaviour byte for byte, including every outside adopter of this public repo who has not opted in — verified empirically (a fleet-wide byte-diff), not merely designed for." → after: "A repo that has **never** declared `exposure` sees zero change: the legacy `tier` read reproduces pre-#144 behaviour byte for byte, including every outside adopter of this public repo who has not opted in.". Rationale → `docs/adr/539-schema-exposure-and-channels-rationale.md`. Rows: S2.exposure.01.
- `project.schema.md:759` — before: "`self` is defined against the `room` axis: the consumer set is a subset of the room's collaborator set — that definition points at nothing until `room` exists, which is why exposure was sequenced after it." → after: "`self` is defined against the `room` axis: the consumer set is a subset of the room's collaborator set.". Rationale → `docs/adr/539-schema-exposure-and-channels-rationale.md`. Rows: none keyed.
- `project.schema.md:766` — before: "Every other combination is clean, including `live`/`released` **with `production: null`** — a repo that ships by tag to real adopters and runs no server (this repo is exactly that shape) is not a finding; a rule that made it one would re-assert the 'exposure means a server' defect this axis exists to remove." → after: "Every other combination is clean, including `live`/`released` **with `production: null`** — a repo that ships by tag to real adopters and runs no server (this repo is exactly that shape) is not a finding.". Rationale → `docs/adr/539-schema-exposure-and-channels-rationale.md`. Rows: S2.exposure.07, S2.exposure.08.
- `project.schema.md:778` — before: "Finding one is a `warn` naming the evidence, never a `fail` — a repo released years ago and dead since is truthfully `exposure: none` today, tag and all, so this is a prompt to look again, not a contradiction proven. … `exposure: self` gets neither: it claims a consumer set bounded by the room, and a tag or deploy script is perfectly compatible with a team shipping to itself." → after: "Finding one is a `warn` naming the evidence, never a `fail`. … `exposure: self` gets neither.". Rationale → `docs/adr/539-schema-exposure-and-channels-rationale.md`. Rows: S2.exposure.09, S2.channels.14.
- `project.schema.md:795` — before: "Nothing infers a repo's exposure from its GitHub visibility, its `production:` value, its `tier`, or a deploy workflow — a wrong inference here is worse than an honest 'not yet answered,' and it is the concrete mechanism behind 'lowering a repo's exposure is a human act, with no field that can override it': the only path to a `none`/`self` value is a human committing the string, because every candidate value for an undeclared repo is a claim about the *absence* of a consumer, which nothing here can verify." → after: "Nothing infers a repo's exposure from its GitHub visibility, its `production:` value, its `tier`, or a deploy workflow: the only path to a `none`/`self` value is a human committing the string.". Rationale → `docs/adr/539-schema-exposure-and-channels-rationale.md`. Rows: S1.tier.21, S2.exposure.10, S2.exposure.11, S2.exposure.12, S2.distribution.02.
- `project.schema.md:987` — before: "A prior rule required `light` → `production: null`, reasoning that a live repo cannot skip its own audit trail. That welded two different questions together: whether a *trail* is ever read (the room), and what must exist to *undo* a change (exposure/irreplaceable state) — a `solo` repo's trail has one reader whether or not it is live, and a live `solo` repo that cannot roll back is a real hazard regardless of how much anyone narrates. The rule forbade the first case and was silent on the second, so a live single-operator repo could not declare `light` at all — pushing that shape toward an undeclared, informal light mode instead. Removed (#175); the one coherence rule that survives is the one that protects someone other than this repo's own room:" → after: "The one coherence rule that survives is the one that protects someone other than this repo's own room:". Rationale → `docs/adr/539-schema-ceremony-and-writes-rationale.md`. Rows: none keyed.
- `project.schema.md:1003` — before: "**[Hard — gate: colab solo refuses]** **`ceremony: light` no longer, by itself, enables solo flow.** #133 introduced `writes: serial` as solo flow's real gate and accepted `ceremony: light` as a LEGACY proxy only, for repos that had not yet answered the `writes` question. #175 removed that bridge. ⚖ #233 then re-based the gate itself:" → after: "**[Hard — gate: colab solo refuses]** **`ceremony: light` no longer, by itself, enables solo flow.** ⚖ #233 re-based the gate itself:". Rationale → `docs/adr/539-schema-ceremony-and-writes-rationale.md`. Rows: S2.ceremony.07, S2.ceremony.08.
- `project.schema.md:1037` — before: "`free` is coexistence, spelled out: it IS the state absence already named, given a name of its own because the old prompt had to tell a human to 'leave unanswered' for it." → after: "`free` is coexistence, spelled out: it IS the state absence already named.". Rationale → `docs/adr/539-schema-ceremony-and-writes-rationale.md`. Rows: S2.writes.03, S2.writes.04.
- `project.schema.md:1108` — before: "The correlation seen across today's fleet is caused by *who works a repo*, not by *what consumes it* — encoding that correlation as a rule would repeat the same weld `ceremony` was introduced to undo. No coherence rule is audited against `tier`/`production` for this reason; do not add one." → after: "No coherence rule is audited against `tier`/`production`; do not add one.". Rationale → `docs/adr/539-schema-ceremony-and-writes-rationale.md`. Rows: S2.writes.15 (key updated).
- `project.schema.md:1212` — before: "A route outside that set is a **failure**, and the derived route stays in effect — `public-tool` on a `deploy: tag` repo would hand a production deploy's final to a machine, and `deploy-tag` on a repo where nothing deploys describes a repo that does not exist." → after: "A route outside that set is a **failure**, and the derived route stays in effect.". Rationale → `docs/adr/539-schema-release-rationale.md`. Rows: S2.release.07, S2.release.08.
- `project.schema.md:1226` — before: "No route carries one by default (#443, reversing #439's derived cap of `1` on `rapid-app` and `public-tool`): the newest candidate always names trunk's head, and a cap of one kept four merges out of any tag for a day." → after: "No route carries one by default (#443, reversing #439's derived cap of `1` on `rapid-app` and `public-tool`).". Rationale → `docs/adr/539-schema-release-rationale.md`. Rows: S2.release.11, S2.release.12.
- `project.schema.md:1263` — before: "It is not optional: a publish with no gate is the stray-local-file leak the gate exists to stop." → after: "It is not optional.". Rationale → `docs/adr/539-schema-release-rationale.md`. Rows: S2.release.22 (key updated).
- `project.schema.md:1423` — before: "Without it, a push to trunk whose tree is byte-identical to the tree of a green `push` run of the same workflow on another ref of this repo skips the suite and cites that run — a squash merge lands exactly the tree its branch run passed, so re-running it adds no information and holds runners the branches need." → after: "Without it, a push to trunk whose tree is byte-identical to the tree of a green `push` run of the same workflow on another ref of this repo skips the suite and cites that run.". Rationale → `docs/adr/539-schema-checks-and-gates-rationale.md`. Rows: S2.tree-reuse.01.
- `project.schema.md:1526` — before: "A Python repo carrying only a `requirements.txt` has declared nothing about which Python it runs on, so it must set `python:` here or add a `.python-version` — the alternative is a hardcoded version in CI, which is the exact failure this precedence exists to prevent." → after: "A Python repo carrying only a `requirements.txt` has declared nothing about which Python it runs on, so it must set `python:` here or add a `.python-version`.". Rationale → `docs/adr/539-schema-checks-and-gates-rationale.md`. Rows: S2.toolchain.04.
- `project.schema.md:1677` — before: "| `exposure: live` + `trunk: main` + no `writes: isolated` → **advisory** (⚖ #233, replacing the dropped deploy-shape prohibition) | a trunk-direct commit reaching users immediately, with the descriptor never naming the one field that vetoes it — dormant by construction today (measured: this shape already fails the `exposure: live` mechanism rule above, zero instances across 40 adopted descriptors), shipped anyway as the one finding that names the remedy |" → after: "| `exposure: live` + `trunk: main` + no `writes: isolated` → **advisory** (⚖ #233, replacing the dropped deploy-shape prohibition) | a trunk-direct commit reaching users immediately, with the descriptor never naming the one field that vetoes it |". Rationale → `docs/adr/539-schema-checks-and-gates-rationale.md`. Rows: S2.validity.42.
