# code-triage · §3 Group — when issues must serialize

Reference for [`code-triage`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


**Issues that touch the same files must serialize.** Two sessions editing the same
files merge over each other; grouping is how that is prevented — the obligation is
serialization, and how it is realized follows
[`writes`](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)
(⚖ #233 — a veto now, not a method choice): on `writes: isolated` (the veto), one
branch, always — every rule below applies unchanged. On a repo permitting trunk-direct
(absence, or any other declared value), an attended human session behind a place-claim
is enough on its own; a branch is mandatory only when one of [§2](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)'s two conditions fires (more than
one unit in flight, or a gate must inspect the unit before it lands) — see §6's
`start:` line for what that changes about the command a session runs. Triage output
itself is consumed by sessions that may be UNATTENDED, so `start:` never assumes
attendance on its own — see §6.

Group when:
- the issues touch overlapping files or the same subsystem
- one is a prerequisite of another
- they are children of the same epic and land together naturally

Keep separate when the files are disjoint — parallel sessions are the point.

**On `isolated`, name the group per [`CONVENTIONS.md` §4](../../CONVENTIONS.md#4-branches-and-commits):**
every issue number in one **trailing** run, e.g. `fix/import-fixes-115-114-113`.
This is load-bearing — code-wrap's harvest reads the branch name and the claim
registry, so a number in neither is one the wrap will never find, and it sits open
with its code merged. The failure this whole skill exists to prevent, re-created by
sloppy naming.

**On an attended trunk-direct unit with no branch, the branch-name half of that harvest
is empty by construction** (`code-ship` B1b) — claim every member issue anyway, and cite
each `#N` in the trunk-direct commit body, since that is the only source harvest has left
to read.

**Epics: read the state, never the title.** The title states the ambition; the title is
not evidence. Where the state lives depends on how the epic is built:

- **Native sub-issues** — `gh issue view <epic> --json subIssuesSummary,subIssues`.
  GitHub maintains this; it cannot drift. Prefer it, and prefer converting an epic to it.
- **A hand-written checklist** — read the table, and **treat it as a claim, not a
  fact.** It is maintained by `code-wrap` B2c and `code-sweep` §5, both of which run
  only when someone runs them; a table nobody has swept since the last merge is stale
  by default. Spot-check any line that decides your plan — *especially* one reading
  "in progress on branch `x`", which is the form that most often survives its own
  branch and sends a session to redo shipped work.

Verify `file:line` references before quoting them; engines get edited and refs rot.
