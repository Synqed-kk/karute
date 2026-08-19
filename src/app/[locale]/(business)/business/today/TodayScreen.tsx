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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  computeChecks,
  confirmCaption,
  dragOrigin,
  keyboardNudge,
  shelfLanding,
  stepPct,
  type Check,
  type CheckSpan,
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
import { hhmm, minuteOf, place, yen, type BoardItem, type BoardLane } from '@/business/lib/today-board'
import { useTopbarAction } from '../../BusinessTopbar'
import {
  applyMoves,
  blockChrome,
  clickClosesPopover,
  dragModeAt,
  fractionIn,
  isOverShelf,
  laneKeyAtY,
  nextSpan,
  parkChipText,
  sellLayerFor,
  slotStartAt,
  type Move,
  type Moves,
} from './today-interactions'

const HINT = '見本データのため実行できません'

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
  group: string
  homeLane: string
  targetLane: string
  track: Element
  moved: boolean
  overShelf: boolean
}

export function TodayScreen(props: TodayProps) {
  const { hours, ops, dialogs } = props

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
  const [holdConfirmed, setHoldConfirmed] = useState(false)
  const [added, setAdded] = useState<Array<{ laneKey: string; item: BoardItem }>>([])
  const [calMonth, setCalMonth] = useState(0)
  const [toast, setToast] = useState('')
  const [blockInfo, setBlockInfo] = useState<{ kind: string; who: string; whoLabel: string; time: string; note: string } | null>(null)
  const [seed, setSeed] = useState<{ staffId: string; start: number; nonce: number } | null>(null)

  // ── the interaction plane ────────────────────────────────────────────────
  const [moves, setMoves] = useState<Moves>({})
  const [parked, setParked] = useState<string[]>([])
  /** The staged change awaiting 確定 — canon's `pendingChange`. `origin` is
   *  where the card came from, so 元に戻す has somewhere to go. */
  const [pending, setPending] = useState<{ id: string; origin: Move } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ laneKey: string; x: number; w: number } | null>(null)
  const [shelfOver, setShelfOver] = useState(false)
  const dragRef = useRef<DragCtx | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const shelfRef = useRef<HTMLDivElement>(null)
  const chipDragRef = useRef<{ id: string; startX: number; startY: number; moved: boolean; laneKey: string | null } | null>(null)

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

  // B5 予約を作成 — canon's rightmost topbar action. The button is the shell's,
  // the dialog is this screen's; the slot is where they meet.
  const openCreate = useCallback(() => {
    setSeed(null)
    createRef.current?.showModal()
  }, [])
  useTopbarAction('予約を作成', openCreate)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3200)
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

  const boardLanes = useMemo(
    () => applyMoves(props.lanes, moves, parked, added, hours),
    [props.lanes, moves, parked, added, hours],
  )

  const price = clampPriceInputs(appliedPrice.hi, appliedPrice.lo, dialogs.pricing)
  const depth = Math.round((1 - price.lo / price.hi) * 100)

  const sell = useMemo(
    () =>
      sellLayerFor(boardLanes, hours, {
        gridMin: props.sell.gridMin,
        nowMinute: props.sell.nowMinute,
        locked,
        showPrice: showSlotPrice,
        hi: price.hi,
        hqMin: dialogs.pricing.hqMin,
        depth,
      }),
    [boardLanes, hours, props.sell, locked, showSlotPrice, price.hi, dialogs.pricing.hqMin, depth],
  )

  const openCards = props.cards.filter((c) => c.state === 'open' && !resolved.includes(c.id))
  const unresolved = openCards.length
  const settledCount = Number(ops.settled.replace(/\D/g, '')) + settled.length
  const awaitingCount = Math.max(Number(ops.awaiting.replace(/\D/g, '')) - settled.length, 0)

  const currentCase = selected ? (props.cases[selected] ?? null) : null

  function show(message: string) {
    setToast(message)
  }

  function dayHref(offset: number) {
    const q = new URLSearchParams()
    if (props.storeParam) q.set('store', props.storeParam)
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

  const pendingChecks = pending && moves[pending.id] ? checksFor(pending.id, moves[pending.id]) : []
  const pendingConfirm = confirmCaption(pendingChecks)

  function stage(id: string, laneKey: string, span: { x: number; w: number }, from: Move) {
    setMoves((was) => ({ ...was, [id]: { laneKey, ...span } }))
    setPending((was) => (was && was.id === id ? was : { id, origin: from }))
    setSelected(null)
  }

  function revertPending() {
    if (!pending) return
    const { id, origin } = pending
    setMoves((was) => {
      const next = { ...was }
      if (origin.laneKey === '' ) delete next[id]
      else next[id] = origin
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
    if (!at || !confirmCaption(checksFor(pending.id, at)).enabled) {
      show('状況が変わったため、この内容では確定できません')
      return
    }
    setPending(null)
    setHoldConfirmed(true)
    setResolved((was) => toggleOn(was, props.cards.find((c) => c.kind === '担当変更')?.id))
    show('この画面の中だけで確定しました。再読み込みすると戻ります')
  }

  // ── card drag ────────────────────────────────────────────────────────────

  function homeMoveFor(id: string, lane: BoardLane, item: BoardItem): Move {
    return moves[id] ?? { laneKey: lane.key, x: item.x, w: item.w }
  }

  function onCardPointerDown(e: React.PointerEvent<HTMLButtonElement>, item: BoardItem, lane: BoardLane) {
    if (e.button !== 0 || dragRef.current || !item.caseId) return
    if (pending && pending.id !== item.caseId) {
      show('仮押さえ中の変更を確定するか、元に戻してから操作してください')
      return
    }
    const track = e.currentTarget.closest('.track')
    if (!track) return
    const mode = dragModeAt(e.currentTarget, e.clientX)
    dragRef.current = {
      id: item.caseId,
      pointerId: e.pointerId,
      origin: dragOrigin(item.x, item.w, mode, STEP),
      startX: e.clientX,
      startY: e.clientY,
      group: lane.group,
      homeLane: lane.key,
      targetLane: lane.key,
      track,
      moved: false,
      overShelf: false,
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* capture is an assist, not a requirement */ }
    e.preventDefault()
  }

  function onCardPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const ctx = dragRef.current
    if (!ctx || e.pointerId !== ctx.pointerId) return
    // canon's self-heal (:4466): a move with no button down means the release
    // was lost, and the card would otherwise stay stuck to the cursor.
    if (e.buttons === 0) { cancelDrag(); return }
    const dx = e.clientX - ctx.startX
    const dy = e.clientY - ctx.startY
    if (!ctx.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    ctx.moved = true
    setDraggingId(ctx.id)
    const span = nextSpan(ctx.origin, ctx.track, dx, STEP)
    setMoves((was) => ({ ...was, [ctx.id]: { laneKey: ctx.targetLane, ...span } }))
    if (ctx.origin.mode !== 'move') return
    ctx.overShelf = isOverShelf(shelfRef.current, e.clientY)
    setShelfOver(ctx.overShelf)
    const laneKey = laneKeyAtY(boardRef.current, ctx.group, e.clientY)
    if (laneKey) ctx.targetLane = laneKey
    if (!ctx.overShelf && ctx.targetLane !== ctx.homeLane) setDropTarget({ laneKey: ctx.targetLane, ...span })
    else setDropTarget(null)
  }

  function onCardPointerUp(e: React.PointerEvent<HTMLButtonElement>, item: BoardItem, lane: BoardLane) {
    const ctx = dragRef.current
    if (!ctx || e.pointerId !== ctx.pointerId) return
    const from: Move = { laneKey: ctx.homeLane, x: ctx.origin.x, w: ctx.origin.w }
    if (!ctx.moved) {
      // A press that never travelled is a selection, not a drag.
      clearDrag()
      setSelected(item.caseId)
      return
    }
    // canon (:4567): the release position is authoritative — recompute once more
    // rather than trusting the last move Chrome delivered.
    const span = nextSpan(ctx.origin, ctx.track, e.clientX - ctx.startX, STEP)
    if (ctx.origin.mode === 'move' && isOverShelf(shelfRef.current, e.clientY)) {
      clearDrag()
      setMoves((was) => ({ ...was, [ctx.id]: from }))
      park(ctx.id, item, from)
      return
    }
    if (ctx.origin.mode === 'move') {
      const laneKey = laneKeyAtY(boardRef.current, ctx.group, e.clientY)
      if (!laneKey) {
        clearDrag()
        setMoves((was) => ({ ...was, [ctx.id]: from }))
        show('予約を置く行の中で離してください')
        return
      }
      ctx.targetLane = laneKey
    }
    const laneChanged = ctx.origin.mode === 'move' && ctx.targetLane !== ctx.homeLane
    clearDrag()
    if (span.x === ctx.origin.x && span.w === ctx.origin.w && !laneChanged) {
      setMoves((was) => ({ ...was, [ctx.id]: from }))
      return
    }
    stage(ctx.id, ctx.origin.mode === 'move' ? ctx.targetLane : lane.key, span, pending?.id === ctx.id ? pending.origin : from)
  }

  function cancelDrag() {
    const ctx = dragRef.current
    if (!ctx) return
    setMoves((was) => ({ ...was, [ctx.id]: { laneKey: ctx.homeLane, x: ctx.origin.x, w: ctx.origin.w } }))
    clearDrag()
  }

  function clearDrag() {
    dragRef.current = null
    setDraggingId(null)
    setDropTarget(null)
    setShelfOver(false)
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
      show('仮押さえ中の変更を確定するか、元に戻してから操作してください')
      return
    }
    const from = homeMoveFor(item.caseId, lane, item)
    const next = keyboardNudge(item.x, item.w, leftEdge ? 'resizeL' : 'resize', e.key === 'ArrowLeft' ? -1 : 1, STEP)
    if (!next) {
      show('これ以上は時間を変更できません')
      return
    }
    stage(item.caseId, lane.key, next, pending?.id === item.caseId ? pending.origin : from)
  }

  // ── 仮置きエリア ──────────────────────────────────────────────────────────

  const [parkChips, setParkChips] = useState<Array<{ id: string; title: string; line1: string; line2: string; category: string | null; home: Move }>>([])

  function park(id: string, item: BoardItem, from: Move) {
    const text = parkChipText(item, hours, props.dayLabel)
    setParked((was) => (was.includes(id) ? was : [...was, id]))
    setParkChips((was) => [...was.filter((c) => c.id !== id), { id, ...text, category: item.category, home: from }])
    setPending(null)
    show(`${item.title}様を仮置きエリアへ移動しました（仮押さえ扱い）`)
  }

  function unpark(id: string) {
    const chip = parkChips.find((c) => c.id === id)
    setParked((was) => was.filter((x) => x !== id))
    setParkChips((was) => was.filter((c) => c.id !== id))
    if (chip) setMoves((was) => ({ ...was, [id]: chip.home }))
    show(`${chip?.title.replace('（仮押さえ・未配置）', '') ?? '予約'}を元の枠に戻しました`)
  }

  function onChipPointerDown(e: React.PointerEvent<HTMLElement>, id: string) {
    if (e.button !== 0 || dragRef.current) return
    if (pending) {
      show('仮押さえ中の変更を確定するか、元に戻してから操作してください')
      return
    }
    chipDragRef.current = { id, startX: e.clientX, startY: e.clientY, moved: false, laneKey: null }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* capture is an assist */ }
    e.preventDefault()
  }

  function onChipPointerMove(e: React.PointerEvent<HTMLElement>) {
    const ctx = chipDragRef.current
    if (!ctx) return
    if (e.buttons === 0) { chipDragRef.current = null; setDropTarget(null); return }
    if (!ctx.moved && Math.abs(e.clientX - ctx.startX) < 5 && Math.abs(e.clientY - ctx.startY) < 5) return
    ctx.moved = true
    ctx.laneKey = laneKeyAtY(boardRef.current, 'staff', e.clientY)
    setDropTarget(ctx.laneKey ? { laneKey: ctx.laneKey, x: 0, w: 0 } : null)
  }

  /** canon `placeFromShelf` (:5653): the chip lands on the same dual lattice,
   *  centred on the pointer, and arrives as a 仮押さえ rather than a booking. */
  function onChipPointerUp(e: React.PointerEvent<HTMLElement>) {
    const ctx = chipDragRef.current
    chipDragRef.current = null
    setDropTarget(null)
    if (!ctx || !ctx.moved || !ctx.laneKey) return
    const chip = parkChips.find((c) => c.id === ctx.id)
    const track = boardRef.current?.querySelector(`.lane[data-lane="${ctx.laneKey}"] .track`)
    if (!chip || !track) return
    const w = chip.home.w
    const x = shelfLanding(fractionIn(track, e.clientX), w, chip.home.x, STEP)
    setParked((was) => was.filter((id) => id !== ctx.id))
    setParkChips((was) => was.filter((c) => c.id !== ctx.id))
    setMoves((was) => ({ ...was, [ctx.id]: { laneKey: ctx.laneKey!, x, w } }))
    setPending({ id: ctx.id, origin: chip.home })
    setSelected(null)
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
    sell.degraded ? 'density-degraded' : '',
    `guard-guide-mode-${guideMode}`,
  ]
    .filter(Boolean)
    .join(' ')

  function renderLane(lane: BoardLane) {
    if (view !== 'both' && ((view === 'staff' && lane.group !== 'staff') || (view === 'beds' && lane.group !== 'beds'))) return null
    if (collapsed.includes(lane.group)) return null
    const isLocked = locked.includes(lane.key)
    const cells = sell.cells.filter((c) =>
      c.group !== lane.group ? false : lane.group === 'staff' ? c.laneKey === lane.key : c.resourceKey === lane.key,
    )
    return (
      <div className={`lane${lane.mine ? ' mine' : ''}${isLocked ? ' locked' : ''}`} key={lane.key} data-lane={lane.key} data-group={lane.group}>
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
            if (e.target !== e.currentTarget || isLocked || lane.group !== 'staff') return
            setSeed({ staffId: lane.key, start: slotStartAt(e.currentTarget, e.clientX, hours), nonce: Date.now() })
            createRef.current?.showModal()
          }}
        >
          {!isLocked &&
            cells.map((c) => {
              const span = place(c.h, c.h + 60, hours)
              return (
                <span
                  className="cell-price"
                  key={`${lane.key}-${c.group}-${c.h}`}
                  aria-hidden="true"
                  style={{ '--x': `${span.x}%`, '--w': `${span.w}%`, '--tier': c.tier } as React.CSSProperties}
                >
                  {c.group === 'staff' && c.price != null && <i>{money(c.price)}</i>}
                </span>
              )
            })}
          {dropTarget?.laneKey === lane.key && dropTarget.w > 0 && (
            <div className="drop-ghost" aria-hidden="true" style={{ '--x': `${dropTarget.x}%`, '--w': `${dropTarget.w}%` } as React.CSSProperties} />
          )}
          {lane.items.map((item) => renderItem(item, lane))}
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
          className={`event ${cls}${item.micro ? ' micro' : ''}`}
          type="button"
          key={item.key}
          style={style}
          title={item.label}
          aria-label={item.label}
          onClick={() => {
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
        className={`event ${state}${selected === item.caseId ? ' selected' : ''}${draggingId === item.caseId ? ' dragging' : ''}${isPending ? ' pending' : ''}`}
        type="button"
        key={item.key}
        data-book={item.caseId ?? undefined}
        style={style}
        data-cat={item.category ?? undefined}
        title={item.label}
        aria-label={item.label}
        aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight Alt+ArrowLeft Alt+ArrowRight"
        aria-describedby="boardKeyHelp"
        onPointerDown={(e) => onCardPointerDown(e, item, lane)}
        onPointerMove={onCardPointerMove}
        onPointerUp={(e) => onCardPointerUp(e, item, lane)}
        onPointerCancel={cancelDrag}
        onKeyDown={(e) => onCardKeyDown(e, item, lane)}
      >
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
        <span className="event-resize-grip left" aria-hidden="true" title="左端をドラッグして開始時刻を変更" />
        <span className="event-resize-grip right" aria-hidden="true" title="右端をドラッグして終了時刻を変更" />
      </button>
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
      <header className="ops-strip" aria-label="本日の店舗状態">
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
        <header className="ops-strip" aria-label="自分の1日">
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
                  </div>
                )}
              </div>

              {props.inStore && (
                <div className="session-chip">
                  <i aria-hidden="true" />
                  ご来店中: {props.inStore.name}様（施術済み・精算待ち）
                  <button className="btn text" type="button" onClick={() => createRef.current?.showModal()}>次回予約を作成</button>
                </div>
              )}
            </div>

            <div className="board-tools">
              <div className="time-nav date-nav" role="group" aria-label="日付の移動" data-pop="cal">
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
                  type="button"
                  className="btn text"
                  aria-expanded={pop === 'fields'}
                  onClick={() => setPop((p) => (p === 'fields' ? '' : 'fields'))}
                >
                  表示設定
                </button>
                {pop === 'fields' && (
                  <div className="fields-pop">
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
                    {/* E9c: the degrade note is a live consequence of the board,
                        not a stored flag — it appears exactly when tint mode has
                        been degraded by the density ceiling. */}
                    {sell.degraded && sellMode === 'tint' && (
                      <span>本日は販売枠が細かく分かれているため、価格はドラッグ中のみ表示しています</span>
                    )}
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
                      <span>保護ルール: オフ</span>
                      <span className="chip">店舗設定は準備中</span>
                    </div>

                    <div className="pop-divider" role="presentation" />
                    <strong>色の意味</strong>
                    <div className="legend" aria-label="予約状態の色の意味">
                      <span><i />確定・施術</span>
                      <span className="needs"><i />要対応</span>
                      <span className="hold"><i />仮押さえ</span>
                      <span className="public"><i />販売可能</span>
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

              <div className="segmented" role="group" aria-label="ボード表示">
                {([['both', '両方'], ['staff', 'スタッフ'], ['beds', '設備']] as const).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{label}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="board-body">
            <div className="board-main">
              <div className="timeline-scroll" tabIndex={0} aria-label={`営業時間${hhmm(hours.open)}から${hhmm(hours.close)}の予約ボード`}>
                <div
                  className={timelineClasses}
                  ref={boardRef}
                  style={{ '--hours': hours.count, '--now': props.nowFraction ?? 0 } as React.CSSProperties}
                >
                  {props.nowFraction != null && <div className="elapsed-wash" aria-hidden="true" />}
                  <div className="time-head">
                    <span>時間</span>
                    <div className="hours">
                      {hours.labels.map((h) => <span key={h}>{h}</span>)}
                    </div>
                  </div>

                  {(['staff', 'beds'] as const).map((group) => {
                    if (view !== 'both' && view !== group) return null
                    const groupLanes = boardLanes.filter((l) => l.group === group)
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

              {/* 仮置きエリア — the whole bar is the drop zone (canon R18). */}
              <div
                className={`park-shelf${shelfOver ? ' over' : ''}`}
                ref={shelfRef}
                aria-label="仮置きエリア。日付をまたいだ変更のための一時置き場"
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
                      onPointerCancel={() => { chipDragRef.current = null; setDropTarget(null) }}
                    >
                      <strong>{chip.title}</strong>
                      <span className="pc-line1">{chip.line1}</span>
                      <span className="pc-line2">{chip.line2}</span>
                      <button className="park-x" type="button" aria-label="元の枠に戻す" onClick={(e) => { e.stopPropagation(); unpark(chip.id) }}>×</button>
                    </div>
                  ))}
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

        {/* ── H: hold bar ──────────────────────────────────────────────── */}
        {pending ? (
          <div className="holdbar" role="region" aria-label="仮押さえの確認">
            <div className="holdbar-head">
              <span className="status waiting">仮押さえ</span>
              <strong>{holdSummary(boardLanes, pending.id, moves[pending.id], hours)}</strong>
            </div>
            <div className="holdbar-checks">
              {pendingChecks.map((c) => <span className={`ck${c.ok ? '' : ' bad'}`} key={c.label}>{c.label}</span>)}
            </div>
            <div className="holdbar-actions">
              <button className="btn primary" type="button" disabled={!pendingConfirm.enabled} onClick={confirmPending}>{pendingConfirm.label}</button>
              <button className="btn" type="button" onClick={revertPending}>元に戻す</button>
            </div>
          </div>
        ) : props.hold ? (
          <div className="holdbar" role="region" aria-label="仮押さえの確認">
            <div className="holdbar-head">
              <span className={`status ${holdConfirmed ? 'done' : 'waiting'}`}>{holdConfirmed ? '確定済み' : '仮押さえ'}</span>
              <strong>{props.hold.summary}</strong>
            </div>
            <div className="holdbar-checks">
              {props.hold.checks.map((c) => <span className="ck" key={c}>{c}</span>)}
            </div>
            <div className="holdbar-actions">
              <button className="btn primary" type="button" disabled={holdConfirmed} onClick={() => { setHoldConfirmed(true); setResolved((was) => toggleOn(was, props.cards.find((c) => c.kind === '担当変更')?.id)); show('仮押さえをこの画面の中だけで確定しました。再読み込みすると戻ります') }}>この内容で確定</button>
              <button className="btn" type="button" disabled={!holdConfirmed} onClick={() => { setHoldConfirmed(false); show('仮押さえに戻しました') }}>元に戻す</button>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── I: 本日の運営影響 ─────────────────────────────────────────── */}
      {props.incident && (
        <section className="incident" aria-label="本日の運営影響">
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
      <section className="decision-section" aria-labelledby="decisionTitle">
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
      <section className="decision-section" aria-labelledby="kpiStripTitle">
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
          setAdded((was) => [...was, { laneKey, item }])
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

      <div className={`toast${toast ? ' show' : ''}`} role="status" aria-live="polite" aria-atomic="true">{toast}</div>
    </div>
  )
}

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
