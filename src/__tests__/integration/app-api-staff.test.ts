// Staff CRUD + avatar facade routes (design-parity packet 12 §S4a). Single-
// source: every route calls the SAME core the web action calls
// (createStaffCore/updateStaffCore/deleteStaffCore/uploadStaffAvatarCore,
// src/lib/staff/staff.core.ts). Pins: capability gates, Idempotency-Key on create,
// exactly one audit row per successful write (source: 'facade'), and the
// silence contract (denied/failed write → no audit row).
import { createHmac } from 'node:crypto'

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }),
    },
  }),
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))
// The routes import the cores from src/lib/staff/staff.core.ts (PKT-SEC-CORES-D5),
// which no longer pulls next-intl/server in through the action file; the mock
// stays because it is harmless and guards any other path that still reaches it.
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
jest.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  // The PATCH route busts 'staff-list' through the route-safe API.
  revalidateTag: jest.fn(),
}))

const mockCapabilities = jest.fn(async () => new Set(['staff.invite', 'staff.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

jest.mock('@/lib/subscription/feature-gate', () => ({
  staffAddAllowedWithClient: jest.fn(async () => ({ allowed: true })),
}))

// Mutable so a cell can take the CALLER off the roster — the clamp's own
// NR-actor oracle (resolveSelfStaffId) reads this list.
const staffListByBusinessOrThrow = jest.fn(async () => [{ id: 'auth-user-1' }])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: () => staffListByBusinessOrThrow(),
}))

// profiles lookup used by updateStaffCore/deleteStaffCore — null = synqed-only
// staff (routes to the synqed client); a row = profile-backed (routes to the
// Supabase update).
let profileRow: { id: string; full_name?: string; display_role?: string } | null = null
let profileUpdateError: { message: string } | null = null
let profileLookupError: { message: string } | null = null
// Every .eq() applied to a profiles query, recorded so pins can assert
// tenant scoping (the service client bypasses RLS — the .eq('customer_id',…)
// IS the isolation).
let profileEqCalls: Array<[string, unknown]> = []
// deleteStaffCore's two neutralising moves on a removal (name prefix + ban).
let profileUpdates: Array<{ patch: Record<string, unknown>; eq: Array<[string, unknown]> }> = []
const updateUserById = jest.fn(async (_id: string, _a: Record<string, unknown>) => ({ error: null }))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => {
      profileEqCalls.push([col, val])
      return builder
    }
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () =>
      profileLookupError ? { data: null, error: profileLookupError } : { data: profileRow, error: null }
    ;(builder as { update: unknown }).update = (patch: Record<string, unknown>) => {
      const rec = { patch, eq: [] as Array<[string, unknown]> }
      profileUpdates.push(rec)
      const chain: Record<string, unknown> = {}
      chain.eq = (c: string, v: unknown) => {
        rec.eq.push([c, v])
        profileEqCalls.push([c, v])
        return chain
      }
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ error: profileUpdateError })
      return chain
    }
    return {
      from: () => builder,
      auth: { admin: { updateUserById: (id: string, a: Record<string, unknown>) => updateUserById(id, a) } },
    }
  },
}))

jest.mock('@/lib/synqed/staff-map', () => ({
  // Cookie-bound variant kept in the mock as a tripwire: the cores must call
  // the business-explicit twin — the cookie one throws on every Bearer call.
  lookupSynqedStaffId: jest.fn(async () => {
    throw new Error('cookie-bound lookup reached from a facade path')
  }),
  lookupSynqedStaffIdForBusiness: jest.fn(async () => 'synqed-7'),
}))

const staffCreate = jest.fn(async () => ({ id: 'staff-new' }))
const staffUpdate = jest.fn(async () => ({}))
const staffDelete = jest.fn(async () => ({}))
const staffUploadAvatar = jest.fn(async () => ({ avatar_url: 'https://cdn.test/a.png' }))
// Store assignments the write clamp reads (ensureStaffWriteInScope): keyed by
// staff id so a test can put the CALLER and the TARGET in different branches.
// Default = everyone floating (empty assignment = works in every store), which
// is the unclamped path every pre-clamp pin in this file was written against.
let storeAssignments: Record<string, string[]> = {}
const staffStoresGet = jest.fn(async (id: string) => ({ store_ids: storeAssignments[id] ?? [] }))
// The business's stores, as core would list them. Empty by default so every
// pre-existing pin keeps its single-store/unknown path — the store-at-creation
// rule only speaks when a business really has two (⚖ fold round 3, M7).
let storeList: { id: string }[] = []
const storesList = jest.fn(async () => ({ stores: storeList }))
const staffStoresSet = jest.fn(async () => ({}))
const fakeClient = {
  staff: { create: staffCreate, update: staffUpdate, delete: staffDelete, uploadAvatar: staffUploadAvatar },
  staffStores: { get: staffStoresGet, set: staffStoresSet },
  stores: { get: jest.fn(async (id: string) => ({ id })), list: storesList },
}
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { POST as createPOST } from '@/app/api/app/v1/staff/route'
import { PATCH as updatePATCH, DELETE as deleteDELETE } from '@/app/api/app/v1/staff/[id]/route'
import { POST as avatarPOST } from '@/app/api/app/v1/staff/[id]/avatar/route'
import { SynqedError } from '@synqed-kk/client'
import { ROLE_PRESETS } from '@/lib/auth/permissions'
import { auditLines } from './helpers/audit-lines'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub: 'auth-user-1', iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}` }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const noParams = { params: Promise.resolve({}) }

const VALID_STAFF = { name: 'New Hire', position: '', email: '', phone: '' }
// storeIds are validated as UUIDs by staffProfileSchema.
const STORE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const STORE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const postReq = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://s/api/app/v1/staff', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json', 'idempotency-key': 'test-key-1', ...headers },
    body: JSON.stringify(body),
  })
const patchReq = (id: string, body: unknown) =>
  new Request(`https://s/api/app/v1/staff/${id}`, {
    method: 'PATCH',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const deleteReq = (id: string) =>
  new Request(`https://s/api/app/v1/staff/${id}`, { method: 'DELETE', headers: auth })

// A minimal valid PNG header the avatar route's magic-byte sniff accepts.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
function avatarForm(): FormData {
  const fd = new FormData()
  fd.set('file', new File([PNG_BYTES], 'a.png', { type: 'image/png' }))
  return fd
}
const avatarReq = (id: string, form: FormData) =>
  new Request(`https://s/api/app/v1/staff/${id}/avatar`, { method: 'POST', headers: auth, body: form })

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['staff.invite', 'staff.manage']))
  profileRow = null
  profileUpdateError = null
  profileLookupError = null
  profileEqCalls = []
  profileUpdates = []
  storeAssignments = {}
  storeList = []
  storesList.mockImplementation(async () => ({ stores: storeList }))
  // clearAllMocks keeps implementations — restore the default so a fail-closed
  // test's thrower doesn't leak into the next one.
  staffStoresGet.mockImplementation(async (id: string) => ({ store_ids: storeAssignments[id] ?? [] }))
  staffListByBusinessOrThrow.mockResolvedValue([{ id: 'auth-user-1' }])
  staffCreate.mockResolvedValue({ id: 'staff-new' })
  staffUpdate.mockResolvedValue({})
  staffDelete.mockResolvedValue({})
  staffUploadAvatar.mockResolvedValue({ avatar_url: 'https://cdn.test/a.png' })
})

describe('POST /api/app/v1/staff (create)', () => {
  it('missing staff.invite → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await createPOST(postReq(VALID_STAFF), noParams)
    expect(res.status).toBe(403)
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('missing Idempotency-Key → 400, no write', async () => {
    const res = await createPOST(postReq(VALID_STAFF, { 'idempotency-key': '' }), noParams)
    expect(res.status).toBe(400)
    expect(staffCreate).not.toHaveBeenCalled()
  })

  // ── THE STORE-AT-CREATION RULE ON THE BEARER TRANSPORT (⚖ fold round 3, M7)
  // The rule was proved only through the web door: M7 dropped it from this
  // route and all 660 suites stayed green. Both halves now have a witness here.
  it('two stores and no 担当店舗 → STORE_REQUIRED_AT_CREATION, nothing minted', async () => {
    // The owner on their phone: viewAll, so the front gate passes them and the
    // clamp free-passes them — the store requirement is the only thing between
    // a tapped 追加 and a staff member who sees nothing on their first login.
    mockCapabilities.mockResolvedValue(new Set(['staff.invite', 'stores.viewAll']))
    storeList = [{ id: STORE_A }, { id: STORE_B }]
    const lines = await auditLines(async () => {
      const res = await createPOST(postReq(VALID_STAFF), noParams)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ error: 'STORE_REQUIRED_AT_CREATION' })
    })
    expect(staffCreate).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('a store-clamped caller cannot mint into another store → STORE_SCOPE_DENIED, card rolled back', async () => {
    storeList = [{ id: STORE_A }, { id: STORE_B }]
    storeAssignments = { 'auth-user-1': [STORE_A] }
    const res = await createPOST(postReq({ ...VALID_STAFF, storeIds: [STORE_B] }), noParams)
    expect(await res.json()).toEqual({ error: 'STORE_SCOPE_DENIED' })
    expect(staffStoresSet).not.toHaveBeenCalled()
    expect(staffDelete).toHaveBeenCalledWith('staff-new')
  })

  it('a caller the roster cannot place is refused outright, never read as floating (F7)', async () => {
    // ⚖ FOLD ROUND 3 (fresh-eyes F7). This door resolved its scope through
    // resolveStoreForRequest, which CANNOT tell an unplaceable caller from a
    // floating one — core answers `{ store_ids: [] }` for both — so a phone
    // holding a live token for somebody taken off the roster could still mint
    // staff into any store. resolveWriteStoreScope is the one home that asks
    // roster-placement first, and every Bearer write door goes through it.
    // A SINGLE-store business on purpose: in a multi-store one the facade front
    // gate already refuses an unassigned identity, so only here can this door's
    // own resolver be seen deciding.
    staffListByBusinessOrThrow.mockResolvedValue([])
    storeList = [{ id: STORE_A }]
    const res = await createPOST(postReq({ ...VALID_STAFF, storeIds: [STORE_A] }), noParams)
    expect(res.status).toBe(403)
    expect(staffCreate).not.toHaveBeenCalled()
  })

  it('happy path → 201 { id }, exactly one staff.add audit row, source facade', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await createPOST(postReq(VALID_STAFF), noParams)
    })
    expect(res.status).toBe(201)
    expect(newSynqedClient).toHaveBeenCalledWith('business-1')
    expect(await res.json()).toEqual({ id: 'staff-new' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'staff',
      action: 'staff.add',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_id: 'staff-new',
      source: 'facade',
    })
  })

  it('a denied write emits no audit row', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const lines = await auditLines(async () => {
      await createPOST(postReq(VALID_STAFF), noParams)
    })
    expect(lines).toHaveLength(0)
  })

  it('plan gate at the limit → soft 200 { error } (matches web), no write, no audit row', async () => {
    const { staffAddAllowedWithClient } = jest.requireMock('@/lib/subscription/feature-gate')
    ;(staffAddAllowedWithClient as jest.Mock).mockResolvedValueOnce({
      allowed: false,
      count: 3,
      limit: 3,
    })
    let res!: Response
    const lines = await auditLines(async () => {
      res = await createPOST(postReq(VALID_STAFF), noParams)
    })
    // The Bearer-scoped client + businessId reach the gate — the cookie-bound
    // staffAddAllowed() would have failed open on every facade request.
    expect(staffAddAllowedWithClient).toHaveBeenCalledWith(
      fakeClient,
      'business-1',
      expect.any(Function),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'Staff limit reached for the current plan.' })
    expect(staffCreate).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('the email→profile link lookup is tenant-scoped (customer_id = caller business)', async () => {
    // The service client bypasses RLS — without the customer_id scope, an
    // email guess would link a FOREIGN tenant's auth identity into this
    // roster (a same-email user in another business).
    const res = await createPOST(
      postReq({ ...VALID_STAFF, email: 'teammate@example.test' }),
      noParams,
    )
    expect(res.status).toBe(201)
    expect(profileEqCalls).toEqual(
      expect.arrayContaining([
        ['email', 'teammate@example.test'],
        ['customer_id', 'business-1'],
      ]),
    )
  })
})

describe('PATCH /api/app/v1/staff/[id] (update)', () => {
  it('missing staff.manage → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await updatePATCH(patchReq('staff-9', VALID_STAFF), params('staff-9'))
    expect(res.status).toBe(403)
    expect(staffUpdate).not.toHaveBeenCalled()
  })

  it('happy path (synqed-only staff) → 200 { ok: true }, one staff.update row, source facade', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await updatePATCH(patchReq('staff-9', VALID_STAFF), params('staff-9'))
    })
    expect(res.status).toBe(200)
    expect(staffUpdate).toHaveBeenCalledWith('staff-9', { name: 'New Hire', email: null })
    expect(await res.json()).toEqual({ ok: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'staff.update', target_id: 'staff-9', source: 'facade' })
  })

  it('a failed write emits no audit row (silence contract)', async () => {
    staffUpdate.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const res = await updatePATCH(patchReq('staff-9', VALID_STAFF), params('staff-9'))
      expect(res.status).toBe(502)
    })
    expect(lines).toHaveLength(0)
  })

  it("core's REAL not-found → 404 (permanent, not a retryable 502), no audit row", async () => {
    staffUpdate.mockRejectedValueOnce(new SynqedError(404, 'Staff not found'))
    const lines = await auditLines(async () => {
      const res = await updatePATCH(patchReq('staff-ghost', VALID_STAFF), params('staff-ghost'))
      expect(res.status).toBe(404)
    })
    expect(lines).toHaveLength(0)
  })

  it('profile-backed update: lookup AND update are tenant-scoped', async () => {
    // The service client bypasses RLS — without the customer_id scope on
    // BOTH the lookup and the update chain, a staff id from a FOREIGN tenant
    // could be resolved here and then written to.
    profileRow = { id: 'staff-9' }
    const res = await updatePATCH(patchReq('staff-9', VALID_STAFF), params('staff-9'))
    expect(res.status).toBe(200)
    const customerIdCalls = profileEqCalls.filter(
      ([col, val]) => col === 'customer_id' && val === 'business-1',
    )
    expect(customerIdCalls).toHaveLength(2)
  })
})

describe('DELETE /api/app/v1/staff/[id]', () => {
  it('missing staff.manage → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    expect(res.status).toBe(403)
    expect(staffDelete).not.toHaveBeenCalled()
  })

  it('happy path → 200 { ok: true }, one staff.remove row at notice, source facade', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'staff.remove', severity: 'notice', target_id: 'staff-9', source: 'facade' })
  })

  it('profile-backed delete resolves the synqed id via the BUSINESS-EXPLICIT lookup (no cookie re-entry)', async () => {
    // The cookie-bound lookupSynqedStaffId throws in this suite's mock — a
    // regression back to it turns this red immediately.
    profileRow = { id: 'staff-9' }
    const { lookupSynqedStaffIdForBusiness } = jest.requireMock('@/lib/synqed/staff-map')
    const res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(lookupSynqedStaffIdForBusiness).toHaveBeenCalledWith('staff-9', 'business-1')
    expect(staffDelete).toHaveBeenCalledWith('synqed-7')
  })

  it('the profiles lookup is tenant-scoped (customer_id = caller business)', async () => {
    // The service client bypasses RLS — without the customer_id scope, a
    // staff id from a FOREIGN tenant would resolve here.
    profileRow = { id: 'staff-9' }
    const res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    expect(res.status).toBe(200)
    expect(profileEqCalls).toEqual(
      expect.arrayContaining([
        ['id', 'staff-9'],
        ['customer_id', 'business-1'],
      ]),
    )
  })

  it('the 400 guard (last-member) rides the 2xx body VERBATIM, no audit row', async () => {
    staffDelete.mockRejectedValueOnce(new SynqedError(400, 'Cannot delete the last staff member.'))
    const lines = await auditLines(async () => {
      const res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ error: 'Cannot delete the last staff member.' })
    })
    expect(lines).toHaveLength(0)
  })

  it('profile-backed removal: name → _system_removed_ scoped by id AND business, account banned, audit flags', async () => {
    profileRow = { id: 'staff-9', full_name: '田中' }
    let res!: Response
    const lines = await auditLines(async () => {
      res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(staffDelete).toHaveBeenCalledWith('synqed-7')
    expect(profileUpdates).toEqual([
      {
        patch: { full_name: '_system_removed_田中' },
        eq: [
          ['id', 'staff-9'],
          ['customer_id', 'business-1'],
        ],
      },
    ])
    expect(updateUserById).toHaveBeenCalledWith('staff-9', { ban_duration: '876000h' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.remove',
      source: 'facade',
      detail: { synqed_staff_id: 'synqed-7', self_removal: false, profile_neutralised: true, account_banned: true },
    })
  })

  it('self-removal (the Bearer caller removes their OWN row): SAME treatment — core delete, name move AND ban run; audit self_removal:true', async () => {
    profileRow = { id: 'auth-user-1', full_name: '田中' }
    let res!: Response
    const lines = await auditLines(async () => {
      res = await deleteDELETE(deleteReq('auth-user-1'), params('auth-user-1'))
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(staffDelete).toHaveBeenCalledWith('synqed-7')
    expect(profileUpdates).toEqual([
      {
        patch: { full_name: '_system_removed_田中' },
        eq: [
          ['id', 'auth-user-1'],
          ['customer_id', 'business-1'],
        ],
      },
    ])
    expect(updateUserById).toHaveBeenCalledWith('auth-user-1', { ban_duration: '876000h' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.remove',
      actor_id: 'auth-user-1',
      target_id: 'auth-user-1',
      detail: { synqed_staff_id: 'synqed-7', self_removal: true, profile_neutralised: true, account_banned: true },
    })
  })

  // The owner guard lives in deleteStaffCore (one home, first in the chain);
  // the route lets its AppApiError through instead of relabelling it a 502.
  it('the OWNER row → 403 forbidden: NO core delete, NO profile update, NO ban, NO audit', async () => {
    profileRow = { id: 'staff-owner', full_name: '佐藤', display_role: 'owner' }
    let res!: Response
    const lines = await auditLines(async () => {
      res = await deleteDELETE(deleteReq('staff-owner'), params('staff-owner'))
    })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'forbidden' })
    expect(staffDelete).not.toHaveBeenCalled()
    expect(profileUpdates).toHaveLength(0)
    expect(updateUserById).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('the profiles LOOKUP fails → 502 upstream_unavailable: NO core delete, NO profile update, NO ban, NO audit', async () => {
    profileLookupError = { message: 'db down' }
    let res!: Response
    const lines = await auditLines(async () => {
      res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatchObject({ code: 'upstream_unavailable' })
    expect(staffDelete).not.toHaveBeenCalled()
    expect(profileUpdates).toHaveLength(0)
    expect(updateUserById).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('another _system_ name (not the removal marker) → renamed _system_removed__system_other', async () => {
    profileRow = { id: 'staff-9', full_name: '_system_other' }
    const res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    expect(res.status).toBe(200)
    expect(profileUpdates).toHaveLength(1)
    expect(profileUpdates[0].patch).toEqual({ full_name: '_system_removed__system_other' })
  })

  it('a MANAGER row (not the owner) → today\'s removal: 200, name move, ban', async () => {
    profileRow = { id: 'staff-mgr', full_name: '鈴木', display_role: 'manager' }
    const res = await deleteDELETE(deleteReq('staff-mgr'), params('staff-mgr'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(staffDelete).toHaveBeenCalledWith('synqed-7')
    expect(profileUpdates).toHaveLength(1)
    expect(updateUserById).toHaveBeenCalledWith('staff-mgr', { ban_duration: '876000h' })
  })

  it('the 400 guard on a profile-backed id neutralises nothing: no profile update, no ban', async () => {
    profileRow = { id: 'staff-9', full_name: '田中' }
    staffDelete.mockRejectedValueOnce(new SynqedError(400, 'Cannot delete the last staff member.'))
    const res = await deleteDELETE(deleteReq('staff-9'), params('staff-9'))
    expect(await res.json()).toEqual({ error: 'Cannot delete the last staff member.' })
    expect(profileUpdates).toHaveLength(0)
    expect(updateUserById).not.toHaveBeenCalled()
  })
})

describe('POST /api/app/v1/staff/[id]/avatar', () => {
  it('missing staff.manage → 403, no write', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await avatarPOST(avatarReq('staff-9', avatarForm()), params('staff-9'))
    expect(res.status).toBe(403)
    expect(staffUploadAvatar).not.toHaveBeenCalled()
  })

  it('a non-image content-type → 400, no write', async () => {
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3])], 'a.txt', { type: 'text/plain' }))
    const res = await avatarPOST(avatarReq('staff-9', fd), params('staff-9'))
    expect(res.status).toBe(400)
    expect(staffUploadAvatar).not.toHaveBeenCalled()
  })

  it('a declared image/png with non-image bytes → 400 (magic-byte sniff), no write', async () => {
    const fd = new FormData()
    fd.set('file', new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])], 'fake.png', { type: 'image/png' }))
    const res = await avatarPOST(avatarReq('staff-9', fd), params('staff-9'))
    expect(res.status).toBe(400)
    expect(staffUploadAvatar).not.toHaveBeenCalled()
  })

  it('happy path → 201 { url }, one staff.avatar_update row at info, source facade', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await avatarPOST(avatarReq('staff-9', avatarForm()), params('staff-9'))
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ url: 'https://cdn.test/a.png' })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.avatar_update',
      severity: 'info',
      target_id: 'staff-9',
      source: 'facade',
    })
  })
})

// ─── Actor store-scope clamp (ensureStaffWriteInScope) ──────────────────────
// The facade transport of the same clamp src/actions/staff.ts applies on web.
// The UI already hides an out-of-scope roster row (#709); this is the server
// door behind it — a direct Bearer call must be refused too.
describe('staff writes are clamped to the caller\'s stores', () => {
  const CALLER = 'auth-user-1' // the Bearer sub this suite signs with
  const TARGET = 'staff-9'

  // Every write transport, so a clamp that lands on two of three is red.
  const writes: Array<[string, () => Promise<Response>, jest.Mock]> = [
    ['PATCH', () => updatePATCH(patchReq(TARGET, VALID_STAFF), params(TARGET)), staffUpdate],
    ['DELETE', () => deleteDELETE(deleteReq(TARGET), params(TARGET)), staffDelete],
    ['avatar POST', () => avatarPOST(avatarReq(TARGET, avatarForm()), params(TARGET)), staffUploadAvatar],
  ]

  describe.each(writes)('%s', (_name, run, coreWrite) => {
    it('out-of-scope target → 403 store_forbidden, core untouched, no audit row', async () => {
      storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
      const lines = await auditLines(async () => {
        const res = await run()
        expect(res.status).toBe(403)
        expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
      })
      expect(coreWrite).not.toHaveBeenCalled()
      expect(lines).toHaveLength(0)
    })

    it('in-scope target (shared branch) → passes unchanged', async () => {
      storeAssignments = { [CALLER]: ['store-a', 'store-b'], [TARGET]: ['store-b'] }
      const res = await run()
      expect(res.status).toBeLessThan(300)
      expect(coreWrite).toHaveBeenCalled()
    })

    it('floating TARGET (in every branch = the 全店舗 rule) → 403 store_forbidden, core untouched, no audit row', async () => {
      // Menus parity (src/actions/menus.ts:95-98): an every-store item takes
      // stores.viewAll, however the caller is assigned.
      storeAssignments = { [CALLER]: ['store-a'] }
      const lines = await auditLines(async () => {
        const res = await run()
        expect(res.status).toBe(403)
        expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
      })
      expect(coreWrite).not.toHaveBeenCalled()
      expect(lines).toHaveLength(0)
    })

    it('floating CALLER (no assignment) → passes for a real-store target', async () => {
      storeAssignments = { [TARGET]: ['store-b'] }
      const res = await run()
      expect(res.status).toBeLessThan(300)
      expect(coreWrite).toHaveBeenCalled()
    })

    it('stores.viewAll → byte-identical, the assignment is never consulted', async () => {
      mockCapabilities.mockResolvedValue(new Set(['staff.manage', 'stores.viewAll']))
      storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
      const res = await run()
      expect(res.status).toBeLessThan(300)
      expect(coreWrite).toHaveBeenCalled()
      // ⚖ 2026-09-16 fold round 2: the WRITE CLAMP still never consults an
    // assignment on this path — what does is the front gate at the identity
    // seam, which reads the CALLER's own assignment on every non-viewAll
    // request. That is auth work, one memo-shared read; the clamp's own
    // behaviour (and the TARGET's row) is untouched.
    expect(staffStoresGet).not.toHaveBeenCalledWith(TARGET)
    })

    it("a failed lookup of the caller's own assignment fails closed → 403", async () => {
      staffStoresGet.mockImplementation(async (id: string) => {
        if (id === CALLER) throw new Error('core down')
        return { store_ids: ['store-b'] }
      })
      const res = await run()
      expect(res.status).toBe(403)
      expect(coreWrite).not.toHaveBeenCalled()
    })

    it("a failed lookup of the TARGET's assignment fails closed → 403", async () => {
      storeAssignments = { [CALLER]: ['store-a'] }
      staffStoresGet.mockImplementation(async (id: string) => {
        if (id === TARGET) throw new Error('core down')
        return { store_ids: storeAssignments[id] ?? [] }
      })
      const res = await run()
      expect(res.status).toBe(403)
      expect(coreWrite).not.toHaveBeenCalled()
    })

    // Parity twin of store-scope.test.ts's "an actor the roster cannot place
    // (staffId null) → refused for a real-store AND a floating target". Core
    // answers { store_ids: [] } for an id it holds no rows for, so without the
    // roster oracle this caller would read as FLOATING and pass.
    it.each([
      ['a real-store target', { [TARGET]: ['store-b'] }],
      ['a floating target', {}],
    ])('an actor the roster cannot place → 403 store_forbidden for %s, core untouched, no audit row', async (_label, assignments) => {
      staffListByBusinessOrThrow.mockResolvedValue([{ id: 'someone-else' }])
      storeAssignments = assignments as Record<string, string[]>
      const lines = await auditLines(async () => {
        const res = await run()
        expect(res.status).toBe(403)
        expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
      })
      expect(coreWrite).not.toHaveBeenCalled()
      expect(lines).toHaveLength(0)
    })

    it('an ASSIGNED caller absent from the roster is judged by overlap alone — the roster oracle is never consulted', async () => {
      // The roster check is load-bearing ONLY against the floating
      // misclassification; a real assignment is judged by overlap, which a
      // roster miss cannot loosen. Charging this caller an uncached full-roster
      // read would buy nothing (and double-read on the pin/voice routes).
      staffListByBusinessOrThrow.mockResolvedValue([{ id: 'someone-else' }])
      storeAssignments = { [CALLER]: ['store-a', 'store-b'], [TARGET]: ['store-b'] }
      const res = await run()
      expect(res.status).toBeLessThan(300)
      expect(coreWrite).toHaveBeenCalled()
      expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
    })

    it('viewAll never consults the roster, so an unplaceable id changes nothing (web parity)', async () => {
      mockCapabilities.mockResolvedValue(new Set(['staff.manage', 'stores.viewAll']))
      staffListByBusinessOrThrow.mockResolvedValue([{ id: 'someone-else' }])
      storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
      const res = await run()
      expect(res.status).toBeLessThan(300)
      expect(coreWrite).toHaveBeenCalled()
      expect(staffListByBusinessOrThrow).not.toHaveBeenCalled()
    })
  })

  it('PATCH clamps BEFORE the body parse: an out-of-scope target with an INVALID body is still 403 store_forbidden', async () => {
    // Precedence pin — a 400 here would mean the payload was read before the
    // caller's right to touch this row was settled (avatar-route ordering).
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
    const res = await updatePATCH(patchReq(TARGET, { name: '' }), params(TARGET))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
    expect(staffUpdate).not.toHaveBeenCalled()
  })

  it('self-edit: a clamped caller may always change their OWN avatar', async () => {
    // The read plane guarantees self-visibility; the write plane must agree.
    storeAssignments = { [CALLER]: ['store-a'] }
    const res = await avatarPOST(avatarReq(CALLER, avatarForm()), params(CALLER))
    expect(res.status).toBe(201)
    expect(staffUploadAvatar).toHaveBeenCalledWith(CALLER, expect.anything())
    // ⚖ 2026-09-16 fold round 2: the WRITE CLAMP still never consults an
    // assignment on this path — what does is the front gate at the identity
    // seam, which reads the CALLER's own assignment on every non-viewAll
    // request. That is auth work, one memo-shared read; the clamp's own
    // behaviour (and the TARGET's row) is untouched.
    expect(staffStoresGet).not.toHaveBeenCalledWith(TARGET)
  })

  it('every shipped preset that manages staff also holds stores.viewAll', () => {
    // The clamp can only ever bite a CUSTOM grant: if this list grows a preset
    // without viewAll, that preset just lost the rest of the roster — it stops
    // here first. (Mirror of the menus clamp's own preset pin.)
    const roles = Object.keys(ROLE_PRESETS) as (keyof typeof ROLE_PRESETS)[]
    const staffManagers = roles.filter((r) => ROLE_PRESETS[r].includes('staff.manage'))
    expect(staffManagers).toEqual(['owner', 'manager'])
    for (const role of staffManagers) expect(ROLE_PRESETS[role]).toContain('stores.viewAll')
  })
})
