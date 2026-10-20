# Decisions — how the CLI records what a person decided

The mechanics behind [CONVENTIONS.md
§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this) — how a decision is recorded: the
ruling record and its reopen, the options block, the design-approval line, the ask said once and the
decision box.
The rules stay there, in the claims and decisions contract, in words that name no tool; how this
repo's CLI carries them out lives here. Moved verbatim from CONVENTIONS.md §5 by #639 — only links
were retargeted; each section keeps its heading there. Frozen with the rest of §5
([ADR 604](../../docs/adr/604-scope-freeze.md)). What lives in this directory, and why: [README](README.md).

## A question about an epic — its own decision issue

The rule: [CONVENTIONS.md, *Decision gate — a human must answer first (#122)*](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122).

**[Hard — gate: colab decision --reopen refuses]** **A question about an epic goes on its own decision issue**, the same shape as the third
path below. Its body carries the question and, if there are options, the
`decision:options` block. It carries `needs-decision`, and it is attached to the epic
**as a sub-issue**. If the question holds back a specific child, that child also gets a
`blocked_by` edge to the decision issue. Why, with the measurements: [ADR 122](../../docs/adr/122-decision-gate-rationale.md). Once the ruling is recorded
(`colab decision --record`), the decision issue closes with the record as its evidence.
`colab decision --reopen` refuses on an `epic`-labelled issue and names this path.

## Recording, reopening, and both labels at once

The rule: [CONVENTIONS.md, *Decision gate — a human must answer first (#122)*](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122).

**Recording the decision is what clears the gate — it is not a separate act a human must
remember.** The answer, not the label's
absence, is the artifact: a `⚖ Decision recorded` comment (`tools/lib/decision-record.js`)
naming who ruled and what it answers, plus the `decision-recorded` label, written together
by `colab decision <N> --record --ruled-by <name>` — never `needs-decision` cleared alone.
A reader checking whether an issue is decided looks for `decision-recorded` or the live
comment marker, never merely for `needs-decision`'s absence.

**A second question on an already-decided issue goes through `colab decision <N> --reopen
--ruled-by <name>` — never a hand-added `needs-decision` (#357).** `--reopen` removes
`decision-recorded`, re-applies `needs-decision` and posts a `↩ Decision reopened` receipt,
so the issue reads as open to every reader. A hand-added `needs-decision` does not: it
leaves the issue with **both** labels. Why, with the measurements: [ADR 122](../../docs/adr/122-decision-gate-rationale.md).

**Both labels at once is ambiguous, and a reader resolves it by time.** Two histories leave
the same pair. An **interrupted write** is `--record` posting its `⚖` comment and then
failing its label swap, so the question is answered. A **second question** is someone
re-adding the label by hand, so the question is open. Compare the newest *ask* with the
newest live, trusted `⚖ Decision recorded` marker. The ask is the newest `needs-decision`
`labeled` event on the issue, or the newest `<!-- decision:options -->` comment, whichever
is later.

| Evidence | Reading |
|---|---|
| The ask is newer than the marker | an **open question** — pending |
| No live marker at all, only the label | an **open question** — `--record` posts its comment first, so an interrupted write always leaves one |
| The label timeline was read, and every ask predates the marker | an **interrupted write** — answered; finish it with `gh issue edit <N> --remove-label needs-decision` |
| Anything the reader cannot prove (timeline unread, no event found) | **undetermined** — surfaced as **pending**, never hidden |

**[Hard — gate: colab decision --record refuses]** This leans towards showing the issue, like *Readiness* does. Why, with the measurements: [ADR 122](../../docs/adr/122-decision-gate-rationale.md). The reference reading
is `pairVerdict` in `tools/lib/decision-record.js`. `colab decision --list` names every
issue carrying the pair, with its verdict and fix. `colab decision --record` **refuses**
over the pair unless `--answers <ref>` says which question the new record answers.

Why, with the measurement: [ADR 539](../../docs/adr/539-decision-gate-rationale.md).

## Decision options — what a ruling chooses between (#126)

The rule: [CONVENTIONS.md, *Decision options — what a ruling chooses between (#126)*](../../CONVENTIONS.md#decision-options--what-a-ruling-chooses-between-126).

The mechanics above make the **answer** to a `needs-decision` gate machine-readable.
They say nothing about the **question**: what a human is actually choosing between.
Why, with the measurements: [ADR 126](../../docs/adr/126-decision-options-rationale.md).

**The filer of a `needs-decision` issue writes the options as a fenced block**, at
filing time, whether the filer is human or an agent — this is not scoped to
`agent-filed`/`Ask:` (above), because `needs-decision` itself gates issues from either
provenance:

```
<!-- decision:options
A: Short label (recommended) | One line of detail — the trade this option makes.
B: Short label | What this one buys and what it costs.
C: Short label | Listed for completeness; why it is probably wrong.
-->
```

- `LETTER: label | detail`, one option per line; `detail` is optional.
- **Two or more lines, or the block does not count**.
- An HTML comment fence, so it costs a human reader nothing in the rendered issue.
- **The block states the choices. It never states the answer** — recording the
  acceptance is the separate, later act above (`colab decision --record --answers
  <ref>`), naming the block it resolves.

**Lives in the issue body by default** — written once, at filing, alongside the rest
of the ask. A discussion that narrows the choices may re-post the block as a comment,
and then **the newest block by creation time is the live one** — the same
most-recent-wins reading `liveDecisions` already applies on the answer side. That rule
is for a reader rendering an issue nobody has answered yet. Which block a *recorded*
decision answers is never inferred from recency: `--answers <ref>` names it explicitly,
and that reference is what a consumer cross-checks against (`answeredOptionRefs`,
`tools/lib/decision-record.js`).

**Absent block means "options not declared"** — exactly as an absent `Ask:` line reads
as `backlog` (above): no backfill, no new failure state for issues filed before this
existed. The one exception is the design-approval ask below: a `needs-decision` question
in neither shape is reported to its filer as a finding (#379). That is a report, never a
gate, and it never changes whether the question is pending.

Why, with the measurement: [ADR 539](../../docs/adr/539-decision-gate-rationale.md).

## Design-approval ask — the Mockup: line (#379)

The rule: [CONVENTIONS.md, *Design-approval ask — the `Mockup:` line (#379)*](../../CONVENTIONS.md#design-approval-ask--the-mockup-line-379).

The options block is the shape for a pick-one question. The other common ask, approving
a finished design artifact (*Design conclusions are three units*, below), is a yes/no on
an image, and had no machine-readable shape at all. Why, with the measurements: [ADR 379](../../docs/adr/379-design-approval-ask-rationale.md).

**The design issue's body carries the ask as one line:**

```
Mockup: https://…/frozen-screenshot.png
```

- **In the body, never only in a comment.** The session that produced the artifact edits the body when it asks.
- **Anchored at the start of a line**: `Mockup:`, then the URL of the frozen image. An
  indented or inline `Mockup:` is quoted text, not a declaration. The image is the same
  frozen evidence unit 3 attaches to the ruling.
- **A set reviewed together** (one review per workflow set) puts one `Mockup:` line in
  **each** member's body, pointing at that member's image. The review comment keeps the
  full gallery and the per-page A/B lines.
- **Several lines are allowed** when one issue's approval covers several frozen images.
- **Both shapes present** read as the options block: a pick-one question is the more
  specific ask.
- **On an issue that already carries `decision-recorded`**, the ask still goes through
  `colab decision <N> --reopen` (*Decision gate*, above). The `Mockup:` line says *what*
  is asked. `--reopen` is what makes it read as asked.

**A `needs-decision` issue whose ask is in neither shape is a finding for its filer**, not
an item left in the queue. `code-triage` and `code-sweep` report it and name the filer.
They do not rewrite the ask, because the question is not theirs to restate. The reference
reading is `askShape` in `tools/lib/decision-record.js`, which `evaluateIssue` reports as
`unshapedAsk` when it is given the body.

Why, with the measurement: [ADR 539](../../docs/adr/539-decision-gate-rationale.md).

## An ask is said once — a later pass reports that it is still waiting (#489)

The rule: [CONVENTIONS.md, *An ask is said once — a later pass reports that it is still waiting (#489)*](../../CONVENTIONS.md#an-ask-is-said-once--a-later-pass-reports-that-it-is-still-waiting-489).

The shapes above say how a question is put to a human. This rule says how often. Why, with the measurements: [ADR 489](../../docs/adr/489-ask-said-once-rationale.md).

**An ask is open when either of these holds:**

- **The tracker already carries it.** The issue has a pending `needs-decision` (*Decision
  gate*, above, read with `pairVerdict`) whose ask has a shape, either an options block or
  a `Mockup:` line. Or its newest `Hold:` line has `wake: ruling` (*Holds*, above), and the
  `Because:` line is the ask. A decision inbox that an adopting fleet runs reads these same
  marks, so a question already in that inbox is open in this sense too.
- **An earlier pass of the same skill already rendered it** in its own output and stored
  it (`code-triage` §0.1, `asks`). Use this when the question exists only in that
  session's output, for example *wake met, lift?* or *a ruling exists in a comment, record
  it?*.

**An open ask gets exactly one line on every later pass. A pass never renders its options
again:**

```
unchanged, waiting on <link> since <date>
```

- `<link>` is where the answer goes: the options-block comment, the `Hold:` line comment,
  or the issue itself for an ask that was only in session output.
- `<date>` is when the ask was first put. That is the newest ask event for a tracker ask
  (the same "newest ask" *Decision gate* compares with the marker), and the date of the
  first rendering for an ask that was only in session output. It is never the date of this pass.
- A pass may append who clears the ask. It never adds the question, the options or the
  recommendation again: those are behind the link.

**A new ask is rendered once, as a five-line card:** the question first, then two or more
options, then the recommendation on its own line, then what stays parked if nobody
answers, then the link. Any of these makes an ask new: it was never rendered before, the
tracker now carries a newer ask than the stored one (a re-posted options block, or a
`--reopen`), or the question itself changed. A card is session output, like the rest of a
triage report. It never authorises a tracker comment that a skill's own write list does
not name.

**Waiting on a human is not a change.** An unanswered ask gets older on every pass, but its
age is not an input to anything. A pass whose only news is "still unanswered" is an
unchanged pass: on a skill with a no-change short-circuit (`code-triage` §0), it stays on
the cheap path. It never re-asks, escalates or re-renders because time has passed. What
moves an ask is the human's answer (a recorded decision, a label removed, a hold lifted).
Those already move the inputs that the short-circuit compares.

**No open ask, no change.** A repo with no open human ask renders nothing new.

Why, with the measurement: [ADR 539](../../docs/adr/539-decision-gate-rationale.md).

## An ask the human must answer can be raised once in a decision box (#490)

The rule: [CONVENTIONS.md, *An ask the human must answer can be raised once in a decision box (#490)*](../../CONVENTIONS.md#an-ask-the-human-must-answer-can-be-raised-once-in-a-decision-box-490).

The rule above controls how often a coordinator says an ask. It does not control where the
human sees it. Some items cannot be settled by any coordinator: a migration grant, a
promotion, a design ruling, a production credential, a destructive operation. A pass that
finds one sets it aside and leaves it in the tracker's decision queue. The human who owns
it may not watch that queue. A deployment may run a separate **decision box** that the
human does watch. This rule says how a coordinator delivers the ask there, and how the
answer gets back.

**The box is optional and set by the deployment.** A skill reads its endpoint from a
deployment setting. No host is ever written into a skill or into this handbook. **No
endpoint set means no change:** the ask stays where it already lives, as the issue's
`needs-decision` label and its `decision:options` block (*Decision options*, above).

**Only a human-only item is raised.** That is an item the pass set aside because no
coordinator may decide it, the list above. An ask that a coordinator can rule on is ruled
on, not sent on.

**The tracker stays the record. The box only delivers.** Raising an item changes nothing
on the issue. The label, the options block and any `Hold:` line stay exactly as they were,
and readiness still reads them. A box that is down, or never answers, loses a delivery,
never the ask.

**A raise carries everything needed to answer without opening the tracker:**

- the issue link;
- the question;
- two or more options, taken from the issue's `decision:options` block, never re-derived;
- the recommendation, on its own line;
- what stays parked if nobody answers;
- an opaque **reply-to**. The raiser composes it and the box hands it back unchanged with
  the answer. The box never parses it. It is what lets the answer find its issue.

These are the five lines of a new-ask card (above), plus the reply-to.

**Raised once, checked first.** An item is identified by its issue link plus the date of
its newest ask (the same "newest ask" *Decision gate* compares). Before raising, a pass
looks for an earlier raise under that key. It looks in its own stored asks, and in the box
when the box can answer the lookup. If it finds one, the pass writes the one line from the
rule above, with `<link>` pointing at the raise in the box:

```
unchanged, waiting on <link> since <date>
```

It does not raise the item again. A newer ask on the issue (a re-posted options block, a
`--reopen`, a changed question) is a new key, and it is raised once in turn.

**The answer comes back as a comment on the issue, and the raiser never polls.** The box
has an answer notifier. The deployment wires it to post the human's answer onto the issue
named by the reply-to. The raising skill never asks the box whether an answer has arrived.
Waiting is not a change (above). The comment that arrives is an answer left in a comment.
It moves the issue the same way as one typed into the tracker by hand: it is recorded as
*Decision gate* requires before the gate lifts. The box itself never removes a label or
records a decision.
