---
name: handbook-sync
description: "Bring ONE repo up to the current colab-handbook, from inside that repo — including a repo that has never adopted it at all. Detects 'nothing adopted here yet' as a first-class state and drives first-time adoption to completion (tier, marker, claim label, topic, CLAUDE pointer, CI, and registration in the fleet). Otherwise classifies every copied artifact (CI workflows, the CLAUDE conventions block, guards), shows what upstream actually changed since your stamp, and grafts it in without destroying your local edits — because copy-and-own means the repo owns its copies. Also checks whether the axis model itself moved on. Trigger phrases: 'sync the handbook', 'update this repo to the latest handbook', 'adopt the handbook', 'this repo has no project.yml', 'onboard this repo to the conventions', 'register this repo', 'we are behind the handbook', 'handbook drift', 'reconcile conventions', 'colab update says we are behind'. Wrap it in code-start/code-wrap — this is a code change like any other."
---

# handbook-sync — bring this repo up to the current handbook

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

**`behind` does not mean "your file is old".** It means the *template* moved. If the
template never changed, a stamp from three releases ago is still current — which is
why this check compares template history, not version strings.

## 2. Nothing adopted here yet — this is adoption, not sync

Adoption is not a niche case. Measured on one fleet: **9 of 23 registered repos have
no `.github/project.yml`** — the largest single cohort in it, and every one invisible
to the conformance checks by construction. A repo missing from the registry entirely
is worse off still: it appears in no sweep, so nothing will ever tell you it needs
this. **It can only be adopted from inside, by someone standing in it.** That is you.

### The checklist is not in this file, on purpose

**[`CONVENTIONS.md` §9 "Adopting this"](../../CONVENTIONS.md#9-adopting-this) is the
procedure** — nine steps, already written, already correct. Open it and work it in
order. This section adds only what [§9](../../CONVENTIONS.md#9-adopting-this) cannot know: how to interleave it with your
session, which step blocks, and which steps get skipped.

**Step 1 (the shared question set) is `colab adopt` — run the tool, don't walk the
five rows by hand (#199).** It detects what the repo already states, asks only what
is missing (flags, or a prompt at a terminal), derives the rest, and writes
`.github/project.yml` in one act, append-only. This skill's job around it is
unchanged: judge whether a *detected* candidate (a stack manifest, a channel
candidate) is actually right before answering with it, decide what [§9](../../CONVENTIONS.md#9-adopting-this)'s "going
live" ladder means for THIS repo, and carry the session/Issue ceremony `colab
adopt` deliberately does not touch. What moved to the tool is steps 3–7 of typing
the answers in — this skill still grafts, proposes, and judges; it never writes
the descriptor itself.

Do **not** copy [§9](../../CONVENTIONS.md#9-adopting-this)'s steps into this skill, or into the Issue as a restated list. Two
copies of one checklist drift, and the disagreement is then found by whoever followed
the wrong one. This handbook has paid for that twice in a single day — a duplicated
detection predicate that broke invisibly, and a list that quietly conflated two
different things. Link to [§9](../../CONVENTIONS.md#9-adopting-this), summarise its outcomes, never fork it.

### The ordering trap — you cannot claim before the label exists

[§9](../../CONVENTIONS.md#9-adopting-this)'s step 3 creates the `in-progress` label, because on an unadopted repo it does not
exist. But **code-start claims the Issue in its own step 3, before any of [§9](../../CONVENTIONS.md#9-adopting-this) runs** —
so the claim depends on machinery adoption has not built yet.

On the path most sessions take, the failure is quiet:

- Raw `gh issue edit $N --add-label in-progress` **fails loudly.** Recoverable.
- `colab claim $N` **does not fail.** It warns that the `gh` edit failed and keeps the
  **local** claim. So the machine-local cache reads as claimed while GitHub — the
  source of truth, and the only thing a colleague on another machine can see — holds
  nothing. That is precisely the collision `CONVENTIONS.md` [§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this) exists to prevent,
  reached from underneath.

So **pull [§9](../../CONVENTIONS.md#9-adopting-this)'s step 3 forward, ahead of the claim** — and provision the **whole label
set** while you are there, not just the claim label:

```sh
colab labels --ensure
```

Only `in-progress` is ordering-critical (the claim below needs it), but `--ensure`
creates the whole nineteen-name set in one idempotent call (#206) — reading it from
`tools/lib/labels.js`'s `CONVENTION_LABELS`, never restated here — and creating a
subset is the exact bug this leads to: a `deps-checked` never created leaves a
readiness column that can never fill, and nothing downstream can tell *free* from
*nobody looked*. Create the set, not the claim label alone. Then claim, then work [§9](../../CONVENTIONS.md#9-adopting-this)
from its step 1. Safe to re-run on a repo that already has some or all of the labels —
which matters, because partial adoption is the normal case.

**No GitHub remote at all?** There is no label and no claim to be made. Take
code-start's notes-file path; [§9](../../CONVENTIONS.md#9-adopting-this)'s steps 3 and 4 and the GitHub half of 7 do not
apply. Say so in your report rather than leaving them looking undone.

### The question set blocks — ask it, never infer it

[§9](../../CONVENTIONS.md#9-adopting-this)'s step 1 is a **shared question set — five questions, not one** — and every
answer is a **judgement, not yours to make.** `CLAUDE.md` is explicit about the
oldest of them: a missing marker means treat the repo as Tier B and *propose* the
file. Proposing is the agent's job; deciding is not, for `tier` or for any of the
newer four (`room`, `exposure`, `writes`, `channels`).

**Do not restate the five rows here** — that is the exact fork [§9](../../CONVENTIONS.md#9-adopting-this)'s own text
forbids, one section above this one. Link to [§9](../../CONVENTIONS.md#9-adopting-this)'s table, and know the two outcomes
that matter for how you run a sync:

- **You may propose, from committed evidence, and never conclude on your own:**
  a non-null `production:` or a committed deploy path lets you propose `exposure:
  live` or `released` — never `none` or `self`, because those declare the *absence*
  of a consumer, which nothing in a checkout can verify. The identical asymmetry
  [§9](../../CONVENTIONS.md#9-adopting-this) states for `exposure` applies to reading a tier off a `Dockerfile`, a URL in
  a README, or a deploy workflow that may be dormant: guessing costs nothing at
  the time it is written and misroutes something later. A repo that describes
  nothing is more honest than one that describes itself wrongly.
- **Asking is not writing.** When a sync meets a repo missing one of the newer
  four axes, put [§9](../../CONVENTIONS.md#9-adopting-this)'s question to the human and record the answer through
  `colab adopt` (`--room`/`--exposure`/`--writes`/`--channels`, or run it at a
  terminal and answer the prompt) — never fill the gap yourself, and never
  "resolve" the undeclared-pairing advisory (`exposure: none` +
  `production: null`, `channels: [none]` + a non-null `production`/non-`none`
  `deploy`) by deleting a key someone already declared. Declaring must never
  come out riskier than omitting. `colab adopt` enforces the mechanical half of
  this (append-only, the human bar on lowering `exposure`) — your judgment is
  still choosing WHAT to propose when evidence exists, and confirming a human
  answer before it goes in.

Two things not to do while the trunk/tier answer is still pending: do not create
`dev` "to be ready" ([§9](../../CONVENTIONS.md#9-adopting-this) step 9) — `trunk:` is whatever the finished descriptor
declares, never assumed ahead of it — and if the answer is the legacy Tier B (trunk
`main`, no `exposure`), `production: null` and `deploy: none` are the finished values, not
placeholders to revisit.

### Partial adoption is the normal case — resume, don't restart

A marker but no label; CI but no registration; everything but the CLAUDE pointer.
Treat [§9](../../CONVENTIONS.md#9-adopting-this) as a checklist to **complete**, and probe each step rather than assume it:

```sh
colab adopt --repo . --no-verify        # step 2 — one command: which of the five §9 rows
                                         #   are already declared, what the repo's working
                                         #   tree already detects, what still needs asking
gh label list --search in-progress      # step 3
gh repo view --json repositoryTopics    # step 4 — tier-a / tier-b / tier-c
grep -c "colab-handbook @" CLAUDE.md    # step 5 — the pointer block and its stamp
ls .github/workflows/                   # step 6
colab register --list                   # step 7 — is this repo in BOTH registries?
```

Every step of [§9](../../CONVENTIONS.md#9-adopting-this) is safe to re-run, and `colab register` documents it in its own help
("Idempotent: registering an already-registered repo reports it and exits 0"). Record
the *outcomes* in the Issue as a checklist; leave the *steps* in [§9](../../CONVENTIONS.md#9-adopting-this).

**Leave existing branches alone** ([§9](../../CONVENTIONS.md#9-adopting-this) step 8) — [§4](../../CONVENTIONS.md#4-branches-and-commits) grandfathers them, and a first sync
is exactly when someone is tempted to tidy. Renaming one can break a live worktree.

### Runner preflight — before `colab template` writes `runs-on`

Step 6 of [§9](../../CONVENTIONS.md#9-adopting-this) (`colab template <name>`) stamps a CI workflow whose jobs
default to `runs-on: ubuntu-latest`, with a `# EDIT: self-hosted label if this repo
needs one.` comment left for a human to act on later. On a **private repo owned by a
personal account**, that default is not a placeholder to revisit — it is a red trunk
waiting to happen: GitHub-hosted runners stop being available the moment that
account's included Actions minutes run out, so every job dies before it starts.
Measured twice, on two different repos, two days apart (#259).

**Worth stating plainly, because it is not obvious: public repos do not consume
Actions minutes, private ones do.** A repo that must stay private — because its
contents are sensitive — cannot dodge this by becoming public. "Make it public" is
not an available fix; do not offer it as one.

So before accepting the template's default, check what is actually checkable:

- **owner type** — `gh api users/<owner> -q .type` (`User` vs `Organization`)
- **repository visibility** — `gh repo view <owner>/<repo> --json isPrivate -q .isPrivate`
- **is a usable self-hosted runner registered and online?** —
  `gh api repos/<owner>/<repo>/actions/runners`

If the repo is **private under a personal account** and that last call returns no
runner that is both registered and `online`, **stop and ask** rather than letting
`ubuntu-latest` stand. The answer — how this machine actually provides a self-hosted
runner — is local infrastructure and does not belong in this shared skill; put the
question to the repo's own owner and let their workspace's own notes answer it. This
skill's job ends at detecting the situation and asking, not at solving it.

### CI comes back red after adoption — which kind of red?

Two different causes produce an identical red X on the run, and only one of them has
logs worth reading:

```
run:  run_started_at 14:37:42Z → updated_at 14:37:46Z    (4s for the whole run)
job:  started 14:37:43Z → completed 14:37:45Z            (2s)
      steps = 0        runner_name = ""                  (empty)
```

`steps: 0` plus an empty `runner_name` plus a run measured in single-digit seconds
means **no runner was ever assigned** — the workflow never executed, so its contents
are irrelevant, correct or not. This is the runner-preflight failure above, arrived
at from the other direction: the repo went unadopted, then adopted with a default
that can't run.

**Check run duration and step count before reading logs.** `gh run view --log`
returns `log not found` for this failure, which reads like "logs aren't ready yet"
but actually means "nothing ran" — chasing it leads straight into editing workflow
contents that were never the problem. Three fix-and-push rounds were burned this way
before the two fields above answered it in one call:

```sh
gh run view <run-id> --json status,conclusion,startedAt,updatedAt \
  -q '{status,conclusion,startedAt,updatedAt}'
gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs \
  -q '.jobs[] | {steps: (.steps|length), runner_name, started_at, completed_at}'
```

A real workflow failure has nonzero steps, a named runner, and logs to read. An
empty preflight failure has none of those — go do the runner check above instead.

### Registration is the step that gets skipped

**`colab register` ([§9](../../CONVENTIONS.md#9-adopting-this) step 7) is last on the list and first to be forgotten**, because
nothing local breaks without it. The repo builds, CI passes, the session wraps — and
the repo simply never appears in a sweep, accumulating drift nobody can see. It is the
mechanism by which a cohort that size goes unnoticed. Run it, do not defer it.

### Finish by proving the repo is visible

Adoption ends with the classification that could not run at the start — not with the
claim that it now would:

```sh
colab update .                                     # no longer "nothing adopted here yet"
node "$COLAB_HANDBOOK/audit/audit.mjs" --local .   # no longer "repo is undescribed"
colab register --list                              # this repo, in BOTH registries
```

`colab register --list` marks each registry it found the repo in (`T` = the audit
fleet list, `C` = the ports config); a path in only one is drift, and the command
exits non-zero when it finds any. Paste that output onto the Issue. A repo is adopted
when the fleet can see it, and this is the evidence for it.

Then return to §1. Anything you copied in [§9](../../CONVENTIONS.md#9-adopting-this)'s step 6 is now a stamped artifact, and
the rest of this skill applies to it in the ordinary way.

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

**Never regenerate this block.** It sits inside a hand-written `CLAUDE.md`, and the
template ships placeholders (`<A|B|C>`, `<dev|main>`) that an adopter fills in. Two
independent reasons not to automate it:

- Regenerating would replace your repo's real tier and trunk with angle brackets.
- Most repos have *extended* the block well past the template (measured: 6 of 7).

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

**The `ceremony:` rule above is one instance of a general one: asking is not
writing.** A sync puts a question to a human and records the human's answer; it
never fills a gap on its own initiative, and it never "cleans up" an advisory
(the predates-an-axis warn above, or `exposure`'s `production:`-pairing advisory,
or `channels`' own) by deleting a key someone already declared. Declaring must
never read as riskier than omitting — a rule that would flip that is a bug, not a
tidy-up.

Fix what is genuinely wrong; **report what you are unsure about** rather than
guessing. A `project.yml` that contradicts reality is worse than one that admits it.

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
- `audit.mjs --local .` is clean, or each remaining finding is explained.
- `git show --stat` on your commits lists only files you meant to change.

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
