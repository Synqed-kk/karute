// スタッフ・シフト — the canon screen (fable-store-team-shifts.html, the R-A
// merge of 2026-08-19: ONE page, a TRUE in-page 週/月 switch, no cross-page
// hop), transplanted whole under ⚖ Liam's 8/19 transplant ruling: same
// structure, same layout, same wording, running on PLAY-PHASE FIXTURES.
//
// SERVER COMPONENT, like the other rooms: every read, join, date format and
// policy answer happens here. The screen is handed answers and plain data —
// never a role name, never a wage it may not show, never a clock.
//
// ONE FIXTURE WORLD. The roster's hours and breaks are the 今日の運営 board's
// own `shifts` rows; the 勤務不可 is the board's own `absence`, cut with the
// board's own `effectiveShift`; a day's 予約件数 is the board's own
// `dayTotals().count`; the 欠勤影響 numbers are the board's own 次に決めること
// rows. TODAY on this board and today on that board are the same day because
// they are the same data, not because two files agree.
//
// THE PERIOD IS A LINK, and so is the view. `?view=`, `?week=` and `?ym=` are
// real navigation (the board's `?day=` pattern, ⚖ Liam 22): one period per
// request, back button honest, nothing to keep in sync with a second copy of
// the same state. What must SURVIVE that navigation — the shifts the operator
// has staged in this session — lives in ShiftsSessionEdits, above the screen,
// for exactly the reason the board's own edits do.
//
// WHY THE SCREEN COMPOSES ITS OWN CELLS. This room stages edits, and a staged
// edit changes the cell, the column total and the 人件費 estimate together. If
// the server sent finished strings, those three would go stale the moment
// anything was staged — a check lying about state. So the server sends the
// PLANE and the screen folds the session over it through `cellFor`, the same
// pure function the suite pins. Both sides run one implementation; there is no
// second arithmetic to disagree.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { jstDayKey } from '@/business/lib/clock'
import {
  defaultStoreId,
  listAppointments,
  listCustomers,
  listMenus,
  listStaff,
  listStoreOptions,
  readDayPlanes,
  readShellIdentity,
  renderNow,
  type StoreLens,
} from '@/business/lib/data'
import { hourlyWage, leaveRequests, shiftsPolicy } from '@/business/lib/fixtures-shifts'
import {
  MONTH_OFFSETS,
  absenceImpact,
  bookedKeysOf,
  bookingCount,
  buildRoster,
  clamp,
  conflictsOn,
  dayKeyOf,
  editKey,
  minuteOfDay,
  mondayOf,
  monthCoords,
  resolveLeaveRequests,
  todayKeyOf,
  weekCoords,
  weekOffsetBounds,
  ymdOf,
  type DayContext,
  type RosterMember,
} from '@/business/lib/shifts'
import { hhmm, yen } from '@/business/lib/today-board'
import { ShiftsScreen, type DayModel, type ShiftsProps } from './ShiftsScreen'
import './shifts.css'

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'] as const
const pad2 = (n: number) => String(n).padStart(2, '0')
const isoDate = (dayKey: number) => {
  const p = ymdOf(dayKey)
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`
}
const isoMonth = (y: number, m: number) => `${y}-${pad2(m)}`
const longDay = (dayKey: number) => {
  const p = ymdOf(dayKey)
  return `${p.y}年${p.m}月${p.d}日（${WEEKDAY[p.wd]}）`
}
const shortDay = (dayKey: number) => {
  const p = ymdOf(dayKey)
  return `${p.m}月${p.d}日`
}
const headDay = (dayKey: number) => {
  const p = ymdOf(dayKey)
  return `${p.m}/${p.d} ${WEEKDAY[p.wd]}`
}
const monthLabel = (y: number, m: number) => `${y}年${m}月`

export default async function ShiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string; view?: string; week?: string; ym?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  const storeOptions = await listStoreOptions()
  // A missing or unknown ?store= opens on the operator's own store, never the
  // business-wide merge — defaultStoreId owns that rule for every screen.
  const storeId = defaultStoreId(query.store, storeOptions)
  const clamped = storeId !== null
  const lens: StoreLens = clamped ? storeId! : { viewAll: true }

  // ONE CLOCK READ PER RENDER (the cycle-1 law). Every day index, every label
  // and the 勤務不可 pin all derive from this one instant, so a render crossing
  // JST midnight cannot put two different days on one screen.
  const now = renderNow()
  const todayKey = todayKeyOf(now)

  const [shell, staff, appointments, customers, menus, planes] = await Promise.all([
    readShellIdentity(),
    listStaff(lens),
    listAppointments(lens),
    listCustomers(lens),
    listMenus(lens),
    // The absence, the decision queue and the register are TODAY's by the door's
    // own rule, and today is exactly the day this room joins them to.
    readDayPlanes(lens, todayKey),
  ])

  // ── policy, resolved here and nowhere else ────────────────────────────────
  // The screen is handed ANSWERS. A viewer without the 人件費 right is never
  // sent a wage at all — not hidden, ABSENT — which is the only shape a server
  // can honestly offer, and the same one the other rooms use.
  const maySeeLaborCost = shiftsPolicy.laborCostRoles.includes(shell.operator.role)
  const mayApproveLeave = shiftsPolicy.leaveApprovalRoles.includes(shell.operator.role)

  const roster: RosterMember[] = buildRoster(
    staff,
    planes.shifts,
    planes.staffQualifications,
    maySeeLaborCost ? hourlyWage : {},
    planes.closedWeekday,
    todayKey,
  )

  // ── the calendar the URL asks for ─────────────────────────────────────────
  // Both periods are ABSOLUTE in the URL and clamped here: the pickers and the
  // arrows write the same parameter, so the two controls cannot hold different
  // ideas of which week is showing (canon keeps its input in step for the same
  // reason). Junk falls back to the current period rather than erroring — the
  // period is a view preference, exactly like ?day= on the board.
  const view: 'week' | 'month' = query.view === 'month' ? 'month' : 'week'
  const bounds = weekOffsetBounds(todayKey)
  const askedWeek = parseDate(query.week)
  const weekOffset = clamp(
    askedWeek === null ? 0 : Math.round((mondayOf(askedWeek) - mondayOf(todayKey)) / 7),
    bounds.min,
    bounds.max,
  )
  const askedMonth = parseMonth(query.ym)
  const here = ymdOf(todayKey)
  const monthOffset = clamp(
    askedMonth === null ? 0 : (askedMonth.y - here.y) * 12 + (askedMonth.m - here.m),
    MONTH_OFFSETS[0],
    MONTH_OFFSETS[MONTH_OFFSETS.length - 1],
  )

  const weekDays = weekCoords(todayKey, weekOffset)
  const month = monthCoords(todayKey, monthOffset)
  const shownDays = view === 'week' ? weekDays : month.days

  // ── the joins every day needs ─────────────────────────────────────────────
  const byDay = new Map<number, typeof appointments>()
  for (const a of appointments) {
    const key = jstDayKey(a.starts_at)
    byDay.set(key, [...(byDay.get(key) ?? []), a])
  }
  const leaves = resolveLeaveRequests(leaveRequests, roster, todayKey, byDay, planes.closedWeekday)
  const leaveKeys = new Set(leaves.map((l) => editKey(l.staffId, l.dayKey)))

  const staffName = new Map(roster.map((m) => [m.id, m.name]))
  const customerName = new Map(customers.map((c) => [c.id, c.name]))
  const menuName = new Map(menus.map((m) => [m.id, m.name]))

  // Who is the assigned 担当 of what, per day. Resolved BEFORE the cells,
  // because a booking beats the weekly rest day and the dialog's refusal has to
  // be able to name the customer it is protecting.
  const bookedBy = new Map(
    shownDays.map((dayKey) => {
      const rows = byDay.get(dayKey) ?? []
      return [
        dayKey,
        Object.fromEntries(
          roster.map((m) => [
            m.id,
            rows
              .filter((a) => a.staff_id === m.id && a.status !== 'cancelled')
              .map((a) => ({
                label: `${hhmm(minuteOfDay(a.starts_at))}–${hhmm(minuteOfDay(a.ends_at))} ${
                  customerName.get(a.customer_id) ?? 'お客様'
                }様`,
                startMinute: minuteOfDay(a.starts_at),
                endMinute: minuteOfDay(a.ends_at),
              })),
          ]),
        ),
      ] as const
    }),
  )

  const ctx: DayContext = {
    closedWd: planes.closedWeekday,
    todayKey,
    absence: planes.absence,
    leaveKeys,
    bookedKeys: bookedKeysOf(shownDays.map((dayKey) => ({ dayKey, bookedBy: bookedBy.get(dayKey)! }))),
    shiftEdits: new Map(),
    leaveAnswers: new Map(),
  }

  const days: DayModel[] = shownDays.map((dayKey) => {
    const p = ymdOf(dayKey)
    const rows = byDay.get(dayKey) ?? []
    const closed = p.wd === planes.closedWeekday
    const conflicts = conflictsOn(dayKey, rows, roster, ctx)
    return {
      dayKey,
      long: longDay(dayKey),
      short: shortDay(dayKey),
      head: headDay(dayKey),
      monthCell: `${p.m}月${p.d}日(${WEEKDAY[p.wd]})`,
      wd: p.wd,
      closed,
      closedLabel: closed ? '定休日' : null,
      isToday: dayKey === todayKey,
      bookings: bookingCount(rows),
      conflicts: conflicts.map((c) => ({
        label: `${hhmm(c.startMinute)} ${c.staffName}・${c.reason}`,
        reason: c.reason,
      })),
      bookedBy: bookedBy.get(dayKey)!,
    }
  })

  // ── 欠勤影響 — counted once, off the board's own decision rows ────────────
  const todaysRows = byDay.get(todayKey) ?? []
  const absentStaffId = planes.absence?.staff_id ?? null
  const bookingById = new Map(todaysRows.map((a) => [a.id, a]))
  const impact = absenceImpact(
    planes.decisions,
    (id) => {
      const b = bookingById.get(id)
      if (!b || absentStaffId === null) return false
      return b.staff_id === absentStaffId || b.reassigned_from === absentStaffId
    },
    (id) => bookingById.get(id)?.board_state === 'hold',
  )
  // The incident is TODAY's, so it belongs to the week and the month that hold
  // today — canon shows its panel only on the week the absence happened in.
  const incidentLive = planes.absence !== null && shownDays.includes(todayKey)

  // ── hrefs ─────────────────────────────────────────────────────────────────
  const base = `/${locale}/business/shifts`
  const q = (extra: Record<string, string>) => {
    const parts = [
      ...(clamped ? [`store=${encodeURIComponent(storeId!)}`] : []),
      ...Object.entries(extra).map(([k, v]) => `${k}=${encodeURIComponent(v)}`),
    ]
    return parts.length ? `${base}?${parts.join('&')}` : base
  }
  const weekHrefFor = (offset: number) =>
    q({ view: 'week', week: isoDate(mondayOf(todayKey) + offset * 7), ym: isoMonth(month.y, month.m) })
  const monthHrefFor = (offset: number) => {
    const c = monthCoords(todayKey, offset)
    return q({ view: 'month', ym: isoMonth(c.y, c.m), week: isoDate(mondayOf(todayKey) + weekOffset * 7) })
  }

  const firstWeek = mondayOf(monthCoords(todayKey, MONTH_OFFSETS[0]).days[0])
  const lastMonthDays = monthCoords(todayKey, MONTH_OFFSETS[MONTH_OFFSETS.length - 1]).days
  const lastWeek = mondayOf(lastMonthDays[lastMonthDays.length - 1])

  // ── week-only copy ────────────────────────────────────────────────────────
  const absentName = absentStaffId ? (staffName.get(absentStaffId) ?? '担当者') : null
  const incidentRows = incidentLive
    ? planes.decisions
        .filter((d) => {
          if (d.state !== 'open' || !d.appointment_id) return false
          const b = bookingById.get(d.appointment_id)
          return !!b && (b.staff_id === absentStaffId || b.reassigned_from === absentStaffId)
        })
        .map((d) => {
          const b = bookingById.get(d.appointment_id!)!
          const held = b.board_state === 'hold'
          return {
            id: d.id,
            time: hhmm(minuteOfDay(b.starts_at)),
            customer: `${customerName.get(b.customer_id) ?? 'お客様'}様`,
            menu: menuName.get(b.menu_id ?? '') ?? 'メニュー未定',
            price: b.booked_price === null ? '価格未記録' : `予約時価格 ${yen(b.booked_price)}`,
            // 現在の担当 is who the booking BELONGS to, which for a proposal is
            // still the absent staff member — canon's own column meaning.
            owner: staffName.get(b.reassigned_from ?? b.staff_id ?? '') ?? '担当者未定',
            qualification: (planes.staffQualifications[b.staff_id ?? ''] ?? []).join('・') || '—',
            status: held ? `${staffName.get(b.staff_id ?? '') ?? '担当者'}で仮押さえ` : '未確定',
            statusTone: held ? 'info' : 'danger',
            kicker: `${hhmm(minuteOfDay(b.starts_at))} / ${held ? '仮押さえ中' : '未確定'}`,
            title: d.proof_title,
            meta: `${customerName.get(b.customer_id) ?? 'お客様'}様 / ${menuName.get(b.menu_id ?? '') ?? 'メニュー未定'}`,
            proofs: d.proofs,
            deadline: d.deadline,
            // Canon's amber 注意 block. Ours states the decision's own facts
            // rather than a narrative this world does not hold.
            warning: held
              ? null
              : `${d.detail}。${d.deadline}に判断が必要です。予約の担当・時間・予約時価格は、予約一覧で個別に確定するまで変更しません。`,
            action: held
              ? `${staffName.get(b.staff_id ?? '') ?? '担当者'}で仮押さえ済み`
              : '安全な候補がありません',
          }
        })
    : []

  const props: ShiftsProps = {
    view,
    store: clamped ? storeId : null,
    storeLabel: clamped ? (storeOptions.find((s) => s.id === storeId)!.name) : 'すべての店舗',
    // The absence, stated ONCE for all three surfaces that speak about it.
    incident:
      incidentLive && planes.absence && absentName
        ? {
            headline: `${absentName}さん、${longDay(todayKey)} ${hhmm(planes.absence.from)}以降は勤務不可`,
            detail:
              impact.affected === 0
                ? '影響する予約はありません。'
                : `影響予約${impact.affected}件のうち${impact.withCandidate}件は安全な候補で仮押さえ済み。残り${impact.undecided}件は元の担当を保持したまま検討中です。`,
            source: `記録: ${planes.absence.reason}${planes.absence.intake_stopped ? ' / 受付停止済み' : ''}`,
            banner: `${shortDay(todayKey)}: ${absentName} ${hhmm(planes.absence.from)}以降 勤務不可 — 影響予約${impact.affected}件・${impact.withCandidate}件仮押さえ済み・${impact.undecided}件検討中`,
            steps: [...planes.recoverySteps],
            stats: [
              { label: '影響予約', value: `${impact.affected}件`, warn: false },
              { label: '安全な候補', value: `${impact.withCandidate}件`, warn: false },
              { label: '未確定', value: `${impact.undecided}件`, warn: impact.undecided > 0 },
            ],
          }
        : null,
    toggle: {
      weekHref: weekHrefFor(weekOffset),
      monthHref: monthHrefFor(monthOffset),
    },
    head: {
      dateline:
        view === 'week'
          ? `${longDay(weekDays[0])} – ${longDay(weekDays[6])}`
          : `${longDay(month.days[0])} – ${longDay(month.days[month.days.length - 1])}`,
      subtitle:
        view === 'week'
          ? '勤務、休憩、休暇、資格、予約影響を同じ週の事実として確認します'
          : '勤務・休み・勤務不可を、月単位でまとめて確認します',
      impactChip: `欠勤影響 ${incidentLive ? impact.affected : 0}件`,
      impactWarn: incidentLive && impact.affected > 0,
      // Canon says 「公開済み 4名」. This world has no publish state to claim —
      // the roster is a standing arrangement, not a published version — so the
      // chip names what is true: how many people this board schedules.
      rosterChip: `勤務予定 ${roster.filter((m) => m.shift).length}名`,
    },
    period:
      view === 'week'
        ? {
            label: `${shortDay(weekDays[0])} – ${shortDay(weekDays[6])}`,
            prev: {
              href: weekOffset > bounds.min ? weekHrefFor(weekOffset - 1) : null,
              title:
                weekOffset > bounds.min
                  ? `${shortDay(weekDays[0] - 7)}の週を表示`
                  : `${monthLabel(monthCoords(todayKey, MONTH_OFFSETS[0]).y, monthCoords(todayKey, MONTH_OFFSETS[0]).m)}より前のシフトは表示できません`,
            },
            today: {
              href: weekOffset === 0 ? null : weekHrefFor(0),
              title: weekOffset === 0 ? '今週を表示しています' : '今週を表示',
            },
            next: {
              href: weekOffset < bounds.max ? weekHrefFor(weekOffset + 1) : null,
              title:
                weekOffset < bounds.max
                  ? `${shortDay(weekDays[0] + 7)}の週を表示`
                  : `${monthLabel(monthCoords(todayKey, 1).y, monthCoords(todayKey, 1).m)}より先のシフトは表示できません`,
            },
            picker: {
              kind: 'date',
              param: 'week',
              value: isoDate(weekDays[0]),
              min: isoDate(firstWeek),
              max: isoDate(lastWeek + 6),
              label: '週を日付で直接指定',
              base: q({ view: 'week', ym: isoMonth(month.y, month.m) }),
            },
          }
        : {
            label: monthLabel(month.y, month.m),
            prev: {
              href: monthOffset > MONTH_OFFSETS[0] ? monthHrefFor(monthOffset - 1) : null,
              title:
                monthOffset > MONTH_OFFSETS[0]
                  ? `${monthLabel(monthCoords(todayKey, monthOffset - 1).y, monthCoords(todayKey, monthOffset - 1).m)}を表示`
                  : '前月より前のシフトは表示できません',
            },
            today: {
              href: monthOffset === 0 ? null : monthHrefFor(0),
              title: monthOffset === 0 ? '今月を表示しています' : '今月を表示',
            },
            next: {
              href: monthOffset < MONTH_OFFSETS[MONTH_OFFSETS.length - 1] ? monthHrefFor(monthOffset + 1) : null,
              title:
                monthOffset < MONTH_OFFSETS[MONTH_OFFSETS.length - 1]
                  ? `${monthLabel(monthCoords(todayKey, monthOffset + 1).y, monthCoords(todayKey, monthOffset + 1).m)}を表示`
                  : '翌月より先のシフトは表示できません',
            },
            picker: {
              kind: 'month',
              param: 'ym',
              value: isoMonth(month.y, month.m),
              min: isoMonth(monthCoords(todayKey, MONTH_OFFSETS[0]).y, monthCoords(todayKey, MONTH_OFFSETS[0]).m),
              max: isoMonth(monthCoords(todayKey, 1).y, monthCoords(todayKey, 1).m),
              label: '月を直接指定',
              base: q({ view: 'month', week: isoDate(mondayOf(todayKey) + weekOffset * 7) }),
            },
          },
    // ⚠SETTINGS-BATCH / registry: canon's パターン and 別月のシフトをコピー both
    // ASSIGN shifts, which is a write, and the play-phase fence forbids every
    // write in territory. Carried literally they would be buttons that open a
    // dialog whose only outcome is a toast saying nothing happened — the
    // dead-lever class one level down. They ship refused with their reason, in
    // the shell's own grammar for exactly this case.
    refusedActions: [
      { label: 'パターン', title: '勤務パターンの割当は見本データでは実行できません' },
      { label: '別月のシフトをコピー', title: 'シフトのコピーは見本データでは実行できません' },
    ],
    plane: {
      todayKey,
      closedWd: planes.closedWeekday,
      absence: planes.absence,
      roster: roster.map((m) => ({
        id: m.id,
        name: m.name,
        shift: m.shift,
        restWd: m.restWd,
        wage: m.wage,
        qualifications: m.qualifications,
        // Canon's 早番型 / 遅番型 column tag. This world has no pattern names —
        // inventing one would name something that does not exist — so the tag
        // is the standing window itself, which is the fact the tag stood for.
        patternLabel: m.shift ? `${hhmm(m.shift.start)}–${hhmm(m.shift.end)}` : '勤務予定なし',
      })),
      leaves: leaves.map((l) => ({
        staffId: l.staffId,
        staffName: l.staffName,
        dayKey: l.dayKey,
        dayLabel: longDay(l.dayKey),
        reason: l.reason,
        // A refusal, resolved on the server: approving this would leave a day
        // short of the person its customers were promised.
        refusal:
          l.conflicts.length === 0
            ? null
            : `${shortDay(l.dayKey)}は${l.conflicts
                .map((a) => `${hhmm(minuteOfDay(a.starts_at))} ${customerName.get(a.customer_id) ?? 'お客様'}様`)
                .join('・')}の担当です。先に予約一覧で担当を変更してください。`,
      })),
      days,
    },
    week:
      view !== 'week'
        ? null
        : {
            summaryTitle: weekOffset === 0 ? '今週の配置' : 'この週の配置',
            summaryNote:
              '勤務時間と休憩は店舗の標準シフトから、休暇と欠勤はその日の記録から読み込んでいます',
            openIssueLabel: incidentLive ? `${impact.undecided}件` : '0件',
            openIssueWarn: incidentLive && impact.undecided > 0,
            boardNote: '予約資格は担当変更候補の判定に使い、権限とは分けて管理します',
            rows: incidentRows,
            emptyRecovery: {
              title: '未解決の欠勤影響はありません。',
              body: '勤務不可が記録されると、予約を変えずに影響と安全な候補をここで確認できます。',
            },
            safeNote:
              '予約はまだ変更されません。ここで確認するのは店内判断用の候補です。価格、時間、お客様、現在の担当は保持します。',
            reservationsHref: q({}).replace('/shifts', '/reservations'),
          },
    month:
      view !== 'month'
        ? null
        : {
            laborCost: maySeeLaborCost
              ? {
                  // 売上ペース比 needs a month's takings, and this world has no
                  // settlement ledger yet (売上分析 is a separate room). The
                  // ratio is REFUSED with its reason rather than divided by a
                  // number nobody has.
                  note: '休憩を除く実働時間 × 時給の概算です。時給レートは設定・店舗管理者以上に表示されます。',
                  paceNote: '今月売上ペース比は、売上分析の公開後に表示します。',
                }
              : null,
            leaveStripNote: mayApproveLeave
              ? null
              : '希望休の承認は店舗管理者以上が行います。',
            mayApproveLeave,
            legend: [
              { key: 'work', label: '勤務' },
              { key: 'off', label: '休み（空欄）' },
              { key: 'absence', label: '欠勤・勤務不可' },
              { key: 'closed', label: '定休日' },
            ],
          },
  }

  return <ShiftsScreen {...props} />
}

/** `?week=YYYY-MM-DD` → its JST day index. Anything else is not a date.
 *
 *  A ROUND TRIP, not a component range test, because `dayKeyOf` is `Date.UTC`
 *  and `Date.UTC` NORMALISES. `2026-02-31` is well formed, passes every range
 *  a component check can state (month 2, day 31), and comes back as March 3rd
 *  — so the URL quietly answered with a week nobody asked for instead of
 *  taking the fallback every malformed string takes. Nothing but building the
 *  day and reading its coordinates back can tell 2/31 from 3/31: a date the
 *  calendar HAS survives the trip unchanged, an invented one does not. The
 *  same trip subsumes the old range test (month 0 and 13 roll into the
 *  neighbouring year, day 0 into the previous month) and catches the
 *  two-digit-year normalisation on top — `Date.UTC(26, …)` is 1926. */
function parseDate(value: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dayKey = dayKeyOf(y, mo, d)
  const back = ymdOf(dayKey)
  if (back.y !== y || back.m !== mo || back.d !== d) return null
  return dayKey
}

/** `?ym=YYYY-MM` → its year and month. No round trip here, and the hole above
 *  has no twin: the month is the only component that can be out of range, this
 *  states that range outright, and the pair is never handed to a `Date` — it
 *  goes into offset arithmetic the month window clamps. */
function parseMonth(value: string | undefined): { y: number; m: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? '')
  if (!m) return null
  const mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  return { y: Number(m[1]), m: mo }
}
