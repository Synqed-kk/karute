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
    const freeBeds = bedsExist ? resourceLanes.filter((r) => trackFree(r.occupied, sm, end)) : []
    const freeStaff = staffLanes.filter(
      (s) => !s.locked && sm >= s.from && end <= s.until && trackFree(s.occupied, sm, end),
    )
    if (!bedsExist || freeBeds.length === 0 || freeStaff.length === 0) continue
    // canon pairs index-wise and stops at the shorter list (:4907–4914) so the
    // board can never advertise more windows than there are beds. Same rule
    // here, with one addition canon's single-store world never needed: a bed is
    // only claimable by someone who works in its store.
    const claimed = new Set<string>()
    for (const s of freeStaff) {
      const bed = freeBeds.find((b) => !claimed.has(b.key) && canPair(s, b))
      if (!bed) continue
      claimed.add(bed.key)
      cells.push({
        laneKey: s.key, resourceKey: bed.key, group: 'staff', h: sm,
        staff: s.name, bed: bed.name, price: input.priceFor(s, hourOfSlot), tier: 1,
      })
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

/** The free pockets on one lane — what the スキマガード reasons about, and what
 *  the 空き枠 count on the calendar is measuring. Canon derives these the same
 *  way it derives sellability: the lane's window minus everything standing on
 *  it (:4935–4938). Walls mark the sides that are a hard boundary rather than
 *  another booking, because a residue against a wall was never sellable. */
export function freePockets(lane: { from: number; until: number; occupied: Span[] }): Array<{ s: number; e: number; walls: { left: string | null; right: string | null } }> {
  const sorted = [...lane.occupied].sort((a, b) => a.start - b.start)
  const out: Array<{ s: number; e: number; walls: { left: string | null; right: string | null } }> = []
  let cursor = lane.from
  for (const o of sorted) {
    if (o.start > cursor) {
      out.push({ s: cursor, e: Math.min(o.start, lane.until), walls: { left: cursor === lane.from ? 'opening' : null, right: null } })
    }
    cursor = Math.max(cursor, o.end)
    if (cursor >= lane.until) break
  }
  if (cursor < lane.until) {
    out.push({ s: cursor, e: lane.until, walls: { left: cursor === lane.from ? 'opening' : null, right: 'closing' } })
  }
  return out.filter((p) => p.e > p.s)
}
