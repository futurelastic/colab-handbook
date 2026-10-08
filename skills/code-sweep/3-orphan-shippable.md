# code-sweep · §3 bucket `orphan-shippable`

Reference for [`code-sweep`](SKILL.md) §3. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

### `orphan-shippable` — wrapped work that no worktree will surface (#352)

**All three tests, in order. Fail one and the ref is not this bucket:**

1. **§1.3 printed `orphan-candidate`.** On origin, no worktree on this machine, every
   trailing number OPEN and `in-progress`.
2. **Content: `colab landed --branch <br>` reads `cargo` or `unknown`.** It resolves an
   origin-only name itself (#324). `landed` means the work is already on the base while the
   issue stays open and claimed. That is `claim-only`, so send it there.
3. **Hand-off: the head was committed before the newest non-bookkeeping comment on every
   carried issue.** Since #325 every branch is pushed the moment it is cut, and a
   place-claim session has no worktree to show that it is still working. So "on origin and
   claimed" also describes a session that is live mid-work. A wrap ends with a distill
   comment posted **after** the last commit. A head newer than that comment is work in
   flight. Put it in `send-back` ("claimed, pushed, not wrapped"), never ship it.
   ```sh
   HEAD_AT=$(TZ=UTC git log -1 --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd "origin/$BR")
   WRAP_AT=$(gh issue view "$N" --json comments -q '[.comments[]
     | select(.body | test("^(🔒 Claimed|✅ Released|🚢 Shipped|🔖 Referenced|↩️ Sent back)") | not)
     | select(.body | test("^—\\s[^\\n]+\\s*$") | not)]
     | last | .createdAt // ""')
   awk -v h="$HEAD_AT" -v w="$WRAP_AT" 'BEGIN { exit !(w != "" && h < w) }' \
     && echo handed-off || echo in-flight          # awk, not `[ \< ]`: zsh's `[` rejects `\<`
   ```
   **Normalise both timestamps to UTC before you compare them.** `%cI` prints the
   committer's own offset (`-05:00`, `+09:00`) and `gh` prints `Z`. Compared as strings,
   they are off by that offset. For a committer west of UTC, a head committed *after* the
   comment then reads as *before* it, and that is the unsafe direction. `format-local` under
   `TZ=UTC` gives the same shape `gh` uses, so a plain string compare is then correct.

   **Two comment shapes are never a hand-off (#517)**, and the filter drops both: a
   `↩️ Sent back` comment (this sweep's own, posted *after* the head it rejected — counting
   it would make the next run read the unchanged branch as handed off and ship it), and a
   comment whose whole body is one signature line (`— <name> · <machine>/<session>`, which
   some deployments post after every comment). A distill that merely *ends* in such a line
   still counts: the pattern is anchored to the start of the body and allows no second line.
   Checked under `gh -q` (Go regexp: `$` is end of text, so `\s*$` absorbs one trailing
   newline).

   Walk-through — one branch, nothing pushed after 10:00:

   | time | event | newest comment the filter keeps | verdict |
   |---|---|---|---|
   | 10:00 | head committed, no distill | — | — |
   | 11:00 | sweep | none | `in-flight` → send-back, `↩️ Sent back` posted |
   | 12:00 | next sweep | none (`↩️` filtered) | `in-flight`; a `↩️` already stands at this head ⇒ report `sent-back (pending since 11:00)`, post nothing |
   | 12:30 | `— <name> · <machine>/<session>` posted | none (signature filtered) | still `in-flight`, still pending |
   | 13:00 | implementer posts a real distill | the distill | `handed-off` → `ship` path |

   This is a **proxy**, and it is one on purpose. The comment's text is not checked, and an
   unrelated automated note posted after the commit would satisfy it. It only keeps obvious
   work in flight out of the ship path. `code-ship` §0 re-derives the full hand-off
   contract, and its grade compares the diff with the ask, so a branch that slips through
   here still meets both of those checks.

**Action: ask `colab ship` before you do anything.** `colab ship --branch <br> --dry --json`
computes every precondition and changes nothing. `ok` + `checks[]` is the answer, and
`checks[].class` separates `self-clearing` (retry on a later ping) from `human-gated` (a
person must act):

- **`ok: true`** ⇒ the candidate goes through §4 like a `ship` candidate: per-candidate CI re-check, then [`code-ship`](../code-ship/SKILL.md). Its §0
  verifies the hand-off from git and GitHub, and its grade still runs. `READY` is where
  shipping starts. It does not replace the checks.
- **`ok: false` with `autonomy granted` as the only failing row** ⇒ the repo has no
  `autonomy: auto-trunk` grant and the diff is not docs-only (#345). Report it as `wrapped, awaiting a
  human go`, naming the branch and issue. This is why autonomy is **not** one of the three
  tests above. On a repo without the grant, the same orphan is just as invisible, and the
  finding a human needs is the same finding. Only the next step differs.
- **`ok: false` on `issues resolved (not zero-by-registry-gap)`** (#324: the branch
  resolves only on origin and this machine's claim registry has nothing for it) ⇒ it is
  most likely another machine's work. Report it as `orphan-shippable elsewhere` and name
  the machine from the issue's newest `🔒 Claimed` comment. Never `--adopt` it from a sweep. `--adopt` exists for branches that
  name no issue, and this one names issues.
- **`ok: false` on `no new migrations`** ⇒ `human-gated` whichever role could open it.
  Report `orphan-shippable, awaiting a migration grant` and quote the row's reason — it
  names the failing condition (`human`, or a reviewer grant's `P`/`M`/`HEAD`/`R`). On a
  repo declaring `migration-grant: reviewer`, name the reviewer route
  ([`migration-review`](../migration-review/SKILL.md)) beside the human one. Mint neither:
  both need the human flag (`CONVENTIONS.md` [§5, *Migration exemption*](../../CONVENTIONS.md#migration-exemption--a-narrow-door-through-no-new-migrations-opened-by-a-role-98-402)).
- **Any other `ok: false`** ⇒ one `orphan-shippable` line, naming the failing check and its
  `class`. Never leave a candidate out of the report because it failed. Staying silent
  about a failure is the exact bug this bucket was created to fix.

**It merges, so it obeys §4's stops.** A dead or red trunk CI halts it together with the
`ship` candidates. Unlike `spent-remote`, it is not a report-only bucket that §4 can skip.

Why: [ADR 536](../../docs/adr/536-code-sweep-3-orphan-shippable-rationale.md).
