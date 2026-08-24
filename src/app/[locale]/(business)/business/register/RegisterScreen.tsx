'use client'

// 売上・レジ — the day's money desk, REBUILT to the approved restructure mock
// (MOCK-REGISTER-RESTRUCTURE-2026-08-24.html, ⚖ Liam 8/24 eve: "I think it's
// good. Just go with it"). Canon's BEHAVIOUR is unchanged
// (fable-store-sales-register.html, read whole before a line of the first cut
// was written); what changed is the SHAPE.
//
// ONE PAGE, TWO MODES, AND THAT IS THE WHOLE RESTRUCTURE. The shipped room
// stacked two different JOBS down one column — the all-day transaction desk
// (ledger + inspector) and the once-a-day closing ritual (drawer, checklist,
// record, reconciliation) — so the closer scrolled past a ledger to reach a
// checklist and the cashier scrolled past a checklist to reach nothing. That
// vertical stack was the dead space and the forced scrolling Liam photographed.
// Everything TRUE OF THE DAY stays always visible (the exception band, the money
// strip, the counter strip); below them the page splits into 取引 | 閉店 tabs.
// Same day, same scope, same authority, two jobs — so they are TABS OVER ONE
// OBJECT, never two nav destinations and never a filter.
//
// WHAT IS CLIENT STATE HERE, AND NOTHING ELSE: which mode is open, which filter
// is pressed, which transaction is open, which of the phone's folds are open,
// whether the 金種 count sheet is open, which control a jump is pointing at,
// which step of the 画面の説明 tour the reader is on, and — ≤743 only — whether
// the reader is looking at the list or at the transaction. All of it is
// browsing. Every control that would CHANGE
// MONEY ships refused with its reason, so there is no staged write for a
// provider to hold above this component (flag 30's class).
//
// CLASS NAMES ARE PREFIXED `rg-` ON PURPOSE. App Router leaves every sibling
// room's stylesheet in the document after a client-side navigation, and the
// neighbours state BARE `.biz .<name>` rules on names canon's register page uses
// (`.summary`, `.summary-main`, `.filters`, `.panel`, `.panel-head`,
// `.inspector`, `.fact`, `.price`, `.history-row`, `.empty`, `.status`,
// `.check-row`, `.spot-card`…). 今日の運営 even owns `.register-cell`. Fencing
// sixty shared names one property at a time is a list that rots; not colliding
// at all cannot. `page` / `h1` / `btn` are genuinely the shell's AND restated
// here, so those three are fenced in register.css — a list of three.

import Link from 'next/link'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import {
  COUNTER_FILTER,
  COUNTER_STATS,
  matchesFilter,
  type ClosingCheckRow,
  type ClosingJump,
  type RegisterCounts,
  type RegisterFilter,
  type TransactionState,
} from '@/business/lib/register'

/** THE ROUTE WRAPPER. Every rule in register.css is scoped under this class, and
 *  `.page.pg-register` (four levels) rather than `.pg-register` (three) so a
 *  sibling's own three-level rule cannot win the room back on insertion order. */
const ROOT = 'page pg-register'

export interface RegisterFactProps {
  label: string
  value: string
  tone?: 'warn' | 'bad'
}

export interface RegisterRowProps {
  id: string
  state: TransactionState
  stateLabel: string
  /** Carried so the client narrows the ledger through the SAME predicate the
   *  server counted the strip with — `matchesFilter`, one home. A counter and
   *  the rows it opens cannot answer two different questions. */
  filter: RegisterFilter
  pill: string
  who: string
  /** The row's headline: the customer, or WHAT WAS SOLD when the register
   *  recorded nobody. */
  title: string
  /** ⚖ NOBODY IS NOT A NAME — the row renders compact, one line shorter, with no
   *  placeholder standing where a person would be. */
  nameless: boolean
  memberNumber: string | null
  what: string
  bookingNo: string | null
  atLabel: string
  totalLabel: string
  receivedLabel: string
  /** 未収 or 返金, under the row's total — the KIND is part of the value. */
  subAmount: { label: string; value: string; tone: 'warn' | 'bad' } | null
  tenderSummary: string
  facts: RegisterFactProps[]
  priceProof: string
  tenders: Array<{ label: string; amount: string; tone?: 'refund' | 'unpaid' }>
  refundPreview: string | null
  refundNote: string
  closingImpact: string
  history: Array<{ time: string; what: string; detail: string }>
  bookingHref: string | null
  refundRefusal: string
  outstandingLabel: string
  outstandingRefusal: string
  bookingRefusal: string
  canRefund: boolean
  showRefund: boolean
  /** canon gates 未収として記録 on the CLOSE capability (:1305), like its four
   *  siblings — a role without it gets no control at all. */
  canOutstanding: boolean
  showOutstanding: boolean
}

/** 決済端末 — `null` on a day the terminal is holding nothing. The band is not a
 *  permanent slot that sometimes says 「異常なし」: it renders when the day HOLDS a
 *  record, which is also why a business with no card terminal never sees it,
 *  with no business-type branch anywhere. */
export interface RegisterTerminalProps {
  title: string
  copy: string
  foldLabel: string
  /** …and what the same control does once it IS open. One button, two jobs, so
   *  its accessible name has to be able to say both (F-S12). */
  foldCloseLabel: string
  stats: Array<{ label: string; value: string; tone?: 'warn' }>
  recheckLabel: string
  recheckRefusal: string
  canRecheck: boolean
}

export interface RegisterProps {
  dateline: string
  lensLabel: string
  subtitle: string
  permissionNotice: string | null
  money: Array<{ key: string; label: string; value: string; tone?: 'warn' | 'bad'; redacted?: boolean }>
  moneyScope: string
  /** The one line the phone's 閉店 screen shows in place of the money strip. */
  moneyFold: string
  counts: RegisterCounts
  countsFold: string
  filters: Array<{ key: RegisterFilter; label: string }>
  rows: RegisterRowProps[]
  sellLabel: string
  sellRefusal: string
  terminal: RegisterTerminalProps | null
  /** ⚖ A CLOSE BELONGS TO ONE STORE, AND TO A ROLE THAT MAY CLOSE. `null` under
   *  the storeless `{viewAll:true}` lens — no drawer to count, no day to close —
   *  and `null` for a role without the capability, which is why those roles get
   *  no 閉店 tab at all rather than a room full of greyed gates. */
  close: RegisterCloseProps | null
  /** Why the closing view is missing, and only when the reader can DO something
   *  about it (pick a store). `null` = say nothing. */
  closeUnavailable: string | null
  actionFootnote: string
  emptyDay: boolean
}

export interface RegisterCloseProps {
  cash: {
    expected: string
    counted: string
    variance: string
    varianceBad: boolean
    /** F12 — this role may not see the day's cash figures, so the stats wear the
     *  strip's own quiet-sentence treatment instead of 18px bold. */
    redacted: boolean
    reason: string
    /** ⑪ Somewhere the reason LIVES, on the days there is a difference. Read-only
     *  in this slice, so `value` is the recorded reason or the room's own
     *  sentence for a missing one — never an example dressed up as a record
     *  (F-S7; the placeholder returns with the editable field at reconnect). */
    reasonInput: {
      label: string
      value: string
      refusal: string
      chips: string[]
    } | null
    status: string
    statusDone: boolean
    floatLabel: string
    floatValue: string
    dayCashLabel: string
    dayCashValue: string
    tolerance: string
    toleranceLinkLabel: string
    toleranceLinkRefusal: string
    saveLabel: string
    saveRefusal: string
    /** ⑩ 金種で数える, on the days there is a sheet to count. `null` when the
     *  closing carries none — a typed 実査額 has no column to add up. */
    denominations: {
      summaryLabel: string
      summaryNote: string
      unit: string
      totalLabel: string
      totalValue: string
      totalNote: string
      rows: Array<{ key: string; label: string; name: string; count: string }>
    } | null
  }
  checks: ClosingCheckRow[]
  openCount: number
  headline: string
  closeLabel: string
  closeRefusal: string
  signoffLabel: string
  signoffRefusal: string
  recordLabel: string
  recordNote: string
  /** `wrap` = this cell holds WORDS, not a figure: a name may break at its own
   *  space rather than being held on one line like every ¥ in the strip. */
  record: Array<{ label: string; value: string; wrap?: boolean }>
  reconciliation: Array<{ label: string; received: string; reversed: string; net: string }>
  reconciliationNote: string
  reconciliationBalanced: boolean
}

/** 予約一覧で事実を確認 — ONE label read by both the link shape and the refused
 *  shape, so a sale with no booking cannot end up describing itself differently
 *  from one that has one (⚖ A8). */
const BOOKING_LABEL = '予約一覧で事実を確認'

/** ⑨ WHERE A GATE GOES, SAID OUT LOUD. The chevron is a glyph; a reader who
 *  cannot see it needs the destination in the control's own name. Keyed on the
 *  jump the VERDICT produced, so a row can never advertise a trip it does not
 *  take. */
const JUMP_LABEL: Record<string, string> = {
  ledger: '取引の一覧を開いて、この取引を表示します',
  cash: 'この画面の現金ドロアを示します',
  signoff: 'この画面の店舗管理者の確認を示します',
}
const jumpLabelOf = (j: ClosingJump) => JUMP_LABEL[j.kind === 'ledger' ? 'ledger' : j.target]

/** ⚖ Liam 8/23 — 画面の説明. The board's own tour helpers at the same shape: a
 *  rect literal the engine understands, and two identity guards that keep the
 *  measuring effect from re-rendering itself forever. */
const boxOf = (r: { left: number; top: number; width: number; height: number }): SpotRect =>
  ({ left: r.left, top: r.top, width: r.width, height: r.height })

type TourStep = { title: string; text: string; idx: number; total: number }
const sameStep = (a: TourStep, b: TourStep) =>
  a.title === b.title && a.text === b.text && a.idx === b.idx && a.total === b.total

const samePos = (a: { hole: SpotRect; top: number; left: number }, b: { hole: SpotRect; top: number; left: number }) =>
  a.top === b.top && a.left === b.left &&
  a.hole.left === b.hole.left && a.hole.top === b.hole.top &&
  a.hole.width === b.hole.width && a.hole.height === b.hole.height

/** ⑫ A REFUSAL THAT ONLY LIVES IN A TOOLTIP DOES NOT EXIST FOR FINGERS.
 *
 *  Every refused control on this page explains itself in its accessible name and
 *  its `title`, and a phone has no hover: the reader taps a dead button and is
 *  told nothing. The SAME string therefore also renders as a quiet line under the
 *  control, which register.css shows only where there is no pointer (≤743).
 *
 *  ONE SOURCE, RENDERED TWICE — never two strings that can drift. That is what
 *  this component is for: there is no way to give the button one sentence and the
 *  line another. The line is `aria-hidden` because the control's own name already
 *  carries it; a screen reader must not hear the same refusal twice. */
function Refused({
  label,
  reason,
  className = 'btn',
  describedBy,
  id,
  buttonRef,
}: {
  label: string
  reason: string
  className?: string
  describedBy?: string
  id?: string
  buttonRef?: Ref<HTMLButtonElement>
}) {
  return (
    <>
      <button
        className={className}
        type="button"
        id={id}
        ref={buttonRef}
        aria-disabled="true"
        title={reason}
        aria-label={`${label} — ${reason}`}
        aria-describedby={describedBy}
      >
        {label}
      </button>
      <span className="rg-refusal" aria-hidden="true">{reason}</span>
    </>
  )
}

type FoldKey = 'money' | 'counts' | 'terminal' | 'record'

export function RegisterScreen(props: RegisterProps) {
  const [mode, setMode] = useState<'ledger' | 'close'>('ledger')
  const [filter, setFilter] = useState<RegisterFilter>('all')
  const [selected, setSelected] = useState<string | null>(null)
  // ≤743 ONLY, and view state rather than staged work: on a phone the ledger IS
  // the page and a transaction is its own screen, so the room has to know which
  // of the two the reader is on. Above 743 both panels are on screen and this
  // flag styles nothing at all (register.css keeps its rules inside the band).
  const [detailOpen, setDetailOpen] = useState(false)
  // ⑰/⑱ ≤743 + 閉店 ONLY: the day-strips and the close record fold to one line
  // each so the count field is in the first screenful. NOTHING IS HIDDEN —
  // folded is not gone, and every figure is one tap away.
  const [folds, setFolds] = useState<Record<FoldKey, boolean>>({
    money: false,
    counts: false,
    terminal: false,
    record: false,
  })
  // ⑩ 金種で数える, AND IT IS THE SAME KIND OF STATE AS THE FOLDS (F-S10). A
  // native <details> keeps its open flag in the DOM node, and the node is
  // unmounted the moment the reader looks at 取引 — so a closer who had the
  // count sheet open, checked one transaction and came back found it shut,
  // while every fold beside it had survived. The counting is the job the phone
  // came for; losing it is losing input.
  const [denOpen, setDenOpen] = useState(false)
  // ⑨ A gate whose fix is already on this screen POINTS at it instead of
  // travelling. `null` = nothing is being pointed at.
  const [pointingAt, setPointingAt] = useState<'cash' | 'signoff' | null>(null)
  // ⚖ Liam 8/23 — 画面の説明. The step the tour is on, `-1` when it is closed.
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  // ≤743's focus handover. `openedFrom` is the row the reader tapped, so ← can
  // put focus back exactly where it came from; `phoneSwap` records whether the
  // one-screen swap was actually in effect when the transaction opened.
  const backRef = useRef<HTMLButtonElement>(null)
  const openedFrom = useRef<string | null>(null)
  const phoneSwap = useRef(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)
  const ledgerTabRef = useRef<HTMLButtonElement>(null)
  const closeTabRef = useRef<HTMLButtonElement>(null)
  const cashRef = useRef<HTMLDivElement>(null)
  const signoffRef = useRef<HTMLButtonElement>(null)

  const visible = useMemo(() => props.rows.filter((r) => matchesFilter(r, filter)), [props.rows, filter])
  // The open transaction follows the list: a selection the current filter no
  // longer shows falls back to the first row rather than leaving the workspace
  // describing something the reader cannot see (⚖ A10).
  const current = visible.find((r) => r.id === selected) ?? visible[0] ?? null

  // ⚖ THE SWAP MUST NOT STRAND THE READER (the room-3 F5 lesson, inherited). At
  // ≤743 opening a transaction hides the ledger — including the row that was
  // focused — so focus is MOVED with the screen: into the ← control on open,
  // back onto the row that opened it on close. The band test is the DOM's, not a
  // restated 743: the ← is rendered at every width and hidden by the sheet above
  // the phone band, so "is ← on screen" IS "is the swap in effect".
  useEffect(() => {
    if (detailOpen) {
      phoneSwap.current = backRef.current !== null && backRef.current.offsetParent !== null
      if (phoneSwap.current) backRef.current!.focus()
      return
    }
    if (!phoneSwap.current) return
    phoneSwap.current = false
    const row = openedFrom.current
    openedFrom.current = null
    if (row) document.getElementById(row)?.focus()
  }, [detailOpen])

  // ⑨ THE POINT FADES. A landing mark that stayed would become decoration on the
  // next render; it is a gesture, not a state of the day.
  useEffect(() => {
    if (pointingAt === null) return
    const t = setTimeout(() => setPointingAt(null), 2600)
    return () => clearTimeout(t)
  }, [pointingAt])

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────
  //
  // THE REGISTRY. A section joins the walk by declaring `data-guide-title` +
  // `data-guide` ON ITSELF, so there is no list to keep in sync: a section that
  // renders is a section that is explained, and one that is not on screen — the
  // whole 閉店 mode while the reader is in 取引, the ledger on a phone showing a
  // transaction, a day-strip folded to one line, the zero-day card on any day
  // with takings — drops out of the walk and out of the N/M count by itself.
  //
  // EVERY DECLARATION HOLDS ITS OWN HEADING (the room-3 tap-target finding): the
  // thing a reader points at is the WORD, so a `data-guide` on the box alone
  // leaves the 見出し outside the rect and a tap on it hits the scrim and CLOSES
  // the walk. Sections here wrap heading AND box in one declared element.
  const tourRectsRef = useRef<SpotRect[]>([])
  const [tourStep, setTourStep] = useState<TourStep | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    // ⚖ THE WALK IS CLAMPED TO THE CENSUS THAT IS ON SCREEN NOW (F-S4). A render
    // this effect did not cause — a mode switch, a fold opening, a filter that
    // empties the list — changes how many sections exist, and step 15 of a walk
    // that now has 11 is not a step. The index is corrected in state rather than
    // only in the card's text, or 次へ would go on counting from the walk that
    // has gone.
    const i = Math.min(tourIdx, targets.length - 1)
    if (i !== tourIdx) { setTourIdx(i); return }
    const el = targets[i]
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 160 }
    // ⚖ ≤743 THE CARD IS PINNED TO THE BOTTOM, so the section it explains has a
    // free zone ABOVE it (F-S11). A phone has no free side: `spotCardAt` places
    // the card beside its target, and beside is nowhere when the target is the
    // full width of the screen — the card landed on the very band it was
    // explaining. Pinned, the free zone is everything above the card, and the
    // step is scrolled into it.
    const narrow = window.innerWidth <= 743
    const freeBottom = narrow ? window.innerHeight - size.height - 20 : window.innerHeight - 40
    // A step off screen is scrolled to before it is measured, or the spotlight
    // would cut its hole in empty space. The PAGE scrolls — the overlay adds no
    // scroller of its own (⚖ page-scroll).
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > freeBottom) {
      // A section taller than the free zone cannot fit inside it at all, so the
      // top of it — the heading the step is about — is what is put on screen.
      if (narrow) window.scrollBy(0, r.top - 60)
      else el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const nextStep = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    // BOTH writes are identity-guarded, and `tourStep` is its own dependency:
    // the effect runs a second time ONLY so the card can be measured carrying
    // this step's real text, and a fresh object every pass would be an infinite
    // render loop.
    setTourStep((was) => (was && sameStep(was, nextStep) ? was : nextStep))
    const at = narrow
      ? {
          top: Math.round(window.innerHeight - size.height - 10),
          left: Math.max(10, Math.round((window.innerWidth - size.width) / 2)),
        }
      : spotCardAt(boxOf(r), size, { width: window.innerWidth, height: window.innerHeight })
    const next = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && samePos(was, next) ? was : next))
    // ⚖ EVERY RENDER THAT CHANGES WHICH SECTIONS EXIST RE-WALKS. The census is
    // read off the DOM, so the deps are the state the DOM is a function of —
    // the mode, the phone's one-screen swap, the filter (an empty list mounts
    // no transaction panel), the folds, and the server's own props.
  }, [tourIdx, tourTick, tourStep, mode, detailOpen, filter, folds, denOpen, props])

  // ONE keyboard listener for the two things that can be open, innermost first:
  // while the tour is up it owns Escape (and the arrows walk the ring), and only
  // once it is closed does Escape reach the phone's detail view. Two listeners
  // would both fire on one Escape and close both at once.
  useEffect(() => {
    if (!detailOpen && !tourOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (tourOpen) {
        if (e.key === 'Escape') setTourIdx(-1)
        if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
        if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
        // ⚖ THE TOUR IS A REAL MODAL, AND A SCRIM THAT ONLY STOPS THE MOUSE IS
        // NOT ONE (F-S3). The catcher takes every click, but Tab walked STRAIGHT
        // THROUGH it into the dimmed page — and a keyboard reader who kept going
        // could press a filter they could not see moving. Tab is owned here for
        // as long as the walk is up: it cycles the card's own controls, from
        // wherever focus happens to be, so nothing under the scrim is reachable
        // and no key can operate it.
        if (e.key === 'Tab') {
          const card = tourCardRef.current
          if (card === null) return
          const stops = [...card.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]
          if (stops.length === 0) return
          e.preventDefault()
          const at = stops.indexOf(document.activeElement as HTMLButtonElement)
          const to = e.shiftKey
            ? at <= 0 ? stops.length - 1 : at - 1
            : at < 0 || at === stops.length - 1 ? 0 : at + 1
          stops[to].focus()
        }
        return
      }
      if (e.key === 'Escape') setDetailOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [detailOpen, tourOpen])

  // The hole is drawn in viewport coordinates, so anything that moves the page
  // under it — a scroll, a resize, the ≤743 band arriving — has to re-measure.
  useEffect(() => {
    if (!tourOpen) return
    const bump = () => setTourTick((t) => t + 1)
    window.addEventListener('resize', bump)
    window.addEventListener('scroll', bump, true)
    return () => {
      window.removeEventListener('resize', bump)
      window.removeEventListener('scroll', bump, true)
    }
  }, [tourOpen])

  // ⚖ THE KEYBOARD MUST NOT BE STRANDED BY THE TOUR. Opening it puts focus on
  // 次へ, so Enter walks the ring exactly as the arrows do; closing it puts focus
  // back on the ? it came from. `wasOpen` is what keeps the close half from
  // firing on the first render, when nothing was open and nothing should move.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (tourOpen) {
      wasOpen.current = true
      tourNextRef.current?.focus()
      return
    }
    if (!wasOpen.current) return
    wasOpen.current = false
    helpRef.current?.focus()
  }, [tourOpen])

  /** ⑤ A FILTER NEEDS ITS LIST. Pressing a counter narrows the ledger — so it
   *  also carries the reader to where the ledger IS, which from 閉店 means back
   *  to 取引 with that filter applied, and on a phone means back to the list. */
  const choose = (next: RegisterFilter) => {
    setFilter(next)
    setMode('ledger')
    setDetailOpen(false)
  }

  /** ⑨ AN UNFINISHED GATE IS A DOORWAY. Where it leads is the verdict's, not the
   *  markup's — this only executes it. */
  const takeJump = (jump: ClosingJump) => {
    if (jump.kind === 'here') {
      setPointingAt(jump.target)
      const el = jump.target === 'cash' ? cashRef.current : signoffRef.current
      el?.scrollIntoView({ block: 'nearest' })
      // A control the reader can actually reach takes focus with the point; a
      // panel body is not focusable and simply gets the mark.
      if (jump.target === 'signoff') signoffRef.current?.focus()
      return
    }
    setFilter(jump.filter)
    if (jump.tx) setSelected(jump.tx)
    setMode('ledger')
    setDetailOpen(jump.tx !== null)
  }

  const toggleFold = (key: FoldKey) => setFolds((f) => ({ ...f, [key]: !f[key] }))

  const footnoteId = current ? `rgFootnote-${current.id}` : undefined
  const close = props.close
  const cash = close?.cash
  // ⚖ THE DRAWER IS 現金計数's OWN SURFACE, so it obeys the same presence law as
  // the checklist row — and reads THE VERY ROW, so the two cannot disagree about
  // whether this store closes a drawer at all. A shop that took no cash and put
  // no float in has no 期待額 ¥0 / 実査額 ¥0 panel to scroll past.
  const showCash = close !== null && close.checks.some((c) => c.key === 'cash')
  // A `const`, so the sheet's presence narrows inside the cells' own callback.
  const den = cash?.denominations ?? null

  return (
    // `is-detail` needs a detail to show: a filter that matches nothing renders
    // no transaction panel, and hiding the list for a panel that is not there
    // would leave a phone reader on a blank screen.
    <div
      // `is-touring` is ≤743's alone: the tour card is pinned to the bottom of a
      // phone, and the LAST section on the page has nothing under it to scroll
      // into — so the page reserves the card's height while the walk runs (F-S11).
      className={`${ROOT} ${mode === 'close' ? 'is-close' : 'is-ledger'}${detailOpen && current ? ' is-detail' : ''}${tourOpen ? ' is-touring' : ''}`}
      ref={rootRef}
    >
      <header
        className="rg-head"
        data-guide-title="売上・レジ"
        data-guide="その日のお金をひとつの台帳で照合する画面です。上の帯はその日ぜんぶに当てはまる事実で、その下は「取引」と「閉店」の2つの仕事に分かれています。金額はすべて記録された取引から計算していて、この画面が独自に持っている数字はありません。"
      >
        <div className="rg-eyebrow">{props.dateline}</div>
        <div className="rg-titleline">
          <h1>売上・レジ</h1>
          {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, the same one 今日の運営
              and 受信トレイ have: a spotlight walk of everything on this screen,
              and during the walk you can tap any part of the page to jump
              straight to what it is. A hairline circle, never a filled one
              (⚖ R13). */}
          <button
            className="rg-help"
            type="button"
            ref={helpRef}
            title="画面の説明"
            aria-label="画面の説明"
            aria-haspopup="dialog"
            aria-expanded={tourOpen}
            aria-controls="rgTour"
            onClick={() => setTourIdx(0)}
          >
            ?
          </button>
        </div>
        <p className="rg-subtitle">{props.subtitle}</p>
      </header>

      {/* canon `renderPermissionNotice` — what this role cannot do, in one
          sentence, before anyone reaches for a control that is not there. It
          states the RULE (totals hidden, individual transactions visible), not a
          list of blanks for the reader to find the pattern in. */}
      {props.permissionNotice && (
        <div
          className="rg-permission"
          role="status"
          data-guide-title="この役割でできること"
          data-guide="いま開いている人の権限では表示しない金額と、実行できない操作の案内です。隠しているのは1日の合計金額と現金で、取引1件ごとの内容はそのまま読めます。"
        >
          {props.permissionNotice}
        </div>
      )}

      {/* ⧉ 決済端末 — EXCEPTION FIRST, AND ONLY WHEN THERE IS ONE (the mock's ④
          lever). The band renders because the day HOLDS a record, so a business
          with no card terminal never sees it and nobody had to write a
          business-type branch to arrange that. */}
      {props.terminal && (
        <section
          className={`rg-terminal${folds.terminal ? ' is-open' : ''}`}
          aria-label="決済端末の状態"
          data-guide-title="決済端末の状態"
          data-guide="カード決済の端末が送信できていない取引を持っているときにだけ出る帯です。件数と金額、そして重複して請求されていないことを出します。保持が1件でもあると閉店できません。"
        >
          <div className="rg-terminal-main">
            <span className="rg-terminal-icon" aria-hidden="true">!</span>
            <span>
              <strong>{props.terminal.title}</strong>
              <span>{props.terminal.copy}</span>
            </span>
            {/* ⑬ the phone's 閉店 screen keeps this band's HEADLINE — an exception
                the closer cannot see is the worst possible fold — and puts the
                figures and the control one tap away. Never on a pointer width. */}
            {/* ⚖ F-S12 — THE NAME CARRIES THE STATE. A fold that is already open
                and still calls itself 「詳細を開く」 tells a screen-reader reader the
                opposite of what pressing it does. NO `aria-controls` here on
                purpose: what this fold opens is the band's three stat cells and
                its action, which are grid items of the band itself rather than
                one region with an id — and an `aria-controls` naming an element
                that does not exist is the very fault this item removes from the
                tab pair. */}
            <button
              className="rg-terminal-more"
              type="button"
              aria-expanded={folds.terminal}
              aria-label={folds.terminal ? props.terminal.foldCloseLabel : props.terminal.foldLabel}
              onClick={() => toggleFold('terminal')}
            >
              <span className="rg-den-chev" aria-hidden="true">›</span>
            </button>
          </div>
          {props.terminal.stats.map((s) => (
            <div className="rg-terminal-stat" key={s.label}>
              <span>{s.label}</span>
              <b className={s.tone}>{s.value}</b>
            </div>
          ))}
          {/* ⚑ THE CELL GOES WITH ITS BUTTON. An empty bordered slot holding
              nothing is the species of dead space this restructure exists to
              remove — so a role without the capability gets neither. */}
          {props.terminal.canRecheck && (
            <div className="rg-terminal-action">
              {/* A WRITE — it talks to a real device. */}
              <Refused label={props.terminal.recheckLabel} reason={props.terminal.recheckRefusal} />
            </div>
          )}
        </section>
      )}

      {/* ⑰ ≤743 + 閉店 only. One line each, carrying the two figures that decide
          something — and both of them say WHAT they count. */}
      {/* ⚖ F-S12 — a fold NAMES THE REGION IT OPENS. All three of these regions
          render at every width (the phone band folds them with `display`, it
          does not unmount them), so the id is always in the document. */}
      <button
        className="rg-fold"
        type="button"
        aria-expanded={folds.money}
        aria-controls="rgMoney"
        onClick={() => toggleFold('money')}
        data-guide-title="本日のレジ（たたんだ表示）"
        data-guide="スマートフォンで閉店の作業をしているあいだ、本日のレジの帯を一行にたたんでいます。押すと元の帯がそのまま開きます。数字を隠しているのではなく、数えるための場所を先に出しています。"
      >
        本日のレジ
        <em>{props.moneyFold}</em>
        <span className="rg-den-chev" aria-hidden="true">›</span>
      </button>

      {/* 本日の売上集計 — FACTS, not filters. Every figure is a sum over the rows
          the ledger below prints; none of them is pressable, and the aria says
          so rather than leaving the reader to guess from the shape. */}
      <section
        className={`rg-money${folds.money ? ' is-open' : ''}`}
        id="rgMoney"
        aria-label="本日の売上集計"
        data-guide-title="本日の売上集計"
        data-guide="その日のお金の合計です。総売上から返金を引いたものが純売上で、そのうち実際に受け取った分が受領済み、まだいただいていない分が未収です。すべて下の台帳の取引を足したもので、押しても絞り込みは変わりません。"
      >
        <div className="rg-money-main">
          <strong>本日のレジ</strong>
          <span>{props.moneyScope}</span>
        </div>
        {props.money.map((m) => (
          <div className="rg-money-cell" key={m.key}>
            <span>{m.label}</span>
            <b className={[m.tone, m.redacted ? 'redacted' : ''].filter(Boolean).join(' ') || undefined}>{m.value}</b>
          </div>
        ))}
      </section>

      <button
        className="rg-fold"
        type="button"
        aria-expanded={folds.counts}
        aria-controls="rgCounts"
        onClick={() => toggleFold('counts')}
        data-guide-title="本日の取引（たたんだ表示）"
        data-guide="件数の帯も、スマートフォンの閉店では一行にたたんでいます。押すと件数のボタンがそのまま開き、そこから取引モードへ戻れます。"
      >
        本日の取引
        <em>{props.countsFold}</em>
        <span className="rg-den-chev" aria-hidden="true">›</span>
      </button>

      {/* ⑤ 取引の件数 — the numbers ARE the filters, in BOTH modes. Every counter
          presses the filter that shows exactly the rows it counted
          (COUNTER_FILTER, and `countBy` counts through the same `matchesFilter`),
          and pressing one from 閉店 returns to 取引 where that list is. */}
      <section
        className={`rg-counts${folds.counts ? ' is-open' : ''}`}
        id="rgCounts"
        aria-label="取引の件数"
        data-guide-title="取引の件数"
        data-guide="状態ごとの取引の件数です。数字はそのまま絞り込みボタンで、押すと取引モードに戻って台帳がその件数ぶんだけに切り替わります。一部入金と要確認は0件でなければ色がつきます。"
      >
        <button
          className="rg-count-main"
          type="button"
          aria-pressed={filter === COUNTER_FILTER.all}
          onClick={() => choose(COUNTER_FILTER.all)}
        >
          <strong>本日の取引 {props.counts.all}件</strong>
        </button>
        {COUNTER_STATS.map((s) => (
          <button
            key={s.key}
            className="rg-count"
            type="button"
            aria-pressed={filter === COUNTER_FILTER[s.key]}
            onClick={() => choose(COUNTER_FILTER[s.key])}
          >
            <span>{s.label}</span>
            <b className={s.alarm && props.counts[s.key] > 0 ? 'attention' : undefined}>{props.counts[s.key]}件</b>
          </button>
        ))}
      </section>

      {/* ⧉ THE MODE TABS — the whole restructure in one row.
          THEY ARE NOT NAVIGATION and they are NOT FILTERS. A filter narrows one
          list; these two show the SAME day doing two different JOBS, so they are
          tabs over one object. The 閉店 tab carries its status, so the closer
          knows whether the day is blocked WITHOUT leaving the transaction desk to
          find out (⑥). A role that may not close gets NO TAB ROW AT ALL — one
          view needs no tabs (⑮/ruling (a)). */}
      {close && (
        <div
          className="rg-modes"
          role="tablist"
          aria-label="表示するモード"
          data-guide-title="取引と閉店の切り替え"
          data-guide="同じ日のふたつの仕事を切り替えるタブです。ページを移動するのではなく、同じ日を別の見方で開きます。閉店タブには、いま閉店を止めている項目の数がそのまま出ます。"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            const next = mode === 'ledger' ? 'close' : 'ledger'
            setMode(next)
            ;(next === 'close' ? closeTabRef : ledgerTabRef).current?.focus()
          }}
        >
          {/* ⚖ F-S12 — ARIA THAT IS TRUE OF WHAT IS ON THE PAGE. Only the open
              mode's panel is mounted, so only the selected tab may name one:
              `aria-controls` pointing at an id that is not in the document is a
              promise to a screen reader that nothing can keep. And the pair is a
              ROVING TABINDEX, which is what makes a tablist one tab stop whose
              arrows move between the two — the arrow keys were already wired. */}
          <button
            className="rg-mode"
            type="button"
            role="tab"
            id="rgTabLedger"
            ref={ledgerTabRef}
            aria-selected={mode === 'ledger'}
            aria-controls={mode === 'ledger' ? 'rgPanelLedger' : undefined}
            tabIndex={mode === 'ledger' ? 0 : -1}
            onClick={() => setMode('ledger')}
          >
            取引 <span className="rg-mode-n">{props.counts.all}件</span>
          </button>
          <button
            className="rg-mode"
            type="button"
            role="tab"
            id="rgTabClose"
            ref={closeTabRef}
            aria-selected={mode === 'close'}
            aria-controls={mode === 'close' ? 'rgPanelClose' : undefined}
            tabIndex={mode === 'close' ? 0 : -1}
            onClick={() => setMode('close')}
          >
            閉店 <span className={`pill ${close.openCount === 0 ? 'good' : 'warn'}`}>{close.headline}</span>
          </button>
        </div>
      )}

      {/* ══════════ MODE 取引 ══════════ */}
      {mode === 'ledger' && (
        <div
          className="rg-mode-panel"
          id="rgPanelLedger"
          role={close ? 'tabpanel' : undefined}
          aria-labelledby={close ? 'rgTabLedger' : undefined}
        >
          {props.emptyDay ? (
            // 本日まだ取引なし is the NORMAL state of a morning, not an error
            // state, so it gets a designed moment instead of an empty panel. The
            // workspace is not mounted at all behind it.
            <section
              className="rg-zero"
              aria-label="本日の取引はまだありません"
              data-guide-title="本日の取引はまだありません"
              data-guide="まだ会計が1件も記録されていない状態です。最初の会計が入るとここに台帳が出ます。閉店チェックはこの状態でも使えます。"
            >
              <div className="rg-zero-card">
                <span className="rg-zero-mark" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12h16" />
                  </svg>
                </span>
                <strong>本日の取引はまだありません</strong>
                <p>会計を記録するとここに並びます · {props.lensLabel}</p>
              </div>
            </section>
          ) : (
            <div className="rg-workspace">
              <section
                className="rg-panel rg-ledger"
                aria-labelledby="rgLedgerTitle"
                data-guide-title="取引・決済台帳"
                data-guide="その日の取引が新しい順に並びます。1件を押すと右側にその取引の中身が開きます。金額は売上と受領を分けて出していて、未収があるときは受領の下に色つきで出ます。"
              >
                <div className="rg-panel-head">
                  <div>
                    <strong id="rgLedgerTitle">取引・決済台帳</strong>
                    <span>
                      {visible.length}件を表示 / 新しい順 · {props.lensLabel}
                    </span>
                  </div>
                  {/* ⑲ A レジ THAT CANNOT RING A SALE IS A LEDGER, NOT A REGISTER.
                      The button belongs beside the ledger it would add a row to;
                      the screen behind it — item, quantity, payment — is its own
                      registry line and is not built here. */}
                  <div className="rg-head-act">
                    <Refused className="btn primary" label={props.sellLabel} reason={props.sellRefusal} />
                  </div>
                </div>

                {/* QUIET TEXT, not buttons: a filter narrows a view, it does not
                    act, so it gets no border and no fill — selected is an accent
                    label plus a 2px accent underline. The row wraps rather than
                    panning, so no container in this room owns an axis
                    (⚖ page-scroll). */}
                <div
                  className="rg-filters"
                  role="group"
                  aria-label="台帳の絞り込み"
                  data-guide-title="台帳の絞り込み"
                  data-guide="台帳に出す取引を状態でしぼる行です。上の件数と同じ区分で、どちらから押しても同じ結果になります。押しても取引の内容は変わらず、見えている範囲が変わるだけです。"
                >
                  {props.filters.map((f) => (
                    <button
                      key={f.key}
                      className="rg-filter"
                      type="button"
                      aria-pressed={filter === f.key}
                      onClick={() => choose(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {visible.length === 0 ? (
                  <div className="rg-empty">
                    <strong>この条件の取引はありません</strong>
                    <span>別の絞り込みを選んでください。</span>
                  </div>
                ) : (
                  <div className="rg-list">
                    {visible.map((r) => (
                      <button
                        key={r.id}
                        id={`rgRow-${r.id}`}
                        type="button"
                        className={`rg-row${r.id === current?.id ? ' selected' : ''}`}
                        aria-pressed={r.id === current?.id}
                        onClick={() => {
                          openedFrom.current = `rgRow-${r.id}`
                          setSelected(r.id)
                          setDetailOpen(true)
                        }}
                      >
                        {/* ⚖ A ROW WITH NOBODY IN IT IS A LINE SHORTER. A counter
                            sale the shop never recorded a person for has no name
                            to put on top, so what was sold takes the headline and
                            the row drops the line that would have held a
                            placeholder. */}
                        <span className={`rg-copy${r.nameless ? ' rg-copy-compact' : ''}`}>
                          <span className="rg-line1">
                            <strong>{r.title}</strong>
                            <span className="rg-no">{r.id}</span>
                            {r.nameless && <span className={r.pill}>{r.stateLabel}</span>}
                            <time>{r.atLabel}</time>
                          </span>
                          {!r.nameless && (
                            <span className="rg-line2">
                              <span className="rg-what">{r.what}</span>
                              <span className={r.pill}>{r.stateLabel}</span>
                            </span>
                          )}
                          <span className="rg-line3">
                            <span className="rg-tender">
                              {r.nameless ? `店頭販売 · ${r.tenderSummary}` : r.tenderSummary}
                            </span>
                            <span className="rg-amounts">
                              <b>{r.totalLabel}</b>
                              {r.subAmount && (
                                <em className={r.subAmount.tone}>
                                  {r.subAmount.label} {r.subAmount.value}
                                </em>
                              )}
                            </span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="rg-foot">
                  返金・取消をしても、予約時の確定価格と元の決済行は書き換えません。反対仕訳と理由、承認者を新しい監査行として追加します。
                </p>
              </section>

              {current && (
                <section
                  className="rg-panel rg-detail"
                  aria-labelledby="rgDetailTitle"
                  data-guide-title="開いている取引"
                  data-guide="台帳で選んだ1件の中身です。上に取引の見出しとできること、下に事実、決済手段、予約時価格、閉店への影響、そして操作の履歴が並びます。台帳が長い日でもこの列は画面に貼りついたまま残ります。"
                >
                  <div className="rg-band">
                    <div className="rg-band-id">
                      {/* ≤743's way back to the ledger. Hidden at every wider
                          width by the sheet, because there the ledger never
                          left. */}
                      <button className="rg-back" type="button" ref={backRef} onClick={() => setDetailOpen(false)}>
                        ← 台帳へ戻る
                      </button>
                      <div className="rg-kicker">
                        {current.stateLabel} / 決済 {current.tenders.length}行
                      </div>
                      <h2 id="rgDetailTitle">{current.title}</h2>
                      <p>
                        {current.id} / {current.atLabel} / {current.what}
                      </p>
                    </div>
                    <div
                      className="rg-act"
                      data-guide-title="この取引でできること"
                      data-guide="開いている取引に対する操作です。返金・取消と未収の記録は実際にお金と記録を動かす操作のため、見本データのあいだは理由を出して止めてあります。予約一覧を開いて確かめる操作は読むだけなので、いまも動きます。"
                    >
                      <div className="rg-act-row">
                        {/* A WRITE, and the most consequential one on the page:
                            it moves real money back to a real person. Refused,
                            with its own reason on its own accessible name — and
                            what it WOULD reverse is printed below, because
                            refusing to act is honest and hiding what the action
                            would have done is not. A role without the capability
                            gets no control at all. */}
                        {current.canRefund && current.showRefund && (
                          <Refused
                            className="btn danger"
                            label="返金・取消"
                            reason={current.refundRefusal}
                            describedBy={footnoteId}
                          />
                        )}
                        {/* ⑤ THE 未収 GATE'S LANDING POINT. The checklist sends the
                            closer here, so here is where the carry-forward
                            decision has to be recordable — a clinic with daily
                            receivables closes every evening by making exactly
                            this decision. */}
                        {current.canOutstanding && current.showOutstanding && (
                          <Refused
                            label={current.outstandingLabel}
                            reason={current.outstandingRefusal}
                            describedBy={footnoteId}
                          />
                        )}
                        {current.bookingHref ? (
                          <Link className="btn" href={current.bookingHref}>
                            {BOOKING_LABEL}
                          </Link>
                        ) : (
                          // The refused shape of the SAME control, and it gets
                          // the same treatment: the reason rides its accessible
                          // name, never `title` alone.
                          <Refused label={BOOKING_LABEL} reason={current.bookingRefusal} />
                        )}
                      </div>
                      {/* THE REFUSAL, in ONE line. It is on screen before anyone
                          reaches for a control, it changes nothing, and it stays
                          — no toast, no flash, nothing to outrun (⚖ 47). */}
                      <p className="rg-footnote" id={footnoteId}>
                        {props.actionFootnote}
                      </p>
                    </div>
                  </div>

                  <div className="rg-body">
                    <div className="rg-grid">
                      <div>
                        <div
                          className="rg-sec"
                          data-guide-title="取引の事実"
                          data-guide="この取引について記録されている事実です。どの予約の会計か、どこから受け付けたか、売上はいくらで、そのうちいくら受け取り、いくら残っているか。ここに出るのは記録された内容だけで、推測は入りません。"
                        >
                          <div className="rg-title">取引の事実</div>
                          <div className="rg-facts">
                            {current.facts.map((f) => (
                              <div className="rg-fact" key={f.label}>
                                <span>{f.label}</span>
                                <b className={f.tone}>{f.value}</b>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div
                          className="rg-sec"
                          data-guide-title="決済手段の台帳"
                          data-guide="お金がどの手段で動いたかを1行ずつ残したものです。返金は元の行を書き換えず、マイナスの行を足して残します。未収の行はお金が入っていないので、受領済みには数えません。"
                        >
                          <div className="rg-title">決済手段の台帳</div>
                          <div className="rg-tenders">
                            {current.tenders.map((t, i) => (
                              <div className={`rg-tender-row ${t.tone ?? ''}`} key={`${t.label}-${i}`}>
                                <span>{t.label}</span>
                                <b>{t.amount}</b>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div>
                        <div
                          className="rg-sec"
                          data-guide-title="予約時価格のスナップショット"
                          data-guide="予約を受けたときに確定した金額です。売上も返金もこの金額を正本にしていて、いまの公開価格が変わっても計算しなおしません。予約のない店頭販売にはスナップショットがないので、そう書きます。"
                        >
                          <div className="rg-title">予約時価格のスナップショット</div>
                          <p className="rg-proof">{current.priceProof}</p>
                        </div>

                        <div
                          className="rg-sec"
                          data-guide-title="返金・取消の内容"
                          data-guide="返金を実行したときに何が記録されるかを、実行する前に出しています。元の決済行はそのまま残り、同じ手段にマイナスの行が足されます。いまは見本データのため実行できませんが、何が起きるかは隠しません。"
                        >
                          <div className="rg-title">返金・取消の内容</div>
                          <div className="rg-preview">
                            {current.refundPreview && <b>{current.refundPreview}</b>}
                            <span>{current.refundNote}</span>
                          </div>
                        </div>

                        <div
                          className="rg-sec"
                          data-guide-title="閉店への影響"
                          data-guide="この取引が閉店を妨げているかどうかです。閉店タブの閉店チェックとまったく同じ判定を読んでいるので、タブが違っても言うことは1つです。"
                        >
                          <div className="rg-title">閉店への影響</div>
                          <p className="rg-impact">{current.closingImpact}</p>
                        </div>
                      </div>
                    </div>

                    <div
                      className="rg-hist"
                      data-guide-title="監査履歴"
                      data-guide="この取引に対して行われた操作の記録です。新しいものが先頭で、左から右へ時間をさかのぼります。会計、返金、端末の保持など、予約側に残った記録もここに合流します。"
                    >
                      <div className="rg-title-row">
                        <div className="rg-title">監査履歴</div>
                        <span className="rg-order">新しい順</span>
                      </div>
                      {current.history.length === 0 ? (
                        <p className="rg-none">この取引の操作履歴はまだ記録されていません。</p>
                      ) : (
                        <div className="rg-hist-rows">
                          {current.history.map((h, i) => (
                            <div className="rg-history-row" key={i}>
                              <time>{h.time}</time>
                              <span>
                                <strong>{h.what}</strong>
                                <span>{h.detail}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ⚖ A CLOSE BELONGS TO ONE STORE. Under the storeless lens there is no
              drawer to count, so the room says so — once, quietly, where the tab
              row would have been — rather than merging two stores' closes into a
              figure nobody could act on. A role that may not close is told
              nothing, because it is not their room. */}
          {props.closeUnavailable && (
            <section
              className="rg-panel rg-noclose"
              aria-label="閉店処理"
              data-guide-title="閉店処理"
              data-guide="閉店は店舗ごとに行います。いまは店舗を選んでいないため、閉店のタブは出していません。サイドバーで店舗を選ぶと、その店舗の閉店の画面が開きます。"
            >
              <div className="rg-panel-head">
                <div>
                  <strong>閉店処理</strong>
                  <span>店舗を選ぶと表示されます</span>
                </div>
              </div>
              <p className="rg-noclose-note">{props.closeUnavailable}</p>
            </section>
          )}
        </div>
      )}

      {/* ══════════ MODE 閉店 ══════════ */}
      {close && cash && mode === 'close' && (
        <div className="rg-mode-panel" id="rgPanelClose" role="tabpanel" aria-labelledby="rgTabClose">
          <div className="rg-closing">
            {/* ② THE CHECKLIST IS THE SPINE, and every gate carries its OWN
                evidence on its own row. The closer reads one column top to bottom
                and knows exactly what is stopping the day; nothing has to be
                gathered from three other bands. A ROW RENDERS ONLY WHEN ITS
                SUBJECT EXISTS IN THE DAY — the 26業種 lever, with no business-type
                branch anywhere. */}
            <section
              className="rg-panel rg-close"
              aria-labelledby="rgCloseTitle"
              data-guide-title="閉店チェック"
              data-guide="その日を閉じる前に終わっていなければならないことの一覧です。終わっていない行はそのまま押せて、直す場所へ連れていきます。どれか1つでも未完了なら閉店できず、その理由は閉店ボタンにもそのまま出ます。この判定は画面のどこで出しても同じひとつの計算です。"
            >
              <div className="rg-panel-head">
                <div>
                  <strong id="rgCloseTitle">閉店チェック</strong>
                  <span>店舗管理者の確認後に、その時点の台帳を閉じます</span>
                </div>
                <span className={`pill ${close.openCount === 0 ? 'good' : 'warn'}`}>{close.headline}</span>
              </div>
              <div className="rg-close-body">
                <div className="rg-checks">
                  {close.checks.map((c) => {
                    const body = (
                      <>
                        <span>
                          <strong>{c.label}</strong>
                          <span>{c.detail}</span>
                        </span>
                        <span className={`pill ${c.done ? 'good' : 'warn'}`}>{c.status}</span>
                      </>
                    )
                    // ⑨ PRESSABILITY IS DERIVED FROM THE DAY, never authored into
                    // the markup: the row is a doorway exactly when the verdict
                    // gave it somewhere to go. A settled gate has nowhere to send
                    // anyone, so it is not a control at all — and a gate whose fix
                    // lives in another room is not one either, because an
                    // affordance that leads nowhere is the lie this fixes.
                    return c.jump ? (
                      // ⚖ F-S13 — AN ACCESSIBLE NAME COMPOSES, IT NEVER REPLACES.
                      // The row prints three things a closer acts on — what the
                      // gate is, the EVIDENCE under it, and its status chip — and
                      // an `aria-label` naming only the gate and its destination
                      // silently deleted the other two for anyone listening. The
                      // name is the row, then where pressing it goes.
                      <button
                        key={c.key}
                        type="button"
                        className="rg-check"
                        aria-label={`${c.label} — ${c.detail} — ${c.status} — ${jumpLabelOf(c.jump)}`}
                        onClick={() => takeJump(c.jump!)}
                      >
                        {body}
                        <span className="rg-check-go" aria-hidden="true">›</span>
                      </button>
                    ) : (
                      <div className="rg-check" key={c.key}>
                        {body}
                      </div>
                    )
                  })}
                </div>
              </div>
              <p className="rg-foot">
                どれか1つでも未完了なら閉店できず、その理由は閉店ボタンにもそのまま出ます。この判定は画面のどこで出しても同じひとつの計算です。
              </p>
            </section>

            <div className="rg-right">
              {showCash && (
              <section
                className="rg-panel rg-cash"
                aria-labelledby="rgCashTitle"
                data-guide-title="現金ドロア"
                data-guide="期待額は、開店時の釣銭準備金にその日の現金の受領を足して返金を引いたものです。実査額は実際に数えた金額で、差異はその引き算です。金種で数えるを開くと、枚数を入れるだけで合計が出ます。許容額を超える差異があるときは、理由と店舗管理者の承認がないと閉店できません。"
              >
                <div className="rg-panel-head">
                  <div>
                    <strong id="rgCashTitle">現金ドロア</strong>
                    <span>期待額、実査額、差異理由を同じ計数記録へ保存します</span>
                  </div>
                  {/* ⧉ THE PANEL'S ACTION SITS AT THE TOP OF ITS BAND — the room's
                      own law, and the drawer was the one panel still leaving its
                      button floating at the bottom right. */}
                  <div className="rg-head-act">
                    <span className={`pill ${cash.statusDone ? 'good' : 'warn'}`}>{cash.status}</span>
                    {/* A WRITE — it records a count and a reason against the day. */}
                    <Refused label={cash.saveLabel} reason={cash.saveRefusal} describedBy="rgClosingFootnote" />
                  </div>
                </div>
                <div className={`rg-cash-body${pointingAt === 'cash' ? ' rg-flash' : ''}`} ref={cashRef}>
                  <div className="rg-cash-stats">
                    <div className="rg-cash-stat">
                      <span>期待額</span>
                      <b className={cash.redacted ? 'redacted' : undefined}>{cash.expected}</b>
                    </div>
                    <div className="rg-cash-stat">
                      <span>実査額</span>
                      {/* ⧉ THE COUNT ENTRY. 実査額 is the one figure a human types
                          into this page, so it wears a field rather than a printed
                          number — refused like every other write in the slice. For
                          a role that may not see the day's cash there is nothing
                          to type INTO, so the field is not a field at all. */}
                      {cash.redacted ? (
                        <b className="redacted">{cash.counted}</b>
                      ) : (
                        /* ⑫ + ⚖ THE SAME SENTENCE TWICE IS THE THING THIS ROOM
                           ALREADY DELETED ONCE. This field and 計数を保存 at the
                           top of the same panel are one write, refused for one
                           reason, and each printed that reason as its own touch
                           line — the identical paragraph twice, ~200px apart, on
                           the narrowest screen the room has. The line is printed
                           ONCE per panel per reason, at the button that performs
                           the write; the ONE-SOURCE rule is untouched, because
                           the field still carries the very same string as its
                           `title` and its accessible name. */
                        /* ⚖ THE FIELD IS AS WIDE AS THE FIGURE IN IT (F-S6). A
                           field CLIPS what will not fit and says nothing about
                           it, and the box it sits in was sized from the DEMO
                           figure — 124px, measured off ¥39,620 — so the first
                           seven-digit drawer printed 「¥9,990,00」, with 差異
                           computed from the digit the reader could not see.
                           A FIELD HAS NO CONTENT WIDTH of its own that a layout
                           can read (its intrinsic size comes from `size`, an
                           estimate in average characters that under-measures ¥,
                           the commas and tabular digits by about a tenth), so
                           the figure is handed to the box AS TEXT for the
                           browser to measure exactly. One value, written once —
                           the sizer is generated content, so there is no second
                           node for a screen reader to read it twice from. */
                        <span className="rg-count-box" data-count={cash.counted}>
                          <input
                            className="rg-cash-entry"
                            type="text"
                            readOnly
                            aria-label={`実査額 — ${cash.saveRefusal}`}
                            title={cash.saveRefusal}
                            value={cash.counted}
                          />
                        </span>
                      )}
                    </div>
                    <div className="rg-cash-stat">
                      <span>差異</span>
                      <b className={[cash.varianceBad ? 'bad' : '', cash.redacted ? 'redacted' : ''].filter(Boolean).join(' ') || undefined}>
                        {cash.variance}
                      </b>
                    </div>

                    {/* ⑩ 金種で数える — COLLAPSED BY DEFAULT, one line inside the
                        count box, directly under the figure it produces. Counting
                        by denomination is what every incumbent register already
                        does, and it is a mistake-proofing device before it is a
                        feature: the closer enters HOW MANY, the machine does the
                        arithmetic, and a mis-added column can no longer become a
                        差異 that never existed. */}
                    {!cash.redacted && den && (
                      <details
                        className="rg-den"
                        open={denOpen}
                        onToggle={(e) => setDenOpen(e.currentTarget.open)}
                        data-guide-title="金種で数える"
                        data-guide="お札と硬貨を種類ごとに何枚あるか入れる欄です。合計は機械が計算して、そのまま実査額になります。足し算を手でやらないので、数え間違いが差異になりません。ふだんは閉じたままで、必要なときだけ開きます。"
                      >
                        <summary>
                          <span className="rg-den-chev" aria-hidden="true">›</span>
                          {den.summaryLabel}
                          <span className="rg-den-note">{den.summaryNote}</span>
                        </summary>
                        <div className="rg-den-grid">
                          {den.rows.map((d) => (
                            <label className="rg-den-cell" key={d.key}>
                              <span>{d.label}</span>
                              <input
                                className="rg-den-n"
                                type="text"
                                readOnly
                                value={d.count}
                                aria-label={`${d.name}の枚数`}
                              />
                              <span className="rg-den-u">{den.unit}</span>
                            </label>
                          ))}
                        </div>
                        <p className="rg-den-sum">
                          {den.totalLabel} <b>{den.totalValue}</b>
                          <em>{den.totalNote}</em>
                        </p>
                      </details>
                    )}
                  </div>

                  {/* ⑪ A PAGE THAT ASKS FOR A REASON MUST HOLD ONE. The field
                      appears WHEN THE DAY HAS A 差異 — the same presence rule every
                      other band obeys — and the printed row stands down while it
                      is here, because the same verdict twice, 40px apart, is what
                      this room already deleted once. */}
                  {cash.reasonInput && (
                    <div
                      className="rg-cash-reason"
                      data-guide-title="差異理由"
                      data-guide="現金に差異が出た日にだけ表示されます。よくある理由はボタンで入れられて、そのまま計数記録に残ります。許容額を超える差異は、この理由と店舗管理者の承認がそろうまで閉店できません。"
                    >
                      <div className="rg-title">{cash.reasonInput.label}</div>
                      {/* ⚖ A REASON IS A SENTENCE, AND A SENTENCE WRAPS (F-S7).
                          Until the write is connected there is nothing to type
                          into, and a readOnly field CLIPS: a real 70-character
                          explanation lost its tail inside the box with nothing
                          saying it had. Read-only, it is TEXT — same box, same
                          place, whole at every width. The editable field returns
                          with the write, and the chips below already say what a
                          reason usually is. */}
                      <p className="rg-reason-in" title={cash.reasonInput.refusal}>
                        {cash.reasonInput.value}
                      </p>
                      <span className="rg-refusal" aria-hidden="true">{cash.reasonInput.refusal}</span>
                      <div className="rg-reason-chips">
                        {cash.reasonInput.chips.map((chip) => (
                          <button
                            key={chip}
                            className="rg-reason-chip"
                            type="button"
                            aria-disabled="true"
                            title={cash.reasonInput!.refusal}
                            aria-label={`${chip} — ${cash.reasonInput!.refusal}`}
                          >
                            {chip}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="rg-facts rg-cash-facts">
                    {/* ⚠ 期待額 EXPLAINS ITSELF. The float and the day's own cash
                        are the two halves that make it, so a closer can tell a
                        wrong expectation from a wrong drawer. */}
                    <div className="rg-fact">
                      <span>{cash.floatLabel}</span>
                      <b className={cash.redacted ? 'redacted' : undefined}>{cash.floatValue}</b>
                    </div>
                    <div className="rg-fact">
                      <span>{cash.dayCashLabel}</span>
                      <b className={cash.redacted ? 'redacted' : undefined}>{cash.dayCashValue}</b>
                    </div>
                    {!cash.reasonInput && (
                      <div className="rg-fact rg-fact-reason">
                        <span>差異理由</span>
                        <b>{cash.reason}</b>
                      </div>
                    )}
                    <div className="rg-fact">
                      <span>しきい値</span>
                      <b className={cash.redacted ? 'redacted' : undefined}>
                        {cash.tolerance}
                        {/* ⑥ THE DIAL'S HOME, NAMED ON THE ROW THAT USES IT. A
                            quiet link, refused with its reason — the settings room
                            is not live, and pointing at a route that would 404 is
                            worse than saying where the dial lives. */}
                        <Refused
                          className="rg-quietlink"
                          label={cash.toleranceLinkLabel}
                          reason={cash.toleranceLinkRefusal}
                        />
                      </b>
                    </div>
                  </div>
                </div>
              </section>
              )}

              {/* ⚖ A PANEL RENDERS ONLY WHEN ITS SUBJECT EXISTS IN THE DAY
                  (F-S5) — the same presence law the checklist rows and the
                  drawer band already obey. On a day that took nothing, and on a
                  day whose every sale is still owed, there is no money that
                  arrived to split by the手段 it arrived on: the panel used to
                  render an empty bordered box under its heading and then
                  reassure the closer that 「決済手段の内訳は受領済み ¥0 と一致して
                  います」 — a verdict about nothing, on a surface with no
                  subject. The heading, the box and the sentence go together. */}
              {close.reconciliation.length > 0 && (
              <section
                className="rg-panel rg-reconpanel"
                aria-labelledby="rgReconTitle"
                data-guide-title="決済手段の内訳"
                data-guide="受け取ったお金を決済手段ごとにまとめたものです。入った金額と戻した金額の合計が受領済みと一致していることを、閉店の前に確認します。"
              >
                <div className="rg-panel-head rg-head-tight">
                  <div>
                    <strong id="rgReconTitle">決済手段の内訳</strong>
                  </div>
                </div>
                <div className="rg-cash-body">
                  <div className="rg-recon">
                    {close.reconciliation.map((r) => (
                      <div className="rg-recon-row" key={r.label}>
                        <span className="rg-recon-ch">{r.label}</span>
                        {/* Each figure carries its own word. Three bare numbers in
                            a row are unreadable without a header, and a header row
                            disappears the moment the band stacks on a phone. */}
                        <span className="rg-recon-cell">
                          <em>受領</em>
                          <b className={cash.redacted ? 'redacted' : undefined}>{r.received}</b>
                        </span>
                        <span className="rg-recon-cell">
                          <em>返金</em>
                          <b className={`rg-recon-rev${cash.redacted ? ' redacted' : ''}`}>{r.reversed}</b>
                        </span>
                        <span className="rg-recon-cell">
                          <em>差引</em>
                          <b className={cash.redacted ? 'redacted' : undefined}>{r.net}</b>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className={`rg-recon-note${close.reconciliationBalanced ? '' : ' bad'}`}>
                    {close.reconciliationNote}
                  </p>
                </div>
              </section>
              )}
            </div>
          </div>

          {/* ⑱ ≤743: nine stacked rows between the checklist and the button
              become one line until the reader asks for them — which is the one
              moment they matter, just before 確定. */}
          <button
            className="rg-fold"
            type="button"
            aria-expanded={folds.record}
            aria-controls="rgRecord"
            onClick={() => toggleFold('record')}
            data-guide-title="記録される内容（たたんだ表示）"
            data-guide="閉店で固定される内容を、スマートフォンでは一行にたたんでいます。確定を押す直前に開いて、何が記録されるのかを確かめられます。"
          >
            記録される{close.record.length}項目を確認
            <em>{close.recordNote}</em>
            <span className="rg-den-chev" aria-hidden="true">›</span>
          </button>

          {/* ⧉ EVIDENCE ADJACENT TO THE ACTION IT PERMITS. In the shipped room
              this was a tall two-up table sitting under the pair with the confirm
              button somewhere above it — the reader signed first and read what
              they signed afterwards. Here it is one compact horizontal strip
              DIRECTLY above 閉店を確定: what will be frozen, then the button that
              freezes it. */}
          <section
            className={`rg-record${folds.record ? ' is-open' : ''}`}
            id="rgRecord"
            aria-label={close.recordLabel}
            data-guide-title="閉店で記録される内容"
            data-guide="閉店を確定したときに、その時点の台帳から固定して残る内容です。押す前に何が固定されるのかが見えるように、確定ボタンのすぐ上に置いています。承認した人の名前も、承認が済んだ日にはここに残ります。"
          >
            <div className="rg-rec-main">
              <strong>{close.recordLabel}</strong>
              <span>{close.recordNote}</span>
            </div>
            {close.record.map((r) => (
              <div className="rg-rec-cell" key={r.label}>
                <span>{r.label}</span>
                <b className={r.wrap ? 'wrap' : undefined}>{r.value}</b>
              </div>
            ))}
          </section>

          <div
            className="rg-close-actions"
            data-guide-title="閉店の操作"
            data-guide="その日を閉じる操作です。店舗管理者の確認は別の画面で記録し、閉店の確定はその時点の台帳を締めます。どちらも見本データのあいだは理由を出して止めてあります。"
          >
            {/* ⚑ R-1 — the 店舗管理者確認 page is SLICE B. The control says so
                rather than pointing at a route that does not exist yet: an honest
                refusal naming the next slice, never a dead href. */}
            <Refused
              id="rgApprove"
              className={`btn${pointingAt === 'signoff' ? ' rg-flash' : ''}`}
              label={close.signoffLabel}
              reason={close.signoffRefusal}
              describedBy="rgClosingFootnote"
              buttonRef={signoffRef}
            />
            {/* A WRITE, and the reason it refuses carries the checklist's OWN
                blocker list — one verdict, rendered again. */}
            <Refused
              className="btn primary"
              label={close.closeLabel}
              reason={close.closeRefusal}
              describedBy="rgClosingFootnote"
            />
          </div>
          {/* ⚑ THE FOOTNOTE EXPLAINS BUTTONS, so it renders with them — a role
              with no controls was being told why the controls it cannot see are
              disabled. */}
          <p className="rg-close-foot" id="rgClosingFootnote">
            {props.actionFootnote}
          </p>
        </div>
      )}

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the board's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. The hole is one big
          box-shadow rather than a moved element, so the region stays fully lit
          and nothing on the page is re-laid-out to explain it — and no layer
          owns a scroller, so ⚖ page-scroll is untouched. */}
      {tourOpen && (
        <>
          <div
            className="rg-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              // A tap on nothing declared ends the tour — the dim layer behaves
              // like the scrim it looks like.
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
              className="rg-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="rg-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="rg-spot-card"
            id="rgTour"
            ref={tourCardRef}
            role="dialog"
            aria-modal="true"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="rg-spot-text">{tourStep?.text ?? ''}</span>
            <div className="rg-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="rg-spot-foot">
              <button type="button" className="rg-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="rg-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="rg-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="rg-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
