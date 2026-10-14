# Docs-only changes do not wait for CI: why ship decides, and why each guard is shaped as it is

The rule lives in [`CONVENTIONS.md` §4, *Docs-only — no CI wait*](../../CONVENTIONS.md#docs-only--no-ci-wait-606)
and its field in [`project.schema.md`, `ci-docs-skip`](../../project.schema.md#ci-docs-skip--optional). This
file holds the reasoning (#606).

## Why ship decides, not the templates

The owner's ruling (2026-10-14): documentation and design artifacts touch no code and should not run
the full CI. The first plan put that decision in the CI templates — the `ci-docs-skip` guard (#570),
turned on by default. It was dropped: every rule change would need a template release plus a sync in
every adopter, and adopters almost never declared the opt-in, so a README fix or a design mockup ran
minutes to tens of minutes of suite no test reads. `colab ship` is the one place every adopter
already runs the same code, so the handbook enforces one contract there. The templates become
guidance in a follow-up.

## Why a red branch run still refuses

"CI not required" means ship does not *wait* for a verdict. It does not mean ship may *override* one.
A run that exists and finished red is evidence about the change — a docs-reading check the repo forgot
to list, or a flaky suite — and silently merging past it would make the docs-only path a way around
every red. So no run, a pending run and a stale-base run all pass; a red one refuses.

## Why trunk is read at the newest code commit

Docs change no code, so the code trunk carries at a docs-only tip is exactly the code at the newest
commit below it that is not docs-only, and that commit's CI is the verdict on it. Without this, an
adopter that `paths-ignore`s docs in its CI (the natural way to stop docs runs) leaves every
docs-only squash with no trunk run, which ship reads as `none` — and then *every* following ship,
code or docs, waits on a run that is never coming. The door opens only on a tip with no finished
run: a tip whose run finished red stays red, because that run is a real verdict at that sha.

## Why a secret check, and why so small

A docs-only change skips the suite, and the suite is usually where the secret scan (gitleaks in the
templates) runs. Docs are exactly where people paste a config snippet with a real key in it. The
check is a backstop: generic shapes on the added lines only, seconds, no dependency, so it can run
inside ship on every machine. It reports file, line and rule, never the matched text, because the
refusal is printed to terminals and pasted onto issues, and a public repo's issues are public.

## Why the forbidden-terms file is committed, and what that costs

Ship runs on any machine, so the terms must travel with the repo: `.github/secret-scan-terms`, read at
the target's tip (a branch cannot weaken it and stay docs-only, since `.github/` is never
documentation). The cost is that the list is as public as the repo. A vocabulary of sensitive names
— hosts, customers, handles — is itself an index of what an organisation does not want found, which is
why the identity scanner takes its vocabulary by path from outside every repository
(`templates/identity-vocabulary.example`). The committed file is for terms that are safe to publish.

## Why design artifacts are documentation, and only under `docs/`

A PNG mockup under `docs/design/` is read by people, never by a build. Binaries were excluded wholesale
because a binary elsewhere is usually a build input (a fixture, an asset the app ships). Scoping the
exception to the top-level `docs/` and a closed list of image and document extensions keeps that
protection everywhere else. The same module decides the autonomy exception (#345), so it widened too:
one rule for "is this documentation", never two that drift.
