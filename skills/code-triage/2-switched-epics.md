# code-triage · §2 A switched epic — reading its switch

Reference for [`code-triage`](SKILL.md) §2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

**A switched epic is still an epic, but read its switch while you have it (#340).** This runs
only where `CONVENTIONS.md` [§5](../../CONVENTIONS.md#switched-epics--concurrent-unfinished-features-336),
*Switched epics*, applies: `exposure: released` in `.github/project.yml`, or a bare legacy
`tier: A`, which reads the same way (`tools/lib/axis-authority.js`). On any other exposure,
and on a bare `tier: B`, which says nothing about exposure, skip this paragraph and say so in
the report's one `switches:` line (§6). In scope, one call per open epic from the pass above
reads everything the policy derives from:

```sh
gh api graphql -F owner="${NWO%%/*}" -F name="${NWO##*/}" -F n=<epic> -f query='
  query($owner:String!,$name:String!,$n:Int!){ repository(owner:$owner,name:$name){ issue(number:$n){ body
    subIssues(first:50){ totalCount nodes{ number state closedAt body
      blockedBy(first:20){ nodes{ number state } }
      timelineItems(itemTypes:[CLOSED_EVENT], last:1){ nodes{ ... on ClosedEvent{
        closer{ __typename ... on Commit{ oid } ... on PullRequest{ number merged } } } } } } } } } }'
```

From that, derive per epic:

- **Markers.** Take every `<!-- colab:switch … -->` line in the epic's body and in each
  child's. Read them the way the rest of the marker family is read. Any of these makes the
  epic **not cleared**, and the report names the defect instead of guessing past it: an
  unrecognised key, a `name` outside `^[a-z0-9][a-z0-9-]*$`, a `role` other than `add` or
  `remove`, a `role` on the epic's own marker or a `needs` on a child's, two markers on one
  issue that disagree, two children carrying the same `role`, or a `role=remove` child with
  no `role=add` child.
- **State.** Exactly one of the following:
  - `undeclared`: the epic carries no marker. This is not "single-merge", and on its own it
    is not a finding. When the epic has two or more sub-issues, report it as the question the
    policy leaves open: *should this epic have a switch?*
  - `declared, not landed`: the epic is marked, but its `role=add` child is still open, or
    no child carries `role=add` yet. Say which.
  - `unfinished since <date>`: the `role=add` child is **closed by a merge**. That means its
    last close event's `closer` is a `Commit`, or a `PullRequest` with `merged: true`. The
    age is that close date. An add child closed with neither (closed by hand, or closed as
    not planned) is **not cleared**: nothing proves the switch is on trunk, and a human says
    whether it is.
  - `finished`: the `role=remove` child is closed by a merge, by the same test. Whether the
    epic itself is still open is the epic bucket's business, not this check's.
- **Needs** (rule 3). Each `needs=<A>` on the epic's marker should have a matching edge: A's
  `role=remove` child is in the `blockedBy` of this epic's `role=remove` child. Report a
  finding for a `needs` with no edge, and for an edge onto another in-scope epic's removal
  child with no `needs` naming it. When no open epic on this pass declares `A`, report the
  `needs` as `not checked`, never as satisfied.

Then count the `unfinished` switches. **Four or more** is rule 6's concurrency finding.
**Any switch older than 28 days** is rule 6's age finding. Print the actual count and age,
because the policy's numbers are approximate (`~3`, `~4 weeks`) and a human reads the value,
not just the threshold. Every result here is **a finding for a decision, never a blocker**:
it moves no issue between buckets. A ready child of a switched epic stays ready, and an add
child that would push the count past the cap stays startable. Triage adds no label and posts
no comment for any of it. The decision belongs to a human, and a finding re-posted on every
ping would be exactly the repeated note that the issue-comment rules forbid.
