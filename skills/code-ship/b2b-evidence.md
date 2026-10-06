# code-ship · B2b Evidence on every issue, and the grade marker

Reference for [`code-ship`](SKILL.md) B2b. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

## B2b. Post evidence on EVERY issue — including the auto-closed ones

**`ceremony: light` repo? Skip this whole step.** The squash's `Closes #N` is the
record; there is no evidence comment to post (project.schema.md#ceremony--optional).
Everything below applies only on `standard` (the default — absent `ceremony:` key).

`Closes #N` closes the issue the instant trunk is pushed: silently, with nothing
attached. So the best-evidenced rule in the handbook is exactly the one that skips
the evidence step — the issue goes green and no one ever records *what* shipped.

**Comment evidence on every issue the branch carried, whether it auto-closed or you
closed it by hand.** This runs **after** the merge, because the sha you cite must be
the **trunk squash sha** — the branch sha is gone once the branch is deleted (a
squash leaves no merge relation, which is why deleting the branch needs
`git branch -D`, not `-d`).

Evidence is three parts: **the `<base>` squash sha · `file:line` · what you checked and
what came back.** After a cannot-arrive merge, what came back includes B2a's trunk run at
that sha — green by id, the `TRUNK RED:` issue, or "still running at `<ts>`". A member that
landed in a batch (#373) cites **its own** squash commit, not the batch head — `colab ship
--batch` already wrote that sha and the combined run into the 🚢 line. When `<base>` is a
declared line, say so in the comment: that code is
**not in trunk yet**, and an evidence comment that implies otherwise will be read as
"this is in the next release".

**An issue with a real `## Plan` checklist gets a per-item verdict, not one prose
paragraph (#74).** One line per box: shipped-with-evidence (the `file:line` that proves
it), or moved to `#M` (the remainder issue). A single paragraph summarising "did the
whole thing" is exactly the shape that let a partially-done issue close silently in the
first place — a reader auditing later cannot tell which box a general paragraph actually
covers.

**Carry B1c's grade verdict here too — one line of prose, plus the machine-readable
marker (#260).** `Grade: pass — <what confirmed it>` for a plan/ask that was satisfied.
A `reject` never reaches this step at all (B1c stopped before B2); if you are here, the
verdict is `pass` by construction, but say what confirmed it so the record does not read
as a bare rubber stamp. Add a `<!-- colab:grade verdict=pass round=<n> -->` line
immediately after the `colab:evidence` marker — see *The grade verdict is a marker, not
a sentence to parse* below for the full contract.

```sh
gh issue comment 88 -b "<!-- colab:evidence sha=a1b2c3d -->
<!-- colab:grade verdict=pass round=1 -->
Shipped in \`a1b2c3d\` on <trunk>.
Grade: pass — diff matches the plan's Files list and the payroll fixture in the oracle
confirms the double-count is gone.
- [x] add the overtime_rate column — \`app/Models/Payroll.php:142\`; ran the payroll
      fixture for a 25%-overtime employee, the premium now applies once, not twice.
- [x] backfill existing rows — \`database/migrations/2026_08_01_backfill.php\`; ran
      against a copy of prod data, 0 rows left at the old rate.
- [ ] moved to #91 — the reporting-UI column was out of scope for this branch."
```

**A group that is not fully closed by this merge: name the siblings that must now rebase.**
The squash just moved trunk, so every remaining member branch in the `group:<key>` is now
behind it — say which refs those are and onto which sha, so the next ship is not left
re-deriving it from scratch. Only when the group survives this merge: once every member is
closed, the label is spent and B2d tears the object down instead.

**UI-affecting issues additionally require a screenshot of the BUILT app**, not a DOM
assertion and not a static mockup with tokens redefined to match the design system —
both are blind to the real rendering cascade (measured 2026-08-01: a component passed
every token-level assertion and still rendered wrong once actually built, because the
mockup never went through the app's real CSS cascade). Run the app (`/run` skill),
screenshot the changed surface, attach it to the evidence comment.

**Prepend one invisible marker line** — a stable, machine-readable first line, exactly
the pattern the claim comments already use (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#rules) *Rules*: a stable first
line as wire format, everything after it human). It names the trunk sha the comment
attests, so an external consumer (a closure-review view on a fleet dashboard, say) can
find and verify the evidence comment without heuristics — "first comment after merge
by the closing actor" is brittle; a stable marker is not.

```sh
gh issue comment 88 -b "<!-- colab:evidence sha=a1b2c3d -->
<!-- colab:grade verdict=pass round=1 -->
Shipped in \`a1b2c3d\` on <trunk>.
\`app/Models/Payroll.php:142\` — added the \`overtime_rate\` column.
Checked: ran the payroll fixture for a 25%-overtime employee; the premium is now
applied once, not twice — the double-count this issue reported is gone."
```

**Degrade, never gate.** The marker is an upgrade to an already-required comment, never
a new requirement of its own: a comment missing it (an older ship, a hand-written one)
still counts as evidence and must never be treated as absent by anything reading these
comments. Everything after the marker line stays free prose — **not** a structured
evidence format. A schema with fields invites padding (a 3-line honest comment becomes
a 15-line template of restated obviousness); the marker's whole job is being findable,
not being complete. A comment may carry both markers; a reader matches each by its own
name, never by line position, so their order in the body is never load-bearing.

### The grade verdict is a marker, not a sentence to parse (#260)

Free prose was measured to fail two ways at once, on two independently written adopter
parsers: a decorative emoji before a prose heading blanked one consumer's match
entirely, while the other's `PASS\b`-shaped tail pattern read a held, qualified verdict
(`PASS-WITH-NOTES`) as cleared. Opposite failures from the same root cause — there was no
fixed shape to parse in the first place. So the verdict is a **closed vocabulary in a
fixed marker**, and the prose next to it is decoration a consumer never has to touch:

```
<!-- colab:grade verdict=<token> round=<n> -->
```

- **Exactly four tokens are ever emitted here**: `pass` (B2b, this section) ·
  `reject-decision` · `reject-escalate` · `rework` (all three B1c, on the reject
  comment — `rework` is the direction-bearing `decision`, *A reject that already
  carries its answer*, and only ever at `round=1`). No token is a prefix of another and none is a decorated variant of another —
  a qualified outcome is a different whole token, never `pass` with a suffix. Free prose
  around the marker (a heading, an emoji, "held one round") is exactly that: prose. It
  can say anything; it changes what no consumer reads.
- **`round=<n>`** is the 1-based grading attempt for the harvested issue set — count
  prior `colab:grade` markers on these issues and add one.
- **Reading rule, so two adopters written independently agree:** match the marker
  anywhere in the comment body, never by heading text or line position. Compare the
  `verdict` token by **equality**, never by prefix or substring. Four states follow:
  **cleared** (token is exactly `pass`) · **held** (a recognised non-`pass` token —
  `rework` included: "the rework is decided" is not "cleared") ·
  **unrecognised** (marker present, token not in the reader's set) · **absent** (no
  marker at all). Unrecognised and absent both mean "do not treat this as cleared" —
  never a silent default to the safe-looking value. Absent is not a failure either
  (*Degrade, never gate*, above): an older ship, a hand-written comment, or a
  `ceremony: light` repo carries no marker and that is not evidence of anything wrong.
- **Attributes are read by name, never by position.** `verdict=rework round=1` and
  `round=1 verdict=rework` are the same marker. One optional attribute is defined:
  **`reviewer=<lane>`**, naming which review produced the verdict, so one marker grammar
  can serve more than one reviewer (a migration review's REWORK, for one). **Absent means
  the ship grade**, and this skill never writes it: every marker above is the ship
  grade's. A reader that routes only ship-grade verdicts treats a marker whose
  `reviewer` is present and is not a lane it knows as not its own, never as the ship
  grade's. An attribute a reader does not know is ignored; an unknown `verdict` token is
  still unrecognised.
- **An adopter needing an outcome this skill doesn't emit mints its own whole token**
  (e.g. `hold`) rather than qualifying an existing one — because *unrecognised* is
  defined as never-cleared, a new token is safe by construction at every consumer that
  hasn't been taught it yet. The handbook constrains its own emission and the reading
  rule; it does not police what an adopter's own tooling chooses to add.

**Not evidence:** quoting your own commit message · restating the ticked checklist ·
"done in `feat/x-23`". All three assert the work happened; none show it did.

**Made a significant design decision mid-work, without a pre-approved spec?** Add
`design-not-preapproved` as plain text in the same comment, after the marker line
(`CONVENTIONS.md` [§5](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122), *Design ruling*). Not a second marker — the marker's job is being
findable, not enumerating every condition a comment might report — just a word a human
reviewer greps for:

```sh
gh issue comment 88 -b "<!-- colab:evidence sha=a1b2c3d -->
<!-- colab:grade verdict=pass round=1 -->
Shipped in \`a1b2c3d\` on <trunk>.
design-not-preapproved — the spec did not cover the empty-state illustration; chose one
consistent with the existing icon set. Flagging for review.
\`app/Views/EmptyState.tsx:12\` — added the illustration and copy."
```

This is the human-review path for a design decision the `needs-decision` gate did not
catch because nobody could have: the surface did not look significant until someone was
already building it. The session does not stop to request a ruling first — it continues
on the designer's spec and lets the evidence comment carry the flag instead.
