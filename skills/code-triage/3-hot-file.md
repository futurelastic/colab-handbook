# code-triage · §3 Count the hot files — one path, many waiting issues

Reference for [`code-triage`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands and edge cases (#540).

§5's file gate keeps an issue off READY while a live branch writes a path it will edit, and
§3 records that collision on the issue's `Touches:` line. Each of those is correct for one
issue. Neither notices when the **same path** is what holds many of them: the queue then
drains one issue at a time through that file, and every new issue touching it joins the
line. The usual cause is structural — a ledger every change appends to, a size-budget file,
a page component or stylesheet grown to thousands of lines — and no single issue owns the
fix. So triage counts, and files the structure problem once (§0.2, write 9).

## The measurement

Run after §3's `Touches:` step and §5's file gate, from facts this pass already holds:

- For each path `P`, count the open, unclaimed, non-epic issues that §5's file gate kept off
  READY on `P` — `P` is on their `Touches:` line, or §3 measured the collision this pass.
  A path a group's own members share is one waiting unit per group, not one per member.
- **Count ≥ 3** ⇒ `P` is hot. Fewer ⇒ nothing, and nothing printed.
- Count only what this pass measured. A guess from issue titles, or an `unknown` row from
  `colab holders`, is not a waiting issue.

## Read before filing — keyed by path

```sh
gh issue list --state all --search "in:title \"HOT FILE: <P>\"" --json number,state,stateReason
gh issue list --state open --search "<P> in:body" --json number,title    # an issue already restructuring P?
```

- **An open `HOT FILE:` hit** ⇒ write nothing. Name it on the findings line.
- **A hit closed as `not planned`** ⇒ never re-file. A human ruled that the path stays as it
  is; the queue on it is the accepted cost.
- **A hit closed as `completed`** ⇒ the structure fix landed and the path is hot again. This
  is a new episode: file only when the count is measured at a trunk sha newer than that
  close, and cite the old issue in the new body.
- **An open issue whose own ask is to split or restructure `P`** already is the structure
  issue — file nothing. When that issue is itself one of the waiting issues, held by the
  very path it would fix, print a **self-deadlock** finding to the console:
  `FINDING self-deadlock: #N restructures <P> but waits on <P> (held by <branch>)`. That is
  the case a human has to break — usually by landing the holder first, or by giving the
  restructure precedence on the path. Triage changes no edge and no label for it.

## The issue

```
Title:  HOT FILE: <P> — <N> issues wait on it
Labels: agent-filed
Body:
  Problem — <P> (<lines> lines at trunk <sha>) holds <N> waiting issues: #a, #b, #c.
            Live holder branch(es): <branch>, …
  Evidence — the commands this pass ran, and their output.
  Goal — the waiting issues stop serializing on one path. The shape (split, generate,
         per-entry files, …) is the repo's to choose; this issue does not prescribe one.
  Touches: `<P>`
  Filed-by: agent (code-triage pass at trunk <sha>)
  Ask: backlog
```

- **`agent-filed`, always.** Triage noticed the problem; nobody has accepted a fix. The label
  keeps it out of batch starts until a human or coordinator accepts it (`CONVENTIONS.md`
  §5, *Provenance*).
- **No `blocked_by` edge, in either direction.** File contention is never an edge (§4,
  *Then write the dependencies down*), and the waiting issues do not need the structure
  fix's output — they need the path to be free, which the file gate already measures.
- **No `priority:*` label.** §4 may *propose* `priority:high` on the group's `why:` line
  (leverage: a hot-file split); proposing is not applying.
- **One filing per path.** The filing moves §0 input 2 once, so the next ping takes one
  full pass; on the pass after that the open hit above makes it a no-op. A pass that files
  a second `HOT FILE:` for the same path broke this file's read-before-filing rule.

## What it is not

- Not a diagnosis. The body records a count and the holders — a measurement, the same
  bound write 8 carries. Which shape fixes the path is the implementer's call.
- Not a hold. The waiting issues keep their own verdicts; a hot path changes nothing about
  whether any of them is ready.
- Not a reason to start the structure issue ahead of a human: it ranks first within its
  band once accepted (§4, rank 1), and it starts through the ordinary gates like anything
  else.
