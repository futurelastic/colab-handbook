# `integration`, `releaseBranch` and `owner`: why

Moved from [`project.schema.md`, *`integration`*](../../project.schema.md#integration--optional) and [*`releaseBranch`*](../../project.schema.md#releasebranch--optional) and [*`owner`*](../../project.schema.md#owner--optional) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why `integration` is not `trunk`

**Why this is not `trunk`.** The tempting alternative is to let a repo declare its
long-lived line as trunk and be done. That does not stay on the development side of the
fence: on Tiers A and C, `trunk` **is** the production spine — it is the branch `colab
promote` merges into the release branch. Naming the line as trunk points the promotion path
straight at it, which is the opposite of the intent.

## Why CI on an integration line is advisory

Merges into it really do run zero CI, which is worth saying — but a line that is not yet
gated is a normal early state, and failing the repo for it would push teams back to
declaring the line nowhere, which is the state this field exists to end.

## Why `releaseBranch` exists

**Why it exists:** between releases, this branch is by construction an ancestor of
trunk — it was fast-forwarded to trunk's tip as of the last tag, and trunk has since
moved on. That is indistinguishable, by ancestry alone, from a spent session branch
whose work already landed — which is exactly what `colab doctor`'s routine-maintenance
list hunts for. Undeclared, `doctor` prints a ready-to-paste `git push origin --delete`
for a ref a live deploy pipeline is polling; declaring it here is what lets `doctor`
tell the two apart (issue #63).

## Why `owner`, not `upstream`

**Why `owner`, not `upstream`:** "upstream" already means something else twice — a
consumer filing a changed convention meaning back to the handbook
([CONVENTIONS.md §8, *Upstream*](../../CONVENTIONS.md#upstream--a-consumer-that-changes-what-a-convention-means-files-it-here-362)), and git's tracking ref. A third
meaning of the same word would be misread.
