# 724 — The light CI templates call the reusable light lane; the heavy lane stays a copy

**Status:** accepted (decided while implementing #724, which asked for these choices to be made and recorded).
**Rules it explains:** `templates/README.md`, *The reusable light lane*; `CONVENTIONS.md` §7, *One verdict per tree*.

## Context

#721 shipped the reusable light lane (`.github/workflows/ci-light.yml`) and a generic caller
(`templates/ci-call.yml`). The three per-stack light templates (`ci-node.yml`, `ci-python.yml`,
`ci-laravel.yml`) were still full copies of the gate, about 2,850 lines between them. The gate is the part
that drifted: measured across adopters, it was missing in six repositories and never skipped in three, and
#717's fix reached a copy only through a manual sync.

A caller pins a handbook release tag. `colab template` and `colab update` stamp a copy with the latest
**final** release, never a candidate (#334), and on this repository the final is a human act
(`release: final: human`). So the working tree can hold a caller while the latest final does not yet
carry `ci-light.yml`.

## Decision

1. **Thin callers, not retirement.** Each light template keeps its path (a `docs/compat-surfaces.md`
   promise) and becomes `ci-call.yml`'s shape with its stack's `with:` block filled in. Retiring the
   three files in favour of `ci-call.yml` would make `colab template ci-node` write something that is not
   a Node caller. `ci-call.yml` stays as the generic caller, for hybrid repositories.
2. **The heavy lane stays a copy.** It runs nightly and on candidates, never per merge, so it is not what
   drifted. Its plan gate and its choice of heavy tests are per-repository. If heavy copies are later
   measured drifting, a second reusable workflow gets its own issue.
3. **The release window is handled in code, not by waiting.** When a rendered template is a ci-light
   caller and the release its stamp names does not carry `ci-light.yml`, `colab template` and
   `colab update --apply` write **that release's own template** (`tools/lib/template-trunk.js`,
   `templateBodyAt`). "Copied from X" and "runs at X" stay one fact. Where that release has no such template
   (`ci-call.yml` before #721), `colab template` keeps its warning and `colab update` refuses to refresh,
   giving the reason.
4. **Parity, so a conversion loses nothing the copies did.** `ci-light.yml` gained:
   - the pip and Composer package caches (#571): hosted runners only, and only with the lockfile present;
   - a `php-extensions` input;
   - the resolved toolchain versions as outputs.

   Laravel's test tier, its sqlite bootstrap and its wayfinder step moved into the caller's `full` script.
   The migration round-trip stays a caller job, behind the call's gate
   (`needs: ci`, `needs.ci.result == 'success'`, `needs.ci.outputs.tested != 'true'`). Node's and Python's
   opt-in round-trip gained a small `roundtrip-config` job, because a job-level `if:` cannot read `env` and a
   caller has no build job to hand the value on.

## Consequences

- Without decision 3, `colab update --apply` run between this merge and the next final would turn a
  pristine older full copy into a caller pinned at `v1.20.3`, which has no `ci-light.yml`. That adopter's
  CI would stop running.
- After a final that carries `ci-light.yml`, `colab update --apply` moves every pristine light copy onto the
  caller with no hand work. An edited copy stays the adopter's: the audit's `drift:` advice names the command
  that rewrites it.
- The names of the steps a light run executes are now `ci-light.yml`'s (`Quick`, `Full`, …). That is a
  deliberate change to what the cure rule compares, pinned in `tools/lib/ci-template-cache.test.js`.
- The heavy resolvers can no longer be byte-identical to the light lane's single resolver for every
  toolchain. `tools/lib/ci-template-heavy.test.js` checks the outcome instead: both resolvers run on the
  same fixture repositories and must pick the same version, or refuse the same repository.
