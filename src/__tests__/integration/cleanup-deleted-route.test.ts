/**
 * Nightly hard-delete sweep (/api/cleanup-deleted).
 *
 * Contracts under test:
 *  - CRON_SECRET fail-closed (unset or mismatched → 401, nothing runs).
 *  - Due-filter: ONLY rows with a non-null deleted_at past the 30-day
 *    deadline are purged — active customers (deleted_at null) and
 *    still-in-window customers are untouched. (A naive new Date(null)
 *    compare would mark every active customer due — the regression this
 *    file exists to catch.)
 *  - Purge order: karute records + recordings + memory items before the
 *    customer hard delete; executed audit row with counts after.
 *  - Undo-vs-sweep race: the pre-purge re-fetch skips a customer whose
 *    deleted_at was nulled after the list snapshot.
 *  - Per-customer failure isolation: one bad row doesn't stop the sweep.
 */

jest.mock('next/cache', () => ({ revalidateTag: jest.fn() }))

const profilesQuery = {
  select: jest.fn().mockReturnThis(),
  not: jest.fn(async () => ({
    data: [{ business_id: 'biz-1' }],
    error: null,
  })),
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn(() => ({ from: jest.fn(() => profilesQuery) })),
}))
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: jest.fn() }))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))

import { GET } from '@/app/api/cleanup-deleted/route'
import { newSynqedClient as newSynqedClientImport } from '@/lib/synqed/client'
import { audit as auditImport } from '@/lib/audit'

const newSynqedClient = newSynqedClientImport as jest.Mock
const audit = auditImport as jest.Mock

const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString()

const synqed = {
  customers: { list: jest.fn(), get: jest.fn(), delete: jest.fn() },
  karuteRecords: { list: jest.fn(), delete: jest.fn() },
  recordings: { list: jest.fn(), delete: jest.fn() },
  customerMemory: { list: jest.fn(), delete: jest.fn() },
}

function req(secret?: string) {
  return new Request('http://localhost/api/cleanup-deleted', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret'
  newSynqedClient.mockReturnValue(synqed)
  synqed.customers.list.mockResolvedValue({ customers: [], total: 0 })
  synqed.customers.get.mockImplementation(async (id: string) => ({
    id,
    deleted_at: iso(31),
  }))
  synqed.customers.delete.mockResolvedValue(undefined)
  synqed.karuteRecords.list.mockResolvedValue({ karute_records: [], total: 0 })
  synqed.recordings.list.mockResolvedValue({ recordings: [], total: 0 })
  synqed.customerMemory.list.mockResolvedValue({ items: [] })
})

describe('auth', () => {
  it('401s with no secret configured (fail closed) and with a bad token', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req('anything'))).status).toBe(401)
    process.env.CRON_SECRET = 'cron-secret'
    expect((await GET(req('wrong'))).status).toBe(401)
    expect(newSynqedClient).not.toHaveBeenCalled()
  })
})

describe('due filter', () => {
  it('purges ONLY expired-window customers — never actives (null deleted_at) or in-window rows', async () => {
    synqed.customers.list.mockResolvedValue({
      customers: [
        { id: 'active', deleted_at: null },
        { id: 'no-field' }, // SDK row without the field at all
        { id: 'in-window', deleted_at: iso(5) },
        { id: 'due', deleted_at: iso(31) },
      ],
      total: 4,
    })
    const res = await GET(req('cron-secret'))
    const body = await res.json()

    expect(synqed.customers.delete).toHaveBeenCalledTimes(1)
    expect(synqed.customers.delete).toHaveBeenCalledWith('due')
    expect(body.due).toBe(1)
    expect(body.executed).toBe(1)
  })
})

describe('purge order + audit trail', () => {
  it('deletes records, recordings, and memory before the customer, then writes the executed row with counts', async () => {
    synqed.customers.list.mockResolvedValue({
      customers: [{ id: 'due', deleted_at: iso(31) }],
      total: 1,
    })
    synqed.karuteRecords.list
      .mockResolvedValueOnce({ karute_records: [{ id: 'k1' }, { id: 'k2' }], total: 2 })
      .mockResolvedValue({ karute_records: [], total: 0 })
    synqed.recordings.list
      .mockResolvedValueOnce({ recordings: [{ id: 'r1' }], total: 1 })
      .mockResolvedValue({ recordings: [], total: 0 })
    synqed.customerMemory.list.mockResolvedValue({ items: [{ id: 'm1' }] })

    await GET(req('cron-secret'))

    expect(synqed.karuteRecords.delete).toHaveBeenCalledWith('k1')
    expect(synqed.karuteRecords.delete).toHaveBeenCalledWith('k2')
    expect(synqed.recordings.delete).toHaveBeenCalledWith('r1')
    expect(synqed.customerMemory.delete).toHaveBeenCalledWith('m1')
    // Children purged before the customer row.
    const customerDeleteOrder = synqed.customers.delete.mock.invocationCallOrder[0]
    expect(synqed.karuteRecords.delete.mock.invocationCallOrder[0]).toBeLessThan(
      customerDeleteOrder,
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'privacy.customer_delete_executed',
        actorType: 'system',
        actorId: null,
        targetId: 'due',
        detail: { karute_records: 2, recordings: 1, memory_items: 1 },
      }),
    )
  })
})

describe('undo-vs-sweep race', () => {
  it('skips a customer restored after the list snapshot — nothing purged, no audit row', async () => {
    synqed.customers.list.mockResolvedValue({
      customers: [{ id: 'restored', deleted_at: iso(31) }],
      total: 1,
    })
    synqed.customers.get.mockResolvedValue({ id: 'restored', deleted_at: null })

    const res = await GET(req('cron-secret'))
    const body = await res.json()

    expect(synqed.customers.delete).not.toHaveBeenCalled()
    expect(synqed.karuteRecords.delete).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    expect(body.skippedRestored).toBe(1)
    expect(body.executed).toBe(0)
  })
})

describe('purge exhaustion', () => {
  it('never hard-deletes a customer whose record purge cannot complete', async () => {
    synqed.customers.list.mockResolvedValue({
      customers: [{ id: 'heavy', deleted_at: iso(31) }],
      total: 1,
    })
    // List never drains: every pass returns a record (delete not shrinking).
    synqed.karuteRecords.list.mockResolvedValue({
      karute_records: [{ id: 'k-stuck' }],
      total: 1,
    })

    const res = await GET(req('cron-secret'))
    const body = await res.json()

    expect(synqed.customers.delete).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    expect(body.failures).toBe(1)
    expect(body.executed).toBe(0)
  })
})

describe('failure isolation', () => {
  it('a customer that throws does not stop the next one', async () => {
    synqed.customers.list.mockResolvedValue({
      customers: [
        { id: 'bad', deleted_at: iso(31) },
        { id: 'good', deleted_at: iso(31) },
      ],
      total: 2,
    })
    synqed.customers.delete
      .mockRejectedValueOnce(new Error('core hiccup'))
      .mockResolvedValueOnce(undefined)

    const res = await GET(req('cron-secret'))
    const body = await res.json()

    expect(synqed.customers.delete).toHaveBeenCalledTimes(2)
    expect(body.failures).toBe(1)
    expect(body.executed).toBe(1)
  })
})
