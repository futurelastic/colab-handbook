# code-ship · B1c UI-affecting issues and children of a switched epic

Reference for [`code-ship`](SKILL.md) B1c. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### UI-affecting issues — also grade against the design artifact, when one exists (`CONVENTIONS.md` §5)

When the harvested set touches a UI surface and `docs/design/` carries an artifact
for it (`<slug>-<N>-mockup.html` / `<slug>-<N>-spec.md` — `CONVENTIONS.md`
[§5](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two), *Design
conclusions are three units, not two*), grade the diff against that artifact too,
alongside the plan's own oracle — not instead of it: a diff can satisfy the plan's
stated Files/oracle and still miss what the approved design actually specified.
The result folds into the **same** pass/reject verdict above — there is no separate
design-verdict token — and a mismatch classifies exactly like any other B1c gap:
`decision` by default, `escalate` only when the three conditions below all still
hold. Name the artifact file in the reject comment so the gap is findable, not
just "doesn't match the design."

No artifact under `docs/design/` for this surface, or the harvested set is not
UI-affecting → nothing new to check here; the plan/ask oracle above is still the
whole grade, exactly as before this clause.

#### Children of a switched epic — also grade "dark with the switch off" (#340)

This applies only where `CONVENTIONS.md`
[§5](../../CONVENTIONS.md#switched-epics--concurrent-unfinished-features-336), *Switched
epics*, applies: `exposure: released`, or a bare legacy `tier: A`, which reads the same
way (`tools/lib/axis-authority.js`). It also needs a harvested issue that carries a
`colab:switch` marker itself, or whose parent epic does:

```sh
gh issue view <N> --json parent -q '.parent.number // empty'                        # the epic, if any
gh issue view <epic> --json body -q .body | grep -oE '<!-- colab:switch [^>]*-->'   # name=, needs=
gh issue view <N>    --json body -q .body | grep -oE '<!-- colab:switch [^>]*-->'   # role=add|remove
```

Read the markers the way `code-triage` §2 does. A marker that is **not cleared**
(malformed, an unrecognised token, or two markers disagreeing) is a `reject-decision`
naming the defect. The grade cannot tell which question below applies, and defaulting one
is exactly what the marker family forbids. When a marker is valid, the child's `role`
decides the question:

- **`role=add`, the first child.** The switch is introduced under its declared `name`,
  and that name is the literal identifier the code reads: `git grep -n <name>` at the
  branch head finds the read sites. An absent selector runs the release configuration
  (rule 2). Everything this diff adds sits behind the switch.
- **No `role`, an ordinary child of a switched epic.** Every behaviour the diff adds is
  reachable only with the switch on. The release configuration behaves as trunk did
  before the branch: schema changes only add, old config files and API responses keep
  working, and no destructive step happens here (rule 5). The epic's `role=add` child must
  already be closed by a merge (the test is in `code-triage` §2), or be in this same
  harvested set. A child that lands before its switch exists cannot be dark.
- **`role=remove`, the last child.** This child is graded on the opposite question: is the
  switch removed **completely**, and is any destructive step it was deferring performed
  here? `git grep -n <name>` at the branch head returns nothing. No dead branch survives in
  the switch's place, such as a selector read replaced by a constant, an `if (false)` path,
  or the off path's code left behind unreachable. The grep cannot see those, so read the
  diff for them. Every destructive step that rule 5 deferred to this child is in the diff:
  each one the removal child's body or the epic names, and each compatibility stand-in the
  epic's earlier children left behind that the diff can identify (an old column, an old
  config key, an old response field). A deferred step that is still missing counts as a
  miss. It does not become a follow-up.

**What the grade reads as evidence, for `add` and ordinary children.** First, the
**release-configuration CI run at the branch head**. `CONVENTIONS.md` §7 requires a repo
holding an unfinished switched epic to run its suite in both configurations. A green release
job at the head sha is the direct evidence that the release configuration behaves as before.
Second, **the diff itself**, read for any code path the switch does not guard. A green
release run is necessary but not sufficient: a suite that never exercises the new path
passes while that path is live. If the repo's CI runs only one configuration, grade on the
diff alone and say in the evidence that the release configuration **was not run**. That is
not a reject by itself, because CI's shape is §7's business, not this change's.

**The verdict a miss produces.** A dark-launch miss is a **reject**. That covers new
behaviour reachable with the switch off, a changed release configuration, and a child that
lands ahead of its switch. A removal miss is also a reject: a grep hit, a dead branch, or a
deferred destructive step left undone. Either one is an ordinary B1c gap with the same
marker tokens, no new ones. It is `reject-decision` by default, and `reject-escalate` only
when all three conditions below hold. **One case is always `decision`:** a destructive step
performed *before* the removal child (rule 5). Once a release carries that step, it cannot
be undone, which puts it in the `decision` list's own category. The reject comment names the
rule broken and the `file:line` of the unguarded path, grep hit, or destructive step.

**On a pass**, B2b's evidence comment says in prose which switch question was graded and on
what evidence. For example: `switch: bulk-import role=add — dark with the switch off
(release-config job green at a1b2c3d; diff read, no unguarded path)`. The `colab:grade`
marker keeps its closed set of four tokens.

When the repo is out of scope, or no harvested issue belongs to a switched epic, this clause
adds nothing, and the grade is exactly what it was before.
