# handbook-sync · §4 the CI trigger blocks

Reference for [`handbook-sync`](SKILL.md) §4. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### CI copies are guidance (#607)

A CI template copy (`ci-*`, light or heavy lane) is guidance, not a conformance item. Its
`behind`, `diverged` and `unstamped` states are suggestions: show the upstream diff, adopt what
helps, and record nothing when the adopter declines. The audit prints them as `▸` lines and
`colab update` never exits 1 on one. Every block in this file is such a suggestion.

What still binds an adopter's CI is the short contract `colab ship` reads —
[`CONVENTIONS.md` §7, *What ship reads*](../../CONVENTIONS.md#what-ship-reads--the-ci-contract-607):
a CI run on every push to trunk, a branch-push run where `gate: authoritative: ci`, a
`ship-batch/**` trigger where `ship-batch` > 1, and the `Migration round-trip` job where
`migration-grant: reviewer`. The audit still reports those, and a gap there is a finding.

### The every-branch trigger block (#384) — offer it only where trunk has capacity

A `ci-*` copy stamped before #384 is missing the templates' new `on:` + `concurrency:`
block: push on `'**'`, and a per-ref group that cancels a superseded branch run and never
a trunk one ([`CONVENTIONS.md` §4, *Branch CI*](../../CONVENTIONS.md#branch-ci--the-candidates-own-run-read-as-a-class-314)).
It is an upstream change like any other — but it is only a fix where trunk runs have
capacity of their own. On one self-hosted agent shared with trunk it makes things worse:
branch runs queue ahead of the one trunk run a merge waits for (#355). So decide from the
copy's own `runs-on:` lines, every job, before offering it:

| every job's `runs-on:` is … | trunk lane? | do |
|---|---|---|
| a GitHub-hosted label (`ubuntu-latest`, `ubuntu-24.04`, `macos-*`, `windows-*`) | yes — a fresh machine per job | **offer the graft** |
| an expression on `github.ref` sending trunk to a label other jobs never use | yes — a trunk-only lane | **offer the graft** |
| a static self-hosted label, and `gh api repos/<owner>/<repo>/actions/runners` lists **two or more** online runners carrying it | yes — a pool | **offer the graft** |
| a static self-hosted label with **at most one** online runner carrying it | **no** | **warn, do not graft** |

The warning, said to the human and recorded on the sync's Issue — not left in the diff:

> `<workflow>` runs on a single self-hosted runner (`<label>`) with no trunk lane.
> Not grafting the every-branch trigger (#384): branch runs would queue ahead of the
> trunk run the merge gate waits for (#355). Give trunk its own label or a second
> runner first (CONVENTIONS.md §7, *Self-hosted runners*), then re-run this sync.

- **Grafting keeps the copy's own branch names.** If the repo's trunk or release branch
  is not `main`/`dev`, put its real names into the `group:` and `cancel-in-progress`
  expressions and the `dedupe` job's `if:` (and into the `pull_request` list, if the copy
  keeps one — see the next subsection). A trunk missing from that expression has its runs
  cancelled by the next merge — the one outcome the block exists to prevent.
- **Mixed jobs — some hosted, some on a single shared agent — read as "no".** A run is
  not complete until its last job is; one starved job holds the trunk run as surely as
  all of them.
- **The runners call needs admin on the repo.** A 403/404 there is not "zero runners":
  say the pool size could not be read and warn, rather than guess a pool into existence.
- **A copy that is `behind` and pristine** (§3) still carries the template's own
  `runs-on: ubuntu-latest` — byte-identical means nobody changed it — so `colab update
  --apply` writing it is the first row above, never the last. The check matters on a
  `diverged` or `unstamped` copy, which is where a self-hosted label lives.
- **Already on `'**'` by hand** (a common local edit before #384)? Graft only what is
  missing, usually the `concurrency:` block — and check the copy's existing cancel rule
  does not already cancel trunk runs. The table still decides first: on a single shared
  agent that hand edit is itself the #355 shape, so warn about it (as a finding, not a
  revert — the owner chose it) instead of grafting more onto it.

### The single-run trigger block (#512) — drop the duplicate `pull_request` run

A `ci-*` copy stamped before #512 triggers on `push: ['**']` **and** `pull_request`, so every
same-repo PR commit runs the whole suite twice. The templates now carry `push` and
`workflow_dispatch` only, and a per-run concurrency group for the trunk refs (a pending trunk
run is never replaced) — [`CONVENTIONS.md` §4, *Branch CI*](../../CONVENTIONS.md#branch-ci--the-candidates-own-run-read-as-a-class-314).
Offer it as an upstream change, deciding per copy from what it actually has:

| the copy has … | do |
|---|---|
| push `'**'` **and** a `pull_request` trigger, and cannot receive fork PRs (a private repo with forking disabled; `gh api repos/<owner>/<repo> --jq .allow_forking`) | **offer**: remove `pull_request`, adopt the per-run trunk group (`group:`), and on a Laravel copy the "Decide the test tier" step (`RUN_TESTS: auto`) |
| push limited to trunk branches, plus `pull_request` | **do not remove it** — that PR run is the copy's only branch run (#353, #355). Offer the concurrency half only, and record why on the Issue |
| a public repo, or a private one that accepts fork PRs | **finding, not a graft**: keep `pull_request`, and say the duplicate stays until the readers' newest-run pick ignores a `skipped` or `cancelled` run |
| Laravel with `RUN_TESTS` set to a literal `'true'` / `'false'` | graft the triggers; leave the literal — it still wins |
| a `cancel-in-progress` that is `true` unconditionally, or a trunk missing from the cancel list | **finding**: trunk runs get cancelled; graft the trunk list into `group:`, `cancel-in-progress:` and the `dedupe` `if:` together |

- **Check what the PR run was carrying before dropping it.** A Laravel copy whose `RUN_TESTS` is
  `${{ github.ref == 'refs/heads/main' || github.base_ref == 'main' }}` ran Pest *only* on the PR
  run when main is the trunk. Removing the trigger without the tier step removes the suite from
  every branch.
- **Never replace the trigger with an `if:` that skips jobs on same-repo PRs, or with
  `paths-ignore`**; both leave runs that `colab ship` reads as not green.

### The instruction-files caller's trigger (#599) — always graft the template's `on:`

A caller of the reusable `instruction-files.yml` (a job whose `uses:` points at it — whatever the
file is named) must run on **every** branch push and be **dispatchable**. The audit names a caller
that is not, with the branches it misses: `… calls the reusable instruction-files workflow, but …
(#599)`. The template's block, verbatim:

```yaml
on:
  push:
  pull_request:
  workflow_dispatch:
```

Why both halves matter (measured: 15 of 16 adopting copies narrowed `push:` to `branches: [main]`):

- **Narrowed `push:`** — the ratchet (#588) never runs on the session branch, so a branch that
  trips it merges green and the failure first appears **on trunk**. The ratchet exists to fail on
  the branch, before trunk.
- **No `workflow_dispatch:`** — the cure branch's push run then cannot contain the red trunk job,
  the cure rule (#297) refuses, and `colab ship` cannot fall back to dispatch evidence (#510): a red
  trunk ships only through a human `ci-grant`.

Unlike the `ci-*` blocks above, there is **no runner-capacity decision**: the job is one short git
check with no test suite, so the #355 queueing argument does not apply, and the graft is always
offered. Keep the copy's `with: runs-on:` (#594) and its pinned `@ref` as they are — only `on:`
changes. A `pull_request` trigger is part of the template here (no dedupe job to make it a
duplicate); a copy that dropped it is not a finding.
