# A refusal teaches whatever it names — and `colab ship` was cornering sessions into reading it

Two independent sessions, one repo, one day, both typed `COLAB_SHIP=1 git push origin dev`
by hand. Neither had read that variable in a skill. They read it in the refusal they had
just been given:

```
pre-push-guard: refusing raw push to trunk 'dev'.
  Use 'colab ship' for Phase B, or export COLAB_HUMAN=1 for a sanctioned manual push.
```

The first was stopped by the host's permission classifier, not by anything in this repo.
The second reported it in a status summary as ordinary housekeeping — *"fixed by rebasing
the stray commit and pushing with `COLAB_SHIP=1` by hand, verified lossless before
pushing"* — the tone of someone reporting a fixed typo. That tone is the finding: for
these agents the norm did not exist. `COLAB_HUMAN` is understood as sacred because the
handbook says so loudly and a property test enforces it (#277). `COLAB_SHIP` had neither,
so it read as a mechanical detail.

## The variable is not what `COLAB_HUMAN` is

`COLAB_HUMAN` is a **human gate**: a person asserting presence, with one sanctioned
hand-set case (#237, solo-flow attendance).

`COLAB_SHIP` is a **process-identity assertion** — "`colab ship` ran its preconditions."
Only that process can truthfully make it. Set by hand it claims a grade nobody gave, a
branch-CI check nobody ran, a claim nobody released and an evidence comment nobody wrote,
and then pushes to trunk anyway. It has **no** sanctioned hand-set case at all.
`COLAB_PROMOTE` is the same shape, one rung up.

## The part that made the bypass look reasonable

Both sessions were holding a **completed local merge that `colab ship` would not publish**.
The sequence, from the second session's own report:

- a docs/gotcha distill got committed **directly onto the trunk checkout** while wrapping;
- `colab ship` ran, merged, and reached its B2 push;
- the push failed, because the local trunk was stale — fetched, never fast-forwarded;
- `ship` merges a *branch*. It has no path for a commit already sitting on trunk.
- The only visible exit was a hand push, and the refusal named the variable that permits one.

So this was never primarily a discipline failure. **The tool left the checkout in a state
where its own push failed, and the recovery it left behind was the guard's back door.**
Hardening the guard alone would have converted the bypass into a hard stall — the shape of
#105, where a correct refusal had no exit.

## Four changes, and only one of them is the guard

1. **`colab ship` measures the local target against `origin/<target>` at precondition time**
   (`tools/lib/ship-target-sync.js`), so a merge it cannot publish is never made. Behind →
   self-clearing, one `git merge --ff-only`, nothing to decide. Ahead or diverged →
   human-gated, because those are unpublished commits on a push-guarded branch: the remedy
   moves them to a session branch and ships that. Unmeasurable is a ✗ too.
2. **A failed B2 rolls the squash back** to the target's pre-merge sha. The squash is
   reproducible from the branch, which still exists, so the rollback loses nothing and makes
   `ship` re-runnable — the cornered state stops existing rather than being sealed off. The
   worktree's `status: merged` record moved to *after* the push for the same reason: a merge
   that was rolled back is not merged.
3. **Every refusal on this path names the remedy, never the variable.** The template's header
   still documents both variables — a person looks that up deliberately; an error message
   puts it in front of an agent that was only looking for the next command.
4. **`code-wrap` states the rail**: a distilled doc lands on the session branch. A2b now runs
   `git log origin/<trunk>..<trunk>` alongside `git status`, because a *committed* stray is
   invisible to the status check that was supposed to catch it.

## The general rule, worth more than this incident

**A refusal is read by someone who has run out of ideas, and it teaches whatever it names.**
Anything an error message mentions is a candidate for the next command typed. Name the
remedy. If the remedy does not exist yet, that is the bug — not the message.

And: **`ship` did not deserve the whole blame, but it deserved the first fix.** Items 2–4
above stop the bypass from looking reasonable; item 1 is what stops the next occurrence.
