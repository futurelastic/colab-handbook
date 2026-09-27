# The cure rule treats Python dependency manifests as instrument, whole-file

## Context

#297 added condition 5 to the cure rule: a branch may not change the `scripts`
block of any `package.json` and then present its own green run as proof, because
the Node CI template skips each check whose script is absent and the job still
concludes `success`. The ADR for #297 named the same hole in the Python template
as out of scope.

The Python template's "Detect optional tooling" step works differently. It does
not ask a manifest whether a check exists. It asks the installed environment:
`python -m pytest --version`, and the same for ruff and mypy. A tool that is not
installed has its step skipped, and the job still concludes `success`. What is
installed comes from the files the template installs from:

- `pip install -e .` when `pyproject.toml` exists. The build backend may also read
  `setup.py` and `setup.cfg`;
- otherwise `pip install -r requirements.txt`;
- then `pip install -r requirements-dev.txt` when it exists.

So a branch that drops `pytest` from `requirements-dev.txt` while trunk is red
passed containment, evidence, 2b (the red job exists and passes, because the skip
happens inside it), condition 4 and condition 5. The Laravel template fails closed
and is not affected.

## Decision

**Condition 6**, a new signal (`pythonManifestTouched` / `pythonManifestPaths` in
`tools/lib/cure-diff.js`) and a new block in `cureVerdict` with no carve-out,
checked after 5 and before the workflow block. The verdict order is now
containment → 2a → 2b → anti-stacking → diff measurable → 5 → 6 → 4.

The instrument set is decided by what the template reads, at any depth:

- basename `pyproject.toml`, `setup.py`, `setup.cfg`;
- a `.txt`/`.in` whose basename contains `requirements`, or that sits under a
  `requirements/` directory;
- any file one of those pulls in: a `-r`/`--requirement`/`-c`/`--constraint`
  include (resolved against the including file's directory, as pip does), or a
  `file =` under `[tool.setuptools.dynamic]` in a pyproject. The include closure
  is read from **both** trees, merge-base and branch head, so editing an included
  file counts when the includer is unchanged, and deleting an include together
  with its target counts too. The trees are read only when the diff changes a
  file that is not already a manifest by name.

**Whole-file, not a block.** Any content change counts, a version pin included.
A failed tree or blob read is `null`, which refuses.

## Alternatives rejected

- **Refuse only when a requirement name disappears (the analogue of "the scripts
  block changed").** In Node, the scripts block is a switch separate from the
  dependencies. In Python the dependency list is the switch, and it is transitive:
  pytest can arrive through `pytest-cov` or `pytest-django`, so a version change
  on a kept name can still drop it. That is not measurable at this gate, and the
  rule fails closed on what it cannot measure. The narrowing is left unwritten in
  the same spirit as #321's `timed_out` relaxation: add it only once the false
  refusal it removes has been observed and counted.
- **Parse `pyproject.toml` and compare only the dependency tables.** The tool has
  no dependencies and no TOML parser, a hand-rolled one would fail open on the
  syntax it missed, and the file also holds the pytest/ruff/mypy configuration the
  tools read.
- **Only the two filenames the template names.** `requirements-dev.txt` routinely
  includes `requirements/test.txt` or similar. Following includes is measurable,
  so it is measured.
- **Fold it into condition 5, or into `workflowsTouched`.** The same reasons as
  #297: the #321 carve-out's evidence cannot see a skip inside an unchanged job,
  and separate signals keep each refusal specific about what the branch touched.

## Consequences

- **Accepted false refusal:** a genuine cure that pins a broken upstream release
  in a Python manifest refuses and falls through to the human ci-grant, the safe
  direction. So does any unrelated nested Python manifest change during a red
  trunk.
- **Not covered:** lockfiles (`poetry.lock`, `uv.lock`, `Pipfile.lock`), because
  the template does not install from them. An adopter whose copied template does
  owns that edit, and the template now says so at the edit point.
- **Cost:** on the red-trunk path only, a diff touching a non-manifest file pays
  one `merge-base`, two `ls-tree` and one `cat-file` per Python manifest per side.
  A green-trunk ship pays nothing.

Builds on
[`297-cure-rule-instrument-manifest-and-named-check-evidence.md`](297-cure-rule-instrument-manifest-and-named-check-evidence.md).
