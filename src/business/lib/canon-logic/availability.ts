// CANON-LOGIC — 販売可能枠 derivation, band merging and the density guard,
// lifted from fable-store-today.html (:4848–4917, :5039, :5304–5372).
//
// Canon reads the live DOM to answer "is this lane free here?". It has to: its
// board IS its data. Ours is not — the same question is an interval test over
// spans we already hold, so the lift is stated in MINUTES and stays pure. The
// screen turns minutes into percent when it paints.
//
// THE ONE RULE WORTH NOT BREAKING: a sellable cell only exists where a staff
// member AND a resource are both genuinely free for the whole hour, inside a
// shift, after the clock. Canon pairs them index-wise and stops at the shorter
// list, so the board can never advertise more windows than there are beds
// (:4906–4914). Painting a slot the business cannot honour is the ⚖ 8/9 defect
// class — sample data with impossible states — so the pairing is load-bearing.

import { SELL_SLOT_MIN, DENSITY_CEILING, priceLabel, tierOf } from './pricing'

export interface Span {
  start: number
  end: number
}

export interface SellStaffLane {
  key: string
  name: string
  /** The window this lane can actually take work in, today. */
  from: number
  until: number
  locked: boolean
  /** Everything already standing on the lane: bookings, breaks, blocks, the
   *  absence wash, the off-shift hatches. */
  occupied: Span[]
  /** 定価 for this staff member, before the store's lever and the hour curve. */
  listPrice: number
  /** The stores this person works in; `null` = every store. */
  stores: string[] | null
}

export interface SellResourceLane {
  key: string
  name: string
  occupied: Span[]
  /** The one store this resource physically lives in. */
  storeId: string
}

/** A person can only use a bed in a store they actually work in. Under a
 *  clamped lens there is only one store and this is always true; under viewAll
 *  it is the difference between an honest window and one the business could
 *  never run (⚖ 8/9). */
export function canPair(staff: SellStaffLane, resource: SellResourceLane): boolean {
  return staff.stores === null || staff.stores.includes(resource.storeId)
}

/** canon `trackFree` (:4848) — with the DOM query replaced by the spans we hold. */
export function trackFree(occupied: Span[], start: number, end: number): boolean {
  return !occupied.some((o) => o.start < end && start < o.end)
}

export interface SellCell {
  laneKey: string
  resourceKey: string
  group: 'staff' | 'beds'
  /** Slot start, minutes from midnight. */
  h: number
  staff: string
  bed: string
  price: number | null
  tier: 1 | 2 | 3
}

export interface SellInput {
  staffLanes: SellStaffLane[]
  resourceLanes: SellResourceLane[]
  open: number
  close: number
  /** canon `effectiveGridMin` (:3539) — the start-time grid customers can pick
   *  from. The store's lever lives in Reserve受付; the board never advertises a
   *  start Reserve's own rules could not take. */
  gridMin: number
  /** Minutes-from-midnight "now" on the day being shown, or null for a future
   *  day where the whole day is still sellable. Past hours are not inventory. */
  now: number | null
  /** Hour → price, already carrying the store's lever and depth. */
  priceFor: (lane: SellStaffLane, hour: number) => number
}

/** canon `deriveSellableCells` (:4868). */
export function deriveSellableCells(input: SellInput): SellCell[] {
  const { staffLanes, resourceLanes, open, close, gridMin } = input
  const cells: SellCell[] = []
  /** canon (:4878–4882): 「過ぎた時間は売れない」— and "now" is rounded UP to the
   *  grid, so 13:24 on a 60-minute grid first sells 14:00. */
  const firstMin = Math.max(open, Math.ceil((input.now ?? open) / gridMin) * gridMin)
  for (let sm = firstMin; sm + SELL_SLOT_MIN <= close; sm += gridMin) {
    const end = sm + SELL_SLOT_MIN
    const hourOfSlot = Math.floor(sm / 60)
    const bedsExist = resourceLanes.length > 0
    /** canon :4895 — `bedsExist ? bedLanes.filter(…) : [null]`. A store with no
     *  resources configured at all is NOT a store that cannot sell: canon emits
     *  one staff cell per slot with an empty bed name and no bed row. Skipping
     *  the slot instead silenced the whole 販売可能 layer — tint, chip, price
     *  boxes and shelf count — for every bed-less store (ENGINE-DIFF A-1). The
     *  bed PAIRING rule below is unchanged and still load-bearing wherever beds
     *  exist: it is a cap on advertised windows, not a precondition for selling. */
    const freeBeds: Array<SellResourceLane | null> = bedsExist
      ? resourceLanes.filter((r) => trackFree(r.occupied, sm, end))
      : [null]
    const freeStaff = staffLanes.filter(
      (s) => !s.locked && sm >= s.from && end <= s.until && trackFree(s.occupied, sm, end),
    )
    if (freeBeds.length === 0 || freeStaff.length === 0) continue
    // canon pairs index-wise and stops at the shorter list (:4907–4914) so the
    // board can never advertise more windows than there are beds. Same rule
    // here, with one addition canon's single-store world never needed: a bed is
    // only claimable by someone who works in its store.
    const claimed = new Set<string>()
    for (const s of freeStaff) {
      // canon's `if (i >= freeBeds.length) return` — the cap holds in the
      // bed-less case too, where the single `[null]` entry buys exactly one
      // staff cell for the slot and no bed row.
      if (claimed.size >= freeBeds.length) break
      const bed = freeBeds.find((b) => b == null || (!claimed.has(b.key) && canPair(s, b)))
      if (bed === undefined) continue
      claimed.add(bed?.key ?? '')
      cells.push({
        laneKey: s.key, resourceKey: bed?.key ?? '', group: 'staff', h: sm,
        staff: s.name, bed: bed?.name ?? '', price: input.priceFor(s, hourOfSlot), tier: 1,
      })
      if (bed == null) continue
      cells.push({
        laneKey: s.key, resourceKey: bed.key, group: 'beds', h: sm,
        staff: s.name, bed: bed.name, price: null, tier: 1,
      })
    }
  }
  return cells
}

export interface SellBand {
  laneKey: string
  resourceKey: string
  group: 'staff' | 'beds'
  staff: string
  tier: 1 | 2 | 3
  lo: number | null
  hi: number | null
  hStart: number
  hEnd: number
}

/** canon `mergeBands` (:5304). Merging happens per PRICE TIER, not per price:
 *  at rest the board shows a few quiet zones, and the exact hourly figure comes
 *  back during a drag — the moment the number is actually being decided. */
export function mergeBands(cells: SellCell[]): SellBand[] {
  const byLane = new Map<string, SellCell[]>()
  for (const c of cells) {
    const k = `${c.group}:${c.group === 'staff' ? c.laneKey : c.resourceKey}`
    const list = byLane.get(k)
    if (list) list.push(c)
    else byLane.set(k, [c])
  }
  const bands: SellBand[] = []
  for (const arr of byLane.values()) {
    arr.sort((a, b) => a.h - b.h)
    let cur: SellBand | null = null
    for (const c of arr) {
      if (cur && c.h <= cur.hEnd && c.tier === cur.tier) {
        cur.hEnd = Math.max(cur.hEnd, c.h + SELL_SLOT_MIN)
        if (c.price != null) {
          cur.lo = cur.lo == null ? c.price : Math.min(cur.lo, c.price)
          cur.hi = cur.hi == null ? c.price : Math.max(cur.hi, c.price)
        }
      } else {
        cur = {
          laneKey: c.laneKey, resourceKey: c.resourceKey, group: c.group, staff: c.staff,
          tier: c.tier, lo: c.price, hi: c.price, hStart: c.h, hEnd: c.h + SELL_SLOT_MIN,
        }
        bands.push(cur)
      }
    }
  }
  return bands
}

export interface SellLayer {
  cells: SellCell[]
  bands: SellBand[]
  staffBands: SellBand[]
  min: number
  max: number
  /** canon `density-degraded` (:5369): more visible staff bands than the fixed
   *  ceiling means the day is fragmented, and tint mode degrades to drag-only.
   *  Fixed rule, deliberately NOT a store setting. */
  degraded: boolean
  /** canon (:5394–5397). 窓, and a spaced 「 · 」 — canon's own punctuation. */
  chipLabel: string
}

/** canon `renderPublicLayer`'s pure half (:5343–5397): tiers, bands, the
 *  density verdict and the chip's own sentence, all from one pass. */
export function buildSellLayer(cells: SellCell[], showPrice: boolean): SellLayer {
  const staffCells = cells.filter((c) => c.group === 'staff')
  const prices = staffCells.map((c) => c.price).filter((p): p is number => p != null)
  const min = prices.length ? Math.min(...prices) : 0
  const max = prices.length ? Math.max(...prices) : 0
  const tiered = cells.map((c) => ({ ...c, tier: tierOf(c.price, min, max) }))
  const bands = mergeBands(tiered)
  const staffBands = bands.filter((b) => b.group === 'staff')
  const withPrice = showPrice && staffBands.length > 0
  return {
    cells: tiered,
    bands,
    staffBands,
    min,
    max,
    degraded: staffBands.length > DENSITY_CEILING,
    chipLabel: `オンライン販売中 ${staffBands.length}窓${withPrice ? ` · ${priceLabel(min, max)}` : ''}`,
  }
}

export type WallType = 'closing' | 'shiftEnd' | 'break' | null

export interface GuardPocketSpan {
  s: number
  e: number
  walls: { left: WallType; right: WallType }
}

/** The free pockets on one lane — what the スキマガード reasons about. This is
 *  canon `guardPocketsForLane` (:7186–7228), not the prose comment at :4935 the
 *  first lift was written from (ENGINE-DIFF A-2). The wall vocabulary is the
 *  whole point, because a wall is what makes a residue EXEMPT rather than a
 *  loss, and canon's four rules are all different from a naive derivation:
 *
 *   · the OPENING is not a wall — canon says so in as many words
 *     (「開店同様、壁ではない」). A residue against the start of the day is a
 *     real loss, and stamping it 'opening' exempted it.
 *   · 'closing' and 'shiftEnd' are different walls: the store's close and this
 *     person's own last workable minute. The 操作者 is told which one.
 *   · a BREAK walls both the pocket before it and the pocket after it.
 *   · the day's clock TRUNCATES a pocket (`Math.max(g.s, nowFloor)`) and the
 *     truncated side is explicitly NOT a wall — the residue is only gone
 *     because it is already in the past.
 *
 *  `now` = minutes-from-midnight on the day shown, or null for a future day. */
export function freePockets(lane: {
  from: number
  until: number
  close: number
  now: number | null
  occupied: Array<Span & { isBreak?: boolean }>
}): GuardPocketSpan[] {
  const { from, until, close } = lane
  if (until <= from) return []
  const nowFloor = lane.now ?? from
  const busy = lane.occupied
    .filter((o) => o.end > from && o.start < until)
    .map((o) => ({ s: Math.max(o.start, from), e: Math.min(o.end, until), isBreak: o.isBreak === true }))
    .sort((a, b) => a.s - b.s)

  const gaps: Array<{ s: number; e: number; leftBreak: boolean; rightBreak: boolean }> = []
  let cursor = from
  let cursorBreak = false
  for (const b of busy) {
    if (b.s > cursor) gaps.push({ s: cursor, e: b.s, leftBreak: cursorBreak, rightBreak: b.isBreak })
    if (b.e > cursor) { cursor = b.e; cursorBreak = b.isBreak }
  }
  if (cursor < until) gaps.push({ s: cursor, e: until, leftBreak: cursorBreak, rightBreak: false })

  const out: GuardPocketSpan[] = []
  for (const g of gaps) {
    const gs = Math.max(g.s, nowFloor)
    if (gs >= g.e) continue
    const right: WallType = g.e === close ? 'closing' : g.e === until && until < close ? 'shiftEnd' : g.rightBreak ? 'break' : null
    const left: WallType = gs === g.s && g.leftBreak ? 'break' : null
    out.push({ s: gs, e: g.e, walls: { left, right } })
  }
  return out
}

// ── スキマ枠 / 詰め込みセッション (canon :4981–5182) ─────────────────────────

/** canon §1 `kPackCount` (:5066) — sessions packed against the head of a gap. */
export function kPackCount(s: number, e: number, sessionMin: number): number {
  return Math.floor((e - s) / sessionMin)
}

/** canon §2 `kGridCount` (:5070) — sessions that land on the customer's own
 *  start grid. The invariant `kGrid <= kPack` is structural; a violation is a
 *  bug, never a mode signal, so the caller below throws on it. */
export function kGridCount(s: number, e: number, gridMin: number, sessionMin: number): number {
  let cursor = Math.ceil(s / gridMin) * gridMin
  let k = 0
  while (cursor + sessionMin <= e) {
    k += 1
    cursor = Math.ceil((cursor + sessionMin) / gridMin) * gridMin
  }
  return k
}

/** canon `gapFillPieces` (:5081) — GRID MODE's leftover ends. */
export function gapFillPieces(s: number, e: number, gridMin: number): Array<{ s: number; e: number }> {
  const gridStart = Math.ceil(s / gridMin) * gridMin
  const gridEnd = Math.floor(e / gridMin) * gridMin
  if (gridEnd > gridStart) {
    const pieces: Array<{ s: number; e: number }> = []
    if (gridStart > s) pieces.push({ s, e: gridStart })
    if (e > gridEnd) pieces.push({ s: gridEnd, e })
    return pieces
  }
  return [{ s, e: Math.min(s + gridMin, e) }]
}

export interface GapCell {
  laneKey: string
  resourceKey: string
  group: 'staff' | 'beds'
  staff: string
  s: number
  e: number
  price: number
}

export interface GapPackingInput {
  staffLanes: SellStaffLane[]
  resourceLanes: SellResourceLane[]
  gridMin: number
  /** canon `STANDARD_SESSION_MIN` — the normal session the packer fills with. */
  sessionMin: number
  /** canon `GAP_FILL_MIN` (opsConfig.gapFillMinMin). 0 stops スキマ枠 OFFERS
   *  only; packed cells are unaffected (canon §5 dial scope). */
  gapFillMin: number
  now: number | null
  /** canon's guard-tier test: a residue a menu fits into exactly is a full-price
   *  packed session, not a discounted scrap. */
  fillableExactly: (min: number) => boolean
  fillDecomposition: (min: number) => number[] | null
  packedPrice: (lane: SellStaffLane, s: number, e: number) => number
  gapFillPrice: (lane: SellStaffLane, s: number, e: number) => number
}

/** canon `makeBedLedger` (:5055): one offer claims exactly ONE bed, and a bed
 *  already claimed by an earlier offer cannot be claimed twice. */
function bedLedger(resourceLanes: SellResourceLane[]) {
  const claimed = new Map<string, Span[]>(resourceLanes.map((r) => [r.key, []]))
  return (staff: SellStaffLane, s: number, e: number): SellResourceLane | null => {
    for (const bed of resourceLanes) {
      if (!canPair(staff, bed)) continue
      if (!trackFree(bed.occupied, s, e)) continue
      const taken = claimed.get(bed.key)!
      if (taken.some((span) => span.start < e && s < span.end)) continue
      taken.push({ start: s, end: e })
      return bed
    }
    return null
  }
}

/** canon `deriveGapPackingCells` (:5074–5182). Two answers per free pocket:
 *  full-length sessions packed against its head (`packed`, normal price) and
 *  whatever end is left over (`scraps`, the discounted スキマ枠 offer). A
 *  pocket that lands cleanly on the customer grid is left to the normal sell
 *  layer and only its ends come back here. */
export function deriveGapPackingCells(input: GapPackingInput): { packed: GapCell[]; scraps: GapCell[] } {
  const { staffLanes, resourceLanes, gridMin, sessionMin: S, gapFillMin } = input
  const take = bedLedger(resourceLanes)
  const packed: GapCell[] = []
  const scraps: GapCell[] = []

  const push = (out: GapCell[], lane: SellStaffLane, bed: SellResourceLane, s: number, e: number, price: number) => {
    out.push({ laneKey: lane.key, resourceKey: bed.key, group: 'staff', staff: lane.name, s, e, price })
    out.push({ laneKey: lane.key, resourceKey: bed.key, group: 'beds', staff: lane.name, s, e, price })
  }

  /** canon `pushGuardTierScrap` — a residue a menu fits exactly is packed at
   *  full price, never discounted. Returns true when it handled the residue. */
  function guardTier(lane: SellStaffLane, s: number, e: number): boolean {
    if (!input.fillableExactly(e - s)) return false
    const pieces = input.fillDecomposition(e - s)
    if (!pieces) {
      throw new Error(
        `deriveGapPackingCells: fillDecomposition(${e - s}) returned null while fillableExactly is true — ` +
          'never silently discount a first-class residue',
      )
    }
    let cursor = s
    for (const d of pieces) {
      const bed = take(lane, cursor, cursor + d)
      if (bed) push(packed, lane, bed, cursor, cursor + d, input.packedPrice(lane, cursor, cursor + d))
      cursor += d
    }
    return true
  }

  function pushScrap(lane: SellStaffLane, s: number, e: number) {
    if (e <= s) return
    if (guardTier(lane, s, e)) return
    if (!(gapFillMin > 0 && e - s >= gapFillMin)) return
    const bed = take(lane, s, e)
    if (!bed) return
    push(scraps, lane, bed, s, e, input.gapFillPrice(lane, s, e))
  }

  for (const lane of staffLanes) {
    if (lane.locked) continue
    for (const g of freePockets({ from: lane.from, until: lane.until, close: lane.until, now: input.now, occupied: lane.occupied })) {
      const kPack = kPackCount(g.s, g.e, S)
      const kGrid = kGridCount(g.s, g.e, gridMin, S)
      if (kGrid > kPack) {
        throw new Error(
          `deriveGapPackingCells: k_grid (${kGrid}) exceeds k_pack (${kPack}) for ${lane.name} ${g.s}-${g.e} — ` +
            'invariant violated, this is a bug, never a mode signal',
        )
      }
      if (S === 60 && kGrid === kPack) {
        for (const piece of gapFillPieces(g.s, g.e, gridMin)) pushScrap(lane, piece.s, piece.e)
      } else {
        for (let i = 0; i < kPack; i += 1) {
          const ps = g.s + i * S
          const bed = take(lane, ps, ps + S)
          if (!bed) continue
          push(packed, lane, bed, ps, ps + S, input.packedPrice(lane, ps, ps + S))
        }
        pushScrap(lane, g.s + kPack * S, g.e)
      }
    }
  }
  return { packed, scraps }
}
