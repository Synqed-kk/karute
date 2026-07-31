/**
 * buildDashboardScreen (design-parity P-B-1 extraction, PR 1) — pins the
 * moved Stage-2 derivation through its new explicit-dep shape. Two call
 * sites inside the old page body used to construct their own client lazily
 * (`await getSynqedClient()`) and independently catch its failure; the
 * extraction forces both onto the single `synqed` dep instead. This suite
 * pins that the graceful-fallback CONTRACT survived the move unchanged:
 * a null synqed dep degrades exactly like the old per-site try/catch did.
 */

jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerListFor: jest.fn(async () => []),
}))
jest.mock('@/lib/customers/list-enrich', () => ({
  enrichCustomers: jest.fn(async () => new Map()),
}))
jest.mock('@/lib/packs/store', () => ({
  listRecentRedemptionsWithClient: jest.fn(async () => []),
}))
jest.mock('@/lib/dashboard/daily-attention-ai', () => ({
  getDailyAttentionLines: jest.fn(async () => new Map()),
}))

import { buildDashboardScreen, type DashboardScreenDeps } from '@/lib/dashboard/screen'
import { listRecentRedemptionsWithClient } from '@/lib/packs/store'
import { getCachedCustomerListFor } from '@/lib/customers/cached'
import type { OrgSettings } from '@/actions/org-settings'
import type { StaffMember } from '@/lib/staff'
import type { DashboardTodayAppointment } from '@/lib/dashboard/cached'
import { startTiming } from '@/lib/perf/timing'

const NOW = new Date('2026-06-10T03:00:00Z') // JST 12:00

const OWNER: StaffMember = {
  id: 's1',
  full_name: 'Owner Osamu',
  display_role: 'owner',
  has_pin: true,
  created_at: '2026-01-01T00:00:00Z',
}

function todayAppt(over: Partial<DashboardTodayAppointment> = {}): DashboardTodayAppointment {
  return {
    id: 'a1',
    client_id: 'c1',
    start_time: '2026-06-10T05:00:00Z',
    duration_minutes: 60,
    staff_profile_id: 's1',
    title: null,
    notes: null,
    karute_record_id: null,
    customers: { name: 'Tanaka' },
    ...over,
  }
}

function baseDeps(over: Partial<DashboardScreenDeps> = {}): DashboardScreenDeps {
  return {
    synqed: null,
    locale: 'ja',
    staffList: [OWNER],
    activeStaffId: 's1',
    dashboard: {
      weeklyKaruteCount: 0,
      monthlyKaruteCount: 0,
      weekKaruteCount: 0,
      todayAppointments: [],
      tomorrowAppointments: [],
      recentKarute: [],
    },
    orgSettings: {
      ticket_packs_enabled: true,
      business_type: 'salon',
      setup_completed_at: '2026-01-01T00:00:00Z',
    } as OrgSettings,
    customerList: [],
    packAlerts: {
      contact: [],
      low: [],
      inProgress: [],
      totals: { atRiskValue: 0, unconsumedTotal: 0, holderCount: 0 },
      monthly: { contacted: 0, rebooked: 0 },
    },
    reconcile: { entries: [], truncated: 0 },
    canDismissAlerts: false,
    packUsage: new Map(),
    businessId: 'biz-1',
    scope: { storeId: null, viewAll: true, allowedStoreIds: null },
    t: startTiming('test'),
    ...over,
  }
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW)
  jest.clearAllMocks()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('buildDashboardScreen', () => {
  it('passes chrome-level fields straight through', async () => {
    const screen = await buildDashboardScreen(baseDeps({ canDismissAlerts: true }))
    expect(screen.isOwner).toBe(true)
    expect(screen.canDismissAlerts).toBe(true)
    expect(screen.ticketsEnabled).toBe(true)
    expect(screen.onboardingComplete).toBe(true)
  })

  it("builds a hero slide from today's appointment, using the synqed dep for the karute lookup", async () => {
    const list = jest.fn(async () => ({
      karute_records: [{ id: 'k1', ai_summary: 'good progress', created_at: '2026-06-01T00:00:00Z' }],
    }))
    const synqed = { karuteRecords: { list } }
    const screen = await buildDashboardScreen(
      baseDeps({
        synqed: synqed as never,
        dashboard: {
          weeklyKaruteCount: 0,
          monthlyKaruteCount: 0,
          weekKaruteCount: 0,
          todayAppointments: [todayAppt()],
          tomorrowAppointments: [],
          recentKarute: [],
        },
      }),
    )
    expect(screen.heroSlides).toHaveLength(1)
    expect(screen.heroSlides[0]).toMatchObject({ clientId: 'c1', customerName: 'Tanaka' })
    expect(list).toHaveBeenCalledWith({ customer_id: 'c1', page_size: 1 })
    expect(screen.heroSlides[0].lastVisit).toMatchObject({
      text: expect.stringContaining('good progress'),
    })
  })

  it('null synqed (client construction failed) degrades to no last-visit line — matches the old per-site try/catch', async () => {
    const screen = await buildDashboardScreen(
      baseDeps({
        synqed: null,
        dashboard: {
          weeklyKaruteCount: 0,
          monthlyKaruteCount: 0,
          weekKaruteCount: 0,
          todayAppointments: [todayAppt()],
          tomorrowAppointments: [],
          recentKarute: [],
        },
      }),
    )
    expect(screen.heroSlides[0].lastVisit).toBeNull()
  })

  it('owner + null synqed: the 7-day redemption pulse falls back to [] gracefully (never throws)', async () => {
    const screen = await buildDashboardScreen(baseDeps({ synqed: null }))
    expect(screen.pulse.redemptions).toBe(0)
    expect(listRecentRedemptionsWithClient).not.toHaveBeenCalled()
  })

  it('owner + real synqed: calls listRecentRedemptionsWithClient(synqed, 7) for the 7-day pulse', async () => {
    ;(listRecentRedemptionsWithClient as jest.Mock).mockResolvedValueOnce([
      { customer_id: 'c1' },
      { customer_id: 'c2' },
    ])
    const synqed = { karuteRecords: { list: jest.fn(async () => ({ karute_records: [] })) } }
    const screen = await buildDashboardScreen(baseDeps({ synqed: synqed as never }))
    expect(listRecentRedemptionsWithClient).toHaveBeenCalledWith(synqed, 7)
    expect(screen.pulse.redemptions).toBe(2)
  })

  it('non-owner staff skips the redemptions7d fetch entirely', async () => {
    const staff: StaffMember = {
      id: 's2',
      full_name: 'Staff Sara',
      display_role: 'stylist',
      has_pin: true,
      created_at: '2026-01-01T00:00:00Z',
    }
    const screen = await buildDashboardScreen(baseDeps({ staffList: [staff], activeStaffId: 's2' }))
    expect(screen.isOwner).toBe(false)
    expect(listRecentRedemptionsWithClient).not.toHaveBeenCalled()
    expect(screen.pulse.redemptions).toBe(0)
  })

  it('ticketsEnabled=false blanks pack alerts/reconcile/pack-usage views', async () => {
    const screen = await buildDashboardScreen(
      baseDeps({
        orgSettings: {
          ticket_packs_enabled: false,
          business_type: 'salon',
          setup_completed_at: null,
        } as OrgSettings,
        packAlerts: {
          contact: [
            {
              customerId: 'c1',
              name: 'A',
              karuteNumber: null,
              remaining: 1,
              size: 2,
              unconsumed: 1000,
              daysSinceLastVisit: 10,
              hasNextBooking: false,
            },
          ],
          low: [],
          inProgress: [],
          totals: { atRiskValue: 1000, unconsumedTotal: 1000, holderCount: 1 },
          monthly: { contacted: 0, rebooked: 0 },
        },
        packUsage: new Map([
          ['c1', { remaining: 3, size: 10, unconsumed: 3000, hasActivePack: true }],
        ]),
      }),
    )
    expect(screen.ticketsEnabled).toBe(false)
    expect(screen.packAlerts.totals.holderCount).toBe(0)
    expect(screen.winbacks).toEqual([])
  })

  describe('store lens on packUsage (screen.ts packUsageLensed block)', () => {
    function twoHolderDeps(over: Partial<DashboardScreenDeps> = {}): DashboardScreenDeps {
      return baseDeps({
        businessId: 'biz-1',
        packUsage: new Map([
          ['c-in', { remaining: 3, size: 10, unconsumed: 3000, hasActivePack: true }],
          ['c-out', { remaining: 5, size: 10, unconsumed: 5000, hasActivePack: true }],
        ]),
        dashboard: {
          weeklyKaruteCount: 0,
          monthlyKaruteCount: 0,
          weekKaruteCount: 0,
          todayAppointments: [
            todayAppt({
              id: 'a-in',
              client_id: 'c-in',
              start_time: '2026-06-10T05:00:00Z',
              customers: { name: 'In Store' },
            }),
            todayAppt({
              id: 'a-out',
              client_id: 'c-out',
              start_time: '2026-06-10T06:00:00Z',
              customers: { name: 'Out Store' },
            }),
          ],
          tomorrowAppointments: [],
          recentKarute: [],
        },
        ...over,
      })
    }

    it('scope.storeId + businessId + non-empty packUsage: only the in-store holder\'s ticket chip survives', async () => {
      ;(getCachedCustomerListFor as jest.Mock).mockResolvedValueOnce([
        { id: 'c-in', name: 'In Store' },
      ])
      const screen = await buildDashboardScreen(
        twoHolderDeps({ scope: { storeId: 'store-1', viewAll: false, allowedStoreIds: ['store-1'] } }),
      )
      expect(getCachedCustomerListFor).toHaveBeenCalledWith('biz-1', 'store-1')
      const inSlide = screen.heroSlides.find((s) => s.clientId === 'c-in')
      const outSlide = screen.heroSlides.find((s) => s.clientId === 'c-out')
      expect(inSlide?.ticket).toEqual({ remaining: 3, size: 10 })
      expect(outSlide?.ticket).toBeNull()
    })

    it('fails CLOSED when the lens fetch rejects — NO pack rows at all, never the unfiltered map', async () => {
      ;(getCachedCustomerListFor as jest.Mock).mockRejectedValueOnce(new Error('core down'))
      const screen = await buildDashboardScreen(
        twoHolderDeps({ scope: { storeId: 'store-1', viewAll: false, allowedStoreIds: ['store-1'] } }),
      )
      expect(screen.heroSlides.find((s) => s.clientId === 'c-in')?.ticket).toBeNull()
      expect(screen.heroSlides.find((s) => s.clientId === 'c-out')?.ticket).toBeNull()
    })

    it('scope === null fails CLOSED regardless of packUsage (never calls the lens fetch)', async () => {
      const screen = await buildDashboardScreen(twoHolderDeps({ scope: null }))
      expect(getCachedCustomerListFor).not.toHaveBeenCalled()
      expect(screen.heroSlides.find((s) => s.clientId === 'c-in')?.ticket).toBeNull()
      expect(screen.heroSlides.find((s) => s.clientId === 'c-out')?.ticket).toBeNull()
    })
  })
})
