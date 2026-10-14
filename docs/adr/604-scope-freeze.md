# Scope is how code lands on git: what is frozen, and what stays

The notice heads [`CONVENTIONS.md` §5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this);
this file holds the full list and the reasoning (#604).

## The ruling

The maintainer ruled on 2026-10-14: **the handbook's scope is how code lands on git.** The surface
that decides *who holds an issue, what was decided, what may start, and who may do an act* is frozen
from that date. It will move to a separate decision, work and gate layer that adopters run.

This narrows one point of #518's 2026-10-06 relationship: the hard set's "a claim before work" and
its human-flag gates will eventually be enforced by that layer, not by `colab`.

## Frozen — no new features

- **CONVENTIONS §5:** claims recorded on the issue (claim comments, the claim label), readiness
  (`deps-checked`, the meaning of `blocked_by`, `needs-plan`), "who decided it should exist" (the
  `Filed-by` accept rules), and how a decision is recorded (decision records, `colab decision`).
- **Every `COLAB_HUMAN=1` gate except `solo`:** CI grant, migration grant, release finalize and
  promotion authority, exposure lowering at adopt, policy writes through `colab config`.
- **The matching commands:** `claim` (beyond the git claim ref), `close`, `readiness`, `blocked`,
  `decision`, `issue-filed`, `ci-grant`, `migration-grant`, and `config` for policy.

**Bug fixes in frozen areas are still allowed.** A fix keeps what exists working. It never widens
the surface. A new feature in a frozen area is refused, with a pointer to #604.

## In scope, unchanged

Tiers, room, exposure, recovery, writes and channels · `project.yml` · branches, commits, branch CI,
batch landing, "has it landed" · worktrees, ports and place-claims · **the git claim ref**
(`refs/claims/*`, which stays as the git-level fence) · ship and landing mechanics · release
mechanics (cut, channels, notes, distribution) · CI templates, toolchain and runners · conformance
and sync · adoption · `solo`.

Where a frozen gate needs a fact (touches migrations, trunk red, docs-only, exposure lowered),
`colab` keeps **detecting and reporting** that fact. Only the decision moves out.

## Retirement

Nothing frozen is removed until its replacement has run in production for 7 days. Retiring each
frozen area is a separate issue, filed when its replacement is ready — not before. The freeze
changes no rule's meaning: until a retirement lands, every frozen rule still applies as written.
