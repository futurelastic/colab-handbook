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

### A long-running CI or deploy job must declare `timeout-minutes` (#577)

#572 and #573 gave the templates' long-running jobs a job-level `timeout-minutes`. A copy cut
before that keeps GitHub's 360-minute default, and a self-hosted runner does not even hold to that
default: #572 measured Laravel builds cancelled at 1440 and 1544 minutes, with the runner held the
whole time and every later run queued behind it. Copy-and-own means the copy gets the change only
through this sync. Read every copy, stamped or not:

```sh
for f in .github/workflows/ci.yml .github/workflows/deploy*.yml; do if [ -f "$f" ]; then node -e '
  const f = process.argv[1], deploy = /\/deploy[^/]*\.ya?ml$/.test(f);
  let inJobs = false, job = null; const jobs = new Map();
  for (const l of require("fs").readFileSync(f, "utf8").split("\n")) {
    if (/^jobs:\s*$/.test(l)) { inJobs = true; continue; }
    if (inJobs && /^\S/.test(l) && !l.startsWith("#")) inJobs = false;
    let m;
    if (inJobs && (m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(l))) jobs.set(job = m[1], false);
    else if (job && /^    timeout-minutes:/.test(l)) jobs.set(job, true);
  }
  for (const [j, t] of jobs) if (!t && (deploy || /^(build|migrations)$/.test(j)))
    console.log(`no timeout-minutes  ${f}  job: ${j}`);' "$f"; fi; done
```

Each printed line is a **finding**. It covers every job in a `deploy-*.yml` / `deploy.yml` copy,
including hand-written ones, plus the `build` and `migrations` jobs of a `ci-*` copy. A CI copy
named something other than `ci.yml` gets the same check under its own name. A step-level
`timeout-minutes` (deeper indent) does not count, because it caps one step and leaves the job
unbounded. A commented-out job is not live and is not a finding. That includes `ci-node`'s opt-in
migration round-trip, which needs its timeout once someone uncomments it.

**Offer the graft.** Take the template's line and its `# EDIT:` note, placed at job level next to
`runs-on:`:

| copy of | job | template value |
|---|---|---|
| `ci-node` | `build` | `60` (measured p99 37 / max 43 min) |
| `ci-python` | `build` | `30` (not a measured fit, because only one adopter's byte-compile build was measured) |
| `ci-laravel` | `build` | `45` (measured p99 20 / max 26 min) |
| `ci-laravel`, `ci-node` opt-in | `migrations` | `15` (p99 under 4 min on every adopter) |
| `deploy-xserver` | `deploy` | `30` |
| `deploy-container` | `publish`, `deploy` | `45` each |
| a hand-written deploy | each job | none. Propose a value from that repo's own run history |

- **The value is the adopter's to size, and the template's number is only a starting point.** Size
  it well above *this* repo's p99 for that job (`gh run list --workflow <file>` and then
  `gh run view <id>` per job). Set it below the p99 and a slow but healthy run goes red. Say this in
  the offer, and copy the `# EDIT:` note with the line so the next reader sees it too.
- **Never overwrite a value the copy already has.** That includes one lower or higher than the
  template's, and the copy's own number wins. This check only flags absence, and the snippet
  prints nothing for a job that declares one.
- A copy that declines the graft is reported with its reason on the Issue, like any other declined
  graft (§4).
