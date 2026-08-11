# audit

An external convention auditor. It sweeps **many repos across multiple owners**
(five in our case — a mix of GitHub orgs and personal accounts) plus local-only repos
with no GitHub presence, and reports where each drifts from the handbook.

This used to be an in-repo CI job (`validate-conventions.yml`). It is not any more: a
guard living inside a repo can only see that one repo, has to be copied everywhere to
be useful, and rots differently in each copy. The failure mode that actually bites is
drift **between** repos — one on Node 20, its sibling on Node 22 — which no single
repo's CI can ever detect. So this is one auditor, run from one place, over all of
them.

It is **advisory**. It gates nothing. Run it by hand, or on a schedule (cron /
LaunchAgent).

## Requirements

- Node (plain, no dependencies).
- `gh`, authenticated — only needed for entries given as `owner/name` slugs. Entries
  given as local paths need nothing but a filesystem.

## Usage

```sh
node audit.mjs                          # audit the resolved repo list (see below)
node audit.mjs --quiet                  # only repos with findings
node audit.mjs --json                   # machine-readable, for a dashboard/cron
node audit.mjs --local ~/code/my-repo   # one local path, ad hoc (repeatable)
node audit.mjs my-org/my-repo           # one remote slug, ad hoc
node audit.mjs --config other-list.txt  # a different repo list
```

Exit code: `0` when every repo passes, `1` when any repo has a finding, `2` on a
usage error. A repo that is missing, broken, or has no `project.yml` produces a
finding — it never crashes the sweep. The header prints which repo list was used and
the handbook's current version, so a scheduled run is self-documenting.

## What it checks, per repo

- `.github/project.yml` present and parses. `trunk`/`production`/`deploy`/`stack` are
  required keys; `tier` is **not** — see "Axis of record" below for what replaced it.
- **Axis of record (#144)** — which key governs gate count. `exposure`, when declared,
  wins outright (`tools/lib/axis-authority.js`); otherwise `tier` is read as a **legacy**
  value (`A → released`, `C → live`, `B → null` — the `null` means a bare `tier: B` has
  no derivable opinion at all, which is why phase 3 of the axis epic still has to ask ten
  repos by hand). Declaring **neither** key is the one new hard failure this unit adds,
  replacing the old unconditional "missing key(s): tier". Declaring **both** and
  disagreeing about gate count (e.g. `tier: A` + `exposure: live`) is exactly one
  disagreement finding; `tier: B` disagrees with nothing, because a bare `B` never had an
  opinion to contradict. A repo on the legacy path also gets one **dormant** advisory
  nudging it to declare `exposure` explicitly — dormant until the HANDBOOK ITSELF (not the
  repo's own stamp) reaches `AUTHORITY_FLIP_VERSION` (`tools/lib/stamp.js`), mirroring the
  `hb.untagged` precedent the stamp checks already use. It is inactive today.
- The bullets below describe the **gate contract** — trunk shape, committed deploy path,
  production non-null — in whichever voice governs a given repo. On the **legacy** path
  (no `exposure` declared) the wording is exactly what it always was, letter for letter,
  because #144's primary requirement is that this half stays byte-identical for every
  descriptor that has not opted into `exposure`. On the **exposure** path (declared
  directly) the same rules apply, worded against `exposure`'s vocabulary instead — see
  `project.schema.md`'s `exposure` section for the two legal `released` shapes and
  `live`'s no-runbook asymmetry.
- Tier ↔ trunk coherence (legacy voice): tiers A and C → `dev`, tier B → `main`.
- Tier A must have a `deploy-*.yml` workflow **and** a non-null `production`, and must
  not say `deploy: none`.
- Tier A must not say `deploy: push-main` — a **tier mismatch**, not a bad mechanism. The
  value stays legal and describes those repos truthfully (a `main` push really does deploy
  them); what it cannot do is meet tier A's contract that a deliberate release artifact
  gates production, since every push to `main` reaches users. Options include migrating to
  a tag trigger (`deploy: tag`) or, if it genuinely ships by hand, `deploy: manual` +
  `runbook:` — but the usual fix is **retiering to C**, which is exactly this shape and
  needs no pipeline change at all.
- Tier C rules: `trunk: dev`, non-null `production`, `deploy: push-main`, and a
  `deploy-*.yml` workflow. A wrong `deploy` value on C is redirected to the tier that
  matches its gate count rather than merely rejected — `tag` and `manual` point back to A,
  `none` points to B.
- `deploy: manual` must name a `runbook:` and the file must exist (a local checkout is
  authoritative; over the API a miss is only an advisory).
- Tier B must have `deploy: none`, no `production` URL, and no deploy workflow. (This
  was silently unchecked before — a tier B repo could quietly ship to production with
  none of the tier A gates.)
- The declared `trunk` branch actually exists.
- **Trunk is CI-gated** — at least one CI workflow triggers on **push to the declared
  trunk**. Merges land on the trunk as pushes; if the CI workflows' `on.push.branches`
  still name the *old* trunk after a `main → dev` move, every merge runs zero CI while
  the B1 gate ("check trunk CI is green") checks runs that can never exist (this bit
  three of our Tier A repos for real). **⚠ finding** when no CI-type workflow gates
  push to the trunk — the message lists what the workflows *do* gate
  (`trunk "dev" is not CI-gated … (ci.yml gates: main, master)`).
  - Deploy/release workflows are **not** CI gates and are excluded — by filename
    (`deploy*`/`release*`) and by trigger shape (a **tags-only** or
    **`workflow_dispatch`-only** workflow does no branch gating). So a `deploy-*.yml`
    firing on a push to `main` is never *counted as CI* here; only CI-type gating of the
    **trunk** is what this check is about. That exclusion is scoping: whether such a repo
    should be tier A is a separate check (see the `project.yml` rules above).
  - A repo with **no CI-type workflow at all** is out of scope (that is "should this
    repo have CI?", a different question) — the check only catches CI that *exists but
    points at the wrong branch*.
  - **Advisory (·)** when a workflow's branch list names a branch that **does not
    exist** in the repo — the stale-reference anti-pattern (`ci.yml triggers on
    nonexistent branch(es): develop, workos`). Standard integration aliases
    (`main`/`master`/`dev`/`trunk`) are exempt, since teams list them defensively;
    glob patterns like `release/*` are skipped too.
  - The `on:` block is read by a small indentation-aware parser (not the flat
    project.yml reader): it handles flow lists (`branches: [main, dev]`), block lists,
    inline `on: push` / `on: [push, pull_request]`, and `branches-ignore`.
- Branch names match `^(feat|fix|docs|chore|refactor|test|perf)/[a-z0-9._-]+$`
  (integration branches `main`/`dev`/`master`/`trunk` exempt).
- **Toolchain agreement** — flags when `project.yml`, the ecosystem manifest
  (`.nvmrc` / `engines.node` / `composer.json require.php`), and the versions the
  workflows actually pin disagree. It **reports**, it does not auto-resolve. Two
  workflows pinning different majors (the ci.yml=20 / deploy=22 bug) is a hard finding.
- **Handbook reconciliation (stamps)** — copied templates carry a stamp naming the
  template and the handbook version they were copied at (`colab template` writes it;
  see `templates/`). The audit compares each stamp against the handbook's own git
  history:
  - Template **changed** since the stamped version → **⚠ finding** ("copied @ vX —
    template changed since (vY): review, re-copy via colab template").
  - A workflow that **looks** like a handbook copy (matching filename or a content
    fingerprint) but carries **no stamp** → advisory (can't track drift).
  - Stamp naming an **unknown** template, or a version **newer** than the handbook, or
    a version **not in this checkout** → advisory.
  - The same comparison runs for a `CLAUDE.md` conventions block against
    `templates/repo-CLAUDE-block.md`.

  Reconciliation needs the handbook's version = `git describe --tags --abbrev=0` in
  this checkout (override the handbook location with `COLAB_HANDBOOK`). **Before any
  tag exists** the version is treated as `v0` and stamp comparisons are **inactive**
  (the header says so) rather than failing.

  This stamp reading is **shared code**, not a copy: it lives in `tools/lib/stamp.js` and
  is used both here and by `colab update`, which refreshes what this tool reports. Two
  implementations that disagreed about what "behind" means would be the exact
  two-places-drift disease this handbook exists to kill. The module is CommonJS (the CLI
  is); this ESM file pulls it in through `createRequire`.

  The audit **reports** drift; `colab update` is the other half of the loop — it can
  rewrite a copy that is provably pristine, and refuses to touch a hand-edited one. See
  `tools/README.md`.

- **`CLAUDE.md` size (#64, #117)** — code-wrap's A2 rule ("router, not an archive") was
  prose-only, and its own worst-case citation is framed in *lines*, which is blind to
  the failure that actually occurs: a single "pointer" line growing into a full copy of
  the doc it points at. Two independent, advisory (⚠→`warn`, never `fail`) checks:
  - **Whole-file byte ceiling** — `CLAUDE.md` over 40 KB. It is loaded in full into
    every session before any work starts.
  - **Per-line ceiling** — any single physical line more than 6x the file's own median
    line **and** over 2048 bytes. That combination (relative *and* absolute) is the
    "pointer became a copy" signature, and it is format-agnostic: a bullet-list router
    trips it exactly like a markdown table does, because it scans physical lines, not
    table syntax.
  Both thresholds are explicitly a starting point offered by the issue for calibration
  across adopting repos, not a settled gate — hence `warn`, not `fail`.
  **Both checks gate on *authored* bytes, not total (#117).** Wrap a generated span —
  one a script rebuilds and a test asserts byte-for-byte, e.g. a table of contents built
  from another doc's headings — in `<!-- colab:derived:start id=<name> -->` /
  `<!-- colab:derived:end -->`, and its bytes and lines are excluded from both ceilings.
  That content is unshortenable by construction (editing it by hand makes the repo's own
  regeneration test fail), so it should not be charged against a budget meant for prose a
  session can actually trim. The finding still reports the file's *total* size when a
  derived span is present — the byte cost of loading the file stays visible even though it
  no longer decides the verdict. A malformed marker (unterminated start, stray end, nested
  start) fails open: the audit warns about the malformed marker separately and counts the
  affected span as authored, so a broken marker can never hide real prose from the ceiling
  it exists to inform.

- **Markdown anchor links resolve (#158)** — section numbers used to be cited by
  number (`§5`) from ~20 files, and nothing checked them: a renumber broke every
  reference silently, no CI failure, no advisory. The fix is anchor links, which
  survive renumbering — and this check, so a *broken* link is loud instead:
  - Scans every git-tracked `*.md` file in a **local** checkout (never remote — see
    below) for link-shaped `](target#fragment)` references: same-file (`[…](#slug)`)
    and cross-file, relative paths resolved against the *linking file's* directory.
  - Resolves each target's headings with a minimal GitHub-compatible slugifier and
    **fails** when a fragment doesn't match any of them, naming the file, the broken
    anchor, and up to five valid slugs ranked by edit distance to the broken one
    (#187 — nearest by construction, not just the first five headings in the
    document). **Fail, not warn** — an unresolved anchor is unambiguous once found,
    unlike the byte-ceiling checks above.
  - **Deliberately link-shaped only.** A bare `§N` in prose, or a bare
    `FILE.md#slug` mention with no `[...](...)` around it, is invisible to this
    check by construction — that is what keeps a not-yet-migrated `§N` citation
    (there are still ~280 of them, tracked by #183) out of scope.
  - **Local sources only.** Enumerating markdown over the `gh` API would be
    O(files) calls per repo across a fleet sweep; a remote source contributes no
    finding at all, silently, rather than an advisory — the same "would rather
    under-report than invent" posture `checkRunbook` takes for an API-backed miss.
  - Runs unconditionally, same posture as the `CLAUDE.md` size check below: a
    markdown-hygiene concern, not a stamp/tier one, and it applies to the
    handbook's own docs unchanged (not gated on `isSelf`).
  - **Slugifier gotcha, worth knowing if a link ever needs hand-writing:** GitHub
    does not collapse the double space an em-dash leaves behind — a heading like
    `` `trunk` — required `` slugifies to `trunk--required` (double hyphen), not
    `trunk-required`.

- **Convention labels present on the tracker** (`in-progress`, `deps-checked`,
  `agent-filed`, `epic` — `tools/lib/labels.js`) — **advisory**, and only when the repo
  is adopted (has a `project.yml`) and the label set could actually be read (remote-less
  or offline audits stay silent rather than claim a label is missing they could not see).
  A repo that adopted at an older handbook version never back-fills a label added later
  on its own; the check that label powers then silently cannot fire (`CONVENTIONS.md`
  §8, *Labels reconcile too*).
- **`ceremony:` coherence (#79, narrowed by #175)** — an optional field scaling
  memory-ceremony depth (project.schema.md#ceremony--optional). An unrecognised value
  is a **finding**; one coherence rule is also a finding, scoped to `ceremony: light`
  only: `light` + `autonomy: auto-trunk` — an unattended merge with no evidence trail
  is a closure nobody can audit. (#175 removed the rule this used to also carry —
  `light` + a non-null `production` — because narration follows the room, not
  exposure: a live single-operator repo's audit trail still has one reader, live or
  not.) Omitting `ceremony:` entirely, or setting `ceremony: standard`, triggers no
  rule. `light` also **downgrades the handbook-reconciliation stamp check** (above)
  from `fail` to `warn` — but only for a **non-CI** template (the CLAUDE conventions
  block, a deploy template, …). A stamped `ci-*` workflow that has drifted stays a
  hard finding on every repo regardless of `ceremony`, because build/secret-scan
  integrity is never optional.

- **`exposure:` enum + gate contract + pairing advisory (#132, re-keyed by #144)** — an
  optional field naming what consumes a merge here (project.schema.md#exposure--optional).
  As of #144 it is the **axis of record when declared** — see "Axis of record" above — so
  a directly-declared `exposure` now DRIVES the trunk-shape/deploy-path/production-non-null
  checks the bullets above describe for the legacy (`tier`-only) path, worded in `exposure`'s
  own vocabulary instead of the tier letters. `live` keeps tier C's old no-runbook
  asymmetry (a deploy workflow is required; there is no `runbook:` escape hatch). `released`
  accepts **two legal shapes**: a live `production` URL with a committed deploy path
  (mirroring the old tier A contract), or — new in #144 — `production: null` evidenced by a
  version-shaped git tag or `channels: [artifact]`, recording that adopters consume a
  release even though there is no server (this handbook's own descriptor is exactly this
  shape). `self` gets **no mechanism or contract rule at all** — its consumer set is a
  subset of the room's, and policing its deploy/production/trunk shape is out of scope.
  `none` keeps the SAME pairing advisory it always had (`exposure: none` + `production: null`
  together is a **warn**, unanswered rather than lying) and stays clean when `production` IS
  named — the pinned "visibly transitional" read (CONVENTIONS.md §2) — but a committed deploy
  workflow alongside `exposure: none` is now a real contradiction. An unrecognised value is
  still a **finding**. Omitting `exposure:` entirely reports `null` (undeclared) in `--json`,
  never `"none"` — there is no default, by design (`CONVENTIONS.md` §2, *Exposure*, "lowering
  exposure is a human act") — and falls back to the legacy `tier` read instead.
  **`tier` + `exposure` both declared and disagreeing about gate count is now exactly one
  disagreement finding** (`tools/lib/axis-authority.js`'s contradiction table) — `tier: B`
  disagrees with nothing, every other tier is consistent with exactly one exposure value.

- **`channels:` shape/enum check + coherence advisory (#151)** — an optional field
  naming every path by which a commit reaches something that *runs* it
  (project.schema.md#channels--optional), additive alongside `deploy`; `deploy` stays
  fully authoritative and no rule couples the two. Unlike every other axis here it is a
  **list**, because a repo can genuinely have several channels open at once. A bare
  scalar, an empty list, an unknown member, a duplicate member (`[workflow, workflow]`,
  pointing at the deduplicated form), or `[none]` combined with another value are
  each a **finding**; the descriptor-internal coherence check is `channels: [none]`
  together with a non-null `production` or a non-`none` `deploy` — a **warn**, never a
  `fail`, on `exposure`'s precedent. Omitting `channels:` entirely reports `null`
  (undeclared) in `--json`, never `["none"]` — there is no default, by design
  (`CONVENTIONS.md` §2, *Channels*, the same "declaring absence is a human act" asymmetry
  `exposure` carries).

- **`exposure`/`channels` falsifiers + duration report (#137)** — the checks above are all
  descriptor-internal: they can catch a `project.yml` contradicting *itself*, never a
  `project.yml` contradicting the working tree around it. This unit adds that half, for
  both keys, from ONE shared evidence collector so a tag counts as evidence against both
  `exposure: none` and `channels: [none]` at once (a tag is exactly the artifact
  `channels: [artifact]` names):
  - **F1 — a version-shaped tag exists.** Any git tag matching a semver-ish shape
    (`v1.2.3`, `1.4`, `v3.0.0-rc1`); a tag like `backup-2024` does not count — no
    dot-separated numeric parts, so nothing about it claims to be a release.
  - **F5 — a committed deploy path exists.** A `deploy-*`/`release-*` workflow (already
    enumerated by the tier checks above — zero new IO), or a `deploy`/`release` basename
    file (any single extension, or none) directly under the repo root, `scripts/`, or
    `bin/`. Non-recursive by construction, so `templates/deploy-*.yml` (this repo has one)
    or a `docs/deploy.md` writeup is never mistaken for a live path.

  Each finding is a **warn**, never a `fail` — deliberately, on the same reasoning as the
  coherence advisories above and argued further: a falsifier proves the CLASS of evidence
  that usually accompanies a consumer, not a consumer itself. A repo released years ago and
  dead since is truthfully `exposure: none` today, tag and all; the message therefore says
  "worth a second look," never "you have consumers." `exposure: self` gets no falsifier at
  all — `self` claims a consumer set bounded by the room, and a tag or a deploy script is
  perfectly compatible with a team shipping to itself.

  **Three more falsifiers were named when #137 was filed and are deliberately NOT shipped**,
  each for a reason that more code does not remove:
  - **A per-machine service definition serving the path** — ruled out as a *field* already
    (project.schema.md, "Per-host deploy target — deliberately not a field"): it answers
    differently on every machine for the same commit, and reading outside the checkout is a
    line this tool has never crossed. Reopens only if that ruling itself changes.
  - **Another repo's stamp naming this one as a source** — the stamp vocabulary today has
    exactly one possible source, the literal string `colab-handbook`, and that always
    declares `exposure: released`, so it could never fire against a `none` claim. Dead code
    today; reopens if a later unit generalises the stamp to name an arbitrary source.
  - **A declared `production:` target resolving in DNS** — the repo-local half (`exposure:
    none` + a *named* `production`) is already the pinned-clean "visibly transitional"
    shape (`CONVENTIONS.md` §2, *Exposure*; `audit-exposure.test.js`); firing on it would
    contradict a shipped ruling. The resolving half needs network, which this tool
    deliberately does not use, and is weak evidence anyway (parked domains, wildcards, CDN
    catch-alls). What it reached for — visibility into a state that has lasted a long time
    — is served by the duration report below instead.

  **Duration report, with no new field.** Alongside the falsifier, the audit reports how
  long the CURRENT `exposure: none` (or `channels: [none]`) value has held — computed fresh
  every run from the descriptor's own git history (`git log -G` over `.github/project.yml`,
  walking newest→oldest to find the commit whose parent last disagreed), never a stored
  date that could rot. Silent under roughly six months (the same fixture committed moments
  ago that the coherence-advisory tests above rely on staying clean, stays clean here too).
  Degrades to a **lower bound** ("at least N months") rather than guessing, in three cases
  that are all handled the same way — the walk hits its 50-commit cap, the oldest matching
  commit's parent blob is unreadable (a shallow clone's history boundary, or the repo's
  root commit), or every parent inspected already agreed with the current value.

  **Gating — the whole reason this is additive, not a tax.** Evidence gathering and the
  git-history walk run ONLY when `exposure` is exactly `"none"` or `channels` is exactly
  `["none"]`. A repo declaring neither key, or any other value, does byte-for-byte the same
  IO it did before this unit — including every outside adopter of this public repo who has
  not opted into either axis. `exposure` and `channels` are never coupled to decide each
  other's finding: each falsifier/duration check reads only its own key to decide whether
  to run, even though both draw on the same working-tree evidence once running.

  **Degradation.** Every new source read (`tags()`, the historical `git show` reads) returns
  `null`/`[]` on failure — no git, not a git repo, a shallow clone, a remote (`owner/name`)
  source — and the caller stays silent on `null`, never a finding, never a crash. A remote
  source contributes no duration finding: the per-commit walk has no cheap `gh api`
  equivalent (reading N historical revisions would be N API calls per repo across a fleet
  sweep, the same cost `markdownFiles()` above already declined), so `descriptorHistory()`
  is unconditionally `null` there.

`stack` is intentionally **not** validated — it is a free-form string now.

## The repo list — resolution order

The list of repos to audit is resolved highest-precedence first:

1. `--config <path>` — explicit; errors if the path is missing.
2. `~/.colab/repos.txt` — the **machine-local, private** fleet registry (override the
   directory with `COLAB_HOME`, matching the `colab` CLI). Used automatically when it
   exists. **This is where your real repo list lives** — it is not committed anywhere.
3. `audit/repos.txt` — the committed **neutral example** in this repo. Fallback only;
   it contains format docs and placeholder entries, no real repo names (this handbook
   repo may be public, so a list of private paths/slugs must not live in it).

To build your real list: `mkdir -p ~/.colab && cp audit/repos.txt ~/.colab/repos.txt`,
then replace the examples. Format: one entry per line, `#` for comments; each entry is
an absolute path (audited from the working tree, faster, sees local branches) or an
`owner/name` slug (audited through the GitHub API, nothing cloned). Local-only repos
with no remote are valid — just give the path.
