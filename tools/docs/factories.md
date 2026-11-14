# Factories — the file, the signatures and the shared names

The rule this serves: [CONVENTIONS.md §5, *Factories*](../../CONVENTIONS.md#factories--several-teams-on-one-repository-739).
The file's shape and validity: [`project.schema.md`](../../project.schema.md#sibling-file-githubfactoriesyml).
Why the formats are what they are: [ADR 739](../../docs/adr/739-factories-signature-format.md).
Everything below is implemented, pure and tested, in `tools/lib/factories.js`. The commands
that write claims and verdicts adopt it in later changes (#741, #743, #744); nothing here changes
what a command does today.

## Reading the file

- **From trunk only.** A reader takes `.github/factories.yml` from trunk's committed tree (or the
  merge target's), never from the branch it judges, the same rule as `trust-humans:`.
- **`parseFactories(text)`** returns `{ valid, findings, doc }`. The YAML subset reader merges a
  repeated map key silently, so the validator reads the raw text once more and reports a factory id
  (or a top-level key) declared twice.
- **Fail closed.** When `valid` is false, `factoryOfMachine`, `factoryOfSlice`, `isHumanOf` answer
  nobody and `allowedSigners` returns an empty file, so nothing verifies.
- The audit validates the file when it is present and reports the factory ids as `factories`.

## A claim commit

A claim is an SSH-signed commit (`gpg.format ssh`, `user.signingkey` = the factory's private key).
To check it, write `allowedSigners(doc, 'git')` from trunk's file, set it as
`gpg.ssh.allowedSignersFile`, and run `git verify-commit`. Each line reads
`<factory id> namespaces="git" <key type> <key>`, so the principal git reports
(`Good "git" signature for <id>`) is the factory id. A key the file does not list has no principal
and does not verify.

## A verdict marker

```
<!-- colab:verdict phase=<phase> v=<pass|rework|blocked|escalate> head=<40-hex sha> factory=<id> [other=…] sig=<base64> -->
```

`sig` is an SSH signature in namespace `colab-verdict` over the **canonical payload**: these exact
bytes, UTF-8, LF line endings, one field per line, a trailing LF:

```
colab-verdict/1
forge=<forge>
repo=<owner>/<name>
issue=<N>
phase=<phase>
verdict=<v>
head=<40-hex sha>
factory=<id>
```

- **`forge`, `repo` and `issue` come from the verifier,** not from the comment: the factories
  file's `forge`, the repository the verifier is reading and the issue the comment sits on. A marker
  copied into another repository or onto another issue fails.
- **`head` is the full sha.** A short sha could match another commit; a signer refuses one.
- **A value holds no space, no `=` and no line break.** `verdictPayload` throws instead of encoding
  around one, because a signer and a verifier that disagree about the bytes reject every signature.
- **`sig`** is the armored signature `ssh-keygen -Y sign -n colab-verdict` writes, minus its
  `BEGIN`/`END` lines, joined into one line (`sigFromArmor`; `armorFromSig` reverses it).
- **Fields other than `phase`, `v`, `head`, `factory` and `sig` are not signed.** They may ride along
  (a round number, a dispatch id) and are never trusted.
- A marker with no `factory` or no `sig` (the form written before #739) still decodes, with
  `signed: false`. It is nobody's verdict across factories.

To check one: decode it, rebuild the payload with the verifier's own `forge` and `repo`, write
`allowedSigners(doc, 'colab-verdict')` from trunk's file, and run

```sh
ssh-keygen -Y verify -f <allowed_signers> -I <factory> -n colab-verdict -s <sig file> < <payload>
```

## The shared names

| Kind | Name | Meaning |
|---|---|---|
| label | `factory:<id>` | the issue belongs to factory `<id>` |
| label | `slice:<name>` | the issue is in a slice; the factories file says which factory owns it |
| label | `queue:ready` | the branch is ready to land and waits for its turn |
| label | `review:<factory>` | a review by factory `<factory>` is asked |
| commit status | `review/<check>@<factory>` | factory `<factory>`'s verdict on one review check |
| commit status | `audit` | the conventions audit at that commit |

The constants live in `tools/lib/factories.js`. They move into the tracker codec when a command
first writes them.
