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
 * Audit (pin 5, web half) is pinned in THIS file — "auditWeb — success-only"
 * below asserts the row's exact shape, not just that it fired.
 * listReassignCustomerOptions (the picker roster, fix round 2 items B/C) is
 * pinned in its own describe block below.
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
  // Fix round 4: sourceStoreOutOfScope moved here from src/actions/karute.ts
  // (pure predicate) — karute.ts now imports it from this module, so the
  // manual mock must re-expose the real implementation the same way
  // customerLensFor already does above.
  sourceStoreOutOfScope: jest.requireActual('@/lib/auth/store-scope').sourceStoreOutOfScope,
}))
jest.mock('@/lib/customers/cached', () => ({ getCachedCustomerList: jest.fn(async () => []) }))

import { revalidatePath as revalidatePathImport, revalidateTag as revalidateTagImport, updateTag as updateTagImport } from 'next/cache'
import { requireCapability as requireCapabilityImport } from '@/lib/auth/require-permission'
import { auditWeb as auditWebImport } from '@/lib/audit-web'
import { resolveStoreScope as resolveStoreScopeImport } from '@/lib/auth/store-scope'
import { getSynqedClient as getSynqedClientImport } from '@/lib/synqed/client'
import { getCachedCustomerList as getCachedCustomerListImport } from '@/lib/customers/cached'
import {
  reassignKaruteCustomer,
  reassignKaruteCustomerWithClient,
  listReassignCustomerOptions,
} from '@/actions/karute'

jest.mock('@/lib/synqed/client', () => ({ getSynqedClient: jest.fn(), newSynqedClient: jest.fn() }))

const revalidatePath = revalidatePathImport as jest.Mock
const revalidateTag = revalidateTagImport as jest.Mock
const updateTag = updateTagImport as jest.Mock
const requireCapability = requireCapabilityImport as jest.Mock
const auditWeb = auditWebImport as jest.Mock
const resolveStoreScope = resolveStoreScopeImport as jest.Mock
const getSynqedClient = getSynqedClientImport as jest.Mock
const getCachedCustomerList = getCachedCustomerListImport as jest.Mock

// store_id: 'store-A' by default — the store every clamped-actor fixture in
// this file is assigned to (allowedStoreIds: ['store-A']), so pins 1-9 stay
// IN scope and unaffected. R3-1/R5-1 tests override store_id per-case
// ('store-B' foreign, null unlabeled) to exercise the source-store clamp;
// null is no longer a free pass since R5-1 (fail-closed for clamped actors).
const KARUTE = { current: { id: 'kar-1', customer_id: 'cust-FROM', appointment_id: null, recording_session_id: null, store_id: 'store-A' } as Record<string, unknown> }
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

// Roster data for listReassignCustomerOptions (fix round 2, item B): distinct
// from CUSTOMERS' store-A/store-B split above so a store-scoped vs
// business-wide fetch is trivially distinguishable by exact id list.
const ROSTER_BY_STORE: Record<string, Array<{ id: string; name: string }>> = {
  'store-A': [
    { id: 'cust-TO', name: '佐藤 花子' },
    { id: 'cust-FROM', name: '田中 美咲' },
  ],
  'store-B': [{ id: 'cust-OTHER-STORE', name: '他店 太郎' }],
}
const BUSINESS_WIDE_ROSTER = Object.values(CUSTOMERS)

beforeEach(() => {
  jest.clearAllMocks()
  KARUTE.current = { id: 'kar-1', customer_id: 'cust-FROM', appointment_id: null, recording_session_id: null, store_id: 'store-A' }
  karuteRecordsUpdate.mockResolvedValue({})
  getSynqedClient.mockImplementation(async () => fakeClient())
  resolveStoreScope.mockImplementation(async () => VIEW_ALL)
  requireCapability.mockImplementation(async () => undefined)
  getCachedCustomerList.mockImplementation(async (storeId?: string) =>
    storeId === undefined ? BUSINESS_WIDE_ROSTER : (ROSTER_BY_STORE[storeId] ?? []),
  )
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

// ── Pin R3-1: source-store clamp on the SOURCE record (web) ──────────────
// Fix round 3, Greptile issue 1 (REAL): the parent packet's clamp only ever
// proved the TO-customer's store; a clamped actor supplying an out-of-scope
// karute id passed regardless. These pins prove the SOURCE record itself is
// now clamped, on BOTH phases (the preview leaks close too).

describe('pin R3-1 — source-store clamp on the SOURCE record (web)', () => {
  it('clamped actor + an out-of-store SOURCE record is refused, no write (confirmed:true)', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-TO',
      { confirmed: true },
      { viewAll: false, allowedStoreIds: ['store-A'] },
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    // R9-2 (fix round 9, existence-oracle class): message CHANGED from
    // 'this karute belongs to a store you are not assigned to' —
    // store_forbidden let a clamped actor distinguish this from a
    // genuinely nonexistent karute id. Now byte-identical to readKaruteRaw's
    // own not_found (see the comparison pin below).
    expect(result).toEqual({ threw: true, message: 'karute not found in this business' })
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
  })

  it('clamped actor + an out-of-store SOURCE record is refused on the PREVIEW phase too (confirmed:false) — the leak-close half of R3-1', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-TO',
      { confirmed: false },
      { viewAll: false, allowedStoreIds: ['store-A'] },
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    // R9-2 (fix round 9, existence-oracle class): message CHANGED from
    // 'this karute belongs to a store you are not assigned to' —
    // store_forbidden let a clamped actor distinguish this from a
    // genuinely nonexistent karute id. Now byte-identical to readKaruteRaw's
    // own not_found (see the comparison pin below).
    expect(result).toEqual({ threw: true, message: 'karute not found in this business' })
  })

  // R5-1 (Greptile round-2, #759): null-store now FAILS CLOSED for a
  // clamped actor — membership in an unlabeled record is unprovable. This
  // flips the round-3 "ALLOWED" pin; the read-plane 全店舗 convention
  // (resolveKaruteStoreId) is unaffected, only the write/roster proof here.
  it('null-store SOURCE record + clamped actor is REFUSED (R5-1 fail-closed), no write', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: null }
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-TO',
      { confirmed: true },
      { viewAll: false, allowedStoreIds: ['store-A'] },
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    // R9-2 (fix round 9, existence-oracle class): message CHANGED from
    // 'this karute belongs to a store you are not assigned to' —
    // store_forbidden let a clamped actor distinguish this from a
    // genuinely nonexistent karute id. Now byte-identical to readKaruteRaw's
    // own not_found (see the comparison pin below).
    expect(result).toEqual({ threw: true, message: 'karute not found in this business' })
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
  })

  it('null-store SOURCE record + clamped actor is refused on the PREVIEW phase too (confirmed:false)', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: null }
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-TO',
      { confirmed: false },
      { viewAll: false, allowedStoreIds: ['store-A'] },
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    // R9-2 (fix round 9, existence-oracle class): message CHANGED from
    // 'this karute belongs to a store you are not assigned to' —
    // store_forbidden let a clamped actor distinguish this from a
    // genuinely nonexistent karute id. Now byte-identical to readKaruteRaw's
    // own not_found (see the comparison pin below).
    expect(result).toEqual({ threw: true, message: 'karute not found in this business' })
  })

  it('viewAll actor + an out-of-store SOURCE record is ALLOWED', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-TO',
      { confirmed: true },
      { viewAll: true, allowedStoreIds: null },
    )
    expect(result).toMatchObject({ success: true })
  })
})

// ── Pin R9-1/R9-2 (fix round 9, Greptile round-5 3/5) — existence-oracle
// class, both sides ──────────────────────────────────────────────────────
// Greptile: the core fetched the to-customer BEFORE the store clamp, so a
// clamped actor could distinguish "id doesn't exist" (404 not_found) from
// "id exists in another store" (403 store_forbidden) by error shape alone —
// an existence oracle across the whole business, violating the isolation
// law (other stores' existence must stay hidden). Fixed on both the
// destination customer (R9-1: reorder — clamp before lookup) and the
// source karute record (R9-2: reshape — the store-mismatch refusal now
// matches not_found exactly, since the karute read itself can't be
// reordered away).

describe('pin R9-1 — destination clamp runs BEFORE the to-customer lookup', () => {
  it('pin 1: clamped + nonexistent to-id vs clamped + exists-in-other-store to-id → byte-identical refusal', async () => {
    const clamp = { viewAll: false, allowedStoreIds: ['store-A'] }
    const nonexistent = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-DOES-NOT-EXIST',
      { confirmed: true },
      clamp,
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    const existsElsewhere = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-OTHER-STORE', // real customer, but only in store-B's roster
      { confirmed: true },
      clamp,
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    expect(nonexistent).toEqual({ threw: true, message: 'that customer is outside your assigned store' })
    expect(existsElsewhere).toEqual(nonexistent)
  })

  it('pin 2: no customers.get call for an out-of-scope destination — the clamp refuses before any lookup', async () => {
    await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-OTHER-STORE',
      { confirmed: true },
      { viewAll: false, allowedStoreIds: ['store-A'] },
    ).catch(() => undefined)
    // Neither side's customers.get fired — the clamp (roster-membership via
    // customers.LIST, a separate mock) refused before reassignCustomerOrThrow
    // ever ran for either id.
    expect(customersGet).not.toHaveBeenCalled()
  })

  it('pin 4a: viewAll + a genuinely nonexistent to-id still gets the honest not_found (unaffected by the reorder)', async () => {
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-DOES-NOT-EXIST',
      { confirmed: true },
      { viewAll: true, allowedStoreIds: null },
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    expect(result).toEqual({ threw: true, message: 'customer not found in this business' })
  })
})

describe('pin R9-2 — source karute id: out-of-store vs nonexistent are indistinguishable', () => {
  it('pin 3: clamped + out-of-store karute id vs clamped + nonexistent karute id → byte-identical refusal', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    const clamp = { viewAll: false, allowedStoreIds: ['store-A'] }
    const outOfStore = await reassignKaruteCustomerWithClient(fakeClient(), 'kar-1', 'cust-TO', { confirmed: true }, clamp)
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    const nonexistent = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-DOES-NOT-EXIST',
      'cust-TO',
      { confirmed: true },
      clamp,
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    expect(outOfStore).toEqual({ threw: true, message: 'karute not found in this business' })
    expect(nonexistent).toEqual(outOfStore)
  })

  it('pin 4b: viewAll + a genuinely nonexistent karute id still gets the honest not_found', async () => {
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-DOES-NOT-EXIST',
      'cust-TO',
      { confirmed: true },
      { viewAll: true, allowedStoreIds: null },
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    expect(result).toEqual({ threw: true, message: 'karute not found in this business' })
  })
})

// ── Pin D-R9 (fix round 10) — the no-customer and same-customer guards ────
// moved below the clamp too. Verifier finding (MICRO-STAMP-2, probe rows
// C/D): both guards used to run BEFORE ensureReassignStoreScope, so a
// clamped actor holding an out-of-store karute id got the VALIDATION shape
// (leaking that the id exists, and for the same-customer case, WHICH
// customer it's attached to) instead of the uniform not_found. Each pin
// proves the leaking shape is now unreachable — the reordered clamp throws
// first, identical to R9-2's not_found string.

describe('pin D-R9 — pre-clamp guards moved below the clamp (fix round 10)', () => {
  it('clamped actor + out-of-store record + NULL customer → the SAME not_found, never "no customer to reassign from"', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B', customer_id: null }
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-TO',
      { confirmed: true },
      { viewAll: false, allowedStoreIds: ['store-A'] },
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    expect(result).toEqual({ threw: true, message: 'karute not found in this business' })
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
  })

  it('clamped actor + out-of-store record + exact-customer (to === from) → the SAME not_found, never "already this customer"', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B', customer_id: 'cust-FROM' }
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-FROM',
      { confirmed: true },
      { viewAll: false, allowedStoreIds: ['store-A'] },
    )
      .then(() => ({ threw: false }))
      .catch((err: Error) => ({ threw: true, message: err.message }))
    expect(result).toEqual({ threw: true, message: 'karute not found in this business' })
    expect(karuteRecordsUpdate).not.toHaveBeenCalled()
  })
})

// ── Pin R5-7 (fresh O6) — multi-store clamped actor ───────────────────────
// Every store-clamp fixture elsewhere in this file uses exactly ONE assigned
// store, so neither sourceStoreOutOfScope's `.includes()` nor
// toCustomerInScope's loop over allowedStoreIds has ever run with n > 1
// (M31: "toCustomerInScope honours only allowedStoreIds[0]" survived the
// full suite). This actor is assigned to store-A AND store-B.

describe('pin R5-7 — multi-store clamped actor (fresh O6)', () => {
  it('record in the SECOND assigned store + to-customer resolvable only through the SECOND store — both allowed', async () => {
    // KARUTE lives in store-B (not store-A, the fixture default) — proves
    // the source clamp checks every entry in allowedStoreIds, not just [0].
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    // cust-OTHER-STORE is in store-B's roster only (customersList mock:
    // store-A holds cust-TO, store-B holds cust-OTHER-STORE) — proves
    // toCustomerInScope's loop doesn't give up after store-A misses.
    const result = await reassignKaruteCustomerWithClient(
      fakeClient(),
      'kar-1',
      'cust-OTHER-STORE',
      { confirmed: true },
      { viewAll: false, allowedStoreIds: ['store-A', 'store-B'] },
    )
    expect(result).toMatchObject({ success: true, toCustomerId: 'cust-OTHER-STORE' })
    expect(karuteRecordsUpdate).toHaveBeenCalledWith('kar-1', { customer_id: 'cust-OTHER-STORE' })
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
  it('success revalidates the customer profile route (locale-pattern, item F) + the karute path + dashboard tag + customers tag', async () => {
    const result = await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })
    expect(result).toEqual({ success: true, burnCount: 0, photoCount: 0 })
    // Locale-pattern form, not the bare '/customers/{id}' literal: routing.ts
    // has no localePrefix override (next-intl defaults to 'always'), and the
    // only customer page route is [locale]/(app)/customers/[id] — a bare
    // path matches nothing. One 'page'-type call covers BOTH the from- and
    // to-customer profile (same broad-revalidation convention packs.ts's
    // revalidateProfile() already uses for this exact route, and the same
    // convention the karute path below already followed pre-fix).
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/(app)/customers/[id]', 'page')
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/(app)/karute/[id]', 'page')
    expect(updateTag).toHaveBeenCalledWith('dashboard')
    expect(revalidateTag).toHaveBeenCalledWith('customers', 'max')
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

  it('emits the row EXACT-SHAPE on a successful confirmed write — packet §5 pin 5, web half (R3-2: detail key is same_day_burn_count)', async () => {
    await reassignKaruteCustomer('kar-1', 'cust-TO', { confirmed: true })
    expect(auditWeb).toHaveBeenCalledTimes(1)
    // Full-argument toEqual (via toHaveBeenCalledWith): a wrong action, wrong
    // targetType/targetId, or a dropped detail key each fail this — the
    // verifier's exact corruption set (action:'karute.entry_edit',
    // targetType:'customer', targetId:'WRONG-ID', detail reduced to
    // {to_customer_id}) all flip it. R3-2: burn_count → same_day_burn_count
    // (red-run: emit the old key → this pin goes red).
    expect(auditWeb).toHaveBeenCalledWith({
      category: 'karute',
      action: 'karute.customer_reassign',
      targetType: 'karute',
      targetId: 'kar-1',
      detail: {
        from_customer_id: 'cust-FROM',
        to_customer_id: 'cust-TO',
        same_day_burn_count: 0,
        photo_count: 0,
      },
      requestId: expect.any(String),
    })
  })
})

// ── listReassignCustomerOptions — the picker roster (fix round 2 items B/C) ─

describe('listReassignCustomerOptions — roster', () => {
  it('a denied records.reassign capability blocks the roster read entirely', async () => {
    requireCapability.mockRejectedValueOnce(new Error('forbidden'))
    const result = await listReassignCustomerOptions('kar-1')
    expect(result).toEqual({ error: 'forbidden' })
    expect(getCachedCustomerList).not.toHaveBeenCalled()
  })

  it('a clamped actor reaches getCachedCustomerList with THEIR store id — exact store-scoped list, current customer excluded', async () => {
    resolveStoreScope.mockResolvedValue({
      viewAll: false,
      allowedStoreIds: ['store-A'],
      storeId: 'store-A',
      degraded: false,
    })
    const result = await listReassignCustomerOptions('kar-1')
    expect(getCachedCustomerList).toHaveBeenCalledWith('store-A')
    if (!('customers' in result)) throw new Error(`expected customers, got ${JSON.stringify(result)}`)
    // cust-FROM is in store-A's roster too (current customer) — excluded.
    expect(result.customers.map((c) => c.id)).toEqual(['cust-TO'])
  })

  it('a viewAll actor gets the business-wide roster (getCachedCustomerList called with undefined)', async () => {
    resolveStoreScope.mockResolvedValue(VIEW_ALL)
    const result = await listReassignCustomerOptions('kar-1')
    expect(getCachedCustomerList).toHaveBeenCalledWith(undefined)
    if (!('customers' in result)) throw new Error(`expected customers, got ${JSON.stringify(result)}`)
    expect(result.customers.map((c) => c.id).sort()).toEqual(['cust-OTHER-STORE', 'cust-TO'])
  })

  it('a degraded lookup fails closed BEFORE any list fetch — no business-wide leak, no doomed picker', async () => {
    resolveStoreScope.mockResolvedValue({
      viewAll: false,
      allowedStoreIds: ['store-A'],
      storeId: 'store-A',
      degraded: true,
    })
    const result = await listReassignCustomerOptions('kar-1')
    expect(result).toEqual({ error: expect.any(String) })
    expect(getCachedCustomerList).not.toHaveBeenCalled()
  })

  // R3-1 (fix round 3): the same source-store refusal the write enforces,
  // run here too — a clamped actor must not even see a picker for a karute
  // record that itself sits outside their assignment.
  it('R3-1: clamped actor + an out-of-store SOURCE record is refused BEFORE any list fetch', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    resolveStoreScope.mockResolvedValue({
      viewAll: false,
      allowedStoreIds: ['store-A'],
      storeId: 'store-A',
      degraded: false,
    })
    const result = await listReassignCustomerOptions('kar-1')
    // N9 (fix round 10): tightened from expect.any(String) — pins the exact
    // not_found string so a future revert of R9-2's shaping is caught here,
    // not just at the facade twins that already pin it.
    expect(result).toEqual({ error: 'karute not found in this business' })
    expect(getCachedCustomerList).not.toHaveBeenCalled()
  })

  // R5-1: flips the round-3 "reaches the roster normally" pin — null-store
  // now fails closed for a clamped actor.
  it('R5-1: null-store SOURCE record + clamped actor is refused BEFORE any list fetch', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: null }
    resolveStoreScope.mockResolvedValue({
      viewAll: false,
      allowedStoreIds: ['store-A'],
      storeId: 'store-A',
      degraded: false,
    })
    const result = await listReassignCustomerOptions('kar-1')
    // N9 (fix round 10): same tightening as the R3-1 pin above.
    expect(result).toEqual({ error: 'karute not found in this business' })
    expect(getCachedCustomerList).not.toHaveBeenCalled()
  })

  it('R3-1: viewAll actor + an out-of-store SOURCE record still reaches the business-wide roster', async () => {
    KARUTE.current = { ...KARUTE.current, store_id: 'store-B' }
    resolveStoreScope.mockResolvedValue(VIEW_ALL)
    const result = await listReassignCustomerOptions('kar-1')
    expect(getCachedCustomerList).toHaveBeenCalledWith(undefined)
    if (!('customers' in result)) throw new Error(`expected customers, got ${JSON.stringify(result)}`)
  })
})
