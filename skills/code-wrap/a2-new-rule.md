# code-wrap · A2 A new rule is a follow-up unit

Reference for [`code-wrap`](SKILL.md) A2. The core holds the step order, its rule and its stop
condition; this file holds the step's full text — the commands, edge cases and the measurements
behind them — moved here verbatim (#524).

#### A *new rule* is a follow-up unit, not a line in this session's diff

A2 covers docs your work made **wrong** — the domain moved, the deploy changed, a
gotcha surfaced. It does not cover a session that *concluded something new*: a rule
about how people work, a decision with alternatives that were weighed. Those go on an
Issue now and get written by a claimed unit of their own (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#writing-a-conclusion-down--the-decision-and-the-document-are-two-units),
*Writing a conclusion down*). Two reasons, and the second is the one agents miss:

- The reasoning needs a home a reader can find, and a squash commit body is not one.
- Normative prose is the most-contended file in a repo. Slipping an unclaimed rewrite
  of it into an unrelated feature's diff is exactly the parallel-branch collision the
  claim model exists to prevent — with nothing claimed, so nothing can warn anyone.

Do not use this to postpone A2's actual job. "This doc is now wrong" is this session;
"here is something new we decided" is the next one.

**Touched the instruction file? Re-check its pointer section against `ls docs/`.** An index
that omits half the docs is worse than no index, because a reader trusts it and
stops looking.

Never write a secret into docs — only *where it lives* (a GitHub Secret, `.env`
on the server, a password manager). Docs are deliverable paths; commit them in A3.

Why: [ADR 536](../../docs/adr/536-code-wrap-a2-new-rule-rationale.md).
