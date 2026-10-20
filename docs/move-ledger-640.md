# Move ledger — #640 (base `69ca671d`)

The allow ledger for `node scripts/check-doc-move.mjs --base 69ca671d --allow docs/move-ledger-640.md`.
Each entry excuses one unit of `CONVENTIONS.md` at the base that #640 rewrote on purpose: a rule
stated twice now has one home, and the other copy became a link to it. The ledger in
[`rule-inventory.md`](rule-inventory.md) is keyed to older bases, so this move keeps its own.

- `CONVENTIONS.md:135` — §2's opening restated the tier → exposure mapping that *Exposure* states
  in full (with why `B` maps to nothing). The opening keeps "`tier:` is a legacy read of it" and now
  links to *Exposure* instead of repeating the arrows. Rows: C2.frame.02 (key unchanged).
- `CONVENTIONS.md:450` — *Writes* restated what the human flag means ("set only on a human's
  explicit instruction (never inferred, never from a headless, scheduled, or driver session").
  §5 *The human flag* is that rule's home (contract item 9, with `tools/docs/grants.md`); the
  paragraph now names the flag and links there. Rows: C2x.veto.10 (re-keyed).
- `CONVENTIONS.md:728` — *The human door* restated the same meaning ("a human's instruction in the
  live session, never the agent's own reading of the situation"); it now links to §5's rule.
  Rows: C2x.human.03 (key unchanged).
