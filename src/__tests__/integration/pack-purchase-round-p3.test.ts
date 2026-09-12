/**
 * 回数券 update 25, Layer 1, p3 — nextPurchaseRound counts only REAL
 * PURCHASES (an ALLOW-list: status 'active' or 'exhausted'), so a cancelled
 * pack never inflates the next real purchase's 購入回数. docs/
 * store-transfer-design.md §7.4 named this exact bug six weeks before this
 * fix ("nextRound counts cancelled packs toward the next round — a voided
 * first pack can produce a 2枚目 label").
 */
import { nextPurchaseRound, type TicketPack } from '@/lib/packs/types'

type Row = Pick<TicketPack, 'kind' | 'purchase_round' | 'status'>

const row = (purchase_round: number, status: Row['status'], kind: Row['kind'] = 'pack'): Row => ({
  kind,
  purchase_round,
  status,
})

describe('nextPurchaseRound — an allow-list of REAL purchases', () => {
  it('rounds [1, 2, 3(cancelled)] → 3 (the cancelled round-3 pack does not count)', () => {
    expect(
      nextPurchaseRound([row(1, 'active'), row(2, 'active'), row(3, 'cancelled')]),
    ).toBe(3)
  })

  it('a customer whose only pack was cancelled is a first-timer again → next = 1', () => {
    expect(nextPurchaseRound([row(1, 'cancelled')])).toBe(1)
  })

  it('rounds [1, 2], both real → next = 3', () => {
    expect(nextPurchaseRound([row(1, 'active'), row(2, 'exhausted')])).toBe(3)
  })

  it('a future void status (CORE-12, not yet on this repo`s PackStatus union) is excluded too — the allow-list needs no update', () => {
    const voidRow = { kind: 'pack', purchase_round: 3, status: 'void' } as unknown as Row
    expect(nextPurchaseRound([row(1, 'active'), row(2, 'active'), voidRow])).toBe(3)
  })

  it('a subscription row is ignored as before, regardless of status', () => {
    expect(
      nextPurchaseRound([row(1, 'active'), row(5, 'active', 'subscription')]),
    ).toBe(2)
  })

  it('no packs at all → 1 (初回)', () => {
    expect(nextPurchaseRound([])).toBe(1)
  })
})

// The single caller (packs.ts:75, createPackActionWithClient) — wired end to
// end so the allow-list actually reaches the derived 購入回数 a new pack gets.
const mockCreatePack = jest.fn(async (_synqed: unknown, _input: unknown) => ({
  ok: true,
  id: 'pack-new',
}))
const mockListCustomerPacks = jest.fn(async (_synqed: unknown, _id: string) => [] as unknown[])
jest.mock('@/lib/packs/store', () => ({
  createPackWithClient: (synqed: unknown, input: unknown) => mockCreatePack(synqed, input as never),
  listCustomerPacksWithClient: (synqed: unknown, id: string) => mockListCustomerPacks(synqed, id as never),
  addRedemptionWithClient: jest.fn(),
  removeRedemption: jest.fn(),
  updatePackStatus: jest.fn(),
  setCustomerLifecycleWithClient: jest.fn(),
  findCustomerAppointmentForDateWithClient: jest.fn(),
  addVisitReconcileDismissalWithClient: jest.fn(),
  addCustomerContactWithClient: jest.fn(),
  addPackAlertDismissalWithClient: jest.fn(),
}))
jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: async () => ({}) }))
jest.mock('@/lib/staff', () => ({ getCurrentUserStaffId: jest.fn(async () => 'staff-1') }))
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  unstable_cache: jest.fn((fn: (...a: unknown[]) => unknown) => fn),
  updateTag: jest.fn(),
}))

import { createPackAction } from '@/actions/packs'

beforeEach(() => {
  jest.clearAllMocks()
  mockCreatePack.mockImplementation(async () => ({ ok: true, id: 'pack-new' }))
})

describe('createPackActionWithClient (via createPackAction) — the live case: a cancelled 3回目 must not become 4回目', () => {
  it('初回 + 2枚目 (active) + 3回目 (cancelled) → the next real purchase derives 3', async () => {
    mockListCustomerPacks.mockResolvedValueOnce([
      row(1, 'active'),
      row(2, 'active'),
      row(3, 'cancelled'),
    ])
    await createPackAction({ customerId: 'cust-1', kind: 'pack', packSize: 10, unitPrice: 9900 })
    expect(mockCreatePack).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ purchaseRound: 3 }),
    )
  })
})
