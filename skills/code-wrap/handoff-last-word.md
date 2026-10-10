# code-wrap · Hand off — the hand-off comment is the last word on its head

Reference for [`code-wrap`](SKILL.md) Hand off. The core holds the rule and its stop condition;
this file holds the why and the edge cases (#586).

### Why it must be last

A landing coordinator on a different machine from the one that built the branch finds the
hand-off by reading the issue thread. A comment posted after it — a CI re-check note, a status
line — can hide it: in one measured case a wrapped, green branch was never picked up for landing,
because the last comment on its issue was a CI re-check note. The coordinator is also being taught
to look past such comments; the skill still makes the hand-off unambiguous on its own.

### What it carries

- The branch, as a whole token, and the **full** head sha — `git rev-parse HEAD`, never a short
  form. `colab ship --handoff` accepts any 7–40 hex prefix of the remote head, but a full sha
  can never be ambiguous and reads the same on every tool that parses the thread.
- A1's distill: what was done, decided and left open.
- A5's branch-CI class at that head, with the run id where there is one
  (`branch-ci <sha7> run <databaseId>`), and the gate / hermetic verdict word (A3).

That is why it is posted at *Hand off*, after A5, and not at A1: at A1 the deliverable is not
committed yet (A4), so the head the comment would name does not exist, and neither does its CI
class.

### After the hand-off

| what happened | what you do |
|---|---|
| CI re-checked, class changed, anything else learned — **same head** | `gh api -X PATCH repos/{owner}/{repo}/issues/comments/<id> -f body=@<file>` (edit the hand-off), or post a complete new hand-off that restates everything |
| new head — A5's `red:finding` fix, a sync, any commit | a complete new hand-off naming the new full sha; the old one names a head that no longer lands |
| nothing | nothing — no "still green", no "done" line after it |

Never a separate follow-up comment after the hand-off on the same head. A new hand-off must be
complete on its own: whoever reads only the last comment must find branch, full sha, class and
the distill there.

Prefer a **new** comment over an edit whenever the head moved: `code-ship` §0 looks for a distill
comment *newer than the head*, and an edit does not change when a comment was created.
