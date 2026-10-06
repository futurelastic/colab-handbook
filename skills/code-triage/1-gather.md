# code-triage · §1 Gather

Reference for [`code-triage`](SKILL.md) §1. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


```sh
gh issue list --state open --limit 100                    # this repo
gh issue list --state open --label in-progress            # …of which, taken
```

`--state open` is right here — unlike code-start's lookup, which needs `--state all`
because it is answering a different question (does a memory exist?) rather than this
one (what is left to do?).

**`--limit 100` is a cap, so say when you hit it.** A bounded pass that does not report what
it dropped is the failure §0 forbids, arriving one section later: past 100 open issues this
gathers a partial backlog and everything downstream — grouping, ordering, "nothing left to
do" — is silently computed over a subset. §0's `COV` line already carries the authoritative
`totalCount`; compare it to what you actually received and say so out loud:

```sh
gh issue list --state open --limit 100 --json number -q 'length'   # vs COV's totalCount
```

Equal ⇒ full coverage. Fewer ⇒ raise the limit or paginate, and until you do, state the
coverage in the report — a triage over 100 of 140 issues is a useful answer, but only if it
admits which question it answered.

**Scope: this repo. Not the fleet.** Every `code-*` skill is one repo — that is the
family's whole shape, and a single skill quietly going wide is the kind of
inconsistency people discover by surprise.

Want the machine-wide picture instead? Two tools already give it, mechanically and
in more useful form than prose triage could:

```sh
node "$COLAB_HANDBOOK/audit/audit.mjs"   # conformance across every registered repo
colab update                             # which repos have drifted from the handbook
colab claims                             # what is held, everywhere, and by whom
```

All three read the **machine-local** registry, so "fleet" means every repo on *this*
machine — never every repo that exists. That distinction matters once a second
machine has its own registry.
