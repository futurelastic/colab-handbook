# Solo flow and place-claims: why

Moved from [`CONVENTIONS.md` §2, *Solo flow* and *Place-claims*](../../CONVENTIONS.md#place-claims--the-writer-verifiable-hold-a-shared-checkout-needs-and-a-worktree-does-not) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Solo flow: what `ceremony: light` left untouched

`ceremony: light` relaxed the record-keeping *end* of a session; the *start* — pre-filed
issue, claim, branch, worktree — stayed full weight even there.

## Solo flow entry gate: why the stale-record exception is not gated on `writes:`

— a stale record is equally stale under every one of them, and a
   safety rule that only applies in one mode is the kind of conditional [§4](../../CONVENTIONS.md#4-branches-and-commits)'s
   incident log warns about.

## Place-claims: why release is a read-time lookup

"Dies with its session" is what a reader assumes, and it is not what a purely
  written record can promise: nothing reliable runs at the moment a session dies.

## Place-claims: why identity is not name-matched (#317)

The string has to be reproduced identically by every later command of the same session,
  and twice now it was not: a session that recorded its *name* in `--session` failed its own
  ownership check (#306), and a ship session that could not resolve any identity at all was refused
  by a hold **its own claim had taken minutes earlier** — one merge in 8½ hours on that repo until a
  human cleared it by hand.

## Place-claims: why the anchor-pid class is no coarser (#317)

The equivalence class this
  admits is never coarser than the session string beside it: everything it exempts is something the
  same session could already exempt by exporting `COLAB_SESSION` once.

## Place-claims: why machine identity is not a hostname (#289)

A record's `host` alone false-refuses the
  SAME machine the instant its short hostname drifts from its FQDN, or DHCP/mDNS hands out a
  different label between processes.
