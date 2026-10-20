# Readiness, holds and dispositions — how the CLI reads what may start

The mechanics behind [CONVENTIONS.md
§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this) — what may start: writing and
reading the dependency graph, the checked and graph-empty markers, the `wake:` vocabulary and
`shape:` field of a hold, and the disposition marker.
The rules stay there, in the claims and decisions contract, in words that name no tool; how this
repo's CLI carries them out lives here. Moved verbatim from CONVENTIONS.md §5 by #639 — only links
were retargeted; each section keeps its heading there. Frozen with the rest of §5
([ADR 604](../../docs/adr/604-scope-freeze.md)). What lives in this directory, and why: [README](README.md).

## Writing and reading the graph, and the checked marker

The rule: [CONVENTIONS.md, *Readiness — open and unclaimed is not enough*](../../CONVENTIONS.md#readiness--open-and-unclaimed-is-not-enough), items 3–4 of the contract.

```sh
# read (repo-relative — no owner/name to get wrong)
gh issue view <N> --json blockedBy,blocking,parent,subIssues,subIssuesSummary

# write a sequence — colab owns this write (#251); it takes NUMBERS ONLY, resolves the
# database id itself, reads before writing, writes, and reads back to confirm the edge
# names the blocker you meant. Refuses cross-repo, structurally.
colab blocked <N> --by <M>
colab blocked <N> --by <M> --clear --reason "<why>" [--force]   # --force only overrides
                                                                  # the closed-blocker guard

# raw (portable fallback; the payload is the DATABASE id, not the issue number — the trap
# `colab blocked` exists to make unreachable, see below)
gh api -X POST   repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by -F issue_id=<db-id>
gh api -X DELETE repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by/<db-id>
gh api repos/{owner}/{repo}/issues/<M> -q .id      # ← how to get that db-id

# write a parent/child — GraphQL, and this one takes NODE ids
gh api graphql -f query='mutation($p:ID!,$c:ID!){addSubIssue(input:{issueId:$p,subIssueId:$c}){clientMutationId}}' \
  -f p=<parent-node-id> -f c=<child-node-id>
gh api graphql -f query='mutation($p:ID!,$c:ID!){removeSubIssue(input:{issueId:$p,subIssueId:$c}){clientMutationId}}' \
  -f p=<parent-node-id> -f c=<child-node-id>
gh issue view <M> --json id -q .id                 # ← how to get that node id
```

`removeSubIssue` requires **both** ids — a child cannot be detached by naming only
itself. (`addSubIssue` is the laxer of the two — it accepts `subIssueUrl` in place of
`subIssueId`, and `replaceParent: true` to move a child that already has a parent; `removeSubIssue` has neither.)

**The two halves do not share an API, and that is the trap.** Sub-issues are GraphQL,
keyed by **node** id; dependencies are REST, keyed by **database** id — no dependency
mutation exists in GraphQL. Three mistakes fail loud (wrong type, `NOT_FOUND`); one is
silent and is the one to fear: the REST endpoint accepts an **issue number** as a valid
integer database id and **succeeds**, attaching a blocker from whichever issue happens to
hold that id *anywhere on GitHub*. **Read `blockedBy` back after every write.** `colab
blocked` (#251) takes issue numbers only, so this hazardous value never passes through a
caller's hands at all.

Why, with the measurements: [ADR 361](../../docs/adr/361-readiness-and-dependency-edges-rationale.md).

**Read that confirmation from the `blockedBy`/`blocking` connections, never
`issueDependenciesSummary` — the summary lags the graph.**

**"No blockers" and "nobody checked" are the same empty list** — the second needs its
own marker:

```sh
gh label create deps-checked --color 0E8A16 --description "Dependencies verified — no open blocker"
colab readiness <N>           # set only after actually looking (raw: gh issue edit <N> --add-label deps-checked)
colab readiness <N> --clear   # a genuinely NEW blocker appeared, or the issue reopened — never "not now"
```

**`deps-checked` is monotonic (#279): once set, it stays set.** It records that a
reasoning session looked and found no open blocker — not that the issue is startable
*today*. Clearing it means exactly one of two things: a new blocker appeared (already
carried by the `blockedBy` edge above, so stripping the label on top of that edge adds no
information), or the issue reopened after being closed. It never means "startable in
principle, but not right now" — that fact has its own carrier, below (*Disposition*). A prose note saying "checked, no blockers" does not count as setting it.

## Reference implementation of the readiness verdict

The rule: [CONVENTIONS.md, *Readiness is not a boolean — read the blocker's state, not just its existence*](../../CONVENTIONS.md#readiness-is-not-a-boolean--read-the-blockers-state-not-just-its-existence).

Reference implementation: `tools/lib/readiness.js` (`classify`, `isStartable`), pure —
facts in, verdict out — deriving "blocker's code written but unmerged" from
`tools/lib/landed.js` rather than re-counting commits.

## Mechanical readiness — a weaker, honest claim for the empty case (#69)

The rule: [CONVENTIONS.md, *Mechanical readiness — a weaker, honest claim for the empty case (#69)*](../../CONVENTIONS.md#mechanical-readiness--a-weaker-honest-claim-for-the-empty-case-69).

`deps-checked` asserts *somebody looked* — stronger than "the encoded graph, read via
the API, has zero edges". **A mechanical check must never write `deps-checked` itself**.

```sh
gh label create graph-empty --color BFDADC --description "Mechanical check: the recorded dependency graph reads empty — NOT a substitute for deps-checked"
colab readiness <N> --mechanical           # reads blockedBy; if empty, applies graph-empty + posts a receipt
colab readiness <N> --mechanical --clear
```

- **Re-derives its own evidence** on every run, rather than trusting a caller-supplied
  flag.
- **Posts a receipt** naming what was read and when.
- **`blockedBy` only** — says nothing about parent/child relations (*Epics*, below).
- `readiness.classify()` keeps `graphEmpty`/`depsChecked` as distinct type-level inputs;
  empty-but-unchecked reads a fourth verdict, `unchecked-mechanical` — `isStartable()`
  still says no by default.
- Not in the convention label set ([§9](../../CONVENTIONS.md#9-adopting-this)), same reasoning as `tracking`.
- **No `readiness.marked` event fires for `--mechanical`**. Why, with the measurement: [ADR 539](../../docs/adr/539-readiness-rationale.md).

## The wake: vocabulary — a wake a scheduler can check (#382)

The rule: [CONVENTIONS.md, *The `wake:` vocabulary — a wake a scheduler can check (#382)*](../../CONVENTIONS.md#the-wake-vocabulary--a-wake-a-scheduler-can-check-382).

Why a wake had to be checkable, with the measurements: [ADR 382](../../docs/adr/382-wake-vocabulary-rationale.md).

So `wake:` is now one of these, and a scheduler can evaluate every form on every beat:

| `wake:` | Met when |
|---|---|
| `review-by:<date>` | the date is reached. The `review-by:<date>` label is on the issue too. The label is what a query reads, and this line restates it |
| `#N` | the issue behind the `blocked_by` edge to `#N` closes (*Readiness*, above). The edge must exist |
| `ruling` | the owner acts. `Because:` is the ask (below). No fact makes this one "met": the owner's act *is* removing the label |
| `issueClosed:<owner>/<repo>#<n>` | that issue is closed. Use it for another repo's issue when no cross-repo edge is set. `issueClosed:<n>` (no owner/repo) names this repo's own, but a same-repo wait should normally be a `#N` edge instead |
| `branchLanded:<ref>` | `<ref>`, resolved as written, is an ancestor of trunk. A squash-merge never makes a branch tip an ancestor, so where branches land by squash, wait on the branch's issue (`#N`, `issueClosed:`) or on the landed commit (`trunkAt:`) instead |
| `trunkAt:<sha>` | trunk contains `<sha>` (7–40 hex) |
| `labelPresent:<label>` | the held issue carries `<label>` |
| `after:<date>` | the date is reached. Same meaning as `review-by:`, in the form a scheduler stores |

**`ruling` is the one definition of the "waiting on the operator" reason line.** When the
wake is `ruling`, the `Because:` line is the ask itself, written as what the owner has to
do or answer. A consumer's card reader parses this line and does not invent a second
syntax for it. If the ask is a question rather than an act, it belongs under
`needs-decision` instead, where the answer gets a record of its own (`shape:`, below).

**One spelling, not two.** Every checkable name above is spelled exactly the way the one
adopting scheduler that evaluates wakes already spells it, argument rules included. The direction is one way: a consumer that evaluates a
`wake:` never invents a second spelling for a name on this list.
`tools/lib/wake.js` is the parser and evaluator, and its tests pin the list.

Why two kinds are not adopted: [ADR 382](../../docs/adr/382-wake-vocabulary-rationale.md).

The rules:

1. **Several conditions on one line are ANDed:**
   `wake: issueClosed:owner/repo#12, trunkAt:abc1234`. A hold never wakes early on part of
   its condition, and a line with one piece outside the vocabulary names no wake at all.
   It is never read as its checkable rest.
2. **A wait on other work must use one of the checkable forms.** If that work has no
   issue yet, file one and point the hold at it. Only a wait that has no checkable form
   at all stays prose in `Because:`, such as a vendor or a person outside the repo. That
   wait **must** carry `review-by:<date>`.
3. **A `wake:` that names an issue or ref that does not exist is a finding when it is
   written**, not at the review date.
4. **A met wake does not lift the hold by itself.** A scheduler that evaluates wakes
   posts once that the condition is met and hands the issue to triage. Triage reads the
   newest ruling or `Hold:` line, and reports the hold as *wake met, lift?*. The owner removes the label, as above. The
   evaluator proposes; it never clears.
5. **Wakes are re-checked on every triage pass**, not only once `review-by:` is reached
   (`code-triage` §0, §2, §5). A wake that comes true between two passes is noticed on the
   next one, whether or not anything else in the backlog moved.

This applies to `deferred:*` and to every label declared under `holds:` alike, because
both carry the same `Hold:` line.

Nothing in this repo's tooling writes a `Hold:` line. The mechanical parts are the
audit's shape check on `holds:`, the codec's `Hold:` line pair (`tools/lib/codec/hold.js`, which
decodes only this exact shape — a looser line names no owner or wake and stays a stall), and
`tools/lib/wake.js`, which parses a `wake:` value and evaluates it against facts a caller has
already gathered. Whoever parks the issue writes
the line, and `code-triage` reads it (its §0, §2, §5 and §6).

## The shape: field — what the owner is asked for (#569)

The rule: [CONVENTIONS.md, *The `shape:` field — what the owner is asked for (#569)*](../../CONVENTIONS.md#the-shape-field--what-the-owner-is-asked-for-569).

Optional, between `owner:` and `wake:`, never after `wake:`; every new hold declares it.
Why, and why that position: [ADR 569](../../docs/adr/569-hold-shape-rationale.md).

| `shape:` | The owner is asked for | Carrier |
|---|---|---|
| `ask` | a **choice** between ways forward | **never a bare hold:** `needs-decision` + a `decision:options` block (*Decision options*, below) — 2–4 options, one `(recommended)`, `Because:` names what makes it the owner's call |
| `task` | an **act** only a person can perform: sign, run a privileged script, supply a credential | a hold, `wake: ruling`; `Because:` is the act |
| `wait` | nothing yet: a third party, other work, a date | a hold with a checkable `wake:` or `review-by:<date>` |

```
Hold: needs-decision — owner: @maintainer — shape: ask — wake: ruling
Hold: hold:manual — owner: @maintainer — shape: task — wake: ruling
Hold: deferred:external-party — owner: upstream — shape: wait — wake: issueClosed:owner/repo#22
```

Present → readers use it; absent → inferred from the wake as before (`ruling` → `ask`, else
`wait`); any other value is a finding and falls back to the inference. A reader that does not
know the field still parses the line, wake whole. `holdShape()` in `tools/lib/codec/hold.js`
returns the declared or inferred shape. A person-only check on finished code is no hold at all.

## Disposition — the marker, the seven kinds, and who may apply one (#315)

The rule: [CONVENTIONS.md, *Disposition — the marker, the seven kinds, and who may apply one (#315)*](../../CONVENTIONS.md#disposition--the-marker-the-seven-kinds-and-who-may-apply-one-315).

The park above is one of seven ways a piece of work can end. This subsection names all
seven, the marker that proposes one, and the rule deciding whether an agent may apply it
unattended or a human must.

**A session does not dispose of its own issue.** It does the work, posts evidence, and
proposes a disposition; a **separate later pass applies it**.

Why the separation: [ADR 315](../../docs/adr/315-disposition-kinds-rationale.md).

**The proposal is a marker**, one line, the family `colab:evidence` / `colab:grade` already
use (*Rules*, above), followed by a one-line reason in prose:

```md
<!-- colab:disposition proposed=hold -->
Waiting on the DNS change; `review-by:2026-10-01`.
```

`<token>` is one of a **closed** set of seven, **read by equality** — never by prefix, never
by heading text. No token is a prefix or a decorated variant of another. An unrecognised
token, a missing marker, or two markers proposing different things all mean **"not
cleared"** — never a silent default to the safe-looking value. *Degrade, never gate* applies
to absence exactly as it does for `colab:evidence`: a comment with no marker is evidence
with no proposal, never "no evidence exists".

**The kind and the token differ for exactly one member.** `not planned` keeps GitHub's own
close-reason spelling, because that is the string the close is made with; its token is
`not-planned`, because a token compared by equality cannot carry whitespace.

**One kind has a legacy name, read but never written** (#609, why on the issue). A
reader accepts `needs-boss` as a kind and as a token and classifies it exactly like
`needs-owner`; an old and a new marker on one comment are one proposal, not two; writers emit
`needs-owner` only. The park label adopters keep switches alike: `blocked:needs-owner`, with
`blocked:needs-boss` still read as the same park (the handbook provisions neither). Accept both
until the old name has had no open use for 14 days; dropping it is a separate change.

| Kind | Token | What it means | What it converts to |
|---|---|---|---|
| `done` | `done` | The ask was executed **and** cross-checked; acceptance ticked, or a remainder declared | closes with evidence |
| `split` | `split` | Part landed; the remainder is filed as a native sub-issue carrying the same `delivery:` and a wake condition, evidence copied across | closes with evidence |
| `routed-out` | `routed-out` | The work belongs to another repo; `<other-repo>#N` exists and links back | closes with evidence |
| `hold` | `hold` | Parked on a named wake condition | `deferred:<kind>` + a `Hold:` line whose `wake:` is from the closed vocabulary (above) |
| `needs-owner` | `needs-owner` | A human must answer before anything else can happen | a recorded decision (*Decision gate*, below) |
| `not planned` | `not-planned` | Superseded, or the direction was abandoned | closes as `not planned` |
| `leave` | `leave` | Nothing decided | **never applied by an agent** — a nameable wake ⇒ `hold`; nothing to name ⇒ a *finding* |

`leave` is the one kind that is not really a disposition. An issue on its fourth session
with no disposition is a **brief problem, not a measurement problem** — so an agent converts
it or reports it, and never leaves it. A human may leave with a reason; that reason is
itself the wake condition.

**The evidence a marker rides on has a fixed shape** — *what was done · the command · the
result · what remains*. Free-form evidence is a **finding, not a disposition**. Where the ask was an **action** rather than a
measurement, a fifth line carries the **cross-check**: a second, independent, re-runnable
command confirming the effect.

## Who may apply one — a table over measurable inputs, never a judgement call

The rule: [CONVENTIONS.md, *Who may apply one — a table over measurable inputs, never a judgement call*](../../CONVENTIONS.md#who-may-apply-one--a-table-over-measurable-inputs-never-a-judgement-call).

"Sometimes an agent, sometimes a human" has to be **deterministic**, decided from facts on
the issue, never from an agent's own confidence in its work. Two inputs are shared, and both
gate only the two kinds whose close **asserts an outcome** — `done` and `not planned`.
`split` and `routed-out` close too, but they re-home work rather than claim it finished, so
neither input reaches them.

- **The axis of record** (*Exposure*, §2). `exposure: released` ⇒ a human confirms; `none`,
  `self` and `live` ⇒ the agent applies. Read a legacy `tier`-only descriptor **through**
  that axis (`A -> released`, `C -> live`, `B -> null`) rather than by letter — which means
  a bare `tier: B` resolves to *no opinion*, and no opinion is not permission.
- **Skip-fence class** — production access, credentials, destructive or non-undoable
  operations, promotion. Evidence naming one of these ⇒ human, whatever the exposure. The
  agent names the classes its evidence touches; nothing sniffs prose for them.

| Disposition | **Agent applies** unattended when… | **Human must** apply when… |
|---|---|---|
| `done` | evidence in the fixed shape **∧** a re-runnable cross-check recorded **∧** acceptance ticked or a remainder declared **∧** the issue gates nothing still open **∧** the axis permits **∧** no skip-fence class | the axis does not permit · a skip-fence class · no cross-check possible · the issue is a gate node for something open |
| `split` | the remainder is filed as a native sub-issue with the same `delivery:` and a wake condition, evidence copied across | never — filing is mechanical |
| `routed-out` | `<other-repo>#N` exists **and** links back to this issue | never — but the filing itself obeys the destination repo's own language rule |
| `hold` | a wake condition is present — `review-by:<date>`, a real `blockedBy` edge, **or** a `wake:` from *Holds*' closed vocabulary | the wake has stood **30 d** (a PROPOSAL, unmeasured; a repo may declare `thresholds.hold-stale-days`) with no movement ⇒ a human confirms it is still wanted, else `not planned` |
| `needs-owner` | **never** — the agent *records* the question and moves on (record-first) | always; the answer returns the issue to intake |
| `not planned` | superseded by a **merged or closed** replacement that references this issue | an abandoned direction — a human judgement, always |
| `leave` | **never** — the agent converts it (see above) | a human may leave with a reason |

Three properties hold this together, and each is load-bearing:

- **Fails towards `human`, always.** An absent, malformed or unresolvable fact never yields
  `agent` — the posture *Readiness* (above) takes towards `ready`. Why, with the measurement: [ADR 539](../../docs/adr/539-disposition-marker-rationale.md).
- **"An agent may" is never "a human may not."** A human can apply any disposition on any
  issue at any time, in either direction. The verdict is a proposal, not a lock.
- **A mechanical gap is not a judgement call.** `split` with nothing filed yet, or `hold`
  with no wake named, is not *escalated* — it is *incomplete*. The fix is to file the
  sub-issue or name the wake, not to ask somebody. Only the outcome-asserting kinds escalate.

**The reference implementation is `tools/lib/disposition.js`** — pure, facts in, `agent` |
`human` out, no tracker I/O, the pattern `readiness.js`, `landed.js` and `axis-authority.js`
already set. Two consumers reaching the same verdict from the same evidence holds **by
construction** only if both call one function, or copy-and-own that file ([§9](../../CONVENTIONS.md#9-adopting-this)); two prose
copies of the table above is the two-places-drift disease this handbook exists to kill.
`parseMarker` / `formatMarker` are the only sanctioned way to read or write the marker —
they are what keeps the token set closed and the comparison by equality.

**This section defines vocabulary only**, exactly as the park above does. Nothing in this
repo's own tooling writes `colab:disposition` today, and no skill here reads it. What lives here is the table both sides agree on.
