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
  deriveGapPackingCells,
  deriveSellableCells,
  freePockets,
  type GapCell,
  type SellLayer,
  type SellResourceLane,
  type SellStaffLane,
} from '@/business/lib/canon-logic/availability'
import { createGapGuard, type GuardConfig, type GuardReason } from '@/business/lib/canon-logic/gap-guard'
import { gapFillPrice, packedPrice, priceAt, type PriceFrame } from '@/business/lib/canon-logic/pricing'
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
 *  that there is no shop floor here, a 予定ブロック card opens ブロック情報.
 *
 *  `locked` is the third face of that same decision: canon does not just refuse
 *  the press, it ANSWERS it — a pointerdown on any hatch says where the change
 *  actually belongs, so a staff member who tries to drag a 終業 hatch learns
 *  シフト管理 instead of watching nothing happen. The sentence rides with the
 *  decision rather than sitting in the JSX so it is provable without a
 *  renderer: null here and the board goes silent again. */
export function blockChrome(kind: BoardItem['kind']): { cls: 'cleanup' | 'absence' | 'block'; opens: boolean; locked: string | null } {
  const cls = kind === 'cleanup' ? 'cleanup' : kind === 'absence' ? 'absence' : 'block'
  const opens = cls !== 'absence'
  return { cls, opens, locked: opens ? null : '勤務不可はシフト管理で変更します — ボード上では動かせません' }
}

/** Everything standing on a lane, as minute spans — the sell layer's occupancy
 *  and the guard checks' conflict pool are the SAME reading of the board.
 *  `isBreak` rides along because canon's guard walls a pocket on both sides of
 *  a 休憩 and on no other kind of card (guardPocketsForLane :7207). */
export function laneSpans(lane: BoardLane, exclude?: string | null): Array<{ start: number; end: number; isBreak: boolean }> {
  return lane.items
    .filter((i) => !(exclude != null && i.caseId === exclude))
    .map((i) => ({ start: i.startMin, end: i.endMin, isBreak: i.kind === 'break' }))
}

/** ONE reading of the board's lanes, shared by every window layer — the normal
 *  販売可能枠, the スキマ枠/詰め込み layers and the guard rail all price and
 *  refuse against the same occupancy, so they can never disagree. */
export function sellStaffLanes(lanes: BoardLane[], locked: string[]): SellStaffLane[] {
  return lanes
    .filter((l) => l.group === 'staff' && l.window != null && l.listPrice > 0)
    .map((l) => ({
      key: l.key,
      name: l.label,
      from: l.window!.from,
      until: l.window!.until,
      locked: locked.includes(l.key),
      occupied: laneSpans(l),
      listPrice: l.listPrice,
      stores: l.stores,
    }))
}

export function sellResourceLanes(lanes: BoardLane[]): SellResourceLane[] {
  return lanes
    .filter((l) => l.group === 'beds')
    .map((l) => ({ key: l.key, name: l.label, occupied: laneSpans(l), storeId: l.stores?.[0] ?? '' }))
}

/** The 販売可能枠 layer for the board as it currently stands. Derived here, in
 *  the browser, so a drag in progress moves the windows with it. */
export function sellLayerFor(
  lanes: BoardLane[],
  hours: Hours,
  opts: { gridMin: number; nowMinute: number | null; locked: string[]; showPrice: boolean; hi: number; hqMin: number; depth: number },
): SellLayer {
  const staffLanes = sellStaffLanes(lanes, opts.locked)
  const resourceLanes = sellResourceLanes(lanes)
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

/** The スキマ枠 (orange, discounted) and 詰め込みセッション (blue, full price)
 *  layers, derived from the same board reading as everything else. Canon's own
 *  label carries the LENGTH beside the price on a packed cell — ¥8,650（60分）
 *  — because a fixed-start session is not an hour of a merged band. */
export function gapLayerFor(
  lanes: BoardLane[],
  opts: {
    gridMin: number
    sessionMin: number
    gapFillMin: number
    gapFillDiscountPct: number
    nowMinute: number | null
    locked: string[]
    frame: PriceFrame
    depth: number
    guard: GuardConfig
  },
): { packed: GapCell[]; scraps: GapCell[] } {
  const engine = createGapGuard(opts.guard)
  const byKey = new Map(lanes.map((l) => [l.key, l]))
  const listOf = (lane: SellStaffLane) => byKey.get(lane.key)?.listPrice ?? 0
  return deriveGapPackingCells({
    staffLanes: sellStaffLanes(lanes, opts.locked),
    resourceLanes: sellResourceLanes(lanes),
    gridMin: opts.gridMin,
    sessionMin: opts.sessionMin,
    gapFillMin: opts.gapFillMin,
    now: opts.nowMinute,
    fillableExactly: engine.fillableExactly,
    fillDecomposition: engine.fillDecomposition,
    packedPrice: (lane, s, e) => packedPrice(listOf(lane), s, e, opts.frame, opts.depth),
    gapFillPrice: (lane, s, e) => gapFillPrice(listOf(lane), s, e, opts.frame, opts.depth, opts.gapFillDiscountPct),
  })
}

// ── スキマガードの配置ガイド ────────────────────────────────────────────────

export type RailState = 'safe' | 'degraded' | 'blocked'

export interface RailCell {
  start: number
  state: RailState
  /** canon `paintRailCell` (:7500): ✓HH:MM / △HH:MM / —. */
  label: string
  /** What this start actually does to the protected window, in canon's words. */
  sentence: string
  /** The engine's feasible alternatives, when it refused this start. */
  alternatives: number[]
  alternativeKind: 'safe' | 'least-loss' | null
  /** canon's `ackAllowed`: standard mode lets the 操作者 place anyway. */
  ackAllowed: boolean
}

export interface GuardRail {
  laneKey: string
  laneLabel: string
  cells: RailCell[]
}

const clockOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** canon `reasonLine` (:7092). The engine's refusal, said out loud. */
export function reasonLine(reason: GuardReason | undefined, protectedDur: number): string {
  if (!reason) return '配置できません'
  const p = reason.params as Record<string, number | string>
  switch (reason.code) {
    case 'R-REP': return `ここに置くと${p.label}が入らなくなります`
    case 'R-DEAD': return `ここに置くと${p.n}分の売れない空きが残ります`
    case 'R-SALV': return `ここに置くと${p.n}分の割引でしか売れない空きが残ります`
    case 'R-UNAVAILABLE': return `この開始には既存${p.dur}分を配置できません`
    case 'EXEMPT': return `端は${wallJa(String(p.wallType ?? ''), p.trigger === 'wall')}に接するため空きになりません`
    case 'DEGRADED': {
      const before = Number(p.capacityBefore)
      const after = Number(p.capacityAfter)
      if (!Number.isFinite(before) || !Number.isFinite(after)) {
        return '配置できますが、売れる空きを完全には守れません。この区間では損が最少の開始です'
      }
      return `新規${protectedDur}分の空きが${before}→${after}に減ります（${Math.max(0, before - after)}枠減）。${clockOf(Number(p.t))}はこの区間で損が最少の開始です`
    }
    default: return '配置できません'
  }
}

/** canon `wallJa` (:7091). */
function wallJa(wallType: string, isWall: boolean): string {
  if (!isWall) return 'リードタイム'
  return wallType === 'closing' ? '閉店' : wallType === 'shiftEnd' ? 'シフト終了' : wallType === 'break' ? '休憩' : 'リードタイム'
}

export interface RailInput {
  open: number
  close: number
  /** The rail's own grid — canon paints every exact 30-minute start. */
  stepMin: number
  /** The session the rail is asking about placing (canon's 60分配置). */
  dur: number
  /** The window the guard is PROTECTING, for the sentences. */
  protectedDur: number
  nowMinute: number | null
  locked: string[]
  guard: GuardConfig
  /** A card currently in hand: it is what is being placed, so it must not also
   *  count as an obstacle to itself (canon guardPocketsForLane :7196). */
  excludeId?: string | null
}

/** The 60分配置 rail for every staff lane — canon `renderSlotBoxes` (:7543),
 *  minus the DOM. Every exact 30-minute start on the board, judged by the
 *  guard engine against the pocket it would land in. */
export function guardRailsFor(lanes: BoardLane[], input: RailInput): GuardRail[] {
  const engine = createGapGuard(input.guard)
  const rails: GuardRail[] = []
  for (const lane of lanes) {
    if (lane.group !== 'staff' || lane.window == null || input.locked.includes(lane.key)) continue
    const pockets = freePockets({
      from: lane.window.from,
      until: lane.window.until,
      close: input.close,
      now: input.nowMinute,
      occupied: laneSpans(lane, input.excludeId),
    })
    const cells: RailCell[] = []
    for (let start = input.open; start < input.close; start += input.stepMin) {
      cells.push(railCell(engine, pockets, start, input))
    }
    rails.push({ laneKey: lane.key, laneLabel: lane.label, cells })
  }
  return rails
}

/** The same verdict for ONE placement — the card actually in hand, at its own
 *  length, which is the question a drop asks and the 60-minute rail does not. */
export function guardVerdictAt(lanes: BoardLane[], laneKey: string, start: number, input: RailInput): RailCell | null {
  const lane = lanes.find((l) => l.key === laneKey && l.group === 'staff')
  if (!lane || lane.window == null || input.locked.includes(lane.key)) return null
  const pockets = freePockets({
    from: lane.window.from,
    until: lane.window.until,
    close: input.close,
    now: input.nowMinute,
    occupied: laneSpans(lane, input.excludeId),
  })
  return railCell(createGapGuard(input.guard), pockets, start, input)
}

function railCell(
  engine: ReturnType<typeof createGapGuard>,
  pockets: ReturnType<typeof freePockets>,
  start: number,
  input: RailInput,
): RailCell {
  const blocked = (sentence: string): RailCell => ({
    start, state: 'blocked', label: '—', sentence, alternatives: [], alternativeKind: null, ackAllowed: false,
  })
  const pocket = pockets.find((p) => start >= p.s && start + input.dur <= p.e)
  if (!pocket) return blocked(`この開始には${input.dur}分の連続した空きがありません`)
  const v = engine.evaluate(pocket, { start, dur: input.dur }, { now: input.nowMinute ?? undefined })
  if (v.verdict === 'ok' || v.verdict === 'exempt') {
    // canon `exactAimConsequence` (:7570): a pocket that never held a protected
    // window cannot claim to be protecting one.
    const sentence = v.protectedCapacityBefore === 0
      ? `配置できます。この区間には現在、守れる新規${input.protectedDur}分の空きはありません`
      : `新規${input.protectedDur}分の空きを守れます`
    return { start, state: 'safe', label: `✓${clockOf(start)}`, sentence, alternatives: [], alternativeKind: null, ackAllowed: true }
  }
  if (v.verdict === 'degraded') {
    const loss = Math.max(0, v.protectedCapacityBefore - v.protectedCapacityAfter)
    return {
      start,
      state: 'degraded',
      label: `△${clockOf(start)}`,
      sentence: `新規${input.protectedDur}分の空き${v.protectedCapacityBefore}→${v.protectedCapacityAfter}（${loss}枠減・損を減らす）。${clockOf(v.leastLossStart ?? start)}はこの区間で損が最少の開始です`,
      alternatives: v.alternatives,
      alternativeKind: v.alternativeKind,
      ackAllowed: true,
    }
  }
  return {
    ...blocked(reasonLine(v.reason, input.protectedDur)),
    alternatives: v.alternatives,
    alternativeKind: v.alternativeKind,
    ackAllowed: v.reason?.ackAllowed === true,
  }
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
