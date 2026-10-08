# code-triage · §0 Why each input reads what it reads

Reference for [`code-triage`](SKILL.md) §0. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).


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
  has. Deliberately still blind to: assignee, milestone, lock state, comment volume. §2's
  *Taken* rule does read assignee since #323 — but only to find a **half-claim**, which
  never makes a group startable, so an assignee change can only ever move an issue from
  "broken claim" to "taken" or "free" via the label or claim state this fingerprint already
  digests. The one miss: an assignee added to or dropped from an issue with no label and no
  other change — a pure half-claim appearing or being repaired. Re-run triage fully when
  one is being repaired rather than trusting a cache hit.
- **Input 3 digests BOTH directions, because an inbound edge is not visible on this side's
  `blockedBy`.** An edge written from another repository *toward* an issue here moves that
  issue's `blocking` count and never touches its `blockedBy`.
- **Digest the connections' `totalCount`, NOT `issueDependenciesSummary` — the summary
  lags behind the graph.** The connections are the authority; the summary is a cache of them.
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
  a failed one.
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

Why: [ADR 536](../../docs/adr/536-code-triage-0-fingerprint-notes-rationale.md).
