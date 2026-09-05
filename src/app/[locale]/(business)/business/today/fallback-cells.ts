// 今日の運営 — THE FRAGMENT FALLBACK (SPEC-SELLING-ENGINE §5), DARK.
//
// WHAT IT IS. When R4's one-offer-per-bed reconcile drops a 販売可能枠, the
// stretch it lived on goes blank — and the rooms underneath it are not full.
// On the fixture board 見本ごろう loses 15:00–17:00 while a 30-minute run on
// ベッド1 and a 30-minute run on ベッド3 sit genuinely free, unclaimed by
// anybody. The sell layer can never reach them: it is fixed at one 60-minute
// slot on a 60-minute grid, so a fragment is invisible to it however cleverly
// the reconcile re-beds. This pass is what reaches them.
//
// WHAT IT IS NOT — AND THIS IS THE WHOLE OF THE E2 PROBE'S CORRECTION. It is
// NOT "the lost span re-enters the gap derivation". Measured (PROBE-E2
// SIM-2/SIM-3): re-entering the lost span, or the whole pocket, emits NOTHING —
// a grid-aligned span has `kGrid === kPack`, takes availability.ts:427's
// clean-grid branch, and `gapFillPieces` hands back `[]`. The load-bearing half
// is CALLER-SIDE: clip the input lane to ONE ROOM'S free time
// (pocket − advertised-on-this-lane − that-room-busy), and the UNCHANGED
// shipped engine emits the real fragments, because a clipped run shorter than
// one grid step falls through `gapFillPieces`' :312 line and comes back whole
// (SIM-7: ¥4,410 + ¥4,610 on the ごろう row, flag OFF, zero canon edits).
//
// SO THE CLIP IS THE MECHANISM, and canon is called exactly as it ships.
//
// IT CLAIMS AGAINST THE ONE SHARED CONTEXT (spec §4.4). The reconcile's
// promises and its surviving offers arrive as parameters and are folded into
// the room's occupancy before the clip is cut, so a fallback cell cannot take a
// room another layer already advertised. The pass never mutates them: it
// returns the cells AND the claims those cells would add, and the caller
// decides. Additions-only by construction — nothing here can drop a survivor,
// because nothing here can see one except as a wall.
//
// ROOM ORDER IS THE ⚖ ROOM RULE'S, NOT THE BOARD'S. Canon's internal `bedLedger`
// (availability.ts:345-358) walks `resourceLanes` in board order and knows no
// room class at all. That is now answered at the SEAM — `sellResourceLanes`
// hands canon its rooms 施術室-first — and this pass uses the same `orderRooms`,
// so it would spend the 個室 on a ¥4,610 scrap only where `allocateBed` would
// too. One spelling of the rule, not a second room solver: a 個室 clip is only
// offered for a span no standard room could yield, because the standard rooms
// are walked first and what they take is subtracted.
//
// IT HAS A SECOND TRIGGER NOW — THE GRID HOLE (⚖ R6 B1, 2026-09-02). The
// reconcile's drops are one way a stretch goes unadvertised while the rooms
// under it are free; `deriveGapPackingCells`' own GRID branch is another, and it
// needs no drop at all. When `S === 60 && kGrid === kPack` (availability.ts:427)
// the packer offers only what `gapFillPieces` hands back — the ends OUTSIDE
// [gridStart, gridEnd) — and leaves the middle "to the sell layer", which sells
// `SELL_SLOT_MIN` slots and nothing else. A leftover SHORTER than one slot is
// therefore advertised by NOBODY. Measured (PROBE-R5R6 §3, tip 4d10d4d5): at
// gridMin=30 / S=60 a 50-minute pocket with two beds standing empty advertises
// ZERO of its 50 minutes at the store's shipped floor. See `gridHoleWindows`.
//
// THE FLOOR IS HERE NOW, and E2's own note said whose business it was: the
// store's `minSellableMin` is a DISPLAY floor `gapLayerFor` applies to canon's
// raw emission (today-interactions.ts:1482-1486), and until R6 nothing applied
// it to THIS pass's emission — so a 20-minute fragment the native layer would
// have deleted was drawn. One floor rule, one answer, applied where each pass
// finishes: after the ledger has already spent the room, exactly as
// `gapLayerFor` does it. Absent ⇒ no floor ⇒ byte-identical to E2's answer.
//
// AND THE MERGE COMES FIRST, which the round's own blind review had to correct
// (fix round D1): `gapLayerFor` runs `combineCrumbs` BEFORE its floor, so the
// floor there judges whole runs. This pass floored canon's decomposed pieces,
// and canon decomposes — a menu-exact 50 comes back as [30, 20] — so the same
// dial that keeps a 50-minute native box deleted the 20-minute tail here, and
// the split pair also paid the ¥10 rounding twice. Same function, same order.


//
// HELD SPANS ARE DROPPED THIS ROUND, AND COUNTED (spec §5, E2 scope). A
// fallback cell overlapping a 新規用に確保 span is not emitted; the count comes
// back in `heldDropped` so E3's flip has the number it needs to decide tagging.
// Dropped AFTER emission rather than subtracted BEFORE it, deliberately: a
// subtraction would silently emit a DIFFERENT, shifted cell and there would be
// nothing left to count.
//
// IT READS NO CONFIG. Every dial arrives as a parameter — the same bundle
// `deriveGapPackingCells` already takes, spelled once as `FallbackDials` so it
// cannot drift from canon's own input type. Whatever lane snapshot it is handed
// IS the world it answers for, exactly as the reserved mask is.
//
// DARK THIS ROUND (spec §12, E2). Nothing imports it. The pipeline seam is E3.

import {
  deriveGapPackingCells,
  freePockets,
  gapFillPieces,
  kGridCount,
  kPackCount,
  type GapCell,
  type GapPackingInput,
  type SellCell,
  type SellResourceLane,
  type SellStaffLane,
  type Span,
} from '@/business/lib/canon-logic/availability'
import { SELL_SLOT_MIN } from '@/business/lib/canon-logic/pricing'
import type { BoardLane } from '@/business/lib/today-board'
import type { ReservedLaneMask } from './reserved-mask'
import {
  combineCrumbs,
  laneSpans,
  orderRooms,
  sellStaffLanes,
  sharesStore,
  type KindedGapCell,
  type SellDrop,
} from './today-interactions'

/** Every dial the packing layer takes, minus the two lane lists this pass
 *  builds itself. Derived from canon's own input type so a dial added there
 *  arrives here rather than being quietly dropped. */
export type FallbackDials = Omit<GapPackingInput, 'staffLanes' | 'resourceLanes'>

/** Where a fallback cell came from.
 *
 *  `sourceLane` and `room` restate the cell's own `laneKey`/`resourceKey` under
 *  the names the fallback's caller reasons in — the pass emits canon's staff-row
 *  and bed-row pair, and on the bed row `laneKey` is still the STAFF lane, which
 *  reads as a bug to anyone who has not just read availability.ts:372-373.
 *  `clippedFrom` is the new fact: the per-room free run this cell was cut out
 *  of, which is the only thing that explains why the box is where it is. */
export interface FallbackProvenance {
  readonly sourceLane: string
  readonly room: string
  readonly clippedFrom: Span
}

/** Canon's own cell, plus where it came from. Same shape the packing layer
 *  emits, so a consumer can treat these as gap cells and nothing else — and
 *  since ⚖ R6 B3 that includes the KIND, because the renderer reads one field on
 *  both producers' boxes and this pass is the second producer. */
export interface FallbackCell extends KindedGapCell, FallbackProvenance {}

/** A cell as it comes out of canon and into this pass's sink: provenance yes,
 *  KIND not yet. The kind is written after the merge and the floor, because a
 *  merge mints a new object and the floor throws some away — the same reason
 *  `gapLayerFor` tags at its own return (today-interactions ~:1517). */
type EmittedCell = GapCell & FallbackProvenance

/** One per-room free run handed to the packing engine.
 *
 *  Emitted for MEASUREMENT (spec §5c). A clip that produced no cell is
 *  invisible in `packed`/`scraps`, and that silence is exactly the question the
 *  residual-class measurement asks: is there a clip the clean-grid branch
 *  swallowed whole — grid-aligned, at least one full session, single room —
 *  which only canon's `packCleanGrid` flag could reach? Re-deriving the clips
 *  outside this file to answer that would be a second room solver, which is the
 *  one thing this module exists to avoid. */
export interface FallbackClip {
  readonly laneKey: string
  readonly room: string
  readonly s: number
  readonly e: number
}

export interface FallbackResult {
  readonly packed: readonly FallbackCell[]
  readonly scraps: readonly FallbackCell[]
  /** What the caller appends to the shared claims context — the emitted cells,
   *  both rows, in emission order. Named rather than left to the caller to
   *  re-merge, so "which arrays are the claims" has one answer. */
  readonly claims: readonly GapCell[]
  /** Cells suppressed because they overlapped a 新規用に確保 span, counted per
   *  BOX (not per row). E3's flip decides whether they are tagged instead. */
  readonly heldDropped: number
  /** Every clip built, in the order it was built. */
  readonly clips: readonly FallbackClip[]
}

export interface FallbackInput {
  /** THE WORLD — the same snapshot the reconcile ran against. */
  lanes: readonly BoardLane[]
  /** The day's close, for the pocket cut. */
  closeMin: number
  /** What the reconcile threw away: its own `onDrop` payloads, both kinds. */
  dropped: readonly SellDrop[]
  /** What it kept — the rooms the surviving offers hold. */
  survivors: readonly SellCell[]
  /** The gap layer's promises: the same `claims` list the reconcile was handed. */
  claims: readonly GapCell[]
  /** ⚖ flag 77's dial. A room missing from the map is a bare room (0 minutes) —
   *  the same decision, and the same reason, as the reconcile's own reading. */
  cleanupMinutesByBed: Readonly<Record<string, number>>
  /** The reserved mask for THIS world (spec §2). Empty for a guard-off store. */
  held: readonly ReservedLaneMask[]
  /** ⚖ Greptile #815 — the same locked-lane list `gapLayerFor`/`sellLayerFor`
   *  already take, so this pass can ask `sellStaffLanes` the same question they
   *  do rather than reading its own copy of the board. Required, not optional:
   *  every real caller already carries this list (TodayScreen's `locked`
   *  state), so an absent value here would be a caller that forgot it, not a
   *  store with nothing locked. */
  locked: string[]
  /** ⚖ BATCH-5 R3's display floor, for THIS pass's emission (⚖ R6 B1). The same
   *  dial `gapLayerFor` applies to the native layer, applied to the additions
   *  the same way — at the end, over the finished cells. Absent = no floor. */
  minSellableMin?: number
  dials: FallbackDials
}

interface Iv {
  s: number
  e: number
}

const EMPTY: FallbackResult = Object.freeze({
  packed: Object.freeze([]),
  scraps: Object.freeze([]),
  claims: Object.freeze([]),
  heldDropped: 0,
  clips: Object.freeze([]),
})

const overlaps = (a: Iv, b: Iv) => a.e > b.s && a.s < b.e

/** `base − cut` on the interval line. Copies; nothing handed in is touched. */
function subtract(base: readonly Iv[], cut: readonly Iv[]): Iv[] {
  let out: Iv[] = base.map((b) => ({ s: b.s, e: b.e }))
  for (const c of cut) {
    const next: Iv[] = []
    for (const b of out) {
      if (c.e <= b.s || c.s >= b.e) {
        next.push(b)
        continue
      }
      if (c.s > b.s) next.push({ s: b.s, e: c.s })
      if (c.e < b.e) next.push({ s: c.e, e: b.e })
    }
    out = next
  }
  return out
}

/** ⚖ ROOM RULE clause 1 — THE ALLOCATOR'S OWN ORDER, asked for a hypothetical
 *  (an advertisement is not a booking, so it carries no 個室のみ tag and every
 *  same-store room is a candidate). `sharesStore` and `orderRooms` are the SAME
 *  two functions `allocateBed` uses — one home each — so this cannot answer
 *  differently from the search that dropped the offer in the first place. */
function roomsInClassOrder(lanes: readonly BoardLane[], staff: BoardLane): BoardLane[] {
  return orderRooms(lanes.filter((l) => l.group === 'beds' && sharesStore(staff.stores, l.stores)))
}

/** ⚖ R6 B1 — WHAT `deriveGapPackingCells`' GRID BRANCH LEFT FOR NOBODY, asked
 *  as CANON'S OWN SUBTRACTION rather than as a second reading of the pocket.
 *
 *  `gapFillPieces(s, e, gridMin)` IS the packer's answer to "what of this pocket
 *  do I offer" on that branch; the pocket minus that answer is what the branch
 *  handed to the sell layer. The sell layer's unit is `SELL_SLOT_MIN`, so a
 *  leftover SHORTER than one slot is minutes the GRID branch handed to
 *  nobody OR that a sell slot may already cover — the arithmetic alone only
 *  proves the first at gridMin ≤ 30; at gridMin=45 a hole can sit entirely
 *  inside an already-offered slot (measured: pocket 600–690 → hole 630–675,
 *  inside sell slot 630–690; 126 such cases in a bounded scan). Harmless
 *  either way — the walk's survivor subtraction (`advertisedOnLane`), not
 *  this function's arithmetic, is what guarantees no double-offer — but that
 *  is "the hole" below 60, and it is the only thing this returns.
 *
 *  ⚠ TWO SHAPES, ONE LINE. Written as the packet's core arithmetic
 *  (`[ceil(s/g)*g, floor(e/g)*g)`) this would catch only the first:
 *   · gridEnd > gridStart — the grid-aligned CORE. 900–950 at gridMin=30 offers
 *     only 930–950 and 900–930 is nobody's (PROBE-R5R6 §3, measured).
 *   · gridEnd <= gridStart — availability.ts:312's single piece
 *     `[s, min(s + gridMin, e))`, whose TAIL is dropped when the pocket is
 *     longer than one grid step. 905–955 at gridMin=30 offers 905–935 and the
 *     last 20 minutes are nobody's; the packet's core is empty there and would
 *     have recovered nothing.
 *  Canon's own function answers both without either being spelled here.
 *
 *  EMPTY AT `gridMin === SELL_SLOT_MIN`, and that is a THEOREM — which is what
 *  makes the shipped board (gridMin 60) pay nothing for this trigger:
 *   · first shape — the leftover is the grid-aligned core, both ends multiples
 *     of `gridMin`, so its length is a whole number of 60s and never under one
 *     slot;
 *   · second shape — `gridEnd <= gridStart` with `e - s > 60` forces
 *     `kGrid === 0 < kPack`, which the branch check above refuses; so the shape
 *     survives only at `e - s <= 60`, where `min(s + gridMin, e) === e` and
 *     canon has offered the run entire.
 *
 *  ⚠ ABOVE 60 IT IS NOT EMPTY, AND THE REFUSAL IS DELIBERATE (⚖ R6 fix round
 *  D3). At `gridMin = 90` the pocket 45–155 leaves a real, sell-unreachable
 *  20-minute leftover (canon offers 45–135) and this function still answers
 *  `[]`. Recovering it would be a GENERALIZATION nobody has measured: above one
 *  slot the grid stops aligning with the sell layer, so the class stops being
 *  「minutes the GRID branch handed to nobody OR that a sell slot may already
 *  cover」 and starts including minutes the sell layer could reach if it were
 *  asked differently. The declared ceiling is
 *  `gridMin < SELL_SLOT_MIN`; the settings round that builds the 予約開始グリッド
 *  dial must either constrain that dial's domain or extend this trigger WITH a
 *  measurement (rider filed). The g=90 case is PINNED as a refusal, so the day
 *  someone widens the guard without measuring, a test says so. */
export function gridHoleWindows(s: number, e: number, dials: Pick<FallbackDials, 'gridMin' | 'sessionMin'>): Iv[] {
  const { gridMin, sessionMin } = dials
  if (sessionMin !== SELL_SLOT_MIN || gridMin >= SELL_SLOT_MIN) return []
  // The GRID branch's own condition. `kGrid > kPack` is canon's throw, never a
  // mode signal (availability.ts:421-426) — not this pass's to raise, and not a
  // branch it can be on either, so it is simply not the class.
  if (kGridCount(s, e, gridMin, sessionMin) !== kPackCount(s, e, sessionMin)) return []
  return subtract([{ s, e }], gapFillPieces(s, e, gridMin)).filter((w) => w.e - w.s < SELL_SLOT_MIN)
}

/** THE FRAGMENTS the reconcile's drops left behind, for every lane that lost
 *  something — plus (⚖ R6 B1) the GRID branch's uncoverable leftovers, which
 *  need no drop. Bounded by construction: only lanes with a drop or a hole, only
 *  the pockets those fell in, only rooms with free time inside them. */
export function fallbackCellsFor(input: FallbackInput): FallbackResult {
  const lostByLane = new Map<string, Iv[]>()
  for (const d of input.dropped) {
    const held = lostByLane.get(d.laneKey)
    const span = { s: d.h, e: d.h + SELL_SLOT_MIN }
    if (held) held.push(span)
    else lostByLane.set(d.laneKey, [span])
  }
  /** ⚖ R6 B1 — THE ONE COMPARISON THAT KEEPS THE SHIPPED BOARD FREE. It is
   *  `gridHoleWindows`' own guard, restated so the walk can be refused whole.
   *  At `gridMin === SELL_SLOT_MIN` — the shipped 60 — the class is provably
   *  empty, so a board with nothing dropped still pays exactly what it paid
   *  before this trigger existed: nothing. ABOVE 60 the emptiness is a
   *  DECLARED REFUSAL rather than a theorem — see `gridHoleWindows` (⚖ D3). */
  const gridHoles = input.dials.sessionMin === SELL_SLOT_MIN && input.dials.gridMin < SELL_SLOT_MIN
  if (lostByLane.size === 0 && !gridHoles) return EMPTY

  const turnaround = (roomKey: string) => {
    const held = input.cleanupMinutesByBed[roomKey]
    return typeof held === 'number' && Number.isFinite(held) ? Math.max(0, held) : 0
  }

  /** THE SHARED CLAIMS CONTEXT, as a room's occupancy. Real standing work
   *  (bookings, and the 清掃 the board already draws as its own item) counts
   *  as-is; a PROMISE is padded by the room's turnaround, which is the same test
   *  `promisedBy` applies when it decides who keeps the room. */
  const roomBusy = (room: BoardLane): Iv[] => {
    const pad = turnaround(room.key)
    return [
      ...room.items.map((i) => ({ s: i.startMin, e: i.endMin })),
      ...input.claims
        .filter((c) => c.resourceKey === room.key)
        .map((c) => ({ s: c.s - pad, e: c.e + pad })),
      ...input.survivors
        .filter((c) => c.group === 'staff' && c.resourceKey === room.key)
        .map((c) => ({ s: c.h - pad, e: c.h + SELL_SLOT_MIN + pad })),
    ]
  }

  /** ⚖ R6 fix round D1 — THE MERGED RUN'S PRICE, THROUGH THIS PASS'S OWN DIAL.
   *
   *  `combineCrumbs` re-prices a merged run with ONE `packedPrice` call over the
   *  union, because summing separately-rounded pieces charges the ¥10 remainder
   *  twice (BATCH-5 R2, and the comment on the function says so). The native
   *  layer spells that closure over its own `BoardLane` list; this one spells it
   *  over `input.dials.packedPrice`, which `gapPackingDials` built from the SAME
   *  lanes — so the two producers cannot answer a merged 50-minute box in
   *  different yen.
   *
   *  Canon's closure names a LANE, and the only things any spelling of it reads
   *  off one are the key (the shipped closure's `listOf`) and the 定価 (the
   *  battery's). Both come straight off this pass's own `input.lanes` here; the
   *  span is the argument, so the window fields are the union's own. */
  const laneByKey = new Map(input.lanes.map((l) => [l.key, l]))
  const priceUnion = (laneKey: string, s: number, e: number) => {
    const l = laneByKey.get(laneKey)
    return input.dials.packedPrice(
      {
        key: laneKey,
        name: l?.label ?? laneKey,
        from: s,
        until: e,
        // TRUE by construction (Greptile #815) — `laneKey` is always a lane the
        // walk above already found in `sellableLaneKeys`.
        locked: false,
        occupied: [],
        listPrice: l?.listPrice ?? 0,
        stores: l?.stores ?? null,
      },
      s,
      e,
    )
  }

  const heldByLane = new Map(input.held.map((m) => [m.laneKey, m.spans]))
  const packed: EmittedCell[] = []
  const scraps: EmittedCell[] = []
  const clips: FallbackClip[] = []
  let heldDropped = 0

  /** ⚠ THE PASS'S OWN CLAIMS, ON THE ROOM AXIS, ACROSS EVERY LANE.
   *
   *  The lane-local exclusion below is not enough on its own: two people who
   *  BOTH lost an offer are two separate walks, and without this they would
   *  each be handed the same free minute of the same room — the very
   *  double-claim R4 exists to close, re-opened one layer down (caught by the
   *  battery's §2 at grid=30 S=90: three cells on ベッド2 at 15:00). Padded by
   *  the room's turnaround for the same reason a promise is. */
  const claimedRooms = new Map<string, Iv[]>()
  const claimedOn = (room: BoardLane): Iv[] => {
    const pad = turnaround(room.key)
    return (claimedRooms.get(room.key) ?? []).map((c) => ({ s: c.s - pad, e: c.e + pad }))
  }

  /** ⚖ Greptile #815 — ONE SHIELD, spelled the way `heldDrawnFor` already
   *  spells it (today-interactions.ts ~:1202): ask `sellStaffLanes` which
   *  lanes the sell door would sell from at all, rather than re-writing
   *  `locked`/`listPrice > 0` by hand here. A locked lane or a lane with no
   *  list price has no sell layer and no gap layer either — `sellStaffLanes`
   *  drops both — so a fallback offer on either one is a box nobody else on
   *  the board would draw. シフトロック says in as many words 「オンライン空き枠
   *  からも除外されます」, and a ¥0 box on an unpriced lane breaks the same
   *  promise a second way. One spelling covers both, and covers a future third
   *  way to go unsellable for free. */
  const sellableLaneKeys = new Set(
    sellStaffLanes(input.lanes, input.locked)
      .filter((l) => !l.locked)
      .map((l) => l.key),
  )

  for (const lane of input.lanes) {
    if (lane.group !== 'staff' || lane.window == null || !sellableLaneKeys.has(lane.key)) continue
    const lost = lostByLane.get(lane.key) ?? []
    if (lost.length === 0 && !gridHoles) continue

    /** ⚠ B1 — WITHOUT THIS THE PASS ADVERTISES ONE PERSON ON TWO ROOMS AT ONE
     *  MINUTE. Everything already drawn on this lane, whichever layer drew it. */
    const advertisedOnLane: Iv[] = [
      ...input.claims.filter((c) => c.laneKey === lane.key).map((c) => ({ s: c.s, e: c.e })),
      ...input.survivors
        .filter((c) => c.group === 'staff' && c.laneKey === lane.key)
        .map((c) => ({ s: c.h, e: c.h + SELL_SLOT_MIN })),
    ]
    const rooms = roomsInClassOrder(input.lanes, lane)
    const heldSpans = heldByLane.get(lane.key) ?? []

    for (const pocket of freePockets({
      from: lane.window.from,
      until: lane.window.until,
      close: input.closeMin,
      now: input.dials.now,
      occupied: laneSpans(lane),
    })) {
      const whole: Iv = { s: pocket.s, e: pocket.e }
      /** WHAT THIS POCKET IS BEING ASKED ABOUT, and why — one entry per trigger.
       *
       *  The drop class asks about the WHOLE pocket at the store's own grid,
       *  exactly as it did before ⚖ R6. The grid-hole class asks only about the
       *  minutes the GRID branch offered to nobody, and it asks at
       *  `SELL_SLOT_MIN` — NOT to move the customer's start grid, but because
       *  `gapFillPieces` is the only door canon has for a leftover and it hands
       *  a run back WHOLE only when the run is shorter than the grid it is asked
       *  about (availability.ts:312, the mechanism this file's header already
       *  names). Every grid-hole window is shorter than one slot by
       *  construction, so at that grid canon emits the run entire and prices it
       *  with its own `guardTier`/`pushScrap` rules — asked at the store's 30 it
       *  would take the `gridEnd > gridStart` path and hand back `[]`, which is
       *  PROBE-E2's finding and the reason the naive clip recovers nothing here.
       *  The offer's own start is unchanged either way: it is a boundary canon
       *  itself produced, and a スキマ枠 is a fixed span rather than a grid start
       *  (canon's head piece `[s, gridStart)` starts wherever the pocket does). */
      const windows: Array<{ iv: Iv; gridMin: number }> = []
      if (lost.some((l) => overlaps(l, whole))) windows.push({ iv: whole, gridMin: input.dials.gridMin })
      if (gridHoles) {
        for (const hole of gridHoleWindows(whole.s, whole.e, input.dials)) {
          windows.push({ iv: hole, gridMin: SELL_SLOT_MIN })
        }
      }
      if (windows.length === 0) continue
      /** What this pass has already sold on this lane. Subtracted from EVERY
       *  later room's clip: the room is free, the person is not. Shared across
       *  the pocket's windows too — a grid hole lies inside the same person's
       *  same pocket, so the drop class's own boxes wall it. */
      const takenHere: Iv[] = []
      /** ⚖ R6 fix round A9 — BUILT ONCE PER ROOM PER POCKET, not once per room
       *  per WINDOW. Neither half moves inside the pocket: `roomBusy` reads only
       *  the pass's inputs, and everything `claimedOn` could gain in here is
       *  this same lane's own emission, which `takenHere` subtracts from every
       *  clip anyway. Cost hygiene only — the walk's answer is unchanged. */
      const roomsHere = rooms.map((room) => ({ room, busy: [...roomBusy(room), ...claimedOn(room)] }))
      for (const win of windows) {
        for (const { room, busy } of roomsHere) {
          const clip = subtract(subtract([win.iv], advertisedOnLane), [...busy, ...takenHere])
          if (clip.length === 0) continue
          for (const c of clip) clips.push(Object.freeze({ laneKey: lane.key, room: room.key, s: c.s, e: c.e }))
          const staffLane: SellStaffLane = {
            key: lane.key,
            name: lane.label,
            from: win.iv.s,
            until: win.iv.e,
            // TRUE by construction (Greptile #815) — `lane` is this loop's own
            // `lane`, already filtered through `sellableLaneKeys` above.
            locked: false,
            occupied: subtract([win.iv], clip).map((b) => ({ start: b.s, end: b.e })),
            listPrice: lane.listPrice,
            stores: lane.stores,
          }
          const resource: SellResourceLane = {
            key: room.key,
            name: room.label,
            // ponytail: a room belonging to every store (`stores === null`) passes
            // `sharesStore` above but would fail canon's `canPair`, which reads one
            // storeId. Borrowing the person's own store keeps the two rules
            // agreeing; on the real board a room always names its store.
            storeId: room.stores?.[0] ?? lane.stores?.[0] ?? '',
            occupied: busy.map((b) => ({ start: b.s, end: b.e })),
          }
          const out = deriveGapPackingCells({
            ...input.dials,
            gridMin: win.gridMin,
            staffLanes: [staffLane],
            resourceLanes: [resource],
          })
          for (const [cells, sink] of [
            [out.packed, packed],
            [out.scraps, scraps],
          ] as const) {
            for (const c of cells) {
              if (heldSpans.some((h) => c.e > h.start && c.s < h.end)) {
                // Counted ONCE per box, and the PERSON'S minute is still spent:
                // the hold is on the lane, not on the room, so re-offering the
                // same span out of the next room would be the same lost box
                // counted twice — and would let the mask quietly change which
                // rooms the walk reaches.
                if (c.group === 'staff') {
                  heldDropped += 1
                  takenHere.push({ s: c.s, e: c.e })
                }
                continue
              }
              const from = clip.find((iv) => c.s >= iv.s && c.e <= iv.e) ?? { s: c.s, e: c.e }
              sink.push(
                Object.freeze({
                  ...c,
                  sourceLane: lane.key,
                  room: room.key,
                  clippedFrom: Object.freeze({ start: from.s, end: from.e }),
                }),
              )
              if (c.group === 'staff') {
                takenHere.push({ s: c.s, e: c.e })
                const held = claimedRooms.get(room.key)
                if (held) held.push({ s: c.s, e: c.e })
                else claimedRooms.set(room.key, [{ s: c.s, e: c.e }])
              }
            }
          }
        }
      }
    }
  }

  /** ⚖ R6 B1, ORDER CORRECTED BY THE FIX ROUND (D1) — MERGE, THEN FLOOR, THEN
   *  KIND: the native producer's own three steps, in its own order
   *  (today-interactions `gapLayerFor`'s return).
   *
   *  THE FLOOR ONLY MEANS WHAT IT SAYS ON A MERGED RUN. canon's `guardTier`
   *  hands a menu-exact residue back DECOMPOSED — 50 minutes come out as
   *  [30, 20] on the fixture store's menu — and those pieces are one bookable
   *  span, not two products. Floored first, the store's 30-minute dial deletes
   *  the 20-minute tail of a run the native layer draws whole at 50; the two
   *  producers then answer the same shape differently, which is the one thing
   *  「one floor rule, one answer」 was written to prevent. Merged first, the
   *  floor asks its question of the box the customer would actually book. The
   *  merge also re-prices the union with ONE `packedPrice` call, so the pair no
   *  longer charges the ¥10 rounding remainder twice (BATCH-5 R2).
   *
   *  A MERGE CANNOT BRIDGE A HELD SPAN, and this is why the held drop stays
   *  upstream of it: `combineCrumbs` joins two cells only when `prev.e === c.s`
   *  EXACTLY, and a box suppressed above leaves its minutes standing empty
   *  between its neighbours, so the run is broken exactly where the hold is.
   *
   *  SCRAPS ARE NOT MERGED — the native layer does not merge them either
   *  (`raw.scraps.filter(sellable)`), and a スキマ枠 is canon's own discounted
   *  span rather than a piece of a decomposition.
   *
   *  THE FLOOR STILL LANDS LAST, AND E2'S REASON IS UNCHANGED: it runs AFTER
   *  the bed ledger has already spent the room, so a floored box has spent its
   *  room in this pass's walk exactly as a floored native box has spent its own
   *  (canon's `bedLedger` semantics — measured and accepted). Filtering earlier
   *  would hand the same minute to the next room in the walk and quietly emit a
   *  different, shifted box. Both rows of a box carry the same span, so the pair
   *  goes or stays together, and `claims` is the FILTERED list because a claim
   *  the board never draws is not a claim (today-interactions.ts:838-839). */
  const floor = input.minSellableMin ?? 0
  const sellable = (c: EmittedCell) => c.e - c.s >= floor
  const drawnPacked: FallbackCell[] = combineCrumbs(packed, input.dials.sessionMin, priceUnion)
    .filter(sellable)
    .map((c) => Object.freeze({ ...c, gapKind: 'packed' as const }))
  const drawnScraps: FallbackCell[] = scraps
    .filter(sellable)
    .map((c) => Object.freeze({ ...c, gapKind: 'scrap' as const }))

  return Object.freeze({
    packed: Object.freeze(drawnPacked),
    scraps: Object.freeze(drawnScraps),
    claims: Object.freeze([...drawnPacked, ...drawnScraps] as GapCell[]),
    heldDropped,
    clips: Object.freeze(clips),
  })
}
