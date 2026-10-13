#!/usr/bin/env bash
# A throwaway S3-compatible store for .github/workflows/artifact-store.yml (#601): SeaweedFS's
# S3 gateway on 127.0.0.1:8333, data under $RUNNER_TEMP/store/data so a job can hand it to the
# next job through actions/cache. (MinIO no longer publishes images or binaries, hence SeaweedFS.)
#   store.sh start        — start, create the bucket `artifacts`
#   store.sh start-again  — start on data restored from an earlier job, wait until it is served
#   store.sh stop         — stop, and hand the data dir back to the runner user for caching
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
d="${RUNNER_TEMP:?}/store"; mkdir -p "$d/data"
export AWS_ACCESS_KEY_ID=testkey AWS_SECRET_ACCESS_KEY=testsecret AWS_DEFAULT_REGION=us-east-1
ep=(--endpoint-url http://127.0.0.1:8333)
wait_for() { local i; for i in $(seq 1 90); do if "$@" >/dev/null 2>&1; then return 0; fi; sleep 1; done; echo "store: timed out: $*" >&2; docker logs as-store 2>&1 | tail -20 >&2; return 1; }
listed() { [ -n "$(aws "${ep[@]}" s3 ls s3://artifacts/ --recursive 2>/dev/null)" ]; }
case "${1:-}" in
  start|start-again)
    docker run -d --name as-store -p 127.0.0.1:8333:8333 -v "$d/data:/data" \
      -v "$here/seaweedfs-s3.json:/etc/s3.json:ro" "${SEAWEEDFS_IMAGE:?}" \
      server -dir=/data -s3 -s3.config=/etc/s3.json -ip.bind=0.0.0.0 >/dev/null
    if [ "$1" = start ]; then wait_for aws "${ep[@]}" s3 mb s3://artifacts
    else wait_for listed; sleep 3; fi
    echo "store: up (${1})" ;;
  stop)
    docker stop as-store >/dev/null; docker rm as-store >/dev/null
    sudo chown -R "$(id -u):$(id -g)" "$d" ;;
  *) echo "usage: store.sh start|start-again|stop" >&2; exit 2 ;;
esac
