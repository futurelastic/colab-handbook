# Quick reference — the commands behind the conventions

Moved verbatim from [`CONVENTIONS.md` §11, *Quick reference*](../../CONVENTIONS.md#11-quick-reference) by
#640: every line is a `gh`, `git` or `colab` command, so it belongs with the tool, not with the rules it
serves. A section reference (`§5`, `§6`) still means a section of `CONVENTIONS.md`.


```sh
# starting work
gh issue list --label in-progress                 # what's taken
gh issue list --label agent-filed                 # filed by an agent — no human approved it yet
gh issue list --label epic                        # a container for sub-issues — never a start candidate
gh issue list --label group:<key>                 # must share one branch — start them together
gh issue list --search "label:delivery:content,delivery:ops,delivery:elsewhere"  # non-code-here — route, don't start
gh issue list --label delivery:design             # a new surface's design artifact — a design session's work, never a code start
gh issue list --search "label:deferred:date,deferred:measurement,deferred:external-party"  # parked — each must name a wake condition
gh issue edit N --add-assignee @me --add-label in-progress
git fetch origin <trunk> && git checkout -b [<login>/<machine>/]feat/<slug>-N origin/<trunk>   # cut from a FRESH origin/<trunk>, never local trunk; prefix only under branchPrefix: machine

# editing a file that already exists — who else is holding it, by file not by issue
# fetches first, filters spent branches out via `landed`, and REFUSES (exit 2) to answer
# "clean ground" if it could not fetch — an empty result off stale refs is a wrong answer
colab holders <path>

# finishing work
colab landed --worktree <name>                    # landed → teardown, cargo → merge
git checkout <base> && git merge --squash feat/<slug>-N   # base = trunk, or a declared line
gh issue edit N --remove-assignee <claimer> --remove-label in-progress   # both halves — one alone is a half-claim; <claimer> = @me only if you claimed it (§5)

# releasing — exposure: released (legacy tier A; who tags follows §6's release routes)
git checkout main && git merge --no-ff dev && git push   # --no-ff, never squash
colab release cut                                        # candidate v1.3.0-rc.N — refuses unless §6's four conditions hold
git tag v1.3.0 && git push origin v1.3.0                 # final — automatic after 3 clean days where nothing deploys;
                                                         #   a human act where the tag deploys (deploy: tag / manual)
# the number is computed (majors too, with a migration section); its reasoning goes in the release notes
```
