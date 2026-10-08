# handbook-sync · §2 adoption details

Reference for [`handbook-sync`](SKILL.md) §2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

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
creates the whole twenty-three-name set in one idempotent call (#206) — reading it from
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
grep -c "colab-handbook @" CLAUDE.md    # step 5 — the pointer block and its stamp (always in
                                         #   CLAUDE.md, even when it is a thin shell over AGENTS.md)
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

### `exposure: released` — the release rung is part of adoption (#492)

[§9](../../CONVENTIONS.md#9-adopting-this) step 6 does not end at CI on a released repo: the
release rung ([§6](../../CONVENTIONS.md#6-releases)) is wired in the same pass, or the repo
never cuts a candidate until someone notices. `colab adopt` prints what is still missing as
extra step-6 lines — read them there; this section adds only the judgement around them.

- **The route.** A tag-deployed row (`deploy: tag` / `manual`) takes `deploy-tag`, finals
  human — nothing to decide. The no-production row is the one choice §6 offers, and the
  tool's pick (public room → `public-tool`, otherwise `rapid-app`; `library-fast` for a
  library its consumers pin) is a **proposal**: put it to the human before writing the
  block, exactly as the axis answers above. Always write `version-source: tag` beside it
  (#484 — nobody bumps a manifest before an automatic cut).
- **The release workflow** comes from `colab template release-auto`. `HANDBOOK_REF` must
  name a ref the handbook carries (#480); on a private repo every job but `npm` takes the
  self-hosted label the runner preflight above settled — the same red-trunk trap, on a
  workflow that runs at every green trunk head.
- **The deploy template**, where the tag deploys and the stack has one (`deploy-xserver` for
  PHP on shared hosting, `deploy-container` for a container host), is copied **disarmed** —
  only its `workflow_dispatch` trigger live — and the operator arms `push: tags` once its
  secrets are set. Arming a deploy is never adoption's act.
- **The first final** is the operator's. `colab release cut` refuses with no final to bump
  from, so tell them in the report, with the command; tag `v0.1.0` yourself only when told to.

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
