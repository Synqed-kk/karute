/**
 * ⚖ PKT-2 / R1-3 — the WEB month door's own 新規, driven through the real
 * `getMonthCells`.
 *
 * The door hardcoded `newCount: 0` on the same wire type the facade filled
 * honestly. `first-visit.test.ts` pins the producer and the shared mapper;
 * this pins the DOOR — that it resolves the rule's inputs (the store-clamped
 * cached customer list, the history aggregate for the ids its own window
 * returned, the 回数券 ledger) and hands them over, and that it withholds the
 * number when it could not.
 */

jest.mock('next/cache', () => ({
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
}))

// @synqed-kk/client ships ESM jest can't parse; only SynqedError is referenced
// at module load.
jest.mock('@synqed-kk/client', () => {
  class SynqedError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'SynqedError'
      this.status = status
    }
  }
  return { SynqedError }
})

jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => {}),
  can: jest.fn(async () => true),
}))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(async () => ({
    storeId: null,
    viewAll: true,
    allowedStoreIds: null,
  })),
  customerLensFor: jest.requireActual('@/lib/auth/store-scope').customerLensFor,
}))
jest.mock('@/actions/stores', () => ({ getActiveStoreId: jest.fn(async () => null) }))
jest.mock('@/actions/org-settings', () => ({
  getOrgSettings: jest.fn(async () => ({ operating_hours: null, ticket_packs_enabled: true })),
}))
jest.mock('@/lib/synqed/staff-map', () => ({
  resolveSynqedStaffId: jest.fn(async (id: string) => id),
}))

// jest.mock factories are hoisted above every const in this file, so each
// mock is DEFINED inside its factory and the handle is taken after the import
// below — the idiom the sibling store-scope suite uses.
jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => []),
}))
jest.mock('@/lib/staff', () => ({
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
}))
jest.mock('@/lib/customers/list-enrich', () => ({
  enrichCustomers: jest.fn(async () => new Map()),
}))
jest.mock('@/lib/packs/store', () => ({
  listAllPackUsageOrNull: jest.fn(async () => new Map()),
  listCustomerPacks: jest.fn(async () => []),
}))
jest.mock('@/lib/synqed/client', () => {
  const list = jest.fn()
  const client = { appointments: { list } }
  // `__list` is the handle: the factory is hoisted, so this is the only way to
  // reach the spy synchronously from module scope below.
  return { getSynqedClient: jest.fn(async () => client), __list: list }
})

import { getMonthCells } from '@/actions/appointments'
import { getCachedCustomerList } from '@/lib/customers/cached'
import { getBusinessId } from '@/lib/staff'
import { enrichCustomers } from '@/lib/customers/list-enrich'
import { listAllPackUsageOrNull } from '@/lib/packs/store'
import { getOrgSettings } from '@/actions/org-settings'
import type { Appointment } from '@synqed-kk/client'
import { buildAppointmentsScreen } from '@/lib/appointments/screen'
import { computeMonthRange } from '@/lib/date/calendar-range'

const cachedCustomers = getCachedCustomerList as jest.Mock
const businessId = getBusinessId as jest.Mock
const enrich = enrichCustomers as jest.Mock
const packUsage = listAllPackUsageOrNull as jest.Mock
const orgSettings = getOrgSettings as jest.Mock
const list = (jest.requireMock('@/lib/synqed/client') as { __list: jest.Mock }).__list

const SEP = '2026-09'
/** 10:00 JST on a September day. */
function at(day: number, hour = 10): string {
  return new Date(`${SEP}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+09:00`).toISOString()
}
function appt(over: Record<string, unknown>) {
  return {
    id: 'a',
    kind: 'BOOKING',
    customer_id: 'c1',
    staff_id: 's1',
    store_id: null,
    starts_at: at(14),
    ends_at: at(14, 11),
    duration_minutes: 60,
    title: null,
    notes: null,
    status: 'SCHEDULED',
    source: 'MANUAL',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  }
}
function history(over: Record<string, number> = {}) {
  return { totalKarute: 0, pastAppointmentCount: 0, noShowCount: 0, datedVisitCount: 0, ...over }
}
function cust(over: Record<string, unknown>) {
  return { id: 'c1', name: '—', isExistingCustomer: false, visitCount: 0, hasTicketPack: false, ...over }
}

/** One page, exhaustive (`total` equals what we hand back) — a short read is
 *  the truncated case, tested on its own below. */
function windowOf(rows: unknown[]) {
  list.mockReset()
  list.mockImplementation(async ({ page }: { page: number }) =>
    page === 1 ? { appointments: rows, total: rows.length } : { appointments: [], total: rows.length },
  )
}

const cellFor = (cells: Awaited<ReturnType<typeof getMonthCells>>, id: string) =>
  cells.find((c) => c.id === id)!

beforeEach(() => {
  jest.clearAllMocks()
  businessId.mockResolvedValue('business-1')
  cachedCustomers.mockResolvedValue([])
  enrich.mockResolvedValue(new Map())
  packUsage.mockResolvedValue(new Map())
})

describe('getMonthCells — the month’s 新規 is computed, not hardcoded', () => {
  it('counts the people the day list would tag, on the day they come in', async () => {
    windowOf([
      appt({ id: 'a1', customer_id: 'c1', starts_at: at(14) }),
      appt({ id: 'a2', customer_id: 'c2', starts_at: at(14, 15) }),
      // A regular: history on file, so never 新規 — and on a different day, so
      // a door that simply counted rows would be caught here too.
      appt({ id: 'a3', customer_id: 'c3', starts_at: at(16) }),
    ])
    cachedCustomers.mockResolvedValue([cust({ id: 'c1' }), cust({ id: 'c2' }), cust({ id: 'c3' })])
    enrich.mockResolvedValue(
      new Map([
        ['c1', history()],
        ['c2', history()],
        ['c3', history({ totalKarute: 5, pastAppointmentCount: 5 })],
      ]),
    )

    const cells = await getMonthCells(SEP)
    expect(cellFor(cells, '2026-09-14').newCount).toBe(2)
    expect(cellFor(cells, '2026-09-16').newCount).toBe(0)
    expect(cells.every((c) => c.newCountKnown)).toBe(true)
    // The door asked for exactly the customers its own window returned —
    // the store clamp bounds the enrichment read by construction.
    expect(enrich).toHaveBeenCalledWith('business-1', ['c1', 'c2', 'c3'])
  })

  it('reads the QR signals too — an imported regular is not this month’s 新規', async () => {
    windowOf([appt({ id: 'a1', customer_id: 'c1', starts_at: at(14) })])
    // Imported with is_existing_customer / visits_number_cache, history never
    // synced: every reconciled count is 0 and only the cached row knows.
    cachedCustomers.mockResolvedValue([cust({ id: 'c1', isExistingCustomer: true, visitCount: 7 })])
    enrich.mockResolvedValue(new Map([['c1', history()]]))

    const cells = await getMonthCells(SEP)
    expect(cellFor(cells, '2026-09-14').newCount).toBe(0)
  })

  it('a 回数券 ledger holder is never this month’s 新規 either', async () => {
    windowOf([appt({ id: 'a1', customer_id: 'c1', starts_at: at(14) })])
    cachedCustomers.mockResolvedValue([cust({ id: 'c1' })])
    enrich.mockResolvedValue(new Map([['c1', history()]]))
    packUsage.mockResolvedValue(new Map([['c1', { remaining: 3, size: 10 }]]))

    const cells = await getMonthCells(SEP)
    expect(cellFor(cells, '2026-09-14').newCount).toBe(0)
  })

  it('no business id → the number is WITHHELD, not maximal', async () => {
    windowOf([appt({ id: 'a1', customer_id: 'c1', starts_at: at(14) })])
    cachedCustomers.mockResolvedValue([cust({ id: 'c1' })])
    businessId.mockRejectedValue(new Error('no session'))

    const cells = await getMonthCells(SEP)
    expect(enrich).not.toHaveBeenCalled()
    expect(cells.every((c) => c.newCount === 0 && c.newCountKnown === false)).toBe(true)
  })

  it('a truncated window → withheld, rather than a confident 新規 0 for the month', async () => {
    // Core says there are two, the pages hand back one: the window contract
    // empties every array and flags it.
    list.mockReset()
    list.mockResolvedValue({ appointments: [appt({ id: 'a1' })], total: 2 })
    const cells = await getMonthCells(SEP)
    expect(cells.every((c) => c.newCountKnown === false)).toBe(true)
  })

  it('a month with no bookings at all is KNOWN to have no 新規', async () => {
    windowOf([])
    const cells = await getMonthCells(SEP)
    expect(enrich).not.toHaveBeenCalled()
    expect(cells.every((c) => c.newCount === 0 && c.newCountKnown === true)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ⚖ G1 (Greptile round 1 #951) — a failed OPTIONAL read must withhold the
// 新規 annotation, never kill the whole month grid.
// ---------------------------------------------------------------------------

describe('⚖ G1 — the three 新規-only reads are caught individually', () => {
  it('a rejecting enrichCustomers withholds 新規 for the whole month — the grid still draws', async () => {
    windowOf([appt({ id: 'a1', customer_id: 'c1', starts_at: at(14) })])
    cachedCustomers.mockResolvedValue([cust({ id: 'c1' })])
    enrich.mockRejectedValue(new Error('core unavailable'))

    const cells = await getMonthCells(SEP)
    expect(cells.every((c) => c.newCount === 0 && c.newCountKnown === false)).toBe(true)
  })

  it('a rejecting getCachedCustomerList withholds 新規 too, same reason', async () => {
    windowOf([appt({ id: 'a1', customer_id: 'c1', starts_at: at(14) })])
    cachedCustomers.mockRejectedValue(new Error('core unavailable'))
    enrich.mockResolvedValue(new Map([['c1', history()]]))

    const cells = await getMonthCells(SEP)
    expect(cells.every((c) => c.newCount === 0 && c.newCountKnown === false)).toBe(true)
  })

  it('the WINDOW rejecting still throws — a failed booking read must fail the month', async () => {
    list.mockReset()
    list.mockRejectedValue(new Error('core unavailable'))
    await expect(getMonthCells(SEP)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// ⚖ G2 (Greptile round 1 #951) — a failed 回数券 LEDGER read must withhold too,
// never an empty map standing in for a genuinely empty ledger.
// ---------------------------------------------------------------------------

describe('⚖ G2 — a failed ledger read withholds, never an empty-map guess', () => {
  it('merges withheld and known ledger counts onto the screen month cells', async () => {
    cachedCustomers.mockResolvedValue([cust({ id: 'c1' })])
    enrich.mockResolvedValue(new Map([['c1', history()]]))
    const selectedDate = new Date(at(14))
    const input = {
      locale: 'ja',
      now: selectedDate,
      selectedDate,
      staffFilter: 'all',
      staffList: [],
      activeStaffId: null,
      storeStaffIds: null,
      orgSettings: null,
      customers: await getCachedCustomerList(),
      dayAppointments: [],
      weekRange: null,
      monthRange: computeMonthRange(selectedDate),
      weekRangeAppts: null,
      monthRangeAppts: [appt({ id: 'a1', customer_id: 'c1', starts_at: at(14) }) as Appointment],
      enrichment: await enrichCustomers('business-1', ['c1']),
    }

    packUsage.mockResolvedValue(null)
    const withheld = buildAppointmentsScreen({
      ...input,
      packUsage: await listAllPackUsageOrNull(),
    }).monthData!
    expect(withheld.length).toBeGreaterThan(0)
    for (const cell of withheld) {
      expect(cell.newCountKnown).toBe(false)
      expect(cell.newCount).toBe(0)
    }

    packUsage.mockResolvedValue(new Map())
    const known = buildAppointmentsScreen({
      ...input,
      packUsage: await listAllPackUsageOrNull(),
    }).monthData!
    expect(known.find((c) => c.id === '2026-09-14')).toMatchObject({
      inMonth: true,
      newCount: 1,
      newCountKnown: true,
    })
    expect(known.find((c) => !c.inMonth)).toMatchObject({ newCount: 0 })
  })

  it('a rejecting ledger read withholds 新規 for the whole month', async () => {
    windowOf([appt({ id: 'a1', customer_id: 'c1', starts_at: at(14) })])
    cachedCustomers.mockResolvedValue([cust({ id: 'c1' })])
    enrich.mockResolvedValue(new Map([['c1', history()]]))
    packUsage.mockRejectedValue(new Error('core unavailable'))

    const cells = await getMonthCells(SEP)
    expect(cells.every((c) => c.newCount === 0 && c.newCountKnown === false)).toBe(true)
  })

  it('tickets OFF → known exactly as before, and no ledger read happens at all', async () => {
    windowOf([appt({ id: 'a1', customer_id: 'c1', starts_at: at(14) })])
    cachedCustomers.mockResolvedValue([cust({ id: 'c1' })])
    enrich.mockResolvedValue(new Map([['c1', history()]]))
    orgSettings.mockResolvedValueOnce({ operating_hours: null, ticket_packs_enabled: false })

    const cells = await getMonthCells(SEP)
    expect(packUsage).not.toHaveBeenCalled()
    expect(cellFor(cells, '2026-09-14').newCountKnown).toBe(true)
  })
})
