# code-triage · §3 The one-branch question — a second live branch is a finding

Reference for [`code-triage`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


The group you just persisted is **one unit of work** (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#grouping--issues-that-must-share-one-branch), *Grouping*).
So before §6 can offer anything for it, ask whether it already has a live branch — and
whether it has **more than one**. Two live branches in one group is the collision §3
computed the group in order to prevent, arriving anyway.

**Run this for every group with two or more open members, whatever bucket its members
land in.** Not only the ready ones: in the measurement behind this rule every member was
*claimed*, so the whole group would otherwise disappear into §6's `taken` bucket with no
complaint. This is a group-level question, which is why its output is a finding rather
than a sixth issue bucket — every open number still ends the pass in exactly one bucket.

**Run §3's removal rules first, not after.** A spent or contradicted `group:` label makes
unrelated refs look like siblings; the check is only ever as good as the group record.

#### Three measurements decide the shape

Taken in this checkout, 2026-09-06 — each one kills an obvious-looking rule:

- **`colab holders <path>` alone over-reports catastrophically.** `colab holders
  skills/code-triage/SKILL.md` returns **6 refs, every one `unknown`** ("commits ahead AND
  a diff, but no content answer"), and all six belong to **closed** issues (#268 #262 #250
  #247 #242 #244) — spent local refs whose base moved on under them. A rule that counted
  `unknown` as live would report six second branches on a group that has none, on every
  pass. **A finding that always fires means nothing.**
- **Content classification is blind to the exact case this rule is about.** A second
  session's brand-new branch has no commits yet, and `colab landed` answers a *content*
  question: measured on this very session's branch at creation —
  `fix/group-second-branch-finding-316`, 0 commits ahead of `main` — the verdict is
  **`landed`**, "merging the branch would not change the base tree". So every
  content-based check drops precisely the branch you are hunting. The primary detector
  must be **ref existence**, never content.
- **A fresh second branch is often local-only, so §0 input 5 cannot see it either.** That
  same branch had no `refs/remotes/origin/**` ref at all until it was first pushed, and
  input 5 enumerates only remote refs. Both nets below are needed, and each must name what
  the other misses.

#### The check — existing primitives, in this order

1. **Primary — ref existence, name-keyed. Local git, zero network calls.** Enumerate
   `refs/heads/**` and `refs/remotes/origin/**`, take each ref's **trailing** number run
   (the same convention §3 writes and §5.1 reads), and keep the refs whose numbers
   intersect this group's **open** members:
   ```sh
   MEMBERS="$GITDIR/.triage-members.tmp"          # same $GITDIR scratch pattern as §0 input 5
   gh issue list --label "group:$KEY" --state open --json number -q '.[].number' | sort -u > "$MEMBERS"
   git for-each-ref 'refs/heads/**' 'refs/remotes/origin/**' --format='%(refname:short)' \
     | grep -vE '^(HEAD|origin/HEAD|<trunk>|origin/<trunk>|dependabot/)' \
     | sed 's|^origin/||' | sort -u \
     | while read -r R; do
         # the WHOLE trailing run, not just the last number — `code-ship` B1b's extraction
         HITS=$(printf '%s' "$R" | grep -oE '(-[0-9]+)+$' | tr -- '-' '\n' \
                | grep -E '^[0-9]+$' | sort -u | grep -xFf "$MEMBERS" | wc -l | tr -d ' ')
         [ "${HITS:-0}" -gt 0 ] && echo "$HITS $R"      # member count, then ref
       done | sort -rn
   rm -f "$MEMBERS"
   ```
   **Extract the whole trailing run, never just the last number.** `grep -oE '[0-9]+$'`
   alone reads `fix/import-fixes-115-114-113` as issue 113 only, so the moment #113 closes
   the carrier stops matching its own group and the check reports the group as branchless.
   `code-ship` B1b already had to solve this; use its extraction, not a fresh one. The
   printed count is also exactly what the carrier rule below ranks on, so the two cannot
   drift apart.

   **The open-member filter is what drops all six false positives above** — without
   needing to classify content at all. **Do not widen §0 input 5 to do this job**: input 5
   is a fingerprint input, and changing what it reads changes every stored digest, forcing
   a full pass in every repo. Read the refs a second time here; it is local and free.
2. **Classify each candidate for the report, not for the filter.** `colab landed --branch
   <ref>` gives `cargo` (live work) · `landed` (either genuine squash-merge tracker lag —
   route it to §2's already-shipped path — or a zero-commit fresh branch, told apart by
   `git rev-list --count origin/<trunk>..<ref>`) · `unknown` (treat as live, and say so).
   A candidate counts as a second branch **because its ref exists on an open member**, not
   because it has commits.
3. **Second net — path-keyed, for a branch whose name carries no member number.** Run
   `colab holders <p>` for each path `p` in this group's own `Because:` line, re-quoted
   from the current tree as §3 already requires. Fold in **`cargo` rows only**. Put
   `unknown` rows on a separate advisory line with their reason — never count one as a
   second branch on its own (measurement 1). `holders` fetches first and exits 2 rather
   than report "clean ground" off a stale read: report that refusal as `contention
   unknown`, never as one branch. A `Because:` line naming no path at all (a subsystem
   judgement rather than a file) yields `contention: unknown — group evidence names no
   path`.
4. **On a coexistence repo, a live unit is not always a branch.** Where the repo does not
   declare `writes: isolated`, an attended trunk-direct session holds the group's ground
   with a **place-claim** and no branch — `colab places` (filtered to this repo's path;
   it prints `[live]`/`[DEAD]`, the holder session and an age) is the primitive. One
   place-claim and zero branches is the group being worked *correctly*; a place-claim
   **and** a branch is two live units and reports as the finding. So this check can never
   be written as "count branches" alone.
5. **Fail toward the finding.** An `unknown` candidate, a refused `holders`, or a pathless
   `Because:` line all report as *cannot tell* — never as "one branch, all clear".
6. **Cost.** Zero added network calls — §0 input 1 already fetched — and a handful of local
   git invocations per group, only on a pass that proceeds. #244 made call count a
   first-class concern; this check does not spend against it.

#### Carrier and rebase order — mechanical, so a re-run prints the same answer

The **carrier** is the ref whose trailing number run covers **the most** of the group's
open members: it is the ref closest to the group's own contract, so landing it converts
the most members and leaves the fewest rebases behind. Tie-break on the **older head
commit** (it has waited longest, and is likeliest already wrapped), then on ref name, so
the order is reproducible rather than a matter of taste. The remaining branches are listed
in descending member count; each rebases onto the new trunk sha **after** the carrier
lands.

**Triage reports this order. It never performs it.** Rebasing, pushing, deleting a ref or
editing a branch are not among §0.2's eight authorised writes, and they are not writes this
skill may invent — see §6 for the printed shape, and `code-ship` B0 for the half that
actually does the landing.
