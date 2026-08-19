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
  safeSlotsFor,
  spanText,
  type DecisionKind,
  type Lifecycle,
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
type SavedView = 'all' | 'attention' | 'reserve' | 'none'

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

const SAVED_VIEWS: Array<[SavedView, string]> = [
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

interface Decorated extends ReservationRow {
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
  const [savedView, setSavedView] = useState<SavedView | null>(null)
  const [openParty, setOpenParty] = useState(false)
  const [toast, setToast] = useState('')

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
    const t = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(t)
  }, [toast])

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
  }

  function stamp(row: Decorated, action: string, detail: string): Array<[string, string, string]> {
    return [[hhmm(boardNow), action, detail], ...row.history]
  }

  function clearFilters() {
    setSearch('')
    setDate('all')
    setStatus('all')
    setSource('all')
    setSavedView(null)
  }

  function applyView(view: SavedView) {
    setSavedView(view)
    setDate('all')
    setSource(view === 'reserve' ? 'reserve' : 'all')
    setStatus(view === 'attention' ? 'attention' : 'all')
    // 一致なし is canon's own empty-result view: a saved view that matches
    // nothing has to be visibly survivable, not a state the screen hides.
    setSearch(view === 'none' ? '__一致なし__' : '')
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

  function commitAccept() {
    if (!current || current.kind !== 'accept' || !acceptOk) return
    update(
      current.id,
      {
        lifecycle: 'confirmed',
        deadline: null,
        history: stamp(current, '受付リクエストを確定', `${props.lensLabel} / ${current.priceLabel}を保持 / Reserve通知 + SMS送信`),
      },
      'この画面内のプロトタイプで、空き・資格・設備・受付価格・通知先を確認した確定結果を表示しました',
    )
    acceptRef.current?.close()
  }

  function commitChange() {
    const slot = candidates.find((s) => s.id === changeSlot)
    if (!current || !slot || !changeReason || !changeOk) return
    const before = `${current.dateLabel} ${current.timeLabel} / ${current.staffName} / ${current.resourceName}`
    const timeLabel = `${hhmm(slot.start)}–${hhmm(slot.start + current.durationMinutes)}`
    const after = `${current.dateLabel} ${timeLabel} / ${slot.staffName} / ${slot.resourceName}`
    update(
      current.id,
      {
        // The day does not move: a 販売可能枠 is offered on the booking's own
        // date, so a change is a change of time, staff and bed.
        startMinute: slot.start,
        timeLabel,
        staffName: slot.staffName,
        resourceName: slot.resourceName,
        lifecycle: 'confirmed',
        deadline: null,
        flags: current.flags.filter((f) => f !== WANTS_CHANGE),
        reassigned: current.reassigned || slot.staffName !== current.staffName,
        proof: `${changeReason}。元の ${before} を履歴に保持し、受付価格 ${current.priceLabel} は変更していません。`,
        history: stamp(current, '予約を変更', `${before} → ${after} / ${changeReason} / SMS送信`),
      },
      'この画面内のプロトタイプで、新しい枠・担当資格・設備・価格保持・通知先を確認した変更結果を表示しました',
    )
    changeRef.current?.close()
  }

  function commitRecord() {
    if (!current || current.lifecycle !== 'confirmed' || !recordType || !recordSource || !recordOk) return
    const [lifecycle, label, message] =
      recordType === 'arrived'
        ? (['awaiting_settlement', '来店済み・精算待ち', 'この画面内のプロトタイプで来店結果を表示しました。受付価格は見本データのままです'] as const)
        : recordType === 'cancelled'
          ? (['cancelled', 'お客様キャンセル', 'この画面内のプロトタイプで、予約を消さずにキャンセルと確認元を表示しました'] as const)
          : // 無断キャンセル = no contact and no visit. The lifecycle is 来店なし
            // and the chasing that follows belongs to 受信トレイ.
            (['no_show', '無断キャンセル', 'この画面内のプロトタイプで、予約を消さずに無断キャンセルと連絡証拠を表示しました'] as const)
    update(
      current.id,
      {
        lifecycle,
        deadline: null,
        proof: `${label}。確認元: ${recordSource}。受付価格 ${current.priceLabel} と元の予約枠を履歴に保持。`,
        history: stamp(current, label, `${recordSource} / ${props.lensLabel}`),
      },
      message,
    )
    recordRef.current?.close()
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
        {SAVED_VIEWS.map(([k, label]) => (
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
      <p className="saved-view-note">
        保存した表示は絞り込みの条件だけを持ちます。結果は毎回この一覧から作り直すため、古い件数が残ることはありません。
      </p>

      <form className="filters" aria-label="予約を絞り込む" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSavedView(null) }}
          placeholder="お客様名・予約番号・メニュー・担当"
          aria-label="予約を検索"
        />
        <select value={date} onChange={(e) => { setDate(e.target.value as DateFilter); setSavedView(null) }} aria-label="日付">
          <option value="all">{props.spanLabel}</option>
          <option value="today">本日</option>
          <option value="future">明日以降</option>
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value as StatusFilter); setSavedView(null) }} aria-label="状態">
          {STATUS_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={source} onChange={(e) => { setSource(e.target.value as SourceFilter); setSavedView(null) }} aria-label="受付元">
          {SOURCE_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button className="btn" type="button" onClick={clearFilters}>クリア</button>
      </form>

      <div className="workspace">
        <section className="panel" id="bookingPanel" aria-labelledby="listTitle">
          <div className="panel-head">
            <div>
              <strong id="listTitle">全予約リスト</strong>
              <span>{props.spanLabel}の全件。検索と絞り込みはこの一覧に効きます</span>
            </div>
            <span className="result-count" role="status" aria-live="polite">{visible.length}件</span>
          </div>
          <div className="fx-scroll">
            <div className="list-head" aria-hidden="true">
              <span>日時</span>
              <span>お客様・メニュー</span>
              <span>担当・設備</span>
              <span>受付元・価格</span>
              <span className="badge-col">状態</span>
            </div>
            {visible.length > 0 && (
              <div className="booking-list">
                {visible.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`booking-row${r.id === current?.id ? ' selected' : ''}`}
                    aria-pressed={r.id === current?.id}
                    onClick={() => setSelected(r.id)}
                  >
                    <span className="cell">
                      <strong>{r.dateLabel}</strong>
                      <span>{r.timeLabel}</span>
                    </span>
                    <span className="cell">
                      <strong>{r.customerName}</strong>
                      <span>{r.menuName} / {r.no}</span>
                    </span>
                    <span className="cell">
                      <strong>{r.staffName}</strong>
                      <span>{r.resourceName}</span>
                    </span>
                    <span className="cell">
                      <strong>{r.sourceLabel}</strong>
                      <span>{r.priceLabel}</span>
                      {r.storeLabel && <small className="w2-provenance">{r.storeLabel} / {r.no}</small>}
                    </span>
                    <span className="cell state-cell badge-col"><StateCell row={r} /></span>
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
                            setToast(`この画面内のプロトタイプでは、予約 ${r.no} と影響範囲を判断できる担当者へ渡すところまでを示します`)
                        }}
                      >
                        {QUEUE_ACTION[r.kind]}
                      </button>
                    )}
                    <button className="btn" type="button" onClick={() => setSelected(r.id)}>予約の正本を見る</button>
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
              <div className="dialog-fact"><span>担当資格・設備</span><b>{current.staffName} / {current.resourceName}</b></div>
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
          <button className="btn primary" type="button" disabled={!acceptOk} onClick={commitAccept}>
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
            onClick={commitChange}
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
            onClick={commitRecord}
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
  if (row.kind === 'escalate') {
    return (
      <button
        className={cls}
        type="button"
        onClick={() => onToast(`この画面内のプロトタイプでは、予約 ${row.no} を判断できる担当者へ渡すところまでを示します`)}
      >
        判断できる担当者へ相談
      </button>
    )
  }
  if (row.kind === 'change') {
    return <button className={cls} type="button" onClick={onChange}>日時・担当変更を確認</button>
  }
  if (row.kind === 'accept') {
    return <button className={cls} type="button" onClick={onAccept}>受付リクエストを確認</button>
  }
  if (row.lifecycle === 'awaiting_settlement') {
    return <button className={pending} type="button" disabled title="売上・レジは準備中です">売上・レジで精算（準備中）</button>
  }
  if (row.lifecycle === 'external') {
    return (
      <button
        className={cls}
        type="button"
        onClick={() => onToast(`外部予約元 ${row.no} の参照先はこの探索では省略しています。SYNQEDから変更はしません`)}
      >
        予約元の記録を確認
      </button>
    )
  }
  if (row.lifecycle === 'confirmed') {
    return <button className={cls} type="button" onClick={onRecord}>来店・キャンセルを記録</button>
  }
  if (row.lifecycle === 'pending_accept') {
    return <button className={pending} type="button" disabled title="受信トレイは準備中です">受信トレイで提案（準備中）</button>
  }
  if (row.lifecycle === 'cancelled' || row.lifecycle === 'no_show') {
    return <button className={pending} type="button" disabled title="受信トレイは準備中です">お客様対応を確認（準備中）</button>
  }
  return <Link className={cls} href={href(props, 'today')}>今日の運営で見る</Link>
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
