// 今日の運営 — the canon board (fable-store-today.html), transplanted whole
// under ⚖ Liam's 8/19 transplant ruling: same structure, same layout, same
// wording, running on PLAY-PHASE FIXTURES.
//
// SERVER COMPONENT ON PURPOSE, like the 顧客 screen: every read, join, sum and
// date format happens here, so the client receives plain strings and numbers.
// No timezone and no locale can drift between the two renders, and no data
// access exists on the client at all.
//
// THE BOARD IS ONE FIXTURE WORLD. The cards on this board ARE the appointment
// rows the 顧客 screen's 次回予約 column reads — same ids, same times, same
// prices. Nothing about a booking is restated for the board; what the board
// adds (shifts, beds, cleanup, decisions, register aggregates) sits in its own
// planes keyed to the same ids, and every number that appears twice is computed
// once in src/business/lib/today-board.ts.
//
// COUNTS RECONCILE, and that is a rule rather than a coincidence: the nav badge,
// 未解決, 次に決めること and the cards below the board are ONE count of open
// decisions; 稼働率 and the calendar's free-slot numbers are ONE pair of minute
// sums; the money band and the revenue KPI are summed from the cards on screen.
//
// DAY NAVIGATION is a link (`?day=`), not client state: the board would
// otherwise have to carry a fortnight of composed boards to the browser to move
// one day. Same soft navigation, one day's data.

import { requireBusinessAdmission } from '@/business/lib/admission'
import { jstDayKey } from '@/business/lib/clock'
import {
  listAppointments,
  listCustomers,
  listMenus,
  listResources,
  listStaff,
  listStoreOptions,
  readDayPlanes,
  readShellIdentity,
  readStaffStores,
  type StoreLens,
} from '@/business/lib/data'
import {
  buildLanes,
  dayBookings,
  dayTotals,
  freeSlots,
  hhmm,
  laneMinutes,
  openDecisions,
  utilization,
  yen,
  type BoardBooking,
  type BuildInput,
} from '@/business/lib/today-board'
import { TodayScreen, type DecisionCard, type InspectorCase, type TodayProps } from './TodayScreen'
import './today.css'

const JST = { timeZone: 'Asia/Tokyo' } as const
const fmtDayFull = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', ...JST })
const fmtDayShort = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short', ...JST })
const fmtMonth = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', ...JST })
const fmtTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false, ...JST })

const DAY_MS = 86_400_000
/** 予約種別 as canon writes it on a card and in the 精算 dialog's sub-line. */
const CATEGORY_WORD = { new: '新規', repeat: '単発', ticket: '回数券', vip: 'VIP' } as const
const WEEKDAY_WORD = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'] as const
/** The window the date nav and the month calendar can reach. Wide enough for a
 *  month either way, small enough that the per-day sums are free. */
const WINDOW = 45

/** Y/M/D/weekday of an instant, read in JST — the calendar grid's coordinates.
 *  Built from Intl rather than getMonth() so the server's own timezone never
 *  shifts a cell into the wrong week. */
function jstParts(at: Date): { y: number; m: number; d: number; wd: number } {
  const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', ...JST })
    .formatToParts(at)
  const get = (t: string) => p.find((x) => x.type === t)!.value
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), wd: WD.indexOf(get('weekday')) }
}

export default async function TodayPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ store?: string; day?: string }>
}) {
  await requireBusinessAdmission()
  const [{ locale }, query] = await Promise.all([params, searchParams])
  const storeOptions = await listStoreOptions()
  const clamped = storeOptions.some((o) => o.id === query.store)
  const lens: StoreLens = clamped ? query.store! : { viewAll: true }

  // An unparseable ?day= falls back to today rather than erroring: the day is a
  // view preference, and it is clamped to the window the reads cover.
  const requested = Number.parseInt(query.day ?? '0', 10)
  const dayOffset = Number.isFinite(requested) ? Math.max(-WINDOW, Math.min(WINDOW, requested)) : 0

  const now = new Date()
  const todayKey = jstDayKey(now)
  const shownKey = todayKey + dayOffset
  const from = new Date(now.getTime() + (-WINDOW - 1) * DAY_MS).toISOString()
  const to = new Date(now.getTime() + (WINDOW + 1) * DAY_MS).toISOString()

  const [customers, appointments, menus, staff, resources, planes, shell] = await Promise.all([
    listCustomers(lens),
    listAppointments(lens, { from, to }),
    listMenus(lens),
    listStaff(lens),
    listResources(lens),
    readDayPlanes(lens),
    readShellIdentity(),
  ])
  const staffStores = await readStaffStores(lens)

  const storeNames = new Map(storeOptions.map((s) => [s.id, s.name]))
  const input: BuildInput = {
    appointments,
    customers,
    menus,
    staff,
    resources,
    shifts: planes.shifts,
    qualifications: planes.staffQualifications,
    staffListPrice: planes.staffListPrice,
    staffStores,
    absence: planes.absence,
    blocks: planes.blocks,
    sellSlots: planes.sellSlots,
    decisions: planes.decisions,
    hours: planes.operatingHours,
    dayKey: shownKey,
    operatorStaffId: shell.operator.staff_id,
    storeNames,
    crossStore: !clamped,
  }

  const bookings = dayBookings(input)
  const lanes = buildLanes(input, bookings)
  const minutes = laneMinutes(input, bookings)
  const util = utilization(minutes)
  const totals = dayTotals(
    appointments.filter((a) => jstDayKey(a.starts_at) === shownKey),
    planes.register.refunds,
  )
  const open = openDecisions(planes.decisions)

  const bookingById = new Map(bookings.map((b) => [b.id, b]))
  const staffName = new Map(staff.map((s) => [s.id, s.full_name]))
  const resourceName = new Map(resources.map((r) => [r.id, r.name]))
  const slotById = new Map(planes.sellSlots.map((s) => [s.id, s]))

  const shownAt = new Date(now.getTime() + dayOffset * DAY_MS)
  const hourCount = (planes.operatingHours.close - planes.operatingHours.open) / 60
  const hourLabels = Array.from({ length: hourCount }, (_, i) => String(planes.operatingHours.open / 60 + i))

  // ── the day index behind the calendar (E8) and the date nav ───────────────
  // Free slots and 稼働率 come from the SAME two sums, so a day that reads 満
  // cannot also read as under-utilised.
  const rosterMinutes = minutes.filter((m) => m.treats).reduce((n, m) => n + m.availableMinutes, 0)
  const bookedByDay = new Map<number, number>()
  const countByDay = new Map<number, number>()
  for (const a of appointments) {
    if (a.status === 'cancelled' || a.board_state === 'noshow') continue
    const key = jstDayKey(a.starts_at)
    countByDay.set(key, (countByDay.get(key) ?? 0) + 1)
    bookedByDay.set(
      key,
      (bookedByDay.get(key) ?? 0) + (new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60_000,
    )
  }
  const calendar = Array.from({ length: WINDOW * 2 + 1 }, (_, i) => {
    const offset = i - WINDOW
    const at = new Date(now.getTime() + offset * DAY_MS)
    const p = jstParts(at)
    // 定休日 has no capacity to advertise — a closed day showing free slots is
    // the impossible state, not a rounding question.
    const closed = p.wd === planes.closedWeekday
    const free = closed ? 0 : freeSlots(rosterMinutes, bookedByDay.get(todayKey + offset) ?? 0)
    return { offset, ...p, closed, free, booked: countByDay.get(todayKey + offset) ?? 0 }
  })

  // ── C: ops strip ──────────────────────────────────────────────────────────
  const undelivered = planes.decisions.filter((d) => d.notification === 'undelivered').length
  const syncLabel = fmtTime.format(new Date(shell.reserveSyncedAt))

  // ── D: 自分の1日 ──────────────────────────────────────────────────────────
  const mineShift = planes.shifts.find((s) => s.staff_id === shell.operator.staff_id) ?? null
  const mineBookings = bookings.filter((b) => b.staffId === shell.operator.staff_id)
  const mineNext = mineBookings.find((b) => b.startMinute >= planes.boardNow) ?? null
  const minePending = open.filter((d) => d.owner_staff_id === shell.operator.staff_id)

  // ── E5: ご来店中 ──────────────────────────────────────────────────────────
  const inStore = bookings.find((b) => b.settlement === 'awaiting') ?? null

  // ── I: incident band ──────────────────────────────────────────────────────
  // A decision belongs to the incident when the booking it points at is the
  // absent staff member's — either still hers, or hers before the proposal.
  const incidentDecisions = planes.absence
    ? open.filter((d) => {
        const b = d.appointment_id ? bookingById.get(d.appointment_id) : undefined
        if (!b) return false
        return b.staffId === planes.absence!.staff_id || b.reassignedFromName === staffName.get(planes.absence!.staff_id)
      })
    : []
  const incident = planes.absence
    ? {
        staffName: staffName.get(planes.absence.staff_id) ?? '担当者',
        from: hhmm(planes.absence.from),
        reason: planes.absence.reason,
        // 影響: canon's MARKUP ships the placeholder 「—件」 and its contract
        // (§8) parks the semantics — but canon's rendered board fills it in,
        // so the number is lifted rather than the placeholder. Definition here:
        // today's bookings that were the absent staff member's when she stopped
        // working, whether they still are or have been proposed to someone
        // else. Stated in the PR body so Liam can rule on it.
        affected: `${
          bookings.filter(
            (b) =>
              b.startMinute >= planes.absence!.from &&
              (b.staffId === planes.absence!.staff_id ||
                b.reassignedFromName === (staffName.get(planes.absence!.staff_id) ?? '')),
          ).length
        }件`,
        // 未判断: an incident decision with nothing staged yet. The 担当変更 case
        // already has a 仮押さえ on the board, so it is judged and waiting.
        undecided: incidentDecisions.filter(
          (d) => !d.appointment_id || bookingById.get(d.appointment_id)?.state !== 'hold',
        ).length,
        waitingContact: incidentDecisions.filter((d) => d.notification === 'unsent').length,
        steps: planes.recoverySteps,
        intakeStopped: planes.absence.intake_stopped,
        caseId: incidentDecisions[0]?.id ?? null,
      }
    : null

  // ── J: decision cards ─────────────────────────────────────────────────────
  const hqSpread = Math.round(((planes.pricingRule.hq_max - planes.pricingRule.hq_min) / planes.pricingRule.hq_min) * 100)

  function decisionTitle(kind: string, b: BoardBooking | undefined, slotStart: number | null): string {
    if (kind === 'レジ') return `${b?.customerName ?? 'お客様'}様の精算を完了する`
    if (kind === 'Reserve販売') return `${slotStart == null ? '' : hhmm(slotStart)}の安全な1枠を販売する`
    if (kind === '担当不在') return `${b ? hhmm(b.startMinute) : ''} ${b?.customerName ?? 'お客様'}様の担当不在に対応する`
    return `${b ? hhmm(b.startMinute) : ''} ${b?.customerName ?? 'お客様'}様へ担当変更案を送る`
  }

  const cards: DecisionCard[] = planes.decisions.map((d) => {
    const b = d.appointment_id ? bookingById.get(d.appointment_id) : undefined
    const slot = d.sell_slot_id ? slotById.get(d.sell_slot_id) : undefined
    const evidence: Array<[string, string]> =
      d.kind === 'レジ'
        ? [['請求', b?.price == null ? '価格未記録' : yen(b.price)], ['担当', b?.staffName ?? '担当未定']]
        : d.kind === 'Reserve販売'
          ? [['公開価格', slot ? yen(slot.price_high) : '価格未記録'], ['HQ範囲', `0〜+${hqSpread}%`]]
          : [['根拠', `${d.proofs.length}件`], ['価格', b?.price == null ? '記録なし' : `${yen(b.price)}保持`]]
    return {
      id: d.id,
      kind: d.kind,
      deadline: d.deadline,
      deadlineTone: d.deadline_tone,
      urgent: d.urgent,
      state: d.state,
      status: d.status,
      statusTone: d.status_tone,
      title: decisionTitle(d.kind, b, slot?.start ?? null),
      detail: d.detail,
      evidence,
      bookingId: d.appointment_id,
    }
  })

  // ── G: inspector cases — one per decision, one per board card ─────────────
  function bookingCase(b: BoardBooking, kicker: string, status: string, statusTone: InspectorCase['statusTone'], proofTitle: string, proofs: string[]): InspectorCase {
    return {
      id: b.id,
      kicker,
      title: `${b.customerName} 様`,
      meta: `${b.timeRange} / ${b.menuName}`,
      status,
      statusTone,
      source: `${b.source} / ${b.displayNo}`,
      facts: [
        ['担当・設備', `${b.staffName} / ${b.resourceName}`],
        ['予約種別', `${b.category === 'ticket' ? '回数券' : b.category === 'vip' ? 'VIP' : '単発'} / ${b.source.split(' ')[0]}`],
        [b.settlement === 'awaiting' ? '請求額' : '予約時価格', b.price == null ? '記録なし' : `${yen(b.price)}（税込）`],
        ['連絡状態', b.state === 'hold' ? '未送信' : '送信済み'],
        ['カルテ', b.settlement === null ? '施術後に作成' : '施術記録あり'],
        [
          '作成 / 更新',
          `${fmtDayShort.format(new Date(shownAt.getTime() - b.takenDaysAgo * DAY_MS))} / ${
            b.updatedMinute == null ? '更新なし' : `${dayOffset === 0 ? '本日' : '当日'} ${hhmm(b.updatedMinute)}`
          }`,
        ],
      ],
      proofTitle,
      proofs,
      price:
        b.price == null
          ? null
          : b.reassignedFromName != null
            ? `店都合の担当変更でも 予約時価格 ${yen(b.price)}を保持。現在の公開価格は使いません。`
            : `予約時価格 ${yen(b.price)} で確定しています。`,
      primary: null,
      bookingId: b.id,
    }
  }

  const cases: Record<string, InspectorCase> = {}
  bookings.forEach((b, i) => {
    cases[b.id] = bookingCase(
      b,
      `予約 ${i + 1} / ${bookings.length}`,
      b.state === 'hold' ? '仮押さえ' : b.state === 'attention' ? '要対応' : b.state === 'noshow' ? '来店なし' : b.settlement === 'awaiting' ? '精算待ち' : '確定',
      b.state === 'hold' ? 'waiting' : b.state === 'attention' || b.settlement === 'awaiting' ? 'checkout' : 'done',
      b.resourceId ? `${b.staffName} + ${b.resourceName}が成立` : '設備は未確定',
      b.resourceId
        ? ['担当の勤務時間内', '休憩と重ならない', `${b.resourceName}と清掃30分を確保`, '予約時価格を保持']
        : ['担当の勤務時間内', '設備の割当てが未確定', '予約時価格を保持'],
    )
  })
  planes.decisions.forEach((d, i) => {
    const b = d.appointment_id ? bookingById.get(d.appointment_id) : undefined
    const slot = d.sell_slot_id ? slotById.get(d.sell_slot_id) : undefined
    const openIndex = open.findIndex((x) => x.id === d.id)
    cases[d.id] = b
      ? {
          ...bookingCase(b, openIndex >= 0 ? `判断 ${openIndex + 1} / ${open.length}` : `判断 ${i + 1}`, d.status, d.status_tone, d.proof_title, d.proofs),
          id: d.id,
          primary: d.kind === 'レジ' ? '精算を開く' : d.kind === '担当変更' ? '変更案を確認' : null,
        }
      : {
          id: d.id,
          kicker: openIndex >= 0 ? `判断 ${openIndex + 1} / ${open.length}` : `判断 ${i + 1}`,
          title: '販売可能枠',
          meta: slot ? `${hhmm(slot.start)}–${hhmm(slot.end)} / ${staffName.get(slot.staff_id) ?? '担当未定'}` : '枠未設定',
          status: d.status,
          statusTone: d.status_tone,
          source: slot ? `${resourceName.get(slot.resource_id) ?? '設備未定'}` : '—',
          facts: slot
            ? [
                ['担当・設備', `${staffName.get(slot.staff_id) ?? '担当未定'} / ${resourceName.get(slot.resource_id) ?? '設備未定'}`],
                ['公開価格', yen(slot.price_high)],
                ['下限価格', yen(slot.price_low)],
                ['HQ範囲', `${yen(planes.pricingRule.hq_min)}〜${yen(planes.pricingRule.hq_max)}`],
              ]
            : [],
          proofTitle: d.proof_title,
          proofs: d.proofs,
          price: slot ? `公開価格 ${yen(slot.price_high)} はHQ範囲内です。既存予約の価格は変わりません。` : null,
          primary: 'Reserveの受付と価格',
          bookingId: null,
        }
  })

  // ── H: the hold on the board ──────────────────────────────────────────────
  const heldBooking = bookings.find((b) => b.state === 'hold') ?? null
  const holdDecision = heldBooking ? planes.decisions.find((d) => d.appointment_id === heldBooking.id) ?? null : null

  const props: TodayProps = {
    locale,
    storeParam: clamped ? query.store! : null,
    lensLabel: clamped ? (storeNames.get(query.store!) ?? 'この店舗') : 'すべての店舗',
    dayOffset,
    dayLabel: fmtDayFull.format(shownAt),
    monthLabel: fmtMonth.format(shownAt),
    isToday: dayOffset === 0,
    windowDays: WINDOW,
    hours: { open: planes.operatingHours.open, close: planes.operatingHours.close, count: hourCount, labels: hourLabels },
    nowFraction: dayOffset === 0
      ? Math.max(0, Math.min(1, (planes.boardNow - planes.operatingHours.open) / (planes.operatingHours.close - planes.operatingHours.open)))
      : null,
    nowLabel: hhmm(planes.boardNow),
    lanes,
    // The 販売可能枠 layer is DERIVED IN THE BROWSER, not here: it has to answer
    // to a drag in progress, and a server-frozen cell list would keep painting
    // a window the card being dragged is already standing in. The dials come
    // from the store's settings; the arithmetic is canon's
    // (src/business/lib/canon-logic/availability.ts).
    sell: {
      gridMin: planes.opsConfig.reserveStartGridMin,
      nowMinute: dayOffset === 0 ? planes.boardNow : null,
    },
    closedWeekdayLabel: WEEKDAY_WORD[planes.closedWeekday],
    ops: {
      total: yen(totals.total),
      settled: `${totals.settled}件`,
      awaiting: `${totals.awaiting}件`,
      cashDifference: yen(planes.register.cash_difference),
      unresolved: open.length,
      syncLabel,
      undelivered,
    },
    myDay: mineShift
      ? {
          next: mineNext
            ? `${hhmm(mineNext.startMinute)} ${mineNext.customerName}様（${mineNext.category === 'new' ? '新規' : '再来'}・${mineNext.endMinute - mineNext.startMinute}分）`
            : '本日の残り予約はありません',
          pending: minePending.length === 0 ? 'なし' : `${minePending.length}件 — ${minePending[0].kind}の確認`,
          pendingWarn: minePending.length > 0,
          todayCount: `${mineBookings.length}件`,
          shift: `シフト ${hhmm(mineShift.start)}–${hhmm(mineShift.end)}`,
          break: mineShift.breaks.length === 0 ? '休憩なし' : `休憩 ${hhmm(mineShift.breaks[0].start)}–${hhmm(mineShift.breaks[0].end)}`,
        }
      : null,
    inStore: inStore ? { name: inStore.customerName, bookingId: inStore.id } : null,
    incident,
    cards,
    cases,
    kpi: {
      count: `${totals.count}件`,
      revenue: yen(totals.revenue),
      utilization: `${util.percent}%`,
      note: `${dayOffset === 0 ? '本日 ' : ''}${fmtDayShort.format(shownAt)} / ${clamped ? '全スタッフ' : '全店舗・全スタッフ'}`,
    },
    hold: heldBooking
      ? {
          summary: `${hhmm(heldBooking.startMinute)} ${heldBooking.customerName}様 / ${heldBooking.staffName} / ${heldBooking.resourceName}`,
          checks: holdDecision?.proofs ?? [],
          bookingId: heldBooking.id,
        }
      : null,
    calendar,
    dialogs: {
      recovery: heldBooking
        ? {
            rows: [
              ['影響元', `${hhmm(heldBooking.startMinute)} ${heldBooking.reassignedFromName ?? '担当未定'} — 勤務不可`],
              ['新しい仮押さえ', `${hhmm(heldBooking.startMinute)} ${heldBooking.staffName} / ${heldBooking.resourceName}`],
              ['お客様連絡', 'LINEで担当変更案を送信'],
              ['価格', heldBooking.price == null ? '記録なし' : `予約時価格 ${yen(heldBooking.price)}を保持 / 変更不可`],
              ['監査', '操作者、元枠、新枠、制約確認、配信結果を記録'],
            ],
          }
        : null,
      checkout: inStore
        ? {
            title: `${inStore.customerName} 様の精算`,
            sub: `${inStore.timeRange} / ${inStore.menuName} / ${CATEGORY_WORD[inStore.category]}`,
            amount: inStore.price == null ? '記録なし' : `${yen(inStore.price)}（税込）`,
            rows: [
              ['請求額', inStore.price == null ? '記録なし' : `${yen(inStore.price)}（税込）`],
              ['予約時価格', inStore.price == null ? '記録なし' : `${yen(inStore.price)} / 変更なし`],
              ['担当・設備', `${inStore.staffName} / ${inStore.resourceName}`],
            ],
            bookingId: inStore.id,
          }
        : null,
      pricing: {
        base: planes.pricingRule.base,
        hqMin: planes.pricingRule.hq_min,
        hqMax: planes.pricingRule.hq_max,
        hqSpread,
        version: planes.pricingRule.version,
        approvedAt: fmtDayShort
          .format(new Date(now.getTime() - planes.pricingRule.approved_days_ago * DAY_MS))
          .replace(/\([^)]*\)/, '')
          .concat(` ${hhmm(planes.pricingRule.approved_minute)}`),
        approvedBy: planes.pricingRule.approved_by,
        protectedLabel: `回数券 ${planes.pricingRule.protected.ticket}件 / VIP ${planes.pricingRule.protected.vip}件 / 店頭 ${planes.pricingRule.protected.walkin}件`,
        slots: planes.sellSlots.map((s) => ({
          id: s.id,
          label: `${hhmm(s.start)}–${hhmm(s.end)} / ${staffName.get(s.staff_id) ?? '担当未定'} + ${resourceName.get(s.resource_id) ?? '設備未定'}`,
          sub: `基準 ${yen(planes.pricingRule.base)} / 10円単位四捨五入`,
          price: yen(s.price_high),
        })),
      },
      terminal: {
        rows: [
          ['端末取引', `${hhmm(planes.register.terminal_held.at)} / ${yen(planes.register.terminal_held.amount)} / ${planes.register.terminal_held.terminal}`],
          ['二重送信防止ID', planes.register.terminal_held.idempotency_id],
          ['予約', `${bookingById.get(planes.register.terminal_held.appointment_id)?.displayNo ?? '—'} / ${bookingById.get(planes.register.terminal_held.appointment_id)?.customerName ?? '—'} 様`],
          ['レジ状態', '端末送信待ち / 金額未反映'],
          ['反映後', '端末保持 0件 / 差異0件'],
        ],
      },
      closing: {
        title: `${fmtDayShort.format(shownAt)}の閉店準備`,
        sub: `${hhmm(planes.boardNow)}現在。予約、精算、決済端末、現金、回数券の阻害を先に確認します`,
        checks: [
          ['予約終了', incident ? `未連絡 ${incident.waitingContact}件` : '未連絡 0件', (incident?.waitingContact ?? 0) > 0],
          ['精算', `未精算 ${totals.awaiting}件`, totals.awaiting > 0],
          ['決済端末', `端末保持 1件 / ${yen(planes.register.terminal_held.amount)}`, true],
          ['現金', `差異 ${yen(planes.register.cash_difference)}`, false],
          ['回数券', `本日${bookings.filter((b) => b.category === 'ticket').length}回 / Karute同期済み`, false],
        ] as Array<[string, string, boolean]>,
      },
      blockers: [
        ['決済端末', `端末保持 1件 / ${yen(planes.register.terminal_held.amount)}`],
        ['未精算', `${totals.awaiting}件 / ${inStore ? `${inStore.customerName}様` : '—'}`],
      ] as Array<[string, string]>,
      create: {
        staff: lanes.filter((l) => l.group === 'staff').map((l) => ({ id: l.key, name: l.label })),
        menus: menus.map((m) => ({
          id: m.id,
          name: m.name,
          minutes: m.duration_minutes,
          price: yen(m.price),
          store: m.store_id == null ? '全店舗' : (storeNames.get(m.store_id) ?? '店舗未設定'),
        })),
        customers: customers
          .filter((c) => !c.external_owner)
          .map((c) => ({ id: c.id, name: c.name, no: c.member_number, phone: c.phone ?? '電話未登録', furigana: c.furigana ?? '' })),
        sources: ['店頭', '電話', 'Reserve', '紹介'],
        blockKinds: ['休憩', '準備', '記録', '清掃', 'ミーティング'],
        // canon's block flow is 種類 / 長さ / メモ. The lengths are multiples of
        // the store's own block step, so a block cannot be created at a
        // granularity the board would then refuse to move it at.
        blockLengths: [1, 2, 3, 6, 12].map((n) => n * planes.opsConfig.blockStepMin * 2),
        openLabel: hhmm(planes.operatingHours.open),
        closeLabel: hhmm(planes.operatingHours.close),
      },
      storeFront: {
        // canon's change list is コース / 店頭予約価格 / Reserve公開価格. The menu
        // is the one the slot's length actually buys — a slot that matches no
        // menu length says so rather than naming one it is not.
        slots: planes.sellSlots.map((s) => {
          const fits = menus.find((m) => m.duration_minutes === s.end - s.start) ?? null
          return {
            id: s.id,
            label: `${hhmm(s.start)}–${hhmm(s.end)} / ${staffName.get(s.staff_id) ?? '担当未定'} + ${resourceName.get(s.resource_id) ?? '設備未定'}`,
            menuName: fits ? fits.name : `${s.end - s.start}分（メニュー未設定）`,
            storePrice: yen(planes.pricingRule.base),
            publicPrice: yen(s.price_high),
          }
        }),
      },
      blocks: [...planes.blocks].map((b) => ({
        id: b.id,
        kind: b.kind,
        who: b.staff_id ? (staffName.get(b.staff_id) ?? '担当未定') : (resourceName.get(b.resource_id ?? '') ?? '設備'),
        whoLabel: b.staff_id ? '担当' : '設備',
        start: hhmm(b.start),
        end: hhmm(b.end),
        note: b.note,
      })),
    },
  }

  return <TodayScreen {...props} />
}
