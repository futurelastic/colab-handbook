# artifact-store — job artifacts and release files through your own S3-compatible store

`.github/actions/artifact-store/` holds two composite actions that replace
`actions/upload-artifact` and `actions/download-artifact` one for one, storing through any
S3-compatible bucket instead of the GitHub artifact allowance (#601).

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
`us-east-1`; a self-hosted store's region is whatever constant it was configured with). They
also take:

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
- **Local check.** `scripts/smoke.sh` runs the hermetic round-trip.
  `.github/actions/artifact-store/test/roundtrip.sh` runs the same checks against any real
  store when `AS_ENDPOINT`, `AS_BUCKET`, `AS_ACCESS_KEY`, `AS_SECRET_KEY` and `AS_CLIENT` are
  set.
