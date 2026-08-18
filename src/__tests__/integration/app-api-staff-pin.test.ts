// Staff PIN facade routes (design-parity packet 12 §S4b). Pins:
//   - NO ensureCapability floor — web's own action has none either;
//     synqed-core enforces self-or-owner/admin server-side from the
//     `actingStaffId` argument (staff-pin.ts's own doc comment)
//   - actingStaffId is derived from the Bearer identity's roster row
//     (resolveSelfStaffId — the selfRow idiom), NEVER read from the request
//   - a caller absent from the roster (unresolvable self) → business-level
//     { error }, never reaches the SDK
//   - a non-4-digit PIN → business-level { error }, never reaches the SDK
//   - business-result passthrough: the core's { error? } rides the 2xx body
//     VERBATIM
//   - PIN values are never logged/echoed (the audit row carries ids only)
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

const mockCapabilities = jest.fn(async () => new Set(['customers.view']))
jest.mock('@/lib/auth/require-permission', () => {
  const actual = jest.requireActual('@/lib/auth/require-permission')
  return { ...actual, capabilitiesForUser: () => mockCapabilities() }
})

const staffListByBusinessOrThrow = jest.fn(async (..._a: unknown[]) => [
  { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist' },
])
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: (...a: unknown[]) => staffListByBusinessOrThrow(...a),
}))

const setPin = jest.fn(async () => undefined)
const removePin = jest.fn(async () => undefined)
// Store assignments the non-self clamp reads (ensureStaffWriteInScope): keyed
// by staff id so a test can put the CALLER and the TARGET in different
// branches. Default = everyone floating (empty assignment = works in every
// store), the unclamped path every pre-clamp pin in this file was written
// against.
let storeAssignments: Record<string, string[]> = {}
const staffStoresGet = jest.fn(async (id: string) => ({ store_ids: storeAssignments[id] ?? [] }))
const fakeClient = { staff: { setPin, removePin }, staffStores: { get: staffStoresGet } }
const newSynqedClient = jest.fn((_businessId: string) => fakeClient)
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: (businessId: string) => newSynqedClient(businessId),
}))

import { PUT, DELETE } from '@/app/api/app/v1/staff/[id]/pin/route'
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

const putReq = (path: string, body: unknown) =>
  new Request(`https://s/api/app/v1/${path}`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const deleteReq = (path: string) =>
  new Request(`https://s/api/app/v1/${path}`, { method: 'DELETE', headers: auth })

beforeEach(() => {
  jest.clearAllMocks()
  mockCapabilities.mockResolvedValue(new Set(['customers.view']))
  staffListByBusinessOrThrow.mockResolvedValue([
    { id: 'auth-user-1', full_name: 'Mika Tanaka', display_role: 'stylist' },
  ])
  storeAssignments = {}
  staffStoresGet.mockImplementation(async (id: string) => ({ store_ids: storeAssignments[id] ?? [] }))
})

describe('PUT /api/app/v1/staff/[id]/pin', () => {
  it('no ensureCapability floor: a caller with NO staff.manage/staff.invite can set their OWN pin', async () => {
    const res = await PUT(putReq('staff/auth-user-1/pin', { pin: '1234' }), params('auth-user-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(setPin).toHaveBeenCalledWith('auth-user-1', '1234', 'auth-user-1')
  })

  it('actingStaffId is the roster-resolved self id, never a caller-supplied value', async () => {
    mockCapabilities.mockResolvedValue(new Set(['staff.manage'])) // non-self now needs it
    await PUT(putReq('staff/staff-9/pin', { pin: '1234' }), params('staff-9'))
    // Third arg is always the SERVER-resolved self id (auth-user-1), even
    // though the caller never sent one — the body only ever carries `pin`.
    expect(setPin).toHaveBeenCalledWith('staff-9', '1234', 'auth-user-1')
  })

  it('caller absent from the roster (unresolvable self) → business-level { error }, SDK never reached', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([]) // auth-user-1 not in roster
    const res = await PUT(putReq('staff/staff-9/pin', { pin: '1234' }), params('staff-9'))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toMatch(/not authorized/i)
    expect(setPin).not.toHaveBeenCalled()
  })

  it('a non-4-digit PIN → business-level { error }, SDK never reached', async () => {
    const res = await PUT(putReq('staff/auth-user-1/pin', { pin: '12' }), params('auth-user-1'))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toMatch(/4 digits/i)
    expect(setPin).not.toHaveBeenCalled()
  })

  it('emits staff.pin_set at notice, source facade — never the PIN value', async () => {
    let body: string
    const lines = await auditLines(async () => {
      const res = await PUT(putReq('staff/auth-user-1/pin', { pin: '1234' }), params('auth-user-1'))
      body = await res.text()
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      category: 'staff',
      action: 'staff.pin_set',
      severity: 'notice',
      actor_id: 'auth-user-1',
      business_id: 'business-1',
      target_type: 'staff',
      target_id: 'auth-user-1',
      source: 'facade',
    })
    expect(JSON.stringify(lines[0])).not.toContain('1234')
    expect(body!).not.toContain('1234')
  })

  it('a failed SDK write → { error }, no audit row (silence contract)', async () => {
    setPin.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const res = await PUT(putReq('staff/auth-user-1/pin', { pin: '1234' }), params('auth-user-1'))
      expect((await res.json()).error).toBe('core down')
    })
    expect(lines).toHaveLength(0)
  })
})

describe('DELETE /api/app/v1/staff/[id]/pin', () => {
  it('no ensureCapability floor: a caller with NO staff.manage/staff.invite can remove their OWN pin', async () => {
    const res = await DELETE(deleteReq('staff/auth-user-1/pin'), params('auth-user-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(removePin).toHaveBeenCalledWith('auth-user-1', 'auth-user-1')
  })

  it('caller absent from the roster → business-level { error }, SDK never reached', async () => {
    staffListByBusinessOrThrow.mockResolvedValue([])
    const res = await DELETE(deleteReq('staff/staff-9/pin'), params('staff-9'))
    expect(res.status).toBe(200)
    expect((await res.json()).error).toMatch(/not authorized/i)
    expect(removePin).not.toHaveBeenCalled()
  })

  it('emits staff.pin_removed at notice, source facade', async () => {
    const lines = await auditLines(async () => {
      await DELETE(deleteReq('staff/auth-user-1/pin'), params('auth-user-1'))
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      action: 'staff.pin_removed',
      severity: 'notice',
      target_id: 'auth-user-1',
      source: 'facade',
    })
  })

  it('a failed SDK write → { error }, no audit row (silence contract)', async () => {
    removePin.mockRejectedValueOnce(new Error('core down'))
    const lines = await auditLines(async () => {
      const res = await DELETE(deleteReq('staff/auth-user-1/pin'), params('auth-user-1'))
      expect((await res.json()).error).toBe('core down')
    })
    expect(lines).toHaveLength(0)
  })
})

// ─── Non-self PIN gate: staff.manage + actor store scope ────────────────────
// A practitioner setting their OWN PIN stays gate-free (the "no
// ensureCapability floor" pin above). Re-keying SOMEONE ELSE is a staff-
// management act: the capability, plus the same store clamp #715 put on the
// staff CRUD writes. synqed-core's own self-or-owner/admin rule sits behind
// this as defense-in-depth.
describe('non-self PIN writes need staff.manage + the caller\'s stores', () => {
  const CALLER = 'auth-user-1' // the Bearer sub this suite signs with
  const TARGET = 'staff-9'

  const writes: Array<[string, () => Promise<Response>, jest.Mock]> = [
    ['PUT', () => PUT(putReq(`staff/${TARGET}/pin`, { pin: '1234' }), params(TARGET)), setPin],
    ['DELETE', () => DELETE(deleteReq(`staff/${TARGET}/pin`), params(TARGET)), removePin],
  ]

  describe.each(writes)('%s', (_name, run, coreWrite) => {
    it('no staff.manage → 403 forbidden, SDK untouched, no audit row', async () => {
      mockCapabilities.mockResolvedValue(new Set(['customers.view']))
      const lines = await auditLines(async () => {
        const res = await run()
        expect(res.status).toBe(403)
      })
      expect(coreWrite).not.toHaveBeenCalled()
      expect(lines).toHaveLength(0)
    })

    it('staff.manage but out-of-scope target → 403 store_forbidden, SDK untouched, no audit row', async () => {
      mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
      storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
      const lines = await auditLines(async () => {
        const res = await run()
        expect(res.status).toBe(403)
        expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
      })
      expect(coreWrite).not.toHaveBeenCalled()
      expect(lines).toHaveLength(0)
    })

    it('staff.manage + in-scope target (shared branch) → passes', async () => {
      mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
      storeAssignments = { [CALLER]: ['store-a', 'store-b'], [TARGET]: ['store-b'] }
      const res = await run()
      expect(res.status).toBe(200)
      expect(coreWrite).toHaveBeenCalled()
    })

    it('stores.viewAll → passes, the assignment is never consulted', async () => {
      mockCapabilities.mockResolvedValue(new Set(['staff.manage', 'stores.viewAll']))
      storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
      const res = await run()
      expect(res.status).toBe(200)
      expect(staffStoresGet).not.toHaveBeenCalled()
    })

    it("a failed lookup of the caller's own assignment fails closed → 403", async () => {
      mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
      staffStoresGet.mockImplementation(async (id: string) => {
        if (id === CALLER) throw new Error('core down')
        return { store_ids: ['store-b'] }
      })
      const res = await run()
      expect(res.status).toBe(403)
      expect(coreWrite).not.toHaveBeenCalled()
    })
  })

  it('SELF with NO staff.manage still works, and never consults an assignment', async () => {
    // The today-behaviour pin: a practitioner owns their own switch credential.
    mockCapabilities.mockResolvedValue(new Set(['customers.view']))
    storeAssignments = { [CALLER]: ['store-a'] }
    const res = await PUT(putReq(`staff/${CALLER}/pin`, { pin: '1234' }), params(CALLER))
    expect(res.status).toBe(200)
    expect(setPin).toHaveBeenCalledWith(CALLER, '1234', CALLER)
    expect(staffStoresGet).not.toHaveBeenCalled()
  })

  it('PUT clamps BEFORE the body parse: an out-of-scope target with an INVALID body is still 403 store_forbidden', async () => {
    mockCapabilities.mockResolvedValue(new Set(['staff.manage']))
    storeAssignments = { [CALLER]: ['store-a'], [TARGET]: ['store-b'] }
    const res = await PUT(putReq(`staff/${TARGET}/pin`, { nope: 1 }), params(TARGET))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatchObject({ code: 'store_forbidden' })
    expect(setPin).not.toHaveBeenCalled()
  })
})
