# `.colab/dev-setup` — why the make-ready recipe sits beside the code, and what the pilot changed

Rule: [`CONVENTIONS.md` §3, *Boot recipe*](../../CONVENTIONS.md#boot-recipe--an-entry-point-the-repo-owns-not-a-table-a-consumer-keeps).
Templates: [`templates/README.md`, *dev-setup*](../../templates/README.md#dev-setup--a-checkout-made-ready-764).

## Context

`.colab/dev` said how a trunk dev server **starts**. Nothing said how a fresh checkout is **made
ready** to start, or brought up to date after trunk moves: install dependencies, write a dev
`.env`, migrate and seed a dev database, build assets. Each consumer guessed per stack or kept a
per-repo sync script, and the copies drifted. Measured on two Laravel repos on one shared dev
machine: one carried its own sync script, the other had a copy placed outside the repo by hand,
and bringing the second up took about 30 minutes of manual steps.

## Decision

A second conventional entry point, `.colab/dev-setup`, beside `.colab/dev`, with the same
reasoning ADR 539 gives for `.colab/dev`: the recipe changes with the code (a new service, a new
build step, a seeder), so it lives in the repo and moves in the same commit. A `project.yml`
field would be a second copy of facts the code already holds, and it could not run anything.

The contract was not written from first principles. The owner ruled (2026-11-21) that it be
proven first on four real repos of different shapes, each from a fresh throwaway clone with no
hand step between `git clone` and a page answering. The pilot table is on issue #764. What it
changed:

- **The port list.** One `PORT` cannot place a database container or a second app. The caller
  also passes `COLAB_PORTS`, the name worktree hooks already use. Two of the four apps already
  read it **in preference to** `PORT`, so a caller that set `PORT` alone could have been
  overridden by an inherited value without a word.
- **Writes stay inside the checkout.** One repo's existing install kit asked a question on stdin,
  wrote under the home directory and set git config. That is an install, not a make-ready step,
  and a caller running it unattended would hang or change the machine.
- **A seed fails the setup, and "seeded" is recorded only after success.** From zero, the Laravel
  repo's seeder failed (a NOT NULL column added after the long-lived dev database was seeded).
  That rot was invisible to everyone working against the old database. The half-failed seed left
  a row behind, so a "table is empty" test would have skipped seeding for good. The marker is
  keyed to the database instance, so a recreated container is seeded again.
- **`.colab/dev` never fetches.** One pair's supervisor was not in the lockfile and was
  downloaded at server start. A start must not depend on the network.
- **Host acceptance differs per framework**, and only Next needs an edit: Vite accepts an env var,
  Laravel follows `APP_URL`, uvicorn trusts forwarded headers. From an unlisted name, Next serves
  the page but refuses the HMR websocket, so live reload dies with nothing on screen.

Template testing found one more trap, kept as a comment in the Laravel template: on first start,
the MariaDB image runs a temporary server with networking off. A readiness probe over the socket
passes while the app's TCP connection is still refused. Probe over TCP.

## Consequences

- A consumer (a dashboard's Dev button, an always-on trunk server) runs `dev-setup` after every
  trunk move and `dev` once. It needs no per-repo knowledge beyond `ports:`.
- Warm re-runs measured 0–8 s across the four shapes, so "after every trunk move" is affordable.
  Re-running under a live server never disturbed it.
- A service container outlives its checkout unless someone removes it. The label makes that one
  command; nothing does it automatically yet.
- "Never needs real credentials" is the promise, not "never reads them": one server reads a
  machine credential when present. That stays the repo's choice.
