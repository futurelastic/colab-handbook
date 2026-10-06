# code-triage · §3 Record a measured collision on `Touches:`

Reference for [`code-triage`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


A scheduler that brakes on files decides from the **issue text**: it starts an issue only
when no live branch writes a file the issue names. By convention the issue names them on a
`Touches:` line in its body. Triage's report is console output, so a collision this pass
measures and only *prints* is invisible to that brake. Measured on an adopting repo: triage
found an issue's files held by a live branch twice, and wrote it as prose both times. The
brake could not see it, so a code session started on the issue and refused on the
collision. The refusal counted as a strike and blocked the issue, and the block outlived
the collision.

So when this pass **measures** that a file an issue will edit is written by a live branch
that is not the issue's own, append those paths to the issue's `Touches:` line in the same
step that reports the collision (§0.2, write 7):

- **Measured means a path you can name from git.** It comes from `git diff --name-only
  origin/<trunk>...<branch>` against a live branch, or a `cargo` row from `colab holders`
  (§3's second net). An `unknown` row, or a guess from the issue's title, is not
  measured, so nothing is appended.
- **Append, never rewrite.** Add each measured path as a code span to the existing
  `Touches:` line. If the body has no such line, add one at its end. Never remove a path:
  once the branch lands the brake reads the file as free again, and the file list is
  still true of the issue.
- **The report still says it.** The console line names the branch and the paths as
  before, plus the fact that they went onto `Touches:`.
- **It is not a group.** An issue colliding with a branch for unrelated work is still one
  unit of work. A real collision between two open issues is §3's group, recorded with the
  `group:` label; this line only makes the file brake see what triage saw.
