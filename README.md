***English*** · [Tiếng Việt](README.vi.md)

# colab-handbook

A small set of conventions and tools for running many repos — many coding
sessions in parallel, humans and AI agents alike — without stepping on each
other.

**If you are an AI agent, stop here and read [`CLAUDE.md`](CLAUDE.md).**
This file is for humans.

*(The normative document — [`CONVENTIONS.md`](CONVENTIONS.md) — is written in
English so agents and tooling can read it. This is the English front door; the
Vietnamese one is [`README.vi.md`](README.vi.md). Both are only gateways, not
normative — when the two disagree, **both are wrong** until they agree with
`CONVENTIONS.md` again.)*

## What this is

A **handbook, not a framework**. It decides **outcomes** — where code merges,
what a release is, how you announce "I am working on this" — and deliberately
leaves the **implementation** (your Node version, your test runner, your CI
file) to each repo.

Everything here was distilled from running ~25 real repos, several of them
production apps maintained almost entirely by AI agents working in parallel
across many worktrees. The anti-pattern list is not theory: every entry is
something that actually happened, with the scar to prove it.

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

It makes each repo answer a handful of questions about itself, **once**, in a
file every session reads before touching anything — is there production today,
who else works here, what breaks if a merge is wrong, how many units of work run
at a time, how a commit reaches the thing that runs it.

Everything else follows from those answers: which branch to merge into, what a
release even means here, whether a branch is required at all, how much a session
must write down before it stops. A session never guesses, and two repos never
disagree about what a word means.

The rest of the repo exists to serve that: a CLI that performs the mechanical
parts, an audit that reports where reality has drifted from what a repo claims,
and portable session flows so a coding session opens and closes the same way
everywhere.

### What it is not

- **Not a service.** Nothing here is a dependency and nothing phones home. You
  copy what is useful and own the copy — fork it, edit it, delete half of it.
  That is what the licence is for.
- **Not a CI system, and not an opinion about your stack.** Bring your own
  language, test runner and pipeline. The handbook only asks that the pipeline
  produce two outcomes, and never says how.
- **Not an enforcement layer**, with one deliberate exception. Conformance is
  advisory, because being wrong about a convention costs a conversation.
  Publication blocks, because history cannot be recalled once anything is
  cloned.
- **Not a maturity model.** No answer here ranks a repo above another. A repo
  with no production is not a worse repo; it is a repo with fewer gates.

If you run one repo alone, read the anti-patterns and take what is useful. If
you run many — or you work alongside agents that never met the person who set
the rules — the whole thing is likely to pay for itself faster than it takes to
read.

## The questions

Adopting this means answering five questions about your repo, once, into
`.github/project.yml` — so no session has to guess, and no two repos disagree
on what a word means:

1. **Does a deploy target exist today** — and how is it reached: a tag gates
   production, the promotion itself deploys, a human runs a runbook, or
   nothing is live yet?
2. **Who else works here** — one person, a team, or the public?
3. **What would break if you merged something wrong here** — nothing, only
   the people already in the room, users via the next promotion, or users and
   adopters via a released artifact?
4. **One unit of work in flight at a time, or several at once?**
5. **By what path does a commit reach the thing that runs it** — a CI
   workflow, a git hook, a documented procedure, a live checkout, a published
   artifact, another system's data, or none of those yet?

The answers decide everything that follows: which branch a session merges
into, what a release is, how much an Issue narrates, what must exist before a
merge can be undone, whether a branch is even required. Nothing here is asked
twice, and nothing is asked that the repo already states for itself — its
default branch, its toolchain, its ports.

Issues are **claimed** with an assignee plus the `in-progress` label before
work starts, so parallel sessions never collide on the same task.

The full rules — what each answer resolves to, and why:
[`CONVENTIONS.md`](CONVENTIONS.md). ~15 minutes to read, and the **single
normative file** — everything else in the repo serves it.

## Repo layout

| Path | What it is |
|---|---|
| [`CONVENTIONS.md`](CONVENTIONS.md) | The rules. Normative, the single source of truth (EN). |
| [`CLAUDE.md`](CLAUDE.md) | The entry point for AI agents — the operational distillation (EN). |
| [`project.schema.md`](project.schema.md) | Field reference for `.github/project.yml`. |
| [`templates/`](templates/) | **Copy-and-own** starting points: CI, release, git hooks (a secret scan and an identity scan), and the `CLAUDE.md` block for adopting repos. **Nothing is called remotely** — copy it, edit it, own it. Templates, not scaffolding, because scaffolding only reaches repos created after it shipped. |
| [`tools/`](tools/) | `colab` — a small CLI (optional): adopt a repo, claim issues, allocate ports, manage worktrees, and merge a finished branch to trunk when the repo grants it. JSON state, zero dependencies. Full command reference: [`tools/README.md`](tools/README.md). |
| [`audit/`](audit/) | An external conformance checker. Reads all your repos — every owner, including local-only ones — and reports drift in a single run. Advisory only, never blocking. `--identity` additionally scans public repository descriptions and topics, which no git hook can see. What each check means: [`audit/README.md`](audit/README.md). |
| [`skills/`](skills/) | Portable session flow: `code-triage` (pick the next task, flagging hard ones for a plan) → `code-start` (open a session; runs `code-plan` when flagged) → `code-wrap` (distill + gate + hand off) → `code-ship` (grade + merge, human-authorized), plus `code-sweep` (clear out everything ALREADY DONE in one repo — or just a named set of issues or one session — running `code-wrap`+`code-ship` on each) and `handbook-sync` (bring ONE repo up to the latest handbook, run from inside it). Installed as Claude Code skills by [`install.sh`](install.sh) — see *Setting up a machine* below. |
| [`install.sh`](install.sh) | Sets up **your machine**: skills, the `colab` CLI, the pre-commit hook, the fleet list. Idempotent, and `--dry` shows you everything first. |

## Setting up a machine

Once per machine, before you adopt anything into a repo.

**You need:** `git`; `node` ≥ 18 (`.nvmrc` pins 22, which is what CI here runs);
`gh` **logged in** (`gh auth login`) — claims, the skills and the audit's remote
targets are all useless without it, and the failure surfaces much later as
something confusing; and `gitleaks` only if you want the pre-commit hook.
`install.sh` checks every one of these and reports what is missing before it
changes anything.

**1. Clone it somewhere permanent** — with the rest of your code, not in a
scratch directory.

```sh
git clone https://github.com/futurelastic/colab-handbook.git ~/code/colab-handbook
cd ~/code/colab-handbook
```

**This clone is infrastructure, not a download.** The skills install as symlinks
*into this working tree*: delete the clone and every session on the machine
loses them, and whichever branch it has checked out is the version of the skills
every session gets. So keep it on `main` unless you are actively working on the
handbook itself. `install.sh` warns if it finds itself under `/tmp`,
`~/Downloads` or `~/Desktop`.

**2. Install.**

```sh
./install.sh --all --dry   # see exactly what would happen; changes nothing
./install.sh --all         # skills + colab CLI + pre-commit hook + fleet list
```

`--all` is the recommended first run. Everything it does is a symlink or a copy,
it is idempotent, and it never overwrites anything it did not create — your own
skill, or an existing `~/.colab/repos.txt`, is left alone with a warning. Bare
`./install.sh` installs the skills and nothing else, if that is genuinely all
you want.

| Flag | What it does |
|---|---|
| *(none)* | Symlink `skills/` into `~/.claude/skills/`, so they are available in every repo you open. |
| `--tools` | Two installs of one CLI: a **symlink** at `~/.local/bin/colab` for your sessions (checking that directory is really on your `PATH`, and printing the exact line to add if not), plus a stamped **frozen copy** at `~/.colab/bin/colab` for always-on services — see below. |
| `--hooks` | Point this clone's git at `.githooks/`, whose `pre-commit` runs every check in `pre-commit.d/` — a gitleaks secret scan, and an identity scan that needs a vocabulary you supply by path and keep outside every repo (see [`templates/README.md`](templates/README.md)). `core.hooksPath` lives in `.git/config`, so it is per-clone, per-machine, and never travels with the repo. |
| `--fleet` | Seed `~/.colab/repos.txt` from `audit/repos.txt`, only if it is absent. That list stays machine-local on purpose: it names your private repos, and this repo is public. |
| `--all` | `--tools --hooks --fleet`. |
| `--dry` | Print what would happen, change nothing. Combines with all of the above. |

**Always-on services must call `~/.colab/bin/colab`.** The symlinked CLI follows
whatever branch this clone has checked out — deliberate for a human session, and
wrong for anything that outlives one. A daemon, a launch agent or a headless
runner started months ago would silently change behaviour because somebody
checked out an unrelated branch, and nothing would report it: the process keeps
working, differently. So `--tools` also writes a **copy** to `~/.colab/bin/`
(honouring `COLAB_HOME`), stamped with the handbook version it was taken from —
or, when that tree sits ahead of the last tag, with the commit it was taken from
(`v1.7.0-2-gc8436c6`) and a warning, because no released version describes those
bytes. That copy never moves on its own.

Refreshing it is therefore an act, never a side effect: re-run `./install.sh
--tools`. `colab update` tells you when it is due. **`behind` means a released
CLI change exists that this machine lacks** — the comparison runs to the latest
tag, so a release that changed no CLI code does not nag you, and unreleased work
in your own checkout does not either. (That last part is why the bound is the tag
rather than `HEAD`: measuring to `HEAD` marked every machine stale for the whole
window between a CLI commit and the next tag, and the advertised remedy copies
*from* that same working tree — so on a machine developing the handbook it
advised services to adopt untagged code.) It never rewrites the copy, not even
with `--apply`: that is the toolchain your running services are executing.
`colab --version` says which of the two you are talking to.

**3. Verify, and point the audit at your repos.**

```sh
colab --help                 # not found? fix your PATH — step 2 prints the exact line
colab --version              # which colab is this: the working tree, or the frozen copy?
$EDITOR ~/.colab/repos.txt   # replace the examples with your own repos
node audit/audit.mjs         # a conformance report across the whole fleet
colab update                 # stamped copies that fell behind — the frozen CLI included
```

Then read [`CONVENTIONS.md`](CONVENTIONS.md): ~15 minutes, and the only
normative file here.

## Adopting it into a repo

The short version — the full checklist is
[`CONVENTIONS.md` §9](CONVENTIONS.md#9-adopting-this):

1. Answer question 1 honestly (is there production **today**, not "soon").
2. Add `.github/project.yml`. `colab adopt` asks the five questions and writes
   the file for you — it stops at the descriptor and prints the rest of this
   list, because the remaining steps are not its to take.
3. `colab labels --ensure` — the convention labels do not exist by default, and
   there are more than one. A check whose label was never created can never
   fire.
4. Paste [`templates/repo-CLAUDE-block.md`](templates/repo-CLAUDE-block.md)
   into the repo's `CLAUDE.md` — this is the only way agents discover these
   conventions.
5. Make sure CI produces the two required outcomes: a secret scan and a build,
   with toolchain versions **resolved from the repo's own manifest** — never
   hardcoded. Copy a template if it helps.

Pre-existing branches are **grandfathered**. Do not rename anything.

## Why so little enforcement

Our private repos sit on a GitHub plan without branch protection — pushes to
`main` cannot be forbidden. So this handbook does not pretend to enforce; it
makes **compliance cheap and checking cheap**. The audit tool reports drift; the
conventions explain *why* each rule exists, so you can judge for yourself when
breaking one is worth it. When you do break one, fix the documentation in the
same PR — a document describing a repo that does not exist is the worst thing in
this business.

**Two things do block, and the line between them is deliberate.** The git hooks
refuse: a secret scan, and an identity scan that stops a hostname, a home path
or a customer's name reaching a public repo. Those guard **publication**, which
is the one mistake that cannot be undone — history cannot be recalled once
anything is cloned. Everything about *conformance* stays advisory, because being
wrong about a convention costs a conversation, and being wrong about publication
costs forever.

## License

[MIT License](LICENSE). Copy what is useful — that is what this repo is
for. The licence is the legal half of "copy-and-own": you may use, modify and
redistribute anything here, including in closed-source work, provided you keep
the notice. It also carries an express patent grant, and reserves the project's
trademarks.

Adopting a convention costs you nothing and grants us nothing. Nothing here
phones home, and there is no obligation to contribute anything back.
