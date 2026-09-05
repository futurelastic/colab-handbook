# A `group:` label is enforced at triage and ship, and triage promises only pass time

## Context

`group:<key>` has meant "these issues collide on files and must serialise — usually one
branch" since it was introduced. Nothing read it. `code-triage` wrote the label and then
happily offered each member as its own start candidate; `code-start` told a session to
take the whole group but checked for an existing branch using *its own* issue number
only; `code-ship` said nothing about groups at all.

Measured on coding-dashboard, 2026-09-05 (that repo's ADR
`docs/adr/1530-ship-lanes-reorg.md`, section 2 L5 and section 7 item 7):
`group:cockpit-fidelity` held 6 open issues and 3+ live parallel branches. Two overlapped
on `src/console/CockpitView.tsx`, `src/i18n/messages/cockpit.ts` and `CLAUDE.md`. One
carried 8 `chore(sync)` commits pulling siblings' fixes ahead of their own trunk merge.
They burned CI rebasing around each other and none converged.

The issue asking for the fix (#316) also carried the hard question: triage runs **once per
pass**, but a second branch is created by a *different session at an arbitrary later
moment*. Whatever this rule promises has to be something a non-polling skill can keep.

## Decision

**One rule, two enforcement points, and a deliberately narrow promise.**

- The label is a **serialisation contract**: the group is one unit of work, realized as
  one branch (or, on a coexistence repo, one attended trunk-direct place-claim).
- **triage prevents and names.** It never offers a `start:` line that would mint a second
  branch in a group, and it names every second live branch it can see **at pass time** as
  a finding carrying a carrier and a rebase order.
- **ship orders.** It lands one member at a time against a re-fetched base and never
  merges a sibling member's branch to borrow its unmerged fix.
- `code-start` is the reader that honours the offer, not a third enforcement point.

**Detection is ref existence first, content classification second.** The primary net
enumerates `refs/heads/**` and `refs/remotes/origin/**` and keeps refs whose *trailing
number run* intersects the group's **open** members. `colab holders` on the group's
`Because:` paths is a second net, folding in `cargo` rows only.

## Alternatives rejected, and the measurement that killed each

These are recorded because each is the obvious-looking design a future session will
re-propose.

1. **Bake a live re-check into ship-time ordering, so the rule covers mid-flight.**
   Rejected. The acceptance criterion scopes to what *arises from a triage pass*, and
   nothing in this family polls. A promise of mid-flight detection is one no skill here
   can keep, and this repo's house rule is that a check states what it is blind to rather
   than implying a guarantee. The gap is closed at **ping cadence** instead, and that is a
   real bound rather than a hope: a newly-pushed sibling ref moves `code-triage` §0's
   `branches` digest, so the next ping cannot short-circuit and takes a full pass.

2. **Key the check on `colab holders` alone (a path-keyed rule).** Rejected on
   measurement. `colab holders skills/code-triage/SKILL.md` in this checkout returns **6
   refs, every one `unknown`**, and all six belong to **closed** issues (#268 #262 #250
   #247 #242 #244) — spent local refs whose base moved on under them. Counting `unknown`
   as live would report six second branches on a group that has none, on every pass. A
   finding that always fires means nothing. Hence: open-member filter first, and `unknown`
   demoted to an advisory line rather than counted.

3. **Classify candidates by content (`colab landed`) and keep the `cargo` ones.**
   Rejected — it is blind to the exact case this rule exists for. A second session's
   brand-new branch has no commits, and `colab landed` answers a content question:
   measured on this session's own branch at creation (`fix/group-second-branch-finding-316`,
   0 commits) the verdict is **`landed`**, "merging the branch would not change the base
   tree". A content-based detector therefore drops precisely the branch being hunted.
   Content classification is kept, but only to *describe* a candidate in the report.

4. **Widen `code-triage` §0's input-5 enumeration to do the detection.** Rejected. Input 5
   is a fingerprint input; changing what it reads changes every stored digest and forces a
   full pass in every adopting repo. The refs are re-read separately instead — local, and
   free.

5. **Extract the issue number with `grep -oE '[0-9]+$'`.** Rejected after it was written
   and then caught: that reads `fix/import-fixes-115-114-113` as issue 113 alone, so the
   carrier stops matching its own group the moment #113 closes, and the group reports as
   branchless. `code-ship` B1b had already solved this (`grep -oE '(-[0-9]+)+$' | tr -- '-'
   '\n'`); its extraction is reused rather than a fresh one written. Verified: with the
   correct extraction the live `group:skillmd-citations-lint` carrier is credited with 4
   members, not 1.

6. **Treat `findings` as required-when-present at cache version `code-triage/3`, avoiding a
   version bump.** Rejected. A stored `conclusion` predating findings cannot answer "did
   this group break the one-branch contract", so half-matching it would let a
   short-circuit re-print silently omit a finding — the one thing that made a group unsafe
   to spawn into. Bumping to `code-triage/4` costs one full pass per adopting repo, once,
   and announces itself (`no usable cache: version code-triage/3 unrecognised`).

7. **Add a `colab` subcommand, a new label, or a sixth triage tracker write.** Rejected as
   out of scope and, for the write, as unauthorised: `../../skills/code-triage/SKILL.md` §0.2's
   five writes are exhaustive, and an ordering stamped to a trunk sha is exactly the
   perishable verdict that same file's §5.1 already refuses to persist on the tracker. The finding is console output plus
   `$CACHE.conclusion.findings`.

8. **Edit `code-sweep` too.** Rejected as duplication. `../../skills/code-sweep/SKILL.md` §4
   already runs candidates one
   at a time, re-checks trunk CI per candidate, and composes `code-ship` per candidate — so
   it inherits the ordering rule from the file that states it. A second copy of an ordering
   rule in a skill that composes the one holding it is what drifts.

## Consequences

- Two live branches in one non-isolated group cannot arise from a triage pass without
  appearing in that pass's findings — the acceptance criterion, met at its actual scope.
- Triage gains a group-level **findings** section, which is deliberately not a sixth issue
  bucket: the question is per-group, and in the motivating measurement every member was
  *claimed*, so a bucket-keyed check would have let the whole group vanish into `taken`.
- The findings section prints a **limits line on every pass, clean or not**, naming its
  residual blindnesses. A clean findings section is not a guarantee and must not read as
  one.
- Cache version `code-triage/4`: one self-announcing full pass per adopting repo.
- Still open, on the dashboard side and not settled here: that repo's ADR section 8 Q4
  ("where does `group:` bite"). This decision implements the both-points answer; a
  different ruling there would change the `CONVENTIONS.md` wording, not this structure.
