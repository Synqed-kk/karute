// 今日の運営 — THE HONEST 確保 COUNT: which held 枠 the store's ROOMS can honour
// at the same time. Pure, DARK on its own branch.
//
// ⚖ Liam 2026-09-12 21:1x — 「the 新規用に確保 number = WHAT CAN BE HONOURED」.
// The board used to publish one 枠 per staff row per pocket and never asked
// whether a ROOM was free for all of them at once: on the demo store four 枠
// were published and only three could ever be given to a customer, because two
// of them (ごろう 14:30–16:00 and あずさ 15:05–16:35) each had exactly one free
// room, the same one, over hours that overlap. This module is the question
// 「which set can the rooms honour together?」 and nothing else.
//
// WHERE IT SITS. Phase 1.5: after the per-lane enumeration (`reserved-mask.ts`,
// byte-untouched, whose own header forbids it from knowing `locked` or the
// publication filter) and after the caller's own locked-lane filter, once per
// SETTLED board — and, since ⚖ Liam 2026-09-13, once per POINTER FRAME on the
// board world too, for the rail alone (see the paragraph above `heldMaskOf`).
//
// IT DECIDES NOTHING ABOUT WHAT IS SOLD. A 枠 this module calls SHARED keeps
// every other property it had: its minutes stay withheld from online sale, stay
// out of the gap layer's input space, and stay covered against the 清掃 wash.
// The caller keeps passing the UNCHANGED mask to those three seams. What
// changes is what the store SAYS it can honour.
//
// THE CAPACITY UNIT, STATED. 「one 枠 needs one room for its whole span」 — the
// same unit `newClientMask` already answers on (`capacity-ledger.ts:511-534`),
// asked here through `freeBedKeys` with the lane's own store binding. Its
// ceiling is inherited and named rather than papered over: `freeBedKeys` routes
// through `allocateBed`, which approves a booking whose own 清掃 tail cannot fit
// (the adjudication's F10). Every fixture room is `cleanup_minutes: 0` and
// nothing writes the 設定 dial at this SHA, so it is invisible today; it belongs
// to the 清掃 family round, and it is said here so nobody re-hunts it.
//
// NO CYCLE, BY CONSTRUCTION: every import below is a TYPE. This file names
// nothing from `today-interactions` and nothing from the screen, so it can be
// applied at the screen without an edge back into the layer files.
//
// ⚖ D-52 (g): the no-room rule arrives as a PARAMETER for the same reason.

import type { BoardLane } from '@/business/lib/today-board'
import type { BedTruth } from './capacity-ledger'
import type { ReservedLaneMask, ReservedSpan } from './reserved-mask'

/** A held 枠 that has to share its only room with another 枠 the store is also
 *  holding. It is drawn honestly and it is NOT counted.
 *
 *  `sharedRoom` is the room the two want; `withLaneKey` / `withWindowStart` name
 *  the 枠 that got it. The partner may be a row the board does not DRAW (a
 *  price-0 staff row is still protected — the staff door's mask is deliberately
 *  not price-filtered) so a display must treat the name as optional and lead
 *  with the room. `withLaneKey` is `''` and `withWindowStart` `-1` in the one
 *  case with no claimant at all: a 枠 left unfilled by the node budget below
 *  rather than by a real collision. */
export interface SharedSpan extends ReservedSpan {
  readonly rooms: readonly string[]
  readonly sharedRoom: string
  readonly withLaneKey: string
  readonly withWindowStart: number
}

/** One staff row's honest answer. `held` and `shared` together are exactly the
 *  candidates that came in for this row — nothing is dropped, so a consumer can
 *  never lose a 枠 by reading one of the two lists. */
export interface HonestLane {
  readonly laneKey: string
  readonly held: readonly ReservedSpan[]
  /** Every room free for `held[i]` over its whole span, in key order. */
  readonly heldRooms: readonly (readonly string[])[]
  /** ⚖ ROUND 2 (2026-09-13) — SPEC-R2 v4 amendment item 2 — THE WALK'S OWN
   *  CHOICE for `held[i]`: the room `assign()` gave it, one of `heldRooms[i]`.
   *
   *  It is a TIE-BREAK and not a promise to a physical bed (see `assign`'s own
   *  header), so nothing may READ it as 「this 枠 will be in this room」. It is
   *  exported for exactly one caller — the bed-aware sales layer's witness exit
   *  — which uses it to prove an offer is ON SALE without re-netting: the walk
   *  already produced a legal assignment, so a room NO overlapping held 枠 was
   *  given stays free with that room blocked, and every held 枠 is still held.
   *  The witness can only prove 「on sale」 early; a 「withheld」 verdict still
   *  needs the full search over every room, which is what keeps that layer's
   *  answer assignment-INDEPENDENT.
   *
   *  `''` per held span on the identity path below (the gate off), where nobody
   *  asked the book anything and there is no choice to report. */
  readonly heldRoom: readonly string[]
  readonly shared: readonly SharedSpan[]
}

export interface HonestHeld {
  readonly byLane: readonly HonestLane[]
  /** Σ of `held` over every row — the number the header may say. */
  readonly total: number
  /** False when a component hit `HONEST_SEARCH_BUDGET` and the answer is the
   *  best COMPLETE legal assignment found rather than the proven maximum. Such
   *  an answer under-holds; it never over-holds. */
  readonly exact: boolean
}

/** Nodes per overlap component before the search stops widening.
 *
 *  ponytail: exact ≤ 4k nodes per overlap component; beyond that the best
 *  complete leaf so far — under-holds, never over-holds. Upgrade path: an
 *  interval-scheduling-with-eligibility solver if a real store ever trips it. */
export const HONEST_SEARCH_BUDGET = 4_096

/** ⚖ R4 · F2 (S5 PR-B) — extra preferred searches per call that iterate an
 *  inexact answer to a fixed point (a search-budget constant, not a business
 *  duration): each hop is monotone, so the chain is short; the cap bounds a
 *  frame's worst case at 1 + 1 + 3 searches. */
export const HONEST_FIXED_POINT_ROUNDS = 3

/** ⚖ DECISIONS.md R4 (S4 PR-B) — THE ONE SPELLING of a held 枠's identity:
 *  `laneKey|windowStart`, the same identity as a release. The output rebuild
 *  below, the comparator's KEPT tier, the seed and the settled reference all
 *  read it from here; there is no second spelling. */
export const heldIdOf = (laneKey: string, windowStart: number): string => `${laneKey}|${windowStart}`

/** ⚖ DECISIONS.md R4 (S4 PR-B) — how to choose AMONG equally large held sets.
 *  Absent (or `sellable` and `reference` both absent) = the historic answer,
 *  byte-identical: size, then the earlier held set. */
export type HeldPreference = {
  /** ONE definition of 「sellable」: the caller passes `sellableLaneKeysOf`'s
   *  answer (today-interactions.ts, the predicate `windowsOf` reads). A tie
   *  when absent. */
  readonly sellable?: (lane: BoardLane) => boolean
  /** The settled held set, as `heldIdOf` identities. A tie when absent. */
  readonly reference?: ReadonlySet<string>
  /** Tests only: node-budget override. Default HONEST_SEARCH_BUDGET. */
  readonly budget?: number
}

interface Candidate {
  readonly laneKey: string
  readonly span: ReservedSpan
  readonly rooms: readonly string[]
  /** 1 when this 枠's row is sellable under the preference, else 0. */
  readonly sell: number
  /** 1 when this 枠's identity is in the reference, else 0. */
  readonly kept: number
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd

/** The identity answer: every candidate held, nothing shared. This is what the
 *  round gate off looks like, and it is a function of the input alone (the
 *  preference, DECISIONS.md R4 (S4 PR-B), is not read on this path) — the
 *  book is not asked ONE question, so a gated-off board pays nothing for a law
 *  it is not running. `heldRooms` is therefore empty on this path: it is the
 *  answer to a question nobody asked. */
function identity(candidates: readonly ReservedLaneMask[]): HonestHeld {
  let total = 0
  const byLane = candidates.map((m) => {
    total += m.spans.length
    return Object.freeze({
      laneKey: m.laneKey,
      held: m.spans,
      heldRooms: Object.freeze(m.spans.map(() => Object.freeze([] as string[]))),
      heldRoom: Object.freeze(m.spans.map(() => '')),
      shared: Object.freeze([] as SharedSpan[]),
    })
  })
  return Object.freeze({ byLane: Object.freeze(byLane), total, exact: true })
}

// ⚖ D-52 (g) — ONE frozen `[]`, reused for every room-less span (the identity
// path's own spelling, `Object.freeze([] as string[])`, shared rather than
// re-minted since it is never written to).
const EMPTY_ROOMS: readonly string[] = Object.freeze([])

/** THE NETTING.
 *
 *  @param candidates the per-lane masks for the lanes the count is ABOUT —
 *    staff rows with a window, minus the locked ones. The caller owns that
 *    filter (`reserved-mask.ts:38-40` says so in as many words) and a price-0
 *    row IS in the set: its 枠 is protected even though nobody can buy it
 *    online, so its room really is spoken for.
 *  @param lanes the same world the candidates were cut from — only the store
 *    binding of each candidate's own row is read out of it.
 *  @param book the capacity book for that world.
 *  @param on the round gate's value, passed in. False = the identity answer.
 *  @param needsRoom ⚖ ROUND 3 · C F4 (⚖ D-52 (g)) — WHICH ROWS NEED A ROOM AT
 *    ALL, handed in by the caller (the screen passes `storeHasBeds(lanes,
 *    lane.stores)`; this file names nothing from today-interactions by its own
 *    law above). A row whose store owns no bed lane holds its 枠 on staff time
 *    alone: HELD by construction, no room, never shared. Absent = every row
 *    needs a room = the answer this function gave before F4.
 *  @param prefer ⚖ DECISIONS.md R4 (S4 PR-B) — the tie-break among maximum-size
 *    sets: SIZE → SELLABLE count → KEPT from `reference` → the earlier held
 *    set. With a reference, its legal subset seeds the search, so a budget
 *    trip can only keep the reference, never lose a 枠 it already had. Absent
 *    = the historic function, byte-identical.
 */
export function honestHeld(
  candidates: readonly ReservedLaneMask[],
  lanes: readonly BoardLane[],
  book: BedTruth,
  on: boolean,
  needsRoom: (lane: BoardLane) => boolean = () => true,
  prefer?: HeldPreference,
): HonestHeld {
  if (!on) return identity(candidates)
  const sellableOf = prefer?.sellable
  const reference = prefer?.reference

  const laneOf = new Map(lanes.map((l) => [l.key, l]))
  const flat: Candidate[] = []
  const roomless = new Set<string>()
  let unit: number | null = null
  for (const m of candidates) {
    const lane = laneOf.get(m.laneKey)
    // ⚖ D-52 (g) — asked ONCE per row, never per span, and RECORDED: the
    // rebuild below reads `roomless`, so the two decisions are one answer by
    // construction (a predicate that changed its mind between the two loops
    // could otherwise drop a span from `flat` and still miss the
    // held-by-construction branch — the m3 lie again).
    const roomed = lane ? needsRoom(lane) : true
    if (!roomed) roomless.add(m.laneKey)
    // ⚖ R4 (S4 PR-B) — asked once per row too, like `needsRoom`.
    const sell = sellableOf && lane && sellableOf(lane) ? 1 : 0
    for (const span of m.spans) {
      // ⚖ THE EQUAL-LENGTH INVARIANT, LOUD RATHER THAN A LIE. `reserved-mask.ts`
      // ends every span at `windowStart + protectedDuration` today, and the room
      // test below ("this room's last 枠 finished before this one starts") is only
      // a sufficient test while that holds. `ReservedSpan`'s own doc exists so a
      // later round MAY clip a span — the day it does, this throws instead of
      // quietly publishing a number nobody can honour.
      const len = span.end - span.start
      if (unit === null) unit = len
      if (len !== unit) {
        throw new Error(
          `honest-held: every 確保 枠 must be the store's own protected duration — got ${len} on ${m.laneKey} after ${unit}`,
        )
      }
      if (roomed) {
        flat.push({
          laneKey: m.laneKey,
          span,
          rooms: lane ? [...book.freeBedKeys(span.start, span.end, { stores: lane.stores })].sort() : [],
          sell,
          kept: reference?.has(heldIdOf(m.laneKey, span.windowStart)) ? 1 : 0,
        })
      }
    }
  }

  // ⚖ ORDER IS DETERMINISM. Every answer below is a function of this order, so
  // a published number can never depend on which lane the loop happened to
  // reach first. ⚖ DECISIONS.md R4 (S4 PR-B): the output is f(board,
  // preference) — deterministic for the same (board, preference); absent
  // preference = the historic function, byte-identical.
  flat.sort((a, b) => (a.span.start === b.span.start ? (a.laneKey < b.laneKey ? -1 : a.laneKey > b.laneKey ? 1 : 0) : a.span.start - b.span.start))

  const budget = prefer?.budget ?? HONEST_SEARCH_BUDGET
  const preferred = assign(flat, budget, reference !== undefined)
  let room = preferred.room
  let exact = preferred.exact
  // ⚖ R4 (S4 PR-B) — THE FLOOR, BY CONSTRUCTION: the preference may never hold
  // FEWER 枠 than the historic size-only search. Exact, it cannot (size is the
  // first tier); past the budget the extra tiers can spend the nodes size
  // needed, so the size-only search runs as if `prefer` were absent, with its
  // own budget, and wins when it holds strictly more. `exact` stays false.
  // Without a preference this never runs: one search, today's bytes.
  if (!exact && (sellableOf !== undefined || reference !== undefined)) {
    const plain = flat.map((c) => ({ ...c, sell: 0, kept: 0 }))
    const floor = assign(plain, budget, false)
    const held = (rs: readonly (string | null)[]) => rs.reduce((n, r) => n + (r === null ? 0 : 1), 0)
    if (held(floor.room) > held(room)) room = floor.room
    // ⚖ R4 · F2 (S5 PR-B fix round 1, lead ruling) — THE FIXED POINT, BY
    // CONSTRUCTION. An exact answer is a fixed point at once (the same tuple
    // wins whatever it is fed). An inexact one need not be: fed back as its own
    // reference, the seeded search can reach a strictly better leaf in the same
    // budget, and the board would move with no change to the windows. So while
    // the answer differs from the reference it was searched with (none, or a
    // stale one after a board change — compared on this board's candidates,
    // which is all the search reads), the preferred search runs again with the
    // answer as the reference, charged its own budget like the floor above, and
    // the new answer is taken while its held set changes AND it holds at least
    // as many (a would-shrink stops the loop and keeps the previous — a guarded
    // floor, never a throw). Each hop improves (size, then sellable) or keeps
    // them with more kept, so the chain converges; at most
    // HONEST_FIXED_POINT_ROUNDS extra searches. `exact` is the last search
    // taken. A steady-state frame (reference == answer) exits at the first check.
    const heldSet = (rs: readonly (string | null)[], i: number) => rs[i] !== null
    let searchedWith = flat.map((c) => c.kept === 1)
    for (let round = 0; round < HONEST_FIXED_POINT_ROUNDS; round += 1) {
      let differs = false
      for (let i = 0; i < flat.length && !differs; i += 1) differs = heldSet(room, i) !== searchedWith[i]
      if (!differs) break
      searchedWith = flat.map((_, i) => heldSet(room, i))
      const again = flat.map((c, i) => ({ ...c, kept: searchedWith[i] ? 1 : 0 }))
      const next = assign(again, budget, true)
      let moved = false
      for (let i = 0; i < flat.length && !moved; i += 1) moved = heldSet(next.room, i) !== heldSet(room, i)
      if (!moved || held(next.room) < held(room)) break
      room = next.room
      exact = next.exact
    }
  }

  // Back into per-lane shape, in the CANDIDATES' own lane order so the output
  // mirrors the mask it came from row for row.
  const at = new Map(flat.map((c, i) => [heldIdOf(c.laneKey, c.span.windowStart), i]))
  let total = 0
  const byLane = candidates.map((m) => {
    const held: ReservedSpan[] = []
    const heldRooms: (readonly string[])[] = []
    const heldRoom: string[] = []
    const shared: SharedSpan[] = []
    for (const span of m.spans) {
      // ⚖ D-52 (g) — HELD BY CONSTRUCTION: this row was recorded room-less
      // above, so none of its spans entered `flat` and none can be found in
      // `at`/`room` — decided here, before that lookup, from the SAME answer
      // the flat loop recorded (never a second call).
      if (roomless.has(m.laneKey)) {
        held.push(span)
        heldRooms.push(EMPTY_ROOMS)
        heldRoom.push('')
        continue
      }
      const i = at.get(heldIdOf(m.laneKey, span.windowStart))
      const c = i === undefined ? undefined : flat[i]
      const taken = i === undefined ? null : room[i]
      if (c && taken !== null) {
        held.push(span)
        heldRooms.push(c.rooms)
        // ⚖ ROUND 2 — the walk's CHOICE, beside the 枠's own free rooms. See
        // `HonestLane.heldRoom`: a tie-break reported, never a promise.
        heldRoom.push(taken)
        continue
      }
      const rooms = c?.rooms ?? []
      // WHO GOT THE ROOM. The first of this 枠's own rooms that a HELD 枠
      // overlapping it was given — that pair is the whole reason this one is
      // not counted, and it is what the box on screen has to name.
      let sharedRoom = rooms[0] ?? ''
      let withLaneKey = ''
      let withWindowStart = -1
      if (c) {
        for (const r of rooms) {
          const owner = flat.findIndex(
            (o, j) => room[j] === r && overlaps(o.span.start, o.span.end, c.span.start, c.span.end),
          )
          if (owner >= 0) {
            sharedRoom = r
            withLaneKey = flat[owner].laneKey
            withWindowStart = flat[owner].span.windowStart
            break
          }
        }
      }
      shared.push(Object.freeze({ ...span, rooms, sharedRoom, withLaneKey, withWindowStart }))
    }
    total += held.length
    return Object.freeze({
      laneKey: m.laneKey,
      held: Object.freeze(held),
      heldRooms: Object.freeze(heldRooms),
      heldRoom: Object.freeze(heldRoom),
      shared: Object.freeze(shared),
    })
  })
  return Object.freeze({ byLane: Object.freeze(byLane), total, exact })
}

/** A legal assignment of the sorted candidates to rooms, maximum size,
 *  deterministic.
 *
 *  LEGAL = each held 枠 gets one of ITS OWN free rooms, and two held 枠 on one
 *  room never overlap in time. Rooms are REUSABLE over disjoint hours, which is
 *  why this is not a plain bipartite matching.
 *
 *  The candidates are split into overlap components first — 枠 connected
 *  through time overlap — because two 枠 that never overlap anybody in common
 *  cannot take a room from each other, and the budget then applies to a real
 *  tangle rather than to the size of the day.
 *
 *  TIE-BREAK: among equal-size solutions the EARLIER-starting 枠 is kept.
 *
 *  HONEST-COUNT ROUND 1 · fix 2 (2026-09-13, CODEX-BLIND/CODEX-REPORT-HONEST-COUNT-REVIEW.md H1)
 *  — THE LEAVES ARE COMPARED, not merely the first one reached. Trying rooms
 *  before 「unfilled」 makes the walk PREFER holding at each position, but which
 *  ROOM a held 枠 takes decides what the rows after it can still hold, and that
 *  consequence is not local: on Codex's three-row board (a floating 10:00
 *  {r1,r2} · b 10:15 {r1} · c 10:30 {r2}) the walk reaches a→r1, b unheld,
 *  c→r2 first, while a→r2, b→r1 is the same size and the EARLIER held set. So
 *  every complete leaf of the best size is compared on its held vector in
 *  candidate order — the first position where one holds and the other does not
 *  decides.
 *
 *  HONEST-COUNT ROUND 1 · fix 3 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1b-delta-verify.md MAJOR 1)
 *  — AND THE BOUND IS ON THE TIE-BREAK TOO, not only on the size. Fix 2 relaxed
 *  it from `<=` to `<`, which stops pruning altogether once `bestSize` reaches
 *  the component's own length — the ordinary busy board, every 枠 holdable —
 *  and the walk then enumerates every ROOM PERMUTATION of an answer it already
 *  has, burns the budget and publishes `exact: false` (measured: every
 *  all-holdable board from n = 7 up, and a LOWER total on 8 of 3,000 random
 *  boards). So an equal-size branch is walked only while it can still WIN: the
 *  best it can reach is its prefix plus 「hold everything left」, and if that
 *  vector is not earlier than `best`, nothing below it can replace `best`.
 *  The node budget still caps the whole thing.
 *  ⚠ IT IS BLIND TO SELLABILITY: a price-0 row's earlier 枠 beats a sellable
 *  row's later one for the same room. Physically honest; a sellability-aware
 *  comparator is one line and it is a product ruling, not this module's.
 *
 *  ⚖ DECISIONS.md R4 (S4 PR-B) — THE RULING ARRIVED: with a `HeldPreference`
 *  the leaf order is the tuple (size, sellable, kept) and THEN the earlier held
 *  set (`tupleOrder` then `earlierHeld`, the leaf test in `assign`). The
 *  bound is the same tuple's admissible ceiling — 「hold everything left」 adds
 *  at most the remainder's size, its sellable count and its kept count — and
 *  when that ceiling EQUALS best's tuple the only leaf that can reach it holds
 *  everything left, so fix 3's earlier-start argument applies unchanged.
 *  Without a preference both extra tiers are 0 on every side and the tuple is
 *  today's size bound + fix 3, byte for byte. */
/** Is `a` the earlier held set? Candidate order is the sorted order, so the
 *  first position where one holds and the other does not decides it, and
 *  holding beats not holding. Equal vectors are not 「earlier」 — `best` stands. */
function earlierHeld(a: readonly (string | null)[], b: readonly (string | null)[]): boolean {
  for (let k = 0; k < a.length; k += 1) {
    const ah = a[k] !== null
    const bh = b[k] !== null
    if (ah !== bh) return ah
  }
  return false
}

/** ⚖ DECISIONS.md R4 (S4 PR-B) — the tuple order: size, then sellable, then
 *  kept. Negative = `a` below `b`, 0 = a tie on all three, positive = above. */
function tupleOrder(aSize: number, aSell: number, aKept: number, bSize: number, bSell: number, bKept: number): number {
  if (aSize !== bSize) return aSize - bSize
  if (aSell !== bSell) return aSell - bSell
  return aKept - bKept
}

/** ⚖ R4 (S4 PR-B) — THE ONE DEFINITION OF LEGAL for adding `c` on room `r`:
 *  the room's last 枠 in this component finished by the time `c` starts. The
 *  walk and the seed both ask it. */
const fits = (lastEnd: ReadonlyMap<string, number>, r: string, c: Candidate) => (lastEnd.get(r) ?? -1) <= c.span.start

/** ⚖ R4 (S4 PR-B) — one room per 枠 of `ks` (positions in `part`, ascending)
 *  such that every 枠 `fits`, or null when none exists. The first assignment in
 *  the walk's own room order. Every node it visits is charged to `spend`, the
 *  component's ONE budget (the walk's own): when `spend` says stop, the set is
 *  treated as not seatable and the caller stops seeding. */
function seatAll(flat: readonly Candidate[], part: readonly number[], ks: readonly number[], spend: () => boolean): string[] | null {
  const lastEnd = new Map<string, number>()
  const out: string[] = []
  const go = (j: number): boolean => {
    if (!spend()) return false
    if (j === ks.length) return true
    const c = flat[part[ks[j]]]
    for (const r of c.rooms) {
      const was = lastEnd.get(r) ?? -1
      if (!fits(lastEnd, r, c)) continue
      lastEnd.set(r, c.span.end)
      out[j] = r
      if (go(j + 1)) return true
      lastEnd.set(r, was)
    }
    return false
  }
  return go(0) ? out : null
}

function assign(flat: readonly Candidate[], budget: number, seeded: boolean): { room: (string | null)[]; exact: boolean } {
  const room: (string | null)[] = flat.map(() => null)
  let exact = true
  for (const part of components(flat)) {
    const best: (string | null)[] = part.map(() => null)
    let bestSize = -1
    let bestSell = -1
    let bestKept = -1
    let nodes = 0
    let stopped = false
    // Max END per room inside this component, so the room test stays sufficient
    // even if a later round ever clips a span to a different length.
    const lastEnd = new Map<string, number>()
    const picked: (string | null)[] = part.map(() => null)
    // ⚖ R4 (S4 PR-B) — what the undecided remainder from position i can still
    // add on each extra tier: the ceiling of 「hold everything left」.
    const remSell: number[] = part.map(() => 0)
    const remKept: number[] = part.map(() => 0)
    for (let k = part.length - 1, s = 0, t = 0; k >= 0; k -= 1) {
      s += flat[part[k]].sell
      t += flat[part[k]].kept
      remSell[k] = s
      remKept[k] = t
    }

    // ⚖ R4 (S4 PR-B) — THE SEED: 「the reference-seeded assignment stands, never
    // a phantom loss」. The reference's LEGAL SUBSET, walked in the search's own
    // (start, laneKey) order (start === windowStart, reserved-mask.ts:65): each
    // reference 枠 joins if the set STAYS LEGAL — some room assignment of the
    // whole set exists by `fits`, the walk's own test. INCREMENTAL: the room
    // assignment so far is kept and the new 枠 (the latest start so far) takes
    // the first room it `fits`; only when none fits is the whole set re-seated
    // by `seatAll` (a first-free-room greedy alone would drop a 枠 a legal set
    // can seat). Those re-seating nodes are charged to THIS component's one
    // budget, the walk's own; if it trips while seeding, the seed is what was
    // seated so far and `exact` is false. The seed's tuple is the starting
    // best; the search only replaces it with a strictly better leaf, and a
    // budget trip leaves it standing.
    if (seeded) {
      bestSize = 0
      bestSell = 0
      bestKept = 0
      const chosen: number[] = []
      let seedEnd = new Map<string, number>()
      const spend = () => {
        nodes += 1
        if (nodes > budget) stopped = true
        return !stopped
      }
      for (let k = 0; k < part.length && !stopped; k += 1) {
        const c = flat[part[k]]
        // not in the reference, or no free room at all (booked over): never seatable, costs nothing
        if (c.kept === 0 || c.rooms.length === 0) continue
        const quick = c.rooms.find((r) => fits(seedEnd, r, c))
        if (quick !== undefined) {
          seedEnd.set(quick, c.span.end)
          best[k] = quick
        } else {
          const seat = seatAll(flat, part, [...chosen, k], spend)
          if (seat === null) continue
          seedEnd = new Map<string, number>()
          for (let j = 0; j <= chosen.length; j += 1) {
            const at = j < chosen.length ? chosen[j] : k
            best[at] = seat[j]
            seedEnd.set(seat[j], Math.max(seedEnd.get(seat[j]) ?? -1, flat[part[at]].span.end))
          }
        }
        chosen.push(k)
        bestSize += 1
        bestSell += c.sell
        bestKept += 1
      }
    }

    const walk = (i: number, size: number, sell: number, kept: number) => {
      if (stopped) return
      nodes += 1
      if (nodes > budget) {
        stopped = true
        return
      }
      if (i === part.length) {
        const order = tupleOrder(size, sell, kept, bestSize, bestSell, bestKept)
        if (order > 0 || (order === 0 && earlierHeld(picked, best))) {
          bestSize = size
          bestSell = sell
          bestKept = kept
          for (let k = 0; k < picked.length; k += 1) best[k] = picked[k]
        }
        return
      }
      // The bound: even holding everything left cannot MATCH what we have.
      // ⚖ R4 (S4 PR-B) — on the whole tuple, each tier's admissible ceiling.
      const bound = tupleOrder(size + (part.length - i), sell + remSell[i], kept + remKept[i], bestSize, bestSell, bestKept)
      if (bound < 0) return
      // HONEST-COUNT ROUND 1 · fix 3 (2026-09-13, BLIND-CODE-HONEST-COUNT/LENS-1b-delta-verify.md MAJOR 1)
      // …and an equal-size branch is dead too unless it can still win the
      // TIE-BREAK. The best it can reach is 「this prefix + hold everything
      // left」; compared against `best` position by position, the first
      // disagreement decides, holding wins, equal is not earlier.
      // ⚖ R4 (S4 PR-B) — generalised: a ceiling EQUAL to best's tuple is
      // reached only by holding everything left (the size tier is tight), so
      // the same vector is the only one that could still win.
      // ponytail: the walk, not the answer — the node budget still caps a
      // pathological tangle and `exact: false` still says so when it trips.
      if (bound === 0) {
        let canWin = false
        for (let k = 0; k < part.length; k += 1) {
          const ph = k < i ? picked[k] !== null : true
          const bh = best[k] !== null
          if (ph !== bh) { canWin = ph; break }
        }
        if (!canWin) return
      }
      const c = flat[part[i]]
      for (const r of c.rooms) {
        // HONEST-COUNT ROUND 1 · fix 5 (2026-09-13, Greptile P1 on #904 — live rails)
        // — the undo is a `set`, never a `delete`. The only read of this map is
        // `?? -1`, so 「no key」 and 「-1」 are the same thing to the walk, and a
        // restored -1 is the absent key. Nothing iterates the map, so the extra
        // key is invisible; the Business data-access guard, which reads any
        // `.delete(` in territory as a write call, stays green.
        const was = lastEnd.get(r) ?? -1
        if (!fits(lastEnd, r, c)) continue
        lastEnd.set(r, c.span.end)
        picked[i] = r
        walk(i + 1, size + 1, sell + c.sell, kept + c.kept)
        picked[i] = null
        lastEnd.set(r, was)
        if (stopped) return
      }
      walk(i + 1, size, sell, kept)
    }
    walk(0, 0, 0, 0)
    if (stopped) exact = false
    for (let k = 0; k < part.length; k += 1) room[part[k]] = best[k]
  }
  return { room, exact }
}

/** Indices of the sorted candidates, grouped into runs connected through time
 *  overlap. Sorted by start, so a run ends the moment a candidate starts at or
 *  after the furthest end seen so far. */
function components(flat: readonly Candidate[]): number[][] {
  const out: number[][] = []
  let run: number[] = []
  let reach = -1
  for (let i = 0; i < flat.length; i += 1) {
    if (run.length > 0 && flat[i].span.start >= reach) {
      out.push(run)
      run = []
    }
    run.push(i)
    reach = Math.max(reach, flat[i].span.end)
  }
  if (run.length > 0) out.push(run)
  return out
}

/** THE BOARD WORLD IS NETTED PER FRAME — HONEST-COUNT ROUND 1 · fix 6
 *  (2026-09-13, ⚖ Liam: board world netted per frame for the rail).
 *
 *  There is no board-world demotion any more. The screen runs THIS function a
 *  second time, on the live mask with the live lanes and the live book that
 *  mask was cut from, and maps the answer through `heldMaskOf` below — so a
 *  collision the tentative move CREATES is seen on the frame it is created,
 *  which the old 「hand the board world the settled shared spans」 trade could
 *  not do. Measured cost of one netting: fixture 0.06 ms p95 · 30 staff × 10
 *  rooms 0.40 ms · 60 × 20 0.81 ms, and the live book already exists per frame,
 *  so the frame pays the search alone. ONE reader: the rail explanation. */

/** One honest row as the mask shape every existing consumer already takes —
 *  `reservedOffersFor` and `heldDrawnFor`'s output are this. A straight rename,
 *  so 「the online 確保 rows ≡ the honest held 枠」 is true by construction. */
export const heldMaskOf = (lane: HonestLane): ReservedLaneMask =>
  Object.freeze({ laneKey: lane.laneKey, spans: lane.held, protectedCount: lane.held.length })
