***English*** · [Tiếng Việt](README.vi.md)

# colab-handbook

A small set of conventions and tools for running many repos — many coding
sessions in parallel, humans and AI agents alike — without stepping on each
other.

**If you are an AI agent, stop here and read [`CLAUDE.md`](CLAUDE.md).**
This file is for humans.

## Quick start

```sh
git clone https://github.com/futurelastic/colab-handbook.git ~/code/colab-handbook
cd ~/code/colab-handbook && ./install.sh --all   # skills + colab CLI + hooks, from the newest release; --dry shows it first
cd /path/to/your-repo
colab adopt              # asks only what it cannot detect, writes .github/project.yml
colab labels --ensure    # creates the convention labels
colab register           # adds the repo to this machine's fleet list
```

Then, in an agent session in that repo, run `/code-start <issue-number>`. With an
agent at hand, `/handbook-sync` replaces the last three commands and also does
the rest of adoption (see [*Adopting it into a repo*](#adopting-it-into-a-repo)).
You need `git`, `node` ≥ 18 and `gh` ≥ 2.94 logged in (`gh auth login`); distro
packages often ship an older `gh`, so install it from [cli.github.com](https://cli.github.com).

*([`CONVENTIONS.md`](CONVENTIONS.md) is the normative document, written in
English so agents and tooling can read it. This file and the Vietnamese
[`README.vi.md`](README.vi.md) are only gateways. When the two disagree, **both
are wrong** until they agree with `CONVENTIONS.md` again.)*

## What this is

A **handbook, not a framework**. It decides **outcomes** — where code merges,
what a release is, how you announce "I am working on this" — and deliberately
leaves the **implementation** (your Node version, your test runner, your CI
file) to each repo.

It was distilled from running a fleet of real repos, several of them
production apps maintained almost entirely by AI agents working in parallel
across many worktrees. The anti-pattern list is not theory: every entry is
something that actually happened.

### The problem it solves

One person on one repo needs none of this. The conventions live in their head,
and their head is the only place they need to be.

That stops working somewhere around the third repo, and it collapses entirely
once sessions run **in parallel** — several at a time, on different machines,
some of them agents that will not think to ask. Then every unwritten assumption
becomes a way to lose work:

- two sessions claim the same issue, because neither could see the other had
  started;
- a feature branch is left checked out on the working tree a dev server reads
  from, and the live app quietly serves unmerged code;
- code merges and the issue stays open, so the next person re-does it;
- a repo's documentation describes a repo that no longer exists — which is worse
  than no documentation, because someone will act on it.

None of those is a hard problem. They are all the *same* problem: **facts about
a repo that live in someone's memory instead of in the repo.**

### What it actually does

It makes each repo answer five questions about itself, **once**, in a file
every session reads before touching anything (see [*The five
questions*](#the-five-questions)). Everything else follows from those answers:
which branch to merge into, what a release even means here, whether a branch is
required at all, how much a session must write down before it stops.

The rest of the repo serves that: a CLI that performs the mechanical parts, an
audit that reports where reality has drifted from what a repo claims, and
session flows (skills) so a coding session opens and closes the same way
everywhere. The skills are plain prose — a person at a terminal can follow them
with no agent and no other tool.

### What it is not

- **Not a service.** Nothing here is a dependency and nothing phones home. You
  copy what is useful and own the copy — fork it, edit it, delete half of it.
  That is what the licence is for.
- **Not a CI system, and not an opinion about your stack.** Bring your own
  language, test runner and pipeline. The handbook only asks that the pipeline
  produce two outcomes, and never says how.
- **Mostly not an enforcement layer.** Conformance is advisory. The few things
  that block are listed in [*Why so little
  enforcement*](#why-so-little-enforcement).
- **Not a maturity model.** No answer here ranks a repo above another. A repo
  with no production is not a worse repo; it is a repo with fewer gates.

## Your first session

A unit of work goes round one loop. Each step is a skill, invoked in an agent
session as a slash command (`/code-start 42`), or followed by hand from
[`skills/`](skills/).

| Step | Skill | Who runs it | What it leaves behind |
|---|---|---|---|
| 1. Pick | `/code-triage` | coordinator | the ready work in order, `group:` labels on issues that must share a branch, `needs-plan` on hard ones, the start commands |
| 2. Open | `/code-start <N>` | implementer | the issue claimed, a branch cut from trunk and pushed, a worktree, a short plan file |
| 3. Work | — | implementer | commits on the branch |
| 4. Hand off | `/code-wrap` | implementer | what was learned written onto the Issue, the repo's gate run, the branch pushed — then it **stops** |
| 5. Merge | `/code-ship` | coordinator, after a human go | one squash commit on trunk with `Closes #N`, evidence on each issue, claims released, the worktree removed |
| 6. Clean up | `/code-sweep` | coordinator | finished work shipped, stale claims and worktrees cleared |
| 7. Release | release workflow, or `/release-rung` | automatic, or a human where a tag deploys | a candidate tag, then the final after a test period — only where the repo's `exposure` has releases |

Also in [`skills/`](skills/): `code-plan` (a full plan for a hard issue, run by
`code-start` when flagged), `handbook-sync` (bring one repo up to the current
handbook), and `migration-review` (review a branch's migrations, for whoever a
repo binds to that role).

**Running the loop by hand at a terminal?** With no `--session`, `colab` names
you `person:<git user.email>/<host token>`, so claims and ship evidence say who
you are. If you work on several units at once from separate shells, give each
shell its own `COLAB_SESSION=<any stable id>` so their holds stay apart.

**Words you will meet:**

- **Trunk** — the branch sessions merge into (`trunk:` in `project.yml`).
  **Promotion** — merging trunk into `main` where trunk is not `main`; on a
  `live` repo the promotion *is* the deploy.
- **Claim** — an assignee plus the `in-progress` label, backed by the branch
  pushed to the remote, taken *before* work starts.
- **Implementer / coordinator** — the session that writes the code / the one
  that picks, merges and cleans up. One person may be both, at different times.
- **Phase A / Phase B** — `code-wrap` (the implementer's half, ends before any
  merge) / `code-ship` (the coordinator's half: the merge and everything after).
- **Rung** — how much plan a session writes: 0 none, 1 a five-line stub, 2 a
  full plan from `code-plan`.

Newcomers: read [`CONVENTIONS.md` §1](CONVENTIONS.md#1-the-model-in-one-picture)
(the model) and [§11](CONVENTIONS.md#11-quick-reference) (quick reference)
first. The rest of `CONVENTIONS.md` is reference — look things up, do not read
it end to end.

## The five questions

Adopting means answering these about your repo into `.github/project.yml`.
`colab adopt` asks only the two that change a gate (1 and 3), as numbered menus;
the other three are optional and can be answered any time later:

| # | Question | Writes | At adoption |
|---|---|---|---|
| 1 | Does a deploy target exist **today** (not "soon"), and how is it reached — a tag, the promotion itself, a human running a runbook, or nothing yet? | `production` + `deploy` | asked |
| 2 | Who else works here — just you, a team, or the public? | `room` | optional — `colab adopt --axis room` |
| 3 | What would break if you merged something wrong here — nothing, only people already in the room, users via the next promotion, or users and adopters via a released artifact? | `exposure` | asked — a human's answer |
| 4 | May a human commit straight to trunk alongside worktree sessions — freely, with declared intent, or never? | `writes` | optional — `colab adopt --axis writes` |
| 5 | By what path does a commit reach the thing that runs it — a CI workflow, a git hook, a documented procedure, a live checkout, a published artifact, another system's data, or none yet? | `channels` | optional — `colab adopt --axis channels` |

**Answering question 3 is a human's act** when the answer is "nothing" or "only
people already in the room". An agent can drive everything else; when it gets
there, `colab adopt` prints, as its first line, the one command the human runs.

Nothing is asked that the repo already states — its default branch (`trunk`,
kept as it is: a `master` default is fine, nothing needs renaming),
its toolchain, its ports are detected. Gate count, release ritual and whether a
branch is mandatory are derived from the answers. What each answer resolves to,
and why: [`CONVENTIONS.md` §2](CONVENTIONS.md#2-tiers) and
[§9](CONVENTIONS.md#9-adopting-this); every field:
[`project.schema.md`](project.schema.md).

## Adopting it into a repo

**The default route: run `/handbook-sync` in an agent session inside the repo.**
It sees that nothing is adopted yet and drives adoption to the end — the
descriptor (through `colab adopt`), the labels, the `CLAUDE.md` block, CI from
the templates, and registration on this machine. Run later, the same skill
brings an adopted repo up to the current handbook without losing your local
edits.

By hand, the same steps (full checklist:
[`CONVENTIONS.md` §9](CONVENTIONS.md#9-adopting-this)):

1. `colab adopt` — answers the two gating questions and writes
   `.github/project.yml`. It stops there and prints the remaining steps.
2. `colab labels --ensure` — the convention labels do not exist by default. A
   check whose label was never created can never fire.
3. Paste [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md)
   into the repo's `CLAUDE.md` — this is how agents discover the conventions.
4. Make sure CI produces the two required outcomes: a secret scan and a build,
   with toolchain versions **resolved from the repo's own manifest**, never
   hardcoded. Copy a template from [`templates/`](templates/) if it helps.
5. `colab register` — puts the repo on this machine's fleet list, so the audit
   and the port allocator both know it.

`colab adopt` flags worth knowing:

- `--autonomy auto-trunk` — records the maintainer's grant that lets an agent
  finish the trunk merge through `colab ship` (never a release). Needs a human.
- `--land` — commits what this run wrote straight to trunk and pushes it, so
  the first feature branch is judged by the new rules. Needs a human
  (`COLAB_HUMAN=1` and `--answered-by`).
- `--fork` — the repo tracks an upstream you don't own (detected when a remote
  named `upstream` exists); the `CLAUDE.md` block is then appended, never
  restructured, and the upstream's own agent workflow is named.
- `--local` — you cannot commit to this repo at all; everything stays in your
  clone ([*Working in a repo you don't
  own*](CONVENTIONS.md#working-in-a-repo-you-dont-own)).

Pre-existing branches are **grandfathered**. Do not rename anything.

## Customising a skill for your repo

Want a skill to behave differently in one repo — Issue comments in Japanese, an
extra check before wrap? Do not fork the skill: a fork stops receiving handbook
updates. Write the difference in `.colab/skills/<skill>.md` (for example
`.colab/skills/code-wrap.md`), in plain prose. Every skill reads that file
before its own steps, and what it says wins over the skill's text for that repo.
It never loosens a `colab` gate: a refused claim or merge stays refused. Name
the step you are refining by its number (`code-ship` B1c, `code-sweep` §3): a
large skill is a short core plus reference files, and the core keeps every
step's number.

Claude Code loads the file into the skill automatically. Other engines get a
plain sentence in each skill telling the agent to read the file, which works
without any engine support. Because the file instructs agents, a change to it
is never treated as docs-only: it merges on `auto-trunk` or a human's go, like a
`CLAUDE.md` change. Rule:
[`CONVENTIONS.md` §8, *Local policy*](CONVENTIONS.md#local-policy--a-repo-refines-a-skill-without-forking-it-520).

## Optional automation on top

Nothing here assumes a dashboard, scheduler or bot exists. An adopter may still
build one: open sessions from a button, run the loop on a schedule, treat a
human's click on a merge button as the go that `code-ship` waits for, or push
notifications when work changes state. Such a tool reads the same shared
artefacts a person does — `.github/project.yml`, the labels, the claims on each
Issue, the machine-local `~/.colab/state.json` — and can receive `colab`'s
events at `notifyUrl` ([`tools/README.md`](tools/README.md#notifyurl--optional-event-push-off-by-default)).
It never changes a `colab` gate: the go before a merge and the grant before a
migration hold with or without it.

## Repo layout

| Path | What it is |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | The rules. Normative, the single source of truth (EN). |
| [`CLAUDE.md`](CLAUDE.md) | The entry point for AI agents — the operational distillation (EN). |
| [`project.schema.md`](project.schema.md) | Field reference for `.github/project.yml`. |
| [`templates/`](templates/) | **Copy-and-own** starting points: CI, release, git hooks (a secret scan and an identity scan), and the `CLAUDE.md` block for adopting repos. Nothing is called remotely — copy it, edit it, own it. |
| [`tools/`](tools/) | `colab` — a small CLI (optional): adopt a repo, claim issues, allocate ports, manage worktrees, and merge a finished branch to trunk when the repo grants it. JSON state, zero dependencies. Command reference: [`tools/README.md`](tools/README.md). |
| [`audit/`](audit/) | An external conformance checker. Reads all your repos — every owner, including local-only ones — and reports drift in a single run. Advisory only. `--identity` also scans public repository descriptions and topics, which no git hook can see. What each check means: [`audit/README.md`](audit/README.md). |
| [`skills/`](skills/) | The session flow — see [*Your first session*](#your-first-session). Installed as Claude Code skills by `install.sh`. |
| [`install.sh`](install.sh) | Sets up **your machine**: skills, the `colab` CLI, the pre-commit hook, the fleet list. Idempotent; `--dry` shows everything first. |

## Setting up a machine

Once per machine. Clone somewhere permanent — the skills are symlinks *into
this working tree*, so whatever it has checked out is the version every session
gets. `install.sh` checks its prerequisites before it changes anything, never
overwrites what it did not create, and `--dry` prints the plan first.

**Which version you get.** `main` runs ahead of the last final release, so the
first install from a fresh clone checks out the **newest final release tag**
(`vX.Y.Z`, never a release candidate) and installs from that — the same
default npm gives you. To follow `main` instead, unreleased work included, run
the first install with `--trunk`. Every run prints which one you are on.
Later moves are explicit:

- to a newer release: `./install.sh --release`;
- from a release back to `main`: `git checkout main && ./install.sh --trunk` (an
  older release's installer does not know `--trunk`, so check out `main` first).

A clone with uncommitted changes is never moved, and a re-run without either
flag keeps whatever is checked out.

| Flag | What it does |
|---|---|
| *(none)* | Symlink `skills/` into `~/.claude/skills/`, so they are available in every repo you open. |
| `--tools` | The `colab` CLI twice: a **symlink** at `~/.local/bin/colab` for your sessions (it prints the `PATH` line if needed), and a stamped **frozen copy** at `~/.colab/bin/colab` for always-on services. Also creates an empty `~/.colab/state.json` if there is none. |
| `--hooks` | Point this clone's git at `.githooks/`: a gitleaks secret scan and an identity scan whose vocabulary you keep outside every repo (see [`templates/README.md`](templates/README.md)). |
| `--fleet` | Seed `~/.colab/repos.txt` with format notes only, if absent. It stays machine-local because it names your private repos; `colab register` fills it. |
| `--all` | `--tools --hooks --fleet`. |
| `--notify-url <url>` | Seed `notifyUrl` in `~/.colab/config.json`, only if the key is absent. See [`tools/README.md`](tools/README.md#notifyurl--optional-event-push-off-by-default). |
| `--release` | Check this clone out at the newest final release tag, then install. The default for a first install from a fresh clone. |
| `--trunk` | Check out `main` and install it, unreleased work included — the clone's `@next`. |
| `--dry` | Print what would happen, change nothing. Combines with the flags above. |
| `--check` | **Read-only** health report on an earlier install — see below. Takes no other flag; exit 1 on any ✗ row. |

**Always-on services (launch agents, daemons, headless runners) must call
`~/.colab/bin/colab`, not the symlink**, because the symlink follows whatever
branch this clone has checked out. The frozen copy never moves on its own:
`colab update` says when it is behind a released CLI change, and re-running
`./install.sh --tools` refreshes it. Why it works this way:
[`tools/README.md`](tools/README.md#install).

**The CLI alone, without the skills,** is on npm as
**`@futurelastic/colab-handbook`**. No final release has been published to npm
yet, so the default `latest` tag holds only a placeholder; install from
**`@next`**, the release candidates: `npx @futurelastic/colab-handbook@next
<command>`, or `npm i -g @futurelastic/colab-handbook@next`. The command is
still `colab`. The skills are not in the package; they install from a
clone, because they must symlink into `~/.claude/skills/`.

### Checking an install

```sh
colab --version          # which colab answered — working tree, frozen copy or npm package — and its version
./install.sh --check     # read-only; exit 1 on any ✗ row
node audit/audit.mjs     # a conformance report across every registered repo
colab update             # stamped copies that fell behind, the frozen CLI included
```

`--check` reports whether the frozen copy is behind the latest release and
which commands it does not dispatch, whether the state file exists, whether
anything is registered, whether both pre-commit hooklets can run, and whether
`notifyUrl` is unset while a local observer declared an endpoint. ✗ means
something installed is stale or unusable; ⚠ means something was never set up,
which may be deliberate or just not done yet — so a correct fresh install, with
no repo registered and no identity vocabulary, reports ⚠ rows and exits 0. It
never refreshes anything. `--check` is not in v1.11.0 or earlier; on such a
release, follow `main` to get it.

## Why so little enforcement

Branch protection is not available on every plan and every owner a fleet spans,
so this handbook does not rely on it. It makes **compliance cheap and checking
cheap** instead: the audit reports drift, and the conventions explain *why*
each rule exists, so you can judge when breaking one is worth it. When you do,
fix the documentation in the same change — a document describing a repo that
does not exist is the worst thing in this business.

**A short list does block, deliberately:**

- **Publication.** The git hooks refuse a secret, and an identity scan stops a
  hostname, a home path or a customer's name reaching a public repo. History
  cannot be recalled once anything is cloned.
- **The gates around a merge**, enforced by `colab`: a human go before a merge
  (unless the repo granted `auto-trunk` or the change is docs-only), a grant
  before a migration ships, and a release never bundled into a merge.

Everything else is a default — one good way to do it — because being wrong
about a convention costs a conversation.

## License

[MIT License](LICENSE). Copy what is useful — that is what this repo is
for. The licence is the legal half of "copy-and-own": you may use, modify and
redistribute anything here, including in closed-source work, provided you keep
the notice. It also carries an express patent grant, and reserves the project's
trademarks.

Adopting a convention costs you nothing and grants us nothing. Nothing here
phones home, and there is no obligation to contribute anything back.
