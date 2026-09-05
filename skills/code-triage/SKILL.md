---
name: code-triage
description: "Decide what to work on next in ONE repo. Takes every open Issue, discards the ones already shipped and the ones someone else holds, groups what must move together (issues touching the same files must serialize — usually one branch, or a place-claim on any repo not declaring writes: isolated), orders what remains by blast radius, and says which groups can be started RIGHT NOW — including whether the repo's trunk CI is alive enough to merge into. Outputs claim + branch commands that feed straight into code-start. A group is ONE unit of work, so a second live branch across its members is reported as a finding naming the carrier branch and the rebase order — never offered as a second spawn. Flags a group judged genuinely hard with a needs-plan label + one-line reason, for code-plan to draft against later — never a plan of its own. Also asks, per ready group, whether the work is batch-mechanical with a usable oracle, and tags the minority that qualifies with a mechanical-lane label + suggested batch size, for a cheap mechanical-work engine to pick up — never routes or dispatches it itself. Cheap to re-run only when §0 is honoured first: a five-input fingerprint compare that ends a genuine no-change ping in three calls — a convention the executing agent follows, not a gate anything enforces, so every run opens by naming which §0 outcome it took (unchanged / changed:<inputs> / no usable cache). Trigger phrases: 'what should I work on', 'triage the issues', 'what can we start', 'plan the next session', 'group the open issues', 'what is ready to pick up', 'sort the backlog'; and — when this session's last act was a triage — the re-ping forms 'again', 'anything new?', 'check again', 'anything to pick up yet?', or a bare 'go'. Runs before code-start; pairs with code-start and code-wrap."
---

# code-triage — what should we work on next?

Runs **before** [`code-start`](../code-start/SKILL.md), on **one repo**. Its output is
a short ranked list of *groups* you could open a session on today, plus an honest
account of why everything else is not on it.

`code-triage` → `code-start` → `code-wrap`.

## Principle — an open Issue is a claim about the world, not a queue

Trackers drift behind trunk, always in the same direction: work gets done and the
Issue stays open. Measured on one fleet: **26 of 30 issues sat open with their code
long since merged** (commits said `(#N)`, which does not auto-close, instead of
`Closes #N`), and **4 of 9 sessions in a single day burned an agent** discovering the
work was already shipped.

So triage that skips verification is worse than no triage: it hands someone a
confident, wrong plan. **Every candidate gets checked against the code before it
reaches your list.**

## 0. Has anything changed? — ask before doing anything else

This skill was built to run once, be read, and end. It is now **pinged on a loop**: a
long-lived session per repo, re-run whenever it goes idle. A full pass on a ~30-issue
backlog is roughly 35-60 network calls and ~60 local ones. On a re-run 30 minutes later
with no new commits, issues or claims, **about 4 of those ~50 carry new information** —
the gather, the shipped-verification, the grouping and the ordering are pure functions of
inputs that did not move, and re-derive a byte-identical answer.

So the first thing this skill does is decide whether it needs to run at all.

**Measured, #244: this was not happening.** A six-week census of one adopting fleet found
code-triage's median run cost **24 tool calls (p90 40) over 1,722 runs** — 8x the
documented three — and code-sweep's median was **27 (p90 59) over 372 runs**. Neither
gap was read amplification (0 median duplicate file reads) or the skill body reloading
mid-run (well under one `Skill` invocation per run). Two causes, both fixed below: inputs 2
and 5 were broad enough to read "changed" on nearly every ping (a bare comment; any push
to any branch, including `code-wrap`'s routine backup push), and — found only once this
was traced against a real checkout — **the persisted record itself had no specified
shape**, so two model-executed runs stored two different partial things and the "cache is
never an authority" rule then correctly forced a full pass regardless of what moved. A
third cause is not fixable from inside this repo at all: nothing outside the executing
agent's own compliance verifies §0 ran, so a skipped §0 and a §0 that ran and found
genuine change are indistinguishable in a transcript. §0 below narrows what it can, and
gives the third cause a receipt instead of pretending to enforce it — see the outcome-line
and cache-record requirements after the fingerprint.

**The fingerprint — five inputs, three network calls:**

```sh
GITDIR="$(git rev-parse --path-format=absolute --git-common-dir)"
CACHE="$GITDIR/colab-triage.json"
REPO="$(dirname "$GITDIR")"      # the MAIN checkout — see the note on input 4

git fetch origin --quiet && git rev-parse origin/<trunk>          # 1. trunk sha

OUT2=$(gh issue list --state open --limit 100 --json number,state,title,body,labels \
  -q '"N2 \(length)", (.[]|"I \(.number) \(.state) \([.labels[].name]|sort|join(","))\t\(.title)\t\(.body|@base64)")')
                                                                    # 2. backlog digest — network call now,
                                                                    #    receipt/digest decided below once input 3's TOTAL is in hand
NWO=$(gh repo view --json nameWithOwner -q .nameWithOwner)        # 3. dependency digest
OUT=$(gh api graphql -F owner="${NWO%%/*}" -F name="${NWO##*/}" -f query='
  query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){
    issues(states:OPEN,first:100){ totalCount pageInfo{ hasNextPage }
      nodes{ number blocking(first:1){ totalCount }
        blockedBy(first:20){ totalCount nodes{ number state repository{ nameWithOwner } } } } } } }' \
  -q '"COV \(.data.repository.issues.totalCount) \(.data.repository.issues.nodes|length) \(.data.repository.issues.pageInfo.hasNextPage)",
      (.data.repository.issues.nodes[]|"DEP \(.number):\(.blockedBy.totalCount):\(.blocking.totalCount)"),
      (.data.repository.issues.nodes[]|. as $i|.blockedBy.nodes[]|"BY \($i.number) \(.repository.nameWithOwner)#\(.number) \(.state)")')

COV=$(printf '%s\n' "$OUT" | grep '^COV ')                        # ← the read's own receipt
read -r _ TOTAL FETCHED MORE <<< "$COV"                           # zsh: never `set -- $COV`
if   [ -z "$COV" ]; then echo "REFUSING to digest: dependency read returned nothing → full pass"
elif [ "$TOTAL" != "$FETCHED" ] || [ "$MORE" != false ]; then
     echo "TRUNCATED: $FETCHED of $TOTAL open issues → paginate, full pass (so do inputs 2 and §1)"
else printf '%s\n' "$COV" "$(printf '%s\n' "$OUT" | grep -e '^DEP ' -e '^BY ' | sort)" \
       | shasum -a 256 | cut -c1-16
fi

N2=$(printf '%s\n' "$OUT2" | grep '^N2 ')                         # ← input 2's own receipt
read -r _ N2COUNT <<< "$N2"
if   [ -z "$N2" ]; then echo "REFUSING to digest: backlog read returned nothing → full pass"
elif [ -z "$COV" ] || [ "$N2COUNT" != "$TOTAL" ]; then
     echo "TRUNCATED: $N2COUNT open issues read, $TOTAL reported by input 3 → full pass"
else printf '%s\n' "$(printf '%s\n' "$OUT2" | grep '^I ' | sort)" \
       | shasum -a 256 | cut -c1-16                                # 2. backlog digest
fi

python3 -c 'import json,os,sys                                    # 4. claim digest (local, 0 calls)
r=os.path.realpath(sys.argv[1]); s=json.load(open(os.path.expanduser("~/.colab/state.json")))
print(sorted(k for k,v in s.get("claims",{}).items() if os.path.realpath(v["repo"])==r),
      sorted(n for n,w in s.get("worktrees",{}).items() if os.path.realpath(w["repo"])==r))' "$REPO"

OPEN=$(printf '%s\n' "$OUT2" | grep '^I ' | awk '{print $2}' | sort -u)   # open issue numbers, free — already in hand from input 2
git for-each-ref 'refs/remotes/origin/**' --format='%(refname) %(objectname)' \
  | awk '{n=$1; sub("refs/remotes/origin/","",n); print n, $2}' \
  | grep -vE '^(HEAD|<trunk>|dependabot/)' > "$GITDIR/.triage-branches.tmp"
MATCHED=""
while read -r NAME SHA; do
  NUM=$(printf '%s' "$NAME" | grep -oE '[0-9]+$') || continue      # trailing number run — same convention §3 writes, §5.1 reads
  printf '%s\n' "$OPEN" | grep -qx "$NUM" || continue               # only branches carrying an OPEN issue number
  AHEAD=0
  [ "$(git rev-list --count "origin/<trunk>..origin/$NAME")" -gt 0 ] && AHEAD=1
  MATCHED="$MATCHED
B $NAME $AHEAD"
done < "$GITDIR/.triage-branches.tmp"
TOTALREFS=$(wc -l < "$GITDIR/.triage-branches.tmp" | tr -d ' ')
MATCHEDCOUNT=$(printf '%s\n' "$MATCHED" | grep -c '^B ')
echo "B5 $TOTALREFS $MATCHEDCOUNT"                                 # ← the read's own receipt — empty match is a legitimate state, not a failed one
printf '%s\n' "$(printf '%s\n' "$MATCHED" | grep '^B ' | sort)" \
  | shasum -a 256 | cut -c1-16                                     # 5. session-branch digest (local, 0 calls)
rm -f "$GITDIR/.triage-branches.tmp"
```

All five equal to the stored run ⇒ **report `nothing has changed since <ts>`, re-print the
stored conclusion (§0.1), and stop.** Three calls instead of fifty. Input 2 is not an extra
cost on a run that *does* proceed — §1 needs that list anyway.

**Every run — short-circuited or not — opens by printing exactly one of three outcome
lines, before anything else.** This is the one thing #244 established a docs repo actually
*can* ship toward "verified to have fired": not an enforced gate (nothing here executes a
skill), but a spoken, greppable receipt that turns "did §0 run" from an invisible
compliance question into a line any reader — human, an orchestrator's transcript scan, a
later census — can check for.

```
§0 unchanged since <ts> · fingerprint <16hex> · 3 calls — re-printing stored conclusion (scope: <scope>)
§0 changed: <input names that moved, e.g. trunkSha,branches> — full pass
§0 no usable cache: <missing | version <v> unrecognised | unparseable | truncated | empty read on input <n>> — full pass
```

The third line is the load-bearing one — it is what separates *cold cache* from *genuine
change*, the exact distinction a transcript census cannot make from a bare "full pass". A
run printing none of the three did not run §0 as specified; §6's report and every write
below still happen, this is purely an addition at the top.

- **Where the cache lives, and why not `~/.colab/`.** `--git-common-dir` resolves to the
  main checkout's `.git` even from inside a worktree, so every worktree of the repo shares
  one cache and the cache dies with the clone — the correct lifetime for a cache *of* that
  clone. It is deliberately **not** folded into `~/.colab/state.json`: that file is a
  published contract with readers outside this repo (`tools/lib/state.js` says so in its
  header), and a private cache wedged into it becomes a field other tools must parse.
- **Anchor input 4 on the main checkout, not `$PWD`.** `colab` records every claim and
  worktree against the **main** repo path, so a filter comparing against the current
  directory matches nothing whenever it runs from inside a worktree — and "no claims" is
  indistinguishable from "no claims *found*". `dirname` of the common git dir is that path
  from anywhere in the repo, worktrees included. (`code-sweep` §1 filters the same state
  and needs the same anchor for the same reason.)
- **Input 4 digests this repo's slice, not the file's mtime.** `~/.colab/state.json` is
  machine-global, and `colab` rewrites it atomically on every command — so its mtime moves
  when an unrelated repo allocates a port, and a triage that re-ran fully on that would
  short-circuit almost never. Reading the file is local and free; read it precisely. (Same
  reason it is a *digest* and not a timestamp: an atomic rewrite with identical contents is
  not a change.)
- **Compare for equality, never for recency.** "Newest touch is no later than last time"
  is wrong: when the most recently touched issue *closes*, it leaves the open set and
  the maximum moves **backwards** — the busiest issue in the repo changing state reads as
  "nothing happened". Digest the whole `(number, state, labels, title, body)` set and
  compare digests, never a single most-recent marker.
- **Input 2 dropped `updatedAt` entirely — measured, #244.** `updatedAt` moves on a bare
  comment, and on a fleet where many concurrent sessions comment on issues that alone kept
  the fingerprint "changed" on nearly every ping — the sufficient explanation, alongside
  input 5 below, for a measured median of 24 tool calls against a documented 3. Digesting
  `number,state,title,body,labels` instead moves on exactly what triage's own grouping,
  blast-radius and readiness gates read (a label add/remove, close/reopen, a title/body
  edit, entering or leaving the open set) and stays silent on a bare comment. `@base64`-
  encode the body in the `-q` filter before hashing — a multi-line body would otherwise
  break the line-oriented `sort` the digest depends on. This still needs its own receipt
  (`N2`, the count of issues read) for the same reason input 3 needs `COV`: `shasum` of
  empty input is the constant `e3b0c44298fc1c14` below, and a failed `gh issue list` must
  never be mistaken for a truncation-free empty backlog. Cross-check `N2` against input 3's
  `TOTAL` rather than issuing a second count query — `TOTAL` is already the total open-issue
  count, so this costs no extra call and reuses the same truncation logic input 3 already
  has. Deliberately still blind to: assignee, milestone, lock state, comment volume — none
  of them feed a gate this skill evaluates (§5.1 reads "taken" from the `in-progress` label
  and live claims, input 4, not from assignee).
- **`updatedAt` does not see dependency edges either — measured on the live API.** Adding a
  `blocked_by` edge and removing it again left `updatedAt` byte-identical across both
  writes, while a label add/remove moved it twice in the same minute. Edges do land in the
  issue timeline (`blocked_by_added` / `blocked_by_removed`), but reading that is a call
  *per issue*; input 3 is the entire graph in one query. This is why input 3 stays a
  separate input even after input 2's narrowing above — none of `state,title,body,labels`
  sees an edge either, so dropping input 3 would go blind to precisely the data the §5
  readiness gate turns on: a new blocker would be reported as `free (checked)` forever.
- **Input 3 digests BOTH directions, because an inbound edge is not visible on this side's
  `blockedBy`.** An edge written from another repository *toward* an issue here moves that
  issue's `blocking` count and never touches its `blockedBy`. Measured: an open issue whose
  `blocking` went 0 → 1 — a consumer elsewhere declaring itself blocked by it — produced a
  **byte-identical** one-directional line (`<n>:0`) before and after, and two inbound edges
  once survived a full triage cycle unnoticed. Under a ping loop that means the repo
  acquires an obligation (one of its issues is now on somebody's critical path) and triage
  never says so. The two-way line makes the fingerprint deliberately more sensitive, on the
  same reasoning input 5 already uses for pushes: what this repo *owes* changed.
- **Digest the connections' `totalCount`, NOT `issueDependenciesSummary` — the summary
  lags behind the graph.** Measured, both directions, inside a *single* response: seconds
  after a `blocked_by` POST, `blockedBy(first:n){totalCount}` already read `1` while
  `issueDependenciesSummary.blockedBy` still read `0`; seconds after the matching DELETE the
  connections read `0` while the summary still read the pre-delete `1`. It converges within
  a few seconds, so nothing is broken — but a digest built from the summary can record a
  state that never existed at any instant, and a fingerprint stored from it "changes" on the
  next ping for no reason. The connections are the authority; the summary is a cache of them.
  (The same fact protects §0.2's read-before-write rule: `gh issue view <N> --json blockedBy`
  reads the *connection*, so a POST is not re-issued against a stale zero.)
- **The `BY` lines are why the blocker detail is fetched here and not again in §5.** §5.1
  needs each open blocker's number, state and home repo; input 3 is already querying that
  subgraph, so one request serves both. Two requests would cost a round trip *and* a
  correctness risk: the graph can move between them, leaving the digest and the report
  disagreeing with no way to tell which is authoritative. Including each blocker's `state`
  in the digested material is deliberate — a blocker in *another* repo closing moves no
  other input, and it is exactly the change that flips a dependent from `blocked` to ready.
- **Never digest a read you did not verify arrived.** `shasum` of empty input is a stable,
  plausible 16-hex value — **`e3b0c44298fc1c14`**. So any pipeline whose producer emits
  nothing yields a well-formed and *constant* digest: it matches on every later run and the
  triage reports "nothing has changed" forever. Learn that constant by sight; seeing it is
  never good news. This is the mechanism behind *"never report nothing changed from a cache
  you could not read"* below, and it binds all five inputs: every digest needs a receipt that
  its read actually happened —
  input 3's is the `COV` line, which is emitted by the same query and cannot be produced by
  a failed one. Note the failure is *not* hypothetical for want of `jq`: shipped paths use
  `gh`'s built-in `-q` (and the audit's `--jq`) for exactly this reason, but an external
  `jq` is not universally installed — piping this query into one on a machine without it
  returned that constant, silently.
- **No silent caps — say what was dropped.** `first:100` in input 3, `--limit 100` in
  input 2 and in §1, all bounded; past 100 open issues the digest covers a partial set, so
  movement in the tail reads as "unchanged" and the short-circuit then hides it.
  `totalCount` and `pageInfo { hasNextPage }` are free in the same input-3 request, which
  makes truncation loud and gives all three bounded reads one authoritative count (`TOTAL`)
  to check against — input 2's own truncation check above is exactly this reuse.
  **Both guards fall toward work, never toward silence:** each prints instead of a digest, and
  no digest means no match, which means a **full pass** — not a stop. A truncated backlog
  therefore stops short-circuiting until someone paginates, and that is the intended price:
  a partial digest that *matched* would report "nothing has changed" while blind to the tail,
  which is the failure being fixed, merely relocated. Keep the three branches mutually
  exclusive — written as separate `[ … ] || echo` lines, an empty read prints the refusal and
  then a second, garbage line (`TRUNCATED:  of  open issues`) from the unset variables it
  just proved it does not have. Verified by running it with a producer that emits nothing.
- **Sort before hashing.** The digest hashes what the server returned, in the order it
  returned it. Order is stable in practice today (verified across repeated calls) but is not
  a documented guarantee, and a reordering would spend a full pass to conclude nothing
  changed. `| sort` costs nothing and removes the dependency on undocumented behaviour.
- **Pass owner/name to `gh api graphql` as variables, never inline.** Input 3 uses
  `-F owner="${NWO%%/*}" -F name="${NWO##*/}"` with a parameterised `query($owner,$name)`
  for a reason past style: a query with the repo spelled into the text
  (`repository(owner:"…",name:"…")`) puts the repo name in the command itself and trips the
  privacy backstop. The variable form keeps the name out of the argv — copy it in every
  `gh api graphql` call this skill has or gains.
  **The practical consequence, worth knowing before it surprises you:** where a wrapper
  classifies a command by its *destination*, a `gh api graphql` call has no destination in
  argv at all — it lives inside the query text — so such a call cannot be resolved that way
  and will attract the strictest classification available. That is the correct default and
  not a thing to work around. Keep the call in its **own invocation, as a pure read, with no
  local writes co-located in the same command**, so a strict classification can never block
  unrelated work. (Two portability notes found while testing input 3: `-F query=@file` and
  `-F query=@-` both work if you would rather keep the query out of argv entirely, but
  `-f query=@file` does **not** — `gh` sends the literal `@` and the server rejects it. And
  `set -- $VAR` does not word-split under zsh, where it yields one argument to bash's three,
  so parse the `COV` line with `read` or `awk`, never with positional parameters.)
- **Input 5 exists because §5.1 turned a branch push into a readiness signal.** A blocker
  whose code gets pushed moves a dependent from `blocked` to soft-ready — and moves none of
  inputs 1-4: trunk is untouched, the issues are untouched, the edge is untouched, and the
  claim may live on another machine. Without this the new verdict would almost never be
  discovered under a ping loop, which is the same blindness input 3 was added to fix. It
  reads refs the fetch on input 1 already updated, so it costs no call.
- **Input 5 now digests branch presence + ahead-ness, not tip shas — measured, #244.** The
  old digest (every remote ref's tip sha) moved on any push to any branch, and this repo's
  own text already conceded it: "any push to any branch forces a full pass" — a safe
  default when written; on a fleet where `code-wrap` routinely pushes a session branch as
  backup every time it wraps, it is the other sufficient explanation for the measured 24/27
  call median. §5.1 only ever asks two things of a branch — *does one exist carrying this
  issue's number*, and *does it have real commits* — and returns the same verdict for the
  1st push and the 12th. So digest that: filter remote refs to ones whose **trailing number
  run** matches an *open* issue number (the same convention §3 writes and §5.1 reads;
  `<trunk>`, `HEAD` and `dependabot/*` excluded), and pair each with a 0/1 ahead-of-trunk
  flag rather than its sha. A repeat push to an already-matched, already-ahead branch no
  longer re-arms the fingerprint. The `B5 <total refs> <matched>` line is this input's
  receipt, load-bearing for a different reason than the others: after narrowing, an *empty*
  match set is a normal, common state, and hashing empty input is the same
  `e3b0c44298fc1c14` constant below — the count line is what tells a zero-match digest apart
  from a failed read. Deliberately still blind to a later push on an already-matched branch
  that changes *which files* it touches (§5's file-contention gate); that gate was never
  cached in the first place (see "what is deliberately NOT in the fingerprint" below) and is
  re-derived on any pass that proceeds, narrowed or not.
- **`code-sweep` does NOT inherit this narrowing — read why in its own §0.** Its cache of
  `colab landed --all` is keyed on branch **tips**, so a new commit on an already-`landed`
  branch is precisely the event that un-lands it and creates a new sweep candidate; a
  name-set-only digest there would go blind to its own input. It takes only the branch
  *filter* (issue-carrying, trunk/HEAD/dependabot excluded) and the `B5` receipt shape, and
  states plainly that it keeps tip shas.
- **What is deliberately NOT in the fingerprint.** Trunk CI, live worktrees and live
  processes are volatile by nature and are never cached. So a matching fingerprint means
  *the backlog has not moved*; it never means *you may merge*. Nothing downstream may skip
  its own CI check on the strength of it.
- **The cache is an optimisation, never an authority.** Missing, unparseable, or written by
  a version you do not recognise ⇒ run the full pass. Never report "nothing changed" from a
  cache you could not read — a silent fall-through to "all quiet" is the one failure mode
  that costs a day rather than a call.

### 0.1 Persist the conclusion, not only the writes

§4 already argues this for dependency edges: *a sequence you worked out and left in a report
is lost the moment the report scrolls away*. The same is true of the report itself. Write
the §6 output into `$CACHE` alongside the fingerprint — the ranked **ready** groups (with
each soft-ready note, §5.1, or the re-print loses the one thing that made it startable),
the **blocked** bucket with its named blockers, **taken**, **close these**, and the
group-level **findings** (§3, §6 — or the short-circuit re-print silently loses the one
thing that made a group unsafe to spawn into, which is exactly the state a re-ping most
needs to be told about). Without it the short-circuit is useless: it would announce that
nothing changed and have nothing to show.

Record the **scope** of the conclusion with it (see code-sweep's scoped mode; triage's
single-issue mode below is the same shape), and apply the coverage rule:

> **Short-circuit only when the fingerprint matches AND the stored conclusion's scope
> *covers* the current request.** Covers, not equals. A stored repo-wide conclusion can
> serve a re-ping about one issue — filter it. A stored single-issue conclusion cannot
> serve a repo-wide ping, however unchanged the world is: that run never looked at the
> rest, and an unexamined issue is not a clean one.

**The record has a required shape — measured, #244.** §0 above specified the comparison in
exhaustive detail and never specified what to store, so two model-executed sessions in this
very checkout wrote two different partial things: one held only `fingerprint: {trunkSha}` —
one of five inputs, leaving four with nothing to compare against on the next ping — and the
other was a 61 KB, ever-growing map of ad-hoc `scope:*` keys with no `fingerprint`, no
`ranAt`, no `version` at all. §0's own "cache is never an authority" rule then correctly
forced a full pass every time — a third, independent explanation for the measured 24/27
call median, on top of inputs 2 and 5's narrowing above. So `$CACHE` is now a **required**
shape, versioned so an old partial record is discarded loudly rather than silently
half-matching:

```json
{
  "version": "code-triage/4",
  "scope": "whole-repo",
  "ranAt": "<ISO8601>",
  "fingerprint": {
    "trunkSha": "<40hex>",
    "backlog":  "<16hex>",
    "deps":     "<16hex>",
    "claims":   "<16hex>",
    "branches": "<16hex>"
  },
  "lastRun": { "decision": "full", "moved": ["trunkSha", "backlog"], "calls": 24 },
  "conclusion": { "ready": [ "…" ], "blocked": [ "…" ], "taken": [ "…" ], "close": [ "…" ],
                  "findings": [ "…" ] },
  "issues": {
    "115": { "key": "<16hex>", "group": "import-fixes", "bucket": "ready" },
    "247":  { "key": "<16hex>", "group": null, "bucket": "blocked" }
  }
}
```

- **All five `fingerprint` keys are required.** A record missing any of them is `no usable
  cache` (the third outcome line above), said out loud — never treated as a partial match
  on the keys that happen to be present. An unrecognised `version` is the same: bump the
  version whenever the shape changes, and read a version you do not recognise exactly like
  a missing file.
- **`lastRun` is the receipt this section exists to add.** It is Q3's "small amount of
  persisted state" — `decision` (`short-circuit` | `full`), `moved` (which fingerprint keys
  differed, empty on a short-circuit), `calls` (how many network calls this run actually
  made). This is what lets a later census answer "did §0 fire" by reading one JSON file per
  repo, with no transcript corpus required.
- **Never store the empty-digest constant, `e3b0c44298fc1c14`, as if it were a value.** Any
  fingerprint slot equal to it means the read that produced it did not arrive — refuse to
  write the record, exactly as §0's outcome-line 3 says, rather than persisting a digest
  that will match forever for the wrong reason.
- **`issues` is required-when-present, not required outright (#247).** It is the per-issue
  verdict cache §0.3 reads and writes; the five `fingerprint` keys above stay the only ones
  that make a record `no usable cache` when absent. A `code-triage/3` record with no `issues`
  key (or an empty one) is a legitimate first-run-of-this-feature state, not a corrupt one —
  §0.3 says what to do with it. Bumped from `/2` because this is a shape change under §0.1's
  own rule ("bump the version whenever the shape changes"), even though every `/2` reader's
  five fingerprint keys still parse unchanged.
- **`conclusion.findings` bumped `/3` to `/4`, under that same rule.** The one-time cost is
  real and worth naming: the first ping in every adopting repo reads `no usable cache:
  version code-triage/3 unrecognised` and takes one full pass. That is the honest behaviour
  the shape rule already prescribes — a record whose `conclusion` predates findings cannot
  answer "did this group break the one-branch contract", and half-matching it would re-print
  a conclusion that silently omits the finding. Like `issues`, `findings` is
  required-when-present: an empty list on a repo where no group broke the contract is the
  ordinary state, not a corrupt record.

### 0.2 Running this twice must change nothing

Under ping-when-idle a re-run is the normal case, not the exception, so every write this
skill performs has to be idempotent.

**This skill's tracker writes are exhaustive — the list below is all of them, and nothing
else is authorised.** An enumeration of "which writes must be careful" reads, by omission,
as permission for anything unlisted; it is not. If a write is not one of the five below, it
is not a triage write, no matter how naturally it seems to belong on the issue:

1. `blocked_by` dependency edges, via `colab blocked` (§4, #251)
2. the `deps-checked` label, via `colab readiness` (single-issue mode, §4; whole-repo path, §6)
3. the `group:<key>` label plus its one evidence comment (§3)
4. the `needs-plan` label plus its one reason comment (§6)
5. the `mechanical-lane` label plus its one reason comment (§6)

**§6's report is console output.** It is what the human or session reading this triage
directly sees; it is never posted to the issue tracker as a comment, in whole or in part —
not the ranked list, not a single group's verdict, not a restatement of "still ready,
unchanged." Measured: one issue collected nine near-identical narrative verdict comments in
under four hours from a ping-when-idle loop inventing exactly this unauthorised sixth write,
burying the one human ruling that actually mattered on that issue under six copies of a
machine re-confirming what it had already confirmed. If a durable per-issue verdict is
genuinely wanted, that is a new write needing its own idempotence rule — proposing one is
out of scope for a triage pass to decide unilaterally by posting.

**"Only when changed" governs re-posting writes 3-5 — it authorises nothing new.**
Re-running a full pass is not license to re-post the group / needs-plan / mechanical-lane
records if their conclusion did not move — each carries its own grep-before-post check
below; run it before every post, and when nothing changed, post nothing. A verdict that
CHANGED or REVERSED since the last pass is still §6 console output: "this is an update, not
a duplicate" does not convert the unauthorised sixth write into an authorised one. Banned
forms include, by name: "Triage at trunk `<sha>` — …", "Triage re-measure — verdict
CHANGED/REVERSED", corrections to either, and "final state of this pass" summaries. A
verdict stamped to a trunk sha goes stale the next time trunk moves — minutes, in an active
repo — which is exactly why the tracker is the wrong home for it.

- **Dependency edges: read before writing.** Skip the POST if the edge is already there.
  §4 writes edges; a second triage reaching the same conclusion must not file it twice.
  `blockedBy` is a **connection object** (`{nodes, totalCount}`), not an array — `| length`
  counts its two keys and returns `2` for an issue with **no** blockers at all, so a guard
  written that way silently concludes "already there" every time and never writes the edge
  (#250). Read the count field, not the object's own length:
  ```sh
  gh issue view <N> --json blockedBy -q ".blockedBy.totalCount"      # 0 = no blockers
  ```
  `colab blocked` (#251) encodes this guard once, in a pure module with a unit test that
  names #250 directly — use it and this trap stops being something every triage pass has
  to reimplement correctly from scratch (§4).
  `subIssues` has the identical shape and the identical trap — `.subIssues | length` also
  reports `2` regardless of child count; read `.subIssues.nodes | length` (or prefer
  `subIssuesSummary`, §3) instead. `comments`, `labels` and `assignees` are plain arrays,
  so `| length` is correct on those.
- **Already-shipped closes:** an issue already closed is not re-closed and not re-evidenced.
- **Group records: the label is idempotent, the comment is not.** Re-applying `group:<key>`
  changes nothing; re-posting its evidence comment stacks a duplicate every idle cycle.
  Grep the existing comments for the key before posting (§3).
- **`deps-checked` has a timestamp — it is just not on the label.** The label is monotonic
  (`CONVENTIONS.md` §5, *Readiness*, #279): once set it stays set, and its only staleness is
  computed against blocker edges, never against age. But the `labeled` event that set it is in
  the timeline, and so is every edge write. That makes the one staleness that matters —
  a blocker opening after the label was set — computable rather than a matter of trust:

  ```sh
  gh api "repos/{owner}/{repo}/issues/<N>/timeline" \
    -q '.[]|select(.event=="labeled" or .event=="blocked_by_added")|"\(.created_at) \(.event)"'
  ```

  **A `blocked_by_added` later than the newest `deps-checked` `labeled` event means the
  label is stale** — treat the issue as `dependencies unchecked`, re-run the §5 gate, and
  remove the label if a blocker is now open. `CONVENTIONS.md` [§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this) assigns removal to whoever
  adds the blocker; this is how the next reader finds out when they didn't. Only spend the
  call on issues a `deps-checked` is actually deciding for.

### 0.3 Per-issue verdict cache — reuse across a pass that proceeds (#247)

§0's fingerprint answers one question: did *anything* move. When it did — even one label on
one issue — the run so far falls back to re-deriving **every** open issue from scratch: §2's
discard check, §3's grouping, §4's ordering, §5's readiness gate, all repeated for issues
whose own inputs never moved. §0 already makes this argument for the whole-repo case
("about 4 of ~50 carry new information"); it holds **per issue** too — if issue N's own
content, its dependency edges, and trunk did not move, N's verdict cannot have moved either,
whatever happened to issue M.

**The per-issue key — already in hand, zero added calls.** `OUT2` (input 2) carries one `I
<number> <state> <labels>\t<title>\t<body@base64>` line per open issue; `OUT` (input 3)
carries one `DEP <number>:<blockedBy>:<blocking>` line per open issue. Both are fully fetched
by the time §0 has decided to proceed — this section changes what gets *stored and skipped*,
not what gets *fetched*. Per issue N:

```sh
KEY_N=$(printf '%s\n%s\n%s' "$TRUNKSHA" "$(grep "^I $N " <<<"$OUT2")" "$(grep "^DEP $N:" <<<"$OUT")" \
  | shasum -a 256 | cut -c1-16)
```

Trunk sha is in the key deliberately, per #247's own proposal: §2's already-shipped check
depends on trunk state, not just the issue's own text, so a trunk push has to invalidate the
issues it might have shipped. It invalidates **every** issue's key at once — a per-issue
cache buys nothing on a pass where trunk moved, same as today. The case it targets, and the
common one (#247: "the common invalidation is a single claim or label move"), is a pass where
trunk did *not* move.

**Reuse is narrower than "N's own key matched" — grouping is not a per-issue fact.** "Which
files does this issue touch" (§3) is a judgement about N alone, stable whenever N's key is.
"Which *group* N belongs to" is a judgement about the whole open backlog: an issue N never
touched can still change N's group by entering the backlog with an overlapping file, or by
leaving it and dissolving a group down to one surviving member (§3, "a one-member group is
not a group"). So reuse N's stored verdict only when **all** of:

1. `KEY_N` matches the stored `issues.N.key`.
2. Every other member of N's stored group (if any) also matches its own stored key — a group
   is one unit; one dirty member dirties the whole group, exactly as an un-cached pass would
   re-derive the whole group rather than one member of it.
3. No issue **newly present** this pass (no stored entry at all — including one dropped by
   the previous pass's prune, below) overlaps N's stored file-set. §3's evidence comment
   already records what that file-set was judged to be; read it back, do not re-derive it. A
   new issue is cheap to check against every stored file-set locally — it is not cheap to
   skip checking.
4. No member of N's stored group **closed or left the open set** since the stored verdict —
   closing shrinks the group, and a shrunk group can need its label removed (§3).

An issue with **no stored entry at all** — the first pass to see it, or one the previous
pass's prune (below) dropped — has nothing to compare against, so conditions 1-4 do not
apply; it is derived fresh by definition, same as today.

Fails any of 1-4 ⇒ re-derive N (and, by 2/4, its whole group) exactly as an un-cached pass
would: §2's discard check, §3's grouping, §4's ordering, §5's readiness gate. Passes all four
⇒ re-print N's stored verdict (§6) and skip re-deriving §2-§5 for it. This is safe to skip
even on a re-run: §3/§4/§5's writes are already idempotent (§0.2), so a pass that *would*
have re-reached the same conclusion loses nothing by not re-reaching it.

**What this deliberately does NOT skip.** §4's ordering ranks the *surviving* groups against
each other (blast radius, exposure, cost) — a whole-set comparison, no network calls, no
issue-body re-reading, and it gains nothing from caching; redo it every pass that proceeds,
over whichever groups §2/§3 left standing (reused or freshly derived). §5's readiness gate
for a **blocked** issue still reports the blocker's *current* state — condition 1 already
invalidates the moment `DEP` moves, so a blocker's close can never hide behind a stale
bucket. And this section is about *reasoning* cost, not network calls: unlike §0's own
short-circuit, per-issue reuse does not reduce `lastRun.calls` — inputs 2 and 3 are always
fetched in full to identify which issues are new or dirty in the first place. What it saves
is the executing session re-deriving grouping/ordering/readiness for issues nothing about
this pass actually put in question.

**Store one entry per currently-open issue, in the same `$CACHE`, replacing — not
accumulating onto — the previous `issues` map:**

```json
"issues": {
  "115": { "key": "<16hex>", "group": "import-fixes", "bucket": "ready" },
  "247":  { "key": "<16hex>", "group": null, "bucket": "blocked" }
}
```

- **Prune on every write — bounded, never a growing map.** Write only entries for issues
  still open at the end of *this* pass; drop everything else. This is the exact defect #244
  found and fixed for `colab-sweep.json` (61 KB, 24 accumulated ad-hoc keys), arriving here by
  a different route — a per-issue cache has one entry per open issue on the backlog by
  construction, not one per issue this repo has ever had.
- **`group` and `bucket` are enough** to satisfy condition 2 above and to re-print §6's report
  without re-deriving it; they do not duplicate §0.1's `conclusion` arrays, which stay the
  ranked prose a re-print serves.
- **Never store a per-issue key from an empty read.** Same rule as §0's outcome line 3 and
  §0.1's empty-digest warning: if N's `I` or `DEP` line did not arrive, write no entry for N
  at all, rather than a key built from `e3b0c44298fc1c14`-equivalent emptiness. A missing
  entry is condition 3's "newly present" case next pass — safe, not silent.

## 1. Gather

```sh
gh issue list --state open --limit 100                    # this repo
gh issue list --state open --label in-progress            # …of which, taken
```

`--state open` is right here — unlike code-start's lookup, which needs `--state all`
because it is answering a different question (does a memory exist?) rather than this
one (what is left to do?).

**`--limit 100` is a cap, so say when you hit it.** A bounded pass that does not report what
it dropped is the failure §0 forbids, arriving one section later: past 100 open issues this
gathers a partial backlog and everything downstream — grouping, ordering, "nothing left to
do" — is silently computed over a subset. §0's `COV` line already carries the authoritative
`totalCount`; compare it to what you actually received and say so out loud:

```sh
gh issue list --state open --limit 100 --json number -q 'length'   # vs COV's totalCount
```

Equal ⇒ full coverage. Fewer ⇒ raise the limit or paginate, and until you do, state the
coverage in the report — a triage over 100 of 140 issues is a useful answer, but only if it
admits which question it answered.

**Scope: this repo. Not the fleet.** Every `code-*` skill is one repo — that is the
family's whole shape, and a single skill quietly going wide is the kind of
inconsistency people discover by surprise.

Want the machine-wide picture instead? Two tools already give it, mechanically and
in more useful form than prose triage could:

```sh
node "$COLAB_HANDBOOK/audit/audit.mjs"   # conformance across every registered repo
colab update                             # which repos have drifted from the handbook
colab claims                             # what is held, everywhere, and by whom
```

All three read the **machine-local** registry, so "fleet" means every repo on *this*
machine — never every repo that exists. That distinction matters once a second
machine has its own registry.

## 2. Discard what is not really open

Two passes, in this order — the cheap one first.

**Taken** — `in-progress`, or a live claim, is someone else's:

```sh
colab claims                                 # includes host + session + name
```
A claim carries who holds it. If it looks stale, that is a **finding to raise**, not
permission to take the work.

**Exception — a `deferred:*` claim whose wake condition has resolved is re-surfaced, not
silently discarded (#290).** `deferred:date` / `deferred:measurement` /
`deferred:external-party` (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#disposition--a-park-must-name-its-wake-condition-279), *Disposition*) mark a claim genuinely
parked on something outside this repo — a human-gated permission it is still waiting on,
not abandoned. A bare `in-progress` can't tell "actively worked" apart from "parked,
waiting"; a claim carrying no `deferred:*` label is read exactly as before — this only
adds a check before the ordinary Taken rule fires on one that does:

```sh
gh issue list --label in-progress --search "label:deferred:date,deferred:measurement,deferred:external-party" \
  --json number,labels -q '.[] | {number, labels: [.labels[].name]}'
```

- **`review-by:<date>` present and past** — the wake condition is due for a look. Do not
  discard it under Taken, and do not silently restart the work either — the claim's holder
  may still be the right owner. Flag it in the report as *parked, wake condition due*
  (§6) so a human or the holder re-checks whether the gate actually cleared; never fold it
  into the ranked start list as if it were unclaimed.
- **No `review-by:<date>`** — *Disposition* allows an unbounded `deferred:external-party`
  park (no date, someone else's action is the only wake signal); that can't be resolved
  mechanically, so it discards under the ordinary Taken rule same as before — but note it
  in the report, so a park with no clearing signal is at least visible rather than silently
  re-discarded forever.
- **No `deferred:*` label at all** — ordinary Taken rule, unchanged.

This never re-runs the discarded issue's own work; it only stops a claim from staying
invisible once the thing it was waiting on has cleared.

**Already shipped** — the expensive pass, and the one that pays:

```sh
git log --oneline --all --grep="#<N>"                  # merged under this number?
grep -rl "<the thing the issue describes>" <paths>      # or present in the code?
```

Grep for what the Issue *describes* — the column, route, UI string, function — not
for its number. A commit mentioning `#88` proves someone typed `#88`.

- **Fully shipped** → close it with evidence (trunk sha + `file:line`) and take it
  off the list. That is real triage output, not a detour.
- **Partly shipped** → narrow it to what is actually missing before queueing, so
  nobody re-does the finished half.

**Memoize this pass against the trunk sha.** Both commands are pure functions of the tree:
with the tree unmoved, they return byte-identical results, and this is the pass that costs
~2 local invocations per issue on top of the network. So cache the verdict per issue in
`$CACHE` (§0) keyed by the **trunk sha it was computed at**, and reuse it while that sha
holds. A new trunk sha invalidates every entry at once — which is right, because a merge is
exactly the event that can ship an issue.

Two conditions on that, both of which have teeth:

- **Only when the working tree is clean.** `grep -rl` reads the *working tree*, not the
  commit; with uncommitted changes the result is not a function of the sha at all. Key on
  `git status --porcelain` being empty, or do not cache.
- **Only the verdict, never the evidence.** Re-quote `file:line` from the current tree
  before putting it in a report — §3 already warns that refs rot, and a cached line number
  is a ref that rots invisibly.

**A container, not a task** — cheapest pass of the three, so run it first:

```sh
gh issue list --state open --label epic --json number -q '.[].number'
```

An `epic`-labelled issue is informative, never a start candidate (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#epics--a-container-is-not-a-start-candidate),
*Epics*) — leave it off the ranked list entirely, the same way a taken issue is left off,
but for a different reason: it is not that someone else holds it, it is that there is no
code to write for it directly. Still report it, in its own bucket, so it does not read as
silently dropped — see §6.

**Non-code delivery — route, not start:**

```sh
gh issue list --state open --search "label:delivery:content,delivery:ops,delivery:docs-only,delivery:elsewhere" \
  --json number -q '.[].number'
```

An issue carrying `delivery:content`, `delivery:ops`, `delivery:docs-only` or
`delivery:elsewhere` is real work whose completion is not a code commit *in this repo* — a
content push, an ops/production check, a docs sync outside code review, or code that lands
in a different repository (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#delivery-type--route-not-start-112), *Delivery type*). Leave it off the ranked
list the same way an epic is: not because someone holds it, but because there is nothing
to branch on in *this* pipeline. Report it in its own **route** bucket, distinct from the
epic bucket — see §6 — so a human sees where it actually needs to go instead of it reading
as silently dropped. **No `delivery:*` label at all is NOT this bucket** — absence means
*not asked*, not non-code; an unlabelled issue proceeds through the rest of triage exactly
as before this label set existed. `delivery:code` also proceeds normally — it is the
explicit code affirmative, not a routing signal.

## 3. Group — this is a correctness constraint, not tidiness

**Issues that touch the same files must serialize.** Two sessions editing the same
files merge over each other; grouping is how that is prevented — the obligation is
serialization, and how it is realized follows
[`writes`](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)
(⚖ #233 — a veto now, not a method choice): on `writes: isolated` (the veto), one
branch, always — every rule below applies unchanged. On a repo permitting trunk-direct
(absence, or any other declared value), an attended human session behind a place-claim
is enough on its own; a branch is mandatory only when one of [§2](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)'s two conditions fires (more than
one unit in flight, or a gate must inspect the unit before it lands) — see §6's
`start:` line for what that changes about the command a session runs. Triage output
itself is consumed by sessions that may be UNATTENDED, so `start:` never assumes
attendance on its own — see §6.

Group when:
- the issues touch overlapping files or the same subsystem
- one is a prerequisite of another
- they are children of the same epic and land together naturally

Keep separate when the files are disjoint — parallel sessions are the point.

**On `isolated`, name the group per [`CONVENTIONS.md` §4](../../CONVENTIONS.md#4-branches-and-commits):**
every issue number in one **trailing** run, e.g. `fix/import-fixes-115-114-113`.
This is load-bearing — code-wrap's harvest reads the branch name and the claim
registry, so a number in neither is one the wrap will never find, and it sits open
with its code merged. The failure this whole skill exists to prevent, re-created by
sloppy naming.

**On an attended trunk-direct unit with no branch, the branch-name half of that harvest
is empty by construction** (`code-ship` B1b) — claim every member issue anyway, and cite
each `#N` in the trunk-direct commit body, since that is the only source harvest has left
to read.

**Epics: read the state, never the title.** The title states the ambition; the title is
not evidence. Where the state lives depends on how the epic is built:

- **Native sub-issues** — `gh issue view <epic> --json subIssuesSummary,subIssues`.
  GitHub maintains this; it cannot drift. Prefer it, and prefer converting an epic to it.
- **A hand-written checklist** — read the table, and **treat it as a claim, not a
  fact.** It is maintained by `code-wrap` B2c and `code-sweep` §5, both of which run
  only when someone runs them; a table nobody has swept since the last merge is stale
  by default. Spot-check any line that decides your plan — *especially* one reading
  "in progress on branch `x`", which is the form that most often survives its own
  branch and sends a session to redo shipped work.

Verify `file:line` references before quoting them; engines get edited and refs rot.

### Then persist the group — it is a judgement no tool can re-derive

A group printed to a terminal dies with the terminal, and the next session claiming one
member never learns the other exists — the exact collision this section computes in order
to prevent. "Which files does this issue touch" is a judgement, so nothing downstream can
recover it; **triage is the only writer** (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#grouping--issues-that-must-share-one-branch), *Grouping*).

Two writes per group, and both are needed: the label makes it *queryable*, the comment
carries the *evidence*.

```sh
KEY=import-fixes            # the branch slug WITHOUT the trailing numbers
gh label create "group:$KEY" --color 5319E7 \
  --description "Must share one branch — these issues touch the same files" 2>/dev/null || true
for N in 115 114 113; do gh issue edit "$N" --add-label "group:$KEY"; done

# then, once per member — the why, ending in the machine-readable pair
gh issue comment 115 --body 'Group: import-fixes — #115 #114 #113
Because: app/Import/Parser.php:88 — #115 and #114 both rewrite the delimiter branch'
```

- **Re-running must not duplicate the comment.** §0.2 is binding here and the two writes
  are not equally safe: `--add-label` is idempotent by nature, `gh issue comment` is not —
  a skill pinged on a loop would otherwise stack an identical justification on the issue
  every idle cycle. Read first, and post only if no comment already carries this key:
  ```sh
  gh issue view 115 --json comments -q '.comments[].body' | grep -q "^Group: $KEY" || gh issue comment 115 --body "…"
  ```
  Re-post only when the membership or the evidence actually changed — and then say what
  changed, rather than repeating the original.
- **Remove what you contradicted.** If this pass concludes a previously grouped issue no
  longer belongs — its collision landed, or the group was wrong — take the label off that
  issue (`gh issue edit <N> --remove-label "group:$KEY"`). Nothing else removes it, and a
  stale group label reads exactly like a fresh one.
- **A one-member group is not a group.** After removals, a `group:` label left on a single
  open issue is spent: remove it too.
- **Quote the evidence from the current tree, not from `$CACHE`.** §2 caches verdicts and
  never evidence, for this reason: a cached line number is a ref that rots invisibly.
- **Record only collisions you actually checked.** A group inferred from titles is a guess;
  leave it unwritten and say so in the report. Writing it makes the guess look verified to
  every reader afterwards.
- **On a pass that proceeds under §0's fingerprint, this whole section may already be
  answered for some issues.** §0.3's per-issue verdict cache reuses a stored group verdict
  when the issue's own key, its group-mates' keys, and the surrounding backlog membership
  all still match — re-derive here only the issues §0.3 flagged dirty.

### Then ask the one-branch question — a second live branch is a finding, not a spawn

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
editing a branch are not among §0.2's five authorised writes, and they are not writes this
skill may invent — see §6 for the printed shape, and `code-ship` B0 for the half that
actually does the landing.

## 4. Order by blast radius, not by number

Rank the surviving groups:

1. **Blocks other work** — a bug in a shared engine, a broken trunk, a stale claim
   nobody can get past. These unblock people, so they pay twice.
2. **Reaches users** — a defect in a repo with a live production target
   (`project.yml` `production:` non-null). Key the urgency off
   [`exposure`](../../CONVENTIONS.md#exposure--what-consumes-a-merge-here): `live` means
   the next promotion ships it; `released` means it waits for a deliberate artifact and,
   once out, [cannot be recalled](../../CONVENTIONS.md#recovery--what-must-exist-to-undo-a-merge)
   — the strictest cell, not the mildest, so weigh it accordingly. No `exposure`
   declared? Read the legacy `tier` value the same way the code does
   (`tools/lib/axis-authority.js`): `C → live`, `A → released` — and a bare `tier: B`
   yields **no** urgency signal at all (`B → null`); rank it on the other three
   criteria instead of guessing, which is the one thing the module exists to stop a
   caller doing.
3. **Cheap and unblocking** — small work that lets something bigger start.
4. **Everything else** — by whatever the humans care about.

**Then push every `low-priority` group to the back, after all four ranks above are
applied — never sorted in among them.** It is a throttle on position, not an input to
blast radius; see *Then rank low-priority groups last*, below §5, for the full check
and what the report says about it.

State the reason next to each rank. "Ordered by priority" with no reasoning is not
triage; it is a re-sorted list.

### Then write the ordering down — as relationships, not just as report prose

Triage is not only a *reader* of the dependency graph; it is the main thing that
**writes** it. A sequence you worked out and left in a report is lost the moment the
report scrolls away, and the next triage re-derives it from scratch — or doesn't.

So when this pass concludes that one issue must wait for another, record it where a
machine can read it back:

```sh
colab blocked <blocked> --by <blocker>                                    # add the edge
colab blocked <blocked> --by <blocker> --clear --reason "<why>" [--force] # remove it
```

Prefer `colab blocked`: it takes issue **numbers**, never a database id, and resolves the
id itself, reads before writing, writes, and reads back to confirm the edge names the
blocker you meant — every step below, done once, in one place, instead of re-implemented
from scratch every triage pass (#251). The raw `gh` form is the documented portable
fallback and does the exact same three steps by hand:

```sh
DB=$(gh api repos/{owner}/{repo}/issues/<blocker> -q .id)   # database id, not the number
gh api -X POST repos/{owner}/{repo}/issues/<blocked>/dependencies/blocked_by -F issue_id=$DB
gh issue view <blocked> --json blockedBy      # ← and confirm it names the blocker you meant
```

The report still explains the reasoning — that is what prose is good for. The
relationship is the part the readiness gate above (and any other tool) reads.

- **Read before you write — `colab blocked` does this for you.** The edge may already
  exist — this triage may be the second one to reach the same conclusion (§0.2). Running
  it twice on an already-present edge is a no-op; on the raw form, check `blockedBy` first
  and do not file a duplicate.
- **Read it back after you write it, too — `colab blocked` does this for you as well,
  and refuses to print success if the read-back disagrees.** A wrong `$DB` — an empty
  variable, a failed subshell, the issue *number* pasted where the database id goes —
  does not error. The POST returns 200 and attaches whichever issue holds that id
  anywhere on GitHub, in repos neither you nor this org has heard of (`CONVENTIONS.md`
  [§5](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough), *Readiness*).
  The check is not about the API being flaky: at the moment of the write, a wrong id is
  **indistinguishable from success**, and the only later symptom is a blocker nobody
  recognises. On the raw form this read-back is a manual step you must not skip.
- **Record only what you actually determined.** A sequence you inferred from titles is
  a guess; leave it unwritten and say so in the report.
- **Remove an edge only when the edge is false — not because the blocker moved.**
  `colab blocked <blocked> --by <blocker> --clear --reason "<why>"` requires the reason
  (colab cannot verify intent, so it records yours instead) and refuses by default when
  the blocker is **closed** — the detectable signature of the exact mistake this rule
  exists to prevent — unless you pass `--force`. Use `--clear` when the dependency never
  existed, or stopped existing because the work was descoped or redesigned. **Do not clear
  it because the blocker's code landed**: the two issues really are related, the readiness
  gate reads the blocker's state for itself (§5.1), and an edge cleared for a display's
  convenience does not come back if the blocker is reverted. Editing a fact to change what
  a report prints is how the graph stops being trustworthy. The raw form
  (`gh api -X DELETE …/dependencies/blocked_by/<db-id>`) carries none of these guards —
  the same reasoning as `readiness`'s two-tier shape below.
- **Cross-repo edges are refused by `colab blocked`**, structurally — the blocker is
  always resolved in the current repo. A genuine cross-repo need falls back to the raw
  `gh api` form above.
- **Triage still never claims and never touches trunk.** Its writes are exactly three, all
  of them recordings of its own judgement about issues: `blocked_by` edges, the
  `deps-checked` label, and the `group:` label plus its evidence comment (§3).

### Single-issue mode

**`ceremony: light` repo (project.schema.md#ceremony--optional)? Order and group as
normal, but skip the `deps-checked` labeling pass below** — ordering and grouping are
judgements this skill still owes every repo; the label write is the one step that is
pure cost here. It is coherent specifically because a `light` repo can never carry
`autonomy: auto-trunk` (the audit enforces that pairing as a finding), so nothing
unattended ever consumes the readiness column — an empty column that nothing reads
costs nothing, while a filled one on a repo few humans revisit is ceremony with no
consumer.

Given one specific issue rather than a backlog, do the same work scoped to it: is *this*
ready? Run §2 and the §5 gate against it alone, then leave the answer **where a machine
reads it** — either a `blocked_by` edge naming the blocker, or the `deps-checked` label:

```sh
colab readiness <N>              # verified: no open blocker  (clear it again with --clear)
gh issue edit <N> --add-label deps-checked      # … the raw form, if colab is not installed
```

Prefer `colab readiness`: colab owns the write, so it is journaled like every other action,
takes the label name from one place, and is the single site the observer event will emit
from once its kind is agreed. The raw `gh` edit is the portable fallback and does the exact
same label write. That converts *unchecked* into *checked-and-free*, which is the one distinction the gate
cannot make for itself — an empty `blockedBy` is identical whether someone checked or
nobody did. A prose comment saying "no blockers" does not do this; it is unreadable to
the gate, which is the whole reason this convention exists.

**Set it only after looking, and check it has not gone stale before trusting it** — the
label carries no expiry of its own, so §0.2 derives one from the timeline.

**Confirm the label actually landed — an exit code is not evidence it did.** A repo that
adopted the conventions before `deps-checked` entered the set never back-filled it, so the
marking write targets a label that does not exist. `colab readiness` now diagnoses that
case loudly (it names the missing label and tells you to run handbook-sync) rather than
reporting a success that wrote nothing — but the raw `gh` fallback does not, and no command
can prove the *write* took from its own exit status alone. So after marking, read the label
back and treat empty as un-marked, not as done:

```sh
gh issue view <N> --json labels -q '.labels[].name' | grep -qx deps-checked \
  || echo "readiness did NOT land on #<N> — the label set is likely un-adopted; run handbook-sync (§7)"
```

An issue whose readiness "succeeded" but shows no `deps-checked` is the doubly-silent
failure this guards: the card never promotes and the next triage re-prints its cached
verdict without retrying. Surface it — do not trust the command's exit code over the tracker.

Single-issue mode is also a **scope**, and §0.1's coverage rule applies to it: a conclusion
reached about one issue answers for that issue and no other, no matter how still the repo
has been since.

## 5. The readiness gate — can this start *right now*?

A group is **ready** only if every one of these holds. Anything else is `blocked`,
with the blocker named:

- [ ] **Unclaimed** — no `in-progress`, no live claim.
- [ ] **Verifiably undone** — §2 passed against the code, not the tracker.
- [ ] **Actionable** — the Issue says what "done" looks like. An Issue that is a
      question is blocked on an answer, not ready to code.
- [ ] **Nothing it depends on is still missing** — read the **relationship**, never
      the prose: `gh issue view <N> --json blockedBy` (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough),
      *Readiness*). Prose saying "depends on the other one" is an explanation, not a
      record; it blocks nothing and no tool can act on it.
      **An open blocker is not automatically a blocker** — judge its state, per §5.1.
      **And empty is not "free" — it is "nobody looked".**
- [ ] **Trunk CI is alive** — ask by commit, not by recency (`CONVENTIONS.md` [§4](../../CONVENTIONS.md#4-branches-and-commits),
      #92): does a completed, successful run exist for `<trunk>`'s current head sha?
      (`gh run list --branch <trunk> -L 1` reads whatever ran *last*, and a
      cancelled straggler can outrank a passing run on the same commit under
      `cancel-in-progress`.) A failure that never started (billing lockout, runner
      outage) counts as dead. **What CI *is* here follows whether the unit has a
      branch, how much it must catch follows `exposure`**
      ([§7, *CI*](../../CONVENTIONS.md#ci--what-it-is-follows-the-units-shape-how-much-follows-exposure)
      — ⚖ #233 retired the `writes`-keyed reading): with a branch — the ordinary
      case, or an attended trunk-direct session falling back to full ceremony — it
      doubles as the pre-merge gate this bullet is checking you can still pass — if
      you cannot merge when you finish, you are not ready to start
      ([§6](../../CONVENTIONS.md#6-releases)). On an attended trunk-direct unit with
      no branch, a commit ships before CI ever runs — CI there is the alarm, not the
      gate — so being ready to start means nothing is already sounding it, and
      thoroughness is a question `exposure` answers, not a pre-merge check that
      structurally cannot exist.
- [ ] **No live worktree owns those files** — `colab worktrees`, and
      `git branch -a --list '*<n>*'` after `git fetch --prune`. A clean label does
      not prove clean ground: claims are released unconditionally at wrap, so an
      abandoned branch can exist with no claim on it at all.
      **Scope the check to this group's own deliverable paths.** `colab worktrees`
      lists every live worktree in the repo, most of them on files this group never
      touches; a repo-wide list is not evidence of contention unless it intersects
      the paths this group would actually edit. An empty intersection is not a
      finding — do not narrate it in the report, and do not let it vary the
      per-beat verdict when the only thing that moved was an unrelated worktree.
      Report contention only when there is a real path overlap, and name it.
      **A group's own members are the exception to "do not narrate it".** Where this
      group carries a `group:` label, a second live branch across its members is a
      **finding** regardless of whether this gate leaves the group ready — see §3,
      *Then ask the one-branch question*, for the check and §6 for the printed shape.
      That question is asked once per group, not re-derived here.
- [ ] **No pending decision** — no `needs-decision` label (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122),
      *Decision gate*). A surface awaiting a human answer is not a start candidate
      for anyone, manual or scheduled, until the decision is recorded — report it
      exactly as any other blocker, naming the label as what must be cleared and by
      whom.
      **Before re-applying `needs-decision` to an issue that already lacks it,
      check for a live `⚖ Decision recorded` comment or a `decision-recorded`
      label first.** A cleared gate with no positive record present is the
      unswept-but-genuinely-open state; a cleared gate WITH one of those present
      means the question was already answered — re-gating it reproduces a measured
      failure (#127: a ruling sat live in a comment, a triage pass saw no label and
      re-gated settled work). `colab decision --list` shows every issue with a live
      decision right now.
- [ ] **Delivery type is code, or not asked** — no `delivery:content` / `delivery:ops` /
      `delivery:docs-only` / `delivery:elsewhere` label (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#delivery-type--route-not-start-112), *Delivery type*). This issue was
      already filtered out at §2 if it carries one; this bullet is the reminder for a
      caller checking a single issue outside a full triage pass. **Absence is not this
      gate** — an unlabelled issue and one explicitly `delivery:code` both pass through
      unaffected; only an explicit non-code value routes.

### 5.1 An open blocker is not one verdict — look at what state it is in

`blockedBy` returning an open node used to end the question. It hides two situations
that behave nothing alike: a blocker **nobody has started**, and a blocker **whose code
is written and pushed**, its session over and stopped at the human merge gate. In the
second the dependency already exists — reporting it as `blocked` parks a session for
nothing (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough), *Readiness*).

So for each open blocker, ask what evidence exists that its work is real:

```sh
# §0 input 3 already returned each blocker as `BY <dependent> <owner>/<repo>#<B> <STATE>` —
# read that, do not re-query it. A second fetch of the same subgraph can disagree with the
# digest that was stored from the first, and nothing then says which one to believe.
gh issue view <B> --json state,number                      # only for a blocker §0 could not cover
git fetch --prune --quiet
git branch -r --list "*-<B>"                               # its branch, by trailing number (§3)
colab landed --branch origin/<that-branch>                 # landed · cargo · unknown
```

Ask about the **remote** ref, not a local one: a local branch may be ahead of what was
pushed, and what was not pushed is not evidence. `--branch` takes any ref, so the blocker's
branch need not be a worktree on this machine — which it usually is not.

| what you find on the blocker | verdict for the dependent |
|---|---|
| closed, or its branch reports `landed` | **clears** — its work is on trunk; open is tracker lag |
| a pushed branch reporting `cargo` | **soft** — the code exists, unmerged |
| no branch, or `unknown`, or unpushed, or a branch with no commits | **blocked** |

- **Any hard blocker outranks every soft one.** A group waiting on one unstarted issue
  and one merge-ready issue is `blocked`, not `ready with a note`.
- **An active session on the blocker is not evidence.** Nor is a claim, an assignee, or
  someone saying they are on it. Measured: a session open ten minutes was already dead,
  having never claimed the issue it was opened for — a dependent started on that would
  be waiting for something that never arrives. An open session is intent; a **pushed
  branch with real commits** is evidence. Unpushed does not count either: nobody waiting
  on it can see, review or merge it.
- **When you cannot tell, say `blocked`.** This gate fails toward blocked exactly as
  `colab landed` fails toward cargo — each refuses the optimistic answer, because that
  is the one that costs a session.
- **Do not record the soft verdict anywhere.** It is computed fresh each run, from the
  edge plus the blocker's state, and it is stale the moment the blocker moves. §4 says
  why: a relationship is a fact, readiness is a judgement, and the graph holds facts.
  The executable form of this table is `tools/lib/readiness.js` if a tool needs it.

Report the four states apart — `blocked by #N` · `soft: waiting on #N (code pushed,
unmerged)` · `free (checked)` · `dependencies unchecked`. Collapsing any of them into
another is how a group gets started into a wall, or left in a queue it could have left.

## 6. Report — make it directly actionable

**This report is console output, not a tracker write.** Print it to whoever is reading this
session; never post it, or any per-beat summary of it, as an issue comment. §0.2 names the
five writes this skill is authorised to make — a narrative verdict is not one of them, even
when the verdict is genuinely new information. If a group's verdict changed in a way worth
recording durably, that lands through one of the five named writes (the label, the evidence
comment, the plan/lane reason), never through a fresh prose comment invented for the
occasion.

For each **ready** group, give the four things a session needs to begin. The fourth,
`start:`, is **always the claim-and-worktree command** — ⚖ #233 makes this true on
every repo now, not just `writes: isolated` ones: triage's own output is consumed by
sessions that may be **unattended** (a dashboard auto-start, a scheduled driver), and
solo flow now requires `COLAB_HUMAN=1` — attendance transcribed from a live human
instruction, never inferred, never assumed by a triage report. `start:` may not emit
`colab solo` on any repo, because it cannot know whether the session reading it will
have a human behind it.

```
READY  fix/import-fixes-115-114-113   #115 #114 #113
       why: blocks the payroll import; trunk CI green 2h ago
       files: app/Import/*, tests/Import/*
       start: colab claim 115 114 113 --worktree import-fixes-115-114-113
```

**On a repo that does not declare `writes: isolated`, add a note — never replace
`start:` with it:** a human working the trunk checkout directly, in a live
conversation, may instead run `COLAB_HUMAN=1 colab solo --session <id>` where neither of
[§2](../../CONVENTIONS.md#writes--the-trunk-direct-veto-and-the-two-things-that-make-a-branch-mandatory)'s
two mandatory-branch conditions fires — but that is a human's choice to make in the
moment, not a command this report may hand to whatever reads it next. **`--session` is
mandatory on `colab solo` since #242** (it mints the same shared-checkout hold a
worktree-less `colab claim` does) — never drop it from the note, even though the note
itself is optional:

```
READY  fix/import-fixes-115-114-113   #115 #114 #113
       why: blocks the payroll import; trunk CI green 2h ago
       files: app/Import/*, tests/Import/*
       start: colab claim 115 114 113 --worktree import-fixes-115-114-113
       note: no writes: isolated veto here — a human at the keyboard may instead run
             `COLAB_HUMAN=1 colab solo --session <id>` (no branch mandatory; --session
             mandatory, #242); an unattended session must use the worktree command
             above regardless
```

A **soft-ready** group is startable, so it belongs in the ready list — but it carries a
line the plain ones do not, because a session picking it up needs to know both *what it
is waiting on* and *that the code already exists*:

```
READY* fix/import-fixes-115-114-113   #115 #114 #113
       note: waits on #98 — its code is written and pushed (origin/feat/parser-98,
             cargo), unmerged at the human gate. Start now; do not re-write it.
       why: blocks the payroll import; trunk CI green 2h ago
       files: app/Import/*, tests/Import/*
       start: colab claim 115 114 113 --worktree import-fixes-115-114-113
```

Name the branch in the note. Without it the operator cannot check the claim, and "the
code exists somewhere" is the kind of reassurance that sends someone to write it twice.

A group judged **mechanical + oracle-checkable** (the verdict below, after §5) carries one
more line — present only on the minority that earns it, absent from every other group:

```
READY  chore/relabel-status-columns-140-139-138   #140 #139 #138
       why: cheap and unblocking; trunk CI green 2h ago
       files: app/Reports/*.php (11 files, same rename across each)
       mechanical: yes — batch of 4; oracle: `php artisan test --filter=ReportColumns`
       start: colab claim 140 139 138 --worktree relabel-status-columns-140-139-138
```

A group carrying `low-priority` (the verdict below, after §5) carries one more line
too — present only on the minority that earns it, and printed **last** in the ready
list regardless of what its `why:` line says:

```
READY  fix/stale-log-cleanup-190   #190
       why: cheap and unblocking; trunk CI green 2h ago
       priority: low — startable, ranked last
       start: colab claim 190 --worktree stale-log-cleanup-190
```

A **UI-affecting** ready group — its files fall under a UI surface (views,
templates, frontend components, anything a design system consumes) — carries one
more line, reporting whatever `docs/design/` shows for it (`CONVENTIONS.md`
[§5](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two), *Design
conclusions are three units, not two*). This is a report line, not a new
readiness gate — the gate is the existing `needs-decision` check in §5 above; this
line exists only so "no artifact yet" is visible before a session starts building,
not after:

```
READY  feat/onboard-redesign-88   #88
       why: cheap and unblocking; trunk CI green 2h ago
       files: resources/js/Onboard/*.tsx
       design: docs/design/onboard-88-spec.md present — build to it
       start: colab claim 88 --worktree onboard-redesign-88
```

Three states, mirroring the ruling's table exactly:

- **present** — name the file(s) found under `docs/design/` for this slug/issue.
- **absent** — say so plainly. If nothing has applied `needs-decision` to this
  group yet, that is worth a human's attention before the session starts building
  — but absence is not a new gate to enforce here, it is the same `needs-decision`
  gate §5 above already checks.
- **superseded** — the artifact exists but a later ruling replaced it; name both
  files so a session does not build against the stale one.

Not UI-affecting → no `design:` line, same as `mechanical:` and `priority:` above.

Then, briefly:

- **blocked** — one line each, naming the blocker and who could clear it.
- **taken** — who holds it, and since when. A claim flagged *parked, wake condition due*
  (§2's `deferred:*` exception) gets its own line inside this bucket, not the ready list —
  name the `deferred:<kind>` and the `review-by:<date>` that passed, so a human can check
  whether the gate actually cleared instead of finding this by manual audit.
- **close these** — already shipped, with the evidence you found.
- **epics** — one line each, naming the container and (if its table is hand-maintained)
  whether it looks current. Never a start candidate; see §2.
- **route** — one line each, naming the delivery type (`content` / `ops` / `docs-only`)
  and where it actually needs to go. Never a start candidate for the code pipeline; see §2.

Then, **findings** — group-level, so they are not a bucket and do not compete with the
rule below. One block per group that broke the one-branch contract (§3):

```
FINDING group:cockpit-fidelity — 3 live branches in one group (contract: one)
        members:  #1530 #1531 #1533 #1536 #1540 #1542 (6 open)
        collide on: src/console/CockpitView.tsx, src/i18n/messages/cockpit.ts
        carrier:  fix/cockpit-fidelity-1530-1531-1533  (covers 3 members, cargo)
        then:     feat/cockpit-beat-1536 (1), fix/cockpit-i18n-1540 (1)
        land one at a time: each rebases onto trunk AFTER the carrier lands
        seen-at:  trunk e31a896, 2026-09-06T09:12Z
```

A group that already has a live carrier gets **`continue:`**, naming that ref — never a
`start:` line minting a second worktree. `colab worktree new` refuses an existing branch
anyway (#124, and `--force` does not override it), so a `start:` there would hand the
reader a command the CLI is guaranteed to reject:

```
FINDING group:import-fixes — 2 live branches in one group (contract: one)
        carrier:  fix/import-fixes-115-114  (covers 2 members, cargo)
        continue: resume the carrier — code-start step 3, "Found one → continue it, or ask"
        then:     fix/import-delimiter-113 (1) rebases after it lands
```

**Print the limits line on every pass, including a clean one** — the same discipline
`colab worktrees` applies to its orphan scan ("a clean result answers 'none THERE', not
'none anywhere'") and `colab holders` applies to a failed fetch. A findings section with
nothing in it is not a guarantee, and must not read as one:

```
findings: none — no second live branch in any group AT PASS TIME (trunk e31a896).
  Blind to: a branch created after this pass ended (caught on the next ping — a pushed
  sibling ref moves §0's `branches` digest, so the next ping cannot short-circuit); an
  unpushed branch on another machine; a ref whose name carries no open member number
  (the `colab holders` net covers this only where the group's `Because:` line names a
  path); a group whose evidence line names no path at all.
```

Never write a stronger promise than that line. Triage does not poll, so it cannot detect a
second branch mid-flight, and a report implying otherwise is worse than one that says what
it missed.

**Do not let an Issue vanish.** Every open number ends the pass in exactly one
bucket — ready, blocked, taken, epic, route, or close-it. A number that quietly falls off
the list gets re-triaged from scratch next time, which is how the same work gets
discovered three times.

### Then persist each verdict — the report is not the only consumer

**`ceremony: light` repo? Skip this whole subsection** — same reasoning as §4's
single-issue mode: nothing unattended ever reads the column on a repo that cannot
also carry `autonomy: auto-trunk`, so the write is pure cost. Rank and report as
normal; just do not journal the marker.

A ranked report is what a *human* reads. The other consumer is event-driven
(§0): its status column moves only on a write this skill journals, and §4's
marker write is the one this whole-repo path forgot — so a flawless pass can
leave every verdict printed and none of it persisted, and the consumer stays
blind despite a fully-correct run. Do the §4 write here too, once per group,
keyed to which verdict §5.1 returned — this is the §4 rule lifted into the
whole-repo path, not a new one:

- **free (checked)** — no open blocker at all → write the marker for every
  member, exactly as single-issue mode does (§4):
  ```sh
  for N in 115 114 113; do colab readiness "$N"; done   # deps-checked + readiness.marked event
  ```
- **soft-ready** — startable, but its blocker is still open (code pushed,
  unmerged; §5.1) → **do not** write the marker. `deps-checked` means *no open
  blocker*, which is false here, and §5 rejected a second label for the soft
  case for exactly this reason: it is a read-time judgement, recomputed each run
  from the edge plus the blocker's state, never persisted. The report line
  carries the soft verdict; the graph does not.
- **blocked** — leave the marker unset, and clear a stale one
  (`colab readiness <N> --clear`) if a blocker opened since it was last set
  (§0.2 computes that staleness). Empty is the right machine state for "not
  free"; a `deps-checked` sitting on a now-blocked issue is the lie §5 warns of.

Prefer `colab readiness` over a raw `gh` edit for the reason §4 gives: colab
owns the write, so it is journaled and the `readiness.marked` event fires from
the same site — the single signal the event-driven consumer actually receives.

**This is also where §0.3's per-issue cache gets written, once per pass.** After the
`$CACHE` fingerprint and `conclusion` writes (§0.1), write the pruned `issues` map: one
`{key, group, bucket}` entry per issue still open at the end of this pass — reused
verdicts included, not just freshly-derived ones, since a reused verdict's key has not
changed and stays valid to compare against next pass.

### Then flag hard groups with `needs-plan` — a label, not a plan (#94, `CONVENTIONS.md` [§5](../../CONVENTIONS.md#planning--a-plan-file-that-outlives-one-command-and-who-drafts-it-94) *Planning*)

Some READY (or soft-ready) groups are cheap to describe but hard to build: an ambiguous
ask, a design with no precedent in this repo, an issue set coupled by more than file
overlap. That judgement — *why this one is hard, seen across the whole backlog* — is the
one thing that dies with this triage session if it goes unwritten; a fresh implementing
session, working from a much narrower view, either re-derives it or misses it. This skill
does not draft the plan itself — that authoring, at triage time, produced stale artifacts
for groups that get reported startable and then sit unstarted for weeks. It leaves one
sentence behind that tells the session which starts the group to bother drafting one at
all; [`code-plan`](../code-plan/SKILL.md), run inside that session, does the drafting.

For each ready or soft-ready group you judge hard, flag its **lead issue** (the first
number in the branch name):

```sh
gh label create needs-plan --color 0052CC \
  --description "Triage judged this hard — code-start should run code-plan before coding" 2>/dev/null || true
gh issue edit <lead-issue> --add-label needs-plan
gh issue comment <lead-issue> --body "needs-plan: <one-line reason — the thing a
session working only this issue would not see from where you are sitting>"
```

- **One sentence, not a plan.** Do not draft the plan here even when the shape seems
  obvious — `code-plan` drafts it later, against the repo as it is at coding time, seeded
  with exactly this reason line.
- **Idempotent, same as §3's group evidence (§0.2).** The label add is naturally
  idempotent; grep existing comments for `needs-plan:` before posting a second reason —
  re-post only if the reason actually changed, and say what changed.
- **Not a readiness gate.** Unlike `needs-decision` (§5), this label never blocks a group
  from being reported ready. It only tells the session that starts it to plan before
  coding — the group is still startable now.
- **Most groups get nothing.** The label is for the minority genuinely judged hard. A
  `needs-plan` applied by default, on the theory that a plan can never hurt, is the same
  signal as `needs-plan` on nothing at all — it stops meaning anything a session can act on.

### Then flag delegable groups with `mechanical-lane` — a batch size, not a routing decision (#93)

A fleet that runs a second, cheap engine for batch-mechanical work only feeds it when
someone mid-session happens to remember it exists — which trends toward zero use, the
same failure `needs-plan` exists to prevent from the opposite direction (there, a group
too hard to hand to the default engine untagged; here, a group too easy to deserve it).
Triage is the one moment the whole backlog is in view, so it is the only place these
groups can be *assembled* rather than encountered one issue at a time.

For each ready or soft-ready group, ask one question, alongside — never instead of — the
readiness verdict §5 already computed:

> **Mechanical + oracle?** — is this group's work batch-mechanical (pattern conversion
> across files, boilerplate, spec'd translations, data-file generation) **and** is there
> an existing test command — or a cheaply-written one — that adjudicates it without
> human judgment?

Both yes → tag it. Anything else — including genuine doubt about whether the oracle
actually catches a wrong answer — leave it untagged; the column's job is to force the
question to be *asked*, never to lower the bar that decides it. Untagged is the default,
same as an unflagged group defaults to the expensive lane today — this flag only ever
narrows that default, it never widens it.

```sh
gh label create mechanical-lane --color 1D76DB \
  --description "Triage judged this batch-mechanical with a usable oracle — a candidate for the cheap engine lane, not the default one" 2>/dev/null || true
gh issue edit <lead-issue> --add-label mechanical-lane
gh issue comment <lead-issue> --body "mechanical-lane: <one-line why — the pattern being
converted or generated, and the oracle command that adjudicates it>
Suggested batch size: <N> — <why that size, not one big batch>"
```

- **Idempotent, same as `needs-plan` and §3's group evidence (§0.2).** The label add is
  naturally idempotent; grep existing comments for `mechanical-lane:` before posting a
  second reason — re-post only if the pattern or the oracle actually changed.
- **Not a readiness gate.** Same posture as `needs-plan`: this label never blocks a group
  from being reported ready, and never substitutes for the §5 gate. A group carrying
  both `mechanical-lane` and `needs-plan` is a contradiction worth a second look, not a
  state to write mechanically — a group hard enough to need a drafted plan first is not
  the batch-mechanical shape this flag describes.
- **Suggest a batch size, do not dictate the invocation.** Which engine backs the lane,
  how it is invoked, and its exact batch mechanics are per-fleet and deliberately outside
  this skill's scope (`CONVENTIONS.md` has none of that either) — the suggested size is a
  number and a one-line reason, not a runbook. Smaller batches have measurably
  outperformed one large batch in at least one adopting fleet's history; default toward
  smaller when unsure.
- **Most groups get nothing.** The label is for the minority genuinely both mechanical
  and oracle-checkable. Applied by default, on the theory that tagging can never hurt, it
  stops meaning anything a downstream lane can act on — the identical failure mode
  `needs-plan` already warns against, one section up.
- **Report it too.** A ready group carrying this verdict gets one extra line in §6, the
  same way a soft-ready group carries its `note:` line — a session (or a router reading
  the report instead of a human) should not have to re-derive the verdict from the label.
- **Has a second reader now: `code-ship` B1c (#262).** A rejected diff on an issue set
  carrying this label is the one case that skill's grading step may retry once,
  automatically, instead of stopping for a human — this label is the signal it reads to
  know a rung above the one that produced the diff exists at all. Nothing here changes
  because of that; it is one more reason not to apply the label loosely.

### Then rank `low-priority` groups last — a throttle, not a veto (#268)

`low-priority` is read three different, undocumented ways by the tools sitting around
this skill unless this check runs: a hard veto by one scheduled driver, a sort key
nothing enforces by a sibling tool, and — before this check existed — invisible to
`code-triage` itself, which reported a `low-priority` group **READY** with no
distinguishing signal at all. The convention (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#priority--a-throttle-not-a-veto-268), *Priority*) settles
which reading is correct: **`low-priority` orders a queue, it does not remove work
from one.**

For every ready or soft-ready group, check whether its lead issue carries
`low-priority`:

```sh
gh issue view <lead-issue> --json labels -q '.labels[].name' | grep -qx low-priority
```

- **Not a readiness gate.** Same posture as `needs-plan` and `mechanical-lane`: this
  label never blocks a group from being reported ready, and §5's gate is unaffected —
  it only changes where in the ranked list the group is printed.
- **Rank last, not off the list.** §4 already says this; this is the check that makes
  it mechanical instead of a judgement call re-derived per group. A `low-priority`
  group that also blocks other work (§4 rank 1) still says so in its `why:` line — the
  label moves its position, it does not erase the reasoning that would otherwise have
  ranked it higher.
- **Report it — one extra `priority:` line in §6, same shape as `mechanical:`.**
  Absent from every group not carrying the label — same discipline as `mechanical:`,
  present only on the minority that earns it.
- **A driver implementing the veto reading must say so where this check can be
  compared against it** — never leave the driver silently skipping what this report
  called ready. That disagreement is a finding to surface, not a difference to paper
  over by second-guessing the driver's behavior here.

Hand the top group to **code-start**, which will re-verify the claim before taking it.

## Verify complete

- **No write outside §0.2's five landed on the tracker.** In particular: no per-beat
  narrative verdict comment, no "Triage at trunk `<sha>`" note, no "re-measure — verdict
  CHANGED/REVERSED" update, no correction to any of these, no restated §6 report, no
  "still ready, unchanged" note — the report went to the console and nowhere else. A
  group's file-contention line, if reported at all, named an actual path overlap with this
  group's own deliverables, not the repo-wide worktree list.
- **One of the three required §0 outcome lines was printed, first, before anything else** —
  `unchanged` / `changed:<inputs>` / `no usable cache`. A run printing none of them did not
  run §0 as specified, whatever else it got right.
- A run that short-circuited said so, named the timestamp it compared against, and
  re-printed a stored conclusion whose scope covers what was asked.
- A run that proceeded wrote the **required** `$CACHE` shape — `version`, `scope`, `ranAt`,
  all five `fingerprint` keys, `lastRun`, and `conclusion` — not a partial record. A record
  missing any fingerprint key, or none of the five, is the failure #244 measured directly in
  this checkout: a cache nobody can compare against next time, that forces every future run
  to take the full pass regardless of what actually changed.
- The `issues` map (§0.3) was rewritten, not appended to — every entry corresponds to an
  issue still open at the end of this run, nothing else. A group verdict that was reused
  had every member's key checked, not just the one issue being printed.
- Re-running changed nothing that was already true: no duplicate `blocked_by` edge (`colab
  blocked` is idempotent on an already-present edge — §4, #251), no re-closed issue, no
  second copy of a group's evidence comment.
- Every multi-issue group survives this run: `group:<key>` on **every** member, one
  evidence comment naming the collision, and the label removed anywhere it stopped being
  true. A group that exists only in this report is the failure §3 describes.
- **Every group with two or more open members was asked the one-branch question** (§3) —
  including groups whose members all landed in `taken`, which is the bucket the motivating
  measurement's group would otherwise have vanished into unremarked.
- Every second live branch found is reported as a **finding** naming the carrier and the
  rebase order, and a group with a live carrier got a `continue:` line rather than a
  `start:` one that `colab worktree new` would refuse (#124).
- **No ref was rebased, pushed, deleted or otherwise edited by this pass.** Triage names
  the order; `code-ship` B0 performs it. Neither is among §0.2's five authorised writes.
- **The findings limits line was printed — clean or not** — and it claims only pass-time
  knowledge, naming what it is blind to. A findings section that reads as a guarantee of no
  second branch is a fail, not a wording nit: nothing here polls.
- The finding went to the console and to `$CACHE`'s `conclusion.findings`, and **nowhere on
  the tracker**. It is not a sixth write.
- Every open Issue is accounted for in exactly one bucket.
- The verdicts were **persisted, not only printed**: every free group got its
  `colab readiness` marker, every blocked group was left unset (or cleared if
  stale), soft-ready was left unmarked — and, where an event sink is configured,
  the `readiness.marked` events are present in the feed, not merely the
  `deps-checked` labels on GitHub. A pass that feeds an event-driven consumer
  verifies its sink, not only its GitHub writes.
- Every "ready" group passed all six gates, not just "nobody is assigned".
- Every open blocker was judged on its **state** (§5.1), not on being open — and every
  soft-ready group says what it waits on and names the branch the code is already on.
- No `blocked_by` edge was cleared merely because its blocker's code landed (`colab blocked
  --clear` refuses a closed blocker without `--force` — §4, #251).
- Every "already shipped" call carries evidence (sha + `file:line`) — not a hunch.
- Branch names carry all issue numbers in one trailing run.
- Every group judged hard got `needs-plan` on its lead issue plus a one-line reason
  comment — and it landed on the minority actually judged hard, not on every group as a
  default.
- Every ready or soft-ready group was asked the mechanical + oracle question; every yes
  got `mechanical-lane` on its lead issue plus a one-line reason and suggested batch
  size, and a `mechanical:` line in the §6 report — and, same as `needs-plan`, it landed
  on the minority actually both mechanical and oracle-checkable, not on every group.
- Every `low-priority` group was ranked last in §4's list — never off it, never sorted
  by its own blast-radius reasoning alone — and carries a `priority:` line in the §6
  report; §5's readiness gate treated it exactly like any other group.
- Anything surprising — a stale claim, a dead trunk CI, an epic whose table
  contradicts its title — is **reported**, not silently worked around.
