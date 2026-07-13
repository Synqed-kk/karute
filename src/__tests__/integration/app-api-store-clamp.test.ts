// Store clamp (packet 03 point 4) — the #441 cross-store/cross-tenant leak class.
// Tenancy is proven FIRST (stores.get on a business-scoped client), then the
// staff-assignment restriction applies. A store-id is an EXPLICIT request field.
import { resolveStoreForRequest } from '@/lib/app-api/store-clamp'
import type { Capability } from '@/lib/auth/permissions'

type Stores = { get: (id: string) => Promise<unknown> }
type StaffStores = { get: (id: string) => Promise<{ store_ids: string[] }> }

function synqedWith(opts: {
  ownStores?: string[] // stores that belong to this tenant (stores.get resolves)
  assignment?: string[] | Error // staffStores.get result, or an error to throw
}) {
  const own = new Set(opts.ownStores ?? [])
  const stores: Stores = {
    get: (id) => (own.has(id) ? Promise.resolve({ id }) : Promise.reject(new Error('404'))),
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
    ).rejects.toMatchObject({ code: 'store_forbidden' })
  })

  it('rejects an in-tenant store the clamped staff is NOT assigned to (wrong-store)', async () => {
    const synqed = synqedWith({ ownStores: ['store-A', 'store-B'], assignment: ['store-A'] })
    await expect(
      resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: 'store-B' }),
    ).rejects.toMatchObject({ code: 'store_forbidden' })
  })

  it('clamps an assigned staffer to their own store', async () => {
    const synqed = synqedWith({ ownStores: ['store-A', 'store-B'], assignment: ['store-A'] })
    const r = await resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: 'store-A' })
    expect(r).toEqual({ storeId: 'store-A', allowedStoreIds: ['store-A'] })
  })

  it('FAILS CLOSED when the assignment lookup errors (not floating)', async () => {
    const synqed = synqedWith({ ownStores: ['store-A'], assignment: new Error('core down') })
    await expect(
      resolveStoreForRequest({ synqed, authUserId: AUTH, capabilities: caps(), requestedStoreId: null }),
    ).rejects.toMatchObject({ code: 'store_forbidden' })
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
    ).rejects.toMatchObject({ code: 'store_forbidden' })
  })
})
