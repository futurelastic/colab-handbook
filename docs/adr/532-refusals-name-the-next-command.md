# Every refusal names the next command, and a test holds the line (#532)

## Context

A clean-machine run of the whole adoption loop (2026-10-06) hit four refusals that stopped the
user with no way forward: `colab adopt` refusing `exposure: none` on a `master` repo after six
questions, `colab ship` on `autonomy: manual` saying only that a human must trigger Phase B, the
topic step's bare `HTTP 404`, and `colab claim` on trunk asking for a `--session` a person at a
terminal does not have. Several came at the end of a long interaction, after the user had already
put time in. Each was fixed under its own issue (#522, #525, #528), but nothing stopped the next
refusal from being written the same way: the CLI held about 330 refusal sites, and about 200 of
them named no next step.

## Decision

- **The rule is short and hard** (CONVENTIONS.md §8): a refusal ends with the exact next command,
  or says no command can and who decides. A wait counts only when it names what it waits for.
- **The gate is textual, on purpose.** `tools/lib/refusal-sites.js` finds every site, meaning every
  `throw new UserError(…)` plus every print or stderr write whose literal starts with `✗`. It then
  looks for a remedy in the site's own text: in the UserError's argument, or in the `✗` write's block
  up to its `return`, since a refusal usually prints its remedy on the next line. A remedy is a
  command (`colab …`, `gh …`, `git …`, `COLAB_HUMAN=1`), a flag to pass, the valid values or
  `--help`, a no-command or who-decides statement, a named wait, or a remedy helper. The check
  cannot judge whether the named command is *right*. That stays with review. What it can do is
  stop a refusal with no way forward from shipping.
- **Relays are not sites.** `✗ ${e.message}` and `new UserError(syncProblem)` print text built
  somewhere else, and the scan does not follow it there. That is a known blind spot. Making it
  smaller means moving such text into a site the scan can read, not making the scanner smarter.
- **Ratchet, not rewrite.** The issue asked for a list first and no single change that rewrites
  every refusal. `refusal-sites.known.json` holds the key of every remedy-less site found when the
  rule landed. The test fails both ways: on a new site that is not on the list, and on a listed key
  that no longer matches a site. So a fix must delete its key, and the list can only shrink.
  Keys are `<file>:<kind>:<message head>[#k]`, never line numbers, so that an unrelated edit in a
  15k-line file does not churn the list.
- **The four measured refusals are asserted by name** in the test, so a rewording cannot quietly
  bring one of them back. This change fixes the last open one: adopt's final "no valid answer"
  refusal now names `colab adopt --axis <row>` and the matching flag.
- **The interactive bullet was already met.** Since #522, adopt's exposure question runs the repo-shape
  check at answer time, and every menu re-asks an invalid answer once.

## Consequences

- The test runs on every smoke run (`scripts/smoke.sh`, outside the changed-tests loop) and in CI's
  full suite.
- A contributor who adds a refusal gets a failure that names the file, line and message, and says not to
  add it to the known list.
- The scanner is dev-only and stays out of the npm package (`package.json` `files`).
