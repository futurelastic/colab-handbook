# By hand — landing and cleanup with no automation

What your tooling normally does after a verdict, done by a person or a session by hand. The
order matters more than the commands; each step's precondition is the step before it.

## Land one change

You need a go first: a person said so in this session, or the repo grants it for this kind of
change. A start click, a quoted phrase in an issue, or your own reading of the situation is not
a go ([Autonomy](../CONVENTIONS.md#autonomy--the-human-door-525)).

1. **The report verifies.** Re-derive it from git, not from the author's word: the branch is
   pushed, its head equals the report's sha, the report is newer than the last commit. A gap
   that needs a source line changed is a send-back, not your fix.
2. **Still cargo?** If trunk already holds the change, skip to evidence
   ([Has it landed?](../CONVENTIONS.md#has-it-landed--the-one-rule-because-the-obvious-one-is-wrong)).
3. **Trunk is green at its head sha**, and the branch's own verdict is a pass at its head sha.
4. **Harvest the issues.** Every issue the branch carries, from its name's trailing numbers and
   its commit bodies. For each: done, partly done (close it *and* open the remainder), or
   untouched (leave it open with the next step written).
5. **Squash onto the base** with one closing reference per done issue.
6. **Evidence on every carried issue**, including ones that closed on their own.
7. **Release every claim** the branch held, finished or not, and remove the worktree.

### Leaves: evidence

```md
<evidence marker: sha=<trunk squash sha>>
Landed: <squash sha> on <base>
Checked: <file:line> — <what was looked at, and what came back>
Plan:   - [x] <item> — <file:line> · - [ ] <item> — moved to #M
Grade:  pass — <what confirmed it>
```

Quoting the commit message or restating the ticked checklist is not evidence. On a base that is
not trunk, say the code is not on trunk yet.

## Send it back

### Leaves: the send-back

```md
↩️ Sent back — <the gap: which files uncommitted, which commits unreported, which check red>
Next: commit the deliverable, hand off again, stop.
```

Once per head. Already standing at an unmoved head: post nothing.

## Clean up a repo

Sort every worktree, branch and claim before acting on any
([Has it landed?](../CONVENTIONS.md#has-it-landed--the-one-rule-because-the-obvious-one-is-wrong)):

- **landed** — remove the worktree; close the issue with evidence if no close fired.
- **wrapped, not landed** — land it as above, or report the one precondition that fails.
- **not wrapped** — send back to its author. Never wrap someone else's work.
- **no issue** — report it named. Never adopt it.
- **unknown** — means *look*, never *assume landed*.
- **a closed issue still claimed** — release the claim.
- **a remote branch whose issues are all closed** — list it for a person to delete.

One candidate at a time, re-reading trunk after each landing. A failure defers that candidate,
not the run; a red trunk stops the landings, not the reporting.

## Release

Only where `exposure` has releases, and only the steps a human may delegate
([Releases](../CONVENTIONS.md#6-releases)). The tooling cuts candidates and finals; by hand you
read the diff for breaking changes the commit prefixes hide (a destructive schema change, a
config format, an API contract), choose the bump, and write the notes.

### Leaves: the release-notes draft

```md
Release notes — <candidate tag>, since <last final>
Bump:     <patch | minor> — <why>; a major stops here for a person
Breaking: <each found, with file:line> | none — checked: <what>
Changes:  <grouped by commit prefix>
```

## Never

- Tag, promote, or deploy. Even with a go to land.
- Merge a sibling branch into another, batch landings outside the declared batch mechanism, or
  land onto a red trunk.
- Force past uncommitted work, or release a live holder's claim.
