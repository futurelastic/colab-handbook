# code-wrap · Hand off — an ask you raised is readable, and never on your own build issue

Reference for [`code-wrap`](SKILL.md) Hand off. The core holds the rule and its stop condition;
this file holds the why and the edge cases (#685).

### Why

A question put to a human is only answered when a decision view can show it, and it can show
exactly two shapes: a `decision:options` block, or a `Mockup:` line in the issue body
([`tools/docs/decisions.md`](../../tools/docs/decisions.md#design-approval-ask--the-mockup-line-379)).
Anything else renders as an empty card, and nobody is asked.

Measured on one repo of a shared machine, in one day: a coordinator added `needs-decision` to a
**build** issue and wrote "which design for the new admin screen?" as prose in a comment. The card
was empty, and the build issue was gated on a question that belonged to no design issue at all. It
was following a local paraphrase, "a UI surface with no ruling ⇒ `needs-decision` on the issue",
which is the opposite of the rule. On the same day, three design issues with `Mockup:` lines and
one shared `group:` produced one good card. The labels work; the shapes are what fail.

### A surface that needs a design this session does not have

This is the third path (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#decision-gate--a-human-must-answer-first-122),
*Decision gate*) applied to design. It applies only to a **new surface** under *Design work splits
by size* (`CONVENTIONS.md` [§5](../../CONVENTIONS.md#design-conclusions-are-three-units-not-two)):
building needs a screen, page or panel that no approved artifact covers. A design fork on a surface
that has a spec is not this case: continue on the spec and record `design-not-preapproved`, as
before.

1. **File a `delivery:design` issue** for the surface. It is a follow-up you decided to file, so
   A1's agent-filed rules apply (label, `Filed-by:`, `Ask:`). If the question is a pick between
   directions, its body carries the `decision:options` block; the `Mockup:` line comes later, from
   the session that produces the artifact.
2. **Wire the edge:** `colab blocked <N> --by <design>`. The edge is the only thing that holds the
   build back. No label on the build issue, no artifact check.
3. **Keep your claim**, and build the part that does not depend on the look: the data, the
   endpoint, the permissions, the tests. Wrap and hand off as usual.
4. **The unbuilt remainder gets its `Blocked:` line** naming the design issue
   ([handoff-partial-wrap.md](handoff-partial-wrap.md)).

**Never add `needs-decision` to your own build issue.** It puts the question on the wrong issue,
gates the work that does not depend on the answer, and in prose it is unreadable anyway.

### Before ending the turn on an ask

For every ask this session raised (a `needs-decision`, a `decision:options` block, a `Mockup:`
line), re-read the issue it sits on and confirm that the ask is in one of the two shapes:

```sh
gh issue view <N> --json body,comments \
  -q '([(.body // ""), (.comments[].body // "")] | any(test("<!--\\s*decision:options"))),
      ((.body // "") | test("(?m)^Mockup:[ \\t]*\\S+[ \\t]*$"))'
```

One `true` is enough. Two `false` means the ask is not raised yet: add the block or the line
before you end the turn. This is the same reading `code-triage` §5 applies to the whole repo
([5-gates.md](../code-triage/5-gates.md)); the reference is `askShape` in
`tools/lib/decision-record.js`.
