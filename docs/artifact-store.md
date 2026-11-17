# artifact-store — job artifacts and release files through your own S3-compatible store

`.github/actions/artifact-store/` holds two composite actions that replace
`actions/upload-artifact` and `actions/download-artifact` one for one, storing through any
S3-compatible bucket instead of the GitHub artifact allowance (#601). A third, `object`, moves one
file for a job on a runner that has no bash and no S3 client
([below](#a-runner-with-no-bash-and-no-s3-client-object)) (#753).

**Why it exists.** On a plan with a capped artifact allowance, both official actions stop working
once the month's allowance is used. Deleting artifacts does not restore it, because the cap is
metered in GB-hours across the month. Every workflow that passes files between jobs then fails
until the month rolls over. An organisation that runs self-hosted runners usually has its own
storage already.

## Adopt it

Pick one of two ways, the same choice [CONVENTIONS §7](../CONVENTIONS.md#ci-artifacts--your-own-store-not-the-allowance-601) gives every shared CI piece:

- **Call it remotely, pinned.** `uses: <handbook-owner>/colab-handbook/.github/actions/artifact-store/upload@<tag or sha>`.
  Pin a tag or a commit, never a branch: a moving ref changes your CI without a commit of yours.
- **Copy it.** Copy the whole `.github/actions/artifact-store/` directory into your repo and
  call `uses: ./.github/actions/artifact-store/upload`. Keep its `.gitattributes`: the scripts
  run under bash on Windows too, and a CRLF checkout breaks them.

Swap the steps one for one:

```yaml
# before
- uses: actions/upload-artifact@v7
  with: { name: web-build, path: dist/ }
# after
- uses: ./.github/actions/artifact-store/upload
  with:
    name: web-build
    path: dist/
    endpoint: ${{ secrets.ARTIFACT_STORE_ENDPOINT }}
    bucket: ${{ secrets.ARTIFACT_STORE_BUCKET }}
    access-key: ${{ secrets.ARTIFACT_STORE_ACCESS_KEY }}
    secret-key: ${{ secrets.ARTIFACT_STORE_SECRET_KEY }}
    region: ${{ secrets.ARTIFACT_STORE_REGION }}

# in a later job of the same run
- uses: ./.github/actions/artifact-store/download
  with:
    name: web-build
    path: dist/
    endpoint: ${{ secrets.ARTIFACT_STORE_ENDPOINT }}
    bucket: ${{ secrets.ARTIFACT_STORE_BUCKET }}
    access-key: ${{ secrets.ARTIFACT_STORE_ACCESS_KEY }}
    secret-key: ${{ secrets.ARTIFACT_STORE_SECRET_KEY }}
    region: ${{ secrets.ARTIFACT_STORE_REGION }}
```

The secret names above are a convention, not a requirement. Nothing about any deployment is
built in: every connection detail is an input. To switch one call site back to GitHub's
storage, set `backend: github`. The step then runs the official action with the same `name`,
`path` and options.

## Inputs

Both actions take `endpoint`, `bucket`, `access-key`, `secret-key` and `region` (default
`us-east-1`; a self-hosted store's region is whatever constant it was configured with). A
self-hosted store configured with any other region therefore needs `region:` on every call site:
requests are signed for the region, and the store answers 400 to a GET or HEAD signed for the
wrong one. They also take:

| input | default | meaning |
|---|---|---|
| `client` | `auto` | `aws` (AWS CLI), `mc` (MinIO client), or `auto`: aws first, then mc |
| `addressing-style` | `path` | `path` sends `endpoint/bucket/key`, which works on stores that have no virtual-host domain; `virtual` and `auto` are the alternatives |
| `part-size` | `64MB` | the AWS CLI's multipart threshold and part size. mc chooses its own part size |
| `key-prefix` | empty | prepended to every key, to share one bucket between uses |

`upload` takes `name`, `path`, `if-no-files-found`, `retention-days` and
`include-hidden-files`, the same as `actions/upload-artifact`. `path` is one entry per line,
globs included (`**` too), and a leading `!` excludes. Paths are stored relative to the
nearest common directory of the patterns.

`download` takes `name`, `path`, `pattern` and `merge-multiple`, plus `run-id` to read another
run's artifacts. An empty `name` downloads every artifact of the run, filtered by `pattern`.
Each artifact goes to `path/<name>`, or straight into `path` with `merge-multiple: true`.

**Outputs:** `upload` gives `key` (the `s3://` prefix it wrote) and `file-count`. `download`
gives `download-path`.

## What the runner needs

- **A client on the runner image: the AWS CLI or the MinIO client (`mc`, or `mcli`).** The
  action detects it and never installs one at job time. If neither is there, the step fails
  and says so. A binary named `mc` counts only if `--version` reports MinIO, because Midnight
  Commander installs the same name on many Linux hosts.
- **Every aws call passes `--endpoint-url`.** AWS CLI releases before 2.13 ignore
  `AWS_ENDPOINT_URL`, and some self-hosted runners still have 2.9.
- **bash, on every OS.** On Windows that means Git for Windows, which is what `shell: bash`
  runs there. A single script serves all three OSes on purpose: a second implementation in
  pwsh would drift from the first.
- The action writes its client configuration to a temporary directory for each step. The
  runner's own `~/.aws` and `~/.mc` are never read or changed.
- A runner that cannot meet these — a clean-install lane with no bash and no S3 client — uses
  `object` for its one file in and its one file out: [next section](#a-runner-with-no-bash-and-no-s3-client-object).

## A runner with no bash and no S3 client (`object`)

A clean-install test lane is a Windows machine rolled back to a bare snapshot before every job, so
that the installer is proven on a machine with nothing extra. It has no git, no bash and no S3
client, on purpose. It still has to get the installer from an earlier job, and hand its logs back.

`object` does exactly that, and nothing more: it gets or puts **one file**, in the same bucket and
the same key layout as `upload` and `download`. So the persistent job uses `upload` as usual, and
a later persistent job reads the bare job's logs with `download`. It runs under Windows PowerShell
5.1 (the one shell a bare Windows image is sure to have; on Linux and macOS it uses `pwsh`) and
signs its requests with the runner's own `curl`.

```yaml
jobs:
  build:                      # persistent runner: bash + an S3 client, as usual
    runs-on: [self-hosted, windows]
    steps:
      - run: Compress-Archive -Path dist/* -DestinationPath handoff.zip
        shell: pwsh
      - uses: ./.github/actions/artifact-store/upload
        with:
          name: installer
          path: handoff.zip
          endpoint: ${{ secrets.ARTIFACT_STORE_ENDPOINT }}
          bucket: ${{ secrets.ARTIFACT_STORE_BUCKET }}
          access-key: ${{ secrets.ARTIFACT_STORE_ACCESS_KEY }}
          secret-key: ${{ secrets.ARTIFACT_STORE_SECRET_KEY }}
          region: ${{ secrets.ARTIFACT_STORE_REGION }}

  clean-install:              # bare snapshot: Windows PowerShell + curl.exe, nothing else
    needs: build
    runs-on: [self-hosted, clean-install]
    defaults:
      run:
        shell: powershell
    steps:
      - uses: <handbook-owner>/colab-handbook/.github/actions/artifact-store/object@<tag or sha>
        with:
          mode: get
          name: installer
          file: handoff.zip
          endpoint: ${{ secrets.ARTIFACT_STORE_ENDPOINT }}
          bucket: ${{ secrets.ARTIFACT_STORE_BUCKET }}
          access-key: ${{ secrets.ARTIFACT_STORE_ACCESS_KEY }}
          secret-key: ${{ secrets.ARTIFACT_STORE_SECRET_KEY }}
          region: ${{ secrets.ARTIFACT_STORE_REGION }}
      - run: |
          Expand-Archive handoff.zip -DestinationPath dist
          .\dist\install.ps1 *> install.log
      - if: always()
        run: Compress-Archive -Path install.log, $env:TEMP\*.log -DestinationPath logs.zip
      - if: always()
        uses: <handbook-owner>/colab-handbook/.github/actions/artifact-store/object@<tag or sha>
        with:
          mode: put
          name: clean-install-logs
          path: logs.zip
          endpoint: ${{ secrets.ARTIFACT_STORE_ENDPOINT }}
          bucket: ${{ secrets.ARTIFACT_STORE_BUCKET }}
          access-key: ${{ secrets.ARTIFACT_STORE_ACCESS_KEY }}
          secret-key: ${{ secrets.ARTIFACT_STORE_SECRET_KEY }}
          region: ${{ secrets.ARTIFACT_STORE_REGION }}
```

A later job on a persistent runner reads the logs with `download` and `name: clean-install-logs`.

- **One file each way.** `put` refuses a directory; pack it into one archive first
  (`Compress-Archive`). `file` is the file's path inside the artifact: `upload` of a single file
  stores it under its own name, so `file: handoff.zip` above. `put` stores under the leaf name of
  `path` unless `file` says otherwise.
- **No job output to pass.** The bare job works out the key itself from the layout
  ([Keys, and re-runs](#keys-and-re-runs)), so nothing passes through `needs.<job>.outputs`. That
  matters: `upload`'s `key` output starts with the bucket name, and GitHub drops a job output that
  contains a secret's value, which the bucket usually is.
- **Re-runs behave as `download` does.** `get` tries this attempt, then each earlier one, and takes
  the newest that holds the file. `put` writes under the current attempt.
- **Remote call or copy, as with the other two.** The runner fetches a remote action itself, with
  no git. A copied action needs `actions/checkout`, which downloads through the REST API when git
  is missing.
- **Inputs.** `mode` (`get` or `put`), `name`, `file`, `path`, `run-id` (get only), and `endpoint`,
  `bucket`, `access-key`, `secret-key`, `region`, `key-prefix` exactly as for the other two.
  Requests are always path-style. **Outputs:** `key` (put, without the bucket), `path` (get) and
  `attempt`.

**What the runner needs: curl 8.1.0 or newer**, as `curl.exe` on Windows. Windows 10 1803+ and
Windows Server 2019+ ship `curl.exe`, but its version depends on the build and its updates, and
early builds shipped a 7.x. That is too old: curl before 8.1.0 leaves the
`x-amz-content-sha256` header unsigned, and an S3 store refuses every such request (measured on
curl 7.75 to 7.88: "Header `x-amz-content-sha256` should be signed"). The step checks the version
first, and if it is older it fails and says so. Check `curl.exe --version` on the snapshot once.
The action never installs anything. The credentials need list permission on the bucket, as
`download`'s do: without it, AWS answers 403 for a missing key instead of 404, and `get` reports
that 403 as the store's error instead of looking in an earlier attempt.

**Credentials stay out of the log and off the command line.** The secret key is masked. It
reaches curl in a config file (`curl -K <file>`) in the step's own temporary directory, which is
removed when the step ends, so it is never in curl's arguments. Standard input would have kept it
off the disk too, but curl rejected a config piped from Windows PowerShell 5.1 ("found an unknown
config option"), even with a BOM-less `$OutputEncoding`.

**Failures are loud, as with the other two.** A missing file fails with the key it looked for and
the attempts it searched. A refused signature, a wrong region, a missing bucket or denied access
fails with the store's own `Code` and `Message`. An unreachable store fails with curl's error. A
failed `get` never leaves the error body behind as the file.

**Why not a presigned URL.** It would make the bare job the simplest consumer of all
(`Invoke-WebRequest`), and it was ruled out:

- A SigV4 presigned URL carries the access key id in `X-Amz-Credential`. When the id is a
  secret, GitHub drops the job output that carries the URL. Moving the id to a variable gets the
  URL through, but the URL is then a bearer credential for its whole lifetime, in a place every
  later job can read.
- The bare job's queue time (waiting for a snapshot roll-back) sets how long the URL must live.
- `put` needs a presigned PUT URL. `aws s3 presign` makes only GET URLs, so the persistent job
  would need another tool.

So `object` signs on the bare runner itself, with the secrets the job already has.

## Keys, and re-runs

```
[<key-prefix>/]<owner>/<repo>/<run_id>/<run_attempt>/<name>/<path inside the artifact>
```

An upload writes under its own attempt. A download takes the **newest attempt that holds the
name**. So when you re-run failed jobs, they still find what the earlier attempt's jobs
uploaded, and a job that re-ran wins over its own earlier upload. Within one attempt, uploading
a name again replaces it, like `overwrite: true`.

**Failures are loud.** A failed upload fails the step and names the key. A download of a
missing name fails with the key it looked for and the attempts it searched. If the store cannot
be reached, or rejects the credentials, the step fails with the store's error. It never
reports "not found" in that case.

## Retention

S3 has no per-object retention. Expiry is the bucket's own lifecycle rule. `retention-days` is
accepted so call sites do not change. On the S3 backend it only logs a notice; with
`backend: github` it is passed through. Set the rule once per bucket, for example to expire
artifacts after 14 days and keep the release files under `publish` forever:

```json
{
  "Rules": [
    {
      "ID": "expire-ci-artifacts",
      "Status": "Enabled",
      "Filter": { "Prefix": "my-org/" },
      "Expiration": { "Days": 14 },
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 1 }
    }
  ]
}
```

```sh
aws --endpoint-url "$ENDPOINT" s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" --lifecycle-configuration file://lifecycle.json
# MinIO client: mc ilm rule add --expire-days 14 --prefix my-org/ store/$BUCKET
```

The prefix is the `<owner>/` segment of the artifact keys, or your `key-prefix`. Release files
are keyed by app, so a rule on the owner prefix does not expire them. Give them a separate
bucket or a separate `key-prefix` if you want rules that are plainly separate.

## Publishing release files (`mode: publish`)

A release job that hands installers to users runs the upload action in publish mode. Use a
separate bucket and separate credentials, because the published bucket is served to the
public:

```yaml
- uses: ./.github/actions/artifact-store/upload
  id: publish
  with:
    mode: publish
    app: desktop
    version: ${{ github.ref_name }}
    path: dist/installers/
    public-base: ${{ vars.DOWNLOADS_BASE_URL }}     # e.g. https://downloads.example.com
    endpoint: ${{ secrets.PUBLISH_STORE_ENDPOINT }}
    bucket: ${{ secrets.PUBLISH_STORE_BUCKET }}
    access-key: ${{ secrets.PUBLISH_STORE_ACCESS_KEY }}
    secret-key: ${{ secrets.PUBLISH_STORE_SECRET_KEY }}
    region: ${{ secrets.PUBLISH_STORE_REGION }}
- run: echo "${{ steps.publish.outputs.urls }}"
```

It writes:

- `<app>/<version>/<file>` with `Cache-Control: public, max-age=31536000, immutable`, and a
  `Content-Type` guessed from the extension. The `content-type` input overrides the guess.
- `<app>/latest/<file>` and `<app>/latest.json` with a short cache (`max-age=300`), unless
  `latest: false`. `latest.json` is `{"app","version","files":[{"name","url"}]}`, for an
  updater to poll.

The outputs `urls` and `latest-urls` list `<public-base>/<key>`, one per line.

**A published version is immutable.** If `<app>/<version>/` already holds files, the step is
refused. Under a one-year cache header, silently replacing a version would serve two different
files under one URL. Bump the version, or pass `overwrite: true` deliberately (for example,
when re-running a release job that failed after its publish step).

## The oracle

`.github/workflows/artifact-store.yml` is the test:

- **Hermetic job, on Linux, macOS and Windows.** It runs the script and the action through a
  fake `aws` (`test/aws`): globs, attempts, publish, and every refusal.
- **Two-job round-trip.** A file and a directory pass between two jobs through a real
  S3-compatible store (SeaweedFS), once with each client. A store started in a job dies with
  that job, so its data directory rides to the next job in `actions/cache`. The consuming job
  runs on a different runner with a different workspace, and finds the files only through the
  run key. MinIO stopped publishing images and binaries, which is why the test uses SeaweedFS
  and builds `mc` from source. That build is test-only.
- **Bare-runner path (#753).** `object` runs against a real store twice. On Linux it runs
  against Garage, which enforces a region other than `us-east-1` (`test/garage.sh`; SeaweedFS
  ignores the region, so a region bug passes there). There it is interleaved with the bash actions
  both ways: `upload` → `get`, `put` → `download`. On Windows every step runs in Windows PowerShell
  5.1 with the inbox `curl.exe`, against SeaweedFS's Windows binary. `test/object.ps1` is the
  script's own check, of attempts, encoded names, a wrong secret, a wrong region and the
  refusals. It needs a real store (`AS_ENDPOINT`, `AS_BUCKET`, `AS_ACCESS_KEY`, `AS_SECRET_KEY`,
  `AS_REGION`).
- **Local check.** `scripts/smoke.sh` runs the hermetic round-trip.
  `.github/actions/artifact-store/test/roundtrip.sh` runs the same checks against any real
  store when `AS_ENDPOINT`, `AS_BUCKET`, `AS_ACCESS_KEY`, `AS_SECRET_KEY` and `AS_CLIENT` are
  set, plus `AS_REGION` when the store's region is not `us-east-1`.
