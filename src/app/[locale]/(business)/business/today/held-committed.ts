// 今日の運営 — THE COMMITTED WORLD'S HELD MASK, AS A FUNCTION THE SUITE CAN CALL.
//
// WHY IT EXISTS. The committed world's mask used to be spelled inline in a
// `useMemo` body on TodayScreen, and the only thing holding that body's shape
// was a TEXT PIN on its source (#817, selling-engine-flip.test.ts §9). A
// post-merge blind check then measured what such a pin can and cannot hold
// (POSTMERGE-CHECK-88b7726c.md): seven mutants slip it, two of them severe.
// Finding 1 — the guard-off comparison HOISTED one line above the memo (the
// file's own `guardOn` const, moved up) leaves the pinned slice untouched.
// Finding 2 — `gapGuardMode: 'standard'` HARDCODED in the call contains no
// comparison and no `'off'`, so it slips too, and it would hand a guard-off
// store a NON-EMPTY mask: the exact inverse of reserved-mask.ts:195-197's
// 「guard off pays nothing」, with nothing anywhere in the suite pinning the
// forwarding. A text pin cannot close a semantic property. A function the
// suite can CALL can, and this is that function.
//
// WHAT IT PROMISES. Exactly two things, and no third.
//   1. `book === null` — the ROUND GATE off (E3a) — is `undefined`: the
//      fall-through every seam below already treats as the code that shipped.
//      That is the one decision this wrapper is allowed to make.
//   2. Otherwise the answer is `reservedMaskFor`'s own, for the arguments it
//      was handed. The store's スキマガード dial is FORWARDED, never read and
//      never compared here; reserved-mask.ts:200 is where 'off' becomes the
//      frozen empty mask, and it stays the only place that decision lives.
//
// WHAT IT IS NOT. It is not a second derivation home. No held-mask logic lives
// here and none moved out of reserved-mask.ts — this is a caller-side wrapper,
// and held-committed.test.ts pins the equality against a direct
// `reservedMaskFor` call on the real fixture in both live modes. It reads no
// config, no fixture and not the round gate: like the module it wraps, whatever
// world it is handed IS the world it answers for.

import type { BedTruth } from './capacity-ledger'
import { reservedMaskFor, type ReservedLaneMask, type ReservedMaskInput } from './reserved-mask'

/** The committed world's inputs: `reservedMaskFor`'s own, with two differences
 *  that are both fences rather than conveniences.
 *
 *  `book` widens to `BedTruth | null` because the round gate's OFF branch IS a
 *  null book (TodayScreen's `committedBook` memo, which is where the gate is
 *  read). Nothing else about the shape changes.
 *
 *  `excludeId` is GONE. Exclusion is gesture-only and only out of the BOARD
 *  world's instance — reserved-mask.ts says so in the field's own doc, and the
 *  committed world passes nothing there today. A type that cannot spell it is
 *  cheaper than a comment asking a future caller not to. */
export type HeldCommittedInput = Omit<ReservedMaskInput, 'book' | 'excludeId'> & {
  readonly book: BedTruth | null
}

/** The committed world's held set, or `undefined` when the round gate is off. */
export function heldCommittedFor(input: HeldCommittedInput): readonly ReservedLaneMask[] | undefined {
  const { book } = input
  // ponytail: the spread is the promise — every field the caller handed over
  // reaches `reservedMaskFor` unread and unrenamed, so no dial can be dropped
  // or hardcoded on the way through.
  return book ? reservedMaskFor({ ...input, book }) : undefined
}
