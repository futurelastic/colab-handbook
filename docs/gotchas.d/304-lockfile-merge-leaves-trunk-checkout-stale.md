# A merge that changes a dependency lockfile leaves the SHARED TRUNK CHECKOUT installed-stale — and a regen daemon then deletes committed files, blocking every other session's ship

`colab ship` commits the squash **in the trunk checkout itself** when the target is
trunk (`targetDir === repoAbs`), not in a throwaway worktree. Merging a branch does
not run `composer install` or `npm ci`, so after the merge the checkout's installed
tree disagrees with its own lockfile. On a repo that commits generated output, that
disagreement does not stay quiet — it deletes files.

## What happened

On a Laravel/Inertia repo (`exposure: released`, `writes: isolated`, wayfinder-style
route bindings committed to the tree), a session merged a branch adding a Composer
package whose **service provider** registers routes — nothing in `routes/web.php`, all
of it in the provider. After the squash landed on trunk:

- `composer.lock` on trunk listed the new package.
- `vendor/` was **not** re-installed — the merge does not install anything.
- The provider therefore never loaded, so `php artisan route:list` reported the new
  package's routes as **absent**.
- A `KeepAlive` trunk dev server regenerated the wayfinder output from `route:list` on
  its own cadence, saw the routes gone, and **deleted 9 previously-committed output
  files**.
- The trunk checkout was now dirty, so `colab ship`'s "trunk checkout ready"
  precondition blocked **every other session's merge** — including one whose diff only
  touched `.github/workflows/**`.

The tell that distinguishes this from an agent deleting something on purpose is
`deleted file mode` in the diff, not a content edit. Nine files vanishing with no
author is the symptom; a stale `vendor/` two merges ago is the cause, and nothing on
screen connects them.

## Why the blast radius is repo-wide, not session-local

This is the part that makes it worth a hook rather than a note. The session that
*caused* the skew is long finished. The session that *pays* is whoever ships next, and
their diff is unrelated — the dirty-trunk precondition is repo-wide by design. So the
cost is paid by someone with no context for it, which is exactly the shape that gets
mis-diagnosed as "someone deleted files" rather than "someone added a dependency".

## What colab does about it (#304)

`colab ship` step **e2**, immediately after the push, trunk targets only:

- Runs the repo's `.colab/hooks/post-ship` on the trunk checkout, if it has one, with
  `COLAB_TARGET`, `COLAB_SHA` and `COLAB_LOCKFILES` (csv of lockfiles this merge
  changed) in the environment. That is where `composer install` / `npm ci` /
  `php artisan migrate` / a dev-server restart belong.
- With **no** hook, and a lockfile did change: a warning naming the file and the
  install command, printed in the deferred block *after* the `✓ Shipped` line so it
  cannot scroll out of view.

**`colab` never runs a package manager on your checkout itself.** Not a limitation —
the same rule that keeps DB cloning out of the portable core (`HELP_WORKTREE`'s hooks
contract: "machine-specific steps live in OPTIONAL repo hooks, not here"). The trunk
checkout may carry local platform config, a half-migrated database, or a dev server
mid-request; a CLI that installs into it uninvited is doing something it cannot know
is safe. The three lines of shell belong to the repo that knows.

A `post-ship` hook that exits non-zero is a **warning, never a failed ship** — the push
already landed, and a non-zero exit there would read as "ship failed" and invite a
re-merge. And a `post-ship` hook **must leave the trunk checkout clean**, or it
reproduces this very gotcha by a different route.

## Where it does NOT apply

A merge into a declared `integration:` line happens in an ephemeral worktree that is
removed straight after — there is no long-lived installed tree to go stale, so e2 is
skipped entirely for it.

## The detector is honest, not exhaustive

`tools/lib/lockfile-drift.js` recognises composer/npm/pnpm/yarn/bun/bundler/cargo/
poetry/uv/go. A repo whose lockfile is not in that table gets **no warning** — an
accepted gap, stated rather than hidden, and fully escapable: `post-ship` fires on
every successful trunk ship regardless of what the table knows.
