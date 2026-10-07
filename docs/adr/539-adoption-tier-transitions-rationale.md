# Going live and Tier C → Tier A: why

Moved from [`CONVENTIONS.md` §9, *Going live: Tier B → Tier C or Tier A*](../../CONVENTIONS.md#going-live-tier-b--tier-c-or-tier-a) and [*Tier C → Tier A — when the site earns a release ritual*](../../CONVENTIONS.md#tier-c--tier-a--when-the-site-earns-a-release-ritual) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why `dev` goes into every CI workflow's trigger branches

CI that still gates only `main` runs zero checks on your actual work

## Why step 1 of going live comes first

because `main` only becomes meaningful once something consumes it — what must not exist is a
`main` that nothing and nobody reads

## Why Tier C → Tier A waits until the site earns a release ritual

since an unused tag ritual decays exactly like an unused branch

## Why retriggering the deploy workflow is the whole change

until it lands, the tier claim would be false
