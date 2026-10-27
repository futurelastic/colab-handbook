# Releases — how the CLI cuts, finalizes and publishes a release

The mechanics behind [CONVENTIONS.md §6](../../CONVENTIONS.md#6-releases). The routes, the human-only
steps and the release contract stay there as rules; how this repo's CLI and templates carry them out
lives here. Moved verbatim from CONVENTIONS.md §6 by #637 — only links were retargeted. What lives in
this directory, and why: [README](README.md).

## Process identity — the ship and promote variables

The rule: [CONVENTIONS.md §6, the permission ladder](../../CONVENTIONS.md#6-releases).

**`COLAB_SHIP` and `COLAB_PROMOTE` are process-identity assertions, not permissions — an
agent never sets either by hand, and a refusal never names one.** Unlike `COLAB_HUMAN`,
neither has any sanctioned hand-set case at all — not even solo flow's. Accordingly, every refusal on this path now names the remedy
(`colab ship`, `colab promote`) and nothing else. Why, with the measurement: [ADR 539](../../docs/adr/539-releases-routes-rationale.md).

**Closing that door required closing the corner behind it, or it would have become a
stall.** Both sessions reached for the variable while holding a completed local merge
`colab ship` could not publish — `ship` merges a *branch*, so it has no path for a commit
already sitting on trunk. Two changes remove the corner rather than seal the exit: ship's
preconditions now measure the local target against `origin/<target>` and refuse *before*
merging (behind → one fast-forward, self-clearing; ahead or diverged → unpublished commits
on a push-guarded branch, to be moved onto a session branch and shipped, human-gated), and
a failed B2 push rolls the squash back so the unpublishable state does not exist to be
cornered in. The upstream rail is [`code-wrap`](../../skills/code-wrap/SKILL.md)'s: **a distilled
doc lands on the session branch, never as a commit on the trunk checkout** — that commit is
what both sessions were trying to publish.

## The newest candidate names trunk's head (#443)

The rule: [CONVENTIONS.md §6, the release contract](../../CONVENTIONS.md#6-releases).

**The newest candidate always names trunk's head (#443).** Wherever candidates are automatic, once trunk CI is green
on `main`'s head, the newest candidate is that head: every green trunk run whose head carries no candidate cuts one, and
no route caps how many a day. A repo may still declare `release.candidates-per-day` as a **narrowing**, and it keeps the
guarantee: inside the window the run is a no-op, and the first run after the window closes — the next green CI, or the
daily scheduled run, which cuts too — cuts **the head**, never an older commit. A head that already carries a candidate is
a no-op, so the schedule re-runs safely. **A green run cuts the sha it tested (#622):** on a busy trunk something lands
during most suite runs, so the run a green CI fires cuts that run's sha (`release cut --sha`); the head gets its own when
its run is green, an out-of-order run (a later commit already a candidate) is a no-op, and a capped or final route cuts
only the head. **Finals are unchanged:** a final is still the newest candidate whose own test period is clean, so a final
lags head by at least the test period, by design. `colab release-status` reads the guarantee back and flags *head not a
candidate* when a green head has stayed untagged for longer than one CI cycle (the longest suite run at that sha). And
every candidate has a release page however it was cut: `colab release cut` publishes the GitHub pre-release itself,
notes = the summary since the last final plus the tag's own message, so a cut run outside the workflow no longer leaves a bare tag. Why, with the measurement: [ADR 539](../../docs/adr/539-releases-routes-rationale.md).

## Cutting a candidate — the four conditions

The rule: [CONVENTIONS.md §6, the release contract](../../CONVENTIONS.md#6-releases). (item 1)

**[Hard — gate: colab release cut refuses]** **A candidate is cut only when all four hold, on the exact commit it names:**

1. **[Hard — gate: colab release cut refuses]** **CI green on that commit** — every run at that sha finished and one succeeded; a
   green trunk head later on does not count for it. Only runs that verify the code count — the ship gate's rule (#503, #624).
2. **[Hard — gate: colab release cut refuses]** **The full suite passed on it** — the rule at the end of this section, over those same runs.
3. **[Hard — gate: colab release cut refuses]** **Every schema change since the last final tag is additive**
   ([*Switched epics*](../../CONVENTIONS.md#switched-epics--concurrent-unfinished-features-336), rule 5). A
   release carrying a destructive one is not a candidate an agent cuts; a human decides it.
4. **[Hard — gate: colab release cut refuses]** **Switch dependencies are satisfied**
   ([*Switched epics*](../../CONVENTIONS.md#switched-epics--concurrent-unfinished-features-336), rule 3).

## The test period, and finalizing

The rule: [CONVENTIONS.md §6, the release contract](../../CONVENTIONS.md#6-releases). (items 2 and 3)

**[Hard — gate: colab release finalize refuses]** **The test period is 3 days, and it is clean only if trunk CI stayed green throughout
and no regression against the candidate is open.** "Trunk" here is both `main`, where
candidates are cut, and the `trunk:` branch where that is a different one (`trunk: dev`,
#437). It matters only on a route whose final
is automatic (`rapid-app`, `public-tool`); `library-fast` and `deploy-tag-fast` have none. A route may lengthen it, never shorten it — save that a repo whose final is a human act may declare `test-period: 0d`, no period at all, since the human's finalize is the test (#549). A human vetoes by holding the candidate during it; a held candidate is not finalized. A human final may name **any open candidate, not only the newest** (`--tag`): an older one is finalized only once its **own** test period elapsed clean — its own window, read exactly as the automatic walk reads it — so a release never needs trunk to stop merging; the newer candidates stay open for the next version, and a version's record closes as superseded only once a final above it is tagged (#548). **The floor binds the machine, not a person who answers for the release (#627).** On a route whose final is automatic (`rapid-app`, `public-tool`), a human may finalize the **newest** candidate before its period elapses — the human bar plus an explicit early flag (`COLAB_HUMAN=1 colab release finalize --tag <rc> --answered-by <name> --early`). Only the period is lifted: trunk must have stayed green over the part of the window that has elapsed, and every other condition applies unchanged — no open regression, no `release-hold`, schema-additive, on-trunk. The tag message, the tracking issue and every "Released in" comment record the early final: who answered, and how much of the period had elapsed. The automatic walk still waits the full period, and nothing an agent sets alone shortens it. **What publishes an early final** (or any final a person tags): no run tagged it, so the next daily run (or a dispatch) of [`release-auto.yml`](../../templates/release-auto.yml) sweeps it — onto npm `latest` when npm's is older (#612), and, on a repo declaring `downloads:`, to its Release, build and downloads jobs when the site's `latest.json` is older (#669, [`docs/downloads.md`](../../docs/downloads.md#which-finals-reach-the-site--every-one-a-persons-too-669)). Routes whose final is already a human act (`deploy-tag`, including one automatic only by an operator's grant) are unchanged — the period does not bind their human final in the first place.
**Finalizing re-checks every condition above at the moment it runs** — a candidate that
was clean when cut and is not now stays a candidate. Where the final tag is a human act,
the agent's work ends with the candidate, its release notes, and the one click — number
pre-filled — that finalizes it.

## The release workflow — a trigger runs it

The rule: [CONVENTIONS.md §6, the release contract](../../CONVENTIONS.md#6-releases). (items 3 and 5)

**[Hard — gate: colab release refuses]** **A trigger runs it — not a person, and not a session.** Each repo that tags carries a
**release workflow** ([*Scheduled drivers*](../../CONVENTIONS.md#scheduled-drivers--provenance-and-autonomy-meet-a-caller-that-is-not-a-person)):
a green CI run on `main` — and the daily scheduled run (#443) — tries a candidate (`colab release cut --auto`) — on `trunk: main` every
trunk push, on `trunk: dev` the human promotion's push (#429), where the bump reads the promoted
commits and a `main` head that is not a promotion (a hotfix pushed straight to `main`) cuts
nothing: the next promotion carries it, or a human cuts it by hand — a daily run
tries to finalize clean candidates (`colab release finalize --auto`), and publishing happens
inside the same run. It may do this unattended because both commands **refuse on any
failed condition** — the route is the permission, the commands measure it, and a refusal
is the workflow's whole output. Never `colab ship` or `code-ship`, and `colab promote` only as
`--auto` where `promotion: main-loop` grants it (*Scheduled drivers*) — none of them tags. A candidate is cut by
[`colab release cut`](../README.md#release-cut-candidates) (#338), which measures the four
conditions on the commit and refuses naming each one that fails; its next step is
[`colab release finalize`](../README.md#release-finalize) (#339). The
[`release-rung`](../../skills/release-rung/SKILL.md) skill is the same sequence run by hand — the
fallback when the workflow cannot run. Either way keeps **one tracking issue per version**
(`release: vX.Y.Z`, marker `<!-- colab:release version=vX.Y.Z -->`): a human holds a candidate by
putting the **`release-hold`** label on it (only a human removes it), and a regression against the
candidate is a `blocked_by` edge on it — open, the final waits; fixed after the test period began,
a new `-rc.N+1` is owed and its period starts afresh. The final is tagged automatically only on a
route whose final is automatic, re-checking every condition at that moment; on `deploy-tag` it
stops at *candidate ready* and hands a human the one click. **Merged is not delivered** for a
repo others install, so once a final is tagged every issue the version carries — each `Closes`/
`Fixes`/`Resolves #N` in a commit since the previous final — gets one comment, `Released in
vX.Y.Z`, telling its reporter which version has the fix (#426). No agent cuts a final tag, or a
candidate, by hand around these commands. A deploy must never fire on a
candidate: [`templates/release-tag.yml`](../../templates/release-tag.yml) publishes `-rc` tags
as pre-releases, the audit flags a deploy trigger that matches one, and every
current-release read skips them.

## An operator-granted automatic final (#441)

The rule: [CONVENTIONS.md §6, the release contract](../../CONVENTIONS.md#6-releases). (item 4)

**An operator-granted automatic final (#441).** The default above stands: a final that deploys
production is a human act. The operator may choose otherwise for **one repo at a time**. The
grant is a human act, recorded the way an `autonomy` grant is, and checked on every read:

- **[Hard — gate: colab release finalize refuses]** **Recorded, never written by an agent.** The operator rules on a decision issue
  (`colab decision <N> --record --ruled-by <human>`) and the repo names it with
  [`release.final: auto` + `release.final-grant: <N>`](../../project.schema.md#release--optional).
  `final: auto` on `deploy-tag` without that line is the widening failure it always was. The
  audit reads the decision issue and **fails** a grant that is unreadable, never recorded, not
  recorded by a trusted human, or **reopened**.
- **`deploy: tag` only.** On `deploy: manual` a person runs the deploy anyway, so its final
  stays human; a grant there, or on any route but `deploy-tag`, is an audit failure.
- **Per repo, revocable at once.** Deleting the line, `final: human`, or `colab decision <N>
  --reopen` revokes it; the next `colab release finalize` reads the new state.
- **[Hard — gate: colab release finalize refuses]** **More conditions, never fewer.** On top of everything a candidate's final already needs —
  the clean test period, trunk green throughout, no `release-hold` on any open tracking issue,
  no open regression — an automatically deployed final carries **no database migration since
  the last final** unless the release itself is granted one: migration stays a human gate
  (`COLAB_HUMAN=1 colab migration-grant <tracking issue> --branch vX.Y.Z`, on the version's
  tracking issue). An unresolved grant or an ungranted migration does not refuse the release —
  it takes the automatic final away, so `finalize --auto` stops at *candidate ready* and hands
  the operator the one command, exactly as on an ungranted repo. **No migration read is not no
  migration changed (#671):** where nothing is declared in `migrations:` and neither default
  layout exists at the candidate (or its tree could not be read), the gate cannot see a
  migration at all, so it fails closed the same way — declare `migrations:`, or the final stays a
  human act. A repo with no database has no layout to declare, so its final stays one.
- **Every automatic deploy says whose choice made it so.** The final tag's message names the
  grant and its decision issue, and who ruled it.

## A final on every green head — deploy-tag-fast (#446)

The rule: [CONVENTIONS.md §6, the release contract](../../CONVENTIONS.md#6-releases). (item 4)

**A final on every green head — `deploy-tag-fast` (#446).** For a repo with nobody to test a candidate, the operator may choose route `deploy-tag-fast`: on
every green trunk head `colab release cut --auto` tags the **final** `vX.Y.Z` directly — no
`-rc`, no test period — and the release workflow deploys it in the same run. The version tags
stay; only the candidate step goes. Why: [ADR 539](../../docs/adr/539-releases-routes-rationale.md). It replaces the test period with two declarations and keeps
every gate that does not depend on one:

- **[Hard — gate: colab release cut refuses]** **The operator's grant, read exactly as #441's.** `release.final-grant: <N>` names a recorded
  decision, re-read on every run by the audit and by `cut`; unreadable, untrusted or reopened →
  no tag, and the audit fails. Deleting the line, or `route: deploy-tag`, revokes it.
- **A health-gated deploy that rolls itself back.** `release.health-url` (an `https://` endpoint
  reporting the running version) and `release.rollback: auto`. The release workflow polls the
  URL after its deploy and fails the run when the version does not appear; the rollback is the
  deploy's own, and `rollback: auto` is the operator's statement that it exists. The audit checks
  that both are declared and that the release workflow deploys what it tags; it cannot prove the
  rollback works, which is exactly why the grant is required beside it. `release.health-url` is
  the one verify key every deploy shares (#452): required here, and also legal on `deploy-tag`,
  where the container deploy below waits for it.
- **`deploy: tag` only.** Not `deploy: manual` (a person deploys anyway), not a no-production
  repo — `library-fast` keeps its meaning: nothing it tags reaches production. Missing the grant
  or the health gate, the route is an audit failure and `deploy-tag` stays in effect, final human.
- **[Hard — gate: colab release cut refuses]** **The gates that stay:** trunk CI green on the head and every other candidate condition above
  (full suite, additive schema, switch dependencies, the pre-tag checks); no open issue carrying
  `release-hold` (repo-wide — there is no candidate issue to put it on); and **no database
  migration since the last final** unless the version's tracking issue carries a migration grant
  — otherwise the run refuses, opens `release: vX.Y.Z` if needed, and posts the one human command
  (`COLAB_HUMAN=1 colab migration-grant <N> --branch vX.Y.Z`); the next green run after it tags.
- **A minimum spacing between finals.** `release.final-spacing` (default and floor `1h`; longer
  narrows) — a burst of merges deploys at most once per window. Inside it a run is a no-op, and
  the first run after it tags the head, never an older commit.
- **[Hard — gate: colab release cut refuses]** **Deployed in the same run, never by a tag-push workflow.** A tag pushed with `GITHUB_TOKEN`
  starts no `push: tags` run, so a separate deploy-on-tag workflow would never fire for this
  final. [`templates/release-auto.yml`](../../templates/release-auto.yml)'s `deploy` job deploys it
  (an edit point the adopter fills) and checks the health URL; a cut by hand refuses on this
  route, because it would have no deploy behind it. `colab release finalize` here always reports
  *no candidate*: one left over from an earlier route is superseded by the next final.

## A container deploy — one contract, two entry points (#452)

**A container deploy — one contract, two entry points (#452).** A container app on a host whose
platform has an API deploys through [`templates/deploy-container.yml`](../../templates/deploy-container.yml)
and its two scripts, on every host the same way:

1. CI builds every image the repo lists **once** per final tag (`vX.Y.Z` and the commit sha) and
   pushes it — in its own job, never gated on whether the platform is switched on.
2. A per-repo pre-deploy step (a database snapshot, say) runs next; its failure stops the deploy
   before anything changes.
3. A **platform adapter** tells the platform "run exactly `vX.Y.Z`", every image in one call.
4. The deploy is green only on a **verified running version**: the platform's own state (the
   stack settled, the commit it deployed, the image its containers run), then
   `release.health-url` reporting `X.Y.Z`. An HTTP 200 from the platform is never the evidence.
5. A failure after the platform accepted the call rolls back to what ran before (the previous
   final), checks that, and still fails the run. A manual rollback is the same workflow run with
   the previous tag. The outcome — `running vX.Y.Z at <time>`, or the failure — is recorded in the
   run summary and on the release issue when one exists.

It is the existing `deploy: tag` shape with an in-repo deploy workflow (`channels: [workflow]`).
**There is one deploy path, reached two
ways:** on `deploy-tag` a human-pushed final starts it (`push: tags`, finals only); on
`deploy-tag-fast` the release workflow's `deploy` job calls the same file through
`workflow_call` (the commented job in `templates/release-auto.yml`), because the final it tags
starts no `push: tags` run. Portainer is the first adapter; another platform is another adapter
file exporting the same functions, and a consuming workflow changes one variable. **One platform
key per app**, for a non-admin user owning only that app's stack — never an admin key. Every
server runs its own platform instance, so the configuration is that host's URL, environment and
stack, by DNS name. Every redeploy recreates the containers, even with an unchanged compose file. Why: [ADR 539](../../docs/adr/539-releases-routes-rationale.md).

## A manifest's version — version-source (#438, #484)

The rule: [CONVENTIONS.md §6, the release contract](../../CONVENTIONS.md#6-releases). (item 6)

**[Hard — gate: pre-tag check refuses]** **A manifest's version may be derivable (#438), and on an automatic route it is by default
(#484).** Under [`release.version-source: manifest`](../../project.schema.md#release--optional) the
pre-tag check refuses a tag that disagrees with any declared manifest (`VERSION`, `package.json`,
`Cargo.toml`, `pyproject.toml`) at the tagged commit, so a human bumps the manifest on trunk
first. Under `tag` the check skips a differing manifest, names it, and the tag message records it
as derivable. The repo's own release or deploy step stamps the number from the tag — on a
deploy-only ref, or at build time — **never as a commit on trunk**: the release workflow never
pushes one.

The default follows who cuts the tag. Where the machine does — automatic candidates, or a final
`release cut --auto` tags itself — it is `tag`. Where a person cuts the tag it
stays `manifest`. A declared value wins either way; the cut and the final read the same one. Why: [ADR 539](../../docs/adr/539-releases-routes-rationale.md).

**Under `tag`, any version a user sees reads the tag, never the trunk manifest.** A `--version`,
an about page, a health endpoint reporting the running version: each reads the tag or a stamp
made from it at release or build time. The handbook's own release steps already stamp — the npm
publish sets the package version from the tag before publishing, and the container deploy
receives it from the tag. An artifact that reads its trunk manifest unstamped shows the last
number someone typed, so stamp it, or declare `version-source: manifest` and bump on trunk before
every cut.

## npm on public-tool (#433)

**On `public-tool`, the same run may publish to npm (#433).** A repo opts in with
[`release.npm` + `release.npm-gate`](../../project.schema.md#release--optional) — the package directory
and the command that proves its tarball holds only what was meant to ship — and
[`templates/release-auto.yml`](../../templates/release-auto.yml)'s `npm` job then publishes every tag the
run created: a candidate `vX.Y.Z-rc.N` to dist-tag `next`, a final `vX.Y.Z` to `latest`, both with
provenance; `latest` never moves to a candidate; npm is offered on `public-tool` alone and is an audit failure on any other route.
A final a person tags (`final: human`, #612) is one no run tagged, so the daily run also hands on
the newest final on `main` when npm `latest` is older or absent (never older, never private). Four rules
hold the shape:

- **Trusted publishing (OIDC) only.** No npm token is stored, read, or offered as a fallback; the
  job refuses to run with one in its environment. npm trusted publishing does not support
  self-hosted runners, so this job runs **GitHub-hosted** even where the rest of the workflow is
  self-hosted.
- **Same run, never a tag-triggered workflow**.
- **A private repository never publishes to public npm** (#432). Visibility is not in
  `project.yml`, so the job reads it from the API and refuses a private or unreadable one.
- **It never moves git.** The version comes from the tag (the manifest carries none) and is
  stamped into the checkout, then the gate runs, then `npm publish`. If publishing fails, the tag
  stands, the Release says *tagged, not published*, and re-running the failed job publishes the
  existing tag; a version already on npm is skipped. Why: [ADR 539](../../docs/adr/539-releases-routes-rationale.md).

## Release channels — stable and next (#445)

The rule: [CONVENTIONS.md §6, the release contract](../../CONVENTIONS.md#6-releases). (item 7)

**Release channels — consumers follow `stable` or `next`, not a hand-bumped pin (#445).** Two
branches name the newest release of each kind, the git counterpart of npm's `latest` / `next`:

- **`next`** — always the newest **candidate** (`vX.Y.Z-rc.N`). `colab release cut`, automatic or
  by hand, fast-forwards it to the candidate's commit in the run that pushes the tag.
- **`stable`** — always the newest **final** (`vX.Y.Z`). `colab release finalize`, automatic or
  the human's final command, fast-forwards it to the final's commit; a later run that finds the
  version already final repairs a `stable` a dead run left behind.

**[Hard — gate: pre-push-guard hook]** **They are branches, not tags.** **Nothing else writes them:** both move **forward only**, never
forced — a channel that is not an ancestor of the new commit is reported and left alone, never
overwritten — and [`pre-push-guard`](../../templates/pre-push-guard) refuses a hand push to either
(the release commands push with their own process-identity variable, the `colab ship`
precedent). `stable` sitting on an older commit than `next` is the design, not drift. A channel
move is best-effort like the GitHub pre-release: the tag is already on the remote, so a channel
that cannot move is a warning, never a reason to undo the tag. Why: [ADR 539](../../docs/adr/539-releases-routes-rationale.md).

**What a consumer pins.** [`templates/release-auto.yml`](../../templates/release-auto.yml)'s
`HANDBOOK_REF` defaults to `stable`; a repo may pin `next` (the fast channel) or an exact version
tag (frozen — the one way to stop moving). When `stable` moves, that final's release notes say
what changed. A pinned ref the handbook does not carry — `stable` before its first final, or any
channel on a fork or mirror that lacks it — is not a failure: the fetch step falls back to the
newest final tag no older than the first final carrying every verb the template calls, else
`next`, and says so in a warning (#480). A tool installed **with npx** follows a channel the same way, with one difference:
the channel is resolved to the release tag on it before anything is installed, never installed as
a ref — a per-machine service through its `update` verb, a one-shot command through the launcher
([*Services over npx*](distribution.md#services-over-npx--init-update-rollback-465), below). Why: [ADR 539](../../docs/adr/539-releases-routes-rationale.md).

## The release summary, and the gap between merged and released

The rule: [CONVENTIONS.md §6, the release contract](../../CONVENTIONS.md#6-releases). (item 8)

**Every tag gets a release summary** — a published GitHub Release grouping commits since
the previous tag by Conventional-Commit type; `CHANGELOG.md` is not maintained by hand.
[`templates/release-tag.yml`](../../templates/release-tag.yml) automates it. When the
workflow cannot run (Actions outage, billing lock — it has happened), the summary
**is still owed**. Manual fallback, same output:

```sh
colab release-notes v1.1.0..v1.2.0 | gh release create v1.2.0 --notes-file - --generate-notes
```

**Merged is not released — measure the gap, don't wait to notice it by eye.**
`colab release-status [--repo P] [--json]` (#81) reports commits on `dev` not yet
promoted, commits on `main` past the last `v*` tag (plus days since), and flags whichever
gap holds a `fix:`-typed or breaking commit. Its suggested SemVer bump is an input, not a verdict: the coordinator
confirms or overrides it and states the reason in the release notes — it reads commit
types, so it cannot see a breaking change the types don't reveal — the computed number
(*Versioning*, above) also reads guard results and exports, and is the one a candidate
carries (pre-1.0 a major becomes a minor). Measured against `main`, never
`dev` — `git describe` from a `dev` checkout answers a stale question.
