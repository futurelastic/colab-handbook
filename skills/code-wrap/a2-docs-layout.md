# code-wrap · A2 The `docs/` layout

Reference for [`code-wrap`](SKILL.md) A2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text (#686).

#### The `docs/` layout — where each of these lands

The destinations above (architecture doc, deploy doc, `adr/`, `gotchas.d/`, `design/`) say what
goes in `docs/`. This says how `docs/` itself is laid out, so a repo that follows A2 for a year
still has a `docs/` a newcomer can read. Measured across 29 adopting repos before this rule:
one `docs/design/` held 712 loose files, 16 of 25 repos had no index, plans and reports made up
10–40% of the markdown under `docs/` in four repos, and seven repos carried more than 48 MB
there, mostly fonts every design folder copied in.

- **`docs/README.md` is the index — one line per root entry** of `docs/`, file or folder: a link
  to it (or its name in backticks) and what it holds. A folder's own contents are indexed by that
  folder's `README.md` (`adr/README.md`, `design/README.md`), never by the root index. Add the
  line in the same commit as the entry. Starting one: copy
  [`templates/docs-README.md`](../../templates/docs-README.md).
- **`.gitattributes` carries `docs/README.md merge=union`.** Two branches each adding a line to
  the index then merge without a conflict. One repo added exactly this after its docs table caused
  2 of 6 measured ship conflicts. Union keeps both lines; check the order by eye after a merge.
- **Names are lower-kebab-case, with no dates.** `deploy.md`, not `DEPLOY.md` or `Deploy_Notes.md`.
  The issue number is the only key a name carries (`adr/<N>-<slug>.md`, `design/<slug>-<N>/`);
  a date in a name is a log entry, and `docs/` is current truth. `README.md` is the one exception
  to the case rule. A leading `_` marks a shared support folder (`design/_assets/`), not content.
- **Plans, proposals, reports, audits and session notes never go in `docs/`.** They describe one
  unit of work at one moment; they go on the Issue (A1), where the next session reads them and
  where closing the issue retires them. What outlives the work is distilled into the running doc
  it changes, or into an ADR.
- **Reserved root names**, created only when their first content arrives — never as empty
  placeholders: `architecture.md`, `deploy.md`, `operations.md`, `data.md`, `design-spec.md`,
  `guides/`, `reference/`, plus the folders A2 already names (`adr/`, `gotchas.d/`, `design/`).
  Use the reserved name rather than a synonym (`adr/`, not `decisions/`; `reference/`, not
  `spec/` or `specs/`).
- **Binaries stay light.** An image over 1 MB is exported smaller. Fonts and shared CSS live once,
  in `docs/design/_assets/`, or are linked from the design-system package — never copied into
  each design folder.

**Lazy migration.** A repo's existing files stay where they are: no forced move, no history
rewrite to reclaim space. New entries follow the layout. Tidying an existing `docs/` is that
repo's own issue, never a side effect of this session's diff.

**Checked, not enforced.** `docs-lint` checks 9–14 warn on each pattern above (A2's `docs-lint`
step, below). A warning on a file this session did not touch is reported, not fixed here.
