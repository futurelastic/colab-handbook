# code-sweep · §2 What "finished" means

Reference for [`code-sweep`](SKILL.md) §2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## 2. Decide what "finished" means — one rule, not per-candidate judgement

```sh
git fetch origin                    # the rule reads local refs; a stale base misjudges
colab landed --all                  # every worktree of this repo: landed · cargo · unknown
```

That is the whole decision, and it is the same rule `code-ship` uses
(`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits), "Has it landed?"). It is asked against each branch's **base** —
trunk, or the declared `integration:` line it was cut from — because a line-based
branch measured against trunk reads as enormous unshipped cargo.

**Do not count commits, and do not trust the merge graph.** `git branch --merged`
lies here: sessions squash-merge, which leaves no merge relation (the same reason
deleting a wrapped branch needs `git branch -D`, not `-d`). Counting commits ahead is
worse than useless — a squash mints a new sha, so it calls *every branch ever shipped*
unfinished. Comparing diffs fails the mirror case, where the base moved on underneath.
Requiring both still misses a squash followed by base movement, which is common. The
rule above asks the content question instead: does merging this branch change the
base's tree at all?

Without `colab`, ask it directly per branch:

```sh
git merge-tree --write-tree origin/<base> <branch> | head -1   # equal to …
git rev-parse origin/<base>^{tree}                              # … this ⇒ landed
```

**`unknown` means cargo.** If the base rewrote the branch's work the merge conflicts
and no content answer exists — so it never gets torn down on a guess.

Do not trust `colab`'s `status` field alone either — the `doctor` merged-flip
heuristic ("running → merged once no live claims remain") became weaker when claims
began releasing unconditionally at wrap.

**Git state and claim state are two signals; keep them apart.** `colab landed` says
what state the work is *in*; `in-progress` says someone *believes they hold it*. They
disagree in both directions — claims outliving finished work, finished work never
claimed — and the label remains the veto before any teardown.
