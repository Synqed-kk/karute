/**
 * Server-side owner gate on 再学習 (relearnCustomerMemoryAction).
 *
 * The UI hides the trigger for non-owners, but the exported server action must
 * refuse on its own: a non-owner call returns ok:false BEFORE any wipe or
 * transcript reprocessing fires (the action's cost scales with the customer's
 * entire session history).
 */

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: jest.fn().mockResolvedValue('ja') }))
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn().mockResolvedValue('biz-A') }))
jest.mock('@/actions/dev-tools', () => ({ canUseDevRegen: jest.fn().mockResolvedValue(false) }))
jest.mock('@/lib/karute/customer-memory', () => ({
  getMemoryItemCustomerId: jest.fn(),
  addStaffMemoryItem: jest.fn(),
  updateMemoryItem: jest.fn(),
  setMemoryItemPinned: jest.fn(),
  softDeleteMemoryItem: jest.fn(),
  softDeleteAiExtractionItems: jest.fn(),
  restoreMemoryItems: jest.fn(),
  upsertPassportField: jest.fn(),
}))
jest.mock('@/lib/customers/queries', () => ({ getCustomer: jest.fn() }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))
jest.mock('@/lib/karute/synqed-records', () => ({ listSynqedKaruteRows: jest.fn() }))
jest.mock('@/lib/karute/memory-ingest', () => ({ backfillMemoryFromTranscripts: jest.fn() }))

import { relearnCustomerMemoryAction } from '@/actions/memory'

const devTools = jest.requireMock('@/actions/dev-tools') as { canUseDevRegen: jest.Mock }
const memoryLib = jest.requireMock('@/lib/karute/customer-memory') as Record<string, jest.Mock>
const records = jest.requireMock('@/lib/karute/synqed-records') as { listSynqedKaruteRows: jest.Mock }

describe('relearn owner gate (server-side)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('non-owner: refused before any read or wipe', async () => {
    devTools.canUseDevRegen.mockResolvedValue(false)
    const res = await relearnCustomerMemoryAction('c1')
    expect(res).toEqual({ ok: false, items: 0 })
    expect(records.listSynqedKaruteRows).not.toHaveBeenCalled()
    expect(memoryLib.softDeleteAiExtractionItems).not.toHaveBeenCalled()
  })

  it('owner: proceeds past the gate into the relearn flow', async () => {
    devTools.canUseDevRegen.mockResolvedValue(true)
    records.listSynqedKaruteRows.mockResolvedValue([])
    const { getSynqedClient } = jest.requireMock('@/lib/synqed/client') as { getSynqedClient: jest.Mock }
    getSynqedClient.mockResolvedValue({})
    const res = await relearnCustomerMemoryAction('c1')
    // Zero transcripts → ok:false, but the flow DID run (rows were listed).
    expect(records.listSynqedKaruteRows).toHaveBeenCalled()
    expect(res.ok).toBe(false)
  })
})
