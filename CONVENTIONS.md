# Engineering Conventions

How we manage branches, releases, and in-flight work across every repo we own — in
our orgs and in personal accounts alike.

Written for **both humans and AI coding agents**. If you are an agent starting a session,
read this file and the repo's `.github/project.yml` before touching anything. Each word it
relies on is defined once, in the [Glossary](#glossary).

**This handbook decides outcomes, not implementations.** It tells you what must be true —
which branch work lands on, what a release is, how to claim an issue. It never tells you
which Node version to build with, which test runner to use, or what your CI file looks like.
Those belong to each repo. Where you see a command here, it illustrates a rule; it is not a
tool you must adopt.

> **Why enforcement is weak by design:** GitHub branch protection is unavailable on our
> private repos (`403 Upgrade to GitHub Pro`). We cannot make `main` unpushable. Nothing here
> is enforced by GitHub settings. Conformance is checked *from outside* by the audit tool
> ([§8](#8-conformance-and-reconciliation)), and otherwise rests on habit.

---

## 1. The model in one picture

> This handbook is not documentation. It is the **substitute for shared context between
> parties that cannot accumulate shared context.** Every rule exists because one party
> could not see what the other assumed.

Two corollaries follow from that, and later sections cite them rather than re-arguing:

1. **Humans fail by drift; agents fail by confident speed.** So the same sentence is a
   *reminder* to a human and must be a *rail* for an agent — anything guarding against
   agent failure has to be machine-checked, because an agent will never feel the
   hesitation that saves a human. Every rule this repo promoted from prose into tooling
   was promoted after an agent walked through the prose version at speed.
2. **A new axis is warranted when a class of context one party structurally cannot hold
   is not made visible by an existing axis** — not when a repo merely feels different.
   This test has already refused things: it is why deploy-channel visibility became
   part of an existing axis rather than a fourth one.

Which model a repo uses depends on **two questions: does it deploy to production, and
if so, what gates that deploy?**

```
TIER B — no production yet
  feat/<slug>-<issue> ──▶ main
                           │
                        your CI

TIER C — live; the promotion IS the deploy
  feat/<slug>-<issue> ──▶ dev ──▶ main
                           │       │
                        fast CI  deploy

TIER A — live; a tag deploys
  feat/<slug>-<issue> ──▶ dev ──▶ main ──▶ tag v1.2.0
                           │       │        │
                        fast CI  full CI  deploy
```

Count the gates between a merge and users: **B** has none (no production), **C**
has one (the promotion), **A** has two (the promotion, then the tag). C is A minus
the tag.

**Tier B is the default.** A repo starts here and stays here until something actually
consumes a release. Do not create `dev` "to be ready" — see [§10](#10-anti-patterns).

### Why the split exists at all

`main` in Tier A is a **pure release branch** — work is promoted to it, not landed on it.

**If your test suite is fast, you do not need Tier A.** Write the suite first, then split. Why: [ADR 539](docs/adr/539-tiers-rationale.md).

### Hard rules and defaults

**A rule is hard only when a gate enforces it.** A hard rule opens with a marker,
`**[Hard <id> — refuse: …]**`: its inventory id, then what must be refused, naming no tool —
an adopter proves its gate by citing the id in its own tests. It holds whatever a repo's local
policy says. Every other rule is a **default**: one way to do it, which a repo may refine
through a `project.yml` field where one exists, else in its local policy
(`.colab/skills/<skill>.md`, [§8](#local-policy--a-repo-refines-a-skill-without-forking-it-520)).
A refinement never lowers a hard rule. Until a repo refines a default, its wording stands as
written: a "must" is still a "must".

The hard set is short:

| Family | What refuses |
|---|---|
| A human go before a trunk merge | `colab ship`'s autonomy precondition; the pre-push guard on the trunk |
| A grant before a new migration ships | `colab ship`'s no-new-migrations precondition |
| Release never bundled into ship | `colab ship` never tags or promotes; the pre-push guard holds `main` and the release channels for `colab promote` / `colab release` or a human |
| A claim before work | `colab claim` and `colab worktree new` refuse a held issue; `colab ship` refuses an unclaimed branch |
| Evidence on the issue | `colab close` refuses an issue with no evidence comment |
| Publication guards | the secret-scan and identity-scan pre-commit hooks; the npm pack allowlist |

The rest of `colab ship`'s preconditions (trunk CI green and its cure rule and ci-grant
doors, core-path review), the place-claim and `writes: isolated` refusals, and a few
`colab adopt` refusals are gated too, and each is marked where it is stated. An older marker,
`**[Hard — gate: …]**`, names the command that refuses; it passes until its section is
rewritten. How a rule is enforced moves with the tool that enforces it: the `colab` CLI's
mechanics live in [`tools/docs/`](tools/docs/README.md), each under its rule's old heading here. Every rule's id and class is listed in [`docs/rule-inventory.md`](docs/rule-inventory.md);
`scripts/check-rule-inventory.mjs` keeps the list and this file in step. Why: [ADR 523](docs/adr/523-conventions-hard-default-and-size-budget.md).

---

## Glossary

Each word below is defined once, here, in the handbook's own terms; a later section links
here rather than redefining it. The definitions lean on no outside vocabulary. The last column
says what carries each thing on GitHub, the issue engine this handbook's tooling drives today —
an example, never the definition; its exact strings are in [`bindings/github.md`](bindings/github.md).

| Term | Meaning here | On GitHub today |
|---|---|---|
| **trunk** | The branch a repo's work lands on: the value of `trunk:` in the marker ([§3](#3-githubprojectyml--the-marker)). A role, never a branch name. | the default branch, or `dev` |
| **branch** | A named line of commits cut from trunk for one unit of work; its name ends in the issue number(s) it carries ([§4](#4-branches-and-commits)). | a git branch |
| **commit** | One recorded change to the files, with a message. Trunk gets one per unit of work, squashed. | a git commit |
| **change request** | A proposal to land a branch on trunk, reviewed before it lands — required only where a rule says so ([§2, *Core paths*](#core-paths--a-pr-and-a-non-author-approval-before-landing-350)). | a pull request |
| **CI result** | The outcome of the automated checks on one commit, read by that commit's sha, never by recency ([§4](#4-branches-and-commits)). | a workflow run |
| **release** | The deliberate act that puts trunk in front of users — a promotion, a tag, or both, as `exposure` decides ([§6](#6-releases)). | a tag, a merge into `main` |
| **issue** | One unit of work and its memory: the goal, the decisions, the evidence ([§5](#5-claiming-work--how-to-say-im-on-this)). | an issue |
| **parent / child** | An issue holding others as its parts, and those parts. A parent is a container, not a start candidate ([§5, *Epics*](#epics--a-container-is-not-a-start-candidate)). | sub-issues |
| **depends on** | X cannot start until Y's output exists. Never mere file contention ([§5, *Readiness*](#readiness--open-and-unclaimed-is-not-enough)). | a `blocked_by` relationship |
| **hold** | A record that something is not free to take: a claim holds an issue, a place-claim a checkout, a park an issue until its wake condition ([§5](#disposition--a-park-must-name-its-wake-condition-279)). | assignee + `in-progress`; `refs/claims/*`; a `deferred:*` label |
| **holder** | Whoever a hold names — a session, by its session id. For a file, every branch touching it that has not landed (`colab holders`). | the claim's session id |
| **lane** | A route by kind: an issue's by what finishing it produces ([§5, *Delivery type*](#delivery-type--route-not-start-112)), CI's light or heavy run ([§7](#two-lanes--light-on-every-merge-heavy-on-official-builds-and-nightly-607)). | a `delivery:*` label; a workflow |
| **evidence** | What shows an issue's outcome: the trunk sha, a `file:line`, and what was checked, posted on the issue before it closes. | an issue comment |
| **issue engine** | The system that stores issues and their relations. **"Engine" unqualified means this**; a qualified one keeps its own sense (a database engine, `engines.node`). | GitHub Issues |
| **agent runtime** | The program a coding agent runs in, which loads the skills — one data file each under [`engines/`](engines/README.md). Never called an engine. | — |

---

## 2. Tiers

**Read this section through [`exposure`](#exposure--what-consumes-a-merge-here), the axis of
record.** What consumes a merge sets the gate count: `none` and `self` zero, `live` one (the
promotion), `released` two (the artifact). `tier:` is a legacy read of it, mapped once in [*Exposure*](#exposure--what-consumes-a-merge-here)
below (#640). The letters below name
the pipeline shapes those gate counts produce; they stay because tools, skills and adopters'
descriptors still cite them, and because a bare `B` cannot be renamed to an exposure value
without asking what consumes the repo.

| | **Tier B** | **Tier C** | **Tier A** |
|---|---|---|---|
| Has production | no | yes | yes |
| Gates between merge and users | 0 | 1 | 2 |
| Trunk (where sessions merge) | `main` | `dev`² | `dev` — or `main`, tag-gated¹ |
| Release branch | — | `main` (= what is live) | `main` |
| CI on trunk | fast | fast | fast |
| CI on `main` | — | full suite | full suite |
| Tags | optional | optional | required, `v*.*.*` |
| Deploy trigger | none | the `dev` → `main` promotion | tag push — or a human running the repo's runbook |

¹ A tag-gated Tier A (`deploy: tag`) may collapse the split and run a single trunk
`main`: the tag marks the release boundary, so the second branch is redundant —
see *tag-gated Tier A* below.

² Tier C's trunk is a **declared setting, not a fixed spelling**. What the audit
validates is the two-branch split — trunk must be a branch distinct from `main`,
the release branch the promotion deploys — never the letters. `dev` is the
default: it is what `colab adopt` and the templates propose when nothing is
said. A repo declaring another name (`develop`, say) is **conforming, not
exempted**: same two branches, same promotion, same gate count, so nothing the
tier model measures changes when the name does (#205).

**A, B and C are labels, not grades.** `B` has no production at all — it cannot break
anything for users, because it has none. The letters name *shapes*, not seriousness.
`B`→`C` is not a demotion; `C`→`A` is not a reward; each is a claim about how many gates
your pipeline really has. Claim the one that is true. Never "upgrade" a repo's tier to
be helpful.

**The first question is "is there a production target *today*?", not "is deploying
automated?"** No production → Tier B, and an imminent launch is still B. Production →
A or C, and the second question decides which: does a deliberate release artifact gate
production (A), or does the promotion itself ship (C)?

A repo that is live but ships by hand — rsync, `docker compose up -d --build`, an upload
— is Tier A with `deploy: manual`, naming its procedure in `runbook:`: the promotion does
not itself deploy, a human running the runbook does — still two acts. Forcing a live repo
to Tier B would make it declare `production: null`, a lie about a live product (the
failure [§10](#10-anti-patterns) is about).

Hand-deployed Tier A keeps the two branches because they earn their keep: `main` is
**what is currently running on the host**, `dev` is where sessions land, and the
promotion is the deliberate "about to deploy" act — the only record of what shipped and
when.

**A tag-gated Tier A may instead run a single trunk `main`.** When `deploy: tag`, the tag
itself marks the release boundary — the last `v*.*.*` is "what shipped and when", the
same job the split does on a hand-deployed repo — so a second branch marking the same
boundary is redundant. Day-to-day work lands on `main`; releases are cut by tag. The tier is set by the
promotion **gate** (a version tag), never by the trunk name or where the deploy job runs.
Specific to `deploy: tag` — `manual`/`push-main` have no tag to mark the boundary and
keep the split. Wherever the deploy runs outside CI, the path to production must be
committed as [`runbook:`](project.schema.md#runbook--required-when-an-out-of-ci-deploy-has-no-workflow).
Where a release script fast-forwards a long-lived release branch that an external poller
watches, name that branch in [`releaseBranch:`](project.schema.md#releasebranch--optional). Why: [ADR 539](docs/adr/539-tiers-rationale.md).

A live
but low-stakes site gains nothing from cutting versions; C describes that shape honestly:
`deploy: push-main`, `main` is what is live, the promotion is the one moment someone
decides to ship. Why: [ADR 539](docs/adr/539-tiers-rationale.md).

**Deploying straight off a `main` push meets Tier C's contract, not Tier A's.**
`deploy: push-main` is a legal, reasonable mechanism; the mismatch is with the *tier*
claim — A's contract is a deliberate release artifact gating production
([§6](#6-releases)), and push-main has none. So `tier: A` + `push-main` is a finding, and
the usual fix is **retiering to C** — no pipeline change, the descriptor stops claiming
a gate it never had. Migrating to `deploy: tag`, or declaring `deploy: manual` +
`runbook:`, remain valid alternatives when the site has genuinely earned them.

**[Hard — gate: records refuses role word]** **"Trunk" is a role, not a branch name** — the branch sessions merge into, declared in
`project.yml`'s `trunk:` field: in Tier B (and `exposure: none`, or `released` with no
production) the repo's **default branch** — `main` by convention, but an existing repo's
`master` (or any other spelling) is equally conforming, because what the shape requires is
that it is the **only** long-lived branch, not what it is called; a `main` beside a
non-`main` trunk is the two-branch shape and fails (#522); a name **distinct from `main`** in
Tier C, `dev` by default but any other name equally conforming (the footnote above states
why); `dev` or (tag-gated) `main` in Tier A. Read `project.yml` to learn which. **"Any name
is legal" is not what this licenses** — outside the tag-gated exception Tier A's value is
still fixed, and Tier B's single trunk may never sit beside a `main`; renaming an existing
default branch to satisfy a spelling is never the fix. Never create a
branch literally named `trunk` — and never *record* the word
either. **The absence of a branch is null,
not a word.** A tool storing this should refuse the word on write, and treat "this
branch has no claimed issues" as suspicious rather than routine.

**[Hard — gate: colab ship refuses integration line]** **Trunk is the primary integration point, not always the only one.** A repo may declare
additional long-lived lines in `project.yml`
[`integration:`](project.schema.md#integration--optional). Sessions may cut from a
declared line and ship back into it, guarded exactly as trunk is. It never gets a path to
production — nothing in promote/tag/deploy reads that field, so the only way work on a
line reaches users is a human merging it into trunk and promoting; tooling refuses to
perform that merge. This is a second *development* axis, not a second trunk — `trunk:`
stays tier-locked because on A/C it is literally the production spine.

**`trunk:` answers one question only, deliberately.** Consumers split into Group A —
correctness (worktree classification, landed/delete-safety, cut-from base) — which must
keep reading one shared value; and Group B — "which line does *this checkout* serve",
a per-host deployment fact. **Group B gets no descriptor field, on any tier.** Its answer lives in a
per-host mechanism the repo owns (env var, machine-local config) — the same shape as
`colab`'s own cache, uncommitted and VCS-fenced. Whatever mechanism is chosen must
**name** a branch, unset-by-default, never widen or disable the gate it overrides (e.g.
an `HEAD == trunk` safety check for an unattended rebuild-and-restart). A repo on N hosts
with N lines stays one repo, one descriptor — never N repos, N descriptors, or a second
entry in `trunk:`/`integration:`. Why: [ADR 539](docs/adr/539-tiers-rationale.md).

### Room — who else is here?

**A new axis.** [`room`](project.schema.md#room--optional) names who could ever read
what a session writes down: `solo` (one human — and every agent that human starts, which
has no memory across sessions and reads exactly like the human's own notes), `team`
(several people in one org, who may disagree or take over what a session left behind),
or `public` (people outside the org, with no shared context and no way to ask). It decides
what an Issue is *for* — memory for `solo`, coordination for `team`, documentation for
`public` — which language it is written in, and whether "a human performs the release"
names a role (`team`/`public`) or only names a species when the room is otherwise empty
of anyone else to hand the release to (`solo`).

Issue language follows the room, not repo privacy, and
[`ceremony`](#ceremony--narration-follows-the-room-recoverability-follows-exposure) follows
the room, not production status.

**The stated reason for claim discipline gets the same correction.** *"Anything labelled
in-progress is someone else's — do not take it"* reads, on first pass, as etiquette
between colleagues. The room axis makes the actual mechanism explicit: in the common case
today the "someone else" is another agent the same person started minutes earlier, and the
rule exists to stop two of one person's own sessions from editing the same file, not to
be polite to a colleague who may not even be there. Politeness is negotiable under
pressure; a write conflict is not — so state the function, not the etiquette gloss on it.

Why this axis exists, and its history: [ADR 539](docs/adr/539-room-exposure-rationale.md).

**What this unit does not do.** It introduces the field and its prose meaning only — no
audit check reads `room` yet, and no tool infers a repo's room from its GitHub visibility
or anything else. A later unit may add that; until it does, `room` is a declared fact a
human writes down, not a fact anything verifies or derives.

### Exposure — what consumes a merge here?

**Another axis, and the one `tier`'s gate count will eventually be *derived* from.**
[`exposure`](project.schema.md#exposure--optional) names what actually consumes a merge to
this repo: nothing, only parties already in the [room](#room--who-else-is-here), users via
the promotion, or users/adopters via a deliberate artifact (a tag, a runbook). Four values,
lowercase, matching the relationship words the room axis already established rather than
`tier`'s uppercase letters — the letters are the defect this axis exists to remove, and
reusing their shape would carry the grade-reading over:

| what consumes a merge here | value |
|---|---|
| nothing | `none` |
| only parties already in the room | `self` |
| users, via the promotion itself | `live` |
| users or adopters, via a deliberate artifact | `released` |

**`self` is defined against the room axis, which is why exposure had to land after it:**
the consumer set is a subset of the room's collaborator set. A repo whose only reader is the
same person who wrote it has `self` exposure regardless of whether anything is technically
running — the room, not a server, is what bounds the consumer set.

**Gate count is now derived from this field when it is declared** — `none` implies zero
gates, `self` zero, `live` one (the promotion), `released` two (the artifact). Phase 1
shipped the key inert, additive, `tier` fully authoritative; **#144 cut the weld**: `exposure`,
when declared, is the axis of record outright, and `tier`, when it is the only thing
declared, is read as a LEGACY value (`tools/lib/axis-authority.js`: `A → released`,
`C → live`, `B → null` — the `null` is deliberate, because a bare `tier: B` carries no
derivable opinion about what consumes it). Declaring **neither** key is now
the one hard failure ("no axis of record"), replacing the old unconditional "missing tier".
`exposure` does **not** become required by this flip — that is phase 3, a separate, later
step (ten repos answering the question by hand).

`exposure: none` with a *named* `production` target reads as visibly transitional;
`exposure: self` with `production: null` reads as terminal. No new marker key encodes this;
the two existing flat scalars, read together, already say it.

**The old→new mapping is now executed by code, not merely prose** (`tools/lib/axis-authority.js`,
consumed by both the audit and, in time, `colab`). `tier: A`'s contract — a deliberate
release artifact gates production — is exactly `released`; `tier: C`'s contract — the
promotion itself ships — is exactly `live`. Both directions rest on committed facts (a
non-null `production`, a committed deploy path), so an agent may *propose* either. `tier: B`
maps to nothing: `none`, `self`, and `released` are all found under `B` in this fleet today
(the measured 5–5 split, and the tag-published, adopter-consumed shape this very repo is),
so no rule may ever conclude a `B` repo's exposure value — the legacy read for `B` stays
`null`, forever, until a human answers by hand. When BOTH keys are declared and disagree
about gate count, that is exactly one finding naming the disagreement; `tier: B` disagrees
with nothing, because a bare `B` never had an opinion to contradict.

**[Hard — gate: colab adopt human bar]** **Lowering a repo's exposure is a human act, with no field that can override it.** This is
the sharper form of the asymmetry above, and it is enforced in code, not only in prose: the
audit assigns `exposure` no default anywhere — omission reports `null` (undeclared), never
`"none"` (declared: nothing consumes this) — because every candidate value for an undeclared
repo is a claim about the *absence* of a consumer, which nothing here can verify. An agent
may find and report evidence of a consumer; it may never write down that none exists.

**The `production:` pairing gets an advisory, at `warn`, never `fail`:**
`exposure: none` together with `production: null` — the claim that both nothing consumes this
repo and there is nothing to point at. Every other
combination is clean — in particular `live`/`released` **with `production: null`**, because a
tag-published repo with real adopters and no server (this repo's own shape) is the case this
axis exists to stop misreading as "no exposure means no server."

**Not coupled to `tier` by INFERENCE — nothing derives `exposure` from `tier`, ever** — the
identical instruction [`writes`](#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)
gives for the identical reason: an inference rule would re-weld two questions this axis
model exists to separate, and would over-fire on precisely the transitional and
tag-published shapes just ruled legal above. As of #144, the two ARE compared when both are
declared by hand: a `tier` and an `exposure` that disagree about gate count is a finding
(above). That is disagreement-detection between two written-down facts, not inference of
one from the other, and it does not reopen this instruction.

**What later units added** (what #132 and #144 shipped: [ADR 539](docs/adr/539-room-exposure-rationale.md)). **#137 shipped 2 of 5 possible
falsifiers against a declared `exposure: none`** — a version-shaped tag exists, and a
committed deploy path exists — each a `warn` naming the evidence, never a `fail` (a
falsifier proves the CLASS of evidence that usually accompanies a consumer, not a consumer
itself). `exposure: self` gets no falsifier at all. #137
also added a **duration report** — how long `exposure: none` has held, from the
descriptor's own git history, never a new field. The exposure
question is now asked, in words, by [§9](#9-adopting-this)'s shared question set (question 3),
and `colab adopt` (#199) is the tool that detects/asks/derives/writes it in one act — gated on
a human for the `none`/`self`/lowering direction ([§9](#9-adopting-this)'s "colab adopt executes this checklist"
paragraph). And no rule here answers the question for any specific repo other than the one
raise recorded in this repo's own `project.yml`, which rests on a human-given answer already
on record in the epic ruling, not on anything this unit concluded.

### Ceremony — narration follows the room, recoverability follows exposure

**Another axis, and tier cannot carry it.** Tier (soon exposure) counts gates to
production; it says nothing about whether anyone will ever comb through a repo's audit
trail. [`ceremony: light`](project.schema.md#ceremony--optional) lets a repo opt into
thinner Issue narration and skip Phase B evidence comments — never the rails that protect
other sessions and the fleet (claim discipline, worktree isolation, reserved ports,
squash + `Closes #N`, CI secret scan, and the
[core-path PR pause](#core-paths--a-pr-and-a-non-author-approval-before-landing-350)).

**Narration and recoverability are two different questions, and one rule used to weld
them together.**

- **narration** — Issue prose, progress comments, Phase B evidence. Follows the **room**:
  a `solo` repo's trail has exactly one reader whether or not the thing is live, so being
  live does not, by itself, give the trail a second reader.
- **recoverability** — what must exist to undo a change. Follows **exposure** and
  irreplaceable state, not narration depth ([Recovery](#recovery--what-must-exist-to-undo-a-merge),
  below).

Why, with the old rule's history: [ADR 539](docs/adr/539-ceremony-recovery-rationale.md).

**[Hard — gate: colab adopt refuses light + auto-trunk]** **So `ceremony` now reduces narration only**, gated on the room rather than on
`production:`. It never waives what exposure requires for recoverability — a live repo
may run light narration; it may not skip the record required to undo a change. One
backstop remains: `light` may not combine with `autonomy: auto-trunk` (an unattended
merge with no evidence trail is unauditable).

### Recovery — what must exist to undo a merge?

**Prevention and recovery are alternatives, and which one is available is decided by
whether the unit has a branch, not by preference** — a fact about the session now, not a
declared [`writes`](#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)
method (⚖ #233 retired the method reading; see [CI](#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)
for the full re-basing). A worktree session, or an attended trunk-direct one falling back
to full ceremony, has a gate in front of the merge — something to inspect before the unit
lands (below) — so "catch it before it lands" is achievable there. An attended trunk-direct
commit with no branch has no such gate: it lands by construction, and CI runs after the
push as an alarm, not a filter. Recovery is the only instrument left in that shape, and it
has been undefined — the mode this handbook adopted for solo flow carried no stated
obligation for what happens once something lands wrong.

The obligation follows [exposure](#exposure--what-consumes-a-merge-here), because what a
bad commit costs to undo is exactly what exposure says consumed it:

| exposure | recovery obligation |
|---|---|
| `none` | amend or `git reset` the trunk-direct commit — nothing outside the repo saw it |
| `self` | rebuild the checkout from a known-good ref and redeploy — the deploy gate, where the repo has one, is the recovery point; where it doesn't, restoring the checkout is the whole obligation |
| `live` | revert the commit, then promote the revert — the revert is a deploy in its own right, not a formality before one |
| `released` | cut a new version and publish an advisory; a release, once tagged, cannot be un-tagged |

**`released` is the strictest cell, not the mildest.** By the time a bad commit reaches
this row, adopters have already copied it — there is no recall path, only a new version
and an advisory. This repo's own distribution is exactly this shape (`channels:
[artifact]`, `exposure: released`): a tag already pulled by an adopter cannot be
un-pulled, only superseded. "Catch it before it lands" is not conservatism at `released`;
it is the only defense that exists, because nothing past the tag is recovery, only a
forward fix.

### Writes — the trunk-direct veto, and the two things that make a branch mandatory

**Another axis.** `writes` ([`writes`](project.schema.md#writes--optional)) — a different
question from `tier` (gates to production), `room` (who reads the record), `ceremony`
(record-keeping depth), or `integration` (a development line) — answers exactly one
question: **may a human ever commit straight to this repo's trunk checkout, alongside
worktree sessions?**

**⚖ Decision on #233 (2026-08-19): `writes` stopped selecting a write-conflict prevention
METHOD and became a two-state VETO.** The vocabulary now resolves to exactly two states:

| descriptor says | means |
|---|---|
| *(absent)* | **coexistence** — the default. Worktree sessions and an attended human trunk-direct session run side by side. |
| `free` | **coexistence, spelled out (#283).** The same state as absence, given a name — `free` IS the former blank: the old prompt told a human to "leave unanswered" for this state because there was no spelling for it; now there is. |
| `direct` | **coexistence, plus a DECLARED intent (#283) — declared today, runtime deferred.** Stored and reported honestly (`tools/lib/adopt.js`'s `deriveConsequences`, `--json`, the wizard) as an explicit "declared, not yet enforced" state; `trunkDirectVetoed('direct')` is `false`, so it changes NO session's actual permissions in this diff — it behaves exactly like `free` at runtime until a separate unit implements what it declares. See "writes: direct — declared today, runtime deferred (#283)", below. |
| **[Hard — gate: colab solo refuses]** `isolated` | **veto** — no trunk-direct in this repo, human or not. No field, flag, or override lowers this bar. |
| `serial` · `serial-direct` · `serial-gated` | **inert — identical to `free` (#283, formerly "identical to absent").** These spellings stay valid (no adopter's descriptor breaks), and resolve through the legacy alias exactly as before (`tools/lib/writes-authority.js`), but nothing downstream treats them as a method choice any longer. |

Binary in practice: veto, or not. `tools/lib/writes-authority.js`'s `trunkDirectVetoed(raw)`
is the one function anything may act on — it reads the **raw** declared value, never the
3-way parse `resolveWrites` still performs (that resolver's *job* is unchanged: parse,
resolve the legacy alias, report `source` — what changed is that nothing may read its
3-way `value` as selecting a method anymore).

**[Hard — gate: colab solo refuses]** **Whether trunk-direct is legal here is a descriptor fact (the veto); whether THIS session
may use it is a session-identity fact, not a descriptor fact.** A repo that does not veto
permits an *attended* human session to commit straight to trunk — attendance is asserted
with the human flag, whose meaning is stated once in [§5, "The human flag"](#the-human-flag--what-colab-human1-asserts),
below (#640). An automated session never gets trunk-direct here, veto or not — the veto forbids
it for everyone, and absence of the veto still requires attendance, which an automated
session cannot assert. See [Solo flow](#solo-flow--trunk-direct-issue-on-demand-entry-gated-a-human-must-be-at-the-keyboard)
below for the mechanical entry gate.

**The constraint matrix**, re-based on what the runtime actually decides — two columns
keyed on the descriptor, with the session-identity distinction expressed in the rows that
used to be keyed to a declarable method:

| constraint | `writes: isolated` (the veto) | `free` · `direct` · absent · `serial` · `serial-direct` · `serial-gated` (coexistence) |
|---|---|---|
| trunk-direct, human at the keyboard (`COLAB_HUMAN=1`) | **forbidden** | allowed |
| trunk-direct, automated session | **forbidden** | **forbidden** |
| `autonomy: auto-trunk` | allowed | allowed |
| `ceremony: light` + `autonomy: auto-trunk` | **forbidden** (above) | **forbidden** (above) |
| place-claim needed | n/a — nothing writes the shared checkout | yes, on the trunk checkout |
| branch | always | always, except an attended trunk-direct unit |

Why those two rows stay unchanged, and how the matrix is tested: [ADR 233](docs/adr/233-writes-veto-and-direct-rationale.md).

#### writes: direct — declared today, runtime deferred (#283)

`direct` is a real, tested, storable value — the audit accepts it, `colab adopt`'s wizard
offers it, `.github/project.yml` may carry it — but this repo's tooling implements exactly
one guarantee about it today: **it never claims more than `free` already grants.**
`trunkDirectVetoed('direct')` is `false`, unchanged from `free` — an attended human session
may take trunk-direct under `direct` exactly as under `free`/absence, an automated session
may not, and no other file (`colab solo`, `tools/lib/place.js`, `code-ship`/`code-wrap`) was
touched to make this true. `direct` **under-delivers** relative to a naive reading of its
name, never over-delivers — the fail-safe direction, and the only reason storing it before
enforcing it is defensible.

Four open questions were named when this vocabulary shipped. Two are decided and enforced
now; one was handed to a ⚖ ruling and has since been ruled (#284, below — recorded; its close
path built in #302, the rest of the runtime still deferred); one remains a proposal of record:

- **Concurrency on the shared checkout — DONE (#285), and it turned out not to be a
  loosening at all.**
    - Why the original proposal (loosen `colab solo`'s entry gate so direct writers could
      share the trunk checkout) was wrong in both halves, with the measurements: [ADR 233](docs/adr/233-writes-veto-and-direct-rationale.md).
  So `direct` gains no new permission here — that is deliberate, and the matrix cells above
  are unchanged. Its one `direct`-specific consequence is a **tightening**: a place-claim on
  a `direct` repo's own trunk checkout must carry an identity (`--session`), because a
  blank-identity hold can never be re-acquired or released by its own owner (#242) and would
  wedge the very checkout whose serialization the value declares. Whether `direct` should
  additionally admit *automated* trunk-direct writers — the reading the original issue text
  invites — is a ⚖ ruling nobody has made, not an implementation detail; the "trunk-direct,
  automated session" row above still reads **forbidden** for every column.
- **CI role — DECIDED AND SHIPPED, as derived report text only.** Under `direct`, `ciRole` is
  **alarm, always** — nothing branches under a merge event that never happens, so CI can
  never gate a merge that doesn't exist.
- **The human merge gate and the Phase A / Phase B split — ⚖ RULED (#284); its close path
  IMPLEMENTED (#302, `colab ship --direct`).** The proposal handed to the ruling was: under `direct` there is no merge
  event, so Phase B does not apply at all; Phase A applies unchanged; the human
  authorization bar moves from the merge act to the session-start instruction. **The
  ruling amended it in one place** — see *Phase A / Phase B under `direct`* immediately
  below, which is the statement of record. Since #302 the close-accounting half has a
  runtime — `colab ship --direct` — and `code-ship`/`code-wrap` say how a trunk-direct unit
  reaches it; everything else about `direct`'s runtime is still deferred.
- **[Hard — gate: colab adopt refuses]** **Exposure restriction — DECIDED AND ENFORCED NOW.** Declaring `writes: direct` requires
  the same human bar as lowering exposure (an interactive TTY, or `COLAB_HUMAN=1` together
  with `--answered-by <name>` — `direct` is the only `writes` value that *expands*
  permission, `free`/`isolated` never do), and is refused outright when the *effective*
  exposure (this run's answer, else the descriptor's axis of record) is `live` or
  `released` — checked both directions, so declaring `direct` against an already-live/
  released repo and declaring `live`/`released` against an already-`direct` repo are both
  refused by the same check. `tools/lib/adopt.js`'s `writesGateVerdict`, wired into
  `tools/colab`'s `cmdAdopt` alongside the existing exposure gate. No `--force`, no override
  flag, consistent with the rest of this command's asymmetry.

##### Phase A / Phase B under `direct` — ⚖ ruled #284: the merge goes, the evidence stays

**The ruling (option B of three, 2026-09-01).** Under `direct`:

- **Phase A (`code-wrap`) applies in full and unchanged** — issue distillation, doc
  updates, quality gate, evidence on the issue. Nothing about it depended on a branch.
- **The MERGE half of Phase B never runs.** There is no branch and no squash, so there is
  nothing to merge, nothing to `Closes #N` from, and no CI gate on a merge that does not
  exist (which is the same fact that makes `ciRole` **alarm, always**, above).
- **`code-ship` still runs, in its existing evidence-close mode.** A `direct` unit leaves
  the same closing event as every other unit: evidence posted, the issue closed, claims
  released. Uniform audit trail; no merge.
- **The human authorization bar moves from the merge act to the session-start
  instruction** — the human who asked for the unit is the authorization, rather than a
  human clicking merge afterward. This is the real departure from "merge means the full
  code-wrap", and it is named here deliberately so nobody discovers it later by assuming
  Phase B still runs somewhere.

Why option A was declined, and the failure evidence-close was built to close: [ADR 233](docs/adr/233-writes-veto-and-direct-rationale.md).

**Which is also why it is cheap.** Evidence-close is not a new mode somebody has to build
for `direct`. Its trigger is `landed ∧ zero own commits` — **both measured from git, never
declared by the session**. A `direct` unit commits straight to trunk, so its work *is*
trunk: it should classify as landed with zero own commits against its base and fall into
evidence-close by the existing detection, with no new branch of logic. ⚠️ **Whoever
implements `direct`'s runtime verifies that rather than assumes it** — the design intent
lines up, the measurement has not been taken.

**Measured (#285, #302): false, at three layers.** The two refusals named below fire first;
and underneath them `landedState` itself answers `unknown` whenever base === branch
(`tools/lib/landed.js`), and `unknown` is never evidence-close. So `colab ship --direct`
(#302) does not route through that detection at all. "Nothing to merge" is structural there
(there is no branch); what it measures instead is that the unit is **published** — trunk
checked out, clean, and not ahead of `origin`. The claims it closes are matched by the
session's identity (same repo, no worktree, no branch, same `--session`/`COLAB_SESSION`),
never by a widened filter, and a blank identity is refused. It reuses everything else a
branch's evidence-close runs — the autonomy gate, trunk CI, the close/refs split, the
evidence comment, the claim release, the plan journal — so the audit trail stays uniform,
which was the point of the ruling. `writes: direct` is not required to use it: it grants no
write, only a close, so any repo whose `writes:` does not veto trunk-direct may.

**Two things this ruling deliberately did NOT settle** — the first has since been ruled (#342), the
second is still open; neither is answered by
silence:

- **[Hard — gate: close refuses without an evidence comment]** **Evidence-close is gated** on the issue *already carrying a comment the tool did not
  write* (colab's own markers do not count, nor does a comment that is only a one-line
  `— <name> · <machine>/<session>` signature, #535); an issue without one is reported and left
  open. Whether that gate is right for a `direct` unit — where the human's session-start
  instruction, not a comment, is the authorization — is a real follow-up question.
  **⚖ Ruled 2026-09-14 ([#342](https://github.com/futurelastic/colab-handbook/issues/342),
  option A: confirm all three readings #302 took)**: the gate is right for a
  `direct` unit too, because the two things answer different questions. The session-start
  instruction authorizes the *unit* to exist; the comment evidences its *delivery* — and
  Phase A, which applies to `direct` in full, writes that comment anyway (`code-wrap` A1).
  The same
  ruling confirmed the two further choices #302 made: the **autonomy gate still applies** to
  `--direct` (without `autonomy: auto-trunk` a human closes the unit — unless the unit is
  docs-only, [the one exception](#autonomy--the-docs-only-exception-345), which applies to
  this door exactly as to a branch), and **trunk CI still gates the close**, as it does a
  branch's evidence-close (the unit's own commit may be what turned it red). Reading "the bar
  moves to session-start" as lifting the autonomy gate would move merge authority to the
  session-start instruction; relaxing any of the three gates is a separate change for a human,
  brought with a measurement showing that gate cost something.
- **Everything else about `direct`'s runtime stays deferred**, concurrency included. The
  ruling settles close-accounting only; it does not authorize any session to take
  trunk-direct anywhere the veto and the attendance bar do not already allow it.

Why option C was declined, and the retired argument over `auto-trunk` and `serial-direct`: [ADR 233](docs/adr/233-writes-veto-and-direct-rationale.md).

**Exactly two conditions make a branch mandatory** for an attended trunk-direct session —
every other kind of session (a worktree one) has a branch by construction, so this now
governs solo flow specifically:

1. **More than one unit of work is in flight** — a second claim, worktree, or place-claim
   already live on the repo. One writer stops being true, so the branch is what draws the
   boundary between units.
2. **A gate must inspect the unit before it lands** — CI, review, or any check that needs
   something to point at. Trunk-direct has nothing to gate. A repo where this is true says
   so by *having* a gate — a trunk-gating CI workflow, or branch protection — not by a
   declared value; see [CI](#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)
   below for where that fact now lives (this migrated from the retired `serial-gated`
   spelling, which used to be the only way to assert it).

**Not on that list: "it feels safer."** A branch is one way to draw a unit boundary; a
place-claim (below) is another, and where neither condition applies, the place-claim is
the whole guarantee — adding a branch on top buys nothing the lock did not already give.
Nor does "so the changelog reads cleanly" qualify — a solo session's Conventional Commits
already group correctly without one.

**Deliberately not coupled to exposure, tier, or production.** No audited rule couples this to them, and none should be added later "to catch the common case." Why: [ADR 539](docs/adr/539-writes-direct-rationale.md).

The deploy-shape prohibition was retired by #233, the rule it carried and the measurement behind dropping it: [ADR 233](docs/adr/233-writes-veto-and-direct-rationale.md). A
repo that later grows into that shape without declaring the veto gets trunk-direct
silently, and there a commit reaches users immediately; the audit reports the combination
as an informational advisory (never a refusal) — `writes: isolated` is now the only way to
say "not here."

### Autonomy — the docs-only exception (#345)

**[Hard — gate: colab ship autonomy gate]** **⚖ Ruled by the repo owner, 2026-09-14 ([#345](https://github.com/futurelastic/colab-handbook/issues/345)).**
On a repo that does **not** declare `autonomy: auto-trunk`, an agent may complete Phase B
through `colab ship` for a change that is **documentation only**, with no human trigger. The
"documentation only" judgement is **computed by `colab ship` from git** — never asserted by
the caller.

Why, with the measurement: [ADR 345](docs/adr/345-docs-only-autonomy-exception-rationale.md).

**The change set ship measures.**
- A branch: `git diff <target>...<branch>`, the same three-dot diff the squash lands, with
  renames split, so a rename is judged by **both** its old and its new name and a deletion by
  the path it deletes.
- A trunk-direct unit (`colab ship --direct`, which has no branch — ruled to carry this
  exception by [#342](https://github.com/futurelastic/colab-handbook/issues/342)): every commit on
  trunk since the unit's earliest claim, **by anyone**. Nothing mechanical ties a trunk commit to
  a session, so this over-includes on purpose — another session's code commit in the window turns
  the answer into a refusal, never the other way. The window is git's `--since`, which counts
  whole seconds and includes the claim's own second.

**Docs-only** when *every* path is **either**:
- an extension in `.md`, `.mdx`, `.txt`, **or**
- under a top-level `docs/`.

**[Hard — gate: colab ship autonomy gate]** **Never docs-only**, even if matched above:
- `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/**`, `.github/**`, `.githooks/**` —
  these are rules and config;
- `.colab/skills/**` — a skill's [local policy](#local-policy--a-repo-refines-a-skill-without-forking-it-520)
  is agent instructions that win over the skill's own text, so one `.md` there changes agent
  behaviour exactly as a `CLAUDE.md` does (#520);
- a build input despite its extension, at any depth (#570): a Python dependency manifest as the
  [cure rule](#cure-rule--the-machine-checkable-door-through-trunk-ci-green-281) names one (`requirements` in the name, or under
  `requirements/`), a pip `constraints*.txt`, `CMakeLists.txt`;
- any binary change — **except a design artifact under the top-level `docs/`** (#606): a binary
  whose extension is `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg` or `.pdf`, compared
  case-insensitively, is documentation. Any other binary under `docs/`, and every binary outside
  it, is still not;
- any symlink change;
- an empty diff.

The tool reads the exclusions at the strict end wherever the list is silent. The three file
names, three directories and the `.colab/skills` subtree match **at any depth** (`pkg/CLAUDE.md` and `docs/.github/x.md` are
excluded too). Extensions compare exactly (`README.MD` is not `.md`). A submodule pointer counts
as a binary change. A zero-commit evidence-close has an empty diff, so it still needs
`auto-trunk` or a human.

**[Hard — gate: ship never tags or promotes]** **It relaxes the autonomy gate, and only that gate.** Every other precondition is unchanged:
grade, trunk CI, migrations (still opened only by a grant of a role the repo accepts), writes,
claims, and the `COLAB_SHIP=1` push. The autonomy row
reads `docs-only (N files) — autonomy exception` in place of `auto-trunk`. `--dry --json` adds
`autonomyGate: { via, docsOnly }`, with `via` one of `"auto-trunk"`, `"docs-only"`, `"tuning"`
(the tuning-only class, below), `"human"` (the human door, below) or `null`.
A refusal keeps the existing message and adds one line naming why the change is not docs-only.
A branch is measured **again after B0 sync**, before the squash, so a `pre-ship` hook that
regenerated a file cannot carry code in behind the first verdict. The pre-push guard needs no
change: the push still carries `COLAB_SHIP=1` because ship ran its own preconditions. It grants
nothing past the trunk merge — promotion and deploys stay human, and a tag follows
[§6's release routes](#6-releases), never `colab ship`.

**Nothing widens the allowlist.** No `project.yml` field, flag or environment variable can add
to it: `tools/lib/docs-only.js` holds both lists as constants. Widening it is a handbook change,
reviewed in a commit like this one. #606 was one: the design-artifact binaries above widened this
exception **and** ship's no-CI-wait path for docs-only changes
([§4](#docs-only--no-ci-wait-606)) at once, because both read the same module. `ci-docs-skip` only
ever narrows the second; it never touches this exception. `docs-only-paths` (#626) only ever
widens the second — content images an adopter declares — and never this exception either.

### Autonomy — the tuning-only class (#561)

**[Hard — gate: colab ship autonomy gate]** **⚖ Ruled by the repo owner, 2026-10-07 ([#561](https://github.com/futurelastic/colab-handbook/issues/561)).**
`.github/project.yml` stays committed. What is made cheap is a **tuning** change: one
repo-owned value moved on the repo's own measurements. Why: [ADR 561](docs/adr/561-tuning-only-class-rationale.md).

- **`colab config set <key> <value> --evidence "<why>"`** edits that one key only, validates the
  value with the parser every reader of the key uses, and commits `chore(project): <key> <old> → <new>`
  on fresh trunk as `chore/tune-<key>`, touching no checkout. The evidence is the commit body.
- **`colab ship` computes the class from the diff**, never asserted, and like docs-only it opens the
  autonomy gate without `auto-trunk`. It needs no issue and no `Closes #N`. Every other precondition
  still applies (trunk CI, branch CI class, conflicts), and it is re-measured after B0 sync.

**Tuning only** when exactly one file changed, `.github/project.yml`, as a regular text file;
every changed non-blank line sits inside a tuning key's block (a top-level comment does not); every
other key parses identical on both sides; and every tuning key that moved holds a valid value or
is absent. The allowlist: `ship-batch` (inside its cap), `ship-batch-wait`, `ship-batch-steps`,
`ci-wait-factor`, `thresholds`. **[Hard — gate: colab ship autonomy gate]** **Never tuning**, because they grant
authority or change what deploys: `autonomy`, `promotion`, `migration-grant`, `ci-grant`,
`trust-humans`, `exposure`, `tier`, `trunk`, `deploy`, `release`, `production`. A malformed value
is refused by `config set` and by the class alike (#416). Both lists are constants in
`tools/lib/config-set.js`, widened only by a reviewed handbook change.

### Autonomy — the human door (#525)

**[Hard — gate: colab ship autonomy gate]** **⚖ Ruled by the repo owner, 2026-10-06 ([#525](https://github.com/futurelastic/colab-handbook/issues/525), option 1).**
On a repo that does **not** declare `autonomy: auto-trunk`, "a human must trigger Phase B" means
a person runs `colab ship` themselves. Running the command **is** the go. Ship opens the
autonomy gate for that person and runs every other precondition unchanged. Why: [ADR 539](docs/adr/539-autonomy-core-paths-rationale.md).

The bar is the one the CLI already applies to human-only acts (`colab adopt --autonomy`):
- **An interactive terminal** — stdin and stdout both a TTY, and **not** an agent shell
  (`CLAUDECODE=1` or `AI_AGENT` set). Ship then asks `proceed? [y/N]` just before its first
  write. Anything but `y`/`yes` changes nothing.
- **Or `COLAB_HUMAN=1` and `--answered-by <name>`**, for a person without a terminal prompt.
  `COLAB_HUMAN=1` alone is refused, with what is missing.

**[Hard — gate: colab ship autonomy gate]** **An agent never opens this door on its own.** An agent
shell is not a terminal, whatever its stdio is, and setting the human flag follows
[§5's one rule for it](#the-human-flag--what-colab-human1-asserts) (#640).

What the door changes, and what it does not:
- It is checked **after** auto-trunk and docs-only, so those keep their own rows and records.
- The autonomy row reads `human door (#525): <how>`. `--dry --json` reports
  `autonomyGate.human: { open, how, why }` whenever the door was consulted, with `how` one of
  `"tty"`, `"colab-human"` or `null`.
- An unattended refusal names the exact commands a human runs, with the same selector
  (`--worktree`, `--branch` or `--direct`).
- The 🚢 comment (and the ✅ evidence-close comment) records that the merge went through the
  human door, and how.
- `colab ship --batch` is unchanged. It still needs `auto-trunk`, because a batch is one
  unattended push.
- It grants nothing past the trunk merge. Promotion, tags and deploys stay where §6 puts them.

### Core paths — a PR and a non-author approval before landing (#350)

**[Hard — gate: colab ship core-path review]** Landing is machine-only: `colab ship` squashes a branch onto its target once the mechanical
preconditions pass. **The one exception is the core.** A branch that touches a core path goes
up as a pull request, and it lands only after an account other than its author has approved it.

**The core is whatever the target's `CODEOWNERS` covers.** Write that file by kind, not by
directory: the gate (CI workflows, test and typecheck config, gate scripts), merge behaviour
(`.gitattributes`, merge drivers), permissions (`CODEOWNERS` itself), the repo descriptor, and
irreversible state (migrations, deploy config). Application code, registries, docs and
dependencies are not core. The test is: *if this lands wrong, does every other operator's next
landing break, or does the meaning of "green" change?* The tool adds no list of its own; it
reads the file the forge already reads. It uses the first of `.github/CODEOWNERS`,
`CODEOWNERS` and `docs/CODEOWNERS`, applies the forge's pattern rules (the last match wins, and
a line with no owner carves a path out), and reads the file **from the target, never from the
branch**. A branch cannot exempt itself by editing the file. A branch that adds the first
`CODEOWNERS` is inert for its own landing, because adding the file is what turns the rule on.

**Inert while one account is alone.** With no `CODEOWNERS`, or one whose owners are all the
author's own forge login (the login running ship, plus the `<login>/` of a
[`branchPrefix: machine`](#4-branches-and-commits) branch), a single-operator repo lands exactly
as before, with no extra `gh` call. The rule turns on when the file names someone else. A team
(`@org/team`) or an email counts as someone else: a team cannot be expanded without a network
call, and every doubt resolves toward review.

**A fork's inherited `CODEOWNERS` binds nothing until the fork writes its own (#483).** A
[fork of an upstream](#a-fork-of-an-upstream--a-repo-you-own-that-tracks-one-you-dont-449)
carries the upstream's file unchanged, and that file names the upstream's teams. Why, with the measurement: [ADR 483](docs/adr/483-core-path-fork-codeowners-rationale.md). Also [ADR 539](docs/adr/539-autonomy-core-paths-rationale.md). So on a
fork, `colab ship` ignores every owner of the form `@org/team` whose org is not the fork's own
owner, before anything else is read, and says so in the `core-path review` row. A rule left with
no owner carves its paths out, exactly like an ownerless line. Everything else is unchanged:
logins and emails still count, a team of the fork's own org still counts, and a line the fork
adds to the file applies as written. The fork test is the one `colab adopt` uses: a remote named
`upstream` whose URL differs from `origin`'s. The fork's owner is read from its remote URL. When
either is unknown, nothing is ignored. `colab adopt` names the ignored teams at adoption time, so
a fork owner who wants a review on some paths learns there that the fix is to write the fork's own
owners into the file, as a fork patch.

**[Hard — gate: colab ship core-path review]** **The pause.** When the rule is active and the branch touches a core path:

1. The precondition table gains a `core-path review` row, marked `⏸`.
2. Once every other precondition passes, ship pushes the branch, opens a PR to the target (or
   reuses the open one), and prints `⏸ PR-PENDING`.
3. It then stops with **exit 3** and merges nothing. Claims, worktree and branch are untouched.

A paused ship is not a failed one. Exit 3 is this CLI's code for a human-gated outcome.
`--dry --json` reports it ahead of time as `mode: "pr-pending"`, together with `coreReview`
(the core paths, the PR and the approval verdict).

**Resuming.** Re-run the same `colab ship`. It lands the branch when a review meets all of
these:

- its verdict is `APPROVED`;
- it was given on the branch's **current head**. An approval of an older head is stale;
- the reviewer is neither the PR's author nor the author logins above.

Only the latest review from each reviewer counts, and any outstanding `CHANGES_REQUESTED`
blocks the landing.

The landing itself is still ship's squash, not the PR's merge button. That keeps the composed
message, the B1 CI re-check, the place-claim and the push guard. After B0, the diff is measured
again, and a core path the approval did not cover refuses. Once the push lands, ship closes the
PR with the landed sha.

**Operators who share one forge account cannot approve each other.** The forge already refuses
an author's approval of their own PR, and this rule excludes the same logins. To the forge, one
account is one operator, however many machines or agent fleets push from it. Telling those
machines apart is what the `Machine:` trailer and the branch prefix are for
([§4](#4-branches-and-commits)): they support measurement, not approval. A second operator
needs a second account.

**[Hard — gate: colab ship --direct refuses]** **A trunk-direct unit that touches a core path is refused, not paused (#351).** `colab ship
--direct` closes a branchless unit whose commits are already on trunk, so there is no branch to
open a PR from and nothing left to hold back. When the rule is active and the unit touched a core
path, `--direct` refuses to close it. The precondition table gains a `core-path review` row,
marked `✗` and human-gated, and nothing is closed. The remedy is to redo the change on a branch
and ship that, so the pause above applies. The unit's change set is the one the docs-only
exception uses: every trunk commit since its earliest claim, by anyone. That can only err toward
refusing. When the paths belong to another unit's reviewed landing, a human closes the issue by
hand. `CODEOWNERS` is read twice: from trunk as it stood before the unit's first commit, and from
trunk now. A path is core if either file covers it, and the rule is inert only when both files
are. The door that makes the trunk-direct commit
in the first place (`colab solo`) does not check core paths.

**Not covered here:** escalating to the repo owner after a set wait. That is a separate change.

### Contention — what may run at once (#636)

1. **Coupled paths never run at the same time.** A path a repo declares in
   [`contention.coupled`](project.schema.md#contention--optional) is edited by one live branch at once.
2. **File overlap alone never blocks a start.** Issues that only share a file start in parallel
   ([§5, *Readiness*](#readiness--open-and-unclaimed-is-not-enough)).
3. **The merged result is tested before it lands** — the branch brought up to trunk, or a batch's
   one combined run ([*Batch landing*](#batch-landing--one-combined-run-then-a-fast-forward-373)),
   never each side alone.
4. **One checkout is written by one session at a time**; a worktree is its own checkout.

How the CLI enforces this today — trunk-direct solo flow and the place-claim lock on a shared
checkout — is documented with the CLI, in [`tools/docs/contention.md`](tools/docs/contention.md).

### Solo flow — trunk-direct, issue-on-demand, entry-gated (a human must be at the keyboard)

Trunk-direct for an attended human session on a repo that does not declare `writes: isolated`;
the entry gate and its exit check:
[`tools/docs/contention.md`](tools/docs/contention.md#solo-flow--trunk-direct-issue-on-demand-entry-gated-a-human-must-be-at-the-keyboard).

### Place-claims — the writer-verifiable hold a shared checkout needs, and a worktree does not

The lock a shared trunk checkout needs and a worktree does not:
[`tools/docs/contention.md`](tools/docs/contention.md#place-claims--the-writer-verifiable-hold-a-shared-checkout-needs-and-a-worktree-does-not).

### Channels — by what path does code reach the thing that runs it?

**Another axis, and the one `deploy:` has been silently standing in for.**
[`channels`](project.schema.md#channels--optional) names every path by which a commit
reaches something that *runs* it — a different question from `deploy`, which names only
the **trigger** that promotes to production. Why, with the measurement: [ADR 523](docs/adr/523-channels-axis-rationale.md).

| by what path a commit reaches something that runs it | value |
|---|---|
| merge → CI → a deploy workflow | `workflow` |
| a git hook, in-repo or installed on a machine, fires on a git act | `hook` |
| a human builds/installs/restarts from a checkout, by a documented procedure | `procedure` |
| a per-machine service definition serves the working tree directly — no build, no copy | `checkout` |
| a tag or package that adopters/others consume | `artifact` |
| the process is local; the effect lands in another system's production data | `data` |
| nothing runs this code anywhere | `none` |

Lowercase, a **list** (a repo can genuinely have several channels open at once — a
reviewed workflow *and* a machine-local hook *and* a tag adopters copy out of; a scalar
would force picking the most visible one, the exact failure that produced this finding).
Full field shape, the omission asymmetry, and the one advisory:
[`project.schema.md`](project.schema.md#channels--optional) — this section states the
argument, that page states the field.

Why `channels` is not the exposure axis again: [ADR 523](docs/adr/523-channels-axis-rationale.md).

**Names the KIND of channel; the MACHINE is never in the descriptor.** Several channels
are inherently machine-local — a hook installed on one host, a service definition, sync
membership — and `trunk:` already drew this line once: "which line does *this checkout*
serve" gets no descriptor field, on any tier, because a per-host entry drifts the moment
a machine is renamed or retired with nothing able to tell a stale entry from a live one
([§2](#2-tiers), "`trunk:` answers one question only, deliberately"). This axis inherits
that ruling rather than reopening it: "a local hook rebuilds this on merge" is a fact
about the repo, worth declaring; *which* machine runs the hook is not, and stays in a
per-host mechanism the repo owns.

**Intended channels get declared; unintended ones are findings, never values.** A working
tree file-synced between machines while git metadata is deliberately excluded is a bug,
not a deployment strategy, and this model must not normalise it into a legal member of
the list. The two shapes of consequence: [ADR 523](docs/adr/523-channels-axis-rationale.md).

**Consequence — a file-synced working tree cannot use trunk-direct at all.** The mode
is **unavailable** until the repo is excluded from the sync; performing the exclusion is
operations work, not a rule this handbook states. This is a distinct fact from the
[place-claim](#place-claims--the-writer-verifiable-hold-a-shared-checkout-needs-and-a-worktree-does-not)
rule that the *lock's own state* must never live on a synced path — that rules on where the
lock is stored, this rules on whether the checkout being locked is itself trustworthy as
"one machine" at all.

The second consequence, retired by #233: [ADR 523](docs/adr/523-channels-axis-rationale.md).

What the unit that introduced `channels` did, and the falsifier #137 added: [ADR 523](docs/adr/523-channels-axis-rationale.md).
Of the seven values above, only `artifact` (a tag) and `workflow` (a committed deploy path)
are checked today; `hook`, `procedure`, `checkout`, `data`, and sync membership are each a
named, deliberate deferral — see `audit/README.md` for the reason each was left out and what
would reopen it. No mechanism flips authority from
`tier`/`deploy` to `channels`, or makes the key required — that is #144. The channel
question is now asked, in words, by [§9](#9-adopting-this)'s shared question set (question
5, first-time adoption or a sync against a repo predating this axis), and `colab adopt`
(#199) detects/asks/derives/writes the set in one act — proposed candidates only (a tag, a
committed deploy path, a hooks dir), never an asserted absence, on the same asymmetry as
`exposure`. Why: [ADR 539](docs/adr/539-channels-marker-rationale.md).
What the merge left unchanged: [ADR 523](docs/adr/523-channels-axis-rationale.md).

---

## 3. `.github/project.yml` — the marker

Every repo commits this file. It is how a human or an agent learns the repo's state without
guessing, without an API call, and even when the repo has no GitHub remote at all.

```yaml
tier: B                  # A = live, tag deploys · C = live, promotion deploys · B = no production
trunk: main              # dev (tier C; tier A) · main (tier B; or tier A when deploy: tag)
production: null         # url, or null for tier B
deploy: none             # tag · manual (tier A) · push-main (tier C) · none (tier B)
stack: capacitor-vite    # free-form; describe the repo honestly
```

`deploy` says **how** the repo reaches production, never **whether** production exists.
`manual` means a human runs a documented procedure; it requires `runbook: <path>` naming
that document, and the audit checks the file is really there.

`stack` is a **free-form string**, not a fixed list. Why: [ADR 539](docs/adr/539-channels-marker-rationale.md).

Optional toolchain keys (`node:`, `php:`, …) may be added — see [§7](#7-ci-and-toolchain).
A repo keeping a long-lived line declares it in `integration:` — a development-side axis
with no path to production ([§2](#2-tiers)). A beta/throwaway repo may declare
[`ceremony: light`](project.schema.md#ceremony--optional); omitted, a repo behaves exactly
as before. A repo may also declare
[`channels:`](project.schema.md#channels--optional) — every path by which a commit
reaches something that runs it, a different question from `deploy`'s trigger
([§2](#channels--by-what-path-does-code-reach-the-thing-that-runs-it)); omitted, undeclared,
never read as "none". The same is true of
[`room:`](#room--who-else-is-here), [`exposure:`](#exposure--what-consumes-a-merge-here),
and [`writes:`](#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)
— each optional, each read as undeclared rather than defaulted when absent, and `exposure`
in particular never defaults to `none`, which is a *declared* claim, not the absence of one.
Where the heavy CI lane runs is
[`integration-profile:`](project.schema.md#integration-profile-heavy-workflow--optional)
([§7](#integration-profiles--where-the-heavy-lane-runs-and-what-a-green-trunk-promises-610));
omitted, it is #607's two lanes. A repo whose green work queues behind its trunk CI may declare
[`ship-batch:`](project.schema.md#ship-batch--optional) to land up to three candidates per
CI cycle ([§4, *Batch landing*](#batch-landing--one-combined-run-then-a-fast-forward-373));
omitted, landing stays serial exactly as before.

Mirror the tier as a GitHub **topic** (`tier-a` / `tier-b` / `tier-c`) so `gh repo list
--topic tier-a` gives a fleet-wide view. The file is the source of truth; the topic is
for discovery.

Full field reference: [`project.schema.md`](project.schema.md).

### Boot recipe — an entry point the repo owns, not a table a consumer keeps

`ports:` declares **where** a repo's trunk dev server listens; nothing declares **how**
it starts.

**So the entry point is conventional, not a marker field:** if `<repo>/.colab/dev` exists
and is executable, that starts the trunk dev server — no arguments, foreground, exits
when the server stops. Absent it, a caller falls back to its own ecosystem default. A
boot recipe changes with the code, so it belongs beside the code, not in a shared schema.

Why, with the measurement: [ADR 539](docs/adr/539-channels-marker-rationale.md).

**A start is verified by the declared port accepting a connection, never by the process
manager's exit code** — a supervisor exits 0 the moment a session is created, not when
the command inside it is still alive a second later.

---

## 4. Branches and commits

**Branch names:**

```
^([a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*/)?(feat|fix|docs|chore|refactor|test|perf|design)/[a-z0-9._-]+$
```

Convention is `feat/<slug>-<issue-number>`, e.g. `feat/onboard-redesign-23` — the issue
number in the name means the claim registry, the worktree, and the Issue line up without
a lookup table.

**The optional prefix — `<login>/<machine>/` (#348).** A repo that declares
[`branchPrefix: machine`](project.schema.md#branchprefix--optional) gets session branches
shaped `<login>/<machine>/<type>/<slug>-<issue-number>`, e.g.
`ada/box-a/feat/onboard-redesign-23`: the forge account that holds the claim and the machine
it was cut on. Pushed to origin at cut, **that branch is the machine's work claim**, readable
from the ref alone by every other machine. `colab worktree new` adds the prefix itself — you
still pass the unprefixed name. Undeclared, the unprefixed shape stays the default, and both
shapes conform everywhere: the issue numbers stay in the **trailing** `-<N>` run, and every
reader (ship's harvest, the remote-claim check, the skills) anchors there, so none of them
needs to know the prefix exists. An opt-in CI check for either shape ships as
`templates/branch-name.yml`.

**A branch may carry a group of related issues** — suffix them all:
`fix/import-fixes-115-114-113`. Claim every issue in the group before starting, and
**release every claim in the group together at wrap** — unconditionally, including
issues that did not get finished; an unfinished issue that stays claimed silently blocks
whoever picks it up next. (`colab ship` releases every claim it carried itself, worktree or
not — #319.)

**A group is not a chain.** A *group* is issues that change the same logic and must move
together on one branch, spelled with trailing numbers in the branch name. A *chain* is
issues that must happen in order, across separate branches — recorded as a dependency
([§5](#5-claiming-work--how-to-say-im-on-this)), never by a branch name.

**Branches that predate adoption are grandfathered** — do not rename them; several may be
live worktrees. Apply the convention to new branches only.

**Never** branch off another feature branch — that couples two unfinished things, neither
of which can land alone. Always branch off trunk, or a **declared integration line**
([`integration:`](project.schema.md#integration--optional)) — a stable, published
integration point the team maintains, cut and merged like trunk. "Declared" is a commit
in the repo, not a habit.

The base is a **session fact**, recorded when the worktree is created, and the branch
ships back into it:

```sh
colab worktree new feat/<slug>-N --issues N              # base = trunk
colab worktree new feat/<slug>-N --issues N --base v2    # base = the declared line v2
```

Base and merge target are **one decision, not two** — say which branch you merged into
whenever you report a session done. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).

**The main checkout stays on trunk at rest — a worktree is the default, not a
preference.** A dev server, a symlink, a scheduled job may read that working tree, and
none of them learn that you branched it. Leaving the tree merely
*dirty* is the same fault with wider blast radius — an uncommitted file there blocks
every other session's trunk merge in that repo. A plain branch is still allowed on a
repo nothing reads from; taking it means **you** own returning the checkout to trunk
before you wrap. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).

**`git stash` is repo-scoped, not worktree-scoped — never reach for a bare stash in any
checkout of a repo that has more than one.** `refs/stash` is one ref per repository, not
per checkout; two concurrent sessions stashing around the same time can push/pop over
each other with no error.
**The hazard follows the repo, not where a session stands** (#241) — a recovery that
*starts* in the main checkout (stash) and only *pops* inside a worktree still shares the
one ref between two checkouts; it is not exempt just because the command that reaches for
`refs/stash` isn't the one sitting inside the worktree. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).

Prefer, in order: `git diff`/`git status` to read without moving; targeted
`git checkout -- <path>` plus manual re-apply; comparing directly against
`origin/<trunk>` — never touching `refs/stash`. If unavoidable, label the message
(`git stash push -m "<issue> wip"`) and **re-run `git stash list` immediately before
touching any `stash@{N}` index** — a concurrent push renumbers every existing entry, so
a captured index may already point at someone else's work.

**Landed edits in the wrong checkout** (main instead of a worktree, or the reverse)?
That is exactly the cross-checkout shape the hazard above covers — recover with a
**patch**, never a stash entry. A patch file is private to the session; `refs/stash`
never is:

```sh
git -C <wrong-checkout> diff > /tmp/misplaced.patch    # add --cached / -u as needed
git -C <wrong-checkout> checkout -- .
git -C <right-checkout> apply /tmp/misplaced.patch
```

**A nested worktree's path shares the main checkout's prefix — never infer dirty from
that path, ask git.** `colab worktree new` puts every worktree inside the main checkout,
at `<repo-root>/.worktrees/<name>`, so a live worktree's absolute path always carries the
main checkout's path as a prefix. A judgement made from that path string, or from a
directory walk that descends into `.worktrees/`, reads "the main checkout is dirty" when
it is not — git itself is not fooled; it already excludes registered worktrees from the
parent's status. The only reliable check is `git -C <repo-root> status --porcelain`,
scoped to the repo root, nothing else. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).

**Git answers *whether* the root is dirty; it never answers *whose* the dirt is — and
the two questions must not collapse into one default.** **The default is "possibly mine until shown otherwise," not the
reverse** — the cost of checking one file's branch overlap and content is a `git diff`
and a sentence in a report; the cost of assuming wrongly is lost content plus a blocked
repo. Once a dirty path is actually investigated — does *this* session's branch touch
it, does the content read as this session's own — and it is conclusively not yours, the
original rule still holds exactly as before: **report it, never clean it.** `skills/code-wrap/SKILL.md` A2b is the worked procedure — the ladder to run, the
three verdicts, and the patch-based recovery for a hit that turns out to be yours (using
the recipe two paragraphs above, never a stash). Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).

**Commits** — Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`,
`test:`, `perf:`, `design:`). Not decoration: [§6](#6-releases) builds the release summary
by grouping on these prefixes. A commit with no prefix is invisible in release notes.

**Merging:**

- Feature branch → trunk: **squash**, one commit per unit of work.
- `dev` → `main` promotion (Tiers A and C): **`--no-ff` merge commit**, never squash —
  the merge commit *is* the release boundary.
- **The merge message closes its issues: write `Closes #N`** (one per issue), not a bare
  `(#N)` — GitHub auto-closes only on the keyword. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).
- **Before merging to trunk, trunk's CI must have run at its head commit and be green there** —
  invariants 1 and 2 of [the CI contract](#what-ship-reads--the-ci-contract-607); a genuinely red
  trunk takes only its fix, through the *Red-trunk exemption* or the *Cure rule* below. How the CLI
  reads that verdict (which runs count, the newest run per workflow, cancelled runs, the bounded
  wait): [`tools/docs/ci-gate.md`](tools/docs/ci-gate.md#trunk-ci--by-commit-not-by-recency).

**The landing contract (#638).** Whatever tooling a repo uses, landing a branch on trunk keeps these
rules. How this repo's CLI carries them out — the squash it composes, the close gates and the doors
through them, the landed check and its CI advisory — is documented with the CLI, in
[`tools/docs/branches.md`](tools/docs/branches.md).

1. **[Hard C4.contract.01 — refuse: a commit reaching trunk other than by landing a branch]**
   Trunk moves only by landing a branch — one squash per unit of work, or the tested head of a
   batch. Nobody pushes to trunk by hand.
2. **[Hard C4.contract.02 — refuse: closing an issue whose own checklist is not accounted for]**
   An issue closes at a landing only when its own scope is accounted for: every box of its plan
   checklist ticked, the rest declared as a remainder issue, or the issue deliberately kept open
   instead of closed. A merge made by hand reads the same two fields.
3. An issue kept open at a landing must not read as startable again. A leftover only a person can
   check closes the issue and adds a row to the repo's open `Human verify:` issue; another non-code
   wait parks it, with its wake and its date; leftover code goes to its own remainder issue, and the
   original closes.
4. **[Hard C4.contract.04 — refuse: closing an issue that git does not name]**
   Each issue a landing closes is named by git — the branch name's trailing number group, or a
   `#N` or `(issue N)` reference in a commit body — never by the claim record alone. An issue named
   by neither is a finding, never quietly downgraded to a reference.
5. **[Hard C4.contract.05 — refuse: an evidence close on an issue with no evidence comment]**
   A unit with no diff — a decision recorded, an investigation that changes nothing, an artifact
   kept outside the repo — still closes, with no merge and no marker commit, once the issue carries
   an evidence comment that the closing tooling did not write.
6. Landing a unit releases every claim it carried, finished or not.
7. **[Hard C4.contract.07 — refuse: landing a branch this machine never held, without adoption or a hand-off]**
   A branch this machine never held — one that exists only on the remote, or a local copy created
   from it — lands only when it is adopted on the record, the squash naming the remote head and the
   machine that adopted it, or when its executor handed it off in a comment naming the branch and
   the head that lands.
8. A squash is titled by the branch's most significant Conventional Commit type; when no commit
   carries a recognised type, the subject is stated, never guessed.
9. A squash on a public repository publishes no host or machine identity; where the visibility
   cannot be read, the identity is left out.

### Branch CI — the candidate's own run, read as a class (#314)

A branch lands only on its own green CI result, read at its own head commit — invariant 3 of
[the CI contract](#what-ship-reads--the-ci-contract-607). How the CLI reads that run (the four
classes, the bounded wait, the one re-run) is the CLI's:
[`tools/docs/ci-gate.md`](tools/docs/ci-gate.md#branch-ci--the-candidates-own-run-read-as-a-class-314).

### Docs-only — no CI wait (#606)

A change that touches only documentation does not wait for CI — the one exception to
invariant 3 of [the CI contract](#what-ship-reads--the-ci-contract-607). Which paths count, and
how the CLI decides: [`tools/docs/ci-gate.md`](tools/docs/ci-gate.md#docs-only--no-ci-wait-606).

### Who may touch a branch — the coordinator never edits implementer work (#409)

The owner's ruling: *"Ship session should never code. Should ask the code session to
rework."* The coordinator — a ship or sweep session — never edits, commits, wraps or gates
an implementer's work. Why: [ADR 539](docs/adr/539-who-may-touch-and-batch-landing-rationale.md).

**What stays the coordinator's — git mechanics, not new code.** Three are owner-ruled:

1. **Sync** the base into a branch that has fallen behind it (`code-ship` B0).
2. **Regenerate a generated file** after taking one side of a conflict on it — the
   `generated:` globs and the built-in lockfiles, through the `pre-ship` hook.
3. **Resolve a purely mechanical conflict** — one whose resolution keeps both sides' hunks
   unchanged, adds no line of its own and picks no winner (two appends to the same list,
   two adjacent edits that do not touch each other's lines).

Plus the acts `code-ship` §0 already names: push a wrapped head unchanged, re-run an
infra-class red once, cure-merge, open the red-trunk-fix PR, re-take a released claim. The
coordinator runs a gate only on a commit it made itself — the sync commit — never the
implementer's gate on the implementer's behalf.

**[Hard — gate: sent-back marker is never evidence]** **Everything else is a send-back.** A conflict that needs judgement, a hand-off that does not
verify (uncommitted work, an unpushed head, no distill comment newer than the head, no gate
verdict), a `red:finding` or `live-env` verdict: the coordinator posts **one** Issue comment
beginning with the fixed marker `↩️ Sent back`, addressed to the branch's implementer —
*commit the deliverable paths, run `code-wrap`, stop* — plus the specific gap, reports the
candidate as sent back, and moves on. The marker is bookkeeping: it is not evidence for an
evidence-close, and it is not a hand-off comment, so it can neither close the issue nor make
the branch read as wrapped. Posted once per head: if a send-back already stands and the head
has not moved since, it is not repeated.

### Batch landing — one combined run, then a fast-forward (#373)

Several branches land together only after CI has passed on their combined result; trunk then
moves to exactly that tested commit. How the CLI builds, reads and lands a batch:
[`tools/docs/ci-gate.md`](tools/docs/ci-gate.md#batch-landing--one-combined-run-then-a-fast-forward-373).

### Is a shipped half actually shippable? — the mechanical gate is not the judgement call (#263)

The close gate above is mechanical: it can see whether a box is ticked and whether a
remainder is declared. It cannot see whether shipping *only* the ticked half is a good
idea — that is judgement, and until now no convention stated a test for it.

**Half-done splits three ways, and only one of them is a filing defect:**

1. **Filing defect** — the work genuinely outlived one session: different readiness,
   different blockers, disjoint file sets. This should have been an epic (*Epics*,
   above); the fix is filing it that way next time, not shipping the half.
2. **Not a defect at all** — external interruption. A usage window closed, a
   human-only gate (migration, promotion) sits in the way, a blocker surfaced
   mid-flight, priorities changed. A correctly filed issue lands half-done for any of
   these, and reflexively splitting it on that account teaches nothing and adds
   tracker churn for its own sake.
3. **Inseparable** — the boxes are stages of *one* change, not independent deliverables.
   Shipping the first half puts something half-wired on trunk: a route with no guard,
   a rename applied to some call sites, a migration with no backfill. Here, shipping
   half is worse than shipping nothing, and the right move is to leave the branch and
   finish it next session — never to declare a remainder just to get the gate to pass.

Nothing about the checklist itself distinguishes these three — a `- [ ]`/`- [x]` count
cannot tell "inseparable" from "not a defect," and a partial diff can pass every
existing green gate (tests included) when the tests for the unwritten half simply do
not exist yet. So the gate is a precondition, never the answer to "should this half
ship."

**The test, applied at grading time (`code-ship` B1c) before the close gate is ever
reached:** *does the shipped half have its own oracle?* If the only way to know the
shipped half actually works is to finish the other half first, it is case 3 —
inseparable — and it is not shippable regardless of what the checklist says. If it
has its own oracle (its own passing tests, its own working route, its own verifiable
behavior) independent of the unshipped remainder, cases 1 and 2 apply and a declared
`Remainder: #M` is the honest way to ship it.

### Has it landed? — the one rule, because the obvious one is wrong

**Never decide it by counting commits** — a squash mints a new commit with a new sha, so
a shipped branch's own commits are never ancestors of its base; a count-only test reports
every branch ever shipped as unfinished. Comparing diffs alone also fails: zero commits
ahead but a non-empty diff, because the base moved underneath. **The rule asks directly: does merging this branch into its base change the
base's tree at all?** Why: [ADR 539](docs/adr/539-landed-rationale.md).

- **Asked against the branch's base**, trunk only by default — a branch cut from a
  declared line, measured against trunk, looks like enormous unshipped cargo.
- **`unknown` is a real answer and means cargo.** Verdicts never round up to `landed`.

**Before shipping a candidate, also ask the base's history whether it already shipped under
another sha (#370).** A squash followed by base movement reads `unknown`, and a kept ref from
such a ship then looks exactly like unshipped work — measured: 3 of 8 "candidates" in one
repository were already on trunk, and one read CONFLICT only because its own content was
already there. The squash message carries the answer the tree cannot:

```sh
git log origin/<base> -i -E --format='%h %cI %s' \
  --grep="(close[sd]?|fix(e[sd])?|resolve[sd]?) #<N>([^0-9]|$)"
```

The `([^0-9]|$)` tail is load-bearing: a bare `--grep="#37"` also matches `#370`. A match for
**every** issue the branch carries, with each issue CLOSED and no commit on the branch newer
than the matching squash, means **shipped** — the phantom case: evidence, release, teardown,
never a second merge. Anything short of all three (an issue reopened since, a commit after
the squash, a `Refs #N` only) is a continuation or a partial ship and stays cargo. This
answers *did a ship already happen*; it never answers *is the content on base* — `colab
landed` still owns that, and an unmatched grep never rounds a verdict toward `landed`.

**Git state and claim state are two signals, and neither replaces the other.** The
`in-progress` label answers *does someone believe they hold this*; git answers *what
state is this actually in*. Do not collapse them.

How the CLI answers it — its verdicts, and the advisory that asks whether the commit a branch was
cut from was green — is documented with the CLI, in
[`tools/docs/branches.md`](tools/docs/branches.md#has-it-landed--the-clis-check).

---

## 5. Claiming work — how to say "I'm on this"

> **Frozen — no new features ([#604](https://github.com/futurelastic/colab-handbook/issues/604), 2026-10-14).**
> Scope is how code lands on git. Claims recorded on the issue, readiness, `Filed-by`
> provenance, decision records, every `COLAB_HUMAN=1` gate except `solo`, and their commands
> will move to a separate decision layer adopters run. They still apply as written; bug fixes
> land, new features are refused. The git claim ref, place-claims and `solo` stay in scope.
> Full list and retirement rule: [ADR 604](docs/adr/604-scope-freeze.md).

**The claims and decisions contract (#639).** Whatever tooling a repo uses, holding work, recording
what it waits on and recording what a person decided keep these rules. How this repo's CLI carries
them out — the claim ref and its tracker mirror, the readiness markers, the hold codec, the
disposition marker, the decision record and the grants — is documented with the CLI, in
[`tools/docs/claims.md`](tools/docs/claims.md), [`tools/docs/readiness.md`](tools/docs/readiness.md),
[`tools/docs/decisions.md`](tools/docs/decisions.md) and [`tools/docs/grants.md`](tools/docs/grants.md).

1. **[Hard C5.contract.01 — refuse: a second claim on an issue a live claim already holds]**
   One holder per issue. A claim is taken before work starts and recorded where every machine
   sharing the repo can read it; a second claim on an issue a live claim holds is refused, and
   taking one over is a loud, deliberate act. Where that record cannot be read, no claim is taken.
2. A claim is whole or it is broken. The record a person reads names both the holder and that the
   work is in progress; either half alone is neither free nor taken until its holder repairs or
   releases it. A claim is released when its unit lands, finished or not.
3. Dependencies are recorded as structure the tracker can read — parent and child, blocked-by —
   never as prose. An edge means one issue needs what another produces; it never records a queue
   position or a shared file.
4. "No blockers" and "nobody checked" are told apart. An issue is marked dependency-checked only by
   someone who looked, a mechanical read of an empty graph never sets that mark, and a readiness
   verdict fails toward blocked, never toward ready.
5. Every hold that stops a start names its owner and a wake condition a scheduler can check. A hold
   with no owner, or no checkable wake, is a stall and never ready; a met wake proposes lifting the
   hold and never lifts it.
6. A session does not dispose of its own issue. It posts evidence and proposes how the work ends; a
   later pass applies that disposition. Who may apply it is decided from facts on the issue, and an
   absent or unreadable fact fails toward a person.
7. **[Hard C5.contract.07 — refuse: recording an answer that does not name the open question it answers]**
   A decision waiting on a person is recorded where the tracker can read it: the question with its
   options, and then the answer, naming who ruled and which question it answers. A waiting decision
   blocks the issue from starting, and the waiting mark's absence is never read as the answer.
8. An ask a person must answer is put once. A later pass reports that it is still waiting, and never
   asks again because time has passed.
9. **[Hard C5.contract.09 — refuse: landing a migration that carries no valid grant]**
   Some acts only a person decides: landing a migration (or a declared reviewer, where the repo opts
   in), landing onto a red trunk without a proven cure, a promotion or a final that deploys,
   production access, credentials, and destructive or non-undoable operations. A grant is bound to
   one branch and expires with its issue, an agent never mints one, and "a person is behind this" is
   transcribed from that person in a live conversation, never inferred.

Parallel sessions and parallel agents must not collide on the same Issue. Two layers:

### Who holds this

#### Record of a claim — the branch on the remote

A claim is taken before work starts and recorded where every machine sharing the repo can read it —
the [claims and decisions contract](#5-claiming-work--how-to-say-im-on-this), item 1. How the CLI
records it, what it refuses and the planner hold:
[`tools/docs/claims.md`](tools/docs/claims.md#record-of-a-claim--the-branch-on-the-remote).

#### Mirror for people — GitHub

What a person reads on the tracker names both the holder and that work is in progress; either half
alone is a broken claim — the [claims and decisions
contract](#5-claiming-work--how-to-say-im-on-this), item 2. The commands, the half-claim refusal and
whose assignee a release removes:
[`tools/docs/claims.md`](tools/docs/claims.md#mirror-for-people--github).

#### Fast path — local cache

A machine-local cache of claims answers fast and is never the truth: where it disagrees with the
tracker, the tracker wins. The CLI's cache and its reconcile commands:
[`tools/docs/claims.md`](tools/docs/claims.md#fast-path--local-cache).

#### Rules

Claim before you start; a live claim is enforced, not advisory; release it even if you did not
finish — the [claims and decisions contract](#5-claiming-work--how-to-say-im-on-this), items 1–2.
The claim and release comments, the evidence marker family and the tie-break:
[`tools/docs/claims.md`](tools/docs/claims.md#rules).

#### Tracking issues — claimed but referenced, not closed

A long-lived tracking issue may be claimed and referenced without being closed; its claim is still
released at every landing. The label, the per-landing reference and the stray close:
[`tools/docs/claims.md`](tools/docs/claims.md#tracking-issues--claimed-but-referenced-not-closed).

#### Human verify — a person-only check closes the issue and becomes one row (#491)

Why, with the measurements: [ADR 491](docs/adr/491-human-verify-rationale.md).
**So when the code is all on trunk and what is left is a check only a human can run:**

- The ship **closes** the issue: `Closes #N`, not `--refs`. The implementer does not hold
  the issue for the check either: `code-wrap` adds the row and hands off a finished branch,
  and `code-start` plans such a check as a row from the start (#541).
- In the same step, it appends **one row** to the repo's single open issue titled
  `Human verify: …`. The row gives the source issue, the steps to run, and the evidence
  wanted. If no such issue is open, the ship files one, labelled `delivery:ops` so it is
  routed to a person and never started as code. Where the repo declares a `holds:` label
  for human-owned waits, that label goes on too.
- **A row that fails becomes a new bug issue**, linked to the row's source issue. The source issue stays closed.
- The person ticks rows off one sitting at a time. When every row is ticked, they close
  the `Human verify:` issue with `colab close`, and the next ship that needs one files a
  fresh one.

What this does **not** change:

- **A code remainder** still takes `Remainder: #M` (or `--refs` plus a hold), as in §4
  *Merging*.
- **A `tracking` issue** is still `Refs #N`, as above.
- **`deferred:measurement` is only for waits a machine can measure**: a metric, a
  threshold, a counter. "A person has to look at it" is not a measurement.

### Who decided it should exist

#### Provenance — who decided the work should exist

Why provenance exists, and why the label: [ADR 89](docs/adr/89-provenance-and-ask-rationale.md).

**So an agent filing on its own initiative labels the issue `agent-filed` and ends the
body with:**

```
Filed-by: agent (during code-wrap of #48, session <name>)
Filed-by: boss (via discussion session <name>)
```

- **No label means a human filed it** — the default; existing issues need no backfill.
- **Provenance is whose *intent* it was, not whose keyboard.** An agent transcribing a
  person's decision writes `Filed-by: boss`, **no** label. An agent noticing a problem
  itself is `agent-filed`, even if a human was in the room.
- The `Filed-by:` line is the durable record; the label makes it **queryable**. Write
  both.

##### Ask — the filer declares the ask class (#89)

Why an ask class, with the measurement: [ADR 89](docs/adr/89-provenance-and-ask-rationale.md).

```
Ask: permission | backlog | ruling | deferred(<trigger>)
```

- **`permission`** — asking to touch machine or production state before proceeding.
- **`backlog`** — a work proposal to accept and schedule, not a decision itself; also the
  default when the line is absent.
- **`ruling`** — resolves to human judgment, never startable as code — same class as
  `needs-decision`. (`ruling` is the ASK CLASS, unchanged by #122's label rename below — see
  the note there: the two names are deliberately kept independent.) A `ruling` issue's
  choices belong in a `decision:options` block (§*Decision options*, below) — that block
  attaches to `needs-decision` directly and is not itself scoped to `agent-filed`.
- **`deferred(<trigger>)`** — no action needed now; the issue carries its own wake
  condition.
- **Absent line means `backlog`** — every pre-existing `agent-filed` issue reads as the
  common case, no backfill required.
- Written at filing time, by whoever files — never reconstructed after the fact.
- Appears only on `agent-filed` issues — a human filing for a human audience needs no
  machine-readable ask class.

### What may start

#### Readiness — open and unclaimed is not enough

An issue is **ready to start** only when open, unclaimed, **and nothing it depends on is
still missing**. Prose dependencies ("blocked by the other one") do not block a parallel
session and no tool can read them.

**So dependencies are recorded in GitHub's own relationship model:** parent/child as
sub-issues, a dependency as blocked-by.

**A `blocked_by` edge records a dependency, never a queue position (#361).** A dependency
means B needs something A produces: a table, an endpoint, a ruling, a design artifact. A
queue position means someone wants A before B, with nothing flowing between them. Only a
dependency is an edge.

Why, with the measurements: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md).

**Queue order is a ranking, recorded as one.** Put it in the ruling itself, as an ordered
list on the issue or epic where the ruling is recorded. `code-triage`'s ordering step
reads that list and ranks ready groups by it. `low-priority` (*Priority*, below) is the
label for "later".

Rejected alternative, with the measured chain: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md).

**File contention is never an edge (#371).** Two issues that edit the same file have no
dependency: neither needs anything the other produces. So an edge between them is a queue
position, which the rule above already forbids.

**A collision is two issues that change the same logic, or one that needs the other's
unmerged code (#630). A shared file alone is not a collision** — such issues start in
parallel, and integration (a trial merge, landing order) settles the rest. The two answers:

- **A real collision → *Grouping*** (below): one `group:<key>` label, one branch, one review
  cycle. It is never recorded as a chain of edges.
- **A path declared in [`contention.coupled`](project.schema.md#contention--optional)** is
  the one place a shared file holds a start: no two live branches edit it at once.

Why, with the measurements: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md), [ADR 630](docs/adr/630-shared-files-start-in-parallel.md).

**An issue names the files it will edit on a `Touches:` line in its body (#386)** — a hint,
not a brake. When `code-triage` measures an issue's file held by a live branch, it appends
that path to `Touches:` in the same step it reports the collision.

**Split an issue at the external-wait line (#371).** When only part of an issue waits on
an outside party (another team's API, a vendor, a ruling from outside the repo), neither
the edge nor the `deferred:external-party` park may hold the whole issue. Split it. The
part the repo can build now becomes its own issue and can start. The part behind the wait
keeps the edge or the park.
`code-triage` reports the split as a structural finding. It does not split the issue
itself: filing issues is not one of its writes.

Why, with the measurements: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md).

How the graph is written and read back — two APIs, two id kinds, one silent trap — and the
dependency-checked marker with its commands:
[`tools/docs/readiness.md`](tools/docs/readiness.md#writing-and-reading-the-graph-and-the-checked-marker).
The rule they serve: the [claims and decisions contract](#5-claiming-work--how-to-say-im-on-this),
items 3–4.

##### Readiness is not a boolean — read the blocker's state, not just its existence

Why one verdict was not enough: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md).

So the
verdict has **three values**, plus the *unchecked* state above, which is not a kind of
ready:

| blocker state | verdict |
|---|---|
| no relationship data at all | **unchecked** — not ready |
| open, nobody has started it | **blocked** — name the blocker |
| open, code pushed and unmerged | **ready, with a note** |
| closed, or its work is already on trunk | **ready** |

**The middle value is computed at read time, never recorded as a second label**, and the
`blocked_by` edge is never deleted once the blocker's code is written. Why, with the measurement: [ADR 539](docs/adr/539-readiness-rationale.md).

**An active session on the blocker is not evidence — a pushed branch with real commits
is.** An unpushed branch does not count either — invisible from other machines. **The
judgement fails toward `blocked`, never toward `ready`** — the mirror of the landed rule
([§4](#4-branches-and-commits)).

Why, with the measurements: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md).

Reference implementation:
[`tools/docs/readiness.md`](tools/docs/readiness.md#reference-implementation-of-the-readiness-verdict).

##### Mechanical readiness — a weaker, honest claim for the empty case (#69)

A mechanical read that finds the graph empty is a weaker claim than a person having looked, and
never sets the checked marker — the [claims and decisions
contract](#5-claiming-work--how-to-say-im-on-this), item 4. Its label, receipt and verdict:
[`tools/docs/readiness.md`](tools/docs/readiness.md#mechanical-readiness--a-weaker-honest-claim-for-the-empty-case-69).

#### Disposition — a park must name its wake condition (#279)

Why a park needed its own carrier: [ADR 279](docs/adr/279-disposition-park-rationale.md).

The four situations, and where each fact lives:

| Situation | Signal |
|---|---|
| Needs a human answer | `needs-decision` (unchanged, see *Decision gate* below) |
| Blocked by another issue | `blockedBy` edge (*Readiness*, above) — do **not** also clear `deps-checked` |
| Waiting on a date / measurement / external party | `deferred:<kind>` + `review-by:<date>` |
| Not code delivery | a non-code `delivery:*` value — `content`/`ops`/`elsewhere`/`design` (*Delivery type*, below) |

Three fixed `deferred:*` kinds, each naming what the park is waiting on:

- **`deferred:date`** — parked until a specific date. Pair with `review-by:<date>`.
- **`deferred:measurement`** — parked until a metric crosses a threshold. Name the metric
  and the threshold on the issue. A machine must be able to take the measurement. A check
  only a person can run goes on the `Human verify:` issue instead (*Human verify*, above).
- **`deferred:external-party`** — parked until someone outside this repo acts. Name who.
  When that act is tracked somewhere, point the wake at it (`issueClosed:<owner>/<repo>#<n>`,
  *Holds* below). When it is not, pair the park with `review-by:<date>`.

**A defer must name its wake condition.** A `deferred:*` label with no `review-by:<date>`,
no `blockedBy` edge, and no checkable `wake:` (*Holds*, below) is not a defer at all — it
is a deprioritisation or a `wontfix`, and should be said plainly instead.

`review-by:<date>` is created **on demand**, the same way `group:<key>` is.

**This section defines vocabulary only.** Landing it changes nothing `code-triage`
writes today: no tracker write in this repo's own tooling emits `deferred:*` or
`review-by:<date>` yet. Consumer-side rendering of a disposition, and surfacing of an
expired park, are meant to land before that write does. Why, with the measurement: [ADR 539](docs/adr/539-holds-rationale.md). Re-triaging existing silent parks once
the vocabulary exists is a follow-up, not part of landing the vocabulary.

How this generalises the `Ask:` line: [ADR 279](docs/adr/279-disposition-park-rationale.md).

##### Holds — every label that stops a start names its owner and its wake (#360)

The three hold kinds that recur in adopting repos, and the measurements behind this subsection: [ADR 360](docs/adr/360-holds-rationale.md).

**The three stay consumer-local. They are not adopted into the convention label set
([§9](#9-adopting-this)).**

| Consumer hold | What it actually is | The handbook's carrier |
|---|---|---|
| "not yet" | a park | `deferred:date` + `review-by:<date>`, or `low-priority` (*Priority*, below) when it only means "later" |
| "needs rescope" | the issue no longer says what done looks like | fails *Actionable* in `code-triage`'s readiness gate; rewriting the issue is the wake |
| "waiting on the operator" | a human must act | `needs-decision` for a question (*Decision gate*, below); a hold for an act, such as a credential, a grant or a purchase |

A repo that already uses its own names keeps them.
What this subsection adds is the rule every hold follows, whatever it is called.

**Declare them in `.github/project.yml`, so no reader has to guess:**

```yaml
holds: [hold:manual, needs-rescope]     # labels this repo's scheduler treats as start holds
```

- **Every label listed under `holds:` blocks a start.** `code-triage` reports an issue
  carrying one as blocked, never as ready.
- **The list lives in the descriptor.** The descriptor is already the one
  machine-readable answer to "what is this repo". It is copy-and-own. Changing it is a
  trunk commit, which moves `code-triage`'s first fingerprint input, so the next ping sees
  a newly declared hold. The audit checks the list's shape
  ([project.schema.md, `holds`](project.schema.md#holds--optional)).
- **Absent means none declared.** A label missing from the list is not a hold as far as
  triage is concerned, whatever its name suggests. Nothing infers a hold from a name.

**Every hold names an owner and a wake condition when it is applied.** This covers the
declared ones and `deferred:*` alike. Write one comment with two lines, the same shape
the `Group:`/`Because:` record uses (*Grouping*, below):

```
Hold: needs-rescope — owner: @maintainer — wake: review-by:2026-10-01
Because: the import model changed in #88; the parser steps must be rewritten against it.
```

- **`owner:`** names who clears the hold: a login, or a role the repo's own docs define.
  It is never blank. An owner is not an assignee: an assignee without `in-progress` is a
  half-claim ([§5](#5-claiming-work--how-to-say-im-on-this)), so the owner lives on this
  line.
- **`wake:`** is drawn from a small **closed** vocabulary (below). Nothing outside it
  is ever evaluated, and free text is never a wake.
- **`shape:`** says what the owner is asked for: `ask`, `task` or `wait` (below, #569).
- **The newest `Hold:` line for a label is the live one.** A new hold posts a new line.
  Clearing a hold is the owner removing the label once the wake fires. The comment stays
  as history.
- **A hold that names no owner, or no wake, is a finding and never ready.** A `wake:`
  outside the vocabulary names no wake. `code-triage`
  prints it as a `STALL`, first among its blocked lines. This is the same rule that makes
  any blocker with no named clearer a stall, and for the same reason: an unbounded park
  is a silent `wontfix`. A `deferred:*` label that carries its wake but has no `Hold:`
  line has no named owner, so it is a stall too.
- **A legacy hold already on record is transcribed, not stalled (#386).** Some holds
  predate the `Hold:` line: the label, a `review-by:<date>` label, and a reason naming who
  clears it are all on the issue, just not on one line. Writing that line decides
  nothing, so `code-triage` writes it: owner from the reason, `wake: review-by:<date>`,
  and `Because:` summarising the reason with a link to it. It reports the hold as fixed,
  not as a stall. The `wake:` holds only the date. Conditions on one line are ANDed, so an
  "or" in the reason belongs in `Because:`. If the date, the reason or the owner is
  missing, the hold stays a stall for a human.

###### The `wake:` vocabulary — a wake a scheduler can check (#382)

A `wake:` is one of a small closed vocabulary a scheduler can evaluate on every beat — never free
text, and a met wake proposes lifting the hold, never lifts it — the [claims and decisions
contract](#5-claiming-work--how-to-say-im-on-this), item 5. The vocabulary, its one spelling and its
rules:
[`tools/docs/readiness.md`](tools/docs/readiness.md#the-wake-vocabulary--a-wake-a-scheduler-can-check-382).

###### The `shape:` field — what the owner is asked for (#569)

A hold may say what its owner is asked for: a choice, an act, or nothing yet. A choice is never a
bare hold — it is a recorded decision. The field, its values and how a reader infers it:
[`tools/docs/readiness.md`](tools/docs/readiness.md#the-shape-field--what-the-owner-is-asked-for-569).

#### Disposition — the marker, the seven kinds, and who may apply one (#315)

A session does not dispose of its own issue: it posts evidence and proposes; a later pass applies
the disposition — the [claims and decisions contract](#5-claiming-work--how-to-say-im-on-this), item
6. The seven kinds, the marker and the evidence it rides on:
[`tools/docs/readiness.md`](tools/docs/readiness.md#disposition--the-marker-the-seven-kinds-and-who-may-apply-one-315).

##### Who may apply one — a table over measurable inputs, never a judgement call

Who may apply a disposition is decided from facts on the issue, never from an agent's confidence,
and an absent or unreadable fact fails toward a person — the [claims and decisions
contract](#5-claiming-work--how-to-say-im-on-this), item 6. The inputs, the table and the reference
implementation:
[`tools/docs/readiness.md`](tools/docs/readiness.md#who-may-apply-one--a-table-over-measurable-inputs-never-a-judgement-call).

#### Decision gate — a human must answer first (#122)

Some issues cannot start, or cannot finish, until a human answers a blocking question —
a design pre-approval, a business-logic call, a permission. `needs-decision` marks that. A designer producing a spec decides, while producing it, whether a
surface needs human pre-approval before code starts, and applies the label if so — the
call belongs to whoever is producing the spec, never inferred mechanically from title or
labels.

**`needs-decision` blocks starting the issue** — a readiness gate exactly like an open
hard blocker or a live claim — until a human answers and that answer is **recorded**
(below). No session, manual or scheduled, starts an issue that still carries it.

**On an issue whose deliverable is a design artifact, approving the artifact is not a
question you can ask at filing (#361).** In practice:

- **At filing**, `needs-decision` goes on such an issue only for a question that must be
  answered *before* design work starts, such as which of two directions to explore, or
  whether the surface should exist at all.
- **Approval of the finished artifact** is asked once the artifact exists, by the session
  that produced it, with a `Mockup:` line in the issue body (*Design-approval ask*, below,
  #379). If a ruling is already recorded on the issue, for instance the one that let it
  start, the approval goes through `colab decision <N> --reopen` (below), never a
  hand-added label.
- **A `decision-recorded` that predates the review is not approval of the artifact
  (#379).** It answers the question it was recorded for, such as "start this work", and
  nothing asked after it. Promoting the artifact to `docs/design/` (`code-wrap` A2) waits
  for a ruling recorded **after** the review. Why, with the measurements: [ADR 122](docs/adr/122-decision-gate-rationale.md).

Why, with the measurements: [ADR 122](docs/adr/122-decision-gate-rationale.md).

**An epic never carries `needs-decision`, and never a `decision:options` block (#361).**
Why, with the measurements: [ADR 122](docs/adr/122-decision-gate-rationale.md).

**A session discovering a significant design decision mid-work continues on the
designer's spec** rather than stopping to request a ruling, and records
`design-not-preapproved` in its ship evidence. This default stays the rule everywhere a usable default exists.

**The third path (#122) — only when there is no usable default and the work genuinely
cannot finish.** A session that hits a genuine, blocking, non-design ruling mid-work — not
a design fork with a spec to fall back on, but a question with no default answer — files
the ruling as its **own** issue, wires a `blocked_by` edge (§*Readiness*, above) from the
issue it is working, and **keeps its claim**. **This is not licence to
stop on any fork** — the default-exists case above is unchanged and still the ordinary
rule; this path exists only for the genuinely blocking, no-default case.

A ruling clears the gate only once it is recorded where the tracker reads it — who ruled, and what
it answers; the label's absence is never the answer — the [claims and decisions
contract](#5-claiming-work--how-to-say-im-on-this), item 7. How a ruling is recorded and reopened,
how a reader resolves both labels at once, and a question about an epic:
[`tools/docs/decisions.md`](tools/docs/decisions.md#recording-reopening-and-both-labels-at-once).

#### Decision options — what a ruling chooses between (#126)

The filer of a waiting decision records the options with the question, never the answer — the
[claims and decisions contract](#5-claiming-work--how-to-say-im-on-this), item 7. The block's shape
and which block is live:
[`tools/docs/decisions.md`](tools/docs/decisions.md#decision-options--what-a-ruling-chooses-between-126).

#### Design-approval ask — the `Mockup:` line (#379)

Approving a finished design artifact is asked in the issue body, naming the frozen image. The line's
shape:
[`tools/docs/decisions.md`](tools/docs/decisions.md#design-approval-ask--the-mockup-line-379).

#### An ask is said once — a later pass reports that it is still waiting (#489)

An ask a person must answer is put once; a later pass reports that it is still waiting and never
re-asks because time passed — the [claims and decisions
contract](#5-claiming-work--how-to-say-im-on-this), item 8. What makes an ask open or new, and the
one line a later pass writes:
[`tools/docs/decisions.md`](tools/docs/decisions.md#an-ask-is-said-once--a-later-pass-reports-that-it-is-still-waiting-489).

#### An ask the human must answer can be raised once in a decision box (#490)

A deployment may deliver an ask only a person can answer to a decision box that person watches; the
tracker stays the record, and the box only delivers. How it is raised, keyed and answered:
[`tools/docs/decisions.md`](tools/docs/decisions.md#an-ask-the-human-must-answer-can-be-raised-once-in-a-decision-box-490).

#### The human flag — what `COLAB_HUMAN=1` asserts

That a person is behind a command is transcribed from that person in a live conversation, never
inferred — the [claims and decisions contract](#5-claiming-work--how-to-say-im-on-this), item 9. The
flag, the gates that read it and its honest limit:
[`tools/docs/grants.md`](tools/docs/grants.md#the-human-flag--what-colab-human1-asserts).

#### Migration exemption — a narrow door through no-new-migrations, opened by a role (#98, #402)

A migration lands only with a grant from a person, or from a declared reviewer where the repo opts
in — the [claims and decisions contract](#5-claiming-work--how-to-say-im-on-this), item 9. The gate,
the two roles, who counts as a human and the reviewer conditions:
[`tools/docs/grants.md`](tools/docs/grants.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402).

#### A red trunk with no patch — never parked in silence (#390)

A finished green branch is never left waiting behind a red trunk while nobody owns the red: an
accepted issue for it, or a re-run in flight, must exist. How triage and the CLI keep that true:
[`tools/docs/red-trunk.md`](tools/docs/red-trunk.md#a-red-trunk-with-no-patch--never-parked-in-silence-390).

#### Red-trunk exemption — the one-shot door through trunk-CI-green (#105)

Onto a red trunk only its fix lands (invariant 1 of
[the CI contract](#what-ship-reads--the-ci-contract-607)). One door is a recorded grant, bound to
one branch and the red commit, given by a person or — where a repo opts in with
[`ci-grant`](project.schema.md#ci-grant--optional) — by a reviewer. The mechanics:
[`tools/docs/red-trunk.md`](tools/docs/red-trunk.md#red-trunk-exemption--the-one-shot-door-through-trunk-ci-green-105).

#### Cure rule — the machine-checkable door through trunk-CI-green (#281)

The other door needs no grant: a branch that contains the red commit, is green at its own head,
and provably runs what failed on trunk lands as the fix. The conditions and how the CLI measures
them: [`tools/docs/red-trunk.md`](tools/docs/red-trunk.md#cure-rule--the-machine-checkable-door-through-trunk-ci-green-281).

#### Scheduled drivers — provenance and autonomy meet a caller that is not a person

A **scheduled driver** — a per-repo autopilot waking on a cadence, shipping finished
branches, triaging the backlog, starting sessions for ready groups — breaks the
assumption that the caller is a person or an agent a person is watching. Nothing above
stops applying; this is what a scheduler must additionally honour.

**It inherits the provenance gate, re-applied on every tick, not filtered once:**

- `agent-filed` issues are excluded from what a scheduler starts, every run.
- `epic`-labelled issues are excluded.
- `needs-decision` issues are excluded — no human has answered the blocking question — even
  if the work item itself is human-filed,
  unblocked, and a genuine leaf task.
- **The only admission is a human act recording the decision** (`colab decision --record`,
  above) — a scheduler may never infer an answer from content, age, or repeat proposal,
  and never treats the label's mere absence as an answer: it checks for
  `decision-recorded` or the live comment marker. The converse
  holds too: `needs-decision` *beside* `decision-recorded` is not an admission. It is
  resolved by the pair rule in *Decision gate* (above), and anything but a proven
  interrupted write stays excluded.
- An `agent-filed` issue whose `Ask:` reads `ruling` or `permission` is excluded, for the
  same reason `needs-decision` is.

**A scheduler starts work only by spawning ordinary sessions** (`code-triage` →
`code-start` → work → `code-wrap` → where granted, `code-ship`) — it may not claim,
label, comment, or merge directly.

**[Hard — gate: colab ship refuses]** **It may complete a trunk merge only where the repo has granted `autonomy: auto-trunk`
— or where `colab ship` itself measures the change as
[docs-only](#autonomy--the-docs-only-exception-345) — and only through `colab ship`**, subject to the identical gates as any other caller (CI
green, a proven cure, or a valid CI grant, no new migrations or a valid migration grant
of a role the repo accepts ([*Migration exemption*](#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402)),
no hand-merge conflict, no `--force`). Without a proven cure or the grant, `ship`
refuses and a human runs Phase B.

**[Hard — gate: colab ci-grant refuses]** **A genuinely red trunk with no proven cure and no valid CI grant is human-gated, not
self-clearing** — a scheduler must not queue and wait on it; it parks, states it once,
and stops. A scheduler never mints a ci-grant itself either way — only the cure rule's
mechanical door is available to it unattended, exactly as it is to any other caller. On a
repo declaring `ci-grant: reviewer`, a coordinator session that has reviewed the cure may
mint a `ci-reviewer` grant ([*Red-trunk exemption*](#red-trunk-exemption--the-one-shot-door-through-trunk-ci-green-105),
#504); the scheduler only reads it, through `colab ship`, like any other grant.

**[Hard — gate: colab refuses any tag or promotion outside the release routes]** **Never promotes, on any repo, on any tier — except the release workflow, through `colab
promote --auto`, on a repo declaring `deploy: tag` and `promotion: main-loop` (#440)** — **and
never tags by any path but the release workflow's two commands.** A **release workflow**
(#420) is the one scheduled caller that may tag: it may run `colab release cut --auto` and
`colab release finalize --auto`, unattended, because both **refuse on any failed
condition** — the route ([§6, *Release routes*](#6-releases)) is the permission, each
command measures it on the exact commit, and a refusal is the run's whole output, never a
reason to retry around it. Nothing else a scheduler runs tags: not the driver directly,
not `colab ship`, not a hand-typed `git tag`. **It may never finalize a tag on a
`deploy-tag` route** — where the tag deploys production, the final is the one human click
the routes keep, and `finalize --auto` stops at *candidate ready* there by construction —
**unless the operator granted that repo an automatic final** ([§6, *An operator-granted
automatic final*](#6-releases), #441): a recorded human ruling, re-read on every run, which
adds conditions (no ungranted migration) and is revoked the moment it is reopened. On a repo
the operator moved to route `deploy-tag-fast` under the same kind of grant (#446),
`cut --auto` itself tags the final on a green head and the same run deploys it ([§6, *A final
on every green head*](#6-releases)).
A candidate a human has put `release-hold` on is held for the workflow exactly as it is for
a person.
The handbook ships one to copy, [`templates/release-auto.yml`](templates/release-auto.yml)
(#425): cut on a green CI run on `main`, finalize daily, and **publish in the same run**; an hourly
run re-tries only a refused cut, once the fetched colab CLI has moved (#547). It reads and creates
tags and writes no commit. The same file fits `trunk: main` and `trunk: dev` + `deploy: tag` (#429):
on the latter `main` moves only when trunk is promoted, so the promotion's green CI run is the
trigger, and the CLI cuts only when `main`'s head is a promotion of trunk.

**On a private repo the release workflow runs on the repo's own runners (#453).** Its
jobs run on the self-hosted label the repo's CI already uses; `ubuntu-latest` is right
only on a public repo. The npm publish job is the one exception, hosted
everywhere because npm trusted publishing requires it, and it only ever runs on a public
repo (below). The label is a literal edit point in the template, not an expression keyed
on visibility. The audit flags a private repo whose release
workflow still runs a hosted job and names the label its other workflows use (advisory;
unreadable visibility reports nothing).

**Who promotes is `promotion:`, and the release workflow honours it (#440).** Where a
`deploy: tag` repo declares `promotion: main-loop`, the workflow's daily run first runs
`colab promote --auto`: when trunk's head CI is green and trunk is ahead of `main`, it
merges trunk into `main` (`--no-ff`) and pushes, then dispatches CI on `main`, and that run's green completion cuts the candidate as it would for a human
promotion. So a candidate needs no human; the final tag, which deploys, still does.
Everywhere else `--auto` is a recorded no-op — `promotion: human` or absent, `deploy:
push-main` (the promotion *is* the deploy), `manual` (it signals a human deploy),
`none`, and `trunk: main` (nothing to promote). `COLAB_HUMAN` changes nothing in either
direction.

Why, with the measurements: [ADR 440](docs/adr/440-scheduled-drivers-rationale.md).

**[Hard — gate: colab refuses to move an owner's branch]** **Never acts on an owner's branch.** On a repo declaring `owner:` (a repo the fleet does
not own, #394), a scheduler may run `colab deliver --dry` and report its state, and nothing
more: opening or editing the delivery PR needs a human, and no colab command moves the
owner's branch at all ([§9, *Working in a repo you don't own*](#working-in-a-repo-you-dont-own)).
An open delivery PR reads as **waiting on the owner** — human-gated, stated once, never
re-announced — not as work waiting to ship.

A scheduler must tell a **self-clearing** blocker (temporarily red CI, a billing outage,
a regenerable merge conflict) apart from a **human-gated** one (no `auto-trunk` grant, an
unresolved new migration, an `agent-filed` label still on, a claim held by someone else).
For a human-gated blocker it states it once and parks — never re-announcing the same
unmet gate every cycle. A migration grant is the one human-gated blocker a driver may
watch for clearing without a person acting again mid-cycle — whichever role it carries,
the grant itself is still only ever minted by a human (`COLAB_HUMAN=1`), and a reviewer
grant clears the gate only where the repo's policy accepts that role.

#### Grouping — issues that change the same logic share one branch

**Issues that change the same logic share one branch** — a *collision* as *Readiness* defines
it (#630). A shared file alone is not one: report the overlap, start both.

```sh
KEY=import-fixes    # the branch slug WITHOUT the numbers: fix/import-fixes-115-114-113
gh label create "group:$KEY" --color 5319E7 \
  --description "Must share one branch — these issues change the same logic"
for N in 115 114 113; do gh issue edit "$N" --add-label "group:$KEY"; done
gh issue list --label "group:$KEY"                 # the members, from any machine
```

The key is the branch slug minus its trailing numbers (and minus any `<login>/<machine>/` prefix, §4 — the key names the work, not who holds it). Each member also gets a comment
with machine-readable lines — re-quoted from the current tree, since refs rot:

```
Group: import-fixes — #115 #114 #113
Because: app/Import/Parser.php:88 — #115 and #114 both rewrite the delimiter branch
```

**Three states:** on two-or-more open issues = **grouped** (start together or not at
all); on exactly one open issue = **spent** (remove it); absent = **ungrouped or nobody
triaged** — never evidence the ground is clear. Whoever breaks a group removes the label
from the members it no longer covers.

`code-triage` writes the label; `code-start` reads it before branching. **`colab ship`'s
B4 tears down the label OBJECT (not just an issue's use of it) once every member is
closed** (#82). Deletion removes it from future queries only — never touches closed issues'
own timelines or the durable `Because:` comment. Only `group:*` labels are ever in scope
— never the operational set (`in-progress`, `deps-checked`, `agent-filed`, `epic`).

**The label is a serialisation contract, so the group is ONE unit of work.** It is
realized as one branch — always, on
[`writes: isolated`](#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory);
on a repo permitting trunk-direct, either one branch or one attended trunk-direct
place-claim. **A second live branch across a group's members is a finding, never a
spawn.** Two enforcement points, and neither may be mistaken for the other:

- **triage prevents and names** — a triage pass never offers a `start:` line that would
  mint a second branch in a group, and it names every second live branch it can see at
  pass time as a finding, with the **carrier** branch and the **rebase order** so the
  members can be landed one at a time.
- **ship orders** — a ship lands one member branch at a time against a re-fetched base,
  and **never merges a sibling member's branch to borrow its unmerged fix**: sequence
  behind it or group onto it.

`code-start` is not a third enforcement point — it is the reader that honours the offer.

**Triage sees pass time only.** A second branch created after a pass ends is invisible to
that pass and is caught on the **next**: a newly-pushed sibling ref moves `code-triage`
§0's branch digest, so the next ping cannot short-circuit and takes a full pass.

Why, the alternatives rejected, and why a shared file alone no longer groups: ADR
[316](docs/adr/316-grouping-measured-incident-rationale.md), [316 (enforcement)](docs/adr/316-group-serialisation-enforced-at-triage-and-ship.md), [630](docs/adr/630-shared-files-start-in-parallel.md).

#### Scope — diagnosing across repos is not license to act in them

**Reading and diagnosing across repos to find a root cause is expected.** **Acting in
another repo** (branching, committing, pushing, rebasing/force-pushing an existing
branch, merging) **requires that repo's own claim and its own explicit go-ahead**,
scoped to that repo — even when the diagnosing session is confident it found the real
fix. The correct move: report the finding and stop.

Why, with the measurement: [ADR 127](docs/adr/127-epics-switched-epics-and-scope-rationale.md).

#### Epics — a container is not a start candidate

**An issue whose checklist will outlive one session is an epic, and its items are issues
(#127).** The parent carries the goal and the shared context; each child is
independently claimable, independently blockable, independently shippable, and closes on
its own merge — nothing a child does can put a closure claim on the parent.

At filing time, ask whether the items would be worked by **one** session. Three
signals say they will not — evidence for the rule, never its definition, since a
genuinely one-session multi-item issue should not be forced apart merely because its
items differ on paper:

1. **Different readiness** — one item is trivial, another needs a design pass; they
   will not be picked up together, and the trivial ones ship while the hard one
   becomes a tail.
2. **Different blockers** — if item A waits on something item B does not, sharing a
   claim lets one hold the other hostage.
3. **Disjoint file sets** — items touching non-overlapping files are not one piece of
   work. (Changing the same logic is the opposite finding — the argument for one
   *branch*, never one issue: see *Grouping*, above.)

**No backfill** — this governs what gets filed next, not existing checklist issues;
converting one is optional cleanup, never required by adoption. **Not every checklist
is an epic** — an issue whose boxes are steps of one session's own work (write it,
test it, document it) is a normal issue with a to-do list. The test is whether the work **outlives a session**, never whether it
merely *has* boxes.

**The `epic` label marks a container for sub-issues — informative, never a start
candidate, never claimed as a unit of work** — even when it passes readiness and
provenance cleanly. Secondary signals (`epic(` title prefix, `subIssuesSummary.total > 0`)
corroborate but never substitute for the label. `epic` lives in the provisioned
convention label set (unlike `tracking`) because an unattended driver's decision depends
on it. An epic still gets closed and referenced exactly as any other issue once its
children finish.

**A container closes with its last child (#371).** A child's merge closes the child. So
`colab ship`, after it closes an issue, reads the issue's native parent and closes it in
the same step, with an evidence comment, when all of these hold:

- it carries the `epic` label;
- it has native sub-issues, and every one of them is closed;
- its body lists no unticked checklist item (`- [ ]`);
- it is not a release tracking record, which `colab release finalize` closes.

Then it asks the same question of that parent's own parent. Any other shape is left open.
A parent whose sub-issues are all closed but which has no `epic` label, or which still
lists an unticked item, is reported as a finding for a human. A hand-written checklist
with no native sub-issues is never closed this way (`code-ship` B2c). `code-sweep` §5 closes containers whose
last child closed by some other route, using the same conditions
(`tools/lib/container-close.js`).

**A container never carries a `delivery:*` label (#371).** `code-triage` reports one as a finding in its epic bucket.

**[Hard — gate: colab decision refuses on an epic]** **An epic never carries `needs-decision`, and never a
`decision:options` block.** A question about an epic goes on its own decision issue, attached as a sub-issue (*Decision
gate*, above, #361).

Why, with the measurements: [ADR 127](docs/adr/127-epics-switched-epics-and-scope-rationale.md).

#### Switched epics — concurrent unfinished features (#336)

*Epics*, above, decides how work is **filed**. This subsection decides how several
unfinished features **coexist on one trunk** without any of them reaching a consumer
half-built — the policy the release ladder in [§6](#6-releases) relies on. It carries
the #330 ruling; the rules are numbered so a check can cite one.

**Scope: repos that tag — `exposure: released`** (legacy `tier: A` reads the same way,
`tools/lib/axis-authority.js`). On `none` and `self` this subsection does not apply; a bare
`tier: B` carries no exposure opinion and is not bound either. `exposure: live` is not
bound. *This
scope is the implementer's recommendation, recorded open on #336 and not yet ruled — if
it is ruled otherwise, this paragraph changes, and nothing else here needs to.*

1. **Every large feature is an epic; a multi-merge epic carries a switch.** The switch
   lands in the epic's **first** child, and **removing it is the epic's last child** —
   that removal is what "finished" means in code, not the closing of the parent.
   **Single-merge work gets no switch** and rides the next release as it is.
2. **Two configurations, never more.** A switch exists only while its feature is
   unfinished, so every remaining switch is either off or on together: **release**
   (every remaining switch off) and **development** (every remaining switch on). CI
   runs the suite in **both** ([§7](#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure));
   an intermediate combination — one switch on, another off — is unsupported, and a bug
   reproducible only there is not a bug to fix. **Absent a selector, the code runs the
   release configuration**: a deploy that forgets to choose must get the dark build,
   never the half-built one.
3. **Switch dependencies are declared and enforced, following the issue graph.** If epic
   B's feature needs epic A's, B's declaration names A (below) **and** B's
   switch-removal child carries a native `blocked_by` edge on A's switch-removal child
   (*Readiness*, above).
4. **Collisions are not a switch's job.** Two epics' children that change the same logic
   still share a branch through *Grouping*, above; a shared file alone starts in parallel.
5. **What a switch cannot hide stays backward-compatible while the epic is
   unfinished.** Schema changes **add only**; old config files and old API responses
   keep working; every destructive step — dropping a column, retiring a config key,
   removing a response field — happens **in the switch-removal child**, and nowhere
   earlier. A release built with the switch off must be indistinguishable, to anything
   outside the repo, from one built before the epic started.
6. **At most ~3 unfinished switched epics at once, and a switch older than ~4 weeks
   surfaces for a decision.** Both are **findings for a human**, never blockers. Age is measured from the merge
   of the child that added the switch.
7. **Releases are cut from trunk; versions live in tags only.** A `release/X.Y` branch
   exists **only** when an older version needs a fix of its own, and is deleted with
   that line's support. Never put a version in a branch name. A `release/X.Y` branch is
   neither an [`integration:`](project.schema.md#integration--optional) line nor a
   [`releaseBranch:`](project.schema.md#releasebranch--optional) — no descriptor field declares it and no `colab` path cuts
   from or ships into it today, so a fix on an older version is a human-run procedure
   until one does.

**How a switch is declared — the part a check reads.** One marker, in the family of
`colab:evidence` / `colab:grade` / `colab:disposition` (*Rules*, above), on its own line
in the **epic's body**:

```md
<!-- colab:switch name=bulk-import -->
<!-- colab:switch name=bulk-export needs=bulk-import -->
```

and one on each of the two children that change the switch's existence, in **their**
bodies — `role=add` on the first child, `role=remove` on the last:

```md
<!-- colab:switch name=bulk-import role=add -->
<!-- colab:switch name=bulk-import role=remove -->
```

- **`name`** matches `^[a-z0-9][a-z0-9-]*$` and is **the literal identifier the code
  reads**, so `git grep <name>` finds every read site.
- **`needs`** (epic marker only, optional, comma-separated names) is rule 3's
  declaration; the `blocked_by` edge is its enforcement. A `needs` with no matching edge,
  or an edge with no `needs`, is a finding.
- **`role`** (child marker only) is a **closed** set of two — `add` · `remove` — read by
  equality. A child with no marker is an ordinary child of the epic.
- **Read the way the rest of the family is read**: an unrecognised token, a malformed
  name, or two markers on one issue disagreeing all mean **"not cleared"** — reported,
  never defaulted. An epic with no marker is **not** declared single-merge; it is simply
  undeclared, and whether it should have a switch is a question, not an answer.
- **A marker quoted inside code is not a marker.** Text in an inline code span or a
  fenced block — like the examples above, or prose that names the family as
  `` `<!-- colab:switch -->` `` — is documentation and is never read as a marker (#466).

From these a check derives everything rule 6 and the release cut need, with no other
record: a switch **exists** once its `role=add` child is closed by a merge, it is
**finished** once its `role=remove` child is, it is **unfinished** in between, and its
**age** is that `add` child's close date. How the code reads a switch — an environment
variable, a config file, a build flag — is the repo's own, as its stack is; this
subsection fixes only that one selector chooses between the two configurations, that
its absence means release, and that each switch's identifier is its declared `name`.

Two checks read these markers (#340). `code-triage` §2 reports each epic's switch state
along with rule 3's and rule 6's findings, as findings and never as blockers. `code-ship`
B1c grades a switched epic's children against rules 1, 2 and 5: an `add` or ordinary child
must be dark with the switch off, and the `remove` child must remove the switch completely
and perform the destructive steps it deferred.

Why, with the measurements: [ADR 127](docs/adr/127-epics-switched-epics-and-scope-rationale.md).

#### Delivery type — route, not start (#112)

**Six labels — `delivery:code`, `delivery:docs-only`, `delivery:content`, `delivery:ops`,
`delivery:elsewhere`, `delivery:design`** — name whether finishing an issue produces a
code commit *in this repo* at all. **Three-valued, not boolean:** no label = not asked
(behaves as before); `delivery:code` and `delivery:docs-only` = the code lane, the ordinary
pipeline; `content`/`ops`/`elsewhere`/`design` = non-code-here, not a code start.
**"Not asked" must never collapse into "non-code".**

`content`/`ops`/`elsewhere` gate exactly like `needs-decision` — route, not a start
candidate for anyone. `design` is not a code start either, but it is not routed away: it is
a design session's start, reported in triage's own design bucket (below). A code session
landing on any of the four distills the finding onto the issue and ends the session.
Whoever files or triages sets the label — no mechanical rule infers it from a title or body.
`delivery:*` is in the provisioned label set.

**`delivery:docs-only` (#358)** is a code-lane value: the filer expects an in-repo
commit whose diff is documentation only. It starts, is gated and ships exactly like
`delivery:code` — worktree, the repo's gate, `colab ship` — and triage gives it
`deps-checked` like any code issue once its blockers clear. The label is **not** `colab
ship`'s docs-only exception ([§2](#autonomy--the-docs-only-exception-345)): ship
measures that from the diff and never reads this label, so a `docs-only` issue whose
diff turns out to carry code or a binary simply ships under the normal autonomy gate.
Nor is it a home for design work.

**`delivery:design` (#359)** names an issue whose deliverable is a design artifact —
unit 2 of [*Design conclusions*](#design-conclusions-are-three-units-not-two), below —
for a **new surface**, per the size rule there. A design session works it on the issue's
own branch (`design/<slug>-<N>`), and it ships like any branch; the build issue that
implements the surface waits on it through a `blocked_by` edge. It is never a code start
candidate, and triage reports it in a bucket of its own — apart from code, from route,
and from not asked. Being off the code start list does not take it off the readiness
marker. When its `blocked_by` edges are all closed, or it has none, triage stamps
`deps-checked` on it by the same bar as a code issue, because a design lane gates on
that marker too (#380).

**`delivery:elsewhere` (#274)** names an issue whose deliverable IS code, but code that
lands in a different repository than the one the issue lives in. It routes as
`content`/`ops` do.

**A `delivery:*` value outside these six has no handbook meaning (#366).** The measured
case is `delivery:elsewhere-partial`. One consumer tracker uses it, and nobody has stated
what it means there. The handbook does not adopt it with a guessed meaning, because a
value copied from one consumer's usage is the drift
[*Upstream*](#upstream--a-consumer-that-changes-what-a-convention-means-files-it-here-362)
exists to prevent. So it is **consumer-local**, and it works like this:

- **The classifier reads it as not asked.** `deliveryType()` knows only the provisioned
  values. An issue whose only `delivery:*` label is an undefined value classifies exactly
  like an unlabelled one: no lane, startable by a code session. Next to a provisioned
  value, the provisioned value alone decides the lane.
- **`handbook-sync` reports it as `value` drift, not as a gap.** It is drift until the
  consumer declares it in its `Local divergences:` list with a handbook issue that states
  its meaning. If the consumer wants it adopted, it files that issue, and adoption is
  ruled on the stated meaning.
- **The shape it seems to name has a handbook answer: split the issue.** When part of the
  deliverable is code in another repository and part is here, file two issues. One carries
  `delivery:elsewhere`. The other goes in the ordinary lane. Link them with a `blocked_by`
  edge only where one needs the other's output.

Why, with the measurements: [ADR 112](docs/adr/112-delivery-type-and-priority-rationale.md).

#### Priority — a throttle, not a veto (#268)

**`low-priority` orders a queue; it does not remove work from one.** Unlike `epic` and a
non-code `delivery:*` value above, a `low-priority` issue **is** a start candidate — it
passes the readiness gate exactly like any other issue and stays on the ready list. What
the label changes is rank, not eligibility: `code-triage`'s ordering step ranks a
`low-priority` group behind every other ready group, never off the ready list.

**A scheduled driver declining to auto-start a `low-priority` group unattended is not
that hard-veto reading, provided three things hold:** the decline applies only to
*unattended* starts, checked after every harder objection, with the group still ranked
last exactly where the ordering above puts it; the group never leaves the ready list, so
a human may start it by hand at any time; and clearing the label is the sanctioned way
to release the group back to the scheduler.

A driver that implements the hard-veto reading instead — declining the group outright,
for a human or an unattended start alike, with no ranking, no unattended/attended split,
and no label-clearing release path — must say so somewhere `code-triage`'s output can be
checked against — never leave the two silently disagreeing about what "ready" means for
the same label. `low-priority` is in the provisioned label set.

**`priority:now` and `priority:high` rank upward (#537):** `priority:now` › `priority:high` ›
default (no label) › `low-priority`. A rank across ready work, for both start and merge order —
never a gate skipped, never a hold overridden: a `now` issue whose file is held drains the
file, the holder ships first. **Only the repo owner sets `priority:now`** — or a coordinator
relaying the owner's order, quoted on the issue; `priority:high` the owner or a coordinator.
**An agent never sets either** — it proposes one in a comment. A scheduling tool may compute a
`high`-equivalent from leverage (unblocks many, splits a held file, fixes CI on a throttled
repo), never a `now`. Not part of it: a per-repo cap on `now`, reserved capacity, expiry or
ageing, batch membership. Both labels are provisioned beside `low-priority`.

Why: [ADR 112](docs/adr/112-delivery-type-and-priority-rationale.md).

### How a decision is recorded

#### Planning — a plan file that outlives one command, and who drafts it (#94)

**The plan is a repo-local scratch file, not an Issue comment** —
`.plans/issue-<N>.md`, in the **main checkout, outside any worktree**. Git-excluded, **never committed**. Anything
worth keeping past the session moves to the Issue at wrap.

**The directory is a setting, and it is not under `.claude/` (#488).** `COLAB_PLANS_DIR`
overrides `.plans` (relative to the main checkout, or absolute); `COLAB_BRIEFS_DIR` does
the same for dispatch briefs, default `.briefs`. **Writers write only the configured
dir. Readers** (`code-wrap`'s hand-off check, `code-ship`'s grade and teardown, `colab
ship`'s plan journal) **read the configured dir first, then the legacy
`.claude/plans/`**, for one transition; teardown deletes the plan wherever it found it.
Old files are never moved. `colab worktree new` and `colab adopt --local` hide the
configured dirs and the legacy one in the clone's shared `.git/info/exclude`, and a
scratch file left inside a worktree never makes its teardown refuse
(`tools/lib/scratch-dirs.js`).

**Resolved via an absolute path, never bare relative (#113):**

```sh
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
case "${COLAB_PLANS_DIR:-.plans}" in /*) PLANS_DIR="$COLAB_PLANS_DIR" ;; *) PLANS_DIR="$MAIN_REPO/${COLAB_PLANS_DIR:-.plans}" ;; esac
PLAN="$PLANS_DIR/issue-<N>.md"                       # write here
LEGACY_PLAN="$MAIN_REPO/.claude/plans/issue-<N>.md"  # read here too, after $PLAN (#488 transition)
```

**Three rungs, the middle the default:**

| Rung | When | Content |
|---|---|---|
| 0 — none | trivial/mechanical, oracle self-evident | nothing |
| **1 — plan-lite (DEFAULT)** | every other session | 3-5 lines at session start: intent · files · oracle · stop condition |
| 2 — full plan | `needs-plan` set, or a mid-session trigger (ambiguous ask, no repo precedent, long dependency chain) | drafted by [`code-plan`](skills/code-plan/SKILL.md) into the same file |

**Failing to state rung 1's oracle in one line is itself the signal to stop and ask on the
Issue** — never guess, never silently drop to rung 0.

**`code-wrap` checks the rung it finds (#486).** At hand-off the plan file is present, or
its place holds one line `rung 0 because <reason>`; a non-rung-0 change wrapped with
neither is reported as *plan file missing*, never as hand-off complete — and is never
back-filled.

`code-triage` may flag a hard group `needs-plan` with a one-line reason — a
**cross-backlog judgement**, never a plan of its own. **The full plan is drafted at code-session
start**, inside the implementing session, seeded with the Issue plus the reason line,
against the repo as it is at coding time. One contract, two equal paths: the drafter takes
that seed, appends one rung-2 section to the plan file, and stops before implementing — a
separate helper agent where the agent runtime has one, otherwise the session itself, which records
`drafted-by: self` in the plan's frontmatter ([`code-plan`](skills/code-plan/SKILL.md)). A rung-1 stub may
still upgrade to rung 2 mid-session — the flag decides only the default.

**Read the `needs-plan` flag by direct issue fetch, never the Search API**. A plan is a sketch the code may overrule, not a contract — note deviation
where the plan lives. `needs-plan` is provisioned on adoption and back-filled on sync,
like every other fixed convention label.

Why: [ADR 94](docs/adr/94-planning-and-conclusion-writing-rationale.md).

#### Writing a conclusion down — the decision and the document are two units

A session can produce nothing but a conclusion — prose, and the natural next move is to
write it into the docs tree, where other sessions are also merging. **It reaches trunk as
two units, in order.**

**Step 1 — the conclusion goes on an Issue immediately, before any file is touched.** No
branch, worktree, or clean tree needed.

**Step 2 — the write is its own coding unit**: own Issue, claim, branch off trunk in a
worktree, wrapped normally — never under a typo fix's exemption from ceremony.

**The collision unit is the file (the hunk), never the folder** — two sessions each
adding a new file under one tree cannot conflict:

```sh
colab holders <path>          # fetches first; refuses to say "clean" if it could not
```

Empty output (or a nonexistent path) is clean ground; non-empty is information — group
only when theirs changes the same logic (*Grouping*) or the path is `contention.coupled`.
`unknown` still means *look*, never *assume clear*.

**It fetches before it enumerates.**
`--no-fetch` (offline, or a pinned view) still reports holders it *can* see, but
**refuses** the clean verdict with exit 2 instead of printing it.

No `colab` installed: `git fetch --prune origin` **first**, then `git log --all --not
origin/<trunk> --source --format='%S' -- <path> | sort -u` — the fetch is not optional
there either, and every ref it lists is a candidate, not a verdict; check each by hand.

**Never write the final artifact in the main checkout** — a throwaway draft in a
git-ignored scratch directory is fine; the committed version belongs on a branch, in a
worktree. **Two doc branches landing in the same window are wrapped one at a time**,
each re-checked against the trunk the other just moved. **A branch that never touched a
given line still carries that line as diff context** — taking its side of a prose
conflict wholesale can silently revert the other session's edit while looking clean;
read the region and resolve as a union when the edits are non-contradictory.

Why, with the measurements: [ADR 94](docs/adr/94-planning-and-conclusion-writing-rationale.md).

##### Design conclusions are three units, not two

A design ruling needs one more part: an **immutable visual record**.

1. **The ruling** — on the Issue immediately, exactly as Step 1: chosen option, why, what
   was rejected. This is what clears `needs-decision` — recorded as the *Decision gate*
   section's `⚖ Decision recorded` marker (`colab decision --record`), never as prose
   alone with the label cleared by hand. Approval of a finished artifact is asked once
   the artifact exists, never at filing (*Decision gate*, #361), with a `Mockup:` line in
   the issue body (*Design-approval ask*, #379). Only a ruling recorded **after** that
   review approves the artifact. An earlier one, such as the ruling that let the work
   start, does not.
2. **The artifact** — a repo file under `docs/design/`, named `<slug>-<N>-mockup.html` or
   `<slug>-<N>-spec.md`, landing via a claimed docs branch. **Superseded artifacts are marked, never deleted.**
3. **The frozen evidence** — a screenshot of the approved option attached to the ruling
   comment, immutable where the repo file is not. Rejected alternatives need never land
   on trunk — their screenshot on the Issue is the whole record.

**Design work splits by size (#359) — one test, applied by whoever files or triages the
issue:** *does building this need a screen, page or panel that no approved artifact under
`docs/design/` already covers?* It is a judgement, like every other `delivery:*` value —
never inferred mechanically from a title, a body or a file path.

- **Yes — a new surface.** File a separate `delivery:design` issue first (*Delivery type*,
  above). Its deliverable is unit 2, and the artifact lands on **that issue's own branch**,
  worked by a design session. The build issue waits on it through a native `blocked_by`
  edge (`colab blocked <build> --by <design>`), which *Readiness* already honours — and
  through nothing else: no label, no artifact-presence check. When the design issue ships,
  the edge clears and the build issue is an ordinary start candidate that builds to the
  artifact now on trunk.
- **No — a small change to an already-designed surface.** The paragraph below holds
  unchanged.

**A missing artifact never blocks a small change.** The design gate is `needs-decision`, and only that. A consumer's label description,
agent prompt or local doc that says "needs an artifact before code" is stricter than
this section. A consumer that wants a build to wait on design files the new-surface
design issue and its edge, above — never an artifact check. Consumer docs should link to
[`code-triage`](skills/code-triage/SKILL.md) §6 (`design:` line) instead of restating
it. A ruling given elsewhere and never recorded does not block either. That includes
prose on the issue and a ruling on a linked issue. It still has to be written down as
unit 1, with `colab decision --record --ruled-by <human>`. Triage reports that case; it
does not treat it as a gate.

The index of what lives under `docs/design/` belongs in that directory itself — never
accreted into `CLAUDE.md`, which gets one pointer row.

##### Design exploration files its Issue first — before the first mockup, not after

**The Issue number must exist before the first mockup is drawn**, not retrofitted once
one is approved.

There is one size rule — the new-surface test in *Design conclusions*, above — and
exploration follows it. A small change explores on the issue that builds it. A new surface
explores on its own `delivery:design` issue, filed before the first mockup. When the build
spans several sessions, an `epic` parent holds the design issue and the build issues as
children, each build child carrying its own `blocked_by` edge to the design issue. The design issue is never itself turned into the epic.

`ceremony: light` repos are exempt from the file ceremony — a mockup lives as a preview
link in conversation, and units 1 and 3 collapse into one screenshot-bearing Issue
comment.

---

## 6. Releases

Tiers A and C — the two tiers that have production. The sequence differs by exactly one
step, the tag.

**Tier A.** A release is: **merge `dev` → `main`, then tag.**

```sh
git checkout main && git merge --no-ff dev && git push
git tag v1.2.0 && git push origin v1.2.0     # ← this is what deploys
```

Pushing the tag is the deploy trigger; pushing `main` only runs the full test suite.

**Single-trunk (tag-gated) Tier A** has no promotion — work already lives on `main`. A
release is just: **tag `main`.** Where the deploy is an external GitOps poller, tagging
is what the release script keys off — it fast-forwards the watched release branch.

**Tier C.** A release is: **merge `dev` → `main`. That is the deploy.**

```sh
git checkout main && git merge --no-ff dev && git push   # ← this is what deploys
```

Same `--no-ff`, never squash, for the same reason: the merge commit records what shipped
and when. No tag step, no "ship it later" — treat the promotion with the seriousness
Tier A gives the tag. Tagging on C is optional and harmless; wanting tags consistently is
the signal the repo has earned Tier A.

**[Hard — gate: colab promote refuses]** On a `deploy: manual` repo the sequence is the same, the last step performed by a person:
promote, tag, then run the runbook — promotion there always requires a human, and
`promotion: main-loop` cannot say otherwise. The final tag there is a human act too
(*Release routes*, below).

**Human gate count follows [exposure](#exposure--what-consumes-a-merge-here), not
preference.** An up-front yes can authorize an intent; it cannot authorize a result
nobody has seen. Where a merge's only consumer is the room itself (`self`), intent and
result share one reader, so [solo flow](#solo-flow--trunk-direct-issue-on-demand-entry-gated-a-human-must-be-at-the-keyboard)'s
single decision-time authorization already covers the whole cycle — decide, lock, do,
commit, record, unlock — with no separate look at the diff required. Where a merge
reaches beyond the room (`live`, `released`), the two audiences differ, so the gates must
too: approve the idea, then look at what actually shipped — on `released` with no
production, that look is a candidate's test period and its veto. The permission ladder
below is that second case, at full length.

**[Hard — gate: pre-push-guard hook]** **The permission ladder, one rung per boundary:** **ship** (branch→trunk, gated by
`autonomy:`) · **promote** (trunk→main, gated by `deploy:`+`promotion:` — safe to
automate only where deploy is tag-gated) · **release** (the tag, gated by exposure:
automatic candidates, and a final tag that is automatic only where nothing deploys from
it — *Release routes*, below). The `pre-push-guard` hook enforces the
first two mechanically; `COLAB_SHIP` never opens `main`.

How the tooling tells its own merges and promotions from a hand push, and why no agent ever
asserts that identity by hand, is the CLI's:
[`tools/docs/releases.md`](tools/docs/releases.md#process-identity--the-ship-and-promote-variables).

**[Hard — gate: colab promote refuses]** **On Tier C the ladder has two rungs, not three, and the second is the deploy** —
promotion there always requires `COLAB_HUMAN=1`; `promotion: main-loop` applies only
where `deploy: tag` makes promotion verification-only, so it can never apply to C.
Nothing about C widens what an agent may do: `autonomy: auto-trunk` still only ever
merges into `dev`, which does not deploy.

**[Hard — gate: colab release finalize stops]** **Release routes — how a repo releases, and the one human gate (#420; formerly *The release
rung*, #330 — tool messages citing that name mean this paragraph).** Every version number is computed, every candidate is cut by a trigger, and a human
is asked exactly once: **for the final tag on a repo where that tag deploys production**
(`deploy: tag`, and `deploy: manual`, where a person deploys from it) — one click, number
pre-filled — unless the operator has granted one `deploy: tag` repo an automatic final
(*An operator-granted automatic final*, below), or a final on every green head with no
candidate at all (*A final on every green head*, below). Everything else is automatic, and a human can still veto any candidate with
`release-hold`. Every candidate is `vX.Y.Z-rc.N`; the final `vX.Y.Z` is that candidate's
commit, tagged final — on every route but `library-fast`/`deploy-tag-fast`, which cut none.

| Route | For | Candidate `vX.Y.Z-rc.N` | Final `vX.Y.Z` |
|---|---|---|---|
| `none` | `exposure: none` / `self` — nothing consumes a tag | no tags | no tags |
| `rapid-app` | a fast-moving app with few installers | automatic, on every green trunk head | automatic: the **newest** candidate clean for the test period; a newer candidate does not restart an older one's clock |
| `public-tool` | a public CLI or handbook — adopters install it, nothing deploys | automatic, on every green trunk head (#443) | automatic after a clean test period |
| `library-fast` | a library released per merge, its consumers pin | none | **[Hard — gate: colab release cut refuses]** automatic once a first final exists (a human's): `colab release cut` tags it on a green trunk head and the release run publishes it; under `version-source: manifest` the version is the manifest's, so a merge that bumps it releases that version and one that does not is a no-op; the route's checks still apply, nothing deploys (#590) |
| `deploy-tag` | `deploy: tag` / `deploy: manual` — the tag deploys production | automatic; the agent prepares everything | **a human act (one click)** — automatic only on a `deploy: tag` repo the operator granted it (#441) |
| `deploy-tag-fast` | `deploy: tag` with the operator's grant and a declared health-gated deploy (#446) | none | automatic on every green trunk head, deployed in the same run, finals at least `final-spacing` apart |
| `live` | `exposure: live` (Tier C) — the merge is the deploy | unchanged — no automatic tags; the promotion is the deploy and stays human; tagging stays optional | — |

**A repo declares its route as `release.route`; absent, it is derived from `exposure` +
`deploy`** — `none`/`self` → `none`; `live` → `live`; `released` with `deploy: tag` or
`deploy: manual` → `deploy-tag`; `released` with `production: null` and `deploy: none` →
`public-tool`. That last row is the only one that offers a choice: it may declare
`rapid-app` or `library-fast` instead. The `deploy: tag` row may declare `deploy-tag-fast`,
and only with the operator's grant and a health gate (*A final on every green head*, below) —
missing either, the route is an audit failure and `deploy-tag` stays in effect. Any row may declare `none`. A declared route its row
does not permit — `public-tool` on a repo whose tag deploys, `deploy-tag` where nothing
deploys — is an audit failure, never an override: change `exposure`/`deploy` first if the
repo really changed. Anything the table does not name — an undeclared or unknown
`exposure`, a bare legacy `tier: B`, a `released` repo whose `deploy` matches no row —
derives **no route** and fails closed: no automatic tag, a human tags. Legacy `tier: A`
reads as `released` and takes the route its `deploy` names. Where the final tag is a human
act, no value in `project.yml` lowers that — the one way is an operator's recorded grant,
below, which is a human act and not a value. A repo may **narrow** its route — turn
candidates off, cap candidates per day, make an automatic final human, lengthen the
test period — with the [`release:` block](project.schema.md#release--optional) (#337); a
block that tries to widen it is an audit failure, not an override.

**The release contract (#637).** Whatever tooling a repo uses, every route that tags keeps these
rules. How this repo's CLI and templates carry them out — the cut, the finalize, the release workflow,
channels, publishing and deploys — is documented with the CLI, in
[`tools/docs/releases.md`](tools/docs/releases.md).

1. **[Hard C6.contract.01 — refuse: a candidate on a commit failing any of the four conditions]**
   A candidate is cut only when all four conditions hold, on the exact commit it names: (1) CI is
   green on that commit; (2) the full suite passed on it; (3) every schema change since the last
   final is additive ([*Switched epics*](#switched-epics--concurrent-unfinished-features-336),
   rule 5) — a destructive one is a person's decision; (4) switch dependencies are satisfied (rule 3).
2. **[Hard C6.contract.02 — refuse: an automatic final before its test period ends clean]**
   An automatic final waits out its candidate's test period — three days unless a route lengthens
   it, clean only if trunk stayed green throughout and no regression against the candidate is open —
   and every condition is checked again at the moment the final is tagged. Only a person who answers
   for the release may finalize early, and the release records who answered.
3. **[Hard C6.contract.03 — refuse: finalizing a candidate a person has held]**
   A person may hold any candidate; only a person releases the hold, and a held candidate is never
   finalized.
4. **[Hard C6.contract.04 — refuse: a deploying final tagged automatically without a recorded grant]**
   Where a final tag deploys production, the final is a person's act. The two exceptions —
   [*An operator-granted automatic final*](tools/docs/releases.md#an-operator-granted-automatic-final-441)
   and [*A final on every green head*](tools/docs/releases.md#a-final-on-every-green-head--deploy-tag-fast-446) —
   each need the operator's grant: a ruling a person recorded, never written by an agent, per repo and
   revocable at once. A release carrying a database migration still waits for a person's grant.
5. Nothing deploys a candidate, and no agent tags a candidate or a final by hand around the release
   tooling.
6. A version a user sees reads the tag, or a stamp made from it at release or build time — never a
   commit the release pushes to trunk.
7. **[Hard C6.contract.07 — refuse: a release channel moved by hand or moved backwards]**
   The release channels — one naming the newest final, one the newest candidate — move only forward,
   and only by the release step.
8. Every tag gets a release summary grouped by commit type, owed even when the release automation
   cannot run; and the gap between merged and released is measured, never noticed by eye.

**Versioning** — SemVer. Patch for fixes, minor for features, major for breaking changes.
Pre-1.0 repos use `v0.x.y`, treating minor as "meaningful increment".

**Every version number is computed — majors included. No human picks or approves a
number.** Since the last final tag:

- **fixes / chores only** → **patch** (`1.2.0` → `1.2.1`);
- **any feature, or an epic's switch-removal child merged** → **minor** (`1.2.1` → `1.3.0`);
- **a breaking change** → **minor below 1.0** (SemVer §4 — anything may change at `0.y.z`:
  `0.4.2` → `0.5.0`), **major from 1.0** (`1.3.0` → `2.0.0`). Breaking means any of: `!` or
  `BREAKING CHANGE:` in a commit; a repo guard reporting a destructive schema,
  config-format or API-response change; a removed or renamed export.
- **[Hard — gate: colab release cut refuses]** **A major must carry a migration section with the measured cost** — what an adopter or
  consumer has to change, and how much of it was measured — **or it is refused.** A major
  with no migration section is not cut, by the workflow or by hand.

**Put the reasoning in the release notes**: the
bump computed, which input decided it, and each breaking change found — or that none was,
and what was checked. Why: [ADR 539](docs/adr/539-releases-routes-rationale.md).

**An unfinished feature never waits for a release, and never reaches one switched on.** On
a repo that tags, a feature landing over several merges is an epic behind a switch: it
ships **dark** in every release until its last child removes the switch, releases are cut
from trunk with every remaining switch off, and a version lives in a tag, never in a
branch name. The rules, the scope, and the marker a check reads:
[*Switched epics*](#switched-epics--concurrent-unfinished-features-336).

Do not tag from `dev`. Do not tag a commit that has not passed the full suite on `main`. On a
`trunk: dev` repo the candidate is cut on the promotion merge, and its manifest version is read
there — a version bump reaches `main` through the promotion, never after it.

### Distribution — one install surface: npx (#442)

Every distributed tool has one install surface that needs no extra client or token, a release page is
never the install path, and a private repository never publishes to a public registry. The install
routes, dist refs and what the audit checks:
[`tools/docs/distribution.md`](tools/docs/distribution.md#distribution--one-install-surface-npx-442).

### Services over npx — init, update, rollback (#465)

A tool that runs as a per-machine service never runs from a package cache or a checkout: versions are
installed side by side, an update that fails its health check switches back, and per-machine config,
state and secrets live outside the install. The verbs and the template:
[`tools/docs/distribution.md`](tools/docs/distribution.md#services-over-npx--init-update-rollback-465).

---

## 7. CI and toolchain

**Your CI lives in your repo and belongs to you.** [`templates/`](templates/) ships
copyable starting points — nothing is mandatory, and only the instruction-files workflow and the
[artifact-store actions](#ci-artifacts--your-own-store-not-the-allowance-601) are called remotely (or copied). That includes the
deploy templates (`deploy-xserver.yml`, and `deploy-container.yml` with its driver and platform
adapter, #452 — [§6](#6-releases)): the handbook checks its own copies with `actionlint` and the
container deploy's logic with hermetic tests against a fake platform, and a copy is the
adopter's to keep green from then on.

The required **outcome**: every pull request must run, at minimum, a **secret scan** and
a **build**.

**CI must trigger on pushes to the trunk itself**, not only on branches the trunk no
longer is. Why: [ADR 539](docs/adr/539-ci-toolchain-rationale.md). When a repo's
trunk moves, updating the CI triggers is part of the move, and the audit checks it.

### What ship reads — the CI contract (#607)

**The handbook holds a CI contract, not a CI.** What a repo's CI runs, and on which runners, is
the repo's business; these four invariants hold whatever it runs (#635):

1. **[Hard C7.contract.01 — refuse: a merge onto a red trunk unless the change is that red's fix]**
   Never merge onto a red trunk; only its fix lands
   ([*Red-trunk exemption*](#red-trunk-exemption--the-one-shot-door-through-trunk-ci-green-105),
   [*Cure rule*](#cure-rule--the-machine-checkable-door-through-trunk-ci-green-281)).
2. **[Hard C7.contract.02 — refuse: a CI result read from any commit other than the one judged]**
   A CI result counts for the exact commit it ran on — never for a newer or older one, and never
   as "the latest run".
3. **[Hard C7.contract.03 — refuse: a landing whose branch head has no finished green result]**
   A branch lands only on its own green, at its own head
   ([*Branch CI*](#branch-ci--the-candidates-own-run-read-as-a-class-314)); a documentation-only
   change is the one exception ([*Docs-only*](#docs-only--no-ci-wait-606)).
4. **`project.yml` declares what CI a repo has**:
   [`ship-gate-workflows`](project.schema.md#ship-gate-workflows-ship-ignore-workflows--optional)
   names the workflows whose runs are its CI; absent, the runs that pushes and pull requests
   trigger are.

How the CLI reads runs, lanes, profiles and runners — the mechanism that enforces these today — is
documented with the CLI, in [`tools/docs/`](tools/docs/README.md).

### Two lanes — light on every merge, heavy on official builds and nightly (#607)

A repo may split its CI into a light lane on every push and a heavy lane on official builds and
nightly; the templates ship that shape. The lanes and how the CLI reads them:
[`tools/docs/ci-lanes.md`](tools/docs/ci-lanes.md#two-lanes--light-on-every-merge-heavy-on-official-builds-and-nightly-607).

### Integration profiles — where the heavy lane runs, and what a green trunk promises (#610)

[`integration-profile:`](project.schema.md#integration-profile-heavy-workflow--optional)
declares where the heavy lane runs and what a green trunk promises. The four profiles:
[`tools/docs/ci-lanes.md`](tools/docs/ci-lanes.md#integration-profiles--where-the-heavy-lane-runs-and-what-a-green-trunk-promises-610).

### CI — what it is follows the unit's shape, how much follows exposure

**What CI *is* comes from whether the unit has a branch — a fact about the session, not a
declared value**.
With a branch — the ordinary worktree session, or an attended trunk-direct one falling
back to full ceremony — CI runs before the merge: a gate, something to inspect before a
unit lands. An attended trunk-direct session with no branch runs it after the push — an
alarm, not a filter, exactly as [Recovery](#recovery--what-must-exist-to-undo-a-merge)
already found for solo flow. Same file, two different instruments; reading a post-push run
as a gate is the mistake that leaves trunk-direct trusting something caught what an alarm
can only report.

**A repo where a pre-merge gate must inspect every unit says so by having one — a
trunk-gating CI workflow, or branch protection — never by a declared value.** This is
where the retired `writes: serial-gated` spelling's one real assertion ("a pre-merge gate
exists here") now lives: [Writes](#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)'s
second mandatory-branch condition ("a gate must inspect the unit before it lands") reads
this fact, not a field.

**How thorough it must be comes from [exposure](#exposure--what-consumes-a-merge-here).**
`none` and `self` answer only to the room; `live` and `released` answer to a consumer with
no way to ask a clarifying question, so more has to be caught before it reaches them. With two
lanes ([below](#two-lanes--light-on-every-merge-heavy-on-official-builds-and-nightly-607)), `live`
and `released` run the heavy lane before every official build; `none` and `self` may run it
nightly only.

**On low-exposure repos the gate is often not CI at all.** A deploy script that refuses a
dirty tree is a stronger gate than any CI run, because it is the last thing before the
artifact exists. The rule is therefore not "trunk-direct needs green CI" — it is
**trunk-direct needs a gate somewhere other than CI's alarm**, at the deploy step if
nowhere else. Where nothing gates the deploy either, trunk-direct is unsafe, and that is
the finding to report — not a CI run trusted to be the filter it structurally cannot be.

**Provision CI for planned exposure, not current.** A repo declaring `exposure: none`
with a named `production:` — the transitional pairing
[Exposure](#exposure--what-consumes-a-merge-here) already flags — should already run at
`live` thoroughness, free to be red, rather than discover the gap on cutover day.

**Test contracts follow the named consumer**, once
[channels](#channels--by-what-path-does-code-reach-the-thing-that-runs-it) names one: for
`artifact`, the test that matters is whether a fresh adopter's copy works, not a unit test
of the generator; for `live`/`released`, the promotion or release path is the product; for
`self`, whatever would break the room's own ability to work.

**A repo holding an unfinished switched epic runs its suite twice** — once in the release
configuration, once in development — because those are the only two it supports and the
release one is what ships
([*Switched epics*](#switched-epics--concurrent-unfinished-features-336), rule 2).

**No `ci:` field.** A repo needing something its copied templates don't cover edits that
workflow directly — copy-and-own already permits it, and the audit reads the edit as a
suggestion at most (#607). See
[`project.schema.md`](project.schema.md#ci--deliberately-not-a-field).

### CI artifacts — your own store, not the allowance (#601)

Where CI jobs keep the files they pass each other is the repo's business; the templates' store:
[`tools/docs/ci-lanes.md`](tools/docs/ci-lanes.md#ci-artifacts--your-own-store-not-the-allowance-601).

### Self-hosted runners — capacity is the agent count, not the machine (#355)

Which runners a repo's CI uses is the repo's business. Guidance for self-hosted runners:
[`tools/docs/ci-lanes.md`](tools/docs/ci-lanes.md#self-hosted-runners--capacity-is-the-agent-count-not-the-machine-355).

### Toolchain versions — strict precedence

**Never hardcode a version in CI.** Resolve it, in this order:

1. **`.github/project.yml`** toolchain keys, if present — wins.
2. **The ecosystem's own manifest** (`.nvmrc`/`engines.node`; `composer.json`;
   `.python-version`/`requires-python`) — the normal answer.
3. **Fail the build.** Never fall back to a default.

When project.yml's pin and the manifest disagree, that is a
finding to report, not resolve quietly.

**`requirements.txt` does not declare an interpreter** — pins dependencies only; a Python
repo carrying only that file must add `python:` to `project.yml` or a `.python-version`. **A missing template is not a
neutral absence** — it redirects adoption into a worse form and leaves behind a file
whose header lies about what it is. Why, with the measurement: [ADR 539](docs/adr/539-ci-toolchain-rationale.md).

### Test fixtures — neutralise ambient machine state, don't inherit it

**A test asserting a specific message or refusal must neutralise ambient credentials and
configuration rather than inherit them.** A git fixture helper sets
`user.email`, `user.name`, **and** `core.hooksPath` (pointed at a nonexistent directory)
before it ever commits. Why, with the measurement: [ADR 539](docs/adr/539-ci-toolchain-rationale.md).

---

## 8. Conformance and reconciliation

Because branch protection is unavailable, conformance is checked **from outside** by the
[`audit/`](audit/) tool, across every owner including local-only repos:

```
example-org/service-api          tier A   ⚠ node: engines=22 but ci.yml pins 20
example-org/mobile-app           tier B   ⚠ missing .github/project.yml
```

Run it on a schedule; only genuine findings fail the exit code.

### How repos find out when the handbook changes

The handbook is git-tagged `vX.Y.Z` (its current version is
`git describe --tags --abbrev=0 --exclude '*-*'` — a pre-release tag such as `v1.3.0-rc.1` is
never the current version, #334; before the first release tag it is treated as `v0` and stamp
checks stay inactive). Templates are **copy-and-own**, never called remotely. Every copy
is **stamped** with the handbook version it came from:

- Workflow copies: `# colab-handbook: <template> @ <version>`.
- The CLAUDE conventions block: `<!-- colab-handbook @ <version> -->`.
- **[Hard — gate: colab template refuses]** **`colab template <name>`** copies and stamps in one act, refusing to overwrite without
  `--force`.

The audit compares each stamp against the handbook's git history: a template **changed
since the stamped version** is a finding; an unstamped copy, unknown template, or a
stamp newer than the handbook is advisory — except on a CI template (`ci-*`), where each is a
`▸` suggestion: CI templates are guidance (#607). Reconcile deliberately: read the diff,
`colab template <name> --force`, commit.

**A rule-neutral change downgrades the finding to a warn — declared, never inferred
(#272).** Bytes drift is always a hard fail by default: a repo stamped against an old
template gets `fail` the moment anything in that template changed, including a fix that
touches no rule at all. Why: [ADR 539](docs/adr/539-conformance-rationale.md). Instead of a classifier, the person editing `templates/` states the claim themselves, at the moment
they know it best — as a `Rule-Neutral: yes` trailer on the commit:

```
fix(templates): point repo-CLAUDE-block.md's org link at this repo's own origin

Rule-Neutral: yes
```

- The audit only downgrades fail→warn when **every** commit touching that template
  since the adopter's stamp carries the trailer — one undeclared or ordinary commit in
  the range and the whole span stays a hard fail, same as today.
- **Declaring nothing is the default and it is exactly today's behaviour** — an editor
  who never writes the trailer changes nothing about how drift is reported.
- This is a claim about intent, not a computed fact — a false declaration is a human
  error to catch in review, the same as a false `Closes #N` or a mis-typed commit
  prefix elsewhere in this file; the audit trusts the trailer exactly as far as it
  trusts the person who wrote it.
- **[Hard — gate: squash trailer allowlist]** **The trailer must survive the squash.** This repo's own [§4](#4-branches-and-commits)
  squash-merges a branch into one trunk commit, and the audit reads only trunk history
  — never the pre-squash branch commits the declaration was written on. `Rule-Neutral`
  is on the squash's carried-trailer allowlist (`tools/lib/squash.js`) for exactly this
  reason; dropping it from that list would make the declaration invisible the moment the
  branch that wrote it merges, on this repo specifically.

**[Hard — gate: colab update refuses]** `colab update` classifies every stamped copy and, with `--apply`, refreshes only those
still pristine as of their own stamp — never commits, never rewrites a hand-edited copy.

- **A stamp older than current is not "behind"** — behind means the template *actually
  changed* since that stamp (`git log <stamp>..HEAD` scoped to the template's path).
- **The frozen CLI copy is measured against the latest tag, not `HEAD`**. Why: [ADR 539](docs/adr/539-conformance-rationale.md).
- **[Hard — gate: colab update refuses]** **An unstamped copy is never rewritten** by any flag — unknown lineage, human re-copies
  deliberately.
- **[Hard — gate: colab update classifies]** **Provenance is decided by content, never filename** — a file merely sharing a
  template's name is reported `unrelated`, explicitly not something to re-copy.

### Labels reconcile too — not just stamped files

An adopted repo missing any convention label is a finding — provided the audit can read
the label set at all; a remote-less or offline audit stays silent rather than claim a
label is missing it simply could not see. Label-set provisioning is idempotent
(`|| true`) and safe to re-run on every sync — the mechanism by which a label added in a
later handbook version reaches an earlier-adopted repo.

### Local policy — a repo refines a skill without forking it (#520)

A team that wants a handbook skill to behave differently in its repo — write Issue comments
in another language, run an extra check before wrap, skip a step its stack has no use for —
writes that in **`.colab/skills/<skill>.md`**, one optional file per skill, free prose. Every
skill opens with a block that loads the file: an injection line that agent runtimes supporting
load-time expansion fill in with the file's text, and a plain sentence — *if
`.colab/skills/<skill>.md` exists in this repo, read it before continuing* — that is the
runtime-neutral path and works on its own. With no file, the skill runs unchanged. A large
skill is a short core `SKILL.md` plus reference files beside it (#524); the core keeps every
step under its own number, so an overlay names the step it refines (`code-ship` B1c,
`code-sweep` §3) and never has to point into a reference file.

**[Hard — gate: docs-only classifier]** **Precedence:** local policy refines the skill for this repo and wins over the skill's own
text where they differ. **It never changes a `colab` gate** — a refusal from `colab ship`,
`colab claim` or any other command is not prose an overlay can talk past; the gates read git
and the tracker, not this file. Because the file is agent instructions, a diff touching
`.colab/skills/` is never [docs-only](#autonomy--the-docs-only-exception-345): it merges on
`auto-trunk` or a human's go, like a `CLAUDE.md` change.

Why a file and not a fork or a field: [ADR 539](docs/adr/539-conformance-rationale.md).

The handbook defines this one layer and nothing on top of it. Org- or machine-wide layers,
size limits, drift checks against upstream, and tooling to manage overlays are the adopter's
business.

### Upstream — a consumer that changes what a convention means files it here (#362)

Everything above runs one way: the handbook changes, and adopters find out. A **consumer** is anything that reads these conventions in order to
act on them: a dashboard, a scheduler, a triage or ship prompt, a repo's own copy of a
skill, a label description on a tracker. A consumer can change what a convention means
with a commit in its own repo, and nothing made the handbook hear about it. Why, with the measurement: [ADR 539](docs/adr/539-conformance-rationale.md).

**The rule.** A consumer change that does either of these carries a linked handbook issue:

- **It alters what a convention label or value means.** That covers which lane starts an
  issue carrying it, whether it gates a start, who may apply or clear it, and where it
  routes the work.
- **It adds a value inside a convention family** (`delivery:*`, `deferred:*`).

A repo's own labels outside those families (`bug`, `area:billing`) are not conventions,
and neither is a hand-edit to a copied template (that is copy-and-own, above).

- **Who files it: the author of the consumer change**, as part of the same unit of work.
  A later reviewer or a later sync does not own it.
- **How fast: before the consumer change reaches its own trunk.** The consumer's issue or
  merge message then carries a `Handbook: <issue URL>` line. A divergence discovered after
  the fact, with no such line, is filed by whoever discovers it, in the same session. It
  is never deferred to "the next sync".
- **Its provenance is the consumer change's, not the filer's.** The upstream issue records
  a decision a human already approved on the consumer side. It proposes nothing on an
  agent's own initiative, so it carries **no `agent-filed` label**. Its `Filed-by:` line
  names whoever approved the consumer change ([§5](#provenance--who-decided-the-work-should-exist)). The upstream issue describes the consumer by shape. The link runs
  consumer → handbook, never the reverse, because the handbook is public.
- **The upstream issue ends in one of three outcomes:** the handbook adopts the meaning,
  the handbook declines it and the consumer reverts, or the handbook rules it a legitimate
  local variant.

**Declared, or it is drift.** Until the upstream issue closes, the consumer declares the
divergence in its `CLAUDE.md`, next to the handbook pointer block
([§9](#9-adopting-this) step 5) — in `CLAUDE.md` even when that file is a thin shell over
`AGENTS.md`, because the list belongs beside the block it qualifies, as a `Local divergences:` list with one line per item.
Each line gives the label or value, what it means here, and the handbook issue URL. When the issue closes, remove the line if the meaning was adopted or reverted. If the
issue ruled it a local variant, keep the line and point it at that ruling. An undeclared
consumer-local meaning or value is **drift, not a local customisation**. Copy-and-own
protects a repo's edits to its *copies*. It never makes the *meaning* of a shared label
the repo's to change.

**Where a missing issue gets caught: `handbook-sync`.** This is the enforcement point,
chosen over the two alternatives:

- **The consumer's ship** sees one diff. It cannot tell which strings in that diff are
  convention vocabulary without also loading the handbook.
- **The handbook's triage** runs on the handbook's tracker. It never sees a consumer's
  tooling.
- **`handbook-sync`** is the one pass that stands inside the consumer with the handbook
  loaded. It is also the only one of the three that sees **the reverse direction**: a
  handbook change the consumer's own prompts never absorbed. `colab labels --ensure` creates missing labels and never rewrites an existing
  description on its own, so a description can drift in either direction. Since #364 the
  drift is at least visible: `--ensure` and the audit both name every convention label
  whose tracker description differs from the handbook's, and
  `colab labels --ensure --refresh-descriptions` rewrites them on request (`--keep <name>`
  spares a declared divergence).

The filing obligation still sits with the change. `handbook-sync` is where a skipped one
gets found (`skills/handbook-sync/SKILL.md` §7).

### Refusals name the next command (#532)

**[Hard — gate: refusal-sites test]** **Every refusal `colab` prints ends with the exact next command
that gets the user forward**, or says plainly that no command can and who decides. "Retry later"
counts only when it names what to wait for, and an interactive flow checks each answer when it is
given. `tools/lib/refusal-sites.test.js` fails on a new refusal without one; older refusals are
listed in `tools/lib/refusal-sites.known.json`, which only shrinks. Why: [ADR 532](docs/adr/532-refusals-name-the-next-command.md).

### The fleet registry is private

The list of repos the audit sweeps lives at `~/.colab/repos.txt`, machine-local, never
committed, because this handbook repo is public. The committed
[`audit/repos.txt`](audit/repos.txt) is a neutral format example and last-resort fallback
only. Resolution order: `--config` flag > `~/.colab/repos.txt` > bundled example.

---

## 9. Adopting this

Adoption is a procedure, and a procedure lives with the skill that walks it:
[`skills/handbook-sync/2-adoption-procedure.md`](skills/handbook-sync/2-adoption-procedure.md)
holds every step, command and trap, moved there verbatim by #640 (the human-gated mechanics of
the adoption tool sit in [`tools/docs/adoption.md`](tools/docs/adoption.md)). This section keeps what
an adoption must leave true, in words that name no tool.

**The adoption contract (#640)** — the rules the procedure serves:

1. **The descriptor answers five questions, asked as a person answers them** — whether a deploy
   target exists and how it is reached, who else works here, what would break on a wrong merge
   ([`exposure`](#exposure--what-consumes-a-merge-here)), whether trunk-direct is allowed
   ([`writes`](#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)), and by what
   path code reaches what runs it ([`channels`](#channels--by-what-path-does-code-reach-the-thing-that-runs-it)).
   Only the two that change the gate count (production and deploy; exposure) are asked at
   adoption; the other three may be answered later.
2. **What the repo already states is detected, never asked** (trunk, stack, toolchain, ports),
   and what follows from the answers is derived, never asked (gate count, ceremony, whether a
   branch is mandatory).
3. **Asking is not writing.** A sync or an interrupted adoption records a person's answer; it
   never fills a missing key on its own and never deletes a declared one to quiet a warning.
4. **Only a person writes that nothing, or only the room, consumes a merge** — the asymmetry is
   [§2's](#exposure--what-consumes-a-merge-here), and adoption does not relax it. An agent may
   propose `live` or `released` from committed evidence, never `none` or `self`.
5. **The descriptor reaches trunk by a person's act**, and the tracker's convention vocabulary
   exists before the first claim is made on it.
6. **The instruction files keep one shape:** repo prose in `AGENTS.md`; `CLAUDE.md` a thin
   shell that imports it and carries only the blocks tools look up by that name; no block in both.
   A fork keeps its upstream's files and appends.
7. **Going live waits for a deploy target that exists today**, and the path to production is
   committed before anything else changes; the exposure and channel answers are then asked again.
8. **In a repo you don't own, nothing lands in the owner's history.** The descriptor stays local
   and untracked, trunk names your own integration branch, and the owner's branch moves only by a
   merge the owner makes.
9. **Existing branches are grandfathered**, and no `dev` is created where nothing is live
   ([§2](#2-tiers)).

### Any repo, first-time adoption

Contract items 1–6. The nine steps, the question table and the label set:
[`2-adoption-procedure.md`](skills/handbook-sync/2-adoption-procedure.md#any-repo-first-time-adoption).

### Going live: Tier B → Tier C or Tier A

Contract item 7 — on the day a deploy target exists, not before. The eight steps:
[`2-adoption-procedure.md`](skills/handbook-sync/2-adoption-procedure.md#going-live-tier-b--tier-c-or-tier-a).

### Tier C → Tier A — when the site earns a release ritual

Retrigger the deploy on a tag; the descriptor follows. The steps, and the reverse A → C fix:
[`2-adoption-procedure.md`](skills/handbook-sync/2-adoption-procedure.md#tier-c--tier-a--when-the-site-earns-a-release-ritual).

### Working in a repo you don't own

Contract item 8. The local-only minimum, the integration-branch pattern, delivery to the owner
and the measured traps:
[`2-adoption-procedure.md`](skills/handbook-sync/2-adoption-procedure.md#working-in-a-repo-you-dont-own).

### A fork of an upstream — a repo you own that tracks one you don't (#449)

Contract item 6's last sentence: the fork adopts in full, and the upstream's files are appended
to, never rewritten. The four changes from first-time adoption:
[`2-adoption-procedure.md`](skills/handbook-sync/2-adoption-procedure.md#a-fork-of-an-upstream--a-repo-you-own-that-tracks-one-you-dont-449).

### Fixtures and examples use invented values

**Test fixtures, sample data and documentation examples MUST use invented values.**
Never a real hostname, account handle, filesystem path, internal domain, customer or
partner name — even when the real value is what was measured. Write `build-box-01`,
not the machine you ran it on.

**Where the real value genuinely matters** — a reproduction that only makes sense against
a specific environment — it belongs in an Issue on a private tracker, not in a tracked
file. The destination decides, exactly as it does for
[§4](#4-branches-and-commits)'s commit messages.

**The rule has a mechanism, and it is not CI.** `templates/pre-commit-identity` scans
staged content against a vocabulary of strings the operator says must never be published,
and `templates/pre-commit-dispatch` composes it with the secret scan a repo already has.
**The scanner is shipped; the vocabulary never is** — a list of the exact strings an
organisation treats as sensitive is a precise index of what to look for, so it is supplied
by path and kept outside every repo. Adoption steps:
[`templates/README.md`](templates/README.md).

Two things the hook cannot see, both real. **Repository metadata** — description, topics,
homepage, the name itself — never passes through git, and it is the first thing a visitor
reads; that needs a periodic sweep instead (`node audit/audit.mjs --identity`, documented
in [`audit/README.md`](audit/README.md), reading the same operator-supplied vocabulary and
refusing to run without one). **A machine with no vocabulary configured** scans nothing,
and says so on every commit. Neither is a reason to relax the rule above. Why, with the
measurement: [ADR 539](docs/adr/539-adoption-fixtures-rationale.md).

---

## 10. Anti-patterns

Each lesson is now a rule in the section it governs (#640); the lessons, and the incidents
that taught them, are kept together in one file.

Why, with the stories: [ADR 539](docs/adr/539-anti-patterns-rationale.md).

---

## 11. Quick reference

The commands behind these conventions are tool text, so they live with the tool:
[`tools/docs/quick-reference.md`](tools/docs/quick-reference.md) (#640).

---

*Changes to this file are changes to how everyone works. Explain the why in the PR body.*
