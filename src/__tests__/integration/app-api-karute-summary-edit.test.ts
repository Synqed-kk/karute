// Facade PATCH /karute/[id]/summary (edit-layer W2 summary half — the
// 詳細記録 pencil). Pins: content round-trips to the shared overlay core (the
// write is edited_summary ONLY); the proof-read 404s a foreign/missing record
// BEFORE any write; missing capability is 403 before any read/write;
// trim-empty content is a 400, not a 502; the choke-point audit fires exactly
// once with source:'facade', the proof-read's customer_id AND before-text —
// 'karute.summary.update' is a deliberate `skip` row in FACADE_AUDIT_MAP
// (choke-point doctrine, same as karute.entry.update), so this is the ONLY
// place the facade's emit is pinned.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
jest.mock('next-intl/server', () => ({ getLocale: async () => 'ja' }))
// resolveSelfStaffId's chain has a top-level value import of the real ESM
// client — mock it so jest never tries to parse the package's ESM re-export.
jest.mock('@synqed-kk/client', () => ({}))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1', full_name: '田中' }]),
}))
const capabilities = { current: new Set<string>(['records.write']) }
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))

const auditSpy = jest.fn()
// Spread the REAL module so FACADE_AUDIT_MAP stays live inside logFacadeAudit
// — an empty stub makes the map lookup miss, tripping CP6's loud floor in
// test mode. Only the emitter is stubbed.
jest.mock('@/lib/audit', () => ({
  ...jest.requireActual('@/lib/audit'),
  audit: (...a: unknown[]) => auditSpy(...(a as [])),
}))

const get = jest.fn(async (id: string) => {
  if (id !== 'kar-1') throw Object.assign(new Error('not found'), { status: 404 })
  return { id: 'kar-1', customer_id: 'cust-1', ai_summary: 'AIの要約', edited_summary: null }
})
const update = jest.fn(async () => ({ id: 'kar-1' }))
jest.mock('@/lib/synqed/client', () => ({
  newSynqedClient: () => ({ karuteRecords: { get: (id: string) => get(id), update } }),
}))

import { PATCH } from '@/app/api/app/v1/karute/[id]/summary/route'

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
const routeFor = (id: string) => ({ params: Promise.resolve({ id }) })
const patchReq = (body: unknown) =>
  new Request('https://s/x', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${bearer()}` },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['records.write'])
})

describe('PATCH /karute/[id]/summary (edit-layer W2 summary half)', () => {
  it('round-trips content to the shared overlay core → 200, emits the choke-point audit once with the proof-read before-text', async () => {
    const res = await PATCH(patchReq({ content: '・直した要約' }), routeFor('kar-1'))
    expect(res.status).toBe(200)
    // Exact payload — edited_summary ONLY, never ai_summary, never entries.
    expect(update).toHaveBeenCalledWith('kar-1', {
      edited_summary: '・直した要約',
      actor_staff_id: 'auth-user-1',
    })
    expect(auditSpy).toHaveBeenCalledTimes(1)
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'karute.summary_edit',
        actorId: 'auth-user-1',
        businessId: 'business-1',
        source: 'facade',
        targetId: 'kar-1',
        detail: expect.objectContaining({
          customer_id: 'cust-1',
          before: 'AIの要約',
          after: '・直した要約',
        }),
      }),
    )
  })

  it('trim-empty content → 400, not a generic 502', async () => {
    const res = await PATCH(patchReq({ content: '   ' }), routeFor('kar-1'))
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('foreign/missing record id → 404 before any write', async () => {
    const res = await PATCH(patchReq({ content: 'x' }), routeFor('kar-OTHER'))
    expect(res.status).toBe(404)
    expect(update).not.toHaveBeenCalled()
    expect(auditSpy).not.toHaveBeenCalled()
  })

  it('missing capability → 403, no read, no write', async () => {
    capabilities.current = new Set()
    const res = await PATCH(patchReq({ content: 'x' }), routeFor('kar-1'))
    expect(res.status).toBe(403)
    expect(get).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('an unknown body key is rejected by the strict schema (400)', async () => {
    const res = await PATCH(patchReq({ content: 'x', ai_summary: 'smuggled' }), routeFor('kar-1'))
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})
