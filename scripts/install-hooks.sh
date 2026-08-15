#!/bin/sh
# install-hooks.sh — point git at .githooks/ (idempotent; once per clone, per machine).
# core.hooksPath lives in .git/config, so it is machine-local and never synced.
#
# .githooks/pre-commit is a dispatcher: it runs every hooklet in .githooks/pre-commit.d/
# and fails if any of them fails, so the executable bit has to be set on the directory's
# contents too — a hooklet that is not executable is refused loudly rather than skipped.
set -e

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "❌ Not a git repo. Run 'git init' first."
  exit 1
}
cd "$repo_root"

chmod +x .githooks/* 2>/dev/null || true
chmod +x .githooks/pre-commit.d/* 2>/dev/null || true
# The dispatcher and the identity scan exec the templates directly (see .githooks/pre-commit).
chmod +x templates/pre-commit-dispatch templates/pre-commit-identity 2>/dev/null || true
git config core.hooksPath .githooks

echo "✅ core.hooksPath = .githooks"
echo "   pre-commit runs: $(ls .githooks/pre-commit.d 2>/dev/null | tr '\n' ' ')"
echo "   The identity scan needs a vocabulary, which is NEVER in this repo:"
echo "     cp templates/identity-vocabulary.example ~/.colab/identity-vocabulary   # then edit it"
echo "   Without one it warns and passes, exactly as the secret scan does with no gitleaks."
