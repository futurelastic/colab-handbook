# `.github/project.yml` — field reference

The per-repo marker file. One flat YAML document, committed, at
`.github/project.yml`. It exists so a human or agent can learn the repo's state
with zero API calls — including in repos that have no GitHub remote at all.

Keep it flat. No nested maps, no anchors — the readers (the audit tool, the
`colab` CLI, CI resolution steps) deliberately use a minimal YAML subset:
`key: value` scalars, plus **lists of scalars** in either form (`[a, b]`, or
`- a` lines indented under the key). Anything else is reported as a parse
finding rather than half-read.

## Fields

### `tier` — optional (legacy)

`A`, `B` or `C`. The tiers differ in **how many gates stand between a merge and
users**:

| Tier | Production | Gates | Shape |
|---|---|---|---|
| `B` | none | 0 | one branch, `main`. Nothing to deploy. |
| `C` | yes | 1 | promotion `dev` → `main` **is** the deploy. |
| `A` | yes | 2 | promotion verifies; a **tag** deploys. |

- `B` — no production target. The default; an imminent launch is still `B`.
- `C` — live, but the promotion itself ships it. `C` is `A` minus the tag.
- `A` — live, and a deliberate release artifact (the tag) gates production.

**A/B/C are labels, not grades.** Read naively `C` looks like a worse `B`, but
`B` has no production at all — a tier B repo cannot break anything for users,
because there are no users. The letters name *shapes*, not maturity, and moving
from `B` to `C` is not a demotion any more than `C` to `A` is a promotion in
quality. Pick the one that describes your pipeline truthfully; a repo claiming a
gate it does not have is the failure this file exists to prevent.

Whether production exists is the tier question. *How* it deploys — a tag, a
`main` push, a human following a runbook — is [`deploy`](#deploy--required)'s
job, and the two must agree.

**`colab adopt` (#199) writes `tier` only when `exposure` ends the run still unanswered** —
declined at an interactive prompt, or simply not among the axes a non-interactive run
answered — and no `tier` key already exists. The written value is derived purely from
`(production, deploy)` (`tools/lib/adopt.js:deriveTier`), never from `exposure`, with a
comment naming how to answer `exposure` later. The normal path — `exposure` answered —
never writes `tier` at all: nothing in `tools/colab` reads it, and a redundant key a later
hand-edit can contradict is exactly the drift this axis exists to end. An already-declared
`tier` is never touched.

**As of #144, [`exposure`](#exposure--optional) is the AXIS OF RECORD when declared —
`tier` is a legacy read, not a second source of truth.** This is the breaking change the
major version bump names. The precedence (`tools/lib/axis-authority.js`):

1. `exposure` declared → it governs gate count outright. `tier`, declared or not, is
   carried through unread by the derivation (though see the contradiction rule below).
2. Else `tier` declared → gate count is DERIVED from it: `A → released`, `C → live`,
   `B → null`. The `null` is deliberate, not an oversight — a bare `tier: B` carries no
   derivable opinion about what consumes it (`none`, `self` and `released` are all
   measured under `B` in this fleet), so nothing may guess which one it means.
3. Neither declared → **a finding**: no axis of record. This replaces the old
   unconditional "missing key(s): tier" — `tier` left the required-key list in this unit,
   because `exposure` alone is now a complete answer.

**`exposure` does NOT become required by this unit.** 16 of 17 repos in this handbook's own
fleet have never declared it, and they see zero change: the legacy read reproduces
pre-#144 behaviour byte for byte. Making `exposure` mandatory is a later, separate step
(phase 3 of the epic tracking this model, CONVENTIONS.md [§2](CONVENTIONS.md#2-tiers)).

**Both keys declared and agreeing is silent — carrying both is fine, and this repo's own
descriptor (`tier: B` + `exposure: released`) models exactly that**, deliberately, so the
self-audit keeps exercising the legacy path. **Both declared and DISAGREEING about gate
count is exactly one finding** naming the disagreement (`tier: A` is consistent only with
`exposure: released`; `tier: C` only with `exposure: live`; `tier: B` is consistent with
every value, because a bare `B` never had an opinion to contradict).

Why `tier → exposure` is a **function, not a bijection** — `A → released` holds, but
`released → A` does not: `released` covers two legal shapes, a tag deploying to a live
server (the historical `tier: A` shape) and adopters copying files out of a tag with no
server at all (this repo's own shape). A descriptor that answers with `exposure` is
answering a strictly more precise question than one that only ever answered with `tier`,
which is why it is trusted first. Full precedence code and rationale:
`tools/lib/axis-authority.js`.

**Which axis actually governs `trunk`, `production` and `deploy`, below.** The three
fields that follow are worded in `tier`'s vocabulary because that was, historically, the
only axis that constrained them, and the wording is kept for the descriptors that still
speak only `tier`. But the rule that is actually enforced is dispatched by axis of
record, not always by `tier`: on a descriptor that has declared `exposure`, the
tier-voiced coherence checks below **do not run at all** — `exposure`'s own gate-contract
table, in [`exposure`](#exposure--optional) below, is what governs trunk shape,
`production`'s non-null-ness, and `deploy`'s legal values instead
(`tools/lib/exposure-shape.js`, consumed by both the audit and `colab adopt`; the split
point is `tools/lib/axis-authority.js`, whose own comment names it: "Runs ONLY on the
tier-legacy path"). Read `trunk`/`production`/`deploy` below as the **legacy** shape, and
`exposure`'s table as the current one when that key is declared.

### `trunk` — required

The branch sessions merge into. `main` when `tier: B` — fixed, there is no
second branch to distinguish it from. On `tier: A` it is `dev` **or**, when
`deploy: tag`, `main` (see the exception below) — also fixed, for the same
reason as B outside that one exception. Any other value on B or (outside the
tag-gated exception) A is a finding.

**On `tier: C`, `trunk` is a declared setting, not a fixed spelling (#205).**
What is enforced is the **two-branch split**, not the name: `trunk` must be a
branch distinct from `main`, the release branch the promotion deploys to.
`dev` is the **default** — the value `colab adopt` and the templates propose
when nothing is said — but a repo that declares a different name (`develop`,
say) is **conforming, not exempted**: no advisory, no "legacy" framing. It
answered the question the same way `dev` would have. This is deliberately
narrower than "any name is legal" — Tier B and (non-tag-gated) Tier A keep a
single fixed value each, because there either is no second branch at all, or
the tag itself already marks the release boundary. Only the one-gate shape
(Tier C) has a second branch whose *existence*, not its *spelling*, is what the
model measures. `tools/lib/exposure-shape.js`'s `evaluateLive` and
`audit/audit.mjs`'s tier-C coherence check are the two places this is enforced;
they agree by construction, not by two authors reading the same prose.

This holds for hand-deployed Tier A repos too (`deploy: manual`), and the shape
earns its keep there rather than being ceremony: `main` is **what is currently
running on the host**, `dev` is where sessions land, and the `dev` → `main`
promotion is the deliberate "I am about to deploy" act. Without automation,
that merge is the only record of what shipped and when — collapsing the two
branches would erase it.

Tier C keeps the identical split for the identical reason, whatever its trunk
is named. There `main` is literally what is live — the promotion deploys it —
so collapsing the branches would remove the only moment at which anyone
decides to ship.

**The exception: a tag-gated Tier A may run a single trunk `main`.** When
`deploy: tag`, the **tag** is the deliberate release artifact, so the tag itself
marks the release boundary — the last `v*.*.*` is "what shipped and when", the
job the `dev` → `main` split does on a hand-deployed repo. A second branch
marking the same boundary is then redundant, so such a repo may land day-to-day
work on `main` and cut releases by tag (a release script fast-forwards a
long-lived release branch an external poller redeploys, or a workflow ships on
the tag). The tier is defined by the promotion **gate** — a version tag — not by
the trunk **name**. This applies **only** to `deploy: tag`: `manual` and
`push-main` have no tag to mark the boundary, so they keep the `dev`/`main`
split, and `main` on either of those is still a finding.

### `production` — required

The production URL as a string, or `null`. Must be non-null when `tier: A` or
`tier: C`, `null` when `tier: B`.

### `deploy` — required

**How** the repo reaches production — never **whether** it is Tier A. The tier
test is "does a deploy target exist today?" ([CONVENTIONS.md §9](CONVENTIONS.md#9-adopting-this));
`deploy` only describes the mechanism a Tier A repo uses.

- `tag` — pushing a `v*.*.*` tag deploys. The tag's path to production must be
  committed: either an **in-repo deploy workflow** (`.github/workflows/deploy-*.yml`
  firing on the tag), **or**, when an **external** deployer ships it — a GitOps
  poller that fast-forwards a release branch on the tag, with no in-repo workflow
  by design — a [`runbook:`](#runbook--required-when-an-out-of-ci-deploy-has-no-workflow)
  documenting that path.
- `manual` — production exists, but shipping is a **human running a documented
  procedure** (rsync + `docker compose up -d --build`, an upload, a console
  action) with no workflow and no tag trigger. Requires [`runbook:`](#runbook--required-when-an-out-of-ci-deploy-has-no-workflow).
- `none` — nothing deploys. Required value for `tier: B`. Names the absence of a
  **promotion trigger**, never the absence of anything that runs this code anywhere —
  that question is [`channels`](#channels--optional).
- `push-main` — a push to `main` **is** the deploy. The required value for
  [`tier: C`](#tier--optional-legacy), and a finding on `tier: A` — see below.

`push-main` describes a real mechanism truthfully: for the repos using it,
pushing `main` really does deploy. It has a home — **tier C is exactly this
shape** — and the finding is on the **combination** `tier: A` + `push-main`,
never on the value itself.

**It is a tier mismatch, not a bad way to deploy.** Deploying on a `main` push
is a reasonable choice for plenty of software. What it cannot do is meet Tier
A's contract, which is that a **deliberate release artifact gates production**
— promote code now, decide to ship it later ([§6](CONVENTIONS.md#6-releases)).
Where every push to `main` reaches users, there is no such artifact and no such
gate, so a repo claiming Tier A is claiming a guarantee its pipeline does not
provide. Options:

1. **Retier to `C`** — usually the right answer. Tier C *is* this shape, so
   nothing about the pipeline changes; the descriptor simply stops claiming a
   gate that was never there. This is the option that did not exist when the
   finding was first written.
2. **Migrate the pipeline to a tag trigger** → `deploy: tag`, staying tier A.
   Choose this when the site has earned a release ritual someone will actually
   honour.
3. **If shipping really is run by hand**, say so → `deploy: manual` plus
   [`runbook:`](#runbook--required-when-an-out-of-ci-deploy-has-no-workflow). Not a downgrade — an
   accurate description, which is always worth more than a flattering one.

A tag ritual nobody honours is worse than no tag ritual: it puts a gate in the
docs and not in the pipeline, and then people trust the docs.

`manual` exists because the alternatives were both false. A hand-deployed live
repo declaring `deploy: tag` fails the deploy-workflow rule; declaring `tier: B`
forces `production: null`, which states that a live product does not exist. A
repo whose documentation lies is the outcome this handbook exists to prevent
([§8](CONVENTIONS.md#8-conformance-and-reconciliation)), so the vocabulary has
to cover the case honestly.

**`manual` grants no automation.** It is strictly *less* automated than `tag`,
and the permission ladder treats it that way: `colab promote` allows an
unattended promotion only on a `deploy: tag` repo, where promotion is
verification-only. On a `manual` repo, promotion is the deliberate "I am about
to deploy" act, so it needs `COLAB_HUMAN=1` — exactly like `push-main`, and
`promotion: main-loop` cannot lower it. See [`promotion`](#promotion--optional).

### `runbook` — required when an out-of-CI deploy has no workflow

```yaml
runbook: docs/deploy.md
```

Repo-relative path to the committed document describing how production is
reached: the hosts, the commands or the external system, the order, and how to
verify it worked. The audit checks that the path actually exists.

Required in the two cases where the deploy runs **outside** CI, so no workflow
file documents it:

- `deploy: manual` — a **human** runs the procedure. Always required.
- `deploy: tag` **with no in-repo deploy workflow** — an **external** deployer
  runs it (a GitOps poller fast-forwards a release branch on the tag). Required
  there because the tag's path to production is otherwise written down nowhere. A
  `deploy: tag` repo whose own CI holds the deploy job documents itself in that
  workflow and needs no runbook. On route `deploy-tag-fast` that workflow is the
  release workflow itself — its `deploy` job ships the final the cut tagged, since
  a tag pushed with `GITHUB_TOKEN` starts no `deploy-*.yml` — so it counts as the
  in-repo deploy path the same way (#454).

It is required because an out-of-CI deploy nobody wrote down is how a repo ends
up with exactly one person — or one poller nobody can find — able to ship it.
Automated in-repo deploys document themselves in the workflow file; anything else
has to be written down or it is not knowledge, it is folklore. Omit the key when
an in-repo deploy workflow already answers "how does this reach production?".

### `stack` — required

**Free-form string.** Describe the repo honestly: `laravel-inertia`,
`capacitor-vite`, `astro-static`, `go-cli`, … There is no fixed list — a closed
enum was tried and immediately failed on a repo that fit no bucket. Used by
humans and agents for orientation, never for machine dispatch.

### `integration` — optional

```yaml
trunk: dev
integration:
  - v2          # a long-lived line; it merges into trunk by hand, when it is ready
```

Additional **long-lived integration branches** — lines that accumulate work for a
release far enough out that they are not merged into trunk for weeks. Empty and
absent are the same thing, and absent is the normal case.

Declaring a line does three things and no more: `colab worktree new --base <line>`
will cut from it, `colab ship` merges a worktree back into **the base it was cut
from**, and the line is guarded and exempted the way trunk is (no raw pushes, no
branch-name regex, not a "ghost" when a workflow names it).

**Why this is not `trunk`.** The tempting alternative is to let a repo declare its
long-lived line as trunk and be done. That does not stay on the development side of
the fence: on Tiers A and C, `trunk` **is** the production spine — it is the branch
`colab promote` merges into the release branch. Naming the line as trunk points the
promotion path straight at it, which is the opposite of the intent. So `trunk` stays
tier-locked ([above](#trunk--required)) and this is a separate axis.

**The guarantee: nothing in the promote / tag / deploy path reads this field.** A
branch on this axis cannot reach production by construction, not by discipline. The
only way work on a line reaches users is for a human to merge that line into trunk
and then promote — and `colab ship` refuses the line → trunk merge even under
[`autonomy: auto-trunk`](#autonomy--optional), because a long divergence meeting the
branch that promotes is an integration event of the same weight as a promotion.

Validity: an entry may not be `trunk`'s value, may not be `main` (the release branch
on Tiers A and C, the trunk on Tier B), may not be the word `trunk` (a role, never a
branch name), and **must exist as a branch**. A declared line nobody ever cut is the
same failure as a release branch nothing consumes, so the audit reports it.

CI on a line is checked but **advisory**: a line with no workflow triggering on push
to it gets a warning, never a failure. Merges into it really do run zero CI, which is
worth saying — but a line that is not yet gated is a normal early state, and failing
the repo for it would push teams back to declaring the line nowhere, which is the
state this field exists to end. Trunk's CI gate remains a hard requirement.

### `releaseBranch` — optional

```yaml
tier: A
trunk: main       # single-trunk, tag-gated — see trunk's exception above
deploy: tag
releaseBranch: release
```

Names the long-lived branch an **external GitOps poller** fast-forwards on release, in
the single-trunk, tag-gated shape ([`trunk`](#trunk--required)'s exception): day-to-day
work lands on `main`, and a release script cuts a tag and fast-forwards this *separate*
branch, which the poller watches and redeploys. Empty and absent are the same thing,
and absent is the normal case — most Tier A repos deploy from `main` itself and need no
extra name.

**This is the opposite axis from [`integration`](#integration--optional), not a
variant of it.** An integration line *accumulates* development work over weeks; a
release branch is *consumed* — a release script overwrites it wholesale on every tag —
and it is a **production** ref, exactly the thing `integration:` guarantees never to
touch. A worktree may never be cut from it or shipped into it; declaring one here grants
no such base (it is not added to the set [`allowedBases`](#integration--optional)
computes).

**Why it exists:** between releases, this branch is by construction an ancestor of
trunk — it was fast-forwarded to trunk's tip as of the last tag, and trunk has since
moved on. That is indistinguishable, by ancestry alone, from a spent session branch
whose work already landed — which is exactly what `colab doctor`'s routine-maintenance
list hunts for. Undeclared, `doctor` prints a ready-to-paste `git push origin --delete`
for a ref a live deploy pipeline is polling; declaring it here is what lets `doctor`
tell the two apart (issue #63).

Validity: an entry may not be `trunk`'s value, may not be `main`, may not be the word
`trunk` (a role, never a branch name), and **must exist as a branch**. Same fail-closed
rule as `integration:` — a malformed entry is dropped rather than honoured, and the
audit reports it as a finding rather than silently leaving the real branch unprotected.

### `owner` — optional

```yaml
trunk: fleet/integration   # the fleet's own integration branch
exposure: self
owner:
  branch: master           # required when the block is present
  remote: origin           # optional; the repo's own remote when absent
```

For a repo the fleet builds in but **does not own**
([CONVENTIONS.md §9, *Working in a repo you don't own*](CONVENTIONS.md#working-in-a-repo-you-dont-own)).
It names the **owner's branch**: the one only the owner merges into. Absent is the normal
case, and absent means today's behaviour, byte for byte (#394). `colab adopt --local` writes
the block when it detects the owner's default branch, and never overwrites a declared one (#405).

What it changes, and what it does not:

- **Per-issue landing is unchanged.** `colab ship` keeps squashing each branch onto
  `trunk:`, closing its issues and releasing its claims. `trunk:` stays the fleet's
  integration branch.
- **The owner's branch is reached by one pull request, never by a push.** `colab deliver`
  opens (or refreshes) a single PR from `trunk:` to `owner.branch`, listing the commits and
  issues it carries, and stops. The owner merges it by any method. The PR is batch-shaped:
  everything landed on trunk since the last delivery, not one PR per issue.
- **Delivered is read from PR state, not ancestry.** A merged delivery PR counts whether the
  owner used a merge commit, squash or rebase; the next `colab deliver` treats that PR's
  head as the boundary and offers only what landed after it. A PR the owner closed unmerged
  is reported as a rejection, and nothing new is opened without `--reopen`.
- **No colab command moves `owner.branch`.** `ship`, the ship batch and `promote` refuse a
  push to it, whatever the grant — `COLAB_HUMAN=1` does not lower this. A worktree may not be
  cut from it even if `integration:` lists it.
- **A write to the owner's repo needs a human.** Opening or editing the PR requires
  `COLAB_HUMAN=1`; `colab deliver --dry` only reads, so a scheduled driver may run it and read
  the state (`waiting-on-owner` / `nothing-to-deliver` / `ready` / `rejected`), and never
  acts on the owner's branch unattended.
- **The core-path rule stays on top.** A branch touching a CODEOWNERS path still needs a
  non-author approval before `colab ship` lands it on trunk ([`CONVENTIONS.md` §4](CONVENTIONS.md#4-branches-and-commits), #350).

**Why `owner`, not `upstream`:** "upstream" already means something else twice — a
consumer filing a changed convention meaning back to the handbook
([CONVENTIONS.md §8, *Upstream*](CONVENTIONS.md#upstream--a-consumer-that-changes-what-a-convention-means-files-it-here-362)), and git's tracking ref. A third
meaning of the same word would be misread.

Validity: `branch` is required and is not the word `trunk`; only `branch` and `remote` are
defined sub-keys; `branch` may not equal `trunk:`, appear in `integration:`, or equal
`releaseBranch:`. `colab deliver` supports only the case where the owner's branch lives on
the same remote trunk is pushed to (a fork delivery is refused, not guessed). A malformed
block fails closed: every branch-moving push refuses until it is fixed.

### Per-host deploy target — deliberately not a field

Not modeled here, on purpose ([CONVENTIONS.md §2](CONVENTIONS.md#2-tiers)). "Which branch does
*this checkout* serve" is a fact about one machine, not about the repo — the opposite of
everything else on this page — so it holds no key in this file, on any tier.

A repo running on more than one host may legitimately want a different answer per host: a dev
tool serving a built bundle out of its own working tree, rebuilt and restarted whenever *that
host's* line moves, gated on `HEAD` matching what that host serves. That fact belongs to a
per-host mechanism the repo owns — an environment variable read by the host's own service
definitions, or a machine-local config file — the same shape as `colab`'s own cache
(`~/.colab/state.json`: local, uncommitted, fenced off from VCS and file-sync) rather than a
schema entry. Putting it here instead (`deploys: { <host>: <branch> }`) would put hostnames into
a shared, often-public file that drifts the moment a machine is renamed or retired, with nothing
here able to tell a stale entry from a live one. `integration:` does not cover it either — it
declares that a line *exists*, never that a given checkout *serves* it.

Whatever mechanism a repo picks, it must **name** the branch it serves, unset-by-default, and
never widen or disable the gate it overrides — see [CONVENTIONS.md §2](CONVENTIONS.md#2-tiers)
for why that direction is the only safe one. `trunk:` and `integration:` keep answering only the
correctness question — what has landed, what is safe to delete, what a new worktree is cut
from; this axis never reads them and they never read it.

### `ports` — optional

```yaml
ports: [5220]
```

TCP ports reserved for this repo's **trunk dev server(s)**. The `colab` CLI
aggregates `ports:` across all registered repos into the machine-wide reserved
set and will never allocate these to a worktree — even when the trunk server is
currently down. One declaration here replaces any hand-maintained central list.

Omit if the repo has no dev server (CLI tools, libraries).

### `worktreePorts` — optional

```yaml
worktreePorts: [47150, 47199]
```

A two-element `[lo, hi]` range naming the window that **worktrees of this repo**
allocate ports from. Distinct from `ports:` — those are the repo's *reserved trunk*
ports (never handed out); `worktreePorts` is where `colab worktree new` /
`colab port alloc` *search* for free ones when working on this repo.

Precedence when allocating: explicit `--range`/`--at` flag > this field > the
machine-global `config.portRange`. Malformed values fall through to the default.
Keep the window disjoint from every repo's reserved `ports:` — the allocator
refuses reserved ports anyway, but a disjoint window avoids churn. Parity/pairing
schemes are not expressed here; use `--at` or a `post-create` hook.

### `autonomy` — optional

```yaml
autonomy: auto-trunk     # manual (default) · auto-trunk
```

How much of a session's Phase B (merge to **trunk**) an agent may perform alone.

- `manual` (or absent) — an agent stops after Phase A; a human triggers the merge.
  **One exception, computed rather than declared (#345):** a change `colab ship`
  measures as documentation only passes the autonomy gate without this grant —
  [CONVENTIONS.md §2, *Autonomy — the docs-only exception*](CONVENTIONS.md#autonomy--the-docs-only-exception-345).
  No value of this field, or of any other, widens what counts as documentation.
- `auto-trunk` — an agent may complete the trunk merge itself **through `colab ship`
  only**, and only when every precondition passes: trunk CI alive and green, no new
  DB migrations in the branch, no hand-code conflicts after sync-regen. Any ✗ falls
  back to asking a human.

This grants **trunk** autonomy only — never promotion, a tag, or anything that
deploys; the field cannot express otherwise. Promotion follows
[`promotion`](#promotion--optional) and `deploy`; a tag follows
[CONVENTIONS §6's release routes](CONVENTIONS.md#6-releases). The grant lives in the repo file (not the caller's flags) so autonomy is
a property of the repo's risk profile, reviewed in a commit like any other change.

### `ship-batch` — optional

```yaml
ship-batch: 3     # 1–3; absent or 1 = serial landing (the default)
```

How many green candidates `colab ship --batch` may land at once
([CONVENTIONS.md §4, *Batch landing*](CONVENTIONS.md#batch-landing--one-combined-run-then-a-fast-forward-373)).
An integer from 1 to 3. **Absent or `1` keeps today's serial landing exactly** — every
`--batch` call declines, and a plain `colab ship` is unchanged whatever this says. Any other
value (`0`, `4`, `2.5`, a word) fails the audit **and the CI templates' descriptor check**
(#416), and `colab ship` fails closed to serial on it: a malformed opt-in must never widen what
an unattended merge does. Failing in CI is the part that matters. The audit is something a
person runs by hand, and the fail-closed is silent. So without the CI step, an adopting repo
raised the value to 5, its CI stayed green, and every landing went back to serial until a
ship dry run noticed. A copy of the CI templates older than #416 lacks the step. Copy it in.

**Why the cap is 3, deliberately.** A red combined run lands nothing, and the members then
ship one at a time, each with its own sync run. There is no bisection step: that serial
fallback *is* the bisection, and it only stays cheap for a small N.

- **Cost of a red batch.** It grows linearly with N: the wasted combined run plus N serial
  cycles. At 3 that is four cycles, the same as a three-way bisect. At 8 it is nine, which is
  hours on a 27-minute CI.
- **Chance of a red batch.** It grows with N too: each member brings its own chance of a
  semantic conflict or a flake. So the bad case gets both more likely and more expensive at
  the same time.
- **Builds have to start again.** Trunk moving mid-run sends a batch back to be rebuilt
  ([§4](CONVENTIONS.md#batch-landing--one-combined-run-then-a-fast-forward-373), step 4).
  A wider batch spends longer being built and run, so more of its runs end up thrown away.

Raising the cap means first building what it lacks: a real bisection (split a red batch and
re-run its halves), so a red stays logarithmic rather than linear, plus eviction data from
batches of 2–3 showing how often they actually go red. Until then, a queue longer than 3
drains as consecutive batches of 3, which is still three landings per cycle instead of one.

With N > 1, `colab ship --batch <b1,b2[,b3]>` puts trunk's head plus one squash commit per
member (each with its own `Closes #N`) on `ship-batch/<trunk-sha7>`, needs **one** combined CI
run there to be green, and fast-forwards trunk to it only if trunk has not moved. Two things
must also be true, and the audit warns when either is not:

- **A CI workflow fires on a `ship-batch/**` push.** Consumer workflows must opt in — add
  `'ship-batch/**'` to a CI workflow's `push: branches:` (a copy of the current CI templates
  already does: their `'**'` covers it, #384). Without it the combined run can never
  arrive, so every `--batch` call says so and declines.
- **`autonomy: auto-trunk`.** A batch lands every member in one unattended push; without the
  grant the field is inert.

`ship-batch/` is a ref namespace `colab ship` owns: it creates, force-replaces (only within that
namespace, on a rebuild) and deletes those refs itself. Exit codes of `--batch`: `0` landed ·
`3` paused (wait on the printed run, bounded, then run the same command again) · `4` declined —
nothing landed, ship the members one at a time.

### `migrations` — optional

```yaml
migrations: [backend/migrations/]   # repo-relative prefixes; absent = the two defaults alone
```

Where this repo's migrations live, **beyond** the two layouts every reader already knows —
Laravel `database/migrations/` and Prisma `prisma/migrations/`, both matched anywhere in the
path. `colab ship`'s no-new-migrations gate
([CONVENTIONS.md §5, *Migration exemption*](CONVENTIONS.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402))
and `colab release cut`'s `schema-additive` check read this one list (`tools/lib/migration-paths.js`);
neither keeps a regex of its own. **Absent changes nothing** — a repo that declares nothing is
gated exactly as before.

Without it, a repo whose migrations live anywhere else (a Node service's boot migrations in
`backend/migrations/`, a Go service's `migrations/`) is invisible to the gate: `colab ship --dry`
reported `no new migrations ✓` on a branch adding a production data backfill, and the human-only
grant never engaged. Measured on an adopting repo before this key existed.

- **Entries are repo-relative directory prefixes**, matched from the repo root. `./` and a
  missing trailing `/` are normalised away; an absolute path, a `..`, a glob, or the repo root
  itself is a finding — a prefix match would silently mean something other than what was written.
- **Additive, never a replacement.** The defaults always apply; restating one is harmless (an
  advisory). There is deliberately no opt-out of the defaults: an opt-out can only make a
  human-only gate see *less*, and that waits for a repo that genuinely needs it.
- **Ship reads trunk's declaration and the branch's, unioned.** A branch that adds its own
  declaration is gated by it; a branch that deletes trunk's is still gated by trunk's.
- **`release cut` reads `.php`/`.sql` under a declared prefix** with the same destructive
  heuristic as the defaults. A declared migration in any other format (`.mjs`, `.go`) is *named*
  in the check's detail — the heuristic cannot read it, so the §6 judgement owes it a human read —
  never folded silently into "none destructive".
- **The audit reports a tracked `*/migrations/` directory no rule covers** (advisory, local
  audits only): the likely undeclared layout. A `docs/migrations/` upgrade guide is a false
  positive only a human can tell apart; committed dependency trees (`node_modules/`, `vendor/`)
  are skipped.

### `migration-grant` — optional

```yaml
migration-grant: human      # absent = human — today's behaviour
migration-grant: reviewer   # a migration-reviewer grant may also be minted
```

This key decides who may open the no-new-migrations door
([CONVENTIONS.md §5, *Migration exemption*](CONVENTIONS.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402)).
`human` accepts only the human grant. `reviewer` also lets `colab migration-grant --role
migration-reviewer` mint a grant that carries a review record and is bound to one HEAD.
The one reading is `tools/lib/migration-grant.js` `parseGrantPolicy`.

- **It is a separate flat key, not nested under `migrations:`.** `migrations:` stays a list
  of path prefixes because three readers depend on that shape. Where the gate looks and who
  may open it are unrelated settings.
- **Only the trunk checkout's value counts.** `colab migration-grant` reads the checkout,
  never the branch, so a branch cannot raise its own policy.
- **An invalid value falls back to `human`.** That is the stricter reading, and the audit
  fails it.
- **`colab ship` honours a reviewer grant only with P + M + HEAD + R** (#401). Ship reads
  this key at the tip of the branch being merged into, and also needs a passing review
  record bound to the branch's exact HEAD, plus a live, passing `Migration round-trip`
  CI job on that HEAD. See [CONVENTIONS.md §5, *Migration exemption*](CONVENTIONS.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402).
  A repo with no such job can declare `reviewer`, but every reviewer grant there fails R.
- **The audit always reports the value.** It appears in `--json` as `migrationGrant`.

### `trust-humans` — optional

```yaml
trust-humans: [operator-login, second-operator]   # absent = the association class decides
```

This key names the logins that count as **human** for a grant (`migration-granted`,
`ci-granted`) or a ruling (`⚖ Decision recorded`)
([CONVENTIONS.md §5, *Migration exemption*](CONVENTIONS.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402)).
Declare it when your agents run under their own GitHub account. The association class
(`OWNER`/`MEMBER`/`COLLABORATOR`) cannot tell that account from a person, so without the
list an agent-posted grant reads as a human's. The one reading is
`tools/lib/trust-humans.js` `parseTrustHumans`.

- **Absent → nothing changes.** A trusted association counts as human, as before.
- **Declared → only listed logins are human.** A grant or ruling by any other author is
  refused, and the reason names the login. The author must also still hold a trusted
  association. For the two grant labels, the account that last applied the label must be
  listed too. Logins compare case-insensitively.
- **Read from the target, never the branch.** `colab ship` reads it at the tip of the
  branch being merged into; rulings read trunk's. A branch that adds its own author changes
  nothing for its own ship. Editing the list is a human act, like lowering exposure.
- **A reviewer grant is not judged by it.** A `migration-reviewer` grant passes or fails on
  its own four conditions. The list only decides what a *human* grant is.
- **A flat key holding a list, not `trust: { humans: … }`.** The audit's descriptor reader
  refuses nested shapes on purpose, and a list inside a map is one of them. Both list
  spellings work: `[a, b]` or a `- a` block sequence.
- **A malformed value means nobody is human.** An empty list, a non-list, or an entry that
  is not a GitHub login blocks every human grant and ruling until it is fixed, and the audit
  fails it. Falling back to the association class would quietly reopen the hole the key
  was declared to close.
- **The audit always reports the value.** It appears in `--json` as `trustHumans`
  (lowercased), or `null` when absent or malformed.

### `room` — optional

```yaml
room: solo     # one human — and every agent that human starts
room: team     # several people in one org, who may disagree or take over
room: public   # people outside the org, with no shared context and no way to ask
```

Who else could ever read what a session writes down here
([CONVENTIONS.md §2, *Room*](CONVENTIONS.md#room--who-else-is-here)). It decides what an
Issue is *for* (memory for `solo`, coordination for `team`, documentation for `public`),
which language it is written in, and whether "a human performs the release" names a role
or only names a species. Replaces two things that were proxying it by coincidence: Issue
language derived from repo privacy, and `ceremony` standing in for "will anyone read the
audit trail."

**Omission means undeclared, not `solo`.** Nothing infers a repo's room from its GitHub
visibility, its `production:` value, or anything else — a wrong inference here is worse
than an honest "not yet answered." The audit enum-checks the value for typos exactly like
`ceremony`/`writes` do, and nothing more: no downstream rule reads `room` yet. A later unit
may add one; until it does, this field is a fact a human writes down, not a fact anything
derives or verifies.

### `branchPrefix` — optional

```yaml
branchPrefix: machine   # colab worktree new cuts <login>/<machine>/<type>/<slug>-<N>
```

Whether session branches carry the account and machine that cut them
([CONVENTIONS.md §4](CONVENTIONS.md#4-branches-and-commits)). One value today, `machine`;
**absent means the unprefixed `<type>/<slug>-<N>` shape**, which stays conforming either way.
With it declared, `colab worktree new` takes the ordinary §4 name and prepends
`<login>/<machine>/` itself — the login from the forge (`gh api user`), the machine label from
the host's name — so the branch it pushes at cut names who holds the claim, readable from the
ref alone by any other machine.

**Why a descriptor field, not a flag:** the pushed branch is a claim record every machine
reads, so whether it carries the prefix has to be the same answer for every session in the
repo. A per-call flag would depend on every skill and every human remembering to pass it.

Readers never need this field: both shapes parse everywhere, because the issue numbers stay in
the trailing `-<N>` run and the prefix is at the other end. The machine label is a **label**, not
an identity — two hosts with the same short name share it; claim comparisons stay on the
per-machine identity `colab` already records. The audit enum-checks the value, nothing more.

### `holds` — optional

```yaml
holds: [hold:manual, needs-rescope]   # labels this repo's scheduler treats as start holds
```

The labels, beyond the handbook's own start gates, that this repo treats as **start holds**
([CONVENTIONS.md §5, *Holds*](CONVENTIONS.md#holds--every-label-that-stops-a-start-names-its-owner-and-its-wake-360)).
`code-triage` reads the list and reports an issue carrying any of these labels as blocked,
never ready. So its READY list matches what the repo's scheduler would start, and nobody
has to guess a hold from its name. **Absent means none declared.** A label not in the
list is not a hold to triage, whatever it is called.

Declaring a label here does not relax the rule every hold follows: the issue still names
an owner and a wake condition in a `Hold:` line when the label goes on. Nor does it add
the label to the convention set. These names stay the repo's own, and `colab labels
--ensure` never creates them.

The audit checks the shape only: a list, and each member a non-empty string listed once.
It does not check whether the labels exist on the tracker.

### `exposure` — optional

```yaml
exposure: none       # nothing consumes a merge here
exposure: self       # only parties already in the room — a subset of the room's collaborator set
exposure: live       # users, via the promotion itself
exposure: released   # users or adopters, via a deliberate artifact (a tag, a runbook)
```

What consumes a merge here — as of **#144**, the AXIS OF RECORD for gate count when
declared (CONVENTIONS.md [§2](CONVENTIONS.md#exposure--what-consumes-a-merge-here), "Exposure — what consumes a merge here?"; [`tier`](#tier--optional-legacy)
above states the full precedence). **This is the breaking change of the major version**: a
descriptor that opted into `exposure` during phase 1 (additive, inert) now has a
LOAD-BEARING key — declaring it drives the trunk-shape/deploy-path/production-non-null
rules directly, in `exposure`'s own vocabulary, rather than `tier`'s. A repo that has
**never** declared `exposure` sees zero change: the legacy `tier` read reproduces
pre-#144 behaviour byte for byte, including every outside adopter of this public repo who
has not opted in — verified empirically (a fleet-wide byte-diff), not merely designed for.

**The gate contract, once `exposure` governs** (`tools/lib/exposure-shape.js` is the one
executable version of every rule below, shared by the audit and by `colab adopt`'s own
"can this repo declare that value" check — read it, not this prose, if the two ever
disagree):

- `none` — `trunk: main` (nothing consumes this repo, so there is no release branch to
  speak of) **and** no committed deploy workflow — one existing alongside `none` is a
  contradiction (nothing is supposed to consume this repo, yet something is wired to
  deploy it), beyond the pairing advisory below.
- `self` — **no mechanism or contract rule at all, not even trunk shape.** Its consumer
  set is a subset of the room's ([`room`](#room--optional)), so policing its
  deploy/production/trunk shape is out of scope by design.
- `live` — `trunk` distinct from `main` (the two-branch split, `dev` by default — see
  [`trunk`](#trunk--required); NOT a fixed spelling, #205), a non-null `production`,
  `deploy: push-main`, and a committed `deploy-*.yml` workflow. Keeps the old tier C
  contract's no-runbook asymmetry: there is **no `runbook:` escape hatch** for `live` — a
  deploy workflow must actually exist.
- `released` — **two legal shapes, told apart by whether `production` is set.**
  - **Shape 1 — `production` non-null.** Mirrors the old tier A contract: `deploy` must be
    `tag` or `manual` (never `push-main` — every push reaching users with no release
    artifact gating it is the `live` shape, not `released`; never `none` — contradictory
    with a live URL), a committed deploy path exists (a workflow, or a `runbook:` when the
    deploy runs outside CI: `deploy: manual`, or `deploy: tag` with no in-repo workflow),
    and `trunk: dev` — **or**, only when `deploy: tag`, `trunk: main` (the identical
    tag-gated single-trunk exception [`trunk`](#trunk--required)'s own section states).
  - **Shape 2 — `production: null`, new in #144.** `trunk: main`, and `deploy` absent or
    `none` — nothing is live, so there is neither a release-branch split nor a deploy
    trigger with anything to gate. Evidenced instead by a version-shaped git tag or
    `channels: [artifact]`: adopters consume a release even though there is no server.
    This is this repo's OWN shape, and the old `tier: B` weld could never express it
    (`tier: B` forbade a non-null `production` AND required `deploy: none`, but had no
    vocabulary for "released to adopters, no server").

`self` is defined against the [`room`](#room--optional) axis: the consumer set is a subset
of the room's collaborator set — that definition points at nothing until `room` exists,
which is why exposure was sequenced after it. Why `prelaunch` was rejected in favour of a
relationship word, the old→new mapping from `tier`, and the reasoning behind the
`production:` pairing rule below all live in CONVENTIONS.md [§2](CONVENTIONS.md#exposure--what-consumes-a-merge-here), "Exposure" — read there for
the argument; this page states the field.

**The `production:` pairing advisory.** `exposure` and `production` are two flat sibling
keys, read independently; there is no nested or paired syntax. `exposure: none` **and**
`production: null` together — the claim that both nothing consumes this repo and there is
nothing to point at — is an advisory. It is a `warn`, never a `fail`: the descriptor is not
lying, it is unanswered, and answering it is a human act
([CONVENTIONS.md §2, *Exposure*](CONVENTIONS.md#exposure--what-consumes-a-merge-here)) — a
`fail` here would make declaring the key riskier than omitting it. Every other combination
is clean, including `live`/`released` **with `production: null`** — a repo that ships by tag
to real adopters and runs no server (this repo is exactly that shape) is not a finding; a
rule that made it one would re-assert the "exposure means a server" defect this axis exists
to remove.

**The falsifier and duration report (#137).** The pairing advisory above is
descriptor-internal; it cannot confirm or deny a "nothing consumes this" claim against the
outside world. `exposure: none` additionally gets **evidence falsification**: the audit
looks for a version-shaped git tag, or a committed deploy path (a `deploy-*`/`release-*`
workflow, or a `deploy`/`release` script at the repo root/`scripts/`/`bin/`) — cheap
repo-local artifacts that usually accompany a consumer. Finding one is a `warn` naming the
evidence, never a `fail` — a repo released years ago and dead since is truthfully
`exposure: none` today, tag and all, so this is a prompt to look again, not a contradiction
proven. Alongside it, a **duration report**: how long the current value has held, computed
from the descriptor's own git history (never a new field), silent under roughly six months
and degrading to a lower bound ("at least N months") when the exact origin is not visible.
Both are gated on `exposure` being exactly `"none"` — every other value, including
undeclared, triggers neither and does no new IO. `exposure: self` gets neither: it claims a
consumer set bounded by the room, and a tag or deploy script is perfectly compatible with a
team shipping to itself. Full falsifier set, what shipped and what did not, and why:
`audit/README.md`.

**Omission means undeclared, not `none`.** Nothing infers a repo's exposure from its GitHub
visibility, its `production:` value, its `tier`, or a deploy workflow — a wrong inference
here is worse than an honest "not yet answered," and it is the concrete mechanism behind
"lowering a repo's exposure is a human act, with no field that can override it": the only
path to a `none`/`self` value is a human committing the string, because every candidate
value for an undeclared repo is a claim about the *absence* of a consumer, which nothing here
can verify. Raising exposure (proposing `live`/`released` from a committed `production` URL
or a deploy workflow) is a narrower claim an agent may propose; lowering it never is. The
audit enum-checks the value, pairs it with `production:` as above, and — as of #144 — drives
the gate contract itself when declared. **`exposure` is now coupled to `tier` in exactly one
sense: when BOTH are declared and disagree about gate count, that is a finding** (`tier: A`
is consistent only with `exposure: released`; `tier: C` only with `exposure: live`; `tier: B`
is consistent with every value). It is still true that nothing INFERS `exposure` from
`tier`, GitHub visibility, or a deploy workflow — the asymmetry [`writes`](#writes--optional)
also carries ("do not add one") is about inference, not about disagreement between two
values a human wrote down separately. CI role and thoroughness and the
rollback obligation are now derived from it
([CONVENTIONS.md, CI](CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure);
[CONVENTIONS.md, Recovery](CONVENTIONS.md#recovery--what-must-exist-to-undo-a-merge)).
`exposure` otherwise stays a declared fact whose only enforced consequence is the one
advisory above.

### `channels` — optional

```yaml
channels: [none]                    # nothing runs this code anywhere
channels: [workflow]                # merge -> CI -> a deploy workflow
channels: [hook]                    # a git hook, in-repo or installed locally, fires on a git act
channels: [procedure]               # a human builds/installs/restarts from a checkout, by a documented procedure
channels: [checkout]                # a per-machine service definition serves the working tree directly
channels: [artifact]                # a tag or package that adopters/others consume
channels: [data]                    # the process is local; the effect lands in another system's production data
channels: [workflow, hook]          # several channels at once — the reason this key is a LIST, not a scalar
```

By what path a commit reaches something that *runs* it — a different question from
[`deploy`](#deploy--required), which names only the trigger that promotes to production
(CONVENTIONS.md [§2](CONVENTIONS.md#channels--by-what-path-does-code-reach-the-thing-that-runs-it), "Channels — by what path does code reach the thing that runs it?").
**Strictly additive in this unit**: a new key alongside `deploy`, `deploy` stays fully
authoritative, and no rule anywhere reads `channels` to change a `tier`/`trunk`/`deploy`/
`production` finding. A repo declaring nothing behaves exactly as it does today, byte for
byte, including every outside adopter of this public repo who has not opted in.

**A list, not a scalar** — the one structural difference from `exposure`/`room`/`writes`. A
repo can genuinely have several channels open at once (a reviewed deploy workflow *and* a
machine-local post-merge hook *and* a tag adopters copy out of), and a scalar would force
picking the most visible one — the exact failure that produced this axis's finding.

**Names the KIND of channel, never the machine.** "A local hook rebuilds this on merge" is
a fact about the repo; *which* machine runs the hook is not — see [Per-host deploy target —
deliberately not a field](#per-host-deploy-target--deliberately-not-a-field), the identical
ruling this key inherits rather than reopens. Machine-specific mechanism lives in a
per-host config the repo owns, never in this descriptor.

**Shape rules, the entire audit surface:**
- Always a **list**. A bare scalar is a finding naming the list form.
- Every member must be one of the seven values above. An unknown member is a finding.
- **No duplicate members** — `[workflow, workflow]` is a finding pointing at the
  deduplicated form, same severity as the other shape rules here. `[none, none]` is caught
  by this rule too (previously it was only caught incidentally, by the exclusivity rule
  below).
- `none` is **exclusive** — `[none]` alone, never combined with another kind. `[none,
  workflow]` is a finding, not a richer answer.
- `[]` (empty list) is a finding pointing at `[none]` — an empty list is not an answer.
- **Omission means undeclared, never `none`** — the identical asymmetry `exposure` carries,
  for the identical reason: declaring that nothing runs this code anywhere is a claim about
  *absence* that nothing here can verify, so only a human may write it down. An agent may
  *propose* adding a channel it found evidence for; it may never write `[none]`.

**Why `procedure` and not `manual`.** `deploy: manual` is a promotion-trigger claim (a human
runs a documented release procedure); `channels: [procedure]` is a "what runs this" claim (a
human builds/installs/restarts from a checkout). Reusing `manual` for both would restate the
same word for two different questions — exactly the conflation this axis exists to undo.
`deploy: none` names the absence of a promotion trigger; it is not evidence about `channels`
either way — three of the seven observed paths this axis was built from were found under a
repo declaring `deploy: none`, so no rule may ever conclude a `deploy: none` repo's channel
set from `deploy` alone.

**An unintended channel is a finding, never a value.** A working tree file-synced between
machines with git metadata deliberately excluded is a bug, not a deployment strategy — the
model must not normalise it into a legal member of this list. The full argument, including
what a file-synced working tree costs a repo permitting trunk-direct (⚖ #233: any repo
that does not declare `writes: isolated`), lives in CONVENTIONS.md [§2](CONVENTIONS.md#channels--by-what-path-does-code-reach-the-thing-that-runs-it),
"Channels" — read there for the argument; this page states the field.

**The descriptor-internal coherence advisory.** `channels: [none]` together with a fact
already authoritative elsewhere in the same descriptor that contradicts it — a non-null
`production:`, or a `deploy:` other than `none` — is an advisory. It is a `warn`, never a
`fail`, on `exposure`'s precedent: a `fail` would make declaring the key riskier than
omitting it. This check is descriptor-internal coherence against fields already
authoritative — it is deliberately **not** paired with `exposure`, matching
[`writes`](#writes--optional)'s own "do not add that coupling" instruction.

**The falsifier and duration report (#137).** The coherence advisory above only checks
`channels` against other fields in the SAME descriptor; it says nothing about the outside
world. `channels: [none]` additionally gets **evidence falsification** — the identical
artifact hunt `exposure: none` gets (a version-shaped git tag, or a committed deploy path:
a `deploy-*`/`release-*` workflow, or a `deploy`/`release` script at the repo root/
`scripts/`/`bin/`), because a tag is evidence against BOTH claims at once. A `warn` naming
the evidence, never a `fail`, for the identical reason. Alongside it, the same **duration
report** as `exposure`: how long `channels: [none]` has held, from git history, silent
under roughly six months, degrading to a lower bound when the exact origin is not visible.
Both gated on `channels` being exactly `["none"]`. Of the artifact classes this axis
enumerates, only a tag (`artifact`) and a committed deploy path (`workflow`) are checked
today — a per-machine service definition (`checkout`), an installed hook (`hook`), sync
membership, and a build/restart procedure (`procedure`/`data`) are each a **named,
deliberate deferral**, not an oversight: `audit/README.md` states why for each. This check
stays descriptor-internal-only in one sense and world-facing in another; it is never paired
with `exposure` regardless — no rule reads one key to decide the other's finding.

### `ci` — deliberately not a field

Not modeled here, on purpose
([CONVENTIONS.md, CI](CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)).
What CI *is* — gate or alarm — is derived from whether the unit has a branch, a fact about
the session (⚖ #233 retired the `writes`-keyed reading — a branch, not a declared value,
decides this now); how thorough it must be is derived from `exposure`. A `ci:` field would
let either drift from what already answers it, the identical failure every other axis on
this page exists to prevent.

[`gate`](#gate--optional) is not that field: it declares the fast **local** command and which
verdict the skills read (#410), never what CI is or how thorough it must be.

A repo needing something its copied workflow doesn't cover edits that file directly.
Copy-and-own already permits this, and the audit already classifies the edit as drift to
reconcile, not a violation — the same treatment [`templates/`](templates/) gives every
other stamped file. Nothing here refuses customization; it refuses a *declared summary* of
behavior the session-shape/`exposure` axes already determine.

### `ceremony` — optional

```yaml
ceremony: standard   # default; omission = standard — no existing repo changes behavior
ceremony: light      # repos where nobody in the room will comb through the trail
```

How much record-keeping DEPTH a session owes this repo — a separate axis from `tier`,
which counts gates to production ([CONVENTIONS.md §2](CONVENTIONS.md#2-tiers)), and from
`room` (who could ever read it). Tier answers "how many gates stand between a merge and
users"; `ceremony` answers "will anyone ever comb through this repo's audit trail" — two
Tier B repos can be a heavy, long-lived codebase and a disposable beta playground, and
only this field lets the second one stop paying full record-keeping cost for a record
nobody will read. Descriptive, not evaluative — like `deploy:`. It never says the code
matters less; it says the repo has opted out of audit-trail depth.

**What `light` relaxes:**

1. **Evidence & narration** — Phase B evidence comments are skipped; the squash's
   `Closes #N` suffices. Issue narration distills real gotchas only, no progress
   commentary.
2. **Readiness ceremony** — triage orders and groups but skips the `deps-checked`
   labeling pass. Coherent because `light` repos cannot be driven unattended (the
   coherence rule below), so nothing consumes the column; an empty readiness column
   that nothing reads is pure cost.
3. **Audit severity** — memory-ceremony gaps (empty readiness column, missing
   evidence, stamp drift on non-CI templates) downgrade to advisories.

**What `light` may never relax:** claim before start · branch-off-trunk & worktree
discipline · reserved ports · main checkout at rest on trunk · squash + `Closes #N` ·
Conventional Commits · CI secret scan + build. A beta repo shares the same machine,
session fleet, port space, and claim state as the most serious repo.

**Narration follows `room`; recoverability follows exposure and irreplaceable state — and
`ceremony` only ever touches the first.** A prior rule required `light` → `production:
null`, reasoning that a live repo cannot skip its own audit trail. That welded two
different questions together: whether a *trail* is ever read (the room), and what must
exist to *undo* a change (exposure/irreplaceable state) — a `solo` repo's trail has one
reader whether or not it is live, and a live `solo` repo that cannot roll back is a real
hazard regardless of how much anyone narrates. The rule forbade the first case and was
silent on the second, so a live single-operator repo could not declare `light` at all —
pushing that shape toward an undeclared, informal light mode instead. Removed (#175); the
one coherence rule that survives is the one that protects someone other than this repo's
own room:

- **`light` is incompatible with `autonomy: auto-trunk`.** An unattended merge with
  no evidence trail is a closure nobody watched and nobody can audit. A repo that wants
  unattended ships accepts `standard` — that is the trade.

**`ceremony: light` no longer, by itself, enables solo flow.** #133 introduced
`writes: serial` as solo flow's real gate and accepted `ceremony: light` as a LEGACY
proxy only, for repos that had not yet answered the `writes` question. #175 removed that
bridge. ⚖ #233 then re-based the gate itself: `colab solo` now refuses outright on any
repo declaring `writes: isolated` (the veto, human or not), and on any session that
cannot assert `COLAB_HUMAN=1` — the `writes`-keyed method distinction (`serial-direct`
vs `serial-gated`) this paragraph used to describe no longer exists, both spellings are
inert — see [`writes`](#writes--optional) below for the entry gate and the rules it
never relaxes.

### `writes` — optional

```yaml
# (key omitted)          # coexistence — the default
writes: free              # coexistence, spelled out (#283) — IS the former blank
writes: direct             # coexistence, PLUS a declared intent (#283) — declared today, runtime deferred
writes: isolated         # the veto — no trunk-direct here, human or not; NOT the default
writes: serial-direct    # inert (⚖ #233) — identical to omitting the key (reads as `free`, #283)
writes: serial-gated     # inert (⚖ #233) — its one real assertion moved to the axis that owns gating
writes: serial            # LEGACY ALIAS of serial-direct — inert, same as omitted
```

**⚖ #233 (2026-08-19): this field stopped selecting a write-conflict prevention METHOD and
became a two-state VETO.** `writes: isolated` means exactly one thing — no trunk-direct in
this repo, human or not, no field/flag/override lowers that bar. Absence, and every other
declared value (`serial-direct`, `serial-gated`, and the legacy `serial` alias — all three
now INERT, identical to absence), means **coexistence**: a worktree session and an
attended human trunk-direct session (`COLAB_HUMAN=1`, `CONVENTIONS.md` [§5, "The human
flag"](CONVENTIONS.md#the-human-flag--what-colab-human1-asserts)) run side by side. The
YAML block above is reworked by #239 to say so directly — "isolated (default)" was wrong
twice over (neither the default nor merely descriptive) — but the paragraphs and tables
below this note describe
BEHAVIOUR, and state what is true today, not the retired three-method reading.

**#283 (2026-08-27) widened the vocabulary again, without touching the two-state model
above.** `free` and `direct` are the CURRENT spellings the wizard (`colab adopt`) offers;
every pre-#283 spelling — `isolated`/`serial-direct`/`serial-gated`, plus the `serial`
alias — is still accepted and still resolves the same way. `free` is coexistence, spelled
out: it IS the state absence already named, given a name of its own because the old prompt
had to tell a human to "leave unanswered" for it. `direct` is coexistence **plus a declared
intent**: stored and reported honestly (`tools/lib/writes-authority.js`'s `writesMode`,
`tools/lib/adopt.js`'s `deriveConsequences`), but its runtime is **deferred** —
`trunkDirectVetoed('direct')` is `false`, identical to `free`, so declaring it changes no
session's actual permissions today. See `CONVENTIONS.md` §2, "writes: direct — declared
today, runtime deferred (#283)" for the four open questions this vocabulary shipped with
and how each is unblocked.

A fourth shape — many units in flight, writing trunk-direct, with no attendance and no
veto — is not legal under either state; nothing coordinates concurrent UNATTENDED
trunk-direct writers, so it stays named as incoherent (`CONVENTIONS.md` [§2](CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory), *Writes*)
and has no declarable value.

**The constraint matrix, re-based for ⚖ #233 — read this before granting anything to a
repo that does not declare `writes: isolated`.** Two columns keyed on the descriptor now,
not three keyed on a declared method — the runtime distinction moved into the rows:

| constraint | `writes: isolated` (the veto) | `free` · `direct` · absent · `serial` · `serial-direct` · `serial-gated` (coexistence) |
|---|---|---|
| trunk-direct, human at the keyboard (`COLAB_HUMAN=1`) | **forbidden** | allowed |
| trunk-direct, automated session | **forbidden** | **forbidden** |
| `autonomy: auto-trunk` | allowed | allowed |
| place-claim needed | n/a — nothing writes the shared checkout | yes, on the trunk checkout |
| branch | always | always, except an attended trunk-direct unit |
| `ceremony: light` + `autonomy: auto-trunk` | **forbidden** | **forbidden** |

**Retired: the `auto-trunk`/`serial-direct` narrative #208 and #224 argued over.** A
misgrant nobody could tell apart from `serial-gated`'s cell was the worry that motivated
splitting `serial` in the first place; #224 corrected the cell itself before this ruling
landed. Under ⚖ #233 there is only one coexistence cell, not two, so the distinction the
narrative was about no longer exists — see `CONVENTIONS.md`, *Writes*, for the one
sentence that survives it.

**Exactly two conditions make a branch mandatory** for an attended trunk-direct
session — every other kind of session (a worktree one) has a branch by construction, so
this now governs solo flow specifically: more than one unit in flight, or a gate that must
inspect a unit before it lands. "It feels safer" is not on that list. A repo where a gate
must inspect every unit says so by *having* one — a trunk-gating CI workflow, or branch
protection (`CONVENTIONS.md` [CI](CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure))
— never by a declared value; this is where the retired `serial-gated` spelling's one real
assertion now lives.

**The legacy values: `serial`, `serial-direct`, and `serial-gated` all resolve to
coexistence — none of them veto.** `tools/lib/writes-authority.js` is the ONE shared
resolver (the audit and `colab adopt` both read it, the same split
`tools/lib/axis-authority.js` draws for `tier` → `exposure`); its 3-way parse of these
spellings is UNCHANGED (still resolves `serial` toward `serial-direct`, never
`serial-gated`, for the historical reasons below), but nothing downstream treats that
parse as selecting a method any longer — both branches land on the identical veto answer
(none), so the alias question this resolver spends effort on no longer changes any repo's
observable behaviour:

1. **Byte-identical preservation, still the operative reason.** Every repo declaring bare
   `serial` today stays solo-flow-eligible (subject to attendance, ⚖ #233) — including
   this handbook's own descriptor (see this file's own `.github/project.yml`).
2. ~~**The conservative reading on the one property that is actually dangerous.**~~
   **Retired by #224**, and moot after ⚖ #233 besides: the `auto-trunk` cell no longer
   varies by which legacy spelling is declared, so there is nothing left for this reason to
   protect against.

**Reclassifying an EXISTING repo's descriptor to `serial-gated` is now presentation-only —
it changes nothing observable.** Before ⚖ #233 this was a meaningful, human-only decision
(`serial-gated` forbade solo flow outright and made every unit branch). Now it is inert,
identical to leaving the field absent or as bare `serial` — the field going fully advisory
is the next step, per the epic, once measured.

**Deliberately not coupled to `tier`, `production`, or exposure.** A busy repo with three
concurrent sessions needs a place-claim regardless of whether it has a production deploy;
a quiet repo with one session at a time does not need one merely because it is live. The
correlation seen across today's fleet is caused by *who works a repo*, not by *what
consumes it* — encoding that correlation as a rule would repeat the same weld `ceremony`
was introduced to undo. No coherence rule is audited against `tier`/`production` for this
reason; do not add one.

**No field for the place-claim itself.** The lock that a shared trunk checkout needs
(`CONVENTIONS.md`, *Solo flow* / place-claims) is a fact about one checkout on one
machine at one moment — the same reasoning that keeps `deploys: {host: branch}` out of
this schema ([§2](CONVENTIONS.md#2-tiers)) applies here: a path on one host is meaningless
read from another, so it lives in session state (`~/.colab/state.json`), never in this file.

### `promotion` — optional

```yaml
promotion: main-loop     # human (default) · main-loop
```

Who may run the **promotion** (`trunk → main`, via `colab promote`) without a
per-instance human word. Distinct from **release** (the tag), which follows exposure
([CONVENTIONS §6](CONVENTIONS.md#6-releases)): automatic candidates, and a human final
tag wherever the tag deploys production.

- `human` (or absent) — promotion needs `COLAB_HUMAN=1`.
- `main-loop` — the main loop may promote unattended, **but only on a
  `deploy: tag` repo**, where promotion is verification-only (main runs the heavy
  suite; nothing deploys). The release workflow
  ([`templates/release-auto.yml`](templates/release-auto.yml)) acts on it too (#440):
  its daily run runs `colab promote --auto`, which promotes a green trunk that is
  ahead of `main` and dispatches CI there, so the candidate is cut with no human
  step. The final tag stays a human click. Without this value, `--auto` is a no-op.

Unknown values fail closed to `human`. This field **cannot** lower the bar set by
`deploy:` — on a `deploy: push-main` repo promotion *is* the production deploy, and
on a `deploy: manual` repo promotion is the human's signal to run the deploy; both
always require `COLAB_HUMAN=1`. Only `deploy: tag` makes promotion
verification-only, so only there can `main-loop` apply. Nothing here ever
authorizes tagging.

The full permission ladder, one rung per boundary:
**ship** (branch→trunk, gated by `autonomy`) · **promote** (trunk→main, gated by
`deploy`+`promotion`) · **release** (tag — candidates automatic, final tag by exposure,
[CONVENTIONS §6](CONVENTIONS.md#6-releases)).

### `release` — optional

```yaml
release:
  route: public-tool      # none · rapid-app · public-tool · library-fast · deploy-tag · deploy-tag-fast · live
  candidates: auto        # auto · off
  candidates-per-day: 1   # optional — a positive integer; no route has a cap by default (#443)
  test-period: 3d         # <N>d — never shorter than 3d
  final: auto             # auto · human
  guard-run: node scripts/breaking-guard.mjs   # optional — a breaking-change detector (or guard-result: <file>)
  exports: api/public-symbols.txt              # optional — the committed public-symbol list
  npm: .                                       # optional — publish this package directory to npm (public-tool only)
  npm-gate: node scripts/check-pack-allowlist.mjs   # required with npm — the pack-allowlist gate
  version-source: manifest                     # optional — manifest · tag (#438)
  final-grant: 123                             # optional — deploy-tag / deploy-tag-fast only: the operator's recorded grant (#441, #446)
  health-url: https://app.example.com/health   # deploy-tag / deploy-tag-fast (required there) — the endpoint reporting the running version (#446, #452)
  rollback: auto                               # deploy-tag-fast only — the deploy rolls itself back on a failed check (#446)
  final-spacing: 1h                            # deploy-tag-fast only — minimum time between finals, <N>h · <N>d, never under 1h (#446)
```

How the **release** — the tag — runs on this repo: which
[release route](CONVENTIONS.md#6-releases) it takes, whether candidate tags
`vX.Y.Z-rc.N` are cut automatically (and, if this repo opts in, at most how many a day), how long a candidate's test period
lasts, and whether its final `vX.Y.Z` is automatic. The one block that is a nested map; the
audit's reader accepts it under this key and no other.

**Absent means the default, and the default is derived — never declared.** The route comes
from `exposure` + `deploy` (+ `production`), and each route carries its own policy, exactly
as [CONVENTIONS §6's release routes](CONVENTIONS.md#6-releases) table them:

| Descriptor | Derived `route` | May declare | `candidates` | `candidates-per-day` | `test-period` | `final` |
|---|---|---|---|---|---|---|
| `exposure: none` / `self` | `none` | `none` | `off` — no tags | — | `3d` | `human` |
| `exposure: released`, `production: null`, `deploy: none` — adopters install it | `public-tool` | `public-tool` · `rapid-app` · `library-fast` · `none` | `auto` | uncapped | `3d` | `auto` |
| `exposure: released`, `deploy: tag` — the tag deploys production | `deploy-tag` | `deploy-tag` · `deploy-tag-fast` (grant + health gate only, below) · `none` | `auto` | uncapped | `3d` | `human` — `auto` only by an operator's grant (`final-grant`, below) |
| `exposure: released`, `deploy: manual` — a person deploys from the tag | `deploy-tag` | `deploy-tag` · `none` | `auto` | uncapped | `3d` | `human` |
| `exposure: live` | `live` | `live` · `none` | `off` — the promotion is the deploy | — | `3d` | `human` |
| anything else — undeclared or unknown `exposure`, a bare `tier: B`, a `released` repo whose `deploy`/`production` match no row | none — fail closed | `none` | `off` | — | `3d` | `human` |

The two routes only a no-production `released` repo may choose, and what they change:

| Route | `candidates` | `candidates-per-day` | `test-period` | `final` |
|---|---|---|---|---|
| `rapid-app` | `auto` | uncapped | `3d`, newest clean candidate finalizes; a newer one does not restart its clock | `auto` |
| `library-fast` | `off` — the tag triggers the publish | — | none | `auto` |

And the one route a `deploy: tag` repo may choose besides its derived `deploy-tag` — only with
the operator's grant and a declared health gate (*`deploy-tag-fast`*, below):

| Route | `candidates` | `candidates-per-day` | `test-period` | `final` |
|---|---|---|---|---|
| `deploy-tag-fast` | `off` — `release cut --auto` tags the final itself | — | none — finals at least `final-spacing` apart | `auto`, on every green trunk head, deployed in the same run |

Legacy `tier: A` reads as `released` and takes the route its `deploy` names; `tier: C` reads
as `live` ([`tier`](#tier--optional-legacy)). `final` applies only to a candidate (or, on
`library-fast`, to the tag itself), so with `candidates: off` elsewhere it has nothing to act
on.

**`route` chooses; it never widens.** A declared route must be one the descriptor's row
permits (the *May declare* column). A route outside that set is a **failure**, and the
derived route stays in effect — `public-tool` on a `deploy: tag` repo would hand a
production deploy's final to a machine, and `deploy-tag` on a repo where nothing deploys
describes a repo that does not exist. If the repo really changed, change
`exposure`/`deploy` first. `none` is permitted everywhere: turning releases off is always a
narrowing.

**The other keys may narrow the route in effect, never widen it.** Each moves in one
direction only, measured against the route — declared, or derived:

- `candidates` — `auto` → `off` is a narrowing; `auto` where the route cuts none is a
  **failure**. `none`, `live`, `library-fast` and a fail-closed descriptor reject
  `candidates: auto`.
- `candidates-per-day` — a positive whole number, an **opt-in** cap. No route carries one by
  default (#443, reversing #439's derived cap of `1` on `rapid-app` and `public-tool`): the
  newest candidate always names trunk's head, and a cap of one kept four merges out of any tag
  for a day. So any value narrows. A repo that declares one still gets the guarantee: inside
  the rolling 24h window `colab release cut --auto` is a no-op, and the first run after it —
  a merge's green CI or the daily schedule — cuts **main's head**, never an older commit. On a
  route with no candidates it has nothing to cap and is a **failure**.
- `final` — `auto` → `human` is a narrowing (a no-production repo that wants a person to
  finalize each release may say so); `auto` where the route says `human` is a **failure**.
  `final: auto` on a `deploy-tag` route is never an override — where the final tag deploys
  production, no key *on its own* lowers that. The one exception is the operator's grant,
  `final-grant` below, and it is a recorded human act, not a value.
- `test-period` — a whole number of days, `<N>d`. Longer than `3d` narrows; shorter is a
  **failure**. On `library-fast` and `deploy-tag-fast`, which have no test period, it is a
  failure too.

**Three keys add evidence to the computed version, never permission** (#422) — they narrow and
widen nothing, so each only has to be a non-empty string:

- `guard-run` — a command `colab release cut --auto` runs at the repo root (with
  `COLAB_RELEASE_FROM` / `COLAB_RELEASE_SHA` set) to detect a breaking change the commit types do
  not reveal; it prints one JSON object, `{"breaking": true|false, "findings": [string]}`.
- `guard-result` — instead, the path of a file an earlier CI step wrote in that same shape. One
  detector or the other: declaring both is a failure.
- `exports` — a committed list of public symbols, one per line; a line removed since the last final
  tag is a breaking change (`package.json` `exports`/`bin` are read without it).

A guard that cannot be read refuses the cut — the contract and the rest of the computation:
[`tools/README.md`, *Release cut*](tools/README.md#release-cut-candidates).

**Two keys opt a `public-tool` repo into publishing to npm** (#433) — the `npm` job of
[`templates/release-auto.yml`](templates/release-auto.yml), in the same run that tagged
([CONVENTIONS §6](CONVENTIONS.md#6-releases)):

- `npm` — the package directory, relative to the repo root (`.` for the root). Its `package.json`
  must name a package and must not be `"private": true`; it needs no `version`, which the job
  stamps from the tag.
- `npm-gate` — the command run at the repo root, after the version stamp and before every
  `npm publish`, that fails when the tarball would carry a file nobody meant to ship (a
  pack-allowlist check). It is not optional: a publish with no gate is the stray-local-file
  leak the gate exists to stop.

They are a pair — one without the other is a **failure** — and they fit only the
`public-tool` route: on any other route, declared or derived, they are a **failure**, since an
app's tag deploys and `rapid-app` / `library-fast` are not published by this workflow. A
directory outside the repo (absolute, or through `..`) is a failure too. Absent, nothing
publishes to npm. Repository visibility is not in this file, so a private repo declaring them
passes here and is refused by the workflow itself — and failed by the audit's public-npm check
(#432). `colab release npm` prints what the job would do
([`tools/README.md`, *Release npm*](tools/README.md#release-npm)).

**`version-source` says where the tag's version comes from** (#438) — `manifest` (the default)
or `tag`. It narrows and widens nothing; it only decides which file the number lives in:

- `manifest` — every declared manifest (`VERSION`, `package.json`, `Cargo.toml`,
  `pyproject.toml`) must already equal the tag at the tagged commit, or `colab release cut` /
  `finalize` refuse at `manifest-version`. With no manifest declared the tag is the version
  either way, so the default costs a manifest-less repo nothing.
- `tag` — the manifests are **derivable**: `manifest-version` skips one that differs and names
  it, and the tag message records it (`Derivable manifests …`). The repo's own release or deploy
  step stamps the number from the tag — on a deploy-only ref, or at build time — **never as a
  commit on trunk**, which the release workflow never pushes. A manifest that cannot be read at
  all (an unparsable `package.json`, an empty `VERSION`) still refuses: derivable says where a
  number comes from, not that a broken file is fine.

**`final-grant` lets an operator make one `deploy-tag` repo's final automatic** (#441). The
default stays: a final tag that deploys production is a human act. An operator who chooses
otherwise for a repo records that ruling on a decision issue (`colab decision <N> --record
--ruled-by <human>`) and names it here, with `final: auto`:

- **Shape and place.** The decision issue's number (`123` or `"#123"`), on the `deploy-tag`
  route of a `deploy: tag` repo only — anywhere else it is a **failure**. `deploy: manual` stays
  human: a person runs that deploy anyway. `final: auto` on `deploy-tag` without it remains the
  widening failure above.
- **A tracker fact, checked on every read.** The audit and every `colab release finalize` read
  the decision issue: it must carry the `decision-recorded` label and a live `⚖ Decision
  recorded` comment by a trusted human (`trust-humans`, when declared). Unreadable, reopened, or
  never recorded → the audit **fails**, and finalize falls back to the human final.
- **Revocable at once.** Deleting the line, or `final: human`, revokes it; so does
  `colab decision <N> --reopen`. The next finalize reads the new state.
- **An agent never writes it.** The grant is the operator's choice, transcribed; the
  conditions an automatic deploying final adds on top of a candidate's are in
  [CONVENTIONS §6](CONVENTIONS.md#6-releases).

**`deploy-tag-fast` — a final on every green head, for a `deploy: tag` repo the operator chose
it for** (#446). No candidate and no test period: `colab release cut --auto` tags `vX.Y.Z` on
main's green head and the release workflow deploys it in the same run. Three keys stand in for
the test period it does not have, and the route stands only with all of them:

- `final-grant` — the operator's recorded ruling, read exactly as above (the same reader, the
  same audit failure, the same revocation). On this route it needs no `final: auto` beside it:
  the route itself is the automatic final. `final: human` here is a **failure** — there is no
  candidate for a human to finalize; declare `route: deploy-tag` for that.
- `health-url` — an absolute `https://` URL the release workflow polls after the deploy until it
  reports the version (the template's `deploy` job). Anything else is a **failure**. It is the
  one verify key every deploy shares (#452): also legal on `deploy-tag` (below), never required
  there.
- `rollback: auto` — the only accepted value: the operator's statement that the deploy restores
  the previous version by itself when that check fails. The audit can check that the URL and the
  wiring are there; it cannot prove the rollback works, which is why the grant is required too.

Missing any of the three → the route is a **failure** and the derived `deploy-tag` stays in
effect, final human — it fails closed, never into an untested automatic deploy. Only on
`deploy: tag`: `deploy: manual` and a no-production repo reject it (`library-fast` keeps its
meaning — nothing it tags reaches production). `final-spacing` — `<N>h` or `<N>d`, default and
floor `1h` — keeps two finals at least that far apart; inside it a run is a no-op and the first
run after it tags the head. Shorter, `0h` or a minute value is a **failure**. `rollback` and
`final-spacing` on any other route are a **failure**, and so are `candidates`,
`candidates-per-day` and `test-period` on this one. The gates it keeps — trunk CI green, no
`release-hold`, no ungranted migration since the last final — are in
[CONVENTIONS §6](CONVENTIONS.md#6-releases).

**`health-url` on `deploy-tag` — the container deploy's version check** (#452). On route
`deploy-tag` (`deploy: tag` or `deploy: manual`) `health-url` is optional and grants nothing: it
names the URL [`templates/deploy-container.yml`](templates/deploy-container.yml) waits on until
it reports the version just deployed, and the deploy is green only then. Same shape rule (an
absolute `https://` URL, else a **failure**). On a route nothing deploys from — `public-tool`,
`rapid-app`, `library-fast`, `none`, `live` — it is a **failure**: there is no running version to
check. A workflow running the container deploy with no `health-url` declared (and no
`HEALTH_URL` set in the copy) is an audit **advisory**: every one of its deploys would fail its
first step.

An unknown sub-key, a value outside its set, or a scalar `release:` is a failure too. **No
key picks or approves a version number** — every number is computed, majors included, and a
major without a migration section carrying its measured cost is refused
([§6, *Versioning*](CONVENTIONS.md#6-releases)).

What reads it: the audit, and the release tooling (`colab release cut` #338, `colab release
finalize` #339, and the release workflow that runs both), all through
`tools/lib/release-policy.js` — the one executable version of the tables above. If this page
and that module ever disagree, the module is what runs; report the drift.

### `generated` — optional

```yaml
generated: ["resources/js/routes/**", "schemas/lock.json"]
```

Path globs that are **regenerated, not authored** (codegen output, lockfiles).
`colab ship` treats a sync-merge conflict confined to these as resolvable by the
repo's `.colab/hooks/pre-ship` regen step instead of forcing a human — on a single
branch's sync (B0) and equally inside a `ship --batch` build, where it regenerates on the
combined head rather than dropping the member (#387). Extends the
built-in default set (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
`composer.lock`, `Cargo.lock`, `go.sum`, `dist/`, `build/`, `public/build/`, `.astro/`).

### `live-env` — optional

```yaml
live-env: none      # absent = code-wrap A3's hermetic second test run is required
```

Declares that this repo's tests read **no live environment** — nothing from the user's home
directory, no local daemon or dashboard, no token from the shell. It is the only way to skip the
hermetic second run of the test step that `code-wrap` A3 requires (`colab gate-hermetic`, #403):
a fresh empty `HOME`, every service-address/credential/socket variable unset, network off where
the platform allows it. **Absent means the run happens** — the default is the check, not the
exemption.

Why the run exists: a test read its author's home config and a local fleet daemon. It was green
in every local wrap and red on every CI runner, and the red trunk then blocked the repo's sweep.
The lesson was written down in prose and the same class recurred two days later. Measured before
this key existed.

- **`none` is the only value.** Anything else is a finding. The reader treats it as absent, so
  the hermetic run still happens, but a declaration that silently does nothing is not an answer.
- **Only trunk's value counts.** `colab gate-hermetic` reads `live-env` from `origin/<trunk>`
  (else the local `<trunk>`), never from the branch being gated — a branch cannot opt its own
  tests out. A branch-only declaration is named in the output and the run still happens.
- **Declare it only when it is true, and cheap to keep true.** The hermetic run costs one extra
  pass of the test step. Skipping it trades that for the class of failure above, on every branch,
  forever. A repo whose suite is too slow to run twice is a better candidate for a faster split
  test step than for this key.
- The one reading is `tools/lib/hermetic.js` `parseLiveEnv`; the audit reports the value
  (`--json`: `liveEnv`).

### `gate` — optional

```yaml
gate:
  smoke: npm run smoke     # the fast local check code-wrap A3 runs once (lint, types, changed tests)
  authoritative: ci        # ci | local — absent = local
```

Where the gate's **verdict** comes from (#410). With `authoritative: ci`, `code-wrap` A3 runs
`smoke` once — no hermetic second pass — and pushes; the verdict is the branch-CI run at the
pushed head sha, which the hand-off names by run id and `code-ship` reads instead of re-running
tests locally. A clean CI runner is the hermetic run by construction. **Absent, or
`authoritative: local`, means today's gate exactly**: the local full gate plus
`colab gate-hermetic` (`live-env` above).

Why: on shared agent workstations full local suites took 6–10 min and flaked on timeouts, while
the same suites took 2–7 min in branch CI on clean runners, and the hermetic rule doubled every
local run (sources: `CONVENTIONS.md`
[§4, *Branch CI*](CONVENTIONS.md#branch-ci--the-candidates-own-run-read-as-a-class-314)).

- **`ci` needs branch CI that can arrive.** It takes effect only where a workflow fires on a push
  to a session branch (`tools/lib/gate.js` `gateMode`); a repo whose CI runs on PRs and trunk
  pushes alone stays on the local gate however it is declared, and the audit warns. #408's other
  two conditions still apply, and the skill checks them: the workflow runs the tests, on a runner
  that does not share a developer's machine.
- **A block, not an inline map.** `gate: { smoke: … }` is not parsed by this descriptor's readers
  and is a finding. `smoke` is required; `authoritative` is `ci` or `local`; any other key is a
  finding. A `#` in the command starts a comment — wrap the command in a script if it needs one.
  Every defect is read as absent (local full gate) while the audit fails it.
- **Only trunk's value counts**, as with `live-env` — a branch cannot move its own verdict to CI.
- The one reading is `tools/lib/gate.js` `parseGate`; the audit reports the value (`--json`:
  `gate`).

### `node`, `php`, `python` — optional toolchain pins

```yaml
node: 22
php: 8.4
python: 3.13
```

Explicit toolchain versions. These **win** over the ecosystem manifest per the
precedence in [CONVENTIONS.md §7](CONVENTIONS.md#7-ci-and-toolchain):

| Key | Manifest it overrides |
|---|---|
| `node` | `.nvmrc`, then `package.json → engines.node` |
| `php` | `composer.json → require.php` |
| `python` | `.python-version`, then `pyproject.toml → requires-python` |

Use only when the manifest cannot express the truth, or for a deliberate pin —
the manifest is the normal answer. If neither source declares a version, CI must
fail, not guess.

**`requirements.txt` is not a manifest for this purpose.** It pins dependencies,
never the interpreter. A Python repo carrying only a `requirements.txt` has
declared nothing about which Python it runs on, so it must set `python:` here or
add a `.python-version` — the alternative is a hardcoded version in CI, which is
the exact failure this precedence exists to prevent.

When a pin here contradicts the manifest, the audit tool reports it. That is
intentional: a disagreement is a finding to surface, not to auto-resolve.

## Examples

Tier B (no production yet):

```yaml
tier: B
trunk: main
production: null
deploy: none
stack: capacitor-vite
ports: [5220]
```

Tier C (live, and the promotion is the deploy — no tag ritual):

```yaml
tier: C
trunk: dev
production: https://site.example.com
deploy: push-main
stack: astro-static
```

Tier A (live product):

```yaml
tier: A
trunk: dev
production: https://app.example.com
deploy: tag
stack: laravel-inertia
ports: [8080, 8081]
php: 8.4
```

Tier A, deployed by hand (live, but no workflow and no tag trigger):

```yaml
tier: A
trunk: dev
production: https://app.example.com
deploy: manual
runbook: docs/deploy.md
stack: fastapi + vite spa
```

Tier A, single-trunk tag-gated, deployed by an external GitOps poller:

```yaml
tier: A
trunk: main
production: https://app.example.com
deploy: tag
runbook: docs/deploy.md
releaseBranch: release
stack: laravel-inertia
```

Declared purely by axis, no `tier` key at all — the shape a repo adopting the model fresh
should reach for, live product, tag-gated, gates counted by `exposure` rather than derived
from a letter:

```yaml
trunk: dev
production: https://app.example.com
deploy: tag
stack: laravel-inertia
exposure: released
room: team
writes: isolated
```

`tier` is optional precisely so this is legal on its own: `exposure: released` with a
non-null `production` and a committed deploy path is a complete answer to "how many gates
stand between a merge and users," and nothing here reads a `tier` that was never written.
Add `tier: A` later only if something outside this handbook still expects to read it.

Tier B, but genuinely consumed — a public, tag-published repo with real adopters and no
server, `exposure` declared alongside `tier`, and one writer serving many readers (this
repo's own shape):

```yaml
tier: B
trunk: main
production: null
deploy: none
stack: docs + copy-and-own CI templates + audit CLI (no build)
writes: serial
room: public
exposure: released
channels: [artifact]
```

Note `writes: serial` beside `room: public` — the two axes are independent, and this is
the shape that shows it. One writer at a time says nothing about who reads the record;
`writes: serial` never implies `room: solo`.

## Validity rules (what the audit tool checks)

| Rule | Failure it prevents |
|---|---|
| file present and parseable | undescribed repo — agents guess |
| `tier` and `exposure` both absent → **finding**, "no axis of record" | a descriptor with no answer at all about gate count |
| `tier` and `exposure` both present and disagreeing about gate count → **finding** | a descriptor that contradicts itself about how many gates its own pipeline has |
| `tier` ∈ {A, B, C}, when set | — |
| **Legacy path** (`tier` set, `exposure` absent) — reproduces every rule below, worded against the tier letter, byte for byte with pre-#144 behaviour: | |
| `tier: A` → `trunk: dev`, `production` non-null, `deploy` ∈ {`tag`, `manual`} | a release branch nothing consumes |
| `tier: A` + `deploy: push-main` → **finding**, pointing at tier C | claiming a release gate the pipeline does not have |
| `tier: C` → `trunk` a branch distinct from `main` (`dev` by default, any name conforming), `production` non-null, `deploy: push-main`, a deploy workflow exists | a tier whose shape does not match its mechanism |
| `deploy: tag` (or `push-main`) → a deploy workflow exists | a tier claimed but never wired up |
| `deploy: manual` → `runbook:` set, and the path exists in the repo | a hand-deploy only one person knows how to run |
| `tier: B` → `trunk: main`, `deploy: none`, `production: null` | ceremony without benefit |
| **Axis path** (`exposure` set — governs regardless of whether `tier` is also set): | |
| `exposure: live` → `trunk` a branch distinct from `main` (`dev` by default, any name conforming), `production` non-null, `deploy: push-main`, a deploy workflow exists (no `runbook:` escape hatch) | a live shape claimed but never wired up |
| `exposure: released`, shape 1 → `production` non-null, `deploy` ∈ {`tag`, `manual`} (never `push-main` — that's `live` — or `none`), a committed deploy path (workflow, or `runbook:` outside CI), `trunk: dev` (or `main` only when `deploy: tag`) | a release claimed but never wired up |
| `exposure: released`, shape 2 → `production: null`, `trunk: main`, `deploy` absent or `none`, and (a version-shaped tag, or `channels: [artifact]`) | a "released with no server" claim with no evidence it ships anywhere |
| `exposure: none` → `trunk: main` + no committed deploy workflow (a NAMED `production` alone stays clean — the transitional read) | claiming nothing consumes this repo while something is wired to deploy it |
| `exposure: self` → no rule at all | policing a room-bounded repo's deploy shape, which is out of scope |
| declared `trunk` branch actually exists | docs describing a repo that doesn't exist |
| every `integration` entry exists, and is not `trunk` / `main` / the word `trunk` | a dev-side line acquiring a path to production |
| declared `releaseBranch` exists, and is not `trunk` / `main` / the word `trunk` | `colab doctor` misreading a live deploy target as a spent branch and advising its deletion |
| declared `owner` has a `branch`, only `branch`/`remote` sub-keys, and its branch is not trunk, an `integration` line or the `releaseBranch` | a colab command reaching the branch only the owner merges into (#394) |
| toolchain pin vs manifest agreement | building on one version, deploying on another |
| `ceremony` ∈ {`standard`, `light`} when set | a misspelled value silently read as `standard` |
| `ceremony: light` → not `autonomy: auto-trunk` | an unattended merge with no evidence trail nobody can audit |
| `writes` ∈ {`free`, `direct`, `isolated`, `serial-direct`, `serial-gated`, `serial`} when set | a misspelled value silently read as coexistence (⚖ #233: never veto on an unrecognised value) |
| `room` ∈ {`solo`, `team`, `public`} when set | a misspelled value silently read as undeclared |
| `branchPrefix` = `machine` when set | a misspelled value silently read as the unprefixed default |
| `ship-batch` an integer 1–3 when set → **finding** otherwise | a misspelled opt-in silently read as serial by `colab ship` |
| `ship-batch` > 1 with no workflow firing on a `ship-batch/**` push, or without `autonomy: auto-trunk` → **advisory** | a batch opt-in that can never land a batch |
| `migrations` a list of repo-relative prefixes when set — an absolute path, `..`, glob, the repo root, or a non-list → **finding** | a declaration the migration gate cannot honestly read |
| `migrations` empty, restating a default, or naming one prefix twice → **advisory** | redundancy, harmless |
| a tracked `*/migrations/` directory outside the defaults and every declared prefix → **advisory** (local only) | a migration layout `colab ship`'s gate cannot see |
| `migration-grant` ∈ {`human`, `reviewer`} when set → **finding** otherwise | a misspelled policy silently read as `human` |
| `trust-humans` a non-empty list of GitHub logins when set → **finding** otherwise | a malformed list read as "nobody is human", so every human grant and ruling silently stops counting |
| `live-env` = `none` when set → **finding** otherwise | a misspelled opt-out read as absent, so it silently does nothing |
| `gate` a block with `smoke` + `authoritative` ∈ {`ci`,`local`} when set → **finding** otherwise; `ci` with no branch-push trigger → **warn** | a malformed block is read as absent, so it silently does nothing; a `ci` verdict that can never arrive leaves every reader on the local gate |
| `holds` is a list of non-empty strings, each listed once, when set → **finding** otherwise | a scalar or malformed list silently read as "no holds declared", so triage reports held work ready |
| `exposure` ∈ {`none`, `self`, `live`, `released`} when set | a misspelled value silently read as undeclared |
| `exposure: none` + `production: null` → **advisory** | the both-empty claim ("nothing consumes this, and there is nothing to point at") going unflagged |
| `exposure: live` + `trunk: main` + no `writes: isolated` → **advisory** (⚖ #233, replacing the dropped deploy-shape prohibition) | a trunk-direct commit reaching users immediately, with the descriptor never naming the one field that vetoes it — dormant by construction today (measured: this shape already fails the `exposure: live` mechanism rule above, zero instances across 40 adopted descriptors), shipped anyway as the one finding that names the remedy |
| `channels` is a list, each member ∈ {`workflow`, `hook`, `procedure`, `checkout`, `artifact`, `data`, `none`}, when set | a misspelled or scalar value silently read as undeclared |
| `channels` contains no duplicate member → **finding** | `[workflow, workflow]` passing silently as though it were a richer answer than `[workflow]` |
| `channels: [none]` combined with another member, or `channels: []` → **finding** | an empty or self-contradicting answer read as a real one |
| `channels: [none]` + (`production` non-null or `deploy` ≠ `none`) → **advisory** | the claim "nothing runs this" going unflagged against a fact already on record elsewhere in the same descriptor |
| `release` is a one-level block of `candidates` ∈ {`auto`, `off`}, `test-period` `<N>d`, `final` ∈ {`auto`, `human`}, when set — no other sub-key | a misspelled knob silently read as the default |
| `release` widening its derived default — `candidates: auto` where the rung cuts no tags, `final: auto` where the final tag is a human act (`deploy: tag` without a resolvable `final-grant`, or `manual`), `test-period` under `3d` → **finding** | a descriptor lowering §6's human gate on a tag that deploys production |
| `route: deploy-tag-fast` without a resolvable `final-grant`, `health-url` and `rollback: auto`, or whose release workflow deploys nothing from the final it tags (#446) → **finding** | a final on every green head that nobody chose, or that reaches the Release page while production never moves |

`push-main` on a Tier A repo **is a finding** — a mismatch between the
mechanism and the tier's contract, not a judgement on the mechanism, and the
usual fix is `tier: C` rather than any pipeline change. (The wording here
previously promised an advisory that no code ever emitted, so what looked like
tolerance was in fact total silence — a doc describing behaviour the tool did
not have.) On Tier B the value is caught by the `deploy: none` rule instead: a
Tier B repo that deploys is mistiered, whatever mechanism it names.

On Tier C the wrong `deploy` value is likewise redirected rather than merely
rejected, because each one names a different gate count and therefore a
different tier: `tag` and `manual` both point back to A (two gates, and a
promotion that does not itself deploy), `none` points to B.

The runbook path is verified against a **local working tree**. When a repo is
audited through the GitHub API (an `owner/name` entry) there is no tree to
stat, and a failed read cannot be told apart from a missing file, so a miss is
reported as an advisory instead of a violation.
