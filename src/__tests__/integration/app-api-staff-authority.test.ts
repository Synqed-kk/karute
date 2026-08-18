// Staff authority facade routes (design-parity packet 12 §S4a). Pins the
// invariants moved INTO setStaffPermissionsCore/setStaffStoresCore so web
// and facade can never diverge:
//   - never target the account owner (permissions PUT)
//   - no-escalation-by-delta: a caller can only grant a capability they hold
//     themselves (permissions PUT)
//   - audit.view grants are owner-only, even when the caller nominally holds
//     the capability via an override (permissions PUT)
//   - staff-stores PUT is owner-only (STRICTER than staff.manage — a
//     requireOwner mirror, elevated to a standard facade 403)
//   - staff-stores GET carries a staff.manage FLOOR — a deliberate
//     divergence from web's ungated getStaffStores() action
// Plus the silence contract: a denied or failed write emits no audit row.
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
// The clamped web actions in these cores' module graph import next-intl/server
// (ESM) for the store-scope refusal message — echo the key, same as every
// other suite that pulls src/actions/* in.
jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
jest.mock('@synqed-kk/client', () => ({
  SynqedClient: jest.fn(),
  SynqedError: class extends Error {},
}))

const mockCapabilities = jest.fn(async () => new Set(['staff.manage']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const staffListByBusinessOrThrow = jest.fn(async (..._a: unknown[]) => [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: (...a: unknown[]) => staffListByBusinessOrThrow(...a),
}))

// Configurable Supabase service-client mock — profiles select/update, same
// chainable-builder shape as action-audit.test.ts. `selectResults` is
// consumed IN ORDER (setStaffPermissionsCore issues up to two selects: the
// target row, then — only when granting audit.view — the caller's own row).
let selectResults: Array<Record<string, unknown> | null> = []
let updateError: { message: string } | null = null
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const builder: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) builder[m] = () => builder
    ;(builder as { maybeSingle: unknown }).maybeSingle = async () =>
      ({ data: selectResults.shift() ?? null })
    ;(builder as { update: unknown }).update = () => {
      const chain: Record<string, unknown> = {}
      chain.eq = () => chain
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ error: updateError })
      return chain
    }
    return { from: () => builder }
  },
}))

const staffStoresGet = jest.fn<Promise<{ store_ids: string[] }>, [string]>(async () => ({
  store_ids: ['store-a'],
}))
const staffStoresSet = jest.fn(async () => ({}))
const fakeClient = { staffStores: { get: staffStoresGet, set: staffStoresSet } }
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { GET as permissionsGET, PUT as permissionsPUT } from '@/app/api/app/v1/staff/[id]/permissions/route'
import { GET as storesGET, PUT as storesPUT } from '@/app/api/app/v1/staff/[id]/stores/route'
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

const getReq = (path: string) => new Request(`https://s/api/app/v1/${path}`, { headers: auth })
const putReq = (path: string, body: unknown) =>
  new Request(`https://s/api/app/v1/${path}`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

// A target row that ISN'T the owner (practitioner, holds nothing special).
const nonOwnerTarget = { id: 'staff-9', display_role: 'stylist', permission_role: 'practitioner', permissions: null }
const ownerTarget = { id: 'staff-owner', display_role: 'owner', permission_role: 'owner', permissions: null }

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
  staffListByBusinessOrThrow.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'owner' },
  ])
  selectResults = []
  updateError = null
  staffStoresGet.mockResolvedValue({ store_ids: ['store-a'] })
  staffStoresSet.mockResolvedValue({})
})

describe('GET /api/app/v1/staff/[id]/permissions', () => {
  it('missing staff.manage → 403, no read', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await permissionsGET(getReq('staff/staff-9/permissions'), params('staff-9'))
    expect(res.status).toBe(403)
  })

  it('happy path → 200 with the resolved role + capabilities', async () => {
    selectResults = [nonOwnerTarget]
    const res = await permissionsGET(getReq('staff/staff-9/permissions'), params('staff-9'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.permissionRole).toBe('practitioner')
    expect(body.isOwner).toBe(false)
  })
})

describe('PUT /api/app/v1/staff/[id]/permissions — authz invariants', () => {
  it('never-target-owner: targeting the owner row → business-level { error }, no write, no audit row', async () => {
    selectResults = [ownerTarget]
    const lines = await auditLines(async () => {
      const res = await permissionsPUT(
        putReq('staff/staff-owner/permissions', { permissionRole: 'manager', capabilities: [] }),
        params('staff-owner'),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).error).toMatch(/owner/i)
    })
    expect(lines).toHaveLength(0)
  })

  it('never-target-owner holds on the display_role signal ALONE (pre-migration row, mixed case)', async () => {
    // The core's owner check is an OR over two signals; exercise each half
    // independently so dropping either branch turns a pin red.
    selectResults = [{ id: 'staff-owner', display_role: 'Owner', permission_role: null, permissions: null }]
    const lines = await auditLines(async () => {
      const res = await permissionsPUT(
        putReq('staff/staff-owner/permissions', { permissionRole: 'manager', capabilities: [] }),
        params('staff-owner'),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).error).toMatch(/owner/i)
    })
    expect(lines).toHaveLength(0)
  })

  it('never-target-owner holds on the permission_role signal ALONE (post-migration row)', async () => {
    selectResults = [{ id: 'staff-owner', display_role: 'stylist', permission_role: 'owner', permissions: null }]
    const lines = await auditLines(async () => {
      const res = await permissionsPUT(
        putReq('staff/staff-owner/permissions', { permissionRole: 'manager', capabilities: [] }),
        params('staff-owner'),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).error).toMatch(/owner/i)
    })
    expect(lines).toHaveLength(0)
  })

  it('no-escalation-by-delta: caller lacks a capability being ADDED → { error }, no write, no audit row', async () => {
    mockCapabilities.mockResolvedValue(new Set(['staff.manage'])) // no billing.manage
    selectResults = [nonOwnerTarget]
    const lines = await auditLines(async () => {
      const res = await permissionsPUT(
        putReq('staff/staff-9/permissions', {
          permissionRole: 'custom',
          capabilities: ['billing.manage'],
        }),
        params('staff-9'),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).error).toMatch(/grant permissions you have yourself/i)
    })
    expect(lines).toHaveLength(0)
  })

  it('audit.view grant is owner-only: a non-owner caller (holds audit.view via override) is refused, no write, no audit row', async () => {
    // Caller holds staff.manage + audit.view (the capability-hold check
    // alone would pass) but is NOT the account owner — the extra ownership
    // gate on audit.view must still refuse the grant.
    mockCapabilities.mockResolvedValue(new Set(['staff.manage', 'audit.view']))
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Manager', display_role: 'manager' },
    ])
    selectResults = [
      nonOwnerTarget,
      { display_role: 'manager', permission_role: 'manager' }, // caller's own row
    ]
    const lines = await auditLines(async () => {
      const res = await permissionsPUT(
        putReq('staff/staff-9/permissions', {
          permissionRole: 'custom',
          capabilities: ['audit.view'],
        }),
        params('staff-9'),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).error).toMatch(/Only the owner can grant audit-log access/i)
    })
    expect(lines).toHaveLength(0)
  })

  it('sync.view grant is owner-only: a non-owner caller (holds sync.view via override) is refused, no write, no audit row (Greptile #599 twin of the audit.view gate)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['staff.manage', 'sync.view']))
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Manager', display_role: 'manager' },
    ])
    selectResults = [
      nonOwnerTarget,
      { display_role: 'manager', permission_role: 'manager' }, // caller's own row
    ]
    const lines = await auditLines(async () => {
      const res = await permissionsPUT(
        putReq('staff/staff-9/permissions', {
          permissionRole: 'custom',
          capabilities: ['sync.view'],
        }),
        params('staff-9'),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).error).toMatch(/Only the owner can grant sync-status access/i)
    })
    expect(lines).toHaveLength(0)
  })

  it('the OWNER can grant sync.view — happy path twin of the audit.view case (coverage symmetry, verify round)', async () => {
    mockCapabilities.mockResolvedValue(new Set(['staff.manage', 'sync.view']))
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Owner', display_role: 'owner' },
    ])
    selectResults = [
      nonOwnerTarget,
      { display_role: 'owner', permission_role: 'owner' }, // caller's own row — the owner
    ]
    let res!: Response
    const lines = await auditLines(async () => {
      res = await permissionsPUT(
        putReq('staff/staff-9/permissions', {
          permissionRole: 'custom',
          capabilities: ['sync.view'],
        }),
        params('staff-9'),
      )
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ action: 'settings.permissions_change', target_id: 'staff-9' })
  })

  it('the OWNER can grant audit.view — happy path, one settings.permissions_change row, source facade', async () => {
    // Owner holds every capability (including audit.view itself) — the
    // no-escalation-by-delta check (hold what you grant) passes on that
    // alone; the caller's own row below is what the owner-only gate reads.
    mockCapabilities.mockResolvedValue(new Set(['staff.manage', 'audit.view']))
    selectResults = [
      nonOwnerTarget,
      { display_role: 'owner', permission_role: 'owner' }, // caller's own row — the owner
    ]
    let res!: Response
    const lines = await auditLines(async () => {
      res = await permissionsPUT(
        putReq('staff/staff-9/permissions', {
          permissionRole: 'custom',
          capabilities: ['audit.view'],
        }),
        params('staff-9'),
      )
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'settings.permissions_change',
      severity: 'notice',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_id: 'staff-9',
      source: 'facade',
    })
  })

  it('missing staff.manage → 403, no write, no audit row', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const lines = await auditLines(async () => {
      const res = await permissionsPUT(
        putReq('staff/staff-9/permissions', { permissionRole: 'manager', capabilities: [] }),
        params('staff-9'),
      )
      expect(res.status).toBe(403)
    })
    expect(lines).toHaveLength(0)
  })

  it('a failed write (Supabase update error) → { error }, no audit row (silence contract)', async () => {
    selectResults = [nonOwnerTarget]
    updateError = { message: 'db down' }
    const lines = await auditLines(async () => {
      const res = await permissionsPUT(
        putReq('staff/staff-9/permissions', { permissionRole: 'manager', capabilities: [] }),
        params('staff-9'),
      )
      expect(res.status).toBe(200)
      expect((await res.json()).error).toMatch(/Could not save permissions/i)
    })
    expect(lines).toHaveLength(0)
  })
})

describe('GET /api/app/v1/staff/[id]/stores — manage floor (deliberate divergence from web)', () => {
  it('missing staff.manage → 403, no read', async () => {
    mockCapabilities.mockResolvedValue(new Set())
    const res = await storesGET(getReq('staff/staff-9/stores'), params('staff-9'))
    expect(res.status).toBe(403)
    expect(staffStoresGet).not.toHaveBeenCalled()
  })

  it('happy path → 200 { storeIds }', async () => {
    const res = await storesGET(getReq('staff/staff-9/stores'), params('staff-9'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ storeIds: ['store-a'] })
  })
})

describe('PUT /api/app/v1/staff/[id]/stores — owner-only (requireOwner mirror)', () => {
  it('non-owner caller → 403 (standard facade throw, not a soft 200 { error }), no write, no audit row', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Manager', display_role: 'manager' },
    ])
    const lines = await auditLines(async () => {
      const res = await storesPUT(
        putReq('staff/staff-9/stores', { storeIds: ['store-a', 'store-b'] }),
        params('staff-9'),
      )
      expect(res.status).toBe(403)
    })
    expect(staffStoresSet).not.toHaveBeenCalled()
    expect(lines).toHaveLength(0)
  })

  it('owner caller → happy path, one settings.staff_stores_change row, source facade', async () => {
    let res!: Response
    const lines = await auditLines(async () => {
      res = await storesPUT(
        putReq('staff/staff-9/stores', { storeIds: ['store-a', 'store-b'] }),
        params('staff-9'),
      )
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(staffStoresSet).toHaveBeenCalledWith('staff-9', ['store-a', 'store-b'])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'settings.staff_stores_change',
      severity: 'notice',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_id: 'staff-9',
      detail: { store_ids: 'store-a,store-b', count: 2 },
      source: 'facade',
    })
  })

  it('note: PUT has NO ensureCapability("staff.manage") call of its own — the owner check inside the core is the gate (matches createStoreCore/updateStoreCore). A non-owner WITH staff.manage still gets 403.', async () => {
    mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
    staffListByBusinessOrThrow.mockResolvedValue([
      { id: 'auth-user-1', full_name: 'Manager', display_role: 'manager' },
    ])
    const res = await storesPUT(
      putReq('staff/staff-9/stores', { storeIds: [] }),
      params('staff-9'),
    )
    expect(res.status).toBe(403)
  })
})

// ─── Actor store-scope clamp (ensureStaffWriteInScope) ──────────────────────
// The facade transport of the clamp src/actions/permissions.ts applies on web.
// #709 already hides an out-of-scope roster row; this is the server door
// behind it — a direct Bearer call must be refused too. The core's own
// owner-target + no-escalation guards sit BEHIND this, unchanged.
describe("permissions PUT is clamped to the caller's stores", () => {
  const CALLER = 'auth-user-1' // the Bearer sub this suite signs with
  const TARGET = 'staff-9'
  const run = () =>
    permissionsPUT(
      putReq(`staff/${TARGET}/permissions`, { permissionRole: 'practitioner', capabilities: [] }),
      params(TARGET),
    )

  beforeEach(() => {
    mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
    selectResults = [{ display_role: 'stylist', permission_role: 'practitioner', permissions: null }]
  })

  it('out-of-scope target → 403 store_forbidden, no profiles write, no audit row', async () => {
    staffStoresGet.mockImplementation(async (id: string) => ({
      store_ids: id === CALLER ? ['store-a'] : ['store-b'],
    }))
    const lines = await auditLines(async () => {
      const res = await run()
      expect(res.status).toBe(403)
      expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
    })
    expect(lines).toHaveLength(0)
  })

  it('in-scope target (shared branch) → passes unchanged', async () => {
    staffStoresGet.mockImplementation(async (id: string) => ({
      store_ids: id === CALLER ? ['store-a', 'store-b'] : ['store-b'],
    }))
    const res = await run()
    expect(res.status).toBeLessThan(300)
  })

  it('stores.viewAll → passes, the assignment is never consulted', async () => {
    mockCapabilities.mockResolvedValue(new Set(['staff.manage', 'stores.viewAll']))
    const res = await run()
    expect(res.status).toBeLessThan(300)
    expect(staffStoresGet).not.toHaveBeenCalled()
  })

  it("a failed lookup of the caller's own assignment fails closed → 403", async () => {
    staffStoresGet.mockImplementation(async (id: string) => {
      if (id === CALLER) throw new Error('core down')
      return { store_ids: ['store-b'] }
    })
    const res = await run()
    expect(res.status).toBe(403)
  })

  it('clamps BEFORE the body parse: an out-of-scope target with an INVALID body is still 403 store_forbidden', async () => {
    staffStoresGet.mockImplementation(async (id: string) => ({
      store_ids: id === CALLER ? ['store-a'] : ['store-b'],
    }))
    const res = await permissionsPUT(
      putReq(`staff/${TARGET}/permissions`, { permissionRole: 'nope' }),
      params(TARGET),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
  })
})
