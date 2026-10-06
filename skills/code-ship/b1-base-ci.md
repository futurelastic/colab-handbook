# code-ship · B1 Verify CI on `<base>`

Reference for [`code-ship`](SKILL.md) B1. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B1. Verify CI on `<base>` is alive AND green — for the sha you are about to merge

**Ask by commit, not by recency** (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits), #92). `gh run list --branch
<base> -L 1` reads whatever ran *last*, and under `cancel-in-progress` a cancelled
straggler can outrank a passing run on the *same* commit — deadlocking a ship that a
by-commit check would clear. Ask instead about `<base>`'s current head sha — and ask it
the way `colab ship` does, since that is the verdict the merge actually gates on:

```sh
colab trunk-ci                       # <base> is trunk: GREEN | RED | PENDING | WEDGED | NONE | UNREADABLE
colab ship --dry --json              # any <base>: the `trunk CI green` / `line CI green` row
```

`GREEN` means every workflow's newest run at that exact sha succeeded — not merely one
of them (#461, #463). Never hand-roll a `gh run list` filter that counts *a* successful
run: at one measured trunk sha `CI` succeeded and a release workflow failed, ship read
it red, and a one-success filter read it green.

A "failure" that never started (billing lockout, runner outage) still means
**stop** — we once merged for 12 hours into repos whose CI was silently dead
(`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)). Branch protection can't check this for us; this command must.

**What CI *is* follows whether the unit has a branch, how much it must catch follows
`exposure`** ([§7, *CI*](../../CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)
— ⚖ #233 retired the `writes`-keyed reading this used to carry). With a branch — the
ordinary case, or an attended trunk-direct session falling back to full ceremony under
one of [§2](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)'s
two mandatory-branch conditions — CI here **is** the gate this merge depends on — a red
or missing run for the head sha stops the ship, full stop. `none`/`self` exposure
answers only to the room; `live`/`released` answers to a consumer with no way to ask a
clarifying question, so more has to be caught before it reaches them.

If `<base>` is a declared line with **no runs at all**, it is not yet CI-gated: check
`<trunk>` instead and say so in the report. That is a normal early state for a line,
not a green light — a line that *has* runs and is red still stops the ship.
