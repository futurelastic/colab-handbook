# code-ship · §0 Verify the hand-off contract

Reference for [`code-ship`](SKILL.md) §0. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## 0. Verify the hand-off contract — don't trust the report, re-derive it

`code-wrap` **asserts** seven things when it stops. Re-check each from git and GitHub
directly — a session's own report of its state is exactly the kind of self-grading #94
exists to add a second check on top of:

**Resolve `$MAIN_REPO` first, from wherever this coordinator session happens to be
running** — it may itself be inside a worktree, and every plan-file path below is
meaningless unless it is anchored to the main checkout rather than `$PWD` (#113):

```sh
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"

git ls-remote origin <branch>                              # branch actually pushed?
gh issue view $N --comments | tail -5                       # distill comment present?
colab claims                                                 # claim(s) still held?
case "${COLAB_PLANS_DIR:-.plans}" in /*) PLANS_DIR="$COLAB_PLANS_DIR" ;; *) PLANS_DIR="$MAIN_REPO/${COLAB_PLANS_DIR:-.plans}" ;; esac
ls "$PLANS_DIR/issue-$N.md" "$MAIN_REPO/.claude/plans/issue-$N.md" 2>/dev/null  # plan file, if one was written (#488: configured dir, then legacy)
git -C "$MAIN_REPO" status --porcelain -uall                 # trunk checkout still clean?
```

- **Branch not on the remote** → `code-wrap` did not finish A5. **You may push it — and
  only it.** The head that exists locally, unchanged, when it equals the commit
  `code-wrap` reported in its hand-off; nothing else. Verify before you push, do not
  assume:

  ```sh
  git rev-parse <branch>                 # must equal the sha code-wrap reported
  git log --oneline origin/<trunk>..<branch>   # must be this branch's own commits only
  git push -u origin <branch>
  ```

  If the local head is **not** the wrapped commit, that is a different problem —
  somebody committed after the wrap, and this skill has no idea whether that work was
  gated. Stop there and **send it back** (below).

  **This is the one thing the coordinator may do to the branch, and the boundary is
  source** — stated once in `CONVENTIONS.md`
  [§4, *Who may touch a branch*](../../CONVENTIONS.md#who-may-touch-a-branch--the-coordinator-never-edits-implementer-work-409)
  (#409). You may push a wrapped head, re-run an infra-class red run once (the test for
  *infra-class*: B1a, *Telling infra from finding*), cure-merge,
  open a PR to obtain branch CI for the branch that carries a red trunk's fix (that
  branch only — B1, *Red trunk*), and — in B0 only — sync the base in, regenerate a
  generated file after taking one side, and resolve a purely mechanical conflict. You may
  **not** edit source, add a commit of your own beyond that sync, amend, or
  force-push — the grader is not the fixer, and a coordinator that writes code is
  grading its own work one step later. Measured, 2026-09-05: a branch's head — the very
  commit whose message said the failure was resolved — sat unpushed for a day because
  this line read *"stop; do not improvise a push from here"* while the paragraph twenty
  lines below told the same reader to *"re-push"* before continuing. Nobody pushed, no
  CI run ever validated the fix, and the contradiction was doing the blocking.
- **No recent distill comment** → A1 did not happen, or happened somewhere this can't
  see. **Send it back** — the distill is the implementer's knowledge, not the
  coordinator's to reconstruct (#409). Don't assume it was verbal. A `↩️ Sent back`
  comment or a bare one-line signature (`— <name> …`) is not a distill — the same filter as
  [`code-sweep`](../code-sweep/SKILL.md) §3, test 3 (#517).
- **Claim released already** → someone (or something) other than this skill let it go.
  That is a finding — B3 below is supposed to be the only unconditional release — chase
  it before merging over a claim that may no longer mean what it used to.
- **Claim held on ANOTHER machine** (a remote-built branch: `colab claims` here shows nothing,
  the issue shows a live `🔒 Claimed` on this branch from another host) → not a gap and not a
  re-claim: land it from the executor's distill comment, `colab ship --branch <b> --handoff
  <comment-url>` (#578). Ship verifies the comment names the branch and its current remote head
  and that the executor's claim is live; it claims nothing here. A refusal (the head moved, the
  comment names no sha) is a **send-back** for a fresh hand-off — never `colab claim --force`,
  which stays a human takeover.
- **Gate result, `gate: authoritative: ci` repos (#410)** — trunk's `project.yml` declares
  `gate:` with `authoritative: ci` and a workflow fires on a session-branch push
  (`tools/lib/gate.js` `gateMode` → `ci`). Then the hand-off names a **branch-CI run id**,
  not a local gate claim, and this is the whole check: `gh run view <id> --json
  headSha,conclusion` — its `headSha` must equal the branch's current head, and B1a
  re-derives the class from GitHub anyway. **Never run the suite locally here.** A run id
  at another sha is stale: read the run at the current head (B1a's bounded wait). No run
  id, or a `red:finding` class → send back. There is no hermetic verdict to look for: a
  clean CI runner is that run by construction.
- **Gate result, every other repo** (no `gate:`, `authoritative: local`, or no branch
  trigger) has no independent artifact to re-derive from outside the report itself on
  most repos — trust the report here, but if anything else on this list is off, treat the
  gate claim as unverified too and **send it back** rather than re-running the
  implementer's gate yourself (#409).
  **The gate claim must carry the hermetic verdict (#403)** — the word `colab
  gate-hermetic` printed: `green`, or `skipped` (trunk declares `live-env: none`), or
  `branch-ci <sha7>` (#408). A hand-off that says only "gate green", with no hermetic
  verdict, has not shown the test step passing without this machine. **Before re-running
  anything locally, check whether branch CI already answers it** (`code-wrap` A3's
  conditions): B1a's class is `green` at the current head sha, that workflow runs the same
  test command, and its runner does not share a developer's machine (hosted or ephemeral,
  never a self-hosted runner in someone's login session). If all three hold, that run is
  the hermetic verdict. Record `branch-ci <sha7>` and do not run the suite again. A
  `branch-ci` verdict naming a sha other than the current head is stale; read the branch
  run at the new head instead. Only when branch CI cannot arrive (no trigger for the
  branch), is not `green`, or does not run the tests is the hermetic verdict genuinely
  missing — and then it is a **send-back**, not a coordinator re-run of
  `colab gate-hermetic` (#409: the coordinator never runs the implementer's gate for it).
  Why: [ADR 536](../../docs/adr/536-code-ship-0-handoff-contract-rationale.md).
  **`live-env` is a red gate**: send it back to the
  implementer the same way as any other red. Never read it as an advisory, and never
  merge past it.
  **The branch-CI class A5 reports is the opposite case — it *does* re-derive, and B1a
  below re-derives it rather than reading it here.** A missing class in the hand-off is
  a wrap that skipped a step, worth saying in the report; it is not a blocker, because
  B1a measures it again from GitHub anyway. A class that *contradicts* what B1a measures
  usually means the head moved between the two reads, which is B1a's own sync caveat,
  not a dishonest report.
- **Trunk checkout dirty here too** → `code-wrap` A2b's own re-derivation (its *Verify
  complete* step) either missed this or ran before whatever caused it. Don't re-run the
  same ownership ladder blind: `git ls-remote` above already told you this branch's
  remote sha, so diff it directly — `git -C "$MAIN_REPO" diff --name-only <path>` against
  the branch's own commits for **branch overlap**, then the dirty path's content, same as
  `code-wrap` A2b — before deciding whether this is the wrapped session's own stray write
  (send it back, don't merge over it) or a genuinely different live session's work
  (`colab worktrees` for a name to route the finding to). **Never merge past an
  unattributed dirty trunk** — `colab ship`'s own precondition already refuses on a
  dirty trunk checkout; this is what turns that refusal into something someone can act
  on, not a reason to bypass it.

A contract that fails to verify is not a reason to skip the merge — it is a reason to
fix the gap before continuing, or to **send it back** to the implementer rather than
papering over it here. **"Fix the gap" is mechanical only, and it is exactly two
things**: re-push a wrapped head, re-claim a released claim. Everything else — a missing
distill, an unwrapped or uncommitted change, a missing or red gate verdict, anything that
needs a line of source changed — is a send-back, never a fix from here (#409; see the push
bullet above for why that boundary is written twice).

**A send-back is one Issue comment, and it is how this skill hands work back** —
`CONVENTIONS.md`
[§4, *Who may touch a branch*](../../CONVENTIONS.md#who-may-touch-a-branch--the-coordinator-never-edits-implementer-work-409):

```sh
gh issue comment $N --body "↩️ Sent back — <the gap, e.g. uncommitted work in <worktree>;
no gate verdict at <sha7>>. To the implementer of <branch>: commit the deliverable paths,
run \`code-wrap\`, stop."
```

The `↩️ Sent back` prefix is load-bearing: colab reads it as bookkeeping (`shipguard`
`TOOL_MARKS`), so it is never mistaken for evidence or for a hand-off comment. Post it
once per head — if one already stands and the branch head has not moved since, do not
repeat it. Report the candidate as sent back and stop working on it; never wrap it here.
