// The 30-day customer-deletion pair on the PHONE (PHONEWIRE-2B) — the two
// facade doors behind the privacy tab's 削除 CTA and the profile banner's
// 元に戻す. Both run the SAME WithClient bodies the web actions run, so what
// this file pins is everything the shared body does NOT own: the
// records.delete gate (a destructive act, not a viewing one), the roster gate,
// tenancy before any write, the guard codes riding the 2xx body verbatim, the
// audit row a real transition writes — and the row a GUARDED one must not.
//
// The source:'web' pin at the bottom is the one that would have caught the
// misattribution this refactor exists to prevent: emitDeletionAudit hardcodes
// source:'web', so leaving it inside the shared core would have stamped every
// phone deletion as a web act on the manager's 監査ログ.
//
// Writes are mocked at the SDK boundary so the real route → core → guard path
// runs; the Bearer verifier runs for real.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

const audit = jest.fn()
jest.mock('@/lib/audit', () => ({ ...jest.requireActual('@/lib/audit'), audit: (...a: unknown[]) => audit(...(a as [])) }))

// Both keys are revocation-sensitive → getUser MUST confirm the user.
const revoked = { current: false }
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => (revoked.current ? { data: { user: null }, error: null } : { data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['records.delete', 'customers.view']) }
const staffRoster = { current: [{ id: 'auth-user-1', full_name: '田中' }] as { id: string; full_name: string }[] }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  getCurrentUserStaffId: jest.fn(async () => 'auth-user-1'),
  staffListByBusinessOrThrow: jest.fn(async () => staffRoster.current),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
  requireCapability: jest.fn(async () => undefined),
}))

// UUID-shaped: logFacadeAudit only stamps params.id as the audit target when
// it is — a 'cust-1' would pass every status assertion and write a null target.
const CUST = '00000000-0000-4000-8000-00000000c001'
const CROSS = '00000000-0000-4000-8000-00000000c0ff'

const deletedAt = { current: null as string | null }
const get = jest.fn(async (id: string) => ({ id, name: '山田', deleted_at: deletedAt.current }))
const update = jest.fn(async () => ({}))
const fakeClient = { customers: { get, update } }
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => fakeClient, getSynqedClient: async () => fakeClient }))

// Tenancy oracle — CUST belongs to this business, anything else 404s.
jest.mock('@/lib/customers/queries', () => ({
  getCustomerWithClient: jest.fn(async (_c: unknown, id: string) => {
    if (id !== CUST) throw new Error('404 cross-tenant')
    return { id, name: '山田' }
  }),
}))

import { POST as schedulePOST, OPTIONS as scheduleOPTIONS } from '@/app/api/app/v1/customers/[id]/deletion/schedule/route'
import { POST as cancelPOST } from '@/app/api/app/v1/customers/[id]/deletion/cancel/route'
import { presetCapabilities } from '@/lib/auth/permissions'

const SECRET = process.env.AUTH_SUPABASE_JWT_SECRET!
const ISSUER = `${process.env.AUTH_SUPABASE_URL}/auth/v1`
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function bearer(sub = 'auth-user-1') {
  const now = Math.floor(Date.now() / 1000)
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const payload = b64({ sub, iss: ISSUER, aud: 'authenticated', exp: now + 3600, iat: now })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}
const auth = { authorization: `Bearer ${bearer()}` }
const route = (id = CUST) => ({ params: Promise.resolve({ id }) })
const req = (headers: Record<string, string> = auth) => new Request('https://s/x', { method: 'POST', headers })
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.delete', 'customers.view'])
  staffRoster.current = [{ id: 'auth-user-1', full_name: '田中' }]
  revoked.current = false
  deletedAt.current = null
})

describe('POST …/deletion/schedule', () => {
  it('happy → 200, sets deleted_at, and files the privacy row as a FACADE act', async () => {
    const res = await schedulePOST(req(), route())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, id: CUST })
    expect(update).toHaveBeenCalledWith(CUST, expect.objectContaining({ deleted_at: expect.any(String) }))
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'privacy.customer_delete_scheduled',
        category: 'privacy',
        targetType: 'customer',
        targetId: CUST,
        actorId: 'auth-user-1',
        businessId: 'business-1',
        source: 'facade',
      }),
    )
  })

  // THE misattribution pin: emitDeletionAudit hardcodes source:'web'. If it
  // ever slides back into the shared core, the phone's deletions start
  // claiming the web door wrote them.
  it('files NO web-sourced row — emitDeletionAudit belongs to the cookie door', async () => {
    await schedulePOST(req(), route())
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'web' }))
  })

  it('missing Bearer → 401 before any read', async () => {
    const res = await schedulePOST(new Request('https://s/x', { method: 'POST' }), route())
    expect(res.status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('records.write + customers.view is NOT enough → 403, no write', async () => {
    capabilities.current = new Set(['records.write', 'customers.view', 'bookings.manage'])
    const res = await schedulePOST(req(), route())
    expect(res.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  // The preset a real salon's 施術者 carries — read from the source of truth,
  // so a future widening of the practitioner role fails HERE rather than
  // quietly handing every stylist the delete button.
  it('the practitioner PRESET is refused → 403, no write', async () => {
    capabilities.current = new Set<string>(presetCapabilities('practitioner'))
    const res = await schedulePOST(req(), route())
    expect(res.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('a caller who is not on this business’s roster → 403, no write', async () => {
    staffRoster.current = [{ id: 'someone-else', full_name: 'x' }]
    const res = await schedulePOST(req(), route())
    expect(res.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('cross-business customer → 404 BEFORE any write (proveCustomerInBusiness)', async () => {
    const res = await schedulePOST(req(), route(CROSS))
    expect(res.status).toBe(404)
    expect(update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('already scheduled → 200 carrying the guard code, and NO audit row', async () => {
    deletedAt.current = daysAgo(3)
    const res = await schedulePOST(req(), route())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: false, error: 'already_scheduled' })
    expect(update).not.toHaveBeenCalled()
    // ctx.auditSuppress: a guarded 2xx is a write that did not happen.
    expect(audit).not.toHaveBeenCalled()
  })

  it('an upstream failure is a 502, never a 2xx (the honesty law)', async () => {
    update.mockImplementationOnce(async () => { throw new Error('core down') })
    const res = await schedulePOST(req(), route())
    expect(res.status).toBe(502)
    expect(audit).not.toHaveBeenCalled()
  })

  it('revoked staffer → 401 via the server round-trip (no local fast-path)', async () => {
    revoked.current = true
    const res = await schedulePOST(req(), route())
    expect(res.status).toBe(401)
    expect(update).not.toHaveBeenCalled()
  })

  it('OPTIONS preflight short-circuits before auth', async () => {
    const res = await scheduleOPTIONS(new Request('https://s/x', { method: 'OPTIONS' }), route())
    expect(res.status).toBeLessThan(300)
  })

  it('carries NO Idempotency-Key requirement (design ruling: idempotent set-op)', async () => {
    const res = await schedulePOST(req(), route())
    expect(res.status).toBe(200)
  })
})

describe('POST …/deletion/cancel', () => {
  it('happy → 200 inside the window, nulls deleted_at, files the cancel row', async () => {
    deletedAt.current = daysAgo(2)
    const res = await cancelPOST(req(), route())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, id: CUST })
    expect(update).toHaveBeenCalledWith(CUST, expect.objectContaining({ deleted_at: null }))
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'privacy.customer_delete_canceled',
        category: 'privacy',
        targetId: CUST,
        source: 'facade',
      }),
    )
  })

  it('nothing scheduled → 200 carrying not_scheduled, no write, no row', async () => {
    const res = await cancelPOST(req(), route())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: false, error: 'not_scheduled' })
    expect(update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('past the 30-day deadline → 200 carrying window_expired, no write', async () => {
    deletedAt.current = daysAgo(31)
    const res = await cancelPOST(req(), route())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: false, error: 'window_expired' })
    expect(update).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('the practitioner PRESET is refused → 403, no write', async () => {
    deletedAt.current = daysAgo(2)
    capabilities.current = new Set<string>(presetCapabilities('practitioner'))
    const res = await cancelPOST(req(), route())
    expect(res.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('a caller who is not on this business’s roster → 403, no write', async () => {
    deletedAt.current = daysAgo(2)
    staffRoster.current = [{ id: 'someone-else', full_name: 'x' }]
    const res = await cancelPOST(req(), route())
    expect(res.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('cross-business customer → 404 before any write', async () => {
    deletedAt.current = daysAgo(2)
    const res = await cancelPOST(req(), route(CROSS))
    expect(res.status).toBe(404)
    expect(update).not.toHaveBeenCalled()
  })

  it('files NO web-sourced row', async () => {
    deletedAt.current = daysAgo(2)
    await cancelPOST(req(), route())
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'web' }))
  })

  it('an upstream failure is a 502, never a 2xx', async () => {
    deletedAt.current = daysAgo(2)
    update.mockImplementationOnce(async () => { throw new Error('core down') })
    const res = await cancelPOST(req(), route())
    expect(res.status).toBe(502)
  })

  it('missing Bearer → 401', async () => {
    const res = await cancelPOST(new Request('https://s/x', { method: 'POST' }), route())
    expect(res.status).toBe(401)
  })
})
