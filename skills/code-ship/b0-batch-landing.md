# code-ship · B0 Batch landing (#373)

Reference for [`code-ship`](SKILL.md) B0. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### Batch landing — several ready candidates, one combined run (#373)

**Only where `.github/project.yml` declares `ship-batch: <N>` greater than 1.** Absent or 1,
skip this subsection: every candidate ships alone, as below. With it, two or more candidates
that are each **ready** — `green` at their own head (B1a's class, or the `none` that cannot
arrive), merge-clean against trunk — land through one command instead of one ship each
(`CONVENTIONS.md`
[§4, *Batch landing*](../../CONVENTIONS.md#batch-landing--one-combined-run-then-a-fast-forward-373)):

1. Run §0 through B1c **per member** as usual — hand-off contract, the already-shipped grep,
   `landed`, B1b's harvest, B1c's grade. **Grading stays per member**; a batch never grades
   a diff it did not read. A member that fails any of it leaves the batch.
2. **Do not run B0's sync or B1a's post-sync re-run per member.** Instead:
   ```sh
   colab ship --batch <b1>,<b2>[,<b3>] --repo <repo>
   ```
   It re-reads each member's own ship gates, builds trunk + one squash commit per member on
   `ship-batch/<trunk-sha7>`, and pushes it. That ref's **one combined run replaces every
   member's post-sync re-run** (B1a, below). A member whose overlap with those already in is
   confined to `generated:` paths is **not** dropped: the build runs `.colab/hooks/pre-ship` on
   the combined head, B0's rule, and prints a `↻ <member>: … regenerated` line naming the
   files (#387). Only an overlap outside `generated:` — or no hook to regenerate with, or a hook
   that exits 0 but leaves conflict markers staged (#436) — drops a member to the next batch
   (`✗ <member>: …`). Re-running on a staged batch lands **only the members it carries**; a branch
   you name that it does not carry is printed as `NOT in the staged batch` — ship it afterwards,
   it was not forgotten silently (#415). `--dry` is a read on every path, including a staged green
   batch: it prints what would land and writes nothing.
3. Read the exit code — it never waits for you:
   - **`3` — paused.** The combined run (or trunk's own) is still going, or the batch was just
     (re)built. Wait on the run id it printed with B1a's bound — `colab ci-wait <id>
     --timeout 15m` (#495) — then run **the same command** again. The cap expiring is a defer
     exactly as B1a records one; the batch ref stays for the next pass.
   - **`0` — landed.** Trunk fast-forwarded to the tested head; each member's claim, worktree,
     branch and 🚢 comment are handled as a serial ship handles them. Go to B2b for the
     per-issue evidence (the 🚢 line already names the combined run).
   - **`4` — declined; nothing landed.** The last line is `→ SERIAL: colab ship --branch …` —
     ship those members one at a time from B0. If the reason was a **red combined run**, first
     classify it like any branch red (B1a, *Telling infra from finding*): `red:infra` → run the
     printed `gh run rerun <id> --failed` once, wait, and re-run the batch command; `red:finding`
     → go serial, and the member that goes red on its own sync run returns to its implementer
     as a class.
4. A red trunk declines a batch outright: the cure and ci-grant doors (B1, *Red trunk*) apply to
   one member at a time, never to a batch.
