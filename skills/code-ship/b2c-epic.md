# code-ship · B2c Update the parent epic

Reference for [`code-ship`](SKILL.md) B2c. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B2c. Update the parent epic — close a native container with its last child; tick a hand-maintained one

`code-triage` instructs its readers to **trust the epic's checklist table over its
title**, on the grounds that only the table is maintained. Nothing in this family
maintained it.

Why: [ADR 536](../../docs/adr/536-code-ship-b2c-epic-rationale.md).

**First ask which kind of parent it is**, because #34's mechanism removed most of
this work rather than adding to it:

```sh
gh issue view $N --json parent -q '.parent.number // "none"'
```

- **A native parent (sub-issue link)** → **tick nothing.** GitHub maintains
  `subIssuesSummary` itself; the child closing *is* the update. Ticking a checklist
  line here would be inventing a second, hand-run source of truth beside a correct
  automatic one. **But if that child was the parent's last open sub-issue, close the
  parent in the same step (#371, `CONVENTIONS.md`
  [§5](../../CONVENTIONS.md#epics--a-container-is-not-a-start-candidate), *Epics*).**
  `colab ship` does this for you (its step i2). For every issue it closed, it reads the
  native parent, and `tools/lib/container-close.js` decides. The parent is closed, with a
  `📦 Closed by colab ship` evidence comment naming the child and the sha, only when it
  carries `epic`, every native sub-issue is closed, its body lists no unticked `- [ ]`
  item, and it is not a release tracking record. Then the same question goes to its own
  parent. Any other shape stays open. A parent with no `epic` label, or one still listing
  an unticked item, prints as a `container #P: …` warning for a human. Deciding by hand
  (a parent `colab ship` did not reach) — the reads are `gh`, the close is `colab close`,
  which also releases any claim on the parent and tells the observer (#381):

  ```sh
  P=$(gh issue view $N --json parent -q '.parent.number // empty')
  [ -n "$P" ] && gh issue view $P --json state,labels,body,subIssuesSummary
  # close only on: OPEN · labels ∋ epic · subIssuesSummary.total > 0 and completed == total
  #                · no unticked "- [ ]" line in body · body does not open with <!-- colab:release
  colab close $P --comment "📦 Closed — its last open sub-issue #$N shipped at <sha>; all sub-issues closed (#371)."
  ```

  `subIssuesSummary` can lag a child's auto-close by a moment. A lagging read looks like
  an open child, so nothing closes. The next sibling ship or `code-sweep` §5 catches it.
  Never retry in a loop.
- **No native parent** → look for a hand-written checklist that references this issue:

```sh
gh issue list --state open --search "#$N in:body" --json number,title
```

For each open parent whose body has a **checklist line** containing `#$N`, tick that
one line and record the trunk sha beside it. Prefer converting the epic to native
sub-issues if the owner wants it — then this step stops applying forever.

**Four things not to do** — each is a way this step turns destructive:

1. **Never close a hand-checklist epic**, even when the last box ticks. Boxes running
   out does not mean work running out: an epic can have two phases complete and two
   whose issues are not written yet. Closing it buries the unwritten part. (A native
   container closes by the rule above. Its unticked-item check is this same
   protection, and on native sub-issues "every child closed" is a fact GitHub maintains.)
2. **Never rewrite the epic's prose.** Edit the one checklist line for the issue that
   just closed. The body is where the owner records decisions; a skill has no business
   editing there.
3. **No checklist, no action.** Do not create a table the repo did not choose.
4. **Never infer parentage from a title.** Accept it only from a native `parent` link,
   or from a literal `#$N` on a checklist line. Prose that merely mentions `#$N`
   ("related to #$N", "unlike #$N") is **not** a checklist line and must not be edited.

   A checklist line is `- [ ]` or `- [x]` — **a bullet is not a checklist**:

   ```sh
   grep -nE '^\s*-\s*\[[ x]\].*#'"$N"      # a hit here may be ticked; anything else may not
   ```

   This is not hypothetical. The issue that asked for this step lists its own related
   work as `- **#28** (…)` — a bullet, matching any loose "list line mentioning #N"
   rule, and editing it would tick a line that tracks nothing. Verified against that
   body: the anchored pattern rejects it, a `-.*#N` pattern accepts it.
