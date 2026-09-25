# A plain release cancels every earlier claim; a yield cancels only its author's

## Context

The claim tie-break (`tools/lib/claim-comments.js`, `tieBreakVerdict`) decides a
simultaneous-claim race from the issue's comments. It first computes the **live**
claims (`liveClaimComments`). Before #375, a `🔒 Claimed` comment was cancelled only by
a later `✅ Released` from the **same GitHub author**.

#363 had already fixed the label/assignee half of cross-account release: `colab
release` unassigns the account that applied `in-progress`, not just `@me`. The comment
half still keyed cancellation on the release's author.

Measured on this repo: account A claimed an issue from machine X. Two minutes later a
session under account B posted `✅ Released`. Twenty-four days later, account A claimed
the same issue from machine Y. The refusal gate passed, because the issue had no label.
Then the tie-break found A@X's claim still live, judged it an "earlier simultaneous
claim", and yielded with *Pick another issue*. The work was free. Nobody held it.

The same author-keyed rule had a second defect. When machine Y of one account yields to
machine X of the same account, the yield (`✅ Released (yielded — earlier claim by
A@X wins)`) is posted by A. So it also cancelled X's **winning** claim, and the
comment that the cross-machine refusal (#325) reads went blank the moment X won.

## Decision

- **A plain `✅ Released` cancels every claim posted before it, whoever posted either.**
  A plain release is `colab release`, `worktree rm`, or one a human types. Since #363,
  colab's release clears the label and the claimer's assignee whatever the account. The
  comment layer now agrees with the label layer.
- **A yield cancels only its own author's earlier claims, and never the claim it names
  as the winner.** A yield is one racer standing down. It does not release the issue.
  The named winner is matched by login, by host (`sameHostName`, so a raw name and its
  `h:` token match, #369), and by session only when both sides carry one.

Both rules are a pure function of the comment list. Every racer reading the same
comments gets the same live set, so the tie-break still converges: exactly one racer
yields. `tools/lib/claim-comments.test.js` covers this, and the pre-#375 rule fails
five of its tests.

## Alternatives weighed

- **Cancel across authors only when the release also removed `in-progress`**, read
  from the label events. Rejected: it adds a timeline read to every tie-break. Label
  events are also written by both racers while the race is still running, so two
  racers could read different "latest labeler" states and reach different verdicts.
  That breaks convergence, which is the property the tie-break exists for.
- **In `tieBreakVerdict`, ignore a winner whose claim predates the current
  `in-progress` labeling.** Rejected for the same reason: "current" moves while the
  race runs. It would also fix only the tie-break, not `ghClaimConflicts`, which reads
  the same live set.

## Consequences

- **A stray `✅ Released` from an unrelated account cancels a genuinely live claim in
  the comment layer.** #375 named this as the risk. That same release, made through
  colab, already clears the label and assignee (#363), so the comment layer takes on
  no new exposure.
- **A same-account winner's claim now stays live after its rival yields,** which is
  what the #325 cross-machine refusal needs. Older yields in history are read with the
  new rule too. A winner that later finished and released is still cancelled by that
  plain release. A winner whose issue was closed by a merge (ship posts no release on a
  closed issue) stays live, just like any claim on a closed issue did before.
