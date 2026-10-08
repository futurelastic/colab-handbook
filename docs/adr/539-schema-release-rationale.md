# `release`: why, with the measurements

Moved from [`project.schema.md`, *`release`*](../../project.schema.md#release--optional) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a declared `route` never widens

`public-tool` on a `deploy: tag` repo would hand a production deploy's final to a machine,
and `deploy-tag` on a repo where nothing deploys describes a repo that does not exist

## Why `candidates-per-day` has no default cap (#443)

the newest candidate always names trunk's head, and a cap of one kept four merges out of any
tag for a day

## Why `npm-gate` is not optional

a publish with no gate is the stray-local-file leak the gate exists to stop

## Why the `version-source` default follows the route (#484)

Why: the release workflow never pushes to trunk, so on an automatic route nobody is there to
bump a manifest before each cut — under a `manifest` default the first candidate after a
final refuses at `manifest-version`, and so does every one after it.

## How the handbook's own release steps stamp the version

The handbook's own release steps already stamp: the npm publish (`release.npm`) sets the
package version from the tag on the tag's checkout before publishing, and the container
deploy receives the version from the tag.

## Why `deploy-tag-fast` also requires the grant

The audit can check that the URL and the wiring are there; it cannot prove the rollback
works, which is why the grant is required too.
