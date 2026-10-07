# `§6 Releases`: why, with the measurements

Moved from [`CONVENTIONS.md` §6, *Releases*](../../CONVENTIONS.md#6-releases) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why `COLAB_SHIP` and `COLAB_PROMOTE` are assertions, not permissions

They mean "that command ran its preconditions", which is a claim only the command can truthfully make; typed at a shell, one asserts it falsely and reaches a direct trunk push having skipped the grade, the branch-CI check, the claim release and the evidence comment.

## The measurement behind the refusal wording

Measured: two independent sessions set `COLAB_SHIP=1` by hand on the same repo on the same day, neither aware it was crossing a line, one reporting it in a status summary as ordinary housekeeping — and **neither had read it in a skill.** They read it in `pre-push-guard`'s own refusal, which named the variable that opens it.

## The measurement behind the refusal wording

A guard that teaches its bypass at the moment it refuses is not a guard, so

## Why the newest candidate always names trunk's head (#443)

A burst of merges therefore gets a candidate on each green head — what an adopter installs from `next` is never behind what trunk proved. Measured the day a one-a-day cap shipped (#439): four merges landed 40 minutes after a candidate, the cap kept them out of any tag until the next day, and a catch-up candidate had to be cut by hand.

## Why the test period counts the `trunk:` branch (#437)

: there `main` receives CI only at promotions, so a `main`-only reading would hold little beyond the promotion's own run, while `trunk:` is where the code actually moved during the period

## Why `library-fast` and `deploy-tag-fast` have no test period

, because they cut no candidate

## The operator's wish behind the granted automatic final (#441)

— *"in some cases I want the release to deploy too; only some cases, but possible when I choose"*

## Why `deploy-tag-fast` exists (#446)

Some repos have nobody to test a candidate: an app whose only user is its operator, where a 3-day period only measures "nothing new merged for 3 days".

## Why the image build is its own job (#460)

, so a repo not yet cut over still has every final's image in the registry (#460)

## Why an HTTP 200 from the platform is never the evidence

— a platform can accept a deploy it then refuses to run

## Why the container deploy needed no rule change (#452)

It is the existing `deploy: tag` shape with an in-repo deploy workflow (`channels: [workflow]`), so no rule changes; the template is what was missing.

## Why the stamp on trunk is never a commit (#438)

, and a stamp on trunk would put a version in the tree before the release it names exists

## Why the default follows who cuts the tag (#484)

, because nobody is there to bump a manifest before each cut: under `manifest` the first candidate after a final refuses, and so does every one after it, a stall that reads only as a warning in a green run

## Why a declared `version-source` is read the same by cut and final

, so a candidate cut under `tag` is never refused as a final under `manifest`

## Why the npm job has no token, and when npm ends token publishing

(npm ends direct publishing with 2FA-bypass tokens in January 2027; nothing here depends on one.)

## Why the npm publish happens in the release run

— the reason the GitHub Release is published in the same run: a tag pushed with `GITHUB_TOKEN` triggers nothing

## Why release channels are branches, not tags (#445)

A moving tag is refused by every clone that already fetched it (`would clobber existing tag`), and a non-semver tag is read as "the newest version" by tag readers (`git describe --tags`, stamps). A branch moves cleanly and no tag reader sees it, so version tags stay immutable.

## Why a missing pinned ref falls back as it does (#480, #427)

Falling back to an older final would only move the red run one step later, to the first `--auto` call it rejects (#427).

## Why the bump computation reads more than commit subjects

The computation reads more than commit subjects precisely because the breaking change that bites is the one the types don't reveal — a destructive schema change or a renamed export merged as `feat:` or `fix:` with no `!`.

## The class of commit that has bitten before

— exactly the class that has bitten before, in payroll
