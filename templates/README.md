# Templates

Starting points you **copy into your own repo**. That is the entire model.

> **These are NOT called remotely.** There is no `uses: godx-jp/colab-handbook/...`
> anywhere, and there is no reusable `workflow_call` here. An earlier version of this
> handbook told repos to call shared workflows; that was reversed. Every workflow now
> lives, in full, inside the repo that runs it. You copy the file, you edit it, **you
> own it.** Divergence between your copy and this template is expected — a shared
> workflow that silently changes under a hundred repos is the failure mode we are
> avoiding.

## What each template is for

| File | Copy to | For | Notes |
|---|---|---|---|
| `ci-node.yml` | `.github/workflows/ci.yml` | Pure Node repos: Vite SPA, node libs, Astro static, **Capacitor apps** | Resolves Node version from `project.yml` → `.nvmrc`/`engines` → **fails**. Never a default. |
| `ci-laravel.yml` | `.github/workflows/ci.yml` | Laravel + Inertia + Vite fullstack (with route/type codegen) | Same resolution for **both** PHP and Node. Includes the sqlite bootstrap + explicit wayfinder step. |
| `ci-python.yml` | `.github/workflows/ci.yml` | Python: FastAPI/Flask services, CLIs, libraries | Resolves Python from `project.yml` → `.python-version`/`requires-python` → **fails**. `requirements.txt` does not count. **Hybrid** Python+Node repo: copy this, then paste `ci-node.yml`'s `build:` job alongside — see the template header. |
| `release-tag.yml` | `.github/workflows/release.yml` | Any repo cutting `v*.*.*` releases | Triggers on tag push. Publishes a grouped GitHub Release. No toolchain, no deploy. |
| `deploy-xserver.yml` | `.github/workflows/deploy-xserver.yml` | PHP-framework + Vite apps shipped to **shared hosting over SSH** (no root, no Docker): build on a runner, rsync, migrate on the server | Derived from three independently-written copies. Resolves Node the same way the CI templates do — all three hardcoded it, and one shipped on a different major than its CI built on. Migrates **production**; keeps a **mandatory** smoke test. Does **not** change your tier. |
| `repo-CLAUDE-block.md` | *paste into* `CLAUDE.md` | Every adopting repo | The discovery hook — how an agent finds the handbook at all. |
| `gotchas-d-README.md` | `docs/gotchas.d/README.md` | Any repo starting a `docs/gotchas.d/` directory ([`code-wrap`](../skills/code-wrap/SKILL.md)'s A2 step) | Naming rule (`<issue>-<slug>.md`) and the don't-copy-back rule against an existing `docs/gotchas.md`. Optional — writing the first gotcha entry does not require copying this in first. |
| `adr-README.md` | `docs/adr/README.md` | Any repo starting a `docs/adr/` directory ([`code-wrap`](../skills/code-wrap/SKILL.md)'s A2 step) | Same issue-keyed naming rule as `gotchas-d-README.md`, applied to architecture decision records instead of gotchas — an existing sequentially-numbered `docs/adr/` is left as-is; only new decisions use `<issue>-<slug>.md`. Optional, same as above. |
| `docs-lint.mjs` | anywhere in-repo (e.g. `tools/docs-lint.mjs`) | Every repo — checks the STRUCTURE of the doc graph (router integrity, orphans, drafts-in-`docs/`, router size budget, dated files, §-citation resolution, `gotchas.d/` registry discipline, two-surface linkage) | Zero-dependency, plain Node. **Not enumerated by `colab template`** (it lists `*.yml` only) and **takes no automatic version stamp**, same reasoning as the `sh` hooks below — copy it by hand and re-copy by hand when this template changes. Pairs with `docs-lint.yml`. Also runs from `code-wrap`'s docs step and a weekly fleet sweep (colab-handbook #249) — this row is the third of its three seats. |
| `docs-lint.yml` | `.github/workflows/docs-lint.yml` | Every repo that copied `docs-lint.mjs` | Advisory job — `continue-on-error: true` on the lint step, so a finding never blocks a merge until a repo deliberately removes that line. Requires `docs-lint.mjs` to already be in the repo; does not vendor it. |

### Hooks — the same model, copied by hand

These are `sh`, not YAML, so `colab template` does not carry them (it enumerates
`*.yml` only) and they take **no version stamp**: a stamp is a comment line prepended
to a file, and prepending anything above a `#!` shebang breaks it. Copy them with `cp`,
`chmod +x`, and own them exactly as you own a workflow.

| File | Copy to | For | Notes |
|---|---|---|---|
| `pre-push-guard` | `<hooks>/pre-push` | Every repo with a protected trunk | Refuses a raw push to trunk, a declared integration line, or `main` on a repo that promotes. Reads `project.yml`; missing descriptor → allows, with a warning. |
| `pre-commit-dispatch` | `<hooks>/pre-commit` | Any repo that needs **more than one** pre-commit check | Runs every hooklet in `pre-commit.d/`, fails if any failed, and **refuses when there is nothing to run**. Read its header before installing — it replaces a hook you already have, and step 2 of its instructions is where your existing check survives. |
| `pre-commit-identity` | `<hooks>/pre-commit.d/20-identity` | Any repo that could publish an identity — every public one, and any private one that may ever be opened | Scans staged content against a vocabulary the operator supplies **by path**. Also installs as `commit-msg`. |
| `identity-vocabulary.example` | *outside every repo* — e.g. `~/.colab/identity-vocabulary` | The above | Invented entries. **A real one is never committed anywhere**, which is the whole reason the scanner takes a path instead of shipping a list. |

`<hooks>` is `git config core.hooksPath` if you set one, else `.git/hooks`. The
executable bit is per-clone for anything git does not track, so ship a one-line install
script that chmods — put it **inside `<hooks>` itself** (this repo's
`.githooks/install.sh` is the pattern), not in a top-level `scripts/` dir. It is
never invoked as a hook (git only ever runs the exact hook filenames it knows —
`pre-commit`, `pre-push`, etc. — never every file in the directory), and
colocating it with what it installs means a repo whose only "script" is this
one installer does not end up with a whole `scripts/` folder for a single
506-byte file. An earlier version of this handbook shipped the pattern at
`scripts/install-hooks.sh`; that scaffolded a bare one-file `scripts/`
directory into ~45 repos and was wrong — fixed 2026-08-20.

## How to adopt

1. **Copy — use `colab template`.** It copies the template *and* prepends a version
   stamp in one act, so the audit can later tell you when the source moved on:

   ```sh
   colab template                                   # list templates + handbook version
   colab template ci-node   --dest .github/workflows/ci.yml
   colab template release-tag --dest .github/workflows/release.yml
   colab template deploy-xserver --dest .github/workflows/deploy-xserver.yml
   ```

   The stamp is one prepended line — `# colab-handbook: <name> @ <version>`. Do a plain
   `cp` only if you have no `colab` on PATH, and then add that stamp line by hand
   (an unstamped copy is untrackable — the audit will nag you to re-copy).
2. **Walk the `# EDIT:` markers.** Each one is a decision only your repo can make:
   which branches exist, self-hosted runner or not, the build command, working
   directory.
3. **Declare your toolchain.** The CI templates refuse to guess a version. Put it in
   `.github/project.yml` (`node: "22"`, `php: "8.4"`, `python: "3.13"`), or rely on
   `.nvmrc` / `package.json engines.node` / `composer.json require.php` /
   `.python-version` / `pyproject.toml requires-python`. If none of these exists,
   CI fails on purpose with a message telling you to declare it. Note that
   `requirements.txt` is **not** one of these — it pins dependencies, not the interpreter.
4. **Add `.github/project.yml`** if you have not — copy the reference at the handbook's
   own `.github/project.yml`. The audit tool and the CI resolution step both read it.
5. **Paste the CLAUDE block** (`repo-CLAUDE-block.md`) so the next agent in the repo can
   find its way back here. Set its `<!-- colab-handbook @ <version> -->` stamp to the
   handbook version you adopted at.
6. **Own it.** From this point the file is yours. Edit freely; nothing overwrites it.

### Adopting a guard in an existing repo — why this is a template at all

**A guard delivered by scaffolding reaches only repos created after it shipped.** We have
measured that: one existed for months and covered a small minority of repositories, while
every older one — public ones included — had `core.hooksPath` set, a hooks directory
present, and no such check in it. Nothing was broken and nothing reported anything. The
repo *looked* configured, which is worse than an obviously empty one, because the state
that makes you go and look never arises.

Templates are copied into repositories that **already exist**. That is the mechanism that
actually propagates here, and it is why a guard belongs in this directory rather than in a
scaffold. A scaffold answers "what does a new repo start with"; a template answers "what
can any repo adopt today". A control that only the newest repos have is not a control.

So, into a repo that already has a `pre-commit` hook — the normal case, since a secret
scan is the one guard almost everything already carries:

```sh
mkdir -p <hooks>/pre-commit.d
git mv <hooks>/pre-commit <hooks>/pre-commit.d/10-secrets   # your existing check, unchanged
cp templates/pre-commit-dispatch <hooks>/pre-commit
cp templates/pre-commit-identity <hooks>/pre-commit.d/20-identity
chmod +x <hooks>/pre-commit <hooks>/pre-commit.d/*
cp templates/identity-vocabulary.example ~/.colab/identity-vocabulary   # then EDIT it, outside any repo
```

Four things to know before you do it:

1. **Your existing check is moved, never replaced.** The dispatcher sequences checks; it
   has no opinion about them. Step 2 above is load-bearing — skip it and you have swapped
   a working secret scan for a dispatcher with nothing to dispatch (which refuses to
   commit, so you will find out immediately, but you will have to go and get it back).
2. **Do not simply append the identity scan to your existing hook.** The usual secret-scan
   hook exits early when its scanner is not installed, and everything below that line is
   skipped with it — on exactly the machine that is already least protected. The
   dispatcher's header carries the full argument.
3. **The vocabulary is not ours to ship and not yours to commit.** Without one the scan
   warns on every commit and passes; that is a deliberate no-op, not a silent one.
4. **Verify by committing something you expect it to catch**, once. A guard nobody has ever
   seen fire is indistinguishable from one that is not installed — which is the failure
   this whole section is about.

Repository *metadata* — description, topics, homepage, the name — never passes through git,
so no hook can see any of it, and it is the first thing a visitor reads. That half is a
periodic sweep instead: `node audit.mjs --identity`, documented in
[`audit/README.md`](../audit/README.md). Same vocabulary, same path, same refusal to run
without one.

### Adopting the deploy template — the extra steps

A deploy workflow is the only template that can break something that is already
live, so it carries obligations the CI ones do not:

1. **Do the one-time server preparation first.** It is a checklist in the
   template header — subdomain, certificate, database, the server-side `.env`, the
   deploy key in `authorized_keys`. None of it is automated and the first deploy
   fails without it. Copy that checklist into the repo's runbook rather than
   leaving it in a workflow comment.
2. **Fill the `env:` block, and nothing below it.** Every per-repo value — host,
   user, paths, the server's PHP binary, the smoke URL — lives in that one block
   precisely so your diff against this template stays readable. Editing step
   bodies instead is how the three ancestors of this file drifted ~120 lines apart.
3. **Add the secret, one per repo.** `DEPLOY_SSH_KEY`, never shared between repos
   even when they deploy into the same hosting account: a shared key cannot be
   rotated for one of them, and a leak from any reaches all.
4. **Make `project.yml` true.** A tag deploys only where `deploy: tag` is
   declared. **This does not change your tier** — tier says whether production
   exists and how many gates guard it, and it moves only by the [§9](../CONVENTIONS.md#9-adopting-this) checklist. If
   the repo was `deploy: manual`, switching it now is a deliberate edit (and drop
   the `runbook:` that is no longer the mechanism). Adopting this into a Tier B
   repo is not an adoption at all: it is giving the repo a production, which is a
   different decision.
5. **Keep the smoke test.** It is the only step that distinguishes "the workflow
   went green" from "the site answers", and a deploy can do the first while
   failing the second.
6. **Retro-fitting an existing hand-written deploy workflow is a per-repo job, by
   hand.** Those files have local edits — extra artisan commands, app-specific
   backfills — that a blind overwrite destroys. `colab update` will classify such
   a file as `unrelated` (its name matches this template, its content never came
   from here) and refuse to touch it. That is correct: diff the two yourself and
   move across only what you mean to.

## Reconciliation — how you find out when a template changes

Because you own your copy, nothing pushes updates to you. Instead the copy is
**stamped** with the handbook version it came from, and `audit/audit.mjs` compares that
stamp against the handbook's git history. When a template you copied has changed since
your stamp, the audit flags it: review the diff, take what you want, and re-run
`colab template … --force` to re-stamp. That is the whole loop — no remote calls, no
silent updates, just an honest report that you are behind.

## Keeping honest

`audit/audit.mjs` in this handbook sweeps many repos and reports when a `project.yml`
is missing or incoherent, when a declared toolchain disagrees with what CI actually
pins, when branch names drift, and when a stamped copy has fallen behind its template.
It is advisory — run it locally or on a schedule. It is **not** wired into any repo's CI.

## Runner policy

Decided 2026-07-19, after a GitHub Actions billing lock stopped every
`ubuntu-latest` job org-wide while self-hosted runners kept working:

| Repo class | `runs-on` | Why |
|---|---|---|
| **Public** repo | `ubuntu-latest` | Free minutes, unaffected by billing — and **never** self-hosted: a fork PR would execute arbitrary code on your runner. |
| **Private** CI | the org's `[self-hosted, ...]` runner **where one exists**; `ubuntu-latest` otherwise | Immune to billing, persistent tool caches, local network. Runners are registered per-org — one org's runner serves nothing in another org. Register a runner for an org when its billing or scale makes it worth it, not preemptively. |
| **Private** deploy | its own runner label | Deploys must never queue behind CI jobs. |

Self-hosted job hygiene: no `sudo`, install tools into `$RUNNER_TEMP`, never
write outside the workspace, prefer the runner's native toolchains. A shared
runner is infrastructure, not a throwaway VM.

### Self-hosted patterns that earn their place

- **Split a test matrix by purpose.** The leg matching production is the release
  gate → self-hosted (immune to billing/outage). Forward-compat legs (next PHP,
  next Node) are reconnaissance → keep them on hosted runners with
  `continue-on-error: true`. Losing an advisory signal during an outage is fine;
  losing the gate is not.
- **Service containers on a shared runner: never fix the host port.** The runner
  machine likely runs its own database on the default port. Publish the container
  port unmapped (`- 3306`) and read the randomly assigned host port from the job's
  service context (`job.services.mysql.ports['3306']`), threading it through your
  env. A fixed `3306:3306` works exactly until the first job lands on a runner
  that already listens there.
