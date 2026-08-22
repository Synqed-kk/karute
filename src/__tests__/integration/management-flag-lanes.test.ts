/**
 * 経営メンバー — the day-grid lane rule (PR B), the ONLY server-side removal
 * this feature makes.
 *
 * A flagged member's lane disappears on days they have nothing on, and comes
 * back the moment they have ANY booking — cancelled and no-show included
 * (Liam ruling Ⓑ: hiding the lane would make a same-day cancellation vanish
 * from the grid, which is exactly when the salon needs to see it).
 *
 * Everything else must stay complete:
 *   - `staff` (the 担当 view filter + the booking picker's source) keeps every
 *     member — the combobox hides them client-side, the filter never does
 *     (Liam ruling Ⓒ).
 *   - the store lens is still the outer boundary: the lane rule is a FILTER on
 *     the already-store-scoped list, never a union back over the raw roster.
 *   - staff colors come from the store-scoped visibleStaff roster (one level
 *     up from the lane list, NOT the business-wide roster — see screen.ts's
 *     own colorRosterIds comment), so flipping the toggle never repaints the
 *     store.
 */

// list-enrich (pulled in by the customers builder) imports @synqed-kk/client
// for real; it ships ESM jest can't parse. Nothing here reaches the client.
jest.mock('@synqed-kk/client', () => ({ SynqedClient: class {} }))
jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { buildCustomersListScreen } from '@/lib/customers/screen-rows'
import { buildSessionsListScreen } from '@/lib/karute/screen-rows'
import type { AppointmentRow } from '@/actions/appointments'
import type { StaffMember } from '@/lib/staff'

const SATO = 'p-sato'
const KITANO = 'p-kitano' // 経営メンバー
const DAIKANYAMA_STAFF = 'p-other-store'

function member(id: string, name: string, isManagement = false): StaffMember {
  return {
    id,
    full_name: name,
    has_pin: false,
    created_at: '2026-01-01T00:00:00.000Z',
    isManagement,
  }
}

const ROSTER: StaffMember[] = [
  member(SATO, '佐藤 美咲'),
  member(KITANO, '北野', true),
  member(DAIKANYAMA_STAFF, '代官山 太郎'),
]

function booking(staffProfileId: string, status = 'CONFIRMED'): AppointmentRow {
  return {
    id: `appt-${staffProfileId}-${status}`,
    staff_profile_id: staffProfileId,
    client_id: 'cust-1',
    start_time: '2026-08-18T02:00:00.000Z',
    duration_minutes: 60,
    title: null,
    notes: null,
    karute_record_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
    customers: { name: '山口 恵' },
    synqed_status: status,
    source: 'MANUAL',
    status_reason: null,
    status_set_by_name: null,
    status_set_at: null,
  } as unknown as AppointmentRow
}

function build(over: {
  dayAppointments?: AppointmentRow[]
  activeStaffId?: string | null
  storeStaffIds?: Set<string> | null
  staffList?: StaffMember[]
  staffFilter?: string
} = {}) {
  return buildAppointmentsScreen({
    locale: 'ja',
    now: new Date('2026-08-18T06:40:00.000Z'),
    selectedDate: new Date('2026-08-18T00:00:00+09:00'),
    staffFilter: over.staffFilter ?? 'all',
    staffList: over.staffList ?? ROSTER,
    activeStaffId: over.activeStaffId ?? SATO,
    // `null` is a MEANINGFUL value here (no store lens / fail open), so it must
    // not fall through to the default — check for the key, not for nullish.
    storeStaffIds:
      over.storeStaffIds === undefined ? new Set([SATO, KITANO]) : over.storeStaffIds,
    orgSettings: null,
    customers: [],
    dayAppointments: over.dayAppointments ?? [],
    weekRange: null,
    monthRange: null,
    weekRangeAppts: null,
    monthRangeAppts: null,
    enrichment: new Map(),
    packUsage: new Map(),
  })
}

const laneIds = (s: ReturnType<typeof build>) => s.reservationStaff.map((r) => r.id)

describe('day lanes — 経営メンバー', () => {
  it('idle day: the lane is gone', () => {
    expect(laneIds(build())).toEqual([SATO])
  })

  it('a booking that day brings the lane back', () => {
    expect(laneIds(build({ dayAppointments: [booking(KITANO)] }))).toEqual([SATO, KITANO])
  })

  it('a CANCELLED-only day still shows the lane (ruling Ⓑ — the tombstone must be visible)', () => {
    expect(laneIds(build({ dayAppointments: [booking(KITANO, 'CANCELLED')] }))).toContain(
      KITANO,
    )
  })

  it('a NO_SHOW-only day still shows the lane (ruling Ⓑ)', () => {
    expect(laneIds(build({ dayAppointments: [booking(KITANO, 'NO_SHOW')] }))).toContain(
      KITANO,
    )
  })

  it('the viewer keeps their OWN lane even when they are the 経営メンバー', () => {
    expect(laneIds(build({ activeStaffId: KITANO }))).toEqual([SATO, KITANO])
  })

  it('unflagged staff are untouched by the rule', () => {
    expect(laneIds(build({ staffList: [member(SATO, '佐藤 美咲')] }))).toEqual([SATO])
  })

  it('fails OPEN: a roster row with no flag at all stays in the lanes', () => {
    const noFlag = { ...member(KITANO, '北野') } as StaffMember
    delete noFlag.isManagement
    expect(laneIds(build({ staffList: [member(SATO, '佐藤 美咲'), noFlag] }))).toEqual([
      SATO,
      KITANO,
    ])
  })
})

describe('store isolation still wins — filter, never union', () => {
  it("another store's staff never appears, booked or not", () => {
    const screen = build({
      dayAppointments: [booking(DAIKANYAMA_STAFF), booking(KITANO)],
    })
    expect(laneIds(screen)).not.toContain(DAIKANYAMA_STAFF)
    expect(laneIds(screen)).toEqual([SATO, KITANO])
  })

  it("a management viewer pinned outside their store gets no lane smuggled in", () => {
    const screen = build({
      activeStaffId: DAIKANYAMA_STAFF,
      storeStaffIds: new Set([SATO, KITANO]),
    })
    expect(laneIds(screen)).toEqual([SATO])
  })
})

describe('view filters + pickers stay complete (ruling Ⓒ)', () => {
  it('screen.staff lists 経営メンバー — the 担当 filter must still offer them', () => {
    const screen = build()
    expect(screen.staff.map((s) => s.id)).toEqual([SATO, KITANO])
    expect(screen.staff.find((s) => s.id === KITANO)?.isManagement).toBe(true)
  })

  it('the flag never touches visibleActiveStaffId — no second clamp needed (T1)', () => {
    // A management viewer's own id survives, so the booking dialog's seed is
    // always an id the picker can show. Only the STORE lens may null it.
    expect(build({ activeStaffId: KITANO }).visibleActiveStaffId).toBe(KITANO)
    expect(build({ activeStaffId: DAIKANYAMA_STAFF }).visibleActiveStaffId).toBeNull()
  })

  it('the booking-dialog seed is always present in the picker roster', () => {
    const screen = build({ activeStaffId: KITANO })
    const seed = screen.visibleActiveStaffId ?? screen.staff[0]?.id ?? null
    expect(screen.staff.some((s) => s.id === seed)).toBe(true)
  })
})

// The 顧客 and カルテ screens have no lane rule at all — their rosters feed
// both a view filter and an assignment picker, and only the picker (the
// combobox, client-side) hides anyone. If a server filter ever creeps in here,
// "show me just 北野's day" dies with it.
describe('顧客 / カルテ rosters are never server-filtered (ruling Ⓒ)', () => {
  it('customers list screen keeps 経営メンバー in its roster, flag attached', () => {
    const screen = buildCustomersListScreen({
      list: { customers: [], total: 0 } as unknown as Parameters<
        typeof buildCustomersListScreen
      >[0]['list'],
      staffList: ROSTER,
      locale: 'ja',
      lastVisitStrings: {
        noVisits: '',
        today: '',
        oneDayAgo: '',
        daysAgo: () => '',
        monthsAgo: () => '',
      },
      enrichment: new Map(),
      packUsage: new Map(),
      lifecycles: new Map(),
      ticketPacksEnabled: true,
    })
    expect(screen.staffList.map((s) => s.id)).toEqual([SATO, KITANO, DAIKANYAMA_STAFF])
    expect(screen.staffList.find((s) => s.id === KITANO)?.isManagement).toBe(true)
  })

  it('カルテ list screen keeps them too (store lens still applies)', () => {
    const screen = buildSessionsListScreen({
      staffList: ROSTER,
      storeStaffIds: new Set([SATO, KITANO]),
      allCustomersList: { customers: [], total: 0 } as unknown as Parameters<
        typeof buildSessionsListScreen
      >[0]['allCustomersList'],
      storeCustomerList: null,
      currentStaffId: SATO,
      synqedKaruteRows: [],
      apptList: { appointments: [] } as unknown as Parameters<
        typeof buildSessionsListScreen
      >[0]['apptList'],
      synqedStaff: { staff: [] } as unknown as Parameters<
        typeof buildSessionsListScreen
      >[0]['synqedStaff'],
    })
    expect(screen.staffList.map((s) => s.id)).toEqual([SATO, KITANO])
    expect(screen.staffList.find((s) => s.id === KITANO)?.isManagement).toBe(true)
  })
})

describe('colors do not move when the toggle flips', () => {
  it('the palette source is the STORE roster — stable across a flip, no cross-store ids', () => {
    const flagged = build()
    const unflagged = build({
      staffList: ROSTER.map((s) => ({ ...s, isManagement: false })),
    })
    // Stability: the toggle moves the LANES, never the palette, so nobody in
    // the store gets repainted when 北野 is flagged.
    expect(flagged.colorRosterIds).toEqual(unflagged.colorRosterIds)
    expect(flagged.colorRosterIds).toEqual([SATO, KITANO])
    // …and it is NOT the (now shorter) lane list, which is what would repaint.
    expect(flagged.colorRosterIds.length).toBeGreaterThan(flagged.reservationStaff.length)
    // Isolation: this array ships to the client. Another store's staff id must
    // not ride out on the palette (store-isolation law — hide, never reveal).
    expect(flagged.colorRosterIds).not.toContain(DAIKANYAMA_STAFF)
  })

  it('an unclamped (single-store) tenant still gets the whole roster', () => {
    expect(build({ storeStaffIds: null }).colorRosterIds).toEqual([
      SATO,
      KITANO,
      DAIKANYAMA_STAFF,
    ])
  })
})

// Ⓒ says the 担当 view filter must keep OFFERING management members. Offering a
// name that then renders an empty grid is the same dead end as not offering it.
describe('filtering 担当 to a management member shows their lane', () => {
  it('an idle 経営メンバー gets their (empty) lane back when explicitly filtered to', () => {
    const screen = build({ staffFilter: KITANO })
    expect(laneIds(screen)).toContain(KITANO)
    expect(screen.reservationViews).toEqual([])
  })

  it('the store lens still outranks the filter — an outside id gets no lane', () => {
    expect(laneIds(build({ staffFilter: DAIKANYAMA_STAFF }))).toEqual([SATO])
  })
})
