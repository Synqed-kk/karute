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
import { dragGeometry, dragModeFor, spansOverlap, stepPct, type DragMode, type DragOrigin } from '@/business/lib/canon-logic/drag-rules'
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
 *  turned a fifth of every staff row into a silent dead drop zone.
 *
 *  `group` of `null` means ANY lane, which is the block drag's rule and only
 *  the block drag's: canon lets 休憩/清掃 cross between people and rooms
 *  ("清掃を人へも動かせる — スタッフが清掃を担うのは実運用", bindBlockDrag :4114)
 *  and says the same-group leash was the bug that made blocks refuse to travel
 *  vertically at all. A booking still passes its own group and is still leashed:
 *  a person's booking has a bed partner, and moving it to a bed lane is not a
 *  move, it is a category error. */
export function laneKeyAtY(root: Element | null, group: string | null, clientY: number): string | null {
  if (!root) return null
  let found: string | null = null
  for (const lane of Array.from(root.querySelectorAll('.lane'))) {
    if (group !== null && (lane as HTMLElement).dataset.group !== group) continue
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

export interface AnchorRect {
  top: number
  bottom: number
  left: number
  right: number
}

export interface FieldsPopAnchor {
  top: number
  left: number
  /** The height the popover is allowed to take. Equal to its content height
   *  whenever the viewport can hold it — which is the whole point. */
  height: number
}

/** canon `positionFieldsPop` (:5782), verbatim math.
 *
 *  表示設定 is the one popover on this board whose content is taller than the
 *  room under its button, so canon does NOT hang it off the button's parent —
 *  it pins it to the VIEWPORT and slides it up until the whole panel is on
 *  screen (canon's own comment at :1553: 「ボタン親の座標ではなく可視領域へ固定
 *  して全体を見せる。高さが足りない場合だけ内部スクロールへ戻す。」). Internal
 *  scrolling is the fallback for a viewport too short to hold it, never the
 *  normal state.
 *
 *  The transplant took the `.fields-pop` family base (absolute, under the
 *  button, `max-height: min(620px, 100dvh - 240px)`) and dropped this override,
 *  which is why the built board scrolled inside the panel at every size. */
export function fieldsPopAnchor(
  button: AnchorRect,
  popWidth: number,
  popScrollHeight: number,
  viewport: { width: number; height: number },
): FieldsPopAnchor {
  const margin = 12
  const gap = 8
  const height = Math.min(popScrollHeight + 2, viewport.height - margin * 2)
  const top = Math.max(margin, Math.min(button.bottom + 6, viewport.height - height - margin))
  // Opens to the LEFT of the button, because the button sits at the right end
  // of the board tools and a right-anchored panel this tall reads as a wall.
  let left = button.left - popWidth - gap
  if (left < margin) left = button.right + gap
  left = Math.max(margin, Math.min(left, viewport.width - popWidth - margin))
  return { top, left, height }
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

  const moved = (item: BoardItem): BoardItem => atSpan(item, item.caseId ? moves[item.caseId] : undefined, hours)

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

/** An item redrawn at a staged span — the percent pair AND the minutes and the
 *  clock line that every other layer reads, so a moved card cannot be at one
 *  time on the board and another in a check. Shared by the booking pass and the
 *  block pass; `undefined` means "not moved" and returns the item untouched. */
function atSpan(item: BoardItem, m: Move | undefined, hours: Hours): BoardItem {
  if (!m) return item
  const startMin = minuteOf(m.x, hours)
  const endMin = minuteOf(m.x + m.w, hours)
  return { ...item, x: m.x, w: m.w, startMin, endMin, time: `${clock(startMin)}〜${clock(endMin)}` }
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

/** ⚖ Liam 2026-08-20 (flags 19/20) — where the drag proxy hangs. The card keeps
 *  the grip it was picked up by: subtracting the grab offset means the point
 *  under the cursor is the same point that was under it at pointerdown, which is
 *  the difference between a card that feels attached and one that trails.
 *  Rounded to whole pixels — a fractional transform makes text shimmer. */
export function proxyTransform(clientX: number, clientY: number, grab: { dx: number; dy: number }): string {
  return `translate3d(${Math.round(clientX - grab.dx)}px, ${Math.round(clientY - grab.dy)}px, 0)`
}

/** ⚖ Liam flag 28 (2026-08-21) — THE CHIP IN HAND IS A BOARD CARD. A shelf chip
 *  is as wide as its longest sentence; the booking it holds is 30 or 60 or 90
 *  minutes long. Carrying the chip's own box meant the operator aimed an
 *  elongated orange slab at a slot it had nothing to do with — Liam: 「1時間の
 *  施術なら1時間の長さであるべき」. So the proxy is sized from the BOOKING: its
 *  minutes against the board's own span, times the track the card will land on.
 *
 *  DELIBERATE DEVIATION FROM CANON. Canon clones the whole chip (`bindChipDrag`
 *  :5599–5651) precisely so the in-hand thing and the shelf thing can never
 *  disagree; Liam's ruling overrides that — the in-hand thing must agree with
 *  the LANDING, not with the shelf. `lenMin` comes off the parked record (the
 *  same figure `parkChipText` prints), never off the chip's rendered text.
 *
 *  Height is the card's, derived rather than guessed: `.event` is pinned
 *  `top: 2px; bottom: 2px` inside `.track`, so a board card is exactly the
 *  track minus those four pixels at whatever density the board is drawn at.
 *  `null` when the board has no measurable track (jsdom, a collapsed group) —
 *  the caller then keeps the chip's own box, which is the old behaviour. */
const CARD_INSET = 4

export function chipProxySize(board: Element | null, hours: Hours, lenMin: number): { w: number; h: number } | null {
  const track = board?.querySelector('.track')
  if (!track) return null
  const r = track.getBoundingClientRect()
  const span = hours.close - hours.open
  if (r.width === 0 || span <= 0) return null
  return { w: (lenMin / span) * r.width, h: Math.max(0, r.height - CARD_INSET) }
}

/** canon `createAtCell`'s partner search (:6021–6027): a booking is a person AND
 *  a room, so a card placed on a staff lane must find a free lane in the other
 *  group or the placement is refused outright. First free one wins, exactly as
 *  canon takes the first `laneFreeAt` — the board is not choosing a best bed,
 *  it is proving one exists. `null` = nothing free, which is canon's refusal. */
export function freePartnerLane(lanes: BoardLane[], group: 'staff' | 'beds', start: number, end: number): BoardLane | null {
  const other = group === 'staff' ? 'beds' : 'staff'
  return lanes.find((l) => l.group === other && l.items.every((i) => i.endMin <= start || i.startMin >= end)) ?? null
}

/** ⚖ Liam 2026-08-20 — LENGTH-MATCHED DRAG EMPHASIS, and the one place the rule
 *  lives. Canon deepens EVERY derived window while a card is in flight (CSS
 *  reveal, :594–598). Liam's board answers a sharper question — "where does THIS
 *  card fit at full value" — so the drag reveals the whole layer and only the
 *  windows advertising the dragged booking's own length take the emphasis.
 *
 *  A plain 販売可能 wash advertises one standard session, always (canon's
 *  `SELL_SLOT_MIN`, :4867); a 詰め込み box advertises the span it draws, which is
 *  the （60分）/（30分） on its own label. `null` means nothing is in flight, and
 *  then nothing is emphasised — the board at rest is untouched.
 *
 *  PAINT ONLY. This compares a length already on screen against a length the
 *  drag already carries; no layer is re-derived (WO-2d's `committedLanes` still
 *  owns that), so the emphasis cannot move a box or change a price. */
export function fitsDrag(advertisedMin: number, dragLenMin: number | null): boolean {
  return dragLenMin !== null && advertisedMin === dragLenMin
}

// ── ⚖ Liam flag 24 — the resizable staff-name column ───────────────────────

/** canon's `#labelResize` handler (:5961–5986). The divider at the name
 *  column's right edge drags `--label` between 90 and 240px, and the column is
 *  a plain CSS grid track, so nothing re-renders and nothing is stored: wide
 *  shows 整体・小顔 / 11:00–20:00 whole, slim lets the same `text-overflow:
 *  ellipsis` that is already on the label truncate it to 整体・…. One clamp,
 *  because the ends are what the operator can actually get wrong — 0 collapses
 *  the roster and 600 eats the day. */
export const LABEL_MIN = 90
export const LABEL_MAX = 240

export function clampLabelWidth(startWidth: number, dx: number): number {
  return Math.max(LABEL_MIN, Math.min(LABEL_MAX, startWidth + dx))
}

/** The width the divider starts from. Canon reads the live computed `--label`
 *  and falls back to its own default when the property has not been written
 *  yet (a jsdom or pre-paint read returns ''), which is exactly the case that
 *  would otherwise snap the column to 0 on the first pixel of drag. */
export function labelWidthOf(root: Element | null, fallback: number): number {
  if (!root) return fallback
  const raw = parseFloat(getComputedStyle(root).getPropertyValue('--label'))
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

// ── ⚖ Liam flag 26 — block drag/resize on their own lattice ────────────────

/** canon `blockEdgeZones` (:4037). A block's grab zones SCALE with the box,
 *  where a booking card's are a flat 10px (`dragModeFor`, frozen in
 *  canon-logic): 準備/レジ締め micros are ~18px wide, and a flat 10px each side
 *  leaves a card with no move zone at all. `overhang` is how far outside the
 *  box the zone then reaches — canon's answer to Liam's 8/11 field report that
 *  narrow blocks could not be stretched — and it is 0 for anything ≥40px, so a
 *  休憩 keeps byte-identical behaviour to the old flat zones. */
export function blockEdgeZones(w: number): { inner: number; overhang: number } {
  const inner = Math.min(10, w / 4)
  return { inner, overhang: inner < 10 ? 12 - inner : 0 }
}

/** Which part of a BLOCK the pointer grabbed (canon :4060–4064). Separate from
 *  `dragModeAt` on purpose: canon keeps bindDrag and bindBlockDrag as two
 *  pipelines and never lets one's granularity leak into the other. */
export function blockDragModeAt(el: Element, clientX: number): DragMode {
  const r = el.getBoundingClientRect()
  const { inner, overhang } = blockEdgeZones(r.width)
  const dRight = r.right - clientX
  const dLeft = clientX - r.left
  if (dRight <= inner && dRight >= -overhang) return 'resize'
  if (dLeft <= inner && dLeft >= -overhang) return 'resizeL'
  return 'move'
}

/** canon's block landing check (`blockDrop` :4145–4157). "軽ゲート" — a block is
 *  a placeholder, not a booking, so it never goes through the 仮押さえ gate;
 *  but it still may not be laid over anything real. Canon skips the element
 *  itself and its parked/public siblings and refuses on any other overlap.
 *  Derived inventory (販売可能枠, スキマ枠) never enters `lane.items`, so it is
 *  out of the pool here for the same reason canon's `.public` cells are. */
export function blockClash(lane: BoardLane | undefined, movingKey: string, span: { x: number; w: number }): boolean {
  if (!lane) return false
  return lane.items.some((i) => i.key !== movingKey && spansOverlap(span.x, span.w, i.x, i.w))
}

/** The span a block move/resize lands on, on the BLOCK lattice. Same geometry
 *  as a booking's — canon's own note is "形はSTEP_PCT版と同一、定数だけ差し替え"
 *  (:3702) — with `blockStepMin` in place of the booking step. */
export const BLOCK_STEP_MIN_DEFAULT = 5

export function blockStepPct(boardHours: number, blockStepMin: number | undefined): number {
  return stepPct(boardHours, blockStepMin ?? BLOCK_STEP_MIN_DEFAULT)
}

/** ⚖ Liam flag 26 — blocks are moved by their own key, because they have no
 *  `caseId`: a 休憩 or a 清掃 is not a booking and never enters the moves map
 *  that the 仮押さえ gate, the shelf and the guard all read. Applied as its own
 *  pass so the booking rules above stay untouched — and because the LANE rule
 *  differs: a booking is mirrored on a staff lane AND a bed lane, so it may not
 *  be evicted from its partner; a block lives on exactly one lane, so the plain
 *  "drop from every lane but the target" rule is the correct one. */
export function applyBlockMoves(lanes: BoardLane[], blockMoves: Moves, hours: Hours): BoardLane[] {
  if (Object.keys(blockMoves).length === 0) return lanes
  const home = new Map<string, BoardItem>()
  for (const lane of lanes) for (const i of lane.items) if (blockMoves[i.key]) home.set(i.key, i)
  return lanes.map((lane) => {
    const kept = lane.items.filter((i) => !blockMoves[i.key] || blockMoves[i.key].laneKey === lane.key)
    const arrivals = Object.entries(blockMoves)
      .filter(([key, m]) => m.laneKey === lane.key && !lane.items.some((i) => i.key === key))
      .map(([key]) => home.get(key))
      .filter((i): i is BoardItem => i != null)
    return { ...lane, items: [...kept, ...arrivals].map((i) => atSpan(i, blockMoves[i.key], hours)).sort(byX) }
  })
}

// ── ⚖ Liam flag 25 — the guided tour's positioning rules ───────────────────

export interface SpotRect { left: number; top: number; width: number; height: number }

/** canon `spotRender`'s card placement (:3357–3380). The card goes on the
 *  spotlight's WIDEST free side and never covers the region it is explaining —
 *  below if there is room, above if there is not, and beside it only when it
 *  had to be squeezed level with the target. */
export function spotCardAt(
  target: SpotRect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const bottom = target.top + target.height
  const right = target.left + target.width
  const below = viewport.height - bottom
  const above = target.top
  let top: number
  if (below >= card.height + 18) top = bottom + 12
  else if (above >= card.height + 18) top = target.top - card.height - 12
  else top = Math.max(10, Math.min(viewport.height - card.height - 10, target.top))
  const clear = top >= bottom + 12 || top + card.height <= target.top - 2
  const left = clear
    ? Math.max(10, Math.min(target.left, viewport.width - card.width - 10))
    : viewport.width - right - 18 >= card.width
      ? right + 12
      : Math.max(10, target.left - card.width - 12)
  return { top, left }
}

/** canon `spotHitIndex` (:3406–3416) — click-any-region-to-jump. Registered
 *  regions nest (the board contains its group headings), so the SMALLEST region
 *  under the pointer wins and a big section can never swallow its own children.
 *  `-1` = the click was on nothing registered, which closes the tour. */
export function spotHitIndex(x: number, y: number, rects: SpotRect[]): number {
  let best = -1
  let bestArea = Infinity
  rects.forEach((r, i) => {
    if (x < r.left || x > r.left + r.width || y < r.top || y > r.top + r.height) return
    const area = r.width * r.height
    if (area < bestArea) { bestArea = area; best = i }
  })
  return best
}

/** canon `spotTargets` (:3343). THE REGISTRY, and the whole adaptive property
 *  Liam built in: a section joins the tour by DECLARING itself with `data-guide`
 *  — there is no steps table to keep in sync, so a section that renders is a
 *  section that is explained, and one that is hidden (a popover, a strip behind
 *  a permission, the 自分の1日 header on a manager's board) silently drops out
 *  of the count. DOM order is visual order, so the walk needs no sort.
 *
 *  ⚖ LANE RULE (Liam, flag 25): every new section added to this board in any
 *  future round registers a `data-guide` + `data-guide-title` pair. */
/** canon `spotGo` (:3380): the walk is a RING — 次へ on the last step returns to
 *  the first, which is why its label reads 最初へ there. `-1` for an empty
 *  registry, because a board with nothing declared has no tour to be on. */
export function wrapStep(i: number, total: number): number {
  return total === 0 ? -1 : ((i % total) + total) % total
}

export function spotTargets(root: Document | Element | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('[data-guide]')).filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0
  })
}
