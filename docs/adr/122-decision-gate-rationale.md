# Decision gate: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Decision gate — a human must answer first (#122)*](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Design approval measured

Measured in one adopting repo: a design issue
carrying an earlier "start" ruling got a hand-added `needs-decision` for its approval,
and the design lane then read the earlier `decision-recorded` as the approval.

## Eleven design issues held at filing

Measured in one adopting repo: 11 design issues each got `needs-decision` within 2 s of
being filed, and each one's acceptance list included the human approving the final
screenshots. No artifact existed, so there was nothing to approve, and no design session
could open. They stayed held for about 4 h. What freed them was a ruling to "start now",
recorded on all 11. That ruling answers no design question, so every real approval now
needs a `--reopen`. A sibling filed the same morning shows the working shape: claimed
without the label, labelled once its screenshots existed about 40 min later, and ruled
8 min after that.

## Epics in an inbox

A decision inbox built on start gates may also leave
epics out by design. One adopting repo's inbox puts them in a collapsed "informative"
lane, so a question posted there is one nobody is shown. Measured: four epics in one repo
carried multi-option blocks that sat unanswered for 78–169 h. Four epics in another repo
were labelled `needs-decision` with no question on them at all, until a human ruled that
an epic never carries the label.

## Why a sub-issue

Why a sub-issue: it keeps the question visible
from the epic's own `subIssues`, and the decision issue is an ordinary issue, so every
inbox and triage pass that reads start gates shows it.

## The hand-added second label

Measured in one adopting repo: one such hand-added
label hid the second question from that repo's decision inbox for about nine hours. The
human ruled in chat after noticing the question was missing.

## Why the pair leans towards showing

Showing a settled question
once more costs a glance. Hiding an open one costs a human's ruling.
