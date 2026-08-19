// 今日の運営 — the board's interaction handlers, extracted from the JSX.
//
// WHY THEY LIVE OUT HERE (⚖ parity-wave Addendum 3): @testing-library cannot be
// used inside Business territory — the import-isolation allowlist is react /
// next / node: only, and it is not installed. So every handler that touches the
// DOM is a small function taking real nodes, the JSX calls it, and the tests
// call it with plain jsdom nodes. Zero new imports, and the drag lattice, the
// park/place flow and the popover rules are all machine-checkable.
//
// The GEOMETRY is not here: it is canon's, in src/business/lib/canon-logic/.
// This file is the thin layer that reads a pointer event into that geometry's
// inputs and writes the answer back onto the board's state.

import {
  buildSellLayer,
  deriveSellableCells,
  type SellLayer,
  type SellResourceLane,
  type SellStaffLane,
} from '@/business/lib/canon-logic/availability'
import { priceAt } from '@/business/lib/canon-logic/pricing'
import { dragGeometry, dragModeFor, type DragMode, type DragOrigin } from '@/business/lib/canon-logic/drag-rules'
import { minuteOf, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'

export type { DragMode, DragOrigin }

/** A card that has been moved from where the server placed it. `laneKey` is the
 *  STAFF lane it now sits on; the bed copy keeps its own lane and takes only the
 *  span, exactly as canon moves a pair (`pairOf` + `evSet`). */
export interface Move {
  laneKey: string
  x: number
  w: number
}

export type Moves = Record<string, Move>

// ── DOM readers ────────────────────────────────────────────────────────────

/** canon `dragStart` (:4435) — which edge did the pointer grab? */
export function dragModeAt(el: Element, clientX: number): DragMode {
  const r = el.getBoundingClientRect()
  return dragModeFor(clientX, r.left, r.right)
}

/** The pointer's travel as a percentage of the track it started on. */
export function deltaPctIn(track: Element, dx: number): number {
  const width = track.getBoundingClientRect().width
  return width === 0 ? 0 : (dx / width) * 100
}

/** Where in the track (0–1) the pointer is — the create-at-slot and
 *  place-from-shelf landing input. */
export function fractionIn(track: Element, clientX: number): number {
  const r = track.getBoundingClientRect()
  return r.width === 0 ? 0 : (clientX - r.left) / r.width
}

/** canon `semanticLaneAt` (:3822). One vertical resolver for every board drag:
 *  the row under the pointer, within the same group. Canon's own note — a guide
 *  rail belongs to the lane above it, and treating that strip as empty space
 *  turned a fifth of every staff row into a silent dead drop zone. */
export function laneKeyAtY(root: Element | null, group: string, clientY: number): string | null {
  if (!root) return null
  let found: string | null = null
  for (const lane of Array.from(root.querySelectorAll('.lane'))) {
    if ((lane as HTMLElement).dataset.group !== group) continue
    const r = lane.getBoundingClientRect()
    if (clientY >= r.top && clientY <= r.bottom) found = (lane as HTMLElement).dataset.lane ?? null
  }
  return found
}

/** canon `dragMove` (:4509) — the WHOLE shelf bar is the drop zone. */
export function isOverShelf(shelf: Element | null, clientY: number): boolean {
  if (!shelf) return false
  const r = shelf.getBoundingClientRect()
  return clientY >= r.top && clientY <= r.bottom
}

/** canon's popover dismissal (:5772). A click inside the popover, or on the
 *  button that opened it, keeps it open; anything else closes it. */
export function clickClosesPopover(wrapper: Element | null, target: EventTarget | null): boolean {
  if (!wrapper) return true
  return !(target instanceof Node) || !wrapper.contains(target)
}

// ── the board's own state transitions ──────────────────────────────────────

/** The board as it currently stands: the server's lanes, plus staged moves,
 *  minus what is parked, plus what the create dialog added. Everything the sell
 *  layer and the guard checks read goes through here, so a card cannot be in one
 *  place for the drag and another for the checks. */
export function applyMoves(
  lanes: BoardLane[],
  moves: Moves,
  parked: string[],
  added: Array<{ laneKey: string; item: BoardItem }>,
  hours: Hours,
): BoardLane[] {
  const homeStaffItem = new Map<string, BoardItem>()
  for (const lane of lanes) {
    if (lane.group !== 'staff') continue
    for (const item of lane.items) {
      if (item.kind === 'booking' && item.caseId) homeStaffItem.set(item.caseId, item)
    }
  }

  const moved = (item: BoardItem): BoardItem => {
    const m = item.caseId ? moves[item.caseId] : undefined
    if (!m) return item
    return {
      ...item,
      x: m.x,
      w: m.w,
      startMin: minuteOf(m.x, hours),
      endMin: minuteOf(m.x + m.w, hours),
      time: `${clock(minuteOf(m.x, hours))}〜${clock(minuteOf(m.x + m.w, hours))}`,
    }
  }

  return lanes.map((lane) => {
    const extra = added.filter((a) => a.laneKey === lane.key).map((a) => a.item)
    if (lane.group !== 'staff') {
      return { ...lane, items: [...lane.items.filter((i) => !isParked(i, parked)).map(moved), ...extra].sort(byX) }
    }
    const kept = lane.items.filter((item) => {
      if (isParked(item, parked)) return false
      const m = item.caseId ? moves[item.caseId] : undefined
      return !m || m.laneKey === lane.key
    })
    const arrivals: BoardItem[] = []
    for (const [id, m] of Object.entries(moves)) {
      if (m.laneKey !== lane.key || parked.includes(id)) continue
      const home = homeStaffItem.get(id)
      if (!home || lane.items.some((i) => i.caseId === id)) continue
      arrivals.push(home)
    }
    return { ...lane, items: [...kept, ...arrivals].map(moved).concat(extra).sort(byX) }
  })
}

const byX = (a: BoardItem, b: BoardItem) => a.x - b.x
const isParked = (item: BoardItem, parked: string[]) => item.caseId != null && parked.includes(item.caseId)
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** The chrome a NON-BOOKING item wears on the board. Canon builds 勤務不可 and
 *  the 勤務前/終業 shift hatches out of ONE grammar — `.event.absence`, the red
 *  hatch (fable-store-today.html renderShiftEndBounds: "reuses the SAME hatch
 *  grammar .event.absence already uses for 勤務不可") — and binds every one of
 *  them to "this is shift-derived, you can't touch it on the board" (:4409).
 *  So the paint and the un-openability are ONE decision, not two: a wash states
 *  that there is no shop floor here, a 予定ブロック card opens ブロック情報. */
export function blockChrome(kind: BoardItem['kind']): { cls: 'cleanup' | 'absence' | 'block'; opens: boolean } {
  const cls = kind === 'cleanup' ? 'cleanup' : kind === 'absence' ? 'absence' : 'block'
  return { cls, opens: cls !== 'absence' }
}

/** Everything standing on a lane, as minute spans — the sell layer's occupancy
 *  and the guard checks' conflict pool are the SAME reading of the board. */
export function laneSpans(lane: BoardLane): Array<{ start: number; end: number }> {
  return lane.items.map((i) => ({ start: i.startMin, end: i.endMin }))
}

/** The 販売可能枠 layer for the board as it currently stands. Derived here, in
 *  the browser, so a drag in progress moves the windows with it. */
export function sellLayerFor(
  lanes: BoardLane[],
  hours: Hours,
  opts: { gridMin: number; nowMinute: number | null; locked: string[]; showPrice: boolean; hi: number; hqMin: number; depth: number },
): SellLayer {
  const staffLanes: SellStaffLane[] = lanes
    .filter((l) => l.group === 'staff' && l.window != null && l.listPrice > 0)
    .map((l) => ({
      key: l.key,
      name: l.label,
      from: l.window!.from,
      until: l.window!.until,
      locked: opts.locked.includes(l.key),
      occupied: laneSpans(l),
      listPrice: l.listPrice,
      stores: l.stores,
    }))
  const resourceLanes: SellResourceLane[] = lanes
    .filter((l) => l.group === 'beds')
    .map((l) => ({ key: l.key, name: l.label, occupied: laneSpans(l), storeId: l.stores?.[0] ?? '' }))
  const cells = deriveSellableCells({
    staffLanes,
    resourceLanes,
    open: hours.open,
    close: hours.close,
    gridMin: opts.gridMin,
    now: opts.nowMinute,
    priceFor: (lane, hour) => priceAt(lane.listPrice, hour, opts.hi, opts.hqMin, opts.depth),
  })
  return buildSellLayer(cells, opts.showPrice)
}

/** One drag step: origin + pointer travel → the card's new span, on canon's
 *  dual lattice. Separated from the event so the test can drive it directly. */
export function nextSpan(origin: DragOrigin, track: Element, dx: number, step: number): { x: number; w: number } {
  return dragGeometry(origin, deltaPctIn(track, dx), step)
}

/** canon `parkBooking` (:5556). What the shelf chip says about a parked card:
 *  its length, its ticket line, and where it came from — because the chip is
 *  the only remaining record of a card that is no longer on the board. */
export function parkChipText(item: BoardItem, hours: Hours, dayLabel: string): { title: string; line1: string; line2: string } {
  const durMin = item.endMin - item.startMin
  const tkt = [item.ticketCat, item.ticketCore].filter(Boolean).join(' ')
  return {
    title: `${item.title}様（仮押さえ・未配置）`,
    line1: `${durMin}分${tkt ? `・${tkt}` : ''}`,
    line2: `元: ${dayLabel} ${clock(item.startMin)}〜${clock(item.endMin)} — 置きたい日の枠へドラッグ`,
  }
}

/** canon `createAtCell` (:6005) via the F25 empty-slot click: the half hour the
 *  pointer landed on, clamped so a created booking cannot start after closing. */
export function slotStartAt(track: Element, clientX: number, hours: Hours, stepMin = 30): number {
  const minute = hours.open + fractionIn(track, clientX) * (hours.close - hours.open)
  return Math.max(hours.open, Math.min(hours.close - stepMin, Math.round(minute / stepMin) * stepMin))
}

/** A created card's span, so the create dialog and the board agree. */
export function spanFor(start: number, end: number, hours: Hours) {
  return place(start, end, hours)
}
