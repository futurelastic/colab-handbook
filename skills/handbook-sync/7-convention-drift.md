# handbook-sync · §7 convention drift

Reference for [`handbook-sync`](SKILL.md) §7. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### Convention drift — a meaning this repo changed, or never absorbed (#362)

A convention label's *meaning* is not a copy this repo owns. The graft rules in §4–§6
protect what the repo added to its copies. They do not cover a repo that changed which
lane a `delivery:*` value starts in, or added a value the handbook does not have. That is
**drift, not a local customisation**, unless the repo declares it
([`CONVENTIONS.md` §8, *Upstream*](../../CONVENTIONS.md#upstream--a-consumer-that-changes-what-a-convention-means-files-it-here-362)).
A declaration is a line in this repo's `CLAUDE.md` `Local divergences:` list (in `CLAUDE.md`
beside the block, even where the repo's prose lives in `AGENTS.md`) that names
the label or value, what it means here, and a handbook issue URL.

**The mechanical half: compare the tracker's labels with the handbook's set.**

```sh
gh label list --limit 500 --json name,description | node -e '
  const L = require(process.argv[1] + "/tools/lib/labels.js");
  const want = new Map(L.CONVENTION_LABELS.map((l) => [l.name, l.description]));
  const fams = [L.DELIVERY_LABEL_PREFIX, L.DEFERRED_LABEL_PREFIX];
  for (const { name, description } of JSON.parse(require("fs").readFileSync(0, "utf8"))) {
    if (!want.has(name)) { if (fams.some((p) => name.startsWith(p))) console.log(`value   ${name}`); }
    else if (want.get(name) !== description) console.log(`meaning ${name}: "${description}"`);
  }' "$COLAB_HANDBOOK"
```

- **`value <name>`**: this tracker has a `delivery:*` / `deferred:*` value the handbook
  does not define. It is drift unless the `Local divergences:` list declares it. Do not
  read it as a gap the handbook forgot to fill, and do not guess a meaning for it:
  `delivery:elsewhere-partial` was ruled consumer-local in #366 for exactly that reason
  (`CONVENTIONS.md` §5, *Delivery type*). Until it is declared, the handbook's classifier
  reads it as not asked.
- **`meaning <name>`**: the label's description differs from the handbook's. This line is
  a lead. Read both texts before you conclude anything, because it has two readings:
  - **Same meaning, older wording.** `colab labels --ensure` never rewrites an existing
    description unasked, so a label created before the handbook reworded it keeps the old
    text until someone refreshes it. `colab labels --ensure` prints both texts for every
    such label (the audit warns on the same list, #364). Refresh them with
    `colab labels --ensure --refresh-descriptions`, adding `--keep <name>` for each label
    that is a declared divergence. This is a GitHub-side change, like the label back-fill
    above.
  - **A different meaning.** This is the divergence. It is drift unless declared.

Measured on the consumer behind the rule: the command printed `value delivery:design` and
a `meaning delivery:docs-only` line saying "on the ordinary code lane". Those are the two
divergences the handbook heard about 7 and 30 days late.

**The judgement half: this repo's own texts.** Labels are not the only place a meaning
lives. Search this repo's prompts, copied skills, scheduler config and docs for each
convention label name, and compare the rule each one states with `CONVENTIONS.md`'s.
Both directions count:

- **This repo says something the handbook does not.** Treat it the same as a `value` or
  `meaning` hit.
- **The handbook moved on and this repo still states the old rule.** Measured: a label
  made monotonic upstream, while a consumer's triage prompt still said clearing it "is
  often correct". Fix the repo's text in this sync's commit (§8). The handbook already
  decided, so there is nothing to file upstream.

**For each undeclared divergence**, pick one:

1. **This repo is wrong.** Revert it to the handbook's meaning in this sync's commit.
2. **The meaning should stay.** File the handbook issue now, in this session. Do not
   defer it to the next sync. Describe the consumer by shape, since the handbook is public.
   Use no `agent-filed` label, because it transcribes a decision already made here. Put
   `Filed-by:` on the person who approved the change. Then add the `Local divergences:`
   line to `CLAUDE.md` in this sync's commit. `CONVENTIONS.md` §8 *Upstream* is the rule
   behind each of these choices. Link to it rather than restating it on the Issue.

Never report an undeclared divergence as "local customisation, left as is". That verdict
is how the two texts drifted apart for 30 days.

**Skill overlays are the sanctioned customisation — leave them, but read them.** A
`.colab/skills/<skill>.md` file is this repo's local policy for one skill
([`CONVENTIONS.md` §8, *Local policy*](../../CONVENTIONS.md#local-policy--a-repo-refines-a-skill-without-forking-it-520)).
It is not a stamped copy, so §3–§6 never graft, refresh or delete it. It is still one of
this repo's own texts, so the judgement half above covers it: an overlay that restates a
convention label's meaning differently is drift like any other. A repo that carries a
**forked copy** of a whole handbook skill instead is the case overlays exist to replace:
propose moving its local differences into `.colab/skills/<skill>.md` and dropping the
copy, because the fork stops receiving upstream changes.

Fix what is genuinely wrong; **report what you are unsure about** rather than
guessing. A `project.yml` that contradicts reality is worse than one that admits it.

### A tag-triggered deploy copy must exclude pre-release tags (#513)

GitHub's tag glob `*` matches `-`, so `v*.*.*` also fires on `v1.2.3-rc.1`, and the release
workflow cuts candidate tags automatically — a copy with only the positive pattern deploys every
candidate to production. Every `deploy-*.yml` / `deploy.yml` copy (`deploy-xserver`,
`deploy-container`, or an older hand-written one) is read for it, stamped or not: parse its
`push: tags:` list; a copy that fires on a pre-release tag is a **finding**, and the audit fails
it under `deploy: tag` (warns otherwise). Offer the graft — one line, `- "!v*.*.*-*"` placed
**immediately after** `- "v*.*.*"` (a negative pattern before it, or separated from it, excludes
nothing; GitHub applies the list in order) — and keep the copy's own tag shape if it differs.
A copy whose positive pattern is already strict (`v[0-9]+.[0-9]+.[0-9]+`) cannot match `-` and
needs nothing. A copy with only a `workflow_dispatch` trigger (disarmed) is not a finding, but
tell the operator the exclusion goes in when they arm it. `release-tag.yml` copies are exempt
by design: they record a pre-release and deploy nothing.
