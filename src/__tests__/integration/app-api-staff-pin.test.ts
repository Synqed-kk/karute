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
const fakeClient = { staff: { setPin, removePin } }
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
})

describe('PUT /api/app/v1/staff/[id]/pin', () => {
  it('no ensureCapability floor: a caller with NO staff.manage/staff.invite can set their OWN pin', async () => {
    const res = await PUT(putReq('staff/auth-user-1/pin', { pin: '1234' }), params('auth-user-1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    expect(setPin).toHaveBeenCalledWith('auth-user-1', '1234', 'auth-user-1')
  })

  it('actingStaffId is the roster-resolved self id, never a caller-supplied value', async () => {
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
