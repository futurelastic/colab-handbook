# 607 — CI templates are guidance; two lanes, light and heavy

**Status:** accepted (owner rulings, 2026-10-14, on #607).
**Rules it explains:** `CONVENTIONS.md` §7, *What ship reads — the CI contract* and *Two lanes*.

## Decision

1. The CI templates are guidance. The handbook enforces only what `colab ship` reads from an
   adopter's CI: a run on every push to trunk, a branch-push run where `gate: authoritative: ci`,
   a `ship-batch/**` trigger where `ship-batch` > 1, and a `Migration round-trip…` job where
   `migration-grant: reviewer`. Every other difference from a `ci-*` template — stamp drift, an
   unknown, newer or unverifiable stamp, an unstamped copy — is an informational suggestion
   (`suggestions` in the audit's JSON, `▸` in its text). It never changes `ok`/`clean`, and
   `colab update` never exits 1 on it.
2. The docs-only shell guard (#570) left the templates. `colab ship` decides docs-only from the
   diff (#606). A trunk tip that is docs-only with no run is read at its newest code commit, and
   that is what makes an optional `paths-ignore` for docs safe.
3. Each stack's CI is two files:
   - `ci-<stack>.yml` → `ci.yml`, the light lane, runs on every push.
   - `ci-<stack>-heavy.yml` → `ci-heavy.yml`, the heavy lane, runs on `schedule`,
     `workflow_dispatch` and `workflow_call`, never on push.
4. An official build gates on the heavy lane:
   - `release-tag.yml` calls it and publishes only on green.
   - `release-auto.yml` dispatches it at every new candidate, and finalizes only when that
     workflow has a green run at the candidate's exact sha.

## Why this shape

- **Enforcement by copy contradicted copy-and-own.** Before this change:
  - the docs-only rule lived twice, once in JS and once in shell, pinned together by a test;
  - every rule change needed a template release plus a sync in every adopter;
  - any byte of CI drift was a hard fail, the one category neither `ceremony: light` nor
    `Rule-Neutral` could soften.
- **The ship contract is what matters at merge time.** The four checks that stay are the only
  places where an adopter's CI shape changes what `colab ship` does.
- **The heavy lane has no push trigger,** so `tools/lib/verify-runs.js` always sets its runs
  aside: a red nightly can never block a merge. A push-triggered heavy workflow would also be
  rescued as a verifying dispatch (#567).
- **release-auto dispatches the heavy lane rather than calling it.** A `workflow_call` runs
  inside the caller's run, which the CLI ignores as its own (#425). The heavy verdict would then
  be invisible at the candidate's sha. The finalize also runs days after the cut, in another run.
  - `release-tag` does call it: publishing happens in the same run, so a `needs:` is enough.
- **The nightly's "has trunk moved" reads the job name `Full suite @ <sha>`** of the last
  successful scheduled run. A scheduled run's `head_sha` is the default branch's tip, which is
  not trunk on a `dev`-trunk repo. Commit statuses would have added a writer on trunk commits
  that ship's check-run readers then see.
  - The `plan` job is the one that concludes `success` on a skip; a run whose jobs all skip
    reads as not-green.
- **Lane membership is the adopter's marker, defaulting to light.** Nothing silently stops
  running per merge until someone decides a test is heavy.
- **Migration round-trip jobs stay in the light lane.** `migration-grant: reviewer` reads that
  job by name at ship time, so it is part of the contract.

## Rejected

- **A `ci:` field or lane declaration in `project.yml`.** The lanes are workflow files the
  adopter owns, and there is nothing for the tooling to read.
- **Keeping CI drift as a warn.** The ruling's "done when" asks for no fail and no warn while
  the ship contract holds.
- **Gating the final inside `colab release finalize`.** Its `full-suite` condition already
  refuses on a red run at the sha. A required heavy workflow would be a new CLI contract for
  every route, while a step in the adopter's own `release-auto.yml` copy is guidance like the
  rest.

## Consequences

- A defect the light lane misses can sit on trunk for up to a day. A repo with a merge queue
  and spare runners may add a full run per batch as a third trigger.
- A heavy-lane red inside a `release-tag.yml` run is a red run of a push-triggered workflow at
  the tag's commit. Where that commit is trunk's head, ship sees it, exactly as it already saw
  a failed publish there.
- `deploy-tag-fast` / `library-fast` routes cut a final with no test period, so no heavy gate
  applies to them.
