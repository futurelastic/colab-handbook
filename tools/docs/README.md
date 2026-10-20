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
| [`contention.md`](contention.md) | solo flow (trunk-direct on a shared checkout) and the place-claim lock | [§2, *Contention*](../../CONVENTIONS.md#contention--what-may-run-at-once-636), rule 4 |
| [`releases.md`](releases.md) | cutting and finalizing candidates, the release workflow, operator grants, deploy-tag-fast, container deploys, version-source, npm, channels, the release summary | [§6, the release contract](../../CONVENTIONS.md#6-releases) |
| [`distribution.md`](distribution.md) | install routes, dist refs, services over npx | [§6, *Distribution* and *Services over npx*](../../CONVENTIONS.md#distribution--one-install-surface-npx-442) |
| [`branches.md`](branches.md) | the `Machine:` trailer, the squash-subject picker, the issue-close gates and the doors through them, the landed check's CI advisory | [§4, the landing contract](../../CONVENTIONS.md#4-branches-and-commits) |
| [`claims.md`](claims.md) | the claim ref and its refusals, the tracker mirror and half-claims, the local cache, the claim comments and marker family, tracking issues | [§5, the claims and decisions contract](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this), items 1–2 |
| [`readiness.md`](readiness.md) | writing and reading the dependency graph, the checked and graph-empty markers, the `wake:` vocabulary, the `shape:` field, the disposition marker and who may apply it | [§5, the claims and decisions contract](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this), items 3–6 |
| [`decisions.md`](decisions.md) | recording and reopening a ruling, both labels at once, the options block, the `Mockup:` line, an ask said once, the decision box | [§5, the claims and decisions contract](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this), items 7–8 |
| [`grants.md`](grants.md) | the human flag, the migration grant's roles, `trust-humans` and the reviewer conditions | [§5, the claims and decisions contract](../../CONVENTIONS.md#5-claiming-work--how-to-say-im-on-this), item 9 |

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
