// Fixture data for the fit harness — shaped for the WORST fit, never real
// data: 4-digit すべて counts, 2–3 digit counts on every other word, the 共有
// word present, and the longest staff name the pickers can show. The app's
// own fixtures carry no staff name longer than 2 characters in its family
// part (staff-selector.test.tsx: 原田 かなみ / 浜野), so the packet's
// 4-character family name 勅使河原 is used (full name 勅使河原 さくら — the カルテ
// chip prints the full name, the two-segment control the family name).
import type { KaruteListItem } from '@/components/karute/spike-lifted/list/types'
import type { CustomerListRow } from '@/components/customers/redesign/types'
import type { ReservationView } from '@/lib/adapters/reservation-view'
import { capacityRowFields, type WeekDayRowData } from '@/lib/adapters/reservation'

export const SELF_ID = 'staff-self'
export const LONG_ID = 'staff-long'

export const STAFF = [
  { id: SELF_ID, name: '佐藤 美咲', initials: '佐藤' },
  { id: LONG_ID, name: '勅使河原 さくら', initials: '勅使' },
  { id: 'staff-3', name: '鈴木 友梨佳', initials: '鈴木' },
  { id: 'staff-4', name: '篠原 夢果', initials: '篠原' },
]

/** S46 option C proof (staff-control-c.mjs, `&roster=wide` on the カルテ
 *  tab): + an 8-character name registered without a space — familyName()
 *  keeps all 8, the widest Japanese label the control can print (S45's
 *  c-measure staff-8). */
export const WIDE_ROSTER = [...STAFF, { id: 'staff-8', name: '勘解由小路美和子', initials: '勘解' }]

// JST today at the harness clock (the page reads the real clock; fixture
// dates are relative so 今週 always has rows).
function ymd(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(d)
}

// `n` / `firstVisit`: the defaults are the S44 set (96 rows, the 新規 field
// unread — null). The 新規-chip-ON cases (run.mjs, `?shinki=on`) pass a
// larger set with every row 新規, so the chip prints its widest realistic
// tally (3 digits in every staff state) — worst fit, like the other counts.
export function karuteItems(n = 96, firstVisit: boolean | null = null): KaruteListItem[] {
  const out: KaruteListItem[] = []
  for (let i = 0; i < n; i++) {
    const staff = STAFF[i % STAFF.length]
    const aiStatus = i % 5 === 0 ? 'pending' : i % 7 === 0 ? 'draft' : i % 11 === 0 ? 'draft' : 'summarized'
    out.push({
      id: `k${i}`,
      customerId: `c${i}`,
      customerName: `顧客 ${i}`,
      customerInitials: '顧',
      customerKaruteNumber: `#${String(100 + i).padStart(5, '0')}`,
      date: ymd(i % 13),
      weekday: '月',
      service: 'カット',
      duration: 60,
      staffId: staff.id,
      staffColorKey: null,
      staffName: staff.name,
      summary: '主訴:肩のこり',
      aiStatus,
      conversionStatus: 'active',
      isDiscarded: i % 9 === 0,
      isShared: i % 6 === 0,
      companyFirstVisit: firstVisit,
      href: `/karute/k${i}`,
    })
  }
  return out
}

/** The owner of the 新規 rows for a page's `s` param: 自分 = the viewer, a
 *  staff id = that staffer, anything else (全スタッフ) = spread (null). */
export function shinkiOwner(s: string | null): string | null {
  if (s === 'self') return SELF_ID
  return s && s !== 'all' ? s : null
}

/** S46 LEG 1b (shinki-on-c.mjs, `?shinki=<N>`): the S44 rows with 新規 =
 *  false (core answered "not a first visit") + EXACTLY `n` 新規 rows the chip
 *  counts under the page's pick — owned by `owner` (a staff id on
 *  WIDE_ROSTER), or spread over STAFF when the pick is 全スタッフ (null). Every
 *  新規 row is live (not discarded, not shared) so the default すべて view counts
 *  them all. `month` ('YYYY-MM', the harness month read) dates every row
 *  inside that month; without it the dates are relative to the clock like the
 *  S44 set. */
export function karuteShinkiItems(n: number, owner: string | null, month?: string): KaruteListItem[] {
  const day = (i: number) => (month ? `${month}-${String(1 + (i % 28)).padStart(2, '0')}` : ymd(i % 13))
  const tag = month ? `${month}-` : ''
  const base = karuteItems(96, false).map((it, i) => ({ ...it, id: `${tag}${it.id}`, date: day(i) }))
  const out: KaruteListItem[] = [...base]
  for (let i = 0; i < n; i++) {
    const staff = owner ? WIDE_ROSTER.find((s) => s.id === owner)! : STAFF[i % STAFF.length]
    out.push({
      ...base[i % base.length],
      id: `${tag}n${i}`,
      customerId: `cn${i}`,
      customerName: `新規客 ${i}`,
      date: day(i),
      staffId: staff.id,
      staffName: staff.name,
      aiStatus: 'summarized',
      isDiscarded: false,
      isShared: false,
      companyFirstVisit: true,
      href: `/karute/${tag}n${i}`,
    })
  }
  return out
}

export function customerRows(): CustomerListRow[] {
  const out: CustomerListRow[] = []
  const now = Date.now()
  for (let i = 0; i < 1234; i++) {
    const staff = STAFF[i % STAFF.length]
    const status = i % 10 === 0 ? 'needs-followup' : i % 4 === 0 ? 'dormant' : i % 37 === 0 ? 'new' : 'on-track'
    out.push({
      id: `cu${i}`,
      name: `顧客 ${i}`,
      initials: '顧',
      karuteNumber: `#${String(i).padStart(5, '0')}`,
      age: 30,
      gender: null,
      joinDate: '2026/09/01',
      joinDateIso: new Date(now - (i % 20) * 86_400_000).toISOString(),
      lastVisitDate: '9/01',
      lastVisitAgo: '26日前',
      aiPredict: { label: '', when: '' },
      status,
      preferredStaffId: staff.id,
      preferredStaffName: staff.name,
      totalKarute: 3,
      phone: null,
      pack: i % 3 === 0 ? { remaining: (i % 3) + 1, size: 10, unconsumed: 12000 } : null,
      nextBookingDate: i % 2 === 0 ? '10/01' : null,
    })
  }
  return out
}

export function dayTotals(dateIso: string): WeekDayRowData {
  return {
    dateNumber: 27,
    monthNumber: 9,
    weekdayLabel: '日',
    isToday: true,
    count: 14,
    bookedMinutes: 690,
    availableMinutes: 4140,
    newCustomerCount: 1,
    remindersPending: 0,
    consentPending: 0,
    unconfirmed: 0,
    visibleBookings: [],
    hiddenCount: 0,
    dateIso,
    capacityDefensible: false,
    hoursSaved: false,
    closed: false,
    cancelledCount: 0,
    noShowDayCount: 0,
    ...capacityRowFields(undefined),
    returningCount: 13,
  }
}

export function reservationViews(): ReservationView[] {
  return [0, 1, 2, 3].map(
    (i) =>
      ({
        id: `r${i}`,
        staffId: STAFF[i % STAFF.length].id,
        staffName: STAFF[i % STAFF.length].name,
        startTimeHm: `${10 + i * 2}:00`,
        durationMin: 90,
        customerName: `顧客 ${i}`,
        customerInitials: '顧',
        karuteNumber: `#0036${i}`,
        service: 'サブスク月1',
        displayStatus: 'booked',
        isCancelled: false,
        isNoShow: false,
        statusReason: null,
        statusSetByName: null,
        statusSetAt: null,
        staffColorKey: 'neutral',
        clientId: `c${i}`,
        karuteRecordId: null,
        isFirstTimeVisit: false,
        pack: null,
        needsRenewal: false,
        noShowCount: 0,
      }) as unknown as ReservationView,
  )
}
