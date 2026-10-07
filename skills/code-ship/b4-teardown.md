# code-ship · B4 Tear down the worktree, delete the plan file

Reference for [`code-ship`](SKILL.md) B4. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B4. Tear down the worktree — remove by DEFAULT

Made a worktree? **Remove it.**
Removal
is the default path; keeping one is the exception you must justify.

Why: [ADR 536](../../docs/adr/536-code-ship-b4-teardown-rationale.md).

```sh
colab worktree rm <name>    # if colab is installed (releases its claims, frees its ports) …
git worktree remove <path>  # … else raw git
```

**The raw fallback is not equivalent — it only deletes the directory.** `colab
worktree rm` does four things: removes the directory, drops the worktree record from
`state.json`, frees the ports the record owned, and releases the issue claim(s) it
carried. Raw `git worktree remove` does the first and nothing else — the record
survives with `status: "running"`, still holding its ports, and any tool reading
`colab worktrees` reports it as live work in progress long after the checkout is
gone. Taking this path (no `colab` on this machine) means finishing the other three
by hand, on the machine that holds `state.json`: release each claim
(`gh issue edit <N> --remove-assignee <claimer> --remove-label in-progress`, `<claimer>` = the account that
applied `in-progress`) and have that machine prune the
stale record — `colab` has no unattended flag for this, so say so in your report
rather than leaving it silently wrong.

`colab worktree rm` runs the repo's `.colab/hooks/pre-remove` (e.g. dropping a
cloned DB) and refuses if there's uncommitted work — tracked changes **or**
untracked, non-ignored files. Untracked counts because it is the only category
with no copy anywhere else: not in the index, not in a commit, not on the remote.
Ignored files (build output, a copied `.env`) never block.

**It also refuses when the worktree still owns running processes** — anything
whose cwd is inside it, typically the dev server you started. That is not an
obstacle to route around: remove the tree underneath a live server and it keeps
listening on a port the registry now calls free, serving a checkout that no
longer exists. Stop the server and re-run, or pass `--force` to have `colab`
terminate what it owns. Ownership is decided by cwd, never by port, so `--force`
cannot reach an unrelated process that merely holds the same port.

**Keep it only for a named reason,** and write the reason in your report — never
leave one standing silently:

- the group branch still has unfinished issues,
- a human just told you to keep working in it,
- teardown is blocked by uncommitted work (tracked or untracked).

> **If you keep it, release its claims by hand.** `colab worktree rm` is *what*
> releases claims — skip the removal and that automatic path never runs, so B3
> did not happen for you. Do it explicitly:
> ```sh
> colab release <N>                              # … or, without colab:
> gh issue edit <N> --remove-assignee <claimer> --remove-label in-progress   # <claimer> = @me only if you claimed it
> ```
> B3 is unconditional: a kept worktree changes **who runs** the release, never
> **whether** it runs.

### Delete the plan file and journal its usage, in the same breath (#94)

**`colab ship` does this for you** — per issue in the harvested set (B1b), it appends
one line to `~/.colab/plan-journal.jsonl` (rung/cause read from the plan file's own
front matter, verdict always `pass` — a `reject` never reaches this far) and only then
deletes the plan file, chained so a failed journal write leaves it in place. This used
to be a step only this shell snippet performed (#115: verified zero matches for
`plan-journal`/`plans/issue-` in `tools/colab` before that fix), so a ship driven
through the tool alone left the plan file on disk with no journal line — that gap is
closed; nothing here to do on that path.

**Only if `colab` isn't available in this repo** (no `tools/colab` to run `colab
ship` with — a repo lacking `autonomy: auto-trunk` still has the tool, a human just
triggers it instead of the tool running unattended), do the equivalent yourself —
resolved by **file, tested against the
harvested set**, never by reconstructing `issue-$N.md` from one number at a time
(#201's fix in `tools/colab`'s `shipJournalPlanFiles`, mirrored here rather than
re-derived: a group session's plan file is named for the whole set,
`issue-<A>-<B>-<C>.md`, so guessing the name from a single member number misses on
every one of them — the loop completes silently, indistinguishable from the
legitimate rung-0 "never had a plan" case). Check the main checkout, not the
worktree, which this step may already be removing. `$MAIN_REPO` is `§0`'s resolved
absolute path; re-derive it here if this step runs in a fresh shell that no longer
has it (#113):

```sh
MAIN_REPO="${MAIN_REPO:-$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")}"
case "${COLAB_PLANS_DIR:-.plans}" in /*) PLANS_DIR="$COLAB_PLANS_DIR" ;; *) PLANS_DIR="$MAIN_REPO/${COLAB_PLANS_DIR:-.plans}" ;; esac
ISSUES="<harvested issue numbers, space-separated>"
GRADE_VERDICT=pass   # only a `pass` reaches B4 by construction (B1c stops a reject before
                      # this step); use the same token B2b's marker emits, never a bare word
for PLAN in "$PLANS_DIR"/issue-*.md "$MAIN_REPO"/.claude/plans/issue-*.md; do   # #488: configured, then legacy
  [ -f "$PLAN" ] || continue
  NUMS=$(basename "$PLAN" .md); NUMS=${NUMS#issue-}   # e.g. "12-14-15"
  SUBSET=1
  for N in $(echo "$NUMS" | tr '-' ' '); do
    case " $ISSUES " in *" $N "*) ;; *) SUBSET=0; break;; esac
  done
  [ "$SUBSET" = 1 ] || continue   # not a subset — leave it untouched (#201): a partial
                                  # overlap may be another session's live plan, or a
                                  # wider group's file this ship only carries part of
  RUNG=$(sed -n 's/^rung: *//p' "$PLAN" | head -1)
  CAUSE=$(sed -n 's/^cause: *//p' "$PLAN" | head -1)
  mkdir -p "$(dirname ~/.colab/plan-journal.jsonl)"
  python3 -c '
import json, sys, datetime
nums, rung, cause, verdict, out = sys.argv[1:6]
ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
with open(out, "a") as f:
    for n in nums.split("-"):
        f.write(json.dumps({
            "ts": ts, "issue": int(n), "rung": rung, "cause": cause, "verdict": verdict,
        }) + "\n")
' "$NUMS" "${RUNG:-1}" "${CAUSE:-none}" "$GRADE_VERDICT" ~/.colab/plan-journal.jsonl \
    && rm -f "$PLAN"
done
```

- **Machine-local, never the tracker.** `~/.colab/plan-journal.jsonl` never leaves this
  machine and is never committed — it is not a second source of truth about the feature,
  only a record of how the planning mechanism itself is being used.
- **One line per issue in the file's own number set**, not one per branch and not one
  per file — a group branch can carry several issues behind one shared plan file, and
  rung/cause are read from that file once and reused for every line it contributes,
  since a shared plan file has one front matter, not one per issue.
- **A file matches only when its whole number set is a subset of the harvested
  issues.** No overlap means it belongs to unrelated work; a *partial* overlap still
  means leave it alone — it may be another session's live plan, or a wider group's
  file of which this ship only carries part. Acting on a partial match would journal
  and delete a plan another session is still using.
- **This is the one moment everything about the plan's life is known**: rung, cause
  (flagged vs self-escalated), and B1c's grade verdict. Weeks of this file answer rung
  frequencies, flag precision (flagged but the diff graded clean with no friction?), and
  flag recall (unflagged but a mid-session escalation caught it?) — the evidence to tune
  or retire the `needs-plan` mechanism. Nothing reads it automatically; a human greps it.
- **Delete only after the journal line(s) land, and chain it — never split across
  statements.** The append and the `rm` are one `&&`-joined command, not two lines, because
  a compose that fails silently (wrong interpreter, a bad argument) must not let control
  reach the delete. This is `python3`, not `jq`, on purpose (#96): `jq` was pulled in for
  this one line and appears nowhere else this skill family actually depends on, while
  `python3` is already an assumed interpreter elsewhere (`code-sweep` §1's worktree-filter
  snippets) — so this removes an undeclared dependency rather than adding one more thing
  every machine running this skill must have installed.
  Why: [ADR 536](../../docs/adr/536-code-ship-b4-teardown-rationale.md).
- **Chained per FILE, not per issue** — every line a file contributes is written in the
  one append, and the delete follows only on success, so a failed write for one plan
  file leaves that file in place without touching siblings already journalled.
- **Delete only after the journal line lands**, and a harvested set with no matching
  file at all is a silent no-op here — a rung-0 session never had one, and this loop
  skips it correctly.
