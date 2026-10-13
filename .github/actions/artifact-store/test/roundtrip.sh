#!/usr/bin/env bash
# Round-trip of artifact-store.sh in one process (#601). Hermetic by default — through the fake
# `aws` beside this file, run by scripts/smoke.sh. With AS_ENDPOINT + AS_BUCKET (+ keys, AS_CLIENT)
# set, the same checks run against that real store instead. The round-trip BETWEEN TWO JOBS is
# .github/workflows/artifact-store.yml.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; lib="$here/../lib/artifact-store.sh"
t="$(mktemp -d "${TMPDIR:-/tmp}/as-roundtrip.XXXXXX")"; trap 'rm -rf "$t"' EXIT
real=0; [ -z "${AS_ENDPOINT:-}" ] || real=1
export RUNNER_TEMP="$t/tmp" GITHUB_OUTPUT="$t/out" GITHUB_REPOSITORY=acme/widget
if [ "$real" = 1 ]; then
  export GITHUB_RUN_ID="rt-$$-$(date +%s)"   # unique, so a shared bucket never sees a prior run
else
  export PATH="$here:$PATH" FAKE_S3_ROOT="$t/s3" GITHUB_RUN_ID=42 AS_BUCKET=artifacts AS_CLIENT=aws
  mkdir -p "$t/s3/artifacts"
fi
R="s3://$AS_BUCKET/acme/widget/$GITHUB_RUN_ID"
mkdir -p "$t/tmp" "$t/ws"
fail() { echo "roundtrip: FAIL — $*" >&2; exit 1; }
up() { AS_NAME="$1" AS_PATH="$2" "${@:3}" bash "$lib" upload >/dev/null; }
down() { AS_NAME="$1" AS_PATH="$2" "${@:3}" bash "$lib" download >/dev/null; }

cd "$t/ws"
mkdir -p tree/sub tree/.cache build/a build/b
echo one > one.txt; echo a > tree/a.txt; echo b > tree/sub/b.txt; echo h > tree/.cache/h
echo x > build/a/x.js; echo y > build/b/y.js; echo m > build/b/y.map

up file one.txt
up dir tree
up globbed $'build/**/*.js\n!build/b/y.js' env
up empty nothing-here env AS_IF_NO_FILES_FOUND=ignore

[ "$real" = 1 ] || [ -f "$t/s3/artifacts/acme/widget/42/1/file/one.txt" ] || fail "file not keyed under owner/repo/run/attempt/name"
down file "$t/got/file"; cmp -s one.txt "$t/got/file/one.txt" || fail "file round-trip"
down dir "$t/got/dir"
[ -f "$t/got/dir/a.txt" ] && [ -f "$t/got/dir/sub/b.txt" ] || fail "directory round-trip"
[ ! -e "$t/got/dir/.cache" ] || fail "hidden files must be excluded by default"
down globbed "$t/got/g"
[ -f "$t/got/g/a/x.js" ] && [ ! -e "$t/got/g/b/y.js" ] && [ ! -e "$t/got/g/b/y.map" ] || fail "glob root/exclude"

AS_NAME= AS_PATTERN='*i*' AS_PATH="$t/got/pat" bash "$lib" download >/dev/null
[ -f "$t/got/pat/file/one.txt" ] && [ -f "$t/got/pat/dir/a.txt" ] && [ ! -e "$t/got/pat/globbed" ] || fail "pattern download"

if err="$(AS_NAME=missing AS_PATH="$t/got/m" bash "$lib" download 2>&1)"; then fail "missing name must fail"; fi
case "$err" in *"$R/<attempt>/missing/"*) ;; *) fail "missing-name error must name the key: $err" ;; esac
if AS_NAME=none AS_PATH=nothing-here AS_IF_NO_FILES_FOUND=error bash "$lib" upload >/dev/null 2>&1; then fail "if-no-files-found=error must fail"; fi

# Re-upload of a name replaces it (a re-run of a failed job): no stale file survives.
rm tree/sub/b.txt; up dir tree; rm -rf "$t/got/dir"; down dir "$t/got/dir"
[ ! -e "$t/got/dir/sub/b.txt" ] || fail "re-upload must replace the prefix"
# A re-run (attempt 2) still finds attempt 1's files; once attempt 2 uploads the name, it wins.
echo v2 > v.txt; up attempted v.txt; echo v3 > v.txt
GITHUB_RUN_ATTEMPT=2 down attempted "$t/got/a1"; [ "$(cat "$t/got/a1/v.txt")" = v2 ] || fail "attempt 2 must find attempt 1's upload"
GITHUB_RUN_ATTEMPT=2 up attempted v.txt
GITHUB_RUN_ATTEMPT=2 down attempted "$t/got/a2"; [ "$(cat "$t/got/a2/v.txt")" = v3 ] || fail "the newest attempt must win"

# Publish: <app>/<version>/<file> immutable, <app>/latest/ + latest.json short-cached.
mkdir -p dist; echo inst > dist/App-1.2.0.dmg; echo sum > dist/SHA256SUMS.txt
APP=app; [ "$real" = 0 ] || APP="app-$GITHUB_RUN_ID"   # a shared real bucket keeps earlier runs' versions
pub() { AS_APP="$APP" AS_VERSION="$1" AS_PATH=dist AS_PUBLIC_BASE=https://dl.example.com "${@:2}" bash "$lib" publish; }
urls="$(pub 1.2.0)" || fail "publish"
case "$urls" in *"https://dl.example.com/$APP/1.2.0/App-1.2.0.dmg"*) ;; *) fail "publish urls: $urls" ;; esac
down_pub() { if [ "$real" = 1 ]; then AWS_ACCESS_KEY_ID="$AS_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$AS_SECRET_KEY" AWS_DEFAULT_REGION=us-east-1 \
  aws --endpoint-url "$AS_ENDPOINT" s3 cp "s3://$AS_BUCKET/$1" - 2>/dev/null; else cat "$t/s3/artifacts/$1"; fi; }
[ "$(down_pub $APP/1.2.0/App-1.2.0.dmg)" = inst ] && [ "$(down_pub $APP/latest/App-1.2.0.dmg)" = inst ] || fail "publish keys"
case "$(down_pub $APP/latest.json)" in *'"version":"1.2.0"'*'"url":"https://dl.example.com/'"$APP"'/1.2.0/App-1.2.0.dmg"'*) ;; *) fail "latest.json: $(down_pub $APP/latest.json)" ;; esac
if [ "$real" = 0 ]; then
  m="$(cat "$t/s3.meta/artifacts/app/1.2.0/App-1.2.0.dmg")"
  case "$m" in *"content-type=application/x-apple-diskimage"*"max-age=31536000, immutable"*) ;; *) fail "immutable metadata: $m" ;; esac
  case "$(cat "$t/s3.meta/artifacts/app/latest/App-1.2.0.dmg")" in *"max-age=300"*) ;; *) fail "latest must be short-cached" ;; esac
fi
if pub 1.2.0 >/dev/null 2>&1; then fail "re-publishing a version must be refused"; fi
pub 1.2.0 env AS_OVERWRITE=true >/dev/null || fail "overwrite: true must re-publish"

# A missing client fails loudly, before anything else.
[ "$real" = 1 ] || if err="$(PATH=/usr/bin:/bin AS_CLIENT=mc AS_NAME=file AS_PATH="$t/got/x" bash "$lib" download 2>&1)"; then fail "missing client must fail"; fi
[ "$real" = 1 ] || case "$err" in *"no S3 client"*) ;; *) fail "missing-client message: $err" ;; esac
echo "artifact-store roundtrip: ok"
