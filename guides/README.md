# Role guides

A unit of work passes through a few hands. Each guide here is one role, written as **the files
that role leaves for the next one**: a plan, a report, a verdict, a hold. The guides hold the
judgement only — the calls no command can make. What your tooling does for you (claiming,
branching, waiting on CI, merging, closing) is named by what it does, not by how.

The words are the handbook's own: [Glossary](../CONVENTIONS.md#glossary). The rules are in
[`CONVENTIONS.md`](../CONVENTIONS.md); a guide links to a rule, it never restates one.

| Guide | Role | Leaves |
|---|---|---|
| [`author.md`](author.md) | writes the change: plans it, builds it, repairs it, hands it off | a plan, commits, a report |
| [`reviewer.md`](reviewer.md) | judges a plan, a change, a CI result — never builds | a verdict bound to one commit |
| [`coordinator.md`](coordinator.md) | decides what moves next, together, in what order, and what waits | an assessment, an order, hold records |
| [`cure.md`](cure.md) | gets a red trunk green again | a red-trunk record, then a patch or a revert |
| [`by-hand.md`](by-hand.md) | lands and cleans up when no automation does | evidence, a released claim, a release-notes draft |

## The chain

```
issue ──▶ author: plan ──▶ reviewer: plan verdict ──▶ author: commits + report
      ──▶ reviewer: change verdict (on the report's head sha)
      ──▶ landing (automation, or by hand): evidence on each issue, claims released
coordinator: before all of it (what may start) and around it (holds, order)
cure: whenever trunk goes red — it outranks everything above
```

Each arrow is a file the next role can read **without the previous role's conversation**. A
step that leaves nothing readable did not happen, whatever was said in the session.

## Three rules every role keeps

- **Evidence, not narration.** A claim about the code cites a commit sha and a `file:line`,
  and says what was checked. "Done in branch x" is not evidence.
- **Say once.** A record already on the issue is not posted again; only new information is.
- **Stop at your line.** Each guide ends with what its role never does. The next role is
  someone else, even when it is you, later.

## The skills

The session skills under [`../skills/`](../skills/) keep their names and triggers, and each
names its guide first. Until the mechanics move to the tools that perform them, a skill's body
is the reference for *how*; the guide is *what to decide*.

| Skill | Guide |
|---|---|
| `code-start`, `code-plan`, `code-wrap` | [author](author.md) |
| `code-ship` | [reviewer](reviewer.md) (the grade), [by hand](by-hand.md) (the landing) |
| `code-triage` | [coordinator](coordinator.md) |
| `code-sweep`, `release-rung` | [by hand](by-hand.md) |
