# code-wrap · A3b Request a migration grant

Reference for [`code-wrap`](SKILL.md) A3b. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### A3b. Request a migration grant, if this branch needs one

`colab ship` refuses, unconditionally, any branch touching `database/migrations/`,
`prisma/migrations/`, or a prefix `project.yml` declares under `migrations:` (#383)
unless every claimed issue already carries a live
`migration-granted` exemption of a role the repo accepts (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402),
*Migration exemption*): a human grant on any repo, or — only where `project.yml` declares
`migration-grant: reviewer` — a reviewer grant bound to this branch's exact HEAD. Either
role is minted by a human (the human flag, never set by an agent), so creating a grant is never yours to do
here, and neither is running the review in this session: it is the bound reviewer's job
([`migration-review`](../migration-review/SKILL.md)), against the HEAD you push.
What **is** yours: making sure the *request* gets filed, so the human with the
authority to grant it is actually asked — instead of a session finishing, wrapping,
reporting success, and going idle, with the un-shippable branch discovered only when a
later `ship` (often days later, often a different session) refuses it.

```sh
git diff --name-only <base>...HEAD | grep -E '(^|/)(database|prisma)/migrations/'
# … plus every prefix the repo declares — `migrations: [backend/migrations/]` adds:
git diff --name-only <base>...HEAD | grep -E '^backend/migrations/'
```

- **No matches** → nothing to do, skip to A4.
- **Matches, and every issue this branch carries already holds `needs-migration-grant`
  or `migration-granted`** → the request (or the grant itself) already exists, skip to A4.
- **Matches, and a carried issue holds neither** → apply the request signal to that
  issue now, **before declaring hand-off complete** — and read it back, because an exit
  code is not evidence the write took (`code-triage` carries this same lesson for the
  identical failure):
  ```sh
  gh issue edit <issue> --add-label needs-migration-grant
  gh issue view <issue> --json labels -q '.labels[].name' | grep -qx needs-migration-grant
  ```
  - **Confirmed present** → done. State it in the wrap report — which issue(s) got the
    label — and note that a human still has to run
    `colab migration-grant <issue> --branch <branch>` (human-gated — no agent may set the
    env assertion that authorizes it) before `code-ship` can merge this branch. On a repo
    declaring `migration-grant: reviewer`, say that a reviewer grant is the other route:
    it needs a review of the HEAD you just pushed, so **any later commit voids it** — push
    everything before asking for the review, not after.
  - **Still absent after the add** → this repo adopted the conventions before
    `needs-migration-grant` entered the set (#230) and never back-filled it, so the ADD
    landed on a label that does not exist — the same doubly-silent failure
    `readinessMissingLabelHint`/`migrationGrantMissingLabelHint` exist to name for
    `deps-checked`/`migration-granted` (`tools/lib/labels.js`). **Do not create the label
    here** — defining it is not this step's job; `tools/lib/labels.js`'s
    `CONVENTION_LABELS` already owns that definition, and a skill that also defines it
    becomes a second source of truth that drifts (this skill is public and copied by
    other repos, so the drift ships to them too). Say so loudly instead: report that the
    request could **not** be filed, and point at `colab labels --ensure` (or
    `handbook-sync`, `CONVENTIONS.md` §9 step 3) to provision the convention label set —
    never claim success on a write that did not land.

This is mechanical, not a judgement call — a file-path diff, and a label *application*
gated on nothing but ordinary `gh` access, no `COLAB_HUMAN`, no schema review. It never
defines the label and never substitutes for the grant; only a human minting
`migration-granted` — as a human grant, or as a reviewer grant where the repo's policy
accepts one — still authorizes anything.
