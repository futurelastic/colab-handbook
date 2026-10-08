# First-time adoption: why, with the measurements

Moved from [`CONVENTIONS.md` §9, *Any repo, first-time adoption*](../../CONVENTIONS.md#any-repo-first-time-adoption) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why adoption asks only what changes a gate

`room` only tunes how verbose the trail is, `writes` absent already reads as the common
`free`, and `channels` is descriptive (and easy to mis-answer `workflow` on a repo that
merely has CI)

## Why question 1 writes `production` and `deploy`, never `tier`

so asking for the letter directly would be asking for a value that is always derivable from
a more basic answer already on record — the same drift-by-redundancy this whole model exists
to stop

## Why question 3 is phrased as what would break

per the ruling on #128: the person answering is standing in the repo, not reading a schema,
and "what breaks" is the question they can actually answer

## Why derived values are never asked

a checklist that also prompts for a derived value is exactly how the fields drift apart from
each other again (the failure this whole model exists to stop)

## Why both entry states share one question set

Building this once and pointing both moments at it is the point

## Why only `exposure` carries a skip option

(its own fallback, deriving `tier` instead, is a real fallback that consumes the absence;
the other four have none, so declining them would just recreate #282's shape under a
different row)

## Why the descriptor lands on trunk in the same human act (#481)

On a freshly adopted repo, the first branch is the one that *creates* trunk's rules — the
descriptor with the maintainer's grant, and the repo's CI. `colab ship` reads autonomy from
the descriptor **trunk** carries, so that branch is judged by rules trunk does not have yet,
and a human ends up hand-merging it although the grant was already given.

## Why `migrations:` is declared at adoption

Until it is declared, the no-new-migrations gate cannot see those files (#449).

## Why the label count is restated, and what each missing label costs

#274: adding `delivery:elsewhere` left three of the four wrong until found by hand.

What each absence costs, briefly: `in-progress` — the first claim cannot land.
`deps-checked` — a readiness check can never tell *free* from *nobody looked*. `agent-filed`
— every agent-filed issue reports as human-approved. `epic` — an epic passes every readiness
gate and reads as a normal start candidate. `needs-decision` — the blocking-question gate
cannot be applied at all. `decision-recorded` — a recorded answer has no positive marker to
distinguish it from a label nobody ever applied, so the next mechanical pass re-gates
settled work (measured: #127). `needs-plan` — `code-start` always sees "no flag", every
session falls back to rung 1. `migration-granted`/`ci-granted` are **not opt-in** (unlike
`tracking`) — absence fails malignantly, discovered only when a repo hits the wall with no
route past `ship`'s gate at all. `needs-migration-grant` — the plan-time flag a consumer
raises before `ship` would refuse has nowhere to land, so the grant request never surfaces
until the wall (#230). `low-priority` — a triage pass has no way to say "startable, but
ranked last", so a group meant to wait its turn is reported exactly like every other ready
group (#268). `priority:now`/`priority:high` — an owner's "do this first" has nowhere to be
recorded, so it lives in a chat a scheduler cannot read (#537). `delivery:*` — a content
push or ops check has no way to say "not a diff" and jams the code pipeline, and a new
surface's design issue reads as a code start (#359). `deferred:*` — a triage pass has no way
to say "parked, and here is what wakes it", so a deliberate park is indistinguishable from
an unexamined issue — measured at 11 + 4 issues misreporting as untriaged across two repos
(#279).

## Why the handbook pointer is not skipped

it is the only reason a future agent discovers these conventions

## Why the stamp lives in `CLAUDE.md`

The stamp only works there: the audit, `handbook-sync` and `colab update` never follow the
import to find it.

## Why no block lives in both files

A block in both is loaded twice into every session once `CLAUDE.md` imports `AGENTS.md`, and
a generator writing both re-adds the copy after any hand cleanup.

## Why a fork does not take the thin-shell shape

the thin-shell conversion would rewrite a file the upstream keeps editing

## Why a released repo wires the release rung at adoption (#492)

A released repo adopted without them never cuts a candidate until someone notices: measured
on six adopters in one sweep, and more that had the workflow but no first final.
