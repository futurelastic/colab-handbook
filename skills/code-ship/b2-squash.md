# code-ship · B2 Squash-merge with `Closes #N`

Reference for [`code-ship`](SKILL.md) B2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B2. Squash-merge with `Closes #N`

**Re-check that it is still unshipped, immediately before the merge (#370).** Run B0's
already-shipped grep again against a fresh `git fetch origin <base>`. Grading and CI take
minutes, and the branch's own session may ship it in the meantime — measured on an
`auto-trunk` repository: the implementer ran `colab ship` itself 5 s before the
coordinator's verification finished. A match now means someone else landed it: **do not
merge.** Stop the merge path and go to B2a–B4 for whatever that ship left undone (evidence,
claims, worktree), naming the squash sha it landed in.

```sh
git checkout <base> && git pull
git merge --squash <branch>
git commit    # subject: type(scope): …  · body: Closes #N   (one line per issue in the group)
git push origin <base>
```

**`<base>`, every line of it.** If `<base>` is a declared line rather than trunk, the
main checkout must not be parked on it to do this — use `colab ship`, which merges in
an ephemeral worktree, or make one yourself. The at-rest invariant does not pause for
a merge. And merging that **line into trunk** afterwards is never part of a ship: it
is a human integration event of a promotion's weight.

- **`Closes #N`, not a bare `(#N)`** — GitHub only auto-closes on the keyword. We
  measured 26/30 issues left open with their code long merged because commits
  said `(#N)` (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits)).
- One `Closes #N` per issue the branch carried — the set you harvested in B1b, not
  just the "main" one.
- **This step never runs against the will of B1b's close gate.** If any harvested
  issue has an unticked `## Plan` box with no declared remainder, `colab ship` has
  already refused before reaching this step (#263, B1b above) — do not hand-write
  `Closes #N` around that refusal; resolve it the way B1b describes, then re-run.
- **A long-lived tracking/memory issue is `Refs #N`, not `Closes #N`.** If the branch
  claimed an issue used as external memory for a whole domain — a checklist of still-open
  items you touched but did not complete — reference it, don't close it, or you bury its
  knowledge behind a closed-issue lookup (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#tracking-issues--claimed-but-referenced-not-closed), *Tracking issues*). Through
  the blessed door this is automatic for an issue carrying the `tracking` label, or opt in
  per-ship with `colab ship --refs <N>`; the claim is still released either way. A
  `--refs`'d issue kept open for a non-code leftover gets its hold in this same step
  (B1b above, #385). A leftover that is only a check a person must run does not keep
  the issue open: close it and add a row to the `Human verify:` issue (B1b above, #491).
  `--refs` plus a hold stays for a code remainder and for `tracking` issues. A
  `tracking`-labelled one needs no hold. When
  that issue is finished later — its live check passed, its last item done — close it
  with `colab close <N> --comment "<evidence>"`, never a bare `gh issue close`: the bare
  close leaves any claim standing and tells no observer, which kept a closed issue
  offered as startable for ~10 minutes (#381).
- **A core-path branch pauses here instead of merging — `⏸ PR-PENDING`, exit 3 (#350).**
  When the target's `CODEOWNERS` names an account other than the author and the branch
  touches a path it covers, `colab ship` pushes the branch, opens a PR (or reuses the open
  one), and stops. Nothing is merged, and the claims, worktree and branch are kept
  (`CONVENTIONS.md` [§2, *Core paths*](../../CONVENTIONS.md#core-paths--a-pr-and-a-non-author-approval-before-landing-350)).
  - This is a pause, not a failure. Do not run B2a–B4. Post one comment on each carried
    issue linking the PR, then stop.
  - Resume by re-running the same `colab ship` once an account other than the author has
    approved the branch's **current** head. It lands by the ordinary squash and closes the PR.
  - Never press the PR's merge button, and never approve with the author's own account:
    the forge refuses the second, and the first skips every gate ship re-checks.
  - B1c's grade still runs before the PR is opened: a reject never reaches the pause.
  - Every squash also carries a `Machine: <label>` trailer ([§4](../../CONVENTIONS.md#4-branches-and-commits)).
- **A repo declaring `owner:` lands exactly as above — onto trunk, never onto the owner's
  branch (#394).** `trunk:` there is the fleet's integration branch; the owner's branch is
  reached only by `colab deliver`, a separate step that opens or refreshes ONE pull request
  from trunk and never merges it (`CONVENTIONS.md` [§9, *Working in a repo you don't own*](../../CONVENTIONS.md#working-in-a-repo-you-dont-own)).
  - It is not part of Phase B and never runs from here. Opening or editing that PR is a
    human's act; this skill's go-ahead is for the trunk merge, not for an outward act on
    the owner's repo.
  - Your issues close on the trunk landing, as everywhere. After the ship, say in the
    report that the work now waits on delivery, and give `colab deliver --dry`'s state line.
  - `colab ship` and `colab promote` refuse a target that is `owner.branch`. That refusal is
    final: do not route around it.
    Leave it in place, and do not add it back where ship left it out. On a public repository,
    or one whose visibility ship could not read, it is omitted on purpose (#367). A commit
    message is permanent, and that label is a hostname. `--dry` prints which way it will go.
- **Machine-specific trunk-side automation runs itself — `.colab/hooks/post-ship`.**
  Migrate the trunk DB, restart the trunk dev server, re-install dependencies: `colab
  ship` runs that hook on the trunk checkout right after the push, so this is no longer
  a step you perform by hand. It is the one moment trunk may go down; keep the window
  short. A non-zero hook is a warning, never a failed ship — the merge already landed,
  so **never re-run `ship` because the hook complained**; finish what it does by hand
  and leave the trunk checkout clean.
- **A merge that changed a dependency lockfile leaves the trunk checkout stale, and
  that is not cosmetic (#304).** The squash lands *in the shared trunk checkout*, and
  nothing re-installs `vendor/`/`node_modules/` afterwards — so a merge adding a
  Composer/npm package leaves an installed tree that disagrees with its lockfile.
  Anything regenerating committed output from that tree (a route-binding generator, an
  always-on dev server) then deletes those committed files, and the resulting dirty
  trunk blocks **every other session's ship**, including ones whose diff touched
  nothing related. With no `post-ship` hook, `colab ship` warns and names the install
  command; `colab` never runs a package manager on a checkout itself. If you see that
  warning, run the install before you walk away.
