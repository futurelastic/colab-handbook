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
  override the stamped value so it can be tested against another site.

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
  }
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

Every text is either a string or one string per language code (`{"en": "…", "vi": "…"}`). Unknown
fields are refused, so a misspelled field is caught at publish rather than missing from the portal.

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
| `DOWNLOADS_KNOWN_HOSTS` | secret | the host key line(s); host keys are checked strictly |
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
