# `docs/` — what lives here

The index of this repo's `docs/`: **one line per root entry**, file or folder. A folder's own
contents are listed by its own `README.md`, not here. Add the line in the same commit that adds
the entry; a file no line names is one nobody will find.

Keep this file's merges conflict-free — `.gitattributes` carries:

```gitattributes
docs/README.md merge=union
```

Two branches that each add a line then merge cleanly; check the order by eye afterwards.

## Entries

<!-- One line each, in this shape. Delete the examples you do not have yet: reserved names are
     created when their first content arrives, never as empty placeholders. -->

- [`architecture.md`](architecture.md) — the system as it is now, edited in place.
- [`deploy.md`](deploy.md) — how this repo reaches production, and its runbook.
- [`adr/`](adr/README.md) — one file per decision, `<issue>-<slug>.md`.
- [`gotchas.d/`](gotchas.d/README.md) — one file per long-lived gotcha, `<issue>-<slug>.md`.
- [`design/`](design/README.md) — one folder per design issue, `design/<slug>-<N>/`.

## The layout, in brief

The full rule is `code-wrap` A2, *The `docs/` layout*, in the colab-handbook.

- **Current truth only.** Plans, proposals, reports, audits and session notes go on the Issue,
  never in `docs/`.
- **Names:** lower-kebab-case, no dates; the issue number is the only key (`README.md` excepted).
- **Reserved root names:** `architecture.md`, `deploy.md`, `operations.md`, `data.md`,
  `design-spec.md`, `guides/`, `reference/` — plus `adr/`, `gotchas.d/`, `design/`.
- **Design artifacts:** `design/<slug>-<N>/` holds `<slug>-<N>-spec.md`, `<slug>-<N>-mockup.html`
  and `frames/`. Fonts and shared CSS live once, in `design/_assets/`, or are linked from the
  design-system package.
- **Binaries stay light:** an image over 1 MB is exported smaller.
- **Existing files stay where they are** (lazy migration); new entries follow the layout.
