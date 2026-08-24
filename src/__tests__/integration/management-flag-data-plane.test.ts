/**
 * 経営メンバー data plane (PR A) — the flag reaches every surface that will
 * consume it in PR B, and NOTHING behaves differently yet.
 *
 * Three contracts:
 *   1. Roster read — profiles.is_management maps to StaffMember.isManagement,
 *      fails OPEN (null / absent column → false), and synthesized synqed-only
 *      rows (no profiles row) carry false.
 *   2. DTO carry — every screen shape the pickers read from ACCEPTS the key.
 *      zod strips unknown keys silently, so an un-declared field would ship as
 *      a phone that never sees the flag; these parses are the guard.
 *   3. Inertness — buildAppointmentsScreen's rosters are byte-identical
 *      whether or not anyone is flagged. PR A must change no behavior.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

type ProfileRow = Record<string, unknown>
let profileRows: ProfileRow[] = []
let profileError: { message: string } | null = null

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'order']) builder[m] = () => builder
    ;(builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: profileRows, error: profileError })
    return { from: () => builder }
  },
}))

// Only reached when SYNQED_CORE_URL/API_KEY are set (the synthesized-row test).
const synqedStaffList = jest.fn(async () => ({ staff: [] as unknown[] }))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: class {
    staff = { list: (...a: unknown[]) => synqedStaffList(...(a as [])) }
  },
}))

import { staffListByBusiness } from '@/lib/staff'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { AppointmentsScreenDTO } from '@/lib/app-api/appointments-screen-dto'
import { SettingsScreenDTO } from '@/lib/app-api/settings-screen-dto'
import { CustomersScreenDTO } from '@/lib/app-api/customers-screen-dto'
import { SessionsScreenDTO } from '@/lib/app-api/sessions-screen-dto'
import { CustomerProfileScreenDTO } from '@/lib/app-api/customer-profile-screen-dto'

const BIZ = 'business-1'

function profile(over: ProfileRow = {}): ProfileRow {
  return {
    id: 'profile-1',
    full_name: '北野',
    created_at: '2026-01-01T00:00:00.000Z',
    display_role: 'STYLIST',
    position: null,
    email: 'kitano@example.jp',
    phone: null,
    avatar_url: null,
    pin_hash: null,
    customer_id: BIZ,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  profileRows = []
  profileError = null
  delete process.env.SYNQED_CORE_URL
  delete process.env.SYNQED_CORE_API_KEY
})

describe('roster read — profiles.is_management', () => {
  it('maps the column onto isManagement and drops the snake-case key', async () => {
    profileRows = [profile({ is_management: true })]
    const [row] = await staffListByBusiness(BIZ)
    expect(row.isManagement).toBe(true)
    expect(row).not.toHaveProperty('is_management')
  })

  it('fails OPEN: null column → false (a pre-migration row stays visible)', async () => {
    profileRows = [profile({ is_management: null })]
    expect((await staffListByBusiness(BIZ))[0].isManagement).toBe(false)
  })

  it('fails OPEN: absent column (pre-migration schema) → false', async () => {
    profileRows = [profile()]
    expect((await staffListByBusiness(BIZ))[0].isManagement).toBe(false)
  })

  it('synthesized synqed-only rows carry false — no profiles row to flag', async () => {
    process.env.SYNQED_CORE_URL = 'https://core.test'
    process.env.SYNQED_CORE_API_KEY = 'k'
    profileRows = []
    synqedStaffList.mockResolvedValueOnce({
      staff: [
        {
          id: 'sq-1',
          name: '中村 優子',
          role: 'STYLIST',
          email: 'yuko@example.jp',
          avatar_url: null,
          created_at: '2026-02-01T00:00:00.000Z',
          is_active: true,
          user_id: null,
        },
      ],
    })

    const roster = await staffListByBusiness(BIZ)
    expect(roster).toHaveLength(1)
    expect(roster[0]).toMatchObject({ id: 'sq-1', unlinked: true, isManagement: false })
  })
})

describe('DTO carry — the key survives every screen parse', () => {
  const staffMember = {
    id: 'profile-1',
    full_name: '北野',
    has_pin: false,
    created_at: '2026-01-01T00:00:00.000Z',
    isManagement: true,
  }

  it('settings screen staffList', () => {
    const parsed = SettingsScreenDTO.shape.staffList.parse([staffMember])
    expect(parsed[0].isManagement).toBe(true)
  })

  it('appointments screen staff (booking picker source)', () => {
    const parsed = AppointmentsScreenDTO.parse({
      view: 'day',
      selectedDateIso: '2026-08-18T00:00:00.000Z',
      staffFilter: 'all',
      staff: [{ id: 'p1', name: '北野', avatarInitials: 'KI', isManagement: true }],
      activeStaffId: null,
      authProfileId: null,
      customers: [],
      menus: [],
      reservationViews: [],
      reservationStaff: [],
      businessHours: { start: 10, end: 19 },
      weekData: null,
      weekStartIso: null,
      monthData: null,
      monthStartIso: null,
    })
    expect(parsed.staff[0].isManagement).toBe(true)
  })

  it('customers screen staffList (指名スタッフ picker source)', () => {
    const parsed = CustomersScreenDTO.parse({
      rows: [],
      totalRegistered: 0,
      selfStaffId: null,
      bookingDataAvailable: false,
      staffList: [{ id: 'p1', name: '北野', initials: '北', isManagement: true }],
      // Required since #710 split the 指名 picker roster out of staffList —
      // the assertion below is still on staffList's own carry of the flag.
      assignableStaff: [],
      burnByCustomer: null,
      burnUnpricedIds: [],
    })
    expect(parsed.staffList[0].isManagement).toBe(true)
  })

  it('customers screen assignableStaff (指名スタッフ picker source, D1)', () => {
    // F-9: toEqual the whole parsed row, not a single probed field — a
    // response-shape assertion should catch a stray/dropped sibling key too.
    const shape = CustomersScreenDTO.shape.assignableStaff
    expect(shape.parse([{ id: 'p1', name: '北野', isManagement: true }])).toEqual([
      { id: 'p1', name: '北野', isManagement: true },
    ])
  })

  it('sessions screen staffList (新規カルテ picker source)', () => {
    const parsed = SessionsScreenDTO.parse({
      items: [],
      placeholders: [],
      monthCount: 0,
      staffList: [{ id: 'p1', name: '北野', initials: '北', isManagement: true }],
      currentStaffId: null,
      customerOptions: [],
    })
    expect(parsed.staffList[0].isManagement).toBe(true)
    // PR-1b: total is a NEW field — a payload that predates it (this one)
    // must still parse, defaulting to 0 rather than undefined.
    expect(parsed.total).toBe(0)
  })

  it('customer-profile assignableStaff', () => {
    const shape = CustomerProfileScreenDTO.shape.assignableStaff
    expect(shape.parse([{ id: 'p1', name: '北野', isManagement: true }])[0].isManagement).toBe(
      true,
    )
  })
})

describe('inertness — PR A changes no roster behavior', () => {
  const staffList = [
    {
      id: 'p1',
      full_name: '佐藤 美咲',
      has_pin: false,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'p2',
      full_name: '北野',
      has_pin: false,
      created_at: '2026-01-02T00:00:00.000Z',
    },
  ]

  function build(
    isManagement: boolean,
    over: { activeStaffId?: string | null; storeStaffIds?: Set<string> | null } = {},
  ) {
    return buildAppointmentsScreen({
      locale: 'ja',
      now: new Date('2026-08-18T06:40:00.000Z'),
      selectedDate: new Date('2026-08-18T00:00:00+09:00'),
      staffFilter: 'all',
      staffList: staffList.map((s) =>
        s.id === 'p2' ? { ...s, isManagement } : { ...s, isManagement: false },
      ),
      activeStaffId: over.activeStaffId === undefined ? 'p1' : over.activeStaffId,
      storeStaffIds: over.storeStaffIds ?? null,
      orgSettings: null,
      customers: [],
      dayAppointments: [],
      weekRange: null,
      monthRange: null,
      weekRangeAppts: null,
      monthRangeAppts: null,
      enrichment: new Map(),
      packUsage: new Map(),
    })
  }

  // The PICKER roster is the half that must never move — it's the complete
  // array the 担当 view filter (StaffSelector) and the assignment pickers
  // both read, hiding client-side on their own terms (⚖ 2026-09-01 overturn
  // of Ⓒ: StaffSelector's default list now hides too; this array staying
  // complete is what lets its search still reveal everyone). The day-LANE
  // half is the one PR B deliberately changes; its rules live in
  // management-flag-lanes.test.ts.
  it('flagged and unflagged builds produce the same picker roster', () => {
    const off = build(false)
    const on = build(true)
    expect(on.staff.map((s) => s.id)).toEqual(off.staff.map((s) => s.id))
    expect(on.visibleActiveStaffId).toBe(off.visibleActiveStaffId)
  })

  it('the picker roster carries the flag (PR B hides client-side from it)', () => {
    expect(build(true).staff.find((s) => s.id === 'p2')?.isManagement).toBe(true)
  })

  // The pair above runs unclamped (storeStaffIds null), which is the EASY case.
  // The dangerous viewer is the one the store lens already nulled out: if the
  // flag ever grew a second clamp on visibleActiveStaffId, it would land here
  // first, and the lane rule's "self is always kept" leg would quietly re-admit
  // an id the store lens had just refused. (The lane list itself IS allowed to
  // move here — that is PR B's whole job; the picker roster and the clamp are
  // the halves the flag must never touch.)
  it('a store-clamped viewer keeps the same picker roster and a null clamp — flag on or off', () => {
    const clamp = {
      activeStaffId: 'p-outsider',
      storeStaffIds: new Set(['p1', 'p2']),
    }
    const off = build(false, clamp)
    const on = build(true, clamp)
    // ids, not whole rows: the flag itself RIDES the picker roster by design.
    expect(on.staff.map((s) => s.id)).toEqual(off.staff.map((s) => s.id))
    expect(on.visibleActiveStaffId).toBeNull()
    expect(off.visibleActiveStaffId).toBeNull()
    // The outsider is never smuggled into the lanes by either build.
    expect(on.reservationStaff.map((s) => s.id)).not.toContain('p-outsider')
    expect(off.reservationStaff.map((s) => s.id)).not.toContain('p-outsider')
  })
})
