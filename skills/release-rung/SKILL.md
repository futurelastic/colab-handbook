---
name: release-rung
description: "Walk ONE repo's release rung (CONVENTIONS.md §6) from a coordinator session: decide whether a release is owed and at what bump, cut the -rc candidate through `colab release cut`, watch its test period, respect a human's release-hold veto, cut a new candidate when a regression lands, and take the final — tagged by `colab release finalize` where the rung row makes it automatic, handed to a human as one command where the final reaches production. No daemon: every run re-measures from git and GitHub, and the only stored state is the version's tracking issue. Never tags by hand, never a major, never removes release-hold. Trigger phrases: 'cut a release', 'is a release owed', 'release candidate', 'finalize the release', 'check the release', 'how is the candidate doing', 'is the test period over', 'tag the final'; and — when this session's last act was a release-rung pass — the re-ping forms 'again', 'check again', or a bare 'go'. Scoped to the repo the session runs in. Separate from code-ship, which never tags."
---

# release-rung — trigger → bump → candidate → test period → final

The release rung of [`CONVENTIONS.md` §6](../../CONVENTIONS.md#6-releases) says who may cut a tag.
This skill is the coordinator that exercises it. **The commands decide; this skill sequences
them and writes the judgement they cannot.**

- [`colab release cut`](../../tools/README.md#release-cut-candidates) makes a candidate.
- [`colab release finalize`](../../tools/README.md#release-finalize) takes it the rest of the way.

Nothing here tags on its own authority, and no step works around a refusal.

**Who runs it.** A coordinator session scoped to one repo. A scheduler may *start* such a session
([*Scheduled drivers*](../../CONVENTIONS.md#scheduled-drivers--provenance-and-autonomy-meet-a-caller-that-is-not-a-person)),
but the scheduler never tags anything itself. `code-ship` never runs this skill as a side effect:
ship merges branches, and this skill cuts tags.

**Cheap to re-run, and meant to be.** There is no daemon. The test period ends while nobody is
watching, and the next run notices. Each run re-measures everything, so a run that finds nothing
new reports one line and stops.

## Where the state lives (read once, it explains every stage)

| Fact | Lives in |
|---|---|
| The candidates | annotated `vX.Y.Z-rc.N` tags on origin, made by `colab release cut` |
| The version's record | **one tracking issue per version**, title `release: vX.Y.Z`, whose body opens with `<!-- colab:release version=vX.Y.Z -->`. `colab release finalize` opens it on its first run for that version. Every rc.N of that version reuses it. |
| The human veto | the **`release-hold`** label on that issue. It is part of the convention label set, so `colab labels --ensure` creates it. |
| A regression against the candidate | a `blocked_by` edge on that issue (`colab blocked <tracking> --by <regression>`) |
| When the test period started | the later of the candidate tag's date and the issue's creation time |
| Whether trunk stayed green | re-read from GitHub's run list on every run, never stored |

The tracking issue is a **record, not a unit of work**. Never claim it, never start it, never
put it in a triage bucket as work.

## 0. Row — does this repo have a rung to walk?

**Reads:** `colab release finalize --dry --json`, first check (`release-policy`) and `row`.

**Refuses (stop, one line):**
- `no-tags` (exposure `none`/`self`): nothing consumes a tag.
- `live`: the promotion is the deploy and stays human.
- `unmatched`: fail closed, and a human tags.
- An invalid `release:` block. Report its findings verbatim.

`final: auto` vs `final: human` in the same output decides how stage 4 ends. Say which one
applies in the report.

## 1. Trigger — is a release owed, and which bump?

**First, is a candidate already in flight?** If `state` in step 0's output is `testing`, `held`,
`needs-new-candidate`, `refused` or `candidate-ready`, skip to stage 3. Never cut a new
candidate while one is `testing`: on a busy trunk that would restart the test period forever,
and the release would never finalize.

**Reads:**
- `colab release cut --dry --json`, its `suggestion` and `version` fields. It computes the
  bump since the last **final** tag from Conventional-Commit types: `fix` → patch, `feat` →
  minor.
- On a `deploy: tag` repo, also `colab release-status --json`, for the unreleased gap and its
  flag. That command answers n/a on every other repo, so it is not the source of the bump.
- The finished epics since the last final: closed issues carrying
  `<!-- colab:switch name=… role=remove -->`. A finished epic means **minor**
  ([*Switched epics*](../../CONVENTIONS.md#switched-epics--concurrent-unfinished-features-336)),
  even when the commit types alone say patch.

**Does:**
- Confirms the bump or overrides it. An override is `--bump minor --reason "epic #N switch
  removed"` (or `patch`), and the reason is recorded on the tag.
- **Reads the diff since the last final, not only its subjects**, for the breaking change the
  types don't reveal: a destructive schema change, a config-format change, an API contract
  change. A breaking change pre-1.0 ships as a minor. On a ≥1.0 repo it means **stop**: a
  major is a human decision, so report what you found and cut nothing.

**Refuses:**
- No bump owed (docs/chore only).
- A major, in any form.
- No final tag yet: the first version is a human's to choose.

## 2. Candidate — cut it, open its record, draft its notes

**Does, in order:**
1. Run `colab release cut --json`, with `--bump … --reason …` only if stage 1 overrode the
   bump. On a refusal, report every failed `condition` with its `detail`, and stop. Cut refuses
   on all of these:
   - `release-policy`
   - `prerelease-trigger` (a deploy workflow would fire on the candidate)
   - `version`
   - `already-candidate`
   - `ci-green`
   - `full-suite`
   - `schema-additive`
   - `switch-dependencies`
2. Run `colab release finalize --json`. On a new version this opens the tracking issue and
   posts the candidate's "test period starts" event. Its `state` will be `testing` (or
   `candidate-ready` on a human-final row, once everything else passes).
3. Post the release-notes draft on the tracking issue, as one comment:
   - the output of `colab release-notes <last final>..<candidate>`;
   - the bump chosen and why;
   - each breaking change found, or that none was and what was checked (§6: "put the reasoning
     in the release notes").

**Refuses:** whatever `cut` refuses. Never create or push a candidate tag any other way.

## 3. Test period — re-run, read the state, act on exactly that

**Reads:** `colab release finalize --json`, its `state`, `checks`, `periodEndsAt` and `handoff`.

**Does, by state:**

| `state` | What this skill does |
|---|---|
| `testing` | Report when the period ends (`periodEndsAt`), or which trunk run is still in flight. Stop. |
| `held` | Report who holds it and on which issue (the `release-hold` check names it). Stop. **Never remove the label, never comment asking for it to be removed.** A hold ends when a human lifts it. |
| `needs-new-candidate` | A regression was fixed after the period began, or trunk went red during it. Once the fix is on main and trunk is green, go back to stage 2. `cut` issues `-rc.N+1` of the same version (or a new version if the bump changed), and its period starts afresh. If the fix is not on main yet, report the blocker and stop. |
| `refused` | Report every failed required check. A later run may clear it (a trunk run re-run, an open regression closed). Nothing to force. |
| `candidate-ready` | Stage 4, human branch. |
| `finalized` | Stage 4, automatic branch. |
| `already-final` | Report it. The command has closed a stale tracking issue. |
| `no-candidate` | Back to stage 1. |

A regression found during the period is recorded by whoever finds it, with `colab blocked
<tracking> --by <regression issue>`. This skill may add that edge when it finds an open bug that
names the candidate. It **never clears one**.

## 4. Final

**Automatic row** (`final: auto`, only `exposure: released` with `production: null` and
`deploy: none`):
- **Does:** when stage 3 reads `finalized` in a `--dry` run, run `colab release finalize --json`
  for real. It re-checks everything at that moment. Then it tags an annotated `vX.Y.Z` on the
  candidate's commit, pushes it, and closes the tracking issue.
- **Then publish the GitHub Release:**
  - A repo carrying `templates/release-tag.yml` publishes it on the tag push.
  - On the handbook itself, run `scripts/release.sh vX.Y.Z`, which finds the tag already pushed
    and resumes from its publish-and-reconcile step.
  - Anywhere else, use §6's manual fallback line.

**Human row** (`final: human`: `deploy: tag`, `deploy: manual`, or a `release:` block that
narrowed it):
- **Does:** relay the `handoff` string from `colab release finalize --json` to the human,
  verbatim, and stop. The command has already posted it on the tracking issue. Running it is
  the human's act. It requires the human flag and `--answered-by`, pins the exact candidate
  with `--tag`, and re-checks everything before tagging.
- **Refuses:** everything past the handoff. Copy the command into the report, never into a
  shell.

## Never

- `git tag` or a tag push by hand, for a candidate or a final. The commands are the only path.
- Set the human flag yourself, or finalize a human-final row on a human's behalf.
- Remove `release-hold`, clear a `blocked_by` edge, or close a tracking issue by hand.
- Cut a major, including the pre-1.0 → `1.0.0` step.
- Cut a new candidate while the current one is `testing`.
- Run as part of `code-ship`, `code-wrap` or `code-sweep`, or promote anything.

## Report

One block per run:
- the repo and its rung row (`final: auto|human`);
- the candidate tag and the tracking issue number;
- the `state`;
- for `testing`, the period end; for `held`, `refused` or `needs-new-candidate`, each failing
  check's detail; for `candidate-ready`, the handoff command; for `finalized`, the final tag
  and where its Release was published.

A run that changed nothing since the last one says so in one line.
