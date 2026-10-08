# 530 — install the skills per engine, from one data file per engine

**Status:** accepted (2026-10-06, the handbook's owner ruled on #530)

## Context

`install.sh` linked every skill into `~/.claude/skills` and nowhere else. The skill
content was already close to engine-neutral (no engine-specific tools; `git`, `gh`,
`colab` only; plain `name` + `description` frontmatter), so an adopter on another coding
agent was blocked by the install target alone, and nothing told them.

## Decision

- **One data file per engine, `engines/<id>.conf`, plain `key: value` lines.** Not JSON,
  not a shell file to `source`: a skills-only install must not need node, and sourcing would
  make the "data" executable. `install.sh` reads it with `sed`; `--check` reads it with
  `tools/lib/engines.js`; a test holds the two readers to the same answer.
- **No code names an engine.** The prompt, the flags, the default and `--check` all iterate
  the files. Adding an engine is adding a file.
- **The no-flag default is a key (`default: yes`), not file order.** Falling back to "the
  first file" would silently change every new machine's engine the day someone adds a file
  that sorts before `claude.conf`.
- **Non-interactive with no flag keeps what is already linked**, so every existing machine
  re-runs unchanged; only a machine with nothing linked gets the default, and is told.
- **`--skills-dir` folders are remembered** in `<COLAB_HOME>/skills-dirs`, because a folder
  no engine file names could otherwise be found by neither the next re-run nor `--check`.
- **An engine's values come from its own documentation or a run, never memory**, and its
  `verified:` line says which. The Codex file was nearly written as `~/.codex/skills`
  from memory; Codex's docs say the user folder is `~/.agents/skills`.

## Rejected

- One installer branch per engine (`if claude … elif codex …`) — every new engine becomes a
  code change and a review of `install.sh`.
- Installing for every known engine by default — writes folders for agents the machine does
  not have, and makes `--check` warn about all of them.

## Consequences

- `--check` gains per-engine rows. A machine with only some engines installed gets one ✓
  line naming the rest, so a Claude-only machine is not warned about Codex.
- An engine file with `verified: no` stays visibly so (a ⚠ row in `--check`) until someone
  runs it on a clean machine and edits the line.
