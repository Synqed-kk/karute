'use client'

// スタッフ・シフト — canon's markup (fable-store-team-shifts.html), rendered
// from a plane the server already resolved and joined. Class names, wording and
// structure are canon's.
//
// WHAT THIS COMPONENT COMPUTES, and why it is not the arithmetic ban being
// broken: the session's staged shifts change a cell, its column total and the
// 人件費 estimate together, so those three cannot arrive as finished strings
// without going stale the moment anything is staged. Every one of them is
// derived by calling the SAME pure functions in @/business/lib/shifts that the
// server called and the suite pins — `cellFor` decides a cell, `laborCost`
// prices a month. There is no second implementation here to disagree with the
// first, and there is no clock, no data access and no role name.
//
// WHAT IS CLIENT STATE HERE: which impacted booking is selected, which dialog
// is open, and the cell dialog's two time inputs. The STAGED EDITS are not —
// they live in ShiftsSessionEdits above the screen, because `?view=`, `?week=`
// and `?ym=` are real Links and this component remounts on every one of them.
//
// REFUSALS CHANGE NOTHING AND STAY READABLE (the lane invariant): a shift edit
// that would strand a booking, and a 希望休 whose approval would leave a day
// short of its 担当, both answer inside the surface that asked — a line that
// stays on screen until the operator closes it, never a toast that flashes.
//
// A CONFIRM SURFACE EXISTS ONLY WHILE ITS DECISION IS OPEN (⚖ 41): answering
// the last pending 希望休 dismisses the dialog; answering one of several leaves
// the answered row stating its outcome with no buttons left to press.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShiftEdits } from '../../ShiftsSessionEdits'
import { useTopbarAction } from '../../BusinessTopbar'
import type { FixtureAbsence, FixtureShift } from '@/business/lib/fixtures-today'
import {
  bookedKeysOf,
  cellFor,
  editKey,
  hours,
  laborCost,
  type Cell,
  type DayContext,
  type RosterMember,
} from '@/business/lib/shifts'
import { hhmm, yen } from '@/business/lib/today-board'

/** THE ROUTE WRAPPER. App Router keeps a segment's stylesheet in the document
 *  after a client-side navigation, so a route sheet that states a bare
 *  family-shared selector (`.panel`, `.page`, `dialog`) keeps restyling the room
 *  the reader walked into next — room 1's D-C, measured. Every rule in
 *  shifts.css is scoped under this class from day one, and this is the only
 *  node that carries it. */
const ROOT = 'page pg-shifts'

export interface NavStep {
  href: string | null
  title: string
}

export interface PickerModel {
  kind: 'date' | 'month'
  param: string
  value: string
  min: string
  max: string
  label: string
  base: string
}

export interface DayModel {
  dayKey: number
  long: string
  short: string
  head: string
  monthCell: string
  wd: number
  closed: boolean
  closedLabel: string | null
  isToday: boolean
  bookings: number
  conflicts: Array<{ label: string; reason: string }>
  bookedBy: Record<string, Array<{ label: string; startMinute: number; endMinute: number }>>
}

export interface RosterModel {
  id: string
  name: string
  shift: FixtureShift | null
  restWd: number | null
  wage: number | null
  qualifications: string[]
  patternLabel: string
}

export interface LeaveModel {
  staffId: string
  staffName: string
  dayKey: number
  dayLabel: string
  reason: string
  refusal: string | null
}

export interface ImpactRow {
  id: string
  time: string
  customer: string
  menu: string
  price: string
  owner: string
  qualification: string
  status: string
  statusTone: string
  kicker: string
  title: string
  meta: string
  proofs: string[]
  deadline: string
  warning: string | null
  action: string
}

/** The day's 勤務不可, stated once. Both boards read this object — the week's
 *  incident panel, the month's exception banner and the 欠勤内容 dialog — so
 *  the three cannot describe the same absence differently. Null when there is
 *  no absence, or when the period being viewed does not hold the day it
 *  happened on (canon shows it only on the week the absence is in). */
export interface IncidentModel {
  headline: string
  detail: string
  source: string
  banner: string
  steps: string[]
  stats: Array<{ label: string; value: string; warn: boolean }>
}

export interface ShiftsProps {
  view: 'week' | 'month'
  store: string | null
  storeLabel: string
  incident: IncidentModel | null
  toggle: { weekHref: string; monthHref: string }
  head: {
    dateline: string
    subtitle: string
    impactChip: string
    impactWarn: boolean
    rosterChip: string
  }
  period: {
    label: string
    prev: NavStep
    today: NavStep
    next: NavStep
    picker: PickerModel
  }
  refusedActions: Array<{ label: string; title: string }>
  plane: {
    todayKey: number
    closedWd: number
    absence: FixtureAbsence | null
    roster: RosterModel[]
    leaves: LeaveModel[]
    days: DayModel[]
  }
  week: {
    summaryTitle: string
    summaryNote: string
    openIssueLabel: string
    openIssueWarn: boolean
    boardNote: string
    rows: ImpactRow[]
    emptyRecovery: { title: string; body: string }
    safeNote: string
    reservationsHref: string
  } | null
  month: {
    laborCost: { note: string; paceNote: string } | null
    leaveStripNote: string | null
    mayApproveLeave: boolean
    legend: Array<{ key: string; label: string }>
  } | null
}

const toMinutes = (hhmmText: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmmText)
  if (!m) return null
  const value = Number(m[1]) * 60 + Number(m[2])
  return value >= 0 && value <= 24 * 60 ? value : null
}

export function ShiftsScreen(props: ShiftsProps) {
  const { plane, period, head } = props
  const { shiftEdits, setShiftEdits, leaveAnswers, setLeaveAnswers } = useShiftEdits()
  const router = useRouter()

  const [selected, setSelected] = useState<string | null>(props.week?.rows[0]?.id ?? null)
  const [editing, setEditing] = useState<{ staffId: string; dayKey: number } | null>(null)
  const [startText, setStartText] = useState('10:00')
  const [endText, setEndText] = useState('19:00')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [toast, setToast] = useState('')
  const cellRef = useRef<HTMLDialogElement>(null)
  const leaveRef = useRef<HTMLDialogElement>(null)
  const absenceRef = useRef<HTMLDialogElement>(null)

  // ⚖ 46 — the session's edits survive a store switch, and the ROSTER CLAMP is
  // what decides where they can land: a person this lens cannot see has no cell
  // for an edit to appear in, and a person both stores share must show the SAME
  // staged shift on both, because she has one shift on that day. See StagedShift.

  const ctx: DayContext = useMemo(
    () => ({
      closedWd: plane.closedWd,
      todayKey: plane.todayKey,
      absence: plane.absence,
      leaveKeys: new Set(plane.leaves.map((l) => editKey(l.staffId, l.dayKey))),
      bookedKeys: bookedKeysOf(plane.days),
      // Last write wins per (staff, day) — a Map built in order does that for
      // free, so nothing has to prune the list as it grows.
      shiftEdits: new Map(shiftEdits.map((e) => [editKey(e.staffId, e.dayKey), e])),
      leaveAnswers: new Map(leaveAnswers.map((a) => [editKey(a.staffId, a.dayKey), a])),
    }),
    [plane, shiftEdits, leaveAnswers],
  )

  // Every cell of the shown period, composed ONCE and read by the grid, the
  // column totals, the week summary and the 人件費 card — so no two of them can
  // be looking at different shifts, and a staged edit moves all four together.
  const { grid, totals, cost } = useMemo(() => {
    const roster: RosterMember[] = plane.roster
    const cells = new Map<string, Cell>()
    const worked = new Map<string, number>()
    let span = 0
    let breaks = 0
    let leaveDays = 0
    const priced: Array<{ staffId: string; workedMinutes: number }> = []
    for (const day of plane.days) {
      for (const m of roster) {
        const cell = cellFor(m, day.dayKey, ctx)
        cells.set(editKey(m.id, day.dayKey), cell)
        worked.set(m.id, (worked.get(m.id) ?? 0) + cell.workedMinutes)
        span += cell.spanMinutes
        breaks += cell.spanMinutes - cell.workedMinutes
        if (cell.answered === 'approved') leaveDays += 1
        priced.push({ staffId: m.id, workedMinutes: cell.workedMinutes })
      }
    }
    return { grid: cells, totals: { worked, span, breaks, leaveDays }, cost: laborCost(priced, roster) }
  }, [plane, ctx])

  const at = useCallback(
    (staffId: string, dayKey: number) => grid.get(editKey(staffId, dayKey))!,
    [grid],
  )

  const pendingLeaves = plane.leaves.filter((l) => !ctx.leaveAnswers.has(editKey(l.staffId, l.dayKey)))

  // The topbar's primary action is canon's 欠勤を記録. Recording one is a WRITE,
  // which the fence forbids, and this world already holds the day's 勤務不可 —
  // so the button is what canon itself becomes once an absence exists: a way to
  // read what was recorded. With no absence on the board there is nothing to
  // open, and the slot stays empty rather than offering a button that refuses.
  const openAbsence = useCallback(() => absenceRef.current?.showModal(), [])
  useTopbarAction(props.incident ? '欠勤内容を確認' : '', openAbsence)

  // A gesture ENDING tears its own surface down: closing the cell dialog by any
  // route (Escape, ×, backdrop, キャンセル) clears the refusal it was showing,
  // so a reopened dialog never wears the last cell's answer.
  useEffect(() => {
    const node = cellRef.current
    if (!node) return
    const onClose = () => {
      setEditing(null)
      setRefusal(null)
      setInvalid(false)
    }
    node.addEventListener('close', onClose)
    return () => node.removeEventListener('close', onClose)
  }, [])

  function openCell(m: RosterModel, day: DayModel) {
    const cell = at(m.id, day.dayKey)
    setEditing({ staffId: m.id, dayKey: day.dayKey })
    setStartText(hhmm(cell.start ?? m.shift?.start ?? 600))
    setEndText(hhmm(cell.end ?? m.shift?.end ?? 1140))
    setRefusal(null)
    setInvalid(false)
    cellRef.current?.showModal()
  }

  /** The one refusal a shift edit can earn: a booking this person is already
   *  the 担当 for that no longer fits inside the hours being staged. It changes
   *  NOTHING — the dialog stays open on the values that were typed, and the
   *  reason stays on screen until it is read. */
  function bookingRefusal(staffId: string, day: DayModel, start: number, end: number): string | null {
    const clash = (day.bookedBy[staffId] ?? []).filter((b) => b.startMinute < start || b.endMinute > end)
    if (clash.length === 0) return null
    return `${day.short}は${clash.map((b) => b.label).join('・')}を担当しています。この時間ではその予約が勤務時間の外に出ます。先に予約一覧で担当か時間を変更してください。`
  }

  function saveCell() {
    if (!editing) return
    const day = plane.days.find((d) => d.dayKey === editing.dayKey)!
    const start = toMinutes(startText)
    const end = toMinutes(endText)
    if (start === null || end === null || start >= end) {
      setInvalid(true)
      setRefusal('開始より後の終了時刻を入力してください。')
      return
    }
    const clash = bookingRefusal(editing.staffId, day, start, end)
    if (clash) {
      setInvalid(false)
      setRefusal(clash)
      return
    }
    setShiftEdits((was) => [
      ...was,
      { staffId: editing.staffId, dayKey: editing.dayKey, kind: 'work', start, end },
    ])
    cellRef.current?.close()
    setToast('この画面の中だけシフトを変更しました。実際の勤務予定と予約は変わりません。')
  }

  function offCell() {
    if (!editing) return
    const day = plane.days.find((d) => d.dayKey === editing.dayKey)!
    if ((day.bookedBy[editing.staffId] ?? []).length > 0) {
      setInvalid(false)
      setRefusal(
        `${day.short}は${(day.bookedBy[editing.staffId] ?? [])
          .map((b) => b.label)
          .join('・')}を担当しています。休みにする前に、予約一覧で担当を変更してください。`,
      )
      return
    }
    setShiftEdits((was) => [
      ...was,
      { staffId: editing.staffId, dayKey: editing.dayKey, kind: 'off', start: 0, end: 0 },
    ])
    cellRef.current?.close()
    setToast('この画面の中だけ休みにしました。実際の勤務予定と予約は変わりません。')
  }

  function answerLeave(leave: LeaveModel, answer: 'approved' | 'rejected') {
    setLeaveAnswers((was) => [
      ...was,
      { staffId: leave.staffId, dayKey: leave.dayKey, answer },
    ])
    // ⚖ 41 — the surface exists only while its decision is open. This was the
    // last one, so it goes.
    if (pendingLeaves.length <= 1) leaveRef.current?.close()
    setToast(
      answer === 'approved'
        ? `${leave.staffName}さんの希望休をこの画面の中だけ承認しました。実際の勤務予定は変わりません。`
        : `${leave.staffName}さんの希望休をこの画面の中だけ却下しました。元の勤務予定のままです。`,
    )
  }

  const worstConflictDay = plane.days
    .filter((d) => d.conflicts.length > 0)
    .sort((a, b) => b.conflicts.length - a.conflicts.length || a.dayKey - b.dayKey)[0]

  const selectedRow = props.week?.rows.find((r) => r.id === selected) ?? props.week?.rows[0] ?? null

  return (
    <div className={ROOT}>
      <header className="page-head">
        <div>
          <div className="date-line">{head.dateline}</div>
          <h1>スタッフ・シフト</h1>
          <p className="subtitle">{head.subtitle}</p>
        </div>
        <div className="health" aria-label={props.view === 'week' ? '今週の状態' : '今月の状態'}>
          <span className="chip context">{props.storeLabel}</span>
          <span className="chip">{head.rosterChip}</span>
          <span className={head.impactWarn ? 'chip warn' : 'chip'}>{head.impactChip}</span>
        </div>
      </header>

      {/* 週/月 — canon's R-A in-page switch. Here each segment is a Link to the
          same route with `?view=`, so the two boards cannot hold different
          ideas of which period is showing and the back button is honest. The
          shell, the topbar and this header row are all above the swap and never
          move, which is what R-A was protecting. */}
      <div className="view-row">
        <div className="toggle-group" role="group" aria-label="表示切替">
          <Link
            className={props.view === 'week' ? 'toggle-seg active' : 'toggle-seg'}
            href={props.toggle.weekHref}
            aria-current={props.view === 'week' ? 'true' : undefined}
            scroll={false}
          >
            週
          </Link>
          <Link
            className={props.view === 'month' ? 'toggle-seg active' : 'toggle-seg'}
            href={props.toggle.monthHref}
            aria-current={props.view === 'month' ? 'true' : undefined}
            scroll={false}
          >
            月
          </Link>
        </div>
        <div className="period-nav" aria-label={props.view === 'week' ? '週の切替' : '月の切替'}>
          <Step step={period.prev} label="◀" aria={props.view === 'week' ? '前の週' : '前の月'} />
          <Step
            step={period.today}
            label={props.view === 'week' ? '今週' : '今月'}
            aria={props.view === 'week' ? '今週' : '今月'}
          />
          <Step step={period.next} label="▶" aria={props.view === 'week' ? '次の週' : '次の月'} />
          <strong className={props.view === 'week' ? 'range' : undefined}>{period.label}</strong>
          {/* A soft navigation, never a reload: `router.push` keeps the layout
              mounted, so the session's staged shifts survive a period change
              exactly as they survive the arrows. */}
          <PeriodPicker picker={period.picker} go={(href) => router.push(href, { scroll: false })} />
          {props.view === 'month' &&
            props.refusedActions.map((a) => (
              <button key={a.label} className="btn" type="button" aria-disabled="true" title={a.title}>
                {a.label}
              </button>
            ))}
        </div>
      </div>

      {props.view === 'week' && props.week && (
        <>
          {props.incident && (
            <section className="incident" aria-label="欠勤による予約影響">
              <div className="incident-main">
                <span className="incident-icon" aria-hidden="true">!</span>
                <span>
                  <strong>{props.incident.headline}</strong>
                  <span>{props.incident.detail}</span>
                  <span>{props.incident.source}</span>
                </span>
              </div>
              {props.incident.stats.map((s) => (
                <div className="incident-stat" key={s.label}>
                  <span>{s.label}</span>
                  <b className={s.warn ? 'warn' : undefined}>{s.value}</b>
                </div>
              ))}
              <div className="incident-action">
                <button className="btn" type="button" onClick={openAbsence}>
                  記録を確認
                </button>
              </div>
            </section>
          )}

          <section className="summary" aria-label="この週のシフト概要">
            <div className="summary-main">
              <strong>{props.week.summaryTitle}</strong>
              <span>{props.week.summaryNote}</span>
            </div>
            <div className="summary-cell">
              <span>勤務予定</span>
              <b>{hours(totals.span)}</b>
            </div>
            <div className="summary-cell">
              <span>休憩</span>
              <b>{totals.breaks > 0 ? hours(totals.breaks) : '—'}</b>
            </div>
            <div className="summary-cell">
              <span>承認済みの休暇</span>
              <b>{totals.leaveDays}日</b>
            </div>
            <div className="summary-cell">
              <span>未確定予約</span>
              <b className={props.week.openIssueWarn ? 'warn' : undefined}>{props.week.openIssueLabel}</b>
            </div>
          </section>

          <section className="panel" aria-labelledby="weekTitle">
            <div className="panel-head">
              <div>
                <strong id="weekTitle">週のシフトと資格</strong>
                <span>{props.week.boardNote}</span>
              </div>
              <div className="legend week" aria-label="表示記号">
                <span><i /> 勤務</span>
                <span className="break"><i /> 休憩</span>
                <span className="rest"><i /> 休み</span>
                <span className="off"><i /> 欠勤・休暇</span>
              </div>
            </div>
            <div className="week-wrap">
              <table className="week-table">
                <thead>
                  <tr>
                    <th>スタッフ / 資格</th>
                    {plane.days.map((d) => (
                      <th key={d.dayKey} className={d.isToday ? 'today-head' : undefined}>
                        {d.head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plane.roster.map((m) => (
                    <tr key={m.id}>
                      <td className="staff-cell">
                        <strong>{m.name}</strong>
                        <span>{m.patternLabel}</span>
                        <span className="qualification-row">
                          {m.qualifications.map((q) => (
                            <span className="qualification" key={q}>{q}</span>
                          ))}
                        </span>
                      </td>
                      {plane.days.map((d) => (
                        <td key={d.dayKey}>{weekCell(at(m.id, d.dayKey), d, m)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {props.week.rows.length > 0 ? (
            <div className="recovery">
              <section className="panel" aria-labelledby="impactTitle">
                <div className="panel-head">
                  <div>
                    <strong id="impactTitle">欠勤で影響する予約</strong>
                    <span>予約時の担当・価格・時間は、個別に確定するまで変更しません</span>
                  </div>
                  <span className="status danger">{props.week.openIssueLabel} 未確定</span>
                </div>
                <table className="booking-table" aria-label="影響する予約">
                  <thead>
                    <tr>
                      <th>予約</th>
                      <th>現在の担当</th>
                      <th>資格</th>
                      <th>状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.week.rows.map((r) => (
                      <tr
                        key={r.id}
                        className={selectedRow?.id === r.id ? 'selected' : undefined}
                        tabIndex={0}
                        aria-selected={selectedRow?.id === r.id}
                        onClick={() => setSelected(r.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            setSelected(r.id)
                          }
                        }}
                      >
                        <td>
                          <span className="booking-main">
                            <strong>{r.time} {r.customer}</strong>
                            <span>{r.menu} / {r.price}</span>
                          </span>
                        </td>
                        <td>{r.owner}</td>
                        <td>{r.qualification}</td>
                        <td><span className={`status ${r.statusTone}`}>{r.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="panel-foot">
                  候補の確認は担当変更ではありません。予約一覧でお客様への連絡と新しい担当を個別に確定した時だけ、予約が更新されます。
                </div>
              </section>

              {selectedRow && (
                <aside className="panel inspector" aria-labelledby="coverTitle">
                  <div className="inspector-head">
                    <div className="inspector-kicker">{selectedRow.kicker}</div>
                    <h2 id="coverTitle">{selectedRow.title}</h2>
                    <p>{selectedRow.meta}</p>
                  </div>
                  <div className="inspector-body">
                    <div className="proof-grid">
                      {selectedRow.proofs.map((p) => (
                        <div className="proof-row" key={p}><span>確認</span><b>{p}</b></div>
                      ))}
                      <div className="proof-row"><span>期限</span><b>{selectedRow.deadline}</b></div>
                    </div>
                    {selectedRow.warning && <div className="warning">{selectedRow.warning}</div>}
                    <div className="safe-note">{props.week.safeNote}</div>
                    <div className="inspector-actions">
                      {/* Canon's 仮案を作成 is disabled in canon too — both of its
                          rows ship `enabled: false`, each carrying its own state
                          as the label. Here the state is the board's: one booking
                          already holds a candidate, the other has none to offer. */}
                      <button className="btn" type="button" disabled title="担当の確定は予約一覧で行います">
                        {selectedRow.action}
                      </button>
                      <Link className="btn text" href={props.week.reservationsHref}>
                        予約一覧で個別確定
                      </Link>
                    </div>
                  </div>
                </aside>
              )}
            </div>
          ) : (
            <section className="panel">
              <div className="empty-recovery">
                <strong>{props.week.emptyRecovery.title}</strong>
                <br />
                {props.week.emptyRecovery.body}
              </div>
            </section>
          )}
        </>
      )}

      {props.view === 'month' && props.month && (
        <>
          {props.incident && (
            <section className="exception">
              <span className="exception-icon" aria-hidden="true">!</span>
              <span className="exception-body">
                <strong>{props.incident.banner}</strong>
                <span>週表示に、影響する予約と安全な候補の一覧があります。</span>
              </span>
            </section>
          )}

          {worstConflictDay && (
            <section className="exception">
              <span className="exception-icon" aria-hidden="true">!</span>
              <span className="exception-body">
                <strong>
                  {worstConflictDay.short}: 予約{worstConflictDay.conflicts.length}件が勤務予定と合いません — シフトの確認が必要
                </strong>
                <span>{worstConflictDay.conflicts.map((c) => c.label).join(' / ')}</span>
              </span>
            </section>
          )}

          {props.month.laborCost && (
            <div className="info-card">
              <span aria-hidden="true">🔒</span>
              <span>
                人件費 概算 <b>{yen(cost.yen)}</b> — {props.month.laborCost.note}
                {cost.missingRate.length > 0 && `（${cost.missingRate.join('・')}は時給が未登録のため含みません）`}
                <span className="info-sub">{props.month.laborCost.paceNote}</span>
              </span>
            </div>
          )}

          {plane.leaves.length > 0 && (
            <section className="approval-strip">
              <div>
                <strong>承認待ちの希望休 {pendingLeaves.length}件</strong>
                {props.month.leaveStripNote && <span className="strip-note">{props.month.leaveStripNote}</span>}
              </div>
              {props.month.mayApproveLeave && (
                <button
                  className="btn"
                  type="button"
                  aria-disabled={pendingLeaves.length === 0 || undefined}
                  title={pendingLeaves.length === 0 ? 'この画面で答えた希望休はすべて記録済みです' : '希望休を確認'}
                  onClick={() => {
                    if (pendingLeaves.length === 0) return
                    leaveRef.current?.showModal()
                  }}
                >
                  確認する
                </button>
              )}
            </section>
          )}

          <section className="panel" aria-labelledby="monthTitle">
            <div className="panel-head">
              <div>
                <strong id="monthTitle">月間シフト</strong>
                <span>クリックしたセルは、この画面の中だけ変更できます</span>
              </div>
              <div className="legend month" aria-label="表示記号">
                {props.month.legend.map((l) => (
                  <span className={l.key === 'work' ? undefined : l.key} key={l.key}>
                    <i /> {l.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="month-wrap">
              <table className="month-table">
                <colgroup>
                  <col className="date-col" />
                  <col className="booking-col" />
                  {plane.roster.map((m) => <col key={m.id} />)}
                </colgroup>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>予約</th>
                    {plane.roster.map((m) => (
                      <th key={m.id}>
                        <span className="col-name">{m.name}</span>
                        <span className="col-total">実働 {hours(totals.worked.get(m.id) ?? 0)}</span>
                        <span className="col-pattern">{m.patternLabel}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plane.days.map((d) => (
                    <tr
                      key={d.dayKey}
                      className={
                        d.closed ? 'row-closed' : d.isToday ? 'row-today' : d.wd === 6 ? 'row-sat' : d.wd === 0 ? 'row-sun' : undefined
                      }
                    >
                      <td className="day-label">{d.monthCell}{d.isToday && <span className="today-tag">本日</span>}</td>
                      <td className="booking-cell">
                        {d.closed ? (
                          <span className="chip-shift quiet">{d.closedLabel}</span>
                        ) : d.conflicts.length > 0 ? (
                          <span className="chip-shift warn" title={d.conflicts.map((c) => c.label).join(' / ')}>
                            ⚠ 予約{d.bookings}件・要確認
                          </span>
                        ) : (
                          <span className="booking-plain">{d.bookings}件</span>
                        )}
                      </td>
                      {plane.roster.map((m) =>
                        d.closed ? (
                          // 定休日 has no shift to edit. Canon renders a button
                          // here and its dialog will happily set hours on a day
                          // the store is shut; a control that can only produce a
                          // wrong answer should not be a control at all.
                          <td key={m.id}>
                            <span className="cell-quiet" aria-label={cellLabel(m, d, at(m.id, d.dayKey))} />
                          </td>
                        ) : (
                          <td key={m.id}>
                            <button
                              className="cell-btn"
                              type="button"
                              aria-label={cellLabel(m, d, at(m.id, d.dayKey))}
                              onClick={() => openCell(m, d)}
                            >
                              {monthCell(at(m.id, d.dayKey), d, m)}
                            </button>
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel-foot">
              勤務時間と休憩は店舗の標準シフトです。セルを押すと、この画面の中だけ時間を変えたり休みにしたりできます（実際の勤務予定と予約は変わりません）。
            </div>
          </section>
        </>
      )}

      {/* ── dialogs ─────────────────────────────────────────────────────── */}

      <dialog ref={cellRef} className="small" aria-labelledby="cellTitle" onClick={(e) => { if (e.target === cellRef.current) cellRef.current?.close() }}>
        <div className="dialog-head">
          <div>
            <h2 id="cellTitle">
              {editing
                ? `${plane.days.find((d) => d.dayKey === editing.dayKey)?.monthCell ?? ''} ・ ${
                    plane.roster.find((m) => m.id === editing.staffId)?.name ?? ''
                  }`
                : 'シフトを編集'}
            </h2>
            <p>時間を変更するか、休みにします</p>
          </div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => cellRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          <div className="form-grid">
            <label>
              開始
              <input
                type="time"
                name="shiftStart"
                value={startText}
                aria-invalid={invalid || undefined}
                onChange={(e) => { setStartText(e.target.value); setInvalid(false) }}
              />
            </label>
            <label>
              終了
              <input
                type="time"
                name="shiftEnd"
                value={endText}
                aria-invalid={invalid || undefined}
                onChange={(e) => { setEndText(e.target.value); setInvalid(false) }}
              />
            </label>
          </div>
          <div className="dialog-note">
            保存すると、このセルの表示と月の合計時間だけが変わります。見本データのため、実際の勤務予定・予約・記録には反映しません。
          </div>
          {/* THE REFUSAL. It changes nothing and it stays on screen: the dialog
              keeps the values that were typed, and the reason is readable until
              the operator closes it. */}
          {refusal && <div className="dialog-block" role="alert">{refusal}</div>}
        </div>
        <div className="dialog-foot">
          <button className="btn" type="button" onClick={offCell}>休みにする</button>
          <div className="foot-right">
            <button className="btn" type="button" onClick={() => cellRef.current?.close()}>キャンセル</button>
            <button className="btn primary" type="button" onClick={saveCell}>保存</button>
          </div>
        </div>
      </dialog>

      <dialog ref={leaveRef} aria-labelledby="leaveTitle" onClick={(e) => { if (e.target === leaveRef.current) leaveRef.current?.close() }}>
        <div className="dialog-head">
          <div>
            <h2 id="leaveTitle">希望休の確認</h2>
            <p>承認すると休みに、却下すると元の勤務に戻します</p>
          </div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => leaveRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          {plane.leaves.map((l) => {
            const answer = ctx.leaveAnswers.get(editKey(l.staffId, l.dayKey))?.answer ?? null
            return (
              <div className="leave-row" key={`${l.staffId}-${l.dayKey}`}>
                <div>
                  <strong>{l.staffName}</strong>
                  <span>
                    {l.dayLabel} ・ {l.reason} ・{' '}
                    {answer === 'approved'
                      ? '承認済み（この画面の中だけ休みに変更）'
                      : answer === 'rejected'
                        ? '却下済み（元の勤務のまま）'
                        : '承認待ち'}
                  </span>
                  {answer === null && l.refusal && <span className="leave-refusal">{l.refusal}</span>}
                </div>
                {answer === null && (
                  <div className="leave-actions">
                    <button className="btn" type="button" onClick={() => answerLeave(l, 'rejected')}>却下</button>
                    {l.refusal ? (
                      <button className="btn" type="button" aria-disabled="true" title={l.refusal}>承認</button>
                    ) : (
                      <button className="btn primary" type="button" onClick={() => answerLeave(l, 'approved')}>承認</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </dialog>

      <dialog ref={absenceRef} aria-labelledby="absenceTitle" onClick={(e) => { if (e.target === absenceRef.current) absenceRef.current?.close() }}>
        <div className="dialog-head">
          <div>
            <h2 id="absenceTitle">欠勤内容</h2>
            <p>今日の運営に記録されている勤務不可です</p>
          </div>
          <button className="close" type="button" aria-label="閉じる" onClick={() => absenceRef.current?.close()}>×</button>
        </div>
        <div className="dialog-body">
          {props.incident ? (
            <>
              <div className="proof-grid">
                <div className="proof-row"><span>内容</span><b>{props.incident.headline}</b></div>
                <div className="proof-row"><span>記録</span><b>{props.incident.source}</b></div>
                <div className="proof-row"><span>影響</span><b>{props.incident.detail}</b></div>
                {props.incident.steps.map((s, i) => (
                  <div className="proof-row" key={s}><span>対応{i + 1}</span><b>{s}</b></div>
                ))}
              </div>
              <div className="dialog-note">
                記録の追加と訂正は、実データ接続後に有効になります。この画面では記録された内容の確認のみ行えます。
              </div>
            </>
          ) : (
            <p className="subtitle">記録されている勤務不可はありません。</p>
          )}
        </div>
      </dialog>

      {toast && (
        <div className="toast show" role="status" aria-live="polite" aria-atomic="true">
          {toast}
          <button className="toast-close" type="button" aria-label="閉じる" onClick={() => setToast('')}>×</button>
        </div>
      )}
    </div>
  )
}

/** A period step: a Link when it can act, a FOCUSABLE button carrying its
 *  reason when it cannot (canon's own ▶ treatment) — a refusal a keyboard
 *  cannot reach is a refusal that does not explain itself. */
function Step({ step, label, aria }: { step: NavStep; label: string; aria: string }) {
  if (step.href) {
    return (
      <Link className="btn" href={step.href} aria-label={aria} title={step.title} scroll={false}>
        {label}
      </Link>
    )
  }
  return (
    <button className="btn" type="button" aria-disabled="true" aria-label={aria} title={step.title}>
      {label}
    </button>
  )
}

/** 直接指定 — canon's native date/month input (R-A: never a custom picker
 *  widget). It writes the SAME URL parameter the arrows write, so the two
 *  controls can never hold different periods. Navigation goes through the
 *  `go` callback, which the caller wires to `router.push` (deliberately, not
 *  a plain assignment) so the layout stays mounted across the transition and
 *  staged edits survive it; the value it submits is resolved and clamped on
 *  the server. */
function PeriodPicker({ picker, go }: { picker: PickerModel; go: (href: string) => void }) {
  return (
    <input
      /* KEYED ON THE KIND. 週 and 月 hand the same slot a `date` and a `month`
         input, and without a key React reuses the one DOM node — so a single
         commit changes both `type` and `value` and the browser warns that
         「2026-08」 is not a yyyy-MM-dd. A key makes the flip a remount, which
         is what it actually is. */
      key={picker.kind}
      type={picker.kind}
      name={picker.param}
      aria-label={picker.label}
      value={picker.value}
      min={picker.min}
      max={picker.max}
      onChange={(e) => {
        // An emptied input is not a period — canon leaves the board where it is.
        if (!e.target.value) return
        go(`${picker.base}&${picker.param}=${encodeURIComponent(e.target.value)}`)
      }}
    />
  )
}

function stagedNote(cell: Cell) {
  return cell.staged ? <span className="cell-note staged">この画面での変更</span> : null
}

function weekCell(cell: Cell, day: DayModel, m: RosterModel) {
  if (cell.kind === 'closed') return <div className="shift closed"><b>{day.closedLabel}</b></div>
  // A blank cell cannot say whether somebody is off or simply unknown. The week
  // board has the room to say it, so it does (the month grid stays blank —
  // canon's own split, and its legend says 休み（空欄）).
  if (cell.kind === 'none') return <div className="shift rest"><b>—</b><span>勤務予定なし</span></div>
  if (cell.kind === 'partial') {
    return (
      <>
        <div className="shift off">
          <b>{hhmm(cell.start!)}–{hhmm(cell.end!)}</b>
          <span>{hhmm(cell.afterFrom!)}以降 勤務不可</span>
        </div>
        {(day.bookedBy[m.id] ?? []).length > 0 && (
          <span className="cell-note">予約{(day.bookedBy[m.id] ?? []).length}件に影響</span>
        )}
      </>
    )
  }
  if (cell.kind === 'leave-pending') return <div className="shift leave"><b>希望休</b><span>承認待ち</span></div>
  if (cell.kind === 'rest') {
    if (cell.answered === 'approved') return <div className="shift leave"><b>休暇</b><span>この画面で承認</span></div>
    if (cell.staged) return <><div className="shift rest"><b>休み</b></div>{stagedNote(cell)}</>
    return <div className="shift rest"><b>休み</b></div>
  }
  const brk = cell.breaks[0]
  return (
    <>
      <div className="shift">
        <b>{hhmm(cell.start!)}–{hhmm(cell.end!)}</b>
        {brk && <span>休憩 {hhmm(brk.start)}–{hhmm(brk.end)}</span>}
      </div>
      {stagedNote(cell)}
    </>
  )
}

function monthCell(cell: Cell, day: DayModel, m: RosterModel) {
  if (cell.kind === 'closed' || cell.kind === 'none') return null
  if (cell.kind === 'partial') {
    return (
      <>
        <span className="chip-shift small">{hhmm(cell.start!)}–{hhmm(cell.end!)}</span>
        <span className="chip-shift absence small">{hhmm(cell.afterFrom!)}以降 勤務不可</span>
      </>
    )
  }
  if (cell.kind === 'leave-pending') return <span className="chip-shift request">希望休・承認待ち</span>
  if (cell.kind === 'rest') {
    if (cell.answered === 'approved') return <span className="chip-shift quiet">休暇（承認）</span>
    if (cell.staged) return <span className="chip-shift quiet">休み（変更）</span>
    return null
  }
  const booked = day.bookedBy[m.id] ?? []
  return (
    <>
      <span className={cell.staged ? 'chip-shift staged' : 'chip-shift'}>
        {hhmm(cell.start!)}–{hhmm(cell.end!)}
      </span>
      {booked.length > 0 && (
        <span className="booking-mark">● {hhmm(booked[0].startMinute)} 予約{booked.length}件</span>
      )}
    </>
  )
}

function cellLabel(m: RosterModel, day: DayModel, cell: Cell): string {
  const who = `${m.name} ${day.monthCell}`
  if (cell.kind === 'closed') return `${who} 定休日`
  if (cell.kind === 'none') return `${who} 勤務予定なし。クリックで編集`
  if (cell.kind === 'partial') return `${who} ${hhmm(cell.start!)}〜${hhmm(cell.end!)} 勤務、${hhmm(cell.afterFrom!)}以降 勤務不可。クリックで編集`
  if (cell.kind === 'leave-pending') return `${who} 希望休・承認待ち。クリックで編集`
  if (cell.kind === 'rest') return `${who} 休み。クリックで編集`
  return `${who} ${hhmm(cell.start!)}〜${hhmm(cell.end!)} 勤務。クリックで編集`
}
