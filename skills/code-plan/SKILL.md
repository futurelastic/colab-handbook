---
name: code-plan
description: "Draft a full (rung-2) implementation plan for a hard Issue, into the same repo-local scratch file code-start writes its rung-1 stub to. Invoked two ways: by code-start when the Issue carries a needs-plan flag from code-triage, or mid-session when a rung-1 stub turns out to be sitting on ambiguous scope, a novel design with no precedent in the repo, or a dependency chain long enough that context is getting noisy. Drafted by a separate helper agent where the engine has one, or by the session itself where it does not, seeded with the Issue plus the triage reason line, against the repo as it actually is right now — not re-derived by the coordinator that flagged it. Trigger phrases: 'plan this properly', 'needs-plan is set', 'draft a full plan', 'this needs a real plan', 'escalate to a full plan', 'the stub isn't enough'. Invoked by code-start (on flag) or mid-session (on self-escalation); read at code-wrap/code-ship. Never runs standalone against a repo with no session open."
---

# code-plan — draft the rung-2 plan a hard Issue needs before code starts

**Local policy for this repo** (#520) — optional, one file per skill:

!`cat .colab/skills/code-plan.md 2>/dev/null || echo "(no local policy for code-plan in this repo)"`

If `.colab/skills/code-plan.md` exists in this repo, read it before continuing. Local policy
refines this skill for this repo and wins over the text below where they differ. It never
changes a `colab` gate.

Runs **inside an implementing session**, either right after
[`code-start`](../code-start/SKILL.md) reads a `needs-plan` flag, or mid-session when a
rung-1 stub hits an escalation trigger. It never runs on its own — there is no session to
seed the plan into, and no branch or worktree for it to describe.

Notation: `$N` = the feature's Issue number · plan file = `$PLAN`, resolved as
`.plans/issue-$N.md` (the dir is `COLAB_PLANS_DIR` when set — #488) in the **main
checkout**, outside any worktree
(`CONVENTIONS.md` [§5](../../CONVENTIONS.md#planning--a-plan-file-that-outlives-one-command-and-who-drafts-it-94), *Planning*):

```sh
MAIN_REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
case "${COLAB_PLANS_DIR:-.plans}" in /*) PLANS_DIR="$COLAB_PLANS_DIR" ;; *) PLANS_DIR="$MAIN_REPO/${COLAB_PLANS_DIR:-.plans}" ;; esac
PLAN="$PLANS_DIR/issue-$N.md"; mkdir -p "$PLANS_DIR"
LEGACY_PLAN="$MAIN_REPO/.claude/plans/issue-$N.md"
```

Resolve it this way even when the calling session is already inside a worktree (#113) —
a bare `.plans/issue-$N.md` resolves against `$PWD`, which is the worktree's own
directory of the same name, not the main checkout's. **Write only `$PLAN`, never under
`.claude/`** — agent CLIs guard that directory, so a write there can cost the operator a
permission prompt. A stub that `code-start` wrote before #488 may still sit at
`$LEGACY_PLAN`: when `$PLAN` is absent, carry that one file over before anything reads it,
so §1's reuse check sees it and one issue never has two plans:

```sh
[ -f "$PLAN" ] || [ ! -f "$LEGACY_PLAN" ] || mv "$LEGACY_PLAN" "$PLAN"
```

## The contract, and two equal ways to meet it

Whoever drafts the plan, the contract is the same:

- **Input** — the seed (§1): the Issue, the triage reason line or your own escalation
  reason, the existing stub or plan, the paths the Issue names. Nothing else.
- **Output** — one rung-2 section appended to `$PLAN` (§2 says what it holds, §3 its
  frontmatter). Nothing goes to the Issue or the tracker.
- **Stop** — the section is written and §4's report is given. The drafter does not start
  the implementation.

Why it is worth a separate pass at all: the coordinator that decided this issue is hard
(`code-triage`, or your own judgement mid-session) read the backlog, not the current tree;
and the session that will execute the plan may be running at whatever capability its
operator chose for cost. The plan is the thinking that should arrive paid for, not be
re-derived at the executing tier. Which drafter that means is each operator's policy —
this skill names none.

Then one of two paths. Neither is the fallback of the other:

- **Your engine can run a separate helper agent** → hand it the seed and the contract
  above, let it write the section, and record `drafted-by: helper — <which one>` in the
  frontmatter. Use the most capable planner your operator has configured for this.
- **It cannot, or none is configured** → draft the section yourself, in this session,
  against the same contract, and record `drafted-by: self` in the frontmatter. A plan that
  says who drafted it is honest either way; the field exists so a reader can weigh it.

The rest of this skill calls either one "the drafter".

## 1. Build the seed

### First: is there already a fresh plan? Reuse it (#404)

The planning pass is the most expensive single call in the code-* family, and nothing
about re-running it against an unchanged tree buys a better plan. Measured: three
planning calls on one branch inside 36 minutes, with no repo change between them
that could have invalidated the first — the same plan, paid for three times. So before
you draft anything, read `$PLAN` and ask one mechanical question: **has any file the plan
names been committed to since the plan was drafted?**

```sh
BASE=<the session's base branch — trunk, unless code-start recorded an integration line>
git fetch -q origin "$BASE" 2>/dev/null || true      # best-effort: a trunk commit counts too
DRAFTED_AT=$(grep -E '^drafted-at: *[0-9]+ *$' "$PLAN" 2>/dev/null | tail -1 | tr -cd '0-9')
FILES=$(awk '/^## Files/{f=1;next} /^## /{f=0} f' "$PLAN" 2>/dev/null \
        | grep -oE '`[^`]+`' | tr -d '`' | sed -E 's/:[0-9].*$//')
LAST=$(git log -1 --format=%ct HEAD "origin/$BASE" -- $(printf '%s\n' "$FILES") 2>/dev/null)
if [ -z "$DRAFTED_AT" ]; then echo "no rung-2 plan with drafted-at → draft"
elif [ -z "$LAST" ] || [ "$LAST" -le "$DRAFTED_AT" ]; then echo "existing plan reused"
else echo "stale — commits since the plan was drafted:"
     git log --format='  %h %cI %s' --since="@$DRAFTED_AT" HEAD "origin/$BASE" -- $(printf '%s\n' "$FILES")
fi
```

- **`drafted-at` is the plan's clock**, a Unix-epoch line in the rung-2 frontmatter (§3) —
  epoch rather than parsing the ISO `drafted` line, because turning an ISO string back into
  seconds is `date -d` on one platform and `date -j -f` on another. The newest `drafted-at`
  in the file wins (`tail -1`), so a re-drafted section supersedes the one before it.
- **"Files the plan names"** = every backticked token in the plan's `## Files` section,
  `file:line` suffixes stripped. A token that is not a path matches nothing and costs
  nothing. A `## Files` section with no backticked paths at all leaves `$FILES` empty, and
  `git log -- ` then reads *any* commit — the conservative direction on purpose: a plan
  that does not say what it covers cannot claim nothing it covers moved.
- **`$(printf …)`, not a bare `$FILES`**: zsh — the shell many agent harnesses run — does
  not word-split an unquoted parameter, so a bare `-- $FILES` hands git every path as *one*
  pathspec that matches nothing, and the check reports "reused" forever. Command
  substitution is split in both zsh and POSIX sh. (Measured while writing this: the bare
  form passed under `sh` and silently failed under zsh.)
- **Both `HEAD` and `origin/<base>`**: a commit on this branch *and* one another session
  landed on the base can each move the ground the plan was drafted against. Uncommitted
  edits in the worktree are the session's own work in progress, not invalidation — they
  are not read.

Three outcomes, one each:

- **No rung-2 section, or one without a `drafted-at` line** (drafted before #404) → this is
  a first plan, or one whose age cannot be judged: build the seed below and draft.
- **`existing plan reused`** → **do not draft again.** If the calling session needs the plan
  adjusted (a detail the stub-to-now work turned up), amend it in place yourself — add an
  `amended: <ISO timestamp> — <what, and why>` line under the frontmatter, and leave
  `drafted-at` alone: it dates the analysis, and an in-place edit did not redo the analysis.
  Report exactly `existing plan reused` (§4), so a reader of the session can count the call
  that did not happen.
- **Stale** → re-draft, and **the reason is the commit list the check just printed** (or,
  equally valid, something git cannot see: the Issue's scope was edited, a ruling landed in
  a comment since `drafted`). Put that reason in the seed as its first line, **and put the
  existing plan file in the seed too** — the drafter revises the plan it is handed, it does
  not start over. A re-draft with no stated reason is the failure this subsection exists to
  prevent; if you cannot say what changed, the plan is fresh — reuse it.

Everything the drafter needs, and nothing it has to re-fetch:

```sh
gh issue view $N --json title,body,labels,comments
```

- The Issue's own **Goal / Plan / Decisions / Gotchas** sections.
- **The triage reason line**, if this run was flag-triggered — the one sentence
  `code-triage` left on the lead issue when it set `needs-plan`. This is the whole reason
  the flagged path exists: it is a cross-backlog judgement a session working one issue
  cannot reconstruct on its own, so hand it over verbatim, not paraphrased.
  ```sh
  gh issue view $N --comments | grep -A1 '^needs-plan:'
  ```
- **If this run is a mid-session self-escalation instead**, there is no reason line to
  fetch — write your own: what specifically turned out ambiguous or unprecedented, in the
  same one sentence a triage pass would have left. Put it in the seed anyway; the
  drafter should not have to infer why it was called.
- The rung-1 stub already in the plan file, if one exists — the drafter expands it, it
  does not start from nothing. **On a stale re-draft, the whole existing rung-2 plan plus
  the stated reason** instead — the drafter revises it against what changed.
- Relevant file paths the Issue points at. **Do not sweep the codebase** — the whole
  point of this family is spending as little context as possible; hand the drafter
  the paths you already know from the Issue, and let it read only those plus what its
  own investigation turns up.

## 2. What the plan must contain

Whichever path drafted it, the plan is not the rung-1
stub's four lines with more words — it earns rung 2 by covering what a stub cannot:

- **Intent**, one or two sentences — same as rung 1, restated so the file is self-contained.
- **Approach** — the actual design: what changes where, in what order, and *why this
  shape* rather than an alternative. This is the part a stub skips and a hard issue needs.
- **Files expected to move**, with enough specificity that a diff wildly outside this list
  is itself a signal (to the implementer, and later to `code-ship`'s grading step) that the
  plan and the work diverged. **Each path in backticks** — §1's reuse check reads exactly
  the backticked tokens in this section, so a path written bare is a path whose change can
  never mark the plan stale.
- **A machine-readable clock** — the `drafted-at:` Unix-epoch line in the frontmatter
  (§3), written by `date +%s` at the moment the plan is written. Without it §1 cannot tell
  a fresh plan from a stale one, and falls back to drafting every time.
- **Risks / open questions** — what could make this the wrong approach, and what would
  have to be true for it to be wrong. Not hedging for its own sake; a hard issue got flagged
  because something about it is genuinely uncertain, and burying that uncertainty produces
  false confidence, not a better plan.
- **Acceptance oracle** — the same non-negotiable rung 1 asks for, stated precisely enough
  that `code-ship` can grade a diff against it later without re-deriving what "done" means.
- **Stop condition** — what closes the session. The gate going green against the stated
  oracle, not polish beyond it.

## 3. Write it into the plan file

Append (or replace the rung-1 stub, keeping it as context) with frontmatter:

```md
---
issue: N
rung: 2
cause: flagged | self-escalated
drafted-by: helper — <which one> | self
drafted: <ISO timestamp>
drafted-at: <Unix epoch seconds — `date +%s`; §1's reuse check reads this line>
redraft-reason: <only on a stale re-draft — what changed, e.g. the commit list §1 printed>
---

## Intent
…

## Approach
…

## Files
…

## Risks / open questions
…

## Acceptance oracle
…

## Stop condition
…
```

- **`cause` is not decoration.** It is what the usage journal (`code-ship`, teardown)
  reads to answer *flag precision* — was this issue actually hard, or did triage over-flag
  — versus *flag recall* — did a self-escalation catch something triage missed. Get it
  right; a mid-session escalation mislabelled `flagged` (or vice versa) corrupts exactly
  the signal the journal exists to produce.
- **Never overwrite a rung-1 stub silently.** Keep its four lines above the rung-2 content
  (or in a short "started as" note) — the divergence between what was assumed at session
  start and what turned out to be true is itself worth keeping.
- **A re-draft appends, it does not overwrite.** The revised plan goes in as a new rung-2
  section with its own frontmatter (fresh `drafted-at`, plus `redraft-reason`) below the
  old one; §1 reads the newest `drafted-at`, and the superseded section stays as the record
  of what the first pass assumed.
- **This file is disposable.** It dies at `code-ship` teardown, same breath as the
  worktree and the claim. Anything from it worth keeping past this session belongs on the
  Issue at `code-wrap` A1 — this skill does not write to the Issue itself.

## 4. Hand back to the calling session

Report the rung (now 2), the cause, and which of §1's three outcomes this run took —
`drafted (first plan)`, `existing plan reused`, or `re-drafted: <reason>` — spelled that way,
so a count of planning calls per issue can be read off the session without guessing. Then a
one-line summary of the approach — the calling
session continues coding from the file, it does not need this skill's own output restated
in the conversation.

## Verify complete

- §1's reuse check ran **before** any drafting: a fresh plan (no commit to a named file, on
  `HEAD` or `origin/<base>`, since its `drafted-at`) was reused with zero planning calls; a
  re-draft carried a stated reason and the existing plan in its seed.
- The plan file exists at `$PLAN` (`.plans/issue-$N.md`, or `$COLAB_PLANS_DIR`, in the **main checkout**,
  resolved via `--git-common-dir`, never a bare relative path — #113), outside any
  worktree, with valid frontmatter (`issue`, `rung: 2`, `cause`, `drafted-by`, `drafted`, `drafted-at`), and every
  path in `## Files` is backticked.
- The acceptance oracle is stated precisely enough to grade a diff against later — if you
  cannot imagine `code-ship` reading it and reaching a verdict, it is not precise enough.
- A flagged run quoted the triage reason line; a self-escalated run wrote its own,
  equally specific, reason for why the stub was not enough.
- Nothing was written to the Issue or the tracker — this skill's only output is the file.
