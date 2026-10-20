# `colab adopt` and `colab deliver` — the human-gated adoption mechanics

Moved verbatim by #640 from the adoption procedure (formerly [`CONVENTIONS.md` §9](../../CONVENTIONS.md#9-adopting-this);
now [`skills/handbook-sync/2-adoption-procedure.md`](../../skills/handbook-sync/2-adoption-procedure.md)), only links
retargeted. These paragraphs carry the commands a person runs with the human flag, and the gates that
refuse everyone else. No skill may hold a command that sets that flag (the human-only property, #237), so
they live with the tool: the procedure keeps the step and points here. The rule they serve is the
[adoption contract](../../CONVENTIONS.md#9-adopting-this), items 4, 5 and 8.

## First-time adoption — the human step

**[Hard — gate: adopt human gate]** **The human step comes first, not last (#522).** Answering question 3 with `none` or
`self` is a human's act (below). An agent driving an adoption should know that before it
starts, not learn it from the final refusal: when `colab adopt` cannot finish without a
human, the **first** line it prints is the one command the human runs, the answers this
run already had filled in (`COLAB_HUMAN=1 colab adopt --production none --deploy none
--exposure none … --answered-by "<name>"`). At a terminal, the exposure answer is checked
against the repo's shape the moment it is given and re-asked with the reason, rather than
refused after every other question.

## First-time adoption — what `colab adopt` does, and landing the descriptor

**[Hard — gate: adopt human gate]** **The exposure asymmetry survives here too.** An agent walking through this checklist
may *propose* `live` or `released` when it finds committed evidence for one (a non-null
`production:`, a committed deploy path) — never `none` or `self`. Omission reports as
`null` (undeclared, and legal); only a human answer may write down that nothing, or only
the room, consumes a merge here.

**[Hard — gate: adopt human gate]** **`colab adopt` executes this checklist.** It
detects what a repo already states, asks a human only what could not be detected
(flags, or an interactive prompt at a terminal), derives the rest, and writes
`.github/project.yml` in one act — the same shape `colab template` already uses for
copy-and-stamp. A row already answered is skipped; `--axis <row>` forces a re-ask on
purpose (the "going live" ladder below asks for exactly that). Lowering an existing
`exposure` — or a first declaration of `none`/`self` — requires a human: an interactive
terminal, or `COLAB_HUMAN=1` together with `--answered-by <name>` (the same bar `colab
ship`'s gates use, and no stronger — see the command's `--help` for the honest limit).
Raising, or a first declaration of `live`/`released`, needs nothing beyond the
falsifier/shape clearance described above — an agent may run this unattended for
exactly the direction CONVENTIONS.md [§2](../../CONVENTIONS.md#exposure--what-consumes-a-merge-here)'s
asymmetry already allows it to propose. `colab adopt` never runs steps 3 onward below;
it prints them as a to-do list on exit. **The five questions above are asked as forced
numbered menus (#283)**, not free text — every option is answerable by its number or
its literal value — and `exposure` is the only one of the five that carries a skip
option.

**Land the descriptor on trunk in the same human act (#481).** The maintainer's
adoption command is the human step, so it can land its own output:
```sh
COLAB_HUMAN=1 colab adopt --exposure self --autonomy auto-trunk \
  --answered-by "<name>" --land          # run on the checkout standing on trunk
```
**[Hard — gate: adopt autonomy/land gates]** `--autonomy auto-trunk` records the grant with the same provenance comment as every
answer, behind the same bar as `writes: direct` (it expands what an agent may do);
`manual` is never gated, and `ceremony: light` refuses it. `--land` commits exactly
what this run wrote — the descriptor, plus the thin-shell `CLAUDE.md`/`AGENTS.md` when
written now — to trunk as its own commit and pushes it. It requires `COLAB_HUMAN=1`
**and** `--answered-by`, with no terminal substitute, since it writes trunk; it refuses
off trunk, with `--local`, and when origin's trunk is ahead. Everything else in the
adoption — CI workflow, guards, docs — then ships through the normal lane under the
grant. Trunk's tree has no workflow file at that point, so its `none` cannot hide a red
([§4](../../CONVENTIONS.md#4-branches-and-commits), #482): the follow-up branch that adds CI passes `trunk CI
green` on its **own** green run, with no human step, and the CI it adds grades every
branch after it. `ci-granted` stays the door only for a trunk that already has workflows
and still has no run at its sha.

## A repo you don't own — the integration branch and `colab deliver`

**[Hard — gate: adopt human gate]** **The pattern: `trunk:` names the fleet's own
integration branch** (e.g. `<prefix>/integration`), never the owner's default branch.
Claims, worktrees, grading and `colab ship` then work unchanged. Sessions branch off the
integration branch, `ship` merges into it, and the owner's trunk is reached only by a pull
request he reviews and merges himself — `colab deliver`, below. Declare **`exposure:
self`**: a merge onto the integration branch reaches only the fleet, and the owner's
review is the next gate. `self` is human-gated ([§2](../../CONVENTIONS.md#2-tiers)), as always.

**[Hard — gate: adopt human gate]** **One command does it** (a human answers the exposure row, at a terminal or with
`COLAB_HUMAN=1 --answered-by <name>`):

```sh
git push origin <owner-trunk>:refs/heads/<prefix>/integration   # once, if it doesn't exist yet
colab adopt --local --trunk <prefix>/integration --production none --deploy none \
  --exposure self --stack "<text>"
```

**[Hard — gate: adopt --local refuses]** It refuses when the descriptor is **tracked** (the repo is adopted, so use plain `adopt`),
when `--trunk` is missing, and when `--trunk` names the owner's own trunk. It appends the
exclude lines *before* writing anything, writes the descriptor into the main checkout
(where every worktree's `colab` reads it — a linked worktree never carries the file),
writes a stub `CLAUDE.local.md`, ensures the four labels, moves the main checkout onto the
integration branch when the tree is clean, and checks that `git status` shows none of it.
It then prints what it deliberately did **not** do, and why. A bare re-run is the
idempotent re-apply.

**Delivering to the owner: one pull request, `colab deliver`** (#394). The owner's branch
is declared in the same local descriptor — `colab adopt --local` writes this block itself
when it detects the owner's default branch (#405), and never overwrites one already there:

```yaml
owner:
  branch: master     # the owner's branch; `remote:` optional, the repo's own when absent
```

Per-issue landing does not change: each session still ships onto the integration branch,
and its issues close there. Delivery is a **separate, batch-shaped step**:

```sh
colab deliver --dry                 # read-only: what is pending, and the delivery state
COLAB_HUMAN=1 colab deliver         # open (or refresh) ONE PR integration → owner's branch
```

- **[Hard — gate: owner-branch guard]** **It never merges.** The owner merges by merge commit, squash or rebase — his call. No
  colab command moves his branch: `ship`, the ship batch and `promote` refuse a push to it,
  and `COLAB_HUMAN=1` does not lower that.
- **Delivered is read from PR state.** The last merged delivery PR's head is the boundary;
  the next run offers only what landed after it, in a fresh PR. An open PR is refreshed
  (its head follows the integration branch on its own), never duplicated.
- **[Hard — gate: deliver refuses]** **A rejection stops it.** If the newest delivery PR was closed without a merge, `deliver`
  reports it (exit 3) and opens nothing until a human re-offers the batch with `--reopen`.
- **The PR carries no closing keywords.** Its issues already closed when their work landed
  on the integration branch; the body lists them as "carried".
- **[Hard — gate: deliver human gate]** **Opening or editing the PR needs a human** — it is an outward act on somebody else's
  repo. A scheduled driver may run `--dry` and read the state (`waiting-on-owner`,
  `nothing-to-deliver`, `ready`, `rejected`); it never acts on the owner's branch.
- **[Hard — gate: core-path PR gate]** **The core-path rule still applies on top** ([§4](../../CONVENTIONS.md#4-branches-and-commits), #350): a branch
  touching a CODEOWNERS path needs a non-author approval before it lands on the integration
  branch.

A PR per issue that the owner merges one by one is a different shape, deferred until a
repo asks for it.
