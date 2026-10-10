/**
 * S126 A2 builder 5 (R-S126-6 e, S125 § 6b consumer 6): audit-watch's
 * recording.karute_missing detail counts an OPEN ledger use as a burn. A visit
 * whose only burn is a pending ledger use reports ticket_burned: true — never a
 * false 「visit with no burn」; a failed ledger read falls back to the server-only
 * answer. Core is faked at the SDK boundary (audit-watch-run.test.ts's client);
 * the ledger is the real module over the in-memory store, rows inserted through
 * the real insertP3Intent.
 */
import { memLedgerStore } from './helpers/ledger-fake'
import type { LedgerStore } from '@/lib/packs/use-ledger'

const mockLedger: { current: LedgerStore | null } = { current: null }
jest.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerListFor: async () => [] }))
const auditMock = jest.fn()
jest.mock('@/lib/audit', () => ({ audit: (e: unknown) => auditMock(e) }))
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: jest.fn() }))
jest.mock('@/lib/recording/take-audio', () => ({ resolveTakeAudio: async () => 'absent' }))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ storage: { from: () => ({ list: async () => ({ data: [], error: null }) }) } }),
}))
jest.mock('@/lib/packs/use-ledger', () => ({
  ...jest.requireActual('@/lib/packs/use-ledger'),
  defaultLedgerStore: jest.fn(async () => {
    if (!mockLedger.current) throw new Error('ledger unavailable')
    return mockLedger.current
  }),
}))

import { watchOneBusiness } from '@/lib/audit-watch/run'
import { newSynqedClient } from '@/lib/synqed/client'
import { insertP3Intent } from '@/lib/packs/use-ledger'

const BIZ = 'biz-1'
const NOW = new Date('2026-09-11T05:00:00.000Z')
const OLD = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
const FAR_DEADLINE = Date.now() + 60_000

function session(appointmentId: string | null) {
  return {
    id: 'sess-old', business_id: BIZ, customer_id: 'cust-1', store_id: 'store-1', staff_id: 'staff-1',
    appointment_id: appointmentId, audio_storage_path: null, duration_seconds: 300, status: 'RECORDED',
    created_at: OLD, updated_at: OLD,
  }
}

/** audit-watch-run.test.ts's one 失敗-row client; the session's own Recording
 *  names appt-1, and core holds a pack p1 (10, 7 settled → 残3) for the ledger fold. */
function makeClient(opts: { serverRedeemed?: boolean } = {}) {
  return {
    recordings: {
      list: jest.fn(async () => ({ recordings: [session(null)], total: 1 })),
      get: jest.fn(async () => session('appt-1')),
    },
    karuteRecords: { list: jest.fn(async () => ({ karute_records: [], total: 0 })) },
    recordingJobs: { getByRecordingSession: jest.fn(async () => { throw { status: 404 } }) },
    recordingDiscards: { list: jest.fn(async () => ({ events: [], total: 0, page: 1, page_size: 200 })) },
    audit: { list: jest.fn(async () => ({ events: [], total: 0, page: 1, page_size: 50 })) },
    packs: {
      listRecentRedemptions: jest.fn(async () => (opts.serverRedeemed ? [{ appointment_id: 'appt-1' }] : [])),
      listActivePacks: async () => [{ id: 'p1', kind: 'pack', customer_id: 'cust-1', pack_size: 10, unit_price: 1000 }],
      listAllRedemptionPackIds: async () => Array(7).fill('p1'),
      listLifecycles: async () => [],
      listVisitDismissals: async () => [],
    },
  }
}

async function pendingUseOnAppt1(store: LedgerStore) {
  return insertP3Intent(store, {
    businessId: BIZ, ownerUserId: null, source: 'no_show', customerId: 'cust-1',
    appointmentId: 'appt-1', bookingDay: '2026-09-08', packId: 'p1', createdBy: null,
  })
}

async function ticketBurned(): Promise<unknown> {
  const result = await watchOneBusiness(BIZ, NOW, 'write', FAR_DEADLINE)
  expect(result).toMatchObject({ candidates: 1, written: 1 })
  expect(auditMock).toHaveBeenCalledTimes(1)
  const detail = (auditMock.mock.calls[0][0] as { detail: Record<string, unknown> }).detail
  expect(detail.appointment_id).toBe('appt-1')
  return detail.ticket_burned
}

beforeEach(() => {
  jest.clearAllMocks()
  mockLedger.current = memLedgerStore()
  ;(newSynqedClient as jest.Mock).mockReturnValue(makeClient())
})

describe('audit-watch karute_missing — an open ledger use is a burn (§ 6b consumer 6)', () => {
  it('baseline: no server redemption and no ledger use → ticket_burned false', async () => {
    expect(await ticketBurned()).toBe(false)
  })

  it('the visit\'s only burn is a PENDING ledger use → ticket_burned true (no false 「visit with no burn」)', async () => {
    const row = await pendingUseOnAppt1(mockLedger.current as LedgerStore)
    expect(row.state).toBe('pending')
    expect(await ticketBurned()).toBe(true)
  })

  it('a ledger whose read FAILS falls back to the server-only answer (false here), never a throw', async () => {
    await pendingUseOnAppt1(mockLedger.current as LedgerStore)
    mockLedger.current = { ...(mockLedger.current as LedgerStore), listForCustomers: async () => { throw new Error('ledger down') } }
    expect(await ticketBurned()).toBe(false)
  })

  it('an unavailable ledger (no store) → the server-only answer; a server redemption still reads true', async () => {
    mockLedger.current = null
    expect(await ticketBurned()).toBe(false)
    auditMock.mockClear()
    ;(newSynqedClient as jest.Mock).mockReturnValue(makeClient({ serverRedeemed: true }))
    expect(await ticketBurned()).toBe(true)
  })
})
