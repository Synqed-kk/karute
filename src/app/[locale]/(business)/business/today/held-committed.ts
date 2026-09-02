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
// ⚖ ROUND 1 OF THE FIX ROUND — ONE SEAM, NOT TWO. The first cut moved the CALL
// in here and left its INPUT behind: the screen kept a `committedBook` memo,
// which is a second screen-level seam nothing could test, and a blind mutation
// lens walked straight through it — pre-gate that memo on the store's own dial
// and a guarded store silently gets no mask at all, with every pin in the
// family still green. So the book moved in here too. The screen is left with
// ONE memo that spells nine forwarded key/value lines and nothing else, and
// BOTH decisions — the round gate, and which book the committed world is
// answered out of — live in this function, where held-committed.test.ts calls
// them.
//
// WHAT IT PROMISES. Exactly two things, and no third.
//   1. `gateOn` false — the ROUND GATE off (E3a) — is `undefined`: the
//      fall-through every seam below already treats as the code that shipped.
//      That is the one decision this wrapper is allowed to make.
//   2. Otherwise the answer is `reservedMaskFor`'s own, for the arguments it
//      was handed, over the committed world's own book. The store's スキマガード
//      dial is FORWARDED, never read and never compared here;
//      reserved-mask.ts:200 is where 'off' becomes the frozen empty mask, and
//      it stays the only place that decision lives.
//
// WHAT IT IS NOT. It is not a second derivation home and it is not a second
// door into the book. No held-mask logic lives here and none moved out of
// reserved-mask.ts; the book is fetched through `bedViewsFor` — R3's ONE DOOR,
// the same one the board world's ledger walks — with the `null` hand the
// committed world has always passed, because prices read the SETTLED board and
// nothing is lifted out of that snapshot. It reads no config, no fixture and
// not the round gate: whatever world it is handed IS the world it answers for.
// held-committed.test.ts pins the answer against a direct `reservedMaskFor`
// call over a directly-built book, on the real fixture, in both live modes.
//
// ⚠ THE IMPORT DIRECTION, DELIBERATE. `bedViewsFor` is exported by
// TodayScreen.tsx (:168), so this file and the screen import each other. The
// cycle is the cheaper of the two options: the alternative is a SECOND way into
// the capacity book, which is the one thing R3's one-door invariant exists to
// forbid (today-screen-interactions.test.ts, 「exactly one door to the book」).
// It is safe because nothing here runs at module-evaluation time — the door is
// a hoisted function declaration and it is called only from inside the function
// below, one render later.

import type { BoardLane } from '@/business/lib/today-board'
import type { DayFrame } from './capacity-ledger'
import { reservedMaskFor, type ReservedLaneMask, type ReservedMaskInput } from './reserved-mask'
import { bedViewsFor } from './TodayScreen'
import type { RoomPolicy } from './today-interactions'

/** The committed world's inputs: `reservedMaskFor`'s own dials, plus the round
 *  gate and the three things the book is built out of. Every difference from
 *  `ReservedMaskInput` is a fence rather than a convenience.
 *
 *  `gateOn` REPLACES a caller-supplied `book`. E3a's gate-off branch used to be
 *  a null book the screen computed for itself, which left the screen owning an
 *  input nothing could test. The gate now arrives as the bare boolean the
 *  screen reads at its boundary, and the branch is taken down here.
 *
 *  `lanes`, `rooms` and `frame` are what the book is built FROM, so the caller
 *  hands over the world rather than a world it already narrowed.
 *
 *  `excludeId` is GONE. Exclusion is gesture-only and only out of the BOARD
 *  world's instance — reserved-mask.ts says so in the field's own doc, and the
 *  committed world passes nothing there. Removing it from the type is a fence
 *  on the literal call site and only that: TypeScript's excess-property check
 *  fires on FRESH object literals, so a typed variable could still carry the
 *  field and the spread below would forward it. What actually holds the
 *  forwarded set is the test, not the type — held-committed.test.ts pins this
 *  function's answer against a direct call — and the omission just makes the
 *  mistake unspellable where it would normally be made. */
export type HeldCommittedInput = Omit<ReservedMaskInput, 'book' | 'excludeId' | 'lanes'> & {
  readonly gateOn: boolean
  readonly lanes: BoardLane[]
  readonly rooms: RoomPolicy
  readonly frame: DayFrame
}

/** The committed world's held set, or `undefined` when the round gate is off. */
export function heldCommittedFor(input: HeldCommittedInput): readonly ReservedLaneMask[] | undefined {
  const { gateOn, rooms, frame, ...mask } = input
  // ponytail: one spread and one added key. Every dial the caller handed over
  // reaches `reservedMaskFor` unread and unrenamed, so none can be dropped or
  // hardcoded on the way through, and the book is the only thing this function
  // puts on the table.
  return gateOn ? reservedMaskFor({ ...mask, book: bedViewsFor(mask.lanes, rooms, frame, null).world }) : undefined
}
