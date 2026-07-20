// Store clamp (packet 03 point 4) — the #441 cross-store/cross-tenant leak class.
// Tenancy is proven FIRST (stores.get on a business-scoped client), then the
// staff-assignment restriction applies. A store-id is an EXPLICIT request field.
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import type { Capability } from '@/lib/auth/permissions'

// The SDK's error shape, duck-built: @synqed-kk/client is ESM-only, so a
// value import here would fail jest's CJS parse — same reason the clamp
// itself duck-types the status instead of using instanceof.
const synqedError = (status: number, message: string) =>
  Object.assign(new Error(message), { name: 'SynqedError', status })

type Stores = { get: (id: string) => Promise<unknown> }
type StaffStores = { get: (id: string) => Promise<{ store_ids: string[] }> }

function synqedWith(opts: {
  ownStores?: string[] // stores that belong to this tenant (stores.get resolves)
  assignment?: string[] | Error // staffStores.get result, or an error to throw
  storeLookupError?: Error // stores.get failure override (transient classes)
}) {
  const own = new Set(opts.ownStores ?? [])
  const stores: Stores = {
    get: (id) =>
      opts.storeLookupError
        ? Promise.reject(opts.storeLookupError)
        : own.has(id)
          ? Promise.resolve({ id })
          // Core's definitive answer for a store outside this business —
          // the SDK's typed error, not a bare Error (the clamp classifies).
          : Promise.reject(synqedError(404, 'not found')),
  }
  const staffStores: StaffStores = {
    get: () =>
      opts.assignment instanceof Error
        ? Promise.reject(opts.assignment)
        : Promise.resolve({ store_ids: (opts.assignment as string[]) ?? [] }),
  }
  return { stores, staffStores } as never
}

const caps = (...c: Capability[]) => new Set<Capability>(c)
const AUTH = 'staff-1'

describe('store clamp', () => {
  it('rejects a store-id that is NOT this business (wrong-tenant)', async () => {
    const synqed = synqedWith({ ownStores: ['store-A'], assignment: ['store-A'] })
    await expect(
      resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: 'store-OTHER' }),
    ).rejects.toMatchObject({ code: 'store_forbidden', detail: { reason: 'store_header' } })
  })

  it('rejects an in-tenant store the clamped staff is NOT assigned to (wrong-store)', async () => {
    const synqed = synqedWith({ ownStores: ['store-A', 'store-B'], assignment: ['store-A'] })
    await expect(
      resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: 'store-B' }),
    ).rejects.toMatchObject({ code: 'store_forbidden', detail: { reason: 'store_header' } })
  })

  it('clamps an assigned staffer to their own store', async () => {
    const synqed = synqedWith({ ownStores: ['store-A', 'store-B'], assignment: ['store-A'] })
    const r = await resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: 'store-A' })
    expect(r).toEqual({ storeId: 'store-A', allowedStoreIds: ['store-A'] })
  })

  it('FAILS CLOSED when the assignment lookup errors (not floating) — WITHOUT the store_header marker', async () => {
    const synqed = synqedWith({ ownStores: ['store-A'], assignment: new Error('core down') })
    // Verdict UNKNOWN, not a pin verdict: the thin self-heal keys on
    // reason:'store_header', and a transient lookup blip must never clear a
    // good pin (the unlensed retry would re-hit the same lookup anyway).
    await expect(
      resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: null }),
    ).rejects.toMatchObject({ code: 'store_forbidden', detail: undefined })
  })

  it('FAILS CLOSED when the store lookup is TRANSIENT (5xx) — WITHOUT the marker (fleet round 2, P1)', async () => {
    // A network blip on stores.get must not read as "your pin is dead" — the
    // marked verdict would make the thin self-heal clear a perfectly good pin.
    const synqed = synqedWith({
      ownStores: ['store-A'],
      assignment: ['store-A'],
      storeLookupError: synqedError(503, 'upstream unavailable'),
    })
    await expect(
      resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: 'store-A' }),
    ).rejects.toMatchObject({ code: 'store_forbidden', detail: undefined })
  })

  it('FAILS CLOSED on a NETWORK error during the store lookup — WITHOUT the marker', async () => {
    const synqed = synqedWith({
      ownStores: ['store-A'],
      assignment: ['store-A'],
      storeLookupError: new TypeError('fetch failed'),
    })
    await expect(
      resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: 'store-A' }),
    ).rejects.toMatchObject({ code: 'store_forbidden', detail: undefined })
  })

  it("core's 403 is as definitive as its 404 — marked (judges the id, not the caller)", async () => {
    const synqed = synqedWith({
      ownStores: ['store-A'],
      assignment: ['store-A'],
      storeLookupError: synqedError(403, 'forbidden'),
    })
    await expect(
      resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: 'store-A' }),
    ).rejects.toMatchObject({ code: 'store_forbidden', detail: { reason: 'store_header' } })
  })

  it('DELIBERATE empty assignment = floating staff, unrestricted within tenant', async () => {
    const synqed = synqedWith({ ownStores: ['store-A'], assignment: [] })
    const r = await resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: null })
    expect(r).toEqual({ storeId: null, allowedStoreIds: null })
  })

  it('stores.viewAll ranges freely within the tenant (but store-id still tenant-checked)', async () => {
    const synqed = synqedWith({ ownStores: ['store-A'], assignment: ['store-A'] })
    const r = await resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps('stores.viewAll'), requestedStoreId: 'store-A' })
    expect(r).toEqual({ storeId: 'store-A', allowedStoreIds: null })
    await expect(
      resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps('stores.viewAll'), requestedStoreId: 'store-OTHER' }),
    ).rejects.toMatchObject({ code: 'store_forbidden', detail: { reason: 'store_header' } })
  })
})
