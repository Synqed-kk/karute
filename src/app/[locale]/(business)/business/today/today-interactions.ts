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
import { createGapGuard, type GuardConfig, type GuardContext, type GuardReason } from '@/business/lib/canon-logic/gap-guard'
import { gapFillPrice, packedPrice, priceAt, type PriceFrame } from '@/business/lib/canon-logic/pricing'
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
}

/** The engine's ctx for ONE staff lane — canon `ctxFor` (:7278). The clock the
 *  lead-time exemption reads, and the rooms. */
function railCtx(lane: BoardLane, input: RailInput): GuardContext {
  const feasible = input.placementFeasible
  return {
    now: input.nowMinute ?? undefined,
    placementFeasible: feasible ? (start, dur) => feasible(lane, start, dur) : undefined,
  }
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
  if (input.stepMin <= 0) return []
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
    for (let start = input.open; start < input.close; start += input.stepMin) {
      cells.push(railCell(engine, pockets, start, input, ctx))
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
  return railCell(createGapGuard(input.guard), pockets, start, input, railCtx(lane, input))
}

function railCell(
  engine: ReturnType<typeof createGapGuard>,
  pockets: ReturnType<typeof freePockets>,
  start: number,
  input: RailInput,
  ctx: GuardContext,
): RailCell {
  const blocked = (sentence: string): RailCell => ({
    start, state: 'blocked', label: '—', sentence, alternatives: [], alternativeKind: null, ackAllowed: false,
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
      ...blocked(`この開始には${input.dur}分の連続した空きがありません`),
      alternatives,
      // ponytail: zero-loss starts only. A pocket whose every feasible start is
      // lossy still answers 「ありません」 — upgrade to the engine's own
      // least-loss ranking if that case ever reaches Liam's eyes.
      alternativeKind: alternatives.length > 0 ? 'safe' : null,
    }
  }
  const v = engine.evaluate(pocket, { start, dur: input.dur }, ctx)
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
      ),
      alternatives: v.alternatives,
      alternativeKind: v.alternativeKind,
    }
  }
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
  if (stepMin <= 0) return { ...cell, alternatives: [] }
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
  if (stepMin <= 0) return []
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

/** ⚖ 51 — DOES THIS BOOKING NEED THE 個室, one spelling. The solve asks it to
 *  pick the room and the refusal asks it to pick the WORD it says out loud; two
 *  copies of the predicate is how a box comes to say ベッド over a 個室 hunt. */
export const needsPrivateRoom = (vip: boolean, policy: RoomPolicy) => vip && policy.vipStaysPrivate

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

/** ⚠SETTINGS-BATCH — the store's two room-allocation judgements, as data. They
 *  arrive from `opsConfig.roomPolicy`; nothing in this file or in the board
 *  decides them, so a store that runs its 個室 differently changes a setting
 *  rather than a component. */
export interface RoomPolicy {
  vipStaysPrivate: boolean
  privateIsLastResort: boolean
}

/** ⚖ 51 — A VIP NEVER SILENTLY LEAVES THE 個室, spelled ONCE.
 *
 *  The same two-sided shape as `sharesStore`, for the same reason: `allocateBed`
 *  uses it as a FILTER when the board is choosing a room, and `landingVerdict`
 *  uses it as a TEST when the operator named the room out loud on a bed row.
 *  That gesture never reaches the allocator (⚖ 51's exemption), so while the
 *  rule lived only inside `allocateBed` a 個室クラス booking could be hand-placed
 *  onto a same-store standard bed with no verdict at all — the auto path
 *  enforced the floor and the explicit path walked straight past it
 *  (Greptile #744 P1). A rule with two spellings is a rule with two answers. */
export function roomFitsClass(lane: BoardLane, vip: boolean, policy: RoomPolicy): boolean {
  return !(vip && policy.vipStaysPrivate) || lane.roomClass === 'private'
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
    /** A VIP/個室クラス booking never silently leaves the 個室. */
    vip: boolean
    start: number
    end: number
    policy: RoomPolicy
    /** ⚖ Liam flag 50(d) (2026-08-22) — 「注意して配置」. An operator the store
     *  has given the authority has already been told this landing is 置けない
     *  and has said it happens anyway, so the search stops asking whether the
     *  room is free and names the one it would otherwise have chosen. The
     *  COMPATIBILITY rules are untouched — an escalation over a busy room is not
     *  permission to walk a VIP out of the 個室 (⚖ 51's floor is a rule about
     *  what the treatment needs, not about who is in the way).
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
): { laneKey: string | null; refusal: string | null } {
  const { id, start, end, policy } = opts
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
  const needsPrivate = needsPrivateRoom(opts.vip, policy)
  const compatible = (l: BoardLane) => roomFitsClass(l, opts.vip, policy)
  const free = (l: BoardLane) => opts.allowBusy === true || blockersOn(l).length === 0
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
  return {
    laneKey: null,
    refusal: fullRoomsRefusal(candidates.map((l) => [l, blockersOn(l)] as const), start, end, needsPrivate, opts.stagedId ?? null),
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
  policy: RoomPolicy,
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
        vip: held?.category === 'vip',
        start,
        end: start + dur,
        policy,
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
  return `${title ? `${title}様 → ` : ''}${clockOf(from)}〜${clockOf(to)} / 担当 ${staffLane?.label ?? '—'} / ${moved}${bedLane?.label ?? '—'}`
}

/** ⚖ flags 44 + 51 — 満室, said the way the board says every other refusal: the
 *  exact window it judged, then WHY, naming the room and who is in it. 清掃 and
 *  予定ブロック answer with their own word (they have no customer).
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
  needsPrivate: boolean,
  stagedId: string | null = null,
): string {
  const window = `${clockOf(start)}〜${clockOf(end)}`
  const room = needsPrivate ? '個室' : 'ベッド'
  if (rows.length === 0) return `${window}に使える${room}がありません`
  const who = (i: BoardItem) =>
    i.kind !== 'booking'
      ? i.title
      : stagedId != null && i.caseId === stagedId
        ? `仮押さえ中：${i.title}様`
        : `${i.title}様`
  const named = rows.map(([lane, blockers]) => `${lane.label}が使用中（${[...new Set(blockers.map(who))].join('・')}）`)
  return `${window}は${room}が満室です。${named.join('、')}`
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
 *  JUDGEMENT (the VIP rule, 勤務時間外, シフトロック — the mistake-proofing
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
  vip: boolean
  start: number
  end: number
  /** The same span in canon's percent units — `computeChecks` speaks percent. */
  span: { x: number; w: number }
  /** ⚖ 46 — a chip or a 配置モード intent carried onto a foreign store's board. */
  foreignRefusal: string | null
  locked: string[]
  rooms: RoomPolicy
  minutesOf: (x: number) => number
  /** ⚖ R3 ONE WORLD — the session's own unconfirmed move, for the one sentence
   *  that can end up naming it (`allocateBed`'s 満室 refusal). Absent is the
   *  honest default: a board with nothing staged has no such occupant, and every
   *  caller that genuinely has one passes it. */
  stagedId?: string | null
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
  const stop = (reason: string, floor: LandingFloor): LandingVerdict =>
    ({ kind: 'blocked', floor, label: VERDICT_WORD.blocked, reason, cell, bedLane, checks })
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
        vip: q.vip,
        start: q.start,
        end: q.end,
        policy: q.rooms,
        stagedId: q.stagedId ?? null,
      })
    : { laneKey: q.bedLane, refusal: null }
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
  checks = computeChecks(q.span, {
    spans,
    bookingId: q.id ?? '',
    staffName: staff.label,
    staffUntil: staff.untilLabel,
    laneLocked: q.locked.includes(staff.key),
    minutesOf: q.minutesOf,
  })

  // ⚖ STORE ISOLATION on the explicit room choice — `allocateBed` filters, this
  // tests, and `sharesStore` is the one spelling of the rule either way.
  if (!q.solveRoom && bed && !sharesStore(staff.stores, bed.stores)) {
    return stop(`担当と店舗が異なります: ${staff.label} / ${bed.label}`, 'hard')
  }
  // ⚖ 51 on the explicit room choice — the store rule is not the only floor the
  // allocator applies, so it may not be the only one this path re-tests: a 個室
  // クラス booking dropped straight onto a standard bed was landing silently.
  // 置けない like every other floor, which means it inherits ⚖ 50(d) whole — the
  // explanation names the policy, and the 「注意して配置」 escalation appears only
  // where the store's overridePolicy put it. The VIP leaves the 個室 out loud,
  // with a manager's name on it, or not at all.
  // ⚖ 73 — POLICY. Liam named the VIP rules himself: this is the store's own
  // judgement about what the treatment is owed, and the override is the manager
  // walking the VIP out of the 個室 OUT LOUD, with their name on it, which is
  // the un-silent path ⚖ 51 was written to protect.
  if (!q.solveRoom && bed && !roomFitsClass(bed, q.vip, q.rooms)) {
    return stop(`VIP・個室クラスのご予約です: ${bed.label}は個室ではありません`, 'policy')
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
  if (solved.refusal) return stop(solved.refusal, 'hard-room')
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
  // 店舗 / 重複 / 勤務 / ロック / 満室 / VIP・個室 — all of which are `stop`s
  // above this line — plus `R-UNAVAILABLE` here.
  // ⚖ 73 — `ackAllowed: false` is the engine's own word for physically
  // impossible (gap-guard :371, `R-UNAVAILABLE`). A floor the engine calls
  // impossible is not a floor a manager can be given authority over.
  if (cell?.state === 'blocked' && !cell.ackAllowed) return stop(cell.sentence, 'hard')
  if (cell && cell.state !== 'safe') return { kind: 'caution', floor: null, label: VERDICT_WORD.caution, reason: cell.sentence, cell, bedLane, checks }
  return { kind: 'clean', floor: null, label: VERDICT_WORD.clean, reason: null, cell, bedLane, checks }
}

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
