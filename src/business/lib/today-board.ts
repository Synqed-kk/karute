// 今日の運営 — the board's derivations, in one pure module.
//
// WHY THIS IS NOT IN THE PAGE: every number the board shows has to agree with
// every other number (the nav badge, the 未解決 cell, the 次に決めること cell
// and the cards themselves are ONE count; 稼働率 and the calendar's free-slot
// numbers come from ONE pair of sums). That discipline is only checkable if the
// arithmetic can be called on its own, so it lives here and the page composes.
//
// Everything is DERIVED wherever a derivation exists (⚖ 8/9, product truth):
//   · a bed's 清掃 blocks come from the bookings on it plus the resource's own
//     turnaround rule — never a hand-placed list that could drift into a booking
//   · a booking's カテゴリー comes from the customer's tier, 回数券 balance and
//     visit history — only VIP is stored, because only VIP has no signal (T-12)
//   · an absent staff member's shift is cut at the absence, and a booking that
//     falls past the cut gets NO lane card: painting one would show the business
//     double-booking itself against an absence
//   · the day's money is summed from the same bookings the cards render
//
// Times are JST minutes from midnight throughout (see fixtures-today.ts).

import { jstDayKey, jstMinuteOfDay } from './clock'
import type { FixtureAppointment, FixtureCustomer, FixtureMenu, FixtureStaff } from './fixtures'
import type {
  FixtureAbsence,
  FixtureBlock,
  FixtureDecision,
  FixtureResource,
  FixtureSellSlot,
  FixtureShift,
} from './fixtures-today'

export type BookingCategory = 'new' | 'repeat' | 'ticket' | 'vip'

export interface Hours {
  open: number
  close: number
}

/** Percent placement on the timeline. The window is the store's open hours, so
 *  the hour ruler and the cards are the same axis by construction — canon's own
 *  sheet drew a 15-column ruler under 11 hours of cards, and the lines and the
 *  cards did not line up. */
export function place(start: number, end: number, hours: Hours): { x: number; w: number; startMin: number; endMin: number } {
  const span = hours.close - hours.open
  const from = Math.max(start, hours.open)
  const to = Math.min(end, hours.close)
  return {
    x: ((from - hours.open) / span) * 100,
    w: (Math.max(to - from, 0) / span) * 100,
    startMin: from,
    endMin: Math.max(to, from),
  }
}

/** place()'s inverse for the drag layer: a percent offset back to the minute it
 *  names. canon `minutesOf` (:3743) — rounded, because a card's percent is
 *  three decimals and 30-minute steps must land on whole minutes. */
export function minuteOf(x: number, hours: Hours): number {
  return Math.round(hours.open + (x / 100) * (hours.close - hours.open))
}

/** 店舗カテゴリー (F13 / E9h). Precedence is canon's legend order read as
 *  strongest-first: a VIP with a 回数券 is shown as VIP, and 新規 means no
 *  completed visit BEFORE today — a customer's first booking is still 新規 on
 *  the day of it. */
export function bookingCategory(customer: FixtureCustomer, priorVisits: number): BookingCategory {
  if (customer.vip) return 'vip'
  if ((customer.ticket_balance ?? 0) > 0) return 'ticket'
  return priorVisits > 0 ? 'repeat' : 'new'
}

/** The shift the staff member is actually available for, once today's absence
 *  is applied. Breaks that fall entirely past the cut go with it — a break in
 *  hours nobody is working is not a break. */
export function effectiveShift(shift: FixtureShift, absence: FixtureAbsence | null): FixtureShift {
  if (!absence || absence.staff_id !== shift.staff_id || absence.from >= shift.end) return shift
  const end = Math.max(shift.start, absence.from)
  return {
    ...shift,
    end,
    breaks: shift.breaks.filter((b) => b.start < end).map((b) => ({ start: b.start, end: Math.min(b.end, end) })),
  }
}

/** 清掃 windows on one resource: the turnaround after each booking, cut short
 *  by whatever comes next on the same bed and by closing time. A zero-length
 *  result is dropped rather than drawn — the bed genuinely has no gap there,
 *  and a 0-minute cleanup block is the impossible state, not the honest one. */
export function cleanupBlocks(
  bookings: Array<{ id: string; start: number; end: number }>,
  cleanupMinutes: number,
  hours: Hours,
): Array<{ id: string; start: number; end: number }> {
  const sorted = [...bookings].sort((a, b) => a.start - b.start)
  const out: Array<{ id: string; start: number; end: number }> = []
  for (let i = 0; i < sorted.length; i += 1) {
    const next = sorted[i + 1]
    const ceiling = Math.min(next ? next.start : hours.close, hours.close)
    const end = Math.min(sorted[i].end + cleanupMinutes, ceiling)
    if (end > sorted[i].end) out.push({ id: `${sorted[i].id}-cleanup`, start: sorted[i].end, end })
  }
  return out
}

/** 稼働率（施術スタッフ）— booked minutes over available minutes, counting only
 *  staff who can actually take a treatment (a receptionist is not idle
 *  capacity) and only the minutes they are on shift and not on a break. The
 *  absence has already shortened the denominator via `effectiveShift`. */
export function utilization(
  lanes: Array<{ bookedMinutes: number; availableMinutes: number; treats: boolean }>,
): { booked: number; available: number; percent: number } {
  const treating = lanes.filter((l) => l.treats)
  const booked = treating.reduce((n, l) => n + l.bookedMinutes, 0)
  const available = treating.reduce((n, l) => n + l.availableMinutes, 0)
  return {
    booked,
    available,
    percent: available === 0 ? 0 : Math.round((booked / available) * 1000) / 10,
  }
}

/** The minutes a shift leaves for treatment: length minus its breaks. */
export function availableMinutes(shift: FixtureShift): number {
  return shift.breaks.reduce((n, b) => n - Math.max(b.end - b.start, 0), Math.max(shift.end - shift.start, 0))
}

/** The money band (C1–C3) and the revenue KPI (K2), summed from the same rows
 *  the cards render. A 来店なし produced no service, so it is out of the day's
 *  total — canon's own formula, and the reason its no-show is excluded there
 *  but still counted in 本日の予約件数. */
export function dayTotals(
  bookings: FixtureAppointment[],
  refunds: number,
): { total: number; settled: number; awaiting: number; revenue: number; count: number } {
  const live = bookings.filter((b) => b.status !== 'cancelled')
  const earning = live.filter((b) => b.board_state !== 'noshow')
  return {
    total: earning.reduce((n, b) => n + (b.booked_price ?? 0), 0),
    settled: live.filter((b) => b.settlement === 'settled').length,
    awaiting: live.filter((b) => b.settlement === 'awaiting').length,
    revenue:
      live.filter((b) => b.settlement === 'settled').reduce((n, b) => n + (b.booked_price ?? 0), 0) - refunds,
    // 本日の予約件数 counts every status the day actually held, no-shows
    // included — the day had that many appointments, whatever came of them.
    count: live.length,
  }
}

/** A booking is suppressed from its staff lane when it starts after that staff
 *  member stopped working. It is not hidden: it is the thing 次に決めること is
 *  about, and the decision card carries it. */
export function suppressedByAbsence(
  booking: { staff_id: string | null; startMinute: number },
  absence: FixtureAbsence | null,
): boolean {
  return absence != null && booking.staff_id === absence.staff_id && booking.startMinute >= absence.from
}

/** Free capacity for one day, in hour-sized slots: the treatment minutes the
 *  roster leaves minus the minutes already booked. The calendar's per-day
 *  number and 稼働率 are the SAME two sums, so a day that reads 満 cannot also
 *  read as under-utilised. */
export function freeSlots(availableMin: number, bookedMin: number): number {
  return Math.max(Math.floor((availableMin - bookedMin) / 60), 0)
}

export function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

// ── the board model ────────────────────────────────────────────────────────

export interface BoardItem {
  key: string
  kind: 'booking' | 'break' | 'absence' | 'block' | 'cleanup'
  state: 'confirmed' | 'attention' | 'hold' | 'noshow' | null
  category: BookingCategory | null
  x: number
  w: number
  /** The same span in minutes. The board paints in percent, but the sell-layer
   *  derivation reasons in minutes, and inverting the percent back would fold a
   *  rounding error into every free-slot test. One value, both readings. */
  startMin: number
  endMin: number
  title: string
  /** 【ベッド2】 on a staff lane, 【見本 しろう】 on a resource lane, 【未定】
   *  when the booking has no resource — never a guess. */
  tag: string
  time: string
  ticketCat: string | null
  ticketCore: string | null
  /** 保持 — the price the booking was taken at survives a店都合 move. */
  held: boolean
  micro: boolean
  caseId: string | null
  label: string
}

export interface BoardLane {
  key: string
  group: 'staff' | 'beds'
  label: string
  sub: string
  absentNote: string | null
  mine: boolean
  items: BoardItem[]
  /** The window this lane can take work in today, after the absence has cut it
   *  — the sell layer's own bound and the 勤務時間内 check's. Null on a lane
   *  with no shift, and on resource lanes (a bed has no roster). */
  window: { from: number; until: number } | null
  /** canon's STAFF_UNTIL, as the clock string its check quotes. */
  untilLabel: string | null
  /** 定価 before the store's lever and the hour curve; 0 where the lane takes
   *  no treatments (reception) or is not a staff lane. */
  listPrice: number
  /** Which stores this lane belongs to. `null` = every store (a floating staff
   *  member). The sell layer will not pair a person with a bed outside their
   *  own stores — under viewAll that would advertise a window no store can
   *  actually run. */
  stores: string[] | null
}

export interface BoardBooking {
  id: string
  displayNo: string
  customerId: string
  customerName: string
  staffId: string | null
  staffName: string
  menuName: string
  resourceId: string | null
  resourceName: string
  startMinute: number
  endMinute: number
  timeRange: string
  price: number | null
  category: BookingCategory
  state: 'confirmed' | 'attention' | 'hold' | 'noshow'
  settlement: 'settled' | 'awaiting' | null
  source: string
  reassignedFromName: string | null
  ticketBalance: number | null
  takenDaysAgo: number
  updatedMinute: number | null
  onBoard: boolean
}

export interface BuildInput {
  appointments: FixtureAppointment[]
  customers: FixtureCustomer[]
  menus: FixtureMenu[]
  staff: FixtureStaff[]
  resources: FixtureResource[]
  shifts: FixtureShift[]
  qualifications: Record<string, string[]>
  /** 定価 per staff member — the dynamic-pricing curve's input. */
  staffListPrice: Record<string, number>
  /** Which stores each staff member works in; `null` = floating. */
  staffStores: Record<string, string[] | null>
  absence: FixtureAbsence | null
  blocks: FixtureBlock[]
  sellSlots: FixtureSellSlot[]
  decisions: FixtureDecision[]
  hours: Hours
  /** The day being shown, as a JST day index (clock.jstDayKey). */
  dayKey: number
  operatorStaffId: string
  storeNames: Map<string, string>
  /** true = viewAll; a clamped lens must not label lanes with a store name. */
  crossStore: boolean
}

const CATEGORY_LABEL: Record<BookingCategory, string> = {
  new: '新規',
  repeat: '再来',
  ticket: '回数券',
  vip: 'VIP',
}

/** Every booking on the day, with the joins the board needs and its category
 *  resolved. `onBoard` is the absence rule; the row itself always exists. */
export function dayBookings(input: BuildInput): BoardBooking[] {
  const customerById = new Map(input.customers.map((c) => [c.id, c]))
  const menuById = new Map(input.menus.map((m) => [m.id, m]))
  const staffById = new Map(input.staff.map((s) => [s.id, s]))
  const resourceById = new Map(input.resources.map((r) => [r.id, r]))

  // Visits BEFORE the day being shown — what makes a customer 新規 or 再来.
  const priorVisits = new Map<string, number>()
  for (const a of input.appointments) {
    if (a.status !== 'done' || jstDayKey(a.starts_at) >= input.dayKey) continue
    priorVisits.set(a.customer_id, (priorVisits.get(a.customer_id) ?? 0) + 1)
  }

  return input.appointments
    .filter((a) => jstDayKey(a.starts_at) === input.dayKey && a.board_state !== null)
    .map((a) => {
      const customer = customerById.get(a.customer_id)
      const startMinute = jstMinuteOfDay(a.starts_at)
      const endMinute = jstMinuteOfDay(a.ends_at)
      const resource = a.resource_id ? resourceById.get(a.resource_id) : undefined
      return {
        id: a.id,
        displayNo: a.display_no,
        customerId: a.customer_id,
        customerName: customer?.name ?? '顧客未登録',
        staffId: a.staff_id,
        staffName: a.staff_id ? (staffById.get(a.staff_id)?.full_name ?? '担当未定') : '担当未定',
        menuName: a.menu_id ? (menuById.get(a.menu_id)?.name ?? 'メニュー未設定') : 'メニュー未設定',
        resourceId: a.resource_id,
        resourceName: resource?.name ?? '未定',
        startMinute,
        endMinute,
        timeRange: `${hhmm(startMinute)}–${hhmm(endMinute)}`,
        price: a.booked_price,
        category: customer
          ? bookingCategory(customer, priorVisits.get(a.customer_id) ?? 0)
          : 'repeat',
        state: a.board_state!,
        settlement: a.settlement,
        source: a.source,
        reassignedFromName: a.reassigned_from
          ? (staffById.get(a.reassigned_from)?.full_name ?? '担当未定')
          : null,
        ticketBalance: customer?.ticket_balance ?? null,
        takenDaysAgo: a.taken_days_ago,
        updatedMinute: a.updated_minute,
        onBoard: !suppressedByAbsence({ staff_id: a.staff_id, startMinute }, input.absence),
      }
    })
    .sort((a, b) => a.startMinute - b.startMinute)
}

/** The ticket/price chip canon puts on every card (F12): the category word,
 *  then the fact that matters for that category. A 回数券 booking shows what is
 *  left, never a price it does not charge. */
function chip(b: BoardBooking): { cat: string | null; core: string | null } {
  if (b.category === 'ticket') return { cat: '回数券', core: b.ticketBalance == null ? '残数未記録' : `残り${b.ticketBalance}回` }
  if (b.category === 'vip') return { cat: 'VIP', core: '月額' }
  if (b.category === 'new') return { cat: null, core: b.price == null ? '新規 価格未記録' : `新規 ${yen(b.price)}` }
  return { cat: '単発', core: b.price == null ? '価格未記録' : yen(b.price) }
}

function bookingItem(b: BoardBooking, hours: Hours, tag: string, keySuffix: string): BoardItem {
  const c = chip(b)
  return {
    key: `${b.id}-${keySuffix}`,
    kind: 'booking',
    state: b.state,
    category: b.category,
    ...place(b.startMinute, b.endMinute, hours),
    title: b.customerName,
    tag: `【${tag}】`,
    time: `${hhmm(b.startMinute)}〜`,
    ticketCat: c.cat,
    ticketCore: c.core,
    held: b.reassignedFromName != null,
    micro: false,
    caseId: b.id,
    label: `${b.timeRange} ${b.customerName}様 / ${CATEGORY_LABEL[b.category]} / ${b.staffName} / ${b.resourceName} / ${STATE_LABEL[b.state]}`,
  }
}

export const STATE_LABEL: Record<NonNullable<BoardBooking['state']>, string> = {
  confirmed: '確定・施術',
  attention: '要対応',
  hold: '仮押さえ',
  noshow: '来店なし',
}

/** Staff lanes then resource lanes, in canon's two groups. */
export function buildLanes(input: BuildInput, bookings: BoardBooking[]): BoardLane[] {
  const { hours, absence } = input
  const shiftByStaff = new Map(input.shifts.map((s) => [s.staff_id, s]))
  const lanes: BoardLane[] = []

  for (const member of input.staff) {
    const raw = shiftByStaff.get(member.id) ?? null
    const shift = raw ? effectiveShift(raw, absence) : null
    const quals = input.qualifications[member.id] ?? []
    const mine = bookings.filter((b) => b.staffId === member.id)
    const items: BoardItem[] = []

    for (const b of mine) {
      if (!b.onBoard) continue
      items.push(bookingItem(b, hours, b.resourceName, 'staff'))
    }
    for (const br of raw?.breaks ?? []) {
      items.push({
        key: `${member.id}-break-${br.start}`,
        kind: 'break', state: null, category: null,
        ...place(br.start, br.end, hours),
        title: '休憩', tag: '', time: `${hhmm(br.start)}〜${hhmm(br.end)}`,
        ticketCat: null, ticketCore: null, held: false, micro: false, caseId: null,
        label: `${member.full_name}、${hhmm(br.start)}から${hhmm(br.end)}、休憩`,
      })
    }
    for (const blk of input.blocks.filter((x) => x.staff_id === member.id)) {
      items.push({
        key: blk.id,
        kind: 'block', state: null, category: null,
        ...place(blk.start, blk.end, hours),
        title: blk.kind, tag: '', time: `${hhmm(blk.start)}〜${hhmm(blk.end)}`,
        ticketCat: null, ticketCore: null, held: false, micro: blk.micro, caseId: null,
        label: `${member.full_name}、${hhmm(blk.start)}から${hhmm(blk.end)}、${blk.kind}・予約不可`,
      })
    }
    if (absence && absence.staff_id === member.id) {
      items.push({
        key: `${member.id}-absence`,
        kind: 'absence', state: null, category: null,
        ...place(absence.from, hours.close, hours),
        title: '勤務不可', tag: '', time: `${hhmm(absence.from)}〜閉店`,
        ticketCat: null, ticketCore: null, held: false, micro: false, caseId: null,
        label: `${member.full_name}、${hhmm(absence.from)}以降 勤務不可`,
      })
    }
    // The hours OUTSIDE the shift are painted too (canon's 終業 block). Without
    // them a lane whose shift ends at 17:00 looks bookable until closing, and
    // the board's whole job is to show what can and cannot be placed. The
    // absence already paints its own tail, so it is not drawn twice.
    //
    // These are `absence`, not `block`: canon builds them out of the SAME hatch
    // grammar as 勤務不可 (fable-store-today.html renderShiftEndBounds — "reuses
    // the SAME hatch grammar .event.absence already uses for 勤務不可"), so they
    // read as the red "there is no shop floor here" wash, never the beige 予定
    // ブロック card. The kind also carries canon's interaction: a shift-derived
    // wash is a role="note" nobody can open, so it must not raise ブロック情報.
    // Occupancy is unaffected — laneSpans() reads every item whatever its kind.
    const offShift: Array<{ title: string; from: number; to: number; time: string; label: string }> = shift
      ? [
          ...(shift.start > hours.open
            ? [
                {
                  title: '勤務前', from: hours.open, to: shift.start,
                  time: `開店〜${hhmm(shift.start)}`,
                  label: `${member.full_name}、${hhmm(shift.start)}開始のため、それより前は予約不可`,
                },
              ]
            : []),
          ...(shift.end < hours.close && !(absence && absence.staff_id === member.id)
            ? [
                {
                  title: '終業', from: shift.end, to: hours.close,
                  time: `${hhmm(shift.end)}〜閉店`,
                  label: `${member.full_name}、${hhmm(shift.end)}以降、終業のため予約不可`,
                },
              ]
            : []),
        ]
      : [
          // ponytail: canon's fixture is fully staffed, so it has no no-shift lane
          // and no wording to copy. Built's own sentence stays; only the paint moves.
          {
            title: '本日勤務なし', from: hours.open, to: hours.close,
            time: `${hhmm(hours.open)}〜${hhmm(hours.close)}`,
            label: `${member.full_name}、${hhmm(hours.open)}から${hhmm(hours.close)}、本日勤務なし・予約不可`,
          },
        ]
    for (const off of offShift) {
      items.push({
        key: `${member.id}-off-${off.from}`,
        kind: 'absence', state: null, category: null,
        ...place(off.from, off.to, hours),
        title: off.title, tag: '', time: off.time,
        ticketCat: null, ticketCore: null, held: false, micro: false, caseId: null,
        label: off.label,
      })
    }

    lanes.push({
      key: member.id,
      group: 'staff',
      label: member.full_name,
      sub: shift
        ? `${quals.join('・') || '資格未登録'} / ${hhmm(shift.end)}まで`
        : '本日シフトなし',
      absentNote: absence && absence.staff_id === member.id ? `${hhmm(absence.from)}以降 勤務不可` : null,
      mine: member.id === input.operatorStaffId,
      items: items.sort((a, b) => a.x - b.x),
      window: shift ? { from: shift.start, until: shift.end } : null,
      untilLabel: shift ? hhmm(shift.end) : null,
      listPrice: input.staffListPrice[member.id] ?? 0,
      stores: input.staffStores[member.id] ?? null,
    })
  }

  for (const resource of input.resources) {
    const on = bookings.filter((b) => b.resourceId === resource.id && b.onBoard)
    const items: BoardItem[] = on.map((b) => bookingItem(b, hours, b.staffName, 'bed'))
    for (const c of cleanupBlocks(
      on.map((b) => ({ id: b.id, start: b.startMinute, end: b.endMinute })),
      resource.cleanup_minutes,
      hours,
    )) {
      items.push({
        key: c.id,
        kind: 'cleanup', state: null, category: null,
        ...place(c.start, c.end, hours),
        title: '清掃', tag: '', time: `${hhmm(c.start)}〜`,
        ticketCat: null, ticketCore: null, held: false, micro: c.end - c.start <= 20, caseId: null,
        label: `${resource.name}、${hhmm(c.start)}から${hhmm(c.end)}、清掃・予約不可`,
      })
    }
    for (const blk of input.blocks.filter((x) => x.resource_id === resource.id)) {
      items.push({
        key: blk.id,
        kind: 'block', state: null, category: null,
        ...place(blk.start, blk.end, hours),
        title: blk.kind, tag: '', time: `${hhmm(blk.start)}〜${hhmm(blk.end)}`,
        ticketCat: null, ticketCore: null, held: false, micro: blk.micro, caseId: null,
        label: `${resource.name}、${hhmm(blk.start)}から${hhmm(blk.end)}、${blk.kind}・予約不可`,
      })
    }
    lanes.push({
      key: resource.id,
      group: 'beds',
      label: resource.name,
      // Under viewAll the store has to be on the label or two 「ベッド1」 rows
      // read as one bed; under a clamped lens no other store's name may appear.
      sub: input.crossStore
        ? `${resource.note} / ${input.storeNames.get(resource.store_id) ?? '店舗未設定'}`
        : resource.note,
      absentNote: null,
      mine: false,
      items: items.sort((a, b) => a.x - b.x),
      window: null,
      untilLabel: null,
      listPrice: 0,
      stores: [resource.store_id],
    })
  }

  return lanes
}

/** Per-lane minute sums — the one pair of numbers behind 稼働率 AND the
 *  calendar's free-slot count. */
export function laneMinutes(input: BuildInput, bookings: BoardBooking[]) {
  const shiftByStaff = new Map(input.shifts.map((s) => [s.staff_id, s]))
  return input.staff.map((member) => {
    const raw = shiftByStaff.get(member.id)
    const shift = raw ? effectiveShift(raw, input.absence) : null
    return {
      staffId: member.id,
      treats: (input.qualifications[member.id] ?? []).some((q) => q !== '受付' && q !== '会計'),
      availableMinutes: shift ? availableMinutes(shift) : 0,
      bookedMinutes: bookings
        .filter((b) => b.staffId === member.id && b.state !== 'noshow')
        .reduce((n, b) => n + (b.endMinute - b.startMinute), 0),
    }
  })
}

/** The count that has to be the same number in four places: the nav badge, the
 *  未解決 cell, the 次に決めること cell, and the cards on the board. Only
 *  `open` decisions count — the list dialog keeps the rest as history, exactly
 *  as canon's own guardrail says. */
export function openDecisions(decisions: FixtureDecision[]): FixtureDecision[] {
  return decisions.filter((d) => d.state === 'open')
}
