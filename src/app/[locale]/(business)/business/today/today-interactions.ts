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
  type GapPackingInput,
  type SellBand,
  type SellCell,
  type SellLayer,
  type SellResourceLane,
  type SellStaffLane,
} from '@/business/lib/canon-logic/availability'
import { createGapGuard, type GuardConfig, type GuardContext, type GuardPlacement, type GuardReason } from '@/business/lib/canon-logic/gap-guard'
import { gapFillPrice, gapFillRawTotal, money, packedPrice, priceAt, priceLabel, SELL_SLOT_MIN, type PriceFrame } from '@/business/lib/canon-logic/pricing'
import {
  computeChecks,
  confirmCaption,
  dragGeometry,
  dragModeFor,
  spansOverlap,
  stepPct,
  type Check,
  type CheckSpan,
  type DragMode,
  type DragOrigin,
} from '@/business/lib/canon-logic/drag-rules'
import { hhmm, minuteOf, place, type BoardItem, type BoardLane, type Hours } from '@/business/lib/today-board'
// ⚖ SPEC-SELLING-ENGINE §2 — TYPE-ONLY, and it has to stay that way: the mask
// imports `laneSpans` from this file as a VALUE, and the capacity book imports
// `allocateBed`, so a value import back to either would be a real module cycle.
// `import type` is erased before it exists.
import type { ReservedOffer } from './capacity-ledger'
import type { ReservedLaneMask, ReservedSpan } from './reserved-mask'

export type { DragMode, DragOrigin }

/** ⚖ SPEC-SELLING-ENGINE §2 — THE HELD SET, INDEXED BY LANE, once per pass.
 *
 *  Every seam below reads the mask the same way and none of them derives it: an
 *  ABSENT mask is the round gate OFF (`selling-engine-gate.ts`), and it means
 *  today's board exactly — no lane has held spans, so every test below is false
 *  and every branch falls through to the code that shipped. */
const heldByLane = (held: readonly ReservedLaneMask[] | undefined): Map<string, readonly ReservedSpan[]> =>
  new Map((held ?? []).map((m) => [m.laneKey, m.spans]))

/** Half-open on both sides, the same `overlaps` grammar as everything else on
 *  this board: a span that ENDS at a held window's start is not inside it. */
const insideHeld = (spans: readonly ReservedSpan[] | undefined, s: number, e: number): boolean =>
  spans != null && spans.some((h) => s < h.end && h.start < e)

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

/** ⚖ LIAM flag 87 (2026-08-30) — THE ROOM THE BOOKING OWNS, not the room a
 *  half-finished change left it standing in.
 *
 *  ⚖ 51 re-solves the bed at EVERY landing, and `allocateBed`'s first rule is
 *  keep-if-free: the booking's CURRENT room wins when it is free at the new
 *  span. `sidesAt` above reads that room off the board as it STANDS — which,
 *  once something is staged, is the outbound leg's room and not the booking's
 *  own. So a card dragged off its room and back again kept the room the detour
 *  had to borrow, `bedMoves` claimed it permanently, and every box that
 *  depended on the room the booking actually vacated died honestly about a move
 *  the operator had already undone.
 *
 *  Neither half of that was wrong on its own: keep-if-free is the right rule and
 *  the reconciliation was answering the board it was given. The SEED was wrong.
 *  The origin is already snapped, both sides, at the first gesture's pointerdown
 *  (`PendingChange.bedOrigin` — canon's per-element snap, the same record 元に
 *  戻す restores from), so the fix is to prefer it and change nothing else:
 *
 *    · nothing staged → no origin to prefer, and the landing solves exactly as
 *      it always has;
 *    · an OUTBOUND leg stays honest → the origin room is busy at the new span,
 *      keep-if-free fails there, and the fresh solve fires as before;
 *    · a booking that never had a bed row at all carries no `bedOrigin` (⚖ 45's
 *      own clause), and then the staged room is the only room there is.
 *
 *  ⚖ FLAG 87 FIX ROUND (Greptile 4/5, 2026-08-30) — AND A ROOM THE OPERATOR
 *  PICKED OUT LOUD OUTRANKS BOTH. The clause above is right about a room the
 *  BOARD chose — an outbound leg's borrowed room is the allocator's answer to a
 *  question the operator never asked. A bed-row drag is not that: it is the
 *  operator saying WHICH ROOM, and `solveBed` is not even called on it (its own
 *  doc: 「A BED-ROW drag never calls this」). Preferring the origin over it meant
 *  the very next TIME adjustment — a staff-row drag, a Shift/Alt+Arrow — re-solved
 *  from the origin room, keep-if-free kept it, and the operator's choice was
 *  silently undone by a gesture that was not about rooms at all.
 *
 *  So the seed has three rungs, and they are ordered by WHO decided:
 *    1. `bedChosen` — the operator, by hand, on this very staged change;
 *    2. `bedOrigin` — the booking's own room, which is what it owns while a
 *       change is open;
 *    3. `staged` — the board as it stands, which is all there is when nothing
 *       is staged.
 *  Every rung is still a CANDIDATE, never an instruction: `allocateBed` judges
 *  it, so a chosen room that is busy at the new span loses keep-if-free and the
 *  fresh solve fires exactly as it does for a busy origin. */
export function seedBed(
  pending: { id: string; bedOrigin?: Move; bedChosen?: string } | null,
  id: string,
  staged: string | null,
): string | null {
  if (pending?.id !== id) return staged
  return pending.bedChosen ?? pending.bedOrigin?.laneKey ?? staged
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
  for (const el of Array.from(root.querySelectorAll('.lane')) as HTMLElement[]) {
    if (group !== null && el.dataset.group !== group) continue
    const r = el.getBoundingClientRect()
    if (clientY >= r.top && clientY <= r.bottom) {
      found = el.dataset.lane ?? null
      continue
    }
    // ⚖ LIAM flag 61 (2026-08-22) — THE RAIL BELONGS TO THE LANE ABOVE IT, and
    // this is canon's own clause (`semanticLaneAt` :3828-3833), which the
    // transplant did not carry. The 60分配置 strip is rendered as a SIBLING of
    // its lane (TodayScreen's Fragment, canon's rule quoted there), 18px tall
    // against a 72px row — so a fifth of every staff row's pitch belonged to no
    // `.lane` at all and every release inside it died with a bottom toast while
    // the operator's eye was on the cursor. The doc comment above has described
    // this rule since the function was written; the code did not implement it.
    // Rendering ≠ working, inside one function.
    if (el.dataset.group !== 'staff') continue
    const rail = el.nextElementSibling
    if (!rail || !rail.classList.contains('guard-placement-rail')) continue
    const rr = rail.getBoundingClientRect()
    if (clientY >= rr.top && clientY <= rr.bottom) found = el.dataset.lane ?? null
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
 *  The row is the verdict's own sentence, minus the rail's `・損を減らす` aside —
 *  that fragment is a CHIP LABEL glued inside the loss figure's parentheses, and
 *  the sentence that follows says the same thing in words. `null` for a safe
 *  landing: a check that always passes is noise.
 *
 *  ⚖ GAP-6 (R3 of the layer rebuild, 2026-08-25) — AND IT IS THE WHOLE SENTENCE.
 *  This used to be `sentence.split('。')[0]`, which threw away the engine's
 *  second clause — 「{clock}はこの区間で損が最少の開始です」 — the one part of
 *  the row that answers "then where?". The operator was shown a cost with no
 *  way out of it, on the very surface they confirm from. The engine already
 *  computes the least-loss start (`leastLossStart`, railCell's degraded branch);
 *  truncating it was the board keeping an answer it already had. Only the
 *  degraded sentence has two clauses — every blocked sentence is one — so this
 *  changes that row and no other.
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
  return { label: cell.sentence.replace('・損を減らす', ''), tone: 'warn' }
}

/** ⚖ FIX-6 (blind round, 2026-08-25) — THE SAME ROW, BESIDE AN OFFER LINE.
 *
 *  GAP-6 gave the row back the engine's second clause 「{clock}はこの区間で損が
 *  最少の開始です」, and that clause is the row's answer to "then where?". On the
 *  HOLD popover it is the only answer there is, so it belongs.
 *
 *  The CONSULT popover is the other surface, and it already has an offer line:
 *  `sourcedCell`/`offerableCell` put the engine's own alternative starts under
 *  the facts, and when there are none that line reads 「この区間に、より損の少な
 *  い開始はありません」. Stacking clause two above it prints a contradiction —
 *  「15:45は…損が最少の開始です」 over 「より損の少ない開始はありません」 — two
 *  true sentences from two different questions, which the operator reads as the
 *  board disagreeing with itself.
 *
 *  So the SPLIT lives here, in one place, and it is a decision about SURFACES
 *  rather than about the sentence: display never re-authors the engine's words,
 *  it picks which row it is entitled to. Derived from `guardCheckRow` rather
 *  than re-deriving the label, so the two can never drift apart, and ⚖ flag 52
 *  rides along untouched — same tone, same never-blocking, same forbidden ×. */
export function guardCheckRowBesideOffer(cell: RailCell | null): { label: string; tone: 'warn' } | null {
  const row = guardCheckRow(cell)
  return row && { ...row, label: row.label.split('。')[0] }
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
  const groupOf = new Map(lanes.map((l) => [l.key, l.group]))
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
  // ⚖ Liam flag 61, second-order (study §61 bonus) — A ROW THIS SESSION CREATED
  // IS A BOARD ROW. `added` used to bypass everything below: it was filtered by
  // the lane it was BORN on and concatenated AFTER the `moved` pass, so a
  // 次回予約 or a shelf placement could never be redrawn at a staged span and
  // could never change lane. Drag one and the 仮押さえ line reported the new
  // time while the card did not move — deterministic, and another "the drop did
  // nothing" for the operator. Its home row joins the same map every server row
  // uses, so from here down there is one kind of row.
  const placedIds = new Set<string>()
  // …and THESE EXACT ROWS are the placements — see the exemption below, which is
  // object identity because neither `caseId` nor `key` can tell a placement from
  // the server original it replaces.
  const placedRows = new Set(added.map((a) => a.item))
  for (const a of added) {
    const g = groupOf.get(a.laneKey)
    if (a.item.caseId) placedIds.add(a.item.caseId)
    if (g && a.item.kind === 'booking' && a.item.caseId) home.set(`${g}|${a.item.caseId}`, a.item)
  }

  // ⚖ Liam flag 59, THE RESIDUE (batch-11) — A ROOM NOBODY DREW IS STILL A ROOM.
  //
  // `home` is the ONLY way a booking can be admitted to a lane it is not already
  // drawn on, and it is built from drawings that exist. A booking whose server
  // record carries no `resource_id` has no bed drawing anywhere — the bed lanes
  // are `bookings.filter((b) => b.resourceId === resource.id)` (today-board
  // :542) — so the room a landing solved was written into `bedMoves` and then
  // silently dropped: the arrival below found no row, nothing was drawn, and
  // `holdSummary` read the drawn board and printed 担当 … / —. That em-dash is
  // Liam's 8/22 shot, and batch-10 only closed the half where the allocator was
  // never asked; this is the half where its answer was thrown away.
  //
  // FIXED HERE, not in each writer. `stage`, the keyboard nudge and anything
  // that ever writes `bedMoves` all pass through this one function, so the guard
  // is one line rather than one mint per gesture — and a row minted into `added`
  // by a caller would additionally be exempt from the park filter below
  // (`placedRows`), i.e. a bed drawing that survives being put on the shelf.
  //
  // The bed row IS the booking's own staff row wearing the bed key, exactly as
  // the server builds the pair (today-board :396-413 — one `bookingItem`, two
  // key suffixes). `moved` re-tags it from the partner lane a few lines down,
  // which is the same 【担当】 the server would have written.
  //
  // ⚖ AMENDMENT 1, lens-3 F3 — AND IT SAYS WHICH ROOM IT IS IN. The staff row's
  // accessible name carries the room the SERVER drew (today-board :412's fourth
  // segment), which for a `resource_id: null` booking is 「未定」 — so the copy
  // announced 「未定」 to a screen reader while sitting in ベッド1. The codebase's
  // own rule at its two sibling sites (`placeFromShelf`, `withTrailingCleanup`)
  // is that a row which moves REBUILDS its sentence rather than carrying one that
  // is no longer true. Only the room segment is ours to correct here, and the
  // length guard means a differently-shaped label is left alone rather than
  // mangled. (The stale time-range half is `atSpan`'s, board-wide and queued.)
  for (const id of Object.keys(bedMoves)) {
    if (home.has(`beds|${id}`)) continue
    const staffRow = home.get(`staff|${id}`)
    if (!staffRow) continue
    const room = lanes.find((l) => l.key === bedMoves[id].laneKey)?.label
    const parts = staffRow.label.split(' / ')
    const label = room != null && parts.length === 5 ? [...parts.slice(0, 3), room, parts[4]].join(' / ') : staffRow.label
    home.set(`beds|${id}`, { ...staffRow, key: `${id}-bed`, label })
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
    // …and it is filtered, moved and re-admitted exactly like one — with ONE
    // exemption, which is ⚖ 22's cross-day park: a booking placed on another
    // day stays in `parked` on purpose, because that is what keeps the ORIGIN
    // day hiding it. The row this session placed is the placement itself, so it
    // is never hidden by the flag that hides its origin.
    //
    // GREPTILE #749 P1 — AND THE EXEMPTION IS THE ROW, NOT THE CASE. Keyed by
    // `caseId` it un-hid every row wearing that id, and a park-then-place-back
    // ON THE DISPLAYED DAY has two of them: the server's original, still standing
    // in `lane.items` because `parked` is the only thing that was hiding it, and
    // the replacement in `added`. One booking, two cards — on the staff row AND
    // on the bed row — and every layer downstream (the sell layer, guard
    // occupancy, the 清掃 tail) counted the booking twice. `key` cannot separate
    // them either: `placeFromShelf` mints `${id}-staff`/`${id}-bed`, which is
    // byte-for-byte what the server drew (today-board :357). So the exemption is
    // the row itself — the exact objects `own` concatenates a line below. The
    // server's original stays hidden, which is what `parked` said all along, and
    // ⚖ 22's cross-day placement is still the one row that shows.
    const own = added.some((a) => a.laneKey === lane.key)
      ? [...lane.items, ...added.filter((a) => a.laneKey === lane.key).map((a) => a.item)]
      : lane.items
    const kept = own.filter((item) => {
      if (isParked(item, parked) && !placedRows.has(item)) return false
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
      if (m.laneKey !== lane.key || (parked.includes(id) && !placedIds.has(id))) continue
      const row = home.get(`${lane.group}|${id}`)
      if (!row || own.some((i) => i.caseId === id)) continue
      arrivals.push(row)
    }
    const settled = [...kept, ...arrivals].map((i) => moved(i, lane.group)).sort(byX)
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
export function blockChrome(kind: BoardItem['kind']): {
  cls: 'cleanup' | 'absence' | 'block'
  opens: boolean
  locked: string | null
  /** ⚖ Liam Q6 (flag 64, 2026-08-22) — WHY THIS BLOCK CANNOT BE HAND-DELETED.
   *
   *  Same shape as `locked` directly above: `null` means allowed, and a string
   *  is always the REFUSAL — the sentence the dialog shows in place of the 削除
   *  button. (The packet calls this field `deletable`; it is named for what a
   *  non-null value says, so it cannot be read backwards.)
   *
   *  A 清掃 is the only one. It is not stored: `applyMoves` drops every cleanup
   *  from the membership pass and `withTrailingCleanup` re-derives it after the
   *  bookings settle, so a hand-delete would look like it worked and then undo
   *  itself on the next render. The dialog still OPENS — the operator came to
   *  read the facts and canon lets them — it just cannot offer a button that
   *  would lie. Same precedent as 勤務不可's spoken refusal, one level down. */
  notDeletable: string | null
} {
  const cls = kind === 'cleanup' ? 'cleanup' : kind === 'absence' ? 'absence' : 'block'
  const opens = cls !== 'absence'
  return {
    cls,
    opens,
    locked: opens ? null : '勤務不可はシフト管理で変更します — ボード上では動かせません',
    notDeletable: cls === 'cleanup' ? 'この清掃は直前の予約に付いています。予約を動かせば一緒に動き、予約が消えれば一緒に消えます。' : null,
  }
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
 *  refuse against the same occupancy, so they can never disagree.
 *
 *  ⚖ R4 (2026-08-25) — THAT SENTENCE WAS TRUE ON ONE AXIS ONLY, and the round
 *  exists because of the other one. On the STAFF axis it holds: both layers
 *  read the same `SellStaffLane[]`, so they cannot disagree about whether a
 *  person is free. On the BED axis they never met — the sell layer minted a
 *  per-slot `Set` inside canon's own loop and the gap layer kept a per-call
 *  `bedLedger`, two private books that could hand the SAME room to two
 *  different customers at the same hour. THREE such double-claims sit on the
 *  pristine demo fixture at the store's own dials, and the count is
 *  dial-dependent — the sweep moves it (⚖ R4 fix round: this line said "four",
 *  which counted the sell cells un-merged; the red run's own total is 3).
 *  `sellLayerFor` now reconciles the sell layer against
 *  the gap layer's finished cells (`reconcile` below), so the bed axis has one
 *  answer too — and the sentence above is finally true as written. */
export function sellStaffLanes(lanes: readonly BoardLane[], locked: string[]): SellStaffLane[] {
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

/** ⚖ R4 (2026-08-25) — A-5, THE STORE FLATTENING, NAMED RATHER THAN LEFT INLINE.
 *
 *  `storeId` is ONE string because canon's `SellResourceLane` says so and
 *  `canPair` reads exactly that field (availability.ts:51) — a frozen file, so
 *  this shape is not ours to widen. A `BoardLane` carries the whole list, and
 *  the two disagree in two places: a room belonging to more than one store
 *  keeps only its first, and a FLOATING room (`stores: null`, "every store")
 *  becomes `''`, which no staff member's list contains.
 *
 *  WHICH DIRECTION IT FAILS, because that decides whether R4 may leave it: in
 *  every case canon's answer is a strict SUBSET of `sharesStore`'s. `staff ===
 *  null` short-circuits both to true; a single-store room is identical; the two
 *  divergences above both turn a legal pairing into a refusal. So the
 *  flattening can only UNDER-advertise — it can never put a person in another
 *  store's room, which is the direction the store-isolation law cares about,
 *  and a reconciliation pass downstream can never win those offers back because
 *  they were never emitted. Today it is unreachable besides: today-board writes
 *  `stores: [resource.store_id]` for every room (:583).
 *
 *  WHAT R4 DOES ABOUT IT: every room decision this round makes — the re-bedding
 *  in `reconcileSellCells` — goes through `allocateBed`, whose store rule is
 *  `sharesStore` over the room's WHOLE list. So the offers R4 moves are placed
 *  by the real rule even where canon's pairing would have refused. Repairing
 *  canon's own emission needs `SellResourceLane` to carry the list, and that is
 *  an edit to a frozen file — recorded as a spec/ask, not done here. */
export function sellResourceLanes(lanes: BoardLane[]): SellResourceLane[] {
  // ⚖ ROOM RULE clause 1, AT THE SEAM. `SellResourceLane` carries no room class
  // and canon's `bedLedger` (availability.ts :345-358) takes the first free lane
  // in ARRAY order, so 個室-last survived on the money surface only because
  // bed-03 happens to sit third in the fixture. A store whose 個室 was created
  // first would sell it to online traffic with standard rooms standing empty. One
  // ordering, applied before the hand-off; canon stays byte-frozen.
  return orderRooms(lanes.filter((l) => l.group === 'beds'))
    .map((l) => ({ key: l.key, name: l.label, occupied: laneSpans(l), storeId: l.stores?.[0] ?? '' }))
}

/** ⚖ R4 (2026-08-25) — WHICH PROMISE KEEPS THE ROOM. One exported function, one
 *  home, so the rule is never a literal buried in a filter.
 *
 *  THE DEFAULT IS TODAY'S SHIPPED BEHAVIOUR: the スキマ枠/詰め込み box wins and
 *  the 販売可能枠 hour moves or goes. That is what `renderLane`'s per-lane
 *  suppression did before this round (canon `suppressOverlappingSellableCells`,
 *  :5039), and R4 is a CORRECTNESS round — it makes one room carry one
 *  advertised offer, and it must not also change which offer the store earns
 *  from. The nine-lens council measured gap-first losing money on 8 of 9 dial
 *  settings, but on SYNTHETIC occupancy; that is a revenue ruling for Liam once
 *  it is measurable on real bookings, not a builder's call on fixture data.
 *
 *  FLIPPING IT IS ONE LINE — `return 'sell'` — and the line is the small half of
 *  the change. This seam can only drop the SELL side: `gapLayerFor` has already
 *  run and its cells arrive here as an input (see `SellReconcile`), so a 'sell'
 *  answer leaves the gap box drawn and the reconciliation has to move up one
 *  level, to the screen, where both lists are in hand.
 *
 *  IT TAKES NOTHING BECAUSE IT WEIGHS NOTHING (⚖ R4 fix round). It once took the
 *  two spans, ignored both, and needed an `eslint-disable` to say so — a
 *  signature built for a ruling that has not been made. The ruling WIDENS the
 *  signature the day it lands, and adding the parameters back is the same one
 *  line as the `return` above; a parameter list that lies today buys nothing
 *  towards it.
 *
 *  ponytail: no config, no policy object, no store dial — nothing has asked for
 *  one. A named function with a provenance comment is the whole requirement. */
export function keepsTheRoom(): 'sell' | 'gap' {
  return 'gap'
}

/** ⚖ R4 — WHAT THE OTHER LAYER HAS ALREADY PROMISED, handed to this one.
 *
 *  `claims` are `gapLayerFor`'s FINAL cells — after `combineCrumbs` and the
 *  `minSellableMin` floor — because a claim the board never draws is not a
 *  claim, and reconciling against the raw cells would suppress hours for boxes
 *  that were then filtered away. The screen therefore computes the gap layer
 *  FIRST and hands the result in.
 *
 *  ABSENT means the caller drew no スキマ枠/詰め込み layer at all, which is the
 *  literal truth for a unit test asking about the sell layer alone, and leaves
 *  the derivation byte-identical to R3's. */
export interface SellReconcile {
  claims: readonly GapCell[]
  /** Per-room turnaround, ⚖ flag 77's dial. A room MISSING from the map is a
   *  bare room (0 minutes) — the same decision, and the same reason, as
   *  `ClaimsBook.violations`. */
  cleanupMinutesByBed: Record<string, number>
  /** ⚖ flag 75(i) rider (2026-08-26) — WHAT THE RECONCILE THREW AWAY, told to
   *  whoever asked. Absent by default and OBSERVATIONAL by construction: it is
   *  called, never read, so a board that passes one and a board that does not
   *  get the same cells (`today-explains.test.ts` pins that byte-for-byte).
   *
   *  WHY IT EXISTS AT ALL: R4 makes one room carry one advertised offer, and
   *  the offers it drops leave a hole nothing on the board explains — a ✓ chip
   *  over empty space, which reads as an hour the store simply did not bother
   *  to sell. The reason was computed here and discarded. Handing it out is the
   *  whole of the honesty rider; the composing happens display-side. */
  onDrop?: (drop: SellDrop) => void
}

/** ⚖ 75(i) — ONE OFFER THE RECONCILE DID NOT KEEP.
 *
 *  `kind` is the two answers the reconcile can give, and they are DIFFERENT
 *  facts about the board:
 *    · `lane` — this offer's own PERSON is already inside a promise, so no room
 *      could have saved it. The space is not empty: the box that beat it is
 *      drawn on this very row, and ⚖ 75(i) says a chip over it gets no clause.
 *    · `room` — the room went to somebody else's promise and the loser found
 *      nowhere to land. THIS is the hole a ✓ chip cannot otherwise explain, and
 *      `takerLaneKey` is who got it (rider 75(ii)'s honesty about lane order). */
export interface SellDrop {
  /** The staff lane the dropped offer was advertised on. */
  laneKey: string
  /** Its slot start — the offer spans `[h, h + SELL_SLOT_MIN)`. */
  h: number
  kind: 'lane' | 'room'
  /** `room` drops only: the lane whose claim kept the room. */
  takerLaneKey?: string
}

/** ⚖ R4 — ONE ADVERTISED OFFER PER BED, decided at the app seam.
 *
 *  THE DEFECT: the sell layer and the gap layer each picked rooms out of their
 *  own private book, so staff p-05's 販売可能枠 hour and staff p-06's スキマ枠
 *  box could both point at ベッド2 at the same minute. The shipped suppression
 *  ran inside `renderLane` and filtered `onThisLane` — the same DRAWN ROW — so
 *  it could not see a cross-row collision at all, and because it ran after
 *  `buildSellLayer` the counts it fed (公開中 N枠, 販売可能枠 N窓, the 運営影響
 *  stat) were computed from boxes the screen then declined to draw.
 *
 *  Reconciling HERE, between `deriveSellableCells` and `buildSellLayer`, makes
 *  those counts honest BY CONSTRUCTION: every surface reads a layer built out of
 *  the cells that actually survive.
 *
 *  FOUR MOVES, in this order, per offer:
 *    1. is this offer's own PERSON already inside a promise? Then no room saves
 *       it and it is DROPPED — see `busyLane` below. This is the half of the old
 *       render-time filter that has to live here too.
 *    2. does this offer's OWN room carry a competing promise — overlap, or a
 *       separation shorter than that room's turnaround? The test is per ROOM and
 *       per SPAN, never per drawn row.
 *    3. if it does, SOLVE THE ROOM — 「people are chosen, rooms are solved」
 *       (⚖ flag 51). The loser is re-bedded through `allocateBed`, the same one
 *       search every other room decision on this screen goes through, asked as a
 *       hypothetical (`id: null`) on a board whose competing and already-taken
 *       rooms are not on offer. Most losers land somewhere.
 *    4. only a loser with nowhere to go is DROPPED.
 *
 *  WHAT IS NOT RECONCILED, deliberately: two sell options overlapping on one
 *  room. An offer is an OPTION and a booking grid emitting 15:00 / 15:30 / 16:00
 *  on one room is a MENU — see `boardOffers` in capacity-ledger for the whole
 *  distinction.
 *
 *  THE CEILING ON THE ROOM RULE, stated rather than denied (⚖ R4 fix round —
 *  this comment used to claim "a re-bedding can never hand two people the same
 *  room for the same hour", which is true PER SLOT only). `taken` is minted
 *  inside the per-slot loop, exactly as canon mints `claimed` inside its own
 *  (availability.ts:117), while `SELL_SLOT_MIN` is fixed at 60. So at `gridMin`
 *  30 a re-bedded 15:30 offer can land on a room a surviving 15:00 offer still
 *  holds, and the two overlap. That is the OPTION side of the distinction above
 *  and it is legal: both are alternatives on one room's menu, and one booking
 *  takes the menu away. What the cap really guarantees is the per-slot form —
 *  within ONE slot the rooms are distinct — and that is the whole of it. */
function reconcileSellCells(cells: SellCell[], lanes: BoardLane[], input: SellReconcile): SellCell[] {
  /** The gap layer emits every box twice — once for the staff row, once for the
   *  bed row — so the pair collapses to one promise before anything is judged. */
  // ⚖ 75(i) — the claim's OWN LANE rides along. It was already on the `GapCell`
  // being read and was dropped on the way into this map; the rider needs it to
  // name who kept the room, and re-finding it afterwards would mean matching a
  // promise back to a claim by its span — a second lookup that can miss.
  const promises = new Map<string, Array<{ resourceKey: string; laneKey: string; start: number; end: number }>>()
  for (const c of input.claims) {
    if (c.resourceKey === '') continue
    const held = promises.get(c.resourceKey) ?? []
    if (held.some((p) => p.start === c.s && p.end === c.e)) continue
    held.push({ resourceKey: c.resourceKey, laneKey: c.laneKey, start: c.s, end: c.e })
    promises.set(c.resourceKey, held)
  }
  // ⚖ R4 fix round — THE CLAIMS, not the rooms they name. The lane test below
  // needs no room, so the early return has to mean "nothing was promised at
  // all"; `promises.size` would also be 0 for a claim list carrying no rooms,
  // and returning there would skip the lane half. (Canon's own emission always
  // carries a room — `bedLedger` returns a lane or nothing, availability.ts:372
  // — so on a real board the two conditions agree.)
  if (input.claims.length === 0) return cells

  /** ⚖ flag 77's dial, read the way the render path has to read it: a value
   *  that is not a number of minutes DEGRADES to a bare room rather than
   *  throwing. `ClaimsBook.violations` throws on the same input on purpose — it
   *  is an assertion surface and a caller bug should be loud there — but this
   *  runs while the board is drawing itself, with no error boundary under it. */
  const turnaround = (resourceKey: string) => {
    if (!Object.hasOwn(input.cleanupMinutesByBed, resourceKey)) return 0
    const held = input.cleanupMinutesByBed[resourceKey]
    return typeof held === 'number' && Number.isFinite(held) ? Math.max(0, held) : 0
  }

  /** A room is unavailable to this offer when a promise on it overlaps the span
   *  OR sits closer to it than the room's own turnaround — and when the rule
   *  says that promise is the one that keeps the room. */
  const promisedBy = (resourceKey: string, cell: SellCell) => {
    const held = promises.get(resourceKey)
    if (!held) return null
    const pad = turnaround(resourceKey)
    return (
      held.find(
        (p) => p.end + pad > cell.h && p.start - pad < cell.h + SELL_SLOT_MIN && keepsTheRoom() === 'gap',
      ) ?? null
    )
  }
  // ⚖ 75(i) — the same test, still the only one anything branches on. `some` →
  // `find` → `!== null` is the identical predicate on the identical list; the
  // WINNER is now kept instead of thrown away, and only the collector reads it.
  const promised = (resourceKey: string, cell: SellCell) => promisedBy(resourceKey, cell) !== null

  /** ⚖ R4 fix round — THE SAME PERSON IS A COLLISION TOO, and the filter this
   *  round deleted was saying so. `renderLane`'s suppression did TWO jobs at
   *  once: on a BED row it compared `resourceKey`, and on a STAFF row it
   *  compared `laneKey` — the same person. R4 moved the room half here and
   *  dropped the lane half, and re-bedding then RESURRECTED the very cells the
   *  old filter used to kill: an offer losing its room to a 詰め込み box on its
   *  OWN row found another free room and survived, advertising one staff member
   *  on two rooms at the same minute (blind round B1).
   *
   *  A LANE COLLISION IS A DROP, NEVER A RE-BED. Solving the room does not make
   *  the person free — they are already inside the box. Re-bedding is only ever
   *  right for a CROSS-row collision, where the person is fine and the room is
   *  the only thing taken.
   *
   *  NO TURNAROUND PAD ON THIS TEST, deliberately: turnaround is a property of a
   *  ROOM (how long it takes to turn one over), not of a person, and the old
   *  filter used plain overlap. Parity with what it did, and nothing more.
   *
   *  Read off `input.claims` rather than `promises`: this asks about a LANE, and
   *  the room-keyed collapse above has already dropped every room-less box. Both
   *  emissions of a box carry the staff `laneKey` (availability.ts:372-373), so
   *  the pair matching twice is the same answer twice. */
  const busyLane = (cell: SellCell) =>
    input.claims.some((g) => g.laneKey === cell.laneKey && g.s < cell.h + SELL_SLOT_MIN && cell.h < g.e)

  const storesOf = new Map(lanes.filter((l) => l.group === 'staff').map((l) => [l.key, l.stores]))

  /** ONE OFFER, TWO CELLS. canon pushes a staff-row cell and a bed-row cell per
   *  window (availability :126-134); they are one advertisement and they move or
   *  go together. */
  const offerKey = (c: SellCell) => `${c.laneKey}|${c.h}`
  const decisions = new Map<string, { resourceKey: string; bed: string } | null>()
  const bySlot = new Map<number, SellCell[]>()
  for (const c of cells) {
    if (c.group !== 'staff' || c.resourceKey === '') continue
    const held = bySlot.get(c.h)
    if (held) held.push(c)
    else bySlot.set(c.h, [c])
  }

  for (const [, slot] of bySlot) {
    const losers: SellCell[] = []
    // canon's per-slot cap, carried forward: the rooms the survivors hold are
    // spoken for, and a re-bedding may not take one of them.
    const taken = new Set<string>()
    for (const c of slot) {
      // The lane test FIRST, and it is terminal: a person already inside a
      // promise has no free room to be moved to, so the offer goes and its room
      // is left free for somebody else's loser to land on.
      if (busyLane(c)) {
        decisions.set(offerKey(c), null)
        input.onDrop?.({ laneKey: c.laneKey, h: c.h, kind: 'lane' })
      } else if (promised(c.resourceKey, c)) losers.push(c)
      else taken.add(c.resourceKey)
    }
    for (const c of losers) {
      const stores = storesOf.get(c.laneKey) ?? null
      const offer = lanes.filter((l) => l.group !== 'beds' || !(taken.has(l.key) || promised(l.key, c)))
      const found = allocateBed(offer, {
        id: null,
        currentBed: null,
        stores,
        // ⚖ ROOM RULE — a hypothetical never needs the private room. A window is
        // an advertisement, not a booking: there is no booking to carry a
        // 個室のみ tag, so the offer takes a standard room first like anyone else.
        requiresPrivate: false,
        start: c.h,
        end: c.h + SELL_SLOT_MIN,
      })
      if (found.laneKey === null) {
        decisions.set(offerKey(c), null)
        // The room this offer lost, and to whom. Read from the SAME `promisedBy`
        // the loser was selected by, so the taker named here is by construction
        // the promise that took the room — never a second guess at it.
        input.onDrop?.({ laneKey: c.laneKey, h: c.h, kind: 'room', takerLaneKey: promisedBy(c.resourceKey, c)?.laneKey })
        continue
      }
      taken.add(found.laneKey)
      decisions.set(offerKey(c), {
        resourceKey: found.laneKey,
        bed: lanes.find((l) => l.key === found.laneKey)?.label ?? '',
      })
    }
  }

  if (decisions.size === 0) return cells
  // Rebuilt in canon's own emission order, so a board with nothing to reconcile
  // comes out of here byte-identical to the one that went in.
  const out: SellCell[] = []
  for (const c of cells) {
    if (!decisions.has(offerKey(c))) {
      out.push(c)
      continue
    }
    const moved = decisions.get(offerKey(c))
    if (moved == null) continue
    out.push({ ...c, resourceKey: moved.resourceKey, bed: moved.bed })
  }
  return out
}

/** The 販売可能枠 layer for the board as it currently stands. Derived here, in
 *  the browser, so a drag in progress moves the windows with it. */
export function sellLayerFor(
  lanes: BoardLane[],
  hours: Hours,
  opts: {
    gridMin: number
    nowMinute: number | null
    locked: string[]
    showPrice: boolean
    hi: number
    hqMin: number
    depth: number
    /** ⚖ R4 — the other layer's finished promises. See `SellReconcile`. */
    reconcile?: SellReconcile
    /** ⚖ SPEC-SELLING-ENGINE §4.2 Q4 — the held set for THIS world. Absent =
     *  the round gate is off and the layer is byte-identical to today's. */
    held?: readonly ReservedLaneMask[]
  },
): SellLayer {
  const staffLanes = sellStaffLanes(lanes, opts.locked)
  const resourceLanes = sellResourceLanes(lanes)
  const raw = deriveSellableCells({
    staffLanes,
    resourceLanes,
    open: hours.open,
    close: hours.close,
    gridMin: opts.gridMin,
    now: opts.nowMinute,
    priceFor: (lane, hour) => priceAt(lane.listPrice, hour, opts.hi, opts.hqMin, opts.depth),
  })
  // ⚖ R4 — BEFORE `buildSellLayer`, never after and never in the renderer: the
  // bands, the density verdict and 「販売可能枠 N窓」 are all computed from these
  // cells, and a layer built from boxes the screen then declines to draw is a
  // board that counts what it does not show.
  const cells = opts.reconcile ? reconcileSellCells(raw, lanes, opts.reconcile) : raw
  // ⚖ Q4 — TAGGED, NOT WITHHELD, and the difference is the whole ruling. A
  // standard hour inside a held window is exactly what a rank-opened store or a
  // release sells, so it stays derived and the layer keeps counting it; what it
  // may not do is reach a regular customer's online feed. That filter is the
  // offer feed's (§8) and the paint is E3b's — this seam only computes the fact.
  return buildSellLayer(opts.held ? tagHeldBound(cells, opts.held) : cells, opts.showPrice)
}

/** ⚖ SPEC-SELLING-ENGINE §4.2 Q4 — AN ADVERTISED HOUR THAT LIES INSIDE A 新規用に
 *  確保 WINDOW, said on the cell rather than re-derived by whoever asks.
 *
 *  It rides through `buildSellLayer` because canon's own tiering pass copies
 *  each cell (`cells.map((c) => ({ ...c, tier }))`, availability.ts:206), so the
 *  layer's `cells` carry it without canon knowing the field exists — which is
 *  what keeps this app-side and canon frozen. Read it through `isHeldBound`;
 *  never test the property by hand. */
export interface HeldBoundSellCell extends SellCell {
  readonly heldBound: true
}

/** The one reader. `SellCell` is canon's type and cannot grow a field, so the
 *  tag is structurally invisible to the type — one narrow door beats every
 *  consumer writing its own cast. */
export const isHeldBound = (c: SellCell): boolean => (c as { heldBound?: unknown }).heldBound === true

/** ⚖ SPEC-SELLING-ENGINE §4.2 Q4 + §1's withholding clause (E3b, THE FLIP) —
 *  WHAT THE BOARD PUBLISHES, as opposed to what it derived.
 *
 *  Q4 is「inside a held window ALL online sale to regular customers is withheld」
 *  — the dynamic crumbs (already gone, masked out of the gap layer's input
 *  space upstream) AND the standard full-price hours. The hours are still
 *  DERIVED, because a rank-opened store or a release sells exactly those
 *  (`isHeldBound` is the mark, and §6's rank dial is the reader that has not
 *  been built); what they may not do is reach a regular customer, be counted as
 *  purchasable, or be painted.
 *
 *  ⚖ R4's OWN LESSON, OBEYED. The reconcile moved out of the renderer in R4
 *  precisely because 公開中 N枠 / 販売可能枠 N窓 / the 運営影響 stat and the 公開価格
 *  button were counting boxes the paint then declined to draw. Withholding at
 *  the RENDERER would rebuild that defect one law along, so it happens to the
 *  LAYER: every surface that reads the layer stays honest for free, both rows
 *  together (a sell offer's staff-row and bed-row copies carry the same staff
 *  `laneKey`, so the pair is tagged together and drops together).
 *
 *  IDENTITY WHEN NOTHING IS HELD. No tagged cell ⇒ the very same object comes
 *  back, so a guard-off store and the gated-off path are byte-identical to
 *  today's board by construction rather than by a branch somebody maintains.
 *
 *  ⚠ THE TIERS ARE RE-ZONED, deliberately. `buildSellLayer` reads its min/max
 *  off the cells it is given, and `--tier` is a RELATIVE band ("this hour is
 *  dear for today"), so re-zoning over what is actually on sale is the honest
 *  answer — a tier computed against hours no customer can buy would describe a
 *  price range the board is not offering. */
export function sellDrawnFor(layer: SellLayer, showPrice: boolean): SellLayer {
  const published = layer.cells.filter((c) => !isHeldBound(c))
  return published.length === layer.cells.length ? layer : buildSellLayer(published, showPrice)
}

/** ⚖ FIX ROUND F3 (blind-final L1#2) — THE MASK AS THE SALES DOOR MAY PUBLISH
 *  IT: the held set minus every lane the SELL door refuses outright.
 *
 *  The rule was already written on the board — 「a 確保 chip on a row that sells
 *  nothing online would be the only kind of offer still standing there, and the
 *  counter would be counting a window that is not for sale to anybody」 — and it
 *  was enforced against ONE of the two ways a lane can sell nothing. A locked
 *  lane was filtered; a lane with no list price was not, and `listPrice` is
 *  `staffListPrice[member.id] ?? 0` (today-board.ts), so a real store hits it
 *  the first time a manager adds a member without setting their price. That
 *  lane has no sell layer and no gap layer at all — `sellStaffLanes` drops it —
 *  yet it drew a chip whose own sub-line said 「オンラインで新規のお客様に販売中」.
 *
 *  ONE SPELLING, which is why this reads the answer out of `sellStaffLanes`
 *  rather than repeating `listPrice > 0` here: the sales door publishes exactly
 *  what the sell door would sell, and a future condition on one is a condition
 *  on both by construction. The `locked` half stays visible in the same
 *  expression (the function flags rather than drops them) so §9's ruled reason
 *  for it is still readable at the site that acts on it.
 *
 *  The STAFF door's mask is deliberately NOT filtered this way (`heldBoard`
 *  stays whole): the guard protects placements whatever a lane charges, and
 *  that asymmetry is the law, not an oversight. */
export function heldDrawnFor(
  held: readonly ReservedLaneMask[] | undefined,
  lanes: BoardLane[],
  locked: string[],
): readonly ReservedLaneMask[] {
  const sellable = new Set(sellStaffLanes(lanes, locked).filter((l) => !l.locked).map((l) => l.key))
  return (held ?? []).filter((m) => sellable.has(m.laneKey))
}

function tagHeldBound(cells: SellCell[], held: readonly ReservedLaneMask[]): SellCell[] {
  const byLane = heldByLane(held)
  return cells.map((c) => {
    // Both emissions of one offer carry the STAFF lane key (availability.ts
    // :126-134), so the pair is tagged together and the bed row can never
    // disagree with the row it is drawn under.
    if (!insideHeld(byLane.get(c.laneKey), c.h, c.h + SELL_SLOT_MIN)) return c
    const tagged: HeldBoundSellCell = { ...c, heldBound: true }
    return tagged
  })
}

/** ⚖ SPEC-SELLING-ENGINE §8, RULED BY LIAM 8/30 (§13 Q3 — 「one number」) —
 *  WHAT IS ON SALE ONLINE RIGHT NOW, counted ONCE, in one place.
 *
 *  The counter used to be canon's `buildSellLayer().chipLabel`, which counts the
 *  sell layer and NOTHING ELSE — so 詰め込み and スキマ枠 boxes, which a customer
 *  can buy in Reserve exactly like a standard hour, were on the board and
 *  outside the number. That was a lie before this round and the ruling names the
 *  truth: ONE number for everything purchasable online under the law, with the
 *  breakdown by KIND a press away. Canon's own label is untouched — the count
 *  changes because the DEFINITION did, and the definition lives here, app-side,
 *  where the board composes the four kinds.
 *
 *  ⚖ Q4 + §6's RANK DIAL — the held-bound hours are NOT here, and the reason is
 *  a dial rather than an omission: inside a held window the standard slots are
 *  withheld from regular customers, and only a store that OPENS them to a
 *  customer rank (§6's per-store dial, DEFAULT CLOSED, not yet built) puts them
 *  back on sale. `sell` arrives already published (`sellDrawnFor`), so they are
 *  gone by construction. When the rank dial lands it counts them back — as a
 *  fifth group marked rank-limited, per §8's counter-honesty clause — and this
 *  is the line that will say so.
 *
 *  The reserved windows ARE counted: a held window is not dead space, it is the
 *  whole protected session offered to a 新規 (spec §1's closing clause), so it
 *  is on sale — to someone — and the ruling counts what is on sale. */
export type OnlineKind = 'sell' | 'packed' | 'gap' | 'reserved'

/** One line of the press-open list: the span, whose row it is on, and its price
 *  if it has one. A 新規用に確保 window has none — it is priced at take, out of
 *  the store's own session price (see `ReservedOffer`). */
export interface OnlineRow {
  readonly kind: OnlineKind
  readonly laneKey: string
  readonly staff: string
  readonly start: number
  readonly end: number
  readonly lo: number | null
  readonly hi: number | null
}

export interface OnlineGroup {
  readonly kind: OnlineKind
  /** The board's OWN word for the kind — the same three 案C name tags the boxes
   *  wear, plus §9's ruled 確保 wording. No fifth vocabulary for one thing. */
  readonly label: string
  readonly rows: readonly OnlineRow[]
}

export interface OnlineCounter {
  readonly groups: readonly OnlineGroup[]
  readonly total: number
  /** canon's own chip grammar (`buildSellLayer`, availability.ts:218): 窓, a
   *  spaced 「 · 」, and `priceLabel`'s single-price-or-「〜」 form. */
  readonly label: string
}

export function onlineOffers(input: {
  /** The PUBLISHED sell layer's staff bands (`sellDrawnFor`, held-bound gone). */
  sell: readonly SellBand[]
  /** …and the gap layer AS DRAWN — the §5 fallback's additions included. */
  packed: readonly GapCell[]
  scraps: readonly GapCell[]
  /** ⚖ FIX ROUND F4 (blind-final L1#4 ≡ L2#8) — §4.5's OWN EMISSION, not the
   *  mask a second time.
   *
   *  This used to take the mask and build reserved rows out of it inline, while
   *  `reservedOffersFor` — the named §4.5 adapter, the thing §11's invariant
   *  (iv) is proven against — sat beside it with zero readers. Two emission
   *  homes for one kind, disagreeing by exactly the lanes the publication
   *  filter removes, and the invariant was being proven on the one the screen
   *  never read. ONE home now: the screen emits through the adapter and hands
   *  the result here, so 「reserved offers ≡ held windows」 is a statement about
   *  the rows the operator is actually counting. */
  reserved: readonly ReservedOffer[]
  lanes: readonly BoardLane[]
  showPrice: boolean
}): OnlineCounter {
  // The staff row is the offer; the bed row is the same offer drawn a second
  // time (availability.ts:126-134), and the board has counted it once since R4.
  const onStaff = <T extends { group: string }>(c: T) => c.group === 'staff'
  const gapRows = (cells: readonly GapCell[], kind: OnlineKind): OnlineRow[] =>
    cells
      .filter(onStaff)
      .map((c) => ({ kind, laneKey: c.laneKey, staff: c.staff, start: c.s, end: c.e, lo: c.price, hi: c.price }))
  const labelOf = new Map(input.lanes.map((l) => [l.key, l.label]))
  const groups: OnlineGroup[] = [
    {
      kind: 'sell',
      label: '販売可能枠',
      rows: input.sell
        .filter(onStaff)
        .map((b) => ({ kind: 'sell' as const, laneKey: b.laneKey, staff: b.staff, start: b.hStart, end: b.hEnd, lo: b.lo, hi: b.hi })),
    },
    { kind: 'packed', label: '詰め込み', rows: gapRows(input.packed, 'packed') },
    { kind: 'gap', label: 'スキマ枠', rows: gapRows(input.scraps, 'gap') },
    {
      kind: 'reserved',
      label: '新規用に確保',
      rows: input.reserved.map((o) => ({
        kind: 'reserved' as const,
        laneKey: o.laneKey,
        staff: labelOf.get(o.laneKey) ?? o.laneKey,
        start: o.start,
        end: o.end,
        lo: null,
        hi: null,
      })),
    },
  ]
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  // Both ends of every row, so a merged band's spread is the chip's spread —
  // canon reads its min/max off the CELLS and a band's `lo`/`hi` are exactly
  // those, collapsed (availability.ts:165-172).
  const priced = groups.flatMap((g) => g.rows.flatMap((r) => [r.lo, r.hi])).filter((p): p is number => p != null)
  const withPrice = input.showPrice && priced.length > 0
  return {
    groups,
    total,
    label: `オンライン販売中 ${total}窓${withPrice ? ` · ${priceLabel(Math.min(...priced), Math.max(...priced))}` : ''}`,
  }
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
 *  own, and summing rounded pieces charges the rounding remainder twice.
 *
 *  ⚖ R6 fix round D1 — EXPORTED, because there are TWO producers now and only
 *  one of them was merging. The fragment fallback emits through the same canon
 *  function and then applies the same display floor, so an un-merged pair there
 *  meets a floor written for merged runs: canon hands a menu-exact 50-minute
 *  residue back as [30, 20], and the floor deletes the 20 the native layer
 *  would have kept inside a 50-minute box. Generic over the cell so the
 *  fallback's provenance fields ride through the merge rather than being cast
 *  back on afterwards. */
export function combineCrumbs<T extends GapCell>(
  cells: readonly T[],
  sessionMin: number,
  priceUnion: (laneKey: string, s: number, e: number) => number,
): T[] {
  const out: T[] = []
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
      out[at] = { ...prev, e: c.e, price: priceUnion(prev.laneKey, prev.s, c.e) } as T
      continue
    }
    lastOfRun.set(runKey, out.length)
    out.push(c)
  }
  return out
}

/** EVERY DIAL THE PACKING ENGINE TAKES, spelled ONCE.
 *
 *  ⚖ SPEC-SELLING-ENGINE §5 — the fragment fallback calls the same UNCHANGED
 *  `deriveGapPackingCells` with a clipped input lane, so it needs the identical
 *  bundle: the same guard engine's `fillableExactly`/`fillDecomposition`, the
 *  same two price closures over the same frame and depth. Re-spelling them at
 *  the screen would be a second pricing home, and two homes for one price is
 *  how a fallback box comes to cost something the layer above it does not.
 *
 *  So `gapLayerFor` derives them here and the fallback pass is handed the very
 *  same function's answer. The lane list is the argument because `listPrice` is
 *  a BoardLane fact and canon's `SellStaffLane` carries it separately. */
export function gapPackingDials(
  lanes: BoardLane[],
  opts: {
    gridMin: number
    sessionMin: number
    gapFillMin: number
    gapFillDiscountPct: number
    nowMinute: number | null
    frame: PriceFrame
    depth: number
    guard: GuardConfig
  },
): Omit<GapPackingInput, 'staffLanes' | 'resourceLanes'> {
  const engine = createGapGuard(opts.guard)
  const byKey = new Map(lanes.map((l) => [l.key, l]))
  const listOf = (lane: SellStaffLane) => byKey.get(lane.key)?.listPrice ?? 0
  return {
    gridMin: opts.gridMin,
    sessionMin: opts.sessionMin,
    gapFillMin: opts.gapFillMin,
    now: opts.nowMinute,
    fillableExactly: engine.fillableExactly,
    fillDecomposition: engine.fillDecomposition,
    packedPrice: (lane, s, e) => packedPrice(listOf(lane), s, e, opts.frame, opts.depth),
    gapFillPrice: (lane, s, e) => gapFillPrice(listOf(lane), s, e, opts.frame, opts.depth, opts.gapFillDiscountPct),
  }
}

/** ⚖ R6 B3 (plan R6, perf F11) — WHICH KIND OF BOX THIS IS, SAID ON THE CELL
 *  rather than re-derived by whoever draws it.
 *
 *  The renderer used to ask `gapDrawn.packed.includes(c)` (TodayScreen :5252,
 *  and again for the React key and the 名前タグ): an O(n) scan per cell per
 *  frame whose answer is OBJECT IDENTITY. The day any pass copies a cell on its
 *  way to the screen — a spread for a tag, a sort into a new array, a memo that
 *  re-freezes — every 詰め込み box silently becomes a スキマ枠: wrong wash, wrong
 *  word, wrong price format, and nothing anywhere to fail. The kind is a fact
 *  about the box, so it is written ON the box, at BOTH producers, at creation,
 *  which also keeps one object identity for every downstream consumer.
 *
 *  Canon's `GapCell` cannot grow a field, so this is `HeldBoundSellCell`'s exact
 *  pattern (:1137-1144): an app-side interface the tag rides in, and ONE narrow
 *  reader. Never test the property by hand. */
export interface KindedGapCell extends GapCell {
  readonly gapKind: 'packed' | 'scrap'
}

/** The one reader. An untagged cell reads as 'scrap' — the same answer
 *  `.includes` gave for anything not in `packed` — so a cell from some future
 *  producer that has not been taught to tag degrades exactly as it did before
 *  rather than into a shape nobody has drawn. */
export const gapKindOf = (c: GapCell): 'packed' | 'scrap' =>
  (c as { gapKind?: unknown }).gapKind === 'packed' ? 'packed' : 'scrap'

const kinded =
  (gapKind: 'packed' | 'scrap') =>
  (c: GapCell): KindedGapCell => ({ ...c, gapKind })

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
    /** ⚖ SPEC-SELLING-ENGINE §4.1 — the held set for THIS world, applied
     *  UPSTREAM (see `withheld` below). Absent = the round gate is off and the
     *  layer is byte-identical to today's. */
    held?: readonly ReservedLaneMask[]
  },
): { packed: GapCell[]; scraps: GapCell[] } {
  const byKey = new Map(lanes.map((l) => [l.key, l]))
  const priceUnion = (laneKey: string, s: number, e: number) =>
    packedPrice(byKey.get(laneKey)?.listPrice ?? 0, s, e, opts.frame, opts.depth)
  /** ⚖ SPEC-SELLING-ENGINE §4.1, council-corrected — CAPACITY PROTECTION IS
   *  PRICE-FREE AND SITS UPSTREAM OF EMISSION. A downstream filter would have to
   *  drop boxes the reconcile had already priced and re-bedded, which re-opens
   *  R4's double-claim class one layer down; masking the INPUT SPACE cannot,
   *  because a held minute is simply never a candidate.
   *
   *  The mask is spelled as OCCUPANCY, which is the only vocabulary
   *  `deriveGapPackingCells` has for "this minute is not yours": it cuts its
   *  pockets out of `lane.occupied` (availability.ts:429) exactly as the rail
   *  does. A held span is NOT a break — no `isBreak` — so it walls nothing and a
   *  residue beside it stays the loss it really is. */
  const staffLanes = sellStaffLanes(lanes, opts.locked)
  const held = opts.held ? heldByLane(opts.held) : null
  const withheld = held
    ? staffLanes.map((l) => {
        const spans = held.get(l.key)
        return spans && spans.length > 0
          ? { ...l, occupied: [...l.occupied, ...spans.map((h) => ({ start: h.start, end: h.end }))] }
          : l
      })
    : staffLanes
  const raw = deriveGapPackingCells({
    ...gapPackingDials(lanes, opts),
    staffLanes: withheld,
    resourceLanes: sellResourceLanes(lanes),
  })
  const floor = opts.minSellableMin ?? 0
  const sellable = (c: GapCell) => c.e - c.s >= floor
  // ⚖ R6 B3 — TAGGED AT THE RETURN, which IS creation for everything downstream:
  // `combineCrumbs` mints new objects and the floor throws some away, so tagging
  // any earlier would tag boxes the board never draws and leave the survivors of
  // a merge untagged. These objects are the ones `gapClaims`, the reconcile, the
  // fallback's survivor set and the renderer all hold.
  return {
    packed: combineCrumbs(raw.packed, opts.sessionMin, priceUnion).filter(sellable).map(kinded('packed')),
    scraps: raw.scraps.filter(sellable).map(kinded('scrap')),
  }
}

// ── スキマガードの配置ガイド ────────────────────────────────────────────────

export type RailState = 'safe' | 'degraded' | 'blocked'

/** ⚖ LIAM flag 44 (2026-08-21, restated 2026-08-26) — WHICH KIND OF BLOCKER,
 *  as a field rather than as a sentence the surface would have to read back.
 *
 *  The chip already carried the WHY in prose; nothing carried the CLASS, so a
 *  display that wants to say 満室 in ten grey pixels had to match on the
 *  sentence — flag 54's disease one level down (two readings of one answer,
 *  free to disagree the day the wording is passed again, which is exactly what
 *  the 8/25 native pass did to this file's other sentences).
 *
 *  THREE CLASSES, and they are the branches `railCell` already has:
 *    · `fit`   — no pocket holds the session at this start. The blocker is
 *                DRAWN on the row (a booking, a 予定ブロック, a shift wall), so
 *                the operator can already see it.
 *    · `bed`   — the pocket held and the ROOM did not (`R-UNAVAILABLE`, which
 *                the engine only ever emits when a `placementFeasible` callback
 *                answered false: gap-guard :272/:347/:370). Invisible on this
 *                row — the rooms are somewhere else entirely.
 *    · `guard` — the guard is protecting the 新規 window (`R-REP`/`R-DEAD`/
 *                `R-SALV`). Also invisible: it is a rule, not a card.
 *
 *  `null` on a start that was not refused. `EXEMPT` never reaches here — it
 *  arrives as `verdict: 'exempt'` and the safe branch answers it first. */
export type RailReason = 'fit' | 'bed' | 'guard'

export interface RailCell {
  start: number
  state: RailState
  /** canon `paintRailCell` (:7500): ✓HH:MM / △HH:MM / —. */
  label: string
  /** What this start actually does to the protected window, in canon's words. */
  sentence: string
  /** ⚖ 44 — the class of blocker, `null` when nothing blocked. See `RailReason`. */
  reason: RailReason | null
  /** The engine's feasible alternatives, when it refused this start. */
  alternatives: number[]
  alternativeKind: 'safe' | 'least-loss' | null
  /** canon's `ackAllowed`: standard mode lets the 操作者 place anyway. */
  ackAllowed: boolean
  /** ⚖ LIAM flag 92 (2026-08-31) — THE FACT UNDER THE SENTENCE, for the warn
   *  card's impact panel.
   *
   *  `sentence` is the ENGINE'S OWN WORDS and stays that (⚖ GAP-6/FIX-6 bind
   *  the check rows to it, byte-untouched). The warn card is the ⚖-approved NEW
   *  surface and says the consequence in its own approved shape — so it needs
   *  the DATA, not the prose, and the alternative would be string-editing the
   *  engine's sentence back into numbers: flag 54's disease, one layer down.
   *
   *  Only `railCell` sets it, at the two branches where the engine has actually
   *  weighed the protected window (`degraded`, and a guard refusal); every other
   *  cell leaves it absent, which is the honest answer for a cell that never
   *  reached the capacity question. `code` is the engine's own class, carried
   *  rather than re-derived from the words.
   *
   *  ⚖ 92 fix round 5 V1 (breaker #4) — AND THE WINDOWS THEMSELVES, not only how
   *  many there were. The card's ¥ used to be its own arithmetic (定価 × the
   *  protected length × the loss count), which is a SECOND BASIS for a question
   *  the board already answers through canon's pricing door — proven −23%..+10%
   *  off the figure the very same screen prints for the very same minutes. The
   *  engine has always carried the window STARTS (gap-guard :84-85, its own
   *  `.slice()` copies), so carrying them here lets the composer ask canon what
   *  those exact spans are worth instead of inventing a price for them.
   *
   *  BOTH SETS, never a pre-computed difference: the after-set is re-solved by
   *  the same earliest-finish greedy with the placement excluded, so its starts
   *  can SHIFT rather than being a subset (a 10:00 landing on a free day turns
   *  [10:00, 11:30, 13:00, …] into [11:00, 12:30, 14:00, …] — six starts in
   *  「before」 and none of them in 「after」, for a loss of exactly one). What the
   *  store loses is therefore the difference of the two sets' VALUE, and only
   *  the two sets can answer that. Same `GuardResult`, same expression as the
   *  counts above, so the pair can never disagree with them. */
  impact?: {
    code: GuardReason['code']
    capacityBefore: number
    capacityAfter: number
    windowsBefore: number[]
    windowsAfter: number[]
  }
}

export interface GuardRail {
  laneKey: string
  laneLabel: string
  cells: RailCell[]
}

const clockOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** ⚖ Liam 2026-08-30 — THE GUARD PRESS NAMES *WHERE* THE PROTECTED WINDOW IS.
 *
 *  Both sentences below used to say only HOW MANY 新規 windows a start keeps or
 *  costs. An operator who wanted to know which minutes were being protected had
 *  to rebuild the stretch by hand off the rail's marks — and a 60 + a 30 read as
 *  one composite 90 that the engine never counted. The board is already holding
 *  the starts, so it says them out loud:
 *  「17:30〜19:00の新規90分の空きを守れます」.
 *
 *  THIS FUNCTION ONLY FORMATS A LIST. Which list is the caller's decision, and
 *  each of the three callers inside `railCell` makes a different one: the safe
 *  ✓ site hands it the windows that SURVIVE the drop (`protectedWindowsAfter`),
 *  because 「守れます」 is a promise about what is still there after the card
 *  goes down, never about what was there before it. The degraded △ site and the
 *  window-refusal hand it the windows the placement EATS instead
 *  (`windowsEatenBy`'s result), whose own comment explains why a
 *  before-minus-after difference names the wrong set. This function never
 *  chooses between them.
 *
 *  Three named, the remainder folded as 「、ほかN件」 — a 読点 closes the named
 *  list before the count, so a skimming eye doesn't run the last window straight
 *  into the fold (JP-NATIVE-PASS-R8-PR2-007c81b9.md §D). 件 rather than 枠,
 *  because 枠 is already carrying the loss count in the same sentence and two
 *  different 「N枠」 in one line collide. Empty list → '' and the caller keeps
 *  the sentence it shipped with; the de-duplicating sort is defensive only, the
 *  engine emits ascending unique starts (gap-guard's own `.slice()` copy of its
 *  window list).
 */
export function protectedWindowsClause(starts: readonly number[], protectedDur: number): string {
  const windows = [...new Set(starts)].sort((a, b) => a - b)
  if (windows.length === 0) return ''
  const named = windows.slice(0, 3).map((s) => `${clockOf(s)}〜${clockOf(s + protectedDur)}`).join('・')
  return windows.length > 3 ? `${named}、ほか${windows.length - 3}件` : named
}

/** ⚖ 90 — WHICH of the protected windows THIS placement eats.
 *
 *  Two of the three sentences name the windows the drop costs, and neither may
 *  take the before-set minus the after-set to find them: the engine RE-TILES the
 *  pocket with the placement excluded, so the after-set's starts shift rather
 *  than dropping out (a 10:00 landing on an open lane turns [10:00, 11:30, …]
 *  into [11:00, 12:30, …] — every start differs, for a loss of exactly one), and
 *  a set difference would name every window on the lane for a one-window loss.
 *
 *  The honest question is the one canon itself asks when it re-tiles: does this
 *  window overlap the span being placed (gap-guard :199, its private `overlaps`
 *  at :187-188). Same predicate, spelled here because canon's is not exported —
 *  half-open on both sides, so a window that ENDS exactly where the placement
 *  begins, or BEGINS exactly where it ends, is untouched and is not named.
 *
 *  Order and duplicates are left exactly as given; `protectedWindowsClause` is
 *  the one place that sorts and de-duplicates. */
export function windowsEatenBy(
  windows: readonly number[],
  protectedDur: number,
  start: number,
  dur: number,
): number[] {
  return windows.filter((s) => s < start + dur && s + protectedDur > start)
}

/** canon `reasonLine` (:7092). The engine's refusal, said out loud.
 *
 *  ⚖ Liam 8/30 (flag 90) — `windows` is the ONE addition, and only the R-REP
 *  branch reads it: 「ここに置くと17:30〜19:00の新規（90分）が入らなくなります」.
 *  It defaults to '' so every existing two-argument call — canon's parity
 *  contract, and the rail's own R-UNAVAILABLE call — returns the identical
 *  string it always did.
 *
 *  THE CALLER DECIDES, not this function. R-REP wears two shapes: a lost
 *  PROTECTED window (`params.capacityLost > 0`, label 「新規（90分）」) and a
 *  SERVICE that no longer fits (label 「整体60」, gap-guard `reasonForKey`'s
 *  `key[0]`/`key[1]` branches — :327-338). Only the
 *  first is a window and only the first may be given a clause, and the thing
 *  that knows which is the composer holding the verdict — so `railCell` passes
 *  '' for the other. */
export function reasonLine(reason: GuardReason | undefined, protectedDur: number, windows = ''): string {
  if (!reason) return '配置できません'
  const p = reason.params as Record<string, number | string>
  switch (reason.code) {
    case 'R-REP': return `ここに置くと${windows ? `${windows}の` : ''}${p.label}が入らなくなります`
    case 'R-DEAD': return `ここに置くと${p.n}分の売れない空きが残ります`
    case 'R-SALV': return `ここに置くと${p.n}分の割引でしか売れない空きが残ります`
    case 'R-UNAVAILABLE': return `この開始には既存${p.dur}分を配置できません`
    case 'EXEMPT': return `端は${wallJa(String(p.wallType ?? ''), p.trigger === 'wall')}に接するため空きになりません`
    /** ⚖ Liam 8/30 (flag 90) — THIS BRANCH IS UNREACHABLE FROM THE BOARD, which
     *  is why it alone names no windows while the rail's three other sentences
     *  do. Its `params` carry the counts and the least-loss minute and never the
     *  spans, and the `windows` argument above is the R-REP branch's alone —
     *  there is nothing honest to give this one.
     *
     *  It cannot be reached: canon mints `code: 'DEGRADED'` only in the block
     *  that has just set `verdict = 'degraded'` (gap-guard :407 + :411), and
     *  `railCell` answers `v.verdict === 'degraded'` with its own sentence and
     *  RETURNS before the fallthrough that calls `reasonLine` for a refusal.
     *  The rail's other call sits under `R-UNAVAILABLE`. `reasonLine` has no
     *  caller outside `railCell`.
     *
     *  It stays anyway: it is a straight transplant of canon's own reason line
     *  (parity is its reason to exist) and the unit contract pins its shape. */
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
  /** ⚖ LIAM flag 76 (2026-08-23) — THE RAIL HEARS ABOUT THE ROOMS.
   *
   *  Canon builds the engine's ctx per lane and puts a bed-checking callback in
   *  it (`ctxFor(day, lane)` → `placementFeasible(lane, start, dur, day)` →
   *  `bedFreeFor`, fable-store-today.html :7278-7285 / :7256-7261), and the rail
   *  runs through that same evaluator (`railAimFor` = `evaluateExactAim`, :7365).
   *  The transplant carried the pockets and dropped the callback, so the strip
   *  painted ✓14:30 on a board whose three rooms were all busy — Liam's own
   *  scene, where the drop then refused 満室.
   *
   *  The LANE is an argument because the store rule is lane-dependent: a room in
   *  another store never makes a start feasible for someone who does not work
   *  there (canon binds the lane the same way).
   *
   *  ABSENT = a store with no rooms configured. Canon's own switch for that is
   *  `SCENARIO.needsBed === false` (:7261), which leaves every start
   *  bed-feasible; leaving the field undefined reproduces it exactly, because
   *  the engine only consults a callback that is there (gap-guard :271-272). */
  placementFeasible?: (lane: BoardLane, start: number, dur: number) => boolean
  /** ⚖ SPEC-SELLING-ENGINE §3.1 — THE GUARD IS TOLD WHETHER ITS 新規 WINDOW HAS
   *  A ROOM, which is the OTHER half of flag 76 and the refusal side of flag 49.
   *
   *  `placementFeasible` above answers 「can the card being placed occupy this
   *  span」. This one answers 「does the real world publish a protected window
   *  starting here」 (gap-guard :52) — a different question about a different
   *  subject, and canon has always had the slot for it (`protectedWindows`
   *  :192-206) with nothing wired into it. Unwired, the guard counts protected
   *  capacity it cannot deliver: it refuses a placement to save a 新規 window no
   *  room could ever host, and it stays silent over one it could.
   *
   *  IT IS THE SAME QUESTION THE MASK IS BUILT FROM — the board world's
   *  `newClientMask` through `bedDoor(…, null)` — so the rail and the sales door
   *  answer out of one held set rather than two derivations free to disagree.
   *  That is the whole of the law (spec §1's closing clause).
   *
   *  ⚠ IT ALSO MOVES THE ENUMERATION ONTO THE LATTICE. With a callback the walk
   *  starts at `ceil(pocket.s / 5) * 5` instead of the pocket's own minute
   *  (gap-guard :195), so counts move for TWO reasons and the §3.3 table must
   *  keep them in two columns — see E3a-proof/RAIL-DELTA.
   *
   *  ABSENT = today's rail exactly (the round gate off): canon consults a
   *  callback only when there is one, and a store with no rooms configured has
   *  none to consult either way. */
  protectedWindowFeasible?: (lane: BoardLane, start: number, dur: number) => boolean
  /** ⚖ NUDGE-GUARD — WHERE THE STORE'S COMMITTED DAY STILL HAS THIS CARD, when the
   *  question is a MOVE. The baseline for 「does the store lose inventory by
   *  confirming this change」 is the span 元に戻す restores, never the lane with the
   *  card lifted out — see COUNCIL-NUDGE-FIX-R2-2026-09-06/ADJUDICATION.md ruling 2.
   *  Absent or null = today's behaviour everywhere (a new card, a cell at rest). */
  resting?: { laneKey: string; start: number; dur: number } | null
  /** The window door the BEFORE-list is judged through: 「could a NEW placement start
   *  here, with the moving card lifted out」 — never 「may THIS card go here」, which
   *  binds the mover's own 個室のみ tag and silenced a real loss (…/nextround/
   *  PKT-NUDGE-FIX1.md §F2). Judging it on the after-world erased the very window the
   *  move destroys (COUNCIL-NUDGE-FIX-R2-2026-09-06/ADJUDICATION.md ruling 3). Same
   *  shape as `protectedWindowFeasible` above; the AFTER-list keeps that one. */
  restingWindowFeasible?: (lane: BoardLane, start: number, dur: number) => boolean
}

/** The engine's ctx for ONE staff lane — canon `ctxFor` (:7278). The clock the
 *  lead-time exemption reads, and the rooms. */
function railCtx(lane: BoardLane, input: RailInput): GuardContext {
  const feasible = input.placementFeasible
  const held = input.protectedWindowFeasible
  return {
    now: input.nowMinute ?? undefined,
    placementFeasible: feasible ? (start, dur) => feasible(lane, start, dur) : undefined,
    protectedWindowFeasible: held ? (start, dur) => held(lane, start, dur) : undefined,
  }
}

/** Does a placement touch this pocket at all? Half-open both sides, canon's own
 *  `overlaps` grammar (gap-guard :187-188). Spelled by its own name because
 *  `spansOverlap` next door is PERCENT-space with an epsilon and would answer a
 *  different question here. */
const overlapsPocket = (a: GuardPlacement, p: { s: number; e: number }) => a.start < p.e && a.start + a.dur > p.s

/** The lane's protected windows with a card at X; `protectedCapacityOf` answers the
 *  at-rest count and stays separate. WHOLE-LANE, because a per-pocket frame is blind
 *  across the pockets of one lane — a nudge across a 休憩 kept a false 1枠減
 *  (COUNCIL-NUDGE-FIX-2026-09-06/ADJUDICATION.md ruling 2). */
export function laneWindowsWith(
  engine: ReturnType<typeof createGapGuard>,
  pockets: ReturnType<typeof freePockets>,
  placement: GuardPlacement | null,
  ctx: GuardContext,
): number[] {
  return pockets.flatMap((p) =>
    placement && overlapsPocket(placement, p)
      ? engine.protectedCapacity(p, placement, ctx).afterStarts
      : engine.protectedCapacity(p, null, ctx).beforeStarts,
  )
}

/** ⚖ NUDGE-GUARD — THE CARD'S COMMITTED SPAN, in the arm order the ruling fixes
 *  (COUNCIL-NUDGE-FIX-R2-2026-09-06/ADJUDICATION.md ruling 1).
 *
 *  PENDING FIRST, because `committedLanes` already carries a staged card at its
 *  STAGED span — reading the board there would price the move against itself and
 *  report zero for every staged nudge. `pending.origin` is the span 元に戻す
 *  restores, which is the store's own committed day.
 *
 *  A `ParkHome` origin (the shelf's place-back) carries the day and store it was
 *  parked from, and it is only a baseline on the board it belongs to; a creation
 *  sentinel (`laneKey === ''`) has no committed span at all, so its first landing's
 *  warning honestly re-fires until it is confirmed (C4). `pending.origin` is TYPED
 *  `Move` on the screen and a `ParkHome` is assignable to it, so the home fields are
 *  read structurally — this file may not import the session provider (foundation's
 *  import inventory for it). */
export function restingSpanFor(
  pending: { id: string; origin: Move & { dayOffset?: number; store?: string | null } } | null,
  committedLanes: BoardLane[],
  id: string | null,
  hours: Hours,
  dayOffset: number,
  store: string | null,
): RailInput['resting'] {
  if (id == null) return null
  if (pending != null && pending.id === id) {
    const home = pending.origin
    if (home.laneKey === '') return null
    if (home.dayOffset !== undefined && (home.dayOffset !== dayOffset || home.store !== store)) return null
    const start = minuteOf(home.x, hours)
    return { laneKey: home.laneKey, start, dur: minuteOf(home.x + home.w, hours) - start }
  }
  const lane = committedLanes.find(
    (l) => l.group === 'staff' && l.items.some((i) => i.kind === 'booking' && i.caseId === id),
  )
  const item = lane?.items.find((i) => i.kind === 'booking' && i.caseId === id)
  return lane != null && item != null ? { laneKey: lane.key, start: item.startMin, dur: item.endMin - item.startMin } : null
}

/** The committed span, but only where it is this lane's business: a cross-lane target
 *  is priced exactly as today, and STRICT mode keeps today's behaviour entirely
 *  (C2 — COUNCIL-NUDGE-FIX-R2-2026-09-06/ADJUDICATION.md ruling 7). */
const restingOn = (lane: BoardLane, input: RailInput): GuardPlacement | null =>
  input.resting != null && input.resting.laneKey === lane.key && input.guard.mode !== 'strict'
    ? { start: input.resting.start, dur: input.resting.dur }
    : null

/** `railCtx` for the BEFORE-list — the same wiring, through the other door. */
function beforeCtxFor(lane: BoardLane, input: RailInput, ctx: GuardContext): GuardContext {
  const lifted = input.restingWindowFeasible
  return lifted ? { ...ctx, protectedWindowFeasible: (start, dur) => lifted(lane, start, dur) } : ctx
}

/** The 60分配置 rail for every staff lane — canon `renderSlotBoxes` (:7543),
 *  minus the DOM. Every exact 30-minute start on the board, judged by the
 *  guard engine against the pocket it would land in. */
export function guardRailsFor(lanes: BoardLane[], input: RailInput): GuardRail[] {
  // ⚖ AMENDMENT 2, N2 — the same insurance, and here it is a TRUE hang: the cell
  // walk below is `start += input.stepMin`, so a zero step never reaches
  // `input.close` and takes the render thread with it. Unreachable today only
  // because both call sites hardcode canon's 30 — which is exactly the kind of
  // "safe by accident" a settings dial stops being. No step, no rails.
  //
  // ⚖ 9/1, THE SETTINGS ROUND'S RIDER — AND NOW IT CATCHES NaN, which `<= 0`
  // never could: NaN fails every comparison, so a non-numeric step walked
  // straight past this line, painted ONE cell at `input.open`, then ended the
  // loop the moment `start` became NaN. Not a hang — a SILENT WRONG ANSWER,
  // which is worse: the rail rendered, and it was a lie about the rest of the
  // day. The room shipping this round puts a real number field (予約の刻み) in
  // front of an operator for the first time, so the shape that catches an empty
  // or half-typed box is the one this file already uses for exactly this reason
  // (`impactOf`'s `!(protectedDur > 0)`). Infinity goes with it: a step no
  // arithmetic can advance is no step. Same answer as before — no step, no
  // rails — for one more class of input.
  if (!(Number.isFinite(input.stepMin) && input.stepMin > 0)) return []
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
    const ctx = railCtx(lane, input)
    const resting = restingOn(lane, input)
    const beforeCtx = beforeCtxFor(lane, input, ctx)
    for (let start = input.open; start < input.close; start += input.stepMin) {
      cells.push(railCell(engine, pockets, start, input, ctx, resting, beforeCtx))
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
  const ctx = railCtx(lane, input)
  return railCell(createGapGuard(input.guard), pockets, start, input, ctx, restingOn(lane, input), beforeCtxFor(lane, input, ctx))
}

function railCell(
  engine: ReturnType<typeof createGapGuard>,
  pockets: ReturnType<typeof freePockets>,
  start: number,
  input: RailInput,
  ctx: GuardContext,
  resting: GuardPlacement | null = null,
  beforeCtx: GuardContext = ctx,
): RailCell {
  const blocked = (sentence: string, reason: RailReason): RailCell => ({
    start, state: 'blocked', label: '—', sentence, reason, alternatives: [], alternativeKind: null, ackAllowed: false,
  })
  const pocket = pockets.find((p) => start >= p.s && start + input.dur <= p.e)
  if (!pocket) {
    // ⚖ Liam flag 62 (2026-08-22) — A POCKET THAT CANNOT HOLD THE SESSION AT
    // THIS START STILL HAS STARTS IN IT.
    //
    // This branch used to return `alternatives: []` for every non-fit, and the
    // popover picks its line purely by `alternatives.length` — so it read
    // 「この区間に、より損の少ない開始はありません」 for the one case where a
    // better start certainly exists: earlier in the very pocket the operator
    // clicked into. Ask the pocket before saying there is nothing.
    //
    // The offers stay engine truth: `safeStarts` is the engine's own public
    // surface, and the presentation seam (`offerableCell`) still snaps each one
    // onto the store's booking lattice and re-verifies it through the caller's
    // gate before any button names it.
    // ⚖ 76 — and the offers are bed-filtered too. Canon's `demoCandidateStarts`
    // hands `safeStarts` the SAME ctx (:7296-7301), so a bed-starved alternative
    // is never named; the engine's own `candidateStarts` applies the callback
    // (gap-guard :274-281). Without it the lie simply moves one click later.
    const here = pockets.find((p) => start >= p.s && start < p.e)
    const alternatives = here ? engine.safeStarts(here, input.dur, ctx) : []
    return {
      ...blocked(`この開始には${input.dur}分の連続した空きがありません`, 'fit'),
      alternatives,
      // ponytail: zero-loss starts only. A pocket whose every feasible start is
      // lossy still answers 「ありません」 — upgrade to the engine's own
      // least-loss ranking if that case ever reaches Liam's eyes.
      alternativeKind: alternatives.length > 0 ? 'safe' : null,
    }
  }
  const v = engine.evaluate(pocket, { start, dur: input.dur }, ctx)
  // The engine's 「before」 is this POCKET with the card lifted out, which is the honest
  // baseline for a NEW card and a phantom for a MOVE: a 5-minute nudge inside a card's
  // own stretch read as one lost 新規 window. A move's honest before is the WHOLE LANE
  // with the card where the store's committed day still has it, and its rooms are judged
  // through the door that lifts the card's own room hold. Ceiling C1: a window at the
  // card's OLD minutes may then count as feasible when its only free room was that card's
  // — over-report only, never a false quiet. Rulings, whole:
  // business-release-packets/evidence-transplant-batch1-20260819/WO2-today/batch14/nextround/COUNCIL-NUDGE-FIX-2026-09-06/ADJUDICATION.md
  // business-release-packets/evidence-transplant-batch1-20260819/WO2-today/batch14/nextround/COUNCIL-NUDGE-FIX-R2-2026-09-06/ADJUDICATION.md
  // ponytail: C2 — strict mode keeps today's behaviour entirely; `restingOn` hands null there.
  // ponytail: C3 — the count frame is the board's own, so a count-neutral swap of a prime window for a cheaper one reads 0枠減 and prices nothing.
  // ponytail: C4 — a created card has no committed span, so its first landing's warning re-fires on a nudge until it is confirmed.
  const beforeStarts = resting === null ? v.protectedWindowsBefore : laneWindowsWith(engine, pockets, resting, beforeCtx)
  const afterStarts = resting === null ? v.protectedWindowsAfter : laneWindowsWith(engine, pockets, { start, dur: input.dur }, ctx)
  const loss = Math.max(0, beforeStarts.length - afterStarts.length)
  /** ⚖ 9/1 「zero-loss is quiet」 — WHAT SURVIVES, in the ✓ branch's own words, spelled
   *  once: a MOVE that costs the store no window says exactly this and no count pair
   *  (COUNCIL-NUDGE-FIX-R2-2026-09-06/ADJUDICATION.md ruling 4). THE CALLER NAMES ITS
   *  OWN LISTS: the ✓ branch decided on the engine's pocket, a MOVE decided on the
   *  honest lane lists, and reading the pocket here printed a bare 「守れます」 over
   *  a lane holding nothing (…/nextround/PKT-NUDGE-FIX1.md §F1). */
  const keptSentence = (after: readonly number[], noneAtAll: boolean) => {
    const held = protectedWindowsClause(after, input.protectedDur)
    return noneAtAll
      ? `配置できます。この区間には現在、守れる新規${input.protectedDur}分の空きはありません`
      : `${held === '' ? '' : `${held}の`}新規${input.protectedDur}分の空きを守れます`
  }
  // ⚖ R2 ruling 6 — a zero-loss row keeps only the engine's SAFE offers: with nothing to
  // reduce, a least-loss offer under it prints 「（損を減らす）」 over a costless move.
  const safeAlternatives = v.alternativeKind === 'safe' ? v.alternatives : []
  const degradedFace = (sentence: string, alternatives: number[], alternativeKind: RailCell['alternativeKind']): RailCell => ({
    start,
    state: 'degraded',
    label: `△${clockOf(start)}`,
    sentence,
    reason: null,
    alternatives,
    alternativeKind,
    ackAllowed: true,
    impact: {
      code: 'DEGRADED',
      capacityBefore: beforeStarts.length,
      capacityAfter: afterStarts.length,
      windowsBefore: beforeStarts,
      windowsAfter: afterStarts,
    },
  })
  /** ⚖ 76 / canon `evaluateExactAim` (:7330-7337) — THE ROOM IS A HARD BLOCK.
   *
   *  The staff pocket held (the branch above already answered when it did not,
   *  which is canon's order: pocket first, rooms second), so the only thing
   *  left that can make the span impossible is the resource — and the engine
   *  says so with `R-UNAVAILABLE` and `ackAllowed: false` (gap-guard :370-377).
   *  Canon answers it with the concrete resource sentence and, in as many words,
   *  "never offer an override". `blocked()` is already ack-less, so the override
   *  cannot leak back in from here.
   *
   *  The alternatives are the engine's own and need no re-filtering: they come
   *  from `candidateStarts`, which the same callback has already narrowed.
   *
   *  The sentence is the RAIL's, not `reasonLine`'s. `reasonLine` is a straight
   *  transplant of canon :7092 and canon itself does not put the bed wording
   *  there — it says it at the aim site, and only when the scenario has rooms
   *  (`SCENARIO.needsBed !== false`, :7334-7336). Its other reader is the pinned
   *  unit contract at today-screen-interactions.test :880, which speaks for the
   *  engine's generic refusal, and a store with no rooms configured cannot
   *  honestly blame a bed. */
  if (v.reason?.code === 'R-UNAVAILABLE') {
    return {
      ...blocked(
        input.placementFeasible
          ? `この開始ではベッドを${input.dur}分確保できません`
          : reasonLine(v.reason, input.protectedDur),
        'bed',
      ),
      alternatives: v.alternatives,
      alternativeKind: v.alternativeKind,
    }
  }
  if (v.verdict === 'ok' || v.verdict === 'exempt') {
    // canon `exactAimConsequence` (:7570): a pocket that never held a protected
    // window cannot claim to be protecting one.
    // ⚖ Liam 8/30 — and it names them. THE WINDOWS THAT SURVIVE THE DROP
    // (`protectedWindowsAfter`, filled for every verdict at gap-guard `evaluate`'s
    // `result` literal, its `protectedWindowsAfter:` line),
    // because that is what 「守れます」 promises: the before-set would name spans
    // that no longer exist once the card is down — a 30 at a pocket's start
    // pushes every window along with it. The empty guard cannot fire on a real
    // engine (a start that keeps its capacity keeps its windows); it is here so
    // a future engine that reports a count without its starts falls back to the
    // sentence that shipped rather than printing a bare 「の」.
    const sentence = keptSentence(v.protectedWindowsAfter, v.protectedCapacityBefore === 0)
    return { start, state: 'safe', label: `✓${clockOf(start)}`, sentence, reason: null, alternatives: [], alternativeKind: null, ackAllowed: true }
  }
  if (v.verdict === 'degraded') {
    // A MOVE whose honest loss is zero is not a 0枠減 count sentence: it is the ✓
    // branch's own promise about what survives, quiet and un-priced.
    if (resting !== null && loss === 0) return degradedFace(keptSentence(afterStarts, afterStarts.length === 0), safeAlternatives, v.alternativeKind === 'safe' ? 'safe' : null)
    // ⚖ Liam 8/30 — and it names the windows this start EATS, which is the
    // question a cost sentence answers. Not the whole before-set (most of it
    // survives) and not before-minus-after (the after-set re-tiles). A degraded
    // verdict can carry 0枠減 (canon's 「nowhere wins」 path, when the loss is a
    // dead or salvage gap and the window count re-tiles unchanged); naming a
    // window as the cost of a placement that costs no window is a
    // contradiction, so the clause waits for a real loss.
    const atRisk =
      loss > 0
        ? protectedWindowsClause(
            windowsEatenBy(beforeStarts, input.protectedDur, start, input.dur),
            input.protectedDur,
          )
        : ''
    // ⚖ 92 — the same two numbers the sentence spells, carried as data, and the window
    // starts behind them so the card prices the loss through canon.
    return degradedFace(
      `${atRisk === '' ? '' : `${atRisk}の`}新規${input.protectedDur}分の空き${beforeStarts.length}→${afterStarts.length}（${loss}枠減・損を減らす）。${clockOf(v.leastLossStart ?? start)}はこの区間で損が最少の開始です`,
      v.alternatives,
      v.alternativeKind,
    )
  }
  // ⚖ Liam 8/30 — THE THIRD SENTENCE, and the decision that guards it. A refusal
  // that names 新規（90分） is the same fact as the ✓ and △ rows above and gets
  // the same leading clause; a refusal that names a SERVICE (「整体60が入らなく
  // なります」, gap-guard `reasonForKey`'s `repLabel(lossSet)` line — :338) is not
  // a protected window and gets nothing. The engine's own `capacityLost` is the
  // test — the words are not.
  const repCapacity =
    v.reason?.code === 'R-REP' && Number(v.reason.params.capacityLost) > 0
  // (c) — A REFUSAL WHOSE ONLY COST WAS THE PHANTOM WINDOW IS PLACEABLE. The store loses
  // no inventory by confirming this change, so the gate that priced it and held it behind
  // 長押し had nothing to gate: △, quiet, un-priced, the engine's safe offers kept.
  if (repCapacity && resting !== null && loss === 0) {
    return degradedFace(keptSentence(afterStarts, afterStarts.length === 0), safeAlternatives, v.alternativeKind === 'safe' ? 'safe' : null)
  }
  // (d)/(e) — a refusal that really costs a window names and prices the honest lists;
  // every other refusal class keeps the engine's own pocket numbers, untouched.
  const windowsBefore = repCapacity ? beforeStarts : v.protectedWindowsBefore
  const windowsAfter = repCapacity ? afterStarts : v.protectedWindowsAfter
  const repWindows = repCapacity
    ? protectedWindowsClause(
        windowsEatenBy(beforeStarts, input.protectedDur, start, input.dur),
        input.protectedDur,
      )
    : ''
  return {
    ...blocked(reasonLine(v.reason, input.protectedDur, repWindows), 'guard'),
    alternatives: v.alternatives,
    alternativeKind: v.alternativeKind,
    ackAllowed: v.reason?.ackAllowed === true,
    // ⚖ 92 — the engine's own class (R-REP / R-DEAD / R-SALV), carried rather
    // than read back out of the sentence it produced.
    // ⚖ 92 fix round 5 V1 (breaker #4) — with the window starts, as above.
    ...(v.reason
      ? {
          impact: {
            code: v.reason.code,
            capacityBefore: windowsBefore.length,
            capacityAfter: windowsAfter.length,
            windowsBefore,
            windowsAfter,
          },
        }
      : {}),
  }
}

/** ⚖ LIAM flag 44 (2026-08-21, restated in the 8/26 kickoff) — THE BOARD
 *  EXPLAINS ITSELF. What ONE rail chip wears at rest, and what it says when it
 *  is pressed.
 *
 *  HIS COMPLAINT, in his own scene: the strip is honest and unreadable. A grey
 *  「—」 states a refusal and names nothing, and two of the three things that can
 *  cause one — a full house, and the guard holding the 新規 window — are
 *  INVISIBLE ON THAT ROW. The operator sees empty space and a board refusing to
 *  sell it, with no way to find out why short of dragging a card at it.
 *
 *  SO: a ten-pixel word at rest, and the whole sentence on demand. The rest
 *  budget is the entire ⚖ big-tech-simplicity allowance for this strip (a word,
 *  a 3px dot, a quarter-strength hatch) and the explanation is a press away.
 *
 *  IT LIVES HERE, not in the renderer, for this file's own stated reason: an
 *  answer the operator acts on has to be provable without a renderer — and this
 *  one is asked across twelve dial combinations, on boards whose sell layer is
 *  empty, where a DOM test would prove nothing.
 *
 *  ⚖ 44's WINDOW REQUIREMENT — EVERY sentence names the exact start-window it
 *  judged, `[start, start + dur)`. The strip's length follows the gesture (⚖
 *  50), so 「置けません」 with no window is a sentence about a span the operator
 *  cannot see and may not have guessed. Two grammars, deliberately ONE home
 *  each:
 *    · a bed refusal is `fullRoomsRefusal`'s, arriving whole through
 *      `allocateBed` — it already opens with the window and then names the room
 *      and every occupant, and re-wording it here would be the second composer
 *      that ruling exists to forbid. ⛔ Never coin a new full-house sentence:
 *      「この時間帯に空いているベッドがいません」 is RETIRED and
 *      「空きベッドなし」 was never vocabulary.
 *    · everything else appends 「（HH:MM〜HH:MM）」 to the engine's own line.
 *
 *  ⚖ 75(i) — AND A ✓ OVER NOTHING IS ALSO A QUESTION. A window carrying no
 *  advertised box at all says "placeable" while the board shows no offer there,
 *  and R4's reconcile is often the reason: it dropped that hour so one room
 *  would carry one advertisement. When it did, the clause names WHO GOT THE
 *  ROOM (75(ii)); when nothing was dropped the hour was never derived at all,
 *  and the clause says exactly that and NOTHING MORE. Inventing a cause for an
 *  hour the derivation simply never emitted would be worse than the silence it
 *  replaces. */
/** ⚖ SPEC-SELLING-ENGINE §9's ruled 案B (Liam 8/30, mock open) — WHAT A 確保
 *  SPAN SAYS WHEN IT IS ASKED: the store's own duration, and the release rule.
 *
 *  ONE composer for both places the law is said — the chip's own press and the
 *  rail chip's clause under it — so the two can never word the same rule
 *  differently. `dur` is the SPAN's own length, which IS the store's protected
 *  dial by construction (`reservedMaskFor` ends every span at
 *  `windowStart + protectedDuration`), so no literal duration appears anywhere
 *  and a store that moves its dial moves this sentence with it.
 *
 *  ⚠ DIRECTION COPY (PKT-E3B-FLIP §5) — awaiting the native pass, like every JP
 *  line this round adds. The trailing 。 of the packet's line is dropped for the
 *  strip's own grammar: no sentence on this rail ends in one, and one that did
 *  would be the only one. */
export const reservedClause = (dur: number): string =>
  `新規のお客様のための${dur}分枠として確保しています。隣の枠が埋まれば、残りは通常どおり販売に戻ります`

/** …and the chip's own press, which has no rail cell above it to have named the
 *  window already, so it names it — in the strip's own ⚖ 44 window grammar
 *  (「（HH:MM〜HH:MM）」, 〜 and not an en dash). */
export const reservedSentence = (start: number, end: number): string =>
  `新規用に確保（${clockOf(start)}〜${clockOf(end)}）。${reservedClause(end - start)}`

export function railExplain(
  cell: RailCell,
  /** The length the strip is judging — ⚖ 50, it follows the gesture. */
  dur: number,
  opts: {
    /** `allocateBed`'s answer for THIS chip's own window, on a bed-refused
     *  chip: its sentence, and the occupants it walked. Absent everywhere else
     *  (and on a store with no rooms, where nothing can blame a bed). */
    room?: { refusal: string | null; blockers: readonly BoardItem[] } | null
    /** ⚖ 75(i) — this window overlaps no advertised box on its lane. */
    adless?: boolean
    /** ⚖ 75(ii) — the lane whose promise kept the room, when a room-drop is
     *  what emptied this window. Absent = nothing was dropped for a room. */
    takerLabel?: string | null
    /** ⚖ SPEC-SELLING-ENGINE §1 + §9 (E3b) — THE LENGTH OF THE 新規用に確保 SPAN
     *  this chip's window falls inside, or absent when it falls inside none.
     *
     *  It is the span's own length rather than a flag because the sentence has
     *  to QUOTE the store's dial (「{dur}分枠として確保しています」) and this
     *  file may not read a config to find one — the number arrives with the
     *  fact, from the one derivation home, or it does not arrive at all. */
    reservedDur?: number | null
  } = {},
): { word: string | null; sentence: string } {
  // ⚖ NATIVE PASS (2026-08-26) — 〜, NOT AN EN DASH. The bed branch's own
  // sentence, two chips away on the same strip, spells the identical window
  // 「13:30〜14:30」; one strip may not punctuate one fact two ways. The ⚖-ruled
  // appended-parenthesis SHAPE is untouched — this is the glyph inside it.
  const judged = `（${clockOf(cell.start)}〜${clockOf(cell.start + dur)}）`
  const blockers = opts.room?.blockers ?? []
  // ⚖ 44 FIX ROUND (blind lens 1, F1) — A WORD MAY ONLY RIDE A REFUSAL THAT
  // NAMED SOMEBODY. `cell.reason` is the ENGINE's class for this start and the
  // room answer beside it is the DISPLAY's own `allocateBed` call, so the two
  // can legitimately disagree, and both ways of disagreeing printed 満室:
  //   · mid-gesture the display's call lifts the card in hand, finds a bed and
  //     answers `refusal: null` — 満室 over a room that is free;
  //   · a staff lane sharing no store with any room is refused with
  //     「…使えるベッドがありません」 and NO occupants at all — 満室 beside a
  //     sentence saying there are no rooms to be full of anybody.
  // So the word is derived from the same two facts the SENTENCE is: there is a
  // refusal, and it named who is in the way. Anything else keeps the bare 「—」,
  // which states the refusal without naming something that is not true.
  const roomWord =
    opts.room?.refusal != null && blockers.length > 0
      // ⚖ 44 — 満室 is the CHIP's word: internal/state vocabulary, which the
      // 8/25 native pass retired from operator SENTENCES only (see
      // `fullRoomsRefusal`'s own note). A window whose every blocker is a
      // turnaround is not a busy house, it is a house being turned over, and
      // 清掃 is the truer word — read off the walk `allocateBed` already did,
      // never re-derived from the sentence.
      //
      // ⚖ NATIVE PASS (2026-08-26) — 満室 and 清掃 confirmed as ruled. Both are
      // chip vocabulary, which the 8/25 pass deliberately left standing.
      ? (blockers.every((i) => i.kind === 'cleanup') ? '清掃' : '満室')
      : null
  const word =
    cell.reason === 'bed'
      ? roomWord
      : cell.reason === 'guard'
        // ⚖ LIAM RULING (2026-08-30) — 新規用, and the JP lens called it before he
        // did. 新規 alone is a CATEGORY word on this board (it is the カテゴリー
        // colour in the legend, and 新規予約を作成 is what an empty track opens), so
        // on a chip it reads as 「a new customer goes HERE」 — the exact inversion of
        // what the chip means, which is that the start is being HELD EMPTY for one
        // and cannot be sold. Liam read it that way live on 8/30. 用 names WHOSE the
        // space is rather than what may be put in it, and there is no way to read it
        // backwards. This is his ruled vocabulary now, not a Fable default.
        ? '新規用'
        // ⚖ Fable-accepted default (overturnable): a no-pocket-fit chip keeps
        // the bare 「—」. Its blocker — a booking, a 予定ブロック, a shift wall —
        // is DRAWN on the row directly above it, so a word would be labelling
        // something the operator is already looking at.
        : null
  const base = cell.reason === 'bed' && opts.room?.refusal ? opts.room.refusal : `${cell.sentence}${judged}`
  // ⚖ E3b — AND THE LAW ANSWERS FIRST, wherever it applies. A window inside a
  // 新規用に確保 span is empty for exactly one reason and the store made it: the
  // clause states the rule and the way out of it, and it rides EVERY state
  // rather than only the ✓ ones, because the chip an operator most wants to
  // press here is the refused one wearing 新規用 — 44's whole complaint was a
  // refusal that names nothing. (`adless` is false under a held span by
  // construction — `explainRails` suppresses it there — so the two clauses can
  // never both fire and there is no precedence to keep straight.)
  if (opts.reservedDur != null) return { word, sentence: `${base}。${reservedClause(opts.reservedDur)}` }
  // A refused chip is already answering; ⚖ 75(i)'s clause is about a start the
  // board said YES to and then advertised nothing at.
  if (cell.state === 'blocked' || opts.adless !== true) return { word, sentence: base }
  // ⚖ NATIVE PASS (2026-08-26) — BOTH CLAUSES NAMED THE WRONG THING.
  //   · the taker read 「ベッドは別の販売枠（…）が使っています」, but what took
  //     the room is a 詰め込み／スキマ box, not a 販売枠, and the label in the
  //     parenthesis is a PERSON — so it hangs off スタッフ, and the reason the
  //     operator is being told this (nothing is offered here) is now said.
  //   · the bare one read 「…は表示されていません」, which points at the display
  //     and invites 「then turn it back on」. The honest fact is that no sellable
  //     box was ever put out for this start.
  const clause = opts.takerLabel
    ? `ベッドは別のスタッフ（${opts.takerLabel}）の枠が使うため、ここには販売可能枠を出していません`
    : 'この開始には販売可能枠が出ていません'
  return { word, sentence: `${base}。${clause}` }
}

/** What one chip wears and says: `railExplain`'s answer, keyed lane → start. */
export type RailExplained = Map<string, Map<number, { word: string | null; sentence: string }>>

/** ⚖ 44 + rider 75(i) — EVERY CHIP'S WORD AND ITS SENTENCE, worked out once per
 *  frame instead of once per press.
 *
 *  `railExplain` is the composer for ONE chip; this is the board's own inputs to
 *  it for the whole strip. It lives out here with the composer rather than in
 *  the renderer for this file's stated reason (and `railExplain`'s own): an
 *  answer the operator acts on has to be provable without a renderer — Business
 *  territory has none — and this one is asked across twelve dial combinations,
 *  on boards whose sell layer is empty, where a DOM test would prove nothing.
 *
 *  THE ROOM QUESTION IS THE STRIP'S OWN, spelled the way the strip asks it: a
 *  NEW placement of `dur` minutes on this lane's stores, with the card in hand
 *  lifted out (`handId` is `guardRailsFor`'s own `excludeId`, so the sentence
 *  and the chip above it were judged against one board). It goes through
 *  `allocateBed` because that is where the refusal SENTENCE is composed — one
 *  home, never a second composer for a full house.
 *
 *  ponytail: one `allocateBed` per BED-REFUSED chip per frame, and nothing at
 *  all for the rest — and nothing WHATEVER while a gesture is in hand. The
 *  ceiling is a board where most starts are full for most staff; move these
 *  through `capacity-ledger`'s book (which memoises the identical question) if a
 *  bigger board ever measures slow. */
export function explainRails(
  rails: readonly GuardRail[],
  lanes: BoardLane[],
  opts: {
    /** The length the strip is judging — ⚖ 50, it follows the gesture. */
    dur: number
    /** The card in hand, lifted out of the board for the room question. */
    handId: string | null
    /** ⚖ R3 one world — the operator's own staged card, named as theirs. */
    stagedId: string | null
    /** The advertised layer and the promises, as the board draws them.
     *
     *  ⚖ FIX ROUND F1 (blind-final L1#1 ≡ L2#1) — AS THE BOARD DRAWS THEM, and
     *  that is now literally true. It was handed the DERIVATION, which still
     *  contains every hour the law is withholding, so a held-bound cell nobody
     *  can see satisfied `advertised` and 75(i)'s 「販売可能枠が出ていません」
     *  stood down over genuinely blank track — flag 44's own defect, re-created
     *  by the fix for flag 44's sibling. The taker lookup is unaffected: it
     *  reads `drops`, a separate input. */
    sellCells: readonly SellCell[]
    claims: readonly GapCell[]
    /** ⚖ 75(i) — what building that layer threw away. */
    drops: readonly SellDrop[]
    /** ⚖ 44 FIX ROUND (blind lens 4, SF2) — SOMETHING IS IN THE OPERATOR'S HAND,
     *  and then this map is not read at all: the chip wears the verdict's × and
     *  its accessible name is the verdict's own reason, so every answer composed
     *  here would be thrown away — once per pointer frame, `allocateBed` per
     *  bed-refused chip included, because the live board re-derives the rails on
     *  every frame of the drag. The empty map IS the rest-state cue standing
     *  down (the word is already nulled and the hatch already gated on the same
     *  gesture), and the one thing that survives it is the accessible name of a
     *  CLEAN landing, which falls to the engine's own `cell.sentence` — no
     *  window suffix, no 75(i) clause. That is the mid-drag shape every other
     *  class already had: a blocked or caution chip's name has always been the
     *  verdict's raw sentence, so the clean chip now matches its neighbours
     *  instead of being the only one still wearing the resting composition. */
    inHand: boolean
    /** ⚖ 44 FIX ROUND (blind lens 4, N4) — IS THE SELL LAYER ON SCREEN AT ALL.
     *  表示設定 → 空き枠表示「非表示」 hides every 販売可能枠 box (`.sell-off`),
     *  so EVERY window is ad-less and 75(i)'s clause would fire on every ✓ chip
     *  on the board — 「この開始には販売可能枠が出ていません」 said about a
     *  display the operator switched off themselves. The clause explains an
     *  absence the board chose; it may not explain one the operator did.
     *  「ドラッグ中のみ」 is NOT gated here: that layer exists and is revealed by
     *  the gesture, and a gesture already empties this map. */
    sellDisplayed: boolean
    /** ⚖ SPEC-SELLING-ENGINE §2's registry, consumer (c) — THE HELD SET FOR THIS
     *  WORLD, so a 新規用に確保 window is FIRST-CLASS here rather than an absence
     *  this file has to invent a reason for.
     *
     *  Without it the two 75(i) clauses fire over exactly the space the law is
     *  holding: 「この開始には販売可能枠が出ていません」 under the 確保 chip E3b
     *  paints, or worse, 「ベッドは別のスタッフ（…）の枠が使う」 — naming a
     *  stranger for an emptiness the STORE'S OWN RULE caused. Flag 88's
     *  suppress-under-a-box grammar, extended to the reserved kind.
     *
     *  Absent = the round gate is off and every sentence is byte-identical to
     *  today's (the observational drop pin at today-explains.test.ts:393 stays
     *  untouched and green). */
    held?: readonly ReservedLaneMask[]
    /** ⚖ FIX ROUND F1, second half — THE HOURS THE LAW ACTUALLY TOOK OFF THE
     *  BOARD: the held-bound sell cells `sellDrawnFor` removed.
     *
     *  A held span and the sale it withholds are not the same stretch of track.
     *  `tagHeldBound` withholds a whole SELL SLOT whenever the slot OVERLAPS a
     *  held span, so a 90-minute hold on a 60-minute grid empties 120 minutes
     *  of track and the chip covers 90 of them. The 30 minutes past the chip
     *  were blank with no box, no chip and nothing said about them — and now
     *  that `sellCells` is the PUBLISHED layer they would earn 75(i)'s bare
     *  clause, which is true and names the wrong cause: the store's own rule
     *  emptied that stretch, not an absent derivation.
     *
     *  So the clause covers exactly what the predicate took. Absent — the round
     *  gate off, or a caller with nothing withheld — collapses the extents back
     *  onto the held spans themselves and every sentence is unchanged. */
    withheld?: readonly SellCell[]
  },
): RailExplained {
  const out: RailExplained = new Map()
  if (opts.inHand) return out
  const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE
  const heldLanes = heldByLane(opts.held)
  // ⚖ FIX ROUND 1 (blind lens 1 F3) — THE HAND'S OWN TAG, when there IS a hand.
  // The probe below asked the allocator with `requiresPrivate: false` always, so
  // a rail cell explaining a placement for a 個室のみ card answered a different
  // question than the drop itself will. Read once per call, off the same
  // `caseId` every other card-reading site uses; a null hand is a genuine
  // hypothetical and stays `false`.
  //
  // ⚖ FIX ROUND 2 (delta lens 4 N5) — AND WHICH GESTURES ACTUALLY REACH IT. The
  // `opts.inHand` return two lines above is taken by exactly the ordinary
  // gesture — a card dragged along its own staff row — so this lookup is live
  // for a BED-LANE drag, a RESIZE and a drag OVER THE SHELF, and never for that
  // one. Reachable and worth fixing; not the commonest path.
  const handItem =
    opts.handId == null ? null : (lanes.flatMap((l) => l.items).find((i) => i.caseId === opts.handId) ?? null)
  for (const rail of rails) {
    const staff = lanes.find((l) => l.key === rail.laneKey && l.group === 'staff')
    // Per lane, once — the ad-less test below is asked per cell and these three
    // lists do not change between them.
    const sellHere = opts.sellCells.filter((s) => s.group === 'staff' && s.laneKey === rail.laneKey)
    const gapHere = opts.claims.filter((g) => g.group === 'staff' && g.laneKey === rail.laneKey)
    // ⚖ 75(i) — only a ROOM drop explains an empty window. A `lane` drop means
    // this person's own promise beat the offer, and that promise is a box drawn
    // on this very row, so the window is not ad-less in the first place.
    //
    // ⚖ 44 FIX ROUND (blind lens 1, F4/F5) — AND THE TAKER HAS TO BE SOMEBODY
    // ELSE. The clause says 別の販売枠 — *another* — so a room-drop whose winning
    // promise is on THIS lane cannot be its subject; it falls through to the
    // bare clause, which states the absence without naming a stranger who is
    // this very person. (What is still accepted: two drops in the same slot on
    // one lane are told apart only by `h`, so a chip overlapping both takes the
    // first — the honest ceiling of a per-slot collector, and every candidate it
    // can pick did lose its room to the lane it names.)
    const roomDrops = opts.drops.filter(
      (d) => d.laneKey === rail.laneKey && d.kind === 'room' && d.takerLaneKey != null && d.takerLaneKey !== rail.laneKey,
    )
    const withheldHere = (opts.withheld ?? []).filter((s) => s.group === 'staff' && s.laneKey === rail.laneKey)
    const heldHere = heldLanes.get(rail.laneKey)
    // ⚖ FIX ROUND F1 — the held spans widened to the extent the WITHHOLDING
    // reached, so the law explains exactly what it did. `dur` stays the SPAN's
    // own length wherever the extent is quoted: the sentence quotes the store's
    // protected dial, and a slot boundary is not a dial.
    const heldExtents = (heldHere ?? []).map((h) => {
      let start = h.start
      let end = h.end
      for (const c of withheldHere) {
        if (!overlaps(c.h, c.h + SELL_SLOT_MIN, h.start, h.end)) continue
        start = Math.min(start, c.h)
        end = Math.max(end, c.h + SELL_SLOT_MIN)
      }
      return { start, end, dur: h.end - h.start }
    })
    const per = new Map<number, { word: string | null; sentence: string }>()
    for (const c of rail.cells) {
      const end = c.start + opts.dur
      const advertised =
        sellHere.some((s) => overlaps(s.h, s.h + SELL_SLOT_MIN, c.start, end)) ||
        gapHere.some((g) => overlaps(g.s, g.e, c.start, end))
      // ⚖ §2(c) — HELD IS NOT AD-LESS. It is kept apart from `advertised`
      // deliberately: nothing IS advertised here, and calling it so would be the
      // second reading of one fact this file keeps warning about. What it does
      // is answer 75(i)'s question — 「why is this window empty」 — with the law,
      // and never a taker's name.
      //
      // ⚖ E3b — and the SPAN is carried rather than a boolean, because the
      // sentence quotes its length. The first overlapping span wins: the guard's
      // own windows are mutually non-overlapping by construction
      // (`protectedCapacity`'s greedy is a disjoint set), so there is never a
      // second one to choose between.
      //
      // ⚖ FIX ROUND F1 — asked of the EXTENT rather than the span. Two extents
      // can touch where one 60-minute slot straddles two held windows; `find`
      // keeps taking the first, which is the same honest ceiling the taker
      // lookup already declares, and both windows quote the same dial anyway.
      const reserved = heldExtents.find((h) => c.start < h.end && h.start < end)
      const taker = advertised || reserved ? undefined : roomDrops.find((d) => overlaps(d.h, d.h + SELL_SLOT_MIN, c.start, end))
      per.set(
        c.start,
        railExplain(c, opts.dur, {
          room:
            c.reason === 'bed' && staff
              ? allocateBed(lanes, {
                  id: opts.handId,
                  currentBed: null,
                  stores: staff.stores,
                  // ⚖ ROOM RULE — the HAND's own tag, or none. A rail cell with
                  // nothing in hand asks about a placement nobody has made yet,
                  // so there is no booking to carry a 個室のみ tag — the same
                  // hypothetical `bedDoor` binds for the marks themselves. With
                  // a card in hand there IS one, and the strip has to answer the
                  // question the drop will ask (fix round 1, lens 1 F3) — on the
                  // gestures that reach this lookup at all: a BED-LANE drag, a
                  // RESIZE and a drag OVER THE SHELF. The ordinary staff-row move
                  // returns above it on `opts.inHand`, so it never gets here
                  // (fix round 3, delta2 lens 4 D8; the reachability truth is
                  // spelled once, at the lookup).
                  requiresPrivate: handItem?.requiresPrivateRoom === true,
                  start: c.start,
                  end,
                  stagedId: opts.stagedId,
                })
              : null,
          adless: !advertised && reserved == null && opts.sellDisplayed,
          takerLabel: taker?.takerLaneKey != null ? (lanes.find((l) => l.key === taker.takerLaneKey)?.label ?? null) : null,
          reservedDur: reserved ? reserved.dur : null,
        }),
      )
    }
    out.set(rail.laneKey, per)
  }
  return out
}

/** ⚖ LIAM flag 88 (2026-08-30) — THE HATCH IS ABOUT EMPTY TRACK, and only that.
 *
 *  The rest cue is the quarter-strength 清掃 wash `renderLane` paints under the
 *  half hours whose chip wears a word: 「this 30 minutes is refused, and what
 *  refuses it is not drawn on this row」. Painted UNDER a 販売可能枠 / 詰め込み /
 *  スキマ枠 box it contradicts the box on top of it, and Liam read exactly that
 *  as a rendering artifact — the ruled mock only ever hatched genuinely empty
 *  track.
 *
 *  So the WORD does not narrow and the dot does not narrow: a start really can
 *  be advertised at one length and refused at another (a 30-minute スキマ枠 on a
 *  row with no room for a 60-minute session), and the chip is where that is
 *  said. Only the LANE PAINT narrows, because the lane is where the two
 *  drawings would sit on top of each other.
 *
 *  Half-open on both sides, the same `overlaps` grammar as everything else that
 *  compares spans on this board: a box that ENDS at the cue's start is not over
 *  it, and one that BEGINS at the cue's end is not either. */
export function restCueStarts(
  explained: ReadonlyMap<number, { word: string | null }>,
  /** This lane's advertised hours, spanning `[h, h + SELL_SLOT_MIN)`. */
  sellHere: readonly SellCell[],
  /** …and its 詰め込み／スキマ枠 promises, which advertise the span they draw. */
  gapHere: readonly GapCell[],
  /** ⚖ SPEC-SELLING-ENGINE §2's registry, consumer (c) — …and its 新規用に確保
   *  spans, which are not empty track either. E3b paints the 確保 chip over
   *  them; a quarter-strength 清掃 wash under that chip is flag 88's artifact
   *  reappearing one layer along, so the cue stands down over a held span for
   *  the same reason it stands down over a price box. EMPTY = the round gate is
   *  off and the cue is byte-identical to today's. */
  heldHere: readonly ReservedSpan[] = [],
): number[] {
  // 30 is the rail's own step and so the cue's own width — the same span
  // `renderLane` gives the mark it paints from each start returned here.
  const covered = (start: number) =>
    sellHere.some((s) => s.h < start + 30 && start < s.h + SELL_SLOT_MIN) ||
    gapHere.some((g) => g.s < start + 30 && start < g.e) ||
    heldHere.some((h) => h.start < start + 30 && start < h.end)
  return [...explained]
    .filter(([, e]) => e.word != null)
    .map(([start]) => start)
    .filter((start) => !covered(start))
}

/** ⚖ LIAM flag 58 RIDER (2026-08-22) — AN ENGINE START IS NOT YET AN OFFER.
 *
 *  The guard walks a FIVE-minute lattice (`LATTICE_STEP_MIN`, gap-guard :28) and
 *  a pocket begins wherever the previous booking ended, so
 *  `nearestBestAlternatives` legitimately answers 11:45 or 13:15. The board does
 *  not: a booking snaps on the store's `bookingStepMin` and a 予定ブロック on its
 *  `blockStepMin`. Offering 「11:45に置く」 therefore created a placement the
 *  drag lattice can never reproduce and the rail can never mark — Liam's own
 *  reading of his canon shots, whose advice offers :00/:30 starts.
 *
 *  Canon does not filter; its demo pockets simply start on the half hour. So
 *  this is our board's own grammar gap, and it is closed at the PRESENTATION
 *  seam rather than in the engine (frozen) or per button (⚖ 31c's disease: a
 *  button that can lie about what it will do).
 *
 *  SNAP, THEN RE-VERIFY — never blind-snap: an off-lattice start becomes the
 *  legal start below it, or the one above if that one does not survive the
 *  caller's own gate. `ok` IS that gate — `verdictAtLanding` for a booking,
 *  `blockClash` for a block — so nothing is ever offered that the release
 *  itself would refuse. An alternative that collapses onto the start the
 *  operator already tried is dropped: they are looking at it. */
export function offerableCell(
  cell: RailCell | null,
  stepMin: number,
  attempted: number,
  ok: (start: number) => boolean,
): RailCell | null {
  if (!cell || cell.alternatives.length === 0) return cell
  // ⚖ AMENDMENT 2, N1 — THE SAME FOOT-GUN AS `nearestFreeStarts`, on the same
  // dial. `bookingStepMin` is heading for operator control (⚠SETTINGS-BATCH), and
  // a zero step makes the snap below arithmetic nonsense: `s % 0` is NaN, so the
  // off-lattice branch is taken and `Math.floor(s / 0) * 0` is NaN too — every
  // candidate is garbage and the gate is asked about starts that do not exist.
  // No lattice means nothing this function can honestly offer, so it offers
  // nothing rather than something meaningless.
  //
  // ⚖ 92 fix round 2 S5 (stress lens #8) — AND THE TEST IS `!(stepMin > 0)`,
  // NOT `<= 0`. NaN fails every comparison, so a settings text input that hands
  // this a NaN step walked straight past the old gate into the same arithmetic
  // the gate exists to refuse — and the card put 「NaN:NaNに置く」 on its biggest
  // control.
  //
  // ⚖ 92 fix round 10 V1 (breaker #9 #1) — AND THE STEP MUST BE FINITE, NOT
  // MERELY POSITIVE. S5's own closing claim was false: it said the only value
  // newly caught was the one that is not a number, and Infinity IS a number
  // greater than zero. It sailed through, `s % Infinity` is `s` — never 0 — so
  // every start took the off-lattice branch, where `Math.floor(s / Infinity) *
  // Infinity` is `0 * Infinity` = NaN: 「NaN:NaNに置く」 back on the biggest
  // control, through the gate written to stop it. A settings field reaching
  // `Number('1e400')` or a bare `Infinity` is the same text input S5 named.
  // Behaviour-identical for every finite step; ±Infinity and NaN now share the
  // one door.
  //
  // ⚖ 9/1, THE SETTINGS ROUND (fix round 1 F8) — AND THE CLAUSE THAT USED TO
  // STAND HERE IS DELETED, NOT CORRECTED. It said `guardRailsFor` could keep the
  // weaker `<= 0` spelling because 「the rail comes back short rather than wrong
  // — a degeneracy, not a lie on a control」. The settings round's own M1 red-run
  // disproved it on a NaN step: the rail painted ONE cell at `input.open` and
  // then ended, so it did not come back short, it came back WRONG about the rest
  // of the day. That sibling now carries this same guard (:1703) and says so.
  if (!(Number.isFinite(stepMin) && stepMin > 0)) return { ...cell, alternatives: [] }
  const out: number[] = []
  for (const s of cell.alternatives) {
    const candidates = s % stepMin === 0 ? [s] : [Math.floor(s / stepMin) * stepMin, Math.ceil(s / stepMin) * stepMin]
    // Two engine starts that land on the same legal step are ONE offer, and the
    // duplicate is dropped rather than walked to its other neighbour: the
    // neighbour was never scored as a better start, so offering it would put
    // 「より損の少ない開始」 on a start the engine never said that about.
    if (candidates.some((c) => out.includes(c))) continue
    for (const c of candidates) {
      if (c === attempted) continue
      if (ok(c)) { out.push(c); break }
    }
  }
  return { ...cell, alternatives: out }
}

/** ⚖ LIAM flag 73 RIDER (2026-08-23) — A BED REFUSAL'S OWN CANDIDATE STARTS.
 *
 *  THE BILL THIS PAYS: `landingVerdict` carries the GUARD's cell through every
 *  refusal class (`stop` keeps `cell` unchanged), so a 満室 board whose staff
 *  lane happens to be guard-safe handed the popover a cell with no alternatives
 *  in it, and the popover picks its line off `alternatives.length` alone — 「この
 *  区間に、より損の少ない開始はありません」 printed over a full house. That is
 *  the wrong question answered confidently, which is worse than silence. The
 *  guard was never asked about rooms and has no opinion about them.
 *
 *  ⚖ 58's law is about the FILTER, and the filter is still one: these starts go
 *  through `offerableCell` exactly as the engine's do, with the caller's own
 *  gate. What is class-appropriate is the SOURCE — and `ok` is the whole search,
 *  because the gate already runs `allocateBed` whenever the question solves a
 *  room, so a start that survives it is room-free by construction.
 *
 *  CANON'S OWN OFFER GRAMMAR, deliberately: `nearestBestAlternatives` (gap-guard
 *  :295-317) answers with the nearest better start BEFORE and the nearest AFTER,
 *  never a list. Two offers is what this board's operators already read on every
 *  guard refusal, so a room refusal that answered with six would be a second
 *  grammar for the same box. */
export function nearestFreeStarts(
  attempted: number,
  stepMin: number,
  hours: Hours,
  dur: number,
  ok: (start: number) => boolean,
): number[] {
  // ⚖ AMENDMENT 1, lens-1 F8 — `bookingStepMin` is an operator dial (⚠SETTINGS-
  // BATCH) and a zero or negative step would walk this loop forever, taking the
  // board's whole render thread with it. A refusal box is not the place to find
  // out a store typed 0 into a settings field: no step means no lattice to walk,
  // and no lattice means nothing to offer.
  //
  // ⚖ 9/1, THE SETTINGS ROUND'S RIDER — the SAME shape as `guardRailsFor`'s
  // sibling guard, landed in the same commit as the 予約の刻み field that can
  // finally produce a non-number. ⚠ AND IT IS THE HONEST HALF OF THAT PAIR:
  // unlike the rail's, this guard changes NO behaviour. A NaN step makes
  // `attempted + dir * stepMin` NaN, and `NaN >= hours.open` is false, so the
  // loop never ran and this already returned `[]` — measured, not assumed. It is
  // kept because a reader may not be left to work that out from the arithmetic:
  // the two siblings now refuse the same inputs in the same words, and neither
  // is safe only by accident. The packet's 「nearestFreeStarts can HANG on NaN」
  // does not reproduce; the rail's silent-wrong-answer, next door, does.
  if (!(Number.isFinite(stepMin) && stepMin > 0)) return []
  const out: number[] = []
  for (const dir of [-1, 1] as const) {
    for (let s = attempted + dir * stepMin; s >= hours.open && s + dur <= hours.close; s += dir * stepMin) {
      if (ok(s)) {
        out.push(s)
        break
      }
    }
  }
  return out.sort((a, b) => a - b)
}

/** ⚖ 73 RIDER — THE SOURCE SELECTOR (T4's one, keyed on the verdict's class).
 *
 *  Everything except a room refusal keeps the engine's own starts, untouched —
 *  the guard ranked them and this has no better opinion. A room refusal swaps in
 *  starts whose ROOM is free, because that is the question it was asked.
 *
 *  `starts` is a thunk so the sweep is not paid for on the eight classes that do
 *  not use it. A null cell is the board's existing word for "nothing to offer"
 *  (the keyboard nudge sets it deliberately — Shift/Alt cannot change a start,
 *  ⚖ 31c) and it is honoured rather than grown a button those paths cannot
 *  perform. `alternativeKind: null` because 「損を減らす」 is a RANKING and this
 *  is not one: these starts are where a room exists. */
export function bedClassCell(v: LandingVerdict, starts: () => number[]): RailCell | null {
  if (v.floor !== 'hard-room' || !v.cell) return v.cell
  return { ...v.cell, alternatives: starts(), alternativeKind: null }
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
    // ⚖ FIX ROUND 1 (blind lens 4 F6) — AND THE 個室のみ TAG RIDES THE SHELF TOO.
    // The shelf is exactly where the operator re-places a parked card, and the
    // one fact that will refuse the drop was invisible there: the card said
    // 個室のみ and its own chip said only 「VIP 月額」.
    line1: `${durMin}分${tkt ? `・${tkt}` : ''}${item.requiresPrivateRoom === true ? '・個室のみ' : ''}`,
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
 *  feat/business-transplant-today carries the fuller design (store +
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
  home: { dayOffset: number; store: string | null },
  shownDayOffset: number,
  shownStoreParam: string | null,
  originOnShownDay: boolean,
): 'here' | 'elsewhere' | 'gone' {
  if (home.store !== shownStoreParam) return 'elsewhere'
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
  home: { store: string | null; storeLabel: string },
  shownStoreParam: string | null,
): string | null {
  if (home.store === shownStoreParam) return null
  return `${home.storeLabel}の予約です。${home.storeLabel}のボードに切り替えてから置いてください（×で元の枠に戻せます）`
}

/** canon `createAtCell` (:6005) via the F25 empty-slot click: the half hour the
 *  pointer landed on, clamped so a created booking cannot start after closing.
 *
 *  ⚖ Liam flag 62 (2026-08-22) — FLOOR, NOT ROUND. Canon's `ghostCellX`
 *  (:5989-5993) floors: a click anywhere in [11:00, 11:30) seeds 11:00. We
 *  rounded, so [11:15, 11:45) jumped FORWARD to 11:30 and a standard session
 *  seeded there ran into the next booking — Liam's 「the left half works, the
 *  right half fires 時間帯が重複」. One token, canon parity. */
export function slotStartAt(track: Element, clientX: number, hours: Hours, stepMin = 30): number {
  const minute = hours.open + fractionIn(track, clientX) * (hours.close - hours.open)
  return Math.max(hours.open, Math.min(hours.close - stepMin, Math.floor(minute / stepMin) * stepMin))
}

/** ⚖ Liam flag 62 (2026-08-22) — THE SEED IS CLAMPED INTO THE POCKET IT LANDED IN.
 *
 *  Flooring doubles the working area but a click at 11:40 in an 11:00–12:00
 *  pocket still seeds 11:30〜12:30 and collides. Canon does not clamp either —
 *  it checks only the PARTNER lane (`laneFreeAt` :6022-6028) and never its own —
 *  so this is one of the places copying canon exactly is not enough.
 *
 *  SHORTEN, NEVER OVERFLOW: the start slides back to the last position where the
 *  full session fits; if the pocket itself is shorter than the session, the seed
 *  takes the pocket's own length. A click outside every pocket is left alone —
 *  the guard owns that refusal and it must keep hearing the honest ask. */
export function seedSpanIn(
  lane: BoardLane,
  start: number,
  sessionMin: number,
  hours: Hours,
  nowMinute: number | null,
): { start: number; end: number } {
  const plain = { start, end: Math.min(start + sessionMin, hours.close) }
  if (lane.window == null) return plain
  const pockets = freePockets({
    from: lane.window.from,
    until: lane.window.until,
    close: hours.close,
    now: nowMinute,
    occupied: laneSpans(lane),
  })
  const pocket = pockets.find((p) => start >= p.s && start < p.e)
  if (!pocket) return plain
  const clamped = Math.max(pocket.s, Math.min(start, pocket.e - sessionMin))
  return { start: clamped, end: Math.min(clamped + sessionMin, pocket.e) }
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

/** ⚖ R8 GAP-11 — THE CARD IN HAND SAYS THE TIME UNDER THE CURSOR.
 *
 *  A card being CARRIED shares its face with the one standing on the board
 *  (`cardFace`), and that face prints the booking's committed start — so for the
 *  whole gesture the thing in the operator's hand advertised where it came FROM
 *  while the dashed landing under it said where it was going. Two answers to one
 *  question, which is ⚖ 54's disease on the one surface the eye is actually on.
 *
 *  `liveStartMin` is the landing the ghost is already drawn from, in minutes;
 *  `null` means there is no landing to speak of (nothing in flight, over the
 *  shelf, off the board) and the card keeps the label it rests with. The
 *  grammar is `today-board`'s own — `${hhmm(startMinute)}〜`, start only
 *  (:423) — reused rather than re-spelled, so a card in hand and the same card
 *  at rest can never format one minute two ways.
 *
 *  ⚖ FIX ROUND 1 (blind round 1, L1 F2) — AND THE SAME LIE WAS ON THE BLOCK.
 *  A 休憩/予定ブロック in flight printed the time it came FROM too, for exactly
 *  the reason the card did, so it gets the same answer here rather than a
 *  second author on the same board. Its face is the OTHER grammar today-board
 *  writes — `${hhmm(start)}〜${hhmm(end)}` (:462 休憩, :472 block), a span and
 *  not a start — so an end minute, when the caller has one already in render,
 *  selects it; no end, and the start-only card grammar stands. */
export function proxyTimeLabel(restTime: string, liveStartMin: number | null, liveEndMin: number | null = null): string {
  if (liveStartMin == null) return restTime
  return liveEndMin == null ? `${hhmm(liveStartMin)}〜` : `${hhmm(liveStartMin)}〜${hhmm(liveEndMin)}`
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

/** ⚖ STORE ISOLATION — CAN THESE TWO LANES BE THE SAME BOOKING'S PAIR?
 *
 *  Canon's `canPair` (availability.ts:51) is the rule: a lane belonging to no
 *  particular store (`null`) pairs with anything, and otherwise the two have to
 *  SHARE a store. It is re-spelled here against the raw lists rather than called,
 *  because canPair reads the sell layer's flattened shapes and that flattening is
 *  the known A-5 defect — `sellResourceLanes` collapses a room to
 *  `stores?.[0] ?? ''`, so a multi-store room answers for one store and a
 *  floating room answers for none. Comparing whole arrays does not inherit it.
 *
 *  ONE HOME, because there are two ways a booking gets a room and they must not
 *  drift: `allocateBed` uses it as a FILTER when the board is choosing (a room in
 *  another store is not a candidate), and the confirm's check rows use it as a
 *  TEST when the operator chose the room themselves on a bed row — that gesture
 *  never reaches the allocator, which is how a staff/room pair in two different
 *  stores could be committed under the all-stores lens (Greptile #725). */
export function sharesStore(a: string[] | null, b: string[] | null): boolean {
  return a === null || b === null || a.some((s) => b.includes(s))
}

/** ⚖ ROOM RULE (Liam 2026-09-05) — CAN THIS BOOKING USE THIS ROOM, spelled ONCE.
 *
 *  The same two-sided shape as `sharesStore`, for the same reason, and these are
 *  its callers by name: `allocateBed`'s `compatible` uses it when the board is
 *  CHOOSING a room, `landingVerdict`'s bed-row stop uses it as a TEST when the
 *  operator named the room out loud, and `capacity-ledger`'s `usable` uses it to
 *  say which rooms exist for an asker at all. A rule with two spellings is a
 *  rule with two answers (Greptile #744 P1) — and the bed-row test WAS the
 *  second spelling until fix round 1 (blind lens 1 F1) put it back through here.
 *
 *  AND IT IS ONE-SIDED NOW. The room class is an ORDER, never a filter: a plain
 *  booking may use ANY room in its store, the 個室 included, so the only thing
 *  that can narrow the candidates is the booking's own 個室のみ tag. That is why
 *  a store with no private room can no longer refuse a plain booking for a room
 *  reason — the case the shipped board got wrong on its own fixture (STORE_B has
 *  one standard bed and answered 「使える個室がありません」 to a VIP all day). */
export function roomFitsNeed(lane: BoardLane, requiresPrivate: boolean): boolean {
  return !requiresPrivate || lane.roomClass === 'private'
}

/** ⚖ ROOM RULE clause 1 — STANDARD ROOMS FIRST, 個室 LAST, and it is LAW rather than a
 *  dial: no store has asked to spend its private room first, and a lever with
 *  one legal setting is the dead lever this board keeps removing.
 *
 *  ONE HOME, because two layers order rooms: `allocateBed` when it hands a
 *  booking a room, and `fallback-cells` when it walks the rooms a lost offer
 *  could fall into. They used to be two copies of the same three lines. Stable
 *  within each class, so board order still decides between two standard rooms. */
export function orderRooms(rooms: readonly BoardLane[]): BoardLane[] {
  return [...rooms.filter((l) => l.roomClass !== 'private'), ...rooms.filter((l) => l.roomClass === 'private')]
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
 *  auto-solved — that path keeps batch-6's stage-with-確定-disabled behaviour,
 *  and gets the store rule as a check row rather than as a filter (`sharesStore`).
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
    /** ⚖ ROOM RULE — 個室のみ, read off the BOOKING's own tag and never off the
     *  customer. Sitting in the 個室 grants nothing: an untagged booking in it
     *  moves to any free room with no verdict and no manager. */
    requiresPrivate: boolean
    start: number
    end: number
    /** ⚖ Liam flag 50(d) (2026-08-22) — 「注意して配置」. An operator the store
     *  has given the authority has already been told this landing is 置けない
     *  and has said it happens anyway, so the search stops asking whether the
     *  room is free and names the one it would otherwise have chosen. The
     *  COMPATIBILITY rules are untouched — an escalation over a busy room is not
     *  permission to put a 個室のみ booking on a standard bed (the tag is a rule
     *  about what the treatment needs, not about who is in the way).
     *
     *  ⚖ LIAM flag 73 (2026-08-23) — UNREACHABLE FROM THE BOOKING SURFACES, and
     *  left standing rather than removed. 満室 is now a `hard-room` floor, so no
     *  booking gesture can produce an override on it and every `solveBed` caller
     *  passes nothing here. The branch stays byte-untouched because it is the
     *  allocator's own honest answer to "which room WOULD you have chosen", and
     *  because 73 is a product ruling that Liam may overturn — deleting the
     *  answer would make the overturn a rebuild. Nothing on the board reaches
     *  it today; its unit facts are still pinned. */
    allowBusy?: boolean
    /** ⚖ R3 ONE WORLD (2026-08-25) — THE OPERATOR'S OWN 仮押さえ.
     *
     *  A staged 仮押さえ is real for every reader, so it can and does turn up as
     *  a blocker in this refusal. It is still the truth (the room IS taken), and
     *  suppressing it would be the excluded world coming back in through the
     *  sentence — but a line that names the operator's own card the same way it
     *  names a stranger's reads as a stranger's, and they go looking for a
     *  customer who is not there. So the fact is kept and the ATTRIBUTION is
     *  said out loud.
     *
     *  It arrives as an argument rather than being read off the board because
     *  "which move is unconfirmed" is screen state (`pending`), not a fact about
     *  the day — today-board draws a staged card exactly like a standing one. */
    stagedId?: string | null
  },
  // ⚖ 44 FIX ROUND (blind lens 1, F6) — `readonly`: the walk is handed out to be
  // READ (classified into the chip's word), never to be sorted or spliced by the
  // display that borrowed it.
): { laneKey: string | null; refusal: string | null; blockers: readonly BoardItem[] } {
  const { id, start, end } = opts
  const blockersOn = (lane: BoardLane) =>
    lane.items.filter(
      (i) =>
        (id == null || (i.caseId !== id && i.key !== `${id}-cleanup`)) &&
        i.endMin > start &&
        i.startMin < end,
    )
  // ⚖ STORE ISOLATION where the allocator CHOOSES a room. The explicit bed-side
  // gesture never reaches here — the operator picked the room out loud — so the
  // same predicate is applied to that landing as a confirm-blocking check row;
  // see `sharesStore` for why there is only one spelling of the rule.
  const beds = lanes.filter((l) => l.group === 'beds' && sharesStore(opts.stores, l.stores))
  const compatible = (l: BoardLane) => roomFitsNeed(l, opts.requiresPrivate)
  const free = (l: BoardLane) => opts.allowBusy === true || blockersOn(l).length === 0
  const current = beds.find((l) => l.key === opts.currentBed)
  if (current && compatible(current) && free(current)) return { laneKey: current.key, refusal: null, blockers: [] }
  const candidates = beds.filter(compatible)
  // ⚖ ROOM RULE clause 1 — standard rooms first, 個室 last, ALWAYS. `orderRooms` is the
  // one home for that; a tagged booking's candidates are private-only anyway, so
  // the same call is correct on both branches and there is nothing to switch on.
  const ordered = orderRooms(candidates)
  const taken = ordered.find(free)
  if (taken) return { laneKey: taken.key, refusal: null, blockers: [] }
  // ⚖ 44 — THE SAME WALK, HANDED OUT ONCE. The refusal SENTENCE names the
  // occupants and the rail's micro-word has to CLASSIFY them (all-清掃 wears
  // 清掃 rather than 満室), and a display that re-walked the rooms to find that
  // out would be a second reading of the one thing this function just decided —
  // free to disagree with the sentence sitting beside it. One walk, both
  // answers. Empty on every non-refusal above: nothing blocked, so there is
  // nobody to name.
  const rows = candidates.map((l) => [l, blockersOn(l)] as const)
  return {
    laneKey: null,
    refusal: fullRoomsRefusal(rows, start, end, opts.requiresPrivate, opts.stagedId ?? null),
    blockers: rows.flatMap(([, blockers]) => blockers),
  }
}

/** ⚖ LIAM flag 76 (2026-08-23) — THE ROOMS, AS THE GUARD ENGINE'S CTX.
 *
 *  canon `ctxFor(day, lane).placementFeasible` (fable-store-today.html :7278-
 *  7285). The 60分配置 strip runs through the same evaluator canon's rail does
 *  (`railAimFor` = `evaluateExactAim`, :7365), so it has to hear the same bed
 *  truth — the transplant carried the pockets and dropped the callback, and the
 *  strip painted ✓14:30 on a board whose three rooms were all busy.
 *
 *  It is `allocateBed` and NOT a second reading of the beds: the strip and the
 *  release ask one search, so they cannot disagree (which is the whole of flag
 *  54, read from the resting board). Everything the allocator already spells
 *  rides along — the store rule (⚖ 46), the 個室 floor (⚖ 51), and both
 *  exclude-self rules: the card in hand and its own trailing 清掃 travel WITH
 *  the booking rather than blocking it (`${id}-cleanup`, :1434), which is canon
 *  lifting the placed card for rail truth (:7534).
 *
 *  `undefined` on a store with no rooms configured — canon's own
 *  `SCENARIO.needsBed === false` switch (:7261), and the engine consults a
 *  callback only when there is one (gap-guard :271-272). A store that has
 *  configured no resources is not a store that cannot sell.
 *
 *  It lives here rather than in the screen for this file's stated reason: an
 *  answer the operator acts on has to be provable without a renderer.
 *
 *  ⚖ R3 (2026-08-25) — A TEST ORACLE NOW, AND NOTHING ELSE. The board reads the
 *  capacity book through `bedDoor` (TodayScreen); this function has NO
 *  production callers, and a pin in the screen's suite forbids it being
 *  imported there again (`expect(SRC).not.toContain('bedFeasibility(')`).
 *
 *  It is kept, deliberately, because it is the LEGACY COUNTERPART the parity
 *  battery compares the book against — `capacity-ledger-parity.test.ts` drives
 *  it on the real board, on synthetic boards and across the dials, and the
 *  flag-76 unit contracts use it as the oracle their book leg must match.
 *  Deleting it would delete the comparison, not the dead code. */
export function bedFeasibility(
  lanes: BoardLane[],
  excludeId: string | null,
): ((lane: BoardLane, start: number, dur: number) => boolean) | undefined {
  if (!lanes.some((l) => l.group === 'beds')) return undefined
  const held = excludeId ? lanes.flatMap((l) => l.items).find((i) => i.caseId === excludeId) : undefined
  const currentBed = excludeId
    ? (lanes.find((l) => l.group === 'beds' && l.items.some((i) => i.caseId === excludeId))?.key ?? null)
    : null
  // ponytail: the engine probes a 5-minute lattice per pocket per rail cell, so
  // the same (lane, start, dur) question arrives dozens of times per frame. One
  // map keyed by the question, dying with the board it was built for. Lift it to
  // a shared cache only if a bigger board ever measures slow.
  const seen = new Map<string, boolean>()
  return (lane, start, dur) => {
    const key = `${lane.key}|${start}|${dur}`
    const hit = seen.get(key)
    if (hit !== undefined) return hit
    const free =
      allocateBed(lanes, {
        id: excludeId,
        currentBed,
        stores: lane.stores,
        // ⚖ ROOM RULE — the BOOKING's own tag, never the customer's badge.
        requiresPrivate: held?.requiresPrivateRoom === true,
        start,
        end: start + dur,
      }).laneKey !== null
    seen.set(key, free)
    return free
  }
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
  /** ⚖ LIAM flag 74 (2026-08-23) — THE PAIR A LANDING IS PROPOSING, for the red
   *  box, which asks about a landing that has NOT happened. Membership answers
   *  for the lanes the booking is currently on — its ORIGIN — so without this
   *  the one box would describe the spot the operator is trying to leave. Same
   *  sentence, one home: the refusal and the confirm may not word the same
   *  landing two ways. */
  proposed: {
    staffLane: string | null
    bedLane: string | null
    /** ⚖ AMENDMENT 3 (Greptile, 8/23) — THE NAME THE CALLER ALREADY KNOWS.
     *
     *  This function reads identity off the DRAWN board, which is right for
     *  every landing whose card is on it. Two are not: a 次回予約 that does not
     *  exist yet, and a chip still sitting on the shelf. Their refusal boxes
     *  therefore asked an approval question about nobody — and both callers knew
     *  the answer the whole time (the armed 配置モード carries its customer, the
     *  chip carries its own title).
     *
     *  The law this does NOT break: never invent a name the board cannot show.
     *  A name handed in by the hand that is holding the card is not invented,
     *  and it is only ever consulted when the board itself has no card to read. */
    title?: string
  } | null = null,
): string {
  if (!at) return ''
  const staffLane = proposed
    ? lanes.find((l) => l.key === proposed.staffLane && l.group === 'staff')
    : lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === id))
  const bedLane = proposed
    ? lanes.find((l) => l.key === proposed.bedLane && l.group === 'beds')
    : lanes.find((l) => l.group === 'beds' && l.items.some((i) => i.caseId === id))
  // Board-wide: a PROPOSED pair names lanes the card is not standing on yet, and
  // the customer's name has to come off the card wherever it actually is — or,
  // when there is no card anywhere, off the caller that is holding it (⚖ A3).
  // The board is asked FIRST either way, so a drawn card can never be overridden
  // by a stale name from a hand that is holding something else.
  const title = lanes.flatMap((l) => l.items).find((i) => i.caseId === id)?.title ?? proposed?.title
  const from = minuteOf(at.x, hours)
  const to = minuteOf(at.x + at.w, hours)
  const moved =
    bedFrom != null && bedLane != null && bedFrom !== bedLane.key
      ? `${lanes.find((l) => l.key === bedFrom)?.label ?? bedFrom} → `
      : ''
  // ⚖ 74 / ⚖ A3 — a landing nothing can name still says the rest: a bare 「様 →」
  // is a sentence about nobody, so the name is omitted rather than faked. With
  // ⚖ A3 the only landing that reaches this is a plain 新規予約, which stages
  // nothing and has no customer yet by definition.
  //
  // ⚖ FIX ROUND 3 (delta2 lens 3 M1) — AND THE ROOM SEGMENT OBEYS THE SAME LAW.
  // 「/ —」 is the shape Liam rejected on 8/22, and fix round 2 removed it by
  // deleting the whole SENTENCE on the boxes that produce it — which took the
  // customer, the window and the staff member with it, on the two landings that
  // have no card drawn to read them off (an armed 配置モード and a shelf chip),
  // under two buttons that COMMIT a placement. Omit what cannot be stated, never
  // the rest of the sentence: no room in hand, no room segment, and the em-dash
  // is gone here — at the source — for every caller at once.
  return `${title ? `${title}様 → ` : ''}${clockOf(from)}〜${clockOf(to)} / 担当 ${staffLane?.label ?? '—'}${bedLane ? ` / ${moved}${bedLane.label}` : ''}`
}

/** ⚖ FIX ROUND 3 (delta2 lens 2 F1 · lens 4 D6) — WHICH ROWS THE REFUSAL BOX
 *  EARNS, AS A RULE THAT CAN BE ASKED.
 *
 *  It lived inside `explainBlocked`, inside the component, and this suite never
 *  renders the screen — so the only armour available was four byte-exact copies
 *  of the expression's own source text, and lens 2 walked three DIFFERENT gates
 *  through the whole battery green once those four strings were edited to match.
 *  A rule with no seam has no proof. This is the seam.
 *
 *  The rule: rows render when the landing read them, EXCEPT where it asked for a
 *  room and got none. On the 満室 box every row is ✓ — or nearly, since 満室
 *  outranks the policy stop and a landing that is also 勤務時間外 carries a real
 *  × — about a room nothing ever checked, under a sentence that already said the
 *  room is the problem. The SUMMARY is not part of this question: it is the box's
 *  identity line and it is always composed, because `holdSummary` now leaves out
 *  the room it cannot name.
 *
 *  ⚖ FIX ROUND 4 (delta3 lens 3 X3) — AND THE GATE IS PRICED HONESTLY. It asks
 *  「did a room come back?」, and that is WIDER than 満室: a CLASH whose room also
 *  failed returns first with `bedLane` already null, so it is hidden when no room
 *  came back, which includes a CLASH that also failed its room. That box's
 *  sentence names a PERSON (「時間帯が重複: ◯◯」) and the rows it loses include
 *  the very × the sentence names, so the 「every row is ✓」 argument does not
 *  describe it — what it loses is the ✓ context, and the blocking fact is already
 *  in the sentence. Recorded rather than believed narrower than it is; the
 *  narrower gate, if it is ever wanted, is 「hide when the FLOOR is hard-room」.
 *
 *  ⚖ FIX ROUND 4 (delta3 lens 4 E2) — the CALLER stands the guard row down on the
 *  same answer. A room refusal that also loses its lane would otherwise draw the
 *  guard's loss row ALONE under a room sentence — ⚖ 73's rider, one surface over.
 *
 *  It takes the ASK, not a bare boolean (delta3 lens 2 §c): the call site sits
 *  inside a component this suite never renders, so a loose `boolean` argument
 *  could be inverted there and nothing behavioural would notice. `solveRoom` is
 *  the whole condition. The two landings that carry no room AND solve none never
 *  asked, so nothing about a room is being suppressed for them: 新規予約を作成
 *  opens a FORM (the bed is chosen in the dialog) and keeps its rows, and the
 *  release over no lane never reaches here at all — its `staffLane: null` returns
 *  above the rows in `landingVerdict`. */
export const factsRowsShown = (
  v: Pick<LandingVerdict, 'bedLane' | 'checks'>,
  ask: { solveRoom: boolean },
): boolean => v.checks.length > 0 && !(v.bedLane === null && ask.solveRoom)

/** ⚖ flags 44 + 51 — a full house, said the way the board says every other
 *  refusal: the exact window it judged, then WHY, naming the room and who is in
 *  it. 清掃 and 予定ブロック answer with their own word (they have no customer).
 *
 *  ⚖ NATIVE PASS (2026-08-25) — THE STRUCTURE IS FLAGS 44+51's, THE WORDING IS
 *  NOT. It read 「…はベッドが満室です」, and 満室 takes a counter the sentence
 *  does not give it — a room-by-room count read as a whole-store state. The
 *  native pass ruled 「…に空きがありません」, which is the same fact in the
 *  grammar the operator uses. Structure preserved exactly: the window it judged,
 *  the room word (the 個室 branch is natural either way), then the occupants.
 *  内部の 満室 vocabulary — identifiers, comments, the `hard-room` floor — is
 *  unchanged; this is the operator-visible sentence and nothing else.
 *
 *  ⚖ R3 ONE WORLD (2026-08-25) — AND ONE OF THOSE OCCUPANTS CAN BE THE OPERATOR
 *  THEMSELVES. Now that a staged 仮押さえ is real for every reader, the second
 *  placement into a full house is honestly blocked by the operator's own
 *  unconfirmed move. The room is named exactly as any other busy room is — the
 *  fact is never softened — and the OCCUPANT is labelled 仮押さえ中 so the
 *  operator recognises their own card instead of hunting for a customer who is
 *  not on the board yet. Suppressing the row instead would be the excluded world
 *  smuggled back in at the sentence.
 *
 *  ⚖ FIX-2 (blind round) — 仮押さえ中, NOT 「確定待ちの移動」. `pending` is not
 *  only a MOVE: `placeNextVisit` and `placeFromShelf` write it for placements
 *  that never stood anywhere, so "the unconfirmed move" was factually wrong for
 *  half the cases. 仮押さえ is the board's own word for this state — it is what
 *  the toast says when the card is staged and what the chip wears — and it is
 *  short enough to survive the ・-joined multi-blocker line. */
function fullRoomsRefusal(
  rows: ReadonlyArray<readonly [BoardLane, BoardItem[]]>,
  start: number,
  end: number,
  requiresPrivate: boolean,
  stagedId: string | null = null,
): string {
  const window = `${clockOf(start)}〜${clockOf(end)}`
  const room = requiresPrivate ? '個室' : 'ベッド'
  // ⚖ ROOM RULE clause 5 — A DEAD END GETS THE WAY OUT. 「使える個室がありません」
  // told the operator a true thing they could do nothing with, so the move they
  // can actually make is named instead.
  //
  // ⚖ FIX ROUND 1 (blind lens 3 F15) — WHICH BRANCH REACHES WHICH SENTENCE. This
  // comment used to claim `rows.length === 0` "can now only mean a TAGGED
  // booking at a store with no private room". It cannot: an UNTAGGED booking on
  // a staff lane whose store owns no bed lane at all reaches it too (`beds` is
  // empty, so `candidates` is empty), which is exactly why the `else` arm below
  // is still live and correct code rather than a leftover.
  //
  // ⚖ FIX ROUND 1 (blind lens 3 F6) — AND THE WAY OUT IS ONE THE OPERATOR CAN
  // ACTUALLY TAKE. The first clause used to offer 「個室のみの指定を外す」, a
  // control that exists nowhere in this product (the booking-detail toggle and
  // the menu checkbox are on the S17 rider) — a label promising what the
  // destination cannot do, which is this lane's own 9/4 Greptile lesson. And the
  // verb was wrong: the booking already EXISTS and just got refused, so the
  // operator is 移す-ing it, never 予約する-ing it.
  //
  // ⚖ FIX ROUND 2 (delta lens 3 N8) — AND THE SECOND ARM ANSWERS THE SAME
  // QUESTION AS THE FIRST. Both arms are 「does a usable room exist HERE?」, and
  // only one of them said so: 「14:05〜15:05に使えるベッドがありません」 named a
  // window at a store that owns no bed lane at all, sending the operator hunting
  // the clock for a room that does not exist at any hour.
  if (rows.length === 0) {
    return requiresPrivate
      ? 'この店舗には個室がありません。個室のある店舗へ移してください'
      : 'この店舗には使えるベッドがありません'
  }
  // ⚖ ROOM RULE clause 5 — AND UNTIL WHEN. The name alone left the operator to
  // go hunting the card for the one fact that lets them rearrange by hand, and
  // the blockers are already in this walk's hand. One composer, so the toast,
  // the rail chip, 配置モード and the guard strip all inherit the clock.
  //
  // ⚖ FIX ROUND 1 (blind lens 3 F2/F9/F10, lens 1 F2, lens 4 F3) — ONLY WHEN IT
  // DIFFERS, and for EVERY kind of occupant.
  //
  // The clock was printed on every booking, so the commonest sentence said the
  // same four digits three times — 「10:00〜11:00はベッドに空きがありません。
  // bed-01が使用中（… 10:00〜11:00）、bed-02が使用中（… 10:00〜11:00）」 — and
  // buried the ONE occupant who runs past the window, which is the only fact the
  // clock was added for. In a 7-second toast (`REFUSAL_MS`) that is unreadable.
  // So the window rides ONLY on an occupant whose own window is not the judged
  // one, and a 清掃 or a 予定ブロック earns it on the same terms a booking does:
  // a 15-minute turnaround and a 60-minute session are opposite decisions and
  // the sentence used to hide which one was in the way.
  //
  // ONE template, not two. The staged and plain arms were two copies of one
  // grammar — the very thing the pinned-homes census exists to forbid.
  //
  // ⚖ FIX ROUND 1 (blind lens 3 F9) — 「仮押さえ中の」, not 「仮押さえ中：」. A
  // 〜中： reads as a LABEL OVER A LIST, and with the ・ join both occupants
  // looked staged: the operator concluded their own unconfirmed card was holding
  // the whole room. 「の」 binds the marker to exactly one name.
  const when = (i: BoardItem) => `${clockOf(i.startMin)}〜${clockOf(i.endMin)}`
  const who = (i: BoardItem) => {
    const name =
      i.kind !== 'booking'
        ? i.title
        : stagedId != null && i.caseId === stagedId
          ? `仮押さえ中の${i.title}様`
          : `${i.title}様`
    return i.startMin === start && i.endMin === end ? name : `${name} ${when(i)}`
  }
  //
  // ⚖ FIX ROUND 2 (JP native pass 3) — THE ROOMS ARE LISTED, THE PREDICATE IS
  // SAID ONCE. 「◯◯が使用中」 repeated per room made the reader stop three times
  // and left the sentence ending on a closing bracket with no predicate at all —
  // a 言いさし. Japanese puts the list first and the verb last, and one verb after
  // a list governs every item in it, so nothing is lost.
  //
  // ⚖ FIX ROUND 3 (delta2 lens 4 D4) — AND THE LENGTH CLAIM, MEASURED RATHER
  // THAN ASSERTED. It said 「~8 characters go」; the arithmetic is 6 − 4n, one
  // predicate added and one 「が使用中」 removed per room, so the sentence GROWS
  // by 2 at a single room (55 vs 53 on the tagged pin), breaks even between one
  // and two, and shrinks by 6 at three. The single room is the room rule's own
  // headline scene. The grammar is the reason this shape shipped — list first,
  // one predicate last, no 言いさし — and it stands on its own.
  const named = rows.map(([lane, blockers]) => `${lane.label}（${[...new Set(blockers.map(who))].join('・')}）`)
  return `${window}は${room}に空きがありません。${named.join('、')}が使用中です`
}

// ── ⚖ Liam flag 50 (2026-08-22) — ONE VERDICT, THREE CLASSES ───────────────

/** 置けない (the landing is inert) · 要確認 (legal, costly) · clean (silence). */
export type LandingClass = 'blocked' | 'caution' | 'clean'

/** ⚖ LIAM flag 73 (2026-08-23) — WHICH KIND OF FLOOR REFUSED, and it is the
 *  feature rather than a detail of it.
 *
 *  His ruling: a TRUE 満室 board has no room in it, and 「注意して配置」 over
 *  that is a button offering to do a thing the world cannot do — ⚖ 31c at the
 *  level of physics. So the escalation belongs to the floors that are a
 *  JUDGEMENT (勤務時間外, シフトロック — the mistake-proofing
 *  law's manager-judgement class, whose advise-vs-block level is the settings
 *  batch's own dial) and never to the floors that are a FACT (a person already
 *  in the room, a room that is full, a placement the engine calls impossible,
 *  another store's board).
 *
 *  `hard-room` is `hard` — the override gate tests for `policy` and nothing
 *  else — carrying the one extra thing the surface needs: a full house is a
 *  question about ROOMS, so the starts it offers must be the ones whose room is
 *  free, not the guard's loss ranking for a lane that was never the problem. */
export type LandingFloor = 'hard' | 'hard-room' | 'policy'

/** ⚖ 73 — the ONE hard row the frozen engine emits. `computeChecks`
 *  (drag-rules :195-229) carries no class field and may not be edited, so the
 *  class is read off the row that failed: a person cannot be in two places
 *  (:210), while 「…以降勤務不可」 (:220) and 「…はシフトロック中」 (:224) are
 *  the store deciding how it wants to work. This is the only row built with a
 *  fixed PREFIX rather than a name, which is why the prefix is the test. */
const CLASH_ROW = '時間帯が重複'

/** canon's ghost glyphs (`updateGhost` :7619-7645). Canon prints 「置ける」 on a
 *  clean landing; ⚖ Liam's own reading of his demo is SILENCE there — a word
 *  that is always true while the operator is aiming at open space is noise, and
 *  the dashed landing preview already says where it will go. The two refusal
 *  flavours canon splits (grey `no-target`, red `refused`) are one word here for
 *  the same reason: to the operator they are the same fact — it will not land. */
export const VERDICT_WORD: Record<LandingClass, string> = {
  blocked: '置けない',
  caution: '要確認',
  clean: '',
}

export interface LandingVerdict {
  kind: LandingClass
  /** ⚖ 73 — WHICH FLOOR refused, `null` when nothing did. Set at each `stop`,
   *  so the classification is a literal at the site that knows the answer and
   *  no consumer ever re-derives it from the sentence. */
  floor: LandingFloor | null
  /** The word the cursor wears. Empty on a clean landing. */
  label: string
  /** WHY, in the board's existing vocabulary — `computeChecks`' own sentence for
   *  a conflict/勤務/ロック, `allocateBed`'s 満室 sentence, ⚖ 46's store sentence,
   *  or the guard's own line. `null` only on a clean landing. */
  reason: string | null
  /** The guard's cell at this start, when a staff lane owned one. */
  cell: RailCell | null
  /** ⚖ 74 — THE ROOM THIS LANDING SOLVED TO. It was computed here and thrown
   *  away, so the surface that had to name it either re-ran the allocator (flag
   *  54's disease: a second reading that can disagree with the first) or said
   *  nothing. `null` before the solve is reached, and on a 満室. */
  bedLane: string | null
  /** ⚖ 74 — the rows against the ATTEMPTED landing. `checksFor` answers for the
   *  lanes the booking is currently ON, which for a landing being asked about is
   *  the ORIGIN — the wrong board. These are the right ones, from the same call
   *  that judged the landing. Empty before the rows are reached. */
  checks: Check[]
}

/** canon `computeChecks` (drag-rules.ts:227) pushes this row UNCONDITIONALLY,
 *  and canon is frozen. The constant is the app side's copy of that literal, and
 *  it is pinned against the canon source so the two cannot drift apart in
 *  silence (today-screen-interactions.test.ts). */
export const PRICE_HOLD_ROW = '予約時価格を保持（動的価格は適用しません）'

/** ⚖ R8 T1 — A CHECK ROW THAT NEVER RAN A CHECK.
 *
 *  canon asserts 予約時価格を保持 over every landing, including a booking that
 *  has NO recorded price (apt-09 carries `booked_price: null` by documented
 *  fixture intent). The row then promises to hold a number that does not exist,
 *  on a card whose own 予約時価格 fact three lines away reads 記録なし.
 *
 *  The row is DROPPED rather than reworded (Fable default, overturnable): the
 *  fact line already says 記録なし in the operator's own words, so a second
 *  sentence about the same nothing is noise, and rewording it would be a new
 *  operator string for a state the surface can already say.
 *
 *  Pure, and applied at the two app callers that consume canon's raw rows —
 *  `landingVerdict` below and the screen's `checksFor`. Order is canon's: a
 *  filter, never a rebuild. */
export function withPriceFact(checks: Check[], hasPrice: boolean): Check[] {
  return hasPrice ? checks : checks.filter((c) => c.label !== PRICE_HOLD_ROW)
}

/** ⚖ R8 FIX ROUND 3 (BREAKER-828 F1 + F3) — THE THREE SETS THE PRICE QUESTION
 *  IS ANSWERED FROM, built by ONE author and beside the rule that reads them.
 *
 *  F3 — WHY IT LEFT THE SCREEN. The memo built these inline, where an anchored
 *  text pin was the only armour there is, and two tsc-clean edits inside it
 *  re-opened this item's own defect: a wrapper-body `addedPriced.add(...)` that
 *  stamped every session row whatever its mint said, and a `priced` rebuilt off
 *  the server's LANES so every card on the board counted as priced while the
 *  page's 根拠 list still said no. Set-building is logic; logic lives where a
 *  truth table can be written about it.
 *
 *  F1 — AND THE SHELF IS A SESSION SOURCE, exactly like `added`. A chip carried
 *  to another day (⚖ Liam 22 — `placeFromShelf` supports that on purpose) is on
 *  none of THAT day's server lanes and in no `added` row until it lands. The two
 *  questions asked about the same chip — the mid-drag word (`inHand`) and the
 *  release (`chipAsk`) — therefore answered 「no price」 for a priced booking in
 *  hand and 「price」 one gesture later, after the drop stamped the row from
 *  `chip.priced`: one gesture, two answers to one question, which is the disease
 *  this item exists to remove. The shelf's own park-time stamp joins the session
 *  set, so the answer is the same in hand and after the drop.
 *
 *  `sessionPriced` is the UNION of the two session writers — rows this session
 *  added ∪ chips on the shelf — and both halves are STAMPS, never a reading of
 *  the card's ticket line. `fromServer` is every booking the server's lanes know,
 *  priced or not: it is what tells a server card apart from a session one, and
 *  the reason a price-less server booking cannot be answered for by the session.
 *  Pure — no React, no props, nothing to memoise here. */
export function priceFactSets(input: {
  pricedIds: readonly string[]
  serverLanes: readonly BoardLane[]
  added: readonly { priced: boolean; item: { caseId: string | null } }[]
  parked: readonly { id: string; priced: boolean }[]
}): { priced: ReadonlySet<string>; fromServer: ReadonlySet<string>; sessionPriced: ReadonlySet<string> } {
  const fromServer = new Set<string>()
  for (const lane of input.serverLanes) for (const item of lane.items) if (item.caseId != null) fromServer.add(item.caseId)
  const sessionPriced = new Set<string>()
  for (const row of input.added) if (row.priced && row.item.caseId != null) sessionPriced.add(row.item.caseId)
  for (const chip of input.parked) if (chip.priced) sessionPriced.add(chip.id)
  return { priced: new Set(input.pricedIds), fromServer, sessionPriced }
}

/** ⚖ R8 T1, FIX ROUND 1 (blind round 1, L2 F10) — 「DOES THIS PLACEMENT HAVE A
 *  PRICE THE 保持 ROW CAN BE ABOUT?」, asked once for the whole screen.
 *
 *  It lives HERE, over four primitives, because the answer IS the item: the
 *  screen's own closure could have its guard dropped and 444 tests stayed green
 *  — the wiring was counted, the decision was not. Its two siblings on this
 *  round (`withPriceFact`, `proxyTimeLabel`) were lifted for that reason and
 *  this one was not; the truth table below is now pinned like theirs.
 *
 *  Two kinds of card stand on this board and they carry their price in two
 *  different places:
 *  · a card the SERVER put here answers from the server's own record —
 *    `priced`, the bookings whose `price` is non-null. apt-09 has none by
 *    documented fixture intent, and it is the scene this item is for.
 *  · a card this SESSION put on the board has no server row at all; it answers
 *    from the STAMP its mint wrote on the row (`AddedRow.priced` — the lane's
 *    定価 for a 次回予約, `null` on a lane with no 定価 (⚖ R6 D2); the chip's own
 *    park-time stamp for a shelf placement; the dialog's コース for a creation).
 *  · a booking this session is HOLDING — a chip on the shelf — answers from that
 *    same park-time stamp, before it has landed anywhere. `sessionPricedIds` is
 *    the union of those two, and nothing else.
 *
 *  The two are told apart by whether the SERVER's lanes know the id
 *  (`fromServer`) — never by the shape of the id, and never by the mint alone:
 *  a real booking's ticket line is non-null even with no price (「価格未記録」/
 *  「残り3回」), and `placeFromShelf` puts a real booking's own card back into
 *  the session's list, so reading the session FIRST would answer 「price」 for
 *  apt-09, which is the exact bug this item removes. That ordering is the whole
 *  logic, and it is why the guard is a pinned row and not a comment.
 *
 *  ⚖ FIX ROUND 2 (Greptile on #828) — AND THE SESSION'S SIDE IS A STAMP NOW,
 *  never a reading of the card. The session set used to be built from
 *  `item.ticketCore != null`, which is DISPLAY TEXT: on ANOTHER DAY, where
 *  `priced` and `fromServer` are both empty, a price-less booking placed from
 *  the shelf still carried the non-null line 「価格未記録」 and the 保持 row came
 *  back on exactly the booking T1 removed it from. Every writer now stamps
 *  `AddedRow.priced` / `ParkChip.priced` at the moment the price is known, and
 *  this function only reads.
 *
 *  ⚖ FIX ROUND 3 (BREAKER-828 F1) — AND THE FOURTH ARGUMENT IS THE WHOLE
 *  SESSION, which is why it is named for the session and not for `added`. It is
 *  the UNION of the rows this session put on the board and the CHIPS on the
 *  shelf (`priceFactSets` above builds it): a chip is a session-held booking
 *  that has not landed yet, and while it is in the operator's hand on another
 *  day nothing else on that board knows its price. Reading only `added` is what
 *  made one gesture answer twice — false in hand, true after the drop. */
export function hasPriceFact(
  id: string | null,
  priced: ReadonlySet<string>,
  fromServer: ReadonlySet<string>,
  sessionPricedIds: ReadonlySet<string>,
): boolean {
  return id != null && (priced.has(id) || (!fromServer.has(id) && sessionPricedIds.has(id)))
}

/** One landing, as a question. Every field is something the caller already has;
 *  nothing here reads the DOM, so the same question is asked by the mid-drag
 *  cursor, by the 60分配置 strip's × marks and by the release itself. */
export interface LandingQuestion {
  /** The staff lane the booking lands on. `null` = the release found no lane. */
  staffLane: string | null
  /** The room. When `solveRoom` is true this is only the FIRST candidate (the
   *  room the booking carries in); otherwise it is the room the operator named
   *  out loud on a bed row, and it is used exactly as given (⚖ 51's exemption). */
  bedLane: string | null
  /** ⚖ 51 — people are chosen, rooms are solved. False for a bed-row gesture. */
  solveRoom: boolean
  /** The booking being landed; `null` for one that does not exist yet. */
  id: string | null
  /** ⚖ ROOM RULE — 個室のみ, off the booking's own tag. */
  requiresPrivate: boolean
  start: number
  end: number
  /** The same span in canon's percent units — `computeChecks` speaks percent. */
  span: { x: number; w: number }
  /** ⚖ 46 — a chip or a 配置モード intent carried onto a foreign store's board. */
  foreignRefusal: string | null
  /** ⚖ R8 T1 — does this placement have a price the 保持 row can be ABOUT?
   *  REQUIRED, because absent would have to default to one of the two answers
   *  and both defaults lie on the other half of the board: `true` re-asserts the
   *  row over a price-less booking (the defect), `false` deletes it from every
   *  caller that simply forgot to say. The screen answers it per gesture. */
  hasPrice: boolean
  locked: string[]
  minutesOf: (x: number) => number
  /** ⚖ R3 ONE WORLD — the session's own unconfirmed move, for the one sentence
   *  that can end up naming it (`allocateBed`'s 満室 refusal). Absent is the
   *  honest default: a board with nothing staged has no such occupant, and every
   *  caller that genuinely has one passes it. */
  stagedId?: string | null
  /** ⚖ 9/1 STRICT-SWITCH RULING (fix round 2 D1) — WHO IS ASKING, at the only
   *  landing class where the store's dial has anything to say about it.
   *
   *  Every other field here is geometry, and that was the whole bug: with no
   *  operator in the question, a STRICT store's guard refusal was `'hard'` for
   *  everyone, so 「確保枠を壊す場所に置けるのは店長だけです」 shipped over a board
   *  where the 店長 could not place there either. `TodayScreen` has had the answer
   *  all along (`props.overrideLevel`) and simply never handed it over.
   *
   *  OPTIONAL, and absent means NOT ADMITTED (`dialAdmits`): the callers that ask
   *  this question about pure geometry keep working and keep the closed answer. */
  overrideLevel?: OverrideLevel
}

/** ⚖ LIAM flag 50 (2026-08-22) — THE ONE VERDICT HOME.
 *
 *  The mid-drag word at the cursor, the × on the 60分配置 strip and what the
 *  release actually DOES are three faces of this one function. They used to be
 *  three separate readings of the board, and that is the disease behind flag 54:
 *  the strip advertised ✓16:00 off the guard alone while the drop ALSO ran the
 *  bed allocator, so the chip and the checker disagreed and the operator was
 *  refused on a start the board had just recommended. A label that can disagree
 *  with the release is worse than no label.
 *
 *  ORDER IS THE ANSWER THE OPERATOR GETS, so it is the order they can act on:
 *  the wrong board first, then the person (重複/勤務/ロック — `computeChecks`'
 *  own sentences, so the cursor and the confirm surface speak one vocabulary),
 *  then the room (満室, naming who is in it), then the guard. `cell` is passed
 *  IN rather than computed: the strip has already evaluated every start on the
 *  lane, so asking the engine a second time per cell would double the frame's
 *  work to reach the same answer.
 *
 *  ⚖ 52 holds by construction: `blocked` is exactly the set where release does
 *  nothing, which is exactly where red and × are allowed to appear. */
export function landingVerdict(lanes: BoardLane[], q: LandingQuestion, cell: RailCell | null): LandingVerdict {
  // ⚖ 74 — the two facts this function computes and used to discard. They are
  // filled in as it walks, so a `stop` that fires before the walk reaches them
  // honestly reports none: no room had been solved and no row had been read.
  let bedLane: string | null = null
  let checks: Check[] = []
  /** ⚖ ROOM RULE fix round 1 (blind lens 3 F1) — AND A STOP MAY SAY IT HAS
   *  NOTHING TO OFFER. `cell` is the guard's own ranking of nearby starts, and
   *  every floor that is about the CLOCK is entitled to it. The 個室のみ stop is
   *  not: the room is wrong at every start on the lane, so the offer line under
   *  it printed 「この区間に、より損の少ない開始はありません」 — the guard's loss
   *  vocabulary over a refusal that has nothing to do with time, sending the
   *  operator hunting for a start. `null` is the board's own existing word for
   *  「nothing to offer」 (the keyboard nudge sets it deliberately, ⚖ 31c), so the
   *  offer line and the alternatives simply do not render and the way out rides
   *  in the sentence instead. Defaulted, so every other stop is byte-unchanged. */
  const stop = (reason: string, floor: LandingFloor, offer: RailCell | null = cell): LandingVerdict =>
    ({ kind: 'blocked', floor, label: VERDICT_WORD.blocked, reason, cell: offer, bedLane, checks })
  // ⚖ 46 store isolation is LAW, never a judgement — there is no authority on
  // this board that may place a person in another store's building.
  if (q.foreignRefusal) return stop(q.foreignRefusal, 'hard')
  const staff = lanes.find((l) => l.key === q.staffLane && l.group === 'staff')
  // No lane was named, so there is no landing to escalate ONTO — every caller
  // already passes a null escalation here (⚖ 61). `hard` is what that means.
  if (!staff) return stop('予約を置く行の中で離してください', 'hard')

  // The room, solved or named. A refusal is HELD rather than returned: a person
  // who is already busy at this time is the more useful sentence, and saying
  // 満室 to someone whose staff member is double-booked answers the wrong half.
  const solved = q.solveRoom
    ? allocateBed(lanes, {
        id: q.id,
        currentBed: q.bedLane,
        stores: staff.stores,
        requiresPrivate: q.requiresPrivate,
        start: q.start,
        end: q.end,
        stagedId: q.stagedId ?? null,
      })
    // ⚖ 44 FIX ROUND (blind lens 1, F6) — ONE SHAPE ON BOTH SIDES. A bed-row
    // gesture names its own room, so nothing was walked and nobody is in the
    // way; saying that with `[]` keeps `solved` one type rather than a union
    // whose second arm quietly lacks the field a reader may go looking for.
    : { laneKey: q.bedLane, refusal: null, blockers: [] }
  const bed = lanes.find((l) => l.key === solved.laneKey && l.group === 'beds') ?? null
  bedLane = solved.laneKey

  // ⚖ 74 (lens-1 F5) — READ THE ROWS BEFORE THE EXPLICIT-ROOM STOPS, so the two
  // bed-row refusals below carry them too. They used to return above this block
  // and the one box rendered an EMPTY check strip under its sentence — a row of
  // nothing, which reads as "no checks were run" rather than "this is why". The
  // rows are display-only here; every `stop` below still returns its own
  // sentence, and the order the OPERATOR is answered in is unchanged.
  const spans: CheckSpan[] = []
  for (const lane of [staff, bed]) {
    if (!lane) continue
    for (const i of lane.items) {
      spans.push({ id: i.caseId ?? i.key, x: i.x, w: i.w, title: i.title, derived: i.kind === 'cleanup', parked: false })
    }
  }
  // ⚖ R8 T1 — canon's rows, minus the 価格保持 assertion when there is no price
  // to hold. Applied HERE, at the raw-canon entry point, so the cursor word, the
  // × strip and the red box's fact list all read one filtered list.
  checks = withPriceFact(
    computeChecks(q.span, {
      spans,
      bookingId: q.id ?? '',
      staffName: staff.label,
      staffUntil: staff.untilLabel,
      laneLocked: q.locked.includes(staff.key),
      minutesOf: q.minutesOf,
    }),
    q.hasPrice,
  )

  // ⚖ STORE ISOLATION on the explicit room choice — `allocateBed` filters, this
  // tests, and `sharesStore` is the one spelling of the rule either way.
  if (!q.solveRoom && bed && !sharesStore(staff.stores, bed.stores)) {
    return stop(`担当と店舗が異なります: ${staff.label} / ${bed.label}`, 'hard')
  }
  // ⚖ ROOM RULE on the explicit room choice — the store rule is not the only
  // floor the allocator applies, so it may not be the only one this path
  // re-tests: a 個室のみ booking dropped straight onto a standard bed was
  // landing silently (Greptile #744 P1).
  //
  // AND ITS FLOOR IS `hard`, NOT `policy`. It used to mint a 「注意して配置」 —
  // a manager walking a VIP out of the 個室 out loud. Liam has overturned the
  // rule underneath it: sitting in the 個室 means nothing, so there is no VIP to
  // walk out, and the only thing left that can refuse is the booking's own tag.
  // A tag is a FACT about what the treatment needs, and ⚖ 73 already says a fact
  // gets no escalation button — the way past it is clearing the tag on the
  // booking, never an override. An UNTAGGED booking gets no room stop at all.
  //
  // ⚖ FIX ROUND 1 (blind lens 1 F1) — AND IT ASKS `roomFitsNeed`, rather than
  // re-spelling it. The two forms answer the same today; a rule with two
  // spellings is a rule with two answers (Greptile #744 P1), and this file's own
  // one-home doc named this site as a caller while the code open-coded it.
  //
  // ⚖ FIX ROUND 1 (blind lens 3 F1/F6/F7/F8) — AND THE SENTENCE SAYS WHAT TO DO,
  // in the register the rest of this board uses. 「ご予約」 addresses the
  // receptionist as if she were the guest, a halfwidth `: ` is not JP
  // punctuation, and the old line ended with no way out — so the operator read a
  // refusal and a loss ranking and had nowhere to go. `cell: null` is what stops
  // the offer line from speaking about start times under a ROOM refusal.
  //
  // ⚖ FIX ROUND 2 (JP native pass 1) — AND IT STOPS TWICE, NOT THREE TIMES. The
  // board's own grammar is 「◯◯の予約です。→ 次にやること」 (`foreignStoreRefusal`
  // is the sibling), and three stops in a 7-second toast is one beat too many
  // for a sentence that said 「個室」 three times in 39 characters. ⚖ FIX ROUND 3
  // (delta2 lens 3 M6) — those two counts read 「four times in 35」 until now, and
  // both were wrong: the repetition is the rule's own vocabulary and it did not
  // change (three times in 36 now). What went is the third stop — 「〜ので」 joins
  // the reason to the action so they read in one breath.
  if (!q.solveRoom && bed && !roomFitsNeed(bed, q.requiresPrivate)) {
    return stop(`個室のみの予約です。${bed.label}は個室ではないので、個室の行に置いてください`, 'hard', null)
  }

  const failed = checks.find((c) => !c.ok)
  // ⚖ 73 — BY ROW, not by the fact that a row failed: 重複 is two people in one
  // place and no authority makes that true, while 勤務時間外 and シフトロック are
  // the store's own shape of its day.
  //
  // ⚖ AMENDMENT 1, lens-1 F1 — AND A POLICY ROW MAY NOT ANSWER BEFORE THE ROOM.
  // The three lines below used to be two, with every failing row returning
  // immediately. A 勤務時間外 landing on a FULL HOUSE was therefore stamped
  // `policy`, the box grew a 「注意して配置」, and the press died inside `solveBed`
  // with a 満室 toast and nothing staged — a button that cannot perform what it
  // names, which is the ⚖ 31c defect this batch exists to remove, on all four
  // gesture paths.
  //
  // So the order is the ANSWER'S order, and it is a strict ranking:
  //   1. a HARD row first — the person's own clash outranks the room (unchanged:
  //      saying 満室 to someone whose staff member is double-booked answers the
  //      wrong half).
  //   2. then the room — 満室 outranks any judgement (TEST:4030's own law), so a
  //      full house is `hard-room` even when a policy row also failed, and it
  //      gets the bed-free offers rather than a button that cannot fire.
  //   3. only then the policy row, with a solved room already in hand for the
  //      one box — which is exactly what makes its 「注意して配置」 honest.
  if (failed && failed.label.startsWith(CLASH_ROW)) return stop(failed.label, 'hard')
  // ⚖ 73's core — the full house. There is no room, so there is nothing for an
  // escalation to buy; the surface offers the starts whose room IS free instead.
  //
  // ⚖ FIX ROUND 2 (delta lens 3 N1) — EXCEPT ON THE EXISTENCE BRANCH. No blockers
  // means the candidate list was EMPTY: this store owns no room of the kind
  // asked for, so no start on any lane can make one appear and 「…の空く開始は
  // ありません」 answered the clock's question under a refusal that is not about
  // the clock. `blockers` is the walk `allocateBed` already did, so this reads
  // that answer rather than making a second one.
  if (solved.refusal) return stop(solved.refusal, 'hard-room', solved.blockers.length === 0 ? null : cell)
  if (failed) return stop(failed.label, 'policy')
  // ⚖ LIAM flag 58 (2026-08-22) — ROOT A: AN ACK-ALLOWED REFUSAL IS 要確認,
  // NOT 置けない. His words: 「even the triangle ones are going into red
  // crosses, which it shouldn't」.
  //
  // The frozen engine has three outcomes above "ok" and it labels them itself.
  // A `refuse` verdict in STANDARD mode — which is what this store runs — comes
  // back `ackAllowed: true` (gap-guard :398), and the engine's own words for
  // that state are 「some other start in the same pocket has a strictly smaller
  // key」: *there is a better start here*, not *this is illegal*. Only
  // `R-UNAVAILABLE` — a physically impossible placement — is `ackAllowed: false`.
  // `railCell` carried the flag faithfully and this line threw it away, so
  // 「ここに置くと新規(90分)が入らなくなります」 — an advisory the engine
  // explicitly permits the operator to place through — painted the proxy red,
  // put × on the rail, made the release inert, and hid the only way past it
  // behind `canOverride`, a right most operators do not have. Canon agrees with
  // the engine, not with us: its popover offers a plain 「この開始に配置」 to
  // ANYONE whenever `allowAttempt` is set (canon :7154-7161).
  //
  // ⚖ 50(b) reserves 置けない for landings that are actually illegal and ⚖ 52
  // reserves × for release-is-inert, so this predicate is what makes both true
  // again — and it makes them true BY CONSTRUCTION, in the one verdict home:
  // the cursor word, the rail's × and what the release does are this one call
  // rendered three times, so they move together or not at all. ROOT C (the
  // confirm row's forced △) dissolves with it — an ack-allowed cell is now a
  // caution, so its △ is TRUE, and a genuinely blocked cell never reaches the
  // confirm surface because the release never staged.
  //
  // 「注意して配置」 stays exactly where it is, for the floors that ARE illegal:
  // 店舗 / 重複 / 勤務 / ロック / 満室 / 個室のみ — all of which are `stop`s
  // above this line — plus `R-UNAVAILABLE` here.
  // ⚖ 73 — `ackAllowed: false` is the engine's own word for physically
  // impossible (gap-guard :371, `R-UNAVAILABLE`). A floor the engine calls
  // impossible is not a floor a manager can be given authority over.
  //
  /** ⚖ 9/1 STRICT-SWITCH RULING (fix round 2 D1) — AND THE STRICT DIAL'S REFUSAL
   *  IS NOT THAT FLOOR, SO IT IS NOT EVERYONE'S.
   *
   *  `ackAllowed: false` arrives from TWO different places and this line read
   *  them as one:
   *    · gap-guard :372 — `R-UNAVAILABLE`, a placement that cannot be made. It
   *      comes through `railCell`'s `blocked()` with NO `impact` at all, because
   *      the engine never weighed a protected window there.
   *    · gap-guard :398 — `ackAllowed = mode === 'standard'`, i.e. the STORE'S
   *      strict dial refusing a landing the engine has costed. It always carries
   *      an `impact`: that is what the refusal is about.
   *  Collapsing them made the store's own dial as absolute as physics, so at
   *  STRICT no drag, nudge or rail tap could place for ANYONE — while this very
   *  round ships 「確保枠を壊す場所に置けるのは店長だけです」 on the settings page.
   *
   *  THE SPLIT IS THE ENGINE'S OWN SIGNAL, NEVER THE MODE. `lossOf(cell) > 0` is
   *  the identical test `warnFaceFor` calls `guardWarn`, so the card and the board
   *  classify one cell one way. Reading `mode` instead would soften physics: an
   *  `R-UNAVAILABLE` at a strict store would become escalatable, and ⚖ 73 says a
   *  floor the engine calls impossible is not one a manager may be given
   *  authority over. The mutation is pinned red for exactly that reason.
   *
   *  'policy' is not a grant — it is the floor the board already escalates
   *  through (a failed 勤務/ロック row lands here), so the operator still reads
   *  置けない and still has to press 注意して配置; `canOverride` is the authority
   *  gate, untouched. For a `refuse` operator the stop stays `'hard'`, which is
   *  the dial's promise word for word: the sentence, the safe suggestions and
   *  元に戻す, and no button onto a card they could not commit. */
  if (cell?.state === 'blocked' && !cell.ackAllowed) {
    return lossOf(cell) > 0 && dialAdmits(q.overrideLevel)
      ? stop(cell.sentence, 'policy')
      : stop(cell.sentence, 'hard')
  }
  if (cell && cell.state !== 'safe') return { kind: 'caution', floor: null, label: VERDICT_WORD.caution, reason: cell.sentence, cell, bedLane, checks }
  return { kind: 'clean', floor: null, label: VERDICT_WORD.clean, reason: null, cell, bedLane, checks }
}

/** ⚖ RULING 91 / SPEC-SELLING-ENGINE §7 — THE PERMISSION DIAL'S THREE LEVELS,
 *  on the store's EXISTING home. r1 of the spec invented a second dial; the app
 *  already had one — `storeBookingPolicy.overridePolicy` (roles + the per-staff
 *  `lockedOut`, ⚖ Liam 2026-08-22 flag 50(d)) — so ruling 91 EXTENDS it rather
 *  than competing with it, and there is no precedence puzzle to solve.
 *
 *  It sits beside the verdict because it answers the verdict's last question:
 *  `policy` is the only floor an operator may be given authority over (a `hard`
 *  floor is the engine's own word for impossible), and this says whether THIS
 *  operator has it. The board is handed the answer, never the policy — a
 *  locked-out staff member is not shown a 「注意して配置」 they would only be
 *  refused for pressing.
 *
 *  ⚖ DEFAULT (a), RULED 8/30 late night: staff may override with a warning.
 *  `lockedOut` composes with every level and answers FIRST — a store that named
 *  a person has named them whatever their role says.
 *
 *  ⚖ 'needs-approval' IS EXPRESSIBLE AND UNREACHABLE, deliberately. §7(b) — a
 *  real request→approve moment — is priced honestly: staged holds are
 *  session-local React state (the screen's own toast says so), so (b) needs
 *  server-backed request state that does not exist, and the request must not
 *  alter the board until approved. It is built when a store can actually dial to
 *  it; until the policy carries an approval level, nothing here can return it.
 *  The word lives in the type so the dial's vocabulary is one thing, not two. */
export type OverrideLevel = 'allow-warned' | 'needs-approval' | 'refuse'

export function overrideLevelFor(
  policy: { roles: readonly string[]; lockedOut: readonly string[] },
  operator: { role: string; staff_id: string },
): OverrideLevel {
  if (policy.lockedOut.includes(operator.staff_id)) return 'refuse'
  return policy.roles.includes(operator.role) ? 'allow-warned' : 'refuse'
}

/** ⚖ 9/1 STRICT-SWITCH RULING (fix round 2 D1) — DOES THE 上書きの権限 DIAL ADMIT
 *  THIS OPERATOR? One spelling, because TWO seams now gate on the answer and they
 *  may never disagree: the LANDING (`landingVerdict`, whether the strict store
 *  even offers the escalation) and the CARD (`warnFaceFor`, whether the staged
 *  commit is live). Round 1 fixed only the second, and the delta-verifier proved
 *  the first still walled everyone — the board hard-stopped 店長 at the landing,
 *  so the composer's permitted arm was reachable only when the board moved under
 *  an already-staged hold. Two questions, one predicate, no drift.
 *
 *  ⚠ ABSENT IS NOT ADMITTED. `LandingQuestion.overrideLevel` is optional (most
 *  callers of that shape are asking about geometry, not people), so this answers
 *  `false` for `undefined` — a caller that has not been taught the question gets
 *  the CLOSED answer. A permission gate that fails open on a forgotten field is
 *  the defect this round exists to remove, not one to introduce next to it.
 *
 *  'needs-approval' IS admitted here, deliberately (⚖ D2, which refused the
 *  verifier's `level !== 'allow-warned'`): the dial promises 確定できなくなります,
 *  and a DISABLED 店長に許可を求める is not a 確定 — the sentence stays literally
 *  true while the approval tier keeps the middle ground it was designed for. It
 *  is unreachable today at BOTH seams (`overrideLevelFor` cannot return it), so
 *  this states the contract rather than lighting a path. */
export const dialAdmits = (level: OverrideLevel | undefined): boolean =>
  level === 'allow-warned' || level === 'needs-approval'

/** ⚖ SPEC-SELLING-ENGINE §1's Release clause, MANUAL half (ruling Q5, 8/30:
 *  release is automatic AND a manager button, logged) — WHO MAY PRESS IT.
 *
 *  Manager-level per Q5 — read off the ROLES HOME rather than spelled here.
 *  ⚠SETTINGS-BATCH's law binds this exactly as it binds the override consult
 *  above: the authority is DATA (`storeBookingPolicy.releaseHeldRoles`, beside
 *  the override policy), never a literal on the board, so a store that names a
 *  different set of people changes its settings and not this file. A staff
 *  member pressing a 確保 chip gets the law sentence and nothing else, which is
 *  E3b's shipped behaviour unchanged.
 *
 *  ⚖ IT IS ITS OWN LIST, NOT A READING OF THE OVERRIDE DIAL, deliberately.
 *  `overrideLevelFor` above answers 「may this person place over a 置けない」 —
 *  a different question about a different gesture — and a store that let
 *  スタッフ override placements (the shipped default (a)) has not thereby said
 *  staff may put the store's 新規 window back on sale. The settings round gives
 *  the list its 店舗設定 control beside the override dial; this predicate is
 *  where a LEVEL (rather than a list) would land if Liam ever asks for one. */
export const canReleaseHeld = (roles: readonly string[], operator: { role: string }): boolean =>
  roles.includes(operator.role)

/** ⚖ LIAM flag 50(d) (2026-08-22) — WHAT AN OVERRIDE IS ALLOWED TO BUY.
 *
 *  「注意して配置」 confirms DESPITE the one row it overrode and nothing else: a
 *  manager who accepted a 15-minute overlap has not also accepted a shift-locked
 *  lane. So the gate is `confirmCaption` over the rows that are still blocking,
 *  and a second blocker that appears after the override still stops the confirm
 *  — canon's R11-7 re-check rule, kept honest.
 *
 *  The overridden row is NOT deleted from what the operator reads: it renders as
 *  △ 「注意して配置: …」 in the confirm surface (⚖ 52 — it no longer blocks, so
 *  it may not wear ×), which is what makes the escalation visible rather than
 *  silent. */
export function overrideCaption(checks: Check[], override: string | null): { enabled: boolean; label: string } {
  return confirmCaption(override == null ? checks : checks.filter((c) => c.ok || c.label !== override))
}

// ── ⚖ LIAM flag 92 — 警告カード: the confirm surface's warn face ─────────────

/** ⚖ LIAM flag 92 (2026-08-31, design-approved on `warncard-design.html`) — ONE
 *  CARD, COMPOSED BY THE STORE'S SETTINGS.
 *
 *  Today a placement that costs the store its protected 新規 window stages a
 *  仮押さえ whose confirm card shows four green ✓s and one quiet △ — it reads
 *  "all clear" for a move that is about to make the day worse. His ruling is
 *  that the SAME popover re-composes when the staged card carries a warn-grade
 *  fact: the consequence leads, the safe alternative is the biggest control on
 *  the card, and the commit says out loud what it commits to.
 *
 *  IT IS A COMPOSER, NOT A RENDERER, for this file's own stated reason: an
 *  answer the operator acts on has to be provable without a renderer. Every
 *  branch of the ruling set — the three permission faces, the long-press dial,
 *  the name line, the three alternative shapes, the ¥ — is decided HERE, and
 *  TodayScreen paints the model it hands back.
 *
 *  THE CLEAN FACE IS UNTOUCHED. `face: 'clean'` is the byte-identical card that
 *  ships today, and the screen keeps its existing render for it — this function
 *  only ever ADDS a second face to a surface that had one. */
export interface WarnCardInput {
  /** The confirm surface's own rows, in its own ✓/×/△ grammar — composed once,
   *  by the screen, so the two faces can never disagree about what was checked.
   *  `''` = ✓ passed, `'bad'` = × still blocking, `'warn'` = △ walked past. */
  rows: Array<{ label: string; tone: '' | 'bad' | 'warn' }>
  /** The guard's verdict at the staged start. `null` = the guard is off, or the
   *  lane owns no cell there. */
  cell: RailCell | null
  /** The red sentence this landing was placed THROUGH (`pending.override`). */
  override: string | null
  /** ⚖ ruling 91's three levels, threaded whole (see `overrideLevel` on
   *  TodayProps for why the boolean could not carry this). */
  level: OverrideLevel
  /** ⚠SETTINGS-BATCH — `storeBookingPolicy.overrideHoldToConfirm`. */
  holdToConfirm: boolean
  /** `BoardLane.mine` on the lane the staged card now sits on (today-board :548,
   *  already computed from `operatorStaffId` — READ ONLY, never re-derived). */
  targetLaneMine: boolean
  operatorName: string
  /** The staff lane's own `listPrice`. `<= 0` = this store prices nothing here,
   *  and the card says nothing about money rather than guessing a zero. */
  listPrice: number
  /** ⚖ 92 fix round 5 V1 (breaker #4) — THE BOARD'S OWN PRICE FRAME, threaded
   *  rather than re-derived: `frame` and `depth` are the very objects the sell
   *  layer is built from on the same screen (`sellLayerFor`'s `hi`/`hqMin`/
   *  `depth` opts, composed once at TodayScreen :1341-1345), so the card's ¥ and
   *  the board's ¥ are answers from one set of levers by construction.
   *
   *  `null` = a store with no pricing frame at all, and it omits the ¥ exactly as
   *  `listPrice <= 0` does: a wrong number is worse than no number. */
  frame: PriceFrame | null
  /** The store's 割引の深さ, the sell layer's own `depth` opt. */
  depth: number
  /** 新規のお客様のために確保する長さ (`props.guard.protectedDurationMin`). */
  protectedDur: number
  /** `overrideCaption`'s answer, carried in. ⚖ 50(d)'s gate is UNTOUCHED and is
   *  still the only thing that decides whether a commit may fire. */
  confirmEnabled: boolean
}

/** The commit control, which on a warn face is never the neutral この内容で確定:
 *  a button that commits to a cost has to name the cost. */
export interface WarnCardCommit {
  /** `hold` = the store's 0.6-秒 long press · `press` = a plain warn button ·
   *  `approval` = the UNREACHABLE 承認 request (see the level branch below). */
  kind: 'hold' | 'press' | 'approval'
  label: string
  enabled: boolean
  /** The small line under the 承認 control. `null` on the two live kinds. */
  note: string | null
}

export interface WarnCardModel {
  face: 'clean' | 'warn'
  /** The amber impact panel, split at the money so the ¥ can carry its own
   *  emphasis (the approved page's `.yen`). `yen: null` omits the parenthetical
   *  ENTIRELY, and `head + tail` then reads as one unbroken sentence. */
  impact: { head: string; yen: string | null; tail: string }
  /** Where the authority came from, and whose name the record will carry. */
  provenance: string | null
  /** The red 店長のみ line, and ⚖ 9/1 ruling 1/2 LEFT IT WITH NO PRODUCER: the
   *  dial no longer walls a merely-costly landing, so nothing in this composer
   *  fills it any more. Kept — slot, render and its one red CSS rule — for the
   *  same stated reason the 'needs-approval' face is kept unreachable: the
   *  settings round owns the presets, and a wall it may yet decide to light must
   *  be RE-LIT rather than re-invented. Always `null` until then. */
  lock: string | null
  /** The safe answer, and it is always the biggest control on the card. `place`
   *  is a real alternative start; `null` omits the slot (⚖ 31c — never a dead
   *  button).
   *
   *  ⚖ 92 fix round 3 T2 (breaker #2) — THERE IS NO THIRD SHAPE. The 'info' line
   *  「ここが、損が最少の開始です」 was the SURFACE's own claim, and it fired on
   *  every degraded cell whose alternatives came back empty — including the ones
   *  EMPTIED BY THE SNAP GATE above, where the engine had named a better start
   *  and the store's lattice could not reach it. It then stood over the engine's
   *  own 「11:45はこの区間で損が最少の開始です」 saying the opposite. When there
   *  is no offer the slot is simply empty.
   *
   *  ⚖ 92 fix round 5 V3 (breaker #4) — AND T2'S CURE BECAME THIS ROUND'S
   *  DISEASE, so it is reversed. T2 filled the empty slot by appending the
   *  engine's own check row, reading ⚖ GAP-6's 「on the HOLD popover it is the
   *  only answer there is」 as a duty. On THIS face it is neither. The row's
   *  first clause repeats the panel — the impact headline above it already
   *  states the loss in the approved words — and its second clause names a
   *  least-loss START, which is precisely the start the draw gates deliberately
   *  withheld (round-2 S1's clean-only bar, round-3 T1's level bar, round-4 U1's
   *  strictly-better-loss bar). So the card said 「11:45はこの区間で損が最少の
   *  開始です」 in a row while refusing to offer 11:45 as a button: duplication
   *  above, contradiction-by-absence below. FIX-6's own principle is the answer —
   *  a surface picks the row it is ENTITLED to rather than re-authoring the
   *  engine — and this surface is entitled to none: the panel plus 元に戻す is
   *  the whole honest answer when there is nothing to offer. */
  safePrimary: { kind: 'place'; start: number; main: string; sub: string } | null
  commit: WarnCardCommit | null
  /** ⚖ 52 / 73-74 — every row the panel did NOT consume, in the board's existing
   *  grammar. A record may never go invisible because a nicer face was drawn. */
  rows: Array<{ label: string; tone: '' | 'bad' | 'warn' }>
  /** The passed rows, as one muted sentence. `null` when nothing passed. */
  greensLine: string | null
}

/** ⚖ 92 — WHAT THE GREEN TICKS REDUCE TO. Four ✓ rows saying four true things
 *  are four things to read on a card whose whole point is the ONE thing that is
 *  wrong, so the approved design demotes them to a single muted line.
 *
 *  Keyed on a stable fragment of `computeChecks`' own labels (drag-rules
 *  :206-228, FROZEN) rather than on the whole sentence, because the sentences
 *  carry names and clock times.
 *
 *  ⚖ 92 fix round 2 S2 (stress lens #3) — AND A ROW THIS LINE HAS NO NAME FOR
 *  STAYS A ROW. The count form it used to fall back to (「その他の確認（5件）は
 *  問題ありません」) had TWO faults at once: 「その他の」 had no antecedent —
 *  nothing else on the card named a first group for it to be other than — and
 *  buying that sentence cost the operator the one ok row the frozen engine
 *  emits that is actual news, the 清掃 auto-re-place notice, which vanished
 *  into a number the moment it appeared. So the named sentence folds ONLY the
 *  subjects it can name, and every other ✓ row keeps its place in `rows`,
 *  rendered in the clean face's own ✓ grammar (⚖ 73-74 — a record may never go
 *  invisible because a tidier face was drawn over it). Nothing is guessed at
 *  either way; the day the frozen engine grows a fifth row, the card shows it. */
const GREEN_SUBJECTS: ReadonlyArray<[fragment: string, subject: string]> = [
  ['時間帯の重複なし', '時間の重複'],
  ['勤務時間内', '勤務時間'],
  ['資格', '資格'],
  ['価格を保持', '価格'],
]

/** The one home for "does the muted line have a word for this row?" — asked by
 *  the line itself and by the row filter below, so the two can never disagree
 *  about which ✓ rows the sentence consumed. */
const greenSubjectOf = (label: string): string | null =>
  GREEN_SUBJECTS.find(([fragment]) => label.includes(fragment))?.[1] ?? null

/** ⚖ 92 fix round 8 Z4 (breaker #7 #5) — AND EACH SUBJECT IS NAMED ONCE. The
 *  subjects are keyed on FRAGMENTS of the frozen engine's labels, so two rows
 *  can legitimately carry the same one — the day `computeChecks` grows a second
 *  資格 row, the muted line reads 「…資格・資格は…」. A set is the whole fix, and
 *  it keeps the first-seen order the four subjects are already written in. */
function greensLineOf(oks: ReadonlyArray<{ label: string }>): string | null {
  const subjects = oks.map((r) => greenSubjectOf(r.label)).filter((s): s is string => s !== null)
  return subjects.length > 0 ? `${[...new Set(subjects)].join('・')}は問題ありません` : null
}

/** ⚖ 92 fix round 5 V1 (breaker #4) — WHAT A SET OF PROTECTED WINDOWS IS WORTH,
 *  ASKED OF CANON. `gapFillRawTotal` is the door the board's own 詰め込み price
 *  is built on (pricing.ts :128-141 — it pro-rates `priceAt` hour by hour and
 *  leaves the rounding to its caller), so the card is reading the same curve,
 *  from the same levers, as the boxes drawn behind it.
 *
 *  ⚖ 92 fix round 6 X5 (breaker #5) — AND THE ROUNDING SENTENCE SAYS WHAT
 *  ACTUALLY HAPPENS HERE. 「Unrounded on purpose」 was half true and read as the
 *  whole truth: `priceAt` (pricing :58) rounds EVERY hour to ¥10 inside canon,
 *  so what this total carries unrounded is the PRO-RATING remainder — never the
 *  hourly price, which canon has already rounded at its own door. The ¥10 round
 *  the card adds is its own, applied ONCE to the difference rather than once per
 *  window, because 約 may not license a figure to the digit and rounding per
 *  window double-counts the remainder. Canon's door, canon's rounding; ours on
 *  top of it, once. */
const protectedValueOf = (starts: readonly number[], listPrice: number, protectedDur: number, frame: PriceFrame, depth: number) =>
  starts.reduce((total, s) => total + gapFillRawTotal(listPrice, s, s + protectedDur, frame, depth), 0)

/** ⚖ 92 — THE CONSEQUENCE, IN THE APPROVED SENTENCE SHAPE, FROM THE DATA.
 *
 *  ⚖ LAW BOUNDARY, spelled out because it is the one thing easy to get wrong
 *  here: ⚖ GAP-6 / FIX-6 bind the CHECK ROWS to the engine's own sentence
 *  (`guardCheckRow` / `…BesideOffer`, byte-untouched above) — the rail and the
 *  consult box keep the engine's words exactly. This panel is the ⚖-approved
 *  NEW surface, so it composes from `cell.impact`'s numbers (⚖ 92's own field)
 *  and never by string-editing the engine's sentence back into data.
 *
 *  A class the approved design gave no shape to — R-DEAD / R-SALV, a pocket
 *  that cannot hold the session, a room that cannot — keeps the ENGINE'S
 *  SENTENCE VERBATIM as the headline. Inventing a fifth sentence for a case
 *  nobody ruled on is how a surface starts disagreeing with the board.
 *
 *  ⚖ 92 fix round F1 (blind L4#1 + L4#2 + L1#3) — AND THE FACT IS THE LOSS
 *  COUNT, NEVER THE REASON CODE. `reasonForKey` emits R-REP for TWO different
 *  causes — a protected window actually lost (`before > after`) and a
 *  repertoire that shrank with the count unchanged (`before === after`) — and
 *  DEGRADED can fire on a short-pocket residue that costs the store nothing
 *  either. Keying the approved 「が入らなくなります。」 sentence on the CODE
 *  therefore printed a loss, with money beside it, over landings that lose
 *  nothing. The window count is what the store actually loses, so it is what
 *  decides the sentence:
 *    · loses nothing → the engine's own words, and NO ¥ at all;
 *    · loses exactly one, R-REP → the approved sentence Liam signed off on;
 *    · loses any other number → the capacity form, which is true for all of
 *      them (a DEGRADED loss, and an R-REP that costs more than one window).
 *  The ¥ follows the same count: one window's price beside a two-window loss is
 *  a wrong number, and 約 does not license a wrong number.
 *
 *  ⚖ 92 fix round 5 V1 (breaker #4) — AND THE ¥ IS THE BOARD'S OWN PRICE. It
 *  used to be this surface's own arithmetic (定価 × the protected length × the
 *  count), which is a SECOND BASIS for a question the board already answers
 *  through canon's pricing door — measured at −23%..+10% off the figure the
 *  same screen prints for the same minutes. The 一つの真実 fix is to ask canon:
 *  the engine hands over the protected windows themselves, the screen hands over
 *  the levers the sell layer is built from, and the loss is the difference
 *  between what that inventory was worth before and after. */
function impactOf(cell: RailCell, listPrice: number, protectedDur: number, frame: PriceFrame | null, depth: number): WarnCardModel['impact'] {
  const verbatim = { head: cell.sentence, yen: null, tail: '' }
  // The two classes the approved design gave a shape to, and no others: an
  // unruled class keeps the engine's sentence exactly as it did before this fix
  // (and with it, no ¥ — the queued design note about that is Liam's to rule on,
  // not this round's to pre-empt).
  const ruled = cell.impact?.code === 'R-REP' || cell.impact?.code === 'DEGRADED'
  if (!cell.impact || !ruled) return verbatim
  /** ⚖ 92 fix round 5 V5 (breaker #4) — NO PROTECTED LENGTH, NO SENTENCE OF OUR
   *  OWN. Every approved shape below prints 「新規のお客様の{N}分」, so a store
   *  whose 確保する長さ is 0, negative or unset hands the operator 「0分」 or
   *  「NaN分」 with money beside it. Written as `!(x > 0)` rather than `x <= 0`
   *  because NaN fails every comparison — the one spelling that catches it. The
   *  engine's own sentence is the honest answer, and it is ¥-free. */
  if (!(protectedDur > 0)) return verbatim
  const { capacityBefore, capacityAfter, windowsBefore, windowsAfter } = cell.impact
  const loss = capacityBefore - capacityAfter
  if (loss <= 0) return verbatim
  // ⚖ 92 fix round 5 V1 (breaker #4) — THE ¥ IS THE BOARD'S OWN PRICE. What the
  // store loses is the difference between what its protected inventory was worth
  // before this landing and what it is worth after, both priced through canon's
  // door — never 定価 × minutes × count, which was a second opinion about a
  // question the board already answers on the same screen.
  //
  // The DIFFERENCE, never 「the starts that vanished」: the after-set is re-solved
  // and its windows SHIFT (see `RailCell.impact`), so the starts missing from it
  // over-count the loss by the whole set on a degraded landing. `hqMin` is a
  // divisor inside `priceAt`, so a frame without one prices nothing rather than
  // printing an infinity; `listPrice <= 0` is a store that prices nothing here.
  // Both omit the money entirely rather than showing 約¥0.
  const value = frame != null && frame.hqMin > 0 && listPrice > 0
    ? Math.round(
        (protectedValueOf(windowsBefore, listPrice, protectedDur, frame, depth)
          - protectedValueOf(windowsAfter, listPrice, protectedDur, frame, depth)) / 10,
      ) * 10
    : 0
  const yen = value > 0 ? `約${money(value)}` : null
  // ⚖ 92 micro-fix M1, JP native pass — the ¥ renders in brackets right after
  // the head, so 「…90分（約¥21,000）の空きが…」 read as a price PER 90 分. The
  // 空き belongs to the noun the money is about, so it joins the head and the
  // tail opens on が: 「…90分の空き（約¥21,000）が6枠から4枠に減ります。」
  const head = `ここに置くと、新規のお客様の${protectedDur}分`
  if (cell.impact.code === 'R-REP' && loss === 1) return { head, yen, tail: 'が入らなくなります。' }
  const shrink = `が${capacityBefore}枠から${capacityAfter}枠に減ります`
  // ⚖ 92 fix round 5 V1 (breaker #4) — AND AT A LOSS OF MORE THAN ONE THE MONEY
  // MOVES OFF THE NOUN. 「…の90分の空き（約¥21,000）が6枠から4枠に減ります。」 puts
  // one bracket against one 空き and then says two of them went: the figure reads
  // as the price of the single window the noun names. Past one, the ¥ belongs to
  // the LOSS, so it rides the 枠 clause — 「（2枠分・約¥21,000）」 — where the
  // count it multiplies is standing right beside it.
  //
  // The model's contract is UNCHANGED (`{head, yen, tail}`, no fourth field) and
  // `yen` is null on this arm, so the screen's own `{…impact.yen && <span
  // className="wc-yen">}` simply does not fire and the JSX needs no branch. The
  // trade is deliberate and it is the honest one: the plural loss's figure gives
  // up the `.wc-yen` emphasis to sit where it is true. With no money at all the
  // parenthetical goes entirely — 「6枠から4枠に減ります」 already says 2 — rather
  // than printing a 枠分 bracket nobody ruled on.
  return loss === 1
    ? { head: `${head}の空き`, yen, tail: `${shrink}。` }
    : { head: `${head}の空き`, yen: null, tail: yen ? `${shrink}（${loss}枠分・${yen}）。` : `${shrink}。` }
}

/** ⚖ 92 fix round 4 U1 — WHAT A LANDING COSTS THE STORE, in the one number the
 *  warn card is already about: protected windows before, minus after. A null
 *  cell, a safe cell and a cell that never reached the capacity question all
 *  cost nothing — `impact` is absent exactly where the engine never weighed it.
 *
 *  ⚖ 92 fix round 6 X2 (breaker #5) — LIFTED OUT so the DRAW and the PRESS read
 *  one definition. The press re-asks the draw's own least-loss rule
 *  (`placePendingAt`), and two spellings of "what does this cost" is ⚖ 54's
 *  disease in the one place where the two answers must agree by construction.
 *
 *  ⚖ 9/1 ruling 2/2 (Liam, merge-gate) — RE-HOMED HERE, out of TodayScreen, for
 *  that same ⚖ 54 reason one scope wider: the ruling makes this number the warn
 *  face's own TRIGGER, so the composer, the draw gate and the press now all ask
 *  it. Three readers, one spelling, and the screen imports it. */
export const lossOf = (c: RailCell | null): number =>
  c == null || c.state === 'safe' || c.impact == null ? 0 : Math.max(0, c.impact.capacityBefore - c.impact.capacityAfter)

/** ⚖ 54 — HOW MANY 新規 WINDOWS A DAY HOLDS, and it is the ENGINE'S count.
 *
 *  The 設定 room's guardrail line 「…確保枠を◯枠作れます」 is about exactly this
 *  number, and a room that counted pockets of its own would be a second spelling
 *  of the question `protectedCapacity` already answers — the same disease ⚖ 54
 *  names and the same reason `lossOf` above was lifted out of a screen.
 *
 *  So it lives beside `lossOf`, on the same inputs the rail is drawn from
 *  (`RailInput`), and the lane walk is `guardRailsFor`'s own — staff lanes with a
 *  window, minus the locked ones — so the number counts precisely the lanes the
 *  rail would draw on. `.before` is the day AS IT STANDS: nothing is being placed
 *  here, the question is what the day can still hold. */
export function protectedCapacityOf(lanes: BoardLane[], input: RailInput): number {
  const engine = createGapGuard(input.guard)
  let total = 0
  for (const lane of lanes) {
    if (lane.group !== 'staff' || lane.window == null || input.locked.includes(lane.key)) continue
    const pockets = freePockets({
      from: lane.window.from,
      until: lane.window.until,
      close: input.close,
      now: input.nowMinute,
      occupied: laneSpans(lane, input.excludeId),
    })
    // `railCtx` is this file's one ctx home, so the capacity question is asked in
    // exactly the ctx the rail's own verdicts are — a caller that supplies the
    // bed callbacks is answered by them here too, rather than by a second,
    // callback-less ctx spelled beside it.
    const ctx = railCtx(lane, input)
    for (const pocket of pockets) total += engine.protectedCapacity(pocket, null, ctx).before
  }
  return total
}

export function warnFaceFor(input: WarnCardInput): WarnCardModel {
  const { cell, rows, level, protectedDur, operatorName } = input
  /** ⚖ 9/1 ruling 2/2 (Liam, merge-gate) — ZERO-LOSS IS QUIET. The trigger used
   *  to be "any non-safe cell", which lit the amber face and the long press over
   *  guard facts that cost the store NOTHING: a 0枠減 DEGRADED residue, R-DEAD,
   *  R-SALV, a repertoire R-REP whose count never moved. His pick at the gate:
   *  the warn face and the hold fire only where protected 新規 windows are
   *  actually lost, and everything else goes back to the clean face's quiet △
   *  row — which is exactly where those facts lived before flag 92, and where
   *  `pendingGuardRow.row` still renders them.
   *
   *  `state !== 'safe'` is kept beside it though `lossOf` already answers 0 for a
   *  safe cell: it is the sentence the ruling is written in, and it says out loud
   *  that a safe cell was never a fact at all. */
  const guardWarn = cell != null && cell.state !== 'safe' && lossOf(cell) > 0
  // The trigger, and it is the OR the ruling names: the guard found a fact, or a
  // row was already walked past. `tone === 'warn'` is the △ row itself, so a
  // future warn-grade row lights this face without a second predicate.
  const warn = guardWarn || rows.some((r) => r.tone === 'warn')
  const oks = rows.filter((r) => r.tone === '')
  if (!warn) {
    return { face: 'clean', impact: { head: '', yen: null, tail: '' }, provenance: null, lock: null, safePrimary: null, commit: null, rows, greensLine: null }
  }

  // ⚖ 92, THE STRONGEST FACT LEADS. The guard's verdict is the store's own law
  // about the day and outranks a sentence the operator already walked past; with
  // no guard fact, the overridden sentence IS the fact. Whichever one does NOT
  // lead stays a △ row below (⚖ 73-74 — a record may never go invisible), which
  // is also why the row list is filtered rather than the panel doubled.
  const overrideRow = input.override == null ? null : `注意して配置: ${input.override}`
  const impact = guardWarn
    ? impactOf(cell, input.listPrice, protectedDur, input.frame, input.depth)
    : { head: input.override ?? '', yen: null, tail: '' }
  // ⚖ 92 fix round 2 S2 — and an ok row the greens line could not NAME is kept
  // beside them: the line consumed the four subjects it has words for, so
  // anything else that passed is still unsaid, and unsaid is invisible.
  /** ⚖ 92 fix round 8 Z2 (breaker #7 #2) — AND THE GUARD'S SENTENCE SURVIVES A
   *  FACE IT DID NOT LIGHT.
   *
   *  With `guardWarn` false the panel above is carrying the OVERRIDE, and the
   *  guard's own verdict — a zero-loss caution, a bed that cannot be held, the
   *  shift-end no-pocket refusal — had nowhere to go: the screen renders
   *  `pendingGuardRow.row` on the CLEAN face only, so a warn face composed from a
   *  walked-past row alone dropped the engine's sentence off the card entirely.
   *  ⚖ 52 / 73-74 is exactly this law — a record may never go invisible because a
   *  nicer face was drawn over it — and it is the engine's OWN row, through the
   *  one home that composes it, never a sentence of this surface's own.
   *
   *  A GUARD-LIT face appends nothing: the panel there is already the same
   *  verdict in the approved shape, and round 5 V3 is the precedent for not
   *  saying it twice. The CLEAN face appends nothing either, for that same reason
   *  one scope over — it is the face whose own `guardRow` renders precisely this
   *  row, which is where ⚖ 9/1 ruling 2/2 sends every zero-loss fact.
   *
   *  `guardCheckRow` already answers null for a null cell and for a safe one, so
   *  its own law is the whole of the condition and there is no second spelling of
   *  「is there a verdict to show?」 here. */
  const guardRow = guardWarn ? null : guardCheckRow(cell)
  const kept = [
    ...rows.filter(
      (r) => (r.tone !== '' || greenSubjectOf(r.label) === null) && !(!guardWarn && r.label === overrideRow),
    ),
    ...(guardRow ? [guardRow] : []),
  ]

  // ⚖ 92 — the safe answer, from the ENGINE'S own alternatives. Two shapes and
  // no third: a start it can name, or nothing at all. ⚖ 31c binds the second —
  // a button that cannot perform what it names must not exist, so the slot is
  // omitted rather than filled with a dead control.
  //
  // ⚖ 92 fix round 3 T2 (breaker #2) — AND THE SLOT IS NEVER FILLED WITH A CLAIM
  // OF OUR OWN. See `safePrimary` on the model above for the contradiction the
  // deleted 'info' line printed.
  //
  // ⚖ 92 fix round 4 U1 (breaker #3) — AND THE SUB-LINE MAY NOT OUTRANK THE
  // RANKING. 「（損が最少）」 is a SUPERLATIVE about a start the engine never
  // scored: `offerableCell` snaps each ranked start to the store's own lattice,
  // so what the card shows is a neighbour, and the screen's gate now keeps it
  // only when the store loses strictly less there than at the staged start.
  // 「（損を減らす）」 is exactly that, and it is canon's OWN aside vocabulary —
  // the 「・損を減らす」 the engine writes into its sentence and `guardCheckRow`
  // strips. True of every start this slot can now carry, and claiming no rank
  // the guard did not hand us. The 'safe' label is unchanged: 確保を壊さない is
  // the engine's own word about the cell, not a rank among starts.
  const alt = cell?.alternatives[0]
  const safePrimary: WarnCardModel['safePrimary'] =
    alt != null
      ? { kind: 'place', start: alt, main: `${clockOf(alt)}に置く`, sub: cell!.alternativeKind === 'safe' ? '（確保を壊さない）' : '（損を減らす）' }
      : null

  // ⚖ 92 — THE NAME LINE IS AUTOMATIC AND OTHER-LANE-ONLY (the approved page's
  // own rule: 「記録の名前は、他の人のシフトに置くときだけ表示されます（自動）」).
  // Printing the operator's own name back at them on their own shift is noise;
  // on someone else's shift it is the whole point of the line.
  const recordedBare = input.targetLaneMine ? '記録されます' : `${operatorName}の名前で記録されます`

  // ⚖ 92 / ruling 91 — THREE LEVELS, THREE FACES, and they are not flattened.
  //
  // ⚖ 'needs-approval' IS COMPOSED AND UNREACHABLE, deliberately, exactly as the
  // level itself is (`overrideLevelFor` above cannot return it and its comment
  // says why: a real request→approve moment needs server-backed request state
  // this board does not have). The face exists so the settings round LIGHTS it
  // rather than inventing it, and nothing here creates a way to reach it: no
  // policy value, no server state, no second dial.
  /** ⚖ 92 fix round 4 U3 (breaker #3) — AND A FLOOR THE ENGINE CALLS IMPOSSIBLE
   *  WEARS NO COMMIT AND NO PERMISSION LINE.
   *
   *  `ackAllowed: false` on a blocked cell is the engine's own word for a
   *  placement that CANNOT be made — strict mode's refusals, `R-UNAVAILABLE`
   *  (gap-guard :370-377) — and ⚖ 73's law is already written for exactly this:
   *  「A floor the engine calls impossible is not a floor a manager can be given
   *  authority over」. So this face may carry neither a live 注意して配置 nor the
   *  affirmative 「店舗の設定で、スタッフの上書きが許可されています」: nothing is
   *  being permitted here, and no dial ever had the authority to permit it.
   *
   *  The lock line stays NULL too: 「この場所への配置は店長のみ」 would be false —
   *  this is physics, not the store's setting, and naming the manager would
   *  send the operator to ask for something no manager can grant.
   *
   *  ⚖ 92 fix round 5 V2 (breaker #4) — AND IT ANSWERS BEFORE THE DIAL DOES.
   *  Round 4 put this branch under 'refuse', so a locked-out operator standing on
   *  an IMPOSSIBLE start read 「この場所への配置は店長のみ（店舗の設定）」 — the
   *  store's setting named as the obstacle over a spot no setting governs, which
   *  sends them to ask a manager who is refused by the very same physics. This
   *  branch's own sentence three paragraphs up is the citation: naming the
   *  manager sends the operator after something no manager can grant, and that is
   *  no less true when the dial happens to refuse them too. Physics outranks the
   *  dial, so it is asked first.
   *
   *  Safe primary, rows, greens and 元に戻す are untouched — being unable to
   *  place HERE is not being unable to place.
   *
   *  ⚖ 92 fix round 8 Z1 (breaker #7 #1) — AND IT IS THE GUARD'S OWN FLOOR, NEVER
   *  A FACE THE OVERRIDE LIT.
   *
   *  ⚖ 73's law is about the floors the GUARD found: a placement the engine calls
   *  impossible is not one a manager can be given authority over. Round 4 U3 wrote
   *  the branch on `cell` alone, so it also answered a face lit ONLY by a
   *  walked-past row — the breaker's scene is a 60分 card dropped at 19:00 on a
   *  〜19:00 shift and staged through the checks-policy override, whose cell is the
   *  no-pocket refusal: `ackAllowed: false`, and impact-less, so the guard never
   *  weighed a protected window here at all. That face lost its commit to a law
   *  about a fact it was not carrying, and the operator was walled out of a
   *  landing ⚖ 50(d)'s gate had already cleared. It shipped in round 4 and was
   *  live until now; rounds 5 and 6 probed only the strict-mode and board-moved
   *  paths and read it as latent.
   *
   *  So the branch asks `guardWarn` — the guard's own trigger, which since ⚖ 9/1
   *  ruling 2/2 means a cell that actually costs the store a protected window. A
   *  strict-mode R-REP with a real loss is guard-lit and stays commit-less (⚖ 73
   *  intact); an impact-less blocked cell is guardWarn-false by construction, so a
   *  face lit by a walked-past override alone composes its commit from ⚖ 50(d)'s
   *  gate exactly as the clean face always did.
   *
   *  ⚖ 92 fix round 9 W1 (breaker #8 #1) — AND IT SAYS SO, IN THE CLEAN FACE'S
   *  OWN WORDS. Round 4 returned `commit: null` here, so a strict-mode card
   *  printed the ruled cost sentence — ¥ and all — and then simply had no control
   *  under it: a face that names a price the operator cannot pay and never says
   *  WHY the button is missing. The clean face has always answered this exact
   *  state honestly with `confirmCaption`'s 「この位置では確定できません」
   *  (drag-rules :234, FROZEN), and the F10 arm below already says those same
   *  words on the warn face, so this branch says them too rather than going mute.
   *
   *  ⚖ 73 IS INTACT, AND IT IS PINNED IN THE CODE: `enabled` is the literal
   *  `false`, NOT `input.confirmEnabled`. The manager still cannot be given
   *  authority over a floor the engine calls impossible — this branch's disabled
   *  state is UNCONDITIONAL, because physics outranks the checks gate, so no
   *  dial and no gate anywhere can turn this control live. The kind follows the
   *  store's dial exactly as every other commit does (the hold physics are inert
   *  when disabled), and `provenance` / `lock` stay null: nothing is being
   *  permitted here, so nothing on the card claims it is.
   *
   *  ⚖ 92 fix round 11 P1 (breaker #10 #1) — AND U3'S CLOSING SENTENCE GOES WITH
   *  THE READING THAT WROTE IT. It said the headline here was 「already the
   *  engine's verbatim sentence (`impactOf`'s unruled fallback, ¥-free), which is
   *  the whole answer」 — true of the class U3 was looking at, and false of every
   *  cell that can actually arrive since round 8 Z1 put `guardWarn` on the front
   *  of this branch. Guard-lit means a REAL protected loss, and `lossOf` counts
   *  one only off an impact the panel above rules on (`R-REP` / `DEGRADED`), so
   *  what leads this face is the ruled sentence with the board's own ¥ beside it.
   *  The un-ackable class U3 cited alongside strict mode — `R-UNAVAILABLE`
   *  (gap-guard :372) — reaches the rail through `blocked()` with no `impact` at
   *  all, so it is `guardWarn`-false by construction and never arrives here.
   *  What answers the operator is round 9 W1's DEAD LABELED COMMIT below: the
   *  price is named, and the button that cannot pay it says why. */
  /** ⚖ 9/1 STRICT-SWITCH RULING (settings round, fix round 1 F1) — AND THE WALL
   *  IS THE DIAL'S, SO IT ANSWERS THE DIAL'S OWN QUESTION: WHO.
   *
   *  `ackAllowed` is role-BLIND — gap-guard sets it from the store's mode alone
   *  (`reason.ackAllowed = mode === 'standard'`, :398, FROZEN) — so this branch
   *  walled EVERYONE at STRICT, 店長・オーナー included. The approved settings
   *  page says the opposite in as many words: its 店長がしっかり見る preset reads
   *  「確保枠を壊す場所に置けるのは店長だけです」, and 「店長のみでも警告を止める」
   *  promises 「権限のないスタッフは…確定できなくなります」. Both are about the
   *  people the 上書きの権限 dial EXCLUDES; the permitted keep the warn commit.
   *  The copy is the ruling, and the code drifted when ruling 1/2's lock face was
   *  deleted — the wall lost the only branch that knew whose it was.
   *
   *  So the role half is composed HERE rather than in the engine, which is where
   *  it has to live anyway: gap-guard is canon and knows nothing about operators,
   *  and this composer is already handed `level` — ruling 91's answer about THIS
   *  operator (`overrideLevelFor`: the store's own override roles, with
   *  `lockedOut` answering first). `refuse` is exactly 「the store did not give
   *  this person the override」, by role or by name, so it is the whole of the
   *  test. A store at STRICT whose dial admits everyone is a coherent no-op, and
   *  STANDARD is untouched (`ackAllowed` is true there, so this branch never
   *  fired for anyone: ⚖ ruling 1/2's loosen stands, walls only true 置けない).
   *
   *  ⚖ 73 IS UNTOUCHED. Its floor — `R-UNAVAILABLE`, the physically impossible
   *  placement — reaches the rail through `railCell`'s `blocked()` with NO
   *  `impact` at all (gap-guard :372 → :1747), so `lossOf` is 0, `guardWarn` is
   *  false, and it has never arrived at this branch since round 8 Z1 put
   *  `guardWarn` on the front of it (round 11 P1 says so in its own words). What
   *  survives here is the STRICT refusal and nothing else, which is why the level
   *  may decide it: a cost the engine WILL let the store pay is the dial's to
   *  govern, and this is the dial governing it. */
  if (guardWarn && cell.state === 'blocked' && cell.ackAllowed === false && !dialAdmits(level)) {
    return {
      face: 'warn', impact, provenance: null, lock: null, safePrimary,
      commit: { kind: input.holdToConfirm ? 'hold' : 'press', label: 'この位置では確定できません', enabled: false, note: null },
      rows: kept, greensLine: greensLineOf(oks),
    }
  }
  /** ⚖ 9/1 ruling 1/2 (Liam, merge-gate) — THE LOCK FACE IS DELETED, AND THE
   *  READING THAT BUILT IT IS OVERTURNED.
   *
   *  A `level === 'refuse'` branch used to stand here and return the red line
   *  「この場所への配置は店長のみ（店舗の設定）」 with no commit at all, so a
   *  locked-out operator standing on a merely-COSTLY start (ack-allowed,
   *  `computeChecks`-confirmable) was walled by the dial. It was composed from
   *  PKT-MOCK-WARN-CONFIRM's face 3 and pinned as deliberate by rounds 2 S6 /
   *  3 T1 / 4 U2 / 6 X1 against three dissenting reviewers who read it as a
   *  blocker.
   *
   *  Asked the sharpened question at the merge gate, Liam picked "Loosen it".
   *  The three reviewers were right and Fable's face-3 reading was wrong, and it
   *  is recorded here rather than quietly deleted. His rule now: the dial walls
   *  only TRUE 置けない — the engine's own impossible floors, which the branch
   *  above already answers commit-less by ⚖ 73, and the consult box's
   *  policy-floor override, which stays `canOverride`-gated on its own surface.
   *  A cost the engine will let the store pay is not the dial's to forbid; it is
   *  the operator's to confirm, out loud, through the warn commit.
   *
   *  So every level below 承認 now composes the SAME staff-OK anatomy — the
   *  provenance line and the hold/press commit — and the level is left saying
   *  only what it is still true about: WHOSE authority the record carries
   *  (`provenance` below) and whether an approval is owed (`needs-approval`).
   *  `WarnCardModel.lock` is kept as a slot with no producer, exactly as the
   *  'needs-approval' face is kept unreachable: the settings round owns the
   *  presets, and re-lighting a wall there must not mean re-inventing it. */
  const commit: WarnCardCommit =
    level === 'needs-approval'
      // ⚖ 92 fix round F5 (blind L1#9) — AND IT RENDERS DISABLED. The request
      // has nowhere to go: there is no server-backed approval state on this
      // board, so a live-looking control would promise a message nobody
      // receives. Its own note already says where it comes from, and the
      // settings round is what lights it.
      // ⚖ 92 micro-fix M3, JP native pass — the note is STAFF-FACING, so it says
      // what the operator can act on (nothing yet) and not which build round
      // wires it. 「設定の回で接続」 is our process, printed on their card.
      ? { kind: 'approval', label: '店長に許可を求める', enabled: false, note: '承認機能は準備中です' }
      // ⚖ 92 — NEVER the neutral この内容で確定 on a warn face, and the store's
      // dial decides only HOW the press is made, never whether it is allowed:
      // `confirmEnabled` is `overrideCaption`'s answer, untouched, and a second
      // blocker standing after the override still kills the button (canon R11-7).
      //
      // ⚖ 92 fix round F10 (blind L2#5) — AND A BLOCKED COMMIT SAYS WHY. A
      // greyed 注意して配置する still names the act, so it reads as "press this
      // to place anyway" over a control that will never fire — the clean face
      // has always answered this honestly, with `confirmCaption`'s own
      // 「この位置では確定できません」 (drag-rules :234, FROZEN), and the warn
      // face says the same words about the same state. The KIND is unchanged:
      // the hold physics are disabled anyway, and swapping the control's shape
      // under a blocker would move the button the operator is aiming at.
      : {
          kind: input.holdToConfirm ? 'hold' : 'press',
          label: input.confirmEnabled
            ? (input.holdToConfirm ? '長押しで注意して配置' : '注意して配置する')
            : 'この位置では確定できません',
          enabled: input.confirmEnabled,
          note: null,
        }
  /** ⚖ 9/1 ruling 1/2 (Liam, merge-gate) — AND THE LINE MAY NOT THANK A DIAL
   *  THAT REFUSED. With the lock face gone, a 'refuse' operator reaches the same
   *  commit as a permitted one — but 「店舗の設定で、スタッフの上書きが許可され
   *  ています」 would be a plain lie to them: the store did NOT permit their
   *  overrides, and this ruling is what lets them confirm anyway. So at 'refuse'
   *  the permission clause is dropped and only the record clause stands, in the
   *  same words the two permitted faces already use (the ⚖ 92 name rule
   *  unchanged: the operator's name on someone else's lane, bare on their own).
   *
   *  ⚖ 92 fix round 8 Z5 (JP native pass) — AND ON THEIR OWN LANE IT IS A WHOLE
   *  SENTENCE. Everywhere else 「記録されます」 rides a lead-in clause; here it is
   *  the entire line, and standing alone a native eye reads it as incomplete —
   *  and asymmetric beside the other-lane line right next to it, which names a
   *  person. 「あなたの名前で記録されます」 closes both: it prints no actual name,
   *  so the ⚖ 92 rule that the name line is other-lane-only still holds. The
   *  other-lane wording is untouched. */
  const provenance =
    level === 'refuse'
      ? (input.targetLaneMine ? 'あなたの名前で記録されます' : recordedBare)
      : (level === 'needs-approval' ? '店舗の設定で、上書きには店長の承認が必要です' : '店舗の設定で、スタッフの上書きが許可されています') + `。${recordedBare}`
  return { face: 'warn', impact, provenance, lock: null, safePrimary, commit, rows: kept, greensLine: greensLineOf(oks) }
}

/** ⚖ 92 — THE LONG PRESS, AS ARITHMETIC. Ported from the approved page's own
 *  mechanics (`warncard-design.html`, the HOLD/W block) so the feel Liam signed
 *  off on is the feel that ships, and kept out here so 600ms / resume / cancel
 *  are provable without a DOM or a fake clock in a renderer.
 *
 *  `hold` is a plain ratio of elapsed time, which is what makes RESUME free: the
 *  caller re-seeds `t0` through `holdResumeAt` and the same expression continues
 *  from where the finger left off. `spring` is the critically-damped release the
 *  page uses to run the fill back to zero — it carries the press's own velocity
 *  out, so a cancelled hold recoils instead of snapping. */
export const HOLD_MS = 600
/** Critically-damped rate — the page's own W: ~280ms to settle. */
export const HOLD_SPRING_W = 24
/** The velocity the cancel carries out: one full fill per HOLD_MS, in units/sec. */
export const HOLD_CANCEL_V = 1000 / HOLD_MS

export function holdClock(
  s: { mode: 'hold' | 'spring'; t0: number; x0: number },
  now: number,
): { progress: number; done: boolean } {
  if (s.mode === 'hold') {
    // ⚖ 92 fix round 6 X6 (breaker #5) — CLAMPED AT BOTH ENDS. `t0` is not
    // always in the past: `holdResumeAt` re-seeds it from a progress ratio, and
    // a cancel can re-seed it AHEAD of the frame timestamp the caller is already
    // holding — one frame of `scaleX(-0.0…)`, a sliver of fill painted out of
    // the wrong edge. A ratio of ELAPSED time cannot honestly be negative, so
    // the floor is stated rather than left to the callers to remember.
    const progress = Math.min(1, Math.max(0, (now - s.t0) / HOLD_MS))
    return { progress, done: progress >= 1 }
  }
  const t = (now - s.t0) / 1000
  const x = (s.x0 + (HOLD_CANCEL_V + HOLD_SPRING_W * s.x0) * t) * Math.exp(-HOLD_SPRING_W * t)
  // The page's own two exits: close enough to zero to be zero, or long enough
  // that a numerically odd start may not keep a fill on screen for ever.
  return x <= 0.002 || t > 0.6 ? { progress: 0, done: true } : { progress: x, done: false }
}

/** The `t0` a hold resumes from, so a second press continues the first one's
 *  fill rather than restarting it (the page's `performance.now() - prog * HOLD`). */
export const holdResumeAt = (progress: number, now: number): number => now - progress * HOLD_MS

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
export function applyBlockMoves(lanes: BoardLane[], blockMoves: Moves, hours: Hours, deleted: string[] = []): BoardLane[] {
  // ⚖ Liam flag 64 (2026-08-22) — THE DELETE IS APPLIED IN THE SAME PASS AS THE
  // MOVE, so the board, the sell layer, `blockClash` and the guard's occupancy
  // all stop seeing the block in the SAME frame: they all read the lanes this
  // function returns. One filter, and there is nowhere for them to disagree.
  //
  // Deliberately NOT day-nav-surviving, for the reason BusinessSessionEdits.tsx
  // already states about `blockMoves`: a 予定ブロック is keyed by `item.key` and
  // the fixture world draws the same block on every day, so a deletion that
  // survived a `?day=` flip would erase it from every day at once. Dying on the
  // flip is the safe default until that is a made decision.
  if (deleted.length > 0) {
    const gone = new Set(deleted)
    lanes = lanes.map((lane) => (lane.items.some((i) => gone.has(i.key)) ? { ...lane, items: lane.items.filter((i) => !gone.has(i.key)) } : lane))
  }
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
