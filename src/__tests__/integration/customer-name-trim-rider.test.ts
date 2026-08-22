/**
 * F4 rider (§2h) — root cause: CustomerFormSchema.name checked LENGTH
 * (.min(1)) but never non-whitespace, so a three-space name passed
 * validation untouched and rode into a recording target's customerName,
 * landing blank in DiscreetRecordingIndicator's popover (that display seam
 * is pinned separately, discreet-indicator-target-carry.test.tsx). Pin:
 * whitespace-only was PASSING before this fix (red-run vs the old schema —
 * documented below since the old schema no longer exists to run against);
 * the trim+reject now matches createQuickCustomer's existing behavior.
 */
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  // customers.ts's own module chain (require-permission.ts → staff.ts) mints
  // an unstable_cache(...) instance at module scope — unrelated to this
  // suite's assertions, but the import graph loads it regardless.
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next-intl/server', () => ({ getTranslations: jest.fn(async () => (k: string) => k) }))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => undefined) }))

const create = jest.fn(async (input: { name: string }) => ({ id: 'cust-new', name: input.name }))
const checkDuplicate = jest.fn(async () => ({ exists: false }))
jest.mock('@/lib/synqed/client', () => ({
  getSynqedClient: jest.fn(async () => ({ customers: { create, checkDuplicate } })),
}))

import { createCustomer } from '@/actions/customers'

beforeEach(() => jest.clearAllMocks())

describe('CustomerFormSchema — whitespace-only name (rider §2h)', () => {
  it('rejects a whitespace-only name — never reaches customers.create', async () => {
    const result = await createCustomer({ name: '   ' } as never)
    expect(result).toEqual({ success: false, error: 'Name is required' })
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects an empty name the same way (baseline, unchanged)', async () => {
    const result = await createCustomer({ name: '' } as never)
    expect(result).toEqual({ success: false, error: 'Name is required' })
    expect(create).not.toHaveBeenCalled()
  })

  it('trims surrounding whitespace off a real name before it reaches customers.create', async () => {
    const result = await createCustomer({ name: '  田中 美咲  ' } as never)
    expect(result).toMatchObject({ success: true })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: '田中 美咲' }))
  })

  it('a name that is only-interior-whitespace-preserving still validates normally', async () => {
    const result = await createCustomer({ name: '田中 美咲' } as never)
    expect(result).toMatchObject({ success: true })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: '田中 美咲' }))
  })
})
