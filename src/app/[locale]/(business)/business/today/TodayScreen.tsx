'use client'

// 今日の運営 — the canon board's markup and behaviour (fable-store-today.html),
// transplanted. Canon class names, canon Japanese wording, canon structure.
//
// FULL INTERACTION PARITY (⚖ the 8/19 behaviour-parity amendment). What the
// board does, and where the rules come from:
//
//   · DRAG-MOVE and EDGE-RESIZE snap on canon's DUAL LATTICE — see the header of
//     src/business/lib/canon-logic/drag-rules.ts. A booking that starts at 17:12
//     moves to 17:42, unless it is carried near a clean slot, in which case it
//     heals onto it. Shift+←/→ moves the start, Alt+←/→ the end, 30 minutes a
//     press.
//   · Every landing STAGES a 仮押さえ rather than committing: the bar shows
//     canon's computed checks and 確定 is disabled until they all pass — and the
//     checks are re-run at confirm time, never trusted from staging time.
//   · The 仮置きエリア takes a card off the board and hands back a chip; the chip
//     drags onto any lane, or its × returns it to where it came from.
//   · The 販売可能枠 layer is DERIVED IN THE BROWSER on every board change, so a
//     drag moves the windows with it and a card cannot sit inside a window the
//     board is still advertising. Prices come from canon's hour curve, scaled by
//     the store's own 最高価格 lever in the Reserve dialog.
//   · Empty track click opens 新規予約を作成 seeded at that half hour.
//
// NOTHING PERSISTS. Every transition above is client state: reload resets the
// board, no write leaves the browser, and each toast says so. A commit with no
// canon client transition sits DISABLED with the standing hint — nothing here
// reports a success the board cannot show.
//
// E9f (60分→新規90分のデモ) does not ship: canon's own copy calls it a
// page-local sample.

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  computeChecks,
  confirmCaption,
  dragOrigin,
  keyboardNudge,
  shelfLanding,
  stepPct,
  type Check,
  type CheckSpan,
  type DragMode,
  type DragOrigin,
} from '@/business/lib/canon-logic/drag-rules'
import {
  clampPriceInputs,
  floorDiscountPercent,
  framingSample,
  discountNote,
  hqNote,
  priceButtonCaption,
  money,
} from '@/business/lib/canon-logic/pricing'
import type { GuardConfig } from '@/business/lib/canon-logic/gap-guard'
import { hhmm, minuteOf, place, yen, type BoardItem, type BoardLane } from '@/business/lib/today-board'
import { useSessionEdits, type ParkChip } from '../../BusinessSessionEdits'
import { useTopbarAction } from '../../BusinessTopbar'
import {
  anchorOnScreen,
  applyBlockMoves,
  applyMoves,
  blockChrome,
  blockClash,
  blockDragModeAt,
  blockEdgeZones,
  blockStepPct,
  cardNodes,
  chipProxySize,
  clampLabelWidth,
  clickClosesPopover,
  dragModeAt,
  fieldsPopAnchor,
  fitsDrag,
  fractionIn,
  freePartnerLane,
  labelWidthOf,
  liveTimeLabel,
  proxyTransform,
  stretchOrCarry,
  gapLayerFor,
  guardCheckRow,
  guardRailsFor,
  guardVerdictAt,
  blockNode,
  holdPopAnchor,
  isCrumbOffer,
  isOverShelf,
  laneKeyAtY,
  nextSpan,
  onShownBoard,
  pairLanesOf,
  parkChipText,
  pinInViewport,
  sameStore,
  sellLayerFor,
  sidesAt,
  slotStartAt,
  spotCardAt,
  spotHitIndex,
  spotTargets,
  unparkOutcome,
  foreignStoreRefusal,
  wrapStep,
  type GuardRail,
  type Move,
  type Moves,
  type PairLanes,
  type RailCell,
  type SpotRect,
} from './today-interactions'

const HINT = '見本データのため実行できません'

/** ⚖ Liam flag 47 — how long the board's own voice stays on screen. The shipped
 *  3.2s is right for a message that CONFIRMS something the operator can already
 *  see; a refusal is the only evidence that a thing did not happen, and it has
 *  to outlive the glance that missed it. Twice the dwell, no new surface. */
const TOAST_MS = 3200
const REFUSAL_MS = 7000
const EMPTY_TOAST = { text: '', ms: TOAST_MS, n: 0 }

export interface DecisionCard {
  id: string
  kind: string
  deadline: string
  deadlineTone: '' | 'overdue' | 'opportunity'
  urgent: boolean
  state: 'open' | 'waiting' | 'resolved'
  status: string
  statusTone: '' | 'checkout' | 'public' | 'waiting' | 'done'
  title: string
  detail: string
  evidence: Array<[string, string]>
  bookingId: string | null
}

export interface InspectorCase {
  id: string
  kicker: string
  title: string
  meta: string
  status: string
  statusTone: '' | 'checkout' | 'public' | 'waiting' | 'done'
  source: string
  facts: Array<[string, string]>
  proofTitle: string
  proofs: string[]
  price: string | null
  primary: string | null
  bookingId: string | null
}

export interface TodayProps {
  locale: string
  storeParam: string | null
  lensLabel: string
  dayOffset: number
  dayLabel: string
  monthLabel: string
  isToday: boolean
  windowDays: number
  hours: { open: number; close: number; count: number; labels: string[] }
  nowFraction: number | null
  nowLabel: string
  lanes: BoardLane[]
  /** The dials the 販売可能枠 derivation runs on — see the header. */
  sell: { gridMin: number; nowMinute: number | null }
  /** スキマガード. `mode` is the STORE's protection policy (店舗設定); `config`
   *  is what the engine itself reads. The 表示設定 segment beside it is a
   *  personal display preference and cannot change either. */
  guard: {
    mode: 'off' | 'standard' | 'strict'
    standardSessionMin: number
    protectedDurationMin: number
    protectedLabel: string
    gapFillMinMin: number
    gapFillDiscountPct: number
    /** ⚖ Liam 2026-08-21 — 販売可能な最小の長さ. Shorter than this and the space
     *  is not advertised at all (see `gapLayerFor`). A store dial. */
    minSellableMin: number
    config: GuardConfig
  }
  closedWeekdayLabel: string
  ops: {
    total: string
    settled: string
    awaiting: string
    cashDifference: string
    unresolved: number
    syncLabel: string
    undelivered: number
  }
  myDay: { next: string; pending: string; pendingWarn: boolean; todayCount: string; shift: string; break: string } | null
  inStore: { name: string; bookingId: string } | null
  incident: {
    staffName: string
    from: string
    reason: string
    affected: string
    undecided: number
    waitingContact: number
    steps: string[]
    intakeStopped: boolean
    caseId: string | null
  } | null
  cards: DecisionCard[]
  cases: Record<string, InspectorCase>
  kpi: { count: string; revenue: string; utilization: string; note: string }
  hold: { summary: string; checks: string[]; bookingId: string } | null
  calendar: Array<{ offset: number; y: number; m: number; d: number; wd: number; closed: boolean; free: number; booked: number }>
  dialogs: {
    recovery: { rows: Array<[string, string]> } | null
    checkout: { title: string; sub: string; amount: string; rows: Array<[string, string]>; bookingId: string } | null
    pricing: {
      base: number
      hqMin: number
      hqMax: number
      hqSpread: number
      version: string
      approvedAt: string
      approvedBy: string
      protectedLabel: string
      slots: Array<{ id: string; label: string; sub: string; price: string }>
    }
    terminal: { rows: Array<[string, string]> }
    closing: { title: string; sub: string; checks: Array<[string, string, boolean]> }
    blockers: Array<[string, string]>
    create: {
      staff: Array<{ id: string; name: string }>
      menus: Array<{ id: string; name: string; minutes: number; price: string; store: string }>
      customers: Array<{ id: string; name: string; no: string; phone: string; furigana: string }>
      sources: string[]
      blockKinds: string[]
      blockLengths: number[]
      openLabel: string
      closeLabel: string
    }
    storeFront: { slots: Array<{ id: string; label: string; menuName: string; storePrice: string; publicPrice: string }> }
    blocks: Array<{ id: string; kind: string; who: string; whoLabel: string; start: string; end: string; note: string }>
  }
}

const WD = ['日', '月', '火', '水', '木', '金', '土']

/** The `--label` the stylesheet seeds the board with (today.css `.biz .timeline`).
 *  The divider's first drag starts from whatever is computed, and falls back to
 *  this when the property has not been resolved yet. */
const LABEL_DEFAULT = 112

const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total

const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

/** Canon's board root classes live on <body>; the root layout owns <body>, so
 *  they ride the shell root instead — the same relocation WO-1 made for the
 *  rail. One effect, one class, removed on unmount. */
function useShellClass(name: string, on: boolean) {
  useEffect(() => {
    const root = document.querySelector('.biz')
    if (!root) return
    root.classList.toggle(name, on)
    return () => root.classList.remove(name)
  }, [name, on])
}

interface DragCtx {
  id: string
  pointerId: number
  origin: DragOrigin
  startX: number
  startY: number
  /** The GRABBED lane's group — 'staff' or 'beds'. ⚖ BATCH-6 flag 45: this is
   *  the whole of what decides which half of the pair retargets, because a
   *  booking is drawn twice and both drawings are draggable (canon binds every
   *  `.event[data-book]`, :3887). It already leashed the lane hunt; it now also
   *  says which record the landing is written into. */
  group: string
  homeLane: string
  targetLane: string
  /** ⚖ BATCH-6 flag 45 — THE TWO-SIDED REVERT SNAPSHOT, taken at pointerdown
   *  from the lanes the pair is ACTUALLY on (canon's per-element snap,
   *  `stageChange` :4652-4661). The side that is not being dragged never moves
   *  during the gesture, so this is also the live answer to "where is the other
   *  half right now". */
  home: PairLanes
  track: Element
  moved: boolean
  overShelf: boolean
  /** The card and the lane the drag started on. The pointer stream no longer
   *  arrives through the card's own JSX handlers, so the release has to carry
   *  them rather than read them off an event target that may not be the card. */
  item: BoardItem
  lane: BoardLane
  /** ⚖ Liam flag 29 — EVERY drawing of this booking (the staff card and its bed
   *  copy). A RESIZE never leaves the board, so the frame is painted onto these
   *  elements directly (canon's `evSet`); they are stable for the life of the
   *  gesture because nothing re-parents the board mid-drag and `drawnLanes`
   *  freezes at the committed span. */
  nodes: HTMLElement[]
  /** Where inside the card the pointer actually landed, and how big the card is.
   *  The proxy is drawn from these so it hangs off the cursor at the exact point
   *  it was grabbed — ⚖ Liam 2026-08-20: "attached, not trailing". */
  grab: { dx: number; dy: number; w: number; h: number }
  /** rAF coalescing: the newest pointer position, applied once per frame. */
  pending: { clientX: number; clientY: number } | null
  frame: number | null
  detach: () => void
}

/** ⚖ Liam 2026-08-20 (flags 19/20) — THE DRAG PROXY. Canon slides the real card
 *  horizontally inside its own lane and paints a dashed ghost in the destination
 *  (dragMove :4505–4523), so a drag that travels DOWN shows the operator nothing
 *  but an empty outline moving. Liam rejected that: the card he grabbed travels
 *  with the cursor, in both axes, and the dashed outline stays behind as the
 *  snapped landing preview while the origin dims.
 *
 *  It is an OVERLAY, never the card itself. Re-parenting the real node mid-drag
 *  is what killed the pointer capture in WO-2c, and moving it per frame through
 *  React would put the board back in the render loop WO-2d took it out of. This
 *  element is mounted once per gesture, its transform is written straight to the
 *  node from the same coalesced rAF, and React never owns that transform. */
/** `ParkChip` and the rest of the session-edit family now live in
 *  ../../BusinessSessionEdits — the layout survives a `?day=` navigation and
 *  this screen does not (⚖ Liam 22). */

type DragProxy =
  | { kind: 'card'; item: BoardItem; state: string; w: number; h: number }
  /** ⚖ Liam flag 26 — a block travels under the cursor for the same reason a
   *  booking does (flag 19): a box that only slides sideways while the pointer
   *  goes down is the "can't drag it to another lane" report all over again. */
  | { kind: 'block'; item: BoardItem; state: string; w: number; h: number }
  | { kind: 'chip'; title: string; line1: string; category: string | null; w: number; h: number }

/** ⚖ Liam flag 26 — canon's `blockDragCtx` (:4060). A deliberate twin of
 *  `DragCtx` rather than a flag on it: the two gestures share their plumbing
 *  (threshold, rAF coalescing, window-level listeners) but nothing of their
 *  MEANING — a block release has no shelf, no 仮押さえ, no guard consultation
 *  and no partner lane, so folding it into `finishDrag` would have been three
 *  branches through the one function WO-2c had to rebuild to make drag work at
 *  all. Canon draws the same line (bindDrag / bindBlockDrag, :4050). */
interface BlockDragCtx {
  key: string
  pointerId: number
  origin: DragOrigin
  startX: number
  startY: number
  homeLane: string
  targetLane: string
  track: Element
  moved: boolean
  item: BoardItem
  /** ⚖ Liam flag 29 — the block's own node, for the same reason the card has
   *  one: an edge press stretches the box in place instead of lifting it. A
   *  block has no bed copy, so it is always exactly one. */
  node: HTMLElement
  grab: { dx: number; dy: number; w: number; h: number }
  pending: { clientX: number; clientY: number } | null
  frame: number | null
  detach: () => void
}

/** The drag as the BOARD sees it, one state object updated at most once per
 *  animation frame. `homeLane` is where the card is still DRAWN — canon moves a
 *  card only horizontally during a drag and shows the destination as a ghost
 *  (dragMove :4509–4523) — while `targetLane` is where every derivation places
 *  it, so the windows and the guard answer for the landing, live. */
interface LiveDrag {
  id: string
  homeLane: string
  targetLane: string
  /** ⚖ BATCH-6 flag 45 — the pair's two memberships AS THIS FRAME WOULD LAND
   *  THEM, so the guard, the drop target and the window layers answer for a
   *  bed-side drag the same way they always answered for a staff-side one.
   *  Feeding `targetLane` into the staff record is what made a bed-row drag
   *  vanish the person's card the moment the pointer crossed a lane. */
  staffLane: string | null
  bedLane: string | null
  x: number
  w: number
  overShelf: boolean
  /** ⚖ Liam flag 29 — which gesture is in flight, so the origin card can wear
   *  the right face: a MOVE dims to .32 (the card is in the hand, this is the
   *  marker it was taken from), a RESIZE wears canon's live look (:1444) because
   *  the card the operator is holding IS this one. */
  mode: DragMode
}

/** ⚖ Liam flag 34 — the 仮押さえ confirm, as data. Two very different sources
 *  (the session's staged change and the day's own hold from the incident) render
 *  ONE surface, so there is one set of buttons, one set of check marks and one
 *  position rule rather than two bars that have to be kept looking alike. */
interface HoldPop {
  /** The booking the popover hangs under. Not on screen → the fixed pill.
   *  `null` = ALWAYS the pill: a standing 仮押さえ that this session did not
   *  stage has no gesture to answer and would otherwise sit on the board
   *  indefinitely, covering the lane under its card (canon's bar is in normal
   *  flow precisely so it "never covers the staged card", :4782). Measured, not
   *  argued: the anchored version swallowed the pointerdown of a card in the
   *  next lane down in the real-browser harness. */
  anchorId: string | null
  status: string
  tone: 'waiting' | 'done'
  summary: string
  checks: Array<{ label: string; tone: '' | 'bad' }>
  /** ⚖ 31b — the guard's own row, informational, never a gate. */
  guardRow: { label: string; tone: 'warn' | 'bad' } | null
  confirm: { label: string; enabled: boolean; run: () => void }
  revert: { enabled: boolean; run: () => void }
}

/** The 配置の相談 canon opens on a refused placement (:7106).
 *
 *  ⚖ Liam flag 31 — it opens on a NEW PLACEMENT now, never on a move. `place`
 *  is the placement the operator was in the middle of making, held so the
 *  popup's controls can actually perform it: an alternative runs it at the safer
 *  start, この開始に配置 runs it at the one they asked for. Canon holds exactly
 *  the same two callbacks on its own `info` object (`onAlternative` / `onAttempt`,
 *  :7141-7161) and for the same reason — the popup is a question about a
 *  placement, so it has to be carrying that placement. */
interface GuardAdvice {
  laneKey: string
  start: number
  cell: RailCell
  /** Where the operator's hand was — canon opens the popup at the pointer
   *  (`placePopNear(x, y)`), pinned inside the viewport (⚖ flag 35). */
  anchor: { x: number; y: number }
  place: (start: number) => void
}

export function TodayScreen(props: TodayProps) {
  const { hours, ops, dialogs } = props

  /** ⚖ Liam 22 — THE SESSION'S EDITS, read from the layout rather than held
   *  here. `?day=` is a Link, so this component remounts on every day flip;
   *  these six are the ones an operator would lose a booking to if they died
   *  with it. Same setters, same shapes — see BusinessSessionEdits.tsx for what
   *  each one is and why they are one family. */
  const {
    added, setAdded,
    moves, setMoves,
    bedMoves, setBedMoves,
    parked, setParked,
    parkChips, setParkChips,
    pending, setPending,
    placing, setPlacing,
    holdAnswer, setHoldAnswer,
  } = useSessionEdits()

  /** ⚖ 46 forerunner — WHICH BOARD IS ON SCREEN, as data. Every session-edit
   *  element is stamped from these two and scoped back against them, so no site
   *  can stamp the day and forget the store. `board` is what the predicates
   *  compare; `boardStamp` adds the two LABELS, for the records that have to be
   *  able to name the board they are answering for (the chip, the hold bar). */
  //  `board` is memoised because the whole derivation chain hangs off it: a
  //  fresh object every render would re-run `addedHere` → `boardLanes` → the
  //  sell layer and the guard, on every keystroke this screen has.
  const board = useMemo(
    () => ({ dayOffset: props.dayOffset, store: props.storeParam }),
    [props.dayOffset, props.storeParam],
  )
  const boardStamp = { ...board, dayLabel: props.dayLabel, storeLabel: props.lensLabel }

  /** ⚖ Liam flag 41 — the day's own standing 仮押さえ, answered. `holdAnswer`
   *  lives in the session provider so an answer survives a day flip; the card's
   *  colour reads the 確定 half of it, the surface reads whether it is open. */
  const holdConfirmed = holdAnswer === 'confirmed'

  const [view, setView] = useState<'both' | 'staff' | 'beds'>('both')
  const [density, setDensity] = useState<'std' | 'compact'>('std')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [locked, setLocked] = useState<string[]>([])
  const [pop, setPop] = useState<'' | 'shelf' | 'help' | 'fields' | 'cal'>('')
  const [showTime, setShowTime] = useState(true)
  const [showTicket, setShowTicket] = useState(true)
  const [showSlotPrice, setShowSlotPrice] = useState(true)
  const [sellMode, setSellMode] = useState<'tint' | 'drag' | 'off'>('tint')
  const [guideMode, setGuideMode] = useState<'selected' | 'drag' | 'hidden'>('selected')
  const [selected, setSelected] = useState<string | null>(null)
  const [settled, setSettled] = useState<string[]>([])
  const [resolved, setResolved] = useState<string[]>([])
  const [proposalSent, setProposalSent] = useState(false)
  const [calMonth, setCalMonth] = useState(0)
  /** ⚖ Liam flag 47 (2026-08-21) — A REFUSAL HAS TO BE READABLE. Every message
   *  on this board dwelt for the same 3.2s, which is right for 「置きました」 —
   *  the operator can see the result and the sentence only confirms it — and
   *  wrong for a refusal, which is the ONLY record that a thing did not happen.
   *  Liam's own repro: 「it flashed too fast to read」. So a refusal carries its
   *  own dwell, and `n` re-arms the timer when the SAME refusal is earned twice
   *  in a row (pressing the same illegal slot again used to say nothing at all,
   *  because the state never changed). */
  const [toast, setToast] = useState<{ text: string; ms: number; n: number }>(EMPTY_TOAST)
  const [blockInfo, setBlockInfo] = useState<{ kind: string; who: string; whoLabel: string; time: string; note: string } | null>(null)
  const [seed, setSeed] = useState<{ staffId: string; start: number; nonce: number } | null>(null)

  // ── the interaction plane ────────────────────────────────────────────────
  // `moves`, `parked`, `pending` and `placing` are read from the session-edit
  // provider above; only what dies WITH the gesture is held here.
  const [live, setLive] = useState<LiveDrag | null>(null)
  /** ⚖ Liam 2026-08-20: the length of whatever is in flight, board card or shelf
   *  chip, and `null` the moment nothing is. It is the ONLY input to the
   *  length-matched window emphasis (`fitsDrag`), it is set once when a gesture
   *  crosses the move threshold rather than per frame, and every teardown path —
   *  release, cancel, blur, and both lost-pointer self-heals — clears it through
   *  `clearDrag` / `clearChipDrag`, so no gesture can leave the board emphasised. */
  const [dragLen, setDragLen] = useState<number | null>(null)
  /** ⚖ Liam flag 26 — 休憩/準備/記録/レジ/清掃 and every other non-booking box,
   *  where they have been dragged to. Keyed by `item.key`, because a block has
   *  no `caseId`: it is not a booking, it never enters the 仮押さえ gate, the
   *  shelf or the guard's conflict ledger, and canon keeps `bindBlockDrag` a
   *  separate pipeline from `bindDrag` for exactly that reason. */
  const [blockMoves, setBlockMoves] = useState<Moves>({})
  /** The block in flight, and its snapped landing — the block twin of `live`.
   *  It is NOT folded into the lanes any derivation reads: canon repaints the
   *  window layers on a block DROP (`renderPublicLayer()` at the end of
   *  `blockDrop`, :4165) and never during the gesture, so WO-2d's committed
   *  freeze holds for blocks too. */
  const [blockLive, setBlockLive] = useState<{ key: string; homeLane: string; targetLane: string; x: number; w: number; mode: DragMode } | null>(null)
  const [proxy, setProxy] = useState<DragProxy | null>(null)
  const [chipTarget, setChipTarget] = useState<string | null>(null)
  const [advice, setAdvice] = useState<GuardAdvice | null>(null)
  /** ⚖ Liam flag 39 — the BLOCK-PLACEMENT ADVISOR. A 記録/準備/レジ had no
   *  placement intelligence at all: the only thing that could refuse it was
   *  overlapping something real, so a block dropped in the middle of a free run
   *  could quietly destroy the last 新規90分 of the day and nothing said a word.
   *  Canon has no guard for blocks either — this is a surpass, not a carry.
   *
   *  ADVISE, NEVER REFUSE (⚖ Liam's v1 ruling): the manager may have a real
   *  reason, so the block LANDS and the board offers the better position as one
   *  click. `home` is what 元の位置 means for this drop. */
  const [blockAdvice, setBlockAdvice] = useState<{
    key: string
    title: string
    laneKey: string
    laneLabel: string
    dur: number
    cell: RailCell
    suggest: number
    home: Move | undefined
  } | null>(null)
  /** ⚖ Liam flag 34 — the 仮押さえ confirm has left the bottom of the page and
   *  hangs under the card it is answering for. `true` when that card is not on
   *  screen (scrolled away, another day, another store) and the same content
   *  becomes the fixed pill instead — which is also what retires the in-flow bar
   *  Liam had to scroll to find. */
  const [holdPinned, setHoldPinned] = useState(false)
  /** ⚖ 39 — the advisor's own half of the same fallback: no side of the block
   *  can hold the surface whole, so it pins to the viewport instead of sliding
   *  back over the box it is talking about. */
  const [blockAdvicePinned, setBlockAdvicePinned] = useState(false)
  /** ⚖ Liam flag 25 — 画面の説明. The step the tour is on, `-1` when it is
   *  closed. The STEPS themselves are never held in state: they are re-read from
   *  the DOM registry on every render of the overlay, which is what makes a
   *  section that appears or disappears (a popover, a strip behind a permission)
   *  change the tour without anyone maintaining a list. */
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragCtx | null>(null)
  const blockDragRef = useRef<BlockDragCtx | null>(null)
  /** The proxy's node and the transform it should be wearing. Kept OUT of React
   *  state on purpose: the value changes once per animation frame and React must
   *  never re-apply a stale one over it on an unrelated re-render. */
  const proxyRef = useRef<HTMLDivElement | null>(null)
  const proxyAt = useRef('')
  const createSeq = useRef(0)
  /** canon `suppressClickUntil` (:5640, :6811). A chip released over a track can
   *  land its click on that track, and an empty-track click means "create a
   *  booking here" — or, with 配置モード armed, "place it here". Canon calls this
   *  its last line of defence and it is: pointer capture is an assist, not a
   *  guarantee, and a drop that turns into a second booking is not recoverable
   *  by the operator. The window is canon's own 400ms, measured off the EVENTS' own
   *  timestamps rather than a clock call — same monotonic origin, and nothing
   *  in this component reads the wall clock during a render. */
  const suppressClickUntil = useRef(0)
  /** ⚖ BATCH-6 flag 43 — canon's `suppressClickSource` (:4643): the element the
   *  gesture was on, so the capture-phase interceptor below can tell the drag's
   *  own trailing click from an unrelated one and swallow only the first. */
  const suppressClickSource = useRef<Element | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const shelfRef = useRef<HTMLDivElement>(null)
  const fieldsPopRef = useRef<HTMLDivElement>(null)
  const fieldsBtnRef = useRef<HTMLButtonElement>(null)
  const advicePopRef = useRef<HTMLDivElement>(null)
  const blockAdvicePopRef = useRef<HTMLDivElement>(null)
  const holdPopRef = useRef<HTMLDivElement>(null)
  /** canon's `popOpenedAt` (:7074): a popup opened from a pointerup is followed
   *  by one synthetic click on the thing underneath, and without this window the
   *  popup would close itself the instant it appeared. */
  const adviceOpenedAt = useRef(0)
  const blockAdviceOpenedAt = useRef(0)
  const chipDragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean; laneKey: string | null; grab: { dx: number; dy: number; w: number; h: number } } | null>(null)

  // ── the store's price levers (L3) ────────────────────────────────────────
  const [hiInput, setHiInput] = useState(dialogs.pricing.hqMax)
  const [loInput, setLoInput] = useState(dialogs.pricing.base)
  const [framing, setFraming] = useState<'discount' | 'markup'>('discount')
  const [appliedPrice, setAppliedPrice] = useState({ hi: dialogs.pricing.hqMax, lo: dialogs.pricing.base })

  const recoveryRef = useRef<HTMLDialogElement>(null)
  const checkoutRef = useRef<HTMLDialogElement>(null)
  const reserveRef = useRef<HTMLDialogElement>(null)
  const createRef = useRef<HTMLDialogElement>(null)
  const storeFrontRef = useRef<HTMLDialogElement>(null)
  const terminalRef = useRef<HTMLDialogElement>(null)
  const blockRef = useRef<HTMLDialogElement>(null)
  const closingRef = useRef<HTMLDialogElement>(null)
  const listRef = useRef<HTMLDialogElement>(null)

  useShellClass('drawer-open', selected !== null)
  useShellClass('board-compact', density === 'compact')

  const STEP = stepPct(hours.count)
  /** ⚖ Liam flag 26 — the BLOCK lattice, the store's own dial. Canon keeps this
   *  a second constant beside STEP_PCT rather than a mode of it (:3543). */
  const BLOCK_STEP = blockStepPct(hours.count, props.guard.config.blockStepMin)

  // B5 予約を作成 — canon's rightmost topbar action. The button is the shell's,
  // the dialog is this screen's; the slot is where they meet.
  //
  // ⚖ Liam flag 33 — EVERY opening of this dialog goes through here, and every
  // one of them puts the consult popup down first. A native <dialog> renders in
  // the TOP LAYER: a popup left open under it is painted over, unreachable and
  // still alive, which is exactly the "two surfaces at once" Liam saw. One
  // function, so no future caller can open the modal and forget.
  const openCreateAt = useCallback((at: { staffId: string; start: number } | null) => {
    setAdvice(null)
    setSeed(at ? { ...at, nonce: Date.now() } : null)
    createRef.current?.showModal()
  }, [])
  const openCreate = useCallback(() => openCreateAt(null), [openCreateAt])
  useTopbarAction('予約を作成', openCreate)

  useEffect(() => {
    if (!toast.text) return
    const t = setTimeout(() => setToast(EMPTY_TOAST), toast.ms)
    return () => clearTimeout(t)
  }, [toast])

  // canon (:5772): a click outside the open popover closes it.
  useEffect(() => {
    if (!pop) return
    const onDoc = (e: MouseEvent) => {
      const wrapper = document.querySelector(`[data-pop="${pop}"]`)
      if (clickClosesPopover(wrapper, e.target)) setPop('')
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [pop])

  /** ⚖ Liam flag 33 — canon's DISMISSAL CONTRACT on the consult popup
   *  (:7082-7087), which the transplant left off entirely: the popup had no exit
   *  but its own two buttons, so a click anywhere else left it standing and the
   *  next surface painted straight over it.
   *
   *  Outside click closes it, behind canon's own 80ms window — a popup opened
   *  from a pointerup is followed by exactly one synthetic click on the thing
   *  underneath, and without the window it would dismiss itself on arrival.
   *  Canon reads `performance.now()`; both ends of this comparison are EVENT
   *  timestamps instead — the same monotonic origin, and this component reads no
   *  clock outside an event (the rule `suppressClickUntil` already follows). */
  useEffect(() => {
    if (!advice) return
    const onDoc = (e: MouseEvent) => {
      if (e.timeStamp - adviceOpenedAt.current < 80) return
      if (clickClosesPopover(advicePopRef.current, e.target)) setAdvice(null)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [advice])

  /** ⚖ Liam flag 39 — the block advisor obeys the SAME dismissal contract as the
   *  consult (flag 33): outside click closes it, behind canon's own 80ms window
   *  so the synthetic click that follows the drop's own pointerup cannot dismiss
   *  it on arrival. */
  useEffect(() => {
    if (!blockAdvice) return
    const onDoc = (e: MouseEvent) => {
      if (e.timeStamp - blockAdviceOpenedAt.current < 80) return
      if (clickClosesPopover(blockAdvicePopRef.current, e.target)) setBlockAdvice(null)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [blockAdvice])

  /** ⚖ Liam flag 39 — and the same PLACEMENT rule as the 仮押さえ popover: under
   *  the block it is talking about, never over it (`holdPopAnchor`), viewport-
   *  clamped on all four edges (`pinInViewport`, ⚖ 35), measured after the block
   *  has repainted at its landing rather than guessed from the drop event —
   *  the node is still drawn at its ORIGIN when the pointerup fires (batch-4's
   *  flag-33 finding). No side can hold it whole → the pill, exactly as the
   *  confirm surface falls back. */
  useLayoutEffect(() => {
    if (!blockAdvice) return
    const pin = () => {
      const el = blockAdvicePopRef.current
      if (!el) return
      const box = blockNode(boardRef.current, blockAdvice.key)?.getBoundingClientRect()
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const self = el.getBoundingClientRect()
      const at = box && anchorOnScreen(box, viewport) ? holdPopAnchor(box, self.width, self.height, viewport) : null
      if (!at) {
        setBlockAdvicePinned(true)
        el.style.left = ''
        el.style.top = ''
        return
      }
      setBlockAdvicePinned(false)
      el.style.left = `${at.left}px`
      el.style.top = `${at.top}px`
    }
    pin()
    window.addEventListener('resize', pin)
    return () => window.removeEventListener('resize', pin)
  }, [blockAdvice, blockAdvicePinned])

  /** ⚖ Liam flag 35 — the consult popup is pinned inside the viewport before it
   *  paints, through the SAME clamp the 仮押さえ popover uses. It used to sit at
   *  the raw pointer position behind a hard-coded `Math.min(x, 1600)`, so a
   *  placement near the right edge opened a popup that ran off the screen
   *  (Liam, 8/21). Measured then placed, canon's `placePopNear` (:7075) exactly:
   *  the size is only knowable after the content is in the DOM, which is why
   *  neither canon nor this writes a position in the markup. */
  useLayoutEffect(() => {
    if (!advice) return
    const pin = () => {
      const el = advicePopRef.current
      if (!el) return
      // The RECT, not offsetWidth: offsetWidth is rounded to an integer, and a
      // surface measured 0.33px narrower than it paints lands that far past the
      // margin when it is pinned to an edge.
      const size = el.getBoundingClientRect()
      const at = pinInViewport(
        { left: advice.anchor.x, top: advice.anchor.y },
        { width: size.width, height: size.height },
        { width: window.innerWidth, height: window.innerHeight },
      )
      el.style.left = `${at.left}px`
      el.style.top = `${at.top}px`
    }
    pin()
    window.addEventListener('resize', pin)
    return () => window.removeEventListener('resize', pin)
  }, [advice])

  // canon `positionFieldsPop` (:5782) + its resize listener (:5820). 表示設定
  // is viewport-pinned, not button-hung, so the whole panel is on screen with
  // nothing to scroll. Before paint, so it never flashes at the CSS seed.
  useLayoutEffect(() => {
    if (pop !== 'fields') return
    const place = () => {
      const el = fieldsPopRef.current
      const btn = fieldsBtnRef.current
      if (!el || !btn) return
      const { top, left } = fieldsPopAnchor(
        btn.getBoundingClientRect(),
        el.getBoundingClientRect().width,
        el.scrollHeight,
        { width: window.innerWidth, height: window.innerHeight },
      )
      el.style.top = `${Math.round(top)}px`
      el.style.left = `${Math.round(left)}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [pop])

  /** THE BOARD, twice. `boardLanes` is the truth every derivation reads — the
   *  dragged card is already on the lane it is heading for, which is what makes
   *  the guard and the drop target answer LIVE across lanes. `drawn` is
   *  what the DOM renders: canon never re-parents a card mid-drag (it moves the
   *  element horizontally and paints a ghost in the destination), and neither
   *  can we — re-parenting destroys the element the pointer stream is bound to
   *  and the drag dies on the first pixel of vertical travel. */
  const liveMoves = useMemo(
    () => (live?.staffLane ? { ...moves, [live.id]: { laneKey: live.staffLane, x: live.x, w: live.w } } : moves),
    [moves, live],
  )
  /** ⚖ BATCH-6 flag 45 — the bed side's half of the same in-flight board. A
   *  staff-side drag writes the room's CURRENT lane here with the live span,
   *  which is a no-op on membership and keeps the two drawings on one clock;
   *  a bed-side drag writes the room it is heading for. */
  const liveBedMoves = useMemo(
    () => (live?.bedLane ? { ...bedMoves, [live.id]: { laneKey: live.bedLane, x: live.x, w: live.w } } : bedMoves),
    [bedMoves, live],
  )
  /** Only the cards this session put on the BOARD currently on screen — the day
   *  (⚖ 22) and, ⚖ 46 forerunner, the store. A row scoped by day alone painted
   *  onto the other store's board wherever the two shared a lane key, which is
   *  every staff member who works at both. */
  const addedHere = useMemo(
    () => added.filter((a) => onShownBoard(a, board)),
    [added, board],
  )
  /** ⚖ Liam flag 26 — the server's board with this session's block moves on it.
   *  One pass, ahead of the booking passes, so both the live board and the
   *  committed board see the same blocks: a 休憩 that has been dragged is where
   *  it was dragged to for the guard, the sell layer and the next block's
   *  overlap check alike. */
  const placedLanes = useMemo(
    () => applyBlockMoves(props.lanes, blockMoves, hours),
    [props.lanes, blockMoves, hours],
  )
  const boardLanes = useMemo(
    () => applyMoves(placedLanes, liveMoves, parked, addedHere, hours, liveBedMoves),
    [placedLanes, liveMoves, parked, addedHere, hours, liveBedMoves],
  )
  /** The board WITHOUT the in-flight pointer — what the window layers price
   *  against. canon's `renderPublicLayer` (:5343) and `renderGapFillLayer`
   *  (:5235) run off the committed board and are not called again until the
   *  move commits: measured live, canon's `.cell-price` / `.cell-packed` /
   *  `.cell-gapfill` set is byte-identical idle → mid-drag → after the drop,
   *  and a drag's liveness is the CSS reveal (:594–598), which lifts and
   *  emphasises the boxes already derived. Feeding them `boardLanes` re-ran the
   *  bed ledger on every frame, so boxes on OTHER lanes appeared and vanished
   *  under a moving card and a ¥3,860（30分） could become ¥7,710 mid-gesture —
   *  measured 3 distinct layer states across 30 pointer frames against canon's
   *  1. `boardLanes` stays the truth for the guard and the drop target, which
   *  DO have to answer where the card is heading. */
  const committedLanes = useMemo(
    () => applyMoves(placedLanes, moves, parked, addedHere, hours, bedMoves),
    [placedLanes, moves, parked, addedHere, hours, bedMoves],
  )
  /** WHAT THE DOM DRAWS while a card is in flight: the board as it stands. The
   *  card he grabbed is under his cursor now (the proxy), so the original stays
   *  at its origin and dims — it is the "you took this from here" marker, and a
   *  card that both dims AND slides is two travelling things at once. */
  const drawnLanes = live || blockLive ? committedLanes : boardLanes
  /** ⚖ Liam 2026-08-20: the dashed outline is now the SNAPPED LANDING PREVIEW and
   *  is drawn for every live drag, same lane or not — with the card off travelling
   *  it is the only thing on the board saying where the release will actually put
   *  it. Canon only ever drew it on a lane change (:4519) because its card never
   *  left the lane. The lane HIGHLIGHT stays canon's: a foreign lane only. */
  // ⚖ Liam flag 26: a block in flight gets the same landing preview and the
  // same foreign-lane highlight — one gesture grammar for everything on the
  // board, so a 休憩 says where it will land exactly as a booking does.
  const landing = blockLive
    ? { laneKey: blockLive.targetLane, x: blockLive.x, w: blockLive.w }
    : live && !live.overShelf
      ? { laneKey: live.targetLane, x: live.x, w: live.w }
      : null
  const dropTarget = blockLive && blockLive.targetLane !== blockLive.homeLane
    ? { laneKey: blockLive.targetLane, x: blockLive.x, w: blockLive.w }
    : live && !live.overShelf && live.targetLane !== live.homeLane
      ? { laneKey: live.targetLane, x: live.x, w: live.w }
      : chipTarget
        ? { laneKey: chipTarget, x: 0, w: 0 }
        : null

  const price = clampPriceInputs(appliedPrice.hi, appliedPrice.lo, dialogs.pricing)
  const depth = Math.round((1 - price.lo / price.hi) * 100)
  const frame = useMemo(
    () => ({ hi: price.hi, lo: price.lo, hqMin: dialogs.pricing.hqMin, hqMax: dialogs.pricing.hqMax }),
    [price.hi, price.lo, dialogs.pricing.hqMin, dialogs.pricing.hqMax],
  )

  const sell = useMemo(
    () =>
      sellLayerFor(committedLanes, hours, {
        gridMin: props.sell.gridMin,
        nowMinute: props.sell.nowMinute,
        locked,
        showPrice: showSlotPrice,
        hi: price.hi,
        hqMin: dialogs.pricing.hqMin,
        depth,
      }),
    [committedLanes, hours, props.sell, locked, showSlotPrice, price.hi, dialogs.pricing.hqMin, depth],
  )

  /** スキマ枠 + 詰め込みセッション — canon renders them from the same board pass
   *  as the normal layer (renderPublicLayer → renderGapFillLayer :5402). */
  const gap = useMemo(
    () =>
      gapLayerFor(committedLanes, {
        gridMin: props.sell.gridMin,
        sessionMin: props.guard.standardSessionMin,
        gapFillMin: props.guard.gapFillMinMin,
        gapFillDiscountPct: props.guard.gapFillDiscountPct,
        minSellableMin: props.guard.minSellableMin,
        nowMinute: props.sell.nowMinute,
        locked,
        frame,
        depth,
        guard: props.guard.config,
      }),
    [committedLanes, props.sell, props.guard, locked, frame, depth],
  )

  /** The 配置ガイド. `guardOn` is the STORE's protection policy; `guideMode` is
   *  a personal display preference that can hide the painted rail and can never
   *  weaken the rule — canon states that separation in as many words. */
  const guardOn = props.guard.mode !== 'off'
  const rails = useMemo<GuardRail[]>(
    () =>
      guardOn
        ? guardRailsFor(boardLanes, {
            open: hours.open,
            close: hours.close,
            stepMin: 30,
            dur: props.guard.standardSessionMin,
            protectedDur: props.guard.protectedDurationMin,
            nowMinute: props.sell.nowMinute,
            locked,
            guard: props.guard.config,
            excludeId: live?.id ?? pending?.id ?? null,
          })
        : [],
    [guardOn, boardLanes, hours, props.guard, props.sell.nowMinute, locked, live?.id, pending?.id],
  )
  const railByLane = useMemo(() => new Map(rails.map((r) => [r.laneKey, r])), [rails])

  const openCards = props.cards.filter((c) => c.state === 'open' && !resolved.includes(c.id))
  const unresolved = openCards.length
  const settledCount = Number(ops.settled.replace(/\D/g, '')) + settled.length
  const awaitingCount = Math.max(Number(ops.awaiting.replace(/\D/g, '')) - settled.length, 0)

  const currentCase = selected ? (props.cases[selected] ?? null) : null

  function show(message: string, ms = TOAST_MS) {
    setToast((was) => ({ text: message, ms, n: was.n + 1 }))
  }

  /** ⚖ Liam flag 47 — THE LANE INVARIANT, IN ONE FUNCTION: *a refusal changes
   *  NOTHING*. Every path that declines a placement — a foreign store (⚖ 46), no
   *  free room, a locked shift, a release over nothing, a staged 仮押さえ still
   *  open — announces itself through here and through here alone, and leaves the
   *  chip, the 配置モード and the board exactly as it found them. Two things
   *  follow from having one door: the refusal always dwells long enough to be
   *  READ, and a reader of this file can find every refusal by grepping one
   *  name. A refusal that also mutated state would be a bug this name makes
   *  visible; a silent refusal (the placing click on a bed row, the chip
   *  released over nothing) was the same bug with no name at all. */
  function refuse(message: string) {
    show(message, REFUSAL_MS)
  }

  /** ⚖ 46 forerunner — `store` defaults to the board on screen and is overridden
   *  only by the hold bar's pin, which has to point at the pending's own board. */
  function dayHref(offset: number, store: string | null = props.storeParam) {
    const q = new URLSearchParams()
    if (store) q.set('store', store)
    if (offset !== 0) q.set('day', String(offset))
    const s = q.toString()
    return `/${props.locale}/business/today${s ? `?${s}` : ''}`
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
  }

  function toggleOn(was: string[], id?: string) {
    return id && !was.includes(id) ? [...was, id] : was
  }

  function settle() {
    if (!dialogs.checkout) return
    setSettled((was) => (was.includes(dialogs.checkout!.bookingId) ? was : [...was, dialogs.checkout!.bookingId]))
    setResolved((was) => toggleOn(was, props.cards.find((c) => c.kind === 'レジ')?.id))
    checkoutRef.current?.close()
    show(`${dialogs.checkout.title.replace(' 様の精算', '')}様の精算をこの画面の中だけで完了しました。再読み込みすると戻ります`)
  }

  function sendProposal() {
    setProposalSent(true)
    recoveryRef.current?.close()
    show('担当変更案をこの画面の中だけで送信済みにしました。再読み込みすると戻ります')
  }

  // ── the 仮押さえ gate ─────────────────────────────────────────────────────

  /** ONE guard question, asked in one shape. The consult popup (⚖ 31c) and the
   *  confirm surface's guard row (⚖ 31b) are the same verdict about the same
   *  board; building the engine's input twice is how the two would drift apart.
   *  The card's OWN length, not the rail's 60 minutes: the rail answers "could a
   *  standard session start here", a placement asks about the booking in hand. */
  /** ⚖ Liam flag 39 — `lanes` is the same question asked of a board the caller
   *  has already taken something OUT of. A booking in hand excludes itself by
   *  `caseId` (`excludeId`, canon's `guardPocketsForLane` :7196); a 予定ブロック
   *  has no caseId, so the block advisor hands in the board without it instead.
   *  Same engine, same input, one shape. */
  const verdictAt = useCallback(
    (laneKey: string, start: number, dur: number, excludeId: string | null, lanes: BoardLane[] = boardLanes): RailCell | null =>
      guardOn
        ? guardVerdictAt(lanes, laneKey, start, {
            open: hours.open,
            close: hours.close,
            stepMin: 30,
            dur,
            protectedDur: props.guard.protectedDurationMin,
            nowMinute: props.sell.nowMinute,
            locked,
            guard: props.guard.config,
            excludeId,
          })
        : null,
    [guardOn, boardLanes, hours, props.guard, props.sell.nowMinute, locked],
  )

  /** canon `computeChecks` fed from the board as it currently stands. The sell
   *  layer's own windows join the pool as DERIVED inventory, exactly as canon's
   *  `isDerivedInventory` treats `.public` cells — they yield to a real
   *  placement and are recomputed at confirm rather than blocking it. */
  const checksFor = useCallback(
    (id: string, at: { x: number; w: number }): Check[] => {
      const spans: CheckSpan[] = []
      const onLanes = boardLanes.filter((l) => l.items.some((i) => i.caseId === id))
      for (const lane of onLanes) {
        for (const i of lane.items) {
          spans.push({ id: i.caseId ?? i.key, x: i.x, w: i.w, title: i.title, derived: i.kind === 'cleanup', parked: false })
        }
        for (const c of sell.cells) {
          if ((lane.group === 'staff' ? c.laneKey : c.resourceKey) !== lane.key) continue
          const cell = place(c.h, c.h + 60, hours)
          spans.push({ id: `sell-${c.h}-${lane.key}`, x: cell.x, w: cell.w, title: '販売可能枠', derived: true, parked: false })
        }
      }
      const staffLane = boardLanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === id))
      return computeChecks(at, {
        spans,
        bookingId: id,
        staffName: staffLane?.label ?? '—',
        staffUntil: staffLane?.untilLabel ?? null,
        laneLocked: staffLane != null && locked.includes(staffLane.key),
        minutesOf: (x) => minuteOf(x, hours),
      })
    },
    [boardLanes, sell.cells, hours, locked],
  )

  /** canon `syncPendingUI` (:3673): while the board is showing a DIFFERENT day
   *  from the one the 仮押さえ is staged on, the bar keeps standing — it is the
   *  thing that has to be resolved before anything else — but it stops
   *  answering. Its checks are computed from the board on screen, and that board
   *  does not contain the card; canon carries every day in one DOM and so never
   *  had to say this out loud. The pin says where the card is and takes the
   *  operator back to it.
   *
   *  ⚖ 46 forerunner: a different STORE is the same situation and was silently
   *  worse — the day matched, so the bar went on computing, and it answered for
   *  the other store's board with this store's cards. One predicate now, so the
   *  two can never drift apart. */
  const pendingOffBoard = pending != null && !onShownBoard(pending, board)
  const pendingChecks = pending && !pendingOffBoard && moves[pending.id] ? checksFor(pending.id, moves[pending.id]) : []
  const pendingConfirm = pendingOffBoard
    ? { enabled: false, label: 'この内容で確定' }
    : confirmCaption(pendingChecks)

  /** ⚖ Liam flag 31b — WHERE THE GUARD'S MOVE-ASSESSMENT GOES. A move no longer
   *  interrupts the operator with a dialog (31a), but the assessment it carried
   *  is real: it joins the checks the confirm surface already shows, as one more
   *  row. It is INFORMATION — `pendingConfirm` above is untouched, so what can
   *  and cannot be confirmed is still `computeChecks`' answer alone and a
   *  degraded landing stays confirmable, exactly as canon's own ackAllowed lets
   *  it be. Neither canon's hold bar nor the built one showed this at all. */
  const pendingGuardRow = useMemo(() => {
    // ⚖ 46 forerunner: `pendingOffBoard`, not a day-only test — `verdictAt` reads
    // the board on screen, so a 仮押さえ staged in another STORE would have its
    // row computed from this store's cards. Same predicate as the checks above.
    if (!pending || pendingOffBoard) return null
    const at = moves[pending.id]
    if (!at) return null
    const start = minuteOf(at.x, hours)
    return guardCheckRow(verdictAt(at.laneKey, start, minuteOf(at.x + at.w, hours) - start, pending.id))
  }, [pending, pendingOffBoard, moves, hours, verdictAt])

  /** ⚖ Liam flag 34 — THE CONFIRM COMES TO THE CARD, one surface answering for
   *  whichever 仮押さえ is live: this session's staged change, or the day's own
   *  from the incident. Canon put both on a full-width bar at the bottom of the
   *  page; ours was IN FLOW there (today.css :784), so on a tall board the
   *  operator had to scroll away from the card to find the button that answers
   *  for it — Liam's complaint, and structural rather than cosmetic.
   *
   *  ⚖ Liam flag 41 (2026-08-21) — AND IT EXISTS ONLY WHILE ITS DECISION IS
   *  OPEN. The standing 仮押さえ below had no answered state at all: its surface
   *  hung off the PROP being there, so 確定 turned it 確定済み and left it
   *  standing, and every other change on the board brought it back into view.
   *  The old full-width bar was always on screen by design and hid that; a
   *  floating popover cannot. Either answer now closes it for the session
   *  (`holdAnswer`, in the session provider so a day flip cannot reopen it),
   *  and the card's own state colour carries the result — which it already did.
   *  A session-staged 仮押さえ was never stuck: `pending` clears on both its
   *  answers. What Liam saw was this surface underneath, taking its place. */
  const holdPop: HoldPop | null = pending
    ? {
        anchorId: pending.id,
        status: '仮押さえ',
        tone: 'waiting',
        // ⚖ 46 forerunner: blank on ANOTHER STORE's board too — `holdSummary`
        // reads `boardLanes`, which is this store's.
        summary: pendingOffBoard ? '' : holdSummary(boardLanes, pending.id, moves[pending.id], hours),
        checks: pendingChecks.map((c) => ({ label: c.label, tone: c.ok ? '' : 'bad' })),
        guardRow: pendingGuardRow,
        confirm: { label: pendingConfirm.label, enabled: pendingConfirm.enabled, run: confirmPending },
        revert: { enabled: true, run: revertPending },
      }
    : props.hold && holdAnswer === null
      ? {
          // The day's own standing 仮押さえ (the incident's) — the pill, always.
          anchorId: null,
          status: '仮押さえ',
          tone: 'waiting',
          summary: props.hold.summary,
          checks: props.hold.checks.map((label) => ({ label, tone: '' })),
          guardRow: null,
          confirm: {
            label: 'この内容で確定',
            enabled: true,
            run: () => {
              setHoldAnswer('confirmed')
              setResolved((was) => toggleOn(was, props.cards.find((c) => c.kind === '担当変更')?.id))
              show('仮押さえをこの画面の中だけで確定しました。再読み込みすると戻ります')
            },
          },
          // ⚖ 41 — the OTHER answer, not an undo of the first one. It used to be
          // enabled only after 確定, because with no dismissal the only thing it
          // could mean was "take that back"; now the question is open when the
          // surface is up, so 元に戻す declines it and closes it just the same.
          revert: { enabled: true, run: () => { setHoldAnswer('reverted'); show('仮押さえのままにしました') } },
        }
      : null

  /** ⚖ Liam flag 34 — where that surface goes, measured rather than guessed.
   *
   *  Under the card when the card is on screen (⚖ flag 35 clamps it inside the
   *  viewport on all four edges, through the same helper the consult popup uses);
   *  the fixed pill at the bottom of the VIEWPORT when it is not — scrolled away,
   *  another day, another store. The pill is always visible with nothing to
   *  scroll to, which is what retires the in-flow bar for good.
   *
   *  COARSE ON PURPOSE (packet's rule, and WO-2d's): re-anchoring is debounced to
   *  the end of a scroll, never per frame. A popover that chased the board at
   *  60fps would be the jank the drag path was rebuilt to remove. */
  // The ID alone, never the object: `holdPop` is rebuilt on every render, and an
  // effect keyed on it would re-measure the DOM on every frame of a drag.
  const holdAnchorId = holdPop?.anchorId ?? null
  /** ⚖ Liam flag 48 — WHICH 60分配置 chip the confirm should try not to sit on:
   *  the one for the START THE CARD LANDED ON, in the lane it landed in. The
   *  rail draws a cell every 30 minutes, so an off-lattice landing (canon's dual
   *  lattice can put a card on 14:05) belongs to the cell it starts inside. Read
   *  as a selector rather than a rect, because the rect has to be measured in
   *  the same frame as the popover's own. */
  const holdRailSel = useMemo(() => {
    // ⚖ 46 forerunner: `pendingOffBoard`, not batch-7's day-only test — this
    // builds a selector into the board ON SCREEN, so a 仮押さえ staged in another
    // STORE would aim ⚖ 48's avoid-rect at this store's rail cell.
    if (!pending || pendingOffBoard) return null
    const at = moves[pending.id]
    if (!at) return null
    const start = Math.floor(minuteOf(at.x, hours) / 30) * 30
    return `.guard-placement-rail[data-lane="${at.laneKey}"] .guard-rail-cell[data-start="${start}"]`
  }, [pending, pendingOffBoard, moves, hours])
  useLayoutEffect(() => {
    const anchorId = holdAnchorId
    const pin = () => {
      const el = holdPopRef.current
      if (!el) return
      const card = anchorId ? cardNodes(boardRef.current, anchorId)[0] : null
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const box = card?.getBoundingClientRect()
      const self = el.getBoundingClientRect()
      // ⚖ flag 48 — the landing's own rail chip, as a box to prefer to clear.
      // `null` whenever it is not on screen (the strip is hidden by the 表示設定
      // guide mode, the lane is collapsed, jsdom): the preference simply has
      // nothing to say then, and the laws below decide alone.
      const railBox = holdRailSel
        ? (boardRef.current?.querySelector(holdRailSel)?.getBoundingClientRect() ?? null)
        : null
      // ANCHOR NOT IN THE DOM → the pill, whatever unmounted it. `cardNodes`
      // returns nothing, so `box` is undefined and this falls to `!at` below by
      // the same road as an off-screen card. The rule is deliberately about the
      // NODE, not about any one reason it went away.
      //
      // Off screen, or no side of the card can hold the whole surface without
      // covering it (⚖ Liam 8/21: he has to SEE what he moved) → the pill.
      const at = box && anchorOnScreen(box, viewport) ? holdPopAnchor(box, self.width, self.height, viewport, 8, 8, railBox) : null
      if (!at) {
        setHoldPinned(true)
        el.style.left = ''
        el.style.top = ''
        return
      }
      setHoldPinned(false)
      el.style.left = `${at.left}px`
      el.style.top = `${at.top}px`
    }
    pin()
    let t: ReturnType<typeof setTimeout> | undefined
    const coarse = () => { clearTimeout(t); t = setTimeout(pin, 120) }
    // Capture, so a scroll of the board's own scroller is heard too.
    window.addEventListener('scroll', coarse, true)
    window.addEventListener('resize', coarse)
    return () => {
      clearTimeout(t)
      window.removeEventListener('scroll', coarse, true)
      window.removeEventListener('resize', coarse)
    }
    // Greptile #738 P1 — the rule above only helps if this effect RE-RUNS when
    // the anchor leaves the DOM. Exactly two STATES unmount a card: `collapsed`
    // (the group folded away) and `view` (the staff/beds segmented control,
    // which gates the lane and the whole group wrapper) — both are `renderLane`
    // early returns, greppable by name; line numbers in THIS file are omitted on
    // purpose, they go stale on every transplant slice.
    // Neither was here, so collapsing the group holding a staged 仮押さえ left the
    // popover floating at the coordinates of a card that no longer existed. Both
    // are listed now, so the pill engages on either, and expanding re-anchors by
    // the same road.
    // ponytail: enumerated because `renderLane`'s gates are enumerable and this
    // suite cannot render. A board-level ResizeObserver feeding `coarse` would
    // cover unmount paths generically — take it if a third gate ever appears.
    //
    // UNION at cycle 7: batch-7 adds `holdRailSel` (⚖ 48's avoid-rect reads it
    // inside `pin`), and predates the two unmount gates above. All four belong —
    // dropping either half re-opens the bug the other half was written for.
  }, [holdAnchorId, holdPinned, collapsed, view, holdRailSel, moves, props.dayOffset])

  /** ⚖ BATCH-6 flag 45 — ONE SIDE RETARGETS, BOTH RE-TIME (canon `stageChange`
   *  :4648-4674). `at` is the landing as `sidesAt` resolved it: the grabbed
   *  side's target, and the other side's current lane carried through unchanged.
   *  Both records take the SAME span, which is what keeps the person and the
   *  room on one clock — canon's `els.forEach(evSet)` said the same thing.
   *
   *  `from` is the two-sided origin, and it is what 元に戻す restores. */
  function stage(id: string, at: { staffLane: string | null; bedLane: string | null }, span: { x: number; w: number }, from: PairLanes) {
    const { staffLane, bedLane } = at
    if (staffLane) setMoves((was) => ({ ...was, [id]: { laneKey: staffLane, ...span } }))
    if (bedLane) setBedMoves((was) => ({ ...was, [id]: { laneKey: bedLane, ...span } }))
    // ⚖ 46 forerunner kept under batch-6's two-sided rewrite: the stamp is
    // `boardStamp`, not the day pair batch-6 was written against — it predates
    // the store scoping, and `PendingChange` now REQUIRES store + storeLabel.
    // Batch-7's full ⚖ 46 supersedes this stamp when it replays.
    setPending((was) =>
      was && was.id === id
        ? was
        : { id, origin: from.staff ?? { laneKey: '', x: 0, w: 0 }, bedOrigin: from.bed ?? undefined, ...boardStamp },
    )
    setSelected(null)
  }

  /** ⚖ BATCH-6 flag 45 — put the pair back where a snapshot says it stood, BOTH
   *  sides, whichever one was dragged. Every abandoned landing goes through here
   *  — the shelf drop's write-back, the two refusals, the no-op release and the
   *  cancel — because a restore that knows only the staff lane is the same
   *  one-sided write that lost the card in the first place. */
  function restoreSides(id: string, home: PairLanes) {
    if (home.staff) setMoves((was) => ({ ...was, [id]: home.staff! }))
    setBedMoves((was) => {
      if (home.bed) return { ...was, [id]: home.bed }
      if (!(id in was)) return was
      const next = { ...was }
      delete next[id]
      return next
    })
  }

  function revertPending() {
    if (!pending) return
    const { id, origin, bedOrigin } = pending
    // canon's `snap: [{ el, remove: true }]` (:6084): a placement's 元に戻す takes
    // the card back OFF the day it was put on. A shelf placement goes back to the
    // shelf it came from; anything else just returns to its own span.
    const placed = added.find((a) => a.item.caseId === id)
    if (placed) {
      setAdded((was) => was.filter((a) => a.item.caseId !== id))
      if (placed.fromChip) {
        const chip = placed.fromChip
        setParkChips((was) => (was.some((c) => c.id === id) ? was : [...was, chip]))
      }
    }
    setMoves((was) => {
      const next = { ...was }
      if (origin.laneKey === '' ) delete next[id]
      else next[id] = origin
      return next
    })
    // ⚖ BATCH-6 flag 45 — and the room comes back too. Without this, 元に戻す on
    // a bed-side move put the person back and left the booking in the room it
    // was dragged to, which is the half-undo the two-sided snapshot exists to
    // stop. No bed origin (a creation, or a booking with no bed row) = no entry.
    setBedMoves((was) => {
      const next = { ...was }
      if (bedOrigin) next[id] = bedOrigin
      else delete next[id]
      return next
    })
    setPending(null)
    show('変更を元に戻しました')
  }

  function confirmPending() {
    if (!pending) return
    // canon R11-7 (:5461): the checks are re-run at the moment of confirm, so a
    // lane locked after staging cannot be confirmed through.
    const at = moves[pending.id]
    // ⚖ 47 `refuse()` (batch-7's one door) with `pendingOffBoard` (main's store
    // scoping, which batch-7 predates): batch-7 changed HOW a refusal speaks,
    // not WHAT counts as off-board.
    if (pendingOffBoard || !at || !confirmCaption(checksFor(pending.id, at)).enabled) {
      refuse('状況が変わったため、この内容では確定できません')
      return
    }
    setPending(null)
    // ⚖ 41 — a staged change confirmed IS the incident's 担当変更 answered, so
    // the standing 仮押さえ's own surface closes with it rather than stepping
    // back into the space this one just left.
    setHoldAnswer('confirmed')
    setResolved((was) => toggleOn(was, props.cards.find((c) => c.kind === '担当変更')?.id))
    show('この画面の中だけで確定しました。再読み込みすると戻ります')
  }

  // canon (:6941-6947): Escape puts down whatever is in the operator's hand,
  // ONE surface per press, innermost first. Armed 配置モード has no other
  // keyboard exit, and a mode you cannot leave without hunting for a × is a trap
  // on a board this dense.
  //
  // ⚖ Liam flag 34 — the chain's LAST branch is canon's own R11-6 (:6946):
  // with nothing else open, Escape is 元に戻す. Discarding is always safe and
  // 確定 never happens implicitly, which is why canon gives the key to the
  // revert and not to the commit. A live drag holds the key (canon's `!dragCtx`).
  useEffect(() => {
    if (!placing && !advice && !blockAdvice && !pop && !pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return
      // ⚖ 39 — innermost first, and Escape is そのまま置く: the block has already
      // landed and nothing is staged, so dismissing the advice leaves the board
      // exactly as the operator dropped it. 元の位置に戻す is a deliberate press.
      if (blockAdvice) { setBlockAdvice(null); return }
      if (advice) { setAdvice(null); return }
      if (pop) { setPop(''); return }
      if (placing) { setPlacing(null); return }
      if (pending && !dragRef.current) revertPending()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [placing, advice, blockAdvice, pop, pending, revertPending])

  // ── card drag ────────────────────────────────────────────────────────────

  /** ⚖ BATCH-6 flag 43 — CANON'S CLICK WINDOW, OPENED FROM ONE PLACE.
   *
   *  A drag-release fires a synthetic click on whatever is under the pointer,
   *  and on this board an empty-track click means 新規予約を作成 — a phantom
   *  booking the operator cannot undo by hand. Canon opens the window on EVERY
   *  ending a gesture can have: `finishNormalBookingDrag` (:4563), the forced
   *  teardowns `forceDragCancel` (:4535-4546) and `forceBlockCancel`
   *  (:4015-4028, whose own comment names this 「Liam bug #4」), `blockDrop`
   *  (:4139-4140) and the chip's moved-only release (:5640). Batch-4 carried the
   *  first of those and none of the rest, so a drag that died on a pointercancel,
   *  on the lost-pointerup self-heal or on a window blur still opened the dialog.
   *
   *  `at` is the ENDING EVENT'S own timestamp — the same monotonic origin the
   *  click will carry, and this component reads no clock outside an event.
   *  `source` is canon's `suppressClickSource`, read by the capture interceptor. */
  function openClickWindow(at: number, source: Element | null) {
    suppressClickUntil.current = at + 400
    suppressClickSource.current = source
  }

  /** ⚖ BATCH-6 flag 43 — CANON'S SECOND NET (:4633-4645), carried whole.
   *
   *  The window above is a flag every click handler has to remember to read. The
   *  interceptor is a document-level CAPTURE-phase listener, so it runs before
   *  any element's own handler and swallows the release's trailing click outright
   *  — canon's own comment says why it is not redundant: when a drag's release
   *  lands somewhere other than the element the pointer was captured on, the old
   *  single-net implementation had already consumed the window by the time the
   *  slot handler read it. It consumes only its OWN click (inside the gesture's
   *  source) and lets everything else ride the 400ms timeout, which is what stops
   *  it from eating an unrelated one.
   *
   *  Plain DOM, no renderer: react-dom is off Business territory's allowlist and
   *  a capture-phase document listener has no React equivalent that runs this
   *  early. Mounted once; the return takes it. */
  useEffect(() => {
    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClickUntil.current) return
      const within = e.timeStamp < suppressClickUntil.current
      const source = suppressClickSource.current
      const fromDragged = source != null && e.target instanceof Node && source.contains(e.target)
      if (!within || fromDragged) {
        suppressClickUntil.current = 0
        suppressClickSource.current = null
      }
      if (within && fromDragged) {
        e.stopPropagation()
        e.preventDefault()
      }
    }
    document.addEventListener('click', onClickCapture, true)
    return () => document.removeEventListener('click', onClickCapture, true)
  }, [])

  /** THE POINTER STREAM LIVES ON THE WINDOW, not on the card.
   *
   *  It used to ride the card's own JSX handlers with `setPointerCapture`, and
   *  that is what made every vertical drag die: the first move into another
   *  lane rewrote `moves[id].laneKey`, React re-parented the card into that
   *  lane's track, and re-parenting DESTROYS the node the capture was bound to.
   *  Chrome fired `lostpointercapture`, the rest of the stream went to whatever
   *  was under the cursor, `pointerup` never reached the card — so nothing was
   *  ever staged, the card was stranded in the first lane it passed through,
   *  and `dragRef` / `.dragging` / `.drop-target` were left set for the life of
   *  the page. Reproduced in a real browser, 2026-08-20 (WO-2c Phase 0).
   *
   *  Two changes make it canon's drag again. The card no longer moves lanes
   *  until the release (canon's `dragMove` only ever calls `evSet` on the card
   *  it started with), and the listeners hang off `window`, so no re-render,
   *  re-order or re-parent anywhere on the board can interrupt a drag. */
  function beginDrag(ctx: Omit<DragCtx, 'detach' | 'pending' | 'frame'>) {
    const onMove = (e: PointerEvent) => {
      const c = dragRef.current
      if (!c || e.pointerId !== c.pointerId) return
      e.preventDefault()
      // canon's self-heal (:4466): a move with no button down means the release
      // was lost, and the card would otherwise stay stuck to the cursor.
      if (e.buttons === 0) { cancelDrag(e); return }
      // One board update per animation frame. Chrome delivers pointer moves far
      // faster than it paints, and a derive-and-paint per raw event is the jank
      // Liam felt as "not snappy" — the newest position wins, the rest are free.
      c.pending = { clientX: e.clientX, clientY: e.clientY }
      if (c.frame != null) return
      c.frame = requestAnimationFrame(() => { c.frame = null; applyDragFrame() })
    }
    const onUp = (e: PointerEvent) => {
      const c = dragRef.current
      if (!c || e.pointerId !== c.pointerId) return
      finishDrag(e.clientX, e.clientY, e.timeStamp)
    }
    const onCancel = (e: PointerEvent) => {
      const c = dragRef.current
      if (!c || e.pointerId !== c.pointerId) return
      cancelDrag(e)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', cancelDrag)
    dragRef.current = {
      ...ctx,
      pending: null,
      frame: null,
      detach: () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('blur', cancelDrag)
      },
    }
  }

  /** The proxy's whole motion path: one string, written straight to the node.
   *  Held in a ref as well, so the ref callback can dress the element the frame
   *  it mounts and it never appears at the top-left corner first. */
  function moveProxy(clientX: number, clientY: number, grab: { dx: number; dy: number }) {
    proxyAt.current = proxyTransform(clientX, clientY, grab)
    if (proxyRef.current) proxyRef.current.style.transform = proxyAt.current
  }

  function applyDragFrame() {
    const ctx = dragRef.current
    if (!ctx || !ctx.pending) return
    const { clientX, clientY } = ctx.pending
    ctx.pending = null
    const dx = clientX - ctx.startX
    const dy = clientY - ctx.startY
    if (!ctx.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    const span = nextSpan(ctx.origin, ctx.track, dx, STEP)
    // ⚖ Liam flag 29 — ONE call decides the whole frame. By the time it returns,
    // a resize has already been painted onto the card where it stands; `true`
    // means the booking is in the operator's hand, and everything below this
    // line — the proxy, the length emphasis, the shelf, the lane hunt — is the
    // hand's business and no part of a stretch.
    const inHand = stretchOrCarry(ctx.nodes, ctx.origin.mode, span)
    if (!ctx.moved) {
      ctx.moved = true
      if (inHand) {
        // The booking's OWN length, read off the committed card — not off the
        // span in flight, which a resize is changing under the pointer.
        setDragLen(ctx.item.endMin - ctx.item.startMin)
        // The proxy's CONTENT is set once, here. Everything after this is a
        // transform written straight to the node — React never sees the motion.
        setProxy({ kind: 'card', item: ctx.item, state: ctx.item.state ?? '', w: ctx.grab.w, h: ctx.grab.h })
      }
    }
    if (inHand) {
      moveProxy(clientX, clientY, ctx.grab)
      ctx.overShelf = isOverShelf(shelfRef.current, clientY)
      const laneKey = laneKeyAtY(boardRef.current, ctx.group, clientY)
      if (laneKey) ctx.targetLane = laneKey
    } else {
      liveTimeLabel(ctx.nodes, `${hhmm(minuteOf(span.x, hours))}〜${hhmm(minuteOf(span.x + span.w, hours))}`)
    }
    setLive({
      id: ctx.id,
      homeLane: ctx.homeLane,
      targetLane: ctx.targetLane,
      // ⚖ BATCH-6 flag 45 — the grabbed side goes where the pointer is, the
      // other stays where it stands. One call, so the live board and the
      // landing can never answer that question differently.
      ...sidesAt(ctx.home, ctx.group, ctx.targetLane),
      ...span,
      overShelf: ctx.overShelf,
      mode: ctx.origin.mode,
    })
  }

  function onCardPointerDown(e: React.PointerEvent<HTMLButtonElement>, item: BoardItem, lane: BoardLane) {
    if (e.button !== 0 || dragRef.current || !item.caseId) return
    if (pending && pending.id !== item.caseId) {
      refuse('仮押さえ中の変更を確定するか、元に戻してから操作してください')
      return
    }
    const track = e.currentTarget.closest('.track')
    if (!track) return
    const mode = dragModeAt(e.currentTarget, e.clientX)
    const card = e.currentTarget.getBoundingClientRect()
    beginDrag({
      id: item.caseId,
      pointerId: e.pointerId,
      origin: dragOrigin(item.x, item.w, mode, STEP),
      startX: e.clientX,
      startY: e.clientY,
      nodes: cardNodes(boardRef.current, item.caseId),
      grab: { dx: e.clientX - card.left, dy: e.clientY - card.top, w: card.width, h: card.height },
      group: lane.group,
      homeLane: lane.key,
      targetLane: lane.key,
      // ⚖ BATCH-6 flag 45 — canon's per-element snap, taken HERE, before a
      // pixel of travel: both lanes as they actually stand, at the span the card
      // actually has. Nothing else in the gesture can lose a side after this.
      home: pairLanesOf(boardLanes, item.caseId, { x: item.x, w: item.w }),
      track,
      moved: false,
      overShelf: false,
      item,
      lane,
    })
    e.preventDefault()
  }

  function finishDrag(clientX: number, clientY: number, upAt: number) {
    const ctx = dragRef.current
    if (!ctx) return
    const { item, lane } = ctx
    // ⚖ BATCH-6 flag 45 — the origin is the PAIR's, snapped at pointerdown. It
    // used to be `{ laneKey: ctx.homeLane, … }`, which for a card grabbed by its
    // bed row was a bed key in the staff record: the person's card was evicted
    // from every lane and the revert wrote the same key back.
    const from = ctx.home
    if (!ctx.moved) {
      // A press that never travelled is a selection, not a drag.
      clearDrag()
      setSelected(item.caseId)
      return
    }
    // ⚖ Liam flag 33, ROOT CAUSE — canon `finishNormalBookingDrag` (:4563) opens
    // its click window HERE, before any branch, and the transplant carried that
    // line into the shelf-chip path only. A card drag leaves the card at its
    // ORIGIN until React repaints, so the release lands on empty TRACK: the
    // browser's synthetic click then reached the track's own handler and the
    // drop opened 新規予約を作成 on top of everything else. That is the third
    // surface in Liam's screenshot, and it was one missing line. Every branch
    // below is covered because the window opens above all of them (canon's own
    // order), including the two refusals that put the card back.
    // ⚖ BATCH-6 flag 43 — through the one helper now, because the window is only
    // half of canon's defence: `suppressClickSource` is what the capture-phase
    // interceptor reads, and without it the second net has nothing to match on.
    openClickWindow(upAt, ctx.nodes[0] ?? null)
    // canon (:4567): the release position is authoritative — recompute once more
    // rather than trusting the last move Chrome delivered.
    const span = nextSpan(ctx.origin, ctx.track, clientX - ctx.startX, STEP)
    if (ctx.origin.mode === 'move' && isOverShelf(shelfRef.current, clientY)) {
      clearDrag()
      restoreSides(ctx.id, from)
      // The chip's `home` is the STAFF side: its × writes it straight back into
      // `moves`, and a bed key there is the same collapse in the shelf's clothes.
      park(ctx.id, item, from.staff ?? { laneKey: ctx.homeLane, x: ctx.origin.x, w: ctx.origin.w })
      return
    }
    let targetLane = ctx.targetLane
    if (ctx.origin.mode === 'move') {
      const laneKey = laneKeyAtY(boardRef.current, ctx.group, clientY)
      if (!laneKey) {
        clearDrag()
        restoreSides(ctx.id, from)
        refuse('予約を置く行の中で離してください')
        return
      }
      targetLane = laneKey
    } else {
      targetLane = lane.key
    }
    const laneChanged = ctx.origin.mode === 'move' && targetLane !== ctx.homeLane
    clearDrag()
    if (span.x === ctx.origin.x && span.w === ctx.origin.w && !laneChanged) {
      restoreSides(ctx.id, from)
      return
    }
    // ⚖ Liam flag 31a — A MOVE NEVER OPENS THE CONSULT. It used to call
    // `askGuard` here, and that was the transplant's own invention: canon's
    // 配置の相談 fires ONLY from a teaching card its own copy calls
    // 「このページだけのサンプル」 (guard-demo :1823), and canon's real drop
    // (`finishNormalBookingDrag` :4559-4626) shows no dialog whatsoever. What the
    // popup knew is not lost — it is a row on the confirm surface now (31b).
    // ⚖ BATCH-6 flag 45 — `sidesAt` decides which half of the pair the landing
    // belongs to; the origin stays the FIRST gesture's when one is already
    // pending, both sides of it, so 元に戻す is still an undo of the whole change.
    stage(
      ctx.id,
      sidesAt(ctx.home, ctx.group, targetLane),
      span,
      pending?.id === ctx.id ? { staff: pending.origin, bed: pending.bedOrigin ?? null } : from,
    )
  }

  /** ⚖ BATCH-6 flag 43 — canon `forceDragCancel` (:4535-4546), which is the
   *  revert AND the click window: pointercancel, the lost-pointerup self-heal and
   *  the blur net all end a real gesture, and the release that gets lost with them
   *  still lands its click on the empty track underneath. The event is required
   *  rather than optional so no caller can drop the timestamp and reach for a
   *  clock instead. (⚖ 45: the revert is now two-sided.) */
  function cancelDrag(e: { timeStamp: number }) {
    const ctx = dragRef.current
    if (!ctx) return
    restoreSides(ctx.id, ctx.home)
    openClickWindow(e.timeStamp, ctx.nodes[0] ?? null)
    clearDrag()
  }

  function clearDrag() {
    const ctx = dragRef.current
    if (ctx) {
      if (ctx.frame != null) cancelAnimationFrame(ctx.frame)
      // ⚖ Liam flag 29 — the node goes back to React wearing exactly what React
      // last wrote on it. A release that stages a new span is repainted by the
      // re-render; a release that changes nothing gets no re-render at all, and
      // without this the card would simply stay stretched. (canon does the same
      // on its cancel path: `evSet(el, ctx.orig.x, ctx.orig.w)`, :4142.)
      stretchOrCarry(ctx.nodes, ctx.origin.mode, ctx.origin)
      liveTimeLabel(ctx.nodes, ctx.item.time)
      ctx.detach()
    }
    dragRef.current = null
    setLive(null)
    setDragLen(null)
    setProxy(null)
  }

  // The listeners outlive a render, so an unmount mid-drag has to take them.
  useEffect(() => () => { dragRef.current?.detach() }, [])

  // ── ⚖ Liam flag 25 — 画面の説明 (the guided tour) ─────────────────────────

  /** canon's spotlight engine (:3335–3440). Two things make it worth carrying
   *  whole rather than writing a steps array:
   *
   *  THE REGISTRY. A section joins the tour by declaring `data-guide-title` +
   *  `data-guide` on itself. There is no list to maintain, so a section can
   *  never render without being explained, and one that is hidden — a popover,
   *  the 自分の1日 header a manager's board does not show, the 守るもの band on a
   *  store with the guard off — drops out of the walk and out of the N/M count
   *  by itself. That is the adaptive property Liam built in and asked for back.
   *
   *  POINT-TO-ASK. The dim layer is a click surface: clicking any registered
   *  region jumps to its explanation, and nested regions resolve smallest-first
   *  so the board never swallows its own group headings.
   *
   *  ⚖ LANE RULE (Liam, flag 25): every new section in any future round
   *  registers its own pair. Absence fails the round's gate. */
  const tourRectsRef = useRef<SpotRect[]>([])
  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(document)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    // canon (:3350): a step off screen is scrolled to before it is measured,
    // or the spotlight would cut a hole in empty space.
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    // BOTH writes are identity-guarded, and `tourStep` is its own dependency:
    // the effect runs a second time ONLY so the card can be measured carrying
    // this step's real text, and a fresh object every pass would be an infinite
    // render loop — measured as one in a real browser before this guard existed.
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 160 }
    const at = spotCardAt(boxOf(r), size, { width: window.innerWidth, height: window.innerHeight })
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
  }, [tourIdx, tourTick, tourStep])

  useEffect(() => {
    if (tourIdx < 0) return
    const bump = () => setTourTick((t) => t + 1)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTourIdx(-1)
      if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
      if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
    }
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', bump)
      window.removeEventListener('scroll', bump, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [tourIdx])

  // ── ⚖ Liam flag 26 — block drag / resize ─────────────────────────────────

  /** canon `bindBlockDrag` (:4050). Same shape as the card drag above, three
   *  rules of its own:
   *
   *  1. THE LATTICE IS 5 MINUTES, not 30 — `opsConfig.blockStepMin`, the store's
   *     own dial (canon :3543). A 休憩 dragged out to 35分 is legal; a booking
   *     dragged to 35分 is not, and neither pipeline may borrow the other's
   *     granularity (canon says so in as many words at :4486).
   *  2. EVERY LANE IS A LANDING. Canon lets 清掃 travel to a person, because
   *     staff do cleaning — the same-group leash was the bug that made blocks
   *     refuse to move vertically at all (:4114). Only a locked lane refuses.
   *  3. A RELEASE THAT OVERLAPS ANYTHING REAL GOES BACK. Blocks skip the 仮押さえ
   *     gate entirely (they are placeholders, not bookings), but canon still
   *     runs a "軽ゲート" overlap check and restores + toasts on a clash (:4145).
   *
   *  A plain click still opens ブロック情報 — that is the block's other half and
   *  canon binds both through one `bindBlock` (:4276) so a box can never end up
   *  movable but unopenable. `suppressClickUntil` keeps the release's synthetic
   *  click out of it, exactly as the cards already do. */
  function beginBlockDrag(ctx: Omit<BlockDragCtx, 'detach' | 'pending' | 'frame'>) {
    const onMove = (e: PointerEvent) => {
      const c = blockDragRef.current
      if (!c || e.pointerId !== c.pointerId) return
      e.preventDefault()
      if (e.buttons === 0) { cancelBlockDrag(e); return }
      c.pending = { clientX: e.clientX, clientY: e.clientY }
      if (c.frame != null) return
      c.frame = requestAnimationFrame(() => { c.frame = null; applyBlockFrame() })
    }
    const onUp = (e: PointerEvent) => {
      const c = blockDragRef.current
      if (!c || e.pointerId !== c.pointerId) return
      finishBlockDrag(e)
    }
    const onCancel = (e: PointerEvent) => {
      const c = blockDragRef.current
      if (!c || e.pointerId !== c.pointerId) return
      cancelBlockDrag(e)
    }
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', cancelBlockDrag)
    blockDragRef.current = {
      ...ctx,
      pending: null,
      frame: null,
      detach: () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('blur', cancelBlockDrag)
      },
    }
  }

  function applyBlockFrame() {
    const ctx = blockDragRef.current
    if (!ctx || !ctx.pending) return
    const { clientX, clientY } = ctx.pending
    ctx.pending = null
    const dx = clientX - ctx.startX
    const dy = clientY - ctx.startY
    if (!ctx.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    const span = nextSpan(ctx.origin, ctx.track, dx, BLOCK_STEP)
    // ⚖ Liam flag 29 — the card's rule, on the block: an edge press stretches the
    // box where it stands and never puts it in the air. Canon's own block drag
    // does exactly this (`evSet` then `return`, bindBlockDrag :4098–4110).
    const inHand = stretchOrCarry([ctx.node], ctx.origin.mode, span)
    if (!ctx.moved) {
      ctx.moved = true
      if (inHand) {
        const { cls } = blockChrome(ctx.item.kind)
        setProxy({ kind: 'block', item: ctx.item, state: cls, w: ctx.grab.w, h: ctx.grab.h })
      }
    }
    if (inHand) {
      moveProxy(clientX, clientY, ctx.grab)
      // `null` group: rule 2 above. A locked lane keeps the previous target,
      // which is canon's `if (lane.classList.contains("locked")) return`.
      const laneKey = laneKeyAtY(boardRef.current, null, clientY)
      if (laneKey && !locked.includes(laneKey)) ctx.targetLane = laneKey
    }
    setBlockLive({ key: ctx.key, homeLane: ctx.homeLane, targetLane: ctx.targetLane, ...span, mode: ctx.origin.mode })
  }

  /** The cursor and the grab zone, read on hover — canon does both from one
   *  function (:4075–4084) so what the cursor promises and what pointerdown
   *  does can never disagree. `--grip` is the overhang that lets a ~18px micro
   *  be grabbed at all (canon :4047). */
  function onBlockPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current || blockDragRef.current) return
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    el.style.setProperty('--grip', `${blockEdgeZones(r.width).overhang.toFixed(1)}px`)
    el.style.cursor = blockDragModeAt(el, e.clientX) === 'move' ? 'grab' : 'ew-resize'
  }

  function onBlockPointerDown(e: React.PointerEvent<HTMLButtonElement>, item: BoardItem, lane: BoardLane) {
    if (e.button !== 0 || dragRef.current || blockDragRef.current) return
    if (pending) { refuse('仮押さえ中の変更を確定するか、元に戻してから操作してください'); return }
    const track = e.currentTarget.closest('.track')
    if (!track) return
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--grip', `${blockEdgeZones(rect.width).overhang.toFixed(1)}px`)
    beginBlockDrag({
      key: item.key,
      pointerId: e.pointerId,
      origin: dragOrigin(item.x, item.w, blockDragModeAt(e.currentTarget, e.clientX), BLOCK_STEP),
      startX: e.clientX,
      startY: e.clientY,
      homeLane: lane.key,
      targetLane: lane.key,
      track,
      moved: false,
      item,
      node: e.currentTarget,
      grab: { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height },
    })
    e.preventDefault()
  }

  function finishBlockDrag(e: PointerEvent) {
    const ctx = blockDragRef.current
    if (!ctx) return
    // A press that never travelled is the click, and the click opens ブロック情報.
    if (!ctx.moved) { clearBlockDrag(); return }
    // canon (:4142): a drag-release is never also a click on the box.
    // Read off the event's own clock, the same monotonic origin the board's
    // click checks use — nothing in this component reads the wall clock.
    openClickWindow(e.timeStamp, ctx.node)
    const span = nextSpan(ctx.origin, ctx.track, e.clientX - ctx.startX, BLOCK_STEP)
    let targetLane = ctx.targetLane
    if (ctx.origin.mode === 'move') {
      const laneKey = laneKeyAtY(boardRef.current, null, e.clientY)
      if (!laneKey || locked.includes(laneKey)) {
        clearBlockDrag()
        refuse('予定を置く行の中で離してください')
        return
      }
      targetLane = laneKey
    } else {
      targetLane = ctx.homeLane
    }
    clearBlockDrag()
    if (blockClash(placedLanes.find((l) => l.key === targetLane), ctx.key, span)) {
      refuse('他の予定と重なるため元の位置に戻しました')
      return
    }
    if (span.x === ctx.origin.x && span.w === ctx.origin.w && targetLane === ctx.homeLane) return
    const home = blockMoves[ctx.key]
    setBlockMoves((was) => ({ ...was, [ctx.key]: { laneKey: targetLane, x: span.x, w: span.w } }))
    const laneLabel = placedLanes.find((l) => l.key === targetLane)?.label ?? ''
    const from = minuteOf(span.x, hours)
    const to = minuteOf(span.x + span.w, hours)
    show(`${ctx.item.title}を${laneLabel}の${hhmm(from)}〜${hhmm(to)}に変更しました`)
    // ⚖ Liam flag 39 — and THEN the advisor, on the drop only. The engine is
    // asked the same question a booking asks it, about the board WITHOUT this
    // block: `evaluate(pocket, {start, dur})` is fully generic, so a 記録 that
    // strands dead minutes or eats the day's last 新規 window is knowable here
    // and always was. Nothing is refused — a safe landing says nothing at all.
    const cell = verdictAt(
      targetLane,
      from,
      to - from,
      null,
      boardLanes.map((l) => ({ ...l, items: l.items.filter((i) => i.key !== ctx.key) })),
    )
    // ⚖ 39 — AND ONLY WHEN THERE IS SOMETHING BETTER TO OFFER. Measured in the
    // browser, not argued: two landings are "not safe" and yet nothing is
    // wrong with them. A block sitting at the least-loss start of its pocket
    // comes back `degraded` with 0枠減 and no alternatives — it is already the
    // best position, and telling the operator so is noise. A block dropped in
    // the morning, behind the day's own clock, has no pocket at all and comes
    // back 「この開始には15分の連続した空きがありません」 — true of every past
    // minute, and 記録 for something that already happened is a normal thing to
    // do. `alternatives` is the engine's own answer to "is there a better
    // place", so it is also the honest test for whether this surface has
    // anything to say — and it keeps 提案位置に置く a button that always acts.
    if (!cell || cell.state === 'safe' || cell.alternatives.length === 0) return
    blockAdviceOpenedAt.current = e.timeStamp
    setBlockAdvice({
      key: ctx.key,
      title: ctx.item.title,
      laneKey: targetLane,
      laneLabel,
      dur: to - from,
      cell,
      // The engine's own least-loss / safe start — the surface does not open
      // without one, so this button always acts.
      suggest: cell.alternatives[0],
      home,
    })
  }

  /** ⚖ Liam flag 39 — the one click. The block goes to the start the engine
   *  named, on the lane it was dropped on, at its own length. */
  function takeBlockSuggestion(a: NonNullable<typeof blockAdvice>) {
    const at = place(a.suggest, a.suggest + a.dur, hours)
    setBlockMoves((was) => ({ ...was, [a.key]: { laneKey: a.laneKey, ...at } }))
    setBlockAdvice(null)
    show(`${a.title}を${a.laneLabel}の${hhmm(a.suggest)}〜${hhmm(a.suggest + a.dur)}に移しました`)
  }

  /** …and やめる, which is the drop itself undone: back to wherever this block
   *  stood before the gesture, which for an untouched block is the span the
   *  server drew and therefore no entry at all. */
  function undoBlockDrop(a: NonNullable<typeof blockAdvice>) {
    setBlockMoves((was) => {
      const next = { ...was }
      if (a.home) next[a.key] = a.home
      else delete next[a.key]
      return next
    })
    setBlockAdvice(null)
    show(`${a.title}を元の位置に戻しました`)
  }

  /** ⚖ BATCH-6 flag 43 — canon `forceBlockCancel` (:4015-4028). Its own comment
   *  names this bug out loud: 「blockDrop を通らずに終わったドラッグの解放が、
   *  そのままスロットのクリック＝新規予約作成として読まれていた（Liam bug #4）」.
   *
   *  The window belongs HERE and not in `clearBlockDrag`: that teardown is also
   *  the one an unmoved press uses, and a block's plain click is what opens
   *  ブロック情報 — canon's `blockDrop` returns on `!ctx.moved` BEFORE its own
   *  write for exactly that reason. Deviation from the packet's letter, kept to
   *  its intent; recorded in the build report. */
  function cancelBlockDrag(e: { timeStamp: number }) {
    const ctx = blockDragRef.current
    if (!ctx) return
    openClickWindow(e.timeStamp, ctx.node)
    clearBlockDrag()
  }

  function clearBlockDrag() {
    const ctx = blockDragRef.current
    if (ctx) {
      if (ctx.frame != null) cancelAnimationFrame(ctx.frame)
      // ⚖ Liam flag 29 — hand the node back to React at the span it started on.
      stretchOrCarry([ctx.node], ctx.origin.mode, ctx.origin)
      ctx.detach()
    }
    blockDragRef.current = null
    setBlockLive(null)
    setProxy(null)
  }

  useEffect(() => () => { blockDragRef.current?.detach() }, [])

  // ── ⚖ Liam flag 24 — the staff-name column's width ───────────────────────

  /** canon's `#labelResize` pipeline (:5961–5986), which it keeps deliberately
   *  APART from the card and block drags: dragging the divider writes one CSS
   *  custom property on the board root, so the grid re-lays out and React never
   *  hears about it. Nothing is stored — canon does not persist the width
   *  either, and a column width is a "right now, let me read this" gesture, not
   *  a setting. The guard against starting on top of a live card drag is
   *  canon's own (`if (dragCtx || blockDragCtx) return`). */
  function onLabelResizeDown(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0 || dragRef.current || blockDragRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    const board = boardRef.current
    if (!board) return
    const startX = e.clientX
    const startW = labelWidthOf(board, LABEL_DEFAULT)
    const onMove = (ev: PointerEvent) => {
      board.style.setProperty('--label', `${clampLabelWidth(startW, ev.clientX - startX)}px`)
    }
    const done = () => {
      handle.classList.remove('dragging')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', done)
      window.removeEventListener('pointercancel', done)
    }
    handle.classList.add('dragging')
    // On `window`, not the handle: a 10px-wide element loses the pointer the
    // instant the drag outruns it, and canon only gets away with binding the
    // handle because it also takes pointer capture. Same reasoning as the card
    // drag above, one line cheaper.
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', done)
    window.addEventListener('pointercancel', done)
  }

  /** canon's refusal beat (:7106), ⚖ MOVED BY LIAM'S FLAG 31 TO WHERE IT BELONGS:
   *  a NEW PLACEMENT, where the operator is still choosing a start and a better
   *  one is worth offering. A move already has a card in a place and its own
   *  confirm surface; a placement has neither, which is the difference.
   *
   *  Every new-placement flow goes through here — the empty-track create, 次回予約
   *  and the shelf chip — and a SAFE landing is placed with no popup at all: this
   *  function performs the placement or asks about it, so no caller can forget
   *  half of the pair. The popup's controls carry the same `run`, which is what
   *  makes この開始に配置 an honest button (it used to only close the popup). */
  function askGuard(
    laneKey: string,
    start: number,
    dur: number,
    excludeId: string | null,
    at: { x: number; y: number; t: number },
    run: (start: number) => void,
  ) {
    const cell = verdictAt(laneKey, start, dur, excludeId)
    if (!cell || cell.state === 'safe') {
      run(start)
      return
    }
    // canon reads `performance.now()` here; we take the OPENING EVENT's own
    // timestamp instead — same monotonic origin, and this component reads no
    // clock outside an event (the same rule `suppressClickUntil` follows).
    adviceOpenedAt.current = at.t
    setAdvice({ laneKey, start, cell, anchor: at, place: run })
  }

  /** ⚖ Liam flag 33 — canon's SINGLETON invariant (:7086-7087): a new gesture on
   *  the board puts the open popup down before it starts, so at most one
   *  transient surface is ever alive. Canon guarantees it on `bindDemoPointer`'s
   *  pointerdown (:7779); ours hangs off the board root, which every card, block
   *  and track gesture passes through, plus the shelf chip's own press. */
  function closeAdvice() {
    if (advice) setAdvice(null)
    // ⚖ 39 rides the same invariant: the block advisor is a transient surface on
    // the same board, so a new gesture puts it down too. Never both at once.
    if (blockAdvice) setBlockAdvice(null)
  }

  /** canon `keyboardResizeBooking` (:3889). */
  function onCardKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, item: BoardItem, lane: BoardLane) {
    const leftEdge = e.shiftKey && !e.altKey
    const rightEdge = e.altKey && !e.shiftKey
    if ((!leftEdge && !rightEdge) || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    e.stopPropagation()
    if (!item.caseId || dragRef.current) return
    if (pending && pending.id !== item.caseId) {
      refuse('仮押さえ中の変更を確定するか、元に戻してから操作してください')
      return
    }
    // ⚖ BATCH-6 flag 45 — the keyboard nudge is the same landing as a drag and
    // takes the same two-sided answer: a card focused on its BED row is resized
    // in the room's lane, and the person keeps theirs. It used to write the
    // focused lane into the staff record here too.
    const from = pairLanesOf(boardLanes, item.caseId, { x: item.x, w: item.w })
    const next = keyboardNudge(item.x, item.w, leftEdge ? 'resizeL' : 'resize', e.key === 'ArrowLeft' ? -1 : 1, STEP)
    if (!next) {
      refuse('これ以上は時間を変更できません')
      return
    }
    stage(
      item.caseId,
      sidesAt(from, lane.group, lane.key),
      next,
      pending?.id === item.caseId ? { staff: pending.origin, bed: pending.bedOrigin ?? null } : from,
    )
  }

  // ── 仮置きエリア ──────────────────────────────────────────────────────────

  function park(id: string, item: BoardItem, from: Move) {
    // ⚖ Liam 22: `parkChipText` stamps the ORIGIN day into the 元: line here, at
    // park time — so the line still names 8/20 12:00 after the operator has
    // paged forward to 8/22, which is the whole point of the shelf. The same day
    // goes onto `home` as DATA, because a printed sentence is not something the
    // × can restore from (canon's snapshot carries `day`, :5567-5570).
    const text = parkChipText(item, hours, props.dayLabel)
    setParked((was) => (was.includes(id) ? was : [...was, id]))
    setParkChips((was) => [...was.filter((c) => c.id !== id), {
      id, ...text, category: item.category,
      // ⚖ Liam flag 46 — and the STORE it was taken from, stamped at the same
      // moment and for the same reason: the board that can restore it, and the
      // only board it may be placed on.
      home: {
        ...from,
        dayOffset: props.dayOffset,
        dayLabel: props.dayLabel,
        storeParam: props.storeParam,
        storeLabel: props.lensLabel,
      },
      lenMin: item.endMin - item.startMin, item,
    }])
    setPending(null)
    show(`${item.title}様を仮置きエリアへ移動しました（仮押さえ扱い）`)
  }

  /** The chip's ×. ⚖ Liam 22: it restores the booking to its ORIGIN day and slot
   *  — `home` is the span AND the day it was taken from, so the restore is right
   *  from ANY day the operator happens to be standing on. `unparkOutcome` owns
   *  the three cases; the only one that does not restore is the soft failure. */
  function unpark(id: string) {
    const chip = parkChips.find((c) => c.id === id)
    if (!chip) return
    const name = chip.title.replace('（仮押さえ・未配置）', '')
    // The only board this browser can see is the one on screen, so the origin is
    // checkable exactly when the origin day IS on screen: the server's own lanes
    // for today, plus anything this session added to them.
    const originHere =
      props.lanes.some((l) => l.items.some((i) => i.caseId === id)) ||
      // `onShownBoard` (main): batch-7 scoped this by day alone because its
      // AddedRow has no store — the merged one does, and a row that leaked
      // across stores was Greptile #737 P1.
      added.some((a) => onShownBoard(a, board) && a.item.caseId === id)
    const outcome = unparkOutcome(chip.home, props.dayOffset, props.storeParam, originHere)
    if (outcome === 'gone') {
      refuse(`${name}の元の枠が見つかりません。仮置きエリアに残しています`)
      return
    }
    setParked((was) => was.filter((x) => x !== id))
    setParkChips((was) => was.filter((c) => c.id !== id))
    setAdded((was) => was.filter((a) => a.item.caseId !== id))
    setMoves((was) => ({ ...was, [id]: { laneKey: chip.home.laneKey, x: chip.home.x, w: chip.home.w } }))
    // ⚖ Liam flag 46 — the × works from ANY board, so 'elsewhere' now has two
    // reasons and the toast has to name the one that applies: another day, or
    // another store's board entirely. Saying 「8月22日(土)の元の枠に戻しました」
    // to someone standing on 代官山 would send them looking on the wrong board.
    const away =
      chip.home.storeParam !== props.storeParam
        ? `${chip.home.storeLabel} ${chip.home.dayLabel}`
        : chip.home.dayLabel
    show(outcome === 'here' ? `${name}を元の枠に戻しました` : `${name}を${away}の元の枠に戻しました`)
  }

  function onChipPointerDown(e: React.PointerEvent<HTMLElement>, id: string) {
    // canon :5591: a press on the × is a press on the ×. Without this the chip
    // arms a drag under the button, and the release that should have returned
    // the booking is spent cancelling a gesture nobody started.
    if (e.button !== 0 || dragRef.current || (e.target as Element).closest('.park-x')) return
    closeAdvice()
    if (pending) {
      refuse('仮押さえ中の変更を確定するか、元に戻してから操作してください')
      return
    }
    const box = e.currentTarget.getBoundingClientRect()
    chipDragRef.current = {
      id, startX: e.clientX, startY: e.clientY, moved: false, laneKey: null,
      grab: { dx: e.clientX - box.left, dy: e.clientY - box.top, w: box.width, h: box.height },
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* capture is an assist */ }
    e.preventDefault()
  }

  /** One teardown for the shelf gesture, so the pointer-up, the pointercancel and
   *  the `buttons === 0` self-heal cannot drift apart — a chip drag that ended on
   *  any of the three used to leave the board's emphasis behind on one of them.
   *
   *  ⚖ BATCH-6 flag 43 — and canon's click window opens here, on the SAME three
   *  endings, so they cannot drift apart on that either. Canon's condition is
   *  MOVED, not landed (:5640: `if (moved) { suppressClickUntil = …;
   *  suppressClickSource = chip; }`): ours only opened it on a chip that found a
   *  lane, so a chip carried across the board and released over nothing fired its
   *  trailing click straight into the track underneath. An UNMOVED press keeps
   *  its click — that click is the chip's own ×. */
  function clearChipDrag(e?: { timeStamp: number; currentTarget: EventTarget | null }) {
    const ctx = chipDragRef.current
    if (e && ctx?.moved) openClickWindow(e.timeStamp, e.currentTarget instanceof Element ? e.currentTarget : null)
    chipDragRef.current = null
    setChipTarget(null)
    setDragLen(null)
    setProxy(null)
  }

  function onChipPointerMove(e: React.PointerEvent<HTMLElement>) {
    const ctx = chipDragRef.current
    if (!ctx) return
    if (e.buttons === 0) { clearChipDrag(e); return }
    if (!ctx.moved && Math.abs(e.clientX - ctx.startX) < 5 && Math.abs(e.clientY - ctx.startY) < 5) return
    const chip = parkChips.find((c) => c.id === ctx.id) ?? null
    if (!ctx.moved) {
      setDragLen(chip?.lenMin ?? null)
      // The chip travels too (⚖ Liam 19): the shelf keeps its place in the row —
      // canon's chip never physically moves — and the operator carries a copy.
      // ⚖ Liam flag 28: the copy is a BOARD CARD at the booking's real duration,
      // not a clone of the chip's own sentence-shaped box. It is also CENTRED on
      // the pointer rather than keeping the chip's grip, because `shelfLanding`
      // centres the landing on the pointer too — the thing in hand and the dashed
      // preview under it now describe the same rectangle.
      if (chip) {
        const size = chipProxySize(boardRef.current, hours, chip.lenMin) ?? ctx.grab
        ctx.grab = { dx: size.w / 2, dy: size.h / 2, w: size.w, h: size.h }
        setProxy({ kind: 'chip', title: chip.title, line1: chip.line1, category: chip.category, w: size.w, h: size.h })
      }
    }
    ctx.moved = true
    moveProxy(e.clientX, e.clientY, ctx.grab)
    // canon :5629 takes ANY lane under the pointer, not only a staff one — a
    // chip dropped on a bed lane is the receptionist saying which ROOM it goes
    // in and leaving the person alone.
    ctx.laneKey = laneKeyAtY(boardRef.current, 'staff', e.clientY) ?? laneKeyAtY(boardRef.current, 'beds', e.clientY)
    setChipTarget(ctx.laneKey)
  }

  /** canon `placeFromShelf` (:5653): the chip lands on the same dual lattice,
   *  centred on the pointer, and arrives as a 仮押さえ rather than a booking. */
  function onChipPointerUp(e: React.PointerEvent<HTMLElement>) {
    const ctx = chipDragRef.current
    clearChipDrag(e)
    if (!ctx || !ctx.moved) return
    const chip = parkChips.find((c) => c.id === ctx.id)
    // ⚖ Liam flag 47 — A REFUSAL THAT SAYS NOTHING IS THE WORST ONE. A chip
    // carried across the board and released over the shelf, the header or the
    // gap between groups used to end in a bare `return`: the chip stayed (the
    // invariant held) but nothing on screen said why the drop did nothing, so
    // the operator's only reading was that the board had ignored them. The card
    // drag has said this since flag 19; the shelf gesture now says it too, in
    // the same words.
    if (!ctx.laneKey) {
      if (chip) refuse('予約を置く行の中で離してください')
      return
    }
    const track = boardRef.current?.querySelector(`.lane[data-lane="${ctx.laneKey}"] .track`)
    if (!chip || !track) return
    // ⚖ Liam flag 46 — VISIBLE BUT REFUSED. The chip survived a store switch and
    // is still in the shelf; this board's staff and rooms are another store's,
    // so the landing is declined here, BEFORE the guard is consulted — offering
    // 「より良い開始」 on a board the booking may not be placed on at all would
    // be advice about an impossible placement.
    const foreign = foreignStoreRefusal(chip.home, props.storeParam)
    if (foreign) {
      refuse(foreign)
      return
    }
    const w = chip.home.w
    const laneKey = ctx.laneKey
    const span = { x: shelfLanding(fractionIn(track, e.clientX), w, chip.home.x, STEP), w }
    // ⚖ Liam flag 31c — a shelf drop is a NEW placement too, so it gets the same
    // consult: an unsafe landing offers the better starts before the card is put
    // down, and the buttons re-aim this very drop. `chip.id` is excluded from the
    // guard's obstacles — a parked card holds no ground on the board it left.
    const start = minuteOf(span.x, hours)
    const dur = minuteOf(span.x + span.w, hours) - start
    askGuard(laneKey, start, dur, chip.id, { x: e.clientX, y: e.clientY, t: e.timeStamp }, (s) =>
      // The start the drop already computed keeps its EXACT span: canon's dual
      // lattice can land a card on 17:12, and re-deriving it through the minute
      // would quietly round the drop the operator actually made. Only a start the
      // popup offered — always a clean one — is re-derived.
      placeFromShelf(chip, laneKey, s === start ? span : place(s, s + dur, hours)),
    )
  }

  // ── 配置モード — canon's `armPlacing` / `disarmPlacing` / `createAtCell` ────

  /** ⚖ Liam 2026-08-20 (flag 21) — 次回予約を作成, carried from canon (:6903).
   *  The button does NOT open the create dialog: it ARMS the board. The
   *  ご来店中 customer is already known, so nothing needs typing — the operator
   *  picks a slot and the booking is made there, on whatever day they navigate
   *  to. Length and category are the store's standard session and 単発, which is
   *  what canon's own label states out loud. */
  function armNextVisit() {
    if (!props.inStore) return
    if (pending) {
      refuse('仮押さえ中の変更を確定するか、元に戻してから操作してください')
      return
    }
    setPlacing({
      label: `${props.inStore.name}様の次回予約（${props.guard.standardSessionMin}分・単発）— お客様情報は自動入力`,
      name: props.inStore.name,
      // ⚖ Liam flag 46 rider — the ご来店中 customer is in THIS store. 配置モード
      // survives a store switch exactly as the shelf chip does, so it carries
      // the same two fields and is refused by the same rule.
      storeParam: props.storeParam,
      storeLabel: props.lensLabel,
    })
    show('配置モード: 置きたい空き枠をクリック（日付を移動してもそのまま）')
  }

  /** canon `createAtCell` (:6005) reached through 配置モード: the click makes the
   *  booking there and then, as a 仮押さえ on the hold bar — NOT the create
   *  modal, because `prefilled` is true and there is nothing left to ask
   *  (:6076–6083). A person needs a room, so the placement is refused when no
   *  lane in the other group is free, in canon's own words. */
  function placeNextVisit(lane: BoardLane, start: number) {
    const p = placing
    if (!p) return
    // ⚖ Liam flag 46 rider — the same store rule as the shelf chip's, in the
    // same shape. Checked here as well as at the click so the guard popup's
    // 「この開始に配置」 cannot walk around it.
    const foreign = foreignStoreRefusal(p, props.storeParam)
    if (foreign) {
      refuse(foreign)
      return
    }
    const end = Math.min(start + props.guard.standardSessionMin, hours.close)
    const partner = freePartnerLane(boardLanes, 'staff', start, end)
    if (!partner) {
      refuse('この時間帯に空いているベッドがいません')
      return
    }
    setPlacing(null)
    // canon's `cellCreateSeq` (:6029): a counter, not a clock. Two placements in
    // the same millisecond would collide on a timestamp, and the id is a React
    // key here — the board would drop one of the two cards.
    //
    // ⚖ 46 forerunner — AND THE BOARD, because the counter alone is not unique.
    // `createSeq` is a ref inside this screen and the screen remounts on every
    // `?day=` / `?store=` navigation, so the first placement on EVERY board was
    // `nextvisit-1`: two of them collided in `moves`, and `revertPending`'s
    // caseId lookup would take the wrong one back. This is the reason `moves`
    // needs no store stamp — every other id in it is a real booking's, which
    // belongs to exactly one store (see BusinessSessionEdits.tsx).
    createSeq.current += 1
    const id = `nextvisit-${props.storeParam ?? 'all'}-${props.dayOffset}-${createSeq.current}`
    const span = place(start, end, hours)
    const face = {
      kind: 'booking' as const,
      state: 'hold' as const,
      category: 'repeat' as const,
      ...span,
      title: p.name,
      time: `${hhmm(start)}〜${hhmm(end)}`,
      ticketCat: '単発',
      ticketCore: yen(dialogs.pricing.base),
      held: false,
      micro: false,
      caseId: id,
      label: `${hhmm(start)}–${hhmm(end)} ${p.name}様 次回予約（仮押さえ）`,
    }
    setAdded((was) => [
      ...was,
      { ...board, laneKey: lane.key, item: { ...face, key: `${id}-staff`, tag: `【${partner.label}】` } },
      { ...board, laneKey: partner.key, item: { ...face, key: `${id}-bed`, tag: `【${lane.label}】` } },
    ])
    setMoves((was) => ({ ...was, [id]: { laneKey: lane.key, ...span } }))
    // '' is `revertPending`'s "there is no earlier span" sentinel: 元に戻す on a
    // creation deletes it rather than moving it somewhere it has never been.
    setPending({ id, origin: { laneKey: '', x: 0, w: 0 }, ...boardStamp })
    setSelected(null)
    show(`${p.name}様の次回予約を${props.dayLabel} ${hhmm(start)}に仮押さえしました（お客様情報は自動入力）`)
  }

  /** ⚖ Liam 2026-08-20 (flag 22) — the landing, on WHATEVER DAY is on screen.
   *
   *  The chip used to land through `moves` alone, which can only ever re-place a
   *  card the shown day already knows about: carry a chip to 8/22 and the drop
   *  did nothing, because 8/22's board has no such booking to move. It lands as
   *  a row on the day being viewed instead, and `parked` keeps the origin day
   *  hiding the booking — so it is on exactly one board, the one it was put on.
   *
   *  `moves` is still written because the 仮押さえ bar's checks read the span
   *  from there; it never draws the card. */
  function placeFromShelf(chip: ParkChip, laneKey: string, span: { x: number; w: number }) {
    // THE CHIP GOES TO ANY DAY, BUT ONLY TO ITS OWN STORE. The shelf survives
    // `?store=`, and ⚖ 46 keeps every chip VISIBLE on every board (it is the
    // operator's hand, not the board's content). What a foreign board cannot do
    // is take it: this board's lanes are other people and other rooms, and the
    // booking's own store would lose it. Refused ahead of every setter, so the
    // chip is still on the shelf and the × still works.
    //
    // KEPT AT CYCLE 7, in batch-7's vocabulary. `onChipPointerUp` already refuses
    // — but this function is ALSO the guard popup's callback (`askGuard`, just
    // above), and that popup outlives a `?store=` switch, so 「この開始に配置」
    // can re-enter here on a board the drop never passed the check on. That is
    // exactly the hole batch-7 closes for `placeNextVisit` in its own words:
    // "checked here as well as at the click so the guard popup's 「この開始に配置」
    // cannot walk around it". The shelf path needs the same second door.
    const foreign = foreignStoreRefusal(chip.home, props.storeParam)
    if (foreign) {
      refuse(foreign)
      return
    }
    const start = minuteOf(span.x, hours)
    const end = minuteOf(span.x + span.w, hours)
    // canon :5629/:5666: the drop names ONE lane, and which group it belongs to
    // decides what the operator just said. A bed lane means "this room" and the
    // person stays whoever the chip left with; a staff lane means "this person"
    // and the room still has to be found.
    const dropped = boardLanes.find((l) => l.key === laneKey)
    const free = (l: BoardLane | undefined) => l != null && l.items.every((i) => i.endMin <= start || i.startMin >= end)
    const staff = dropped?.group === 'beds' ? boardLanes.find((l) => l.key === chip.home.laneKey) : dropped
    // A booking is a person AND a room. canon puts the parked card's OWN bed
    // back, so that is the first candidate — but on another day it may be taken,
    // and a card labelled 【ベッド3】 over an occupied ベッド3 is the impossible
    // state ⚖ 8/9 forbids, so a free one is found the way `createAtCell` does.
    const home = boardLanes.find((l) => l.group === 'beds' && l.label === chip.item.tag.replace(/[【】]/g, ''))
    const bed = dropped?.group === 'beds' ? dropped : free(home) ? home : freePartnerLane(boardLanes, 'staff', start, end)
    if (!bed || !staff) {
      refuse('この時間帯に空いているベッドがいません')
      return
    }
    const staffLabel = staff.label
    const landed = {
      ...chip.item,
      ...place(start, end, hours),
      time: `${hhmm(start)}〜${hhmm(end)}`,
      state: 'hold' as const,
      // The accessible name is REBUILT, in `today-board`'s own grammar (:362),
      // not patched: the landing can change the time, the staff member AND the
      // bed at once, and a name that carries any of the three from where the
      // card used to be tells a screen reader the one thing on this board that
      // is not true.
      label: `${hhmm(start)}–${hhmm(end)} ${chip.item.title}様 / ${[chip.item.ticketCat, chip.item.ticketCore].filter(Boolean).join(' ')} / ${staffLabel} / ${bed.label} / 仮押さえ`,
    }
    setParkChips((was) => was.filter((c) => c.id !== chip.id))
    setAdded((was) => [
      ...was.filter((a) => a.item.caseId !== chip.id),
      { ...board, laneKey: staff.key, fromChip: chip, item: { ...landed, key: `${chip.id}-staff`, tag: `【${bed.label}】` } },
      { ...board, laneKey: bed.key, item: { ...landed, key: `${chip.id}-bed`, tag: `【${staffLabel}】` } },
    ])
    setMoves((was) => ({ ...was, [chip.id]: { laneKey: staff.key, ...span } }))
    setPending({ id: chip.id, origin: chip.home, ...boardStamp })
    setSelected(null)
    show(`${chip.item.title}様を${props.dayLabel} ${hhmm(start)}へ仮押さえしました`)
  }

  // The month grid the calendar popover draws: the loaded window, grouped by
  // the month the ‹ › buttons are standing on.
  const monthCells = useMemo(() => {
    const anchor = props.calendar.find((c) => c.offset === props.dayOffset) ?? props.calendar[0]
    let y = anchor.y
    let m = anchor.m + calMonth
    while (m > 12) { m -= 12; y += 1 }
    while (m < 1) { m += 12; y -= 1 }
    const days = props.calendar.filter((c) => c.y === y && c.m === m).sort((a, b) => a.d - b.d)
    const lead = days.length > 0 ? days[0].wd : 0
    return { y, m, days, lead }
  }, [props.calendar, props.dayOffset, calMonth])

  const timelineClasses = [
    'timeline',
    showTime ? '' : 'hide-time',
    showTicket ? '' : 'hide-tkt',
    showSlotPrice ? '' : 'hide-slot-prices',
    `sell-${sellMode}`,
    // ⚖ Liam flag 27 (2026-08-20) — THE DEGRADE VALVE IS OFF, and this is a
    // deliberate overturn of canon's E9c (:5369–5372), not a port gap. Canon
    // blanked the tint once a day carried more than DENSITY_CEILING visible
    // bands; Liam ruled that 販売可能枠の表示 means literally what it says —
    // 淡色表示 = tint and price at ANY band count, ドラッグ時のみ = drag-only,
    // 非表示 = hidden — because a setting that silently overrides the operator's
    // own choice reads as a broken screen, not as a kindness. `sell.degraded` is
    // still COMPUTED by the frozen engine; this display layer no longer consumes
    // it, which is the whole change. PRINCIPLE for the lane: a control never
    // silently overrides an explicit choice.
    // ⚖ Liam 2026-08-20. Canon gates the drag reveal on `:has(.event.dragging)`,
    // which can only ever see a card on the board — a shelf chip travelling to a
    // lane left the whole window layer asleep. One class, set for BOTH gestures.
    // ⚖ Liam flag 26: canon's reveal gate is `:has(.event.dragging)`, and
    // `bindBlockDrag` puts `.dragging` on the block it moves — so canon DOES lift
    // the window layer for a block drag, and so do we. What a block does NOT get
    // is the length emphasis: `.fits` keys off `dragLen`, which stays null,
    // because a 休憩 is not a session and has no length to match a window against.
    // ⚖ Liam flag 29: a RESIZE is in the same position — canon lifts the layer
    // for it (`dragActive` is set before the mode branch, :4468) because the edge
    // is being dragged INTO those windows, but `dragLen` stays null, so nothing
    // is emphasised. The emphasis answers "where does this card FIT", and a card
    // that is not going anywhere is not asking.
    dragLen != null || live || blockLive ? 'dragging-live' : '',
    placing ? 'placing' : '',
    `guard-guide-mode-${guideMode}`,
  ]
    .filter(Boolean)
    .join(' ')

  function renderLane(lane: BoardLane) {
    if (view !== 'both' && ((view === 'staff' && lane.group !== 'staff') || (view === 'beds' && lane.group !== 'beds'))) return null
    if (collapsed.includes(lane.group)) return null
    const isLocked = locked.includes(lane.key)
    const onThisLane = <T extends { group: string; laneKey: string; resourceKey: string }>(c: T) =>
      c.group !== lane.group ? false : lane.group === 'staff' ? c.laneKey === lane.key : c.resourceKey === lane.key
    // canon `suppressOverlappingSellableCells` (:5039): one box per span. Where
    // a スキマ枠 or a packed session owns the minutes, the normal layer's wash
    // comes off entirely rather than compositing two washes into a third colour.
    const gapHere = [...gap.packed, ...gap.scraps].filter(onThisLane)
    const cells = sell.cells
      .filter(onThisLane)
      .filter((c) => !gapHere.some((g) => g.s < c.h + 60 && c.h < g.e))
    const rail = railByLane.get(lane.key)
    // canon `lane.insertAdjacentElement("afterend", rail)` (:7566): the rail is
    // the lane's SIBLING, not its child. A `.lane` is a two-column grid, so a
    // third child lands in the label column and the strip collapses to a sliver.
    return (
      <Fragment key={lane.key}>
      <div className={`lane${lane.mine ? ' mine' : ''}${isLocked ? ' locked' : ''}`} data-lane={lane.key} data-group={lane.group}>
        <div className="lane-label">
          <strong>{lane.label}</strong>
          {lane.absentNote ? (
            <span className="absent" title={lane.absentNote}>{lane.absentNote}</span>
          ) : (
            <span title={lane.sub}>{lane.sub}</span>
          )}
          {lane.group === 'staff' && (
            <button
              className="lock-toggle"
              type="button"
              aria-pressed={isLocked}
              aria-label={`${lane.label}のシフトロック`}
              title="シフトロック: ロック中は新しい予約を置けず、オンライン空き枠からも除外されます"
              onClick={() => setLocked((was) => toggle(was, lane.key))}
            >
              <svg viewBox="0 0 24 24">
                <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
                <path className="shackle-closed" d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
                <path className="shackle-open" d="M8.5 10.5V8a3.25 3.25 0 0 0-6.5 0v1.4" />
              </svg>
            </button>
          )}
        </div>
        {/* F25 — a click on empty track opens 新規予約を作成 at that half hour
            for that lane. `e.target === e.currentTarget` keeps a card's own
            click out of it; a locked lane takes no new bookings. */}
        <div
          className={`track${dropTarget?.laneKey === lane.key ? ' drop-target' : ''}`}
          onClick={(e) => {
            // canon :6811: a release, however it was caught, is never a create —
            // and ⚖ BATCH-6 flag 43 restores canon's first clause with it: a
            // click dispatched while a gesture is still in hand is not a create
            // either (`if (dragCtx || blockDragCtx || … ) return`). The window is
            // this track's last line of defence, and the capture interceptor
            // above can only swallow a release that landed on the dragged element
            // itself — a release that fell through to the track is stopped here.
            if (e.target !== e.currentTarget || dragRef.current || blockDragRef.current) return
            if (e.timeStamp < suppressClickUntil.current) return
            // ⚖ Liam flag 47 — the bed rows are not a landing for a person, and
            // while 配置モード is armed that has to be SAID. It used to be a bare
            // `return`, which reads as a dead board to the one operator who is
            // actively looking for somewhere to click.
            if (lane.group !== 'staff') {
              if (placing) refuse('次回予約は担当スタッフの行に置いてください（ベッドは自動で選ばれます）')
              return
            }
            if (isLocked) {
              if (placing) refuse('シフトロック中: このスタッフには新しい予約を置けません')
              return
            }
            // ⚖ Liam flag 46 rider — a foreign store's board is refused before
            // the guard is asked, for the shelf chip's own reason.
            if (placing) {
              const foreign = foreignStoreRefusal(placing, props.storeParam)
              if (foreign) {
                refuse(foreign)
                return
              }
            }
            const start = slotStartAt(e.currentTarget, e.clientX, hours)
            const at = { x: e.clientX, y: e.clientY, t: e.timeStamp }
            // ⚖ Liam flag 31c — the consult belongs HERE. The operator is
            // proposing a start that does not exist yet, so the guard's better
            // starts are an offer rather than an interruption, and both of the
            // popup's buttons perform the thing they name: an alternative opens
            // the flow at the safer start, この開始に配置 at the one they picked.
            // A safe slot never sees the popup at all.
            //
            // canon (:6820): while 配置モード is armed the empty slot is a LANDING,
            // not an invitation to fill a form — the customer is already known.
            if (placing) {
              askGuard(lane.key, start, props.guard.standardSessionMin, null, at, (s) => placeNextVisit(lane, s))
              return
            }
            askGuard(lane.key, start, props.guard.standardSessionMin, null, at, (s) =>
              openCreateAt({ staffId: lane.key, start: s }),
            )
          }}
        >
          {!isLocked &&
            cells.map((c) => {
              const span = place(c.h, c.h + 60, hours)
              return (
                <span
                  // A plain 販売可能 wash advertises one standard hour, always
                  // (canon :4867) — so it is the box a 60-minute card fits.
                  className={`cell-price${fitsDrag(60, dragLen) ? ' fits' : ''}`}
                  key={`${lane.key}-${c.group}-${c.h}`}
                  aria-hidden="true"
                  style={{ '--x': `${span.x}%`, '--w': `${span.w}%`, '--tier': c.tier } as React.CSSProperties}
                >
                  {c.group === 'staff' && c.price != null && <i>{money(c.price)}</i>}
                </span>
              )
            })}
          {!isLocked &&
            gapHere.map((c) => {
              const span = place(c.s, c.e, hours)
              const packedHere = gap.packed.includes(c)
              // ⚖ Liam flag 38 / BATCH-5 R6 — COLOUR CARRIES MEANING, BORDERS
              // CARRY DRAG STATE. A full-length session is the product: blue.
              // Anything shorter is a leftover the residue broke off — the same
              // salvage the スキマ枠 layer sells, so it wears the same quiet
              // orange, even though it is priced at full value. Nothing on this
              // layer has a border at rest; the ring belongs to the drag alone.
              const crumbHere = packedHere && isCrumbOffer(c, props.guard.standardSessionMin)
              return (
                <span
                  // A 詰め込み box advertises the length on its own label; a
                  // スキマ枠 advertises a discount, not a session, so canon gives
                  // it no drag emphasis at all and neither do we.
                  className={`${packedHere ? 'cell-packed' : 'cell-gapfill'}${crumbHere ? ' crumb' : ''}${packedHere && fitsDrag(c.e - c.s, dragLen) ? ' fits' : ''}`}
                  key={`${lane.key}-${c.group}-${packedHere ? 'p' : 's'}-${c.s}`}
                  aria-hidden="true"
                  style={{ '--x': `${span.x}%`, '--w': `${span.w}%` } as React.CSSProperties}
                >
                  {/* canon `renderPackedCell` (:5211): a packed box carries its
                      LENGTH beside the price — ¥8,650（60分）— because a wide
                      full-price box would otherwise read as a merged hour band.
                      A スキマ枠 is one offer, so it carries the price alone. */}
                  {c.group === 'staff' && <i>{packedHere ? `${money(c.price)}（${c.e - c.s}分）` : money(c.price)}</i>}
                </span>
              )
            })}
          {landing?.laneKey === lane.key && landing.w > 0 && (
            <div className="drop-ghost" aria-hidden="true" style={{ '--x': `${landing.x}%`, '--w': `${landing.w}%` } as React.CSSProperties} />
          )}
          {lane.items.map((item) => renderItem(item, lane))}
        </div>
      </div>
      {rail && renderRail(rail)}
      </Fragment>
    )
  }

  /** canon `renderSlotBoxes` (:7543). An 18px strip under each staff lane that
   *  shows every exact 30-minute start and what placing a standard session
   *  there would do to the protected 新規 window: purple ✓ keeps it, amber △
   *  costs the least available, grey — is refused. The cells are guidance, not
   *  controls (canon's own copy: 「表示だけの個人設定」), so each carries its
   *  sentence as its accessible name and nothing here can move a booking. */
  function renderRail(rail: GuardRail) {
    return (
      <div
        className="guard-placement-rail"
        data-lane={rail.laneKey}
        role="group"
        aria-label={`${rail.laneLabel}の60分配置ガイド`}
        // ⚖ FLAGS 25c, backlog — the strip is a section of this board and joins
        // the tour like every other one. It arrived in the rail round without a
        // registration and three batches added to it without noticing, which is
        // the miss this round closes. ONE entry, not one per lane: the registry
        // is a document walk, so a pair on every strip would put the same step
        // on the tour once per staff member. The first strip in DOM order
        // carries it and the sentence is true of all of them.
        {...(rails[0]?.laneKey === rail.laneKey
          ? {
              'data-guide-title': '60分配置',
              'data-guide':
                'このスタッフの各30分に、そこから60分の施術を始めた場合の判定が並びます。✓は空きを減らさない、△は減らすが置ける、—は置けません。',
            }
          : {})}
      >
        <span className="guard-rail-label">60分配置</span>
        <div className="guard-rail-track">
          {rail.cells.map((c) => (
            <span
              className={`guard-rail-cell ${c.state === 'safe' ? 'guard-slot safe' : c.state}`}
              key={c.start}
              data-start={c.start}
              data-state={c.state}
              role="img"
              aria-label={`${rail.laneLabel}、${hhmm(c.start)}。${c.sentence}`}
            >
              <i>{c.label}</i>
            </span>
          ))}
        </div>
      </div>
    )
  }

  function renderItem(item: BoardItem, lane: BoardLane) {
    const style = { '--x': `${item.x}%`, '--w': `${item.w}%` } as React.CSSProperties
    const settledHere = item.caseId != null && settled.includes(item.caseId)
    const state =
      item.kind !== 'booking'
        ? ''
        : holdConfirmed && item.state === 'hold'
          ? 'confirmed'
          : (item.state ?? '')
    if (item.kind !== 'booking') {
      const { cls, opens, locked } = blockChrome(item.kind)
      const body = (
        <>
          <strong>{item.title}</strong>
          {!item.micro && <small>{item.time}</small>}
        </>
      )
      // A shift-derived wash is a STATEMENT, not a control — canon renders it as
      // `<span role="note">` (fable-store-today.html renderShiftEndBounds and the
      // hand-written 勤務不可 at :1878), never a button. That element choice is
      // load-bearing for the PAINT as well as the semantics: a disabled button
      // takes `button:disabled { opacity: .45 }` from the shell, which washed the
      // red hatch out to under half strength and made it read as a different,
      // paler red than canon's. A span carries the hatch at full strength, which
      // is what canon shows.
      return opens ? (
        <button
          // ⚖ Liam flag 26 — drag/resize on the 5-minute lattice AND the plain
          // click that opens ブロック情報, bound together the way canon's
          // `bindBlock` (:4276) binds them: a box that moves but cannot be
          // opened is the exact bug canon's own note records fixing.
          className={`event ${cls}${item.micro ? ' micro' : ''}${blockLive?.key === item.key ? (blockLive.mode === 'move' ? ' dragging' : ' resizing') : ''}`}
          type="button"
          key={item.key}
          data-block={item.key}
          style={style}
          // No `title` while it is draggable — the browser's black tooltip over
          // a live drag is the same complaint the cards answered (flag 8).
          aria-label={item.label}
          onPointerDown={(e) => onBlockPointerDown(e, item, lane)}
          onPointerMove={onBlockPointerMove}
          onClick={(e) => {
            if (e.timeStamp < suppressClickUntil.current) return
            setBlockInfo({ kind: item.title, who: lane.label, whoLabel: lane.group === 'staff' ? '担当' : '設備', time: item.time, note: blockNote(item.title) })
            blockRef.current?.showModal()
          }}
        >
          {body}
        </button>
      ) : (
        // …and canon answers the press it refuses (fable-store-today.html :4409
        // binds pointerdown on every .event.absence): the hatch says where the
        // change belongs instead of going silent under the not-allowed cursor.
        <span
          className={`event ${cls}${item.micro ? ' micro' : ''}`}
          key={item.key}
          style={style}
          role="note"
          title={item.label}
          aria-label={item.label}
          onPointerDown={locked ? () => show(locked) : undefined}
        >
          {body}
        </span>
      )
    }
    const isPending = pending?.id === item.caseId
    return (
      <button
        // NO `title` ON A DRAGGABLE CARD. The browser's own black tooltip fired
        // in the middle of a drag and sat over the board (Liam, 2026-08-20);
        // the sentence is not lost, it is the card's accessible name, which is
        // where the screen reader was already reading it from. DEVIATION FROM
        // CANON, deliberately: canon's cards do carry `title`, and canon only
        // gets away with it because its drags never break — a tooltip cannot
        // appear while a button is held. Ours must not depend on that.
        // ⚖ Liam flag 29 — `dragging` is the ORIGIN MARKER of a card that left
        // (opacity .32); a card being stretched never left, so it wears canon's
        // live resize look instead of dimming to a husk.
        className={`event ${state}${selected === item.caseId ? ' selected' : ''}${live?.id === item.caseId ? (live.mode === 'move' ? ' dragging' : ' resizing') : ''}${isPending ? ' pending' : ''}`}
        type="button"
        key={item.key}
        data-book={item.caseId ?? undefined}
        style={style}
        data-cat={item.category ?? undefined}
        aria-label={item.label}
        aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight Alt+ArrowLeft Alt+ArrowRight"
        aria-describedby="boardKeyHelp"
        onPointerDown={(e) => onCardPointerDown(e, item, lane)}
        onKeyDown={(e) => onCardKeyDown(e, item, lane)}
      >
        {cardFace(item, settledHere)}
        {/* The grips say what they do through the card's own 操作ヒント and the
            cursor; a `title` here is the same mid-drag tooltip as above. */}
        <span className="event-resize-grip left" aria-hidden="true" />
        <span className="event-resize-grip right" aria-hidden="true" />
      </button>
    )
  }

  /** The card's FACE — name, tag, time, ticket line. Shared with the drag proxy
   *  so what travels under the cursor is the visual he grabbed, to the character,
   *  rather than a second rendering of the same booking that can drift from it. */
  function cardFace(item: BoardItem, settledHere: boolean) {
    return (
      <>
        <strong>
          {item.title}
          <i className="tg">{item.tag}</i>
        </strong>
        <small className="e-time">{item.time}</small>
        <small className="e-tkt">
          {item.ticketCat && <span className="tkt-cat">{item.ticketCat} </span>}
          <span className="tkt-core">{settledHere ? '精算済' : item.ticketCore}</span>
          {item.held && <span className="tkt-note">保持</span>}
        </small>
      </>
    )
  }

  function blockNote(kind: string) {
    return dialogs.blocks.find((b) => b.kind === kind)?.note ?? 'この時間は予約を入れられません。'
  }

  const liveClamp = clampPriceInputs(hiInput, loInput, dialogs.pricing)
  const liveChanged = liveClamp.hi !== appliedPrice.hi || liveClamp.lo !== appliedPrice.lo

  return (
    <div className="page">
      {/* ── C: 本日の店舗状態 ─────────────────────────────────────────── */}
      <header
        className="ops-strip"
        aria-label="本日の店舗状態"
        data-guide-title="本日の店舗状態"
        data-guide="金額と未処理の集計。レジ当番・金額権限のある人にだけ表示されます。"
      >
        {/* Canon makes every stat an entrance to 売上・レジ. That screen is
            準備中, and a greyed-out button would dim the day's headline number
            to 45% — so the three cells whose drill-in is not built render as
            canon's plain (non-`.act`) cell instead: full strength, no promise.
            The three whose target IS on this screen stay entrances. */}
        <div className="register-cell" title="内訳は売上・レジ（準備中）で開きます">
          <span>本日の予約総額（未精算含む）</span>
          <b>{ops.total}</b>
        </div>
        <div className="register-cell" title="内訳は売上・レジ（準備中）で開きます">
          <span>精算済</span>
          <b>{settledCount}件</b>
        </div>
        <button className="register-cell act" type="button" onClick={() => setSelected(dialogs.checkout?.bookingId ?? null)}>
          <span>施術済み・精算待ち</span>
          <b className="warn">{awaitingCount}件</b>
        </button>
        <div className="register-cell" title="内訳は売上・レジ（準備中）で開きます">
          <span>現金差異</span>
          <b>{ops.cashDifference}</b>
        </div>
        <button className="register-cell act" type="button" onClick={() => listRef.current?.showModal()}>
          <span>未解決</span>
          <b className="warn">{unresolved}件</b>
        </button>
        <button className="register-cell ops-decisions" type="button" onClick={() => listRef.current?.showModal()}>
          <span>次に決めること</span>
          <b>{unresolved}件</b>
        </button>
        <div className="ops-right">
          <span className="chip ok">Reserve 正常 {ops.syncLabel}</span>
          <span className="chip warn">通知未達 {ops.undelivered}件</span>
          <span className="chip ok">公開中 {sell.staffBands.length}枠</span>
          <button className="btn" type="button" onClick={() => closingRef.current?.showModal()}>閉店準備を確認</button>
        </div>
      </header>

      {/* ── D: 自分の1日 ─────────────────────────────────────────────── */}
      {props.myDay && (
        <header
          className="ops-strip"
          aria-label="自分の1日"
          data-guide-title="自分の1日"
          data-guide="ログイン中のスタッフ専用。次のお客様と自分の未処理だけを表示します。"
        >
          <div className="register-cell"><span>次のお客様</span><b>{props.myDay.next}</b></div>
          <div className="register-cell">
            <span>自分の未処理</span>
            <b className={props.myDay.pendingWarn ? 'warn' : undefined}>{props.myDay.pending}</b>
          </div>
          <div className="register-cell"><span>本日の担当</span><b>{props.myDay.todayCount}</b></div>
          <div className="ops-right">
            <span className="chip ok">{props.myDay.shift}</span>
            <span className="chip">{props.myDay.break}</span>
          </div>
        </header>
      )}

      <div className="workspace">
        <section className="panel board" aria-labelledby="boardTitle">
          <div className="board-head">
            <div className="bh-left">
              <strong id="boardTitle">本日の予約と販売可能枠</strong>

              <span className="fields-pop-wrap" data-pop="shelf">
                <button
                  type="button"
                  className="online-chip"
                  aria-expanded={pop === 'shelf'}
                  data-guide-title="オンライン販売中"
                  data-guide="いまReserveで販売中の枠数。押すと枠の一覧（時間・担当・価格）が開き、行を押すとボード上の場所を示します。"
                  hidden={sellMode === 'off'}
                  onClick={() => setPop((p) => (p === 'shelf' ? '' : 'shelf'))}
                >
                  {sell.chipLabel}
                </button>
                {pop === 'shelf' && (
                  <div className="fields-pop sell-shelf" aria-label="販売可能枠の一覧">
                    <strong>販売可能枠 {sell.staffBands.length}窓</strong>
                    {sell.staffBands.map((b) => (
                      <button
                        key={`${b.laneKey}-${b.hStart}`}
                        type="button"
                        onClick={() => { setPop(''); show(`${hhmm(b.hStart)}–${hhmm(b.hEnd)} · ${b.staff} — この枠は${props.lensLabel}のボード上にあります`) }}
                      >
                        {hhmm(b.hStart)}–{hhmm(b.hEnd)} · {b.staff} · {b.lo == null ? '価格未設定' : b.lo === b.hi ? money(b.lo) : `${money(b.lo)}〜${money(b.hi!)}`}
                      </button>
                    ))}
                    {sell.staffBands.length === 0 && <span>販売中の枠はありません</span>}
                  </div>
                )}
              </span>

              <div className="fields-pop-wrap" data-pop="help">
                <button
                  type="button"
                  className="help-toggle"
                  aria-expanded={pop === 'help'}
                  aria-label="操作ヒント"
                  onClick={() => setPop((p) => (p === 'help' ? '' : 'help'))}
                >
                  ?
                </button>
                {pop === 'help' && (
                  <div className="fields-pop help-pop">
                    <strong>操作ヒント</strong>
                    <span>営業時間 {hhmm(hours.open)}–{hhmm(hours.close)}・時間外は非表示</span>
                    <span>カードはドラッグで移動・両端で時間変更</span>
                    <span>キーボード: Shift＋←/→で開始、Alt＋←/→で終了を30分ずつ変更</span>
                    <span>仮置きエリア（ボード上の点線バー）: 日付をまたいで予約を変更したい場合は、一旦このエリアに置いてください。置いた予約は仮押さえになります。</span>
                    {/* ⚖ Liam flag 26 — the block gesture, said where the other
                        gestures are said. Its lattice differs from a予約's, and
                        an operator who does not know that reads the finer snap
                        as the board being imprecise. */}
                    <span>休憩・清掃などの予定ブロック: ドラッグで移動・両端で時間変更（{props.guard.config.blockStepMin ?? 5}分きざみ）・クリックでブロック情報</span>
                    {/* ⚖ Liam flag 25 — the length-matched emphasis has no region
                        of its own to spotlight (it is a property of every window
                        on the board), so it registers HERE, in the 操作ヒント
                        layer, rather than as a tour step pointing at nothing. */}
                    <span>ドラッグ中は、いま持っているカードと同じ長さの販売可能枠だけが濃く表示されます</span>
                    <button className="btn" type="button" onClick={() => { setPop(''); setTourIdx(0) }}>画面の説明を表示</button>
                  </div>
                )}
              </div>

              {props.inStore && (
                <div
                  className="session-chip"
                  data-guide-title="ご来店中"
                  data-guide="いま店内にいるお客様。ここから次回予約をその場で作成できます。"
                >
                  <i aria-hidden="true" />
                  ご来店中: {props.inStore.name}様（施術済み・精算待ち）
                  <button className="btn text" type="button" onClick={armNextVisit}>次回予約を作成</button>
                </div>
              )}
            </div>

            <div className="board-tools">
              <div
                className="time-nav date-nav"
                role="group"
                aria-label="日付の移動"
                data-pop="cal"
                data-guide-title="日付の移動"
                data-guide="日付を押すと月カレンダーで空き状況を確認できます。"
              >
                <Link href={dayHref(props.dayOffset - 1)} aria-label="前の日へ" prefetch={false}>‹</Link>
                <button
                  type="button"
                  className="day-label"
                  aria-haspopup="true"
                  aria-expanded={pop === 'cal'}
                  onClick={() => setPop((p) => (p === 'cal' ? '' : 'cal'))}
                >
                  {props.dayLabel}
                </button>
                <Link href={dayHref(props.dayOffset + 1)} aria-label="次の日へ" prefetch={false}>›</Link>
                {pop === 'cal' && (
                  <div className="cal-pop">
                    <div className="cal-head">
                      <strong>{monthCells.y}年{monthCells.m}月</strong>
                      <span className="cal-tools">
                        <Link href={dayHref(0)} onClick={() => setPop('')}>今日</Link>
                        <button type="button" aria-label="前の月" onClick={() => setCalMonth((m) => m - 1)}>‹</button>
                        <button type="button" aria-label="次の月" onClick={() => setCalMonth((m) => m + 1)}>›</button>
                      </span>
                    </div>
                    <div className="cal-grid">
                      {WD.map((w, i) => (
                        <span className={`wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`} key={w}>{w}</span>
                      ))}
                      {Array.from({ length: monthCells.lead }, (_, i) => <span key={`lead-${i}`} />)}
                      {monthCells.days.map((d) => (
                        <Link
                          key={`${d.y}-${d.m}-${d.d}`}
                          href={dayHref(d.offset)}
                          className={`cal-cell ${d.closed ? 'closedday' : d.free > 0 ? 'open' : 'full'}${d.offset === props.dayOffset ? ' cur' : ''}${d.offset === 0 ? ' today' : ''}`}
                          aria-label={`${d.m}月${d.d}日${d.closed ? '、定休日' : d.free === 0 ? '、空きなし' : `、空き枠${d.free}件`}`}
                          onClick={() => setPop('')}
                        >
                          <b>{d.d}</b>
                          <small>{d.closed ? '定休' : d.free > 0 ? d.free : '満'}</small>
                        </Link>
                      ))}
                    </div>
                    <div className="cal-legend">数字＝その日の空き枠 ・ 満＝空きなし ・ 定休＝定休日（{props.closedWeekdayLabel}）</div>
                  </div>
                )}
              </div>

              <div className="fields-pop-wrap" data-pop="fields">
                <button
                  ref={fieldsBtnRef}
                  type="button"
                  className="btn text"
                  aria-expanded={pop === 'fields'}
                  data-guide-title="表示設定"
                  data-guide="カード・販売可能枠・配置ガイドの見え方と、ボードの密度を調整します。"
                  onClick={() => setPop((p) => (p === 'fields' ? '' : 'fields'))}
                >
                  表示設定
                </button>
                {pop === 'fields' && (
                  <div className="fields-pop" ref={fieldsPopRef}>
                    <strong>予約カードの表示項目（店舗設定）</strong>
                    <label><input type="checkbox" checked={showTime} onChange={() => setShowTime((v) => !v)} /> 時間・メニュー</label>
                    <label><input type="checkbox" checked={showTicket} onChange={() => setShowTicket((v) => !v)} /> チケット・価格</label>
                    <label><input type="checkbox" checked={showSlotPrice} onChange={() => setShowSlotPrice((v) => !v)} /> 空き枠の価格（Reserve動的価格ON時）</label>

                    <strong>販売可能枠の表示（店舗設定・業種プロファイルが初期値）</strong>
                    <div className="density-seg" role="group" aria-label="販売可能枠の表示">
                      {([['tint', '淡色表示'], ['drag', 'ドラッグ時のみ'], ['off', '非表示']] as const).map(([k, label]) => (
                        <button key={k} type="button" aria-pressed={sellMode === k} onClick={() => setSellMode(k)}>{label}</button>
                      ))}
                    </div>
                    {/* ⚖ Liam flag 27: canon's degrade caption (:1809) is GONE with
                        the valve that raised it — a note explaining why the board
                        stopped honouring the setting has nothing left to explain. */}
                    <span>お客様名は常に表示 / 全ボード共通の店舗設定</span>

                    <div className="pop-divider" role="presentation" />
                    <strong>スキマガードの配置ガイド（自分の表示）</strong>
                    <div className="density-seg" role="group" aria-label="スキマガードの配置ガイドの表示">
                      {([['selected', '選択中は表示'], ['drag', 'ドラッグ中のみ'], ['hidden', '非表示']] as const).map(([k, label]) => (
                        <button key={k} type="button" aria-pressed={guideMode === k} onClick={() => setGuideMode(k)}>{label}</button>
                      ))}
                    </div>
                    <span className="guard-guide-copy">
                      {guideMode === 'selected'
                        ? '予約を選んだ時点で、置ける場所を細いガイドに表示します。表示だけの個人設定で、保護ルールは停止しません。'
                        : guideMode === 'drag'
                          ? '予約をドラッグしている間だけ、細い配置ガイドを表示します。表示だけの個人設定で、保護ルールは停止しません。'
                          : '細い配置ガイドを隠します。表示だけの個人設定で、保護ルールは停止しません。'}
                    </span>
                    <div className="guard-guide-key" aria-label="配置ガイドの記号の意味">
                      <b>紫 ✓ 空きを減らさない</b><b>橙 △ 空きが減るが置ける</b><b>灰 — 置けない</b>
                    </div>
                    <span className="guard-guide-copy">非表示にしても、店舗のスキマガード保護ルールは変わりません。</span>
                    <div className="guard-guide-policy">
                      {/* canon `renderGapGuardPolicySummary` (:5931): the STORE's
                          policy, read-only. The segment above is the operator's
                          own display preference and cannot move this line. */}
                      <span>保護ルール: {POLICY_WORD[props.guard.mode]}</span>
                      <span className="chip">店舗設定は準備中</span>
                    </div>

                    <div className="pop-divider" role="presentation" />
                    <strong>色の意味</strong>
                    <div className="legend" aria-label="予約状態の色の意味">
                      <span><i />確定・施術</span>
                      <span className="needs"><i />要対応</span>
                      <span className="hold"><i />仮押さえ</span>
                      <span className="public"><i />販売可能</span>
                      <span className="gapfill"><i />スキマ枠</span>
                      {guardOn && <span className="guard"><i />スキマガード</span>}
                      <span className="cat-legend" aria-label="店舗設定の予約カテゴリー色">
                        <i className="cat" style={{ '--cat': '#3d7ab8' } as React.CSSProperties} />新規
                        <i className="cat" style={{ '--cat': '#8a63b8' } as React.CSSProperties} />再来
                        <i className="cat" style={{ '--cat': '#2f8f8f' } as React.CSSProperties} />回数券
                        <i className="cat" style={{ '--cat': '#3f3f46' } as React.CSSProperties} />VIP
                      </span>
                      <b>左端の色＝店舗カテゴリー / 状態の色は変更できません</b>
                    </div>

                    <div className="pop-divider" role="presentation" />
                    <strong>密度</strong>
                    <div className="density-seg" role="group" aria-label="ボードの密度">
                      {([['std', '標準'], ['compact', 'コンパクト']] as const).map(([k, label]) => (
                        <button key={k} type="button" aria-pressed={density === k} onClick={() => setDensity(k)}>{label}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div
                className="segmented"
                role="group"
                aria-label="ボード表示"
                data-guide-title="表示の切替"
                data-guide="スタッフだけ・設備だけ・両方の表示を切り替えます。"
              >
                {([['both', '両方'], ['staff', 'スタッフ'], ['beds', '設備']] as const).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* 守るもの — canon's #guardDemoHonesty band (:1855), verbatim. It
              only exists while the store's protection policy is on, and the
              guide's own 非表示 setting never removes it: the legend explains a
              RULE that is still running, not the strip that draws it. */}
          {guardOn && (
            <div
              className="guard-band"
              role="note"
              data-guide-title="スキマガード"
              data-guide="新規のお客様のための時間を守る仕組みです。記号の意味はこの帯に、各スタッフの「60分配置」の細い帯には、その時間に60分の施術を始めた場合の判定が並びます。"
            >
              <span className="protected-key">守るもの: {props.guard.protectedLabel}{props.guard.protectedDurationMin}分</span>
              <span className="guard-key">紫 ✓ = 空きを減らさない</span>
              <span className="guard-key degraded-key">橙 △ = 空きが減るが置ける（損を減らす）</span>
              <span className="guard-key blocked-key">灰 — = 置けません</span>
              <span className="guard-band-note">
                {guideMode === 'selected'
                  ? '下の「60分配置」で、ドラッグ前に全開始を確認できます。'
                  : guideMode === 'drag'
                    ? '下の「60分配置」は、ドラッグ中だけ表示します。'
                    : '細い配置ガイドは非表示です。ドラッグ中の判定と店舗の保護ルールは残ります。'}
              </span>
            </div>
          )}

          <div className="board-body">
            <div className="board-main">
              {/* 仮置きエリア — the whole bar is the drop zone (canon R18). */}
              <div
                className={`park-shelf${live?.overShelf ? ' over' : ''}`}
                ref={shelfRef}
                aria-label="仮置きエリア。日付をまたいだ変更のための一時置き場"
                data-guide-title="仮置きエリア"
                data-guide="日付をまたぐ変更の一時置き場。ドラッグで置くと仮押さえになります。"
                title="日付をまたいで予約を変更したい場合は、一旦このエリアに置いてください。置いた予約は仮押さえになります。"
              >
                <div className="park-label"><strong>仮置きエリア</strong><span>ドラッグでここへ（日付またぎ・置くと仮押さえ）</span></div>
                <div className="park-chips">
                  {parkChips.map((chip) => (
                    <div
                      className="park-chip"
                      key={chip.id}
                      style={chip.category ? ({ '--cat': CAT_COLOR[chip.category] } as React.CSSProperties) : undefined}
                      onPointerDown={(e) => onChipPointerDown(e, chip.id)}
                      onPointerMove={onChipPointerMove}
                      onPointerUp={onChipPointerUp}
                      onPointerCancel={clearChipDrag}
                    >
                      <strong>{chip.title}</strong>
                      <span className="pc-line1">{chip.line1}</span>
                      <span className="pc-line2">{chip.line2}</span>
                      <button className="park-x" type="button" aria-label="元の枠に戻す" onClick={(e) => { e.stopPropagation(); unpark(chip.id) }}>×</button>
                    </div>
                  ))}
                </div>
                {/* canon `#placingNote` (:1866), inside the shelf next to the
                    chips — 配置モード is the same "something is in your hand"
                    state the shelf already describes, so it says so in the same
                    place, with the same × to put it down. */}
                {placing && (
                  <div className="placing-note" role="status">
                    <strong>{placing.label}</strong>
                    <span>置きたい日へ移動して、空き枠をクリック</span>
                    <button className="park-x" type="button" aria-label="配置モードをやめる" onClick={() => setPlacing(null)}>×</button>
                  </div>
                )}
              </div>
              <div
                className="timeline-scroll"
                tabIndex={0}
                aria-label={`営業時間${hhmm(hours.open)}から${hhmm(hours.close)}の予約ボード`}
                data-guide-title="今日のボード"
                data-guide="空き枠をクリックで新規予約。カードはドラッグで移動、端をつかんで時間変更。"
              >
                <div
                  className={timelineClasses}
                  ref={boardRef}
                  style={{ '--hours': hours.count, '--now': props.nowFraction ?? 0 } as React.CSSProperties}
                  // ⚖ Liam flag 33 — canon's singleton, at the one place every
                  // board gesture starts (capture, so a card's own handler
                  // cannot get there first).
                  onPointerDownCapture={closeAdvice}
                >
                  {props.nowFraction != null && <div className="elapsed-wash" aria-hidden="true" />}
                  <div className="time-head">
                    <span>
                      時間
                      {/* ⚖ Liam flag 24 — the name column's width handle. */}
                      <i
                        className="label-resize"
                        title="ドラッグで名前列の幅を調整"
                        aria-hidden="true"
                        onPointerDown={onLabelResizeDown}
                      />
                    </span>
                    <div className="hours">
                      {hours.labels.map((h) => <span key={h}>{h}</span>)}
                    </div>
                  </div>

                  {(['staff', 'beds'] as const).map((group) => {
                    if (view !== 'both' && view !== group) return null
                    const groupLanes = drawnLanes.filter((l) => l.group === group)
                    if (groupLanes.length === 0) return null
                    return (
                      <div key={group}>
                        <button
                          className={`group-label${collapsed.includes(group) ? ' collapsed' : ''}`}
                          type="button"
                          aria-expanded={!collapsed.includes(group)}
                          onClick={() => setCollapsed((was) => toggle(was, group))}
                        >
                          <span>{group === 'staff' ? 'スタッフ' : 'ベッド・設備'}</span>
                          <span>{group === 'staff' ? '勤務・資格・休憩を含む' : '清掃を予約不可時間として表示'}</span>
                        </button>
                        {groupLanes.map(renderLane)}
                      </div>
                    )
                  })}

                  {props.nowFraction != null && (
                    <div className="now-line"><span>{props.nowLabel}</span></div>
                  )}
                  {/* canon sets this as the cards' aria-description (:3865).
                      `aria-description` is not a real ARIA property, so the same
                      sentence rides a described-by target every card points at. */}
                  <p id="boardKeyHelp" className="board-keyhelp">
                    キーボード操作: Shiftと左右矢印で開始時刻、Altと左右矢印で終了時刻を30分ずつ変更します
                  </p>
                </div>
              </div>
            </div>

            {/* ── G: inspector drawer ─────────────────────────────────── */}
            {currentCase && (
              <aside className="panel inspector" aria-labelledby="caseTitle">
                <div className="inspector-head">
                  <button className="close inspector-close" type="button" aria-label="詳細を閉じる" onClick={() => setSelected(null)}>×</button>
                  <div className="inspector-kicker">{currentCase.kicker}</div>
                  <h2 id="caseTitle">{currentCase.title}</h2>
                  <p>{currentCase.meta}</p>
                </div>
                <div className="inspector-body">
                  <div className="status-row">
                    <span className={`status ${currentCase.statusTone}`}>
                      {currentCase.bookingId && settled.includes(currentCase.bookingId) ? '精算済' : currentCase.status}
                    </span>
                    <span className="source">{currentCase.source}</span>
                  </div>
                  <div className="facts">
                    {currentCase.facts.map(([k, v]) => (
                      <div className="fact" key={k}><span>{k}</span><b>{v}</b></div>
                    ))}
                  </div>
                  <div className="proof-box">
                    <strong>{currentCase.proofTitle}</strong>
                    {currentCase.proofs.map((p) => <div className="proof-line" key={p}>{p}</div>)}
                  </div>
                  {currentCase.price && <div className="price-proof">{currentCase.price}</div>}
                  <div className="inspector-actions">
                    {currentCase.primary === '精算を開く' ? (
                      <button className="btn primary" type="button" onClick={() => checkoutRef.current?.showModal()}>精算を開く</button>
                    ) : currentCase.primary === '変更案を確認' ? (
                      <button className="btn primary" type="button" onClick={() => recoveryRef.current?.showModal()}>変更案を確認</button>
                    ) : currentCase.primary === 'Reserveの受付と価格' ? (
                      <button className="btn primary" type="button" onClick={() => reserveRef.current?.showModal()}>Reserveの受付と価格</button>
                    ) : (
                      <button className="btn primary" type="button" disabled title={HINT}>この予約を編集</button>
                    )}
                    <button className="btn" type="button" disabled title="カルテ連携は準備中です">カルテを開く（準備中）</button>
                    <button className="btn" type="button" disabled title={HINT}>別の案</button>
                    <button className="btn danger delete" type="button" disabled title={HINT}>予約を取消</button>
                  </div>
                </div>
              </aside>
            )}
          </div>
        </section>

        {/* ── H: the 仮押さえ confirm is no longer here. ⚖ Liam flag 34 — it
            hangs under the card it answers for, at the end of this file with the
            board's other fixed-layer surfaces. */}
      </div>

      {/* ── I: 本日の運営影響 ─────────────────────────────────────────── */}
      {props.incident && (
        <section
          className="incident"
          aria-label="本日の運営影響"
          data-guide-title="本日の運営影響"
          data-guide="いま起きている問題と、対応がどこまで進んだかを示します。"
        >
          <div className="incident-main">
            <span className="incident-icon" aria-hidden="true">!</span>
            <span>
              <strong>{props.incident.staffName}さん、本日{props.incident.from}以降は勤務不可</strong>
              <span>影響する公開枠は停止済み。既存予約の価格は保持されます。</span>
            </span>
          </div>
          <div className="incident-stat"><span>影響</span><b>{props.incident.affected}</b></div>
          <div className="incident-stat"><span>未判断</span><b className="warn">{props.incident.undecided}件</b></div>
          <div className="incident-stat"><span>連絡待ち</span><b>{proposalSent ? 0 : props.incident.waitingContact}件</b></div>
          <div className="incident-stat"><span>安全な空き</span><b>{sell.staffBands.length}枠</b></div>
          <div className="incident-action">
            <button className="btn" type="button" onClick={() => setSelected(props.incident!.caseId)}>影響を確認</button>
          </div>
          <div className="incident-steps" aria-label="復旧の安全手順">
            {props.incident.steps.map((step, i) => {
              const done =
                (i === 0 && props.incident!.intakeStopped) ||
                (i === 1 && props.hold != null) ||
                (i === 2 && proposalSent)
              const value = i === 0 ? '済' : i === 1 ? (props.hold ? '仮押さえ済' : '案未送信') : i === 2 ? (proposalSent ? '送信済み' : '未送信') : '待機'
              return (
                <span key={step}>
                  <span className={`step${done ? ' done' : ''}`}>{step} <b>{value}</b></span>
                  {i < props.incident!.steps.length - 1 && <span className="arrow" aria-hidden="true">→</span>}
                </span>
              )
            })}
          </div>
        </section>
      )}

      {/* ── J: 次に決めること ─────────────────────────────────────────── */}
      <section
        className="decision-section"
        aria-labelledby="decisionTitle"
        data-guide-title="次に決めること"
        data-guide="根拠と期限のある判断だけが並びます。上の件数セルを押すと該当カードがボード上で光ります。"
      >
        <div className="section-head">
          <strong id="decisionTitle">次に決めること</strong>
          <div className="section-tools">
            <span>根拠・期限・次の操作がある判断だけを表示</span>
            <button className="btn text" type="button" onClick={() => listRef.current?.showModal()}>判断と閉店阻害</button>
          </div>
        </div>
        <div className="decision-grid">
          {openCards.map((c) => (
            <button
              className={`decision-card${c.urgent ? ' urgent' : ''}`}
              type="button"
              key={c.id}
              aria-current={selected === c.id}
              onClick={() => setSelected(c.id)}
            >
              <span className="decision-top">
                <span>{c.kind}</span>
                <span className={`decision-deadline ${c.deadlineTone}`}>{c.deadline}</span>
              </span>
              <h2>{c.title}</h2>
              <p>{c.detail}</p>
              <span className="decision-evidence">
                {c.evidence.map(([k, v]) => <span key={k}>{k} <b>{v}</b></span>)}
              </span>
            </button>
          ))}
          {openCards.length === 0 && (
            <div className="decision-card"><h2>いま決めることはありません</h2><p>期限のある判断が出ると、ここに並びます。</p></div>
          )}
        </div>
      </section>

      {/* ── K: 店舗全体の指標 ─────────────────────────────────────────── */}
      <section
        className="decision-section"
        aria-labelledby="kpiStripTitle"
        data-guide-title="店舗全体の指標"
        data-guide="本日の予約件数・売上・稼働率。予約件数は本日の全予約、売上は売上・レジの取引データ、稼働率はスタッフ・シフトの勤務時間から算出しています。"
      >
        <div className="section-head">
          <strong id="kpiStripTitle">店舗全体の指標</strong>
          <div className="section-tools"><span>{props.kpi.note}</span></div>
        </div>
        <div className="kpi-strip">
          <div className="register-cell"><span>本日の予約件数</span><b>{props.kpi.count}</b></div>
          <div className="register-cell"><span>売上（純売上）</span><b>{props.kpi.revenue}</b></div>
          <div className="register-cell"><span>稼働率（施術スタッフ）</span><b>{props.kpi.utilization}</b></div>
        </div>
      </section>

      {/* ── L: dialogs ───────────────────────────────────────────────── */}
      {dialogs.recovery && (
        <dialog className="biz-dialog" ref={recoveryRef} aria-labelledby="recoveryTitle">
          <div className="dialog-head">
            <div><h2 id="recoveryTitle">変更内容を確認</h2><p>予約、仮押さえ、連絡、監査記録をまとめて更新します</p></div>
            <button className="close" type="button" aria-label="閉じる" onClick={() => recoveryRef.current?.close()}>×</button>
          </div>
          <div className="dialog-body">
            <div className="change-list">
              {dialogs.recovery.rows.map(([k, v]) => (
                <div className="change-row" key={k}><span>{k}</span><b>{v}</b></div>
              ))}
            </div>
            <div className="guardrail">
              提案の送信では予約を確定移動しません。移動先を仮押さえし、お客様の承諾後にスタッフ枠・設備枠・予約を一つの処理で確定します。
            </div>
          </div>
          <div className="dialog-foot">
            <button className="btn" type="button" onClick={() => recoveryRef.current?.close()}>戻る</button>
            <button className="btn primary" type="button" disabled={proposalSent} onClick={sendProposal}>変更案を送信</button>
          </div>
        </dialog>
      )}

      {dialogs.checkout && (
        <dialog className="biz-dialog" ref={checkoutRef} aria-labelledby="checkoutTitle">
          <div className="dialog-head">
            <div><h2 id="checkoutTitle">{dialogs.checkout.title}</h2><p>{dialogs.checkout.sub}</p></div>
            <button className="close" type="button" aria-label="閉じる" onClick={() => checkoutRef.current?.close()}>×</button>
          </div>
          <div className="dialog-body">
            <div className="change-list">
              {dialogs.checkout.rows.map(([k, v]) => (
                <div className="change-row" key={k}><span>{k}</span><b>{v}</b></div>
              ))}
            </div>
            <label style={{ marginTop: 12 }}>
              支払い方法
              <select defaultValue="クレジットカード">
                <option>クレジットカード</option>
                <option>現金</option>
                <option>QR決済</option>
              </select>
            </label>
          </div>
          <div className="dialog-foot">
            <button className="btn" type="button" onClick={() => checkoutRef.current?.close()}>戻る</button>
            <button
              className="btn primary"
              type="button"
              disabled={settled.includes(dialogs.checkout.bookingId)}
              onClick={settle}
            >
              {dialogs.checkout.amount}を精算
            </button>
          </div>
        </dialog>
      )}

      <dialog className="biz-dialog" ref={reserveRef} aria-labelledby="reserveTitle">
        <div className="dialog-head">
          <div><h2 id="reserveTitle">Reserveの受付と価格</h2><p>安全に販売できる枠だけを、新しい単発オンライン予約へ公開</p></div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => reserveRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          {/* The −30% clause is COMPUTED from the same clamp the inputs obey
              (canon `clampPriceInputs`), so the sentence and the guardrail can
              never disagree about where the floor is. */}
          <div className="guardrail" style={{ marginTop: 0 }}>
            <b>対象：</b>新しい単発オンライン予約のみ。回数券、VIP、電話、店頭、確定済み予約、振替は対象外です。
            {props.lensLabel}は最高価格をHQ範囲（{yen(dialogs.pricing.hqMin)}〜{yen(dialogs.pricing.hqMax)}）内、
            最低価格を最高価格の−{floorDiscountPercent(liveClamp.hi)}%までの範囲で設定できます。店長のみ変更できます。
          </div>
          <div className="range-row">
            <label>
              最高価格（この施術の定価）
              <input
                type="number"
                value={hiInput}
                min={dialogs.pricing.hqMin}
                max={dialogs.pricing.hqMax}
                step={10}
                onChange={(e) => setHiInput(Number(e.target.value))}
              />
            </label>
            <div className="range-value">{hqNote(liveClamp.hi, dialogs.pricing.hqMin)}</div>
          </div>
          <div className="range-row">
            <label>
              最低価格（空き時間帯の下限）
              <input
                type="number"
                value={loInput}
                min={liveClamp.floor}
                max={liveClamp.hi}
                step={10}
                onChange={(e) => setLoInput(Number(e.target.value))}
              />
            </label>
            <div className="range-value">{discountNote(liveClamp.hi, liveClamp.lo)}</div>
          </div>
          <div className="framing-block">
            <strong>価格の見せ方（店長設定）</strong>
            <div className="density-seg" role="group" aria-label="価格の見せ方">
              <button type="button" aria-pressed={framing === 'discount'} onClick={() => setFraming('discount')}>割引型（定価から引く）</button>
              <button type="button" aria-pressed={framing === 'markup'} onClick={() => setFraming('markup')}>加算型（基準に足す）</button>
            </div>
            <span className="framing-sample">{framingSample(liveClamp.hi, liveClamp.lo, framing)}</span>
          </div>
          {sell.staffBands.map((b) => (
            <div className="slot-row" key={`${b.laneKey}-${b.hStart}`}>
              <span><strong>{hhmm(b.hStart)}–{hhmm(b.hEnd)} / {b.staff}</strong><span>基準 {yen(dialogs.pricing.base)} / 10円単位四捨五入</span></span>
              <b>{b.lo == null ? '—' : b.lo === b.hi ? money(b.lo) : `${money(b.lo)}〜${money(b.hi!)}`}</b>
            </div>
          ))}
          <div className="change-list" style={{ marginTop: 12 }}>
            <div className="change-row"><span>既存予約</span><b>変更 0件</b></div>
            <div className="change-row"><span>保護対象</span><b>{dialogs.pricing.protectedLabel}</b></div>
            <div className="change-row"><span>ルール</span><b>{dialogs.pricing.version} / {dialogs.pricing.approvedAt} / {dialogs.pricing.approvedBy}承認</b></div>
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" onClick={() => reserveRef.current?.close()}>戻る</button>
          {/* canon `refreshPriceButton`: the caption is the STATE, and an
              unchanged dialog says so rather than offering a save. */}
          <button
            className="btn primary"
            type="button"
            disabled={sell.staffBands.length === 0 || !liveChanged}
            onClick={() => {
              setAppliedPrice({ hi: liveClamp.hi, lo: liveClamp.lo })
              reserveRef.current?.close()
              show(`${sell.staffBands.length}枠の公開価格をHQ範囲内で更新しました。再読み込みすると戻ります`)
            }}
          >
            {priceButtonCaption(sell.staffBands.length, liveChanged)}
          </button>
        </div>
      </dialog>

      <CreateDialog
        dialogRef={createRef}
        data={dialogs.create}
        hours={hours}
        seed={seed}
        onCreate={(laneKey, item, message) => {
          setAdded((was) => [...was, { ...board, laneKey, item }])
          show(message)
        }}
      />

      <dialog className="biz-dialog" ref={storeFrontRef} aria-labelledby="storeFrontTitle">
        <div className="dialog-head">
          <div><h2 id="storeFrontTitle">店頭予約を作成</h2><p>販売可能枠の人・設備・バッファを確認済み</p></div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => storeFrontRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          <div className="form-grid">
            <label>お名前<input type="text" placeholder="例：見本 はなこ" /></label>
            <label>
              空き枠
              <select defaultValue={dialogs.storeFront.slots[0]?.id}>
                {dialogs.storeFront.slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <div className="change-list">
            <div className="change-row"><span>コース</span><b>{dialogs.storeFront.slots[0]?.menuName ?? '—'}</b></div>
            <div className="change-row"><span>店頭予約価格</span><b>{dialogs.storeFront.slots[0]?.storePrice ?? '—'}</b></div>
            <div className="change-row"><span>Reserve公開価格</span><b>{dialogs.storeFront.slots[0]?.publicPrice ?? '—'}</b></div>
          </div>
          <div className="guardrail">動的価格は新しい単発オンライン予約だけに適用されます。この店頭予約には標準価格を使います。</div>
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" onClick={() => storeFrontRef.current?.close()}>戻る</button>
          <button className="btn primary" type="button" disabled title={HINT}>予約を作成</button>
        </div>
      </dialog>

      <dialog className="biz-dialog" ref={terminalRef} aria-labelledby="terminalTitle">
        <div className="dialog-head">
          <div><h2 id="terminalTitle">決済端末の保留を照合</h2><p>端末に保持され、レジに未反映の取引を確認してから反映します</p></div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => terminalRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          <div className="change-list">
            {dialogs.terminal.rows.map(([k, v]) => (
              <div className="change-row" key={k}><span>{k}</span><b>{v}</b></div>
            ))}
          </div>
          <div className="guardrail">端末の決済IDと予約を照合済みです。レジへ反映すると監査記録に操作者、元取引、予約、反映時刻を残します。</div>
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" onClick={() => terminalRef.current?.close()}>戻る</button>
          <button className="btn primary" type="button" disabled title={HINT}>レジへ反映して照合</button>
        </div>
      </dialog>

      <dialog className="biz-dialog" ref={blockRef} aria-labelledby="blockTitle">
        <div className="dialog-head">
          <div><h2 id="blockTitle">{blockInfo?.kind ?? '予定ブロック'}</h2><p>お客様・売上に影響しない予定です</p></div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => blockRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          <div className="change-list">
            <div className="change-row"><span>種別</span><b>{blockInfo?.kind ?? '—'}</b></div>
            <div className="change-row"><span>時間</span><b>{blockInfo?.time ?? '—'}</b></div>
            <div className="change-row"><span>{blockInfo?.whoLabel ?? '担当'}</span><b>{blockInfo?.who ?? '—'}</b></div>
          </div>
          <div className="guardrail">{blockInfo?.note ?? ''}</div>
        </div>
        <div className="dialog-foot">
          <button className="btn danger" type="button" disabled title={HINT}>削除</button>
          <button className="btn" type="button" onClick={() => blockRef.current?.close()}>閉じる</button>
          <button className="btn primary" type="button" disabled title={HINT}>保存</button>
        </div>
      </dialog>

      <dialog className="biz-dialog" ref={closingRef} aria-labelledby="closingTitle">
        <div className="dialog-head">
          <div><h2 id="closingTitle">{dialogs.closing.title}</h2><p>{dialogs.closing.sub}</p></div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => closingRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          {/* The checklist answers to the board: settling a booking clears its
              own line, so the dialog cannot keep blocking on work already done. */}
          {dialogs.closing.checks.map(([k, v, blocked]) => {
            const live = k === '精算' ? `未精算 ${awaitingCount}件` : k === '予約終了' && proposalSent ? '未連絡 0件' : v
            const stillBlocked = k === '精算' ? awaitingCount > 0 : k === '予約終了' ? !proposalSent && blocked : blocked
            return (
              <div className="close-check" key={k}><span>{k}</span><b className={stillBlocked ? 'blocked' : undefined}>{live}</b></div>
            )
          })}
          <div className="guardrail">下書きは保存できますが、未解決予約、未精算、端末差異が残る間は日次をロックできません。</div>
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" disabled title={HINT}>下書きを保存</button>
          <button className="btn primary" type="button" onClick={() => { closingRef.current?.close(); listRef.current?.showModal() }}>対応できる未完了へ</button>
        </div>
      </dialog>

      <dialog className="biz-dialog" ref={listRef} aria-labelledby="listTitle">
        <div className="dialog-head">
          <div><h2 id="listTitle">本日の判断と閉店阻害</h2><p>完了・返信待ちを含む全件。選ぶと詳細を表示します</p></div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => listRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          <div className="decision-rows">
            {props.cards.map((c) => {
              const done = resolved.includes(c.id) || c.state === 'resolved'
              return (
                <button
                  className="decision-row"
                  type="button"
                  key={c.id}
                  onClick={() => { listRef.current?.close(); setSelected(c.id) }}
                >
                  <span className={`status ${done ? 'done' : c.state === 'waiting' ? 'waiting' : c.statusTone}`}>
                    {done ? '完了' : c.state === 'waiting' ? '返信待ち' : '対応中'}
                  </span>
                  <span className="dr-main"><strong>{c.title}</strong><span>{c.detail}</span></span>
                  <em>{c.deadline}</em>
                </button>
              )
            })}
            {dialogs.blockers.map(([k, v]) => (
              <button className="decision-row" type="button" key={k} onClick={() => { listRef.current?.close(); terminalRef.current?.showModal() }}>
                <span className="status checkout">閉店阻害</span>
                <span className="dr-main"><strong>{k}</strong><span>{v}</span></span>
                <em>本日中</em>
              </button>
            ))}
          </div>
          <div className="guardrail">
            上の件数バッジは、対応中の判断カードだけを示します。この一覧には履歴として残る完了・返信待ちの判断に加え、決済端末と未精算の閉店阻害を別枠で含めます。
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" onClick={() => listRef.current?.close()}>閉じる</button>
        </div>
      </dialog>

      {/* 配置の相談 — canon `openGuardPopover` (:7106). The board says what the
          engine actually decided and offers the starts it would accept, as
          buttons that PERFORM the placement (⚖ 31c: この開始に配置 used to do
          nothing but close this popup — a button that lied about its own name).
          No position in the markup: it is measured and pinned before paint
          (⚖ 35), which is canon's own order of operations. */}
      {advice && (
        <div className="guard-pop" role="dialog" aria-label="配置の確認" ref={advicePopRef}>
          <div className="gp-reason">{advice.cell.sentence}</div>
          <div className="gp-offer">
            {advice.cell.alternatives.length === 0
              ? 'この区間に、より損の少ない開始はありません'
              : advice.cell.alternativeKind === 'least-loss'
                ? '空きを完全には守れません。より損の少ない開始を選べます'
                : '安全な開始を選んでください'}
          </div>
          {advice.cell.alternatives.length > 0 && (
            <div className="gp-alternatives">
              {advice.cell.alternatives.map((start) => (
                <button
                  className="gp-alt"
                  type="button"
                  key={start}
                  onClick={() => {
                    setAdvice(null)
                    advice.place(start)
                  }}
                >
                  {hhmm(start)} に置く{advice.cell.alternativeKind === 'least-loss' ? '（損を減らす）' : ''}
                </button>
              ))}
            </div>
          )}
          <div className="gp-actions">
            {/* やめる CLOSES. Nothing has been placed yet — the popup now opens
                BEFORE the placement, not after it, so there is nothing to undo
                (it used to call revertPending, which was the move path's). */}
            <button className="btn" type="button" onClick={() => setAdvice(null)}>やめる</button>
            {advice.cell.ackAllowed && (
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setAdvice(null)
                  advice.place(advice.start)
                }}
              >
                この開始に配置
              </button>
            )}
          </div>
        </div>
      )}

      {/* ⚖ Liam flag 39 — THE BLOCK-PLACEMENT ADVISOR. The block has already
          landed (advise, never refuse), so this asks about improving it, not
          about allowing it: the engine's own sentence, then the one click that
          takes its suggestion. Same surface grammar as the consult above and
          the same dismissal contract; positioned under the block by the layout
          effect, never over it. */}
      {blockAdvice && (
        <div
          className={`guard-pop block-advice${blockAdvicePinned ? ' pinned' : ''}`}
          role="dialog"
          aria-label="予定の位置の提案"
          ref={blockAdvicePopRef}
          // ⚖ FLAGS 25c, backlog — batch-5 shipped this surface without its
          // registration. A popover only exists while it is open, and the
          // registry is a live-document walk that drops what has no box, so it
          // explains itself exactly when the operator is looking at it.
          data-guide-title="予定の位置の提案"
          data-guide="休憩や清掃を置いた位置が新規のお客様の枠を分けてしまうとき、より良い位置を提案します。そのまま置くこともできます。"
        >
          <div className="gp-reason">{blockAdvice.cell.sentence}</div>
          {/* The consult's own two lines, with 開始 → 位置: this surface is
              answering for a box that is already down, not for a start being
              chosen. Nothing new is said — the verdict above is the engine's
              sentence verbatim. */}
          <div className="gp-offer">
            {blockAdvice.cell.alternativeKind === 'least-loss'
              ? '空きを完全には守れません。より損の少ない位置を選べます'
              : `${blockAdvice.title}は${hhmm(blockAdvice.suggest)}なら空きを分けずに置けます`}
          </div>
          <div className="gp-actions">
            <button className="gp-cancel" type="button" onClick={() => undoBlockDrop(blockAdvice)}>やめる</button>
            <button className="gp-cancel" type="button" onClick={() => setBlockAdvice(null)}>そのまま置く</button>
            <button
              className="btn primary"
              type="button"
              // The default answer: the operator dropped it, the board has a
              // better place for it, and one press is the whole correction.
              autoFocus
              onClick={() => takeBlockSuggestion(blockAdvice)}
            >
              提案位置に置く
            </button>
          </div>
        </div>
      )}

      {/* ⚖ Liam flag 34 — 仮押さえの確認, under the card it answers for, or as the
          always-visible pill when that card is not on screen. Same fixed layer,
          same fits-whole rule and the same clamp as the consult popup above. */}
      {holdPop && (
        <div
          className={`hold-pop${holdPinned ? ' pinned' : ''}`}
          ref={holdPopRef}
          role="region"
          aria-label="仮押さえの確認"
          // ⚖ FLAGS 25c, backlog — batch-4 moved the confirm from the bottom bar
          // to this popover and the registration did not come with it. The bar
          // it replaced was never a tour step either, which is how three rounds
          // went by with the count stuck at 14.
          data-guide-title="仮押さえの確認"
          data-guide="動かした予約はまず仮押さえになります。ここで内容を確認して確定するか、元に戻せます。再読み込みでも元に戻ります。"
        >
          <div className="hp-head">
            <span className={`status ${holdPop.tone}`}>{holdPop.status}</span>
            <strong>{holdPop.summary}</strong>
          </div>
          {/* canon's 日付ピン (:2048, :3675): the 仮押さえ outlives the day it was
              staged on, so on any other day it names its own day and offers the
              way back rather than sitting there answering for nothing.
              ⚖ 46 forerunner: it outlives the STORE too, so the pin names the
              store when that is what differs, and the way back carries the
              pending's OWN store — this store's `?store=` would land the
              operator on the right day of the wrong board. */}
          {pending && pendingOffBoard && (
            <span className="hold-daypin">
              <span>確定待ち: {sameStore(pending.store, props.storeParam) ? pending.dayLabel : `${pending.storeLabel} ${pending.dayLabel}`}</span>
              <Link href={dayHref(pending.dayOffset, pending.store)}>{pending.dayLabel}へ戻る</Link>
            </span>
          )}
          <div className="holdbar-checks">
            {holdPop.checks.map((c) => <span className={`ck${c.tone ? ` ${c.tone}` : ''}`} key={c.label}>{c.label}</span>)}
            {/* ⚖ 31b — the guard's move-assessment, where the operator is already
                reading. It reports; it never disables 確定. */}
            {holdPop.guardRow && <span className={`ck ${holdPop.guardRow.tone}`}>{holdPop.guardRow.label}</span>}
          </div>
          <div className="hp-actions">
            <button className="btn primary" type="button" disabled={!holdPop.confirm.enabled} onClick={holdPop.confirm.run}>{holdPop.confirm.label}</button>
            <button className="btn" type="button" disabled={!holdPop.revert.enabled} onClick={holdPop.revert.run}>元に戻す</button>
          </div>
        </div>
      )}

      {/* ⚖ Liam 19/20 — the card under the cursor. Board-level and `position:
          fixed`, so no lane, no track and no scroller can clip it and nothing on
          the board is re-parented to carry it. `aria-hidden`: the booking it
          copies is still on the board with its own accessible name, and a screen
          reader announcing the same card twice mid-gesture helps nobody. */}
      {proxy && (
        <div
          className={`drag-proxy${proxy.kind === 'chip' ? ' chip' : ` event ${proxy.state}`}`}
          ref={(el) => {
            proxyRef.current = el
            if (el) el.style.transform = proxyAt.current
          }}
          aria-hidden="true"
          data-cat={proxy.kind === 'chip' ? (proxy.category ?? undefined) : (proxy.item.category ?? undefined)}
          style={{ width: proxy.w, height: proxy.h }}
        >
          {proxy.kind === 'chip' ? (
            <>
              <strong>{proxy.title}</strong>
              <small>{proxy.line1}</small>
            </>
          ) : proxy.kind === 'block' ? (
            // The block's own face, not a card's: it has no ticket and no
            // customer, and a micro carries no time label on the board either.
            <>
              <strong>{proxy.item.title}</strong>
              {!proxy.item.micro && <small>{proxy.item.time}</small>}
            </>
          ) : (
            cardFace(proxy.item, proxy.item.caseId != null && settled.includes(proxy.item.caseId))
          )}
        </div>
      )}

      {/* ⚖ Liam flag 25 — 画面の説明. Canon's four layers, in canon's order:
          the click catcher, the hover outline, the spotlight hole, the card. */}
      {tourIdx >= 0 && (
        <>
          <div
            className="spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              // canon (:3419): a click on nothing registered ends the tour —
              // the dim layer behaves like the scrim it looks like.
              if (hit >= 0) setTourIdx(hit)
              else setTourIdx(-1)
            }}
            onMouseMove={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourHover(hit >= 0 && hit !== tourStep?.idx ? tourRectsRef.current[hit] : null)
            }}
          />
          {tourHover && (
            <div
              className="spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="spot-card"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="spot-text">{tourStep?.text ?? ''}</span>
            <div className="spot-hint">気になる場所をクリックすると、その説明にジャンプします</div>
            <div className="spot-foot">
              <button type="button" className="spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="spot-next" onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}

      {/* ⚖ Liam flag 47 — the same one node. `n` lives in the state object so a
          refusal earned twice in a row is a NEW value and re-arms the dwell
          timer; the node itself is never remounted, because remounting it would
          cost the fade the rest of this board's surfaces all have. */}
      <div className={`toast${toast.text ? ' show' : ''}`} role="status" aria-live="polite" aria-atomic="true">{toast.text}</div>
    </div>
  )
}

/** canon `renderGapGuardPolicySummary` (:5938). */
const POLICY_WORD: Record<'off' | 'standard' | 'strict', string> = { off: 'オフ', standard: '標準', strict: '厳格' }

const CAT_COLOR: Record<string, string> = { new: '#3d7ab8', repeat: '#8a63b8', ticket: '#2f8f8f', vip: '#3f3f46' }

/** canon `renderHoldBar`'s summary line (:4769): who, when, on whom, on what. */
function holdSummary(lanes: BoardLane[], id: string, at: Move | undefined, hours: { open: number; close: number }): string {
  if (!at) return ''
  const staffLane = lanes.find((l) => l.group === 'staff' && l.items.some((i) => i.caseId === id))
  const bedLane = lanes.find((l) => l.group === 'beds' && l.items.some((i) => i.caseId === id))
  const item = staffLane?.items.find((i) => i.caseId === id) ?? bedLane?.items.find((i) => i.caseId === id)
  const from = minuteOf(at.x, hours)
  const to = minuteOf(at.x + at.w, hours)
  return `${item?.title ?? ''}様 → ${hhmm(from)}〜${hhmm(to)} / 担当 ${staffLane?.label ?? '—'} / ${bedLane?.label ?? '—'}`
}

/** L4 新規予約を作成 — canon's two-column dialog: the steps on the left, the
 *  ticket that assembles itself on the right. Confirming puts a real card on
 *  the board in client state (canon's own transition), and the toast says it
 *  disappears on reload. */
function CreateDialog({
  dialogRef,
  data,
  hours,
  seed,
  onCreate,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>
  data: TodayProps['dialogs']['create']
  hours: TodayProps['hours']
  seed: { staffId: string; start: number; nonce: number } | null
  onCreate: (laneKey: string, item: BoardItem, message: string) => void
}) {
  const [tab, setTab] = useState<'book' | 'block'>('book')
  const [start, setStart] = useState(hours.open + 6 * 60 >= hours.close ? hours.open : hours.open + 6 * 60)
  const [staffId, setStaffId] = useState(data.staff[0]?.id ?? '')
  const [search, setSearch] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(data.menus[0]?.id ?? null)
  const [source, setSource] = useState(data.sources[0])
  const [memo, setMemo] = useState('')
  const [blockKind, setBlockKind] = useState(data.blockKinds[0])
  const [blockLength, setBlockLength] = useState(data.blockLengths[0] ?? 30)
  const [error, setError] = useState('')
  /** canon's ＋新規顧客 step (:6499): a customer who is not in the book yet gets
   *  registered here rather than sending the operator to another screen. */
  const [newCustomer, setNewCustomer] = useState<{ name: string; phone: string; kana: string; gender: string } | null>(null)
  const [localCustomers, setLocalCustomers] = useState<TodayProps['dialogs']['create']['customers']>([])

  // An empty-slot click re-seeds the dialog; anything the operator already
  // typed is left alone (only the two fields the click actually names move).
  useEffect(() => {
    if (!seed) return
    setStaffId(seed.staffId)
    setStart(Math.max(hours.open, Math.min(hours.close - 30, seed.start)))
    setTab('book')
  }, [seed, hours.open, hours.close])

  const everyone = useMemo(() => [...localCustomers, ...data.customers], [localCustomers, data.customers])
  const customer = everyone.find((c) => c.id === customerId) ?? null
  const menu = data.menus.find((m) => m.id === menuId) ?? null
  const duration = tab === 'book' ? (menu?.minutes ?? 60) : blockLength
  const end = start + duration
  const results = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return everyone.slice(0, 5)
    return everyone.filter((c) => [c.name, c.furigana, c.no, c.phone].some((v) => v.toLowerCase().includes(q))).slice(0, 6)
  }, [everyone, search])

  /** canon `renderDupeHint` (:6512): a name already in the book is worth saying
   *  out loud BEFORE a second record exists for the same person. */
  const dupes = useMemo(() => {
    const n = (newCustomer?.name ?? '').replace(/[ 　-]/g, '')
    if (n.length < 2) return []
    return data.customers.filter((c) => c.name.replace(/[ 　-]/g, '').includes(n)).slice(0, 3)
  }, [newCustomer?.name, data.customers])

  /** canon's right-rail checks (:4691 grammar, computed per booking). A static
   *  「営業時間内 / 担当を選択済み」 would claim a check that never ran. */
  const checks: Check[] = [
    { ok: end <= hours.close && start >= hours.open, label: end <= hours.close && start >= hours.open ? '営業時間内' : '営業時間を超えます' },
    { ok: staffId !== '', label: staffId !== '' ? '担当を選択済み' : '担当が未選択です' },
    ...(tab === 'book'
      ? [
          { ok: customer != null, label: customer != null ? 'お客様を選択済み' : 'お客様が未選択です' },
          { ok: menu != null, label: menu != null ? `コース ${menu?.name}（${duration}分）` : 'コースが未選択です' },
        ]
      : [{ ok: blockLength > 0, label: `長さ ${blockLength}分` }]),
  ]

  function registerNewCustomer() {
    if (!newCustomer || newCustomer.name.trim() === '' || newCustomer.phone.trim() === '') {
      setError('お名前と電話番号は必須です')
      return
    }
    const id = `local-cust-${Date.now()}`
    setLocalCustomers((was) => [
      { id, name: newCustomer.name.trim(), no: '未発番', phone: newCustomer.phone.trim(), furigana: newCustomer.kana.trim() },
      ...was,
    ])
    setCustomerId(id)
    setNewCustomer(null)
    setError('')
  }

  function confirm() {
    if (tab === 'book' && !customer) {
      setError('お客様を選んでください')
      return
    }
    if (end > hours.close) {
      setError('営業時間を超える予約は作成できません')
      return
    }
    setError('')
    const title = tab === 'book' ? customer!.name : blockKind
    const item: BoardItem = {
      key: `local-${staffId}-${start}-${Date.now()}`,
      kind: tab === 'book' ? 'booking' : 'block',
      state: tab === 'book' ? 'confirmed' : null,
      category: tab === 'book' ? 'repeat' : null,
      ...place(start, end, hours),
      title,
      tag: tab === 'book' ? '【未定】' : '',
      time: `${hhmm(start)}〜${hhmm(end)}`,
      ticketCat: tab === 'book' ? '単発' : null,
      ticketCore: tab === 'book' ? (menu?.price ?? '価格未記録') : null,
      held: false,
      micro: false,
      caseId: null,
      label: `${hhmm(start)}–${hhmm(end)} ${title}${memo.trim() ? ` / ${memo.trim()}` : ''}`,
    }
    dialogRef.current?.close()
    onCreate(
      staffId,
      item,
      `${hhmm(start)}の${title}をこの画面の中だけに追加しました。再読み込みすると消えます`,
    )
  }

  return (
    <dialog className="biz-dialog wide" ref={dialogRef} aria-labelledby="createTitle">
      <div className="dialog-head">
        <div><h2 id="createTitle">新規予約を作成</h2></div>
        <button className="close" type="button" aria-label="作成をやめる" onClick={() => dialogRef.current?.close()}>×</button>
      </div>
      <div className="dialog-body cc-cols">
        <div className="cc-left">
          <div className="density-seg" role="group" aria-label="登録の種類">
            <button type="button" aria-pressed={tab === 'book'} onClick={() => setTab('book')}>予約</button>
            <button type="button" aria-pressed={tab === 'block'} onClick={() => setTab('block')}>予定ブロック（休憩・清掃など）</button>
          </div>

          <div className="cc-controls">
            <div className="cc-field">
              開始・時間
              <span className="stepper">
                <button type="button" aria-label="30分早く" onClick={() => setStart((s) => Math.max(hours.open, s - 30))}>‹</button>
                <b>{hhmm(start)}–{hhmm(end)}</b>
                <button type="button" aria-label="30分遅く" onClick={() => setStart((s) => Math.min(hours.close - duration, s + 30))}>›</button>
              </span>
            </div>
            <div className="cc-field">
              担当
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                {data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {tab === 'book' ? (
            <>
              <div className="cc-stephead"><span className="cc-stepnum">1</span>お客様</div>
              <label className="cc-field">
                <input type="text" value={search} placeholder="名前・カナ・電話番号で検索" onChange={(e) => setSearch(e.target.value)} />
              </label>
              <div className="cust-results">
                {results.map((c) => (
                  <button className="cust-row" type="button" key={c.id} aria-pressed={customerId === c.id} onClick={() => setCustomerId(c.id)}>
                    {c.name}
                    <small>{c.no} / {c.phone}</small>
                  </button>
                ))}
                {results.length === 0 && <div className="course-hint">一致するお客様はいません</div>}
              </div>
              {newCustomer ? (
                <div className="cc-newcust">
                  <div className="form-grid">
                    <label>お名前・必須<input type="text" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} /></label>
                    <label>電話番号・必須<input type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} /></label>
                    <label>カナ・任意<input type="text" value={newCustomer.kana} onChange={(e) => setNewCustomer({ ...newCustomer, kana: e.target.value })} /></label>
                  </div>
                  <div className="density-seg" role="group" aria-label="性別・任意">
                    {['女性', '男性', '未設定'].map((g) => (
                      <button type="button" key={g} aria-pressed={newCustomer.gender === g} onClick={() => setNewCustomer({ ...newCustomer, gender: g })}>{g}</button>
                    ))}
                  </div>
                  {dupes.length > 0 && (
                    <div className="course-hint">同じお名前の登録があります: {dupes.map((d) => `${d.name}（${d.no}）`).join(' / ')}</div>
                  )}
                  <div className="cc-newcust-actions">
                    <button className="btn" type="button" onClick={() => { setNewCustomer(null); setError('') }}>やめる</button>
                    <button className="btn primary" type="button" onClick={registerNewCustomer}>この内容で登録</button>
                  </div>
                </div>
              ) : (
                <button className="btn text" type="button" onClick={() => setNewCustomer({ name: search.trim(), phone: '', kana: '', gender: '未設定' })}>＋ 新規顧客</button>
              )}
              <div className="field-error" aria-live="polite">{error}</div>

              <div className="cc-stephead"><span className="cc-stepnum">2</span>コース<span className="cc-stephint">この方に合うものを先頭に</span></div>
              <div className="course-list">
                {data.menus.map((m) => (
                  <button className="course-row" type="button" key={m.id} aria-pressed={menuId === m.id} onClick={() => setMenuId(m.id)}>
                    <span>{m.name}<small> / {m.store}</small></span>
                    <b>{m.price}</b>
                  </button>
                ))}
                <div className="course-hint">メニューの編集は 設定＞メニュー・料金表（準備中）</div>
              </div>

              <div className="cc-stephead"><span className="cc-stepnum">3</span>詳細<span className="cc-stephint">経路・メモ（任意）</span></div>
              <div className="density-seg" role="group" aria-label="予約経路">
                {data.sources.map((s) => (
                  <button type="button" key={s} aria-pressed={source === s} onClick={() => setSource(s)}>{s}</button>
                ))}
              </div>
              <label className="cc-field">
                <textarea rows={2} value={memo} placeholder="メモ（任意）" onChange={(e) => setMemo(e.target.value)} />
              </label>
            </>
          ) : (
            <>
              <div className="cc-stephead"><span className="cc-stepnum">1</span>種類</div>
              <div className="density-seg" role="group" aria-label="ブロックの種類">
                {data.blockKinds.map((k) => (
                  <button type="button" key={k} aria-pressed={blockKind === k} onClick={() => setBlockKind(k)}>{k}</button>
                ))}
              </div>
              <div className="cc-stephead"><span className="cc-stepnum">2</span>長さ</div>
              <div className="density-seg" role="group" aria-label="ブロックの長さ">
                {data.blockLengths.map((n) => (
                  <button type="button" key={n} aria-pressed={blockLength === n} onClick={() => setBlockLength(n)}>{n}分</button>
                ))}
              </div>
              <div className="cc-stephead"><span className="cc-stepnum">3</span>メモ<span className="cc-stephint">任意</span></div>
              <label className="cc-field">
                <textarea rows={2} value={memo} placeholder="メモ（任意）" onChange={(e) => setMemo(e.target.value)} />
              </label>
              <div className="field-error" aria-live="polite">{error}</div>
              <div className="guardrail">予定ブロックはお客様・売上に影響しないため、確定だけでボードに置けます。</div>
            </>
          )}
        </div>

        <aside className="cc-ticket" aria-label="この内容で確定します">
          <div className="cc-ticket-kicker">{tab === 'book' ? '予約チケット' : '予定ブロック'}</div>
          <div className="cc-ticket-cust">{tab === 'book' ? (customer ? customer.name : 'お客様を選んでください') : blockKind}</div>
          {tab === 'book' && (
            <div className="cc-ticket-course">
              {menu?.name ?? 'コース未選択'}
              <div className="price">{menu?.price ?? '—'}</div>
            </div>
          )}
          <div className="cc-ticket-meta">
            <span>時間 <b>{hhmm(start)}–{hhmm(end)}</b></span>
            <span>担当 <b>{data.staff.find((s) => s.id === staffId)?.name ?? '担当未定'}</b></span>
            {tab === 'book' && <span>経路 <b>{source}</b></span>}
            <span>営業時間 <b>{data.openLabel}–{data.closeLabel}</b></span>
          </div>
          <div className="holdbar-checks cc-ticket-checks">
            {checks.map((c) => <span className={`ck${c.ok ? '' : ' bad'}`} key={c.label}>{c.label}</span>)}
          </div>
          <div className="cc-ticket-note">
            この画面の中だけに追加します。実際の予約は作成されず、再読み込みすると消えます。
          </div>
          <div className="cc-ticket-actions">
            <button className="btn" type="button" onClick={() => dialogRef.current?.close()}>やめる</button>
            <button className="btn primary" type="button" disabled={checks.some((c) => !c.ok)} onClick={confirm}>この内容で予約を確定</button>
          </div>
        </aside>
      </div>
    </dialog>
  )
}
