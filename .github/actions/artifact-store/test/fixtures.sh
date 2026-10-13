#!/usr/bin/env bash
# Deterministic fixtures for the two-job round-trip (#601): the consuming job regenerates them and
# compares, so nothing but the store carries bytes between the jobs.
set -euo pipefail
r="${1:?usage: fixtures.sh <dir>}"; rm -rf "$r"; mkdir -p "$r/tree/sub/deeper" "$r/tree/.cache"
echo "one file" > "$r/one.txt"
echo a > "$r/tree/a.txt"; echo "with space" > "$r/tree/sub/name with space.txt"
seq 1 200000 > "$r/tree/sub/deeper/numbers.txt"     # ~1.2 MB, more than one buffer
echo hidden > "$r/tree/.cache/hidden.txt"            # excluded by default, like upload-artifact
