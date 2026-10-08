---
name: handbook-sync
description: "Bring ONE repo up to the current colab-handbook, from inside that repo — including a repo that has never adopted it at all. Detects 'nothing adopted here yet' as a first-class state and drives first-time adoption to completion (tier, marker, claim label, topic, CLAUDE pointer, CI, and registration in the fleet). Otherwise classifies every copied artifact (CI workflows, the CLAUDE conventions block, guards), shows what upstream actually changed since your stamp, and grafts it in without destroying your local edits — because copy-and-own means the repo owns its copies. Also checks whether the axis model itself moved on, and reports a convention label meaning or value this repo changed without a linked handbook issue as drift, not customisation. Trigger phrases: 'sync the handbook', 'update this repo to the latest handbook', 'adopt the handbook', 'this repo has no project.yml', 'onboard this repo to the conventions', 'register this repo', 'we are behind the handbook', 'handbook drift', 'reconcile conventions', 'colab update says we are behind'. Wrap it in code-start/code-wrap — this is a code change like any other."
---

# handbook-sync — bring this repo up to the current handbook

**Local policy for this repo** (#520) — optional, one file per skill:

!`cat .colab/skills/handbook-sync.md 2>/dev/null || echo "(no local policy for handbook-sync in this repo)"`

If `.colab/skills/handbook-sync.md` exists in this repo, read it before continuing. Local policy
refines this skill for this repo and wins over the text below where they differ. It never
changes a `colab` gate.

`colab update` sweeps a machine and classifies; it refuses to write anything that
needs judgment. That refusal is correct — and it leaves you with a verdict and no
procedure. This is the procedure, run from inside the repo.

It also reaches what the sweep cannot: the registry is machine-local and private,
so a colleague's clone is invisible to `colab update`. This works on any checkout.

## Principle — this is a graft, not a refresh

Templates are **copy-and-own** ([`CONVENTIONS.md` §7](../../CONVENTIONS.md#7-ci-and-toolchain)). The
handbook never pushes; the moment you copied a file it became yours. So the job is
to take what upstream changed *and keep what you added*. A tool can do the provably
pristine cases. The rest is judgment, and pretending otherwise destroys work.

**Assume your copies are authored, not filled in.** Measured across one fleet: of 7
adopted repos, **6 had grown their CLAUDE conventions block** from the template's 3
bullets to 5–8 — merge rules, claim reminders, toolchain resolution, guardrails.
Regenerating any of them would have deleted real content. Sampled CI copies carried
a self-hosted runner, a whole extra Python job, and edited branch triggers.

`colab template <name> --force` overwrites wholesale. It is the last step of a
reconciliation, never the first.

## 0. Open a session first

This changes committed files, so it is a code change: run **code-start** — find or
create the Issue, claim it, branch off trunk. Do not edit trunk directly. Close with
**code-wrap**.

**One check before you claim:** if this repo has no `.github/project.yml`, it has no
`in-progress` label either, and the claim will not land the way you think it did —
read §2's ordering note first. This is the one step that cannot wait for §1 to detect
the condition, because it runs before §1.

## 1. Establish where this repo stands

```sh
cat .github/project.yml                       # trunk, tier (legacy), deploy, toolchain pins
colab update .                                # classify this repo's stamped copies
node "$COLAB_HANDBOOK/audit/audit.mjs" --local .   # conformance beyond stamps
```

`colab update .` gives each copied artifact one of five states:

| State | Meaning | What you do |
|---|---|---|
| `current` | template unchanged since your stamp | nothing |
| `behind` | template genuinely changed since your stamp | §3 — refresh or graft |
| `diverged` | you hand-edited it since copying | §4 — graft only |
| `unstamped` | lineage unknown | §5 — establish it first |
| `unrelated` | its name matches a template, its content does not | nothing — it is this repo's own file |
| `n-a` | cannot assess, with a stated reason | **read the reason.** `nothing adopted here yet` → §2, this is adoption. Otherwise often a missing tag |

**Before any of that, check you are in the right skill half.** The first command above
reads the one file an unadopted repo does not have, and every state in the table is
derived from stamps it does not have either — so on such a repo this whole section
degrades to a no-op that looks like a clean bill of health. If `colab update .` says
`n-a` with the reason **"no stamped handbook artifacts — nothing adopted here yet"**,
or the audit says **"no `.github/project.yml` — repo is undescribed"**, go to **§2**
and do not walk the reconciliation states.

**Adopted locally, not committed, is a third state, not "not adopted" (#393).** A repo
the fleet does not own carries its descriptor in the local clone only, hidden by
`.git/info/exclude` ([`CONVENTIONS.md` §9, *Working in a repo you don't
own*](../../CONVENTIONS.md#working-in-a-repo-you-dont-own)). There the audit prints
**`⌂ adopted locally, not committed`**, and `colab update .` still says `n-a` /
"nothing adopted here yet", because nothing stamped was ever copied, on purpose. **Do not
run §2 on it.** Adoption there would mean committing handbook files to someone else's
repo. The only sync such a repo takes is a bare `colab adopt --local` (the idempotent
re-apply: exclude lines, stub, the four labels, checkout) plus whatever the audit asks for.
The reverse case: the audit warns that the descriptor is **untracked and not excluded**.
Decide which of the two it is (commit it, or `colab adopt --local`) before anything else.

**`behind` does not mean "your file is old".** It means the *template* moved. If the
template never changed, a stamp from three releases ago is still current — which is
why this check compares template history, not version strings.

## 2. Nothing adopted here yet — this is adoption, not sync

Adoption is not a niche case. Measured on one fleet: **9 of 23 registered repos have
no `.github/project.yml`** — the largest single cohort in it, and every one invisible
to the conformance checks by construction. A repo missing from the registry entirely
is worse off still: it appears in no sweep, so nothing will ever tell you it needs
this. **It can only be adopted from inside, by someone standing in it.** That is you.

**First, is the repo yours to adopt?** If its owner has not adopted the handbook and will
not carry its files, stop here: nothing in this section applies. Use `colab adopt --local`
([`CONVENTIONS.md` §9, *Working in a repo you don't
own*](../../CONVENTIONS.md#working-in-a-repo-you-dont-own)) instead, which commits nothing.

**One step is a human's, and you should know it before step 1, not after (#522).**
Answering `exposure` with `none` or `self` needs a human — the bar in
[§9](../../CONVENTIONS.md#9-adopting-this). Drive everything else; when `colab adopt`
reaches that gate it prints, as its first line, the one command the human runs with
every answer already filled in. Hand the maintainer that line, unchanged — never
clear the bar yourself. Adoption asks only the gating rows (deploy/production and
exposure); `room`, `writes` and `channels` are optional and answered later with
`--axis` (#533). An existing default branch is kept as trunk whatever it is called —
never rename `master` to adopt.


**How this file is built (#524).** This is the core: the steps in order, each with its rule and
its stop condition. Each step's full text — edge cases, the measurements behind them, worked
examples — sits in a reference file next to this one, moved there verbatim, and the step names
it. **Read a step's reference file before you act on that step**; the line here is an index to
it, never a substitute.

**Adoption, in the order a run needs it** — full text: [2-adoption-details.md](2-adoption-details.md).

- **The checklist is [`CONVENTIONS.md` §9](../../CONVENTIONS.md#9-adopting-this)** — work it in
  order; never copy its steps into this skill or the Issue (two copies drift).
- **Ordering trap:** run `colab labels --ensure` *before* the claim — `colab claim` keeps a local
  claim silently when the label does not exist yet.
- **The question set blocks:** every §9 axis answer is a human's; you may propose `live`/`released`
  from committed evidence, never `none`/`self`. Asking is not writing.
- **Partial adoption is normal** — probe each §9 step and resume; leave existing branches alone.
- **Runner preflight:** a private repo under a personal account needs a registered, online
  self-hosted runner before `colab template` stamps `ubuntu-latest`; if none, stop and ask.
- **Red CI after adoption:** `steps: 0` + empty `runner_name` + seconds-long run = no runner was
  assigned; check that before reading logs.
- **`exposure: released`:** the release rung (§6) is wired in the same pass; the route and the
  disarmed deploy template are proposals, the first final is the operator's.
- **Registration is the step that gets skipped** — run `colab register`.
- **Finish by proving the repo is visible:** `colab update .`, the audit and
  `colab register --list`, pasted onto the Issue; then return to §1.


## 3. `behind` — let the tool write only what is provably pristine

```sh
colab update . --apply
```

This writes **only** copies still byte-identical to the template as of their own
stamp. It never commits, never stages, never touches a `diverged` or `unstamped`
file. If it reports "nothing was refreshable", that is a real answer, not a failure —
go to §4.

Then read what it wrote (`git diff`) before committing. A refreshed file may reintroduce
an `# EDIT:` marker your repo had already resolved.

## 4. `diverged` — graft the upstream change, keep yours

Do **not** re-copy. Get the delta you are actually missing:

```sh
git -C "$COLAB_HANDBOOK" diff <your-stamp>..<current-version> -- templates/<name>
```

That is usually small — a few lines — while your local edits may be dozens. Apply
those few lines by hand into your copy, keep everything of yours, then bump your
stamp line to the current version so the next check measures from here.

If the upstream change conflicts with why you edited the file, that is a **finding**:
say so on the Issue rather than silently choosing. Someone made both decisions for a
reason and they now disagree.


### The CI trigger blocks (#384, #512) — decide per copy before grafting

Full text, with the runner table and the per-copy decision rows:
[4-trigger-blocks.md](4-trigger-blocks.md).

- **Every-branch trigger block (#384):** offer it only where trunk has capacity of its own — decide
  from every job's `runs-on:`; on a single shared self-hosted runner, **warn, do not graft**.
- **Single-run trigger block (#512):** a copy with push `'**'` *and* `pull_request` runs every
  same-repo PR commit twice; offer dropping `pull_request` only where fork PRs cannot arrive and
  the copy has more than a trunk-only push. Check what the PR run was carrying (a Laravel
  `RUN_TESTS`) first; never replace the trigger with an `if:` skip or `paths-ignore`.
- A `cancel-in-progress` that is unconditionally `true`, or a trunk missing from the cancel list, is
  a **finding**: trunk runs get cancelled.

## 5. `unstamped` — establish lineage before touching anything

An unstamped copy cannot be safely rewritten: nobody knows what replacing it would
destroy. Work out which template it came from and how far it has drifted:

```sh
diff <(git -C "$COLAB_HANDBOOK" show <some-tag>:templates/<name>) <your-file>
```

Then either graft as in §4 and **hand-add the stamp line**, or — only if the copy
turns out to be genuinely untouched — `colab template <name> --force` and let it
stamp. Adding a stamp asserts provenance; do not assert one you have not checked.

The row tells you which `<name>` the evidence points to. If it names none, the tool
proved the file is *a* copy but not *of what* — find that out before stamping
anything. And if the state is `unrelated`, stop: the file only shares a template's
name. Re-copying over it destroys work that never came from the handbook.

## 6. The CLAUDE conventions block — always a graft

**Never regenerate this block.** It sits inside `CLAUDE.md` — a thin shell importing
`AGENTS.md` (`CONVENTIONS.md` [§9](../../CONVENTIONS.md#9-adopting-this) step 5, #417), or a hand-written file — and the
template ships placeholders (`<A|B|C>`, `<dev|main>`) that an adopter fills in. Two
independent reasons not to automate it:

- Regenerating would replace your repo's real tier and trunk with angle brackets.
- Most repos have *extended* the block well past the template (measured: 6 of 7).

**Moving a repo to the `AGENTS.md` shape — the graft step (#419).** Offer it whenever the
audit reports `prose-in-claude-md` (it names the line ranges) or `no-agents-md`. It is an offer,
not a precondition: both are warnings, and a repo migrates when its owner takes the step. **Never
on a fork of an upstream** (a remote named `upstream`, or the repo says it tracks one): there
the prose belongs to the upstream, both warnings are expected, and the block stays appended at
the end of the upstream's `CLAUDE.md` (`CONVENTIONS.md` [§9, *A fork of an upstream*](../../CONVENTIONS.md#a-fork-of-an-upstream--a-repo-you-own-that-tracks-one-you-dont-449), #449). Move
the prose, never the block:

1. **Sort `CLAUDE.md`'s lines into two piles.** *Stays:* the `@AGENTS.md` import, this
   Conventions block (from its heading to the next heading of the same level — bullets the repo
   added inside it are the block's), its `Local divergences:` list, and every paired tool block
   (`<!-- BEGIN:<name> -->`…`<!-- END:<name> -->`, `<!-- <name>:start … -->`…`<!-- <name>:end -->`,
   `<laravel-boost-guidelines>`…). *Moves:* everything else — the ranges the audit printed.
2. **No `AGENTS.md` yet** (the legacy prose-only file) → `git mv CLAUDE.md AGENTS.md` so the
   prose keeps its history, cut the "stays" pile out of `AGENTS.md`, and write a new
   `CLAUDE.md`: `@AGENTS.md`, a blank line, then the "stays" pile verbatim. Retitle the moved
   file's `# CLAUDE.md — …` heading if it has one.
   **`AGENTS.md` already exists** → append the "moves" pile to it, under the heading it had,
   dropping only lines `AGENTS.md` already says; then delete them from `CLAUDE.md` and make sure
   `@AGENTS.md` is its first line.
3. **A block in both files** is the generator's doing, not yours to merge by hand: re-point the
   generator at `AGENTS.md` only (the duplicate-block warning names it), then delete the
   `CLAUDE.md` copy.
4. **Verify** — `node "$COLAB_HANDBOOK/audit/audit.mjs" --local .` reports neither
   `prose-in-claude-md` nor `no-agents-md`, and still finds the stamp (no "unstamped" row, no
   "Conventions block is in AGENTS.md" warning). The loaded size is unchanged give or take the
   moved headings: this is a move, not an edit — rewording rides in a separate commit.

A block moved into `AGENTS.md` hides its stamp from the audit and `colab update` — the audit
warns on it. An agent session cannot do step 2's `CLAUDE.md` write with prose in it anyway: a
hook blocks repo prose in `CLAUDE.md`, so a half-done move fails loudly rather than silently.

So diff the template between your stamp and now, and graft:

```sh
git -C "$COLAB_HANDBOOK" diff <your-stamp>..<current-version> -- templates/repo-CLAUDE-block.md
```

Add what upstream gained into your own wording, keep your extensions, bump the
`<!-- colab-handbook @ ... -->` line.

## 7. Beyond stamps — has the model itself moved?

Stamps track *file* drift. The conventions can move without any template changing,
and the audit is what catches it:

- **The audit now emits two distinct findings here, not one "tier mismatch."**
  `contradiction()` reports when a declared `tier` and a declared `exposure`
  disagree about gate count (`tools/lib/axis-authority.js`) — fixing `project.yml`
  (usually by trusting `exposure`, the axis of record) is part of this work.
  Declaring **neither** key is the other, unconditional finding — "no axis of
  record" (`CONVENTIONS.md` [§2](../../CONVENTIONS.md#2-tiers)) — which this sync should close by putting [§9](../../CONVENTIONS.md#9-adopting-this)'s
  question set to the repo's own owner, never by guessing an answer.
- Toolchain pins must still agree between `project.yml` and the manifest.
- **A private repo must not be able to publish to public npm (#432).** The audit fails a
  *private* repository (visibility read from the GitHub API, never guessed) when any
  `package.json` — root or workspace member — lacks `"private": true`, when
  `publishConfig.registry` points at `registry.npmjs.org`, or when a workflow runs
  `npm publish` / `pnpm publish` / `yarn npm publish` / `JS-DevTools/npm-publish`. Unknown
  visibility is a warning, not a pass. Fix: set `"private": true`, delete the publish step,
  and ship the app from git (`npx github:<org>/<repo>#<tag>`). A public repo is unaffected.
- **A private repo's install path is npx, never a GitHub Release asset (#442, advisory).** The
  audit warns when a *private* repository's workflows upload Release assets (`gh release upload`,
  `gh release create <tag> <files>`, a release action given `files:`). A compiled tool moves its
  binaries to dist refs (`templates/dist-refs.yml` + `templates/npx-launcher.mjs`, CONVENTIONS.md
  §6 *Distribution*); an asset that is only a by-product (an SBOM) can stay — it is a warning.
- A workflow may trigger on branches that no longer exist — CI passing on nothing.
- **A convention label may have been added since this repo adopted.** The label set
  is part of the model, and a repo that adopted at an older version never back-filled
  a label introduced later — so the check that label powers silently cannot fire (a
  readiness column that never leaves "nobody looked", provenance that reads every issue
  as human-filed). The audit now reports this as `missing convention label(s): …`.
  Back-fill it here — the same idempotent command §2 and [§9](../../CONVENTIONS.md#9-adopting-this) step 3 use, safe to re-run:
  ```sh
  colab labels --ensure
  ```
  This is a GitHub-side change, not a committed one, so it needs no entry in §8's
  commit — but note it in the Issue so the back-fill is recorded. A remote-less repo
  has no labels to create; say so rather than leave it looking undone.
- **The repo predates an axis.** `room`/`exposure`/`writes`/`channels` did not always
  exist, so a repo adopted before one of them landed simply has no key for it — legal,
  and silent everywhere else in the audit. But when the audit can also see that the
  repo's own `CLAUDE.md` stamp names a handbook version *older than the axis itself*,
  it reports one extra `warn`: `marker predates the axis model — … run through [§9](../../CONVENTIONS.md#9-adopting-this)'s
  question set`. That is your cue, not the label back-fill's: put the missing
  question(s) — [§9](../../CONVENTIONS.md#9-adopting-this)'s shared set, the same
  wording as first-time adoption — to the repo's own owner, and write the answer into
  `project.yml`. **Unlike the label back-fill, this DOES belong in §8's commit** — it
  is a `project.yml` change, not a GitHub-side one. **`writes` is now a veto question
  (⚖ #233), not a method choice** — put it to the owner as [§9](../../CONVENTIONS.md#9-adopting-this)'s
  question 4 phrases it: should a human ever be allowed to commit straight to this
  repo's trunk checkout? Leaving it unanswered is a legal, common answer (coexistence,
  the default), not a gap that needs closing.
- **`ceremony:` is optional, and syncing never adds it uninvited.** Unlike the label
  set, this is a `project.yml` field the repo opts into (project.schema.md#ceremony--optional)
  — omission already behaves as `standard`, so there is nothing to back-fill. Only
  raise it if the repo's own owner asks whether it qualifies for `light`, and never
  set it yourself as part of a routine sync.

- **Agents with their own GitHub account → ask about `trust-humans:` (#407).** If this
  repo's agents post under a login separate from the operator's, both report `MEMBER`, and
  without the key an agent-posted grant or ruling reads as a human's
  ([project.schema.md](../../project.schema.md#trust-humans--optional)). Ask the owner which
  logins are human, and write only the answer. Never list logins yourself.

**The `ceremony:` rule above is one instance of a general one: asking is not
writing.** A sync puts a question to a human and records the human's answer; it
never fills a gap on its own initiative, and it never "cleans up" an advisory
(the predates-an-axis warn above, or `exposure`'s `production:`-pairing advisory,
or `channels`' own) by deleting a key someone already declared. Declaring must
never read as riskier than omitting — a rule that would flip that is a bug, not a
tidy-up.


### Convention drift — a meaning this repo changed, or never absorbed (#362)

Full text, with the mechanical label comparison and the judgement half:
[7-convention-drift.md](7-convention-drift.md).

- A convention label's *meaning* is not a copy this repo owns. Compare the tracker's labels with
  the handbook's set (the script in the reference file prints `value` / `meaning` leads) and search
  this repo's own prompts, skills, scheduler config and docs for each label name.
- Each undeclared divergence is either **reverted** to the handbook's meaning in this sync's commit,
  or **filed upstream now** (described by shape, no `agent-filed` label, `Filed-by:` the approver)
  with a `Local divergences:` line added to `CLAUDE.md`. Never report one as "local customisation,
  left as is".
- `.colab/skills/<skill>.md` overlays are the sanctioned customisation — leave them, but read them.
- Fix what is genuinely wrong; **report what you are unsure about** rather than guessing.

## 8. Commit safely — two habits, both learned the hard way

```sh
git commit -o <paths> -m "chore(handbook): sync to <version>"   # ONLY these paths
git show --stat                                                 # verify the file list
```

- **`git commit` writes the index, not your intention.** If anything resets the index
  underneath you — a syncing filesystem, a concurrent process — a plain commit
  silently reverts unrelated files. Measured: a commit that staged only `templates/`
  deleted 13 lines from a documentation file edited an hour earlier. `-o <paths>`
  commits only what you name.
- **Check `git show --stat` every time.** If a file you did not touch appears, stop
  and look before pushing. It is far cheaper here than after a merge.

## Verify complete

- `colab update .` reports no `behind` for this repo.
- Every `diverged` item is either grafted and re-stamped, or left with a written
  reason on the Issue — never silently skipped.
- Every `unstamped` item is either stamped after checking lineage, or reported.
- Every `ci-*` copy either carries the every-branch trigger block (#384) or has the
  single-runner warning recorded on the Issue (§4) — never neither.
- Every `ci-*` copy either carries the single-run trigger block (#512) or has the reason it
  keeps `pull_request` (trunk-only push, fork PRs) recorded on the Issue (§4).
- `audit.mjs --local .` is clean, or each remaining finding is explained.
- `git show --stat` on your commits lists only files you meant to change.
- The §7 convention-drift check ran. Every `value`/`meaning` hit and every divergent text
  is reverted, refreshed, or declared in `Local divergences:` with a handbook issue URL.
  None is left reported as a local customisation.

**If this was an adoption (§2), additionally:**

- **Each question in [§9](../../CONVENTIONS.md#9-adopting-this)'s shared set was answered by a human**, not inferred — and
  the report says who, and which of the five rows (`tier`/`room`/`exposure`/
  `writes`/`channels`) were actually asked versus already detected/undeclared.
- **No `exposure` (or any axis) value claiming the absence of a consumer was
  written unless a human gave it.** An agent may propose `live`/`released` from
  committed evidence; concluding `none`/`self` on the repo's behalf is exactly the
  failure this checklist exists to prevent.
- `colab update .` no longer reports "nothing adopted here yet", and the audit no
  longer reports "repo is undescribed" — pasted onto the Issue as output, not
  summarised as a claim.
- `colab register --list` shows this repo in **both** registries and exits 0.
- Every step of [§9](../../CONVENTIONS.md#9-adopting-this) is either done or explicitly recorded as not applicable (a repo
  with no GitHub remote skips several) — none left ambiguous.
- Pre-existing branches are untouched.

**If this sync answered a "repo predates an axis" finding (§7), additionally:**

- Every axis the audit flagged as predated is now declared in `project.yml`, with
  the answer coming from the repo's own owner — never inferred, and never
  `none`/`self` without that human's say-so.
- The commit that adds the answer is in §8's commit, not left as a GitHub-side-only
  note.
- Re-running the audit no longer reports the predates-an-axis warn for this repo.
