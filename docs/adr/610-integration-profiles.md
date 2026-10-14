# 610 — Integration profiles: a repo declares where its heavy lane runs

**Status:** accepted (owner ruling, 2026-10-14, on #610).
**Rules it explains:** `CONVENTIONS.md` §7, *Integration profiles*; `project.schema.md`,
`integration-profile` / `heavy-workflow`.

## Context

#607 gave every adopter one CI shape: a light lane on every merge (what `colab ship` reads) and a
heavy lane nightly and at every official build. The owner then ruled that this is one standard
among several, chosen per repo: "some other repo might not accept it and require the dev branch to
be always green too. So propose multiple standards and let the repo choose."

## Decision

1. A new optional key, `integration-profile:` — `gated` · `qualify` · `release-heavy` · `promote`.
   Absent reads `release-heavy`, #607's shape, so no repo that never declares changes behaviour.
2. The key is **not** `integration:`. That name was already the list of long-lived integration lines
   (`project.schema.md`, `integration`), validated by the audit. `ci-profile` was rejected too: it is
   already a command and a module (`colab ci-profile`, the measured CI duration, #559).
3. The heavy lane is named by **file** (`heavy-workflow:`, default `ci-heavy.yml`). A dispatch takes a
   file, and #607's templates already dispatch by file. Run rows carry the workflow's `name:`, so the
   readers read the file at the sha to learn which runs are heavy.
4. What reads it:
   - **`colab ship`** changes only under `gated`. A code landing needs a green heavy run at the
     candidate's exact sha (the branch's remote head, or the batch head). A missing run is dispatched
     by a real ship, which then pauses (exit 3). A red refuses. Docs-only landings are exempt: they do
     not wait on CI at all (#606). In a batch the heavy verdict joins the combined one, so a heavy red
     goes through the same re-run / split machinery and the split walks toward the culprit.
   - **`colab release finalize`**, and **`colab release cut`** on the two routes that tag a final
     directly, gain a `heavy-lane` condition under every profile.
   - **`colab promote`** under `promote` requires the heavy lane green at the promoted trunk tip.
   - **The audit** fails a bad value, and a *declared* `qualify`/`release-heavy` on `exposure: live`
     without `deploy: tag`.

## Why this shape

- **Only `gated` changes ship, because only `gated` promises a heavy-green trunk before it moves.**
  `qualify` and `release-heavy` both let the heavy lane run after landing; for them ship reads the
  light lane exactly as before, and the heavy schedule is the adopter's workflow (copy-and-own, #607).
  `qualify`'s clock is the heavy workflow's cron, not a field: a "every N landings" counter would need
  state the handbook does not keep.
- **Ship dispatches the heavy run itself under `gated`.** The alternative — require adopters to wire
  the heavy lane on `push` to session branches — would make every branch push heavy, which the ruling
  rejected ("session-branch CI: light"). A dispatch at ship time runs heavy once per landing, at the
  sha that will land.
- **"A final needs the heavy lane green" applies where a heavy lane exists.** Refusing every final
  of a repo that never wrote one would break every adopter on the day this shipped; #607's release
  templates already read "no heavy lane here → no gate". A heavy run still to run or still running
  keeps the candidate in `testing`, not `refused`: it clears on its own.
- **The `live` restriction fails only a declared value.** An absent key reads `release-heavy` for the
  gates, but a repo that never declared must not start failing its audit because a new key appeared;
  it gets a suggestion instead.
- **`release-heavy` is the higher-risk choice.** No public evidence was found for "heavy only at
  release" as the only heavy run. A red found late implicates the whole release range, and its
  authors are usually gone — which is why its nightly is required, not optional.
- **`promote` is kept, not offered.** It describes repos that already run `dev → main` for an
  approval gate. A merge queue on trunk, or a `release/x.y` branch cut from trunk, gives the same gate
  without a second long-lived branch.
- **Revert first** is the norm in large trunk-based shops: stop the bleeding, then fix. A naive
  automatic revert reverts innocent changes at a measurable rate, so an automatic revert needs an
  isolated re-run that proved the culprit, and a failure is retried once before it is called red.
  The handbook documents the norm; it ships no bisect or revert automation in this change.
- **Batch size 4–6.** A larger wave lowers full runs per landed branch even at a 10% per-branch
  failure rate, so the cap is about latency and blast radius, not runner cost. Tune it from two
  measured numbers: the per-branch wave failure rate and the flake rate.

## Alternatives rejected

- **One stricter default for everyone.** The ruling was explicit: several standards, the repo chooses.
- **A `heavy:` block inside `gate:`.** `gate:` is the local/CI verdict for the implementer's quality
  gate; mixing the landing contract into it would make one key answer two questions.

## Consequences

- A repo can now promise "trunk is always heavy-green" and have `colab ship` hold it to that.
- `gated` costs one heavy run per landing (per wave under `--batch`); `ship-batch` is how a repo
  amortises it.
- Every release route now reads the heavy lane at the sha it finalizes, in the CLI as well as in the
  release templates.
