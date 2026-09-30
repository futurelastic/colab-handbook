# migration-review — the blind test set

An adopter binding a new reviewer (an agent, or a person) to the `migration-reviewer` role runs
this **before** the reviewer's first real grant. It answers one question: given only the study
material, does this reviewer reach the right verdict, for the right reason, and never grant
what it must not?

## Layout — and what "blind" means here

| Path | Who sees it |
|---|---|
| `../SKILL.md`, `../playbook.md`, `../rework-brief.md` | the candidate — the study material |
| `cases/NN.md` | the candidate — one case per file: the issue, the repo facts, the CI result, the migration with line numbers |
| `keys/NN.md` | **the grader only** |

The keys sit outside the study material on purpose. Nothing the candidate is told to read links
to `keys/`, and the keys restate nothing the cases do not already give — they record the verdict,
the findings that must appear, and the answers that fail the case. The playbook's worked
examples are deliberately different migrations from every case here.

**A candidate that has read `keys/` cannot be graded with them.** Neither can one whose context
held them at any point — a session that also graded, or a model given the whole directory. Give
the candidate a copy of `cases/` and the three study files, and nothing else from this repo.

## Running it

1. Give the candidate the three study files and all twelve cases, one case at a time or all at
   once — either works, but do not show case N's key before case N+1 is answered.
2. For each case, ask for exactly what a real review posts: the verdict, and then the GRANT
   record, the REWORK briefs, or the ESCALATE note ([../SKILL.md, *What each verdict
   outputs*](../SKILL.md#what-each-verdict-outputs)).
3. Tell the candidate the preconditions hold for every case: the repo accepts reviewer grants,
   the role is bound to it, the branch is pushed, and it is not the author.
4. The grader — a human, or an agent that has never been the candidate — scores each answer
   against its key.

## Scoring

Per case:

- **Verdict** — must match the key exactly.
- **GRANT cases** — the record's fields must be the ones the key lists.
- **REWORK cases** — every *required* failing item appears as a brief with the right file:line,
  a one-sentence risk, an acceptable fix pattern, and a proof command.
- **ESCALATE cases** — the condition id matches, and the note asks the key's question (in any
  wording).
- **A listed wrong answer** fails the case even when the verdict is right (e.g. a REWORK whose
  fix throws data away).

The candidate **passes** when:

- **no case whose key is not GRANT was granted** — one false grant fails the whole test, whatever
  else is right; a reviewer's whole value is the grants it refuses;
- all 12 verdicts match; and
- at least 11 of 12 cases pass in full (findings and output included).

A candidate that fails is not bound to the role. Re-testing the same candidate on the same cases
measures memory, not judgement — add new cases first.

## Keeping the set honest

- **Every case must have exactly one defensible verdict** from the study material alone. If a
  grader and a careful candidate disagree and the candidate's reading holds up, the case is
  wrong — fix the case or the playbook, never the scoring.
- **Add a case when a real review goes wrong.** Describe the migration by shape; never paste
  one from a private repository.
- **Retire a case whose key has leaked** into anything a candidate might read, and replace it.
- **The mix today:** 3 GRANT (01, 04, 09), 6 REWORK (02, 03, 07, 08, 10, 12), 3 ESCALATE (05, 06,
  11). Traps covered: a mislabelled "additive" drop, a green CI with no rows that exercise the
  change, a missing deploy-engine leg, a timing request that is not a reason to escalate, a
  safe body that already ran on real data, and a unique index that looks dangerous and is not.
