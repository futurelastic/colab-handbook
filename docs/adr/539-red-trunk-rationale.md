# Red trunk: wording rationale

Moved from [`CONVENTIONS.md` §5, *A red trunk with no patch* and *Red-trunk exemption*](../../CONVENTIONS.md#a-red-trunk-with-no-patch--never-parked-in-silence-390) by #539 (phase 2 of #523). The rule stays there; this file holds its rationale. Headings below are added for navigation only.

## Why a differently titled issue does not count

: nobody will pick it up as the patch

## Why the scheduled driver is the only re-run actor

: two actors each allowed one re-run per sha make two, and a green second run can bury a real defect

## Why the exemption is trunk-only

— an integration line's red already borrows trunk's advisory verdict when the line has no runs of its own; widening the exemption to lines is a deliberately unmade decision
