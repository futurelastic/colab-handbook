#!/bin/sh
# The fast local check code-wrap A3 runs once on this repo (`gate.smoke` in
# .github/project.yml, #412). Branch CI (.github/workflows/ci.yml) is the verdict;
# this only catches the cheap mistakes before the push:
#   1. syntax of every shipped script (the same list CI checks),
#   2. stray control bytes in tracked text,
#   3. the self-audit,
#   4. the unit tests for what this branch changed — a tools/lib/<m>.test.js runs when
#      it, or its module tools/lib/<m>.js, differs from origin/main. Everything else
#      is left to CI's full run.
set -eu
cd "$(git rev-parse --show-toplevel)"

node --check tools/colab
for f in tools/lib/*.js audit/audit.mjs; do node --check "$f"; done
sh -n install.sh
for f in .githooks/install.sh templates/pre-commit-identity templates/pre-commit-dispatch \
         .githooks/pre-commit .githooks/pre-commit.d/*; do sh -n "$f"; done
node scripts/check-text-bytes.mjs
node audit/audit.mjs --local . >/dev/null
node scripts/check-pack-allowlist.mjs

base="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD)"
tests=""
for p in $( { git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u); do
  case "$p" in
    tools/lib/*.test.js) t="$p" ;;
    tools/lib/*.js) t="${p%.js}.test.js" ;;
    *) continue ;;
  esac
  [ -f "$t" ] && case " $tests " in *" $t "*) ;; *) tests="$tests $t" ;; esac
done

if [ -n "$tests" ]; then
  echo "smoke: changed tests:$tests"
  # shellcheck disable=SC2086
  env -u NODE_TEST_CONTEXT -u NODE_TEST_WORKER_ID node --test $tests
else
  echo "smoke: no tools/lib module or test changed — unit tests left to branch CI"
fi
echo "smoke: ok"
