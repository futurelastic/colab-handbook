#!/usr/bin/env bash
# A throwaway S3-compatible store that ENFORCES its region, for the bare-runner job of
# .github/workflows/artifact-store.yml (#753). SeaweedFS (store.sh) ignores the SigV4 region, so a
# region bug passes there (#752); Garage refuses a request signed for any region but its own.
# Garage's S3 API on 127.0.0.1:3900, region $GARAGE_REGION, bucket `artifacts`.
#   garage.sh start — start it, assign the layout, import a throwaway key minted here, create the
#                     bucket; the key goes to $GITHUB_ENV as AK / SK (masked), or to stdout as
#                     export lines outside a workflow
#   garage.sh stop
set -euo pipefail
: "${GARAGE_IMAGE:=dxflrs/garage:v1.1.0}" "${GARAGE_REGION:=eu-north-9}"
hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }
g() { docker exec as-garage /garage "$@"; }
case "${1:-}" in
  start)
    cfg="$(mktemp)"
    cat > "$cfg" <<EOF
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
rpc_secret = "$(hex 32)"
[s3_api]
s3_region = "$GARAGE_REGION"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"
EOF
    docker create --name as-garage -p 127.0.0.1:3900:3900 "$GARAGE_IMAGE" >/dev/null
    docker cp "$cfg" as-garage:/etc/garage.toml; rm -f "$cfg"
    docker start as-garage >/dev/null
    node=""
    for _ in $(seq 1 60); do node="$(g status 2>/dev/null | awk '/^[0-9a-f]{16}/{print $1; exit}')" && [ -n "$node" ] && break; sleep 1; done
    [ -n "$node" ] || { docker logs as-garage 2>&1 | tail -20 >&2; echo "garage: never came up" >&2; exit 1; }
    g layout assign -z dc1 -c 1G "$node" >/dev/null
    g layout apply --version 1 >/dev/null
    key_id="GK$(hex 12)"; key_secret="$(hex 32)"   # Garage's own formats: GK + 24 hex, 64 hex
    g key import --yes -n test "$key_id" "$key_secret" >/dev/null
    g bucket create artifacts >/dev/null
    g bucket allow --read --write --owner artifacts --key test >/dev/null
    if [ -n "${GITHUB_ENV:-}" ]; then
      echo "::add-mask::$key_secret"; printf 'AK=%s\nSK=%s\n' "$key_id" "$key_secret" >> "$GITHUB_ENV"
    else printf 'export AK=%s SK=%s\n' "$key_id" "$key_secret"; fi
    echo "garage: up (region $GARAGE_REGION)" >&2 ;;
  stop) docker rm -f as-garage >/dev/null ;;
  *) echo "usage: garage.sh start|stop" >&2; exit 2 ;;
esac
