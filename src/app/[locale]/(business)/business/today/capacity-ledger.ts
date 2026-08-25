// 今日の運営 — THE CAPACITY BOOK. One bed truth, one claims book, nothing else.
//
// WHY IT EXISTS (⚖ Liam 2026-08-25, the layer directive). Four independent
// readers answered "is a bed free?" on this screen — the sell layer's per-slot
// Set, the gap layer's per-call bedLedger, `allocateBed`, and the confirm gate's
// span overlap — and they disagreed on the board the operator was looking at.
// This module is the ONE book every later round reads from. It does not decide
// anything new: it wraps the search that already exists (`allocateBed`) and
// writes the answers down in a shape the lattice can afford to ask thousands of
// times a frame. That affordability is the MEMOISED path only — a hypothetical
// question, which is the one the rails and masks ask over and over.
//
// A question carrying a real `Subject` is UNCACHED here, and after R3 that is a
// measured choice rather than a premise. R1 wrote "a gesture asking once"; R3
// puts the Subject path on the verdict surfaces (the card in hand, a staged
// card's own confirm row, a chip's landing), where the frozen engine probes the
// same (lane, start, length) dozens of times per frame. The book still does not
// cache it — a Subject's key would have to carry the room it holds and its VIP
// flag, and that is a second cache to get wrong — so the DOOR keeps a
// frame-lifetime map instead, exactly the one `bedFeasibility` kept
// (TodayScreen `bedDoor`). Measured at 25 staff: +3.0% at rest, +6.7% mid-drag
// against the door it replaced, inside the run-to-run spread of either.
// `freeBedKeys` on that path still costs one search per candidate room.
//
// TWO PHASES, AND PHASE 1 CANNOT SEE PHASE 2.
//   Phase 1 · BED TRUTH — real occupancy only. What is free, what is refused,
//             which starts are 満室 for a fixed length, which starts a new
//             client could be given. `BedTruth` carries NO claims field: an
//             advertised offer is not a fact about a bed, and Phase 1 must stay
//             unable to read one. The acyclicity is the type, not a convention.
//   Phase 2 · CLAIMS — what the store has ADVERTISED on top of that truth
//             (sell boxes, スキマ枠 boxes). Reads Phase 1, is read by nobody in
//             Phase 1, and is a pure frozen value.
//
// EVERY QUESTION NAMES ITS ASKER. There is no default asker and no implicit
// "anybody": a hypothetical booking has to spell the stores it is asking on
// behalf of (`{ stores: [...] }`, or an explicit `{ stores: null }` for a
// floating staff member who pairs with any room). The store-isolation law is
// system-wide, and a book that answered "some room somewhere is free" would be
// fail-open — it would offer a store-b room to a store-a customer.
//
// EXCLUSION IS A GESTURE, NEVER A GUESS. The old screen let the rail read a
// world with the staged card deleted from it (`excludeId = live ?? pending`),
// so the board advertised a room that a booking was standing in. Here a world
// with a card lifted out of it can only be reached through `bedTruthViews`,
// which returns EXACTLY TWO worlds and only builds the second one while a hand
// is actually holding something. `buildBedTruth` is deliberately NOT exported:
// exported, it would be a third world for the asking.
//
// R1 SHIPPED IT DARK and R2 wired it as a shadow reader that proved its answers
// equalled the board's. R3 (2026-08-25) MADE IT THE BOARD'S: the 60分配置 rail
// and every per-cell verdict read this file through `bedDoor`, the shadow
// machinery is deleted, and `bedFeasibility` survives only as the parity
// battery's oracle. The two-world split above is no longer a promise about a
// future round — it is what the screen does, and `worldMinusHand` exists only
// while a hand is holding a card.

import type { BoardLane } from '@/business/lib/today-board'
import { allocateBed, roomFitsClass, sharesStore, type RoomPolicy } from './today-interactions'

/** The day lattice every capacity question is asked on, in minutes. Same step
 *  as the frozen guard engine's own probe lattice (canon-logic/gap-guard.ts:28,
 *  `const LATTICE_STEP_MIN = 5`) — it is re-declared rather than imported
 *  because that constant is module-private inside a frozen file, and a book
 *  answering on a coarser lattice than the engine asks on would answer the
 *  wrong question. The battery greps that line, so the two cannot drift. */
export const LATTICE_STEP_MIN = 5

/** How many distinct LENGTHS the book keeps cache rows for. Not a validity
 *  bound and not a caller contract — exactly like MAX_STORE_BINDINGS below,
 *  past it the book still answers, it just stops remembering.
 *
 *  ⚖ R3 (2026-08-25): this used to THROW past the eighth length, on the theory
 *  that a caller looping durations should discover the cost here. That was safe
 *  only while the book was dark. R3 puts `newClientMask` on the render path, and
 *  the rail's length follows the gesture (⚖ flag 50) — so eight short-pocket
 *  clicks or eight chip lengths on one unmoved board reach the ninth, and a
 *  throw during render takes 今日の運営 down with no error boundary under it and
 *  no way back. Degrading is the only acceptable failure direction for a book
 *  the board reads to draw itself.
 *
 *  ponytail: 8 rows is a ceiling on MEMORY, not on answers. Raise it if a real
 *  surface measures hot on the ninth length; the only cost of a higher number is
 *  memory, and the only cost of this one is repeated searches past it. */
const MAX_DURATIONS = 8

/** How many store bindings the book keeps CACHE ROWS for. Not a validity bound:
 *  past it the book still answers, it just stops remembering.
 *
 *  A binding is a STAFF LANE's store-list, so a 本部 board with a hundred stores
 *  on it has a hundred of them — the any-business-size law says that board is
 *  ordinary, not a caller bug. Refusing to answer it would be the worst possible
 *  failure direction, so saturation degrades instead: the 32 rows already minted
 *  keep serving, and every binding beyond them is answered uncached.
 *
 *  ponytail: 32 rows ≈ 2.7KB each. Raise it if an HQ board ever measures hot —
 *  the only cost of a higher number is memory, and the only cost of this one is
 *  repeated searches on the 33rd-and-later store. */
const MAX_STORE_BINDINGS = 32

/** The window the book answers inside, plus the ONE "now" it is given.
 *
 *  THREE ROUNDINGS CONSUME THIS ONE INPUT, and the book unifies none of them —
 *  each is canon-pinned and engine-internal, so a ledger that "helpfully"
 *  rounded on their behalf would be a fifth opinion rather than a book:
 *
 *    · SELL  ceils to the grid   — availability.ts:94
 *      `Math.max(open, Math.ceil((input.now ?? open) / gridMin) * gridMin)`
 *      13:24 on a 60-minute grid first sells 14:00.
 *    · GAP   truncates the raw minute — availability.ts:256 (`nowFloor`) and
 *      :273 (`Math.max(g.s, nowFloor)`): a pocket starts at 13:24 itself.
 *    · GUARD reads it raw — gap-guard.ts:224, the lead-time exemption
 *      (`residueEnd <= ctx.now + leadTimeMin`), no rounding at all.
 *
 *  ONE input, three documented readings. Nothing in THIS module reads `nowMin`:
 *  it is carried on the book so the later rounds hand the same number to all
 *  three sites instead of each reaching for its own clock. */
export interface DayFrame {
  openMin: number
  closeMin: number
  nowMin: number
}

/** WHO IS ASKING, when the asker is a real booking — one object, never loose
 *  fields.
 *
 *  Every bed question is asked on behalf of somebody, and the four facts that
 *  change the answer travel together: a booking that already holds a room keeps
 *  it when it is free, a VIP may not leave the 個室, and a person may only be
 *  given a room their own store has. Passing these as four positional arguments
 *  is how the screen ended up asking about the held card's VIP-ness when the
 *  question was about a hypothetical new client. */
export interface Subject {
  /** The booking's own id — its card and its own trailing 清掃 travel WITH it
   *  rather than blocking it (`allocateBed`'s two self-exclusions). */
  id: string
  currentBed: string | null
  vip: boolean
  /** The stores this booking's staff lane belongs to; `null` = floating. */
  stores: string[] | null
}

/** WHO IS ASKING, when nobody is asking yet: a booking that does not exist.
 *
 *  It still has to name its stores. `null` means a genuinely floating asker
 *  (canon's own "pairs with any room"), and it is spelled rather than defaulted
 *  because the difference between "this store's rooms" and "every room on the
 *  board" is the store-isolation law. A hypothetical is never VIP and holds no
 *  room: those are facts about a booking, and there is no booking here. */
export interface NewClient {
  stores: string[] | null
}

export type Asker = Subject | NewClient

/** WHICH KIND OF ASKER IS THIS, read fail-SAFE.
 *
 *  All three fields, not just `id`: TypeScript's excess-property check is
 *  literal-only, so an object built in a variable, a spread, or a function
 *  return can carry a stray `id` and still type as a `NewClient`. Reading that
 *  as a Subject is the dangerous direction — `allocateBed` would exclude that
 *  booking's own card and offer the room it is standing in (the
 *  advertise-an-occupied-room defect this module exists to close), and a
 *  half-object's missing `vip` would arrive `undefined` and walk a VIP past the
 *  ⚖ 51 個室 floor. A half-object is therefore a hypothetical: it lifts no
 *  card, grants no VIP exemption, and stays on the memoised path. */
const isSubject = (asker: Asker): asker is Subject => 'id' in asker && 'currentBed' in asker && 'vip' in asker

/** THE WHOLE ANSWER, so no caller has to derive half of it a second way.
 *
 *  `compatibleRoomsExist` is the difference between 「満室」 and 「この店には
 *  使える部屋がありません」 — the board said the first for both until #777, and
 *  a store with no 個室 was told its VIP booking was competing for a room that
 *  does not exist. It is EXISTENCE, never freeness: rooms this asker could use,
 *  busy or not. */
export interface BedAnswer {
  laneKey: string | null
  refusal: string | null
  compatibleRoomsExist: boolean
}

/** A run of START minutes, on the lattice, at which a booking of one fixed
 *  length has no room at all.
 *
 *  THE CLIP CONTRACT: runs cover starts in `[latticeStart, closeMin − dur]`
 *  only. A start later than that is not 満室 — no booking of that length can
 *  begin there at all, whatever the rooms are doing — so the tail between the
 *  last possible start and closing appears in no run. It is neither full nor
 *  bookable, and painting it is the display round's decision, not the book's.
 *
 *  THE SAME GOES FOR THE OTHER END: on a store whose door is off the clock's
 *  five-minute grid, the sliver between `openMin` and the first lattice slot
 *  (10:03 to 10:05) is answered live by `bedFor` but named by no run. A
 *  consumer must NOT read run-absence there as availability — ask the book.
 *
 *  `endMin` is one lattice step past the last full start: these are START
 *  minutes, not an occupancy span. */
export interface FullRun {
  startMin: number
  endMin: number
}

/** PHASE 1. Notice what is not here: no claims, no offers, no prices. */
export interface BedTruth {
  /** A frozen copy of the frame this book was built for — mutating the object
   *  you handed in cannot re-point a book that has already answered. */
  readonly frame: DayFrame
  /** allocateBed executions this book has performed, and how many store
   *  bindings it is keeping cache rows for (it stops minting at
   *  MAX_STORE_BINDINGS and answers uncached past that). Deliberately mutable:
   *  they are counters, and the battery's budgets read them. */
  readonly stats: { allocateBedCalls: number; storeBindings: number }
  /** The whole answer for one span, for one asker. */
  bedFor(start: number, end: number, asker: Asker): BedAnswer
  /** WHICH compatible rooms are free over the span — the same keep-if-free rule
   *  `allocateBed` applies, asked once per candidate room. */
  freeBedKeys(start: number, end: number, asker: Asker): readonly string[]
  freeBedCount(start: number, end: number, asker: Asker): number
  /** 満室 runs for ONE fixed length, on ONE store binding. There is deliberately
   *  no "current drag duration" input: a board that repainted its full-house
   *  marks because the operator resized the card in their hand would be showing
   *  the gesture, not the day. */
  fullRuns(dur: number, stores: string[] | null): readonly FullRun[]
  /** The protected-window feasibility the guard engine asks for, PRECOMPUTED as
   *  a lattice mask for one staff lane. The engine probes every 5 minutes of
   *  every pocket of every rail cell, and a naive callback measured 19–41× call
   *  growth at 25 staff; the mask answers from an array. Bound to a new client
   *  on THIS lane's stores — its own question, never the held card's — and it
   *  shares the hypothetical cache with every other question on that same
   *  (length, stores) pair, because it IS that question. Off-lattice starts
   *  fall through to the same search, so the mask is never a different answer,
   *  only a faster one. */
  newClientMask(lane: BoardLane, dur: number): (startMin: number) => boolean
}

/** The live gesture. Not a pending booking, not a booking id: a hand. */
export interface Hand {
  id: string
}

/** Internally every question is this shape. */
interface Query {
  id: string | null
  currentBed: string | null
  vip: boolean
  stores: string[] | null
}

const queryOf = (asker: Asker): Query =>
  isSubject(asker) ? asker : { id: null, currentBed: null, vip: false, stores: asker.stores }

/** PHASE 1 — build the bed truth for ONE world.
 *
 *  NOT EXPORTED. `bedTruthViews` is the only door; see the header.
 *
 *  INTERNALS (the perf contract): the hypothetical caches are integer-indexed
 *  flat arrays over the day lattice, keyed by the WHOLE question — duration,
 *  store binding, and lattice slot. Nothing else can vary on that path (a
 *  hypothetical is never VIP and holds no room), so the key is complete, and
 *  two lanes in the same store share one row rather than paying for the same
 *  108 searches twice. Bound: O(|durs| × |store bindings| × slots) per world,
 *  and there are exactly two worlds. At the 25-staff proof board, one store and
 *  one length, that is 108 searches for the whole frame.
 *
 *  THE VIEW DIMENSION IS THE INSTANCE. Nothing is cached at module scope: a
 *  world IS a book, so two worlds are two books and an answer from one can
 *  never be handed to the other.
 *
 *  `liftedId` is the card this world has had lifted out of it, or null. It is
 *  not an exclusion parameter — the items are already gone from `lanes` by the
 *  time this runs — it is here so the book can REFUSE a second lift (see the
 *  single-lift throw below). */
function buildBedTruth(
  lanes: BoardLane[],
  policy: RoomPolicy,
  frame: DayFrame,
  liftedId: string | null,
): BedTruth {
  const openMin = frame.openMin
  const closeMin = frame.closeMin
  const nowMin = frame.nowMin
  if (!Number.isFinite(openMin) || !Number.isFinite(closeMin) || !Number.isFinite(nowMin)) {
    throw new Error('capacity-ledger: the frame needs three real minutes (openMin, closeMin, nowMin)')
  }
  if (closeMin < openMin) throw new Error('capacity-ledger: the day closes before it opens')
  if (new Set(lanes.map((l) => l.key)).size !== lanes.length) {
    throw new Error('capacity-ledger: two lanes share a key — every answer naming a room would be ambiguous')
  }
  // A snapshot, so a caller mutating the frame afterwards cannot silently
  // re-point every cached slot at a different minute.
  const dayFrame: DayFrame = Object.freeze({ openMin, closeMin, nowMin })

  const beds = lanes.filter((l) => l.group === 'beds')
  /** THE LATTICE IS ANCHORED TO THE CLOCK, not to the store's door.
   *
   *  The frozen guard engine walks `Math.ceil(pocket.s / LATTICE_STEP_MIN) *
   *  LATTICE_STEP_MIN` (gap-guard.ts:195 and :276), so its probe minutes are
   *  always multiples of five from absolute midnight. A book anchored at
   *  `openMin` would sit on a different grid the moment a store opens at 10:03
   *  — every engine probe would miss this cache AND pay for a fresh search.
   *  Anchoring the same way makes the book's lattice a SUBSET of the engine's.
   *
   *  A store may open at any minute it likes; that is the operating-hours
   *  contract, and an opening time is not a caller error. The minutes between
   *  the door and the first lattice slot are answered live, on the same
   *  fallback every off-lattice question already uses. */
  const latticeStart = Math.ceil(openMin / LATTICE_STEP_MIN) * LATTICE_STEP_MIN
  const slots = Math.max(0, Math.floor((closeMin - latticeStart) / LATTICE_STEP_MIN))
  const stats = { allocateBedCalls: 0, storeBindings: 0 }

  /** Rooms this asker could use AT ALL — the store rule and the 個室 floor,
   *  read exactly as `allocateBed` reads them, with freeness left out. */
  const usable = (q: Query) => (l: BoardLane) => sharesStore(q.stores, l.stores) && roomFitsClass(l, q.vip, policy)

  /** THE ONE SEARCH. Every answer in this file comes from here; the book never
   *  walks the beds itself. */
  const search = (q: Query, start: number, end: number) => {
    stats.allocateBedCalls += 1
    return allocateBed(lanes, {
      id: q.id,
      currentBed: q.currentBed,
      stores: q.stores,
      vip: q.vip,
      start,
      end,
      policy,
    })
  }

  const answerFor = (q: Query, start: number, end: number): BedAnswer => {
    const found = search(q, start, end)
    return Object.freeze({
      laneKey: found.laneKey,
      refusal: found.refusal,
      compatibleRoomsExist: beds.some(usable(q)),
    })
  }

  /** Per-room freeness, still through the one search: asked to KEEP a given
   *  room, the allocator hands it back only when that room is compatible and
   *  free — its own keep-if-free rule, so this is not a second bed reader. */
  const freeKeysFor = (q: Query, start: number, end: number): readonly string[] =>
    Object.freeze(
      beds
        .filter(usable(q))
        .filter((l) => search({ ...q, currentBed: l.key }, start, end).laneKey === l.key)
        .map((l) => l.key),
    )

  // ── the caches, keyed by the whole hypothetical question ───────────────────
  type Row<T> = Array<T | undefined>
  const durIndex = new Map<number, number>()
  const storesIndex = new Map<string, number>()
  const answers: Array<Array<Row<BedAnswer> | undefined>> = []
  const freeKeys: Array<Array<Row<readonly string[]> | undefined>> = []
  const masks: Array<Array<Uint8Array | undefined>> = []
  const runs: Array<Array<readonly FullRun[] | undefined>> = []

  /** One row per distinct length, or -1 once the book has as many rows as it
   *  keeps — the same shape, and the same reason, as `storesIdx` below.
   *
   *  A length ≤ 0 or non-finite is still a THROW, and the difference matters:
   *  that is a programmer contract (a span with no minutes in it is not a
   *  question), while "the ninth different length" is ordinary board traffic
   *  under ⚖ flag 50 — the rail's length follows the gesture. One is a bug in
   *  the caller, the other is a Tuesday. */
  const durIdx = (dur: number) => {
    if (!Number.isFinite(dur) || dur <= 0) throw new Error(`capacity-ledger: a length must be a positive number of minutes, got ${dur}`)
    const known = durIndex.get(dur)
    if (known !== undefined) return known
    if (durIndex.size >= MAX_DURATIONS) return -1
    const i = durIndex.size
    durIndex.set(dur, i)
    answers[i] = []
    freeKeys[i] = []
    masks[i] = []
    runs[i] = []
    return i
  }

  /** One row per distinct store binding, or -1 once the book has as many rows
   *  as it keeps. A binding is a STAFF LANE's store-list, so a 本部 board
   *  carrying a hundred stores has a hundred of them — an ordinary board under
   *  the any-business-size law, not a caller mistake. Past saturation the book
   *  answers uncached rather than refusing: the rows already minted keep
   *  serving, and correctness never depends on the cache.
   *
   *  The fingerprint is JSON, not a joined string: `['a|b']` and `['a','b']`
   *  join to the same text and would share one cache row, so one of the two
   *  would be served the other's answers. A single space is the null binding —
   *  JSON.stringify never produces one, so nothing can collide with it. */
  const storesIdx = (stores: string[] | null) => {
    const key = stores === null ? ' ' : JSON.stringify([...stores].sort())
    const known = storesIndex.get(key)
    if (known !== undefined) return known
    if (storesIndex.size >= MAX_STORE_BINDINGS) return -1
    const i = storesIndex.size
    storesIndex.set(key, i)
    stats.storeBindings = storesIndex.size
    return i
  }

  /** The lattice slot a minute names, or -1 when the minute is off-lattice or
   *  outside the day — those questions are answered, just not remembered. The
   *  pre-open sliver (a 10:03 door up to the 10:05 slot) lands here too. */
  const slotIdx = (min: number) => {
    const i = (min - latticeStart) / LATTICE_STEP_MIN
    return Number.isInteger(i) && i >= 0 && i < slots ? i : -1
  }

  const rowOf = <T>(store: Array<Array<Row<T> | undefined>>, d: number, st: number): Row<T> => {
    const held = store[d][st]
    if (held) return held
    const made: Row<T> = new Array<T | undefined>(slots)
    store[d][st] = made
    return made
  }

  const cachedAnswer = (q: Query, start: number, dur: number): BedAnswer => {
    const s = slotIdx(start)
    if (s < 0) return answerFor(q, start, start + dur)
    // Past cache saturation: answered, just not remembered.
    const st = storesIdx(q.stores)
    const d = durIdx(dur)
    if (st < 0 || d < 0) return answerFor(q, start, start + dur)
    const row = rowOf(answers, d, st)
    const hit = row[s]
    if (hit) return hit
    const made = answerFor(q, start, start + dur)
    row[s] = made
    return made
  }

  const cachedFreeKeys = (q: Query, start: number, dur: number): readonly string[] => {
    const s = slotIdx(start)
    if (s < 0) return freeKeysFor(q, start, start + dur)
    const st = storesIdx(q.stores)
    const d = durIdx(dur)
    if (st < 0 || d < 0) return freeKeysFor(q, start, start + dur)
    const row = rowOf(freeKeys, d, st)
    const hit = row[s]
    if (hit) return hit
    const made = freeKeysFor(q, start, start + dur)
    row[s] = made
    return made
  }

  /** ⚖ ONE LIFT PER WORLD. `allocateBed` excludes the subject's own card, so a
   *  Subject question asked of an already-lifted world would lift a SECOND
   *  card — the three-world board, rebuilt by composition. The excluded world
   *  answers about the hand it was built for, and hypotheticals; nothing else. */
  const queryFrom = (asker: Asker): Query => {
    if (liftedId !== null && isSubject(asker) && asker.id !== liftedId) {
      throw new Error(
        `capacity-ledger: worldMinusHand answers about the hand (${liftedId}) and hypotheticals only — asking it about ${asker.id} would lift a second card`,
      )
    }
    return queryOf(asker)
  }

  const truth: BedTruth = {
    frame: dayFrame,
    stats,
    bedFor(start, end, asker) {
      const q = queryFrom(asker)
      return isSubject(asker) ? answerFor(q, start, end) : cachedAnswer(q, start, end - start)
    },
    freeBedKeys(start, end, asker) {
      const q = queryFrom(asker)
      return isSubject(asker) ? freeKeysFor(q, start, end) : cachedFreeKeys(q, start, end - start)
    },
    freeBedCount(start, end, asker) {
      return truth.freeBedKeys(start, end, asker).length
    },
    fullRuns(dur, stores) {
      const d = durIdx(dur)
      const st = storesIdx(stores)
      const held = st < 0 || d < 0 ? undefined : runs[d][st]
      if (held) return held
      const q = queryOf({ stores })
      const out: FullRun[] = []
      let open: number | null = null
      for (let i = 0; i < slots; i += 1) {
        const start = latticeStart + i * LATTICE_STEP_MIN
        // See FullRun's clip contract: a start whose booking cannot finish
        // before closing is not 満室, it is not a start.
        const inDay = start + dur <= closeMin
        const full = inDay && cachedAnswer(q, start, dur).laneKey === null
        if (full && open === null) open = start
        if (!full && open !== null) {
          out.push(Object.freeze({ startMin: open, endMin: start }))
          open = null
        }
      }
      if (open !== null) out.push(Object.freeze({ startMin: open, endMin: latticeStart + slots * LATTICE_STEP_MIN }))
      const made = Object.freeze(out)
      if (st >= 0 && d >= 0) runs[d][st] = made
      return made
    },
    newClientMask(lane, dur) {
      const q = queryOf({ stores: lane.stores })
      const d = durIdx(dur)
      const st = storesIdx(lane.stores)
      let mask = st < 0 || d < 0 ? undefined : masks[d][st]
      if (!mask) {
        mask = new Uint8Array(slots)
        for (let i = 0; i < slots; i += 1) {
          mask[i] = cachedAnswer(q, latticeStart + i * LATTICE_STEP_MIN, dur).laneKey !== null ? 1 : 0
        }
        // Past either saturation the mask is still BUILT — the answers are the
        // same ones, and serving this frame from an array it already walked is
        // free. It just is not remembered for the next one.
        if (st >= 0 && d >= 0) masks[d][st] = mask
      }
      const built = mask
      return (startMin: number) => {
        const i = slotIdx(startMin)
        // ponytail: the engine's first pocket start can sit off the lattice
        // (gap-guard's own rider). One search rather than a lie or a throw.
        if (i < 0) return answerFor(q, startMin, startMin + dur).laneKey !== null
        return built[i] === 1
      }
    },
  }
  return truth
}

/** THE ONLY WAY TO GET A WORLD WITH A CARD LIFTED OUT OF IT.
 *
 *  Private on purpose: exported, it would be the free exclude parameter that
 *  produced the three-world board — any caller could delete any booking from
 *  everyone's reality. The hand is the live gesture and nothing else, and a
 *  hand with no id is a bug in the caller, not an empty world.
 *
 *  ponytail — THE INHERITED CEILING, stated rather than papered over: the lift
 *  is an ITEM FILTER, exactly `allocateBed`'s own two self-exclusions (the
 *  card, and its own trailing `-cleanup`). It does not re-derive the board. So
 *  an EARLIER booking's 清掃 tail on the same room stays clipped where the
 *  lifted card used to start, and this world can advertise up to one turnaround
 *  less room than a board on which the card had never been placed. That is the
 *  allocator's semantics inherited faithfully — the alternative is a second bed
 *  reader, which is the disease. If a round ever needs the re-derived answer,
 *  it rebuilds the lanes through today-board and hands them in as a world. */
function excludedWorld(lanes: BoardLane[], policy: RoomPolicy, frame: DayFrame, hand: Hand | null): BedTruth {
  if (hand == null || typeof hand.id !== 'string' || hand.id === '') {
    throw new Error('capacity-ledger: worldMinusHand needs the live gesture id — a staged booking is real for every reader')
  }
  const lifted = lanes.map((l) => ({
    ...l,
    items: l.items.filter((i) => i.caseId !== hand.id && i.key !== `${hand.id}-cleanup`),
  }))
  return buildBedTruth(lifted, policy, frame, hand.id)
}

/** EXACTLY TWO WORLDS PER FRAME, both eager.
 *
 *  `world` is what everybody sees: a staged card is standing in a room, so the
 *  room is taken. `worldMinusHand` exists only while a hand is holding a card,
 *  and answers the one question that legitimately needs the card lifted — "may
 *  I put the thing I am holding here?". No hand, no second world: a third
 *  distinct exclusion is not discouraged here, it is unsayable. */
export function bedTruthViews(
  lanes: BoardLane[],
  policy: RoomPolicy,
  frame: DayFrame,
  hand: Hand | null,
): { world: BedTruth; worldMinusHand: BedTruth | null } {
  return Object.freeze({
    world: buildBedTruth(lanes, policy, frame, null),
    worldMinusHand: hand === null ? null : excludedWorld(lanes, policy, frame, hand),
  })
}

// ── PHASE 2 — CLAIMS ────────────────────────────────────────────────────────

/** One advertised box, as the sell/gap layers emit them. The SAME offer is
 *  emitted twice — once for the staff lane it is drawn on, once for the bed
 *  row — and the book counts it once. */
export interface OfferInput {
  /** The room the offer would consume. */
  resourceKey: string
  start: number
  end: number
  kind: 'sell' | 'gap'
  /** The lane the box is drawn on (a staff lane or the bed row itself). */
  laneKey: string
}

export interface Claim {
  resourceKey: string
  startMin: number
  endMin: number
  kind: 'sell' | 'gap'
  laneKey: string
}

/** Two claims the same room cannot honour: they overlap, or they sit closer
 *  together than that room's own turnaround. */
export interface ClaimConflict {
  resourceKey: string
  /** The two claims, in start order — `later` starts no earlier than `earlier`,
   *  which is the only ordering an overlap has. */
  earlier: Claim
  later: Claim
  /** Minutes between them; negative when they overlap. */
  gapMin: number
  /** The room's cleanup minutes — what the gap had to clear. */
  requiredMin: number
}

export interface ClaimsBook {
  /** Grouped by room in first-seen order, and within a room in the order the
   *  offers arrived. Deduplication keeps the FIRST emission, so this is the
   *  renderer's own order rather than one the book invented. */
  readonly claims: readonly Claim[]
  /** CLAIM SEPARATION, not mere disjointness: two boxes 5 minutes apart on a
   *  room that needs 15 minutes of turnaround are two promises the store cannot
   *  both keep. The minutes come in per room because `BoardLane` does not carry
   *  `cleanup_minutes` — that field belongs to today-board.ts, which is
   *  read-only for this round; the page attaches it in a later one.
   *
   *  A room MISSING from the map is treated as 0 minutes — deliberately: 0 is
   *  the store dial's own OFF value (⚖ flag 77), and at wiring time the page
   *  supplies every room's number, so a gap in the map is a bare board rather
   *  than an unknown. A present-but-nonsense value (NaN, Infinity) is a caller
   *  bug and throws. */
  violations(cleanupMinutesByBed: Record<string, number>): readonly ClaimConflict[]
  /** The Phase-2 reading of free capacity for one asker: rooms that are
   *  physically free over the span AND have not already been advertised into. */
  freeBedCountNet(start: number, end: number, asker: Asker): number
}

/** PHASE 2 — a pure function of (Phase 1, the offers). Same inputs, same
 *  output, every time; it reads its input and never writes to it.
 *
 *  The freeze is SHALLOW-but-complete for what it hands back: the book, the
 *  claims array, and every claim in it are frozen; the arrays `violations`
 *  returns are frozen as they are made. */
export function buildClaims(truth: BedTruth, offers: readonly OfferInput[]): ClaimsBook {
  /** Claims per room, deduped by (room, span, KIND).
   *
   *  WHY KIND IS IN THE KEY, three facts:
   *   · the PAIR shares it — one offer drawn on its staff lane and again on the
   *     bed row is the same box twice, same room, same span, same kind, so it
   *     still collapses to one claim;
   *   · a TWIN inside one kind cannot happen — each frozen ledger already
   *     refuses to sell one room twice (sell's per-slot Set, gap's bedLedger),
   *     so identical (room, span) within a kind is not a case;
   *   · a CROSS-KIND collision is exactly the disease this book exists to
   *     expose. The two ledgers never meet, so combineCrumbs can merge two
   *     30-minute crumbs into an (h, h+60) union that lands on the same room
   *     and the same hour as a sell cell. Two different offers, both
   *     advertised. Without kind in the key the book swallowed one of them and
   *     `violations` never saw the overlap. */
  const byRoom = new Map<string, Claim[]>()
  for (const o of offers) {
    // The sell engine emits `bed?.key ?? ''` on a store with no rooms
    // configured. Collapsing every such offer into one nameless room would
    // invent conflicts between unrelated boxes; the caller filters first.
    if (typeof o.resourceKey !== 'string' || o.resourceKey === '') {
      throw new Error('capacity-ledger: an offer with no room cannot be a claim on one')
    }
    const held = byRoom.get(o.resourceKey)
    const claim: Claim = Object.freeze({
      resourceKey: o.resourceKey,
      startMin: o.start,
      endMin: o.end,
      kind: o.kind,
      laneKey: o.laneKey,
    })
    if (!held) {
      byRoom.set(o.resourceKey, [claim])
      continue
    }
    if (held.some((c) => c.startMin === claim.startMin && c.endMin === claim.endMin && c.kind === claim.kind)) continue
    held.push(claim)
  }

  const claims = Object.freeze([...byRoom.values()].flat())

  const book: ClaimsBook = {
    claims,
    violations(cleanupMinutesByBed) {
      const minutesFor = (resourceKey: string) => {
        // Own properties only: `cleanupMinutesByBed['toString']` is a function
        // off the prototype, and `?? 0` would have let it through as NaN.
        if (!Object.hasOwn(cleanupMinutesByBed, resourceKey)) return 0
        const held = cleanupMinutesByBed[resourceKey]
        if (typeof held !== 'number' || !Number.isFinite(held)) {
          throw new Error(`capacity-ledger: ${resourceKey}'s turnaround is not a number of minutes (${String(held)})`)
        }
        return held
      }
      const out: ClaimConflict[] = []
      for (const [resourceKey, group] of byRoom) {
        const required = minutesFor(resourceKey)
        const sorted = [...group].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
        for (let i = 0; i < sorted.length; i += 1) {
          for (let j = i + 1; j < sorted.length; j += 1) {
            const gapMin = sorted[j].startMin - sorted[i].endMin
            // Sorted by start, so once one later claim clears the turnaround
            // every claim after it does too.
            if (gapMin >= required) break
            out.push(Object.freeze({ resourceKey, earlier: sorted[i], later: sorted[j], gapMin, requiredMin: required }))
          }
        }
      }
      return Object.freeze(out)
    },
    freeBedCountNet(start, end, asker) {
      return truth.freeBedKeys(start, end, asker).filter((key) => {
        const group = byRoom.get(key)
        return !group || !group.some((c) => c.endMin > start && c.startMin < end)
      }).length
    },
  }
  return Object.freeze(book)
}
