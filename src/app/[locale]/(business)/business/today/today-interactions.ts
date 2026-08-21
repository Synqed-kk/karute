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

/** A card that has been moved from where the server placed it: the lane it now
 *  sits on, and the span it now covers.
 *
 *  ⚖ BATCH-6 flag 45 (2026-08-21) — `laneKey` IS THE LANE OF ITS OWN SIDE, and
 *  that sentence used to read "the STAFF lane". A booking has TWO lane
 *  memberships — a person and a room — and collapsing them into one key meant a
 *  card grabbed by its BED drawing wrote a bed key where every staff-side reader
 *  expected a staff key: `applyMoves` evicted the booking from every staff lane
 *  and could never re-admit it, the revert wrote the same bed key back, and the
 *  confirm surface lost its 担当. Canon keeps the memberships apart — its
 *  `stageChange` (:4665) re-parents ONLY the element under the pointer and
 *  re-spans BOTH (:4668) — so the staff side lives in `moves` and the bed side
 *  in `bedMoves`, keyed the same way, sharing one span. */
export interface Move {
  laneKey: string
  x: number
  w: number
}

export type Moves = Record<string, Move>

/** ⚖ BATCH-6 flag 45 — BOTH LANE MEMBERSHIPS OF ONE BOOKING, as Moves. canon's
 *  revert snapshot is PER ELEMENT (`stageChange` :4652-4661 maps over `pairOf`),
 *  which is exactly why neither half of a pair can be lost there: the snapshot
 *  knows where BOTH drawings stood. Ours is this. `null` on a side means the
 *  booking has no drawing in that group on the board being read. */
export interface PairLanes {
  staff: Move | null
  bed: Move | null
}

/** Where each half of one booking stands on the board as it currently is, at the
 *  span given. The same lookup `holdSummary` does for its 担当/ベッド sentence,
 *  so the surface and the staging can never disagree about which lanes a card is
 *  on. */
export function pairLanesOf(lanes: BoardLane[], id: string, span: { x: number; w: number }): PairLanes {
  const laneOf = (group: 'staff' | 'beds') =>
    lanes.find((l) => l.group === group && l.items.some((i) => i.caseId === id))?.key ?? null
  const staff = laneOf('staff')
  const bed = laneOf('beds')
  return {
    staff: staff === null ? null : { laneKey: staff, ...span },
    bed: bed === null ? null : { laneKey: bed, ...span },
  }
}

/** ⚖ BATCH-6 flag 45 — CANON'S RULE, IN ONE LINE: the side the operator has hold
 *  of RETARGETS, the other side only RE-TIMES. `stageChange` (:4648-4674) moves
 *  exactly one element between tracks (`if (laneChanged) ctx.targetTrack
 *  .appendChild(ctx.el)`) and writes the new span onto every element of the pair
 *  — so a bed-row drag says WHICH ROOM and leaves the person alone, and a staff
 *  row drag says WHO and leaves the room alone. Both then agree on the time.
 *
 *  `now` is where the pair stands before this landing; `group` is the grabbed
 *  lane's own group, which is the only thing that decides which side moves. */
export function sidesAt(
  now: PairLanes,
  group: string,
  target: string,
): { staffLane: string | null; bedLane: string | null } {
  const grabbedBed = group === 'beds'
  return {
    staffLane: grabbedBed ? (now.staff?.laneKey ?? null) : target,
    bedLane: grabbedBed ? target : (now.bed?.laneKey ?? null),
  }
}

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

/** ⚖ Liam flag 35 — THE ONE CLAMP. canon `placePopNear` (:7075-7081): a
 *  fixed-layer surface is pinned inside the viewport on ALL FOUR edges before it
 *  paints, so a booking in the last column or the bottom lane never opens a
 *  popup that is half off screen. The transplant carried canon's popup but not
 *  its pinning (the 配置の相談 hung off a hard-coded `Math.min(x, 1600)`), which
 *  is the same defect class 表示設定 had before `fieldsPopAnchor` restored it.
 *
 *  Every fixed surface on this board goes through here — the consult popup and
 *  the 仮押さえ popover both — so there is exactly one place the rule lives.
 *  A surface WIDER than the viewport still gets its top-left corner on screen,
 *  which is canon's own choice of which edge to sacrifice. */
export function pinInViewport(
  want: { left: number; top: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  // FLOOR, where canon rounds: a surface 297.33px wide pinned to the right edge
  // rounds its left UP and ends a third of a pixel past the margin. Flooring can
  // only ever move it further inside, which is the whole point of the clamp.
  return {
    left: Math.floor(Math.max(margin, Math.min(want.left, viewport.width - size.width - margin))),
    top: Math.floor(Math.max(margin, Math.min(want.top, viewport.height - size.height - margin))),
  }
}

/** ⚖ Liam flag 34 — is the card the 仮押さえ answers for still in front of the
 *  operator? The board scrolls, the day flips and the store switches; when the
 *  anchor is not on screen the confirm surface stops chasing it and becomes the
 *  fixed pill instead. Intersection, not containment: a card half in view is
 *  still a card the operator can see the popover point at. */
export function anchorOnScreen(rect: AnchorRect, viewport: { width: number; height: number }): boolean {
  return rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width
}

/** ⚖ Liam flag 34 — the confirm popover's own position: UNDER the moved card,
 *  centred on it, flipped ABOVE when the room below cannot hold it whole.
 *
 *  IT NEVER COVERS THE CARD (⚖ Liam's 8/21 sharpening: "the operator must be
 *  able to SEE what they moved while confirming it"). That is why this returns
 *  `null` rather than a clamped position when neither side can hold the whole
 *  surface: a vertical clamp would slide the popover back over its own anchor,
 *  which is the one thing it must not do. `null` is the caller's signal to use
 *  the fixed pill, which is always visible and covers nothing on the board.
 *  Horizontally it is centred on the card and clamped by `pinInViewport` (⚖ 35)
 *  — that axis cannot hide the card, it only slides along it.
 *
 *  ⚖ Liam flag 48 (2026-08-21) — AND A PREFERENCE ON TOP, never a law. Under
 *  the card is the ruled home, but under the card is also where that lane's
 *  60分配置 strip lives, so the confirm sat on the purple ✓ chip for the very
 *  slot it was confirming ("you can slightly see it pointing out above the
 *  box"). `avoid` is that one chip's box: among the tops the LAWS already allow
 *  — fits whole, never over the anchor, viewport-clamped — the first that also
 *  clears it wins. When no allowed side clears it the law's own answer stands
 *  unchanged, which is what keeps this a preference. */
export function holdPopAnchor(
  rect: AnchorRect,
  popWidth: number,
  popHeight: number,
  viewport: { width: number; height: number },
  gap = 8,
  margin = 8,
  avoid: AnchorRect | null = null,
): { left: number; top: number } | null {
  const below = rect.bottom + gap
  const above = rect.top - popHeight - gap
  // Law order first: below is the ruled home, above is the ruled flip.
  const tops = [
    below + popHeight <= viewport.height - margin ? below : null,
    above >= margin ? above : null,
  ].filter((t): t is number => t !== null)
  if (tops.length === 0) return null
  const at = (top: number) => ({
    left: pinInViewport({ left: (rect.left + rect.right) / 2 - popWidth / 2, top }, { width: popWidth, height: popHeight }, viewport, margin).left,
    top: Math.floor(top),
  })
  const spots = tops.map(at)
  const clears = (p: { left: number; top: number }) =>
    avoid == null ||
    p.left + popWidth <= avoid.left ||
    p.left >= avoid.right ||
    p.top + popHeight <= avoid.top ||
    p.top >= avoid.bottom
  return spots.find(clears) ?? spots[0]
}

/** ⚖ Liam flag 31b — the guard's verdict as ONE row for the confirm surface.
 *
 *  canon never showed the move-assessment anywhere: its 配置の相談 fires from an
 *  off-by-default teaching card, and its real drop path says nothing at all. The
 *  assessment is worth keeping, so it joins the checks the operator is already
 *  reading before 確定 — as INFORMATION, not as a gate: `computeChecks` still
 *  owns what can and cannot be confirmed (canon-logic, frozen), and a degraded
 *  landing stays confirmable exactly as canon's `ackAllowed` allows it.
 *
 *  The row is the verdict's own first sentence, minus the rail's `・損を減らす`
 *  aside — that clause is advice for CHOOSING a start, and this row is reporting
 *  the one already chosen. `null` for a safe landing: a check that always passes
 *  is noise.
 *
 *  ⚖ Liam flag 52 (2026-08-21) — AND IT IS ALWAYS △, NEVER ×. The mark is the
 *  row's SEVERITY, and severity on this board means one thing: × is a line that
 *  BLOCKS. Liam's screenshot has a red ×「ここに置くと新規(90分)が入らなくなり
 *  ます」 sitting above a live 確定 button — the mirror image of flag 7, where
 *  failed checks wore ✓. This row cannot block by construction (31b, above:
 *  `computeChecks` alone is the gate), so it cannot earn ×, whatever the engine
 *  thought of the start. The engine's own strength still reaches the operator —
 *  in the sentence, and on the 60分配置 rail, which is where ✓/△/— live. The
 *  return type says so, so a future caller cannot reintroduce the ×. */
export function guardCheckRow(cell: RailCell | null): { label: string; tone: 'warn' } | null {
  if (!cell || cell.state === 'safe') return null
  return { label: cell.sentence.split('。')[0].replace('・損を減らす', ''), tone: 'warn' }
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
  /** ⚖ BATCH-6 flag 45 — THE BED SIDE'S OWN MEMBERSHIP. Absent (the default) is
   *  the behaviour this file shipped with and still the right one for every
   *  booking nobody has grabbed by its bed row: the room keeps the lane the
   *  server drew it on and takes only the span. */
  bedMoves: Moves = {},
): BoardLane[] {
  // The row the SERVER drew, per group — what a lane re-admits when a booking
  // arrives on it. Keyed by group as well as id, because a booking arriving on a
  // bed lane must be re-admitted as its bed drawing (its own key, its own
  // 【担当】 tag), not as the staff card wearing a room's name.
  const home = new Map<string, BoardItem>()
  // …and each booking's own turnaround, by the booking it belongs to. Keyed
  // `${id}-cleanup` at derivation (today-board :508), which is the only link
  // back to its owner — the item itself carries no caseId.
  const cleanupOf = new Map<string, BoardItem>()
  for (const lane of lanes) {
    for (const item of lane.items) {
      if (item.kind === 'booking' && item.caseId) home.set(`${lane.group}|${item.caseId}`, item)
      if (item.kind === 'cleanup' && item.key.endsWith('-cleanup')) {
        cleanupOf.set(item.key.slice(0, -'-cleanup'.length), item)
      }
    }
  }

  // ONE SPAN FOR THE PAIR, and it lives in `moves`: every writer sets both
  // records from the same span, so a bed row and its staff twin can never show
  // different times — which is the whole reason canon calls `evSet` on `pairOf`.
  //
  // ⚖ Liam flag 51 — AND THE CARD SAYS WHICH HALF IT IS PAIRED WITH. Every card
  // wears its PARTNER's name (【ベッド2】 on a staff lane, 【見本 しろう】 on a
  // room lane, today-board :188), and that name comes off the row the SERVER
  // drew. Once a landing can retarget the room, a card left wearing 【ベッド3】
  // while its twin stands on ベッド2 is the impossible state ⚖ 8/9 forbids — the
  // same reason `placeFromShelf` rebuilds its own labels. The other side's
  // staged lane is the truth, so the tag is taken from there whenever one
  // exists. (This was already latent for a bed-row drag, which retargets the
  // room explicitly; it is fixed for both sides at once, in the one pass.)
  const laneLabel = new Map(lanes.map((l) => [l.key, l.label]))
  const moved = (item: BoardItem, group: string): BoardItem => {
    const at = atSpan(item, item.caseId ? moves[item.caseId] : undefined, hours)
    if (item.kind !== 'booking' || !item.caseId) return at
    const partner = group === 'staff' ? bedMoves[item.caseId] : moves[item.caseId]
    const label = partner ? laneLabel.get(partner.laneKey) : undefined
    return label != null && at.tag !== `【${label}】` ? { ...at, tag: `【${label}】` } : at
  }

  return lanes.map((lane) => {
    // ⚖ BATCH-6 flag 45 — ONE membership pass, and which record owns it is the
    // lane's own group. The two branches this replaces were the same code with
    // the bed half hard-wired to "never moves", which is what made a bed-side
    // drag unrepresentable rather than merely unimplemented.
    const membership = lane.group === 'staff' ? moves : bedMoves
    const extra = added.filter((a) => a.laneKey === lane.key).map((a) => a.item)
    const kept = lane.items.filter((item) => {
      if (isParked(item, parked)) return false
      // ⚖ 51 second-order — A 清掃 IS NOT A THING ON THE BOARD, IT IS THE TAIL OF
      // ITS BOOKING. It carries `caseId: null` (today-board :512), so the
      // membership test below could never see it: the booking moved and its
      // turnaround stayed behind, painting 清掃 over a span where nothing happens
      // and leaving none where the session now ends. Dropped from the membership
      // pass here and re-placed after the bookings settle, on whichever bed the
      // pair ended up on.
      if (item.kind === 'cleanup') return false
      const m = item.caseId ? membership[item.caseId] : undefined
      return !m || m.laneKey === lane.key
    })
    const arrivals: BoardItem[] = []
    for (const [id, m] of Object.entries(membership)) {
      if (m.laneKey !== lane.key || parked.includes(id)) continue
      const row = home.get(`${lane.group}|${id}`)
      if (!row || lane.items.some((i) => i.caseId === id)) continue
      arrivals.push(row)
    }
    const settled = [...kept, ...arrivals].map((i) => moved(i, lane.group)).concat(extra).sort(byX)
    return { ...lane, items: lane.group === 'beds' ? withTrailingCleanup(lane, settled, cleanupOf, hours) : settled }
  })
}

/** ⚖ 51 second-order — THE BOOKING'S TRAILING 清掃 MOVES WITH IT.
 *
 *  Re-placed rather than translated, so a move, a resize and a bed retarget all
 *  come out the same and 元に戻す needs no special case: the turnaround simply
 *  starts where its booking now ends, on the lane its booking now sits on.
 *
 *  The clamp is `cleanupBlocks`' own (today-board :101-103): never past the next
 *  booking on this bed, never past closing, and nothing drawn when that leaves
 *  no room. With an empty `moves`/`bedMoves` this reproduces the server's rows
 *  exactly, which is what makes it safe to run on every board.
 *
 *  ponytail: the LENGTH is the one the server drew, not the resource's
 *  `cleanup_minutes` — BoardLane does not carry that policy and threading it
 *  from page.tsx would be a wider change than this defect needs. It differs only
 *  for a turnaround the server had already clipped short, and only ever
 *  UNDER-draws, never blocking a minute the room is free. Carry
 *  `cleanup_minutes` onto BoardLane if that case ever matters. */
function withTrailingCleanup(
  lane: BoardLane,
  items: BoardItem[],
  cleanupOf: Map<string, BoardItem>,
  hours: Hours,
): BoardItem[] {
  const out = [...items]
  for (const b of items) {
    if (b.kind !== 'booking' || !b.caseId) continue
    const orig = cleanupOf.get(b.caseId)
    if (!orig) continue
    const start = b.endMin
    const ceiling = items.reduce(
      (c, i) => (i.kind === 'booking' && i.startMin >= start && i.startMin < c ? i.startMin : c),
      hours.close,
    )
    const end = Math.min(start + (orig.endMin - orig.startMin), ceiling)
    if (end <= start) continue
    out.push({
      ...orig,
      ...place(start, end, hours),
      time: `${clock(start)}〜`,
      micro: end - start <= 20,
      // The room's name is in the sentence a screen reader reads out, so a
      // retargeted turnaround that still says ベッド3 is the impossible state
      // ⚖ 8/9 forbids — the same reason the card's 【tag】 is rebuilt above.
      label: `${lane.label}、${clock(start)}から${clock(end)}、清掃・予約不可`,
    })
  }
  return out.sort(byX)
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

/** ⚖ BATCH-5 R1 (Liam 2026-08-21) — WHICH BOXES ARE CRUMBS. A packed box the
 *  length of the store's standard session IS the product and stands alone; any
 *  other length is a leftover the engine broke off a residue. Residues are
 *  shorter than one session by construction (`kPackCount` floors), so a crumb
 *  can never be mistaken for a session and a session can never be combined
 *  away. The palette rides the same answer — R6: crumbs orange, sessions blue. */
export const isCrumbOffer = (c: { s: number; e: number }, sessionMin: number): boolean => c.e - c.s !== sessionMin

/** ⚖ BATCH-5 R1 + R2 — the crumbs of ONE residue render as ONE offer.
 *
 *  The engine hands back a residue already broken into menu-sized pieces
 *  (50 = 30 + 20 on the fixture store's menu) and canon drew a box per piece:
 *  ¥3,860（30分）beside ¥2,690（20分）for a run nobody can book twice. They are
 *  provably one span — piece B starts exactly where piece A ends, inside one
 *  lane's own residue walk — so they combine into one box at the union length.
 *
 *  R2, and the reason this cannot be done by adding the pieces up: the price is
 *  ONE `packedPrice` call over the union. Each piece is rounded to ¥10 on its
 *  own, and summing rounded pieces charges the rounding remainder twice. */
function combineCrumbs(cells: GapCell[], sessionMin: number, priceUnion: (laneKey: string, s: number, e: number) => number): GapCell[] {
  const out: GapCell[] = []
  // The engine emits a staff row and a bed row per piece, so the previous cell
  // in the array is never the previous cell of the same run — each run is
  // tracked by its own (group, staff lane, bed) identity. A piece that found no
  // free bed is simply absent, which breaks the run exactly as it should.
  const lastOfRun = new Map<string, number>()
  for (const c of cells) {
    const runKey = `${c.group}|${c.laneKey}|${c.resourceKey}`
    const at = lastOfRun.get(runKey)
    const prev = at == null ? null : out[at]
    if (at != null && prev && prev.e === c.s && isCrumbOffer(prev, sessionMin) && isCrumbOffer(c, sessionMin)) {
      out[at] = { ...prev, e: c.e, price: priceUnion(prev.laneKey, prev.s, c.e) }
      continue
    }
    lastOfRun.set(runKey, out.length)
    out.push(c)
  }
  return out
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
    /** ⚖ BATCH-5 R3 (Liam 2026-08-21) — MINIMUM SELLABLE LENGTH. Below it the
     *  board advertises nothing and the space stays plain: a 20-minute orphan is
     *  not a product, and a shop that answers the phone for it loses the hour.
     *  Applied AFTER the crumbs combine, so 20+30 is a 50-minute offer rather
     *  than two things that each fall short. A store dial (the 店舗設定 control
     *  ships with the settings batch); absent = no floor. */
    minSellableMin?: number
  },
): { packed: GapCell[]; scraps: GapCell[] } {
  const engine = createGapGuard(opts.guard)
  const byKey = new Map(lanes.map((l) => [l.key, l]))
  const listOf = (lane: SellStaffLane) => byKey.get(lane.key)?.listPrice ?? 0
  const priceUnion = (laneKey: string, s: number, e: number) =>
    packedPrice(byKey.get(laneKey)?.listPrice ?? 0, s, e, opts.frame, opts.depth)
  const raw = deriveGapPackingCells({
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
  const floor = opts.minSellableMin ?? 0
  const sellable = (c: GapCell) => c.e - c.s >= floor
  return {
    packed: combineCrumbs(raw.packed, opts.sessionMin, priceUnion).filter(sellable),
    scraps: raw.scraps.filter(sellable),
  }
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

/** ⚖ Liam 46 FORERUNNER (slice C, Greptile #737 P1) — A BOARD IS A DAY *AND* A
 *  STORE. The session-edit family survives `?store=` exactly the way it survives
 *  `?day=` (the provider sits in the layout, which neither navigation remounts),
 *  so an edit staged on 銀座 was rendering on and being evaluated against 新宿's
 *  board — sharpest where a staff member works at BOTH stores and the two boards
 *  share a lane key, so a card added on one painted onto the other.
 *
 *  THIS IS THE MINIMAL FORERUNNER OF ⚖ 46, AND SLICE F SUPERSEDES IT. Batch 7 on
 *  feat/business-transplant-today carries the fuller design (storeParam +
 *  storeLabel on ParkHome/PlacingIntent + foreignStoreRefusal). On replay, the
 *  LATER slice wins every conflict in this family — everything marked
 *  "⚖ 46 forerunner" here is the thing being replaced, never the thing to keep.
 *
 *  ONE HOME for the comparison so "same store" cannot come to mean two things:
 *  the board filter, the shelf's placement refusal and the × all read it. */
export function sameStore(stamped: string | null, shown: string | null): boolean {
  return stamped === shown
}

/** ⚖ 46 forerunner — does this stamped edit belong to the board on screen? Both
 *  conjuncts are load-bearing: the day one is ⚖ 22's (an edit staged on 8/22 is
 *  not 8/23's), the store one is this fix's. */
export function onShownBoard(
  stamp: { dayOffset: number; store: string | null },
  shown: { dayOffset: number; store: string | null },
): boolean {
  return stamp.dayOffset === shown.dayOffset && sameStore(stamp.store, shown.store)
}

/** ⚖ Liam 22 (2026-08-21) — THE CHIP'S ×, answered from the board on screen.
 *
 *  Canon's park snapshot holds the origin ELEMENTS, so `restoreSnap` (:5589)
 *  puts the card back on its own track whatever day is showing. Ours holds a
 *  record, and now that the shelf survives day navigation the × can be pressed
 *  from a day that is not the origin — so the record's own `dayOffset` decides,
 *  never the board that happens to be on screen:
 *
 *   · `here`      — the origin day IS on screen; the card comes back in front of
 *                   the operator, and the toast can stay canon's.
 *   · `elsewhere` — the origin day is another board. The restore is still right
 *                   (the booking exists on exactly one day), so it happens — and
 *                   the toast NAMES the day, the way the hold bar's day-pin does,
 *                   rather than looking like the × did nothing.
 *   · `gone`      — the origin day is on screen and the booking is NOT on it.
 *                   The fixture world re-based underneath the shelf (a board left
 *                   open across JST midnight). FAIL SOFT: the caller keeps the
 *                   chip, so nothing is dropped in silence and the booking can
 *                   still be placed from what the chip itself records.
 *
 *   ⚖ Liam flag 46 (2026-08-21) — THE STORE IS THE SECOND COORDINATE. `?store=`
 *   is a Link like `?day=` is, so the shelf now survives a store switch too, and
 *   a chip from 銀座 standing on the 代官山 board has an origin this board cannot
 *   contain: `originOnShownDay` is false there for the same reason it is false on
 *   another day, and reading that as `gone` would have stranded the chip with
 *   「元の枠が見つかりません」 on a board that was never asked about it. A foreign
 *   store is `elsewhere` — the restore is still right, and the toast names where
 *   it went, exactly as the day case does. */
export function unparkOutcome(
  home: { dayOffset: number; storeParam: string | null },
  shownDayOffset: number,
  shownStoreParam: string | null,
  originOnShownDay: boolean,
): 'here' | 'elsewhere' | 'gone' {
  if (home.storeParam !== shownStoreParam) return 'elsewhere'
  if (home.dayOffset !== shownDayOffset) return 'elsewhere'
  return originOnShownDay ? 'here' : 'gone'
}

/** ⚖ Liam flag 46 (2026-08-21) — VISIBLE BUT REFUSED. Liam's ruling on the
 *  parked chip that outlives a store switch: "keep this store isolation clean".
 *  The chip STAYS in the shelf on a foreign store's board — it is the only
 *  record of what is being carried, and hiding it would be the vanish flag 47
 *  forbids — but it cannot be PLACED there, because a booking belongs to the
 *  store whose staff and rooms it was taken from and this board has neither.
 *
 *  The message names the chip's OWN store twice over: which store it is from,
 *  and where to go to put it down. `null` = the boards agree, place it. */
export function foreignStoreRefusal(
  home: { storeParam: string | null; storeLabel: string },
  shownStoreParam: string | null,
): string | null {
  if (home.storeParam === shownStoreParam) return null
  return `${home.storeLabel}の予約です。${home.storeLabel}のボードに切り替えてから置いてください（×で元の枠に戻せます）`
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

/** ⚖ Liam flag 29 (2026-08-21) — WHO CARRIES THE CARD, and the one place the
 *  move/resize split is decided.
 *
 *  A MOVE takes the booking off the board and puts it in the operator's hand
 *  (flag 19's proxy): this returns `true`, and the proxy, the shelf test and
 *  the lane hunt all belong to that half. A RESIZE does not pick anything up —
 *  canon stretches the card WHERE IT STANDS (`evSet`, :3697, called from
 *  `dragMove` :4488–4508) and returns before any lane, shelf or ghost logic.
 *  Pressing an edge and watching the whole card fly to the cursor was Liam's
 *  flag 29; this function is the fix, and the two halves cannot drift apart
 *  because one call answers for both.
 *
 *  The write goes straight to the node React already owns — the same custom
 *  properties its `style` prop sets, in the same `${n}%` spelling — so the
 *  gesture costs no re-render and `clearDrag` hands the node back by calling
 *  this once more with the ORIGIN span.
 *
 *  NODES, PLURAL: a booking is a person AND a room, so the board draws it twice
 *  and BOTH drawings are the same booking. Stretching only the one under the
 *  pointer left the other saying 60分 while the card in hand said 90分 until the
 *  release caught it up — a lie about bed occupancy for the length of the
 *  gesture. A block has exactly one drawing and passes exactly one node. */
export function stretchOrCarry(nodes: readonly HTMLElement[], mode: DragMode, span: { x: number; w: number }): boolean {
  if (mode === 'move') return true
  for (const node of nodes) {
    if (mode === 'resizeL') node.style.setProperty('--x', `${span.x}%`)
    node.style.setProperty('--w', `${span.w}%`)
  }
  return false
}

/** canon `evLabel` (:3766) — a card being stretched says the time it is being
 *  stretched TO, in its own time line, live. Same contract as above: the node
 *  is React's, and the teardown writes back the string React last rendered.
 *  Canon's overflow fallback is not carried — canon appends a suffix and can
 *  outgrow the box; our `.e-time` holds the range alone and `.event small`
 *  already ellipsises. Blocks get no label: canon does not call `evLabel` from
 *  `bindBlockDrag` either (a 休憩 is a placeholder, not a time). */
export function liveTimeLabel(nodes: readonly Element[], text: string): void {
  for (const node of nodes) {
    const t = node.querySelector('.e-time')
    if (t) t.textContent = text
  }
}

/** Every drawing of one booking. The board puts the same card on a staff lane
 *  and on a bed lane (canon's `pairOf`), and a gesture owns all of them. */
export function cardNodes(board: Element | null, caseId: string): HTMLElement[] {
  return Array.from(board?.querySelectorAll<HTMLElement>(`.event[data-book="${caseId}"]`) ?? [])
}

/** ⚖ Liam flag 39 — the same lookup for a 予定ブロック, which has no `caseId`
 *  because it is not a booking: a 記録 or a 準備 is keyed by its own `key`, and
 *  it lands on exactly one lane. The advisor hangs under the box it is talking
 *  about, so it has to be able to find it after React has repainted the move. */
export function blockNode(board: Element | null, key: string): HTMLElement | null {
  return board?.querySelector<HTMLElement>(`.event[data-block="${key}"]`) ?? null
}

// ── ⚖ Liam flag 51 — PEOPLE ARE CHOSEN, ROOMS ARE SOLVED ───────────────────

/** ⚠SETTINGS-BATCH — the store's two room-allocation judgements, as data. They
 *  arrive from `opsConfig.roomPolicy`; nothing in this file or in the board
 *  decides them, so a store that runs its 個室 differently changes a setting
 *  rather than a component. */
export interface RoomPolicy {
  vipStaysPrivate: boolean
  privateIsLastResort: boolean
}

/** ⚖ LIAM 2026-08-21 (flag 51, LOCKED) — THE BED IS AN ALLOCATION, NOT A
 *  CHOICE. Staff, customer and time are human decisions; the room is something
 *  the system re-solves at EVERY landing:
 *
 *    · keep the booking's current bed when it is free at the landing time;
 *    · otherwise retarget silently to any free compatible bed;
 *    · refuse ONLY when no compatible bed is free — 満室, with the blocking
 *      bed(s) NAMED, because 「時間帯が重複: 見本 あかり」 on a lane whose staff
 *      member is plainly free reads as nonsense (Liam's own scene).
 *
 *  A bed-row drag is the operator saying WHICH ROOM out loud and is never
 *  auto-solved — that path keeps batch-6's stage-with-確定-disabled behaviour.
 *
 *  WHAT COUNTS AS BUSY. Everything standing on the room, 清掃 included — the
 *  board already calls that 予約不可時間 and `freePartnerLane` (which this
 *  replaces, so there is ONE bed search rather than three) always did. TWO
 *  exclusions, both of which travel WITH the booking rather than blocking it:
 *  its own drawing, and its own trailing 清掃 (`${id}-cleanup`, derived per
 *  booking in `today-board.cleanupBlocks`). Without the second, moving a card
 *  30 minutes later on its own bed collided with its own turnaround and got
 *  thrown out of the room it was already in. */
export function allocateBed(
  lanes: BoardLane[],
  opts: {
    /** The booking being landed. `null` for one that does not exist yet. */
    id: string | null
    /** The room it carries in — the first candidate, per the keep-if-free rule. */
    currentBed: string | null
    /** ⚖ STORE ISOLATION — THE STORES THE BOOKING'S OWN STAFF LANE BELONGS TO.
     *  `null` = a floating staff member, who pairs with any room; otherwise the
     *  allocator may only hand out rooms this person's store actually has.
     *
     *  REQUIRED on purpose. Under the all-stores lens `lanes` carries every
     *  store's beds, and a search that only asked "is it free?" could retarget a
     *  booking into ANOTHER STORE's room — the board would draw a person in a
     *  building they are not in. The viewAll lens is dormant in the UI today
     *  (すべての店舗 was removed), so this is unreachable rather than fixed; the
     *  store-isolation law is system-wide and the allocator has to be right by
     *  construction. An optional field defaulting to "every store" would be
     *  fail-open, which is the one thing this must not be. */
    stores: string[] | null
    /** A VIP/個室クラス booking never silently leaves the 個室. */
    vip: boolean
    start: number
    end: number
    policy: RoomPolicy
  },
): { laneKey: string | null; refusal: string | null } {
  const { id, start, end, policy } = opts
  const blockersOn = (lane: BoardLane) =>
    lane.items.filter(
      (i) =>
        (id == null || (i.caseId !== id && i.key !== `${id}-cleanup`)) &&
        i.endMin > start &&
        i.startMin < end,
    )
  // ⚖ STORE ISOLATION, at the only place rooms are chosen. Same rule as canon's
  // `canPair` (availability.ts:51) — a floating lane pairs with anything, and
  // otherwise the two have to SHARE a store. It is spelled against BoardLane
  // here because canPair reads the sell layer's flattened shapes, and that
  // flattening is itself the known A-5 defect: `sellResourceLanes` collapses a
  // bed to `stores?.[0] ?? ''`, so a multi-store room answers for one store and
  // a floating room answers for none. Comparing the arrays directly means this
  // allocator does not inherit that bug.
  const sharesStore = (bed: BoardLane) =>
    opts.stores === null || bed.stores === null || opts.stores.some((s) => bed.stores!.includes(s))
  const beds = lanes.filter((l) => l.group === 'beds' && sharesStore(l))
  const needsPrivate = opts.vip && policy.vipStaysPrivate
  const compatible = (l: BoardLane) => (needsPrivate ? l.roomClass === 'private' : true)
  const free = (l: BoardLane) => blockersOn(l).length === 0
  const current = beds.find((l) => l.key === opts.currentBed)
  if (current && compatible(current) && free(current)) return { laneKey: current.key, refusal: null }
  const candidates = beds.filter(compatible)
  // 個室 last for a regular booking: it is the room the VIP work needs, so it is
  // spent only when the treatment rooms are gone.
  const ordered =
    needsPrivate || !policy.privateIsLastResort
      ? candidates
      : [...candidates.filter((l) => l.roomClass !== 'private'), ...candidates.filter((l) => l.roomClass === 'private')]
  const taken = ordered.find(free)
  if (taken) return { laneKey: taken.key, refusal: null }
  return { laneKey: null, refusal: fullRoomsRefusal(candidates.map((l) => [l, blockersOn(l)] as const), start, end, needsPrivate) }
}

/** canon `renderHoldBar`'s summary line (:4769): who, when, on whom, on what.
 *
 *  ⚖ Liam flag 51 — AND WHEN THE ROOM CHANGED, THE LINE SAYS SO: ベッド3 →
 *  ベッド2. The allocator retargets silently on purpose (the operator chose a
 *  person and a time, not a room), but a silent switch the staff cannot SEE is a
 *  defect — this line is where they see it, in the same surface they confirm
 *  from. `bedFrom` is the pair snapshot's own bed lane, so it is the room the
 *  booking stood in before this whole change, not the room it stood in a frame
 *  ago; a change that ends where it started says nothing.
 *
 *  It lives out here with the rest of the board's answers rather than in the
 *  JSX for this file's own stated reason: a sentence the operator confirms from
 *  has to be provable without a renderer. */
export function holdSummary(
  lanes: BoardLane[],
  id: string,
  at: Move | undefined,
  hours: Hours,
  bedFrom: string | null = null,
): string {
  if (!at) return ''
  const staffLane = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === id))
  const bedLane = lanes.find((l) => l.group === 'beds' && l.items.some((i) => i.caseId === id))
  const item = staffLane?.items.find((i) => i.caseId === id) ?? bedLane?.items.find((i) => i.caseId === id)
  const from = minuteOf(at.x, hours)
  const to = minuteOf(at.x + at.w, hours)
  const moved =
    bedFrom != null && bedLane != null && bedFrom !== bedLane.key
      ? `${lanes.find((l) => l.key === bedFrom)?.label ?? bedFrom} → `
      : ''
  return `${item?.title ?? ''}様 → ${clockOf(from)}〜${clockOf(to)} / 担当 ${staffLane?.label ?? '—'} / ${moved}${bedLane?.label ?? '—'}`
}

/** ⚖ flags 44 + 51 — 満室, said the way the board says every other refusal: the
 *  exact window it judged, then WHY, naming the room and who is in it. 清掃 and
 *  予定ブロック answer with their own word (they have no customer). */
function fullRoomsRefusal(
  rows: ReadonlyArray<readonly [BoardLane, BoardItem[]]>,
  start: number,
  end: number,
  needsPrivate: boolean,
): string {
  const window = `${clockOf(start)}〜${clockOf(end)}`
  const room = needsPrivate ? '個室' : 'ベッド'
  if (rows.length === 0) return `${window}に使える${room}がありません`
  const who = (i: BoardItem) => (i.kind === 'booking' ? `${i.title}様` : i.title)
  const named = rows.map(([lane, blockers]) => `${lane.label}が使用中（${[...new Set(blockers.map(who))].join('・')}）`)
  return `${window}は${room}が満室です。${named.join('、')}`
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
