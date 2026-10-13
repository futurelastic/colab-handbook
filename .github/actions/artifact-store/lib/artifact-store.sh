#!/usr/bin/env bash
# artifact-store — the one implementation behind the upload/ and download/ composite actions
# (#601). Usage: artifact-store.sh upload|download|publish, configured entirely by AS_* env vars
# that the two action.yml files map from their inputs. Doc: docs/artifact-store.md.
#
# ONE script for Linux, macOS and Windows (Git for Windows' bash, which is what `shell: bash`
# runs there). Deliberately no pwsh twin: two implementations of one logic drift. It must stay
# bash 3.2-clean — macOS still ships 3.2 — so: no globstar, no mapfile, no associative arrays,
# and every possibly-empty array expanded as ${a[@]+"${a[@]}"} (3.2 + `set -u` treats an empty
# "${a[@]}" as unbound).
#
# Artifact keys: [<key-prefix>/]<owner>/<repo>/<run_id>/<run_attempt>/<name>/<relative path>.
# An upload writes under its own attempt; a download takes the NEWEST attempt holding the name,
# so a re-run of failed jobs still finds what an earlier attempt's jobs uploaded, and a job that
# re-ran wins over its own earlier attempt.
# Publish keys (mode publish): [<key-prefix>/]<app>/<version>/<file>, immutable, plus a
# short-cache <app>/latest/<file> copy and <app>/latest.json — what release jobs hand to users.
#
# Every aws call carries --endpoint-url: AWS CLI before 2.13 ignores AWS_ENDPOINT_URL.
set -euo pipefail

die() { printf '::error title=artifact-store::%s\n' "$*"; exit 1; }
note() { printf '::notice title=artifact-store::%s\n' "$*"; }
warn() { printf '::warning title=artifact-store::%s\n' "$*"; }
out() { [ -n "${GITHUB_OUTPUT:-}" ] && printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; printf '  %s=%s\n' "$1" "$2"; }

# Windows paths (D:\a\x) → /d/a/x, so one path logic serves all three OSes.
topath() { if command -v cygpath >/dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
abspath() { local p; p="$(topath "$1")"; case "$p" in /*) printf '%s' "$p" ;; *) printf '%s/%s' "$PWD" "$p" ;; esac; }
trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; s="${s%"${s##*[![:space:]]}"}"; printf '%s' "$s"; }
truthy() { case "$1" in true|True|TRUE|1|yes) return 0 ;; *) return 1 ;; esac; }

MODE="${1:-}"
case "$MODE" in upload|download|publish) ;; *) die "usage: artifact-store.sh upload|download|publish (got '${MODE}')" ;; esac

BUCKET="${AS_BUCKET:-}"
[ -n "$BUCKET" ] || die "input 'bucket' is empty — pass it from a secret or a variable (docs/artifact-store.md)"
ENDPOINT="${AS_ENDPOINT:-}"
REGION="${AS_REGION:-us-east-1}"
ADDRESSING="${AS_ADDRESSING_STYLE:-path}"
case "$ADDRESSING" in path|virtual|auto) ;; *) die "addressing-style must be path, virtual or auto (got '$ADDRESSING')" ;; esac
PART_SIZE="${AS_PART_SIZE:-64MB}"
PREFIX="${AS_KEY_PREFIX:-}"; PREFIX="${PREFIX#/}"; PREFIX="${PREFIX%/}"
pfx() { if [ -n "$PREFIX" ]; then printf '%s/%s' "$PREFIX" "$1"; else printf '%s' "$1"; fi; }
if [ "$MODE" != publish ]; then
  REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set — run this inside a workflow}"
  RUN_ID="${AS_RUN_ID:-}"; [ -n "$RUN_ID" ] || RUN_ID="${GITHUB_RUN_ID:?GITHUB_RUN_ID is not set}"
  ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}"
  RUN_KEY="$(pfx "$REPO/$RUN_ID")"
fi

[ -z "${AS_SECRET_KEY:-}" ] || printf '::add-mask::%s\n' "$AS_SECRET_KEY"
TMP_ROOT="$(abspath "${RUNNER_TEMP:-${TMPDIR:-/tmp}}")"
WORK="$(mktemp -d "$TMP_ROOT/artifact-store.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

valid_name() {
  [ -n "$1" ] || die "input 'name' is empty"
  case "$1" in
    */*|*\\*|*:*|*\**|*\?*|*\"*|*\<*|*\>*|*\|*|.|..) die "artifact name '$1' contains a character not allowed in a name (/ \\ : * ? \" < > |)" ;;
  esac
}

# --- client: the runner's own; never installed here ------------------------------------------
# mc is also Midnight Commander's binary name on many Linux hosts, and some distros package the
# MinIO client as `mcli` — so a candidate counts only when its --version says MinIO.
is_minio_mc() { "$1" --version 2>/dev/null | grep -qi minio; }
CLIENT=""
pick_client() {
  local want="${AS_CLIENT:-auto}" c
  case "$want" in
    aws) command -v aws >/dev/null 2>&1 && CLIENT=aws ;;
    mc)  for c in mc mcli; do command -v "$c" >/dev/null 2>&1 && is_minio_mc "$c" && { CLIENT="$c"; break; }; done ;;
    auto)
      if command -v aws >/dev/null 2>&1; then CLIENT=aws
      else for c in mc mcli; do command -v "$c" >/dev/null 2>&1 && is_minio_mc "$c" && { CLIENT="$c"; break; }; done; fi ;;
    *) die "client must be auto, aws or mc (got '$want')" ;;
  esac
  [ -n "$CLIENT" ] || die "no S3 client on this runner (client: $want). Install the AWS CLI or the MinIO client (mc) on the runner image — this action never installs one at job time."
}

AWS_EP=()
setup_aws() {
  # A private config file, so the runner's own ~/.aws profile can neither leak in nor be edited.
  export AWS_CONFIG_FILE="$WORK/aws-config" AWS_SHARED_CREDENTIALS_FILE="$WORK/aws-credentials"
  unset AWS_PROFILE AWS_DEFAULT_PROFILE
  : > "$AWS_SHARED_CREDENTIALS_FILE"
  cat > "$AWS_CONFIG_FILE" <<EOF
[default]
region = $REGION
request_checksum_calculation = when_required
response_checksum_validation = when_required
s3 =
  addressing_style = $ADDRESSING
  multipart_threshold = $PART_SIZE
  multipart_chunksize = $PART_SIZE
EOF
  [ -z "${AS_ACCESS_KEY:-}" ] || export AWS_ACCESS_KEY_ID="$AS_ACCESS_KEY"
  [ -z "${AS_SECRET_KEY:-}" ] || export AWS_SECRET_ACCESS_KEY="$AS_SECRET_KEY"
  export AWS_DEFAULT_REGION="$REGION" AWS_REGION="$REGION"
  [ -z "$ENDPOINT" ] || AWS_EP=(--endpoint-url "$ENDPOINT")
}

setup_mc() {
  export MC_CONFIG_DIR="$WORK/mc"
  local url="${ENDPOINT:-https://s3.amazonaws.com}" path=on
  case "$ADDRESSING" in path) path=on ;; virtual) path=off ;; auto) path=auto ;; esac
  [ "$PART_SIZE" = 64MB ] || note "part-size is an AWS CLI setting; mc picks its own part size (16 MiB below ~156 GiB per object)."
  "$CLIENT" alias set store "$url" "${AS_ACCESS_KEY:-}" "${AS_SECRET_KEY:-}" --api S3v4 --path "$path" >/dev/null \
    || die "mc could not configure the store at $url (check endpoint, access-key, secret-key)"
}

uri() { if [ "$CLIENT" = aws ]; then printf 's3://%s/%s' "$BUCKET" "$1"; else printf 'store/%s/%s' "$BUCKET" "$1"; fi; }

# put_dir <local dir> <key>: the key's prefix becomes exactly the dir's contents.
put_dir() {
  if [ "$CLIENT" = aws ]; then
    aws ${AWS_EP[@]+"${AWS_EP[@]}"} s3 sync "$1" "$(uri "$2")/" --delete --only-show-errors --no-progress
  else
    "$CLIENT" mirror --overwrite --remove --quiet "$1/" "$(uri "$2")/"
  fi
}
get_dir() {
  mkdir -p "$2"
  if [ "$CLIENT" = aws ]; then
    aws ${AWS_EP[@]+"${AWS_EP[@]}"} s3 sync "$(uri "$1")/" "$2" --only-show-errors --no-progress
  else
    "$CLIENT" mirror --overwrite --quiet "$(uri "$1")/" "$2/"
  fi
}
# has_key <key>: 0 = at least one object under it, 1 = none. A store or auth error is fatal —
# "missing" must never be a guess standing in for "could not ask".
has_key() {
  local o rc=0
  if [ "$CLIENT" = aws ]; then
    o="$(aws ${AWS_EP[@]+"${AWS_EP[@]}"} s3 ls "$(uri "$1")/" --recursive 2>"$WORK/err")" || rc=$?
    [ "$rc" -le 1 ] || die "listing s3://$BUCKET/$1/ failed: $(cat "$WORK/err")"
  else
    o="$("$CLIENT" ls --recursive "$(uri "$1")/" 2>"$WORK/err")" || rc=$?
    if [ "$rc" -ne 0 ] && ! grep -qiE 'does not exist|not found|no such' "$WORK/err"; then
      die "listing s3://$BUCKET/$1/ failed: $(cat "$WORK/err")"
    fi
  fi
  [ -n "$o" ]
}
# list_dirs <key>: the immediate "sub-directories" (common prefixes) under a key, one per line.
list_dirs() {
  local rc=0
  if [ "$CLIENT" = aws ]; then
    aws ${AWS_EP[@]+"${AWS_EP[@]}"} s3 ls "$(uri "$1")/" > "$WORK/ls" 2>"$WORK/err" || rc=$?
    [ "$rc" -le 1 ] || die "listing s3://$BUCKET/$1/ failed: $(cat "$WORK/err")"
    sed -n 's#^ *PRE \(.*\)/$#\1#p' "$WORK/ls"
  else
    "$CLIENT" ls --json "$(uri "$1")/" > "$WORK/ls" 2>"$WORK/err" || rc=$?
    if [ "$rc" -ne 0 ] && ! grep -qiE 'does not exist|not found|no such' "$WORK/err" "$WORK/ls"; then
      die "listing s3://$BUCKET/$1/ failed: $(cat "$WORK/err")"
    fi
    grep -o '"key":"[^"]*/"' "$WORK/ls" | sed 's#^"key":"\(.*\)/"$#\1#'
  fi
}
# attempts: this run's attempt numbers that hold anything, newest first.
attempts() { local d; d="$(list_dirs "$RUN_KEY")"; printf '%s\n' "$d" | grep -E '^[0-9]+$' | sort -rn || true; }
# put_file <local file> <key> <content-type> <cache-control>
put_file() {
  if [ "$CLIENT" = aws ]; then
    aws ${AWS_EP[@]+"${AWS_EP[@]}"} s3 cp "$1" "$(uri "$2")" --content-type "$3" --cache-control "$4" --only-show-errors --no-progress
  else
    "$CLIENT" cp --quiet --attr "Content-Type=$3;Cache-Control=$4" "$1" "$(uri "$2")"
  fi
}

# --- path matching: upload-artifact's glob dialect, as ERE (bash 3.2 has no globstar) --------
glob_re() {
  local g="$1" re="" c i=0 n=${#1}
  while [ "$i" -lt "$n" ]; do
    c="${g:$i:1}"
    case "$c" in
      '*') if [ "${g:$i:2}" = '**' ]; then
             if [ "${g:$((i+2)):1}" = / ]; then re="$re(.*/)?"; i=$((i+3)); else re="$re.*"; i=$((i+2)); fi
             continue
           fi
           re="$re[^/]*" ;;
      '?') re="$re[^/]" ;;
      '[') if [ "${g:$((i+1)):1}" = '!' ]; then re="$re[^"; i=$((i+1)); else re="$re["; fi ;;
      ']') re="$re]" ;;
      '.'|'+'|'^'|'$'|'('|')'|'{'|'}'|'|'|'\') re="$re\\$c" ;;
      *) re="$re$c" ;;
    esac
    i=$((i+1))
  done
  printf '^%s$' "$re"
}
has_glob() { case "$1" in *[\*\?\[]*) return 0 ;; *) return 1 ;; esac; }
# The directory part before the first component that holds a wildcard.
glob_base() {
  local p="$1" b=""; local IFS=/; set -f
  for c in $p; do has_glob "$c" && break; b="$b/$c"; done
  set +f; b="${b#/}"; printf '/%s' "${b#/}"
}
common_dir() { # longest shared directory prefix of $1 and $2
  local a="$1/" b="$2/" r=""
  while [ -n "$a" ]; do
    local seg="${a%%/*}/"; case "$b" in "$r$seg"*) r="$r$seg"; a="${a#*/}" ;; *) break ;; esac
  done
  r="${r%/}"; printf '%s' "${r:-/}"
}

# stage_paths: resolve AS_PATH (upload-artifact's dialect) into $STAGE, preserving paths
# relative to the least common ancestor of the include patterns' non-glob parts. Sets COUNT, ROOT.
STAGE=""; COUNT=0; ROOT=""
stage_paths() {
  [ -n "${AS_PATH:-}" ] || die "input 'path' is empty"
  local -a inc_pat inc_base exc_pat
  local line p rb
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(trim "${line%$'\r'}")"; [ -n "$line" ] || continue
    case "$line" in
      '!'*) exc_pat+=("$(abspath "$(trim "${line#!}")")") ;;
      *) p="$(abspath "$line")"; p="${p%/}"; [ -n "$p" ] || p=/
         if has_glob "$p"; then rb="$(glob_base "$p")"
         elif [ -d "$p" ]; then rb="$p"
         else rb="$(dirname "$p")"; fi
         inc_pat+=("$p"); inc_base+=("$rb")
         if [ -z "$ROOT" ]; then ROOT="$rb"; else ROOT="$(common_dir "$ROOT" "$rb")"; fi ;;
    esac
  done <<< "$AS_PATH"
  [ "${#inc_pat[@]}" -gt 0 ] || die "input 'path' names no include pattern (only '!' excludes?)"

  STAGE="$WORK/stage"; mkdir -p "$STAGE"
  local i=0 f rel q re xre keep e hidden=1
  truthy "${AS_INCLUDE_HIDDEN_FILES:-false}" || hidden=0
  while [ "$i" -lt "${#inc_pat[@]}" ]; do
    p="${inc_pat[$i]}"; rb="${inc_base[$i]}"; i=$((i+1))
    re=""; has_glob "$p" && re="$(glob_re "$p")"
    [ -e "$rb" ] || continue   # a missing literal path or glob base matches nothing
    while IFS= read -r f; do
      if [ -n "$re" ]; then
        # A glob that matches a directory takes everything under it (upload-artifact does too).
        keep=0; q="$f"
        while [ "${#q}" -gt "${#rb}" ]; do [[ "$q" =~ $re ]] && { keep=1; break; }; q="$(dirname "$q")"; done
        [ "$keep" = 1 ] || continue
      fi
      if [ "$ROOT" = / ]; then rel="${f#/}"; else rel="${f#"$ROOT"/}"; fi
      if [ "$hidden" = 0 ]; then case "/$rel" in */.*) continue ;; esac; fi
      keep=1
      for e in ${exc_pat[@]+"${exc_pat[@]}"}; do
        if has_glob "$e"; then q="$f"; xre="$(glob_re "$e")"
          while [ "${#q}" -gt 1 ]; do [[ "$q" =~ $xre ]] && { keep=0; break; }; q="$(dirname "$q")"; done
        else case "$f" in "$e"|"$e"/*) keep=0 ;; esac; fi
        [ "$keep" = 1 ] || break
      done
      [ "$keep" = 1 ] || continue
      [ -e "$STAGE/$rel" ] && continue
      mkdir -p "$STAGE/$(dirname "$rel")"
      if [ -L "$f" ]; then cp -pL "$f" "$STAGE/$rel"; else ln "$f" "$STAGE/$rel" 2>/dev/null || cp -p "$f" "$STAGE/$rel"; fi
      COUNT=$((COUNT+1))
    done < <(if [ -n "$re" ] || [ -d "$p" ]; then find -L "$rb" -type f; elif [ -f "$p" ]; then printf '%s\n' "$p"; fi)
  done
}
no_files() { # <what> — applies if-no-files-found; returns 0 when the caller should stop quietly
  case "${AS_IF_NO_FILES_FOUND:-warn}" in
    error) die "no files matched path — nothing $1" ;;
    warn) warn "no files matched path — nothing $1" ;;
    ignore) ;;
    *) die "if-no-files-found must be warn, error or ignore (got '${AS_IF_NO_FILES_FOUND}')" ;;
  esac
}
connect() { pick_client; if [ "$CLIENT" = aws ]; then setup_aws; else setup_mc; fi; }

upload() {
  local name="${AS_NAME:-artifact}"; valid_name "$name"
  case "${AS_IF_NO_FILES_FOUND:-warn}" in warn|error|ignore) ;; *) die "if-no-files-found must be warn, error or ignore (got '${AS_IF_NO_FILES_FOUND}')" ;; esac
  [ -z "${AS_RETENTION_DAYS:-}" ] || note "retention-days=${AS_RETENTION_DAYS} has no per-object meaning on an S3 store; expiry is the bucket's lifecycle rule (docs/artifact-store.md, 'Retention')."
  stage_paths
  local key="$RUN_KEY/$ATTEMPT/$name"
  if [ "$COUNT" -eq 0 ]; then no_files "uploaded for artifact '$name'"; out key ""; out file-count 0; return 0; fi
  connect
  echo "artifact-store: uploading $COUNT file(s) from $ROOT to s3://$BUCKET/$key/ (client $CLIENT)"
  put_dir "$STAGE" "$key" || die "upload FAILED for artifact '$name' to s3://$BUCKET/$key/ (client $CLIENT)"
  out key "s3://$BUCKET/$key/"; out file-count "$COUNT"
}

content_type() {
  [ -z "${AS_CONTENT_TYPE:-}" ] || { printf '%s' "$AS_CONTENT_TYPE"; return; }
  case "$(printf '%s' "${1##*.}" | tr '[:upper:]' '[:lower:]')" in
    dmg) printf application/x-apple-diskimage ;;     zip) printf application/zip ;;
    gz|tgz) printf application/gzip ;;               json) printf application/json ;;
    txt|sha256|sha512|asc|sig) printf 'text/plain; charset=utf-8' ;;
    html|htm) printf 'text/html; charset=utf-8' ;;   yml|yaml) printf 'application/yaml' ;;
    xml) printf application/xml ;;                   deb) printf application/vnd.debian.binary-package ;;
    msi) printf application/x-msi ;;                 exe) printf application/vnd.microsoft.portable-executable ;;
    apk) printf application/vnd.android.package-archive ;;
    png) printf image/png ;;                         svg) printf image/svg+xml ;;
    *) printf application/octet-stream ;;
  esac
}
seg_ok() { # an app/version is one path segment
  [ -n "$2" ] || die "input '$1' is empty (required for mode: publish)"
  case "$2" in */*|*\\*|.|..|latest) die "input '$1'='$2' must be one path segment, and not 'latest'" ;; esac
}
json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

publish() {
  local app="${AS_APP:-}" ver="${AS_VERSION:-}" base="${AS_PUBLIC_BASE:-}"
  seg_ok app "$app"; seg_ok version "$ver"; base="${base%/}"
  local cc="${AS_CACHE_CONTROL:-public, max-age=31536000, immutable}"
  local lcc="${AS_LATEST_CACHE_CONTROL:-public, max-age=300}"
  stage_paths
  local vkey; vkey="$(pfx "$app/$ver")"
  if [ "$COUNT" -eq 0 ]; then no_files "published for $app $ver"; return 0; fi
  connect
  # Immutable means immutable: a version already holding files is refused, never silently
  # replaced under a one-year cache header (overwrite: true is the deliberate way out).
  if has_key "$vkey" && ! truthy "${AS_OVERWRITE:-false}"; then
    die "s3://$BUCKET/$vkey/ already holds files — a published version is immutable. Bump the version, or pass overwrite: true deliberately."
  fi
  local f rel ct urls="" lurls="" files="" sep="" latest=1
  truthy "${AS_LATEST:-true}" || latest=0
  while IFS= read -r f; do
    rel="${f#"$STAGE"/}"; ct="$(content_type "$rel")"
    put_file "$f" "$vkey/$rel" "$ct" "$cc" || die "publish FAILED for s3://$BUCKET/$vkey/$rel"
    urls="$urls${base:+$base/}$vkey/$rel"$'\n'
    files="$files$sep{\"name\":\"$(json_str "$rel")\",\"url\":\"$(json_str "${base:+$base/}$vkey/$rel")\"}"; sep=","
    if [ "$latest" = 1 ]; then
      put_file "$f" "$(pfx "$app/latest")/$rel" "$ct" "$lcc" || die "publish FAILED for s3://$BUCKET/$(pfx "$app/latest")/$rel"
      lurls="$lurls${base:+$base/}$(pfx "$app/latest")/$rel"$'\n'
    fi
  done < <(find "$STAGE" -type f | sort)
  if [ "$latest" = 1 ]; then
    printf '{"app":"%s","version":"%s","files":[%s]}\n' "$(json_str "$app")" "$(json_str "$ver")" "$files" > "$WORK/latest.json"
    put_file "$WORK/latest.json" "$(pfx "$app")/latest.json" application/json "$lcc" || die "publish FAILED for latest.json"
  fi
  echo "artifact-store: published $COUNT file(s) as $app $ver to s3://$BUCKET/$vkey/ (client $CLIENT)"
  out key "s3://$BUCKET/$vkey/"; out file-count "$COUNT"
  { [ -z "${GITHUB_OUTPUT:-}" ] || printf 'urls<<__AS_EOF__\n%s__AS_EOF__\nlatest-urls<<__AS_EOF__\n%s__AS_EOF__\n' "$urls" "$lurls" >> "$GITHUB_OUTPUT"; }
  printf '%s' "$urls"
}

download() {
  local dest="${AS_PATH:-}"; [ -n "$dest" ] || dest="${GITHUB_WORKSPACE:-$PWD}"
  dest="$(abspath "$dest")"; dest="${dest%/}"
  local name="${AS_NAME:-}" pattern="${AS_PATTERN:-}" merge=0 n a names got=0 seen=" "
  truthy "${AS_MERGE_MULTIPLE:-false}" && merge=1
  connect
  local all; all="$(attempts | tr '\n' ' ')"
  if [ -n "$name" ]; then
    valid_name "$name"
    for a in $all; do
      if has_key "$RUN_KEY/$a/$name"; then
        get_dir "$RUN_KEY/$a/$name" "$dest" || die "download FAILED for s3://$BUCKET/$RUN_KEY/$a/$name/"
        echo "artifact-store: downloaded '$name' (attempt $a) to $dest"; got=1; break
      fi
    done
    [ "$got" = 1 ] || die "no artifact named '$name' — looked for s3://$BUCKET/$RUN_KEY/<attempt>/$name/ in attempts [${all% }] of run $RUN_ID. Was it uploaded by this run, with the same bucket and key-prefix?"
  else
    for a in $all; do
      names="$(list_dirs "$RUN_KEY/$a")"   # not < <(…): a die in a process substitution would not stop us
      while IFS= read -r n; do
        [ -n "$n" ] || continue
        case "$seen" in *" $n "*) continue ;; esac     # newest attempt wins per name
        # shellcheck disable=SC2053 # the pattern is a glob on purpose
        [ -z "$pattern" ] || [[ "$n" == $pattern ]] || continue
        seen="$seen$n "
        if [ "$merge" = 1 ]; then get_dir "$RUN_KEY/$a/$n" "$dest"; else get_dir "$RUN_KEY/$a/$n" "$dest/$n"; fi \
          || die "download FAILED for s3://$BUCKET/$RUN_KEY/$a/$n/"
        echo "artifact-store: downloaded '$n' (attempt $a)"; got=$((got+1))
      done <<< "$names"
    done
    [ "$got" -gt 0 ] || die "no artifact matching '${pattern:-*}' under s3://$BUCKET/$RUN_KEY/ (run $RUN_ID)"
  fi
  out download-path "$(cd "$dest" && pwd)"
}

"$MODE"
