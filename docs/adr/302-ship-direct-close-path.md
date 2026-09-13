# A branchless trunk-direct unit closes through `colab ship --direct`

Decided in #302, landed together with #319 (ship releases every claim it carried) and #324
(remote-only branches need `--adopt`), all on one branch because they edit the same ship block.

## Context

#284 ruled (option B) that a unit committed straight to trunk still leaves the same closing event
as every other unit — evidence posted, issue closed, claims released — through `colab ship`'s
existing evidence-close mode, and assumed such a unit would classify as `landed ∧ zero own commits`
and fall into that mode "with no new branch of logic."

Measured false at three layers, not the two #285 found:

1. `resolveShipSession` threw `ship needs --worktree <name> or --branch <br>` — a direct unit has
   neither.
2. `--branch <trunk>` was refused as `--branch is the trunk itself — nothing to ship`.
3. Remove both and it still cannot work: `landed.landedState` answers `unknown` whenever
   base === branch (`tools/lib/landed.js`), and `shipMode` never routes `unknown` into a path that
   closes issues without merging — correctly, since `unknown` means "look".

And the claim such a unit holds — `colab claim <N> --session <id>`, no worktree, no branch — was
invisible to ship and never released by it (#319).

## Decision

A flag on `ship`, handled by its own function: `colab ship --direct` → `cmdShipDirect`.

- **Claims are matched by session identity**: this repo, no worktree, no branch, `session` equal to
  `--session`/`COLAB_SESSION`. A blank identity is refused (#242). Another session's claim is never
  touched; a same-session claim that names a branch is pointed at `--branch`.
- **"Nothing to merge" is structural, so it is not measured.** What is measured instead is that the
  unit is *published*: trunk checked out, tracked-clean, and local trunk not ahead of `origin`
  (`ship-target-sync`; behind-only passes).
- **Everything else is the branch path's, unchanged**: the `writes: isolated` veto, the autonomy
  gate, trunk CI as a gate, the checklist close gate, `shipEvidenceClose` with the same
  `hasEvidence` gate, claim release, the plan journal, the events.
- An issue left open for want of evidence **keeps its claim**, so the re-run the refusal asks for
  can still find it. (The same rule now holds on the branch evidence-close path.)
- `writes: direct` is **not** required. The mode grants no write and no push, only a close, so any
  repo whose `writes:` does not veto trunk-direct may use it.

## Alternatives rejected

- **A new subcommand.** It would fork the autonomy gate, the close/refs split, `shipEvidenceClose`,
  the teardown, the events and the plan journal — each of which a direct unit must share for the
  audit trail to stay uniform, which was the entire point of #284's option B.
- **Growing `colab solo --done`.** Wrong shape twice over: solo flow holds no claim by construction,
  and `--done` is deliberately never gated (#237). A trunk-direct unit *with an issue* is a
  no-worktree claim, not a solo session; a solo session with no claim has nothing to close.
- **Inferring direct mode from "no `--worktree`/`--branch`".** `COLAB_SESSION` is set in most agent
  sessions, so an implicit mode would turn a forgotten `--branch` into a close.
- **Counting trunk commits that mention `#N` as the evidence.** The session writes those messages
  itself — self-declared evidence. They are shown as an advisory row only.
- **Routing through `shipMode` by teaching `landedState` a base === branch answer.** That function's
  `unknown` is load-bearing for every other caller; the direct unit's zero-diff fact is not a
  content question at all.

## Consequences

- `code-wrap` distinguishes a trunk-direct *unit* (holds a no-worktree claim → Phase A, then
  `ship --direct`) from a solo session (no claim → `solo --done`). `code-ship` documents the door.
- `code-ship` B3's hand-run `colab release <N>` is now only for what ship did not carry (#319).
- Three readings in this decision are **interpretations a ruling may overturn**, recorded in
  CONVENTIONS.md §2 as a proposed answer, ⚖ confirmation pending (#342): the evidence gate stays right for
  direct units (the instruction authorizes the unit; the comment evidences delivery), the autonomy
  gate still applies, and trunk CI still gates the close.
