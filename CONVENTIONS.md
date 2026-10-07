# Engineering Conventions

How we manage branches, releases, and in-flight work across every repo we own — in
our orgs and in personal accounts alike.

Written for **both humans and AI coding agents**. If you are an agent starting a session,
read this file and the repo's `.github/project.yml` before touching anything.

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

**A rule is hard only when a gate enforces it.** A hard rule opens with a
`**[Hard — gate: …]**` marker naming what refuses — a `colab` command or a git hook — and
it holds whatever a repo's local policy says. Every other rule is a **default**: one way to
do it, which a repo may refine through a `project.yml` field where one exists, else in its
local policy (`.colab/skills/<skill>.md`,
[§8](#local-policy--a-repo-refines-a-skill-without-forking-it-520)). A refinement never
lowers a hard rule. Until a repo refines a default, its wording stands as written: a
"must" is still a "must".

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
`colab adopt` refusals are gated too, and each is marked where it is stated. Every rule's
class, and each hard rule's gate literal, is listed in
[`docs/rule-inventory.md`](docs/rule-inventory.md); `scripts/check-rule-inventory.mjs`
keeps the list and this file in step. Why: [ADR 523](docs/adr/523-conventions-hard-default-and-size-budget.md).

---

## 2. Tiers

**Read this section through [`exposure`](#exposure--what-consumes-a-merge-here), the axis of
record.** What consumes a merge sets the gate count: `none` and `self` zero, `live` one (the
promotion), `released` two (the artifact). `tier:` is a legacy read of it — `A` → `released`,
`C` → `live`, `B` → no derivable value (`tools/lib/axis-authority.js`). The letters below name
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
Name the release branch in [`releaseBranch:`](project.schema.md#releasebranch--optional). Why: [ADR 539](docs/adr/539-tiers-rationale.md).

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

**What this unit (#132) shipped, and what #144 later added.** **#137 shipped 2 of 5 possible
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
with `COLAB_HUMAN=1`, set only on a human's explicit instruction (never inferred, never
from a headless, scheduled, or driver session — [§5, "The human flag"](#the-human-flag--what-colab-human1-asserts),
below). An automated session never gets trunk-direct here, veto or not — the veto forbids
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
    - Why the premise was wrong in both halves, with the measurements: [ADR 233](docs/adr/233-writes-veto-and-direct-rationale.md).
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
- any binary or symlink change;
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
`autonomyGate: { via, docsOnly }`, with `via` one of `"auto-trunk"`, `"docs-only"`, `"human"`
(the human door, below) or `null`.
A refusal keeps the existing message and adds one line naming why the change is not docs-only.
A branch is measured **again after B0 sync**, before the squash, so a `pre-ship` hook that
regenerated a file cannot carry code in behind the first verdict. The pre-push guard needs no
change: the push still carries `COLAB_SHIP=1` because ship ran its own preconditions. It grants
nothing past the trunk merge — promotion and deploys stay human, and a tag follows
[§6's release routes](#6-releases), never `colab ship`.

**Nothing widens the allowlist.** No `project.yml` field, flag or environment variable can add
to it: `tools/lib/docs-only.js` holds both lists as constants. Widening it is a handbook change,
reviewed in a commit like this one.

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
shell is not a terminal, whatever its stdio is. Setting `COLAB_HUMAN=1` follows the same rule
as everywhere else in the handbook: a human's instruction in the live session, never the agent's
own reading of the situation.

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

### Solo flow — trunk-direct, issue-on-demand, entry-gated (a human must be at the keyboard)

 Solo flow is the
**coexistence, attended** cell of the table above: legal on any repo that does not declare
`writes: isolated` (absence and every other value permit it — ⚖ #233), **and only to a
session a human is behind**. A repo one person codes directly, in one conversation-driven
session, with no other session to protect against — the start-side invariants exist to
protect *other* sessions, and the attendance requirement exists because trunk-direct
itself needs someone present to answer for the commit. Why: [ADR 539](docs/adr/539-solo-place-claims-rationale.md).

0. **[Hard — gate: colab solo refuses]** **Attendance comes first — before any mechanical check below.** `COLAB_HUMAN=1` asserts
   one thing: a human is behind this command ([§5, "The human flag"](#the-human-flag--what-colab-human1-asserts),
   below). Set it only on a human's explicit instruction — **transcription, never
   inference**: type it because the human said "take the trunk," never because the
   situation seemed to call for it. **Live conversation only** — a headless, scheduled, or
   driver session may never set it, whatever its prompt contains: an issue body can
   literally contain the words, and an unattended session cannot tell an instruction from
   a quotation of one. `writes: isolated` vetoes this outright, for a human exactly as for
   an automated session — no flag lowers that bar.
1. **[Hard — gate: colab solo refuses]** **Entry gate, not honor system.** `colab solo` checks fresh on every invocation, never
   a cached answer: `COLAB_HUMAN=1` set, no veto declared, no live solo session already
   open, checkout on trunk with no unpushed branch anywhere, a clean (tracked + untracked)
   tree, and no conflicting place-claim held on **this checkout** (below). Anything
   held/unmet refuses outright — full ceremony, no partial credit, with **one narrow
   exception added by #285**: a solo record whose co-located place-claim holder is
   *confirmed dead* is superseded rather than refused. Why the place-claim is asked and not the solo record: [ADR 236](docs/adr/236-solo-flow-entry-gate-rationale.md). `live: true` and `live: null` (unprovable —
   including every #288 `invocation`-anchored hold, and the case where no place record
   exists at all) both keep the refusal: fail closed, exactly as the primitive does. This
   is strictly narrower than the `--force` it replaces and is deliberately **not** gated on
   any `writes:` value. **Not** on this list,
   deliberately: a worktree existing anywhere else in the repo (#236), or a claim held
   anywhere else in the repo (#240) — the same category error, twice. Why neither belongs on that list: [ADR 236](docs/adr/236-solo-flow-entry-gate-rationale.md). (A claim
   taken directly against *this* checkout, with no worktree, already acquires the same
   place-claim at claim time, so it still refuses here — via the place-claim check, not a
   separate claim check.)
2. **Trunk-direct commits are allowed.** Small Conventional Commits go straight to trunk;
   CI validates after the push — an alarm, not a gate, so recovery rather than prevention
   is the obligation ([Recovery](#recovery--what-must-exist-to-undo-a-merge), above).
   Branching remains available whenever a squash unit is wanted, or whenever one of the
   two mandatory-branch conditions above fires — solo flow stops requiring a branch, it
   does not forbid one.
3. **An Issue is filed on demand**, not on entry — recording a decision, or work spanning
   more than one sitting.
4. **Exit check, not teardown, and never gated on attendance.** `colab solo --done`
   re-derives fresh: tree clean, everything pushed. Nothing to tear down — solo flow made
   no worktree and holds no claim, though it releases any place-claim it took. `--done`
   releases a hold and authorizes nothing, so it dispatches before the eligibility check —
   refusing it on a missing `COLAB_HUMAN=1` would strand the lock with no way to clear it
   short of `COLAB_HUMAN=1 colab place release`.
5. **Solo flow's own invariants, never relaxed even here:** CI secret scan · reserved
   ports · Conventional Commits · no scheduled driver (doubly incompatible — a driver
   planning against a repo reads its Issues, and a solo repo may have none open at all;
   also structurally incapable of asserting attendance, rule 0 above). `production: null`
   is **not** on this list — `writes` is deliberately not coupled to production (above),
   so a live repo may run solo flow if it does not declare the veto. `autonomy: auto-trunk`
   is not either — a solo-flow trunk-direct commit produces no branch, so a grant has
   nothing to act on while flow 2 (trunk-direct commits) is what's running; the grant
   governs only the branch this repo falls back to producing whenever rule 1's entry gate
   refuses, at which point `colab ship`'s ordinary branch-merge gate applies (the matrix
   above states the same fact; this is the one place a reader stopping here gets the right
   answer without reading further).

**The boundary is concurrency reality, not a discipline preference — scoped to the
checkout, not the repo (#236, #240).** A *checkout* more than one session touches can
never legally run solo flow there — the entry gate's own checks are false by
construction the moment a second session is writing to it. Not declaring the veto is
necessary but not sufficient: a checkout currently hosting someone else's place-claim
still fails `colab solo`'s check, correctly. A *repo* hosting another session — via a
worktree elsewhere, or an issue claim tied to one — is not disqualifying by itself: a
worktree is its own checkout, isolated by construction, and was never the thing this
gate exists to protect; a claim is a hold on an *issue*, not on this checkout, so it
travels with whichever checkout it names (or with none at all, for a claim held on the
trunk checkout itself — which is exactly the shape a place-claim already catches).

**Consumers inferring activity purely from worktrees/claims will under-report a solo
session** — fixing that is each such consumer's own call, not mandated here.

### Place-claims — the writer-verifiable hold a shared checkout needs, and a worktree does not

A **worktree** writer needs no lock: its own directory already is the isolation. A writer
of the **shared trunk checkout** does — any repo that does not declare `writes: isolated`
(⚖ #233; both legacy `serial-*` spellings and absence permit this shape identically now)
— one checkout, no branch, so nothing but a lock stops two sessions (or an implementer
agent fanned out by a coordinator, which never went through anything that could refuse a
spawn) from writing the same trunk checkout at once. A place-claim is that lock:
**path-scoped**, not repo-scoped — the checkout path is the unit, so a repo running
multiple worktrees still needs only one hold per checkout in use — **held by a session**
and **verified by the writer itself**, not merely by whatever spawned it.

- What a place-claim is not, and the three partial mechanisms beside it: [ADR 242](docs/adr/242-place-claims-rationale.md).

- **Reuses the existing null-branch representation — nothing new is invented.** A hold on
  the main checkout records `branch: null`, exactly the value a trunk-checkout claim
  already carries; a hold on a worktree records that worktree's real branch name. The
  same rule that refuses the literal word `trunk` as a branch value elsewhere applies here
  too.
- **Release is a liveness lookup at read time — never a state transition written at kill
  time.** So a
  place-claim's *check* re-derives whether its holder is still alive every time it is
  read, rather than trusting a stored `released` flag. Why, with the measurement: [ADR 242](docs/adr/242-place-claims-rationale.md). A read-time liveness
  check has no such lag; adopt that stronger semantics rather than the poller's.
- **A trunk claim's hold is given back by its last `release` — a courtesy, never a
  correctness dependency (#305).** The no-worktree claim shape takes this hold at `claim`
  time, so the command that undoes that claim gives it back: `colab release` frees it once
  no claim of that session is left holding that checkout. A place-claim covers the
  *checkout*, not one issue, so a two-issue claim mints one hold and only the second
  release frees it. Ownership is proved from the **claim record's own session**, written by
  the same invocation that wrote the hold — never from an ambient `--session`, so a stale
  claim swept long after a *later* session re-took the checkout correctly touches nothing.
  None of this weakens the bullet above: read-time liveness remains the authority, and this
  only removes the lag that made an ops session's finished hold look live for as long as its
  process survived. Why, with the measurement: [ADR 242](docs/adr/242-place-claims-rationale.md).
- **Identity is fixed when the hold is written, never matched loosely when it is released.**
  `--session` accepts a URL or any stable id, but a value that is neither is warned about at
  write time, because the self-release check is exact equality on that field: a session
  *name* recorded there means presenting your real URL later fails your own ownership check
  and demands `COLAB_HUMAN=1` for a release that was legitimately yours. `sessionName` is
  **never** widened into an exemption key to paper over this — display text is not a join
  key, and a consumer that tried name-matching measured a false match and reverted it. Full
  reasoning, and the two alternatives rejected:
  [`docs/adr/306-session-identity-fixed-at-write-time-not-name-matched-at-release.md`](docs/adr/306-session-identity-fixed-at-write-time-not-name-matched-at-release.md).
- **The decision happens INSIDE the state lock, not beside it (#285).** A hold is acquired by
  one function that re-checks the conflict against the state it is about to write
  (`tools/lib/place.js`'s `acquire`), called from within `state.mutate`'s critical section.
  Why, with the measurements: [ADR 242](docs/adr/242-place-claims-rationale.md) and [ADR 285](docs/adr/285-place-claim-serialization-under-state-lock.md). The cheap lock-free pre-check remains at every call site — it
  refuses without taking the lock in the common case, and it owns the `--force`/`COLAB_HUMAN=1`
  policy — but it is no longer the authority. Both refusals are composed from the same
  `conflict()` result, so their wording cannot drift apart; the inner one adds a line saying the
  holder arrived between the check and the write. Note the scope this does **not** reach: the
  lock is a same-filesystem `mkdir`, so it orders writers on ONE machine and says nothing across
  a synced `~/.colab` — that stays the next bullet's refusal and #289's foreign-machine branch,
  not something this ordering fixes.
- **Serialization means acquire-or-refuse, never a queue with waiting.** Nothing sleeps, polls,
  or blocks inside the tool. Why: [ADR 242](docs/adr/242-place-claims-rationale.md). A caller that wants to wait polls
  `colab place check <path>` itself, which already answers in exit codes.
- **[Hard — gate: place-claim refuses a synced path]** **Never in a file-synced location.** A Resilio/Syncthing/Dropbox/iCloud path has no
  atomicity and no consistency guarantee inside its sync window — two sessions can each
  read "unlocked," each write "held by me," and both proceed *with confidence*, which is
  worse than having no lock at all. A place-claim refuses to acquire from such a path.
  **This rules only on the lock's own state path** — a distinct fact from the *checkout*
  itself being file-synced, which is [Channels](#channels--by-what-path-does-code-reach-the-thing-that-runs-it)'s
  concern below: a repo whose working tree is synced to another machine cannot use
  trunk-direct at all, lock-state location aside, because a hold on one checkout stops
  meaning one machine the moment the path is shared by sync.
- **Degraded mode: the shared checkout falls back to a worktree, never to unlocked.** If
  the lock cannot be reached (state unreadable, or the acquire itself is what lives on a
  synced path), the writer is told to use a worktree and branch instead — which needs no
  lock. Speed is what degrades, never safety; nothing ever proceeds trunk-direct without a
  hold.
- **[Hard — gate: place-claim refuses a live holder]** **Override is a human act.** A held place-claim with a live holder is a genuine refusal,
  not friction to route around; overriding one requires the same `COLAB_HUMAN=1` bar as
  a migration grant or a promotion ([§5, "The human flag"](#the-human-flag--what-colab-human1-asserts),
  below). An `unknown`-liveness holder (recorded by session URL
  only, with nothing locally probable) is exactly the case where a human is needed, and
  the refusal names both remedies: wait for the liveness window to clear, or override on
  the confirmed knowledge that the session is gone.
- **The refusal always names a resolvable holder — never a bare "unknown" (#235).** Acquiring
  through `colab place acquire`, or the hold a fresh worktree carries, still succeeds without
  `--session`/`--session-name` (a never-fail stance) but warns, because it costs the record its
  only remedy if the hold turns out live: with neither field, a later refusal's holder name falls
  back to the pid every acquire site already records — the resolved anchor (see #288 below, not
  unconditionally `process.ppid` as before it), formatted as `pid <n> on <host>` — enough for a
  human to `ps -p <pid>` and find a lead, where "unknown" left none. It is weaker than a real name
  or URL: a `sessionName` still never makes a session recognizable as its own holder on a later
  re-acquire, and a pid does so only where it is a **proven anchor** (the anchor-proof bullet
  below — never a bare or defaulted one) — supply an identity when one is available, this is a
  floor, not a substitute.
- **[Hard — gate: colab claim and colab solo refuse]** **Narrowed by #242: acquiring a SHARED-checkout hold is no longer warn-only.** A `colab claim`
  with no `--worktree` (the trunk-checkout shape) and `colab solo` both mint a hold meant to be
  re-acquired/renewed by the SAME caller across later commands — and `conflict`'s same-holder
  exemption only ever recognizes that via a truthy, matching `session`; two blank ones are never
  the same holder. So both now REFUSE outright, before any state is touched, when no `--session`
  (or `COLAB_SESSION`) is given — the #235 warn-only floor above still applies to `colab place
  acquire` and to a worktree's own hold, neither of which is re-acquired the same way.
  **#528: a person at a plain terminal is given an identity instead of a refusal.** When no
  `--session` is given, `COLAB_SESSION` is *unset* (an explicit `COLAB_SESSION=''` still means
  "no identity"), and the shell is not an agent's (`CLAUDECODE=1` / `AI_AGENT`), `colab` derives
  `person:<git user.email, else the OS user>/<h:host token>`, says once on stderr that it did, and
  uses it everywhere a session id goes — the claim, the hold, the ship evidence. It is stable, so
  the same person's re-acquire is recognized. Agents never derive: two concurrent agent sessions on
  one machine would derive the same value and read each other's holds as their own — the
  collision this gate exists to stop. A person running several units at once from separate shells
  has the same exposure, and gives each shell its own `COLAB_SESSION`.
  **A BARE `pid` is process lineage, not a session, and is never used to decide the re-acquire
  exemption** — only surfaced as a hint in a refusal's message when it happens to match. Why, with the measurements: [ADR 242](docs/adr/242-place-claims-rationale.md).
- **The anchor pid is resolved per call, not always `process.ppid` (#288).** An agent's `ppid` is
  the short-lived shell spawned for ONE tool call, not the long-lived session — probing it as a
  liveness signal produces exactly the false-dead verdict this measured. So every write site
  resolves an *anchor* first: an explicit `--pid <n|none>` (or `COLAB_PLACE_PID`) always wins;
  otherwise an agent session's own long-lived process is auto-detected and verified — never merely
  trusted — by checking it is both alive and a proven ancestor of the current invocation; failing
  that, an agent shell (`CLAUDECODE`/`AI_AGENT`) with nothing provable fails CLOSED rather than
  anchoring on its own `ppid`; every other caller keeps today's exact default (`ppid`, probed
  normally). A pid that fails closed this way is still recorded — `colab places` and `colab
  doctor` both surface it as a human lead — it is simply never treated as a liveness signal, so it
  can never be pruned as "confirmed dead" on a signal that was never trustworthy to begin with.
  This governs a different question than the #242 bullet above (whether a pid may be PROBED at
  all, not whether it exempts a re-acquire) and changes nothing about that rule.
- **A hold's holder is identified by its proven anchor process as well as by its session string
  (#317).** So a hold is also yours when its recorded anchor pid is alive and
  provably contains this very invocation. Four terms guard that, and the second is the one doing the
  work: the anchor must be `'anchor'`-kind; its **proof** must be `verified` (auto-detected *and*
  ancestor-checked at write time) or `declared` (`--pid <n>`); it must be alive; and it must be this
  process or an ancestor of it **right now**. A `default` proof — a bare `process.ppid` — and every
  record written before this are excluded by construction, which is exactly the #242 population
  above. `sessionName` is still never an ownership key, on any path. Full argument, the four
  alternatives rejected, and the falsifier that would supersede it:
  [`docs/adr/317-anchor-pid-self-ownership.md`](docs/adr/317-anchor-pid-self-ownership.md).
- **A confirmed-dead holder lapses at read time — it is a record to clear, not a conflict to
  override (#317).** Read-time liveness (above) already meant a dead holder refused nothing; what it
  did not mean was that the record went away. Why, with the incident: [ADR 242](docs/adr/242-place-claims-rationale.md). Now every command that writes at that path clears it on
  the way past, and releasing one needs no human flag: overriding nobody is not a human decision.
  **`unknown` liveness is untouched** — that is the case #288/#289 deliberately fail closed on, and
  it keeps the human bar. `colab places` stays a READ: it labels a lapsed row rather than deleting
  it, because a diagnostic that silently mutates is worse than one showing a stale row.
- **A claim's hold is given back by every command that deletes that claim, not just by `release`
  (#312).** `colab release` was the site somebody noticed in production; three others dropped the
  claim and kept the hold — the tie-break loser inside `colab claim` (which had *already* acquired
  the hold, so it blocked the session it had just conceded to), `claims --sync --prune`, and
  `doctor`'s stale worktree-less-claim prune. Each applies the same three guards: skip a claim that
  carried a worktree, skip while another no-worktree claim of that session still holds that
  checkout, and never on a branch that KEEPS the claim (a `releasePending` claim keeps its hold with
  it). The remaining deletion sites are all worktree-keyed and never took a checkout hold at all.
- **Machine identity, not a hostname string (#289).** Comparison is now two-tier: a cheap, pure canonicalization
  (case-fold, drop a trailing dot, keep only the first label) resolves the ordinary drift case, and
  when both sides also carry a hardware-bound id — `ioreg`'s `IOPlatformUUID` on darwin, the
  D-Bus machine id on linux, a MAC-address hash as the last resort — that id decides exactly,
  immune to hostname drift entirely. A record written before this landed carries no such id and
  takes the hostname-comparison branch, which is strictly *more* permissive than the raw string
  equality it replaces; no record that compared equal before can start comparing unequal now.

How this section relates to the spawn-time lock a session dashboard already keeps: [ADR 242](docs/adr/242-place-claims-rationale.md). The rationale cut from the bullets above: [ADR 539](docs/adr/539-solo-place-claims-rationale.md).

**Explicitly out of scope: any cross-machine or distributed form of this lock.** A
place-claim is machine-local state (`~/.colab/state.json`); two machines each holding
their own local lock on what happens to be the same logical repo is a distributed-systems
question this convention does not answer. The existing backstop — separate working
trees, plus git's own push rejection on a stale ref — remains what prevents two machines
from landing the same conflict undetected.

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
A repo whose green work queues behind its trunk CI may declare
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

**The `Machine:` trailer (#350).** Every squash `colab ship` lands carries
`Machine: <label>`, whether the message is composed or given with `--message`, and whether or
not the repo declares a prefix. The label is the same normalised host label the prefix uses —
a name, never a hardware identifier. It exists so that conflicts across machines can be
measured from git alone:
`git log --format='%h %(trailers:key=Machine,valueonly)' <trunk>` lists which machine landed
each unit. It records where a landing ran. It is not an identity, and no gate reads it
([§2, *Core paths*](#core-paths--a-pr-and-a-non-author-approval-before-landing-350)).

**Not on a public repository (#367).** `colab ship` reads the destination first. If the forge reports
the repository as public, or `project.yml` declares `room: public`, the squash carries no
`Machine:` trailer, and the `Colab-Adopted:` trailer (#324) keeps its branch and sha but drops
its `on <host> (machine <id>)` tail. A private repository is unchanged. When the visibility
cannot be read (no forge CLI, a remote that is not on the forge, offline) and `room:` does not
declare `solo` or `team`, ship **omits** the trailer and warns. It fails closed because a missing
line costs one traceability record and a published hostname cannot be taken back. Declaring
`room:` restores it. `colab ship --dry` prints `Machine trailer: …` with the decision, and
`--dry --json` reports it as `machineTrailerDecision`. The cross-machine measurement above
therefore covers private repositories only. A `branchPrefix: machine` branch name still carries
the label too, and that stays a deliberate choice for the repo that declares it. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).

**A branch may carry a group of related issues** — suffix them all:
`fix/import-fixes-115-114-113`. Claim every issue in the group before starting, and
**release every claim in the group together at wrap** — unconditionally, including
issues that did not get finished; an unfinished issue that stays claimed silently blocks
whoever picks it up next. (`colab ship` releases every claim it carried itself, worktree or
not — #319.)

**A group is not a chain.** A *group* is issues that touch the same code and must move
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

**The squash-subject picker recognises a wider, RANKED set, not just the branch-name
list above (#261).** `colab ship`'s default subject is the branch's highest-weight
commit — highest wins, ties go to the oldest — in this order, documented here because
before #261 it was discoverable only by shipping a branch and reading a warning:

```
breaking (any type, +1000) > feat > fix > perf > refactor / revert > design > docs
  > test > build / ci > style > chore
```

`design:` (a specification, mockup, or visual decision rather than a behaviour change)
is ranked here, not merely branch-legal. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).

**A type outside this list is not invisible, but it cannot outrank a named one.** A
commit shaped like a Conventional Commit (`type(scope): text`) whose `type` this repo
does not weigh — `wip:`, `spike:`, an adopter-invented type not yet added here — ranks
below every named type, but above a commit with no Conventional Commit shape at all: on
a branch where nothing else carries a named type it now wins the subject over a
shapeless commit, and on a mixed branch it still loses to a named type, silently,
exactly as before. `colab ship --dry` warns about this class either way (`N commit(s)
… carry no recognised Conventional Commit type`); the fix is to re-word the commit to a
recognised type, or ship with `--message "<subject>"` so the subject is stated rather
than guessed.

**Merging:**

- Feature branch → trunk: **squash**, one commit per unit of work.
- `dev` → `main` promotion (Tiers A and C): **`--no-ff` merge commit**, never squash —
  the merge commit *is* the release boundary.
- **The merge message closes its issues: write `Closes #N`** (one per issue), not a bare
  `(#N)` — GitHub auto-closes only on the keyword. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).
- **[Hard — gate: colab ship refuses unticked plan]** **`Closes #N` requires the issue's own scope fully accounted for — a mechanical gate,
  not an honour system (#74).** An issue's `## Plan` is a real GitHub checklist — one
  `- [ ]` line per deliverable, load-bearing. A prose-only `## Plan` cannot be verified
  mechanically (reported, not blocking; cannot bind an issue opened before this
  convention). `colab ship` parses the checklist before composing the squash body: any
  claimed issue with an unticked box and no declared `Remainder: #M` **refuses the
  merge outright (#263)** — a precondition row exactly like a red CI run, not a silent
  `Closes #N` → `Refs #N` downgrade that lets the ship proceed anyway. Ticking every box, declaring
  `Remainder: #M`, or an explicit `--refs #N` (a deliberate choice, never gated) all
  clear it. A hand-merge runs the identical check by reading the same two fields
  (`gh issue view N --json body,comments`). Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).
- **Requiring the remainder issue is the convention — the gate does not file one for
  you (#263).** Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).
- **`--refs` keeps an issue open, so the same step must also stop it being started
  (#385).** `--refs #N` is still a deliberate choice and still ungated. But after the ship,
  #N is open, possibly `deps-checked`, and unclaimed. If nothing on it says "do not start",
  a scheduler picks it up again as code work. So when you choose `--refs` over closing:
  - **The leftover is a check only a person can run** (a UI click-through, a look on a
    real device, a live end-to-end proof): do not `--refs` it. Close #N and add one row to
    the repo's single open `Human verify:` issue (§5 *Human verify*, #491).
  - **The leftover is another non-code wait** (a measurement a machine can take, a date,
    an outside party): park #N in the same ship. Add `deferred:<kind>` +
    `review-by:<date>`, plus a `Hold:` line naming who posts the proof (*Disposition* and
    *Holds*, §5).
  - **The leftover is code**: prefer `Remainder: #M` and let #N close. The remainder
    issue is a start candidate of its own and can carry its own hold. #N kept open for
    code is a second start candidate for the same work.

  `colab ship` prints a **reminder, never a refusal**, when a `--refs`'d issue still has
  an unticked `- [ ]` box under any heading and carries nothing that stops a start:
  `deferred:*`, `needs-decision`, a non-code `delivery:*`, `tracking`, or a label declared
  under `holds:`. `--dry --json` reports the same thing as `refsBrakeFindings` and as an
  `ok: true` advisory row. The tool never applies the hold itself. Which kind, whose wake
  and which date are the shipper's call, for the same reason the gate does not file the
  remainder issue. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).
- **[Hard — gate: colab ship refuses uncorroborated issue]** **Every closed issue must be corroborated by git, not the claim registry alone (#87).**
  Corroboration reads two git-side sources: the branch name's
  **trailing** number group, and `#N` references in **commit bodies**. An issue named by
  neither is a finding — `colab ship` refuses; a hand merge must perform the same check.
  Do not resolve it by quietly writing `Refs #N` — that hides the collision; `--refs`
  exists for when an operator actually means it. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).
- **[Hard — gate: evidence-close needs an evidence comment]** **A deliverable with no diff still has to close (#90).** A decision recorded, an
  investigation concluding "no change needed", an artifact stored outside the repo —
  there is nothing to squash. `colab ship` detects `landed ∧ zero own commits` (both
  measured from git, never declared by the session) and switches to **evidence-close**:
  post evidence, close each issue, tear down — no merge, no push, no `--allow-empty`
  marker commit. Gated on the issue **already carrying a comment the tool did not write**.
  A unit committed straight to trunk has no branch to detect this from; it closes the same
  way through `colab ship --direct` (#302), which matches its claims by session identity and
  refuses until the work is published.
- **A ship releases every claim it carried (#319)** — not only the worktree's. An unattached
  claim of the *same session* is carried by a branch ship only when the branch name's
  trailing group names it; otherwise it is reported and left alone, never closed. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).
- **[Hard — gate: colab ship refuses unadopted remote-only branch]** **A branch this machine never held is not a legit zero (#324).** A branch that exists only
  on `origin`, with no issue number in its name and no local claim, is most likely another
  machine's work in flight; `colab ship` refuses it unless `--adopt` is passed, and an
  adopted squash carries a `Colab-Adopted:` trailer naming the remote sha and this machine.
  A local ref does not make it this machine's (#343): when the ref's oldest reflog entry says
  git created it from `origin/<same name>` (a DWIM `checkout`/`switch`/`worktree add`, or
  `--track`), it reads the same as remote-only. Where no reflog survives, nothing contradicts
  the local reading.
- **[Hard — gate: colab ship refuses unless trunk CI green]** **Before merging to trunk, check that trunk's last CI run is green — and that it ran at
  all.** **Ask by commit, not by recency
  (#92):**
  The right question: has EVERY run at this branch's current head sha completed, and did
  one of them succeed? `colab ship` asks it that way. Both halves are load-bearing: a
  sibling that is merely still in progress has not passed either (#307), so a fast
  workflow finishing green must never answer for a slow one that has not run yet.
  Only runs of workflows the repo owns count (#451): a run with `event: dynamic`
  (Dependabot Updates and GitHub's other dynamic workflows) never executes the sha, so it is
  dropped before the verdict and named in its detail; if nothing is left, the sha reads `none`.
  Only runs that **verify the code** count (#503): those triggered by a push or pull request.
  A run that comes *after* the verdict and acts on it — a `workflow_run` release such as
  `release-auto.yml`, its scheduled finalize, a dispatch, a deploy — is set aside and named the
  same way. Its failure belongs to the release lane, so it never turns trunk red for ship and
  ship never waits for it; measured, four green candidates parked ~30 min per landing behind
  one. `ship-gate-workflows:` / `ship-ignore-workflows:` in `project.yml` override the set by
  workflow name ([schema](project.schema.md#ship-gate-workflows-ship-ignore-workflows--optional)).
  A trunk sha whose tree has **no workflow file at all** (#482) — a freshly adopted repo whose
  adoption branch is what adds CI — can never draw a run, so nothing there can be red: its
  `none` gets the *Branch CI* treatment for a run that cannot arrive, and the candidate's own
  run at its remote head decides (green passes; red, in flight or absent still refuses). A
  trunk that has workflows but no run at its sha is a real gap and still refuses.
  Each workflow is then judged by its **newest** run at the sha (#461): an earlier attempt of
  the *same* workflow that a later one superseded is set aside and named in the detail, so a
  `workflow_run`-triggered workflow that skipped for two red CI attempts and passed for the
  green third no longer holds the sha red forever. A newer run decides in both directions — a
  newer failure vetoes an older success, a newer run still in flight blocks (#307) — except
  that a `cancelled` run never supersedes, because it ran nothing (#92). Runs of *different*
  workflows are never reduced: a failing one beside a passing one is still not green.
  `colab trunk-ci` prints that verdict for trunk's head, read-only and from the same function
  (#463); a skill that needs it calls the verb instead of restating the rule as a `gh run
  list` filter — one such filter, "green when any run succeeded", read a sha green that ship
  had parked every candidate on, and the red went unowned.
  **Waiting for that verdict is `colab ci-wait`, never a loop (#495).** It backs off
  (30 s → 60 s → 120 s, then a deadline), sends conditional requests so an unchanged read is
  free, and ends with its own exit code on a rate limit or an unreadable state instead of
  retrying. `colab trunk-ci` itself costs one runs read (plus one check-runs read on green) and
  caches its verdict per trunk sha for 45 s in the repo's git dir, shared by every session on
  that checkout. Why: [ADR 539](docs/adr/539-branches-and-commits-rationale.md).
  That is the half of the question about what is merged **into**; the branch's own run
  is the other half — see *Branch CI*, below.
- **That resolves a FALSE red — a real one has two different doors, one of them
  human-only (#105), one machine-checkable (#281).** A **genuinely** red trunk (the sha
  really failed) is a true deadlock when the candidate branch's entire content IS the
  fix — see *Red-trunk exemption* and *Cure rule* below.

### Branch CI — the candidate's own run, read as a class (#314)

Trunk CI answers *"is the thing I am merging into healthy?"*. It says nothing about the
thing being merged, and both gate a merge. A local quality gate does not answer for the
branch's CI either: local and runner disagree for ordinary reasons — a different OS, a
browser the runner has to boot, a toolchain pin the local machine already satisfies. Why: [ADR 539](docs/adr/539-branch-ci-rationale.md).

**One cause of that disagreement is closed before the push, not read after it (#403).** A
test that reads its author's machine (the home directory's config, a local daemon, a token
in the shell) is green locally and red on every runner. So the local gate is green only when
the test step has passed twice: once as-is, and once **hermetically**, with a fresh empty
`HOME`, every service-address and credential variable unset, and the network off where the
platform allows it (`colab gate-hermetic`, `code-wrap` A3). A toolchain manager's home is
the one thing carried across, pinned to its real path and printed (#447): the toolchain is
what the tests run on, not state they read. A green normal run with a red
hermetic run is its own verdict, `live-env`, and it is not green. The only exemption is a
`live-env: none` declaration on trunk's `project.yml`
([schema](project.schema.md#live-env--optional)). The branch-CI read below still applies:
runners differ in more ways than a stripped environment can reproduce.

**A green branch-CI run can *be* that hermetic run (#408).** A run is one when all three hold:
it is `green` at the branch's current head sha (the class below), its workflow runs the
same test command the local gate runs, and its runner does not share a developer's machine
(a hosted runner, or an ephemeral container runner, but never a self-hosted runner that
runs in someone's login session with their `HOME` and daemons). That run already had no
developer `HOME` and no local daemon, at the exact commit being merged, so repeating it
locally adds minutes and no evidence. So the hermetic verdict may be
recorded as `branch-ci` with that run's sha, and `colab gate-hermetic` runs locally only
when branch CI cannot arrive (no trigger for the branch), is not `green`, or does not run
the tests. The same holds after a sync: push and read the new branch run before
re-running the suite locally. Why: [ADR 539](docs/adr/539-branch-ci-rationale.md).

**Local is a smoke check; branch CI is the one gate (#410).** A repo whose branch CI can
arrive may say so in `project.yml` (`gate:` with `smoke:` and `authoritative: ci`,
[schema](project.schema.md#gate--optional)). There, `code-wrap` A3 runs the declared smoke
check once (lint, types, the tests for what changed — a few minutes, no hermetic second pass)
and pushes; the verdict is the branch-CI run at the pushed head sha, read as the class below,
and the hand-off names that run's id. `code-ship` reads the run and never re-runs the suite
locally. A clean CI runner is the hermetic run by construction, so `colab gate-hermetic`
stays only where the local gate is still the verdict. While iterating, run the tests for what
you changed; the full suite runs once, where the verdict comes from. The fallback is today's
rule, unchanged: no `gate:`, `authoritative: local`, or no workflow firing on a session-branch
push ⇒ the local full gate plus the hermetic run. Why: [ADR 539](docs/adr/539-branch-ci-rationale.md).

**Read the runs at the branch's current head sha, and report the result as one of four
classes — not as pass/fail.** The names are shared vocabulary: the implementer records
one when it pushes, the coordinator re-derives it before merging, and a fleet planner
reading either sees the same spelling. Spell them exactly so, everywhere:

| class | what the runs at the head sha show | next step |
|---|---|---|
| `green` | **every** run `completed`, at least one `success`, none `failure` | nothing owed — this precondition passes |
| `none` | no run exists, or **any** run is still in flight | a run queued or in flight has not passed, it has **not run**: wait, bounded — **15 minutes per candidate** by default, then a defer carrying a re-measure trigger, never an open-ended poll (#370). A run that **cannot arrive** for this ref — no workflows, or workflows triggering only on `pull_request` / trunk push — is not pending: proceed, and the base's own CI is the whole CI story — so the trunk run at the squash sha is read after the merge, before any evidence is posted, and a red there is filed as `TRUNK RED:` in the same pass (`code-ship` B2a, #374) |
| `red:infra` | a run failed **before** the suite could judge the branch — runner boot, browser install, billing lockout, dependency fetch. **Exit 2** where the repo separates them | re-run **once**; an identical failure twice is the runner, not the branch — hand it to the ops lane. Never merged past, never sent back to the implementer: there is nothing in the diff to fix |
| `red:finding` | the suite ran and something in it failed. **Exit 1** where separated | back to an implementer session, **as a class** — a [send-back](#who-may-touch-a-branch--the-coordinator-never-edits-implementer-work-409), never a coordinator fix. Never merged past, never re-run |

- **[Hard — gate: colab ship refuses stale-base]** **The run must have seen the current base (#395).** A class read at a head that does not
  contain the base's current tip is **`stale-base`**, whatever its runs say: two branches
  each green alone can combine red when neither run saw the other, and a textually clean
  merge re-runs nothing.
  The next step is mechanical — sync the base in, push, wait on the new run (the same
  15-minute bound), then land; `colab ship` refuses with this verdict, `self-clearing`. A
  head with no run at all is not stale (the `none` row above governs it). Skipping the
  re-run because the base's new commits "touch nothing the branch's tests import" is only
  ever allowed on a measurement, never on a guess — and no generic measurement exists today. Why: [ADR 539](docs/adr/539-branch-ci-rationale.md).
- **The quantifiers are the trunk rule's, unchanged (#92, #307).** `every … completed`: a
  fast sibling already green never answers for a slow one still running — that sha is
  `none`, not `green`. `cancelled` is `completed` and not a `failure`, so a cancelled
  straggler beside a real `success` is still `green`; the ladder must not reintroduce the
  deadlock #92 fixed.
- **A claim's first push is `green` from a guard run, not a second suite run (#418).** A
  claim pushes its branch at trunk's head (§5, *Record of a claim*), so that first push sits
  on a sha the same workflow has usually already tested. The CI templates (and this repo's own
  workflow) open with a `dedupe` job that runs only on a ref's **first** push, checks nothing
  out, and asks the platform one thing: does *this* workflow already have a completed,
  `success`, non-pull-request run at *this* sha? Yes ⇒ every other job is skipped, and the run
  concludes `success` — the branch reads `green`, truthfully, because the same workflow passed
  at the same sha. Trunk's run still in flight or red, no `gh` on the runner, or any API error
  ⇒ the suite runs as before (fail-open). Every later push skips the guard at scheduling time,
  so the session's first real commit always gets the full suite at its own sha. Why: [ADR 539](docs/adr/539-branch-ci-rationale.md).
- **Trunk reuses a green run of an identical tree (#493).** A ship squash-merges a branch
  whose green run already contained the current base, so the trunk commit's *tree* is
  byte-identical to the tree that run passed — only the sha is new, and a sha-keyed skip can
  never see it. On a non-creating push to trunk the same `dedupe` guard therefore also asks:
  does *this* workflow have a `success` run, from a `push` on another ref of *this* repo, whose
  commit has *this* exact tree? It filters the run listing by tree and then confirms the tree
  through the git object. Yes ⇒ the suite is skipped, the run concludes `success`, and the
  guard leaves a `tree-already-green` notice naming the run it relied on; `colab ship`'s
  trunk-CI row and `colab trunk-ci` print that run ("relied on <url>"). **The rule: an
  identical tree plus a green run of the same workflow is tested.** An identical tree covers
  every committed byte — workflow files, lockfiles, the descriptor — but not what lives outside
  the repo: runner images, unpinned toolchain downloads, secrets and variables, steps that
  branch on `github.ref`. A repo whose suite depends on those declares `tree-reuse: off`
  (`project.schema.md`) and trunk always runs in full. The guard reads `trunk:` from the
  descriptor *at that sha* and acts only there — never on a release branch, never on a
  promotion push to `main` where trunk is `dev`, never on a dispatch. Any doubt — no
  descriptor, an opt-out, an API error, no exact match — runs the full suite. A trunk-only job
  (publish, deploy, release) never sits behind this gate. One reading turns such a run red: a
  cited head that is local and whose tree provably differs from trunk's (`HUMAN_GATED` —
  trunk is untested at that sha). A citation that cannot be read leaves the run green and says
  so, because the run's own `success` is the verdict, exactly as for #418. Why: [ADR 539](docs/adr/539-branch-ci-rationale.md).
- **An unclassifiable red is `red:finding`.** Where a repo does not separate exit 1 from
  exit 2, `failure` is all the platform reports: read the failing job's log far enough to
  say which side of the line it fell on, and if that cannot be told, report `red:finding`. Why: [ADR 539](docs/adr/539-branch-ci-rationale.md).
- **Telling `red:infra` from `red:finding` is a test, not taste (#354).** The same test
  reads a red **trunk** run, where it chooses between re-running once and filing a
  `TRUNK RED:` issue — the choice this section's re-run permission otherwise leaves to
  judgement at exactly the moment it matters. Where the repo separates exit 1 from exit
  2, the exit code already answers; where it does not, apply this in order:
  1. **At least one named failing assertion ⇒ `red:finding`**, whatever else the run
     shows — a test name with an expected/received pair, an `assert` message, a count
     like `794 pass / 37 fail`. **Never re-run it**: a green second run hides a real
     defect, and a flaky one is a defect too.
  2. **Otherwise it is `red:infra` when the tests demonstrably never ran**, shown by any
     of: the run's **duration far below this repo's own norm** for that workflow
     (compare `gh run list --workflow <w> --status success -L 10 --json startedAt,updatedAt`
     — an order of magnitude short means it died in checkout, install or runner boot);
     **`gh run view <id> --log-failed` returning nothing at all**; or failure text that
     names the environment rather than the code — `EADDRINUSE`, `signal: killed`, a lost
     runner, a job queued for hours and then failed with no log.
  3. **Neither ⇒ `red:finding`** — the unclassifiable rule above, unchanged.

  Two readings that the text alone gets wrong:
  - **A timeout is `red:infra` only if the host was loaded.** The same text on an idle host
    is a real slow-test bug. Check the host (load, swap, I/O pressure) before calling it
    infra; no host evidence ⇒ `red:finding`. Why: [ADR 539](docs/adr/539-branch-ci-rationale.md).
  - **Infra-shaped is not the same as harmless.** A port collision (`EADDRINUSE`) from a
    single random draw with no retry is re-run once to clear the red **and** filed as a
    defect — the re-run unblocks the base, the cause is still the code's. The two are
    not exclusive.

  Measured shapes, one repo: a build failed in **26 s** where the normal run is 20+
  minutes and `--log-failed` returned nothing — re-ran green; a job queued ~2 h and failed
  with no log while its self-hosted host had swap 100 % full — re-ran green. The contrast
  in the same repo: 37 failures each naming an assertion, at normal duration — a real
  regression that a re-run would have buried.
- **Give the branch a run of its own — but only where trunk runs have their own capacity
  (#384).** A workflow triggering on trunk push and `pull_request` alone leaves every
  PR-less session branch at the cannot-arrive `none`: its first real run is the post-merge
  trunk run, so a red there is a `TRUNK RED:` for everyone instead of a hand-back to one
  implementer, and the ship pass waits on that run before it can post evidence. Measured
  across one fleet over two weeks (~830 landings, 14 repos): CI wait was the second-largest
  source of wait inside ship passes (186 waits, median 7.4 min), and only the repos that had
  hand-edited their copy to `push: branches: ['**']` got a branch signal before the merge.
  So the CI templates now trigger on **every** branch push, with a per-ref `concurrency`
  group that cancels a superseded run on the same branch and **never** a trunk run — every
  trunk sha keeps a completed run of its own, which is what the trunk half of the gate
  reads. That is the default **only where trunk has capacity of its own**: GitHub-hosted
  runners, a runner pool, or a trunk-only runner label chosen in `runs-on` on `github.ref`
  ([*Self-hosted runners*](#self-hosted-runners--capacity-is-the-agent-count-not-the-machine-355)).
  On a **single self-hosted agent shared with trunk**, keep trunk-only triggers until a
  trunk lane exists — measured there (#355), branch pushes queued a trunk build job 33 min
  behind other branches' jobs, delaying the one run a merge waits for. The cancel list
  names the repo's trunk and release branch by name; a trunk missing from it has each run
  cancelled by the next merge, leaving that squash sha with no completed run of its own for
  the by-commit trunk read (#92) or the post-merge read (`code-ship` B2a) to find.
- **Say which `none`.** A bare `none` turns a bounded wait into a wait for a run that was
  never coming. A repo whose workflows trigger only on a trunk push and `pull_request` is
  the permanent shape: a wrap pushes a backup branch without opening a PR, so branch CI
  does not exist there before the merge — a normal state, not a missing measurement.
- **At a red base, that `none` has one way out — and only the patch may take it (#353).**
  "Proceed, the base's CI is the whole story" is a stop when the base is red, and the
  *Cure rule* below needs the branch green at its own head — a run a trunk-push-only repo
  produces for a branch **only through a PR**. A PR's run is against its merge ref, and
  that merge ref **includes the red base**. So opening one is legitimate for exactly one
  branch: the one **carrying the fix** — its head contains the red sha (cure condition 1)
  and repairs it, so its run is fix-on-top-of-red, the verdict wanted. A **bystander** —
  ready work that merely happens to be queued — waits for green: its PR inherits the red
  through the merge ref, returns a red run that says nothing about the branch, and
  spreads the failure signal. Both read the same remedy, so ask first: **is this branch
  the patch?** — its title or issue says it repairs the red, or its head fixes the
  failing test. Yes → it goes first, ahead of anything queued. No → it waits, and does
  not rebase onto the red either: containment proves a cure only for a branch that is
  one. Why: [ADR 539](docs/adr/539-branch-ci-rationale.md).
- **A class describes one sha.** Anything that moves the head — a sync merge of the base
  into the branch — invalidates it; read it again at the new head. A green inherited from
  an earlier sha is exactly the green-run-on-a-different-commit this section refuses.
  The one sanctioned substitute for that re-read is a **batch's combined run** — one run at
  a head that contains every member on top of the base, which grades each member's synced
  state at once ([*Batch landing*](#batch-landing--one-combined-run-then-a-fast-forward-373),
  below).
- **A red class is data, not a failed wrap.** The implementer records it and stops; the
  table says who acts next. Only `red:finding` names the implementer, and only when the
  finding is the branch's own.
- **One re-run per red episode, not per attempt** — and it is the only CI action the
  coordinator takes. A second identical failure is evidence; spending more re-runs on it
  just moves the wall further out.

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

Why, with the measurement: [ADR 539](docs/adr/539-who-may-touch-and-batch-landing-rationale.md).

Every mature system that lands several changes per cycle (merge trains, merge queues,
rollups, speculative pipelines) **tests the combined state before it becomes trunk**. None
lands first and tests afterwards. So a repo that declares
[`ship-batch: <N>`](project.schema.md#ship-batch--optional) (1–3; absent or 1 is serial,
unchanged) may land through `colab ship --batch <b1,b2[,b3]>`:

1. **Joining.** A member is `green` at its own head ([*Branch CI*](#branch-ci--the-candidates-own-run-read-as-a-class-314),
   unchanged — or a `none` that cannot arrive), passes every gate its own serial ship would,
   and is an ordinary squash into trunk through the `auto-trunk` grant. Anything special
   ships serially, where its path already is: the docs-only door (judged per branch), a
   migration, a ci-grant or cure, a core-path review, an adopted branch, a branch editing
   `.github/workflows/**` (it would change what grades the batch). File-disjoint members
   are preferred — only as a pre-filter that lowers eviction odds. **Disjointness is never
   the correctness gate**: semantic conflicts need no shared file. The combined run is.
2. **[Hard — gate: combined-head build fails on staged conflict markers]** **Building.** Trunk's current head — green exactly as the trunk gate requires — plus
   one squash commit per member, **each its own commit with its own `Closes #N`**, so
   per-issue evidence and revert stay one-to-one. A member that conflicts with those
   already in drops to the next batch — **unless every conflicting path is
   [`generated`](project.schema.md#generated--optional)** (#387): then the build does what
   B0 does for one branch, running `.colab/hooks/pre-ship` on the combined head to
   regenerate them, and the member stays in (the combined run is still the gate). With no
   hook to regenerate, or a hook that fails, it drops as before — and a hook that exits 0
   but leaves a `<<<<<<<`/`>>>>>>>` line staged in a path it was handed **has failed**: its
   exit code is a claim, the index is the proof, and serial B0 reads it the same way (#436).
   Sharing only generated
   paths does not count against disjointness in step 1's pre-filter either. The result is
   pushed to `ship-batch/<trunk-sha7>`.
3. **One combined run** there must be `green`. It **replaces** each member's post-sync
   re-run — not a skip justified by disjointness, but one run instead of N.
4. **Landing.** Trunk fast-forwards to the batch head **only if trunk has not moved** since
   the batch was built — by a plain, non-forced push, so a moved trunk makes the push fail
   on its own. Moved → nothing lands and the batch is rebuilt on the new head. Each
   member's evidence names the combined run.
5. **A green batch run stands in for trunk's own run at that same sha** — while trunk's
   run is still in flight — only when **the same workflows** ran there: the workflow files
   firing on a trunk push and on a `ship-batch/**` push must be the same set. Otherwise
   trunk waits for its own run, as always.
6. **Failure.** `red:infra` → re-run once (unchanged). `red:finding`, or red again after
   that one re-run → **land nothing** from the batch; the members ship serially, each with
   its own sync run — for N ≤ 3 that *is* the bisection — and the one that goes red
   returns to its implementer as a class, exactly as today.
7. **Wiring.** If no workflow fires on a `ship-batch/**` push, the combined run can never
   arrive: `colab ship` says so and declines to serial — it never waits for it. Consumer
   CI opts in by adding `'ship-batch/**'` to a CI workflow's `push: branches:` — a copy of
   the current CI templates already fires there, since their `'**'` covers it (#384).
8. **[Hard — gate: colab ship --batch declines on red trunk]** **A red trunk still stops everything** except the cure/grant doors, and those apply
   **per member, never to a batch**: a red trunk declines the batch outright.

`colab ship --batch` never waits: each call reads the remote, takes one step, and exits
`0` landed · `3` paused (wait on the printed run, bounded as any other CI wait, then run
the same command again) · `4` declined, nothing landed, ship the members one at a time.
Declining is never a silent fall-through to the serial path: that path's sync commit
still needs its own re-run, and landing it unseen is the thing this section exists to stop.

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

```sh
colab landed --worktree <name>     # landed · cargo · unknown
colab landed --all                 # every worktree of this repo
```

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

**A green branch can be reporting a red base's problem, not its own (#293).** `colab
ship`'s trunk-CI-green check asks whether trunk is green *right now* — never whether
the sha a branch was actually *cut from* was green *at the time*, and those differ
once trunk has moved. Why: [ADR 539](docs/adr/539-landed-rationale.md).

```sh
colab landed --worktree <name> --ci     # adds: was the cut-from sha actually green?
```

Advisory only — it never blocks `colab landed` or `colab ship` (both surface it as an
additive field/row, never as a new precondition). Three severities, loudest first:
`suspect-green` (base red, branch's own head green — the branch's green may be
inherited, not earned), `inherited-red` (base red, branch's own head red too — likely
the same pre-existing failure), `unresolved` (base red, branch's own head has no
completed verdict yet). Silent when the base was not measurably red.

---

## 5. Claiming work — how to say "I'm on this"

Parallel sessions and parallel agents must not collide on the same Issue. Two layers:

### Who holds this

#### Record of a claim — the branch on the remote

**[Hard — gate: colab claim refuses]** **The record of a claim is its branch on the git remote** — the branch whose name carries
the issue number ([§4](#4-branches-and-commits)), **pushed the moment it is cut** at session
start and again at wrap (#325). The git remote is the one store every machine already
shares, whatever the tracker is, so it is what a claim is refused against: a branch on the
remote carrying `#N` that is not this machine's refuses a second claim on `#N` from
anywhere, naming the branch and how to continue it. Each machine sweeps its own worktrees.

- **[Hard — gate: colab claim refuses]** **Remote unreachable → no claim.** Fail closed: a claim checked against nothing is not a
  lock. A repo with **no remote at all** is the one exception — nothing else could ever share
  its branches, so the machine's own record is the whole truth.
- **Tracker unreachable → the claim still stands.** Its tracker half (below) is recorded as
  *pending* and posted when the same claim is re-run.
- One account on **two machines** is two holders: a live claim comment from the same login on
  a different machine refuses too — the assignee set cannot say which machine holds it.
- A claim names the machine by a canonical id, not its hostname (#327) — one machine spells
  its hostname more than one way. The comment carries only a digest of that id: the raw id is
  a hardware serial, and on a public repo the comment is published.
- A **planner** may hold an issue before the session that will work it exists
  (`--session intent:<id>`, no worktree, #326). That session's own claim from the same machine
  upgrades it in place; a planner claim whose session never claimed is released after a short
  window.

#### Mirror for people — GitHub

```sh
gh issue list --label in-progress                               # check, before taking work
gh issue edit <N> --add-assignee @me --add-label in-progress    # claim, at session start
gh issue edit <N> --remove-assignee <claimer> --remove-label in-progress   # release, at session end
```

**[Hard — gate: colab claim refuses]** **A claim is both halves — the assignee *and* `in-progress`.** Either half alone is a
**half-claim**: a broken claim, which is neither free nor taken (ruled in #323). Nobody
starts on it; triage reports it for **repair** — whoever holds the assignee completes the
claim (adds the label) or drops the assignee (releases it) — and `colab claim` refuses it
until then, `--force` taking it over loudly like any other claim. Our own half-claim is
the one exception: re-claiming completes it. Release therefore drops **both** halves;
removing only the label is what leaves the assignee-only half-claim behind.

**Release removes the assignee who holds the claim, not the account releasing it** (#363).
The claimer is the account that applied `in-progress` — the latest such event on the issue,
which survives the label's removal.
`colab release` (and every path that releases through it) reads the claimer from the issue,
unassigns it alongside the caller, and says so whenever that is a different login. By hand,
`<claimer>` is `@me` only when you took the claim yourself. The one exception is yielding a
lost race: there the latest labeler is the winner, whose assignee must stay.

Why, with the measurements: [ADR 363](docs/adr/363-claim-release-rationale.md).

Assignee plus `in-progress` is the claim's **mirror for people**, not its lock: it is what a
human reading the Issue sees, and the half-claim rule above still governs it exactly. It is
no longer what a claim is refused against across machines — that is the branch on the remote,
above — because a tracker can change or go down while the git remote is the store every
machine already shares. The label does not exist in a fresh repo — creating it is part of
adoption ([§9](#9-adopting-this)).

#### Fast path — local cache

`colab` keeps a machine-local cache at `~/.colab/state.json` (override with
`COLAB_HOME`), written automatically on claim/worktree-create — a zero-latency read for
same-machine parallel sessions. **It is a cache, not the truth**: uncommitted,
machine-local, cannot see work claimed elsewhere. It does answer one question nothing else
can — *which branches on the remote are this machine's own* — which is why it is never
file-synced between machines. **When cache and GitHub disagree about the assignee/label,
GitHub wins.**

```sh
colab claims --sync      # reconcile local cache against GitHub
colab doctor --prune     # free claims whose worktrees no longer exist
```

#### Rules

- **[Hard — gate: colab ship refuses unclaimed branch]** Claim **before** you start, not when you open the PR — an unclaimed issue is fair game.
- **[Hard — gate: colab claim refuses]** **A live claim is enforced, not advisory.** `colab claim`/`colab worktree new` *refuse*
  an issue with a live claim, naming the holder; `--force` takes over loudly. This
  protects an issue only while the claim is *live* — a session releases its whole group
  at wrap, so an unfinished issue is immediately reclaimable; say so on the Issue if you
  intend to return.
- **A claim carries its details as a structured Issue comment**:
  `🔒 Claimed — worktree … · branch … · host … · <timestamp>` on claim, `✅ Released` on
  release. `code-ship`'s evidence comment (B2b, `ceremony: standard` only) uses the same
  pattern: an invisible marker line, `<!-- colab:evidence sha=<trunk-sha> -->`, prepended
  to free prose. **Degrade, never gate** — a comment missing the marker still counts as
  evidence; no consumer may treat its absence as "no evidence exists". `code-ship`'s grade
  verdict (B1c) uses the same family of marker, on its own line: `<!-- colab:grade
  verdict=<token> round=<n> -->`, `<token>` one of a **closed** set (`pass` ·
  `reject-decision` · `reject-escalate` · `rework` — no token a prefix or decorated variant of
  another, so a qualifier can never be mistaken for `pass`). `rework` is a reject whose
  recommended fix needs no authority the coordinator lacks, posted as a direction the author
  follows unless a human overrules (#328, #406). It is emitted only at `round=1`, and it is
  held, never cleared. Attributes are read by name, never position; an optional
  `reviewer=<lane>` names which review produced the verdict, and absent means the ship grade. Read by equality, never by
  prefix or heading text; an unrecognised token or a missing marker both mean "not
  cleared", never a silent default to the safe-looking value — the same *degrade, never
  gate* posture applies to its absence. A **third** member of the family, `<!-- colab:disposition
  proposed=<token> -->`, proposes how a non-code unit of work ends — same closed-set,
  read-by-equality, degrade-never-gate rules (*Disposition — the marker, the seven kinds, and who
  may apply one*, below).
- **Simultaneous claims break ties deterministically**: re-read after claiming, the
  earliest live claim comment (by `createdAt`) wins, the loser posts
  `✅ Released (yielded — …)`.
- Release the claim even if you did not finish — a stale claim silently blocks others.
  `colab doctor --prune` frees claims whose worktrees died.
- For long-running work, comment progress onto the Issue — the feature's external memory.

#### Tracking issues — claimed but referenced, not closed

A long-lived tracking issue may be **claimed** (to signal work in the domain) and
**referenced**, without closing — its checklist still has open items, and closing it
would bury its knowledge. The merge message says `Refs #N` (links, does not auto-close)
instead of `Closes #N`.

- **A `tracking` label** — declarative and durable; any session claiming a labelled
  issue references it automatically.
- **`colab ship --refs <N[,M]>`** — explicit, per-ship, for an unlabelled issue. An
  issue kept open this way for a leftover that is **not** code must also be parked in the
  same step, or it reads as startable again (#385, §4 *Merging*). A leftover that is
  only a check a person must run is not a reason to keep the issue open: close it and
  add a row to the `Human verify:` issue (*Human verify*, below).

The claim is released unconditionally either way. `tracking` is deliberately **not** in
the convention label set ([§9](#9-adopting-this)) — its absence breaks no check, so adoption does not
provision it and the audit does not report it missing.

Do not write `Closes #<tracking>` in a commit body — GitHub closes on the keyword
regardless of intent, and it cannot be un-closed by another keyword. `colab ship` detects
this after the push and warns to reopen by hand. The reverse is not the same kind of
edge: a stray `Refs #N` written while N was open, now one of the branch's own
`Closes #N` — `ship` drops the stale `Refs` before the push rather than shipping a commit
that says both (#58).

#### Human verify — a person-only check closes the issue and becomes one row (#491)

Why, with the measurements: [ADR 491](docs/adr/491-human-verify-rationale.md).
**So when the code is all on trunk and what is left is a check only a human can run:**

- The ship **closes** the issue: `Closes #N`, not `--refs`.
- In the same step, it appends **one row** to the repo's single open issue titled
  `Human verify: …`. The row gives the source issue, the steps to run, and the evidence
  wanted. If no such issue is open, the ship files one, labelled `delivery:ops` so it is
  routed to a person and never started as code. Where the repo declares a `holds:` label
  for human-owned waits, that label goes on too.
- **A row that fails becomes a new bug issue**, linked to the row's source issue. The
  source issue stays closed: its code shipped, and the failure is new work.
- The person ticks rows off one sitting at a time. When every row is ticked, they close
  the `Human verify:` issue with `colab close`, and the next ship that needs one files a
  fresh one.

What this does **not** change:

- **A code remainder** still takes `Remainder: #M` (or `--refs` plus a hold), as in §4
  *Merging*.
- **A `tracking` issue** is still `Refs #N`, as above.
- **`deferred:measurement` is only for waits a machine can measure**: a metric, a
  threshold, a counter. "A person has to look at it" is not a measurement, and a
  `review-by:` date on it only hides whose turn it is.

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
session and no tool can read them — measured: an epic tracking ~14 children by
hand-edited checklist reported `subIssues.totalCount = 0`.

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
position, which the rule above already forbids. Contention has its own two answers:

Why, with the measurements: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md).

- **A real collision → *Grouping*** (below): one `group:<key>` label, one branch, one review
  cycle. It is never recorded as a chain of edges.
- **A shared file that every unit of work must edit is a design defect. Fix the file; do not
  serialize the work.** The measured case was fixed this way: the index became a pointer
  to the per-item folders, and each item's status moved into that item's own file. The
  items then touch disjoint files and run in parallel, with nothing left to group.

**Contention between an issue and a live branch is recorded in the issue text (#386).** An
issue names the files it will edit on a `Touches:` line in its body. A scheduler that
brakes on files reads that line, not a comment, so a collision written only as prose never
reaches it. When `code-triage` measures an issue's file held by a live branch, it appends
that path to `Touches:` in the same step it reports the collision.

**Split an issue at the external-wait line (#371).** When only part of an issue waits on
an outside party (another team's API, a vendor, a ruling from outside the repo), neither
the edge nor the `deferred:external-party` park may hold the whole issue. Split it. The
part the repo can build now becomes its own issue and can start. The part behind the wait
keeps the edge or the park.
`code-triage` reports the split as a structural finding. It does not split the issue
itself: filing issues is not one of its writes.

Why, with the measurements: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md).

```sh
# read (repo-relative — no owner/name to get wrong)
gh issue view <N> --json blockedBy,blocking,parent,subIssues,subIssuesSummary

# write a sequence — colab owns this write (#251); it takes NUMBERS ONLY, resolves the
# database id itself, reads before writing, writes, and reads back to confirm the edge
# names the blocker you meant. Refuses cross-repo, structurally.
colab blocked <N> --by <M>
colab blocked <N> --by <M> --clear --reason "<why>" [--force]   # --force only overrides
                                                                  # the closed-blocker guard

# raw (portable fallback; the payload is the DATABASE id, not the issue number — the trap
# `colab blocked` exists to make unreachable, see below)
gh api -X POST   repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by -F issue_id=<db-id>
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by/<db-id>
gh api repos/{owner}/{repo}/issues/<M> -q .id      # ← how to get that db-id

# write a parent/child — GraphQL, and this one takes NODE ids
gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){clientMutationId}}' \
  -f p=<parent-node-id> -f c=<child-node-id>
gh api graphql -f query='mutation($p:ID!,$c:ID!){removeSubIssue(input:{issueId:$p,subIssueId:$c}){clientMutationId}}' \
  -f p=<parent-node-id> -f c=<child-node-id>
gh issue view <M> --json id -q .id                 # ← how to get that node id
```

`removeSubIssue` requires **both** ids — a child cannot be detached by naming only
itself. (`addSubIssue` is the laxer of the two — it accepts `subIssueUrl` in place of
`subIssueId`, and `replaceParent: true` to move a child that already has a parent;
verified live against the GraphQL schema, not restated from memory — `removeSubIssue`
has neither.)

**The two halves do not share an API, and that is the trap.** Sub-issues are GraphQL,
keyed by **node** id; dependencies are REST, keyed by **database** id — no dependency
mutation exists in GraphQL. Three mistakes fail loud (wrong type, `NOT_FOUND`); one is
silent and is the one to fear: the REST endpoint accepts an **issue number** as a valid
integer database id and **succeeds**, attaching a blocker from whichever issue happens to
hold that id *anywhere on GitHub*. **Read `blockedBy` back after every write.** `colab
blocked` (#251) takes issue numbers only, so this hazardous value never passes through a
caller's hands at all.

Why, with the measurements: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md).

**Read that confirmation from the `blockedBy`/`blocking` connections, never
`issueDependenciesSummary` — the summary lags the graph.** Measured, within a single
response: seconds after a `blocked_by` POST, `blockedBy.totalCount` read `1` while
`issueDependenciesSummary.blockedBy` in the same payload still read `0`.

**"No blockers" and "nobody checked" are the same empty list** — the second needs its
own marker:

```sh
gh label create deps-checked --color 0E8A16 --description "Dependencies verified — no open blocker"
colab readiness <N>           # set only after actually looking (raw: gh issue edit <N> --add-label deps-checked)
colab readiness <N> --clear   # a genuinely NEW blocker appeared, or the issue reopened — never "not now"
```

**`deps-checked` is monotonic (#279): once set, it stays set.** It records that a
reasoning session looked and found no open blocker — not that the issue is startable
*today*. Clearing it means exactly one of two things: a new blocker appeared (already
carried by the `blockedBy` edge above, so stripping the label on top of that edge adds no
information), or the issue reopened after being closed. It never means "startable in
principle, but not right now" — that fact has its own carrier, below (*Disposition*), and
piling it onto this label is what #279 measured going wrong: `code-triage` clearing
`deps-checked` to keep non-startable work out of the ready column, at a rate where more
than half of one repo's untriaged-looking backlog was actually triaged work misreporting
as untriaged. A prose note saying "checked, no blockers" does not count as setting it.

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

**The middle value is computed at read time, never recorded as a second label** —
rejected: a second label (stale the moment the blocker's own state moves — narrower a
hazard than it once was, now that `deps-checked` itself is monotonic (#279) and only ever
goes stale on a genuinely new blocker, but still a hazard a read-time computation avoids
entirely); deleting the edge once code is written (destroys a true fact, doesn't survive a
revert).

**An active session on the blocker is not evidence — a pushed branch with real commits
is.** An unpushed branch does not count either — invisible from other machines. **The
judgement fails toward `blocked`, never toward `ready`** — the mirror of the landed rule
([§4](#4-branches-and-commits)).

Why, with the measurements: [ADR 361](docs/adr/361-readiness-and-dependency-edges-rationale.md).

Reference implementation: `tools/lib/readiness.js` (`classify`, `isStartable`), pure —
facts in, verdict out — deriving "blocker's code written but unmerged" from
`tools/lib/landed.js` rather than re-counting commits.

##### Mechanical readiness — a weaker, honest claim for the empty case (#69)

`deps-checked` asserts *somebody looked* — stronger than "the encoded graph, read via
the API, has zero edges", because a prose-only blocker is invisible to a mechanical read
and visible to a reader. **A mechanical check must never write `deps-checked` itself** —
that launders a weaker guarantee into a stronger one.

```sh
gh label create graph-empty --color BFDADC --description "Mechanical check: the recorded dependency graph reads empty — NOT a substitute for deps-checked"
colab readiness <N> --mechanical           # reads blockedBy; if empty, applies graph-empty + posts a receipt
colab readiness <N> --mechanical --clear
```

- **Re-derives its own evidence** on every run, rather than trusting a caller-supplied
  flag.
- **Posts a receipt** naming what was read and when.
- **`blockedBy` only** — says nothing about parent/child relations (*Epics*, below).
- `readiness.classify()` keeps `graphEmpty`/`depsChecked` as distinct type-level inputs;
  empty-but-unchecked reads a fourth verdict, `unchecked-mechanical` — `isStartable()`
  still says no by default.
- Not in the convention label set ([§9](#9-adopting-this)), same reasoning as `tracking`.
- **No `readiness.marked` event fires for `--mechanical`** — that event kind's payload
  means `deps-checked` specifically (#45, #46); emitting it here would be
  indistinguishable from the stronger claim.

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
is a deprioritisation or a `wontfix`, and should be said plainly instead. An unbounded
park is a silent `wontfix`.

`review-by:<date>` is created **on demand**, the same way `group:<key>` is — the date
varies per issue, so there is no fixed set to provision up front.

**This section defines vocabulary only.** Landing it changes nothing `code-triage`
writes today: no tracker write in this repo's own tooling emits `deferred:*` or
`review-by:<date>` yet. Consumer-side rendering of a disposition, and surfacing of an
expired park, are meant to land before that write does — emitting the label before
something renders it distinctly produces a park that is machine-readable and unread,
which is worse than the silent park it replaces. Re-triaging existing silent parks once
the vocabulary exists is a follow-up, not part of landing the vocabulary.

How this generalises the `Ask:` line: [ADR 279](docs/adr/279-disposition-park-rationale.md).

##### Holds — every label that stops a start names its owner and its wake (#360)

The three hold kinds that recur in adopting repos, and the measurements behind this subsection: [ADR 360](docs/adr/360-holds-rationale.md).

**The three stay consumer-local. They are not adopted into the convention label set
([§9](#9-adopting-this)).** Each one names a fact this section already has a carrier for,
and a second name for the same fact is the two-carrier problem #279 measured with
`deps-checked`:

| Consumer hold | What it actually is | The handbook's carrier |
|---|---|---|
| "not yet" | a park | `deferred:date` + `review-by:<date>`, or `low-priority` (*Priority*, below) when it only means "later" |
| "needs rescope" | the issue no longer says what done looks like | fails *Actionable* in `code-triage`'s readiness gate; rewriting the issue is the wake |
| "waiting on the operator" | a human must act | `needs-decision` for a question (*Decision gate*, below); a hold for an act, such as a credential, a grant or a purchase |

A repo that already uses its own names keeps them, because its scheduler depends on them.
What this subsection adds is the rule every hold follows, whatever it is called.

**Declare them in `.github/project.yml`, so no reader has to guess:**

```yaml
holds: [hold:manual, needs-rescope]     # labels this repo's scheduler treats as start holds
```

- **Every label listed under `holds:` blocks a start.** `code-triage` reports an issue
  carrying one as blocked, never as ready. If a scheduler honours a hold that is not in
  the list, it and triage disagree without saying so, which is the failure the list
  exists to prevent.
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

Why a wake had to be checkable, with the measurements: [ADR 382](docs/adr/382-wake-vocabulary-rationale.md).

So `wake:` is now one of these, and a scheduler can evaluate every form on every beat:

| `wake:` | Met when |
|---|---|
| `review-by:<date>` | the date is reached. The `review-by:<date>` label is on the issue too. The label is what a query reads, and this line restates it |
| `#N` | the issue behind the `blocked_by` edge to `#N` closes (*Readiness*, above). The edge must exist |
| `ruling` | the owner acts. `Because:` is the ask (below). No fact makes this one "met": the owner's act *is* removing the label |
| `issueClosed:<owner>/<repo>#<n>` | that issue is closed. Use it for another repo's issue when no cross-repo edge is set. `issueClosed:<n>` (no owner/repo) names this repo's own, but a same-repo wait should normally be a `#N` edge instead |
| `branchLanded:<ref>` | `<ref>`, resolved as written, is an ancestor of trunk. A squash-merge never makes a branch tip an ancestor, so where branches land by squash, wait on the branch's issue (`#N`, `issueClosed:`) or on the landed commit (`trunkAt:`) instead |
| `trunkAt:<sha>` | trunk contains `<sha>` (7–40 hex) |
| `labelPresent:<label>` | the held issue carries `<label>` |
| `after:<date>` | the date is reached. Same meaning as `review-by:`, in the form a scheduler stores |

**`ruling` is the one definition of the "waiting on the operator" reason line.** When the
wake is `ruling`, the `Because:` line is the ask itself, written as what the owner has to
do or answer. A consumer's card reader parses this line and does not invent a second
syntax for it. If the ask is a question rather than an act, it belongs under
`needs-decision` instead, where the answer gets a record of its own.

**One spelling, not two.** Every checkable name above is spelled exactly the way the one
adopting scheduler that evaluates wakes already spells it, argument rules included. The direction is one way: a consumer that evaluates a
`wake:` never invents a second spelling for a name on this list.
`tools/lib/wake.js` is the parser and evaluator, and its tests pin the list.

Why two kinds are not adopted: [ADR 382](docs/adr/382-wake-vocabulary-rationale.md).

The rules:

1. **Several conditions on one line are ANDed:**
   `wake: issueClosed:owner/repo#12, trunkAt:abc1234`. A hold never wakes early on part of
   its condition, and a line with one piece outside the vocabulary names no wake at all.
   It is never read as its checkable rest.
2. **A wait on other work must use one of the checkable forms.** If that work has no
   issue yet, file one and point the hold at it. Only a wait that has no checkable form
   at all stays prose in `Because:`, such as a vendor or a person outside the repo. That
   wait **must** carry `review-by:<date>`.
3. **A `wake:` that names an issue or ref that does not exist is a finding when it is
   written**, not at the review date. A park waiting on nothing is the silent `wontfix`
   again, with a date attached.
4. **A met wake does not lift the hold by itself.** A scheduler that evaluates wakes
   posts once that the condition is met and hands the issue to triage. Triage reads the
   newest ruling or `Hold:` line, because a later ruling may have tightened the condition,
   and reports the hold as *wake met, lift?*. The owner removes the label, as above. The
   evaluator proposes; it never clears.
5. **Wakes are re-checked on every triage pass**, not only once `review-by:` is reached
   (`code-triage` §0, §2, §5). A wake that comes true between two passes is noticed on the
   next one, whether or not anything else in the backlog moved.

This applies to `deferred:*` and to every label declared under `holds:` alike, because
both carry the same `Hold:` line.

Nothing in this repo's tooling writes a `Hold:` line. The mechanical parts are the
audit's shape check on `holds:`, the codec's `Hold:` line pair (`tools/lib/codec/hold.js`, which
decodes only this exact shape — a looser line names no owner or wake and stays a stall), and
`tools/lib/wake.js`, which parses a `wake:` value and evaluates it against facts a caller has
already gathered. Whoever parks the issue writes
the line, and `code-triage` reads it (its §0, §2, §5 and §6).

#### Disposition — the marker, the seven kinds, and who may apply one (#315)

The park above is one of seven ways a piece of work can end. This subsection names all
seven, the marker that proposes one, and the rule deciding whether an agent may apply it
unattended or a human must.

**A session does not dispose of its own issue.** It does the work, posts evidence, and
proposes a disposition; a **separate later pass applies it**.

Why the separation: [ADR 315](docs/adr/315-disposition-kinds-rationale.md).

**The proposal is a marker**, one line, the family `colab:evidence` / `colab:grade` already
use (*Rules*, above), followed by a one-line reason in prose:

```md
<!-- colab:disposition proposed=hold -->
Waiting on the DNS change; `review-by:2026-10-01`.
```

`<token>` is one of a **closed** set of seven, **read by equality** — never by prefix, never
by heading text. No token is a prefix or a decorated variant of another. An unrecognised
token, a missing marker, or two markers proposing different things all mean **"not
cleared"** — never a silent default to the safe-looking value. *Degrade, never gate* applies
to absence exactly as it does for `colab:evidence`: a comment with no marker is evidence
with no proposal, never "no evidence exists".

**The kind and the token differ for exactly one member.** `not planned` keeps GitHub's own
close-reason spelling, because that is the string the close is made with; its token is
`not-planned`, because a token compared by equality cannot carry whitespace.

| Kind | Token | What it means | What it converts to |
|---|---|---|---|
| `done` | `done` | The ask was executed **and** cross-checked; acceptance ticked, or a remainder declared | closes with evidence |
| `split` | `split` | Part landed; the remainder is filed as a native sub-issue carrying the same `delivery:` and a wake condition, evidence copied across | closes with evidence |
| `routed-out` | `routed-out` | The work belongs to another repo; `<other-repo>#N` exists and links back | closes with evidence |
| `hold` | `hold` | Parked on a named wake condition | `deferred:<kind>` + a `Hold:` line whose `wake:` is from the closed vocabulary (above) |
| `needs-boss` | `needs-boss` | A human must answer before anything else can happen | a recorded decision (*Decision gate*, below) |
| `not planned` | `not-planned` | Superseded, or the direction was abandoned | closes as `not planned` |
| `leave` | `leave` | Nothing decided | **never applied by an agent** — a nameable wake ⇒ `hold`; nothing to name ⇒ a *finding* |

`leave` is the one kind that is not really a disposition. An issue on its fourth session
with no disposition is a **brief problem, not a measurement problem** — so an agent converts
it or reports it, and never leaves it. A human may leave with a reason; that reason is
itself the wake condition.

**The evidence a marker rides on has a fixed shape** — *what was done · the command · the
result · what remains*. Free-form evidence is a **finding, not a disposition**: a pass that
cannot tell what was done from what remains cannot verify either, and applying anything on
top of it is a guess wearing a marker. Where the ask was an **action** rather than a
measurement, a fifth line carries the **cross-check**: a second, independent, re-runnable
command confirming the effect. That line is what makes `done` mechanical — a measurement
cannot cross-check itself.

##### Who may apply one — a table over measurable inputs, never a judgement call

"Sometimes an agent, sometimes a human" has to be **deterministic**, decided from facts on
the issue, never from an agent's own confidence in its work. Two inputs are shared, and both
gate only the two kinds whose close **asserts an outcome** — `done` and `not planned`.
`split` and `routed-out` close too, but they re-home work rather than claim it finished, so
neither input reaches them.

- **The axis of record** (*Exposure*, §2). `exposure: released` ⇒ a human confirms; `none`,
  `self` and `live` ⇒ the agent applies. Read a legacy `tier`-only descriptor **through**
  that axis (`A -> released`, `C -> live`, `B -> null`) rather than by letter — which means
  a bare `tier: B` resolves to *no opinion*, and no opinion is not permission. This mirrors
  how `autonomy:` is granted by the repo and never claimed by the agent.
- **Skip-fence class** — production access, credentials, destructive or non-undoable
  operations, promotion. Evidence naming one of these ⇒ human, whatever the exposure. The
  agent names the classes its evidence touches; nothing sniffs prose for them.

| Disposition | **Agent applies** unattended when… | **Human must** apply when… |
|---|---|---|
| `done` | evidence in the fixed shape **∧** a re-runnable cross-check recorded **∧** acceptance ticked or a remainder declared **∧** the issue gates nothing still open **∧** the axis permits **∧** no skip-fence class | the axis does not permit · a skip-fence class · no cross-check possible · the issue is a gate node for something open |
| `split` | the remainder is filed as a native sub-issue with the same `delivery:` and a wake condition, evidence copied across | never — filing is mechanical |
| `routed-out` | `<other-repo>#N` exists **and** links back to this issue | never — but the filing itself obeys the destination repo's own language rule |
| `hold` | a wake condition is present — `review-by:<date>`, a real `blockedBy` edge, **or** a `wake:` from *Holds*' closed vocabulary | the wake has stood **30 d** (a PROPOSAL, unmeasured) with no movement ⇒ a human confirms it is still wanted, else `not planned` |
| `needs-boss` | **never** — the agent *records* the question and moves on (record-first) | always; the answer returns the issue to intake |
| `not planned` | superseded by a **merged or closed** replacement that references this issue | an abandoned direction — a human judgement, always |
| `leave` | **never** — the agent converts it (see above) | a human may leave with a reason |

Three properties hold this together, and each is load-bearing:

- **Fails towards `human`, always.** An absent, malformed or unresolvable fact never yields
  `agent` — the posture *Readiness* (above) takes towards `ready`, for the same reason.
  Spending a human's attention on something mechanical is cheap and visible; closing an
  issue nobody checked is expensive and invisible.
- **"An agent may" is never "a human may not."** A human can apply any disposition on any
  issue at any time, in either direction. The verdict is a proposal, not a lock.
- **A mechanical gap is not a judgement call.** `split` with nothing filed yet, or `hold`
  with no wake named, is not *escalated* — it is *incomplete*. The fix is to file the
  sub-issue or name the wake, not to ask somebody. Only the outcome-asserting kinds escalate.

**The reference implementation is `tools/lib/disposition.js`** — pure, facts in, `agent` |
`human` out, no tracker I/O, the pattern `readiness.js`, `landed.js` and `axis-authority.js`
already set. Two consumers reaching the same verdict from the same evidence holds **by
construction** only if both call one function, or copy-and-own that file ([§9](#9-adopting-this)); two prose
copies of the table above is the two-places-drift disease this handbook exists to kill.
`parseMarker` / `formatMarker` are the only sanctioned way to read or write the marker —
they are what keeps the token set closed and the comparison by equality.

**This section defines vocabulary only**, exactly as the park above does. Nothing in this
repo's own tooling writes `colab:disposition` today, and no skill here reads it: the pass
that applies a disposition is coupled to a consumer's own surfaces and lives with that
consumer, not in a repo-generic handbook. What lives here is the table both sides agree on.

#### Decision gate — a human must answer first (#122)

Some issues cannot start, or cannot finish, until a human answers a blocking question —
a design pre-approval, a business-logic call, a permission. `needs-decision` (named
`needs-ruling` before #122; widened because "ruling" read narrower than the gate actually
covers) marks that. A designer producing a spec decides, while producing it, whether a
surface needs human pre-approval before code starts, and applies the label if so — the
call belongs to whoever is producing the spec, never inferred mechanically from title or
labels.

**`needs-decision` blocks starting the issue** — a readiness gate exactly like an open
hard blocker or a live claim — until a human answers and that answer is **recorded**
(below). No session, manual or scheduled, starts an issue that still carries it.

**On an issue whose deliverable is a design artifact, approving the artifact is not a
question you can ask at filing (#361).** The gate blocks the start, and the start is
the session that produces the artifact. Labelling the issue at filing, for an approval
that needs the finished artifact, blocks the only session that could produce it. So:

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
The label is a start gate, and an epic is never a start candidate (*Epics*, below), so on
an epic the label gates nothing. Why, with the measurements: [ADR 122](docs/adr/122-decision-gate-rationale.md).

**[Hard — gate: colab decision --reopen refuses]** **A question about an epic goes on its own decision issue**, the same shape as the third
path below. Its body carries the question and, if there are options, the
`decision:options` block. It carries `needs-decision`, and it is attached to the epic
**as a sub-issue**. If the question holds back a specific child, that child also gets a
`blocked_by` edge to the decision issue. Why, with the measurements: [ADR 122](docs/adr/122-decision-gate-rationale.md). Once the ruling is recorded
(`colab decision --record`), the decision issue closes with the record as its evidence.
`colab decision --reopen` refuses on an `epic`-labelled issue and names this path.

**A session discovering a significant design decision mid-work continues on the
designer's spec** rather than stopping to request a ruling, and records
`design-not-preapproved` in its ship evidence — so the closure itself is what a human
reviews, after the fact. This default stays the rule everywhere a usable default exists.

**The third path (#122) — only when there is no usable default and the work genuinely
cannot finish.** A session that hits a genuine, blocking, non-design ruling mid-work — not
a design fork with a spec to fall back on, but a question with no default answer — files
the ruling as its **own** issue, wires a `blocked_by` edge (§*Readiness*, above) from the
issue it is working, and **keeps its claim**. The question becomes visible where humans
and triage already look — a labelled issue, not prose in a comment nobody scans — while
the work stays owned so no second session picks it up mid-flight. **This is not licence to
stop on any fork** — the default-exists case above is unchanged and still the ordinary
rule; this path exists only for the genuinely blocking, no-default case.

**Recording the decision is what clears the gate — it is not a separate act a human must
remember.** Measured failure (#127): a ruling was posted as ordinary prose in a comment
and the `needs-decision` label removed by hand. A later triage pass, reading the issue
fresh, saw no machine-readable trace of a decision, re-gated it, and reported it
not-startable — the ruling had been sitting in the comment the whole time. **A cleared
label is indistinguishable from a label never applied.** So the answer, not the label's
absence, is the artifact: a `⚖ Decision recorded` comment (`tools/lib/decision-record.js`)
naming who ruled and what it answers, plus the `decision-recorded` label, written together
by `colab decision <N> --record --ruled-by <name>` — never `needs-decision` cleared alone.
A reader checking whether an issue is decided looks for `decision-recorded` or the live
comment marker, never merely for `needs-decision`'s absence.

**A second question on an already-decided issue goes through `colab decision <N> --reopen
--ruled-by <name>` — never a hand-added `needs-decision` (#357).** This is the rule above
seen from the other side: the label is never *removed* by hand, and for the same reason it
is never *re-added* by hand. A decided issue can need a second ruling — ruling one
commissions a design, and later the finished design needs approving. `--reopen` removes
`decision-recorded`, re-applies `needs-decision` and posts a `↩ Decision reopened` receipt,
so the issue reads as open to every reader. A hand-added `needs-decision` does not: it
leaves the issue with **both** labels. Why, with the measurements: [ADR 122](docs/adr/122-decision-gate-rationale.md).

**Both labels at once is ambiguous, and a reader resolves it by time.** Two histories leave
the same pair. An **interrupted write** is `--record` posting its `⚖` comment and then
failing its label swap, so the question is answered. A **second question** is someone
re-adding the label by hand, so the question is open. Compare the newest *ask* with the
newest live, trusted `⚖ Decision recorded` marker. The ask is the newest `needs-decision`
`labeled` event on the issue, or the newest `<!-- decision:options -->` comment, whichever
is later.

| Evidence | Reading |
|---|---|
| The ask is newer than the marker | an **open question** — pending |
| No live marker at all, only the label | an **open question** — `--record` posts its comment first, so an interrupted write always leaves one |
| The label timeline was read, and every ask predates the marker | an **interrupted write** — answered; finish it with `gh issue edit <N> --remove-label needs-decision` |
| Anything the reader cannot prove (timeline unread, no event found) | **undetermined** — surfaced as **pending**, never hidden |

**[Hard — gate: colab decision --record refuses]** This leans towards showing the issue, like *Readiness* does. Why, with the measurements: [ADR 122](docs/adr/122-decision-gate-rationale.md). The reference reading
is `pairVerdict` in `tools/lib/decision-record.js`. `colab decision --list` names every
issue carrying the pair, with its verdict and fix. `colab decision --record` **refuses**
over the pair unless `--answers <ref>` says which question the new record answers.

#### Decision options — what a ruling chooses between (#126)

The mechanics above make the **answer** to a `needs-decision` gate machine-readable.
They say nothing about the **question**: what a human is actually choosing between.
Why, with the measurements: [ADR 126](docs/adr/126-decision-options-rationale.md).

**The filer of a `needs-decision` issue writes the options as a fenced block**, at
filing time, whether the filer is human or an agent — this is not scoped to
`agent-filed`/`Ask:` (above), because `needs-decision` itself gates issues from either
provenance:

```
<!-- decision:options
A: Short label (recommended) | One line of detail — the trade this option makes.
B: Short label | What this one buys and what it costs.
C: Short label | Listed for completeness; why it is probably wrong.
-->
```

- `LETTER: label | detail`, one option per line; `detail` is optional.
- **Two or more lines, or the block does not count** — a one-option decision is not a
  decision.
- An HTML comment fence, so it costs a human reader nothing in the rendered issue.
- **The block states the choices. It never states the answer** — recording the
  acceptance is the separate, later act above (`colab decision --record --answers
  <ref>`), naming the block it resolves.

**Lives in the issue body by default** — written once, at filing, alongside the rest
of the ask. A discussion that narrows the choices may re-post the block as a comment,
and then **the newest block by creation time is the live one** — the same
most-recent-wins reading `liveDecisions` already applies on the answer side. That rule
is for a reader rendering an issue nobody has answered yet. Which block a *recorded*
decision answers is never inferred from recency: `--answers <ref>` names it explicitly,
and that reference is what a consumer cross-checks against (`answeredOptionRefs`,
`tools/lib/decision-record.js`).

**Absent block means "options not declared"** — exactly as an absent `Ask:` line reads
as `backlog` (above): no backfill, no new failure state for issues filed before this
existed. The one exception is the design-approval ask below: a `needs-decision` question
in neither shape is reported to its filer as a finding (#379). That is a report, never a
gate, and it never changes whether the question is pending.

#### Design-approval ask — the `Mockup:` line (#379)

The options block is the shape for a pick-one question. The other common ask, approving
a finished design artifact (*Design conclusions are three units*, below), is a yes/no on
an image, and had no machine-readable shape at all. Why, with the measurements: [ADR 379](docs/adr/379-design-approval-ask-rationale.md).

**The design issue's body carries the ask as one line:**

```
Mockup: https://…/frozen-screenshot.png
```

- **In the body, never only in a comment.** A reader finds it with one field and no
  timeline walk. The session that produced the artifact edits the body when it asks.
- **Anchored at the start of a line**: `Mockup:`, then the URL of the frozen image. An
  indented or inline `Mockup:` is quoted text, not a declaration. The image is the same
  frozen evidence unit 3 attaches to the ruling.
- **A set reviewed together** (one review per workflow set) puts one `Mockup:` line in
  **each** member's body, pointing at that member's image. The review comment keeps the
  full gallery and the per-page A/B lines.
- **Several lines are allowed** when one issue's approval covers several frozen images.
- **Both shapes present** read as the options block: a pick-one question is the more
  specific ask.
- **On an issue that already carries `decision-recorded`**, the ask still goes through
  `colab decision <N> --reopen` (*Decision gate*, above). The `Mockup:` line says *what*
  is asked. `--reopen` is what makes it read as asked.

**A `needs-decision` issue whose ask is in neither shape is a finding for its filer**, not
an item left in the queue. `code-triage` and `code-sweep` report it and name the filer.
They do not rewrite the ask, because the question is not theirs to restate. The reference
reading is `askShape` in `tools/lib/decision-record.js`, which `evaluateIssue` reports as
`unshapedAsk` when it is given the body.

#### An ask is said once — a later pass reports that it is still waiting (#489)

The shapes above say how a question is put to a human. This rule says how often. A
coordinator pass (`code-triage`, a sweep, a ship session) that finds work blocked on a
human ask used to render the whole question again on every pass: the question, the
options, the recommendation. Why, with the measurements: [ADR 489](docs/adr/489-ask-said-once-rationale.md).

**An ask is open when either of these holds:**

- **The tracker already carries it.** The issue has a pending `needs-decision` (*Decision
  gate*, above, read with `pairVerdict`) whose ask has a shape, either an options block or
  a `Mockup:` line. Or its newest `Hold:` line has `wake: ruling` (*Holds*, above), and the
  `Because:` line is the ask. A decision inbox that an adopting fleet runs reads these same
  marks, so a question already in that inbox is open in this sense too.
- **An earlier pass of the same skill already rendered it** in its own output and stored
  it (`code-triage` §0.1, `asks`). Use this when the question exists only in that
  session's output, for example *wake met, lift?* or *a ruling exists in a comment, record
  it?*.

**An open ask gets exactly one line on every later pass. A pass never renders its options
again:**

```
unchanged, waiting on <link> since <date>
```

- `<link>` is where the answer goes: the options-block comment, the `Hold:` line comment,
  or the issue itself for an ask that was only in session output.
- `<date>` is when the ask was first put. That is the newest ask event for a tracker ask
  (the same "newest ask" *Decision gate* compares with the marker), and the date of the
  first rendering for an ask that was only in session output. It is never the date of
  this pass. The point of the line is to show how long the human has been asked.
- A pass may append who clears the ask. It never adds the question, the options or the
  recommendation again: those are behind the link.

**A new ask is rendered once, as a five-line card:** the question first, then two or more
options, then the recommendation on its own line, then what stays parked if nobody
answers, then the link. Any of these makes an ask new: it was never rendered before, the
tracker now carries a newer ask than the stored one (a re-posted options block, or a
`--reopen`), or the question itself changed. A card is session output, like the rest of a
triage report. It never authorises a tracker comment that a skill's own write list does
not name.

**Waiting on a human is not a change.** An unanswered ask gets older on every pass, but its
age is not an input to anything. A pass whose only news is "still unanswered" is an
unchanged pass: on a skill with a no-change short-circuit (`code-triage` §0), it stays on
the cheap path. It never re-asks, escalates or re-renders because time has passed. What
moves an ask is the human's answer (a recorded decision, a label removed, a hold lifted).
Those already move the inputs that the short-circuit compares.

**No open ask, no change.** A repo with no open human ask renders nothing new.

#### An ask the human must answer can be raised once in a decision box (#490)

The rule above controls how often a coordinator says an ask. It does not control where the
human sees it. Some items cannot be settled by any coordinator: a migration grant, a
promotion, a design ruling, a production credential, a destructive operation. A pass that
finds one sets it aside and leaves it in the tracker's decision queue. The human who owns
it may not watch that queue. A deployment may run a separate **decision box** that the
human does watch. This rule says how a coordinator delivers the ask there, and how the
answer gets back.

**The box is optional and set by the deployment.** A skill reads its endpoint from a
deployment setting. No host is ever written into a skill or into this handbook. **No
endpoint set means no change:** the ask stays where it already lives, as the issue's
`needs-decision` label and its `decision:options` block (*Decision options*, above).

**Only a human-only item is raised.** That is an item the pass set aside because no
coordinator may decide it, the list above. An ask that a coordinator can rule on is ruled
on, not sent on.

**The tracker stays the record. The box only delivers.** Raising an item changes nothing
on the issue. The label, the options block and any `Hold:` line stay exactly as they were,
and readiness still reads them. A box that is down, or never answers, loses a delivery,
never the ask.

**A raise carries everything needed to answer without opening the tracker:**

- the issue link;
- the question;
- two or more options, taken from the issue's `decision:options` block, never re-derived;
- the recommendation, on its own line;
- what stays parked if nobody answers;
- an opaque **reply-to**. The raiser composes it and the box hands it back unchanged with
  the answer. The box never parses it. It is what lets the answer find its issue.

These are the five lines of a new-ask card (above), plus the reply-to.

**Raised once, checked first.** An item is identified by its issue link plus the date of
its newest ask (the same "newest ask" *Decision gate* compares). Before raising, a pass
looks for an earlier raise under that key. It looks in its own stored asks, and in the box
when the box can answer the lookup. If it finds one, the pass writes the one line from the
rule above, with `<link>` pointing at the raise in the box:

```
unchanged, waiting on <link> since <date>
```

It does not raise the item again. A newer ask on the issue (a re-posted options block, a
`--reopen`, a changed question) is a new key, and it is raised once in turn.

**The answer comes back as a comment on the issue, and the raiser never polls.** The box
has an answer notifier. The deployment wires it to post the human's answer onto the issue
named by the reply-to. The raising skill never asks the box whether an answer has arrived.
Waiting is not a change (above). The comment that arrives is an answer left in a comment.
It moves the issue the same way as one typed into the tracker by hand: it is recorded as
*Decision gate* requires before the gate lifts. The box itself never removes a label or
records a decision.

#### The human flag — what `COLAB_HUMAN=1` asserts

`COLAB_HUMAN=1` is one mechanism carrying one assertion, used at several gates in this
handbook: **a human is behind this command.** ⚖ #233 widened it to this single statement,
covering both uses it already had and one it gained. Read every site below as an instance
of the same assertion, never as a separate rule with its own semantics:

- **Promotion** ([`colab promote`](#4-branches-and-commits)) — authorises the act that
  deploys to production.
- **Migration exemption** (below) and **Red-trunk exemption** (below) — authorise a write
  that did not exist before the command ran.
- **A place-claim override** ([Place-claims](#place-claims--the-writer-verifiable-hold-a-shared-checkout-needs-and-a-worktree-does-not),
  above) — authorises taking over a live hold.
- **`colab adopt`'s exposure-lowering gate** — authorises a descriptor claiming fewer
  consumers exist than the tool can verify.
- **Solo-flow entry** ([Solo flow](#solo-flow--trunk-direct-issue-on-demand-entry-gated-a-human-must-be-at-the-keyboard),
  above) — the newest instance (⚖ #233): asserts a human is present to commit straight to
  trunk, on any repo that does not declare the veto.

**Two terms make the assertion checkable, not just statable** — the same standard
`code-ship` already holds itself to, restated here as the general rule rather than one
skill's local convention:

- **Transcription, never inference.** Set it because a human said so — "take the trunk,"
  "promote this," "grant the migration" — never because the situation seemed to call for
  it. A human's go-ahead counts; an agent's own reading of the situation never does.
- **Live conversation only.** A headless, scheduled, or driver session may never set it,
  whatever its prompt contains. Why, with the measurements: [ADR 233](docs/adr/233-human-flag-rationale.md).

**The honest limit, stated once here rather than wherever it currently gets re-derived:**
`COLAB_HUMAN` is an env var the gated party can set itself — nothing enforces the two
terms above beyond the discipline of everyone honoring them (#150, parked: a stronger
mechanism would need an out-of-band attestation this fleet does not have). The two terms
are what make a violation *legible* after the fact, not what makes one impossible.

#### Migration exemption — a narrow door through no-new-migrations, opened by a role (#98, #402)

**[Hard — gate: colab ship refuses]** `colab ship` refuses, by default with no flag/env/field to lower the bar, any branch
touching `database/migrations/` or `prisma/migrations/` — or any prefix the repo declares in
`project.yml` `migrations:` (#383, [`project.schema.md`](project.schema.md#migrations--optional)).
A declaration only ever widens what the gate sees, never narrows it; a repo keeping migrations
elsewhere without declaring them is a repo whose gate reads `no new migrations ✓` on a backfill.

**A migration grant is a narrow, per-issue, branch-bound, expiring exemption, and every
grant names the role that decided it** — deliberately not a repo- or tier-level switch.
There are two roles. The repo says which ones it accepts (#397, #398):

| Role | Who decided | Marker | Bound to | Accepted |
|---|---|---|---|---|
| `human` | a person | `🛢 Migration grant` | the branch | on every repo — the default |
| `migration-reviewer` | a declared reviewer, with a review record | `🔎 Migration review grant` | the branch's exact HEAD, plus a live CI round-trip on it | only under [`migration-grant: reviewer`](project.schema.md#migration-grant--optional) |

**On trunk, where the repo's policy allows it and a reviewer is bound, a reviewer grant with
evidence satisfies the gate just as a human grant does.** Nothing else moves with it:
`COLAB_HUMAN=1`, promotion, release and production stay human on every repo, under every
policy.

**What holds for every role:**

- **[Hard — gate: colab migration-grant refuses]** **Minting is a human act.** `colab migration-grant` refuses (exit 1) unless
  `COLAB_HUMAN=1`, checked before any network call, for either role — no agent may create
  or infer one ([*The human flag*](#the-human-flag--what-colab-human1-asserts), above).
  The reviewer role changes what a grant must *prove*, not who may post it.
- **Two required parts**: a `migration-granted` label (requires write/triage permission)
  and a comment naming the exact branch (labels cap at 50 chars, cannot carry a branch
  name). Never authorises a migration arriving on a different branch later.
- **Expires the instant its issue closes** — `ship` reads the issue's live open/closed
  state, never a separate expiry.
- Visible from any machine — no local-only fallback.
- **Covers the whole ship set**, never narrowed by `--refs`. One issue without a valid
  grant fails the set: a migration cannot be attributed to one member of a group branch.
- `--revoke` removes the label first (gate restored immediately), then posts a receipt.
  A revoke cancels every earlier grant on the issue, of either role, whoever posted it.
  `colab migration-grant --list` names every live grant.
- **Never weakens any other precondition** — CI green, claim corroboration, trunk-checkout
  check, and hand-merge conflict check all still run in full on a granted branch.
  `--batch` still refuses every member that carries a migration, granted or not.

**Who counts as a human — `trust-humans` (#407).** By default a grant (or a ruling,
[*Decision gate*](#decision-gate--a-human-must-answer-first-122), above) counts as a
human's when its author's GitHub association is `OWNER`, `MEMBER` or `COLLABORATOR`. Why, with the measurements: [ADR 98](docs/adr/98-migration-exemption-rationale.md). A repo
in that position lists its humans:

- **Declared** ([`trust-humans:`](project.schema.md#trust-humans--optional)) → a human
  grant or ruling counts only when its author's login is listed (and still holds that
  association). For `migration-granted` and `ci-granted`, the account that **last applied
  the label** must be listed too, so a label re-added by an agent does not ride on a
  human's old comment. An unlisted, unknown or unreadable author is not human, and the
  refusal names the login.
- **Absent** → the association class decides, exactly as before. Nothing changes for a
  repo that does not declare it.
- **Read from the target, never the branch.** Ship reads the list from `project.yml` at
  the tip of the branch being merged into, and rulings read trunk's — a branch cannot
  add its own author. **Editing the list is a human act**, like lowering exposure. As
  with every other human-only rule here, #150's limit applies to *enforcing* that: the
  handbook cannot stop an account with write access from editing the file. The list only
  stops the readers from throwing away a difference the platform already has.
- **A reviewer grant is not judged by this list.** It passes or fails on the policy, the
  review record, the HEAD and the round-trip below. The list decides only what a *human*
  grant is.

**The human role** is unchanged since #98: branch-bound, not HEAD-bound, and honoured on
every repo. Where both roles are live on an issue, a valid human grant wins.

**The reviewer role** names the reviewer's **declared** identity and carries a **review
record**: a fenced `` ```migration-review `` block giving the verdict, the checklist
result, the escalation condition checked, the CI round-trip result, the reviewed HEAD
sha, and a `migrations:` content id that `colab migration-grant` computes itself. Four
properties hold it together:

- **Bound to what was reviewed (#508).** The content id is a sha256 over the path and git
  blob id of every migration file the branch changes, at the reviewed HEAD. The grant covers
  that content, not that commit. A commit that leaves every migration file byte-identical
  keeps the grant live. Editing, adding, removing or renaming a migration changes the id
  and voids it.
  Why, with the measurements: [ADR 98](docs/adr/98-migration-exemption-rationale.md).
  A record with no content id (minted before #508, or on a branch with no migration file)
  stays bound to its HEAD alone, and a new commit voids it as before. A reader that predates
  the field sees an unknown key and refuses the record, so an older `colab` fails closed.
- **Opt-in per repo.** `migration-grant: reviewer` is read from the trunk checkout when a
  grant is minted, so a branch cannot raise its own policy. The default is `human`, and
  `colab migration-grant` refuses to mint a reviewer grant anywhere else.
- **Recorded only if the review passed.** The record must approve, pass the checklist,
  clear the escalation and pass the CI round-trip. A failing review is refused, not
  recorded. A *claimed* pass is checked too, before anything is written (#457): the CI
  round-trip job must have run and passed at the recorded HEAD, a cited run must be one of
  that HEAD's runs and carry the job, and a checklist count must be out of the checklist the
  review skill walks today, every item passed. A repo whose CI has no round-trip job cannot
  mint a reviewer grant at all — it adopts the template's job or ships on a human grant.
- **Not attested.** The reviewer id and the recorded CI result are claims made in the
  comment. The label's write permission and the trusted-author check are the only
  anti-forgery properties, so a gate re-verifies CI for the recorded HEAD itself — the
  mint-time check only keeps an honest tool from writing a false record; it proves nothing
  about a comment posted by hand.

**[Hard — gate: colab ship refuses without conditions P, M, HEAD, R]** **`colab ship` honours a reviewer grant only when four conditions hold together (#401):**

- **P, policy.** `migration-grant: reviewer` in `project.yml` at the tip of the branch
  being merged into. The branch's own copy never counts.
- **M, record.** A live reviewer marker from a trusted author, bound to this branch,
  with a valid review record that passes.
- **HEAD.** Ship reads the branch's head on the remote, and the local branch must agree
  with it. The grant binds that head when the record's head is exactly it, or when the
  record's `migrations:` id equals the id ship computes at that head (#508), using the
  same path rule the gate fires on. An unreadable id never matches.
- **R, round-trip.** The live CI round-trip passed on the **shipped** head, which after a
  sync is not the reviewed one. Ship re-reads CI itself
  and never trusts the recorded `ci-roundtrip:` value. The job is found by the name
  prefix `Migration round-trip` (the legs of `templates/ci-laravel.yml`). Every leg
  needs a run that completed with success and ran at least one step. The template's job
  rolls back to the oldest migration the branch **adds or modifies** (#507), so a branch
  that only repairs an existing `down()` gets a round-trip that actually runs it, and the
  run's log names every file it exercised. A copy older than that counts added files only:
  its green says nothing about a modified migration, so re-sync it before a reviewer grant
  relies on it. A repo without that
  job cannot pass R, and a branch that edits `.github/workflows/` cannot pass it either,
  because a branch must not rewrite the job that grades it. Those branches ship on a
  human grant.

If any condition fails, the gate behaves exactly as it does without a reviewer grant: a
human grant, or a human running Phase B. The refusal says which condition failed
(`reviewer grant [HEAD]: …`). One function makes this decision for every ship path —
`--dry`, `--dry --json`, a real ship and the auto-trunk path — so no path can accept a
grant another refuses.

**`needs-migration-grant` is this gate's plan-time half, not a second gate (#230).**
It is provisioned in `CONVENTION_LABELS` alongside `migration-granted` for the same
malignant-absence reason, but nothing in this repo's own tooling reads it — a
downstream consumer (the fleet dashboard) applies it at plan/triage time, as soon as
it can tell an issue's deliverable IS a schema migration, so the grant request
surfaces before `ship` ever has a reason to refuse. It authorises nothing by itself;
only a grant minted as above does that.

#### A red trunk with no patch — never parked in silence (#390)

The two doors below, and `code-ship`'s red-trunk ordering, cover **landing** a patch for
a red trunk. Something has to **create** one first. The invariant:

> **A green, finished branch is never parked behind trunk CI while there is neither an
> open, accepted `TRUNK RED:` issue nor a re-run in flight.**

An issue that diagnoses the red under another title, or still carries `agent-filed`, does
not count: nobody will pick it up as the patch. Triage's §0 therefore treats "trunk red,
and no open accepted `TRUNK RED:` issue" as a change that forces a full pass, even when
none of its fingerprint inputs moved. The full pass adopts such an issue: it retitles it
and drops `agent-filed` (#430).

Two actors hold it, one per half, and neither does the other's:

- **The re-run — the repo's scheduled driver, where one exists.** Once per red sha,
  only when the red commit's diff is docs-lane-only
  ([§2](#autonomy--the-docs-only-exception-345)) and no `TRUNK RED:` issue is open. It is
  the **only** re-run actor for a red trunk: two actors each allowed one re-run per sha
  make two, and a green second run can bury a real defect ([§4](#4-branches-and-commits),
  *Telling `red:infra` from `red:finding`*).
- **The filing — triage.** When the re-run has been tried for that sha, or cannot apply
  (the commit touches more than docs, or nothing drives the repo), and no accepted
  `TRUNK RED:` issue is open, triage files `TRUNK RED: <sha> fails <check>` — or comments
  the occurrence on an open issue for the same flake class, or adopts an open issue that
  already diagnoses the sha — at most once per red sha. It is
  one of triage's authorised writes (`skills/code-triage` §0.2, write 8), and triage
  never re-runs a job itself.

Why, with the measurements: [ADR 390](docs/adr/390-red-trunk-no-patch-rationale.md).

#### Red-trunk exemption — the one-shot door through trunk-CI-green (#105)

Why, with the measurements: [ADR 105](docs/adr/105-red-trunk-exemption-rationale.md).

- **Two roles, as for a migration grant (#504).** The repo says which it accepts:

  | Role | Who decided | Marker | Bound to | Accepted |
  |---|---|---|---|---|
  | **[Hard — gate: colab ci-grant refuses]** `human` | a person, `COLAB_HUMAN=1` | `🚨 Red-trunk CI grant` | the branch and the red trunk sha | on every repo — the default |
  | `ci-reviewer` | the coordinator agent, with a review record | `🩹 Red-trunk CI review grant` | the branch's exact HEAD and the red trunk sha | only under [`ci-grant: reviewer`](project.schema.md#ci-grant--optional) |

  **[Hard — gate: colab ci-grant refuses without COLAB_HUMAN or the reviewer opt-in]** `colab ci-grant <N> --branch <b> --role ci-reviewer --reviewer <id> --verdict
  pass --cures "<check>; <check>"` mints it **without** `COLAB_HUMAN=1` — the only grant
  that does — and only where trunk's committed `project.yml` declares the opt-in (a branch
  cannot opt itself in). Every guard is **measured** at mint, nothing is taken from the
  flags: the branch's trailing number group carries `#N`; `#N` is open and titled
  `TRUNK RED:`; trunk is red in the sense `ship` checks; never stacks (the same guard as the
  human grant); the branch's own CI is green at its **exact** pushed head; and every check
  the record claims to cure is red on trunk at the red sha. The review record (a fenced
  `ci-review` block) carries `verdict: pass`, the reviewed `head`, the `red` sha and the
  `cures`. `ship` re-measures all of it — issue, title, opt-in at the merge target, red sha,
  branch green at exactly that head, cures still red — and honours an optional
  `not-before` (a revoke window the host imposes) by reading the grant as *not yet usable*
  until it passes. **Revoking stays human** (`COLAB_HUMAN=1 colab ci-grant <N> --revoke`
  cancels every role). The reviewer identity is declared, not attested — the same caveat as
  the migration reviewer. Why, with the measurements: [ADR 105](docs/adr/105-red-trunk-exemption-rationale.md).
- **[Hard — gate: colab ship refuses a stale CI grant]** **Bound to one issue, the branch, AND the exact red trunk sha reviewed against** — it
  expires the instant trunk's head moves, for any reason.
- **[Hard — gate: colab ship refuses unmeasured evidence]** **Evidence is measured, never asserted** — creating one requires a completed,
  successful CI run for the branch's own current head sha; `--evidence-run` is
  recording-only and never substitutes for the measured run.
- **[Hard — gate: colab ci-grant refuses a stack]** **Never stacks** — refuses against a green trunk, and refuses again if a prior grant
  already merged something and trunk has been red continuously since.
- A grant-authorised merge carries a `CI-Grant:` trailer in the squash commit itself, in
  addition to the tracker comment.
- **Scoped to exactly one precondition** (trunk-CI-green) — never exempts no-new-
  migrations, claim corroboration, the trunk-checkout check, the hand-merge conflict
  preview, or `colab promote`. **Trunk-only** — an integration line's red already
  borrows trunk's advisory verdict when the line has no runs of its own; widening the
  exemption to lines is a deliberately unmade decision.

#### Cure rule — the machine-checkable door through trunk-CI-green (#281)

A second door through the same precondition, tried **before** ci-grant and needing
**no human step at all** — `colab ship` fires it automatically the moment the raw
trunk-CI-green check fails HUMAN_GATED, and falls straight through to the ordinary
ci-grant when any condition below is not met. Fires **iff**:

1. **[Hard — gate: colab ship refuses (cure rule)]** the branch **contains trunk's current red head sha** as an ancestor — proof the
   branch was built against the exact failure, not merely conflict-free with it.
2. **[Hard — gate: colab ship refuses (cure rule)]** the branch's own CI is green **at its own current head**, measured, never asserted —
   identical "ask by sha" discipline to ci-grant's evidence guard — **and** (2b, #297)
   every job that is RED on trunk's runs at the red sha exists in the branch's runs at
   that head, completed and concluded `success`, matched per workflow. It is scoped to
   trunk's **red set**, so an advisory job failing only on the branch does not refuse:
   the rule certifies that the branch cures trunk's red, not that the branch is
   spotless. A job instance from a `workflow_dispatch` run counts here only under the
   #510 rules below (*Dispatch evidence for a job a branch push skips*).
3. **[Hard — gate: colab ship refuses (cure rule)]** the **same anti-stacking guard** ci-grant uses holds — no prior grant OR cure already
   merged while trunk has stayed continuously red since. A repo that auto-cures once and
   stays red anyway must not auto-cure again on the same continuous red. **One admission
   — progress (#477):** a further cure passes condition 3 when trunk's red-job set at
   its current red sha is a **strict subset** of the red-job set at the red sha the
   prior exemption was measured against (the `over-red` sha its `CI-Grant:` / `CI-Cure:`
   trailer names), jobs matched per workflow as in 2b. An **unchanged** set refuses (the
   prior exemption fixed nothing that stayed fixed), and so does a set with **any new**
   red job, even if another healed — trading one red for another is the loop this
   condition exists to break. Either set unmeasurable (runs aged out, a job still in
   flight) refuses. The candidate must still cure the remaining set under every other
   condition. The admission belongs to the cure rule only; a human `ci-grant` create
   keeps the plain guard.
4. **[Hard — gate: colab ship refuses (cure rule)]** the branch diff does **not** touch `.github/workflows/**` — a branch may not
   self-certify a change to the CI configuration that is grading it. This door
   stays behind a human ci-grant, **unless** the branch passes the carve-out
   below. The diff is read without rename detection, so moving a workflow file
   out of the directory counts as touching it (#297).
5. **[Hard — gate: colab ship refuses (cure rule)]** the branch diff does **not** change the `scripts` block of any `package.json` (#297).
   Any `package.json` at any depth counts (the template's working directory is an
   adopter's edit point, and workspace runners read nested scripts); key order does not,
   a changed command does; deleting or renaming a manifest counts. There is **no
   carve-out** for this condition — see below for why the #321 door cannot adjudicate
   it. **One narrow admission (#475): an add-only change.** When every touched
   `package.json` exists on both sides, keeps every script it had with an identical
   command, and only *adds* keys, the template runs more, never less — so it passes
   condition 5 provided every step that ran in each red job on trunk, the failing one
   included, ran on the branch and concluded `success` (the 4b read, without 4c). Its
   limit: an added npm **lifecycle** hook (`postinstall`, `prepare`, or
   `pre<x>`/`post<x>` for a script `<x>`) is never admitted — it runs inside a step that
   already exists and can rewrite what that step measures with no name changing. A
   removed, renamed or changed script, a new manifest, and an add-only change in one
   manifest beside any other change in another still refuse.
6. **[Hard — gate: colab ship refuses (cure rule)]** the branch diff does **not** change a Python dependency manifest (#377). What counts,
   at any depth: `pyproject.toml`, `setup.py`, `setup.cfg`; any `.txt`/`.in` whose name
   contains `requirements` or that sits under a `requirements/` directory; and any file
   one of those pulls in (a `-r`/`-c` include, a `[tool.setuptools.dynamic]` `file =`),
   read from both sides of the diff. Lockfiles are not read by the template and do not
   count. **No carve-out**, for the same reason as 5. **One narrow admission (#476): a
   pin-only change.** When every touched manifest exists on both sides and differs only
   in the version specifier (or `--hash`) of requirements present at the same position
   on both sides — no requirement added, removed, reordered or renamed, no extras or
   marker changed, no option line (`-r`/`-c`/`-e`/index) changed — it passes condition 6
   on the same step proof as 5's admission **plus one test**: no step *after* the last
   one that ran on trunk may be `skipped` on the branch. A `pyproject.toml` is read only
   inside its dependency arrays (`[project] dependencies`,
   `[project.optional-dependencies]`, `[dependency-groups]`, `[build-system] requires`);
   every other byte must match. `setup.py` (code) and `setup.cfg` are never pin-only.

**[Hard — gate: colab ship refuses (cure rule)]** An unmeasurable diff — a failed read, a manifest that does not parse, a manifest
that is a symlink — refuses, the same as any other unmeasured signal. Order of
checks: 1 → 2 → 2b → 3 → diff measurable → 5 → 6 → 4 (with its carve-out).

**The workflow carve-out (#321) — one guarded door through condition 4, not a relaxation
of it.** The repair for a CI-*infrastructure* outage is, by construction, a workflow
change: when trunk goes red because the runner pool cannot reach a service container,
the branch that fixes it necessarily edits `.github/workflows/**` and was therefore
permanently cure-ineligible however green it was — leaving a mechanically-verifiable
repair waiting on a human who may not be watching. So a workflow-touching branch may
still cure when, on top of 1-3 (2b included) and 5, **all** of:

- **[Hard — gate: colab ship refuses (cure rule)]** **4a — job-name superset.** Every job RED on trunk's run at the red sha
  exists on the branch's own green run, completed and concluded `success`.
  *"I made the red job disappear"* — deleted, renamed, filtered away — fails here.
  Since #297 this sub-test is condition 2b and applies to **every** cure; 4b and
  4c stay the carve-out's alone.
- **[Hard — gate: colab ship refuses (cure rule)]** **4b — executed-step superset.** For each of those jobs, every step that actually
  **ran** on trunk (reached a terminal, non-skipped conclusion) is present on the
  branch's job and concluded `success`. Steps *after* the failing one are `skipped` on
  trunk and so constrain nothing — only steps that demonstrably ran do. *"I made it exit
  early"* fails here.
- **[Hard — gate: colab ship refuses (cure rule)]** **4c — duration floor.** Each of those jobs cost at least the wall time its failure
  did on trunk. 4b proves the *steps* ran; it cannot see a step's `run:` body gutted to
  a no-op inside the very workflow file being carved for, and duration is the only
  signal that touches that.

**[Hard — gate: colab ship refuses (cure rule)]** Anything unmeasurable — no job evidence, an empty red-job set, an unreadable
step list, a missing duration — **refuses**, exactly as before. The carve-out
only ever widens the door on evidence, never on the absence of it.

**Dry-run evidence for a main-only workflow (#474).** Some workflows never run on a
branch at all. The template therefore offers a **dry run**: dispatched on the fix branch
(`gh workflow run release-auto.yml --ref <branch> -f dry_run=true`; a dispatch on any
ref other than `main` is dry with or without the input), it checks out the branch and
runs the same job with every external write off. Each decision runs with `--dry`. No
promotion, tag, Release, push or dispatch happens. Only steps whose names end in
`[publish]` are skipped. A sentinel step, *Dry run — nothing is tagged, released or
published*, runs only in that mode, and it is what marks a job instance as a dry run.
Such an instance is the job's 2b (and 4a) evidence only when, on top of 2b:

- **[Hard — gate: colab ship refuses (cure rule)]** **D1** — both step lists are measurable: trunk's ran-steps and the dry run's steps.
- **[Hard — gate: colab ship refuses (cure rule)]** **D2** — every step that **ran** on trunk, the failing one included, concluded
  `success` in the dry run. This is 4b, applied to dry-run instances on every path.
- **[Hard — gate: colab ship refuses (cure rule)]** **D3** — every step the dry run did not run to success is a skipped `[publish]` step.

A green ordinary instance of the same job outranks a dry one, so the D-rules apply only
when a dry run is the sole evidence.

**[Hard — gate: colab ship refuses (cure rule)]** When a cure refuses at 2b only because such a workflow's red job is absent on the
branch, and every later condition already holds, `colab ship` dispatches the dry
run **once**. It skips any workflow that already has a run at the branch head. It
never waits, and it never dispatches from `--dry` or `--dry --json`, which only
report the command. Re-run ship once the run completes (code-ship B1a's bounded
wait). Dispatch is gated on a static read of the **branch's** copy: it must have a
`name:`, a `dry_run` input and the sentinel step. A copy older than #474 has no
forced dry mode and would really publish if dispatched. The **limit**: a red in a
`[publish]` step, or in the `npm`/`deploy` jobs (which never run without a tag),
cannot be cured by a dry run and stays a ci-grant. So does a red job that ran
**zero** steps (a runner that never picked it up) on the carve-out path, because
4c has no usable duration for it. Reasoning:
[`docs/adr/474-cure-rule-dry-run-evidence.md`](docs/adr/474-cure-rule-dry-run-evidence.md).

**Dispatch evidence for a job a branch push skips (#510).** The same gap one level down.
A **dispatch instance** — a job row from a `workflow_dispatch` run that is not a #474
dry run — is the job's 2b (and 4a) evidence only when, on top of 2b's own tests, all of:

- **[Hard — gate: colab ship refuses (cure rule)]** **W1 — same workflow.** The dispatch run's workflow **id** equals the red run's.
  Either id missing refuses.
- **[Hard — gate: colab ship refuses (cure rule)]** **W2 — same head.** The dispatch run is at the branch's evidence head sha. A row
  at any other sha is never evidence.
- **W3 — the event** is `workflow_dispatch`. Ordinary instances are unchanged.
- **W4 — the job passed and nothing beside it failed.** Completed `success`; no
  other instance at the head red or pending. So `skipped`, `neutral`, `cancelled`
  or absent never counts as cured, and a job that ran and **failed** on the push
  run is not rescued by a green dispatch.
- **[Hard — gate: colab ship refuses (cure rule)]** **W5 — the failing step ran.** Every step that went red on trunk is present by exact
  name in the dispatch instance and concluded `success` — a job whose steps were all
  skipped reports `success`, so job-level success alone cannot see a step whose own
  `if:` depends on the event. A trunk red with no red step (a timeout, a lost runner)
  leaves W5 nothing to check, and W4 decides.
- **W6 — per job, by exact name.** Matrix shards match by their expanded names;
  one green shard never covers another; nothing matches by prefix.

W1 and W2 apply to a #474 dry run as well whenever its run reports
`workflow_dispatch`. A green ordinary instance outranks a green dispatch
instance, which outranks a green dry run: each rule set applies only when that
instance is the job's sole evidence.

When a cure refuses at 2b only because red jobs are absent or `skipped` on the
branch in a workflow that (a) declares `workflow_dispatch` in the **branch's**
copy, (b) is not dry-run capable (that keeps the #474 path), (c) has a completed,
successful **non-dispatch** run at the head — it is branch CI, not a main-only
workflow a dispatch could publish from — and (d) has no `workflow_dispatch` run at
the head yet, and every later condition already holds, `colab ship` dispatches it
**once** (`gh workflow run <file> --ref <branch>`, no inputs). It never waits — the
job may take hours, and ship measures up to three times per invocation — and never
dispatches from `--dry` or `--dry --json`, which report `ciCure.dispatchWanted`.
Wait with `colab ci-wait --sha <head> --branch <branch>` sized to the job, then
re-run ship. Reasoning:
[`docs/adr/510-cure-rule-dispatch-evidence-for-branch-skipped-jobs.md`](docs/adr/510-cure-rule-dispatch-evidence-for-branch-skipped-jobs.md).

- **[Hard — gate: colab ship refuses (cure rule)]** **`package.json`'s `scripts` block is condition 5, not part of this carve-out, and
  must not be folded into it.** The carve-out's evidence cannot adjudicate a
  scripts-block weakening in the general case — it happens inside a step whose name and
  conclusion are unchanged and whose duration delta may sit below any signal, so 4b and
  4c would both silently pass a change they are structurally unable to see.

The full reasoning — why the executed-step superset is the primary test and a
bare duration threshold was rejected, what the two accepted false refusals cost,
and why the `timed_out` relaxation is deliberately left unwritten — is in
[`docs/adr/321-workflow-carve-out-measures-execution-not-duration.md`](docs/adr/321-workflow-carve-out-measures-execution-not-duration.md).
- **Where workflows never fire for a branch ref, that round is a PR — for the patch
  only (#353).** Condition 2 then has no other way to be measured, and the PR's merge
  ref includes the red trunk, so only the branch carrying the fix gets a meaningful
  run from it. A bystander does not rebase onto the red and does not open a PR: it
  waits for green (*Branch CI*, above).
- A cured merge carries a `CI-Cure:` trailer instead of `CI-Grant:` — unlike the
  grant's trailer it names no issue (the cure rule never reads the tracker at all,
  so it has none to name), only the branch, the red trunk sha it contained, and the
  evidence run sha.
- **The trailer and the `--dry --json` payload name WHICH door was used.** A cure
  admitted through the carve-out appends ` via workflow-carve-out jobs <a,b>` to its
  trailer and reports `ciCure.via: "workflow-carve-out"` (with per-job durations)
  instead of `"ordinary"`. The `--grep=^CI-Cure:` scan is anchored on the prefix, so the
  suffix never disturbs it. A cure proven by a dry run (#474) appends ` via dry-run jobs
  <a,b>` the same way and reports `ciCure.dryRun: {jobs}`; on a refusal,
  `ciCure.dryRunWanted` names the dry run(s) that would supply the missing evidence,
  each with its workflow, file and exact command. A cure proven by a `workflow_dispatch`
  run (#510) appends ` via dispatch jobs <a,b>` and reports `ciCure.dispatch: {jobs}`;
  on a refusal, `ciCure.dispatchWanted` names the dispatch(es) that would supply the
  evidence, in the same shape. `ciCure.provenJobs` (#297) lists the red jobs 2b proved
  passing on the branch — a consumer rendering cure eligibility reads it (and
  `ok`/`reason`) rather than re-deriving a verdict from check-runs. A cure that changed
  a manifest under #475/#476's admissions appends ` admitted add-only-scripts` and/or
  `pin-only-requirements` to the trailer, and reports `ciCure.admitted: {scripts?,
  pins?}` (null otherwise), for the same reason. A cure that passed condition 3 by
  progress (#477) appends ` after-progress healed <a,b>` and reports `ciCure.progress:
  {healed, still}` (null otherwise); its own `over-red` sha is what the next cure on the
  same red compares against.
- **`colab ci-grant`'s anti-stacking scan now recognises either trailer** —
  `CI-Grant:` or `CI-Cure:` — as "an exemption already merged against this red", so a
  repo that has used both doors is scanned as one continuous stacking history rather
  than two independent ones.
- Scoped identically to the grant: trunk-only, and never exempts anything but
  trunk-CI-green.

Why, with the measurements and the accepted false refusals: [ADR 281](docs/adr/281-cure-rule-rationale.md).

#### Scheduled drivers — provenance and autonomy meet a caller that is not a person

A **scheduled driver** — a per-repo autopilot waking on a cadence, shipping finished
branches, triaging the backlog, starting sessions for ready groups — breaks the
assumption that the caller is a person or an agent a person is watching. Nothing above
stops applying; this is what a scheduler must additionally honour.

**It inherits the provenance gate, re-applied on every tick, not filtered once:**

- `agent-filed` issues are excluded from what a scheduler starts, every run.
- `epic`-labelled issues are excluded — an epic can pass provenance cleanly and still not
  be a pick-up-and-code task.
- `needs-decision` issues are excluded, for a third distinct reason: no human has answered
  the blocking question, even if the work item itself is human-filed, unblocked, and a
  genuine leaf task.
- **The only admission is a human act recording the decision** (`colab decision --record`,
  above) — a scheduler may never infer an answer from content, age, or repeat proposal,
  and never treats the label's mere absence as an answer: it checks for
  `decision-recorded` or the live comment marker, since a cleared `needs-decision` with
  neither present is the stale, not-yet-swept state, not a decided one. The converse
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
(#425): cut on a green CI run on `main`, finalize daily, and **publish in the same run** — a tag
pushed with `GITHUB_TOKEN` triggers no other workflow, so a Release left to a tag-push
workflow is never published. It reads and creates tags and writes no commit. The same
file fits `trunk: main` and `trunk: dev` + `deploy: tag` (#429): on the latter `main` moves only
when trunk is promoted, so the promotion's green CI run is the trigger, and the CLI cuts only when
`main`'s head is a promotion of trunk.

**On a private repo the release workflow runs on the repo's own runners (#453).** It
fires on every green CI run on `main`, so a job of it that fails is a failed run at
`main`'s head, and `colab ship` reads that as trunk not green. So its jobs run on the
self-hosted label the repo's CI already uses; `ubuntu-latest` is right only on a public
repo, where hosted minutes are free. The npm publish job is the one exception, hosted
everywhere because npm trusted publishing requires it, and it only ever runs on a public
repo (below). The label is a literal edit point in the template, not an expression keyed
on visibility: a scheduled run's payload carries no repository, so such a switch would
quietly pick hosted on the daily run. The audit flags a private repo whose release
workflow still runs a hosted job and names the label its other workflows use (advisory;
unreadable visibility reports nothing).

**Who promotes is `promotion:`, and the release workflow honours it (#440).** Where a
`deploy: tag` repo declares `promotion: main-loop`, the workflow's daily run first runs
`colab promote --auto`: when trunk's head CI is green and trunk is ahead of `main`, it
merges trunk into `main` (`--no-ff`) and pushes, then dispatches CI on `main` — a push
made with `GITHUB_TOKEN` triggers no workflow, a `workflow_dispatch` is the documented
exception — and that run's green completion cuts the candidate as it would for a human
promotion. So a candidate needs no human; the final tag, which deploys, still does.
Everywhere else `--auto` is a recorded no-op — `promotion: human` or absent, `deploy:
push-main` (the promotion *is* the deploy), `manual` (it signals a human deploy),
`none`, and `trunk: main` (nothing to promote). `COLAB_HUMAN` changes nothing in either
direction: a workflow is not a human, and the grant is the descriptor's.

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

#### Grouping — issues that must share one branch

**Issues that touch the same files must move on one branch** — the group is a
collision-prevention mechanism, not a tidiness preference.

**Neither existing mechanism has the right shape:** sub-issues are hierarchical (asserts
a false parent); mutual blocked-by would mean the readiness gate never reports either
member ready. A group needs a symmetric, flat relationship. A one-way `blocked_by` chain
is wrong too: it turns one shared branch and one review into one review cycle per member
(*File contention is never an edge*, under *Readiness* above, #371). And when the only
overlap is a file that every unit must edit, fix the file before grouping on it.

```sh
KEY=import-fixes    # the branch slug WITHOUT the numbers: fix/import-fixes-115-114-113
gh label create "group:$KEY" --color 5319E7 \
  --description "Must share one branch — these issues touch the same files"
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
closed** (#82) — one fleet repo accumulated ~12 stale `group:*` labels before this
existed. Deletion removes it from future queries only — never touches closed issues'
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
  behind it or group onto it (the same rule *Writing a conclusion down* below states for
  a file-level group), because a branch carrying a sibling's unlanded commits cannot land
  independently of it, and then neither converges.

`code-start` is not a third enforcement point — it is the reader that honours the offer.

**The limit, stated rather than rounded up: triage sees pass time only.** A second branch
created after a pass ends is invisible to that pass — no skill here polls, and a promise
of mid-flight detection would be one nothing can keep. It is caught on the **next** pass,
which is a real bound rather than a hope: a newly-pushed sibling ref moves `code-triage`
§0's branch digest, so the next ping cannot short-circuit and takes a full pass.

The alternatives weighed and rejected — including a live re-check at ship time, and a
path-keyed check whose false-positive rate was measured at 6-of-6 on this repo's own
history — are recorded in
[`docs/adr/316-group-serialisation-enforced-at-triage-and-ship.md`](docs/adr/316-group-serialisation-enforced-at-triage-and-ship.md).

Why, with the measurements: [ADR 316](docs/adr/316-grouping-measured-incident-rationale.md).

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
   work. (Overlapping files is the opposite finding — the argument for one *branch*,
   never one issue: see *Grouping*, above.)

**No backfill** — this governs what gets filed next, not existing checklist issues;
converting one is optional cleanup, never required by adoption. **Not every checklist
is an epic** — an issue whose boxes are steps of one session's own work (write it,
test it, document it) is a normal issue with a to-do list, and splitting it would be
pure overhead. The test is whether the work **outlives a session**, never whether it
merely *has* boxes.

**The `epic` label marks a container for sub-issues — informative, never a start
candidate, never claimed as a unit of work** — even when it passes readiness and
provenance cleanly. Secondary signals (`epic(` title prefix, `subIssuesSummary.total > 0`)
corroborate but never substitute for the label. `epic` lives in the provisioned
convention label set (unlike `tracking`) because an unattended driver's decision depends
on it. An epic still gets closed and referenced exactly as any other issue once its
children finish — the label only prevents a driver from mistaking the map for the
territory.

**A container closes with its last child (#371).** A child's merge closes the child. So
`colab ship`, after it closes an issue, reads the issue's native parent and closes it in
the same step, with an evidence comment, when all of these hold:

- it carries the `epic` label;
- it has native sub-issues, and every one of them is closed;
- its body lists no unticked checklist item (`- [ ]`). An unticked item on an epic is work
  someone listed and nobody filed yet, and closing over it would bury that work;
- it is not a release tracking record, which `colab release finalize` closes.

Then it asks the same question of that parent's own parent. Any other shape is left open.
A parent whose sub-issues are all closed but which has no `epic` label, or which still
lists an unticked item, is reported as a finding for a human. A hand-written checklist
with no native sub-issues is never closed this way, because a table of boxes running out
does not prove the work ran out (`code-ship` B2c). `code-sweep` §5 closes containers whose
last child closed by some other route, using the same conditions
(`tools/lib/container-close.js`).

**A container never carries a `delivery:*` label (#371).** It has no deliverable of its
own; its children do. `code-triage` reports one as a finding in its epic bucket.

**[Hard — gate: colab decision refuses on an epic]** **For the same reason, an epic never carries `needs-decision`, and never a
`decision:options` block.** A gate on something that never starts gates nothing. A
question about an epic goes on its own decision issue, attached as a sub-issue (*Decision
gate*, above, #361).

Why, with the measurements: [ADR 127](docs/adr/127-epics-switched-epics-and-scope-rationale.md).

#### Switched epics — concurrent unfinished features (#336)

*Epics*, above, decides how work is **filed**. This subsection decides how several
unfinished features **coexist on one trunk** without any of them reaching a consumer
half-built — the policy the release ladder in [§6](#6-releases) relies on. It carries
the #330 ruling; the rules are numbered so a check can cite one.

**Scope: repos that tag — `exposure: released`** (legacy `tier: A` reads the same way,
`tools/lib/axis-authority.js`). On `none` and `self` nothing consumes a half-finished
epic, so a switch there is pure cost and this subsection does not apply; a bare
`tier: B` carries no exposure opinion and is not bound either. `exposure: live` is not
bound: its promotion is a human act that can simply wait for an epic to finish. *This
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
4. **File-level collisions are not a switch's job.** Two epics' children touching one
   file still serialize through *Grouping*, above; a switch hides behaviour, never a
   merge conflict.
5. **What a switch cannot hide stays backward-compatible while the epic is
   unfinished.** Schema changes **add only**; old config files and old API responses
   keep working; every destructive step — dropping a column, retiring a config key,
   removing a response field — happens **in the switch-removal child**, and nowhere
   earlier. A release built with the switch off must be indistinguishable, to anything
   outside the repo, from one built before the epic started.
6. **At most ~3 unfinished switched epics at once, and a switch older than ~4 weeks
   surfaces for a decision.** Both are **findings for a human**, never blockers: the cap
   exists because every open switch doubles what the development configuration hides
   from the release one, and the age exists because a switch nobody removes has become
   a permanent fork in the code under a temporary name. Age is measured from the merge
   of the child that added the switch.
7. **Releases are cut from trunk; versions live in tags only.** A `release/X.Y` branch
   exists **only** when an older version needs a fix of its own, and is deleted with
   that line's support. Never put a version in a branch name: a branch named `0.2.0-dev`
   is itself a SemVer pre-release, and sorts **below** `0.2.0`. A `release/X.Y` branch is
   neither an [`integration:`](project.schema.md#integration--optional) line (that axis
   never reaches a tag, by construction) nor a
   [`releaseBranch:`](project.schema.md#releasebranch--optional) (that one is overwritten
   wholesale on every release) — no descriptor field declares it and no `colab` path cuts
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
  reads**, so `git grep <name>` finds every read site. That is what makes rule 1's
  "removed" checkable: after the removal child, the grep returns nothing.
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
**"Not asked" must never collapse into "non-code"** — every issue is unlabelled the day
this set is adopted, and reading absence as non-code would freeze every scheduled driver on
day one.

`content`/`ops`/`elsewhere` gate exactly like `needs-decision` — route, not a start
candidate for anyone. `design` is not a code start either, but it is not routed away: it is
a design session's start, reported in triage's own design bucket (below). A code session
landing on any of the four distills the finding onto the issue and ends the session.
Whoever files or triages sets the label — no mechanical rule infers it from a title or body.
`delivery:*` is in the provisioned label set because every adopting repo needs all six
values before the first triage pass can classify anything.

**`delivery:docs-only` (#358)** is a code-lane value: the filer expects an in-repo
commit whose diff is documentation only. It starts, is gated and ships exactly like
`delivery:code` — worktree, the repo's gate, `colab ship` — and triage gives it
`deps-checked` like any code issue once its blockers clear. The label is **not** `colab
ship`'s docs-only exception ([§2](#autonomy--the-docs-only-exception-345)): ship
measures that from the diff and never reads this label, so a `docs-only` issue whose
diff turns out to carry code or a binary simply ships under the normal autonomy gate.
Nor is it a home for design work — a design artifact with screenshots is a binary
change, and design work has its own value.

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
lands in a different repository than the one the issue lives in — a consumer that read a
tracker across several repositories provisioned it by hand on three separate trackers,
21 issues total, well before this convention adopted it. It routes for the same reason
`content`/`ops` do: this pipeline's worktree, gate, mergeable and squash machinery all
assume the diff lands in the repo the issue lives in, and an `elsewhere` issue breaks
that assumption identically to a content push.

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
the same label. `low-priority` is in the provisioned label set for the same reason `epic`
and `delivery:*` are: an unattended driver's ordering decision depends on being able to
see it, and a repo that adopted before it existed cannot create it at all.

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
`.plans/issue-<N>.md`, in the **main checkout, outside any worktree** (exists
before the worktree, survives its teardown). Git-excluded, **never committed**. Anything
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

**Resolved via an absolute path, never bare relative (#113)** — a bare path from inside
a worktree silently resolves to the worktree's own copy:

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
back-filled, since a plan written after the code only describes the code.

`code-triage` may flag a hard group `needs-plan` with a one-line reason — a
**cross-backlog judgement**, never a plan of its own (authoring at triage time produced
stale artifacts for groups not started soon). **The full plan is drafted at code-session
start**, inside the implementing session, by a stronger-model subagent seeded with the
Issue plus the reason line, against the repo as it is at coding time. A rung-1 stub may
still upgrade to rung 2 mid-session — the flag decides only the default.

**Read the `needs-plan` flag by direct issue fetch, never the Search API**, which can lag
by minutes. A plan is a sketch the code may overrule, not a contract — note deviation
where the plan lives. `needs-plan` is provisioned on adoption and back-filled on sync,
like every other fixed convention label.

Why: [ADR 94](docs/adr/94-planning-and-conclusion-writing-rationale.md).

#### Writing a conclusion down — the decision and the document are two units

A session can produce nothing but a conclusion — prose, and the natural next move is to
write it into the docs tree, where other sessions are also merging. **It reaches trunk as
two units, in order.**

**Step 1 — the conclusion goes on an Issue immediately, before any file is touched.** No
branch, worktree, or clean tree needed; it collides with nobody and is readable the
instant it is posted — and it is the part that must survive.

**Step 2 — the write is its own coding unit**: own Issue, claim, branch off trunk in a
worktree, wrapped normally. A conclusion worth documenting is the *most* consequential
kind of doc change, not a typo exempt from ceremony.

**The collision unit is the file (the hunk), never the folder** — two sessions each
adding a new file under one tree cannot conflict:

```sh
colab holders <path>          # fetches first; refuses to say "clean" if it could not
```

Empty output (or a nonexistent path) is clean ground; non-empty is a file-level group —
same branch, or sequence after theirs lands. `unknown` still means *look*, never *assume
clear*.

**It fetches before it enumerates, and that is part of the check, not a convenience.**
The enumeration reads *local* refs, so a branch another session pushed and this clone
never fetched is invisible — and "clean ground" off that is a confident verdict built on
missing data, which is the one wrong answer that sends a second session onto a held file.
`--no-fetch` (offline, or a pinned view) therefore still reports holders it *can* see —
refs you have not fetched cannot un-hold a file — but **refuses** the clean verdict with
exit 2 instead of printing it.

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
   `<slug>-<N>-spec.md`, landing via a claimed docs branch. **Superseded artifacts are
   marked, never deleted** — trunk carries the design lineage.
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

**A missing artifact never blocks a small change.** Unit 2 lands on the branch that
builds the surface (`code-wrap` A2), so it is normally absent before that branch exists.
The design gate is `needs-decision`, and only that. A consumer's label description,
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
one is approved — filing is cheaper than a single mockup iteration, and it is what makes
`<slug>-<N>-mockup.html` naming possible at all.

There is one size rule — the new-surface test in *Design conclusions*, above — and
exploration follows it. A small change explores on the issue that builds it. A new surface
explores on its own `delivery:design` issue, filed before the first mockup. When the build
spans several sessions, an `epic` parent holds the design issue and the build issues as
children, each build child carrying its own `blocked_by` edge to the design issue. The
design issue is never itself turned into the epic: an epic is never a start candidate, so
its artifact would have no session to land it.

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

**`COLAB_SHIP` and `COLAB_PROMOTE` are process-identity assertions, not permissions — an
agent never sets either by hand, and a refusal never names one.** They mean "that command
ran its preconditions", which is a claim only the command can truthfully make; typed at a
shell, one asserts it falsely and reaches a direct trunk push having skipped the grade,
the branch-CI check, the claim release and the evidence comment. Unlike `COLAB_HUMAN`,
neither has any sanctioned hand-set case at all — not even solo flow's. Measured: two
independent sessions set `COLAB_SHIP=1` by hand on the same repo on the same day, neither
aware it was crossing a line, one reporting it in a status summary as ordinary
housekeeping — and **neither had read it in a skill.** They read it in `pre-push-guard`'s
own refusal, which named the variable that opens it. A guard that teaches its bypass at
the moment it refuses is not a guard, so every refusal on this path now names the remedy
(`colab ship`, `colab promote`) and nothing else.

**Closing that door required closing the corner behind it, or it would have become a
stall.** Both sessions reached for the variable while holding a completed local merge
`colab ship` could not publish — `ship` merges a *branch*, so it has no path for a commit
already sitting on trunk. Two changes remove the corner rather than seal the exit: ship's
preconditions now measure the local target against `origin/<target>` and refuse *before*
merging (behind → one fast-forward, self-clearing; ahead or diverged → unpublished commits
on a push-guarded branch, to be moved onto a session branch and shipped, human-gated), and
a failed B2 push rolls the squash back so the unpublishable state does not exist to be
cornered in. The upstream rail is [`code-wrap`](skills/code-wrap/SKILL.md)'s: **a distilled
doc lands on the session branch, never as a commit on the trunk checkout** — that commit is
what both sessions were trying to publish.

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
commit, tagged final — on every route but `deploy-tag-fast`, which cuts no candidate.

| Route | For | Candidate `vX.Y.Z-rc.N` | Final `vX.Y.Z` |
|---|---|---|---|
| `none` | `exposure: none` / `self` — nothing consumes a tag | no tags | no tags |
| `rapid-app` | a fast-moving app with few installers | automatic, on every green trunk head | automatic: the **newest** candidate clean for the test period; a newer candidate does not restart an older one's clock |
| `public-tool` | a public CLI or handbook — adopters install it, nothing deploys | automatic, on every green trunk head (#443) | automatic after a clean test period |
| `library-fast` | a library released per merge, its consumers pin | none | the tag itself triggers the publish; the route's checks still apply |
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

**The newest candidate always names trunk's head (#443).** Wherever candidates are automatic,
once trunk CI is green on `main`'s head, the newest candidate is that head: every green trunk
run whose head carries no candidate cuts one, and no route caps how many a day. A burst of
merges therefore gets a candidate on each green head — what an adopter installs from `next` is
never behind what trunk proved. Measured the day a one-a-day cap shipped (#439): four merges
landed 40 minutes after a candidate, the cap kept them out of any tag until the next day, and a
catch-up candidate had to be cut by hand. A repo may still declare
`release.candidates-per-day` as a **narrowing**, and it keeps the guarantee: inside the window
the run is a no-op, and the first run after the window closes — the next green CI, or the daily
scheduled run, which cuts too — cuts **the head**, never an older commit. A head that already
carries a candidate is a no-op, so the schedule re-runs safely. **Finals are unchanged:** a
final is still the newest candidate whose own test period is clean, so a final lags head by at
least the test period, by design. `colab release-status` reads the guarantee back and flags
*head not a candidate* when a green head has stayed untagged for longer than one CI cycle (the
longest suite run at that sha). And every candidate has a release page however it was cut:
`colab release cut` publishes the GitHub pre-release itself, notes = the summary since the last
final plus the tag's own message, so a cut run outside the workflow no longer leaves a bare tag.

**[Hard — gate: colab release cut refuses]** **A candidate is cut only when all four hold, on the exact commit it names:**

1. **[Hard — gate: colab release cut refuses]** **CI green on that commit** — every run at that sha finished and one succeeded; a
   green trunk head later on does not count for it.
2. **[Hard — gate: colab release cut refuses]** **The full suite passed on it** — the rule at the end of this section, unchanged.
3. **[Hard — gate: colab release cut refuses]** **Every schema change since the last final tag is additive**
   ([*Switched epics*](#switched-epics--concurrent-unfinished-features-336), rule 5). A
   release carrying a destructive one is not a candidate an agent cuts; a human decides it.
4. **[Hard — gate: colab release cut refuses]** **Switch dependencies are satisfied**
   ([*Switched epics*](#switched-epics--concurrent-unfinished-features-336), rule 3).

**[Hard — gate: colab release finalize refuses]** **The test period is 3 days, and it is clean only if trunk CI stayed green throughout
and no regression against the candidate is open.** "Trunk" here is both `main`, where
candidates are cut, and the `trunk:` branch where that is a different one (`trunk: dev`,
#437): there `main` receives CI only at promotions, so a `main`-only reading would hold
little beyond the promotion's own run, while `trunk:` is where the code actually moved
during the period. It matters only on a route whose final
is automatic (`rapid-app`, `public-tool`); `library-fast` and `deploy-tag-fast` have none,
because they cut no candidate. A route may lengthen it, never shorten it. A human vetoes by holding the candidate during it; a held candidate is not finalized.
**Finalizing re-checks every condition above at the moment it runs** — a candidate that
was clean when cut and is not now stays a candidate. Where the final tag is a human act,
the agent's work ends with the candidate, its release notes, and the one click — number
pre-filled — that finalizes it.

**[Hard — gate: colab release refuses]** **A trigger runs it — not a person, and not a session.** Each repo that tags carries a
**release workflow** ([*Scheduled drivers*](#scheduled-drivers--provenance-and-autonomy-meet-a-caller-that-is-not-a-person)):
a green CI run on `main` — and the daily scheduled run (#443) — tries a candidate (`colab release cut --auto`) — on `trunk: main` every
trunk push, on `trunk: dev` the human promotion's push (#429), where the bump reads the promoted
commits and a `main` head that is not a promotion (a hotfix pushed straight to `main`) cuts
nothing: the next promotion carries it, or a human cuts it by hand — a daily run
tries to finalize clean candidates (`colab release finalize --auto`), and publishing happens
inside the same run. It may do this unattended because both commands **refuse on any
failed condition** — the route is the permission, the commands measure it, and a refusal
is the workflow's whole output. Never `colab ship` or `code-ship`, and `colab promote` only as
`--auto` where `promotion: main-loop` grants it (*Scheduled drivers*) — none of them tags. A candidate is cut by
[`colab release cut`](tools/README.md#release-cut-candidates) (#338), which measures the four
conditions on the commit and refuses naming each one that fails; its next step is
[`colab release finalize`](tools/README.md#release-finalize) (#339). The
[`release-rung`](skills/release-rung/SKILL.md) skill is the same sequence run by hand — the
fallback when the workflow cannot run. Either way keeps **one tracking issue per version**
(`release: vX.Y.Z`, marker `<!-- colab:release version=vX.Y.Z -->`): a human holds a candidate by
putting the **`release-hold`** label on it (only a human removes it), and a regression against the
candidate is a `blocked_by` edge on it — open, the final waits; fixed after the test period began,
a new `-rc.N+1` is owed and its period starts afresh. The final is tagged automatically only on a
route whose final is automatic, re-checking every condition at that moment; on `deploy-tag` it
stops at *candidate ready* and hands a human the one click. **Merged is not delivered** for a
repo others install, so once a final is tagged every issue the version carries — each `Closes`/
`Fixes`/`Resolves #N` in a commit since the previous final — gets one comment, `Released in
vX.Y.Z`, telling its reporter which version has the fix (#426). No agent cuts a final tag, or a
candidate, by hand around these commands. A deploy must never fire on a
candidate: [`templates/release-tag.yml`](templates/release-tag.yml) publishes `-rc` tags
as pre-releases, the audit flags a deploy trigger that matches one, and every
current-release read skips them.

**An operator-granted automatic final (#441).** The default above stands: a final that deploys
production is a human act. The operator may choose otherwise for **one repo at a time** — *"in
some cases I want the release to deploy too; only some cases, but possible when I choose"*. The
grant is a human act, recorded the way an `autonomy` grant is, and checked on every read:

- **[Hard — gate: colab release finalize refuses]** **Recorded, never written by an agent.** The operator rules on a decision issue
  (`colab decision <N> --record --ruled-by <human>`) and the repo names it with
  [`release.final: auto` + `release.final-grant: <N>`](project.schema.md#release--optional).
  `final: auto` on `deploy-tag` without that line is the widening failure it always was. The
  audit reads the decision issue and **fails** a grant that is unreadable, never recorded, not
  recorded by a trusted human, or **reopened**.
- **`deploy: tag` only.** On `deploy: manual` a person runs the deploy anyway, so its final
  stays human; a grant there, or on any route but `deploy-tag`, is an audit failure.
- **Per repo, revocable at once.** Deleting the line, `final: human`, or `colab decision <N>
  --reopen` revokes it; the next `colab release finalize` reads the new state.
- **[Hard — gate: colab release finalize refuses]** **More conditions, never fewer.** On top of everything a candidate's final already needs —
  the clean test period, trunk green throughout, no `release-hold` on any open tracking issue,
  no open regression — an automatically deployed final carries **no database migration since
  the last final** unless the release itself is granted one: migration stays a human gate
  (`COLAB_HUMAN=1 colab migration-grant <tracking issue> --branch vX.Y.Z`, on the version's
  tracking issue). An unresolved grant or an ungranted migration does not refuse the release —
  it takes the automatic final away, so `finalize --auto` stops at *candidate ready* and hands
  the operator the one command, exactly as on an ungranted repo.
- **Every automatic deploy says whose choice made it so.** The final tag's message names the
  grant and its decision issue, and who ruled it.

**A final on every green head — `deploy-tag-fast` (#446).** Some repos have nobody to test a
candidate: an app whose only user is its operator, where a 3-day period only measures "nothing
new merged for 3 days". For such a repo the operator may choose route `deploy-tag-fast`: on
every green trunk head `colab release cut --auto` tags the **final** `vX.Y.Z` directly — no
`-rc`, no test period — and the release workflow deploys it in the same run. The version tags
stay; only the candidate step goes. It replaces the test period with two declarations and keeps
every gate that does not depend on one:

- **[Hard — gate: colab release cut refuses]** **The operator's grant, read exactly as #441's.** `release.final-grant: <N>` names a recorded
  decision, re-read on every run by the audit and by `cut`; unreadable, untrusted or reopened →
  no tag, and the audit fails. Deleting the line, or `route: deploy-tag`, revokes it.
- **A health-gated deploy that rolls itself back.** `release.health-url` (an `https://` endpoint
  reporting the running version) and `release.rollback: auto`. The release workflow polls the
  URL after its deploy and fails the run when the version does not appear; the rollback is the
  deploy's own, and `rollback: auto` is the operator's statement that it exists. The audit checks
  that both are declared and that the release workflow deploys what it tags; it cannot prove the
  rollback works, which is exactly why the grant is required beside it. `release.health-url` is
  the one verify key every deploy shares (#452): required here, and also legal on `deploy-tag`,
  where the container deploy below waits for it.
- **`deploy: tag` only.** Not `deploy: manual` (a person deploys anyway), not a no-production
  repo — `library-fast` keeps its meaning: nothing it tags reaches production. Missing the grant
  or the health gate, the route is an audit failure and `deploy-tag` stays in effect, final human.
- **[Hard — gate: colab release cut refuses]** **The gates that stay:** trunk CI green on the head and every other candidate condition above
  (full suite, additive schema, switch dependencies, the pre-tag checks); no open issue carrying
  `release-hold` (repo-wide — there is no candidate issue to put it on); and **no database
  migration since the last final** unless the version's tracking issue carries a migration grant
  — otherwise the run refuses, opens `release: vX.Y.Z` if needed, and posts the one human command
  (`COLAB_HUMAN=1 colab migration-grant <N> --branch vX.Y.Z`); the next green run after it tags.
- **A minimum spacing between finals.** `release.final-spacing` (default and floor `1h`; longer
  narrows) — a burst of merges deploys at most once per window. Inside it a run is a no-op, and
  the first run after it tags the head, never an older commit.
- **[Hard — gate: colab release cut refuses]** **Deployed in the same run, never by a tag-push workflow.** A tag pushed with `GITHUB_TOKEN`
  starts no `push: tags` run, so a separate deploy-on-tag workflow would never fire for this
  final. [`templates/release-auto.yml`](templates/release-auto.yml)'s `deploy` job deploys it
  (an edit point the adopter fills) and checks the health URL; a cut by hand refuses on this
  route, because it would have no deploy behind it. `colab release finalize` here always reports
  *no candidate*: one left over from an earlier route is superseded by the next final.

**A container deploy — one contract, two entry points (#452).** A container app on a host whose
platform has an API deploys through [`templates/deploy-container.yml`](templates/deploy-container.yml)
and its two scripts, on every host the same way:

1. CI builds every image the repo lists **once** per final tag (`vX.Y.Z` and the commit sha) and
   pushes it — in its own job, never gated on whether the platform is switched on, so a repo not
   yet cut over still has every final's image in the registry (#460).
2. A per-repo pre-deploy step (a database snapshot, say) runs next; its failure stops the deploy
   before anything changes.
3. A **platform adapter** tells the platform "run exactly `vX.Y.Z`", every image in one call.
4. The deploy is green only on a **verified running version**: the platform's own state (the
   stack settled, the commit it deployed, the image its containers run), then
   `release.health-url` reporting `X.Y.Z`. An HTTP 200 from the platform is never the evidence —
   a platform can accept a deploy it then refuses to run.
5. A failure after the platform accepted the call rolls back to what ran before (the previous
   final), checks that, and still fails the run. A manual rollback is the same workflow run with
   the previous tag. The outcome — `running vX.Y.Z at <time>`, or the failure — is recorded in the
   run summary and on the release issue when one exists.

It is the existing `deploy: tag` shape with an in-repo deploy workflow (`channels: [workflow]`),
so no rule changes; the template is what was missing. **There is one deploy path, reached two
ways:** on `deploy-tag` a human-pushed final starts it (`push: tags`, finals only); on
`deploy-tag-fast` the release workflow's `deploy` job calls the same file through
`workflow_call` (the commented job in `templates/release-auto.yml`), because the final it tags
starts no `push: tags` run. Portainer is the first adapter; another platform is another adapter
file exporting the same functions, and a consuming workflow changes one variable. **One platform
key per app**, for a non-admin user owning only that app's stack — never an admin key. Every
server runs its own platform instance, so the configuration is that host's URL, environment and
stack, by DNS name. Every redeploy recreates the containers, even with an unchanged compose file.

**[Hard — gate: pre-tag check refuses]** **A manifest's version may be derivable (#438), and on an automatic route it is by default
(#484).** Under [`release.version-source: manifest`](project.schema.md#release--optional) the
pre-tag check refuses a tag that disagrees with any declared manifest (`VERSION`, `package.json`,
`Cargo.toml`, `pyproject.toml`) at the tagged commit, so a human bumps the manifest on trunk
first. Under `tag` the check skips a differing manifest, names it, and the tag message records it
as derivable. The repo's own release or deploy step stamps the number from the tag — on a
deploy-only ref, or at build time — **never as a commit on trunk**: the release workflow never
pushes one, and a stamp on trunk would put a version in the tree before the release it names
exists.

The default follows who cuts the tag. Where the machine does — automatic candidates, or a final
`release cut --auto` tags itself — it is `tag`, because nobody is there to bump a manifest
before each cut: under `manifest` the first candidate after a final refuses, and so does every
one after it, a stall that reads only as a warning in a green run. Where a person cuts the tag it
stays `manifest`. A declared value wins either way; the cut and the final read the same one, so
a candidate cut under `tag` is never refused as a final under `manifest`.

**Under `tag`, any version a user sees reads the tag, never the trunk manifest.** A `--version`,
an about page, a health endpoint reporting the running version: each reads the tag or a stamp
made from it at release or build time. The handbook's own release steps already stamp — the npm
publish sets the package version from the tag before publishing, and the container deploy
receives it from the tag. An artifact that reads its trunk manifest unstamped shows the last
number someone typed, so stamp it, or declare `version-source: manifest` and bump on trunk before
every cut.

**On `public-tool`, the same run may publish to npm (#433).** A repo opts in with
[`release.npm` + `release.npm-gate`](project.schema.md#release--optional) — the package directory
and the command that proves its tarball holds only what was meant to ship — and
[`templates/release-auto.yml`](templates/release-auto.yml)'s `npm` job then publishes every tag the
run created: a candidate `vX.Y.Z-rc.N` to dist-tag `next`, a final `vX.Y.Z` to `latest`, both with
provenance; `latest` never moves to a candidate. Finals publish automatically like the tag they
follow — the route's one human gate (a final that deploys production) never applies here, since
npm is offered on `public-tool` alone and is an audit failure on any other route. Four rules
hold the shape:

- **Trusted publishing (OIDC) only.** No npm token is stored, read, or offered as a fallback; the
  job refuses to run with one in its environment. npm trusted publishing does not support
  self-hosted runners, so this job runs **GitHub-hosted** even where the rest of the workflow is
  self-hosted. (npm ends direct publishing with 2FA-bypass tokens in January 2027; nothing here
  depends on one.)
- **Same run, never a tag-triggered workflow** — the reason the GitHub Release is published in
  the same run: a tag pushed with `GITHUB_TOKEN` triggers nothing.
- **A private repository never publishes to public npm** (#432). Visibility is not in
  `project.yml`, so the job reads it from the API and refuses a private or unreadable one.
- **It never moves git.** The version comes from the tag (the manifest carries none) and is
  stamped into the checkout, then the gate runs, then `npm publish`. If publishing fails, the tag
  stands, the Release says *tagged, not published*, and re-running the failed job publishes the
  existing tag; a version already on npm is skipped.

**Release channels — consumers follow `stable` or `next`, not a hand-bumped pin (#445).** Two
branches name the newest release of each kind, the git counterpart of npm's `latest` / `next`:

- **`next`** — always the newest **candidate** (`vX.Y.Z-rc.N`). `colab release cut`, automatic or
  by hand, fast-forwards it to the candidate's commit in the run that pushes the tag.
- **`stable`** — always the newest **final** (`vX.Y.Z`). `colab release finalize`, automatic or
  the human's final command, fast-forwards it to the final's commit; a later run that finds the
  version already final repairs a `stable` a dead run left behind.

**[Hard — gate: pre-push-guard hook]** **They are branches, not tags.** A moving tag is refused by every clone that already fetched it
(`would clobber existing tag`), and a non-semver tag is read as "the newest version" by tag
readers (`git describe --tags`, stamps). A branch moves cleanly and no tag reader sees it, so
version tags stay immutable. **Nothing else writes them:** both move **forward only**, never
forced — a channel that is not an ancestor of the new commit is reported and left alone, never
overwritten — and [`pre-push-guard`](templates/pre-push-guard) refuses a hand push to either
(the release commands push with their own process-identity variable, the `colab ship`
precedent). `stable` sitting on an older commit than `next` is the design, not drift. A channel
move is best-effort like the GitHub pre-release: the tag is already on the remote, so a channel
that cannot move is a warning, never a reason to undo the tag.

**What a consumer pins.** [`templates/release-auto.yml`](templates/release-auto.yml)'s
`HANDBOOK_REF` defaults to `stable`; a repo may pin `next` (the fast channel) or an exact version
tag (frozen — the one way to stop moving). When `stable` moves, that final's release notes say
what changed. A pinned ref the handbook does not carry — `stable` before its first final, or any
channel on a fork or mirror that lacks it — is not a failure: the fetch step falls back to the
newest final tag no older than the first final carrying every verb the template calls, else
`next`, and says so in a warning (#480). Falling back to an older final would only move the red
run one step later, to the first `--auto` call it rejects (#427). A tool installed **with npx** follows a channel the same way, with one difference:
the channel is resolved to the release tag on it before anything is installed, never installed as
a ref — a per-machine service through its `update` verb, a one-shot command through the launcher
([*Services over npx*](#services-over-npx--init-update-rollback-465), below).

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

The computation reads more than commit subjects precisely because the breaking change that
bites is the one the types don't reveal — a destructive schema change or a renamed export
merged as `feat:` or `fix:` with no `!`. **Put the reasoning in the release notes**: the
bump computed, which input decided it, and each breaking change found — or that none was,
and what was checked.

**An unfinished feature never waits for a release, and never reaches one switched on.** On
a repo that tags, a feature landing over several merges is an epic behind a switch: it
ships **dark** in every release until its last child removes the switch, releases are cut
from trunk with every remaining switch off, and a version lives in a tag, never in a
branch name. The rules, the scope, and the marker a check reads:
[*Switched epics*](#switched-epics--concurrent-unfinished-features-336).

**Every tag gets a release summary** — a published GitHub Release grouping commits since
the previous tag by Conventional-Commit type; `CHANGELOG.md` is not maintained by hand.
[`templates/release-tag.yml`](templates/release-tag.yml) automates it. When the
workflow cannot run (Actions outage, billing lock — it has happened), the summary
**is still owed**. Manual fallback, same output:

```sh
colab release-notes v1.1.0..v1.2.0 | gh release create v1.2.0 --notes-file - --generate-notes
```

**Merged is not released — measure the gap, don't wait to notice it by eye.**
`colab release-status [--repo P] [--json]` (#81) reports commits on `dev` not yet
promoted, commits on `main` past the last `v*` tag (plus days since), and flags whichever
gap holds a `fix:`-typed or breaking commit — exactly the class that has bitten before,
in payroll. Its suggested SemVer bump is an input, not a verdict: the coordinator
confirms or overrides it and states the reason in the release notes — it reads commit
types, so it cannot see a breaking change the types don't reveal — the computed number
(*Versioning*, above) also reads guard results and exports, and is the one a candidate
carries (pre-1.0 a major becomes a minor). Measured against `main`, never
`dev` — `git describe` from a `dev` checkout answers a stale question.

Do not tag from `dev`. Do not tag a commit that has not passed the full suite on `main`. On a
`trunk: dev` repo the candidate is cut on the promotion merge, and its manifest version is read
there — a version bump reaches `main` through the promotion, never after it.

### Distribution — one install surface: npx (#442)

The release route decides *when* a version exists (the rung above); this decides *how anyone
installs it*. **Every distributed tool installs with `npx`**, so installing looks the same
everywhere and no user needs the `gh` CLI or a token. **GitHub Releases are not an install
path** — a Release carries the summary, never the bits a user runs (owner ruling, 2026-10-02).

| Repository | Install command | Where compiled binaries come from |
|---|---|---|
| public, JS | `npx @<org>/<pkg>` | (none) |
| public, compiled | `npx @<org>/<pkg>` | per-platform npm packages (`optionalDependencies`, each with `os`/`cpu`) — no `postinstall` download |
| private, JS | `npx github:<org>/<repo>#vX.Y.Z` | (none — built by `prepare` if it needs building) |
| private, compiled | `npx github:<org>/<repo>#vX.Y.Z` | **dist refs** in the same repo (below) |

A private repo never reaches public npm — `@<org>` there is always public (#432, above) — so
both private rows install from git, where repository read access is the access control.

**Dist refs — how a private compiled tool ships its binaries.** The release run builds every
platform and pushes one **orphan** commit per platform to `refs/tags/dist/vX.Y.Z/<os>-<arch>`,
holding just that platform's binary and a `SHA256SUMS` over it. `<os>-<arch>` is Node's
`process.platform`-`process.arch` (`darwin-arm64`, `linux-x64`, `win32-x64`), the names npm's
`os`/`cpu` use. The commits have no parent, so they never touch trunk history. The repo's root
`package.json` (`"private": true`) carries a small launcher as its `bin`. At `#vX.Y.Z`, the
launcher fetches exactly one ref, `git fetch --depth 1 --no-tags <origin> refs/tags/dist/vX.Y.Z/<os>-<arch>`,
**with the same git and the same URL npx just cloned from** — so with the same credentials —
verifies the checksum, copies the binary to a stable per-user path, and execs it. Repository read
access is the only lock, exactly as for the source. Both halves are templates:
[`templates/dist-refs.yml`](templates/dist-refs.yml) (a `workflow_call` workflow the repo's own
release workflow calls; it refuses a public or unreadable repository, a version that is not a
tag, and a platform without its binary, and never moves a dist ref that exists) and
[`templates/npx-launcher.mjs`](templates/npx-launcher.mjs) (Node ≥ 18, zero dependencies).

- **The launcher installs the release npx was asked for.** It reads the `#vX.Y.Z` committish from
  the installing project's own record of the package, not from the manifest — a candidate
  `#vX.Y.Z-rc.N` and its final carry the same manifest version, and only the committish tells
  them apart. Where no record exists (a global install), the manifest version is the fallback; an
  environment variable overrides both; with none of them it refuses rather than guessing.
- **The checksum proves the bytes, not the publisher.** `SHA256SUMS` lives in the same ref as the
  binary, so it catches a truncated or corrupted fetch. The trust anchor is write access to the
  repository, as it is for the source npx just ran.
- **A dist ref is a tag, and a full clone pays for it.** A plain `git clone` fetches every tag,
  including every platform of every release; later plain fetches do not (a tag is followed only
  into fetched history, and an orphan is never in it). Contributors who mind clone with
  `--no-tags`. npm's own tag-to-version parsing ignores dist refs (`v0.4.0-rc.1/darwin-x64` is not
  a valid version), so a `#semver:` install range is unaffected.

**Rules that apply to every row:**

- **Publish or push in the same run as the release cut.** A tag made with `GITHUB_TOKEN` triggers
  no other workflow, so a "build on tag push" workflow never runs for a tag the release workflow
  made — the same reason the Release itself is published in that run.
- **Trusted publishing (OIDC) for npm, never a token** — the npm job's first rule, above.
- **A long-running tool never runs from npx's cache.** npm may prune that cache under a live
  process. A tool that runs as a service installs, updates and rolls back through the contract in
  [*Services over npx*](#services-over-npx--init-update-rollback-465), below.

The audit reports a **private** repository whose workflows upload GitHub Release assets
(`gh release upload`, `gh release create <tag> <files>`, a release action given `files:`) as
**advisory** (`warn`): an asset can be a legitimate by-product — an SBOM, a checksum list — so it is
never a failure, but an asset that is the install path asks every user for `gh`.

A repository that **declares** it distributes a tool — `distribution: js` or `distribution:
compiled` in `project.yml` ([schema](project.schema.md#distribution--optional)) — is checked for
its row's install route: a publish step plus a non-private `bin` (public JS; per-platform
`optionalDependencies` too when compiled), a root `bin` (private JS), or a root `bin` plus a
workflow calling a dist-refs workflow (private compiled). A missing route is **advisory** (`warn`):
a publish in a reusable workflow outside the repository is invisible to the check. An undeclared
repository is never checked — nothing in a repository tells a tool from a library, so the audit
does not guess (#469).

### Services over npx — init, update, rollback (#465)

A tool that runs as a **per-machine service** — a dashboard, a daemon, a JS app a launch agent
serves — installs with npx like every other tool, but never *runs* from npx. It owns three verbs
(plus `status` and `uninstall`),
and adopters implement them with [`templates/npx-service.mjs`](templates/npx-service.mjs), which
uses its sibling [`templates/npx-launcher.mjs`](templates/npx-launcher.mjs) as a library:

```sh
npx github:<org>/<repo>#vX.Y.Z init [--channel next|stable]   # first install, or repair
<tool> update [--check] [--version vX.Y.Z] [--channel next|stable]
<tool> rollback
<tool> uninstall [--purge]
```

- **`init`** installs the version npx was asked for under a stable per-user path, writes a small
  shim on the user's `PATH`, (re)writes the service unit, loads it and checks its health. It is
  also the repair command: re-running it rewrites the shim and the unit.
- **`update`** resolves its target, installs it **beside** the running version, switches to it,
  restarts the service and checks its health. **A failed health check switches back** — the
  previous version restarted, exit 1 — so an update either lands healthy or changes nothing that
  serves. A failed fetch or build happens before the switch, so it changes nothing at all.
  `--check` reports what an update would do and writes nothing.
- **`rollback`** switches to the previous version through the same health-checked switch; run it
  twice and it toggles.
- **`uninstall`** (#472) unloads the service (and its update timer), deletes the unit files, the
  shim and the whole data directory — every installed version. The config and state directories
  stay, so a later `init` finds the same config; `--purge` deletes them too. It removes only a shim
  the template wrote.

**Versions sit side by side; links decide which one runs.** Each version is installed into its
own directory under the user's data directory (`$XDG_DATA_HOME/<tool>/vX.Y.Z/`, also on macOS —
a path without spaces belongs in a unit file), and two links name the running and the previous
version. The service unit and the shim point **through** the `current` link, so an update or a
rollback is one atomic rename and the unit is never rewritten for it. A few versions are kept;
the running and previous ones are never pruned. A service unit pointing into npx's cache, or into
a checkout, is the failure this rule exists to prevent.

**Following a channel.** A channel ([*Release channels*](#6-releases), #445) is a branch, and dist
refs and install directories are keyed by version — so a channel is **resolved to a version, never
installed as one**. `update` asks the origin, with the same git and the same URL npx used (so the
same credentials), for the channel branch's tip and the release tags on that commit: `stable`
takes the highest **final** there, `next` the highest release tag there (a final outranks its own
candidates on the same commit). That exact `vX.Y.Z` is then installed. **A tip with no release
tag refuses** — it is never guessed. `init` records the channel to follow (default `stable`);
`update --channel` changes it; `update --version vX.Y.Z` **pins**, and later `update`s report
"pinned" until a channel is chosen again — the same three choices a workflow's `HANDBOOK_REF`
offers. Following automatically is a timer that runs the same `update`, never a second mechanism:
`init --auto-update 6h` (#471) writes one beside the service — a second launchd agent with
`StartInterval`, or a systemd user `oneshot` service plus `.timer` — whose command is literally
`<tool> update` through `current`, logging to the state directory; `init --no-auto-update` removes
it. A pinned install's timer runs and changes nothing, exactly as `update` does.

**A one-shot command at a channel.** `npx github:<org>/<repo>#stable <args>` works too: the
launcher resolves the channel on the commit npx installed (the sha in the installing project's
lockfile) to its release tag and fetches that version's dist ref, so the binary always matches the
source npx ran. npx re-resolves a branch committish on every run (measured on npm 11: the cached
install is reused, and its lockfile's commit moves with the branch), so a one-shot command at a
channel costs one round trip to the origin per run — pin `#vX.Y.Z` where that matters. Any other
branch (`#main`) is still refused: it names no release.

**Per-machine config, state and secrets live outside the install.** Everything under the install
directory is disposable — replaced on update, pruned, reinstallable from the origin — so nothing a
machine owns may live there, nor in the package, nor in the unit file:

- config and secrets: `$XDG_CONFIG_HOME/<tool>/` (mode `0700`, secret files `0600`) or the OS
  keychain;
- state and logs: `$XDG_STATE_HOME/<tool>/`.

The unit passes the service the **locations** (`<TOOL>_CONFIG_DIR`, `<TOOL>_STATE_DIR`), never a
value; `init` creates the directories and never overwrites a file in them. Deleting the whole data
directory must lose nothing a reinstall cannot bring back.

**A JS app that needs a build** builds in `prepare`, as the *Distribution* table already says —
for a service that is safe, because the build runs while the new version is being installed beside
the running one, before any switch. Two conditions: the built output must be listed in `files`
(npm packs a git dependency through `files`), and every machine needs the build toolchain. A build
that cannot run on the target (secrets, a heavy toolchain) ships its output prebuilt instead, as a
platform-neutral dist ref (#470): one tarball in `refs/tags/dist/vX.Y.Z/any`, pushed by
`dist-refs.yml` with `platforms: any`. The service template's `KIND 'dist'` fetches it with the
same git, verifies it against that ref's `SHA256SUMS` exactly as the launcher verifies a binary,
refuses an archive with an absolute or `..` entry, and unpacks it into the version's directory
before any switch.

**Why side-by-side versions, and not a serving clone that follows a branch.** A clone that pulls
and rebuilds in place makes a branch the thing that runs: rollback becomes a checkout plus a
rebuild, the running tree is half-updated while it builds, and what runs is not a version any dist
ref or release note names. Side-by-side versions keep the running version untouched until the
switch, make rollback a rename, and run only what a release tag names.

**Service managers.** The template writes a launchd agent on macOS and a systemd user unit on
Linux, and refuses Windows. A Linux service that must outlive the login session needs lingering
enabled for the user; `init` prints the command and never runs it.

---

## 7. CI and toolchain

**Your CI lives in your repo and belongs to you.** [`templates/`](templates/) ships
copyable starting points — nothing is called remotely, nothing is mandatory. That includes the
deploy templates (`deploy-xserver.yml`, and `deploy-container.yml` with its driver and platform
adapter, #452 — [§6](#6-releases)): the handbook checks its own copies with `actionlint` and the
container deploy's logic with hermetic tests against a fake platform, and a copy is the
adopter's to keep green from then on.

The required **outcome**: every pull request must run, at minimum, a **secret scan** and
a **build** — a committed credential is the one failure that cannot be undone by
reverting.

**CI must trigger on pushes to the trunk itself**, not only on branches the trunk no
longer is. Measured: three repos whose trunks had moved to `dev` while CI still fired
only on `[main, master]` — every trunk merge ran zero checks, silently. When a repo's
trunk moves, updating the CI triggers is part of the move, and the audit checks it.

### CI — what it is follows the unit's shape, how much follows exposure

**What CI *is* comes from whether the unit has a branch — a fact about the session, not a
declared value** (⚖ #233 retired the `writes`-keyed reading this heading used to carry:
`writes` is a veto now, not a method, so it no longer selects which CI role applies).
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
this fact, not a field. A declared value never carried this fact reliably — nothing
audited whether a `serial-gated` repo actually ran one — and the gate itself is something
the audit CAN see where it could never see a declaration.

**How thorough it must be comes from [exposure](#exposure--what-consumes-a-merge-here).**
`none` and `self` answer only to the room; `live` and `released` answer to a consumer with
no way to ask a clarifying question, so more has to be caught before it reaches them.

**On low-exposure repos the gate is often not CI at all.** A deploy script that refuses a
dirty tree is a stronger gate than any CI run, because it is the last thing before the
artifact exists. The rule is therefore not "trunk-direct needs green CI" — it is
**trunk-direct needs a gate somewhere other than CI's alarm**, at the deploy step if
nowhere else. Where nothing gates the deploy either, trunk-direct is unsafe, and that is
the finding to report — not a CI run trusted to be the filter it structurally cannot be.

**Provision CI for planned exposure, not current.** A repo declaring `exposure: none`
with a named `production:` — the transitional pairing
[Exposure](#exposure--what-consumes-a-merge-here) already flags — should already run at
`live` thoroughness, free to be red, rather than discover the gap on cutover day: the one
day it is most expensive to.

**Test contracts follow the named consumer**, once
[channels](#channels--by-what-path-does-code-reach-the-thing-that-runs-it) names one: for
`artifact`, the test that matters is whether a fresh adopter's copy works, not a unit test
of the generator; for `live`/`released`, the promotion or release path is the product; for
`self`, whatever would break the room's own ability to work. A generator's internal tests
passing proves nothing about what ships, if nothing names who actually consumes it.

**A repo holding an unfinished switched epic runs its suite twice** — once in the release
configuration, once in development — because those are the only two it supports and the
release one is what ships
([*Switched epics*](#switched-epics--concurrent-unfinished-features-336), rule 2).

**No `ci:` field.** A repo needing something its copied templates don't cover edits that
workflow directly — copy-and-own already permits it, and the audit already classifies the
edit as drift to reconcile, the same treatment every other stamped file gets. See
[`project.schema.md`](project.schema.md#ci--deliberately-not-a-field).

### Self-hosted runners — capacity is the agent count, not the machine (#355)

The templates assume GitHub-hosted capacity: every job gets a fresh machine the moment
it is queued. **A self-hosted runner breaks that assumption, and a flow copied unchanged
spends most of its wall time waiting rather than working.** Measured on one busy repo
with one self-hosted agent: a clean run did ~8.5 min of work, and runs under load took
48–52 min. Nearly all of the difference was queue time.

- **A repo's capacity is how many agents it has, not how big the host is.** One agent
  runs one job at a time for that repo, whatever the host has spare. Jobs from different
  runs interleave on it job by job: one trunk run's secret-scan job finished and its
  build job then waited **33 min** behind other branches' jobs.
- **Measure queue and work separately, at job and step level.** Run duration
  (`created → updated`) adds the two together, so a slow suite and a starved runner read
  identically. Compare each job's `startedAt` with the run's creation time, and each
  step's duration with the job's, before you optimise either.
- **Where the merge gate waits for a completed trunk run, give trunk its own agent.**
  Branch runs that are informative only must not delay the one run a merge waits for.
  Use **disjoint** label sets: trunk → a trunk-only label, everything else → the
  general one, chosen in `runs-on` with an expression on `github.ref`. Until that lane
  exists, a single shared agent is also why a copied template's every-branch trigger
  goes back to trunk-only ([*Branch CI*](#branch-ci--the-candidates-own-run-read-as-a-class-314), #384). Two traps:
  - **A label no online agent carries leaves the job queued forever, with no error.**
    Register the agent before merging the routing, and change the routing in the same
    change that retires the agent.
  - **Route every job of a trunk run, including non-blocking ones.** A run is not
    *completed* until its last job is, and `continue-on-error` does not change that.
- **With few agents, every job is a queue slot.** A 13-second job (a secret scan) that
  sits in its own job costs one more wait per run. Fold it into the main job as its
  first steps; it still runs on every run and still fails the job before any test
  starts. The main job must check out full history, which the scan needs. Split jobs
  out again only when there are enough agents to run them side by side.
- **Never run the same check twice in one job.** Measured: a typecheck step, then the
  test script's own leading typecheck, run once per configuration (the switched-epic
  double run above) — **three** typechecks per build. Drop the copy whose removal breaks
  nothing; a test that pins the test script's shape decides which one that is.
- **Test parallelism follows the cores the runner *exposes*, but more cores only help a
  CPU-bound suite.** Runners that size their concurrency from `os.availableParallelism()`
  (node:test does) are capped by the container's core limit, not by the host's. Raising
  that limit is cheap on a memory-bound host, and it is not a speed-up you can assume.
  Measured: a 536-file batch that reported 4 went to 8, and the batch went from 170 s to
  160 s, about 5 %. It was bound by something other than CPU, such as process spawn or
  disk. Before you count on a gain, compare the batch's wall time with the CPU it
  actually used. Agent count (above) was the lever for wall time; core count was not.
- **Cap test-runner workers in CI with a fixed number. Size it to the slot's memory,
  not to the CPUs the job can see (#478).** The bullet above assumes the slot limits
  cores. Many slots limit only memory: they run as a memory-capped cgroup, and the
  job's tmpfs work dir (`node_modules` included) counts against that cap. The job
  still sees every CPU on the host. A runner that sizes its pool from
  `os.availableParallelism()` (vitest, jest, node:test, playwright; pytest-xdist
  `-n auto` and parallel PHPUnit do the same) then starts one worker per *host*
  core, so the worker count changes when someone upgrades the host.
  - Measured: a pool host went from 12 to 16 cores, and one repo's vitest went from
    11 to 15 jsdom workers per slot. That crossed the slot's ~5 GiB soft cap. The
    kernel throttled the job by reclaiming memory instead of killing it, so there
    was no OOM and no message saying why. Each slot logged over a million
    memory-high events and stalled for up to 24 min, imports took 4–28× their
    baseline, and tests timed out at 5–15 s. Trunk went red with no code change.
    The same suite had been green two days earlier, and longer per-test timeouts
    did not help.
  - The fix is a cap in the test config, read from CI so that local runs keep
    their full parallelism: vitest `maxWorkers: process.env.CI ? 4 : undefined`,
    jest `--maxWorkers=4`, node:test `--test-concurrency=4`, playwright
    `workers: process.env.CI ? 4 : undefined`. Pick the number from the slot's
    memory divided by one worker's peak, with room left for the work dir. Do not
    use the core count.
  - If a suite that used to be green starts timing out on a self-hosted pool with
    no code change, check the slot's memory pressure (`memory.events` `high`) and
    the worker count before you widen any timeout. Throttling stalls every test
    the same way, so the failures look like flaky tests even though nothing in
    them changed.
- **Before adding an agent, check the runner's disk as well as its memory.** Each agent
  brings its own runner install and workspace (GBs for a Node repo). Measured: the
  runner container's disk at 99 % was what blocked a second agent, not its memory. On a
  memory-bound host, a second agent inside an existing runner container buys the same
  concurrency as a new container, without a second OS's overhead.
- **A persistent runner never resets, so tests must clean up after themselves.** A test
  that makes a temp dir and never removes it leaks on every run. Measured: 5 000+
  leaked dirs, 2.1 GB, in a `/tmp` shared by the agents of seven repos, where one
  repo's leak can fill the disk every other repo's CI runs on. The same persistence
  makes a hosted cache action redundant: the package cache is already on disk, and
  restoring GitHub's copy of it cost ~37 s per job.

### Toolchain versions — strict precedence

**Never hardcode a version in CI.** Resolve it, in this order:

1. **`.github/project.yml`** toolchain keys, if present — wins.
2. **The ecosystem's own manifest** (`.nvmrc`/`engines.node`; `composer.json`;
   `.python-version`/`requires-python`) — the normal answer.
3. **Fail the build.** Never fall back to a default.

Measured: a silent default is how one repo built on Node 20 while deploying on Node 22,
undetected for months. When project.yml's pin and the manifest disagree, that is a
finding to report, not resolve quietly.

**`requirements.txt` does not declare an interpreter** — pins dependencies only; a Python
repo carrying only that file must add `python:` to `project.yml` or a `.python-version`.
Measured: a Python repo adopted the handbook, found no Python template, and copied the
Node one with `python-version: "3.13"` hardcoded in. **A missing template is not a
neutral absence** — it redirects adoption into a worse form and leaves behind a file
whose header lies about what it is.

### Test fixtures — neutralise ambient machine state, don't inherit it

**A test asserting a specific message or refusal must neutralise ambient credentials and
configuration rather than inherit them.** This handbook installs a global
`core.hooksPath`; a fixture that `git init`s and `git commit`s without overriding it runs
the developer's real pre-commit hook inside a fake repo. Measured twice, in the identical
shape (ambient `gh` credentials, then `core.hooksPath`). A git fixture helper sets
`user.email`, `user.name`, **and** `core.hooksPath` (pointed at a nonexistent directory)
before it ever commits.

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
stamp newer than the handbook is advisory. Reconcile deliberately: read the diff,
`colab template <name> --force`, commit.

**A rule-neutral change downgrades the finding to a warn — declared, never inferred
(#272).** Bytes drift is always a hard fail by default: a repo stamped against an old
template gets `fail` the moment anything in that template changed, including a fix that
touches no rule at all (a corrected hyperlink, once, flipped every under-stamped adopter
red — the incident that motivated this). The fix is not a classifier that reads the diff
and guesses whether it mattered; that trades a loud, honest failure for a quiet, wrong
one. Instead, the person editing `templates/` states the claim themselves, at the moment
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
- **CI and secret-scan templates (`ci-*`) are never eligible**, trailer or not — the
  same carve-out `ceremony: light` already respects (above): integrity there is not
  optional on any setting, so a declaration cannot soften it either.
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
- **The frozen CLI copy is measured against the latest tag, not `HEAD`** — measured
  against `HEAD` it reported "behind" for every unreleased CLI commit and advised
  adopting untagged code.
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
skill opens with a block that loads the file: an injection line that engines supporting
load-time expansion fill in with the file's text, and a plain sentence — *if
`.colab/skills/<skill>.md` exists in this repo, read it before continuing* — that is the
engine-neutral path and works on its own. With no file, the skill runs unchanged. A large
skill is a short core `SKILL.md` plus reference files beside it (#524); the core keeps every
step under its own number, so an overlay names the step it refines (`code-ship` B1c,
`code-sweep` §3) and never has to point into a reference file.

**[Hard — gate: docs-only classifier]** **Precedence:** local policy refines the skill for this repo and wins over the skill's own
text where they differ. **It never changes a `colab` gate** — a refusal from `colab ship`,
`colab claim` or any other command is not prose an overlay can talk past; the gates read git
and the tracker, not this file. Because the file is agent instructions, a diff touching
`.colab/skills/` is never [docs-only](#autonomy--the-docs-only-exception-345): it merges on
`auto-trunk` or a human's go, like a `CLAUDE.md` change.

**Why a file and not a fork or a field.** `project.yml` fields are switches and cannot carry
"write comments in Japanese". A repo instruction file is advisory and carries no precedence
over skill text. A repo-level copy of a skill does not override the installed one on an
engine whose skill precedence ranks the user-level install above the project's, and a fork
silently loses every upstream update. One overlay per skill keeps the upstream text and the
local difference in separate files, so a handbook update still lands.

The handbook defines this one layer and nothing on top of it. Org- or machine-wide layers,
size limits, drift checks against upstream, and tooling to manage overlays are the adopter's
business.

### Upstream — a consumer that changes what a convention means files it here (#362)

Everything above runs one way: the handbook changes, and adopters find out. The other
direction had no rule. A **consumer** is anything that reads these conventions in order to
act on them: a dashboard, a scheduler, a triage or ship prompt, a repo's own copy of a
skill, a label description on a tracker. A consumer can change what a convention means
with a commit in its own repo, and nothing made the handbook hear about it. Agents load
both texts, so they obey whichever they read last. Measured: a consumer made
`delivery:docs-only` a code-lane start candidate, and the handbook issue was filed 30 days
later. In between, a triage pass that followed the handbook left an issue unstarted for
about 6 days. A second consumer added a `delivery:*` value the handbook does not have. A
third consumer lacked that value, filed design work under `docs-only` instead, and its
scheduler sent the work to the code worker.

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
  names whoever approved the consumer change ([§5](#provenance--who-decided-the-work-should-exist)).
  Measured: a fix filed under `agent-filed` waited for acceptance, and one filed without it
  landed the same day. The upstream issue describes the consumer by shape. The link runs
  consumer → handbook, never the reverse, because the handbook is public.
- **The upstream issue ends in one of three outcomes:** the handbook adopts the meaning,
  the handbook declines it and the consumer reverts, or the handbook rules it a legitimate
  local variant.

**Declared, or it is drift.** Until the upstream issue closes, the consumer declares the
divergence in its `CLAUDE.md`, next to the handbook pointer block
([§9](#9-adopting-this) step 5) — in `CLAUDE.md` even when that file is a thin shell over
`AGENTS.md`, because the list belongs beside the block it qualifies, as a `Local divergences:` list with one line per item.
Each line gives the label or value, what it means here, and the handbook issue URL. This
is also what settles the "whichever text I read last" problem: an agent reading this
repo's instructions sees, next to the handbook pointer, which meaning wins here and why.
When the issue closes, remove the line if the meaning was adopted or reverted. If the
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
  handbook change the consumer's own prompts never absorbed. Measured: a label made
  monotonic upstream while a consumer's triage prompt still said clearing it "is often
  correct". `colab labels --ensure` creates missing labels and never rewrites an existing
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

### Any repo, first-time adoption

1. **Answer the shared question set** — the same five questions [§9](#9-adopting-this)
   asks a repo predating one of the newer axes ("Predates an axis", below). Each question
   is asked as a human answers it, not as a schema field name:

   | # | ask it like this | writes | values | at adoption |
   |---|---|---|---|---|
   | 1 | does a deploy target exist *today* ([§2](#2-tiers)), and how is it reached — a tag gates production, the promotion itself deploys, a human runs a runbook, or nothing is live yet? | `production` + `deploy` | a URL (or none) + `push-main` / `tag` / `manual` / `none` | **asked** — the URL only when `deploy` is not `none` |
   | 2 | who else works here? | [`room`](#room--who-else-is-here) | `solo` / `team` / `public` | optional — later, `--axis room` |
   | 3 | **what would break if you merged something wrong here?** | [`exposure`](#exposure--what-consumes-a-merge-here) | `none` / `self` / `live` / `released` | **asked** — a human's answer for `none`/`self` |
   | 4 | Should a human ever be allowed to commit straight to this repo's trunk checkout, alongside worktree sessions? free allows it with no runtime restriction; direct allows it and additionally declares intent for a stronger guarantee later (declared today, not yet enforced — CONVENTIONS.md §2); isolated vetoes it outright, human or not. | [`writes`](#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory) | `free` / `direct` / `isolated` (unanswered reads as `free` — #283) | optional — later, `--axis writes` |
   | 5 | by what path does a commit reach something that runs it? (a list — several may apply) | [`channels`](#channels--by-what-path-does-code-reach-the-thing-that-runs-it) | `workflow` / `hook` / `procedure` / `checkout` / `artifact` / `data` / `none` | optional — later, `--axis channels` |

   **Adoption asks only what changes a gate (#533).** Questions 1 and 3 decide the gate
   count; 2, 4 and 5 are optional in the schema and legal absent — `room` only tunes how
   verbose the trail is, `writes` absent already reads as the common `free`, and `channels`
   is descriptive (and easy to mis-answer `workflow` on a repo that merely has CI). So a
   fresh adoption leaves them unanswered and prints one line naming them and the
   `colab adopt --axis <row>` that answers each later. Their flag (`--room`, `--writes`,
   `--channels`) still answers one in the same run.

   **[Hard — gate: adopt human gate]** **The human step comes first, not last (#522).** Answering question 3 with `none` or
   `self` is a human's act (below). An agent driving an adoption should know that before it
   starts, not learn it from the final refusal: when `colab adopt` cannot finish without a
   human, the **first** line it prints is the one command the human runs, the answers this
   run already had filled in (`COLAB_HUMAN=1 colab adopt --production none --deploy none
   --exposure none … --answered-by "<name>"`). At a terminal, the exposure answer is checked
   against the repo's shape the moment it is given and re-asked with the reason, rather than
   refused after every other question.

   Question 1 writes `production` and `deploy`, never `tier` directly — `tier` is a pure
   function of those two answers (`tools/lib/adopt.js:deriveTier`: no production → `B`;
   production + `push-main` → `C`; production + `tag`/`manual` → `A`), so asking for the
   letter directly would be asking for a value that is always derivable from a more basic
   answer already on record — the same drift-by-redundancy this whole model exists to stop.

   Question 3 is phrased this way — never "who consumes this?" — per the ruling on #128:
   the person answering is standing in the repo, not reading a schema, and "what breaks"
   is the question they can actually answer.

   **Detected, never asked:** `trunk` (the default branch), `stack` and toolchain pins
   (read from the repo's own manifests), `ports` (existing config or reservations). Do not
   ask a human something the repo already states.

   **Derived, never asked:** gate count, CI role and thoroughness, ceremony weight, whether
   a branch is mandatory, the rollback obligation. Every one of these follows from the
   answers above; a checklist that also prompts for a derived value is exactly how the
   fields drift apart from each other again (the failure this whole model exists to stop).

   **Two entry states, one set.** A repo with nothing recorded yet asks the two gating
   questions now, during first-time adoption, and leaves the optional three for later. A repo that already adopted before one of the newer
   axes existed asks only the gating axes it is missing (the optional three stay optional
   there too) — same five questions, same wording, at
   sync time ("Predates an axis", `handbook-sync`). Building this once and pointing both
   moments at it is the point; do not let a sync grow its own paraphrase of these five
   rows.

   **Asking is not the same as writing.** A sync (or a first-time adoption interrupted
   partway through) records a human's answer; it never fills a missing key on its own,
   and it never "resolves" the `production:`-pairing advisory below by deleting a key
   that was already declared. Declaring must never be riskier than omitting.

   **[Hard — gate: adopt human gate]** **The exposure asymmetry survives here too.** An agent walking through this checklist
   may *propose* `live` or `released` when it finds committed evidence for one (a non-null
   `production:`, a committed deploy path) — never `none` or `self`. Omission reports as
   `null` (undeclared, and legal); only a human answer may write down that nothing, or only
   the room, consumes a merge here.

   **[Hard — gate: adopt human gate]** **`colab adopt` executes this checklist.** It detects what a repo already states, asks
   a human only what could not be detected (flags, or an interactive prompt at a
   terminal), derives the rest, and writes `.github/project.yml` in one act — the same
   shape `colab template` already uses for copy-and-stamp. A row already answered is
   skipped; `--axis <row>` forces a re-ask on purpose (the "going live" ladder below asks
   for exactly that). Lowering an existing `exposure` — or a first declaration of
   `none`/`self` — requires a human: an interactive terminal, or `COLAB_HUMAN=1` together
   with `--answered-by <name>` (the same bar `colab ship`'s gates use, and no stronger —
   see the command's `--help` for the honest limit). Raising, or a first declaration of
   `live`/`released`, needs nothing beyond the falsifier/shape clearance described above —
   an agent may run this unattended for exactly the direction CONVENTIONS.md [§2](#exposure--what-consumes-a-merge-here)'s asymmetry
   already allows it to propose. `colab adopt` never runs steps 3 onward below; it prints
   them as a to-do list on exit. **The five questions above are asked as forced numbered
   menus (#283)**, not free text — every option is answerable by its number or its literal
   value — and `exposure` is the only one of the five that carries a skip option (its own
   fallback, deriving `tier` instead, is a real fallback that consumes the absence; the
   other four have none, so declining them would just recreate #282's shape under a
   different row).

   **Land the descriptor on trunk in the same human act (#481).** On a freshly adopted
   repo, the first branch is the one that *creates* trunk's rules — the descriptor with
   the maintainer's grant, and the repo's CI. `colab ship` reads autonomy from the
   descriptor **trunk** carries, so that branch is judged by rules trunk does not have
   yet, and a human ends up hand-merging it although the grant was already given. The
   maintainer's adoption command is the human step, so it can land its own output:
   ```sh
   COLAB_HUMAN=1 colab adopt --exposure self --autonomy auto-trunk \
     --answered-by "<name>" --land          # run on the checkout standing on trunk
   ```
   **[Hard — gate: adopt autonomy/land gates]** `--autonomy auto-trunk` records the grant with the same provenance comment as every
   answer, behind the same bar as `writes: direct` (it expands what an agent may do);
   `manual` is never gated, and `ceremony: light` refuses it. `--land` commits exactly
   what this run wrote — the descriptor, plus the thin-shell `CLAUDE.md`/`AGENTS.md` when
   written now — to trunk as its own commit and pushes it. It requires `COLAB_HUMAN=1`
   **and** `--answered-by`, with no terminal substitute, since it writes trunk; it refuses
   off trunk, with `--local`, and when origin's trunk is ahead. Everything else in the
   adoption — CI workflow, guards, docs — then ships through the normal lane under the
   grant. Trunk's tree has no workflow file at that point, so its `none` cannot hide a red
   ([§4](#4-branches-and-commits), #482): the follow-up branch that adds CI passes `trunk CI
   green` on its **own** green run, with no human step, and the CI it adds grades every
   branch after it. `ci-granted` stays the door only for a trunk that already has workflows
   and still has no run at its sha.
2. **Write `.github/project.yml`** ([§3](#3-githubprojectyml--the-marker)) with the
   answers from step 1 — **and declare `migrations:`** when the repo keeps migrations
   anywhere but `database/migrations/` or `prisma/migrations/`
   ([`project.schema.md`](project.schema.md#migrations--optional)). None of the five
   questions asks it, so `colab adopt` lists it as the first remaining step, naming the
   candidate layouts it found (`git ls-files`: an uncovered `migrations/` directory, or a
   directory of tracked `*.sql` files). Until it is declared, the no-new-migrations gate
   cannot see those files (#449).
3. **Create the whole label set — twenty-three names, not a subset** (`in-progress`,
   `deps-checked`, `agent-filed`, `epic`, `needs-decision`, `decision-recorded`,
   `needs-plan`, `migration-granted`, `needs-migration-grant`, `ci-granted`,
   `low-priority`, `priority:now`, `priority:high`, the six `delivery:*`, the three `deferred:*`, and `release-hold`):
   ```sh
   colab labels --ensure
   ```
   Idempotent by construction (#206) — reads the set from `tools/lib/labels.js`'s
   `CONVENTION_LABELS`, the one place it is actually defined, creates only what this
   repo is missing, and reports created vs already-there; safe to re-run because
   partial adoption is normal. It also names any existing convention label whose
   description differs from the handbook's, and rewrites it only when asked
   (`--refresh-descriptions`, #364) — a description may be a declared local divergence
   ([§8, *Upstream*](#upstream--a-consumer-that-changes-what-a-convention-means-files-it-here-362)).
   (No `colab` on this machine? The twenty-three `gh label
   create … || true` lines this replaced are recoverable from that file's history.)

   **This count is a hand-typed number restated in at least four places** (here, the
   `gh label create` fallback line above, `skills/handbook-sync/SKILL.md`, and
   `tools/lib/codec/labels.js`'s own doc comment) — **none checkable against the others except
   the one pinned assertion in `tools/lib/labels-ensure-cli.test.js`.** #274: adding
   `delivery:elsewhere` left three of the four wrong until found by hand. Add a label,
   bump that test, then grep for the other three prose counts before you're done.
   What each absence costs, briefly: `in-progress` — the first claim cannot land.
   `deps-checked` — a readiness check can never tell *free* from *nobody looked*.
   `agent-filed` — every agent-filed issue reports as human-approved. `epic` — an epic
   passes every readiness gate and reads as a normal start candidate. `needs-decision` —
   the blocking-question gate cannot be applied at all. `decision-recorded` — a recorded
   answer has no positive marker to distinguish it from a label nobody ever applied, so the
   next mechanical pass re-gates settled work (measured: #127). `needs-plan` —
   `code-start` always sees "no flag", every session falls back to rung 1.
   `migration-granted`/`ci-granted` are **not opt-in** (unlike `tracking`) — absence fails
   malignantly, discovered only when a repo hits the wall with no route past `ship`'s gate
   at all. `needs-migration-grant` — the plan-time flag a consumer raises before `ship`
   would refuse has nowhere to land, so the grant request never surfaces until the wall
   (#230). `low-priority` — a triage pass has no way to say "startable, but ranked last",
   so a group meant to wait its turn is reported exactly like every other ready group
   (#268). `priority:now`/`priority:high` — an owner's "do this first" has nowhere to be
   recorded, so it lives in a chat a scheduler cannot read (#537). `delivery:*` — a content push or ops check has no way to say "not a diff" and
   jams the code pipeline, and a new surface's design issue reads as a code start (#359). `deferred:*` — a triage pass has no way to say "parked, and
   here is what wakes it", so a deliberate park is indistinguishable from an unexamined
   issue — measured at 11 + 4 issues misreporting as untriaged across two repos (#279).
   This full set is provisioned again on every sync, not only at adoption.
4. **Add the tier topic** — `gh repo edit <owner>/<repo> --add-topic tier-b` (or
   `tier-c`/`tier-a`).
5. **Add the handbook pointer to `CLAUDE.md`** — copy
   [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md); create the file if
   none exists. **Do not skip this** — it is the only reason a future agent discovers
   these conventions. `colab adopt` writes it for you on a repo adopting for the first
   time that has no `CLAUDE.md` yet, in the shape below.

   **The instruction-file shape (#417).** Most agent tools read `AGENTS.md`; one reads
   `CLAUDE.md` by name. So:
   - **Repo prose goes in `AGENTS.md`** — what the repo is, how to run and test it,
     pointers into `docs/`. It is the repo's *instruction file*: the one you edit.
   - **`CLAUDE.md` is a thin shell:** `@AGENTS.md` on its first line, plus the blocks tools
     look up in `CLAUDE.md` by name — this Conventions block with its stamp, any
     `Local divergences:` list beside it, and any other tool-managed block that is found by
     filename. The stamp only works there: the audit, `handbook-sync` and `colab update`
     never follow the import to find it.
   - **No block lives in both files.** A framework generator that supports targets is
     configured to write `AGENTS.md` **only** (Laravel Boost: its agent/target config). A
     block in both is loaded twice into every session once `CLAUDE.md` imports `AGENTS.md`,
     and a generator writing both re-adds the copy after any hand cleanup.
   - A repo with only a `CLAUDE.md` is still conforming — the shell is the shape for new
     repos and the target for migrations, not a reason to fail an existing one.
   - **A fork of an upstream you don't own does not take this shape** — the thin-shell
     conversion would rewrite a file the upstream keeps editing. Its step 5 is the
     append-only block in [*A fork of an upstream*](#a-fork-of-an-upstream--a-repo-you-own-that-tracks-one-you-dont-449), below.

   The audit holds this shape: its size advisory measures `CLAUDE.md` **plus every in-repo
   file it `@`-imports**, so a bloated `AGENTS.md` behind a tiny shell is still caught; it
   warns when a tool block appears in both files, when the Conventions block sits
   anywhere but `CLAUDE.md`, when `CLAUDE.md` carries repo prose (`prose-in-claude-md`, with
   the line ranges) and when there is no `AGENTS.md` (`no-agents-md`) — #419. All warnings,
   never failures; `handbook-sync` carries the move as a graft step.
6. **Make sure CI meets [§7](#7-ci-and-toolchain)'s outcome** — copy a template via
   `colab template <name>`, which stamps for reconciliation. **On `exposure: released`, this
   step also wires the release rung ([§6](#6-releases)) — at adoption, not later** (#492): the
   `release:` block with the route the descriptor's row takes and `version-source: tag`, the
   release workflow (`templates/release-auto.yml`, its edit points walked), the deploy template
   for the stack where the tag deploys — copied disarmed, armed by the operator — and a first
   final, which is the operator's to set because `colab release cut` refuses with none to bump
   from. A released repo adopted without them never cuts a candidate until someone notices:
   measured on six adopters in one sweep, and more that had the workflow but no first final.
   `colab adopt` lists these as step-6 lines; the no-production row's route is a proposal for
   the human to confirm, never a choice the agent makes.
7. **Register the repo** — `colab register`, updating both the audit fleet list and the
   reserved-ports aggregation. Unregistered = invisible to the fleet audit.
8. **Leave existing branches alone** — grandfathered.
9. **Do not create `dev`** unless the repo is genuinely Tier A or Tier C.

### Going live: Tier B → Tier C or Tier A

Do this **on the day a deploy target exists** — not before.

1. **Write down the path to production** — for C, the deploy workflow triggered by a push
   to `main`; for A, the workflow triggered by a tag, or the runbook for a hand-deployed
   repo. One of these must be committed before proceeding.
2. `git checkout -b dev main && git push -u origin dev`
3. Set the repo's default branch to `dev`.
4. **Add `dev` to every CI workflow's trigger branches** — CI that still gates only
   `main` runs zero checks on your actual work.
5. Update `project.yml`: **C** — `tier: C`, `trunk: dev`, real `production:`,
   `deploy: push-main`. **A** — `tier: A`, `trunk: dev`, real `production:`, and
   `deploy: tag` or `deploy: manual` + `runbook:` — never `push-main`. *Tag-gated
   single-trunk variant:* keep `trunk: main` and skip steps 2–3 entirely.
6. Swap the topic to `tier-c`/`tier-a`; update the internal project table.
7. **Tier A only:** tag the first release (on `manual`, tags are still worth cutting).
   Tier C has nothing to tag — the promotion itself is the release.
8. **Re-answer questions 3 and 5** of the shared question set above — going live is
   exactly the event that usually moves `exposure` (to `live` or `released`) and adds a
   channel (`workflow`, at minimum). Leave `room` and `writes` alone unless who works
   here, or how many units are in flight, genuinely changed too.

Step 1 comes first because `main` only becomes meaningful once something consumes it —
what must not exist is a `main` that nothing and nobody reads.

### Tier C → Tier A — when the site earns a release ritual

Do this when you find yourself *wanting* to name what shipped — not before, since an
unused tag ritual decays exactly like an unused branch.

1. **Retrigger the deploy workflow on a tag** instead of a `main` push — the whole
   change; until it lands, the tier claim would be false.
2. Update `project.yml`: `tier: A`, `deploy: tag`. `trunk` stays `dev`.
3. Swap the topic to `tier-a`.
4. Tag the current `main`, so the first tagged release names what is already live.
5. **Re-answer question 5** (`channels`) — a tag ritual is itself a new channel
   (`artifact`, if others will consume the tag) or reinforces `workflow`. Questions 2–4
   rarely move at this transition; check them only if something about who works here or
   how work lands actually changed.

The reverse — **A → C**, the fix when a repo declares `tier: A` with `deploy: push-main`
— is descriptor-only: set `tier: C`, leave the pipeline exactly as it is, swap the topic.

### Working in a repo you don't own

Everything above assumes the repo's **owner** is the one adopting. Sometimes that is not
the case. The fleet has to build in a repository whose owner has not adopted this
handbook, who reviews and merges changes himself, and where committing handbook files is
not an option. That repo can still be driven by `code-start` → `code-wrap` → `colab ship`,
and nothing lands in the owner's history (#393). The measured case: a private repo owned
by another developer, default branch `master`, no handbook files, with the fleet building
a service layer on a long-lived branch of its own.

**The minimum is small, and all of it stays out of the owner's repo:**

| need | where it lives | why it works |
|---|---|---|
| `.github/project.yml` — `trunk`, `production`, `deploy`, `stack`, `exposure` | the local clone's **main checkout** only, hidden by `.git/info/exclude` | every reader (`colab`, `adopt`, the audit's local source, `code-start`'s `cat`) reads the working tree, not git. `git status --porcelain -uall` does not report an excluded file, so the dirty-checkout and drift checks stay quiet. Same mechanism as the plan files (`.plans/`, legacy `.claude/plans/` — #488) |
| labels `in-progress`, `deps-checked`, `agent-filed`, `epic` | the tracker (metadata, not files) | the load-bearing subset a session itself writes. Every other convention label is opt-in by use (`colab labels --ensure --minimal`) |
| an operating note, `CLAUDE.local.md` | the local clone, excluded | carries the rules the owner's repo cannot: "our trunk is the integration branch; never touch the owner's trunk; autopilot stays off" |
| the worktree subdir (`.worktrees/`) | excluded | an adopted repo hides it in its committed `.gitignore`; the owner's repo does not, so without this line every worktree shows up in the main checkout's `git status` |
| registry entry | the operator's machine | already local |
| CI templates, CODEOWNERS, the `CLAUDE.md` block, the topic | **not needed** | nothing in claim, start or ship gates on them, and each would be a commit or setting the owner never asked for |

**[Hard — gate: adopt human gate]** **The pattern: `trunk:` names the fleet's own integration branch** (e.g.
`<prefix>/integration`), never the owner's default branch. Claims, worktrees, grading and
`colab ship` then work unchanged. Sessions branch off the integration branch, `ship`
merges into it, and the owner's trunk is reached only by a pull request he reviews and
merges himself — `colab deliver`, below. Declare **`exposure: self`**: a merge onto the integration branch reaches
only the fleet, and the owner's review is the next gate. `self` is human-gated
([§2](#2-tiers)), as always. The legacy fallback does not work here, because it would
derive `tier: B`, which is the single-trunk shape, and the integration branch is never the
repo's only long-lived branch.

**[Hard — gate: adopt human gate]** **One command does it** (a human answers the exposure row, at a terminal or with
`COLAB_HUMAN=1 --answered-by <name>`):

```sh
git push origin <owner-trunk>:refs/heads/<prefix>/integration   # once, if it doesn't exist yet
colab adopt --local --trunk <prefix>/integration --production none --deploy none \
  --exposure self --stack "<text>"
```

**[Hard — gate: adopt --local refuses]** It refuses when the descriptor is **tracked** (the repo is adopted, so use plain `adopt`),
when `--trunk` is missing, and when `--trunk` names the owner's own trunk. It appends the
exclude lines *before* writing anything, writes the descriptor into the main checkout
(where every worktree's `colab` reads it — a linked worktree never carries the file),
writes a stub `CLAUDE.local.md`, ensures the four labels, moves the main checkout onto the
integration branch when the tree is clean, and checks that `git status` shows none of it.
It then prints what it deliberately did **not** do, and why. A bare re-run is the
idempotent re-apply.

**Delivering to the owner: one pull request, `colab deliver`** (#394). The owner's branch
is declared in the same local descriptor — `colab adopt --local` writes this block itself
when it detects the owner's default branch (#405), and never overwrites one already there:

```yaml
owner:
  branch: master     # the owner's branch; `remote:` optional, the repo's own when absent
```

Per-issue landing does not change: each session still ships onto the integration branch,
and its issues close there. Delivery is a **separate, batch-shaped step**:

```sh
colab deliver --dry                 # read-only: what is pending, and the delivery state
COLAB_HUMAN=1 colab deliver         # open (or refresh) ONE PR integration → owner's branch
```

- **[Hard — gate: owner-branch guard]** **It never merges.** The owner merges by merge commit, squash or rebase — his call. No
  colab command moves his branch: `ship`, the ship batch and `promote` refuse a push to it,
  and `COLAB_HUMAN=1` does not lower that.
- **Delivered is read from PR state.** After a squash or rebase no integration commit is an
  ancestor of the owner's branch, so ancestry cannot answer "was this delivered". The last
  merged delivery PR's head is the boundary; the next run offers only what landed after it,
  in a fresh PR. An open PR is refreshed (its head follows the integration branch on its
  own), never duplicated.
- **[Hard — gate: deliver refuses]** **A rejection stops it.** If the newest delivery PR was closed without a merge, `deliver`
  reports it (exit 3) and opens nothing until a human re-offers the batch with `--reopen`.
- **The PR carries no closing keywords.** Its issues already closed when their work landed
  on the integration branch; the body lists them as "carried".
- **[Hard — gate: deliver human gate]** **Opening or editing the PR needs a human** — it is an outward act on somebody else's
  repo. A scheduled driver may run `--dry` and read the state (`waiting-on-owner`,
  `nothing-to-deliver`, `ready`, `rejected`); it never acts on the owner's branch.
- **[Hard — gate: core-path PR gate]** **The core-path rule still applies on top** ([§4](#4-branches-and-commits), #350): a branch
  touching a CODEOWNERS path needs a non-author approval before it lands on the integration
  branch.

A PR per issue that the owner merges one by one is a different shape, deferred until a repo
asks for it; the measured case wants the batch.

**Traps, each measured:**

- **A `.gitignore` entry is itself a tracked file.** Hiding the descriptor that way is
  exactly the commit you are avoiding. The local-only mechanism is `.git/info/exclude`
  (in the common git dir, so it covers every worktree).
- **Scheduled autopilot must stay OFF on such a repo.** It would triage and start the
  **owner's** issues, not only the fleet's, and there is no way today to scope it to the
  fleet's issues.
- **`colab ship` still gates on CI at the integration branch's head.** The workflows are
  the owner's. If none runs on push to the integration branch, every ship reads "no run"
  as human-gated and needs a `ci-granted` exemption per branch. Find out which case you
  are in before the first ship. The audit reports an ungated integration branch as an
  advisory here, not a failure, because the fix would be a commit to his repo.
- **The main checkout must rest on the integration branch**, not on the owner's trunk
  where a fresh clone lands. Otherwise `ship` refuses with "trunk checkout not ready".
- **A dashboard's cached repo scan does not pick the repo up** until it is refreshed.

**The audit recognises the state.** A local audit reports `⌂ adopted locally, not
committed` instead of "not adopted", and asks only for the four labels. It flags the
accident the mechanism exists to prevent: a descriptor that is untracked but **not**
excluded, one `git add -A` away from the owner's history. A remote audit reads the forge,
where the file never exists, so only a local audit can see this state.

**Prefer full adoption instead** whenever the owner is willing to carry the files. It is
the only way the conventions reach anyone who clones the repo without this machine's
local state: a teammate, CI, the owner's own agents. Local adoption is a working
arrangement for one operator's clones, not a substitute.

### A fork of an upstream — a repo you own that tracks one you don't (#449)

The two paths above cover a repo you own and a repo you don't. A third shape sits between
them: **a fork you own that keeps merging from an upstream you don't.** The fork is yours, so
it adopts in full — descriptor, labels, CI, registration, all committed. But some files in it
belong to the upstream: its `CLAUDE.md`, its `AGENTS.md`, and often an agent workflow of its
own. Every edit to one of those is a patch the fork carries forever and re-resolves on every
upstream merge.

**`colab adopt` detects it, never asks.** It looks for a remote named `upstream` whose URL
differs from `origin`'s. `--fork` asserts the shape when the upstream remote has another name,
and `--no-fork` denies it when a remote called `upstream` means something else. Nothing is
written to the descriptor: the remote is the fact, and a key would be a second copy of it that
could drift.

Four things change from [*Any repo, first-time adoption*](#any-repo-first-time-adoption):

1. **Step 5 is append-only.** Paste [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md)
   at the **end** of the upstream's `CLAUDE.md`. Leave the upstream's prose where it is, leave
   `AGENTS.md` alone, and record the append in whatever list the fork keeps of its patches
   against the upstream. One appended block, at the end, touches no upstream line, so a merge
   only conflicts if the upstream edits its own last lines. Measured: a block appended this way
   survived a 588-commit upstream merge untouched. The thin-shell conversion moves every upstream
   line instead, and conflicts on each upstream change to that file.
   - **Upstream has no `CLAUDE.md`?** `colab adopt` writes one. With an upstream `AGENTS.md` it is
     the usual shell (`@AGENTS.md` plus the block). Without one it is the block alone, and adopt
     writes **no** `AGENTS.md` stub. Every file adopt creates is a file the upstream may add later,
     and then it conflicts.
   - **`CLAUDE.local.md` instead** only when the fork must stay byte-identical to the upstream
     (a pure mirror). That file is never committed, so a teammate, CI or the upstream's own
     agents cloning the fork never see the conventions. That is the same cost as
     [*Working in a repo you don't own*](#working-in-a-repo-you-dont-own), paid on a repo you do own.
   - The audit's `prose-in-claude-md` and `no-agents-md` warnings are expected on a fork, and so
     is `handbook-sync`'s offer of the `AGENTS.md` graft. Leave the upstream's files alone and
     decline the graft. Both are warnings, never failures.
2. **The upstream's agent workflow stays where it is, and the appended block says which flow
   governs.** An upstream can ship skills and commands under `.claude/skills/` and
   `.claude/commands/`. Measured: one such skill fired on any "fix / implement / refactor"
   request, wrote four files per change into the upstream's own spec folder, and opened a pull
   request. That competes directly with `code-start` → `code-wrap` → `code-ship`. Deleting or
   editing it is a fork patch with the same merge cost as step 5, so don't. Add one line inside
   the appended block instead: *work on this fork runs the `code-*` flow; the upstream's
   workflow is how changes are contributed back to the upstream, not how this fork ships.* An
   agent reads the upstream's instructions and then this block, so the block is what settles
   the competition. `colab adopt` names the upstream's skill and command entries in its
   remaining steps so that this line gets written.
3. **Declare `migrations:` (step 2) before the first ship.** An upstream's layout is usually
   not one of the two defaults (measured: `modules/*/sql/*.sql`), and an undeclared layout
   leaves the no-new-migrations gate blind. This is true of any repo, but a fork inherits
   someone else's layout and is the likeliest to miss it.
4. **The upstream's `CODEOWNERS` is inert here.** Its teams belong to the upstream's org, so
   `colab ship` ignores them and the core-path rule stays off until the fork writes owners of
   its own ([§2, *Core paths*](#core-paths--a-pr-and-a-non-author-approval-before-landing-350)).
   `colab adopt` names those teams. Leave the file alone unless some paths here need a review.

Everything else in §9 applies unchanged: the five questions, labels, the topic, CI and
registration. `trunk:` names a branch of the fork, the one its sessions merge into. Upstream
merges come into the fork, and nothing is pushed to the upstream's branches.

### Fixtures and examples use invented values

**Test fixtures, sample data and documentation examples MUST use invented values.**
Never a real hostname, account handle, filesystem path, internal domain, customer or
partner name — even when the real value is what was measured. Write `build-box-01`,
not the machine you ran it on.

This is not the secret-scanning rule wearing a different hat. A credential is a secret
and a scanner finds it; **a hostname is not a secret, so every gate you run passes it**,
and in a public repo it is published the moment it lands. Git history cannot be recalled
once anything is cloned or forked, so the only reliable control is never writing the real
value down.

The cost of complying is zero — an invented value tests exactly as well as a real one,
because a fixture asserts *shape*, never provenance. We found real machine names in four
of this repo's own fixtures, one of them inside an asserted output string, with CI green
throughout and correctly so.

**Where the real value genuinely matters** — a reproduction that only makes sense against
a specific environment — it belongs in an Issue on a private tracker, not in a tracked
file. The destination decides, exactly as it does for
[§4](#4-branches-and-commits)'s commit messages.

**The rule has a mechanism, and it is not CI.** `templates/pre-commit-identity` scans
staged content against a vocabulary of strings the operator says must never be published,
and `templates/pre-commit-dispatch` composes it with the secret scan a repo already has.
Pre-commit, deliberately: by the time a workflow runs, the commit exists and may already
be pushed, and the only remedy left is rewriting published history. **The scanner is
shipped; the vocabulary never is** — a list of the exact strings an organisation treats as
sensitive is a precise index of what to look for, so it is supplied by path and kept
outside every repo. Adoption steps: [`templates/README.md`](templates/README.md).

Two things the hook cannot see, both real. **Repository metadata** — description, topics,
homepage, the name itself — never passes through git, and it is the first thing a visitor
reads; that needs a periodic sweep instead (`node audit/audit.mjs --identity`, documented in
[`audit/README.md`](audit/README.md), reading the same operator-supplied vocabulary and
refusing to run without one). **A machine with no vocabulary configured** scans nothing, and
says so on every commit. Neither is a reason to relax the rule above: the rule is the
control, and both mechanisms are backstops for the day somebody forgets it.

---

## 10. Anti-patterns

Each of these is something we have actually done.

**A release branch nobody consumes.** A repo adopted `dev` as default but nothing ever
deployed from `main` — it sat 76 commits behind for months, while a sibling `staging`
branch was abandoned after a week. *A branch with no pipeline hanging off it decays into
noise.* Why Tier B is the default, and going-live step 1 is "add the deploy workflow".

**The same fix opened four times.** With `dev`, `staging`, and `main` all live, one
timezone fix required four near-identical PRs. *Three tiers without automated promotion
is a tax on every hotfix.* We use two, deliberately.

**A deploy mechanism nobody used.** A workflow triggers on tag push; it has zero tags —
every deploy was manual dispatch. *Copy-pasted CI encodes intentions nobody adopted.*

**A merge that ships itself — while claiming otherwise.** Two live repos deploy on every
`main` push and declare Tier A, whose contract says a release artifact gates production.
*The mechanism is fine; claiming a gate you do not have is not.* Now a finding.

**Docs describing a repo that doesn't exist.** Our most heavily documented repo
prescribed trunk `main` (actual default `master`), "rebase, never squash" (every commit a
squash), CI gating on `dev` (workflow skips CI there by design). *An aspirational doc is
worse than no doc — people trust it.*

**Stale branch references in CI.** A repo still gated on `develop`, `master`, and
`workos` — none of which exist. *Config drifts silently when copied rather than
referenced.*

**A conclusion that only ever existed in chat.** A session settled a batch of rules and
went straight to implementing them — three branches, zero Issues, no issue numbers in
branch names, no `Closes #N` possible. The code landed; the argument behind it was lost.
*Work only agreed to in a room is undocumented the moment the room closes.* Why the
decision goes on an Issue before any file is touched ([§5](#5-claiming-work--how-to-say-im-on-this)).

**A silent version default.** Covered in [§7](#7-ci-and-toolchain) — worth repeating: the
bug was invisible because CI was green the whole time.

---

## 11. Quick reference

```sh
# starting work
gh issue list --label in-progress                 # what's taken
gh issue list --label agent-filed                 # filed by an agent — no human approved it yet
gh issue list --label epic                        # a container for sub-issues — never a start candidate
gh issue list --label group:<key>                 # must share one branch — start them together
gh issue list --search "label:delivery:content,delivery:ops,delivery:elsewhere"  # non-code-here — route, don't start
gh issue list --label delivery:design             # a new surface's design artifact — a design session's work, never a code start
gh issue list --search "label:deferred:date,deferred:measurement,deferred:external-party"  # parked — each must name a wake condition
gh issue edit N --add-assignee @me --add-label in-progress
git fetch origin <trunk> && git checkout -b [<login>/<machine>/]feat/<slug>-N origin/<trunk>   # cut from a FRESH origin/<trunk>, never local trunk; prefix only under branchPrefix: machine

# editing a file that already exists — who else is holding it, by file not by issue
# fetches first, filters spent branches out via `landed`, and REFUSES (exit 2) to answer
# "clean ground" if it could not fetch — an empty result off stale refs is a wrong answer
colab holders <path>

# finishing work
colab landed --worktree <name>                    # landed → teardown, cargo → merge
git checkout <base> && git merge --squash feat/<slug>-N   # base = trunk, or a declared line
gh issue edit N --remove-assignee <claimer> --remove-label in-progress   # both halves — one alone is a half-claim; <claimer> = @me only if you claimed it (§5)

# releasing — exposure: released (legacy tier A; who tags follows §6's release routes)
git checkout main && git merge --no-ff dev && git push   # --no-ff, never squash
colab release cut                                        # candidate v1.3.0-rc.N — refuses unless §6's four conditions hold
git tag v1.3.0 && git push origin v1.3.0                 # final — automatic after 3 clean days where nothing deploys;
                                                         #   a human act where the tag deploys (deploy: tag / manual)
# the number is computed (majors too, with a migration section); its reasoning goes in the release notes
```

---

*Changes to this file are changes to how everyone works. Explain the why in the PR body.*
