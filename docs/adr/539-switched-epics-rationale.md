# Switched epics: why, with the reasons

Moved from [`CONVENTIONS.md` §5, *Switched epics — concurrent unfinished features (#336)*](../../CONVENTIONS.md#switched-epics--concurrent-unfinished-features-336) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why `none`, `self` and `live` are not bound

On `none` and `self` nothing consumes a half-finished epic, so a switch there is pure cost and this subsection does not apply;

## Why `exposure: live` is not bound

`exposure: live` is not
bound: its promotion is a human act that can simply wait for an epic to finish.

## Why a switch hides behaviour only

...serialize through *Grouping*, above; a switch hides behaviour, never a
merge conflict.

## Why the cap and the age

Both are **findings for a human**, never blockers: the cap
exists because every open switch doubles what the development configuration hides
from the release one, and the age exists because a switch nobody removes has become
a permanent fork in the code under a temporary name.

## Why a version never goes in a branch name

Never put a version in a branch name: a branch named `0.2.0-dev`
is itself a SemVer pre-release, and sorts **below** `0.2.0`. A `release/X.Y` branch is
neither an [`integration:`](../../project.schema.md#integration--optional) line (that axis
never reaches a tag, by construction) nor a
[`releaseBranch:`](../../project.schema.md#releasebranch--optional) (that one is overwritten
wholesale on every release)...

## Why `name` is the literal identifier

...so `git grep <name>` finds every read site. That is what makes rule 1's
"removed" checkable: after the removal child, the grep returns nothing.
