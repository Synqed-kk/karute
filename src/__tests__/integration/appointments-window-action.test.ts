/**
 * ⚖ THE WEB DOOR TO THE 予約 NUMBERS — getAppointmentWindow.
 *
 * `getAppointmentsInRange`, the action this one replaced, has its store clamp
 * pinned by appointments-store-scope.test.ts ("the Apple-review account:
 * frontdesk, 銀座-only, saw the 代官山 agenda"). After PKT-1a that action has
 * zero production callers and this one carries all the week/month/day traffic —
 * with no test of its own. The blind round proved it: inverting the
 * unplaceable-filter branch here, which turns one stylist's 自分 week into the
 * whole salon's, survived all 616 suites (L2 BLOCKER, L5 F3/F5).
 *
 * So: the clamp, the filter's fail-closed direction, the failure contract, and
 * the rule that the VIEWER's id is resolved server-side, never taken from the
 * caller (L5 F1).
 *
 * Pinned to TZ=UTC to mirror the deploy runtime.
 */
process.env.TZ = 'UTC'

const GINZA = 'store-ginza'
const VIEWER_PROFILE = 'profile-viewer'
const VIEWER_CORE = 'core-viewer'
const COLLEAGUE_PROFILE = 'profile-colleague'
const COLLEAGUE_CORE = 'core-colleague'

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

jest.mock('@/lib/auth/store-scope', () => ({ resolveStoreScope: jest.fn() }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn() }))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: jest.fn() }))

jest.mock('@/lib/synqed/client', () => {
  const appointments = { list: jest.fn() }
  const staff = { list: jest.fn() }
  const storePolicies = { get: jest.fn(), listClosedDays: jest.fn() }
  // The store's own row — read for its vertical (class-bound or not), and
  // degraded-allowed, so the default double answers an empty row.
  const stores = { get: jest.fn(async () => ({})) }
  return {
    getSynqedClient: jest.fn(async () => ({ appointments, staff, storePolicies, stores })),
  }
})

import { getAppointmentWindow } from '@/actions/appointments-window'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { getCurrentUserStaffId } from '@/lib/staff'
import { getOrgSettings } from '@/actions/org-settings'
import { getSynqedClient } from '@/lib/synqed/client'

const FROM = new Date('2026-09-15T00:00:00+09:00').toISOString()
const TO = new Date('2026-09-15T23:59:59.999+09:00').toISOString()

type Spies = {
  list: jest.Mock
  staffList: jest.Mock
  policyGet: jest.Mock
  closedDays: jest.Mock
  storeGet: jest.Mock
}

async function spies(): Promise<Spies> {
  const client = (await getSynqedClient()) as unknown as {
    appointments: { list: jest.Mock }
    staff: { list: jest.Mock }
    storePolicies: { get: jest.Mock; listClosedDays: jest.Mock }
    stores: { get: jest.Mock }
  }
  return {
    list: client.appointments.list,
    staffList: client.staff.list,
    policyGet: client.storePolicies.get,
    closedDays: client.storePolicies.listClosedDays,
    storeGet: client.stores.get,
  }
}

function booking(id: string) {
  return {
    id,
    kind: 'BOOKING',
    customer_id: `c-${id}`,
    staff_id: VIEWER_CORE,
    starts_at: '2026-09-15T01:00:00Z',
    ends_at: '2026-09-15T02:00:00Z',
    duration_minutes: 60,
    status: 'SCHEDULED',
  }
}

beforeEach(async () => {
  jest.clearAllMocks()
  const s = await spies()
  s.list.mockResolvedValue({ appointments: [booking('a1')], total: 1, page: 1, page_size: 500 })
  s.staffList.mockResolvedValue({
    staff: [
      { id: VIEWER_CORE, user_id: VIEWER_PROFILE },
      { id: COLLEAGUE_CORE, user_id: COLLEAGUE_PROFILE },
    ],
    total: 2,
  })
  s.policyGet.mockResolvedValue({ weekly_hours: { tue: { open: '10:00', close: '20:00' } } })
  s.closedDays.mockResolvedValue({ closed_days: [] })
  ;(resolveStoreScope as jest.Mock).mockResolvedValue({
    storeId: GINZA,
    allowedStoreIds: [GINZA],
  })
  ;(getCurrentUserStaffId as jest.Mock).mockResolvedValue(VIEWER_PROFILE)
  ;(getOrgSettings as jest.Mock).mockResolvedValue({
    operating_hours: null,
    operating_hours_saved: [],
    solo_mode: true,
  })
})

describe('getAppointmentWindow — the store clamp rides every read (mutant m10)', () => {
  it('forwards the RESOLVED store id to the bookings, the policy and the closed days', async () => {
    await getAppointmentWindow(FROM, TO, 'all')
    const s = await spies()
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA }))
    expect(s.policyGet).toHaveBeenCalledWith(GINZA)
    expect(s.closedDays).toHaveBeenCalledWith(GINZA, expect.any(Object))
  })

  it('a caller-named store cannot reach the read — only the clamp can', async () => {
    ;(resolveStoreScope as jest.Mock).mockResolvedValue({
      storeId: 'store-daikanyama',
      allowedStoreIds: ['store-daikanyama'],
    })
    await getAppointmentWindow(FROM, TO, 'all')
    const s = await spies()
    expect(s.list).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'store-daikanyama' }),
    )
  })

  it('no store to name: no policy read at all, and the hours fall to the org blob', async () => {
    ;(resolveStoreScope as jest.Mock).mockResolvedValue({
      storeId: null,
      allowedStoreIds: null,
    })
    const win = await getAppointmentWindow(FROM, TO, 'all')
    const s = await spies()
    expect(s.policyGet).not.toHaveBeenCalled()
    expect(s.closedDays).not.toHaveBeenCalled()
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ store_id: undefined }))
    // weekly_hours null path: the blob was never saved, so the day is the
    // 10:00–24:00 default and hoursSaved is false — nothing claims a capacity.
    const [, fact] = win.hoursFacts[0]
    expect(fact).toEqual({
      minutes: 840,
      openMinute: 600,
      closeMinute: 1440,
      saved: false,
      // The 10:00–24:00 fallback nobody set — provenance, not just a boolean
      // (S1): 'default' is the one source the capacity model may never divide.
      source: 'default',
      closed: false,
    })
  })
})

describe('getAppointmentWindow — a filter it cannot place reads ZERO, never everyone (mutant m9)', () => {
  it('an unplaceable ?staff= id: no placed staff\'s rows, not truncated, read without staff_id', async () => {
    const win = await getAppointmentWindow(FROM, TO, 'somebody-who-left')
    const s = await spies()
    // The default core answer is the VIEWER's booking only — it must not count.
    expect(win.counted).toEqual([])
    expect(win.cancelled).toEqual([])
    expect(win.noShow).toEqual([])
    expect(win.truncated).toBe(false)
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA, staff_id: undefined }))
    // ⚖ R1-9: and it SAYS the filter is unplaced, so the screen does not read
    // those rows as a real day and divide them by one lane.
    expect(win.staffFilterUnknown).toBe(true)
  })

  it('a window it CAN place is not flagged — the flag is about the filter, not the emptiness', async () => {
    const win = await getAppointmentWindow(FROM, TO, COLLEAGUE_PROFILE)
    expect(win.staffFilterUnknown).toBe(false)
  })

  it('a placeable colleague id filters by the list\'s own rule: read without staff_id, the viewer\'s row dropped', async () => {
    const win = await getAppointmentWindow(FROM, TO, COLLEAGUE_PROFILE)
    const s = await spies()
    expect(s.list).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: undefined, store_id: GINZA }),
    )
    expect(win.counted).toEqual([])
  })

  it('no filter on: no roster read and no staff_id', async () => {
    await getAppointmentWindow(FROM, TO, 'all')
    const s = await spies()
    expect(s.staffList).not.toHaveBeenCalled()
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ staff_id: undefined }))
  })
})

describe("getAppointmentWindow — 'self' is the SERVER's answer, never the caller's", () => {
  it("resolves 自分 through getCurrentUserStaffId", async () => {
    const s = await spies()
    s.list.mockResolvedValue({
      appointments: [booking('a1'), { ...booking('theirs'), staff_id: COLLEAGUE_CORE }],
      total: 2,
      page: 1,
      page_size: 500,
    })
    const win = await getAppointmentWindow(FROM, TO, 'self')
    expect(getCurrentUserStaffId).toHaveBeenCalled()
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ staff_id: undefined }))
    expect(win.counted.map((a) => a.id)).toEqual(['a1'])
  })

  it('takes no viewer-id argument at all, and ignores one if a caller POSTs it', async () => {
    // 'use server' makes this an endpoint: an extra argument is exactly what
    // an attacker would send to read a colleague's 自分 week. The action's
    // only optional argument is `withHours`, a boolean that decides whether to
    // ask about opening hours — it can never name an identity, and the three
    // REQUIRED arguments are still the three that were always there.
    expect(getAppointmentWindow).toHaveLength(3)
    const s = await spies()
    s.list.mockResolvedValue({
      appointments: [booking('a1'), { ...booking('theirs'), staff_id: COLLEAGUE_CORE }],
      total: 2,
      page: 1,
      page_size: 500,
    })
    const win = (await (getAppointmentWindow as unknown as (...a: unknown[]) => Promise<unknown>)(
      FROM,
      TO,
      'self',
      COLLEAGUE_PROFILE,
    )) as Awaited<ReturnType<typeof getAppointmentWindow>>
    // 自分 is still the VIEWER: the colleague's row never counts.
    expect(win.counted.map((a) => a.id)).toEqual(['a1'])
  })

  it('a viewer with no staff row reads UNFILTERED, exactly as the day path does', async () => {
    ;(getCurrentUserStaffId as jest.Mock).mockResolvedValue(null)
    await getAppointmentWindow(FROM, TO, 'self')
    const s = await spies()
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ staff_id: undefined }))
  })
})

describe('getAppointmentWindow — a failed read is an ERROR, never a calm empty week', () => {
  it('rejects when the bookings read rejects', async () => {
    const s = await spies()
    s.list.mockRejectedValue(new Error('core 503'))
    await expect(getAppointmentWindow(FROM, TO, 'all')).rejects.toThrow('core 503')
  })

  it('rejects when the hours read rejects', async () => {
    const s = await spies()
    s.policyGet.mockRejectedValue(new Error('core 503'))
    await expect(getAppointmentWindow(FROM, TO, 'all')).rejects.toThrow('core 503')
  })
})

describe('⚖ G2 — a degraded store row is reported, never silently absorbed (Greptile round 1 #934)', () => {
  it('stores.get rejects → storeRowDegraded true, never null-shaped like "no store id"', async () => {
    const s = await spies()
    s.storeGet.mockRejectedValueOnce(new Error('core 503'))
    const win = await getAppointmentWindow(FROM, TO, 'all')
    expect(win.storeRowDegraded).toBe(true)
  })

  it('a successfully-read store row (even an empty one) is NOT degraded', async () => {
    const win = await getAppointmentWindow(FROM, TO, 'all')
    expect(win.storeRowDegraded).toBe(false)
  })
})

describe('⚖ S7 — the fetch starts one JST day EARLY (the window-edge leak)', () => {
  it('asks core from the PREVIOUS JST midnight, while the hours still cover the visible days', async () => {
    await getAppointmentWindow(FROM, TO, 'all')
    const s = await spies()
    // FROM is 2026-09-15 00:00 JST; the read begins at the 14th's midnight so
    // a booking that started at 23:00 the night before is even returned.
    expect(s.list).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date('2026-09-14T00:00:00+09:00').toISOString(),
        to: TO,
      }),
    )
    // The extra day is for the SPANS only: the hours facts and the 臨時休業
    // read still describe exactly the days on screen.
    expect(s.closedDays).toHaveBeenCalledWith(
      GINZA,
      expect.objectContaining({ from: '2026-09-15', to: '2026-09-16' }),
    )
  })

  it('carries exactly one extra day, never a wider guess', async () => {
    await getAppointmentWindow(FROM, TO, 'all')
    const s = await spies()
    const call = s.list.mock.calls[0][0] as { from: string; to: string }
    expect(Date.parse(FROM) - Date.parse(call.from)).toBe(86_400_000)
  })

  it('the hours facts still key only the VISIBLE days', async () => {
    const win = await getAppointmentWindow(FROM, TO, 'all')
    expect(win.hoursFacts.map(([ymd]) => ymd)).toEqual(['2026-09-15'])
  })
})

// ⚖ W0.5 (PR A) — the web window reads the SAME policy's 臨時営業日, so the
// week/month cells paint a special opening open exactly where the booking door
// (day-hours.ts) now takes a booking on it. One resolver, one answer.
describe('⚖ W0.5 — the window read carries 臨時営業日 into the hours facts', () => {
  it('a special opening on a 臨時休業 date resolves OPEN on its own window', async () => {
    const s = await spies()
    s.policyGet.mockResolvedValue({
      weekly_hours: { tue: { open: '10:00', close: '20:00' } },
      special_open_days: [{ date: '2026-09-15', open: '12:00', close: '16:00' }],
    })
    s.closedDays.mockResolvedValue({ closed_days: [{ date: '2026-09-15' }] })
    const win = await getAppointmentWindow(FROM, TO, 'all')
    expect(win.hoursFacts).toEqual([
      [
        '2026-09-15',
        {
          minutes: 240,
          openMinute: 720,
          closeMinute: 960,
          saved: true,
          source: 'special',
          closed: false,
        },
      ],
    ])
  })

  it('the same closed date with no special entry stays closed (unchanged)', async () => {
    const s = await spies()
    s.closedDays.mockResolvedValue({ closed_days: [{ date: '2026-09-15' }] })
    const win = await getAppointmentWindow(FROM, TO, 'all')
    expect(win.hoursFacts[0][1]).toMatchObject({ closed: true, kind: 'closed_date' })
  })
})

describe('getAppointmentWindow — every window (day, week, month, 先月比) counts 担当未定 under every filter (PR-B)', () => {
  it('自分: one own booking + one staff-less → 2 counted, read without staff_id', async () => {
    const s = await spies()
    s.list.mockResolvedValue({
      appointments: [booking('a1'), { ...booking('nostaff'), staff_id: null }, { ...booking('theirs'), staff_id: COLLEAGUE_CORE }],
      total: 3,
      page: 1,
      page_size: 500,
    })
    const win = await getAppointmentWindow(FROM, TO, 'self')
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA, staff_id: undefined }))
    expect(win.counted.map((a) => a.id).sort()).toEqual(['a1', 'nostaff'])
  })

  // Fix round 3 (reader S2): the list's rule never widens who reads.
  it('an unassigned actor (no store, allowedStoreIds []) reads NOTHING', async () => {
    ;(resolveStoreScope as jest.Mock).mockResolvedValue({ storeId: null, allowedStoreIds: [] })
    const win = await getAppointmentWindow(FROM, TO, 'all')
    const s = await spies()
    expect(s.list).not.toHaveBeenCalled()
    expect(win.counted).toEqual([])
  })

  it('an unplaceable ?staff= id reads unfiltered and keeps only the staff-less rows', async () => {
    const s = await spies()
    s.list.mockResolvedValue({
      appointments: [booking('a1'), { ...booking('nostaff'), staff_id: null }, { ...booking('theirs'), staff_id: COLLEAGUE_CORE }],
      total: 3,
      page: 1,
      page_size: 500,
    })
    const win = await getAppointmentWindow(FROM, TO, 'somebody-who-left')
    expect(s.list).toHaveBeenCalledTimes(1)
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA, staff_id: undefined }))
    expect(win.counted.map((a) => a.id)).toEqual(['nostaff'])
  })

  // Round 5: week, month and the 先月同期間比 base read through the SAME rule
  // as the day line. Core is mocked to honour staff_id EQUALITY, as it does,
  // so a read that still filtered at core would lose the staff-less row.
  const WEEK = [
    new Date('2026-09-14T00:00:00+09:00').toISOString(),
    new Date('2026-09-20T23:59:59.999+09:00').toISOString(),
  ] as const
  const MONTH = [
    new Date('2026-09-01T00:00:00+09:00').toISOString(),
    new Date('2026-09-30T23:59:59.999+09:00').toISOString(),
  ] as const
  const PREV_SPAN = [
    new Date('2026-08-01T00:00:00+09:00').toISOString(),
    new Date('2026-08-15T23:59:59.999+09:00').toISOString(),
  ] as const
  async function coreHonoursStaffEquality(startsAt: string) {
    const s = await spies()
    const rows = [
      { ...booking('viewer'), starts_at: startsAt },
      { ...booking('colleague'), staff_id: COLLEAGUE_CORE, starts_at: startsAt },
      { ...booking('nostaff'), staff_id: null, starts_at: startsAt },
    ]
    s.list.mockImplementation(async (q: { staff_id?: string }) => {
      const hit = q.staff_id ? rows.filter((r) => r.staff_id === q.staff_id) : rows
      return { appointments: hit, total: hit.length, page: 1, page_size: 500 }
    })
    return s
  }

  it.each([
    ['week', '自分', 'self', 'viewer', WEEK],
    ['week', 'one named staff', COLLEAGUE_PROFILE, 'colleague', WEEK],
    ['month', '自分', 'self', 'viewer', MONTH],
    ['month', 'one named staff', COLLEAGUE_PROFILE, 'colleague', MONTH],
  ] as const)('%s under %s: 件 includes the staff-less booking, read without staff_id', async (
    _view, _who, filter, own, [from, to],
  ) => {
    const s = await coreHonoursStaffEquality('2026-09-15T01:00:00Z')
    const win = await getAppointmentWindow(from, to, filter)
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA, staff_id: undefined }))
    expect(win.counted.map((a) => a.id).sort()).toEqual([own, 'nostaff'].sort())
  })

  it.each([
    ['自分', 'self', 'viewer'],
    ['one named staff', COLLEAGUE_PROFILE, 'colleague'],
  ] as const)('先月同期間比 base under %s includes last month\'s staff-less booking', async (_who, filter, own) => {
    const s = await coreHonoursStaffEquality('2026-08-10T01:00:00Z')
    // The page's 先月比 read: the bare window (withHours false), same filter.
    const win = await getAppointmentWindow(PREV_SPAN[0], PREV_SPAN[1], filter, false)
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA, staff_id: undefined }))
    expect(s.policyGet).not.toHaveBeenCalled()
    expect(win.counted.map((a) => a.id).sort()).toEqual([own, 'nostaff'].sort())
  })

  it.each([
    ['week', WEEK],
    ['month', MONTH],
  ] as const)('an unplaceable ?staff= id on the %s keeps the staff-less rows only, never empty', async (_view, [from, to]) => {
    const s = await coreHonoursStaffEquality('2026-09-15T01:00:00Z')
    const win = await getAppointmentWindow(from, to, 'somebody-who-left')
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ store_id: GINZA, staff_id: undefined }))
    expect(win.counted.map((a) => a.id)).toEqual(['nostaff'])
    expect(win.staffFilterUnknown).toBe(true)
  })
})
