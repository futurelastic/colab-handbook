# colab

A tiny, portable CLI that lets **parallel coding sessions and agents on one machine** avoid
collisions. Three independent capabilities, each usable on its own:

1. **Issue claims** — so two sessions, on one machine or several, don't grab the same issue. The
   claim's record is its **branch on the git remote**, pushed at cut and refused against from any
   machine (#325); also written to local state (fast) and mirrored to GitHub for people
   (`gh issue edit --add-assignee @me --add-label in-progress`).
2. **Ports** — every dev server gets a unique port; a project's reserved trunk port is never handed
   to a worktree, even while that trunk server is down.
3. **Worktrees** — *optional* git worktrees, with machine-specific setup delegated to repo hooks.

Plain Node, **zero npm dependencies**. It shells out to `git` and `gh`. If `gh` is missing, claims
still stand and their tracker half is marked pending; a repo with **no remote at all** claims on
this machine alone and says so. The one hard stop is a remote that exists but cannot be read — a
claim then fails closed, because it could not be checked against another machine's (#325).

This generalizes three machine-specific scripts (`issues.active`, `ports.reserved`,
`worktree-new.sh`) so anyone, on any machine, in any repo, across any GitHub owner, can use them.

## Install

```sh
# symlink the entry point onto your PATH
ln -s /absolute/path/to/tools/colab ~/.local/bin/colab   # or /usr/local/bin
colab --help
```

Node >= 18. No build step, no `npm install`.

`../install.sh --tools` does this and one more thing: it also writes a **frozen copy** of the CLI
(`colab` + `lib/`) to `~/.colab/bin/`, stamped `# colab-handbook: colab-bin @ <version>`. The two
installs differ on purpose. A symlink resolves through the handbook's **working tree**, so it
follows whatever branch is checked out there — right for a human session, wrong for anything that
outlives one: an always-on service would change behaviour because of an unrelated checkout, keep
running, and report nothing. **Always-on services (launch agents, daemons, headless runners) call
`~/.colab/bin/colab`.** Re-freezing is deliberate — re-run `install.sh`; `colab update` reports the
copy when the CLI has moved on since its stamp, and `colab --version` names which install answered.
`../install.sh --check` goes one step further and names the commands an old frozen copy does not
dispatch (logic: `lib/install-check.js`). The copy carries no `templates/`, so `colab template`
refuses there, as `colab update` does.

**`install.sh` is a release artifact.** A new top-level command either gets a line in its "next"
block or an entry, with the reason, in `NOT_IN_NEXT` in `lib/install-sh.test.js` — the test fails
until one of the two lands. Anything `freeze_cli` copies must also be in `stamp.js`
`FROZEN_SOURCES`, or a change to it never marks a frozen copy behind; the same test holds the
two lists together.

## Quick start

```sh
# tell colab which repos to aggregate reserved ports from (once per machine)
colab config add-repo /path/to/repoA
colab config add-repo /path/to/repoB

# claim a group of related issues onto one worktree/branch
colab claim 115 114 113 --worktree import-fixes-115-114-113 --branch fix/import-fixes-115-114-113

# or let `worktree new` do it all: create the worktree, allocate ports, claim the group
colab worktree new fix/import-fixes-115-114-113 --issues 115,114,113 --ports 1

# cut from a long-lived line instead of trunk (only one declared in project.yml `integration:`);
# the base is recorded, and `colab ship` merges back into IT, never into trunk
colab worktree new feat/checkout-rewrite-42 --issues 42 --base v2

# has this work already landed on its base? (correct across squash merges — "commits ahead" is not)
colab landed --all

# who else is holding this file — fetches, then filters the raw git-log sweep through `landed`
# (refuses to answer "clean ground" if it could not fetch: an empty result off stale refs is wrong)
colab holders CONVENTIONS.md

# finish issues one at a time; siblings and the worktree survive
colab release 114

# tear the whole group down (releases all its claims, frees its ports)
colab worktree rm import-fixes-115-114-113

# heal drift (dead worktrees, orphan/stale claims, orphan ports)
colab doctor            # report
colab doctor --prune    # apply
```

Every command has real `--help`. Exit code is `0` on success, non-zero on failure, so scripts can
branch on it.

## Concepts

- **A worktree owns its ports.** Claims reference a worktree *by name*; they don't carry ports.
  This is why a group of issues shares one set of ports instead of duplicating them.
- **Claims are many-to-one with worktrees.** Multiple issues can be worked on one branch/worktree.
  Releasing one issue leaves the rest (and the worktree) alive. Removing the worktree releases the
  whole group.
- **Claiming and ports work without a worktree.** `colab claim 42 --session <id>` (a trunk
  claim — `--session` mandatory here since #242, see *Place-claims*) and `colab port alloc`
  are standalone.
- **A trunk claim's checkout hold ends with the last claim holding it (#305).** The no-worktree
  shape takes a place-claim on the checkout at `claim` time, and `colab release` gives it back —
  but a place-claim covers the *checkout*, not one issue, so `claim 1480 1481` mints two claims
  and ONE hold, and only the second `release` frees it. Ownership is proved from the claim
  record's own `session` (written by the same `claim` invocation that wrote the hold), never from
  an ambient `--session`: `colab release` has no such flag, so a stale claim swept long after a
  LATER session re-took the checkout correctly touches nothing. A failed GitHub write keeps the
  claim (`releasePending`) and therefore keeps the hold with it. **#312 brought the other three
  claim-deletion sites to the same rule** — the tie-break loser inside `colab claim`, `claims
  --sync --prune`, and `doctor`'s stale worktree-less-claim prune; the remaining sites are
  worktree-keyed and never took a checkout hold at all, and each says so at the site.
- **`--session` takes a URL or any stable id — but a session NAME in that slot is warned about
  (#306).** Nothing rejects a non-URL value (`requirePlaceIdentity` promises
  `<url-or-any-stable-id>`), but a value that looks like neither a URL nor a `session_…` id draws
  a warning at write time, because `place release`'s self-check is exact equality: a name recorded
  there means presenting your real URL later fails your own ownership check. See
  `docs/adr/306-session-identity-fixed-at-write-time-not-name-matched-at-release.md`. The warning
  still stands, but it is no longer the only backstop: #317's anchor proof recognises such a hold as
  the caller's own regardless of what string is on file.
- **"No branch" is `null`, and never the word `trunk`.** A claim held on the trunk checkout has no
  branch, and `trunk` is a *role* — the branch this repo merges into, `main` or `dev`. Recording the
  role word as though it were a name is refused on write (`colab claim --branch trunk` exits 1, and
  so does `colab worktree new trunk`), because everything downstream resolves that field as a ref:
  `landed` answered `unknown` on it, and `ship` — which matches claims to a branch **by name** —
  found none and merged with no `Closes #N`. See *Records that cannot be acted on*.
- **A worktree owns its base, and the base is the merge target.** It is trunk unless
  `--base <line>` named a branch the repo declared in `project.yml` `integration:`. `ship`
  merges into the recorded base rather than resolving trunk afresh — base and target are one
  decision, because a branch cut from a long-lived line and merged into trunk would carry the
  whole line in with it inside a single squash commit. Shipping a declared line itself into
  trunk is refused in every configuration, `autonomy: auto-trunk` included.

### Which remote (#301)

colab never assumes the remote is called `origin`. One resolver (`lib/git.js` `remoteInfo`)
picks it per repo, and every fetch, push, `ls-remote` and remote-tracking ref goes through it.
The first rule that matches wins:

1. `git config colab.remote <name>`, the explicit per-clone override. It wins even over
   `origin`. If it names a remote that does not exist, colab refuses.
2. A remote named `origin`. Every repo that has one behaves exactly as before.
3. `remote.pushDefault`, if it names an existing remote.
4. The only remote, when there is exactly one.
5. No remote at all: local-only. Commands keep their existing "no remote" behavior.

Anything else (several remotes, none of them `origin`, no `pushDefault`) is refused. The
message names the remotes and the fix, `git config colab.remote <name>`; colab never guesses.
`pushDefault` ranks below `origin` on purpose. It is a push-only setting used in fork setups,
and ranking it higher would silently move where trunk is fetched from in a repo that works
today. Fleet-wide commands (`doctor --sync`, `release status`) skip an ambiguous repo with
that message instead of aborting.

Elsewhere in this document, `origin` means "the repo's resolved remote". `gh` picks its
GitHub repo by its own rules (`gh repo set-default`), independently of this setting.

## Claim lifecycle (enforced)

Claims are **enforced, not advisory**. `colab claim` and `colab worktree new --issues` go through
three gates; `colab release` and `colab worktree rm` close the loop.

### 1. Refusal — check-then-refuse, three layers

Before a claim is written, colab checks three layers and **refuses with exit 1** if any says the
issue is taken:

- **Remote** (#325, first): `git ls-remote --heads <remote>` — asked of the remote directly, so a
  clone that never fetched sees what a fresh one would. A branch whose trailing number run
  (`CONVENTIONS.md` §4) carries the issue, and that no worktree/claim record in *this machine's*
  state names, is another machine's claim → refuse, naming `<remote>/<branch> @ sha` and the
  commands to continue it. **Remote unreachable → refused** (no local-only fallback, no `--force`).
  A repo with no remote at all skips this layer and says so. The branch is pushed by
  `colab worktree new` at cut (`--force-with-lease=refs/heads/<b>:`, create-only); a failed push
  with `--issues` removes the worktree + branch again and takes nothing.
- **Local** (always): if the issue already has a live claim in `state.json` attached to a
  *different* worktree (or a trunk claim vs. a worktree claim), refuse and print the holder —
  worktree, branch, host, and the date since. Re-claiming onto the **same** worktree is idempotent
  and succeeds silently-OK (so re-running a command is safe).
- **GitHub** (when `gh` is authed and the repo has an `origin`): `gh issue view <n> --json
  assignees,labels,comments`. A genuinely simultaneous pair of full claims is the *tie-break*'s
  job (§3), not this gate's.
  - **Assignee set** does not include your `gh api user` login, label present → refuse, naming the
    assignee.
  - **Half-claim** (#323, `CONVENTIONS.md` §5): a claim is the assignee *and* the label, so either
    half alone is a broken claim, not a free issue → refuse, naming the half present and the repair.
    Someone else's assignee with no label refuses; a label with nobody assigned refuses unless a
    live `🔒 Claimed` comment of *yours* shows it is your own interrupted claim. Your own assignee
    with no label is not a conflict — claiming completes it.
  - **Co-tenant** (#267, only checked when `claimIdentity` includes `session` — see *Identity
    granularity* below): the assignee set is keyed by GitHub login, so it cannot distinguish two of
    *your own* sessions on one machine. If a **live** `🔒 Claimed` comment exists from a *different*
    session under your own login+host, refuse and name it — `#N GitHub: live claim comment by
    <identity> (same account, different session)`.
  - **Another machine** (#325, always on): the assignee set is keyed by login, so it cannot say
    *which machine* holds the issue. A live `🔒 Claimed` comment under your own login from a
    different machine (canonical id, #327 — below) refuses: `#N GitHub: live claim comment from
    another machine (host …) — same account`.
  A failed/blank read is *skipped*, never treated as "free" (same rationale as `claims --sync` being
  add-only). If `gh` is unavailable this layer is skipped and the claim's tracker half is marked
  **pending** (`trackerPending`, ⚠ in `colab claims`): the claim stands on the remote and locally,
  and re-running the same claim once `gh` works posts the assign/label, comment and tie-break.

**One machine, one holder — whatever its hostname (#327).** Every claim and worktree record carries
`machine`, the canonical id from `lib/machine.js` (hardware-bound, drift-proof), beside the raw
`host` kept for display. Every comparison — the same-host upgrade, the co-tenant and other-machine
checks, the tie-break — goes through `claim-identity.js` `sameHost`: machine ids when both sides
have one, else the canonical hostname (`box.local` = `Box.` = `box.lan`). Legacy records without
`machine` are canonicalised on read, no migration. `colab doctor` lists records whose host no longer
matches this machine: *renamed* (same id) or *unproven* (no id / a different one — a pre-#327 rename,
or a file-synced `~/.colab`). Report-only.

**Planner claims (#326).** `colab claim N --session intent:<id>` holds an issue *before* the session
that will work it exists — an autopilot on each machine claims, then spawns. It takes no worktree
and no checkout place-claim, and needs `gh` (the tracker is its only cross-machine record — there is
no branch yet). The spawned session's `colab claim N --worktree …` or `colab worktree new --issues N`
from the **same machine** upgrades the record in place (one claim, real session + worktree; the
tracker's assignee, label and comment are not re-posted). `colab claims` shows it as
`intent:<id> (planner)`. One still carrying its intent id past `plannerClaimTTLMinutes` (default 30)
is a spawn that never claimed: `colab doctor` flags it; `doctor --prune --sync` releases its tracker
half and removes it (plain `--prune` keeps it — doctor only touches the tracker under `--sync`, and
deleting the local record alone would strand the half other machines see).

`--force` overrides **every** layer except an unreachable remote and prints exactly what it takes over
(`--force: taking over #7 from worktree "A" …`) — a takeover is always visible, never silent. Every
refusal ends by reminding you that stale claims from dead worktrees are freed by
`colab doctor --prune`, so a crashed session can never block an issue forever.

### 2. Claim comment — metadata on the Issue

On each successful claim (when `gh` is usable) colab posts **one** comment, in this **exact,
stable, machine-greppable** format (the refusal path and future dashboards parse it — do not reword):

```
🔒 Claimed — worktree `<name|->` · branch `<branch|->` · host `<hostname|h:<12 hex>>` · <ISO timestamp>[ · machine `m:<12 hex>`][ · session …]
```

**`host` names the machine only where the destination may (#369).** The same rule #367 applies to
a squash's `Machine:` trailer (`tools/lib/machine-trailer.js` `mayNameHost`): a forge that reads
PUBLIC, or `room: public`, gets the opaque token `h:` + sha256 of the canonical hostname (12 hex,
`tools/lib/machine.js` `hostToken`) in the same field instead of the name; a private forge — or an
unreadable one with `room: solo|team` — keeps the raw name; unreadable with no `room:` fails closed
to the token. The field keeps its place, so every older parser still reads the comment, and the
tie-break compares a token with a raw name by digesting the name (`sameHostName`). The token is
opaque, not secret: a hostname is guessable, and a guess can be confirmed against it. The same
value goes into every other comment colab posts with a `host` field — migration and CI grants and
their revokes (and the revoke hints printed when that post fails), decision records, dependency-edge
receipts — and a yield names its winner by the token too. `colab adopt` drops the host from the
provenance comments it commits into `.github/project.yml` under the same rule.

Both `worktree` and `branch` render as `-` when absent. `machine` (#327) is appended after the
timestamp — the four leading fields stay byte-stable for every older reader — and is a **digest**
(`m:` + sha256 of the canonical id, 12 hex): the raw id is a hardware serial, and the comment is
public on a public repo. It is omitted when no id resolved; a comment without it is compared by
canonical hostname. `branch` used to render the word `trunk`
for a claim that had none, which read as a branch name that never existed.

**A re-claim can never DOWNGRADE a known value (#264).** `branch`, `session` and `sessionName` are
**monotonic** for the same holder (same worktree): a `colab claim N --worktree w` run again with a
blank `--branch` keeps whatever branch that worktree's claim already recorded — it does not
overwrite it with `-`. This is what makes "claim before the branch is cut, then claim again once it
is" safe: the first call is idempotent-with-nothing-changed if genuinely nothing changed, but if it
*supplies new information* (a branch this worktree's claim did not have yet) it is a **correction**:
the local record is updated and **one fresh** `🔒 Claimed` comment is posted — printed as `#N
re-claimed — branch recorded: <branch> (was <old>)` — so any consumer reading the comment stream
(not just `state.json`) sees the fix too. A correction does **not** re-run the tie-break (§3);
acquisition was already settled at the first claim. A `--force` **takeover from a different holder**
never inherits the displaced holder's branch/session — the new record honestly reflects what the new
holder actually supplied, even if that means recording `-` (a trunk-checkout takeover that genuinely
has no branch yet is still an honest `-`, not a lie in either direction). See
`tools/lib/claim-identity.js` (`mergeClaimRecord`) for the exact rule.

On `release` / `worktree rm` it posts `✅ Released` — **unless the issue is already CLOSED**, in
which case it stays silent (a `Closes #N` merge already ended the story). Comments are
**best-effort**: a failed comment warns but never fails the claim itself.

**GraphQL rate limit → REST fallback, and self-describing residue (#164).** Claim comments, ship
comments, and the release write (unassign + delabel) all go through `gh issue comment`/`gh issue
edit`, which is GraphQL under the hood — a **separate** hourly quota from REST. If GraphQL is
exhausted while REST still has budget, `ghIssueComment`/`ghIssueRelease` (`tools/lib/git.js`) retry
once over the REST equivalent (`gh api`) instead of failing outright. If the release write still
fails on **both** transports, `colab release` / `colab worktree rm` do **not** clear the local claim
record — it is kept marked `releasePending` with a `releaseNote` (retry hint), so `colab claims`
shows a `⚠` instead of the claim silently vanishing while GitHub still shows `in-progress`. Retry
with `colab release <N>`.

**Release unassigns the claimer, not just `@me` (#363).** The release write reads who holds the
claim from the issue — the account behind the latest `labeled in-progress` event, via two REST
reads so a GraphQL-exhausted release can still make them — and unassigns it alongside the caller,
printing a line when that is a different login. A claim taken under one account and released
under another would otherwise lose its label and keep its assignee: a half-claim. Any other
assignee is left alone. The yield path passes `selfOnly`, because there the latest labeler is the
race's winner. A lookup that fails degrades to `@me` and warns that a half-claim may remain.

### 3. Tie-break — settling a true simultaneous race

GitHub has no atomic check-and-set on labels/assignees, so two sessions can both pass the refusal
gate in the same instant and both assign themselves. The claim comment is the substrate that breaks
the tie **deterministically**, so both racers independently reach the *same* verdict:

1. After posting our claim comment, re-read the issue's comments.
2. Compute the **live** claims: every `🔒 Claimed` comment not cancelled by a later release (#375):
   - a plain `✅ Released` cancels **every** earlier claim, **whoever** posted either — colab's
     release already clears the label and the claimer's assignee whatever account took it (#363),
     so the comment layer agrees with the label layer. Keyed on the release's author, a claim
     released under a second account stayed live in the comments forever and later "won" a race
     against a fresh claim on free work;
   - a yield, `✅ Released (yielded — earlier claim by <who> wins)`, cancels only its **own
     author's** earlier claims, and **never** the claim it names as the winner — a yield is one
     racer standing down, not a release of the issue.

   Each live claim carries `login`, `host`, `machine`, `session` (parsed from the comment body), and
   the comment's authoritative GitHub `createdAt`. The rule is a pure function of the comment list
   (`tools/lib/claim-comments.js`), so every reader of the same comments gets the same live set.
3. Identify **ours** = the **earliest** live claim that is the *same claimant* as us (see *Identity
   granularity* below) — **earliest**, not latest: a same-holder correction comment (the previous
   section) must never restart our own priority and cost us a race our first comment had already won.
4. If any **other** live claim (not the same claimant) has an **earlier** `createdAt` than ours,
   **we lost**. Exact-timestamp ties break on the identity string — the lexicographically smaller
   identity wins — so the verdict is fully deterministic even at equal timestamps.
5. On a loss we **yield automatically**: remove our local claim, post
   `✅ Released (yielded — earlier claim by <who> wins)`, and exit 1 telling the caller to pick
   another issue. We remove our GitHub `in-progress` label + `@me` assignee **only when the winner
   is a different GitHub user** — if the winner shares our login (another machine, or another
   session, of ours), the label/assignee is a single shared marker the winner still needs, so we
   leave it and let the comment layer record the handover. (This is a deliberate refinement of
   "remove our label only if we added them": on GitHub the label/assignee is keyed by login, not by
   host or session, so it cannot be split between two sessions of the same user.)

In `worktree new`, a lost issue is yielded the same way but the **worktree is kept** (its files may
already be set up) — reuse it for another issue or `colab worktree rm <name>`; the command exits 1.

#### Identity granularity — `claimIdentity` (#267)

"Same claimant" above is computed from a **configured** set of components, not a hardcoded
`login@host`:

- **`login,host`** (the default — unset behaves exactly as before this was configurable). Two
  sessions of your own account on one machine are **indistinguishable**: the tie-break's "never
  yield to ourselves" rule treats a co-tenant's live claim as our own, so neither racer can ever lose
  to the other. This was a measured near-miss, not a theoretical gap.
- **`login,host,session`** (opt-in: `colab config set claimIdentity login,host,session`) —
  distinguishes two sessions of one account on one host. **Only turn this on where `--session` /
  `COLAB_SESSION` is a STABLE id across a restart or resume of that session.** If it is not, a
  session's own earlier claim comment reads as a *different* claimant on resume and it will yield to
  itself — a property of how sessions are managed on your fleet, not of `colab`, hence a knob with a
  conservative default rather than always-on.
- **Degrade-on-missing**: `session` sharpens a comparison only when **both** sides being compared
  carry a non-empty one. A legacy comment with no session field (written before #242, or any
  comment where the session field is genuinely blank) still compares on `login,host` alone even with
  the fine setting active — otherwise turning the knob on would make every such comment from your
  own account read as a stranger, and any that is still live would instantly win every future race.
- A co-tenant yield's message is distinct and louder than an ordinary yield — it names both session
  ids, says which setting produced the verdict, and prints both undos (`colab claim N --force …`
  to take it back, `colab config set claimIdentity login,host` to stop distinguishing sessions) — a
  wrong self-yield here must be diagnosable in one screen.

See `tools/lib/claim-identity.js` for the implementation and `colab config -h` for the setting.

### 4. What `doctor` does NOT do

`colab doctor --prune` heals **machine-local** drift only (dead worktrees, orphan/stale claims,
orphan ports, and merged-worktree sweeps). It deliberately **never posts GitHub comments** and never
edits GitHub — a cleanup cron may be pruning another person's dead session on a shared machine, and
it must not speak on their behalf on the Issue. A stale GitHub `in-progress` label is instead healed
by the `claims --sync --prune` reconcile path (which acts on *your own* assigned issues).

It also **never kills a process.** `doctor` reports **ghost ports** — something is LISTENING on a
port inside the allocation window that the registry considers free — and stops at reporting, by the
same rule `worktree rm` follows: only a cwd inside a known worktree proves ownership, and a ghost
port by definition has no registry entry to prove anything. Killing by port would, in exactly the
case the check exists for (a stale registry), kill an unrelated process legitimately holding it. So
it joins the two books, names the disagreement, and leaves the verdict to you.

A long-running service that legitimately lives in the window (an emulator, a local database) is not
drift; declare it in `extraReserved` and it stops reporting *and* stops being allocatable. A ghost
whose `cwd` no longer exists is the real orphan — that one wants killing.

It also **never deletes a git ref**. `doctor` lists branches whose content is already in trunk —
`git branch --merged` cannot find them after a squash — and stops there, even under `--prune`,
printing the commands instead. Declared `integration:` lines are excluded from that list: a
long-lived line contains nothing new until work is merged into it, which is exactly when
suggesting its deletion would be most destructive. Every other prune touches only colab's own state file; deleting refs
across every repo a shared machine happens to know about is categorically different.

Because `ship` **keeps** branches by default, that list is the primary cleanup path and is *expected
to be non-empty*: one branch lands on it per shipped session. It therefore prints **after** the
health verdict and is **not** counted as drift — `All healthy — nothing to prune.` and a list of
shipped branches together is the normal steady state, not a contradiction. Work through it when
convenient.

Two exclusions, both deliberate. Branches checked out in a worktree are skipped: a live session's
branch is not spent, and a freshly-cut empty branch is "contained" by construction. And a branch
whose work trunk has since **rewritten** will *conflict* against trunk rather than match it, so it
is omitted rather than reported — being wrong in that direction would mean telling someone unmerged
work was finished. **The list is honest, not exhaustive**; a periodic human sweep is still worth
doing. Issue #17's own cleanup hit exactly this case.

## Session identity (which conversation)

Every claim and worktree can record a **two-part Claude session identity**:

| field | source (precedence) | typical value |
|---|---|---|
| `session` (URL) | `--session <url>` **>** `COLAB_SESSION` env **>** absent | `https://claude.ai/code/session_…` |
| `sessionName` (label) | `--session-name <s>` **>** `COLAB_SESSION_NAME` env **>** absent | `colab-handbook`, `pilot-issue-30` |

Either, both, or neither may be set — never an error, **except at the two call sites that mint a
SHARED-checkout place-claim** (`colab claim` with no `--worktree`, and `colab solo`): there,
`session` is now mandatory (#242) — see *Place-claims* in CONVENTIONS.md for why a blank one can
never be recognized as its own later re-acquire.

- Both fields are stored on worktree **and** claim entries; a claim made via `worktree new --issues`
  **inherits both** from the worktree. Standalone `colab claim` reads the same flags/envs.
- **Display precedence** (tables, refusal / takeover / tie-break / doctor holder lines): the friendly
  `sessionName` wins; else the URL compacted to its `session_…` tail; else `-`. `--json` always
  carries **both** fields raw.
- In the `worktrees` / `claims` tables a name with **no URL** behind it is suffixed `(!)`, with a
  legend under the table. Without that marker a half-identity row renders identically to a fully
  identified one — which is exactly how the state went unnoticed.
- **GitHub comments** (`🔒 Claimed`, `🚢 Shipped`) render the session tail by shape:
  - both → a markdown link ` · session [<name>](<url>)`
  - URL only → ` · session <url>` (the original form)
  - name only → ` · session <name>`
  - neither → **nothing** — the comment stays **byte-identical** to the no-identity format (parsers
    depend on this).
- The comment **parser** (tie-break / `liveClaimComments`) decodes all three shapes **plus** the
  legacy plain-URL form written before `sessionName` existed, so old comments keep parsing; the
  tie-break yield message shows the friendly form.

Why: `host` says which *machine* holds a claim; the session says which *conversation* — and a short
`sessionName` makes a table row readable at a glance while the URL stays one click away. When a claim
looks stale, that's the difference between "which laptop is this?" and jumping straight to the chat.

### The two fields are not equivalent

`sessionName` is **display text**. `session` is **the only join key**: a consumer resolves a worktree
to a live session through `worktree.session` → its `session_…` tail → the session. The name
participates in no join at all. So the failure is asymmetric:

| state | consequence |
|---|---|
| URL, no name | **cosmetic** — renders as `session_01Lz5rfq…`: ugly, still reachable |
| name, no URL | **structural** — reads as owned, traces to nobody. Worse than anonymous |
| neither | honestly anonymous |

Therefore `claim` and `worktree new` **warn** (never fail — some agents genuinely have no URL) when a
`sessionName` resolves non-empty while `session` resolves empty. The gap used to be silent at exactly
the moment it was cheapest to close.

**Identity is never inferred from the name.** A consumer tried by-name matching and reverted it: a
worktree named `console-views-30-31-32` sat beside a live session with a nearly identical name and
*was not it*. Absent identity renders as "unknown", never as a guess.

### Repairing an existing worktree — `worktree tag`

```sh
colab worktree tag import-fixes-115-114-113 --session "https://claude.ai/code/session_…"
colab worktree tag import-fixes-115-114-113 --session "<url>" --session-name "import-fixes"
```

- Writes the worktree record **and every claim attached to it**. Claims carry their own copies of
  both fields, and claims are what `colab doctor` reports on — a worktree-only repair would leave
  doctor still printing anonymous rows, looking like the fix failed. One command, both records.
- Only the fields you pass are overwritten; the other is left as-is.
- **No env fallback** (unlike `claim` / `worktree new`): a repair writes exactly what you type.
  Inheriting `COLAB_SESSION_NAME` from a shell that never had `COLAB_SESSION` is how the
  half-identity gets created in the first place.
- Already-posted `🔒 Claimed` comments are **not** rewritten — a comment is dated history, not
  current state. `~/.colab/state.json` is what tables and `doctor` read.

**Agents: pass `--session` / `--session-name` as flags, not exports.** Shell state does not persist
between tool calls, so an `export` made once evaporates before the later `worktree new` runs — which
silently produces the anonymous rows the export was meant to prevent. The env route is for a human
with a persistent shell.

## Worktree lifecycle (`status`)

A worktree entry carries a `status`, backfilled-on-read (older/absent → `running`):

```
  running ───────────────► merged ───────────────► (killed)
  created by              branch landed on trunk    teardown removes the
  worktree new / claim    AND no live claims        entry entirely — no
                          · ship sets it after B1   "killed" status is stored
                          · doctor auto-detects      (worktree rm, or doctor
                            & records on --prune       --prune sweeping a merged one)
```

- **running → merged** has two writers: (1) `colab ship` sets it right after B1 lands the squash on
  the target (so a `--keep-worktree` entry survives as `merged`); (2) `colab doctor` auto-detects — for
  a `running` worktree with **no live claims** whose branch has **landed on its base**, it records the
  flip on `--prune`. That question is one shared rule (`lib/landed.js`, also behind `colab landed`):
  merging the branch into its base yields the base's exact tree. It is correct for **squash merges** —
  an ancestry/rev-list test would miss every one of them — and stays correct when the base has moved
  on since. It is asked against the worktree's **recorded base**, so a session on a declared line is
  not judged against trunk. When it cannot tell — a base that rewrote the branch's work leaves a
  conflict and no content answer — the verdict is `unknown` and the worktree stays `running`.
- **Any live claim keeps a worktree `running`**, even if the current branch is already contained — a
  group with an unfinished sibling is not done.
- **merged → killed**: `colab doctor --prune` now **sweeps** merged worktrees still on disk (full
  teardown: pre-remove hook → `git worktree remove` → free ports → drop the entry, all local-only). It
  **refuses** a merged worktree holding uncommitted work — **tracked** changes or **untracked**,
  non-ignored files (reports it instead; this is the unattended path, so the untracked half matters
  more here than in `worktree rm` — nobody is watching a `--prune` sweep decide), and **also
  refuses** — leaving the entry in place — one whose directory removal failed or timed out, reporting
  it separately rather than dropping the entry while a husk (or a still-live directory) sits on disk
  with nothing left pointing at it (#62). `running` worktrees are **never** swept. Teardown removes the
  entry outright — "killed" is the absence of a record, not a stored status (per Boss: no need to save
  it). That absence is exactly what the
  optional local journal recovers, without adding a status to the schema: teardown emits a
  `worktree.removed` line carrying `livedMs` and the last `status`, so how long the worktree lived
  and whether it ever reached `merged` survive the record that is being deleted.

## Readiness (`lib/readiness.js`) — a pure classifier, plus one command that owns the marker

"Can this issue start right now?" has three answers, not two — `blocked`, `ready-with-a-note`,
`ready` — because an open blocker whose code is already written and pushed is not blocking in
practice; only the human merge gate stands between it and trunk. `CONVENTIONS.md` [§5](../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough) (*Readiness*)
is the rule; `lib/readiness.js` is the executable form of it, and `code-triage` §5.1 is the manual
procedure that reaches the same verdicts by hand.

It is **pure** — blocker facts in, verdict out, no git and no network — so a consumer computing
"startable now" (a dashboard, a vendored copy) can feed it facts it gathered its own way. It takes
the "written but unmerged?" half from `lib/landed.js` rather than counting commits a second time,
and it fails toward `blocked` in the same way `landed` fails toward `cargo`: neither will give the
optimistic answer from facts it could not measure. The **classifier** deliberately has no command —
computing the verdict needs facts gathered by `gh` reads this CLI does not otherwise make. But the
one input a human supplies, the `deps-checked` marker meaning "I looked, no open blocker", **is**
now owned by a command: `colab readiness <N>` (and `--clear`). Owning the write in colab makes it
journaled like every other action, gives the label name a single source (`lib/labels.js`, shared
with the audit), and is the site the observer event will emit from once its kind is agreed with the
receiver. The marker lives on GitHub, so the command refuses when `gh` is unusable rather than write
a mark no other machine can see; there is no local-only fallback.

Evidence is a **pushed branch with real commits**. An active session on the blocker is not evidence
(intent, not code — one measured session was already dead ten minutes in, having never claimed its
issue), nor is an unpushed branch, nor an empty one.

## Dependency edges (`lib/blocked-by.js`) — the `blocked_by` write, owned (#251)

The `blocked_by` dependency edge was the one write in `CONVENTIONS.md` [§5](../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough)
(*Readiness*) still hand-rolled `gh api`, and the one with two independent SILENT-failure modes
measured live on this repo: (1) the REST endpoint's payload is a global **database** id, not the
issue number a human types, so an empty variable or the issue number pasted where the id goes is
still a valid integer — the POST returns 200 and attaches whichever issue holds that id *anywhere*
on GitHub; (2) `blockedBy` is a **connection object** (`{nodes, totalCount}`), not an array —
`| length` reads `2` for an issue with zero blockers, so a hand-written guard can conclude
"already there" forever and never write the edge (#250).

`colab blocked <blocked> --by <blocker>` (and `--clear --reason "<why>" [--force]`) owns this write
the same way `colab readiness` owns `deps-checked`: it takes issue **numbers only** and resolves the
database id itself, reads the current edges before writing (idempotent — an already-present add or
an already-absent clear is a no-op), writes, and reads back to CONFIRM the edge names the intended
blocker before printing success — a read-back showing a *different* edge than the one just POSTed is
reported as a wrong-blocker error with the exact `gh api -X DELETE` remediation, never auto-"fixed".
`--clear` requires a `--reason` (colab cannot verify intent, so it records yours as a receipt comment
instead) and refuses a **closed** blocker by default — closing is not proof the edge is false, and
`--force` releases only that one guard. Cross-repo edges are refused structurally: the blocker is
always resolved through `gh api`'s own `{owner}/{repo}` placeholder, i.e. in the current repo.

`lib/blocked-by.js` is **pure** — the arg validation, edge-shape normalisation (the #250 trap),
presence check, resolved-blocker validation (failure mode 1's guard) and the read-back verdict are
all data judgements with no git/gh/network, so the two failure modes above are each pinned by a
three-line unit test (`lib/blocked-by.test.js`) instead of a subprocess fixture. `lib/blocked-cli.test.js`
covers the gh I/O wiring in `tools/colab` (`cmdBlocked`/`cmdBlockedAdd`/`cmdBlockedClear`).

No observer event is emitted for this write: `notify.js`'s `ACTION_KIND` is a closed vocabulary
agreed per-action with the receiver, and no `dependency.*` kind has been agreed yet (same posture as
`readiness --mechanical` and `solo` — see `pushEvent` below). The command's own source comments the
proposed shape (`dependency.changed`, payload `{state, blocker}`) for whoever agrees it later.

## State & config files (machine-local)

Everything lives under `~/.colab/` (override the directory with the `COLAB_HOME` env var):
`state.json` (current truth), `config.json`, `state.lock`, and — only if you opt in — `journal.jsonl`
(history; see `journal` below). Writes to the first are atomic (temp file + `rename`) and guarded by
a `mkdir`-based lock (`state.lock`) so concurrent sessions don't lose writes; the journal is
append-only and never participates in that lock.

### `~/.colab/config.json`

```json
{
  "repos": ["/abs/path/repoA", "/abs/path/repoB"],
  "extraReserved": [8765],
  "reservedFiles": ["~/code/.claude/ports.reserved"],
  "claimTTLHours": 24,
  "portRange": "5200-5999",
  "worktreeSubdir": ".worktrees"
}
```

| key | meaning |
|---|---|
| `repos` | repo roots to scan for reserved ports (`.github/project.yml` → `ports:`). The current repo is always included automatically. |
| `extraReserved` | reserved ports for **non-repo** services (a preview server, etc.). |
| `reservedFiles` | machine-local files of reserved ports to aggregate — for ports of repos **not** registered with colab (e.g. a pre-handbook global `ports.reserved`). Each file is parsed leniently: whitespace-separated port numbers per line, `#` starts a comment, non-numeric tokens ignored. `~` is expanded. Manage with `colab config add-reserved-file <path>` / `rm-reserved-file <path>`. |
| `claimTTLHours` | `doctor` flags worktree-less claims older than this (default 24). |
| `portRange` | default search window for `port alloc` / `worktree new` (default `5200-5999`). |
| `worktreeSubdir` | where worktrees are created inside a repo (default `.worktrees` — gitignore it). |
| `notifyUrl` | **absent by default** — optional observer endpoint, see below. Unset means colab makes no network call of its own, ever. |
| `journal` | **absent by default** — set to `true` for a local append-only record of every state transition and invocation in `~/.colab/journal.jsonl`, see below. Unset means colab writes no journal file, ever. Unrelated to `notifyUrl`: local file vs. remote push. |
| `claimIdentity` | **absent by default** (`login,host` behaviour, unchanged) — set to `login,host,session` to distinguish two of your own sessions on one machine in the claim tie-break (#267). See *Identity granularity* under *Claim lifecycle* above; only safe where `--session` is stable across a resume. |

### `notifyUrl` — optional event push (off by default)

Set it and each state-changing command POST one small JSON event each, as they succeed:

```sh
colab config set notifyUrl http://127.0.0.1:9000/api/events
colab config set notifyUrl ""      # unset — same state on disk as never having set it
```

| command | event `kind` |
|---|---|
| `claim` | `claim.appeared` (one per issue actually kept — an issue lost to the tie-break was never yours) |
| `release`, and each claim released by `worktree rm` | `claim.released` |
| `worktree new` | `worktree.appeared` |
| `worktree rm` | `worktree.removed` |
| `ship` (after the push succeeds) | `worktree.state-changed` |
| `readiness <N>` / `readiness <N> --clear` | `readiness.marked` (payload `{state: 'checked'\|'unchecked'}`; `--mechanical` emits nothing — see below) |
| `ship`, once per issue the merge carried | `issue.merged` (payload `{sha}`) |
| `issue-filed <N>` | `issue.filed` — the ONLY command here with no local write of its own; it exists purely to notify after a raw `gh issue create` (#102) |
| `gate-recorded [--fail]` | `gate.recorded` (payload `{ok, sha}`, keyed by repo + worktree name) — no local write of its own either; run right after code-wrap's own A3 quality-gate step (#116) |

Body: `{kind, ts, repo?, issue?, worktree?, session?, payload?}`.

**This is a secondary signal and is designed to be undependable.** The observers it exists for
already discover every one of these facts by polling `state.json` on a timer; the push only sharpens
the timestamp from *within a tick* to *the second it happened*, and records which host acted. So:

- **No retry, no queue, no response read, no error surfaced.** A dropped event costs an observer one
  tick of latency and nothing else. Never build something that needs the event to arrive.
- **It cannot fail or slow the command.** Each event rides a detached child process, so the CLI's
  own exit does not wait on it — a receiver that hangs is invisible to you (the child gives up after
  200 ms). Every push happens *after* the command's real work has already succeeded.
- **`kind` comes from a fixed map, because receivers keep a closed vocabulary** and answer 400 to
  anything else. That refusal is correct: a record counted by kind gets quietly half-right answers
  the moment one fact has two names. Adding an action means agreeing a kind with the receiver first.
- **Order is carried by `ts`, not by arrival.** Events are emitted in a deliberate order (claims
  before the worktree that held them), but each child races the others; inverted arrival has been
  observed. Sort by `ts`.

Unset, none of this exists: `notify()` returns before it can resolve a host, and the test suite
asserts that no process is spawned for any action.

**Two senses of the word "journal", and they are not the same thing.** Whatever a `notifyUrl`
receiver keeps on its own side is *its* record: remote, someone else's, and possibly empty, since
delivery here is undependable by design. The `journal` key below is *local*: a file on this machine,
written directly, never sent anywhere, and complete whether or not any observer exists. When both
appear in one sentence, say **receiver-side** or **local journal**. They share no code, no
vocabulary of kinds, and no configuration.

### `journal` — optional local record (off by default)

`state.json` answers *what is true now* and only that: records are **deleted**, not retired. So the
one number worth having — how long something lived — is destroyed at the moment it becomes knowable,
because the record being deleted is the only thing still carrying `created`. Set `journal: true` and
colab appends one JSON object per line to `~/.colab/journal.jsonl` (`COLAB_HOME`-aware):

```sh
colab config set journal true
colab config set journal false     # removes the key; the existing file is left alone
```

| kind | when | notable fields |
|---|---|---|
| `colab.invoked` | every invocation, success or failure | `cmd`, `argv`, `exit`, `durationMs`, `repo`, `cwd`, `pid`, `error?` |
| `worktree.created` / `claim.created` / `port.allocated` | a record enters state | the record's own fields |
| `worktree.changed` / `claim.changed` | a field changes in place (e.g. `status` → `merged`, which is what dates a merge) | `changed: {field: [before, after]}`, `ageMs` |
| `worktree.removed` / `claim.removed` / `port.freed` | a record leaves state | **`livedMs`**, plus the record as it was |
| `journal.truncated` | the file hit its size cap | `droppedBytes` |

What it is for — each of these is a query over the file alone, and none is answerable without it.
The examples use an **external `jq`**, which is not part of anything this repo ships and is not
present on every machine: `colab` itself parses its own JSON, and where a shipped path needs a
filter it uses `gh`'s built-in (`-q` / `--jq`). So these are one-off queries you run by hand, and
if `jq` is missing they emit nothing — which is silent, and harmless only because no digest is
taken of the output. Do not lift the pattern into a pipeline whose result is hashed or compared:
`shasum` of empty input is a stable, plausible value (`e3b0c44298fc1c14`) that reads as a
successful, unchanging answer forever.

```sh
# how long did each worktree live, and was anything merged first?
jq -r 'select(.kind=="worktree.removed") | "\(.repo) \(.name) \(.livedMs/1000)s \(.status)"' ~/.colab/journal.jsonl
# worktrees torn down with nothing landed
jq -r 'select(.kind=="worktree.removed" and .status!="merged") | .name' ~/.colab/journal.jsonl
# which invocations failed
jq -r 'select(.kind=="colab.invoked" and .exit!=0) | "\(.exit) \(.argv|join(" "))"' ~/.colab/journal.jsonl
# where the wall clock goes, per command
jq -r 'select(.kind=="colab.invoked") | "\(.cmd) \(.durationMs)"' ~/.colab/journal.jsonl
```

Design notes, in case a future change is tempted to relax one:

- **Off is absolute.** Unset, nothing here runs: the snapshot returns `null` on its first line, no
  path is touched and no directory created. A test spies on every `fs` write entry point and asserts
  that not one targets a journal path, because a grep cannot see a write it did not think to look for.
- **It cannot corrupt state, structurally.** The journal is a separate append-only file. It never
  reads, writes or locks `state.json`. Only the *diff* is computed inside the state lock; the append
  happens after the lock is released, so a slow disk blocks no other session, and every journal call
  is wrapped so that a failure to record can never fail the mutation being recorded.
- **The kinds above are ours, and are deliberately not `notifyUrl`'s.** That vocabulary is closed and
  owned by an external receiver; widening it for local use would force a change on a contract we do
  not own. Nothing here touches a socket.
- **`livedMs` costs no bookkeeping anywhere.** It is `now − created`, read one instruction before
  the record is destroyed. That is the whole trick, and it is why the hook is in `mutate()`.
- **Size-capped, oldest-first.** Past 5 MiB the file is truncated to its newest half on the next
  write, cut at a line boundary — and the truncation writes a `journal.truncated` line, so a count
  taken from the file can never mistake a trimmed history for a complete one. This is deliberately
  not a rotation scheme: numbered files and a compactor are more machinery than an opt-in local file
  earns, and each part is another thing that can fail inside a command doing real work.
- **`config set <key> <value>` is recorded without its value.** The key survives, so "who changed
  what, when" still answers; the value does not, because `notifyUrl` can carry a token and a local
  file that quietly accumulates credentials is a worse problem than the one this solves.
- **No per-step timing inside `ship`.** Invocation totals are free; per-step numbers mean editing the
  ship path itself, and new code on the path that merges work is a poor trade for a first version.

### `~/.colab/state.json` (version 1)

```jsonc
{
  "version": 1,
  "worktrees": {
    "import-fixes-115-114-113": {
      "name": "...", "repo": "/abs/repo", "branch": "fix/...",
      "base": "main",                   // cut from this, and `ship` merges back into it
      "path": "/abs/repo/.worktrees/...", "ports": [5230],
      "host": "machine", "session": "https://claude.ai/code/session_…",
      "sessionName": "colab-handbook",  // short human label (either/both/neither)
      "status": "running",              // running → merged (killed = entry removed);
                                        // `pending` = a claim stub, no directory yet
      "created": "<iso>"
    }
  },
  "claims": {
    "/abs/repo#115": {
      "issue": "#115", "repo": "/abs/repo",
      "worktree": "import-fixes-115-114-113",   // or null for a trunk claim
      "branch": "fix/...",                      // or null for "no branch" — NEVER the word `trunk`
      "host": "machine",
      "session": "https://claude.ai/code/session_…",   // both inherited from the worktree
      "sessionName": "colab-handbook",
      "created": "<iso>"
    }
  },
  "ports": {
    "5230": { "port": 5230, "owner": { "type": "worktree", "ref": "import-fixes-115-114-113" },
              "host": "machine", "created": "<iso>" }
  },
  "solo": {
    "/abs/repo": { "host": "machine", "session": "https://claude.ai/code/session_…",
                   "sessionName": "colab-handbook", "since": "<iso>" }
  },
  "places": {
    "/abs/repo/or/worktree/path": {
      "path": "/abs/repo/or/worktree/path", "repo": "/abs/repo",
      "branch": null,                          // same representation as a claim's — null or a real name
      "host": "machine", "machine": "iokit:1234-…",  // hardware-bound id, #289 — tolerate-absence, no migration
      "session": "https://claude.ai/code/session_…",
      "sessionName": "colab-handbook",
      "pid": 4242,                              // the anchor process's pid, never a `colab` invocation's own
      "pidKind": "anchor",                      // #288 — "anchor" (or absent) probed; "invocation" never is
      "since": "<iso>"
    }
  }
}
```

- **Global per machine**: ports are unique across *all* repos, so it's one file, not per-repo.
- Port `owner.type` is `worktree` | `claim` | `manual`; `ref` is the worktree name, claim key, or
  a manual label.
- `session`, `sessionName`, `status` and `base` are **backward-compatible**: entries written before
  they existed render as blank identity / `running` status, and a missing `base` falls back to the
  repo's trunk — no migration needed. See *Session identity* and *Worktree lifecycle* below.
- **`branch` is a real branch name or `null`.** Null means "no branch" — a claim held on the trunk
  checkout. Readers must tolerate it; it is not an error state, and it is what the word `trunk` used
  to say badly. `status: "pending"` is likewise readable as "a stub, not a worktree": it is the one
  status allowed a `null` path, written when a claim names a worktree that does not exist yet, and
  replaced by the real record when `colab worktree new` runs.
- **This file has readers outside this repo** — an internal dashboard joins worktrees and claims to
  live sessions straight from it. Treat the shape as a published contract: adding a field is safe,
  renaming or removing one breaks consumers you cannot grep for.
- **`solo` is keyed by repo, not by issue or worktree.** Solo flow (CONVENTIONS.md, *Solo flow*;
  `writes: serial`) makes no claim and no worktree, so it needed its
  own machine-local lock — `colab solo` writes it after its entry gate passes (no worktree/claim
  held, checkout on trunk, no unpushed branch, clean tree, no conflicting place-claim), and
  `colab solo --done` is the only remover, after re-checking clean + pushed. A consumer that infers
  activity from `worktrees`/`claims` alone will under-report a repo running solo — reading `solo`
  too is that consumer's own call, same as the readiness label's.
- **`places` is keyed by absolute checkout PATH** — the writer-verifiable hold `writes: serial`
  needs (CONVENTIONS.md, *Place-claims*; #136). Unlike `solo`, it is not repo-scoped: a repo running
  several worktrees needs one hold per checkout in use. `colab place check <path>` lets ANY writer
  ask "may I write here right now", not just `colab solo`'s own entry gate — the thing a spawn-time
  lock cannot answer for an implementer agent fanned out by a coordinator. **Never trust a stored
  flag for release** — every reader (`colab place check`, `colab places`, `colab doctor`) re-derives
  liveness from `pid` at read time; a record surviving its holder's death is expected, not a bug.
  `machine` and `pidKind` are backward-compatible the same way as `session`/`base` above — a record
  written before #288/#289 simply lacks them, no migration: `machine` (this machine's hardware id)
  replaces a raw hostname string compare so a drifted-but-same-machine record is not misread as
  foreign; `pidKind` (`'anchor'`/absent vs `'invocation'`) says whether `pid` may ever be probed for
  liveness, so a short-lived per-tool-call shell pid an agent recorded is kept as a human lead
  (`colab places`) without ever producing a false "dead" verdict. `anchorProof` (#317) is additive
  in the same way — absent on every pre-#317 record, and read by nothing except the ownership test
  below.
- **A hold is yours by session string OR by proven anchor, and a corpse is nobody's (#317).**
  `pidKind` alone cannot decide ownership: `resolveAnchor` rules 1, 2 *and* 4 all write `'anchor'`,
  but rule 4 records a bare `process.ppid` — the parent shell #242 rejected as an identity — so
  `anchorProof` (`verified` · `declared` · `default` · `none` · absent) is the second term.
  Self-ownership needs an `'anchor'` pid whose proof is `verified`/`declared`, alive, and this
  process or a proven ancestor of it right now; a `default` or absent proof never qualifies, which
  is what keeps #242 closed. A CONFIRMED-dead holder is cleared by the next command that writes at
  that path and needs no `COLAB_HUMAN` to release; `live: null` (unprovable) is never touched.
  `colab place check` and `colab ship`/`promote` report the answer as one of `free` ·
  `foreign-machine` · `own` · `dead` · `unknown` · `live-other`, with the exact next command. Full
  argument: `docs/adr/317-anchor-pid-self-ownership.md`.

### Records that cannot be acted on

A worktree/claim pair was once found holding `{"branch": "trunk", "path": null}`. The real branch
existed and was healthy; only the record was wrong — and it failed **silently in three places**:

| command | what it did | why nothing caught it |
|---|---|---|
| `landed` | resolved the ref, got nothing, answered `unknown` | `unknown` is honest; a sweep simply could not bucket it |
| `ship` | matched claims **by branch name**, found none, merged | `(none claimed)` was treated as benign, so **no `Closes #N`** |
| `doctor` | reported nothing | "dead" means the directory is *gone*; this record named none |

Three changes, one per failure:

- **On write** (`lib/records.js`, hooked into `state.mutate` so no write site can forget): a role
  word or an empty string is refused as a branch, and only a `pending` stub may carry a null path.
  It judges **problems this mutation introduced**, not the file — a record already broken stays
  writable, or `doctor` could not repair the very records it exists to find.
- **`ship`** refuses outright when the session's recorded branch resolves to no ref, and treats an
  empty claim set as suspicious rather than benign: it says loudly that the squash will carry no
  `Closes #N`, and **refuses** when some claim in the repo names a branch that resolves to nothing —
  because then "no claims" is a broken lookup, not a fact about the branch.
- **`doctor`** reports both shapes. `--prune` repairs only what a directory on disk proves (adopting
  its path and its checked-out branch, and the claims hanging off it); a branch nothing can see is
  never guessed.

A `pending` stub (see above — a claim stub with `path: null`, written by `colab claim --worktree`
for a worktree that does not exist yet) can itself end up unreachable, a mirror-image failure of the
same shape (#110): the claim that pointed at it gets repointed elsewhere (`colab worktree new`
derives its own key rather than reading the claim's), or the claim aborts before `worktree new` ever
runs. Either way the stub has no directory, no ports, no branch, and now no claim either — and its
only documented purpose was shielding a claim from the orphan pass, so once no claim points at it
that purpose is spent. `doctor` treats **zero claims referencing the stub** as proof, not a
probability: it is reported (and, under `--prune`, deleted outright) with **no TTL**, unlike the
sibling case just below of a stub a claim still holds, which stays age-gated (it may be mid-flight,
between `claim` and `worktree new`).

Repair by hand goes **through the CLI**, never by editing `state.json` — several sessions write to
it concurrently, so a read-modify-write there can lose another session's update:

```sh
colab release <N>
colab claim <N> --branch <real-branch> [--worktree <name>] --session <id>
```

`--session` is mandatory when `[--worktree <name>]` is omitted (#242, *Place-claims*) — a claim
with no worktree takes the trunk-checkout place-claim, and a blank session can never be
recognized as its own later re-acquire. Shown above unconditionally since it's accepted (though
not required) either way.

## Reserved ports — the design change

Previously reserved ports lived in one hand-maintained central file, and adding a project meant
editing **two** places (that file *and* a docs table) — a duplication that already drifted out of
sync. Instead, **each repo declares its own** reserved ports in `.github/project.yml`:

```yaml
trunk: main
ports: [5220]                 # this project's trunk dev server port(s) — never allocated
worktreePorts: [47150, 47199] # OPTIONAL: window this repo's worktrees allocate from
```

`colab` aggregates the reserved set across every repo it knows (`config.repos` + the current repo)
plus `config.extraReserved` **plus every `config.reservedFiles` entry**. One source of truth per
project, no central duplication. See it with `colab ports` or `colab config show`.

### Worktree port window (`worktreePorts`)

`ports:` is a repo's **reserved trunk** ports. `worktreePorts: [lo, hi]` is the separate, optional
window that **worktrees of this repo** allocate from. When allocating for a worktree of repo *R*,
the search range resolves in precedence order:

1. an explicit `--range A-B` (or `--at`) flag,
2. *R*'s `.github/project.yml` `worktreePorts`,
3. the global `config.portRange`.

So a repo can keep its worktree servers in a dedicated band (e.g. `47150–47199`) without touching
the global default. Pairing (even/odd, etc.) is **not** built into the CLI — it's too repo-specific;
use `--at` for exact ports (below) or let the repo's `post-create` hook adjust.

### Exact port pinning (`--at`)

`colab port alloc --at p1,p2,...` and `colab worktree new --at p1,p2,...` pin **exactly** those
ports instead of first-fit within a range. Any port that is reserved or already allocated is
**refused (exit 1)** — the same refusal semantics as reserved ports. `--at` is mutually exclusive
with `--count`/`--range`/`--ports`. It's the way to get a specific parity, e.g. an even base for a
pair: `--at 47150,47151`.

## Worktree hooks contract

The portable core does only universal steps: fetch origin, create the worktree from
`origin/<trunk>` (trunk read from `.github/project.yml`, else `origin/HEAD`), copy `.env*` if
present, allocate ports, record state. **Machine-specific setup** (DB cloning, dependency
symlinking, dev-server restarts) is *not* hardcoded — the adopting repo provides optional hooks:

| hook | when | non-zero exit |
|---|---|---|
| `<repo>/.colab/hooks/post-create` | after a worktree is created | **warning** (worktree already exists) |
| `<repo>/.colab/hooks/pre-remove`  | before a worktree is removed | **aborts** removal (unless `--force`) |
| `<repo>/.colab/hooks/pre-ship`    | during `colab ship` B0, in the **branch** worktree, to regenerate generated files that conflicted | **aborts** the ship (nothing has been pushed yet) |
| `<repo>/.colab/hooks/post-ship`   | after `colab ship` pushes, in the **trunk checkout** — trunk targets only | **warning** — the merge already landed (#304) |

Each hook is run only if it exists **and is executable**. It receives:

- **argv:** `<worktree-path> <port> <port> ...`
- **env:** `COLAB_WORKTREE_PATH`, `COLAB_WORKTREE_NAME`, `COLAB_BRANCH`, `COLAB_PORTS` (csv),
  `COLAB_REPO`, `COLAB_TRUNK`, `COLAB_BASE`, `COLAB_ISSUES` (csv)
- `post-ship` additionally: `COLAB_TARGET` (branch merged into), `COLAB_SHA` (the squash commit),
  `COLAB_LOCKFILES` (csv of dependency lockfiles this merge changed — empty when none did)

### `post-ship` — the trunk-side half

`post-ship` is where trunk-side machine-specific work belongs: **re-install dependencies**,
migrate the trunk DB, restart the trunk dev server. It exists because a merge is not a checkout
update — `colab ship` commits the squash *in the shared trunk checkout* when the target is trunk,
and nothing re-installs `vendor/` or `node_modules/` afterwards. A merge that adds a Composer
package therefore leaves a trunk whose installed tree does not match its lockfile, and anything
regenerating committed output from that tree (a route-binding generator, an always-on dev server)
can **delete** those committed files, leaving trunk dirty and blocking every other session's ship
(#304 — `docs/gotchas.d/`).

Four rules, and they are the whole contract:

1. **Trunk targets only.** A merge into a declared `integration:` line happens in a throwaway
   worktree; there is no long-lived installed tree to go stale.
2. **`COLAB_WORKTREE_PATH` is the trunk checkout**, not a worktree — this is what distinguishes
   `post-ship` from `pre-ship`, which runs in the *branch* worktree during B0. `post-ship` also
   **runs** there (its `cwd` is the trunk checkout), so a bare `composer install` reaches the right
   tree; `post-create`/`pre-remove` still inherit colab's own cwd, unchanged.
3. **Non-zero is a warning, never a failed ship.** The push has already landed; an error exit
   would read as "ship failed" and invite a re-merge.
4. **The hook must leave the trunk checkout clean.** A dirty trunk blocks every other session's
   ship — precisely the failure this hook exists to prevent.

With no `post-ship` hook, a merge that changed a lockfile prints a warning naming the file and the
install command. **`colab` never runs a package manager on your checkout itself** — the same rule
that keeps DB cloning out of the portable core keeps `composer install` out of it.

```sh
#!/bin/sh
# <repo>/.colab/hooks/post-ship — trunk checkout is $COLAB_WORKTREE_PATH
set -e
cd "$COLAB_WORKTREE_PATH"
case ",$COLAB_LOCKFILES," in *,composer.lock,*) composer install --no-interaction ;; esac
case ",$COLAB_LOCKFILES," in *,package-lock.json,*) npm ci ;; esac
```

Example `post-create` that clones a MySQL DB and symlinks `node_modules` (the kind of logic that
used to be baked into the machine-specific script):

```sh
#!/bin/bash
set -euo pipefail
WT="$1"; shift
[ -f "$WT/package.json" ] && ln -snf "$COLAB_REPO/node_modules" "$WT/node_modules"
# ... clone DB into <db>_wt_<name>, rewrite $WT/.env, etc.
```

> **Gotcha — the ignore rule must be `node_modules`, not `node_modules/`.** The trailing
> slash matches a **directory only**, and this symlink is a *file*. So a repo whose
> `.gitignore` uses the common `node_modules/` form does **not** ignore the link:
> `git status` in every Node worktree then shows `?? node_modules`
> (`git check-ignore -v node_modules` confirms no rule matches), which trains people to
> tune out `git status` and quietly weakens "the worktree is clean" as the end-of-session
> check that wrap and teardown rely on. Drop the trailing slash — `node_modules` (no slash)
> matches both a real directory and this symlink, and the untracked entry disappears.

## Command reference

Run `colab <cmd> --help` for full detail.

| command | purpose |
|---|---|
| `claim <issue>... [--worktree N] [--branch B] [--session S] [--session-name S] [--force] [--repo P]` | claim one or many issues (atomic; onto one worktree). **Enforced** — see *Claim lifecycle* below |
| `release <issue> [--repo P]` | release a single issue; siblings + worktree survive. A no-worktree claim's **checkout place-claim** is given back too, but only on the LAST such claim this session holds there, and only when the claim record's own session matches the hold (#305) |
| `issue-filed <issue> [--repo P]` | notify-only event (`issue.filed`, #102) for an issue a raw `gh issue create` just made — no state.json entry, no label, no gh call of its own |
| `gate-recorded [--sha S] [--fail] [--worktree N] [--repo P]` | notify-only event (`gate.recorded`, #116) for code-wrap's own A3 quality-gate step — no state.json entry, no label, no gh call of its own |
| `solo [--force] [--session S] [--session-name S] [--repo P]` \| `solo --done [--repo P]` | entry-gated trunk-direct flow — `writes: serial` only, no issue/claim/worktree (see *Solo flow*, CONVENTIONS.md) |
| `place acquire\|check\|release <path> [--repo P] [--session S] [--session-name S] [--force]` | path-scoped, machine-local checkout hold `writes: serial` needs (see *Place-claims*, CONVENTIONS.md; #136). `check` exits 0/1/2 (free-or-mine / held-by-a-live-other / liveness-unknown-or-lock-unreachable); releasing someone else's hold requires `COLAB_HUMAN=1` |
| `places [--json]` | list every place-claim on this machine, liveness resolved right now (never a stored flag) |
| `readiness <issue> [--clear] [--repo P]` | own the `deps-checked` marker ([§5](../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this)): add it after verifying no open blocker, `--clear` on a new blocker or reopen. Journaled; refuses when `gh` is unusable (the marker has no local-only form) |
| `blocked <blocked> --by <blocker> [--clear --reason R [--force]] [--repo P]` | own the `blocked_by` dependency-edge write (#251): numbers only, resolves the database id itself, reads before writing, reads back to confirm. `--clear` requires `--reason` and refuses a closed blocker without `--force`. Refuses cross-repo; refuses when `gh` is unusable |
| `claims [--json] [--sync [--prune]]` | list (grouped by worktree); `--sync` **adds** claims found on GitHub (assigned + in-progress); `--prune` also **removes** local claims GitHub no longer shows |
| `port alloc [--count N] [--range A-B \| --at p1,p2,...] [--worktree N \| --claim I \| --label S]` | allocate consecutive free ports, or pin exact ports with `--at` |
| `port free <port> \| --worktree N \| --claim I` | free ports |
| `ports [--json]` | list allocated ports + the reserved set |
| `worktree new <branch> [--issues N,M] [--ports N \| --at p1,..] [--name X] [--trunk T] [--session S] [--session-name S] [--repo P]` | create a worktree (optional) |
| `worktree rm <name> [--force] [--repo P]` | remove a worktree; release its group; free its ports. Refuses on uncommitted work — tracked changes **or** untracked, non-ignored files (the latter is the only category with no copy in the index, a commit, or the remote; ignored build output and copied `.env` files never block) — **or** processes the worktree owns (cwd inside it); `--force` overrides both, terminating the owned processes. Ports still bound afterwards are reported as such, never as freed. Directory removal (and the pre-remove hook) is bounded at 5min (`COLAB_TEARDOWN_TIMEOUT_MS`); a failed or timed-out removal leaves the claim(s) and state record in place for a retry instead of releasing them anyway, unless `--force`. A directory missing `.git` (an earlier removal interrupted partway) is recognized as a **husk** and finished by hand rather than re-fought with `git worktree remove`, which can never succeed against it |
| `worktree tag <name> --session S [--session-name S]` | **repair** session identity on an existing worktree **and its claims** (see *Session identity*) |
| `worktrees [--json]` | list worktrees (status + on-disk liveness); also reports directories git never linked at all (no `.git`) but that look worktree-shaped (`CLAUDE.md` + `.github/project.yml`) — reports only, never prunes (#99) |
| `ship [--worktree N \| --branch B \| --direct \| --batch B1,B2[,B3]] [--message M] [--keep-worktree] [--delete-branch \| --keep-branch] [--adopt] [--session S] [--dry]` | `code-ship`: squash-merge a session branch → trunk. `--batch` (#373): up to `ship-batch:` green branches tested as one combined head, then one fast-forward (see *Batch landing*). The branch is **kept** unless `--delete-branch` — except a Refs-only ship (nothing closed), which deletes it unless `--keep-branch` (#368). Gated by repo autonomy (see *Phase B autonomy ladder*). `--direct` (#302): evidence-close for a branchless trunk-direct unit — this session's no-worktree, no-branch claims, once the work is published; refused where #350's core-path rule is active and the unit touched a core path (#351 — redo it on a branch). `--adopt` (#324): required to ship a no-digit branch that exists only on origin with no local claim — or whose local ref a git checkout here created from origin's copy (reflog, #343); the squash records a `Colab-Adopted:` trailer. After it closes an issue, it also closes that issue's native parent, with an evidence comment, when `lib/container-close.js` says the container is spent: labelled `epic`, every sub-issue closed, no unticked item in its body (#371) |
| `promote [--repo P] [--message M] [--dry]` | **promotion** trunk → main (`--no-ff`). Gated by `deploy` + `promotion`; never tags/deploys directly (see *Promotion*) |
| `doctor [--prune] [--ttl H] [--json] [--sync]` | heal dead worktrees / orphan + stale claims / orphan ports; report records whose branch or path cannot be resolved, including a zero-claim `pending` stub (no TTL — see *Records that cannot be acted on*); flip + sweep **merged** worktrees (see *Worktree lifecycle*); **list** shipped branches awaiting deletion (never deletes them); `--sync` also flags a worktree-less claim the tracker no longer shows assigned+in-progress (no TTL either) and spent `group:<key>` labels |
| `release-notes [<range>] [--repo P] [--out F] [--headline "..."]` | grouped Markdown release summary from git history (see below) |
| `release cut [--repo P] [--bump patch\|minor --reason "..."] [--dry] [--json]` | cut a release **candidate** `vX.Y.Z-rc.N` on `origin/main` where §6's rung allows it and all four conditions hold on that commit; never a final tag (see *Release cut*, below) |
| `release finalize [--repo P] [--tag RC] [--answered-by N] [--dry] [--json]` | a candidate's next step under §6's rung — `testing` / `held` / `needs-new-candidate` / `refused` / `candidate-ready` / `finalized`, re-checked every run, one tracking issue per version; tags the final only where the rung row makes it automatic, or behind the human bar (see *Release finalize*, below) |
| `template [<name>] [--dest F] [--repo P] [--force]` | copy a handbook workflow template into a repo, **stamped** with the handbook version (see below) |
| `update [<repo>...] [--apply] [--json] [--quiet]` | sweep the fleet registry for stamped copies that fell behind a changed template; `--apply` refreshes the **pristine** ones. Never commits; never touches a hand-edited copy (see below) |
| `register [<path>] [--remove] [--list]` | add/remove a repo in **both** fleet registries at once; `--list` flags drift (see below) |
| `config [show \| add-repo P \| rm-repo P \| add-reserved-file P \| rm-reserved-file P \| set K V]` | manage config (`set` keys: `claimTTLHours`, `portRange`, `worktreeSubdir`, `notifyUrl`, `journal`, `claimIdentity`) |
| `adopt [--repo P] [--json] [--no-verify] [--axis a,b] [--room R] [--exposure E] [--writes W] [--channels C] [--production U\|none] [--deploy D] [--stack S] [--answered-by N] [--reason "..."]` | detect + ask + derive + WRITE CONVENTIONS.md [§9](../CONVENTIONS.md#9-adopting-this)'s five rows (`tier`, `room`, `exposure`, `writes`, `channels`) in one act (#199) — a complete descriptor just reports; a flag makes the whole run non-interactive, a TTY prompts, neither refuses fast. Lowering `exposure` (or a first `none`/`self`) needs a human (`COLAB_HUMAN=1` + `--answered-by`, or a terminal); raising, or a first `live`/`released`, does not. Append-only — never rewrites an existing byte; never writes `tier` unless `exposure` ends unanswered |

### Release notes

`colab release-notes` builds a grouped Markdown release summary from git history — the same
grouping the release workflow (`templates/release-tag.yml`) produces, but runnable locally. It
exists because when org GitHub Actions was billing-locked the workflow couldn't run and the
summary had to be hand-built; this makes that path first-class and non-drifting. The subcommand
and the workflow's summary step are **deliberate copies** of each other (the workflow must stay
self-contained git+shell, so they can't share code) — a comment in both says to edit them together.

Non-merge commit subjects in the range are grouped by Conventional Commit type
(`feat, fix, perf, refactor, docs, chore, test`) with per-group counts, plus an `Other` bucket for
unprefixed subjects. The range defaults to `<most recent tag reachable from HEAD>..HEAD`; with no
tags and no explicit range it errors rather than guessing. `--headline "..."` inserts one sentence
after the commit-count line; `--out <file>` writes to a file instead of stdout.

Composable — pipe straight into `gh`:

```sh
colab release-notes v0.3.0..v0.4.0 | gh release create v0.4.0 --notes-file - --generate-notes
```

### Release cut (candidates)

`colab release cut [--repo P] [--bump patch|minor --reason "..."] [--dry] [--json]` (#338) cuts a
release **candidate**, `vX.Y.Z-rc.N`, on `origin/main`'s head — the tooling behind CONVENTIONS.md
[§6's release rung](../CONVENTIONS.md#6-releases). It never creates a final `vX.Y.Z`; finalizing a
candidate after its test period is `colab release finalize`'s (*Release finalize*, below), and is a
human act wherever the tag reaches production.

Everything is measured **at the commit the tag would name**, not at the checkout: the workflows
that would fire on the tag push are read from that commit, and a green trunk head later on does
not count for it. Every check is reported, each by a stable `condition` name (`--json` keys on
them), and any one failing refuses the cut:

| condition | refuses when |
|---|---|
| `release-policy` | the rung row + the `release:` block leave candidates off, or the block is invalid — `tools/lib/release-policy.js`, the audit's own reading |
| `prerelease-trigger` | a deploy workflow's tag trigger matches `v1.2.0-rc.1` — `tools/lib/workflow-triggers.js`, the audit's own check (#332), either severity |
| `version` | no bump is owed, a major is (a breaking change on ≥1.0, `--bump major`, the 0.x → 1.0.0 step), there is no final tag yet, or the version is already final |
| `already-candidate` | the commit already carries a candidate of that version |
| `ci-green` | §6 condition 1: not every run at the commit finished with one success — `colab ship`'s whole-sha check |
| `full-suite` | §6 condition 2: some workflow that ran at the commit has no successful run (a cancelled-only workflow never ran its tests; `ci-green` alone reads that as green) |
| `schema-additive` | §6 condition 3: a migration since the last final tag is destructive — Laravel `database/migrations` with a drop/rename/`->change()` in `up()`, Prisma SQL with `DROP`/`RENAME`/`ALTER COLUMN` — or an existing migration was edited or deleted. Other layouts are not read |
| `switch-dependencies` | §6 condition 4: a `colab:switch` marker is malformed, or a finished switch `needs` one that is not finished |

The bump is `release-status`'s suggestion since the last **final** tag (candidates skipped): fix →
patch, feat → minor, a breaking change → minor pre-1.0 and a refusal from 1.0 on. `--bump` may
override it to patch or minor with a `--reason`; the chosen bump, the override and every condition's
detail are recorded in the annotated tag's message. The tag is pushed to origin; if the push fails
the local tag is deleted again, so a refusal or a failure never leaves a candidate behind.

`schema-additive` is a heuristic and fails closed; it is not the §6 judgement about breaking
changes the commit types do not reveal, which the release notes still owe.

The handbook's own `scripts/release.sh` is the other half: it refuses a `-rc` version (candidates
come from here), computes its notes range from the previous **final** tag, and tags a final on its
version's newest candidate commit when one exists — and, when an agent has already tagged the final
through `colab release finalize`, resumes from its publish-and-reconcile step.

### Release finalize

`colab release finalize [--repo P] [--tag vX.Y.Z-rc.N] [--answered-by N] [--dry] [--json]` (#339)
takes the newest candidate one step further under §6's release rung, and is run — repeatedly — by
the [`release-rung`](../skills/release-rung/SKILL.md) skill in a coordinator session. There is no
daemon: every run re-measures from git and GitHub, and the decision is `tools/lib/release-finalize.js`
(pure). Every run ends in exactly one `state`:

| state | meaning | exit |
|---|---|---|
| `no-candidate` | no `vX.Y.Z-rc.N` whose version is not final yet | 1 |
| `already-final` | the version is already tagged final; an open tracking issue for it is closed | 1 |
| `testing` | the test period has not ended, or a trunk run inside it is still in flight | 1 |
| `held` | `release-hold` is on the tracking issue, or on a superseded version's still-open one | 1 |
| `needs-new-candidate` | a regression was fixed after the period began, or (automatic-final row) trunk went red during it | 1 |
| `refused` | a required check failed that a later run may clear | 1 |
| `candidate-ready` | the final is a human act here: nothing tagged; `handoff` is the one command, also posted on the tracking issue | 0 |
| `finalized` | an annotated `vX.Y.Z` is tagged on the candidate's commit and pushed, and the tracking issue closed (with `--dry`: would be) | 0 |

**The per-candidate state contract** — stable; `futurelastic/hangar#125` reads it:

- **Candidates** are annotated `vX.Y.Z-rc.N` tags on origin whose message's first line ends
  `(colab release cut)` and whose commit is on `origin/main`. The newest open one (highest version,
  then highest `N`) is the candidate; a lightweight or hand-made one is refused, never finalized.
- **One tracking issue per version**, opened by the first non-`--dry` run for that version:
  title `release: vX.Y.Z`, body's first line `<!-- colab:release version=vX.Y.Z -->` (only the
  marker identifies it). Every `-rc.N` of the version reuses it. Two open ones for a version, or a
  closed one for a version not yet final, refuse rather than guess. A superseded version's open,
  un-held issue is closed with a "superseded" comment.
- **Veto:** the `release-hold` label on it (a convention label — `colab labels --ensure`). No
  command removes it.
- **Regression:** a `blocked_by` edge on it (`colab blocked <tracking> --by <regression>`), read
  from `issues/<n>/dependencies/blocked_by`: open → `refused`; closed after the period began →
  `needs-new-candidate`; closed before → fine.
- **Test period** starts at the later of the candidate tag's tagger date and the issue's
  `createdAt`, and lasts the effective `release: test-period` (3 days by default).
- **Events** are comments carrying `<!-- colab:release-event … -->` markers, each posted once:
  `candidate=<rc>` (the period starts), `state=candidate-ready candidate=<rc>` (carries the
  handoff), `state=finalized tag=<vX.Y.Z>`, `state=superseded by=<vX.Y.Z>`.

| condition | what it checks | blocks |
|---|---|---|
| `release-policy` | the rung row is a `released-*` row and the `release:` block is valid | always |
| `candidate` | a candidate exists, made by `colab release cut`, on `origin/main`; `--tag` names the newest | always |
| `tracking-issue` | exactly one findable record for the version | always |
| `release-hold` | no hold on it or on a superseded open record | always |
| `regressions` | as above | always |
| `test-period` | the period has ended | automatic-final row only |
| `trunk-green` | every `main` run created since the period began, of the workflows that ran at the candidate (not `pull_request`), finished without going red — a `cancelled` one needs a later success; a read that hit its limit fails closed | automatic-final row only |
| `ci-green` · `full-suite` · `schema-additive` · `switch-dependencies` | §6's four candidate conditions, re-measured at the candidate's commit by the same code `release cut` uses | always |
| `human` | human-final row only: `COLAB_HUMAN=1` + `--answered-by` + `--tag` (the `adopt` gate's precedent) | reported; absent → `candidate-ready` |

The human bar never shortens a test period and never overrides a hold. Where it is met, the final's
annotated message records who answered.

### Templates

`colab template` copies a handbook workflow template (`../templates/*.yml`) into a repo
and **prepends a version stamp** — `# colab-handbook: <name> @ <version>`, where the
version is `git describe --tags` in the handbook checkout, pre-release tags excluded
(`tools/lib/release-tag.js`, #334; `v0` before any release tag). With no
name it lists the available templates; it refuses to overwrite an existing destination
unless `--force` (and prints a `diff` hint instead). The stamp exists so
`../audit/audit.mjs` can later tell an adopter that the source template has changed since
they copied it — copy-and-own with a reconciliation trail, never a remote call. Making
copy+stamp one command matters because a manual stamp is the step people skip.

### Update (the outward sweep)

`colab template` is how a repo *adopts* a template; `colab update` is how the machine finds out
which adoptions have gone stale, and refreshes the ones it can prove are safe.

It is an **outward sweep**, not a broadcast. The handbook cannot push to consumers — the fleet
registry is machine-local and deliberately uncommitted (this repo is public; a list of private
repo paths is not something to publish). So the sweep runs *from* the machine holding the list.

```sh
colab update                 # report on every registered repo (read-only)
colab update my-repo         # limit to one repo (abs path, or a trailing path segment)
colab update --apply         # write the refreshable copies
colab update --quiet --json  # for a scheduled run
```

Each stamped artifact is classified. The two git reads that matter are performed against the
handbook's own history — **the classification never compares version strings alone**:

| state | meaning | `--apply` |
|---|---|---|
| `current` | the stamp is the handbook's version, **or** `git log <stamp>..HEAD -- templates/<name>` is empty — the template genuinely has not moved | — |
| `behind` | the stamp is older, the template really changed, **and** the copy still matches `git show <stamp>:templates/<name>` — i.e. pristine | **rewritten** |
| `diverged` | the copy does *not* match the template as of **its own stamp**: hand-edited | **never written** |
| `unstamped` | its **content** carries text only our templates contain, but there is no stamp: lineage unknown, so replacing it could destroy edits nobody can see. The row names the template the evidence points to | **never written** |
| `unrelated` | its **name** matches a template but its content carries none of it — the repo's own file, reported only so nobody re-copies over it | **never written** |
| `n-a` | not assessable, always with a stated reason (an `owner/name` slug has no working tree here; a stamp from a tag this checkout lacks; an unknown template name) | — |

Getting `diverged` right is the crux, and it is why the tool reads the template **at the old
tag** rather than only the current one. Comparing a copy against today's template would label
every out-of-date copy "hand-edited" and make the safe/unsafe distinction meaningless.

**What it deliberately will not do:**

- **Never commits, stages or pushes.** Every repo has its own tier and trunk rules; committing
  into a Tier A repo's `dev` would have this tool violate the handbook it enforces. It writes
  files into the working tree and stops — review with `git diff`, commit through that repo's flow.
- **Never treats a filename as provenance.** "Copied from us" is decided by content that only our
  templates contain — step names we coined, not the vocabulary of the stack. A file that merely
  shares a template's *name* is `unrelated`, and the report says so instead of suggesting a
  re-copy: advising `--force` on a file we cannot attribute would overwrite work that never came
  from here. (Both misfires we shipped were stack vocabulary — a framework's codegen command and a
  third-party tool's download URL.)
- **Never rewrites a `diverged` copy**, even with `--apply`. Copy-and-own ([§7](../CONVENTIONS.md#7-ci-and-toolchain)) makes local edits
  legitimate; a tool that silently overwrote them would destroy the principle it serves.
- **Never rewrites the CLAUDE conventions block.** That block is a *fragment* pasted into a
  larger hand-written file, and the template ships placeholders the adopter fills in (`<A|B>`,
  `<dev|main>`). A correctly adopted block therefore never matches byte-for-byte — divergence is
  undecidable — and regenerating it would replace a repo's real tier and trunk with angle
  brackets. It is classified (`current`/`behind`) and handed to a human to re-paste.
- **Skips the handbook itself**, which is a guaranteed false positive: a stamp means "copied from
  version X", and this repo *is* X.

A refreshed file is byte-identical to what `colab template <name> --force` would have written —
`update` is that command applied only where it can prove the copy was untouched.

**The frozen CLI is reported alongside the fleet**, as one line before the table. Same question
(is a stamped copy behind?), same git read (`git log <stamp>..HEAD -- tools/colab tools/lib`) — so
a release that changed no CLI code does not mark the machine stale. It is the one stamped artifact
that lives in no repo, and the one whose staleness nothing else would ever surface: a service goes
on running the old CLI quite happily, which is what freezing it was for. States are `current`,
`behind`, `n-a` and `absent` (no frozen copy installed at all). There is no `diverged`: a template
copy is copy-and-own and its edits must be protected, while the frozen copy is a cache of this
repo's own tool that `install.sh` overwrites wholesale.

It is **reported, never written** — not even with `--apply`. Re-freezing swaps the toolchain a
live service is executing, so it stays a human act (`./install.sh --tools`). Run `colab update`
*from* the frozen copy and it refuses: that copy has no handbook history to compare against, and
an "untagged handbook" report would have been technically true and completely misleading.

Exit code is **1 when anything is `behind`** — the frozen copy included — so a scheduled run
alerts on a stale CLI exactly as it does on a stale workflow. 0 otherwise.

### Register (fleet registries)

There are two machine-local registries under `~/.colab/` (honoring `COLAB_HOME`):

- `repos.txt` — the audit fleet list, read by `../audit/audit.mjs`.
- `config.json` `repos[]` — the reserved-ports aggregation source used by this CLI.

They serve different tools, so they used to be hand-edited separately — the exact
two-places-drift disease this handbook exists to kill. `colab register` writes **both** in one
act (dedup, atomic, under the same lock):

```sh
colab register                 # register the current repo (its git toplevel) into both
colab register /path/to/repo   # register an explicit repo (must be a git repo; non-git refused)
colab register /path/to/repo --remove   # remove from both
colab register --list          # show every registered repo and which registry knows it
```

`--list` marks each repo `T` (in `repos.txt`) and `C` (in `config.json`). A **local path in only
one** registry is drift and is flagged with a fix hint; `--list` exits non-zero when any drift
exists (scriptable). Owner/name **slugs** are audit-only (they can't be a local port-scan root),
so they show `n/a` in the `CFG` column and are never counted as drift. Registering a
one-registry-only repo re-syncs both ("drift healed").

## Releasing the handbook itself

The handbook ships **no** `release-tag.yml` workflow of its own (that file is a *template* it
hands to other repos). Its release path is `scripts/release.sh`:

```sh
sh scripts/release.sh vX.Y.Z ["optional headline sentence"]
sh scripts/release.sh vX.Y.Z --dry    # run every guard + print the plan, change nothing
```

It guards (version shape, tag not already present, clean tracked tree, on `main`, `main` ==
`origin/main`), then tags, pushes the tag, publishes a GitHub Release whose body comes from
`colab release-notes`, and finally runs `../audit/audit.mjs` as a **fleet reconciliation report**
under a `── Reconciliation @ vX.Y.Z ──` banner. Audit findings are advisory — the release still
succeeds and the script exits 0 when the release steps themselves succeeded.

## Phase B autonomy ladder (`colab ship` + `pre-push-guard`)

`colab ship` is the **one sanctioned door** for `code-ship` — squash-merging a finished
session branch into the repo's trunk. It exists so an agent can close the loop *only where a human
has granted it*, and so a rogue agent can never raw-push trunk.

### Autonomy is granted by the repo, not the caller

The repo's `.github/project.yml` carries an `autonomy:` field:

```yaml
autonomy: auto-trunk   # colab ship may squash-merge session branches into trunk
# autonomy: manual     # (or absent) — ship refuses; a human runs Phase B
```

`auto-trunk` is the *only* value that enables `ship` for any change. Anything else (or absent) → ship
refuses, with one exception it computes itself: a **docs-only** diff (#345) — every changed path is
`.md`/`.mdx`/`.txt` or under a top-level `docs/`; none is `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`
or under `.claude/`, `.github/`, `.githooks/`; no binary, no symlink, not empty. The caller cannot
assert it and nothing widens it ([CONVENTIONS §2](../CONVENTIONS.md#autonomy--the-docs-only-exception-345)). This
gate has **no override** — `--force` does not exist on `ship`. Autonomy is a property of the repo a
human configured, never a flag the caller can pass. `ship` **never** touches `main` when `trunk ≠
main`, **never** tags, and **never** promotes — those belong to `promote` and CONVENTIONS §6's release rung.

**The caller here need not be a human-opened session.** A scheduled driver — a per-repo autopilot
that ships and triages on a cadence — is a legitimate caller of `ship`, subject to this identical
gate and no other: `auto-trunk` grants it exactly as much as it grants any agent, and it still never
promotes or tags. See [*Scheduled drivers*](../CONVENTIONS.md#scheduled-drivers--provenance-and-autonomy-meet-a-caller-that-is-not-a-person)
for the additional properties a scheduler owes on top of this gate (excluding `agent-filed` work by
default, spawning ordinary sessions rather than writing to the tracker itself, and telling a
self-clearing blocker apart from one only a human can clear).

### The gated sequence

Each step is checked; any failure aborts **before the push**, so trunk is never left half-shipped:

| step | what | abort condition |
|---|---|---|
| a. autonomy | repo grants `auto-trunk`, or the diff is docs-only (#345, computed, re-measured after B0) | neither → refuse (no override) |
| a′. resolvable | the session's recorded branch resolves to a ref (locally or on `origin`) | it does not → refuse: everything below is keyed to that name, and a record nothing can act on silently costs the `Closes` |
| a″. claim sanity | the branch resolves to at least one claimed issue | zero → **loud warning** (the squash will carry no `Closes #N`); zero **and** some claim in the repo names an unresolvable branch → refuse, because "no claims" is then a broken lookup |
| b. preconditions | reported as a ✓/✗ table | any ✗ → abort |
| | · trunk CI alive **and** green (`gh run list --branch <trunk> -L 1`) | not `completed`+`success`, UNLESS every claimed issue holds a valid `colab ci-grant` over trunk's CURRENT red sha (#105, below) → human must run Phase B (billing fail-to-start counts as ✗ regardless — never exempted, see below) |
| | · **no new migration files** on the branch (`database/migrations/`, `prisma/migrations/`) | any present, UNLESS every claimed issue holds a valid `colab migration-grant` for this branch (#98, below) → human must run Phase B |
| | · trunk checkout is on trunk and clean | wrong branch / dirty tracked tree |
| | · the local merge target agrees with `origin/<target>` (#322) | **behind** → self-clearing, the remedy is one `git merge --ff-only`; **ahead / diverged** → human-gated: those are unpublished commits on a push-guarded branch, to be moved onto a session branch, never published from there. Unmeasurable (no `origin`, fetch failed) is a ✗ too — a merge that cannot be pushed is the state this row exists to prevent |
| c. B0 sync | merge trunk **into** the branch | conflict in a **non-generated** file → abort (hand-merge); generated-only conflict → the repo's `.colab/hooks/pre-ship` regenerates, else abort |
| d. B1 squash | re-verify CI green, then squash-merge branch → trunk | CI no longer green / squash fails |
| e. B2 push | push trunk with `COLAB_SHIP=1` in the env | push rejected → the squash is **rolled back** to the target's pre-merge sha (#322), so nothing is left locally that only a guard bypass could publish; the branch still carries the work, so `colab ship` is re-runnable. Rollback impossible (something else moved the target) → says so and prints the exact `reset --hard`, never an environment variable |
| e2. post-ship | trunk targets only: run the repo's `.colab/hooks/post-ship` on the trunk checkout (re-install deps, migrate, restart). With no hook, a merge that changed a dependency lockfile warns, naming the install command | **never aborts** — the push already landed (#304) |
| f. B3 teardown | `colab worktree rm` (releases claims + ports + `✅` comments) unless `--keep-worktree`; claims with **no** worktree are released through `colab release` (#319). The **branch is kept**; `--delete-branch` removes it local + remote. A **Refs-only** ship deletes it unless `--keep-branch` (#368) | branch deletion is best-effort — a failure warns, it never fails a ship that already pushed |
| g/h. B4 + summary | verify each issue auto-closed; post `🚢 Shipped to <trunk> by colab ship — <sha> · implemented by session <claim holder> · shipped by session <shipper>` — one clause `implemented and shipped by the same session <x>` when they are one session, `shipped by: unknown` when the shipper passed no identity (#372; evidence-close comments carry the same suffix) | non-closing issues are reported, not fatal |

#### Batch landing — `colab ship --batch` (#373)

Opt-in per repo: `ship-batch: <N>` (1–3) in `.github/project.yml`, plus `autonomy: auto-trunk`
and a CI workflow whose `push: branches:` includes `'ship-batch/**'`. Absent or `1`, every
`--batch` call declines and the sequence above is untouched.

```sh
colab ship --batch fix/a-11,fix/b-12,fix/c-13 [--dry]
```

| step | what | outcome |
|---|---|---|
| wiring | a workflow fires on a `ship-batch/**` push (static read of trunk's `.github/workflows`) | none → **exit 4**, the refusal line, then `→ SERIAL: …` |
| trunk CI | green at its head — read with **no** cure/grant door | red → exit 4 (the doors are per member); still running → **exit 3** |
| members | each: pushed head = local head · its own `ship --dry --json` ok · an ordinary auto-trunk squash into trunk · `green` at its own head (or no run can arrive) · edits no workflow. File-disjoint first, capped at N | fewer than 2 → exit 4 |
| build | trunk head + one squash commit per member (own `Closes #N`, `Ship-Batch:` trailer) in a throwaway detached worktree; a member conflicting with those already in drops to the next batch → push `ship-batch/<trunk-sha7>` | **exit 3** — wait on the combined run, then run the same command |
| verdict | every run at the batch head: pending → exit 3 · red on attempt 1 → exit 4 with `gh run rerun <id> --failed` for a `red:infra` (ref kept) · red again → exit 4, ref deleted · green → land | |
| land | trunk not moved → `merge --ff-only` + a plain, non-forced push; a rejected push rolls back and exits 3 (rebuild on the next call). Then the ref is deleted, post-ship runs once, and each member gets B3–i2 with its own squash sha; the 🚢 comment names the combined run | **exit 0** |

A trunk that moved since the batch was built deletes the stale ref and rebuilds on the new head —
nothing untested ever reaches trunk. While trunk's own run for a landed batch head is still in
flight, `ship`'s trunk-CI row accepts the batch ref's green run for that same sha, only when the
workflows firing on a trunk push and on a `ship-batch/**` push are the same set.

#### If `ship` exits non-zero — establish which step it reached, don't guess

The gated sequence above promises the abort case: "any failure aborts before the
push, so trunk is never left half-shipped." It says nothing about the case an
operator actually has to reason about — **the process exited non-zero and gave no
usable signal for which side of the push it died on.**

Observed once: `colab ship` exited **144** (128+16 — death by signal, not a code
path the CLI itself returns; the handler only ever yields `0` or a caught error's
`1`) having printed **nothing at all**, not even the header line a `--dry` run on
the same branch printed immediately. So the exit code alone is not self-describing
— "aborted safely, re-run it" and "fully shipped, re-running would double-merge
the same content" are both plausible, and they call for opposite next actions.
**Never re-run on a guess.** Check, in order — the sequence is ordered, so the
last completed step bounds what did and did not happen:

1. **Is the squash on the local target, and on the remote?**
   (`git log --oneline -1 <trunk>` locally and `git log --oneline -1 origin/<trunk>`
   — the push, step e, is the pivot: before it, nothing is shared.)
2. **Is the worktree gone** from `git worktree list`, and its record gone from
   `colab worktrees`?
3. **Is the claim released**, and is the issue closed with its `🚢 Shipped`
   evidence comment posted?
4. **Is CI green** on the new target sha?

A posted `🚢 Shipped` comment (the sequence's *last* step, g/h) means every step
before it ran — so a "yes" on (3) settles all of it without needing (1)/(2)
separately. Treat this as the recovery procedure, not a special case: re-running
`ship` after a genuine partial failure is correct and re-running it after a
successful ship whose reporting tail died is a second merge of the same content —
the check above is what tells the two apart.

#### Migration grants (#98) — the one narrow, human-created exemption

The no-new-migrations precondition is right by default — a schema change merged into trunk is
pulled by every other worktree next, and where dev data is shared a bad one costs everyone at
once. But it makes one legitimate class of work permanently un-shippable without a person: an
issue whose entire deliverable IS a schema change. Under a scheduled driver such an issue gets
coded and wrapped unattended, then parks forever, every tick.

A migration grant is the narrow yes: **per-issue, branch-bound, human-only, expiring.**
Deliberately *not* a repo-level or tier-level switch — a repo-level key gets set once and then
silently covers schema changes nobody actually reviewed.

```sh
# grant #98's branch an exemption — requires COLAB_HUMAN=1, exactly like colab promote
COLAB_HUMAN=1 colab migration-grant 98 --branch feat/schema-98

# revoke it — same bar, restores the gate the same minute
COLAB_HUMAN=1 colab migration-grant 98 --revoke

# see every grant outstanding right now (read-only, no COLAB_HUMAN needed)
colab migration-grant --list
```

Required properties, and how each is met:

- **Human-only to create.** `colab migration-grant` refuses (exit 1) unless `COLAB_HUMAN=1` is set
  — the identical bar `colab promote` holds a production promotion to, and the check runs
  *before* any network call. No flag, no `project.yml` field, and no inference from an issue's
  content, age, or park count can produce a grant. Revoke carries the same bar.
  (`colab place release`/`--force acquire` on someone else's hold uses this same
  `COLAB_HUMAN=1` bar — see *Place-claims*, CONVENTIONS.md; #136.)
- **Bound to one issue AND one branch.** The grant is a `migration-granted` label (index +
  GitHub's own write-permission check — a drive-by public commenter cannot manufacture one) plus
  a comment on the issue carrying the exact branch name (a label alone cannot: GitHub caps label
  names at 50 characters). `ship` honors a grant only when the comment's branch matches the branch
  being shipped.
- **Expires.** The instant the issue closes — `ship` reads the issue's live `state`, not a
  separate expiry date. A grant can never become standing permission that outlives the work it
  was reviewed for.
- **Visible from any machine.** Both the label and the comment live on the tracker, exactly like
  the `deps-checked` readiness marker — `ship` may run on a different machine than the one that
  granted, so nothing here is written or read local-only. Without a usable `gh`, every
  `migration-grant` subcommand refuses rather than write (or read) something invisible to the
  machine that will later run `ship`.
- **Covers the whole ship set, not one member of it (requirement 5).** `ship` validates the grant
  over **every issue the branch carries** (`--issues`, never narrowed by `--refs`) — a migration
  cannot be mechanically attributed to one member of a group branch, so if any claimed issue
  lacks a valid grant for this branch, `ship` still refuses. One granted issue never smuggles an
  unreviewed migration in for its siblings.
- **Revocable, and auditable afterwards.** `--revoke` removes the label first (the gate is
  restored the same minute) then posts a revoke receipt — answerable later who authorized which
  schema change, when, and for which branch, straight from the issue's own comment history.
- **Reviewable while outstanding.** `colab migration-grant --list` shows every issue with a live
  grant right now, the branch it is bound to, who granted it, and when.

**Nothing else changes.** CI green, claim corroboration, the trunk-checkout check, and the
hand-merge conflict check all still run in full on a granted branch — a grant only ever widens
the *one* precondition it targets, never reads as blanket authority. On a fully-granted branch the
`no new migrations` row in the precondition table reads ✓, exactly as if there were no migration
at all; a partially-granted branch still reads ✗ `human-gated`, naming which issue is missing a
grant. See `colab migration-grant --help` for the full command reference.

#### CI grants (#105) — the one-shot door through a genuinely red trunk

A red trunk usually means "don't merge" — but when the candidate branch's entire content IS the
fix, that becomes a real deadlock: the fix cannot reach trunk without shipping, and shipping
requires the green the fix would produce. This is a DIFFERENT case from the one `CONVENTIONS.md`
already covers under "ask by commit, not by recency" (#92) — that fix resolves a FALSE red (a
cancelled `cancel-in-progress` straggler); this is the untreated, GENUINE red.

A CI grant is the same shape as a migration grant, on purpose — same precedent, same solution — but
it is strictly MORE dangerous (a bad migration grant merges one reviewed schema change; a bad CI
grant merges into a repo whose own test suite is known-failing), so it carries two guards the
migration grant does not need:

```sh
# grant #105's branch an exemption over trunk's CURRENT red sha — requires COLAB_HUMAN=1
COLAB_HUMAN=1 colab ci-grant 105 --branch fix/red-trunk-ci-grant-105

# revoke it — same bar, restores the gate the same minute
COLAB_HUMAN=1 colab ci-grant 105 --revoke

# see every grant outstanding right now (read-only, no COLAB_HUMAN needed)
colab ci-grant --list
```

- **Human-only to create, identical bar.** Same `COLAB_HUMAN=1` check, same "before any network
  call" ordering, same test coverage (no skill in this repo ever sets it) as `migration-grant`.
- **Bound to one issue, one branch, AND the red trunk sha it was reviewed against.** A migration
  grant only needs the first two. This one also expires the instant trunk's head moves — granted-
  and-consumed by this exact ship, or moved for any other reason — because a grant surviving into a
  DIFFERENT red was never reviewed against that failure.
- **Evidence is MEASURED, never asserted.** Creating a grant requires a completed, successful CI
  run for the branch's own current head (the identical "ask by sha" check `ship` itself uses).
  `--evidence-run` is a recording-only pointer for the audit trail; it never substitutes for the
  measured run. No branch run yet? Open a PR (`gh pr create`), let CI finish, then re-run.
- **Never stacks.** Creating a grant refuses outright against a green trunk (nothing to exempt),
  and refuses again if a PRIOR CI grant already merged something and trunk has been red
  continuously since — fix trunk by hand, or revert the bad merge, instead of granting again.
- **Visible from any machine, covers the whole ship set, revocable and auditable, reviewable while
  outstanding** — identical properties to the migration grant. A grant-authorized merge additionally
  carries a `CI-Grant: #N branch <branch> over-red <trunk>@<sha> evidence <sha>` trailer in the
  squash commit itself — belt and braces with the tracker comment.
- **Scoped narrowly, mechanically so.** This exemption covers ONLY the trunk-CI-green precondition,
  wired through exactly one integration point (`shipCiCheck`) so it cannot accidentally widen. It
  never touches the migration gate, claim corroboration, the trunk-checkout check, the hand-merge
  conflict preview, or `colab promote`. It is also TRUNK-ONLY — an integration line's red already
  borrows trunk's advisory verdict when the line has no runs of its own, and this feature does not
  widen that.

**Nothing else changes.** On a fully-granted branch the `trunk CI green` row reads ✓ with a detail
naming the override, the issue, the red sha, and the evidence run — a partially-granted branch (or
one with no runs at all for its own head) still reads ✗ `human-gated`. See `colab ci-grant --help`
for the full command reference.

#### The squash commit message

With `--message`, the subject is yours and a `— Closes #N, …` trailer is appended. Without it, the
message is composed (`tools/lib/squash.js`, unit-tested):

- **Subject** — the branch's **highest-weight** commit, among the ones it actually wrote itself:
  breaking > `feat` > `fix` > `perf` > `refactor` > `docs` > `test` > `chore`, ties going to the
  **oldest** (the commit that established what the branch is for). Not the newest commit. That was
  the old rule, and it was wrong in exactly the common case: on a well-run branch the newest commit
  is the docs pass, so features shipped titled `docs:` and — because release notes group on the
  prefix ([§4](../CONVENTIONS.md#4-branches-and-commits)) — vanished from the changelog without anything failing. If no commit carries a
  recognised prefix there is nothing to weigh, and it falls back to the newest.
  "Wrote itself" is a first-parent walk from the merge-base, not a raw `<base>..<branch>` diff — the
  latter cannot tell a commit the branch authored from one it merely merged in from elsewhere, and a
  higher-weight borrowed commit used to win the subject silently (#57). A branch with **no** commits
  of its own on that chain (a freshly-cut one, most commonly) no longer borrows the base's tip to
  produce a plausible-looking subject either: `ship` refuses and asks for `--message` instead.
- **Body** — `Closes #N` for **every** issue the branch claims in `state.json` (a group branch
  closes all its siblings), then the other commit subjects as bullets with `chore(sync)` merge-noise
  dropped, then the chosen commit's body, then `Co-Authored-By:` / `Claude-Session:` trailers
  harvested from **every** commit on the branch and de-duplicated.

`--dry` prints the subject it would use — the last moment a wrong one can be caught, since a bad
subject fails silently and cannot be corrected once it is inside a published tag.

#### Why B3 keeps the branch

**The branch survives a ship. `--delete-branch` opts into removing it** — with one exception, a
Refs-only ship (below).

An agent deleting refs from a **shared remote** is the wrong default however well-verified the
deletion is: reporting is safe and reversible, deleting is neither. Nobody is harmed by a branch
that outlives its merge; someone can be harmed by a ref that vanishes from under them. So `ship`
keeps it and `colab doctor` lists what has accumulated.

The cost is accepted deliberately, and it is real: **shipped branches pile up, one per session.**
A squash merge leaves **no ancestry**, so `git branch --merged <trunk>` will never list them — the
standard cleanup check is structurally blind, not merely unrun. That is exactly why `doctor`'s list
is the *primary* mechanism here rather than a safety net, and why it prints below the health verdict
as routine maintenance instead of as drift.

`--delete-branch` does it when you want it: local and remote, **after** B2 has pushed trunk (the
content is durable before the ref goes), with `branch -D` since `-d` refuses a squashed branch for
the same missing-ancestry reason. Best-effort — a failure warns rather than failing a ship that
already succeeded. Passing it with `--keep-worktree` is refused with a warning, because git will not
delete a branch that is still checked out.

**The exception: a Refs-only ship deletes the branch (#368).** Everything above assumes a kept
branch is harmless clutter. It is, while every number it carries is closed: every name-keyed reader
sees a closed issue and moves on, and `code-sweep` lists the ref as `spent-remote`. A ship that
closes **nothing** — every issue it names is `Refs #N`, via `--refs` or the `tracking` label — breaks
that. Its issue stays open by design, so the kept ref carries the number of an **open** issue for as
long as that issue lives, and triage's ref enumeration, `git branch -a --list '*<n>*'` and a
scheduler's file-hold check all read it as live work on it. Nothing downstream can tell otherwise:
the squash left no ancestry, and the ship has just released the claim, so `code-sweep`'s
`orphan-candidate` bucket (which needs `in-progress`) never sees it either. Measured: one such ref
held a file against a scheduler's start check for about eight hours, until a human deleted it by
hand. So on a Refs-only ship B3 deletes it — same mechanics as `--delete-branch` — at the one moment
the tool knows for certain the content landed. A ship that closes even one issue keeps the default.
`--keep-branch` keeps a Refs-only branch (a next slice will be cut from it); passing it with
`--delete-branch` is refused. With `--keep-worktree` nothing can be deleted, so ship warns, naming
the open issue and the two commands that clear the ref once the worktree goes. The decision lives in
`tools/lib/shipped-branch.js`.

This premise has been wrong twice, in opposite directions — first a comment claiming a deletion that
never happened, then a deletion the operator did not want. It is now a decision with a flag and a
docstring behind it rather than an assumption. [`code-ship`](../skills/code-ship/SKILL.md) B3 and
[`code-sweep`](../skills/code-sweep/SKILL.md) §3 tell humans to delete these by hand; under this
default that guidance is **load-bearing**, not redundant.

A **generated** file is one matching `package-lock.json`,
`pnpm-lock.yaml`, `yarn.lock`, `composer.lock`, `Cargo.lock`, `go.sum`, `dist/`, `build/`,
`public/build/`, `.astro/`, **plus** the repo's `.github/project.yml` `generated: [...]` globs.

`--dry` prints the plan + the precondition table and changes nothing (exit 0 if READY, 1 if not).

### Promotion (`colab promote`) — trunk → main, split from release

The ladder has three rungs with **separate permissions**: `ship` (branch → trunk) · `promote`
(trunk → main, a `--no-ff` merge) · **release** (the tag — candidates automatic, final tag by
exposure; CONVENTIONS §6). `colab promote` is the
checked door for the middle rung. It **never tags and never deploys directly**; there is no
`--tag`/`--release` flag.

Two gates, **both** must pass:

- **Hard safety** — derived from the repo's `deploy:` semantics, and **no field or flag can lower
  it**:
  - `deploy: push-main` → promoting main *is* a production deploy → requires `COLAB_HUMAN=1`.
  - `deploy: manual` → promoting main is the human's own "about to deploy" step, and the deploy
    that follows has no gate but the operator → requires `COLAB_HUMAN=1`.
  - `deploy: tag` → promotion is **verification-only** (heavy CI runs on main, nothing deploys).
  - anything else / absent → treated as production-risk → `COLAB_HUMAN=1` (fail-closed).
- **`promotion:` field** (`project.yml`, `human` | `main-loop`, default `human`, fail-closed on
  unknown): on a `deploy: tag` repo, `promotion: main-loop` lets the main-loop promote with no human
  word; otherwise a human (`COLAB_HUMAN=1`) is required.

Tier B (`trunk == main`) has **no promotion** — `ship` goes straight to main; `promote` refuses.
Tiers A and C both promote; the CLI keys on `trunk`/`deploy`, never on the tier letter.
Preconditions (✓/✗ table): trunk CI green · `trunk == origin/trunk` · `main == origin/main` · main
checkout usable (the repo checkout if it's on `main` and clean — **never** a dirty switch — else a
temporary worktree). The merge message is `--message` (full override) or
`release: <trunk> → main — <date> (promotion via colab promote)`; the push carries `COLAB_PROMOTE=1`.
After a successful promotion on a `deploy: tag` repo it prints the release reminder:
`git tag vX.Y.Z && git push origin vX.Y.Z`. `--dry` shows the table + plan and changes nothing.

On a **`deploy: manual`** repo a *successful* promotion prints a block, not a line, because it is
the one case where finishing the command does not finish the job: `main` moved, **production did
not**, and no workflow will ever fire. The block says production is not updated and names the
repo's `runbook:` as the required next step. If `runbook:` is absent it prints `NEXT STEP —
UNKNOWN` rather than an empty path — silence there would read as "nothing further required",
which is precisely the misreading (a promoted `main` everyone believes is live) this exists to
prevent.

### `pre-push-guard` — trunk (and main) are push-protected locally

`templates/pre-push-guard` is a POSIX-sh git `pre-push` hook that **refuses raw pushes to protected
branches** (read from `.github/project.yml`):

- **trunk** — unless `COLAB_SHIP=1` (set by `colab ship`) or `COLAB_HUMAN=1`.
- **main**, only where `trunk != main` (tiers A and C) — unless `COLAB_PROMOTE=1` (set by `colab promote`)
  or `COLAB_HUMAN=1`. `COLAB_SHIP` does **not** open main — `ship` is trunk-only by design.

**`COLAB_SHIP` and `COLAB_PROMOTE` are process-identity assertions, not permissions, and no agent
ever sets either by hand.** They mean "`colab ship`/`colab promote` ran its preconditions" — a
claim only that process can truthfully make. Typed at a shell they assert it falsely and reach a
direct trunk push while skipping the grade, the branch-CI check, the claim release and the evidence
comment. Unlike `COLAB_HUMAN`, neither has any sanctioned hand-set case at all — not even #237's
solo-flow one — and `tools/lib/sanctioned-path-vars.test.js` fails the build if a skill sets either.

**The guard's refusals therefore name the remedy, never the variable (#322).** They used to end
with the assignment that defeats them, which is a bypass printed at the exact moment its reader has
run out of ideas — and it was taken twice in one day by two sessions that had never read it in a
skill. The trunk refusal now points at `colab ship`, and — for the corner that produced the
incident, a commit *already* made on the trunk checkout, which `ship` has no path for — spells out
moving it onto a branch and resetting the checkout. The variables stay documented here and in the
template's header comment, where a person looks them up deliberately and an error message does not
put them in front of an agent.

On tier B (`trunk == main`) the trunk rule already covers main. Non-protected pushes always pass; a
missing `project.yml` degrades to *allow* with a warning (never blocks work). Install copy-and-own,
per repo:

```sh
cp templates/pre-push-guard .git/hooks/pre-push && chmod +x .git/hooks/pre-push
# or into a shared hooks dir:
cp templates/pre-push-guard "$(git config core.hooksPath)/pre-push"
```

Together they form the ladder: an agent may `ship` **only** where the repo granted `auto-trunk`,
`promote` **only** where `deploy`/`promotion` allow, and even a mis-behaving agent can't route around
either with a bare `git push` — the guard blocks trunk and main.

## Safety

- **Claims are enforced.** `claim` / `worktree new --issues` refuse (exit 1) an issue already held
  by another worktree (local) or another GitHub user (`in-progress` + assigned to someone else),
  naming the holder; `--force` takes over visibly. A simultaneous-claim race is settled
  deterministically by the tie-break, and the loser auto-yields. See *Claim lifecycle* above.
- **Phase B is gated + push-protected.** `colab ship` merges to trunk only where the repo's
  `project.yml` grants `autonomy: auto-trunk` (no flag override), and aborts before any push if CI
  isn't green, the branch adds migrations with no valid `colab migration-grant` covering every
  claimed issue (#98 — human-only, branch-bound, expires on close), or a non-generated merge
  conflict appears. The `pre-push-guard` hook blocks raw pushes to trunk without
  `COLAB_SHIP=1`/`COLAB_HUMAN=1`. See *Phase B autonomy ladder* above.
- **Promotion is split from release.** `colab promote` (trunk → main) requires `COLAB_HUMAN=1` on a
  `deploy: push-main` repo (promotion *is* the production deploy) and allows an unattended main-loop
  run only on `deploy: tag` + `promotion: main-loop` (verification-only); unknown `deploy`/`promotion`
  values fail closed to human. It never tags — the release rung is separate (CONVENTIONS §6). The guard also blocks
  raw pushes to `main` on tier-A repos without `COLAB_PROMOTE=1`/`COLAB_HUMAN=1` (`COLAB_SHIP` does not
  open main). See *Promotion* above.
- `worktree rm` refuses if the worktree has uncommitted **tracked** changes, unless `--force`.
  (Untracked files like a copied `.env` are expected and don't block.)
- `claims --sync` is **add-only by default**: it adds claims for issues GitHub shows as assigned +
  in-progress, and never deletes local claims unless you pass `--prune` (which prints exactly what
  it removes and why). Removal is opt-in because a successful-but-partial GitHub response (rate
  limit, paging) is indistinguishable from a complete one, so a destructive reconcile must be
  deliberate. Repos gh can't reach are skipped, never treated as "GitHub shows no claims".
- `doctor` without `--prune` never changes anything — it only reports (including would-be `running →
  merged` flips and merged-worktree sweep candidates).
- Worktree-less ("trunk") claims are never auto-removed; `doctor` only *flags* stale ones. You
  remove them with `--prune`. This is deliberate — a trunk claim may be a long-running deliberate one.
- Under `--sync`, `doctor` also flags (and, with `--prune`, removes) a worktree-less claim whose
  issue the tracker no longer shows assigned + `in-progress` — regardless of age (#111). This is the
  same predicate `claims --sync --prune` already applies by hand, reusing `git.ghAssignedIssues` the
  same way and computed **before** any lock is taken (network work never happens while `state.json`
  is held open). A repo `gh` can't reach is skipped for this check, exactly like `claims --sync`:
  never read as "nothing assigned", which would reap every claim on the machine.
- `doctor --prune` sweeps only **merged** worktrees, and only when their tracked tree is clean;
  `running` worktrees (and any worktree with a live claim) are never swept. The sweep is local-only —
  `doctor` never touches GitHub.
