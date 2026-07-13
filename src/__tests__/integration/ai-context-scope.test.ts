/**
 * Real ai-context lib functions — the store-scope + no-show correctness the
 * route/signal tests mock away (PKT-101R B1 + B2). Mocks sit at the SDK +
 * cached-list boundary so the actual clamp/filter logic runs.
 */

jest.mock('@/lib/customers/cached', () => ({
  getCachedCustomerList: jest.fn(async () => []),
}))
jest.mock('@/lib/synqed/client', () => {
  const client = {
    karuteRecords: { list: jest.fn(async () => ({ karute_records: [] })) },
    appointments: { list: jest.fn(async () => ({ appointments: [] })) },
  }
  return { getSynqedClient: jest.fn(async () => client) }
})

import {
  getCustomerKaruteForAI,
  getTodaysAppointments,
} from '@/lib/karute/ai-context'
import { getSynqedClient } from '@/lib/synqed/client'
import { getCachedCustomerList } from '@/lib/customers/cached'

const cachedMock = getCachedCustomerList as jest.Mock
const GINZA = 'store-ginza'

async function synqedMock() {
  const client = await (getSynqedClient as jest.Mock)()
  return client as {
    karuteRecords: { list: jest.Mock }
    appointments: { list: jest.Mock }
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('getCustomerKaruteForAI — B1 cross-store name leak', () => {
  it('out-of-scope customer (zero clamped rows) → customerName null, even though the business-wide cache knows the name', async () => {
    // Ginza-clamped staff asks about a Daikanyama-only customer: the store-clamped
    // karute fetch returns nothing…
    const { karuteRecords } = await synqedMock()
    karuteRecords.list.mockResolvedValue({ karute_records: [] })
    // …but the business-wide cache DOES hold their name (the old leak path).
    cachedMock.mockResolvedValue([{ id: 'c-daikanyama', name: '田中' }])

    const res = await getCustomerKaruteForAI('c-daikanyama', 10, GINZA)
    expect(res.customerName).toBeNull()
    expect(res.rows).toEqual([])
    // the fetch WAS store-clamped
    expect(karuteRecords.list).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: 'c-daikanyama', store_id: GINZA }),
    )
  })

  it('in-scope customer (clamped rows exist) → name resolved', async () => {
    const { karuteRecords } = await synqedMock()
    karuteRecords.list.mockResolvedValue({
      karute_records: [
        { id: 'k1', customer_id: 'c-1', created_at: '2026-07-13', ai_summary: null, entries: [] },
      ],
    })
    cachedMock.mockResolvedValue([{ id: 'c-1', name: '佐藤' }])

    const res = await getCustomerKaruteForAI('c-1', 10, GINZA)
    expect(res.customerName).toBe('佐藤')
    expect(res.rows).toHaveLength(1)
  })
})

describe('getTodaysAppointments — B2 terminal-status filter', () => {
  it('excludes NO_SHOW and CANCELLED, keeps live bookings', async () => {
    const { appointments } = await synqedMock()
    appointments.list.mockResolvedValue({
      appointments: [
        { id: 'a1', customer_id: 'c-1', status: 'SCHEDULED' },
        { id: 'a2', customer_id: 'c-2', status: 'NO_SHOW' },
        { id: 'a3', customer_id: 'c-3', status: 'CANCELLED' },
        { id: 'a4', customer_id: 'c-4', status: 'COMPLETED' },
      ],
    })
    const appts = await getTodaysAppointments(GINZA)
    expect(appts.map((a) => a.id)).toEqual(['a1', 'a4'])
  })
})
