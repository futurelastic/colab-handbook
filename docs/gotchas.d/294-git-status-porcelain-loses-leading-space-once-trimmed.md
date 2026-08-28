# `git.js`'s `run()` `.trim()`s the WHOLE multi-line `git status --porcelain` output as one string — a lone unstaged-modification's leading status space silently disappears

Any code that parses a porcelain line by a fixed column offset (`line.slice(3)` for
the standard `XY<space>path` shape) is exposed to this. `tools/lib/dirty-owner.js`
(#294) is the first caller to try, and it broke on the very first real fixture test.

## What happened

`tools/lib/git.js`'s `run()` — the shared helper behind `git()` and therefore behind
`dirtyTracked`/`dirtyUntracked`/`dirtyAny` — does `stdout: (res.stdout || '').trim()`
on the **entire** command output before anyone splits it into lines
(`tools/lib/git.js:25`). `String.prototype.trim()` only strips leading/trailing
whitespace from the *ends of the whole string*, never per line — but when the output
is a *single* porcelain line and that line happens to start with a literal space (an
unstaged-only modification reads ` M path`, not `M  path`), that leading space **is**
the first character of the whole blob, so it gets eaten right along with it.

The result: `git.dirtyTracked(repoAbs)` returns `'M f.txt'` instead of `' M f.txt'`
for exactly this one common case (a single dirty file, modified but not staged). A
parser assuming the ordinary 3-character `XY ` prefix (`line.slice(3)`) reads
`'f.txt'` as `'.txt'` — silently truncating the first character of the path, no
error, no crash. `tools/lib/dirty-owner.js`'s own unit tests (which hand-construct
already-correct porcelain strings) never caught this; only the end-to-end
`ship-dry-json.test.js` fixture — a REAL `git status` through a REAL `colab ship
--dry --json` — did, because only it exercises the real trim.

## Why this matters beyond this one fix

**Any future parser reading `dirtyTracked`/`dirtyUntracked`/`dirtyAny`'s return value
positionally inherits this**, not just `dirty-owner.js`. Every existing caller today
only treats the string as opaque ("is something here, yes/no", or prints it verbatim)
— which is exactly why this was never visible before something needed to extract a
*path* out of it. Before writing a second positional porcelain parser anywhere in
this repo: either reuse `tools/lib/dirty-owner.js`'s `parsePorcelainPaths`
(per-line shape detection — checks whether index 1 or index 2 holds the separating
space, rather than assuming a fixed offset), or re-derive the same per-line
tolerance from scratch. Do not "fix" this in `git.js`'s `run()` itself
(`.trim()`ing only the outer whitespace of a multi-line git-porcelain-shaped output,
rather than the whole blob, would ripple into every one of `run()`'s other callers
across the CLI — a much bigger, unrelated change) — the tolerant parsing belongs at
the one call site that actually needs positional accuracy, not in the shared
wrapper every subprocess call goes through.
