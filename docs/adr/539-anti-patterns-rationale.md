# Anti-patterns: the stories

Moved from [`CONVENTIONS.md` §10, *Anti-patterns*](../../CONVENTIONS.md#10-anti-patterns) by #539 (phase 2 of #523). Since #640 it holds the lessons too: each one is a rule in the section it governs, so §10 is a stub pointing here. Headings below are added for navigation only.

Each of these is something we have actually done.

## A release branch nobody consumes

**A release branch nobody consumes.** *A branch with no pipeline hanging off it decays
into noise.* Why Tier B is the default, and going-live step 1 is "add the deploy
workflow".

A repo adopted `dev` as default but nothing ever deployed from `main` — it sat 76 commits
behind for months, while a sibling `staging` branch was abandoned after a week.

## The same fix opened four times

**The same fix opened four times.** *Three tiers without automated promotion is a tax on
every hotfix.* We use two, deliberately.

With `dev`, `staging`, and `main` all live, one timezone fix required four near-identical
PRs.

## A deploy mechanism nobody used

**A deploy mechanism nobody used.** *Copy-pasted CI encodes intentions nobody adopted.*

A workflow triggers on tag push; it has zero tags — every deploy was manual dispatch.

## A merge that ships itself — while claiming otherwise

**A merge that ships itself — while claiming otherwise.** *The mechanism is fine; claiming
a gate you do not have is not.* Now a finding (`tier: A`/`exposure: released` with
`deploy: push-main`).

Two live repos deploy on every `main` push and declare Tier A, whose contract says a release
artifact gates production.

## Docs describing a repo that doesn't exist

**Docs describing a repo that doesn't exist.** *An aspirational doc is worse than no doc —
people trust it.*

Our most heavily documented repo prescribed trunk `main` (actual default `master`), "rebase,
never squash" (every commit a squash), CI gating on `dev` (workflow skips CI there by
design).

## Stale branch references in CI

**Stale branch references in CI.** *Config drifts silently when copied rather than
referenced.*

A repo still gated on `develop`, `master`, and `workos` — none of which exist.

## A conclusion that only ever existed in chat

**A conclusion that only ever existed in chat.** *Work only agreed to in a room is
undocumented the moment the room closes.* Why the decision goes on an Issue before any
file is touched ([§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this)).

A session settled a batch of rules and went straight to implementing them — three branches,
zero Issues, no issue numbers in branch names, no `Closes #N` possible. The code landed; the
argument behind it was lost.

## A silent version default

**A silent version default.** Covered in [§7](../../CONVENTIONS.md#7-ci-and-toolchain) — worth repeating: the
bug was invisible because CI was green the whole time.
