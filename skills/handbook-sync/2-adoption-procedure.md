# handbook-sync · §2 the adoption procedure

The step-by-step adoption the [`handbook-sync`](SKILL.md) skill walks, moved here verbatim from
[`CONVENTIONS.md` §9, *Adopting this*](../../CONVENTIONS.md#9-adopting-this) by #640; only links were
retargeted. The rules these steps serve stay in §9, in its *adoption contract*; the headings stay there
as stubs, so every link into them still resolves. Mechanics of `colab adopt`, `colab deliver` and
`colab labels` are described where they happen, in the step that runs them.

### Any repo, first-time adoption

1. **Answer the shared question set** — the same five questions [§9](../../CONVENTIONS.md#9-adopting-this)
   asks a repo predating one of the newer axes ("Predates an axis", below). Each question
   is asked as a human answers it, not as a schema field name:

   | # | ask it like this | writes | values | at adoption |
   |---|---|---|---|---|
   | 1 | does a deploy target exist *today* ([§2](../../CONVENTIONS.md#2-tiers)), and how is it reached — a tag gates production, the promotion itself deploys, a human runs a runbook, or nothing is live yet? | `production` + `deploy` | a URL (or none) + `push-main` / `tag` / `manual` / `none` | **asked** — the URL only when `deploy` is not `none` |
   | 2 | who else works here? | [`room`](../../CONVENTIONS.md#room--who-else-is-here) | `solo` / `team` / `public` | optional — later, `--axis room` |
   | 3 | **what would break if you merged something wrong here?** | [`exposure`](../../CONVENTIONS.md#exposure--what-consumes-a-merge-here) | `none` / `self` / `live` / `released` | **asked** — a human's answer for `none`/`self` |
   | 4 | Should a human ever be allowed to commit straight to this repo's trunk checkout, alongside worktree sessions? free allows it with no runtime restriction; direct allows it and additionally declares intent for a stronger guarantee later (declared today, not yet enforced — CONVENTIONS.md §2); isolated vetoes it outright, human or not. | [`writes`](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory) | `free` / `direct` / `isolated` (unanswered reads as `free` — #283) | optional — later, `--axis writes` |
   | 5 | by what path does a commit reach something that runs it? (a list — several may apply) | [`channels`](../../CONVENTIONS.md#channels--by-what-path-does-code-reach-the-thing-that-runs-it) | `workflow` / `hook` / `procedure` / `checkout` / `artifact` / `data` / `none` | optional — later, `--axis channels` |

   **Adoption asks only what changes a gate (#533).** Questions 1 and 3 decide the gate
   count; 2, 4 and 5 are optional in the schema and legal absent. So a fresh adoption
   leaves them unanswered and prints one line naming them and the `colab adopt --axis
   <row>` that answers each later. Their flag (`--room`, `--writes`, `--channels`) still
   answers one in the same run.

   **The human step comes first, not last (#522)** — what `colab adopt` prints, and the command a person
   runs: [`tools/docs/adoption.md`](../../tools/docs/adoption.md#first-time-adoption--the-human-step) (#640).

   Question 1 writes `production` and `deploy`, never `tier` directly — `tier` is a pure
   function of those two answers (`tools/lib/adopt.js:deriveTier`: no production → `B`;
   production + `push-main` → `C`; production + `tag`/`manual` → `A`).

   Question 3 is phrased this way — never "who consumes this?".

   **Detected, never asked:** `trunk` (the default branch), `stack` and toolchain pins
   (read from the repo's own manifests), `ports` (existing config or reservations). Do not
   ask a human something the repo already states.

   **Derived, never asked:** gate count, CI role and thoroughness, ceremony weight,
   whether a branch is mandatory, the rollback obligation. Every one of these follows from
   the answers above.

   **Two entry states, one set.** A repo with nothing recorded yet asks the two gating
   questions now, during first-time adoption, and leaves the optional three for later. A
   repo that already adopted before one of the newer axes existed asks only the gating
   axes it is missing (the optional three stay optional there too) — same five questions,
   same wording, at sync time ("Predates an axis", `handbook-sync`); do not let a sync
   grow its own paraphrase of these five rows.

   **Asking is not the same as writing.** A sync (or a first-time adoption interrupted
   partway through) records a human's answer; it never fills a missing key on its own,
   and it never "resolves" the `production:`-pairing advisory below by deleting a key
   that was already declared. Declaring must never be riskier than omitting.

   **The exposure asymmetry, what `colab adopt` executes, and landing the descriptor on trunk (#481)** —
   each gated on a person: [`tools/docs/adoption.md`](../../tools/docs/adoption.md#first-time-adoption--what-colab-adopt-does-and-landing-the-descriptor) (#640).
2. **Write `.github/project.yml`** ([§3](../../CONVENTIONS.md#3-githubprojectyml--the-marker)) with the
   answers from step 1 — **and declare `migrations:`** when the repo keeps migrations
   anywhere but `database/migrations/` or `prisma/migrations/`
   ([`project.schema.md`](../../project.schema.md#migrations--optional)). None of the five
   questions asks it, so `colab adopt` lists it as the first remaining step, naming the
   candidate layouts it found (`git ls-files`: an uncovered `migrations/` directory, or a
   directory of tracked `*.sql` files).
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
   ([§8, *Upstream*](../../CONVENTIONS.md#upstream--a-consumer-that-changes-what-a-convention-means-files-it-here-362)).
   (No `colab` on this machine? The twenty-three `gh label
   create … || true` lines this replaced are recoverable from that file's history.)

   **This count is a hand-typed number restated in at least four places** (here, the `gh
   label create` fallback line above, `skills/handbook-sync/SKILL.md`, and
   `tools/lib/codec/labels.js`'s own doc comment) — **none checkable against the others
   except the one pinned assertion in `tools/lib/labels-ensure-cli.test.js`.** Add a
   label, bump that test, then grep for the other three prose counts before you're done.
   This full set is provisioned again on every sync, not only at adoption.
4. **Add the tier topic** — `gh repo edit <owner>/<repo> --add-topic tier-b` (or
   `tier-c`/`tier-a`).
5. **Add the handbook pointer to `CLAUDE.md`** — copy
   [`templates/repo-CLAUDE-block.md`](../../templates/repo-CLAUDE-block.md); create the file if
   none exists. **Do not skip this**. `colab adopt` writes it for you on a repo adopting
   for the first time that has no `CLAUDE.md` yet, in the shape below.

   **The instruction-file shape (#417).** Most agent tools read `AGENTS.md`; one reads
   `CLAUDE.md` by name. So:
   - **Repo prose goes in `AGENTS.md`** — what the repo is, how to run and test it,
     pointers into `docs/`. It is the repo's *instruction file*: the one you edit.
   - **`CLAUDE.md` is a thin shell:** `@AGENTS.md` on its first line, plus the blocks
     tools look up in `CLAUDE.md` by name — this Conventions block with its stamp, any
     `Local divergences:` list beside it, and any other tool-managed block that is found
     by filename.
   - **No block lives in both files.** A framework generator that supports targets is
     configured to write `AGENTS.md` **only** (Laravel Boost: its agent/target config).
   - **Enforced, ratcheted (#588):** prose in `CLAUDE.md` fails at commit and in CI where the
     change touches `CLAUDE.md`/`AGENTS.md` or the repo had migrated — unmigrated and untouched
     stays green. Fix: move it to `AGENTS.md`. Add [`templates/instruction-files.yml`](../../templates/instruction-files.yml)
     (keep its unfiltered `push:` and `workflow_dispatch:`, #599) and the hooklet `templates/pre-commit-instruction-files`.
   - **A fork of an upstream you don't own does not take this shape**. Its step 5 is the
     append-only block in [*A fork of an upstream*](#a-fork-of-an-upstream--a-repo-you-own-that-tracks-one-you-dont-449), below,
     and it declares `instruction-files: upstream` so the check above passes unjudged (#602).

   The audit holds this shape: its size advisory measures `CLAUDE.md` **plus every in-repo
   file it `@`-imports**, so a bloated `AGENTS.md` behind a tiny shell is still caught; it
   warns when a tool block appears in both files, when the Conventions block sits
   anywhere but `CLAUDE.md`, when `CLAUDE.md` carries repo prose (`prose-in-claude-md`, with
   the line ranges) and when there is no `AGENTS.md` (`no-agents-md`) — #419. Warnings, except
   `prose-in-claude-md` where the ratchet trips (#588); `handbook-sync` grafts the move.
6. **Make sure CI meets [§7](../../CONVENTIONS.md#7-ci-and-toolchain)'s outcome** — copy a template via `colab
   template <name>`, which stamps for reconciliation. **On `exposure: released`, this step
   also wires the release rung ([§6](../../CONVENTIONS.md#6-releases)) — at adoption, not later** (#492): the
   `release:` block with the route the descriptor's row takes and `version-source: tag`,
   the release workflow (`templates/release-auto.yml`, its edit points walked), the deploy
   template for the stack where the tag deploys — copied disarmed, armed by the operator —
   and a first final, which is the operator's to set because `colab release cut` refuses
   with none to bump from. `colab adopt` lists these as step-6 lines; the no-production
   row's route is a proposal for the human to confirm, never a choice the agent makes.
   **Under `migration-grant: reviewer`, copy the CI with its round-trip in the same act** —
   `colab template <ci-node|ci-python> --roundtrip` (#625; why: [templates/README](../../templates/README.md#migration-round-trip--have-it-from-the-first-copy)).
7. **Register the repo** — `colab register`, updating both the audit fleet list and the
   reserved-ports aggregation. Unregistered = invisible to the fleet audit.
8. **Leave existing branches alone** — grandfathered.
9. **Do not create `dev`** unless the repo is genuinely Tier A or Tier C.

Why, with the measurements: [ADR 539](../../docs/adr/539-adoption-first-time-rationale.md).

### Going live: Tier B → Tier C or Tier A

Do this **on the day a deploy target exists** — not before.

1. **Write down the path to production** — for C, the deploy workflow triggered by a push
   to `main`; for A, the workflow triggered by a tag, or the runbook for a hand-deployed
   repo. One of these must be committed before proceeding.
2. `git checkout -b dev main && git push -u origin dev`
3. Set the repo's default branch to `dev`.
4. **Add `dev` to every CI workflow's trigger branches**.
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

Step 1 comes first. Why, with the measurement: [ADR
539](../../docs/adr/539-adoption-tier-transitions-rationale.md).

### Tier C → Tier A — when the site earns a release ritual

Do this when you find yourself *wanting* to name what shipped — not before.

1. **Retrigger the deploy workflow on a tag** instead of a `main` push — the whole change.
   Why, with the measurement: [ADR
   539](../../docs/adr/539-adoption-tier-transitions-rationale.md).
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
and nothing lands in the owner's history (#393).

**The minimum is small, and all of it stays out of the owner's repo:**

| need | where it lives | why it works |
|---|---|---|
| `.github/project.yml` — `trunk`, `production`, `deploy`, `stack`, `exposure` | the local clone's **main checkout** only, hidden by `.git/info/exclude` | every reader (`colab`, `adopt`, the audit's local source, `code-start`'s `cat`) reads the working tree, not git. `git status --porcelain -uall` does not report an excluded file, so the dirty-checkout and drift checks stay quiet. Same mechanism as the plan files (`.plans/`, legacy `.claude/plans/` — #488) |
| labels `in-progress`, `deps-checked`, `agent-filed`, `epic` | the tracker (metadata, not files) | the load-bearing subset a session itself writes. Every other convention label is opt-in by use (`colab labels --ensure --minimal`) |
| an operating note, `CLAUDE.local.md` | the local clone, excluded | carries the rules the owner's repo cannot: "our trunk is the integration branch; never touch the owner's trunk; autopilot stays off" |
| the worktree subdir (`.worktrees/`) | excluded | an adopted repo hides it in its committed `.gitignore`; the owner's repo does not, so without this line every worktree shows up in the main checkout's `git status` |
| registry entry | the operator's machine | already local |
| CI templates, CODEOWNERS, the `CLAUDE.md` block, the topic | **not needed** | nothing in claim, start or ship gates on them, and each would be a commit or setting the owner never asked for |

**The pattern, the one command, and delivering to the owner** — `trunk:` names the fleet's own
integration branch, `colab adopt --local` writes the local descriptor, and `colab deliver` offers one
pull request the owner merges himself: [`tools/docs/adoption.md`](../../tools/docs/adoption.md#a-repo-you-dont-own--the-integration-branch-and-colab-deliver) (#640).

**Traps, each measured:**

- **A `.gitignore` entry is itself a tracked file.** Hiding the descriptor that way is
  exactly the commit you are avoiding. The local-only mechanism is `.git/info/exclude`
  (in the common git dir, so it covers every worktree).
- **Scheduled autopilot must stay OFF on such a repo.**
- **`colab ship` still gates on CI at the integration branch's head.** The workflows are
  the owner's. If none runs on push to the integration branch, every ship reads "no run"
  as human-gated and needs a `ci-granted` exemption per branch. Find out which case you
  are in before the first ship. The audit reports an ungated integration branch as an
  advisory here, not a failure.
- **The main checkout must rest on the integration branch**, not on the owner's trunk
  where a fresh clone lands. Otherwise `ship` refuses with "trunk checkout not ready".
- **A dashboard's cached repo scan does not pick the repo up** until it is refreshed.

**The audit recognises the state.** A local audit reports `⌂ adopted locally, not
committed` instead of "not adopted", and asks only for the four labels. It flags the
accident the mechanism exists to prevent: a descriptor that is untracked but **not**
excluded, one `git add -A` away from the owner's history. A remote audit reads the forge,
where the file never exists, so only a local audit can see this state.

**Prefer full adoption instead** whenever the owner is willing to carry the files. Local
adoption is a working arrangement for one operator's clones, not a substitute. Why, with
the measured case: [ADR 539](../../docs/adr/539-adoption-repo-you-dont-own-rationale.md).

### A fork of an upstream — a repo you own that tracks one you don't (#449)

The two paths above cover a repo you own and a repo you don't. A third shape sits between
them: **a fork you own that keeps merging from an upstream you don't.** The fork is yours,
so it adopts in full — descriptor, labels, CI, registration, all committed. But some files
in it belong to the upstream: its `CLAUDE.md`, its `AGENTS.md`, and often an agent
workflow of its own.

**`colab adopt` detects it, never asks.** It looks for a remote named `upstream` whose URL
differs from `origin`'s. `--fork` asserts the shape when the upstream remote has another
name, and `--no-fork` denies it when a remote called `upstream` means something else.
The remote is the fact, and one key records it: `instruction-files: upstream`, which adopt
writes on a fork because CI has no `upstream` remote to read (#602). Nothing else is written.

Four things change from [*Any repo, first-time adoption*](#any-repo-first-time-adoption):

1. **Step 5 is append-only.** Paste
   [`templates/repo-CLAUDE-block.md`](../../templates/repo-CLAUDE-block.md) at the **end** of
   the upstream's `CLAUDE.md`. Leave the upstream's prose where it is, leave `AGENTS.md`
   alone, and record the append in whatever list the fork keeps of its patches against the
   upstream.
   - **Upstream has no `CLAUDE.md`?** `colab adopt` writes one. With an upstream
     `AGENTS.md` it is the usual shell (`@AGENTS.md` plus the block). Without one it is
     the block alone, and adopt writes **no** `AGENTS.md` stub.
   - **`CLAUDE.local.md` instead** only when the fork must stay byte-identical to the
     upstream (a pure mirror).
   - **Declare `instruction-files: upstream`** ([schema](../../project.schema.md#instruction-files--optional)).
     The instruction-file check (audit, hook, CI) then skips the upstream's files, so an
     upstream sync that touches them never turns trunk red. Without it, `prose-in-claude-md`
     fails wherever the ratchet trips. Decline `handbook-sync`'s `AGENTS.md` graft.
2. **The upstream's agent workflow stays where it is, and the appended block says which
   flow governs.** An upstream can ship skills and commands under `.claude/skills/` and
   `.claude/commands/`. Deleting or editing it is a fork patch with the same merge cost as
   step 5, so don't. Add one line inside the appended block instead: *work on this fork
   runs the `code-*` flow; the upstream's workflow is how changes are contributed back to
   the upstream, not how this fork ships.* `colab adopt` names the upstream's skill and
   command entries in its remaining steps so that this line gets written.
3. **Declare `migrations:` (step 2) before the first ship.** Why, with the measurements:
   [ADR 539](../../docs/adr/539-adoption-fork-rationale.md).
4. **The upstream's `CODEOWNERS` is inert here.** Its teams belong to the upstream's org, so
   `colab ship` ignores them and the core-path rule stays off until the fork writes owners of
   its own ([§2, *Core paths*](../../CONVENTIONS.md#core-paths--a-pr-and-a-non-author-approval-before-landing-350)).
   `colab adopt` names those teams. Leave the file alone unless some paths here need a review.

Everything else in §9 applies unchanged: the five questions, labels, the topic, CI and
registration. `trunk:` names a branch of the fork, the one its sessions merge into. Upstream
merges come into the fork, and nothing is pushed to the upstream's branches.
