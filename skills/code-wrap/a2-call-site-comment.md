# code-wrap · A2 A comment at the call site

Reference for [`code-wrap`](SKILL.md) A2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### Or: a comment at the call site — when `docs/` is the expensive answer

The four destinations above all cost something to read *later* — a doc is cold
storage, opened on demand. A comment costs something to read *now* — it is a tax
paid by everyone who opens that source file, forever, whether or not they care.
Both costs are real, so A2 is not "always docs/": ask two questions, in order,
before picking a destination for a piece of knowledge this session surfaced.

1. **Will whoever needs this be looking at this exact line when they need it?**
   Yes → a comment. No — they will be searching a symptom, or deciding before they
   ever open this file — → `docs/`.
2. **Does the knowledge outlive the code it sits next to?** A note on why a loop
   isn't a map dies with the loop → a comment. A vendor/API quirk, or an incident
   and how it presented, survives any refactor of the line it currently sits on →
   `docs/gotchas.d/`.

Shorthand: **the invariant goes in the comment; the incident goes in the doc.**

When both are warranted — the reader at the call site needs the warning, and the
knowledge is also worth finding by search — the comment is a **pointer, not a
copy**: `// see docs/gotchas.d/<issue>-<slug>.md`, never the incident retold
in-line. Same anti-duplication rule as `CLAUDE.md`'s pointer-not-copy rule below,
for the same reason: whichever copy rots first, the other keeps being read.

This lane does not relax the naming/keying rules for gotchas and ADRs below — it
only says some knowledge never belonged in either, because its whole audience is
the person already reading that line.
