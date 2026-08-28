# Two tests hard-match literal strings inside `CONVENTIONS.md`/`project.schema.md`'s `writes` prose — edit that prose and they break silently unless you know to look

Two unit tests do not parse the `writes` section's *meaning*; they `indexOf`/assert
on an **exact substring** of the prose itself. A future rewording of that section —
even one that preserves every fact — can break either test with no clue in the
diff pointing back at the test file, because nothing about editing Markdown looks
like it should touch `tools/lib/`.

## What happened

While implementing #283 (the `writes: free`/`direct`/`isolated` wizard, replacing
the old `serial`/`serial-direct`/`serial-gated`/`isolated` vocabulary), both
landmines had to be updated in lockstep with the prose, or the CI gate would have
failed for a reason that reads nothing like "you changed a schema value":

1. **`tools/lib/audit-writes-matrix.test.js`'s `parseWritesMatrix()`** does an exact
   `text.indexOf(headerNeedle)` against the constraint-matrix table header in
   `CONVENTIONS.md`'s "Writes" section, and throws a self-describing error if the
   header moved. It also asserts the table has exactly 2 value columns via a
   pipe-cell count — so a "helpful" third column (e.g. splitting `free` and
   `direct` into separate columns instead of listing both in one cell) breaks the
   parser's structural assumption, not just the string match.
2. **`tools/lib/stamp.js`'s `WRITES_VETO_MARKER = 'two-state VETO'`** is read out
   of `project.schema.md` at a git ref — it is how the audit's sync-announce path
   (`writesSyncAdvisory`) knows a repo's stamped handbook version already knows
   about the ⚖ #233/#237 ruling. `tools/lib/audit-writes-sync-announce.test.js`
   asserts that literal phrase exists at HEAD. Rewording the schema's `writes`
   section to say the same thing in different words (e.g. "binary veto" instead
   of "two-state VETO") silently breaks this without touching any code file.

## Why this matters beyond this one fix

Whenever a doc file is *also* a data source a test parses — not just prose a human
reads — treat it as an API with a stable contract, not free-form text. Before
editing `CONVENTIONS.md`'s "Writes" section or `project.schema.md`'s `writes` row
again: `grep -rn "indexOf\|WRITES_VETO_MARKER\|headerNeedle" tools/lib/*.test.js
tools/lib/stamp.js` first, and re-run `node --test tools/lib/*.test.js` before
trusting a "just wording" doc change is safe. The same caution generalises to any
other CONVENTIONS.md section with a same-shaped "sync marker" or "matrix parser" —
grep for the section's own distinctive phrases across `tools/lib/` before assuming
prose-only edits are free.
