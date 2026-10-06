// Greptile #1135 F3, fix round 1 — the ONE definition of a sync run's store
// (src/lib/sync/resolve-run-store.ts), rule by rule. Both transports' route
// suites (web-sync-quickreserve.test.ts · app-api-sync-run-store.test.ts) pin
// how each maps the three errors; this suite pins which error each case is.
import {
  resolveSyncRunStore,
  SyncStoreDependencyError,
  SyncStoreForbidden,
  SyncStoreUnassigned,
} from '@/lib/sync/resolve-run-store'
import type { Capability } from '@/lib/auth/permissions'

const storesGet = jest.fn()
const storesList = jest.fn()
const staffStoresGet = jest.fn()
const synqed = { stores: { get: storesGet, list: storesList }, staffStores: { get: staffStoresGet } } as never

const TWO_STORES = { stores: [{ id: 'store-a' }, { id: 'store-primary', is_primary: true }] }
const caps = (...c: string[]) => new Set(c) as Set<Capability>
const VIEW_ALL = caps('sync.view', 'stores.viewAll')
const STAFF = caps('sync.view')

const run = (o: { authUserId?: string | null; capabilities?: Set<Capability>; requestedStoreId?: string | null }) =>
  resolveSyncRunStore({
    synqed,
    authUserId: o.authUserId === undefined ? 'staff-1' : o.authUserId,
    capabilities: o.capabilities ?? STAFF,
    requestedStoreId: o.requestedStoreId ?? null,
  })

beforeEach(() => {
  jest.resetAllMocks()
  storesGet.mockResolvedValue({ id: 'x' })
  storesList.mockResolvedValue(TWO_STORES)
  staffStoresGet.mockResolvedValue({ store_ids: ['store-a', 'store-b'] })
})

describe('requested store', () => {
  it('viewAll → any store of this business', async () => {
    await expect(run({ capabilities: VIEW_ALL, requestedStoreId: 'store-z' })).resolves.toEqual({ storeId: 'store-z' })
    expect(storesGet).toHaveBeenCalledWith('store-z')
  })

  it.each([404, 403])('not this business (core %i) → SyncStoreForbidden', async (status) => {
    storesGet.mockRejectedValue(Object.assign(new Error('nope'), { status }))
    await expect(run({ capabilities: VIEW_ALL, requestedStoreId: 'store-z' })).rejects.toBeInstanceOf(SyncStoreForbidden)
  })

  it('clamped caller, inside the assignment → that store', async () => {
    await expect(run({ requestedStoreId: 'store-b' })).resolves.toEqual({ storeId: 'store-b' })
  })

  it('clamped caller, outside the assignment → SyncStoreForbidden', async () => {
    await expect(run({ requestedStoreId: 'store-z' })).rejects.toBeInstanceOf(SyncStoreForbidden)
  })

  it('floating caller (empty assignment, single-store business) → any store of this business', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    storesList.mockResolvedValue({ stores: [{ id: 'store-only' }] })
    await expect(run({ requestedStoreId: 'store-only' })).resolves.toEqual({ storeId: 'store-only' })
  })

  it('unassigned caller (empty assignment, ≥2 stores) → SyncStoreUnassigned, even naming a store', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    await expect(run({ requestedStoreId: 'store-a' })).rejects.toBeInstanceOf(SyncStoreUnassigned)
  })
})

describe('no requested store', () => {
  it("clamped caller → their FIRST assigned store (both transports' rule, kept)", async () => {
    await expect(run({})).resolves.toEqual({ storeId: 'store-a' })
    expect(storesList).not.toHaveBeenCalled()
  })

  it('viewAll caller → the primary store', async () => {
    await expect(run({ capabilities: VIEW_ALL })).resolves.toEqual({ storeId: 'store-primary' })
    expect(staffStoresGet).not.toHaveBeenCalled()
  })

  it('viewAll caller, no store flagged primary → the first store', async () => {
    storesList.mockResolvedValue({ stores: [{ id: 'store-1' }, { id: 'store-2' }] })
    await expect(run({ capabilities: VIEW_ALL })).resolves.toEqual({ storeId: 'store-1' })
  })

  it('floating caller → the primary store, with ONE store-list read', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    storesList.mockResolvedValue({ stores: [{ id: 'store-only', is_primary: true }] })
    await expect(run({})).resolves.toEqual({ storeId: 'store-only' })
    expect(storesList).toHaveBeenCalledTimes(1)
  })

  it('unassigned caller → SyncStoreUnassigned, never the primary store', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    await expect(run({})).rejects.toBeInstanceOf(SyncStoreUnassigned)
  })

  it('the business has no store at all → SyncStoreUnassigned', async () => {
    storesList.mockResolvedValue({ stores: [] })
    await expect(run({ capabilities: VIEW_ALL })).rejects.toBeInstanceOf(SyncStoreUnassigned)
  })

  it('a caller the roster cannot place (null id) without viewAll → SyncStoreUnassigned, no staff-store read', async () => {
    await expect(run({ authUserId: null })).rejects.toBeInstanceOf(SyncStoreUnassigned)
    expect(staffStoresGet).not.toHaveBeenCalled()
  })

  it('the same null id WITH viewAll → the primary store', async () => {
    await expect(run({ authUserId: null, capabilities: VIEW_ALL })).resolves.toEqual({ storeId: 'store-primary' })
  })
})

describe('a dependency that THROWS propagates as SyncStoreDependencyError, never swallowed into a verdict', () => {
  const cause = new Error('core down')

  async function caught(p: Promise<unknown>): Promise<unknown> {
    try {
      await p
    } catch (err) {
      return err
    }
    throw new Error('expected a rejection')
  }

  it('staff-store read throws → the wrapped cause, not SyncStoreUnassigned', async () => {
    staffStoresGet.mockRejectedValue(cause)
    const err = await caught(run({}))
    expect(err).toBeInstanceOf(SyncStoreDependencyError)
    expect(err).not.toBeInstanceOf(SyncStoreUnassigned)
    expect((err as Error).cause).toBe(cause)
    expect((err as Error).message).toContain('core down')
  })

  it('primary-store read throws (viewAll, no request) → the wrapped cause', async () => {
    storesList.mockRejectedValue(cause)
    const err = await caught(run({ capabilities: VIEW_ALL }))
    expect(err).toBeInstanceOf(SyncStoreDependencyError)
    expect((err as Error).cause).toBe(cause)
  })

  it('store-count read throws (empty assignment) → the wrapped cause, not a floating or unassigned verdict', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    storesList.mockRejectedValue(cause)
    const err = await caught(run({ requestedStoreId: 'store-a' }))
    expect(err).toBeInstanceOf(SyncStoreDependencyError)
    expect((err as Error).cause).toBe(cause)
  })

  it.each([503, 429, undefined])('requested-store verify throws (status %s) → the wrapped cause, not SyncStoreForbidden', async (status) => {
    const blip = Object.assign(new Error('blip'), { status })
    storesGet.mockRejectedValue(blip)
    const err = await caught(run({ capabilities: VIEW_ALL, requestedStoreId: 'store-a' }))
    expect(err).toBeInstanceOf(SyncStoreDependencyError)
    expect(err).not.toBeInstanceOf(SyncStoreForbidden)
    expect((err as Error).cause).toBe(blip)
  })
})

describe('fix round 2 (Opus nit N3) — an archived store is never synced', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
  })

  it('a requested archived store → SyncStoreForbidden', async () => {
    storesGet.mockResolvedValue({ id: 'store-a', active: false })
    await expect(run({ capabilities: VIEW_ALL, requestedStoreId: 'store-a' })).rejects.toBeInstanceOf(SyncStoreForbidden)
  })

  it('no request, archived primary → the first ACTIVE store, never the archived one', async () => {
    storesList.mockResolvedValue({
      stores: [{ id: 'store-old', is_primary: true, active: false }, { id: 'store-live', active: true }],
    })
    await expect(run({ capabilities: VIEW_ALL })).resolves.toEqual({ storeId: 'store-live' })
  })
})
