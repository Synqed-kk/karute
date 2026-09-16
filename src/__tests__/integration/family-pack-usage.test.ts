jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(() => ({})) }))
import { listAllPackUsageWithClient, listCustomerPacksWithClient } from '@/lib/packs/store'

describe('family pack displays', () => {
  it('shows the held balance and burn target on every member but counts money only once', async () => {
    const client = { packs: {
      listActivePacks: async () => [{ id: 'pack', customer_id: 'parent', kind: 'pack', pack_size: 5, unit_price: 5000, eligible_customer_ids: ['parent','child','child'] }],
      listAllRedemptionPackIds: async () => ['pack','pack'],
    } }
    const usage = await listAllPackUsageWithClient(client as never)
    expect(usage.get('parent')).toMatchObject({ remaining: 3, size: 5, firstPackId: 'pack', unconsumed: 15000, ownsActivePack: true })
    expect(usage.get('child')).toMatchObject({ remaining: 3, size: 5, firstPackId: 'pack', unconsumed: 0, ownsActivePack: false })
    expect([...usage.values()].reduce((sum, row) => sum + row.unconsumed, 0)).toBe(15000)
  })
  it('uses the full Core usage snapshot in a visitor’s pack picker', async () => {
    const client = { packs: {
      listPacks: async () => [{ id: 'pack', customer_id: 'parent', kind: 'pack', pack_size: 5, unit_price: 5000, status: 'active', usage_count: 4, usage_last_redeemed_on: '2026-09-07' }],
      listRedemptions: async () => [{ pack_id: 'pack', redeemed_on: '2026-09-06' }],
    } }
    expect(await listCustomerPacksWithClient(client as never, 'child')).toEqual([expect.objectContaining({ redeemedCount: 4, remaining: 1, lastRedeemedOn: '2026-09-07' })])
  })
  it('keeps older Core response compatibility', async () => {
    const client = { packs: {
      listPacks: async () => [{ id: 'pack', customer_id: 'parent', kind: 'pack', pack_size: 5, unit_price: 5000, status: 'active' }],
      listRedemptions: async () => [{ pack_id: 'pack', redeemed_on: '2026-09-06' }],
    } }
    expect(await listCustomerPacksWithClient(client as never, 'parent')).toEqual([expect.objectContaining({ redeemedCount: 1, remaining: 4 })])
  })
})
