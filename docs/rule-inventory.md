# Rule inventory — CONVENTIONS.md + project.schema.md

**Find-only deliverable for #160.** One row per normative rule extracted from
`CONVENTIONS.md` and `project.schema.md`, measured at `origin/main` (never from a
checkout — see Method below). This document changes no other file. Review of the
planned rewrite (the "compact reissue" epic) happens against this list, not
against the prose diff: a rule that never made it onto this list cannot show up
as an unticked row later — it just quietly stops existing.

## Method

- Measured from `git show origin/main:CONVENTIONS.md` (2,055 lines) and
  `git show origin/main:project.schema.md` (532 lines), at commit `4b46c08`
  (2026-08-07) — never from a working-tree checkout, per the issue's own
  correction of an earlier, stale-checkout measurement.
- **rule** — the requirement, one sentence, imperative.
- **section** — the `##`/`###`/`####` heading it currently lives under (using the
  doc's own anchors so a reviewer can jump straight there).
- **measured claim** — the number that justifies the rule, verbatim from the
  prose, or `none` when the rule is stated with no supporting measurement.
- **source** — the GitHub issue that produced the rule (`#NN`), or `unknown` when
  the prose cites no issue.
- **kind** — `hard rule` (no exception without a separate human-only door) ·
  `default` (the ordinary case; an explicit field/flag changes it) · `advisory`
  (a should, not a must — the audit reports it, nothing blocks on it) ·
  `explanation` (motivates a rule elsewhere; not itself an obligation).
- Bold-lead statements were used as the starting index (143 matches for
  `^-? ?\*\*[^*]{3,150}\*\*`), then the whole 2,055+532 lines were read straight
  through to catch rules stated in plain prose or only implied by an example —
  the issue's own sizing note said to expect exactly that.
- **178 rows was the floor; 430 is the result** — consistent with the issue's
  own "expect roughly 178 rows... floor not target" against the pre-trim
  document. The trimmed document still yields far more rows than that floor
  because each `####` gotcha subsection (Migration exemption, Red-trunk
  exemption, Scheduled drivers, Grouping, Delivery type, etc.) turned out to
  carry 8-15 distinct obligations once read line by line, not the 1-2 a
  bold-lead scan alone would suggest — the gap between 178 and 430 is itself
  the finding about where rules hide.

---

## §1 — The model in one picture

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 1 | Tier is decided by two questions: does the repo deploy to production, and if so, what gates that deploy. | none | unknown | explanation |
| 2 | Tier B has zero gates between a merge and users (no production). | none | unknown | hard rule |
| 3 | Tier C has one gate: the `dev`→`main` promotion itself is the deploy. | none | unknown | hard rule |
| 4 | Tier A has two gates: the promotion, then the tag. | none | unknown | hard rule |
| 5 | Tier B is the default; a repo starts there and stays until something actually consumes a release. | none | unknown | default |
| 6 | Do not create a `dev` branch "to be ready" before a repo is genuinely Tier A/C. | none | unknown | hard rule |
| 7 | `main` on Tier A is a pure release branch — work is promoted to it, not landed on it. | none | unknown | explanation |
| 8 | The dev/main split exists to keep an expensive test suite off every session merge, running it only at promotion time. | none | unknown | explanation |
| 9 | If a repo's test suite is fast, it does not need Tier A — the split answers slow CI, not seriousness. | none | unknown | advisory |

## §2 — Tiers

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 10 | A, B, C are labels describing pipeline shape, not a maturity/quality grade — never "upgrade" a repo's tier to be helpful. | none | unknown | hard rule |
| 11 | The first tier question is whether a production target exists *today*, not whether deploying is automated; an imminent launch is still B. | none | unknown | hard rule |
| 12 | The second question (once production exists): does a deliberate release artifact gate it (A), or does the promotion itself ship (C)? | none | unknown | hard rule |
| 13 | A repo that is live but ships by hand is Tier A with `deploy: manual`, naming its procedure in `runbook:` — never Tier B. | none | unknown | hard rule |
| 14 | Forcing a live repo to Tier B would make it declare `production: null`, a lie about a live product — forbidden. | none | unknown | hard rule |
| 15 | Hand-deployed Tier A keeps the dev/main split: `main` = what is currently running, `dev` = where sessions land, and the promotion is the deliberate "about to deploy" act — the only record of what shipped and when. | none | unknown | explanation |
| 16 | A tag-gated Tier A (`deploy: tag`) may collapse to a single trunk `main`, because the tag itself marks the release boundary and a second branch marking the same boundary is redundant. | none | unknown | default |
| 17 | In the single-trunk tag-gated shape, an external GitOps poller may fast-forward a watched release branch on tag push, with the deploy running outside CI and no in-repo deploy workflow by design. | none | unknown | explanation |
| 18 | Wherever the deploy runs outside CI (manual hand-deploy, or a tag deployed by an external poller), the path to production must be committed as `runbook:`. | none | unknown | hard rule |
| 19 | A repo using the single-trunk tag-gated shape must name its release branch in `releaseBranch:`. | none | #63 | hard rule |
| 20 | Undeclared, `colab doctor` misreads a release branch (an ancestor of trunk between releases) as safe to delete. | none | #63 | explanation |
| 21 | Tier C exists because a tag ritual nobody honours is worse than no tag ritual — it is a distinct, honest gate-count, not a lesser A. | none | unknown | explanation |
| 22 | Deploying straight off a `main` push meets Tier C's contract, not Tier A's. | none | unknown | hard rule |
| 23 | `tier: A` + `deploy: push-main` is a finding; the usual fix is retiering to C, not a pipeline change. | none | unknown | hard rule |
| 24 | Migrating to `deploy: tag`, or declaring a hand-deploy (`deploy: manual` + `runbook:`), remain valid alternatives to retiering when the site has genuinely earned them. | none | unknown | advisory |
| 25 | "Trunk" names a role (the branch sessions merge into), not a fixed branch name — read `project.yml` to learn which branch it is per repo. | none | unknown | explanation |
| 26 | Never create a branch literally named `trunk`. | none | unknown | hard rule |
| 27 | Never *record* the literal word "trunk" in a field that names a branch — the absence of a branch is null, not the word "trunk". | measured: a session's record read `branch: "trunk"`, the merge tool matched by name, found none, and squashed anyway — the same 26-of-30 failure reached by a different path | unknown | hard rule |
| 28 | A tool storing a branch-name field should refuse the literal word "trunk" on write, and should treat "this branch has no claimed issues" as suspicious rather than routine. | none | unknown | advisory |
| 29 | Trunk is the primary integration point but not always the only one — a repo may declare additional long-lived lines in `integration:`. | none | unknown | default |
| 30 | Sessions may be cut from a declared integration line and ship back into it; it is guarded exactly as trunk is. | none | unknown | hard rule |
| 31 | A declared integration line never gets a path to production — nothing in the promote/tag/deploy path reads that field; only a human merging the line into trunk and then promoting reaches users, and tooling refuses to perform that merge. | none | unknown | hard rule |
| 32 | `integration:` is a development-side axis, not a second trunk — `trunk:` stays tier-locked because on A/C it is literally the production spine. | none | unknown | explanation |
| 33 | `trunk:` answers Group A consumers (correctness — worktree classification, landed/delete-safety, cut-from base) uniformly across the whole repo. | none | unknown | hard rule |
| 34 | `trunk:` deliberately does NOT answer Group B ("which line does *this checkout* serve") — that question is per-host, not per-repo, and gets no descriptor field on any tier. | none | unknown | hard rule |
| 35 | A per-host deploy-target mechanism (env var, machine-local config) is each repo's own call outside the schema — the handbook has no opinion between them. | none | unknown | default |
| 36 | Any per-host deploy-target mechanism must **name** a branch, unset-by-default, rather than widen or disable the gate it overrides (e.g. an `HEAD == trunk` safety check for unattended rebuild-and-restart). | none | unknown | hard rule |
| 37 | A repo running on N hosts with N lines stays one repo with one descriptor — never N repos, N descriptors, or a second entry in `trunk:`/`integration:`. | none | unknown | hard rule |
| 38 | `ceremony: light` lets a repo scale down record-keeping depth (thinner Issue narration, skip Phase B evidence comments) — never the rails protecting other sessions/the fleet (claim discipline, worktree isolation, reserved ports, squash + `Closes #N`, CI secret scan). | none | unknown | default |
| 39 | A `ceremony: light` repo must have `production: null`. | none | unknown | hard rule |
| 40 | A `ceremony: light` repo may not combine with `autonomy: auto-trunk`. | none | unknown | hard rule |

## §2 — Solo flow (`ceremony: light` only)

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 41 | `colab solo`'s entry gate checks fresh on every invocation, never from a cached answer: no live solo session already open, no worktree, no claim, checkout on trunk with no unpushed branch anywhere in the repo, and a clean (tracked + untracked) tree. | none | unknown | hard rule |
| 42 | Anything held by the entry gate refuses outright — full ceremony, no exception, no partial credit for "mostly clean". | none | unknown | hard rule |
| 43 | On a file-synced checkout, the residual sync-window race in the entry gate's cross-machine visibility is accepted deliberately. | none | unknown | explanation |
| 44 | In solo flow, small Conventional Commits go straight to trunk; CI validates after the push. | none | unknown | default |
| 45 | In solo flow an Issue is filed on demand (recording a decision, or work spanning more than one sitting), never on entry. | none | unknown | default |
| 46 | `colab solo --done` re-derives fresh (tree clean, everything pushed) rather than tearing down a worktree/claim that solo flow never made. | none | unknown | hard rule |
| 47 | Solo flow never relaxes: CI secret scan, reserved ports, Conventional Commits, `production: null`, not `autonomy: auto-trunk`, and no scheduled driver. | none | unknown | hard rule |
| 48 | A scheduled driver is doubly incompatible with solo flow, because a driver planning against a repo reads its Issues, and a solo repo may have none open at all. | none | unknown | explanation |
| 49 | A repo touched by more than one session can never legally run solo flow — the very check the entry gate performs is false by construction the moment a second session exists. | none | unknown | hard rule |
| 50 | `ceremony: light` is necessary but not sufficient for solo flow: a light repo currently hosting someone else's worktree still fails `colab solo`'s check, correctly. | none | unknown | hard rule |
| 51 | A consumer inferring activity purely from worktrees/claims will under-report a solo session — fixing that is each such consumer's own call, not mandated here. | none | unknown | advisory |

## §3 — `.github/project.yml` — the marker

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 52 | Every repo commits `.github/project.yml` so state is knowable with zero API calls, even with no GitHub remote at all. | none | unknown | hard rule |
| 53 | `deploy` says **how** production is reached, never **whether** it exists — that is `tier`'s job. | none | unknown | explanation |
| 54 | `deploy: manual` requires `runbook: <path>` naming the documented procedure, and the audit checks the file is really there. | none | unknown | hard rule |
| 55 | `stack` is a free-form string, not a fixed enum — a closed list was tried and immediately failed on a Capacitor app fitting no bucket. | none | unknown | hard rule |
| 56 | A repo mirrors its tier as a GitHub topic (`tier-a`/`tier-b`/`tier-c`) for fleet-wide discovery; the file remains the source of truth. | none | unknown | default |

## §3 — Boot recipe

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 57 | `ports:` declares only *where* a trunk dev server listens; nothing in the schema declares *how* it starts. | none | unknown | explanation |
| 58 | If `<repo>/.colab/dev` exists and is executable, that is the repo's boot recipe — no arguments, foreground, exits when the server stops. | none | unknown | hard rule |
| 59 | Absent a `.colab/dev`, a caller falls back to its own ecosystem default exactly as before. | none | unknown | default |
| 60 | A boot recipe belongs beside the code (`.colab/dev`), not in the shared `project.yml` schema, because it changes with the code's own history. | none | unknown | explanation |
| 61 | A start must be verified by the declared port accepting a connection, never by the process manager's exit code. | measured: a session's command died on the spot yet was reported as a "succeeded" start, leaving the port dead indefinitely with nothing to flag it | unknown | hard rule |

## §4 — Branches and commits

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 62 | Branch names must match `^(feat\|fix\|docs\|chore\|refactor\|test\|perf)/[a-z0-9._-]+$`. | none | unknown | hard rule |
| 63 | Convention is `<type>/<slug>-<issue-number>`, putting the issue number in the name so claim registry, worktree, and Issue line up without a lookup table. | none | unknown | default |
| 64 | A branch carrying a group of related issues suffixes them all in the branch name (`fix/import-fixes-115-114-113`). | none | unknown | hard rule |
| 65 | Every issue in a group must be claimed before starting work on the shared branch. | none | unknown | hard rule |
| 66 | Every claim in a group is released together when the session wraps — unconditionally, including issues that did not get finished. | none | unknown | hard rule |
| 67 | A group (issues that must move together because they touch the same code) is recorded with trailing numbers in a branch name; a chain (issues that must happen in order, across separate branches) is recorded as a dependency instead — never by a branch name. | none | unknown | hard rule |
| 68 | Branches that predate adoption are grandfathered — do not rename them; several may be checked out in live worktrees. | none | unknown | hard rule |
| 69 | Apply the branch-naming convention to new branches only. | none | unknown | default |
| 70 | Never branch off another feature branch — always branch off the current trunk, or a declared integration line. | none | unknown | hard rule |
| 71 | "Declared" (a commit in the repo, via `integration:`) is what separates a legitimate second base from an ad hoc one — never a habit. | none | unknown | hard rule |
| 72 | The base a branch is cut from is a session fact, recorded when the worktree is created; the branch ships back into that same base. | none | unknown | hard rule |
| 73 | Base and merge target are one decision, not two — say which branch you merged into whenever a session is reported done. | none | unknown | hard rule |
| 74 | The main checkout stays on trunk at rest — a worktree is the default, not a preference, because other things (dev server, symlink, scheduled job) read that working tree and do not know it was branched. | measured: a session branched a repo's main checkout for a chore; that repo ran always-on from the tree, so the live app served unmerged feature-branch code until a human noticed by eye | unknown | hard rule |
| 75 | Leaving the main checkout merely dirty is the same fault with a wider blast radius — an uncommitted file there blocks every other session's trunk merge in that repo. | none | unknown | hard rule |
| 76 | A plain branch (no worktree) is allowed on a repo nothing reads from; taking that path means the session owns returning the checkout to trunk before it wraps. | none | unknown | default |
| 77 | Never reach for a bare `git stash` inside a worktree session — `refs/stash` is one ref per repository, shared by every worktree, not scoped per worktree. | measured: on a repo running 10+ concurrent worktree sessions, one session's `git stash pop` restored a *different* session's uncommitted changes, with a third, unrelated, much older stash sitting in the same shared stack the whole time | unknown | hard rule |
| 78 | Prefer, in order: `git diff`/`git status` to read without moving; targeted `git checkout -- <path>` plus manual re-apply; comparing directly against `origin/<trunk>` — never touching `refs/stash`. | none | unknown | default |
| 79 | If a stash is unavoidable, label the message so a colliding session can tell it apart (`git stash push -m "<issue> wip"`). | none | unknown | advisory |
| 80 | Re-run `git stash list` immediately before touching any `stash@{N}` index — a concurrent push renumbers every existing entry, so a captured index may already point at someone else's work. | none | unknown | hard rule |
| 81 | Commits use Conventional Commits prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`) — this is not decoration, §6 builds the release summary by grouping on these prefixes. | none | unknown | hard rule |
| 82 | A commit with no Conventional Commits prefix is invisible in release notes. | none | unknown | explanation |
| 83 | Feature branch → trunk merges squash, so trunk history is one commit per unit of work. | none | unknown | hard rule |
| 84 | `dev` → `main` promotion (Tiers A and C) merges with `--no-ff`, never squash — the merge commit *is* the release boundary. | none | unknown | hard rule |
| 85 | The merge message must write `Closes #N` (one per issue in the group), not a bare `(#N)` reference — GitHub auto-closes only on the keyword. | measured: 26 of 30 issues sat open with their code long since merged, purely because merges said `(#22)` instead of `Closes #22` | unknown | hard rule |
| 86 | `Closes #N` requires the issue's own scope to be fully accounted for — a mechanical gate, not an honour system. | none | #74 | hard rule |
| 87 | An issue's `## Plan` section must be a real GitHub checklist (`- [ ]` per deliverable) — load-bearing, not decorative. | none | #74 | hard rule |
| 88 | A `## Plan` written as prose with no checkbox cannot be verified mechanically; that shape is a finding, reported but not blocking, and cannot retroactively bind an issue opened before this convention existed. | none | #74 | advisory |
| 89 | `colab ship` parses the checklist before composing the squash body; any claimed issue with an unticked box and no declared `Remainder: #M` gets `Refs #N` instead of `Closes #N` — it stays open, and the redirect is reported, never silent. | none | #74 | hard rule |
| 90 | A hand-merge (no `colab ship`) must run the identical checklist check by reading the same two fields (`gh issue view N --json body,comments`) before writing the commit. | none | #74 | hard rule |
| 91 | The motivating incident for the checklist gate: an issue was closed by squash-merge with a third of its three-section scope unimplemented, because the sections were prose and nothing could have caught it. | measured: one third of a three-section scope unimplemented | #74 | explanation |
| 92 | Every issue a merge closes must be corroborated by git, not by the claim registry alone. | none | #87 | hard rule |
| 93 | The corroboration reads two git-side sources: the branch name's trailing number group, and `#N` references in commit bodies — an issue named by neither is a finding. | measured: a branch carrying #71 and #76 resolved to `[71, 74, 76]` because a co-tenant claimed #74 on the same worktree minutes after merge authorization, with nothing on the branch implementing it | #87 | hard rule |
| 94 | `colab ship` refuses on an uncorroborated issue; a hand merge must perform the same check. | none | #87 | hard rule |
| 95 | Do not resolve an uncorroborated issue by quietly writing `Refs #N` instead of investigating — that hides the collision; `--refs` exists for the case an operator actually means it. | none | #87 | hard rule |
| 96 | A deliverable with no diff still has to close — zero commits is a real outcome (a decision recorded, an investigation concluding "no change needed", an artifact stored outside the repo). | none | #90 | hard rule |
| 97 | `colab ship` detects `landed ∧ zero own commits` (both measured from git, never declared by the session) and switches to evidence-close: post evidence, close each issue, tear down — no merge, no push, no `--allow-empty` marker commit. | none | #90 | hard rule |
| 98 | Evidence-close is gated on the issue already carrying a comment the tool did not write, replacing the otherwise-nice property that the tracker never moves unless trunk moved. | none | #90 | explanation |
| 99 | Before merging to trunk, check that trunk's last CI run is green — and that it actually ran at all. | measured: merged for 12 straight hours into repos whose CI was silently dead (org billing lockout), every run "failed" without starting | unknown | hard rule |
| 100 | Ask readiness by commit, not by recency — `gh run list --branch <trunk> -L 1` reads whatever ran *last*, and under `cancel-in-progress` concurrency a cancelled straggler can outrank a passing run on the same commit. | none | #92 | hard rule |
| 101 | The correct question is "does a completed, successful run exist for this branch's current head sha?" — `colab ship` asks it that way. | none | #92 | hard rule |
| 102 | Asking by commit resolves a FALSE red; a genuinely red trunk (the sha really failed) has a different, human-only door. | none | #105 | explanation |
| 103 | "Has it landed" is never decided by counting commits — a squash-merge mints a new commit with a new sha, so a shipped branch's own commits are never ancestors of its base. | none | unknown | hard rule |
| 104 | Comparing diffs alone also fails: zero commits ahead but a non-empty diff, because the base moved on underneath. | measured: both failure modes measured on live worktrees, one of each, in a single sweep | unknown | hard rule |
| 105 | The landed rule asks directly: does merging this branch into its base change the base's tree at all? | none | unknown | hard rule |
| 106 | Requiring both "ahead" and "diff" signals still leaves one gap open: a squash followed by base movement satisfies both. | measured: five of seven shipped branches in one repo were in this state | unknown | explanation |
| 107 | The landed check is asked against the branch's **base**, which is trunk only by default — a branch cut from a declared line must be measured against that line, not trunk. | none | unknown | hard rule |
| 108 | `unknown` is a real landed-verdict and means cargo — verdicts never round up to `landed`. | none | unknown | hard rule |
| 109 | Git state (`landed`/`cargo`/`unknown`) and claim state (`in-progress`) are two signals, and neither replaces the other — do not collapse them. | none | unknown | hard rule |

## §5 — Claiming work

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 110 | The `in-progress` label plus assignee is the source of truth for "who holds this" because it is visible from any machine, to any person. | none | unknown | hard rule |
| 111 | The `in-progress` label must be created as part of adoption; it does not exist in a fresh repo. | none | unknown | hard rule |
| 112 | The `colab` local cache (`~/.colab/state.json`) is a zero-latency read for same-machine parallel sessions — a cache, not the truth. | none | unknown | explanation |
| 113 | When the local cache and GitHub disagree, GitHub wins. | none | unknown | hard rule |
| 114 | Claim an issue **before** starting, not when opening the PR — an unclaimed issue is fair game. | none | unknown | hard rule |
| 115 | A live claim is enforced, not advisory — `colab claim`/`colab worktree new` refuse an issue with a live claim, naming the holder; `--force` takes over loudly and visibly. | none | unknown | hard rule |
| 116 | The claim-refusal guarantee protects an issue only while the claim is live — since a session releases its whole group at wrap, an unfinished issue is immediately reclaimable; say so on the Issue if you intend to return. | none | unknown | explanation |
| 117 | A claim carries its details as a structured Issue comment: `🔒 Claimed — worktree … branch … host … <timestamp>` on claim, `✅ Released` on release. | none | unknown | hard rule |
| 118 | `code-ship`'s evidence comment (B2b, `ceremony: standard` only) uses the same pattern: an invisible marker line `<!-- colab:evidence sha=<trunk-sha> -->` prepended to free prose. | none | unknown | hard rule |
| 119 | A comment missing the evidence marker (an older wrap, a hand-written one) still counts as evidence — degrade, never gate; no consumer may treat its absence as "no evidence exists". | none | unknown | hard rule |
| 120 | Simultaneous claims break ties deterministically: re-read the issue after claiming; the earliest live claim comment (by `createdAt`) wins, the loser posts `✅ Released (yielded — …)`. | none | unknown | hard rule |
| 121 | Release the claim even if the work did not finish — a stale claim is worse than no claim because it silently blocks others. | none | unknown | hard rule |
| 122 | `colab doctor --prune` frees claims whose worktrees died, so stale state can never block work forever. | none | unknown | hard rule |
| 123 | For long-running work, comment progress onto the Issue — the Issue is the feature's external memory. | none | unknown | hard rule |
| 124 | A long-lived tracking issue may be claimed and referenced (not closed) by a session doing a small hygiene fix in its domain, whose checklist still has open items. | none | unknown | default |
| 125 | Closing a tracking issue at merge would bury its knowledge; instead the merge message says `Refs #N`, which links but does not auto-close. | none | unknown | hard rule |
| 126 | A `tracking` label on an issue is declarative and durable — any session claiming a labelled issue references it automatically. | none | unknown | default |
| 127 | `colab ship --refs <N[,M]>` is the explicit, per-ship alternative for an issue not labelled `tracking`. | none | unknown | default |
| 128 | A tracking issue's claim is released unconditionally, exactly as for a closed issue — only the keyword (`Refs` vs `Closes`) changes. | none | unknown | hard rule |
| 129 | The `tracking` label is deliberately not in the convention label set — its absence breaks no check, so adoption does not provision it and the audit does not report it missing. | none | unknown | explanation |
| 130 | Do not write `Closes #<tracking-issue>` in a commit body — GitHub closes on the keyword regardless of intent, and a message keyword cannot un-close it afterward. | none | unknown | hard rule |
| 131 | `colab ship` detects a tracking issue closed via a stray `Closes #N` in a commit body after the push and warns to reopen it by hand. | none | unknown | hard rule |
| 132 | `colab ship` automatically drops a stale `Refs #N` (written while an issue was open, now one of the branch's own `Closes #N`) before the push, rather than shipping a commit that says both. | none | #58 | hard rule |

## §5 — Provenance

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 133 | An agent filing an issue on its own initiative labels it `agent-filed` and ends the body with `Filed-by: agent (during code-wrap of #NN, session <name>)` (or `boss`, when transcribing a human decision). | none | unknown | hard rule |
| 134 | No label means a human filed the issue — the default, so existing issues need no backfill. | none | unknown | default |
| 135 | Provenance is whose *intent* it was, not whose keyboard typed it — an agent transcribing a person's decision writes `Filed-by: boss` with no label; an agent noticing a problem itself is `agent-filed` even if a human was in the room. | none | unknown | hard rule |
| 136 | The `Filed-by:` line is the durable record and stands alone; the `agent-filed` label exists only so the distinction is queryable without reading bodies — write both. | none | unknown | hard rule |
| 137 | Anything that starts work in bulk (a start button, batch triage, a scheduled sweep) must be able to exclude work no human approved, via the `agent-filed` label. | none | unknown | hard rule |

## §5 — Ask (#89)

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 138 | An `agent-filed` issue ends its body with `Ask: permission \| backlog \| ruling \| deferred(<trigger>)`, declaring what kind of decision the issue is waiting on. | measured: a live 34-item approve queue (2026-08-01) required six ask-classes detected only heuristically, from labels and title phrasing | #89 | hard rule |
| 139 | `permission` — asking to touch machine or production state before the agent proceeds. | none | #89 | explanation |
| 140 | `backlog` — a work proposal someone should accept and schedule, not a decision in itself; also the default when the `Ask:` line is absent. | none | #89 | default |
| 141 | `ruling` — a question resolving to human judgment, never startable as code — same class as `needs-ruling` and *Scheduled drivers*'s exclusions. | none | #89 | hard rule |
| 142 | `deferred(<trigger>)` — the filer has already decided no action is needed now; the issue carries its own wake condition. | none | #89 | explanation |
| 143 | Absent `Ask:` line means `backlog` — every `agent-filed` issue written before this convention reads as the common case with no backfill required. | none | #89 | default |
| 144 | A decision surface groups by the `Ask:` line instead of re-deriving the lane from title text. | none | #89 | advisory |
| 145 | `Ask:` is written at filing time, by whoever files — not reconstructed after the fact by a later reader. | none | #89 | hard rule |
| 146 | The `Ask:` line only ever appears on `agent-filed` issues — a human filing for a human audience needs no machine-readable ask class. | none | #89 | hard rule |

## §5 — Readiness

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 147 | An issue is ready to start only when open, unclaimed, **and** nothing it depends on is still missing. | none | unknown | hard rule |
| 148 | Dependencies must be recorded in GitHub's own relationship model (sub-issues for parent/child, blocked-by for sequence), not in prose — prose cannot block a parallel session and no tool can read it. | measured: one repo's epic tracking ~14 children by hand-edited checklist reported `subIssues.totalCount = 0` | unknown | hard rule |
| 149 | Writing a dependency (`blocked_by`) uses the REST endpoint keyed by the **database** id, obtained via `gh api repos/{owner}/{repo}/issues/<M> -q .id` — never the issue number. | none | unknown | hard rule |
| 150 | Writing a parent/child relation (`addSubIssue`/`removeSubIssue`) uses the GraphQL mutation keyed by the **node** id, obtained via `gh issue view <M> --json id -q .id`. | none | unknown | hard rule |
| 151 | `removeSubIssue` requires both parent and child node ids — a child cannot be detached by naming only itself. | none | unknown | hard rule |
| 152 | The REST dependency endpoint silently accepts an issue number as if it were a database id and succeeds, attaching a blocker from whichever issue happens to hold that id anywhere on GitHub. | measured: `issue_id=34` silently attached a blocker from a repository owned by a stranger, unrelated in every way | unknown | hard rule |
| 153 | Read `blockedBy` back after every write — a dependency created by mistake is invisible at the moment it is created otherwise. | none | unknown | hard rule |
| 154 | Read confirmation from the `blockedBy`/`blocking` connections, never from `issueDependenciesSummary` — the summary lags the graph by a few seconds. | measured: seconds after a `blocked_by` POST, `blockedBy.totalCount` read `1` while `issueDependenciesSummary.blockedBy` in the same payload still read `0` | unknown | hard rule |
| 155 | "No blockers" and "nobody checked for blockers" are the same empty list — the second state needs its own marker (`deps-checked`) and must never be read as "ready". | none | unknown | hard rule |
| 156 | `colab readiness <N>` is the owner of the `deps-checked` write where `colab` is installed; the raw `gh issue edit` label toggle is the portable fallback. | none | unknown | default |
| 157 | The `deps-checked` label is derived state, only as fresh as its last check — whoever adds a blocker removes it; prefer leaving it off to leaving it wrong. | none | unknown | hard rule |
| 158 | A prose note saying "checked, no blockers" does not count as `deps-checked`. | none | unknown | hard rule |

## §5 — Readiness is not a boolean

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 159 | The readiness verdict has four values: unchecked (no relationship data — not ready), blocked (open, nobody started it), ready-with-a-note (open, code pushed and unmerged), ready (closed, or its work is already on trunk). | none | unknown | hard rule |
| 160 | The "ready, with a note" middle value is computed at read time from the relationship plus the blocker's state — never recorded as a second label. | none | unknown | hard rule |
| 161 | Rejected alternative: a second label for the soft case — stale the moment the blocker moves, doubling the hazard `deps-checked` already carries. | none | unknown | explanation |
| 162 | Rejected alternative: deleting the edge once the blocker's code is written — destroys a true fact and does not survive the blocker being reverted. | none | unknown | explanation |
| 163 | An active session on the blocker is not evidence that it is unblocked — only a pushed branch with real commits is. | measured: a session open ten minutes was already dead, having never claimed the issue it was opened for | unknown | hard rule |
| 164 | An unpushed branch does not count either — work invisible from other machines cannot be seen, reviewed, or merged by anyone waiting on it. | none | unknown | hard rule |
| 165 | The readiness judgement fails toward `blocked`, never toward `ready`, mirroring the landed rule's refusal to fail toward `landed`. | none | unknown | hard rule |
| 166 | `tools/lib/readiness.js` (`classify`, `isStartable`) is pure — facts in, verdict out — and derives "is the blocker's code written but unmerged" from `tools/lib/landed.js` rather than re-counting commits. | none | unknown | explanation |

## §5 — Mechanical readiness (#69)

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 167 | A mechanical check must never be allowed to write `deps-checked` itself — that would launder a weaker guarantee ("the graph is empty") into a stronger one ("somebody looked", including prose-only blockers). | none | #69 | hard rule |
| 168 | A mechanical read of an empty dependency graph writes a distinct label, `graph-empty`, not a same-meaning color of `deps-checked`. | none | #69 | hard rule |
| 169 | `colab readiness <N> --mechanical` re-derives its own evidence by reading `blockedBy` itself, rather than trusting a caller-supplied flag. | none | #69 | hard rule |
| 170 | The `--mechanical` write posts a receipt comment naming what was read and when (`blockedBy totalCount = 0, read <timestamp>`). | none | #69 | hard rule |
| 171 | `--mechanical` checks `blockedBy` (blocking) only — it says nothing about parent/child (`epic`/`subIssuesSummary`) relations, which are covered separately. | none | #69 | hard rule |
| 172 | `readiness.classify()` keeps `graphEmpty` and `depsChecked` as distinct type-level inputs; an empty-but-unchecked blocker list reads a fourth verdict, `unchecked-mechanical`, and `isStartable()` still says no by default. | none | #69 | hard rule |
| 173 | `graph-empty` is not in the convention label set — nothing unattended reads it yet, so adoption does not provision it and the audit does not report it missing. | none | #69 | explanation |
| 174 | No `readiness.marked` notify event fires for `--mechanical` — the receiver has agreed that event kind's payload means `deps-checked` specifically, and emitting it for the weaker fact would be indistinguishable from the stronger claim. | none | #69, #45, #46 | hard rule |

## §5 — Design ruling

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 175 | A designer producing a spec decides, while producing it, whether a surface needs human pre-approval before code starts, and marks the issue `needs-ruling` if so. | none | unknown | hard rule |
| 176 | Triage may pre-flag obvious cases, but the call belongs to whoever is producing the spec — no mechanical rule infers it from title or labels. | none | unknown | hard rule |
| 177 | `needs-ruling` blocks starting the issue — a readiness gate exactly like an open hard blocker or a live `in-progress` claim — until a human reviews the artifact and removes the label. | none | unknown | hard rule |
| 178 | No session, manual or scheduled, starts an issue that still carries `needs-ruling`. | none | unknown | hard rule |
| 179 | A session discovering a significant design decision mid-work (one the spec did not anticipate) continues on the designer's spec rather than stopping to request a ruling. | none | unknown | default |
| 180 | Such a session records `design-not-preapproved` in its ship evidence, so the closure itself is what a human reviews, after the fact. | none | unknown | hard rule |

## §5 — Migration exemption (#98)

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 181 | `colab ship` refuses, by default, with no flag/env var/`project.yml` field to lower the bar, any branch touching `database/migrations/` or `prisma/migrations/`. | none | #98 | hard rule |
| 182 | A migration grant is a narrow, per-issue, branch-bound, human-only, expiring exemption from the no-new-migrations gate — deliberately not a repo-level or tier-level switch. | none | #98 | hard rule |
| 183 | `colab migration-grant` refuses (exit 1) unless `COLAB_HUMAN=1` is set, checked before any network call — no agent may create a grant or infer one from an issue's content, age, or repeat parking. | none | #98 | hard rule |
| 184 | A migration grant marker is two required parts: a `migration-granted` label (requires write/triage permission) and a comment naming the exact branch (labels cap at 50 characters, so a label alone cannot carry the branch name). | none | #98 | hard rule |
| 185 | A migration grant issued for one branch never authorizes a migration arriving on a different branch later. | none | #98 | hard rule |
| 186 | A migration grant expires the instant its issue closes — `ship` reads the issue's live open/closed state, never a separate expiry date. | none | #98 | hard rule |
| 187 | Both the label and the comment for a migration grant live on the tracker, visible from any machine — no local-only fallback for creating, revoking, or reading one. | none | #98 | hard rule |
| 188 | A migration grant covers the whole ship set, not one member of it — `ship` validates it over every issue the branch carries, never narrowed by `--refs`. | none | #98 | hard rule |
| 189 | `--revoke` removes the `migration-granted` label first (restoring the gate immediately), then posts a receipt comment. | none | #98 | hard rule |
| 190 | `colab migration-grant --list` names every issue with a live grant right now. | none | #98 | advisory |
| 191 | A migration grant never weakens any other precondition — CI green, claim corroboration, the trunk-checkout check, and the hand-merge conflict check all still run in full on a granted branch. | none | #98 | hard rule |

## §5 — Red-trunk exemption (#105)

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 192 | A CI grant follows the migration grant's shape but is strictly more dangerous — a bad migration grant merges one reviewed schema change, a bad CI grant merges into a repo whose own test suite is known-failing. | none | #105 | explanation |
| 193 | `colab ci-grant` refuses (exit 1) unless `COLAB_HUMAN=1` — identical bar and mechanism to the migration grant. | none | #105 | hard rule |
| 194 | A CI grant is bound to one issue, the branch, AND the exact red trunk sha it was reviewed against — it expires the instant trunk's head moves, for any reason. | none | #105 | hard rule |
| 195 | Creating a CI grant requires a measured, completed, successful CI run for the branch's own current head sha — a human's say-so alone is never enough; `--evidence-run` is recording-only and can never substitute for the measured run. | none | #105 | hard rule |
| 196 | A CI grant never stacks — creating one refuses against a green trunk (nothing to exempt), and refuses again if a prior CI grant already merged something and trunk has been red continuously since. | none | #105 | hard rule |
| 197 | A grant-authorized merge carries a `CI-Grant:` trailer in the squash commit itself, in addition to the tracker comment, so the artifact survives a later tracker read failure. | none | #105 | hard rule |
| 198 | The CI-grant exemption is scoped narrowly and mechanically to exactly one precondition (trunk-CI-green, via `shipCiCheck`) — it never exempts no-new-migrations, claim corroboration, the trunk-checkout check, the hand-merge conflict preview, or `colab promote`. | none | #105 | hard rule |
| 199 | The CI-grant exemption is trunk-only — an integration line's red already borrows trunk's advisory verdict when the line has no runs of its own, and widening the exemption to lines is a deliberately unmade decision. | none | #105 | hard rule |

## §5 — Scheduled drivers

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 200 | A scheduled driver inherits the provenance gate rather than replacing it — `agent-filed` issues are excluded from what it starts, re-applied on every tick, not filtered once and remembered. | none | unknown | hard rule |
| 201 | `epic`-labelled issues are excluded from what a scheduler starts — an epic can pass provenance and readiness cleanly and still not be a pick-up-and-code task. | none | unknown | hard rule |
| 202 | `needs-ruling` issues are excluded from what a scheduler starts, for a third distinct reason: no human has approved the design, even if the work item itself is human-filed, unblocked, and a genuine leaf task. | none | unknown | hard rule |
| 203 | The only admission past `agent-filed`/`epic`/`needs-ruling` exclusion is a human act on the issue itself, removing the label — a scheduler may never infer approval from content, age, or repeat proposal. | none | unknown | hard rule |
| 204 | An `agent-filed` issue whose `Ask:` line reads `ruling` or `permission` is excluded from what a scheduler starts, for the same reason `needs-ruling` is. | none | unknown | hard rule |
| 205 | A scheduler starts work only by spawning ordinary sessions (`code-triage` → `code-start` → work → `code-wrap` → where granted, `code-ship`) — it may not claim, label, comment, or merge directly. | none | unknown | hard rule |
| 206 | A scheduler may complete a trunk merge only where the repo has granted `autonomy: auto-trunk`, and only through `colab ship`, subject to the identical gates as any other caller (CI green or valid CI grant, no new migrations or valid migration grant, no hand-merge conflict, no `--force`). | none | unknown | hard rule |
| 207 | A repo without `autonomy: auto-trunk` gates a scheduler exactly as it gates every other agent — `ship` refuses, a human runs Phase B. | none | unknown | hard rule |
| 208 | A genuinely red trunk with no valid CI grant is human-gated, not self-clearing — a scheduler must not queue and wait on it; it parks, states it once, and stops. | none | unknown | hard rule |
| 209 | A scheduler never promotes (`colab promote`) and never tags, on any repo, on any tier, with no field able to say otherwise. | none | unknown | hard rule |
| 210 | A scheduler must tell a self-clearing blocker (temporarily red CI, a billing outage, a regenerable merge conflict) apart from a human-gated one (no `auto-trunk` grant, an unresolved new migration, an `agent-filed` label still on, a claim held by someone else). | none | unknown | hard rule |
| 211 | For a human-gated blocker, a scheduler states it once (a comment or a single log line) and then parks — never re-announcing the same unmet gate every cycle. | none | unknown | hard rule |
| 212 | A migration grant is the one human-gated blocker a driver may watch for clearing without a person acting again mid-cycle — but the grant itself is still only ever created by a human. | none | unknown | hard rule |

## §5 — Grouping

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 213 | Issues that touch the same files must move on one branch — the group is a collision-prevention mechanism, not a tidiness preference. | measured: a real triage run concluded two issues MUST share a branch, printed the `file:line` collision, and had nowhere to record it outside the terminal | unknown | hard rule |
| 214 | A group cannot be encoded as sub-issues (hierarchical — asserts a false parent) or as mutual blocked-by (the readiness gate would then never report either member ready) — it needs a symmetric, flat relationship neither existing mechanism has the shape for. | none | unknown | explanation |
| 215 | A group is recorded as a `group:<key>` label, applied to every member, where `<key>` is the branch slug minus its trailing issue numbers. | none | unknown | hard rule |
| 216 | Each grouped member also gets a comment with machine-readable `Group:` and `Because: <file:line>` lines — the label is what a tool filters on, the `Because:` line is what survives a human asking whether the grouping was right. | none | unknown | hard rule |
| 217 | Re-quote a group's `file:line` from the current tree when writing the `Because:` comment — refs rot. | none | unknown | hard rule |
| 218 | The `group:<key>` label has three states: on two-or-more open issues = grouped (start together or not at all); on exactly one open issue = spent (remove it); absent = ungrouped or nobody triaged — never evidence the ground is clear. | none | unknown | hard rule |
| 219 | Whoever breaks a group removes the label from the members it no longer covers — prefer leaving it off to leaving it wrong. | none | unknown | hard rule |
| 220 | `code-triage` writes the `group:` label; `code-start` reads it before branching. | none | unknown | hard rule |
| 221 | `colab ship`'s B4 tears down the `group:` label OBJECT (not just an issue's use of it) once every member of that group is closed — one fleet repo accumulated ~12 stale `group:*` labels before this existed. | measured: ~12 stale `group:*` labels on one fleet repo; this repo itself grew two more within an hour of adopting them | #82 | hard rule |
| 222 | Deleting a spent `group:` label removes it from future queries only — it never touches closed issues' own timelines or the durable `Because:` comment each member carries. | none | #43 | explanation |
| 223 | Only `group:*` labels are ever in scope for B4's teardown — never the operational label set (`in-progress`, `deps-checked`, `agent-filed`, `epic`). | none | unknown | hard rule |
| 224 | Rejected alternative: "the group is whatever was claimed to one worktree" — it costs no new vocabulary but only exists *after* someone has claimed, so it cannot inform the decision to claim in the first place. | none | unknown | explanation |

## §5 — Scope

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 225 | Reading and diagnosing across repos to find a root cause is expected. | none | unknown | default |
| 226 | Acting in another repo (branching, committing, pushing, rebasing/force-pushing an existing branch, merging) requires that repo's own claim and its own explicit go-ahead, scoped to that repo — even when the diagnosing session is confident it found the real fix. | measured: a session traced a downstream issue to an existing branch in an upstream tool repo, then rebased and force-pushed it with no claim and no go-ahead scoped to that repo; caught and reverted before merging | unknown | hard rule |
| 227 | The correct move on finding a cross-repo root cause is to report the finding (an Issue there, or a comment on the existing branch) and stop. | none | unknown | hard rule |

## §5 — Epics

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 228 | The `epic` label marks a container for sub-issues — informative, never a start candidate, never claimed as a unit of work — even when it passes readiness and provenance cleanly. | none | unknown | hard rule |
| 229 | Secondary signals (`epic(` title prefix, `subIssuesSummary.total > 0`) corroborate but never substitute for the `epic` label as the filterable signal for an unattended tool. | none | unknown | hard rule |
| 230 | `epic` is applied when filing or converting an epic; a scheduler and a triage pass both exclude it from what they start, for a reason distinct from provenance (is it shaped like a task at all, vs. did a human approve it). | none | unknown | hard rule |
| 231 | `epic` lives in the provisioned convention label set (unlike `tracking`) because an unattended driver's decision depends on it. | none | unknown | explanation |
| 232 | An epic still gets closed and referenced exactly as any other issue once its children finish — the `epic` label only prevents a driver from mistaking the map for the territory. | none | unknown | hard rule |

## §5 — Delivery type (#112)

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 233 | Four labels — `delivery:code`, `delivery:content`, `delivery:ops`, `delivery:docs-only` — name whether finishing an issue produces a code commit at all. | none | #112 | hard rule |
| 234 | The delivery classifier is three-valued, not boolean: no label = not asked (behaves as before); `delivery:code` = ordinary pipeline; the other three = non-code, route, do not start. | none | #112 | hard rule |
| 235 | "Not asked" must never collapse into "non-code" — every issue in every tracker is unlabelled the day this set is adopted, and reading absence as non-code would freeze every scheduled driver on day one. | none | #112 | hard rule |
| 236 | `content`/`ops`/`docs-only` gate exactly like `needs-ruling`, not like a softer advisory — not a start candidate for anyone, manual or scheduled, in the code pipeline. | none | #112 | hard rule |
| 237 | A session that lands on a non-code-delivery issue distills the finding onto the issue and ends the session — the same closing move as a design-decision-only issue with no code product. | none | #112 | hard rule |
| 238 | Whoever files or triages an issue sets the `delivery:*` label, deciding the issue's deliverable — no mechanical rule infers it from a title or body (a docs-sounding title can be `delivery:code`; a code-sounding title can be `delivery:ops`). | none | #112 | hard rule |
| 239 | `delivery:*` is in the provisioned convention label set (unlike `tracking` or `group:<key>`) because its four values are fixed and every adopting repo needs them before the first triage pass can classify anything. | none | #112 | explanation |

## §5 — Planning (#94)

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 240 | The session plan is a repo-local scratch file (`.claude/plans/issue-<N>.md`), never an Issue comment — coordinator and implementer sessions share one machine/filesystem, so a file is the cheapest bus and never touches the tracker. | none | #94 | hard rule |
| 241 | The plan file lives in the main checkout, outside any worktree — it must exist before the worktree is created and survive after the worktree's teardown. | none | #94 | hard rule |
| 242 | The plan file is git-excluded and never committed — every adopting repo's own `.gitignore` should carry `.claude/plans/`. | none | #94 | hard rule |
| 243 | Anything in the plan file worth keeping past the session moves to the Issue at wrap. | none | #94 | hard rule |
| 244 | The plan file path must be resolved via `$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`, never a bare relative `.claude/plans/issue-<N>.md` — from inside a worktree the bare path silently resolves to the worktree's own copy instead. | none | #113 | hard rule |
| 245 | Every skill touching the plan file uses the resolved `$PLAN` path — never a bare relative one. | none | #113 | hard rule |
| 246 | The plan ladder has three rungs, the middle the default: rung 0 (nothing, trivial/self-evident oracle), rung 1 (plan-lite, default — intent, files, oracle, stop condition, 3-5 lines at session start), rung 2 (full plan, drafted by `code-plan` — triggered by `needs-plan` or a mid-session escalation). | none | #94 | hard rule |
| 247 | Failing to state rung 1's oracle in one line is itself the signal to stop and ask on the Issue — never guess, never silently drop to rung 0. | none | #94 | hard rule |
| 248 | `code-triage` may flag a group `needs-plan` with a one-line reason comment — a cross-backlog judgement, never a plan of its own; it never drafts the plan itself. | measured: authoring plans at triage time produced stale artifacts for groups reported startable but not started soon | #94 | hard rule |
| 249 | The full plan is drafted at code-session start, inside the implementing session, by a stronger-model planning subagent seeded with the Issue plus the triage reason line — against the repo as it actually is at coding time. | none | #94 | hard rule |
| 250 | A rung-1 stub may still upgrade to rung 2 mid-session on a self-escalation trigger; the `needs-plan` flag decides only the default, never caps the ladder. | none | #94 | hard rule |
| 251 | The `needs-plan` flag must be read by direct issue fetch (`gh issue view <N>`), never the eventually-consistent Search API, which can lag by minutes. | none | #94 | hard rule |
| 252 | A rung-1 or rung-2 plan is a sketch the code is allowed to overrule, not a contract — deviation is noted where the plan lives, so a resuming or grading session reads the actual reasoning rather than a stale sketch. | none | #94 | default |
| 253 | `needs-plan` is provisioned in the label set on adoption and back-filled on sync, like every other fixed convention label — never created on demand the way `group:<key>` is. | none | #94 | hard rule |

## §5 — Writing a conclusion down

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 254 | A prose conclusion reaches trunk as two units, in order: the decision lands on an Issue first (Step 1), then the document is a separate claimed coding unit (Step 2). | none | unknown | hard rule |
| 255 | The Issue comment needs no branch, worktree, or clean tree — it collides with nobody and is readable the instant it is posted; it is also the part that must survive, being the durable form of the decision. | none | unknown | hard rule |
| 256 | The write itself (Step 2) is its own coding unit: own Issue, claim, branch off trunk in a worktree, wrapped normally — a conclusion worth documenting is the *most* consequential kind of doc change, not a typo exempt from ceremony. | none | unknown | hard rule |
| 257 | The collision unit for a docs write is the file (the hunk), never the folder — two sessions each adding a new file under one tree cannot conflict. | none | unknown | hard rule |
| 258 | Before writing a docs change, check who else is editing the target file (not the folder) with `git log --all --not origin/<trunk> --source --format='%S' -- <path>` — empty output (or a nonexistent path) is clean ground; non-empty is a file-level group, requiring the same branch or sequencing after theirs lands. | none | unknown | hard rule |
| 259 | Never write the final artifact in the main checkout — a throwaway draft in a git-ignored scratch directory is fine; the committed version belongs on a branch, in a worktree. | none | unknown | hard rule |
| 260 | Two doc branches landing in the same window are wrapped one at a time, sequentially, never batched — each re-checked against the trunk the other just moved. | none | unknown | hard rule |
| 261 | A branch that never touched a given line still carries that line as diff context — taking its side of a prose conflict wholesale can silently revert the other session's edit while looking like a clean resolution; read the region and resolve as a union when the edits are non-contradictory. | measured: on two adjacent edits to one paragraph, the correct resolution was their union, not either side | unknown | hard rule |

## §5 — Design conclusions are three units

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 262 | A design ruling is a prose conclusion plus one more required part: an immutable visual record of the option that was approved. | none | unknown | hard rule |
| 263 | Unit 1 — the ruling (chosen option, why, what was rejected) goes on the Issue immediately, exactly like Step 1 of a plain conclusion; it is what clears `needs-ruling`. | none | unknown | hard rule |
| 264 | Unit 2 — the artifact is a repo file under `docs/design/`, named `<slug>-<N>-mockup.html` or `<slug>-<N>-spec.md`, landing via a claimed docs branch like any other Step 2. | none | unknown | hard rule |
| 265 | Superseded design artifacts are marked, never deleted — trunk carries the design lineage and a months-old preview link keeps resolving. | none | unknown | hard rule |
| 266 | Unit 3 — the frozen evidence is a screenshot of the approved option attached to the ruling comment, immutable where the repo file is editable; rejected alternatives need never land on trunk — their screenshot on the Issue is the whole record. | none | unknown | hard rule |
| 267 | The index of what lives under `docs/design/` belongs in that directory itself, never accreted into the repo's `CLAUDE.md` — `CLAUDE.md` gets one pointer row. | none | unknown | hard rule |

## §5 — Design exploration files its Issue first

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 268 | The Issue number must exist before the first mockup is drawn, not retrofitted once one is approved — filing is cheaper than a single mockup iteration and is what makes `<slug>-<N>-mockup.html` naming possible at all. | none | unknown | hard rule |
| 269 | A small feature continues on the same design Issue through implementation; a large one turns the design Issue into the `epic` parent, with implementation sub-issues arriving with their own sessions. | none | unknown | default |
| 270 | `ceremony: light` repos are exempt from the design-artifact file ceremony — a mockup lives as a preview link in conversation, and units 1 and 3 collapse into one screenshot-bearing Issue comment. | none | unknown | hard rule |

## §6 — Releases

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 271 | Tier A release: merge `dev` → `main`, then tag — pushing the tag is the deploy trigger; pushing `main` only runs the full test suite. | none | unknown | hard rule |
| 272 | Single-trunk (tag-gated) Tier A release: tag `main` directly — no promotion step; the tag remains the whole gate. | none | unknown | hard rule |
| 273 | Where the deploy is an external GitOps poller, tagging is what the release script keys off — it fast-forwards the watched release branch. | none | unknown | explanation |
| 274 | Tier C release: merge `dev` → `main` with `--no-ff` (never squash) — that merge *is* the deploy; there is no tag step and no "ship it later". | none | unknown | hard rule |
| 275 | Tagging on Tier C is optional and harmless (nothing fires from it); wanting tags consistently is the signal the repo has earned Tier A. | none | unknown | advisory |
| 276 | On a `deploy: manual` repo, the release sequence is the same with the last step performed by a person: promote, tag, then run the runbook — promotion there always requires a human, and `promotion: main-loop` cannot say otherwise. | none | unknown | hard rule |
| 277 | The permission ladder has three rungs: ship (branch→trunk, gated by `autonomy:`), promote (trunk→main, gated by `deploy:` + `promotion:`, safe to automate only where deploy is tag-gated), release (the tag — always a human act, on every repo, with no field able to say otherwise). | none | unknown | hard rule |
| 278 | The `pre-push-guard` hook enforces the ship and promote rungs mechanically; `COLAB_SHIP` never opens `main`. | none | unknown | hard rule |
| 279 | On Tier C the ladder has two rungs, not three, and the second (promotion) is the deploy — promotion always requires `COLAB_HUMAN=1` there; `promotion: main-loop` applies only where `deploy: tag` makes promotion verification-only, so it can never apply to C. | none | unknown | hard rule |
| 280 | Versioning follows SemVer; patch for fixes, minor for features, major for breaking changes. Pre-1.0 repos use `v0.x.y`, treating minor as "meaningful increment". | none | unknown | default |
| 281 | Every tag gets a release summary — a published GitHub Release grouping commits since the previous tag by Conventional-Commit type; `CHANGELOG.md` is not maintained by hand. | none | unknown | hard rule |
| 282 | When the automated release-notes workflow cannot run, the summary is still owed — the manual fallback is `colab release-notes v1.1.0..v1.2.0 \| gh release create v1.2.0 --notes-file - --generate-notes`. | none | unknown | hard rule |
| 283 | Merged is not released — the gap must be measured (`colab release-status`), not noticed by eye, and it flags whichever gap holds a `fix:`-typed or breaking commit as the class that has bitten before (once, in payroll). | none | #81 | hard rule |
| 284 | `colab release-status` measures the release lag against `main`, not `dev` — `git describe` run from a `dev` checkout answers a stale question. | none | #81 | hard rule |
| 285 | `colab release-status`'s suggested next SemVer bump is advisory only — the version number stays the human's. | none | #81 | default |
| 286 | Do not tag from `dev`. Do not tag a commit that has not passed the full suite on `main`. | none | unknown | hard rule |

## §7 — CI and toolchain

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 287 | CI lives in each repo and belongs to it — the handbook ships copyable starting points but nothing is called remotely and nothing is mandatory. | none | unknown | explanation |
| 288 | Every pull request must run, at minimum, a secret scan and a build — a committed credential is the one failure that cannot be undone by reverting. | none | unknown | hard rule |
| 289 | CI must trigger on pushes to the trunk itself, not only on branches the trunk no longer is. | measured: three repos whose trunks had moved to `dev` while CI still fired only on `[main, master]` — every trunk merge ran zero checks, silently | unknown | hard rule |
| 290 | When a repo's trunk moves, updating the CI triggers is part of the move, and the audit checks it. | none | unknown | hard rule |
| 291 | Toolchain version resolution follows strict precedence: `.github/project.yml` toolchain keys win; else the ecosystem's own manifest; else fail the build — never fall back to a silent default. | none | unknown | hard rule |
| 292 | A silent toolchain default is how one repo built on Node 20 while deploying on Node 22, undetected for months — failing loudly is cheaper than debugging a version skew in production. | measured: the mismatch survived for months | unknown | explanation |
| 293 | When project.yml's toolchain pin and the ecosystem manifest disagree, that is a finding to report, not something to quietly resolve. | none | unknown | hard rule |
| 294 | `requirements.txt` does not declare an interpreter — it pins dependencies only; a Python repo carrying only that file must add `python:` to `project.yml` or a `.python-version`. | measured: a Python repo adopted the handbook, found no Python template, and copied the Node one with `python-version: "3.13"` hardcoded into it | unknown | hard rule |
| 295 | A missing template is not a neutral absence — it redirects adoption into a worse form and leaves behind a file whose header lies about what it is. | none | unknown | explanation |

## §7 — Test fixtures

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 296 | A test asserting a specific message or refusal must neutralise ambient credentials and configuration rather than inherit them. | none | unknown | hard rule |
| 297 | A git fixture that `git init`s and `git commit`s must locally override `core.hooksPath`, because this handbook installs a global one and an override-less fixture runs the developer's real pre-commit hook inside a fake repo. | measured: this happened twice in the identical shape — once with ambient `gh` credentials, once with `core.hooksPath` | unknown | hard rule |
| 298 | A git fixture helper sets `user.email`, `user.name`, AND `core.hooksPath` (pointed at a nonexistent directory) before it ever commits. | none | unknown | hard rule |

## §8 — Conformance and reconciliation

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 299 | Because branch protection is unavailable, conformance is checked from outside by the `audit/` tool, across every owner, including local-only repos with no GitHub presence. | none | unknown | explanation |
| 300 | Run the audit on a schedule; it reports, and only genuine findings fail the exit code. | none | unknown | advisory |
| 301 | Templates are copy-and-own, never called remotely — every copy is stamped with the handbook version it came from, so drift is surfaced by the audit, not by luck. | none | unknown | hard rule |
| 302 | Workflow copies carry a first line `# colab-handbook: <template> @ <version>`; the CLAUDE conventions block carries `<!-- colab-handbook @ <version> -->`. | none | unknown | hard rule |
| 303 | `colab template <name>` copies and stamps a template in one act, refusing to overwrite an existing file without `--force`. | none | unknown | hard rule |
| 304 | The audit compares each stamp against the handbook's git history: a template that changed since the stamped version is a finding ("review the diff, re-copy"); an unstamped copy, an unknown template name, or a stamp newer than the handbook are advisories. | none | unknown | hard rule |
| 305 | A flagged repo is reconciled deliberately: read the diff, take what you want, `colab template <name> --force`, commit — no remote calls, no silent updates. | none | unknown | hard rule |
| 306 | `colab update` classifies every stamped copy and, with `--apply`, refreshes only those still pristine as of their own stamp — it never commits, and never rewrites a hand-edited copy. | none | unknown | hard rule |
| 307 | A stamp older than the current handbook version is not automatically "behind" — behind means the template actually changed since that stamp, checked with `git log <stamp>..HEAD` scoped to the template's own path. | none | unknown | hard rule |
| 308 | The frozen CLI copy is measured against the latest tag, not `HEAD` — a template copy is refreshed from the working tree, a frozen copy from a release. | measured: measured against `HEAD` it reported "behind" for every unreleased CLI commit, the resting state of any development machine, and advised adopting untagged code | unknown | hard rule |
| 309 | An unstamped copy is never rewritten by any flag — unknown lineage means we cannot know what replacing it would destroy; a human re-copies deliberately. | none | unknown | hard rule |
| 310 | Template provenance is decided by content (the step names the template coined), never by filename — a file merely sharing a template's name is reported `unrelated`, explicitly not something to re-copy, because the advice attached to "looks copied" is `--force`. | none | unknown | hard rule |

## §8 — Labels reconcile too

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 311 | An adopted repo (one with `project.yml`) missing any convention label is a finding, provided the audit can read the label set at all — a remote-less or offline audit stays silent rather than claim a label is missing it simply could not see. | none | unknown | hard rule |
| 312 | Label-set provisioning is idempotent (`\|\| true`) and safe to re-run on every sync, not only at first adoption — this is the mechanism by which a label added in a later handbook version reaches an earlier-adopted repo. | none | unknown | hard rule |

## §8 — The fleet registry is private

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 313 | The list of repos the audit sweeps lives at `~/.colab/repos.txt`, machine-local and never committed, because this handbook repo is public. | none | unknown | hard rule |
| 314 | The committed `audit/repos.txt` is a neutral format example and last-resort fallback only. | none | unknown | explanation |
| 315 | Resolution order for the fleet list: `--config` flag > `~/.colab/repos.txt` > bundled example. | none | unknown | hard rule |

## §9 — Adopting this

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 316 | First-time adoption determines tier by asking whether a deploy target exists today (not "soon") — if yes, whether a tag gates production (A) or the promotion itself deploys (C). | none | unknown | hard rule |
| 317 | Adoption requires writing `.github/project.yml`. | none | unknown | hard rule |
| 318 | Adoption creates the whole convention label set — not a subset — because each powers a check that silently cannot fire while its label is absent. | none | unknown | hard rule |
| 319 | Provisioning uses `\|\| true` so re-running is safe — partial adoption is the normal case. | none | unknown | hard rule |
| 320 | Missing `in-progress` means the first claim cannot land, and `colab claim` keeps a local claim while GitHub holds nothing — a collision reached from underneath. | none | unknown | explanation |
| 321 | Missing `deps-checked` means a readiness check can never tell "free" from "nobody looked" — worse than an absent feature, because a board keeps advising "run triage" and triage is a no-op. | none | unknown | explanation |
| 322 | `agent-filed` must exist before any agent files an issue — its absence means every agent-filed issue reports as human-approved. | none | unknown | hard rule |
| 323 | `epic` must exist before a scheduled driver can tell a container apart from codeable work — absent, an epic passes every readiness gate and reads as a normal start candidate. | none | unknown | hard rule |
| 324 | `needs-ruling` must exist before a designer can mark a surface pending a ruling — absent, that gate cannot be applied at all. | none | unknown | hard rule |
| 325 | `needs-plan` must exist before `code-triage` can flag a hard group — absent, `code-start` always sees "no flag" and every session falls back to the cheap rung-1 stub. | none | unknown | hard rule |
| 326 | `migration-granted` is NOT opt-in (unlike `tracking`/`graph-empty`) — its absence fails malignantly, discovered only when a repo whose entire deliverable is a schema change hits a wall with no route past `ship`'s gate at all. | none | unknown | hard rule |
| 327 | `ci-granted` is likewise not opt-in — its absence fails malignantly the moment a repo's trunk actually goes red with no other way through. | none | unknown | hard rule |
| 328 | All four `delivery:*` values are provisioned together — the set is fixed, and a repo missing even one (most often `delivery:code`) cannot classify every issue's delivery type. | none | unknown | hard rule |
| 329 | The full label set is provisioned again on every sync, not only at adoption — reconciliation creates any convention label a repo is missing, reported as a finding rather than a silently empty column. | none | unknown | hard rule |
| 330 | Adoption adds the tier topic (`tier-a`/`tier-b`/`tier-c`) via `gh repo edit --add-topic`. | none | unknown | hard rule |
| 331 | Adoption adds the handbook pointer block to the repo's `CLAUDE.md`, creating one if none exists — do not skip this; it is the only reason a future agent will ever discover these conventions. | none | unknown | hard rule |
| 332 | Adoption ensures CI meets §7's outcome (secret scan + build, toolchain resolved not hardcoded), optionally via `colab template <name>` which stamps for reconciliation. | none | unknown | hard rule |
| 333 | Adoption registers the repo in the machine's fleet registries via `colab register` — one command updates both the audit fleet list and the reserved-ports aggregation; an unregistered repo is invisible to the fleet audit. | none | unknown | hard rule |
| 334 | Adoption leaves existing branches alone — grandfathered. | none | unknown | hard rule |
| 335 | Adoption does not create `dev` unless the repo is genuinely Tier A or Tier C. | none | unknown | hard rule |

## §9 — Going live: Tier B → Tier C or Tier A

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 336 | Going live happens on the day a deploy target exists — not before. | none | unknown | hard rule |
| 337 | Before anything else, write down the path to production: for C, the deploy workflow triggered by a push to `main`; for A, the deploy workflow triggered by a tag, or the runbook for a hand-deployed repo — one of these must be committed before proceeding. | none | unknown | hard rule |
| 338 | Going live creates `dev` from `main` and pushes it, sets the repo's default branch to `dev`, and adds `dev` to every CI workflow's trigger branches. | none | unknown | hard rule |
| 339 | Going-live project.yml updates: Tier C sets `tier: C`, `trunk: dev`, a real `production:` URL, `deploy: push-main`; Tier A sets `tier: A`, `trunk: dev`, a real `production:` URL, and `deploy: tag` or `deploy: manual` + `runbook:` — never `push-main`, which cannot meet A's contract. | none | unknown | hard rule |
| 340 | The tag-gated single-trunk variant may keep `trunk: main` and skip creating `dev` entirely — add `runbook: <path>` when a poller deploys the tag from outside CI. | none | unknown | default |
| 341 | Going live swaps the GitHub topic and updates the internal project table (ports, prod URL). | none | unknown | hard rule |
| 342 | Tier A going-live tags the first release; on a `manual` repo tags are still worth cutting (they name what was deployed) though nothing fires from them; Tier C has nothing to tag — the promotion itself is the release. | none | unknown | default |
| 343 | Writing down the path to production comes first because `main` only becomes meaningful once something consumes it — what must not exist is a `main` that nothing and nobody reads. | none | unknown | explanation |

## §9 — Tier C → Tier A

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 344 | Migrate C → A when you find yourself wanting to name what shipped (hotfixes confused with feature work, or someone asked "what version is live?" with no answer) — not before, since an unused tag ritual decays exactly like an unused branch. | none | unknown | advisory |
| 345 | The migration retriggers the deploy workflow on a tag push instead of a `main` push — this is the whole change; until it lands, the tier claim would be false. | none | unknown | hard rule |
| 346 | The migration updates `project.yml` to `tier: A`, `deploy: tag`, while `trunk` stays `dev` — the branch shape is identical, which is what makes this migration cheap. | none | unknown | hard rule |
| 347 | The migration swaps the topic to `tier-a` and tags the current `main`, so the first tagged release names what is already live. | none | unknown | hard rule |
| 348 | The reverse (A → C, when a repo declares `tier: A` with `deploy: push-main`) is descriptor-only: set `tier: C`, leave the pipeline/branches/workflow exactly as they are, swap the topic. | none | unknown | hard rule |

## §11 — Anti-patterns (illustrations, not separate rules — cross-referenced to the rule they violate)

These six paragraphs are worked examples, each restating a rule captured above rather
than introducing a new one. Listed here for completeness of the "every rule" sweep,
with the row(s) they illustrate:

| anti-pattern | measured claim | illustrates row(s) |
|---|---|---|
| A release branch nobody consumes | 76 commits stale; a sibling `staging` branch abandoned after a week | 6, 336 |
| The same fix opened four times | one timezone fix required four near-identical PRs across `dev`/`staging`/`main` | explanation for why the model has exactly two branches, not three |
| A deploy mechanism nobody used | a tag-triggered workflow with zero tags; every deploy was manual dispatch | 344 (unused ritual decays) |
| A merge that ships itself while claiming otherwise | two live repos deploy on every `main` push yet declare Tier A | 22, 23 |
| Docs describing a repo that doesn't exist | most heavily documented repo prescribed `main` (actual default `master`), "rebase never squash" (every commit a squash), CI gating on `dev` (workflow skips CI on dev merges by design) | motivates §8's audit-from-outside model generally |
| Stale branch references in CI | a repo still gated on `develop`, `master`, `workos` — none of which exist | 289 |
| A conclusion that only ever existed in chat | three branches, zero Issues; branch names carried no issue numbers; merge messages could not say `Closes #N` | 254 (writing a conclusion down) |
| A silent version default | CI stayed green the whole time the bug was invisible | 291, 292 |

---

## `project.schema.md`

## `tier`, `trunk`, `production`, `deploy` — required fields

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 349 | `tier` is required and must be one of `A`, `B`, `C`. | none | unknown | hard rule |
| 350 | `B` = no production, 0 gates, one branch `main`; `C` = live, 1 gate, promotion is the deploy; `A` = live, 2 gates, promotion verifies and a tag deploys. | none | unknown | hard rule |
| 351 | A/B/C are labels, not grades — pick the one that describes the pipeline truthfully; claiming a gate the pipeline does not have is the failure this file exists to prevent. | none | unknown | explanation |
| 352 | `trunk` is required: must be `dev` when `tier: C`; `main` when `tier: B`; on `tier: A` it is `dev`, or `main` only when `deploy: tag`. | none | unknown | hard rule |
| 353 | On hand-deployed Tier A (`deploy: manual`), `main` is what is currently running on the host, `dev` is where sessions land, and the promotion is the only record of what shipped and when — collapsing the branches would erase that record. | none | unknown | explanation |
| 354 | Tier C keeps the identical dev/main split for the identical reason: `main` is literally what is live. | none | unknown | explanation |
| 355 | The tag-gated Tier A single-trunk exception applies only to `deploy: tag` — `manual` and `push-main` have no tag to mark the boundary and must keep the dev/main split; `main` as trunk on either of those is a finding. | none | unknown | hard rule |
| 356 | `production` is required: a URL string, or `null`; must be non-null when `tier: A`/`C`, `null` when `tier: B`. | none | unknown | hard rule |
| 357 | `deploy` is required and describes mechanism only, never whether Tier A applies. | none | unknown | hard rule |
| 358 | `deploy: tag` requires a committed path to production: either an in-repo deploy workflow firing on the tag, or (for an external deployer) a `runbook:`. | none | unknown | hard rule |
| 359 | `deploy: manual` requires a human running a documented procedure with no workflow/tag trigger, and requires `runbook:`. | none | unknown | hard rule |
| 360 | `deploy: none` is the required value for `tier: B`. | none | unknown | hard rule |
| 361 | `deploy: push-main` is the required value for `tier: C`, and a finding on `tier: A`. | none | unknown | hard rule |
| 362 | `push-main` is a real, valid mechanism — the finding is on the combination `tier: A` + `push-main`, never on the value itself. | none | unknown | explanation |
| 363 | `tier: A` + `push-main` has three resolution options: retier to C (usually right, no pipeline change); migrate to `deploy: tag` (when a release ritual is earned); or declare `deploy: manual` + `runbook:` (when shipping truly is by hand). | none | unknown | hard rule |
| 364 | `manual` grants no automation, and is treated as strictly less automated than `tag`: `colab promote` allows unattended promotion only on `deploy: tag` (verification-only); on `manual` it needs `COLAB_HUMAN=1`, same as `push-main`, and `promotion: main-loop` cannot lower that bar. | none | unknown | hard rule |

## `runbook`, `stack`, `integration`, `releaseBranch`

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 365 | `runbook:` is required when an out-of-CI deploy has no workflow: always for `deploy: manual`; for `deploy: tag` only when there is no in-repo deploy workflow (i.e. an external deployer). | none | unknown | hard rule |
| 366 | The audit checks that the `runbook:` path actually exists in the repo. | none | unknown | hard rule |
| 367 | `stack` is required and free-form — never used for machine dispatch, only orientation. | none | unknown | hard rule |
| 368 | `integration:` is optional, naming long-lived lines that accumulate work for a release weeks out; empty and absent are the same, and absent is normal. | none | unknown | default |
| 369 | Declaring an integration line does exactly three things: `colab worktree new --base <line>` can cut from it, `colab ship` merges back into the base a worktree was cut from, and the line is guarded like trunk (no raw pushes, no branch-name regex exemption, not a "ghost" when a workflow names it) — nothing more. | none | unknown | hard rule |
| 370 | `integration:` is not `trunk` because on Tiers A/C, `trunk` is the production spine that `colab promote` merges into the release branch — naming a line as trunk would point the promotion path straight at it. | none | unknown | explanation |
| 371 | Nothing in the promote/tag/deploy path reads `integration:` — a branch on that axis cannot reach production by construction, not by discipline. | none | unknown | hard rule |
| 372 | `colab ship` refuses an integration-line → trunk merge even under `autonomy: auto-trunk`, because a long divergence meeting the promoting branch is an integration event of a promotion's weight. | none | unknown | hard rule |
| 373 | A value in `integration:` may not equal `trunk`'s value, may not be `main`, may not be the literal word `trunk`, and must exist as a branch. | none | unknown | hard rule |
| 374 | A declared integration line nobody ever cut is the same failure as a release branch nothing consumes, and the audit reports it. | none | unknown | hard rule |
| 375 | CI on an integration line is checked but advisory only — a line with no workflow triggering on push gets a warning, never a failure; trunk's CI gate remains a hard requirement regardless. | none | unknown | advisory |
| 376 | `releaseBranch:` is optional, naming the branch an external GitOps poller fast-forwards on release, in the single-trunk tag-gated shape. | none | unknown | default |
| 377 | `releaseBranch:` is the opposite axis from `integration:` — an integration line accumulates work over weeks, a release branch is consumed (overwritten wholesale on every tag) and is a production ref that `integration:` guarantees never to touch. | none | unknown | explanation |
| 378 | A worktree may never be cut from, or shipped into, a declared `releaseBranch:` — it is not added to the set of allowed bases. | none | unknown | hard rule |
| 379 | Undeclared, `colab doctor` misreads a release branch (an ancestor of trunk between releases, indistinguishable by ancestry alone from a spent session branch) and prints a ready-to-paste delete for a ref a live deploy pipeline is polling. | none | #63 | hard rule |
| 380 | A `releaseBranch:` entry follows the same validity rules as `integration:` — may not equal trunk's value, `main`, or the literal word `trunk`, and must exist as a branch; a malformed entry is dropped, not honoured, and the audit reports it as a finding. | none | unknown | hard rule |

## Per-host deploy target, `ports`, `worktreePorts`

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 381 | "Which branch does this checkout serve" is deliberately not modeled as a schema field, on any tier — it is a fact about one machine, the opposite of everything else in the file. | none | unknown | hard rule |
| 382 | A per-host deploy-target mechanism belongs to a per-host mechanism the repo owns (env var, machine-local config) — the same shape as `colab`'s own local, uncommitted, VCS-fenced cache — never a `deploys: { <host>: <branch> }` schema entry, which would drift the moment a machine is renamed or retired. | none | unknown | hard rule |
| 383 | Whatever per-host mechanism a repo picks must name the branch it serves, unset-by-default, and never widen or disable the gate it overrides. | none | unknown | hard rule |
| 384 | `trunk:` and `integration:` never read the per-host axis, and it never reads them. | none | unknown | hard rule |
| 385 | `ports:` is optional, reserving TCP ports for a repo's trunk dev server(s); the `colab` CLI aggregates it fleet-wide and never allocates these to a worktree, even while the trunk server is down. | none | unknown | hard rule |
| 386 | Omit `ports:` for a repo with no dev server (CLI tools, libraries). | none | unknown | default |
| 387 | `worktreePorts:` is optional, a `[lo, hi]` range naming where worktrees of this repo search for free ports — distinct from `ports:` (reserved, never handed out). | none | unknown | default |
| 388 | Port allocation precedence: explicit `--range`/`--at` flag > `worktreePorts:` field > machine-global `config.portRange`; malformed values fall through to the default. | none | unknown | hard rule |
| 389 | Keep `worktreePorts:`'s window disjoint from every repo's reserved `ports:` — the allocator refuses reserved ports anyway, but a disjoint window avoids churn. | none | unknown | advisory |

## `autonomy`, `ceremony`, `promotion`, `generated`, toolchain pins

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 390 | `autonomy:` is optional (`manual` default, or `auto-trunk`), controlling how much of Phase B (merge to trunk) an agent may perform alone. | none | unknown | hard rule |
| 391 | `manual`/absent: an agent stops after Phase A; a human triggers the merge. | none | unknown | default |
| 392 | `auto-trunk`: an agent may complete the trunk merge itself through `colab ship` only, and only when every precondition passes (trunk CI alive and green, no new DB migrations, no hand-code conflicts after sync-regen) — any ✗ falls back to asking a human. | none | unknown | hard rule |
| 393 | `autonomy:` grants trunk autonomy only — promotion, tags, and anything that deploys remain human acts on every repo, always; the field cannot express otherwise. | none | unknown | hard rule |
| 394 | The `autonomy:` grant lives in the repo file, not the caller's flags, so it is a property of the repo's risk profile, reviewed in a commit like any other change. | none | unknown | hard rule |
| 395 | `ceremony:` is optional (`standard` default/omission changes nothing; `light` for beta/testing repos), a separate axis from `tier` — tier counts gates to production, ceremony answers whether anyone will ever comb through the audit trail. | none | unknown | hard rule |
| 396 | `ceremony: light` relaxes three things: evidence & narration (Phase B evidence comments skipped, issue narration distills real gotchas only), readiness ceremony (skips the `deps-checked` labeling pass), and audit severity (memory-ceremony gaps downgrade to advisories). | none | unknown | hard rule |
| 397 | `ceremony: light` never relaxes: claim before start, branch-off-trunk & worktree discipline, reserved ports, main checkout at rest on trunk, squash + `Closes #N`, Conventional Commits, CI secret scan + build. | none | unknown | hard rule |
| 398 | `ceremony: light` requires `production: null` — a live repo cannot be light. | none | unknown | hard rule |
| 399 | `ceremony: light` is incompatible with `autonomy: auto-trunk` — an unattended merge with no evidence trail is a closure nobody can audit. | none | unknown | hard rule |
| 400 | The known drift risk for `ceremony: light` is a repo marked light "for now" that grows real users — rule 398 is the backstop, flagged the moment `production:` gains a URL. | none | unknown | advisory |
| 401 | `ceremony: light` also enables solo flow, entry-gated by `colab solo`, which itself refuses outright on any repo not `ceremony: light`. | none | unknown | hard rule |
| 402 | `promotion:` is optional (`human` default, or `main-loop`), naming who may run the trunk→main promotion without a per-instance human word — distinct from release (the tag), which is always human. | none | unknown | hard rule |
| 403 | `promotion: main-loop` applies only on a `deploy: tag` repo, where promotion is verification-only (nothing deploys from it); unknown values fail closed to `human`. | none | unknown | hard rule |
| 404 | `promotion:` cannot lower the bar `deploy:` sets — on `push-main` promotion IS the deploy, on `manual` promotion is the human's signal to deploy, both always require `COLAB_HUMAN=1`; only `deploy: tag` makes promotion verification-only. | none | unknown | hard rule |
| 405 | Nothing in `promotion:` ever authorizes tagging. | none | unknown | hard rule |
| 406 | `generated:` is optional, naming path globs that are regenerated, not authored (codegen output, lockfiles) — `colab ship` treats a sync-merge conflict confined to these as resolvable by the repo's `pre-ship` regen hook instead of forcing a human. | none | unknown | default |
| 407 | `generated:` extends, rather than replaces, the built-in default set (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `composer.lock`, `Cargo.lock`, `go.sum`, `dist/`, `build/`, `public/build/`, `.astro/`). | none | unknown | hard rule |
| 408 | `node`/`php`/`python` toolchain pins are optional and win over the ecosystem manifest per §7's precedence; use only when the manifest cannot express the truth, or for a deliberate pin. | none | unknown | hard rule |
| 409 | If neither a pin nor a manifest declares a version, CI must fail, not guess. | none | unknown | hard rule |
| 410 | `requirements.txt` is not a manifest for toolchain-pin purposes — a Python repo carrying only it must set `python:` here or add `.python-version`. | none | unknown | hard rule |
| 411 | When a toolchain pin contradicts the manifest, the audit tool reports it — a disagreement is a finding to surface, not to auto-resolve. | none | unknown | hard rule |

## `project.schema.md` — Validity rules table (the audit's own normative summary)

| # | rule | measured claim | source | kind |
|---|---|---|---|---|
| 412 | The audit requires the marker file to be present and parseable, or reports "undescribed repo — agents guess". | none | unknown | hard rule |
| 413 | The audit requires `tier` ∈ {A, B, C}. | none | unknown | hard rule |
| 414 | The audit requires, for `tier: A`: `trunk: dev`, non-null `production`, `deploy` ∈ {`tag`, `manual`}. | none | unknown | hard rule |
| 415 | The audit flags `tier: A` + `deploy: push-main` as a finding, pointing at tier C. | none | unknown | hard rule |
| 416 | The audit requires, for `tier: C`: `trunk: dev`, non-null `production`, `deploy: push-main`, and a deploy workflow that exists. | none | unknown | hard rule |
| 417 | The audit requires that `deploy: tag` (or `push-main`) have an actual deploy workflow. | none | unknown | hard rule |
| 418 | The audit requires that `deploy: manual` have `runbook:` set, with the path existing in the repo. | none | unknown | hard rule |
| 419 | The audit requires, for `tier: B`: `trunk: main`, `deploy: none`, `production: null`. | none | unknown | hard rule |
| 420 | The audit requires the declared `trunk` branch to actually exist. | none | unknown | hard rule |
| 421 | The audit requires every `integration` entry to exist and not equal `trunk`/`main`/the literal word `trunk`. | none | unknown | hard rule |
| 422 | The audit requires a declared `releaseBranch` to exist and not equal `trunk`/`main`/the literal word `trunk`. | none | unknown | hard rule |
| 423 | The audit checks toolchain-pin-vs-manifest agreement. | none | unknown | hard rule |
| 424 | The audit requires `ceremony` ∈ {`standard`, `light`} when set, so a misspelled value is never silently read as `standard`. | none | unknown | hard rule |
| 425 | The audit requires `ceremony: light` → `production: null`. | none | unknown | hard rule |
| 426 | The audit requires `ceremony: light` → not `autonomy: auto-trunk`. | none | unknown | hard rule |
| 427 | `push-main` on Tier A is a finding, not an advisory — a prior version of this doc promised an advisory that no code ever emitted, meaning what looked like tolerance was in fact total silence. | none | unknown | hard rule |
| 428 | On Tier B, a `deploy` value other than `none` is caught by the `deploy: none` rule — a Tier B repo that deploys is mistiered, whatever mechanism it names. | none | unknown | hard rule |
| 429 | On Tier C, a wrong `deploy` value is redirected to the tier it actually names: `tag`/`manual` → A (two gates, non-deploying promotion), `none` → B. | none | unknown | hard rule |
| 430 | The `runbook:` path is verified only against a local working tree — when audited purely through the GitHub API (an `owner/name` entry with no tree to stat), a miss is reported as an advisory, not a violation, since a failed read cannot be told apart from a missing file. | none | unknown | hard rule |

---

## Findings (contradiction / supersession / consolidation risk / reality drift / no-measured-claim) — reported, not fixed

Per the issue's instruction, these are surfaced as findings only; **no edits were made
to `CONVENTIONS.md` or `project.schema.md`.**

### Consolidation risk

- **F1 — Row 335 vs. the doc's own worked history.** §9 step 9 ("Do not create `dev`
  unless the repo is genuinely Tier A or Tier C") and Anti-pattern 1 (`CONVENTIONS.md:1981-1985`)
  describe the identical failure mode from two different angles — not drift (both passages
  are accurate today) and not a contradiction, but worth flagging because a rewrite could
  accidentally fold them into one paragraph and lose the concrete "76 commits stale"
  measurement that makes the anti-pattern version more persuasive than the rule version.

### Reality drift

- **F2 — "twelve" labels vs. the actual count of `gh label create` lines.** `CONVENTIONS.md:1841`
  says *"All twelve are required"* immediately before a block (`CONVENTIONS.md:1846-1857`)
  that contains **fourteen** `gh label create` lines (`in-progress`, `deps-checked`,
  `agent-filed`, `epic`, `needs-ruling`, `needs-plan`, `migration-granted`, `ci-granted`,
  and four `delivery:*` — 8 + 4 = 12 label *names*, but 4 of those names are the `delivery:*`
  family counted as one bullet in the explanatory list beneath it yet as four separate
  `gh label create` invocations above it). Read strictly, "twelve" is defensible only if
  `delivery:*` counts as one item — but the explanatory bullet list directly below
  (`CONVENTIONS.md:1861-1901`) enumerates it as its own bulleted item alongside the other
  eight, i.e. 8 singular labels + 1 `delivery:*` family = 9 *bullets*, not 12 and not 14.
  None of the three countings (12 stated, 14 `gh` lines, 9 explanatory bullets) agree with
  each other at face value; the reconciliation is that "twelve" counts distinct label
  *names* (12) while treating `delivery:*`'s four names as four, which the "not a subset"
  framing right beside it does not make obvious. Flagging as a rule with an internally
  ambiguous **measured claim** — the number "twelve" is asserted but the document's own
  adjacent enumeration does not resolve unambiguously to it without a side calculation a
  reader has to do themselves.
  **Resolved as of #243 (2026-08-20):** re-measured against current `main` — `CONVENTIONS.md`
  now says "fourteen" consistently (`CONVENTIONS.md:1999-2010`), matching both the `gh label
  create`/`colab labels --ensure` count and `tools/lib/labels.js`'s `CONVENTION_LABELS.length`
  (14). This entry's "twelve" was accurate for the `4b46c08` snapshot this document measures
  from and is kept as the historical finding; the live drift it describes no longer exists.
- **F3 — `colab readiness` vs. `readiness.marked` event payload naming.** `CONVENTIONS.md:834-836`
  says the `colab readiness` write is "the single site the observer event (§ notify, kind
  `readiness.marked`) emits from" — but the section symbol `§ notify` does not resolve to any
  heading in this document (no `## notify` or `### notify` section exists in `CONVENTIONS.md`
  as measured). Either the cross-reference is stale (points at a section that was renamed or
  lives in a different document, e.g. a `colab` tool README) or the anchor was never filled
  in. This reads as reality drift rather than a rule conflict — the *rule* is intact, but its
  citation does not resolve inside this document.

### No measured claim (candidates for the "reads as taste" flag)

The following hard rules assert real obligations but the prose backing them cites no
number, incident, or measured count — each is a legitimate reconcile-step question of
whether the rule is durable convention or taste that has not yet been tested against a
failure:

- Row 26 (never a branch literally named `trunk`) — asserted, never shown failing.
- Row 62 (branch-name regex) — the regex itself is arbitrary; no incident cited for why
  these seven prefixes and no others.
- Row 280 (SemVer, patch/minor/major) — industry convention, no repo-specific incident.
- Row 386/387 (ports/worktreePorts omission rules) — mechanical description of the schema,
  not backed by a failure.
- Rows 412–430 (the validity-rules table) — each row states what the audit checks, but the
  table itself carries no measured claim per row; the *failures they prevent* (right-hand
  column of the source table) are named descriptively, not with an incident count, except
  where the row text separately cites one (e.g. row 415/427, tied to the `push-main`
  narrative that *does* carry the "previously promised an advisory that no code ever
  emitted" claim).

This class is large by construction — the schema-reference half of the document (all of
`project.schema.md`) is definitional rather than incident-driven, so "no measured claim" is
the norm there rather than the exception. The prose half of `CONVENTIONS.md` is the
opposite: nearly every hard rule in §4 and §5 carries a specific number. That asymmetry is
itself worth surfacing to whoever runs the reconcile step — it suggests the *schema*
document is where taste-dressed-as-rule is more likely to be hiding, if it exists anywhere.

### Contradiction

- None found with certainty. The two closest candidates were checked and are **not**
  contradictions on a careful read:
  - Row 20/26 ("trunk" is a role) vs. the tag-gated single-trunk exception (rows 16, 340,
    355) where a branch literally named `main` also serves as trunk — not a contradiction:
    the rule forbids naming a branch *the literal word* "trunk", not forbidding one branch
    from playing both the trunk and release-branch roles.
  - Row 279 ("On Tier C the ladder has two rungs") vs. row 277 ("three rungs" ship/promote/
    release) — not a contradiction: row 279 is Tier C's *specific* collapse (no separate
    release/tag rung exists there), explicitly framed as a special case of the general
    three-rung model in row 277.

### Supersession

- None found. The document's own trim-pass commit history (`619532a`, `8048958`, `2d56661`,
  `05ae02c`, per `git log` at the head of this session) suggests recent editing already
  removed superseded material; nothing still-present in the measured text visibly overtakes
  an earlier rule left un-retracted in the same document.

---

*Built for issue #160. No file other than this one was created or edited.*
