# Delivery type and priority: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Delivery type*](../../CONVENTIONS.md#delivery-type--route-not-start-112) and [`CONVENTIONS.md` §5, *Priority*](../../CONVENTIONS.md#priority--a-throttle-not-a-veto-268) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## delivery:docs-only (#358)

It was provisioned in #112 as a
non-code value ("a docs sync outside code review"), but a docs-only deliverable in the repo
the issue lives in is still a commit, and a consumer's scheduler already read it that way;
so triage withheld `deps-checked` from issues the scheduler would have started, and they sat
with no park and no decision to say why — one measured case for 6 days.

## delivery:design (#359)

Two consumers hand-created the label before the handbook provisioned it, and a
third, having no such value, filed design work under `delivery:docs-only`, where its
scheduler started a code worker that refused the issue 5 times. Before #359
`deliveryType()` returned `null` for it — the "not asked" case, the #274 failure below for
a sixth value.

## delivery:elsewhere (#274)

Before #274, an issue explicitly
labelled `delivery:elsewhere` was byte-identical, to this repo's own classifier, to one
nobody had ever labelled: `deliveryType()` returned `null` for it (the "not asked" case),
so `isRouteNotStart()` read `false` and the issue reported startable — the opposite of what
applying the label was asking for.

## Priority (#268)

Reading the label as a
hard veto turns "later" into "never" for work someone filed believing they were only
setting its place in line — the opposite of what filing it as low priority, rather than
not filing it at all, was meant to say.

A driver meeting all three is honouring the
throttle, not overriding it — it has scoped "who may start this without asking" more
narrowly than "who may start it at all", which is a different question than eligibility.
