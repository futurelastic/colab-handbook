# Scope, epics and switched epics: why, with the measurements

Moved verbatim from [`CONVENTIONS.md` §5, *Scope*](../../CONVENTIONS.md#scope--diagnosing-across-repos-is-not-license-to-act-in-them), [`CONVENTIONS.md` §5, *Epics*](../../CONVENTIONS.md#epics--a-container-is-not-a-start-candidate) and [`CONVENTIONS.md` §5, *Switched epics*](../../CONVENTIONS.md#switched-epics--concurrent-unfinished-features-336) by #523. The rule
stays there; this file holds its rationale. Headings below are added for navigation only.

## Scope

Measured: a session traced a downstream issue to an existing branch in an upstream tool
repo, then rebased and force-pushed it with no claim and no go-ahead scoped to that repo
— caught and reverted before merging.

## Epics: one claim, six readiness states

You
cannot claim half an issue: a checklist issue shipped three-of-six by one session and
left three behind serializes everything remaining onto one claim regardless of whether
those items are related, similarly sized, or blocked by the same thing. Measured, one
repo's clearest offender: three trivial UI additions, one item blocked behind an
in-flight change, and one needing a design pass, all six behind a single claim. Every
cost traced to the same cause — one claim, six different readiness states: a session
that shipped three wrote a closing reference that later blocked an unrelated,
legitimate ship three days on; and one still-unblocked item was re-measured across
ten-plus triage passes because the issue's own plan text (written for a different
sibling) never actually applied to it.

## Epics: containers closing (#371)

Before
#371 nothing closed the parent, and a backlog review found five open containers whose
children were all closed.

## Epics: containers carry no delivery label

In the same review, one closed-out container still carried
`delivery:code`, so a scheduler could have read it as code work.

## Switched epics: rule 3

With only two configurations, a dependency has exactly one
runtime consequence — B cannot finish while A is still switched — and the edge is
what makes that mechanical instead of remembered.

## Switched epics: markers quoted in code

We measured one closed issue whose body only described the family this way, and every
release-cut candidate in that repo was refused as a malformed marker until someone
reworded the issue.
