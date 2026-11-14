# ADR 739 — the factories file and its signature formats

Status: accepted (#739, epic #738). Rule: [CONVENTIONS.md §5, *Factories*](../../CONVENTIONS.md#factories--several-teams-on-one-repository-739).
Mechanics: [`tools/docs/factories.md`](../../tools/docs/factories.md).

## Context

Several teams work on one repository and share only its forge. The claim lock (#741), the factory
named in claims and hand-offs (#743) and the cross-factory takeover rule (#744) all need two
things first: one list of who the teams are, and a signature format a verifier can check without
asking the forge who posted a comment. Triage flagged the issue because "a signature over a
canonical payload" left the fields, order, encoding and key lookup open.

## Decisions

1. **A sibling file, not `project.yml` keys.** The audit's descriptor reader refuses nested maps
   by design, and a factory is a map of lists. `.github/factories.yml` is read with the general YAML
   subset reader, as a map keyed by factory id (the reader has no sequences of maps).
2. **Read from trunk only.** The same reason as `trust-humans:`: a branch that could edit the
   file could add its own machine or key and then pass every check the file drives.
3. **One key per factory, principal = factory id.** `git verify-commit` and
   `ssh-keygen -Y verify` both look a key up by principal in an allowed-signers file, so one file
   generated from the factories file serves both, with a different namespace for each (`git`,
   `colab-verdict`). An email principal would tie identity to a forge account, which is the thing
   being replaced. Key rotation is an edit to the file on trunk; several keys per factory can come
   later without changing the payload.
4. **Sign a payload, not the comment body.** Forges change comment bodies: line endings, trailing
   spaces, and edits to the prose around the marker. A signature over the whole body breaks for
   reasons unrelated to the verdict, and it invites signing text nobody checks. The payload holds
   only the fields that carry the verdict's meaning, in a fixed order, one `key=value` per line,
   with a version header so the format can change without ambiguity.
5. **`forge` and `repo` come from the verifier.** They are signed but not written in the marker. The
   verifier fills them from its own context, so a marker copied into another repository, or onto
   another forge, fails. `issue` is the issue the comment sits on, and is filled the same way.
6. **Full 40-hex head.** Today's unsigned markers carry 12 hex digits. A signed verdict binds one
   commit, and a prefix could later match a second commit.
7. **Unsigned extras are allowed but never trusted.** Existing writers add `round=` and `dispatch=`.
   Keeping them decodable avoids breaking those writers, and leaving them out of the payload means
   a reader cannot be tricked into trusting them.
8. **The vocabulary is not in the codec yet.** The codec is a closed public surface, and none of
   these strings has a writer yet. The first command that writes one (#743) moves it there.

## Consequences

- An invalid file trusts nobody, as `trust-humans:` does. The audit makes that visible.
- Steward-area globs are validated for shape only. Matching rules (codeowners-style) come with the
  command that enforces them.
