# code-triage · §5 The readiness gate — every gate in full

Reference for [`code-triage`](SKILL.md) §5. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


A group is **ready** only if every one of these holds. Anything else is `blocked`,
with the blocker named:

- [ ] **Unclaimed** — no `in-progress`, no live claim, and no half-claim (an assignee
      without the label, or the label without an assignee — §2; blocked on its repair).
- [ ] **Verifiably undone** — §2 passed against the code, not the tracker.
- [ ] **Actionable** — the Issue says what "done" looks like. An Issue that is a
      question is blocked on an answer, not ready to code.
- [ ] **Nothing it depends on is still missing** — read the **relationship**, never
      the prose: `gh issue view <N> --json blockedBy` (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough),
      *Readiness*). Prose saying "depends on the other one" is an explanation, not a
      record; it blocks nothing and no tool can act on it.
      **An open blocker is not automatically a blocker** — judge its state, per §5.1.
      **And empty is not "free" — it is "nobody looked".**
- [ ] **Trunk CI is alive** — ask by commit, not by recency (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits),
      #92): `colab trunk-ci` must print `GREEN` for `<trunk>`'s current head sha — the
      same verdict `colab ship` gates on, so every workflow's newest run there
      succeeded, not merely one of them (#463). Never substitute a `gh run list`
      filter of your own: `gh run list --branch <trunk> -L 1` reads whatever ran
      *last* (a cancelled straggler can outrank a passing run on the same commit
      under `cancel-in-progress`), and an "any run succeeded" filter calls a sha
      with one red workflow green. A failure that never started (billing lockout, runner
      outage) counts as dead. **What CI *is* here follows whether the unit has a
      branch, how much it must catch follows `exposure`**
      ([§7, *CI*](../../CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)
      — ⚖ #233 retired the `writes`-keyed reading): with a branch — the ordinary
      case, or an attended trunk-direct session falling back to full ceremony — it
      doubles as the pre-merge gate this bullet is checking you can still pass — if
      you cannot merge when you finish, you are not ready to start
      ([§6](../../CONVENTIONS.md#6-releases)). On an attended trunk-direct unit with
      no branch, a commit ships before CI ever runs — CI there is the alarm, not the
      gate — so being ready to start means nothing is already sounding it, and
      thoroughness is a question `exposure` answers, not a pre-merge check that
      structurally cannot exist.
      **Red, and no patch yet?** That is not only a blocked gate — it is §5.2's step,
      run once for the repo before ordering, not once per group.
- [ ] **No live worktree owns those files** — `colab worktrees`, and
      `git branch -a --list '*<n>*'` after `git fetch --prune`. A clean label does
      not prove clean ground: claims are released unconditionally at wrap, so an
      abandoned branch can exist with no claim on it at all.
      **Scope the check to this group's own deliverable paths.** `colab worktrees`
      lists every live worktree in the repo, most of them on files this group never
      touches; a repo-wide list is not evidence of contention unless it intersects
      the paths this group would actually edit. An empty intersection is not a
      finding — do not narrate it in the report, and do not let it vary the
      per-beat verdict when the only thing that moved was an unrelated worktree.
      Report contention only when there is a real path overlap, and name it.
      **A group's own members are the exception to "do not narrate it".** Where this
      group carries a `group:` label, a second live branch across its members is a
      **finding** regardless of whether this gate leaves the group ready — see §3,
      *Then ask the one-branch question*, for the check and §6 for the printed shape.
      That question is asked once per group, not re-derived here.
- [ ] **No pending decision** — no `needs-decision` label (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122),
      *Decision gate*). A surface awaiting a human answer is not a start candidate
      for anyone, manual or scheduled, until the decision is recorded — report it
      exactly as any other blocker, naming the label as what must be cleared and by
      whom.
      **Before re-applying `needs-decision` to an issue that already lacks it,
      check for a live `⚖ Decision recorded` comment or a `decision-recorded`
      label first.** A cleared gate with no positive record present is the
      unswept-but-genuinely-open state; a cleared gate WITH one of those present
      means the question was already answered — re-gating it reproduces a measured
      failure (#127: a ruling sat live in a comment, a triage pass saw no label and
      re-gated settled work). `colab decision --list` shows every issue with a live
      decision right now.
      **Asking a second question on an issue that carries `decision-recorded`?** Run
      `colab decision <N> --reopen --ruled-by <name>`. Never add `needs-decision` by
      hand. This is the same rule as never removing the label by hand, seen from the
      other side (`CONVENTIONS.md` §5, *Decision gate*, #357). A hand-added label leaves
      the issue with **both** labels. That is the same pair an interrupted `--record`
      leaves, so a reader can take the new question as settled and hide it.
      **Found both labels already?** Resolve the pair by time, never by assumption. A
      `needs-decision` label event or options block newer than the newest `⚖` record is
      an **open question**. Report it `blocked`, with the `--reopen` command as the repair
      and a ruling as what clears it. If every ask predates the record, it is an
      interrupted write: the question is answered, and the fix is removing
      `needs-decision`. If you cannot tell, report it as pending. `colab decision --list`
      prints each pair with its verdict and fix.
      **Look for an answer given elsewhere before you report a decision as pending,
      too** (#356). A ruling can exist without ever passing through this gate. It may
      be prose on the issue itself, or a ruling on a linked or referenced issue in this
      repo or a sibling one. In both cases `needs-decision` was never applied, so
      `colab decision --record` never came up, and nothing marks the issue as settled.
      Measured: three UI issues sat for about a day, reported twice as waiting on the
      design lane, while their design had been ruled in exactly those two ways. An
      issue like that is not waiting on a human. It is waiting on someone to write the
      ruling down. §6's `design:` line says how to report it (`ruling exists,
      unrecorded` plus a `record:` command). Never report it as waiting on a human.
      If `needs-decision` is applied, the label is still a live gate and the group
      stays `blocked`. Its blocked line then names the `record:` command as what clears
      it, not a ruling someone still has to make.
      **Is the question itself machine-readable?** (#379, `CONVENTIONS.md` §5,
      *Design-approval ask*). A pending `needs-decision` takes one of two shapes: a
      `<!-- decision:options` block (body or comment), or a `Mockup: <url>` line at the
      start of a line in the **body**. In neither shape, no decision view can render it,
      so the human who rules is never shown it. It stays `blocked` as before, and its
      blocked line gains `finding: ask in neither shape — filer adds a Mockup: line or an
      options block` and names the filer. Do not write the line or the block yourself.
      The question is the filer's to state. The reference reading is `askShape` in
      `tools/lib/decision-record.js`. One read for the whole repo:
      ```sh
      gh issue list --state open --label needs-decision --limit 200 --json number,body,comments \
        -q '.[] | select(((.body // "") | test("<!--\\s*decision:options") | not)
                     and ([.comments[].body] | any(test("<!--\\s*decision:options")) | not)
                     and ((.body // "") | test("(?m)^Mockup:[ \\t]*\\S+[ \\t]*$") | not)) | .number'
      ```
      This lists the unshaped ones among **every** open `needs-decision` issue. Skip an
      epic here: §2's epic finding already covers it, with a different fix.
- [ ] **Delivery type is code, docs-only, or not asked** — no `delivery:content` /
      `delivery:ops` / `delivery:elsewhere` / `delivery:design` label (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#delivery-type--route-not-start-112), *Delivery type*). This issue was
      already filtered out at §2 if it carries one; this bullet is the reminder for a
      caller checking a single issue outside a full triage pass. **Absence is not this
      gate** — an unlabelled issue and one explicitly `delivery:code` or
      `delivery:docs-only` pass through unaffected (#358); only an explicit non-code
      value routes, or goes to the design bucket.
- [ ] **Not held** — no `deferred:*` label, and no label the repo declares under
      `holds:` (§2, *Held*; `CONVENTIONS.md` [§5](../../CONVENTIONS.md#holds--every-label-that-stops-a-start-names-its-owner-and-its-wake-360), *Holds*). A held issue
      reports as `HELD`; as `WAKE` (*wake met, lift?*) when every condition on its `wake:`
      measures met this pass; or as `STALL` when its `Hold:` line names no owner, no wake,
      a wake outside the vocabulary, or a reference that does not resolve. A met wake is
      still not ready: the owner lifts the hold, and only then does the issue start.
      It never reports as ready.
