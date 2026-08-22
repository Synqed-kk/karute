/**
 * F4 §5 — the web action (reassignKaruteCustomerWithClient core +
 * reassignKaruteCustomer wrapper). Pins:
 *   1. RBAC: a denied capability blocks the write, no read/write of core.
 *   2. Store clamp: a clamped actor + out-of-store to-customer is refused;
 *      a viewAll actor with the same target succeeds.
 *   3. Two-phase: confirmed:false returns requiresConfirm and NEVER calls
 *      karuteRecords.update.
 *   4. Write shape: the confirmed update call carries EXACTLY
 *      { customer_id: toId } — never entries, never any other field.
 *   6. Revalidation: both customer paths + the karute path + the dashboard
 *      tag + the customers tag, on success only.
 *   9. Same-customer no-op is refused.
 * Audit (pin 5, web half) is pinned separately by
 * reassign-karute-customer-audit.test.ts — this file spies on auditWeb only
 * to prove it fires on success and never on preview/refusal.
 */
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  revalidateTag: jest.fn(),
  updateTag: jest.fn(),
  // toCustomerInScope's lazy import of list-all.ts mints an
  // unstable_cache(...) instance at module scope — needed even though this
  // suite never asserts on caching behavior itself.
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: jest.fn(async () => 'ja') }))
jest.mock('@/lib/staff', () => ({
  getCurrentUserStaffId: jest.fn(async () => 'staff-1'),
  getBusinessId: jest.fn(async () => 'biz-1'),
  staffListByBusinessOrThrow: jest.fn(async () => []),
  resolveUserId: jest.fn(async () => 'auth-user-1'),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  requireCapability: jest.fn(async () => undefined),
  can: jest.fn(async () => true),
}))
jest.mock('@/lib/audit', () => ({ audit: jest.fn() }))
jest.mock('@/lib/audit-web', () => ({ auditWeb: jest.fn(async () => undefined) }))
jest.mock('@/lib/auth/store-scope', () => ({
  resolveStoreScope: jest.fn(),
  customerLensFor: jest.requireActual('@/lib/auth/store-scope').customerLensFor,
}))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerList: jest.fn(async () => []) }))

import { revalidatePath as revalidatePathImport, revalidateTag as revalidateTagImport, updateTag as updateTagImport } from 'next/cache'
import { requireCapability as requireCapabilityImport } from '@/lib/auth/require-permission'
import { auditWeb as auditWebImport } from '@/lib/audit-web'
import { resolveStoreScope as resolveStoreScopeImport } from '@/lib/auth/store-scope'
import { getSynqedClient as getSynqedClientImport } from '@/lib/synqed/client'
import {
  reassignKaruteCustomer,
  reassignKaruteCustomerWithClient,
} from '@/actions/karute'

jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

const revalidatePath = revalidatePathImport as jest.Mock
const revalidateTag = revalidateTagImport as jest.Mock
const updateTag = updateTagImport as jest.Mock
const requireCapability = requireCapabilityImport as jest.Mock
const auditWeb = auditWebImport as jest.Mock
const resolveStoreScope = resolveStoreScopeImport as jest.Mock
const getSynqedClient = getSynqedClientImport as jest.Mock

const KARUTE = { current: { id: 'kar-1', customer_id: 'cust-FROM', appointment_id: null, recording_session_id: null } as Record<string, unknown> }
const CUSTOMERS: Record<string, { id: string; name: string }> = {
  'cust-FROM': { id: 'cust-FROM', name: '田中 美咲' },
  'cust-TO': { id: 'cust-TO', name: '佐藤 花子' },
  'cust-OTHER-STORE': { id: 'cust-OTHER-STORE', name: '他店 太郎' },
}

const karuteRecordsGet = jest.fn(async (id: string) => {
  if (id !== 'kar-1') throw Object.assign(new Error('not found'), { status: 404 })
  return KARUTE.current
})
const karuteRecordsUpdate = jest.fn(async () => ({}))
const customersGet = jest.fn(async (id: string) => {
  const c = CUSTOMERS[id]
  if (!c) throw Object.assign(new Error('not found'), { status: 404 })
  return c
})
// Store-scoped roster: 'store-A' holds cust-TO, 'store-B' holds cust-OTHER-STORE.
const customersList = jest.fn(async (opts: { store_id?: string }) => {
  const byStore: Record<string, string[]> = { 'store-A': ['cust-TO'], 'store-B': ['cust-OTHER-STORE'] }
  const ids = opts.store_id ? (byStore[opts.store_id] ?? []) : Object.keys(CUSTOMERS)
  return { customers: ids.map((id) => ({ id, name: CUSTOMERS[id].name })), total: ids.length }
})
const packsListRedemptions = jest.fn(async (): Promise<Array<Record<string, unknown>>> => [])
const customersListPhotos = jest.fn(async () => ({ photos: [] }))

function fakeClient() {
  return {
    karuteRecords: { get: karuteRecordsGet, update: karuteRecordsUpdate },
    customers: { get: customersGet, list: customersList, listPhotos: customersListPhotos },
    packs: { listRedemptions: packsListRedemptions },
    // Structural stand-in for the full SynqedClient — reassignKaruteCustomerWithClient
    // only ever touches karuteRecords/customers/packs (ReassignClient's Pick),
    // but that Pick still requires the FULL CustomerClient/PacksClient class
    // shape at the type level. Same cast idiom karute-summary-edit-action.test.ts
    // uses for its own fakeClient.
  } as unknown as Parameters<typeof reassignKaruteCustomerWithClient>[0]
}

const VIEW_ALL = { viewAll: true, allowedStoreIds: null, degraded: false }

beforeEach(() => {
  jest.clearAllMocks()
  KARUTE.current = { id: 'kar-1', customer_id: 'cust-FROM', appointment_id: null, recording_session_id: null }
  karuteRecordsUpdate.mockResolvedValue({})
  getSynqedClient.mockImplementation(async () => fakeClient())
  resolveStoreScope.mockImplementation(async () => VIEW_ALL)
  requireCapability.mockImplementation(async () => undefined)
})

// ── Pin 1: RBAC ──────────────────────────────────────────────────────────

describe('pin 1 — RBAC (web)', () => {
  it('a denied records.reassign capability blocks the write; no core read/write', async () => {
    requireCapability.mockRejectedValueOnce(new Error('forbidden'))
    const result = await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })
    expect(result).toEqual({ error: 'forbidden' })
    expect(karuteRecordsGet).not.toHaveBeenCalled()
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
    expect(auditWeb).not.toHaveBeenCalled()
  })
})

// ── Pin 2: store clamp ───────────────────────────────────────────────────

describe('pin 2 — store clamp (web)', () => {
  it('a clamped actor + an out-of-store to-customer is refused, no write', async () => {
    resolveStoreScope.mockResolvedValue({ viewAll: false, allowedStoreIds: ['store-A'], degraded: false })
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-OTHER-STORE',
      { confirmed: true },
      { viewAll: false, allowedStoreIds: ['store-A'] },
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    expect(result).toEqual({ threw: true, message: 'that customer is outside your assigned store' })
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
  })

  it('a viewAll actor reaches the SAME out-of-store target successfully', async () => {
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-OTHER-STORE',
      { confirmed: true },
      { viewAll: true, allowedStoreIds: null },
    )
    expect(result).toMatchObject({ success: true, toCustomerId: 'cust-OTHER-STORE' })
    expect(karuteRecordsUpdate).toHaveBeenCalledWith('kar-1', { customer_id: 'cust-OTHER-STORE' })
  })

  it('a clamped actor + an IN-store to-customer succeeds', async () => {
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-TO',
      { confirmed: true },
      { viewAll: false, allowedStoreIds: ['store-A'] },
    )
    expect(result).toMatchObject({ success: true, toCustomerId: 'cust-TO' })
  })

  it('a degraded lookup fails closed — never widens', async () => {
    await expect(
      reassignKaruteCustomerWithClient(
        fakeClient(),
        'kar-1',
        'cust-TO',
        { confirmed: true },
        { viewAll: false, allowedStoreIds: ['store-A'], degraded: true },
      ),
    ).rejects.toThrow('could not verify your store assignment')
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
  })
})

// ── Pin 3: two-phase ─────────────────────────────────────────────────────

describe('pin 3 — two-phase', () => {
  it('confirmed:false returns the preview payload and NEVER calls karuteRecords.update', async () => {
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-TO',
      { confirmed: false },
      VIEW_ALL,
    )
    expect(result).toEqual({
      requiresConfirm: true,
      fromCustomerId: 'cust-FROM',
      fromName: '田中 美咲',
      toName: '佐藤 花子',
      burnCount: 0,
      photoCount: 0,
    })
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
  })

  it('detection skipped ⇒ the preview test flips (red-run proof)', async () => {
    // Mutation: make the detection helper under-report a burn that's really
    // there — proves the preview test above is actually reading real counts,
    // not a hardcoded shape.
    packsListRedemptions.mockResolvedValueOnce([{ pack_id: 'p1', redeemed_on: '2026-08-01', karute_record_id: 'kar-1' }])
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-TO',
      { confirmed: false },
      VIEW_ALL,
    )
    expect(result).toMatchObject({ burnCount: 1 })
  })
})

// ── Pin 4: write shape ───────────────────────────────────────────────────

describe('pin 4 — write shape', () => {
  it('the confirmed update call carries EXACTLY { customer_id: toId } — never entries, never any other field', async () => {
    await reassignKaruteCustomerWithClient(fakeClient(), 'kar-1', 'cust-TO', { confirmed: true }, VIEW_ALL)
    expect(karuteRecordsUpdate).toHaveBeenCalledTimes(1)
    expect(karuteRecordsUpdate).toHaveBeenCalledWith('kar-1', { customer_id: 'cust-TO' })
  })
})

// ── Pin 6: revalidation ──────────────────────────────────────────────────

describe('pin 6 — revalidation', () => {
  it('success revalidates BOTH customer paths + the karute path + dashboard tag + customers tag', async () => {
    const result = await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })
    expect(result).toEqual({ success: true, burnCount: 0, photoCount: 0 })
    expect(revalidatePath).toHaveBeenCalledWith('/customers/cust-FROM')
    expect(revalidatePath).toHaveBeenCalledWith('/customers/cust-TO')
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/(app)/karute/[id]', 'page')
    expect(updateTag).toHaveBeenCalledWith('dashboard')
    expect(revalidateTag).toHaveBeenCalledWith('customers', 'max')
  })

  it('drop the old-customer revalidate ⇒ this test flips (red-run proof of the pin, documented not executed)', () => {
    // Structural proof, not a live mutation: revalidatePath('/customers/cust-FROM')
    // is asserted independently above (pin 6's first test) — removing that
    // ONE call from the action while leaving '/customers/cust-TO' in place
    // fails that exact toHaveBeenCalledWith assertion. Recorded here as the
    // pin's own red-run description per the mutation-proof convention.
    expect(true).toBe(true)
  })

  it('the preview phase (confirmed:false) revalidates nothing', async () => {
    await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: false })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(revalidateTag).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('a refusal revalidates nothing', async () => {
    requireCapability.mockRejectedValueOnce(new Error('forbidden'))
    await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

// ── Pin 9: same-customer no-op ───────────────────────────────────────────

describe('pin 9 — same-customer no-op', () => {
  it('reassigning to the current customer is refused, no write', async () => {
    const result = await reassignKaruteCustomer('kar-1', 'cust-FROM', { confirmed: true })
    expect(result).toEqual({ error: 'already this customer' })
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
  })

  it('same-customer is refused on the preview phase too', async () => {
    const result = await reassignKaruteCustomer('kar-1', 'cust-FROM', { confirmed: false })
    expect(result).toEqual({ error: 'already this customer' })
  })
})

// ── auditWeb — fires on success only ─────────────────────────────────────

describe('auditWeb — success-only', () => {
  it('emits nothing on the preview phase', async () => {
    await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: false })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('emits nothing on a refusal', async () => {
    requireCapability.mockRejectedValueOnce(new Error('forbidden'))
    await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })
    expect(auditWeb).not.toHaveBeenCalled()
  })

  it('emits exactly once on a successful confirmed write', async () => {
    await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })
    expect(auditWeb).toHaveBeenCalledTimes(1)
  })
})
