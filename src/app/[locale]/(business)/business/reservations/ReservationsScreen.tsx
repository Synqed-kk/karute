'use client'

// 予約一覧 — the accepted desktop redesign, running on PLAY-PHASE FIXTURES.
//
// ⚖ THE MOCK IS THE SPEC (RESERVATIONS-MOCK-v1.html, accepted by Liam 9/2 after
// the responsive round, the act-inline round and the ultra-wide law). What the
// mock decides is layout, hierarchy, copy and motion. What it does NOT decide is
// which behaviours this room already proves: one 要対応 predicate on every
// surface, the lifecycle derived from the board's own fields, one pinned clock,
// store isolation down to the names, M-87's no-numbers-on-failure, the L-6
// window, the accept/record commit gates, the focus handoff and the 表示する列
// primitive all survive the redesign unchanged.
//
// THE SHAPE, top to bottom:
//   · ONE compact title row — eyebrow, 予約一覧, the ?, the range, the CTA
//   · the 要対応 DEADLINE RAIL, at the TOP, with a live countdown and a detail
//     card that springs open IN PLACE under it (it replaces the old bottom queue)
//   · the COUNTS ARE THE FILTERS — six chips, each carrying the number of rows
//     its own press reveals, over the same `matchesFilters` the list runs
//   · the day-grouped 48px table, and the inspector beside it
//
// ⚖ EVERY REAL WRITE REFUSES, HONESTLY. The picker's 「この枠で返信する」 would
// send a customer a reply, and notification is core's (registry ⑤ / C-18): it
// refuses INLINE, keeps the picked slot and the reason on screen, moves no row
// and stamps no history. `changeCommit` below stays exported and unwired — it is
// the reconnect-shape commit that send will apply once notification exists.
//
// ⚖ CLASS NAMES ARE PREFIXED `rv-` ON EVERY ELEMENT THIS ROOM OWNS. App Router
// leaves every sibling room's stylesheet in the document after a client-side
// navigation, and the neighbours state BARE `.biz .<name>` rules on the names
// canon's page used (`.panel`, `.empty`, `.toast`, `.price`, `.proof`, `.row`,
// `.chip`, `.spot-card`…). A fence that has to enumerate sixty shared names rots
// as the neighbours grow; not colliding at all cannot. `page` / `h1` / `btn` /
// `pill` are the SHELL's and are fenced in reservations.css at four levels.
//
// ⚖ NOTHING IS `position: fixed` INSIDE `.rv-view`. That wrapper carries
// `container-type: inline-size`, which implies layout containment and would make
// it the containing block for every fixed descendant — so the toast, the two
// dialogs, the phone sheet, its scrim and the four tour layers are siblings of
// it at the page root. Same structure the 録音 room ships, same reason.

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toggleColumn, wireColumnsPopover } from '@/business/lib/column-config'
import { spotCardAt, spotHitIndex, spotTargets, wrapStep, type SpotRect } from '@/business/lib/guide'
import { makeSpring } from '@/business/lib/spring'
import {
  CHIP_LABEL,
  CHIP_VIEWS,
  DEADLINE_WORD,
  LIFECYCLE,
  PAGE_BANDS,
  QUEUE_ACTION,
  SCRIM_SETTLE_MS,
  WANTS_CHANGE,
  chipCounts,
  countdownText,
  deadlineOf,
  decisionKindOf,
  flagsOf,
  genuineOf,
  isQueued,
  matchesFilters,
  overdueOf,
  primaryActionOf,
  safeSlotsFor,
  viewFilters,
  type DecisionKind,
  type Lifecycle,
  type ReservationFilters,
  type SavedView,
} from '@/business/lib/reservations'
import { hhmm } from '@/business/lib/today-board'

export interface ReservationRow {
  id: string
  no: string
  dateLabel: string
  /** 「9月3日(水)」 — the day header's own label, built on the server. */
  dayLabel: string
  dayKey: number
  isToday: boolean
  startMinute: number
  durationMinutes: number
  /** 「16:30」 — the row's lead figure. Formatted server-side like every other
   *  time on this page, so the client never splits or parses one. */
  startLabel: string
  timeLabel: string
  customerName: string
  menuName: string
  staffName: string
  resourceName: string
  sourceLabel: string
  sourceGroup: 'reserve' | 'store' | 'external'
  sourceRef: string | null
  priceLabel: string
  currentPriceLabel: string
  storeLabel: string | null
  lifecycle: Lifecycle
  /** The STORED half of 状態フラグ. 期限超過 and 担当変更あり are derived below. */
  flags: string[]
  reassigned: boolean
  deadline: number | null
  eligibility: string
  proof: string
  party: Array<{ role: string; name: string; note: string }>
  history: Array<[string, string, string]>
  shiftWarning: string | null
  /** 担当資格, read off the roster's 資格 plane — canon's literal 「小顔対応済み」
   *  would affirm a qualification the assigned staff may not hold. */
  qualificationText: string
  staffUnavailable: boolean
  settled: boolean
  /** 来店なし memory (rider #3) — how many OTHER times this customer has not
   *  turned up, inside this lens, before the pinned moment. */
  noShowCount: number
  txNote: string
  txDetail: string | null
}

/** A 販売可能枠 the picker can offer. Whether it can hold a given booking is
 *  arithmetic (`safeSlotsFor`); whether it is genuinely safe is core's (C-13). */
export interface SlotOption {
  id: string
  /** JST minutes from midnight. Deliberately DATELESS: the 販売可能枠 are a
   *  daily shape, so a candidate is offered on the booking's own day. */
  start: number
  end: number
  staffName: string
  resourceName: string
}

export interface ReservationsProps {
  locale: string
  rows: ReservationRow[]
  slots: SlotOption[]
  lensLabel: string
  spanLabel: string
  /** The date filter names its days (「本日 9月3日」/「9月4日以降」). Both come off
   *  the server's clock so no second calendar exists on the client. */
  todayLabel: string
  tomorrowLabel: string
  store: string | null
  /** JST minutes from midnight — the one pinned world clock (13:24), shared
   *  with the Today board's now-line and the topbar's Reserve同期 stamp. */
  boardNow: number
  /** 閉店. The 精算期限 IS this, so a store's hours move every settlement
   *  deadline and no fixture carries a second copy. */
  closeMinute: number
}

type DateFilter = 'all' | 'today' | 'future'

/** 表示する列 — this panel's own five columns driving the shared primitive.
 *  `w` is the desk track list and `nw` the narrow-desk one; the narrow list is
 *  built from the visible columns MINUS 担当・設備, which the narrow band sheds
 *  into the row's own second line (the mock's `.mline`). Both ride in as custom
 *  properties, so the sheet picks between them and the user's column choice and
 *  the band's shed compose instead of fighting. */
export const COLUMNS = [
  { k: 'when', label: '日時', w: '74px', nw: '70px' },
  { k: 'who', label: 'お客様・メニュー', w: 'minmax(0, 1fr)', nw: 'minmax(0, 1fr)' },
  { k: 'staff', label: '担当・設備', w: '96px', nw: '94px' },
  { k: 'source', label: '受付元・価格', w: '98px', nw: '94px' },
  { k: 'state', label: '状態', w: '120px', nw: '116px' },
] as const

const DEFAULT_COLUMNS: string[] = COLUMNS.map((c) => c.k)

/** The column the narrow-desk band sheds into the row's second line. */
const SHED_COLUMN = 'staff'

/** The one-sentence judgement on a rail card. Read from the decision kind, so
 *  a card can never describe a booking it is not about. */
const DECISION: Record<DecisionKind, (r: Decorated) => string> = {
  accept: (r) => `${r.customerName}さんの受付リクエストを受けるか決める`,
  change: (r) => `${r.customerName}さんの日時・担当の変更希望に回答する`,
  escalate: (r) => `${r.dateLabel} ${r.timeLabel} の担当者が決まっていない`,
  settle: (r) => `${r.customerName}さんの施術が未精算のまま残っている`,
  open: (r) => `${r.customerName}さんの予約に期限のある判断が残っている`,
}

/** 変更理由 — canon's three, kept because the 根拠 and the history stamp read
 *  them and `changeCommit` still gates on one being chosen. */
const CHANGE_REASONS = ['お客様希望', '担当者の勤務変更', '設備停止']

/** registry ⑤ (C-18) — the notification resource this send is waiting on. The
 *  refusal says which write it is and that nothing moved, in that order. */
const SEND_REFUSAL =
  '見本データのため、お客様への返信は送れません。Reserve通知とSMSの送信はまだつないでいないので、この画面では枠と理由の確認までを示します。予約は変わっていません。'

/** F-5 (fix round 1, LENS-4) — ONE escalate toast for both call sites: the
 *  rail card's own action and the inspector's `Primary` used to diverge by
 *  one clause for the identical non-write hand-off. The inspector's wording
 *  is the kept one. */
const ESCALATE_TOAST = (no: string) =>
  `この画面内のプロトタイプでは、予約 ${no}を判断できる担当者へ渡すところまでを示します`

export interface Decorated extends ReservationRow {
  deadlineMinute: number | null
  overdue: boolean
  queued: boolean
  allFlags: string[]
  kind: DecisionKind
}

/** Everything the screen shows about a row that is not literally a field.
 *  Exported for the suite: the rail↔chip↔row reconciliation is asserted
 *  against this one function rather than against three re-implementations. */
export function decorate(row: ReservationRow, boardNow: number, closeMinute: number): Decorated {
  const deadlineMinute = deadlineOf(row.lifecycle, row, closeMinute)
  const overdue = overdueOf(deadlineMinute, boardNow)
  const allFlags = flagsOf(row.flags, row.reassigned, overdue)
  return {
    ...row,
    deadlineMinute,
    overdue,
    queued: isQueued(row.lifecycle, deadlineMinute),
    allFlags,
    kind: decisionKindOf(row.lifecycle, allFlags),
  }
}

/** What a dialog's 反映 button produces: the row patch and the sentence the
 *  toast says. `null` = the gate refused, and nothing at all happens. */
export interface Commit {
  patch: Partial<ReservationRow>
  message: string
}

const stamp = (row: Decorated, boardNow: number, action: string, detail: string): Array<[string, string, string]> =>
  [[hhmm(boardNow), action, detail], ...row.history]

/**
 * 受付リクエストを確定 (canon :694). The gate is re-checked HERE, not only on the
 * checkbox: canon's own commit re-asserts `decisionOf(item)==='accept'` and
 * `isQueued(item)` because the dialog can be standing open over a booking that
 * has since stopped being an acceptance decision.
 */
export function acceptCommit(row: Decorated, confirmed: boolean, lensLabel: string, boardNow: number): Commit | null {
  if (row.kind !== 'accept' || !row.queued || !confirmed) return null
  return {
    patch: {
      lifecycle: 'confirmed',
      deadline: null,
      history: stamp(row, boardNow, '受付リクエストを確定', `${lensLabel} / ${row.priceLabel}保持 / Reserve通知 + SMS送信`),
    },
    message: 'この画面内のプロトタイプで、空き・資格・設備・受付価格・通知先を確認した確定結果を表示しました',
  }
}

/**
 * 画面内で変更を試す (canon :699) — the in-page trial move.
 *
 * ⚖-ADJ B — KEPT, EXPORTED AND DELIBERATELY UNWIRED. The 変更 dialog it used to
 * serve is retired: the accepted design puts the decision in ONE home, the
 * inline slot picker on the 要対応 card, and that picker's send is a REAL write
 * (a reply to a customer) which refuses honestly to registry ⑤. This function is
 * the reconnect-SHAPE of the commit that send will apply once notification
 * exists — every rule in it (the day never moves, the agreed price is carried
 * untouched, 変更希望あり comes off and 担当変更あり goes on only when the person
 * really changed) is a rule the reconnect must keep, and its pins are what stop
 * it rotting while it waits. Deleting it and rewriting it later is how those
 * rules get lost.
 */
export function changeCommit(
  row: Decorated,
  slot: SlotOption | undefined,
  reason: string,
  confirmed: boolean,
  boardNow: number,
): Commit | null {
  if (!row.flags.includes(WANTS_CHANGE) || !slot || !reason || !confirmed) return null
  const before = `${row.dateLabel} ${row.timeLabel} / ${row.staffName} / ${row.resourceName}`
  const timeLabel = `${hhmm(slot.start)}–${hhmm(slot.start + row.durationMinutes)}`
  const after = `${row.dateLabel} ${timeLabel} / ${slot.staffName} / ${slot.resourceName}`
  return {
    patch: {
      startMinute: slot.start,
      startLabel: hhmm(slot.start),
      timeLabel,
      staffName: slot.staffName,
      resourceName: slot.resourceName,
      lifecycle: 'confirmed',
      deadline: null,
      flags: row.flags.filter((f) => f !== WANTS_CHANGE),
      reassigned: row.reassigned || slot.staffName !== row.staffName,
      proof: `${reason}。元の ${before}を履歴に保持し、受付価格 ${row.priceLabel}は変更していません。`,
      history: stamp(row, boardNow, '予約を変更', `${before} → ${after} / ${reason} / SMS送信`),
    },
    message: 'この画面内のプロトタイプで、新しい枠・担当資格・設備・価格保持・通知先を確認した変更結果を表示しました',
  }
}

/**
 * 来店・キャンセルを記録 (canon :704). Three outcomes, and none of them deletes
 * the booking — 無断キャンセル in particular is 来店なし plus the contact evidence,
 * because the chasing that follows belongs to 受信トレイ.
 *
 * 来店済み clears the stored deadline and gains one: 精算期限 IS 閉店, derived by
 * `deadlineOf`, so the row leaves the queue as an acceptance and re-enters it as
 * a settlement without a second number being written anywhere.
 */
export function recordCommit(
  row: Decorated,
  outcome: string,
  source: string,
  confirmed: boolean,
  lensLabel: string,
  boardNow: number,
): Commit | null {
  if (row.lifecycle !== 'confirmed' || !outcome || !source || !confirmed) return null
  const [lifecycle, label, message] =
    outcome === 'arrived'
      ? (['awaiting_settlement', '来店済み・精算待ち', 'この画面内のプロトタイプで来店結果を表示しました。受付価格は見本データのままです'] as const)
      : outcome === 'cancelled'
        ? (['cancelled', 'お客様キャンセル', 'この画面内のプロトタイプで、予約を消さずにキャンセルと確認元を表示しました'] as const)
        : (['no_show', '無断キャンセル', 'この画面内のプロトタイプで、予約を消さずに無断キャンセルと連絡証拠を表示しました'] as const)
  return {
    patch: {
      lifecycle,
      deadline: null,
      proof: `${label}。確認元: ${source}。受付価格 ${row.priceLabel}と元の予約枠を履歴に保持。`,
      history: stamp(row, boardNow, label, `${source} / ${lensLabel}`),
    },
    message,
  }
}

export function ReservationsScreen(
  props: ReservationsProps | { failed: true; locale: string },
) {
  if ('failed' in props) return <LoadFailure />
  return <Screen {...props} />
}

/** M-87. Canon's own rule, and the reason this branch exists before the reads
 *  are real: a quiet blank with the old figures still on it is a broken screen
 *  that looks like normal operation. Every number goes to 「—」. */
function LoadFailure() {
  return (
    <div className="page pg-reservations">
      <div className="rv-view">
        <header className="rv-head">
          <div className="rv-titlerow">
            <span className="rv-eyebrow">予約管理</span>
            <h1>予約一覧</h1>
          </div>
        </header>
        <div className="rv-loaderror" role="alert">
          <strong>予約を読み込めませんでした</strong>
          <span>
            データを読み込めませんでした。この画面の数字は使わないでください。再読み込みしても直らない場合は管理者へ。
          </span>
        </div>
        <section className="rv-card rv-railrow" aria-label="要対応">
          <div className="rv-raillabel">
            <span className="rv-rl-t">要対応</span>
            <span className="rv-rl-c">—</span>
            <span className="rv-rl-h">対応期限の<br />早い順</span>
          </div>
          <div className="rv-railcards">
            <div className="rv-railempty">
              <strong>—</strong>
              <span>この画面の数字は1つも表示していません。</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function Screen(props: ReservationsProps) {
  const { boardNow, closeMinute } = props

  // Client transitions live as a PATCH over the server rows, never as a second
  // copy of the list: a row the viewer has not touched is still the server's,
  // and a lens change re-renders from the server without a merge step.
  const [patch, setPatch] = useState<Record<string, Partial<ReservationRow>>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [date, setDate] = useState<DateFilter>('all')
  const [status, setStatus] = useState<ReservationFilters['status']>('all')
  const [source, setSource] = useState<ReservationFilters['source']>('all')
  const [price, setPrice] = useState<ReservationFilters['price']>('all')
  // ONE LIT CHIP, ALWAYS. Canon starts on 「すべて」 and the chip only ever moves
  // when another chip is pressed — the criteria string reads the live controls
  // rather than the view, which is why editing search or the range by hand does
  // not blank the row.
  const [chip, setChip] = useState<SavedView>('all')
  const [swap, setSwap] = useState(0)
  const [openParty, setOpenParty] = useState(false)
  const [toast, setToast] = useState('')
  const [shown, setShown] = useState<string[]>(DEFAULT_COLUMNS)
  const [colsOpen, setColsOpen] = useState(false)

  // the 要対応 rail
  const [openAtt, setOpenAtt] = useState<string | null>(null)
  const [pickedSlot, setPickedSlot] = useState('')
  const [pickReason, setPickReason] = useState('')
  const [sendRefused, setSendRefused] = useState(false)

  // the dialogs that stayed (⚖-ADJ C)
  const [acceptOk, setAcceptOk] = useState(false)
  const [recordType, setRecordType] = useState('')
  const [recordSource, setRecordSource] = useState('')
  const [recordOk, setRecordOk] = useState(false)

  // ⚖-ADJ J — the countdown's own second hand. ONE interval from mount, and the
  // server render is always `0`, so the first client frame matches the HTML byte
  // for byte. No `?freeze=` lever ships: a debug URL in product code is a dead
  // lever waiting to be found, and the harness stubs the clock instead.
  const [elapsedSec, setElapsedSec] = useState(0)

  const [reduced, setReduced] = useState(false)
  const [band, setBand] = useState<'wide' | 'narrow' | 'onecol' | 'phone'>('wide')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [tourIdx, setTourIdx] = useState(-1)
  const [tourTick, setTourTick] = useState(0)
  const tourOpen = tourIdx >= 0

  const rootRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const colsBtnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const acceptRef = useRef<HTMLDialogElement>(null)
  const recordRef = useRef<HTMLDialogElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLDivElement>(null)
  const segRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  // F6 (fix round 1, LENS-3 F-1) — the sheet's own modal hardening state,
  // mirroring RecordingScreen.tsx's `Overlay` (:2275-2300, IN-ROOM).
  const sheetOpenedAt = useRef(Number.POSITIVE_INFINITY)
  const sheetOpenerId = useRef<string | null>(null)
  const helpRef = useRef<HTMLButtonElement>(null)
  const tourCardRef = useRef<HTMLDivElement>(null)
  const tourNextRef = useRef<HTMLButtonElement>(null)

  /** ⚠ REDUCED MOTION IS READ ONCE, IN AN EFFECT, and handed to every spring as
   *  a constructor argument — `spring.ts` is pure of `window` on purpose. */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const read = () => setReduced(mq.matches)
    read()
    mq.addEventListener('change', read)
    return () => mq.removeEventListener('change', read)
  }, [])

  useEffect(() => {
    if (!toast) return
    // The mock's own dwell on its own surface (2400ms).
    const t = setTimeout(() => setToast(''), 2400)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // 表示する列 popover — the wiring itself is the shared canon primitive, unit-
  // tested on real DOM nodes, so this effect stays a thin caller of it.
  useEffect(() => {
    if (!colsOpen || !popRef.current || !colsBtnRef.current) return
    return wireColumnsPopover(popRef.current, colsBtnRef.current, () => setColsOpen(false))
  }, [colsOpen])

  /** PRESS STATES ON POINTER-DOWN, one document listener for the whole room
   *  (the mock's `[data-press]`). Pointer-DOWN, not click: the feedback has to
   *  arrive while the finger is still down or it is not feedback. */
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest?.('[data-press]')
      if (t) t.classList.add('is-pressed')
    }
    const clear = () => {
      for (const el of document.querySelectorAll('[data-press].is-pressed')) el.classList.remove('is-pressed')
    }
    document.addEventListener('pointerdown', down, true)
    for (const ev of ['pointerup', 'pointercancel', 'blur', 'dragend']) window.addEventListener(ev, clear, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      for (const ev of ['pointerup', 'pointercancel', 'blur', 'dragend']) window.removeEventListener(ev, clear, true)
    }
  }, [])

  /** ⚖ HARNESS-GEOMETRY, IN THE PRODUCT. The sticky column head and the sticky
   *  day headers hang off the SHELL's real topbar, which is 62px at a desk and
   *  wraps to ~87px on a narrow one — so the offset is MEASURED rather than
   *  typed, once on mount and again whenever the bar changes height. The sheet's
   *  own 62px is the pre-measurement default, not the answer. */
  useLayoutEffect(() => {
    const root = rootRef.current
    const bar = root?.closest('.main')?.querySelector('.topbar')
    if (!root || !bar) return
    const apply = () => root.style.setProperty('--rv-topbar', `${Math.round(bar.getBoundingClientRect().height)}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  /** THE BAND, MEASURED ON THE PAGE rather than on the viewport. The shell's
   *  rail is 264px at ≥1024 with the sidebar open and 76px everywhere else, so
   *  the PAGE a room is given falls by 188px as the viewport crosses 1024 — a
   *  layout chosen from a viewport width is a layout chosen from the wrong
   *  number. The sheet only exists in JS (the CSS band is the one that hides the
   *  desk inspector), so a first paint never depends on this. */
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const read = () => {
      const w = el.getBoundingClientRect().width
      setBand(w <= PAGE_BANDS.phone ? 'phone' : w <= PAGE_BANDS.oneColumn ? 'onecol' : w <= PAGE_BANDS.narrow ? 'narrow' : 'wide')
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const sheetBand = band === 'onecol' || band === 'phone'
  // Crossing back into a desk band puts the sheet away: an overlay standing over
  // a two-column layout is a surface nobody asked for.
  useEffect(() => {
    if (!sheetBand) setSheetOpen(false)
  }, [sheetBand])

  const columns = useMemo(() => COLUMNS.filter((c) => shown.includes(c.k)), [shown])
  /** Both track lists ride as custom properties and the sheet's band rule picks
   *  between them. The narrow list drops 担当・設備 — the column the band sheds
   *  into the row's own second line — so the user's column choice and the band's
   *  shed compose instead of fighting over a `nth-child`. */
  const trackStyle = {
    '--rv-wide': columns.map((c) => c.w).join(' '),
    '--rv-narrow': columns.filter((c) => c.k !== SHED_COLUMN).map((c) => c.nw).join(' '),
  } as React.CSSProperties

  const all = useMemo(
    () => props.rows.map((r) => decorate({ ...r, ...patch[r.id] }, boardNow, closeMinute)),
    [props.rows, patch, boardNow, closeMinute],
  )

  const filters: ReservationFilters = useMemo(
    () => ({ search, date, status, source, price }),
    [search, date, status, source, price],
  )
  const visible = useMemo(() => all.filter((r) => matchesFilters(r, filters)), [all, filters])

  /** ⚖ THE COUNT ON A CHIP IS THE NUMBER OF ROWS ITS OWN PRESS REVEALS — one
   *  function, over the same predicate the list runs, so the two cannot drift. */
  const counts = useMemo(() => chipCounts(all), [all])

  /** How many rows the RANGE alone leaves, which is what 「全N件のうち」 counts. */
  const rangeTotal = useMemo(
    () => all.filter((r) => matchesFilters(r, { search: '', date, status: 'all', source: 'all', price: 'all' })).length,
    [all, date],
  )

  // A1: the selection is sovereign. It moves only when the booking itself is
  // gone from the lens — not when a filter hides it, which would let the
  // inspector quietly swap to another customer after a rail action.
  const current = all.find((r) => r.id === selected) ?? visible[0] ?? all[0] ?? null
  const offList = current != null && !visible.some((r) => r.id === current.id)

  const queue = useMemo(
    () => all.filter((r) => r.queued).sort((a, b) => a.deadlineMinute! - b.deadlineMinute!),
    [all],
  )
  const openRow = openAtt === null ? null : (queue.find((r) => r.id === openAtt) ?? null)
  const openCandidates = openRow ? safeSlotsFor(props.slots, openRow.durationMinutes) : []
  const picked = openCandidates.find((s) => s.id === pickedSlot)

  /** ⚖-ADJ K · ANY-ROSTER-SIZE on the QUEUE dimension. Up to five cards the rail
   *  is the mock's five-column grid; from six it becomes the mock's own ≤1099
   *  horizontal strip at EVERY width — a surface's own container may pan
   *  sideways (⚖ PAGE-SCROLL), and the label's count still names the total.
   *  Never a second row of cards, never a vertical scroller. */
  const railStrip = queue.length > 5

  /** Each day's own row count, taken over the VISIBLE rows — the header says how
   *  many rows are under it, never how many the world holds. */
  const dayCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of visible) m.set(r.dayKey, (m.get(r.dayKey) ?? 0) + 1)
    return m
  }, [visible])

  const rangeWord =
    date === 'today' ? `本日 ${props.todayLabel}` : date === 'future' ? `${props.tomorrowLabel}以降` : props.spanLabel

  function update(id: string, next: Partial<ReservationRow>, message: string) {
    setPatch((was) => ({ ...was, [id]: { ...was[id], ...next } }))
    setSelected(id)
    setToast(message)
    // canon `focusResult` (:541): a commit hands focus back to the row it
    // changed, so the proof of the change is where the keyboard already is.
    // The row is re-rendered by this same update, hence the frame's delay.
    requestAnimationFrame(() => focusResult(listRef.current, countRef.current, id))
  }

  /** ⚖-ADJ D's consequence, and a deviation from the packet's literal wording,
   *  argued in the report (V2-3): since the chips ARE the filters, clearing
   *  status / 受付元 / price by hand would leave a lit chip describing a list it
   *  no longer selects — one verdict with two answers. クリア therefore empties
   *  the TYPED search and returns the range to the lit chip's own criteria; the
   *  chip is not cleared (canon's rule, unchanged) and the caret goes back in
   *  the search box, because clearing is a step in typing the next search. */
  function clearFilters() {
    const f = viewFilters(chip)
    setSearch('')
    setDate(f.date)
    setStatus(f.status)
    setSource(f.source)
    setPrice(f.price)
    setSwap((n) => n + 1)
    searchRef.current?.focus()
  }

  function applyView(view: SavedView) {
    const f = viewFilters(view)
    setChip(view)
    setDate(f.date)
    setSource(f.source)
    setStatus(f.status)
    setPrice(f.price)
    setSearch(f.search)
    setSwap((n) => n + 1)
    // canon hands focus to the result count (:744) — the one thing on screen
    // that just changed meaning.
    countRef.current?.focus()
  }

  function openAccept() {
    setAcceptOk(false)
    acceptRef.current?.showModal()
  }
  function openRecord() {
    setRecordType('')
    setRecordSource('')
    setRecordOk(false)
    recordRef.current?.showModal()
  }

  // The two commits are thin: the gate and the transition are pure functions
  // above (unit-tested directly), and these own only the dialog and the patch.
  function run(commit: Commit | null, dialog: HTMLDialogElement | null) {
    if (!commit || !current) return
    update(current.id, commit.patch, commit.message)
    dialog?.close()
  }

  function selectRow(id: string, fromRow: boolean) {
    setSelected(id)
    if (fromRow && sheetBand) {
      sheetOpenerId.current = id
      setSheetOpen(true)
    }
  }

  /** F6 (fix round 1) — closes the sheet and hands focus back to the row that
   *  opened it, via `focusResult` (canon :541, the same handoff every commit
   *  on this page uses). */
  function closeSheet() {
    setSheetOpen(false)
    const id = sheetOpenerId.current
    if (id) requestAnimationFrame(() => focusResult(listRef.current, countRef.current, id))
  }

  /** A rail card selects its booking AND takes the reader to its row — the two
   *  surfaces agree by construction. The scroll waits for the detail's height
   *  spring to rest, because a smooth scroll started mid-resize is cancelled by
   *  the resize (the mock's own 420ms). */
  const scrollToRow = useCallback(
    (id: string) => {
      const go = () => listRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      if (reduced) go()
      else setTimeout(go, 420)
    },
    [reduced],
  )

  /** ⚖ ONE SCROLL PER ACTION (F7, fix round 1, LENS-3 F-2): a rail-card click
   *  takes the reader DOWN to its row (`target: 'row'`, unchanged — the
   *  mock's own 420ms wait for the detail's height spring to rest); the
   *  inspector's 変更 button takes the reader UP to the decision surface it
   *  just opened instead (`target: 'rail'`, scrolled via the rail row so both
   *  the cards and the detail clear the sticky topbar) — the row is where
   *  they came from, not where they are going. The two used to fire back to
   *  back. */
  function toggleAtt(id: string, target: 'row' | 'rail' = 'row') {
    setPickedSlot('')
    setPickReason('')
    setSendRefused(false)
    if (openAtt === id) {
      setOpenAtt(null)
      return
    }
    setOpenAtt(id)
    setSelected(id)
    if (target === 'row') scrollToRow(id)
    else railRef.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
  }

  // ── the two height springs: the rail's detail, and the picker's confirm ────
  useCollapse(detailRef, openRow !== null, reduced)
  useCollapse(confirmRef, picked !== undefined, reduced)

  /** THE SEGMENTED THUMB — X and W on their own springs (.30), driven by the
   *  LIT chip's own offset box, so the thumb cannot drift from the chip it is
   *  under when the counts change width. It JUMPS on first layout, on a resize
   *  and once the real fonts have loaded; it SETS when a chip is pressed. */
  useEffect(() => {
    const seg = segRef.current
    const thumb = thumbRef.current
    if (!seg || !thumb) return
    const state = { x: 0, w: 100 }
    const paint = () => { thumb.style.transform = `translateX(${state.x}px) scaleX(${state.w / 100})` }
    const sx = makeSpring((v) => { state.x = v; paint() }, { response: 0.3, reduced })
    const sw = makeSpring((v) => { state.w = v; paint() }, { response: 0.3, reduced })
    let placed = false
    const move = (jump: boolean) => {
      const on = seg.querySelector<HTMLElement>('.rv-seg-btn.is-on')
      if (!on) { thumb.style.opacity = '0'; return }
      thumb.style.opacity = ''
      const x = on.offsetLeft - 3
      const w = on.offsetWidth
      if (placed && !jump) { sx.set(x); sw.set(w) } else { sx.jump(x); sw.jump(w); placed = true }
    }
    move(false)
    const onResize = () => move(true)
    window.addEventListener('resize', onResize)
    document.fonts?.ready?.then(() => move(true)).catch(() => {})
    return () => { sx.stop(); sw.stop(); window.removeEventListener('resize', onResize) }
  }, [reduced, chip])

  /** THE PHONE SHEET — the same critically-damped spring as everything else, so
   *  it leaves along the exact path it arrived on. It is a page-root sibling of
   *  the contained view, which is what lets it be `position: fixed` at all. */
  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const sp = makeSpring((v) => { el.style.transform = `translateY(${v}%)` }, { response: 0.34, eps: 0.2, reduced })
    sp.jump(100)
    sp.set(sheetOpen ? 0 : 100)
    return () => sp.stop()
  }, [sheetOpen, reduced])

  /** F6 (fix round 1, LENS-3 F-1) — the sheet is a real modal: the moment it
   *  opened is stamped (fail-closed until then, so no unstamped scrim can
   *  dismiss it) and focus moves into its first focusable, mirroring
   *  RecordingScreen.tsx's `Overlay` (:2288-2300) IN-ROOM — a shared overlay
   *  primitive is a family-sweep item, not this round. */
  useLayoutEffect(() => {
    const panel = sheetRef.current
    if (!sheetOpen || !panel) return
    sheetOpenedAt.current = Date.now()
    return wireSheet(panel)
  }, [sheetOpen])

  // ── ⚖ Liam 8/23 — 画面の説明 (the guided tour) ─────────────────────────────
  const tourRectsRef = useRef<SpotRect[]>([])
  const [tourStep, setTourStep] = useState<{ title: string; text: string; idx: number; total: number } | null>(null)
  const [tourPos, setTourPos] = useState<{ hole: SpotRect; top: number; left: number } | null>(null)
  const [tourHover, setTourHover] = useState<SpotRect | null>(null)

  useLayoutEffect(() => {
    if (tourIdx < 0) { setTourStep(null); setTourPos(null); setTourHover(null); return }
    const targets = spotTargets(rootRef.current)
    if (targets.length === 0) { setTourIdx(-1); return }
    const i = Math.min(tourIdx, targets.length - 1)
    const el = targets[i]
    let r = el.getBoundingClientRect()
    if (r.top < 60 || r.bottom > window.innerHeight - 40) {
      el.scrollIntoView({ block: 'center' })
      r = el.getBoundingClientRect()
    }
    tourRectsRef.current = targets.map((t) => boxOf(t.getBoundingClientRect()))
    const next = { title: el.dataset.guideTitle ?? '', text: el.dataset.guide ?? '', idx: i, total: targets.length }
    setTourStep((was) => (was && was.title === next.title && was.text === next.text && was.idx === next.idx && was.total === next.total ? was : next))
    const card = tourCardRef.current
    const size = { width: card?.offsetWidth || 300, height: card?.offsetHeight || 160 }
    const at = spotCardAt(boxOf(r), size, { width: window.innerWidth, height: window.innerHeight })
    const pos = { hole: { left: r.left - 5, top: r.top - 5, width: r.width + 10, height: r.height + 10 }, ...at }
    setTourPos((was) => (was && was.top === pos.top && was.left === pos.left && was.hole.left === pos.hole.left && was.hole.top === pos.hole.top && was.hole.width === pos.hole.width && was.hole.height === pos.hole.height ? was : pos))
  }, [tourIdx, tourTick, tourStep])

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

  // ONE keyboard listener for the layers that can be open, innermost first:
  // while the tour is up it owns Escape (and the arrows walk the ring); once it
  // is closed Escape reaches the sheet. Two listeners would both fire on one
  // Escape and close two layers at once.
  useEffect(() => {
    if (!tourOpen && !sheetOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (tourOpen) {
        if (e.key === 'Escape') setTourIdx(-1)
        if (e.key === 'ArrowRight') setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))
        if (e.key === 'ArrowLeft') setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))
        return
      }
      if (e.key === 'Escape') closeSheet()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [tourOpen, sheetOpen])

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

  const inspector = current && (
    <InspectorBody
      row={current}
      props={props}
      offList={offList}
      openParty={openParty}
      onParty={() => setOpenParty((v) => !v)}
      onAccept={openAccept}
      onRecord={openRecord}
      onChange={() => {
        // ⚖ NO DEAD LEVER. 変更希望あり outranks the lifecycle in
        // `primaryActionOf`, so a booking whose deadline has already been
        // cleared can still ask for this button while having no card on the
        // rail to open. It says so rather than doing nothing.
        if (!current.queued) {
          setToast(`予約 ${current.no}の変更希望は、すでに要対応の対象から外れています。下の一覧で内容を確認してください`)
          return
        }
        toggleAtt(current.id, 'rail')
      }}
      onToast={setToast}
    />
  )

  return (
    <div className="page pg-reservations" ref={rootRef}>
      <div className="rv-view" ref={viewRef}>
        {/* ⚖ ONE COMPACT TITLE ROW (the mock's `.titlerow`). The old subtitle and
            the summary band's sentence are not cut — they are the head's own
            tour text, which is where a sentence about the whole screen belongs. */}
        <header
          className="rv-head"
          data-guide-title="予約一覧"
          data-guide="期限のある予約判断と、日をまたぐ予約の検索をまとめた画面です。予定表ではなく、日をまたぐ予約の検索・例外処理・証拠確認に使います。この画面は見本データなので、予約の変更・精算・連絡はできません。"
        >
          <div className="rv-titlerow">
            <span className="rv-eyebrow">{props.lensLabel} / 予約管理</span>
            <h1>予約一覧</h1>
            {/* ⚖ Liam 8/23 — the ? opens the GUIDED TOUR, never the mock's own
                popover: the mock's paragraphs ARE the sections' tour texts. A
                hairline circle, never a filled one (⚖ R13). */}
            <button
              className="rv-help"
              type="button"
              ref={helpRef}
              data-press
              title="画面の説明"
              aria-label="画面の説明"
              aria-haspopup="dialog"
              aria-expanded={tourOpen}
              aria-controls={tourOpen ? 'rvTour' : undefined}
              onClick={() => setTourIdx(0)}
            >
              ?
            </button>
            <span className="rv-range">{rangeWord}の予約</span>
            <span className="rv-sp" />
            <Link className="btn primary rv-cta" href={href(props, 'today')} data-press>
              今日の運営で予約を作成
            </Link>
          </div>
        </header>

        {/* ── ⚖-ADJ A · the 要対応 deadline rail, at the TOP ─────────────── */}
        <section
          className="rv-card rv-railrow"
          ref={railRef}
          data-guide-title="要対応"
          data-guide="対応期限の早い順に、いま決めることだけを並べています。カードを押すと、判断の根拠と次の操作がその場で開きます。"
        >
          <div className="rv-raillabel">
            <span className="rv-rl-t">要対応</span>
            <span className="rv-rl-c">{queue.length}件</span>
            <span className="rv-rl-h">{queue.length ? <>対応期限の<br />早い順</> : 'この画面で今日決めることはありません'}</span>
          </div>
          {queue.length === 0 ? (
            <div className="rv-railcards">
              <div className="rv-railempty">
                <strong>期限のある対応はありません</strong>
                <span>下の全予約リストで、日をまたぐ検索と価格の証拠を確認できます。</span>
              </div>
            </div>
          ) : (
            <div className={`rv-railcards${railStrip ? ' is-strip' : ''}`}>
              {queue.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  data-press
                  data-att={r.id}
                  className={`rv-rcard${r.overdue ? ' is-over' : ''}${openAtt === r.id ? ' is-sel' : ''}`}
                  aria-expanded={openAtt === r.id}
                  onClick={() => toggleAtt(r.id, 'row')}
                >
                  <span className="rv-dl">{DEADLINE_WORD[r.kind]} {hhmm(r.deadlineMinute!)}まで</span>
                  <span className="rv-cd">{countdownText(r.deadlineMinute!, boardNow, elapsedSec)}</span>
                  <span className="rv-ti">{DECISION[r.kind](r)}</span>
                  <span className="rv-mt">{r.no} / {r.dateLabel} {r.timeLabel}</span>
                  <span className="rv-cv" aria-hidden="true">⌄</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* the detail springs open IN PLACE under the rail; it declares itself
            for the tour only while it is open, which the engine's own property
            takes care of (a closed panel has no rect) */}
        <div className="rv-raildetail rv-card" ref={detailRef} inert={openRow === null}>
          <div className="rv-collapse-inner">
            {openRow && (
              <section
                className="rv-rd-body"
                data-guide-title="この対応の中身"
                data-guide="開いているカードの中身です。左に期限と残り時間、真ん中に判断の根拠、右に次の操作が並びます。空き枠候補が出ているときは、その場で枠を選んでお客様への返信まで進められます。"
              >
                <div className={`rv-rd-left${openRow.overdue ? ' is-over' : ''}`}>
                  <span className="rv-dl">{DEADLINE_WORD[openRow.kind]} {hhmm(openRow.deadlineMinute!)}まで</span>
                  <span className="rv-cd">{countdownText(openRow.deadlineMinute!, boardNow, elapsedSec)}</span>
                  <span className="rv-mt">
                    <span className="rv-m1">{openRow.no}</span>
                    <span className="rv-m2">{openRow.dateLabel} {openRow.timeLabel}</span>
                  </span>
                </div>
                <div className="rv-rd-mid">
                  <h3>{DECISION[openRow.kind](openRow)}</h3>
                  <Evidence
                    row={openRow}
                    candidates={openCandidates}
                    pickedSlot={pickedSlot}
                    onPick={(id) => {
                      setSendRefused(false)
                      setPickedSlot((was) => (was === id ? '' : id))
                    }}
                  />
                  {openRow.kind === 'change' && (
                    <div className="rv-confirm" ref={confirmRef} inert={picked === undefined}>
                      <div className="rv-collapse-inner">
                        <div className="rv-cf-body">
                          <div className="rv-cf-txt">
                            <span className="rv-cf-pick">
                              選んだ枠：{picked ? `${openRow.dateLabel} ${hhmm(picked.start)}–${hhmm(picked.start + openRow.durationMinutes)} / ${picked.staffName} + ${picked.resourceName}` : '—'}
                            </span>
                            <span className="rv-cf-hold">
                              受付価格 {openRow.priceLabel} を保持（現在の公開価格 {openRow.currentPriceLabel}）
                            </span>
                            この枠でお客様に返信します。見本データのため返信の送信はまだつないでいないので、実際には送られません。
                          </div>
                          <label className="rv-cf-reason">
                            変更理由
                            <select value={pickReason} onChange={(e) => { setSendRefused(false); setPickReason(e.target.value) }}>
                              <option value="">選択してください</option>
                              {CHANGE_REASONS.map((r) => <option key={r}>{r}</option>)}
                            </select>
                          </label>
                          {/* ⚖ THE REFUSAL IS INLINE AND IT CHANGES NOTHING (§A7):
                              the picked slot and the reason stay exactly where
                              they were, the row does not move, no history is
                              stamped. It names the write it is waiting on. */}
                          {sendRefused && <p className="rv-cf-refusal" role="alert">{SEND_REFUSAL}</p>}
                          <div className="rv-cf-act">
                            <button
                              className="btn primary"
                              type="button"
                              data-press
                              disabled={!picked || !pickReason}
                              onClick={() => {
                                setSendRefused(true)
                                setToast('見本データのため送信できません。予約は変わっていません。')
                              }}
                            >
                              この枠で返信する
                            </button>
                            <button
                              className="btn"
                              type="button"
                              data-press
                              onClick={() => { setPickedSlot(''); setSendRefused(false) }}
                            >
                              選び直す
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="rv-rd-act">
                  <RailAction row={openRow} onAccept={() => { setSelected(openRow.id); openAccept() }} onToast={setToast} onFocusRow={() => { setSelected(openRow.id); requestAnimationFrame(() => focusResult(listRef.current, countRef.current, openRow.id)) }} />
                  <button
                    className="btn"
                    type="button"
                    data-press
                    onClick={() => {
                      setSelected(openRow.id)
                      requestAnimationFrame(() => focusResult(listRef.current, countRef.current, openRow.id))
                    }}
                  >
                    予約の正本を見る
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>

        {/* ── ⚖-ADJ D · the counts ARE the filters ───────────────────────── */}
        <section
          className="rv-card rv-filterrow"
          data-guide-title="絞り込み"
          data-guide="件数のチップがそのまま絞り込みです。押すと、そのチップに当てはまる予約だけが下の一覧に残ります。検索と期間は、選んでいるチップの中をさらに絞り込みます。"
        >
          <div className="rv-seg" ref={segRef} role="group" aria-label="予約の絞り込み">
            <span className="rv-seg-thumb" ref={thumbRef} aria-hidden="true" />
            {CHIP_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                data-press
                data-chip={v}
                className={`rv-seg-btn${v === 'attention' ? ' is-warn' : ''}${chip === v ? ' is-on' : ''}`}
                aria-pressed={chip === v}
                onClick={() => applyView(v)}
              >
                {CHIP_LABEL[v]}<span className="rv-n">{counts[v]}件</span>
              </button>
            ))}
          </div>
          <span className="rv-sp" />
          <div className="rv-searchwrap">
            <input
              className="rv-search"
              type="search"
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="お客様名・予約番号・メニュー・担当"
              aria-label="予約を検索"
            />
          </div>
          <select
            className="rv-daterange"
            value={date}
            onChange={(e) => { setDate(e.target.value as DateFilter); setSwap((n) => n + 1) }}
            aria-label="期間"
          >
            <option value="all">{props.spanLabel}</option>
            <option value="today">本日 {props.todayLabel}</option>
            <option value="future">{props.tomorrowLabel}以降</option>
          </select>
          <button className="btn rv-clear" type="button" data-press onClick={clearFilters}>クリア</button>
        </section>

        <div className="rv-workgrid">
          <section
            className="rv-card rv-tablecard"
            style={trackStyle}
            data-guide-title="全予約リスト"
            data-guide="表示している期間の予約を、日ごとにまとめた一覧です。行を押すと、その予約の詳しい中身が出ます。表示設定で列の出し入れができます。"
          >
            <div className="rv-tbl-hd">
              <span className="rv-ttl">全予約リスト</span>
              <span className="rv-sub">{rangeWord}の全{rangeTotal}件のうち {visible.length}件を表示</span>
              <span className="rv-sp" />
              <span className="rv-cnt" role="status" aria-live="polite" tabIndex={-1} ref={countRef}>
                {visible.length}件
              </span>
              <div className="rv-colswrap">
                <button
                  className="btn rv-colsbtn"
                  type="button"
                  data-press
                  ref={colsBtnRef}
                  aria-expanded={colsOpen}
                  aria-haspopup="dialog"
                  onClick={() => setColsOpen((v) => !v)}
                >
                  表示設定
                </button>
                {colsOpen && (
                  <div className="fx-cols-pop" role="dialog" aria-label="表示する列" ref={popRef}>
                    <h3>表示する列</h3>
                    {COLUMNS.map((c) => (
                      <label className="fx-cols-opt" key={c.k}>
                        <input
                          type="checkbox"
                          checked={shown.includes(c.k)}
                          onChange={() => setShown((was) => toggleColumn(was, c.k))}
                        />
                        <span>{c.label}</span>
                      </label>
                    ))}
                    <p className="fx-cols-note">この端末での表示だけを変えます。データは消えません。</p>
                  </div>
                )}
              </div>
            </div>

            <div className="rv-thead" aria-hidden="true">
              {columns.map((c) => (
                <span key={c.k} data-col={c.k} className={c.k === 'state' ? 'rv-th-right' : undefined}>{c.label}</span>
              ))}
            </div>

            {chip === 'none' && (
              <p className="rv-demonote">
                受付時に合意した価格と、現在の公開価格が照合できない予約だけを表示しています。ほかの予約は2つの価格が一致しています。
              </p>
            )}

            {visible.length === 0 ? (
              <div className="rv-emptybox">
                <strong>この絞り込みに当てはまる予約はありません。</strong>
                <span>「クリア」で条件を外すと、{rangeWord}の全{rangeTotal}件に戻ります。</span>
              </div>
            ) : (
              <div className="rv-rowsbox" key={swap} ref={listRef}>
                {visible.map((r, i) => (
                  <RowGroup key={r.id}>
                    {(i === 0 || visible[i - 1].dayKey !== r.dayKey) && (
                      <div className="rv-dayhd">
                        <span className="rv-d">{r.dayLabel}</span>
                        <span className="rv-n">予約 {dayCounts.get(r.dayKey)}件</span>
                        <span className="rv-ln" />
                      </div>
                    )}
                    <button
                      type="button"
                      data-id={r.id}
                      data-press
                      className={`rv-row${r.id === current?.id ? ' is-sel' : ''}`}
                      aria-pressed={r.id === current?.id}
                      onClick={() => selectRow(r.id, true)}
                    >
                      {columns.map((c) => (
                        <Cell key={c.k} col={c.k} row={r} />
                      ))}
                    </button>
                  </RowGroup>
                ))}
              </div>
            )}
          </section>

          {/* the DESK inspector. At the one-column band and below it is hidden
              by the sheet and the same body renders inside the overlay instead
              (⚖-ADJ F) — one component, one home for the verdict. */}
          {current && (
            <aside
              className="rv-card rv-insp"
              aria-label="予約の詳細"
              data-guide-title="予約の詳細"
              data-guide="選んでいる予約の中身です。受付時に合意した価格と現在の公開価格を並べているので、公開価格が動いたあとでも受付時の価格が保たれていることをそのまま確認できます。"
            >
              {inspector}
            </aside>
          )}
        </div>
      </div>

      {/* ══ the fixed layers — page-root siblings of the contained view ══════ */}

      {/* ⚖-ADJ F · the sheet. It renders only while it is open, so the server
          render never carries one and a phone's first paint cannot flash it. */}
      {sheetOpen && current && (
        <>
          {/* F6 (fix round 1, LENS-3 F-1) — the scrim's click is gated on how
              long the panel has been on screen (RecordingScreen.tsx's
              Overlay, :2322-2325), so a double-tap on the row that just
              opened it cannot land here and close what it opened. */}
          <div
            className="rv-scrim"
            onClick={() => { if (Date.now() - sheetOpenedAt.current >= SCRIM_SETTLE_MS) closeSheet() }}
          />
          <aside
            className="rv-sheet"
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="予約の詳細"
            data-guide-title="予約の詳細"
            data-guide="選んでいる予約の中身です。受付時に合意した価格と現在の公開価格を並べているので、公開価格が動いたあとでも受付時の価格が保たれていることをそのまま確認できます。"
          >
            <div className="rv-sheet-grip" aria-hidden="true" />
            <button className="btn rv-sheet-close" type="button" data-press aria-label="閉じる" onClick={closeSheet}>✕</button>
            {inspector}
          </aside>
        </>
      )}

      {/* ── 受付ダイアログ (M-70–M-71), kept EXACTLY as built (⚖-ADJ C) ──── */}
      <dialog className="rv-dlg" ref={acceptRef} aria-labelledby="rvAcceptTitle">
        <div className="rv-dlg-head">
          <div>
            <h2 id="rvAcceptTitle">受付リクエストを確定</h2>
            <p>空き、担当、設備、受付価格、通知を一度に確認します</p>
          </div>
          <button className="rv-dlg-close" type="button" aria-label="閉じる" onClick={() => acceptRef.current?.close()}>×</button>
        </div>
        <div className="rv-dlg-body">
          {current && (
            <div className="rv-dlg-facts">
              <div className="rv-dlg-fact"><span>お客様・通知先</span><b>{current.customerName} / Reserve登録先</b></div>
              <div className="rv-dlg-fact"><span>予約枠</span><b>{current.dateLabel} {current.timeLabel}</b></div>
              {/* Three segments, canon's own shape (:692) — WHO, what they are
                  qualified for, and on which bed. The middle one is read off
                  the roster's 資格 plane rather than written in. */}
              <div className="rv-dlg-fact"><span>担当資格・設備</span><b>{current.staffName} / {current.qualificationText} / {current.resourceName}</b></div>
              <div className="rv-dlg-fact"><span>受付価格</span><b>{current.priceLabel}</b></div>
              <div className="rv-dlg-fact"><span>価格条件</span><b>{current.eligibility}</b></div>
              <div className="rv-dlg-fact"><span>確定通知</span><b>Reserve通知 + SMS / 送信待ち</b></div>
              {current.shiftWarning && (
                <div className="rv-dlg-fact is-warn"><span>勤務時間</span><b>{current.shiftWarning}</b></div>
              )}
            </div>
          )}
          <label className="rv-confirmbox">
            <input type="checkbox" checked={acceptOk} onChange={(e) => setAcceptOk(e.target.checked)} />
            <span>予約枠・担当資格・ベッド・受付価格・通知先を確認しました</span>
          </label>
        </div>
        <div className="rv-dlg-foot">
          <button className="btn" type="button" onClick={() => acceptRef.current?.close()}>戻る</button>
          <button className="btn primary" type="button" disabled={!acceptOk} onClick={() => current && run(acceptCommit(current, acceptOk, props.lensLabel, boardNow), acceptRef.current)}>
            証拠を残して受け付ける
          </button>
        </div>
      </dialog>

      {/* ── 記録ダイアログ (M-76–M-79), kept EXACTLY as built (⚖-ADJ C) ──── */}
      <dialog className="rv-dlg" ref={recordRef} aria-labelledby="rvRecordTitle">
        <div className="rv-dlg-head">
          <div>
            <h2 id="rvRecordTitle">来店・キャンセルを記録</h2>
            <p>予約を消さず、判断元と次の仕事を履歴に残します</p>
          </div>
          <button className="rv-dlg-close" type="button" aria-label="閉じる" onClick={() => recordRef.current?.close()}>×</button>
        </div>
        <div className="rv-dlg-body">
          {current && (
            <div className="rv-dlg-facts">
              <div className="rv-dlg-fact"><span>予約・お客様</span><b>{current.no} / {current.customerName}</b></div>
              <div className="rv-dlg-fact"><span>予約枠</span><b>{current.dateLabel} {current.timeLabel}</b></div>
              <div className="rv-dlg-fact"><span>受付価格</span><b>{current.priceLabel}</b></div>
              <div className="rv-dlg-fact"><span>正本・受付元</span><b>{current.sourceGroup === 'external' ? genuineOf(current.sourceGroup) : `${genuineOf(current.sourceGroup)} / ${current.sourceLabel}`}</b></div>
            </div>
          )}
          <label className="rv-field">
            結果
            <select value={recordType} onChange={(e) => setRecordType(e.target.value)}>
              <option value="">選択してください</option>
              <option value="arrived">来店済み・精算へ</option>
              <option value="cancelled">お客様キャンセル</option>
              <option value="no_show">無断キャンセル</option>
            </select>
          </label>
          <label className="rv-field">
            確認元
            <select value={recordSource} onChange={(e) => setRecordSource(e.target.value)}>
              <option value="">選択してください</option>
              <option>電話で本人確認</option>
              <option>Reserve操作を同期</option>
              <option>SMS送信・返答なし</option>
              <option>店頭で確認</option>
            </select>
          </label>
          <label className="rv-confirmbox">
            <input type="checkbox" checked={recordOk} onChange={(e) => setRecordOk(e.target.checked)} />
            <span>予約番号・お客様・受付価格・確認元・次の対応を確認しました</span>
          </label>
        </div>
        <div className="rv-dlg-foot">
          <button className="btn" type="button" onClick={() => recordRef.current?.close()}>戻る</button>
          <button
            className="btn primary"
            type="button"
            disabled={!recordType || !recordSource || !recordOk}
            onClick={() =>
              current &&
              run(recordCommit(current, recordType, recordSource, recordOk, props.lensLabel, boardNow), recordRef.current)
            }
          >
            証拠を残して反映
          </button>
        </div>
      </dialog>

      <div className={`rv-toast${toast ? ' is-on' : ''}`} role="status" aria-live="polite" aria-atomic="true">
        {toast}
      </div>

      {/* ⚖ Liam 8/23 — 画面の説明. Four layers, in the family's own order: the
          click catcher (which is what makes every declared region jumpable), the
          hover outline, the spotlight hole, and the card. */}
      {tourOpen && (
        <>
          <div
            className="rv-spot-catch"
            onClick={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourIdx(hit >= 0 ? hit : -1)
            }}
            onMouseMove={(e) => {
              const hit = spotHitIndex(e.clientX, e.clientY, tourRectsRef.current)
              setTourHover(hit >= 0 && hit !== tourStep?.idx ? tourRectsRef.current[hit] : null)
            }}
          />
          {tourHover && (
            <div
              className="rv-spot-hover"
              aria-hidden="true"
              style={{ top: tourHover.top - 5, left: tourHover.left - 5, width: tourHover.width + 10, height: tourHover.height + 10 }}
            />
          )}
          {tourPos && (
            <div className="rv-spot-hole" aria-hidden="true" style={{ top: tourPos.hole.top, left: tourPos.hole.left, width: tourPos.hole.width, height: tourPos.hole.height }} />
          )}
          <div
            className="rv-spot-card"
            id="rvTour"
            ref={tourCardRef}
            role="dialog"
            aria-label="画面の説明"
            style={tourPos ? { top: tourPos.top, left: tourPos.left } : { top: -9999, left: -9999 }}
          >
            <b>{tourStep?.title ?? ''}</b>
            <span className="rv-spot-text">{tourStep?.text ?? ''}</span>
            <div className="rv-spot-hint">気になる場所を押すと、その説明にジャンプします</div>
            <div className="rv-spot-foot">
              <button type="button" className="rv-spot-prev" disabled={tourStep?.idx === 0} onClick={() => setTourIdx((i) => wrapStep(i - 1, tourRectsRef.current.length))}>前へ</button>
              <button type="button" className="rv-spot-next" ref={tourNextRef} onClick={() => setTourIdx((i) => wrapStep(i + 1, tourRectsRef.current.length))}>
                {tourStep && tourStep.idx === tourStep.total - 1 ? '最初へ' : '次へ'}
              </button>
              <span className="rv-spot-count">{tourStep ? `${tourStep.idx + 1} / ${tourStep.total}` : ''}</span>
              <button type="button" className="rv-spot-done" onClick={() => setTourIdx(-1)}>終了 ✕</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** A day header and its row share one parent slot; React needs a keyed wrapper
 *  and a grid needs the two to be siblings, so the wrapper is `display: contents`
 *  rather than a box. */
function RowGroup({ children }: { children: React.ReactNode }) {
  return <div className="rv-grouping">{children}</div>
}

const boxOf = (r: DOMRect): SpotRect => ({ left: r.left, top: r.top, width: r.width, height: r.height })

/** The height spring every collapse on this page rides — the rail's detail and
 *  the picker's confirm. `auto` at rest so a panel that grows while open (a
 *  refusal line appearing) is not pinned to a stale pixel height. */
function useCollapse(ref: React.RefObject<HTMLDivElement | null>, open: boolean, reduced: boolean) {
  const first = useRef(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const inner = el.firstElementChild
    inner?.classList.toggle('is-in', open)
    if (first.current) {
      first.current = false
      el.style.height = open ? 'auto' : '0px'
      return
    }
    const sp = makeSpring((v) => { el.style.height = `${v}px` }, {
      response: 0.34,
      reduced,
      onRest: () => { if (open) el.style.height = 'auto' },
    })
    sp.jump(el.getBoundingClientRect().height)
    sp.set(open ? el.scrollHeight : 0)
    return () => sp.stop()
  }, [ref, open, reduced])
}

function href(props: ReservationsProps, segment: string): string {
  return `/${props.locale}/business/${segment}${props.store ? `?store=${props.store}` : ''}`
}

/** F6 (fix round 1, LENS-3 F-1) — the sheet's own focusable set, spelled ONCE
 *  so the Tab trap and the focus-on-open read cannot disagree, ported from
 *  RecordingScreen.tsx's `Overlay` (:2263) IN-ROOM: a shared overlay
 *  primitive is a family-sweep item, not this round. */
export const SHEET_FOCUSABLE = 'button:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]'

/** The sheet's Tab trap, ported from RecordingScreen.tsx's `Overlay`
 *  (:2302-2310). Exported so the suite drives it on real nodes, the same
 *  reason `focusResult` is. */
export function trapSheetTab(panel: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab') return
  const focusable = Array.from(panel.querySelectorAll<HTMLElement>(SHEET_FOCUSABLE))
  if (focusable.length === 0) {
    e.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

/** Wires the sheet panel on open: focuses its first focusable and installs
 *  the Tab trap, returning the cleanup — same shape as `wireColumnsPopover`
 *  (column-config.ts), IN-ROOM because this room's overlay is not that
 *  shared primitive. */
export function wireSheet(panel: HTMLElement): () => void {
  ;(panel.querySelector<HTMLElement>(SHEET_FOCUSABLE) ?? panel).focus()
  const onKey = (e: KeyboardEvent) => trapSheetTab(panel, e)
  panel.addEventListener('keydown', onKey)
  return () => panel.removeEventListener('keydown', onKey)
}

/** canon `focusResult` (:541): after a commit or a rail jump, focus lands on
 *  the row that changed; on the first row when that booking is filtered out of
 *  the list; and on the result count when the list is empty. Exported so the
 *  suite drives it on real nodes — this is the focus handoff, not a decoration. */
export function focusResult(
  list: HTMLElement | null,
  count: HTMLElement | null,
  preferredId: string,
): void {
  const target =
    list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(preferredId)}"]`) ??
    list?.querySelector<HTMLElement>('.rv-row') ??
    count
  target?.focus()
}

/** One list cell. The column set is user-controlled, so each cell names its
 *  column (`data-col`) rather than relying on its position — hiding 日時 must
 *  not hand 受付元's wrapping rules to whichever cell slid into slot 4, and the
 *  narrow band's shed keys on the same attribute. */
function Cell({ col, row }: { col: (typeof COLUMNS)[number]['k']; row: Decorated }) {
  if (col === 'when') {
    return (
      <span className="rv-cell" data-col="when">
        <span className="rv-tm">{row.startLabel}</span>
        <span className="rv-l2">{row.timeLabel}</span>
      </span>
    )
  }
  if (col === 'who') {
    return (
      <span className="rv-cell" data-col="who">
        <span className="rv-nm">
          {row.queued && <span className="rv-attnmark" aria-hidden="true">!</span>}
          {row.customerName}
          {/* ⚖ rider #3 — quiet memory, and it says WHAT it counts. */}
          {row.noShowCount > 0 && <span className="rv-noshow">来店なし{row.noShowCount}回</span>}
        </span>
        <span className="rv-l2">{row.menuName} / {row.no}</span>
        {/* the line the narrow and phone bands fall back to — 担当・設備 first,
            then 受付元・価格; the sheet decides which halves show */}
        <span className="rv-mline">
          <span className="rv-m-sd">担当 {row.staffName} / {row.resourceName}</span>
          <span className="rv-m-sp">受付 {row.sourceLabel} / {row.priceLabel}</span>
        </span>
      </span>
    )
  }
  if (col === 'staff') {
    return (
      <span className="rv-cell" data-col="staff">
        <span className="rv-l1">{row.staffName}</span>
        <span className="rv-l2">{row.resourceName}</span>
      </span>
    )
  }
  if (col === 'source') {
    return (
      <span className="rv-cell" data-col="source">
        <span className="rv-l1">{row.sourceLabel}</span>
        <span className="rv-l2">{row.priceLabel}</span>
        {row.storeLabel && <span className="rv-prov">{row.storeLabel}</span>}
      </span>
    )
  }
  return (
    <span className="rv-cell rv-st" data-col="state">
      <StateCell row={row} />
    </span>
  )
}

/** 状態列 = the lifecycle pill over its modifier flags, joined into ONE note
 *  line. The flags wrap inside their own track and never truncate — the note is
 *  the reason a row needs a human. */
function StateCell({ row }: { row: Decorated }) {
  const { label, tone } = LIFECYCLE[row.lifecycle]
  const alarming = row.overdue || row.allFlags.includes('担当変更が必要（安全な候補なし）')
  return (
    <>
      <span className={`pill ${tone}`}>{label}</span>
      {row.allFlags.length > 0 && (
        <span className={`rv-note${alarming ? ' is-warn' : ''}`}>{row.allFlags.join('・')}</span>
      )}
    </>
  )
}

/** The evidence under an open rail card. Every line is read off the booking or
 *  off a fixture plane — no urgency is written here that the data does not
 *  carry. ⚖-ADJ B: only the CHANGE card's 空き枠候補 row is pickable; every
 *  other slot is read-only or the honest empty state, so a card never implies an
 *  action its data cannot carry. */
function Evidence({
  row,
  candidates,
  pickedSlot,
  onPick,
}: {
  row: Decorated
  candidates: SlotOption[]
  pickedSlot: string
  onPick: (id: string) => void
}) {
  const money = (
    <Ev k="受付価格" v={`${row.priceLabel} を保持`} n={`現在の公開価格 ${row.currentPriceLabel}`} />
  )
  if (row.kind === 'accept') {
    return (
      <>
        {money}
        <Ev k="担当・設備" n={row.eligibility}>
          <span className="rv-slots">
            <span className="rv-slot is-ro">
              <span className="rv-sl-t">{row.staffName}</span>
              <span className="rv-sl-s">{row.resourceName}</span>
            </span>
          </span>
        </Ev>
        {row.shiftWarning && <Ev warn k="確認が必要" v={row.shiftWarning} />}
      </>
    )
  }
  if (row.kind === 'change') {
    return (
      <>
        {money}
        {/* ⚖ rider #2 — the candidate COUNT is what the plane honestly knows;
            a per-day 空き hint would be an invented number (registry ⑥). */}
        <Ev k={`空き枠候補 ${candidates.length}件`}>
          {candidates.length === 0 ? (
            <span className="rv-slots">
              <span className="rv-slot is-empty">
                <span className="rv-sl-t">この予約を収められる空き枠はありません</span>
              </span>
            </span>
          ) : (
            <span className="rv-slots">
              {candidates.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-press
                  data-cand={s.id}
                  className={`rv-slot${pickedSlot === s.id ? ' is-on' : ''}`}
                  aria-pressed={pickedSlot === s.id}
                  onClick={() => onPick(s.id)}
                >
                  <span className="rv-mark" aria-hidden="true" />
                  <span className="rv-sl-t">{row.dateLabel} {hhmm(s.start)}–{hhmm(s.start + row.durationMinutes)}</span>
                  <span className="rv-sl-s">{s.staffName} + {s.resourceName}</span>
                  <span className="rv-sl-pick">{pickedSlot === s.id ? '選択中' : '選ぶ'}</span>
                </button>
              ))}
            </span>
          )}
        </Ev>
        <Ev k="希望の内容" v={row.proof} />
      </>
    )
  }
  if (row.kind === 'escalate') {
    return (
      <>
        <Ev
          k="現在の担当"
          v={`${row.staffName} / ${row.staffUnavailable ? '勤務不可' : '対応不可'}`}
          n={`${row.dateLabel} ${row.timeLabel} / ${row.menuName}`}
        />
        <Ev warn k="安全な候補" n={row.proof}>
          <span className="rv-slots">
            <span className="rv-slot is-empty"><span className="rv-sl-t">なし</span></span>
          </span>
        </Ev>
      </>
    )
  }
  if (row.kind === 'settle') {
    return (
      <>
        {money}
        <Ev k="レジ取引" n={row.txDetail}>
          <span className="rv-slots">
            <span className="rv-slot is-ro"><span className="rv-sl-t">{row.txNote}</span></span>
          </span>
        </Ev>
      </>
    )
  }
  return (
    <Ev k="予約" n={row.proof}>
      <span className="rv-slots">
        <span className="rv-slot is-ro">
          <span className="rv-sl-t">{row.dateLabel} {row.timeLabel}</span>
          <span className="rv-sl-s">{row.menuName}</span>
        </span>
      </span>
    </Ev>
  )
}

function Ev({
  k,
  v,
  n,
  warn,
  children,
}: {
  k: string
  v?: string
  n?: string | null
  warn?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`rv-ev${warn ? ' is-warn' : ''}`}>
      <span className="rv-ev-k">{k}</span>
      <span className="rv-ev-v">
        {children ?? v}
        {n && <span className="rv-ev-n">{n}</span>}
      </span>
    </div>
  )
}

/** The rail card's own primary. ONE HOME PER DECISION: the change card has no
 *  button at all, because the picker beside it IS the action (⚖-ADJ B). */
function RailAction({
  row,
  onAccept,
  onToast,
  onFocusRow,
}: {
  row: Decorated
  onAccept: () => void
  onToast: (m: string) => void
  onFocusRow: () => void
}) {
  if (row.kind === 'change') return null
  if (row.kind === 'settle') {
    return (
      <button className="btn" type="button" disabled title="売上・レジは準備中です">
        {QUEUE_ACTION.settle}（準備中）
      </button>
    )
  }
  return (
    <button
      className="btn primary"
      type="button"
      data-press
      onClick={() => {
        if (row.kind === 'accept') onAccept()
        else if (row.kind === 'escalate') onToast(ESCALATE_TOAST(row.no))
        else onFocusRow()
      }}
    >
      {QUEUE_ACTION[row.kind]}
    </button>
  )
}

/** THE INSPECTOR'S BODY — ONE component, rendered inside the desk column or
 *  inside the phone sheet, never both at once on screen (⚖ one verdict, one
 *  home). It owns no layout of its own; where it sits is the band's business. */
function InspectorBody({
  row,
  props,
  offList,
  openParty,
  onParty,
  onAccept,
  onRecord,
  onChange,
  onToast,
}: {
  row: Decorated
  props: ReservationsProps
  offList: boolean
  openParty: boolean
  onParty: () => void
  onAccept: () => void
  onRecord: () => void
  onChange: () => void
  onToast: (m: string) => void
}) {
  const action = primaryActionOf(row.lifecycle, row.allFlags, row.deadlineMinute)
  const todayLink = (
    <Link className={`btn${action === 'today' ? ' primary' : ''} rv-pin-btn`} href={href(props, 'today')} data-press>
      今日の運営で見る
    </Link>
  )
  return (
    <>
      <div className="rv-insp-pin">
        {action !== 'today' && (
          <Primary row={row} action={action} onAccept={onAccept} onRecord={onRecord} onChange={onChange} onToast={onToast} />
        )}
        {todayLink}
      </div>
      <div className="rv-insp-body" key={row.id}>
        <div className="rv-insp-hd">
          <div className="rv-rid">予約 {row.no}</div>
          <div className="rv-insp-nm">{row.customerName}</div>
          <div className="rv-insp-mt">{row.dateLabel} {row.timeLabel} / {row.menuName}</div>
        </div>
        {offList && (
          <p className="rv-offlist">
            選択中の予約は現在の検索・絞り込みには含まれていません。選択は保持しています。
          </p>
        )}
        <div className="rv-toprow">
          <StateCell row={row} />
          <span className="rv-src">{row.sourceLabel} / {row.no}</span>
        </div>
        <div className="rv-insp-sec">
          <div className="rv-kv2">
            <div><span className="rv-k2">担当</span><span className="rv-v2">{row.staffName}</span></div>
            <div><span className="rv-k2">設備</span><span className="rv-v2">{row.resourceName}</span></div>
            <div><span className="rv-k2">日時</span><span className="rv-v2">{row.dateLabel} {row.timeLabel}</span></div>
            {/* ⚖-ADJ G — 正本 is SYNQED for a Reserve row. Reserve and SYNQED are
                two doors onto ONE database; only an外部予約元 booking is owned
                somewhere else. The accept dialog's own 「お客様・正本 … / SYNQED」
                and the external readonly band below both say the same thing.
                F-1 (fix round 1, LENS-2 BLOCKER): ONE home, `genuineOf` — this
                site and the 記録 dialog's 正本・受付元 both read it now. */}
            <div><span className="rv-k2">正本</span><span className="rv-v2">{genuineOf(row.sourceGroup)}</span></div>
          </div>
        </div>
        {row.lifecycle === 'external' && (
          <p className="rv-readonly">
            この予約は外部予約元が正本です。表示のみで、SYNQEDからは日時・担当・受付価格を変更しません。
          </p>
        )}
        <div className="rv-insp-sec">
          <span className="rv-sk">本人関係</span>
          <PartyBlock row={row} open={openParty} onToggle={onParty} />
        </div>
        <div className="rv-insp-sec">
          <span className="rv-sk">価格の証拠</span>
          <div className="rv-price">
            <div><span className="rv-k2">受付時に合意</span><span className="rv-v2">{row.priceLabel}</span></div>
            <div><span className="rv-k2">現在の公開価格</span><span className="rv-v2">{row.currentPriceLabel}</span></div>
          </div>
          <div className="rv-provbox">
            <div className="rv-prov-t">{row.eligibility}</div>
            <div className="rv-prov-b">{row.proof}</div>
          </div>
        </div>
        <div className="rv-insp-sec">
          <span className="rv-sk">操作履歴</span>
          {row.history.length === 0 ? (
            <div className="rv-histline">
              <span className="rv-dash">—</span>
              <span className="rv-tx">この予約の操作履歴はまだありません</span>
            </div>
          ) : (
            row.history.map(([time, act, detail], i) => (
              <div className="rv-histline" key={`${time}-${i}`}>
                <span className="rv-dash">{time}</span>
                <span className="rv-tx">{act}<span className="rv-hd">{detail}</span></span>
              </div>
            ))
          )}
        </div>
        <div className="rv-insp-foot">
          <button className="btn" type="button" disabled title="カルテ連携は準備中です">Karuteを開く（準備中）</button>
          <button className="btn" type="button" disabled title="受信トレイは準備中です">受信トレイで連絡（準備中）</button>
        </div>
      </div>
    </>
  )
}

/** The inspector's primary action, read from the lifecycle + flags — never from
 *  a booking number. A screen that is not built yet is greyed 準備中 rather than
 *  offered as a dead link (L-7). */
function Primary({
  row,
  action,
  onAccept,
  onRecord,
  onChange,
  onToast,
}: {
  row: Decorated
  action: ReturnType<typeof primaryActionOf>
  onAccept: () => void
  onRecord: () => void
  onChange: () => void
  onToast: (m: string) => void
}) {
  const cls = 'btn primary rv-pin-btn'
  // A destination that does not exist yet is greyed on the OUTLINE button, the
  // same as everywhere else in Business — a disabled filled button reads as a
  // broken commit rather than as "not built yet".
  const pending = 'btn rv-pin-btn'
  switch (action) {
    case 'escalate':
      return (
        <button className={cls} type="button" data-press onClick={() => onToast(ESCALATE_TOAST(row.no))}>
          判断できる担当者へ相談
        </button>
      )
    // ⚖-ADJ B — the change decision has ONE home, the rail's own picker. The
    // inspector's button takes the reader there rather than opening a second
    // surface for the same verdict.
    case 'change':
      return <button className={cls} type="button" data-press onClick={onChange}>日時・担当変更を確認</button>
    case 'accept':
      return <button className={cls} type="button" data-press onClick={onAccept}>受付リクエストを確認</button>
    case 'settle':
      return <button className={pending} type="button" disabled title="売上・レジは準備中です">売上・レジで精算（準備中）</button>
    case 'external':
      return (
        <button className={cls} type="button" data-press onClick={() => onToast(`外部予約元 ${row.no}の参照先はこの探索では省略しています。SYNQEDから変更はしません`)}>
          予約元の記録を確認
        </button>
      )
    case 'record':
      return <button className={cls} type="button" data-press onClick={onRecord}>来店・キャンセルを記録</button>
    case 'propose':
      return <button className={pending} type="button" disabled title="受信トレイは準備中です">受信トレイで提案（準備中）</button>
    default:
      return <button className={pending} type="button" disabled title="受信トレイは準備中です">お客様対応を確認（準備中）</button>
  }
}

/** 本人関係, collapsed per ⚖ cut #7 — the same treatment the 顧客 screen carries,
 *  so a party that deviates reads the same way on both screens. The 来店なし
 *  memory rides on the 顧客 line, where the person it is about is named. */
function PartyBlock({ row, open, onToggle }: { row: Decorated; open: boolean; onToggle: () => void }) {
  return (
    <div className="rv-party">
      <button className="rv-party-row" type="button" data-press onClick={onToggle} aria-expanded={open}>
        <span className="rv-k2">顧客</span>
        <b>{row.customerName}</b>
        {row.noShowCount > 0 && <span className="rv-noshow">来店なし 過去{row.noShowCount}回</span>}
      </button>
      {row.party.map((p) => (
        <button className="rv-party-row" type="button" data-press key={p.role} onClick={onToggle} aria-expanded={open}>
          <span className="rv-k2">{p.role}</span>
          <b>{p.name}</b>
          <span className="pill warn">別の方</span>
        </button>
      ))}
      {open && (
        <div className="rv-party-note">
          {row.party.length === 0
            ? 'サービス対象・保護者・支払者はすべてご本人です。'
            : row.party.map((p) => `${p.role}：${p.name}（${p.note}）`).join(' / ')}
        </div>
      )}
    </div>
  )
}
