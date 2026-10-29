# engines/ — where the skills go, one data file per agent runtime

An **agent runtime** is the program a coding agent runs in, which loads the skills
([Glossary](../CONVENTIONS.md#glossary)); "engine" alone means the issue engine. The
directory name and the `--engine` flag predate that word and stay as they are.

`install.sh` links every folder under `skills/` into the user-level skills folder of
each agent runtime you pick — or, with `--repo`, copies them into one repo's project skills folder. This directory holds what it needs to know about each one.
**Adding an agent runtime means adding one `<id>.conf` file here**, nothing else: no code
in `install.sh` or `--check` names an agent runtime.

```sh
./install.sh                          # at a terminal: asks which agent runtime(s)
./install.sh --engine claude,codex    # unattended
./install.sh --skills-dir ~/my-agent/skills   # any other agent runtime: you give the folder
./install.sh --check                  # per agent runtime: linked, missing, broken, caveats
./install.sh --repo ../app --engine opencode   # a COPY inside one repo, for sessions with a private home
```

## Format

Plain `key: value` lines. `#` starts a comment line. Keys marked *repeatable* may
appear more than once; every other key is read once (the first one wins). No quoting,
no escapes, no logic — `install.sh` reads it with `sed`, `--check` with a few lines of
JS (`tools/lib/engines.js`), and both must keep agreeing.

| key | meaning |
|---|---|
| `label` | Human name, shown in the prompt and every report. |
| `default` | `yes` on exactly one agent runtime: what a machine with nothing linked gets when no flag and no terminal choose. |
| `skills_dir` | User-level skills folder. A leading `~/` is the home directory. Empty means the user supplies it (`generic`). |
| `project_skills_dir` | *Optional.* The skills folder **inside a repo**, relative to its root, for `./install.sh --repo <path> --engine <id>` (#664): a runtime whose sessions run in a private home never sees the user-level folder. Absent means no per-repo route for that agent runtime. |
| `invoke` | How a user calls a skill; `<name>` stands for the skill's name. |
| `instructions` | Which repo instruction file the agent runtime reads, and how `AGENTS.md` reaches it. |
| `helper_agents` | `yes` / `no` — can a skill spawn a helper agent? `code-plan` uses one when available and degrades without. |
| `load_time_injection` | `yes` / `no` — does the agent runtime run a skill's `` !`command` `` lines at load time? The local-policy line every skill opens with (#520) uses it; without it the agent reads the file named there itself. |
| `shell_network` | `yes` / `no` — does the agent's shell reach the network by default? The skills call `gh` and `git fetch` constantly. |
| `verified` | When and how the values above were checked, or `no` with what is still unverified. |
| `note` | *Repeatable.* Printed after installing for this agent runtime. |
| `caveat` | *Repeatable.* Printed by the install and reported as a ⚠ row by `--check` while the agent runtime is installed — something the user must do or know for the skills to work there. |

Values are facts about the agent runtime, taken from its own documentation or a run — never
from memory. When an agent runtime changes, change its file and its `verified` line together.
