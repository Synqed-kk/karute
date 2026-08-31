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
// ROOM ORDER IS ⚖ 51'S, NOT THE BOARD'S. Canon's internal `bedLedger`
// (availability.ts:345-358) walks `resourceLanes` in board order and consults
// no room class at all — `roomFitsClass` is never called on that path. Latent
// today (the gap layer never reaches ベッド3 on this board); live the moment a
// fallback exists, and it would spend the 個室 on a ¥4,610 scrap where
// `allocateBed`, which does obey 個室-last, would not. So the clip is BUILT in
// the allocator's own class order, out of the allocator's own exported
// predicates — one spelling of the rule, not a second room solver — and a 個室
// clip is only offered for a span no standard room could yield, because the
// standard rooms are walked first and what they take is subtracted.
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
  laneSpans,
  needsPrivateRoom,
  roomFitsClass,
  sharesStore,
  type RoomPolicy,
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
 *  emits, so a consumer can treat these as gap cells and nothing else. */
export interface FallbackCell extends GapCell, FallbackProvenance {}

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
  rooms: RoomPolicy
  /** The reserved mask for THIS world (spec §2). Empty for a guard-off store. */
  held: readonly ReservedLaneMask[]
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

/** ⚖ 51 — THE ALLOCATOR'S OWN ORDER, asked with the reconcile's own `vip:false`
 *  (an advertisement is not a booking, so the 個室 floor asks its ordinary
 *  question — today-interactions.ts:1020). Built out of `sharesStore`,
 *  `roomFitsClass` and `needsPrivateRoom`, which is where `allocateBed` keeps
 *  the same three rules, so this cannot answer differently from the search that
 *  dropped the offer in the first place. */
function roomsInClassOrder(
  lanes: readonly BoardLane[],
  staff: BoardLane,
  policy: RoomPolicy,
): BoardLane[] {
  const beds = lanes.filter((l) => l.group === 'beds' && sharesStore(staff.stores, l.stores))
  const candidates = beds.filter((l) => roomFitsClass(l, false, policy))
  return needsPrivateRoom(false, policy) || !policy.privateIsLastResort
    ? candidates
    : [
        ...candidates.filter((l) => l.roomClass !== 'private'),
        ...candidates.filter((l) => l.roomClass === 'private'),
      ]
}

/** THE FRAGMENTS the reconcile's drops left behind, for every lane that lost
 *  something. Bounded by construction: only lanes with a drop, only the pockets
 *  those drops fell in, only rooms with free time inside them. */
export function fallbackCellsFor(input: FallbackInput): FallbackResult {
  const lostByLane = new Map<string, Iv[]>()
  for (const d of input.dropped) {
    const held = lostByLane.get(d.laneKey)
    const span = { s: d.h, e: d.h + SELL_SLOT_MIN }
    if (held) held.push(span)
    else lostByLane.set(d.laneKey, [span])
  }
  if (lostByLane.size === 0) return EMPTY

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

  const heldByLane = new Map(input.held.map((m) => [m.laneKey, m.spans]))
  const packed: FallbackCell[] = []
  const scraps: FallbackCell[] = []
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

  for (const lane of input.lanes) {
    if (lane.group !== 'staff' || lane.window == null) continue
    const lost = lostByLane.get(lane.key)
    if (lost === undefined) continue

    /** ⚠ B1 — WITHOUT THIS THE PASS ADVERTISES ONE PERSON ON TWO ROOMS AT ONE
     *  MINUTE. Everything already drawn on this lane, whichever layer drew it. */
    const advertisedOnLane: Iv[] = [
      ...input.claims.filter((c) => c.laneKey === lane.key).map((c) => ({ s: c.s, e: c.e })),
      ...input.survivors
        .filter((c) => c.group === 'staff' && c.laneKey === lane.key)
        .map((c) => ({ s: c.h, e: c.h + SELL_SLOT_MIN })),
    ]
    const rooms = roomsInClassOrder(input.lanes, lane, input.rooms)
    const heldSpans = heldByLane.get(lane.key) ?? []

    for (const pocket of freePockets({
      from: lane.window.from,
      until: lane.window.until,
      close: input.closeMin,
      now: input.dials.now,
      occupied: laneSpans(lane),
    })) {
      const whole: Iv = { s: pocket.s, e: pocket.e }
      if (!lost.some((l) => overlaps(l, whole))) continue
      /** What this pass has already sold on this lane. Subtracted from EVERY
       *  later room's clip: the room is free, the person is not. */
      const takenHere: Iv[] = []
      for (const room of rooms) {
        const busy = [...roomBusy(room), ...claimedOn(room)]
        const clip = subtract(subtract([whole], advertisedOnLane), [...busy, ...takenHere])
        if (clip.length === 0) continue
        for (const c of clip) clips.push(Object.freeze({ laneKey: lane.key, room: room.key, s: c.s, e: c.e }))
        const staffLane: SellStaffLane = {
          key: lane.key,
          name: lane.label,
          from: pocket.s,
          until: pocket.e,
          locked: false,
          occupied: subtract([whole], clip).map((b) => ({ start: b.s, end: b.e })),
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

  return Object.freeze({
    packed: Object.freeze(packed),
    scraps: Object.freeze(scraps),
    claims: Object.freeze([...packed, ...scraps] as GapCell[]),
    heldDropped,
    clips: Object.freeze(clips),
  })
}
