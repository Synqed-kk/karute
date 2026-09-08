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
// ONE memo that spells ten forwarded key/value lines and nothing else, and
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
// reserved-mask.ts; the book is fetched through the door the CALLER HANDS IN —
// R3's ONE DOOR, the same one the board world's ledger walks — with the `null`
// hand the committed world has always passed, because prices read the SETTLED
// board and nothing is lifted out of that snapshot. It reads no config, no
// fixture and not the round gate: whatever world it is handed IS the world it
// answers for. held-committed.test.ts pins the answer against a direct
// `reservedMaskFor` call over a directly-built book, on the real fixture, in
// both live modes.
//
// ⚠ THE DOOR IS INJECTED, AND THAT IS WHY THIS FILE IMPORTS NOTHING FROM THE
// SCREEN. Round 1 reached for the door by importing `bedViewsFor` from
// TodayScreen, and the two files then imported each other. It ran — the door is
// a hoisted function declaration, called a render later, never at module
// evaluation — but a cycle on a law-bearing seam is a trap for the next edit
// rather than a property anyone wants to depend on. So the SCREEN HANDS THE
// DOOR IN, as `bookOf`. R3's ONE DOOR survives in its stronger form: this file
// cannot reach the capacity book at all except through the function it is
// given. What PROVES that is BEHAVIOURAL — held-committed.test.ts §3 hands a
// different door in and reads the answer that comes back, and a dynamic
// require cannot talk its way past that. Beside it the suite also keeps a TEXT
// pin on this source, so this file may not so much as name the screen or the
// book's own producer down in capacity-ledger (selling-engine-doors.test.ts
// §1, beside the round-gate reader list) — belt-and-braces rather than the
// guarantee, and why neither name appears above.

import type { BoardLane } from '@/business/lib/today-board'
import type { BedTruth, DayFrame } from './capacity-ledger'
import { reservedMaskFor, type ReservedLaneMask, type ReservedMaskInput } from './reserved-mask'

/** THE ONE DOOR INTO THE CAPACITY BOOK, as a parameter. The exact shape of the
 *  screen's `bedViewsFor` (TodayScreen.tsx :168) narrowed at the hand: this
 *  world always asks with `null`, because prices read the SETTLED board.
 *
 *  `lanes` is a mutable `BoardLane[]` rather than `readonly` because that is
 *  what the real door takes; a `readonly` parameter here would make the real
 *  door UNASSIGNABLE to this type (contravariance) and the screen would stop
 *  compiling. ⚖ R2 — so the DOOR'S OWN SIGNATURE is the thing to fix, on
 *  whichever round next touches it; this type follows the real one and cannot
 *  lead it. The return is spelled structurally — `{ world: BedTruth }` — so
 *  the door's own richer return type (`BedViews`, which also carries
 *  `worldMinusHand` and `handId`) satisfies it without this file naming a type
 *  that lives on the screen. */
export type BookDoor = (lanes: BoardLane[], frame: DayFrame, inHand: null) => { world: BedTruth }

/** The committed world's inputs: `reservedMaskFor`'s own dials, plus the round
 *  gate and the three things the book is built out of. Every difference from
 *  `ReservedMaskInput` is a fence rather than a convenience.
 *
 *  `gateOn` REPLACES a caller-supplied `book`. E3a's gate-off branch used to be
 *  a null book the screen computed for itself, which left the screen owning an
 *  input nothing could test. The gate now arrives as the bare boolean the
 *  screen reads at its boundary, and the branch is taken down here.
 *
 *  `lanes` and `frame` are what the book is built FROM, so the caller
 *  hands over the world rather than a world it already narrowed. `bookOf` is
 *  the door it is built THROUGH — handed in rather than imported, so this file
 *  has no way to reach the book on its own and no edge back to the screen.
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
  readonly frame: DayFrame
  readonly bookOf: BookDoor
}

/** The committed world's held set, or `undefined` when the round gate is off. */
export function heldCommittedFor(input: HeldCommittedInput): readonly ReservedLaneMask[] | undefined {
  const { gateOn, frame, bookOf, ...mask } = input
  // ponytail: one spread and one added key. Every dial the caller handed over
  // reaches `reservedMaskFor` unread and unrenamed, so none can be dropped or
  // hardcoded on the way through, and the book is the only thing this function
  // puts on the table.
  return gateOn ? reservedMaskFor({ ...mask, book: bookOf(mask.lanes, frame, null).world }) : undefined
}
