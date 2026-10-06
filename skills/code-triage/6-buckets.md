# code-triage · §6 Blocked, `ASKED`, taken, close, epic, route and design lines

Reference for [`code-triage`](SKILL.md) §6. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

Then, briefly:

- **blocked** — one line each. **Each line says what blocks it, who clears it, and whether
  that person has been asked** (#356):

  ```
  ASKED   #501  unchanged, waiting on <link> since 2026-09-22 (clears: <maintainer>)
  STALL   #502  "design lane, then code" — clears: nobody named — dispatched: no
  BLOCKED #503  needs-decision, ruling exists, unrecorded (<link>) — clears: whoever takes it, via record: colab decision 503 --record --ruled-by <maintainer> … — dispatched: this line
  BLOCKED #508  needs-decision, finding: ask in neither shape — filer adds a Mockup: line or an options block — clears: <filer>, then <maintainer> — dispatched: this line
  STALL   #504  hold needs-rescope — no Hold: line (no owner, no wake) — clears: nobody named — dispatched: no
  FIXED   #510  hold needs-rescope — Hold: line transcribed (owner: @maintainer, wake: review-by:2026-10-05, reason from #510 body) — clears: @maintainer — dispatched: Hold: line, this pass
  HELD    #505  hold needs-rescope — clears: @maintainer — wake: review-by:2026-10-01 — dispatched: Hold: line, 2026-09-24
  HELD    #506  hold hold:manual — clears: @maintainer — wake: ruling, "grant the deploy key for staging" — dispatched: Hold: line, 2026-09-23
  WAKE    #507  deferred:date — wake met, lift? review-by:2026-09-20 (reached) — clears: @maintainer — dispatched: Hold: line, 2026-09-01
  WAKE    #508  deferred:external-party — wake met, lift? issueClosed:owner/repo#12 (closed 2026-09-25) — clears: @maintainer — dispatched: no
  STALL   #509  hold hold:manual — wake: issueClosed:owner/repo#999 does not resolve — clears: @maintainer — dispatched: no
  ```

  - **Holds** (§2, *Held*) print as `HELD`, as `WAKE` when every condition on the newest
    `Hold:` line's `wake:` is measured met, or as `STALL` when that line names no owner, no
    wake, a wake outside the vocabulary, or a reference that does not resolve. A legacy
    hold whose `Hold:` line this pass transcribed from its recorded reason and
    `review-by:` date prints as `FIXED`, with the `STALL` lines. A `wake:
    ruling` line quotes its `Because:` ask. A `WAKE` line says *wake met, lift?* and names
    the evidence, so the owner can lift it without re-measuring; list it right after the
    `STALL` lines, because it is the other kind of line that someone can act on today.
    Like `STALL`, `HELD` and `WAKE` change how the line prints, and the issue stays in the
    `blocked` bucket of `$CACHE`.

  - **Dispatched** means someone can see the ask: a comment addressed to the person who
    clears it, a claim, an assignee, or a spawned session. Intending to ask does not
    count.
  - When the blocker is another issue (`blocked by #N`), whoever clears it is whoever holds
    #N. If #N is on this report's ready list, its `start:` line is the dispatch.
  - **No named clearer, or a clearer nobody has asked, is a stall.** Print the line as
    `STALL` and list it first among the blocked lines. "X, then code" with nothing sent to
    X is a stall, measured: it read as a wait for about a day, and in that time nobody
    was assigned to X.
  - `STALL` changes how the line prints, not where the issue is filed. It stays in the
    `blocked` bucket of `$CACHE`, so there is no new bucket and no version bump.
  - Triage does not dispatch anything itself, because none of §0.2's writes is a
    dispatch. Naming the stall is what shows the gap to a reader who can dispatch.
  - **An open human ask is said once (#489, `CONVENTIONS.md`
    [§5](../../CONVENTIONS.md#an-ask-is-said-once--a-later-pass-reports-that-it-is-still-waiting-489),
    *An ask is said once*).** Before printing a line that puts a question to a human
    (a pending `needs-decision`, a `wake: ruling` hold, *wake met, lift?*, *ruling exists,
    record it?*, *ask in neither shape*), check whether that ask is already open. It is open
    when the tracker carries it: a pending `needs-decision` whose ask has a shape (options
    block or `Mockup:` line), or a `Hold:` line with `wake: ruling`. It is also open when
    `$CACHE.asks` (§0.1) holds an entry with the same `digest`. **Open ⇒ print exactly one
    line and never the options:**

    ```
    ASKED   #501  unchanged, waiting on <link> since 2026-09-22 (clears: <maintainer>)
    ```

    `<link>` and the date come from the tracker (the newest ask: the options-block comment,
    or the `needs-decision` `labeled` event) or from the stored entry. The date is never
    today's date. An `ASKED` line meets #356's two questions: the clearer is named, and the
    link is the dispatch. It prints in the `blocked` list after `STALL` and `WAKE`, and
    in the `DRY` block in the same reduced form. **Not open ⇒ render it once as the
    five-line card** and store its `asks` entry with today as `since`:

    ```
    WAKE    #507  Lift deferred:external-party? Its wake issueClosed:owner/repo#12 closed 2026-10-03.
            options: A: lift it, #507 becomes startable | B: keep it held, re-date the wake
            recommend: A — the wake is the only thing the hold waited for
            if unanswered: #507 stays held; every later pass prints one ASKED line
            answer at: <issue url>
    ```

    Question first, two or more options, the recommendation on its own line, what stays
    parked if nobody answers, then the link. The card's first line keeps the tag the line
    would have carried (`WAKE`, `BLOCKED`, `HELD`), so the ordering rules above still
    apply to it. The card is console output, like the rest of
    §6. It is not a tracker write, and §0.2's list stays at nine. Store the `ASKED` form
    in `conclusion.blocked`, never the card, so §0's re-print cannot show the card again.
    A tracker ask newer than the stored `digest` (a re-posted options block, a `--reopen`)
    is a new ask: it gets one line with its new date, because the tracker already shows
    the question. A session-only ask whose question text changed is new too, and gets the
    card once. **A repo with no open human ask prints nothing new.** Its lines are exactly
    the ones above.

    **Fixture — the same unanswered ask, two passes.** Issue #507 carries
    `deferred:external-party` with `Hold: … wake: issueClosed:owner/repo#12`. That issue
    closed on 2026-10-03. `$CACHE.asks` is empty.

    | pass | `$CACHE.asks` before | printed for #507 | `$CACHE.asks` after |
    |---|---|---|---|
    | 1, 2026-10-03 | `[]` | the five-line `WAKE` card above | `[{issue: 507, kind: wake-met-lift, ref: <issue url>, since: 2026-10-03, digest: d1}]` |
    | 2, 2026-10-05, no answer | the entry above | `ASKED   #507  unchanged, waiting on <issue url> since 2026-10-03 (clears: @maintainer)` | unchanged |
    | 3, after the hold is lifted | the entry above | nothing: #507 is ready, so it moves to the ready list | `[]`, entry dropped |

    Pass 2 moved none of the five inputs, so it is a §0 short-circuit. The re-print shows
    the stored `ASKED` line. Pass 3 moved input 2 (the label was removed), so it is a full
    pass. A pending `needs-decision` with an options block skips row 1: the tracker already
    shows the question, so even the first pass prints the `ASKED` line.
- **taken** — who holds it, and since when. A claim flagged *parked, wake met* or *parked,
  wake unresolvable* (§2's `deferred:*` exception) gets its own line inside this bucket, not
  the ready list — name the `deferred:<kind>`, the `wake:` condition, and the evidence that
  it came true (or the reference that did not resolve), so a human can check whether the
  gate actually cleared instead of finding this by manual audit.
- **close these** — already shipped, with the evidence you found.
- **epics** — one line each, naming the container and (if its table is hand-maintained)
  whether it looks current. Never a start candidate; see §2. Where §2's switch read ran,
  add the epic's switch state on a second line:
  `switch: bulk-import — unfinished since 2026-08-02 (add #43 merged; remove #47 open)`,
  or `declared, not landed`, `finished`, `undeclared — should it have one?`, or
  `not cleared: <defect>`.
  An epic carrying `needs-decision` or a `decision:options` block (§2) gets a finding line
  under it that names where the question moves:
  `finding: needs-decision on an epic gates nothing — move the question to its own issue with needs-decision, attached as a sub-issue (#361)`.
  The two #371 findings from §2 go under their epic the same way: a `delivery:*` label on
  the container, and an open epic whose native sub-issues are all closed.
- **route** — one line each, naming the delivery type (`content` / `ops` / `elsewhere`)
  and where it actually needs to go. Never a start candidate for the code pipeline; see §2.
- **design** — one line each per `delivery:design` issue, with its claim state and the
  build issues its `blocked_by` edges hold back, and its readiness verdict from this pass
  (#380):
  `DESIGN #87  unclaimed, free (deps-checked) — holds #88, #89`, or
  `DESIGN #90  unclaimed, blocked by #86 — holds #91`. A design session's start, never a
  code start candidate; see §2.
