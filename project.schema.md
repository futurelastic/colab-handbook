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
(phase 3 of the epic tracking this model, CONVENTIONS.md §2).

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
  workflow and needs no runbook.

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
- `auto-trunk` — an agent may complete the trunk merge itself **through `colab ship`
  only**, and only when every precondition passes: trunk CI alive and green, no new
  DB migrations in the branch, no hand-code conflicts after sync-regen. Any ✗ falls
  back to asking a human.

This grants **trunk** autonomy only. Promotion `dev` → `main`, tags, and anything
that deploys remain human acts on every repo, always — the field cannot express
otherwise. The grant lives in the repo file (not the caller's flags) so autonomy is
a property of the repo's risk profile, reviewed in a commit like any other change.

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

### `exposure` — optional

```yaml
exposure: none       # nothing consumes a merge here
exposure: self       # only parties already in the room — a subset of the room's collaborator set
exposure: live       # users, via the promotion itself
exposure: released   # users or adopters, via a deliberate artifact (a tag, a runbook)
```

What consumes a merge here — as of **#144**, the AXIS OF RECORD for gate count when
declared (CONVENTIONS.md §2, "Exposure — what consumes a merge here?"; [`tier`](#tier--optional-legacy)
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
`production:` pairing rule below all live in CONVENTIONS.md §2, "Exposure" — read there for
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
([CONVENTIONS.md, CI](CONVENTIONS.md#ci--what-it-is-follows-writes-how-much-follows-exposure);
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
(CONVENTIONS.md §2, "Channels — by what path does code reach the thing that runs it?").
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
what a file-synced working tree costs a `writes: serial` repo, lives in CONVENTIONS.md §2,
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
([CONVENTIONS.md, CI](CONVENTIONS.md#ci--what-it-is-follows-writes-how-much-follows-exposure)).
What CI *is* — gate or alarm — is derived from `writes`; how thorough it must be is
derived from `exposure`. A `ci:` field would let either drift from the axis that already
answers it, the identical failure every other axis on this page exists to prevent.

A repo needing something its copied workflow doesn't cover edits that file directly.
Copy-and-own already permits this, and the audit already classifies the edit as drift to
reconcile, not a violation — the same treatment [`templates/`](templates/) gives every
other stamped file. Nothing here refuses customization; it refuses a *declared summary* of
behavior the `writes`/`exposure` axes already determine.

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
bridge: `colab solo` now refuses outright on any repo that does not resolve to
`writes: serial-direct` (#208 split `serial` into `serial-direct`/`serial-gated`; the
legacy alias `serial` still resolves to `serial-direct`, so this is unchanged for every
repo that has not opted into the split) — see [`writes`](#writes--optional) below for the
entry gate and the five rules it never relaxes.

### `writes` — optional

```yaml
writes: isolated       # default; omission = isolated — no existing repo changes behavior
writes: serial-direct   # one writer at a time, no branch — solo flow is this cell
writes: serial-gated    # one writer at a time, still branches for a pre-merge gate
writes: serial           # LEGACY ALIAS of serial-direct — see below
```

Which write-conflict prevention method this repo's sessions use, by default — a separate
axis from `tier` (gates to production) and from `ceremony` (record-keeping depth). Three
declarable values, one per coherent method:

| method | writer count | branches? | this is… |
|---|---|---|---|
| `serial-direct` | one at a time | no | solo flow |
| `serial-gated` | one at a time | required when the two conditions below apply | the common case: a claim, a branch, a squash |
| `isolated` (default) | many, concurrently | always (worktrees) | today's fleet default |

A fourth cell — many units in flight, writing trunk-direct — is not a method; it is simply
an unlocked repo, and is named incoherent (`CONVENTIONS.md` §2, *Writes*). It has no
declarable value.

**The constraint matrix (#208) — read this before granting anything to a `serial-*`
repo.** This is the table the issue that split the value asked for by name, because the
prose alone put the `auto-trunk` answer three passages apart and a reader who stopped at
the second concluded the opposite of the truth:

| constraint | `serial-direct` | `serial-gated` | `isolated` |
|---|---|---|---|
| `autonomy: auto-trunk` | allowed — governs the branch-merge fallback only (`CONVENTIONS.md`, *Solo flow*, rule 5) | allowed | allowed |
| place-claim needed | yes | yes | no (the worktree already is the isolation) |
| branch | optional — only when a unit is mandatory (below) | required when a unit is mandatory (below) | always |
| `ceremony: light` + `autonomy: auto-trunk` | **forbidden** | **forbidden** | **forbidden** |

**Until #224, the `auto-trunk` row read `forbidden` for `serial-direct`; that was too
broad, and #208's original worry — a misgrant nobody could tell apart from
`serial-gated`'s cell — no longer applies, because both cells now read the same.** The
old reasoning assumed `serial-direct` means the repo never produces a branch, so an
`auto-trunk` grant could only mean an unattended trunk-direct commit with none of solo
flow's start-side rails. `writes: serial-direct` means solo flow is *available*, not that
every unit runs through it: solo flow's entry gate refuses whenever it cannot prove no
collision (a live worktree, a held claim, an unpushed branch, a dirty tree), and on
refusal the session falls back to full ceremony — claim, branch, worktree, merge. By the
time that branch exists, it is indistinguishable from `serial-gated`, and the hazard the
old cell protected against — an unattended merge with no branch, no claim, no worktree —
was never reachable through `colab ship` on any `writes` value: `ship` merges a *branch*,
a solo-flow trunk-direct commit never produces one, and a raw push to trunk is blocked by
hook regardless. The prohibition belonged to the act, not the declared value; see
`CONVENTIONS.md`, *Writes*, for the argument in full.

**`writes` says which of those a repo's sessions may use by default; it does NOT say
whether any given unit of work branches** — that stays a per-unit choice inside whichever
method applies. Two conditions, and only two, make a branch mandatory on a `serial-*`
repo: more than one unit in flight, or a gate that must inspect a unit before it lands.
"It feels safer" is not on that list. This applies to `serial-gated` in the ordinary
case (a declared pre-merge gate makes condition 2 true as a matter of policy, so branching
is the norm there) and to `serial-direct` only in the rare case both conditions fire mid
session — solo flow's entry gate already refuses to open a second unit, so condition 1 is
false by construction at the moment a solo session starts.

**The legacy alias: `serial` resolves to `serial-direct`, not `serial-gated`.**
`serial` predates the split and stays declarable — no adopter's descriptor breaks on this
change. `tools/lib/writes-authority.js` is the ONE shared resolver (the audit and `colab
adopt` both read it, the same split `tools/lib/axis-authority.js` draws for `tier` →
`exposure`), and it resolves the alias to `serial-direct` — historically for two reasons;
#224 retired the second, so the first now carries the resolution alone:

1. **Byte-identical preservation.** Every repo declaring bare `serial` today is
   solo-flow-eligible (`soloEligibility`, `tools/lib/solo.js`) — including this handbook's
   own descriptor, whose comment states outright that `writes: serial` "is what lets solo
   flow's entry gate open here" (see this file's own `.github/project.yml`). Resolving the
   alias to `serial-gated` instead would silently revoke that for every such repo the
   moment this axis lands — the opposite of "no adopter's descriptor breaks." This reason
   still holds and is sufficient on its own.
2. ~~**The conservative reading on the one property that is actually dangerous.**~~
   **Retired by #224.** This reason cited the constraint matrix's old `auto-trunk` cell,
   which read `forbidden` for `serial-direct` and `allowed` for `serial-gated` — so
   resolving the alias toward `serial-gated` looked like it would move a repo into a
   forbidden-vs-allowed cell nobody had re-examined. #224 corrected that cell to `allowed`
   for both methods (*Writes*, above): `auto-trunk` was never actually gated on
   `serial-direct` vs `serial-gated`, only on whether a branch exists to `ship`. Resolving
   toward `serial-gated` no longer changes a repo's `auto-trunk` posture at all — reason 1
   is what protects the alias now.

**Reclassifying an EXISTING repo's descriptor from `serial` to `serial-gated` is still a
human decision, made per repo, never inferred by a tool** — but the reason has narrowed to
what reason 1 above protects. `serial-gated` forbids solo flow outright (a declared
pre-merge gate is exactly what solo flow has none of) and makes a branch mandatory on
every unit, not only the two conditions that apply to `serial-direct`; assigning it
automatically to a repo that is actually running trunk-direct would silently take solo
flow away from a repo counting on it. Migrating a descriptor off the alias, once true of a
given repo, is exactly that: a fact somebody checks and writes down, not a bulk edit.

**Deliberately not coupled to `tier`, `production`, or exposure.** A busy repo with three
concurrent sessions needs isolation regardless of whether it has a production deploy; a
quiet repo with one session at a time does not need it merely because it is live. The
correlation seen across today's fleet is caused by *who works a repo*, not by *what
consumes it* — encoding that correlation as a rule would repeat the same weld `ceremony`
was introduced to undo. No coherence rule is audited against `tier`/`production` for this
reason; do not add one.

**No field for the place-claim itself.** The lock that enforces either `serial-*` method
(`CONVENTIONS.md`, *Solo flow* / place-claims) is a fact about one checkout on one
machine at one moment — the same reasoning that keeps `deploys: {host: branch}` out of
this schema ([§2](CONVENTIONS.md#2-tiers)) applies here: a path on one host is meaningless
read from another, so it lives in session state (`~/.colab/state.json`), never in this file.

### `promotion` — optional

```yaml
promotion: main-loop     # human (default) · main-loop
```

Who may run the **promotion** (`trunk → main`, via `colab promote`) without a
per-instance human word. Distinct from **release** (the tag), which is always human.

- `human` (or absent) — promotion needs `COLAB_HUMAN=1`.
- `main-loop` — the main loop may promote unattended, **but only on a
  `deploy: tag` repo**, where promotion is verification-only (main runs the heavy
  suite; nothing deploys).

Unknown values fail closed to `human`. This field **cannot** lower the bar set by
`deploy:` — on a `deploy: push-main` repo promotion *is* the production deploy, and
on a `deploy: manual` repo promotion is the human's signal to run the deploy; both
always require `COLAB_HUMAN=1`. Only `deploy: tag` makes promotion
verification-only, so only there can `main-loop` apply. Nothing here ever
authorizes tagging.

The full permission ladder, one rung per boundary:
**ship** (branch→trunk, gated by `autonomy`) · **promote** (trunk→main, gated by
`deploy`+`promotion`) · **release** (tag, always human).

### `generated` — optional

```yaml
generated: ["resources/js/routes/**", "schemas/lock.json"]
```

Path globs that are **regenerated, not authored** (codegen output, lockfiles).
`colab ship` treats a sync-merge conflict confined to these as resolvable by the
repo's `.colab/hooks/pre-ship` regen step instead of forcing a human. Extends the
built-in default set (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
`composer.lock`, `Cargo.lock`, `go.sum`, `dist/`, `build/`, `public/build/`, `.astro/`).

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
| `tier: C` → `trunk: dev`, `production` non-null, `deploy: push-main`, a deploy workflow exists | a tier whose shape does not match its mechanism |
| `deploy: tag` (or `push-main`) → a deploy workflow exists | a tier claimed but never wired up |
| `deploy: manual` → `runbook:` set, and the path exists in the repo | a hand-deploy only one person knows how to run |
| `tier: B` → `trunk: main`, `deploy: none`, `production: null` | ceremony without benefit |
| **Axis path** (`exposure` set — governs regardless of whether `tier` is also set): | |
| `exposure: live` → `trunk: dev`, `production` non-null, `deploy: push-main`, a deploy workflow exists (no `runbook:` escape hatch) | a live shape claimed but never wired up |
| `exposure: released`, shape 1 → `production` non-null, `deploy` ∈ {`tag`, `manual`} (never `push-main` — that's `live` — or `none`), a committed deploy path (workflow, or `runbook:` outside CI), `trunk: dev` (or `main` only when `deploy: tag`) | a release claimed but never wired up |
| `exposure: released`, shape 2 → `production: null`, `trunk: main`, `deploy` absent or `none`, and (a version-shaped tag, or `channels: [artifact]`) | a "released with no server" claim with no evidence it ships anywhere |
| `exposure: none` → `trunk: main` + no committed deploy workflow (a NAMED `production` alone stays clean — the transitional read) | claiming nothing consumes this repo while something is wired to deploy it |
| `exposure: self` → no rule at all | policing a room-bounded repo's deploy shape, which is out of scope |
| declared `trunk` branch actually exists | docs describing a repo that doesn't exist |
| every `integration` entry exists, and is not `trunk` / `main` / the word `trunk` | a dev-side line acquiring a path to production |
| declared `releaseBranch` exists, and is not `trunk` / `main` / the word `trunk` | `colab doctor` misreading a live deploy target as a spent branch and advising its deletion |
| toolchain pin vs manifest agreement | building on one version, deploying on another |
| `ceremony` ∈ {`standard`, `light`} when set | a misspelled value silently read as `standard` |
| `ceremony: light` → not `autonomy: auto-trunk` | an unattended merge with no evidence trail nobody can audit |
| `writes` ∈ {`isolated`, `serial`} when set | a misspelled value silently read as `isolated` |
| `room` ∈ {`solo`, `team`, `public`} when set | a misspelled value silently read as undeclared |
| `exposure` ∈ {`none`, `self`, `live`, `released`} when set | a misspelled value silently read as undeclared |
| `exposure: none` + `production: null` → **advisory** | the both-empty claim ("nothing consumes this, and there is nothing to point at") going unflagged |
| `channels` is a list, each member ∈ {`workflow`, `hook`, `procedure`, `checkout`, `artifact`, `data`, `none`}, when set | a misspelled or scalar value silently read as undeclared |
| `channels` contains no duplicate member → **finding** | `[workflow, workflow]` passing silently as though it were a richer answer than `[workflow]` |
| `channels: [none]` combined with another member, or `channels: []` → **finding** | an empty or self-contradicting answer read as a real one |
| `channels: [none]` + (`production` non-null or `deploy` ≠ `none`) → **advisory** | the claim "nothing runs this" going unflagged against a fact already on record elsewhere in the same descriptor |

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
