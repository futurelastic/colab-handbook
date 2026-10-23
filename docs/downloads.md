# Downloads — publishing finals to a self-hosted site (#648)

Some repos ship files a person installs on their own machine: a `.dmg`, a `.deb`, an `.msi`, a
tarball and an install script. When those go to a self-hosted downloads site, every such repo
uses the same copy-and-own pair instead of writing its own publish script:

| Template | Copy to |
|---|---|
| [`templates/publish-downloads.yml`](../templates/publish-downloads.yml) | `.github/workflows/publish-downloads.yml` |
| [`templates/publish-downloads.mjs`](../templates/publish-downloads.mjs) | `.github/downloads/publish-downloads.mjs` (the workflow's `PUBLISH_SCRIPT`) |

The rule this serves is [CONVENTIONS.md §6, *Downloads*](../CONVENTIONS.md#downloads--finals-to-a-self-hosted-site-648).
The headers of both files are the operating detail; this page is the contract.

## The site

```
<DOWNLOADS_URL>/                 the site root (a repo variable, never in code)
  <app>/                         one folder per app; the upload account's root
    manifest.json                what the portal lists (below)
    latest.json                  {"version": "X.Y.Z", "files": {"<name>": {"sha256", "size"}}}
    install.sh, install.ps1 …    the repo's installers, the site root stamped in
    X.Y.Z/                       one final's files + SHA256SUMS
```

- **Finals only.** The tag must be `vX.Y.Z`; a candidate (`-rc.N`) is refused by the workflow and
  again by the script.
- **Upload order:** the version folder → each file read back over HTTPS against the checksums this
  build computed → `X.Y.Z/SHA256SUMS` → installers → `manifest.json` → `latest.json` last → read
  back. A run stopped anywhere leaves the site consistent: a folder without `SHA256SUMS` is
  incomplete, and `latest.json` never names a version whose folder is not complete.
- **Immutable.** A version file is never replaced (`rsync --ignore-existing`, and an account that
  cannot delete). An existing `SHA256SUMS` that differs from this build's is an error and nothing
  is changed: publish a new version instead.
- **`latest.json` only moves forward.** Publishing an older final (a backfill) leaves it alone.
- **A re-run is a verified no-op.** A complete version is read back and left alone; the app-root
  files are sent only when the site's copy differs. A partial version gets only its missing files.
- **A dry run uploads nothing** and needs no upload secrets; it stages, reads the site, and lists
  what would be sent.
- **Keeping the newest finals and deleting old ones is the site's job**, not the publisher's.

## Opting in — `downloads:` in `project.yml`

```yaml
downloads:
  app: myapp                         # the folder on the site
  files:                             # every final carries these; {v} is X.Y.Z
    - myapp-{v}.tgz
    - MyApp_{v}_aarch64.dmg
  optional: [MyApp_{v}_x64.msi]      # published when the Release has it
  installers: [scripts/install.sh, scripts/install.ps1]
  manifest: .github/downloads/manifest.json   # the default
```

The field is described in [`project.schema.md`](../project.schema.md#downloads--optional). The
script reads only that block, with a small YAML subset (scalars, `- item` and `[a, b]` lists,
comments), and names the line of anything else.

- `app` — `[a-z0-9][a-z0-9-]*`. A name starting with `_`, or one the site reserves for its own
  index (the workflow's `reserved` input), is refused.
- `files` — required. A required file missing from the Release refuses the whole run before
  anything is sent.
- `installers` — repo paths. Each must contain the placeholder `@DOWNLOADS_URL@`; the site root is
  stamped there. An installer appends `/<app>` itself, and should let an environment variable
  override the stamped value so it can be tested against another site (the reference step below
  uses `DOWNLOADS_SITE`). When the manifest has `requires`, each installer must also contain
  `@DOWNLOADS_REQUIRES@` ([below](#requires--apps-installed-first-653)).

## `manifest.json`

One file per app, kept in the repo and uploaded on every run (sent only when it changed), so a
portal can list every app from the site alone. The script validates it before anything is sent.

```json
{
  "schema": 1,
  "name": "MyApp",
  "summary": { "en": "One line on what it is for.", "vi": "Một dòng về công dụng." },
  "install": {
    "macos":   { "steps": ["Open the .dmg", "Drag MyApp to Applications"],
                 "prompts": ["\"Cannot verify the developer\": System Settings → Privacy & Security → Open Anyway"] },
    "windows": { "steps": ["irm <site>/myapp/install.ps1 | iex"] },
    "linux":   { "steps": ["curl -fsSL <site>/myapp/install.sh | sh"] }
  },
  "requires": [{ "slug": "mysvc", "min": "2.1.0" }]
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema` | no | `1`. A later format raises it. |
| `name` | yes | The app's display name, one line. |
| `summary` | yes | What the app is for, one line. |
| `install` | yes | One entry per platform the app supports: `macos`, `windows`, `linux`. The keys are the platforms the portal shows. |
| `install.<os>.steps` | yes | The install steps, in order. |
| `install.<os>.prompts` | no | Known prompts a person meets while installing, and what to answer. |
| `requires` | no | Other apps on the same site this one needs, in install order: `{"slug", "min"}`, `min` the lowest working version `X.Y.Z`. A portal lists them with the app ("installs mysvc too"). |

Every text is either a string or one string per language code (`{"en": "…", "vi": "…"}`). Unknown
fields are refused, so a misspelled field is caught at publish rather than missing from the portal.

## Requires — apps installed first (#653)

An app often needs other apps from the same site installed before it: a background service, a
session layer, a client binary. It declares them in `manifest.json` `requires`, and its installers
install them first.

**At publish**, before anything is sent (a dry run included), the script refuses:

- a `requires` entry that is not `{"slug", "min"}` with a slug and an `X.Y.Z`, a slug listed twice,
  or the app itself;
- a slug with no final on the site, or whose newest final (`latest.json`) is older than `min`;
- a cycle: following the site's manifests from the required apps leads back to this one, or round
  any other loop;
- an installer without `@DOWNLOADS_REQUIRES@`, which would install the app without them.

The list is stamped into each installer at `@DOWNLOADS_REQUIRES@` as `slug:min slug:min`, in the
manifest's order, so an installer never parses JSON. A required app published later does not
change an installer already on the site; publish the app again to restamp it.

**At install**, the installer goes through the list in order before installing its own app:

- **Each one checks itself.** The dependency's own installer runs with `INSTALL_MIN=<min>`. When its
  app is already installed at `>= min`, it exits 0 and changes nothing; otherwise it installs its
  newest final the way every install does: its own `requires` first, then its download checked
  against that version's `SHA256SUMS`. So a dependency's own `requires` resolve the same way.
- **Once per run.** The first installer of a run keeps a list of the apps done (`INSTALL_REQUIRES_DONE`,
  a temporary file every dependency appends to) and skips any already on it.
- **No cycle.** `INSTALL_REQUIRES_CHAIN` names the installers above this one; a slug already on it
  stops the run.
- **Never half.** A dependency that cannot be installed (no installer on the site for this OS, its
  own refusal of the OS, a checksum failure) stops the run before the app is installed, naming the
  dependency and the reason. The dependencies installed before it stay installed.
- **Opt-out.** `INSTALL_SKIP_REQUIRES=1` installs only the app itself, for a machine that manages
  its dependencies another way.
- **One site.** `DOWNLOADS_SITE` overrides the stamped site root, and the dependencies inherit it,
  so a whole tree can be tested against another site.

The handbook ships no installer: each repo owns its `install.sh` and `install.ps1`. These are the
reference installers with the dependency step; copy the one you need and fill in the `# EDIT:` lines.
An installer that already exists keeps its own body as `install_app` / `Install-App`. An installer
that sets its own `EXIT` trap adds the temporary file's removal to it. Both are tested end to end
against a stand-in site (`tools/lib/publish-downloads-template.test.js`).

```sh
#!/bin/sh
# Installs myapp from the downloads site and, first, the apps its manifest.json requires
# (colab-handbook docs/downloads.md, #653). Run as: curl -fsSL <site>/myapp/install.sh | sh
set -eu
APP=myapp                                   # EDIT: this app's slug on the site
SITE="${DOWNLOADS_SITE:-@DOWNLOADS_URL@}"   # stamped at publish; DOWNLOADS_SITE points a test at another site
REQUIRES='@DOWNLOADS_REQUIRES@'             # stamped at publish from manifest.json: "slug:min slug:min"
export DOWNLOADS_SITE="$SITE"               # every dependency installs from the same site

installed_version() {                       # EDIT: the installed version X.Y.Z, empty when absent
  myapp --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1
}

install_app() {                             # EDIT: fetch $SITE/$APP/latest.json, download, check SHA256SUMS, place
  :
}

die() { echo "$APP: $*" >&2; exit 1; }

version_ge() {                              # is $1 >= $2? both X.Y.Z
  _a=$1 _b=$2
  for _ in 1 2 3; do
    [ "${_a%%.*}" -gt "${_b%%.*}" ] && return 0
    [ "${_a%%.*}" -lt "${_b%%.*}" ] && return 1
    _a=${_a#*.} _b=${_b#*.}
  done
}

install_requires() {
  [ -n "$REQUIRES" ] || return 0
  if [ "${INSTALL_SKIP_REQUIRES:-}" = 1 ]; then
    echo "$APP: INSTALL_SKIP_REQUIRES=1, not installing $REQUIRES"; return 0
  fi
  INSTALL_REQUIRES_CHAIN="${INSTALL_REQUIRES_CHAIN:+$INSTALL_REQUIRES_CHAIN }$APP"
  if [ -z "${INSTALL_REQUIRES_DONE:-}" ]; then  # the first installer of this run keeps the list
    INSTALL_REQUIRES_DONE=$(mktemp); trap 'rm -f "$INSTALL_REQUIRES_DONE"' EXIT
  fi
  export INSTALL_REQUIRES_CHAIN INSTALL_REQUIRES_DONE
  for req in $REQUIRES; do
    slug=${req%%:*} min=${req#*:}
    case " $INSTALL_REQUIRES_CHAIN " in
      *" $slug "*) die "a cycle: $INSTALL_REQUIRES_CHAIN $slug; $APP was not installed" ;;
    esac
    grep -qxF "$slug" "$INSTALL_REQUIRES_DONE" && continue
    echo "$APP requires $slug >= $min"
    script=$(curl -fsSL "$SITE/$slug/install.sh") ||
      die "cannot install $slug: $SITE/$slug/install.sh is not on the site; $APP was not installed"
    printf '%s\n' "$script" | INSTALL_MIN=$min sh ||
      die "installing $slug failed (its reason is above); $APP was not installed"
    echo "$slug" >> "$INSTALL_REQUIRES_DONE"
  done
}

# Run by an app that requires this one: already at >= INSTALL_MIN means there is nothing to do.
if [ -n "${INSTALL_MIN:-}" ]; then
  have=$(installed_version || true)
  if [ -n "$have" ] && version_ge "$have" "$INSTALL_MIN"; then
    echo "$APP $have is installed (>= $INSTALL_MIN)"; exit 0
  fi
fi
install_requires
install_app
```

```powershell
# Installs myapp from the downloads site and, first, the apps its manifest.json requires
# (colab-handbook docs/downloads.md, #653). Run as: irm <site>/myapp/install.ps1 | iex
$ErrorActionPreference = 'Stop'
$App = 'myapp'                                          # EDIT: this app's slug on the site
$Site = if ($env:DOWNLOADS_SITE) { $env:DOWNLOADS_SITE } else { '@DOWNLOADS_URL@' }
$Requires = '@DOWNLOADS_REQUIRES@'                      # stamped at publish from manifest.json: "slug:min slug:min"

function Get-InstalledVersion {                         # EDIT: the installed version, $null when absent
  $cmd = Get-Command myapp -ErrorAction SilentlyContinue
  if ($cmd -and ("$(& $cmd --version 2>$null)" -match '\d+\.\d+\.\d+')) { [version]$Matches[0] }
}

function Install-App {                                  # EDIT: fetch $Site/$App/latest.json, download, check SHA256SUMS, place
}

function Install-Requires {
  $list = @($Requires -split '\s+' | Where-Object { $_ })
  if ($list.Count -eq 0) { return }
  if ($env:INSTALL_SKIP_REQUIRES -eq '1') { Write-Host "${App}: INSTALL_SKIP_REQUIRES=1, not installing $Requires"; return }
  # `irm | iex` runs in the user's own session: put every variable back afterwards.
  $saved = @{}
  foreach ($k in 'DOWNLOADS_SITE', 'INSTALL_REQUIRES_CHAIN', 'INSTALL_REQUIRES_DONE', 'INSTALL_MIN') {
    $saved[$k] = [Environment]::GetEnvironmentVariable($k)
  }
  $chain = @($env:INSTALL_REQUIRES_CHAIN -split '\s+' | Where-Object { $_ }) + $App
  $env:INSTALL_REQUIRES_CHAIN = $chain -join ' '
  $env:DOWNLOADS_SITE = $Site                           # every dependency installs from the same site
  $ownDone = -not $env:INSTALL_REQUIRES_DONE            # the first installer of this run keeps the list
  if ($ownDone) { $env:INSTALL_REQUIRES_DONE = (New-TemporaryFile).FullName }
  $shell = (Get-Process -Id $PID).Path
  try {
    foreach ($req in $list) {
      $slug, $min = $req -split ':', 2
      if ($chain -contains $slug) { throw "${App}: a cycle: $($chain -join ' ') $slug; $App was not installed" }
      if (@(Get-Content -LiteralPath $env:INSTALL_REQUIRES_DONE) -contains $slug) { continue }
      Write-Host "$App requires $slug >= $min"
      $script = Join-Path ([IO.Path]::GetTempPath()) "install-$slug-$PID.ps1"
      try { Invoke-WebRequest -UseBasicParsing -Uri "$Site/$slug/install.ps1" -OutFile $script }
      catch { throw "${App}: cannot install ${slug}: $Site/$slug/install.ps1 is not on the site; $App was not installed" }
      $env:INSTALL_MIN = $min
      & $shell -NoProfile -ExecutionPolicy Bypass -File $script
      $code = $LASTEXITCODE
      Remove-Item -LiteralPath $script -Force
      if ($code -ne 0) { throw "${App}: installing $slug failed (its reason is above); $App was not installed" }
      Add-Content -LiteralPath $env:INSTALL_REQUIRES_DONE -Value $slug
    }
  } finally {
    if ($ownDone) { Remove-Item -LiteralPath $env:INSTALL_REQUIRES_DONE -Force -ErrorAction SilentlyContinue }
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
  }
}

# Run by an app that requires this one: already at >= INSTALL_MIN means there is nothing to do.
if ($env:INSTALL_MIN) {
  $have = Get-InstalledVersion
  if ($have -and $have -ge [version]$env:INSTALL_MIN) { Write-Host "$App $have is installed (>= $env:INSTALL_MIN)"; return }
}
Install-Requires
Install-App
```

## The runner and the secrets

The read-back runs from the job, so the job must run where the site is reachable. A site on a
private network is unreachable from a GitHub-hosted runner: pass a runner that can reach it as
`runs-on` (a bare label or a JSON label list). If the site's name does not resolve there, the run
fails saying so before anything is sent. The runner needs `gh`, `rsync` and `ssh`.

Per repo, never shared between repos:

| Name | Kind | What |
|---|---|---|
| `DOWNLOADS_SSH_KEY` | secret | private key of an upload account restricted to this app's folder, unable to delete |
| `DOWNLOADS_SSH_HOST`, `DOWNLOADS_SSH_PORT`, `DOWNLOADS_SSH_USER` | secrets | where rsync goes |
| `DOWNLOADS_SSH_KNOWN_HOSTS` | secret | the host key line(s); host keys are checked strictly. The older name `DOWNLOADS_KNOWN_HOSTS` is still read when this one is unset |
| `DOWNLOADS_URL` | variable | the site root, `https://…`; the script appends `/<app>` |

## Moving an existing publish script onto the template

1. Copy both files with `colab template` (above), then walk the `# EDIT:` markers.
2. Write the `downloads:` block from the script's file list, and a `manifest.json`.
3. Rename the installers' placeholder to `@DOWNLOADS_URL@`, and the repo's secrets and variable to
   the names above.
4. Point the release workflow's last job at the copied workflow (its header shows the job), and
   delete the old script.
5. Verify with a dry run of the newest final, then a real run of it: a version already on the site
   reads back as a verified no-op.
