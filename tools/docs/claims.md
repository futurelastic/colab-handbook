# Claims — how the CLI records who holds an issue

The mechanics behind [CONVENTIONS.md
§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this) — who holds an issue: the claim
ref, the tracker mirror, the local cache, the claim comments and tracking issues.
The rules stay there, in the claims and decisions contract, in words that name no tool; how this
repo's CLI carries them out lives here. Moved verbatim from CONVENTIONS.md §5 by #639 — only links
were retargeted; each section keeps its heading there. Frozen with the rest of §5
([ADR 604](../../docs/adr/604-scope-freeze.md)). What lives in this directory, and why: [README](README.md).

## Record of a claim — the branch on the remote

The rule: [CONVENTIONS.md, *Record of a claim — the branch on the remote*](../../CONVENTIONS.md#record-of-a-claim--the-branch-on-the-remote), item 1.

**[Hard — gate: colab claim refuses]** **The record of a claim is its branch on the git remote** — the branch whose name carries
the issue number ([§4](../../CONVENTIONS.md#4-branches-and-commits)), recorded **the moment it is cut** at session
start and pushed at wrap (#325). At the cut it is recorded as the **claim ref**
`refs/claims/<branch>`, not the branch: a branch push fires every CI `push` trigger on a commit
trunk already tested, and a claim ref fires none (#550). It is deleted at `colab worktree rm`.
A claim is refused against the git remote: a branch or claim ref on the remote carrying `#N` that is not this machine's refuses a second claim on `#N` from
anywhere, naming the ref and how to continue it. Each machine sweeps its own worktrees.

- **[Hard — gate: colab claim refuses]** **Remote unreachable → no claim.** Fail closed: a claim checked against nothing is not a
  lock. A repo with **no remote at all** is the one exception — nothing else could ever share
  its branches, so the machine's own record is the whole truth.
- **Tracker unreachable → the claim still stands.** Its tracker half (below) is recorded as
  *pending* and posted when the same claim is re-run.
- One account on **two machines** is two holders: a live claim comment from the same login on
  a different machine refuses too — the assignee set cannot say which machine holds it.
- A claim names the machine by a canonical id, not its hostname (#327). The comment carries only a digest of that id. Why, with the measurement: [ADR 539](../../docs/adr/539-claims-rationale.md).
- A **planner** may hold an issue before the session that will work it exists
  (`--session intent:<id>`, no worktree, #326). That session's own claim from the same machine
  upgrades it in place; a planner claim whose session never claimed is released after a short
  window.

## Mirror for people — GitHub

The rule: [CONVENTIONS.md, *Mirror for people — GitHub*](../../CONVENTIONS.md#mirror-for-people--github), item 2.

```sh
gh issue list --label in-progress                               # check, before taking work
gh issue edit <N> --add-assignee @me --add-label in-progress    # claim, at session start
gh issue edit <N> --remove-assignee <claimer> --remove-label in-progress   # release, at session end
```

**[Hard — gate: colab claim refuses]** **A claim is both halves — the assignee *and* `in-progress`.** Either half alone is a
**half-claim**: a broken claim, which is neither free nor taken (ruled in #323). Nobody
starts on it; triage reports it for **repair** — whoever holds the assignee completes the
claim (adds the label) or drops the assignee (releases it) — and `colab claim` refuses it
until then, `--force` taking it over loudly like any other claim. Our own half-claim is
the one exception: re-claiming completes it. Release therefore drops **both** halves;
removing only the label is what leaves the assignee-only half-claim behind.

**Release removes the assignee who holds the claim, not the account releasing it** (#363).
The claimer is the account that applied `in-progress` — the latest such event on the issue,
which survives the label's removal.
`colab release` (and every path that releases through it) reads the claimer from the issue,
unassigns it alongside the caller, and says so whenever that is a different login. By hand,
`<claimer>` is `@me` only when you took the claim yourself. The one exception is yielding a
lost race: there the latest labeler is the winner, whose assignee must stay.

Why, with the measurements: [ADR 363](../../docs/adr/363-claim-release-rationale.md).

Assignee plus `in-progress` is the claim's **mirror for people**, not its lock: it is what a
human reading the Issue sees, and the half-claim rule above still governs it exactly. It is
no longer what a claim is refused against across machines — that is the branch on the remote,
above. Why, with the measurement: [ADR 539](../../docs/adr/539-claims-rationale.md). The label does not exist in a fresh repo — creating it is part of
adoption ([§9](../../CONVENTIONS.md#9-adopting-this)).

## Fast path — local cache

The rule: [CONVENTIONS.md, *Fast path — local cache*](../../CONVENTIONS.md#fast-path--local-cache).

`colab` keeps a machine-local cache at `~/.colab/state.json` (override with
`COLAB_HOME`), written automatically on claim/worktree-create — a zero-latency read for
same-machine parallel sessions. **It is a cache, not the truth**: uncommitted,
machine-local, cannot see work claimed elsewhere. It does answer one question nothing else
can — *which branches on the remote are this machine's own* — which is why it is never
file-synced between machines. **When cache and GitHub disagree about the assignee/label,
GitHub wins.**

```sh
colab claims --sync      # reconcile local cache against GitHub
colab doctor --prune     # free claims whose worktrees no longer exist
```

## Rules

The rule: [CONVENTIONS.md, *Rules*](../../CONVENTIONS.md#rules), items 1–2.

- **[Hard — gate: colab ship refuses unclaimed branch]** Claim **before** you start, not when you open the PR — an unclaimed issue is fair game.
- **[Hard — gate: colab claim refuses]** **A live claim is enforced, not advisory.** `colab claim`/`colab worktree new` *refuse*
  an issue with a live claim, naming the holder; `--force` takes over loudly. This
  protects an issue only while the claim is *live* — a session releases its whole group
  at wrap, so an unfinished issue is immediately reclaimable; say so on the Issue if you
  intend to return.
- **A claim carries its details as a structured Issue comment**:
  `🔒 Claimed — worktree … · branch … · host … · <timestamp>` on claim, `✅ Released` on
  release. `code-ship`'s evidence comment (B2b, `ceremony: standard` only) uses the same
  pattern: an invisible marker line, `<!-- colab:evidence sha=<trunk-sha> -->`, prepended
  to free prose. **Degrade, never gate** — a comment missing the marker still counts as
  evidence; no consumer may treat its absence as "no evidence exists". `code-ship`'s grade
  verdict (B1c) uses the same family of marker, on its own line: `<!-- colab:grade
  verdict=<token> round=<n> -->`, `<token>` one of a **closed** set (`pass` ·
  `reject-decision` · `reject-escalate` · `rework` — no token a prefix or decorated variant of
  another). `rework` is a reject whose
  recommended fix needs no authority the coordinator lacks, posted as a direction the author
  follows unless a human overrules (#328, #406). It is emitted only at `round=1`, and it is
  held, never cleared. Attributes are read by name, never position; an optional
  `reviewer=<lane>` names which review produced the verdict, and absent means the ship grade. Read by equality, never by
  prefix or heading text; an unrecognised token or a missing marker both mean "not
  cleared", never a silent default to the safe-looking value — the same *degrade, never
  gate* posture applies to its absence. A **third** member of the family, `<!-- colab:disposition
  proposed=<token> -->`, proposes how a non-code unit of work ends — same closed-set,
  read-by-equality, degrade-never-gate rules (*Disposition — the marker, the seven kinds, and who
  may apply one*, below).
- **Simultaneous claims break ties deterministically**: re-read after claiming, the
  earliest live claim comment (by `createdAt`) wins, the loser posts
  `✅ Released (yielded — …)`.
- Release the claim even if you did not finish — a stale claim silently blocks others.
  `colab doctor --prune` frees claims whose worktrees died.
- For long-running work, comment progress onto the Issue — the feature's external memory.

## Tracking issues — claimed but referenced, not closed

The rule: [CONVENTIONS.md, *Tracking issues — claimed but referenced, not closed*](../../CONVENTIONS.md#tracking-issues--claimed-but-referenced-not-closed).

A long-lived tracking issue may be **claimed** (to signal work in the domain) and
**referenced**, without closing. The merge message says `Refs #N` (links, does not auto-close)
instead of `Closes #N`.

- **A `tracking` label** — declarative and durable; any session claiming a labelled
  issue references it automatically.
- **`colab ship --refs <N[,M]>`** — explicit, per-ship, for an unlabelled issue. An
  issue kept open this way for a leftover that is **not** code must also be parked in the
  same step, or it reads as startable again (#385, §4 *Merging*). A leftover that is
  only a check a person must run is not a reason to keep the issue open: close it and
  add a row to the `Human verify:` issue (*Human verify*, below).

The claim is released unconditionally either way. `tracking` is deliberately **not** in
the convention label set ([§9](../../CONVENTIONS.md#9-adopting-this)) — its absence breaks no check, so adoption does not
provision it and the audit does not report it missing.

Do not write `Closes #<tracking>` in a commit body. `colab ship` detects
this after the push and warns to reopen by hand. The reverse is not the same kind of
edge: a stray `Refs #N` written while N was open, now one of the branch's own
`Closes #N` — `ship` drops the stale `Refs` before the push rather than shipping a commit
that says both (#58).
