# Delivery type and priority: why, with the reasons

Moved from [`CONVENTIONS.md` §5, *Delivery type* and *Priority*](../../CONVENTIONS.md#delivery-type--route-not-start-112) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why "not asked" is not "non-code"

**"Not asked" must never collapse into "non-code"** — every issue is unlabelled the day
this set is adopted, and reading absence as non-code would freeze every scheduled driver on
day one.

## Why `delivery:*` is provisioned

`delivery:*` is in the provisioned label set because every adopting repo needs all six
values before the first triage pass can classify anything.

## Why `docs-only` is not a home for design work

Nor is it a home for design work — a design artifact with screenshots is a binary
change, and design work has its own value.

## Why `delivery:elsewhere` routes

**`delivery:elsewhere` (#274)** names an issue whose deliverable IS code, but code that
lands in a different repository than the one the issue lives in — a consumer that read a
tracker across several repositories provisioned it by hand on three separate trackers,
21 issues total, well before this convention adopted it. It routes for the same reason
`content`/`ops` do: this pipeline's worktree, gate, mergeable and squash machinery all
assume the diff lands in the repo the issue lives in, and an `elsewhere` issue breaks
that assumption identically to a content push.

## Why `low-priority` is provisioned

`low-priority` is in the provisioned label set for the same reason `epic`
and `delivery:*` are: an unattended driver's ordering decision depends on being able to
see it, and a repo that adopted before it existed cannot create it at all.
