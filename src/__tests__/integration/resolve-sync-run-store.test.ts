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

const TWO_STORES = { stores: [{ id: '714d1196-5aa7-409d-8afc-5046aa19d031' }, { id: '405d5a2a-8ee1-4999-827a-ac178ae8d692', is_primary: true }] }
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
  storesGet.mockImplementation(async (id: string) => ({ id }))
  storesList.mockResolvedValue(TWO_STORES)
  staffStoresGet.mockResolvedValue({ store_ids: ['714d1196-5aa7-409d-8afc-5046aa19d031', '1aa03fda-eae0-4850-8ddf-90c999f9ee1d'] })
})

describe('requested store', () => {
  it('viewAll → any store of this business', async () => {
    await expect(run({ capabilities: VIEW_ALL, requestedStoreId: '57084027-db60-4552-8bb4-8acc48d592ef' })).resolves.toEqual({ storeId: '57084027-db60-4552-8bb4-8acc48d592ef' })
    expect(storesGet).toHaveBeenCalledWith('57084027-db60-4552-8bb4-8acc48d592ef')
  })

  it.each([404, 403])('not this business (core %i) → SyncStoreForbidden', async (status) => {
    storesGet.mockRejectedValue(Object.assign(new Error('nope'), { status }))
    await expect(run({ capabilities: VIEW_ALL, requestedStoreId: '57084027-db60-4552-8bb4-8acc48d592ef' })).rejects.toBeInstanceOf(SyncStoreForbidden)
  })

  it('clamped caller, inside the assignment → that store', async () => {
    await expect(run({ requestedStoreId: '1aa03fda-eae0-4850-8ddf-90c999f9ee1d' })).resolves.toEqual({ storeId: '1aa03fda-eae0-4850-8ddf-90c999f9ee1d' })
  })

  it('clamped caller, outside the assignment → SyncStoreForbidden', async () => {
    await expect(run({ requestedStoreId: '57084027-db60-4552-8bb4-8acc48d592ef' })).rejects.toBeInstanceOf(SyncStoreForbidden)
  })

  it('floating caller (empty assignment, single-store business) → any store of this business', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    storesList.mockResolvedValue({ stores: [{ id: 'cf0adde3-2426-4b5c-8415-b3f29104d93d' }] })
    await expect(run({ requestedStoreId: 'cf0adde3-2426-4b5c-8415-b3f29104d93d' })).resolves.toEqual({ storeId: 'cf0adde3-2426-4b5c-8415-b3f29104d93d' })
  })

  it('unassigned caller (empty assignment, ≥2 stores) → SyncStoreUnassigned, even naming a store', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    await expect(run({ requestedStoreId: '714d1196-5aa7-409d-8afc-5046aa19d031' })).rejects.toBeInstanceOf(SyncStoreUnassigned)
  })
})

describe('no requested store', () => {
  it("clamped caller → their FIRST active assigned store (both transports' rule), with ONE store-list read", async () => {
    await expect(run({})).resolves.toEqual({ storeId: '714d1196-5aa7-409d-8afc-5046aa19d031' })
    expect(storesList).toHaveBeenCalledTimes(1)
    expect(storesGet).not.toHaveBeenCalled()
  })

  it('viewAll caller → the primary store', async () => {
    await expect(run({ capabilities: VIEW_ALL })).resolves.toEqual({ storeId: '405d5a2a-8ee1-4999-827a-ac178ae8d692' })
    expect(staffStoresGet).not.toHaveBeenCalled()
  })

  it('viewAll caller, no store flagged primary → the first store', async () => {
    storesList.mockResolvedValue({ stores: [{ id: 'a80924b9-e5c3-46b4-8f6b-f3e26d09b48b' }, { id: 'dca2aee5-6379-4345-82f9-b223aa0c6761' }] })
    await expect(run({ capabilities: VIEW_ALL })).resolves.toEqual({ storeId: 'a80924b9-e5c3-46b4-8f6b-f3e26d09b48b' })
  })

  it('floating caller → the primary store, with ONE store-list read', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [] })
    storesList.mockResolvedValue({ stores: [{ id: 'cf0adde3-2426-4b5c-8415-b3f29104d93d', is_primary: true }] })
    await expect(run({})).resolves.toEqual({ storeId: 'cf0adde3-2426-4b5c-8415-b3f29104d93d' })
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
    await expect(run({ authUserId: null, capabilities: VIEW_ALL })).resolves.toEqual({ storeId: '405d5a2a-8ee1-4999-827a-ac178ae8d692' })
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
    const err = await caught(run({ requestedStoreId: '714d1196-5aa7-409d-8afc-5046aa19d031' }))
    expect(err).toBeInstanceOf(SyncStoreDependencyError)
    expect((err as Error).cause).toBe(cause)
  })

  it.each([503, 429, undefined])('requested-store verify throws (status %s) → the wrapped cause, not SyncStoreForbidden', async (status) => {
    const blip = Object.assign(new Error('blip'), { status })
    storesGet.mockRejectedValue(blip)
    const err = await caught(run({ capabilities: VIEW_ALL, requestedStoreId: '714d1196-5aa7-409d-8afc-5046aa19d031' }))
    expect(err).toBeInstanceOf(SyncStoreDependencyError)
    expect(err).not.toBeInstanceOf(SyncStoreForbidden)
    expect((err as Error).cause).toBe(blip)
  })
})

describe('fix round 2 (Opus nit N3) — an archived store is never synced', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    staffStoresGet.mockResolvedValue({ store_ids: ['714d1196-5aa7-409d-8afc-5046aa19d031'] })
  })

  it('a requested archived store → SyncStoreForbidden', async () => {
    storesGet.mockResolvedValue({ id: '714d1196-5aa7-409d-8afc-5046aa19d031', active: false })
    await expect(run({ capabilities: VIEW_ALL, requestedStoreId: '714d1196-5aa7-409d-8afc-5046aa19d031' })).rejects.toBeInstanceOf(SyncStoreForbidden)
  })

  it('no request, archived primary → the first ACTIVE store, never the archived one', async () => {
    storesList.mockResolvedValue({
      stores: [{ id: '1801dbe8-7803-4be1-8551-e3b80a69412d', is_primary: true, active: false }, { id: '3b454e1d-2cc1-44a6-85df-6d39f13eadbe', active: true }],
    })
    await expect(run({ capabilities: VIEW_ALL })).resolves.toEqual({ storeId: '3b454e1d-2cc1-44a6-85df-6d39f13eadbe' })
  })
})

describe('fix round 3 (Opus S1) — only a lowercase UUID is a store id; the answer is the id core returned', () => {
  const ID = '714d1196-5aa7-409d-8afc-5046aa19d031'

  it.each([
    ['uppercase id', ID.toUpperCase()],
    ['id + #x', `${ID}#x`],
    ['zzz/../id', `zzz/../${ID}`],
    ['../customers', '../customers'],
  ])('%s → SyncStoreForbidden before any lookup', async (_case, requested) => {
    await expect(run({ capabilities: VIEW_ALL, requestedStoreId: requested })).rejects.toBeInstanceOf(SyncStoreForbidden)
    expect(storesGet).not.toHaveBeenCalled()
    expect(staffStoresGet).not.toHaveBeenCalled()
    expect(storesList).not.toHaveBeenCalled()
  })

  it('a valid id → the id core returned for it', async () => {
    storesGet.mockResolvedValue({ id: ID })
    await expect(run({ capabilities: VIEW_ALL, requestedStoreId: ID })).resolves.toEqual({ storeId: ID })
    expect(storesGet).toHaveBeenCalledWith(ID)
  })

  it("core's id differs in case from the request → core's id, never the request string", async () => {
    storesGet.mockResolvedValue({ id: ID.toUpperCase() })
    await expect(run({ capabilities: VIEW_ALL, requestedStoreId: ID })).resolves.toEqual({ storeId: ID.toUpperCase() })
  })

  it("the assignment check runs on core's id, not the request string", async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [ID] })
    storesGet.mockResolvedValue({ id: ID.toUpperCase() })
    await expect(run({ requestedStoreId: ID })).rejects.toBeInstanceOf(SyncStoreForbidden)
  })
})

describe('fix round 3 (Opus S3) — an archived store is never the default sync target', () => {
  const OLD = '1801dbe8-7803-4be1-8551-e3b80a69412d'
  const LIVE = '3b454e1d-2cc1-44a6-85df-6d39f13eadbe'

  it('clamped [archived, live], no request → the live one, ONE store-list read, no per-store lookup', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [OLD, LIVE] })
    storesList.mockResolvedValue({ stores: [{ id: OLD, active: false }, { id: LIVE, active: true }] })
    await expect(run({})).resolves.toEqual({ storeId: LIVE })
    expect(storesList).toHaveBeenCalledTimes(1)
    expect(storesGet).not.toHaveBeenCalled()
  })

  it('clamped [archived only], no request → SyncStoreUnassigned', async () => {
    staffStoresGet.mockResolvedValue({ store_ids: [OLD] })
    storesList.mockResolvedValue({ stores: [{ id: OLD, active: false }, { id: LIVE, is_primary: true }] })
    await expect(run({})).rejects.toBeInstanceOf(SyncStoreUnassigned)
  })

  it('viewAll, no request → still the active primary', async () => {
    storesList.mockResolvedValue({ stores: [{ id: OLD, active: false }, { id: LIVE, is_primary: true, active: true }] })
    await expect(run({ capabilities: VIEW_ALL })).resolves.toEqual({ storeId: LIVE })
  })
})
