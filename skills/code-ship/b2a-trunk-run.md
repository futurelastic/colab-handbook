# code-ship · B2a Read the trunk run at your squash (#374)

Reference for [`code-ship`](SKILL.md) B2a. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B2a. Branch CI could not arrive? Read the trunk run at your squash before any evidence (#374)

B1a let this merge through on a `none` that **cannot arrive** — the repo's workflows fire
only on a trunk push and `pull_request`, so no run could ever exist at the branch's head —
with the words "the base's own CI is the whole CI story". That story is told **after** the
merge: the trunk run at the squash sha B2 just pushed is the change's **first** run on the
runner. Nothing before this section read it.

Why: [ADR 536](../../docs/adr/536-code-ship-b2a-trunk-run-rationale.md).

**So when B1a read the cannot-arrive `none`, watch the trunk run at the squash sha before
B2b posts anything.** When B1a read `green` the branch's own run already judged the change —
skip this section. This adds no gate before the merge — the merge has already happened. It
closes the loop B1a opened.

```sh
SQUASH=<the squash sha B2 pushed>   # from B2's commit or `colab ship`'s output — not
                                    # origin/<base>'s tip, another ship may land on top
colab ci-wait --sha "$SQUASH" --timeout 15m   # every workflow at that sha, one 15-min
                                              # cap across all of them; exit codes as B1a
```

- **Same bound as B1a — 15 minutes, a cap across every run at the sha, not 15 per run**
  (*The wait is bounded*, #370). Under `code-sweep` this is not an extra wait: the next
  candidate's B1 needs this same run green at the new trunk head before it can merge.
- **Same quantifier as B1:** the squash is `green` only when **every** run at `$SQUASH` has
  completed and none failed. A fast workflow already green does not answer for a slow one.
- **No run listed yet?** A push takes a few seconds to register — look again for up to a
  minute. If the workflows do trigger on a push to `<base>` and still nothing appears, trunk
  CI is dead, which is B1's *a failure that never started still means stop*. It stops the
  **next** ship, not this one. Say so in the evidence. A repo with no workflows at all, or
  with `pull_request` only, never produces a run here: say that instead and go to B2b.

Classify what you see with B1a's test (*Telling infra from finding*):

| trunk run at `$SQUASH` | what this skill does |
|---|---|
| `green` | **B2b as usual, citing that run** — its id beside the squash sha in each evidence comment. The claim "CI passed" now names the run that passed |
| `red:finding` | **File `TRUNK RED: <sha> (#N) fails <what>` in the same pass**, before any evidence comment. Put in it the failing test names, the run link, the squash sha and every issue the squash carried. Then post B2b's evidence with the red noted and that issue linked. **The grade stays the grade** — B1c judged the diff against the plan, not trunk's CI, so `verdict=pass` is still true and is still emitted. Do not revert and do not push a fix from here: the `TRUNK RED:` issue is the patch's work, and the next ship's B1 (*Red trunk*) orders it first |
| `red:infra` | **Re-run once** (`gh run rerun <databaseId> --failed`, §4) and read it again inside the same 15-minute bound. The same failure twice ⇒ the runner, not the change: hand it to the ops lane and say in the evidence that trunk CI for `$SQUASH` is unverified, for that reason |
| cap expired | **Say so in the evidence** — "trunk run `<databaseId>` for `<sha>` still running at `<ts>`" — and leave the re-measure trigger: that run completing. The next ship pass or `code-sweep` ping reads it by id. A red there is filed as `TRUNK RED:` exactly as above, by whichever session finds it |

So no
evidence comment for a cannot-arrive merge goes out ahead of this read. An evidence
comment that says `pass` beside a red trunk it never looked at tells every later reader
that trunk was fine.

Why: [ADR 536](../../docs/adr/536-code-ship-b2a-trunk-run-rationale.md).
