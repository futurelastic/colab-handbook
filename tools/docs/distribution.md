# Distribution — one install surface, and services over npx

How a released version reaches the people who install it. Both sections moved verbatim from
CONVENTIONS.md §6 by #637 — only links were retargeted — and each keeps its heading there as a stub
holding the rule. What lives in this directory, and why: [README](README.md).

## Distribution — one install surface: npx (#442)

The rule: [CONVENTIONS.md, *Distribution*](../../CONVENTIONS.md#distribution--one-install-surface-npx-442).

The release route decides *when* a version exists (the rung above); this decides *how anyone
installs it*. **Every distributed tool installs with `npx`**, so installing looks the same
everywhere and no user needs the `gh` CLI or a token. **GitHub Releases are not an install
path** — a Release carries the summary, never the bits a user runs (owner ruling, 2026-10-02).

| Repository | Install command | Where compiled binaries come from |
|---|---|---|
| public, JS | `npx @<org>/<pkg>` | (none) |
| public, compiled | `npx @<org>/<pkg>` | per-platform npm packages (`optionalDependencies`, each with `os`/`cpu`) — no `postinstall` download |
| private, JS | `npx github:<org>/<repo>#vX.Y.Z` | (none — built by `prepare` if it needs building) |
| private, compiled | `npx github:<org>/<repo>#vX.Y.Z` | **dist refs** in the same repo (below) |

A private repo never reaches public npm — `@<org>` there is always public (#432, above) — so
both private rows install from git, where repository read access is the access control.

**Dist refs — how a private compiled tool ships its binaries.** The release run builds every
platform and pushes one **orphan** commit per platform to `refs/tags/dist/vX.Y.Z/<os>-<arch>`,
holding just that platform's binary and a `SHA256SUMS` over it. `<os>-<arch>` is Node's
`process.platform`-`process.arch` (`darwin-arm64`, `linux-x64`, `win32-x64`), the names npm's
`os`/`cpu` use. The commits have no parent, so they never touch trunk history. The repo's root
`package.json` (`"private": true`) carries a small launcher as its `bin`. At `#vX.Y.Z`, the
launcher fetches exactly one ref, `git fetch --depth 1 --no-tags <origin> refs/tags/dist/vX.Y.Z/<os>-<arch>`,
**with the same git and the same URL npx just cloned from** — so with the same credentials —
verifies the checksum, copies the binary to a stable per-user path, and execs it. Repository read
access is the only lock, exactly as for the source. Both halves are templates:
[`templates/dist-refs.yml`](../../templates/dist-refs.yml) (a `workflow_call` workflow the repo's own
release workflow calls; it refuses a public or unreadable repository, a version that is not a
tag, and a platform without its binary, and never moves a dist ref that exists) and
[`templates/npx-launcher.mjs`](../../templates/npx-launcher.mjs) (Node ≥ 18, zero dependencies).

- **The launcher installs the release npx was asked for.** It reads the `#vX.Y.Z` committish from
  the installing project's own record of the package, not from the manifest. Where no record exists (a global install), the manifest version is the fallback; an
  environment variable overrides both; with none of them it refuses rather than guessing.
- **The checksum proves the bytes, not the publisher.** `SHA256SUMS` lives in the same ref as the
  binary, so it catches a truncated or corrupted fetch. The trust anchor is write access to the
  repository, as it is for the source npx just ran.
- **A dist ref is a tag, and a full clone pays for it.** Contributors who mind clone with
  `--no-tags`. npm's own tag-to-version parsing ignores dist refs (`v0.4.0-rc.1/darwin-x64` is not
  a valid version), so a `#semver:` install range is unaffected. Why: [ADR 539](../../docs/adr/539-releases-distribution-rationale.md).

**Rules that apply to every row:**

- **Publish or push in the same run as the release cut.**
- **Trusted publishing (OIDC) for npm, never a token** — the npm job's first rule, above.
- **A long-running tool never runs from npx's cache.** A tool that runs as a service installs, updates and rolls back through the contract in
  [*Services over npx*](#services-over-npx--init-update-rollback-465), below.

The audit reports a **private** repository whose workflows upload GitHub Release assets
(`gh release upload`, `gh release create <tag> <files>`, a release action given `files:`) as
**advisory** (`warn`): an asset can be a legitimate by-product — an SBOM, a checksum list — so it is
never a failure, but an asset that is the install path asks every user for `gh`.

A repository that **declares** it distributes a tool — `distribution: js` or `distribution:
compiled` in `project.yml` ([schema](../../project.schema.md#distribution--optional)) — is checked for
its row's install route: a publish step plus a non-private `bin` (public JS; per-platform
`optionalDependencies` too when compiled), a root `bin` (private JS), or a root `bin` plus a
workflow calling a dist-refs workflow (private compiled). A missing route is **advisory** (`warn`). An undeclared
repository is never checked (#469).

## Services over npx — init, update, rollback (#465)

The rule: [CONVENTIONS.md, *Services over npx*](../../CONVENTIONS.md#services-over-npx--init-update-rollback-465).

A tool that runs as a **per-machine service** — a dashboard, a daemon, a JS app a launch agent
serves — installs with npx like every other tool, but never *runs* from npx. It owns three verbs
(plus `status` and `uninstall`),
and adopters implement them with [`templates/npx-service.mjs`](../../templates/npx-service.mjs), which
uses its sibling [`templates/npx-launcher.mjs`](../../templates/npx-launcher.mjs) as a library:

```sh
npx github:<org>/<repo>#vX.Y.Z init [--channel next|stable]   # first install, or repair
<tool> update [--check] [--version vX.Y.Z] [--channel next|stable]
<tool> rollback
<tool> uninstall [--purge]
```

- **`init`** installs the version npx was asked for under a stable per-user path, writes a small
  shim on the user's `PATH`, (re)writes the service unit, loads it and checks its health. It is
  also the repair command: re-running it rewrites the shim and the unit.
- **`update`** resolves its target, installs it **beside** the running version, switches to it,
  restarts the service and checks its health. **A failed health check switches back** — the
  previous version restarted, exit 1 — so an update either lands healthy or changes nothing that
  serves. A failed fetch or build happens before the switch, so it changes nothing at all.
  `--check` reports what an update would do and writes nothing.
- **`rollback`** switches to the previous version through the same health-checked switch; run it
  twice and it toggles.
- **`uninstall`** (#472) unloads the service (and its update timer), deletes the unit files, the
  shim and the whole data directory — every installed version. The config and state directories
  stay, so a later `init` finds the same config; `--purge` deletes them too. It removes only a shim
  the template wrote.

**Versions sit side by side; links decide which one runs.** Each version is installed into its
own directory under the user's data directory (`$XDG_DATA_HOME/<tool>/vX.Y.Z/`, also on macOS —
a path without spaces belongs in a unit file), and two links name the running and the previous
version. The service unit and the shim point **through** the `current` link, so an update or a
rollback is one atomic rename and the unit is never rewritten for it. A few versions are kept;
the running and previous ones are never pruned. A service unit pointing into npx's cache, or into
a checkout, is the failure this rule exists to prevent.

**Following a channel.** A channel ([*Release channels*](../../CONVENTIONS.md#6-releases), #445) is a branch, and dist
refs and install directories are keyed by version — so a channel is **resolved to a version, never
installed as one**. `update` asks the origin, with the same git and the same URL npx used (so the
same credentials), for the channel branch's tip and the release tags on that commit: `stable`
takes the highest **final** there, `next` the highest release tag there (a final outranks its own
candidates on the same commit). That exact `vX.Y.Z` is then installed. **A tip with no release
tag refuses** — it is never guessed. `init` records the channel to follow (default `stable`);
`update --channel` changes it; `update --version vX.Y.Z` **pins**, and later `update`s report
"pinned" until a channel is chosen again — the same three choices a workflow's `HANDBOOK_REF`
offers. Following automatically is a timer that runs the same `update`, never a second mechanism:
`init --auto-update 6h` (#471) writes one beside the service — a second launchd agent with
`StartInterval`, or a systemd user `oneshot` service plus `.timer` — whose command is literally
`<tool> update` through `current`, logging to the state directory; `init --no-auto-update` removes
it. A pinned install's timer runs and changes nothing, exactly as `update` does.

**A one-shot command at a channel.** `npx github:<org>/<repo>#stable <args>` works too: the
launcher resolves the channel on the commit npx installed (the sha in the installing project's
lockfile) to its release tag and fetches that version's dist ref, so the binary always matches the
source npx ran. npx re-resolves a branch committish on every run, so a one-shot command at a
channel costs one round trip to the origin per run — pin `#vX.Y.Z` where that matters. Any other
branch (`#main`) is still refused: it names no release.

**Per-machine config, state and secrets live outside the install.** Everything under the install
directory is disposable — replaced on update, pruned, reinstallable from the origin — so nothing a
machine owns may live there, nor in the package, nor in the unit file:

- config and secrets: `$XDG_CONFIG_HOME/<tool>/` (mode `0700`, secret files `0600`) or the OS
  keychain;
- state and logs: `$XDG_STATE_HOME/<tool>/`.

The unit passes the service the **locations** (`<TOOL>_CONFIG_DIR`, `<TOOL>_STATE_DIR`), never a
value; `init` creates the directories and never overwrites a file in them. Deleting the whole data
directory must lose nothing a reinstall cannot bring back.

**A JS app that needs a build** builds in `prepare`, as the *Distribution* table already says —
for a service that is safe, because the build runs while the new version is being installed beside
the running one, before any switch. Two conditions: the built output must be listed in `files`
(npm packs a git dependency through `files`), and every machine needs the build toolchain. A build
that cannot run on the target (secrets, a heavy toolchain) ships its output prebuilt instead, as a
platform-neutral dist ref (#470): one tarball in `refs/tags/dist/vX.Y.Z/any`, pushed by
`dist-refs.yml` with `platforms: any`. The service template's `KIND 'dist'` fetches it with the
same git, verifies it against that ref's `SHA256SUMS` exactly as the launcher verifies a binary,
refuses an archive with an absolute or `..` entry, and unpacks it into the version's directory
before any switch.

Why side-by-side versions, and not a serving clone that follows a branch: [ADR 539](../../docs/adr/539-releases-distribution-rationale.md).

**Service managers.** The template writes a launchd agent on macOS and a systemd user unit on
Linux, and refuses Windows. A Linux service that must outlive the login session needs lingering
enabled for the user; `init` prints the command and never runs it.
