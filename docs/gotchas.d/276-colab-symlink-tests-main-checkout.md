# The installed `colab` symlink runs the MAIN checkout's copy, even from inside a worktree

Verifying a fix to `tools/colab` itself by running the globally-installed `colab`
command from inside a linked worktree tests the **wrong file** — silently.

## What happened

`~/.local/bin/colab` (or wherever it's installed) is a symlink straight to the
**main checkout's** `tools/colab` (`git.mainRepoRoot()`-resolved at install time, not
per-invocation). A worktree carries its own copy of `tools/colab` on its branch —
that copy is what you just edited — but `colab`, invoked from anywhere including
from inside that worktree's directory, always executes the main checkout's copy.

While chasing #276 (a bug where `cmdTemplate`'s default-dest branch wrote into the
main checkout instead of the calling worktree), the first reproduction attempt ran
`colab template ci-node` from inside the worktree *after* the fix was already
committed there — and the bug still reproduced, because the binary on PATH was
still running the old, unpatched main-checkout code. The fix was real; the
verification method was testing something else entirely.

## The fix (verification technique, not a code change)

When testing a change to `tools/colab` itself, run the worktree's own copy
directly, bypassing the symlink:

```sh
cd <repo>/.worktrees/<slug>
./tools/colab template ci-node     # NOT the bare `colab` on PATH
```

## Why this matters beyond #276

Any session testing a `tools/colab` change from inside a worktree — not just this
one — will silently get a false negative (bug "still reproduces") or a false
positive (fix "already works", because it was never actually exercised) unless it
runs `./tools/colab` from the worktree explicitly. The installed symlink is a
convenience for using `colab` as a tool; it is not a way to run `colab`-the-repo's
own code under test.
