# The record of a claim is its branch on the git remote

Covers the group `claims-across-machines`: #325 (the remote as the lock), #326
(planner claims), #327 (canonical machine id). They shipped on one branch
because all three rewrite the same claim path. Every "same machine?" question
#325 and #326 ask is only answerable once #327 has made hosts comparable.

## Context

Measured on a three-machine fleet on 2026-09-11. One issue's branch was checked
out as a worktree on **two machines at the same commit**, and each machine's
`~/.colab/state.json` named itself as the holder. Nothing refused the second
claim:

- `ghClaimConflicts` refused only a *different* assignee. A second machine
  signed in to the same account passed. It could only lose a tie-break on
  comment order, after both machines had already claimed.
- When `gh` was unusable, the refusal degraded to "LOCAL-ONLY". On a
  multi-machine fleet that silently drops the only lock a claim has.
- The first push happened at `code-wrap`, hours after the claim. `code-triage`
  itself names "an unpushed branch on another machine" as its blind spot.
- Hosts were compared as raw `os.hostname()` strings. One machine writes its
  hostname in more than one form (FQDN vs `.local`), and can change form when
  its resolver changes.

The operator ruled two things. The tracker may change. And claims must be
**refused** across machines, not tie-broken after the fact.

## Decision

- **The branch on the remote is the claim record.** Its name carries the issue
  number (§4). `colab worktree new` pushes it at cut, using
  `--force-with-lease=refs/heads/<b>:`, which only ever creates the ref: two
  machines cutting the same name race on a real compare-and-swap. A failed push
  with `--issues` removes the worktree and branch again, so nothing is left
  half-created.
- **The refusal reads `git ls-remote --heads`** (the remote itself, no fetch).
  A head that carries `#N` and that no record in *this machine's* state names is
  another machine's claim. Local state is the discriminator because it is
  machine-local by construction and is written by the invocation that pushes.
  Upstream tracking cannot tell the machines apart: a clone that adopts the
  branch tracks it too. The claim comment cannot either: it needs the tracker.
- **Fail closed on the remote, not on the tracker.** A remote that exists but
  cannot be read means no claim, and `--force` cannot override that. A repo with
  no remote at all keeps local-only claims, because nothing else could share its
  branches. When the tracker is unreachable, the claim stands with
  `trackerPending`, and re-running the same claim posts what was missed.
- **The tracker pair (assignee + `in-progress`) becomes the mirror for people.**
  The #323 half-claim rule governs it unchanged.
- **One account on two machines counts as two holders.** A live claim comment
  from the same login on a different machine refuses too. This check is always
  on, not gated on `claimIdentity`.
- **Hosts compare by canonical machine id (#327).** Records store the raw
  `machine.js` id. Comments carry only `m:` + 12 hex characters of its sha256,
  because the raw id is a hardware serial and on a public repo the comment is
  published. Records without an id fall back to `canonHost`, with no migration.
- **Planner claims (#326)** use `--session intent:<id>`. They take no worktree,
  no checkout place-claim, and require `gh`. A claim from the spawned session on
  the same machine upgrades the record in place and re-posts nothing.

## Two calls made in-session

The planning pass flagged both as open. Both are recorded here for the grader
to confirm or reverse.

1. **Digest, not the raw id, in the comment.** #327's text asks for "the same
   id the fleet session daemon reports". That id stays in local state. Only its
   public form goes into the comment, and a consumer holding the raw id gets
   the token with the same one-line hash.
2. **Pruning an orphaned planner claim on the tracker needs
   `doctor --prune --sync`, not `--prune` alone.** #326's acceptance wording
   says `--prune`. Doctor, however, touches the tracker only under `--sync`,
   and deleting only the local record would strand the one half other machines
   see. So plain `--prune` reports the claim and keeps it. The window is the
   config key `plannerClaimTTLMinutes`, default 30.

## Alternatives rejected

- **Keep the tracker as the lock and make the tie-break stricter.** This still
  refuses nothing: both machines have already started by the time the verdict
  lands. It also ties the fleet to one tracker.
- **A generated machine id under `~/.colab`.** It inherits the sync hazard that
  place-claims guard against: a synced home would give two machines the same
  id (`machine.js` header).
- **Deciding "this machine's branch" from upstream tracking or the claim
  comment.** Rejected above.

## Consequences

- **Stricter by design.** The same person on two machines is refused until they
  release or use `--force`. A remote branch for an open issue, kept after its
  worktree was removed, refuses a new claim on the same machine too. That is
  code-start's "continue it" rule, now enforced.
- **Residual window.** Two machines could cut *different* branch names for the
  same `#N` between each other's `ls-remote` and push. When the tracker is up,
  the tie-break still covers it.
- **Grandfathered branch names** with no trailing number are invisible to the
  remote check.
- **#301 is not solved here.** `git.claimRemote()` is the single swap point for
  the claim path. Every other hardcoded `origin` in the CLI, including the
  fetch in `worktree new`, is left for #301.
- **Planner-release race.** `doctor --prune --sync` could release the tracker
  half of a planner claim whose session claims during the same run. That needs
  a spawn slower than the TTL. Accepted at a 30-minute default.
