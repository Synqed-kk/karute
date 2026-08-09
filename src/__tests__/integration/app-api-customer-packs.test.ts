// Customer 回数券 MUTATION facade — packet 06 §Build 5 + §Build 7 negatives.
// Money + burn rules stay server-side: the single⇒packSize 1 clamp, pack
// tenancy (packId must be one of THIS customer's packs), server-derived burn
// pairing (findCustomerAppointmentForDateWithClient invoked when appointmentId
// is omitted), the over-redeem/double-burn 409, and Idempotency-Key on
// create + redeem. Writes mocked at the store boundary so the REAL
// route→WithClient-core path runs.
import { createHmac } from 'node:crypto'

jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), updateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k, getLocale: async () => 'ja' }))

process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.AUTH_SUPABASE_JWT_SECRET ??= 'test-jwt-secret-for-hmac'
process.env.AUTH_SUPABASE_URL ??= 'https://test-auth.supabase.co'

const revoked = { current: false }
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => (revoked.current ? { data: { user: null }, error: null } : { data: { user: { id: 'auth-user-1' } }, error: null }) },
  }),
}))
jest.mock('@synqed-kk/client', () => ({ SynqedClient: jest.fn(), SynqedError: class extends Error {} }))

const capabilities = { current: new Set<string>(['customers.view']) }
jest.mock('@/lib/staff', () => ({
  businessIdForUser: jest.fn(async () => 'business-1'),
  getBusinessId: jest.fn(async () => 'business-1'),
  staffListByBusinessOrThrow: jest.fn(async () => [{ id: 'auth-user-1', full_name: '田中' }]),
}))
jest.mock('@/lib/auth/require-permission', () => ({
  capabilitiesForUser: jest.fn(async () => capabilities.current),
  ensureCapability: jest.requireActual('@/lib/auth/require-permission').ensureCapability,
}))
jest.mock('@/lib/synqed/client', () => ({ newSynqedClient: () => ({}), getSynqedClient: async () => ({}) }))
jest.mock('@/lib/customers/queries', () => ({
  getCustomerWithClient: jest.fn(async (_c: unknown, id: string) => {
    if (id !== 'cust-1') throw new Error('404')
    return { id }
  }),
}))

// Packs store WithClient boundary.
const listCustomerPacksWithClient = jest.fn(async () => [{ id: 'pack-1' }] as { id: string }[])
const createPackWithClient = jest.fn(async () => ({ ok: true, id: 'pack-new' }))
const addRedemptionWithClient = jest.fn(async () => ({ ok: true, id: 'red-1' }))
const findCustomerAppointmentForDateWithClient = jest.fn(async () => 'appt-derived')
const setCustomerLifecycleWithClient = jest.fn(async () => ({ ok: true }))
jest.mock('@/lib/packs/store', () => ({
  listCustomerPacksWithClient: (...a: unknown[]) => listCustomerPacksWithClient(...(a as [])),
  createPackWithClient: (...a: unknown[]) => createPackWithClient(...(a as [])),
  addRedemptionWithClient: (...a: unknown[]) => addRedemptionWithClient(...(a as [])),
  findCustomerAppointmentForDateWithClient: (...a: unknown[]) => findCustomerAppointmentForDateWithClient(...(a as [])),
  setCustomerLifecycleWithClient: (...a: unknown[]) => setCustomerLifecycleWithClient(...(a as [])),
}))

import { POST as packCreate } from '@/app/api/app/v1/customers/[id]/packs/route'
import { POST as packRedeem } from '@/app/api/app/v1/customers/[id]/packs/redeem/route'
import { POST as lifecycleSet } from '@/app/api/app/v1/customers/[id]/lifecycle/route'

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
const IDEM = { authorization: `Bearer ${bearer()}`, 'Idempotency-Key': 'k1', 'Content-Type': 'application/json' }
const noIdem = { authorization: `Bearer ${bearer()}`, 'Content-Type': 'application/json' }
const route = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (headers: Record<string, string>, body: unknown) =>
  new Request('https://s/x', { method: 'POST', headers, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  capabilities.current = new Set(['customers.view'])
  revoked.current = false
  listCustomerPacksWithClient.mockResolvedValue([{ id: 'pack-1' }])
  addRedemptionWithClient.mockResolvedValue({ ok: true, id: 'red-1' })
})

describe('POST packs (create)', () => {
  it('happy path → 201', async () => {
    const res = await packCreate(post(IDEM, { kind: 'pack', packSize: 10, unitPrice: 5000 }), route('cust-1'))
    expect(res.status).toBe(201)
    expect(createPackWithClient).toHaveBeenCalled()
  })
  it('client-sent totalPrice is ignored — server-derived unitPrice × packSize wins, request NOT rejected (fix/post-session-money-guards)', async () => {
    const res = await packCreate(
      post(IDEM, { kind: 'pack', packSize: 10, unitPrice: 5000, totalPrice: 1 }),
      route('cust-1'),
    )
    expect(res.status).toBe(201)
    expect((createPackWithClient.mock.calls[0] as unknown[])[1]).toMatchObject({ totalPrice: 50000 })
  })
  it('client-sent purchaseRound → 400 (server-derived, strict schema)', async () => {
    const res = await packCreate(
      post(IDEM, { kind: 'pack', packSize: 10, unitPrice: 5000, purchaseRound: 1 }),
      route('cust-1'),
    )
    expect(res.status).toBe(400)
    expect(createPackWithClient).not.toHaveBeenCalled()
  })
  it('single + packSize>1 → 400 validation, no write', async () => {
    const res = await packCreate(post(IDEM, { kind: 'single', packSize: 2, unitPrice: 5000 }), route('cust-1'))
    expect(res.status).toBe(400)
    expect(createPackWithClient).not.toHaveBeenCalled()
  })
  it('missing Idempotency-Key → 400', async () => {
    const res = await packCreate(post(noIdem, { kind: 'pack', packSize: 10, unitPrice: 5000 }), route('cust-1'))
    expect(res.status).toBe(400)
    expect(createPackWithClient).not.toHaveBeenCalled()
  })
  it('cross-tenant customer id → 404, no write', async () => {
    const res = await packCreate(post(IDEM, { kind: 'pack', packSize: 10, unitPrice: 5000 }), route('cust-x'))
    expect(res.status).toBe(404)
    expect(createPackWithClient).not.toHaveBeenCalled()
  })
  it('missing capability → 403', async () => {
    capabilities.current = new Set()
    const res = await packCreate(post(IDEM, { kind: 'pack', packSize: 10, unitPrice: 5000 }), route('cust-1'))
    expect(res.status).toBe(403)
  })
})

describe('POST packs/redeem', () => {
  it('without appointmentId → server derivation invoked', async () => {
    const res = await packRedeem(post(IDEM, { packId: 'pack-1' }), route('cust-1'))
    expect(res.status).toBe(201)
    expect(findCustomerAppointmentForDateWithClient).toHaveBeenCalled()
    // The derived appointment reaches the write.
    expect((addRedemptionWithClient.mock.calls[0] as unknown[])[1]).toMatchObject({ appointmentId: 'appt-derived', customerId: 'cust-1' })
  })
  it('explicit appointmentId → derivation NOT invoked', async () => {
    const res = await packRedeem(post(IDEM, { packId: 'pack-1', appointmentId: 'appt-explicit' }), route('cust-1'))
    expect(res.status).toBe(201)
    expect(findCustomerAppointmentForDateWithClient).not.toHaveBeenCalled()
    expect((addRedemptionWithClient.mock.calls[0] as unknown[])[1]).toMatchObject({ appointmentId: 'appt-explicit' })
  })
  it('malformed redeemedOn ("tomorrow") → 400, no write', async () => {
    const res = await packRedeem(
      post(IDEM, { packId: 'pack-1', redeemedOn: 'tomorrow' }),
      route('cust-1'),
    )
    expect(res.status).toBe(400)
    expect(addRedemptionWithClient).not.toHaveBeenCalled()
  })
  it('cross-tenant / wrong-customer packId → 404, no write', async () => {
    listCustomerPacksWithClient.mockResolvedValue([{ id: 'pack-1' }]) // pack-evil not present
    const res = await packRedeem(post(IDEM, { packId: 'pack-evil' }), route('cust-1'))
    expect(res.status).toBe(404)
    expect(addRedemptionWithClient).not.toHaveBeenCalled()
  })
  it('over-redeem / double-burn (below_zero) → 409 conflict', async () => {
    addRedemptionWithClient.mockResolvedValue({ ok: false, error: 'below_zero' } as never)
    const res = await packRedeem(post(IDEM, { packId: 'pack-1' }), route('cust-1'))
    expect(res.status).toBe(409)
  })
  it('missing Idempotency-Key → 400, no write', async () => {
    const res = await packRedeem(post(noIdem, { packId: 'pack-1' }), route('cust-1'))
    expect(res.status).toBe(400)
    expect(addRedemptionWithClient).not.toHaveBeenCalled()
  })
  it('customerId is the PATH id, never the client body', async () => {
    await packRedeem(post(IDEM, { packId: 'pack-1', customerId: 'cust-evil' } as never), route('cust-1'))
    // strict schema rejects the extra key → 400; the point is a spoofed
    // customerId can never reach the write.
    expect(addRedemptionWithClient).not.toHaveBeenCalled()
  })
})

describe('POST lifecycle', () => {
  it('happy path → 200', async () => {
    const res = await lifecycleSet(post(IDEM, { status: 'graduated', referral: true }), route('cust-1'))
    expect(res.status).toBe(200)
    expect(setCustomerLifecycleWithClient).toHaveBeenCalled()
  })
  it('bad status → 400, no write', async () => {
    const res = await lifecycleSet(post(IDEM, { status: 'nope', referral: true }), route('cust-1'))
    expect(res.status).toBe(400)
    expect(setCustomerLifecycleWithClient).not.toHaveBeenCalled()
  })
  it('cross-tenant customer id → 404', async () => {
    const res = await lifecycleSet(post(IDEM, { status: 'lost', referral: false }), route('cust-x'))
    expect(res.status).toBe(404)
    expect(setCustomerLifecycleWithClient).not.toHaveBeenCalled()
  })
})
