# Branches and commits — how the CLI lands a branch

The mechanics behind [CONVENTIONS.md §4](../../CONVENTIONS.md#4-branches-and-commits). Branch naming,
Conventional Commits, the squash, who may touch a branch, whether it has landed, and the landing
contract stay there as rules; how this repo's CLI carries them out lives here. Moved verbatim from
CONVENTIONS.md §4 by #638 — only links were retargeted. What lives in this directory, and why:
[README](README.md).

## The `Machine:` trailer and public repositories (#350, #367)

The rule: [CONVENTIONS.md §4, the landing contract](../../CONVENTIONS.md#4-branches-and-commits), item 9.

**The `Machine:` trailer (#350).** Every squash `colab ship` lands carries
`Machine: <label>`, whether the message is composed or given with `--message`, and whether or
not the repo declares a prefix. The label is the same normalised host label the prefix uses —
a name, never a hardware identifier. It exists so that conflicts across machines can be
measured from git alone:
`git log --format='%h %(trailers:key=Machine,valueonly)' <trunk>` lists which machine landed
each unit. It records where a landing ran. It is not an identity, and no gate reads it
([§2, *Core paths*](../../CONVENTIONS.md#core-paths--a-pr-and-a-non-author-approval-before-landing-350)).

**Not on a public repository (#367).** `colab ship` reads the destination first. If the forge reports
the repository as public, or `project.yml` declares `room: public`, the squash carries no
`Machine:` trailer, and the `Colab-Adopted:` trailer (#324) keeps its branch and sha but drops
its `on <host> (machine <id>)` tail. A private repository is unchanged. When the visibility
cannot be read (no forge CLI, a remote that is not on the forge, offline) and `room:` does not
declare `solo` or `team`, ship **omits** the trailer and warns. It fails closed because a missing
line costs one traceability record and a published hostname cannot be taken back. Declaring
`room:` restores it. `colab ship --dry` prints `Machine trailer: …` with the decision, and
`--dry --json` reports it as `machineTrailerDecision`. The cross-machine measurement above
therefore covers private repositories only. A `branchPrefix: machine` branch name still carries
the label too, and that stays a deliberate choice for the repo that declares it. Why: [ADR 539](../../docs/adr/539-branches-and-commits-rationale.md).

## The squash-subject picker (#261)

The rule: [CONVENTIONS.md §4, the landing contract](../../CONVENTIONS.md#4-branches-and-commits), item 8.

**The squash-subject picker recognises a wider, RANKED set, not just the branch-name
list above (#261).** `colab ship`'s default subject is the branch's highest-weight
commit — highest wins, ties go to the oldest — in this order, documented here because
before #261 it was discoverable only by shipping a branch and reading a warning:

```
breaking (any type, +1000) > feat > fix > perf > refactor / revert > design > docs
  > test > build / ci > style > chore
```

`design:` (a specification, mockup, or visual decision rather than a behaviour change)
is ranked here, not merely branch-legal. Why: [ADR 539](../../docs/adr/539-branches-and-commits-rationale.md).

**A type outside this list is not invisible, but it cannot outrank a named one.** A
commit shaped like a Conventional Commit (`type(scope): text`) whose `type` this repo
does not weigh — `wip:`, `spike:`, an adopter-invented type not yet added here — ranks
below every named type, but above a commit with no Conventional Commit shape at all: on
a branch where nothing else carries a named type it now wins the subject over a
shapeless commit, and on a mixed branch it still loses to a named type, silently,
exactly as before. `colab ship --dry` warns about this class either way (`N commit(s)
… carry no recognised Conventional Commit type`); the fix is to re-word the commit to a
recognised type, or ship with `--message "<subject>"` so the subject is stated rather
than guessed.

**A follow-up to the branch's own unshipped lines ranks below every type (#621).** A
commit whose every changed line was added by an earlier commit on the same branch (absent
from the merge base, measured by `git blame`) repairs nothing a consumer saw, so it never
titles the unit — a `fix:` to a `refactor:`'s new text ships under the `refactor:`. A pure
insertion into a trunk file, or a file the commit creates, is new content, not a follow-up.

## Closing issues at the landing

The rules: [CONVENTIONS.md §4, the landing contract](../../CONVENTIONS.md#4-branches-and-commits), items 2–7.

- **[Hard — gate: colab ship refuses unticked plan]** **`Closes #N` requires the issue's own scope fully accounted for — a mechanical gate,
  not an honour system (#74).** An issue's `## Plan` is a real GitHub checklist — one
  `- [ ]` line per deliverable, load-bearing. A prose-only `## Plan` cannot be verified
  mechanically (reported, not blocking; cannot bind an issue opened before this
  convention). `colab ship` parses the checklist before composing the squash body: any
  claimed issue with an unticked box and no declared `Remainder: #M` **refuses the
  merge outright (#263)** — a precondition row exactly like a red CI run, not a silent
  `Closes #N` → `Refs #N` downgrade that lets the ship proceed anyway. Ticking every box, declaring
  `Remainder: #M`, or an explicit `--refs #N` (a deliberate choice, never gated) all
  clear it. A hand-merge runs the identical check by reading the same two fields
  (`gh issue view N --json body,comments`). Why: [ADR 539](../../docs/adr/539-branches-and-commits-rationale.md).
- **Requiring the remainder issue is the convention — the gate does not file one for
  you (#263).** Why: [ADR 539](../../docs/adr/539-branches-and-commits-rationale.md).
- **`--refs` keeps an issue open, so the same step must also stop it being started
  (#385).** `--refs #N` is still a deliberate choice and still ungated. But after the ship,
  #N is open, possibly `deps-checked`, and unclaimed. If nothing on it says "do not start",
  a scheduler picks it up again as code work. So when you choose `--refs` over closing:
  - **The leftover is a check only a person can run** (a UI click-through, a look on a
    real device, a live end-to-end proof): do not `--refs` it. Close #N and add one row to
    the repo's single open `Human verify:` issue (§5 *Human verify*, #491).
  - **The leftover is another non-code wait** (a measurement a machine can take, a date,
    an outside party): park #N in the same ship. Add `deferred:<kind>` +
    `review-by:<date>`, plus a `Hold:` line naming who posts the proof (*Disposition* and
    *Holds*, §5).
  - **The leftover is code**: prefer `Remainder: #M` and let #N close. The remainder
    issue is a start candidate of its own and can carry its own hold. #N kept open for
    code is a second start candidate for the same work.

  `colab ship` prints a **reminder, never a refusal**, when a `--refs`'d issue still has
  an unticked `- [ ]` box under any heading and carries nothing that stops a start:
  `deferred:*`, `needs-decision`, a non-code `delivery:*`, `tracking`, or a label declared
  under `holds:`. `--dry --json` reports the same thing as `refsBrakeFindings` and as an
  `ok: true` advisory row. The tool never applies the hold itself. Which kind, whose wake
  and which date are the shipper's call, never the tool's — the gate does not file the
  remainder issue either. Why: [ADR 539](../../docs/adr/539-branches-and-commits-rationale.md).
- **[Hard — gate: colab ship refuses uncorroborated issue]** **Every closed issue must be corroborated by git, not the claim registry alone (#87).**
  Corroboration reads two git-side sources: the branch name's
  **trailing** number group, and `#N` or `(issue N)` (#611) references in **commit bodies** (never a
  bare number). An issue named by neither is a finding — `colab ship` refuses; a hand merge must perform the same check.
  Do not resolve it by quietly writing `Refs #N` — that hides the collision; `--refs`
  exists for when an operator actually means it. Why: [ADR 539](../../docs/adr/539-branches-and-commits-rationale.md).
- **[Hard — gate: evidence-close needs an evidence comment]** **A deliverable with no diff still has to close (#90).** A decision recorded, an
  investigation concluding "no change needed", an artifact stored outside the repo —
  there is nothing to squash. `colab ship` detects `landed ∧ zero own commits` (both
  measured from git, never declared by the session) and switches to **evidence-close**:
  post evidence, close each issue, tear down — no merge, no push, no `--allow-empty`
  marker commit. Gated on the issue **already carrying a comment the tool did not write**.
  A unit committed straight to trunk has no branch to detect this from; it closes the same
  way through `colab ship --direct` (#302), which matches its claims by session identity and
  refuses until the work is published.
- **A ship releases every claim it carried (#319)** — not only the worktree's. An unattached
  claim of the *same session* is carried by a branch ship only when the branch name's
  trailing group names it; otherwise it is reported and left alone, never closed. Why: [ADR 539](../../docs/adr/539-branches-and-commits-rationale.md).
- **[Hard — gate: colab ship refuses unadopted remote-only branch]** **A branch this machine never held is not a legit zero (#324).** A branch that exists only
  on `origin`, with no issue number in its name and no local claim, is most likely another
  machine's work in flight; `colab ship` refuses it unless `--adopt` is passed, and an
  adopted squash carries a `Colab-Adopted:` trailer naming the remote sha and this machine.
  A local ref does not make it this machine's (#343): when the ref's oldest reflog entry says
  git created it from `origin/<same name>` (a DWIM `checkout`/`switch`/`worktree add`, or
  `--track`), it reads the same as remote-only. Where no reflog survives, nothing contradicts
  the local reading. A branch that **does** name its issues, with the claim on another machine,
  lands without a takeover from its executor's hand-off (#578): `colab ship --branch <b>
  --handoff <comment-url>` takes the issue set from the branch name once that comment names the
  branch and its current remote head and every issue carries the executor's live claim on it;
  nothing is claimed here, and the executor keeps its worktree until it confirms the land. A
  handed-off branch that fell behind its base is synced by the lander as usual, and the hand-off
  still holds (#579): commits after the handed-off sha are accepted only when each is a pure
  base-sync merge — second parent already on the base, tree equal to git's own clean merge. Any
  other movement still needs a new hand-off. The hand-off comment is the last word on its head —
  edited or re-posted, never followed by a plain comment (#586): [`code-wrap`, *Hand off*](../../skills/code-wrap/SKILL.md#post-the-hand-off-comment--the-last-word-on-its-head-586).

## Has it landed — the CLI's check

The rule: [CONVENTIONS.md §4, *Has it landed?*](../../CONVENTIONS.md#has-it-landed--the-one-rule-because-the-obvious-one-is-wrong).

```sh
colab landed --worktree <name>     # landed · cargo · unknown
colab landed --all                 # every worktree of this repo
```

**A green branch can be reporting a red base's problem, not its own (#293).** `colab
ship`'s trunk-CI-green check asks whether trunk is green *right now* — never whether
the sha a branch was actually *cut from* was green *at the time*, and those differ
once trunk has moved. Why: [ADR 539](../../docs/adr/539-landed-rationale.md).

```sh
colab landed --worktree <name> --ci     # adds: was the cut-from sha actually green?
```

Advisory only — it never blocks `colab landed` or `colab ship` (both surface it as an
additive field/row, never as a new precondition). Three severities, loudest first:
`suspect-green` (base red, branch's own head green — the branch's green may be
inherited, not earned), `inherited-red` (base red, branch's own head red too — likely
the same pre-existing failure), `unresolved` (base red, branch's own head has no
completed verdict yet). Silent when the base was not measurably red.
