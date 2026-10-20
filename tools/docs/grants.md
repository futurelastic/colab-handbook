# Grants — the human flag and the migration exemption

The mechanics behind [CONVENTIONS.md
§5](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this) — the classes only a person
decides: the human flag and the migration grant (the red-trunk grant is in
[`red-trunk.md`](red-trunk.md)).
The rules stay there, in the claims and decisions contract, in words that name no tool; how this
repo's CLI carries them out lives here. Moved verbatim from CONVENTIONS.md §5 by #639 — only links
were retargeted; each section keeps its heading there. Frozen with the rest of §5
([ADR 604](../../docs/adr/604-scope-freeze.md)). What lives in this directory, and why: [README](README.md).

## The human flag — what COLAB_HUMAN=1 asserts

The rule: [CONVENTIONS.md, *The human flag — what `COLAB_HUMAN=1` asserts*](../../CONVENTIONS.md#the-human-flag--what-colab-human1-asserts).

`COLAB_HUMAN=1` is one mechanism carrying one assertion, used at several gates in this
handbook: **a human is behind this command.** Read every site below as an instance
of the same assertion, never as a separate rule with its own semantics:

- **Promotion** ([`colab promote`](../../CONVENTIONS.md#4-branches-and-commits)) — authorises the act that
  deploys to production.
- **Migration exemption** (below) and **Red-trunk exemption** (below) — authorise a write
  that did not exist before the command ran.
- **A place-claim override** ([Place-claims](../../CONVENTIONS.md#place-claims--the-writer-verifiable-hold-a-shared-checkout-needs-and-a-worktree-does-not),
  above) — authorises taking over a live hold.
- **`colab adopt`'s exposure-lowering gate** — authorises a descriptor claiming fewer
  consumers exist than the tool can verify.
- **Solo-flow entry** ([Solo flow](../../CONVENTIONS.md#solo-flow--trunk-direct-issue-on-demand-entry-gated-a-human-must-be-at-the-keyboard),
  above) — the newest instance (⚖ #233): asserts a human is present to commit straight to
  trunk, on any repo that does not declare the veto.

**Two terms make the assertion checkable, not just statable**:

- **Transcription, never inference.** Set it because a human said so — "take the trunk,"
  "promote this," "grant the migration" — never because the situation seemed to call for
  it. A human's go-ahead counts; an agent's own reading of the situation never does.
- **Live conversation only.** A headless, scheduled, or driver session may never set it,
  whatever its prompt contains. Why, with the measurements: [ADR 233](../../docs/adr/233-human-flag-rationale.md).

**The honest limit, stated once here rather than wherever it currently gets re-derived:**
`COLAB_HUMAN` is an env var the gated party can set itself — nothing enforces the two
terms above beyond the discipline of everyone honoring them (#150, parked: a stronger
mechanism would need an out-of-band attestation this fleet does not have). The two terms
are what make a violation *legible* after the fact, not what makes one impossible.

Why, with the measurement: [ADR 539](../../docs/adr/539-human-flag-rationale.md).

## Migration exemption — a narrow door through no-new-migrations, opened by a role (#98, #402)

The rule: [CONVENTIONS.md, *Migration exemption — a narrow door through no-new-migrations, opened by a role (#98, #402)*](../../CONVENTIONS.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402).

**[Hard — gate: colab ship refuses]** `colab ship` refuses, by default with no flag/env/field to lower the bar, any branch
touching `database/migrations/` or `prisma/migrations/` — or any prefix the repo declares in
`project.yml` `migrations:` (#383, [`project.schema.md`](../../project.schema.md#migrations--optional)).
A declaration only ever widens what the gate sees, never narrows it.

**A migration grant is a narrow, per-issue, branch-bound, expiring exemption, and every
grant names the role that decided it** — deliberately not a repo- or tier-level switch.
There are two roles. The repo says which ones it accepts (#397, #398):

| Role | Who decided | Marker | Bound to | Accepted |
|---|---|---|---|---|
| `human` | a person | `🛢 Migration grant` | the branch | on every repo — the default |
| `migration-reviewer` | a declared reviewer, with a review record | `🔎 Migration review grant` | the branch's exact HEAD, plus a live CI round-trip on it | only under [`migration-grant: reviewer`](../../project.schema.md#migration-grant--optional) |

**On trunk, where the repo's policy allows it and a reviewer is bound, a reviewer grant with
evidence satisfies the gate just as a human grant does.** Nothing else moves with it:
`COLAB_HUMAN=1`, promotion, release and production stay human on every repo, under every
policy.

**What holds for every role:**

- **[Hard — gate: colab migration-grant refuses]** **Minting is a human act.** `colab migration-grant` refuses (exit 1) unless
  `COLAB_HUMAN=1`, checked before any network call, for either role — no agent may create
  or infer one ([*The human flag*](../../CONVENTIONS.md#the-human-flag--what-colab-human1-asserts), above).
  The reviewer role changes what a grant must *prove*, not who may post it.
- **Two required parts**: a `migration-granted` label (requires write/triage permission)
  and a comment naming the exact branch. Never authorises a migration arriving on a different branch later.
- **Expires the instant its issue closes** — `ship` reads the issue's live open/closed
  state, never a separate expiry.
- Visible from any machine — no local-only fallback.
- **Covers the whole ship set**, never narrowed by `--refs`. One issue without a valid grant fails the set.
- `--revoke` removes the label first (gate restored immediately), then posts a receipt.
  A revoke cancels every earlier grant on the issue, of either role, whoever posted it.
  `colab migration-grant --list` names every live grant.
- **Never weakens any other precondition** — CI green, claim corroboration, trunk-checkout
  check, and hand-merge conflict check all still run in full on a granted branch.
  `--batch` still refuses every member that carries a migration, granted or not.

**Who counts as a human — `trust-humans` (#407).** By default a grant (or a ruling,
[*Decision gate*](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122), above) counts as a
human's when its author's GitHub association is `OWNER`, `MEMBER` or `COLLABORATOR`. Why, with the measurements: [ADR 98](../../docs/adr/98-migration-exemption-rationale.md). A repo
in that position lists its humans:

- **Declared** ([`trust-humans:`](../../project.schema.md#trust-humans--optional)) → a human
  grant or ruling counts only when its author's login is listed (and still holds that
  association). For `migration-granted` and `ci-granted`, the account that **last applied
  the label** must be listed too, so a label re-added by an agent does not ride on a
  human's old comment. An unlisted, unknown or unreadable author is not human, and the
  refusal names the login.
- **Absent** → the association class decides, exactly as before. Nothing changes for a
  repo that does not declare it.
- **Read from the target, never the branch.** Ship reads the list from `project.yml` at
  the tip of the branch being merged into, and rulings read trunk's — a branch cannot
  add its own author. **Editing the list is a human act**, like lowering exposure. As
  with every other human-only rule here, #150's limit applies to *enforcing* that: the
  handbook cannot stop an account with write access from editing the file.
- **A reviewer grant is not judged by this list.** It passes or fails on the policy, the
  review record, the HEAD and the round-trip below. The list decides only what a *human*
  grant is.

**The human role** is unchanged since #98: branch-bound, not HEAD-bound, and honoured on
every repo. Where both roles are live on an issue, a valid human grant wins.

**The reviewer role** names the reviewer's **declared** identity and carries a **review
record**: a fenced `` ```migration-review `` block giving the verdict, the checklist
result, the escalation condition checked, the CI round-trip result, the reviewed HEAD
sha, and a `migrations:` content id that `colab migration-grant` computes itself. Four
properties hold it together:

- **Bound to what was reviewed (#508).** The content id is a sha256 over the path and git
  blob id of every migration file the branch changes, at the reviewed HEAD. The grant covers
  that content, not that commit. A commit that leaves every migration file byte-identical
  keeps the grant live. Editing, adding, removing or renaming a migration changes the id
  and voids it.
  Why, with the measurements: [ADR 98](../../docs/adr/98-migration-exemption-rationale.md).
  A record with no content id (minted before #508, or on a branch with no migration file)
  stays bound to its HEAD alone, and a new commit voids it as before. Older readers refuse the
  unknown key. A branch with a migration never gets one: no computable id is refused (#563).
- **Opt-in: per repo, or once per machine (#598).** The policy resolves, highest first: the repo's
  own `migration-grant:` (the trunk checkout at mint, the target's tip at ship) → this machine's
  value, in its colab config → `human`. `colab migration-grant` refuses to mint a reviewer grant
  unless the policy resolves to `reviewer`. A repo that writes `migration-grant: human` opts out,
  and the refusal says so. **Setting the machine value is a human act, the same class as minting a grant.**
  `COLAB_HUMAN=1 colab config set migration-grant` refuses without it and records who, when and on
  which host. Its reach is that one machine: a gate run elsewhere resolves to `human`. The
  owner-level record (#596) is retired and no gate reads it: any org member could post it, and the
  shared account agents post from usually is one. Every printed policy names its source: `repo`,
  `machine` (who, when) or `default`. Why: [ADR 539](../../docs/adr/539-migration-rationale.md#machine-level-reviewer-policy-598).
- **Recorded only if the review passed.** The record must approve, pass the checklist,
  clear the escalation and pass the CI round-trip. A failing review is refused, not
  recorded. A *claimed* pass is checked too, before anything is written (#457): the CI
  round-trip job must have run and passed at the recorded HEAD, a cited run must be one of
  that HEAD's runs and carry the job, and a checklist count must be out of the checklist the
  review skill walks today, every item passed. A repo whose CI has no round-trip job cannot
  mint a reviewer grant at all — it adopts the template's job or ships on a human grant.
- **Not attested.** The reviewer id and the recorded CI result are claims made in the
  comment. The label's write permission and the trusted-author check are the only
  anti-forgery properties, so a gate re-verifies CI for the recorded HEAD itself — the
  mint-time check only keeps an honest tool from writing a false record; it proves nothing
  about a comment posted by hand.

**[Hard — gate: colab ship refuses without conditions P, M, HEAD, R]** **`colab ship` honours a reviewer grant only when four conditions hold together (#401):**

- **P, policy.** The policy resolves to `reviewer` at the tip of the branch being merged
  into (its key, else this machine's value, #598). The branch's own copy never counts.
- **M, record.** A live reviewer marker from a trusted author, bound to this branch,
  with a valid review record that passes.
- **HEAD.** Ship reads the branch's head on the remote, and the local branch must agree
  with it. The grant binds that head when the record's head is exactly it, or when the
  record's `migrations:` id equals the id ship computes at that head (#508), using the
  same path rule the gate fires on. An unreadable id never matches.
- **R, round-trip.** The live CI round-trip passed on the **shipped** head, which after a
  sync is not the reviewed one. Ship re-reads CI itself
  and never trusts the recorded `ci-roundtrip:` value. The job is found by the name
  prefix `Migration round-trip` (the legs of `templates/ci-laravel.yml`, or of the opt-in
  block in `templates/ci-node.yml` / `ci-python.yml`, #494, #625). A skipped leg fails R. Every leg
  needs a run that completed with success and ran at least one step. The template's job
  rolls back to the oldest migration the branch **adds or modifies** (#507), so a branch
  that only repairs an existing `down()` gets a round-trip that actually runs it, and the
  run's log names every file it exercised. A copy older than that counts added files only:
  its green says nothing about a modified migration, so re-sync it before a reviewer grant
  relies on it. Node and Python have no canonical migration runner, so their job runs the repo's own
  forward-only runner three times — fresh, re-applied, and on top of the base's migrations —
  and each schema must equal the first: a forward-only runner has no `down()` to exercise,
  and an edit to an applied migration shows up as a differing schema instead. A repo without
  that job cannot pass R — the audit warns when one declares `reviewer` anyway — and a branch
  that edits `.github/workflows/` cannot pass it either. Those branches ship on a human grant.

If any condition fails, the gate behaves exactly as it does without a reviewer grant: a
human grant, or a human running Phase B. The refusal says which condition failed
(`reviewer grant [HEAD]: …`). One function makes this decision for every ship path —
`--dry`, `--dry --json`, a real ship and the auto-trunk path — so no path can accept a
grant another refuses.

**`needs-migration-grant` is this gate's plan-time half, not a second gate (#230).**
It is provisioned in `CONVENTION_LABELS` alongside `migration-granted`, but nothing in this repo's own tooling reads it — a
downstream consumer (the fleet dashboard) applies it at plan/triage time, as soon as
it can tell an issue's deliverable IS a schema migration. It authorises nothing by itself;
only a grant minted as above does that.

Why, with the measurement: [ADR 539](../../docs/adr/539-migration-rationale.md).
