/**
 * A THROWN pre-core read answers the memory action's OWN failure shape
 * (Round 3 leg 5, 2026-09-25).
 *
 * addMemoryItemAction / relearnCustomerMemoryAction / upsertPassportFieldAction
 * used to swallow getBusinessId() to null and thread it into cores that write
 * business_id: businessId ?? null — and a getSynqedClient() throw rejected the
 * action outright, which CustomerMemoryCard's bare await turns into a card
 * stuck busy. Now a throw from either read logs and resolves the failure
 * shape, and the core never runs.
 */
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: jest.fn(async () => 'ja') }))
jest.mock('@/lib/staff', () => ({ getBusinessId: jest.fn() }))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn() }))
jest.mock('@/lib/subscription/feature-gate', () => ({ featureAllowed: jest.fn(async () => true) }))
jest.mock('@/actions/dev-tools', () => ({ canUseDevRegen: jest.fn(async () => true) }))
jest.mock('@/actions/org-settings', () => ({ getOrgSettings: jest.fn(async () => ({ business_type: 'salon' })) }))
jest.mock('@/lib/customers/memory.core', () => ({
  addMemoryItemWithClient: jest.fn(async () => ({ ok: true })),
  deleteMemoryItemWithClient: jest.fn(),
  relearnCustomerMemoryWithClient: jest.fn(async () => ({ ok: true, items: 3 })),
  toggleMemoryPinWithClient: jest.fn(),
  updateMemoryItemWithClient: jest.fn(),
  upsertPassportFieldWithClient: jest.fn(async () => ({ ok: true })),
}))

import {
  addMemoryItemAction,
  relearnCustomerMemoryAction,
  upsertPassportFieldAction,
} from '@/actions/memory'
import { getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import * as cores from '@/lib/customers/memory.core'

const businessId = getBusinessId as unknown as jest.Mock
const synqedClient = getSynqedClient as unknown as jest.Mock
const CLIENT = { customers: {} }

const CASES = [
  {
    name: 'addMemoryItemAction',
    run: () => addMemoryItemAction({ customerId: 'c1', category: 'goal', label: 'x' }),
    core: cores.addMemoryItemWithClient as unknown as jest.Mock,
    fail: { ok: false },
    happy: { ok: true },
    happyCall: [CLIENT, 'biz-1', { customerId: 'c1', category: 'goal', label: 'x' }],
  },
  {
    name: 'relearnCustomerMemoryAction',
    run: () => relearnCustomerMemoryAction('c1'),
    core: cores.relearnCustomerMemoryWithClient as unknown as jest.Mock,
    fail: { ok: false, items: 0 },
    happy: { ok: true, items: 3 },
    happyCall: [CLIENT, { businessId: 'biz-1', locale: 'ja', planAllowed: true, regenAllowed: true }, 'c1'],
  },
  {
    name: 'upsertPassportFieldAction',
    run: () => upsertPassportFieldAction({ customerId: 'c1', fieldKey: 'k', value: 'v' }),
    core: cores.upsertPassportFieldWithClient as unknown as jest.Mock,
    fail: { ok: false },
    happy: { ok: true },
    happyCall: [CLIENT, 'biz-1', 'salon', { customerId: 'c1', fieldKey: 'k', value: 'v' }],
  },
]

let consoleError: jest.SpyInstance
beforeEach(() => {
  jest.clearAllMocks()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  businessId.mockResolvedValue('biz-1')
  synqedClient.mockResolvedValue(CLIENT)
})
afterEach(() => consoleError.mockRestore())

describe.each(CASES)('$name — a thrown pre-core read resolves the failure shape', (c) => {
  it('getBusinessId throws → failure shape, core never runs', async () => {
    businessId.mockRejectedValue(new Error('core down'))
    await expect(c.run()).resolves.toEqual(c.fail)
    expect(c.core).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('getSynqedClient throws → failure shape, core never runs', async () => {
    synqedClient.mockRejectedValue(new Error('core down'))
    await expect(c.run()).resolves.toEqual(c.fail)
    expect(c.core).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('happy path unchanged', async () => {
    await expect(c.run()).resolves.toEqual(c.happy)
    expect(c.core).toHaveBeenCalledWith(...c.happyCall)
    expect(consoleError).not.toHaveBeenCalled()
  })
})
