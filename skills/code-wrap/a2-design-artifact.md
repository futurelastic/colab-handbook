# code-wrap · A2 Design artifact — promote it onto this branch

Reference for [`code-wrap`](SKILL.md) A2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### Design artifact — promote it out of exploration, onto this branch, right here (`CONVENTIONS.md` §5)

A fifth destination, distinct from the four above because it is not "this session
made a doc stale" — it is a durable repo asset that only now has a session to carry
it. If this branch's work followed an approved design ruling — a `⚖ Decision
recorded` marker on the Issue (`CONVENTIONS.md`
[§5](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two), *Design
conclusions are three units, not two*) — its artifact belongs in `docs/design/`
on **this branch**, promoted right here at **A2**, not left sitting in a
scratch/exploration home with instructions not to promote it: that leaves the
next session touching the same surface to pay the design lane's boot cost again,
from nothing, as if the ruling never happened.

- File it `docs/design/<slug>-<N>-mockup.html` or `<slug>-<N>-spec.md`, per
  `CONVENTIONS.md` §5's
  naming — commit it as a deliverable path in A4, same as any other file this
  session produced.
- **Superseded artifacts are marked, never deleted** — trunk carries the design
  lineage. Replacing an earlier ruling's file for the same surface adds the new
  one and marks the old one superseded; it does not overwrite or remove it.

**Which branch carries the artifact follows the size rule** (`CONVENTIONS.md`
[§5](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two), *Design work
splits by size*, #359):

- **A small change to an already-designed surface** — promote it here, as above.
- **A `delivery:design` branch** (a new surface's design issue) — the artifact *is* the
  deliverable, not a promotion: commit it at A4 like any other deliverable path.
- **The build branch for a new surface** — its artifact is already on trunk, landed by
  the design issue this build was `blocked_by`. Build to it and promote nothing; mark an
  artifact superseded only if a new ruling on this branch replaced it.

**The ruling must postdate the review (#379, `CONVENTIONS.md`
[§5](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122), *Decision gate*).**
A `decision-recorded` label, or a `⚖` marker, recorded *before* the artifact was put up
for approval answers an earlier question, such as "start this work". It is not approval of
the artifact. Compare the newest live `⚖ Decision recorded` marker with the review: the
comment that posted the frozen screenshots, or the `--reopen` receipt that asked. The
marker must be the later of the two. If it is not, the approval is still pending. Do not
promote; say so in the wrap report, and leave the artifact where it is.

No design ruling landed on this branch → skip this step silently, same as any
other optional check A2 makes.
