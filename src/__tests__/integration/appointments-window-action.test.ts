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
  it('an unplaceable ?staff= id: empty window, not truncated, and NO fetch', async () => {
    const win = await getAppointmentWindow(FROM, TO, 'somebody-who-left')
    const s = await spies()
    expect(win.counted).toEqual([])
    expect(win.cancelled).toEqual([])
    expect(win.noShow).toEqual([])
    expect(win.truncated).toBe(false)
    expect(s.list).not.toHaveBeenCalled()
    // ⚖ R1-9: and it SAYS the window is empty by construction, so the screen
    // does not read those zero rows as a real day and divide them by one lane.
    expect(win.staffFilterUnknown).toBe(true)
  })

  it('a window it CAN place is not flagged — the flag is about the filter, not the emptiness', async () => {
    const win = await getAppointmentWindow(FROM, TO, COLLEAGUE_PROFILE)
    expect(win.staffFilterUnknown).toBe(false)
  })

  it('a placeable colleague id still filters at the fetch', async () => {
    await getAppointmentWindow(FROM, TO, COLLEAGUE_PROFILE)
    const s = await spies()
    expect(s.list).toHaveBeenCalledWith(
      expect.objectContaining({ staff_id: COLLEAGUE_CORE, store_id: GINZA }),
    )
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
    await getAppointmentWindow(FROM, TO, 'self')
    const s = await spies()
    expect(getCurrentUserStaffId).toHaveBeenCalled()
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ staff_id: VIEWER_CORE }))
  })

  it('takes no viewer-id argument at all, and ignores one if a caller POSTs it', async () => {
    // 'use server' makes this an endpoint: an extra argument is exactly what
    // an attacker would send to read a colleague's 自分 week. The action's
    // only optional argument is `withHours`, a boolean that decides whether to
    // ask about opening hours — it can never name an identity, and the three
    // REQUIRED arguments are still the three that were always there.
    expect(getAppointmentWindow).toHaveLength(3)
    await (getAppointmentWindow as unknown as (...a: unknown[]) => Promise<unknown>)(
      FROM,
      TO,
      'self',
      COLLEAGUE_PROFILE,
    )
    const s = await spies()
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ staff_id: VIEWER_CORE }))
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
