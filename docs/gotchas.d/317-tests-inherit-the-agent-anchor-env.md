# A CLI test that spawns `colab` inherits the agent-session env, and its verdict changes with WHO ran it

A test file whose fixtures pretend to be two different sessions can silently become a
test of **one** session, and the difference is invisible: it passes on CI and fails on
an agent's machine, or — much worse — the other way round.

## What happened

`place.resolveAnchor` (#288) adopts `CLAUDE_PID` as a `'verified'` anchor when that pid
is alive **and** a proven ancestor of the invocation. `ownsAnchor` (#317) then treats a
hold recorded under such an anchor as the caller's own, whatever session string either
side carries.

Every CLI test in `tools/lib/*.test.js` spawns `node tools/colab …` as a **child of the
test runner**. Run the suite from inside an agent session and `CLAUDE_PID` names that
session's long-lived process — which really *is* an ancestor of the runner, and so of
every child `colab`. So every hold minted anywhere in the file shares one verified
anchor, and two fixtures acquiring as `sess-OTHER` and releasing as `sess-MINE` are one
writer as far as the code is concerned. Every different-holder refusal in the file
quietly stops being exercised.

Measured while landing #317: **9 tests across 3 files** (`place-cli`,
`release-place-claim`, `ship-promote-place-claim`) flipped verdict purely on where the
suite ran. A GitHub runner has neither `CLAUDE_PID` nor `CLAUDECODE` set, so CI was
green throughout.

## The fix

Neutralise the agent-anchor vars in the spawn helper, exactly as #237 already
neutralises `COLAB_HUMAN` for the same reason — a green test must never depend on the
developer's (or the agent's) ambient shell:

```js
env: {
  ...process.env, COLAB_HOME: fx.home, COLAB_SESSION: '', COLAB_SESSION_NAME: '',
  CLAUDE_PID: '', CLAUDECODE: '', AI_AGENT: '',
  ...extraEnv,
},
```

A test that WANTS the verified-anchor path sets it back explicitly and truthfully —
`{ CLAUDE_PID: String(process.pid) }` — because the runner genuinely *is* an ancestor of
the child, so rule 2 fires for real rather than being simulated.

## The general shape

Any env var the code under test reads as *identity* — not just configuration — has this
property. The list is `COLAB_HUMAN`, `COLAB_SESSION`, `COLAB_SESSION_NAME`,
`COLAB_PLACE_PID`, `CLAUDE_PID`, `CLAUDECODE`, `AI_AGENT`. If a new one is ever added,
the spawn helpers are where it has to be neutralised, and the symptom of forgetting is
**not** a red test — it is a green one that stopped asserting anything.
