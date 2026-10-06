# code-triage · §4 Single-issue mode and the `deps-checked` marker

Reference for [`code-triage`](SKILL.md) §4. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


**`ceremony: light` repo (project.schema.md#ceremony--optional)? Order and group as
normal, but skip the `deps-checked` labeling pass below** — ordering and grouping are
judgements this skill still owes every repo; the label write is the one step that is
pure cost here. It is coherent specifically because a `light` repo can never carry
`autonomy: auto-trunk` (the audit enforces that pairing as a finding), so nothing
unattended ever consumes the readiness column — an empty column that nothing reads
costs nothing, while a filled one on a repo few humans revisit is ceremony with no
consumer.

Given one specific issue rather than a backlog, do the same work scoped to it: is *this*
ready? Run §2 and the §5 gate against it alone, then leave the answer **where a machine
reads it** — either a `blocked_by` edge naming the blocker, or the `deps-checked` label:

```sh
colab readiness <N>              # records the review; prints the open blockedBy count  (--clear to undo)
gh issue edit <N> --add-label deps-checked      # … the raw form, if colab is not installed
```

Prefer `colab readiness`: colab owns the write, so it is journaled like every other action,
takes the label name from one place, and is the single site the observer event will emit
from once its kind is agreed. The raw `gh` edit is the portable fallback and does the exact
same label write. That converts *unchecked* into *checked-and-free*, which is the one distinction the gate
cannot make for itself — an empty `blockedBy` is identical whether someone checked or
nobody did. A prose comment saying "no blockers" does not do this; it is unreadable to
the gate, which is the whole reason this convention exists.

**Set it only after looking, and check it has not gone stale before trusting it** — the
label carries no expiry of its own, so §0.2 derives one from the timeline.

**Confirm the label actually landed — an exit code is not evidence it did.** A repo that
adopted the conventions before `deps-checked` entered the set never back-filled it, so the
marking write targets a label that does not exist. `colab readiness` now diagnoses that
case loudly (it names the missing label and tells you to run handbook-sync) rather than
reporting a success that wrote nothing — but the raw `gh` fallback does not, and no command
can prove the *write* took from its own exit status alone. So after marking, read the label
back and treat empty as un-marked, not as done:

```sh
gh issue view <N> --json labels -q '.labels[].name' | grep -qx deps-checked \
  || echo "readiness did NOT land on #<N> — the label set is likely un-adopted; run handbook-sync (§7)"
```

An issue whose readiness "succeeded" but shows no `deps-checked` is the doubly-silent
failure this guards: the card never promotes and the next triage re-prints its cached
verdict without retrying. Surface it — do not trust the command's exit code over the tracker.

Single-issue mode is also a **scope**, and §0.1's coverage rule applies to it: a conclusion
reached about one issue answers for that issue and no other, no matter how still the repo
has been since.
