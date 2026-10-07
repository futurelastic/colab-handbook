# Templates

Starting points you **copy into your own repo**. That is the entire model.

> **These are NOT called remotely.** There is no `uses: futurelastic/colab-handbook/...`
> anywhere, and nothing here is a reusable workflow another repo calls. (`dist-refs.yml` is a
> `workflow_call` workflow, but its caller is your own release workflow, in the same repo, via
> `uses: ./.github/workflows/dist-refs.yml` — the file still lives, in full, where it runs.) An earlier version of this
> handbook told repos to call shared workflows; that was reversed. Every workflow now
> lives, in full, inside the repo that runs it. You copy the file, you edit it, **you
> own it.** Divergence between your copy and this template is expected — a shared
> workflow that silently changes under a hundred repos is the failure mode we are
> avoiding.

## What each template is for

| File | Copy to | For | Notes |
|---|---|---|---|
| `ci-node.yml` | `.github/workflows/ci.yml` | Pure Node repos: Vite SPA, node libs, Astro static, **Capacitor apps** | Resolves Node version from `project.yml` → `.nvmrc`/`engines` → **fails**. Never a default. |
| `ci-laravel.yml` | `.github/workflows/ci.yml` | Laravel + Inertia + Vite fullstack (with route/type codegen) | Same resolution for **both** PHP and Node. Includes the sqlite bootstrap + explicit wayfinder step, and a `migrations` job that round-trips the schema (migrate → rollback → seed → migrate, schema compared) on the test engine **and** the deploy engine (a MariaDB/MySQL service container at production's version). Its data-dependent checks need `ROUNDTRIP_SEEDER` — see *Migration round-trip* below. |
| `ci-python.yml` | `.github/workflows/ci.yml` | Python: FastAPI/Flask services, CLIs, libraries | Resolves Python from `project.yml` → `.python-version`/`requires-python` → **fails**. `requirements.txt` does not count. **Hybrid** Python+Node repo: copy this, then paste `ci-node.yml`'s `build:` job alongside — see the template header. |
| `release-tag.yml` | `.github/workflows/release.yml` | Any repo cutting `v*.*.*` releases | Triggers on tag push. Publishes a grouped GitHub Release — a `-rc.N` tag as a pre-release, every summary since the previous *final* tag. No toolchain, no deploy; its header shows the `!v*.*.*-*` exclusion a deploy trigger needs. |
| `release-auto.yml` | `.github/workflows/release-auto.yml` | A repo whose release tags land on `main` (`trunk: main`, `deploy: tag` or `none`) and whose §6 release route cuts candidates | Runs `colab release cut --auto` after CI goes green on main and `colab release finalize --auto` daily — plus an hourly run that re-tries only a refused cut, once the fetched CLI has moved within `RETRY_WINDOW_MINUTES` or a run at main's head was cancelled (#547) — from a handbook ref (`HANDBOOK_REF` — the `stable` channel by default, `next` for the fast channel, or an exact tag to freeze; #445) — the handbook's own copy runs its checkout's CLI instead, since it ships the CLI it releases with (#428). **Publishes the Release in the same run** — a tag pushed with `GITHUB_TOKEN` triggers no other workflow, so `release-tag.yml` would never fire for it. A refusal is a warning, not a red run. Reads and creates tags, and fast-forwards the release channels `next` / `stable` (branches naming the newest candidate / final, #445); never pushes a commit. The audit recognises any workflow running `release cut/finalize --auto` and warns when the route leaves candidates off, when it tags without publishing while a tag-push workflow waits, or when it commits. |
| `dist-refs.yml` | `.github/workflows/dist-refs.yml` | A **private** repo shipping a **compiled** tool, installed as `npx github:<org>/<repo>#vX.Y.Z` ([CONVENTIONS §6, *Distribution*](../CONVENTIONS.md#distribution--one-install-surface-npx-442)) | `workflow_call`, called from the same run that cut the release tag (a tag pushed with `GITHUB_TOKEN` triggers nothing else). Takes one build artifact per `<os>-<arch>` and pushes each as an orphan commit at `refs/tags/dist/vX.Y.Z/<os>-<arch>` with a `SHA256SUMS`. Refuses a public or unreadable repository (a public compiled tool ships npm platform packages instead), a version that is not an existing tag, and a missing platform — before pushing any. Never moves a dist ref that exists. |
| `npx-launcher.mjs` | anywhere in-repo (e.g. `bin/launch.mjs`), named by the root `package.json`'s `bin` | Pairs with `dist-refs.yml` | Node ≥ 18, zero dependencies, needs `git`. Reads the `#vX.Y.Z` npx installed, fetches that one dist ref with the same URL and credentials npx cloned with, verifies `SHA256SUMS`, installs to a stable per-user path (`$XDG_DATA_HOME`/`%LOCALAPPDATA%`), and execs it; `--print-path` prints that path. A **channel** committish (`#stable`, `#next`, #465) is resolved to the release tag on the commit npx installed, then installed as that version; any other branch is refused. Also the library `npx-service.mjs` imports. `*.mjs`, so `colab template npx-launcher.mjs --dest <path>` copies it stamped, `--dest` required. One edit point: `BIN` (defaults to the package name without its scope). |
| `npx-service.mjs` | the same directory as your `npx-launcher.mjs` copy (e.g. `bin/service.mjs`), named by the root `package.json`'s `bin` | A tool that runs as a **per-machine service** (a dashboard, a daemon, a JS app a launch agent serves), installed with npx ([CONVENTIONS §6, *Services over npx*](../CONVENTIONS.md#services-over-npx--init-update-rollback-465)) | `npx github:<org>/<repo>#vX.Y.Z init [--auto-update 6h \| --no-auto-update]`, then `<tool> update [--check] [--version vX.Y.Z] [--channel next\|stable]`, `<tool> rollback`, `<tool> status`, `<tool> uninstall [--purge]` (#472: unit, timer, shim and every version go; config and state stay unless `--purge`); anything else runs the current version's payload. Versions side by side under `$XDG_DATA_HOME/<tool>/` with `current`/`previous` links the unit and the `~/.local/bin` shim go through; update installs beside, switches, restarts, health-checks, and **switches back** on failure. Config/secrets under `$XDG_CONFIG_HOME/<tool>/`, state and logs under `$XDG_STATE_HOME/<tool>/` — the unit carries their locations, never a value. launchd agent on macOS, systemd user unit on Linux, Windows refused; `<TOOL>_SERVICE_MANAGER=none` skips the manager. `--auto-update` (#471) adds a timer (launchd `StartInterval` agent / systemd user `.timer`) that runs the same `update`. Node ≥ 18, zero dependencies; needs `git`, `npm` for `update`, `tar` for `dist`. **Imports `./npx-launcher.mjs`** — copy both, or edit the import. Edit points: `KIND` (`binary` = a compiled tool from dist refs, `package` = a JS app run with node, `dist` = a prebuilt JS app unpacked from one verified tarball in the `dist/vX.Y.Z/any` ref, #470), `LABEL`, `SERVICE_ARGS`, `ENTRY`, `DIST_FILE`, `HEALTH_URL`, `KEEP`, `AUTO_UPDATE`, `VERBS`. The package's `files` must include both copies (and a `package` app's built output). `colab template npx-service.mjs --dest <path>`, `--dest` required. |
| `deploy-xserver.yml` | `.github/workflows/deploy-xserver.yml` | PHP-framework + Vite apps shipped to **shared hosting over SSH** (no root, no Docker): build on a runner, rsync, migrate on the server | Derived from three independently-written copies. Resolves Node the same way the CI templates do — all three hardcoded it, and one shipped on a different major than its CI built on. Migrates **production**; keeps a **mandatory** smoke test. Does **not** change your tier. |
| `deploy-container.yml` | `.github/workflows/deploy-container.yml` | A **container** app on a host whose platform has an API (Portainer today), `deploy: tag` ([CONVENTIONS §6, *A container deploy*](../CONVENTIONS.md#6-releases), #452) | One contract on every host: build each listed image **once** per final tag (`vX.Y.Z` + commit sha), run the pre-deploy hook, have the platform run exactly that tag (all images, one call), green only on a **verified running version** (stack settled, commit and container images checked, then `release.health-url` reporting `X.Y.Z`), roll back to the previous final on a failure after the platform accepted. **Two jobs (#460):** `publish` builds and pushes on **every** final, ungated — so a repo not yet cut over still gets each final's image in the registry; `deploy` `needs:` it, never builds (a missing image fails before the platform is touched), and is the one job you gate on "is the platform switched on". Images and build args sit in the workflow-level `env`, written once for both jobs. Triggers: a final tag push (route `deploy-tag`), `workflow_dispatch` with a tag (a manual deploy or rollback), and `workflow_call` — route `deploy-tag-fast` reaches it from `release-auto.yml`'s commented `deploy` job, like `dist-refs.yml` from its release run. Needs its two scripts below. One required secret: `PORTAINER_API_KEY`, a non-admin key owning only this app's stack; optional `HEALTH_AUTH_HEADER` (`Name: value`) or `HEALTH_BASIC_AUTH` (`user:password`) when the version URL sits behind auth — masked, never printed. **Every redeploy recreates the containers.** Does **not** change your exposure. |
| `deploy-container-run.mjs` | `.github/deploy/deploy-container-run.mjs` | Pairs with `deploy-container.yml` | The driver: builds, runs the hook, calls the adapter, verifies, rolls back, records. `--publish-only` = build and push only (no platform config, no version URL needed); `--deploy-only` = everything after, refusing a tag whose image is not in the registry. **Build args:** `DEPLOY_BUILD_ARGS`, one per line — `KEY=VALUE` for every image or `<image-ref> KEY=VALUE` for one; `${TAG}` (`vX.Y.Z`), `${VERSION}` (`X.Y.Z`) and `${SHA}` are filled in by the driver, so a static site can bake public config and its version into a served file. They end up in the image — public values only, never a secret. Node ≥ 18, zero dependencies; shells out to `git`, `docker`, `gh`. `colab template deploy-container-run.mjs --dest <path>`, `--dest` required, stamped on line 2. |
| `deploy-adapter-portainer.mjs` | `.github/deploy/deploy-adapter-portainer.mjs` — **beside** the driver, which loads `./deploy-adapter-<DEPLOY_ADAPTER>.mjs` | Pairs with `deploy-container.yml` | The Portainer adapter: git stacks redeploy `refs/tags/vX.Y.Z`, file stacks update with the compose file; the stack's **whole** `Env` is sent back with `IMAGE_TAG` replaced; 409 waited out and retried, any other error a hard failure (nothing changed). Another platform = another file exporting the same five names (`name`, `configFromEnv`, `snapshot`, `deploy`, `restore`). |
| `repo-CLAUDE-block.md` | *paste into* `CLAUDE.md` | Every adopting repo | The discovery hook — how an agent finds the handbook at all. |
| `gotchas-d-README.md` | `docs/gotchas.d/README.md` | Any repo starting a `docs/gotchas.d/` directory ([`code-wrap`](../skills/code-wrap/SKILL.md)'s A2 step) | Naming rule (`<issue>-<slug>.md`) and the don't-copy-back rule against an existing `docs/gotchas.md`. Optional — writing the first gotcha entry does not require copying this in first. |
| `adr-README.md` | `docs/adr/README.md` | Any repo starting a `docs/adr/` directory ([`code-wrap`](../skills/code-wrap/SKILL.md)'s A2 step) | Same issue-keyed naming rule as `gotchas-d-README.md`, applied to architecture decision records instead of gotchas — an existing sequentially-numbered `docs/adr/` is left as-is; only new decisions use `<issue>-<slug>.md`. Optional, same as above. |
| `docs-lint.mjs` | anywhere in-repo (e.g. `tools/docs-lint.mjs`) | Every repo — checks the STRUCTURE of the doc graph (router integrity, orphans, drafts-in-`docs/`, router size budget, dated files, §-citation resolution, `gotchas.d/` registry discipline, two-surface linkage) | Zero-dependency, plain Node — but it does **shell out to `git check-ignore`** once per enumeration, so that a git-ignored scratch file (your `.plans/` plan file, say) can never fail a structural check on your repo (#310). No git, or no repo, and it filters nothing and lints exactly as before. **Enumerated by `colab template` and DOES take an automatic version stamp** (colab-handbook #252): `colab template docs-lint.mjs --dest tools/docs-lint.mjs` copies it stamped on its **second** line (`// colab-handbook: docs-lint @ <version>`, after the `#!/usr/bin/env node` shebang — a bare `#` on any other line is a JS syntax error, unlike the YAML templates above) — `--dest` is required, since this file has no formulaic destination the way a workflow does. Pairs with `docs-lint.yml`. Also runs from `code-wrap`'s docs step and a weekly fleet sweep (colab-handbook #249) — this row is the third of its three seats. |
| `docs-lint.yml` | `.github/workflows/docs-lint.yml` | Every repo that copied `docs-lint.mjs` | Advisory job — `continue-on-error: true` on the lint step, so a finding never blocks a merge until a repo deliberately removes that line. Requires `docs-lint.mjs` to already be in the repo; does not vendor it. |
| `branch-name.yml` | `.github/workflows/branch-name.yml` | Opt-in — any repo that wants §4's branch shape checked on every PR | One step, no dependencies: the PR's head branch against CONVENTIONS.md §4's regex, both shapes (`<type>/<slug>-<N>` and the `<login>/<machine>/` prefixed one) passing as shipped. Once the repo declares `branchPrefix: machine`, delete the `?` after the regex's first group to require the prefix. The head ref reaches the script through `env:`, never interpolated — on a public repo it is attacker-chosen. |

### The `dedupe` job — why a claimed branch's first run skips the suite (#418)

All three CI templates open with a `dedupe` job. It runs only on the push that **creates** a
ref, which is what a session claim does: it pushes the new branch at trunk's head. It checks
nothing out, needs `permissions: actions: read`, and asks whether this same workflow already
has a green, non-pull-request run at this exact sha. If one exists, every other job is
skipped and the run still concludes `success`. If not, or if the check cannot run, the suite
runs as before. Every later push skips the guard, so real commits always get the full suite.
Two things to keep in a copy:

- **The guard calls `gh`.** GitHub-hosted images have it. On a self-hosted image without
  `gh`, the guard prints a notice and the suite runs, so nothing breaks, but nothing is saved
  either.
- **Every other job needs `!cancelled()` in its `if:`.** Without it, a job inherits the
  implicit `success()`, which reads every ancestor, `dedupe` included. A job that only needs
  `dedupe` indirectly would then be skipped on every ordinary push. That is why the Laravel
  `migrations` job checks `needs.build.result == 'success'` explicitly. Add the same pair of
  conditions to any job you add.

### The same job on trunk — why a squash merge's run skips the suite (#493)

The `dedupe` job also runs on every push to a trunk ref named in `concurrency` (`main`, `dev`).
There it asks a different question, because a squash merge lands a **new sha** whose **tree**
is byte-identical to the tree its branch run passed: does this workflow have a green `push` run,
on another ref of this repo, whose commit has this exact tree? It reads `.github/project.yml` at
the pushed sha and acts only when the ref is that file's `trunk:` and no `tree-reuse:` line is
present. It confirms the candidate's tree through the git object, then skips the suite and
leaves a `tree-already-green` notice naming the run. `colab ship` and `colab trunk-ci` read that
notice back and print the run they relied on. Three things to keep in a copy:

- **It needs `contents: read`** on top of `actions: read`, to read the descriptor and the
  commit objects.
- **The trunk refs in its `if:` mirror `concurrency`'s list.** On a repo whose trunk has another
  name, edit both. Until you do, the guard simply never fires on trunk — nothing breaks.
- **Never put a trunk-only job behind it.** Publish, deploy and release jobs must run whatever
  the guard says. Give them their own `if:` that does not read `needs.dedupe`.

Opt out with `tree-reuse: off` (`project.schema.md`) when trunk's run proves something a branch
run cannot: secrets only trunk gets, `github.ref`-conditional steps, unpinned runner images.

### Migration round-trip — what the Laravel job proves, and what it cannot

`ci-laravel.yml`'s `migrations` job runs every migration **twice per engine**: once from
zero, then — after rolling back the migrations the change adds and seeding rows at the
schema *before* the change — once more, the way a deploy lands new migrations on data
that predates them. The schema after both passes must match. Two things to know before
trusting a green run:

- **Both legs matter.** The engines disagree: a `NOT NULL` column added without a default
  fails on sqlite when rows exist, while MariaDB accepts it and silently writes `''` into
  every existing row. A deploy-engine leg at a version production does not run proves
  nothing about production — set the image to the exact version.
- **Without `ROUNDTRIP_SEEDER`, the data traps pass.** A foreign key over orphan rows,
  `->change()` dropping an unrestated `nullable`, lossy numeric conversion and the
  `NOT NULL` case all need rows to fire; on empty tables every one is green on both
  engines. The seeder runs against the pre-change schema, so it writes the way old data
  looks — raw `DB::table()` inserts into long-lived columns, not factories.

**Prisma.** No Prisma stack template exists here, so there is no Prisma job to add. The
round-trip does not translate directly anyway: Prisma Migrate has no down migrations. A
Prisma repo's nearest equivalent is applying its migrations to an empty deploy-engine
database (`prisma migrate deploy`) and then asserting no drift
(`prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code`) — worth a
template of its own once a Prisma stack is adopted.

### Hooks — the same model, copied by hand

These are `sh`, with no file extension at all, and their destination filename does not
match their source stem (`pre-push-guard` → `<hooks>/pre-push`) — so `colab template`
does not carry them, and they take **no version stamp**. The original reason a stamp
was impossible here — prepending a comment line above a `#!` shebang breaks it — is
fixed for `docs-lint.mjs` above (a second-line stamp, colab-handbook #252), but that fix
still needs a destination formula before it can apply to these too, and these three
files don't have one. Copy them with `cp`, `chmod +x`, and own them exactly as you own
a workflow.

| File | Copy to | For | Notes |
|---|---|---|---|
| `pre-push-guard` | `<hooks>/pre-push` | Every repo with a protected trunk | Refuses a raw push to trunk, a declared integration line, or `main` on a repo that promotes, and the release channels `next` / `stable`, which only `colab release cut` / `finalize` move (#445). Reads `project.yml`; missing descriptor → allows, with a warning. |
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

1. **Copy — use `colab template`.** It copies the template *and* stamps it with the
   current handbook version in one act, so the audit can later tell you when the
   source moved on:

   ```sh
   colab template                                   # list templates + handbook version
   colab template ci-node   --dest .github/workflows/ci.yml
   colab template release-tag --dest .github/workflows/release.yml
   colab template deploy-xserver --dest .github/workflows/deploy-xserver.yml
   colab template deploy-container --dest .github/workflows/deploy-container.yml
   colab template deploy-container-run.mjs     --dest .github/deploy/deploy-container-run.mjs
   colab template deploy-adapter-portainer.mjs --dest .github/deploy/deploy-adapter-portainer.mjs
   colab template docs-lint.mjs --dest tools/docs-lint.mjs   # --dest is required for this one
   ```

   The stamp is one comment line — `# colab-handbook: <name> @ <version>` — prepended
   at the top for a YAML copy. `docs-lint.mjs` opens with a `#!/usr/bin/env node`
   shebang, so its stamp lands on the **second** line instead, spelled `//` (a bare `#`
   anywhere but a shebang is a JS syntax error) — the shebang still has to stay first
   for the file to run. Do a plain `cp` only if you have no `colab` on PATH, and then
   add that stamp line by hand (an unstamped copy is untrackable — the audit will nag
   you to re-copy).
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

If you're the one editing a template *in this repo* and the change touches no rule at
all — a typo, a broken hyperlink, a comment — write `Rule-Neutral: yes` as a trailer on
that commit. Every adopter's drift finding for it then downgrades to a warn instead of a
hard fail, but only if **every** commit since their stamp declared it; a `ci-*` template
is never eligible, trailer or not. Full contract: [CONVENTIONS.md §8](../CONVENTIONS.md#8-conformance-and-reconciliation).

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
