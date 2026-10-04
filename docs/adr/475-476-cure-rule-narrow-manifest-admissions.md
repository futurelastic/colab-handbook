# The cure rule admits an add-only scripts change and a pin-only requirements change

## Context

Conditions 5 (#297) and 6 (#377) refuse any change to the files a CI template
reads to decide which checks run: a `package.json` `scripts` block, and the
Python dependency manifests. Both refusals are right in the direction they
defend. A branch that deletes `scripts.test`, or drops `pytest` from
`requirements-dev.txt`, makes a step skip while the job still concludes
`success`.

Both refusals also block the commonest real fixes for a red trunk:

- A trunk went red because the CI `Build` job ran `npm run build` against a root
  `package.json` with no `build` script. The correct fix adds the script. It
  could only land through a human grant. The fix that did land edited the
  workflow to skip Build, which the cure rule refused too, as it should.
- An upstream release breaks the build. The fix is a version pin, and condition
  6 named that as an accepted false refusal.

## Decision

`tools/lib/cure-diff.js` keeps both signals whole: any change still sets
`manifestScriptsTouched` / `pythonManifestTouched`. Next to each sits a
classifier that is a list when every touched manifest has one admissible shape,
and `null` otherwise:

- `manifestScriptsAddOnly` (#475): both sides present, every base script kept
  with an identical command, only keys added, no added key an npm lifecycle hook.
- `pythonPinOnly` (#476): both sides present, and the files match line for line
  once each requirement is reduced to its identity (normalised name, extras,
  marker). Only the specifier, and `--hash`, may differ. Requirements files are
  read line-wise. A `pyproject.toml` is read only inside the dependency arrays
  pip installs from, and every other byte must match. `setup.py` is code and
  `setup.cfg` is not parsed, so neither is ever pin-only.

`cureVerdict` admits a classified change on **step evidence**: every step that
ran in each red job on trunk, the failing one included, ran on the branch and
concluded `success`. This is the carve-out's 4b, without 4c's duration floor. 4c
exists because a workflow edit can gut a `run:` body, and no workflow changed
here.

Check-runs name steps, not commands, so "the step that runs the added script"
cannot be measured as such. "The step trunk failed in now passes" can, and that
is the claim a cure makes.

### Lifecycle hooks are excluded from add-only

`postinstall`, `prepare`, and `pre<x>`/`post<x>` for a script `<x>` (or for an
npm built-in such as `test`) run inside steps that already exist. They can
rewrite what such a step measures without changing any step name. For example, a
`postinstall` can replace a test binary with a no-op. A name that only starts
with `pre`, such as `prettier`, is not a hook and is admitted.

### The open question on #476: a pin can drop a transitive tool

It can. The Python template then skips that tool's step, and the job still
concludes `success`. The step proof already covers every step up to trunk's
failure point. Steps after it were skipped on trunk, so trunk says nothing
about them. The pin admission therefore adds one test: **no step after the last
step that ran on trunk may be `skipped` on the branch.**

Its false refusal is a repo that never had a tool whose step sits after the
failure, for example no mypy and a red in Lint. That refusal falls through to the
ci-grant, the safe direction. Rejected alternatives:

- Comparing against trunk's last green run. It is not in the evidence the gate
  reads today, and it would add a `gh` read for every cure attempt.
- Reading the install log. That means parsing free text, which fails open.

The add-only admission does not need the test, because adding a script cannot
remove one.

## Consequences

- Both measured fixes now cure without `COLAB_HUMAN`. The trailer says so
  (` admitted add-only-scripts` / `pin-only-requirements`), and so does the
  `--dry --json` payload (`ciCure.admitted`). Anti-stacking allows one exemption
  per red episode, so a later reader can tell which door was used.
- The classifiers fail closed. An unreadable, unparsable or absent side gives
  `null`, so the condition refuses exactly as before.
- Not admitted, deliberately: Poetry `[tool.poetry.dependencies]` tables (the
  template's `pip install -e .` reads them only through a Poetry backend),
  reordered requirements, and a requirement swapped for another that provides
  the same tool. Each one would loosen the rule without a measured case behind it.
