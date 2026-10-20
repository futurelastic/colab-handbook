# The GitHub binding

How each word of the [glossary](../CONVENTIONS.md#glossary) is written down on GitHub: the
exact label names, the exact comment lines, and the native features that carry the rest. It
answers one question — *how do I follow these conventions on GitHub by hand?* — so that a
person typing into the web UI, a script calling `gh`, and the `colab` CLI all leave the same
marks, and every reader (CLI, audit, dashboards) sees the same thing.

This file is not normative. [`CONVENTIONS.md`](../CONVENTIONS.md) decides what each record
means and when to write it; this file only says what it looks like on one issue engine.
Bindings for other issue engines follow the same shape.

## How to read this file — and what is checked

Every string a tool parses is shown in a fenced block whose info string is
`wire <section>`, where `<section>` is a section of the codec's golden samples,
[`tools/lib/codec/samples.json`](../tools/lib/codec/samples.json). `wire <section> not`
marks a line in a *looser* shape that readers deliberately do **not** accept — shown so you
can tell the two apart.

- In a `wire labels` block, each line is one label name.
- In every other block, the whole block is one comment (or one body line), byte for byte —
  emoji, the ` · ` separators and the backticks included. Copy the shape; the field values
  (branch, host token, timestamp) are examples.

`node scripts/check-github-binding.mjs` fails when this file and the samples disagree: a
block that is not a sample, a `not` block that is a sample readers accept (or the reverse),
a sample section this file never shows, or a convention label missing here. Prose and
tables are not checked. Words with no tracker string at all (trunk, commit, a CI result…)
are marked **prose only** below.

Host tokens (`h:…`), machine tokens (`m:…`) and `OWNER/REPO` are scrubbed placeholders. On
a real issue `colab` writes its own; by hand, write the same shape with yours.

---

## trunk · branch · commit — prose only

- **trunk** — the branch named by `trunk:` in `.github/project.yml`; usually the repository's
  default branch, or `dev`. Never a branch literally named `trunk`.
- **branch** — a git branch whose name matches
  `^([a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*/)?(feat|fix|docs|chore|refactor|test|perf|design)/[a-z0-9._-]+$`
  and ends in its issue number(s): `feat/onboard-redesign-23`, `fix/import-fixes-115-114-113`.
  The source of truth is `BRANCH_RE_SOURCE` in [`tools/lib/branch-name.js`](../tools/lib/branch-name.js).
- **commit** — a git commit with a Conventional Commits subject (`feat:`, `fix:`, `docs:` …).
  The squash commit that lands on trunk says `Closes #N`, one per issue it carries — a bare
  `(#N)` does not close anything.

## change request — prose only

A pull request. Required only where a rule asks for one (core paths); otherwise a branch is
squash-merged straight onto trunk.

## CI result — prose only

A GitHub Actions workflow run, read **by commit**: every run at the branch's head sha has
finished and one succeeded (`gh run list --commit <sha>`). Never "the latest run on the
branch" — a cancelled straggler can outrank a passing run on the same commit.

## issue

An issue. Its state is carried by labels and by comment records.

**Labels** — the convention set, created once per repo (adoption provisions them, except
the opt-in `graph-empty`; by hand, `gh label create <name>`). `delivery:`, `deferred:`, `review-by:` and `group:` are
families; the values shown are the members readers know, and `review-by:` takes any real
date, `group:` any key.

```wire labels
in-progress
deps-checked
agent-filed
epic
needs-decision
decision-recorded
needs-plan
migration-granted
ci-granted
low-priority
priority:now
priority:high
release-hold
graph-empty
delivery:code
delivery:docs-only
delivery:design
deferred:date
deferred:external-party
review-by:2026-10-16
group:trunk-ci-verdict
group:ship-worktree-checkout
```

Anything else (`bug`, `good first issue`, a `delivery:` value outside the list) is the
repo's own label: allowed, but no convention reads it.

**Close reason** — GitHub's native close reason (`completed` / `not planned`) is the record.
Where it cannot be set, the closing comment carries it as a marker, or as a visible line:

```wire closeReasons
<!-- colab:close-reason reason=completed -->
```

```wire closeReasons
Close reason: completed
```

**Decision** — a `needs-decision` question is answered by one comment that starts with the
record line, and may carry the ruling below it. Then `decision-recorded` replaces the label.

```wire decisions
⚖ Decision recorded — ruled-by `maintainer` · answers `-` · host `h:ee4bcb5b2678` · 2026-10-04T17:02:50.350Z
```

A later comment can supersede every decision before it:

```wire decisions
↩ Decision reopened — ruled-by `maintainer` · host `h:ee4bcb5b2678` · 2026-10-05T01:00:00.000Z — every decision on this issue up to this point is superseded.
```

**Grants** — a human's per-branch exemption, one comment each, plus its label
(`migration-granted`, `ci-granted`). Write them with `colab migration-grant` / `colab ci-grant`; the shapes are:

```wire grants
🛢 Migration grant — branch `feat/import-schema-163` · host `h:ca0012aa6308` · 2026-10-05T09:41:02.118Z — this exempts THIS BRANCH only, and expires when this issue closes.
```

```wire grants
🚫 Migration grant revoked — branch `feat/import-schema-163` · host `h:ee4bcb5b2678` · 2026-10-05T10:02:11.004Z — every grant on this issue up to this point is cancelled.
```

````wire grants
🔎 Migration review grant — role `migration-reviewer` · reviewer `reviewer-a` · branch `feat/import-review-163` · head `2cb7d1676757563c7b5867a87beefcdfcd346523` · host `h:ca0012aa6308` · 2026-10-05T09:55:45.236Z — bound to this HEAD: any new commit voids it; expires when this issue closes.

```migration-review
v: 1
role: migration-reviewer
reviewer: reviewer-a
head: 2cb7d1676757563c7b5867a87beefcdfcd346523
verdict: approve
checklist: pass
checklist-items: 10/10
escalation: none
escalation-result: clear
ci-roundtrip: pass
ci-run: 18270000001
```
````

```wire grants
🚨 Red-trunk CI grant — branch `ci/release-runner-92` · red `main`@`5dacb6f0ada39dc194f55b0bd80e408044c4af3e` · evidence `3d7f6b87989a337870bdf7c03384a296f797a511` · host `h:ee4bcb5b2678` · 2026-10-04T04:25:21.914Z — this exempts THIS BRANCH from the trunk-CI-green precondition ONLY, only while `main` is still at `5dacb6f0ada39dc194f55b0bd80e408044c4af3e`, and expires when this issue closes.
```

```wire grants
🧯 Red-trunk CI grant revoked — branch `ci/release-runner-92` · host `h:ee4bcb5b2678` · 2026-10-04T05:00:00.000Z — every grant on this issue up to this point is cancelled.
```

````wire grants
🩹 Red-trunk CI review grant — role `ci-reviewer` · reviewer `reviewer-b` · branch `fix/trunk-red-audit-212` · head `4f2a9c1e7b3d5a6f8e0c2b4d6a8f0e1c3b5d7a9f` · red `main`@`9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d` · host `h:ee4bcb5b2678` · 2026-10-05T16:20:31.507Z — bound to this HEAD and this red trunk sha: a new commit on either voids it; expires when this issue closes.

```ci-review
v: 1
role: ci-reviewer
reviewer: reviewer-b
head: 4f2a9c1e7b3d5a6f8e0c2b4d6a8f0e1c3b5d7a9f
red: 9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d
verdict: pass
cures: CI / test (ubuntu-latest, 22); CI / self-audit
ci-run: 18290000042
```
````

## parent / child

**Native sub-issues** are the record: add each child to the parent's *Sub-issues* list
(`gh api repos/OWNER/REPO/issues/<parent>/sub_issues` with the child's database id), and
label the parent `epic` — a container, never a start candidate. No string to parse, so
**prose only** on GitHub.

Where native sub-issues are unavailable (an older server, a cross-repo child), the child's
body carries its parent as a marker or a visible line:

```wire parents
<!-- colab:parent issue=#496 -->
```

```wire parents
Parent: #496
```

```wire parents
<!-- colab:parent issue=OWNER/REPO#12 -->
```

## depends on — prose only

GitHub's native **issue dependency**: on X, "Blocked by" Y
(`gh api repos/OWNER/REPO/issues/<X>/dependencies/blocked_by` with Y's database id, or `colab blocked <X> --by <Y>`).
Only for "X needs Y's output" — never for two issues that merely touch the same file, and
never pointing at an epic. The edge stays after Y lands; readiness is computed from it.

## hold · holder

A **claim** holds an issue: assignee + the `in-progress` label + one comment. The
`session` field names the **holder**; it is optional, and a claim without it reads as owned
but untraceable.

```wire claims
🔒 Claimed — worktree `ci-wait-495` · branch `feat/ci-wait-495` · host `h:ee4bcb5b2678` · 2026-10-05T11:02:52.482Z · machine `m:a873b2982c1d` · session colab-handbook-495
```

```wire claims
🔒 Claimed — worktree `colab-remote-name-301` · branch `fix/colab-remote-name-301` · host `h:ca0012aa6308` · 2026-09-01T11:02:03.931Z
```

Releasing it removes the assignee and `in-progress`, and posts:

```wire releases
✅ Released
```

When two claims race, the later one yields to the earlier and says whose won:

```wire releases
✅ Released (yielded — earlier claim by user-a@h:48773651d08a wins)
```

A **place-claim** holds a checkout, not an issue: a ref `refs/claims/<branch>` pushed to
the remote. No comment, so **prose only**.

A **park** holds an issue until its wake condition: the label (`deferred:*`,
`blocked:needs-<owner>`, `needs-decision`…) plus one comment of two lines — ` — owner: `,
optional ` — shape: task|wait|ask`, ` — wake: ` (a `review-by:<date>`, `ruling`, an issue,
`issueClosed:OWNER/REPO#N`, comma-separated), then `Because:`.

```wire holds
Hold: blocked:needs-maintainer — owner: maintainer — shape: task — wake: ruling
Because: run the signing script on the release machine; only the maintainer holds the key.
```

```wire holds
Hold: deferred:external-party — owner: upstream maintainers — shape: wait — wake: issueClosed:OWNER/REPO#22, review-by:2026-11-02
Because: the design mirrors one still open upstream.
```

```wire holds
Hold: needs-decision — owner: @maintainer — shape: ask — wake: ruling
Because: pick the import model; the options block in the body recommends A.
```

Commas instead of ` — ` separators is not a hold record — readers ignore it, and the issue
reads as stalled:

```wire notHolds not
Hold: deferred:external-party, owner: upstream (the design this mirrors). Wake: review-by:2026-11-02, or sooner if upstream settles.
```

## release

A tag (`v1.2.3`; a candidate `v1.2.3-rc.1`), or a merge into `main` — as `exposure`
decides. `release-hold` on an issue keeps it out of the next cut. One tracking issue per
version, whose body **starts** with:

```wire releaseMarkers
<!-- colab:release version=v0.1.6 -->
```

The marker anywhere but the body's first line does not make a tracking issue:

```wire releaseMarkers not
Finalize keeps one tracking issue per version; its body starts <!-- colab:release version=v0.1.6 --> and nothing else counts.
```

Each shipped issue gets an event comment when a candidate is cut and when the final lands:

```wire releaseMarkers
<!-- colab:release-event candidate=v0.1.6-rc.1 -->
```

```wire releaseMarkers
<!-- colab:release-event released=v1.8.3 -->
Released in **v1.8.3** (`3e2f810`).
```

## lane

An issue's lane is its `delivery:*` label (above). CI's light and heavy lanes are
workflows, triggered differently — **prose only**.

## evidence — prose only

An issue comment posted before close: the trunk sha, a `file:line`, and what was checked.

## issue engine · agent runtime — prose only

The issue engine here is GitHub Issues. The agent runtime is whatever runs the skills; it
leaves no mark of its own on GitHub.
