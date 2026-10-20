# `tools/docs/` — how the `colab` CLI enforces the conventions

[`CONVENTIONS.md`](../../CONVENTIONS.md) states what must be true, in words that name no tool.
This directory holds how **this** repo's CLI makes it true today: which runs it reads, what it
refuses and when, the doors through a refusal, and the measurements behind each threshold. An
adopter with its own tooling follows `CONVENTIONS.md` and may ignore this directory entirely.

| File | Mechanics of | The rule it serves |
|---|---|---|
| [`ci-gate.md`](ci-gate.md) | trunk CI by commit, a branch's own run, the docs-only skip, batch landing | [§7, the CI contract](../../CONVENTIONS.md#what-ship-reads--the-ci-contract-607), invariants 2–3 |
| [`red-trunk.md`](red-trunk.md) | who opens a red trunk's patch; the grant and cure doors | [§7, the CI contract](../../CONVENTIONS.md#what-ship-reads--the-ci-contract-607), invariant 1 |
| [`ci-lanes.md`](ci-lanes.md) | what ship reads, the two lanes, integration profiles, the artifact store, self-hosted runners | [§7, the CI contract](../../CONVENTIONS.md#what-ship-reads--the-ci-contract-607), invariant 4 |

## How a section moves here (#635, the pattern #636–#640 follow)

1. **Text moves now; code moves only after its replacement ships.** A section moves verbatim —
   only its links are retargeted — and the CLI keeps doing what it describes.
2. **The heading stays in `CONVENTIONS.md` as a stub**: the rule in one line plus a link here, so
   every anchor an adopter links to keeps resolving ([`docs/compat-surfaces.md`](../../docs/compat-surfaces.md)).
3. **Every rule keeps its inventory id**; only its `dest` changes to the file here
   ([`docs/rule-inventory.md`](../../docs/rule-inventory.md)). A hard rule here keeps the marker
   that names its gate, `**[Hard — gate: …]**` — naming the tool is right where the tool is
   documented. The rule left in `CONVENTIONS.md` uses the tool-free form,
   `**[Hard <id> — refuse: …]**`.
4. **`scripts/check-doc-move.mjs --into …,tools/docs` proves nothing was dropped**, and its
   result is recorded in the inventory's *Move check*.
