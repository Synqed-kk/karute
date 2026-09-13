// 今日の運営 — THE BED-AWARE SALES LAYER: may a priced offer go on sale, once
// today's real bookings AND the kept 新規用 枠 have their beds? Pure, and DARK
// on its own branch.
//
// ⚖ D-10 (Liam 2026-09-13 14:29) — ONE promise book, and the order is
// booking > kept 新規用 枠 > the store's own priced offer. The hole this closes
// (SPEC-HONEST-COUNT §2.4): the sell withholding reads the held mask PER LANE.
// `tagHeldBound` tags a cell only against its own lane's held spans and the gap
// layer masks only its own lane's occupancy, so a kept 枠 on ANOTHER row is
// invisible to both and a priced offer takes the bed that 枠 needs.
//
// ⚖ D-12 / SPEC-R2 v3 AMENDMENT (2026-09-13 18:3x) — THE TEST PROTECTS THE HELD
// SET, NOT THE COUNT, and that correction is the whole round. Count-preservation
// (「the netting still returns honest.total」) puts the 詰め込み at c-03 14:30 ON
// SALE on the demo board: block ベッド2 over 14:30–15:00 and ごろう loses her only
// room, but あずさ's 15:05–16:35 — which does not overlap the filler — steps into
// ベッド2 in her place and the total is still 3. A different three. The held SET is
// what the board draws and what the online 確保 rows advertise, so selling that
// filler would swap the published 枠 from ごろう to あずさ the moment it is booked.
// The rule is therefore (i′): the offer is ON SALE iff SOME room free for its
// whole span exists such that, with that room blocked over the offer's span, the
// netting still holds EVERY 枠 the unblocked answer holds — compared by IDENTITY
// (`laneKey|windowStart`), never by bed and never by count.
//
// IT IS ASSIGNMENT-INDEPENDENT, which is why (ii) 「does the offer's drawn bed
// collide with a kept 枠's assigned bed?」 is rejected: the netting's chosen bed is
// a TIE-BREAK among equal-size solutions (`honest-held.ts:229`, `:253-255`), not a
// promise to a physical bed, and hanging a money decision off it over-withholds
// invisibly. This module never reads which BED a 枠 was given — only which 枠 are
// HELD, which is the published, pinned answer.
//
// NO CYCLE, BY CONSTRUCTION: every import below is a TYPE except `honestHeld`,
// and that file imports only types. This module names nothing from
// `today-interactions` and nothing from the screen.

import type { BoardLane } from '@/business/lib/today-board'
import type { Asker, BedTruth } from './capacity-ledger'
import { honestHeld, type HonestHeld } from './honest-held'
import type { ReservedLaneMask } from './reserved-mask'

/** One priced box the board draws, asked as a question. `stores` is the
 *  COMMITTED lane's own store binding — the same field `honestHeld` reads for a
 *  kept 枠 — because 「which rooms are free」 is a store-isolated question. */
export interface OfferAsk {
  readonly key: string
  readonly laneKey: string
  readonly start: number
  readonly end: number
  readonly stores: string[] | null
}

/** The answer: which offers may not go on sale, and — where ONE kept 枠 is the
 *  whole reason — whose 枠 that is, so the muted box on screen can name it. */
export interface WithheldOffers {
  readonly keys: ReadonlySet<string>
  /** offer key → the lane key of the kept 枠 that is lost WHICHEVER room the
   *  offer takes. Absent when no single 枠 is the cause (see `blockerOf`). */
  readonly blockedBy: ReadonlyMap<string, string>
}

/** ONE spelling of an offer's identity, on both sides of the seam. */
export const offerKey = (laneKey: string, start: number): string => `${laneKey}|${start}`

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

/** Nothing withheld — the board main draws. Frozen and shared, so the screen's
 *  「identity when the set is empty」 holds by reference. */
const NOTHING: WithheldOffers = Object.freeze({
  keys: Object.freeze(new Set<string>()),
  blockedBy: Object.freeze(new Map<string, string>()),
})

/** The kept 枠 a netting HOLDS, by identity. */
const heldIds = (h: HonestHeld): string[] =>
  h.byLane.flatMap((l) => l.held.map((s) => offerKey(l.laneKey, s.windowStart)))

/** spec §2.3's three-line `blocked`: the SAME book, room `r` dropped from
 *  `freeBedKeys` only when the asked span overlaps the offer's span. One reader
 *  of the book, one netting function, no second search — every other method of
 *  the book is inherited untouched, so this cannot become a second bed truth. */
const blocked = (book: BedTruth, room: string, start: number, end: number): BedTruth =>
  Object.create(book, {
    freeBedKeys: {
      value: (s: number, e: number, asker: Asker) =>
        (overlaps(s, e, start, end) ? book.freeBedKeys(s, e, asker).filter((k) => k !== room) : book.freeBedKeys(s, e, asker)),
    },
  }) as BedTruth

/** THE SELLABILITY TEST (i′).
 *
 *  @param offers the priced boxes the SETTLED board draws, staff rows only —
 *    the staff-row and bed-row copies of one box carry the same staff lane key,
 *    so the pair is one ask and drops together.
 *  @param honest the netting's answer for this board. Absent = the honest round
 *    is off, and a withholding computed against an over-published kept set would
 *    cost the store money to protect 枠 it cannot honour anyway ⇒ inert.
 *  @param candidates the same kept masks `honest` was netted from.
 *  @param lanes the world they were cut from.
 *  @param book the capacity book for that world.
 *  @param on the round gate's value, passed in. False = nothing withheld.
 *
 *  ponytail: offers × rooms nettings on the settled board only. Upgrade: one
 *  joint allocation of kept 枠 and offers, the day the slot-vs-offer ruling lands.
 *
 *  ⚠ CEILING, STATED: offers are tested INDEPENDENTLY, so two surviving offers
 *  can both be counting on the same spare room. Offer-vs-offer is R4's job
 *  (`reconcileSellCells`) and stays there. This layer answers kept-vs-offer.
 */
export function withheldOffers(
  offers: readonly OfferAsk[],
  honest: HonestHeld | undefined,
  candidates: readonly ReservedLaneMask[],
  lanes: readonly BoardLane[],
  book: BedTruth,
  on: boolean,
): WithheldOffers {
  if (!on || !honest) return NOTHING

  const want = heldIds(honest)
  const heldSpans = honest.byLane.flatMap((l) =>
    l.held.map((s, i) => ({
      id: offerKey(l.laneKey, s.windowStart),
      laneKey: l.laneKey,
      start: s.start,
      end: s.end,
      // ⚖ ROUND 2 · SPEC-R2 v4 amendment item 1 — the room the netting GAVE this
      // 枠. Carried for the witness exit below and read nowhere else.
      room: l.heldRoom[i] ?? '',
    })),
  )
  const keys = new Set<string>()
  const blockedBy = new Map<string, string>()

  for (const o of offers) {
    const rooms = book.freeBedKeys(o.start, o.end, { stores: o.stores })
    // NOT OURS: the offer's own layer already lost the room. We only ever
    // subtract, never resurrect.
    if (rooms.length === 0) continue
    // LAZY EXIT (a): an offer over no kept 枠 costs ZERO nettings.
    const hit = heldSpans.filter((h) => overlaps(o.start, o.end, h.start, h.end))
    if (hit.length === 0) continue

    // LAZY EXIT (c) — THE WITNESS, and it is EXACT rather than a heuristic
    // (⚖ D-13 · SPEC-R2 v4 amendment item 1). The netting already produced a
    // LEGAL assignment and `heldRoom` is it. If this offer has a free room that
    // NO held 枠 overlapping its span was given, then blocking that room over
    // that span leaves the very same assignment legal — so every 枠 `honest`
    // holds is still held, and the offer is ON SALE with ZERO nettings.
    //
    // It can only ever prove ON SALE. A 「withheld」 verdict is 「no room works」,
    // which no single witness can establish, so that path still searches every
    // room below — which is why the verdict stays assignment-INDEPENDENT even
    // though the witness reads a tie-break. The property test proves it: the
    // set with this exit and the set without it are equal on random boards.
    //
    // WHY THE WITNESS ANSWERS (i′) AND NOT MERELY THE COUNT: the blocked book
    // returns a SUBSET of every 枠's rooms, so every blocked-legal assignment is
    // also legal unblocked. The witness proves size |want| is reachable blocked,
    // so the blocked maximum IS |want|; and `want`'s own held vector was the
    // earliest over the LARGER (unblocked) set of maximum solutions, so it is
    // still the earliest over the blocked subset it belongs to. The netting's
    // own tie-break therefore returns the same held SET — every 枠 kept.
    //
    // ⚠ CEILING, stated: that argument assumes the netting is `exact`. On a
    // board that trips `HONEST_SEARCH_BUDGET` both answers under-hold, and there
    // the witness is the MORE honest of the two — it exhibits a real legal
    // assignment where the truncated search may simply not have found one.
    //
    // The cost bound is the reason it exists: without it a busy board pays
    // offers × rooms nettings (measured 160 ms p95 at 30 staff × 10 rooms). With
    // it only a SATURATED offer — every free room of it in use by an overlapping
    // held 枠 — pays anything at all, and those are the boards where a
    // withholding is actually likely.
    const usedRooms = new Set(hit.map((h) => h.room))
    // A netting that never asked the book (the identity answer, gate off) reports
    // `''` for its rooms: there is no assignment to witness, so fall through.
    if (!usedRooms.has('') && rooms.some((r) => !usedRooms.has(r))) continue

    // LAZY EXIT (b): the first room that keeps every 枠 wins.
    const lostPer: string[][] = []
    let onSale = false
    for (const r of rooms) {
      const after = new Set(heldIds(honestHeld(candidates, lanes, blocked(book, r, o.start, o.end), true)))
      const lost = want.filter((k) => !after.has(k))
      if (lost.length === 0) {
        onSale = true
        break
      }
      lostPer.push(lost)
    }
    if (onSale) continue

    keys.add(o.key)
    const blocker = blockerOf(hit, lostPer)
    if (blocker) blockedBy.set(o.key, blocker)
  }

  return keys.size === 0 ? NOTHING : Object.freeze({ keys, blockedBy })
}

/** WHOSE 枠 THE BOX MAY NAME — and the rule is the shared box's own (「never
 *  name a person whose reason the operator cannot check」, `sharedRoomTitle`).
 *
 *  Every candidate room costs the store SOME 枠, or the offer would be on sale.
 *  A name is honest only when ONE kept 枠 is lost whichever room the offer takes
 *  and it overlaps the offer — then that 枠 really is 「先」. When two different
 *  rooms cost two different 枠 (the demo board at 13:30: ベッド1 is しろう's only
 *  room, ベッド2 is あずさ's) no single 枠 is the cause, and the box leads with the
 *  generic line instead of picking one and half-telling the truth. */
function blockerOf(
  hit: ReadonlyArray<{ id: string; laneKey: string }>,
  lostPer: readonly string[][],
): string | null {
  const always = hit.find((h) => lostPer.every((lost) => lost.includes(h.id)))
  return always ? always.laneKey : null
}
