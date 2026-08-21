'use client'

// 予約一覧 — the canon screen's markup and behavior
// (fable-store-reservations.html), transplanted. Canon class names, canon
// Japanese wording, canon structure. Values arrive pre-formatted from the
// server page: no dates, no data access and no store lens logic live here.
//
// EVERY NUMBER IS DERIVED, NONE IS TYPED. 要対応, 最短期限, the queue and the
// 状態 filter's 要対応 option all read the SAME `isQueued` predicate from
// src/business/lib/reservations.ts, and the countdowns are that predicate's
// deadline minus the one pinned world clock. That is canon's own discipline
// (「数字はどこにも直書きしない」) and the reason a client-side accept moves the
// tile, the queue and the row together or not at all.
//
// BATCH-1 INTERACTION FLOOR (⚖ L-7, read-and-play, zero persistence):
//   · search / filters / saved views / row select all work client-side
//   · 受付 → 確定, 変更 → the new slot, 記録 → 精算待ち / 取消 / 来店なし are
//     canon's own client-state transitions and they carry over: the pill, the
//     queue, the tiles and the row order all move, and it resets on reload
//   · an action whose screen is not built (売上・レジ, 受信トレイ, カルテ) is
//     greyed 準備中, and one with no canon transition sits disabled with the
//     standing hint. Nothing here reports a success the screen cannot show.
//
// ⚖ CUT #5: canon's two-sentence subtitle is reduced to one functional line.
// ⚖ CUT #7: 本人関係 renders COLLAPSED — one line per party, detail on click, a
// chip only where the fixture deviates.
// ⚖ L-4: the boundary paragraphs (queue footer, inspector footer) and the mock
// harness (role lenses, 表示プレビュー, testdb anchor) do not ship.

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toggleColumn, wireColumnsPopover } from '@/business/lib/column-config'
import {
  DEADLINE_WORD,
  LIFECYCLE,
  QUEUE_ACTION,
  WANTS_CHANGE,
  deadlineOf,
  decisionKindOf,
  flagsOf,
  isQueued,
  matchesFilters,
  primaryActionOf,
  safeSlotsFor,
  spanText,
  viewFilters,
  type DecisionKind,
  type Lifecycle,
  type SavedView,
} from '@/business/lib/reservations'
import { hhmm } from '@/business/lib/today-board'

export interface ReservationRow {
  id: string
  no: string
  dateLabel: string
  dayKey: number
  isToday: boolean
  startMinute: number
  durationMinutes: number
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
  txNote: string
  txDetail: string | null
}

/** A 販売可能枠 the 変更 dialog can offer. Whether it can hold a given booking is
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
  /** Canon's date filter names its days (「本日 8月5日」/「8月6日以降」). Both come
   *  off the server's clock so no second calendar exists on the client. */
  todayLabel: string
  tomorrowLabel: string
  storeParam: string | null
  /** JST minutes from midnight — the one pinned world clock (13:24), shared
   *  with the Today board's now-line and the topbar's Reserve同期 stamp. */
  boardNow: number
  /** 閉店. The 精算期限 IS this, so a store's hours move every settlement
   *  deadline and no fixture carries a second copy. */
  closeMinute: number
}

const HINT = '見本データのため実行できません'

type DateFilter = 'all' | 'today' | 'future'
type StatusFilter = 'all' | 'attention' | Lifecycle
type SourceFilter = 'all' | 'reserve' | 'store' | 'external'

/** 表示する列 — canon's own `data-columns-config` for this panel, verbatim
 *  (fable-store-reservations.html:407). `nw` is the ≤1320px track the page's
 *  @media block declares. Reservations lists no column as `off`, so all five
 *  start visible; the popover is a per-device display preference, which is what
 *  fable-shared.js's comment calls it (no permission gate). */
export const COLUMNS = [
  { k: 'when', label: '日時', w: '84px', nw: '78px' },
  { k: 'who', label: 'お客様・メニュー', w: 'minmax(min-content, 1.15fr)', nw: 'minmax(min-content, 1.1fr)' },
  { k: 'staff', label: '担当・設備', w: 'minmax(min-content, .72fr)', nw: 'minmax(min-content, .68fr)' },
  { k: 'source', label: '受付元・価格', w: 'minmax(0, 1.08fr)', nw: 'minmax(0, 1.02fr)' },
  { k: 'state', label: '状態', w: '152px', nw: '140px' },
] as const

const DEFAULT_COLUMNS: string[] = COLUMNS.map((c) => c.k)

const STATUS_OPTIONS: Array<[StatusFilter, string]> = [
  ['all', 'すべての状態'],
  ['attention', '要対応（期限あり）'],
  ['pending_accept', '受付判断'],
  ['confirmed', '確定'],
  ['awaiting_settlement', '精算待ち'],
  ['settled', '精算済み'],
  ['cancelled', '取消'],
  ['no_show', '来店なし'],
  ['external', '予約元で管理'],
]

const SOURCE_OPTIONS: Array<[SourceFilter, string]> = [
  ['all', 'すべての受付元'],
  ['reserve', 'Reserve'],
  ['store', '電話・店頭'],
  ['external', '外部予約元'],
]

const SAVED_VIEW_LABELS: Array<[SavedView, string]> = [
  ['all', 'すべて'],
  ['attention', '要対応'],
  ['reserve', 'Reserve受付'],
  ['none', '一致なしを確認'],
]

/** The one-sentence judgement on a queue card. Read from the decision kind, so
 *  a card can never describe a booking it is not about. */
const DECISION: Record<DecisionKind, (r: Decorated) => string> = {
  accept: (r) => `${r.customerName}さんの受付リクエストを受けるか決める`,
  change: (r) => `${r.customerName}さんの日時・担当の変更希望に回答する`,
  escalate: (r) => `${r.dateLabel} ${r.timeLabel} の担当者が決まっていない`,
  settle: (r) => `${r.customerName}さんの施術が未精算のまま残っている`,
  open: (r) => `${r.customerName}さんの予約に期限のある判断が残っている`,
}

export interface Decorated extends ReservationRow {
  deadlineMinute: number | null
  overdue: boolean
  queued: boolean
  allFlags: string[]
  kind: DecisionKind
}

/** Everything the screen shows about a row that is not literally a field.
 *  Exported for the suite: the tile↔queue↔row reconciliation is asserted
 *  against this one function rather than against three re-implementations. */
export function decorate(row: ReservationRow, boardNow: number, closeMinute: number): Decorated {
  const deadlineMinute = deadlineOf(row.lifecycle, row, closeMinute)
  const overdue = deadlineMinute !== null && deadlineMinute < boardNow
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
 * 画面内で変更を試す (canon :699) — the in-page trial move. The day does NOT
 * move: a 販売可能枠 is a daily shape offered on the booking's own date, so this
 * changes time, staff and bed only. The agreed price is carried untouched, and
 * 変更希望あり comes off while 担当変更あり goes on when the person changed.
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
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">予約管理</div>
          <h1>予約一覧</h1>
        </div>
      </header>
      <section className="summary" aria-label="予約の概要">
        <div className="summary-main">
          <strong>予約を読み込めませんでした</strong>
          <span>この画面の数字は1つも表示していません。</span>
        </div>
        <div className="summary-stat"><span>要対応</span><b>—</b><span>最短期限 —</span></div>
        <div className="summary-stat"><span>精算待ち</span><b>—</b></div>
        <div className="summary-stat"><span>本日</span><b>—</b></div>
      </section>
      <div className="load-error" role="alert">
        データを読み込めませんでした。この画面の数字は使わないでください。再読み込みしても直らない場合は管理者へ。
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
  const [status, setStatus] = useState<StatusFilter>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  // Canon starts on 「すべて」 (w2-bookings-customers.js `runtime.savedView='all'`)
  // and only ever moves when another chip is pressed — editing a filter by hand
  // does NOT clear it, which is why canon's own 保存した表示 criteria string
  // reads the live controls rather than the view. One lit chip, always.
  const [savedView, setSavedView] = useState<SavedView>('all')
  const [openParty, setOpenParty] = useState(false)
  const [toast, setToast] = useState('')
  const [shown, setShown] = useState<string[]>(DEFAULT_COLUMNS)
  const [colsOpen, setColsOpen] = useState(false)

  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const colsBtnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const acceptRef = useRef<HTMLDialogElement>(null)
  const changeRef = useRef<HTMLDialogElement>(null)
  const recordRef = useRef<HTMLDialogElement>(null)
  const [acceptOk, setAcceptOk] = useState(false)
  const [changeSlot, setChangeSlot] = useState('')
  const [changeReason, setChangeReason] = useState('')
  const [changeOk, setChangeOk] = useState(false)
  const [recordType, setRecordType] = useState('')
  const [recordSource, setRecordSource] = useState('')
  const [recordOk, setRecordOk] = useState(false)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2700)
    return () => clearTimeout(t)
  }, [toast])

  // 表示する列 popover — the wiring itself is the shared canon primitive, unit-
  // tested on real DOM nodes, so this effect stays a thin caller of it.
  useEffect(() => {
    if (!colsOpen || !popRef.current || !colsBtnRef.current) return
    return wireColumnsPopover(popRef.current, colsBtnRef.current, () => setColsOpen(false))
  }, [colsOpen])

  const columns = useMemo(() => COLUMNS.filter((c) => shown.includes(c.k)), [shown])
  // Both track lists ride as custom properties; the stylesheet's 1320px media
  // query picks between them, exactly as canon's own @media does.
  const trackStyle = {
    '--fx-wide': columns.map((c) => c.w).join(' '),
    '--fx-narrow': columns.map((c) => c.nw).join(' '),
  } as React.CSSProperties

  const all = useMemo(
    () => props.rows.map((r) => decorate({ ...r, ...patch[r.id] }, boardNow, closeMinute)),
    [props.rows, patch, boardNow, closeMinute],
  )

  const visible = useMemo(
    () => all.filter((r) => matchesFilters(r, { search, date, status, source })),
    [all, search, date, status, source],
  )

  // A1: the selection is sovereign. It moves only when the booking itself is
  // gone from the lens — not when a filter hides it, which would let the
  // inspector quietly swap to another customer after a queue action.
  const current = all.find((r) => r.id === selected) ?? visible[0] ?? all[0] ?? null
  const offList = current != null && !visible.some((r) => r.id === current.id)

  const queue = useMemo(
    () => all.filter((r) => r.queued).sort((a, b) => a.deadlineMinute! - b.deadlineMinute!),
    [all],
  )
  const settling = all.filter((r) => r.lifecycle === 'awaiting_settlement').length
  // 本日 counts the day's live rows — the same rule the board's 本日の予約件数
  // uses, so the two screens report one number for one day.
  const todayCount = all.filter((r) => r.isToday && r.lifecycle !== 'cancelled').length

  const candidates = current ? safeSlotsFor(props.slots, current.durationMinutes) : []

  function update(id: string, next: Partial<ReservationRow>, message: string) {
    setPatch((was) => ({ ...was, [id]: { ...was[id], ...next } }))
    setSelected(id)
    setToast(message)
    // canon `focusResult` (:541): a commit hands focus back to the row it
    // changed, so the proof of the change is where the keyboard already is.
    // The row is re-rendered by this same update, hence the frame's delay.
    requestAnimationFrame(() => focusResult(listRef.current, countRef.current, id))
  }

  // canon `clearFilters` (:710): the saved-view chip is NOT cleared here, and
  // the caret goes back in the search box — clearing is a step in typing the
  // next search, not the end of one.
  function clearFilters() {
    setSearch('')
    setDate('all')
    setStatus('all')
    setSource('all')
    searchRef.current?.focus()
  }

  function applyView(view: SavedView) {
    const f = viewFilters(view)
    setSavedView(view)
    setDate(f.date)
    setSource(f.source)
    setStatus(f.status)
    setSearch(f.search)
    // canon hands focus to the result count (:744) — the one thing on screen
    // that just changed meaning.
    countRef.current?.focus()
  }

  function openAccept() {
    setAcceptOk(false)
    acceptRef.current?.showModal()
  }
  function openChange() {
    setChangeSlot(candidates[0]?.id ?? '')
    setChangeReason('')
    setChangeOk(false)
    changeRef.current?.showModal()
  }
  function openRecord() {
    setRecordType('')
    setRecordSource('')
    setRecordOk(false)
    recordRef.current?.showModal()
  }

  // The three commits are thin: the gate and the transition are pure functions
  // above (unit-tested directly), and these own only the dialog and the patch.
  function run(commit: Commit | null, dialog: HTMLDialogElement | null) {
    if (!commit || !current) return
    update(current.id, commit.patch, commit.message)
    dialog?.close()
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{props.lensLabel} / 予約管理</div>
          <h1>予約一覧</h1>
          <p className="subtitle">期限のある予約判断と、日をまたぐ予約の検索。</p>
        </div>
        <Link className="btn primary" href={href(props, 'today')}>今日の運営で予約を作成</Link>
      </header>

      <section className="summary" aria-label="予約の概要">
        <div className="summary-main">
          <strong>{props.spanLabel}の予約</strong>
          <span>予定表ではなく、日をまたぐ予約の検索・例外処理・証拠確認に使います。</span>
        </div>
        <div className="summary-stat">
          <span>要対応</span>
          <b className="warn">{queue.length}</b>
          <span>最短期限 {queue.length ? hhmm(queue[0].deadlineMinute!) : '—'}</span>
        </div>
        <div className="summary-stat"><span>精算待ち</span><b>{settling}</b></div>
        <div className="summary-stat"><span>本日</span><b>{todayCount}</b></div>
      </section>

      <div className="saved-views" role="group" aria-label="保存した表示">
        <span>保存した表示</span>
        {SAVED_VIEW_LABELS.map(([k, label]) => (
          <button
            key={k}
            className="saved-view"
            type="button"
            aria-pressed={savedView === k}
            onClick={() => applyView(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="filters" aria-label="予約を絞り込む" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="お客様名・予約番号・メニュー・担当"
          aria-label="予約を検索"
        />
        <select value={date} onChange={(e) => setDate(e.target.value as DateFilter)} aria-label="日付">
          <option value="all">{props.spanLabel}</option>
          <option value="today">本日 {props.todayLabel}</option>
          <option value="future">{props.tomorrowLabel}以降</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="状態">
          {STATUS_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label="受付元">
          {SOURCE_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button className="btn" type="button" onClick={clearFilters}>クリア</button>
      </form>

      <div className="workspace">
        <section className="panel" id="bookingPanel" style={trackStyle} aria-labelledby="listTitle">
          <div className="panel-head">
            <div>
              <strong id="listTitle">全予約リスト</strong>
              <span>{props.spanLabel}の全件。検索と絞り込みはこの一覧に効きます</span>
            </div>
            <div className="panel-actions" style={{ position: 'relative' }}>
              <span className="result-count" role="status" aria-live="polite" tabIndex={-1} ref={countRef}>
                {visible.length}件
              </span>
              <button
                className="btn fx-cols-btn"
                type="button"
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
          <div className="fx-scroll">
            <div className="list-head" aria-hidden="true">
              {columns.map((c) => (
                <span key={c.k} className={c.k === 'state' ? 'badge-col' : undefined}>{c.label}</span>
              ))}
            </div>
            {visible.length > 0 && (
              <div className="booking-list" ref={listRef}>
                {visible.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    data-id={r.id}
                    className={`booking-row${r.id === current?.id ? ' selected' : ''}`}
                    aria-pressed={r.id === current?.id}
                    onClick={() => setSelected(r.id)}
                  >
                    {columns.map((c) => (
                      <Cell key={c.k} col={c.k} row={r} />
                    ))}
                  </button>
                ))}
              </div>
            )}
          </div>
          {visible.length === 0 && (
            <div className="empty">
              <strong>一致する予約はありません</strong>
              <span>検索語または絞り込みを変えてください。</span>
            </div>
          )}
        </section>

        {current && (
          <aside className="panel inspector" aria-labelledby="inspectorTitle">
            <div className="inspector-head">
              <div className="inspector-kicker">予約 {current.no}</div>
              <h2 id="inspectorTitle">{current.customerName}</h2>
              <p>{current.dateLabel} {current.timeLabel} / {current.menuName}</p>
            </div>
            <div className="inspector-body">
              {offList && (
                <p className="w2-off-list">
                  選択中の予約は現在の検索・保存した表示には含まれていません。選択は保持しています。
                </p>
              )}
              <div className="status-row">
                <span className="state-cell"><StateCell row={current} /></span>
                <span className="source">{current.sourceLabel} / {current.no}</span>
              </div>
              {current.lifecycle === 'external' && (
                <div className="readonly-note">
                  この予約は外部予約元が正本です — 表示のみ。SYNQEDからは日時・担当・受付価格を変更しません。
                </div>
              )}

              <div className="facts">
                <div className="fact"><span>担当</span><b>{current.staffName}</b></div>
                <div className="fact"><span>設備</span><b>{current.resourceName}</b></div>
                <div className="fact"><span>日時</span><b>{current.dateLabel} {current.timeLabel}</b></div>
                <div className="fact"><span>正本</span><b>{current.sourceGroup === 'external' ? '外部予約元' : 'SYNQED'}</b></div>
              </div>

              <PartyBlock row={current} open={openParty} onToggle={() => setOpenParty((v) => !v)} />

              <div className="section-title">価格の証拠</div>
              <div className="price">
                <div><span>受付時に合意</span><b>{current.priceLabel}</b></div>
                <div><span>現在の公開価格</span><b>{current.currentPriceLabel}</b></div>
              </div>
              <div className="proof" style={{ marginTop: 9 }}>
                <strong>{current.eligibility}</strong>
                <br />
                {current.proof}
              </div>

              <div className="section-title">操作履歴</div>
              <div className="history">
                {current.history.length === 0 ? (
                  <div className="history-row">
                    <time>—</time>
                    <span><strong>この予約の操作履歴はまだありません</strong></span>
                  </div>
                ) : (
                  current.history.map(([time, action, detail], i) => (
                    <div className="history-row" key={`${time}-${i}`}>
                      <time>{time}</time>
                      <span><strong>{action}</strong><span>{detail}</span></span>
                    </div>
                  ))
                )}
              </div>

              <div className="actions">
                <Primary
                  row={current}
                  props={props}
                  onAccept={openAccept}
                  onChange={openChange}
                  onRecord={openRecord}
                  onToast={setToast}
                />
                <button className="btn" type="button" disabled title="カルテ連携は準備中です">Karuteを開く（準備中）</button>
                <button className="btn" type="button" disabled title="受信トレイは準備中です">受信トレイで連絡（準備中）</button>
              </div>
            </div>
          </aside>
        )}
      </div>

      <section className="panel queue" aria-labelledby="queueTitle">
        <div className="panel-head">
          <div>
            <strong id="queueTitle">要対応</strong>
            <span>
              {queue.length
                ? '対応期限の早い順。1件ずつ、判断とその根拠を並べています'
                : 'この画面で今日決めることはありません'}
            </span>
          </div>
          <span className="result-count" role="status" aria-live="polite">{queue.length}件</span>
        </div>
        {queue.length === 0 ? (
          <div className="queue-empty">
            <strong>期限のある対応はありません</strong>
            <span>上の全予約リストで、日をまたぐ検索と価格の証拠を確認できます。</span>
          </div>
        ) : (
          <div>
            {queue.map((r) => {
              const left = r.deadlineMinute! - boardNow
              return (
                <article className={`queue-card${r.kind === 'escalate' ? ' escalate' : ''}`} key={r.id}>
                  <div className="queue-when">
                    <span className={`pill wrap ${r.overdue ? 'alert' : 'warn'}`}>
                      {DEADLINE_WORD[r.kind]} {hhmm(r.deadlineMinute!)}まで
                    </span>
                    <span className={`queue-left${r.overdue ? ' over' : ''}`}>
                      {r.overdue ? `期限超過 ${spanText(left)}` : `あと${spanText(left)}`}
                    </span>
                    <span className="queue-ref">{r.no} / {r.dateLabel} {r.timeLabel}</span>
                  </div>
                  <div className="queue-body">
                    <strong>{DECISION[r.kind](r)}</strong>
                    <Evidence row={r} candidates={safeSlotsFor(props.slots, r.durationMinutes)} />
                  </div>
                  <div className="queue-act">
                    {/* 準備中 wears the outline button, never a washed-out
                        filled one — the same treatment 顧客 and 今日の運営 give
                        an unbuilt destination (one design system). */}
                    {r.kind === 'settle' ? (
                      <button className="btn" type="button" disabled title="売上・レジは準備中です">
                        精算へ（準備中）
                      </button>
                    ) : (
                      <button
                        className="btn primary"
                        type="button"
                        onClick={() => {
                          setSelected(r.id)
                          if (r.kind === 'accept') openAccept()
                          else if (r.kind === 'change') openChange()
                          else if (r.kind === 'escalate')
                            setToast(`この画面内のプロトタイプでは、予約 ${r.no}と影響範囲を判断できる担当者へ渡すところまでを示します`)
                        }}
                      >
                        {QUEUE_ACTION[r.kind]}
                      </button>
                    )}
                    {/* canon (:602-605) selects the booking AND sends focus to
                        its row — the queue's job is to hand you off to the
                        record, so the keyboard goes there too. */}
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        setSelected(r.id)
                        requestAnimationFrame(() => focusResult(listRef.current, countRef.current, r.id))
                      }}
                    >
                      予約の正本を見る
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* ── 受付ダイアログ (M-70–M-71) ─────────────────────────────────── */}
      <dialog ref={acceptRef} aria-labelledby="acceptTitle">
        <div className="dialog-head">
          <div>
            <h2 id="acceptTitle">受付リクエストを確定</h2>
            <p>空き、担当、設備、受付価格、通知を一度に確認します</p>
          </div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => acceptRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          {current && (
            <div className="dialog-facts">
              <div className="dialog-fact"><span>お客様・通知先</span><b>{current.customerName} / Reserve登録先</b></div>
              <div className="dialog-fact"><span>予約枠</span><b>{current.dateLabel} {current.timeLabel}</b></div>
              {/* Three segments, canon's own shape (:692) — WHO, what they are
                  qualified for, and on which bed. The middle one is read off
                  the roster's 資格 plane rather than written in. */}
              <div className="dialog-fact"><span>担当資格・設備</span><b>{current.staffName} / {current.qualificationText} / {current.resourceName}</b></div>
              <div className="dialog-fact"><span>受付価格</span><b>{current.priceLabel}</b></div>
              <div className="dialog-fact"><span>価格条件</span><b>{current.eligibility}</b></div>
              <div className="dialog-fact"><span>確定通知</span><b>Reserve通知 + SMS / 送信待ち</b></div>
              {current.shiftWarning && (
                <div className="dialog-fact warn"><span>勤務時間</span><b>{current.shiftWarning}</b></div>
              )}
            </div>
          )}
          <label className="confirm">
            <input type="checkbox" checked={acceptOk} onChange={(e) => setAcceptOk(e.target.checked)} />
            <span>予約枠・担当資格・ベッド・受付価格・通知先を確認しました</span>
          </label>
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" onClick={() => acceptRef.current?.close()}>戻る</button>
          <button className="btn primary" type="button" disabled={!acceptOk} onClick={() => current && run(acceptCommit(current, acceptOk, props.lensLabel, boardNow), acceptRef.current)}>
            証拠を残して受け付ける
          </button>
        </div>
      </dialog>

      {/* ── 変更ダイアログ (M-72–M-75) ─────────────────────────────────── */}
      <dialog ref={changeRef} aria-labelledby="changeTitle">
        <div className="dialog-head">
          <div>
            <h2 id="changeTitle">予約の日時・担当を変更</h2>
            <p>この画面内のプロトタイプで、元の予約を残した変更結果を確認します</p>
          </div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => changeRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          {current && (
            <div className="dialog-facts">
              <div className="dialog-fact"><span>お客様・正本</span><b>{current.customerName} / SYNQED</b></div>
              <div className="dialog-fact"><span>現在</span><b>{current.dateLabel} {current.timeLabel}</b></div>
              <div className="dialog-fact"><span>現在の担当・設備</span><b>{current.staffName} / {current.resourceName}</b></div>
              {/* M-75: the API shape itself makes this a guarantee — a booking's
                  agreed price has no update path at all. */}
              <div className="dialog-fact"><span>保持する受付価格</span><b>{current.priceLabel}</b></div>
              <div className="dialog-fact"><span>新担当の確認</span><b>選択枠ごとに資格・設備を確認済み</b></div>
              <div className="dialog-fact"><span>変更通知</span><b>電話確認 + SMS / この画面内の変更後に送る想定</b></div>
            </div>
          )}
          <label className="field">
            新しい空き枠
            <select value={changeSlot} onChange={(e) => setChangeSlot(e.target.value)} disabled={candidates.length === 0}>
              {candidates.length === 0 ? (
                <option value="">この予約を収められる空き枠はありません</option>
              ) : (
                candidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {current?.dateLabel} {hhmm(s.start)}–{hhmm(s.start + (current?.durationMinutes ?? 0))} / {s.staffName} + {s.resourceName}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="field">
            変更理由
            <select value={changeReason} onChange={(e) => setChangeReason(e.target.value)}>
              <option value="">選択してください</option>
              <option>お客様希望</option>
              <option>担当者の勤務変更</option>
              <option>設備停止</option>
            </select>
          </label>
          <label className="confirm">
            <input type="checkbox" checked={changeOk} onChange={(e) => setChangeOk(e.target.checked)} />
            <span>お客様、価格保持、担当資格、設備、通知先を確認しました</span>
          </label>
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" onClick={() => changeRef.current?.close()}>戻る</button>
          <button
            className="btn primary"
            type="button"
            disabled={!changeOk || !changeReason || !changeSlot}
            title={candidates.length === 0 ? HINT : undefined}
            onClick={() =>
              current &&
              run(
                changeCommit(current, candidates.find((s) => s.id === changeSlot), changeReason, changeOk, boardNow),
                changeRef.current,
              )
            }
          >
            画面内で変更を試す
          </button>
        </div>
      </dialog>

      {/* ── 記録ダイアログ (M-76–M-79) ─────────────────────────────────── */}
      <dialog ref={recordRef} aria-labelledby="recordTitle">
        <div className="dialog-head">
          <div>
            <h2 id="recordTitle">来店・キャンセルを記録</h2>
            <p>予約を消さず、判断元と次の仕事を履歴に残します</p>
          </div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => recordRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          {current && (
            <div className="dialog-facts">
              <div className="dialog-fact"><span>予約・お客様</span><b>{current.no} / {current.customerName}</b></div>
              <div className="dialog-fact"><span>予約枠</span><b>{current.dateLabel} {current.timeLabel}</b></div>
              <div className="dialog-fact"><span>受付価格</span><b>{current.priceLabel}</b></div>
              <div className="dialog-fact"><span>正本・受付元</span><b>{current.sourceGroup === 'external' ? '外部予約元' : `SYNQED / ${current.sourceLabel}`}</b></div>
            </div>
          )}
          <label className="field">
            結果
            <select value={recordType} onChange={(e) => setRecordType(e.target.value)}>
              <option value="">選択してください</option>
              <option value="arrived">来店済み・精算へ</option>
              <option value="cancelled">お客様キャンセル</option>
              <option value="no_show">無断キャンセル</option>
            </select>
          </label>
          <label className="field">
            確認元
            <select value={recordSource} onChange={(e) => setRecordSource(e.target.value)}>
              <option value="">選択してください</option>
              <option>電話で本人確認</option>
              <option>Reserve操作を同期</option>
              <option>SMS送信・返答なし</option>
              <option>店頭で確認</option>
            </select>
          </label>
          <label className="confirm">
            <input type="checkbox" checked={recordOk} onChange={(e) => setRecordOk(e.target.checked)} />
            <span>予約番号・お客様・受付価格・確認元・次の対応を確認しました</span>
          </label>
        </div>
        <div className="dialog-foot">
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

      <div className={`toast${toast ? ' show' : ''}`} role="status" aria-live="polite" aria-atomic="true">
        {toast}
      </div>
    </div>
  )
}

function href(props: ReservationsProps, segment: string): string {
  return `/${props.locale}/business/${segment}${props.storeParam ? `?store=${props.storeParam}` : ''}`
}

/** canon `focusResult` (:541): after a commit or a queue jump, focus lands on
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
    list?.querySelector<HTMLElement>('.booking-row') ??
    count
  target?.focus()
}

/** One list cell. The column set is user-controlled, so each cell names its
 *  column (`data-col`) rather than relying on its position — hiding 日時 must
 *  not hand 受付元's wrapping rules to whichever cell slid into slot 4. */
function Cell({ col, row }: { col: (typeof COLUMNS)[number]['k']; row: Decorated }) {
  if (col === 'when') {
    return (
      <span className="cell" data-col="when">
        <strong>{row.dateLabel}</strong>
        <span>{row.timeLabel}</span>
      </span>
    )
  }
  if (col === 'who') {
    return (
      <span className="cell" data-col="who">
        <strong>{row.customerName}</strong>
        <span>{row.menuName} / {row.no}</span>
      </span>
    )
  }
  if (col === 'staff') {
    return (
      <span className="cell" data-col="staff">
        <strong>{row.staffName}</strong>
        <span>{row.resourceName}</span>
      </span>
    )
  }
  if (col === 'source') {
    return (
      <span className="cell" data-col="source">
        <strong>{row.sourceLabel}</strong>
        <span>{row.priceLabel}</span>
        {row.storeLabel && <small className="w2-provenance">{row.storeLabel} / {row.no}</small>}
      </span>
    )
  }
  return (
    <span className="cell state-cell badge-col" data-col="state">
      <StateCell row={row} />
    </span>
  )
}

/** 状態列 = the lifecycle pill over its modifier flags. */
function StateCell({ row }: { row: Decorated }) {
  const { label, tone } = LIFECYCLE[row.lifecycle]
  return (
    <>
      <span className={`pill ${tone}`}>{label}</span>
      {row.allFlags.length > 0 && (
        <span className="state-flags">
          {row.allFlags.map((f) => (
            <span className={`flag${f === '期限超過' ? ' over' : ''}`} key={f}>{f}</span>
          ))}
        </span>
      )}
    </>
  )
}

/** The evidence under a queue card. Every line is read off the booking or off a
 *  fixture plane — no urgency is written here that the data does not carry. */
function Evidence({ row, candidates }: { row: Decorated; candidates: SlotOption[] }) {
  const money = (
    <Block rows={[['受付価格', `${row.priceLabel} を保持`, `現在の公開価格 ${row.currentPriceLabel}`]]} />
  )
  if (row.kind === 'accept') {
    return (
      <>
        {money}
        <Block rows={[['担当・設備', `${row.staffName} / ${row.resourceName}`, row.eligibility]]} />
        {row.shiftWarning && <Block risk rows={[['確認が必要', row.shiftWarning, null]]} />}
      </>
    )
  }
  if (row.kind === 'change') {
    const first = candidates[0]
    return (
      <>
        {money}
        <Block
          rows={[
            [
              '空き枠候補',
              first
                ? `${row.dateLabel} ${hhmm(first.start)}–${hhmm(first.start + row.durationMinutes)} / ${first.staffName} + ${first.resourceName}`
                : 'なし',
              null,
            ],
            ['希望の内容', row.proof, null],
          ]}
        />
      </>
    )
  }
  if (row.kind === 'escalate') {
    return (
      <>
        <Block
          rows={[[
            '現在の担当',
            `${row.staffName} / ${row.staffUnavailable ? '勤務不可' : '対応不可'}`,
            `${row.dateLabel} ${row.timeLabel} / ${row.menuName}`,
          ]]}
        />
        <Block risk rows={[['安全な候補', 'なし', row.proof]]} />
      </>
    )
  }
  if (row.kind === 'settle') {
    return (
      <>
        {money}
        <Block rows={[['レジ取引', row.txNote, row.txDetail]]} />
      </>
    )
  }
  return <Block rows={[['予約', `${row.dateLabel} ${row.timeLabel} / ${row.menuName}`, row.proof]]} />
}

function Block({ rows, risk }: { rows: Array<[string, string, string | null]>; risk?: boolean }) {
  return (
    <ul className={`evidence${risk ? ' risk' : ''}`}>
      {rows.map(([label, value, note]) => (
        <li key={label}>
          <span>{label}</span>
          <b>{value}{note && <i>{note}</i>}</b>
        </li>
      ))}
    </ul>
  )
}

/** The inspector's primary action, read from the lifecycle + flags — never from
 *  a booking number. A screen that is not built yet is greyed 準備中 rather than
 *  offered as a dead link (L-7). */
function Primary({
  row,
  props,
  onAccept,
  onChange,
  onRecord,
  onToast,
}: {
  row: Decorated
  props: ReservationsProps
  onAccept: () => void
  onChange: () => void
  onRecord: () => void
  onToast: (m: string) => void
}) {
  const cls = 'btn primary wide'
  // A destination that does not exist yet is greyed on the OUTLINE button, the
  // same as everywhere else in Business — a disabled filled button reads as a
  // broken commit rather than as "not built yet".
  const pending = 'btn wide'
  switch (primaryActionOf(row.lifecycle, row.allFlags, row.deadlineMinute)) {
    case 'escalate':
      return (
        <button
          className={cls}
          type="button"
          onClick={() => onToast(`この画面内のプロトタイプでは、予約 ${row.no}を判断できる担当者へ渡すところまでを示します`)}
        >
          判断できる担当者へ相談
        </button>
      )
    case 'change':
      return <button className={cls} type="button" onClick={onChange}>日時・担当変更を確認</button>
    case 'accept':
      return <button className={cls} type="button" onClick={onAccept}>受付リクエストを確認</button>
    case 'settle':
      return <button className={pending} type="button" disabled title="売上・レジは準備中です">売上・レジで精算（準備中）</button>
    case 'external':
      return (
        <button
          className={cls}
          type="button"
          onClick={() => onToast(`外部予約元 ${row.no}の参照先はこの探索では省略しています。SYNQEDから変更はしません`)}
        >
          予約元の記録を確認
        </button>
      )
    case 'record':
      return <button className={cls} type="button" onClick={onRecord}>来店・キャンセルを記録</button>
    case 'propose':
      return <button className={pending} type="button" disabled title="受信トレイは準備中です">受信トレイで提案（準備中）</button>
    case 'contact':
      return <button className={pending} type="button" disabled title="受信トレイは準備中です">お客様対応を確認（準備中）</button>
    default:
      return <Link className={cls} href={href(props, 'today')}>今日の運営で見る</Link>
  }
}

/** 本人関係, collapsed per ⚖ cut #7 — the same treatment the 顧客 screen carries,
 *  so a party that deviates reads the same way on both screens. */
function PartyBlock({ row, open, onToggle }: { row: Decorated; open: boolean; onToggle: () => void }) {
  return (
    <>
      <div className="section-title">本人関係</div>
      <div className="party-list">
        <button className="party-row" type="button" onClick={onToggle} aria-expanded={open}>
          <span>顧客</span>
          <b>{row.customerName}</b>
        </button>
        {row.party.map((p) => (
          <button className="party-row" type="button" key={p.role} onClick={onToggle} aria-expanded={open}>
            <span>{p.role}</span>
            <b>{p.name}</b>
            <span className="pill warn">別の方</span>
          </button>
        ))}
        {open && (
          <div className="party-note">
            {row.party.length === 0
              ? 'サービス対象・保護者・支払者はすべてご本人です。'
              : row.party.map((p) => `${p.role}: ${p.name} — ${p.note}`).join(' / ')}
          </div>
        )}
      </div>
    </>
  )
}
